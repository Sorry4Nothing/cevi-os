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

// 0099 (#427, endgültiges Löschen) und ihr Rückweg gegen eine eigene Datenbank: erst bis 0098 migrieren, Daten mit weich gelöschten Zeilen anlegen, dann 0099 durch den echten Migrator mit der Besitzerrolle, dann der Rückweg und erneut vorwärts
const dbName = `cevi_os_mig427_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig427-"));
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
  ordnerBauen(bisVorher, 98);
  ordnerBauen(komplett, 99);
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
  )[0]!.n as number;
const spaltenMitGeloescht = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name in ('geloescht_am', 'geloescht_von')`
  )[0]!.n as number;
const indexDef = async (name: string) =>
  (await besitzer`select indexdef from pg_indexes where indexname = ${name}`)[0]
    ?.indexdef as string | undefined;
const zahl = async (tabelle: string, bedingung = "true") =>
  (
    await besitzer.unsafe(
      `select count(*)::int as n from "${tabelle}" where ${bedingung}`,
    )
  )[0]!.n as number;

test("0099 löscht weich gelöschte Zeilen endgültig, entfernt die Spalten und Teilindizes; der Rückweg stellt nur die Struktur her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  // Die Lager-Tabellen tragen je zwei Spalten; andere Module haben eigene «geloescht»-Spalten, die bleiben
  const spalten = await spaltenMitGeloescht();
  expect(spalten).toBeGreaterThanOrEqual(84);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung!.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;
  const l = lager!.id as string;
  const [person] =
    await besitzer`insert into "user" (name, email, username, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${`mig.${randomUUID().slice(0, 8)}`}, ${abteilung!.id}) returning id`;
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${l}, ${person!.id}, 'lagerleitung')`;

  // Ressort: das Kürzel «LOG» war beim gelöschten frei für ein neues
  await besitzer`insert into ressort (lager_id, kuerzel, name, lager_seq, geloescht_am) values (${l}, 'LOG', 'Alt', 1, now())`;
  await besitzer`insert into ressort (lager_id, kuerzel, name, lager_seq) values (${l}, 'LOG', 'Neu', 2)`;
  // Aufgabe: eine lebende mit Checkpunkt, eine gelöschte mit Checkpunkt (geht mit) und Erwähnungen beider
  const [lebt] =
    await besitzer`insert into aufgabe (lager_id, titel, lager_seq) values (${l}, 'lebt', 3) returning id`;
  const [weg] =
    await besitzer`insert into aufgabe (lager_id, titel, lager_seq, geloescht_am) values (${l}, 'weg', 4, now()) returning id`;
  await besitzer`insert into aufgabe_checkpunkt (lager_id, aufgabe_id, text, lager_seq) values (${l}, ${lebt!.id}, 'bleibt', 5)`;
  await besitzer`insert into aufgabe_checkpunkt (lager_id, aufgabe_id, text, lager_seq) values (${l}, ${weg!.id}, 'geht mit', 6)`;
  await besitzer`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${l}, 'aufgabe', ${lebt!.id}, ${person!.id})`;
  await besitzer`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${l}, 'aufgabe', ${weg!.id}, ${person!.id})`;
  // Meilenstein, gelöscht, mit einer Aufgabe, die noch auf ihn zeigt: Sie behält ihre Frist als festes Datum
  const [meilenstein] =
    await besitzer`insert into meilenstein (lager_id, titel, datum, lager_seq, geloescht_am) values (${l}, 'M', '2027-07-12', 7, now()) returning id`;
  await besitzer`insert into aufgabe (lager_id, titel, lager_seq, frist, frist_meilenstein_id, frist_versatz_tage) values (${l}, 'am Meilenstein', 8, '2027-07-14', ${meilenstein!.id}, 2)`;
  // Höck: gelöscht, mit einem Protokoll und einem Beschluss, die mit ihm gehen; ein Protokoll mit Beschluss, das gelöscht ist (der Beschluss bleibt ohne Verweis)
  const datei = async (name: string, geloescht = false) =>
    (
      await besitzer`insert into lager_datei (lager_id, anzeigename, link, lager_seq, geloescht_am) values (${l}, ${name}, 'https://cevi.sharepoint.com/x.pdf', 9, ${geloescht ? new Date().toISOString() : null}) returning id`
    )[0]!.id as string;
  const [hoeck] =
    await besitzer`insert into hoeck (lager_id, art, datum, titel, lager_seq, geloescht_am) values (${l}, 'lagerleitung', '2027-07-11', 'H', 10, now()) returning id`;
  const [protokollImHoeck] =
    await besitzer`insert into protokoll (lager_id, art, titel, datum, hoeck_id, datei_id, lager_seq) values (${l}, 'sitzung', 'P1', '2027-07-11', ${hoeck!.id}, ${await datei("p1")}, 11) returning id`;
  await besitzer`insert into beschluss (lager_id, text, protokoll_id, hoeck_id, lager_seq) values (${l}, 'B1', ${protokollImHoeck!.id}, ${hoeck!.id}, 12)`;
  const [geloeschtesProtokoll] =
    await besitzer`insert into protokoll (lager_id, art, titel, datum, datei_id, lager_seq, geloescht_am) values (${l}, 'notiz', 'P2', '2027-07-11', ${await datei("p2")}, 13, now()) returning id`;
  await besitzer`insert into beschluss (lager_id, text, protokoll_id, lager_seq) values (${l}, 'B2', ${geloeschtesProtokoll!.id}, 14)`;
  // Datei: gelöscht, ein lebendes Dokument darauf geht mit (es war schon unsichtbar)
  const geloeschteDatei = await datei("weg.pdf", true);
  await besitzer`insert into dokument (lager_id, titel, stichworte, datei_id, lager_seq) values (${l}, 'Dok', ${[]}, ${geloeschteDatei}, 15)`;
  const lebendeDatei = await datei("bleibt.pdf");
  await besitzer`insert into dokument (lager_id, titel, stichworte, datei_id, lager_seq) values (${l}, 'Dok2', ${[]}, ${lebendeDatei}, 16)`;
  // Gruppe: lebt, Zuordnung gelöscht
  const [gruppe] =
    await besitzer`insert into gruppe (lager_id, name, lager_seq) values (${l}, 'G', 17) returning id`;
  const [teilnehmer] =
    await besitzer`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${l}, 'Kind', 'Eins', 18) returning id`;
  await besitzer`insert into gruppe_zuordnung (lager_id, gruppe_id, teilnehmer_id, rolle, lager_seq, geloescht_am) values (${l}, ${gruppe!.id}, ${teilnehmer!.id}, 'mitglied', 19, now())`;
  // Reaktion auf einen Beitrag, den es nicht gibt (zum Beispiel weil er gelöscht war): geht weg
  await besitzer`insert into reaktion (lager_id, ziel_typ, ziel_id, person_id, emoji, lager_seq) values (${l}, 'pinnwand_beitrag', ${randomUUID()}, ${person!.id}, 'herz', 20)`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);

  // 42 Tabellen mal zwei Spalten sind weg
  expect(await spaltenMitGeloescht()).toBe(spalten - 84);
  // Weich gelöschte Zeilen sind weg, die lebenden bleiben
  expect(
    (await besitzer`select name from ressort where lager_id = ${l}`).map(
      (z) => z.name,
    ),
  ).toEqual(["Neu"]);
  expect(
    (
      await besitzer`select titel from aufgabe where lager_id = ${l} order by titel`
    ).map((z) => z.titel),
  ).toEqual(["am Meilenstein", "lebt"]);
  expect(
    (await besitzer`select text from aufgabe_checkpunkt`).map((z) => z.text),
  ).toEqual(["bleibt"]);
  expect(await zahl("meilenstein")).toBe(0);
  // Die Aufgabe am gelöschten Meilenstein behält ihre Frist als festes Datum
  expect(
    (
      await besitzer`select frist::text as frist, frist_meilenstein_id, frist_versatz_tage from aufgabe where titel = 'am Meilenstein'`
    )[0],
  ).toEqual({
    frist: "2027-07-14",
    frist_meilenstein_id: null,
    frist_versatz_tage: null,
  });
  // Höck mit Protokoll und Beschluss weg; das gelöschte Protokoll ist weg, sein Beschluss bleibt ohne Verweis
  expect(await zahl("hoeck")).toBe(0);
  expect(await zahl("protokoll")).toBe(0);
  expect(
    (await besitzer`select text, protokoll_id from beschluss`).map((z) => [
      z.text,
      z.protokoll_id,
    ]),
  ).toEqual([["B2", null]]);
  // Die gelöschte Datei und ihr Dokument sind weg, die lebende bleibt
  expect(
    (await besitzer`select titel from dokument`).map((z) => z.titel),
  ).toEqual(["Dok2"]);
  expect(await zahl("lager_datei", `id = '${geloeschteDatei}'`)).toBe(0);
  expect(await zahl("lager_datei", `id = '${lebendeDatei}'`)).toBe(1);
  expect(await zahl("gruppe")).toBe(1);
  expect(await zahl("gruppe_zuordnung")).toBe(0);
  // Erwähnungen und Reaktionen ohne Inhalt sind weg
  expect(
    (await besitzer`select quelle_id from erwaehnung`).map((z) => z.quelle_id),
  ).toEqual([lebt!.id]);
  expect(await zahl("reaktion")).toBe(0);

  // Die Teilindizes sind normale Indizes; das Kürzel ist jetzt für jede Zeile einmalig
  expect(await indexDef("ressort_kuerzel_uq")).not.toMatch(/WHERE/i);
  expect(await indexDef("gruppe_zuordnung_person_uq")).toMatch(
    /WHERE \(?person_id IS NOT NULL\)?$/,
  );
  expect(await indexDef("gruppe_zuordnung_person_uq")).not.toMatch(/geloescht/);
  expect(await indexDef("aufgabe_erinnerung_idx")).not.toMatch(/geloescht/);
  await expect(
    besitzer`insert into ressort (lager_id, kuerzel, name, lager_seq) values (${l}, 'log', 'Doppelt', 99)`,
  ).rejects.toMatchObject({ code: "23505" });
  // Der Fremdschlüssel des Beschlusses leert den Verweis, wenn das Protokoll geht
  const [p3] =
    await besitzer`insert into protokoll (lager_id, art, titel, datum, datei_id, lager_seq) values (${l}, 'notiz', 'P3', '2027-07-11', ${lebendeDatei}, 21) returning id`;
  await besitzer`insert into beschluss (lager_id, text, protokoll_id, lager_seq) values (${l}, 'B3', ${p3!.id}, 22)`;
  await besitzer`delete from protokoll where id = ${p3!.id}`;
  expect(
    (await besitzer`select protokoll_id from beschluss where text = 'B3'`)[0]!
      .protokoll_id,
  ).toBeNull();

  // Rückweg: Spalten und Teilindizes sind da, leer; die gelöschten Daten kommen nicht zurück; Journal ohne 0099
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0099_lager_endgueltig_loeschen.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await spaltenMitGeloescht()).toBe(spalten);
  expect(await zahl("aufgabe", "geloescht_am is not null")).toBe(0);
  expect(await zahl("aufgabe")).toBe(2);
  expect(await indexDef("ressort_kuerzel_uq")).toMatch(/WHERE/i);
  expect(await indexDef("ressort_kuerzel_uq")).toMatch(/geloescht_am/);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0099 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spaltenMitGeloescht()).toBe(spalten - 84);
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await zahl("aufgabe")).toBe(2);
}, 120_000);
