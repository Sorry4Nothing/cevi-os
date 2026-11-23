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

// 0135 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0134 migrieren, füllen, dann 0135 durch den echten Migrator, dann der Rückweg (#626)
const dbName = `cevi_os_mig626_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig626-"));
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
  ordnerBauen(bisVorher, 134);
  ordnerBauen(komplett, 135);
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
const spalte = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'tag' and column_name = 'anlass_id'`
  )[0].n as number;
const rueckweg = () =>
  besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0135_tag_anlass.sql", import.meta.url),
      "utf8",
    ),
  );

test("0135: bestehende Tags bleiben, der Typ «anlass» hängt am Anlass, der Rückweg bricht mit einer Gruppe ab und geht ohne sie", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(0);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const team = (
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'team', 'Mat', '') returning id`
  )[0].id as string;
  // Ohne die Migration kennt der Typ-Check «anlass» nicht
  await expect(
    besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'anlass', 'OK', '')`,
  ).rejects.toThrow();

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte()).toBe(1);
  const [alt] =
    await besitzer`select typ, name, anlass_id from tag where id = ${team}`;
  expect(alt).toMatchObject({ typ: "team", name: "Mat", anlass_id: null });

  const termin = async (titel: string) => {
    const [p] =
      await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis, sichtbarkeit) values (${abteilung}, ${"g-" + titel}, ${titel}, true, '2027-05-01', '2027-05-01', 'intern') returning id`;
    const [a] =
      await besitzer`insert into anlass (abteilung_id, programm_id, anmeldung_fuer, sichtbarkeit) values (${abteilung}, ${p.id}, 'person', 'angemeldet') returning id`;
    return a.id as string;
  };
  const einsA = await termin("Eins");
  const gruppe = (
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel, anlass_id) values (${abteilung}, 'anlass', 'OK Eins', '', ${einsA}) returning id`
  )[0].id as string;
  // Höchstens eine Gruppe je Anlass; die Verknüpfung gibt es nur beim Typ «anlass»
  await expect(
    besitzer`insert into tag (abteilung_id, typ, name, kuerzel, anlass_id) values (${abteilung}, 'anlass', 'Zweite', '', ${einsA})`,
  ).rejects.toThrow(/tag_anlass_eindeutig/);
  await expect(
    besitzer`insert into tag (abteilung_id, typ, name, kuerzel, anlass_id) values (${abteilung}, 'team', 'Falsch', '', ${await termin("Zwei")})`,
  ).rejects.toThrow(/tag_anlass_check/);
  // Ohne Anlass ist der Typ erlaubt (der Anlass wurde gelöscht)
  await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'anlass', 'Frei', '')`;

  // Fällt der Anlass weg, bleibt die Gruppe ohne Verknüpfung
  await besitzer`delete from anlass where id = ${einsA}`;
  const [lose] =
    await besitzer`select typ, anlass_id from tag where id = ${gruppe}`;
  expect(lose).toMatchObject({ typ: "anlass", anlass_id: null });

  // Mit einer Gruppe vom Typ «anlass» bricht der Rückweg ab und ändert nichts
  await expect(rueckweg()).rejects.toThrow(/Typ anlass/);
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte()).toBe(1);

  await besitzer`delete from tag where typ = 'anlass'`;
  await rueckweg();
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await spalte()).toBe(0);
  expect(
    (await besitzer`select name from tag where id = ${team}`)[0].name,
  ).toBe("Mat");
  await expect(
    besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, 'anlass', 'OK', '')`,
  ).rejects.toThrow();

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0135 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalte()).toBe(1);
}, 120_000);
