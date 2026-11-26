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

// Ein Bild mit allem, was der Abruf der Datei braucht. «server» und die Secrets sind die Teile der Dateiadresse beim Dienst; sie verlassen den Server nie
export type QuellBild = {
  id: string;
  server: string;
  secret: string;
  titel: string;
  // Seitenverhältnis (Masse einer kleinen Grösse), damit die Seite den Platz freihält, bevor das Bild geladen ist
  breite: number;
  hoehe: number;
  // Nur die Grössen, die der Dienst für dieses Bild meldet (#867); für eine fehlende liefert die Quelle die nächstkleinere. Leer beim Titelbild eines Albums: Dort gilt das Secret des Bildes bis 1024
  groessen: Partial<Record<Groesse, QuellDatei>>;
};

// Eine Datei des Dienstes: Ab 1600 und beim Original hat jede Grösse ihr eigenes Secret
export type QuellDatei = {
  secret: string;
  breite: number;
  hoehe: number;
  endung: "jpg" | "png" | "gif";
};

// Feste Stufen nach der langen Seite in Pixeln, wie Flickr sie anbietet (#867), klein nach gross; «original» ist die hochgeladene Datei. Ein Client nennt nur eine dieser Stufen, nie eine Adresse
export const GROESSEN = [
  "320",
  "400",
  "640",
  "800",
  "1024",
  "1600",
  "2048",
  "3072",
  "4096",
  "5120",
  "6144",
  "original",
] as const;
export type Groesse = (typeof GROESSEN)[number];
// Ab dieser Stufe ist eine Datei gross (mehrere MB): eigene Grenze je Konto, längere Frist
export const istGrosseStufe = (g: Groesse) =>
  GROESSEN.indexOf(g) >= GROESSEN.indexOf("3072");

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
