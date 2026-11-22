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

// 0120 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0119 migrieren, dann 0120 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig432_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig432-"));
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
  ordnerBauen(bisVorher, 119);
  ordnerBauen(komplett, 120);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('programm_tag', 'kategorie_zuordnung') order by 1`
  ).map((z) => z.table_name);
const spalten = async () =>
  (
    await besitzer`select column_name from information_schema.columns where table_name = 'programm' and column_name in ('kategorien', 'ort') order by 1`
  ).map((z) => z.column_name);

test("0120 legt Kategorien, Ort und die Tag-Zuordnung an, bestehende Termine bleiben, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);
  expect(await spalten()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [alt] =
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende) values (${abteilung.id}, 'alt', 'Alt', false, '2027-09-04T12:00Z', '2027-09-04T14:00Z') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["kategorie_zuordnung", "programm_tag"]);
  expect(await spalten()).toEqual(["kategorien", "ort"]);
  // Ein bestehender Termin hat keine Kategorien und keinen Ort, also auch keinen Tag
  expect(
    (
      await besitzer`select kategorien, ort from programm where id = ${alt.id}`
    )[0],
  ).toEqual({ kategorien: [], ort: null });

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const [tag] =
    await api`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung.id}, 'stufe', 'Wolfsstufe', 'Wo') returning id`;
  await api`insert into programm_tag (programm_id, tag_id) values (${alt.id}, ${tag.id})`;
  await expect(
    api`insert into programm_tag (programm_id, tag_id) values (${alt.id}, ${tag.id})`,
  ).rejects.toMatchObject({ code: "23505" });
  await api`insert into kategorie_zuordnung (abteilung_id, kategorie, tag_id) values (${abteilung.id}, 'Wölfe', ${tag.id})`;
  await expect(
    api`insert into kategorie_zuordnung (abteilung_id, kategorie, tag_id) values (${abteilung.id}, 'WÖLFE', ${tag.id})`,
  ).rejects.toMatchObject({ code: "23505" });

  // Der Tag nimmt seine Zeilen mit, der Termin nur seine eigene
  await api`delete from tag where id = ${tag.id}`;
  expect(await api`select * from programm_tag`).toHaveLength(0);
  expect(await api`select * from kategorie_zuordnung`).toHaveLength(0);

  // Rückweg: Tabellen und Spalten weg, Journal ohne 0120, der Termin bleibt
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0120_termin_kategorien.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await spalten()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(
    await besitzer`select id from programm where id = ${alt.id}`,
  ).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0120 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["kategorie_zuordnung", "programm_tag"]);
}, 60_000);
