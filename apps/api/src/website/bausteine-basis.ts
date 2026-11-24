import { z } from "zod";
import { sichtbarkeitSchema } from "../sichtbarkeit.js";

// Gemeinsame Teile der Schemas, aus bausteine.ts herausgelöst, damit eigene Dateien je Gruppe von Bausteinen sie nutzen können, ohne einen Importkreis zu bilden: Textprüfung, Links, Rich Text und die Hülle eines Bausteins.
// Die Obergrenzen, die sie brauchen, stehen hier; bausteine.ts führt sie weiter aus.

// Obergrenzen (shortcut: Werte geschätzt, bei Bedarf anheben; sie schützen Speicher, Renderer und den Editor)
export const MAX_LINK_LAENGE = 2000;
export const MAX_UNTERSCHRIFT = 300;
export const MAX_TEXTBLOECKE = 100;
export const MAX_ABSCHNITTE_PRO_BLOCK = 50;
export const MAX_LISTENEINTRAEGE = 50;
export const MAX_ABSCHNITT_ZEICHEN = 2000;
export const MAX_TEXT_ZEICHEN = 20000;

// Steuerzeichen (auch NUL, das jsonb nicht speichert) gehören in keinen Text; Zeilenumbrüche entstehen durch Absätze
const STEUERZEICHEN = /\p{Cc}/u;
export const sauber = (s: string) => !STEUERZEICHEN.test(s);
export const kurztext = (max: number) =>
  z.string().trim().min(1).max(max).refine(sauber);

// Links: nur diese Arten, je Baustein eine Auswahl. Ein Ziel ohne Schema (`javascript:`, `data:`, `//host`, `http:`) passt nie
export type LinkArt = "https" | "seite" | "mailto" | "tel";
// Zeichen, die in einer Adresse nie vorkommen: Leerraum, Steuerzeichen, Backslash (Browser lesen ihn als «/»), Klammern und Anführungszeichen
const ADRESSE_VERBOTEN = /[\s\p{Cc}\\<>"]/u;
// Seitenadresse wie die Slugs der Website, optional mit Anker; «/» ist die Startseite
const SEITENPFAD =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?(?:#[a-z0-9_-]+)?$/;

function istHttps(s: string): boolean {
  if (!/^https:\/\/[^/?#]/.test(s)) return false;
  try {
    const u = new URL(s);
    // Ohne Zugangsdaten in der Adresse; ein Punkt im Host schliesst «localhost» und Kurznamen aus
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

const LINK_PRUEFER: Record<LinkArt, (s: string) => boolean> = {
  https: istHttps,
  seite: (s) => SEITENPFAD.test(s),
  mailto: (s) =>
    s.startsWith("mailto:") && z.email().safeParse(s.slice(7)).success,
  tel: (s) => /^tel:\+?[0-9]{3,20}$/.test(s),
};

export function linkArt(ziel: string): LinkArt | null {
  if (ADRESSE_VERBOTEN.test(ziel) || ziel.length > MAX_LINK_LAENGE) return null;
  return (
    (Object.keys(LINK_PRUEFER) as LinkArt[]).find((a) =>
      LINK_PRUEFER[a](ziel),
    ) ?? null
  );
}

export const link = (...erlaubt: LinkArt[]) =>
  z
    .string()
    .max(MAX_LINK_LAENGE)
    .refine((s) => {
      const art = linkArt(s);
      return art !== null && erlaubt.includes(art);
    });

export const linkAlle = link("https", "seite", "mailto", "tel");

// Rich Text als Knoten: Absatz oder Liste (flach, keine Verschachtelung), darin Abschnitte mit den Marken fett, kursiv und Link
export const abschnitt = z.strictObject({
  text: z.string().min(1).max(MAX_ABSCHNITT_ZEICHEN).refine(sauber),
  fett: z.literal(true).optional(),
  kursiv: z.literal(true).optional(),
  link: linkAlle.optional(),
});
export const abschnitte = z
  .array(abschnitt)
  .min(1)
  .max(MAX_ABSCHNITTE_PRO_BLOCK);
export const textBlock = z.discriminatedUnion("typ", [
  z.strictObject({ typ: z.literal("absatz"), inhalt: abschnitte }),
  z.strictObject({
    typ: z.literal("liste"),
    geordnet: z.boolean(),
    eintraege: z.array(abschnitte).min(1).max(MAX_LISTENEINTRAEGE),
  }),
]);
export type TextBlock = z.infer<typeof textBlock>;

function zeichen(bloecke: TextBlock[]): number {
  return bloecke.reduce(
    (summe, b) =>
      summe +
      (b.typ === "absatz" ? [b.inhalt] : b.eintraege)
        .flat()
        .reduce((n, a) => n + a.text.length, 0),
    0,
  );
}
export const richText = z
  .array(textBlock)
  .min(1)
  .max(MAX_TEXTBLOECKE)
  .refine((bloecke) => zeichen(bloecke) <= MAX_TEXT_ZEICHEN);

// Cevi-Name und Funktion zeigt die Website immer; was zusätzlich erscheinen darf, entscheidet #351 (Einwilligung)
export const zusatz = z
  .array(z.enum(["telefon", "email", "foto"]))
  .max(3)
  .refine((a) => new Set(a).size === a.length)
  .default([]);

export const mediumId = z.uuid();
export const bildEintrag = z.strictObject({
  mediumId,
  unterschrift: kurztext(MAX_UNTERSCHRIFT).optional(),
});

// id: stabile ID, damit Editor und Versionen einen Baustein wiedererkennen; sichtbarkeit: fehlt sie oder steht «erbt», gilt die der Seite
export function baustein<T extends string, D extends z.ZodType>(
  typ: T,
  daten: D,
) {
  return z.strictObject({
    id: z.uuid(),
    typ: z.literal(typ),
    daten,
    sichtbarkeit: z
      .union([z.literal("erbt"), sichtbarkeitSchema])
      .default("erbt"),
  });
}
