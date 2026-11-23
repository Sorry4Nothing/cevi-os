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
  "Infos",
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
  {
    schluessel: "hoecks",
    titel: "Höcks",
    gruppe: "Sitzungen",
    recht: "hoecks.lesen_alle|hoecks.team_lesen|hoecks.bearbeiten",
    laden: () => import("./lager-m-hoecks.js"),
  },
  {
    schluessel: "protokolle",
    titel: "Protokolle",
    gruppe: "Sitzungen",
    recht: "protokolle.lesen",
    laden: () => import("./lager-m-protokolle.js"),
  },
  {
    schluessel: "pinnwand",
    titel: "Pinnwand",
    gruppe: "Mitteilen",
    recht: "pinnwand.lesen",
    laden: () => import("./lager-m-pinnwand.js"),
  },
  {
    schluessel: "eingang",
    titel: "Eingang",
    gruppe: "Mitteilen",
    recht: "eingang.senden|eingang.lesen",
    laden: () => import("./lager-m-eingang.js"),
  },
  {
    schluessel: "erwaehnungen",
    titel: "Erwähnungen",
    gruppe: "Mitteilen",
    laden: () => import("./lager-m-erwaehnungen.js"),
  },
  {
    schluessel: "dokumente",
    titel: "Dokumente",
    gruppe: "Mitteilen",
    recht: "dokumente.lesen_alle|dokumente.team_lesen|dokumente.bearbeiten",
    laden: () => import("./lager-m-dokumente.js"),
  },
  {
    schluessel: "packliste",
    titel: "Packliste",
    gruppe: "Material",
    recht: "packliste.lesen",
    laden: () => import("./lager-m-packliste.js"),
  },
  {
    schluessel: "einkauf",
    titel: "Einkauf",
    gruppe: "Material",
    recht: "einkauf.lesen",
    laden: () => import("./lager-m-einkauf.js"),
  },
  {
    schluessel: "infos",
    titel: "Infos",
    gruppe: "Infos",
    recht: "infos.lesen",
    laden: () => import("./lager-m-infos.js"),
  },
  {
    schluessel: "notfall",
    titel: "Notfall",
    gruppe: "Infos",
    recht: "notfall.lesen",
    laden: () => import("./lager-m-notfall.js"),
  },
  {
    schluessel: "tagesseiten",
    titel: "Tagesseiten",
    gruppe: "Planen",
    recht: "tagesseiten.lesen",
    laden: () => import("./lager-m-tagesseiten.js"),
  },
  {
    schluessel: "wetter",
    titel: "Wetter",
    gruppe: "Planen",
    recht: "wetter.lesen",
    laden: () => import("./lager-m-wetter.js"),
    schluessel: "heute",
    titel: "Heute",
    gruppe: "Start",
    laden: () => import("./lager-m-heute.js"),
  },
  {
    schluessel: "woche",
    titel: "Meine Woche",
    gruppe: "Start",
    laden: () => import("./lager-m-woche.js"),
  },
  {
    schluessel: "check",
    titel: "Sind wir bereit?",
    gruppe: "Start",
    recht: "check.lesen",
    laden: () => import("./lager-m-check.js"),
  },
  {
    schluessel: "suche",
    titel: "Suche",
    gruppe: "Start",
    laden: () => import("./lager-m-suche.js"),
  },
  {
    schluessel: "ressorts",
    titel: "Ressorts",
    gruppe: "Lager",
    recht: "ressorts.lesen",
    laden: () => import("./lager-m-ressorts.js"),
  },
  {
    schluessel: "benachrichtigungen",
    titel: "Benachrichtigungen",
    gruppe: "Lager",
    laden: () => import("./lager-m-benachrichtigungen.js"),
  },
];

// Ein Suchbegriff aus dem Feld im Kopf des Arbeitsbereichs geht nie in die Adresse (er kann einen Namen enthalten); das Modul «Suche» holt ihn hier ab
export const suchbegriff = { frage: "" };
