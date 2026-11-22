import { pruefeLink } from "../link-pruefung.js";
import { linkArt, type Baustein, type TextBlock } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";
import { karussell, SKRIPT_KARUSSELL, STIL_KARUSSELL } from "./karussell.js";

// Renderer der Website (#351): Seitendokument zu HTML, nur aus den typisierten Knoten. Kein Nutzertext gelangt ungeprüft ins Markup:
// Jede Zeichenkette läuft durch esc(), Adressen durch linkArt() (nur https, Seitenpfade, mailto, tel) und die Medien-Adresse entsteht aus der ID der Datenbank.
// Rein und synchron: Alles, was aus der Datenbank kommt, liegt vorher in «Daten». Kein Skript, keine Schrift und keine Einbettung von aussen.

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
export type Fakt = { bezeichnung: string; wert: string };
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
};

// Angaben der Abteilung für Fuss und Kontaktkarte (#549): Name steht im Kontext, Adresse, Telefon und E-Mail kommen aus der Konfiguration des Servers, die Seiten aus dem Seitenbaum
export type Kontakt = {
  adresse?: string;
  telefon?: string;
  email?: string;
  // Adressen von Seiten des Baums; fehlt «datenschutz», führt der Link auf die Erklärung der Plattform
  impressum?: string;
  datenschutz?: string;
};

// Daten für Bausteine, die nicht im Dokument stehen. Fehlt ein Eintrag, entfällt der Baustein.
// #355 füllt «stufenfakten» (je Seiten-ID), der Auftrag Termine hängt später «terminliste» ein
export type Daten = {
  medien: ReadonlyMap<string, MedienDaten>;
  personen: ReadonlyMap<string, Mitglied>;
  teams: ReadonlyMap<string, { name: string; mitglieder: Mitglied[] }>;
  stufenfakten: ReadonlyMap<string, Fakt[]>;
  // Je Baustein «terminliste» (nach der ID des Bausteins) die kommenden Termine; fehlt der Eintrag, wurde nichts geladen und der Baustein entfällt
  termine: ReadonlyMap<string, TerminEintrag[]>;
  // Angaben der Abteilung für Kontaktkarte und Fuss (#549)
  kontakt?: Kontakt;
};
export const keineDaten = (): Daten => ({
  medien: new Map(),
  personen: new Map(),
  teams: new Map(),
  stufenfakten: new Map(),
  termine: new Map(),
});

// Logo der Abteilung (#550): ein öffentliches Bild aus der Medienbibliothek; fehlt es, zeigt der Kopf die Wortmarke
export type Logo = {
  id: string;
  altText: string | null;
  breite: number | null;
  hoehe: number | null;
};

export type Kontext = {
  abteilung: string;
  logo?: Logo;
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

const medienUrl = (id: string) => `/api/v1/medien/${id}`;

// Ein Knoten des Markups: Text (wird beim Ausgeben maskiert) oder ein Element. Dieselben Knoten gehen als JSON an das Skript, das geschützte Bausteine nachlädt (#354); dort entstehen daraus DOM-Knoten ohne innerHTML.
// attr: «true» ist ein Attribut ohne Wert (download)
export type HtmlKnoten =
  | string
  | {
      tag: string;
      attr?: Record<string, string | true>;
      kinder?: HtmlKnoten[];
    };

const el = (
  tag: string,
  attr?: Record<string, string | true>,
  ...kinder: HtmlKnoten[]
): HtmlKnoten => ({ tag, ...(attr && { attr }), kinder });

const LEERE_ELEMENTE = new Set(["img", "hr"]);

// Symbole des Designs (24er Raster, Linie). Nur in der festen Hülle der Seite und in den Platzhaltern: Das Skript für geschützte Bausteine kennt keine SVG-Elemente
const SYMBOLE: Record<string, HtmlKnoten[]> = {
  info: [
    { tag: "circle", attr: { cx: "12", cy: "12", r: "9" } },
    { tag: "path", attr: { d: "M12 11v5M12 8h.01" } },
  ],
  warnung: [
    { tag: "path", attr: { d: "M12 3 2.5 20h19L12 3z" } },
    { tag: "path", attr: { d: "M12 10v4M12 17h.01" } },
  ],
  schloss: [
    {
      tag: "rect",
      attr: { x: "5", y: "11", width: "14", height: "9", rx: "2" },
    },
    { tag: "path", attr: { d: "M8 11V8a4 4 0 0 1 8 0v3" } },
  ],
  person: [
    { tag: "circle", attr: { cx: "12", cy: "8", r: "3.5" } },
    { tag: "path", attr: { d: "M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" } },
  ],
  menue: [{ tag: "path", attr: { d: "M4 7h16M4 12h16M4 17h16" } }],
  schliessen: [{ tag: "path", attr: { d: "M6 6l12 12M18 6L6 18" } }],
  nochmals: [
    { tag: "path", attr: { d: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" } },
  ],
  auge: [
    {
      tag: "path",
      attr: { d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" },
    },
    { tag: "circle", attr: { cx: "12", cy: "12", r: "3" } },
  ],
  sonne: [
    { tag: "circle", attr: { cx: "12", cy: "12", r: "4" } },
    {
      tag: "path",
      attr: {
        d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
      },
    },
  ],
  mond: [
    { tag: "path", attr: { d: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" } },
  ],
  bildschirm: [
    {
      tag: "rect",
      attr: { x: "3", y: "4", width: "18", height: "12", rx: "2" },
    },
    { tag: "path", attr: { d: "M8 20h8M12 16v4" } },
  ],
  "auge-zu": [
    {
      tag: "path",
      attr: {
        d: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4-.9",
      },
    },
  ],
};

export const symbol = (name: keyof typeof SYMBOLE | string): HtmlKnoten =>
  el(
    "svg",
    { class: "i", viewBox: "0 0 24 24", "aria-hidden": "true" },
    ...SYMBOLE[name]!,
  );

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

function verlinke(
  ziel: string | undefined,
  innen: HtmlKnoten[],
  klasse?: string,
): HtmlKnoten[] {
  const h = ziel === undefined ? null : href(ziel);
  if (h === null) return innen;
  return [el("a", klasse ? { ...h, class: klasse } : h, ...innen)];
}

function textBlock(b: TextBlock): HtmlKnoten {
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

function groesse(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bild(
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
  });
  return el(
    "figure",
    undefined,
    img,
    ...(unterschrift ? [el("figcaption", undefined, unterschrift)] : []),
  );
}

// Anfangsbuchstaben der ersten zwei Wörter des Cevi-Namens, nur Buchstaben und Ziffern
function initialen(name: string): string {
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

// letzte.ebene: Ebene der letzten Überschrift der Seite (1 = der Seitentitel); eine neue springt höchstens eine Ebene tiefer.
// letzte.schalter: Zahl der Schaltflächen bisher; nur die erste ist rot (eine Hauptaktion je Seite)
function rendereBaustein(
  b: Baustein,
  seiteId: string,
  daten: Daten,
  letzte: { ebene: number; schalter: number },
): HtmlKnoten | null {
  switch (b.typ) {
    case "ueberschrift": {
      const ebene = Math.min(b.daten.ebene, letzte.ebene + 1);
      letzte.ebene = ebene;
      return el(`h${ebene}`, undefined, b.daten.text);
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
    // Darstellung «karten» ist die Stufenkarte des Designs (W1): Name, Text und «» Mehr zu …»; «liste» bleibt eine Zeile je Eintrag mit Link am Titel
    case "karten": {
      const ebene = Math.min(3, letzte.ebene + 1);
      return b.daten.darstellung === "karten"
        ? el(
            "ul",
            { class: "karten" },
            ...b.daten.eintraege.map((e) =>
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
            ...b.daten.eintraege.map((e) =>
              el(
                "li",
                undefined,
                el("p", { class: "titel" }, ...verlinke(e.link, [e.titel])),
                ...(e.text ? [el("p", undefined, e.text)] : []),
              ),
            ),
          );
    }
    case "schaltflaeche": {
      const knopf =
        b.daten.darstellung === "schaltflaeche"
          ? `btn ${letzte.schalter++ === 0 ? "p" : "s"} gross`
          : undefined;
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
        el("a", { href: l.link, rel: "noopener noreferrer" }, b.daten.titel),
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
      return el(
        "p",
        undefined,
        ...verlinke(b.daten.url, [b.daten.beschriftung]),
      );
    case "stufenfakten": {
      const fakten = daten.stufenfakten.get(seiteId) ?? [];
      return fakten.length === 0
        ? null
        : el(
            "dl",
            { class: "fakten karte" },
            ...fakten.map((f) =>
              el(
                "div",
                { class: "fakt" },
                el("dt", undefined, f.bezeichnung),
                el("dd", undefined, f.wert),
              ),
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
        { class: "band", role: "status" },
        symbol("info"),
        el(
          "div",
          { class: "text" },
          el("strong", undefined, b.daten.text),
          ...(b.daten.link
            ? verlinke(b.daten.link.ziel, [b.daten.link.beschriftung])
            : []),
        ),
      );
    case "kontaktkarte": {
      const p = b.daten.personId
        ? daten.personen.get(b.daten.personId)
        : undefined;
      const k = daten.kontakt;
      const wege = [
        k?.telefon ? telefonLink(k.telefon) : null,
        k?.email ? kontaktLink(`mailto:${k.email}`, k.email) : null,
      ].filter((w) => w !== null);
      if (!p && wege.length === 0) return null;
      const ebene = Math.min(2, letzte.ebene + 1);
      letzte.ebene = ebene;
      return el(
        "section",
        { class: "karte kontaktband" },
        el(
          "div",
          undefined,
          el(
            `h${ebene}`,
            undefined,
            b.daten.titel ?? "Fragen? Melde dich bei uns.",
          ),
          ...(p
            ? [
                el(
                  "p",
                  { class: "leise" },
                  p.funktion ? `${p.name}, ${p.funktion}` : p.name,
                ),
              ]
            : []),
        ),
        ...(wege.length > 0
          ? [
              el(
                "ul",
                { class: "wege" },
                ...wege.map((w) => el("li", undefined, w)),
              ),
            ]
          : []),
      );
    }
  }
}

// Telefon und E-Mail aus der Konfiguration: als Link nur, wenn die Adresse eine erlaubte Art hat
const kontaktLink = (ziel: string, text: string): HtmlKnoten =>
  verlinke(ziel, [text])[0]!;

// «043 543 96 82» wird zu tel:+41435439682 (Schweizer Nummern; mit «+» oder «00» am Anfang bleibt die Landesvorwahl)
function telefonLink(nummer: string): HtmlKnoten {
  const ziffern = nummer.replace(/[^\d+]/g, "");
  const intl = ziffern.startsWith("+")
    ? ziffern
    : ziffern.startsWith("00")
      ? `+${ziffern.slice(2)}`
      : `+41${ziffern.replace(/^0/, "")}`;
  return kontaktLink(`tel:${intl}`, nummer);
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
function terminZeile(t: TerminEintrag): HtmlKnoten {
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
      undefined,
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
      href: `${ANLASS_PFAD}?id=${t.anlassId}`,
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
      el(`h${ebene}`, undefined, "Nächste Termine"),
      el("a", { class: "mehr", href: TERMINE_PFAD }, "Alle Termine"),
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
  const letzte = { ebene: 1, schalter: 0 };
  return dok.bausteine.map((b) => ({
    b,
    knoten: istOeffentlich(b)
      ? rendereBaustein(b, seiteId, daten, letzte)
      : platzhalter(b.id, pfad),
  }));
}

const alsHtml = (liste: Eintrag[]) =>
  liste
    .map((e) => e.knoten)
    .filter((k) => k !== null)
    .map(serialisiere)
    .join("\n");

const sichtbar = (e: Eintrag) => e.knoten !== null && istOeffentlich(e.b);

// Stufenfelder neben dem Text: Text und Bilder, die unmittelbar vor dem Baustein «stufenfakten» stehen, bilden die linke Spalte, die Fakten die rechte (Design W2).
// Ohne solche Bausteine davor oder am Handy steht alles untereinander in der Reihenfolge der Seite
function ordneZweispaltig(eintraege: Eintrag[]): string {
  const fakten = eintraege.findIndex(
    (e) => e.b.typ === "stufenfakten" && sichtbar(e),
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

// Knoten für das Nachladen (#354): die Bausteine in der Reihenfolge der Seite, für die `erlaubt` wahr ist.
// Ein Baustein ohne Inhalt (Medium fehlt, leere Daten) entfällt; die Überschriftenebene läuft über die gelieferten Bausteine
export function rendereGeschuetzte(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
  erlaubt: (b: Baustein) => boolean,
): { id: string; knoten: HtmlKnoten }[] {
  const letzte = { ebene: 1, schalter: 0 };
  const ergebnis: { id: string; knoten: HtmlKnoten }[] = [];
  for (const b of dok.bausteine) {
    if (!erlaubt(b)) continue;
    const knoten = rendereBaustein(b, seiteId, daten, letzte);
    if (knoten !== null) ergebnis.push({ id: b.id, knoten });
  }
  return ergebnis;
}

// Bilder im sichtbaren Bereich der Startseite laden sofort und mit Vorrang (kein loading="lazy")
function eifrig(k: HtmlKnoten): HtmlKnoten {
  if (typeof k === "string") return k;
  if (k.tag === "img") {
    const attr: Record<string, string | true> = {
      ...k.attr,
      fetchpriority: "high",
    };
    delete attr.loading;
    return { ...k, attr };
  }
  return { ...k, kinder: k.kinder?.map(eifrig) };
}

// Startseite: Foto, Titel, erster Text und Schaltflächen am Anfang der Seite bilden das Teaser-Feld (Design W1). Fehlt davon alles, bleibt es beim gewöhnlichen Titel.
// Stehen zwei Bilder am Anfang, ist das erste das Titelbild über die ganze Breite (es steht ausserhalb der Spalte) und das zweite das Foto im Teaser
function rendereTeaser(
  titel: string,
  abteilung: string,
  eintraege: Eintrag[],
): { html: string; titelbild?: string; rest: Eintrag[] } | null {
  let i = 0;
  const nimm = (typ: string) => {
    const e = eintraege[i];
    if (e && e.b.typ === typ && sichtbar(e)) {
      i++;
      return e.knoten;
    }
    return null;
  };
  const zweiBilder =
    eintraege[0]?.b.typ === "bild" &&
    sichtbar(eintraege[0]) &&
    eintraege[1]?.b.typ === "bild" &&
    sichtbar(eintraege[1]);
  const titelbild = zweiBilder ? nimm("bild") : null;
  const foto = nimm("bild");
  const text = nimm("text");
  const knoepfe: HtmlKnoten[] = [];
  for (let k = nimm("schaltflaeche"); k; k = nimm("schaltflaeche")) {
    if (typeof k !== "string") knoepfe.push(...(k.kinder ?? []));
  }
  if (!titelbild && !foto && !text && knoepfe.length === 0) return null;
  const html = `<section class="teaser${foto ? "" : " teaser--allein"}" aria-labelledby="h1">
${foto ? serialisiere(eifrig(foto)) : ""}
<div class="box">
<p class="kicker">${esc(abteilung)}</p>
<h1 id="h1">${esc(titel)}</h1>
${text ? serialisiere(text) : ""}${knoepfe.length > 0 ? `<div class="knopfreihe">${knoepfe.map(serialisiere).join("")}</div>` : ""}
</div>
</section>`;
  return {
    html,
    ...(titelbild &&
      typeof titelbild !== "string" && {
        titelbild: serialisiere(
          eifrig({ ...titelbild, attr: { class: "titelbild" } }),
        ),
      }),
    rest: eintraege.slice(i),
  };
}

// ===== Rahmen: Kopf mit Menü, Fusszeile =====

// «Cevi Stäfa» wird zu «CEVI» und «Stäfa»: Das Logo trägt das Wort Cevi schon
const markenname = (abteilung: string) =>
  abteilung.replace(/^cevi\s+/i, "").trim() || abteilung;

const istVorfahr = (pfad: string, aktuell: string | null) =>
  aktuell !== null && pfad !== "/" && aktuell.startsWith(`${pfad}/`);

function navLink(p: NavPunkt, aktuell: string | null): string {
  const stand =
    p.pfad === aktuell
      ? ' aria-current="page"'
      : istVorfahr(p.pfad, aktuell)
        ? ' aria-current="true"'
        : "";
  return `<a href="${esc(p.pfad)}"${stand}>${esc(p.titel)}</a>`;
}

// tief: auch die Unterseiten (im Menü am Handy); sonst nur die oberste Ebene
function navigation(
  punkte: NavPunkt[],
  aktuell: string | null,
  tief: boolean,
): string {
  if (punkte.length === 0) return "";
  return `<ul>${punkte
    .map(
      (p) =>
        `<li>${navLink(p, aktuell)}${tief ? navigation(p.kinder, aktuell, true) : ""}</li>`,
    )
    .join("")}</ul>`;
}

// Umschalter Hell, Dunkel, System (#550): ohne Skript bleibt er verborgen (hidden), website/theme.js zeigt ihn und merkt die Wahl im Browser
const THEMA_WAHL: [string, string, string][] = [
  ["system", "bildschirm", "System"],
  ["light", "sonne", "Hell"],
  ["dark", "mond", "Dunkel"],
];
const themaSchalter = () =>
  `<div class="thema" role="group" aria-label="Darstellung" hidden>${THEMA_WAHL.map(
    ([wert, icon, name]) =>
      `<button type="button" data-thema="${wert}" aria-pressed="false">${serialisiere(symbol(icon))}<span>${name}</span></button>`,
  ).join("")}</div>`;

// Mit Logo trägt das Bild die Marke (das Logo der Abteilung enthält ihren Namen); der Name bleibt für Screenreader im Link. Ohne Logo steht die Wortmarke
function markeHtml(k: Kontext): string {
  const name = esc(markenname(k.abteilung));
  if (!k.logo) {
    return `<a class="marke" href="/"><b>CEVI</b><span>${name}</span></a>`;
  }
  const { id, altText, breite, hoehe } = k.logo;
  const mass = breite && hoehe ? ` width="${breite}" height="${hoehe}"` : "";
  return `<a class="marke marke--logo" href="/"><img class="logo" src="${medienUrl(id)}" alt="${esc(altText ?? "")}"${mass}><span class="nur-sr">${name}</span></a>`;
}

// Die Leiste am Computer hat eine Zeile: Was nicht hineinpasst, steht unter «Mehr».
// shortcut: Platz schätzt die Zahl der Zeichen aller Titel (CSS kann keinen Überlauf ins Menü schieben); bei sehr langen Titeln bricht die Leiste ab 74 em ins Menü am Handy um, wo alles steht
const MAX_HAUPTPUNKTE = 6;
const MAX_NAV_ZEICHEN = 80;

function teileNavigation(punkte: NavPunkt[]) {
  let zeichen = 0;
  let n = punkte.findIndex((p, i) => {
    zeichen += p.titel.length;
    return i >= MAX_HAUPTPUNKTE || zeichen > MAX_NAV_ZEICHEN;
  });
  if (n === -1) n = punkte.length;
  n = Math.max(n, 1);
  return { leiste: punkte.slice(0, n), mehr: punkte.slice(n) };
}

const istHier = (p: NavPunkt, aktuell: string | null): boolean =>
  p.pfad === aktuell ||
  istVorfahr(p.pfad, aktuell) ||
  p.kinder.some((k) => istHier(k, aktuell));

// Unterseiten ohne Skript: Sie öffnen sich bei Hover und Fokus (CSS); menue.js ergänzt Pfeiltasten und Esc
function hauptPunkt(p: NavPunkt, aktuell: string | null): string {
  if (p.kinder.length === 0) return `<li>${navLink(p, aktuell)}</li>`;
  return `<li class="mit-unter">${navLink(p, aktuell)}<ul class="unter">${p.kinder
    .map((k) => `<li>${navLink(k, aktuell)}</li>`)
    .join("")}</ul></li>`;
}

// «Mehr» ist ein details-Element und braucht kein Skript; die Unterseiten der Punkte darin stehen eingerückt darunter
function mehrPunkt(punkte: NavPunkt[], aktuell: string | null): string {
  const liste = (ps: NavPunkt[]): string =>
    `<ul>${ps
      .map(
        (p) =>
          `<li>${navLink(p, aktuell)}${p.kinder.length > 0 ? liste(p.kinder) : ""}</li>`,
      )
      .join("")}</ul>`;
  return `<li class="mit-unter weitere${punkte.some((p) => istHier(p, aktuell)) ? " hier" : ""}"><details><summary>Mehr</summary>${liste(punkte).replace("<ul>", '<ul class="unter">')}</details></li>`;
}

function hauptNavigation(punkte: NavPunkt[], aktuell: string | null): string {
  if (punkte.length === 0) return "";
  const { leiste, mehr } = teileNavigation(punkte);
  return `<ul>${leiste.map((p) => hauptPunkt(p, aktuell)).join("")}${mehr.length > 0 ? mehrPunkt(mehr, aktuell) : ""}</ul>`;
}

function kopf(k: Kontext, aktuell: string | null, nurMarke: boolean): string {
  const marke = `<div class="kopf"><div class="wrap kopf-in">${markeHtml(k)}${themaSchalter()}</div></div>`;
  if (nurMarke)
    return `<header>
${marke}
</header>`;
  // Die Unterseiten des gewählten Bereichs stehen in einer zweiten Leiste
  const bereich = k.navigation.find(
    (p) =>
      p.kinder.length > 0 &&
      (p.pfad === aktuell || istVorfahr(p.pfad, aktuell)),
  );
  return `<header>
${marke}
<div class="leiste"><div class="wrap leiste-in">
<nav class="hauptnav" aria-label="Hauptnavigation">${hauptNavigation(k.navigation, aktuell)}</nav>
<details class="menue-mobil"><summary>${serialisiere(symbol("menue"))}<span class="auf">Menü</span><span class="zu">Schliessen</span></summary><nav aria-label="Menü">${navigation(k.navigation, aktuell, true)}</nav></details>
<div class="rechts"><a href="${ANMELDEN_PFAD}">${serialisiere(symbol("person"))}Anmelden</a></div>
</div></div>${
    bereich
      ? `
<nav class="unterleiste" aria-label="Unterseiten von ${esc(bereich.titel)}"><div class="wrap">${navigation(bereich.kinder, aktuell, false)}</div></nav>`
      : ""
  }
</header>`;
}

// Fuss nach dem Design (W1): Name und Adresse, Telefon und E-Mail, Impressum und Datenschutz, dazu «©». Angaben, die es nicht gibt, fehlen; ein Impressum nennt der Fuss nur, wenn es die Seite gibt
const fuss = (k: Kontext) => {
  const c = k.daten.kontakt ?? {};
  const wege = [
    c.telefon ? serialisiere(telefonLink(c.telefon)) : "",
    c.email ? serialisiere(kontaktLink(`mailto:${c.email}`, c.email)) : "",
  ].filter((w) => w !== "");
  const recht = [
    c.impressum ? `<a href="${esc(c.impressum)}">Impressum</a>` : "",
    `<a href="${esc(c.datenschutz ?? "/datenschutz")}">Datenschutz</a>`,
  ].filter((w) => w !== "");
  return `<footer class="fuss">
<div class="wrap"><div class="fuss-in">
<div><strong>${esc(k.abteilung)}</strong>${c.adresse ? `<p>${esc(c.adresse)}</p>` : ""}</div>${
    wege.length > 0
      ? `
<div>${wege.map((w) => `<p>${w}</p>`).join("")}</div>`
      : ""
  }
<div>${recht.map((w) => `<p>${w}</p>`).join("")}</div>
</div>
<p class="klein leise">© ${new Date().getFullYear()} ${esc(k.abteilung)}</p></div>
</footer>`;
};

// Zweite Schicht neben den Antwortköpfen des Hosts: nur eigene Stile, Schrift und Bilder, keine Rahmen. Skripte und Verbindungen nur auf Seiten mit Skript (#354) und nur von der eigenen Herkunft, nie inline.
// Das Menü (menue.js) ist eine Verbesserung: ohne Skript öffnen sich die Untermenüs bei Hover und Fokus
export const CSP =
  "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
// Jede Seite lädt theme.js (#550), darum erlaubt ihre Meta-CSP Skripte der eigenen Herkunft; verbinden darf nur, wer ein Skript für Abrufe braucht
const CSP_SEITE =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
const CSP_MIT_SKRIPT =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
export const SKRIPT_MENUE = "/website/menue.js";
export const SKRIPT_THEMA = "/website/theme.js";
export { SKRIPT_KARUSSELL };
// Das Tag, das die Vorschau im Editor entfernt (sie läuft unter der CSP der Verwaltung)
export const THEMA_SKRIPT_TAG = `<script src="${SKRIPT_THEMA}"></script>`;
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
    titelbild = "",
  }: {
    titel: string;
    aktuell: string | null;
    canonical?: string;
    // Fertiges Markup der Seite; es steht in der Spalte der Seite («wrap»)
    inhalt: string;
    robots?: string;
    skript?: string;
    // Weitere Skripte der eigenen Herkunft ohne Abrufe (zum Beispiel das Karussell), mit defer
    zusatzSkripte?: string[];
    // Weitere Stylesheets der Website (Pfade unter /website/), nach dem Grundstil
    stile?: string[];
    // Fertig maskierte Attribute für <main> (nur Konstanten und esc())
    hauptAttr?: string;
    // Wartung und Serverfehler: nur das Logo, keine Menüs
    nurMarke?: boolean;
    // Fertiges Markup eines Bildes über die ganze Breite, vor der Spalte der Seite (Startseite)
    titelbild?: string;
  },
) {
  // Das Menü ist nur eine Verbesserung (Pfeiltasten, Esc); die Seite funktioniert ohne
  const menue = !nurMarke && k.navigation.length > 0;
  const skripte = [
    ...(menue ? [SKRIPT_MENUE] : []),
    ...(skript ? [skript] : []),
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
<meta http-equiv="Content-Security-Policy" content="${esc(skript ? CSP_MIT_SKRIPT : CSP_SEITE)}">
<meta name="referrer" content="no-referrer">${robots ? `\n<meta name="robots" content="${robots}">` : ""}
<title>${esc(titel)} | ${esc(k.abteilung)}</title>${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ""}
${THEMA_SKRIPT_TAG}
<link rel="stylesheet" href="${STYLESHEET_PFAD}">${stileHtml}${skripte}${zusatz}
</head>
<body>
<a class="sprunglink" href="#inhalt">Zum Inhalt</a>
${kopf(k, aktuell, nurMarke)}
<main id="inhalt" tabindex="-1"${hauptAttr}>${titelbild ? `\n${titelbild}` : ""}
<div class="wrap">
${inhalt}
</div>
</main>
${fuss(k)}
</body>
</html>
`;
}

export function rendereSeite(s: SeiteZumRendern, k: Kontext): string {
  const eintraege = rendereEintraege(s.dokument, s.id, k.daten, s.pfad);
  const teaser =
    s.pfad === "/"
      ? rendereTeaser(s.dokument.titel, k.abteilung, eintraege)
      : null;
  const inhalt = teaser
    ? `${teaser.html}\n<div class="inhalt">\n${ordneZweispaltig(teaser.rest)}\n</div>`
    : `<div class="seitenkopf"><h1>${esc(s.dokument.titel)}</h1></div>\n<div class="inhalt">\n${ordneZweispaltig(eintraege)}\n</div>`;
  return rahmen(k, {
    titel: s.dokument.titel,
    aktuell: s.pfad,
    canonical: k.basisUrl + s.pfad,
    inhalt,
    // Stil und Skript des Karussells nur auf Seiten, die eines zeigen oder nach der Anmeldung nachladen (das Skript rüstet nachgeladene aus)
    ...(eintraege.some(
      (e) =>
        e.b.typ === "karussell" &&
        (!istOeffentlich(e.b) ||
          (typeof e.knoten === "object" &&
            e.knoten?.attr?.class === "karussell")),
    ) && {
      zusatzSkripte: [SKRIPT_KARUSSELL],
      stile: [STIL_KARUSSELL],
    }),
    ...(teaser?.titelbild && { titelbild: teaser.titelbild }),
    // Das Skript nur, wenn die Seite einen Platzhalter hat; es kennt die Adresse der Seite aus data-pfad
    ...(!s.dokument.bausteine.every(istOeffentlich) && {
      skript: SKRIPT_GESCHUETZT,
      hauptAttr: ` data-pfad="${esc(s.pfad)}"`,
    }),
  });
}

// Fehler- und Wartungsseiten (Design W4): ein grosser Satz, was nun geht, kein Fachwort. Ohne Skript: «Nochmals versuchen» ist ein Link auf dieselbe Adresse
const fehlerKopf = (
  titel: string,
  text: string,
  nachher: string,
  code: string,
) => `<div class="seitenkopf seitenkopf--fehler">
<h1>${esc(titel)}</h1>
<p class="unter">${esc(text)}</p>
${nachher}
<p class="klein leise">${esc(code)}</p>
</div>`;

const nochmals = `<a class="btn p gross" href="">${serialisiere(symbol("nochmals"))}Nochmals versuchen</a>`;

// 404.html: der Host liefert sie bei unbekannten Adressen; sie verrät nichts über geschützte Seiten
export function rendereFehlerseite(k: Kontext): string {
  return rahmen(k, {
    titel: "Seite nicht gefunden",
    aktuell: null,
    robots: "noindex",
    inhalt: fehlerKopf(
      "Diese Seite gibt es nicht.",
      "Vielleicht ist der Link alt oder hat einen Tippfehler. Von hier aus kommst du weiter:",
      `<div class="knopfreihe"><a class="btn p gross" href="/">Zur Startseite</a></div>${
        k.navigation.length > 0
          ? `\n<nav aria-label="Hauptpunkte" class="hauptpunkte">${navigation(k.navigation, null, false)}</nav>`
          : ""
      }`,
      "Fehler 404",
    ),
  });
}

// 500.html: der Host liefert sie, wenn die Website selbst nicht antwortet
export function rendereServerfehler(k: Kontext): string {
  return rahmen(k, {
    titel: "Fehler",
    aktuell: null,
    robots: "noindex",
    nurMarke: true,
    inhalt: fehlerKopf(
      "Bei uns ist etwas schiefgegangen.",
      "Versuche es in ein paar Minuten nochmals.",
      `<div class="knopfreihe">${nochmals}<a class="btn s gross" href="/">Zur Startseite</a></div>`,
      "Fehler 500",
    ),
  });
}

// wartung.html: der Host liefert sie mit dem Status 503, wenn die Website gewartet wird
export function rendereWartung(k: Kontext): string {
  return rahmen(k, {
    titel: "Wartung",
    aktuell: null,
    robots: "noindex",
    nurMarke: true,
    inhalt: fehlerKopf(
      "Wir sind gleich wieder da.",
      "Die Website wird gerade aktualisiert. Versuche es in ein paar Minuten nochmals.",
      `<div class="knopfreihe">${nochmals}</div>`,
      "Fehler 503",
    ),
  });
}

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
    skript: SKRIPT_GESCHUETZT,
    hauptAttr: ` data-huelle data-pfad="${esc(pfad)}"`,
    // Immer dabei, damit die Hülle nichts über den Inhalt verrät: Ein nachgeladenes Karussell findet Stil und Skript vor
    zusatzSkripte: [SKRIPT_KARUSSELL],
    stile: [STIL_KARUSSELL],
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
