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

// 0156 und ihr Rückweg gegen eine eigene Datenbank mit Daten (#690): erst bis 0149 migrieren, eine Abteilung und die Rolle «Webmaster» anlegen, dann 0156 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig690_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig690-"));
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
  ordnerBauen(bisVorher, 149);
  ordnerBauen(komplett, 156);
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
const tabellen = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('foto_einstellung', 'foto_album')`
  )[0].n as number;

test("0156: Tabellen mit Prüfungen, «Webmaster» bekommt das Recht, der Rückweg nimmt die Tabellen und lässt das Recht der Rolle stehen", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toBe(0);
  const [{ id: abteilung }] = await besitzer`
    insert into abteilung (name) values ('Eins') returning id`;
  const [{ id: rolle }] = await besitzer`
    insert into plattform_rolle (abteilung_id, name, schluessel) values (${abteilung}, 'Webmaster', 'webmaster') returning id`;
  const [{ id: andere }] = await besitzer`
    insert into plattform_rolle (abteilung_id, name) values (${abteilung}, 'Andere') returning id`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toBe(2);
  // Nur die Vorgabe «Webmaster» bekommt das neue Recht
  const rechte =
    await besitzer`select rolle_id from plattform_rolle_recht where recht = 'fotos.verwalten'`;
  expect(rechte.map((r) => r.rolle_id)).toEqual([rolle]);
  expect(rechte.map((r) => r.rolle_id)).not.toContain(andere);

  // Konto: Ziffern, «@N» und zwei Ziffern oder leer; eine Zeile je Abteilung
  await besitzer`insert into foto_einstellung (abteilung_id, flickr_konto) values (${abteilung}, '12345678@N00')`;
  await expect(
    besitzer`insert into foto_einstellung (abteilung_id) values (${abteilung})`,
  ).rejects.toThrow(/foto_einstellung_pkey/);
  await expect(
    besitzer`update foto_einstellung set flickr_konto = 'jemand@example.org' where abteilung_id = ${abteilung}`,
  ).rejects.toThrow(/foto_einstellung_konto_check/);
  // Alben: Kennung nur Ziffern, nie doppelt je Abteilung, Titel 1 bis 120 Zeichen, neu unsichtbar
  await besitzer`insert into foto_album (abteilung_id, flickr_album_id) values (${abteilung}, '72157000000000001')`;
  const [album] =
    await besitzer`select sichtbar, version, reihenfolge from foto_album`;
  expect(album).toMatchObject({ sichtbar: false, version: 1, reihenfolge: 0 });
  await expect(
    besitzer`insert into foto_album (abteilung_id, flickr_album_id) values (${abteilung}, '72157000000000001')`,
  ).rejects.toThrow(/foto_album_flickr_idx/);
  await expect(
    besitzer`insert into foto_album (abteilung_id, flickr_album_id) values (${abteilung}, '1/../2')`,
  ).rejects.toThrow(/foto_album_flickr_check/);
  await expect(
    besitzer`insert into foto_album (abteilung_id, flickr_album_id, titel) values (${abteilung}, '5', ${"x".repeat(121)})`,
  ).rejects.toThrow(/foto_album_titel_check/);
  await expect(
    besitzer`insert into foto_album (abteilung_id, flickr_album_id) values (${randomUUID()}, '6')`,
  ).rejects.toThrow(/foto_album_abteilung_id_abteilung_id_fk/);

  // Rückweg: Die Tabellen entfallen, die Abteilung und die Rollen bleiben, das Journal ist zurück
  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0156_fotos.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect((await besitzer`select count(*)::int as n from abteilung`)[0].n).toBe(
    1,
  );
}, 120_000);
