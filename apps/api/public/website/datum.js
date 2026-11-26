// Datum mit Kalender für das Formular der Website (#887). Das Textfeld bleibt: Wer tippt, tippt «31.12.2026» wie bisher; daneben öffnet ein Knopf einen Kalender. Ohne Skript bleibt nur das Textfeld.
// Die Logik folgt dem Datumsfeld der Verwaltung (public/admin/datumsfeld.js, #578), ohne von dort zu laden: Woche ab Montag, Format TT.MM.JJJJ, Grenzen aus data-min und data-max.
// Der Kalender ist ein Dialog mit einem Raster (role="grid") nach dem Muster «Date Picker Dialog» der ARIA Authoring Practices: Pfeiltasten, Bild auf/ab (Monat), Umschalt mit Bild auf/ab (Jahr), Pos1, Ende, Eingabe, Escape.
// Kein style-Attribut und kein HTML aus Text (CSP). Stil: formular.css.
import { el } from "./ui.js";

const SVG = "http://www.w3.org/2000/svg";
const MONATE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WOCHENTAGE_LANG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const zwei = (n) => String(n).padStart(2, "0");

// ---- Reine Funktionen (testbar) ----

const iso = (j, m, t) => `${String(j).padStart(4, "0")}-${zwei(m)}-${zwei(t)}`;

// «31.12.2026» (auch «1.2.2026» und «2026-12-31») als «2026-12-31»; null, wenn es den Tag nicht gibt
export function datumVon(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const wert = m
    ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
    : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wert)) return null;
  const d = new Date(`${wert}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== wert
    ? null
    : wert;
}

// «2026-12-31» als «31.12.2026»
export const zeigeDatum = (wert) => {
  const [j, m, t] = wert.split("-");
  return `${t}.${m}.${j}`;
};

const wochentag = (wert) => (new Date(`${wert}T12:00:00Z`).getUTCDay() + 6) % 7;

// Tage des Monats als Zeilen zu sieben (Montag zuerst), null für leere Felder
export function monatsRaster(jahr, monat) {
  const vorlauf = wochentag(iso(jahr, monat, 1));
  const tage = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  const zellen = [
    ...Array(vorlauf).fill(null),
    ...Array.from({ length: tage }, (_, i) => i + 1),
  ];
  while (zellen.length % 7 !== 0) zellen.push(null);
  const zeilen = [];
  for (let i = 0; i < zellen.length; i += 7) {
    zeilen.push(zellen.slice(i, i + 7));
  }
  return zeilen;
}

export function addiereTage(wert, tage) {
  const [j, m, t] = wert.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + tage));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Gleicher Tag im Zielmonat, am Monatsende auf den letzten Tag gekürzt (31. Januar plus ein Monat = 28. oder 29. Februar)
export function addiereMonate(wert, monate) {
  const [j, m, t] = wert.split("-").map(Number);
  const ziel = new Date(Date.UTC(j, m - 1 + monate, 1));
  const tage = new Date(
    Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return iso(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, Math.min(t, tage));
}

// Ein Tag innerhalb der Grenzen (ISO-Text vergleicht sich wie ein Datum)
export function klemme(wert, min, max) {
  if (min && wert < min) return min;
  if (max && wert > max) return max;
  return wert;
}

// Wo der Kalender aufgeht: beim getippten Tag, sonst heute; immer innerhalb der Grenzen
export const startTag = (text, min, max, heute) =>
  klemme(datumVon(text.trim()) ?? heute, min, max);

// ---- Oberfläche ----

const heuteZuerich = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
    new Date(),
  );

// Kalender (symbole.ts «kalender») und Pfeil nach rechts; die Stile drehen ihn für «zurück»
function zeichen(pfade) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [d, gefuellt] of pfade) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    if (gefuellt) p.setAttribute("class", "f");
    svg.append(p);
  }
  return svg;
}
const KALENDER = [["M3.5 5h17v15.5h-17z"], ["M3.5 10h17M8 2v5M16 2v5"]];
const PFEIL = [["M5 12h10"], ["M14 7l6 5-6 5z", true]];

function knopf(klasse, name, ...kinder) {
  const b = el("button", klasse, ...kinder);
  b.type = "button";
  if (name) b.setAttribute("aria-label", name);
  return b;
}

// Rüstet ein Textfeld (data-typ="datum") mit dem Kalender aus; name ist die Beschriftung des Feldes
export function verbessereDatum(eingabe, name) {
  if (eingabe.dataset.kalender !== undefined) return;
  eingabe.dataset.kalender = "";
  const min = eingabe.dataset.min ?? "";
  const max = eingabe.dataset.max ?? "";
  const kid = `${eingabe.id}-k`;

  const huelle = el("div", "bf-datum");
  const oeffner = knopf(
    "bf-datum-knopf",
    `Kalender öffnen: ${name}`,
    zeichen(KALENDER),
  );
  oeffner.setAttribute("aria-haspopup", "dialog");
  oeffner.setAttribute("aria-expanded", "false");
  oeffner.setAttribute("aria-controls", kid);
  eingabe.before(huelle);
  huelle.append(eingabe, oeffner);

  let dialog = null;
  let fokusTag = "";

  function schliesse(zurueck) {
    if (!dialog) return;
    document.removeEventListener("pointerdown", aussen, true);
    dialog.remove();
    dialog = null;
    huelle.classList.remove("oben");
    oeffner.setAttribute("aria-expanded", "false");
    if (zurueck) oeffner.focus();
  }
  const aussen = (e) => {
    if (!huelle.contains(e.target)) schliesse(false);
  };

  function waehle(tag) {
    eingabe.value = zeigeDatum(tag);
    // Wie beim Tippen: formular.js prüft live und die Fehlermeldung verschwindet
    eingabe.dispatchEvent(new Event("input", { bubbles: true }));
    eingabe.dispatchEvent(new Event("change", { bubbles: true }));
    schliesse(true);
  }

  function oeffne() {
    const heute = heuteZuerich();
    fokusTag = startTag(eingabe.value, min, max, heute);
    const gewaehlt = datumVon(eingabe.value.trim());

    dialog = el("div", "bf-kalender");
    dialog.id = kid;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", `Datum wählen: ${name}`);
    const titel = el("p", "bf-kalender-titel");
    titel.id = `${kid}-t`;
    titel.setAttribute("aria-live", "polite");
    const raster = el("div", "bf-kalender-raster");
    raster.setAttribute("role", "grid");
    raster.setAttribute("aria-labelledby", titel.id);
    const zurueck = knopf(
      "bf-kalender-pfeil zurueck",
      "Vorheriger Monat",
      zeichen(PFEIL),
    );
    const vor = knopf("bf-kalender-pfeil", "Nächster Monat", zeichen(PFEIL));
    const heuteKnopf = knopf("btn s", "", "Heute");
    const zu = knopf("btn s", "", "Schliessen");

    function zeichne(fokus) {
      const [j, m] = fokusTag.split("-").map(Number);
      titel.textContent = `${MONATE[m - 1]} ${j}`;
      const kopf = el(
        "div",
        "bf-kalender-zeile",
        ...WOCHENTAGE.map((w, i) => {
          const s = el("span", "bf-kalender-wochentag", w);
          s.setAttribute("role", "columnheader");
          s.setAttribute("aria-label", WOCHENTAGE_LANG[i]);
          return s;
        }),
      );
      kopf.setAttribute("role", "row");
      const zeilen = monatsRaster(j, m).map((woche) => {
        const zeile = el(
          "div",
          "bf-kalender-zeile",
          ...woche.map((t) => {
            const zelle = el("span", t === null ? "bf-kalender-leer" : "");
            zelle.setAttribute("role", "gridcell");
            if (t === null) return zelle;
            const tag = iso(j, m, t);
            const b = knopf(
              `bf-kalender-tag${tag === gewaehlt ? " gewaehlt" : ""}${tag === heute ? " heute" : ""}`,
              `${WOCHENTAGE_LANG[wochentag(tag)]}, ${t}. ${MONATE[m - 1]} ${j}`,
              String(t),
            );
            b.dataset.tag = tag;
            b.tabIndex = tag === fokusTag ? 0 : -1;
            b.setAttribute("aria-pressed", String(tag === gewaehlt));
            if (tag === heute) b.setAttribute("aria-current", "date");
            // Tage ausserhalb der Grenzen sind gesperrt; die Tasten führen nie dorthin (klemme)
            b.disabled = klemme(tag, min, max) !== tag;
            zelle.append(b);
            return zelle;
          }),
        );
        zeile.setAttribute("role", "row");
        return zeile;
      });
      raster.replaceChildren(kopf, ...zeilen);
      if (fokus) raster.querySelector(`[data-tag="${fokusTag}"]`)?.focus();
    }
    const gehe = (tag) => {
      fokusTag = klemme(tag, min, max);
      zeichne(true);
    };

    zurueck.addEventListener("click", () => {
      fokusTag = klemme(addiereMonate(fokusTag, -1), min, max);
      zeichne(false);
    });
    vor.addEventListener("click", () => {
      fokusTag = klemme(addiereMonate(fokusTag, 1), min, max);
      zeichne(false);
    });
    heuteKnopf.addEventListener("click", () => gehe(heute));
    zu.addEventListener("click", () => schliesse(true));
    raster.addEventListener("click", (e) => {
      const b = e.target.closest?.("button[data-tag]");
      if (b && !b.disabled) waehle(b.dataset.tag);
    });
    raster.addEventListener("keydown", (e) => {
      const schritt = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      if (e.key in schritt) gehe(addiereTage(fokusTag, schritt[e.key]));
      else if (e.key === "PageUp" || e.key === "PageDown") {
        const n = (e.key === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1);
        gehe(addiereMonate(fokusTag, n));
      } else if (e.key === "Home")
        gehe(addiereTage(fokusTag, -wochentag(fokusTag)));
      else if (e.key === "End") {
        gehe(addiereTage(fokusTag, 6 - wochentag(fokusTag)));
      } else return;
      e.preventDefault();
    });
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Escape schliesst nur den Kalender
      e.preventDefault();
      e.stopPropagation();
      schliesse(true);
    });
    // Geht der Fokus mit Tab aus dem Kalender hinaus, schliesst er sich (ohne Ziel: Neuzeichnen, nicht Verlassen)
    dialog.addEventListener("focusout", (e) => {
      if (e.relatedTarget && !huelle.contains(e.relatedTarget)) {
        schliesse(false);
      }
    });

    const kopfzeile = el("div", "bf-kalender-kopf", zurueck, titel, vor);
    const fuss = el("div", "bf-kalender-fuss", heuteKnopf, zu);
    dialog.append(kopfzeile, raster, fuss);
    huelle.append(dialog);
    oeffner.setAttribute("aria-expanded", "true");
    zeichne(false);
    // Kein Abschneiden am Fensterrand: nach oben klappen, wenn unten der Platz fehlt und oben mehr ist
    const k = huelle.getBoundingClientRect();
    const hoehe = dialog.getBoundingClientRect().height;
    const unten = window.innerHeight - k.bottom;
    huelle.classList.toggle("oben", hoehe > unten && k.top > unten);
    document.addEventListener("pointerdown", aussen, true);
    raster.querySelector(`[data-tag="${fokusTag}"]`)?.focus();
  }

  oeffner.addEventListener("click", () => {
    if (dialog) schliesse(true);
    else oeffne();
  });
  // Alt + Pfeil nach unten im Textfeld öffnet den Kalender wie bei einem Auswahlfeld
  eingabe.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && e.altKey && !dialog) {
      e.preventDefault();
      oeffne();
    }
  });
}
