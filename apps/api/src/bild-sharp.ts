import sharp from "sharp";
import type { BildKodierer } from "./bild.js";
import type { MedienKodierer } from "./medien.js";

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
