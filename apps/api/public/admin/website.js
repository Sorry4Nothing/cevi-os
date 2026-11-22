import { el } from "./dom.js";
import * as editor from "./website-editor.js";
import * as medien from "./website-medien.js";
import * as seiten from "./website-seiten.js";
import * as stufenfakten from "./website-stufenfakten.js";

// Bereich «Website» (#353): Gerüst mit der Unternavigation. Die Module füllen je ein Issue, ohne die Dateien der anderen zu berühren.
//
// Adressen (Hash): #website/seiten · #website/seiten/<id> · #website/medien · #website/stufenfakten
// Jedes Modul exportiert zeige(bereich, ctx). «bereich» ist sein eigener Container; zeige zeichnet hinein und räumt nichts ausserhalb auf.
// ctx = {
//   ich,                 // das Konto (better-auth), nur lesen
//   redaktion,           // { redigieren, bereiche, verwalten } von GET /api/v1/redaktion/ich: nur die Anzeige, jede Route prüft selbst
//   pfad,                // Rest der Adresse nach dem Modul, z. B. ["<id>"] bei #website/seiten/<id>; leer ohne Rest
//   melde(text, art),    // Rückmeldung in der Live-Region; art «ok» (Standard) oder «fehler»
//   lade(laden, zeichnen), // wie in den übrigen Bereichen, bezogen auf den Container des Moduls
//   kopfAktion(...knoten), // Hauptaktion rechts im Seitenkopf
// }
// Jede Navigation baut den Bereich neu auf: Ein Modul hält seinen Zustand selbst (Adresse, Modulvariable), nicht im DOM.

// [Schlüssel in der Adresse, Name im Tab]
const TABS = [
  ["seiten", "Seiten"],
  ["medien", "Medien"],
  ["stufenfakten", "Stufenfelder"],
];

export function zeige(bereich, ctx) {
  const [unter = "seiten", ...rest] = ctx.pfad;
  const nav = el(
    "nav",
    { class: "tabs", "aria-label": "Website" },
    TABS.map(([schluessel, name]) =>
      el(
        "a",
        {
          class: "tab",
          href: `#website/${schluessel}`,
          ...(schluessel === unter && { "aria-current": "page" }),
        },
        name,
      ),
    ),
  );
  const inhalt = el("div", { id: "website-inhalt", class: "website-inhalt" });
  bereich.append(nav, inhalt);
  const unterCtx = {
    ...ctx,
    pfad: rest,
    lade: ctx.erstelleLader(inhalt),
  };
  if (unter === "seiten") {
    (rest.length > 0 ? editor : seiten).zeige(inhalt, unterCtx);
  } else if (unter === "medien") {
    medien.zeige(inhalt, unterCtx);
  } else if (unter === "stufenfakten") {
    stufenfakten.zeige(inhalt, unterCtx);
  } else {
    inhalt.append(
      el(
        "p",
        { class: "leer" },
        "Diese Ansicht gibt es nicht. Wähle oben «Seiten», «Medien» oder «Stufenfelder».",
      ),
    );
  }
}
