// Seiten im Fluss statt Dialoge (#578): Was früher als Fenster über der Seite aufging (Anlegen, Bearbeiten, Details), ersetzt jetzt die Ansicht im Inhalt der Verwaltung, mit eigenem Verlaufseintrag.
// - «seite»: Die offene Ansicht bleibt im DOM (versteckt), damit Filter, Auswahl und Scrollposition beim Zurück noch da sind. Browser-Zurück und «Zurück» schliessen sie.
// - «panel» (Editor): ein nicht modales Panel rechts im Layout, ohne Verlaufseintrag; bei schmalen Fenstern wird es eine Seite.
// Ungespeicherte Eingaben fragt der Hinweis im Fluss ab («Änderungen verwerfen?», zweistufig, kein Popup), auch bei Menü, Link und Browser-Zurück; ungespeichert.js hält die letzte Rückfallebene für Tab schliessen und Neuladen (#699).
// Dieses Modul importiert nur den Wächter: dom.js baut die Knoten und ruft oeffneFluss().

import { schuetze, wechsle } from "./ungespeichert.js";

const stapel = [];
let zaehler = 0;
// Die Kennung gilt nur für diesen Seitenaufruf: Einträge, die ein Neuladen überleben, sind danach verwaist
const start = Date.now().toString(36);
// Position im Verlauf (Navigation API, wo es sie gibt): zeigt, in welche Richtung ein popstate ging
let letzteStelle;
// Anzahl popstate-Ereignisse, die history.back() nach einem Schliessen in diesem Modul selbst auslöst
let ignoriere = 0;
const BREIT = "(min-width: 75rem)";

const seiten = () => stapel.filter((e) => e.modus === "seite");
export const flussOffen = () => stapel.length > 0;

function zeigeOben() {
  const s = seiten();
  s.forEach((e, i) => {
    e.wurzel.hidden = i < s.length - 1;
  });
  document
    .getElementById("bereich")
    ?.classList.toggle("fluss-offen", s.length > 0);
  document
    .getElementById("seitenkopf")
    ?.classList.toggle("fluss-weg", s.length > 0);
}

// wurzel: der fertige Knoten der Seite; bekommt close(), versuchSchliessen(), open und löst «close» aus
export function oeffneFluss(wurzel, { panel = false } = {}) {
  const modus = panel && window.matchMedia(BREIT).matches ? "panel" : "seite";
  const e = {
    id: `${start}-${++zaehler}`,
    wurzel,
    modus,
    hash: location.hash,
    y: window.scrollY,
    schmutzig: false,
  };
  stapel.push(e);
  letzteStelle = window.navigation?.currentEntry?.index;
  wurzel.close = () => schliesse(e);
  wurzel.versuchSchliessen = () => versuche(e);
  Object.defineProperty(wurzel, "open", { get: () => stapel.includes(e) });
  const merke = () => (e.schmutzig = true);
  wurzel.addEventListener("input", merke);
  wurzel.addEventListener("change", merke);
  if (modus === "panel") {
    document.body.append(wurzel);
    document.body.classList.add("panel-offen");
    return e;
  }
  // Die Position der Ansicht darunter steht im Verlaufseintrag, bevor der neue entsteht
  window.history.replaceState(
    { ...window.history.state, y: e.y },
    "",
    location.href,
  );
  (document.getElementById("bereich") ?? document.body).append(wurzel);
  window.history.pushState({ fluss: e.id }, "", location.href);
  letzteStelle = window.navigation?.currentEntry?.index;
  zeigeOben();
  window.scrollTo(0, 0);
  return e;
}

// Schliesst sofort (Aufrufer nach dem Speichern) und geht im Verlauf einen Schritt zurück. verlauf = false: Der Verlauf ist schon dort (Browser-Zurück)
function schliesse(e, verlauf = true) {
  const i = stapel.indexOf(e);
  if (i < 0) return;
  stapel.splice(i, 1);
  e.wurzel.remove();
  if (e.modus === "panel") {
    if (!stapel.some((x) => x.modus === "panel")) {
      document.body.classList.remove("panel-offen");
    }
  } else {
    zeigeOben();
    if (seiten().length === 0) window.scrollTo(0, e.y);
    if (verlauf && window.history.state?.fluss === e.id) {
      ignoriere++;
      window.history.back();
    }
  }
  e.wurzel.dispatchEvent(new Event("close"));
}

export function schliesseAlle() {
  for (const e of [...stapel].reverse()) schliesse(e, false);
}

// Schliesst, fragt aber zuerst, wenn etwas eingegeben wurde
function versuche(e) {
  if (e.schmutzig) zeigeFrage(e);
  else schliesse(e);
}

function knopf(text, klasse, beiKlick) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = `knopf knopf--klein ${klasse}`.trim();
  k.textContent = text;
  k.addEventListener("click", beiKlick);
  return k;
}

// Zweistufig, im Fluss: eine Zeile über den Knöpfen der Seite, kein Popup
// ziel: Adresse, zu der die Person wollte (Menü, Link, Browser-Zurück); «Verwerfen» führt dorthin
function zeigeFrage(e, ziel) {
  const vorhanden = e.wurzel.querySelector(".fluss-frage");
  if (vorhanden) {
    vorhanden.querySelector("button").focus();
    return;
  }
  const weiter = knopf("Weiter bearbeiten", "", () => {
    frage.remove();
    e.wurzel
      .querySelector("input:not([type=hidden]), textarea, .auswahl-knopf")
      ?.focus();
  });
  const verwerfen = knopf("Verwerfen", "knopf--gefahr", () => {
    e.schmutzig = false;
    schliesse(e);
    if (ziel) nachVerlauf(() => wechsle(ziel));
  });
  const text = document.createElement("span");
  text.textContent = "Änderungen verwerfen?";
  const frage = document.createElement("div");
  frage.className = "hinweis hinweis--warn fluss-frage";
  frage.setAttribute("role", "alert");
  frage.append(text, weiter, verwerfen);
  const ort = e.wurzel.querySelector(
    ".dialog-knoepfe, .blatt-fuss, .fluss-fuss",
  );
  if (ort) ort.before(frage);
  else e.wurzel.append(frage);
  weiter.focus();
}

window.addEventListener("popstate", (ereignis) => {
  const stelle = window.navigation?.currentEntry?.index;
  const richtung =
    stelle !== undefined && letzteStelle !== undefined
      ? Math.sign(stelle - letzteStelle)
      : 0;
  letzteStelle = stelle;
  if (ignoriere > 0) {
    ignoriere--;
    return;
  }
  const oben = seiten().at(-1);
  // Ein verwaister Eintrag einer geschlossenen Seite (etwa nach einem Link mitten in der Seite oder mit «Vor»): überspringen, in dieselbe Richtung
  const fluss = ereignis.state?.fluss;
  if (!oben && fluss !== undefined && richtung !== 0) {
    ignoriere++;
    window.history.go(richtung);
    return;
  }
  if (!oben || ereignis.state?.fluss === oben.id) return;
  // Zu einer anderen Adresse (Sprung im Verlauf): Ist etwas ungespeichert, kommt der Eintrag der Seite zurück und die Frage steht; sonst gehört die Seite zur alten Ansicht
  if (location.hash !== oben.hash) {
    if (!stapel.some((x) => x.schmutzig)) return schliesseAlle();
    const ziel = location.hash;
    window.history.replaceState(
      { fluss: oben.id },
      "",
      `${location.pathname}${location.search}${oben.hash}`,
    );
    zeigeFrage(oben, ziel);
    return;
  }
  if (oben.schmutzig) {
    // Der Eintrag der Seite kommt zurück, die Frage steht; so bleibt der Verlauf stimmig
    window.history.pushState({ fluss: oben.id }, "", location.href);
    zeigeFrage(oben);
    return;
  }
  schliesse(oben, false);
});

// Ein Link auf eine andere Ansicht, während etwas ungespeichert ist: erst fragen
document.addEventListener(
  "click",
  (ereignis) => {
    const a = ereignis.target.closest?.('a[href^="#"]');
    const oben = seiten().at(-1);
    if (!a || !oben?.schmutzig || a.getAttribute("href") === "#inhalt") return;
    if (oben.wurzel.contains(a)) return;
    ereignis.preventDefault();
    ereignis.stopImmediatePropagation();
    zeigeFrage(oben, a.getAttribute("href"));
  },
  true,
);

// Escape schliesst die oberste Seite, wenn kein Menü und keine Auswahl ihn schon gebraucht hat
document.addEventListener("keydown", (ereignis) => {
  if (ereignis.key !== "Escape" || ereignis.defaultPrevented) return;
  if (document.querySelector("details.menue[open], dialog[open]")) return;
  stapel.at(-1)?.wurzel.versuchSchliessen();
});

// Sprünge im Verlauf und Adressen von aussen fängt der Wächter; die Frage ist die Zeile der obersten ungespeicherten Seite
schuetze({
  schluessel: "fluss",
  geaendert: () => stapel.some((e) => e.schmutzig),
  innerhalb: (hash) =>
    stapel.filter((e) => e.schmutzig).every((e) => e.hash === hash),
  frage: (ziel) => {
    const e = stapel.filter((x) => x.schmutzig).at(-1);
    if (e) zeigeFrage(e, ziel);
  },
});

// Wartet, bis ein selbst ausgelöstes history.back() angekommen ist; danach darf fn die Adresse ändern (sonst landete das Zurück auf dem neuen Eintrag)
export function nachVerlauf(fn) {
  if (ignoriere === 0) return fn();
  const warte = () =>
    ignoriere > 0
      ? window.addEventListener("popstate", warte, { once: true })
      : fn();
  window.addEventListener("popstate", warte, { once: true });
}
