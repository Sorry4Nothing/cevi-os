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
import { systemrollenFuer } from "../src/rechtemodell/standard.js";
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0140 und 0141 samt Rückwegen gegen eine eigene Datenbank mit Daten: erst bis 0139 migrieren und füllen, dann die beiden Migrationen durch den echten Migrator, dann die Rückwege (#643)
const dbName = `cevi_os_mig643_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig643-"));
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
  ordnerBauen(bisVorher, 139);
  ordnerBauen(komplett, 141);
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
const tabelle = async (name: string) =>
  (
    await besitzer`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = ${name}`
  )[0].n as number;
const rueckweg = (nummer: string) =>
  besitzer.unsafe(
    readFileSync(
      new URL(`../drizzle/rueckweg/${nummer}.sql`, import.meta.url),
      "utf8",
    ),
  );

test("0140 und 0141: Systemrollen und Zuordnung aus dem Freitext, Trigger, Rückwege", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await tabelle("gruppen_rolle")).toBe(0);

  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const person = async (name: string) =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values (${name}, ${`${name}-${randomUUID()}@test.invalid`}, ${abteilung}) returning id`
    )[0].id as string;
  const gruppe = async (typ: string, name: string) =>
    (
      await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilung}, ${typ}, ${name}, '') returning id`
    )[0].id as string;
  const stufe = await gruppe("stufe", "Stufe Eins");
  const team = await gruppe("team", "Mat");
  const funktion = await gruppe("funktion", "Kasse");
  const lager = await gruppe("lager", "Lagergruppe");
  const [leitung, verantwortlich, mitglied, grossGeschrieben, ohne] =
    await Promise.all(
      ["Leitung", "Verantwortlich", "Mitglied", "Gross", "Ohne"].map(person),
    );
  const zuordnen = (userId: string, tagId: string, rolle: string | null) =>
    besitzer`insert into person_tag (user_id, tag_id, rolle) values (${userId}, ${tagId}, ${rolle})`;
  await zuordnen(leitung, stufe, "leitung");
  await zuordnen(verantwortlich, team, "Verantwortlich");
  await zuordnen(mitglied, team, "Kasse");
  // Der Freitext einer Stufenrolle ist genau «leitung»: «Leitung» ist keine Stufenrolle, auch alt nicht
  await zuordnen(grossGeschrieben, stufe, "Leitung");
  await zuordnen(ohne, funktion, null);
  await zuordnen(ohne, lager, "verantwortlich");

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 2);

  // Jede Gruppe hat ihre Systemrollen
  const rollen = await besitzer`
    select t.typ, r.schluessel, r.name, r.verantwortlich, r.id
      from gruppen_rolle r join tag t on t.id = r.tag_id
      order by t.typ, r.reihenfolge`;
  expect(rollen.map((r) => `${r.typ}:${r.schluessel}`)).toEqual([
    "funktion:verantwortlich",
    "lager:verantwortlich",
    "stufe:stufenleitung",
    "stufe:leitung",
    "team:verantwortlich",
  ]);
  const rolleVon = (tagTyp: string, schluessel: string) =>
    rollen.find((r) => r.typ === tagTyp && r.schluessel === schluessel)!
      .id as string;

  // Die Rechte der Systemrolle an einem Team sind die des alten Wegs und die Standardwerte im Code
  const rechte = await besitzer`
    select recht, geltung from gruppen_rolle_recht where rolle_id = ${rolleVon("team", "verantwortlich")} order by recht`;
  expect(rechte.map((z) => ({ recht: z.recht, geltung: z.geltung }))).toEqual(
    [...systemrollenFuer("team")[0].rechte]
      .map((z) => ({ recht: z.recht, geltung: z.geltung }))
      .sort((a, b) => a.recht.localeCompare(b.recht)),
  );
  expect(
    (
      await besitzer`select count(*)::int as n from gruppen_rolle_recht where rolle_id <> ${rolleVon("team", "verantwortlich")}`
    )[0].n,
  ).toBe(0);

  // Die Zuordnung folgt dem Freitext
  const rolleId = async (userId: string, tagId: string) =>
    (
      await besitzer`select rolle_id from person_tag where user_id = ${userId} and tag_id = ${tagId}`
    )[0].rolle_id as string | null;
  expect(await rolleId(leitung, stufe)).toBe(rolleVon("stufe", "leitung"));
  expect(await rolleId(verantwortlich, team)).toBe(
    rolleVon("team", "verantwortlich"),
  );
  expect(await rolleId(mitglied, team)).toBeNull();
  expect(await rolleId(grossGeschrieben, stufe)).toBeNull();
  expect(await rolleId(ohne, funktion)).toBeNull();
  expect(await rolleId(ohne, lager)).toBe(rolleVon("lager", "verantwortlich"));

  // Der Trigger führt Neues nach: Einfügen, Ändern, Entziehen der Systemrolle
  const neu = await person("Neu");
  await zuordnen(neu, team, "VERANTWORTLICH");
  expect(await rolleId(neu, team)).toBe(rolleVon("team", "verantwortlich"));
  await besitzer`update person_tag set rolle = 'Kasse' where user_id = ${neu} and tag_id = ${team}`;
  expect(await rolleId(neu, team)).toBeNull();
  // Eine selbst erstellte Rolle bleibt, wenn der Freitext wechselt
  const eigene = (
    await besitzer`insert into gruppen_rolle (abteilung_id, tag_id, name) values (${abteilung}, ${team}, 'Kasse') returning id`
  )[0].id as string;
  await besitzer`update person_tag set rolle_id = ${eigene} where user_id = ${neu} and tag_id = ${team}`;
  await besitzer`update person_tag set rolle = 'Anderes' where user_id = ${neu} and tag_id = ${team}`;
  expect(await rolleId(neu, team)).toBe(eigene);
  // Ausdrücklich gesetzt gewinnt gegen den Freitext
  const gesetzt = await person("Gesetzt");
  await besitzer`insert into person_tag (user_id, tag_id, rolle, rolle_id) values (${gesetzt}, ${team}, 'verantwortlich', ${eigene})`;
  expect(await rolleId(gesetzt, team)).toBe(eigene);

  // Constraints: Name, eine Systemrolle je Gruppe, Namen je Gruppe eindeutig
  await expect(
    besitzer`insert into gruppen_rolle (abteilung_id, tag_id, name) values (${abteilung}, ${team}, 'KASSE')`,
  ).rejects.toThrow(/gruppen_rolle_name_pro_gruppe/);
  await expect(
    besitzer`insert into gruppen_rolle (abteilung_id, tag_id, name, schluessel) values (${abteilung}, ${team}, 'Zweite', 'verantwortlich')`,
  ).rejects.toThrow(/gruppen_rolle_schluessel_pro_gruppe/);
  await expect(
    besitzer`insert into gruppen_rolle (abteilung_id, tag_id, name, schluessel) values (${abteilung}, ${team}, 'Unbekannt', 'chef')`,
  ).rejects.toThrow(/gruppen_rolle_schluessel_check/);
  await expect(
    besitzer`insert into gruppen_rolle_recht (rolle_id, recht, geltung) values (${eigene}, 'seiten.bearbeiten', 'viele')`,
  ).rejects.toThrow(/gruppen_rolle_recht_geltung_check/);

  // Fällt die Rolle weg, bleibt die Mitgliedschaft und verliert die Person die Rolle
  await besitzer`delete from gruppen_rolle where id = ${eigene}`;
  expect(await rolleId(neu, team)).toBeNull();
  expect(
    (
      await besitzer`select count(*)::int as n from person_tag where user_id = ${neu}`
    )[0].n,
  ).toBe(1);

  // Rückweg 0141: Zuordnung und Rollen weg, die Freitext-Rolle bleibt
  await rueckweg("0141_gruppenrollen_nachtragen");
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  expect(
    (
      await besitzer`select count(*)::int as n from person_tag where rolle_id is not null`
    )[0].n,
  ).toBe(0);
  expect(
    (await besitzer`select count(*)::int as n from gruppen_rolle`)[0].n,
  ).toBe(0);
  expect(await tabelle("gruppen_rolle")).toBe(1);

  // Rückweg 0140
  await rueckweg("0140_gruppenrollen");
  expect(await anzahlMigrationen()).toBe(vorher);
  expect(await tabelle("gruppen_rolle")).toBe(0);
  expect(await tabelle("gruppen_rolle_recht")).toBe(0);
  expect(
    (
      await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'person_tag' and column_name = 'rolle_id'`
    )[0].n,
  ).toBe(0);
  expect(
    (
      await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'plattform_rolle' and column_name = 'version'`
    )[0].n,
  ).toBe(0);
  expect(
    (
      await besitzer`select count(*)::int as n from pg_proc where proname = 'person_tag_rolle_abgleich'`
    )[0].n,
  ).toBe(0);
  // Der Freitext ist, wie er war
  expect(
    (
      await besitzer`select rolle from person_tag where user_id = ${verantwortlich}`
    )[0].rolle,
  ).toBe("Verantwortlich");

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem beide Migrationen wieder laufen
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 2);
  expect(
    (
      await besitzer`select count(*)::int as n from person_tag where rolle_id is not null`
    )[0].n,
  ).toBeGreaterThanOrEqual(3);
}, 180_000);
