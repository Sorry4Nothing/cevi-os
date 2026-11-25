import type { Feld, FormularBaustein } from "./bausteine-formular.js";
import {
  STANDARD_BEREICH_LAENGE,
  STANDARD_TEXT_LAENGE,
} from "./bausteine-formular.js";
import { el, symbol, type HtmlKnoten } from "./rendern.js";

// Renderer des Bausteins «formular» (#819). Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert. Die Seite ist statisch und für alle gleich; das Skript (public/website/formular.js) prüft und sendet die Antwort als JSON an POST /api/v1/formulare/<Baustein>/antworten.
// Die Felder tragen ihre Grenzen als Attribute (maxlength, min, max, data-*), damit das Skript nichts nachladen muss; geprüft wird trotzdem nie dort allein: Der Server prüft jede Antwort gegen die veröffentlichte Definition.
// Das Formular sendet nichts selbst (form-action 'none' in der CSP): Ohne Skript fehlt nur das Senden, die Seite zeigt dann den Hinweis. Stil: public/website/formular.css.
// Dieselben Knoten gehen als JSON an geschuetzt.js, wenn der Baustein nur für Angemeldete ist; knoten.js kennt dafür die Elemente und Attribute dieser Datei.

export const STIL_FORMULAR = "/website/formular.css";
export const SKRIPT_FORMULAR = "/website/formular.js";

export type FormularStand = { ebene: number; schalter: number };

const klein = (id: string) => id.toLowerCase();

// «(optional)» hinter der Beschriftung, bei Pflichtfeldern nichts (Handbuch 0.7)
const beschriftung = (f: Feld): HtmlKnoten[] => [
  f.beschriftung,
  ...(f.pflicht
    ? []
    : [el("span", { class: "bf-optional" }, " (optional)")]),
];

function hilfe(id: string, f: Feld): HtmlKnoten[] {
  return f.hilfe ? [el("p", { class: "hilfe", id: `${id}-h` }, f.hilfe)] : [];
}
const beschreibt = (id: string, f: Feld): Record<string, string> =>
  f.hilfe ? { "aria-describedby": `${id}-h` } : {};

// Auswahl aus Optionen als Gruppe mit Legende (Optionsfelder, Mehrfachwahl, Ja oder Nein)
function gruppe(
  id: string,
  f: Feld,
  art: "radio" | "checkbox",
  optionen: readonly [string, string][],
  extra: Record<string, string> = {},
): HtmlKnoten {
  return el(
    "fieldset",
    {
      class: "feld bf-gruppe",
      "data-typ": f.typ,
      ...(f.pflicht && { "data-pflicht": "1" }),
      ...extra,
      ...beschreibt(id, f),
    },
    el("legend", { class: "bf-legende" }, ...beschriftung(f)),
    ...hilfe(id, f),
    el(
      "div",
      { class: "bf-optionen" },
      ...optionen.map(([wert, text], i) =>
        el(
          "div",
          { class: "bf-option" },
          el("input", {
            type: art,
            id: `${id}-${i}`,
            name: klein(f.id),
            value: wert,
          }),
          el("label", { for: `${id}-${i}` }, text),
        ),
      ),
    ),
  );
}

function feldKnoten(bausteinId: string, f: Feld): HtmlKnoten {
  const id = `f-${klein(bausteinId)}-${klein(f.id).slice(0, 8)}`;
  const name = klein(f.id);
  const gemeinsam: Record<string, string | true> = {
    id,
    name,
    class: "eingabe",
    "data-typ": f.typ,
    ...(f.pflicht && { required: true as const }),
    ...beschreibt(id, f),
  };
  const feld = (...innen: HtmlKnoten[]) =>
    el(
      "div",
      { class: "feld" },
      el("label", { for: id }, ...beschriftung(f)),
      ...hilfe(id, f),
      ...innen,
    );
  switch (f.typ) {
    case "text":
      return feld(
        el("input", {
          ...gemeinsam,
          type: "text",
          autocomplete: "off",
          maxlength: String(f.maxLaenge ?? STANDARD_TEXT_LAENGE),
          ...(f.minLaenge && { minlength: String(f.minLaenge) }),
        }),
      );
    case "textbereich":
      return feld(
        el(
          "textarea",
          {
            ...gemeinsam,
            rows: "5",
            maxlength: String(f.maxLaenge ?? STANDARD_BEREICH_LAENGE),
            ...(f.minLaenge && { minlength: String(f.minLaenge) }),
          },
        ),
      );
    case "zahl":
      return feld(
        el("input", {
          ...gemeinsam,
          type: "text",
          inputmode: f.ganzzahl ? "numeric" : "decimal",
          autocomplete: "off",
          ...(f.ganzzahl && { "data-ganz": "1" }),
          ...(f.min !== undefined && { "data-min": String(f.min) }),
          ...(f.max !== undefined && { "data-max": String(f.max) }),
        }),
      );
    case "datum":
      return feld(
        el("input", {
          ...gemeinsam,
          type: "date",
          ...(f.von && { min: f.von }),
          ...(f.bis && { max: f.bis }),
        }),
      );
    case "email":
      return feld(
        el("input", {
          ...gemeinsam,
          type: "email",
          inputmode: "email",
          autocomplete: "email",
          maxlength: "254",
          spellcheck: "false",
        }),
      );
    case "telefon":
      return feld(
        el("input", {
          ...gemeinsam,
          type: "tel",
          inputmode: "tel",
          autocomplete: "tel",
          maxlength: "30",
        }),
      );
    case "auswahl":
      return feld(
        el(
          "select",
          { ...gemeinsam, class: "eingabe bf-auswahl" },
          el("option", { value: "" }, "Bitte wählen"),
          ...f.optionen.map((o) => el("option", { value: o }, o)),
        ),
      );
    case "optionsfelder":
      return gruppe(
        id,
        f,
        "radio",
        f.optionen.map((o) => [o, o]),
      );
    case "mehrfachwahl":
      return gruppe(
        id,
        f,
        "checkbox",
        f.optionen.map((o) => [o, o]),
        {
          ...(f.minAuswahl && { "data-min": String(f.minAuswahl) }),
          ...(f.maxAuswahl && { "data-max": String(f.maxAuswahl) }),
        },
      );
    case "janein":
      return gruppe(id, f, "radio", [
        ["ja", "Ja"],
        ["nein", "Nein"],
      ]);
    case "zustimmung":
      return el(
        "div",
        { class: "feld bf-zustimmung" },
        el(
          "div",
          { class: "bf-option" },
          el("input", {
            type: "checkbox",
            id,
            name,
            required: true,
            "data-typ": "zustimmung",
            ...beschreibt(id, f),
          }),
          el("label", { for: id }, f.beschriftung),
        ),
        ...hilfe(id, f),
      );
  }
}

// Die Falle für Skripte, die jedes Feld ausfüllen: Menschen sehen sie nie (formular.css), Hilfen lesen sie nicht vor
function falle(id: string): HtmlKnoten {
  return el(
    "div",
    { class: "bf-fall", "aria-hidden": "true" },
    el("label", { for: `${id}-fall` }, "Bitte leer lassen"),
    el("input", {
      type: "text",
      id: `${id}-fall`,
      name: "homepage",
      tabindex: "-1",
      autocomplete: "off",
    }),
  );
}

export function rendereFormular(
  b: FormularBaustein,
  stand: FormularStand,
): HtmlKnoten {
  const d = b.daten;
  const bid = klein(b.id);
  const id = `bf-${bid}`;
  const titel = d.titel
    ? (() => {
        const ebene = Math.min(3, stand.ebene + 1);
        stand.ebene = ebene;
        return el(`h${ebene}`, { id: `${id}-t` }, d.titel);
      })()
    : null;
  const knopf = `btn ${stand.schalter++ === 0 ? "p" : "s"} gross`;
  return el(
    "section",
    {
      class: "bformular",
      "data-formular": bid,
      ...(d.schliesstAm && { "data-schliesst": d.schliesstAm }),
      ...(titel ? { "aria-labelledby": `${id}-t` } : { "aria-label": "Formular" }),
    },
    ...(titel ? [titel] : []),
    ...(d.einleitung ? [el("p", { class: "bf-einleitung" }, d.einleitung)] : []),
    el(
      "noscript",
      undefined,
      el(
        "div",
        { class: "band wa" },
        symbol("warnung"),
        el(
          "div",
          { class: "text" },
          el(
            "strong",
            undefined,
            "Zum Ausfüllen braucht diese Seite JavaScript.",
          ),
          "Schalte es im Browser ein und lade die Seite neu.",
        ),
      ),
    ),
    // Hier steht die Fehlerzusammenfassung (Fokus beim Absenden) und der Hinweis «geschlossen»
    el("div", { class: "bf-meldung", id: `${id}-m` }),
    el(
      "form",
      { class: "bf-form", method: "post", action: "#", novalidate: true },
      ...d.felder.map((f) => feldKnoten(b.id, f)),
      falle(id),
      el(
        "div",
        { class: "bf-datenschutz" },
        el(
          "p",
          undefined,
          el("strong", undefined, "Datenschutz. "),
          d.datenschutz,
        ),
        el(
          "p",
          undefined,
          `Wir löschen die Antworten nach ${d.aufbewahrenTage} Tagen. Wer angemeldet ist, sendet die Antwort mit dem eigenen Namen.`,
        ),
      ),
      el("button", { type: "submit", class: knopf }, d.absenden),
    ),
    // Das Skript setzt Text und Fokus hierher, wenn die Antwort gesendet ist
    el("div", {
      class: "bf-danke",
      role: "status",
      id: `${id}-d`,
      "data-danke": d.danke,
    }),
  );
}

