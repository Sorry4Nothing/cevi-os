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

// 0123 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0122 migrieren (was davon im Journal steht), dann 0123 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig442_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig442-"));
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
  ordnerBauen(bisVorher, 122);
  ordnerBauen(komplett, 123);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'anlass%' order by 1`
  ).map((z) => z.table_name);

test("0123 legt Anlass und Zusatzfelder an, die Regeln der Datenbank halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [termin] =
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende) values (${abteilung.id}, 'ev', 'Fest', false, '2027-09-04T12:00Z', '2027-09-04T14:00Z') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["anlass", "anlass_feld"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest; die Vorgaben stimmen
  const [anlass] = await api`
    insert into anlass (abteilung_id, programm_id, anmeldung_fuer, sichtbarkeit)
    values (${abteilung.id}, ${termin.id}, 'kind', 'angemeldet') returning *`;
  expect(anlass).toMatchObject({
    art: "anlass",
    anmeldung_offen: false,
    frist: null,
    sichtbarkeit_tags: [],
    seite_id: null,
  });
  // Ein Termin hat höchstens einen Anlass; Art, Anmeldung für und Sichtbarkeit sind geprüft
  await expect(
    api`insert into anlass (abteilung_id, programm_id, anmeldung_fuer, sichtbarkeit) values (${abteilung.id}, ${termin.id}, 'kind', 'angemeldet')`,
  ).rejects.toMatchObject({ code: "23505" });
  const [zweiter] =
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende) values (${abteilung.id}, 'ev2', 'Zwei', false, '2027-09-05T12:00Z', '2027-09-05T14:00Z') returning id`;
  for (const [art, fuer, sicht] of [
    ["sonst", "kind", "angemeldet"],
    ["anlass", "alle", "angemeldet"],
    ["anlass", "kind", "geheim"],
  ]) {
    await expect(
      api`insert into anlass (abteilung_id, programm_id, art, anmeldung_fuer, sichtbarkeit) values (${abteilung.id}, ${zweiter.id}, ${art}, ${fuer}, ${sicht})`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  await api`insert into anlass (abteilung_id, programm_id, art, anmeldung_fuer, sichtbarkeit) values (${abteilung.id}, ${zweiter.id}, 'lager', 'person', 'oeffentlich')`;

  // Felder: Schlüssel eindeutig und a-z0-9_, Auswahl mit 2 bis 20 Optionen, sonst keine
  const feld = (
    schluessel: string,
    typ: string,
    optionen: string[],
    reihenfolge = 0,
  ) => api`
    insert into anlass_feld (anlass_id, schluessel, beschriftung, typ, optionen, reihenfolge)
    values (${anlass.id}, ${schluessel}, 'Frage', ${typ}, ${optionen}, ${reihenfolge})`;
  await feld("essen", "auswahl", ["A", "B"]);
  await expect(feld("essen", "text", [])).rejects.toMatchObject({
    code: "23505",
  });
  await expect(feld("Gross", "text", [])).rejects.toMatchObject({
    code: "23514",
  });
  await expect(feld("a", "auswahl", ["nur eine"])).rejects.toMatchObject({
    code: "23514",
  });
  await expect(feld("b", "text", ["A", "B"])).rejects.toMatchObject({
    code: "23514",
  });
  await expect(feld("c", "zahl", [])).rejects.toMatchObject({
    code: "23514",
  });
  await expect(feld("d", "text", [], 20)).rejects.toMatchObject({
    code: "23514",
  });

  // Fällt der Termin weg, fällt sein Anlass mit den Feldern; die Abteilung hält ihre Anlässe fest (restrict)
  await expect(
    besitzer`delete from abteilung where id = ${abteilung.id}`,
  ).rejects.toMatchObject({ code: "23001" });
  await besitzer`delete from programm where id = ${termin.id}`;
  expect(await besitzer`select * from anlass_feld`).toHaveLength(0);
  expect(await besitzer`select * from anlass`).toHaveLength(1);

  // Rückweg: Tabellen weg, Journal ohne 0123, der Termin bleibt
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0123_anlass.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(
    await besitzer`select id from programm where id = ${zweiter.id}`,
  ).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0123 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["anlass", "anlass_feld"]);
}, 90_000);
