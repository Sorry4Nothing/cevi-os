import { avatar, el, icon, knopf, seitenblatt } from "./dom.js";

// Verlauf des Änderungsprotokolls (#637, #662): Einträge als Zeitleiste mit Benutzerstempel, Detail im Fluss. Aufbau und Zustände nach den Vorlagen «Activity Feed» (gleich hohe Zeilen, Avatar, Zeit zählt relativ) und «Event Timeline» (Tageskopf, durchgehende Spur); Farben und Masse aus tokens.css, kein Code der Vorlagen.

import {
  ARTEN,
  ROLLEN,
  absolut,
  bereichText,
  elternText,
  feldChips,
  gruppeInfo,
  malText,
  objektText,
  quelleText,
  rechteAenderung,
  rechteKurz,
  relativ,
  sicherheitStatus,
  tagSchluessel,
  tagText,
  wechsel,
  wechselKurz,
  werteListe,
  wer,
} from "./protokoll-text.js";

// Marke mit Wort und Symbol, nie nur Farbe; ein span, weil sie in einem Knopf steht
export function gruppeMarke(e) {
  const [wort, symbol, ton] = gruppeInfo(e);
  return el(
    "span",
    { class: `chip pl-marke${ton === "warn" ? " chip--warn" : ""}` },
    icon(symbol),
    wort,
  );
}

// Nur bei Sicherheitszeilen: der Status mit Wort, Symbol und Statuszahl
export function sicherheitMarke(e) {
  return el(
    "span",
    { class: "chip chip--fehler pl-marke" },
    icon("sperre"),
    sicherheitStatus(e),
    e.status ? el("span", { class: "pl-status" }, ` ${e.status}`) : false,
  );
}

function rollenChips(e) {
  return (e.benutzer.rollen ?? []).map((r) =>
    el("span", { class: "chip pl-rolle" }, ROLLEN[r] ?? r),
  );
}

// Meta-Teile unter dem Satz: Bereich, Objekt (wenn der Satz es nicht nennt), Quelle, Felder, Rechte, Vorher/Nachher
function metaTeile(e) {
  // Eine Systemzeile hat keinen Bereich, den «Wer» nicht schon nennt
  const teile =
    e.art === "system"
      ? []
      : [el("span", { class: "pl-bereich" }, bereichText(e.bereich))];
  const objekt = e.objekt ? objektText(e.objekt) : "";
  if (objekt && !e.beschreibung.includes(objekt)) {
    teile.push(el("span", { class: "pl-objekt" }, objekt));
  }
  const quelle = e.art === "aktion" ? "" : quelleText(e);
  if (quelle) teile.push(el("span", {}, quelle));
  if (e.art === "sicherheit" && e.fehlerCode) {
    teile.push(el("code", {}, e.fehlerCode));
  }
  const felder = feldChips(e.felder);
  if (felder.sichtbar.length > 0) {
    teile.push(
      el(
        "span",
        { class: "pl-felder" },
        el("span", { class: "pl-felder-name" }, "Felder"),
        felder.sichtbar.map((f) => el("code", { class: "pl-feld" }, f)),
        felder.rest > 0
          ? el(
              "span",
              { class: "pl-feld pl-feld--rest", title: e.felder.join(", ") },
              `+${felder.rest}`,
            )
          : false,
      ),
    );
  }
  const rechte = rechteKurz(e.aenderung);
  if (rechte) teile.push(el("span", { class: "pl-rechte" }, rechte));
  for (const text of wechselKurz(e.aenderung)) {
    teile.push(el("span", { class: "pl-wechsel" }, text));
  }
  return teile;
}

// Eine Zeile; der ganze Eintrag ist ein Knopf, der das Detail öffnet
export function eintragZeile(e, beiOeffnen) {
  const [artText] = ARTEN[e.art] ?? [e.art];
  const [gruppeWort] = gruppeInfo(e);
  const sicher = e.art === "sicherheit";
  return el(
    "li",
    { class: "pl-eintrag" },
    el(
      "button",
      {
        type: "button",
        class: `pl-zeile${sicher ? " pl-zeile--fehler" : ""}`,
        "aria-haspopup": "true",
        onclick: (ereignis) => beiOeffnen(e, ereignis.currentTarget),
      },
      el(
        "span",
        { class: "pl-person" },
        e.benutzer.name
          ? avatar(e.benutzer.name, { hell: true })
          : el(
              "span",
              { class: "ava ava--hell", "aria-hidden": "true" },
              icon(e.benutzer.akteur === "anonym" ? "personen" : "system"),
            ),
      ),
      el(
        "span",
        { class: "pl-haupt" },
        el("span", { class: "pl-satz" }, e.beschreibung),
        el(
          "span",
          { class: "pl-wer" },
          el("span", { class: "pl-name" }, wer(e)),
          rollenChips(e),
          el("span", { class: "nur-leser" }, `, ${artText}, ${gruppeWort}`),
        ),
        el("span", { class: "pl-meta" }, metaTeile(e)),
      ),
      el(
        "span",
        { class: "pl-rechts" },
        sicher ? sicherheitMarke(e) : gruppeMarke(e),
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

// Eine Definitionsliste; Zeilen ohne Wert fallen weg. wert darf Text oder Knoten sein
function dl(zeilen) {
  const sichtbar = zeilen.filter(
    ([, wert]) =>
      wert !== null && wert !== undefined && wert !== "" && wert !== false,
  );
  if (sichtbar.length === 0) return false;
  return el(
    "dl",
    { class: "pl-detail" },
    sichtbar.flatMap(([name, wert]) => [
      el("dt", {}, name),
      el("dd", {}, el("span", { class: "pl-wert" }, wert)),
    ]),
  );
}
const namenListe = (namen) =>
  el(
    "ul",
    { class: "pl-namen" },
    namen.map((n) => el("li", {}, el("code", { class: "pl-feld" }, n))),
  );

// «Was sich geändert hat»: alles, was die Zeile über die Änderung weiss, ohne Inhalte
function aenderungsAbschnitt(e) {
  // Sicherheits- und Systemzeilen ändern nichts: Dort steht, was geschah
  if (e.art === "sicherheit" || e.art === "system") {
    return el(
      "section",
      { class: "pl-abschnitt", "aria-labelledby": "pl-d-aenderung" },
      el("h3", { id: "pl-d-aenderung" }, "Was geschah"),
      dl([
        ["Ereignis", e.beschreibung],
        ["Fehlercode", e.fehlerCode],
        [
          "Anzahl",
          e.art === "sicherheit" && e.anzahl > 1
            ? `${e.anzahl} Ereignisse in dieser Stunde, zu einer Zeile zusammengezogen`
            : e.anzahl,
        ],
      ]),
    );
  }
  const a = e.aenderung;
  const rechte = rechteAenderung(a);
  const wechselListe = wechsel(a);
  const inhalt = dl([
    ["Objekt", e.objekt ? objektText(e.objekt) : ""],
    ["In", elternText(a)],
    ["Aktion", gruppeInfo(e)[0]],
    ["Felder", e.felder?.length ? namenListe(e.felder) : ""],
    ["Rechte neu", rechte.neu.length ? namenListe(rechte.neu) : ""],
    [
      "Rechte entzogen",
      rechte.entzogen.length ? namenListe(rechte.entzogen) : "",
    ],
    [
      "Geltung geändert",
      rechte.geaendert.length ? namenListe(rechte.geaendert) : "",
    ],
    [
      "Vorher und nachher",
      wechselListe.length
        ? el(
            "ul",
            { class: "pl-namen pl-namen--spalte" },
            wechselListe.map((w) =>
              el(
                "li",
                {},
                el("strong", {}, w.feld),
                ": ",
                w.vorher ? [el("span", {}, w.vorher), " → "] : false,
                el("span", {}, w.nachher),
              ),
            ),
          )
        : "",
    ],
    ...werteListe(a),
    ["Anzahl", e.anzahl],
  ]);
  return el(
    "section",
    { class: "pl-abschnitt", "aria-labelledby": "pl-d-aenderung" },
    el("h3", { id: "pl-d-aenderung" }, "Was sich geändert hat"),
    inhalt ||
      el(
        "p",
        { class: "klein leise" },
        "Zu dieser Zeile sind keine weiteren Angaben gespeichert.",
      ),
  );
}

// Wer und wann
function werAbschnitt(e) {
  return el(
    "section",
    { class: "pl-abschnitt", "aria-labelledby": "pl-d-wer" },
    el("h3", { id: "pl-d-wer" }, "Wer und wann"),
    dl([
      ["Person", wer(e)],
      [
        "Funktionen",
        (e.benutzer.rollen ?? []).map((r) => ROLLEN[r] ?? r).join(", "),
      ],
      ["Zeitpunkt", `${absolut(e.zeit)} (Schweizer Zeit)`],
      ["Bereich", bereichText(e.bereich)],
      ["Art", (ARTEN[e.art] ?? [e.art])[0]],
    ]),
  );
}

// Technische Angaben, eingeklappt
function technikAbschnitt(e) {
  return el(
    "details",
    { class: "pl-technik" },
    el("summary", {}, "Technische Angaben"),
    dl([
      ["Aktion", e.aktion],
      ["Methode", e.methode],
      ["Status", e.status],
      ["Fehlercode", e.fehlerCode],
      ["Audit-Name", e.aenderung?.audit],
      [
        "Dauer",
        e.dauerMs === null || e.dauerMs === undefined ? "" : `${e.dauerMs} ms`,
      ],
      ["Benutzer-Kennung", e.benutzer.id],
      ["Objekt-Kennung", e.objekt?.id],
      ["Herkunft (Hash, nur am selben Tag vergleichbar)", e.herkunft],
      ["Gerät", e.geraet],
      ["Anfrage-ID", e.anfrageId],
      ["Eintrag", e.id],
    ]),
  );
}

// Detail im Fluss: alle Angaben, dazu Wege zu verwandten Einträgen. filter(teil) setzt Filter der Seite und schliesst das Blatt
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
  const sicher = e.art === "sicherheit";
  return seitenblatt({
    titel: e.beschreibung,
    untertitel: `${wer(e)} · ${absolut(e.zeit)}`,
    inhalt: [
      el(
        "div",
        { class: "pl-detail-kopf" },
        sicher ? sicherheitMarke(e) : gruppeMarke(e),
        malText(e) ? el("span", { class: "chip" }, malText(e)) : false,
      ),
      aenderungsAbschnitt(e),
      werAbschnitt(e),
      technikAbschnitt(e),
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
        "Das Protokoll speichert nie Inhalte von Anfragen, Passwörter, Tokens oder Namen von Kindern. Von geänderten Feldern stehen nur die Namen, von Rechten nur ihre Bezeichnungen.",
      ),
    ],
  });
}
