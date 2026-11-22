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

// 0086 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0085 migrieren (was davon im Journal steht), dann 0086 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig391_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig391-"));
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
  ordnerBauen(bisVorher, 85);
  // Alles bis 0086: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 86);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('tagesseite', 'tagesseite_block', 'wetter_cache') order by 1`
  ).map((z) => z.table_name);

test("0086 legt Tagesseiten und Wetter an, die Prüfungen der Datenbank halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "tagesseite",
    "tagesseite_block",
    "wetter_cache",
  ]);
  // Bestehende Lager haben keinen Ort
  expect(
    (
      await besitzer`select breite, laenge from lager where id = ${lager.id}`
    )[0],
  ).toEqual({ breite: null, laenge: null });

  // Ort: beide oder keiner, in Grenzen
  await api`update lager set breite = 47.37, laenge = 8.54 where id = ${lager.id}`;
  for (const [breite, laenge] of [
    [47.37, null],
    [null, 8.54],
    [91, 8.54],
    [47.37, 181],
  ]) {
    await expect(
      api`update lager set breite = ${breite}, laenge = ${laenge} where id = ${lager.id}`,
    ).rejects.toMatchObject({ code: "23514" });
  }

  // Tagesseite: höchstens eine je Lagertag, der Tag gehört zum selben Lager
  const [tag] =
    await api`insert into lagertag (lager_id, datum, lager_seq) values (${lager.id}, '2027-07-10', 1) returning id`;
  const [seite] =
    await api`insert into tagesseite (lager_id, lagertag_id, lager_seq) values (${lager.id}, ${tag.id}, 2) returning id, version`;
  expect(seite.version).toBe(1);
  await expect(
    api`insert into tagesseite (lager_id, lagertag_id, lager_seq) values (${lager.id}, ${tag.id}, 3)`,
  ).rejects.toMatchObject({ code: "23505" });
  const [lager2] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager 2', '2027-07-10', '2027-07-24') returning id`;
  const [tag2] =
    await api`insert into lagertag (lager_id, datum, lager_seq) values (${lager.id}, '2027-07-11', 1) returning id`;
  await expect(
    api`insert into tagesseite (lager_id, lagertag_id, lager_seq) values (${lager2.id}, ${tag2.id}, 1)`,
  ).rejects.toMatchObject({ code: "23503" });
  // Der Tageschef ist Mitglied dieses Lagers; verlässt er es, bleibt die Seite ohne Tageschef
  await expect(
    api`update tagesseite set tageschef_person_id = ${person.id} where id = ${seite.id}`,
  ).rejects.toMatchObject({ code: "23503" });
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lager.id}, ${person.id}, 'team')`;
  await api`update tagesseite set tageschef_person_id = ${person.id} where id = ${seite.id}`;
  await besitzer`delete from lager_mitglied where lager_id = ${lager.id} and person_id = ${person.id}`;
  expect(
    (
      await api`select tageschef_person_id, lager_id from tagesseite where id = ${seite.id}`
    )[0],
  ).toEqual({ tageschef_person_id: null, lager_id: lager.id });
  await expect(
    api`update tagesseite set notiz = ${"x".repeat(5001)} where id = ${seite.id}`,
  ).rejects.toMatchObject({ code: "23514" });

  // Block: Art aus der Liste, Programmbild nur mit Datei, die anderen ohne, Text 1 bis 1000 Zeichen
  await api`insert into tagesseite_block (lager_id, seite_id, art, text, lager_seq) values (${lager.id}, ${seite.id}, 'wichtig', 'Regen', 4)`;
  const [datei] =
    await api`insert into lager_datei (lager_id, anzeigename, link, lager_seq) values (${lager.id}, 'Bild', 'https://a.example.org/x', 5) returning id`;
  await api`insert into tagesseite_block (lager_id, seite_id, art, text, datei_id, lager_seq) values (${lager.id}, ${seite.id}, 'programmbild', 'Karte', ${datei.id}, 6)`;
  for (const [art, text, dateiId] of [
    ["todo", "Etwas", null],
    ["programmbild", "Karte", null],
    ["wichtig", "Etwas", datei.id],
    ["idee", "", null],
    ["idee", "x".repeat(1001), null],
  ]) {
    await expect(
      api`insert into tagesseite_block (lager_id, seite_id, art, text, datei_id, lager_seq) values (${lager.id}, ${seite.id}, ${art}, ${text}, ${dateiId}, 7)`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  // Ein Block einer Seite eines anderen Lagers ist nicht erreichbar
  await expect(
    api`insert into tagesseite_block (lager_id, seite_id, art, text, lager_seq) values (${lager2.id}, ${seite.id}, 'idee', 'X', 1)`,
  ).rejects.toMatchObject({ code: "23503" });
  // Eine eingebundene Datei hält ihren Eintrag
  await expect(
    api`delete from lager_datei where id = ${datei.id}`,
  ).rejects.toMatchObject({ code: "23001" });

  // Zwischenspeicher: eine Zeile je Lager, die Tage sind eine Liste
  await api`insert into wetter_cache (lager_id, breite, laenge, versuch_am) values (${lager.id}, 47.37, 8.54, now())`;
  await expect(
    api`insert into wetter_cache (lager_id, breite, laenge, versuch_am) values (${lager.id}, 47.37, 8.54, now())`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`update wetter_cache set tage = '{"a": 1}'::jsonb`,
  ).rejects.toMatchObject({ code: "23514" });

  // Das Lager nimmt alles mit
  await api`delete from lager where id = ${lager.id}`;
  for (const t of [
    "tagesseite",
    "tagesseite_block",
    "wetter_cache",
    "lager_datei",
  ]) {
    expect(
      await api.unsafe(`select 1 from ${t} where lager_id = '${lager.id}'`),
      t,
    ).toHaveLength(0);
  }

  // Rückweg: Tabellen und Spalten weg, Journal ohne 0086, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0086_lager_tagesseiten.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(
    await besitzer`select 1 from information_schema.columns where table_name = 'lager' and column_name in ('breite', 'laenge')`,
  ).toHaveLength(0);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0086 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(3);
}, 60_000);
