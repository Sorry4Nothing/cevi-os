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

// 0138 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis zum Eintrag vor 0138 migrieren, füllen, dann 0138 durch den echten Migrator, dann der Rückweg (#629)
const TAG = "0138_laden_groesse_verfuegbar";
const dbName = `cevi_os_mig629_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig629-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

// Nach Stelle im Journal statt nach Nummer: Lücken in der Nummerierung stören nicht
function ordnerBauen(ziel: string, mitEintrag: boolean) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const stelle = journal.entries.findIndex((e) => e.tag === TAG);
  const eintraege = journal.entries.slice(0, stelle + (mitEintrag ? 1 : 0));
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
  ordnerBauen(bisVorher, false);
  ordnerBauen(komplett, true);
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
const spalte = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'laden_artikel' and column_name = 'nicht_verfuegbar'`
  )[0].n as number;

test("0138: Artikel bleiben vollständig verfügbar; der Rückweg sperrt Artikel ohne freie Grösse und entfernt die Spalte", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(0);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const mitListe = (
    await besitzer`insert into laden_artikel (abteilung_id, name, preis_rappen, varianten) values (${abteilung}, 'Shirt', 2000, ${["S", "M"]}) returning id`
  )[0].id as string;
  const einheit = (
    await besitzer`insert into laden_artikel (abteilung_id, name, preis_rappen) values (${abteilung}, 'Gurt', 500) returning id`
  )[0].id as string;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte()).toBe(1);
  const gelesen = await besitzer`
    select id, name, varianten, nicht_verfuegbar, verfuegbar from laden_artikel order by name`;
  // Nichts verloren, nichts gemeldet: alles bleibt verfügbar
  expect(gelesen).toHaveLength(2);
  for (const z of gelesen) {
    expect(z.nicht_verfuegbar).toEqual([]);
    expect(z.verfuegbar).toBe(true);
  }
  // Die Prüfung lässt nur vorhandene Grössen zu
  await expect(
    besitzer`update laden_artikel set nicht_verfuegbar = ${["XL"]} where id = ${mitListe}`,
  ).rejects.toThrow();
  await besitzer`update laden_artikel set nicht_verfuegbar = ${["S", "M"]} where id = ${mitListe}`;

  await besitzer.unsafe(
    readFileSync(
      new URL(`../drizzle/rueckweg/${TAG}.sql`, import.meta.url),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await spalte()).toBe(0);
  // Alle Grössen waren gemeldet: Mit dem alten Code bleibt der Artikel gesperrt; der Einheitsartikel ist unberührt
  const [liste] =
    await besitzer`select verfuegbar from laden_artikel where id = ${mitListe}`;
  const [gurt] =
    await besitzer`select verfuegbar from laden_artikel where id = ${einheit}`;
  expect(liste.verfuegbar).toBe(false);
  expect(gurt.verfuegbar).toBe(true);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0138 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalte()).toBe(1);
}, 120_000);
