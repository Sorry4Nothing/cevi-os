export type Kindfehler = {
  vorname?: string;
  nachname?: string;
  stufe?: string;
};

// Die Regeln des Servers (Namen 1 bis 100 Zeichen, eine Stufe), damit Fehler beim Feld stehen
export function pruefeKindfelder(eingabe: {
  vorname: string;
  nachname: string;
  stufeId: string | null;
}) {
  const vorname = eingabe.vorname.trim();
  const nachname = eingabe.nachname.trim();
  const fehler: Kindfehler = {};
  if (vorname.length < 1 || vorname.length > 100) {
    fehler.vorname = "Bitte einen Vornamen mit höchstens 100 Zeichen eingeben.";
  }
  if (nachname.length < 1 || nachname.length > 100) {
    fehler.nachname =
      "Bitte einen Nachnamen mit höchstens 100 Zeichen eingeben.";
  }
  if (!eingabe.stufeId) fehler.stufe = "Bitte eine Stufe wählen.";
  return {
    fehler,
    werte:
      Object.keys(fehler).length > 0 || !eingabe.stufeId
        ? undefined
        : { vorname, nachname, stufeId: eingabe.stufeId },
  };
}
