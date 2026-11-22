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

// 0070 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0069 migrieren (was davon im Journal steht), dann 0070 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig374a_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig374a-"));
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
  ordnerBauen(bisVorher, 69);
  ordnerBauen(komplett, 70);
});

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
}, 60_000);

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const tabellen = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('meilenstein', 'lagertag', 'tagesabschnitt') order by 1`
  ).map((z) => z.table_name);

test("0070 legt die Tabellen und die relative Frist an, Fremdschlüssel und CHECKs halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const eins = await lager();
  const zwei = await lager();
  // Eine Aufgabe vor der Migration: bleibt, mit ihrer festen Frist
  await besitzer`insert into aufgabe (lager_id, titel, frist, lager_seq) values (${eins}, 'Alt', '2027-06-01', 1)`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "lagertag",
    "meilenstein",
    "tagesabschnitt",
  ]);
  expect(
    (
      await besitzer`select frist::text, frist_meilenstein_id, frist_versatz_tage from aufgabe`
    )[0],
  ).toMatchObject({
    frist: "2027-06-01",
    frist_meilenstein_id: null,
    frist_versatz_tage: null,
  });

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const [m] =
    await api`insert into meilenstein (lager_id, titel, datum, lager_seq) values (${eins}, 'Anmeldeschluss', '2027-05-01', 2) returning id, version`;
  expect(m.version).toBe(1);
  const [fremd] =
    await api`insert into meilenstein (lager_id, titel, datum, lager_seq) values (${zwei}, 'Anderes Lager', '2027-05-01', 1) returning id`;
  await api`insert into lagertag (lager_id, datum, lager_seq) values (${eins}, '2027-07-10', 3)`;
  await api`insert into tagesabschnitt (lager_id, name, zeit, lager_seq) values (${eins}, 'Vormittag', '08:30', 4)`;
  // Je Datum und je Name einmal
  await expect(
    api`insert into lagertag (lager_id, datum, lager_seq) values (${eins}, '2027-07-10', 5)`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into tagesabschnitt (lager_id, name, lager_seq) values (${eins}, 'VORMITTAG', 5)`,
  ).rejects.toMatchObject({ code: "23505" });
  await api`insert into lagertag (lager_id, datum, lager_seq) values (${zwei}, '2027-07-10', 2)`;
  // CHECKs: Zeit nur als HH:MM, Titel nicht leer, Art höchstens 50 Zeichen
  for (const zeit of ["8:30", "24:00", "mittags"]) {
    await expect(
      api`insert into tagesabschnitt (lager_id, name, zeit, lager_seq) values (${eins}, ${`Z${zeit}`}, ${zeit}, 6)`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  await expect(
    api`insert into meilenstein (lager_id, titel, datum, lager_seq) values (${eins}, '', '2027-05-01', 6)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into meilenstein (lager_id, titel, datum, art, lager_seq) values (${eins}, 'x', '2027-05-01', ${"a".repeat(51)}, 6)`,
  ).rejects.toMatchObject({ code: "23514" });

  // Die relative Frist: Meilenstein des eigenen Lagers, nie eines fremden; ein Meilenstein braucht den Versatz, ein Versatz die Frist
  await api`insert into aufgabe (lager_id, titel, frist, frist_meilenstein_id, frist_versatz_tage, lager_seq) values (${eins}, 'Relativ', '2027-05-04', ${m.id}, 3, 7)`;
  await api`insert into aufgabe (lager_id, titel, frist, frist_versatz_tage, lager_seq) values (${eins}, 'Zum Lagerbeginn', '2027-07-05', -5, 8)`;
  await expect(
    api`insert into aufgabe (lager_id, titel, frist, frist_meilenstein_id, frist_versatz_tage, lager_seq) values (${eins}, 'Fremd', '2027-05-04', ${fremd.id}, 3, 9)`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`insert into aufgabe (lager_id, titel, frist, frist_meilenstein_id, lager_seq) values (${eins}, 'Ohne Versatz', '2027-05-04', ${m.id}, 9)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into aufgabe (lager_id, titel, frist_versatz_tage, lager_seq) values (${eins}, 'Ohne Frist', 3, 9)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into aufgabe (lager_id, titel, frist, frist_versatz_tage, lager_seq) values (${eins}, 'Zu weit', '2027-05-04', 3651, 9)`,
  ).rejects.toMatchObject({ code: "23514" });
  // Der Meilenstein bleibt, solange eine Aufgabe auf ihn zeigt (kein stilles Umhängen auf den Lagerbeginn)
  await expect(
    api`delete from meilenstein where id = ${m.id}`,
  ).rejects.toMatchObject({ code: "23503" });

  // Das Lager nimmt alles mit (Kaskade, auch mit dem Bezug)
  await api`delete from lager where id = ${eins}`;
  expect(
    await api`select * from meilenstein where lager_id = ${eins}`,
  ).toHaveLength(0);
  expect(
    await api`select * from lagertag where lager_id = ${eins}`,
  ).toHaveLength(0);
  expect(
    await api`select * from tagesabschnitt where lager_id = ${eins}`,
  ).toHaveLength(0);
  expect(
    await api`select * from aufgabe where lager_id = ${eins}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen und Spalten weg, Journal ohne 0070, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0070_lager_zeitplan.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(
    await besitzer`select 1 from information_schema.columns where table_name = 'aufgabe' and column_name in ('frist_meilenstein_id', 'frist_versatz_tage')`,
  ).toHaveLength(0);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0070 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(3);
}, 60_000);
