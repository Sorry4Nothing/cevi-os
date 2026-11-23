// Favicon der Website (#558): das Zeichen der Abteilung als Tab-Symbol, Lesezeichen und Symbol auf dem Startbildschirm.
// Der Abgleich schreibt die Dateien neben die Seiten (statisch, CSP bleibt 'self'); erzeugt werden sie aus einem quadratischen Bild der Medienbibliothek (abteilung.website_zeichen_medium_id) oder, ohne Wahl, aus dem Cevi-Zeichen der Plattform (bild-sharp.ts, kodiereZeichen).
// Jedes Symbol steht auf einer weissen Tafel: So bleibt es im hellen und im dunklen Browser lesbar, ohne zweite Fassung.

// Grössen: 32 px für den Tab (auch als favicon.ico, das Browser ohne Link-Eintrag und alte Programme an der Wurzel suchen), 192 px für Lesezeichen und den Startbildschirm von Android, 180 px ohne Transparenz für iOS
export const ZEICHEN_ICO = "favicon.ico";
export const ZEICHEN_32 = "website/zeichen-32.png";
export const ZEICHEN_192 = "website/zeichen-192.png";
export const ZEICHEN_APPLE = "apple-touch-icon.png";
export const ZEICHEN_DATEIEN = [
  ZEICHEN_ICO,
  ZEICHEN_32,
  ZEICHEN_192,
  ZEICHEN_APPLE,
] as const;

export type ZeichenDateien = Record<
  (typeof ZEICHEN_DATEIEN)[number],
  Uint8Array
>;

// Ein ICO mit genau einem Bild: Seit Windows Vista darf der Eintrag ein PNG sein. Kopf (6 Bytes), ein Verzeichniseintrag (16 Bytes), dann das PNG
export function alsIco(png: Uint8Array, seite: number): Uint8Array {
  const kopf = new DataView(new ArrayBuffer(22));
  kopf.setUint16(2, 1, true); // Art: Symbol
  kopf.setUint16(4, 1, true); // ein Bild
  kopf.setUint8(6, seite);
  kopf.setUint8(7, seite);
  kopf.setUint16(10, 1, true); // Farbebenen
  kopf.setUint16(12, 32, true); // Bits je Pixel
  kopf.setUint32(14, png.byteLength, true);
  kopf.setUint32(18, 22, true); // Beginn des Bildes
  const ico = new Uint8Array(22 + png.byteLength);
  ico.set(new Uint8Array(kopf.buffer), 0);
  ico.set(png, 22);
  return ico;
}

// Einträge für den <head> jeder Seite. «version» ändert sich mit dem Bild (Teil eines Hashes, nur Hex): Browser merken sich Favicons lange
export const zeichenLinks = (version: string) => `
<link rel="icon" type="image/png" sizes="32x32" href="/${ZEICHEN_32}?v=${version}">
<link rel="icon" type="image/png" sizes="192x192" href="/${ZEICHEN_192}?v=${version}">
<link rel="apple-touch-icon" href="/${ZEICHEN_APPLE}?v=${version}">`;
