import { pruefeLink } from "../link-pruefung.js";
import { linkArt, type Baustein, type TextBlock } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";

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

// Daten für Bausteine, die nicht im Dokument stehen. Fehlt ein Eintrag, entfällt der Baustein.
// #355 füllt «stufenfakten» (je Seiten-ID), der Auftrag Termine hängt später «terminliste» ein
export type Daten = {
  medien: ReadonlyMap<string, MedienDaten>;
  personen: ReadonlyMap<string, Mitglied>;
  teams: ReadonlyMap<string, { name: string; mitglieder: Mitglied[] }>;
  stufenfakten: ReadonlyMap<string, Fakt[]>;
};
export const keineDaten = (): Daten => ({
  medien: new Map(),
  personen: new Map(),
  teams: new Map(),
  stufenfakten: new Map(),
});

export type Kontext = {
  abteilung: string;
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
    case "karten":
      return el(
        "ul",
        { class: b.daten.darstellung },
        ...b.daten.eintraege.map((e) =>
          el(
            "li",
            undefined,
            el("p", { class: "titel" }, ...verlinke(e.link, [e.titel])),
            ...(e.text ? [el("p", undefined, e.text)] : []),
          ),
        ),
      );
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
    // Die Termine liefert der Auftrag Termine; bis dahin bleibt der Platz leer
    case "terminliste":
      return null;
  }
}

export const istOeffentlich = (b: Baustein) =>
  b.sichtbarkeit === "erbt" || b.sichtbarkeit.art === "oeffentlich";

export const ANMELDEN_PFAD = "/anmelden";
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

// Startseite: Foto, Titel, erster Text und Schaltflächen am Anfang der Seite bilden das Teaser-Feld (Design W1). Fehlt davon alles, bleibt es beim gewöhnlichen Titel
function rendereTeaser(
  titel: string,
  abteilung: string,
  eintraege: Eintrag[],
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
  const foto = nimm("bild");
  const text = nimm("text");
  const knoepfe: HtmlKnoten[] = [];
  for (let k = nimm("schaltflaeche"); k; k = nimm("schaltflaeche")) {
    if (typeof k !== "string") knoepfe.push(...(k.kinder ?? []));
  }
  if (!foto && !text && knoepfe.length === 0) return null;
  const html = `<section class="teaser${foto ? "" : " teaser--allein"}" aria-labelledby="h1">
${foto ? serialisiere(foto) : ""}
<div class="box">
<p class="kicker">${esc(abteilung)}</p>
<h1 id="h1">${esc(titel)}</h1>
${text ? serialisiere(text) : ""}${knoepfe.length > 0 ? `<div class="knopfreihe">${knoepfe.map(serialisiere).join("")}</div>` : ""}
</div>
</section>`;
  return { html, rest: eintraege.slice(i) };
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

function kopf(k: Kontext, aktuell: string | null, nurMarke: boolean): string {
  const marke = `<div class="kopf"><div class="wrap kopf-in"><a class="marke" href="/"><b>CEVI</b><span>${esc(markenname(k.abteilung))}</span></a></div></div>`;
  if (nurMarke) return `<header>\n${marke}\n</header>`;
  // Die Unterseiten des gewählten Bereichs stehen in einer zweiten Leiste
  const bereich = k.navigation.find(
    (p) =>
      p.kinder.length > 0 &&
      (p.pfad === aktuell || istVorfahr(p.pfad, aktuell)),
  );
  return `<header>
${marke}
<div class="leiste"><div class="wrap leiste-in">
<nav class="hauptnav" aria-label="Hauptnavigation">${navigation(k.navigation, aktuell, false)}</nav>
<details class="menue-mobil"><summary>${serialisiere(symbol("menue"))}<span class="auf">Menü</span><span class="zu">Menü schliessen</span></summary><nav aria-label="Menü">${navigation(k.navigation, aktuell, true)}</nav></details>
<div class="rechts"><a href="${ANMELDEN_PFAD}">${serialisiere(symbol("person"))}Anmelden</a></div>
</div></div>${
    bereich
      ? `\n<nav class="unterleiste" aria-label="Unterseiten von ${esc(bereich.titel)}"><div class="wrap">${navigation(bereich.kinder, aktuell, false)}</div></nav>`
      : ""
  }
</header>`;
}

// Die Adresse und die Kontaktdaten der Abteilung stehen nicht in der Konfiguration; die Fusszeile nennt nur, was die Website sicher weiss
const fuss = (k: Kontext) => `<footer class="fuss">
<div class="wrap"><div class="fuss-in">
<div><strong>${esc(k.abteilung)}</strong></div>
<div><p><a href="/datenschutz">Datenschutz</a></p></div>
</div></div>
</footer>`;

// Zweite Schicht neben den Antwortköpfen des Hosts: nur eigene Stile und Bilder, keine Rahmen. Skripte und Verbindungen nur auf Seiten mit Skript (#354) und nur von der eigenen Herkunft, nie inline
export const CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
const CSP_MIT_SKRIPT =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
export const SKRIPT_GESCHUETZT = "/website/geschuetzt.js";
export const SKRIPT_ANMELDEN = "/website/anmelden.js";

function rahmen(
  k: Kontext,
  {
    titel,
    aktuell,
    canonical,
    inhalt,
    robots,
    skript,
    hauptAttr = "",
    nurMarke = false,
  }: {
    titel: string;
    aktuell: string | null;
    canonical?: string;
    // Fertiges Markup der Seite; es steht in der Spalte der Seite («wrap»)
    inhalt: string;
    robots?: string;
    skript?: string;
    // Fertig maskierte Attribute für <main> (nur Konstanten und esc())
    hauptAttr?: string;
    // Wartung und Serverfehler: nur das Logo, keine Menüs
    nurMarke?: boolean;
  },
) {
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${esc(skript ? CSP_MIT_SKRIPT : CSP)}">
<meta name="referrer" content="no-referrer">${robots ? `\n<meta name="robots" content="${robots}">` : ""}
<title>${esc(titel)} | ${esc(k.abteilung)}</title>${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ""}
<link rel="stylesheet" href="${STYLESHEET_PFAD}">${skript ? `\n<script type="module" src="${skript}"></script>` : ""}
</head>
<body>
<a class="sprunglink" href="#inhalt">Zum Inhalt</a>
${kopf(k, aktuell, nurMarke)}
<main id="inhalt" tabindex="-1"${hauptAttr}>
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
