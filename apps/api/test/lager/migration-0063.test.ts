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

// 0063 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0062 migrieren, dann 0063 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig367_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig367-"));
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
  ordnerBauen(bisVorher, 62);
  // Alles bis 0063: spätere Lager-Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 63);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'lager_client_op'`
  ).map((z) => z.table_name);

test("0063 legt die Tabelle an, die API-Rolle darf sie nutzen, der Rückweg räumt auf", async () => {
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
  expect(await tabellen()).toEqual(["lager_client_op"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const opId = randomUUID();
  await api`insert into lager_client_op (lager_id, person_id, client_op_id) values (${lager.id}, ${person.id}, ${opId})`;
  await api`update lager_client_op set ergebnis = ${api.json({ status: "ok" })} where client_op_id = ${opId}`;
  const [zeile] = await api`select * from lager_client_op`;
  expect(zeile).toMatchObject({ ergebnis: { status: "ok" } });
  // Je Lager, Person und clientOpId eine Zeile; dieselbe ID einer anderen Person ist erlaubt
  await expect(
    api`insert into lager_client_op (lager_id, person_id, client_op_id) values (${lager.id}, ${person.id}, ${opId})`,
  ).rejects.toMatchObject({ code: "23505" });
  const [andere] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Andere', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  await api`insert into lager_client_op (lager_id, person_id, client_op_id) values (${lager.id}, ${andere.id}, ${opId})`;

  // Person und Lager nehmen ihre Zeilen mit
  await api`delete from "user" where id = ${andere.id}`;
  expect(await api`select * from lager_client_op`).toHaveLength(1);
  await api`delete from lager where id = ${lager.id}`;
  expect(await api`select * from lager_client_op`).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0063, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0063_lager_warteschlange.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0063 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["lager_client_op"]);
}, 60_000);
