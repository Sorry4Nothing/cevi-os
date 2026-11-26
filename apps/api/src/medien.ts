// Grenzen und Typprüfung der Medien (#335); nur Bilder, Dateien zum Herunterladen sind Links (#428); ohne node:*-Importe, die Routen importiert die App
import type { Ausschnitt } from "./medien-abgleich.js";

// 25 MB (#868): Ein Foto mit 24 MP in hoher Qualität hat 10 bis 20 MB
export const MEDIEN_BILD_MAX_BYTES = 25 * 1024 * 1024;

// Ergebnis des Verkleinerns; die Umsetzung mit sharp steht in bild-sharp.ts
// ausschnitt: nur dieser Teil des Bildes, als Anteil nach der EXIF-Drehung (Ersatz aus Flickr, #868); die Route schneidet nie zu
export type MedienKodierer = (
  daten: Uint8Array,
  ausschnitt?: Ausschnitt,
) => Promise<{
  inhalt: Uint8Array;
  typ: "image/webp";
  breite: number;
  hoehe: number;
  // Kleinere Fassungen für srcset (#868), aufsteigend; leer, wenn das Bild schmaler ist als die kleinste
  varianten: { breite: number; inhalt: Uint8Array }[];
}>;

// Schlüssel einer Variante im Speicher: abgeleitet vom Schlüssel des Bildes, nie aus einer Eingabe
export const variantenSchluessel = (schluessel: string, breite: number) =>
  `${schluessel}-w${breite}`;

// Nur der Typ: Die Umsetzung steht in medien-speicher-sdk.ts
type Speicher = {
  ablegen(
    inhalt: Uint8Array,
    typ: string,
    schluessel?: string,
  ): Promise<string>;
  loeschen(schluessel: string): Promise<void>;
};

// Löscht Bild und Varianten; gibt die Schlüssel zurück, die stehen blieben (Waisen ohne Zeile, die keine Route ausliefert)
export async function entferneBild(
  speicher: Speicher,
  schluessel: string,
  varianten: readonly number[],
): Promise<string[]> {
  const alle = [
    schluessel,
    ...varianten.map((b) => variantenSchluessel(schluessel, b)),
  ];
  const e = await Promise.allSettled(alle.map((s) => speicher.loeschen(s)));
  return alle.filter((_, i) => e[i]!.status === "rejected");
}

// Legt Bild und Varianten ab und gibt den Schlüssel des Bildes zurück. Scheitert eine Datei, räumt es die übrigen weg und wirft
export async function legeBildAb(
  speicher: Speicher,
  bild: Awaited<ReturnType<MedienKodierer>>,
): Promise<string> {
  const schluessel = await speicher.ablegen(bild.inhalt, bild.typ);
  try {
    for (const v of bild.varianten) {
      await speicher.ablegen(
        v.inhalt,
        bild.typ,
        variantenSchluessel(schluessel, v.breite),
      );
    }
  } catch (fehler) {
    await entferneBild(
      speicher,
      schluessel,
      bild.varianten.map((v) => v.breite),
    );
    throw fehler;
  }
  return schluessel;
}
