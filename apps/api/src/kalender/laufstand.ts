// Ergebnis des letzten Abrufs der Stufenwebseiten für die Verwaltung (#267). Im Arbeitsspeicher wie die Zahlen in metriken.ts: Nach einem Neustart füllt der Lauf beim Start ihn wieder.
// Nie HTML, Text der Seite oder Fehlertexte: nur ein fester Ausgang, bei einem Fehler dessen Code.
export type EckdatenAusgang =
  "gelesen" | "keine_seite" | "ohne_datum" | "fehler";

export type StufenLauf = {
  ausgang: EckdatenAusgang;
  fehlercode: string | null;
  // Fest aus Basis und [a-z0-9]-Slug gebaut und öffentlich
  adresse: string;
};

export const eckdatenLauf: {
  am: Date | null;
  stufen: Map<string, StufenLauf>;
} = { am: null, stufen: new Map() };

// Codes wie ENOENT, 22021 oder TimeoutError; alles andere gilt als «abruf»
export function sicherenFehlercode(code: unknown) {
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)
    ? code
    : "abruf";
}
