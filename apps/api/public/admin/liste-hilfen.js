import { el, icon, knopf } from "./dom.js";

// Gemeinsame Bausteine der Listen unter «Personen» (Gruppen und Tags, Personen): sortierbare Spaltenköpfe, Blättern mit Zeilenzahl, Fehler beim Feld

// Spaltenköpfe, die sortieren: Knopf mit Name und, wenn aktiv, dem Sortierwort («aufsteigend»); aria-sort steht am th.
// spalten: [{ index, schluessel, name }]; zustand: { schluessel, richtung: "auf" | "ab" }; beiAenderung läuft nach dem Umschalten
export function macheSortierbar(wurzel, spalten, zustand, beiAenderung) {
  const zellen = wurzel.querySelectorAll("thead th");
  const zeichne = () => {
    for (const { index, schluessel, name } of spalten) {
      const th = zellen[index];
      const aktiv = zustand.schluessel === schluessel;
      const auf = zustand.richtung === "auf";
      th.setAttribute(
        "aria-sort",
        aktiv ? (auf ? "ascending" : "descending") : "none",
      );
      th.replaceChildren(
        el(
          "button",
          {
            type: "button",
            class: "pe-sortieren",
            onclick: () => {
              if (zustand.schluessel === schluessel) {
                zustand.richtung = auf ? "ab" : "auf";
              } else {
                zustand.schluessel = schluessel;
                zustand.richtung = "auf";
              }
              zeichne();
              th.querySelector("button").focus();
              beiAenderung();
            },
          },
          name,
          aktiv &&
            el(
              "span",
              { class: "pe-sortwort" },
              icon(auf ? "hoch" : "runter"),
              auf ? "aufsteigend" : "absteigend",
            ),
        ),
      );
    }
  };
  zeichne();
}

// Vergleicht Texte nach Schweizer Regeln, Zahlen als Zahlen
export const vergleiche = (a, b) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "de-CH", { sensitivity: "base" });

export const sortiere = (liste, zustand, schluesselVon) => {
  const vorzeichen = zustand.richtung === "auf" ? 1 : -1;
  return [...liste].sort(
    (a, b) =>
      vorzeichen *
        vergleiche(
          schluesselVon(a, zustand.schluessel),
          schluesselVon(b, zustand.schluessel),
        ) || vergleiche(schluesselVon(a, "name"), schluesselVon(b, "name")),
  );
};

export const GROESSEN = [25, 50, 100];

// Blättern in einer schon gefilterten Liste (A3 «Viele Einträge»): links «Einträge 26 bis 50 von 92», in der Mitte Zurück und Weiter, rechts «Zeilen pro Seite». Bei höchstens der kleinsten Seitengrösse bleibt sie unsichtbar.
// fenster(anzahl) gibt [von, bis) für slice() zurück; beiWechsel zeichnet danach neu
export function seitenleiste({ beiWechsel }) {
  let seite = 1;
  let seiten = 1;
  let groesse = GROESSEN[0];
  const bereich = el("p", { class: "klein leise", role: "status" });
  const stand = el("span", { class: "pe-seite" });
  const gehe = (n, fokus) => {
    seite = n;
    beiWechsel();
    // Der Knopf, der eben geklickt wurde, ist auf der ersten oder letzten Seite gesperrt und verliert sonst den Fokus
    if (fokus.disabled) (fokus === zurueck ? weiter : zurueck).focus();
  };
  const zurueck = knopf("Zurück", {
    klein: true,
    onclick: () => gehe(seite - 1, zurueck),
  });
  const weiter = knopf("Weiter", {
    klein: true,
    onclick: () => gehe(seite + 1, weiter),
  });
  const auswahlId = `zeilen-${Math.random().toString(36).slice(2, 8)}`;
  const zeilen = el(
    "select",
    {
      class: "eingabe pe-zeilen",
      id: auswahlId,
      onchange: () => {
        groesse = Number(zeilen.value);
        seite = 1;
        beiWechsel();
      },
    },
    GROESSEN.map((n) => el("option", { value: String(n) }, String(n))),
  );
  zeilen.value = String(groesse);
  const wurzel = el(
    "nav",
    { class: "seitenwahl pe-seitenleiste", "aria-label": "Seiten der Tabelle" },
    bereich,
    el("div", { class: "pe-seitenknoepfe" }, zurueck, stand, weiter),
    el(
      "div",
      { class: "pe-zeilenwahl" },
      el("label", { for: auswahlId, class: "klein" }, "Zeilen pro Seite"),
      zeilen,
    ),
  );
  return {
    wurzel,
    fenster(anzahl) {
      seiten = Math.max(1, Math.ceil(anzahl / groesse));
      seite = Math.min(seite, seiten);
      wurzel.hidden = anzahl <= GROESSEN[0];
      const von = (seite - 1) * groesse;
      const bis = Math.min(anzahl, seite * groesse);
      bereich.textContent = `Einträge ${Math.min(von + 1, anzahl)} bis ${bis} von ${anzahl}`;
      stand.textContent = `Seite ${seite} von ${seiten}`;
      zurueck.disabled = seite === 1;
      weiter.disabled = seite === seiten;
      return [von, bis];
    },
    // Nach Suche oder Filter beginnt die Liste wieder vorn
    anfang() {
      seite = 1;
    },
    // Springt auf die Seite, auf der die Zeile mit diesem Index steht
    zu(index) {
      seite = Math.floor(index / groesse) + 1;
    },
  };
}

// Fehler beim Feld (A4, A7): Meldung mit Symbol unter dem Feld, aria-invalid und Verweis per aria-describedby; nie nur Farbe
// f: { wurzel, eingabe, fokus? }; fokus ist das sichtbare Bedienelement, wenn es nicht die Eingabe selbst ist (eigene Auswahl)
const ziel = (f) => f.fokus ?? f.eingabe;

export function feldFehler(f, text) {
  const z = ziel(f);
  z.dataset.hilfe ??= z.getAttribute("aria-describedby") ?? "";
  entferneFehler(f);
  const meldung = el(
    "p",
    { class: "pe-fehlertext", id: `${z.id}-fehler` },
    icon("warnung"),
    text,
  );
  f.wurzel.classList.add("pe-feld-fehler");
  f.wurzel.append(meldung);
  z.setAttribute("aria-invalid", "true");
  z.setAttribute(
    "aria-describedby",
    [z.dataset.hilfe, meldung.id].filter(Boolean).join(" "),
  );
  f.eingabe.addEventListener("input", () => entferneFehler(f), { once: true });
  f.eingabe.addEventListener("change", () => entferneFehler(f), { once: true });
}

export function entferneFehler(f) {
  const z = ziel(f);
  f.wurzel.querySelector(".pe-fehlertext")?.remove();
  f.wurzel.classList.remove("pe-feld-fehler");
  z.removeAttribute("aria-invalid");
  if (z.dataset.hilfe) z.setAttribute("aria-describedby", z.dataset.hilfe);
  else z.removeAttribute("aria-describedby");
}

// Zusammenfassung über dem Formular: «2 Angaben prüfen» mit einem Knopf je Feld, der es fokussiert (kein Link, denn ein Hash würde die Seite wechseln)
// fehler: [{ name, eingabe }]; liefert den Knoten (Alert, Fokus mit focus())
export function pruefHinweis(fehler) {
  const n = fehler.length;
  return el(
    "div",
    {
      class: "hinweis hinweis--fehler pe-pruefhinweis",
      role: "alert",
      tabindex: "-1",
    },
    el(
      "span",
      {},
      el("strong", {}, n === 1 ? "1 Angabe prüfen" : `${n} Angaben prüfen`),
      el("br"),
      fehler.flatMap((f, i) => [
        i > 0 && " · ",
        el(
          "button",
          {
            type: "button",
            class: "pe-link",
            onclick: () => ziel(f).focus(),
          },
          f.name,
        ),
      ]),
    ),
  );
}

// Die Spalte «Aktionen» hat im Design keine sichtbare Überschrift; Screenreader hören sie weiter
export function aktionenKopfVerstecken(wurzel) {
  for (const th of wurzel.querySelectorAll("thead th.rechts")) {
    th.replaceChildren(el("span", { class: "nur-leser" }, th.textContent));
  }
}

// Knopf mit Symbol ohne Text (44 px): der Name steht im aria-label, «Löschen: Wölfe»
export function rundKnopf(symbol, name, onclick) {
  return el(
    "button",
    { type: "button", class: "knopf knopf--rund", "aria-label": name, onclick },
    icon(symbol),
  );
}

// Laden mit eigenem Titel für den Fehlerfall: Die Zustandskarte nennt dann, was fehlt («Die Gruppen konnten nicht geladen werden.»); Verbindung, Sitzung, Rechte und 404 behalten ihre eigenen Texte
export const mitFehlertitel = (titel, laden) => async () => {
  try {
    return await laden();
  } catch (f) {
    if (f && typeof f === "object") f.zustandTitel = titel;
    throw f;
  }
};
