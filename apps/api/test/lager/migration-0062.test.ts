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

// 0062 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0060 migrieren (mit einem bestehenden Lager), dann 0062 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig366_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig366-"));
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
  ordnerBauen(bisVorher, 60);
  ordnerBauen(komplett, 62);
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
const hatFeed = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'lager_aenderung'`
  )[0].n === 1;
const seqSpalten = async () =>
  (
    await besitzer`select column_name from information_schema.columns where table_name = 'lager' and column_name in ('seq', 'seq_min') order by 1`
  ).map((z) => z.column_name);

test("0062 ergänzt die Folgenummer und den Feed, die API-Rolle darf ihn nutzen, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await hatFeed()).toBe(false);
  expect(await seqSpalten()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [bestehend] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Bestehend', '2027-07-10', '2027-07-24') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await hatFeed()).toBe(true);
  expect(await seqSpalten()).toEqual(["seq", "seq_min"]);
  // Ein bestehendes Lager beginnt bei Folgenummer 0, der Feed bei 1
  expect(
    (await api`select seq, seq_min from lager where id = ${bestehend.id}`)[0],
  ).toEqual({ seq: "0", seq_min: "1" });

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest den Feed
  const zeile = randomUUID();
  await api`insert into lager_aenderung (lager_id, seq, tabelle, zeile_id, art, version) values (${bestehend.id}, 1, 'aufgabe', ${zeile}, 'neu', 1)`;
  const [eintrag] =
    await api`select * from lager_aenderung where lager_id = ${bestehend.id}`;
  expect(eintrag).toMatchObject({ seq: "1", tabelle: "aufgabe", art: "neu" });
  expect(eintrag.zeitpunkt).toBeInstanceOf(Date);

  // Die Datenbank hält die Regeln auch ohne die Routen
  const lehnAb = (befehl: Promise<unknown>, code: string) =>
    expect(befehl).rejects.toMatchObject({ code });
  await lehnAb(
    api`insert into lager_aenderung (lager_id, seq, tabelle, zeile_id, art, version) values (${bestehend.id}, 2, 'aufgabe', ${zeile}, 'geheim', 1)`,
    "23514",
  );
  await lehnAb(
    api`insert into lager_aenderung (lager_id, seq, tabelle, zeile_id, art, version) values (${bestehend.id}, 0, 'aufgabe', ${zeile}, 'neu', 1)`,
    "23514",
  );
  // Eine Folgenummer gibt es je Lager nur einmal
  await lehnAb(
    api`insert into lager_aenderung (lager_id, seq, tabelle, zeile_id, art, version) values (${bestehend.id}, 1, 'aufgabe', ${zeile}, 'neu', 1)`,
    "23505",
  );
  await lehnAb(api`update lager set seq_min = 0`, "23514");
  await lehnAb(api`update lager set seq = -1`, "23514");

  // Das Lager nimmt seinen Feed mit
  await api`delete from lager where id = ${bestehend.id}`;
  expect(await api`select * from lager_aenderung`).toHaveLength(0);

  // Rückweg: Feed und Spalten weg, Journal ohne 0062, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0062_lager_sync.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await hatFeed()).toBe(false);
  expect(await seqSpalten()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0062 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await hatFeed()).toBe(true);
  expect(await seqSpalten()).toEqual(["seq", "seq_min"]);
}, 60_000);
