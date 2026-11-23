// Gemeinsame Bausteine der Seiten Termine, Termin vorschlagen, Anlass und Anlass-Anmeldung (#530).
// Eine Ansicht ist eine reine Funktion von Daten zu einer Beschreibung (h), die baue() zu DOM-Knoten macht: Text wird nie als HTML gelesen, es gibt kein innerHTML. So lassen sich die Zustände ohne Browser testen (html()).

import { FRIST_MS, holeMitFrist } from "./ui.js";

const SVG = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "path", "circle", "rect"]);
const LEER = new Set(["input", "br"]);

// Beschreibung eines Elements; Kinder dürfen verschachtelt sein, null und false fallen weg
export function h(tag, attr, ...kinder) {
  return {
    tag,
    attr: attr ?? {},
    kinder: kinder
      .flat(Infinity)
      .filter((k) => k !== null && k !== undefined && k !== false),
  };
}

const verboten = (name) => /^on/i.test(name) || name === "style";

export function baue(doc, d) {
  if (typeof d !== "object") return doc.createTextNode(String(d));
  const svg = SVG_TAGS.has(d.tag);
  const e = svg ? doc.createElementNS(SVG, d.tag) : doc.createElement(d.tag);
  for (const [name, wert] of Object.entries(d.attr)) {
    if (wert === null || wert === undefined || wert === false) continue;
    if (verboten(name)) throw new Error("tm: Attribut nicht erlaubt");
    // value und readonly als Eigenschaft: Der Browser zeigt sonst den Ausgangswert
    if (name === "value" && !svg) e.value = String(wert);
    else e.setAttribute(name, wert === true ? "" : String(wert));
  }
  for (const k of d.kinder) e.append(baue(doc, k));
  return e;
}

const esc = (t) =>
  String(t).replace(
    /[&<>"']/g,
    (z) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        z
      ],
  );

// Zeichenkette für Tests und Fehlersuche, nie für die Seite
export function html(d) {
  if (typeof d !== "object") return esc(d);
  const attr = Object.entries(d.attr)
    .filter(([, w]) => w !== null && w !== undefined && w !== false)
    .map(([n, w]) => (w === true ? ` ${n}` : ` ${n}="${esc(w)}"`))
    .join("");
  return LEER.has(d.tag)
    ? `<${d.tag}${attr}>`
    : `<${d.tag}${attr}>${d.kinder.map(html).join("")}</${d.tag}>`;
}

// Sichtbarer Text einer Beschreibung (für Tests)
export const text = (d) =>
  typeof d !== "object" ? String(d) : d.kinder.map(text).join(" ");

// --- Symbole (eigene Pfade, 24er-Raster, Strich wie im Design-System)
const ICONS = {
  links: ["m15 18-6-6 6-6"],
  rechts: ["m9 18 6-6-6-6"],
  runter: ["m6 9 6 6 6-6"],
  zurueck: ["M19 12H5", "m12 19-7-7 7-7"],
  kopieren: ["M9 9h11v11H9z", "M5 15V4h11"],
  neu: ["M20 11a8 8 0 1 0-2.3 6", "M20 4v7h-7"],
  haken: ["m5 12 5 5 9-10"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5", "M12 8h.01"],
  warnung: ["M12 4 3 20h18z", "M12 10v5", "M12 17.5h.01"],
  schloss: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v9H5z"],
  kalender: ["M5 5h14v15H5z", "M5 10h14", "M9 3v4", "M15 3v4"],
  ort: [
    "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z",
    "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  ],
  uhr: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  zu: ["M6 6l12 12", "M18 6 6 18"],
};

export const icon = (name, klein = true) =>
  h(
    "svg",
    {
      class: klein ? "i k" : "i",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
    },
    ICONS[name].map((p) => h("path", { d: p })),
  );

// --- Wiederkehrende Ansichten (Zustände nach dem Design)
// Zustand im Inhalt: leer, Fehler, nicht angemeldet, kein Zugriff
export function zustandView({
  art = "",
  symbol = "info",
  titel,
  text: t,
  aktion,
  rolle = "status",
}) {
  return h(
    "div",
    { class: `zustand ${art}`.trim(), role: rolle },
    h("p", { class: "kopfzeile" }, icon(symbol, false), titel),
    t ? h("p", {}, t) : null,
    aktion ?? null,
  );
}

// Hinweisband: art ist "", "ok", "wa" oder "fe"
export function bandView({
  art = "",
  symbol,
  titel,
  text: t,
  aktion,
  rolle = "status",
  attr = {},
}) {
  return h(
    "div",
    { class: `band ${art}`.trim(), role: rolle, ...attr },
    symbol ? icon(symbol, false) : null,
    h(
      "div",
      { class: "text" },
      titel ? h("strong", {}, titel) : null,
      t ?? null,
      aktion ? h("div", { class: "aktion" }, aktion) : null,
    ),
  );
}

export const loginLink = (weiter) =>
  `/anmelden?weiter=${encodeURIComponent(weiter)}`;

export const nichtAngemeldetView = (
  weiter,
  titel = "Melde dich an, um das zu sehen.",
) =>
  zustandView({
    symbol: "schloss",
    titel,
    aktion: h(
      "a",
      { class: "btn p gross", href: loginLink(weiter) },
      "Anmelden",
    ),
  });

export const fehlerView = (
  nochmal,
  titel = "Das hat nicht geklappt.",
  t = "Prüfe dein Internet und versuche es nochmals.",
) =>
  zustandView({
    art: "fe",
    symbol: "warnung",
    titel,
    text: t,
    rolle: "alert",
    aktion: h(
      "button",
      { type: "button", class: "btn s", "data-aktion": nochmal },
      icon("neu"),
      "Nochmals versuchen",
    ),
  });

// Skeleton-Lader (#574): derselbe Baustein wie skelett() in ui.js, hier als Beschreibung. Der Rahmen ist für Hilfstechnik versteckt, die Ansage steht in der Statusregion (melde)
export const skelett = (...zeilen) =>
  h("div", { class: "skelett", "aria-hidden": "true" }, zeilen);
// Ein Platzhalterbalken: Klassen für Breite (b30 bis b100) und Höhe (h20 bis h56), nie ein style-Attribut (CSP)
export const sk = (klassen) => h("span", { class: `sk ${klassen}` });

// --- Netz
// Ergebnis: { status, daten, offline }. status 0 = keine Antwort. Es werden nur Antworten gelesen, nie Fehlertexte als HTML gezeigt
export async function api(pfad, { methode = "GET", body } = {}) {
  let antwort;
  try {
    // Mit Frist: Nichts bleibt für immer im Ladezustand (Abrufe 15 s, Änderungen 30 s)
    antwort = await holeMitFrist(
      `/api/v1${pfad}`,
      {
        method: methode,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
      methode === "GET" ? FRIST_MS : 2 * FRIST_MS,
    );
  } catch {
    return {
      status: 0,
      daten: null,
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
    };
  }
  let daten = null;
  if ((antwort.headers.get("content-type") ?? "").includes("json")) {
    try {
      daten = await antwort.json();
    } catch {
      daten = null;
    }
  }
  return { status: antwort.status, daten, offline: false };
}

// --- Zeit (alles in der Zeitzone der Abteilung, unabhängig vom Gerät)
export const ZEITZONE = "Europe/Zurich";
export const WOCHENTAG = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];
export const WOCHENTAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const MONAT = [
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
export const MONAT_KURZ = [
  "Jan.",
  "Feb.",
  "März",
  "Apr.",
  "Mai",
  "Juni",
  "Juli",
  "Aug.",
  "Sept.",
  "Okt.",
  "Nov.",
  "Dez.",
];

let formatierer;
// Jahr, Monat (1 bis 12), Tag, Stunde, Minute eines Zeitpunkts in Zürich
export function teile(zeit) {
  formatierer ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: ZEITZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(
    formatierer.formatToParts(new Date(zeit)).map((t) => [t.type, t.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

const zwei = (n) => String(n).padStart(2, "0");
export const tagText = ({ y, m, d }) => `${y}-${zwei(m)}-${zwei(d)}`;
export const heute = () => tagText(teile(Date.now()));

// «2027-02-06» in Teile; null bei Unsinn
export function tagTeile(tag) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
export const wochentagVon = (tag) => {
  const t = tagTeile(tag);
  return new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay();
};
export const tagPlus = (tag, n) => {
  const t = tagTeile(tag);
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`;
};
export const tageImMonat = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const uhrzeit = (zeit) => {
  const t = teile(zeit);
  return `${zwei(t.h)}:${zwei(t.min)}`;
};
// «6. Februar 2027»
export const datumLang = (tag) => {
  const t = tagTeile(tag);
  return `${t.d}. ${MONAT[t.m - 1]} ${t.y}`;
};
// «15. März» ohne Jahr
export const datumKurz = (tag) => {
  const t = tagTeile(tag);
  return `${t.d}. ${MONAT[t.m - 1]}`;
};
// «12.01.2027, 18:40»
export const zeitpunktText = (zeit) => {
  const t = teile(zeit);
  return `${zwei(t.d)}.${zwei(t.m)}.${t.y}, ${zwei(t.h)}:${zwei(t.min)}`;
};

// Erster und letzter Tag (Zürcher Kalendertag) eines Termins
export const ersterTag = (t) =>
  t.ganztaegig ? t.tagVon : tagText(teile(t.beginn));
export const letzterTag = (t) => {
  if (t.ganztaegig) return t.tagBis;
  // Ein Ende genau um Mitternacht gehört noch zum Vortag
  const ende = teile(t.ende);
  const tag = tagText(ende);
  return ende.h === 0 && ende.min === 0 && tag > ersterTag(t)
    ? tagPlus(tag, -1)
    : tag;
};

// «14:00–17:00 · Ort», «Ganztägig · bis 24. Juli»
export function terminMeta(t) {
  const von = ersterTag(t);
  const bis = letzterTag(t);
  let zeit;
  if (t.ganztaegig) {
    zeit = bis > von ? `Ganztägig bis ${datumKurz(bis)}` : "Ganztägig";
  } else if (bis > von) {
    zeit = `ab ${uhrzeit(t.beginn)} bis ${datumKurz(bis)}, ${uhrzeit(t.ende)}`;
  } else {
    zeit = `${uhrzeit(t.beginn)}–${uhrzeit(t.ende)}`;
  }
  return t.ort ? `${zeit} · ${t.ort}` : zeit;
}

// Lokale Zürcher Wandzeit als UTC-Zeitpunkt (ISO), mit Sommer- und Winterzeit
export function zuerichZuIso(y, mo, d, h, mi) {
  const naiv = Date.UTC(y, mo - 1, d, h, mi);
  const versatz = (ms) => {
    const p = teile(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - ms;
  };
  let t = naiv - versatz(naiv);
  t = naiv - versatz(t);
  return new Date(t).toISOString();
}

// --- Fenster mit Rückfrage (Dialog des Browsers: Fokus bleibt darin, Escape bricht ab)
export function bestaetige(
  doc,
  wurzel,
  { titel, text: t, ja, nein = "Abbrechen" },
) {
  return new Promise((fertig) => {
    const dlg = baue(
      doc,
      h(
        "dialog",
        {
          role: "alertdialog",
          "aria-labelledby": "tm-dlg-t",
          "aria-describedby": "tm-dlg-d",
        },
        h(
          "div",
          { class: "inhalt" },
          h("h2", { id: "tm-dlg-t" }, titel),
          h("p", { id: "tm-dlg-d" }, t),
          h(
            "div",
            { class: "knopfreihe" },
            h(
              "button",
              {
                type: "button",
                class: "btn s",
                autofocus: true,
                "data-ja": "0",
              },
              nein,
            ),
            h("button", { type: "button", class: "btn p", "data-ja": "1" }, ja),
          ),
        ),
      ),
    );
    let antwort = false;
    dlg.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-ja]");
      if (b) {
        antwort = b.dataset.ja === "1";
        dlg.close();
      }
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      fertig(antwort);
    });
    wurzel.append(dlg);
    dlg.showModal();
  });
}

// Meldung für Hilfstechnik: eine Live-Region, die schon im Dokument steht
export function melde(doc, t) {
  const r = doc.getElementById("tm-status");
  if (r) r.textContent = t;
}

// Ruhige Ansage des Ladens (#574): erst wenn es länger als 700 ms dauert, und nur einmal. Ein schneller Abruf braucht sie nicht, das Ergebnis meldet melde().
// Gibt die Funktion zurück, die die Ansage zurücknimmt (beim Eintreffen der Antwort; eine schon gesagte Ansage wird geleert, das Ergebnis folgt danach)
export function ladeAnsage(doc, t) {
  let gesagt = false;
  const timer = setTimeout(() => {
    gesagt = true;
    melde(doc, t);
  }, 700);
  return () => {
    clearTimeout(timer);
    if (gesagt) melde(doc, "");
  };
}
