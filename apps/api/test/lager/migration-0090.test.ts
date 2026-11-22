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

// 0090 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0089 migrieren (was davon im Journal steht), dann 0090 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig396_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig396-"));
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
  ordnerBauen(bisVorher, 89);
  ordnerBauen(komplett, 90);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'dokument'`
  ).map((z) => z.table_name);

test("0090 legt dokument an, die API-Rolle darf es nutzen, CHECKs und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;
  const [anderes] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Anderes', '2027-07-10', '2027-07-24') returning id`;
  const datei = async (lagerId: string) =>
    (
      await besitzer`insert into lager_datei (lager_id, anzeigename, link, lager_seq) values (${lagerId}, 'Plan.pdf', 'https://cevi.sharepoint.com/Plan.pdf', 1) returning id`
    )[0].id as string;
  const eigene = await datei(lager.id);
  const fremde = await datei(anderes.id);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["dokument"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest; Vorgaben: keine Stichworte, nicht für das Team
  await api`insert into dokument (lager_id, titel, datei_id, lager_seq) values (${lager.id}, 'Plan', ${eigene}, 1)`;
  const [zeile] = await api`select * from dokument`;
  expect(zeile).toMatchObject({
    titel: "Plan",
    version: 1,
    stichworte: [],
    team_sichtbar: false,
  });
  expect(zeile.id).toMatch(/^[0-9a-f-]{36}$/);

  // Stichwort-Filter über den GIN-Index
  await api`update dokument set stichworte = ${["küche", "zelte"]} where id = ${zeile.id}`;
  expect(
    await api`select id from dokument where stichworte @> ${["zelte"]}::text[]`,
  ).toHaveLength(1);
  expect(
    await api`select id from dokument where stichworte @> ${["bad"]}::text[]`,
  ).toHaveLength(0);

  // CHECKs: Titel 1 bis 200 Zeichen, höchstens 20 Stichworte
  await expect(
    api`insert into dokument (lager_id, titel, datei_id, lager_seq) values (${lager.id}, '', ${eigene}, 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into dokument (lager_id, titel, datei_id, lager_seq) values (${lager.id}, ${"x".repeat(201)}, ${eigene}, 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into dokument (lager_id, titel, datei_id, stichworte, lager_seq) values (${lager.id}, 'X', ${eigene}, ${Array.from({ length: 21 }, (_, i) => `s${i}`)}, 2)`,
  ).rejects.toMatchObject({ code: "23514" });
  // Eine Datei eines anderen Lagers: Fremdschlüssel mit Lager
  await expect(
    api`insert into dokument (lager_id, titel, datei_id, lager_seq) values (${lager.id}, 'X', ${fremde}, 2)`,
  ).rejects.toMatchObject({ code: "23503" });
  // Eine eingebundene Datei lässt sich nicht löschen (RESTRICT), ohne Dokument schon
  await expect(
    api`delete from lager_datei where id = ${eigene}`,
  ).rejects.toMatchObject({ code: "23001" });
  await api`delete from lager_datei where id = ${fremde}`;

  // Das Lager nimmt seine Dokumente mit
  await api`delete from lager where id = ${lager.id}`;
  expect(await api`select * from dokument`).toHaveLength(0);

  // Rückweg: Tabelle und UNIQUE weg, Journal ohne 0090, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0090_lager_dokumente.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(
    await besitzer`select 1 from pg_constraint where conname = 'lager_datei_lager_id_id_uq'`,
  ).toHaveLength(0);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0090 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["dokument"]);
}, 60_000);
