import { avatar, el, icon, knopf, seitenblatt } from "./dom.js";

// Verlauf des Protokolls (#637): Einträge als Zeitleiste mit Benutzerstempel, Detail im Fluss. Aufbau und Zustände nach den Vorlagen «Activity Feed» (gleich hohe Zeilen, Avatar mit Art-Marke, Zeit zählt relativ) und «Event Timeline» (Tageskopf, durchgehende Spur); Farben und Masse aus tokens.css, kein Code der Vorlagen.

import {
  ARTEN,
  ROLLEN,
  absolut,
  relativ,
  tagSchluessel,
  tagText,
  wer,
} from "./protokoll-text.js";

const kurz = (id) => (id ? id.slice(0, 8) : "");

// Marke mit Wort und Symbol, nie nur Farbe; ein span, weil sie in einem Knopf steht
export function ergebnisMarke(e) {
  const ok = e.ergebnis === "erfolg";
  return el(
    "span",
    { class: `chip chip--${ok ? "ok" : "fehler"}` },
    icon(ok ? "haken" : "sperre"),
    ok ? "Erfolgreich" : "Fehlgeschlagen",
    e.status ? el("span", { class: "pl-status" }, ` ${e.status}`) : false,
  );
}

function rollenChips(e) {
  return (e.benutzer.rollen ?? []).map((r) =>
    el("span", { class: "chip pl-rolle" }, ROLLEN[r] ?? r),
  );
}

// Eine Zeile; der ganze Eintrag ist ein Knopf, der das Detail öffnet
export function eintragZeile(e, beiOeffnen) {
  const [artText, artIcon] = ARTEN[e.art] ?? [e.art, "info"];
  const name = wer(e);
  return el(
    "li",
    { class: "pl-eintrag" },
    el(
      "button",
      {
        type: "button",
        class: `pl-zeile${e.ergebnis === "fehler" ? " pl-zeile--fehler" : ""}`,
        "aria-haspopup": "true",
        onclick: (ereignis) => beiOeffnen(e, ereignis.currentTarget),
      },
      el(
        "span",
        { class: "pl-person" },
        avatar(e.benutzer.name ?? "", { hell: true }),
        el("span", { class: "pl-art", title: artText }, icon(artIcon)),
      ),
      el(
        "span",
        { class: "pl-haupt" },
        el(
          "span",
          { class: "pl-wer" },
          el("span", { class: "pl-name" }, name),
          rollenChips(e),
          el("span", { class: "nur-leser" }, `, ${artText}`),
        ),
        el("span", { class: "pl-titel" }, e.titel),
        el(
          "span",
          { class: "pl-meta" },
          el("span", {}, e.bereich),
          e.objekt?.id &&
            el(
              "span",
              { class: "pl-objekt" },
              `${e.objekt.typ ?? "Objekt"} `,
              el("code", {}, kurz(e.objekt.id)),
            ),
          e.anzahl !== null && e.anzahl !== undefined
            ? el("span", {}, `Anzahl ${e.anzahl}`)
            : false,
          e.fehlerCode && el("code", {}, e.fehlerCode),
        ),
      ),
      el(
        "span",
        { class: "pl-rechts" },
        ergebnisMarke(e),
        el(
          "time",
          { class: "pl-zeit", datetime: e.zeit, title: absolut(e.zeit) },
          relativ(e.zeit),
          el("span", { class: "nur-leser" }, `, ${absolut(e.zeit)}`),
        ),
      ),
    ),
  );
}

// Die Zeitleiste: je Tag ein Kopf (Überschrift der Ebene 3) und die Zeilen darunter
export function zeichneZeitleiste(eintraege, beiOeffnen) {
  const wurzel = el("div", { class: "pl-leiste" });
  let tag = null;
  let liste = null;
  for (const e of eintraege) {
    const schluessel = tagSchluessel(e.zeit);
    if (schluessel !== tag) {
      tag = schluessel;
      wurzel.append(el("h3", { class: "pl-tag" }, tagText(e.zeit)));
      liste = el("ul", { class: "pl-liste" });
      wurzel.append(liste);
    }
    liste.append(eintragZeile(e, beiOeffnen));
  }
  return wurzel;
}

// Alle gespeicherten Felder; Werte nur als Text
function detailTabelle(e) {
  const zeilen = [
    ["Zeitpunkt", `${absolut(e.zeit)} (Schweizer Zeit)`],
    ["Art", ARTEN[e.art]?.[0] ?? e.art],
    ["Benutzer", wer(e)],
    ["Benutzer-Kennung", e.benutzer.id],
    [
      "Funktionen",
      (e.benutzer.rollen ?? []).map((r) => ROLLEN[r] ?? r).join(", "),
    ],
    ["Aktion", e.aktion],
    ["Bezeichnung", e.titel],
    ["Bereich", e.bereich],
    [
      "Objekt",
      e.objekt ? `${e.objekt.typ ?? ""} ${e.objekt.id ?? ""}`.trim() : "",
    ],
    ["Geänderte Felder", (e.felder ?? []).join(", ")],
    ["Ergebnis", e.ergebnis === "erfolg" ? "Erfolgreich" : "Fehlgeschlagen"],
    ["Status", e.status],
    ["Fehlercode", e.fehlerCode],
    [
      "Dauer",
      e.dauerMs === null || e.dauerMs === undefined ? "" : `${e.dauerMs} ms`,
    ],
    ["Anzahl", e.anzahl],
    ["Herkunft (Hash, nur am selben Tag vergleichbar)", e.herkunft],
    ["Gerät", e.geraet],
    ["Anfrage-ID", e.anfrageId],
    ["Eintrag", e.id],
  ];
  return el(
    "dl",
    { class: "pl-detail" },
    zeilen
      .filter(([, wert]) => wert !== null && wert !== undefined && wert !== "")
      .flatMap(([name, wert]) => [
        el("dt", {}, name),
        el("dd", {}, el("span", { class: "pl-wert" }, String(wert))),
      ]),
  );
}

// Detail im Fluss: alle Felder, dazu Wege zu verwandten Einträgen. filter(teil) setzt Filter der Seite und schliesst das Blatt
export function zeigeDetail(e, filter) {
  const wege = [
    e.benutzer.id &&
      knopf("Alle Einträge dieser Person", {
        art: "still",
        klein: true,
        symbol: "personen",
        onclick: () => filter({ benutzer: e.benutzer.id }),
      }),
    e.objekt?.id &&
      knopf("Alle Einträge zu diesem Objekt", {
        art: "still",
        klein: true,
        symbol: "tag",
        onclick: () => filter({ objekt: e.objekt.id }),
      }),
    e.anfrageId &&
      knopf("Alle Einträge dieser Anfrage", {
        art: "still",
        klein: true,
        symbol: "lupe",
        onclick: () => filter({ anfrage: e.anfrageId }),
      }),
  ].filter(Boolean);
  const blatt = seitenblatt({
    titel: e.titel,
    untertitel: `${wer(e)} · ${absolut(e.zeit)}`,
    inhalt: [
      el("div", { class: "pl-detail-kopf" }, ergebnisMarke(e)),
      detailTabelle(e),
      wege.length > 0 &&
        el(
          "section",
          { class: "pl-wege", "aria-label": "Verwandte Einträge" },
          el("h3", {}, "Verwandte Einträge"),
          el("div", { class: "reihe" }, wege),
        ),
      el(
        "p",
        { class: "klein leise" },
        "Das Protokoll speichert nie Inhalte von Anfragen, Passwörter, Tokens oder Namen von Kindern. Bei geänderten Feldern stehen nur die Namen der Felder.",
      ),
    ],
  });
  return blatt;
}
