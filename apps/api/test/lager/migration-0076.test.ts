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

// 0076 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0075 migrieren (was davon im Journal steht), dann 0076 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig381_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig381-"));
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
  ordnerBauen(bisVorher, 75);
  // Alles bis 0076: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 76);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'pinnwand%' order by 1`
  ).map((z) => z.table_name);

test("0076 legt die Pinnwand an, Fremdschlüssel und CHECKs halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];
  const datei = async (lagerId: string) =>
    (
      await besitzer`insert into lager_datei (lager_id, anzeigename, link, lager_seq) values (${lagerId}, 'Plan', 'https://example.org/plan.pdf', 1) returning id`
    )[0].id as string;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "pinnwand_beitrag",
    "pinnwand_datei",
    "pinnwand_empfaenger",
  ]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const beitrag = async (lagerId: string, titel = "Mitteilung") =>
    (
      await api`insert into pinnwand_beitrag (lager_id, titel, lager_seq) values (${lagerId}, ${titel}, 1) returning id`
    )[0].id as string;
  const a = await beitrag(lagerA);
  expect(
    (await api`select * from pinnwand_beitrag where id = ${a}`)[0],
  ).toMatchObject({
    version: 1,
    text: "",
    wichtig: false,
    angeheftet: false,
    sichtbar_ab: null,
    sichtbar_bis: null,
    geloescht_am: null,
  });
  // Ungültige Werte: leerer oder zu langer Titel, zu langer Text, Fenster ohne Ausdehnung
  await expect(beitrag(lagerA, "")).rejects.toMatchObject({ code: "23514" });
  await expect(beitrag(lagerA, "x".repeat(201))).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    api`insert into pinnwand_beitrag (lager_id, titel, text, lager_seq) values (${lagerA}, 'T', ${"x".repeat(10001)}, 1)`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into pinnwand_beitrag (lager_id, titel, sichtbar_ab, sichtbar_bis, lager_seq) values (${lagerA}, 'T', now(), now(), 1)`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`insert into pinnwand_beitrag (lager_id, titel, sichtbar_ab, sichtbar_bis, lager_seq) values (${lagerA}, 'T', now(), now() + interval '1 day', 1)`;

  // Empfänger: genau eine Rolle oder eine Person, nur Rollen unterhalb der Lagerleitung, je Beitrag einmal, nur im selben Lager
  await api`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle) values (${lagerA}, ${a}, 'team')`;
  await api`insert into pinnwand_empfaenger (lager_id, beitrag_id, person_id) values (${lagerA}, ${a}, ${person.id})`;
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle) values (${lagerA}, ${a}, 'team')`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, person_id) values (${lagerA}, ${a}, ${person.id})`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id) values (${lagerA}, ${a})`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle, person_id) values (${lagerA}, ${a}, 'lesen', ${person.id})`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle) values (${lagerA}, ${a}, 'lagerleitung')`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle) values (${lagerB}, ${a}, 'lesen')`,
  ).rejects.toMatchObject({ code: "23503" });

  // Dateien: derselbe Beitrag bindet eine Datei einmal ein (nach Soft-Delete wieder), nur in einem Beitrag desselben Lagers
  const d = await datei(lagerA);
  const bindung = (lagerId: string, beitragId: string, dateiId: string) =>
    api`insert into pinnwand_datei (lager_id, beitrag_id, datei_id, lager_seq) values (${lagerId}, ${beitragId}, ${dateiId}, 2) returning id`;
  const [erste] = await bindung(lagerA, a, d);
  await expect(bindung(lagerA, a, d)).rejects.toMatchObject({ code: "23505" });
  await expect(bindung(lagerB, a, await datei(lagerB))).rejects.toMatchObject({
    code: "23503",
  });
  await api`update pinnwand_datei set geloescht_am = now() where id = ${erste.id}`;
  await bindung(lagerA, a, d);
  // Eine eingebundene Datei lässt sich nicht löschen (RESTRICT): Der Aufräumlauf entfernt sie nie
  await expect(
    api`delete from lager_datei where id = ${d}`,
  ).rejects.toMatchObject({ code: "23001" });
  await expect(
    api`update pinnwand_datei set reihenfolge = -1 where beitrag_id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });

  // Das Löschen des Beitrags nimmt Empfänger und Verweise mit, die Datei bleibt
  await api`delete from pinnwand_beitrag where id = ${a}`;
  expect(await api`select 1 from pinnwand_empfaenger`).toHaveLength(0);
  expect(await api`select 1 from pinnwand_datei`).toHaveLength(0);
  expect(await api`select 1 from lager_datei where id = ${d}`).toHaveLength(1);

  // Das Lager nimmt alles mit
  const b = await beitrag(lagerB);
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from pinnwand_beitrag where id = ${b}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0076, die Datei bleibt
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0076_lager_pinnwand.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select 1 from lager_datei`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0076 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(3);
}, 60_000);
