import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0164 und ihr Rückweg gegen eine eigene Datenbank mit Daten (#807): erst bis 0163 mit Terminen in allen drei Sichtbarkeiten, dann 0164 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_807_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig807-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
) as { entries: { idx: number; tag: string }[] };
const DIESE = "0164_programm_sichtbarkeit_entfernt";
const nummer = journal.entries.find((e) => e.tag === DIESE)!.idx;

function ordnerBauen(ziel: string, bis: number) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const eintraege = journal.entries.filter((e) => e.idx <= bis);
  writeFileSync(
    join(ziel, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: eintraege }),
  );
  for (const e of eintraege) {
    cpSync(new URL(`${e.tag}.sql`, drizzleOrdner), join(ziel, `${e.tag}.sql`));
  }
}

beforeAll(async () => {
  await superuser.unsafe(`create database ${dbName} owner cevi_os_besitzer`);
  besitzer = postgres(url("cevi_os_besitzer"), { max: 1, onnotice: () => {} });
  ordnerBauen(bisVorher, nummer - 1);
  ordnerBauen(komplett, nummer);
}, 60_000);

afterAll(async () => {
  await besitzer?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const spalte = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'programm' and column_name = 'sichtbarkeit'`
  )[0].n as number;

test("0164: die Spalte fällt weg, alle Termine bleiben; der Rückweg bringt sie mit «eltern» zurück", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(1);
  const [abteilung] = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  ).map((z) => z.id as string);
  for (const sicht of ["intern", "leitende", "eltern"]) {
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis, sichtbarkeit) values (${abteilung}, ${"g-" + sicht}, ${sicht}, true, '2027-05-01', '2027-05-01', ${sicht})`;
  }

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte()).toBe(0);
  expect(
    (await besitzer`select titel from programm order by titel`).map(
      (z) => z.titel,
    ),
  ).toEqual(["eltern", "intern", "leitende"]);

  await besitzer.unsafe(
    readFileSync(
      new URL(`../drizzle/rueckweg/${DIESE}.sql`, import.meta.url),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await spalte()).toBe(1);
  expect(
    (await besitzer`select distinct sichtbarkeit from programm`).map(
      (z) => z.sichtbarkeit,
    ),
  ).toEqual(["eltern"]);
  await expect(
    besitzer`update programm set sichtbarkeit = 'alle'`,
  ).rejects.toThrow(/programm_sichtbarkeit_check/);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0164 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalte()).toBe(0);
}, 120_000);
