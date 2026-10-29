// Ein deutscher Text pro Server-Code, nie die englische Meldung von better-auth.
// Für die Codes aus #8 und #15 wörtlich die Meldung des Servers.
const FEHLERTEXTE: Record<string, string> = {
  APP_VERALTET: "Bitte App aktualisieren",
  ANMELDUNG_FEHLGESCHLAGEN:
    "Anmeldung nicht möglich. Bitte Benutzername und Passwort prüfen oder später nochmals versuchen. Sonst hilft ein Admin.",
  ZU_VIELE_ANFRAGEN: "Zu viele Anfragen. Bitte später nochmals versuchen.",
  // Das Konto ist beim zweiten Schritt, nicht beim Anmelden: Hier sagt der Server, was fehlt
  STARTPASSWORT_ABGELAUFEN:
    "Das Startpasswort ist abgelaufen. Ein Admin kann ein neues setzen.",
  INVALID_CODE: "Der Code stimmt nicht.",
  INVALID_BACKUP_CODE: "Der Code stimmt nicht.",
  ZWEITER_FAKTOR_FEHLT:
    "Für die Verwaltung braucht es zuerst einen zweiten Faktor.",
  EIGENER_ZWEITER_FAKTOR:
    "Den eigenen zweiten Faktor setzt ein anderer Admin zurück.",
  KEIN_ZWEITER_FAKTOR: "Diese Person hat keinen zweiten Faktor.",
  INVALID_PASSWORD: "Das bisherige Passwort stimmt nicht.",
  PASSWORT_FALSCH: "Das Passwort stimmt nicht.",
  PASSWORD_TOO_SHORT: "Das neue Passwort braucht mindestens 12 Zeichen.",
  PASSWORD_COMPROMISED:
    "Dieses Passwort kommt in einem bekannten Datenleck vor. Bitte ein anderes wählen.",
  PASSWORT_UNVERAENDERT:
    "Das neue Passwort muss sich vom bisherigen unterscheiden.",
  BENUTZERNAME_VERGEBEN: "Dieser Benutzername ist schon vergeben.",
  PROGRAMM_GESCHLOSSEN:
    "Das Programm ist abgesagt oder hat schon begonnen. Die Teilnahme lässt sich nicht mehr ändern.",
  LETZTER_ADMIN: "Der letzte Admin lässt sich nicht entfernen.",
  EIGENES_KONTO:
    "Das eigene Konto lässt sich hier nicht zurücksetzen, deaktivieren oder löschen.",
};

export const ALLGEMEINER_FEHLER =
  "Das hat nicht geklappt. Bitte später nochmals versuchen.";

export const KEIN_NETZ =
  "Keine Internetverbindung. Bitte später nochmals versuchen.";

export function fehlertext(fehler: { code?: string | undefined } | null) {
  return (fehler?.code && FEHLERTEXTE[fehler.code]) || ALLGEMEINER_FEHLER;
}

// Wo ein change-password-Fehler steht: beim bisherigen oder neuen Passwort, sonst über dem Knopf
export function passwortFehlerfeld(
  code: string | undefined,
): "bisheriges" | "neues" | "allgemein" {
  if (code === "INVALID_PASSWORD") return "bisheriges";
  if (
    code === "PASSWORD_TOO_SHORT" ||
    code === "PASSWORD_COMPROMISED" ||
    code === "PASSWORT_UNVERAENDERT"
  ) {
    return "neues";
  }
  return "allgemein";
}
