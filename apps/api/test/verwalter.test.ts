import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, test } from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { aktiveVerwalter, istLetzterVerwalter } from "../src/verwalter.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { erstelleWelt, legePersonaAn, type Welt } from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

// Eigene Welt je Test: Gezählt wird die ganze Abteilung (#731)
async function neu() {
  const welt: Welt = await erstelleWelt(db, auth);
  const liste = async () => aktiveVerwalter(db, welt.testabteilungId);
  const al = await legePersonaAn(welt, "admin");
  const konto = async () => legePersonaAn(welt, "elternA");
  const entwickler = async (id: string) =>
    db.insert(schema.plattformEntwickler).values({ userId: id });
  return { liste, al, konto, entwickler };
}

describe("aktiveVerwalter und istLetzterVerwalter", () => {
  test("nur eine Abteilungsleitung: sie ist die letzte", async () => {
    const { liste, al } = await neu();
    const verwalter = await liste();
    expect(verwalter).toEqual([{ id: al.id, entwickler: false }]);
    expect(istLetzterVerwalter(verwalter, al.id!)).toBe(true);
  });

  test("ein Entwickler der Abteilung zählt, auch ohne Abteilungsleitung", async () => {
    const { liste, al, konto, entwickler } = await neu();
    const e = await konto();
    await entwickler(e.id!);
    const verwalter = await liste();
    expect(verwalter.map((v) => v.id).sort()).toEqual([al.id, e.id].sort());
    expect(istLetzterVerwalter(verwalter, al.id!)).toBe(false);
    expect(istLetzterVerwalter(verwalter, e.id!)).toBe(false);
  });

  test("der Entwickler allein ist der letzte; die Abteilungsleitung zu entziehen ändert für ihn nichts", async () => {
    const { liste, al, konto, entwickler } = await neu();
    const e = await konto();
    await entwickler(e.id!);
    await db
      .delete(schema.abteilungsleitungPerson)
      .where(eq(schema.abteilungsleitungPerson.userId, al.id!));
    const verwalter = await liste();
    expect(verwalter).toEqual([{ id: e.id, entwickler: true }]);
    expect(istLetzterVerwalter(verwalter, e.id!)).toBe(true);
    expect(istLetzterVerwalter(verwalter, e.id!, true)).toBe(false);
  });

  test("Abteilungsleitung und Entwickler in einem Konto: Entziehen der Abteilungsleitung lässt ihn stehen, Deaktivieren und Löschen nicht", async () => {
    const { liste, al, entwickler } = await neu();
    await entwickler(al.id!);
    const verwalter = await liste();
    expect(verwalter).toEqual([{ id: al.id, entwickler: true }]);
    expect(istLetzterVerwalter(verwalter, al.id!)).toBe(true);
    expect(istLetzterVerwalter(verwalter, al.id!, true)).toBe(false);
  });

  test("ein Konto einer anderen Abteilung zählt nicht", async () => {
    const eigene = await neu();
    const fremd = await neu();
    expect((await fremd.liste()).map((v) => v.id)).toEqual([fremd.al.id]);
    expect((await eigene.liste()).map((v) => v.id)).toEqual([eigene.al.id]);
    expect(istLetzterVerwalter(await eigene.liste(), fremd.al.id!)).toBe(false);
  });

  test("gesperrte und deaktivierte Konten zählen nicht, banned null zählt", async () => {
    const { liste, al, konto, entwickler } = await neu();
    const gesperrt = await konto();
    const deaktiviert = await konto();
    await entwickler(gesperrt.id!);
    await entwickler(deaktiviert.id!);
    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.id, gesperrt.id!));
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, deaktiviert.id!));
    expect((await liste()).map((v) => v.id)).toEqual([al.id]);
    // banned ist nullable: eine alte Zeile ohne Wert gilt als aktiv
    await db
      .update(schema.user)
      .set({ banned: null })
      .where(eq(schema.user.id, gesperrt.id!));
    expect((await liste()).map((v) => v.id).sort()).toEqual(
      [al.id, gesperrt.id].sort(),
    );
  });

  test("eine Person ohne Abteilungsleitung und ohne Entwickler ist nie die letzte", async () => {
    const { liste, konto } = await neu();
    const gewoehnlich = await konto();
    expect(istLetzterVerwalter(await liste(), gewoehnlich.id!)).toBe(false);
  });
});
