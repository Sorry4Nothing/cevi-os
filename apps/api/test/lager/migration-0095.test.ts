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

// 0095 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0094 migrieren (mit 0070 und 0085), dann 0095 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig374b_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig374b-"));
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
  ordnerBauen(bisVorher, 94);
  ordnerBauen(komplett, 95);
});

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
}, 60_000);

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const fremdschluessel = async () =>
  (
    await besitzer`select conname from pg_constraint where conname in ('anwesenheit_lagertag_fk', 'anwesenheit_abschnitt_fk', 'anwesenheit_anfrage_lagertag_fk', 'anwesenheit_anfrage_abschnitt_fk') order by 1`
  ).map((z) => z.conname);

test("0095 räumt verwaiste Einträge ab und ergänzt die Fremdschlüssel mit Lager, der Rückweg nimmt sie wieder", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await fremdschluessel()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const eins = await lager();
  const zwei = await lager();
  const tag = async (l: string) =>
    (
      await besitzer`insert into lagertag (lager_id, datum, lager_seq) values (${l}, '2027-07-10', 1) returning id`
    )[0].id as string;
  const abschnitt = async (l: string) =>
    (
      await besitzer`insert into tagesabschnitt (lager_id, name, lager_seq) values (${l}, 'Vormittag', 1) returning id`
    )[0].id as string;
  const t1 = await tag(eins);
  const a1 = await abschnitt(eins);
  const t2 = await tag(zwei);
  const a2 = await abschnitt(zwei);
  const feld = (l: string, t: string, a: string, wert = "A") =>
    besitzer`insert into anwesenheit (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${l}, ${person.id}, ${t}, ${a}, ${wert}, 1)`;
  // Vor 0095 prüfte niemand die IDs: ein gültiges Feld, eines mit erfundenen IDs, eines mit dem Tag aus dem anderen Lager
  await feld(eins, t1, a1);
  await feld(eins, randomUUID(), randomUUID());
  await feld(eins, t2, a1, "F");
  await besitzer`insert into anwesenheit_anfrage (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${eins}, ${person.id}, ${t1}, ${a1}, 'F', 4)`;
  await besitzer`insert into anwesenheit_anfrage (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${eins}, ${person.id}, ${randomUUID()}, ${a1}, 'F', 5)`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await fremdschluessel()).toHaveLength(4);
  // Nur die gültigen Einträge blieben
  expect(await besitzer`select 1 from anwesenheit`).toHaveLength(1);
  expect(await besitzer`select 1 from anwesenheit_anfrage`).toHaveLength(1);

  // Tag oder Abschnitt aus einem anderen Lager: nicht möglich, auch für die API-Rolle nicht
  await expect(feld(eins, t2, a1, "F")).rejects.toMatchObject({
    code: "23503",
  });
  await expect(feld(eins, t1, a2, "F")).rejects.toMatchObject({
    code: "23503",
  });
  await expect(
    api`insert into anwesenheit_anfrage (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${eins}, ${person.id}, ${t1}, ${a2}, 'A', 9)`,
  ).rejects.toMatchObject({ code: "23503" });

  // Fällt ein Abschnitt endgültig weg, gehen seine Einträge mit
  await api`delete from tagesabschnitt where id = ${a1}`;
  expect(await besitzer`select 1 from anwesenheit`).toHaveLength(0);
  expect(await besitzer`select 1 from anwesenheit_anfrage`).toHaveLength(0);

  // Rückweg: keine Fremdschlüssel mehr, Journal ohne 0095
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0095_lager_anwesenheit_zeitplan.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await fremdschluessel()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await fremdschluessel()).toHaveLength(4);
}, 60_000);
