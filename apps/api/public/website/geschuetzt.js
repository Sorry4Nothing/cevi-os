// Füllt die Platzhalter «data-geschuetzt» einer Seite, wenn eine Sitzung besteht (#354), und ersetzt die Hülle einer ganz geschützten Seite durch ihren Inhalt.
// Der Server liefert nur Knoten als JSON (GET /api/v1/website/inhalt); sie werden mit knoten.js zu DOM-Knoten, nie über innerHTML. Das Dokument im HTML bleibt unverändert, die Sitzung liegt nur im Cookie.
import { baueKnoten } from "./knoten.js";

const haupt = document.getElementById("inhalt");
const pfad = haupt?.dataset.pfad;
const huelle = haupt?.hasAttribute("data-huelle") ?? false;

if (haupt && pfad) start();

function el(tag, klasse, ...kinder) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  e.append(...kinder);
  return e;
}

function start() {
  // Eine Live-Region für das Ergebnis, die schon im Dokument steht, bevor sich ihr Text ändert
  const status = el("p", "nur-sr");
  status.setAttribute("role", "status");
  document.body.append(status);

  const platzhalter = huelle
    ? []
    : [...haupt.querySelectorAll("[data-geschuetzt]")];
  // In der Hülle zeigt ein eigener Behälter unter dem Hinweis die Zustände
  const zustand = huelle ? haupt.appendChild(el("div")) : null;
  const behaelter = huelle ? [zustand] : platzhalter;

  const anmelden = `/anmelden?weiter=${encodeURIComponent(pfad)}`;

  // Der Hinweis steht im ersten Behälter, die übrigen bleiben leer: Er erscheint einmal, nicht je Baustein
  const zeigeHinweis = (kinder, art) => {
    behaelter.forEach((b) => {
      b.replaceChildren();
      b.removeAttribute("aria-busy");
    });
    if (behaelter.length === 0) return;
    const hinweis = el("div", `hinweis${art ? ` hinweis--${art}` : ""}`);
    hinweis.append(...kinder);
    behaelter[0].append(hinweis);
  };

  const zeigeLaden = () => {
    behaelter.forEach((b) => {
      b.setAttribute("aria-busy", "true");
      const skelett = el("div", "skeleton", el("span"), el("span"), el("span"));
      skelett.setAttribute("aria-hidden", "true");
      b.replaceChildren(skelett);
    });
    status.textContent = "Geschützte Inhalte werden geladen.";
  };

  const zeigeFehler = (text) => {
    const nochmal = el("button", "knopf knopf--still", "Nochmals versuchen");
    nochmal.type = "button";
    nochmal.addEventListener("click", lade);
    zeigeHinweis(
      [el("p", "", el("strong", "", "Fehler: "), text), el("p", "", nochmal)],
      "fehler",
    );
    status.textContent = text;
  };

  const zeigeAbgemeldet = () => {
    // In der Hülle steht der Hinweis mit dem Link schon im Dokument
    if (huelle) {
      zustand.remove();
      status.textContent = "";
      return;
    }
    const link = el("a", "", "Anmelden");
    link.href = anmelden;
    zeigeHinweis([
      el("p", "", "Melde dich an, um das zu sehen. "),
      el("p", "", link),
    ]);
    status.textContent = "Melde dich an, um das zu sehen.";
  };

  const zeigeKeinZugriff = () => {
    if (huelle) {
      haupt.removeAttribute("data-huelle");
      haupt.replaceChildren(
        el("h1", "", "Seite nicht verfügbar"),
        el("p", "", "Diese Seite ist für dein Konto nicht verfügbar."),
      );
      status.textContent = "Diese Seite ist für dein Konto nicht verfügbar.";
      return;
    }
    // Eine Seite, die die Person nicht sehen darf, gibt es für sie nicht: Die leeren Platzhalter verschwinden
    platzhalter.forEach((p) => p.remove());
    status.textContent = "";
  };

  const zeige = (daten) => {
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
      haupt.replaceChildren(titel, ...teile);
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
    let antwort;
    try {
      antwort = await fetch(
        `/api/v1/website/inhalt?pfad=${encodeURIComponent(pfad)}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );
    } catch {
      zeigeFehler(
        navigator.onLine === false
          ? "Du bist offline. Prüfe die Verbindung."
          : "Die Verbindung hat nicht geklappt.",
      );
      return;
    }
    if (antwort.status === 401) return zeigeAbgemeldet();
    if (antwort.status === 404 || antwort.status === 403) {
      return zeigeKeinZugriff();
    }
    if (!antwort.ok) return zeigeFehler("Das hat nicht geklappt.");
    let daten;
    try {
      daten = await antwort.json();
    } catch {
      return zeigeFehler("Das hat nicht geklappt.");
    }
    zeige(daten);
  }

  lade();
}
