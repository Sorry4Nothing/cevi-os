import {
  QuellFehler,
  type FotoQuelle,
  type QuellAlbum,
  type QuellBild,
} from "./quelle.js";

// Zwischenspeicher vor der Quelle (#690): Flickr bremst nach 3600 Abrufen je Stunde und Schlüssel, und jeder Abruf dauert. Darum merkt sich der Server Albumlisten und Alben im Speicher.
// Gilt für Menschen mit Zugriff gleich (die Quelle liefert nie etwas, das von der Person abhängt); die Sichtbarkeit prüft die Route danach. Nach einem Neustart ist er leer.
// - Treffer bis zur Frist (Vorgabe 10 Minuten); gleichzeitige Anfragen teilen sich einen Abruf (kein Ansturm bei kaltem Speicher)
// - Ein Fehler wird nicht gespeichert, ausser kurz (30 s), damit eine kaputte Einrichtung Flickr nicht mit Wiederholungen überrollt
// - Höchstens MAX_EINTRAEGE Einträge; der älteste fliegt zuerst hinaus

export const FRIST_MS = 10 * 60 * 1000;
export const FEHLER_FRIST_MS = 30 * 1000;
const MAX_EINTRAEGE = 200;

type Eintrag<T> = { bis: number; wert: Promise<T> };

export type Album = { album: QuellAlbum; bilder: QuellBild[] };

export type Zwischenspeicher = {
  alben: (konto: string) => Promise<QuellAlbum[]>;
  album: (konto: string, albumId: string) => Promise<Album>;
  // Die Datei geht nie durch den Speicher: Sie fliesst als Strom von der Quelle zur Person
  datei: FotoQuelle["datei"];
  // Vergisst alles (nach «Verbindung testen» und wenn die Abteilung das Konto wechselt)
  leere: () => void;
};

export function erstelleZwischenspeicher(
  quelle: FotoQuelle,
  {
    frist = FRIST_MS,
    jetzt = Date.now,
  }: { frist?: number; jetzt?: () => number } = {},
): Zwischenspeicher {
  const speicher = new Map<string, Eintrag<unknown>>();

  function mit<T>(schluessel: string, hole: () => Promise<T>): Promise<T> {
    const e = speicher.get(schluessel) as Eintrag<T> | undefined;
    if (e && e.bis > jetzt()) return e.wert;
    speicher.delete(schluessel);
    const wert = hole();
    const eintrag: Eintrag<T> = { bis: jetzt() + frist, wert };
    // Ein Fehler bleibt nur kurz stehen
    wert.catch((f) => {
      if (speicher.get(schluessel) === eintrag) {
        // Nicht gefunden gilt wie ein Treffer (das Album gibt es nicht); sonst nur kurz
        eintrag.bis =
          f instanceof QuellFehler && f.art === "nicht_gefunden"
            ? jetzt() + frist
            : jetzt() + FEHLER_FRIST_MS;
      }
    });
    speicher.set(schluessel, eintrag);
    while (speicher.size > MAX_EINTRAEGE) {
      const aeltester = speicher.keys().next().value;
      if (aeltester === undefined) break;
      speicher.delete(aeltester);
    }
    return wert;
  }

  return {
    alben: (konto) => mit(`a:${konto}`, () => quelle.alben(konto)),
    album: (konto, albumId) =>
      mit(`b:${konto}:${albumId}`, () => quelle.album(konto, albumId)),
    datei: (bild, groesse) => quelle.datei(bild, groesse),
    leere: () => speicher.clear(),
  };
}
