import sharp from "sharp";
import type { BildKodierer } from "./bild.js";
import type { MedienKodierer } from "./medien.js";
import {
  alsIco,
  ZEICHEN_192,
  ZEICHEN_32,
  ZEICHEN_APPLE,
  ZEICHEN_ICO,
  type ZeichenDateien,
} from "./website/zeichen.js";

// Ohne Zwischenspeicher: Es kommen wenige, einmalige Bilder, und der Speicher soll nach der Anfrage frei sein
sharp.cache(false);

const SEITE = 256;
// Schutz vor Dekompressionsbomben: Ein 5-MB-PNG kann Milliarden Pixel enthalten. 16 Mio. Pixel decken ein Handyfoto mit 12 MP (4032 × 3024) ab, kosten beim Dekodieren mit 4 Bytes je Pixel rund 64 MB, und das Ergebnis hat ohnehin nur 256 oder 512 px
const MAX_PIXEL = 16_000_000;

// Immer JPEG, quadratisch (Mitte), ohne EXIF, ICC und Ortsdaten: sharp übernimmt Metadaten nur mit withMetadata(). rotate() wendet die EXIF-Drehung vorher an, damit das Bild nicht kippt. Transparenz wird weiss
export const kodiereProfilbild: BildKodierer = async (daten) =>
  sharp(daten, { limitInputPixels: MAX_PIXEL, failOn: "error" })
    .rotate()
    .resize(SEITE, SEITE, { fit: "cover" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();

const LOGO_SEITE = 512;

// Logo: Seitenverhältnis und Transparenz bleiben, höchstens 512 px, ohne Metadaten; immer WebP
export const kodiereStufenlogo: BildKodierer = async (daten) =>
  sharp(daten, { limitInputPixels: MAX_PIXEL, failOn: "error" })
    .rotate()
    .resize(LOGO_SEITE, LOGO_SEITE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

const MEDIEN_SEITE = 2048;

// Medienbild: Seitenverhältnis und Transparenz bleiben, längste Seite höchstens 2048 px, ohne EXIF, ICC und Ortsdaten; immer WebP (kleiner als JPEG und PNG, mit Transparenz, in allen aktuellen Browsern und Apps lesbar). Breite und Höhe stammen vom Ergebnis, nach der Drehung
export const kodiereMedienbild: MedienKodierer = async (daten) => {
  const { data, info } = await sharp(daten, {
    limitInputPixels: MAX_PIXEL,
    failOn: "error",
  })
    .rotate()
    .resize(MEDIEN_SEITE, MEDIEN_SEITE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return {
    inhalt: data,
    typ: "image/webp",
    breite: info.width,
    hoehe: info.height,
  };
};

// Favicon (#558): das Zeichen mittig auf einer weissen Tafel, damit es im hellen und im dunklen Browser lesbar ist. Das Seitenverhältnis bleibt, ein Rand bleibt frei.
// «rund» sind die Ecken für Tab und Lesezeichen; iOS schneidet sein Symbol selbst zu und will keine Transparenz
async function zeichenTafel(daten: Uint8Array, seite: number, rund: boolean) {
  const innen = Math.round(seite * 0.8);
  const bild = await sharp(daten, {
    limitInputPixels: MAX_PIXEL,
    failOn: "error",
    // Für das Cevi-Zeichen der Plattform (SVG); bei Rasterbildern ohne Wirkung
    density: 300,
  })
    .rotate()
    .resize(innen, innen, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const tafel = `<svg xmlns="http://www.w3.org/2000/svg" width="${seite}" height="${seite}"><rect width="${seite}" height="${seite}" rx="${rund ? Math.round(seite * 0.22) : 0}" fill="#ffffff"/></svg>`;
  return (
    sharp(Buffer.from(tafel))
      .composite([{ input: bild, gravity: "centre" }])
      // Ohne Rundung ist die Tafel deckend: dann auch ohne Alphakanal (iOS)
      .flatten(rund ? false : { background: "#ffffff" })
      .png()
      .toBuffer()
  );
}

export async function kodiereZeichen(
  daten: Uint8Array,
): Promise<ZeichenDateien> {
  const [klein, gross, apple] = await Promise.all([
    zeichenTafel(daten, 32, true),
    zeichenTafel(daten, 192, true),
    zeichenTafel(daten, 180, false),
  ]);
  return {
    [ZEICHEN_ICO]: alsIco(klein, 32),
    [ZEICHEN_32]: klein,
    [ZEICHEN_192]: gross,
    [ZEICHEN_APPLE]: apple,
  };
}
