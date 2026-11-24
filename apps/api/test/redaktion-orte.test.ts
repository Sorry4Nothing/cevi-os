import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import {
  OrtssucheBegrenzt,
  type OrtssucheHolen,
} from "../src/ortssuche/index.js";
import { ladeSeiten } from "../src/seiten.js";
import { erzeugeWebsite } from "../src/website/abgleich.js";
import { dateisystemAusgabe } from "../src/website/ausgabe.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../src/website/ereignisse.js";
import {
  heuteZuerich,
  ladeStufenfakten,
  vergissStufenfakten,
} from "../src/website/stufenfakten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { antwortVerletzungen } from "./hilfen/vertrag.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Orte-Bibliothek (#646): Rechte, Prüfung des Standorts, Auswahl mit Schnappschuss, Löschen und die Website
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt der Ortssuche des Bundes: Kein Test geht ins Netz
const sucheAttrappe = vi.fn<OrtssucheHolen>(async () => []);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  ortssuche: sucheAttrappe,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let ausgabeLog: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabeLog = vi.spyOn(console, "log").mockImplementation(() => {});
  vergissStufenfakten();
});
afterEach(() => ausgabeLog.mockRestore());

let welt: Welt;
let admin: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let eltern: PersonaKonto;
let demoAdmin: PersonaKonto;
let ohneLogin: PersonaKonto;

const tagIn = (n: number) => {
  const d = new Date(`${heuteZuerich()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ORTE = "/api/v1/redaktion/orte";
const eckdaten = (stufeId: string, tag?: string) =>
  `/api/v1/redaktion/stufen/${stufeId}/eckdaten${tag ? `/${tag}` : ""}`;

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
// Eindeutige Namen: Die Tests teilen sich die Abteilung
const neuerName = (n = "Ort") => `${n} ${randomUUID().slice(0, 8)}`;
async function legeAn(
  konto: PersonaKonto,
  felder: Record<string, unknown> = {},
) {
  const r = await anfrage(konto, "POST", ORTE, {
    name: neuerName(),
    ...felder,
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
async function liste(konto: PersonaKonto = admin) {
  const r = await anfrage(konto, "GET", ORTE);
  expect(r.status).toBe(200);
  return (
    (await r.json()) as {
      orte: {
        id: string;
        name: string;
        beschreibung: string | null;
        standort: string;
        standortArt: string | null;
        kartenLink: string | null;
        reihenfolge: number;
        aktiv: boolean;
        verwendet: number;
        verwendung: { stufe: string; tag: string }[];
        zuletztVerwendetAm: string | null;
      }[];
    }
  ).orte;
}
const eintrag = async (id: string, konto: PersonaKonto = admin) =>
  (await liste(konto)).find((o) => o.id === id);

async function neueStufe(name: string, oeffentlich = false) {
  const [s] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: `${name} ${randomUUID().slice(0, 6)}`,
      kuerzel: "N",
    })
    .returning();
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: `s-${randomUUID().slice(0, 12)}`,
      titel: name,
      tagId: s!.id,
      sichtbarkeit: oeffentlich ? "oeffentlich" : "angemeldet",
    })
    .returning();
  if (oeffentlich) {
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({
        seiteId: z!.id,
        nr: 1,
        inhalt: {
          v: 1,
          titel: name,
          bausteine: [
            {
              id: randomUUID(),
              typ: "stufenfakten",
              daten: {},
              sichtbarkeit: "erbt",
            },
          ],
        },
      })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, z!.id));
  }
  return { stufeId: s!.id, seiteId: z!.id, adresse: z!.adresse };
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, slA, slB, eltern, demoAdmin, ohneLogin] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "slB"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "ohneLogin"),
  ]);
});

describe("Rechte", () => {
  test("Abteilungsleitung und Stufenleitung verwalten Orte; Eltern nicht (403), ohne Sitzung 401", async () => {
    const id = await legeAn(slA, { standort: "47.2, 8.7" });
    expect((await eintrag(id, admin))?.standortArt).toBe("koordinaten");
    expect(
      (await anfrage(slB, "PATCH", `${ORTE}/${id}`, { aktiv: false })).status,
    ).toBe(204);
    expect((await anfrage(admin, "DELETE", `${ORTE}/${id}`)).status).toBe(204);
    for (const [methode, pfad, body] of [
      ["GET", ORTE, undefined],
      ["POST", ORTE, { name: "X" }],
      ["POST", `${ORTE}/vorschau`, { standort: "" }],
      ["PUT", `${ORTE}/reihenfolge`, { ids: [randomUUID()] }],
    ] as const) {
      expect(
        (await anfrage(eltern, methode, pfad, body)).status,
        `${methode} ${pfad}`,
      ).toBe(403);
      expect(
        (await anfrage(ohneLogin, methode, pfad, body)).status,
        `${methode} ${pfad}`,
      ).toBe(401);
    }
  });

  test("Orte einer anderen Abteilung gibt es nicht: 404 vor dem Recht, die Liste zeigt nur die eigenen", async () => {
    const fremd = await legeAn(demoAdmin);
    for (const konto of [admin, eltern]) {
      expect(
        (await anfrage(konto, "PATCH", `${ORTE}/${fremd}`, { aktiv: false }))
          .status,
      ).toBe(404);
      expect((await anfrage(konto, "DELETE", `${ORTE}/${fremd}`)).status).toBe(
        404,
      );
    }
    expect((await liste(admin)).some((o) => o.id === fremd)).toBe(false);
    expect((await liste(demoAdmin)).some((o) => o.id === fremd)).toBe(true);
    expect(
      (
        await anfrage(admin, "PATCH", `${ORTE}/${randomUUID()}`, {
          aktiv: true,
        })
      ).status,
    ).toBe(404);
  });
});

describe("Vertrag", () => {
  test("die Antworten entsprechen openapi.yaml", async () => {
    const s = await neueStufe("Vertrag");
    const id = await legeAn(admin, {
      beschreibung: "Eingang",
      standort: "47.2, 8.7",
    });
    await anfrage(admin, "PUT", eckdaten(s.stufeId, tagIn(14)), {
      treffpunktOrtId: id,
    });
    const l = await anfrage(admin, "GET", ORTE);
    expect(
      antwortVerletzungen("/api/v1/redaktion/orte", "get", 200, await l.json()),
    ).toEqual([]);
    const v = await anfrage(admin, "POST", `${ORTE}/vorschau`, {
      standort: "Seestrasse 1",
    });
    expect(
      antwortVerletzungen(
        "/api/v1/redaktion/orte/vorschau",
        "post",
        200,
        await v.json(),
      ),
    ).toEqual([]);
    const e = await anfrage(admin, "GET", eckdaten(s.stufeId, tagIn(14)));
    expect(
      antwortVerletzungen(
        "/api/v1/redaktion/stufen/{stufeId}/eckdaten/{tag}",
        "get",
        200,
        await e.json(),
      ),
    ).toEqual([]);
    const a = await anfrage(admin, "POST", ORTE, { name: neuerName() });
    expect(
      antwortVerletzungen(
        "/api/v1/redaktion/orte",
        "post",
        201,
        await a.json(),
      ),
    ).toEqual([]);
  });
});

describe("Anlegen und Prüfen", () => {
  test("ein langer Link wird zu Koordinaten, der Link zur Karte stammt vom Server", async () => {
    const roh =
      "https://www.google.com/maps/place/Pfadiheim/@47.2400,8.7300,17z/data=!3d47.2391!4d8.7258?entry=ttu";
    const id = await legeAn(slA, {
      name: neuerName("Pfadiheim"),
      beschreibung: "  Beim Hintereingang ",
      standort: roh,
    });
    const o = await eintrag(id);
    expect(o).toMatchObject({
      beschreibung: "Beim Hintereingang",
      standort: "47.2391, 8.7258",
      standortArt: "koordinaten",
      kartenLink:
        "https://www.google.com/maps/search/?api=1&query=47.2391,8.7258",
      aktiv: true,
      verwendet: 0,
    });
    // Der eingefügte Link steht nirgends in der Datenbank
    const [z] = await db.select().from(schema.ort).where(eq(schema.ort.id, id));
    expect(JSON.stringify(z)).not.toContain("entry=ttu");
    expect(z).toMatchObject({ karteUrl: null, karteAdresse: null });
  });

  test("Adresse und Kurzlink werden gespeichert, ein Kurzlink bleibt als geprüfter Link", async () => {
    const a = await legeAn(admin, { standort: "Seestrasse 1, 8712 Stäfa" });
    expect(await eintrag(a)).toMatchObject({
      standortArt: "adresse",
      standort: "Seestrasse 1, 8712 Stäfa",
      kartenLink:
        "https://www.google.com/maps/search/?api=1&query=Seestrasse%201%2C%208712%20St%C3%A4fa",
    });
    const k = await legeAn(admin, {
      standort: "https://maps.app.goo.gl/AbC123xyz",
    });
    expect(await eintrag(k)).toMatchObject({
      standortArt: "link",
      kartenLink: "https://maps.app.goo.gl/AbC123xyz",
    });
    // Ein Standort ersetzt den alten; leer entfernt ihn
    await anfrage(admin, "PATCH", `${ORTE}/${k}`, { standort: "47.1, 8.2" });
    expect((await eintrag(k))?.standortArt).toBe("koordinaten");
    await anfrage(admin, "PATCH", `${ORTE}/${k}`, { standort: " " });
    expect(await eintrag(k)).toMatchObject({
      standortArt: null,
      kartenLink: null,
      standort: "",
    });
  });

  test.each([
    "https://evil.example/maps/@47,8,1z",
    "https://www.google.com.evil.example/maps/",
    "http://www.google.com/maps/@47,8,1z",
    "javascript:alert(1)",
    "https://user:pw@www.google.com/maps/@47,8,1z",
    "https://www.google.com/url?q=https://evil.example",
    "99, 8",
  ])("Angriffsfall %s: 400 mit Code, nichts gespeichert", async (roh) => {
    const name = neuerName("Angriff");
    const r = await anfrage(admin, "POST", ORTE, { name, standort: roh });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { code: string }).code).toBe(
      "ORT_STANDORT_UNGUELTIG",
    );
    expect((await liste()).some((o) => o.name === name)).toBe(false);
    const id = await legeAn(admin);
    expect(
      (await anfrage(admin, "PATCH", `${ORTE}/${id}`, { standort: roh }))
        .status,
    ).toBe(400);
    const v = await anfrage(admin, "POST", `${ORTE}/vorschau`, {
      standort: roh,
    });
    expect(v.status).toBe(400);
  });

  test("die Vorschau liest, ohne zu speichern", async () => {
    const r = await anfrage(admin, "POST", `${ORTE}/vorschau`, {
      standort: "https://www.google.com/maps/@47.5,8.5,15z",
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      standort: "47.5, 8.5",
      standortArt: "koordinaten",
      kartenLink: "https://www.google.com/maps/search/?api=1&query=47.5,8.5",
    });
    const leer = await anfrage(admin, "POST", `${ORTE}/vorschau`, {
      standort: "",
    });
    expect(await leer.json()).toEqual({
      standort: "",
      standortArt: null,
      kartenLink: null,
    });
  });

  test("Name: Pflicht, höchstens 100 Zeichen, ohne Steuerzeichen, je Abteilung einmalig ohne Gross-/Kleinschreibung; unbekannte Felder 400", async () => {
    for (const body of [
      { name: "" },
      { name: "   " },
      { name: "a".repeat(101) },
      { name: "Ort\u0000" },
      { name: "Ort", beschreibung: "x".repeat(201) },
      { name: "Ort", unbekannt: 1 },
      { name: "Ort", standort: "a".repeat(601) },
    ]) {
      expect(
        (await anfrage(admin, "POST", ORTE, body)).status,
        JSON.stringify(body).slice(0, 40),
      ).toBe(400);
    }
    const name = neuerName("Doppelt");
    await legeAn(admin, { name });
    const zweiter = await anfrage(admin, "POST", ORTE, {
      name: name.toUpperCase(),
    });
    expect(zweiter.status).toBe(409);
    expect(((await zweiter.json()) as { code: string }).code).toBe(
      "ORT_NAME_VERGEBEN",
    );
    // Eine andere Abteilung darf denselben Namen führen
    expect((await anfrage(demoAdmin, "POST", ORTE, { name })).status).toBe(201);
    const anderer = await legeAn(admin);
    expect(
      (await anfrage(admin, "PATCH", `${ORTE}/${anderer}`, { name })).status,
    ).toBe(409);
  });

  test("Reihenfolge: neue Orte stehen hinten; PUT ordnet neu, fremde oder doppelte IDs sind abgelehnt", async () => {
    const a = await legeAn(admin);
    const b = await legeAn(admin);
    const c = await legeAn(admin);
    const reihe = (await liste()).map((o) => o.id);
    expect(reihe.indexOf(a)).toBeLessThan(reihe.indexOf(b));
    expect(reihe.indexOf(b)).toBeLessThan(reihe.indexOf(c));
    expect(
      (await anfrage(admin, "PUT", `${ORTE}/reihenfolge`, { ids: [c, b, a] }))
        .status,
    ).toBe(204);
    const neu = (await liste()).map((o) => o.id);
    expect(neu.indexOf(c)).toBeLessThan(neu.indexOf(b));
    expect(neu.indexOf(b)).toBeLessThan(neu.indexOf(a));
    expect(
      (await anfrage(admin, "PUT", `${ORTE}/reihenfolge`, { ids: [a, a] }))
        .status,
    ).toBe(400);
    expect(
      (
        await anfrage(admin, "PUT", `${ORTE}/reihenfolge`, {
          ids: [a, randomUUID()],
        })
      ).status,
    ).toBe(404);
  });
});

describe("Auswahl in den Samstagsangaben", () => {
  test("ein Ort ersetzt den Text durch seinen Namen (Schnappschuss), Freitext bleibt gültig, ein fremder Ort ist 400", async () => {
    const name = neuerName("Heim");
    const heim = await legeAn(admin, { name });
    const bahnhof = await legeAn(admin, { name: neuerName("Bahnhof") });
    const tag = tagIn(5);
    const r = await anfrage(slA, "PUT", eckdaten(welt.stufeAId, tag), {
      treffZeit: "14:00",
      treffpunkt: "Wird ersetzt",
      treffpunktOrtId: heim,
      schlussOrtId: bahnhof,
    });
    expect(r.status).toBe(204);
    const gelesen = await (
      await anfrage(slA, "GET", eckdaten(welt.stufeAId, tag))
    ).json();
    expect(gelesen).toMatchObject({
      treffpunkt: name,
      treffpunktOrtId: heim,
      schlussOrtId: bahnhof,
    });
    expect((await eintrag(heim))?.zuletztVerwendetAm).not.toBeNull();
    // Freitext: ohne Kennung bleibt der Text, die Kennung entfällt
    await anfrage(slA, "PUT", eckdaten(welt.stufeAId, tag), {
      treffpunkt: "Am Waldrand",
    });
    expect(
      await (await anfrage(slA, "GET", eckdaten(welt.stufeAId, tag))).json(),
    ).toMatchObject({
      treffpunkt: "Am Waldrand",
      treffpunktOrtId: null,
      schlussOrt: null,
    });
    // Ein Ort der anderen Abteilung oder ein unbekannter: 400, nichts geändert
    const fremd = await legeAn(demoAdmin);
    for (const id of [fremd, randomUUID()]) {
      const f = await anfrage(slA, "PUT", eckdaten(welt.stufeAId, tag), {
        treffpunktOrtId: id,
      });
      expect(f.status).toBe(400);
      expect(((await f.json()) as { code: string }).code).toBe("ORT_UNBEKANNT");
    }
    expect(
      (
        await anfrage(slA, "PUT", eckdaten(welt.stufeAId, tag), {
          treffpunktOrtId: "kein-uuid",
        })
      ).status,
    ).toBe(400);
    await anfrage(slA, "DELETE", eckdaten(welt.stufeAId, tag));
  });

  test("die Liste nennt, wo ein Ort gebraucht wird; Umbenennen führt die Texte nach", async () => {
    const s = await neueStufe("Nutzung");
    const id = await legeAn(admin, { name: neuerName("Alt") });
    await anfrage(admin, "PUT", eckdaten(s.stufeId, tagIn(8)), {
      treffpunktOrtId: id,
      schlussOrtId: id,
    });
    await anfrage(admin, "PUT", eckdaten(s.stufeId, tagIn(9)), {
      schlussOrtId: id,
    });
    // Ein Samstag zählt einmal, auch wenn beide Felder den Ort tragen
    expect(await eintrag(id)).toMatchObject({
      verwendet: 2,
      verwendung: [{ tag: tagIn(8) }, { tag: tagIn(9) }],
    });
    const neu = neuerName("Neu");
    expect(
      (await anfrage(admin, "PATCH", `${ORTE}/${id}`, { name: neu })).status,
    ).toBe(204);
    expect(
      await (await anfrage(admin, "GET", eckdaten(s.stufeId, tagIn(8)))).json(),
    ).toMatchObject({ treffpunkt: neu, schlussOrt: neu });
  });

  test("Löschen löst den Bezug auf, der Name bleibt in der Angabe", async () => {
    const s = await neueStufe("Loeschen");
    const name = neuerName("Weg");
    const id = await legeAn(admin, { name, standort: "47.1, 8.2" });
    const tag = tagIn(10);
    await anfrage(admin, "PUT", eckdaten(s.stufeId, tag), {
      treffpunktOrtId: id,
    });
    expect((await anfrage(slA, "DELETE", `${ORTE}/${id}`)).status).toBe(204);
    expect(await eintrag(id)).toBeUndefined();
    expect(
      await (await anfrage(admin, "GET", eckdaten(s.stufeId, tag))).json(),
    ).toMatchObject({ treffpunkt: name, treffpunktOrtId: null });
  });

  test("Ändern und Löschen melden die betroffenen Stufenseiten, «aktiv» keine", async () => {
    const s = await neueStufe("Ereignis");
    const id = await legeAn(admin, { standort: "47.1, 8.2" });
    await anfrage(admin, "PUT", eckdaten(s.stufeId, tagIn(11)), {
      treffpunktOrtId: id,
    });
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    await anfrage(admin, "PATCH", `${ORTE}/${id}`, { aktiv: false });
    expect(ereignisse).toEqual([]);
    await anfrage(admin, "PATCH", `${ORTE}/${id}`, { standort: "47.3, 8.4" });
    await anfrage(admin, "DELETE", `${ORTE}/${id}`);
    ab();
    expect(ereignisse).toEqual([
      {
        art: "seite_geaendert",
        abteilungId: welt.testabteilungId,
        seiteId: s.seiteId,
      },
      {
        art: "seite_geaendert",
        abteilungId: welt.testabteilungId,
        seiteId: s.seiteId,
      },
    ]);
  });

  test("das Audit-Log hält Namen von Feldern, nie Werte", async () => {
    const id = await legeAn(admin, { standort: "Geheimweg 7" });
    await anfrage(admin, "PATCH", `${ORTE}/${id}`, {
      beschreibung: "Geheimtext",
    });
    await anfrage(admin, "DELETE", `${ORTE}/${id}`);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([
      "ort_angelegt",
      "ort_geaendert",
      "ort_geloescht",
    ]);
    expect(JSON.stringify(zeilen)).not.toMatch(/Geheimweg|Geheimtext/);
  });
});

describe("Website", () => {
  let wurzel: string;
  beforeEach(async () => {
    wurzel = await mkdtemp(join(tmpdir(), "cevi-orte-"));
  });
  afterEach(() => rm(wurzel, { recursive: true, force: true }));

  const merker = new Map<string, string>();
  const lauf = () =>
    erzeugeWebsite(db, {
      merker,
      ausgabe: dateisystemAusgabe(wurzel),
      abteilungId: welt.testabteilungId,
      basisUrl: "https://www.example.org",
      stylesheet: "body{}",
      datenquellen: [ladeStufenfakten],
    });

  test("Name, Adresszeile und Verweis «Auf Google Maps ansehen» ohne Skript; ohne Ort oder nach dem Löschen nur der Text", async () => {
    const s = await neueStufe("Seite", true);
    const heim = await legeAn(admin, {
      name: "Pfadiheim",
      beschreibung: "Beim <b>Hintereingang</b>",
      standort: "47.2391, 8.7258",
    });
    const ohneKarte = await legeAn(admin, { name: "Waldplatz" });
    const tag = tagIn(12);
    await anfrage(admin, "PUT", eckdaten(s.stufeId, tag), {
      treffpunktOrtId: heim,
      schlussOrtId: ohneKarte,
    });
    expect((await lauf()).fehler).toBe(0);
    const datei = `${s.adresse}/index.html`;
    let html = await readFile(join(wurzel, datei), "utf8");
    expect(html).toContain("<dt>Treffpunkt</dt><dd>Pfadiheim");
    expect(html).toContain(
      '<span class="fakt-zusatz">Beim &lt;b&gt;Hintereingang&lt;/b&gt;</span>',
    );
    expect(html).toContain(
      '<p class="fakt-karte"><a href="https://www.google.com/maps/search/?api=1&amp;query=47.2391,8.7258" rel="noopener noreferrer"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5 6 13.5a7.5 7.5 0 1 1 12 0z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>Auf Google Maps ansehen<span class="nur-sr"> (externe Seite)</span></a></p>',
    );
    // Genau ein Verweis (der Schlussort hat keinen Standort), keine Einbettung, kein fremdes Skript
    expect(html.match(/Auf Google Maps ansehen/g)).toHaveLength(1);
    expect(html).toContain("<dt>Schlussort</dt><dd>Waldplatz</dd>");
    expect(html).not.toMatch(/<iframe|maps\.googleapis|<script[^>]+google/i);
    // Ändert sich der Standort, wird die Seite neu erzeugt
    await anfrage(admin, "PATCH", `${ORTE}/${heim}`, { standort: "47.5, 8.5" });
    expect((await lauf()).geschrieben).toBeGreaterThan(0);
    html = await readFile(join(wurzel, datei), "utf8");
    expect(html).toContain("query=47.5,8.5");
    // Gelöscht: der Name bleibt, der Verweis verschwindet
    await anfrage(admin, "DELETE", `${ORTE}/${heim}`);
    await lauf();
    html = await readFile(join(wurzel, datei), "utf8");
    expect(html).toContain("<dt>Treffpunkt</dt><dd>Pfadiheim</dd>");
    expect(html).not.toContain("Auf Google Maps ansehen");
  });
});

describe("Adresssuche (#695)", () => {
  const SUCHE = `${ORTE}/suche`;
  const vorschlag = {
    bezeichnung: "Beispielweg 4, 8000 Beispielstadt",
    strasse: "Beispielweg 4",
    plz: "8000",
    ort: "Beispielstadt",
    breite: 47.2,
    laenge: 8.7,
  };
  const suche = (konto: PersonaKonto, q: string) =>
    anfrage(konto, "GET", `${SUCHE}?q=${encodeURIComponent(q)}`);
  beforeEach(() => {
    sucheAttrappe.mockReset();
    sucheAttrappe.mockResolvedValue([]);
  });

  test("Treffer: nur der Suchtext geht zum Dienst, die Antwort wird nicht zwischengespeichert", async () => {
    sucheAttrappe.mockResolvedValue([vorschlag]);
    const r = await suche(slA, "  Beispielweg 4  ");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ vorschlaege: [vorschlag] });
    expect(sucheAttrappe).toHaveBeenCalledTimes(1);
    // Genau ein Argument, der Text: weder Konto noch Abteilung noch Kennung
    expect(sucheAttrappe.mock.calls[0]).toEqual(["Beispielweg 4"]);
  });

  test("keine Treffer: 200 mit leerer Liste", async () => {
    const r = await suche(admin, "Nirgendwoweg 99");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ vorschlaege: [] });
  });

  test("Dienst nicht erreichbar, Zeitlimit oder falsche Antwort: 503 mit Hinweis, der Suchtext steht in keinem Protokoll", async () => {
    for (const fehler of [
      new Error("fetch failed"),
      new DOMException("Zeitlimit", "TimeoutError"),
      new SyntaxError("Unexpected token"),
    ]) {
      sucheAttrappe.mockRejectedValueOnce(fehler);
      const r = await suche(admin, "Geheimweg 7 Beispielstadt");
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({
        code: "ORTSSUCHE_NICHT_ERREICHBAR",
      });
    }
    expect(JSON.stringify(ausgabeLog.mock.calls)).not.toContain("Geheimweg");
  });

  test("Begrenzung des Dienstes: 429", async () => {
    sucheAttrappe.mockRejectedValueOnce(new OrtssucheBegrenzt());
    expect((await suche(admin, "Beispielweg")).status).toBe(429);
  });

  test("zu kurz, zu lang, zu viele Wörter, Steuerzeichen, fremde Parameter: 400, ohne Abruf", async () => {
    for (const q of ["", "  ab ", "x".repeat(101), "a b c d e f g h i j k"]) {
      expect((await suche(admin, q)).status, q).toBe(400);
    }
    expect((await suche(admin, "Beispiel\u0000weg")).status).toBe(400);
    expect(
      (await anfrage(admin, "GET", `${SUCHE}?q=Beispielweg&limit=100`)).status,
    ).toBe(400);
    expect((await anfrage(admin, "GET", SUCHE)).status).toBe(400);
    expect(sucheAttrappe).not.toHaveBeenCalled();
  });

  test("Rechte wie bei den Orten: Eltern 403, ohne Sitzung 401", async () => {
    expect((await suche(eltern, "Beispielweg")).status).toBe(403);
    expect((await suche(ohneLogin, "Beispielweg")).status).toBe(401);
    expect(sucheAttrappe).not.toHaveBeenCalled();
  });

  test("je Konto höchstens 20 Suchen je Minute, danach 429", async () => {
    const stati: number[] = [];
    for (let i = 0; i < 21; i++) {
      stati.push((await suche(slB, "Beispielweg")).status);
    }
    expect(stati.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(stati[20]).toBe(429);
    // Ein anderes Konto ist nicht betroffen
    expect((await suche(slA, "Beispielweg")).status).toBe(200);
  });

  test("ohne eingerichteten Dienst: 503 statt eines Fehlers", async () => {
    const ohne = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
    });
    const r = await ohne.request(`${SUCHE}?q=Beispielweg`, {
      headers: admin.headers,
    });
    expect(r.status).toBe(503);
  });

  test("ein gewählter Vorschlag wird als Koordinaten gespeichert und führt zur Karte", async () => {
    const id = await legeAn(admin, {
      beschreibung: vorschlag.bezeichnung,
      standort: `${vorschlag.breite}, ${vorschlag.laenge}`,
    });
    const o = await eintrag(id);
    expect(o?.standortArt).toBe("koordinaten");
    expect(o?.beschreibung).toBe(vorschlag.bezeichnung);
    expect(o?.kartenLink).toBe(
      "https://www.google.com/maps/search/?api=1&query=47.2,8.7",
    );
  });
});
