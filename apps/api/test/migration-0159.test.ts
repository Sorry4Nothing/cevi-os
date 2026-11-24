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

// 0159 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst alle Migrationen bis 0158 anwenden, Konten anlegen, dann 0159 durch den echten Migrator (der überspringt Migrationen mit kleinerem «when» als die letzte angewendete), dann der Rückweg (#720)
const dbName = `cevi_os_mig720_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig720-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

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
  ordnerBauen(bisVorher, 158);
  ordnerBauen(komplett, 159);
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
const tabelle = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'abteilungsleitung_person'`
  )[0].n as number;
const mitglieder = async () =>
  (
    await besitzer`select user_id from abteilungsleitung_person order by user_id`
  ).map((z) => z.user_id as string);

async function konto(abteilungId: string, name: string, role: string | null) {
  const [z] = await besitzer`
    insert into "user" (name, email, abteilung_id, role)
    values (${name}, ${`${randomUUID()}@example.org`}, ${abteilungId}, ${role})
    returning id`;
  return z.id as string;
}

test("0159: die Konten mit role = 'admin' kommen in die Tabelle, user.role bleibt, der Rückweg stellt role aus der Tabelle her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelle()).toBe(0);
  const [eins, zwei] = (
    await besitzer`insert into abteilung (name) values ('Eins'), ('Zwei') returning id`
  ).map((z) => z.id as string);
  const al1 = await konto(eins, "AL Eins", "admin");
  const al2 = await konto(zwei, "AL Zwei", "admin");
  const normal = await konto(eins, "Normal", "user");
  const ohneRolle = await konto(eins, "Ohne Rolle", null);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabelle()).toBe(1);
  // Genau die Konten mit role = 'admin', über alle Abteilungen; role selbst bleibt unberührt
  expect(await mitglieder()).toEqual([al1, al2].sort());
  const rollen = await besitzer`select id, role from "user"`;
  expect(Object.fromEntries(rollen.map((r) => [r.id, r.role]))).toEqual({
    [al1]: "admin",
    [al2]: "admin",
    [normal]: "user",
    [ohneRolle]: null,
  });
  // Eine Zeile je Konto, das Konto muss es geben, das Löschen des Kontos löscht die Zeile
  await expect(
    besitzer`insert into abteilungsleitung_person (user_id) values (${al1})`,
  ).rejects.toThrow(/abteilungsleitung_person_pkey/);
  await expect(
    besitzer`insert into abteilungsleitung_person (user_id) values (${randomUUID()})`,
  ).rejects.toThrow(/abteilungsleitung_person_user_id_user_id_fk/);
  await besitzer`delete from "user" where id = ${al2}`;
  expect(await mitglieder()).toEqual([al1]);

  // Seit 0159 neu vergeben (nur in der Tabelle), dann der Rückweg: role = 'admin' für alle Mitglieder, Tabelle weg, Journal zurück
  await besitzer`insert into abteilungsleitung_person (user_id) values (${normal})`;
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0159_abteilungsleitung_person.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabelle()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  const danach = await besitzer`select id, role from "user"`;
  expect(Object.fromEntries(danach.map((r) => [r.id, r.role]))).toEqual({
    [al1]: "admin",
    [normal]: "admin",
    [ohneRolle]: null,
  });

  // Nach dem Rückweg lässt sich 0159 wieder anwenden
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await mitglieder()).toEqual([al1, normal].sort());
}, 120_000);
