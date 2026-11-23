import { preisText } from "../laden/laden.js";
import {
  ANMELDEN_PFAD,
  el,
  medienUrl,
  type Daten,
  type HtmlKnoten,
} from "./rendern.js";
import { symbol } from "./symbole.js";

// Baustein «laden» (#566): das Lädeli der Abteilung als Raster. Die Artikel kommen beim Abgleich aus der Datenbank (laden/laden.ts: ladeLadenDaten), ein Besuch löst keine Abfrage aus.
// Ohne Skript und ohne Anmeldung ist es eine Preisliste mit dem Hinweis, dass Bestellen eine Anmeldung braucht. Das Skript (public/website/laden.js) liest Artikel-ID, Preis und Varianten aus dem Markup und stellt Warenkorb und Bestellung dazu; Preise und Summen rechnet beim Bestellen der Server.
// Stil: public/website/laden.css

// Das eigene Auswahlfeld (auswahl.js, #564) für die Variante, dann der Laden
export const STILE_LADEN = ["/website/auswahl.css", "/website/laden.css"];
export const SKRIPT_LADEN = "/website/laden.js";

export type LadenArtikel = {
  id: string;
  name: string;
  preisRappen: number;
  mediumId: string | null;
  varianten: string[];
  hinweis: string | null;
  verfuegbar: boolean;
};

function bild(a: LadenArtikel, daten: Daten): HtmlKnoten {
  const m = a.mediumId ? daten.medien.get(a.mediumId) : undefined;
  if (!a.mediumId || !m || !m.mimeTyp.startsWith("image/")) {
    return el("div", { class: "laden-bild laden-bild--leer" });
  }
  const alt = (m.altText ?? "").trim();
  return el(
    "div",
    { class: "laden-bild" },
    el("img", {
      src: medienUrl(a.mediumId),
      // Der Name steht daneben: Wiederholt der Alt-Text nur ihn, bleibt er leer
      alt: alt.toLowerCase() === a.name.trim().toLowerCase() ? "" : alt,
      ...(m.breite &&
        m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
      loading: "lazy",
      decoding: "async",
    }),
  );
}

// ebene: Ebene der Artikelnamen (eine unter der letzten Überschrift der Seite)
export function rendereLaden(daten: Daten, ebene: number): HtmlKnoten | null {
  const artikel = [...(daten.laden?.values() ?? [])];
  if (artikel.length === 0) return null;
  return el(
    "div",
    { class: "laden", "data-laden": "" },
    el(
      "div",
      { class: "laden-kopf" },
      el("p", { class: "laden-zahl" }, `${artikel.length} Artikel`),
      el(
        "p",
        { class: "laden-zugang", "data-laden-zugang": "" },
        symbol("schloss"),
        el(
          "span",
          undefined,
          "Zum Bestellen ",
          el("a", { href: ANMELDEN_PFAD }, "melde dich an"),
          ". Bezahlt wird bei der Übergabe.",
        ),
      ),
    ),
    el(
      "ul",
      { class: "laden-raster" },
      ...artikel.map((a) =>
        el(
          "li",
          {
            class: a.verfuegbar
              ? "laden-artikel"
              : "laden-artikel laden-artikel--weg",
            "data-id": a.id,
            "data-preis": String(a.preisRappen),
          },
          bild(a, daten),
          el(
            "div",
            { class: "laden-text" },
            el(`h${ebene}`, { class: "name" }, a.name),
            el("p", { class: "preis" }, preisText(a.preisRappen)),
            ...(a.hinweis ? [el("p", { class: "hinweis" }, a.hinweis)] : []),
            ...(a.varianten.length > 0
              ? [
                  el(
                    "ul",
                    { class: "laden-varianten", "aria-label": "Varianten" },
                    ...a.varianten.map((v) => el("li", undefined, v)),
                  ),
                ]
              : []),
            // Der Zustand steht als Text da, nicht nur als blassere Kachel
            ...(a.verfuegbar
              ? []
              : [el("p", { class: "laden-weg" }, "Zurzeit nicht verfügbar")]),
          ),
        ),
      ),
    ),
  );
}
