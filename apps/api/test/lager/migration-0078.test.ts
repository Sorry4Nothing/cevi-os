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

// 0078 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0077 migrieren (was davon im Journal steht), dann 0078 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig383_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig383-"));
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
  ordnerBauen(bisVorher, 77);
  // Alles bis 0078: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 78);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'eingang'`
  ).map((z) => z.table_name);

test("0078 legt den Eingang an, CHECKs und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
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
  expect(await tabellen()).toEqual(["eingang"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const anonym = async (
    lagerId: string,
    hash: string = randomUUID(),
    text = "Idee",
  ) =>
    (
      await api`insert into eingang (lager_id, art, text, anonym, rueckfragecode_hash) values (${lagerId}, 'idee', ${text}, true, ${hash}) returning id`
    )[0].id as string;
  const a = await anonym(lagerA);
  const [zeile] = await api`select * from eingang where id = ${a}`;
  expect(zeile).toMatchObject({
    version: 1,
    status: "neu",
    person_id: null,
    antwort: null,
    beantwortet_tag: null,
    ressort_id: null,
    traktandum_id: null,
  });
  // Nur der Tag, kein Zeitpunkt; die ID ist zufällig (UUID Version 4)
  expect(zeile.erstellt_tag).toBeInstanceOf(Date);
  expect(a[14]).toBe("4");

  // Anonym ohne Person und mit Hash, sonst mit Person und ohne Hash
  await expect(
    api`insert into eingang (lager_id, art, text, anonym, person_id, rueckfragecode_hash) values (${lagerA}, 'idee', 'T', true, ${person.id}, 'h1')`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into eingang (lager_id, art, text, anonym) values (${lagerA}, 'idee', 'T', true)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into eingang (lager_id, art, text, anonym) values (${lagerA}, 'idee', 'T', false)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into eingang (lager_id, art, text, anonym, person_id, rueckfragecode_hash) values (${lagerA}, 'idee', 'T', false, ${person.id}, 'h2')`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`insert into eingang (lager_id, art, text, anonym, person_id) values (${lagerA}, 'frage', 'T', false, ${person.id})`;

  // Art, Status, Text und Antwort
  await expect(
    api`insert into eingang (lager_id, art, text, anonym, rueckfragecode_hash) values (${lagerA}, 'beschwerde', 'T', true, 'h3')`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(anonym(lagerA, "h4", "")).rejects.toMatchObject({
    code: "23514",
  });
  await expect(anonym(lagerA, "h5", "x".repeat(5001))).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    api`update eingang set status = 'offen' where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  // Antwort und Tag der Antwort gehören zusammen
  await expect(
    api`update eingang set antwort = 'Ja' where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`update eingang set antwort = 'Ja', beantwortet_tag = current_date where id = ${a}`;

  // Der Hash ist eindeutig
  await anonym(lagerA, "gleich");
  await expect(anonym(lagerB, "gleich")).rejects.toMatchObject({
    code: "23505",
  });

  // Ressort und Traktandum: Fremdschlüssel über das Lager, beim Löschen bleibt die Meldung ohne Zuordnung
  const [ressort] =
    await besitzer`insert into ressort (lager_id, kuerzel, name, lager_seq) values (${lagerA}, 'kue', 'Küche', 1) returning id`;
  const [fremdesRessort] =
    await besitzer`insert into ressort (lager_id, kuerzel, name, lager_seq) values (${lagerB}, 'kue', 'Küche', 1) returning id`;
  await api`update eingang set ressort_id = ${ressort.id} where id = ${a}`;
  await expect(
    api`update eingang set ressort_id = ${fremdesRessort.id} where id = ${a}`,
  ).rejects.toMatchObject({ code: "23503" });
  const [traktandum] =
    await besitzer`insert into traktandum (lager_id, titel, lager_seq) values (${lagerA}, 'Punkt', 1) returning id`;
  await api`update eingang set traktandum_id = ${traktandum.id} where id = ${a}`;
  await besitzer`delete from traktandum where id = ${traktandum.id}`;
  await besitzer`delete from ressort where id = ${ressort.id}`;
  expect(
    (
      await api`select ressort_id, traktandum_id, lager_id from eingang where id = ${a}`
    )[0],
  ).toEqual({ ressort_id: null, traktandum_id: null, lager_id: lagerA });

  // Das Löschen der Person nimmt ihre nicht anonymen Meldungen mit, die anonymen bleiben
  await besitzer`delete from "user" where id = ${person.id}`;
  expect(
    await api`select 1 from eingang where lager_id = ${lagerA} and person_id is not null`,
  ).toHaveLength(0);
  expect(
    (
      await api`select count(*)::int as n from eingang where lager_id = ${lagerA}`
    )[0].n,
  ).toBe(2);

  // Das Lager nimmt alles mit
  await api`delete from lager where id = ${lagerA}`;
  expect(
    await api`select 1 from eingang where lager_id = ${lagerA}`,
  ).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0078
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0078_lager_eingang.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0078 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["eingang"]);
}, 60_000);
