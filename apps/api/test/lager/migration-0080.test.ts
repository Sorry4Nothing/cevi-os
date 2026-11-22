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

// 0080 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0079 migrieren (was davon im Journal steht), dann 0080 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig385_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig385-"));
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
  ordnerBauen(bisVorher, 79);
  // Alles bis 0080: spätere Lager-Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 80);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('zimmer', 'zimmer_zuordnung') order by 1`
  ).map((z) => z.table_name);

test("0080 legt Zimmer und Zuordnungen an, Checks, Einmaligkeit und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
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
  expect(await tabellen()).toEqual(["zimmer", "zimmer_zuordnung"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const raum = async (
    lagerId: string,
    name = "Zimmer",
    art = "zimmer",
    plaetze = 4,
    notiz: string | null = null,
  ) =>
    (
      await api`insert into zimmer (lager_id, name, art, plaetze, notiz, lager_seq) values (${lagerId}, ${name}, ${art}, ${plaetze}, ${notiz}, 1) returning id`
    )[0].id as string;
  const kind = async (lagerId: string) =>
    (
      await api`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${lagerId}, 'Anna', 'Muster', 1) returning id`
    )[0].id as string;
  const z = await raum(lagerA);
  expect((await api`select * from zimmer where id = ${z}`)[0]).toMatchObject({
    version: 1,
    geloescht_am: null,
    notiz: null,
    reihenfolge: 0,
  });
  // Grenzen: Name, Art, Plätze, Notiz
  for (const args of [
    [lagerA, "", "zimmer", 4],
    [lagerA, "x".repeat(101), "zimmer", 4],
    [lagerA, "A", "huette", 4],
    [lagerA, "A", "zimmer", 0],
    [lagerA, "A", "zimmer", 1001],
    [lagerA, "A", "zimmer", 4, ""],
    [lagerA, "A", "zimmer", 4, "x".repeat(501)],
  ] as const) {
    await expect(
      raum(...(args as unknown as Parameters<typeof raum>)),
    ).rejects.toMatchObject({ code: "23514" });
  }
  await raum(lagerA, "Zelt", "zelt", 1000, "x".repeat(500));

  // Zuordnung: genau eines von teilnehmer_id und person_id, ein Zimmer je Ziel
  const zuordnung = (
    lagerId: string,
    zimmerId: string,
    teilnehmerId: string | null,
    personId: string | null,
  ) =>
    api`insert into zimmer_zuordnung (lager_id, zimmer_id, teilnehmer_id, person_id, lager_seq) values (${lagerId}, ${zimmerId}, ${teilnehmerId}, ${personId}, 2)`;
  const z2 = await raum(lagerA, "Zwei");
  const a = await kind(lagerA);
  await zuordnung(lagerA, z, a, null);
  await zuordnung(lagerA, z, null, person.id);
  await expect(zuordnung(lagerA, z2, a, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(zuordnung(lagerA, z2, null, person.id)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(zuordnung(lagerA, z, null, null)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(zuordnung(lagerA, z, a, person.id)).rejects.toMatchObject({
    code: "23514",
  });
  // Ein Zimmer oder Teilnehmender eines anderen Lagers: Fremdschlüssel über Lager und ID
  await expect(zuordnung(lagerB, z, null, person.id)).rejects.toMatchObject({
    code: "23503",
  });
  const b = await kind(lagerB);
  await expect(zuordnung(lagerA, z2, b, null)).rejects.toMatchObject({
    code: "23503",
  });
  // Nach Soft-Delete ist der Platz wieder frei
  await api`update zimmer_zuordnung set geloescht_am = now() where teilnehmer_id = ${a}`;
  await zuordnung(lagerA, z2, a, null);

  // Löschen der Teilnehmenden nimmt ihre Zuordnungen mit, die der Person bleiben
  await api`delete from teilnehmer where id = ${a}`;
  expect(
    (await api`select teilnehmer_id from zimmer_zuordnung`).map(
      (r) => r.teilnehmer_id,
    ),
  ).toEqual([null]);
  // Löschen des Zimmers nimmt seine Zuordnungen mit
  await api`delete from zimmer where id = ${z}`;
  expect(await api`select * from zimmer_zuordnung`).toHaveLength(0);
  // Das Lager nimmt alles mit
  await raum(lagerB);
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from zimmer where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0080
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0080_lager_zimmer.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0080 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["zimmer", "zimmer_zuordnung"]);
}, 60_000);
