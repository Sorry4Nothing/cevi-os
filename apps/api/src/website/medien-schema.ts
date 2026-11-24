import { z } from "zod";
import { LINK_MAX, pruefeLink } from "../link-pruefung.js";
import type {
  Baustein,
  baustein,
  bildEintrag,
  kurztext,
  link,
  linkAlle,
  mediumId,
} from "./bausteine.js";

// Bausteine für Bilder und Medien (#742): Bildraster, Bild mit Text, Bildvergleich, Logo-Reihe, breites Bild, Bildstreifen, Bilderpaket.
// Wie der übrige Katalog: strenge Schemas ohne HTML, der Alt-Text liegt am Medium, nie am Baustein; die Verweisprüfung steht in verweise.ts, der Renderer in medien-bausteine.ts.
// Die Hilfen kommen von bausteine.ts, das diese Datei einbindet: Sie werden übergeben, nicht importiert, damit zwischen den Dateien kein Kreis entsteht.

// Obergrenzen (shortcut: geschätzt, bei Bedarf anheben; sie schützen Speicher, Renderer und Editor)
export const MIN_BILDRASTER = 2;
export const MAX_BILDRASTER = 24;
export const MIN_STREIFEN = 3;
export const MAX_STREIFEN = 30;
export const MAX_LOGOS = 24;
export const MAX_PAKET_ANZAHL = 100_000;
export const MAX_VERGLEICH_TEXT = 30;
export const MAX_PAKET_TYP = 20;

export const RASTER_SPALTEN = [2, 3, 4] as const;
export const RASTER_FORMATE = ["quer", "quadrat", "hoch"] as const;
export const TEXT_POSITIONEN = ["unten", "mitte"] as const;
export const LOGO_DARSTELLUNGEN = ["farbig", "grau"] as const;
export const PANORAMA_HOEHEN = ["niedrig", "mittel", "hoch"] as const;
export const FOKUS_X = ["links", "mitte", "rechts"] as const;
export const FOKUS_Y = ["oben", "mitte", "unten"] as const;

export const MEDIEN_TYPEN = [
  "bildraster",
  "bildtext",
  "bildvergleich",
  "logoreihe",
  "panorama",
  "bildstreifen",
  "bilderpaket",
] as const;

// In diesen Bausteinen trägt jedes Bild den Inhalt: Ohne Alt-Text am Medium ist es ungültig (WCAG 1.1.1). Beim Logo ist er der Name der Organisation und der Name des Links
export const ALT_PFLICHT: ReadonlySet<string> = new Set([
  "karussell",
  "bildvergleich",
  "logoreihe",
]);

type Hilfen = {
  baustein: typeof baustein;
  kurztext: typeof kurztext;
  link: typeof link;
  linkAlle: typeof linkAlle;
  mediumId: typeof mediumId;
  bildEintrag: typeof bildEintrag;
};

export function medienBausteine(h: Hilfen) {
  const { baustein, kurztext, link, linkAlle, mediumId, bildEintrag } = h;
  return [
    // Bilder in einheitlichem Format, 2 bis 4 Spalten; jedes Bild öffnet sich gross (lichtkasten.js)
    baustein(
      "bildraster",
      z.strictObject({
        spalten: z.union([z.literal(2), z.literal(3), z.literal(4)]),
        format: z.enum(RASTER_FORMATE),
        bilder: z.array(bildEintrag).min(MIN_BILDRASTER).max(MAX_BILDRASTER),
      }),
    ),
    // Titel und Text auf dem Bild; ein Verlauf sichert den Kontrast. Der Link ist freiwillig
    baustein(
      "bildtext",
      z.strictObject({
        mediumId,
        titel: kurztext(100),
        text: kurztext(500).optional(),
        position: z.enum(TEXT_POSITIONEN).optional(),
        link: z
          .strictObject({ beschriftung: kurztext(60), ziel: linkAlle })
          .optional(),
      }),
    ),
    // Zwei Bilder desselben Ortes: das erste ist «Vorher», das zweite «Nachher». Die Bezeichnungen lassen sich ändern («Früher», «Heute»)
    baustein(
      "bildvergleich",
      z.strictObject({
        bilder: z.array(z.strictObject({ mediumId })).length(2),
        vorherText: kurztext(MAX_VERGLEICH_TEXT).optional(),
        nachherText: kurztext(MAX_VERGLEICH_TEXT).optional(),
        unterschrift: kurztext(300).optional(),
      }),
    ),
    // Logos von Partnern, Sponsoren und Dachverbänden: Name am Medium (Alt-Text, Pflicht), Link freiwillig
    baustein(
      "logoreihe",
      z.strictObject({
        darstellung: z.enum(LOGO_DARSTELLUNGEN),
        bilder: z
          .array(
            z.strictObject({
              mediumId,
              link: link("https", "seite").optional(),
            }),
          )
          .min(1)
          .max(MAX_LOGOS),
      }),
    ),
    // Ein breites Bild mit begrenzter Höhe; der Fokus bestimmt, welcher Ausschnitt bleibt
    baustein(
      "panorama",
      z.strictObject({
        mediumId,
        unterschrift: kurztext(300).optional(),
        hoehe: z.enum(PANORAMA_HOEHEN),
        fokusX: z.enum(FOKUS_X).optional(),
        fokusY: z.enum(FOKUS_Y).optional(),
      }),
    ),
    // Ein Band mit vielen Bildern zum Scrollen; es bewegt sich nie von selbst
    baustein(
      "bildstreifen",
      z.strictObject({
        bilder: z.array(bildEintrag).min(MIN_STREIFEN).max(MAX_STREIFEN),
      }),
    ),
    // Fotos zum Herunterladen: Vorschaubild aus dem Medienspeicher, die Dateien selbst im SharePoint (wie «datei»: nur ein Link)
    baustein(
      "bilderpaket",
      z.strictObject({
        titel: kurztext(100),
        text: kurztext(500).optional(),
        link: z
          .string()
          .max(LINK_MAX)
          .refine((s) => pruefeLink(s).ok),
        bild: mediumId.optional(),
        typ: kurztext(MAX_PAKET_TYP).optional(),
        anzahl: z.number().int().min(1).max(MAX_PAKET_ANZAHL).optional(),
        groesse: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      }),
    ),
  ] as const;
}

// Die Medien und Seiten, auf die ein Baustein dieser Gruppe verweist (für sammleVerweise in dokument.ts); andere Bausteine tragen nichts bei
export function sammleMedienVerweise(
  b: Baustein,
  medien: Set<string>,
  ziel: (link: string | undefined) => void,
): void {
  switch (b.typ) {
    case "bildraster":
    case "bildstreifen":
    case "bildvergleich":
      b.daten.bilder.forEach((e) => medien.add(e.mediumId));
      break;
    case "logoreihe":
      b.daten.bilder.forEach((e) => {
        medien.add(e.mediumId);
        ziel(e.link);
      });
      break;
    case "bildtext":
      medien.add(b.daten.mediumId);
      ziel(b.daten.link?.ziel);
      break;
    case "panorama":
      medien.add(b.daten.mediumId);
      break;
    case "bilderpaket":
      if (b.daten.bild) medien.add(b.daten.bild);
      break;
    case "videolink":
      if (b.daten.bild) medien.add(b.daten.bild);
      break;
    default:
      break;
  }
}
