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

// 0067 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0066 migrieren (was davon im Journal steht), dann 0067 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig371_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig371-"));
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
  ordnerBauen(bisVorher, 66);
  // Alles bis 0067: spätere Lager-Migrationen (ab 0068) sind für diesen Test ohne Belang
  ordnerBauen(komplett, 67);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'ressort%' order by 1`
  ).map((z) => z.table_name);

test("0067 legt Ressorts, Links und Notizen an, der Fremdschlüssel hält das Lager, der Rückweg räumt auf", async () => {
  // Was im Journal vor 0067 steht (der Test gilt auch, wenn 0063, 0064 und 0066 noch nicht gemergt sind)
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
  // Ein Mitglied vor der Migration: ressort_id bleibt leer und gültig
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lagerA}, ${person.id}, 'team')`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual([
    "ressort",
    "ressort_link",
    "ressort_notiz",
  ]);
  expect(
    (await besitzer`select ressort_id from lager_mitglied`)[0].ressort_id,
  ).toBeNull();

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const neu = async (lagerId: string, kuerzel: string, parent?: string) =>
    (
      await api`insert into ressort (lager_id, kuerzel, name, parent_id, lager_seq) values (${lagerId}, ${kuerzel}, 'Küche', ${parent ?? null}, 1) returning id`
    )[0].id as string;
  const wurzel = await neu(lagerA, "K");
  const kind = await neu(lagerA, "KK", wurzel);
  expect(
    (await api`select * from ressort where id = ${kind}`)[0],
  ).toMatchObject({
    version: 1,
    reihenfolge: 0,
    geloescht_am: null,
  });
  // Kürzel je Lager einmal (ohne Gross- und Kleinschreibung), nach Soft-Delete wieder frei, im anderen Lager frei
  await expect(neu(lagerA, "k")).rejects.toMatchObject({ code: "23505" });
  await neu(lagerB, "K");
  await api`update ressort set geloescht_am = now() where id = ${kind}`;
  await neu(lagerA, "KK");
  // Ein Elternteil aus einem anderen Lager, ein Ressort unter sich selbst, ungültige Werte
  await expect(neu(lagerB, "X", wurzel)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(
    api`update ressort set parent_id = id where id = ${wurzel}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(neu(lagerA, "")).rejects.toMatchObject({ code: "23514" });
  await expect(neu(lagerA, "x".repeat(21))).rejects.toMatchObject({
    code: "23514",
  });
  // Links nur https; Link und Notiz nur zu einem Ressort desselben Lagers
  await api`insert into ressort_link (lager_id, ressort_id, titel, url, lager_seq) values (${lagerA}, ${wurzel}, 'Plan', 'https://example.org/x', 2)`;
  for (const url of [
    "http://example.org",
    "javascript:alert(1)",
    "https://a b",
  ]) {
    await expect(
      api`insert into ressort_link (lager_id, ressort_id, titel, url, lager_seq) values (${lagerA}, ${wurzel}, 'Plan', ${url}, 2)`,
    ).rejects.toMatchObject({ code: "23514" });
  }
  await expect(
    api`insert into ressort_link (lager_id, ressort_id, titel, url, lager_seq) values (${lagerB}, ${wurzel}, 'Plan', 'https://example.org', 2)`,
  ).rejects.toMatchObject({ code: "23503" });
  await api`insert into ressort_notiz (lager_id, ressort_id, text, lager_seq) values (${lagerA}, ${wurzel}, 'Notiz', 3)`;
  await expect(
    api`insert into ressort_notiz (lager_id, ressort_id, text, lager_seq) values (${lagerB}, ${wurzel}, 'Notiz', 3)`,
  ).rejects.toMatchObject({ code: "23503" });

  // lager_mitglied.ressort_id: nur ein Ressort des eigenen Lagers; beim Löschen des Ressorts nur diese Spalte leeren
  const fremd = await neu(lagerB, "F");
  await expect(
    api`update lager_mitglied set ressort_id = ${fremd} where lager_id = ${lagerA}`,
  ).rejects.toMatchObject({ code: "23503" });
  await api`update lager_mitglied set ressort_id = ${wurzel} where lager_id = ${lagerA}`;
  await api`delete from ressort_link where ressort_id = ${wurzel}`;
  await api`delete from ressort_notiz where ressort_id = ${wurzel}`;
  await api`delete from ressort where parent_id = ${wurzel}`;
  await api`delete from ressort where id = ${wurzel}`;
  expect(
    (await api`select lager_id, ressort_id from lager_mitglied`)[0],
  ).toEqual({ lager_id: lagerA, ressort_id: null });

  // Das Lager nimmt alles mit
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from ressort where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0067, Mitglied bleibt
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0067_lager_ressorts.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select * from lager_mitglied`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0067 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(3);
}, 60_000);
