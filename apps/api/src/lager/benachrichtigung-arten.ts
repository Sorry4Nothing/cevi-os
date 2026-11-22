import type { LagerPushTyp } from "../push.js";

// Register der Benachrichtigungsarten des Lagers (#369). Jedes Modul trägt seine Arten hier mit einer Zeile ein.
// - push: der typ des Pushes und damit der Android-Kanal (push.ts); die App öffnet das Ziel über GET /api/v1/lager/aufloesen/{typ}/{id}
// - titel: fester Text des Pushes. Er nennt nie eine Person, einen Aufgaben- oder Protokolltitel oder einen Inhalt; darunter steht der Lagertitel
export const ARTEN = {
  aufgabe_zugeteilt: { push: "lager_aufgabe", titel: "Neue Aufgabe für dich" },
  aufgabe_geaendert: { push: "lager_aufgabe", titel: "Aufgabe geändert" },
  erwaehnung: { push: "lager_erwaehnung", titel: "Du wurdest erwähnt" },
  frist: { push: "lager_aufgabe", titel: "Eine Frist rückt näher" },
  pinnwand_wichtig: { push: "lager_pinnwand", titel: "Wichtige Mitteilung" },
  eingang_antwort: {
    push: "lager_eingang",
    titel: "Antwort auf deine Nachricht",
  },
  diensttausch: { push: "lager_einteilung", titel: "Diensttausch" },
  anwesenheit_anfrage: {
    push: "lager_anwesenheit",
    titel: "Neue Anwesenheits-Anfrage",
  },
  anwesenheit_entscheid: {
    push: "lager_anwesenheit",
    titel: "Deine Anwesenheits-Anfrage wurde entschieden",
  },
} as const satisfies Record<string, { push: LagerPushTyp; titel: string }>;

export type BenachrichtigungsArt = keyof typeof ARTEN;

export const ART_IDS = Object.keys(ARTEN) as [
  BenachrichtigungsArt,
  ...BenachrichtigungsArt[],
];
