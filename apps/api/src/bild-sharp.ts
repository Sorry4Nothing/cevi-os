import sharp, { type OutputInfo } from "sharp";
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

// Medienbilder in Originalqualität bis 4K (#868): Ein Kopfbild über die ganze Breite eines 4K-Bildschirms braucht 3840 px. Ein Foto mit 24 MP (6000 × 4000) und ein Original von Flickr (bis rund 6700 × 4500, 30 MP) gehen durch; beim Dekodieren kostet das höchstens rund 160 MB (4 Bytes je Pixel). Mehr ist eine Dekompressionsbombe
export const MEDIEN_SEITE = 4096;
export const MEDIEN_MAX_PIXEL = 40_000_000;
// Breiten der Varianten für srcset; nie hochskaliert: Nur, was kleiner ist als das Bild selbst, entsteht. Das Bild selbst ist die grösste Fassung
export const MEDIEN_BREITEN = [640, 1280, 1920, 2560, 3840] as const;
// smartSubsample hält feine Farbkanten (Schrift, Logos) scharf; das kostet wenige Prozent Grösse
const MEDIEN_WEBP = { quality: 85, smartSubsample: true } as const;

type Roh = { data: Buffer; info: OutputInfo };
const ausRoh = ({ data, info }: Roh) =>
  sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });

// Einmal dekodiert, dann je Breite verkleinert: Die Varianten entstehen aus den Pixeln, nicht aus der schon kodierten Datei. Gleichzeitig kodiert: Ein Foto mit 24 MP braucht so rund halb so lange
const varianten = (roh: Roh) =>
  Promise.all(
    MEDIEN_BREITEN.filter((b) => b < roh.info.width).map(async (breite) => ({
      breite,
      inhalt: await ausRoh(roh)
        .resize({ width: breite })
        .webp(MEDIEN_WEBP)
        .toBuffer(),
    })),
  );

const dekodiere = (daten: Uint8Array) =>
  sharp(daten, {
    limitInputPixels: MEDIEN_MAX_PIXEL,
    failOn: "error",
  }).rotate();

// Medienbild: Seitenverhältnis und Transparenz bleiben, längste Seite höchstens 4096 px, ohne EXIF, ICC und Ortsdaten; immer WebP (kleiner als JPEG und PNG, mit Transparenz, in allen aktuellen Browsern und Apps lesbar). Breite und Höhe stammen vom Ergebnis, nach der Drehung. Dazu die Varianten für srcset
export const kodiereMedienbild: MedienKodierer = async (daten, ausschnitt) => {
  let bild = dekodiere(daten);
  if (ausschnitt) {
    // Masse nach der Drehung: Ab Orientierung 5 sind Breite und Höhe vertauscht
    const m = await sharp(daten).metadata();
    const [b, h] =
      (m.orientation ?? 1) >= 5 ? [m.height, m.width] : [m.width, m.height];
    const left = Math.round(ausschnitt.x * b);
    const top = Math.round(ausschnitt.y * h);
    bild = bild.extract({
      left,
      top,
      width: Math.min(b - left, Math.round(ausschnitt.b * b)),
      height: Math.min(h - top, Math.round(ausschnitt.h * h)),
    });
  }
  const roh = await bild
    .resize(MEDIEN_SEITE, MEDIEN_SEITE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [inhalt, liste] = await Promise.all([
    ausRoh(roh).webp(MEDIEN_WEBP).toBuffer(),
    varianten(roh),
  ]);
  return {
    inhalt,
    typ: "image/webp",
    breite: roh.info.width,
    hoehe: roh.info.height,
    varianten: liste,
  };
};

// Nur die Varianten eines schon gespeicherten Medienbilds (Bestand vor #868); das Bild selbst bleibt, wie es ist
export async function kodiereVarianten(daten: Uint8Array) {
  return varianten(
    await dekodiere(daten).raw().toBuffer({ resolveWithObject: true }),
  );
}

// Favicon (#558): das Zeichen mittig auf einer weissen Tafel, damit es im hellen und im dunklen Browser lesbar ist. Das Seitenverhältnis bleibt, ein Rand bleibt frei.
// «rund» sind die Ecken für Tab und Lesezeichen; iOS schneidet sein Symbol selbst zu und will keine Transparenz
async function zeichenTafel(daten: Uint8Array, seite: number, rund: boolean) {
  const innen = Math.round(seite * 0.8);
  const bild = await sharp(daten, {
    // Die Quelle ist ein Medienbild (bis 4096 × 4096, #868)
    limitInputPixels: MEDIEN_MAX_PIXEL,
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
