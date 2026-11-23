// Ladezustände und kleine Bewegungen für Gruppen, Zimmer, Fahrten, Schichtplan und Diensttausch (#685). Die Skeletons haben die Form des echten Inhalts (gleiche Klassen, gleiche Raster), damit nichts springt, wenn die Daten da sind.
import { el } from "./dom.js";
import { skeletonTabelle, sk } from "./lader.js";
import { darfBewegen } from "./lager-anim.js";

const zeile = (...kinder) => el("div", { class: "sk-zeile" }, kinder);

// Eine Personenzeile wie personZeile: Griff, Name, Menü
const personZeileSk = (breite) =>
  el(
    "div",
    { class: "sk-zeile mn-sk-person" },
    sk("k", 24),
    sk("t", breite),
    sk("r", 64),
  );

const BREITEN = [136, 160, 112, 160, 136];

// Karte eines Zimmers, einer Gruppe oder einer Fahrt: Titel und Chip, Belegungssatz, Balken, Personen
function karteSk(zeilen, mitBalken) {
  return el(
    "section",
    { class: "flaeche mn-zimmer", "aria-hidden": "true" },
    el(
      "div",
      { class: "mn-flaechenkopf" },
      sk("t", 112),
      el("div", { class: "mn-aktionen" }, sk("r", 64)),
    ),
    mitBalken && sk("t", 160),
    mitBalken && sk("balken", 320),
    Array.from({ length: zeilen }, (_, i) =>
      personZeileSk(BREITEN[i % BREITEN.length]),
    ),
  );
}

// Brett: links «Nicht eingeteilt», rechts das Raster der Karten (Gruppen, Zimmer, Fahrten)
export function skeletonBrett({
  offen = true,
  karten = 3,
  zeilen = 3,
  mitBalken = false,
  werkzeuge = false,
} = {}) {
  const brett = el(
    "div",
    { class: "mn-brett", "aria-hidden": "true" },
    offen &&
      el(
        "section",
        { class: "flaeche mn-offen" },
        sk("t", 160),
        sk("t", 200),
        zeile(sk("r", 96), sk("r", 64)),
        sk("b", 380),
        Array.from({ length: 5 }, (_, i) =>
          personZeileSk(BREITEN[i % BREITEN.length]),
        ),
      ),
    el(
      "div",
      { class: "mn-karten" },
      Array.from({ length: karten }, () => karteSk(zeilen, mitBalken)),
    ),
  );
  if (!werkzeuge) return brett;
  return el(
    "div",
    { class: "sk-huelle" },
    el("div", { class: "mn-werkzeuge" }, sk("r", 96), sk("r", 96)),
    sk("t", 380),
    brett,
  );
}

// Karten der Vorschau beim Mischen: enges Raster mit Namenslisten
export function skeletonVorschauKarten(karten = 3, zeilen = 7) {
  return el(
    "div",
    { class: "mn-mischen", "aria-hidden": "true" },
    sk("t", 380),
    el(
      "div",
      { class: "mn-karten mn-karten--eng" },
      Array.from({ length: karten }, () =>
        el(
          "section",
          { class: "flaeche" },
          sk("t", 112),
          Array.from({ length: zeilen }, (_, i) =>
            sk("t", BREITEN[i % BREITEN.length]),
          ),
        ),
      ),
    ),
  );
}

// Schichtplan: Tabelle mit Dienstspalte und Tagen
export const skeletonPlan = () =>
  skeletonTabelle({ spalten: 5, zeilen: 6, avatar: false });

// Vorschlag für Dienste: Titel, Satz, zwei Tabellen
export const skeletonVorschlag = () =>
  el(
    "div",
    { class: "mn-mischen", "aria-hidden": "true" },
    sk("t", 200),
    sk("t", 136),
    skeletonTabelle({ spalten: 3, zeilen: 4, avatar: false }),
  );

// Diensttausch: Anfragen mit Filter und Tabelle, darunter die eigenen Anfragen
export function skeletonTausch({ entscheiden = true, anfragen = true } = {}) {
  return el(
    "div",
    { class: "sk-huelle", "aria-hidden": "true" },
    entscheiden && [
      sk("t", 112),
      sk("t", 380),
      zeile(sk("r", 64), sk("r", 96), sk("r", 64)),
      skeletonTabelle({ spalten: 4, zeilen: 3, avatar: false }),
    ],
    anfragen && [
      sk("t", 136),
      el(
        "div",
        { class: "box sk-liste" },
        Array.from({ length: 2 }, () =>
          el(
            "div",
            { class: "sk-zeile sk-zeile--liste" },
            sk("t", 260),
            sk("r", 96),
          ),
        ),
      ),
    ],
  );
}

// Während ein Teil nachlädt, bleibt er stehen und wird ruhiger (Deckkraft, kein Sprung im Layout); Rückgabe ist das Versprechen selbst
export function beschaeftigt(teil, versprechen) {
  teil.classList.add("lg-teil");
  teil.setAttribute("aria-busy", "true");
  const ende = () => {
    teil.removeAttribute("aria-busy");
    teil.classList.remove("lg-teil");
  };
  return Promise.resolve(versprechen).finally(ende);
}

// Eine Zeile oder Karte blendet aus, bevor der Aufrufer sie entfernt (die Nachbarn rutschen danach über ersetzeMitBewegung nach)
export function blendeAus(knoten) {
  if (!knoten || !darfBewegen() || !knoten.animate) return Promise.resolve();
  return knoten
    .animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(0.97)" },
      ],
      {
        duration: 200,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        fill: "forwards",
      },
    )
    .finished.catch(() => {});
}

// Liste zum Ankreuzen (Besetzen mit Teilnehmenden): Kästchen und Name
export const skeletonWahlliste = (zeilen = 6) =>
  el(
    "div",
    { class: "mn-wahlliste", "aria-hidden": "true" },
    Array.from({ length: zeilen }, (_, i) =>
      el(
        "div",
        { class: "sk-zeile mn-sk-person" },
        sk("k", 24),
        sk("t", BREITEN[i % BREITEN.length]),
      ),
    ),
  );
