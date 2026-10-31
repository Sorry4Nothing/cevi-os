import sharp from "sharp";
import type { BildKodierer } from "./bild.js";

// Ohne Zwischenspeicher: Es kommen wenige, einmalige Bilder, und der Speicher soll nach der Anfrage frei sein
sharp.cache(false);

const SEITE = 256;
// Schutz vor Dekompressionsbomben: Ein 5-MB-PNG kann Milliarden Pixel enthalten. 50 Mio. Pixel decken jede Handykamera ab
const MAX_PIXEL = 50_000_000;

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
