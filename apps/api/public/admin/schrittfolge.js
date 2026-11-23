// Schrittfolge für mehrstufige Abläufe, senkrecht (Aufbau nach dem Muster «stepper-form», eigener Bau): Kopf mit Fortschritt, darunter eine Liste der Schritte.
// Jeder Schritt hat einen von vier Zuständen: offen, aktuell, erledigt (mit Zusammenfassung und «Ändern») oder fehler. Der aktuelle Schritt zeigt seinen Inhalt, alle anderen nur die Kopfzeile.
// Die Inhalte bleiben im Dokument (versteckt), damit Eingaben beim Zurückgehen erhalten bleiben. Der Verlauf des Browsers gehört dem Aufrufer: gehe() schreibt keinen Eintrag.
import { el, icon, neueId } from "./dom.js";

const ZUSTANDSTEXT = {
  offen: "noch offen",
  aktuell: "aktueller Schritt",
  erledigt: "erledigt",
  fehler: "Fehler",
};

// schritte: [{ id, titel, hinweis, zusammen(): Text der Zusammenfassung, aendern(): zurück zu diesem Schritt (fehlt: nicht änderbar), ende: Abschluss, zählt nicht im Fortschritt }]
export function schrittfolge({ titel, beschreibung, schritte }) {
  const zaehlbar = schritte.filter((s) => !s.ende);
  let aktuell = schritte[0].id;
  let fertig = false;
  const titelId = neueId("sf-titel");
  const fehler = new Map();

  const meta = el("p", { class: "sf-meta", role: "status" });
  const balken = el(
    "div",
    { class: "sf-balken", "aria-hidden": "true" },
    zaehlbar.map(() => el("span")),
  );
  const zeilen = schritte.map((s) => {
    const marker = el("span", { class: "sf-marker", "aria-hidden": "true" });
    const ueberschrift = el("h3", { class: "sf-titel", tabindex: "-1" });
    const hinweis = el("span", { class: "sf-hinweis" });
    const zusammen = el("p", { class: "sf-zusammen" });
    const marke = el(
      "span",
      { class: "chip chip--fehler" },
      icon("sperre"),
      "Fehler",
    );
    const aendern = el(
      "button",
      {
        type: "button",
        class: "knopf knopf--klein knopf--still",
        "aria-label": `${s.titel} ändern`,
        onclick: () => s.aendern?.(),
      },
      "Ändern",
    );
    const koerper = el("div", { class: "sf-koerper" });
    const wurzel = el(
      "li",
      { class: "sf-schritt" },
      marker,
      el(
        "div",
        { class: "sf-inhalt" },
        el("div", { class: "sf-kopf" }, ueberschrift, marke, hinweis, aendern),
        zusammen,
        koerper,
      ),
    );
    return {
      s,
      wurzel,
      marker,
      ueberschrift,
      hinweis,
      zusammen,
      marke,
      aendern,
      koerper,
    };
  });

  const zustandVon = (index) => {
    const nr = zeilen.findIndex((z) => z.s.id === aktuell);
    if (index === nr) return fehler.has(aktuell) ? "fehler" : "aktuell";
    return index < nr || fertig ? "erledigt" : "offen";
  };

  function zeichne() {
    const nr = zeilen.findIndex((z) => z.s.id === aktuell);
    zeilen.forEach((z, i) => {
      const zustand = zustandVon(i);
      const ende = Boolean(z.s.ende);
      // Nach dem Abschluss ist nichts mehr zu ändern
      const aenderbar =
        zustand === "erledigt" && !fertig && !ende && Boolean(z.s.aendern);
      const text = zustand === "erledigt" ? (z.s.zusammen?.() ?? "") : "";
      z.wurzel.dataset.zustand = zustand;
      if (zustand === "aktuell" || zustand === "fehler") {
        z.wurzel.setAttribute("aria-current", "step");
      } else {
        z.wurzel.removeAttribute("aria-current");
      }
      z.marker.replaceChildren(
        zustand === "erledigt"
          ? icon("haken")
          : zustand === "fehler"
            ? icon("warnung")
            : ende && zustand === "aktuell"
              ? icon("haken")
              : String(i + 1),
      );
      z.ueberschrift.replaceChildren(
        z.s.titel,
        el("span", { class: "nur-leser" }, `, ${ZUSTANDSTEXT[zustand]}`),
      );
      z.marke.hidden = zustand !== "fehler";
      z.hinweis.textContent = zustand === "offen" ? z.s.hinweis : "";
      z.hinweis.hidden = zustand !== "offen";
      z.zusammen.textContent = text;
      z.zusammen.hidden = text === "";
      z.aendern.hidden = !aenderbar;
      const zeigeKoerper = zustand === "aktuell" || zustand === "fehler";
      if (zeigeKoerper && z.koerper.hidden) z.koerper.classList.add("sf-ein");
      z.koerper.hidden = !zeigeKoerper;
    });
    balken.childNodes.forEach((segment, i) => {
      segment.className = zustandVon(i) === "erledigt" ? "ist-voll" : "";
    });
    const aktuellerZaehler = zaehlbar.findIndex((s) => s.id === aktuell);
    meta.textContent = fertig
      ? "Fertig"
      : aktuellerZaehler >= 0
        ? `Schritt ${aktuellerZaehler + 1} von ${zaehlbar.length}: ${schritte[nr].titel}`
        : "Fertig";
  }

  const wurzel = el(
    "section",
    { class: "sf", "aria-labelledby": titelId },
    el(
      "header",
      { class: "sf-kopfblock" },
      el("h2", { id: titelId }, titel),
      beschreibung && el("p", { class: "beschreibung" }, beschreibung),
      meta,
      balken,
    ),
    el(
      "ol",
      { class: "sf-liste", "aria-label": titel },
      zeilen.map((z) => z.wurzel),
    ),
  );
  zeichne();

  return {
    wurzel,
    // Inhalt eines Schritts (bleibt beim Wechsel erhalten)
    koerper: (id) => zeilen.find((z) => z.s.id === id).koerper,
    aktuell: () => aktuell,
    // Zustand «fehler» am Schritt; den Text der Meldung zeigt der Aufrufer selbst im Inhalt
    gehe(id, { fokus = true } = {}) {
      aktuell = id;
      zeichne();
      if (fokus) zeilen.find((z) => z.s.id === id).ueberschrift.focus();
    },
    markiereFehler(id, an) {
      if (an) fehler.set(id, true);
      else fehler.delete(id);
      zeichne();
    },
    // Alle Schritte vor dem Abschluss sind erledigt; der Abschluss ist aktuell
    schliesseAb(id) {
      fertig = true;
      fehler.clear();
      aktuell = id;
      zeichne();
      zeilen.find((z) => z.s.id === id).ueberschrift.focus();
    },
    zeichne,
  };
}
