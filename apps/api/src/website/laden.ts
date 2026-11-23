import { preisText } from "../laden/laden.js";
import { el, medienUrl, type Daten, type HtmlKnoten } from "./rendern.js";

// Baustein «laden» (#566): das Lädeli der Abteilung als Laden mit Raster, Artikelfenster, Warenkorb und Bestellübersicht.
// Die Artikel und die Übergabearten kommen beim Abgleich aus der Datenbank (laden/laden.ts: ladeLadenDaten) und stehen ganz in der erzeugten Datei: ein Besuch löst keine Abfrage aus.
// Ohne Skript ist es eine Preisliste. Das Skript (public/website/laden.js) liest Artikel-ID, Preis, Varianten und Hinweis aus dem Markup und stellt Artikelfenster, Warenkorb (nur im Browser) und Bestellübersicht dazu, auch ohne Anmeldung; erst das Absenden braucht ein Konto. Preise und Summen rechnet beim Bestellen der Server.
// Stil: public/website/laden.css

// Das eigene Auswahlfeld (auswahl.js, #564) für Sortierung und Übergabe, dann der Laden
export const STILE_LADEN = ["/website/auswahl.css", "/website/laden.css"];
export const SKRIPT_LADEN = "/website/laden.js";

export type LadenArtikel = {
  id: string;
  name: string;
  preisRappen: number;
  mediumId: string | null;
  varianten: string[];
  // Grössen aus «varianten», die nicht zu haben sind (#629)
  nichtVerfuegbar: string[];
  hinweis: string | null;
  verfuegbar: boolean;
};

// Die Kachel: ein ruhiges Feld im Format 4:5, darin das Foto unbeschnitten und nie über seine Grösse gezogen (laden.css)
function kachel(a: LadenArtikel, daten: Daten): HtmlKnoten {
  const m = a.mediumId ? daten.medien.get(a.mediumId) : undefined;
  const alt = (m?.altText ?? "").trim();
  return el(
    "div",
    {
      class:
        m && m.mimeTyp.startsWith("image/")
          ? "laden-kachel"
          : "laden-kachel laden-kachel--leer",
    },
    ...(a.mediumId && m && m.mimeTyp.startsWith("image/")
      ? [
          el("img", {
            src: medienUrl(a.mediumId),
            // Der Name steht daneben: Wiederholt der Alt-Text nur ihn, bleibt er leer
            alt: alt.toLowerCase() === a.name.trim().toLowerCase() ? "" : alt,
            ...(m.breite &&
              m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
            loading: "lazy",
            decoding: "async",
          }),
        ]
      : []),
    // Der Zustand steht als Text in der Ecke der Kachel, nicht nur als blasseres Bild
    ...(a.verfuegbar
      ? []
      : [el("span", { class: "laden-marke" }, "Nicht verfügbar")]),
  );
}

// ebene: Ebene der Artikelnamen (eine unter der letzten Überschrift der Seite)
export function rendereLaden(daten: Daten, ebene: number): HtmlKnoten | null {
  const artikel = [...daten.laden.values()];
  if (artikel.length === 0) return null;
  return el(
    "div",
    {
      class: "laden",
      "data-laden": "",
      "data-uebergabe": JSON.stringify([...daten.ladenUebergabe.keys()]),
    },
    // Kopf des Ladens: Anzahl, Hinweis zur Bezahlung, rechts setzt das Skript den Warenkorb ein
    el(
      "div",
      { class: "laden-leiste" },
      el("p", { class: "laden-zahl" }, `${artikel.length} Artikel`),
      el(
        "p",
        { class: "laden-notiz" },
        "Bestellen mit Konto · Bezahlt wird bei der Übergabe",
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
          kachel(a, daten),
          el(
            "div",
            { class: "laden-text" },
            el(`h${ebene}`, { class: "name" }, a.name),
            el(
              "div",
              { class: "laden-fuss" },
              el("p", { class: "preis" }, preisText(a.preisRappen)),
              ...(a.varianten.length > 0
                ? [
                    el(
                      "ul",
                      { class: "laden-varianten", "aria-label": "Varianten" },
                      // Eine Grösse, die nicht zu haben ist, steht durchgestrichen und mit Wort (nie nur Farbe); das Skript liest den Namen aus data-name
                      ...a.varianten.map((v) =>
                        a.nichtVerfuegbar.includes(v)
                          ? el(
                              "li",
                              { class: "laden-variante--weg", "data-name": v },
                              el("s", undefined, v),
                              el(
                                "span",
                                { class: "nur-leser" },
                                " nicht verfügbar",
                              ),
                            )
                          : el("li", { "data-name": v }, v),
                      ),
                    ),
                  ]
                : []),
            ),
            // Das Wort zur Durchstreichung: sichtbar, sobald eine Grösse fehlt, der Artikel aber noch zu haben ist
            ...(a.verfuegbar && a.nichtVerfuegbar.length > 0
              ? [
                  el(
                    "p",
                    { class: "laden-weg-notiz" },
                    `${a.nichtVerfuegbar.join(", ")} nicht verfügbar`,
                  ),
                ]
              : []),
            ...(a.hinweis ? [el("p", { class: "hinweis" }, a.hinweis)] : []),
          ),
        ),
      ),
    ),
  );
}
