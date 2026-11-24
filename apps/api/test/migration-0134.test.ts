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

// 0134 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0133 migrieren, füllen, dann 0134 durch den echten Migrator, dann der Rückweg (#610)
const dbName = `cevi_os_mig610_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig610-"));
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
  ordnerBauen(bisVorher, 133);
  ordnerBauen(komplett, 134);
});

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
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'user' and column_name = 'website_freigabe_am'`
  )[0].n as number;

test("0134: die Freigabe-Spalte entfällt, die übrigen Daten bleiben, der Rückweg legt sie leer wieder an", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(1);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const person = (
    await besitzer`insert into "user" (name, email, abteilung_id, cevi_name, website_freigabe_am) values ('Eva Muster', 'eva@example.test', ${abteilung}, 'Luna', now()) returning id`
  )[0].id as string;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte()).toBe(0);
  const [bleibt] =
    await besitzer`select name, cevi_name from "user" where id = ${person}`;
  expect(bleibt).toMatchObject({ name: "Eva Muster", cevi_name: "Luna" });

  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0134_website_freigabe_entfernt.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await spalte()).toBe(1);
  // Die Werte gehen mit der Migration verloren: Danach ist niemand freigegeben
  const [leer] =
    await besitzer`select website_freigabe_am from "user" where id = ${person}`;
  expect(leer.website_freigabe_am).toBeNull();

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0134 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalte()).toBe(0);
}, 120_000);
