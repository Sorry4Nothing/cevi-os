import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { kodiereZeichen } from "../src/bild-sharp.js";
import {
  keineDaten,
  rendereAnmeldung,
  rendereSeite,
  type Kontext,
} from "../src/website/rendern.js";
import {
  rendereFehlerseite,
  rendereServerfehler,
  rendereWartung,
} from "../src/website/fehlerseiten.js";
import {
  alsIco,
  ZEICHEN_192,
  ZEICHEN_32,
  ZEICHEN_APPLE,
  ZEICHEN_DATEIEN,
  ZEICHEN_ICO,
} from "../src/website/zeichen.js";
import { istAusgabePfad } from "../src/website/ausgabe.js";

// Favicon der Website (#558): Dateien aus dem Zeichen der Abteilung und die Einträge im <head>. Ohne Datenbank
const standard = readFileSync(
  new URL("../public/admin/favicon.svg", import.meta.url),
);
const kontext = (zeichen?: string): Kontext => ({
  abteilung: "Cevi Test",
  basisUrl: "https://example.org",
  navigation: [],
  daten: keineDaten(),
  ...(zeichen && { zeichen }),
});

describe("Dateien aus dem Zeichen", () => {
  test("aus dem Cevi-Zeichen der Plattform: 32, 192 und 180 px, PNG; das ICO trägt das 32er-Bild", async () => {
    const d = await kodiereZeichen(standard);
    expect(Object.keys(d).sort()).toEqual([...ZEICHEN_DATEIEN].sort());
    for (const [datei, seite] of [
      [ZEICHEN_32, 32],
      [ZEICHEN_192, 192],
      [ZEICHEN_APPLE, 180],
    ] as const) {
      const m = await sharp(d[datei]).metadata();
      expect([datei, m.format, m.width, m.height]).toEqual([
        datei,
        "png",
        seite,
        seite,
      ]);
    }
    // ICO: Kopf (reserviert 0, Art 1, ein Bild), Eintrag 32 × 32, dann das PNG ab Byte 22
    const ico = d[ZEICHEN_ICO];
    expect([...ico.subarray(0, 8)]).toEqual([0, 0, 1, 0, 1, 0, 32, 32]);
    const ansicht = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(ansicht.getUint32(14, true)).toBe(d[ZEICHEN_32].byteLength);
    expect(ansicht.getUint32(18, true)).toBe(22);
    expect(
      Buffer.from(ico.subarray(22)).equals(Buffer.from(d[ZEICHEN_32])),
    ).toBe(true);
    for (const datei of ZEICHEN_DATEIEN) {
      expect(istAusgabePfad(datei), datei).toBe(true);
    }
  });

  test("weisse Tafel: Die Mitte des Randes ist weiss, die Ecke für den Tab durchsichtig, für iOS deckend", async () => {
    const d = await kodiereZeichen(standard);
    const pixel = async (datei: Uint8Array, x: number, y: number) => {
      const { data } = await sharp(datei)
        .ensureAlpha()
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return [...data];
    };
    expect(await pixel(d[ZEICHEN_192], 96, 4)).toEqual([255, 255, 255, 255]);
    expect((await pixel(d[ZEICHEN_192], 0, 0))[3]).toBe(0);
    expect(await pixel(d[ZEICHEN_APPLE], 0, 0)).toEqual([255, 255, 255, 255]);
    // Das Zeichen selbst ist da: In der Mitte steht nicht nur Weiss
    const { channels } = await sharp(d[ZEICHEN_192]).stats();
    expect(channels[1]!.min).toBeLessThan(120);
  });

  test("ein breites Bild behält sein Seitenverhältnis und bleibt in der Tafel", async () => {
    const breit = await sharp({
      create: { width: 400, height: 100, channels: 3, background: "#c41333" },
    })
      .png()
      .toBuffer();
    const d = await kodiereZeichen(breit);
    const { data, info } = await sharp(d[ZEICHEN_192])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rot = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return data[i]! > 150 && data[i + 1]! < 80;
    };
    expect(rot(96, 96)).toBe(true);
    // Oben und unten bleibt die Tafel frei
    expect(rot(96, 40)).toBe(false);
    expect(rot(96, 150)).toBe(false);
  });

  test("kein Bild: Fehler statt leerer Dateien", async () => {
    await expect(kodiereZeichen(Buffer.from("kein bild"))).rejects.toThrow();
  });

  test("alsIco: ein Eintrag mit Länge und Beginn des Bildes", () => {
    const ico = alsIco(new Uint8Array([1, 2, 3]), 16);
    expect(ico).toHaveLength(25);
    expect([...ico.subarray(22)]).toEqual([1, 2, 3]);
    expect(ico[6]).toBe(16);
  });
});

describe("Einträge im Kopf der Seite", () => {
  const LINKS = [
    '<link rel="icon" type="image/png" sizes="32x32" href="/website/zeichen-32.png?v=abc123">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/website/zeichen-192.png?v=abc123">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=abc123">',
  ];
  const seite = (k: Kontext) =>
    rendereSeite(
      {
        id: "0190a000-0000-7000-8000-000000000004",
        pfad: "/x",
        dokument: { titel: "X", bausteine: [] } as never,
      },
      k,
    );

  test("jede Art von Seite trägt die drei Einträge: Inhalt, Anmeldung, 404, 500, Wartung", () => {
    const k = kontext("abc123");
    for (const html of [
      seite(k),
      rendereAnmeldung(k),
      rendereFehlerseite(k),
      rendereServerfehler(k),
      rendereWartung(k),
    ]) {
      for (const link of LINKS) expect(html).toContain(link);
      // Nur eigene Adressen: Die Meta-CSP (img-src 'self') bleibt
      expect(html).not.toMatch(
        /<link rel="(icon|apple-touch-icon)"[^>]*https?:/,
      );
    }
  });

  test("ohne Favicon in der Ausgabe (Vorschau im Editor): keine Einträge", () => {
    expect(seite(kontext())).not.toMatch(/rel="(icon|apple-touch-icon)"/);
  });
});
