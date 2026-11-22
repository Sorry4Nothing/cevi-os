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

// 0087 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0086 migrieren (was davon im Journal steht), dann 0087 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig392_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig392-"));
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
  ordnerBauen(bisVorher, 86);
  // Alles bis 0087: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 87);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'einkauf%' order by 1`
  ).map((z) => z.table_name);

test("0087 legt die Einkaufsliste an, die Prüfungen halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

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
  const [mitglied, ausserhalb] = [await person(), await person()];
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lagerA}, ${mitglied}, 'team')`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "einkauf_artikel",
    "einkauf_artikelstamm",
    "einkauf_vorschlag",
  ]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const artikel = (
    lagerId: string,
    werte: { menge?: string | null; einheit?: string | null; wg?: string } = {},
    kaeufer: string | null = null,
  ) =>
    api`insert into einkauf_artikel (lager_id, name, name_norm, menge, einheit, warengruppe, einkaeufer_person_id, lager_seq) values (${lagerId}, 'Reis', 'reis', ${werte.menge ?? null}, ${werte.einheit ?? null}, ${werte.wg ?? "vorrat"}, ${kaeufer}, 1) returning id`;
  const [a] = await artikel(
    lagerA,
    { menge: "2.500", einheit: "kg" },
    mitglied,
  );
  expect(
    (await api`select * from einkauf_artikel where id = ${a.id}`)[0],
  ).toMatchObject({
    version: 1,
    erledigt: false,
    menge: "2.500",
    geloescht_am: null,
  });
  // Die Summe in der Datenbank ist exakt
  await artikel(lagerA, { menge: "0.100", einheit: "kg" });
  await artikel(lagerA, { menge: "0.200", einheit: "kg" });
  expect(
    (
      await api`select sum(menge)::text as s from einkauf_artikel where lager_id = ${lagerA} and einheit = 'kg' and menge < 1`
    )[0].s,
  ).toBe("0.300");

  // CHECKs: Menge, Einheit, Warengruppe, Name
  for (const werte of [
    { menge: "0" },
    { menge: "-1" },
    { einheit: "" },
    { einheit: "x".repeat(21) },
    { wg: "Getränke" },
  ]) {
    await expect(artikel(lagerA, werte)).rejects.toMatchObject({
      code: "23514",
    });
  }
  await expect(
    api`insert into einkauf_artikel (lager_id, name, name_norm, warengruppe, lager_seq) values (${lagerA}, '', 'x', 'diverses', 1)`,
  ).rejects.toMatchObject({ code: "23514" });
  // Wer einkauft, ist Mitglied dieses Lagers
  await expect(artikel(lagerA, {}, ausserhalb)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(artikel(lagerB, {}, mitglied)).rejects.toMatchObject({
    code: "23503",
  });
  // Verlässt die Person das Lager, bleibt der Artikel und die Angabe wird leer (nur diese Spalte)
  await besitzer`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${mitglied}`;
  expect(
    (
      await api`select lager_id, einkaeufer_person_id from einkauf_artikel where id = ${a.id}`
    )[0],
  ).toEqual({ lager_id: lagerA, einkaeufer_person_id: null });

  // Stamm und Vorschläge: je Lager ein Name einmal, Werte geprüft
  await api`insert into einkauf_artikelstamm (lager_id, name_norm, warengruppe) values (${lagerA}, 'reis', 'vorrat')`;
  await api`insert into einkauf_artikelstamm (lager_id, name_norm, warengruppe) values (${lagerB}, 'reis', 'brot')`;
  await expect(
    api`insert into einkauf_artikelstamm (lager_id, name_norm, warengruppe) values (${lagerA}, 'reis', 'brot')`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into einkauf_artikelstamm (lager_id, name_norm, warengruppe) values (${lagerA}, 'x', 'unbekannt')`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`insert into einkauf_vorschlag (lager_id, name_norm, name) values (${lagerA}, 'reis', 'Reis')`;
  expect(
    (
      await api`select haeufigkeit from einkauf_vorschlag where lager_id = ${lagerA}`
    )[0].haeufigkeit,
  ).toBe(1);
  await expect(
    api`insert into einkauf_vorschlag (lager_id, name_norm, name, haeufigkeit) values (${lagerA}, 'x', 'X', 0)`,
  ).rejects.toMatchObject({ code: "23514" });

  // Das Lager nimmt alles mit
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from einkauf_artikelstamm where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0087
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0087_lager_einkauf.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select * from lager`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0087 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(3);
}, 60_000);
