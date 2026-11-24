import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Verweisprüfung der Bausteine für Bilder und Medien (#742): Medium der Abteilung, Format, öffentlich, Alt-Text und Seitenlinks, beim Speichern des Entwurfs.
// Schema, Renderer und Skript: website-medien-bausteine.test.ts.

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const speicher: Medienspeicher = {
  ablegen: async () => randomUUID(),
  holen: async () => new Uint8Array(),
  loeschen: async () => {},
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  medienspeicher: speicher,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const BASIS = "/api/v1/redaktion/seiten";

let welt: Welt;
let admin: PersonaKonto;

type Sicht = "oeffentlich" | "angemeldet";

async function neueSeite(sichtbarkeit: Sicht = "oeffentlich") {
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: `s-${randomUUID().slice(0, 12)}`,
      titel: "Seite",
      sichtbarkeit,
    })
    .returning({ id: schema.seite.id });
  return z!.id;
}

async function neuesMedium(
  sichtbarkeit: Sicht,
  {
    pdf = false,
    dekorativ = false,
    abteilungId = welt.testabteilungId,
  }: { pdf?: boolean; dekorativ?: boolean; abteilungId?: string } = {},
) {
  const [z] = await db
    .insert(schema.medium)
    .values({
      abteilungId,
      mimeTyp: pdf ? "application/pdf" : "image/webp",
      groesse: 10,
      breite: pdf ? null : 10,
      hoehe: pdf ? null : 10,
      altText: pdf || dekorativ ? null : "Test",
      dekorativ: !pdf && dekorativ,
      sichtbarkeit,
      speicherSchluessel: randomUUID(),
    })
    .returning({ id: schema.medium.id });
  return z!.id;
}

const baustein = (typ: string, daten: Record<string, unknown>) => ({
  id: randomUUID(),
  typ,
  daten,
});
const dokument = (...bausteine: object[]) => ({
  v: 1,
  titel: "Titel",
  bausteine,
});
const raster = (...ids: string[]) =>
  baustein("bildraster", {
    spalten: 2,
    format: "quer",
    bilder: ids.map((mediumId) => ({ mediumId })),
  });
const logos = (...ids: string[]) =>
  baustein("logoreihe", {
    darstellung: "farbig",
    bilder: ids.map((mediumId) => ({ mediumId })),
  });

// Speichert den Entwurf; liefert den Status und den Fehlercode
async function speichere(id: string, doc: object, zaehler = 0) {
  const antwort = await app.request(`${BASIS}/${id}/entwurf`, {
    method: "PUT",
    headers: { ...admin.headers, "content-type": "application/json" },
    body: JSON.stringify({ zaehler, dokument: doc }),
  });
  const body = (await antwort.json()) as {
    code?: string;
    fehler?: { pfad: string; code: string }[];
  };
  return { status: antwort.status, ...body };
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
});

describe("Verweise der Bausteine für Bilder und Medien", () => {
  test("alle Bausteine mit Medien der eigenen Abteilung sind gültig", async () => {
    const id = await neueSeite();
    const [a, b, c] = await Promise.all([
      neuesMedium("oeffentlich"),
      neuesMedium("oeffentlich"),
      neuesMedium("oeffentlich"),
    ]);
    const antwort = await speichere(
      id,
      dokument(
        raster(a!, b!),
        baustein("bildstreifen", {
          bilder: [{ mediumId: a }, { mediumId: b }, { mediumId: c }],
        }),
        baustein("bildvergleich", {
          bilder: [{ mediumId: a }, { mediumId: b }],
        }),
        logos(a!, b!),
        baustein("panorama", { mediumId: c, hoehe: "hoch" }),
        baustein("bildtext", { mediumId: a, titel: "T" }),
        baustein("bilderpaket", {
          titel: "Paket",
          link: "https://example.sharepoint.com/x",
          bild: b,
        }),
        baustein("videolink", {
          art: "video",
          beschriftung: "Video",
          url: "https://video.example.org/w/1",
          bild: c,
        }),
      ),
    );
    expect(antwort.status, JSON.stringify(antwort)).toBe(200);
  });

  test("fremdes und unbekanntes Medium sind gleich 422 MEDIUM_UNBEKANNT, mit dem Pfad des Bausteins", async () => {
    const id = await neueSeite();
    const eigenes = await neuesMedium("oeffentlich");
    const fremdes = await neuesMedium("oeffentlich", {
      abteilungId: welt.demoAbteilungId,
    });
    for (const m of [fremdes, randomUUID()]) {
      const antwort = await speichere(
        id,
        dokument(
          baustein("ueberschrift", { ebene: 2, text: "Hallo" }),
          raster(eigenes!, m),
        ),
      );
      expect(antwort.status).toBe(422);
      expect(antwort.code).toBe("MEDIUM_UNBEKANNT");
      expect(antwort.fehler).toEqual([
        { pfad: "bausteine.1", code: "MEDIUM_UNBEKANNT" },
      ]);
    }
    // Auch das Vorschaubild eines Videos und eines Pakets
    for (const typ of ["bilderpaket", "videolink"]) {
      const daten =
        typ === "bilderpaket"
          ? { titel: "P", link: "https://example.sharepoint.com/x" }
          : {
              art: "video",
              beschriftung: "V",
              url: "https://video.example.org/w/1",
            };
      const antwort = await speichere(
        id,
        dokument(baustein(typ, { ...daten, bild: fremdes })),
      );
      expect(antwort.code, typ).toBe("MEDIUM_UNBEKANNT");
    }
  });

  test("ein Medium, das kein Bild ist: 422 MEDIUM_FORMAT", async () => {
    const id = await neueSeite();
    const pdf = await neuesMedium("oeffentlich", { pdf: true });
    const antwort = await speichere(
      id,
      dokument(baustein("panorama", { mediumId: pdf, hoehe: "mittel" })),
    );
    expect(antwort.status).toBe(422);
    expect(antwort.code).toBe("MEDIUM_FORMAT");
  });

  test("auf einer öffentlichen Seite nur öffentliche Medien: 422 MEDIUM_NICHT_OEFFENTLICH; für Angemeldete genügt ein internes", async () => {
    const intern = await neuesMedium("angemeldet");
    const oeffentlich = await neueSeite("oeffentlich");
    const baustuecke = [
      raster(intern, intern),
      baustein("bildtext", { mediumId: intern, titel: "T" }),
      baustein("bilderpaket", {
        titel: "P",
        link: "https://example.sharepoint.com/x",
        bild: intern,
      }),
      baustein("videolink", {
        art: "video",
        beschriftung: "V",
        url: "https://video.example.org/w/1",
        bild: intern,
      }),
    ];
    for (const b of baustuecke) {
      const antwort = await speichere(oeffentlich, dokument(b));
      expect(antwort.code, b.typ).toBe("MEDIUM_NICHT_OEFFENTLICH");
    }
    for (const b of baustuecke) {
      const antwort = await speichere(
        await neueSeite("angemeldet"),
        dokument(b),
      );
      expect(antwort.status, b.typ).toBe(200);
    }
  });

  test("Bildvergleich und Logo-Reihe verlangen einen Alt-Text: ein Bild als Zierde ist 422 MEDIUM_ALT_FEHLT; Raster, breites Bild und Streifen erlauben es", async () => {
    const id = await neueSeite();
    const echt = await neuesMedium("oeffentlich");
    const zierde = await neuesMedium("oeffentlich", { dekorativ: true });
    for (const b of [
      baustein("bildvergleich", {
        bilder: [{ mediumId: echt }, { mediumId: zierde }],
      }),
      logos(echt!, zierde!),
    ]) {
      const antwort = await speichere(id, dokument(b));
      expect(antwort.status, b.typ).toBe(422);
      expect(antwort.code, b.typ).toBe("MEDIUM_ALT_FEHLT");
    }
    for (const b of [
      raster(echt!, zierde!),
      baustein("panorama", { mediumId: zierde, hoehe: "niedrig" }),
      baustein("bildstreifen", {
        bilder: [{ mediumId: echt }, { mediumId: zierde }, { mediumId: echt }],
      }),
    ]) {
      // Je Baustein eine Seite: Der Zähler des Entwurfs steigt mit jedem Speichern
      const antwort = await speichere(await neueSeite(), dokument(b));
      expect(antwort.status, b.typ).toBe(200);
    }
  });

  test("Links auf Seiten der Website: eine unbekannte Seite ist 422 SEITE_UNBEKANNT (Logo und Bild mit Text), eine feste Seite gilt", async () => {
    const id = await neueSeite();
    const m = await neuesMedium("oeffentlich");
    const antwort = await speichere(
      id,
      dokument(
        baustein("logoreihe", {
          darstellung: "grau",
          bilder: [{ mediumId: m, link: "/gibt-es-nicht" }],
        }),
        baustein("bildtext", {
          mediumId: m,
          titel: "T",
          link: { beschriftung: "Mehr", ziel: "/auch-nicht" },
        }),
      ),
    );
    expect(antwort.status).toBe(422);
    expect(antwort.fehler).toEqual([
      { pfad: "bausteine.0", code: "SEITE_UNBEKANNT" },
      { pfad: "bausteine.1", code: "SEITE_UNBEKANNT" },
    ]);
    const gut = await speichere(
      id,
      dokument(
        baustein("bildtext", {
          mediumId: m,
          titel: "T",
          link: { beschriftung: "Termine", ziel: "/termine" },
        }),
      ),
    );
    expect(gut.status).toBe(200);
  });

  test("ein Dokument ohne Medien in den neuen Bausteinen braucht keine Datenbank-Treffer; das Video ohne Vorschaubild bleibt gültig", async () => {
    const id = await neueSeite();
    const antwort = await speichere(
      id,
      dokument(
        baustein("videolink", {
          art: "social",
          beschriftung: "Beitrag",
          url: "https://social.example.org/p/1",
        }),
        baustein("bilderpaket", {
          titel: "Paket",
          link: "https://example.sharepoint.com/x",
        }),
      ),
    );
    expect(antwort.status).toBe(200);
  });
});
