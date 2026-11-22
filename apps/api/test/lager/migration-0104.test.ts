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
import { SUPERUSER_URL } from "../hilfen/datenbank.js";

// 0104 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0103 migrieren (was davon im Journal steht), dann 0104 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig377_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig377-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;
let api: postgres.Sql;

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
  api = postgres(url("cevi_os_api"), { max: 1 });
  ordnerBauen(bisVorher, 103);
  ordnerBauen(komplett, 104);
});

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const tabellen = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'lager_check_punkt'`
  ).map((z) => z.table_name);

test("0104 legt lager_check_punkt an, die API-Rolle darf es nutzen, CHECKs halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["lager_check_punkt"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest; Vorgaben: Version 1, nicht erledigt, Reihenfolge 0
  await api`insert into lager_check_punkt (lager_id, titel, lager_seq) values (${lager.id}, 'Versicherung geklärt', 1)`;
  const [zeile] = await api`select * from lager_check_punkt`;
  expect(zeile).toMatchObject({
    titel: "Versicherung geklärt",
    version: 1,
    erledigt: false,
    reihenfolge: 0,
  });
  expect(zeile.id).toMatch(/^[0-9a-f-]{36}$/);

  // CHECKs: Titel 1 bis 200 Zeichen, Reihenfolge nicht negativ
  await expect(
    api`insert into lager_check_punkt (lager_id, titel, lager_seq) values (${lager.id}, '', 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into lager_check_punkt (lager_id, titel, lager_seq) values (${lager.id}, ${"x".repeat(201)}, 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into lager_check_punkt (lager_id, titel, reihenfolge, lager_seq) values (${lager.id}, 'X', -1, 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  // Ein Punkt gehört zu einem Lager
  await expect(
    api`insert into lager_check_punkt (lager_id, titel, lager_seq) values (${randomUUID()}, 'X', 2)`,
  ).rejects.toMatchObject({ code: "23503" });

  // Das Lager nimmt seine Punkte mit
  await api`delete from lager where id = ${lager.id}`;
  expect(await api`select * from lager_check_punkt`).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0104, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0104_lager_check.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0104 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["lager_check_punkt"]);
}, 60_000);
