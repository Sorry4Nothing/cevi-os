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
];

// Ein Suchbegriff aus dem Feld im Kopf des Arbeitsbereichs geht nie in die Adresse (er kann einen Namen enthalten); das Modul «Suche» holt ihn hier ab
export const suchbegriff = { frage: "" };
