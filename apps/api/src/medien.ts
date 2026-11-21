// Grenzen und Typprüfung der Medien (#335); ohne node:*-Importe, die Routen importiert die App
export const MEDIEN_BILD_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIEN_PDF_MAX_BYTES = 20 * 1024 * 1024;

// Ergebnis des Verkleinerns; die Umsetzung mit sharp steht in bild-sharp.ts
export type MedienKodierer = (daten: Uint8Array) => Promise<{
  inhalt: Uint8Array;
  typ: "image/webp";
  breite: number;
  hoehe: number;
}>;

// «%PDF-» am Anfang der Datei; Dateiendung und Content-Type zählen nie
export const istPdf = (b: Uint8Array) =>
  [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, i) => b[i] === byte);
