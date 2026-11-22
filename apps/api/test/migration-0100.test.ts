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
import { WEBMASTER_VORGABE } from "../src/plattform.js";
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0100 und ihr Rückweg gegen eine eigene Datenbank: erst bis 0067 migrieren, zwei Abteilungen anlegen, dann 0100 durch den echten Migrator (legt je Abteilung die Vorgabe «Webmaster» an), dann der Rückweg
const dbName = `cevi_os_mig423_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig423-"));
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
  ordnerBauen(bisVorher, 67);
  ordnerBauen(komplett, 100);
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
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('plattform_rolle', 'plattform_rolle_recht', 'person_plattform_rolle', 'plattform_entwickler')`
  )[0].n as number;

test("0100 legt die Plattformrollen an und je Abteilung den Webmaster, der Rückweg räumt auf", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabellen()).toBe(0);

  const abteilungen =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins'), ('Abteilung Zwei') returning id`;
  const [{ n: abteilungenVorher }] =
    await besitzer`select count(*)::int as n from abteilung`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(await tabellen()).toBe(4);

  // Jede bestehende Abteilung hat genau einen Webmaster mit allen Rechten des Katalogs ausser dem Wartungsmodus; die Abteilungen selbst bleiben unberührt
  const rollen =
    await api`select id, abteilung_id, name, schluessel from plattform_rolle order by abteilung_id`;
  expect(rollen).toHaveLength(abteilungenVorher);
  for (const a of abteilungen) {
    const rolle = rollen.find((r) => r.abteilung_id === a.id)!;
    expect(rolle).toMatchObject({ name: "Webmaster", schluessel: "webmaster" });
    const rechte =
      await api`select recht from plattform_rolle_recht where rolle_id = ${rolle.id}`;
    expect(rechte.map((r) => r.recht).sort()).toEqual(
      [...WEBMASTER_VORGABE].sort(),
    );
  }
  expect(WEBMASTER_VORGABE).not.toContain("wartungsmodus.website");
  expect((await besitzer`select count(*)::int as n from abteilung`)[0].n).toBe(
    abteilungenVorher,
  );

  // Die Datenbank hält die Regeln auch ohne die Routen: ein zweiter Webmaster, ein Name ohne Rücksicht auf Gross- und Kleinschreibung, ein fremder Schlüssel, ein leerer Name
  await expect(
    api`insert into plattform_rolle (abteilung_id, name, schluessel) values (${abteilungen[0].id}, 'Anderer', 'webmaster')`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into plattform_rolle (abteilung_id, name) values (${abteilungen[0].id}, 'WEBMASTER')`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    api`insert into plattform_rolle (abteilung_id, name, schluessel) values (${abteilungen[0].id}, 'X', 'entwickler')`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    api`insert into plattform_rolle (abteilung_id, name) values (${abteilungen[0].id}, '')`,
  ).rejects.toMatchObject({ code: "23514" });

  // Eine Rolle nimmt Rechte und Vergaben mit
  const rolleId = rollen[0].id as string;
  await api`delete from plattform_rolle where id = ${rolleId}`;
  expect(
    await api`select 1 from plattform_rolle_recht where rolle_id = ${rolleId}`,
  ).toHaveLength(0);

  // Rückweg: Tabellen weg, Journal ohne 0100, Abteilungen bleiben
  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0100_plattformrollen.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(await tabellen()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  expect((await besitzer`select count(*)::int as n from abteilung`)[0].n).toBe(
    abteilungenVorher,
  );

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0100 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await tabellen()).toBe(4);
  expect(await besitzer`select 1 from plattform_rolle`).toHaveLength(
    abteilungenVorher,
  );
}, 60_000);
