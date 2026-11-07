// Feste Texte für sync_fehler und Log: nie message, Pfad, Kalenderadresse oder Schlüssel
export class KalenderFehler extends Error {
  constructor(text: string, options?: ErrorOptions) {
    super(text, options);
    this.name = "KalenderFehler";
  }
}

export const ADRESSE_UNGUELTIG = "Kalenderadresse ungültig";
export const NICHT_ERREICHBAR = "Kalender nicht erreichbar";
export const ANTWORT_UNGUELTIG = "Antwort des Kalenders ungültig";
export const UNERWARTET = "Unerwarteter Fehler";
export const antwortMitStatus = (status: number) =>
  `Kalender antwortet mit HTTP ${status}`;

export function fehlerText(fehler: unknown) {
  return fehler instanceof KalenderFehler ? fehler.message : UNERWARTET;
}

// Der Code ist gefahrlos (ENOENT, 22021, …); DrizzleQueryError und KalenderFehler tragen ihn in der Ursache
export function fehlerCode(fehler: unknown) {
  const f = fehler as { code?: unknown; cause?: { code?: unknown } };
  return f?.code ?? f?.cause?.code;
}
