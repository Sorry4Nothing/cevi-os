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

// 0079 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0078 migrieren (was davon im Journal steht), dann 0079 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig384_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig384-"));
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
  ordnerBauen(bisVorher, 78);
  // Alles bis 0079: spätere Lager-Migrationen (ab 0080) sind für diesen Test ohne Belang
  ordnerBauen(komplett, 79);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('teilnehmer', 'abzaehlen') order by 1`
  ).map((z) => z.table_name);

test("0079 legt Teilnehmende und Abzählen an, Checks und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["abzaehlen", "teilnehmer"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const kind = async (
    lagerId: string,
    vorname = "Anna",
    nachname = "Muster",
    stufe: string | null = "Wolf",
  ) =>
    (
      await api`insert into teilnehmer (lager_id, vorname, nachname, stufe, lager_seq) values (${lagerId}, ${vorname}, ${nachname}, ${stufe}, 1) returning id`
    )[0].id as string;
  const a = await kind(lagerA);
  expect(
    (await api`select * from teilnehmer where id = ${a}`)[0],
  ).toMatchObject({
    version: 1,
    geloescht_am: null,
    cevi_name: null,
    kind_id: null,
    anmeldung_id: null,
  });
  // Stufe und Cevi-Name sind freiwillig; Grenzen der Länge, kein leerer Name
  await kind(lagerA, "Nur", "Name", null);
  for (const [v, n, s] of [
    ["", "X", "Wolf"],
    ["X", "", "Wolf"],
    ["x".repeat(101), "X", "Wolf"],
    ["X", "X", ""],
    ["X", "X", "x".repeat(51)],
  ] as const) {
    await expect(kind(lagerA, v, n, s)).rejects.toMatchObject({
      code: "23514",
    });
  }
  await expect(
    api`update teilnehmer set cevi_name = '' where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  // Es gibt keine Spalte für Gesundheit, Telefon oder Adresse
  const spalten = (
    await besitzer`select column_name from information_schema.columns where table_name = 'teilnehmer' order by 1`
  ).map((z) => z.column_name);
  expect(spalten).toEqual([
    "anmeldung_id",
    "cevi_name",
    "erstellt_am",
    "erstellt_von",
    "geaendert_am",
    "geaendert_von",
    "geloescht_am",
    "geloescht_von",
    "id",
    "kind_id",
    "lager_id",
    "lager_seq",
    "nachname",
    "stufe",
    "version",
    "vorname",
  ]);

  // Abzählen: genau eines von teilnehmer_id und person_id, geprueft passt zu geprueft_am, ein Haken je Ziel
  const haken = (
    lagerId: string,
    teilnehmerId: string | null,
    personId: string | null,
    geprueft = true,
  ) =>
    api`insert into abzaehlen (lager_id, teilnehmer_id, person_id, geprueft, geprueft_am, lager_seq) values (${lagerId}, ${teilnehmerId}, ${personId}, ${geprueft}, ${geprueft ? new Date() : null}, 2)`;
  await haken(lagerA, a, null);
  await haken(lagerA, null, person.id);
  await expect(haken(lagerA, a, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(haken(lagerA, null, person.id)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(haken(lagerA, null, null)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(haken(lagerA, a, person.id)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    api`insert into abzaehlen (lager_id, person_id, geprueft, geprueft_am, lager_seq) values (${lagerB}, ${person.id}, true, null, 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  // Ein Teilnehmender eines anderen Lagers: Fremdschlüssel über Lager und ID
  await expect(haken(lagerB, a, null)).rejects.toMatchObject({
    code: "23503",
  });
  // Nach Soft-Delete ist der Platz wieder frei
  await api`update abzaehlen set geloescht_am = now() where teilnehmer_id = ${a}`;
  await haken(lagerA, a, null);

  // Löschen der Teilnehmenden nimmt ihre Haken mit, der Haken der Person bleibt
  await api`delete from teilnehmer where id = ${a}`;
  expect(
    (await api`select person_id, teilnehmer_id from abzaehlen`).map(
      (z) => z.teilnehmer_id,
    ),
  ).toEqual([null]);
  // Das Lager nimmt alles mit
  await kind(lagerB);
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from teilnehmer where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0079
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0079_lager_teilnehmer.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0079 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["abzaehlen", "teilnehmer"]);
}, 60_000);
