import { z } from "zod";
import { LINK_MAX, pruefeLink } from "../link-pruefung.js";
import { sichtbarkeitSchema } from "../sichtbarkeit.js";

// Bausteinkatalog Version 1 der Website (#349): ein strenges Schema je Typ, kein HTML.
// Reine Schemas ohne Datenbank und ohne Route; die Verweisprüfung (Medium, Tag, Person, Seite existiert) macht #350. Der Baustein «datei» verweist auf einen Link, nicht auf ein Medium (#428).
// Der Alt-Text liegt am Medium (Pflicht oder «dekorativ» schon beim Hochladen, #338); ein Baustein trägt keinen eigenen.

// Obergrenzen (shortcut: Werte geschätzt, bei Bedarf anheben; sie schützen Speicher, Renderer und den Editor)
export const MAX_BAUSTEINE_PRO_SEITE = 100;
export const MAX_SEITENTITEL = 120;
export const MAX_UEBERSCHRIFT = 200;
export const MAX_KURZTEXT = 100;
export const MAX_BESCHRIFTUNG = 60;
export const MAX_DATEITYP = 20;
export const MAX_UNTERSCHRIFT = 300;
export const MAX_LINK_LAENGE = 2000;
export const MAX_TEXTBLOECKE = 100;
export const MAX_ABSCHNITTE_PRO_BLOCK = 50;
export const MAX_LISTENEINTRAEGE = 50;
export const MAX_ABSCHNITT_ZEICHEN = 2000;
export const MAX_TEXT_ZEICHEN = 20000;
export const MAX_GALERIE_BILDER = 50;
// Karussell (#550): wenige Bilder wechseln sich ab; mehr wären kein Karussell mehr, sondern eine Galerie
export const MIN_KARUSSELL_BILDER = 3;
export const MAX_KARUSSELL_BILDER = 8;
export const MAX_KARTEN = 24;
export const MAX_KARTENTEXT = 500;
export const MAX_HINWEIS = 200;
// Alterschip einer Stufenkarte (#555), zum Beispiel «3./4. Klasse»
export const MAX_ALTER = 40;
// Symbole der Merkmalskacheln (#555); die Zeichnung steht im Renderer
export const MERKMAL_SYMBOLE = [
  "gruppe",
  "zelt",
  "kalender",
  "stern",
  "herz",
  "ort",
  "sonne",
] as const;
export const MIN_TERMINE = 3;
export const MAX_TERMINE = 10;

// Steuerzeichen (auch NUL, das jsonb nicht speichert) gehören in keinen Text; Zeilenumbrüche entstehen durch Absätze
const STEUERZEICHEN = /\p{Cc}/u;
const sauber = (s: string) => !STEUERZEICHEN.test(s);
const kurztext = (max: number) =>
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

const link = (...erlaubt: LinkArt[]) =>
  z
    .string()
    .max(MAX_LINK_LAENGE)
    .refine((s) => {
      const art = linkArt(s);
      return art !== null && erlaubt.includes(art);
    });

const linkAlle = link("https", "seite", "mailto", "tel");

// Rich Text als Knoten: Absatz oder Liste (flach, keine Verschachtelung), darin Abschnitte mit den Marken fett, kursiv und Link
const abschnitt = z.strictObject({
  text: z.string().min(1).max(MAX_ABSCHNITT_ZEICHEN).refine(sauber),
  fett: z.literal(true).optional(),
  kursiv: z.literal(true).optional(),
  link: linkAlle.optional(),
});
const abschnitte = z.array(abschnitt).min(1).max(MAX_ABSCHNITTE_PRO_BLOCK);
const textBlock = z.discriminatedUnion("typ", [
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
const richText = z
  .array(textBlock)
  .min(1)
  .max(MAX_TEXTBLOECKE)
  .refine((bloecke) => zeichen(bloecke) <= MAX_TEXT_ZEICHEN);

// Cevi-Name und Funktion zeigt die Website immer; was zusätzlich erscheinen darf, entscheidet #351 (Einwilligung)
const zusatz = z
  .array(z.enum(["telefon", "email", "foto"]))
  .max(3)
  .refine((a) => new Set(a).size === a.length)
  .default([]);

const mediumId = z.uuid();
const bildEintrag = z.strictObject({
  mediumId,
  unterschrift: kurztext(MAX_UNTERSCHRIFT).optional(),
});

// id: stabile ID, damit Editor und Versionen einen Baustein wiedererkennen; sichtbarkeit: fehlt sie oder steht «erbt», gilt die der Seite
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

export const bausteinSchema = z.discriminatedUnion("typ", [
  // Der Seitentitel ist das H1, darum ab Ebene 2
  baustein(
    "ueberschrift",
    z.strictObject({
      ebene: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      text: kurztext(MAX_UEBERSCHRIFT),
    }),
  ),
  baustein("text", z.strictObject({ inhalt: richText })),
  baustein("bild", bildEintrag),
  baustein(
    "galerie",
    z.strictObject({
      bilder: z.array(bildEintrag).min(1).max(MAX_GALERIE_BILDER),
    }),
  ),
  // Wechselnde Bilder (#550); der Alt-Text liegt am Medium, ein dekoratives Bild ist hier nicht erlaubt (Verweisprüfung)
  baustein(
    "karussell",
    z.strictObject({
      bilder: z
        .array(bildEintrag)
        .min(MIN_KARUSSELL_BILDER)
        .max(MAX_KARUSSELL_BILDER),
    }),
  ),
  baustein(
    "karten",
    z.strictObject({
      // «merkmale» (#555): Kacheln mit Symbol, Titel und Text, ohne Link; «stufen»: Bildkarten mit Foto und Alterschip, ein Link auf die ganze Karte
      darstellung: z.enum(["karten", "liste", "merkmale", "stufen"]),
      eintraege: z
        .array(
          z.strictObject({
            titel: kurztext(MAX_KURZTEXT),
            text: kurztext(MAX_KARTENTEXT).optional(),
            link: link("https", "seite").optional(),
            symbol: z.enum(MERKMAL_SYMBOLE).optional(),
            bild: mediumId.optional(),
            alter: kurztext(MAX_ALTER).optional(),
          }),
        )
        .min(1)
        .max(MAX_KARTEN),
    }),
  ),
  baustein(
    "schaltflaeche",
    z.strictObject({
      darstellung: z.enum(["schaltflaeche", "link"]),
      beschriftung: kurztext(MAX_BESCHRIFTUNG),
      ziel: linkAlle,
    }),
  ),
  // Eine Datei liegt im SharePoint der Abteilung und wird nur verknüpft (#428): kein Medium, kein Abruf durch den Server. Typ als Wort («PDF») und Grösse in Bytes sind Angaben der Person, die den Baustein pflegt
  baustein(
    "datei",
    z.strictObject({
      titel: kurztext(MAX_KURZTEXT),
      link: z
        .string()
        .max(LINK_MAX)
        .refine((s) => pruefeLink(s).ok),
      typ: kurztext(MAX_DATEITYP).optional(),
      groesse: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    }),
  ),
  baustein("kontaktperson", z.strictObject({ personId: z.uuid(), zusatz })),
  baustein("leitungsteam", z.strictObject({ tagId: z.uuid(), zusatz })),
  // Nur der Platz im Katalog; die Termine kommen später live aus dem Kalender
  baustein(
    "terminliste",
    z.strictObject({
      tagId: z.uuid().optional(),
      anzahl: z.number().int().min(MIN_TERMINE).max(MAX_TERMINE),
    }),
  ),
  baustein("trenner", z.strictObject({ art: z.enum(["abstand", "linie"]) })),
  // Video und Social nur als Link, nie eingebettet
  baustein(
    "videolink",
    z.strictObject({
      art: z.enum(["video", "social"]),
      beschriftung: kurztext(MAX_BESCHRIFTUNG),
      url: link("https"),
    }),
  ),
  // Die festen Stufenfelder; die Werte liefert #355 aus der Datenbank, der Baustein hat keine eigenen Daten
  baustein("stufenfakten", z.strictObject({})),
  // Hinweisband (#549, Design W1): ein Satz, optional mit Link («Anmeldung offen bis 15. März»)
  baustein(
    "hinweis",
    z.strictObject({
      text: kurztext(MAX_HINWEIS),
      link: z
        .strictObject({
          beschriftung: kurztext(MAX_BESCHRIFTUNG),
          ziel: linkAlle,
        })
        .optional(),
    }),
  ),
  // Aufruf zum Handeln (#555): ein farbiges Band mit Titel, kurzem Text und einer Schaltfläche («Ich will in den Cevi!»)
  baustein(
    "aufruf",
    z.strictObject({
      titel: kurztext(MAX_KURZTEXT),
      text: kurztext(MAX_KARTENTEXT).optional(),
      beschriftung: kurztext(MAX_BESCHRIFTUNG),
      ziel: linkAlle,
    }),
  ),
  // Kontaktkarte (#549, Design W1): Telefon und E-Mail der Abteilung kommen aus der Konfiguration des Servers, die Ansprechperson (Cevi-Name und Funktion) aus den Personen
  baustein(
    "kontaktkarte",
    z.strictObject({
      titel: kurztext(MAX_KURZTEXT).optional(),
      personId: z.uuid().optional(),
    }),
  ),
]);
export type Baustein = z.infer<typeof bausteinSchema>;
export type Bausteintyp = Baustein["typ"];
