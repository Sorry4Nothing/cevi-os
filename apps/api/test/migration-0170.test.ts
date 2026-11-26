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
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0169 (ohne «Wer meldet sich an?») und 0170 (Rollen in der Sichtbarkeit) mit ihren Rückwegen gegen eine eigene Datenbank mit Daten (#844)
const dbName = `cevi_os_mig844_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig844-"));
const bis168 = join(temp, "bis168");
const bis169 = join(temp, "bis169");
const komplett = join(temp, "komplett");

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
  ordnerBauen(bis168, 168);
  ordnerBauen(bis169, 169);
  ordnerBauen(komplett, 170);
});

afterAll(async () => {
  await besitzer?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const spalte = async (tabelle: string, name: string) =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_name = ${tabelle} and column_name = ${name}`
  )[0].n === 1;
const rueckweg = (datei: string) =>
  besitzer.unsafe(
    readFileSync(
      new URL(`../drizzle/rueckweg/${datei}`, import.meta.url),
      "utf8",
    ),
  );

test("0169: Anlässe und Anmeldungen bleiben, die Spalte fällt weg; der Rückweg leitet «kind» oder «person» aus den Anmeldungen ab", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bis168 });
  const vorher = await anzahlMigrationen();
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const person = (
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Test Person', ${`p-${randomUUID()}@test.invalid`}, ${abteilung}) returning id`
  )[0].id as string;
  const anlass = async (titel: string, fuer: "kind" | "person") => {
    const [p] =
      await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis) values (${abteilung}, ${"g-" + titel}, ${titel}, true, '2027-05-01', '2027-05-01') returning id`;
    return (
      await besitzer`insert into anlass (abteilung_id, programm_id, anmeldung_fuer, sichtbarkeit) values (${abteilung}, ${p.id}, ${fuer}, 'angemeldet') returning id`
    )[0].id as string;
  };
  const leer = await anlass("Leer", "kind");
  const selbst = await anlass("Selbst", "person");
  await besitzer`insert into anlass_anmeldung (anlass_id, user_id, status) values (${selbst}, ${person}, 'angemeldet')`;

  await migrate(drizzle(besitzer), { migrationsFolder: bis169 });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte("anlass", "anmeldung_fuer")).toBe(false);
  expect(
    (await besitzer`select count(*)::int as n from anlass_anmeldung`)[0].n,
  ).toBe(1);
  // Ein neuer Anlass braucht die Angabe nicht mehr
  const [p] =
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis) values (${abteilung}, 'g-neu', 'Neu', true, '2027-06-01', '2027-06-01') returning id`;
  await besitzer`insert into anlass (abteilung_id, programm_id, sichtbarkeit) values (${abteilung}, ${p.id}, 'angemeldet')`;

  await rueckweg("0169_anlass_ohne_anmeldung_fuer.sql");
  expect(await anzahlMigrationen()).toBe(vorher);
  const werte = Object.fromEntries(
    (await besitzer`select id, anmeldung_fuer from anlass`).map((z) => [
      z.id,
      z.anmeldung_fuer,
    ]),
  );
  expect(werte[leer]).toBe("kind");
  expect(werte[selbst]).toBe("person");
  await expect(
    besitzer`update anlass set anmeldung_fuer = 'alle' where id = ${leer}`,
  ).rejects.toThrow(/anlass_anmeldung_fuer_check/);
}, 120_000);

test("0170: bestehende Seiten und Anlässe bleiben ohne Einschränkung; der Rückweg nimmt eingeschränkte Tags aus der Menge (fail-closed), auch in Bausteinen", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  const vorher = await anzahlMigrationen();
  expect(await spalte("seite", "sichtbarkeit_rollen")).toBe(true);
  expect(await spalte("anlass", "sichtbarkeit_rollen")).toBe(true);
  expect(
    (
      await besitzer`select count(*)::int as n from anlass where sichtbarkeit_rollen <> '{}'::jsonb`
    )[0].n,
  ).toBe(0);
  const [abteilung] = await besitzer`select id from abteilung limit 1`;
  const tag = async (name: string) =>
    (
      await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung.id}, 'stufe', ${name}, '') returning id`
    )[0].id as string;
  const a = await tag("Stufe A");
  const b = await tag("Stufe B");
  const rollen = { [a]: ["leitung"] };
  await expect(
    besitzer`insert into seite (abteilung_id, adresse, titel, sichtbarkeit, sichtbarkeit_rollen) values (${abteilung.id}, 'falsch', 'Falsch', 'tags', '[]'::jsonb)`,
  ).rejects.toThrow(/seite_sichtbarkeit_rollen_check/);
  const baustein = (tagIds: string[], r?: object) => ({
    id: randomUUID(),
    typ: "ueberschrift",
    daten: { ebene: 2, text: "x" },
    sichtbarkeit: { art: "tags", tagIds, ...(r && { rollen: r }) },
  });
  const dok = {
    bausteine: [
      baustein([a, b], rollen),
      baustein([b]),
      { ...baustein([]), sichtbarkeit: "erbt" },
    ],
  };
  const [seite] =
    await besitzer`insert into seite (abteilung_id, adresse, titel, sichtbarkeit, sichtbarkeit_tags, sichtbarkeit_rollen, entwurf) values (${abteilung.id}, 'stufen', 'Stufen', 'tags', ${`{${a},${b}}`}::uuid[], ${JSON.stringify(rollen)}::jsonb, ${JSON.stringify(dok)}::jsonb) returning id`;
  await besitzer`insert into seite_version (seite_id, nr, inhalt) values (${seite.id}, 1, ${JSON.stringify(dok)}::jsonb)`;
  const [anlass] = await besitzer`select id from anlass limit 1`;
  await besitzer`update anlass set sichtbarkeit = 'tags', sichtbarkeit_tags = ${`{${a}}`}::uuid[], sichtbarkeit_rollen = ${JSON.stringify(rollen)}::jsonb where id = ${anlass.id}`;

  await rueckweg("0170_sichtbarkeit_rollen.sql");
  expect(await anzahlMigrationen()).toBe(vorher - 1);
  expect(await spalte("seite", "sichtbarkeit_rollen")).toBe(false);
  const [s] =
    await besitzer`select sichtbarkeit_tags, entwurf from seite where id = ${seite.id}`;
  expect(s.sichtbarkeit_tags).toEqual([b]);
  const erwartet = [
    { ...dok.bausteine[0], sichtbarkeit: { art: "tags", tagIds: [b] } },
    dok.bausteine[1],
    dok.bausteine[2],
  ];
  expect(s.entwurf.bausteine).toEqual(erwartet);
  const [v] =
    await besitzer`select inhalt from seite_version where seite_id = ${seite.id}`;
  expect(v.inhalt.bausteine).toEqual(erwartet);
  // Der Anlass behält «tags», aber ohne den eingeschränkten Tag sieht ihn nur noch die Abteilungsleitung
  const [x] =
    await besitzer`select sichtbarkeit, sichtbarkeit_tags from anlass where id = ${anlass.id}`;
  expect(x).toEqual({ sichtbarkeit: "tags", sichtbarkeit_tags: [] });

  // Erneut vorwärts
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalte("anlass", "sichtbarkeit_rollen")).toBe(true);
}, 120_000);
