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

// 0165 und ihr Rückweg gegen eine eigene Datenbank mit Konten (#817): erst bis 0163, ein Konto ohne Angabe, dann 0165 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig817_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig817-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
) as { entries: { idx: number; tag: string }[] };

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
  ordnerBauen(bisVorher, 163);
  ordnerBauen(komplett, 165);
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
const spalte = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'user' and column_name = 'geschlecht'`
  )[0].n as number;

test("0165: neue Spalte «geschlecht» ohne Angabe für alle Konten, nur w, m, d oder null erlaubt; der Rückweg nimmt Spalte und Journal-Zeile weg und lässt die Konten", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(0);
  const [{ id: abteilung }] = await besitzer`
    insert into abteilung (name) values ('Eins') returning id`;
  const konto = async (name: string) =>
    (
      await besitzer`
        insert into "user" (name, email, email_verified, abteilung_id, created_at, updated_at)
        values (${name}, ${`${randomUUID()}@benutzer.invalid`}, false, ${abteilung}, now(), now())
        returning id`
    )[0].id as string;
  const bestand = await konto("Bestand");

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(
    vorher + journal.entries.filter((e) => e.idx > 163 && e.idx <= 165).length,
  );
  expect(await spalte()).toBe(1);
  // Bestehende Konten bleiben ohne Angabe
  expect(
    (await besitzer`select geschlecht from "user" where id = ${bestand}`)[0]
      .geschlecht,
  ).toBeNull();

  // Die Datenbank lässt nur w, m, d und null zu
  for (const wert of ["w", "m", "d", null]) {
    await besitzer`update "user" set geschlecht = ${wert} where id = ${bestand}`;
  }
  for (const wert of ["x", "W", "", "weiblich"]) {
    await expect(
      besitzer`update "user" set geschlecht = ${wert} where id = ${bestand}`,
    ).rejects.toThrow(/user_geschlecht_check/);
  }

  // Rückweg: Spalte und Journal-Zeile sind weg, das Konto bleibt
  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0165_user_geschlecht.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await spalte()).toBe(0);
  expect(await anzahlMigrationen()).toBe(
    vorher +
      journal.entries.filter((e) => e.idx > 163 && e.idx <= 165).length -
      1,
  );
  expect(
    (
      await besitzer`select count(*)::int as n from "user" where id = ${bestand}`
    )[0].n,
  ).toBe(1);
}, 120_000);
