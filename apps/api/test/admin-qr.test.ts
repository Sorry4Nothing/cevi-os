import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// QR-Encoder der Verwaltung (#715, public/admin/qr.js). Die Vektoren in test/fixtures/qr-vektoren.json stammen aus python-qrcode (ein unabhängiger Encoder: Byte-Modus, Fehlerkorrektur M, dieselbe Maske) und sind zusätzlich mit zbar und OpenCV dekodiert: Versionen 1, 2, 6, 8, 9 und 10, darunter der Link der Einrichtung und der längste Text.
type Qr = {
  version: number;
  groesse: number;
  maske: number;
  module: boolean[][];
};
type Modul = {
  erzeugeQr: (text: string, optionen?: { maske?: number }) => Qr;
  zeichneQr: (text: string, optionen?: { beschriftung?: string }) => Knoten;
};
type Knoten = {
  tag: string;
  attribute: Record<string, string>;
  kinder: Knoten[];
  setAttribute: (name: string, wert: string) => void;
  append: (...k: Knoten[]) => void;
};
let qr: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", {
    createElementNS: (_ns: string, tag: string): Knoten => {
      const knoten: Knoten = {
        tag,
        attribute: {},
        kinder: [],
        setAttribute(name, wert) {
          this.attribute[name] = wert;
        },
        append(...k) {
          this.kinder.push(...k);
        },
      };
      return knoten;
    },
  });
  qr = (await import(/* @vite-ignore */ `../public/admin/${"qr.js"}`)) as Modul;
});

const vektoren = JSON.parse(
  readFileSync(new URL("./fixtures/qr-vektoren.json", import.meta.url), "utf8"),
) as { text: string; version: number; maske: number; zeilen: string[] }[];

const alsZeilen = (q: Qr) =>
  q.module.map((zeile) => zeile.map((d) => (d ? "1" : "0")).join(""));

describe("Vektoren eines unabhängigen Encoders", () => {
  test.each(vektoren.map((v) => [v.version, v] as const))(
    "Version %i stimmt Modul für Modul überein",
    (_version, v) => {
      const q = qr.erzeugeQr(v.text, { maske: v.maske });
      expect(q.version).toBe(v.version);
      expect(q.groesse).toBe(17 + 4 * v.version);
      expect(alsZeilen(q)).toEqual(v.zeilen);
    },
  );

  test("der Test deckt den Link der Einrichtung und den längsten Text ab", () => {
    expect(vektoren.some((v) => v.text.startsWith("otpauth://totp/"))).toBe(
      true,
    );
    expect(
      vektoren.some((v) => new TextEncoder().encode(v.text).length === 213),
    ).toBe(true);
  });
});

describe("Aufbau", () => {
  test.each([
    [1, 1],
    [14, 1],
    [15, 2],
    [26, 2],
    [27, 3],
    [106, 6],
    [107, 7],
    [213, 10],
  ])("%i Byte passen in Version %i", (laenge, version) => {
    expect(qr.erzeugeQr("a".repeat(laenge)).version).toBe(version);
  });

  test("214 Byte sind zu lang", () => {
    expect(() => qr.erzeugeQr("a".repeat(214))).toThrow(RangeError);
  });

  test("Umlaute zählen als UTF-8-Bytes", () => {
    // 14 Zeichen, 28 Byte: Version 3
    expect(qr.erzeugeQr("ä".repeat(14)).version).toBe(3);
  });

  test("ohne Vorgabe gilt die Maske mit der kleinsten Strafe: Das Ergebnis ist gültig und gleichbleibend", () => {
    const text =
      "otpauth://totp/Cevi%20OS:kim?secret=ABCDEFGH&issuer=Cevi%20OS";
    const a = qr.erzeugeQr(text);
    const b = qr.erzeugeQr(text);
    expect(a.maske).toBeGreaterThanOrEqual(0);
    expect(a.maske).toBeLessThan(8);
    expect(alsZeilen(a)).toEqual(alsZeilen(b));
  });

  test("Format und Version stehen zweimal gleich im Code", () => {
    const q = qr.erzeugeQr("a".repeat(120));
    const m = q.module;
    const n = q.groesse;
    const bit = (b: boolean) => (b ? 1 : 0);
    // Erste Kopie um den oberen linken Sucher, zweite an den anderen beiden
    const erste = [
      ...[0, 1, 2, 3, 4, 5].map((i) => m[i][8]),
      m[7][8],
      m[8][8],
      m[8][7],
      ...[9, 10, 11, 12, 13, 14].map((i) => m[8][14 - i]),
    ];
    const zweite = [
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[8][n - 1 - i]),
      ...[8, 9, 10, 11, 12, 13, 14].map((i) => m[n - 15 + i][8]),
    ];
    expect(erste.map(bit)).toEqual(zweite.map(bit));
    // Version 7 und höher tragen die Versionsinformation zweimal
    const links = [];
    const oben = [];
    for (let i = 0; i < 18; i++) {
      links.push(bit(m[n - 11 + (i % 3)][Math.floor(i / 3)]));
      oben.push(bit(m[Math.floor(i / 3)][n - 11 + (i % 3)]));
    }
    expect(links).toEqual(oben);
  });
});

describe("Zeichnen", () => {
  test("ein SVG mit weissem Grund, einem dunklen Pfad und Beschriftung, ohne HTML", () => {
    const svg = qr.zeichneQr("A", { beschriftung: "QR-Code für den Test" });
    expect(svg.tag).toBe("svg");
    // 21 Module plus Ruhezone von je 4
    expect(svg.attribute.viewBox).toBe("0 0 29 29");
    expect(svg.attribute.role).toBe("img");
    expect(svg.attribute["aria-label"]).toBe("QR-Code für den Test");
    const [grund, dunkel] = svg.kinder;
    expect(grund.attribute.fill).toBe("#fff");
    expect(dunkel.attribute.fill).toBe("#000");
    expect(dunkel.attribute.d).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });

  test("der Pfad zeichnet genau die dunklen Module", () => {
    const text = "Cevi OS";
    const q = qr.erzeugeQr(text);
    const pfad = qr.zeichneQr(text).kinder[1].attribute.d;
    const gezeichnet = new Set<string>();
    for (const [, x, y, breite] of pfad
      .matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)
      .map((t) => t.map(Number) as number[])) {
      for (let i = 0; i < breite; i++) gezeichnet.add(`${x - 4 + i},${y - 4}`);
    }
    const erwartet = new Set<string>();
    q.module.forEach((zeile, y) =>
      zeile.forEach((d, x) => d && erwartet.add(`${x},${y}`)),
    );
    expect(gezeichnet).toEqual(erwartet);
  });

  test("der Quelltext nutzt kein innerHTML und lädt nichts", () => {
    const quelltext = readFileSync(
      new URL("../public/admin/qr.js", import.meta.url),
      "utf8",
    );
    expect(quelltext).not.toMatch(
      /innerHTML|insertAdjacentHTML|import\s|fetch\(/,
    );
  });
});
