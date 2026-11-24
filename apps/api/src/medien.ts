// Grenzen und Typprüfung der Medien (#335); nur Bilder, Dateien zum Herunterladen sind Links (#428); ohne node:*-Importe, die Routen importiert die App
export const MEDIEN_BILD_MAX_BYTES = 10 * 1024 * 1024;

// Ergebnis des Verkleinerns; die Umsetzung mit sharp steht in bild-sharp.ts
export type MedienKodierer = (daten: Uint8Array) => Promise<{
  inhalt: Uint8Array;
  typ: "image/webp";
  breite: number;
  hoehe: number;
}>;
