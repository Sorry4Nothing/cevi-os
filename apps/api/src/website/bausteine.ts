import { z } from "zod";
import { LINK_MAX, pruefeLink } from "../link-pruefung.js";
import { handlungSchemas } from "./bausteine-handlung.js";
import {
  baustein,
  bildEintrag,
  kurztext,
  link,
  linkAlle,
  mediumId,
  MAX_UNTERSCHRIFT,
  richText,
  zusatz,
} from "./bausteine-basis.js";
import { formularBausteine } from "./bausteine-formular.js";
import { textBausteine } from "./bausteine-text.js";
import { medienBausteine } from "./medien-schema.js";

// Was früher hier stand und andere Dateien von hier importieren
export {
  linkArt,
  MAX_ABSCHNITT_ZEICHEN,
  MAX_ABSCHNITTE_PRO_BLOCK,
  MAX_LINK_LAENGE,
  MAX_LISTENEINTRAEGE,
  MAX_TEXT_ZEICHEN,
  MAX_TEXTBLOECKE,
  MAX_UNTERSCHRIFT,
  type LinkArt,
  type TextBlock,
} from "./bausteine-basis.js";
import { dynamischeBausteine } from "./bausteine-dynamisch.js";

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
export const MAX_GALERIE_BILDER = 50;
// Karussell (#550): wenige Bilder wechseln sich ab; mehr wären kein Karussell mehr, sondern eine Galerie
export const MIN_KARUSSELL_BILDER = 3;
export const MAX_KARUSSELL_BILDER = 8;
export const MAX_KARTEN = 24;
export const MAX_KARTENTEXT = 500;
export const MAX_HINWEIS = 200;
// Weiterführende Verweise der Kontaktkarte (#580)
export const MAX_KONTAKT_VERWEISE = 4;
// Alterschip einer Stufenkarte (#555), zum Beispiel «3./4. Klasse»
export const MAX_ALTER = 40;
// Symbole der Merkmale (#555): Die Website zeichnet sie nicht mehr (Merkmale tragen grosse Schrift oder ein Foto); das Feld bleibt, damit gespeicherte Seiten gültig sind
export const MERKMAL_SYMBOLE = [
  "gruppe",
  "zelt",
  "kalender",
  "stern",
  "herz",
  "ort",
  "sonne",
] as const;
export const MAX_ECKDATEN = 12;
// Bausteine der Inhaltsseiten (#560): Personen und Artikel
export const MAX_PERSONEN = 24;
export const MAX_ARTIKEL = 60;
export const MAX_PREIS = 40;
export const MIN_TERMINE = 3;
export const MAX_TERMINE = 10;

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
      // «merkmale» (#555): Zeilen mit Symbol, Titel und Text, ohne Link; «stufen»: Bildkarten mit Foto und Etikett im Bild (Alter, Preis), ein Link auf die ganze Karte;
      // «zeitstrahl»: Jahr (Titel) und Ereignis (Text) in ihrer Reihenfolge; «zahlen»: grosse Zahl (Titel) mit Beschriftung (Text)
      darstellung: z.enum([
        "karten",
        "liste",
        "merkmale",
        "stufen",
        "zeitstrahl",
        "zahlen",
      ]),
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
      // Vorschaubild aus dem Medienspeicher (#742): Die Karte zeigt es mit dem Namen des Ziels; abgespielt wird nie auf unserer Seite
      bild: mediumId.optional(),
    }),
  ),
  // Die festen Samstagsangaben der Stufen; die Werte liefert #355 aus der Datenbank, der Baustein hat keine eigenen Daten
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
  // Eckdaten (#555): frei benannte Angaben auf einen Blick (Datum, Ort, Kosten, Anmeldeschluss) als Tafel neben dem Text, wie die Samstagsangaben der Stufen; für Lager und Anlässe
  baustein(
    "eckdaten",
    z.strictObject({
      eintraege: z
        .array(
          z.strictObject({
            bezeichnung: kurztext(MAX_BESCHRIFTUNG),
            wert: kurztext(MAX_UNTERSCHRIFT),
            // Der Wert als Link (#560), zum Beispiel die Adresse der Lagerleitung
            link: linkAlle.optional(),
          }),
        )
        .min(1)
        .max(MAX_ECKDATEN),
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
  // Kontaktkarte (#549, Design W1): Telefon, E-Mail und Anschrift der Abteilung kommen aus der Konfiguration des Servers, die Ansprechperson (Cevi-Name und Funktion) aus den Personen.
  // #580: dazu ein Hinweis zur Erreichbarkeit, ein Bild der Medienbibliothek und weiterführende Verweise (zum Beispiel Cevi Schweiz); alles freiwillig
  baustein(
    "kontaktkarte",
    z.strictObject({
      titel: kurztext(MAX_KURZTEXT).optional(),
      personId: z.uuid().optional(),
      hinweis: kurztext(MAX_HINWEIS).optional(),
      bild: mediumId.optional(),
      verweise: z
        .array(
          z.strictObject({
            beschriftung: kurztext(MAX_BESCHRIFTUNG),
            ziel: linkAlle,
          }),
        )
        .max(MAX_KONTAKT_VERWEISE)
        .optional(),
    }),
  ),
  // Personen (#560): echte Personen der Plattform. Name (Cevi-Name, sonst Vorname) und Bild (das Profilbild) kommen von der Person und erscheinen nur mit ihrer Freigabe; Funktion und Funktionsadresse sind Angaben der Seite.
  // Es gibt bewusst kein Feld für eine Telefonnummer: auf die Website gehört die Funktionsadresse
  baustein(
    "personen",
    z.strictObject({
      eintraege: z
        .array(
          z.strictObject({
            personId: z.uuid(),
            funktion: kurztext(MAX_KURZTEXT).optional(),
            // Freitext mit Formatprüfung: Der Server kann eine private Adresse nicht erkennen. Gehört nur die Funktionsadresse hinein, nie eine private (Hinweis im Editor)
            email: z.email().max(254).optional(),
          }),
        )
        .min(1)
        .max(MAX_PERSONEN),
    }),
  ),
  // Artikel (#560): Karten mit Bild, Name und Preis (Lädeli); der Preis ist Text («40.–», «gratis»)
  baustein(
    "artikel",
    z.strictObject({
      eintraege: z
        .array(
          z.strictObject({
            name: kurztext(MAX_KURZTEXT),
            preis: kurztext(MAX_PREIS).optional(),
            hinweis: kurztext(MAX_HINWEIS).optional(),
            mediumId: mediumId.optional(),
          }),
        )
        .min(1)
        .max(MAX_ARTIKEL),
    }),
  ),
  // Lädeli (#566): das Raster der Artikel der Abteilung mit Warenkorb und Bestellung für angemeldete Personen. Der Baustein hat keine eigenen Daten: Die Artikel pflegt die Verwaltung unter «Lädeli»
  baustein("laden", z.strictObject({})),
  // Fotoalben (#690): die Alben der Abteilung aus Flickr, nur für angemeldete Personen. Der Baustein hat keine eigenen Daten und steht als Behälter im HTML; das Skript holt Alben und Bilder von unserem Server (GET /api/v1/fotos/alben), der sie bei Flickr abholt. Welche Alben erscheinen, stellt die Verwaltung unter «Website, Fotos» ein
  baustein("fotoalben", z.strictObject({})),
  // Einstieg und Handlung (#743): Schemas in bausteine-handlung.ts
  ...handlungSchemas({ baustein, kurztext, link, linkAlle }),
  // Bilder und Medien (#742): Bildraster, Bild mit Text, Bildvergleich, Logo-Reihe, breites Bild, Bildstreifen, Bilderpaket
  ...medienBausteine({
    baustein,
    kurztext,
    link,
    linkAlle,
    mediumId,
    bildEintrag,
  }),
  // Text und Gestaltung (#741): Hinweisbox, Zitat, Fragen, Spalten, Bild und Text, Tabelle, Schritte, Checkliste
  ...textBausteine,
  // Formular (#819): Angaben einholen, die Antworten gehen in die Verwaltung (bausteine-formular.ts)
  ...formularBausteine,
  // Bausteine mit Daten aus Cevi OS (#740): bausteine-dynamisch.ts
  ...dynamischeBausteine,
]);
export type Baustein = z.infer<typeof bausteinSchema>;
export type Bausteintyp = Baustein["typ"];
