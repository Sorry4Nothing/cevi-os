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

// 0088 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0087 migrieren (was davon im Journal steht), dann 0088 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig393_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig393-"));
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
  ordnerBauen(bisVorher, 87);
  // Alles bis 0088: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 88);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('packliste_punkt', 'packliste_abhaken', 'packliste_eigen', 'notfall_kontakt', 'info_abschnitt', 'info_abschnitt_datei') order by 1`
  ).map((z) => z.table_name);

test("0088 legt Packliste, Notfall und Infos an, die Prüfungen der Datenbank halten, der Rückweg räumt auf", async () => {
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
    "info_abschnitt",
    "info_abschnitt_datei",
    "notfall_kontakt",
    "packliste_abhaken",
    "packliste_eigen",
    "packliste_punkt",
  ]);
  // Bestehende Lager haben keinen Kartenlink
  expect(
    (await besitzer`select karten_link from lager where id = ${lager.id}`)[0]
      .karten_link,
  ).toBeNull();

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const [punkt] =
    await api`insert into packliste_punkt (lager_id, abschnitt, text, lager_seq) values (${lager.id}, 'Kleidung', 'Regenjacke', 1) returning id, version, nur_lagerleitung`;
  expect(punkt).toMatchObject({ version: 1, nur_lagerleitung: false });
  await api`insert into packliste_abhaken (lager_id, person_id, punkt_id, zustand) values (${lager.id}, ${person.id}, ${punkt.id}, 'abgehakt')`;
  // Eine Abweichung je Person und Punkt; nur abgehakt oder entfernt; ein Punkt eines anderen Lagers ist nicht erreichbar
  await expect(
    api`insert into packliste_abhaken (lager_id, person_id, punkt_id, zustand) values (${lager.id}, ${person.id}, ${punkt.id}, 'entfernt')`,
  ).rejects.toMatchObject({ code: "23505" });
  const [lager2] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager 2', '2027-07-10', '2027-07-24') returning id`;
  const [person2] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person 2', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  await expect(
    api`insert into packliste_abhaken (lager_id, person_id, punkt_id, zustand) values (${lager2.id}, ${person2.id}, ${punkt.id}, 'abgehakt')`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`update packliste_abhaken set zustand = 'offen'`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`insert into packliste_eigen (lager_id, person_id, abschnitt, text) values (${lager.id}, ${person.id}, 'Sonstiges', 'Gitarre')`;

  // Notfall-Kontakt: ein Konto oder ein Name mit Nummer, nie beides, keine ungültige Nummer
  await api`insert into notfall_kontakt (lager_id, funktion, person_id, lager_seq) values (${lager.id}, 'Sicherheit', ${person.id}, 2)`;
  await api`insert into notfall_kontakt (lager_id, funktion, name, telefon, lager_seq) values (${lager.id}, 'Arzt', 'Dr. Muster', '044 123 45 67', 3)`;
  for (const [name, telefon, personId] of [
    ["Dr. Muster", null, null],
    ["Dr. Muster", "044 123 45 67", person.id],
    [null, null, null],
    ["Dr. Muster", "abc", null],
  ]) {
    await expect(
      api`insert into notfall_kontakt (lager_id, funktion, person_id, name, telefon, lager_seq) values (${lager.id}, 'X', ${personId}, ${name}, ${telefon}, 4)`,
    ).rejects.toMatchObject({ code: "23514" });
  }

  // Info-Abschnitt: Links nur als Liste, höchstens 20
  const [abschnitt] =
    await api`insert into info_abschnitt (lager_id, titel, lager_seq) values (${lager.id}, 'Anreise', 5) returning id, links`;
  expect(abschnitt.links).toEqual([]);
  await expect(
    api`insert into info_abschnitt (lager_id, titel, links, lager_seq) values (${lager.id}, 'X', '{"a": 1}'::jsonb, 6)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into info_abschnitt (lager_id, titel, links, lager_seq) values (${lager.id}, 'X', ${JSON.stringify(Array.from({ length: 21 }, () => ({})))}::jsonb, 6)`,
  ).rejects.toMatchObject({ code: "23514" });

  // Kartenlink nur https
  await api`update lager set karten_link = 'https://maps.example.org/?q=a' where id = ${lager.id}`;
  await expect(
    api`update lager set karten_link = 'javascript:alert(1)' where id = ${lager.id}`,
  ).rejects.toMatchObject({ code: "23514" });

  // Eine eingebundene Datei hält ihren Eintrag; das Lager nimmt beide mit
  const [datei] =
    await api`insert into lager_datei (lager_id, anzeigename, link, lager_seq) values (${lager.id}, 'Plan', 'https://a.example.org/x', 7) returning id`;
  await api`insert into info_abschnitt_datei (lager_id, abschnitt_id, datei_id, lager_seq) values (${lager.id}, ${abschnitt.id}, ${datei.id}, 8)`;
  await expect(
    api`delete from lager_datei where id = ${datei.id}`,
  ).rejects.toMatchObject({ code: "23001" });
  await api`delete from lager where id = ${lager.id}`;
  for (const t of [
    "packliste_punkt",
    "packliste_abhaken",
    "packliste_eigen",
    "notfall_kontakt",
    "info_abschnitt",
    "info_abschnitt_datei",
    "lager_datei",
  ]) {
    expect(
      await api.unsafe(`select 1 from ${t} where lager_id = '${lager.id}'`),
      t,
    ).toHaveLength(0);
  }

  // Rückweg: Tabellen und Spalte weg, Journal ohne 0088, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0088_lager_infos.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(
    await besitzer`select 1 from information_schema.columns where table_name = 'lager' and column_name = 'karten_link'`,
  ).toHaveLength(0);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0088 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(6);
}, 60_000);
