import { randomUUID } from "node:crypto";
import { eq, TransactionRollbackError } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, expect, test } from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { API_URL } from "./hilfen/datenbank.js";
import { scheitert, zurueckgerollt } from "./transaktion.js";

const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

async function grunddaten(tx: postgres.TransactionSql) {
  const [abteilung] =
    await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
  const [stufe] = await tx`
    insert into stufe (abteilung_id, name, kuerzel)
    values (${abteilung.id}, 'Teststufe', 'TS')
    returning id`;
  const [eltern] = await tx`
    insert into "user" (name, email, abteilung_id)
    values ('Testperson', ${`${randomUUID()}@example.org`}, ${abteilung.id})
    returning id`;
  return {
    abteilung: abteilung.id as string,
    stufe: stufe.id as string,
    eltern: eltern.id as string,
  };
}

test("pro Stufe höchstens ein Gruppenchat, pro Elternteil und Stufe höchstens ein Einzelchat", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const { abteilung, stufe, eltern } = await grunddaten(tx);
    await tx`insert into chat (abteilung_id, typ, stufe_id) values (${abteilung}, 'stufe', ${stufe})`;
    await scheitert(
      tx,
      { code: "23505", constraint_name: "chat_gruppe_pro_stufe" },
      (sp) =>
        sp`insert into chat (abteilung_id, typ, stufe_id) values (${abteilung}, 'stufe', ${stufe})`,
    );
    await tx`
      insert into chat (abteilung_id, typ, stufe_id, eltern_user_id)
      values (${abteilung}, 'direkt', ${stufe}, ${eltern})`;
    await scheitert(
      tx,
      { code: "23505", constraint_name: "chat_direkt_pro_eltern" },
      (sp) => sp`
        insert into chat (abteilung_id, typ, stufe_id, eltern_user_id)
        values (${abteilung}, 'direkt', ${stufe}, ${eltern})`,
    );
  });
});

test("eltern_user_id gehört genau zum Einzelchat", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const { abteilung, stufe, eltern } = await grunddaten(tx);
    const fehler = { code: "23514", constraint_name: "chat_eltern_nur_direkt" };
    await scheitert(
      tx,
      fehler,
      (sp) => sp`
        insert into chat (abteilung_id, typ, stufe_id, eltern_user_id)
        values (${abteilung}, 'stufe', ${stufe}, ${eltern})`,
    );
    await scheitert(
      tx,
      fehler,
      (sp) =>
        sp`insert into chat (abteilung_id, typ, stufe_id) values (${abteilung}, 'direkt', ${stufe})`,
    );
  });
});

test("chat.typ nimmt nur stufe und direkt an", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const { abteilung, stufe, eltern } = await grunddaten(tx);
    // Roh statt über Drizzle: Dessen enum-Typ lehnt «foo» schon in TypeScript ab; chat_eltern_nur_direkt liesse es durch
    await scheitert(
      tx,
      { code: "23514", constraint_name: "chat_typ_check" },
      (sp) => sp`
        insert into chat (abteilung_id, typ, stufe_id, eltern_user_id)
        values (${abteilung}, 'foo', ${stufe}, ${eltern})`,
    );
  });
});

test("ein zweiter Einzelchat entsteht per insert … on conflict do nothing nicht", async () => {
  await db
    .transaction(async (tx) => {
      const [abteilung] = await tx
        .insert(schema.abteilung)
        .values({ name: "Testabteilung" })
        .returning();
      const [stufe] = await tx
        .insert(schema.stufe)
        .values({
          abteilungId: abteilung.id,
          name: "Teststufe",
          kuerzel: "TS",
        })
        .returning();
      const [eltern] = await tx
        .insert(schema.user)
        .values({
          name: "Testperson",
          email: `${randomUUID()}@example.org`,
          abteilungId: abteilung.id,
        })
        .returning();
      const werte = {
        abteilungId: abteilung.id,
        typ: "direkt" as const,
        stufeId: stufe.id,
        elternUserId: eltern.id,
      };
      const [erster] = await tx.insert(schema.chat).values(werte).returning();
      // Ohne Ziel: DO NOTHING wirkt bei jedem Konflikt, der Teilindex braucht keines (#50 legt Einzelchats so an)
      const zweiter = await tx
        .insert(schema.chat)
        .values(werte)
        .onConflictDoNothing()
        .returning();
      expect(zweiter).toEqual([]);
      expect(
        await tx
          .select({ id: schema.chat.id })
          .from(schema.chat)
          .where(eq(schema.chat.elternUserId, eltern.id)),
      ).toEqual([{ id: erster.id }]);
      tx.rollback();
    })
    .catch((fehler) => {
      if (!(fehler instanceof TransactionRollbackError)) throw fehler;
    });
});

test("die Löschregeln der fünf Chat-Tabellen stimmen", async () => {
  // confdeltype: c = CASCADE, n = SET NULL, r = RESTRICT; die Namen vergibt drizzle-kit, darum der Vergleich über Tabelle und Spalte
  const regeln = await sql`
    select c.conrelid::regclass::text as tabelle, a.attname as spalte, c.confdeltype as regel
    from pg_constraint c
    cross join lateral unnest(c.conkey) as spalten(attnum)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = spalten.attnum
    where c.contype = 'f'
      and c.conrelid::regclass::text in ('chat', 'nachricht', 'chat_status', 'blockierung')
    order by tabelle, spalte`;
  expect(regeln).toEqual([
    { tabelle: "blockierung", spalte: "blockiert_id", regel: "c" },
    { tabelle: "blockierung", spalte: "user_id", regel: "c" },
    { tabelle: "chat", spalte: "abteilung_id", regel: "r" },
    { tabelle: "chat", spalte: "eltern_user_id", regel: "c" },
    { tabelle: "chat", spalte: "stufe_id", regel: "r" },
    { tabelle: "chat_status", spalte: "chat_id", regel: "c" },
    { tabelle: "chat_status", spalte: "user_id", regel: "c" },
    { tabelle: "nachricht", spalte: "autor_id", regel: "c" },
    { tabelle: "nachricht", spalte: "chat_id", regel: "c" },
    { tabelle: "nachricht", spalte: "programm_id", regel: "n" },
  ]);
});
