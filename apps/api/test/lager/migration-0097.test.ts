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

// 0097 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0096 migrieren (was davon im Journal steht), dann 0097 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig389_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig389-"));
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
  ordnerBauen(bisVorher, 96);
  ordnerBauen(komplett, 97);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'diensttausch'`
  ).map((z) => z.table_name);

test("0097 legt diensttausch an, die API-Rolle darf sie nutzen, die Regeln der Tabelle gelten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const person = async () =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const [von, mit, nichtMitglied] = [
    await person(),
    await person(),
    await person(),
  ];
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;
  for (const p of [von, mit]) {
    await besitzer`insert into lager_mitglied (lager_id, person_id, rolle) values (${lager.id}, ${p}, 'team')`;
  }
  const [tag] =
    await besitzer`insert into lagertag (lager_id, datum, lager_seq) values (${lager.id}, '2027-07-10', 1) returning id`;
  const [abschnitt] =
    await besitzer`insert into tagesabschnitt (lager_id, name, lager_seq) values (${lager.id}, 'Morgen', 1) returning id`;
  const [dienst] =
    await besitzer`insert into dienst (lager_id, name, tagesabschnitt_id, lager_seq) values (${lager.id}, 'Küche', ${abschnitt.id}, 1) returning id`;
  const schicht = async (p: string, t = tag.id) =>
    (
      await besitzer`insert into schicht (lager_id, lagertag_id, tagesabschnitt_id, dienst_id, person_id, lager_seq) values (${lager.id}, ${t}, ${abschnitt.id}, ${dienst.id}, ${p}, 1) returning id`
    )[0].id as string;
  const meine = await schicht(von);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["diensttausch"]);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  await api`insert into diensttausch (lager_id, von_person_id, schicht_id, lager_seq) values (${lager.id}, ${von}, ${meine}, 2)`;
  const [zeile] = await api`select * from diensttausch`;
  expect(zeile).toMatchObject({
    status: "offen",
    version: 1,
    mit_person_id: null,
    mit_schicht_id: null,
    entschieden_am: null,
  });
  expect(zeile.id).toMatch(/^[0-9a-f-]{36}$/);
  // Je Schicht nur eine offene Anfrage
  await expect(
    api`insert into diensttausch (lager_id, von_person_id, schicht_id, lager_seq) values (${lager.id}, ${von}, ${meine}, 3)`,
  ).rejects.toMatchObject({ code: "23505" });
  // Entschieden braucht einen Zeitpunkt und umgekehrt; der Stand ist begrenzt
  await expect(
    api`update diensttausch set status = 'angenommen' where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`update diensttausch set status = 'egal', entschieden_am = now() where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  // Wunschschicht ohne Wunschperson, Wunschperson gleich anfragende Person und Wunschschicht gleich eigene Schicht sind verboten
  const andere = await schicht(
    mit,
    (
      await besitzer`insert into lagertag (lager_id, datum, lager_seq) values (${lager.id}, '2027-07-11', 1) returning id`
    )[0].id,
  );
  await expect(
    api`update diensttausch set mit_schicht_id = ${andere} where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`update diensttausch set mit_person_id = ${von} where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`update diensttausch set mit_person_id = ${mit}, mit_schicht_id = ${meine} where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  await api`update diensttausch set mit_person_id = ${mit}, mit_schicht_id = ${andere} where id = ${zeile.id}`;
  // Beide Personen müssen Mitglied des Lagers sein
  await expect(
    api`update diensttausch set mit_person_id = ${nichtMitglied}, mit_schicht_id = null where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    api`update diensttausch set notiz = '' where id = ${zeile.id}`,
  ).rejects.toMatchObject({ code: "23514" });

  // Mit der Schicht geht die Anfrage
  await besitzer`delete from schicht where id = ${meine}`;
  expect(await api`select * from diensttausch`).toHaveLength(0);
  const neu = await schicht(von, tag.id).catch(() => schicht(von));
  await api`insert into diensttausch (lager_id, von_person_id, schicht_id, lager_seq) values (${lager.id}, ${von}, ${neu}, 4)`;
  // Mit dem Lager ebenso
  await api`delete from lager where id = ${lager.id}`;
  expect(await api`select * from diensttausch`).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0097, Stand von vorher
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0097_lager_diensttausch.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0097 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["diensttausch"]);
}, 60_000);
