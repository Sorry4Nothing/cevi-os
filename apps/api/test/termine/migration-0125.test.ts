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

// 0125 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0124 migrieren, dann 0125 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig446_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig446-"));
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
  ordnerBauen(bisVorher, 124);
  ordnerBauen(komplett, 125);
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
const hatRaum = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'raum'`
  )[0].n === 1;

test("0125 legt raum an, die Regeln der Datenbank halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await hatRaum()).toBe(false);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [team] =
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung.id}, 'team', 'Hausteam', 'H') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await hatRaum()).toBe(true);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest; die Vorgaben stimmen
  const einfuegen = (
    name: string,
    ort: string | null,
    kapazitaet: number | null,
  ) =>
    api`insert into raum (abteilung_id, name, ort, kapazitaet, team_tag_id) values (${abteilung.id}, ${name}, ${ort}, ${kapazitaet}, ${team.id}) returning *`;
  const [raum] = await einfuegen("Saal", "Pfarrhaus", 30);
  expect(raum).toMatchObject({ aktiv: true, beschreibung: null });

  // Der Name ist je Abteilung ohne Gross-/Kleinschreibung eindeutig; Längen und Kapazität sind geprüft
  await expect(einfuegen("SAAL", null, null)).rejects.toMatchObject({
    code: "23505",
  });
  for (const [name, ort, kap] of [
    ["", null, null],
    ["x".repeat(101), null, null],
    ["Zwei", "", null],
    ["Drei", null, 0],
    ["Vier", null, 1001],
  ] as const) {
    await expect(einfuegen(name, ort, kap)).rejects.toMatchObject({
      code: "23514",
    });
  }

  // Fällt der Tag des Teams weg, bleibt der Raum ohne Team; die Abteilung hält ihre Räume fest (restrict)
  await besitzer`delete from tag where id = ${team.id}`;
  expect(
    (await besitzer`select team_tag_id from raum where id = ${raum.id}`)[0]
      .team_tag_id,
  ).toBeNull();
  await expect(
    besitzer`delete from abteilung where id = ${abteilung.id}`,
  ).rejects.toMatchObject({ code: "23001" });

  // Rückweg: Tabelle weg, Journal ohne 0125
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0125_raum.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await hatRaum()).toBe(false);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0125 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await hatRaum()).toBe(true);
}, 90_000);
