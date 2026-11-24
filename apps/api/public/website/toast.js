// Rückmeldungen nach einer Aktion auf der Website (#762): ein Toast an einer festen Stelle (unten in der Mitte, am Handy über die Breite), überall gleich.
// Regel: Ergebnis einer Aktion (Erfolg, Fehler, der nichts blockiert, Info) ist ein Toast. Inline bleiben Feldfehler, die Zusammenfassung beim Absenden, Lade- und Leerzustände, dauerhafte Seitenzustände und Entscheidungen (docs/website-design.md, «Rückmeldungen»).
// Erfolg und Info gehen nach 4 Sekunden, ein Fehler nach 8 Sekunden; Zeiger und Tastaturfokus halten die Zeit an (WCAG 2.2.1), «Schliessen» und Esc schliessen sofort. Höchstens 3 stehen zugleich, der älteste weicht.
// Höflich angesagt wird Erfolg und Info, bestimmt nur ein Fehler (WCAG 4.1.3). Der Toast nimmt dem Fokus nichts weg. Ohne innerHTML und ohne Abhängigkeit; die Stile stehen in website.css (Abschnitt «Toasts»).
// Wer die Seite gleich verlässt (Anmelden, Abmelden), merkt den Toast mit merkeToast(); die nächste Seite zeigt ihn beim Laden dieses Moduls (konto-menue.js lädt es dafür nur, wenn einer wartet).

const SVG = "http://www.w3.org/2000/svg";
export const ERFOLG_MS = 4000;
export const FEHLER_MS = 8000;
export const MAX = 3;
export const MERKER = "cevi-toast";

// Linien im Raster des Symbolsatzes der Website (Klasse «i», 24er-Raster); der Pfad ist ein fester Wert dieses Moduls
const SYMBOLE = {
  ok: ["M5 12l5 5 9-10"],
  info: ["M12 11v6", "M12 6.5v2"],
  fehler: ["M12 3.5 21.5 20h-19z", "M12 9.5v5", "M12 16v2"],
  zu: ["M6 6l12 12", "M18 6L6 18"],
};

function symbol(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of SYMBOLE[name]) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

let region = null;
let hoeflich = null;
let bestimmt = null;
let vorher = null;
let beobachter = null;
const offen = new Set();

// Ein offener modaler Dialog macht alles ausserhalb unbedienbar: Die Region zieht dann in ihn um und danach zurück
function ort() {
  const dialoge = [...document.querySelectorAll("dialog[open]")];
  return dialoge.at(-1) ?? document.body;
}

function platziere() {
  if (!region) return;
  beobachter?.disconnect();
  beobachter = null;
  const dialog = ort();
  if (dialog !== document.body) {
    if (region.parentNode !== dialog) dialog.append(region);
    // Der Dialog zeichnet sich neu (replaceChildren) und würde die Region mitnehmen: Sie kommt zurück
    beobachter = new MutationObserver(() => {
      if (region.parentNode !== dialog) dialog.append(region);
    });
    beobachter.observe(dialog, { childList: true });
    return;
  }
  // Gleich vor dem Inhalt: Tab erreicht sie nach dem Kopf, nicht erst am Ende der Seite
  const haupt = document.querySelector("main");
  if (haupt) {
    if (region.nextElementSibling !== haupt) haupt.before(region);
  } else if (region.parentNode !== document.body) {
    document.body.append(region);
  }
}

function baueRegion() {
  region = document.createElement("div");
  region.className = "toasts";
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Rückmeldungen");
  hoeflich = document.createElement("div");
  hoeflich.className = "toast-liste";
  hoeflich.setAttribute("aria-live", "polite");
  bestimmt = document.createElement("div");
  bestimmt.className = "toast-liste";
  bestimmt.setAttribute("aria-live", "assertive");
  region.append(hoeflich, bestimmt);
  platziere();
  // Ein Dialog, der sich schliesst, nimmt die Region nicht mit
  document.addEventListener("close", platziere, true);
  document.addEventListener("keydown", beiTaste);
  region.addEventListener("focusin", (e) => {
    if (e.relatedTarget && !region.contains(e.relatedTarget)) {
      vorher = e.relatedTarget;
    }
  });
}

function beiTaste(e) {
  if (e.key !== "Escape" || e.defaultPrevented || offen.size === 0) return;
  const imToast = region.contains(document.activeElement);
  // Esc gehört zuerst dem Dialog und dem Menü, die gerade offen sind
  if (!imToast && ort() !== document.body) return;
  const t = imToast
    ? [...offen].find((x) => x.el.contains(document.activeElement))
    : [...offen].at(-1);
  if (t) schliesse(t);
}

function schliesse(t) {
  if (!offen.delete(t)) return;
  clearTimeout(t.timer);
  const hatteFokus = t.el.contains(document.activeElement);
  t.el.remove();
  if (hatteFokus) {
    // Der Fokus geht dorthin zurück, wo die Person herkam; sonst zum Inhalt
    const ziel = vorher?.isConnected ? vorher : document.querySelector("main");
    ziel?.focus?.();
  }
}

function starte(t) {
  clearTimeout(t.timer);
  t.start = Date.now();
  t.timer = setTimeout(() => schliesse(t), t.rest);
}

function pausiere(t) {
  if (!t.start) return;
  clearTimeout(t.timer);
  t.rest = Math.max(1000, t.rest - (Date.now() - t.start));
  t.start = 0;
}

function setzeFort(t) {
  if (t.el.matches(":hover") || t.el.contains(document.activeElement)) return;
  if (!t.start) starte(t);
}

// art: "ok" (Standard), "info" oder "fehler". Gleicher Text in gleicher Art: Der Toast steht schon da, seine Zeit beginnt neu.
export function toast(text, art = "ok") {
  if (typeof document === "undefined" || !text) return null;
  if (!region) baueRegion();
  else platziere();
  for (const t of offen) {
    if (t.text === text && t.art === art) {
      t.rest = art === "fehler" ? FEHLER_MS : ERFOLG_MS;
      if (!t.el.matches(":hover")) starte(t);
      return t;
    }
  }
  while (offen.size >= MAX) schliesse(offen.values().next().value);
  const el = document.createElement("div");
  el.className = `toast toast--${art}`;
  const satz = document.createElement("p");
  satz.className = "toast-text";
  satz.textContent = text;
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "toast-zu";
  zu.setAttribute("aria-label", "Schliessen");
  zu.append(symbol("zu"));
  el.append(symbol(art), satz, zu);
  const t = {
    el,
    text,
    art,
    rest: art === "fehler" ? FEHLER_MS : ERFOLG_MS,
    start: 0,
    timer: 0,
  };
  zu.addEventListener("click", () => schliesse(t));
  el.addEventListener("mouseenter", () => pausiere(t));
  el.addEventListener("mouseleave", () => setzeFort(t));
  el.addEventListener("focusin", () => pausiere(t));
  el.addEventListener("focusout", () => setTimeout(() => setzeFort(t), 0));
  offen.add(t);
  // Die Listen stehen schon im Dokument, bevor ein Eintrag dazukommt: So sagt der Screenreader ihn an
  (art === "fehler" ? bestimmt : hoeflich).append(el);
  starte(t);
  return t;
}

// Für den Wechsel der Seite: Der Toast wird auf der nächsten Seite gezeigt (nur eine Sitzung des Tabs, kein Name, kein Inhalt ausser dem Satz)
export function merkeToast(text, art = "ok") {
  try {
    window.sessionStorage.setItem(MERKER, JSON.stringify({ text, art }));
  } catch {
    // Kein Speicher: Die Seite zeigt den neuen Zustand trotzdem
  }
}

export function zeigeVorgemerkte() {
  let roh;
  try {
    roh = window.sessionStorage.getItem(MERKER);
    window.sessionStorage.removeItem(MERKER);
  } catch {
    return;
  }
  if (!roh) return;
  try {
    const { text, art } = JSON.parse(roh);
    if (typeof text === "string" && text.length <= 200) {
      toast(text, art === "fehler" || art === "info" ? art : "ok");
    }
  } catch {
    // Kaputter Merker: wegwerfen
  }
}

if (typeof window !== "undefined") zeigeVorgemerkte();
