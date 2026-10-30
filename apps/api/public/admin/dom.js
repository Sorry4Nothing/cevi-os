// Bausteine für die Oberfläche. Daten gelangen nur als Text (createTextNode, textContent) in die Seite, nie als HTML.

import { fehlertext as standardFehlertext } from "./api.js";

let zaehler = 0;
export const neueId = (vorsatz) => `${vorsatz}-${++zaehler}`;

// el("button", { class: "knopf", onclick: fn }, "Text", kind)
export function el(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    if (wert === undefined || wert === null || wert === false) continue;
    if (name.startsWith("on")) knoten.addEventListener(name.slice(2), wert);
    else if (wert === true) knoten.setAttribute(name, "");
    else knoten.setAttribute(name, String(wert));
  }
  for (const kind of kinder.flat()) {
    if (kind === undefined || kind === null || kind === false) continue;
    knoten.append(kind instanceof Node ? kind : document.createTextNode(kind));
  }
  return knoten;
}

export function leere(knoten) {
  knoten.replaceChildren();
}

const datum = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});
const nurTag = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" });
export function tag(iso) {
  const wert = new Date(iso);
  return Number.isNaN(wert.getTime()) ? "" : nurTag.format(wert);
}

export function zeit(iso) {
  const wert = new Date(iso);
  return Number.isNaN(wert.getTime()) ? "" : datum.format(wert);
}

export function chip(text, art) {
  return el("li", { class: art ? `chip chip--${art}` : "chip" }, text);
}

// Tabelle mit versteckter Beschriftung und Spaltenköpfen; der Rahmen scrollt auf schmalen Bildschirmen waagrecht und ist dafür mit der Tastatur erreichbar
// spalten: ["Name", …]; die letzte heisst «Aktionen» und steht rechts; ["Anzahl", "zahl"] richtet eine Zahlenspalte rechts aus
export function tabelle({ beschriftung, spalten, zeilen }) {
  const koerper = el("tbody", {}, zeilen);
  const wurzel = el(
    "div",
    {
      class: "tabellenrahmen",
      role: "region",
      "aria-label": beschriftung,
      tabindex: "0",
    },
    el(
      "table",
      { class: "tabelle" },
      el("caption", { class: "nur-leser" }, beschriftung),
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          spalten.map((spalte) => {
            const [name, klasse] = Array.isArray(spalte)
              ? spalte
              : [spalte, spalte === "Aktionen" ? "rechts" : undefined];
            return el("th", { scope: "col", class: klasse }, name);
          }),
        ),
      ),
      koerper,
    ),
  );
  return { wurzel, koerper };
}

// Zelle mit den Knöpfen einer Zeile; leere Einträge (false) fallen weg
export function aktionenZelle(...knoepfe) {
  return el(
    "td",
    { class: "rechts" },
    el("div", { class: "aktionen" }, knoepfe),
  );
}

// Weitere Aktionen einer Zeile hinter einem Knopf «Mehr»; ohne Einträge entfällt er
// eintraege: [{ text, onclick, gefaehrlich }, …] oder false
export function menue(kontext, eintraege) {
  const liste = eintraege.filter(Boolean);
  if (liste.length === 0) return false;
  return el(
    "details",
    { class: "menue" },
    el(
      "summary",
      { class: "knopf knopf--klein", "aria-label": `Mehr: ${kontext}` },
      "Mehr",
    ),
    el(
      "div",
      { class: "menue-liste" },
      liste.map((e) =>
        el(
          "button",
          {
            type: "button",
            class: e.gefaehrlich
              ? "menue-eintrag menue-eintrag--gefahr"
              : "menue-eintrag",
            "aria-label": `${e.text}: ${kontext}`,
            onclick: e.onclick,
          },
          e.text,
        ),
      ),
    ),
  );
}

// Offene Menüs schliessen: Klick daneben oder auf einen Eintrag, Escape (Fokus zurück auf «Mehr»), Fokus verlässt das Menü
document.addEventListener("click", (ereignis) => {
  for (const m of document.querySelectorAll("details.menue[open]")) {
    if (
      !m.contains(ereignis.target) ||
      ereignis.target.closest(".menue-eintrag")
    )
      m.open = false;
  }
});
document.addEventListener("keydown", (ereignis) => {
  if (ereignis.key !== "Escape") return;
  const offen = document.querySelector("details.menue[open]");
  if (!offen) return;
  offen.open = false;
  offen.querySelector("summary").focus();
});
document.addEventListener("focusout", (ereignis) => {
  const m = ereignis.target.closest?.("details.menue[open]");
  if (m && ereignis.relatedTarget && !m.contains(ereignis.relatedTarget)) {
    m.open = false;
  }
});

// Wer den Dialog öffnete: bei einem Menü-Eintrag der Knopf «Mehr», denn das Menü schliesst sich danach
function ausloeser() {
  const aktiv = document.activeElement;
  return aktiv?.closest?.("details.menue")?.querySelector("summary") ?? aktiv;
}

// Der Name beginnt mit dem sichtbaren Text, damit Sprachsteuerung ihn trifft; der Zusatz sagt, für wen
export function knopf(text, { art, klein, kontext, ...rest } = {}) {
  return el(
    "button",
    {
      type: "button",
      class: ["knopf", art && `knopf--${art}`, klein && "knopf--klein"]
        .filter(Boolean)
        .join(" "),
      "aria-label": kontext ? `${text}: ${kontext}` : undefined,
      ...rest,
    },
    text,
  );
}

// Beschriftetes Feld; bleibt sichtbar, auch beim Tippen
export function feld({
  label,
  typ = "text",
  wert = "",
  hilfe,
  mehrzeilig,
  ...rest
}) {
  const id = neueId("feld");
  const hilfeId = hilfe ? `${id}-hilfe` : undefined;
  const eingabe = el(mehrzeilig ? "textarea" : "input", {
    id,
    type: mehrzeilig ? undefined : typ,
    "aria-describedby": hilfeId,
    ...rest,
  });
  eingabe.value = wert;
  const wurzel = el(
    "div",
    { class: "feld" },
    el("label", { for: id }, label),
    eingabe,
    hilfe && el("p", { class: "hilfe", id: hilfeId }, hilfe),
  );
  return { wurzel, eingabe };
}

// optionen: [[wert, beschriftung], …]
export function auswahl({ label, optionen, wert, ...rest }) {
  const id = neueId("auswahl");
  const feldSelect = el(
    "select",
    { id, ...rest },
    optionen.map(([w, text]) => el("option", { value: w }, text)),
  );
  feldSelect.value = wert;
  return {
    wurzel: el(
      "div",
      { class: "feld" },
      el("label", { for: id }, label),
      feldSelect,
    ),
    eingabe: feldSelect,
  };
}

export function ankreuzen({ label, gewaehlt = false, wert }) {
  const id = neueId("wahl");
  const eingabe = el("input", { id, type: "checkbox", value: wert });
  eingabe.checked = gewaehlt;
  return {
    wurzel: el(
      "div",
      { class: "wahl" },
      eingabe,
      el("label", { for: id }, label),
    ),
    eingabe,
  };
}

export function gruppe(legende, inhalt, { scrollen = false } = {}) {
  return el(
    "fieldset",
    { class: scrollen ? "scrollfeld" : undefined },
    el("legend", {}, legende),
    inhalt,
  );
}

// Liefert den Dialog-Inhalt in der Reihenfolge: Titel, Beschreibung, Felder, Fehler, Knöpfe
// senden() darf werfen; die Meldung erscheint im Dialog, er bleibt offen
export function dialogFormular({
  titel,
  beschreibung,
  felder = [],
  ok,
  gefaehrlich = false,
  senden,
  danach,
  fehlertext = standardFehlertext,
}) {
  const zurueck = ausloeser();
  const titelId = neueId("titel");
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const abbrechen = knopf("Abbrechen", { onclick: () => dialog.close() });
  const bestaetigen = el(
    "button",
    {
      type: "submit",
      class: gefaehrlich ? "knopf knopf--gefahr" : "knopf knopf--haupt",
    },
    ok,
  );
  const formular = el(
    "form",
    { class: "formular", novalidate: true },
    ...felder,
    fehler,
    el("div", { class: "dialog-knoepfe" }, abbrechen, bestaetigen),
  );
  const ueberschrift = el("h2", { id: titelId, tabindex: "-1" }, titel);
  const dialog = el(
    "dialog",
    { "aria-labelledby": titelId },
    ueberschrift,
    beschreibung && el("p", { class: "beschreibung" }, beschreibung),
    formular,
  );
  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.hidden = true;
    abbrechen.disabled = bestaetigen.disabled = true;
    try {
      const ergebnis = await senden();
      dialog.close();
      danach?.(ergebnis);
    } catch (f) {
      fehler.textContent = fehlertext(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      abbrechen.disabled = bestaetigen.disabled = false;
    }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // Folgt gleich ein weiterer Dialog (Startpasswort), gehört ihm der Fokus
    if (document.querySelector("dialog[open]")) return;
    // Zurück zum Auslöser; ist er nach dem Neuladen weg, bleibt der Fokus beim Titel der Seite
    if (zurueck?.isConnected) zurueck.focus();
    else document.querySelector("h1")?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  // Zerstörende Dialoge starten bei «Abbrechen», die anderen im ersten Feld
  const erstes = dialog.querySelector("input, select, textarea");
  (gefaehrlich || !erstes ? abbrechen : erstes).focus();
  return dialog;
}

// Rückfrage vor einer folgenreichen Aktion; aktion() wirft bei Fehlern, danach() läuft nach dem Schliessen
export function bestaetigen({
  titel,
  beschreibung,
  ok,
  aktion,
  danach,
  gefaehrlich = true,
}) {
  return dialogFormular({
    titel,
    beschreibung,
    ok,
    gefaehrlich,
    senden: aktion,
    danach,
  });
}

// Zeigt ein Geheimnis (Startpasswort) genau einmal; beim Schliessen wird der Text aus der Seite gelöscht
export function geheimnisDialog({ titel, beschreibung, wert }) {
  const zurueck = ausloeser();
  const titelId = neueId("titel");
  // Ein Absatz statt <output>: Das hätte die Rolle «status» und sagte das Passwort ungefragt an
  const anzeige = el("p", { class: "geheimnis" }, wert);
  const rueck = el("p", { class: "hilfe", role: "status" });
  const kopieren = knopf("Kopieren", {
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(wert);
        rueck.textContent = "Kopiert.";
      } catch {
        rueck.textContent =
          "Kopieren ist nicht möglich. Markiere das Passwort von Hand.";
      }
    },
  });
  const schliessen = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--haupt",
      onclick: () => dialog.close(),
    },
    "Schliessen",
  );
  const dialog = el(
    "dialog",
    { "aria-labelledby": titelId },
    el("h2", { id: titelId, tabindex: "-1" }, titel),
    el("p", { class: "beschreibung" }, beschreibung),
    anzeige,
    rueck,
    el("div", { class: "dialog-knoepfe" }, kopieren, schliessen),
  );
  dialog.addEventListener("close", () => {
    anzeige.textContent = "";
    dialog.remove();
    if (zurueck?.isConnected) zurueck.focus();
    else document.querySelector("h1")?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  kopieren.focus();
}
