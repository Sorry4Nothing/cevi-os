import { ApiFehler, fehlertext } from "./api.js";
import { zurueckKlick } from "./verlauf.js";
import { el, feld, icon, knopf } from "./dom.js";

// Gemeinsames des Bereichs «Lager» (#527): Texte, Symbole, Statuschip, Datum und die Meldung, die eine Navigation überlebt. Klassen mit dem Vorsatz «lg-».

export const BASIS = "/api/v1/admin/lager";
export const ADRESSE = "#lager/lager";
export const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ROLLEN = [
  ["lagerleitung", "Lagerleitung"],
  ["leitung", "Leitung"],
  ["team", "Team"],
  ["lesen", "Lesen"],
];
export const ROLLENNAME = Object.fromEntries(ROLLEN);

const TEXTE = {
  LAGER_GESCHLOSSEN:
    "Das Lager ist schreibgeschützt. Öffne es wieder, wenn du etwas ändern willst.",
  LAGERLEITUNG_FEHLT:
    "Ein aktives Lager braucht mindestens eine Lagerleitung. Setze zuerst eine unter «Mitglieder und Rollen».",
  LAGER_NICHT_LOESCHBAR:
    "Nur ein Entwurf oder ein archiviertes Lager lässt sich löschen. Archiviere das Lager zuerst.",
  VORLAGENNAME_VERGEBEN:
    "Es gibt schon eine Vorlage dieser Art mit diesem Namen.",
  LIMIT_ERREICHT:
    "Das geht nicht: Die Obergrenze ist erreicht (100 Vorlagen, 500 Punkte der Packliste).",
  VORLAGE_UNGUELTIG: "Der Inhalt dieser Vorlage ist nicht lesbar.",
  ZU_GROSS:
    "Der Aushang wäre zu gross (mehr als 2000 Zeilen oder 100 Seiten). Wende dich an die Betreuung.",
};
// Die Meldung für einen Fehler der Lager-Routen; Codes ohne eigenen Text folgen dem Gerüst
export const meldung = (f) => TEXTE[f?.code] ?? fehlertext(f);

// Eine Meldung, die nach einer Navigation stehen soll (der Router leert die Rückmeldungen bei jedem Wechsel); die nächste Seite zeigt sie einmal
let wartend = null;
export const merkeMeldung = (text, art = "ok", aktion) =>
  (wartend = { text, art, aktion });
export function zeigeWartende(ctx) {
  if (!wartend) return;
  ctx.melde(wartend.text, wartend.art, wartend.aktion);
  wartend = null;
}

// Symbole, die das Design braucht und dom.js nicht kennt; Rest über dom.icon
const SVG_NS = "http://www.w3.org/2000/svg";
const EIGENE = {
  schloss: [
    ["rect", { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }],
    "M8 10.5V7a4 4 0 0 1 8 0v3.5",
  ],
  archiv: ["M8 8h8M8 12h8M8 16h5"],
  zurueck: ["M19 12H5", "M11 6l-6 6 6 6"],
  pdf: ["M6.5 3.5h7l4 4v13h-11z", "M13.5 3.5v4h4"],
  drucker: [
    "M7 9V3.5h10V9",
    "M7 17H4.5v-7.5h15V17H17",
    ["rect", { x: 7, y: 14, width: 10, height: 6.5 }],
  ],
};
export function symbol(name) {
  const teile = EIGENE[name];
  if (!teile) return icon(name);
  const knoten = document.createElementNS(SVG_NS, "svg");
  knoten.setAttribute("class", "i");
  knoten.setAttribute("viewBox", "0 0 24 24");
  knoten.setAttribute("aria-hidden", "true");
  for (const teil of teile) {
    const [tagName, eigenschaften] =
      typeof teil === "string" ? ["path", { d: teil }] : teil;
    const form = document.createElementNS(SVG_NS, tagName);
    for (const [k, w] of Object.entries(eigenschaften))
      form.setAttribute(k, String(w));
    knoten.append(form);
  }
  return knoten;
}

// Knopf mit einem Symbol aus symbol()
export function knopfMit(text, { symbol: name, ...rest } = {}) {
  const k = knopf(text, rest);
  if (name) k.prepend(symbol(name));
  return k;
}

const STATUS = {
  entwurf: ["Entwurf", "bearbeiten", "warn"],
  aktiv: ["Aktiv", "haken", "ok"],
  abgeschlossen: ["Abgeschlossen", "schloss", undefined],
  archiviert: ["Archiviert", "archiv", undefined],
};
export const STATUSNAME = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v[0]]),
);
// Zustand nie nur über Farbe: Wort und Symbol
export function statusChip(status) {
  const [text, name, art] = STATUS[status] ?? [status, "info"];
  return el(
    "span",
    { class: art ? `chip chip--${art}` : "chip" },
    symbol(name),
    text,
  );
}

const zweistellig = (n) => String(n).padStart(2, "0");
const teile = (iso) => {
  const [j, m, t] = iso.split("-");
  return { j, m, t };
};
// «17.–24.07.2027», «28.07.–03.08.2027» oder «30.12.2027–03.01.2028»; ein Tag allein ohne Bereich
export function zeitraum(von, bis) {
  if (!von || !bis) return "–";
  const a = teile(von);
  const b = teile(bis);
  if (von === bis) return `${a.t}.${a.m}.${a.j}`;
  if (a.j === b.j && a.m === b.m) return `${a.t}.–${b.t}.${b.m}.${b.j}`;
  if (a.j === b.j) return `${a.t}.${a.m}.–${b.t}.${b.m}.${b.j}`;
  return `${a.t}.${a.m}.${a.j}–${b.t}.${b.m}.${b.j}`;
}
export const datumKurz = (iso) => {
  const wert = new Date(iso);
  return Number.isNaN(wert.getTime())
    ? ""
    : `${zweistellig(wert.getDate())}.${zweistellig(wert.getMonth() + 1)}.${wert.getFullYear()}`;
};

// Fehler direkt unter einem Feld aus feld() oder auswahl(); der Fokus geht ins Feld. Eine alte Meldung verschwindet beim nächsten Tippen.
export function feldFehler(f, text, { fokus = true } = {}) {
  const alt = f.wurzel.querySelector(".feld-fehler");
  alt?.remove();
  f.eingabe.removeAttribute("aria-invalid");
  if (!text) return;
  const p = el(
    "p",
    { class: "feld-fehler", id: `${f.eingabe.id}-fehler`, role: "alert" },
    text,
  );
  f.wurzel.append(p);
  f.eingabe.setAttribute("aria-invalid", "true");
  f.eingabe.setAttribute(
    "aria-describedby",
    [f.eingabe.getAttribute("aria-describedby"), p.id]
      .filter(Boolean)
      .join(" "),
  );
  f.eingabe.addEventListener(
    "input",
    () => {
      f.eingabe.removeAttribute("aria-invalid");
      p.remove();
    },
    { once: true },
  );
  if (fokus) f.eingabe.focus();
}

// Die Felder der Grunddaten (Anlegen und Ändern): Name, Beginn, Ende, Ort. Daten als Datumsfeld, damit der Wert schon ISO ist.
// pruefe() liefert die Fehler [{ f, id, label, text }]; leer heisst gültig. koerper() liefert den Teil der Anfrage.
export function grunddaten(start = {}) {
  const name = feld({
    label: "Name",
    wert: start.titel ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const von = feld({ label: "Beginn", typ: "date", wert: start.von ?? "" });
  const bis = feld({ label: "Ende", typ: "date", wert: start.bis ?? "" });
  const ort = feld({
    label: "Ort",
    hilfe: "Freiwillig.",
    wert: start.ort ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const wert = (f) => f.eingabe.value.trim();
  return {
    felder: { name, von, bis, ort },
    pruefe() {
      const fehler = [];
      const melde = (f, label, text) => fehler.push({ f, label, text });
      if (wert(name) === "") melde(name, "Name", "Gib dem Lager einen Namen.");
      if (wert(von) === "") melde(von, "Beginn", "Wähle den Beginn.");
      if (wert(bis) === "") melde(bis, "Ende", "Wähle das Ende.");
      else if (wert(von) !== "" && wert(bis) < wert(von))
        melde(
          bis,
          "Ende",
          `Das Ende liegt vor dem Beginn. Wähle ein Datum ab ${datumKurz(wert(von))}.`,
        );
      return fehler;
    },
    // ort: «» leert ihn beim Ändern (null), beim Anlegen fällt er weg
    koerper: ({ aendern = false } = {}) => ({
      titel: wert(name),
      von: wert(von),
      bis: wert(bis),
      ...(wert(ort) !== "" ? { ort: wert(ort) } : aendern ? { ort: null } : {}),
    }),
  };
}

// Alle Fehler beim Laden eines Lagers: eine ungültige Adresse ist 404
export const nichtGefunden = () => Promise.reject(new ApiFehler(404));

// Zurück-Link über dem Inhalt einer Unterseite
export function zurueckLink(text, href) {
  return el(
    "a",
    { class: "lg-zurueck", href, onclick: zurueckKlick },
    symbol("zurueck"),
    text,
  );
}

// Hängt Knoten an und lässt false, null und undefined weg (append() schriebe sie als Text)
export const haenge = (ziel, ...kinder) =>
  ziel.append(...kinder.filter(Boolean));
