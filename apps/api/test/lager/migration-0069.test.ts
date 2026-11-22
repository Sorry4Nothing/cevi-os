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

// 0069 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0068 migrieren (was davon im Journal steht), dann 0069 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig373_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig373-"));
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
  ordnerBauen(bisVorher, 68);
  // Alles bis 0069: spätere Lager-Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 69);
}, 30_000);

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
}, 30_000);

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const tabellen = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'aufgabe%' order by 1`
  ).map((z) => z.table_name);

test("0069 legt Checkpunkte, Links und Stichworte an, die Fremdschlüssel halten das Lager, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual(["aufgabe", "aufgabe_unterstuetzung"]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const person = async () =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];
  const [p1, p2] = [await person(), await person()];
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lagerA}, ${p1}, 'team'), (${lagerA}, ${p2}, 'team')`;
  const aufgabe = async (lagerId: string) =>
    (
      await besitzer`insert into aufgabe (lager_id, titel, lager_seq) values (${lagerId}, 'Zelte prüfen', 1) returning id`
    )[0].id as string;
  const [aA, aB] = [await aufgabe(lagerA), await aufgabe(lagerB)];

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "aufgabe",
    "aufgabe_checkpunkt",
    "aufgabe_link",
    "aufgabe_stichwort",
    "aufgabe_unterstuetzung",
  ]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const punkt = async (
    lagerId: string,
    aufgabeId: string,
    extra: { text?: string; erledigt?: boolean; person?: string | null } = {},
  ) =>
    (
      await api`insert into aufgabe_checkpunkt (lager_id, aufgabe_id, text, erledigt, person_id, lager_seq) values (${lagerId}, ${aufgabeId}, ${extra.text ?? "Heringe zählen"}, ${extra.erledigt ?? false}, ${extra.person ?? null}, 1) returning id`
    )[0].id as string;
  const c = await punkt(lagerA, aA);
  expect(
    (await api`select * from aufgabe_checkpunkt where id = ${c}`)[0],
  ).toMatchObject({
    version: 1,
    erledigt: false,
    person_id: null,
    reihenfolge: 0,
    geloescht_am: null,
  });
  // Text 1 bis 500 Zeichen; eine Person nur bei erledigtem Punkt
  await expect(punkt(lagerA, aA, { text: "" })).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    punkt(lagerA, aA, { text: "x".repeat(501) }),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(punkt(lagerA, aA, { person: p1 })).rejects.toMatchObject({
    code: "23514",
  });
  const erledigt = await punkt(lagerA, aA, { erledigt: true, person: p1 });
  // Aufgabe und Person nur aus dem eigenen Lager
  await expect(punkt(lagerB, aA)).rejects.toMatchObject({ code: "23503" });
  await expect(
    punkt(lagerB, aB, { erledigt: true, person: p1 }),
  ).rejects.toMatchObject({ code: "23503" });
  // Verlässt die Person das Lager, bleibt der Punkt abgehakt, nur die Person verschwindet
  await api`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p1}`;
  expect(
    (
      await api`select erledigt, person_id, lager_id from aufgabe_checkpunkt where id = ${erledigt}`
    )[0],
  ).toEqual({ erledigt: true, person_id: null, lager_id: lagerA });

  // Links: nur https, begrenzte Länge, Aufgabe aus dem eigenen Lager
  const link = async (lagerId: string, aufgabeId: string, adresse: string) =>
    api`insert into aufgabe_link (lager_id, aufgabe_id, titel, url, lager_seq) values (${lagerId}, ${aufgabeId}, 'Plan', ${adresse}, 1)`;
  await link(lagerA, aA, "https://beispiel.example.org/plan");
  for (const schlecht of [
    "http://beispiel.example.org",
    "javascript:alert(1)",
    "https://mit leerraum.example.org",
    `https://beispiel.example.org/${"a".repeat(2000)}`,
  ]) {
    await expect(link(lagerA, aA, schlecht)).rejects.toMatchObject({
      code: "23514",
    });
  }
  await expect(
    link(lagerB, aA, "https://beispiel.example.org"),
  ).rejects.toMatchObject({ code: "23503" });

  // Stichworte: je Aufgabe einmal ohne Rücksicht auf Gross- und Kleinschreibung, 1 bis 40 Zeichen, ohne Leerraum am Rand
  const wort = async (lagerId: string, aufgabeId: string, w: string) =>
    api`insert into aufgabe_stichwort (lager_id, aufgabe_id, stichwort) values (${lagerId}, ${aufgabeId}, ${w})`;
  await wort(lagerA, aA, "Material");
  await expect(wort(lagerA, aA, "material")).rejects.toMatchObject({
    code: "23505",
  });
  await wort(lagerA, aA, "Küche");
  for (const schlecht of ["", " Zelt", "x".repeat(41)]) {
    await expect(wort(lagerA, aA, schlecht)).rejects.toMatchObject({
      code: "23514",
    });
  }
  await expect(wort(lagerB, aA, "Fremd")).rejects.toMatchObject({
    code: "23503",
  });

  // Aufgabe weg: Details gehen mit; das Lager nimmt alles mit
  await api`delete from aufgabe where id = ${aA}`;
  expect(await api`select * from aufgabe_checkpunkt`).toHaveLength(0);
  expect(await api`select * from aufgabe_link`).toHaveLength(0);
  expect(await api`select * from aufgabe_stichwort`).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0069, die Aufgaben bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0069_lager_aufgaben_details.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual(["aufgabe", "aufgabe_unterstuetzung"]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select * from aufgabe`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0069 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(5);
}, 60_000);
