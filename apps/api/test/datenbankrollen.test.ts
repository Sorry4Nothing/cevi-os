import postgres from "postgres";
import { afterAll, expect, test } from "vitest";
import { API_URL } from "./hilfen/datenbank.js";
import { scheitert, zurueckgerollt } from "./transaktion.js";

const sql = postgres(API_URL);
afterAll(() => sql.end());

test("die API-Rolle ergänzt und liest audit_log, kann Einträge aber weder ändern noch löschen", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const [abteilung] =
      await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
    const [eintrag] = await tx`
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id)
      values (${abteilung.id}, 'cli', 'test', 'abteilung', ${abteilung.id})
      returning id`;

    await scheitert(
      tx,
      { code: "42501" },
      (sp) =>
        sp`update audit_log set aktion = 'geaendert' where id = ${eintrag.id}`,
    );
    await scheitert(
      tx,
      { code: "42501" },
      (sp) => sp`delete from audit_log where id = ${eintrag.id}`,
    );
    await scheitert(tx, { code: "42501" }, (sp) => sp`truncate audit_log`);
    await scheitert(tx, { code: "42501" }, (sp) => sp`drop table audit_log`);
    expect(
      await tx`select aktion from audit_log where id = ${eintrag.id}`,
    ).toEqual([{ aktion: "test" }]);
  });
});

test("die API-Rolle benennt Stufen um, löscht aber keine", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const [abteilung] =
      await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
    const [stufe] = await tx`
      insert into stufe (abteilung_id, name, kuerzel, reihenfolge)
      values (${abteilung.id}, 'Teststufe', 'TS', 1)
      returning id`;

    await tx`update stufe set name = 'Umbenannt' where id = ${stufe.id}`;
    await scheitert(
      tx,
      { code: "42501" },
      (sp) => sp`delete from stufe where id = ${stufe.id}`,
    );
    expect(await tx`select name from stufe where id = ${stufe.id}`).toEqual([
      { name: "Umbenannt" },
    ]);
  });
});

test("die API-Rolle legt keine Tabellen an", async () => {
  await zurueckgerollt(sql, async (tx) => {
    await scheitert(
      tx,
      { code: "42501" },
      (sp) => sp`create table test_tabelle (id int)`,
    );
  });
});

test("die API-Rolle ist kein Superuser und legt weder Datenbanken noch Rollen an", async () => {
  expect(
    await sql`
      select current_user as rolle, rolsuper, rolcreatedb, rolcreaterole
      from pg_roles where rolname = current_user`,
  ).toEqual([
    {
      rolle: "cevi_os_api",
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    },
  ]);
});

test("alle Tabellen in public gehören cevi_os_besitzer", async () => {
  const tabellen =
    await sql`select tablename, tableowner from pg_tables where schemaname = 'public'`;
  expect(tabellen.map((t) => t.tablename)).toContain("audit_log");
  expect(new Set(tabellen.map((t) => t.tableowner))).toEqual(
    new Set(["cevi_os_besitzer"]),
  );
});

test("die API-Rolle löscht per audit_log_aufraeumen() nur Einträge, die älter als 24 Monate sind", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const [abteilung] =
      await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
    await tx`
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, erstellt_am)
      values (${abteilung.id}, 'cli', 'alt', 'abteilung', ${abteilung.id}, now() - interval '25 months'),
             (${abteilung.id}, 'cli', 'neu', 'abteilung', ${abteilung.id}, now() - interval '23 months')`;

    const [{ aufraeumen }] =
      await tx`select audit_log_aufraeumen() as aufraeumen`;
    expect(Number(aufraeumen)).toBeGreaterThanOrEqual(1);
    expect(
      await tx`select aktion from audit_log where abteilung_id = ${abteilung.id}`,
    ).toEqual([{ aktion: "neu" }]);
  });
});
