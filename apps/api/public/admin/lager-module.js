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
  {
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
