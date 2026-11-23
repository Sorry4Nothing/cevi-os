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

// 0145 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis zum Eintrag vor 0145 migrieren, Einstellung und Bestellung füllen, dann 0145 durch den echten Migrator, dann der Rückweg (#642)
const TAG = "0145_laden_einstellungen";
const dbName = `cevi_os_mig642_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig642-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

// Nach Stelle im Journal statt nach Nummer: Lücken in der Nummerierung stören nicht
function ordnerBauen(ziel: string, mitEintrag: boolean) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const stelle = journal.entries.findIndex((e) => e.tag === TAG);
  const eintraege = journal.entries.slice(0, stelle + (mitEintrag ? 1 : 0));
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
  ordnerBauen(bisVorher, false);
  ordnerBauen(komplett, true);
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
    await besitzer`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'laden_einstellung' and column_name = 'max_menge'`
  )[0].n as number;
const rueckweg = () =>
  besitzer.unsafe(
    readFileSync(
      new URL(`../drizzle/rueckweg/${TAG}.sql`, import.meta.url),
      "utf8",
    ),
  );

test("0145: bestehende Einstellung und Bestellung bleiben, Vorgaben gelten; der Rückweg bricht bei Menge über 10 ab und stellt sonst den alten Stand her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(0);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const person = (
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Eva Muster', 'eva@example.test', ${abteilung}) returning id`
  )[0].id as string;
  await besitzer`insert into laden_einstellung (abteilung_id, uebergabearten) values (${abteilung}, ${["Am Samstag", "Per Post"]})`;
  const bestellung = (
    await besitzer`insert into laden_bestellung (abteilung_id, user_id, uebergabe, summe_rappen) values (${abteilung}, ${person}, 'Am Samstag', 1000) returning id`
  )[0].id as string;
  await besitzer`insert into laden_bestellposition (bestellung_id, name, menge, einzelpreis_rappen) values (${bestellung}, 'Shirt', 2, 500)`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await spalte()).toBe(1);
  // Nichts verloren; neue Spalten haben die bisherigen Werte
  const [e] = await besitzer`select * from laden_einstellung`;
  expect(e.uebergabearten).toEqual(["Am Samstag", "Per Post"]);
  expect(e).toMatchObject({
    bestellen_offen: true,
    schnell_dazu: true,
    preise_oeffentlich: true,
    max_menge: 10,
    max_positionen: 20,
    max_offene: 5,
    mindest_rappen: 0,
    bezahlhinweis: null,
    bedingungen: null,
  });
  // Grenzen und Textlängen prüft die Datenbank
  await expect(
    besitzer`update laden_einstellung set max_menge = 100`,
  ).rejects.toThrow();
  await expect(
    besitzer`update laden_einstellung set bedingungen = ${"x".repeat(601)}`,
  ).rejects.toThrow();
  // Eine Menge bis 99 ist jetzt zulässig
  await besitzer`update laden_bestellposition set menge = 99`;

  // Mit Menge über 10 bricht der Rückweg ab und ändert nichts
  await expect(rueckweg()).rejects.toThrow(/Menge über 10/);
  expect(await spalte()).toBe(1);
  expect(await anzahlMigrationen()).toBe(vorher + 1);

  await besitzer`update laden_bestellposition set menge = 3`;
  await rueckweg();
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await spalte()).toBe(0);
  const [alt] = await besitzer`select * from laden_einstellung`;
  expect(alt.uebergabearten).toEqual(["Am Samstag", "Per Post"]);
  await expect(
    besitzer`update laden_bestellposition set menge = 11`,
  ).rejects.toThrow();

  // Erneut vorwärts
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalte()).toBe(1);
}, 120_000);
