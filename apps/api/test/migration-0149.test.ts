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

// 0149 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0147 migrieren, eine Abteilung anlegen, dann 0149 durch den echten Migrator, dann der Rückweg (#663)
const dbName = `cevi_os_mig663_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig663-"));
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
  ordnerBauen(bisVorher, 148);
  ordnerBauen(komplett, 149);
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
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'abteilungsleitung_recht'`
  )[0].n as number;

test("0149: jede bestehende Abteilung behält alle Rechte (leere Abzüge), die Tabelle ist geprüft, der Rückweg gibt alles zurück", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelle()).toBe(0);
  const abteilungen = (
    await besitzer`insert into abteilung (name) values ('Eins'), ('Zwei') returning id`
  ).map((z) => z.id as string);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabelle()).toBe(1);
  // Vorbelegung = heutiges Verhalten: nichts weggenommen, Version 1
  const zeilen =
    await besitzer`select abteilung_id, ohne, version from abteilungsleitung_recht order by abteilung_id`;
  expect(zeilen.map((z) => z.abteilung_id).sort()).toEqual(
    [...abteilungen].sort(),
  );
  for (const z of zeilen) {
    expect(z.ohne).toEqual([]);
    expect(z.version).toBe(1);
  }
  // Eine Zeile je Abteilung, höchstens 200 Abzüge, Abteilung muss es geben
  await expect(
    besitzer`insert into abteilungsleitung_recht (abteilung_id) values (${abteilungen[0]})`,
  ).rejects.toThrow(/abteilungsleitung_recht_pkey/);
  await expect(
    besitzer`insert into abteilungsleitung_recht (abteilung_id) values (${randomUUID()})`,
  ).rejects.toThrow(/abteilungsleitung_recht_abteilung_id_abteilung_id_fk/);
  await expect(
    besitzer`update abteilungsleitung_recht set ohne = (select array_agg(g::text) from generate_series(1, 201) g) where abteilung_id = ${abteilungen[0]}`,
  ).rejects.toThrow(/abteilungsleitung_recht_ohne_check/);

  // Rückweg: Die Tabelle entfällt, die Abteilungen bleiben, das Journal ist zurück
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0149_abteilungsleitung_rechte.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabelle()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect((await besitzer`select count(*)::int as n from abteilung`)[0].n).toBe(
    2,
  );
}, 120_000);
