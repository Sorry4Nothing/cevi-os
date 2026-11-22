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

// 0103 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0102 migrieren, dann 0103 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig384c_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig384c-"));
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
  ordnerBauen(bisVorher, 102);
  ordnerBauen(komplett, 103);
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
    await besitzer`select conname from pg_constraint where conname = 'anwesenheit_teilnehmer_fk'`
  ).map((z) => z.conname);

test("0103 räumt verwaiste Einträge ab und ergänzt den Fremdschlüssel auf teilnehmer, der Rückweg nimmt ihn wieder", async () => {
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
  const kind = async (l: string) =>
    (
      await besitzer`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${l}, 'Anna', 'Muster', 1) returning id`
    )[0].id as string;
  const tag = async (l: string) =>
    (
      await besitzer`insert into lagertag (lager_id, datum, lager_seq) values (${l}, '2027-07-10', 1) returning id`
    )[0].id as string;
  const abschnitt = async (l: string) =>
    (
      await besitzer`insert into tagesabschnitt (lager_id, name, lager_seq) values (${l}, 'Vormittag', 1) returning id`
    )[0].id as string;
  const k1 = await kind(eins);
  const k2 = await kind(zwei);
  const t1 = await tag(eins);
  const a1 = await abschnitt(eins);
  const feld = (teilnehmer: string, wert = "A") =>
    besitzer`insert into anwesenheit (lager_id, teilnehmer_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${eins}, ${teilnehmer}, ${t1}, ${a1}, ${wert}, 1)`;
  // Vor 0103 prüfte niemand die IDs: ein gültiger Eintrag, einer mit erfundener ID, einer mit dem Teilnehmenden aus dem anderen Lager, dazu ein Eintrag einer Person (bleibt)
  await feld(k1);
  await feld(randomUUID());
  await feld(k2);
  await besitzer`insert into anwesenheit (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${eins}, ${person.id}, ${t1}, ${a1}, 'A', 2)`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await fremdschluessel()).toHaveLength(1);
  // Nur der gültige Eintrag und der der Person blieben
  expect(await besitzer`select 1 from anwesenheit`).toHaveLength(2);

  // Ein Teilnehmender eines anderen Lagers oder ein erfundener: nicht möglich, auch für die API-Rolle nicht
  await expect(feld(k2, "F")).rejects.toMatchObject({ code: "23503" });
  await expect(feld(randomUUID(), "F")).rejects.toMatchObject({
    code: "23503",
  });

  // Wird der Teilnehmende endgültig gelöscht, gehen seine Einträge mit; der der Person bleibt
  await api`delete from teilnehmer where id = ${k1}`;
  expect(
    await besitzer`select 1 from anwesenheit where teilnehmer_id is not null`,
  ).toHaveLength(0);
  expect(await besitzer`select 1 from anwesenheit`).toHaveLength(1);

  // Rückweg: kein Fremdschlüssel mehr, Journal ohne 0103
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0103_anwesenheit_teilnehmer_fk.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await fremdschluessel()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await fremdschluessel()).toHaveLength(1);
}, 60_000);
