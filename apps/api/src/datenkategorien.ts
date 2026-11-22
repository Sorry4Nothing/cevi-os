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
      "Festlegen, wer welche Programme, Anmeldungen und Chats sehen darf. Tags (Stufe, Funktion, Team, Lager) ordnen Personen Gruppen zu. Bearbeitungsrechte und Plattformrollen legen fest, wer Inhalte ändern darf.",
    frist: "Bis die Leitung die Rolle entfernt oder das Konto gelöscht wird.",
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  programme: {
    titel: "Programme",
    zweck:
      "Information über Zeit und Ort der Programme. Sie stammen aus dem Kalender der Abteilung und von den Angaben, die die Stufenleitung pflegt.",
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
      "Die Abteilungsleitung legt Lager an und legt fest, wer im Lager mitarbeitet und mit welcher Rolle (Lagerleitung, Leitung, Team oder Lesen). Die Rolle bestimmt, was eine Person im Lager sehen und ändern darf. Die Lagerleitung und die Abteilungsleitung stellen ein, welche Rechte Leitung, Team und Lesen im Lager haben. Die Ressorts gliedern die Arbeit im Lager: Jedes hat eine Leitung und eine Stellvertretung, dazu Links und Notizen. Die Aufgaben halten fest, was im Lager zu tun ist, mit Status, Frist, Ressort, einer verantwortlichen Person und deren Unterstützung. Die Einkaufsliste hält fest, was fürs Lager eingekauft wird und wer es einkauft.",
    frist: `Bis die Leitung die Mitgliedschaft entfernt oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerTeilnehmende: {
    titel: "Teilnehmende im Lager",
    zweck:
      "Die Lagerleitung erfasst, wer am Lager teilnimmt, und das Team zählt im Lager ab, wer da ist. Gespeichert sind nur Vorname, Nachname, Stufe und ein freiwilliger Cevi-Name, keine Angaben zur Gesundheit, keine Telefonnummer und keine Adresse. Das Team sieht Vorname, Nachname und Stufe.",
    frist:
      "Sechs Monate nach dem Ende des Lagers löscht ein automatischer Lauf die Teilnehmenden und das Abzählen endgültig; im Protokoll der Verwaltung bleibt nur die Anzahl. Die Lagerleitung kann Einträge früher entfernen. Auf Anfrage löscht die Leitung Daten.",
    apple: ["Contact Info: Name"],
    google: ["Personal info: Name"],
  },
  lagerDatei: {
    titel: "Dateien im Lager (Verknüpfungen)",
    zweck:
      "Dateien, die im SharePoint der Abteilung liegen, im Lager auffindbar machen, zum Beispiel an einem Pinnwand-Beitrag oder einem Dokument. Cevi OS speichert nur den Link, den Anzeigenamen und, falls bekannt, Typ und Grösse, nie den Inhalt, und ruft den Link nie ab. Wer die Datei öffnen darf, regelt der Ablageort. Beim Eintrag steht, welches Konto ihn hinzugefügt hat. Die Abteilungsleitung kann festlegen, auf welchen Hosts die Links liegen dürfen. Eine Offline-Kopie legt nur die App an und nur, wenn die Person die Option in den Einstellungen der App einschaltet.",
    frist: `Bis die Leitung die Verknüpfung löscht oder das Lager gelöscht wird; ein Eintrag, den kein Datensatz einbindet, entfällt nach 24 Stunden. Die Datei am Ablageort bleibt immer. Mit dem Konto verschwindet nur die Angabe, wer den Eintrag hinzugefügt hat. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerPinnwand: {
    titel: "Pinnwand im Lager",
    zweck:
      "Mitteilungen an die Mitglieder eines Lagers: Titel, Text, ob eine Mitteilung wichtig oder angeheftet ist, von wann bis wann sie sichtbar ist, und an wen sie sich richtet (alle, eine Rolle oder einzelne Personen), dazu Verknüpfungen auf Dateien im SharePoint. Bei einem Beitrag steht, welches Konto ihn geschrieben hat. Der Server zeigt jeder Person nur die Beiträge, die zu ihr passen und im Zeitfenster liegen. Eine wichtige Mitteilung löst einen Push aus, der nur den Lagertitel nennt, nie den Inhalt.",
    frist: `Bis die Leitung den Beitrag löscht oder das Lager gelöscht wird. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerBenachrichtigung: {
    titel: "Benachrichtigungen im Lager",
    zweck:
      "Die Mitglieder eines Lagers über Neues im Lager informieren, zum Beispiel über eine zugeteilte Aufgabe oder eine wichtige Mitteilung. Die Benachrichtigung zeigt in der App eine Liste mit Art und Ziel, der Push nennt nur den Lagertitel. Jede Person schaltet jede Art selbst ab.",
    frist: `Gelesene Benachrichtigungen 90 Tage, ungelesene bis die Person das Lager verlässt oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerAnwesenheit: {
    titel: "Anwesenheit im Lager",
    zweck:
      "Planen, wer an welchem Tag und zu welcher Tageszeit im Lager ist, zum Beispiel für den Schichtplan und die Einkaufsmenge. Die Lagerleitung trägt für alle ein, das Team seine eigene Anwesenheit; eine Änderung eines eingetragenen Feldes stellt das Team als Anfrage an die Lagerleitung, die sie annimmt oder ablehnt. Ein Push über eine Anfrage oder ihren Entscheid nennt nur den Lagertitel.",
    frist: `Bis die Leitung die Anwesenheit löscht, das Lager gelöscht wird oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerNotfall: {
    titel: "Notfall-Kontakte im Lager",
    zweck:
      "Im Notfall die richtigen Personen sofort erreichen. Die Lagerleitung erfasst die Sicherheitsverantwortlichen und weitere Anlaufstellen mit Funktion und Telefonnummer, entweder als Konto des Lagers (die Nummer kommt aus dem Konto, solange keine eigene steht) oder als Name mit Nummer. Dazu kommen Leitung und Stellvertretung des Ressorts «si» und seiner Teilbereiche mit der Nummer aus ihrem Konto. Das Team sieht diese Kontakte mit Nummer, sonst nirgends im Lager eine Telefonnummer. Dazu speichert das Lager einen Link zur Lageradresse in einer Karten-App; der Server ruft keinen Kartendienst ab.",
    frist: `Bis die Lagerleitung den Kontakt löscht, das Lager gelöscht wird oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name", "Contact Info: Phone Number"],
    google: ["Personal info: Name", "Personal info: Phone number"],
  },
  lagerInfos: {
    titel: "Packliste und Infos im Lager",
    zweck:
      "Die Packliste und die Infos des Lagers bereitstellen. Die Lagerleitung pflegt die Vorlage der Packliste und die Info-Abschnitte (Text, Links und Verknüpfungen auf Dateien im SharePoint der Abteilung); einzelne Punkte und Abschnitte können der Lagerleitung vorbehalten sein. Jede Person hat ihre eigene Kopie der Packliste: Gespeichert sind nur ihre Abweichungen von der Vorlage (abgehakt, entfernt) und ihre eigenen Punkte, die nur sie sieht.",
    frist: `Die Vorlage und die Infos, bis die Lagerleitung sie löscht oder das Lager gelöscht wird. Die Abweichungen und eigenen Punkte einer Person, bis sie sie löscht, das Lager gelöscht wird oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  website: {
    titel: "Seiten der Website",
    zweck:
      "Die Seiten der Website der Abteilung aufbauen und verwalten: Adresse, Titel, Reihenfolge, wer sie sieht, und der Inhalt als Entwurf und als veröffentlichte Stände. Bei einem Stand steht, welches Konto ihn erstellt hat. Alte Adressen der Website leiten auf die neuen Seiten weiter; bei einer Weiterleitung steht, welches Konto sie angelegt hat.",
    frist:
      "Bis ein Webmaster die Seite oder die Weiterleitung löscht. Mit dem Konto verschwindet nur die Angabe, wer einen Stand oder eine Weiterleitung erstellt hat.",
    apple: [],
    google: [],
  },
  anlass: {
    titel: "Anlässe und ihre Zusatzfelder",
    zweck:
      "Die Abteilungsleitung macht aus einem Termin einen Anlass, zu dem sich Kinder oder Personen anmelden können, und legt fest, bis wann die Anmeldung offen ist, wer den Anlass sieht und welche Zusatzfragen die Anmeldung stellt (Text, Ja oder Nein, Auswahl). Die Fragen dürfen keine Gesundheitsdaten verlangen. Zum Anlass entsteht eine Seite der Website als Entwurf.",
    frist:
      "Bis die Abteilungsleitung den Anlass löscht; das geht nur, solange es keine Anmeldungen gibt. Die Seite der Website bleibt, bis die Redaktion sie löscht. Mit dem Konto verschwindet nur die Angabe, wer den Anlass angelegt hat.",
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

// Die Spalten, die lagerSpalten() (db/schema-lager.ts) jeder Lager-Tabelle mitgibt (#366); ein Modul schreibt { lager: [...LAGER_BASIS_SPALTEN, "eigene", ...] }
export const LAGER_BASIS_SPALTEN = [
  "id",
  "lager_id",
  "version",
  "erstellt_am",
  "erstellt_von",
  "geaendert_am",
  "geaendert_von",
  "geloescht_am",
  "geloescht_von",
  "lager_seq",
];

// Tabelle -> Kategorie -> Spalten. Jede Spalte steht genau einmal da; ein Test scheitert bei einer neuen oder entfernten Spalte
export const SPALTEN: Record<string, Partial<Record<KategorieId, string[]>>> = {
  abteilung: {
    abteilung: [
      "id",
      "name",
      "google_kalender_id",
      "sync_ok_am",
      "sync_fehler",
      "datei_hosts",
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
  // Anlässe (#442): Einstellungen und Fragen der Anmeldung, keine Antworten; wer ihn angelegt hat, steht in erstellt_von
  anlass: {
    anlass: [
      "id",
      "abteilung_id",
      "programm_id",
      "art",
      "anmeldung_offen",
      "frist",
      "anmeldung_fuer",
      "sichtbarkeit",
      "sichtbarkeit_tags",
      "seite_id",
      "erstellt_von",
      "erstellt_am",
    ],
  },
  anlass_feld: {
    anlass: [
      "id",
      "anlass_id",
      "schluessel",
      "beschriftung",
      "typ",
      "optionen",
      "pflicht",
      "reihenfolge",
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
      "kategorien",
      "ort",
    ],
  },
  programm_tag: { programme: ["programm_id", "tag_id"] },
  kategorie_zuordnung: {
    programme: ["id", "abteilung_id", "kategorie", "tag_id"],
  },
  programm_eckdaten: {
    programme: [
      "stufe_id",
      "tag",
      "treff_zeit",
      "treffpunkt",
      "schluss_ort",
      "schluss_zeit",
      "mitnehmen",
      "abgerufen_am",
      "quelle",
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
      "anwesenheit_frist",
      "logo_medium_id",
      "seq",
      "seq_min",
      "erstellt_am",
    ],
    lagerNotfall: ["karten_link"],
  },
  // Der Änderungsfeed (#366) hält nur Art, Tabelle, Zeilen-ID, Version und Zeitpunkt einer Änderung, keine Inhalte und keine Person
  lager_aenderung: {
    lager: [
      "lager_id",
      "seq",
      "tabelle",
      "zeile_id",
      "art",
      "version",
      "zeitpunkt",
    ],
  },
  // Die Warteschlange für Offline-Änderungen (#367) hält je Operation das Ergebnis: IDs und Versionen, bei einem Konflikt nicht gespeichert
  lager_client_op: {
    lager: ["lager_id", "person_id", "client_op_id", "ergebnis", "erstellt_am"],
  },
  lager_mitglied: {
    lager: ["lager_id", "person_id", "rolle", "ressort_id", "erstellt_am"],
  },
  lager_rolle_recht: { lager: ["lager_id", "rolle", "recht", "erlaubt"] },
  lager_datei: {
    lagerDatei: [
      ...LAGER_BASIS_SPALTEN,
      "anzeigename",
      "link",
      "typ",
      "groesse",
    ],
  },
  // Ressorts (#371): Leitung und Stellvertretung als Personen-IDs, die Notiz nennt über erstellt_von, wer sie schrieb
  ressort: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "kuerzel",
      "name",
      "leitung_person_id",
      "stv_person_id",
      "notiz",
      "parent_id",
      "reihenfolge",
    ],
  },
  ressort_link: {
    lager: [...LAGER_BASIS_SPALTEN, "ressort_id", "titel", "url"],
  },
  ressort_notiz: {
    lager: [...LAGER_BASIS_SPALTEN, "ressort_id", "text"],
  },
  // Einkaufsliste (#392): wer einkauft, steht als Personen-ID (Mitglied des Lagers). Stamm und Vorschläge sind Daten je Artikelname, ohne Person
  einkauf_artikel: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "name",
      "name_norm",
      "menge",
      "einheit",
      "warengruppe",
      "einkaeufer_person_id",
      "erledigt",
    ],
  },
  einkauf_artikelstamm: { lager: ["lager_id", "name_norm", "warengruppe"] },
  einkauf_vorschlag: {
    lager: ["lager_id", "name_norm", "name", "haeufigkeit"],
  },
  // Aufgaben (#372): Verantwortliche und Unterstützung als Personen-IDs; erledigt_am setzt der Server mit dem Status
  aufgabe: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "ressort_id",
      "teil",
      "verantwortlich_person_id",
      "status",
      "notiz",
      "frist",
      "stern",
      "laufend",
      "spaeter_ab",
      "wiederholung",
      "reihenfolge",
      "quelle",
      "erledigt_am",
      "frist_erinnert_am",
    ],
  },
  aufgabe_unterstuetzung: {
    lager: ["lager_id", "aufgabe_id", "person_id"],
  },
  // Anwesenheit (#390): Leitende als Konto, Teilnehmende als ID; die Anfrage nennt, wer sie stellte und wer entschied
  anwesenheit: {
    lagerAnwesenheit: [
      ...LAGER_BASIS_SPALTEN,
      "person_id",
      "teilnehmer_id",
      "lagertag_id",
      "tagesabschnitt_id",
      "wert",
    ],
  },
  anwesenheit_anfrage: {
    lagerAnwesenheit: [
      ...LAGER_BASIS_SPALTEN,
      "person_id",
      "lagertag_id",
      "tagesabschnitt_id",
      "wert",
      "notiz",
      "status",
      "entschieden_von",
      "entschieden_am",
    ],
  },
  // Pinnwand (#381): Empfänger als Rolle oder Personen-ID; die Dateien sind Verweise auf lager_datei
  pinnwand_beitrag: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "text",
      "wichtig",
      "angeheftet",
      "sichtbar_ab",
      "sichtbar_bis",
    ],
  },
  pinnwand_empfaenger: {
    lagerPinnwand: ["id", "lager_id", "beitrag_id", "rolle", "person_id"],
  },
  pinnwand_datei: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "beitrag_id",
      "datei_id",
      "reihenfolge",
    ],
  },
  // Teilnehmende und Abzählen (#384): nur Name und Stufe; kind_id und anmeldung_id sind die spätere Verknüpfung zum Kind und zur Anmeldung, über die API noch nicht gesetzt
  teilnehmer: {
    lagerTeilnehmende: [
      ...LAGER_BASIS_SPALTEN,
      "kind_id",
      "anmeldung_id",
      "vorname",
      "nachname",
      "cevi_name",
      "stufe",
    ],
  },
  // Ein Haken je Teilnehmende oder Mitglied des Lagers (Team)
  abzaehlen: {
    lagerTeilnehmende: [
      ...LAGER_BASIS_SPALTEN,
      "teilnehmer_id",
      "person_id",
      "geprueft",
      "geprueft_am",
    ],
  },
  // Packliste, Notfall und Infos (#393): Telefonnummern stehen nur bei den Notfall-Kontakten (oder im Konto, aus dem sie kommen); die Abweichungen und eigenen Punkte der Packliste gehören einer Person und sehen nur sie
  packliste_punkt: {
    lagerInfos: [
      ...LAGER_BASIS_SPALTEN,
      "abschnitt",
      "text",
      "nur_lagerleitung",
      "reihenfolge",
    ],
  },
  packliste_abhaken: {
    lagerInfos: [
      "lager_id",
      "person_id",
      "punkt_id",
      "zustand",
      "geaendert_am",
    ],
  },
  packliste_eigen: {
    lagerInfos: [
      "id",
      "lager_id",
      "person_id",
      "abschnitt",
      "text",
      "abgehakt",
      "reihenfolge",
      "erstellt_am",
    ],
  },
  notfall_kontakt: {
    lagerNotfall: [
      ...LAGER_BASIS_SPALTEN,
      "funktion",
      "person_id",
      "name",
      "telefon",
      "reihenfolge",
    ],
  },
  info_abschnitt: {
    lagerInfos: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "text",
      "links",
      "nur_lagerleitung",
      "notfall",
      "reihenfolge",
    ],
  },
  info_abschnitt_datei: {
    lagerInfos: [...LAGER_BASIS_SPALTEN, "abschnitt_id", "datei_id"],
  },
  lager_benachrichtigung: {
    lagerBenachrichtigung: [
      "id",
      "lager_id",
      "person_id",
      "art",
      "objekt_typ",
      "objekt_id",
      "gelesen_am",
      "erstellt_am",
    ],
  },
  lager_benachrichtigung_einstellung: {
    lagerBenachrichtigung: ["person_id", "art", "aktiv"],
  },
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
  plattform_rolle: {
    rollen: ["id", "abteilung_id", "name", "schluessel", "erstellt_am"],
  },
  plattform_rolle_recht: {
    rollen: ["rolle_id", "recht"],
  },
  person_plattform_rolle: {
    rollen: ["user_id", "rolle_id", "erstellt_am"],
  },
  plattform_entwickler: {
    rollen: ["user_id", "erstellt_am"],
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
      "ausgabe_hash",
      "ausgabe_am",
    ],
  },
  seite_version: {
    website: ["id", "seite_id", "nr", "inhalt", "autor_id", "erstellt_am"],
  },
  weiterleitung: {
    website: [
      "id",
      "abteilung_id",
      "alter_pfad",
      "ziel_pfad",
      "status",
      "erstellt_von",
      "erstellt_am",
    ],
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
