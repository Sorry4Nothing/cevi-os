import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
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
import { kodiereMedienbild } from "../src/bild-sharp.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
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

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt S3
const objekte = new Map<string, Uint8Array>();
const medienspeicher: Medienspeicher = {
  ablegen: async (inhalt) => {
    const schluessel = randomUUID();
    objekte.set(schluessel, inhalt);
    return schluessel;
  },
  holen: async (schluessel) => objekte.get(schluessel) ?? new Uint8Array(),
  loeschen: async (schluessel) => {
    objekte.delete(schluessel);
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  kodiereMedienbild,
  medienspeicher,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const ICH = "/api/v1/redaktion/ich";
const MEDIEN = "/api/v1/redaktion/medien";
const HOCH = `${MEDIEN}?sichtbarkeit=angemeldet`;

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let webmaster: PersonaKonto;
let ohneRecht: PersonaKonto;
let eltern: PersonaKonto;
let demoEltern: PersonaKonto;
let bild: Buffer;
const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const holen = (konto: PersonaKonto, pfad: string) =>
  app.request(pfad, { headers: konto.headers });
const senden = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) =>
  app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
const hochladen = (
  konto: PersonaKonto,
  daten: Buffer = bild,
  query = "&altText=Blaues%20Feld",
) =>
  app.request(HOCH + query, {
    method: "POST",
    headers: konto.headers,
    body: new Uint8Array(daten),
  });
// Lädt hoch und prüft den Status 201
async function lege(konto: PersonaKonto, daten?: Buffer, query?: string) {
  const antwort = await hochladen(konto, daten, query);
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { id: string }).id;
}
const code = async (antwort: Response) =>
  ((await antwort.json()) as { code: string }).code;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  bild = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
  [
    admin,
    adminOhne,
    demoAdmin,
    demoEltern,
    slA,
    slB,
    webmaster,
    ohneRecht,
    eltern,
  ] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "adminOhneZweitenFaktor"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "demoEltern"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "slB"),
    // Eine Leitende ohne Stufenleitung, der der Admin das Recht auf alle Seiten gibt
    legePersonaMitFaktorAn(welt, "leitendeA"),
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "elternA"),
  ]);
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
  // Telefon, E-Mail und Cevi-Name der Stufenleitung A: Die Auswahlliste darf nur den Namen zeigen
  await db
    .update(schema.user)
    .set({ ceviName: "Flink", telefon: "+41791234567" })
    .where(eq(schema.user.id, slA.id!));
});

describe("GET /api/v1/redaktion/ich", () => {
  test.each([
    ["Admin", () => admin, { redigieren: true, verwalten: true }],
    ["Webmaster", () => webmaster, { redigieren: true, verwalten: true }],
    ["Stufenleitung", () => slA, { redigieren: true, verwalten: false }],
    [
      "Leitende ohne Recht",
      () => ohneRecht,
      { redigieren: false, verwalten: false },
    ],
    ["Eltern", () => eltern, { redigieren: false, verwalten: false }],
  ])("%s", async (name, konto, erwartet) => {
    const antwort = await holen(konto(), ICH);
    expect(antwort.status).toBe(200);
    const koerper = (await antwort.json()) as {
      redigieren: boolean;
      bereiche: string[];
      verwalten: boolean;
    };
    expect(koerper).toMatchObject(erwartet);
    // Die Abteilungsleitung darf auch den Wartungsmodus der Website schalten (#424): «plattform»
    expect(koerper.bereiche).toEqual(
      !koerper.redigieren
        ? []
        : name === "Admin"
          ? ["website", "plattform"]
          : ["website"],
    );
    expect(koerper.verwalten).toBe(erwartet.verwalten);
  });

  test("Admin ohne zweiten Faktor bleibt gesperrt, ohne Sitzung 401", async () => {
    const gesperrt = await holen(adminOhne, ICH);
    expect(gesperrt.status).toBe(403);
    expect(await code(gesperrt)).toBe("ZWEITER_FAKTOR_FEHLT");
    expect((await app.request(ICH)).status).toBe(401);
  });
});

describe("Medien", () => {
  test("Stufenleitung und Webmaster laden hoch; ein Bild ohne Alt-Text ist 400", async () => {
    expect((await hochladen(slA)).status).toBe(201);
    expect((await hochladen(webmaster)).status).toBe(201);
    const ohneText = await hochladen(slA, bild, "");
    expect(ohneText.status).toBe(400);
    expect(await code(ohneText)).toBe("ALT_TEXT");
    const dekorativ = await hochladen(slA, bild, "&dekorativ=true");
    expect(dekorativ.status).toBe(201);
    expect(
      await hochladen(slA, bild, "&altText=Text&dekorativ=true"),
    ).toHaveProperty("status", 400);
  });

  test("ohne Zugang 403 (Eltern, Leitende ohne Recht, Admin ohne zweiten Faktor), kein Upload und keine Liste", async () => {
    for (const konto of [eltern, ohneRecht, adminOhne]) {
      expect((await hochladen(konto)).status).toBe(403);
      expect((await holen(konto, MEDIEN)).status).toBe(403);
    }
    expect((await app.request(MEDIEN)).status).toBe(401);
  });

  test("die Liste zeigt nur die eigene Abteilung", async () => {
    const id = await lege(slA);
    const eigene = (await (await holen(slB, MEDIEN)).json()) as {
      medien: { id: string }[];
    };
    expect(eigene.medien.map((m) => m.id)).toContain(id);
    const fremde = (await (await holen(demoAdmin, MEDIEN)).json()) as {
      medien: { id: string }[];
    };
    expect(fremde.medien.map((m) => m.id)).not.toContain(id);
  });

  test("Alt-Text nachtragen: die Person, die hochgeladen hat, die Webmaster und der Admin; im Audit-Log ohne Text", async () => {
    const id = await lege(slA);
    const eigenes = await senden(slA, "PATCH", `${MEDIEN}/${id}`, {
      altText: "Neuer Text",
    });
    expect(eigenes.status).toBe(200);
    expect(await eigenes.json()).toMatchObject({
      id,
      altText: "Neuer Text",
      dekorativ: false,
    });
    const reaktion = await senden(webmaster, "PATCH", `${MEDIEN}/${id}`, {
      dekorativ: true,
    });
    expect(await reaktion.json()).toMatchObject({
      altText: null,
      dekorativ: true,
    });
    expect(
      (await senden(admin, "PATCH", `${MEDIEN}/${id}`, { altText: "Admin" }))
        .status,
    ).toBe(200);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id),
          eq(schema.auditLog.aktion, "medium_beschrieben"),
        ),
      );
    expect(zeilen).toHaveLength(3);
    expect(JSON.stringify(zeilen)).not.toContain("Neuer Text");
  });

  test("fremde Uploads beschreibt eine Stufenleitung nicht (403), Eltern ebenso", async () => {
    const id = await lege(admin);
    for (const konto of [slA, slB, ohneRecht, eltern]) {
      const antwort = await senden(konto, "PATCH", `${MEDIEN}/${id}`, {
        altText: "Fremd",
      });
      expect(antwort.status).toBe(403);
    }
    const [m] = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, id));
    expect(m.altText).toBe("Blaues Feld");
  });

  test("ein anderer Hochlader ohne Zugang verliert das Recht an seinem Upload", async () => {
    // Eine eigene Stufenleitung, damit die übrigen Tests ihre Rolle behalten
    const sl = await legePersonaAn(welt, "slA");
    const id = await lege(sl);
    // Die Rolle fällt weg: Zugang weg, der Upload bleibt, das Recht daran nicht
    await db
      .delete(schema.personTag)
      .where(eq(schema.personTag.userId, sl.id!));
    expect((await holen(sl, MEDIEN)).status).toBe(403);
    expect(
      (await senden(sl, "PATCH", `${MEDIEN}/${id}`, { altText: "Nochmals" }))
        .status,
    ).toBe(403);
  });

  test("Eingabe: genau eines von altText und dekorativ, PDF-Upload 415, fremde Abteilung 404", async () => {
    const id = await lege(slB);
    for (const body of [
      {},
      { altText: "A", dekorativ: true },
      { altText: "" },
      { dekorativ: false },
      { sichtbarkeit: "oeffentlich" },
    ]) {
      expect((await senden(slB, "PATCH", `${MEDIEN}/${id}`, body)).status).toBe(
        400,
      );
    }
    // Seit #428 nimmt der Medienspeicher keine PDF mehr an (Dateien sind Verknüpfungen auf SharePoint)
    const pdfAntwort = await hochladen(slB, pdf, "");
    expect(pdfAntwort.status).toBe(415);
    for (const konto of [demoAdmin, demoEltern]) {
      expect(
        (await senden(konto, "PATCH", `${MEDIEN}/${id}`, { altText: "X" }))
          .status,
      ).toBe(404);
    }
    expect(
      (
        await senden(slB, "PATCH", `${MEDIEN}/${randomUUID()}`, {
          altText: "X",
        })
      ).status,
    ).toBe(404);
  });

  test("Löschen nur Abteilungsleitung und Webmaster; eine Stufenleitung nicht einmal ihr eigenes Medium", async () => {
    const id = await lege(slA);
    expect((await senden(slA, "DELETE", `${MEDIEN}/${id}`)).status).toBe(403);
    expect((await senden(eltern, "DELETE", `${MEDIEN}/${id}`)).status).toBe(
      403,
    );
    expect((await senden(demoAdmin, "DELETE", `${MEDIEN}/${id}`)).status).toBe(
      404,
    );
    expect((await senden(webmaster, "DELETE", `${MEDIEN}/${id}`)).status).toBe(
      204,
    );
    const rest = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, id));
    expect(rest).toHaveLength(0);
    expect((await senden(admin, "DELETE", `${MEDIEN}/${id}`)).status).toBe(404);
  });
});

describe("Auswahllisten", () => {
  type TagListe = { tags: Record<string, unknown>[] };
  type PersonenListe = { personen: Record<string, unknown>[] };

  test("Tags der Abteilung: nur Id, Name und Typ", async () => {
    for (const konto of [admin, slA, webmaster]) {
      const antwort = await holen(konto, "/api/v1/redaktion/tags");
      expect(antwort.status).toBe(200);
      const { tags } = (await antwort.json()) as TagListe;
      expect(tags.map((t) => t.id)).toEqual(
        expect.arrayContaining([welt.stufeAId, welt.stufeBId]),
      );
      expect(tags.map((t) => t.id)).not.toContain(welt.demoStufeId);
      for (const t of tags) {
        expect(Object.keys(t).sort()).toEqual(["id", "name", "typ"]);
      }
    }
  });

  test("Personen mit Tag: Id, Anzeigename und Funktion, nie Telefon oder E-Mail", async () => {
    const antwort = await holen(
      webmaster,
      `/api/v1/redaktion/personen?tag=${welt.stufeAId}`,
    );
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    const { personen } = JSON.parse(text) as PersonenListe;
    const meine = personen.find((p) => p.id === slA.id);
    expect(meine).toEqual({
      id: slA.id,
      anzeigename: "Flink",
      funktion: "stufenleitung",
      // Stufenleitung: eine Rolle mit Aussenwirkung (#610)
      aufWebsite: true,
    });
    // Wer den Tag nicht trägt, steht nicht in der Liste
    expect(personen.map((p) => p.id)).not.toContain(slB.id);
    for (const p of personen) {
      expect(Object.keys(p).sort()).toEqual([
        "anzeigename",
        "aufWebsite",
        "funktion",
        "id",
      ]);
    }
    expect(text).not.toContain("+41791234567");
    expect(text).not.toContain("@example.org");
  });

  test("ein deaktiviertes Konto steht nicht in der Liste", async () => {
    const weg = await legePersonaAn(welt, "slA");
    const pfad = `/api/v1/redaktion/personen?tag=${welt.stufeAId}`;
    const vorher = (await (await holen(admin, pfad)).json()) as PersonenListe;
    expect(vorher.personen.map((p) => p.id)).toContain(weg.id);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, weg.id!));
    const nachher = (await (await holen(admin, pfad)).json()) as PersonenListe;
    expect(nachher.personen.map((p) => p.id)).not.toContain(weg.id);
  });

  test("Zugang, Eingabe und Abteilung", async () => {
    const pfad = `/api/v1/redaktion/personen?tag=${welt.stufeAId}`;
    for (const konto of [eltern, ohneRecht, adminOhne, demoEltern]) {
      expect((await holen(konto, pfad)).status).toBe(403);
      expect((await holen(konto, "/api/v1/redaktion/tags")).status).toBe(403);
    }
    expect((await holen(admin, "/api/v1/redaktion/personen")).status).toBe(400);
    expect(
      (await holen(admin, "/api/v1/redaktion/personen?tag=kein-uuid")).status,
    ).toBe(400);
    expect(
      (await holen(admin, `${pfad}&weiter=1`)).status,
      "unbekannter Parameter",
    ).toBe(400);
    // Ein Tag der Demo-Abteilung gibt es für die Testabteilung nicht
    expect(
      (await holen(admin, `/api/v1/redaktion/personen?tag=${welt.demoStufeId}`))
        .status,
    ).toBe(404);
    expect(
      (
        await holen(
          demoAdmin,
          `/api/v1/redaktion/personen?tag=${welt.stufeAId}`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("Panel", () => {
  test("die Seite des Panels erlaubt eigene Rahmen für die Vorschau, sonst bleibt die CSP streng", async () => {
    const antwort = await app.request("/admin");
    const csp = antwort.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe");
    expect(antwort.headers.get("x-frame-options")).toBe("DENY");
  });

  test("das Gerüst verlinkt die vier Module samt Stilen", async () => {
    const html = await (await app.request("/admin")).text();
    for (const name of ["", "-seiten", "-editor", "-medien", "-stufenfakten"]) {
      expect(html).toContain(`href="/admin/website${name}.css"`);
      expect((await app.request(`/admin/website${name}.css`)).status).toBe(200);
    }
    for (const modul of ["seiten", "editor", "medien", "stufenfakten"]) {
      expect((await app.request(`/admin/website-${modul}.js`)).status).toBe(
        200,
      );
    }
  });
});
