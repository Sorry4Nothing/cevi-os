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

// 0167 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0166 migrieren, füllen, dann 0167 durch den echten Migrator, dann der Rückweg (#835)
const dbName = `cevi_os_mig835_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig835-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

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
  ordnerBauen(bisVorher, 166);
  ordnerBauen(komplett, 167);
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
const tabellen = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like 'outlook_%'`
  )[0].n as number;
const rueckweg = () =>
  besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0167_outlook_schreiben.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

test("0167: bestehende Daten bleiben, die drei Tabellen entstehen, der Rückweg räumt sie weg und lässt sich wiederholen", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toBe(0);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const programm = (
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis) values (${abteilung}, 'g-1', 'Termin', true, '2027-05-01', '2027-05-01') returning id`
  )[0].id as string;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toBe(3);
  expect(
    (await besitzer`select titel from programm where id = ${programm}`)[0]
      .titel,
  ).toBe("Termin");

  const [v] =
    await besitzer`insert into outlook_verbindung (abteilung_id, refresh_token) values (${abteilung}, 'verschluesselt') returning status, kategorien_offen, versuche, akteur_id`;
  expect(v).toMatchObject({
    status: "aktiv",
    kategorien_offen: true,
    versuche: 0,
    akteur_id: "cli",
  });
  await expect(
    besitzer`update outlook_verbindung set status = 'kaputt' where abteilung_id = ${abteilung}`,
  ).rejects.toThrow(/outlook_verbindung_status_check/);
  await besitzer`insert into outlook_kategorie (abteilung_id, name_klein, name, outlook_id) values (${abteilung}, 'biber', 'Biber', 'id-1')`;
  await expect(
    besitzer`insert into outlook_kategorie (abteilung_id, name_klein, name, outlook_id) values (${abteilung}, 'biber', 'Biber', 'id-2')`,
  ).rejects.toThrow();
  await besitzer`insert into outlook_aenderung (programm_id, abteilung_id, akteur_id) values (${programm}, ${abteilung}, 'system')`;
  // Fällt der Termin weg, fällt seine Markierung mit
  await besitzer`delete from programm where id = ${programm}`;
  expect(
    (await besitzer`select count(*)::int as n from outlook_aenderung`)[0].n,
  ).toBe(0);

  await rueckweg();
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await tabellen()).toBe(0);
  expect(
    (await besitzer`select name from abteilung where id = ${abteilung}`)[0]
      .name,
  ).toBe("Eins");

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0167 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toBe(3);
}, 120_000);
