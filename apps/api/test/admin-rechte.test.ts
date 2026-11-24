import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// «Rollen und Rechte» der Verwaltung (#623): die Route der Zuordnungen und die reine Logik der Seite

bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

describe("GET /api/v1/admin/rechte/zuordnungen", () => {
  let welt: Welt;
  let admin: PersonaKonto;
  let adminOhne: PersonaKonto;
  let sl: PersonaKonto;
  let demoAdmin: PersonaKonto;
  let tagId: string;
  let fremdTagId: string;
  let seiteId: string;

  beforeAll(async () => {
    welt = await erstelleWelt(db, auth);
    [admin, adminOhne, sl, demoAdmin] = await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "adminOhneZweitenFaktor"),
      legePersonaAn(welt, "slA"),
      legePersonaAn(welt, "demoAdmin"),
    ]);
    const [tag] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Mat ${randomUUID()}`,
        kuerzel: "",
      })
      .returning({ id: schema.tag.id });
    tagId = tag.id;
    const [fremd] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.demoAbteilungId,
        typ: "team",
        name: `Fremd ${randomUUID()}`,
        kuerzel: "",
      })
      .returning({ id: schema.tag.id });
    fremdTagId = fremd.id;
    await db.insert(schema.personTag).values({
      userId: sl.id!,
      tagId,
      rolle: "verantwortlich",
    });
    const [s] = await db
      .insert(schema.seite)
      .values({
        abteilungId: welt.testabteilungId,
        adresse: `rr-${randomUUID().slice(0, 8)}`,
        titel: "Teamseite",
        sichtbarkeit: "angemeldet",
      })
      .returning({ id: schema.seite.id });
    seiteId = s.id;
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: seiteId,
      tagId,
    });
  });

  const hole = (konto: PersonaKonto) =>
    app.request("/api/v1/admin/rechte/zuordnungen", {
      headers: konto.headers,
    });

  test("die Abteilungsleitung sieht Gruppen mit Mitgliedern, Lager, Räume, Sonderrechte und Seiten der eigenen Abteilung", async () => {
    const antwort = await hole(admin);
    expect(antwort.status).toBe(200);
    const daten = await antwort.json();
    const gruppe = daten.gruppen.find((g: { id: string }) => g.id === tagId);
    expect(gruppe.typ).toBe("team");
    expect(gruppe.mitglieder).toEqual([
      { userId: sl.id, rolle: "verantwortlich" },
    ]);
    expect(daten.sonderrechte).toEqual([
      { id: expect.any(String), seiteId, userId: null, tagId },
    ]);
    expect(daten.seiten.map((s: { id: string }) => s.id)).toContain(seiteId);
    expect(Object.keys(daten).sort()).toEqual(
      ["gruppen", "lager", "raeume", "seiten", "sonderrechte"].sort(),
    );
  });

  test("nie etwas aus einer anderen Abteilung", async () => {
    const daten = await (await hole(admin)).json();
    expect(daten.gruppen.map((g: { id: string }) => g.id)).not.toContain(
      fremdTagId,
    );
    const fremd = await (await hole(demoAdmin)).json();
    expect(fremd.gruppen.map((g: { id: string }) => g.id)).toContain(
      fremdTagId,
    );
    expect(fremd.gruppen.map((g: { id: string }) => g.id)).not.toContain(tagId);
    expect(fremd.sonderrechte).toEqual([]);
  });

  test("keine Namen und keine Kontaktdaten von Personen in der Antwort", async () => {
    const text = JSON.stringify(await (await hole(admin)).json());
    expect(text).not.toMatch(/telefon|email|benutzername|"name":"[^"]*Test/i);
  });

  test("ohne zweiten Faktor, als Stufenleitung und ohne Anmeldung gibt es nichts", async () => {
    expect((await hole(adminOhne)).status).toBe(403);
    expect((await hole(sl)).status).toBe(403);
    const ohne = await app.request("/api/v1/admin/rechte/zuordnungen");
    expect(ohne.status).toBe(401);
  });

  test("nur lesen: andere Methoden gibt es nicht", async () => {
    for (const methode of ["POST", "PUT", "PATCH", "DELETE"]) {
      const antwort = await app.request("/api/v1/admin/rechte/zuordnungen", {
        method: methode,
        headers: { ...admin.headers, "content-type": "application/json" },
        body: methode === "DELETE" ? undefined : "{}",
      });
      expect(antwort.status).toBe(404);
    }
  });
});

describe("Rollen und Rechte: Oberfläche", () => {
  const DATEIEN = [
    "rechte.js",
    "rechte-api.js",
    "rechte-gemeinsam.js",
    "rechte-matrix.js",
    "rechte-modell.js",
    "rechte-rolle.js",
    "rechte-rollen.js",
    "rechte-gruppen.js",
    "rechte-uebersicht.js",
    "rechte-anlass.js",
  ];
  const alle = DATEIEN.map(lies).join("\n");

  test("Seite, Stile und Navigation sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/rechte.css"');
    expect(lies("navigation.js")).toContain('"./rechte.js"');
  });

  test("sie ruft nur Routen auf, die die API kennt", () => {
    for (const pfad of [
      "/api/v1/admin/rechte",
      "/api/v1/admin/personen",
      "/api/v1/admin/tags",
      "/api/v1/admin/plattform/rollen/",
    ]) {
      expect(alle).toContain(pfad);
    }
    const api = lies("rechte-api.js");
    for (const teil of [
      "/katalog",
      "/gruppen",
      "/rollen",
      "/personen/",
      "/aenderungen",
      "/rollen/vorschau",
    ]) {
      expect(api).toContain(teil);
    }
  });

  test("kein Popup, kein Polling, keine Inline-Stile, keine Farbwerte", () => {
    expect(alle).not.toMatch(
      /\balert\(|\bconfirm\(|\bprompt\(|setInterval|\.style\b|setAttribute\("style"|<dialog/,
    );
    expect(lies("rechte.css")).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });

  test("Rechte werden nie als Schlüssel angezeigt: die Matrix zeigt Klartext und Erklärung des Katalogs", () => {
    const matrix = lies("rechte-matrix.js");
    expect(matrix).toContain("recht.klartext");
    expect(matrix).toContain("recht.erklaerung");
  });

  test("jede Zelle ist eine Radiogruppe mit Namen, jedes Segment 44 px hoch, Pfeiltasten wechseln", () => {
    const matrix = lies("rechte-matrix.js");
    expect(matrix).toContain('role: "radiogroup"');
    expect(matrix).toContain('role: "radio"');
    expect(matrix).toContain("ArrowRight");
    expect(lies("rechte.css")).toMatch(/\.rr-segment \{[^}]*min-height: 44px/);
  });

  test("Karten für schmale Bildschirme und die Matrix teilen sich einen Entwurf", () => {
    const matrix = lies("rechte-matrix.js");
    expect(matrix).toContain("baueKarten");
    expect(matrix).toContain("baueTabelle");
    expect(matrix).toContain("setzeZelle(z.entwurf");
  });

  test("der Server entscheidet über Versionen: Speichern schickt die Version mit, ein Konflikt behält den Entwurf", () => {
    const seite = lies("rechte.js");
    expect(seite).toContain("version: rolle.version");
    expect(seite).toContain("VERSION_KONFLIKT");
    expect(seite).toContain("uebernehmeStand");
    expect(seite).toMatch(/zweiStufig/);
  });

  test("Reihenfolge der Rollen per Ziehen, Tastatur und Knöpfen", () => {
    const gruppen = lies("rechte-gruppen.js");
    expect(gruppen).toContain("sortierListe");
    expect(gruppen).toContain("mitRueckgaengig");
  });

  test("Löschen zeigt die Folgen am Ort und fragt zweimal", () => {
    const rolle = lies("rechte-rolle.js");
    expect(rolle).toContain("bestaetigeAmOrt");
    expect(rolle).toContain("verlieren die Rolle");
    expect(rolle).toContain("lässt sich nicht rückgängig machen");
  });

  test("die Anlass-Seite legt das OK mit den Rollenvorschlägen an", () => {
    expect(lies("termine-anlaesse.js")).toContain("rechte-anlass.js");
    const anlass = lies("rechte-anlass.js");
    expect(anlass).toContain("vorschlaegeFuer");
    expect(anlass).toContain('typ: "anlass"');
  });
});
