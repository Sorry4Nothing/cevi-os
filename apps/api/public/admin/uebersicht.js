// Übersicht (#583): was jetzt zu tun ist und wie es der Abteilung geht, je nach Rolle. Ein einziger Abruf, GET /api/v1/admin/uebersicht; der Server gibt jeder Person nur die Teile, die sie sehen darf (docs/rechte.md). Die Oberfläche blendet nur aus, was fehlt, und verlässt sich auf nichts.
//
// Datenbanklast: ein Abruf beim Öffnen und auf «Aktualisieren», kein Polling. Der Server hält die Antwort 45 Sekunden je Person im Speicher.
// Aufbau: Jetzt zu tun (Band mit Zahl und Sprung) · Kennzahlen (mit Verlauf und Vergleich) · Kommendes und Kinder je Stufe · Zustand. Kacheln und Diagramme liegen in uebersicht-kacheln.js und uebersicht-diagramme.js, die Stile in uebersicht.css.
// Fehlt ein Teil (kein Recht), fehlt seine Kachel. Scheitert ein Teil auf dem Server, zeigt nur diese Kachel «Nochmals versuchen».
import { anfrage } from "./api.js";
import { el, knopf } from "./dom.js";
import { sk } from "./lader.js";
import {
  aufgabenBand,
  kennzahlen,
  kinderJeStufe,
  kommendes,
  termineProWoche,
  zustand,
} from "./uebersicht-kacheln.js";
import { leerKarte } from "./zustaende.js";

const uhr = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Der Wunsch «Tabellen statt Diagramme» bleibt bei «Aktualisieren» erhalten
let tabellen = false;

// Skelett in der Form des echten Inhalts: Band, vier Kennzahlen, zwei Flächen, vier Zustände
function skelett() {
  const kachel = (zeilen = 3) =>
    el(
      "div",
      { class: "ub-kachel", "aria-hidden": "true" },
      sk("t", 112),
      sk("t", 80),
      ...Array.from({ length: zeilen }, () => sk("t", 260)),
    );
  const abschnitt = (breite, klasse, n, zeilen) =>
    el(
      "div",
      { class: "ub-abschnitt", "aria-hidden": "true" },
      sk("t", breite),
      el(
        "div",
        { class: klasse },
        Array.from({ length: n }, () => kachel(zeilen)),
      ),
    );
  return el(
    "div",
    { class: "ub-seite" },
    abschnitt(160, "ub-aufgaben", 4, 1),
    abschnitt(136, "ub-raster", 4, 3),
    el("div", { class: "ub-zweispaltig" }, kachel(6), kachel(5)),
    abschnitt(96, "ub-raster ub-raster--zustand", 4, 2),
  );
}

// Zähler der Unterleiste aus denselben Zahlen, ohne eigene Abfrage
function melde(ctx, a) {
  if (!a) return;
  const z = (bereich, unter, n) =>
    n !== undefined && ctx.zaehler(unter, n, bereich);
  z("termine", "vorschlaege", a.terminVorschlaege);
  z("termine", "warnliste", a.termineOhneKategorie);
  z("raeume", "anfragen", a.raumanfragen);
}

function zeichne(bereich, ctx, daten, neuLaden) {
  melde(ctx, daten.aufgaben);
  const wurzel = el("div", {
    class: "ub-seite" + (tabellen ? " ub--tabellen" : ""),
  });
  const opt = { nochmals: neuLaden };
  // Links die Liste, rechts übereinander die Wochen und die Stufen
  const rechts = [
    termineProWoche(daten),
    kinderJeStufe(daten, ctx, opt),
  ].filter(Boolean);
  const zweispaltig = [
    kommendes(daten, ctx, opt),
    rechts.length > 0 && el("div", { class: "ub-spalte" }, rechts),
  ].filter(Boolean);
  wurzel.append(
    ...[
      aufgabenBand(daten, ctx, neuLaden),
      kennzahlen(daten, ctx, {
        nochmals: neuLaden,
        tabellen,
        beiTabellen: (an) => {
          tabellen = an;
          wurzel.classList.toggle("ub--tabellen", an);
        },
      }),
      zweispaltig.length > 0 &&
        el(
          "section",
          { class: "ub-abschnitt", "aria-labelledby": "ub-h-kommend" },
          el(
            "h2",
            { id: "ub-h-kommend", class: "nur-leser" },
            "Kommendes und Stufen",
          ),
          el(
            "div",
            {
              class:
                "ub-zweispaltig" +
                (zweispaltig.length === 1 ? " ub-zweispaltig--eine" : ""),
            },
            zweispaltig,
          ),
        ),
      zustand(daten, ctx, opt),
    ].filter(Boolean),
  );
  if (wurzel.childElementCount === 0) {
    bereich.append(
      leerKarte("Für deine Rolle gibt es hier gerade nichts zu zeigen."),
    );
    return;
  }
  wurzel.prepend(
    el(
      "p",
      { class: "ub-stand klein leise", role: "status" },
      `Stand ${uhr.format(new Date(daten.erzeugtAm))} Uhr, höchstens eine Minute alt.`,
    ),
  );
  bereich.append(wurzel);
}

export function zeige(bereich, ctx) {
  let frisch = false;
  let neu = null;
  const laden = () =>
    anfrage("GET", `/api/v1/admin/uebersicht${frisch ? "?frisch=1" : ""}`);
  if (ctx.ich.role !== "admin") {
    ctx.titel("Übersicht", "Was für deine Rolle offen ist.");
  }
  ctx.kopfAktion(
    knopf("Aktualisieren", {
      art: "still",
      symbol: "aktualisieren",
      onclick: () => {
        frisch = true;
        neu?.();
      },
    }),
  );
  ctx.lade(
    laden,
    (daten, neuLaden) => {
      neu = neuLaden;
      zeichne(bereich, ctx, daten, () => {
        frisch = true;
        neuLaden();
      });
    },
    {
      skeleton: skelett,
      fehlerTitel: "Die Übersicht konnte nicht geladen werden.",
      fehlerText: "Prüfe die Verbindung und versuche es nochmals.",
    },
  );
}
