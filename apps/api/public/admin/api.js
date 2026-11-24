// Alle Aufrufe gegen die eigene Herkunft. Die Sitzung liegt nur im Cookie des Browsers (httpOnly); die Seite speichert nichts davon.

export class ApiFehler extends Error {
  constructor(status, code, meldung, warten, verwendung, seiten, daten) {
    super(code ?? String(status));
    this.status = status;
    this.code = code;
    this.meldung = meldung;
    this.warten = warten;
    // Bei 409 TAG_BELEGT: wie viele Personen den Tag tragen
    this.verwendung = verwendung;
    // Bei 409 MEDIUM_VERWENDET: in wie vielen Seiten das Medium steht
    this.seiten = seiten;
    // Der ganze Body der Fehlerantwort (409 KONFLIKT des Editors: aktueller Zähler und Dokument; 400 und 422: die Fehler mit Pfad)
    this.daten = daten;
  }

  // Status 0: Die Anfrage kam gar nicht beim Server an
  get offline() {
    return this.status === 0;
  }
}

// Läuft die Sitzung während der Arbeit ab (401 auf einer Daten-Route), führt die Seite zurück zur Anmeldung
let beiAbgelaufen = () => {};
// Ob ein Teil der Adresse eine echte Kennung (UUID) ist: Nur sie geht in Pfade der API, nie «../», «?» oder Freitext
export const kennungGueltig = (wert) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wert);

export function beiSitzungsende(fn) {
  beiAbgelaufen = fn;
}

// Beim Verlassen der Seite (pagehide) führt die Verwaltung offene Aktionen mit «Rückgängig» aus (rueckgaengig.js): Diese Anfragen laufen mit keepalive weiter, auch wenn die Seite schon weg ist
let verlassen = false;
export function setzeVerlassen(wert = true) {
  verlassen = wert;
}

function fehlerAus(status, daten, warten, pfad) {
  if (status === 401 && pfad.startsWith("/api/v1/")) beiAbgelaufen();
  return new ApiFehler(
    status,
    daten?.code,
    daten?.message,
    warten,
    daten?.verwendung,
    daten?.seiten,
    daten,
  );
}

// Eine Datei hochladen und den Fortschritt melden (fetch kennt keinen Upload-Fortschritt). Das Signal bricht ab: Die Antwort ist dann ein AbortError.
export function hochladen(pfad, datei, { beiFortschritt, signal } = {}) {
  return new Promise((erfolg, fehler) => {
    const x = new window.XMLHttpRequest();
    x.open("POST", pfad);
    x.responseType = "json";
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) beiFortschritt?.(e.loaded / e.total);
    };
    x.onload = () =>
      x.status >= 200 && x.status < 300
        ? erfolg(x.response)
        : fehler(
            fehlerAus(
              x.status,
              x.response,
              x.getResponseHeader("X-Retry-After"),
              pfad,
            ),
          );
    x.onerror = () => fehler(new ApiFehler(0, "NETZ"));
    x.onabort = () =>
      fehler(new window.DOMException("Abgebrochen", "AbortError"));
    signal?.addEventListener("abort", () => x.abort(), { once: true });
    x.send(datei);
  });
}

// signal: bricht die Anfrage ab (Suche mit Vorschlägen: eine neue Eingabe ersetzt die alte); die Antwort ist dann ein AbortError
export async function anfrage(methode, pfad, body, signal) {
  let antwort;
  try {
    antwort = await fetch(pfad, {
      method: methode,
      signal,
      credentials: "same-origin",
      cache: "no-store",
      keepalive: verlassen || undefined,
      // Eine Datei geht unverändert hin (Logo-Upload), alles andere als JSON
      headers:
        body === undefined || body instanceof Blob
          ? undefined
          : { "Content-Type": "application/json" },
      body:
        body === undefined || body instanceof Blob
          ? body
          : JSON.stringify(body),
    });
  } catch (f) {
    if (signal?.aborted) throw f;
    throw new ApiFehler(0, "NETZ");
  }
  if (antwort.status === 204) return null;
  let daten = null;
  try {
    daten = await antwort.json();
  } catch {
    // Kein JSON: Der Status genügt
  }
  if (!antwort.ok) {
    throw fehlerAus(
      antwort.status,
      daten,
      antwort.headers.get("X-Retry-After"),
      pfad,
    );
  }
  return daten;
}

const CODES = {
  ANMELDUNG_FEHLGESCHLAGEN:
    "Anmeldung nicht möglich. Prüfe Benutzername und Passwort oder versuche es später nochmals.",
  GESPERRT:
    "Dieser Bereich ist durch eine Informationssperre gesperrt. Unter «Plattform» hebst du die Sperre auf.",
  IN_WARTUNG:
    "Dieser Bereich ist in Wartung. Ansehen geht, Ändern ist vorübergehend nicht möglich.",
  BILD_FORMAT: "Bitte ein Bild als JPEG, PNG oder WebP wählen.",
  PUSH_NICHT_EINGERICHTET:
    "Der Push-Dienst ist auf diesem Server nicht eingerichtet. Es wurde nichts gesendet.",
  NETZ: "Keine Verbindung. Prüfe das Internet und versuche es nochmals.",
  ZWEITER_FAKTOR_FEHLT:
    "Für die Verwaltung braucht es zuerst einen zweiten Faktor. Richte ihn ein und melde dich danach neu an.",
  INVALID_CODE: "Der Code stimmt nicht. Prüfe ihn und versuche es nochmals.",
  INVALID_BACKUP_CODE:
    "Der Ersatzcode stimmt nicht oder wurde schon verwendet.",
  INVALID_TWO_FACTOR_COOKIE:
    "Die Anmeldung ist abgelaufen. Bitte gib Benutzername und Passwort nochmals ein.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE:
    "Zu viele falsche Codes. Bitte gib Benutzername und Passwort nochmals ein.",
  TOTP_NOT_ENABLED: "Für dieses Konto ist kein zweiter Faktor eingerichtet.",
  BACKUP_CODES_NOT_ENABLED: "Für dieses Konto gibt es keine Ersatzcodes.",
};

// Texte sind Deutsch; Fehlercodes ohne eigenen Text zeigen die Meldung der API nur bei 409 (dort steht sie für Menschen)
export function fehlertext(fehler) {
  if (!(fehler instanceof ApiFehler))
    return "Etwas ist schiefgelaufen. Versuche es nochmals.";
  if (fehler.code && CODES[fehler.code]) return CODES[fehler.code];
  switch (fehler.status) {
    case 400:
      return "Die Eingabe passt nicht. Bitte prüfe die Felder.";
    case 401:
      return "Die Sitzung ist abgelaufen. Bitte melde dich neu an.";
    case 403:
      return "Dafür fehlt die Berechtigung.";
    case 404:
      return "Nicht gefunden. Vielleicht wurde der Eintrag inzwischen geändert oder gelöscht.";
    case 409:
      return (
        fehler.meldung ??
        "Das geht so nicht, weil es mit einem Eintrag kollidiert."
      );
    case 429: {
      const sekunden = Number(fehler.warten);
      const frist =
        sekunden > 0 ? ` in ${Math.ceil(sekunden / 60)} Min.` : " später";
      return `Zu viele Anfragen. Bitte versuche es${frist} nochmals.`;
    }
    case 502:
    case 503:
      return "Der Server antwortet nicht oder wird gerade neu gestartet. Versuche es in ein paar Minuten nochmals.";
    default:
      return "Der Server hat einen Fehler gemeldet. Versuche es nochmals.";
  }
}
