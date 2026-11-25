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

// 0163 und ihr Rückweg gegen eine eigene Datenbank mit Sitzungen (#785): erst bis 0160, Konten mit und ohne zweiten Faktor samt Sitzungen, dann 0163 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig785_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig785-"));
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
  ordnerBauen(bisVorher, 160);
  ordnerBauen(komplett, 163);
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
    await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'session' and column_name = 'client_art'`
  )[0].n as number;
const tabellen = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_name like 'app_nachweis_%' order by 1`
  ).map((z) => z.table_name as string);

test("0163: Sitzungen von Konten mit zweitem Faktor ohne geprüften Code gelten als «app_ungeprueft», alle anderen als «web»; neue Tabellen; der Rückweg nimmt alles wieder weg und lässt die Sitzungen", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(0);
  const [{ id: abteilung }] = await besitzer`
    insert into abteilung (name) values ('Eins') returning id`;
  const konto = async (name: string, faktor: boolean | null) =>
    (
      await besitzer`
        insert into "user" (name, email, email_verified, abteilung_id, two_factor_enabled, created_at, updated_at)
        values (${name}, ${`${randomUUID()}@benutzer.invalid`}, false, ${abteilung}, ${faktor}, now(), now())
        returning id`
    )[0].id as string;
  const mit = await konto("Mit", true);
  const ohne = await konto("Ohne", false);
  const sitzung = (userId: string, geprueft: boolean) =>
    besitzer`insert into session (token, expires_at, updated_at, user_id, zweiter_faktor_geprueft) values (${randomUUID()}, now() + interval '1 day', now(), ${userId}, ${geprueft})`;
  // Das Konto mit Faktor: eine geprüfte (Browser) und eine ungeprüfte (App) Sitzung; das Konto ohne Faktor: eine ungeprüfte
  await sitzung(mit, true);
  await sitzung(mit, false);
  await sitzung(ohne, false);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(
    vorher + journal.entries.filter((e) => e.idx > 160 && e.idx <= 163).length,
  );
  expect(await spalte()).toBe(1);
  expect(await tabellen()).toEqual([
    "app_nachweis_challenge",
    "app_nachweis_geraet",
  ]);
  const proKonto =
    await besitzer`select user_id, client_art, zweiter_faktor_geprueft as g from session`;
  expect(
    proKonto.find((z) => z.user_id === mit && z.g === false)?.client_art,
  ).toBe("app_ungeprueft");
  expect(
    proKonto.find((z) => z.user_id === mit && z.g === true)?.client_art,
  ).toBe("web");
  expect(proKonto.find((z) => z.user_id === ohne)?.client_art).toBe("web");

  // Neue Sitzungen beginnen als «web»; die Datenbank lässt nur die drei Werte zu
  await sitzung(ohne, false);
  expect(
    (
      await besitzer`select count(*)::int as n from session where user_id = ${ohne} and client_art = 'web'`
    )[0].n,
  ).toBe(2);
  await expect(
    besitzer`update session set client_art = 'irgendwas' where user_id = ${ohne}`,
  ).rejects.toThrow(/session_client_art_check/);
  await expect(
    besitzer`update session set client_art = null where user_id = ${ohne}`,
  ).rejects.toThrow(/null/);

  // Die neuen Tabellen: Nonce einmalig, Zähler im Bereich, Schlüssel gehören zu einem Konto, das mit ihm verschwindet
  await besitzer`insert into app_nachweis_challenge (nonce_hash, plattform, laeuft_ab_am) values ('a', 'ios', now())`;
  await expect(
    besitzer`insert into app_nachweis_challenge (nonce_hash, plattform, laeuft_ab_am) values ('a', 'ios', now())`,
  ).rejects.toThrow(/unique/);
  await expect(
    besitzer`insert into app_nachweis_challenge (nonce_hash, plattform, laeuft_ab_am) values ('b', 'web', now())`,
  ).rejects.toThrow(/plattform_check/);
  await expect(
    besitzer`insert into app_nachweis_geraet (schluessel_id, oeffentlicher_schluessel, zaehler) values ('k', 'p', -1)`,
  ).rejects.toThrow(/zaehler_check/);
  await besitzer`insert into app_nachweis_geraet (schluessel_id, oeffentlicher_schluessel, user_id) values ('k', 'p', ${mit})`;
  await besitzer`delete from "user" where id = ${mit}`;
  expect(
    (await besitzer`select count(*)::int as n from app_nachweis_geraet`)[0].n,
  ).toBe(0);

  // Rückweg: Spalte, Tabellen und Journal-Zeile sind weg; die Sitzungen bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0163_app_nachweis.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await spalte()).toBe(0);
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(
    vorher +
      journal.entries.filter((e) => e.idx > 160 && e.idx <= 163).length -
      1,
  );
  expect(
    (
      await besitzer`select count(*)::int as n from session where user_id = ${ohne}`
    )[0].n,
  ).toBe(2);
}, 120_000);
