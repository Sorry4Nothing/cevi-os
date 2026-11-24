import type { LadenEinstellung } from "../laden/laden.js";
import { pruefeLink } from "../link-pruefung.js";
import { linkArt, type Baustein, type TextBlock } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";
import {
  istInhaltsBaustein,
  personenListe,
  rendereInhaltsBaustein,
  STIL_INHALT,
} from "./inhaltsbausteine.js";
import {
  karussell,
  SKRIPT_KARUSSELL,
  SKRIPT_LICHTKASTEN,
  STIL_KARUSSELL,
  STIL_LICHTKASTEN,
} from "./karussell.js";
import { rendereFotoalben, SKRIPT_FOTOS, STIL_FOTOS } from "./fotoalben.js";
import { istDynamisch } from "./bausteine-dynamisch.js";
import type { DynamischErgebnis } from "./dynamisch-daten.js";
import {
  BREITE_DYNAMISCHE,
  rendereDynamischenBaustein,
  STIL_DYNAMISCH,
} from "./dynamisch.js";
import { kopf, STIL_KOPF } from "./kopf.js";
import { fuss, kontaktkarte, STIL_FUSS } from "./kontakt.js";
import {
  istBreitText,
  istTextBaustein,
  rendereTextBaustein,
} from "./bausteine-text-rendern.js";
import {
  rendereLaden,
  SKRIPT_LADEN,
  STILE_LADEN,
  type LadenArtikel,
} from "./laden.js";
import {
  istMedienBaustein,
  LICHTKASTEN_TYPEN,
  medienAnforderungen,
  MEDIEN_BREIT,
  rendereMedienBaustein,
  rendereVideolink,
  SKRIPT_VERGLEICH,
  STIL_MEDIEN,
} from "./medien-bausteine.js";
import { symbol } from "./symbole.js";
import { zeichenLinks } from "./zeichen.js";

// Renderer der Website (#351): Seitendokument zu HTML, nur aus den typisierten Knoten. Kein Nutzertext gelangt ungeprüft ins Markup:
// Jede Zeichenkette läuft durch esc(), Adressen durch linkArt() (nur https, Seitenpfade, mailto, tel) und die Medien-Adresse entsteht aus der ID der Datenbank.
// Rein und synchron: Alles, was aus der Datenbank kommt, liegt vorher in «Daten». Kein Skript, keine Schrift und keine Einbettung von aussen.

// Tokens und Schrift gelten für Website und Verwaltung (#578); sie stehen vor der Stilvorlage im Kopf jeder Seite
export const TOKENS_PFAD = "/website/tokens.css";
export const STYLESHEET_PFAD = "/website/website.css";
// Name der Startseite: die Seite mit dieser Adresse auf der obersten Ebene ist die Adresse «/» (offene Frage aus #348, bis der Nutzer entscheidet)
export const STARTSEITE = "start";

const MASKE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (text: string) => text.replace(/[&<>"']/g, (z) => MASKE[z]!);

export type NavPunkt = { pfad: string; titel: string; kinder: NavPunkt[] };

// Ein öffentliches Medium; nicht öffentliche oder fremde Medien gelangen nie hierher
export type MedienDaten = {
  mimeTyp: string;
  groesse: number;
  breite: number | null;
  hoehe: number | null;
  // null = dekorativ (leerer Alt-Text)
  altText: string | null;
};
// Nur Cevi-Name und Funktion: Telefon, E-Mail und Foto zeigt die Website nicht, bis der Nutzer anders entscheidet
export type Mitglied = { name: string; funktion: string | null };
// Person mit einer Rolle mit Aussenwirkung (#560, #610): Anzeigename und, falls vorhanden, die Adresse des Profilbilds in der Ausgabe
export type WebsitePerson = { name: string; bild?: string };
// Leitung oder Stufenleitung einer Stufe im Leitungsteam der Stufenseite (#610): dazu die Rolle als Text
export type StufenMitglied = WebsitePerson & { funktion: string };
// link: der Wert als Link (Eckdaten, #560)
// lang: ein längerer Text in Lesegrösse statt eines kurzen Werts; liste: seine Einträge, wenn er aus mehreren Dingen besteht (#645, «Mitnehmen»)
// zusatz: Adresszeile unter dem Wert; karte: Adresse bei Google Maps, die der Server selbst gebaut hat (Orte, #646); sie wird als Verweis «Auf Google Maps ansehen» ausgegeben
export type Fakt = {
  bezeichnung: string;
  wert: string;
  link?: string;
  zusatz?: string;
  karte?: string;
  lang?: boolean;
  liste?: string[];
};
// Ein Termin der Liste (#549): Tage als «JJJJ-MM-TT» und Zeiten als «HH:MM» in Zürcher Zeit, schon so aus der Abfrage; stufen sind die Namen der Stufen-Tags (Chips); anlassId nur bei einem Anlass (Link)
export type TerminEintrag = {
  id: string;
  titel: string;
  von: string;
  bis: string;
  zeitVon: string | null;
  zeitBis: string | null;
  ort: string | null;
  stufen: string[];
  anlassId: string | null;
  // Adresse der öffentlichen Seite des Anlasses (#560): Die Zeile führt dann dorthin statt auf die Anmeldung; der Abgleich setzt sie
  seiteId?: string | null;
  seitePfad?: string;
};

// Angaben der Abteilung für Fuss und Kontaktkarte (#549): Name steht im Kontext, Adresse, Telefon und E-Mail kommen aus der Konfiguration des Servers, die Seiten aus dem Seitenbaum
export type Kontakt = {
  adresse?: string;
  telefon?: string;
  email?: string;
  // Adressen von Seiten des Baums; fehlt «datenschutz», führt der Link auf «/datenschutz-website»
  impressum?: string;
  datenschutz?: string;
};

// Daten für Bausteine, die nicht im Dokument stehen. Fehlt ein Eintrag, entfällt der Baustein.
// #355 füllt «stufenfakten» (je Seiten-ID), der Auftrag Termine hängt später «terminliste» ein
export type Daten = {
  medien: ReadonlyMap<string, MedienDaten>;
  personen: ReadonlyMap<string, Mitglied>;
  teams: ReadonlyMap<string, { name: string; mitglieder: Mitglied[] }>;
  // Personen mit Aussenrolle für den Baustein «personen» (#560, #610), nach ID; wer fehlt, erscheint nicht
  websitePersonen: ReadonlyMap<string, WebsitePerson>;
  // Leitungsteam einer Stufe mit Bild (#610), nach ID des Stufen-Tags; ein Tag vom Typ «stufe» steht hier, auch wenn niemand die Rolle trägt
  stufenteams: ReadonlyMap<string, StufenMitglied[]>;
  // Profilbilder dazu als Dateien der Ausgabe [Pfad, Bytes]; schreibt nur der Abgleich
  personenDateien?: [string, Uint8Array][];
  stufenfakten: ReadonlyMap<string, Fakt[]>;
  // Je Baustein «terminliste» (nach der ID des Bausteins) die kommenden Termine; fehlt der Eintrag, wurde nichts geladen und der Baustein entfällt
  termine: ReadonlyMap<string, TerminEintrag[]>;
  // Angaben der Abteilung für Kontaktkarte und Fuss (#549)
  kontakt?: Kontakt;
  // Je Seite (ID) der Anlass, der zu ihr gehört (#560): Unter den Eckdaten steht dann die Schaltfläche zur Anmeldung
  anlaesse: ReadonlyMap<string, string>;
  // Adressen von Seiten des Baums, die Besucher nicht sehen (#560): Karten und Listeneinträge mit einem Link dorthin entfallen
  verborgen?: ReadonlySet<string>;
  // Die Artikel des Lädelis (#566) in ihrer Reihenfolge, nach ID; leer, wenn keine Seite den Baustein «laden» hat
  laden: ReadonlyMap<string, LadenArtikel>;
  // Die Übergabearten des Lädelis in ihrer Reihenfolge (der Name ist der Schlüssel)
  ladenUebergabe: ReadonlyMap<string, true>;
  // Die Einstellungen des Lädelis (#642) unter dem Schlüssel «e»; ohne Eintrag gelten die Vorgaben
  ladenEinstellung: ReadonlyMap<"e", LadenEinstellung>;
  // Je Baustein mit Daten aus Cevi OS (#740, nach der ID des Bausteins) das Ergebnis; fehlt der Eintrag, entfällt der Baustein
  dynamisch: ReadonlyMap<string, DynamischErgebnis>;
};
export const keineDaten = (): Daten => ({
  medien: new Map(),
  personen: new Map(),
  teams: new Map(),
  websitePersonen: new Map(),
  stufenteams: new Map(),
  stufenfakten: new Map(),
  termine: new Map(),
  anlaesse: new Map(),
  laden: new Map(),
  ladenUebergabe: new Map(),
  ladenEinstellung: new Map(),
  dynamisch: new Map(),
});

// Logo der Abteilung (#550): ein öffentliches Bild aus der Medienbibliothek; fehlt es, zeigt der Kopf die Wortmarke
export type Logo = {
  id: string;
  altText: string | null;
  breite: number | null;
  hoehe: number | null;
  // Fassung für den dunklen Modus (#558): helle Schrift, ohne Hintergrund. Fehlt sie, steht das Logo im dunklen Modus auf einem hellen Feld
  dunkel?: { id: string; breite: number | null; hoehe: number | null };
};

export type Kontext = {
  abteilung: string;
  logo?: Logo;
  // Favicon (#558): Die Dateien liegen in der Ausgabe; der Wert ist ihre Fassung (Hex) für die Adressen. Fehlt er, trägt die Seite keine Einträge (Vorschau im Editor, Tests)
  zeichen?: string;
  basisUrl: string;
  navigation: NavPunkt[];
  daten: Daten;
};
// pfad: «/» oder «/a/b», immer aus geprüften Adressen
export type SeiteZumRendern = {
  id: string;
  pfad: string;
  dokument: Seitendokument;
};

export const medienUrl = (id: string) => `/api/v1/medien/${id}`;

// Ein Knoten des Markups: Text (wird beim Ausgeben maskiert) oder ein Element. Dieselben Knoten gehen als JSON an das Skript, das geschützte Bausteine nachlädt (#354); dort entstehen daraus DOM-Knoten ohne innerHTML.
// attr: «true» ist ein Attribut ohne Wert (download)
export type HtmlKnoten =
  | string
  | {
      tag: string;
      attr?: Record<string, string | true>;
      kinder?: HtmlKnoten[];
    };

export const el = (
  tag: string,
  attr?: Record<string, string | true>,
  ...kinder: HtmlKnoten[]
): HtmlKnoten => ({ tag, ...(attr && { attr }), kinder });

const LEERE_ELEMENTE = new Set(["img", "hr"]);

// Der Symbolsatz liegt in symbole.ts; von hier aus bleibt «symbol» wie bisher erreichbar
export { symbol } from "./symbole.js";

export function serialisiere(k: HtmlKnoten): string {
  if (typeof k === "string") return esc(k);
  const attr = Object.entries(k.attr ?? {})
    .map(([n, w]) => (w === true ? ` ${n}` : ` ${n}="${esc(w)}"`))
    .join("");
  if (LEERE_ELEMENTE.has(k.tag)) return `<${k.tag}${attr}>`;
  return `<${k.tag}${attr}>${(k.kinder ?? []).map(serialisiere).join("")}</${k.tag}>`;
}

// href (und rel für fremde Seiten); null, wenn die Adresse keine erlaubte Art hat
function href(ziel: string): Record<string, string> | null {
  const art = linkArt(ziel);
  if (art === null) return null;
  return art === "https"
    ? { href: ziel, rel: "noopener noreferrer" }
    : { href: ziel };
}

const EXTERN_HINWEIS: HtmlKnoten = el(
  "span",
  { class: "nur-sr" },
  " (externe Seite)",
);

export function verlinke(
  ziel: string | undefined,
  innen: HtmlKnoten[],
  klasse?: string,
): HtmlKnoten[] {
  const h = ziel === undefined ? null : href(ziel);
  if (h === null) return innen;
  // Ein Link auf eine fremde Seite sagt das auch Screenreadern; das sichtbare Zeichen zeichnet der Stil (a[rel~="noopener"])
  const extern = h.rel === undefined ? [] : [EXTERN_HINWEIS];
  return [el("a", klasse ? { ...h, class: klasse } : h, ...innen, ...extern)];
}

export function textBlock(b: TextBlock): HtmlKnoten {
  const abschnitte = (liste: Extract<TextBlock, { typ: "absatz" }>["inhalt"]) =>
    liste.flatMap((a) => {
      let k: HtmlKnoten = a.text;
      if (a.fett) k = el("strong", undefined, k);
      if (a.kursiv) k = el("em", undefined, k);
      return verlinke(a.link, [k]);
    });
  if (b.typ === "absatz") return el("p", undefined, ...abschnitte(b.inhalt));
  return el(
    b.geordnet ? "ol" : "ul",
    undefined,
    ...b.eintraege.map((e) => el("li", undefined, ...abschnitte(e))),
  );
}

export function groesse(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function bild(
  id: string,
  m: MedienDaten | undefined,
  unterschrift?: string,
): HtmlKnoten | null {
  if (!m || !m.mimeTyp.startsWith("image/")) return null;
  const img = el("img", {
    src: medienUrl(id),
    alt: m.altText ?? "",
    ...(m.breite &&
      m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
    loading: "lazy",
    decoding: "async",
  });
  // Das Bild ist ein Link auf die Bilddatei: Ohne Skript öffnet er sie, mit Skript (lichtkasten.js) die Grossansicht über der Seite (#559)
  return el(
    "figure",
    undefined,
    el(
      "a",
      { class: "bildgross", href: medienUrl(id) },
      img,
      el("span", { class: "nur-sr" }, "Bild gross ansehen"),
    ),
    ...(unterschrift ? [el("figcaption", undefined, unterschrift)] : []),
  );
}

// Anfangsbuchstaben der ersten zwei Wörter des Cevi-Namens, nur Buchstaben und Ziffern
export function initialen(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
      .join("")
      .slice(0, 2)
      .toLocaleUpperCase("de-CH") || "?"
  );
}

function mitglieder(liste: Mitglied[]): HtmlKnoten[] {
  return liste.map((m) =>
    el(
      "li",
      { class: "person" },
      el("span", { class: "ava", "aria-hidden": "true" }, initialen(m.name)),
      el(
        "div",
        undefined,
        el("span", { class: "name" }, m.name),
        ...(m.funktion ? [el("span", { class: "funktion" }, m.funktion)] : []),
      ),
    ),
  );
}

// Bildkarte einer Stufe (#555): Foto mit Alterschip, darunter Titel und Kurztext. Der Link steckt im Titel und deckt per CSS die ganze Karte ab, so gibt es genau einen Link je Karte mit kurzem Namen.
// Ohne Foto trägt die Karte eine Fläche in der Farbe der Stufe
function stufenkarte(
  e: Extract<Baustein, { typ: "karten" }>["daten"]["eintraege"][number],
  ebene: number,
  daten: Daten,
): HtmlKnoten {
  const m = e.bild ? daten.medien.get(e.bild) : undefined;
  const foto = e.bild && m?.mimeTyp.startsWith("image/") ? m : undefined;
  const titel = verlinke(e.link, [e.titel]);
  return el(
    "li",
    { class: e.link ? "stufe stufe--link" : "stufe" },
    el(
      "div",
      { class: foto ? "stufe-bild" : "stufe-bild stufe-bild--leer" },
      ...(foto && e.bild
        ? [
            el("img", {
              src: medienUrl(e.bild),
              alt: foto.altText ?? "",
              ...(foto.breite &&
                foto.hoehe && {
                  width: String(foto.breite),
                  height: String(foto.hoehe),
                }),
              loading: "lazy",
              decoding: "async",
            }),
          ]
        : []),
      ...(e.alter ? [el("span", { class: "alterschip" }, e.alter)] : []),
    ),
    el(
      "div",
      { class: "stufe-text" },
      el(`h${ebene}`, { class: "titel" }, ...titel),
      ...(e.text ? [el("p", undefined, e.text)] : []),
      ...(e.link
        ? [
            el(
              "span",
              { class: "stufe-pfeil", "aria-hidden": "true" },
              symbol("pfeil"),
            ),
          ]
        : []),
    ),
  );
}

// Anker einer Überschrift der Ebene 2 (#560): ihr Text als Adresse («Unsere Lager» wird «unsere-lager»); ein doppelter bekommt «-2»
export function anker(text: string, vergeben: Set<string>): string | null {
  const basis = text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (basis === "") return null;
  let id = basis;
  for (let n = 2; vergeben.has(id); n++) id = `${basis}-${n}`;
  vergeben.add(id);
  return id;
}

// Stand beim Rendern einer Seite; anker: vergebene IDs («inhalt» und «h1» gehören dem Rahmen)
type Stand = { ebene: number; schalter: number; anker: Set<string> };
const neuerStand = (): Stand => ({
  ebene: 1,
  schalter: 0,
  anker: new Set(["inhalt", "h1"]),
});

// Die Tafel «auf einen Blick»: Samstagsangaben der Stufen und Eckdaten sehen gleich aus
const faktenTafel = (fakten: Fakt[]): HtmlKnoten =>
  el(
    "dl",
    { class: "fakten karte" },
    ...fakten.map((f) =>
      el(
        "div",
        { class: f.lang ? "fakt fakt--lang" : "fakt" },
        el("dt", undefined, f.bezeichnung),
        el(
          "dd",
          undefined,
          ...(f.liste
            ? [
                el(
                  "ul",
                  { class: "mitnehmen", role: "list" },
                  ...f.liste.map((e) => el("li", undefined, e)),
                ),
              ]
            : verlinke(f.link, [f.wert])),
          ...(f.zusatz ? [el("span", { class: "fakt-zusatz" }, f.zusatz)] : []),
          // Nur ein Link: kein Skript, keine Karte, keine Verbindung zu Google vor dem Klick
          ...(f.karte
            ? [
                el(
                  "p",
                  { class: "fakt-karte" },
                  ...verlinke(f.karte, [
                    symbol("ort"),
                    "Auf Google Maps ansehen",
                  ]),
                ),
              ]
            : []),
        ),
      ),
    ),
  );

// letzte.ebene: Ebene der letzten Überschrift der Seite (1 = der Seitentitel); eine neue springt höchstens eine Ebene tiefer.
// letzte.schalter: Zahl der Schaltflächen bisher; nur die erste ist rot (eine Hauptaktion je Seite)
function rendereBaustein(
  b: Baustein,
  seiteId: string,
  daten: Daten,
  letzte: Stand,
): HtmlKnoten | null {
  if (istInhaltsBaustein(b)) {
    return rendereInhaltsBaustein(b, daten, letzte);
  }
  // Bilder und Medien (#742)
  if (istMedienBaustein(b)) return rendereMedienBaustein(b, daten, letzte);
  // Text und Gestaltung (#741): Hinweisbox, Zitat, Fragen, Spalten, Bild und Text, Tabelle, Schritte, Checkliste
  if (istTextBaustein(b)) return rendereTextBaustein(b, daten, letzte);
  if (b.typ === "laden") {
    return rendereLaden(daten, Math.min(3, letzte.ebene + 1));
  }
  if (b.typ === "fotoalben") return rendereFotoalben();
  if (istDynamisch(b)) return rendereDynamischenBaustein(b, daten, letzte);
  switch (b.typ) {
    case "ueberschrift": {
      const ebene = Math.min(b.daten.ebene, letzte.ebene + 1);
      letzte.ebene = ebene;
      // Abschnitte sind über einen Anker erreichbar («/anlaesse#lager»)
      const id = ebene === 2 ? anker(b.daten.text, letzte.anker) : null;
      return el(`h${ebene}`, id ? { id } : undefined, b.daten.text);
    }
    case "text":
      return el(
        "div",
        { class: "text lesetext" },
        ...b.daten.inhalt.map(textBlock),
      );
    case "bild":
      return bild(
        b.daten.mediumId,
        daten.medien.get(b.daten.mediumId),
        b.daten.unterschrift,
      );
    case "galerie": {
      const bilder = b.daten.bilder
        .map((e) =>
          bild(e.mediumId, daten.medien.get(e.mediumId), e.unterschrift),
        )
        .filter((k) => k !== null);
      return bilder.length === 0
        ? null
        : el(
            "ul",
            { class: "galerie" },
            ...bilder.map((k) => el("li", undefined, k)),
          );
    }
    // Bildstreifen (karussell.ts). Ein einzelnes Bild bleibt ein Bild
    case "karussell": {
      const bilder = b.daten.bilder
        .map((e) =>
          bild(e.mediumId, daten.medien.get(e.mediumId), e.unterschrift),
        )
        .filter((k) => k !== null);
      return bilder.length < 2 ? (bilder[0] ?? null) : karussell(bilder);
    }
    // «karten»: einfache Karte mit Titel, Text und Link; «liste»: eine Zeile je Eintrag mit Link am Titel;
    // «merkmale» (#555): ohne Link, grosser Titel und Text, optional ein Foto, in einem blauen Band (siehe rendereAbschnitte); «stufen» (#555): Bildkarte, ein Link auf die ganze Karte
    case "karten": {
      const ebene = Math.min(3, letzte.ebene + 1);
      // Ein Eintrag, der auf eine Seite führt, die Besucher nicht sehen, entfällt (#560)
      const eintraege = b.daten.eintraege.filter(
        (e) => !e.link || !daten.verborgen?.has(e.link.split("#")[0]!),
      );
      if (eintraege.length === 0) return null;
      if (b.daten.darstellung === "merkmale") {
        return el(
          "ul",
          { class: "merkmale" },
          ...eintraege.map((e) => {
            const m = e.bild ? daten.medien.get(e.bild) : undefined;
            return el(
              "li",
              undefined,
              ...(e.bild && m?.mimeTyp.startsWith("image/")
                ? [
                    el("img", {
                      src: medienUrl(e.bild),
                      alt: m.altText ?? "",
                      ...(m.breite &&
                        m.hoehe && {
                          width: String(m.breite),
                          height: String(m.hoehe),
                        }),
                      loading: "lazy",
                      decoding: "async",
                    }),
                  ]
                : []),
              el(`h${ebene}`, { class: "titel" }, e.titel),
              ...(e.text ? [el("p", undefined, e.text)] : []),
            );
          }),
        );
      }
      // Die Reihenfolge trägt Bedeutung: eine geordnete Liste
      if (b.daten.darstellung === "zeitstrahl") {
        return el(
          "ol",
          { class: "zeitstrahl" },
          ...eintraege.map((e) => {
            // Stationen einer Erzählung (#560): das Jahr gross, daneben der Text und, wenn gewählt, ein Foto. Der Alt-Text kommt vom Medium
            const m = e.bild ? daten.medien.get(e.bild) : undefined;
            const foto = e.bild && m?.mimeTyp.startsWith("image/") ? m : null;
            return el(
              "li",
              { class: foto ? "station station--bild" : "station" },
              ...(foto && e.bild
                ? [
                    el(
                      "figure",
                      { class: "station-bild" },
                      el("img", {
                        src: medienUrl(e.bild),
                        alt: foto.altText ?? "",
                        ...(foto.breite &&
                          foto.hoehe && {
                            width: String(foto.breite),
                            height: String(foto.hoehe),
                          }),
                        loading: "lazy",
                        decoding: "async",
                      }),
                    ),
                  ]
                : []),
              el(
                "div",
                { class: "station-text" },
                el("p", { class: "jahr" }, e.titel),
                ...(e.text ? [el("p", undefined, e.text)] : []),
              ),
            );
          }),
        );
      }
      if (b.daten.darstellung === "zahlen") {
        return el(
          "ul",
          { class: "zahlen" },
          ...eintraege.map((e) =>
            el(
              "li",
              undefined,
              el("strong", { class: "zahl" }, e.titel),
              ...(e.text ? [el("span", undefined, e.text)] : []),
            ),
          ),
        );
      }
      if (b.daten.darstellung === "stufen") {
        return el(
          "ul",
          { class: "stufenkarten" },
          ...eintraege.map((e) => stufenkarte(e, ebene, daten)),
        );
      }
      return b.daten.darstellung === "karten"
        ? el(
            "ul",
            { class: "karten" },
            ...eintraege.map((e) =>
              el(
                "li",
                undefined,
                el(`h${ebene}`, { class: "titel" }, e.titel),
                ...(e.text ? [el("p", undefined, e.text)] : []),
                ...(e.link === undefined
                  ? []
                  : verlinke(e.link, [`Mehr zu ${e.titel}`], "mehr").map((a) =>
                      el("p", undefined, a),
                    )),
              ),
            ),
          )
        : el(
            "ul",
            { class: "liste" },
            ...eintraege.map((e) =>
              el(
                "li",
                undefined,
                el("p", { class: "titel" }, ...verlinke(e.link, [e.titel])),
                ...(e.text ? [el("p", undefined, e.text)] : []),
              ),
            ),
          );
    }
    // Aufruf zum Handeln (#555): farbiges Band, Titel und Text links, die weisse Schaltfläche rechts (auf dem roten Band wäre eine rote unsichtbar)
    case "aufruf": {
      const ebene = Math.min(2, letzte.ebene + 1);
      letzte.ebene = ebene;
      return el(
        "div",
        { class: "aufruf" },
        el(
          "div",
          { class: "aufruf-text" },
          el(`h${ebene}`, undefined, b.daten.titel),
          ...(b.daten.text ? [el("p", undefined, b.daten.text)] : []),
        ),
        ...verlinke(b.daten.ziel, [b.daten.beschriftung], "btn w gross"),
      );
    }
    case "schaltflaeche": {
      const knopf =
        b.daten.darstellung === "schaltflaeche"
          ? `btn ${letzte.schalter++ === 0 ? "p" : "s"} gross`
          : "verweis";
      return el(
        "p",
        { class: "knopf" },
        ...verlinke(b.daten.ziel, [b.daten.beschriftung], knopf),
      );
    }
    // Verknüpfung auf die Datei im SharePoint: nur ein Link, nie eingebettet. Die Adresse prüft der Renderer noch einmal streng (die Norm-Schreibweise geht ins Markup)
    case "datei": {
      const l = pruefeLink(b.daten.link);
      if (!l.ok) return null;
      const info = [
        b.daten.typ,
        b.daten.groesse === undefined ? undefined : groesse(b.daten.groesse),
      ].filter((t) => t !== undefined);
      return el(
        "p",
        { class: "datei karte" },
        el(
          "a",
          { href: l.link, rel: "noopener noreferrer" },
          b.daten.titel,
          EXTERN_HINWEIS,
        ),
        ...(info.length > 0
          ? [" ", el("span", { class: "info" }, `(${info.join(", ")})`)]
          : []),
      );
    }
    case "kontaktperson": {
      const p = daten.personen.get(b.daten.personId);
      return p ? el("ul", { class: "kontakt" }, ...mitglieder([p])) : null;
    }
    case "leitungsteam": {
      // Eine Stufe zeigt ihre Leitung als Porträts mit Bild (#610); jedes andere Team bleibt die Liste mit Cevi-Namen
      const stufe = daten.stufenteams.get(b.daten.tagId);
      if (stufe) return personenListe(stufe, letzte);
      const t = daten.teams.get(b.daten.tagId);
      return t && t.mitglieder.length > 0
        ? el("ul", { class: "team" }, ...mitglieder(t.mitglieder))
        : null;
    }
    case "trenner":
      return b.daten.art === "linie"
        ? el("hr")
        : el("div", { class: "abstand", "aria-hidden": "true" });
    case "videolink":
      return rendereVideolink(b, daten);
    case "stufenfakten": {
      const fakten = daten.stufenfakten.get(seiteId) ?? [];
      return fakten.length === 0 ? null : faktenTafel(fakten);
    }
    // Gehört die Seite zu einem Anlass (#560), steht unter der Tafel die Schaltfläche zur Anmeldung
    case "eckdaten": {
      const tafel = faktenTafel(b.daten.eintraege);
      const anlassId = daten.anlaesse.get(seiteId);
      if (!anlassId) return tafel;
      return el(
        "div",
        { class: "eckdaten-block" },
        tafel,
        el(
          "a",
          {
            class: `btn ${letzte.schalter++ === 0 ? "p" : "s"} gross voll`,
            href: `${ANLASS_PFAD}?id=${anlassId}`,
          },
          "Zur Anmeldung",
        ),
      );
    }
    case "terminliste": {
      const liste = daten.termine.get(b.id);
      if (liste === undefined) return null;
      const ebene = Math.min(2, letzte.ebene + 1);
      letzte.ebene = ebene;
      return terminAbschnitt(liste.slice(0, b.daten.anzahl), ebene);
    }
    case "hinweis":
      return el(
        "div",
        { class: "band hinweisband", role: "status" },
        symbol("info"),
        el(
          "div",
          { class: "text" },
          el("strong", undefined, b.daten.text),
          ...(b.daten.link
            ? verlinke(
                b.daten.link.ziel,
                [b.daten.link.beschriftung],
                "verweis",
              )
            : []),
        ),
      );
    // Kontaktkarte (#555, neu gestaltet in #580, kontakt.ts)
    case "kontaktkarte": {
      const ebene = Math.min(2, letzte.ebene + 1);
      const knoten = kontaktkarte(b.daten, daten, ebene);
      if (knoten === null) return null;
      letzte.ebene = ebene;
      return knoten;
    }
  }
}

const datumsformat = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-CH", { ...o, timeZone: "UTC" });
const TAG_KURZ = datumsformat({ weekday: "short" });
const TAG_LANG = datumsformat({
  weekday: "long",
  day: "numeric",
  month: "long",
});
const DATUM_LANG = datumsformat({
  day: "numeric",
  month: "long",
  year: "numeric",
});
const MONAT_KURZ = datumsformat({ month: "short" });
const MONAT_LANG = datumsformat({ month: "long" });
const mittag = (tag: string) => new Date(`${tag}T12:00:00Z`);

// «Feb.», aber «Mai» (die Kurzform ist dort das ganze Wort)
function monatKurz(tag: string) {
  const kurz = MONAT_KURZ.format(mittag(tag));
  return kurz === MONAT_LANG.format(mittag(tag)) ? kurz : `${kurz}.`;
}

// Eine Zeile der Liste (Design W1): Datumsfeld, Titel, Zeit und Ort, Chips der Stufen. Ein Anlass führt auf seine Seite, ein Termin ohne Anlass ist keine Verknüpfung
export function terminZeile(t: TerminEintrag): HtmlKnoten {
  const zeit = t.zeitVon
    ? `${t.zeitVon}${t.zeitBis ? `–${t.zeitBis}` : ""}`
    : "ganztägig";
  const meta = [
    t.bis === t.von ? zeit : `bis ${DATUM_LANG.format(mittag(t.bis))}`,
    t.ort,
  ]
    .filter((x) => x)
    .join(" · ");
  const innen: HtmlKnoten[] = [
    el(
      "span",
      { class: "datum", "aria-hidden": "true" },
      el("span", { class: "tag" }, TAG_KURZ.format(mittag(t.von))),
      el("span", { class: "nr" }, String(Number(t.von.slice(8)))),
      el("span", { class: "mo" }, monatKurz(t.von)),
    ),
    el(
      "span",
      { class: "termin-text" },
      el("span", { class: "titel" }, t.titel),
      el("span", { class: "meta" }, meta),
      ...(t.stufen.length > 0
        ? [
            el(
              "span",
              { class: "chips" },
              ...t.stufen.map((n) => el("span", { class: "chip st" }, n)),
            ),
          ]
        : []),
    ),
  ];
  if (t.anlassId === null) return el("div", { class: "termin" }, ...innen);
  innen.push(
    el(
      "span",
      { class: "termin-pfeil", "aria-hidden": "true" },
      symbol("pfeil"),
    ),
  );
  const beschreibung = [
    TAG_LANG.format(mittag(t.von)),
    t.titel,
    meta,
    t.stufen.length > 0 ? `für ${t.stufen.join(", ")}` : "",
  ]
    .filter((x) => x)
    .join(", ");
  return el(
    "a",
    {
      class: "termin",
      href: t.seitePfad ?? `${ANLASS_PFAD}?id=${t.anlassId}`,
      "aria-label": beschreibung,
    },
    ...innen,
  );
}

function terminAbschnitt(liste: TerminEintrag[], ebene: number): HtmlKnoten {
  return el(
    "section",
    { class: "abschnitt" },
    el(
      "div",
      { class: "abschnitt-kopf" },
      el(`h${ebene}`, undefined, "Das steht an"),
      el("a", { class: "btn s", href: TERMINE_PFAD }, "Alle Termine"),
    ),
    liste.length === 0
      ? el(
          "div",
          { class: "zustand" },
          el("p", undefined, "Im Moment sind keine Termine eingetragen."),
        )
      : el(
          "ul",
          { class: "termine" },
          ...liste.map((t) => el("li", undefined, terminZeile(t))),
        ),
  );
}

export const istOeffentlich = (b: Baustein) =>
  b.sichtbarkeit === "erbt" || b.sichtbarkeit.art === "oeffentlich";

export const ANMELDEN_PFAD = "/anmelden";
export const TERMINE_PFAD = "/termine";
const ANLASS_PFAD = "/anlass";
// Adresse der Anmeldeseite mit Rückweg zur Seite; «weiter» prüft das Skript noch einmal gegen eine Liste (website/weiter.js)
const anmeldeAdresse = (pfad?: string) =>
  pfad === undefined
    ? ANMELDEN_PFAD
    : `${ANMELDEN_PFAD}?weiter=${encodeURIComponent(pfad)}`;

// Platzhalter eines geschützten Bausteins (#354): kein Typ und kein Inhalt, nur die ID und der Hinweis, den jede Person ohne Skript oder Sitzung sieht.
// Das Skript tauscht den Inhalt des Platzhalters nach der Anmeldung aus (Design W10)
function platzhalter(id: string, pfad?: string): HtmlKnoten {
  return el(
    "div",
    { "data-geschuetzt": id },
    el(
      "div",
      { class: "schutzblock" },
      el(
        "p",
        { class: "schutz" },
        symbol("schloss"),
        "Nur angemeldet sichtbar",
      ),
      el("p", undefined, "Dieser Teil ist nur für angemeldete Personen."),
      el("a", { class: "btn s", href: anmeldeAdresse(pfad) }, "Anmelden"),
    ),
  );
}

type Eintrag = { b: Baustein; knoten: HtmlKnoten | null };

// Die Seite selbst ist öffentlich (der Aufrufer prüft das); ein Baustein mit eigener, engerer Sichtbarkeit steht nie im HTML.
// Statt seiner steht der Platzhalter (siehe oben); ein Baustein ohne Inhalt (Medium fehlt, leere Daten) hat keinen Knoten
function rendereEintraege(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
  pfad?: string,
): Eintrag[] {
  const letzte = neuerStand();
  return dok.bausteine.map((b) => ({
    b,
    knoten: istOeffentlich(b)
      ? rendereBaustein(b, seiteId, daten, letzte)
      : platzhalter(b.id, pfad),
  }));
}

const istKnopf = (k: HtmlKnoten | undefined, klasse: string) =>
  typeof k === "object" && k.attr?.class === klasse;

// Schaltflächen, die unmittelbar aufeinander folgen, bilden eine Gruppe in einer Zeile (#555): Hauptaktion und Nebenaktionen gehören sichtbar zusammen.
// Eine einzelne Schaltfläche bleibt ein Absatz
function gruppiereAktionen(knoten: HtmlKnoten[]): HtmlKnoten[] {
  const aus: HtmlKnoten[] = [];
  for (const k of knoten) {
    const vor = aus.at(-1);
    if (
      typeof k === "object" &&
      typeof vor === "object" &&
      istKnopf(k, "knopf") &&
      (istKnopf(vor, "knopf") || istKnopf(vor, AKTIONEN))
    ) {
      aus[aus.length - 1] = el(
        "div",
        { class: AKTIONEN },
        ...(vor.kinder ?? []),
        ...(k.kinder ?? []),
      );
    } else {
      aus.push(k);
    }
  }
  return aus;
}
const AKTIONEN = "knopfreihe aktionen";

const alsHtml = (liste: Eintrag[]) =>
  gruppiereAktionen(liste.map((e) => e.knoten).filter((k) => k !== null))
    .map(serialisiere)
    .join("\n");

const sichtbar = (e: Eintrag) => e.knoten !== null && istOeffentlich(e.b);

// Samstagsangaben der Stufen und Eckdaten neben dem Text: Text und Bilder, die unmittelbar vor dem Baustein «stufenfakten» oder «eckdaten» stehen, bilden die linke Spalte, die Tafel die rechte (Design W2).
// Ohne solche Bausteine davor oder am Handy steht alles untereinander in der Reihenfolge der Seite
function ordneZweispaltig(eintraege: Eintrag[]): string {
  const fakten = eintraege.findIndex(
    (e) =>
      (e.b.typ === "stufenfakten" || e.b.typ === "eckdaten") && sichtbar(e),
  );
  let von = fakten;
  while (
    von > 0 &&
    ["text", "bild"].includes(eintraege[von - 1]!.b.typ) &&
    istOeffentlich(eintraege[von - 1]!.b)
  ) {
    von--;
  }
  const links = fakten < 0 ? [] : eintraege.slice(von, fakten);
  if (!links.some(sichtbar)) return alsHtml(eintraege);
  return [
    alsHtml(eintraege.slice(0, von)),
    `<div class="zweispalten">
<div class="spalte">
${alsHtml(links)}
</div>
<aside aria-label="Das Wichtigste">
${alsHtml([eintraege[fakten]!])}
</aside>
</div>`,
    alsHtml(eintraege.slice(fakten + 1)),
  ]
    .filter((t) => t !== "")
    .join("\n");
}

// Der Inhalt unter dem Seitentitel; pfad ist die Adresse der Seite für den Link «Anmelden» in den Platzhaltern
export function rendereBausteine(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
  pfad?: string,
): string {
  return ordneZweispaltig(rendereEintraege(dok, seiteId, daten, pfad));
}

// Die Abschnitte der Bausteine wie auf der Seite, ohne Titel, Kopf und Fuss: die Vorschau einzelner Bausteine im Editor (#739). Der Aufrufer prüft die Bausteine; geschützte erscheinen offen, wenn er ihre Sichtbarkeit auf «erbt» setzt
export function rendereAbschnittsfolge(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
): string {
  return rendereAbschnitte(rendereEintraege(dok, seiteId, daten, "/vorschau"));
}

// Knoten für das Nachladen (#354): die Bausteine in der Reihenfolge der Seite, für die `erlaubt` wahr ist.
// Ein Baustein ohne Inhalt (Medium fehlt, leere Daten) entfällt; die Überschriftenebene läuft über die gelieferten Bausteine
export function rendereGeschuetzte(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
  erlaubt: (b: Baustein) => boolean,
): { id: string; knoten: HtmlKnoten }[] {
  const letzte = neuerStand();
  const ergebnis: { id: string; knoten: HtmlKnoten }[] = [];
  for (const b of dok.bausteine) {
    if (!erlaubt(b)) continue;
    const knoten = rendereBaustein(b, seiteId, daten, letzte);
    if (knoten !== null) ergebnis.push({ id: b.id, knoten });
  }
  return ergebnis;
}

// Bilder im sichtbaren Bereich der Seite laden sofort; das Titelbild mit Vorrang (kein loading="lazy")
function eifrig(k: HtmlKnoten, vorrang = true): HtmlKnoten {
  if (typeof k === "string") return k;
  if (k.tag === "img") {
    const attr: Record<string, string | true> = {
      ...k.attr,
      ...(vorrang && { fetchpriority: "high" }),
      decoding: "async",
    };
    delete attr.loading;
    return { ...k, attr };
  }
  // Die verborgenen Bilder eines Karussells laden erst, wenn sie an der Reihe sind
  if (k.attr?.class === "karussell") return k;
  return { ...k, kinder: k.kinder?.map((x) => eifrig(x, vorrang)) };
}

// Startseite: Titel, erster Text und Schaltflächen am Anfang der Seite bilden den Einstieg (#555): die blaue Fahne mit Titel und Schaltflächen ragt von links ins Titelbild, der Text steht daneben auf der Fläche.
// Fehlt davon alles, bleibt es beim gewöhnlichen Titel
function rendereTeaser(
  titel: string,
  eintraege: Eintrag[],
  mitBild: boolean,
): { html: string; rest: Eintrag[] } | null {
  let i = 0;
  const nimm = (typ: string) => {
    const e = eintraege[i];
    if (e && e.b.typ === typ && sichtbar(e)) {
      i++;
      return e.knoten;
    }
    return null;
  };
  const text = nimm("text");
  const knoepfe: HtmlKnoten[] = [];
  for (let k = nimm("schaltflaeche"); k; k = nimm("schaltflaeche")) {
    if (typeof k !== "string") knoepfe.push(...(k.kinder ?? []));
  }
  if (!text && knoepfe.length === 0) return null;
  const html = `<section class="teaser${mitBild ? " teaser--ueber-bild" : ""}" aria-labelledby="h1">
<div class="wrap teaser-in">
<div class="fahne"><h1 id="h1">${esc(titel)}</h1>${knoepfe.length > 0 ? `<div class="knopfreihe">${knoepfe.map(serialisiere).join("")}</div>` : ""}</div>${text ? `\n<div class="teaser-text">${serialisiere(text)}</div>` : ""}
</div>
</section>`;
  return { html, rest: eintraege.slice(i) };
}

// ===== Abschnitte (#555): jeder Abschnitt hat einen Hintergrund über die ganze Breite, sein Inhalt steht in der fliessenden Spalte =====

// Diese Bausteine bringen ihre Überschrift und ihr Aussehen selbst mit und bilden je einen eigenen Abschnitt
const EIGENER_ABSCHNITT = new Set<Baustein["typ"]>([
  "hinweis",
  "aufruf",
  "kontaktkarte",
  "terminliste",
]);
// Nach einer Überschrift mit Bildkarten, Galerie oder Karussell steht der Inhalt unter dem Titel über die ganze Breite; sonst Titel links, Inhalt rechts.
// Merkmale und Listen sind Zeilen und stehen wie Text rechts neben dem Titel
const LISTEN_BAUSTEINE = new Set<Baustein["typ"]>([
  "karten",
  "galerie",
  "karussell",
  "bildraster",
  "bildstreifen",
  "logoreihe",
]);
const istBreit = (b: Baustein) =>
  istBreitText(b) ||
  b.typ === "artikel" ||
  b.typ === "laden" ||
  b.typ === "fotoalben" ||
  BREITE_DYNAMISCHE.has(b.typ) ||
  b.typ === "galerie" ||
  b.typ === "karussell" ||
  MEDIEN_BREIT.has(b.typ) ||
  (b.typ === "karten" &&
    (b.daten.darstellung === "karten" || b.daten.darstellung === "stufen"));
// Abschnitte ab dieser Nummer liegen unterhalb des ersten Bildschirms: ihre Bilder laden erst beim Scrollen
const EIFRIGE_ABSCHNITTE = 3;

type Gruppe = { eintraege: Eintrag[]; eigen: boolean };

const istH2 = (e: Eintrag) =>
  e.b.typ === "ueberschrift" && e.b.daten.ebene === 2;

function gruppiere(eintraege: Eintrag[]): Gruppe[] {
  const gruppen: Gruppe[] = [];
  let offen: Gruppe | null = null;
  for (const e of eintraege) {
    if (e.knoten === null) continue;
    if (sichtbar(e) && EIGENER_ABSCHNITT.has(e.b.typ)) {
      offen = { eintraege: [e], eigen: true };
      gruppen.push(offen);
      // Was nach der Kontaktkarte bis zur nächsten Überschrift folgt, steht noch in ihrem Abschnitt
      if (e.b.typ !== "kontaktkarte") offen = null;
    } else if (offen?.eigen && !istH2(e)) {
      offen.eintraege.push(e);
    } else if (offen === null || istH2(e)) {
      offen = { eintraege: [e], eigen: false };
      gruppen.push(offen);
    } else {
      offen.eintraege.push(e);
    }
  }
  return gruppen;
}

// Der Ton wechselt, wo die Art des Inhalts wechselt: Abschnitte mit Titel links (Text, Merkmale, Termine, Kontakt) teilen sich hintereinander eine Fläche und trennen sich mit einer Linie («folge»);
// Bildkarten, Galerie und Karussell heben sich mit dem anderen Ton ab. Der erste Abschnitt schliesst an den Titel der Seite an
function rendereAbschnitte(eintraege: Eintrag[]): string {
  let vor = { ton: "toenung", zeilen: false };
  return gruppiere(eintraege)
    .map((g, i) => {
      const erster = g.eintraege[0]!;
      const typ = erster.b.typ;
      if (g.eigen && (typ === "hinweis" || typ === "aufruf")) {
        vor = { ton: "toenung", zeilen: false };
        return `<section class="sektion sektion--${typ}">
<div class="wrap">
${alsHtml(g.eintraege)}
</div>
</section>`;
      }
      const liste =
        i < EIFRIGE_ABSCHNITTE
          ? g.eintraege.map((e) => ({
              ...e,
              knoten: e.knoten && eifrig(e.knoten, false),
            }))
          : g.eintraege;
      const mitKopf = !g.eigen && typ === "ueberschrift";
      const rest = liste.slice(1);
      // Merkmale und der Zeitstrahl (#560) stehen in einem Band in der Markenfarbe über die ganze Breite; danach beginnt die Fläche neu
      const marke =
        !g.eigen &&
        liste.some(
          (e) =>
            sichtbar(e) &&
            e.b.typ === "karten" &&
            (e.b.daten.darstellung === "merkmale" ||
              e.b.daten.darstellung === "zeitstrahl"),
        );
      const breit =
        marke || (!g.eigen && liste.some((e) => sichtbar(e) && istBreit(e.b)));
      const folge = !breit && vor.zeilen;
      const ton = marke
        ? "marke"
        : folge
          ? vor.ton
          : vor.ton === "flaeche"
            ? "toenung"
            : "flaeche";
      vor = marke ? { ton: "toenung", zeilen: false } : { ton, zeilen: !breit };
      const klassen = `sektion sektion--${ton}${folge ? " sektion--folge" : ""}`;
      if (g.eigen) {
        return `<section class="${klassen} sektion--${typ}">
<div class="wrap">
${alsHtml(liste)}
</div>
</section>`;
      }
      // Ein kurzer Text zwischen Titel und Karten gehört zum Titel
      const lead =
        mitKopf &&
        rest[0]?.b.typ === "text" &&
        sichtbar(rest[0]) &&
        rest.some((e) => sichtbar(e) && LISTEN_BAUSTEINE.has(e.b.typ));
      const kopf = mitKopf ? liste.slice(0, lead ? 2 : 1) : [];
      const rumpf = mitKopf ? liste.slice(lead ? 2 : 1) : liste;
      // Ohne Titel gleich unter dem Seitentitel: der Einstieg der Seite, grösser gesetzt
      const einstieg = i === 0 && !mitKopf ? " sektion--einstieg" : "";
      return `<section class="${klassen} sektion--${breit ? "breit" : "text"}${einstieg}">
<div class="wrap">
${kopf.length > 0 ? `<div class="sektion-kopf">\n${alsHtml(kopf)}\n</div>\n` : ""}<div class="sektion-rumpf">
${ordneZweispaltig(rumpf)}
</div>
</div>
</section>`;
    })
    .join("\n");
}

// ===== Rahmen: Kopf mit Menü, Fusszeile =====

// Der Kopf (Marke, Navigation, Umschalter, Menü am Handy) steht in kopf.ts (#558)

// Zweite Schicht neben den Antwortköpfen des Hosts: nur eigene Stile, Schrift und Bilder, keine Rahmen. Skripte und Verbindungen nur von der eigenen Herkunft, nie inline; Verbindungen erlaubt jede Seite mit Kopf (Konto-Menü, #669), nur der Kopf der Wartung und der Serverfehler nicht.
// Das Menü (menue.js) ist eine Verbesserung: ohne Skript öffnen sich die Untermenüs bei Hover und Fokus
export const CSP =
  "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
// Jede Seite lädt theme.js (#550) und ladezustand.js (#574), darum erlaubt ihre Meta-CSP Skripte der eigenen Herkunft; verbinden darf, wer ein Skript für Abrufe braucht und jede Seite mit Kopf (konto.js, #669)
const CSP_SEITE =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
const CSP_MIT_SKRIPT =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
export const SKRIPT_MENUE = "/website/menue.js";
// Konto-Menü im Kopf (#669): fragt nach dem Laden GET /api/v1/website/konto und tauscht «Anmelden» bei gültiger Sitzung aus; darum darf jede Seite mit Kopf verbinden (nur zur eigenen Herkunft)
export const SKRIPT_KONTO = "/website/konto-menue.js";
export const SKRIPT_THEMA = "/website/theme.js";
export const SKRIPT_LADEZUSTAND = "/website/ladezustand.js";
export { SKRIPT_KARUSSELL };
// Bausteine, deren Bilder sich gross öffnen lassen
const BILD_BAUSTEINE = new Set<string>([
  "bild",
  "galerie",
  "karussell",
  ...LICHTKASTEN_TYPEN,
]);
// Die klassischen Skripte im <head> (Darstellung, Ladezustand der Bilder #574), die die Vorschau im Editor entfernt (sie läuft unter der CSP der Verwaltung)
export const THEMA_SKRIPT_TAG = `<script src="${SKRIPT_THEMA}"></script>
<script src="${SKRIPT_LADEZUSTAND}"></script>`;
export const SKRIPT_GESCHUETZT = "/website/geschuetzt.js";
export const SKRIPT_ANMELDEN = "/website/anmelden.js";

export function rahmen(
  k: Kontext,
  {
    titel,
    aktuell,
    canonical,
    inhalt,
    robots,
    skript,
    zusatzSkripte = [],
    stile = [],
    hauptAttr = "",
    nurMarke = false,
    vollbreit = false,
  }: {
    titel: string;
    aktuell: string | null;
    canonical?: string;
    // Fertiges Markup der Seite; es steht in der Spalte der Seite («wrap»), ausser bei «vollbreit»
    inhalt: string;
    robots?: string;
    // Ein Modul oder mehrere; mit Skript erlaubt die CSP Abrufe an die eigene Herkunft
    skript?: string | string[];
    // Weitere Skripte der eigenen Herkunft ohne Abrufe (zum Beispiel das Karussell), mit defer
    zusatzSkripte?: string[];
    // Weitere Stylesheets der Website (Pfade unter /website/), nach dem Grundstil
    stile?: string[];
    // Fertig maskierte Attribute für <main> (nur Konstanten und esc())
    hauptAttr?: string;
    // Wartung und Serverfehler: nur das Logo, keine Menüs
    nurMarke?: boolean;
    // Der Inhalt bringt seine Abschnitte über die ganze Breite selbst mit (Seiten des Baums): kein Rahmen darum
    vollbreit?: boolean;
  },
) {
  // Das Menü ist nur eine Verbesserung (Pfeiltasten, Esc); die Seite funktioniert ohne
  const menue = !nurMarke && k.navigation.length > 0;
  const skripte = [
    ...(menue ? [SKRIPT_MENUE] : []),
    ...(nurMarke ? [] : [SKRIPT_KONTO]),
    ...(skript ? [skript].flat() : []),
  ]
    .map((pfad) => `\n<script type="module" src="${pfad}"></script>`)
    .join("");
  const zusatz = zusatzSkripte
    .map((s) => `\n<script src="${esc(s)}" defer></script>`)
    .join("");
  const stileHtml = stile
    .map(
      (s) => `
<link rel="stylesheet" href="${esc(s)}">`,
    )
    .join("");
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${esc(skript || !nurMarke ? CSP_MIT_SKRIPT : CSP_SEITE)}">
<meta name="referrer" content="no-referrer">${robots ? `\n<meta name="robots" content="${robots}">` : ""}
<title>${esc(titel)} | ${esc(k.abteilung)}</title>${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ""}${k.zeichen ? zeichenLinks(esc(k.zeichen)) : ""}
${THEMA_SKRIPT_TAG}
<link rel="stylesheet" href="${TOKENS_PFAD}">
<link rel="stylesheet" href="${STYLESHEET_PFAD}">
<link rel="stylesheet" href="${STIL_KOPF}">
<link rel="stylesheet" href="${STIL_FUSS}">${stileHtml}${skripte}${zusatz}
</head>
<body>
<a class="sprunglink" href="#inhalt">Zum Inhalt</a>
${kopf(k, aktuell, nurMarke)}
<main id="inhalt" tabindex="-1"${hauptAttr}>
${vollbreit ? inhalt : `<div class="wrap">\n${inhalt}\n</div>`}
</main>
${fuss(k)}
</body>
</html>
`;
}

export function rendereSeite(s: SeiteZumRendern, k: Kontext): string {
  const eintraege = rendereEintraege(s.dokument, s.id, k.daten, s.pfad);
  // Das erste Bild der Seite ist ihr Titelbild und geht bis zum Fensterrand
  const erstes = eintraege[0];
  const titelbild =
    erstes &&
    erstes.b.typ === "bild" &&
    sichtbar(erstes) &&
    typeof erstes.knoten === "object"
      ? serialisiere(
          eifrig({
            ...erstes.knoten!,
            attr: { class: "titelbild" },
            // Das Titelbild ist Kulisse, kein Bild zum Öffnen: ohne den Link zur Grossansicht
            kinder: erstes.knoten!.kinder?.flatMap((kind) =>
              typeof kind === "object" && kind.attr?.class === "bildgross"
                ? (kind.kinder ?? []).filter(
                    (x) => typeof x === "object" && x.tag === "img",
                  )
                : [kind],
            ),
          }),
        )
      : null;
  const uebrige = titelbild ? eintraege.slice(1) : eintraege;
  const teaser =
    s.pfad === "/"
      ? rendereTeaser(s.dokument.titel, uebrige, titelbild !== null)
      : null;
  const kopf = teaser
    ? `<div class="hero">${titelbild ?? ""}\n${teaser.html}</div>`
    : titelbild
      ? // Unterseite mit Titelbild: dieselbe Fahne, kleiner
        `<div class="hero hero--seite">${titelbild}\n<div class="seitenband seitenband--ueber-bild"><div class="wrap"><div class="fahne"><h1>${esc(s.dokument.titel)}</h1></div></div></div></div>`
      : `<div class="seitenband"><div class="wrap"><h1>${esc(s.dokument.titel)}</h1></div></div>`;
  const inhalt = `${kopf}\n${rendereAbschnitte(teaser ? teaser.rest : uebrige)}`;
  // Skripte und Stile für Karussell und Grossansicht (#559)
  const bilder = eintraege.some(
    (e) =>
      e.b.typ === "karussell" &&
      (!istOeffentlich(e.b) ||
        (typeof e.knoten === "object" &&
          e.knoten?.attr?.class === "karussell")),
  )
    ? {
        zusatzSkripte: [SKRIPT_LICHTKASTEN, SKRIPT_KARUSSELL],
        stile: [STIL_LICHTKASTEN, STIL_KARUSSELL],
      }
    : // Grossansicht für Bild und Galerie (auch geschützte: Die Links kommen dann beim Nachladen)
      s.dokument.bausteine.some((b) => BILD_BAUSTEINE.has(b.typ)) && {
        zusatzSkripte: [SKRIPT_LICHTKASTEN],
        stile: [STIL_LICHTKASTEN],
      };
  // Der Laden (#566) bringt Stil und Skript nur mit, wenn er öffentlich auf der Seite steht und Artikel hat
  const mitLaden = eintraege.some(
    (e) => e.b.typ === "laden" && istOeffentlich(e.b) && e.knoten !== null,
  );
  const medien = medienAnforderungen(s.dokument.bausteine);
  const geschuetzt = !s.dokument.bausteine.every(istOeffentlich);
  // Fotoalben (#690): der Baustein ist nur ein Behälter; das Skript holt die Alben nach der Anmeldung (auch in einem geschützten Baustein, den geschuetzt.js erst nachlädt)
  const mitFotos = s.dokument.bausteine.some((b) => b.typ === "fotoalben");
  return rahmen(k, {
    titel: s.dokument.titel,
    aktuell: s.pfad,
    canonical: k.basisUrl + s.pfad,
    inhalt,
    vollbreit: true,
    // Stil und Skript des Karussells nur auf Seiten, die eines zeigen oder nach der Anmeldung nachladen (das Skript rüstet nachgeladene aus)
    // Stil der Inhaltsbausteine (#560) nur auf Seiten, die einen davon haben (auch einen geschützten, der nachgeladen wird)
    // Die Fotoalben öffnen ihre Bilder in der Grossansicht (lichtkasten.js)
    // Bilder und Medien (#742): Grossansicht für Bildraster, Bildstreifen und breites Bild, dazu Stil und Skript des Bildvergleichs
    zusatzSkripte: [
      ...new Set([
        ...(bilder ? bilder.zusatzSkripte : []),
        ...(mitFotos || medien.lichtkasten ? [SKRIPT_LICHTKASTEN] : []),
        ...medien.skripte,
      ]),
    ],
    stile: [
      ...new Set([
        ...(bilder ? bilder.stile : []),
        ...(mitFotos || medien.lichtkasten ? [STIL_LICHTKASTEN] : []),
      ]),
      ...(mitFotos ? [STIL_FOTOS] : []),
      ...medien.stile,
      // Das Leitungsteam einer Stufe zeigt Porträts (#610) und braucht denselben Stil
      ...(s.dokument.bausteine.some(
        (b) => istInhaltsBaustein(b) || b.typ === "leitungsteam",
      )
        ? [STIL_INHALT]
        : []),
      ...(mitLaden ? STILE_LADEN : []),
      // Bausteine mit Daten aus Cevi OS (#740): der Stil nur auf Seiten, die einen davon zeigen
      ...(eintraege.some((e) => istDynamisch(e.b) && e.knoten !== null)
        ? [STIL_DYNAMISCH]
        : []),
    ],
    // Das Skript nur, wenn die Seite einen Platzhalter hat; es kennt die Adresse der Seite aus data-pfad
    ...((geschuetzt || mitLaden || mitFotos) && {
      skript: [
        ...(geschuetzt ? [SKRIPT_GESCHUETZT] : []),
        ...(mitLaden ? [SKRIPT_LADEN] : []),
        ...(mitFotos ? [SKRIPT_FOTOS] : []),
      ],
    }),
    ...(geschuetzt && { hauptAttr: ` data-pfad="${esc(s.pfad)}"` }),
  });
}

// Fehler- und Wartungsseiten stehen in fehlerseiten.ts (#567)

// Nur öffentliche Seiten: Der Aufrufer übergibt nur diese
export function rendereSitemap(
  basisUrl: string,
  seiten: { pfad: string; geaendert: Date }[],
): string {
  const eintraege = seiten
    .map(
      (s) =>
        `<url><loc>${esc(basisUrl + s.pfad)}</loc><lastmod>${s.geaendert.toISOString().slice(0, 10)}</lastmod></url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${eintraege}
</urlset>
`;
}

// Nennt keine einzelne Seite: Eine Sperrliste würde geschützte Adressen verraten
export const rendereRobots = (basisUrl: string) =>
  `User-agent: *\nDisallow: /api/\nDisallow: /admin\nSitemap: ${basisUrl}/sitemap.xml\n`;

// Hülle einer ganz geschützten Seite (#354): kein Titel, kein Inhalt, nur der Hinweis. Das Skript ersetzt sie nach der Anmeldung durch die Seite; ohne Sitzung bleibt der Hinweis stehen (Design W10)
export function rendereHuelle(pfad: string, k: Kontext): string {
  return rahmen(k, {
    titel: "Geschützte Seite",
    aktuell: null,
    robots: "noindex",
    // Immer dabei, damit die Hülle nichts über den Inhalt verrät: Ein nachgeladenes Karussell oder Fotoalbum findet Stil und Skript vor
    skript: [SKRIPT_GESCHUETZT, SKRIPT_FOTOS],
    hauptAttr: ` data-huelle data-pfad="${esc(pfad)}"`,
    zusatzSkripte: [SKRIPT_LICHTKASTEN, SKRIPT_KARUSSELL, SKRIPT_VERGLEICH],
    stile: [STIL_LICHTKASTEN, STIL_KARUSSELL, STIL_FOTOS, STIL_MEDIEN],
    inhalt: `<div class="seitenkopf"><h1>Geschützte Seite</h1></div>
<div class="schutzblock">
<p class="schutz">${serialisiere(symbol("schloss"))}Nur angemeldet sichtbar</p>
<p>Diese Seite ist nur für angemeldete Personen.</p>
<a class="btn p gross" href="${esc(anmeldeAdresse(pfad))}">Anmelden</a>
</div>`,
  });
}

// Anmeldeseite (#354, Design W9). Die Felder haben kein name-Attribut und das Formular sendet nichts selbst (form-action 'none'): Ein Passwort gelangt nie in eine Adresse. Das Skript sendet es als JSON an /api/auth
export function rendereAnmeldung(k: Kontext): string {
  return rahmen(k, {
    titel: "Anmelden",
    aktuell: null,
    robots: "noindex",
    skript: SKRIPT_ANMELDEN,
    inhalt: `<div class="seitenkopf"><h1>Anmelden</h1></div>
<noscript><div class="band wa">${serialisiere(symbol("warnung"))}<div class="text"><strong>Zum Anmelden braucht diese Seite JavaScript.</strong>Schalte es im Browser ein und lade die Seite neu.</div></div></noscript>
<div id="meldung"></div>
<form id="anmeldung" class="formular" method="post" action="#" novalidate>
<p class="leise">Mit demselben Konto wie in der App.</p>
<div class="feld"><label for="benutzername">Benutzername</label><input class="eingabe" id="benutzername" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
<div class="feld"><label for="passwort">Passwort</label><div class="pw"><input class="eingabe" id="passwort" type="password" autocomplete="current-password" required><button type="button" id="zeigen" aria-pressed="false" aria-label="Passwort anzeigen"><span class="auf">${serialisiere(symbol("auge"))}</span><span class="zu">${serialisiere(symbol("auge-zu"))}</span></button></div></div>
<button type="submit" class="btn p gross voll">Anmelden</button>
<p class="hilfe">Passwort vergessen? Wende dich an die Abteilungsleitung.</p>
</form>
<form id="faktor" class="formular" method="post" action="#" novalidate hidden>
<p class="leise">Schritt 2 von 2. Gib den Code aus deiner Authenticator-App ein.</p>
<div class="feld"><label for="code" id="code-label">Code aus deiner App</label><input class="eingabe code" id="code" type="text" inputmode="numeric" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required aria-describedby="code-hilfe"><p class="hilfe" id="code-hilfe">Sechs Ziffern. Einfügen geht auch.</p></div>
<button type="submit" class="btn p gross voll">Bestätigen</button>
<div class="knopfreihe"><button type="button" id="ersatz" class="btn t">Ersatzcode verwenden</button><button type="button" id="abbrechen" class="btn t">Abbrechen</button></div>
</form>`,
  });
}
