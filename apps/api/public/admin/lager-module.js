// Register der Module im Lager-Arbeitsbereich (#672). Adresse: #lager/lager/<lagerId>/<schluessel>[/<id>…].
// Jede Zeile: { schluessel, titel, gruppe, recht, laden }.
//  - gruppe: ein Name aus GRUPPEN (Reihenfolge der Navigation); ein anderer Name steht hinter den bekannten Gruppen.
//  - recht: Schlüssel aus dem Rechtekatalog der Lager-Rolle (lager/rechte-katalog.ts); mit «|» genügt eines von mehreren. Ohne «recht» sieht jede Rolle das Modul. Die Navigation zeigt nur Module mit Recht; der Server prüft weiter alles.
//  - laden: () => import("./lager-m-<schluessel>.js"); das Modul exportiert zeige(bereich, ctx, lagerId, lager).
// Jedes Modul fügt nur seine Zeilen ein; bei einem Merge-Konflikt beide Seiten behalten.

export const GRUPPEN = [
  "Start",
  "Planen",
  "Sitzungen",
  "Mitteilen",
  "Menschen",
  "Material",
  "Lager",
];

export const MODULE = [
  // Menschen und Einteilung (#675)
  {
    schluessel: "teilnehmer",
    titel: "Teilnehmende",
    gruppe: "Menschen",
    recht: "teilnehmer.lesen",
    laden: () => import("./lager-m-teilnehmer.js"),
  },
  {
    schluessel: "abzaehlen",
    titel: "Abzählen",
    gruppe: "Menschen",
    recht: "teilnehmer.lesen",
    laden: () => import("./lager-m-abzaehlen.js"),
  },
  {
    schluessel: "anwesenheit",
    titel: "Anwesenheit",
    gruppe: "Menschen",
    recht: "anwesenheit.lesen_alle|anwesenheit.eigene",
    laden: () => import("./lager-m-anwesenheit.js"),
  },
  {
    schluessel: "gruppen",
    titel: "Gruppen",
    gruppe: "Menschen",
    recht: "einteilung.lesen",
    laden: () => import("./lager-m-gruppen.js"),
  },
  {
    schluessel: "zimmer",
    titel: "Zimmer und Zelte",
    gruppe: "Menschen",
    recht: "einteilung.lesen",
    laden: () => import("./lager-m-zimmer.js"),
  },
  {
    schluessel: "fahrten",
    titel: "Fahrten",
    gruppe: "Menschen",
    recht: "einteilung.lesen",
    laden: () => import("./lager-m-fahrten.js"),
  },
  {
    schluessel: "schichtplan",
    titel: "Schichtplan",
    gruppe: "Menschen",
    recht: "einteilung.lesen",
    laden: () => import("./lager-m-schichtplan.js"),
  },
  {
    schluessel: "diensttausch",
    titel: "Diensttausch",
    gruppe: "Menschen",
    recht: "diensttausch.anfragen|diensttausch.entscheiden",
    laden: () => import("./lager-m-diensttausch.js"),
  },
  {
    schluessel: "adressbuch",
    titel: "Adressbuch",
    gruppe: "Menschen",
    recht: "adressbuch.lesen",
    laden: () => import("./lager-m-adressbuch.js"),
  },
];

// Ein Suchbegriff aus dem Feld im Kopf des Arbeitsbereichs geht nie in die Adresse (er kann einen Namen enthalten); das Modul «Suche» holt ihn hier ab
export const suchbegriff = { frage: "" };
