// Füllt die Platzhalter «data-geschuetzt» einer Seite, wenn eine Sitzung besteht (#354), und ersetzt die Hülle einer ganz geschützten Seite durch ihren Inhalt. Zustände nach dem Design W10.
// Der Server liefert nur Knoten als JSON (GET /api/v1/website/inhalt); sie werden mit knoten.js zu DOM-Knoten, nie über innerHTML. Das Dokument im HTML bleibt unverändert, die Sitzung liegt nur im Cookie.
import { baueKnoten } from "./knoten.js";
import { el, skelett as skelettBaustein, symbol } from "./ui.js";

const haupt = document.getElementById("inhalt");
const pfad = haupt?.dataset.pfad;
const huelle = haupt?.hasAttribute("data-huelle") ?? false;

// Ab hier gilt das Skelett als zu lang: nach 4 Sekunden ein Hinweis, nach 15 Sekunden ein Fehler (Annahme des Designs, G3)
const HINWEIS_NACH_MS = 4000;
const ABBRUCH_NACH_MS = 15000;

if (haupt && pfad) start();

function start() {
  // Die Spalte der Seite: Hier stehen in der Hülle die Zustände und später der Inhalt
  const spalte = haupt.querySelector(".wrap") ?? haupt;
  // Eine Live-Region für das Ergebnis, die schon im Dokument steht, bevor sich ihr Text ändert
  const status = el("p", "nur-sr");
  status.setAttribute("role", "status");
  document.body.append(status);

  const platzhalter = huelle
    ? []
    : [...haupt.querySelectorAll("[data-geschuetzt]")];
  // Der Hinweis «Nur angemeldet sichtbar» steht im HTML; er kommt bei «nicht angemeldet» zurück
  const hinweisHuelle = huelle ? spalte.querySelector(".schutzblock") : null;
  const zustand = huelle ? spalte.appendChild(el("div")) : null;
  const behaelter = huelle ? [zustand] : platzhalter;
  const original = new Map(platzhalter.map((p) => [p, [...p.childNodes]]));
  let hinweisTimer = 0;
  let abbruchTimer = 0;
  let abbruch = null;

  const raeume = () => {
    clearTimeout(hinweisTimer);
    clearTimeout(abbruchTimer);
    behaelter.forEach((b) => {
      b.replaceChildren();
      b.removeAttribute("aria-busy");
    });
    if (hinweisHuelle) hinweisHuelle.hidden = true;
  };

  // Die Meldung steht im ersten Behälter, die übrigen bleiben leer: Sie erscheint einmal, nicht je Baustein
  const zeigeIm = (knoten) => {
    raeume();
    if (behaelter.length > 0) behaelter[0].append(knoten);
  };

  const zeigeLaden = () => {
    raeume();
    behaelter.forEach((b) => {
      b.setAttribute("aria-busy", "true");
      // Formgleich zum Inhalt (Design G3, gemeinsamer Baustein aus ui.js)
      const skelett = skelettBaustein("h24 b40", "t b90", "t b60", "t b90");
      skelett.classList.add("karte");
      b.append(skelett);
    });
    status.textContent = "Geschützte Inhalte werden geladen.";
    hinweisTimer = setTimeout(() => {
      status.textContent = "Das dauert länger als sonst.";
      const lang = el("p", "klein leise", "Das dauert länger als sonst.");
      if (behaelter.length > 0) behaelter[0].append(lang);
    }, HINWEIS_NACH_MS);
    abbruchTimer = setTimeout(() => abbruch?.abort(), ABBRUCH_NACH_MS);
  };

  const zeigeFehler = (text) => {
    const nochmal = el(
      "button",
      "btn s",
      symbol("nochmals"),
      "Nochmals versuchen",
    );
    nochmal.type = "button";
    nochmal.addEventListener("click", lade);
    const box = el(
      "div",
      "zustand fe",
      el("p", "kopfzeile", symbol("warnung"), "Das hat nicht geklappt."),
      el("p", "", text),
      nochmal,
    );
    box.setAttribute("role", "alert");
    zeigeIm(box);
    status.textContent = "";
  };

  const zeigeAbgemeldet = () => {
    raeume();
    // Der Hinweis mit dem Link steht schon im Dokument
    if (huelle) {
      hinweisHuelle.hidden = false;
      zustand.remove();
    } else {
      platzhalter.forEach((p) => p.replaceChildren(...original.get(p)));
    }
    status.textContent = "Melde dich an, um das zu sehen.";
  };

  const zeigeKeinZugriff = () => {
    const zurueck = el("a", "btn s", "Zurück zum Start");
    zurueck.href = "/";
    const box = el(
      "div",
      "zustand",
      el(
        "p",
        "kopfzeile",
        symbol("info"),
        huelle
          ? "Diese Seite ist für dein Konto nicht verfügbar."
          : "Dieser Bereich ist für andere Gruppen.",
      ),
      zurueck,
    );
    box.setAttribute("role", "status");
    if (huelle) {
      haupt.removeAttribute("data-huelle");
      spalte.replaceChildren(
        el("div", "seitenkopf", el("h1", "", "Seite nicht verfügbar")),
        box,
      );
      return;
    }
    zeigeIm(box);
    // Die übrigen Platzhalter fallen weg
    platzhalter.slice(1).forEach((p) => p.remove());
    status.textContent = "";
  };

  const zeige = (daten) => {
    raeume();
    const bausteine = Array.isArray(daten?.bausteine) ? daten.bausteine : [];
    const bauen = (b) => baueKnoten(document, b?.knoten);
    if (huelle) {
      const titel = el(
        "h1",
        "",
        typeof daten.titel === "string" ? daten.titel : "",
      );
      const teile = bausteine.map(bauen).filter((k) => k !== null);
      haupt.removeAttribute("data-huelle");
      spalte.replaceChildren(
        el("div", "seitenkopf", titel),
        el("div", "inhalt", ...teile),
      );
      const rest = document.title.split(" | ").slice(1).join(" | ");
      document.title = rest
        ? `${titel.textContent} | ${rest}`
        : titel.textContent;
      status.textContent = "Die Seite ist geladen.";
      return;
    }
    let gefunden = 0;
    for (const p of platzhalter) {
      const b = bausteine.find((x) => x?.id === p.dataset.geschuetzt);
      const k = b ? bauen(b) : null;
      if (k) {
        p.replaceWith(k);
        gefunden++;
      } else {
        // Der Baustein ist für diese Person nicht bestimmt oder ohne Inhalt
        p.remove();
      }
    }
    status.textContent = gefunden > 0 ? "Geschützte Inhalte sind geladen." : "";
  };

  async function lade() {
    zeigeLaden();
    abbruch = new AbortController();
    let antwort;
    try {
      antwort = await fetch(
        `/api/v1/website/inhalt?pfad=${encodeURIComponent(pfad)}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: abbruch.signal,
        },
      );
    } catch {
      zeigeFehler("Prüfe dein Internet und versuche es nochmals.");
      return;
    }
    if (antwort.status === 401) return zeigeAbgemeldet();
    if (antwort.status === 404 || antwort.status === 403) {
      return zeigeKeinZugriff();
    }
    if (!antwort.ok) {
      return zeigeFehler("Versuche es in ein paar Minuten nochmals.");
    }
    let daten;
    try {
      daten = await antwort.json();
    } catch {
      return zeigeFehler("Versuche es in ein paar Minuten nochmals.");
    }
    zeige(daten);
  }

  lade();
}
