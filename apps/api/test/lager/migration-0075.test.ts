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

// 0075 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0073 migrieren, dann 0075 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig380_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig380-"));
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
  ordnerBauen(bisVorher, 73);
  ordnerBauen(komplett, 75);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'erwaehnung'`
  ).map((z) => z.table_name);

test("0075 legt erwaehnung an, die API-Rolle darf sie nutzen, CHECK, Eindeutigkeit und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const lager = async (titel: string) =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, ${titel}, '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const person = async () =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const eins = await lager("Eins");
  const zwei = await lager("Zwei");
  const anna = await person();
  const ben = await person();
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${eins}, ${anna}, 'team')`;
  const aufgabeEins = (
    await besitzer`insert into aufgabe (lager_id, titel, lager_seq) values (${eins}, 'A', 1) returning id`
  )[0].id as string;
  const aufgabeZwei = (
    await besitzer`insert into aufgabe (lager_id, titel, lager_seq) values (${zwei}, 'B', 1) returning id`
  )[0].id as string;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["erwaehnung"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const quelle = randomUUID();
  await api`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${eins}, 'pinnwand', ${quelle}, ${anna})`;
  const [e] = await api`select * from erwaehnung`;
  expect(e).toMatchObject({
    quelle_typ: "pinnwand",
    erledigt_am: null,
    aufgabe_id: null,
  });
  expect(e.id).toMatch(/^[0-9a-f-]{36}$/);

  // Eine Person je Inhalt höchstens einmal; derselbe Inhalt für eine andere Art ist ein anderer Eintrag
  await expect(
    api`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${eins}, 'pinnwand', ${quelle}, ${anna})`,
  ).rejects.toMatchObject({ code: "23505" });
  // Art aus der Liste
  await expect(
    api`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${eins}, 'protokoll', ${randomUUID()}, ${anna})`,
  ).rejects.toMatchObject({ code: "23514" });
  // Nur Mitglieder des Lagers (Fremdschlüssel mit Lager)
  await expect(
    api`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${eins}, 'aufgabe', ${randomUUID()}, ${ben})`,
  ).rejects.toMatchObject({ code: "23503" });
  // Die Aufgabe muss zum selben Lager gehören
  await expect(
    api`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id, aufgabe_id) values (${eins}, 'aufgabe', ${randomUUID()}, ${anna}, ${aufgabeZwei})`,
  ).rejects.toMatchObject({ code: "23503" });

  // Wird die Aufgabe endgültig gelöscht, bleibt die Erwähnung ohne sie
  await api`update erwaehnung set aufgabe_id = ${aufgabeEins}`;
  await api`delete from aufgabe where id = ${aufgabeEins}`;
  expect(await api`select aufgabe_id from erwaehnung`).toEqual([
    { aufgabe_id: null },
  ]);

  // Ein entferntes Mitglied nimmt seine Erwähnungen mit, ein gelöschtes Lager alle
  await api`delete from lager_mitglied where lager_id = ${eins} and person_id = ${anna}`;
  expect(await api`select * from erwaehnung`).toHaveLength(0);
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${eins}, ${ben}, 'team')`;
  await api`insert into erwaehnung (lager_id, quelle_typ, quelle_id, person_id) values (${eins}, 'beschluss', ${randomUUID()}, ${ben})`;
  await api`delete from lager where id = ${eins}`;
  expect(await api`select * from erwaehnung`).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0075
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0075_lager_erwaehnungen.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0075 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["erwaehnung"]);
}, 60_000);
