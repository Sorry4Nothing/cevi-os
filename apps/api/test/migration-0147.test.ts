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

// 0147 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0139 migrieren, eine Angabe der Stufe füllen, dann 0147 durch den echten Migrator, dann der Rückweg (#646)
const dbName = `cevi_os_mig646_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig646-"));
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
  // 0147 ist die erste Migration nach 0139: alles davor gilt als Stand vorher
  ordnerBauen(bisVorher, 146);
  ordnerBauen(komplett, 147);
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
const tabelleOrt = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'ort'`
  )[0].n as number;
const spalten = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'programm_eckdaten' and column_name in ('treffpunkt_ort_id', 'schluss_ort_id')`
  )[0].n as number;
const rueckweg = () =>
  besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0147_ort.sql", import.meta.url),
      "utf8",
    ),
  );

test("0147: bestehende Angaben bleiben, der Ort ist geprüft, Löschen löst den Bezug, der Rückweg lässt die Texte stehen", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelleOrt()).toBe(0);
  expect(await spalten()).toBe(0);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const stufe = (
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'stufe', 'Wölfe', 'W') returning id`
  )[0].id as string;
  await besitzer`insert into programm_eckdaten (stufe_id, tag, treffpunkt, schluss_ort) values (${stufe}, '2031-05-01', 'Alter Text', 'Bahnhof')`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabelleOrt()).toBe(1);
  expect(await spalten()).toBe(2);
  // Die bestehende Angabe bleibt, ohne Kennung
  expect(
    (
      await besitzer`select treffpunkt, schluss_ort, treffpunkt_ort_id, schluss_ort_id from programm_eckdaten where stufe_id = ${stufe}`
    )[0],
  ).toEqual({
    treffpunkt: "Alter Text",
    schluss_ort: "Bahnhof",
    treffpunkt_ort_id: null,
    schluss_ort_id: null,
  });

  const ort = (
    await besitzer`insert into ort (abteilung_id, name, breite, laenge) values (${abteilung}, 'Pfadiheim', 47.2, 8.7) returning id`
  )[0].id as string;
  // Name je Abteilung einmalig ohne Gross- und Kleinschreibung
  await expect(
    besitzer`insert into ort (abteilung_id, name) values (${abteilung}, 'PFADIHEIM')`,
  ).rejects.toThrow(/ort_name_pro_abteilung/);
  // Koordinaten nur paarweise und im Bereich; höchstens eine Form des Standorts
  await expect(
    besitzer`insert into ort (abteilung_id, name, breite) values (${abteilung}, 'Halb', 47.2)`,
  ).rejects.toThrow(/ort_koordinaten_check/);
  await expect(
    besitzer`insert into ort (abteilung_id, name, breite, laenge) values (${abteilung}, 'Zu weit', 95, 8)`,
  ).rejects.toThrow(/ort_koordinaten_check/);
  await expect(
    besitzer`insert into ort (abteilung_id, name, karte_adresse, breite, laenge) values (${abteilung}, 'Doppelt', 'Weg 1', 47.2, 8.7)`,
  ).rejects.toThrow(/ort_eine_form_check/);
  await expect(
    besitzer`insert into ort (abteilung_id, name) values (${abteilung}, '')`,
  ).rejects.toThrow(/ort_laenge_check/);

  // Die Angabe wählt den Ort; fällt der Ort weg, bleibt der Text und der Bezug löst sich
  await besitzer`update programm_eckdaten set treffpunkt = 'Pfadiheim', treffpunkt_ort_id = ${ort} where stufe_id = ${stufe}`;
  await besitzer`delete from ort where id = ${ort}`;
  expect(
    (
      await besitzer`select treffpunkt, treffpunkt_ort_id from programm_eckdaten where stufe_id = ${stufe}`
    )[0],
  ).toEqual({ treffpunkt: "Pfadiheim", treffpunkt_ort_id: null });

  // Rückweg: Orte und Kennungen entfallen, die Texte bleiben
  await rueckweg();
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await tabelleOrt()).toBe(0);
  expect(await spalten()).toBe(0);
  expect(
    (
      await besitzer`select treffpunkt, schluss_ort from programm_eckdaten where stufe_id = ${stufe}`
    )[0],
  ).toEqual({ treffpunkt: "Pfadiheim", schluss_ort: "Bahnhof" });

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0147 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabelleOrt()).toBe(1);
  expect(await spalten()).toBe(2);
}, 120_000);
