import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { kodiereMedienbild } from "../src/bild-sharp.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import {
  erstelleFlickrOriginal,
  type FlickrOriginal,
} from "../src/fotos/flickr-original.js";
import { QuellFehler, type FotoQuelle } from "../src/fotos/quelle.js";
import {
  abstand,
  dHash,
  graubild,
  SICHER,
  UNSICHER,
  urteile,
  vergleiche,
} from "../src/medien-abgleich.js";
import { legeBildAb } from "../src/medien.js";
import {
  ergaenzeVarianten,
  ersetzeAusFlickr,
  vorschlaege,
} from "../src/medien-flickr.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { erstelleWelt, type Welt } from "./hilfen/personas.js";

// Befehl «medium-aus-flickr» und «medien-varianten» (#868) ohne Netz: Flickr ist eine Attrappe, die Bilder sind gezeichnete Formen, nie Fotos. Keine echten Konten oder Schlüssel
bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());
let welt: Welt;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
});

const KONTO = "12345678@N00";

// Ein Motiv aus Flächen und Kreisen in Graustufen und Farbe; «samen» verschiebt alles, damit zwei Motive verschieden sind
function motiv(breite: number, hoehe: number, samen: number) {
  let z = samen;
  const zufall = () => (z = (z * 9301 + 49297) % 233280) / 233280;
  const formen = Array.from({ length: 40 }, () => {
    const f = `hsl(${Math.round(zufall() * 360)},70%,${Math.round(20 + zufall() * 60)}%)`;
    return zufall() < 0.5
      ? `<circle cx="${zufall() * breite}" cy="${zufall() * hoehe}" r="${20 + zufall() * breite * 0.15}" fill="${f}"/>`
      : `<rect x="${zufall() * breite}" y="${zufall() * hoehe}" width="${30 + zufall() * breite * 0.3}" height="${30 + zufall() * hoehe * 0.3}" fill="${f}"/>`;
  }).join("");
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${breite}" height="${hoehe}"><rect width="100%" height="100%" fill="#888"/>${formen}</svg>`,
    ),
  )
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function grau(daten: Uint8Array) {
  const { data, info } = await sharp(daten)
    .resize(256, 256, { fit: "inside" })
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return graubild(data, info.width, info.height);
}

function attrappe() {
  const objekte = new Map<string, Uint8Array>();
  const speicher: Medienspeicher = {
    async ablegen(inhalt, _typ, schluessel = randomUUID()) {
      objekte.set(schluessel, inhalt);
      return schluessel;
    },
    async holen(schluessel) {
      const o = objekte.get(schluessel);
      if (!o) throw new Error("NoSuchKey");
      return o;
    },
    async loeschen(schluessel) {
      objekte.delete(schluessel);
    },
  };
  return { speicher, objekte };
}

// Ein Medium wie aus der alten Website: das Band 3000 × 900 aus dem Foto (y ab 400), verkleinert auf 1920 × 576
async function bandAusFoto(foto: Buffer) {
  return sharp(foto)
    .extract({ left: 0, top: 400, width: 3000, height: 900 })
    .resize(1920, 576)
    .jpeg()
    .toBuffer();
}

async function legeMediumAn(speicher: Medienspeicher, daten: Uint8Array) {
  const bild = await kodiereMedienbild(daten);
  const schluessel = await legeBildAb(speicher, { ...bild, varianten: [] });
  const [m] = await db
    .insert(schema.medium)
    .values({
      abteilungId: welt.testabteilungId,
      mimeTyp: bild.typ,
      groesse: bild.inhalt.length,
      breite: bild.breite,
      hoehe: bild.hoehe,
      altText: "Gezeichnete Formen",
      sichtbarkeit: "oeffentlich",
      speicherSchluessel: schluessel,
    })
    .returning();
  return m!;
}

describe("Bildabgleich", () => {
  test("dasselbe Motiv neu kodiert liegt nah, ein anderes weit weg", async () => {
    const a = await motiv(1200, 800, 1);
    const kleiner = await sharp(a).resize(400).webp({ quality: 60 }).toBuffer();
    const anderes = await motiv(1200, 800, 2);
    const h = dHash(await grau(a));
    expect(abstand(h, dHash(await grau(kleiner)))).toBeLessThanOrEqual(SICHER);
    expect(abstand(h, dHash(await grau(anderes)))).toBeGreaterThan(UNSICHER);
  });

  test("ein beschnittenes Band findet seinen Ausschnitt im Foto 3:2", async () => {
    const foto = await motiv(3000, 2000, 3);
    const band = await bandAusFoto(foto);
    const t = vergleiche(
      dHash(await grau(band)),
      1920 / 576,
      await grau(await sharp(foto).resize(320).toBuffer()),
    );
    expect(t.abstand).toBeLessThanOrEqual(SICHER);
    expect(t.ausschnitt.b).toBe(1);
    expect(t.ausschnitt.h).toBeCloseTo(0.45, 2);
    expect(t.ausschnitt.y).toBeCloseTo(0.2, 1);
  });

  test("sicher nur mit Vorsprung vor dem zweitbesten Foto", () => {
    expect(urteile(5, 100)).toBe("sicher");
    expect(urteile(5, 20)).toBe("unsicher");
    expect(urteile(40, 120)).toBe("unsicher");
    expect(urteile(90, 120)).toBe("kein Treffer");
  });
});

describe("Ersatz aus Flickr", () => {
  test("ersetzt die Datei unter derselben ID, schneidet gleich zu, erzeugt Varianten, räumt auf und protokolliert", async () => {
    const { speicher, objekte } = attrappe();
    const foto = await motiv(3000, 2000, 4);
    const m = await legeMediumAn(speicher, await bandAusFoto(foto));
    const alt = m.speicherSchluessel;
    const flickr: FlickrOriginal = {
      async groesste(konto, fotoId) {
        expect([konto, fotoId]).toEqual([KONTO, "4711"]);
        return { daten: foto, breite: 3000, hoehe: 2000 };
      },
    };
    const e = await ersetzeAusFlickr({
      db,
      speicher,
      flickr,
      abteilungId: welt.testabteilungId,
      konto: KONTO,
      mediumId: m.id,
      fotoId: "4711",
    });
    expect(e).toMatchObject({
      ersetzt: true,
      vorher: { breite: 1920, hoehe: 576 },
      waisen: 0,
    });
    if (!e.ersetzt) throw new Error();
    // Das Seitenverhältnis des Bandes bleibt (auf ein Pixel genau)
    expect(e.nachher.breite).toBe(3000);
    expect(Math.abs(e.nachher.hoehe - 900)).toBeLessThanOrEqual(2);
    const [neu] = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, m.id));
    expect(neu!.speicherSchluessel).not.toBe(alt);
    expect(neu!.varianten).toEqual([640, 1280, 1920, 2560]);
    expect([neu!.altText, neu!.sichtbarkeit]).toEqual([
      "Gezeichnete Formen",
      "oeffentlich",
    ]);
    expect(objekte.has(alt)).toBe(false);
    expect(objekte.size).toBe(5);
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, m.id));
    expect(eintrag).toMatchObject({
      aktion: "medium_ersetzt",
      akteurId: "cli",
      details: { quelle: "flickr" },
    });
  });

  test("ist das Foto nicht grösser, bleibt alles, wie es ist", async () => {
    const { speicher, objekte } = attrappe();
    const foto = await motiv(1200, 800, 5);
    const m = await legeMediumAn(speicher, foto);
    const e = await ersetzeAusFlickr({
      db,
      speicher,
      flickr: {
        groesste: async () => ({
          daten: await sharp(foto).resize(800).jpeg().toBuffer(),
          breite: 800,
          hoehe: 533,
        }),
      },
      abteilungId: welt.testabteilungId,
      konto: KONTO,
      mediumId: m.id,
      fotoId: "1",
    });
    expect(e).toMatchObject({ ersetzt: false, grund: "nicht_groesser" });
    expect([...objekte.keys()]).toEqual([m.speicherSchluessel]);
  });

  test("ein Medium einer anderen Abteilung wird nicht angefasst", async () => {
    const { speicher } = attrappe();
    const m = await legeMediumAn(speicher, await motiv(1200, 800, 6));
    await expect(
      ersetzeAusFlickr({
        db,
        speicher,
        flickr: { groesste: async () => Promise.reject(new Error("nie")) },
        abteilungId: welt.demoAbteilungId,
        konto: KONTO,
        mediumId: m.id,
        fotoId: "1",
      }),
    ).rejects.toThrow("Kein Medienbild");
  });
});

describe("Vorschläge", () => {
  test("findet das Quellfoto sicher; ein Medium ohne Quelle hat keinen Treffer", async () => {
    const { speicher } = attrappe();
    const quelleFoto = await motiv(3000, 2000, 7);
    const mitQuelle = await legeMediumAn(
      speicher,
      await bandAusFoto(quelleFoto),
    );
    const ohne = await legeMediumAn(speicher, await motiv(900, 900, 8));
    const fotos = new Map<string, Buffer>([
      ["101", await motiv(3000, 2000, 9)],
      ["102", quelleFoto],
      ["103", await motiv(2000, 3000, 10)],
    ]);
    const bild = (id: string) => ({
      id,
      server: "1",
      secret: "abcd",
      titel: "",
      breite: 4,
      hoehe: 3,
      groessen: ["klein"] as const,
    });
    const quelle: FotoQuelle = {
      alben: async () => [
        { id: "1", titel: "", anzahl: 3, datum: null, titelbild: null },
      ],
      album: async () => ({
        album: { id: "1", titel: "", anzahl: 3, datum: null, titelbild: null },
        bilder: [...fotos.keys()].map(bild),
      }),
      datei: async (b, groesse) => {
        expect(groesse).toBe("klein");
        const daten = await sharp(fotos.get(b.id)!)
          .resize(320)
          .jpeg()
          .toBuffer();
        return {
          body: new Response(daten).body!,
          typ: "image/jpeg",
          laenge: null,
        };
      },
    };
    // Nur die Medien dieser Abteilung; die Vorschläge der beiden neuen
    const liste = (
      await vorschlaege({
        db,
        speicher,
        quelle,
        abteilungId: welt.testabteilungId,
        konto: KONTO,
      })
    ).filter((v) => v.mediumId === mitQuelle.id || v.mediumId === ohne.id);
    expect(liste.find((v) => v.mediumId === mitQuelle.id)).toMatchObject({
      fotoId: "102",
      urteil: "sicher",
    });
    expect(liste.find((v) => v.mediumId === ohne.id)).toMatchObject({
      fotoId: null,
      urteil: "kein Treffer",
    });
  });
});

describe("Varianten für den Bestand", () => {
  test("ergänzt Varianten aus dem gespeicherten Bild und ist wiederholbar", async () => {
    const { speicher, objekte } = attrappe();
    const m = await legeMediumAn(speicher, await motiv(2000, 1000, 11));
    const e = await ergaenzeVarianten({ db, speicher });
    expect(e.ergaenzt).toBeGreaterThanOrEqual(1);
    const [neu] = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, m.id));
    expect(neu!.varianten).toEqual([640, 1280, 1920]);
    expect(neu!.speicherSchluessel).toBe(m.speicherSchluessel);
    expect(objekte.has(`${m.speicherSchluessel}-w1920`)).toBe(true);
    // Zweiter Lauf: dieses Medium bleibt liegen
    const vorher = objekte.size;
    await ergaenzeVarianten({ db, speicher });
    expect(objekte.size).toBe(vorher);
  });
});

describe("Flickr: grösstes Bild", () => {
  const json = (d: unknown) =>
    new Response(JSON.stringify(d), {
      headers: { "content-type": "application/json" },
    });
  const groessen = (quelle: string) => ({
    stat: "ok",
    sizes: {
      size: [
        { label: "Small", width: 320, height: 213, source: `${quelle}_n.jpg` },
        {
          label: "Original",
          width: 6699,
          height: 4466,
          source: `${quelle}_o.jpg`,
        },
        { label: "Large", width: 1024, height: 683, source: `${quelle}_b.jpg` },
      ],
    },
  });
  const client = (besitzer: string, quelle: string, abrufe: URL[] = []) =>
    erstelleFlickrOriginal({
      apiKey: "TestSchluesselNurFuerTests",
      fetch: (async (u: URL | string) => {
        const url = new URL(String(u));
        abrufe.push(url);
        const methode = url.searchParams.get("method");
        if (methode === "flickr.photos.getInfo")
          return json({ stat: "ok", photo: { owner: { nsid: besitzer } } });
        if (methode === "flickr.photos.getSizes") return json(groessen(quelle));
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      }) as unknown as typeof fetch,
    });

  test("lädt das Original vom festen Bild-Host", async () => {
    const abrufe: URL[] = [];
    const e = await client(
      KONTO,
      "https://live.staticflickr.com/65535/1_abc",
      abrufe,
    ).groesste(KONTO, "1");
    expect([e.breite, e.hoehe, [...e.daten]]).toEqual([6699, 4466, [1, 2, 3]]);
    expect(abrufe.at(-1)!.pathname).toBe("/65535/1_abc_o.jpg");
  });

  test("ein Foto eines anderen Kontos oder ein fremder Host wird abgelehnt", async () => {
    await expect(
      client("99999@N01", "https://live.staticflickr.com/1/x").groesste(
        KONTO,
        "1",
      ),
    ).rejects.toBeInstanceOf(QuellFehler);
    const abrufe: URL[] = [];
    await expect(
      client(KONTO, "https://boese.example.org/1/x", abrufe).groesste(
        KONTO,
        "1",
      ),
    ).rejects.toMatchObject({ art: "nicht_gefunden", code: "host" });
    expect(abrufe.some((u) => u.host === "boese.example.org")).toBe(false);
    await expect(
      client(KONTO, "https://live.staticflickr.com/1/x").groesste(
        KONTO,
        "../1",
      ),
    ).rejects.toMatchObject({ code: "kennung" });
  });
});
