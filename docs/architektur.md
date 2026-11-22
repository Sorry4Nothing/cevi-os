# Architektur

Cevi OS besteht aus einer App für iOS und Android und einem Server mit API und Datenbank. Die Programme kommen aus dem Outlook-Kalender der Abteilung, die Pushes laufen über Firebase Cloud Messaging (FCM). Dieses Dokument beschreibt den Aufbau von Version 1.

## Teile

### App

- Die iOS- und die Android-App sind nativ und liegen in eigenen Repos, nicht in diesem.
- Ihre Daten holt die App nur von der API, über HTTPS.
- Daten vom Server hält sie nur im Arbeitsspeicher. Auf dem Gerät bleibt nur das Sitzungs-Token, im geschützten Speicher des Systems.

### API

- Hono auf Node 26; zod prüft jede Eingabe.
- REST mit JSON unter `/api/v1`.
- Login und Sitzungen mit better-auth unter `/api/auth`. Dort sind nur acht Pfade offen, jeder andere liefert 404.
- Die Rechte prüft die API bei jeder Anfrage, nie die App. Jede Abfrage ist auf die Abteilung aus der Sitzung beschränkt.
- Tags (#331) ordnen Personen Gruppen zu; die Stufen der Abteilung sind Tags vom Typ `stufe`, und `stufe` und `rolle` sind seit Migration 0035 (#332) Sichten auf `tag` und `person_tag`, damit Code und ältere Apps unverändert bleiben. Das Modul `sichtbarkeit.ts` (#333) entscheidet nach `oeffentlich`, `angemeldet` oder einer Menge von Tags, wer ein Objekt sieht; `bearbeiten.ts` (#334) entscheidet, wer es bearbeitet (Leitung, Stufenleitung der Stufe oder eine Zeile in `bearbeiter`). Beide Module laufen in der API, nie in der App.
- Medien (#335): Nur Bilder liegen in einem S3-Bucket (Dateien zum Herunterladen sind Links auf das SharePoint, #428), die Zeile mit den Metadaten in der Tabelle `medium`. Die API prüft den Typ am Inhalt, kodiert Bilder neu und liefert jede Datei selbst aus, auch öffentliche; es gibt keine signierten Adressen. Ohne `MEDIEN_S3_*` in `deploy/.env` antworten die Routen mit 501.
- Ohne Login liefert sie ausserdem die Seiten `/datenschutz`, `/konto-loeschen` und `/support`, die die App-Stores verlangen, sowie `/health`. `/health` antwortet nur «ok» oder mit einem Fehler, ohne Details.
- Die Web-Verwaltung unter `/admin` besteht aus statischen Dateien aus `apps/api/public/admin`, ohne Build-Schritt. Sie enthalten keine Daten: Die Seite meldet sich über `/api/auth` an und ruft `/api/v1/admin/*` auf, mit Sitzung und zweitem Faktor. Die Antworten tragen eine strenge Content-Security-Policy (kein Inline-Skript, kein Inline-Stil, `frame-ancestors 'none'`).
- «Übersicht» und «System» der Verwaltung zeigen Betriebszahlen der laufenden API über `GET /api/v1/admin/system` und `/api/v1/admin/system/requests`: Bestand der Abteilung, Prozess, Datenbank und Anfragen nach Routenmuster mit Dauer und Fehlern. Die Anfragezähler liegen nur im Arbeitsspeicher der API (24 Stunden in Minuten-Eimern, ohne Query, Body, Header, IP und Personen) und sind nach jedem Neustart leer.

### Lager-Modul

- Ein Lager gehört einer Abteilung. Die Mitglieder haben je Lager eine Rolle (`lagerleitung`, `leitung`, `team`, `lesen`) in `lager_mitglied`, getrennt von Tags und Stufenrollen. Konten legt weiter die Abteilungsleitung an; Mitglied wird nur ein aktives Konto der Abteilung.
- Die Policy (`apps/api/src/lager/policy.ts`) liest die Rolle bei jeder Anfrage aus der Datenbank, nie aus Sitzung oder Token. Jede Lager-Route hängt `lagerZugriff(db, { recht })` vor ihren Handler. Reihenfolge: Lager der eigenen Abteilung laden (fremd 404), Mitgliedschaft (Nicht-Mitglied 404), Recht (403), Schreibschutz (409 `LAGER_GESCHLOSSEN` in abgeschlossenen und archivierten Lagern bei jeder Methode ausser GET, HEAD, OPTIONS).
- Die Abteilungsleitung (`person.admin`) gilt in Lagern der eigenen Abteilung als Lagerleitung. Lager anlegen, ändern und die Mitglieder setzen nur Admins unter `/api/v1/admin/lager`.
- Der Rechtekatalog (`apps/api/src/lager/rechte-katalog.ts`) nennt die 49 Rechte und die Standardmatrix als Daten; `darf(zugriff, recht)` fragt sie ab. Die Rechte von Leitung, Team und Lesen sind je Lager einstellbar (`lager_rolle_recht`, #365): Beim Anlegen eines Lagers werden die Standardwerte als Zeilen geschrieben, fehlt eine Zeile, gilt der Standard. Die Policy liest sie bei jeder Anfrage; die Lagerleitung hat keine Zeilen und immer alles. Lesen und Ändern (`/api/v1/lager/{id}/rechte`, Admin-Pendant unter `/api/v1/admin/lager/{id}/rechte`) nur Lagerleitung und Abteilungsleitung.
- Migrationen des Lager-Moduls liegen im Bereich 0060 bis 0099, von Hand geschrieben; `when` steigt streng (`test/migration-journal.test.ts`). Ein Rückweg liegt unter `apps/api/drizzle/rueckweg/`.
- Die Rechte-Matrix der Lager-Routen liegt in `apps/api/test/lager/matrix/<modul>.ts`, je Lager-Persona und Lager-Zustand; `rechte-matrix.test.ts` liest sie mit.
- Sync-Kern (#366): Jede Lager-Tabelle trägt `lagerSpalten()` (`apps/api/src/db/schema-lager.ts`: `version`, `lager_seq`, `erstellt_*`, `geaendert_*`, `geloescht_*`) und schreibt nur über `legeZeileAn`, `aendereZeile` und `loescheZeile` (`apps/api/src/lager/sync.ts`). Ein Schreibvorgang sperrt die Zeile des Lagers (`lager.seq` hochzählen), prüft `WHERE version = erwartet` (sonst 409 `VERSION_KONFLIKT` mit dem Stand der Zeile in der Ansicht der Rolle und den abweichenden Feldern), schreibt einen Eintrag in `lager_aenderung` und ruft die Haken für Revisionen auf. Die Sperre ordnet die Schreiber eines Lagers: Folgenummern ohne Lücke, Schreibvorgänge eines Lagers nacheinander. `GET /api/v1/lager/{id}/aenderungen?seit=` liefert seitenweise nur Objekttyp, ID, Art und Version, gefiltert nach Leserecht und Zeilenfilter der Rolle (Register `apps/api/src/lager/tabellen.ts`); ein zu alter Stand bekommt 410, ein Job entfernt Einträge nach 30 Tagen. Das Muster steht als Kommentar am Kopf von `sync.ts`.

### PostgreSQL

- PostgreSQL 18 hält die Daten von Cevi OS.
- In Produktion hat die Datenbank keinen veröffentlichten Port. Sie hängt nur im internen Netz des Servers.
- Die API verbindet sich mit einer eigenen Rolle ohne DDL-Rechte: Tabellen anlegen, umbauen oder entfernen darf sie nicht. Migrationen laufen mit der Besitzerrolle der Datenbank.

### Caddy

- Webserver vor der API, der einzige Dienst auf dem Server mit veröffentlichten Ports (80 und 443). Er läuft als gemeinsamer Edge-Caddy in einem eigenen Stack und erreicht die API über das Docker-Netz `edge-cevi-os` (siehe `docs/betrieb.md`, «Edge-Caddy»).
- HTTPS mit automatisch erneuerten Zertifikaten und HSTS.
- Leitet die Anfragen an die API weiter.

### Outlook-Kalender

- Der Kalender der Abteilung bleibt die Quelle der Programme.
- Die API liest ihn alle 5 Minuten über die veröffentlichte iCal-Adresse (`.ics`), ohne Konto und ohne Token.
- Die Adresse steht nur in der Datenbank. Wer sie kennt, liest den Kalender, ändern kann er ihn über sie nicht (Bedrohung 13 im [Bedrohungsmodell](sicherheit/bedrohungsmodell.md)).

### Push über FCM

- Die App holt ihr FCM-Registrierungstoken bei Firebase und registriert es bei der API.
- Die API schickt Pushes mit firebase-admin direkt an FCM (HTTP v1). FCM stellt sie über APNs (Apple) und an Android-Geräte zu.
- Meldet FCM ein Token als nicht mehr registriert, löscht die API es. Ohne Schlüsseldatei des Dienstkontos (`FCM_SCHLUESSEL_DATEI`) startet die API und sendet keine Pushes.
- Pushes haben einen Titel und einen Text (`notification.body`). Sie enthalten nie den Inhalt einer Chat-Nachricht und nie Namen von Kindern. Der Text einer Admin-Mitteilung oder Erinnerung stammt von den Admins; sie schreiben keine Namen hinein.
- Deep Link: Jeder Push trägt als Daten genau `typ` und `id`. Bei `typ: "chat"` ist `id` die Chat-ID, bei `typ: "programm"` die Programm-ID. Die App baut daraus das Ziel (Chat oder Programm-Detail), auch beim Kaltstart; die API liefert keine URL. Android-Kanäle: `chat` für Chat-Pushes, `programme` für Programm-Pushes. Die App legt sie an und kann pro Kanal stummschalten. Bei einer Änderung oder Absage eines Programms geht kein Push hinaus.
- Schalter: Jede Person steuert `pushChat` und `pushProgramme` selbst (`PATCH /api/v1/ich`, beide standardmässig an). Die API prüft sie beim Senden: Wer einen Schalter ausschaltet, bekommt diese Art Push nicht mehr, ohne dass das Token gelöscht wird. Den Push für den gerade offenen Chat unterdrückt die App.
- Anmelde-Push: Ändert sich die Teilnahme eines Kindes an einem Programm (`PUT /api/v1/programme/{id}/teilnahmen/{kindId}`, gleicher Wert zählt nicht), bekommen die Leitenden der Stufen des Programms einen Push (Titel «Neue Anmeldung» bzw. «Neue Abmeldung», Text «Programm am Datum», nie das Kind). Ausgenommen sind die handelnde Person und alle mit ausgeschaltetem `pushAnmeldungen` (Standard an, `GET /api/v1/ich` gibt ihn nur Personen mit Stufenrolle zurück). Typ `programm`, Kanal `programme`.
- Mitteilung aus der Verwaltung: Admins lösen sie von Hand aus (`POST /api/v1/admin/mitteilungen`). Der Push hat `typ: "mitteilung"`, leere `id`, den Android-Kanal `mitteilungen`, den Titel und die optionale Beschreibung als Text. Empfänger sind aktive Konten mit eingeschaltetem `pushProgramme` (in der Oberfläche «Mitteilungen»); höchstens 10 pro Abteilung und Stunde. Das Audit-Log hält Gruppe und Zahl fest, nie den Text.
- Server-Sent Events und Warteschlange (#367): `GET /api/v1/lager/{id}/ereignisse` meldet einer offenen Ansicht, dass es Neues gibt (`event: aenderung`, `{ bis, objekttypen }`, `id` ist die Folgenummer), ohne IDs, Namen oder Inhalte; den Inhalt holt die App über den Änderungsfeed. Der Verteiler (`apps/api/src/lager/ereignisse.ts`) hält die Verbindungen im Arbeitsspeicher der Instanz und bekommt seine Ereignisse aus dem Schreibpfad: Ein Haken des Sync-Kerns meldet nach dem Commit (`nachCommit` in `db/client.ts`; ein Rollback meldet nichts), mehrere Schreibvorgänge in 50 ms ergeben eine Meldung. Es gibt keine Abfragen im Takt: Der Herzschlag (25 Sekunden) fasst die Datenbank nicht an, und eine Kontrolle prüft alle fünf Minuten mit zwei Abfragen für alle Verbindungen der Instanz, ob Sitzung, Konto und Rolle noch stimmen; ohne offene Verbindung läuft kein Zeitgeber. Mitglieder- und Rechteänderungen der Verwaltung beenden die betroffenen Verbindungen sofort (`ende`, die App verbindet neu und bekommt ihre neuen lesbaren Typen). Obergrenzen: 3 je Konto (die älteste weicht), 100 je Lager, 200 je Instanz (429); ein Client, der nicht abholt, verliert die Verbindung. Wiederverbinden mit `Last-Event-ID` (oder `?seit=`) holt nach, was inzwischen geschah. Die Annahme ist eine API-Instanz: Bei mehreren Instanzen sendet der Haken `pg_notify` im Schreibvorgang (kommt erst beim Commit an), jede Instanz hört mit einer Verbindung auf `LISTEN` und ruft `melde()` auf; `beendeLager` und `beendePerson` gingen denselben Weg, und die Zähler der Obergrenzen und des Rate-Limits der Warteschlange müssten in die Datenbank. Gebaut ist das nicht.
- Die Warteschlange (#367) nimmt Offline-Änderungen an: `POST /api/v1/lager/{id}/aenderungen` mit bis zu 100 Operationen (`clientOpId`, `typ`, `nutzlast`; 256 KB, 20 Anfragen je Konto und Minute). Die Module melden ihre Operationen mit Recht und strengem zod-Schema in `lager/operationen.ts` an (`registriereOperation`); die Route setzt kein Recht, jede Operation wird gegen die Rolle der Person im Lager geprüft. Jede Operation läuft in einer eigenen Transaktion und bekommt ein Ergebnis: `ok` (IDs und Versionen), `konflikt` (der Versionskonflikt des Sync-Kerns mit Stand in der Ansicht der Rolle) oder `abgelehnt` (Code); ein Konflikt oder eine Ablehnung nimmt nur die Schreibvorgänge dieser Operation zurück. Idempotenz: Ein `ok` steht 30 Tage in `lager_client_op` (Lager, Person, `clientOpId`); der Anspruch auf die `clientOpId` und die Schreibvorgänge liegen in einer Transaktion, gleichzeitige Wiederholungen schreiben einmal. Konflikt und Ablehnung werden nicht gespeichert, sie haben nichts geschrieben.
- Pushes des Lagers (#369): Das Lager schreibt je Empfänger eine Zeile in `lager_benachrichtigung` (Art, Ziel, gelesen; kein Text) und pusht nach dem Commit (`benachrichtige()` in `lager/benachrichtigung.ts`, dann `senden()`). Empfänger sind nur aktive Mitglieder des Lagers; der Auslöser bekommt nichts, ebenso wer die Art in `/api/v1/ich/lager-benachrichtigungen` abgeschaltet hat (dann auch keine Zeile in der Liste). Der Titel ist ein fester Text je Art, der Text nur der Lagertitel: nie Namen, Aufgaben- oder Protokolltitel oder Inhalte. Neue `typ`-Werte: `lager_aufgabe`, `lager_erwaehnung`, `lager_pinnwand`, `lager_eingang`, `lager_einteilung`, `lager_anwesenheit`; `id` ist die ID des Objekts (nicht des Lagers). Weil der Push nur `typ` und `id` trägt, löst `GET /api/v1/lager/aufloesen/{typ}/{id}` das Lager auf (404, wenn die Person nicht dafür benachrichtigt wurde oder nicht Mitglied ist). Android-Kanäle: `lager_aufgaben` (`lager_aufgabe`), `lager_mitteilungen` (`lager_erwaehnung`, `lager_pinnwand`, `lager_eingang`), `lager_einteilung` (`lager_einteilung`, `lager_anwesenheit`); die App legt sie an. Gelesene Einträge löscht ein täglicher Lauf nach 90 Tagen. Es gibt keinen Mailversand.
- Höcks (#378): `hoeck` (Art `lagerleitung` oder `team`, Datum, Zeit als `HH:MM` ohne Zeitzone, Titel, Ort, Gäste), `traktandum` (Titel, Notizen, kurzer Entscheid, Links, Reihenfolge, Verantwortliche, Aufgabe; ohne Höck = «nächster Höck») und `hoeck_anwesenheit` (ein Haken je Person) laufen über den Sync-Kern (ausser den Haken). `GET /api/v1/lager/{id}/hoecks/{hoeckId}` lädt Höck und Traktanden in zwei Abfragen, `.../modus` den Höck-Modus (Höck, Traktanden, Mitglieder mit Haken, Ressort-Runde) in vier, unabhängig von der Zahl der Traktanden. Das Team liest nur Team-Höcks mit Datum, Zeit, Titel und Ort. `GET .../hoecks/{hoeckId}.ics` liefert `text/calendar` mit nur Titel, Ort, Datum und Zeit (`ETag`, `Cache-Control: private, no-cache`). Das Protokoll liegt als Verknüpfung im SharePoint (#379); der Entscheid je Traktandum bleibt als Text und wird in `GET .../entscheide` gesammelt.

## Wer spricht mit wem

| Von             | Zu                                  | Weg                          | Wozu                                                                                                          |
| --------------- | ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App             | Caddy                               | HTTPS                        | Login, Programme, Anmeldungen, Chat, Push-Token registrieren                                                  |
| Browser         | Caddy                               | HTTPS                        | Seiten `/datenschutz`, `/konto-loeschen`, `/support` und die Verwaltung `/admin`                              |
| Uptime-Dienst   | Caddy                               | HTTPS                        | `/health` abfragen, Alarm bei Fehler                                                                          |
| Caddy           | API                                 | internes Netz des Servers    | Anfragen weiterleiten                                                                                         |
| Caddy           | Zertifizierungsstelle               | HTTPS (ACME)                 | Zertifikate holen und erneuern                                                                                |
| API             | PostgreSQL                          | internes Netz, eigene Rolle  | Daten lesen und schreiben                                                                                     |
| Migrationen     | PostgreSQL                          | Besitzerrolle der Datenbank  | Tabellen anlegen und umbauen                                                                                  |
| Backup (restic) | S3-Speicher in der Schweiz          | HTTPS                        | Verschlüsselte Backups ablegen, täglich und vor jedem Deploy                                                  |
| API             | S3-Speicher der Medien              | HTTPS, S3-Zugangsschlüssel   | Bilder der Medien ablegen, lesen und löschen (eigener Bucket, nicht der des Backups)                 |
| API             | Outlook-Kalender (iCal)             | HTTPS, geheime Adresse       | Termine lesen, alle 5 Minuten                                                                                 |
| API             | Pwned Passwords (Have I Been Pwned) | HTTPS                        | Neue Passwörter mit bekannten Datenlecks abgleichen; gesendet werden nur die ersten 5 Zeichen des SHA-1-Hashs |
| App             | Firebase (FCM)                      | HTTPS                        | Push-Token holen                                                                                              |
| API             | FCM                                 | HTTPS, firebase-admin        | Pushes senden                                                                                                 |
| FCM             | Gerät                               | über APNs (Apple) und Google | Pushes zustellen                                                                                              |

Wie Cevi OS die Daten schützt und welche Risiken bleiben, steht im [Bedrohungsmodell](sicherheit/bedrohungsmodell.md).
