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

// 0084 und ihr Rückweg gegen eine eigene Datenbank: erst bis zur Migration vor 0084 migrieren, dann 0084 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig388_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig388-"));
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
  ordnerBauen(bisVorher, 83);
  // Alles bis 0084: spätere Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 84);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('dienst', 'schicht') order by 1`
  ).map((z) => z.table_name);

test("0084 legt Dienste und Schichten an, Checks, Teilindizes und Fremdschlüssel halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const person = async () =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const [p1, ausserhalb] = [await person(), await person()];
  const lager = async () =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [lagerA, lagerB] = [await lager(), await lager()];
  await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lagerA}, ${p1}, 'team')`;
  const tag = async (lagerId: string) =>
    (
      await besitzer`insert into lagertag (lager_id, datum, lager_seq) values (${lagerId}, '2027-07-10', 1) returning id`
    )[0].id as string;
  const abschnitt = async (lagerId: string, name: string) =>
    (
      await besitzer`insert into tagesabschnitt (lager_id, name, lager_seq) values (${lagerId}, ${name}, 1) returning id`
    )[0].id as string;
  const [tagA, tagB] = [await tag(lagerA), await tag(lagerB)];
  const [abA, abA2, abB] = [
    await abschnitt(lagerA, "Mittag"),
    await abschnitt(lagerA, "Abend"),
    await abschnitt(lagerB, "Mittag"),
  ];
  const [kind] =
    await besitzer`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${lagerA}, 'Kind', 'Eins', 1) returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["dienst", "schicht"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const dienst = async (
    lagerId: string,
    abschnittId: string,
    werte: Partial<{
      name: string;
      beschreibung: string | null;
      mindest: number;
      reihenfolge: number;
    }> = {},
  ) => {
    const w = {
      name: "Küche",
      beschreibung: null,
      mindest: 2,
      reihenfolge: 0,
      ...werte,
    };
    return (
      await api`insert into dienst (lager_id, name, beschreibung, mindestbesetzung, tagesabschnitt_id, reihenfolge, lager_seq) values (${lagerId}, ${w.name}, ${w.beschreibung}, ${w.mindest}, ${abschnittId}, ${w.reihenfolge}, 1) returning id`
    )[0].id as string;
  };
  const d = await dienst(lagerA, abA);
  expect((await api`select * from dienst where id = ${d}`)[0]).toMatchObject({
    version: 1,
    geloescht_am: null,
    nacht: false,
    mindestbesetzung: 2,
  });
  const fehler = (
    lagerId: string,
    abschnittId: string,
    werte: Parameters<typeof dienst>[2],
    code: string,
  ) =>
    expect(dienst(lagerId, abschnittId, werte)).rejects.toMatchObject({ code });
  // Name, Beschreibung, Mindestbesetzung und Reihenfolge haben Grenzen
  await fehler(lagerA, abA, { name: "" }, "23514");
  await fehler(lagerA, abA, { name: "x".repeat(101) }, "23514");
  await fehler(lagerA, abA, { name: "A", beschreibung: "" }, "23514");
  await fehler(
    lagerA,
    abA,
    { name: "B", beschreibung: "x".repeat(501) },
    "23514",
  );
  await fehler(lagerA, abA, { name: "C", mindest: 0 }, "23514");
  await fehler(lagerA, abA, { name: "D", mindest: 21 }, "23514");
  await fehler(lagerA, abA, { name: "E", reihenfolge: -1 }, "23514");
  // Der Name ist je Abschnitt eindeutig, ohne Beachtung der Schreibweise; in einem anderen Abschnitt und nach Soft-Delete ist er frei
  await fehler(lagerA, abA, { name: "KÜCHE" }, "23505");
  const d2 = await dienst(lagerA, abA2);
  await api`update dienst set geloescht_am = now() where id = ${d}`;
  const d3 = await dienst(lagerA, abA);
  // Ein Abschnitt eines anderen Lagers: Fremdschlüssel über Lager und ID
  await fehler(lagerA, abB, { name: "Fremd" }, "23503");

  // Schicht: genau eines von person_id und teilnehmer_id, Abschnitt gleich dem des Dienstes, Lagertag, Person und Teilnehmender des Lagers
  const schicht = (
    lagerId: string,
    tagId: string,
    abschnittId: string,
    dienstId: string,
    personId: string | null,
    teilnehmerId: string | null,
  ) =>
    api`insert into schicht (lager_id, lagertag_id, tagesabschnitt_id, dienst_id, person_id, teilnehmer_id, lager_seq) values (${lagerId}, ${tagId}, ${abschnittId}, ${dienstId}, ${personId}, ${teilnehmerId}, 2)`;
  await schicht(lagerA, tagA, abA, d3, p1, null);
  await schicht(lagerA, tagA, abA, d3, null, kind.id);
  await expect(
    schicht(lagerA, tagA, abA, d3, null, null),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    schicht(lagerA, tagA, abA, d3, p1, kind.id),
  ).rejects.toMatchObject({ code: "23514" });
  // Eine Person ist je Tag und Abschnitt nur einmal eingeteilt, auch nicht in einem zweiten Dienst desselben Abschnitts
  const d4 = await dienst(lagerA, abA, { name: "Abwasch" });
  await expect(schicht(lagerA, tagA, abA, d3, p1, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(schicht(lagerA, tagA, abA, d4, p1, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(
    schicht(lagerA, tagA, abA, d4, null, kind.id),
  ).rejects.toMatchObject({ code: "23505" });
  // In einem anderen Abschnitt desselben Tages ist sie frei
  await schicht(lagerA, tagA, abA2, d2, p1, null);
  // Der Abschnitt der Schicht muss der des Dienstes sein
  await expect(
    schicht(lagerA, tagA, abA2, d3, null, kind.id),
  ).rejects.toMatchObject({ code: "23503" });
  // Ein Dienst, Tag oder eine Person eines anderen Lagers: Fremdschlüssel über Lager und ID
  await expect(schicht(lagerB, tagB, abB, d3, p1, null)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(schicht(lagerA, tagB, abA, d4, p1, null)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(
    schicht(lagerA, tagA, abA, d4, ausserhalb, null),
  ).rejects.toMatchObject({ code: "23503" });
  // Nach Soft-Delete ist der Platz wieder frei
  await api`update schicht set geloescht_am = now() where person_id = ${p1} and dienst_id = ${d3}`;
  await schicht(lagerA, tagA, abA, d4, p1, null);

  // Löschen des Dienstes nimmt seine Schichten mit
  await api`delete from dienst where id = ${d4}`;
  expect(await api`select * from schicht where dienst_id = ${d4}`).toHaveLength(
    0,
  );
  // Der Teilnehmende nimmt seine Schichten mit, das Mitglied ebenso, das Lager alles
  await api`delete from teilnehmer where id = ${kind.id}`;
  expect(
    await api`select * from schicht where teilnehmer_id = ${kind.id}`,
  ).toHaveLength(0);
  await besitzer`delete from lager_mitglied where lager_id = ${lagerA} and person_id = ${p1}`;
  expect(await api`select * from schicht where person_id = ${p1}`).toHaveLength(
    0,
  );
  await api`delete from lager where id = ${lagerA}`;
  expect(
    await api`select * from dienst where lager_id = ${lagerA}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0084
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0084_lager_schichtplan.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0084 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["dienst", "schicht"]);
}, 60_000);
