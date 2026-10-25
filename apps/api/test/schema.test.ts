import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, expect, test } from "vitest";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://cevi_os_api@localhost:5432/cevi_os",
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
async function scheitert(
  tx: postgres.TransactionSql,
  fehler: { code: string; constraint_name?: string },
  anweisung: (sp: postgres.TransactionSql) => Promise<unknown>,
) {
  await expect(tx.savepoint(anweisung)).rejects.toMatchObject(fehler);
}

async function grunddaten(tx: postgres.TransactionSql) {
  const [abteilung] =
    await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
  const [stufe] = await tx`
    insert into stufe (abteilung_id, name, kuerzel, reihenfolge)
    values (${abteilung.id}, 'Teststufe', 'TS', 1)
    returning id`;
  const [person] = await tx`
    insert into "user" (name, email, abteilung_id)
    values ('Testperson', ${`${randomUUID()}@benutzer.invalid`}, ${abteilung.id})
    returning id`;
  return {
    abteilung: abteilung.id as string,
    stufe: stufe.id as string,
    person: person.id as string,
  };
}

test("Löschen einer Person entfernt ihre Rollen, Elternverknüpfungen, Sitzungen, Konten und den zweiten Faktor; der Audit-Eintrag über sie bleibt", async () => {
  await zurueckgerollt(async (tx) => {
    const { abteilung, stufe, person } = await grunddaten(tx);
    const kinder: string[] = [];
    for (const vorname of ["Erstes", "Zweites"]) {
      const [kind] = await tx`
        insert into kind (abteilung_id, vorname, nachname, stufe_id)
        values (${abteilung}, ${vorname}, 'Testkind', ${stufe})
        returning id`;
      await tx`insert into kind_eltern (kind_id, user_id) values (${kind.id}, ${person})`;
      kinder.push(kind.id);
    }
    await tx`insert into rolle (user_id, stufe_id, typ) values (${person}, ${stufe}, 'leitung')`;
    await tx`
      insert into session (token, expires_at, updated_at, user_id)
      values (${randomUUID()}, now() + interval '1 day', now(), ${person})`;
    await tx`
      insert into account (account_id, provider_id, user_id, updated_at)
      values (${person}, 'credential', ${person}, now())`;
    await tx`insert into two_factor (secret, backup_codes, user_id) values ('geheim', 'codes', ${person})`;
    await tx`
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id)
      values (${abteilung}, ${person}, 'test', 'user', ${person})`;

    // Ein Kind zu löschen entfernt nur seine eigene Elternverknüpfung
    await tx`delete from kind where id = ${kinder[0]}`;
    expect(
      await tx`select kind_id from kind_eltern where user_id = ${person}`,
    ).toEqual([{ kind_id: kinder[1] }]);

    await tx`delete from "user" where id = ${person}`;
    const [rest] = await tx`
      select
        (select count(*) from rolle where user_id = ${person})::int as rolle,
        (select count(*) from kind_eltern where user_id = ${person})::int as kind_eltern,
        (select count(*) from session where user_id = ${person})::int as session,
        (select count(*) from account where user_id = ${person})::int as account,
        (select count(*) from two_factor where user_id = ${person})::int as two_factor,
        (select count(*) from audit_log where akteur_id = ${person} and ziel_id = ${person})::int as audit_log,
        (select count(*) from kind where id = ${kinder[1]})::int as kind`;
    expect(rest).toEqual({
      rolle: 0,
      kind_eltern: 0,
      session: 0,
      account: 0,
      two_factor: 0,
      audit_log: 1,
      kind: 1,
    });
  });
});

test("eine Abteilung, auf die noch etwas zeigt, lässt sich nicht löschen", async () => {
  await zurueckgerollt(async (tx) => {
    const { abteilung } = await grunddaten(tx);
    // 23001 restrict_violation: PostgreSQL 18 meldet RESTRICT so, NO ACTION dagegen mit 23503
    await scheitert(
      tx,
      { code: "23001" },
      (sp) => sp`delete from abteilung where id = ${abteilung}`,
    );
  });
});

test("jeder Fremdschlüssel auf abteilung oder stufe ist RESTRICT", async () => {
  const fremdschluessel = await sql`
    select conname, confdeltype from pg_constraint
    where contype = 'f' and confrelid in ('abteilung'::regclass, 'stufe'::regclass)`;
  expect(fremdschluessel.length).toBeGreaterThan(0);
  expect(fremdschluessel.filter((f) => f.confdeltype !== "r")).toEqual([]);
});

test("die Datenbank lehnt eine Sitzung mit IP-Adresse oder User-Agent ab", async () => {
  await zurueckgerollt(async (tx) => {
    const { person } = await grunddaten(tx);
    const fehler = {
      code: "23514",
      constraint_name: "session_ohne_ip_und_user_agent",
    };
    await scheitert(
      tx,
      fehler,
      (sp) => sp`
        insert into session (token, expires_at, updated_at, user_id, ip_address)
        values (${randomUUID()}, now() + interval '1 day', now(), ${person}, '203.0.113.7')`,
    );
    await scheitert(
      tx,
      fehler,
      (sp) => sp`
        insert into session (token, expires_at, updated_at, user_id, user_agent)
        values (${randomUUID()}, now() + interval '1 day', now(), ${person}, 'Testgeraet/1.0')`,
    );
  });
});

test("rolle.typ nimmt nur leitung und stufenleitung an", async () => {
  await zurueckgerollt(async (tx) => {
    const { stufe, person } = await grunddaten(tx);
    await scheitert(
      tx,
      { code: "23514", constraint_name: "rolle_typ_check" },
      (sp) =>
        sp`insert into rolle (user_id, stufe_id, typ) values (${person}, ${stufe}, 'admin')`,
    );
    await tx`insert into rolle (user_id, stufe_id, typ) values (${person}, ${stufe}, 'stufenleitung')`;
  });
});
