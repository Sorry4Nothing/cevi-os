import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../src/website/ereignisse.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Profilbild einer Person entfernen (#642): Abteilungsleitung und Entwickler, beide mit zweitem Faktor
bereiteAuthTestsVor();

const sql_ = postgres(API_URL);
const db = erstelleDb(sql_);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql: sql_,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(async () => {
  await sql_.end();
});

let welt: Welt;
let admin: PersonaKonto;
let adminOhneFaktor: PersonaKonto;
let entwickler: PersonaKonto;
let entwicklerOhneFaktor: PersonaKonto;
let sl: PersonaKonto;
let demoAdmin: PersonaKonto;
let ziel: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  adminOhneFaktor = await legePersonaAn(welt, "adminOhneZweitenFaktor");
  entwickler = await legePersonaMitFaktorAn(welt, "leitendeA");
  entwicklerOhneFaktor = await legePersonaAn(welt, "leitendeB");
  sl = await legePersonaMitFaktorAn(welt, "slA");
  demoAdmin = await legePersonaAn(welt, "demoAdmin");
  ziel = await legePersonaAn(welt, "elternA");
  await db
    .insert(schema.plattformEntwickler)
    .values([{ userId: entwickler.id! }, { userId: entwicklerOhneFaktor.id! }]);
});

const bildSetzen = () =>
  db
    .insert(schema.profilbild)
    .values({ userId: ziel.id!, inhalt: new Uint8Array([1, 2, 3]) })
    .onConflictDoNothing();
const hatBild = async () =>
  (
    await db
      .select({ id: schema.profilbild.userId })
      .from(schema.profilbild)
      .where(eq(schema.profilbild.userId, ziel.id!))
  ).length > 0;
const entfernen = (konto: PersonaKonto, id = ziel.id!) =>
  app.request(`/api/v1/admin/personen/${id}/bild`, {
    method: "DELETE",
    headers: konto.headers,
  });
const eintraege = () =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.zielId, ziel.id!),
        eq(schema.auditLog.aktion, "profilbild_entfernt"),
      ),
    );

describe("DELETE /api/v1/admin/personen/:id/bild", () => {
  test("Abteilungsleitung: Bild weg, Eintrag ohne Inhalt, Website meldet Änderung", async () => {
    await bildSetzen();
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    const antwort = await entfernen(admin);
    ab();
    expect(antwort.status).toBe(204);
    expect(await hatBild()).toBe(false);
    const zeilen = await eintraege();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.akteurId).toBe(admin.id);
    expect(zeilen[0]!.zielTyp).toBe("person");
    expect(zeilen[0]!.details).toBeNull();
    expect(ereignisse).toContainEqual({
      art: "seite_geaendert",
      abteilungId: welt.testabteilungId,
    });
  });

  test("Entwickler ohne Recht der Abteilungsleitung mit zweitem Faktor: erlaubt, ohne Faktor 403 ZWEITER_FAKTOR_FEHLT", async () => {
    await bildSetzen();
    const ohne = await entfernen(entwicklerOhneFaktor);
    expect(ohne.status).toBe(403);
    expect((await ohne.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
    expect(await hatBild()).toBe(true);
    const mit = await entfernen(entwickler);
    expect(mit.status).toBe(204);
    expect(await hatBild()).toBe(false);
  });

  test("ohne Bild: 204 und kein weiterer Eintrag", async () => {
    const vorher = (await eintraege()).length;
    expect((await entfernen(admin)).status).toBe(204);
    expect(await eintraege()).toHaveLength(vorher);
  });

  test("andere Personen 403, Abteilungsleitung ohne zweiten Faktor 403, Bild bleibt", async () => {
    await bildSetzen();
    expect((await entfernen(sl)).status).toBe(403);
    const ohne = await entfernen(adminOhneFaktor);
    expect(ohne.status).toBe(403);
    expect((await ohne.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
    expect(await hatBild()).toBe(true);
  });

  test("fremde Abteilung und unbekannte ID: 404 vor dem Recht, Bild bleibt", async () => {
    expect((await entfernen(demoAdmin)).status).toBe(404);
    expect((await entfernen(sl, crypto.randomUUID())).status).toBe(404);
    expect(await hatBild()).toBe(true);
  });
});
