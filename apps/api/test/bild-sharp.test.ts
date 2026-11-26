import sharp from "sharp";
import { describe, expect, test } from "vitest";
import {
  kodiereMedienbild,
  kodiereProfilbild,
  kodiereStufenlogo,
  kodiereVarianten,
} from "../src/bild-sharp.js";

// Einfarbig: als PNG wenige KB, beim Dekodieren zählt nur die Kantenlänge
const png = (breite: number, hoehe: number) =>
  sharp({
    create: { width: breite, height: hoehe, channels: 3, background: "#fff" },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

describe.each([
  ["Profilbild", kodiereProfilbild],
  ["Stufenlogo", kodiereStufenlogo],
])("Pixelgrenze (%s)", (_name, kodiere) => {
  test.each([
    ["Handyfoto 12 MP", 4032, 3024],
    ["Handyfoto 12.5 MP", 4080, 3072],
    ["genau 16 Mio. Pixel", 4000, 4000],
  ])("%s (%i × %i) geht durch", async (_art, breite, hoehe) => {
    await expect(kodiere(await png(breite, hoehe))).resolves.toBeInstanceOf(
      Buffer,
    );
  });

  test("ein Bild über 16 Mio. Pixel wird abgelehnt", async () => {
    await expect(kodiere(await png(4000, 4001))).rejects.toThrow(
      "exceeds pixel limit",
    );
  });
});

// Grosse Bilder brauchen beim Kodieren einige Sekunden
describe("Medienbild (#868)", { timeout: 60_000 }, () => {
  test("ein Foto mit 24 MP (6000 × 4000) geht durch: 4096 px und alle Varianten darunter", async () => {
    const b = await kodiereMedienbild(await png(6000, 4000));
    expect([b.breite, b.hoehe]).toEqual([4096, 2731]);
    expect(b.varianten.map((v) => v.breite)).toEqual([
      640, 1280, 1920, 2560, 3840,
    ]);
    const meta = await sharp(b.varianten[4]!.inhalt).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual([
      "webp",
      3840,
      2560,
    ]);
  });

  test("ein Original von Flickr (6699 × 4466) geht durch, über 40 Mio. Pixel nicht", async () => {
    await expect(
      kodiereMedienbild(await png(6699, 4466)),
    ).resolves.toMatchObject({ breite: 4096 });
    await expect(kodiereMedienbild(await png(8000, 5001))).rejects.toThrow(
      "exceeds pixel limit",
    );
  });

  test("nie hochskaliert: ein Bild mit 1000 px bleibt 1000 px, nur die Variante 640", async () => {
    const b = await kodiereMedienbild(await png(1000, 500));
    expect([b.breite, b.varianten.map((v) => v.breite)]).toEqual([1000, [640]]);
  });

  test("Ausschnitt: nur der genannte Teil, als Anteil des Bildes", async () => {
    const b = await kodiereMedienbild(await png(3000, 2000), {
      x: 0,
      y: 0.25,
      b: 1,
      h: 0.3,
    });
    expect([b.breite, b.hoehe]).toEqual([3000, 600]);
  });

  test("Varianten aus einem gespeicherten Bild (Bestand)", async () => {
    const v = await kodiereVarianten(await png(2048, 1024));
    expect(v.map((x) => x.breite)).toEqual([640, 1280, 1920]);
  });
});
