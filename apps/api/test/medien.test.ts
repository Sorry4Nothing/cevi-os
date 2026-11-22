import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import { MEDIEN_BILD_MAX_BYTES } from "../src/medien.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

let welt: Welt;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Der Speicher im Arbeitsspeicher; «fehler» lässt die jeweilige Operation scheitern, wie ein S3, das nicht antwortet
function attrappe() {
  const objekte = new Map<string, { inhalt: Uint8Array; typ: string }>();
  const fehler = { ablegen: false, holen: false, loeschen: false };
  const speicher: Medienspeicher = {
    async ablegen(inhalt, typ) {
      if (fehler.ablegen) throw new Error("geheimer-bucket nicht erreichbar");
      const schluessel = randomUUID();
      objekte.set(schluessel, { inhalt, typ });
      return schluessel;
    },
    async holen(schluessel) {
      if (fehler.holen) throw new Error("geheimer-bucket nicht erreichbar");
      const objekt = objekte.get(schluessel);
      if (!objekt) throw new Error("NoSuchKey");
      return objekt.inhalt;
    },
    async loeschen(schluessel) {
      if (fehler.loeschen) throw new Error("geheimer-bucket nicht erreichbar");
      objekte.delete(schluessel);
    },
  };
  return { speicher, objekte, fehler };
}

// Pro Test eine App: Das Limit für Uploads zählt je Instanz
function neueApp(speicher?: Medienspeicher) {
  return erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    kodiereMedienbild,
    medienspeicher: speicher,
    seiten: ladeSeiten(),
  });
}

// Nur synthetische Bilder: einfarbig, nie ein Foto einer echten Person
const jpeg = (breite = 600, hoehe = 400) =>
  sharp({
    create: {
      width: breite,
      height: hoehe,
      channels: 3,
      background: "#3366cc",
    },
  })
    .jpeg()
    .toBuffer();
const pdf = (extra = 0) =>
  Buffer.concat([Buffer.from("%PDF-1.7\n%%EOF\n"), Buffer.alloc(extra, 0x20)]);

type Anfrage = {
  app: ReturnType<typeof neueApp>;
  persona?: Persona;
  // Dieselbe Person für mehrere Uploads: legePersonaAn legt bei jedem Aufruf eine neue an
  headers?: Record<string, string>;
  body: Uint8Array;
  query?: string;
  typ?: string;
};
async function hochladen({
  app,
  persona = "admin",
  headers,
  body,
  query = "sichtbarkeit=angemeldet&altText=Blaues%20Feld",
  typ,
}: Anfrage) {
  return app.request(`/api/v1/admin/medien?${query}`, {
    method: "POST",
    headers: {
      ...(headers ?? (await legePersonaAn(welt, persona)).headers),
      ...(typ && { "content-type": typ }),
    },
    body: body as BodyInit,
  });
}
const zeilen = () =>
  db
    .select()
    .from(schema.medium)
    .where(eq(schema.medium.abteilungId, welt.testabteilungId));
const lesen = async (
  app: ReturnType<typeof neueApp>,
  id: string,
  persona?: Persona,
) =>
  app.request(`/api/v1/medien/${id}`, {
    headers: persona ? (await legePersonaAn(welt, persona)).headers : {},
  });

describe("Upload von Bildern", () => {
  test("das Bild wird zu WebP, gedreht, verkleinert und ohne EXIF gespeichert", async () => {
    const { speicher, objekte } = attrappe();
    // 3000 × 1000 mit Drehung um 90 Grad und Beschreibung in den Metadaten: danach 683 × 2048, höchstens 2048 px, ohne EXIF
    const quelle = await sharp({
      create: {
        width: 3000,
        height: 1000,
        channels: 3,
        background: "#aa3333",
      },
    })
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { ImageDescription: "geheimer-ort" } },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(quelle).metadata()).exif).toBeDefined();
    const res = await hochladen({
      app: neueApp(speicher),
      body: quelle,
      // Der Content-Type zählt nicht
      typ: "application/pdf",
    });
    expect(res.status).toBe(201);
    const medium = (await res.json()) as Record<string, unknown>;
    expect(medium).toMatchObject({
      mimeTyp: "image/webp",
      breite: 683,
      hoehe: 2048,
      altText: "Blaues Feld",
      dekorativ: false,
      sichtbarkeit: "angemeldet",
    });
    const [zeile] = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, medium.id as string));
    // Zufälliger Schlüssel ohne Dateinamen; im Speicher liegt das kodierte Bild
    expect(zeile.speicherSchluessel).toMatch(/^[0-9a-f-]{36}$/);
    const gespeichert = objekte.get(zeile.speicherSchluessel)!;
    expect(gespeichert.typ).toBe("image/webp");
    const meta = await sharp(gespeichert.inhalt).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 683, 2048]);
    expect(meta.exif).toBeUndefined();
    expect(zeile.groesse).toBe(gespeichert.inhalt.length);
    expect(zeile.hochgeladenVon).not.toBeNull();
  });

  test("ohne Alt-Text und ohne «dekorativ» 400, mit beidem 400, nichts wird gespeichert", async () => {
    const { speicher, objekte } = attrappe();
    const app = neueApp(speicher);
    for (const query of [
      "sichtbarkeit=angemeldet",
      "sichtbarkeit=angemeldet&altText=%20%20",
      "sichtbarkeit=angemeldet&altText=Text&dekorativ=true",
    ]) {
      const res = await hochladen({ app, body: await jpeg(), query });
      expect(res.status, query).toBe(400);
    }
    expect(objekte.size).toBe(0);
  });

  test("«dekorativ» erlaubt einen leeren Alt-Text", async () => {
    const { speicher } = attrappe();
    const res = await hochladen({
      app: neueApp(speicher),
      body: await jpeg(),
      query: "sichtbarkeit=oeffentlich&dekorativ=true",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      altText: null,
      dekorativ: true,
    });
  });

  test("ein Bild über 10 MB wird mit 413 abgelehnt, bevor es dekodiert wird", async () => {
    const { speicher, objekte } = attrappe();
    const gross = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(MEDIEN_BILD_MAX_BYTES, 0),
    ]);
    const res = await hochladen({ app: neueApp(speicher), body: gross });
    expect(res.status).toBe(413);
    expect(objekte.size).toBe(0);
  });

  test("ein Bild über 16 Mio. Pixel wird mit 415 abgelehnt", async () => {
    const { speicher, objekte } = attrappe();
    const bombe = await sharp({
      create: { width: 4000, height: 4001, channels: 3, background: "#fff" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const res = await hochladen({ app: neueApp(speicher), body: bombe });
    expect(res.status).toBe(415);
    expect(objekte.size).toBe(0);
  });
});

describe("Upload von PDFs (entfällt, #428)", () => {
  test("ein PDF wird mit 415 abgelehnt, auch mit Alt-Text und dem Content-Type eines Bildes", async () => {
    const { speicher, objekte } = attrappe();
    const app = neueApp(speicher);
    const vorher = (await zeilen()).length;
    for (const query of [
      "sichtbarkeit=angemeldet",
      "sichtbarkeit=oeffentlich&altText=Beschreibung",
      "sichtbarkeit=angemeldet&dekorativ=true",
    ]) {
      const res = await hochladen({
        app,
        body: pdf(1000),
        query,
        typ: "image/jpeg",
      });
      expect(res.status, query).toBe(415);
      expect(await res.json()).toMatchObject({ code: "MEDIEN_FORMAT" });
    }
    expect(objekte.size).toBe(0);
    expect((await zeilen()).length).toBe(vorher);
  });

  test("ein grosses PDF ist 413 mit JSON-Fehler, mit und ohne Content-Length", async () => {
    const { speicher, objekte } = attrappe();
    const app = neueApp(speicher);
    const gross = pdf(MEDIEN_BILD_MAX_BYTES);
    const ohne = await hochladen({
      app,
      body: gross,
      query: "sichtbarkeit=angemeldet",
    });
    expect(ohne.status).toBe(413);
    expect(await ohne.json()).toMatchObject({ code: "ZU_GROSS" });
    const mitLaenge = await app.request(
      "/api/v1/admin/medien?sichtbarkeit=angemeldet",
      {
        method: "POST",
        headers: {
          ...(await legePersonaAn(welt, "admin")).headers,
          "content-length": String(gross.length),
        },
        body: gross,
      },
    );
    expect(mitLaenge.status).toBe(413);
    expect(objekte.size).toBe(0);
  });
});

describe("Typ-Täuschung", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>';
  test.each([
    ["SVG", Buffer.from(SVG)],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["GIF", Buffer.from("GIF89a\x01\x00\x01\x00")],
    ["Text mit JPEG-Endung", Buffer.from("kein Bild")],
    [
      "JPEG-Kopf mit Müll",
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100, 7)]),
    ],
    ["leer", Buffer.alloc(0)],
  ])("%s: 415, nichts gespeichert", async (_name, body) => {
    const { speicher, objekte } = attrappe();
    const res = await hochladen({
      app: neueApp(speicher),
      body,
      query: "sichtbarkeit=angemeldet&altText=Text",
      typ: "image/jpeg",
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "MEDIEN_FORMAT" });
    expect(objekte.size).toBe(0);
  });

  test("ein JPEG als application/pdf deklariert ist ein Bild und braucht Alt-Text", async () => {
    const { speicher } = attrappe();
    const res = await hochladen({
      app: neueApp(speicher),
      body: await jpeg(),
      query: "sichtbarkeit=angemeldet",
      typ: "application/pdf",
    });
    expect(res.status).toBe(400);
  });

  test("Dateiname, Typ und Endung in der Query sind unbekannte Parameter", async () => {
    const { speicher } = attrappe();
    const res = await hochladen({
      app: neueApp(speicher),
      body: await jpeg(),
      query: "sichtbarkeit=angemeldet&dateiname=a.jpg&typ=image/jpeg",
    });
    expect(res.status).toBe(400);
  });

  test("ohne Sichtbarkeit oder mit einer unbekannten 400", async () => {
    const { speicher } = attrappe();
    const app = neueApp(speicher);
    for (const query of ["altText=Text", "sichtbarkeit=alle&altText=Text"]) {
      expect((await hochladen({ app, body: await jpeg(), query })).status).toBe(
        400,
      );
    }
  });
});

describe("Rechte", () => {
  test("nur Admins laden hoch, listen und löschen", async () => {
    const { speicher, objekte } = attrappe();
    const app = neueApp(speicher);
    const res = await hochladen({
      app,
      persona: "elternA",
      body: await jpeg(),
    });
    expect(res.status).toBe(403);
    expect(objekte.size).toBe(0);
    const eltern = (await legePersonaAn(welt, "elternA")).headers;
    expect(
      (await app.request("/api/v1/admin/medien", { headers: eltern })).status,
    ).toBe(403);
  });

  test("öffentlich, angemeldet und ohne Sitzung", async () => {
    const { speicher } = attrappe();
    const app = neueApp(speicher);
    const anlegen = async (sichtbarkeit: string, body: Uint8Array) =>
      (
        (await (
          await hochladen({
            app,
            body,
            query: `sichtbarkeit=${sichtbarkeit}&altText=Blau`,
          })
        ).json()) as { id: string }
      ).id;
    const offen = await anlegen("oeffentlich", await jpeg());
    const intern = await anlegen("angemeldet", await jpeg());

    // Öffentlich: auch ohne Sitzung, mit kurzem Cache
    const o = await lesen(app, offen);
    expect(o.status).toBe(200);
    expect(o.headers.get("content-type")).toBe("image/webp");
    expect(o.headers.get("x-content-type-options")).toBe("nosniff");
    expect(o.headers.get("cache-control")).toBe("public, max-age=300");
    expect(o.headers.get("content-disposition")).toBe("inline");
    expect(o.headers.get("content-security-policy")).toContain("sandbox");
    expect(
      (await sharp(Buffer.from(await o.arrayBuffer())).metadata()).format,
    ).toBe("webp");
    // Auch fremde Abteilungen und gesperrte Konten sehen es: öffentlich heisst öffentlich
    expect((await lesen(app, offen, "demoEltern")).status).toBe(200);
    expect((await lesen(app, offen, "deaktiviert")).status).toBe(200);

    // Angemeldet: nur mit Sitzung der eigenen Abteilung
    expect((await lesen(app, intern)).status).toBe(401);
    expect((await lesen(app, intern, "deaktiviert")).status).toBe(401);
    expect((await lesen(app, intern, "mussPasswortAendern")).status).toBe(403);
    const i = await lesen(app, intern, "elternB");
    expect(i.status).toBe(200);
    expect(i.headers.get("cache-control")).toBe("private, no-store");
    expect(i.headers.get("x-content-type-options")).toBe("nosniff");
    // Fremde Abteilung: 404 wie bei unbekannter ID, nie 403
    for (const persona of ["demoAdmin", "demoEltern"] as const) {
      expect((await lesen(app, intern, persona)).status, persona).toBe(404);
    }
    expect((await lesen(app, randomUUID(), "admin")).status).toBe(404);
    expect((await lesen(app, "kein-uuid", "admin")).status).toBe(400);
  });

  test("ein altes PDF-Medium (vor #428) wird nicht mehr ausgeliefert, bleibt aber in der Liste und löschbar", async () => {
    const { speicher } = attrappe();
    const app = neueApp(speicher);
    const [alt] = await db
      .insert(schema.medium)
      .values({
        abteilungId: welt.testabteilungId,
        mimeTyp: "application/pdf",
        groesse: 10,
        sichtbarkeit: "oeffentlich",
        speicherSchluessel: randomUUID(),
      })
      .returning({ id: schema.medium.id });
    // Weder ohne Sitzung (öffentlich) noch mit Sitzung
    expect((await lesen(app, alt.id)).status).toBe(404);
    expect((await lesen(app, alt.id, "admin")).status).toBe(404);
    const admin = (await legePersonaAn(welt, "admin")).headers;
    const liste = (await (
      await app.request("/api/v1/admin/medien", { headers: admin })
    ).json()) as { medien: { id: string }[] };
    expect(liste.medien.map((m) => m.id)).toContain(alt.id);
    expect(
      (
        await app.request(`/api/v1/admin/medien/${alt.id}`, {
          method: "DELETE",
          headers: admin,
        })
      ).status,
    ).toBe(204);
  });

  test("Liste und Löschen bleiben in der Abteilung des Admins", async () => {
    const { speicher, objekte } = attrappe();
    const app = neueApp(speicher);
    const admin = (await legePersonaAn(welt, "admin")).headers;
    const demoAdmin = (await legePersonaAn(welt, "demoAdmin")).headers;
    const id = (
      (await (
        await hochladen({
          app,
          body: await jpeg(),
          query: "sichtbarkeit=angemeldet&altText=Blau",
        })
      ).json()) as {
        id: string;
      }
    ).id;
    const liste = async (headers: Record<string, string>) =>
      (
        (await (
          await app.request("/api/v1/admin/medien", { headers })
        ).json()) as {
          medien: { id: string }[];
        }
      ).medien.map((m) => m.id);
    expect(await liste(admin)).toContain(id);
    expect(await liste(demoAdmin)).not.toContain(id);
    const url = `/api/v1/admin/medien/${id}`;
    expect(
      (await app.request(url, { method: "DELETE", headers: demoAdmin })).status,
    ).toBe(404);
    expect(objekte.size).toBe(1);
    expect(
      (await app.request(url, { method: "DELETE", headers: admin })).status,
    ).toBe(204);
    expect(objekte.size).toBe(0);
    expect((await zeilen()).some((z) => z.id === id)).toBe(false);
    expect((await lesen(app, id, "admin")).status).toBe(404);
    expect(
      (await app.request(url, { method: "DELETE", headers: admin })).status,
    ).toBe(404);
    // Das Protokoll hält Hochladen und Löschen fest, ohne Inhalt
    const eintraege = await db
      .select({
        aktion: schema.auditLog.aktion,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(eintraege.map((e) => e.aktion).sort()).toEqual([
      "medium_geloescht",
      "medium_hochgeladen",
    ]);
  });
});

describe("Ausfall des Speichers", () => {
  test("Upload: scheitert S3, gibt es 500 ohne Details und keine Zeile", async () => {
    const { speicher, fehler } = attrappe();
    fehler.ablegen = true;
    const vorher = (await zeilen()).length;
    const res = await hochladen({ app: neueApp(speicher), body: await jpeg() });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("geheimer-bucket");
    expect(JSON.parse(text)).toMatchObject({ code: "INTERNER_FEHLER" });
    expect((await zeilen()).length).toBe(vorher);
    // Auch das Log nennt die Meldung nicht
    expect(JSON.stringify(ausgabe.mock.calls)).not.toContain("geheimer-bucket");
  });

  test("Upload: scheitert die Datenbank, räumt die Route das Objekt weg", async () => {
    const { speicher, objekte } = attrappe();
    // Zweimal derselbe Schlüssel: Der zweite Insert verletzt die Eindeutigkeit
    const aufruf = vi.spyOn(speicher, "ablegen");
    const app = neueApp(speicher);
    expect(
      (
        await hochladen({
          app,
          body: await jpeg(),
          query: "sichtbarkeit=angemeldet&altText=Blau",
        })
      ).status,
    ).toBe(201);
    const [schluessel] = [...objekte.keys()];
    aufruf.mockImplementationOnce(async (inhalt, typ) => {
      objekte.set(schluessel, { inhalt, typ });
      return schluessel;
    });
    const res = await hochladen({
      app,
      body: await jpeg(),
      query: "sichtbarkeit=angemeldet&altText=Blau",
    });
    expect(res.status).toBe(500);
    // Das Aufräumen löschte den Schlüssel, den auch die erste Zeile nutzt: Die Attrappe kennt keine Zählung; entscheidend ist der Aufruf
    expect(objekte.has(schluessel)).toBe(false);
  });

  test("Upload: scheitert auch das Aufräumen, bleibt es bei 500 und das Log nennt die Waise", async () => {
    const { speicher, objekte, fehler } = attrappe();
    const app = neueApp(speicher);
    await hochladen({
      app,
      body: await jpeg(),
      query: "sichtbarkeit=angemeldet&altText=Blau",
    });
    const [schluessel] = [...objekte.keys()];
    vi.spyOn(speicher, "ablegen").mockImplementationOnce(async () => {
      fehler.loeschen = true;
      return schluessel;
    });
    const res = await hochladen({
      app,
      body: await jpeg(),
      query: "sichtbarkeit=angemeldet&altText=Blau",
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(ausgabe.mock.calls)).toContain("WAISE");
  });

  test("Abruf: scheitert S3, gibt es 500 ohne Details", async () => {
    const { speicher, fehler } = attrappe();
    const app = neueApp(speicher);
    const id = (
      (await (
        await hochladen({
          app,
          body: await jpeg(),
          query: "sichtbarkeit=oeffentlich&altText=Blau",
        })
      ).json()) as { id: string }
    ).id;
    fehler.holen = true;
    for (const persona of [undefined, "admin"] as const) {
      const res = await lesen(app, id, persona);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("geheimer-bucket");
    }
  });

  test("Löschen: scheitert S3 danach, ist die Zeile weg und die Antwort 204", async () => {
    const { speicher, fehler } = attrappe();
    const app = neueApp(speicher);
    const id = (
      (await (
        await hochladen({
          app,
          body: await jpeg(),
          query: "sichtbarkeit=angemeldet&altText=Blau",
        })
      ).json()) as { id: string }
    ).id;
    fehler.loeschen = true;
    const res = await app.request(`/api/v1/admin/medien/${id}`, {
      method: "DELETE",
      headers: (await legePersonaAn(welt, "admin")).headers,
    });
    expect(res.status).toBe(204);
    expect((await zeilen()).some((z) => z.id === id)).toBe(false);
    expect(JSON.stringify(ausgabe.mock.calls)).toContain("WAISE");
  });

  test("ohne Speicher antworten die Routen mit 501", async () => {
    const app = neueApp();
    expect((await hochladen({ app, body: await jpeg() })).status).toBe(501);
    expect((await lesen(app, randomUUID(), "admin")).status).toBe(501);
  });
});

describe("Begrenzung", () => {
  test("ab dem elften Upload in zehn Minuten 429, auch fehlgeschlagene zählen", async () => {
    const { speicher } = attrappe();
    const app = neueApp(speicher);
    const status: number[] = [];
    const headers = (await legePersonaAn(welt, "admin")).headers;
    for (let i = 0; i < 11; i++) {
      status.push(
        (await hochladen({ app, headers, body: Buffer.from("kein Bild") }))
          .status,
      );
    }
    expect(status).toEqual([...Array(10).fill(415), 429]);
  });

  test("die Grenze von 64 KB gilt weiter für andere POST-Routen", async () => {
    const app = neueApp(attrappe().speicher);
    const res = await app.request("/api/v1/admin/medien/x", {
      method: "POST",
      headers: (await legePersonaAn(welt, "admin")).headers,
      body: Buffer.alloc(70_000),
    });
    expect(res.status).toBe(413);
  });
});
