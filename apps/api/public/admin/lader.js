// Laden mit Skeleton nach dem Design (G5, A30 «Seitenwechsel lädt»):
//  - Das Skeleton erscheint erst nach 250 ms und bleibt mindestens 400 ms stehen (kein Flackern).
//  - Nach 4 Sekunden steht «Das dauert länger.» mit «Nochmals versuchen» darunter.
//  - Skeleton nur beim ersten Laden eines Bereichs; beim erneuten Laden bleibt der alte Inhalt und «Wird aktualisiert …» erscheint.
//  - Die Form gleicht dem echten Inhalt (Höhen, Radien, Spalten); die Information liefert die Live-Region «Lädt …».
//  - Ruhiges Pulsieren der Deckkraft nur, wenn Bewegung erlaubt ist (komponenten.css).
import { el } from "./dom.js";
import { zustandsDaten, zustandsKarte, nochmals } from "./zustaende.js";

const VERZOEGERUNG_MS = 250;
const MINDESTDAUER_MS = 400;
const LANGSAM_MS = 4000;

// Breiten gibt es als Klassen (sk-b<px>), weil die CSP style-Attribute verbietet; andere Werte rundet sk() auf die nächste
const BREITEN = [24, 36, 48, 64, 80, 96, 112, 136, 160, 200, 260, 320, 380];
const naechste = (px) =>
  BREITEN.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a));

// Ein Balken (Text), eine Pille (rund) oder ein Kreis (Avatar, Zahl)
// art: «t» Textzeile, «r» Pille, «k» Kreis, «b» Block; breite in px
export function sk(art = "t", breite = 120) {
  return el("span", {
    class: `sk sk--${art} sk-b${naechste(breite)}`,
    "aria-hidden": "true",
  });
}

const zeile = (...kinder) => el("div", { class: "sk-zeile" }, kinder);

// Tabelle: Kopf und Zeilen, Avatar rund, Chips als Pillen; gleiche Spaltenzahl wie die echte
export function skeletonTabelle({
  spalten = 5,
  zeilen = 6,
  avatar = true,
} = {}) {
  const breiten = [136, 160, 112, 80, 96, 64];
  const kopfZellen = Array.from({ length: spalten }, () =>
    el("th", { scope: "col" }, sk("t", 64)),
  );
  const koerper = Array.from({ length: zeilen }, (_, z) =>
    el(
      "tr",
      { "aria-hidden": "true" },
      Array.from({ length: spalten }, (_, s) =>
        el(
          "td",
          {},
          s === 0 && avatar
            ? zeile(sk("k", 36), sk("t", breiten[(z + s) % breiten.length]))
            : s === spalten - 1
              ? sk("r", 96)
              : sk("t", breiten[(z + s) % breiten.length]),
        ),
      ),
    ),
  );
  return el(
    "div",
    { class: "box sk-tabelle" },
    el(
      "table",
      {},
      el("thead", {}, el("tr", { "aria-hidden": "true" }, kopfZellen)),
      el("tbody", {}, koerper),
    ),
  );
}

// Fläche mit Titel und Werte-Liste (Bestand) oder Zeilen mit Zahl und Knopf (Das braucht dich)
export function skeletonFlaeche({ zeilen = 4, mitKnopf = false } = {}) {
  return el(
    "section",
    { class: "flaeche", "aria-hidden": "true" },
    sk("t", 200),
    Array.from({ length: zeilen }, (_, i) =>
      mitKnopf
        ? el(
            "div",
            { class: "sk-zeile sk-zeile--knopf" },
            sk("k", 36),
            sk("t", [260, 320, 380, 260][i % 4]),
            sk("r", 96),
          )
        : el(
            "div",
            { class: "sk-zeile sk-zeile--paar" },
            sk("t", [112, 160, 200, 112][i % 4]),
            sk("t", 80),
          ),
    ),
  );
}

// Formular: Label und Feld
export function skeletonFormular({ felder = 3 } = {}) {
  return el(
    "div",
    { class: "flaeche", "aria-hidden": "true" },
    Array.from({ length: felder }, () =>
      el("div", { class: "feld" }, sk("t", 80), sk("b", 380)),
    ),
  );
}

// Detail (Seitenblatt oder Seite): Titel, Chip-Reihe, Felder
export function skeletonDetail() {
  return el(
    "div",
    { class: "flaeche", "aria-hidden": "true" },
    zeile(sk("k", 48), sk("t", 200)),
    zeile(sk("r", 64), sk("r", 80)),
    skeletonFormular({ felder: 2 }),
  );
}

// Liste mit Datumsspalte, Titel und Chips (Kalender)
export function skeletonListe({ zeilen = 5 } = {}) {
  return el(
    "div",
    { class: "box sk-liste", "aria-hidden": "true" },
    Array.from({ length: zeilen }, () =>
      el(
        "div",
        { class: "sk-zeile sk-zeile--liste" },
        sk("t", 36),
        sk("t", 200),
        sk("r", 96),
      ),
    ),
  );
}

export const SKELETONS = {
  tabelle: skeletonTabelle,
  flaeche: skeletonFlaeche,
  formular: skeletonFormular,
  detail: skeletonDetail,
  liste: skeletonListe,
};

// Hülle um ein Skeleton: Live-Region «Lädt …», aria-busy
function huelle(inhalt) {
  return el(
    "div",
    { class: "sk-huelle", "aria-busy": "true" },
    inhalt,
    el("p", { class: "nur-leser", role: "status" }, "Lädt …"),
  );
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Lädt Daten in den Bereich und zeichnet sie; die zweite Funktion, die zeichnen bekommt, lädt dieselbe Ansicht nochmals, ohne den Bereich vorher zu leeren.
// lade(laden, zeichnen, { skeleton }) — skeleton: Name aus SKELETONS, eine Funktion, die einen Knoten liefert, oder false (kein Skeleton). Vorgabe: «tabelle».
// Fehler: Zustandskarte mit «Nochmals versuchen»; bei 404 zusätzlich ein Knopf «Zur Übersicht» (zurUebersicht liefert ihn).
export function erstelleLader(bereich, { zurUebersicht } = {}) {
  let lauf = 0;
  async function lade(laden, zeichnen, { skeleton = "tabelle" } = {}) {
    const meine = ++lauf;
    const erstes = !bereich.firstChild;
    const erneut = () => lade(laden, zeichnen, { skeleton });
    let sichtbarSeit = 0;
    let platzhalter = null;
    let hinweis = null;
    const timer = [];
    if (erstes && skeleton !== false) {
      timer.push(
        setTimeout(() => {
          const bauen =
            typeof skeleton === "function" ? skeleton : SKELETONS[skeleton];
          platzhalter = huelle(bauen());
          bereich.replaceChildren(platzhalter);
          sichtbarSeit = Date.now();
        }, VERZOEGERUNG_MS),
      );
    } else if (!erstes) {
      hinweis = el(
        "p",
        { class: "meta aktualisiert", role: "status" },
        "Wird aktualisiert …",
      );
      bereich.prepend(hinweis);
    }
    timer.push(
      setTimeout(() => {
        if (!platzhalter?.isConnected) return;
        platzhalter.append(
          el(
            "div",
            { class: "sk-langsam" },
            el("p", { role: "status" }, "Das dauert länger."),
            nochmals(erneut, ""),
          ),
        );
      }, LANGSAM_MS),
    );
    let daten;
    let fehler = null;
    try {
      daten = await laden();
    } catch (f) {
      fehler = f;
    }
    for (const t of timer) window.clearTimeout(t);
    // Ein Skeleton, das schon zu sehen ist, bleibt mindestens MINDESTDAUER_MS
    if (platzhalter && sichtbarSeit) {
      const rest = MINDESTDAUER_MS - (Date.now() - sichtbarSeit);
      if (rest > 0) await warte(rest);
    }
    // Zwischen Anfrage und Antwort kann man den Bereich gewechselt oder neu geladen haben
    if (!bereich.isConnected || meine !== lauf) return;
    hinweis?.remove();
    bereich.replaceChildren();
    if (fehler) {
      const karte = zustandsKarte(
        zustandsDaten(fehler),
        [nochmals(erneut), fehler.status === 404 && zurUebersicht?.()].filter(
          Boolean,
        ),
      );
      bereich.append(karte.wurzel);
      karte.titel.focus();
      return;
    }
    zeichnen(daten, erneut);
  }
  return lade;
}
