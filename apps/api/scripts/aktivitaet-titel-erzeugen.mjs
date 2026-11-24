// Erzeugt src/aktivitaet-titel.ts aus docs/api/openapi.yaml (#637, #662): zu jeder schreibenden Operation der Klartext für das Änderungsprotokoll: Titel (die Zusammenfassung der OpenAPI), Objekt («Anlass»), Aktion («gelöscht»), Gruppe der Aktion (für den Filter) und ob die Route überhaupt erfasst wird.
// Aufruf: node scripts/aktivitaet-titel-erzeugen.mjs  (test/aktivitaet-titel.test.ts prüft, dass die Datei dazu passt und dass jede schreibende Route vollständig beschrieben ist)
// Neue Route, die hier nicht aufgeht: Der Lauf bricht mit der Liste der Zusammenfassungen ab, die kein Verb am Ende haben. Dann in AUSNAHMEN einen Eintrag ergänzen.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { parse } from "yaml";

const wurzel = new URL("../../../", import.meta.url);
const openapi = parse(
  readFileSync(new URL("docs/api/openapi.yaml", wurzel), "utf8"),
);
// Alle Parameter heissen im Schlüssel gleich: Hono nennt sie :id, :kontaktId, OpenAPI {id}, {kontaktId}; verglichen wird ohne Namen
const schluessel = (methode, pfad) =>
  `${methode.toUpperCase()} ${pfad.replace(/\{[^}]+\}|:[A-Za-z0-9_]+/g, ":p")}`;

// Gruppen der Aktion: Der Filter der Verwaltung fragt nach ihnen
export const GRUPPEN = [
  "angelegt",
  "geaendert",
  "geloescht",
  "zugeordnet",
  "entzogen",
  "veroeffentlicht",
  "zurueckgezogen",
  "status",
  "gesendet",
  "entschieden",
];

// Letztes Wort der Zusammenfassung → [Partizip, Gruppe]
const VERBEN = {
  anlegen: ["angelegt", "angelegt"],
  erstellen: ["erstellt", "angelegt"],
  erzeugen: ["erzeugt", "angelegt"],
  hinzufügen: ["hinzugefügt", "angelegt"],
  hochladen: ["hochgeladen", "angelegt"],
  erfassen: ["erfasst", "angelegt"],
  eintragen: ["eingetragen", "angelegt"],
  vorschlagen: ["vorgeschlagen", "angelegt"],
  anfragen: ["angefragt", "angelegt"],
  bestellen: ["bestellt", "angelegt"],
  importieren: ["importiert", "angelegt"],
  einrichten: ["eingerichtet", "angelegt"],
  hängen: ["angehängt", "angelegt"],
  ändern: ["geändert", "geaendert"],
  setzen: ["gesetzt", "geaendert"],
  festlegen: ["festgelegt", "geaendert"],
  speichern: ["gespeichert", "geaendert"],
  ersetzen: ["ersetzt", "geaendert"],
  umbenennen: ["umbenannt", "geaendert"],
  ordnen: ["geordnet", "geaendert"],
  umstellen: ["umgestellt", "geaendert"],
  pflegen: ["gepflegt", "geaendert"],
  hinterlegen: ["hinterlegt", "geaendert"],
  festhalten: ["festgehalten", "geaendert"],
  markieren: ["markiert", "geaendert"],
  abhaken: ["abgehakt", "geaendert"],
  zurücksetzen: ["zurückgesetzt", "geaendert"],
  zurückholen: ["zurückgeholt", "geaendert"],
  übernehmen: ["übernommen", "geaendert"],
  zusammenführen: ["zusammengeführt", "geaendert"],
  abgleichen: ["abgeglichen", "geaendert"],
  anstossen: ["angestossen", "geaendert"],
  melden: ["gemeldet", "geaendert"],
  löschen: ["gelöscht", "geloescht"],
  entfernen: ["entfernt", "geloescht"],
  zurücknehmen: ["zurückgenommen", "geloescht"],
  stornieren: ["storniert", "geloescht"],
  nehmen: ["entfernt", "geloescht"],
  widerrufen: ["widerrufen", "geloescht"],
  aufheben: ["aufgehoben", "geloescht"],
  zuordnen: ["zugeordnet", "zugeordnet"],
  zuweisen: ["zugewiesen", "zugeordnet"],
  vergeben: ["vergeben", "zugeordnet"],
  einteilen: ["eingeteilt", "zugeordnet"],
  besetzen: ["besetzt", "zugeordnet"],
  zuwählen: ["zugewählt", "zugeordnet"],
  entziehen: ["entzogen", "entzogen"],
  veröffentlichen: ["veröffentlicht", "veroeffentlicht"],
  zurückziehen: ["zurückgezogen", "zurueckgezogen"],
  sperren: ["gesperrt", "status"],
  entsperren: ["entsperrt", "status"],
  aktivieren: ["aktiviert", "status"],
  deaktivieren: ["deaktiviert", "status"],
  senden: ["gesendet", "gesendet"],
  entscheiden: ["entschieden", "entschieden"],
  ablehnen: ["abgelehnt", "entschieden"],
  annehmen: ["angenommen", "entschieden"],
};

// Zusammenfassungen, die das Verb nicht am Ende tragen oder deren Objekt zu lang oder unklar wäre: [Objekt, Partizip, Gruppe]
const AUSNAHMEN = {
  "POST /api/auth/change-password": [
    "Eigenes Passwort",
    "geändert",
    "geaendert",
  ],
  "POST /api/auth/revoke-sessions": [
    "Alle Sitzungen einer Person",
    "beendet",
    "geloescht",
  ],
  "POST /api/auth/two-factor/enable": [
    "Zweiter Faktor",
    "eingerichtet",
    "angelegt",
  ],
  "POST /api/auth/sign-in/username": ["Anmeldung", "durchgeführt", "status"],
  "POST /api/auth/sign-out": ["Abmeldung", "durchgeführt", "status"],
  "POST /api/auth/two-factor/verify-totp": [
    "Zweiter Faktor",
    "geprüft",
    "status",
  ],
  "POST /api/auth/two-factor/verify-backup-code": [
    "Ersatzcode",
    "geprüft",
    "status",
  ],
  "PATCH /api/v1/ich": ["Eigene Einstellungen", "geändert", "geaendert"],
  "POST /api/v1/ich/datenschutz": [
    "Kenntnisnahme der Datenschutzerklärung",
    "festgehalten",
    "geaendert",
  ],
  "PUT /api/v1/ich/lager-benachrichtigungen": [
    "Lager-Benachrichtigungen",
    "eingestellt",
    "geaendert",
  ],
  "PUT /api/v1/push-token": ["Push-Token", "hinterlegt", "geaendert"],
  "PUT /api/v1/stufen/:p/anwesenheit/:p/kinder/:p": [
    "Anwesenheit eines Kindes",
    "eingetragen",
    "geaendert",
  ],
  "PUT /api/v1/stufen/:p/anwesenheit/:p/leitende/:p": [
    "Anwesenheit einer Leitungsperson",
    "eingetragen",
    "geaendert",
  ],
  "PUT /api/v1/plattform/schalter": [
    "Wartungsmodus oder Informationssperre",
    "gesetzt",
    "status",
  ],
  "DELETE /api/v1/plattform/schalter": [
    "Wartungsmodus oder Informationssperre",
    "aufgehoben",
    "status",
  ],
  "PUT /api/v1/programme/:p/teilnahmen/:p": [
    "Teilnahme eines Kindes",
    "gemeldet",
    "geaendert",
  ],
  "PUT /api/v1/programme/:p/leitung": [
    "Anmeldung als Leitung",
    "gemeldet",
    "geaendert",
  ],
  "POST /api/v1/chats/direkt": ["Einzelchat", "geöffnet", "angelegt"],
  "POST /api/v1/chats/:p/nachrichten": [
    "Chat-Nachricht",
    "gesendet",
    "gesendet",
  ],
  "PUT /api/v1/chats/:p/gelesen": ["Chat", "als gelesen markiert", "geaendert"],
  "POST /api/v1/admin/personen": ["Person", "angelegt", "angelegt"],
  "PATCH /api/v1/admin/personen/:p": ["Person", "geändert", "geaendert"],
  "POST /api/v1/admin/personen/:p/startpasswort": [
    "Startpasswort einer Person",
    "erneuert",
    "geaendert",
  ],
  "POST /api/v1/admin/personen/:p/aktivieren": [
    "Person",
    "aktiviert",
    "status",
  ],
  "POST /api/v1/admin/personen/:p/zweiter-faktor-zuruecksetzen": [
    "Zweiter Faktor einer Person",
    "zurückgesetzt",
    "geaendert",
  ],
  "DELETE /api/v1/admin/personen/:p/bild": [
    "Profilbild einer Person",
    "entfernt",
    "geloescht",
  ],
  "POST /api/v1/admin/system/syncs/kalender": [
    "Kalender-Sync",
    "angestossen",
    "geaendert",
  ],
  "POST /api/v1/admin/mitteilungen": ["Mitteilung", "gesendet", "gesendet"],
  "POST /api/v1/admin/fotos/verbindung": [
    "Verbindung zu Flickr",
    "geprüft",
    "status",
  ],
  "POST /api/v1/admin/mitteilungen/vorschau": [
    "Mitteilung",
    "geprüft",
    "status",
  ],
  "PUT /api/v1/admin/stufen/:p/stufenleitung": [
    "Reihenfolge der Stufenleitung",
    "festgelegt",
    "geaendert",
  ],
  "PUT /api/v1/admin/stufen/:p/logo": [
    "Logo einer Stufe",
    "hochgeladen",
    "angelegt",
  ],
  "DELETE /api/v1/admin/stufen/:p/logo": [
    "Logo einer Stufe",
    "gelöscht",
    "geloescht",
  ],
  "POST /api/v1/admin/import": [
    "Kinder und Leitende",
    "importiert",
    "angelegt",
  ],
  "POST /api/v1/admin/import/vorschau": ["Import", "geprüft", "status"],
  "POST /api/v1/admin/cevi-db/pruefen": [
    "Verbindung zur Cevi-Datenbank",
    "geprüft",
    "status",
  ],
  "PUT /api/v1/admin/kinder/konto-einstellung": [
    "Einstellungen der Kinderkonten",
    "gespeichert",
    "geaendert",
  ],
  "POST /api/v1/admin/kinder/:p/konto": [
    "Konto eines Kindes",
    "erstellt",
    "angelegt",
  ],
  "PATCH /api/v1/admin/kinder/:p/konto": [
    "Einsicht der Eltern am Konto eines Kindes",
    "geändert",
    "geaendert",
  ],
  "DELETE /api/v1/admin/kinder/:p/konto": [
    "Konto eines Kindes",
    "entfernt",
    "geloescht",
  ],
  "POST /api/v1/admin/kinder/:p/konto/startpasswort": [
    "Startpasswort eines Kindeskontos",
    "erneuert",
    "geaendert",
  ],
  "POST /api/v1/admin/kinder/:p/konto/sperren": [
    "Konto eines Kindes",
    "gesperrt",
    "status",
  ],
  "POST /api/v1/admin/kinder/:p/konto/entsperren": [
    "Konto eines Kindes",
    "entsperrt",
    "status",
  ],
  "PATCH /api/v1/admin/tags/:p": ["Tag", "umbenannt", "geaendert"],
  "PUT /api/v1/admin/tags/:p/personen/:p": [
    "Tag einer Person",
    "zugewiesen",
    "zugeordnet",
  ],
  "DELETE /api/v1/admin/tags/:p/personen/:p": [
    "Tag einer Person",
    "entzogen",
    "entzogen",
  ],
  "POST /api/v1/admin/bearbeiter": [
    "Bearbeitungsrecht",
    "vergeben",
    "zugeordnet",
  ],
  "DELETE /api/v1/admin/bearbeiter/:p": [
    "Bearbeitungsrecht",
    "entzogen",
    "entzogen",
  ],
  "POST /api/v1/admin/rechte/gruppen/:p/rollen": [
    "Rolle einer Gruppe",
    "angelegt",
    "angelegt",
  ],
  "PATCH /api/v1/admin/rechte/gruppen/:p/rollen/:p": [
    "Rolle einer Gruppe",
    "geändert",
    "geaendert",
  ],
  "DELETE /api/v1/admin/rechte/gruppen/:p/rollen/:p": [
    "Rolle einer Gruppe",
    "gelöscht",
    "geloescht",
  ],
  "POST /api/v1/admin/rechte/gruppen/:p/rollen/vorschau": [
    "Rolle",
    "geprüft",
    "status",
  ],
  "PUT /api/v1/admin/rechte/gruppen/:p/personen/:p/rolle": [
    "Rolle einer Person in der Gruppe",
    "zugeordnet",
    "zugeordnet",
  ],
  "POST /api/v1/admin/rechte/rollen": ["Globale Rolle", "angelegt", "angelegt"],
  "PATCH /api/v1/admin/rechte/rollen/:p": [
    "Globale Rolle",
    "geändert",
    "geaendert",
  ],
  "DELETE /api/v1/admin/rechte/rollen/:p": [
    "Globale Rolle",
    "gelöscht",
    "geloescht",
  ],
  "PATCH /api/v1/admin/plattform/rollen/:p": [
    "Plattformrolle",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/admin/plattform/rollen/:p/personen/:p": [
    "Plattformrolle einer Person",
    "zugewiesen",
    "zugeordnet",
  ],
  "DELETE /api/v1/admin/plattform/rollen/:p/personen/:p": [
    "Plattformrolle einer Person",
    "entzogen",
    "entzogen",
  ],
  "PATCH /api/v1/redaktion/seiten/:p": [
    "Struktur einer Seite",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/redaktion/seiten/:p/entwurf": [
    "Entwurf einer Seite",
    "gespeichert",
    "geaendert",
  ],
  "POST /api/v1/redaktion/seiten/:p/veroeffentlichen": [
    "Seite",
    "veröffentlicht",
    "veroeffentlicht",
  ],
  "POST /api/v1/redaktion/seiten/:p/zurueckziehen": [
    "Seite",
    "zurückgezogen",
    "zurueckgezogen",
  ],
  "POST /api/v1/redaktion/seiten/:p/versionen/:p/zurueckholen": [
    "Frühere Version einer Seite",
    "zurückgeholt",
    "geaendert",
  ],
  "POST /api/v1/redaktion/seiten/aus-vorlage": [
    "Seite aus einer Vorlage",
    "angelegt",
    "angelegt",
  ],
  "PATCH /api/v1/admin/lager/:p": ["Lager", "geändert", "geaendert"],
  "PUT /api/v1/admin/lager/:p/mitglieder/:p": [
    "Mitglied eines Lagers",
    "gesetzt",
    "zugeordnet",
  ],
  "PUT /api/v1/lager/:p/rechte": [
    "Rechte der Lagerrollen",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/admin/lager/:p/rechte": [
    "Rechte der Lagerrollen",
    "geändert",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/rechte/zuruecksetzen": [
    "Rechte der Lagerrollen",
    "zurückgesetzt",
    "geaendert",
  ],
  "POST /api/v1/admin/lager/:p/rechte/zuruecksetzen": [
    "Rechte der Lagerrollen",
    "zurückgesetzt",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/benachrichtigungen/gelesen": [
    "Benachrichtigungen",
    "als gelesen markiert",
    "geaendert",
  ],
  "PATCH /api/v1/redaktion/medien/:p": [
    "Alt-Text eines Bildes",
    "geändert",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/aenderungen": [
    "Offline gesammelte Änderungen",
    "übernommen",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/dateien": [
    "Datei-Verknüpfung",
    "hinzugefügt",
    "angelegt",
  ],
  "DELETE /api/v1/lager/:p/dateien/:p": [
    "Datei-Verknüpfung",
    "gelöscht",
    "geloescht",
  ],
  "PUT /api/v1/admin/lager-dateien/hosts": [
    "Erlaubte Hosts für Datei-Links",
    "festgelegt",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/aufgaben/:p/status": [
    "Status einer Aufgabe",
    "gesetzt",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/aufgaben/:p/checkliste/reihenfolge": [
    "Checkliste einer Aufgabe",
    "neu geordnet",
    "geaendert",
  ],
  "PATCH /api/v1/lager/:p/aufgaben/:p/checkliste/:p": [
    "Checkpunkt",
    "geändert",
    "geaendert",
  ],
  "PATCH /api/v1/lager/:p/todos/:p": [
    "Privates To-do",
    "geändert",
    "geaendert",
  ],
  "PATCH /api/v1/lager/:p/check/punkte/:p": [
    "Eigener Check-Punkt",
    "geändert",
    "geaendert",
  ],
  "PATCH /api/v1/lager/:p/packliste/eigene/:p": [
    "Eigener Punkt der Packliste",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/aufgaben/:p/stichworte": [
    "Stichworte einer Aufgabe",
    "gesetzt",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/aufgaben/:p/zusammenfuehren": [
    "Aufgaben",
    "zusammengeführt",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/aufgaben/schnell": [
    "Aufgaben aus Text",
    "geprüft",
    "status",
  ],
  "POST /api/v1/lager/:p/zeitplan/uebernehmen": [
    "Lagertage und Tagesabschnitte",
    "übernommen",
    "angelegt",
  ],
  "PATCH /api/v1/lager/:p/zeitplan/meilensteine/:p": [
    "Meilenstein",
    "geändert",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/zeitplan/meilensteine/:p/verschieben": [
    "Meilenstein",
    "verschoben",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/vorlagen/:p/anwenden": [
    "Vorlage im Lager",
    "angewendet",
    "angelegt",
  ],
  "PUT /api/v1/lager/:p/hoecks/:p/anwesende/:p": [
    "Anwesend-Haken eines Höcks",
    "gesetzt",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/hoecks/:p/anwesende/:p": [
    "Anwesend-Haken eines Höcks",
    "entfernt",
    "geloescht",
  ],
  "POST /api/v1/lager/:p/hoecks/:p/traktanden/uebernehmen": [
    "Punkte für den nächsten Höck",
    "übernommen",
    "angelegt",
  ],
  "PATCH /api/v1/lager/:p/traktanden/:p": [
    "Traktandum",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/erwaehnungen/:p/:p": [
    "Erwähnungen eines Inhalts",
    "abgeglichen",
    "geaendert",
  ],
  "PATCH /api/v1/lager/:p/erwaehnungen/:p": [
    "Erwähnung",
    "als erledigt markiert",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/erwaehnungen/:p/als-aufgabe": [
    "Erwähnung",
    "zur Aufgabe gemacht",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/erwaehnungen/:p/als-aufgabe": [
    "Aufgabe aus Erwähnung",
    "zurückgenommen",
    "geloescht",
  ],
  "PUT /api/v1/lager/:p/pinnwand/gesehen": [
    "Beiträge",
    "als gesehen gemeldet",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/pinnwand/:p/gesehen": [
    "Beitrag",
    "als gesehen gemeldet",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/pinnwand": [
    "Beitrag der Pinnwand",
    "angelegt",
    "angelegt",
  ],
  "PATCH /api/v1/lager/:p/pinnwand/:p/umfrage": [
    "Umfrage",
    "geändert",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/pinnwand/:p/umfrage": [
    "Umfrage",
    "entfernt",
    "geloescht",
  ],
  "POST /api/v1/lager/:p/pinnwand/:p/umfrage": [
    "Umfrage",
    "angehängt",
    "angelegt",
  ],
  "PUT /api/v1/lager/:p/pinnwand/:p/umfrage/stimme": [
    "Stimme",
    "gesetzt",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/pinnwand/:p/umfrage/stimme": [
    "Stimmen",
    "zurückgezogen",
    "geloescht",
  ],
  "PUT /api/v1/lager/:p/reaktionen/:p/:p": ["Reaktion", "gesetzt", "geaendert"],
  "DELETE /api/v1/lager/:p/reaktionen/:p/:p": [
    "Reaktion",
    "zurückgenommen",
    "geloescht",
  ],
  "POST /api/v1/lager/:p/eingang": [
    "Meldung an die Lagerleitung",
    "eingegangen",
    "angelegt",
  ],
  "POST /api/v1/lager/:p/eingang/status": ["Meldung", "gelesen", "status"],
  "PATCH /api/v1/lager/:p/eingang/:p": [
    "Meldung an die Lagerleitung",
    "bearbeitet",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/eingang/:p": [
    "Meldung an die Lagerleitung",
    "gelöscht",
    "geloescht",
  ],
  "POST /api/v1/lager/:p/eingang/:p/traktandum": [
    "Meldung",
    "zum Traktandum gemacht",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/eingang/:p/traktandum": [
    "Traktandum aus Meldung",
    "zurückgenommen",
    "geloescht",
  ],
  "POST /api/v1/lager/:p/teilnehmer": [
    "Teilnehmende Person",
    "erfasst",
    "angelegt",
  ],
  "POST /api/v1/lager/:p/teilnehmer/import": [
    "Teilnehmende",
    "importiert",
    "angelegt",
  ],
  "PUT /api/v1/lager/:p/abzaehlen": ["Abzähl-Haken", "gesetzt", "geaendert"],
  "POST /api/v1/lager/:p/abzaehlen/zuruecksetzen": [
    "Abzählen",
    "zurückgesetzt",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/zimmer/:p/zuordnung": [
    "Personen im Zimmer",
    "eingeteilt",
    "zugeordnet",
  ],
  "POST /api/v1/lager/:p/zimmer/:p/zuordnung/entfernen": [
    "Personen im Zimmer",
    "entfernt",
    "geloescht",
  ],
  "POST /api/v1/lager/:p/fahrten/:p/mitfahrer": [
    "Mitfahrt",
    "hinzugefügt",
    "angelegt",
  ],
  "POST /api/v1/lager/:p/gruppen/mischen": [
    "Gruppen",
    "gemischt eingeteilt",
    "zugeordnet",
  ],
  "PUT /api/v1/lager/:p/gruppen/zuordnung": [
    "Gruppenzuordnung",
    "geändert",
    "zugeordnet",
  ],
  "PUT /api/v1/lager/:p/gruppen/abgewaehlt": [
    "Abgewählte Teilnehmende",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/schichtplan/schichten": [
    "Dienst an einem Tag",
    "besetzt",
    "zugeordnet",
  ],
  "POST /api/v1/lager/:p/schichtplan/vorschlag": [
    "Dienstplan",
    "geprüft",
    "status",
  ],
  "POST /api/v1/lager/:p/diensttausch": [
    "Diensttausch",
    "angefragt",
    "angelegt",
  ],
  "POST /api/v1/lager/:p/diensttausch/:p/entscheid": [
    "Tauschanfrage",
    "entschieden",
    "entschieden",
  ],
  "POST /api/v1/lager/:p/diensttausch/:p/zurueckziehen": [
    "Tauschanfrage",
    "zurückgezogen",
    "zurueckgezogen",
  ],
  "PUT /api/v1/lager/:p/anwesenheit": [
    "Anwesenheit im Lager",
    "eingetragen",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/anwesenheit/eigene": [
    "Eigene Anwesenheit",
    "eingetragen",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/anwesenheit/frist": [
    "Frist für die Anwesenheit des Teams",
    "gesetzt",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/anwesenheit/anfragen": [
    "Anfrage zur Änderung eines Feldes",
    "gestellt",
    "angelegt",
  ],
  "POST /api/v1/lager/:p/anwesenheit/anfragen/entscheid": [
    "Anfrage zur Anwesenheit",
    "entschieden",
    "entschieden",
  ],
  "POST /api/v1/lager/:p/tagesseiten/:p": [
    "Tagesseite",
    "angelegt",
    "angelegt",
  ],
  "PATCH /api/v1/lager/:p/tagesseiten/:p": [
    "Tagesseite",
    "geändert",
    "geaendert",
  ],
  "POST /api/v1/lager/:p/tagesseiten/:p/bloecke": [
    "Block einer Tagesseite",
    "angelegt",
    "angelegt",
  ],
  "POST /api/v1/lager/:p/einkauf": [
    "Artikel der Einkaufsliste",
    "angelegt",
    "angelegt",
  ],
  "PATCH /api/v1/lager/:p/einkauf/:p": [
    "Artikel der Einkaufsliste",
    "geändert",
    "geaendert",
  ],
  "DELETE /api/v1/lager/:p/einkauf/:p": [
    "Artikel der Einkaufsliste",
    "entfernt",
    "geloescht",
  ],
  "PUT /api/v1/lager/:p/packliste/punkte/:p/zustand": [
    "Punkt der Packliste",
    "abgehakt",
    "geaendert",
  ],
  "PUT /api/v1/lager/:p/notfall/karte": [
    "Kartenlink der Lageradresse",
    "gesetzt",
    "geaendert",
  ],
  "PUT /api/v1/admin/kategorie-zuordnungen": [
    "Kategorie eines Tags",
    "zugeordnet",
    "zugeordnet",
  ],
  "DELETE /api/v1/admin/kategorie-zuordnungen/:p": [
    "Kategorie-Zuordnung",
    "entfernt",
    "geloescht",
  ],
  "POST /api/v1/ich/kalender-link": [
    "Persönlicher Kalenderlink",
    "erzeugt",
    "angelegt",
  ],
  "DELETE /api/v1/ich/kalender-link": [
    "Persönlicher Kalenderlink",
    "widerrufen",
    "geloescht",
  ],
  "POST /api/v1/termin-vorschlaege": [
    "Terminvorschlag",
    "eingereicht",
    "angelegt",
  ],
  "DELETE /api/v1/termin-vorschlaege/:p": [
    "Terminvorschlag",
    "zurückgezogen",
    "zurueckgezogen",
  ],
  "POST /api/v1/admin/termin-vorschlaege/:p/entscheid": [
    "Terminvorschlag",
    "entschieden",
    "entschieden",
  ],
  "POST /api/v1/admin/termin-vorschlaege/:p/eingetragen": [
    "Terminvorschlag",
    "als eingetragen gemeldet",
    "geaendert",
  ],
  "PATCH /api/v1/admin/anlaesse/:p": ["Anlass", "geändert", "geaendert"],
  "PUT /api/v1/admin/anlaesse/:p/felder": [
    "Zusatzfelder eines Anlasses",
    "ersetzt",
    "geaendert",
  ],
  "PUT /api/v1/anlaesse/:p/anmeldung": [
    "Anmeldung zu einem Anlass",
    "gesetzt",
    "geaendert",
  ],
  "DELETE /api/v1/anlaesse/:p/anmeldung": [
    "Anmeldung zu einem Anlass",
    "zurückgenommen",
    "geloescht",
  ],
  "POST /api/v1/raeume/:p/anfragen": ["Raumanfrage", "gestellt", "angelegt"],
  "DELETE /api/v1/raeume/anfragen/:p": [
    "Raumanfrage",
    "storniert",
    "geloescht",
  ],
  "POST /api/v1/raeume/anfragen/:p/entscheid": [
    "Raumanfrage",
    "entschieden",
    "entschieden",
  ],
  "PATCH /api/v1/admin/raeume/:p": ["Raum", "geändert", "geaendert"],
  "PATCH /api/v1/redaktion/website": [
    "Name und Logo der Website",
    "geändert",
    "geaendert",
  ],
  "PUT /api/v1/redaktion/stufen/:p/eckdaten/:p": [
    "Felder der Stufenseite für ein Datum",
    "gepflegt",
    "geaendert",
  ],
  "DELETE /api/v1/redaktion/stufen/:p/eckdaten/:p": [
    "Felder der Stufenseite für ein Datum",
    "gelöscht",
    "geloescht",
  ],
  "POST /api/v1/redaktion/orte/vorschau": ["Ort", "geprüft", "status"],
  "PUT /api/v1/redaktion/orte/reihenfolge": [
    "Reihenfolge der Orte",
    "gesetzt",
    "geaendert",
  ],
  "POST /api/v1/laden/bestellungen": [
    "Bestellung im Lädeli",
    "aufgegeben",
    "angelegt",
  ],
  "DELETE /api/v1/laden/bestellungen/:p": [
    "Bestellung im Lädeli",
    "storniert",
    "geloescht",
  ],
  "PUT /api/v1/admin/laden/artikel/reihenfolge": [
    "Reihenfolge der Artikel",
    "gesetzt",
    "geaendert",
  ],
  "POST /api/v1/admin/laden/bestellungen/:p/status": [
    "Stand einer Bestellung",
    "gesetzt",
    "status",
  ],
  "PUT /api/v1/admin/laden/einstellungen": [
    "Einstellungen des Lädelis",
    "gespeichert",
    "geaendert",
  ],
};

// Routen, die nichts protokollieren, und warum. Das Protokoll will Änderungen am Stand der Abteilung, nicht Klicks.
//  pruefung: Vorschau und Prüfung, schreibt nichts
//  sitzung: Anmeldung und Abmeldung, kein Eingriff in Daten (Fehlschläge stehen als «Sicherheit»)
//  alltag: Eingaben im Alltag (Haken, Reaktionen, Lesemarken, Chat, eigene Einstellungen, Selbstbedienung, selbsttätiger Abgleich), kein Eingriff in Rechte oder Verwaltung
const NICHT_ERFASST = {
  pruefung: [
    "POST /api/v1/admin/mitteilungen/vorschau",
    "POST /api/v1/admin/import/vorschau",
    "POST /api/v1/admin/cevi-db/pruefen",
    "POST /api/v1/admin/fotos/verbindung",
    "POST /api/v1/admin/rechte/gruppen/:p/rollen/vorschau",
    "POST /api/v1/redaktion/orte/vorschau",
    "POST /api/v1/lager/:p/schichtplan/vorschlag",
    "POST /api/v1/lager/:p/aufgaben/schnell",
    "POST /api/v1/lager/:p/eingang/status",
  ],
  sitzung: [
    "POST /api/auth/sign-in/username",
    "POST /api/auth/sign-out",
    "POST /api/auth/two-factor/verify-totp",
    "POST /api/auth/two-factor/verify-backup-code",
  ],
  alltag: [
    "PATCH /api/v1/ich",
    "PUT /api/v1/ich/bild",
    "DELETE /api/v1/ich/bild",
    "POST /api/v1/ich/datenschutz",
    "PUT /api/v1/ich/lager-benachrichtigungen",
    "PUT /api/v1/push-token",
    "POST /api/v1/chats/direkt",
    "POST /api/v1/chats/:p/nachrichten",
    "PUT /api/v1/chats/:p/gelesen",
    "POST /api/v1/lager/:p/benachrichtigungen/gelesen",
    "PUT /api/v1/lager/:p/pinnwand/gesehen",
    "PUT /api/v1/lager/:p/pinnwand/:p/gesehen",
    "PUT /api/v1/lager/:p/pinnwand/:p/umfrage/stimme",
    "DELETE /api/v1/lager/:p/pinnwand/:p/umfrage/stimme",
    "PUT /api/v1/lager/:p/reaktionen/:p/:p",
    "DELETE /api/v1/lager/:p/reaktionen/:p/:p",
    "PUT /api/v1/lager/:p/abzaehlen",
    "PUT /api/v1/lager/:p/packliste/punkte/:p/zustand",
    "PUT /api/v1/lager/:p/anwesenheit/eigene",
    "PUT /api/v1/lager/:p/erwaehnungen/:p/:p",
    "PUT /api/v1/lager/:p/hoecks/:p/anwesende/:p",
    "DELETE /api/v1/lager/:p/hoecks/:p/anwesende/:p",
    "PUT /api/v1/stufen/:p/anwesenheit/:p/kinder/:p",
    "PUT /api/v1/stufen/:p/anwesenheit/:p/leitende/:p",
    "PUT /api/v1/programme/:p/teilnahmen/:p",
    "PUT /api/v1/programme/:p/leitung",
    "PUT /api/v1/anlaesse/:p/anmeldung",
    "DELETE /api/v1/anlaesse/:p/anmeldung",
    "POST /api/v1/laden/bestellungen",
    "DELETE /api/v1/laden/bestellungen/:p",
    "POST /api/v1/termin-vorschlaege",
    "DELETE /api/v1/termin-vorschlaege/:p",
    "POST /api/v1/raeume/:p/anfragen",
    "DELETE /api/v1/raeume/anfragen/:p",
    "POST /api/v1/lager/:p/todos",
    "PATCH /api/v1/lager/:p/todos/:p",
    "DELETE /api/v1/lager/:p/todos/:p",
    "POST /api/v1/lager/:p/check/punkte",
    "PATCH /api/v1/lager/:p/check/punkte/:p",
    "DELETE /api/v1/lager/:p/check/punkte/:p",
    "POST /api/v1/lager/:p/packliste/eigene",
    "PATCH /api/v1/lager/:p/packliste/eigene/:p",
    "DELETE /api/v1/lager/:p/packliste/eigene/:p",
  ],
};
const GRUND = Object.fromEntries(
  Object.entries(NICHT_ERFASST).flatMap(([grund, liste]) =>
    liste.map((k) => [k, grund]),
  ),
);

const SCHREIBEND = ["post", "put", "patch", "delete"];
export function eintraege() {
  const eintraege = {};
  const ungeklaert = [];
  for (const [pfad, operationen] of Object.entries(openapi.paths)) {
    for (const [methode, op] of Object.entries(operationen)) {
      if (!SCHREIBEND.includes(methode)) continue;
      if (typeof op.summary !== "string") continue;
      const key = schluessel(methode, pfad);
      const titel = op.summary.replace(/\s+/g, " ").trim();
      let beschreibung = AUSNAHMEN[key];
      if (!beschreibung) {
        const ohneKlammer = titel.replace(/\s*\([^)]*\)\s*$/, "");
        const woerter = ohneKlammer.split(" ");
        const verb = VERBEN[woerter.at(-1)];
        if (!verb) {
          ungeklaert.push(`${key} | ${titel}`);
          continue;
        }
        const objekt = woerter
          .slice(0, -1)
          .filter((w) => w !== "endgültig")
          .join(" ");
        beschreibung = [objekt, verb[0], verb[1]];
      }
      const [objekt, aktion, gruppe] = beschreibung;
      if (!GRUPPEN.includes(gruppe)) {
        throw new Error(`Gruppe unbekannt: ${key} → ${gruppe}`);
      }
      eintraege[key] = {
        titel,
        objekt,
        aktion,
        gruppe,
        ...(GRUND[key] ? { nicht: GRUND[key] } : {}),
      };
    }
  }
  if (ungeklaert.length > 0) {
    throw new Error(
      `Ohne Verb am Ende, bitte in AUSNAHMEN ergänzen:\n${ungeklaert.join("\n")}`,
    );
  }
  for (const k of [...Object.keys(GRUND), ...Object.keys(AUSNAHMEN)]) {
    if (!eintraege[k]) {
      throw new Error(`Das Skript nennt eine Route, die es nicht gibt: ${k}`);
    }
  }
  return eintraege;
}
export function erzeuge() {
  const zeilen = Object.entries(eintraege())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `// Erzeugt von scripts/aktivitaet-titel-erzeugen.mjs aus docs/api/openapi.yaml (#637, #662); nicht von Hand ändern.
// Klartext zu «METHODE /pfad» mit allen Parametern als :p, für jede schreibende Route: titel (Zusammenfassung der API), objekt («Anlass»), aktion («gelöscht»), gruppe (für den Filter) und nicht (Grund, warum die Route nicht protokolliert wird)
export type AktivitaetKatalogEintrag = {
  titel: string;
  objekt: string;
  aktion: string;
  gruppe: string;
  nicht?: "pruefung" | "sitzung" | "alltag";
};
export const AKTIVITAET_KATALOG: Record<string, AktivitaetKatalogEintrag> = {
${zeilen.join("\n")}
};
`;
}
if (process.argv[1]?.endsWith("aktivitaet-titel-erzeugen.mjs")) {
  writeFileSync(new URL("apps/api/src/aktivitaet-titel.ts", wurzel), erzeuge());
}
