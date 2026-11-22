// Rechtekatalog des Lagers (#364): die Namen der Rechte und die Standardmatrix, als Daten. Die Policy (policy.ts) fragt nur darf(); L0b (#365) liest die Einstellungen je Lager aus lager_rolle_recht und fällt auf diese Standardwerte zurück.
// Aus dem Katalog erzeugt L0b die Rechte-Tests (je Recht und Rolle erlaubt oder verboten).

export const LAGER_ROLLEN = [
  "lagerleitung",
  "leitung",
  "team",
  "lesen",
] as const;
export type LagerRolle = (typeof LAGER_ROLLEN)[number];

export const LAGER_STATUS = [
  "entwurf",
  "aktiv",
  "abgeschlossen",
  "archiviert",
] as const;
export type LagerStatus = (typeof LAGER_STATUS)[number];

type Standard = Exclude<LagerRolle, "lagerleitung">;
type Eintrag = { bedeutung: string; standard: readonly Standard[] };

// Die Lagerleitung hat immer jedes Recht und steht darum nicht in der Liste; sie lässt sich nicht aussperren. «standard» nennt die übrigen Rollen, die das Recht ohne Einstellung haben
const e = (bedeutung: string, ...standard: Standard[]): Eintrag => ({
  bedeutung,
  standard,
});
const katalog = <K extends string>(eintraege: Record<K, Eintrag>) => eintraege;

// Nicht im Katalog, weil fest: Lager-Stammdaten, Mitglieder und Rechte verwalten (Lagerleitung und Abteilungsleitung); eigene To-dos, Benachrichtigungen und Einstellungen (jede Rolle); Suche, Aggregate und Ausdrucke (folgen den Rechten der Daten); Papierkorb und Revisionen (wer den Bereich bearbeiten darf)
export const RECHTE_KATALOG = katalog({
  "ressorts.lesen": e("Ressorts, Links und Notizen lesen", "leitung", "lesen"),
  "ressorts.bearbeiten": e("Ressorts, Links und Notizen ändern"),
  "aufgaben.lesen_alle": e("Alle Aufgaben lesen", "leitung", "lesen"),
  "aufgaben.bearbeiten": e("Alle Aufgaben anlegen, ändern, löschen", "leitung"),
  "aufgaben.eigene": e(
    "Eigene Aufgaben lesen, Status setzen",
    "leitung",
    "team",
  ),
  "zeitplan.lesen": e(
    "Meilensteine, Lagertage, Tagesabschnitte lesen",
    "leitung",
    "team",
    "lesen",
  ),
  "zeitplan.bearbeiten": e("Zeitplan ändern, Fristen verschieben"),
  "vorlagen.anwenden": e("Vorlage auf das Lager anwenden"),
  "check.lesen": e("Lager-Check lesen", "leitung", "lesen"),
  "hoecks.lesen_alle": e("Alle Höcks und Traktanden lesen", "leitung", "lesen"),
  "hoecks.team_lesen": e(
    "Höcks der Art team lesen",
    "leitung",
    "team",
    "lesen",
  ),
  "hoecks.bearbeiten": e("Höcks und Traktanden ändern", "leitung"),
  "protokolle.lesen": e("Protokolle und Beschlüsse lesen", "leitung", "lesen"),
  "protokolle.bearbeiten": e("Protokolle und Beschlüsse ändern", "leitung"),
  "pinnwand.lesen": e(
    "Aktive Pinnwand für passende Empfänger lesen",
    "leitung",
    "team",
    "lesen",
  ),
  "pinnwand.bearbeiten": e(
    "Beiträge und Umfragen anlegen und ändern",
    "leitung",
  ),
  "interaktion.schreiben": e(
    "Eigene Stimmen und Reaktionen",
    "leitung",
    "team",
  ),
  "eingang.senden": e("Eigenen Eingang senden und lesen", "leitung", "team"),
  "eingang.lesen": e("Alle Eingänge lesen"),
  "eingang.antworten": e("Eingänge beantworten und zuordnen"),
  "teilnehmer.lesen": e(
    "Teilnehmende lesen (Name, Stufe)",
    "leitung",
    "team",
    "lesen",
  ),
  "teilnehmer.bearbeiten": e("Teilnehmende erfassen und ändern"),
  "einteilung.lesen": e(
    "Zimmer, Fahrten, Gruppen, Schichtplan lesen",
    "leitung",
    "team",
    "lesen",
  ),
  "einteilung.bearbeiten": e(
    "Einteilung ändern, Vorschläge anwenden",
    "leitung",
  ),
  "abzaehlen.schreiben": e("Abzählen abhaken", "leitung", "team"),
  "diensttausch.anfragen": e(
    "Eigenen Diensttausch anfragen",
    "leitung",
    "team",
  ),
  "diensttausch.entscheiden": e("Diensttausch entscheiden", "leitung"),
  "anwesenheit.lesen_alle": e("Anwesenheit aller lesen", "leitung", "lesen"),
  "anwesenheit.eigene": e(
    "Eigene Anwesenheit (leere Felder), eigene Anfragen",
    "leitung",
    "team",
  ),
  "anwesenheit.bearbeiten": e("Anwesenheit ändern, Anfragen entscheiden"),
  "tagesseiten.lesen": e("Tagesseiten lesen", "leitung", "lesen"),
  "tagesseiten.bearbeiten": e("Tagesseiten ändern", "leitung"),
  "einkauf.lesen": e("Einkaufsliste lesen", "leitung", "lesen"),
  "einkauf.bearbeiten": e("Einkaufsliste ändern", "leitung"),
  "packliste.lesen": e("Packliste lesen", "leitung", "team", "lesen"),
  "packliste.abhaken": e("Packliste abhaken", "leitung", "team"),
  "packliste.bearbeiten": e("Packliste ändern"),
  "notfall.lesen": e("Notfall-Kontakte lesen", "leitung", "team", "lesen"),
  "notfall.bearbeiten": e("Notfall-Kontakte ändern"),
  "infos.lesen": e("Infos lesen", "leitung", "team", "lesen"),
  "infos.bearbeiten": e("Infos ändern"),
  "vertrauliches.lesen": e("Zeilen mit nur_lagerleitung lesen"),
  "wetter.lesen": e("Wetter lesen", "leitung", "team", "lesen"),
  "dokumente.lesen_alle": e("Alle Dokumente lesen", "leitung", "lesen"),
  "dokumente.team_lesen": e(
    "Dokumente mit team_sichtbar lesen",
    "leitung",
    "team",
    "lesen",
  ),
  "dokumente.bearbeiten": e("Dokumente ändern", "leitung"),
  "adressbuch.lesen": e("Adressbuch lesen"),
  "adressbuch.bearbeiten": e("Adressbuch ändern"),
  "verlauf.lesen": e("Verlauf lesen", "leitung", "lesen"),
});

export type LagerRecht = keyof typeof RECHTE_KATALOG;
export const LAGER_RECHTE = Object.keys(RECHTE_KATALOG) as LagerRecht[];

// Die Standardmatrix im Code; ein unbekanntes Recht gilt als verboten (fail-closed, auch zur Laufzeit, falls ein Aufrufer an den Typen vorbei kommt)
export function standardErlaubt(rolle: LagerRolle, recht: LagerRecht) {
  if (rolle === "lagerleitung") return recht in RECHTE_KATALOG;
  const eintrag = RECHTE_KATALOG[recht] as Eintrag | undefined;
  return (
    (eintrag?.standard as readonly LagerRolle[] | undefined)?.includes(rolle) ??
    false
  );
}
