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

// 0085 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0084 migrieren (was davon im Journal steht), dann 0085 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig390_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig390-"));
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
  ordnerBauen(bisVorher, 84);
  ordnerBauen(komplett, 85);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('anwesenheit', 'anwesenheit_anfrage') order by 1`
  ).map((z) => z.table_name);

test("0085 legt die Tabellen und die Frist an, die API-Rolle darf sie nutzen, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["anwesenheit", "anwesenheit_anfrage"]);
  // Bestehende Lager haben keine Frist
  expect(
    (
      await besitzer`select anwesenheit_frist from lager where id = ${lager.id}`
    )[0].anwesenheit_frist,
  ).toBeNull();

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const tag = randomUUID();
  const abschnitt = randomUUID();
  await api`insert into anwesenheit (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${lager.id}, ${person.id}, ${tag}, ${abschnitt}, 'A', 1)`;
  const [zeile] = await api`select * from anwesenheit`;
  expect(zeile).toMatchObject({ wert: "A", version: 1, teilnehmer_id: null });
  expect(zeile.id).toMatch(/^[0-9a-f-]{36}$/);
  // Ein Feld je Person nur einmal; ohne Person und ohne Teilnehmende nicht erlaubt
  await expect(
    api`insert into anwesenheit (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${lager.id}, ${person.id}, ${tag}, ${abschnitt}, 'F', 2)`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into anwesenheit (lager_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${lager.id}, ${tag}, ${abschnitt}, 'A', 3)`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`insert into anwesenheit_anfrage (lager_id, person_id, lagertag_id, tagesabschnitt_id, wert, lager_seq) values (${lager.id}, ${person.id}, ${tag}, ${abschnitt}, 'F', 4)`;
  await api`update lager set anwesenheit_frist = now() where id = ${lager.id}`;

  // Lager und Person nehmen ihre Anwesenheit mit
  await api`delete from lager where id = ${lager.id}`;
  expect(await api`select * from anwesenheit`).toHaveLength(0);
  expect(await api`select * from anwesenheit_anfrage`).toHaveLength(0);

  // Rückweg: Tabellen und Spalte weg, Journal ohne 0085, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0085_lager_anwesenheit.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(
    await besitzer`select 1 from information_schema.columns where table_name = 'lager' and column_name = 'anwesenheit_frist'`,
  ).toHaveLength(0);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0085 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(2);
}, 60_000);
