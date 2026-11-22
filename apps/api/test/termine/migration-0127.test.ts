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

// 0127 und ihr Rückweg gegen eine eigene, frische Datenbank, die genau der Rolle cevi_os_besitzer gehört (wie auf dem Server): Die Rolle legt btree_gist ohne Superuser an (vertrauenswürdige Erweiterung). Erst bis 0126 migrieren (0126 gehört zu #449), dann 0127 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig447_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig447-"));
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
  ordnerBauen(bisVorher, 126);
  ordnerBauen(komplett, 127);
}, 60_000);

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
}, 60_000);

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const hatTabelle = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'raum_buchung'`
  )[0].n === 1;

test("0127 legt raum_buchung an, die Datenbank verhindert Doppelbuchungen, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await hatTabelle()).toBe(false);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [raum] =
    await besitzer`insert into raum (abteilung_id, name) values (${abteilung.id}, 'Saal') returning id`;
  const [anderer] =
    await besitzer`insert into raum (abteilung_id, name) values (${abteilung.id}, 'Keller') returning id`;
  const [konto] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Test', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;

  // Die Migrationsrolle legt die Erweiterung ohne Superuser an
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await hatTabelle()).toBe(true);
  expect(
    (
      await besitzer`select count(*)::int as n from pg_extension where extname = 'btree_gist'`
    )[0].n,
  ).toBe(1);

  // Die API-Rolle schreibt und liest; die Vorgaben stimmen
  const einfuegen = (
    raumId: string,
    beginn: string,
    ende: string,
    status = "angefragt",
    zweck = "Gruppenabend",
  ) =>
    api`insert into raum_buchung (raum_id, user_id, beginn, ende, zweck, status, entschieden_am) values (${raumId}, ${konto.id}, ${beginn}, ${ende}, ${zweck}, ${status}, ${status === "bestaetigt" || status === "abgelehnt" ? new Date() : null}) returning *`;
  const [erste] = await einfuegen(
    raum.id,
    "2100-01-01T10:00:00Z",
    "2100-01-01T12:00:00Z",
    "bestaetigt",
  );
  expect(erste).toMatchObject({ status: "bestaetigt", begruendung: null });
  expect(
    (
      await einfuegen(raum.id, "2100-01-01T10:00:00Z", "2100-01-01T12:00:00Z")
    )[0].status,
  ).toBe("angefragt");

  // Überschneidung bestätigter Buchungen desselben Raums: Exclusion-Constraint (23P01)
  for (const [b, e] of [
    ["2100-01-01T11:00:00Z", "2100-01-01T13:00:00Z"],
    ["2100-01-01T09:00:00Z", "2100-01-01T10:30:00Z"],
    ["2100-01-01T10:30:00Z", "2100-01-01T11:00:00Z"],
    ["2100-01-01T08:00:00Z", "2100-01-01T20:00:00Z"],
    ["2100-01-01T10:00:00Z", "2100-01-01T12:00:00Z"],
  ]) {
    await expect(
      einfuegen(raum.id, b!, e!, "bestaetigt"),
    ).rejects.toMatchObject({
      code: "23P01",
    });
  }
  // Angrenzend, anderer Raum und andere Stände sind frei
  await einfuegen(
    raum.id,
    "2100-01-01T12:00:00Z",
    "2100-01-01T14:00:00Z",
    "bestaetigt",
  );
  await einfuegen(
    raum.id,
    "2100-01-01T08:00:00Z",
    "2100-01-01T10:00:00Z",
    "bestaetigt",
  );
  await einfuegen(
    anderer.id,
    "2100-01-01T10:00:00Z",
    "2100-01-01T12:00:00Z",
    "bestaetigt",
  );
  await einfuegen(
    raum.id,
    "2100-01-01T10:00:00Z",
    "2100-01-01T12:00:00Z",
    "abgelehnt",
  );
  await einfuegen(
    raum.id,
    "2100-01-01T10:00:00Z",
    "2100-01-01T12:00:00Z",
    "storniert",
  );

  // Ende nach Beginn, höchstens 14 Tage, Zweck 1 bis 200, Status, Entscheidzeit bei «bestaetigt» und «abgelehnt»
  const zu = (tage: number) =>
    new Date(Date.parse("2100-02-01T10:00:00Z") + tage * 864e5).toISOString();
  await expect(einfuegen(raum.id, zu(0), zu(14))).resolves.toBeDefined();
  for (const aufruf of [
    () => einfuegen(raum.id, zu(0), zu(0)),
    () => einfuegen(raum.id, zu(1), zu(0)),
    () =>
      einfuegen(
        raum.id,
        zu(0),
        new Date(Date.parse(zu(14)) + 1000).toISOString(),
      ),
    () => einfuegen(raum.id, zu(0), zu(1), "angefragt", ""),
    () => einfuegen(raum.id, zu(0), zu(1), "angefragt", "x".repeat(201)),
    () => einfuegen(raum.id, zu(0), zu(1), "unbekannt"),
    () =>
      api`insert into raum_buchung (raum_id, user_id, beginn, ende, zweck, status) values (${raum.id}, ${konto.id}, ${zu(0)}, ${zu(1)}, 'x', 'bestaetigt')`,
  ]) {
    await expect(aufruf()).rejects.toMatchObject({ code: "23514" });
  }

  // Raum und Konto halten ihre Zeilen nicht fest, sie nehmen sie mit
  await besitzer`delete from raum where id = ${anderer.id}`;
  expect(
    (
      await besitzer`select count(*)::int as n from raum_buchung where raum_id = ${anderer.id}`
    )[0].n,
  ).toBe(0);

  // Rückweg: Tabelle weg, Journal ohne 0127, die Erweiterung bleibt
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0127_raum_buchung.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await hatTabelle()).toBe(false);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0127 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await hatTabelle()).toBe(true);
}, 120_000);
