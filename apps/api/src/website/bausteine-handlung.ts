import { z } from "zod";
import type { baustein, kurztext, link } from "./bausteine.js";

// Bausteine «Einstieg und Handlung» (#743): Kopfbereich, Inhaltsverzeichnis, Weiterführende Links, Kontaktleiste, Weitersagen, Seitenwechsel, Brotkrumen.
// Die Schemas entstehen in einer Funktion, die bausteine.ts mit ihren Bausteinen aufruft: So hängen beide Dateien nicht im Kreis aneinander (bausteine.ts hängt die Liste nur an).
// Obergrenzen schützen Speicher, Renderer und Editor. Der Renderer steht in handlung.ts.

export const HANDLUNG_TYPEN = [
  "kopfbereich",
  "inhaltsverzeichnis",
  "weiterfuehrend",
  "kontaktleiste",
  "weitersagen",
  "seitenwechsel",
  "brotkrumen",
] as const;

export const MAX_KOPF_TITEL = 120;
export const MAX_KOPF_UNTERTITEL = 300;
export const MAX_KOPF_SCHALTFLAECHEN = 2;
export const MAX_VERZEICHNIS_TITEL = 60;
export const MAX_WEITERFUEHREND = 6;
export const MAX_WEITERFUEHREND_TITEL = 100;
export const MAX_WEITERFUEHREND_TEXT = 200;
export const MAX_LEISTE_TITEL = 60;
export const MAX_WEITERSAGEN_BESCHRIFTUNG = 60;
export const MAX_WEITERSAGEN_NACHRICHT = 300;
export const KONTAKT_FELDER = ["telefon", "email", "adresse"] as const;

export type Hilfen = {
  baustein: typeof baustein;
  kurztext: typeof kurztext;
  link: typeof link;
  linkAlle: ReturnType<typeof link>;
};

export function handlungSchemas({
  baustein,
  kurztext,
  link,
  linkAlle,
}: Hilfen) {
  const knopf = z.strictObject({
    beschriftung: kurztext(60),
    ziel: linkAlle,
  });
  return [
    // Grosses Bild mit blauem Kasten (Titel, Untertitel, Schaltflächen); ohne Bild ein blaues Band. Das Bild trägt den Alt-Text des Mediums
    baustein(
      "kopfbereich",
      z.strictObject({
        titel: kurztext(MAX_KOPF_TITEL),
        untertitel: kurztext(MAX_KOPF_UNTERTITEL).optional(),
        bild: z.uuid().optional(),
        schaltflaechen: z.array(knopf).max(MAX_KOPF_SCHALTFLAECHEN).optional(),
      }),
    ),
    // «Auf dieser Seite»: die Links entstehen aus den Überschriften der Ebene 2 der Seite, der Baustein hat keine eigenen Einträge
    baustein(
      "inhaltsverzeichnis",
      z.strictObject({
        titel: kurztext(MAX_VERZEICHNIS_TITEL).optional(),
        darstellung: z.enum(["liste", "knoepfe"]),
      }),
    ),
    // Ganze Karten oder Zeilen mit Pfeil zu anderen Seiten der Website oder zu fremden Adressen
    baustein(
      "weiterfuehrend",
      z.strictObject({
        darstellung: z.enum(["karten", "liste"]),
        eintraege: z
          .array(
            z.strictObject({
              titel: kurztext(MAX_WEITERFUEHREND_TITEL),
              text: kurztext(MAX_WEITERFUEHREND_TEXT).optional(),
              ziel: link("https", "seite"),
            }),
          )
          .min(1)
          .max(MAX_WEITERFUEHREND),
      }),
    ),
    // Telefon, E-Mail und Anschrift der Abteilung: die Werte kommen aus der Konfiguration des Servers (wie im Fuss), nie aus dem Dokument
    baustein(
      "kontaktleiste",
      z.strictObject({
        titel: kurztext(MAX_LEISTE_TITEL).optional(),
        felder: z
          .array(z.enum(KONTAKT_FELDER))
          .min(1)
          .max(KONTAKT_FELDER.length)
          .refine((f) => new Set(f).size === f.length),
      }),
    ),
    // Ein Link «Per E-Mail weitersagen» als mailto: mit Titel und Adresse der Seite; kein Dienst von aussen
    baustein(
      "weitersagen",
      z.strictObject({
        beschriftung: kurztext(MAX_WEITERSAGEN_BESCHRIFTUNG).optional(),
        nachricht: kurztext(MAX_WEITERSAGEN_NACHRICHT).optional(),
      }),
    ),
    // «Vorherige» und «Nächste Seite» aus dem Menübaum; ohne eigene Daten
    baustein("seitenwechsel", z.strictObject({})),
    // «Du bist hier» aus dem Menübaum; ohne eigene Daten
    baustein("brotkrumen", z.strictObject({})),
  ] as const;
}
