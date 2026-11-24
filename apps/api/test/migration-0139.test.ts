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

// 0139 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0135 migrieren, das Audit-Log füllen, dann 0139 durch den echten Migrator, dann der Rückweg (#637)
const dbName = `cevi_os_mig637_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig637-"));
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
  besitzer = postgres(`postgres://cevi_os_besitzer@localhost:5432/${dbName}`, {
    max: 1,
    onnotice: () => {},
  });
  ordnerBauen(bisVorher, 138);
  ordnerBauen(komplett, 139);
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
const tabelle = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'aktivitaet'`
  )[0].n as number;

test("0139: Tabelle, Trigger und Aufräumfunktion kommen, das Audit-Log bleibt, der Rückweg nimmt sie wieder", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelle()).toBe(0);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id) values (${abteilung}, 'cli', 'alt', 'person', ${randomUUID()})`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabelle()).toBe(1);
  // Bestehende Zeilen des Audit-Logs werden nicht nachgetragen, neue erscheinen
  expect((await besitzer`select count(*)::int as n from aktivitaet`)[0].n).toBe(
    0,
  );
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details) values (${abteilung}, 'cli', 'neu', 'person', ${randomUUID()}, ${JSON.stringify({ wert: "geheim", n: 1 })}::jsonb)`;
  const [z] =
    await besitzer`select art, akteur, felder from aktivitaet where aktion = 'neu'`;
  expect(z).toMatchObject({
    art: "audit",
    akteur: "cli",
    felder: ["n", "wert"],
  });

  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0139_aktivitaet.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await tabelle()).toBe(0);
  // Das Audit-Log ist unberührt und schreibt ohne Trigger weiter
  expect((await besitzer`select count(*)::int as n from audit_log`)[0].n).toBe(
    2,
  );
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id) values (${abteilung}, 'cli', 'nachher', 'person', ${randomUUID()})`;

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0139 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabelle()).toBe(1);
}, 120_000);
