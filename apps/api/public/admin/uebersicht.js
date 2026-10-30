import { el, zeit } from "./dom.js";
import {
  diagramm,
  fehlerTabelle,
  hinweisSeitStart,
  kachel,
  ladeBetrieb,
  laufend,
  ms,
  panel,
  stundenName,
  zahl,
  vor,
} from "./system.js";

// Wie /health: Nach 30 Minuten ohne Erfolg gilt der Sync als veraltet
const SYNC_VERALTET_MS = 30 * 60 * 1000;

export function zeige(bereich, ctx) {
  ctx.lade(ladeBetrieb, (daten) => zeichneSeite(bereich, daten));
}

function kalenderKachel(k) {
  const hinweisErfolg = k.letzterErfolgAm
    ? `Letzter Erfolg ${vor(k.letzterErfolgAm)} (${zeit(k.letzterErfolgAm)})`
    : "Noch nie erfolgreich";
  if (!k.eingerichtet) {
    return kachel({
      titel: "Kalender-Sync",
      wert: "Nicht eingerichtet",
      text: true,
      hinweis: "Kein Google-Kalender verbunden.",
    });
  }
  if (k.fehler) {
    return kachel({
      titel: "Kalender-Sync",
      wert: "Fehler",
      text: true,
      status: "fehler",
      hinweis: `${k.fehler}. ${hinweisErfolg}`,
    });
  }
  const veraltet =
    !k.letzterErfolgAm ||
    Date.now() - new Date(k.letzterErfolgAm).getTime() > SYNC_VERALTET_MS;
  return kachel({
    titel: "Kalender-Sync",
    wert: veraltet ? "Veraltet" : "In Ordnung",
    text: true,
    status: veraltet ? "warn" : "ok",
    hinweis: hinweisErfolg,
  });
}

function zeichneSeite(bereich, daten) {
  const offen = { wert: false };
  const fehlerFeld = el("p", { class: "meta fehlerzeile", role: "status" });
  const stand = el("p", { class: "meta stand" });
  const kacheln = el("div", { class: "kacheln" });
  const verlauf = el("div", {});
  const fehler = el("div", {});
  const summe = el("p", { class: "meta" });

  function zeichne({ system: s, anfragen: a }) {
    stand.textContent = `Stand ${new Date().toLocaleTimeString("de-CH")}, wird alle 15 Sekunden aktualisiert.`;
    const b = s.bestand;
    kacheln.replaceChildren(
      kachel({ titel: "Aktive Personen", wert: zahl(b.aktivePersonen) }),
      kachel({ titel: "Aktive Kinder", wert: zahl(b.aktiveKinder) }),
      kachel({ titel: "Push-Tokens", wert: zahl(b.pushTokens) }),
      kalenderKachel(s.kalender),
      kachel({
        titel: "Datenbank",
        wert: s.datenbank.erreichbar ? "Erreichbar" : "Nicht erreichbar",
        text: true,
        status: s.datenbank.erreichbar ? "ok" : "fehler",
        hinweis:
          s.datenbank.pingMs === null
            ? undefined
            : `Antwortzeit ${ms(s.datenbank.pingMs)}`,
      }),
    );
    verlauf.replaceChildren(
      diagramm({
        titel: "Anfragen pro Stunde, letzte 24 Stunden",
        punkte: a.stunden,
        beschriftung: stundenName,
        einheit: "Stunde",
        offen,
      }),
    );
    summe.textContent = [
      `${zahl(a.gesamt)} Anfragen`,
      `Fehlerquote 5xx ${(a.quote5xx * 100).toFixed(1)} %`,
      `Dauer p95 ${ms(a.p95Ms)}`,
    ].join(" · ");
    fehler.replaceChildren(fehlerTabelle(a.letzteFehler, 8));
  }

  zeichne(daten);
  bereich.append(
    el("div", { class: "stand-zeile" }, stand, fehlerFeld),
    kacheln,
    el(
      "div",
      { class: "raster raster--3" },
      panel("Anfragen der letzten 24 Stunden", summe, verlauf),
      panel("Letzte Fehler", fehler),
    ),
    el("p", { class: "hilfe" }, hinweisSeitStart(daten.anfragen)),
  );
  laufend(bereich, ladeBetrieb, zeichne, fehlerFeld);
}
