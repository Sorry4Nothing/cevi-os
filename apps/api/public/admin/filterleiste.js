// Filterleiste (#578): Suchfeld, Auswahlfelder, die gesetzten Filter als Chips zum Entfernen, «Zurücksetzen» und eine laufende Trefferzahl («14 von 14 Personen»). Filtern tut der Aufrufer über die geladene Liste; die Leiste hält nur den Stand und meldet Änderungen.
import { auswahl, el, icon, knopf, neueId } from "./dom.js";

// Reine Funktion (testbar): «14 von 14 Personen»; bei einem Treffer die Einzahl, ohne Filter nur die Zahl
export function trefferText(treffer, gesamt, einzahl, mehrzahl) {
  const wort = (n) => (n === 1 ? einzahl : mehrzahl);
  if (treffer === gesamt) return `${gesamt} ${wort(gesamt)}`;
  return `${treffer} von ${gesamt} ${mehrzahl}`;
}

// Reine Funktion (testbar): Welche Filter sind gesetzt (ungleich ihrem Grundwert)? Liefert [{ schluessel, label, wertText }]
export function gesetzteFilter(filter, stand) {
  return filter
    .filter(
      (f) => (stand[f.schluessel] ?? f.grundwert ?? "") !== (f.grundwert ?? ""),
    )
    .map((f) => ({
      schluessel: f.schluessel,
      label: f.label,
      wertText: f.optionen.find(([w]) => w === stand[f.schluessel])?.[1] ?? "",
    }));
}

// suche: { label, wert? } oder weglassen
// filter: [{ schluessel, label, optionen: [[wert, text], …], grundwert? (Vorgabe: erster Wert), wert? }]
// beiAenderung({ suche, filter: { schluessel: wert } })
// namen: { einzahl, mehrzahl } für die Trefferzahl, z. B. { einzahl: "Person", mehrzahl: "Personen" }
export function filterleiste({ suche, filter = [], beiAenderung, namen }) {
  const stand = {};
  for (const f of filter) {
    f.grundwert ??= f.optionen[0]?.[0] ?? "";
    stand[f.schluessel] = f.wert ?? f.grundwert;
  }
  let begriff = suche?.wert ?? "";
  // Beim Zurücksetzen melden die Felder nicht einzeln, die Leiste meldet einmal
  let stumm = false;
  const meldeStand = () =>
    beiAenderung({ suche: begriff, filter: { ...stand } });

  const felder = [];
  let sucheEingabe = null;
  if (suche) {
    const id = neueId("filtersuche");
    sucheEingabe = el("input", {
      class: "eingabe",
      id,
      type: "search",
      placeholder: suche.label,
      autocomplete: "off",
      spellcheck: "false",
      oninput: () => {
        begriff = sucheEingabe.value;
        zeichneChips();
        meldeStand();
      },
    });
    sucheEingabe.value = begriff;
    felder.push(
      el(
        "div",
        { class: "suche filterleiste-suche" },
        el("label", { class: "nur-leser", for: id }, suche.label),
        icon("lupe"),
        sucheEingabe,
      ),
    );
  }
  const auswahlen = new Map();
  for (const f of filter) {
    const a = auswahl({
      label: f.label,
      optionen: f.optionen,
      wert: stand[f.schluessel],
    });
    a.eingabe.addEventListener("change", () => {
      if (stumm) return;
      stand[f.schluessel] = a.eingabe.value;
      zeichneChips();
      meldeStand();
    });
    auswahlen.set(f.schluessel, a);
    felder.push(el("div", { class: "filterleiste-feld" }, a.wurzel));
  }

  const chips = el("ul", {
    class: "filter-chips",
    "aria-label": "Gesetzte Filter",
  });
  const zuruecksetzen = knopf("Zurücksetzen", {
    klein: true,
    art: "still",
    symbol: "schliessen",
  });
  zuruecksetzen.addEventListener("click", () => setzeAlles());
  const treffer = el("p", {
    class: "filterleiste-treffer klein leise",
    role: "status",
  });

  function zeichneChips() {
    const gesetzt = gesetzteFilter(filter, stand);
    const mitSuche = begriff.trim() !== "";
    const eintraege = gesetzt.map((g) =>
      el(
        "li",
        {},
        el(
          "button",
          {
            type: "button",
            class: "filter-chip",
            "aria-label": `Filter entfernen: ${g.label} ${g.wertText}`,
            onclick: () => {
              const f = filter.find((x) => x.schluessel === g.schluessel);
              stand[g.schluessel] = f.grundwert;
              auswahlen.get(g.schluessel).eingabe.value = f.grundwert;
              auswahlen
                .get(g.schluessel)
                .eingabe.dispatchEvent(new Event("change"));
            },
          },
          el("span", {}, `${g.label}: ${g.wertText}`),
          icon("schliessen"),
        ),
      ),
    );
    if (mitSuche) {
      eintraege.unshift(
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "filter-chip",
              "aria-label": `Suche entfernen: ${begriff}`,
              onclick: () => {
                sucheEingabe.value = "";
                begriff = "";
                zeichneChips();
                meldeStand();
                sucheEingabe.focus();
              },
            },
            el("span", {}, `Suche: ${begriff}`),
            icon("schliessen"),
          ),
        ),
      );
    }
    chips.replaceChildren(...eintraege);
    chips.hidden = eintraege.length === 0;
    zuruecksetzen.hidden = eintraege.length === 0;
  }

  function setzeAlles() {
    stumm = true;
    for (const f of filter) {
      stand[f.schluessel] = f.grundwert;
      const a = auswahlen.get(f.schluessel);
      a.eingabe.value = f.grundwert;
      // Das Auswahlfeld zeigt die Wahl erst nach «change»
      a.eingabe.dispatchEvent(new Event("change"));
    }
    stumm = false;
    begriff = "";
    if (sucheEingabe) sucheEingabe.value = "";
    zeichneChips();
    meldeStand();
  }

  zeichneChips();
  return {
    wurzel: el(
      "div",
      { class: "filterleiste" },
      el("div", { class: "filterleiste-zeile" }, ...felder),
      el("div", { class: "filterleiste-gesetzt" }, chips, zuruecksetzen),
      treffer,
    ),
    // Der Aufrufer meldet die Zahlen nach dem Filtern
    setzeTreffer(zahl, gesamt) {
      treffer.textContent = trefferText(
        zahl,
        gesamt,
        namen?.einzahl ?? "Eintrag",
        namen?.mehrzahl ?? "Einträge",
      );
    },
    stand: () => ({ suche: begriff, filter: { ...stand } }),
    setzeAlles,
  };
}
