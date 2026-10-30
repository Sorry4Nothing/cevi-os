// Welche Daten Cevi OS bearbeitet: jede Spalte der Datenbank mit ihrer Kategorie, dazu Zweck und Frist je Kategorie.
// Ein Test hält diese Datei, das Drizzle-Schema und public/datenschutz.html zusammen (test/datenkategorien.test.ts).
// Die Angaben für Apple «App Privacy» und Google «Data safety» stammen aus derselben Datei; sie sind ein Vorschlag und werden vor dem Store-Eintrag gegen die aktuellen Formulare geprüft.

export type Kategorie = {
  titel: string;
  zweck: string;
  frist: string;
  // Datentypen der Formulare der Stores; leer heisst: keine Personendaten im Sinne des Formulars
  apple: string[];
  google: string[];
};

const AUF_ANFRAGE = "Auf Anfrage löscht die Leitung Daten.";

export const KATEGORIEN = {
  konto: {
    titel: "Konto und Anmeldung",
    zweck:
      "Anmelden, Rechte prüfen und das Konto vor Missbrauch schützen. Dazu gehört das Passwort, das nur als Prüfwert gespeichert ist.",
    frist: `Bis das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name", "Identifiers: User ID"],
    google: ["Personal info: Name", "Personal info: User IDs"],
  },
  telefon: {
    titel: "Telefonnummer der Stufenleitung",
    zweck:
      "Eltern erreichen die Stufenleitung ihrer Stufe. Die Nummer ist freiwillig.",
    frist: "Bis die Person die Nummer entfernt oder das Konto gelöscht wird.",
    apple: ["Contact Info: Phone Number"],
    google: ["Personal info: Phone number"],
  },
  kinder: {
    titel: "Kinder",
    zweck:
      "Die Eltern melden ihr Kind zu Programmen an oder ab, und die Leitung sieht, wer kommt.",
    frist: `Bis die Leitung den Eintrag löscht. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name"],
    google: ["Personal info: Name"],
  },
  rollen: {
    titel: "Rollen und Stufen",
    zweck: "Festlegen, wer welche Programme, Anmeldungen und Chats sehen darf.",
    frist: "Bis die Leitung die Rolle entfernt oder das Konto gelöscht wird.",
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  programme: {
    titel: "Programme",
    zweck:
      "Information über Zeit und Ort der Programme. Sie stammen aus dem Kalender der Abteilung.",
    frist:
      "Bis die Leitung das Programm löscht. Der Kalender der Abteilung bleibt unverändert.",
    apple: [],
    google: [],
  },
  anmeldungen: {
    titel: "Anmeldungen und Abmeldungen",
    zweck:
      "Zeigen, ob ein Kind zu einem Programm kommt (Ja oder Nein) und ob eine Leitungsperson dabei ist.",
    frist: `Bis die Leitung die Anmeldung, das Kind oder das Programm löscht. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["App activity: Other actions"],
  },
  chat: {
    titel: "Chats",
    zweck:
      "Austausch zwischen Eltern und Stufenleitung im Gruppenchat der Stufe und im Einzelchat mit der Stufenleitung.",
    frist: `Bis die Nachricht oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["User Content: Emails or Text Messages"],
    google: ["Messages: Other in-app messages"],
  },
  meldungen: {
    titel: "Meldungen",
    zweck:
      "Nachrichten prüfen, die jemand gemeldet hat. Die Meldung behält eine Kopie des Textes, damit der Beleg bleibt.",
    frist:
      "Die Kopie des Textes bleibt bis zur Erledigung der Meldung. Die Meldung selbst bleibt, bis die Leitung sie löscht.",
    apple: ["User Content: Emails or Text Messages"],
    google: ["Messages: Other in-app messages"],
  },
  benachrichtigungen: {
    titel: "Benachrichtigungen",
    zweck:
      "Pushes zu neuen Nachrichten und zu Änderungen an Programmen zustellen. Das Token gehört zum Gerät und zur Sitzung.",
    frist:
      "Bis die Sitzung endet, also beim Abmelden, beim Deaktivieren und beim Löschen des Kontos.",
    apple: ["Identifiers: Device ID"],
    google: ["Device or other IDs"],
  },
  technik: {
    titel: "Technische Daten",
    zweck:
      "Sitzungen führen, Anfragen begrenzen und Fehler finden. Dazu gehören IP-Adressen in den Logs und für die Begrenzung.",
    frist:
      "Logs 14 Tage. Die Begrenzung der Anfragen löscht ihre Einträge frühestens 15 Minuten nach der letzten Anfrage. Sitzungen enden nach 90 Tagen ohne Nutzung oder früher mit dem Abmelden.",
    apple: ["Diagnostics: Other Diagnostic Data"],
    google: ["App info and performance: Diagnostics"],
  },
  protokoll: {
    titel: "Protokoll der Verwaltung",
    zweck:
      "Nachvollziehen, welche Verwaltungsaktion wann auf wen oder was zielte. Das Protokoll enthält Kennungen, keine Namen.",
    frist: "Das Protokoll bleibt; es enthält keine Personendaten.",
    apple: [],
    google: [],
  },
  abteilung: {
    titel: "Angaben der Abteilung",
    zweck:
      "Die Abteilung, ihre Stufen, die Anbindung an den Kalender und der Text der Hilfe-Seite.",
    frist: "Bis die Leitung die Angaben ändert oder löscht.",
    apple: [],
    google: [],
  },
  // Die Tabelle blockierung stammt aus dem Datenmodell des Chats; die API hat keine Funktion dazu, und Blockieren gibt es nicht
  ungenutzt: {
    titel: "Ungenutzt",
    zweck: "Keine Funktion.",
    frist: "Keine Daten.",
    apple: [],
    google: [],
  },
} satisfies Record<string, Kategorie>;

export type KategorieId = keyof typeof KATEGORIEN;

// Tabelle -> Kategorie -> Spalten. Jede Spalte steht genau einmal da; ein Test scheitert bei einer neuen oder entfernten Spalte
export const SPALTEN: Record<string, Partial<Record<KategorieId, string[]>>> = {
  abteilung: {
    abteilung: [
      "id",
      "name",
      "google_kalender_id",
      "vertrauenspersonen",
      "sync_ok_am",
      "sync_fehler",
    ],
  },
  account: {
    konto: [
      "id",
      "account_id",
      "provider_id",
      "user_id",
      "access_token",
      "refresh_token",
      "id_token",
      "access_token_expires_at",
      "refresh_token_expires_at",
      "scope",
      "password",
      "created_at",
      "updated_at",
    ],
  },
  audit_log: {
    protokoll: [
      "id",
      "abteilung_id",
      "akteur_id",
      "aktion",
      "ziel_typ",
      "ziel_id",
      "details",
      "erstellt_am",
    ],
  },
  blockierung: { ungenutzt: ["user_id", "blockiert_id"] },
  chat: {
    chat: ["id", "abteilung_id", "typ", "stufe_id", "eltern_user_id"],
  },
  chat_status: { chat: ["chat_id", "user_id", "gelesen_bis"] },
  kind: {
    kinder: [
      "id",
      "abteilung_id",
      "vorname",
      "nachname",
      "stufe_id",
      "stufe_seit",
      "inaktiv_seit",
    ],
  },
  kind_eltern: { kinder: ["kind_id", "user_id", "erstellt_am"] },
  leitung_anmeldung: {
    anmeldungen: ["programm_id", "user_id", "status"],
  },
  meldung: {
    meldungen: [
      "id",
      "abteilung_id",
      "nachricht_id",
      "text_kopie",
      "autor_id",
      "gemeldet_von",
      "erstellt_am",
      "erledigt_von",
      "erledigt_am",
    ],
  },
  nachricht: {
    chat: [
      "id",
      "chat_id",
      "autor_id",
      "text",
      "programm_id",
      "erstellt_am",
      "ausgeblendet_von",
      "ausgeblendet_am",
    ],
  },
  programm: {
    programme: [
      "id",
      "abteilung_id",
      "google_event_id",
      "google_serie",
      "titel",
      "ganztaegig",
      "beginn",
      "ende",
      "tag_von",
      "tag_bis",
      "google_ort",
      "google_beschreibung",
      "status",
      "sichtbarkeit",
    ],
  },
  programm_stufe: { programme: ["programm_id", "stufe_id"] },
  push_token: {
    benachrichtigungen: [
      "session_id",
      "token",
      "user_id",
      "plattform",
      "zuletzt_gesehen",
    ],
  },
  rate_limit: { technik: ["id", "key", "count", "last_request"] },
  rolle: { rollen: ["user_id", "stufe_id", "typ", "erstellt_am"] },
  session: {
    technik: [
      "id",
      "expires_at",
      "token",
      "created_at",
      "updated_at",
      "ip_address",
      "user_agent",
      "user_id",
      "impersonated_by",
    ],
  },
  stufe: {
    abteilung: ["id", "abteilung_id", "name", "kuerzel", "reihenfolge"],
  },
  teilnahme: {
    anmeldungen: [
      "programm_id",
      "kind_id",
      "status",
      "geaendert_von",
      "geaendert_am",
    ],
  },
  two_factor: {
    konto: [
      "id",
      "secret",
      "backup_codes",
      "user_id",
      "verified",
      "failed_verification_count",
      "locked_until",
    ],
  },
  user: {
    konto: [
      "id",
      "name",
      "email",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
      "username",
      "display_username",
      "role",
      "banned",
      "ban_reason",
      "ban_expires",
      "two_factor_enabled",
      "abteilung_id",
      "muss_passwort_aendern",
      "startpasswort_gueltig_bis",
      "fehlversuche",
      "naechster_versuch_ab",
      "deaktiviert_am",
      "datenschutz_gelesen_am",
    ],
    telefon: ["telefon"],
    benachrichtigungen: ["push_chat", "push_programme"],
  },
  verification: {
    technik: [
      "id",
      "identifier",
      "value",
      "expires_at",
      "created_at",
      "updated_at",
    ],
  },
};

// Was die Apps auf dem Gerät ablegen (Schlüssel im geschützten Speicher des Systems) -> Kategorie. Die Apps liegen in eigenen Repos; wer dort einen Schlüssel ergänzt, ergänzt ihn auch hier
export const GERAET: Record<string, KategorieId> = {
  sitzung: "konto",
};

// Gilt für beide Stores, unabhängig von der Kategorie
export const STORE_ALLGEMEIN = {
  tracking: false,
  werbung: false,
  analyse: false,
  // Pushes tragen weder Nachrichtentext noch Kindernamen, nur den Namen eines Chats oder Programms
  weitergabeAn: ["Apple (Push)", "Google (Push)"],
  verschluesselteUebertragung: true,
  loeschungMoeglich: true,
};
