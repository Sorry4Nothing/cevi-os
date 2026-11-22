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

// 0097 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0096 migrieren (was davon im Journal steht), dann 0097 durch den echten Migrator mit der Besitzerrolle (ohne Superuser: so läuft sie auf dem Server), dann der Rückweg
const dbName = `cevi_os_mig399_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig399-"));
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
  api = postgres(url("cevi_os_api"), { max: 1, onnotice: () => {} });
  ordnerBauen(bisVorher, 96);
  ordnerBauen(komplett, 97);
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
const suchIndizes = async () =>
  (
    await besitzer`select indexname from pg_indexes where schemaname = 'public' and indexname ~ '_suche_(fts|trgm)_idx$' order by indexname`
  ).map((z) => z.indexname as string);
const erweiterung = async () =>
  (await besitzer`select extname from pg_extension where extname = 'pg_trgm'`)
    .length;
const funktion = async () =>
  (
    await besitzer`select proname from pg_proc where proname = 'lager_suche_liste'`
  ).length;

test("0097 legt pg_trgm, die Funktion und die GIN-Indizes an (mit der Besitzerrolle), die API-Rolle sucht, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await suchIndizes()).toEqual([]);
  expect(await erweiterung()).toBe(0);

  const [abteilung] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [lager] =
    await besitzer`insert into lager (abteilung_id, titel, von, bis) values (${abteilung.id}, 'Lager', '2027-07-10', '2027-07-24') returning id`;
  await besitzer`insert into gruppe (lager_id, name, lager_seq) values (${lager.id}, 'Zeltbauer und Zeltbauerinnen', 1)`;
  await besitzer`insert into dokument (lager_id, titel, stichworte, datei_id, lager_seq) values (${lager.id}, 'Plan', ${["a", "b"]}, ${(await besitzer`insert into lager_datei (lager_id, anzeigename, link, lager_seq) values (${lager.id}, 'x.pdf', 'https://cevi.sharepoint.com/x.pdf', 1) returning id`)[0].id}, 1)`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await erweiterung()).toBe(1);
  expect(await funktion()).toBe(1);
  // 23 Tabellen, je ein Index für Stämme (fts) und einer für Tippfehler (trgm)
  const indizes = await suchIndizes();
  expect(indizes).toHaveLength(46);
  expect(indizes.filter((i) => i.endsWith("_suche_fts_idx"))).toHaveLength(23);
  expect(indizes.filter((i) => i.endsWith("_suche_trgm_idx"))).toHaveLength(23);

  // Die API-Rolle (ohne DDL-Recht) sucht: Wortstamm, Wortanfang, Tippfehler und die Funktion für Listen
  const treffer = (frage: string, wort: string) =>
    api.unsafe(frage, [wort]).then((z) => z.length);
  expect(
    await treffer(
      "select 1 from gruppe where to_tsvector('german', coalesce(name, '')) @@ to_tsquery('german', $1)",
      "'zeltbau':*",
    ),
  ).toBe(1);
  expect(
    await treffer(
      "select 1 from gruppe where $1::text <% coalesce(name, '')",
      "zeltbaur",
    ),
  ).toBe(1);
  expect(
    (await api`select lager_suche_liste(stichworte) as t from dokument`)[0].t,
  ).toBe("a b");
  expect(await api`select lager_suche_liste(null) as t`).toEqual([{ t: null }]);
  // Die API-Rolle darf weder Indizes noch die Erweiterung anlegen
  await expect(
    api`create index x on gruppe using gin (name gin_trgm_ops)`,
  ).rejects.toMatchObject({ code: "42501" });

  // Rückweg: Indizes und Funktion weg, die Erweiterung bleibt, Journal ohne 0097
  await besitzer.unsafe(
    readFileSync(
      new URL("../../drizzle/rueckweg/0097_lager_suche.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await suchIndizes()).toEqual([]);
  expect(await funktion()).toBe(0);
  expect(await erweiterung()).toBe(1);
  expect(await anzahlMigrationen()).toBe(vorher);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0097 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await suchIndizes()).toHaveLength(46);
}, 90_000);
