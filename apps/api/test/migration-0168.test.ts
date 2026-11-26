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

// 0168 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0167 migrieren, füllen, dann 0168 durch den echten Migrator, dann der Rückweg (#838)
const dbName = `cevi_os_mig838_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig838-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

function ordnerBauen(ziel: string, bis: number) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
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
  ordnerBauen(bisVorher, 167);
  ordnerBauen(komplett, 168);
});

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
const hatSpalte = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'lager' and column_name = 'seite_id'`
  )[0].n === 1;
const rueckweg = () =>
  besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0168_lager_seite.sql", import.meta.url),
      "utf8",
    ),
  );
const seiteAnlegen = async (abteilung: string, adresse: string) =>
  (
    await besitzer`insert into seite (abteilung_id, adresse, titel, sichtbarkeit) values (${abteilung}, ${adresse}, 'Lager', 'angemeldet') returning id`
  )[0].id as string;
const lagerAnlegen = async (abteilung: string) =>
  (
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung}, 'Sommerlager', '2027-07-10', '2027-07-24') returning id`
  )[0].id as string;
const seiteVon = async (lager: string) =>
  (await besitzer`select seite_id from lager where id = ${lager}`)[0]
    .seite_id as string | null;

test("0168: bestehende Lager bleiben ohne Seite, die Verknüpfung leert sich beim Löschen der Seite, je Seite ein Lager; der Rückweg entfernt nur die Spalte", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await hatSpalte()).toBe(false);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const alt = await lagerAnlegen(abteilung);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await seiteVon(alt)).toBeNull();

  const seite = await seiteAnlegen(abteilung, "sommerlager");
  await besitzer`update lager set seite_id = ${seite} where id = ${alt}`;
  expect(await seiteVon(alt)).toBe(seite);
  // Eine Seite gehört höchstens einem Lager
  const zweites = await lagerAnlegen(abteilung);
  await expect(
    besitzer`update lager set seite_id = ${seite} where id = ${zweites}`,
  ).rejects.toThrow(/lager_seite_eindeutig/);
  // Wird die Seite gelöscht, bleibt das Lager und die Verknüpfung wird leer
  await besitzer`delete from seite where id = ${seite}`;
  expect(await seiteVon(alt)).toBeNull();

  const wieder = await seiteAnlegen(abteilung, "sommerlager-2");
  await besitzer`update lager set seite_id = ${wieder} where id = ${alt}`;
  await rueckweg();
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await hatSpalte()).toBe(false);
  // Lager und Seite selbst bleiben
  expect((await besitzer`select count(*)::int as n from lager`)[0].n).toBe(2);
  expect(
    (
      await besitzer`select count(*)::int as n from seite where id = ${wieder}`
    )[0].n,
  ).toBe(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0168 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await hatSpalte()).toBe(true);
}, 120_000);
