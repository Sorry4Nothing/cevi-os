import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CeviPerson } from "../../src/cevi-db/felder.js";
import { uebernehmeGeschlecht } from "../../src/cevi-db/geschlecht.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import type { Geschlecht } from "../../src/geschlecht.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import { erstelleWelt, type Welt } from "../hilfen/personas.js";

// Übernahme des Geschlechts aus der Cevi-Datenbank (#843): nur zugeordnete Konten, nie von Hand, nie ein Kind. Erfundene Personen und Nummern
bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
let welt: Welt;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
});
afterAll(() => sql.end());

const cevi = (id: string, geschlecht: Geschlecht | null): CeviPerson => ({
  id,
  vorname: "Lea",
  nachname: "Muster",
  email: null,
  geburtsdatum: null,
  telefon: null,
  strasse: null,
  plz: null,
  ort: null,
  geschlecht,
});
// Jede Prüfung eigene Nummern: Die Dateien teilen sich die Datenbank
const nummer = () => randomUUID();

async function konto(
  felder: Partial<typeof schema.user.$inferInsert> = {},
): Promise<string> {
  const [u] = await db
    .insert(schema.user)
    .values({
      name: "Test Person",
      email: `${randomUUID()}@benutzer.invalid`,
      abteilungId: welt.testabteilungId,
      ...felder,
    })
    .returning({ id: schema.user.id });
  return u.id;
}
const geschlechtVon = async (id: string) =>
  (
    await db
      .select({ g: schema.user.geschlecht })
      .from(schema.user)
      .where(eq(schema.user.id, id))
  )[0]!.g;

test("setzt w und m bei zugeordneten Konten und folgt der Cevi-Datenbank, solange niemand von Hand eingreift", async () => {
  const [a, b] = [nummer(), nummer()];
  const lea = await konto({ ceviDbId: a });
  const tim = await konto({ ceviDbId: b });
  expect(
    await uebernehmeGeschlecht(db, welt.testabteilungId, [
      cevi(a, "w"),
      cevi(b, "m"),
    ]),
  ).toBe(2);
  expect(await geschlechtVon(lea)).toBe("w");
  expect(await geschlechtVon(tim)).toBe("m");
  // Gleicher Stand: nichts zu ändern
  expect(
    await uebernehmeGeschlecht(db, welt.testabteilungId, [cevi(a, "w")]),
  ).toBe(0);
  // Ändert es sich dort, ändert es sich hier; fehlt es dort, ist es hier keine Angabe
  await uebernehmeGeschlecht(db, welt.testabteilungId, [
    cevi(a, "m"),
    cevi(b, null),
  ]);
  expect(await geschlechtVon(lea)).toBe("m");
  expect(await geschlechtVon(tim)).toBeNull();
});

test("von Hand gesetzt, auch «keine Angabe», bleibt", async () => {
  const [a, b] = [nummer(), nummer()];
  const mitWert = await konto({
    ceviDbId: a,
    geschlecht: "w",
    geschlechtVonHand: true,
  });
  const ohneWert = await konto({ ceviDbId: b, geschlechtVonHand: true });
  expect(
    await uebernehmeGeschlecht(db, welt.testabteilungId, [
      cevi(a, "m"),
      cevi(b, "w"),
    ]),
  ).toBe(0);
  expect(await geschlechtVon(mitWert)).toBe("w");
  expect(await geschlechtVon(ohneWert)).toBeNull();
});

test("ohne gemerkte Nummer, in einer anderen Abteilung oder als Konto eines Kindes: nie", async () => {
  const [a, b, c] = [nummer(), nummer(), nummer()];
  const ohneNummer = await konto();
  const fremd = await konto({
    ceviDbId: b,
    abteilungId: welt.demoAbteilungId,
  });
  const kindKonto = await konto({ ceviDbId: c });
  await db
    .update(schema.kind)
    .set({ userId: kindKonto })
    .where(eq(schema.kind.id, welt.kindBId));
  try {
    expect(
      await uebernehmeGeschlecht(db, welt.testabteilungId, [
        cevi(a, "w"),
        cevi(b, "w"),
        cevi(c, "w"),
      ]),
    ).toBe(0);
  } finally {
    await db
      .update(schema.kind)
      .set({ userId: null })
      .where(eq(schema.kind.id, welt.kindBId));
  }
  expect(await geschlechtVon(ohneNummer)).toBeNull();
  expect(await geschlechtVon(fremd)).toBeNull();
  expect(await geschlechtVon(kindKonto)).toBeNull();
});

test("Kinder haben keine Spalte dafür", () => {
  const spalten = getTableConfig(schema.kind).columns.map((c) => c.name);
  expect(spalten).toContain("cevi_db_id");
  expect(spalten.filter((s) => s.includes("geschlecht"))).toEqual([]);
});
