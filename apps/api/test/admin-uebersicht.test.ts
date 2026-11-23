import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleSchalterZustand } from "../src/bereichsschalter.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { macheWebmaster } from "./hilfen/webmaster.js";
import { antwortVerletzungen } from "./hilfen/vertrag.js";

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

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let slA: PersonaKonto;
let webmaster: PersonaKonto;
let webmasterOhneFaktor: PersonaKonto;
let eltern: PersonaKonto;
let leitende: PersonaKonto;

const hole = (konto: PersonaKonto, pfad = "/api/v1/admin/uebersicht") =>
  app.request(pfad, { headers: konto.headers });
const tage = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, adminOhne, slA, webmaster, webmasterOhneFaktor, eltern, leitende] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "adminOhneZweitenFaktor"),
      legePersonaAn(welt, "slA"),
      legePersonaMitFaktorAn(welt, "leitendeA"),
      legePersonaAn(welt, "leitendeB"),
      legePersonaAn(welt, "elternA"),
      legePersonaAn(welt, "leitendeAElternB"),
    ]);
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
  await macheWebmaster(db, welt.testabteilungId, webmasterOhneFaktor.id!);
  const a = welt.testabteilungId;
  // Offene Punkte: zwei Vorschläge, ein Termin ohne Tag, drei Bestellungen (2 offen, 1 bereit), eine Anfrage
  await db.insert(schema.terminVorschlag).values(
    [1, 2].map((n) => ({
      abteilungId: a,
      vorgeschlagenVon: slA.id!,
      titel: `Vorschlag ${n}`,
      ganztaegig: false,
      beginn: tage(10 + n),
      ende: tage(10 + n + 0.05),
      tagIds: [welt.stufeAId],
    })),
  );
  await db.insert(schema.programm).values({
    abteilungId: a,
    googleEventId: "uebersicht-ohne-tag",
    titel: "Ohne Tag",
    ganztaegig: false,
    beginn: tage(3),
    ende: tage(3.05),
  });
  for (const status of ["offen", "offen", "bereit"] as const) {
    await db.insert(schema.ladenBestellung).values({
      abteilungId: a,
      userId: eltern.id!,
      uebergabe: "Abholung",
      summeRappen: 100,
      status,
    });
  }
  // Zwei Seiten: ein Entwurf der Stufe A und eine veröffentlichte Seite mit geändertem Entwurf
  await db.insert(schema.seite).values({
    abteilungId: a,
    adresse: "stufe-a",
    titel: "Stufe A",
    sichtbarkeit: "oeffentlich",
    tagId: welt.stufeAId,
  });
  const [s2] = await db
    .insert(schema.seite)
    .values({
      abteilungId: a,
      adresse: "andere",
      titel: "Andere",
      sichtbarkeit: "oeffentlich",
      entwurf: { neu: true },
    })
    .returning({ id: schema.seite.id });
  const [v] = await db
    .insert(schema.seiteVersion)
    .values({ seiteId: s2.id, nr: 1, inhalt: { alt: true } })
    .returning({ id: schema.seiteVersion.id });
  await db
    .update(schema.seite)
    .set({ veroeffentlichteVersionId: v.id })
    .where(eq(schema.seite.id, s2.id));
});

describe("GET /api/v1/admin/uebersicht", () => {
  test("Abteilungsleitung: alle Teile mit den Zahlen der Abteilung", async () => {
    const antwort = await hole(admin);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("cache-control")).toBe("private, no-store");
    const d = await antwort.json();
    expect(Object.keys(d).sort()).toEqual([
      "aufgaben",
      "betrieb",
      "erzeugtAm",
      "fehlt",
      "kennzahlen",
      "kinderJeStufe",
      "kommend",
      "zustand",
    ]);
    expect(d.fehlt).toEqual([]);
    expect(d.aufgaben).toMatchObject({
      terminVorschlaege: 2,
      termineOhneKategorie: 1,
      bestellungenOffen: 2,
      bestellungenBereit: 1,
      websiteEntwuerfe: 1,
      websiteAenderungen: 1,
      raumanfragen: 0,
      kalenderFehler: false,
    });
    expect(d.kennzahlen.personen.verlauf).toHaveLength(8);
    expect(d.kennzahlen.personen.verlauf.at(-1)).toBe(
      d.kennzahlen.personen.jetzt,
    );
    expect(d.kennzahlen.bestellungen.verlauf.at(-1)).toBe(3);
    expect(d.kommend.termineProWoche).toHaveLength(8);
    expect(d.kommend.termine.map((t: { titel: string }) => t.titel)).toContain(
      "Ohne Tag",
    );
    expect(d.zustand.website).toMatchObject({
      seiten: 2,
      veroeffentlicht: 1,
      wartung: false,
      sperre: false,
    });
    expect(d.zustand.datenbank.erreichbar).toBe(true);
    expect(d.zustand.kalender.eingerichtet).toBe(false);
    expect(d.betrieb.stunden).toHaveLength(24);
    // Keine Namen, Adressen oder IDs in der Antwort
    const text = JSON.stringify(d);
    expect(text).not.toContain("Vorschlag 1");
    expect(text).not.toMatch(/@|uebersicht-ohne-tag/);
  });

  test("Die Antwort entspricht dem Vertrag", async () => {
    const d = await (await hole(admin)).json();
    expect(
      antwortVerletzungen("/api/v1/admin/uebersicht", "get", 200, d),
    ).toEqual([]);
    const w = await (await hole(webmaster)).json();
    expect(
      antwortVerletzungen("/api/v1/admin/uebersicht", "get", 200, w),
    ).toEqual([]);
  });

  test("Webmaster: nur Website, Medien und Kommendes, keine Zahlen der Abteilungsleitung", async () => {
    const d = await (await hole(webmaster)).json();
    expect(Object.keys(d).sort()).toEqual([
      "aufgaben",
      "erzeugtAm",
      "fehlt",
      "kommend",
      "zustand",
    ]);
    expect(d.aufgaben).toEqual({ websiteEntwuerfe: 1, websiteAenderungen: 1 });
    expect(Object.keys(d.zustand).sort()).toEqual(["medien", "website"]);
    expect(d).not.toHaveProperty("kennzahlen");
    expect(d).not.toHaveProperty("betrieb");
    expect(d).not.toHaveProperty("kinderJeStufe");
  });

  test("Stufenleitung: nur die eigene Stufenseite und die eigene Stufe", async () => {
    const d = await (await hole(slA)).json();
    expect(d.aufgaben).toEqual({ websiteEntwuerfe: 1, websiteAenderungen: 0 });
    expect(d.kinderJeStufe).toHaveLength(1);
    expect(d.kommend.lager).toEqual([]);
    expect(d).not.toHaveProperty("betrieb");
    expect(d.zustand.website.seiten).toBe(1);
  });

  test("ohne Recht: Eltern und Leitende 403, ohne zweiten Faktor 403 mit Code", async () => {
    expect((await hole(eltern)).status).toBe(403);
    expect((await hole(leitende)).status).toBe(403);
    const ohne = await hole(adminOhne);
    expect(ohne.status).toBe(403);
    expect((await ohne.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
    const wm = await hole(webmasterOhneFaktor);
    expect(wm.status).toBe(403);
    expect((await wm.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
    expect((await app.request("/api/v1/admin/uebersicht")).status).toBe(401);
  });

  test("Zwischenspeicher: der zweite Abruf liefert denselben Stand, «frisch» erst nach zehn Sekunden", async () => {
    const eins = await (await hole(admin)).json();
    await db.insert(schema.ladenBestellung).values({
      abteilungId: welt.testabteilungId,
      userId: eltern.id!,
      uebergabe: "Abholung",
      summeRappen: 100,
    });
    const zwei = await (await hole(admin)).json();
    expect(zwei.erzeugtAm).toBe(eins.erzeugtAm);
    expect(zwei.aufgaben.bestellungenOffen).toBe(
      eins.aufgaben.bestellungenOffen,
    );
    const drei = await (
      await hole(admin, "/api/v1/admin/uebersicht?frisch=1")
    ).json();
    // Innerhalb der Mindestfrist bleibt auch «frisch» beim Stand
    expect(drei.erzeugtAm).toBe(eins.erzeugtAm);
  });
});

describe("Wartung und Sperre der Website", () => {
  test("stehen im Zustand der Website, nur für Personen mit Website-Teil", async () => {
    const schalter = erstelleSchalterZustand();
    schalter.setze({
      id: randomUUID(),
      abteilungId: welt.testabteilungId,
      bereich: "website",
      art: "wartung",
      hinweis: null,
      ende: null,
      websiteOffline: false,
      ausgeloestVon: admin.id!,
      ausgeloestAm: new Date(),
    });
    const mitSchalter = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
      schalter,
    });
    const antwort = await mitSchalter.request("/api/v1/admin/uebersicht", {
      headers: admin.headers,
    });
    expect(antwort.status).toBe(200);
    const d = await antwort.json();
    expect(d.zustand.website).toMatchObject({ wartung: true, sperre: false });
  });
});
