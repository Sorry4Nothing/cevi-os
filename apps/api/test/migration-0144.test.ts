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

// 0144 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis vor 0144 migrieren, Kinder und Eltern anlegen, dann 0144 durch den echten Migrator, dann der Rückweg (#644)
const dbName = `cevi_os_mig644_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig644-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

function ordnerBauen(ziel: string, nurVor?: number) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  // Bis einschliesslich 0144, oder nur die Migrationen vor 0144 (spätere Nummern anderer Pakete gehören nicht zu diesem Test)
  const eintraege = journal.entries.filter((e) =>
    nurVor === undefined ? e.idx <= 144 : e.idx < nurVor,
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
  besitzer = postgres(`postgres://cevi_os_besitzer@localhost:5432/${dbName}`, {
    max: 1,
    onnotice: () => {},
  });
  ordnerBauen(bisVorher, 144);
  ordnerBauen(komplett);
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
const objekte = async () =>
  (
    await besitzer`select
      (select count(*)::int from information_schema.views where table_schema = 'public' and table_name = 'kind_zugang') as sicht,
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'kind_konto_einstellung') as einstellung,
      (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'kind' and column_name = 'user_id') as spalte`
  )[0] as { sicht: number; einstellung: number; spalte: number };

test("0144: Sicht, Einstellungen und Spalten kommen, alle Eltern behalten ihre Sicht, der Rückweg nimmt alles wieder", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await objekte()).toEqual({ sicht: 0, einstellung: 0, spalte: 0 });

  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const stufe = (
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'stufe', 'Stufe', 'S') returning id`
  )[0].id as string;
  const kinder =
    await besitzer`insert into kind (abteilung_id, vorname, nachname, stufe_id) values (${abteilung}, 'Kind', 'Eins', ${stufe}), (${abteilung}, 'Kind', 'Zwei', ${stufe}) returning id`;
  const eltern = (
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Eltern', ${`${randomUUID()}@example.org`}, ${abteilung}) returning id`
  )[0].id as string;
  await besitzer`insert into kind_eltern (kind_id, user_id) values (${kinder[0].id}, ${eltern}), (${kinder[1].id}, ${eltern})`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await objekte()).toEqual({ sicht: 1, einstellung: 1, spalte: 1 });
  // Bestehende Kinder haben kein Konto und die Eltern behalten Einsicht
  const zeilen =
    await besitzer`select user_id, eltern_einsicht, konto_seit, eltern_informiert_am from kind order by id`;
  for (const z of zeilen) {
    expect(z).toEqual({
      user_id: null,
      eltern_einsicht: true,
      konto_seit: null,
      eltern_informiert_am: null,
    });
  }
  const sicht =
    await besitzer`select kind_id, user_id, eigen from kind_zugang order by kind_id`;
  expect(sicht).toHaveLength(2);
  expect(sicht.every((z) => z.user_id === eltern && z.eigen === false)).toBe(
    true,
  );

  // Eigenes Konto: Es sieht sein Kind (eigen), die Eltern nur mit Einsicht; zwei Kinder teilen sich nie ein Konto
  const konto = (
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Kind', ${`${randomUUID()}@example.org`}, ${abteilung}) returning id`
  )[0].id as string;
  await besitzer`update kind set user_id = ${konto}, konto_seit = now() where id = ${kinder[0].id}`;
  await expect(
    besitzer`update kind set user_id = ${konto} where id = ${kinder[1].id}`,
  ).rejects.toThrow();
  const mit =
    await besitzer`select user_id, eigen from kind_zugang where kind_id = ${kinder[0].id} order by eigen`;
  expect(mit).toEqual([
    { user_id: eltern, eigen: false },
    { user_id: konto, eigen: true },
  ]);
  await besitzer`update kind set eltern_einsicht = false where id = ${kinder[0].id}`;
  expect(
    await besitzer`select user_id, eigen from kind_zugang where kind_id = ${kinder[0].id}`,
  ).toEqual([{ user_id: konto, eigen: true }]);
  // Ohne Konto zählt die Einsicht nicht: Fällt das Konto weg, sehen die Eltern wieder
  await besitzer`delete from "user" where id = ${konto}`;
  expect(
    await besitzer`select user_id, eigen from kind_zugang where kind_id = ${kinder[0].id}`,
  ).toEqual([{ user_id: eltern, eigen: false }]);

  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0144_kind_konto.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await objekte()).toEqual({ sicht: 0, einstellung: 0, spalte: 0 });
  // Kinder und Eltern bleiben unberührt
  expect((await besitzer`select count(*)::int as n from kind`)[0].n).toBe(2);
  expect(
    (await besitzer`select count(*)::int as n from kind_eltern`)[0].n,
  ).toBe(2);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0144 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await objekte()).toEqual({ sicht: 1, einstellung: 1, spalte: 1 });
}, 120_000);
