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

// 0071 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0068 migrieren (was davon im Journal steht), dann 0071 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig376_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig376-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;
let api: postgres.Sql;

// Die Migrationen bis idx «bis», dazu 0071, wenn «mit71»; spätere (zum Beispiel 0076) bleiben aussen vor
function ordnerBauen(ziel: string, bis: number, mit71: boolean) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const eintraege = journal.entries.filter(
    (e) => e.idx <= bis || (mit71 && e.idx === 71),
  );
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
  ordnerBauen(bisVorher, 68, false);
  ordnerBauen(komplett, 68, true);
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
const tabellen = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('todo_privat', 'vorlage') order by 1`
  ).map((z) => z.table_name);

test("0071 legt todo_privat und vorlage an, die Prüfungen der Datenbank halten, der Rückweg räumt auf", async () => {
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
  expect(await tabellen()).toEqual(["todo_privat", "vorlage"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const [todo] =
    await api`insert into todo_privat (lager_id, person_id, text) values (${lager.id}, ${person.id}, 'Zelt flicken') returning id, erledigt, reihenfolge`;
  expect(todo).toMatchObject({ erledigt: false, reihenfolge: 0 });
  for (const text of ["", "x".repeat(501)]) {
    await expect(
      api`insert into todo_privat (lager_id, person_id, text) values (${lager.id}, ${person.id}, ${text})`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  await expect(
    api`insert into todo_privat (lager_id, person_id, text, reihenfolge) values (${lager.id}, ${person.id}, 'x', -1)`,
  ).rejects.toMatchObject({ code: "23514" });

  // Vorlage: nur die zwei Arten, Inhalt ein Objekt, Name je Abteilung und Art eindeutig
  const inhalt = api.json({ aufgaben: [{ titel: "A" }] });
  await api`insert into vorlage (abteilung_id, art, name, inhalt) values (${abteilung.id}, 'aufgaben', 'Standard', ${inhalt})`;
  await api`insert into vorlage (abteilung_id, art, name, inhalt) values (${abteilung.id}, 'packliste', 'Standard', ${api.json({})})`;
  await expect(
    api`insert into vorlage (abteilung_id, art, name, inhalt) values (${abteilung.id}, 'aufgaben', 'Standard', ${inhalt})`,
  ).rejects.toMatchObject({ code: "23505" });
  for (const [art, name, json] of [
    ["unbekannt", "X", {}],
    ["aufgaben", "", {}],
    ["aufgaben", "X", []],
    ["aufgaben", "X", "text"],
  ] as const) {
    await expect(
      api`insert into vorlage (abteilung_id, art, name, inhalt) values (${abteilung.id}, ${art}, ${name}, ${api.json(json)})`,
    ).rejects.toMatchObject({ code: "23514" });
  }

  // Das Lager nimmt die To-dos mit, die Vorlage bleibt (die Abteilung lässt sich ohnehin nicht löschen: RESTRICT)
  await api`delete from lager where id = ${lager.id}`;
  expect(
    await api`select 1 from todo_privat where lager_id = ${lager.id}`,
  ).toHaveLength(0);
  expect(await api`select 1 from vorlage`).toHaveLength(2);

  // Rückweg: Tabellen weg, Journal ohne 0071, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0071_lager_todos_vorlagen.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0071 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["todo_privat", "vorlage"]);
}, 60_000);
