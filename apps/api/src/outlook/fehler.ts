// Feste Codes für letzter_fehler und Log: nie Text, Adresse oder Token aus der Antwort von Microsoft (SR-50, SR-51)
export const FEHLER = {
  NICHT_ERREICHBAR: "NICHT_ERREICHBAR",
  ZU_VIELE_ANFRAGEN: "ZU_VIELE_ANFRAGEN",
  SERVER: "SERVER",
  ABGELEHNT: "ABGELEHNT",
  ANTWORT_UNGUELTIG: "ANTWORT_UNGUELTIG",
  ANMELDUNG_ABGELAUFEN: "ANMELDUNG_ABGELAUFEN",
  NICHT_VERBUNDEN: "NICHT_VERBUNDEN",
  TERMIN_NICHT_GEFUNDEN: "TERMIN_NICHT_GEFUNDEN",
  TERMIN_MEHRDEUTIG: "TERMIN_MEHRDEUTIG",
  UNERWARTET: "UNERWARTET",
} as const;
export type FehlerCode = (typeof FEHLER)[keyof typeof FEHLER];

// dauerhaft: Wiederholen hilft nicht (abgelehnt, nicht gefunden, Anmeldung abgelaufen); sonst holt ein späterer Lauf es nach
const DAUERHAFT: readonly FehlerCode[] = [
  FEHLER.ABGELEHNT,
  FEHLER.ANTWORT_UNGUELTIG,
  FEHLER.ANMELDUNG_ABGELAUFEN,
  FEHLER.NICHT_VERBUNDEN,
  FEHLER.TERMIN_NICHT_GEFUNDEN,
  FEHLER.TERMIN_MEHRDEUTIG,
];

export class OutlookFehler extends Error {
  readonly dauerhaft: boolean;
  // Bei Drosselung: so lange verlangt Microsoft zu warten (Retry-After), in Sekunden
  wartenSek?: number;
  constructor(
    readonly code: FehlerCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "OutlookFehler";
    this.dauerhaft = DAUERHAFT.includes(code);
  }
}

export const fehlerCodeVon = (fehler: unknown): FehlerCode =>
  fehler instanceof OutlookFehler ? fehler.code : FEHLER.UNERWARTET;

// Fällt der Zugang insgesamt aus (Netz, Drosselung, Server, Anmeldung), lohnt es nicht, die weiteren Aufträge desselben Laufs zu versuchen
export const ausfallVon = (fehler: unknown) =>
  fehler instanceof OutlookFehler &&
  (fehler.code === FEHLER.NICHT_ERREICHBAR ||
    fehler.code === FEHLER.ZU_VIELE_ANFRAGEN ||
    fehler.code === FEHLER.SERVER ||
    fehler.code === FEHLER.ANMELDUNG_ABGELAUFEN ||
    fehler.code === FEHLER.NICHT_VERBUNDEN);
