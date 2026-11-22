// Rechtekatalog der Termine (Epic #430, Gerüst #431): die Namen der Rechte und wer sie hat, als Daten, vorerst ein Platzhalter. Die Routen prüfen auf dem Server; ein Folge-Issue ersetzt für sein Recht den Eintrag durch die Prüffunktion und lässt den Namen stehen.
// wer: «abteilungsleitung» = Admin mit zweitem Faktor; «angemeldet» = jede Person mit Konto der Abteilung; «vorschlagende» = Annahme A9 (noch nicht bestätigt): Abteilungsleitung, Stufenleitung oder Leitung, Personen mit einem Tag vom Typ funktion oder team.
// Annahmen A9 und A10 stehen im Plan Termine (Obsidian) und sind vom Nutzer zu bestätigen.
export type TermineWer = "abteilungsleitung" | "angemeldet" | "vorschlagende";

export const TERMINE_RECHTE = {
  "termine.mein_kalender": { issue: "TB1", wer: "angemeldet" },
  "termine.alle": { issue: "TB2", wer: "angemeldet" },
  "termine.warnliste": { issue: "TA2", wer: "abteilungsleitung" },
  "termine.kategorien_zuordnen": { issue: "TA3", wer: "abteilungsleitung" },
  "vorschlag.einreichen": { issue: "TD1", wer: "vorschlagende" },
  "vorschlag.entscheiden": { issue: "TD2", wer: "abteilungsleitung" },
  "anlass.verwalten": { issue: "TE1", wer: "abteilungsleitung" },
  "anlass.anmelden": { issue: "TE2", wer: "angemeldet" },
  "anmeldung.ansehen": { issue: "TE3", wer: "abteilungsleitung" },
} as const satisfies Record<string, { issue: string; wer: TermineWer }>;

export type TermineRecht = keyof typeof TERMINE_RECHTE;
