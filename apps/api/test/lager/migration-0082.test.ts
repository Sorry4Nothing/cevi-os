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

// 0082 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0079 migrieren (was davon im Journal steht), dann 0082 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig386_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig386-"));
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
  ordnerBauen(bisVorher, 81);
  // Alles bis 0082: spätere Lager-Migrationen (ab 0083) sind für diesen Test ohne Belang
  ordnerBauen(komplett, 82);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('fahrt', 'fahrt_mitfahrer') order by 1`
  ).map((z) => z.table_name);

test("0082 legt Fahrten und Mitfahrten an, Checks, Teilindizes und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const person = async () =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const [p1, p2, ausserhalb] = [await person(), await person(), await person()];
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];
  for (const [l, p] of [
    [lagerA, p1],
    [lagerA, p2],
    [lagerB, p1],
  ] as const) {
    await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${l}, ${p}, 'team')`;
  }

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["fahrt", "fahrt_mitfahrer"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const fahrt = async (
    lagerId: string,
    werte: Partial<{
      richtung: string;
      art: string;
      fahrer: string | null;
      plaetze: number | null;
      link: string | null;
      zeit: string | null;
      bez: string | null;
      adresse: string | null;
      lat: number | null;
      lon: number | null;
      zielLink: string | null;
    }> = {},
  ) => {
    const w = {
      richtung: "hin",
      art: "auto",
      fahrer: null,
      plaetze: 4,
      link: null,
      zeit: null,
      bez: null,
      adresse: null,
      lat: null,
      lon: null,
      zielLink: null,
      ...werte,
    };
    return (
      await api`insert into fahrt (lager_id, richtung, art, fahrer_person_id, plaetze, link, zeit, ziel_bezeichnung, ziel_adresse, ziel_lat, ziel_lon, ziel_link, lager_seq) values (${lagerId}, ${w.richtung}, ${w.art}, ${w.fahrer}, ${w.plaetze}, ${w.link}, ${w.zeit}, ${w.bez}, ${w.adresse}, ${w.lat}, ${w.lon}, ${w.zielLink}, 1) returning id`
    )[0].id as string;
  };
  const a = await fahrt(lagerA, { fahrer: p1 });
  expect((await api`select * from fahrt where id = ${a}`)[0]).toMatchObject({
    version: 1,
    geloescht_am: null,
    datum: null,
    ziel_lat: null,
  });
  const fehler = (werte: Parameters<typeof fahrt>[1], code: string) =>
    expect(fahrt(lagerA, werte)).rejects.toMatchObject({ code });

  // Richtung und Art, Plätze nur beim Auto, kein Fahrer und kein Platz bei der ÖV-Gruppe, Link nur bei der ÖV-Gruppe
  await fehler({ richtung: "quer" }, "23514");
  await fehler({ art: "zug" }, "23514");
  await fehler({ plaetze: null }, "23514");
  await fehler({ plaetze: 0 }, "23514");
  await fehler({ plaetze: 100 }, "23514");
  await fehler({ link: "https://fahrplan.example.ch/" }, "23514");
  await fehler({ art: "oev", plaetze: 4 }, "23514");
  await fehler({ art: "oev", plaetze: null, fahrer: p2 }, "23514");
  await fahrt(lagerA, {
    art: "oev",
    plaetze: null,
    link: "https://fahrplan.example.ch/v?a=1",
  });
  // Zeit nur als HH:MM, Links nur https ohne Leerraum und Backslash
  await fehler({ zeit: "24:00" }, "23514");
  await fehler({ zeit: "7:30" }, "23514");
  await fahrt(lagerA, { zeit: "23:59", fahrer: p2 });
  for (const link of [
    "http://x.ch/",
    "javascript:alert(1)",
    "https://x.ch/a b",
    "https://x.ch/\\a",
    `https://x.ch/${"a".repeat(2050)}`,
  ]) {
    await fehler({ art: "oev", plaetze: null, link }, "23514");
    await fehler({ bez: "Ort", zielLink: link }, "23514");
  }
  // Der Kartenpunkt: Bereiche, Koordinaten nur zusammen, Bezeichnung nötig, ganz oder gar nicht
  await fehler({ bez: "Ort", lat: 90.5, lon: 8 }, "23514");
  await fehler({ bez: "Ort", lat: 47, lon: -181 }, "23514");
  await fehler({ bez: "Ort", lat: 47 }, "23514");
  await fehler({ bez: "Ort", lon: 8 }, "23514");
  await fehler({ bez: "Ort" }, "23514");
  await fehler({ adresse: "Dorfstrasse 1" }, "23514");
  await fehler({ lat: 47, lon: 8 }, "23514");
  await fehler({ bez: "", adresse: "A" }, "23514");
  await fehler({ bez: "Ort", adresse: "x".repeat(201) }, "23514");
  await fahrt(lagerB, { bez: "Ort", lat: 0, lon: 0 });
  await fahrt(lagerB, { bez: "Pol", lat: -90, lon: 180 });
  await fahrt(lagerB, {
    bez: "Karte",
    zielLink: "https://maps.example.ch/?q=x",
  });
  await fahrt(lagerB, { bez: "Adresse", adresse: "Dorfstrasse 1" });

  // Ein Fahrer fährt je Richtung höchstens eine Fahrt; nach Soft-Delete und in der anderen Richtung ist er frei
  await fehler({ fahrer: p1 }, "23505");
  await fahrt(lagerA, { fahrer: p1, richtung: "rueck" });
  await api`update fahrt set geloescht_am = now() where id = ${a}`;
  await fahrt(lagerA, { fahrer: p1 });
  // Der Fahrer muss Mitglied dieses Lagers sein (Fremdschlüssel über Lager und Person)
  await fehler({ fahrer: ausserhalb, richtung: "rueck" }, "23503");
  await expect(fahrt(lagerB, { fahrer: p2 })).rejects.toMatchObject({
    code: "23503",
  });

  // Mitfahrende: genau eines von person_id und teilnehmer_id, Richtung der Fahrt, je Richtung einmal
  const kind = async (lagerId: string) =>
    (
      await api`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${lagerId}, 'Anna', 'Muster', 1) returning id`
    )[0].id as string;
  const f1 = await fahrt(lagerA, { art: "oev", plaetze: null });
  const f2 = await fahrt(lagerA, { art: "oev", plaetze: null });
  const r1 = await fahrt(lagerA, {
    art: "oev",
    plaetze: null,
    richtung: "rueck",
  });
  const mit = (
    lagerId: string,
    fahrtId: string,
    richtung: string,
    personId: string | null,
    teilnehmerId: string | null,
  ) =>
    api`insert into fahrt_mitfahrer (lager_id, fahrt_id, richtung, person_id, teilnehmer_id, lager_seq) values (${lagerId}, ${fahrtId}, ${richtung}, ${personId}, ${teilnehmerId}, 2)`;
  const t = await kind(lagerA);
  await mit(lagerA, f1, "hin", p2, null);
  await mit(lagerA, f1, "hin", null, t);
  await expect(mit(lagerA, f2, "hin", p2, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(mit(lagerA, f2, "hin", null, t)).rejects.toMatchObject({
    code: "23505",
  });
  await mit(lagerA, r1, "rueck", p2, null);
  await expect(mit(lagerA, f2, "hin", null, null)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(mit(lagerA, f2, "hin", p1, t)).rejects.toMatchObject({
    code: "23514",
  });
  // Die Richtung muss die der Fahrt sein, die Fahrt zum Lager gehören, die Person Mitglied, der Teilnehmende aus diesem Lager
  await expect(mit(lagerA, f2, "rueck", p1, null)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(mit(lagerB, f2, "hin", p1, null)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(mit(lagerA, f2, "hin", ausserhalb, null)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(
    mit(lagerA, f2, "hin", null, await kind(lagerB)),
  ).rejects.toMatchObject({ code: "23503" });
  // Nach Soft-Delete ist der Platz wieder frei
  await api`update fahrt_mitfahrer set geloescht_am = now() where fahrt_id = ${f1} and person_id = ${p2}`;
  await mit(lagerA, f2, "hin", p2, null);

  // Fällt ein Mitglied weg: Die Mitfahrt geht mit, bei einem Fahrer bleibt die Fahrt ohne Fahrer (das Lager bleibt gesetzt)
  const fahrerFahrt = await fahrt(lagerB, { fahrer: p1 });
  await api`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p2}`;
  expect(
    await api`select 1 from fahrt_mitfahrer where person_id = ${p2} and lager_id = ${lagerA}`,
  ).toHaveLength(0);
  await api`delete from lager_mitglied where lager_id = ${lagerB} and person_id = ${p1}`;
  expect(
    (
      await api`select lager_id, fahrer_person_id from fahrt where id = ${fahrerFahrt}`
    )[0],
  ).toEqual({ lager_id: lagerB, fahrer_person_id: null });
  // Fällt der Teilnehmende weg, geht seine Mitfahrt mit; fällt die Fahrt weg, gehen ihre Mitfahrten mit
  await api`delete from teilnehmer where id = ${t}`;
  expect(
    await api`select 1 from fahrt_mitfahrer where teilnehmer_id = ${t}`,
  ).toHaveLength(0);
  await api`delete from fahrt where id = ${f2}`;
  expect(
    await api`select 1 from fahrt_mitfahrer where fahrt_id = ${f2}`,
  ).toHaveLength(0);
  // Das Lager nimmt alles mit
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select 1 from fahrt where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Es gibt keine Spalte für Gesundheit, Telefon oder Adresse einer Person
  const spalten = (
    await besitzer`select column_name from information_schema.columns where table_name = 'fahrt_mitfahrer' order by 1`
  ).map((z) => z.column_name);
  expect(spalten).toEqual([
    "erstellt_am",
    "erstellt_von",
    "fahrt_id",
    "geaendert_am",
    "geaendert_von",
    "geloescht_am",
    "geloescht_von",
    "id",
    "lager_id",
    "lager_seq",
    "person_id",
    "richtung",
    "teilnehmer_id",
    "version",
  ]);

  // Rückweg: Tabellen weg, Journal ohne 0082
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0082_lager_fahrten.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0082 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["fahrt", "fahrt_mitfahrer"]);
}, 60_000);
