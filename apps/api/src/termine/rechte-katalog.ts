// Rechtekatalog der Termine (Epic #430, Gerüst #431): die Namen der Rechte und wer sie standardmässig hat, als Daten. Entschieden wird im zentralen Katalog (rechtemodell/katalog.ts) mit verlange() (#649); diese Liste hält die Standardrolle fest, die docs/rechte.md Anhang B beschreibt.
// wer: «abteilungsleitung» = Abteilungsleitung mit zweitem Faktor; «angemeldet» = jede Person mit Konto der Abteilung; «vorschlagende» = Annahme A9 (noch nicht bestätigt): Abteilungsleitung, Stufenleitung oder Leitung, Personen mit einem Tag vom Typ funktion oder team.
// «raumteam» = Raumanfragen (#447): wer das Team des Raums trägt, für Räume ohne Team die Abteilungsleitung; eine Gruppenrolle kann das Recht für die Räume ihres Teams haben.
// «leitende» = Belegungsplan der Räume (#628, Wunsch des Nutzers, vom Nutzer zu bestätigen): Abteilungsleitung, Leitung oder Stufenleitung einer Stufe, Team-Verantwortliche und wer das Team eines Raums trägt (termine/raum.ts: darfBelegungSehen).
// Annahmen A9 und A10 stehen im Plan Termine (Obsidian) und sind vom Nutzer zu bestätigen.
export type TermineWer =
  | "abteilungsleitung"
  | "angemeldet"
  | "vorschlagende"
  | "leitende"
  | "raumteam";

export const TERMINE_RECHTE = {
  "termine.mein_kalender": { issue: "TB1", wer: "angemeldet" },
  "termine.alle": { issue: "TB2", wer: "angemeldet" },
  "termine.warnliste": { issue: "TA2", wer: "abteilungsleitung" },
  "termine.kategorien_zuordnen": { issue: "TA3", wer: "abteilungsleitung" },
  "vorschlag.einreichen": { issue: "TD1", wer: "vorschlagende" },
  "vorschlag.entscheiden": { issue: "TD2", wer: "abteilungsleitung" },
  "anlass.anlegen": { issue: "TE1", wer: "abteilungsleitung" },
  "anlass.verwalten": { issue: "TE1", wer: "abteilungsleitung" },
  "anlass.anmelden": { issue: "TE2", wer: "angemeldet" },
  "anmeldung.ansehen": { issue: "TE3", wer: "abteilungsleitung" },
  "anlass.anmeldungen_exportieren": { issue: "TE3", wer: "abteilungsleitung" },
  "raum.ansehen": { issue: "TG1", wer: "angemeldet" },
  "raum.verwalten": { issue: "TG1", wer: "abteilungsleitung" },
  "raum.belegung": { issue: "TG3", wer: "leitende" },
  "raum.anfrage_entscheiden": { issue: "TG2", wer: "raumteam" },
  "raum.team_zuweisen": { issue: "TG1", wer: "abteilungsleitung" },
} as const satisfies Record<string, { issue: string; wer: TermineWer }>;

export type TermineRecht = keyof typeof TERMINE_RECHTE;
