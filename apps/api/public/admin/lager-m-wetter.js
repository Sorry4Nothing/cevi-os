import { anfrage } from "./api.js";
import { chip, el, tabelle, zeit } from "./dom.js";
import { skeletonVon } from "./lager-skeleton.js";
import { ADRESSE, haenge } from "./lager-gemeinsam.js";
import { lagerPfad } from "./lager-m-hilfen.js";
import { leerKarte } from "./zustaende.js";

// Wetter im Lager-Arbeitsbereich (#674): die Vorhersage für den Ort des Lagers (heute und die nächsten Tage) mit Warnungen, und der Ort, aus dem sie kommt. Adresse: …/wetter. Lesen: wetter.lesen. Den Ort gibt niemand ein: Der Server bestimmt ihn aus dem Lagerort (#694). Der Server holt die Vorhersage höchstens alle sechs Stunden und hält sie je Lager; die Seite fragt nur beim Öffnen und bei «Aktualisieren». Ohne Ort oder bei einem Ausfall des Dienstes gibt es kein Wetter statt eines Fehlers.
// Route: GET /wetter ({ ort: { status, name }, stand, tage }).

const WARNUNG = {
  gewitter: "Gewitter",
  boeen: "Starke Böen",
  hitze: "Hitze",
  regen: "Viel Regen",
};

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
    "Vorhersage für den Lagerort, mit Warnungen bei Gewitter, Böen, Hitze und viel Regen.",
  );
  ctx.lade(
    () => anfrage("GET", lagerPfad(lagerId, "/wetter")),
    (daten) => haenge(bereich, zeichne(lagerId, lager, daten)),
    { skeleton: skeletonVon({ inhalt: "flaechen", zeilen: 2 }) },
  );
}

// Der Wetterort kommt aus dem Lagerort (#694): Die Karte zeigt ihn nur an und führt zu den Angaben, wo der Ort steht. Es gibt nie ein Feld für Koordinaten.
function ortKarte(lagerId, lager, daten) {
  const ort = daten.ort;
  const zuAngaben = el(
    "a",
    { class: "lg-verweis", href: `${ADRESSE}/${lagerId}` },
    "Zu den Angaben",
  );
  const text = {
    kein_ort:
      "Das Lager hat keinen Ort. Trage im Lager einen Ort ein, dann zeigt es das Wetter.",
    nicht_gefunden: `Der Ort «${lager.ort ?? ""}» wurde nicht gefunden. Schreibe nur den Ortsnamen, zum Beispiel «Musterstadt».`,
    mehrdeutig: `Zum Ort «${lager.ort ?? ""}» passen mehrere Orte. Ergänze bei der Adresse die Postleitzahl.`,
    nicht_erreichbar:
      "Der Ortsdienst antwortet gerade nicht. Der Server versucht es später nochmals.",
    offen: "Der Ort wird bestimmt. Lade die Seite in einem Moment neu.",
  }[ort.status];
  return el(
    "section",
    { class: "flaeche lm-nicht-drucken" },
    el(
      "h2",
      {},
      ort.status === "gefunden"
        ? `Wetter für ${ort.name}`
        : "Ort für das Wetter",
    ),
    el(
      "p",
      { class: ort.status === "gefunden" ? "leise" : "" },
      ort.status === "gefunden"
        ? "Der Ort kommt aus dem Lagerort. Ändere ihn bei den Angaben des Lagers."
        : text,
      " ",
      zuAngaben,
    ),
  );
}

function zeichne(lagerId, lager, daten) {
  const imLager = (datum) => datum >= lager.von && datum <= lager.bis;
  const wurzel = el("div", { class: "lm-seite" });
  haenge(
    wurzel,
    ortKarte(lagerId, lager, daten),
    daten.tage.length === 0
      ? daten.ort.status === "gefunden"
        ? leerKarte(
            "Das Wetter ist gerade nicht verfügbar. Versuche es später nochmals.",
          )
        : null
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
  );
  return wurzel;
}
