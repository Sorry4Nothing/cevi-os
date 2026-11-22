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

// 0122 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0120 migrieren, dann 0122 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig439_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig439-"));
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
  ordnerBauen(bisVorher, 121);
  // Bis 0122: spätere Termin-Migrationen sind für diesen Test ohne Belang
  ordnerBauen(komplett, 122);
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
const vorhanden = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'termin_vorschlag'`
  )[0].n as number;

test("0122 legt die Terminvorschläge an, die Regeln gelten in der Datenbank, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await vorhanden()).toBe(0);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [person] =
    await besitzer`insert into "user" (name, email, abteilung_id) values ('Person', ${`${randomUUID()}@example.org`}, ${abteilung.id}) returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await vorhanden()).toBe(1);

  // Die API-Rolle (Standardrechte auf neue Tabellen) schreibt und liest
  const tag = randomUUID();
  const neu = (werte: {
    titel?: string;
    ganztaegig?: boolean;
    beginn?: string | null;
    ende?: string | null;
    tagVon?: string | null;
    tagBis?: string | null;
    tags?: string[];
    status?: string;
    ort?: string | null;
  }) =>
    api`insert into termin_vorschlag (abteilung_id, vorgeschlagen_von, titel, ganztaegig, beginn, ende, tag_von, tag_bis, tag_ids, status, ort) values (${abteilung.id}, ${person.id}, ${werte.titel ?? "Waldtag"}, ${werte.ganztaegig ?? true}, ${werte.beginn ?? null}, ${werte.ende ?? null}, ${"tagVon" in werte ? werte.tagVon! : "2099-05-01"}, ${"tagBis" in werte ? werte.tagBis! : "2099-05-01"}, ${werte.tags ?? [tag]}::uuid[], ${werte.status ?? "offen"}, ${werte.ort ?? null}) returning id`;
  const [zeile] = await neu({});
  expect(
    (
      await api`select status, entschieden_von, begruendung, erstellt_am is not null as hat_zeit from termin_vorschlag where id = ${zeile.id}`
    )[0],
  ).toEqual({
    status: "offen",
    entschieden_von: null,
    begruendung: null,
    hat_zeit: true,
  });

  // Zeiten passen zu ganztägig; Ende nach Beginn, letzter Tag nicht vor dem ersten
  const fehler = { code: "23514" };
  await expect(neu({ tagVon: null, tagBis: null })).rejects.toMatchObject(
    fehler,
  );
  await expect(
    neu({ tagVon: "2099-05-02", tagBis: "2099-05-01" }),
  ).rejects.toMatchObject(fehler);
  await expect(
    neu({
      ganztaegig: false,
      beginn: "2099-05-01T10:00:00Z",
      ende: "2099-05-01T09:00:00Z",
      tagVon: null,
      tagBis: null,
    }),
  ).rejects.toMatchObject(fehler);
  await expect(
    neu({
      ganztaegig: false,
      beginn: "2099-05-01T10:00:00Z",
      ende: "2099-05-01T11:00:00Z",
    }),
  ).rejects.toMatchObject(fehler);
  const [zeitlich] = await neu({
    ganztaegig: false,
    beginn: "2099-05-01T10:00:00Z",
    ende: "2099-05-01T11:00:00Z",
    tagVon: null,
    tagBis: null,
  });
  expect(zeitlich.id).toBeTruthy();
  // Status, Tags (1 bis 20) und Längen
  await expect(neu({ status: "zurueckgezogen" })).rejects.toMatchObject(fehler);
  await expect(neu({ tags: [] })).rejects.toMatchObject(fehler);
  await expect(
    neu({ tags: Array.from({ length: 21 }, () => randomUUID()) }),
  ).rejects.toMatchObject(fehler);
  await expect(neu({ titel: "" })).rejects.toMatchObject(fehler);
  await expect(neu({ titel: "x".repeat(121) })).rejects.toMatchObject(fehler);
  await expect(neu({ ort: "x".repeat(121) })).rejects.toMatchObject(fehler);

  // Die Person weg: Der Vorschlag bleibt, ohne Verweis. Die Abteilung lässt sich mit Vorschlägen nicht löschen
  await api`delete from "user" where id = ${person.id}`;
  expect(
    (
      await api`select vorgeschlagen_von from termin_vorschlag where id = ${zeile.id}`
    )[0],
  ).toEqual({ vorgeschlagen_von: null });
  await expect(
    besitzer`delete from abteilung where id = ${abteilung.id}`,
  ).rejects.toMatchObject({ code: "23001" });

  // Rückweg: Tabelle weg, Journal ohne 0122
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../../drizzle/rueckweg/0122_termin_vorschlag.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await vorhanden()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
}, 60_000);
