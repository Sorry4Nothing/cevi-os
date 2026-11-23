import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { PLATTFORM_RECHT_NAMEN, PLATTFORM_RECHTE } from "../src/plattform.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as logik from "../public/admin/rechte-logik.js";

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

describe("Rollen und Rechte: Logik der Seite", () => {
  const katalog = PLATTFORM_RECHT_NAMEN.map((recht) => ({
    recht,
    bedeutung: PLATTFORM_RECHTE[recht].bedeutung,
    erweitert: PLATTFORM_RECHTE[recht].erweitert,
  }));
  const rolle = (id: string, rechte: string[], personen: string[]) => ({
    id,
    name: id,
    vorgabe: false,
    rechte,
    personen: personen.map((p) => ({ id: p, name: p })),
  });

  test("jedes Recht des Katalogs hat einen Klartext, einen Bereich und eine Wirkung", () => {
    expect(Object.keys(logik.RECHT_INFO).sort()).toEqual(
      [...PLATTFORM_RECHT_NAMEN].sort(),
    );
    const bereiche = logik.BEREICHE.map((b: [string]) => b[0]);
    for (const info of Object.values(logik.RECHT_INFO) as {
      bereich: string;
      wirkung: string;
      text: string;
    }[]) {
      expect(bereiche).toContain(info.bereich);
      expect(logik.WIRKUNG[info.wirkung]).toBeDefined();
      expect(info.text.length).toBeGreaterThan(20);
    }
  });

  test("ein Recht, das nur der Server kennt, erscheint unter «Weitere» mit seinem Text", () => {
    const gruppen = logik.gruppiereKatalog([
      ...katalog,
      { recht: "neu.recht", bedeutung: "Etwas Neues", erweitert: true },
    ]);
    const weitere = gruppen.find(
      (g: { schluessel: string }) => g.schluessel === "weitere",
    );
    expect(weitere.rechte.map((r: { recht: string }) => r.recht)).toEqual([
      "neu.recht",
    ]);
    expect(weitere.rechte[0].titel).toBe("Etwas Neues");
  });

  test("ein Haken an und wieder aus ist keine Änderung", () => {
    const r = rolle("a", ["seiten.bearbeiten"], []);
    const entwurf = new Map();
    logik.setzeRecht(entwurf, r, "medien.verwalten", true);
    expect(logik.anzahlAenderungen([r], entwurf)).toBe(1);
    logik.setzeRecht(entwurf, r, "medien.verwalten", false);
    expect(entwurf.size).toBe(0);
    expect(logik.anzahlAenderungen([r], entwurf)).toBe(0);
  });

  test("die Vorschau zählt Personen nach der Vereinigung ihrer Rollen und lässt die Abteilungsleitung aus", () => {
    const a = rolle("a", ["seiten.bearbeiten"], ["p1", "p2", "admin"]);
    const b = rolle("b", ["medien.verwalten"], ["p2"]);
    const entwurf = new Map();
    // a bekommt «medien.verwalten»: p1 gewinnt es, p2 hat es schon über b, admin zählt nicht
    logik.setzeRecht(entwurf, a, "medien.verwalten", true);
    // a verliert «seiten.bearbeiten»: p1 und p2 verlieren es
    logik.setzeRecht(entwurf, a, "seiten.bearbeiten", false);
    const heikel = (r: string) => r === "medien.verwalten";
    const b2 = logik.betroffene([a, b], entwurf, new Set(["admin"]), heikel);
    expect(b2.gewinnen.get("medien.verwalten")).toEqual(["p1"]);
    expect(b2.verlieren.get("seiten.bearbeiten")).toEqual(["p1", "p2"]);
    expect([...b2.personen].sort()).toEqual(["p1", "p2"]);
    expect(b2.heikel.get("medien.verwalten")).toBe(1);
  });

  test("eine Rolle ohne Personen betrifft niemanden", () => {
    const a = rolle("a", [], []);
    const entwurf = new Map();
    logik.setzeRecht(entwurf, a, "seiten.bearbeiten", true);
    const b = logik.betroffene([a], entwurf, new Set(), () => false);
    expect(b.personen.size).toBe(0);
    expect(logik.vorschauText(b, (r: string) => r)).toMatch(/Niemand/);
  });

  const daten = () => ({
    katalog,
    stufen: [{ id: "s1", name: "Pilami" }],
    personen: [
      {
        id: "u1",
        name: "U Eins",
        admin: false,
        rollen: [{ stufeId: "s1", typ: "stufenleitung" }],
      },
      { id: "u2", name: "U Zwei", admin: true, rollen: [] },
      { id: "u3", name: "U Drei", admin: false, rollen: [] },
    ],
    rollen: [rolle("r1", ["seiten.bearbeiten"], ["u1"])],
    gruppen: [
      {
        id: "g1",
        typ: "team",
        name: "Mat",
        mitglieder: [
          { userId: "u1", rolle: "Verantwortlich" },
          { userId: "u3", rolle: "Materialwart" },
        ],
      },
    ],
    lager: [
      {
        id: "l1",
        titel: "Sola",
        status: "aktiv",
        mitglieder: [{ userId: "u3", rolle: "team" }],
      },
    ],
    raeume: [
      { id: "ra1", name: "Keller", teamTagId: "g1", aktiv: true },
      { id: "ra2", name: "Heim", teamTagId: null, aktiv: true },
    ],
    sonderrechte: [{ id: "b1", seiteId: "se1", userId: null, tagId: "g1" }],
    seiten: [{ id: "se1", titel: "Teamseite" }],
  });
  const zeile = (z: { schluessel: string }[], s: string) =>
    z.find((x) => x.schluessel === s) as
      | { quellen: { umfang: string; herkunft: string; zf: boolean }[] }
      | undefined;

  test("Was darf wer: jede Quelle nennt Herkunft und zweiten Faktor", () => {
    const z = logik.darfVon("u1", daten());
    const bearbeiten = zeile(z, "seiten.bearbeiten")!;
    expect(bearbeiten.quellen.map((q) => q.herkunft)).toEqual([
      "Rolle «r1»",
      "Stufenleitung",
      "Verantwortlich im Team",
      "Sonderrecht der Gruppe «Mat»",
    ]);
    // Die Stufenleitung arbeitet an der eigenen Stufenseite ohne zweiten Faktor (docs/rechte.md, Abschnitt 2)
    expect(bearbeiten.quellen.map((q) => q.zf)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(zeile(z, "raum.entscheiden")!.quellen).toHaveLength(1);
    // Ein Recht ohne Quelle erscheint nicht
    expect(zeile(z, "medien.verwalten")).toBeUndefined();
  });

  test("Was darf wer: «Verantwortlich» zählt nur mit dem Wort, nicht mit einer anderen Bezeichnung", () => {
    const z = logik.darfVon("u3", daten());
    expect(
      zeile(z, "seiten.bearbeiten")!.quellen.map((q) => q.herkunft),
    ).toEqual(["Sonderrecht der Gruppe «Mat»"]);
    // Gruppe und Lager: Vorschlagen und Lagerrolle, aber keine Seite des Teams
    expect(zeile(z, "termine.vorschlagen")!.quellen).toHaveLength(1);
    expect(zeile(z, "lager")!.quellen[0].herkunft).toBe("Rolle Team");
  });

  test("Was darf wer: die Abteilungsleitung hat alles und die Räume ohne Team", () => {
    const z = logik.darfVon("u2", daten());
    expect(zeile(z, "verwaltung")).toBeDefined();
    for (const r of PLATTFORM_RECHT_NAMEN) {
      expect(zeile(z, r)!.quellen[0].herkunft).toBe("Abteilungsleitung");
    }
    expect(zeile(z, "raum.entscheiden")!.quellen[0].umfang).toBe(
      "Raum «Heim» (ohne Team)",
    );
  });

  test("Was darf wer: eine unbekannte Person gibt nichts", () => {
    expect(logik.darfVon("nie", daten())).toEqual([]);
  });

  test("was eine Gruppe trägt: Team, Funktion, Stufe und Lager", () => {
    const d = daten();
    const traegt = (typ: string) =>
      logik
        .gruppeTraegt({ id: "g1", typ, name: "X", mitglieder: [] }, d)
        .map((t: { schluessel: string }) => t.schluessel);
    expect(traegt("team")).toEqual(["seite", "vorschlag", "raeume"]);
    expect(traegt("funktion")).toEqual(["vorschlag", "raeume"]);
    expect(traegt("stufe")).toEqual(["raeume", "stufe"]);
    expect(traegt("lager")).toEqual(["raeume", "lager"]);
  });
});

describe("Rollen und Rechte: Oberfläche", () => {
  const DATEIEN = [
    "rechte.js",
    "rechte-gemeinsam.js",
    "rechte-rollen.js",
    "rechte-gruppen.js",
    "rechte-uebersicht.js",
    "rechte-logik.js",
  ];
  const alle = DATEIEN.map(lies).join("\n");

  test("Seite, Stile und Navigation sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/rechte.css"');
    expect(lies("navigation.js")).toContain('"./rechte.js"');
  });

  test("sie ruft nur Routen auf, die die API kennt", () => {
    expect(alle).toContain("/api/v1/admin/plattform/rollen");
    expect(alle).toContain("/api/v1/admin/rechte/zuordnungen");
    expect(alle).toContain("/api/v1/admin/personen");
    expect(alle).toContain("/api/v1/admin/bearbeiter");
    expect(alle).toContain("/api/v1/admin/tags/");
  });

  test("kein Popup, kein Polling, keine Inline-Stile, keine Farbwerte", () => {
    expect(alle).not.toMatch(
      /\balert\(|\bconfirm\(|\bprompt\(|setInterval|\.style\b|setAttribute\("style"|<dialog/,
    );
    expect(lies("rechte.css")).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });

  test("Rechte werden nie als Schlüssel angezeigt: jede Matrixzeile trägt Klartext", () => {
    expect(lies("rechte-rollen.js")).toContain("r.titel");
    expect(lies("rechte-rollen.js")).toContain("r.text");
  });
});
