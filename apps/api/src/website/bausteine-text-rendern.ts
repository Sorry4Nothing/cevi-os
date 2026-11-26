import type { Baustein } from "./bausteine.js";
import {
  anker,
  el,
  bildQuelle,
  textBlock,
  verlinke,
  type Daten,
  type HtmlKnoten,
} from "./rendern.js";

// Renderer der Bausteine «Text und Gestaltung» (#741). Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert, Adressen laufen durch verlinke().
// Kein Skript: Die Aufklappliste ist das Element «details», die Tabelle scrollt von selbst. Stil: Abschnitt «Text und Gestaltung» in public/website/website.css.
// Nur Elemente und Attribute, die auch public/website/knoten.js für geschützte Bausteine kennt.

export const TEXT_TYPEN = [
  "hinweisbox",
  "zitat",
  "fragen",
  "spalten",
  "bildneben",
  "tabelle",
  "schritte",
  "checkliste",
] as const;
type Typ = (typeof TEXT_TYPEN)[number];
export type TextBaustein = Extract<Baustein, { typ: Typ }>;

export const istTextBaustein = (b: Baustein): b is TextBaustein =>
  (TEXT_TYPEN as readonly string[]).includes(b.typ);

// Diese Bausteine brauchen die ganze Breite des Abschnitts statt der rechten Spalte neben dem Titel
export const istBreitText = (b: Baustein): boolean =>
  b.typ === "spalten" || b.typ === "bildneben" || b.typ === "tabelle";

// Wie der Stand in rendern.ts: letzte.ebene ist die Ebene der letzten Überschrift, schalter zählt die Schaltflächen (nur die erste ist rot), anker die vergebenen IDs
type Stand = { ebene: number; schalter: number; anker: Set<string> };

export const HINWEIS_NAMEN = {
  info: "Info",
  tipp: "Tipp",
  wichtig: "Wichtig",
  achtung: "Achtung",
} as const;

// Ein Bild neben dem Namen oder dem Text: Wiederholt der Alt-Text nur den Namen, bleibt er leer (sonst liest ein Screenreader ihn doppelt). Kein Medium oder kein Bild: kein Knoten
function bildKnoten(
  id: string | undefined,
  daten: Daten,
  klasse: string,
  nebenText = "",
): HtmlKnoten | null {
  const m = id ? daten.medien.get(id) : undefined;
  if (!id || !m || !m.mimeTyp.startsWith("image/")) return null;
  const alt = (m.altText ?? "").trim();
  return el("img", {
    class: klasse,
    ...bildQuelle(id, m),
    alt: alt.toLowerCase() === nebenText.trim().toLowerCase() ? "" : alt,
    ...(m.breite &&
      m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
    loading: "lazy",
    decoding: "async",
  });
}

// Zahlen, Beträge und Prozente («1'250», «CHF 40.–», «12.5 %»): Die Spalte steht rechtsbündig, wenn alle Zellen so aussehen
const ZAHL =
  /^[+\-−–]?\s*(?:CHF\s*|Fr\.\s*)?\d[\d'’.,\s]*(?:[.,][–-])?\s*(?:%|CHF|Fr\.)?$/u;
const istZahl = (s: string) => ZAHL.test(s.trim());

function tabelle(b: Extract<TextBaustein, { typ: "tabelle" }>): HtmlKnoten {
  const d = b.daten;
  const zahlenSpalten = d.kopf.map((_, i) => {
    if (d.zeilenkopf && i === 0) return false;
    const werte = d.zeilen.map((z) => z[i] ?? "").filter((w) => w !== "");
    return werte.length > 0 && werte.every(istZahl);
  });
  const klasse = (i: number): Record<string, string> =>
    zahlenSpalten[i] ? { class: "tab-zahl" } : {};
  return el(
    "div",
    {
      class: "tabelle-rahmen",
      role: "region",
      "aria-label": d.beschriftung ?? "Tabelle",
      tabindex: "0",
    },
    el(
      "table",
      { class: "texttabelle" },
      ...(d.beschriftung ? [el("caption", undefined, d.beschriftung)] : []),
      el(
        "thead",
        undefined,
        el(
          "tr",
          undefined,
          ...d.kopf.map((k, i) => el("th", { scope: "col", ...klasse(i) }, k)),
        ),
      ),
      el(
        "tbody",
        undefined,
        ...d.zeilen.map((z) =>
          el(
            "tr",
            undefined,
            ...z.map((c, i) =>
              d.zeilenkopf && i === 0
                ? el("th", { scope: "row" }, c)
                : el("td", klasse(i), c),
            ),
          ),
        ),
      ),
    ),
  );
}

export function rendereTextBaustein(
  b: TextBaustein,
  daten: Daten,
  letzte: Stand,
): HtmlKnoten | null {
  // Überschriften der Bausteine liegen eine Ebene unter der letzten der Seite, höchstens auf Ebene 3
  const ebene = Math.min(3, letzte.ebene + 1);
  switch (b.typ) {
    // Das Wort der Art steht immer da, das Zeichen und die Farbe sind Zugabe
    case "hinweisbox":
      return el(
        "div",
        { class: `hinweisbox hinweisbox--${b.daten.art}` },
        el("span", { class: "hb-zeichen", "aria-hidden": "true" }),
        el(
          "div",
          { class: "hb-inhalt" },
          el("p", { class: "hb-art" }, HINWEIS_NAMEN[b.daten.art]),
          ...(b.daten.titel
            ? [el("p", { class: "hb-titel" }, b.daten.titel)]
            : []),
          el("div", { class: "text" }, ...b.daten.inhalt.map(textBlock)),
        ),
      );
    case "zitat": {
      const { text, person, funktion } = b.daten;
      const foto = bildKnoten(b.daten.bild, daten, "zitat-foto", person);
      const quelle = [
        ...(person ? [el("strong", { class: "zitat-name" }, person)] : []),
        ...(funktion ? [el("span", { class: "funktion" }, funktion)] : []),
      ];
      return el(
        "figure",
        { class: "zitat" },
        el(
          "blockquote",
          { class: "zitat-text" },
          el("p", undefined, `«${text}»`),
        ),
        ...(foto || quelle.length > 0
          ? [
              el(
                "figcaption",
                { class: "zitat-quelle" },
                ...(foto ? [foto] : []),
                ...(quelle.length > 0
                  ? [el("span", { class: "zitat-person" }, ...quelle)]
                  : []),
              ),
            ]
          : []),
      );
    }
    // Jede Frage hat einen Anker («/seite#wann-ist-anmeldeschluss»): Er führt zur Frage
    case "fragen":
      return el(
        "div",
        { class: "fragen" },
        ...b.daten.eintraege.map((e) => {
          const id = anker(e.frage, letzte.anker);
          return el(
            "details",
            { class: "frage", ...(id && { id }) },
            el("summary", undefined, e.frage),
            el("div", { class: "antwort text" }, ...e.antwort.map(textBlock)),
          );
        }),
      );
    case "spalten":
      return el(
        "div",
        { class: "zwei-spalten" },
        ...[b.daten.links, b.daten.rechts].map((s) =>
          el(
            "div",
            { class: "zs-spalte" },
            ...(s.titel ? [el(`h${ebene}`, { class: "titel" }, s.titel)] : []),
            el("div", { class: "text lesetext" }, ...s.inhalt.map(textBlock)),
          ),
        ),
      );
    // Fehlt das Bild (gelöscht, kein Bild), steht der Text allein
    case "bildneben": {
      const bild = bildKnoten(b.daten.mediumId, daten, "bn-foto");
      const knopf = b.daten.link
        ? verlinke(
            b.daten.link.ziel,
            [b.daten.link.beschriftung],
            `btn ${letzte.schalter++ === 0 ? "p" : "s"} gross`,
          )
        : [];
      return el(
        "div",
        {
          class: `bildneben bildneben--${b.daten.seite}${bild ? "" : " bildneben--ohne-bild"}`,
        },
        ...(bild ? [el("figure", { class: "bn-bild" }, bild)] : []),
        el(
          "div",
          { class: "bn-text" },
          ...(b.daten.titel
            ? [el(`h${ebene}`, { class: "titel" }, b.daten.titel)]
            : []),
          el(
            "div",
            { class: "text lesetext" },
            ...b.daten.inhalt.map(textBlock),
          ),
          ...(knopf.length > 0 ? [el("p", { class: "knopf" }, ...knopf)] : []),
        ),
      );
    }
    case "tabelle":
      return tabelle(b);
    // Die Zahl zeichnet der Stil (Zähler), nicht der Text: Die geordnete Liste sagt die Reihenfolge auch ohne Stil
    case "schritte":
      return el(
        "ol",
        { class: "schritte", role: "list" },
        ...b.daten.eintraege.map((e) =>
          el(
            "li",
            { class: "schritt" },
            el(
              "div",
              { class: "schritt-inhalt" },
              el("p", { class: "titel" }, e.titel),
              ...(e.text ? [el("p", undefined, e.text)] : []),
              ...(e.ziel && e.beschriftung
                ? [
                    el(
                      "p",
                      undefined,
                      ...verlinke(e.ziel, [e.beschriftung], "verweis"),
                    ),
                  ]
                : []),
            ),
          ),
        ),
      );
    case "checkliste":
      return el(
        "div",
        { class: `checkliste checkliste--${b.daten.darstellung}` },
        ...(b.daten.titel
          ? [el(`h${ebene}`, { class: "titel" }, b.daten.titel)]
          : []),
        el(
          "ul",
          { role: "list" },
          ...b.daten.eintraege.map((e) =>
            el(
              "li",
              undefined,
              el("span", { class: "cl-zeichen", "aria-hidden": "true" }),
              el("span", { class: "cl-text" }, e.text),
            ),
          ),
        ),
      );
  }
}
