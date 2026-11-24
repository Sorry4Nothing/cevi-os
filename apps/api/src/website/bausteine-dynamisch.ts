import { z } from "zod";
import { LINK_MAX, pruefeLink } from "../link-pruefung.js";
import { sichtbarkeitSchema } from "../sichtbarkeit.js";

// Bausteine mit Daten aus Cevi OS (#740): Anlässe, Orte, Zahlen, dazu die Dokumenten-Liste. Eigene Datei, damit der Katalog in bausteine.ts nur um eine Zeile wächst.
// Die Daten stehen nie im Dokument, nur die Auswahl (welcher Anlass, welche Orte): Der Abgleich holt sie beim Erzeugen der Seite (dynamisch-daten.ts), Besucher lösen nie eine Abfrage aus.
// Keine Freitexte mit Adressen ausser dem Dateilink; alles andere kommt aus der Datenbank und wird beim Ausgeben maskiert.

export const MAX_ANLASS_ANZAHL = 12;
export const MAX_TREFFPUNKTE = 12;
export const MAX_DOKUMENTE = 30;
export const KENNZAHL_ARTEN = ["stufen", "leitende", "anlaesse"] as const;
export const ANLASS_ARTEN = ["anlass", "lager"] as const;

const STEUERZEICHEN = /\p{Cc}/u;
const kurztext = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !STEUERZEICHEN.test(s));

// Wie baustein() in bausteine.ts (id, typ, daten, sichtbarkeit); hier nachgebaut, weil bausteine.ts diese Datei einbindet
function baustein<T extends string, D extends z.ZodType>(typ: T, daten: D) {
  return z.strictObject({
    id: z.uuid(),
    typ: z.literal(typ),
    daten,
    sichtbarkeit: z
      .union([z.literal("erbt"), sichtbarkeitSchema])
      .default("erbt"),
  });
}

const anlassArt = z.enum(ANLASS_ARTEN);
const einzigartig = (a: readonly unknown[]) => new Set(a).size === a.length;

export const dynamischeBausteine = [
  // Eine Karte für den nächsten öffentlichen Anlass oder für einen bestimmten (anlassId geht vor art)
  baustein(
    "naechsterAnlass",
    z.strictObject({
      anlassId: z.uuid().optional(),
      art: anlassArt.optional(),
    }),
  ),
  baustein(
    "anlaesse",
    z.strictObject({
      anzahl: z.number().int().min(1).max(MAX_ANLASS_ANZAHL),
      art: anlassArt.optional(),
    }),
  ),
  // Kosten und Hinweis sind Angaben der Seite, alles andere kommt vom Anlass
  baustein(
    "lagerkarte",
    z.strictObject({
      anlassId: z.uuid(),
      kosten: kurztext(60).optional(),
      hinweis: kurztext(200).optional(),
    }),
  ),
  baustein(
    "countdown",
    z.strictObject({
      anlassId: z.uuid().optional(),
      bis: z.enum(["beginn", "frist"]).default("beginn"),
    }),
  ),
  baustein(
    "treffpunkte",
    z.strictObject({
      ortIds: z.array(z.uuid()).min(1).max(MAX_TREFFPUNKTE).refine(einzigartig),
    }),
  ),
  // Dateien liegen im SharePoint der Abteilung und werden nur verknüpft (wie der Baustein «datei»)
  baustein(
    "dokumente",
    z.strictObject({
      eintraege: z
        .array(
          z.strictObject({
            titel: kurztext(100),
            link: z
              .string()
              .max(LINK_MAX)
              .refine((s) => pruefeLink(s).ok),
            typ: kurztext(20).optional(),
            groesse: z
              .number()
              .int()
              .min(0)
              .max(Number.MAX_SAFE_INTEGER)
              .optional(),
            hinweis: kurztext(200).optional(),
          }),
        )
        .min(1)
        .max(MAX_DOKUMENTE),
    }),
  ),
  baustein(
    "kennzahlen",
    z.strictObject({
      zahlen: z
        .array(z.enum(KENNZAHL_ARTEN))
        .min(1)
        .max(KENNZAHL_ARTEN.length)
        .refine(einzigartig),
    }),
  ),
] as const;

export type DynamischerBaustein = z.infer<(typeof dynamischeBausteine)[number]>;
export const DYNAMISCHE_TYPEN = dynamischeBausteine.map(
  (s) => s.shape.typ.value,
);
export const istDynamisch = (b: { typ: string }): b is DynamischerBaustein =>
  (DYNAMISCHE_TYPEN as string[]).includes(b.typ);

// IDs von Anlässen und Orten, auf die Bausteine verweisen (für die Verweisprüfung, #350)
export function sammleDynamischeVerweise(bausteine: { typ: string }[]) {
  const anlaesse = new Set<string>();
  const orte = new Set<string>();
  for (const b of bausteine.filter(istDynamisch)) {
    switch (b.typ) {
      case "naechsterAnlass":
      case "lagerkarte":
      case "countdown":
        if (b.daten.anlassId) anlaesse.add(b.daten.anlassId.toLowerCase());
        break;
      case "treffpunkte":
        b.daten.ortIds.forEach((i) => orte.add(i.toLowerCase()));
        break;
      default:
        break;
    }
  }
  return { anlaesse: [...anlaesse], orte: [...orte] };
}
