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

// 0073 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0072 migrieren (was davon im Journal steht), dann 0073 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig378_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig378-"));
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
  ordnerBauen(bisVorher, 72);
  // Alles bis 0073: spätere Lager-Migrationen (ab 0074) sind für diesen Test ohne Belang
  ordnerBauen(komplett, 73);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'hoeck%' or table_name like 'traktandum%') order by 1`
  ).map((z) => z.table_name);

test("0073 legt Höcks und Traktanden an, die Fremdschlüssel halten das Lager, der Rückweg räumt auf", async () => {
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
  expect(await tabellen()).toEqual([
    "hoeck",
    "hoeck_anwesenheit",
    "traktandum",
    "traktandum_verantwortlich",
  ]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const hoeck = async (
    lagerId: string,
    extra: { art?: string; zeit?: string | null; titel?: string } = {},
  ) =>
    (
      await api`insert into hoeck (lager_id, art, datum, zeit, titel, lager_seq) values (${lagerId}, ${extra.art ?? "team"}, '2027-06-15', ${extra.zeit ?? null}, ${extra.titel ?? "Planung"}, 1) returning id`
    )[0].id as string;
  const h = await hoeck(lagerA, { zeit: "19:30" });
  expect((await api`select * from hoeck where id = ${h}`)[0]).toMatchObject({
    version: 1,
    art: "team",
    zeit: "19:30",
    gaeste: null,
    protokoll_id: null,
    geloescht_am: null,
  });

  // Ungültige Werte: Art, Zeit, Titel
  await expect(hoeck(lagerA, { art: "alle" })).rejects.toMatchObject({
    code: "23514",
  });
  for (const zeit of ["24:00", "7:30", "19:60", "19:30:00", ""]) {
    await expect(hoeck(lagerA, { zeit })).rejects.toMatchObject({
      code: "23514",
    });
  }
  await expect(hoeck(lagerA, { titel: "" })).rejects.toMatchObject({
    code: "23514",
  });
  await expect(hoeck(lagerA, { titel: "x".repeat(201) })).rejects.toMatchObject(
    { code: "23514" },
  );

  // Anwesenheit: nur Mitglieder des Lagers, höchstens ein Haken je Person, nur beim Höck des eigenen Lagers
  await api`insert into hoeck_anwesenheit (lager_id, hoeck_id, person_id) values (${lagerA}, ${h}, ${p1})`;
  await expect(
    api`insert into hoeck_anwesenheit (lager_id, hoeck_id, person_id) values (${lagerA}, ${h}, ${p1})`,
  ).rejects.toMatchObject({ code: "23505" });
  const fremderHoeck = await hoeck(lagerB);
  await expect(
    api`insert into hoeck_anwesenheit (lager_id, hoeck_id, person_id) values (${lagerA}, ${fremderHoeck}, ${p1})`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`insert into hoeck_anwesenheit (lager_id, hoeck_id, person_id) values (${lagerB}, ${fremderHoeck}, ${p1})`,
  ).rejects.toMatchObject({ code: "23503" });

  // Traktanden: ohne Höck erlaubt (nächster Höck), mit Höck nur aus dem eigenen Lager
  const traktandum = async (
    lagerId: string,
    extra: {
      hoeck?: string | null;
      aufgabe?: string | null;
      titel?: string;
      entscheid?: string | null;
      links?: unknown;
      status?: string;
      reihenfolge?: number;
    } = {},
  ) =>
    (
      await api`insert into traktandum (lager_id, hoeck_id, aufgabe_id, titel, entscheid, links, status, reihenfolge, lager_seq) values (${lagerId}, ${extra.hoeck ?? null}, ${extra.aufgabe ?? null}, ${extra.titel ?? "Budget"}, ${extra.entscheid ?? null}, ${api.json((extra.links ?? []) as never)}, ${extra.status ?? "offen"}, ${extra.reihenfolge ?? 0}, 1) returning id`
    )[0].id as string;
  const t = await traktandum(lagerA, { hoeck: h });
  const lose = await traktandum(lagerA);
  expect(
    (
      await api`select hoeck_id, status, links from traktandum where id = ${lose}`
    )[0],
  ).toEqual({ hoeck_id: null, status: "offen", links: [] });
  await expect(
    traktandum(lagerA, { hoeck: fremderHoeck }),
  ).rejects.toMatchObject({ code: "23503" });
  for (const extra of [
    { status: "fertig" },
    { titel: "" },
    { entscheid: "" },
    { entscheid: "x".repeat(1001) },
    { reihenfolge: -1 },
    { links: { a: 1 } },
    {
      links: Array.from({ length: 11 }, () => ({
        titel: "x",
        url: "https://e.ch",
      })),
    },
  ]) {
    await expect(traktandum(lagerA, extra)).rejects.toMatchObject({
      code: "23514",
    });
  }

  // Verantwortliche nur aus dem eigenen Lager und für ein Traktandum des eigenen Lagers
  await api`insert into traktandum_verantwortlich (lager_id, traktandum_id, person_id) values (${lagerA}, ${t}, ${p2})`;
  await expect(
    api`insert into traktandum_verantwortlich (lager_id, traktandum_id, person_id) values (${lagerA}, ${t}, ${p2})`,
  ).rejects.toMatchObject({ code: "23505" });
  const fremdesTraktandum = await traktandum(lagerB);
  await expect(
    api`insert into traktandum_verantwortlich (lager_id, traktandum_id, person_id) values (${lagerA}, ${fremdesTraktandum}, ${p2})`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`insert into traktandum_verantwortlich (lager_id, traktandum_id, person_id) values (${lagerB}, ${fremdesTraktandum}, ${p2})`,
  ).rejects.toMatchObject({ code: "23503" });

  // Aufgabe nur aus dem eigenen Lager; fällt die Aufgabe weg, bleibt das Traktandum ohne Aufgabe
  const aufgabe = async (lagerId: string) =>
    (
      await api`insert into aufgabe (lager_id, titel, lager_seq) values (${lagerId}, 'Aufgabe', 1) returning id`
    )[0].id as string;
  const [aA, aB] = [await aufgabe(lagerA), await aufgabe(lagerB)];
  await expect(traktandum(lagerA, { aufgabe: aB })).rejects.toMatchObject({
    code: "23503",
  });
  const mitAufgabe = await traktandum(lagerA, { hoeck: h, aufgabe: aA });
  await api`delete from aufgabe where id = ${aA}`;
  expect(
    (
      await api`select aufgabe_id, lager_id, hoeck_id from traktandum where id = ${mitAufgabe}`
    )[0],
  ).toEqual({ aufgabe_id: null, lager_id: lagerA, hoeck_id: h });

  // Entfernt die Leitung ein Mitglied, gehen sein Haken und seine Verantwortung mit
  await api`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p1}`;
  expect(await api`select * from hoeck_anwesenheit`).toHaveLength(0);
  await api`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p2}`;
  expect(await api`select * from traktandum_verantwortlich`).toHaveLength(0);

  // Höck weg: seine Traktanden gehen mit, die Punkte für den nächsten Höck bleiben; das Lager nimmt alles mit
  await api`delete from hoeck where id = ${h}`;
  expect(
    (await api`select id from traktandum where lager_id = ${lagerA}`).map(
      (z) => z.id,
    ),
  ).toEqual([lose]);
  await api`delete from lager where id = ${lagerB}`;
  expect(
    await api`select * from hoeck where lager_id = ${lagerB}`,
  ).toHaveLength(0);
  expect(
    await api`select * from traktandum where lager_id = ${lagerB}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0073, Lager und Mitglieder bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0073_lager_hoecks.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select * from lager`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0073 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toHaveLength(4);
}, 60_000);
