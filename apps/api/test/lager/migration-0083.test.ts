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

// 0083 und ihr Rückweg gegen eine eigene Datenbank: erst bis zur Migration vor 0083 migrieren, dann 0083 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig387_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig387-"));
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
  ordnerBauen(bisVorher, 82);
  // Alles bis 0083: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 83);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('gruppe', 'gruppe_zuordnung') order by 1`
  ).map((z) => z.table_name);
const hatSpalte = async () =>
  (
    await besitzer`select 1 from information_schema.columns where table_name = 'teilnehmer' and column_name = 'abgewaehlt'`
  ).length === 1;

test("0083 legt Gruppen und «nicht dabei» an, Checks, Teilindizes und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);
  expect(await hatSpalte()).toBe(false);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];
  // Ein Teilnehmender, der vor der Migration schon da ist
  const [alt] =
    await besitzer`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${lagerA}, 'Alt', 'Kind', 1) returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["gruppe", "gruppe_zuordnung"]);
  // Bestehende Teilnehmende gelten als dabei
  expect(
    (await api`select abgewaehlt from teilnehmer where id = ${alt.id}`)[0]
      .abgewaehlt,
  ).toBe(false);

  const gruppe = async (lagerId: string, name = "Adler", reihenfolge = 0) =>
    (
      await api`insert into gruppe (lager_id, name, reihenfolge, lager_seq) values (${lagerId}, ${name}, ${reihenfolge}, 1) returning id`
    )[0].id as string;
  const g = await gruppe(lagerA);
  for (const [n, r] of [
    ["", 0],
    ["x".repeat(101), 0],
    ["Neg", -1],
  ] as const) {
    await expect(gruppe(lagerA, n, r)).rejects.toMatchObject({
      code: "23514",
    });
  }

  // Zuordnung: genau eines von teilnehmer_id und person_id, Teilnehmende nur «mitglied», eine Gruppe je Person und je Teilnehmenden
  const zuordnung = (
    lagerId: string,
    gruppeId: string,
    teilnehmerId: string | null,
    personId: string | null,
    rolle = "mitglied",
  ) =>
    api`insert into gruppe_zuordnung (lager_id, gruppe_id, teilnehmer_id, person_id, rolle, lager_seq) values (${lagerId}, ${gruppeId}, ${teilnehmerId}, ${personId}, ${rolle}, 2)`;
  await zuordnung(lagerA, g, alt.id, null);
  await zuordnung(lagerA, g, null, person.id, "leitung");
  const g2 = await gruppe(lagerA, "Bär", 1);
  await expect(zuordnung(lagerA, g2, alt.id, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(zuordnung(lagerA, g2, null, person.id)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(zuordnung(lagerA, g, null, null)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(zuordnung(lagerA, g, alt.id, person.id)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    zuordnung(lagerA, g, alt.id, null, "leitung"),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    zuordnung(lagerA, g, null, person.id, "chef"),
  ).rejects.toMatchObject({ code: "23514" });
  // Eine Gruppe oder ein Teilnehmender eines anderen Lagers: Fremdschlüssel über Lager und ID
  await expect(zuordnung(lagerB, g, null, person.id)).rejects.toMatchObject({
    code: "23503",
  });
  const gB = await gruppe(lagerB);
  await expect(zuordnung(lagerB, gB, alt.id, null)).rejects.toMatchObject({
    code: "23503",
  });
  // Nach Soft-Delete ist der Platz wieder frei
  await api`update gruppe_zuordnung set geloescht_am = now() where teilnehmer_id = ${alt.id}`;
  await zuordnung(lagerA, g2, alt.id, null);

  // Löschen der Gruppe nimmt ihre Zuordnungen mit, das Konto nimmt seine mit
  await api`delete from gruppe where id = ${g}`;
  expect(
    (
      await api`select person_id from gruppe_zuordnung where person_id is not null`
    ).length,
  ).toBe(0);
  await api`delete from teilnehmer where id = ${alt.id}`;
  expect(
    await api`select * from gruppe_zuordnung where teilnehmer_id = ${alt.id}`,
  ).toHaveLength(0);
  // Das Lager nimmt alles mit
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from gruppe where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen und Spalte weg, Journal ohne 0083
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0083_lager_gruppen.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await hatSpalte()).toBe(false);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0083 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["gruppe", "gruppe_zuordnung"]);
  expect(await hatSpalte()).toBe(true);
}, 60_000);
