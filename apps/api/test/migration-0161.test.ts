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

// 0161 und ihr Rückweg gegen eine eigene Datenbank mit Daten (#779): erst alle Migrationen bis 0160, Kinder und Teilnehmende anlegen, dann 0161 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_779_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig779-"));
const bisVorher = join(temp, "vorher");
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
  ordnerBauen(bisVorher, 160);
  ordnerBauen(komplett, 161);
}, 60_000);

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
const loeschRegel = async () =>
  (
    await besitzer`select confdeltype::text as t from pg_constraint where conname = 'teilnehmer_kind_id_kind_id_fk'`
  )[0].t as string;
const indexe = async () =>
  (
    await besitzer`select count(*)::int as n from pg_indexes where indexname = 'teilnehmer_kind_idx'`
  )[0].n as number;
const zuordnung = async () =>
  Object.fromEntries(
    (
      await besitzer`select t.vorname || ' ' || t.nachname || ' / ' || l.titel as wer, t.kind_id from teilnehmer t join lager l on l.id = t.lager_id`
    ).map((z) => [z.wer as string, z.kind_id as string | null]),
  );

test("0161: kind_id nur bei genau einem Kind und genau einem Teilnehmenden gleichen Namens, Fremdschlüssel CASCADE; der Rückweg stellt SET NULL her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await loeschRegel()).toBe("n");

  const [eins, zwei] = (
    await besitzer`insert into abteilung (name) values ('Eins'), ('Zwei') returning id`
  ).map((z) => z.id as string);
  const stufe = async (abteilung: string) =>
    (
      await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'stufe', 'Stufe', 'S') returning id`
    )[0].id as string;
  const [stufeEins, stufeZwei] = [await stufe(eins), await stufe(zwei)];
  const kind = async (
    abteilung: string,
    stufeId: string,
    vorname: string,
    nachname: string,
  ) =>
    (
      await besitzer`insert into kind (abteilung_id, vorname, nachname, stufe_id) values (${abteilung}, ${vorname}, ${nachname}, ${stufeId}) returning id`
    )[0].id as string;
  const anna = await kind(eins, stufeEins, "Anna", "Muster");
  await kind(eins, stufeEins, "Ben", "Doppel");
  await kind(eins, stufeEins, "ben", "doppel");
  const cara = await kind(eins, stufeEins, "Cara", "Gross");
  await kind(zwei, stufeZwei, "Dora", "Fremd");
  const lager = async (abteilung: string, titel: string) =>
    (
      await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung}, ${titel}, '2027-07-10', '2027-07-24') returning id`
    )[0].id as string;
  const [l1, l2] = [await lager(eins, "L1"), await lager(eins, "L2")];
  const teilnehmer = (l: string, vorname: string, nachname: string) =>
    besitzer`insert into teilnehmer (lager_id, vorname, nachname, lager_seq) values (${l}, ${vorname}, ${nachname}, 1)`;
  await teilnehmer(l1, "anna", "MUSTER");
  await teilnehmer(l1, "Ben", "Doppel");
  await teilnehmer(l1, "Cara", "Gross");
  await teilnehmer(l1, "cara", "gross");
  await teilnehmer(l1, "Dora", "Fremd");
  await teilnehmer(l1, "Eva", "Ohne");
  await teilnehmer(l2, "Cara", "Gross");

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await loeschRegel()).toBe("c");
  expect(await indexe()).toBe(1);
  // Gleiche Namen in anderer Schreibung zählen; zwei Kinder, zwei Teilnehmende oder eine andere Abteilung: nie raten
  expect(await zuordnung()).toEqual({
    "anna MUSTER / L1": anna,
    "Ben Doppel / L1": null,
    "Cara Gross / L1": null,
    "cara gross / L1": null,
    "Dora Fremd / L1": null,
    "Eva Ohne / L1": null,
    "Cara Gross / L2": cara,
  });

  // Das Löschen des Kindes löscht seine Teilnehmenden, andere bleiben
  await besitzer`delete from kind where id = ${anna}`;
  expect(Object.keys(await zuordnung())).not.toContain("anna MUSTER / L1");
  expect(Object.keys(await zuordnung())).toHaveLength(6);

  // Rückweg: SET NULL, Index weg, Journal zurück
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0161_teilnehmer_kind_cascade.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await loeschRegel()).toBe("n");
  expect(await indexe()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  await besitzer`delete from kind where id = ${cara}`;
  expect(await zuordnung()).toMatchObject({ "Cara Gross / L2": null });

  // Nach dem Rückweg lässt sich 0161 wieder anwenden
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await loeschRegel()).toBe("c");
}, 120_000);
