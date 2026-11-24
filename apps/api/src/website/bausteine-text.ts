import { z } from "zod";
import {
  baustein,
  kurztext,
  linkAlle,
  mediumId,
  sauber,
  textBlock,
  type TextBlock,
} from "./bausteine-basis.js";
import type { Baustein } from "./bausteine.js";

// Bausteine «Text und Gestaltung» (#741): Hinweisbox, Zitat, Fragen und Antworten, zwei Spalten, Bild neben Text, Tabelle, Schritte und Checkliste.
// Je ein strenges Schema, kein HTML, kein Skript. Der Alt-Text liegt am Medium wie bei jedem Baustein. Renderer: bausteine-text-rendern.ts, Stil: Abschnitt «Text und Gestaltung» in public/website/website.css.

// Obergrenzen (shortcut: Werte geschätzt, bei Bedarf anheben; sie schützen Speicher, Renderer und den Editor)
export const MAX_HINWEISBOX_ZEICHEN = 1000;
export const MAX_ZITAT = 400;
export const MAX_FRAGEN = 30;
export const MAX_FRAGE = 200;
export const MAX_ANTWORT_ZEICHEN = 3000;
export const MAX_SPALTE_ZEICHEN = 5000;
export const MAX_BILDNEBEN_ZEICHEN = 3000;
export const MAX_TABELLE_SPALTEN = 6;
export const MAX_TABELLE_ZEILEN = 40;
export const MAX_ZELLE = 120;
export const MAX_SCHRITTE = 12;
export const MAX_SCHRITT_TEXT = 500;
export const MAX_CHECKLISTE = 40;
export const MAX_CHECKPUNKT = 200;
// Textblöcke je Feld: ein Kasten oder eine Antwort ist kurz, ein Absatz mit einer Liste genügt fast immer
const MAX_BLOECKE = 12;

export const HINWEIS_ARTEN = ["info", "tipp", "wichtig", "achtung"] as const;
export const CHECK_DARSTELLUNGEN = ["haken", "kaestchen"] as const;
export const BILD_SEITEN = ["links", "rechts"] as const;

export const zeichenImText = (bloecke: TextBlock[]): number =>
  bloecke.reduce(
    (summe, b) =>
      summe +
      (b.typ === "absatz" ? [b.inhalt] : b.eintraege)
        .flat()
        .reduce((n, a) => n + a.text.length, 0),
    0,
  );

// Text mit Fett, Kursiv, Listen und Links, aber kürzer als der Baustein «text»
const kurzerText = (maxZeichen: number) =>
  z
    .array(textBlock)
    .min(1)
    .max(MAX_BLOECKE)
    .refine((bloecke) => zeichenImText(bloecke) <= maxZeichen);

// Eine Zelle darf leer sein (eine Preisliste hat Lücken); Steuerzeichen nie
const zelle = z.string().trim().max(MAX_ZELLE).refine(sauber);

export const textBausteine = [
  // Hinweisbox: ein Kasten mitten im Text. Das Wort der Art («Wichtig») steht immer im Kasten, die Farbe ist nur Zugabe
  baustein(
    "hinweisbox",
    z.strictObject({
      art: z.enum(HINWEIS_ARTEN),
      titel: kurztext(100).optional(),
      inhalt: kurzerText(MAX_HINWEISBOX_ZEICHEN),
    }),
  ),
  // Zitat: Name und Funktion der Person sind Angaben der Seite; das Foto kommt aus der Medienbibliothek
  baustein(
    "zitat",
    z.strictObject({
      text: kurztext(MAX_ZITAT),
      person: kurztext(100).optional(),
      funktion: kurztext(100).optional(),
      bild: mediumId.optional(),
    }),
  ),
  // Aufklappliste mit dem Element «details»: ohne Skript, mit Tastatur
  baustein(
    "fragen",
    z.strictObject({
      eintraege: z
        .array(
          z.strictObject({
            frage: kurztext(MAX_FRAGE),
            antwort: kurzerText(MAX_ANTWORT_ZEICHEN),
          }),
        )
        .min(1)
        .max(MAX_FRAGEN),
    }),
  ),
  baustein(
    "spalten",
    z.strictObject({
      links: z.strictObject({
        titel: kurztext(100).optional(),
        inhalt: kurzerText(MAX_SPALTE_ZEICHEN),
      }),
      rechts: z.strictObject({
        titel: kurztext(100).optional(),
        inhalt: kurzerText(MAX_SPALTE_ZEICHEN),
      }),
    }),
  ),
  baustein(
    "bildneben",
    z.strictObject({
      mediumId,
      seite: z.enum(BILD_SEITEN),
      titel: kurztext(100).optional(),
      inhalt: kurzerText(MAX_BILDNEBEN_ZEICHEN),
      link: z
        .strictObject({ beschriftung: kurztext(60), ziel: linkAlle })
        .optional(),
    }),
  ),
  // Tabelle: eine Kopfzeile und gleich lange Zeilen. zeilenkopf: die erste Spalte ist die Überschrift ihrer Zeile (Wochentag, Artikel)
  baustein(
    "tabelle",
    z
      .strictObject({
        beschriftung: kurztext(100).optional(),
        kopf: z.array(kurztext(60)).min(2).max(MAX_TABELLE_SPALTEN),
        zeilen: z
          .array(z.array(zelle).min(2).max(MAX_TABELLE_SPALTEN))
          .min(1)
          .max(MAX_TABELLE_ZEILEN),
        zeilenkopf: z.boolean().default(false),
      })
      .superRefine((d, ctx) => {
        d.zeilen.forEach((zeile, i) => {
          if (zeile.length !== d.kopf.length) {
            ctx.addIssue({
              code: "custom",
              path: ["zeilen", i],
              message: "falsche Zahl Spalten",
            });
          }
        });
      }),
  ),
  // Schritte: eine nummerierte Abfolge; ein Schritt kann auf eine Seite oder Adresse führen (beschriftung und ziel gehören zusammen)
  baustein(
    "schritte",
    z.strictObject({
      eintraege: z
        .array(
          z
            .strictObject({
              titel: kurztext(100),
              text: kurztext(MAX_SCHRITT_TEXT).optional(),
              beschriftung: kurztext(60).optional(),
              ziel: linkAlle.optional(),
            })
            .refine(
              (e) => (e.beschriftung === undefined) === (e.ziel === undefined),
            ),
        )
        .min(1)
        .max(MAX_SCHRITTE),
    }),
  ),
  baustein(
    "checkliste",
    z.strictObject({
      titel: kurztext(100).optional(),
      darstellung: z.enum(CHECK_DARSTELLUNGEN),
      eintraege: z
        .array(z.strictObject({ text: kurztext(MAX_CHECKPUNKT) }))
        .min(1)
        .max(MAX_CHECKLISTE),
    }),
  ),
] as const;

export type TextBausteinSchema = (typeof textBausteine)[number];

// Verweise eines dieser Bausteine für die Verweisprüfung: Bilder der Medienbibliothek und Seiten, auf die Links zeigen (dokument.ts, sammleVerweise)
export function textVerweise(
  b: Baustein,
  medien: Set<string>,
  ziel: (link: string | undefined) => void,
): void {
  const text = (bloecke: TextBlock[]) => {
    for (const block of bloecke) {
      const listen = block.typ === "absatz" ? [block.inhalt] : block.eintraege;
      listen.flat().forEach((a) => ziel(a.link));
    }
  };
  switch (b.typ) {
    case "hinweisbox":
      text(b.daten.inhalt);
      break;
    case "zitat":
      if (b.daten.bild) medien.add(b.daten.bild);
      break;
    case "fragen":
      b.daten.eintraege.forEach((e) => text(e.antwort));
      break;
    case "spalten":
      text(b.daten.links.inhalt);
      text(b.daten.rechts.inhalt);
      break;
    case "bildneben":
      medien.add(b.daten.mediumId);
      text(b.daten.inhalt);
      ziel(b.daten.link?.ziel);
      break;
    case "schritte":
      b.daten.eintraege.forEach((e) => ziel(e.ziel));
      break;
    default:
      break;
  }
}
