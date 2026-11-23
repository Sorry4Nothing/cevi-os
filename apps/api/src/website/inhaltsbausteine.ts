import type { Baustein } from "./bausteine.js";
import {
  el,
  initialen,
  medienUrl,
  verlinke,
  type Daten,
  type HtmlKnoten,
} from "./rendern.js";

// Bausteine der Inhaltsseiten (#560): Personen und Artikel. Stil: public/website/inhalt.css (Artikel, Adresse) und website.css (Porträtkarten aus #555).
// Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert, Adressen laufen durch verlinke().

export const STIL_INHALT = "/website/inhalt.css";
export const INHALT_TYPEN = ["personen", "artikel"] as const;
type Typ = (typeof INHALT_TYPEN)[number];
export type InhaltsBaustein = Extract<Baustein, { typ: Typ }>;

export const istInhaltsBaustein = (b: Baustein): b is InhaltsBaustein =>
  (INHALT_TYPEN as readonly string[]).includes(b.typ);

// Das Bild steht neben seinem Namen: Wiederholt der Alt-Text nur den Namen, bleibt er leer (sonst liest ein Screenreader ihn doppelt)
function foto(
  id: string | undefined,
  daten: Daten,
  nebenText: string,
): HtmlKnoten | null {
  const m = id ? daten.medien.get(id) : undefined;
  if (!id || !m || !m.mimeTyp.startsWith("image/")) return null;
  const alt = (m.altText ?? "").trim();
  return el("img", {
    src: medienUrl(id),
    alt: alt.toLowerCase() === nebenText.trim().toLowerCase() ? "" : alt,
    ...(m.breite &&
      m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
    loading: "lazy",
    decoding: "async",
  });
}

// letzte.ebene: Ebene der letzten Überschrift der Seite; Namen von Personen und Artikeln liegen eine darunter
export function rendereInhaltsBaustein(
  b: InhaltsBaustein,
  daten: Daten,
  letzte: { ebene: number },
): HtmlKnoten | null {
  const ebene = Math.min(3, letzte.ebene + 1);
  switch (b.typ) {
    // Der Anzeigename (Cevi-Name oder Vorname) ist die Hauptzeile, Funktion und Adresse stehen klein darunter
    case "personen": {
      // Nur freigegebene Personen (#560): Wer nicht in den Daten steht, erscheint gar nicht, auch nicht mit Namen
      const eintraege = b.daten.eintraege.flatMap((e) => {
        const p = daten.websitePersonen.get(e.personId.toLowerCase());
        return p ? [{ ...e, ...p }] : [];
      });
      if (eintraege.length === 0) return null;
      return el(
        "ul",
        { class: "personen" },
        ...eintraege.map((e) => {
          // Das Profilbild trägt keinen Inhalt, den der Name daneben nicht nennt; der Rahmen schneidet es zu, damit es beim Zeigen wachsen kann. «einblenden» ist die Bewegung der Grundlage (#555)
          return el(
            "li",
            { class: "einblenden" },
            el(
              "span",
              { class: "portraet-rahmen" },
              e.bild
                ? el("img", {
                    class: "portraet",
                    src: e.bild,
                    alt: "",
                    width: "256",
                    height: "256",
                    loading: "lazy",
                    decoding: "async",
                  })
                : el(
                    "span",
                    { class: "portraet portraet--leer", "aria-hidden": "true" },
                    initialen(e.name),
                  ),
            ),
            el(`h${ebene}`, { class: "titel" }, e.name),
            ...(e.funktion ? [el("p", undefined, e.funktion)] : []),
            ...(e.email
              ? [
                  el(
                    "p",
                    { class: "adresse" },
                    ...verlinke(`mailto:${e.email}`, [e.email]),
                  ),
                ]
              : []),
          );
        }),
      );
    }
    case "artikel":
      return el(
        "ul",
        { class: "artikel" },
        ...b.daten.eintraege.map((e) => {
          const bild = foto(e.mediumId, daten, e.name);
          return el(
            "li",
            { class: "einblenden" },
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
