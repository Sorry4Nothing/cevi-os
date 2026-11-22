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
import { WEBMASTER_VORGABE } from "../src/plattform.js";
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0101 und ihr Rückweg gegen eine eigene Datenbank: «alle Seiten» (Zeile in bearbeiter ohne objekt_id) wird zur Vergabe der Rolle Webmaster (#426)
const dbName = `cevi_os_mig426_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig426-"));
const bis99 = join(temp, "bis99");
const bis100 = join(temp, "bis100");
const bis101 = join(temp, "bis101");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

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
  ordnerBauen(bis99, 99);
  ordnerBauen(bis100, 100);
  ordnerBauen(bis101, 101);
});

afterAll(async () => {
  await besitzer?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const zahl = async (abfrage: string) =>
  (await besitzer.unsafe(abfrage))[0].n as number;

test("0101 macht aus «alle Seiten» die Rolle Webmaster, der Rückweg stellt die Zeilen wieder her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bis99 });
  // Abteilung Eins gibt es vor 0100 (bekommt die Vorgabe «Webmaster»), Zwei danach (0101 legt sie an)
  const [eins] =
    await besitzer`insert into abteilung (name) values ('Eins') returning id`;
  await migrate(drizzle(besitzer), { migrationsFolder: bis100 });
  const [zwei] =
    await besitzer`insert into abteilung (name) values ('Zwei') returning id`;
  expect(
    await zahl(
      `select count(*)::int as n from plattform_rolle where abteilung_id = '${zwei.id}'`,
    ),
  ).toBe(0);
  const vorher = await zahl(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );

  const person = async (abteilungId: string, name: string) =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values (${name}, ${`${name}-${randomUUID()}@test.invalid`}, ${abteilungId}) returning id`
    )[0].id as string;
  const tag = async (abteilungId: string, name: string) =>
    (
      await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilungId}, 'team', ${name}, 'T') returning id`
    )[0].id as string;
  const traegt = (userId: string, tagId: string) =>
    besitzer`insert into person_tag (user_id, tag_id) values (${userId}, ${tagId})`;
  const zeile = (
    abteilungId: string,
    ziel: { userId?: string; tagId?: string },
    objektId: string | null,
  ) =>
    besitzer`insert into bearbeiter (abteilung_id, objekt_typ, objekt_id, user_id, tag_id) values (${abteilungId}, 'seite', ${objektId}::uuid, ${ziel.userId ?? null}, ${ziel.tagId ?? null})`;

  const einzeln = await person(eins.id, "einzeln");
  const mitglied = await person(eins.id, "mitglied");
  const beides = await person(eins.id, "beides");
  const keines = await person(eins.id, "keines");
  const sonder = await person(eins.id, "sonder");
  const sonderTagMitglied = await person(eins.id, "sondertag");
  const andere = await person(zwei.id, "andere");
  const fremdesMitglied = await person(zwei.id, "fremdes");
  const teamAlle = await tag(eins.id, "Alle Seiten");
  const teamSeite = await tag(eins.id, "Eine Seite");
  const teamZwei = await tag(zwei.id, "Zwei");
  await traegt(mitglied, teamAlle);
  await traegt(beides, teamAlle);
  // Ein Mitglied einer anderen Abteilung (Altlast in den Daten) bekommt nichts
  await traegt(fremdesMitglied, teamAlle);
  await traegt(sonderTagMitglied, teamSeite);
  const seite = randomUUID();
  await zeile(eins.id, { userId: einzeln }, null);
  await zeile(eins.id, { tagId: teamAlle }, null);
  await zeile(eins.id, { userId: beides }, null);
  await zeile(eins.id, { userId: sonder }, seite);
  await zeile(eins.id, { tagId: teamSeite }, seite);
  await zeile(zwei.id, { userId: andere }, null);
  await zeile(zwei.id, { tagId: teamZwei }, null);

  const zeilenVorher = await zahl("select count(*)::int as n from bearbeiter");
  const alleSeitenVorher = await zahl(
    "select count(*)::int as n from bearbeiter where objekt_id is null",
  );
  expect([zeilenVorher, alleSeitenVorher]).toEqual([7, 5]);
  expect(
    await zahl("select count(*)::int as n from person_plattform_rolle"),
  ).toBe(0);

  await migrate(drizzle(besitzer), { migrationsFolder: bis101 });
  expect(
    await zahl("select count(*)::int as n from drizzle.__drizzle_migrations"),
  ).toBe(vorher + 1);

  // Nachher: keine Zeile «alle Seiten» mehr, die Sonderrechte pro Seite sind unverändert
  expect(
    await zahl(
      "select count(*)::int as n from bearbeiter where objekt_id is null",
    ),
  ).toBe(0);
  expect(await zahl("select count(*)::int as n from bearbeiter")).toBe(
    zeilenVorher - alleSeitenVorher,
  );
  expect(
    await zahl(
      `select count(*)::int as n from bearbeiter where objekt_id = '${seite}' and (user_id = '${sonder}' or tag_id = '${teamSeite}')`,
    ),
  ).toBe(2);

  // Die Rolle Webmaster haben jetzt: die Person mit der Zeile, die Mitglieder des Teams (beides nur einmal), und in Abteilung Zwei die Person und das Mitglied des Teams ohne Mitglieder: nur die Person
  const mitRolle = (
    await besitzer`select p.user_id from person_plattform_rolle p join plattform_rolle r on r.id = p.rolle_id where r.schluessel = 'webmaster'`
  )
    .map((z) => z.user_id as string)
    .sort();
  expect(mitRolle).toEqual([einzeln, mitglied, beides, andere].sort());
  expect(
    await zahl("select count(*)::int as n from person_plattform_rolle"),
  ).toBe(4);
  // Wer nur ein Sonderrecht hatte, bekommt keine Rolle; ebenso das Mitglied einer anderen Abteilung
  for (const id of [keines, sonder, sonderTagMitglied, fremdesMitglied]) {
    expect(
      await zahl(
        `select count(*)::int as n from person_plattform_rolle where user_id = '${id}'`,
      ),
    ).toBe(0);
  }
  // Abteilung Zwei hat jetzt die Vorgabe mit allen Rechten ausser dem Wartungsmodus; Abteilung Eins behielt ihre (keine zweite)
  const rollen = await besitzer`select id, abteilung_id from plattform_rolle`;
  expect(rollen).toHaveLength(2);
  for (const r of rollen) {
    const rechte =
      await besitzer`select recht from plattform_rolle_recht where rolle_id = ${r.id}`;
    expect(rechte.map((x) => x.recht).sort()).toEqual(
      [...WEBMASTER_VORGABE].sort(),
    );
  }

  // Die Datenbank verlangt ein Objekt: «alle Seiten» gibt es als Zeile nicht mehr
  await expect(zeile(eins.id, { userId: keines }, null)).rejects.toMatchObject({
    code: "23502",
  });

  // Rückweg: Journal ohne 0101, jede Person mit dem Recht «Seiten bearbeiten» hat wieder eine Zeile «alle Seiten»; die Sonderrechte bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0101_bearbeiter_ohne_alle_seiten.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(
    await zahl("select count(*)::int as n from drizzle.__drizzle_migrations"),
  ).toBe(vorher);
  const zurueck = (
    await besitzer`select user_id from bearbeiter where objekt_id is null`
  )
    .map((z) => z.user_id as string)
    .sort();
  expect(zurueck).toEqual([einzeln, mitglied, beides, andere].sort());
  expect(await zahl("select count(*)::int as n from bearbeiter")).toBe(
    zeilenVorher - alleSeitenVorher + 4,
  );

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0101 wieder läuft (die Zeilen gehen wieder in die Rolle über)
  await migrate(drizzle(besitzer), { migrationsFolder: bis101 });
  expect(
    await zahl(
      "select count(*)::int as n from bearbeiter where objekt_id is null",
    ),
  ).toBe(0);
  expect(
    await zahl("select count(*)::int as n from person_plattform_rolle"),
  ).toBe(4);
}, 90_000);
