// Die Quelle der Fotos (#690): was Cevi OS von einem Fotodienst braucht, ohne dass der Rest des Servers den Dienst kennt. Heute gibt es eine Umsetzung (flickr.ts); die Tests spritzen eine Attrappe ein.
// Ohne Importe aus node:*: app.ts und die Routen kennen nur diese Typen, die Umsetzung hängt server.ts ein (wie beim Wetter).

// Ein Album, wie der Dienst es meldet
export type QuellAlbum = {
  // Kennung beim Dienst (Ziffern)
  id: string;
  titel: string;
  anzahl: number;
  // Erstellt am, ISO-Datum «JJJJ-MM-TT»; leer, wenn der Dienst keines meldet
  datum: string | null;
  // Das Titelbild: nur, wenn der Dienst eines nennt
  titelbild: QuellBild | null;
};

// Ein Bild mit allem, was der Abruf der Datei braucht. «server» und «secret» sind die Teile der Dateiadresse beim Dienst; sie verlassen den Server nie
export type QuellBild = {
  id: string;
  server: string;
  secret: string;
  titel: string;
  // Masse der mittleren Grösse, damit die Seite den Platz freihält, bevor das Bild geladen ist
  breite: number;
  hoehe: number;
  // Stufen, für die der Dienst eine eigene Datei meldet; für die übrigen liefert die Quelle die nächstkleinere
  groessen: readonly Groesse[];
};

// Feste Stufen; ein Client nennt nie eine Pixelzahl oder eine Adresse
export const GROESSEN = ["klein", "mittel", "gross"] as const;
export type Groesse = (typeof GROESSEN)[number];

export type QuellAntwort = {
  body: ReadableStream<Uint8Array>;
  typ: string;
  laenge: number | null;
};

// Wirft QuellFehler; alles andere ist ein Fehler im Code
export interface FotoQuelle {
  alben(konto: string): Promise<QuellAlbum[]>;
  // Das Album und seine Bilder (höchstens MAX_BILDER); fehlt das Album beim Dienst, wirft sie «nicht_gefunden»
  album(
    konto: string,
    albumId: string,
  ): Promise<{ album: QuellAlbum; bilder: QuellBild[] }>;
  // Die Datei eines Bildes in einer Grösse als Strom
  datei(bild: QuellBild, groesse: Groesse): Promise<QuellAntwort>;
}

export type QuellFehlerArt =
  // Das Konto oder Album gibt es beim Dienst nicht (mehr)
  | "nicht_gefunden"
  // Schlüssel oder Token sind ungültig oder abgelaufen: Die Abteilung muss die Einrichtung prüfen
  | "zugang"
  // Zeitlimit, Dienst nicht erreichbar, zu viele Anfragen oder eine Antwort, die nicht passt
  | "nicht_erreichbar";

export class QuellFehler extends Error {
  constructor(
    readonly art: QuellFehlerArt,
    // Nur zum Protokollieren; nie in eine Antwort oder ein Log mit Geheimnissen
    readonly code?: string,
  ) {
    super(art);
    this.name = "QuellFehler";
  }
}

// Höchstens so viele Bilder eines Albums (vier Seiten zu 500 beim Dienst); mehr zeigt die Website nicht
export const MAX_BILDER = 2000;
// Die Kennungen sind Ziffern; alles andere ist nie eine Kennung des Dienstes
export const istKennung = (s: string) => /^[0-9]{1,20}$/.test(s);
export const istKonto = (s: string) => /^[0-9]{1,20}@N[0-9]{2}$/.test(s);
