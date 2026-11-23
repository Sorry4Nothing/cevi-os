import {
  esc,
  rahmen,
  serialisiere,
  symbol,
  TERMINE_PFAD,
  type Kontext,
} from "./rendern.js";

// Fehler- und Wartungsseiten (#567): dieselbe Anlage wie der Kopf der Startseite. Wo dort das Titelbild steht, steht hier ein Feld mit der Nummer des Fehlers,
// die blaue Fahne mit dem Satz ragt von links hinein, daneben steht, was nun geht. Kein Bild, kein Abruf, kein Skript: 500.html und wartung.html liefert der Host auch, wenn die API nicht antwortet.
export const STIL_FEHLER = "/website/fehler.css";

type Buehne = {
  // Grosse Ziffern im Feld, nur Schmuck (aria-hidden); ohne sie entfällt das Feld
  zeichen?: string;
  titel: string;
  // Fertig maskiertes Markup
  knoepfe: string;
  // Absätze neben der Fahne, fertig maskiert
  text: string[];
  code?: string;
};

// Auch für die Seiten ohne Rahmen (Sperre, Weiterleitung): Sie setzen die Bühne direkt in <main>
export const fehlerBuehne = ({
  zeichen,
  titel,
  knoepfe,
  text,
  code,
}: Buehne) => `<div class="hero fehler${zeichen ? "" : " fehler--ohne"}">${
  zeichen
    ? `\n<div class="fehler-feld" aria-hidden="true"><span class="fehler-zeichen">${esc(zeichen)}</span></div>`
    : ""
}
<div class="teaser${zeichen ? " teaser--ueber-bild" : ""}">
<div class="wrap teaser-in">
<div class="fahne"><h1>${esc(titel)}</h1><div class="knopfreihe">${knoepfe}</div></div>
<div class="teaser-text fehler-text">${text.map((t) => `<p>${t}</p>`).join("")}${code ? `<p class="klein leise">${esc(code)}</p>` : ""}</div>
</div>
</div>
</div>`;

// Ohne Skript: ein Link auf dieselbe Adresse lädt die Seite neu
export const NOCHMALS = `<a class="btn p gross" href="">${serialisiere(symbol("nochmals"))}Nochmals versuchen</a>`;
const START = (art: "p" | "s") =>
  `<a class="btn ${art} gross" href="/">Zur Startseite</a>`;

// 404.html: der Host liefert sie bei unbekannten Adressen; sie verrät nichts über geschützte Seiten.
// Das Menü steht schon im Kopf: Die Seite nennt nur die zwei Wege, die fast immer weiterhelfen, und wem man einen kaputten Link meldet
export function rendereFehlerseite(k: Kontext): string {
  const email = k.daten.kontakt?.email;
  return rahmen(k, {
    titel: "Seite nicht gefunden",
    aktuell: null,
    robots: "noindex",
    vollbreit: true,
    stile: [STIL_FEHLER],
    inhalt: fehlerBuehne({
      zeichen: "404",
      titel: "Diese Seite gibt es nicht.",
      knoepfe: `${START("p")}<a class="btn s gross" href="${TERMINE_PFAD}">Termine ansehen</a>`,
      text: [
        "Der Link ist vielleicht alt oder hat einen Tippfehler.",
        ...(email
          ? [
              `Hast du ihn von uns bekommen? Dann schreib uns: <a href="mailto:${esc(email)}">${esc(email)}</a>`,
            ]
          : []),
      ],
      code: "Fehler 404",
    }),
  });
}

// 500.html: der Host liefert sie, wenn die Website selbst nicht antwortet
export function rendereServerfehler(k: Kontext): string {
  return rahmen(k, {
    titel: "Fehler",
    aktuell: null,
    robots: "noindex",
    nurMarke: true,
    vollbreit: true,
    stile: [STIL_FEHLER],
    inhalt: fehlerBuehne({
      zeichen: "500",
      titel: "Bei uns ist etwas schiefgegangen.",
      knoepfe: `${NOCHMALS}${START("s")}`,
      text: [
        "Das liegt nicht an dir. Versuche es in ein paar Minuten nochmals.",
      ],
      code: "Fehler 500",
    }),
  });
}

// wartung.html: der Host liefert sie mit dem Status 503, wenn die Website gewartet wird
export function rendereWartung(k: Kontext): string {
  return rahmen(k, {
    titel: "Wartung",
    aktuell: null,
    robots: "noindex",
    nurMarke: true,
    vollbreit: true,
    stile: [STIL_FEHLER],
    inhalt: fehlerBuehne({
      zeichen: "503",
      titel: "Wir sind gleich wieder da.",
      knoepfe: NOCHMALS,
      text: [
        "Die Website wird gerade aktualisiert. Versuche es in ein paar Minuten nochmals.",
      ],
      code: "Fehler 503",
    }),
  });
}
