// Erzeugt von scripts/aktivitaet-titel-erzeugen.mjs aus docs/api/openapi.yaml (#637); nicht von Hand ändern.
// Klartext zu «METHODE /pfad» mit allen Parametern als :p; die Verwaltung zeigt ihn im Protokoll
export const AKTIVITAET_TITEL: Record<string, string> = {
  "DELETE /api/v1/admin/anlaesse/:p": "Anlass löschen",
  "DELETE /api/v1/admin/bearbeiter/:p": "Bearbeitungsrecht entziehen",
  "DELETE /api/v1/admin/kategorie-zuordnungen/:p": "Zuordnung entfernen",
  "DELETE /api/v1/admin/kinder/:p": "Kind löschen",
  "DELETE /api/v1/admin/kinder/:p/konto": "Konto eines Kindes entfernen",
  "DELETE /api/v1/admin/laden/artikel/:p": "Artikel löschen",
  "DELETE /api/v1/admin/lager/:p": "Lager endgültig löschen",
  "DELETE /api/v1/admin/lager/:p/mitglieder/:p": "Mitglied entfernen",
  "DELETE /api/v1/admin/medien/:p": "Medium löschen",
  "DELETE /api/v1/admin/personen/:p": "Person löschen",
  "DELETE /api/v1/admin/plattform/rollen/:p": "Plattformrolle löschen",
  "DELETE /api/v1/admin/plattform/rollen/:p/personen/:p":
    "Plattformrolle einer Person entziehen",
  "DELETE /api/v1/admin/raeume/:p": "Raum endgültig löschen",
  "DELETE /api/v1/admin/stufen/:p": "Stufe löschen",
  "DELETE /api/v1/admin/stufen/:p/logo": "Logo einer Stufe löschen",
  "DELETE /api/v1/admin/tags/:p": "Tag löschen",
  "DELETE /api/v1/admin/tags/:p/personen/:p": "Tag einer Person entziehen",
  "DELETE /api/v1/admin/vorlagen/:p": "Vorlage löschen",
  "DELETE /api/v1/admin/zeitregeln/:p": "Erinnerungsregel löschen",
  "DELETE /api/v1/anlaesse/:p/anmeldung": "Von einem Anlass abmelden",
  "DELETE /api/v1/ich/bild": "Eigenes Profilbild löschen",
  "DELETE /api/v1/ich/kalender-link": "Persönlichen Kalenderlink widerrufen",
  "DELETE /api/v1/laden/bestellungen/:p": "Eigene offene Bestellung stornieren",
  "DELETE /api/v1/lager/:p/adressbuch/:p": "Kontakt im Adressbuch löschen",
  "DELETE /api/v1/lager/:p/aufgaben/:p": "Aufgabe löschen",
  "DELETE /api/v1/lager/:p/aufgaben/:p/checkliste/:p": "Checkpunkt löschen",
  "DELETE /api/v1/lager/:p/aufgaben/:p/links/:p": "Link einer Aufgabe löschen",
  "DELETE /api/v1/lager/:p/beschluesse/:p": "Beschluss löschen",
  "DELETE /api/v1/lager/:p/check/punkte/:p": "Eigenen Check-Punkt löschen",
  "DELETE /api/v1/lager/:p/dateien/:p": "Verknüpfung löschen",
  "DELETE /api/v1/lager/:p/dokumente/:p": "Dokument löschen",
  "DELETE /api/v1/lager/:p/eingang/:p": "Eine Meldung endgültig löschen",
  "DELETE /api/v1/lager/:p/eingang/:p/traktandum":
    "«Als Traktandum» zurücknehmen",
  "DELETE /api/v1/lager/:p/einkauf/:p": "Artikel von der Einkaufsliste nehmen",
  "DELETE /api/v1/lager/:p/erwaehnungen/:p/als-aufgabe":
    "«Als Aufgabe» zurücknehmen",
  "DELETE /api/v1/lager/:p/fahrten/:p": "Fahrt löschen",
  "DELETE /api/v1/lager/:p/fahrten/:p/mitfahrer/:p": "Mitfahrt entfernen",
  "DELETE /api/v1/lager/:p/gruppen/:p": "Gruppe löschen",
  "DELETE /api/v1/lager/:p/hoecks/:p": "Höck löschen",
  "DELETE /api/v1/lager/:p/hoecks/:p/anwesende/:p": "Anwesend-Haken entfernen",
  "DELETE /api/v1/lager/:p/infos/:p": "Info-Abschnitt löschen",
  "DELETE /api/v1/lager/:p/notfall/kontakte/:p": "Notfall-Kontakt löschen",
  "DELETE /api/v1/lager/:p/packliste/eigene/:p": "Eigenen Punkt löschen",
  "DELETE /api/v1/lager/:p/packliste/punkte/:p": "Punkt der Packliste löschen",
  "DELETE /api/v1/lager/:p/pinnwand/:p": "Beitrag von der Pinnwand löschen",
  "DELETE /api/v1/lager/:p/pinnwand/:p/umfrage":
    "Umfrage vom Beitrag entfernen",
  "DELETE /api/v1/lager/:p/pinnwand/:p/umfrage/stimme":
    "Eigene Stimmen zurückziehen",
  "DELETE /api/v1/lager/:p/protokolle/:p": "Protokoll löschen",
  "DELETE /api/v1/lager/:p/reaktionen/:p/:p": "Eigene Reaktion zurücknehmen",
  "DELETE /api/v1/lager/:p/ressorts/:p": "Ressort löschen",
  "DELETE /api/v1/lager/:p/ressorts/:p/links/:p": "Link löschen",
  "DELETE /api/v1/lager/:p/ressorts/:p/notizen/:p": "Notiz löschen",
  "DELETE /api/v1/lager/:p/schichtplan/dienste/:p": "Dienst löschen",
  "DELETE /api/v1/lager/:p/tagesseiten/:p/bloecke/:p":
    "Block einer Tagesseite löschen",
  "DELETE /api/v1/lager/:p/teilnehmer/:p": "Teilnehmende Person löschen",
  "DELETE /api/v1/lager/:p/todos/:p": "Privates To-do löschen",
  "DELETE /api/v1/lager/:p/traktanden/:p": "Traktandum löschen",
  "DELETE /api/v1/lager/:p/zeitplan/lagertage/:p": "Lagertag löschen",
  "DELETE /api/v1/lager/:p/zeitplan/meilensteine/:p": "Meilenstein löschen",
  "DELETE /api/v1/lager/:p/zeitplan/tagesabschnitte/:p":
    "Tagesabschnitt löschen",
  "DELETE /api/v1/lager/:p/zimmer/:p": "Zimmer oder Zelt löschen",
  "DELETE /api/v1/plattform/schalter":
    "Wartungsmodus oder Informationssperre für einen Bereich aufheben",
  "DELETE /api/v1/raeume/anfragen/:p":
    "Eigene Raumanfrage oder Buchung stornieren",
  "DELETE /api/v1/redaktion/medien/:p": "Medium löschen",
  "DELETE /api/v1/redaktion/seiten/:p": "Seite löschen",
  "DELETE /api/v1/redaktion/stufen/:p/eckdaten/:p":
    "Gepflegte Felder für ein Datum löschen",
  "DELETE /api/v1/redaktion/weiterleitungen/:p": "Weiterleitung löschen",
  "DELETE /api/v1/termin-vorschlaege/:p": "Terminvorschlag zurückziehen",
  "GET /admin/anlass-anmeldungen.js":
    "Skript der Verwaltung – Bereich Anlässe, Reiter Anmeldungen eines Anlasses",
  "GET /admin/kinder.js": "Skript der Verwaltung – Bereich Kinder",
  "GET /admin/lager-personenwahl.js":
    "Skript der Verwaltung – Bereich Lager, Personen für ein Lager wählen",
  "GET /admin/personen-blatt.js":
    "Skript der Verwaltung – Seitenblatt einer Person",
  "GET /admin/personen-wahl.js":
    "Skript der Verwaltung – Personen und Kinder zuordnen, Datei wählen",
  "GET /admin/personen.css":
    "Stilvorlage der Verwaltung – Personen, Gruppen und Tags",
  "GET /admin/personen.js": "Skript der Verwaltung – Bereich Personen",
  "GET /admin/protokoll-liste.js":
    "Skript der Verwaltung – Protokoll, Zeitleiste und Detail",
  "GET /admin/protokoll-text.js":
    "Skript der Verwaltung – Protokoll, Texte und Zeiten",
  "GET /admin/protokoll.css": "Stilvorlage der Verwaltung – Protokoll",
  "GET /admin/protokoll.js": "Skript der Verwaltung – Protokoll",
  "GET /admin/termine-anmeldungen.js":
    "Skript der Verwaltung – alte Adresse der Anmeldungen, leitet auf den Anlass um",
  "GET /api/v1/admin/anlaesse/:p/anmeldungen":
    "Anmeldungen eines Anlasses ansehen",
  "GET /api/v1/admin/anlaesse/:p/anmeldungen.csv":
    "Anmeldungen eines Anlasses als CSV-Datei exportieren",
  "GET /api/v1/admin/kinder": "Kinder der Abteilung mit Elternteilen",
  "GET /api/v1/admin/kinder/konto-einstellung":
    "Einstellungen der Konten für Kinder lesen",
  "GET /api/v1/admin/laden/bestellungen":
    "Bestellungen im Lädeli für die Verwaltung",
  "GET /api/v1/admin/personen":
    "Personen, Stufen und Kinder der Abteilung für die Verwaltung",
  "GET /api/v1/admin/protokoll":
    "Aktivitätsprotokoll lesen (neu zuerst, mit Filtern)",
  "GET /api/v1/admin/protokoll/:p": "Einen Eintrag des Protokolls lesen",
  "GET /api/v1/admin/protokoll/export.csv":
    "Gefilterten Ausschnitt des Protokolls als CSV",
  "GET /api/v1/admin/protokoll/verlauf":
    "Zahl der Einträge und Fehler je Stunde oder Tag, dazu die Bereiche",
  "GET /api/v1/laden/bestellungen/meine": "Eigene Bestellungen im Lädeli",
  "GET /api/v1/lager/:p/adressbuch": "Adressbuch des Lagers auflisten",
  "GET /api/v1/lager/:p/adressbuch/:p": "Kontakt im Adressbuch lesen",
  "GET /api/v1/lager/:p/notfall": "Notfall-Fenster lesen",
  "GET /api/v1/lager/:p/protokolle": "Protokolle des Lagers auflisten",
  "GET /api/v1/lager/:p/protokolle/:p": "Protokoll lesen",
  "GET /api/v1/lager/:p/teilnehmer": "Teilnehmende des Lagers auflisten",
  "GET /api/v1/lager/:p/teilnehmer/:p": "Teilnehmende Person lesen",
  "GET /api/v1/personen/:p/bild": "Profilbild einer Person lesen",
  "GET /api/v1/redaktion/personen":
    "Personen mit einem Tag für die Auswahl im Editor",
  "PATCH /api/v1/admin/anlaesse/:p":
    "Anmeldung, Frist und Sichtbarkeit eines Anlasses ändern",
  "PATCH /api/v1/admin/kinder/:p": "Kind ändern",
  "PATCH /api/v1/admin/kinder/:p/konto":
    "Einsicht der Eltern am Konto eines Kindes ändern («Konto übergeben»)",
  "PATCH /api/v1/admin/laden/artikel/:p": "Artikel ändern",
  "PATCH /api/v1/admin/lager/:p": "Lager ändern, Status setzen",
  "PATCH /api/v1/admin/personen/:p":
    "Name, Admin-Recht, Stufenrollen und Kinder einer Person ändern",
  "PATCH /api/v1/admin/plattform/rollen/:p":
    "Name oder Rechte einer Plattformrolle ändern",
  "PATCH /api/v1/admin/raeume/:p": "Raum ändern oder deaktivieren",
  "PATCH /api/v1/admin/stufen/:p": "Stufe ändern",
  "PATCH /api/v1/admin/tags/:p": "Tag umbenennen",
  "PATCH /api/v1/admin/vorlagen/:p": "Vorlage ändern",
  "PATCH /api/v1/admin/zeitregeln/:p": "Erinnerungsregel ändern",
  "PATCH /api/v1/ich": "Eigene Push-Schalter und Telefonnummer ändern",
  "PATCH /api/v1/lager/:p/adressbuch/:p": "Kontakt im Adressbuch ändern",
  "PATCH /api/v1/lager/:p/aufgaben/:p": "Aufgabe ändern",
  "PATCH /api/v1/lager/:p/aufgaben/:p/checkliste/:p":
    "Checkpunkt ändern oder abhaken",
  "PATCH /api/v1/lager/:p/aufgaben/:p/links/:p": "Link einer Aufgabe ändern",
  "PATCH /api/v1/lager/:p/beschluesse/:p": "Beschluss ändern",
  "PATCH /api/v1/lager/:p/check/punkte/:p":
    "Eigenen Check-Punkt ändern oder abhaken",
  "PATCH /api/v1/lager/:p/dokumente/:p": "Dokument ändern",
  "PATCH /api/v1/lager/:p/eingang/:p":
    "Eine Meldung beantworten, ihren Status setzen oder sie zuordnen",
  "PATCH /api/v1/lager/:p/einkauf/:p": "Artikel ändern oder abhaken",
  "PATCH /api/v1/lager/:p/erwaehnungen/:p": "Erwähnung als erledigt markieren",
  "PATCH /api/v1/lager/:p/fahrten/:p": "Fahrt ändern",
  "PATCH /api/v1/lager/:p/gruppen/:p": "Gruppe ändern",
  "PATCH /api/v1/lager/:p/hoecks/:p": "Höck ändern",
  "PATCH /api/v1/lager/:p/infos/:p": "Info-Abschnitt ändern",
  "PATCH /api/v1/lager/:p/notfall/kontakte/:p": "Notfall-Kontakt ändern",
  "PATCH /api/v1/lager/:p/packliste/eigene/:p":
    "Eigenen Punkt ändern oder abhaken",
  "PATCH /api/v1/lager/:p/packliste/punkte/:p": "Punkt der Packliste ändern",
  "PATCH /api/v1/lager/:p/pinnwand/:p": "Beitrag der Pinnwand ändern",
  "PATCH /api/v1/lager/:p/pinnwand/:p/umfrage":
    "Umfrage schliessen, öffnen oder umstellen",
  "PATCH /api/v1/lager/:p/protokolle/:p": "Protokoll ändern",
  "PATCH /api/v1/lager/:p/ressorts/:p": "Ressort ändern",
  "PATCH /api/v1/lager/:p/ressorts/:p/links/:p": "Link ändern",
  "PATCH /api/v1/lager/:p/ressorts/:p/notizen/:p": "Notiz ändern",
  "PATCH /api/v1/lager/:p/schichtplan/dienste/:p": "Dienst ändern",
  "PATCH /api/v1/lager/:p/tagesseiten/:p": "Tagesseite ändern",
  "PATCH /api/v1/lager/:p/tagesseiten/:p/bloecke/:p":
    "Block einer Tagesseite ändern",
  "PATCH /api/v1/lager/:p/teilnehmer/:p": "Teilnehmende Person ändern",
  "PATCH /api/v1/lager/:p/todos/:p": "Privates To-do ändern oder abhaken",
  "PATCH /api/v1/lager/:p/traktanden/:p":
    "Traktandum ändern, verschieben oder entscheiden",
  "PATCH /api/v1/lager/:p/zeitplan/lagertage/:p": "Lagertag ändern",
  "PATCH /api/v1/lager/:p/zeitplan/meilensteine/:p":
    "Meilenstein ändern (ohne Datum)",
  "PATCH /api/v1/lager/:p/zeitplan/tagesabschnitte/:p": "Tagesabschnitt ändern",
  "PATCH /api/v1/lager/:p/zimmer/:p": "Zimmer oder Zelt ändern",
  "PATCH /api/v1/redaktion/medien/:p": "Alt-Text nachtragen oder ändern",
  "PATCH /api/v1/redaktion/seiten/:p": "Struktur einer Seite ändern",
  "PATCH /api/v1/redaktion/website": "Name und Logo der Website ändern",
  "PATCH /api/v1/redaktion/weiterleitungen/:p": "Weiterleitung ändern",
  "POST /api/auth/change-password": "Eigenes Passwort ändern",
  "POST /api/auth/revoke-sessions": "Überall abmelden (alle Sitzungen beenden)",
  "POST /api/auth/sign-in/username": "Mit Benutzername und Passwort anmelden",
  "POST /api/auth/sign-out": "Abmelden (aktuelle Sitzung beenden)",
  "POST /api/auth/two-factor/enable": "Zweiten Faktor (TOTP) einrichten",
  "POST /api/auth/two-factor/verify-backup-code":
    "Ersatzcode prüfen (Anmeldung ohne Authenticator)",
  "POST /api/auth/two-factor/verify-totp":
    "TOTP-Code prüfen (Anmeldung oder Einrichtung)",
  "POST /api/v1/admin/anlaesse": "Anlass anlegen",
  "POST /api/v1/admin/bearbeiter": "Bearbeitungsrecht vergeben",
  "POST /api/v1/admin/import": "Kinder und Leitende importieren",
  "POST /api/v1/admin/import/vorschau":
    "Import prüfen, ohne etwas zu schreiben",
  "POST /api/v1/admin/kinder": "Kind anlegen",
  "POST /api/v1/admin/kinder/:p/konto": "Eigenes Konto für ein Kind erstellen",
  "POST /api/v1/admin/kinder/:p/konto/entsperren":
    "Konto eines Kindes entsperren",
  "POST /api/v1/admin/kinder/:p/konto/sperren": "Konto eines Kindes sperren",
  "POST /api/v1/admin/kinder/:p/konto/startpasswort":
    "Neues Startpasswort für das Konto eines Kindes erzeugen",
  "POST /api/v1/admin/laden/artikel": "Artikel anlegen",
  "POST /api/v1/admin/laden/bestellungen/:p/status":
    "Stand einer Bestellung setzen",
  "POST /api/v1/admin/lager": "Lager anlegen",
  "POST /api/v1/admin/lager/:p/rechte/zuruecksetzen":
    "Rechte auf den Standard zurücksetzen",
  "POST /api/v1/admin/medien": "Bild hochladen",
  "POST /api/v1/admin/mitteilungen": "Mitteilung als Push senden",
  "POST /api/v1/admin/mitteilungen/vorschau":
    "Empfänger einer Mitteilung zählen",
  "POST /api/v1/admin/personen": "Person anlegen und Startpasswort erhalten",
  "POST /api/v1/admin/personen/:p/aktivieren":
    "Deaktivierte Person wieder aktivieren",
  "POST /api/v1/admin/personen/:p/deaktivieren": "Person deaktivieren",
  "POST /api/v1/admin/personen/:p/startpasswort":
    "Neues Startpasswort für eine Person erzeugen",
  "POST /api/v1/admin/personen/:p/zweiter-faktor-zuruecksetzen":
    "Zweiten Faktor einer Person zurücksetzen",
  "POST /api/v1/admin/plattform/rollen": "Plattformrolle anlegen",
  "POST /api/v1/admin/raeume": "Raum anlegen",
  "POST /api/v1/admin/stufen": "Stufe anlegen",
  "POST /api/v1/admin/system/syncs/kalender": "Kalender-Sync anstossen",
  "POST /api/v1/admin/tags": "Tag anlegen",
  "POST /api/v1/admin/termin-vorschlaege/:p/eingetragen":
    "Vorschlag als in Outlook eingetragen melden",
  "POST /api/v1/admin/termin-vorschlaege/:p/entscheid":
    "Terminvorschlag freigeben oder ablehnen",
  "POST /api/v1/admin/vorlagen": "Vorlage anlegen",
  "POST /api/v1/admin/zeitregeln": "Erinnerungsregel anlegen",
  "POST /api/v1/chats/:p/nachrichten": "Nachricht in einen Chat senden",
  "POST /api/v1/chats/direkt": "Einzelchat Eltern und Stufenleitung öffnen",
  "POST /api/v1/ich/datenschutz":
    "Kenntnisnahme der Datenschutzerklärung festhalten",
  "POST /api/v1/ich/kalender-link":
    "Persönlichen Kalenderlink erzeugen oder ersetzen",
  "POST /api/v1/laden/bestellungen": "Im Lädeli bestellen",
  "POST /api/v1/lager/:p/abzaehlen/zuruecksetzen":
    "Abzählen für alle zurücksetzen",
  "POST /api/v1/lager/:p/adressbuch": "Kontakt im Adressbuch anlegen",
  "POST /api/v1/lager/:p/aenderungen":
    "Offline gesammelte Änderungen des Lagers senden",
  "POST /api/v1/lager/:p/anwesenheit/anfragen":
    "Anfrage stellen, ein eingetragenes Feld zu ändern",
  "POST /api/v1/lager/:p/anwesenheit/anfragen/entscheid":
    "Anfragen annehmen oder ablehnen",
  "POST /api/v1/lager/:p/aufgaben": "Aufgabe anlegen",
  "POST /api/v1/lager/:p/aufgaben/:p/checkliste": "Checkpunkt anlegen",
  "POST /api/v1/lager/:p/aufgaben/:p/links": "Link einer Aufgabe anlegen",
  "POST /api/v1/lager/:p/aufgaben/:p/zusammenfuehren":
    "Zwei Aufgaben zusammenführen",
  "POST /api/v1/lager/:p/aufgaben/schnell":
    "Aufgaben aus einem Text vorschlagen (Schnelleingabe)",
  "POST /api/v1/lager/:p/benachrichtigungen/gelesen":
    "Benachrichtigungen als gelesen markieren",
  "POST /api/v1/lager/:p/beschluesse": "Beschluss anlegen",
  "POST /api/v1/lager/:p/check/punkte": "Eigenen Check-Punkt anlegen",
  "POST /api/v1/lager/:p/dateien": "Datei als Verknüpfung hinzufügen",
  "POST /api/v1/lager/:p/diensttausch": "Diensttausch anfragen",
  "POST /api/v1/lager/:p/diensttausch/:p/entscheid":
    "Tauschanfrage annehmen oder ablehnen",
  "POST /api/v1/lager/:p/diensttausch/:p/zurueckziehen":
    "Tauschanfrage zurückziehen",
  "POST /api/v1/lager/:p/dokumente": "Dokument anlegen",
  "POST /api/v1/lager/:p/eingang":
    "Idee, Wunsch, Frage oder Feedback an die Lagerleitung senden",
  "POST /api/v1/lager/:p/eingang/:p/traktandum":
    "Aus einer Meldung ein Traktandum machen",
  "POST /api/v1/lager/:p/eingang/status":
    "Status und Antwort mit dem Rückfragecode lesen",
  "POST /api/v1/lager/:p/einkauf": "Artikel auf die Einkaufsliste setzen",
  "POST /api/v1/lager/:p/erwaehnungen/:p/als-aufgabe":
    "Aus einer Erwähnung eine Aufgabe machen",
  "POST /api/v1/lager/:p/fahrten": "Fahrt anlegen",
  "POST /api/v1/lager/:p/fahrten/:p/mitfahrer":
    "Person oder Teilnehmenden zur Fahrt hinzufügen",
  "POST /api/v1/lager/:p/gruppen": "Gruppe anlegen",
  "POST /api/v1/lager/:p/gruppen/mischen": "Gemischt einteilen",
  "POST /api/v1/lager/:p/hoecks": "Höck anlegen",
  "POST /api/v1/lager/:p/hoecks/:p/traktanden/uebernehmen":
    "Punkte für den nächsten Höck in diesen Höck übernehmen",
  "POST /api/v1/lager/:p/infos": "Info-Abschnitt anlegen",
  "POST /api/v1/lager/:p/notfall/kontakte": "Notfall-Kontakt anlegen",
  "POST /api/v1/lager/:p/packliste/eigene": "Eigenen Punkt anlegen",
  "POST /api/v1/lager/:p/packliste/punkte": "Punkt der Packliste anlegen",
  "POST /api/v1/lager/:p/pinnwand": "Beitrag auf die Pinnwand setzen",
  "POST /api/v1/lager/:p/pinnwand/:p/umfrage":
    "Umfrage an einen Beitrag hängen",
  "POST /api/v1/lager/:p/protokolle": "Protokoll anlegen",
  "POST /api/v1/lager/:p/rechte/zuruecksetzen":
    "Rechte auf den Standard zurücksetzen",
  "POST /api/v1/lager/:p/ressorts": "Ressort anlegen",
  "POST /api/v1/lager/:p/ressorts/:p/links": "Link anlegen",
  "POST /api/v1/lager/:p/ressorts/:p/notizen": "Notiz anlegen",
  "POST /api/v1/lager/:p/schichtplan/dienste": "Dienst anlegen",
  "POST /api/v1/lager/:p/schichtplan/vorschlag":
    "Leere Dienste füllen (Vorschlag)",
  "POST /api/v1/lager/:p/tagesseiten/:p": "Tagesseite anlegen",
  "POST /api/v1/lager/:p/tagesseiten/:p/bloecke":
    "Block einer Tagesseite anlegen",
  "POST /api/v1/lager/:p/teilnehmer": "Teilnehmende Person erfassen",
  "POST /api/v1/lager/:p/teilnehmer/import":
    "Teilnehmende aus eingefügtem Text importieren",
  "POST /api/v1/lager/:p/todos": "Privates To-do anlegen",
  "POST /api/v1/lager/:p/traktanden": "Traktandum anlegen",
  "POST /api/v1/lager/:p/vorlagen/:p/anwenden": "Vorlage im Lager anwenden",
  "POST /api/v1/lager/:p/zeitplan/lagertage": "Lagertag anlegen",
  "POST /api/v1/lager/:p/zeitplan/meilensteine": "Meilenstein anlegen",
  "POST /api/v1/lager/:p/zeitplan/meilensteine/:p/verschieben":
    "Meilenstein verschieben (Vorschau und Bestätigung)",
  "POST /api/v1/lager/:p/zeitplan/tagesabschnitte": "Tagesabschnitt anlegen",
  "POST /api/v1/lager/:p/zeitplan/uebernehmen":
    "Lagertage und Tagesabschnitte übernehmen",
  "POST /api/v1/lager/:p/zimmer": "Zimmer oder Zelt anlegen",
  "POST /api/v1/lager/:p/zimmer/:p/zuordnung": "Personen ins Zimmer einteilen",
  "POST /api/v1/lager/:p/zimmer/:p/zuordnung/entfernen":
    "Personen aus dem Zimmer nehmen",
  "POST /api/v1/raeume/:p/anfragen": "Einen Raum für eine Zeit anfragen",
  "POST /api/v1/raeume/anfragen/:p/entscheid":
    "Eine Raumanfrage annehmen oder ablehnen",
  "POST /api/v1/redaktion/medien": "Bild hochladen",
  "POST /api/v1/redaktion/seiten": "Seite anlegen",
  "POST /api/v1/redaktion/seiten/:p/veroeffentlichen":
    "Entwurf veröffentlichen",
  "POST /api/v1/redaktion/seiten/:p/versionen/:p/zurueckholen":
    "Frühere Version in den Entwurf zurückholen",
  "POST /api/v1/redaktion/seiten/:p/zurueckziehen":
    "Veröffentlichung zurückziehen",
  "POST /api/v1/redaktion/seiten/aus-vorlage":
    "Seite aus einer Vorlage anlegen",
  "POST /api/v1/redaktion/weiterleitungen": "Weiterleitung anlegen",
  "POST /api/v1/termin-vorschlaege": "Termin vorschlagen",
  "PUT /api/v1/admin/anlaesse/:p/felder":
    "Zusatzfelder eines Anlasses ersetzen",
  "PUT /api/v1/admin/kategorie-zuordnungen": "Kategorie einem Tag zuordnen",
  "PUT /api/v1/admin/kinder/konto-einstellung":
    "Einstellungen der Konten für Kinder speichern",
  "PUT /api/v1/admin/laden/artikel/reihenfolge":
    "Reihenfolge der Artikel setzen",
  "PUT /api/v1/admin/laden/einstellungen": "Übergabearten des Lädelis ersetzen",
  "PUT /api/v1/admin/lager-dateien/hosts":
    "Erlaubte Hosts für Datei-Links festlegen",
  "PUT /api/v1/admin/lager/:p/mitglieder/:p":
    "Mitglied setzen oder Rolle ändern",
  "PUT /api/v1/admin/lager/:p/rechte": "Rechte der Rollen ändern",
  "PUT /api/v1/admin/plattform/rollen/:p/personen/:p":
    "Plattformrolle einer Person zuweisen",
  "PUT /api/v1/admin/stufen/:p/logo": "Logo einer Stufe hochladen",
  "PUT /api/v1/admin/stufen/:p/stufenleitung":
    "Reihenfolge der Stufenleitung festlegen",
  "PUT /api/v1/admin/tags/:p/personen/:p": "Tag einer Person zuweisen",
  "PUT /api/v1/anlaesse/:p/anmeldung":
    "Zu einem Anlass anmelden oder die Anmeldung ändern",
  "PUT /api/v1/chats/:p/gelesen": "Chat als gelesen markieren",
  "PUT /api/v1/ich/bild": "Eigenes Profilbild hochladen",
  "PUT /api/v1/ich/lager-benachrichtigungen":
    "Schalter für Lager-Benachrichtigungen setzen",
  "PUT /api/v1/lager/:p/abzaehlen": "Haken setzen oder zurücknehmen",
  "PUT /api/v1/lager/:p/anwesenheit":
    "Anwesenheit für Personen eintragen (Lagerleitung)",
  "PUT /api/v1/lager/:p/anwesenheit/eigene": "Eigene offene Felder eintragen",
  "PUT /api/v1/lager/:p/anwesenheit/frist":
    "Frist für die Anwesenheit des Teams setzen",
  "PUT /api/v1/lager/:p/aufgaben/:p/checkliste/reihenfolge":
    "Checkliste neu ordnen",
  "PUT /api/v1/lager/:p/aufgaben/:p/status": "Status einer Aufgabe setzen",
  "PUT /api/v1/lager/:p/aufgaben/:p/stichworte":
    "Stichworte einer Aufgabe setzen",
  "PUT /api/v1/lager/:p/aufgaben/reihenfolge":
    "Reihenfolge der Aufgaben ändern",
  "PUT /api/v1/lager/:p/erwaehnungen/:p/:p":
    "Erwähnungen eines Inhalts abgleichen",
  "PUT /api/v1/lager/:p/gruppen/abgewaehlt":
    "Teilnehmende abwählen oder wieder zuwählen",
  "PUT /api/v1/lager/:p/gruppen/zuordnung":
    "Teilnehmende und Mitglieder einer Gruppe zuordnen",
  "PUT /api/v1/lager/:p/hoecks/:p/anwesende/:p": "Person als anwesend abhaken",
  "PUT /api/v1/lager/:p/infos/reihenfolge":
    "Reihenfolge der Info-Abschnitte ändern",
  "PUT /api/v1/lager/:p/notfall/karte": "Kartenlink der Lageradresse setzen",
  "PUT /api/v1/lager/:p/packliste/punkte/:p/zustand":
    "Punkt abhaken, entfernen oder zurücknehmen",
  "PUT /api/v1/lager/:p/pinnwand/:p/gesehen":
    "Einen Beitrag als gesehen melden",
  "PUT /api/v1/lager/:p/pinnwand/:p/umfrage/stimme": "Eigene Stimme setzen",
  "PUT /api/v1/lager/:p/pinnwand/gesehen":
    "Mehrere Beiträge als gesehen melden",
  "PUT /api/v1/lager/:p/reaktionen/:p/:p": "Eigene Reaktion setzen",
  "PUT /api/v1/lager/:p/rechte": "Rechte der Rollen ändern",
  "PUT /api/v1/lager/:p/ressorts/reihenfolge":
    "Reihenfolge der Ressorts ändern",
  "PUT /api/v1/lager/:p/schichtplan/schichten": "Dienst an einem Tag besetzen",
  "PUT /api/v1/lager/:p/traktanden/reihenfolge":
    "Reihenfolge der Traktanden ändern",
  "PUT /api/v1/lager/:p/wetter/ort": "Ort für das Wetter setzen",
  "PUT /api/v1/plattform/schalter":
    "Wartungsmodus oder Informationssperre für einen Bereich setzen oder ändern",
  "PUT /api/v1/programme/:p/leitung":
    "Eigene Anmeldung als Leitung melden oder ändern",
  "PUT /api/v1/programme/:p/teilnahmen/:p":
    "Teilnahme eines Kindes melden oder ändern",
  "PUT /api/v1/push-token":
    "Push-Token des Geräts für die aktuelle Sitzung hinterlegen",
  "PUT /api/v1/redaktion/seiten/:p/entwurf": "Entwurf speichern",
  "PUT /api/v1/redaktion/stufen/:p/eckdaten/:p":
    "Felder der Stufenseite für ein Datum pflegen",
  "PUT /api/v1/stufen/:p/anwesenheit/:p/kinder/:p":
    "Anwesenheit eines Kindes erfassen, ändern oder zurücknehmen",
  "PUT /api/v1/stufen/:p/anwesenheit/:p/leitende/:p":
    "Anwesenheit einer Leitungsperson erfassen, ändern oder zurücknehmen",
};
