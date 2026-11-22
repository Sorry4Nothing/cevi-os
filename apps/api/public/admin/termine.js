import { el } from "./dom.js";
import * as anlaesse from "./termine-anlaesse.js";
import * as kategorien from "./termine-kategorien.js";
import * as raeume from "./termine-raeume.js";
import * as vorschlaege from "./termine-vorschlaege.js";
import * as warnliste from "./termine-warnliste.js";

// Bereich «Termine» (Epic #430, Gerüst #431): Unternavigation und Fläche für die Reiter, nach dem Muster von website.js. Sichtbar nur für die Abteilungsleitung (Admin mit zweitem Faktor): Alle anderen bekommen nur die Bereiche, die der Server ihnen nennt, und dort steht «termine» nicht. Der Bereich «Kalender» bleibt unverändert.
//
// So hängt sich ein Folge-Issue ein: Es füllt nur seine eigene Datei termine-<reiter>.js (und .css, Klassen mit dem Vorsatz «tm-<reiter>-»); termine.js, admin.js, index.html und dom.js bleiben unberührt. Reiter und Issue:
//   warnliste #433 (TA2) · kategorien #434 (TA3) · vorschlaege #441 (TD3) · anlaesse #445 (TE4) · raeume #446 und #447 (TG1, TG2; warten auf das OK des Nutzers)
// Adressen (Hash): #termine/warnliste · #termine/kategorien · #termine/vorschlaege · #termine/anlaesse · #termine/raeume
// Jedes Modul exportiert zeige(bereich, ctx). «bereich» ist sein eigener Container; zeige zeichnet hinein und räumt nichts ausserhalb auf.
// ctx = {
//   ich,                 // das Konto (better-auth), nur lesen
//   pfad,                // Rest der Adresse nach dem Reiter, z. B. ["<id>"] bei #termine/anlaesse/<id>; leer ohne Rest
//   melde(text, art),    // Rückmeldung in der Live-Region; art «ok» (Standard) oder «fehler»
//   lade(laden, zeichnen), // wie in den übrigen Bereichen, bezogen auf den Container des Moduls
//   kopfAktion(...knoten), // Hauptaktion rechts im Seitenkopf
// }
// Jede Navigation baut den Bereich neu auf: Ein Modul hält seinen Zustand selbst (Adresse, Modulvariable), nicht im DOM. Wer Daten braucht, lädt sie über ctx.lade, nie im Takt (kein Polling).

// [Schlüssel in der Adresse, Name im Reiter, Modul]
const TABS = [
  ["warnliste", "Warnliste", warnliste],
  ["kategorien", "Kategorien", kategorien],
  ["vorschlaege", "Vorschläge", vorschlaege],
  ["anlaesse", "Anlässe", anlaesse],
  ["raeume", "Räume", raeume],
];

export function zeige(bereich, ctx) {
  const [unter = "warnliste", ...rest] = ctx.pfad;
  const nav = el(
    "nav",
    { class: "tabs", "aria-label": "Termine" },
    TABS.map(([schluessel, name]) =>
      el(
        "a",
        {
          class: "tab",
          href: `#termine/${schluessel}`,
          ...(schluessel === unter && { "aria-current": "page" }),
        },
        name,
      ),
    ),
  );
  const inhalt = el("div", { id: "termine-inhalt", class: "tm-inhalt" });
  bereich.append(nav, inhalt);
  const treffer = TABS.find(([schluessel]) => schluessel === unter);
  if (treffer) {
    treffer[2].zeige(inhalt, {
      ...ctx,
      pfad: rest,
      lade: ctx.erstelleLader(inhalt),
    });
  } else {
    inhalt.append(
      el(
        "p",
        { class: "leer" },
        "Diese Ansicht gibt es nicht. Wähle oben «Warnliste», «Kategorien», «Vorschläge», «Anlässe» oder «Räume».",
      ),
    );
  }
}
