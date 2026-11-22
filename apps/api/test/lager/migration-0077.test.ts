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

// 0077 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0076 migrieren, dann 0077 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig382_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig382-"));
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
  ordnerBauen(bisVorher, 76);
  ordnerBauen(komplett, 77);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'umfrage%' or table_name = 'reaktion') order by 1`
  ).map((z) => z.table_name);

test("0077 legt Umfragen und Reaktionen an, Fremdschlüssel, CHECKs und Einmaligkeit halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const person = async () =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const [p1, p2, p3] = [await person(), await person(), await person()];
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];
  const beitrag = async (lagerId: string) =>
    (
      await besitzer`insert into pinnwand_beitrag (lager_id, titel, lager_seq) values (${lagerId}, 'Frage', 1) returning id`
    )[0].id as string;
  const [bA, bB] = [await beitrag(lagerA), await beitrag(lagerB)];

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "reaktion",
    "umfrage",
    "umfrage_option",
    "umfrage_stimme",
  ]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const umfrage = async (lagerId: string, beitragId: string) =>
    (
      await api`insert into umfrage (lager_id, beitrag_id, lager_seq) values (${lagerId}, ${beitragId}, 2) returning id`
    )[0].id as string;
  const u = await umfrage(lagerA, bA);
  expect((await api`select * from umfrage where id = ${u}`)[0]).toMatchObject({
    version: 1,
    mehrfach: false,
    schliesst_am: null,
    geschlossen: false,
    namen_fuer_team: false,
    geloescht_am: null,
  });
  // Eine aktive Umfrage je Beitrag; nach dem Soft-Delete wieder eine; nur für einen Beitrag desselben Lagers
  await expect(umfrage(lagerA, bA)).rejects.toMatchObject({ code: "23505" });
  await expect(umfrage(lagerA, bB)).rejects.toMatchObject({ code: "23503" });
  await api`update umfrage set geloescht_am = now() where id = ${u}`;
  const u2 = await umfrage(lagerA, bA);

  // Optionen: 1 bis 200 Zeichen, nicht negative Reihenfolge, nur in einer Umfrage desselben Lagers
  const option = (lagerId: string, umfrageId: string, text = "Ja") =>
    api`insert into umfrage_option (lager_id, umfrage_id, text, lager_seq) values (${lagerId}, ${umfrageId}, ${text}, 3) returning id`;
  const [o1] = await option(lagerA, u2);
  await expect(option(lagerA, u2, "")).rejects.toMatchObject({ code: "23514" });
  await expect(option(lagerA, u2, "x".repeat(201))).rejects.toMatchObject({
    code: "23514",
  });
  await expect(option(lagerB, u2)).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`update umfrage_option set reihenfolge = -1 where id = ${o1.id}`,
  ).rejects.toMatchObject({ code: "23514" });

  // Stimmen: eine aktive Zeile je Antwort und Person, nach dem Zurückziehen wieder möglich; Antwort und Umfrage im selben Lager
  const stimme = (lagerId: string, personId: string) =>
    api`insert into umfrage_stimme (lager_id, umfrage_id, option_id, person_id, lager_seq) values (${lagerId}, ${u2}, ${o1.id}, ${personId}, 4) returning id`;
  const [s1] = await stimme(lagerA, p1);
  await stimme(lagerA, p2);
  await expect(stimme(lagerA, p1)).rejects.toMatchObject({ code: "23505" });
  await expect(stimme(lagerB, p3)).rejects.toMatchObject({ code: "23503" });
  await api`update umfrage_stimme set geloescht_am = now() where id = ${s1.id}`;
  await stimme(lagerA, p1);

  // Reaktionen: Schlüssel und Ziel-Typ aus der Allowlist, eine aktive Zeile je Person und Ziel
  const reaktion = (emoji: string, zielTyp = "pinnwand_beitrag") =>
    api`insert into reaktion (lager_id, ziel_typ, ziel_id, person_id, emoji, lager_seq) values (${lagerA}, ${zielTyp}, ${bA}, ${p1}, ${emoji}, 5) returning id`;
  const [r1] = await reaktion("daumen");
  await expect(reaktion("herz")).rejects.toMatchObject({ code: "23505" });
  await expect(reaktion("\u{1F44D}")).rejects.toMatchObject({ code: "23514" });
  await expect(reaktion("herz", "aufgabe")).rejects.toMatchObject({
    code: "23514",
  });
  await api`update reaktion set geloescht_am = now() where id = ${r1.id}`;
  await reaktion("herz");

  // Das Konto nimmt seine Stimmen mit, das Löschen des Beitrags Umfrage, Optionen und Stimmen
  await besitzer`delete from "user" where id = ${p2}`;
  expect(
    await api`select 1 from umfrage_stimme where person_id = ${p2}`,
  ).toHaveLength(0);
  await api`delete from pinnwand_beitrag where id = ${bA}`;
  for (const t of ["umfrage", "umfrage_option", "umfrage_stimme"]) {
    expect(await api.unsafe(`select 1 from ${t}`)).toHaveLength(0);
  }

  // Rückweg: Tabellen weg, Journal ohne 0077, die Beiträge bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0077_lager_umfragen.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select 1 from pinnwand_beitrag`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0077 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(4);
}, 60_000);
