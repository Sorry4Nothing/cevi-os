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

// 0066 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0065 migrieren, dann 0066 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig370_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig370-"));
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
  ordnerBauen(bisVorher, 65);
  // Alles bis 0066: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 66);
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
const tabelle = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'lager_datei'`
  ).map((z) => z.table_name);
const spalte = async () =>
  (
    await besitzer`select column_name from information_schema.columns where table_name = 'abteilung' and column_name = 'datei_hosts'`
  ).length;

test("0066 legt Tabelle und Spalte an, die CHECKs halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelle()).toEqual([]);
  expect(await spalte()).toBe(0);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabelle()).toEqual(["lager_datei"]);
  // Bestehende Abteilungen bleiben ohne Einschränkung
  expect(
    (
      await besitzer`select datei_hosts from abteilung where id = ${abteilung.id}`
    )[0].datei_hosts,
  ).toBeNull();

  // Die API-Rolle schreibt und liest; die Vorgabewerte stehen
  const [zeile] =
    await api`insert into lager_datei (lager_id, lager_seq, anzeigename, link) values (${lager.id}, 1, 'Plan', 'https://cevi.sharepoint.com/x') returning *`;
  expect(zeile).toMatchObject({
    version: 1,
    typ: null,
    groesse: null,
    geloescht_am: null,
  });
  expect(zeile.id).toMatch(/^[0-9a-f-]{36}$/);

  // Die CHECKs gelten auch ohne die Routen
  for (const link of [
    "http://cevi.sharepoint.com/x",
    "javascript:alert(1)",
    "https://cevi.sharepoint.com/a b",
    "https://cevi.sharepoint.com/a\\b",
    `https://cevi.sharepoint.com/${"a".repeat(2048)}`,
  ]) {
    await expect(
      api`insert into lager_datei (lager_id, lager_seq, anzeigename, link) values (${lager.id}, 1, 'x', ${link})`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  await expect(
    api`insert into lager_datei (lager_id, lager_seq, anzeigename, link) values (${lager.id}, 1, '', 'https://a.example/x')`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into lager_datei (lager_id, lager_seq, anzeigename, link, groesse) values (${lager.id}, 1, 'x', 'https://a.example/x', -1)`,
  ).rejects.toMatchObject({ code: "23514" });

  // Das Lager nimmt seine Einträge mit
  await api`delete from lager where id = ${lager.id}`;
  expect(await api`select * from lager_datei`).toHaveLength(0);

  // Rückweg: Tabelle und Spalte weg, Journal ohne 0066, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0066_lager_dateien.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabelle()).toEqual([]);
  expect(await spalte()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0066 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabelle()).toEqual(["lager_datei"]);
  expect(await spalte()).toBe(1);
}, 60_000);
