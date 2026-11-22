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
import {
  LAGER_RECHTE,
  standardErlaubt,
} from "../../src/lager/rechte-katalog.js";
import { SUPERUSER_URL } from "../hilfen/datenbank.js";

// 0061 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0060 migrieren, ein Lager anlegen, dann 0061 durch den echten Migrator (füllt bestehende Lager mit den Standardwerten), dann der Rückweg
const dbName = `cevi_os_mig365_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig365-"));
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
  ordnerBauen(bisVorher, 60);
  ordnerBauen(komplett, 61);
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
const tabelleDa = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'lager_rolle_recht'`
  )[0].n === 1;

test("0061 legt lager_rolle_recht an, füllt bestehende Lager mit dem Standard, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelleDa()).toBe(false);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const lagerIds = (
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager A', '2027-07-10', '2027-07-24'), (${abteilung.id}, 'Lager B', '2027-08-10', '2027-08-24') returning id`
  ).map((z) => z.id as string);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabelleDa()).toBe(true);

  // Jedes bestehende Lager hat die Standardmatrix des Katalogs, nie eine Zeile für die Lagerleitung
  for (const id of lagerIds) {
    const zeilen =
      await api`select rolle, recht, erlaubt from lager_rolle_recht where lager_id = ${id}`;
    expect(zeilen).toHaveLength(3 * LAGER_RECHTE.length);
    for (const z of zeilen) {
      expect(z.erlaubt, `${z.rolle} ${z.recht}`).toBe(
        standardErlaubt(z.rolle, z.recht),
      );
    }
  }

  // Die Datenbank hält die Regeln auch ohne die Routen
  await expect(
    api`insert into lager_rolle_recht (lager_id, rolle, recht, erlaubt) values (${lagerIds[0]}, 'lagerleitung', 'wetter.lesen', false)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into lager_rolle_recht (lager_id, rolle, recht, erlaubt) values (${lagerIds[0]}, 'team', 'wetter.lesen', false)`,
  ).rejects.toMatchObject({ code: "23505" });

  // Das Lager nimmt seine Einstellungen mit
  await api`delete from lager where id = ${lagerIds[0]}`;
  expect(
    await api`select 1 from lager_rolle_recht where lager_id = ${lagerIds[0]}`,
  ).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0061, Lager bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0061_lager_rechte.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabelleDa()).toBe(false);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select 1 from lager`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0061 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabelleDa()).toBe(true);
  expect(await besitzer`select 1 from lager_rolle_recht`).toHaveLength(
    3 * LAGER_RECHTE.length,
  );
}, 60_000);
