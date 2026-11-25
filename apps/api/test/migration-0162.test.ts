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
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0162 und ihr Rückweg gegen eine eigene Datenbank mit Daten (#784): erst alle Migrationen bis 0160, Konten mit dem Spiegel «admin», dann 0162 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_784_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig784-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
) as { entries: { idx: number; tag: string }[] };
// Migrationen zwischen 0160 und 0162 (eine parallele Nummer dazwischen läuft mit)
const dazwischen = journal.entries.filter(
  (e) => e.idx > 160 && e.idx <= 162,
).length;

function ordnerBauen(ziel: string, bis: number) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
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
  ordnerBauen(bisVorher, 160);
  ordnerBauen(komplett, 162);
}, 60_000);

afterAll(async () => {
  await besitzer?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const rollen = async () =>
  Object.fromEntries(
    (await besitzer`select name, role from "user"`).map((r) => [
      r.name,
      r.role,
    ]),
  );
const sperre = async () =>
  (
    await besitzer`select count(*)::int as n from pg_constraint where conname = 'user_role_nur_user'`
  )[0].n as number;

async function konto(abteilungId: string, name: string, role: string | null) {
  const [z] = await besitzer`
    insert into "user" (name, email, abteilung_id, role)
    values (${name}, ${`${randomUUID()}@example.org`}, ${abteilungId}, ${role})
    returning id`;
  return z.id as string;
}

test("0162: role wird für alle zu «user» und die Datenbank lehnt «admin» ab; der Rückweg stellt den Spiegel aus der Tabelle her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await sperre()).toBe(0);
  const [abteilung] = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  ).map((z) => z.id as string);
  const al = await konto(abteilung, "AL", "admin");
  // Die Tabelle ist die Quelle: Ein Konto mit «admin», das nicht darin steht, bekommt die Abteilungsleitung durch den Rückweg nicht
  await konto(abteilung, "Schein", "admin");
  const neueAl = await konto(abteilung, "Neue AL", "user");
  await konto(abteilung, "Leer", null);
  await besitzer`insert into abteilungsleitung_person (user_id) values (${al}), (${neueAl})`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + dazwischen);
  expect(await sperre()).toBe(1);
  // Alle «user», leer bleibt leer; die Tabelle bleibt unberührt
  expect(await rollen()).toEqual({
    AL: "user",
    Schein: "user",
    "Neue AL": "user",
    Leer: null,
  });
  expect(
    (await besitzer`select count(*)::int as n from abteilungsleitung_person`)[0]
      .n,
  ).toBe(2);
  await expect(
    besitzer`update "user" set role = 'admin' where id = ${al}`,
  ).rejects.toThrow(/user_role_nur_user/);
  await expect(
    besitzer`update "user" set role = 'user' where id = ${al}`,
  ).resolves.toBeDefined();
  await expect(
    besitzer`update "user" set role = null where id = ${al}`,
  ).resolves.toBeDefined();

  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0162_user_role_spiegel_entfernt.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await sperre()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher + dazwischen - 1);
  // Jedes Mitglied der Tabelle hat «admin» zurück, sonst niemand
  expect(await rollen()).toEqual({
    AL: "admin",
    Schein: "user",
    "Neue AL": "admin",
    Leer: null,
  });

  // Nach dem Rückweg lässt sich 0162 wieder anwenden
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await sperre()).toBe(1);
  expect(await rollen()).toMatchObject({ AL: "user", "Neue AL": "user" });
}, 120_000);
