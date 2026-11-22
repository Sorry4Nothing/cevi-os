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

// 0096 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0095 migrieren, dann 0096 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig379_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig379-"));
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
  ordnerBauen(bisVorher, 95);
  ordnerBauen(komplett, 96);
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
const tabellen = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('protokoll', 'beschluss') order by table_name`
  ).map((z) => z.table_name);

test("0096 legt protokoll und beschluss an, die API-Rolle darf sie nutzen, CHECKs und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const lager = async (titel: string) =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, ${titel}, '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const eins = await lager("Eins");
  const zwei = await lager("Zwei");
  const datei = async (lagerId: string) =>
    (
      await besitzer`insert into lager_datei (lager_id, anzeigename, link, lager_seq) values (${lagerId}, 'Protokoll.docx', 'https://cevi.sharepoint.com/P.docx', 1) returning id`
    )[0].id as string;
  const hoeck = async (lagerId: string) =>
    (
      await besitzer`insert into hoeck (lager_id, art, datum, titel, lager_seq) values (${lagerId}, 'team', '2027-07-12', 'Höck', 1) returning id`
    )[0].id as string;
  const dateiEins = await datei(eins);
  const dateiZwei = await datei(zwei);
  const hoeckEins = await hoeck(eins);
  const hoeckZwei = await hoeck(zwei);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["beschluss", "protokoll"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  await api`insert into protokoll (lager_id, art, titel, datum, hoeck_id, datei_id, lager_seq) values (${eins}, 'sitzung', 'Sitzung', '2027-07-12', ${hoeckEins}, ${dateiEins}, 2)`;
  const [p] = await api`select * from protokoll`;
  expect(p).toMatchObject({ art: "sitzung", titel: "Sitzung", version: 1 });
  expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  await api`insert into beschluss (lager_id, text, protokoll_id, hoeck_id, lager_seq) values (${eins}, 'Wir packen', ${p.id}, ${hoeckEins}, 3)`;
  expect(await api`select * from beschluss`).toHaveLength(1);

  // CHECKs: Art aus der Liste, Titel 1 bis 200 Zeichen, Beschlusstext 1 bis 1000
  const neuesProtokoll = (art: string, titel: string) =>
    api`insert into protokoll (lager_id, art, titel, datum, datei_id, lager_seq) values (${eins}, ${art}, ${titel}, '2027-07-12', ${dateiEins}, 4)`;
  await expect(neuesProtokoll("geheim", "X")).rejects.toMatchObject({
    code: "23514",
  });
  await expect(neuesProtokoll("notiz", "")).rejects.toMatchObject({
    code: "23514",
  });
  await expect(neuesProtokoll("notiz", "x".repeat(201))).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    api`insert into beschluss (lager_id, text, lager_seq) values (${eins}, '', 4)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into beschluss (lager_id, text, lager_seq) values (${eins}, ${"x".repeat(1001)}, 4)`,
  ).rejects.toMatchObject({ code: "23514" });

  // Fremdschlüssel mit Lager: Datei, Höck und Protokoll eines anderen Lagers
  await expect(
    api`insert into protokoll (lager_id, art, titel, datum, datei_id, lager_seq) values (${eins}, 'notiz', 'X', '2027-07-12', ${dateiZwei}, 4)`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`insert into protokoll (lager_id, art, titel, datum, hoeck_id, datei_id, lager_seq) values (${eins}, 'notiz', 'X', '2027-07-12', ${hoeckZwei}, ${dateiEins}, 4)`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`insert into beschluss (lager_id, text, protokoll_id, lager_seq) values (${zwei}, 'X', ${p.id}, 4)`,
  ).rejects.toMatchObject({ code: "23503" });
  // Datei, Höck und Protokoll lassen sich nicht löschen, solange etwas auf sie zeigt (kein SET NULL: ein Höck der Lagerleitung würde sonst sichtbar)
  await expect(
    api`delete from lager_datei where id = ${dateiEins}`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`delete from hoeck where id = ${hoeckEins}`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`delete from protokoll where id = ${p.id}`,
  ).rejects.toMatchObject({ code: "23503" });

  // Das Lager nimmt Protokolle und Beschlüsse mit
  await api`delete from lager where id = ${eins}`;
  expect(await api`select * from protokoll`).toHaveLength(0);
  expect(await api`select * from beschluss`).toHaveLength(0);

  // Rückweg: Tabellen weg, hoeck.protokoll_id leer, Journal ohne 0096
  await api`update hoeck set protokoll_id = ${randomUUID()} where id = ${hoeckZwei}`;
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0096_lager_protokolle.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(
    await besitzer`select protokoll_id from hoeck where id = ${hoeckZwei}`,
  ).toEqual([{ protokoll_id: null }]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0096 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["beschluss", "protokoll"]);
}, 60_000);
