import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

// Menü für Angemeldete (#795): GET /api/v1/website/navigation. Die Auswahl selbst (reine Funktion): test/website-navigation-angemeldet.test.ts
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
let leitendeA: PersonaKonto;
let elternA: PersonaKonto;
let elternB: PersonaKonto;
let ohneLogin: PersonaKonto;
let mussWechseln: PersonaKonto;
let demoEltern: PersonaKonto;
let tagId: string;

type Eintrag = {
  pfad: string;
  titel: string;
  eltern: string | null;
  davor: string | null;
};
const navigation = (k: PersonaKonto) =>
  app.request("/api/v1/website/navigation", { headers: k.headers });
const lies = async (k: PersonaKonto) => {
  const a = await navigation(k);
  expect(a.status).toBe(200);
  return ((await a.json()) as { eintraege: Eintrag[] }).eintraege;
};

const slug = () => `n-${randomUUID().slice(0, 12)}`;
async function seite(
  adresse: string,
  sichtbarkeit: "oeffentlich" | "angemeldet" | "tags",
  opt: {
    titel?: string;
    veroeffentlicht?: boolean;
    elternId?: string | null;
    reihenfolge?: number;
    abteilungId?: string;
  } = {},
) {
  const [s] = await db
    .insert(schema.seite)
    .values({
      abteilungId: opt.abteilungId ?? welt.testabteilungId,
      elternId: opt.elternId ?? null,
      adresse,
      titel: opt.titel ?? adresse,
      reihenfolge: opt.reihenfolge ?? 0,
      sichtbarkeit,
      sichtbarkeitTags: sichtbarkeit === "tags" ? [tagId] : [],
    })
    .returning();
  if (opt.veroeffentlicht !== false) {
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({
        seiteId: s!.id,
        nr: 1,
        inhalt: { v: 1, titel: "Geheimer Inhaltstitel", bausteine: [] },
      })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, s!.id));
  }
  return s!.id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, leitendeA, elternA, elternB, ohneLogin, mussWechseln] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "leitendeA"),
      legePersonaAn(welt, "elternA"),
      legePersonaAn(welt, "elternB"),
      legePersonaAn(welt, "ohneLogin"),
      legePersonaAn(welt, "mussPasswortAendern"),
    ]);
  demoEltern = await legePersonaAn(welt, "demoEltern");
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: "Menü Test",
      kuerzel: "MT",
    })
    .returning();
  tagId = t!.id;
  await db
    .insert(schema.personTag)
    .values({ userId: leitendeA.id!, tagId, rolle: "Leitung" });
});

describe("GET /api/v1/website/navigation", () => {
  test("ohne Sitzung 401 mit neutralem Body, ohne Hinweis auf Seiten", async () => {
    await seite(slug(), "angemeldet", { titel: "Menue-Geheimtitel" });
    const a = await navigation(ohneLogin);
    expect(a.status).toBe(401);
    expect(await a.text()).not.toMatch(/Menue-Geheimtitel|eintraege/);
  });

  test("Pflichtwechsel des Passworts offen: 403", async () => {
    expect((await navigation(mussWechseln)).status).toBe(403);
  });

  test("Antwortköpfe: nie in einem gemeinsamen Zwischenspeicher", async () => {
    const a = await navigation(elternA);
    expect(a.headers.get("cache-control")).toBe("private, no-store");
    expect(a.headers.get("vary")?.toLowerCase()).toContain("cookie");
  });

  test("Seite «nur angemeldet»: Eltern und Leitung sehen sie, mit Titel, Adresse und Position, nie Inhalt", async () => {
    const adresse = slug();
    await seite(adresse, "angemeldet", { titel: "Fotos Menü" });
    for (const k of [elternA, elternB, leitendeA, admin]) {
      const e = await lies(k);
      const z = e.find((x) => x.pfad === `/${adresse}`);
      expect(z).toMatchObject({ titel: "Fotos Menü", eltern: null });
      expect(Object.keys(z!).sort()).toEqual([
        "davor",
        "eltern",
        "pfad",
        "titel",
      ]);
      expect(JSON.stringify(e)).not.toContain("Geheimer Inhaltstitel");
    }
  });

  test("Seite für eine Gruppe: nur wer den Tag trägt und die Abteilungsleitung; alle anderen bekommen sie nicht, auch keine Zahl", async () => {
    const adresse = slug();
    await seite(adresse, "tags", { titel: "Nur Gruppe Menü" });
    const mit = (await lies(leitendeA)).map((x) => x.pfad);
    expect(mit).toContain(`/${adresse}`);
    expect((await lies(admin)).map((x) => x.pfad)).toContain(`/${adresse}`);
    for (const k of [elternA, elternB]) {
      const a = await navigation(k);
      const text = await a.text();
      expect(text).not.toContain(adresse);
      expect(text).not.toContain("Nur Gruppe Menü");
    }
  });

  test("Konto ohne Gruppe (Eltern, das eigene Konto eines Kindes folgt derselben Regel): gleiche Regel wie beim Nachladen, nur «angemeldet», nie Gruppen", async () => {
    const gruppe = slug();
    const offen = slug();
    await seite(gruppe, "tags");
    await seite(offen, "angemeldet");
    const pfade = (await lies(elternA)).map((x) => x.pfad);
    expect(pfade).toContain(`/${offen}`);
    expect(pfade).not.toContain(`/${gruppe}`);
  });

  test("nie: Entwurf ohne veröffentlichte Version, öffentliche Seite, Seite einer anderen Abteilung", async () => {
    const entwurf = slug();
    const oeffentlich = slug();
    await seite(entwurf, "angemeldet", { veroeffentlicht: false });
    await seite(oeffentlich, "oeffentlich");
    for (const k of [elternA, leitendeA, admin]) {
      const pfade = (await lies(k)).map((x) => x.pfad);
      expect(pfade).not.toContain(`/${entwurf}`);
      expect(pfade).not.toContain(`/${oeffentlich}`);
    }
    // Die Abteilung der Demo sieht nichts aus der Test-Abteilung
    const demo = (await lies(demoEltern)).map((x) => x.pfad);
    expect(demo).not.toContain(`/${entwurf}`);
    expect(demo.some((p) => p.startsWith("/n-"))).toBe(false);
  });

  test("Position: unter einer öffentlichen Elternseite, vor der nächsten öffentlichen Geschwisterseite", async () => {
    const eltern = slug();
    const erste = slug();
    const geschuetzt = slug();
    const letzte = slug();
    const elternId = await seite(eltern, "oeffentlich");
    await seite(erste, "oeffentlich", { elternId, reihenfolge: 1 });
    await seite(geschuetzt, "angemeldet", { elternId, reihenfolge: 2 });
    await seite(letzte, "oeffentlich", { elternId, reihenfolge: 3 });
    const z = (await lies(elternA)).find(
      (x) => x.pfad === `/${eltern}/${geschuetzt}`,
    );
    expect(z).toMatchObject({
      eltern: `/${eltern}`,
      davor: `/${eltern}/${letzte}`,
    });
  });

  test("eine Seite unter einer Seite, die die Person nicht sieht, hängt an der nächsten sichtbaren Elternseite", async () => {
    const gruppe = slug();
    const unten = slug();
    const gruppeId = await seite(gruppe, "tags");
    await seite(unten, "angemeldet", { elternId: gruppeId });
    const e = await lies(elternA);
    expect(e.find((x) => x.pfad === `/${gruppe}/${unten}`)).toMatchObject({
      eltern: null,
    });
    const l = await lies(leitendeA);
    expect(l.find((x) => x.pfad === `/${gruppe}/${unten}`)).toMatchObject({
      eltern: `/${gruppe}`,
    });
  });
});
