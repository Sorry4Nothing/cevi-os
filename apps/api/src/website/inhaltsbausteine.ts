import type { Baustein } from "./bausteine.js";
import {
  el,
  initialen,
  medienUrl,
  verlinke,
  type Daten,
  type HtmlKnoten,
} from "./rendern.js";

// Bausteine der Inhaltsseiten (#560): Eckdaten und Kennzahlen, Zeitstrahl, Personen, Artikel. Stil: public/website/inhalt.css.
// Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert, Adressen laufen durch verlinke().

export const STIL_INHALT = "/website/inhalt.css";
export const INHALT_TYPEN = [
  "eckdaten",
  "zeitstrahl",
  "personen",
  "artikel",
] as const;
type Typ = (typeof INHALT_TYPEN)[number];
export type InhaltsBaustein = Extract<Baustein, { typ: Typ }>;

export const istInhaltsBaustein = (b: Baustein): b is InhaltsBaustein =>
  (INHALT_TYPEN as readonly string[]).includes(b.typ);

// Adresse der Anmeldung eines Anlasses (Seite aus termine-seiten.ts); die ID kommt aus der Datenbank
const anmeldungPfad = (anlassId: string) => `/anlass?id=${anlassId}`;

// Das Bild steht neben seinem Namen: Wiederholt der Alt-Text nur den Namen, bleibt er leer (sonst liest ein Screenreader ihn doppelt)
function foto(
  id: string | undefined,
  daten: Daten,
  nebenText: string,
  immerLeer = false,
): HtmlKnoten | null {
  const m = id ? daten.medien.get(id) : undefined;
  if (!id || !m || !m.mimeTyp.startsWith("image/")) return null;
  const alt = (m.altText ?? "").trim();
  return el("img", {
    src: medienUrl(id),
    alt:
      immerLeer || alt.toLowerCase() === nebenText.trim().toLowerCase()
        ? ""
        : alt,
    ...(m.breite &&
      m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
    loading: "lazy",
    decoding: "async",
  });
}

// seiteId: Gehört die Seite zu einem Anlass, steht unter den Eckdaten die Schaltfläche zur Anmeldung (weiss auf dem blauen Feld).
// letzte.ebene: Ebene der letzten Überschrift der Seite; Titel in Zeitstrahl und Artikeln liegen eine darunter
export function rendereInhaltsBaustein(
  b: InhaltsBaustein,
  seiteId: string,
  daten: Daten,
  letzte: { ebene: number },
): HtmlKnoten {
  const ebene = Math.min(3, letzte.ebene + 1);
  switch (b.typ) {
    case "eckdaten": {
      const zahlen = b.daten.darstellung === "zahlen";
      const liste = el(
        "dl",
        { class: zahlen ? "kennzahlen" : "eckdaten" },
        ...b.daten.eintraege.map((e) =>
          el(
            "div",
            { class: zahlen ? "kennzahl" : "eckdatum" },
            el("dt", undefined, e.bezeichnung),
            el("dd", undefined, ...verlinke(e.link, [e.wert])),
          ),
        ),
      );
      if (zahlen) return liste;
      const anlassId = daten.anlaesse.get(seiteId);
      return el(
        "div",
        { class: "eckdaten-block" },
        liste,
        ...(anlassId
          ? [
              el(
                "p",
                { class: "eckdaten-aktion" },
                el(
                  "a",
                  { class: "btn gross", href: anmeldungPfad(anlassId) },
                  "Zur Anmeldung",
                ),
              ),
            ]
          : []),
      );
    }
    case "zeitstrahl":
      return el(
        "ol",
        { class: "zeitstrahl" },
        ...b.daten.eintraege.map((e) =>
          el(
            "li",
            undefined,
            el("p", { class: "zeit" }, e.zeit),
            el(`h${ebene}`, { class: "titel" }, e.titel),
            ...(e.text ? [el("p", undefined, e.text)] : []),
          ),
        ),
      );
    case "personen":
      return el(
        "ul",
        { class: "personen" },
        ...b.daten.eintraege.map((e) =>
          el(
            "li",
            { class: "kontaktperson" },
            // Das Porträt trägt keinen Inhalt, den der Name daneben nicht nennt
            foto(e.mediumId, daten, e.name, true) ??
              el(
                "span",
                { class: "ava", "aria-hidden": "true" },
                initialen(e.name),
              ),
            el(
              "div",
              { class: "kontaktperson-text" },
              el("p", { class: "name" }, e.name),
              ...(e.funktion
                ? [el("p", { class: "funktion" }, e.funktion)]
                : []),
              ...(e.email
                ? [
                    el(
                      "p",
                      { class: "adresse" },
                      ...verlinke(`mailto:${e.email}`, [e.email]),
                    ),
                  ]
                : []),
            ),
          ),
        ),
      );
    case "artikel":
      return el(
        "ul",
        { class: "artikel" },
        ...b.daten.eintraege.map((e) => {
          const bild = foto(e.mediumId, daten, e.name);
          return el(
            "li",
            undefined,
            el(
              "div",
              {
                class: bild
                  ? "artikel-bild"
                  : "artikel-bild artikel-bild--leer",
              },
              ...(bild ? [bild] : []),
            ),
            el(
              "div",
              { class: "artikel-text" },
              el(`h${ebene}`, { class: "name" }, e.name),
              ...(e.preis ? [el("p", { class: "preis" }, e.preis)] : []),
              ...(e.hinweis ? [el("p", { class: "hinweis" }, e.hinweis)] : []),
            ),
          );
        }),
      );
  }
}
