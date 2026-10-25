import postgres from "postgres";
import { afterAll, expect, test } from "vitest";

// Immer als API-Rolle, auch wenn DATABASE_URL den Superuser nennt: Ihm gelingt jede Rechteprüfung
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://cevi_os_api@localhost:5432/cevi_os",
  { username: "cevi_os_api" },
);
afterAll(() => sql.end());

const ZURUECK = new Error("zurückrollen");

// Jede Prüfung in einer Transaktion, die am Ende zurückrollt
async function zurueckgerollt(
  pruefung: (tx: postgres.TransactionSql) => Promise<void>,
) {
  await sql
    .begin(async (tx) => {
      await pruefung(tx);
      throw ZURUECK;
    })
    .catch((fehler) => {
      if (fehler !== ZURUECK) throw fehler;
    });
}

// Im eigenen Savepoint, damit die Transaktion nach dem Fehler weiterläuft
async function verboten(
  tx: postgres.TransactionSql,
  anweisung: (sp: postgres.TransactionSql) => Promise<unknown>,
) {
  await expect(tx.savepoint(anweisung)).rejects.toMatchObject({
    code: "42501",
  });
}

test("die API-Rolle ergänzt und liest audit_log, kann Einträge aber weder ändern noch löschen", async () => {
  await zurueckgerollt(async (tx) => {
    const [abteilung] =
      await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
    const [eintrag] = await tx`
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id)
      values (${abteilung.id}, 'cli', 'test', 'abteilung', ${abteilung.id})
      returning id`;

    await verboten(
      tx,
      (sp) =>
        sp`update audit_log set aktion = 'geaendert' where id = ${eintrag.id}`,
    );
    await verboten(
      tx,
      (sp) => sp`delete from audit_log where id = ${eintrag.id}`,
    );
    await verboten(tx, (sp) => sp`truncate audit_log`);
    await verboten(tx, (sp) => sp`drop table audit_log`);
    expect(
      await tx`select aktion from audit_log where id = ${eintrag.id}`,
    ).toEqual([{ aktion: "test" }]);
  });
});

test("die API-Rolle benennt Stufen um, löscht aber keine", async () => {
  await zurueckgerollt(async (tx) => {
    const [abteilung] =
      await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
    const [stufe] = await tx`
      insert into stufe (abteilung_id, name, kuerzel, reihenfolge)
      values (${abteilung.id}, 'Teststufe', 'TS', 1)
      returning id`;

    await tx`update stufe set name = 'Umbenannt' where id = ${stufe.id}`;
    await verboten(tx, (sp) => sp`delete from stufe where id = ${stufe.id}`);
    expect(await tx`select name from stufe where id = ${stufe.id}`).toEqual([
      { name: "Umbenannt" },
    ]);
  });
});

test("die API-Rolle legt keine Tabellen an", async () => {
  await zurueckgerollt(async (tx) => {
    await verboten(tx, (sp) => sp`create table test_tabelle (id int)`);
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
