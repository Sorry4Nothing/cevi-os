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

// 0169 und ihr Rückweg gegen eine eigene Datenbank mit Konten (#843): erst bis 0168, ein Konto mit und eines ohne Angabe, dann 0169 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig843_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig843-"));
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
  ordnerBauen(bisVorher, 168);
  ordnerBauen(komplett, 169);
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
    await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'user' and column_name = 'geschlecht_von_hand'`
  )[0].n as number;

test("0169: «geschlecht_von_hand» ist bei jeder schon gesetzten Angabe wahr, sonst falsch; der Rückweg nimmt nur die Spalte und die Journal-Zeile weg", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  const [{ id: abteilung }] = await besitzer`
    insert into abteilung (name) values ('Eins') returning id`;
  const konto = async (geschlecht: string | null) =>
    (
      await besitzer`
        insert into "user" (name, email, email_verified, abteilung_id, created_at, updated_at, geschlecht)
        values ('Test', ${`${randomUUID()}@benutzer.invalid`}, false, ${abteilung}, now(), now(), ${geschlecht})
        returning id`
    )[0].id as string;
  const mit = await konto("w");
  const ohne = await konto(null);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  const vonHand = async (id: string) =>
    (
      await besitzer`select geschlecht_von_hand as v, geschlecht as g from "user" where id = ${id}`
    )[0];
  expect(await vonHand(mit)).toEqual({ v: true, g: "w" });
  expect(await vonHand(ohne)).toEqual({ v: false, g: null });
  // Neue Konten: falsch
  expect((await vonHand(await konto(null))).v).toBe(false);

  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0169_user_geschlecht_von_hand.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await spalte()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(
    (await besitzer`select geschlecht from "user" where id = ${mit}`)[0]
      .geschlecht,
  ).toBe("w");
}, 120_000);
