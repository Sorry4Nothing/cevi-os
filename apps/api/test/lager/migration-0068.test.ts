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

// 0068 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0067 migrieren (was davon im Journal steht), dann 0068 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig372_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig372-"));
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
  ordnerBauen(bisVorher, 67);
  // Alles bis 0068: spätere Lager-Migrationen (ab 0069) sind für diesen Test ohne Belang
  ordnerBauen(komplett, 68);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'aufgabe%' order by 1`
  ).map((z) => z.table_name);

test("0068 legt Aufgaben und Unterstützung an, die Fremdschlüssel halten das Lager, der Rückweg räumt auf", async () => {
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
  const [p1, p2] = [await person(), await person()];
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lagerA}, ${p1}, 'team'), (${lagerA}, ${p2}, 'team')`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["aufgabe", "aufgabe_unterstuetzung"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const neu = async (
    lagerId: string,
    extra: {
      person?: string | null;
      ressort?: string | null;
      titel?: string;
    } = {},
  ) =>
    (
      await api`insert into aufgabe (lager_id, titel, verantwortlich_person_id, ressort_id, lager_seq) values (${lagerId}, ${extra.titel ?? "Zelte prüfen"}, ${extra.person ?? null}, ${extra.ressort ?? null}, 1) returning id`
    )[0].id as string;
  const a = await neu(lagerA, { person: p1 });
  expect((await api`select * from aufgabe where id = ${a}`)[0]).toMatchObject({
    version: 1,
    status: "offen",
    stern: false,
    laufend: false,
    reihenfolge: 0,
    geloescht_am: null,
    erledigt_am: null,
  });

  // Ungültige Werte: Status, Wiederholung, Titel, Erledigt-Zeitpunkt ohne Status «erledigt» (und umgekehrt)
  await expect(
    api`update aufgabe set status = 'fertig' where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`update aufgabe set wiederholung = 'd1' where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(neu(lagerA, { titel: "" })).rejects.toMatchObject({
    code: "23514",
  });
  await expect(neu(lagerA, { titel: "x".repeat(201) })).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    api`update aufgabe set erledigt_am = now() where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`update aufgabe set status = 'erledigt' where id = ${a}`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`update aufgabe set status = 'erledigt', erledigt_am = now() where id = ${a}`;

  // Verantwortliche nur aus dem eigenen Lager: ein Mitglied von Lager A gilt in Lager B nicht
  await expect(neu(lagerB, { person: p1 })).rejects.toMatchObject({
    code: "23503",
  });
  // Unterstützung nur für Mitglieder und nur für eine Aufgabe des eigenen Lagers
  await api`insert into aufgabe_unterstuetzung (lager_id, aufgabe_id, person_id) values (${lagerA}, ${a}, ${p2})`;
  await expect(
    api`insert into aufgabe_unterstuetzung (lager_id, aufgabe_id, person_id) values (${lagerA}, ${a}, ${p2})`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into aufgabe_unterstuetzung (lager_id, aufgabe_id, person_id) values (${lagerB}, ${a}, ${p1})`,
  ).rejects.toMatchObject({ code: "23503" });
  const fremdeAufgabe = await neu(lagerB);
  await expect(
    api`insert into aufgabe_unterstuetzung (lager_id, aufgabe_id, person_id) values (${lagerA}, ${fremdeAufgabe}, ${p1})`,
  ).rejects.toMatchObject({ code: "23503" });

  // Ressort nur aus dem eigenen Lager; fällt das Ressort weg, bleibt die Aufgabe ohne Ressort
  const ressort = async (lagerId: string, kuerzel: string) =>
    (
      await api`insert into ressort (lager_id, kuerzel, name, lager_seq) values (${lagerId}, ${kuerzel}, 'Küche', 1) returning id`
    )[0].id as string;
  const [rA, rB] = [await ressort(lagerA, "K"), await ressort(lagerB, "K")];
  await expect(neu(lagerA, { ressort: rB })).rejects.toMatchObject({
    code: "23503",
  });
  const mitRessort = await neu(lagerA, { ressort: rA });
  await api`delete from ressort where id = ${rA}`;
  expect(
    (
      await api`select ressort_id, lager_id from aufgabe where id = ${mitRessort}`
    )[0],
  ).toEqual({ ressort_id: null, lager_id: lagerA });

  // Entfernt die Leitung ein Mitglied, verliert die Aufgabe die Verantwortliche (nur diese Spalte)
  await api`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p1}`;
  expect(
    (
      await api`select verantwortlich_person_id, lager_id from aufgabe where id = ${a}`
    )[0],
  ).toEqual({ verantwortlich_person_id: null, lager_id: lagerA });
  // ... und die Unterstützung geht mit dem Mitglied
  await api`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p2}`;
  expect(await api`select * from aufgabe_unterstuetzung`).toHaveLength(0);

  // Aufgabe weg: Unterstützung geht mit; das Lager nimmt alles mit
  await api`insert into lager_mitglied (lager_id, person_id, rolle) values (${lagerA}, ${p2}, 'team')`;
  await api`insert into aufgabe_unterstuetzung (lager_id, aufgabe_id, person_id) values (${lagerA}, ${a}, ${p2})`;
  await api`delete from aufgabe where id = ${a}`;
  expect(await api`select * from aufgabe_unterstuetzung`).toHaveLength(0);
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from aufgabe where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0068, Lager und Mitglieder bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0068_lager_aufgaben.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select * from lager_mitglied`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0068 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(2);
}, 60_000);
