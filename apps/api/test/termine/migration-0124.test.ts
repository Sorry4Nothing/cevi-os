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

// 0124 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0123 migrieren, dann 0124 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig443_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig443-"));
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
  ordnerBauen(bisVorher, 123);
  ordnerBauen(komplett, 124);
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
    await besitzer`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'anlass_anmeldung'`
  ).map((z) => z.table_name);

test("0124 legt die Anmeldungen an, die Regeln der Datenbank halten, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toEqual([]);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [stufe] =
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung.id}, 'stufe', 'Stufe', 'S') returning id`;
  const person = async (name: string) =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values (${name}, ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`
    )[0].id as string;
  const [mutter, vater] = [await person("Mutter"), await person("Vater")];
  const kind = async (vorname: string) =>
    (
      await besitzer`insert into kind (abteilung_id, vorname, nachname, stufe_id) values (${abteilung.id}, ${vorname}, 'Test', ${stufe.id}) returning id`
    )[0].id as string;
  const [kindEins, kindZwei] = [await kind("Eins"), await kind("Zwei")];
  const [termin] =
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende) values (${abteilung.id}, 'ev', 'Fest', false, '2027-09-04T12:00Z', '2027-09-04T14:00Z') returning id`;
  const [anlass] =
    await besitzer`insert into anlass (abteilung_id, programm_id, anmeldung_fuer, sichtbarkeit) values (${abteilung.id}, ${termin.id}, 'kind', 'angemeldet') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toEqual(["anlass_anmeldung"]);

  // Die API-Rolle schreibt und liest; die Vorgaben stimmen
  const anmelden = (
    userId: string,
    kindId: string | null,
    status = "angemeldet",
  ) => api`
    insert into anlass_anmeldung (anlass_id, user_id, kind_id, status)
    values (${anlass.id}, ${userId}, ${kindId}, ${status}) returning *`;
  const [erste] = await anmelden(mutter, kindEins);
  expect(erste).toMatchObject({ antworten: {}, status: "angemeldet" });
  expect(erste.erstellt_am).toBeInstanceOf(Date);
  expect(erste.geaendert_am).toBeInstanceOf(Date);

  // Ein Kind hat eine Anmeldung je Anlass, auch von beiden Elternteilen; dasselbe Elternteil darf mehrere Kinder anmelden
  await expect(anmelden(mutter, kindEins)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(anmelden(vater, kindEins)).rejects.toMatchObject({
    code: "23505",
  });
  await anmelden(mutter, kindZwei);
  // Die Person selbst (kind_id leer) genau einmal je Anlass, trotz NULL (NULLS NOT DISTINCT)
  await anmelden(vater, null);
  await expect(anmelden(vater, null)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(anmelden(mutter, kindZwei, "wartet")).rejects.toMatchObject({
    code: "23514",
  });

  // ON CONFLICT trifft in beiden Formen die richtige Zeile (so schreibt die Route)
  const [geaendert] = await api`
    insert into anlass_anmeldung (anlass_id, user_id, kind_id, antworten, status)
    values (${anlass.id}, ${vater}, ${kindEins}, ${api.json({ a: "b" })}, 'angemeldet')
    on conflict (anlass_id, kind_id) where kind_id is not null
    do update set antworten = excluded.antworten returning id, user_id`;
  expect(geaendert).toMatchObject({ id: erste.id, user_id: mutter });
  const [selbst] = await api`
    insert into anlass_anmeldung (anlass_id, user_id, kind_id, status)
    values (${anlass.id}, ${vater}, ${null}, 'angemeldet')
    on conflict (anlass_id, user_id, kind_id)
    do update set status = 'angemeldet' returning id`;
  expect(selbst.id).toBeDefined();
  expect(
    await besitzer`select * from anlass_anmeldung where anlass_id = ${anlass.id}`,
  ).toHaveLength(3);

  // Fällt das Kind, das Konto oder der Anlass weg, fällt die Anmeldung mit
  await besitzer`delete from kind where id = ${kindZwei}`;
  expect(
    await besitzer`select * from anlass_anmeldung where anlass_id = ${anlass.id}`,
  ).toHaveLength(2);
  await besitzer`delete from "user" where id = ${vater}`;
  expect(
    await besitzer`select * from anlass_anmeldung where anlass_id = ${anlass.id}`,
  ).toHaveLength(1);
  await besitzer`delete from anlass where id = ${anlass.id}`;
  expect(await besitzer`select * from anlass_anmeldung`).toHaveLength(0);

  // Rückweg: Tabelle weg, Journal ohne 0124, die Anlässe (0123) bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0124_anlass_anmeldung.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await tabellen()).toEqual([]);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await besitzer`select id from programm`).toHaveLength(1);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0124 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toEqual(["anlass_anmeldung"]);
}, 90_000);
