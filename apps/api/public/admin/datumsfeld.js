// Eigene Felder für Datum, Zeit, Datum mit Zeit und Zahl (#578): Tippen UND Kalender, Format de-CH («05.12.2026», «14:30»), unabhängig vom Browser. Ersetzen die nativen Eingaben date, time, datetime-local und number.
// Jedes Feld liefert { wurzel, eingabe } wie feld(): eingabe.value ist der Wert im Format der API (Datum «2026-12-05», Zeit «14:30», beides «2026-12-05T14:30»), leer bei leerer oder ungültiger Eingabe; auf eingabe.value = … reagiert die Anzeige. «input» und «change» kommen wie bei einem normalen Feld.
import { el, icon, neueId } from "./dom.js";

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

export const iso = (j, m, t) =>
  `${String(j).padStart(4, "0")}-${zwei(m)}-${zwei(t)}`;

export function istGueltig(j, m, t) {
  const d = new Date(Date.UTC(j, m - 1, t));
  return (
    d.getUTCFullYear() === j &&
    d.getUTCMonth() === m - 1 &&
    d.getUTCDate() === t
  );
}

// «5.12.2026», «05.12.26», «5.12.» (aktuelles Jahr), «5/12/2026», «2026-12-05» → «2026-12-05»; sonst ""
export function parseDatum(text, heute = new Date()) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  const i = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (i) return istGueltig(+i[1], +i[2], +i[3]) ? iso(+i[1], +i[2], +i[3]) : "";
  const m = /^(\d{1,2})[./\s-](\d{1,2})[./\s-]?(\d{2}|\d{4})?$/.exec(s);
  if (!m) return "";
  let j = m[3] === undefined ? heute.getFullYear() : +m[3];
  if (m[3] !== undefined && m[3].length === 2) j += 2000;
  return istGueltig(j, +m[2], +m[1]) ? iso(j, +m[2], +m[1]) : "";
}

// «2026-12-05» → «05.12.2026»
export function formatDatum(wert) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

// «8», «8:30», «8.30», «0830», «830», «14» → «08:30»; sonst ""
export function parseZeit(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  let h;
  let min = 0;
  let m = /^(\d{1,2})[:.](\d{1,2})$/.exec(s);
  if (m) {
    h = +m[1];
    min = +m[2];
  } else if ((m = /^(\d{1,2})$/.exec(s))) {
    h = +m[1];
  } else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) {
    h = +m[1];
    min = +m[2];
  } else return "";
  return h <= 23 && min <= 59 ? `${zwei(h)}:${zwei(min)}` : "";
}

// Tage des Monats als Zeilen zu sieben (Montag zuerst), null für leere Felder
export function monatsRaster(jahr, monat) {
  const erster = new Date(Date.UTC(jahr, monat - 1, 1));
  const vorlauf = (erster.getUTCDay() + 6) % 7;
  const tage = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  const zellen = [
    ...Array(vorlauf).fill(null),
    ...Array.from({ length: tage }, (_, i) => i + 1),
  ];
  while (zellen.length % 7 !== 0) zellen.push(null);
  const zeilen = [];
  for (let i = 0; i < zellen.length; i += 7)
    zeilen.push(zellen.slice(i, i + 7));
  return zeilen;
}

// Verschiebt ein ISO-Datum um Tage
export function addiereTage(wert, tage) {
  const [j, m, t] = wert.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + tage));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addiereMonate(wert, monate) {
  const [j, m, t] = wert.split("-").map(Number);
  const ziel = new Date(Date.UTC(j, m - 1 + monate, 1));
  const tage = new Date(
    Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return iso(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, Math.min(t, tage));
}

const heuteIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

// ---- Gemeinsames Gerüst: sichtbare Texteingabe, deren .value den API-Wert liefert ----

function textfeld({
  label,
  hilfe,
  required,
  wandle,
  zeige,
  platzhalter,
  breite,
  hinten,
  inputmode,
}) {
  const id = neueId("feld");
  const hilfeId = hilfe ? `${id}-hilfe` : undefined;
  const eingabe = el("input", {
    id,
    type: "text",
    class: "eingabe",
    inputmode: inputmode ?? "numeric",
    autocomplete: "off",
    placeholder: platzhalter,
    "aria-describedby": hilfeId,
    required,
  });
  const nativ = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  let ablage = "";
  // .value liefert den Wert für die API, bei ungültiger Eingabe ""; das Setzen zeigt den Wert
  Object.defineProperty(eingabe, "value", {
    get: () => ablage,
    set: (v) => {
      ablage = v ?? "";
      nativ.set.call(eingabe, zeige(ablage));
      eingabe.removeAttribute("aria-invalid");
    },
  });
  const fehler = el("p", {
    class: "feld-fehler",
    id: `${id}-fehler`,
    role: "alert",
    hidden: true,
  });
  eingabe.addEventListener("input", () => {
    ablage = wandle(nativ.get.call(eingabe));
    eingabe.removeAttribute("aria-invalid");
    fehler.hidden = true;
  });
  // Beim Verlassen: Gültiges schön schreiben, Ungültiges melden (Text steht beim Feld, nicht nur Farbe)
  eingabe.addEventListener("blur", () => {
    const roh = nativ.get.call(eingabe).trim();
    if (roh === "") return;
    if (ablage === "") {
      eingabe.setAttribute("aria-invalid", "true");
      eingabe.setAttribute(
        "aria-describedby",
        [hilfeId, fehler.id].filter(Boolean).join(" "),
      );
      fehler.textContent = `Das habe ich nicht verstanden. Schreibe es so: ${platzhalter}.`;
      fehler.hidden = false;
    } else {
      nativ.set.call(eingabe, zeige(ablage));
    }
  });
  const zeile = el(
    "div",
    { class: `datumsfeld-zeile${breite ? ` ${breite}` : ""}` },
    eingabe,
    hinten,
  );
  const wurzel = el(
    "div",
    { class: "feld datumsfeld" },
    el("label", { for: id }, label),
    zeile,
    hilfe && el("p", { class: "hilfe", id: hilfeId }, hilfe),
    fehler,
  );
  return { wurzel, eingabe, id, nativ, setzeAblage: (v) => (ablage = v) };
}

function ereignisse(eingabe) {
  eingabe.dispatchEvent(new Event("input", { bubbles: true }));
  eingabe.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---- Datum mit Kalender ----

// wert: «2026-12-05» oder ""; min und max als ISO-Datum
export function datumsfeld({ label, wert = "", hilfe, required, min, max }) {
  let kalender = null;
  let schliesseKalender = () => {};
  const toggle = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--rund datum-knopf",
      "aria-label": `Kalender öffnen: ${label}`,
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    },
    icon("kalender"),
  );
  const f = textfeld({
    label,
    hilfe,
    required,
    platzhalter: "TT.MM.JJJJ",
    wandle: (roh) => {
      const w = parseDatum(roh);
      return w && (!min || w >= min) && (!max || w <= max) ? w : "";
    },
    zeige: formatDatum,
    hinten: toggle,
  });
  f.eingabe.value = wert;
  const wurzel = f.wurzel;

  function oeffne() {
    if (kalender) return schliesseKalender();
    const start = f.eingabe.value || heuteIso();
    let fokusTag = start;
    let anzeige = start;
    kalender = el("div", {
      class: "kalender",
      role: "dialog",
      "aria-label": `Datum wählen: ${label}`,
    });
    const titel = el("p", { class: "kalender-titel", "aria-live": "polite" });
    const raster = el("div", {
      class: "kalender-raster",
      role: "grid",
      "aria-labelledby": `${f.id}-kt`,
    });
    titel.id = `${f.id}-kt`;
    const monat = (schritt) => {
      anzeige = addiereMonate(anzeige, schritt);
      fokusTag = anzeige;
      zeichne();
    };
    const waehle = (tag) => {
      f.eingabe.value = tag;
      ereignisse(f.eingabe);
      schliesseKalender(true);
    };
    const ausserhalb = (tag) => (min && tag < min) || (max && tag > max);
    function zeichne(fokus = false) {
      const [j, m] = anzeige.split("-").map(Number);
      titel.textContent = `${MONATE[m - 1]} ${j}`;
      const kopf = el(
        "div",
        { class: "kalender-zeile", role: "row" },
        WOCHENTAGE.map((w, i) =>
          el(
            "span",
            {
              class: "kalender-wochentag",
              role: "columnheader",
              "aria-label": WOCHENTAGE_LANG[i],
            },
            w,
          ),
        ),
      );
      const zeilen = monatsRaster(j, m).map((z) =>
        el(
          "div",
          { class: "kalender-zeile", role: "row" },
          z.map((t) => {
            if (t === null)
              return el("span", { class: "kalender-leer", role: "gridcell" });
            const tag = iso(j, m, t);
            const wt =
              WOCHENTAGE_LANG[
                (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7
              ];
            return el(
              "span",
              { role: "gridcell" },
              el(
                "button",
                {
                  type: "button",
                  class: `kalender-tag${tag === f.eingabe.value ? " ist-gewaehlt" : ""}${tag === heuteIso() ? " ist-heute" : ""}`,
                  tabindex: tag === fokusTag ? "0" : "-1",
                  "aria-label": `${wt}, ${t}. ${MONATE[m - 1]} ${j}`,
                  "aria-pressed": String(tag === f.eingabe.value),
                  "aria-current": tag === heuteIso() ? "date" : undefined,
                  disabled: ausserhalb(tag),
                  "data-tag": tag,
                  onclick: () => waehle(tag),
                },
                String(t),
              ),
            );
          }),
        ),
      );
      raster.replaceChildren(kopf, ...zeilen);
      if (fokus) raster.querySelector(`[data-tag="${fokusTag}"]`)?.focus();
    }
    const gehe = (tag) => {
      fokusTag = tag;
      if (tag.slice(0, 7) !== anzeige.slice(0, 7)) anzeige = tag;
      zeichne(true);
    };
    raster.addEventListener("keydown", (e) => {
      const karte = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (e.key in karte) {
        e.preventDefault();
        gehe(addiereTage(fokusTag, karte[e.key]));
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        const ziel = addiereMonate(fokusTag, e.key === "PageUp" ? -1 : 1);
        anzeige = ziel;
        gehe(ziel);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const wochentag =
          (new Date(`${fokusTag}T00:00:00Z`).getUTCDay() + 6) % 7;
        gehe(
          addiereTage(fokusTag, e.key === "Home" ? -wochentag : 6 - wochentag),
        );
      }
    });
    const knopfZeile = el(
      "div",
      { class: "kalender-kopf" },
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund",
          "aria-label": "Vorheriger Monat",
          onclick: () => monat(-1),
        },
        icon("zurueck"),
      ),
      titel,
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund",
          "aria-label": "Nächster Monat",
          onclick: () => monat(1),
        },
        icon("weiter"),
      ),
    );
    const fuss = el(
      "div",
      { class: "kalender-fuss" },
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--klein knopf--still",
          onclick: () => {
            fokusTag = heuteIso();
            anzeige = fokusTag;
            zeichne(true);
          },
        },
        "Heute",
      ),
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--klein knopf--still",
          onclick: () => {
            f.eingabe.value = "";
            ereignisse(f.eingabe);
            schliesseKalender(true);
          },
        },
        "Löschen",
      ),
    );
    kalender.append(knopfZeile, raster, fuss);
    kalender.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        schliesseKalender(true);
      }
    });
    const ausserhalbKlick = (e) => {
      if (!wurzel.contains(e.target)) schliesseKalender();
    };
    schliesseKalender = (zurueckFokus = false) => {
      document.removeEventListener("pointerdown", ausserhalbKlick, true);
      kalender?.remove();
      kalender = null;
      toggle.setAttribute("aria-expanded", "false");
      schliesseKalender = () => {};
      if (zurueckFokus) toggle.focus();
    };
    document.addEventListener("pointerdown", ausserhalbKlick, true);
    wurzel.append(kalender);
    toggle.setAttribute("aria-expanded", "true");
    zeichne(true);
  }
  toggle.addEventListener("click", oeffne);
  return { wurzel, eingabe: f.eingabe };
}

// ---- Zeit ----

export function zeitfeld({ label, wert = "", hilfe, required }) {
  const f = textfeld({
    label,
    hilfe,
    required,
    platzhalter: "HH:MM",
    wandle: parseZeit,
    zeige: (w) => w,
  });
  f.eingabe.value = wert;
  return { wurzel: f.wurzel, eingabe: f.eingabe };
}

// ---- Datum mit Zeit: «2026-12-05T14:30» ----

export function datumZeitFeld({ label, wert = "", hilfe, required }) {
  const [d = "", z = ""] = wert.split("T");
  const datum = datumsfeld({ label: `${label}, Datum`, wert: d, required });
  const zeit = zeitfeld({ label: `${label}, Uhrzeit`, wert: z, required });
  const id = neueId("feld");
  // Eine gemeinsame Eingabe für den Aufrufer: Wert aus beiden, Ereignisse von beiden
  const eingabe = el("input", { type: "hidden", id });
  const nativ = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  Object.defineProperty(eingabe, "value", {
    get: () =>
      datum.eingabe.value && zeit.eingabe.value
        ? `${datum.eingabe.value}T${zeit.eingabe.value}`
        : "",
    set: (v) => {
      const [a = "", b = ""] = String(v ?? "").split("T");
      datum.eingabe.value = a;
      zeit.eingabe.value = b;
      nativ.set.call(eingabe, v ?? "");
    },
  });
  for (const teil of [datum.eingabe, zeit.eingabe]) {
    for (const art of ["input", "change"]) {
      teil.addEventListener(art, () =>
        eingabe.dispatchEvent(new Event(art, { bubbles: true })),
      );
    }
  }
  const wurzel = el(
    "fieldset",
    { class: "feld datumzeit" },
    el("legend", { class: "legende" }, label),
    el("div", { class: "datumzeit-zeile" }, datum.wurzel, zeit.wurzel),
    hilfe && el("p", { class: "hilfe" }, hilfe),
    eingabe,
  );
  // Die Beschriftungen der Teile sind die Legende plus «Datum» und «Uhrzeit»; sichtbar steht nur die Legende
  for (const l of wurzel.querySelectorAll(".datumsfeld > label"))
    l.classList.add("nur-leser");
  return { wurzel, eingabe };
}

// ---- Zahl mit Knöpfen ----

export function zahlfeld({
  label,
  wert = "",
  hilfe,
  required,
  min,
  max,
  schritt = 1,
}) {
  const minus = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--rund",
      "aria-label": `Weniger: ${label}`,
    },
    icon("minus"),
  );
  const plus = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--rund",
      "aria-label": `Mehr: ${label}`,
    },
    icon("plus"),
  );
  const f = textfeld({
    label,
    hilfe,
    required,
    inputmode: "numeric",
    platzhalter: "Zahl",
    breite: "datumsfeld-zeile--zahl",
    wandle: (roh) => {
      const s = String(roh)
        .trim()
        .replace(/['’\s]/g, "");
      if (!/^-?\d+$/.test(s)) return "";
      const n = Number(s);
      return (min === undefined || n >= min) && (max === undefined || n <= max)
        ? String(n)
        : "";
    },
    zeige: (w) => w,
    hinten: el("div", { class: "zahl-knoepfe" }, minus, plus),
  });
  f.eingabe.value = String(wert ?? "");
  const aendere = (d) => {
    const jetzt =
      f.eingabe.value === ""
        ? (min ?? 0) - d * schritt
        : Number(f.eingabe.value);
    let n = jetzt + d * schritt;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    f.eingabe.value = String(n);
    ereignisse(f.eingabe);
  };
  minus.addEventListener("click", () => aendere(-1));
  plus.addEventListener("click", () => aendere(1));
  f.eingabe.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      aendere(e.key === "ArrowUp" ? 1 : -1);
    }
  });
  return { wurzel: f.wurzel, eingabe: f.eingabe };
}
