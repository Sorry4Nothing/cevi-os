import { anfrage } from "./api.js";
import { chip, el, feld, knopf, tabelle, zeit } from "./dom.js";
import { skeletonListe } from "./lader.js";
import { feldFehler, haenge, meldung } from "./lager-gemeinsam.js";
import {
  angabe,
  lagerPfad,
  schreibschutzHinweis,
  werkzeugzeile,
} from "./lager-m-hilfen.js";
import { leerKarte } from "./zustaende.js";

// Wetter im Lager-Arbeitsbereich (#674): die Vorhersage für den Ort des Lagers (heute und die nächsten Tage) mit Warnungen, und der Ort. Adresse: …/wetter. Lesen: wetter.lesen; den Ort setzt nur die Lagerleitung. Der Server holt die Vorhersage höchstens alle sechs Stunden und hält sie je Lager; die Seite fragt nur beim Öffnen und bei «Aktualisieren». Ohne Ort oder bei einem Ausfall des Dienstes gibt es kein Wetter statt eines Fehlers.
// Routen: GET /wetter, PUT /wetter/ort ({ breite, laenge } oder beide null).

const WARNUNG = {
  gewitter: "Gewitter",
  boeen: "Starke Böen",
  hitze: "Hitze",
  regen: "Viel Regen",
};

// Reine Funktion (testbar): eine Koordinate aus dem Feld; «47,37» wie «47.37». Leer ist null, ausserhalb des Bereichs oder keine Zahl ist undefined
export function parseKoordinate(text, grenze) {
  const roh = String(text ?? "")
    .trim()
    .replace(",", ".");
  if (roh === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(roh)) return undefined;
  const n = Number(roh);
  return Math.abs(n) <= grenze ? n : undefined;
}

// Reine Funktion (testbar): «12 bis 21 °C», nur ein Wert oder nichts
export function temperaturText(tmin, tmax) {
  const g = (n) => `${Math.round(n)}`;
  if (tmin === null && tmax === null) return "";
  if (tmin === null) return `bis ${g(tmax)} °C`;
  if (tmax === null) return `ab ${g(tmin)} °C`;
  return `${g(tmin)} bis ${g(tmax)} °C`;
}

// Reine Funktion (testbar): «Mittwoch, 17.07.2027» aus einem Datum «JJJJ-MM-TT» ohne Zeitzonen-Sprung
export function tagText(iso) {
  const [j, m, t] = String(iso).split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  const woche = new Intl.DateTimeFormat("de-CH", {
    weekday: "long",
    timeZone: "UTC",
  }).format(d);
  const zwei = (n) => String(n).padStart(2, "0");
  return `${woche}, ${zwei(t)}.${zwei(m)}.${j}`;
}

// Die Warnungen eines Tages als Chips (Zustand nie nur über Farbe: Wort und Symbol)
export const warnChips = (tag) =>
  tag.warnungen.length === 0
    ? null
    : el(
        "ul",
        { class: "chips", "aria-label": "Warnungen" },
        tag.warnungen.map((w) => chip(WARNUNG[w] ?? w, "warn")),
      );

// Die Werte eines Tages als Text für Karten: «Regen, 12 bis 21 °C, 3 mm Regen, Böen bis 40 km/h»
export function wetterSatz(tag) {
  return [
    tag.zustand,
    temperaturText(tag.tmin, tag.tmax),
    tag.regen !== null && tag.regen > 0 ? `${tag.regen} mm Regen` : null,
    tag.boeen !== null ? `Böen bis ${Math.round(tag.boeen)} km/h` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.titel(
    "Wetter",
    "Vorhersage für den Ort des Lagers, mit Warnungen bei Gewitter, Böen, Hitze und viel Regen.",
  );
  ctx.lade(
    () => anfrage("GET", lagerPfad(lagerId, "/wetter")),
    (daten, neu) => haenge(bereich, zeichne(ctx, lagerId, lager, daten, neu)),
    { skeleton: () => skeletonListe({ zeilen: 5 }) },
  );
}

function ortKarte(ctx, lagerId, lager, daten, neu) {
  const darf = lager.rolle === "lagerleitung" && !lager.schreibgeschuetzt;
  const breite = feld({
    label: "Breitengrad",
    wert: daten.ort ? String(daten.ort.breite).replace(".", ",") : "",
    inputmode: "decimal",
    autocomplete: "off",
    hilfe: "Zum Beispiel 47,37.",
  });
  const laenge = feld({
    label: "Längengrad",
    wert: daten.ort ? String(daten.ort.laenge).replace(".", ",") : "",
    inputmode: "decimal",
    autocomplete: "off",
    hilfe: "Zum Beispiel 8,54.",
  });
  const fehler = el("p", { class: "feld-fehler", role: "alert", hidden: true });
  const sende = async (b, l) => {
    try {
      await anfrage("PUT", lagerPfad(lagerId, "/wetter/ort"), {
        breite: b,
        laenge: l,
      });
      ctx.melde(
        b === null
          ? "Das Wetter ist ausgeschaltet."
          : "Der Ort ist gespeichert.",
      );
      neu();
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
    }
  };
  const speichern = () => {
    fehler.hidden = true;
    const b = parseKoordinate(breite.eingabe.value, 90);
    const l = parseKoordinate(laenge.eingabe.value, 180);
    if (b === undefined) {
      feldFehler(breite, "Der Breitengrad liegt zwischen −90 und 90.");
      return;
    }
    if (l === undefined) {
      feldFehler(laenge, "Der Längengrad liegt zwischen −180 und 180.");
      return;
    }
    if ((b === null) !== (l === null)) {
      feldFehler(
        b === null ? breite : laenge,
        "Fülle beide Felder aus oder lasse beide leer.",
      );
      return;
    }
    sende(b, l);
  };
  return el(
    "section",
    { class: "flaeche lm-nicht-drucken" },
    el("h2", {}, "Ort für das Wetter"),
    daten.ort
      ? el(
          "dl",
          { class: "lm-angaben" },
          angabe("Breitengrad", String(daten.ort.breite).replace(".", ",")),
          angabe("Längengrad", String(daten.ort.laenge).replace(".", ",")),
        )
      : el(
          "p",
          { class: "leise" },
          darf
            ? "Es ist noch kein Ort gesetzt. Trage ihn ein, dann zeigt das Lager das Wetter."
            : "Es ist noch kein Ort gesetzt. Die Lagerleitung kann ihn eintragen.",
        ),
    darf &&
      el(
        "div",
        { class: "lm-ortform" },
        el("div", { class: "lg-zweispaltig" }, breite.wurzel, laenge.wurzel),
        fehler,
        el(
          "div",
          { class: "reihe" },
          knopf("Ort speichern", {
            art: "haupt",
            symbol: "haken",
            onclick: speichern,
          }),
          daten.ort &&
            knopf("Wetter ausschalten", {
              art: "still",
              symbol: "papierkorb",
              onclick: () => sende(null, null),
            }),
        ),
        el(
          "p",
          { class: "hilfe" },
          "Zwei Nachkommastellen genügen, das sind rund ein Kilometer. Der Server speichert nie die genaue Lage eines Hauses.",
        ),
      ),
  );
}

function zeichne(ctx, lagerId, lager, daten, neu) {
  const imLager = (datum) => datum >= lager.von && datum <= lager.bis;
  const wurzel = el("div", { class: "lm-seite" });
  haenge(
    wurzel,
    schreibschutzHinweis(lager),
    werkzeugzeile(
      knopf("Aktualisieren", { symbol: "aktualisieren", onclick: () => neu() }),
    ),
    daten.tage.length === 0
      ? leerKarte(
          daten.ort
            ? "Im Moment gibt es kein Wetter. Der Wetterdienst antwortet nicht oder hat für diesen Ort nichts. Versuche es später nochmals."
            : "Für dieses Lager gibt es kein Wetter, weil kein Ort gesetzt ist.",
        )
      : el(
          "section",
          { class: "flaeche" },
          el("h2", {}, "Vorhersage"),
          (() => {
            const t = tabelle({
              beschriftung: "Wetter der nächsten Tage",
              spalten: [
                "Tag",
                "Wetter",
                "Temperatur",
                "Regen",
                "Böen",
                "Warnung",
              ],
              zeilen: daten.tage.map((tag) =>
                el(
                  "tr",
                  {},
                  el(
                    "th",
                    { scope: "row" },
                    tagText(tag.datum),
                    imLager(tag.datum) && [
                      " ",
                      el("span", { class: "chip" }, "Im Lager"),
                    ],
                  ),
                  el(
                    "td",
                    { "data-label": "Wetter" },
                    tag.zustand ?? "unbekannt",
                  ),
                  el(
                    "td",
                    { class: "lg-zahlen", "data-label": "Temperatur" },
                    temperaturText(tag.tmin, tag.tmax) || "–",
                  ),
                  el(
                    "td",
                    { class: "lg-zahlen", "data-label": "Regen" },
                    tag.regen === null ? "–" : `${tag.regen} mm`,
                  ),
                  el(
                    "td",
                    { class: "lg-zahlen", "data-label": "Böen" },
                    tag.boeen === null ? "–" : `${Math.round(tag.boeen)} km/h`,
                  ),
                  el("td", { "data-label": "Warnung" }, warnChips(tag) ?? "–"),
                ),
              ),
            });
            t.wurzel.querySelector("table").classList.add("lg-karten");
            return t.wurzel;
          })(),
          el(
            "p",
            { class: "hilfe" },
            daten.stand ? `Stand: ${zeit(daten.stand)}. ` : "",
            "Die Vorhersage kommt von einem Wetterdienst. Der Server holt sie höchstens alle sechs Stunden.",
          ),
        ),
    ortKarte(ctx, lagerId, lager, daten, neu),
  );
  return wurzel;
}
