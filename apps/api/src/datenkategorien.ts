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
  profilbild: {
    titel: "Profilbild",
    zweck:
      "Andere Personen erkennen, wer schreibt oder wen sie erreichen. Das Bild ist freiwillig, und jede Person lädt nur ihr eigenes hoch.",
    frist:
      "Bis die Person das Bild löscht oder das Konto deaktiviert oder gelöscht wird. Von Kindern gibt es nie ein Bild.",
    apple: ["User Content: Photos or Videos"],
    google: ["Photos and videos: Photos"],
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
    titel: "Rollen, Stufen und Tags",
    zweck:
      "Festlegen, wer welche Programme, Anmeldungen und Chats sehen darf. Tags (Stufe, Funktion, Team, Lager) ordnen Personen Gruppen zu. Bearbeitungsrechte legen fest, wer Inhalte ändern darf.",
    frist: "Bis die Leitung die Rolle entfernt oder das Konto gelöscht wird.",
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  programme: {
    titel: "Programme",
    zweck:
      "Information über Zeit und Ort der Programme. Sie stammen aus dem Kalender der Abteilung und von der Webseite der Stufen.",
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
  anwesenheit: {
    titel: "Anwesenheit",
    zweck:
      "Die Leitung hält fest, wer bei einem Programm da war, und sieht pro Stufe, wie oft jemand kam.",
    frist: `Bis die Leitung den Eintrag, das Kind oder das Programm löscht. ${AUF_ANFRAGE}`,
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
  benachrichtigungen: {
    titel: "Benachrichtigungen",
    zweck:
      "Pushes zu neuen Nachrichten, zu An- und Abmeldungen und zu Erinnerungen zustellen. Das Token gehört zum Gerät und zur Sitzung.",
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
      "Die Abteilung, ihre Stufen (mit freiwilligem Logo) und die Anbindung an den Kalender.",
    frist: "Bis die Leitung die Angaben ändert oder löscht.",
    apple: [],
    google: [],
  },
  medien: {
    titel: "Medien",
    zweck:
      "Bilder und PDFs der Abteilung bereitstellen, zum Beispiel für die Webseite. Nur die Leitung lädt sie hoch. Wer ein Medium sehen darf, legt die Leitung beim Hochladen fest.",
    frist:
      "Bis die Leitung das Medium löscht. Mit dem Konto verschwindet nur die Angabe, wer es hochgeladen hat.",
    apple: ["User Content: Photos or Videos"],
    google: ["Photos and videos: Photos"],
  },
  lager: {
    titel: "Lager und Lagermitglieder",
    zweck:
      "Die Abteilungsleitung legt Lager an und legt fest, wer im Lager mitarbeitet und mit welcher Rolle (Lagerleitung, Leitung, Team oder Lesen). Die Rolle bestimmt, was eine Person im Lager sehen und ändern darf. Die Lagerleitung und die Abteilungsleitung stellen ein, welche Rechte Leitung, Team und Lesen im Lager haben.",
    frist: `Bis die Leitung die Mitgliedschaft entfernt oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  website: {
    titel: "Seiten der Website",
    zweck:
      "Die Seiten der Website der Abteilung aufbauen und verwalten: Adresse, Titel, Reihenfolge, wer sie sieht, und der Inhalt als Entwurf und als veröffentlichte Stände. Bei einem Stand steht, welches Konto ihn erstellt hat.",
    frist:
      "Bis die Redaktion die Seite löscht. Mit dem Konto verschwindet nur die Angabe, wer einen Stand erstellt hat.",
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
      "cevi_name",
      "stufe_id",
      "stufe_seit",
      "inaktiv_seit",
    ],
  },
  kind_eltern: { kinder: ["kind_id", "user_id", "erstellt_am"] },
  leitung_anmeldung: {
    anmeldungen: ["programm_id", "user_id", "status"],
  },
  medium: {
    medien: [
      "id",
      "abteilung_id",
      "mime_typ",
      "groesse",
      "breite",
      "hoehe",
      "alt_text",
      "dekorativ",
      "sichtbarkeit",
      "speicher_schluessel",
      "hochgeladen_von",
      "erstellt_am",
    ],
  },
  nachricht: {
    chat: ["id", "chat_id", "autor_id", "text", "programm_id", "erstellt_am"],
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
      "status",
      "sichtbarkeit",
    ],
  },
  programm_eckdaten: {
    programme: [
      "stufe_id",
      "tag",
      "treffpunkt",
      "schluss_ort",
      "schluss_zeit",
      "mitnehmen",
      "abgerufen_am",
    ],
  },
  programm_stufe: { programme: ["programm_id", "stufe_id"] },
  profilbild: { profilbild: ["user_id", "inhalt", "geaendert_am"] },
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
  // Seit Migration 0035 (#332) sind «rolle» und «stufe» Sichten auf person_tag und tag; die Daten stehen dort, die Einträge bleiben für die Spalten, die die Sichten den Routen zeigen
  rolle: {
    rollen: ["user_id", "stufe_id", "typ", "prioritaet", "erstellt_am"],
  },
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
    abteilung: ["id", "abteilung_id", "name", "kuerzel"],
  },
  stufenlogo: { abteilung: ["stufe_id", "inhalt", "geaendert_am"] },
  // Tags vom Typ «stufe» sind die Stufen der Abteilung (Kategorie «abteilung», kein Personenbezug); alle anderen Tags gehören zu «rollen»
  tag: { rollen: ["id", "abteilung_id", "typ", "name", "kuerzel"] },
  person_tag: {
    rollen: ["user_id", "tag_id", "rolle", "prioritaet", "erstellt_am"],
  },
  // Das Lager hat keinen Personenbezug ausser seiner Adresse und den Mitgliedern
  lager: {
    lager: [
      "id",
      "abteilung_id",
      "anlass_id",
      "titel",
      "von",
      "bis",
      "vorbereitung_ab",
      "ort",
      "adresse",
      "status",
      "uebung",
      "farbe",
      "logo_medium_id",
      "erstellt_am",
    ],
  },
  lager_mitglied: {
    lager: ["lager_id", "person_id", "rolle", "ressort_id", "erstellt_am"],
  },
  lager_rolle_recht: { lager: ["lager_id", "rolle", "recht", "erlaubt"] },
  bearbeiter: {
    rollen: [
      "id",
      "abteilung_id",
      "objekt_typ",
      "objekt_id",
      "user_id",
      "tag_id",
      "erstellt_am",
    ],
  },
  seite: {
    website: [
      "id",
      "abteilung_id",
      "eltern_id",
      "adresse",
      "titel",
      "reihenfolge",
      "sichtbarkeit",
      "sichtbarkeit_tags",
      "tag_id",
      "herkunft",
      "veroeffentlichte_version_id",
      "entwurf",
      "entwurf_zaehler",
      "erstellt_am",
      "geaendert_am",
    ],
  },
  seite_version: {
    website: ["id", "seite_id", "nr", "inhalt", "autor_id", "erstellt_am"],
  },
  anwesenheit_kind: {
    anwesenheit: ["programm_id", "kind_id", "da", "erfasst_von", "erfasst_am"],
  },
  anwesenheit_leitung: {
    anwesenheit: ["programm_id", "user_id", "da", "erfasst_von", "erfasst_am"],
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
      "cevi_name",
      "role",
      "banned",
      "ban_reason",
      "ban_expires",
      "two_factor_enabled",
      "abteilung_id",
      "muss_passwort_aendern",
      "startpasswort_gueltig_bis",
      "startpasswort_verschluesselt",
      "fehlversuche",
      "naechster_versuch_ab",
      "deaktiviert_am",
      "datenschutz_gelesen_am",
    ],
    telefon: ["telefon"],
    benachrichtigungen: ["push_chat", "push_programme", "push_anmeldungen"],
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
  zeitregel: {
    benachrichtigungen: [
      "id",
      "abteilung_id",
      "stufe_id",
      "wochentag",
      "uhrzeit",
      "text",
      "beschreibung",
      "aktiv",
      "erstellt_am",
    ],
  },
  zeitregel_gesendet: {
    benachrichtigungen: ["regel_id", "programm_id", "gesendet_am"],
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
  // Pushes tragen weder Chat-Inhalt noch Kindernamen, nur den Namen eines Chats oder Programms und den Text der Admins
  weitergabeAn: ["Apple (Push)", "Google (Push)"],
  verschluesselteUebertragung: true,
  loeschungMoeglich: true,
};
