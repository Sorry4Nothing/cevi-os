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

// 0105 bis 0108 (#520) und ihre Rückwege gegen eine eigene Datenbank: erst bis 0104 migrieren, Zeilen anlegen, dann 0105 bis 0108 durch den echten Migrator, dann die Rückwege in umgekehrter Reihenfolge
const dbName = `cevi_os_mig520_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig520-"));
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
  ordnerBauen(bisVorher, 104);
  ordnerBauen(komplett, 108);
}, 60_000);

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
}, 60_000);

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const spalten = async (tabelle: string) =>
  (
    await besitzer`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${tabelle}`
  ).map((z) => z.column_name as string);
const tabelleDa = async (tabelle: string) =>
  (
    await besitzer`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${tabelle}`
  ).length === 1;
const rueckweg = (name: string) =>
  besitzer.unsafe(
    readFileSync(
      new URL(`../../drizzle/rueckweg/${name}.sql`, import.meta.url),
      "utf8",
    ),
  );

test("0105 bis 0108: Spalten, CHECKs und Tabelle; die Rückwege stellen den Stand vor 0105 her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalten("ressort")).not.toContain("ruhig");
  expect(await spalten("traktandum")).not.toContain("dauer_minuten");
  expect(await spalten("pinnwand_empfaenger")).not.toContain("ressort_id");
  expect(await tabelleDa("pinnwand_gesehen")).toBe(false);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;
  const [ressort] =
    await besitzer`insert into ressort (lager_id, kuerzel, name, lager_seq) values (${lager.id}, 'KU', 'Küche', 1) returning id`;
  const [traktandum] =
    await besitzer`insert into traktandum (lager_id, titel, lager_seq) values (${lager.id}, 'Punkt', 2) returning id`;
  const [beitrag] =
    await besitzer`insert into pinnwand_beitrag (lager_id, titel, lager_seq) values (${lager.id}, 'Beitrag', 3) returning id`;
  await besitzer`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle) values (${lager.id}, ${beitrag.id}, 'team')`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 4);

  // 0105: Bestehende Ressorts sind nicht ruhig
  expect((await api`select ruhig from ressort`)[0]!.ruhig).toBe(false);
  // 0106: Bestehende Traktanden haben keine Dauer; 1 bis 600 sind gültig
  expect(
    (await api`select dauer_minuten from traktandum`)[0]!.dauer_minuten,
  ).toBeNull();
  await api`update traktandum set dauer_minuten = 600 where id = ${traktandum.id}`;
  await api`update traktandum set dauer_minuten = 1 where id = ${traktandum.id}`;
  for (const wert of [0, 601, -5]) {
    await expect(
      api`update traktandum set dauer_minuten = ${wert} where id = ${traktandum.id}`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  // 0107: Die bestehende Zeile bleibt gültig; genau eines von vier Zielen je Zeile, je Beitrag ein Ziel nur einmal
  expect(
    await api`select rolle from pinnwand_empfaenger where beitrag_id = ${beitrag.id}`,
  ).toHaveLength(1);
  await api`insert into pinnwand_empfaenger (lager_id, beitrag_id, ressort_id) values (${lager.id}, ${beitrag.id}, ${ressort.id})`;
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, ressort_id) values (${lager.id}, ${beitrag.id}, ${ressort.id})`,
  ).rejects.toMatchObject({ code: "23505" });
  const gruppe = randomUUID();
  await api`insert into pinnwand_empfaenger (lager_id, beitrag_id, gruppe_id) values (${lager.id}, ${beitrag.id}, ${gruppe})`;
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, gruppe_id) values (${lager.id}, ${beitrag.id}, ${gruppe})`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, ressort_id, gruppe_id) values (${lager.id}, ${beitrag.id}, ${randomUUID()}, ${randomUUID()})`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id) values (${lager.id}, ${beitrag.id})`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into pinnwand_empfaenger (lager_id, beitrag_id, rolle, ressort_id) values (${lager.id}, ${beitrag.id}, 'lesen', ${randomUUID()})`,
  ).rejects.toMatchObject({ code: "23514" });
  // Ohne Fremdschlüssel: Ein gelöschtes Ressort lässt die Zeile stehen (der Beitrag bleibt eingeschränkt)
  await api`delete from ressort where id = ${ressort.id}`;
  expect(
    await api`select 1 from pinnwand_empfaenger where ressort_id = ${ressort.id}`,
  ).toHaveLength(1);
  // 0108: gesehen, einmal je Beitrag und Person, mit dem Beitrag weg
  await api`insert into pinnwand_gesehen (lager_id, beitrag_id, person_id) values (${lager.id}, ${beitrag.id}, ${person.id})`;
  await expect(
    api`insert into pinnwand_gesehen (lager_id, beitrag_id, person_id) values (${lager.id}, ${beitrag.id}, ${person.id})`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into pinnwand_gesehen (lager_id, beitrag_id, person_id) values (${randomUUID()}, ${beitrag.id}, ${randomUUID()})`,
  ).rejects.toMatchObject({ code: "23503" });
  expect(
    (await api`select gesehen_am from pinnwand_gesehen`)[0]!.gesehen_am,
  ).toBeInstanceOf(Date);
  await api`delete from pinnwand_beitrag where id = ${beitrag.id}`;
  expect(await api`select * from pinnwand_gesehen`).toHaveLength(0);
  expect(await api`select * from pinnwand_empfaenger`).toHaveLength(0);

  // Rückwege, neuester zuerst
  await rueckweg("0108_lager_pinnwand_gesehen");
  expect(await tabelleDa("pinnwand_gesehen")).toBe(false);
  expect(await anzahlMigrationen()).toBe(vorher + 3);
  await rueckweg("0107_lager_pinnwand_empfaenger_ziel");
  expect(await spalten("pinnwand_empfaenger")).not.toContain("gruppe_id");
  expect(await spalten("pinnwand_empfaenger")).not.toContain("ressort_id");
  expect(await anzahlMigrationen()).toBe(vorher + 2);
  await rueckweg("0106_lager_traktandum_dauer");
  expect(await spalten("traktandum")).not.toContain("dauer_minuten");
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  await rueckweg("0105_lager_ressort_ruhig");
  expect(await spalten("ressort")).not.toContain("ruhig");
  expect(await anzahlMigrationen()).toBe(vorher);

  // Der alte CHECK gilt wieder, und erneut vorwärts läuft alles
  const [b2] =
    await besitzer`insert into pinnwand_beitrag (lager_id, titel, lager_seq) values (${lager.id}, 'B2', 4) returning id`;
  await expect(
    besitzer`insert into pinnwand_empfaenger (lager_id, beitrag_id) values (${lager.id}, ${b2.id})`,
  ).rejects.toMatchObject({ code: "23514" });
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 4);
  expect(await spalten("ressort")).toContain("ruhig");
  expect(await tabelleDa("pinnwand_gesehen")).toBe(true);
}, 90_000);
