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

// 0035 und ihr Rückweg gegen eine eigene Datenbank mit Daten: erst bis 0034 migrieren, füllen, dann 0035 durch den echten Migrator
const dbName = `cevi_os_mig332_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig332-"));
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

const ids = async (sql: postgres.Sql, tabelle: string, spalte = "id") =>
  (await sql.unsafe(`select ${spalte} as id from ${tabelle} order by 1`)).map(
    (z) => z.id as string,
  );

beforeAll(async () => {
  await superuser.unsafe(`create database ${dbName} owner cevi_os_besitzer`);
  besitzer = postgres(url("cevi_os_besitzer"), { max: 1, onnotice: () => {} });
  api = postgres(url("cevi_os_api"), { max: 1 });
  ordnerBauen(bisVorher, 34);
  ordnerBauen(komplett, 35);
});

afterAll(async () => {
  await besitzer?.end();
  await api?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

test("0035: Stufen und Rollen ziehen verlustfrei auf Tags und Zuordnungen, der Rückweg stellt sie her", async () => {
  // Migrationen bis zum Stand vor 0035 (0033 ist die letzte Datei im Ordner; 0034 liegt auf einem anderen Branch)
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });

  const [abt1] =
    await besitzer`insert into abteilung (name) values ('Abteilung Eins') returning id`;
  const [abt2] =
    await besitzer`insert into abteilung (name) values ('Abteilung Zwei') returning id`;
  const stufe = async (abteilung: string, name: string, kuerzel: string) =>
    (
      await besitzer`insert into stufe (abteilung_id, name, kuerzel) values (${abteilung}, ${name}, ${kuerzel}) returning id`
    )[0].id as string;
  const biber = await stufe(abt1.id, "Biber", "BI");
  const wolf = await stufe(abt1.id, "Wolf", "");
  const pfadi = await stufe(abt1.id, "Pfadi", "PF");
  await stufe(abt2.id, "Biber", "BI");
  const person = async (name: string, abteilung: string) =>
    (
      await besitzer`insert into "user" (name, email, abteilung_id) values (${name}, ${`${randomUUID()}@example.org`}, ${abteilung}) returning id`
    )[0].id as string;
  const sl1 = await person("SL Eins", abt1.id);
  const sl2 = await person("SL Zwei", abt1.id);
  const leitung = await person("Leitung", abt1.id);
  const mehrere = await person("Mehrere", abt1.id);
  await besitzer`insert into rolle (user_id, stufe_id, typ, prioritaet) values (${sl1}, ${biber}, 'stufenleitung', 2)`;
  await besitzer`insert into rolle (user_id, stufe_id, typ, prioritaet) values (${sl2}, ${biber}, 'stufenleitung', 1)`;
  await besitzer`insert into rolle (user_id, stufe_id, typ) values (${leitung}, ${wolf}, 'leitung')`;
  await besitzer`insert into rolle (user_id, stufe_id, typ) values (${mehrere}, ${biber}, 'leitung')`;
  await besitzer`insert into rolle (user_id, stufe_id, typ, prioritaet) values (${mehrere}, ${pfadi}, 'stufenleitung', 1)`;
  const [kind] =
    await besitzer`insert into kind (abteilung_id, vorname, nachname, stufe_id) values (${abt1.id}, 'Kind', 'Test', ${biber}) returning id`;
  await besitzer`insert into chat (abteilung_id, typ, stufe_id) values (${abt1.id}, 'stufe', ${biber})`;
  await besitzer`insert into stufenlogo (stufe_id, inhalt) values (${biber}, '\\x00'::bytea)`;
  await besitzer`insert into zeitregel (abteilung_id, stufe_id, wochentag, uhrzeit, text) values (${abt1.id}, ${wolf}, 1, '08:00', 'Text')`;
  const [programm] =
    await besitzer`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis) values (${abt1.id}, 'ereignis-1', 'Programm', true, '2027-03-06', '2027-03-06') returning id`;
  await besitzer`insert into programm_stufe (programm_id, stufe_id) values (${programm.id}, ${wolf})`;
  // Bestehende Tags: einer kollidiert mit dem Namen «Biber» (anderer Schreibweise), einer nicht
  const [kollision] =
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abt1.id}, 'team', 'biber', '') returning id`;
  const [ohneKollision] =
    await besitzer`insert into tag (abteilung_id, typ, name, kuerzel) values (${abt1.id}, 'funktion', 'Material', 'M') returning id`;
  await besitzer`insert into person_tag (user_id, tag_id, rolle) values (${leitung}, ${ohneKollision.id}, 'Verantwortlich')`;

  const vorherStufen = await besitzer`select * from stufe order by id`;
  const vorherRollen =
    await besitzer`select * from rolle order by user_id, stufe_id`;
  const vorherKind =
    await besitzer`select stufe_id from kind where id = ${kind.id}`;
  const vorherTags = await ids(besitzer, "tag");
  const vorherZuordnungen =
    await besitzer`select count(*)::int as n from person_tag`;

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });

  // Zeilenzahlen und IDs gleich: jede Stufe ist ein Tag mit derselben ID, jede Rolle eine Zuordnung
  const stufenTags =
    await besitzer`select id, abteilung_id, name, kuerzel from tag where typ = 'stufe' order by id`;
  expect(stufenTags).toHaveLength(4);
  expect(stufenTags.map((t) => t.id)).toEqual(vorherStufen.map((s) => s.id));
  expect(
    stufenTags.map(({ id, abteilung_id, name, kuerzel }) => ({
      id,
      abteilung_id,
      name,
      kuerzel,
    })),
  ).toEqual(
    vorherStufen.map(({ id, abteilung_id, name, kuerzel }) => ({
      id,
      abteilung_id,
      name,
      kuerzel,
    })),
  );
  expect(await besitzer`select * from stufe order by id`).toHaveLength(4);
  const nachherRollen =
    await besitzer`select * from rolle order by user_id, stufe_id`;
  expect(nachherRollen).toEqual(vorherRollen);
  expect(nachherRollen).toHaveLength(5);
  const [{ n: zuordnungen }] =
    await besitzer`select count(*)::int as n from person_tag`;
  expect(zuordnungen).toBe(vorherZuordnungen[0].n + 5);
  expect(
    await besitzer`select stufe_id from kind where id = ${kind.id}`,
  ).toEqual(vorherKind);
  expect(
    await besitzer`select count(*)::int as n from stufenlogo where stufe_id = ${biber}`,
  ).toEqual([{ n: 1 }]);

  // Kollision: der bestehende Tag bekommt ein Suffix, die Stufe behält ihren Namen
  const [umbenannt] =
    await besitzer`select name from tag where id = ${kollision.id}`;
  expect(umbenannt.name).toBe(`biber (team, ${kollision.id.slice(0, 8)})`);
  expect(
    (await besitzer`select name from tag where id = ${ohneKollision.id}`)[0]
      .name,
  ).toBe("Material");
  expect(
    (await besitzer`select name from tag where id = ${biber}`)[0].name,
  ).toBe("Biber");

  // Fremdschlüssel zeigen auf tag
  const ziele = await besitzer`
    select conrelid::regclass::text as von, confrelid::regclass::text as nach
    from pg_constraint
    where contype = 'f' and conname like '%_stufe_id_%_fk' order by 1`;
  expect(ziele.map((z) => `${z.von}->${z.nach}`).sort()).toEqual([
    "chat->tag",
    "kind->tag",
    "programm_eckdaten->tag",
    "programm_stufe->tag",
    "stufenlogo->tag",
    "zeitregel->tag",
  ]);
  // Die wirksame Programm-Sicht kennt weiter dieselben Stufen
  expect(
    (
      await besitzer`select stufe_id from programm_stufe_wirksam where programm_id = ${programm.id}`
    ).map((z) => z.stufe_id),
  ).toEqual([wolf]);

  // Die API-Rolle liest und schreibt über die Sichten, ohne das Schema zu ändern
  const [neu] =
    await api`insert into stufe (abteilung_id, name, kuerzel) values (${abt1.id}, 'Neu', 'N') returning id`;
  expect(
    (await besitzer`select typ from tag where id = ${neu.id}`)[0].typ,
  ).toBe("stufe");
  await api`insert into rolle (user_id, stufe_id, typ) values (${sl1}, ${neu.id}, 'leitung')`;
  await api`update rolle set prioritaet = 3 where user_id = ${sl1} and stufe_id = ${biber}`;
  expect(
    (
      await besitzer`select prioritaet from person_tag where user_id = ${sl1} and tag_id = ${biber}`
    )[0].prioritaet,
  ).toBe(3);
  await api`delete from rolle where user_id = ${sl1} and stufe_id = ${neu.id}`;
  await api`delete from stufe where id = ${neu.id}`;
  await expect(
    api`insert into stufe (abteilung_id, name, kuerzel, typ) values (${abt1.id}, 'Falsch', 'F', 'team')`,
  ).rejects.toMatchObject({ code: "44000" });
  // Eine Rolle sitzt nur an einem Stufen-Tag
  await expect(
    api`insert into rolle (user_id, stufe_id, typ) values (${sl1}, ${ohneKollision.id}, 'leitung')`,
  ).rejects.toMatchObject({ code: "44000" });
  await api`update rolle set prioritaet = 2 where user_id = ${sl1} and stufe_id = ${biber}`;

  // Rückweg: Tabellen wie vorher, gleiche Zeilen, Journal ohne 0035; die umbenannten Tags behalten ihr Suffix
  await besitzer.unsafe(
    readFileSync(
      new URL("../drizzle/rueckweg/0035_stufen_auf_tags.sql", import.meta.url),
      "utf8",
    ),
  );
  expect(
    (
      await besitzer`select relkind from pg_class where relname in ('stufe', 'rolle') order by relname`
    ).map((z) => z.relkind),
  ).toEqual(["r", "r"]);
  expect(await besitzer`select * from stufe order by id`).toEqual(vorherStufen);
  expect(
    await besitzer`select * from rolle order by user_id, stufe_id`,
  ).toEqual(
    vorherRollen.map((r) =>
      r.stufe_id === biber && r.user_id === sl1 ? { ...r, prioritaet: 2 } : r,
    ),
  );
  expect(
    await besitzer`select stufe_id from kind where id = ${kind.id}`,
  ).toEqual(vorherKind);
  expect(await ids(besitzer, "tag")).toEqual(vorherTags);
  expect(await besitzer`select count(*)::int as n from person_tag`).toEqual(
    vorherZuordnungen,
  );
  expect(
    (
      await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
    )[0].n,
  ).toBe(34);

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0035 wieder läuft (der Tag mit Suffix bleibt, wie er ist)
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await ids(besitzer, "stufe")).toEqual(vorherStufen.map((s) => s.id));
  expect(
    await besitzer`select * from rolle order by user_id, stufe_id`,
  ).toHaveLength(5);
});
