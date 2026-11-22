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

// 0126 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0125 migrieren, füllen, dann 0126 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig449_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig449-"));
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
  ordnerBauen(bisVorher, 125);
  ordnerBauen(komplett, 126);
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
const objekte = async () =>
  (
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'programm_stufe%' order by 1`
  ).map((z) => z.table_name as string);
const tagsVon = async (programmId: string) =>
  (
    await besitzer`select tag_id from programm_tag where programm_id = ${programmId}`
  )
    .map((z) => z.tag_id as string)
    .sort();

test("0126: Zuordnungen wandern verlustfrei in programm_tag, programm_stufe entfällt, der Rückweg stellt sie her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await objekte()).toEqual(["programm_stufe", "programm_stufe_wirksam"]);

  const abteilung = async (name: string) =>
    (
      await besitzer`insert into abteilung (name) values (${name}) returning id`
    )[0].id as string;
  const [eins, zwei] = [await abteilung("Eins"), await abteilung("Zwei")];
  const tag = async (abt: string, typ: string, name: string) =>
    (
      await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abt}, ${typ}, ${name}, ${name.slice(0, 2)}) returning id`
    )[0].id as string;
  const [biber, wolf] = [
    await tag(eins, "stufe", "Biber"),
    await tag(eins, "stufe", "Wolf"),
  ];
  const fremd = await tag(zwei, "stufe", "Fremd");
  const team = await tag(eins, "team", "Team");
  const programm = async (abt: string, titel: string) =>
    (
      await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende) values (${abt}, ${randomUUID()}, ${titel}, false, '2027-09-04T12:00Z', '2027-09-04T14:00Z') returning id`
    )[0].id as string;
  const mitStufe = await programm(eins, "Mit Stufe");
  const mitBeiden = await programm(eins, "Mit beiden");
  const ohneZuordnung = await programm(eins, "Für alle Stufen");
  const fremdes = await programm(zwei, "Fremd");
  const bereitsGetaggt = await programm(eins, "Schon mit Tag");
  await besitzer`insert into programm_stufe (programm_id, stufe_id) values (${mitStufe}, ${biber}), (${mitBeiden}, ${biber}), (${mitBeiden}, ${wolf}), (${bereitsGetaggt}, ${biber})`;
  // Ein Tag, den der Abgleich schon aus einer Kategorie gesetzt hat, bleibt; die Zuordnung dazu ist kein Duplikat
  await besitzer`insert into programm_tag (programm_id, tag_id) values (${bereitsGetaggt}, ${biber}), (${bereitsGetaggt}, ${team})`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  // Nichts liest mehr aus der Tabelle oder der Sicht: beide sind weg
  expect(await objekte()).toEqual([]);

  expect(await tagsVon(mitStufe)).toEqual([biber]);
  expect(await tagsVon(mitBeiden)).toEqual([biber, wolf].sort());
  // Ohne Zuordnung galt das Programm für alle Stufen der Abteilung: genau diese, keine fremde und kein Team-Tag
  expect(await tagsVon(ohneZuordnung)).toEqual([biber, wolf].sort());
  expect(await tagsVon(fremdes)).toEqual([fremd]);
  expect(await tagsVon(bereitsGetaggt)).toEqual([biber, team].sort());

  // Rückweg: Tabelle und Sicht sind wieder da, die Zuordnung steht ausdrücklich darin, die Tags bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0126_programm_stufe_abbau.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await objekte()).toEqual(["programm_stufe", "programm_stufe_wirksam"]);
  const wirksam = async (programmId: string) =>
    (
      await besitzer`select stufe_id from programm_stufe_wirksam where programm_id = ${programmId}`
    )
      .map((z) => z.stufe_id as string)
      .sort();
  expect(await wirksam(mitStufe)).toEqual([biber]);
  expect(await wirksam(ohneZuordnung)).toEqual([biber, wolf].sort());
  expect(await tagsVon(bereitsGetaggt)).toEqual([biber, team].sort());

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0126 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await objekte()).toEqual([]);
  expect(await tagsVon(mitBeiden)).toEqual([biber, wolf].sort());
}, 120_000);
