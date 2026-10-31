# Architektur

Cevi OS besteht aus einer App für iOS und Android und einem Server mit API und Datenbank. Die Programme kommen aus dem Google-Kalender der Abteilung, die Pushes laufen über Firebase Cloud Messaging (FCM). Dieses Dokument beschreibt den Aufbau von Version 1.

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
- Ohne Login liefert sie ausserdem die Seiten `/datenschutz`, `/konto-loeschen` und `/support`, die die App-Stores verlangen, sowie `/health`. `/health` antwortet nur «ok» oder mit einem Fehler, ohne Details.
- Die Web-Verwaltung unter `/admin` besteht aus statischen Dateien aus `apps/api/public/admin`, ohne Build-Schritt. Sie enthalten keine Daten: Die Seite meldet sich über `/api/auth` an und ruft `/api/v1/admin/*` auf, mit Sitzung und zweitem Faktor. Die Antworten tragen eine strenge Content-Security-Policy (kein Inline-Skript, kein Inline-Stil, `frame-ancestors 'none'`).
- «Übersicht» und «System» der Verwaltung zeigen Betriebszahlen der laufenden API über `GET /api/v1/admin/system` und `/api/v1/admin/system/requests`: Bestand der Abteilung, Prozess, Datenbank und Anfragen nach Routenmuster mit Dauer und Fehlern. Die Anfragezähler liegen nur im Arbeitsspeicher der API (24 Stunden in Minuten-Eimern, ohne Query, Body, Header, IP und Personen) und sind nach jedem Neustart leer.

### PostgreSQL

- PostgreSQL 18 hält die Daten von Cevi OS.
- In Produktion hat die Datenbank keinen veröffentlichten Port. Sie hängt nur im internen Netz des Servers.
- Die API verbindet sich mit einer eigenen Rolle ohne DDL-Rechte: Tabellen anlegen, umbauen oder entfernen darf sie nicht. Migrationen laufen mit der Besitzerrolle der Datenbank.

### Caddy

- Webserver vor der API, der einzige Dienst mit veröffentlichten Ports (80 und 443).
- HTTPS mit automatisch erneuerten Zertifikaten und HSTS.
- Leitet die Anfragen an die API weiter.

### Google-Kalender

- Der Kalender der Abteilung bleibt die Quelle der Programme.
- Die API liest ihn alle 5 Minuten mit einem Service-Account und dem Scope `calendar.events.readonly`.
- Die ID des Kalenders steht nur in der Datenbank.
- Nur lesen kann der Service-Account, weil der Kalender für ihn nur mit der Freigabe «Alle Termindetails sehen» geteilt ist. Der Scope allein verhindert das Schreiben nicht: Wer den Schlüssel hat, wählt den Scope selbst (Bedrohung 13 im [Bedrohungsmodell](sicherheit/bedrohungsmodell.md)).

### Push über FCM

- Die App holt ihr FCM-Registrierungstoken bei Firebase und registriert es bei der API.
- Die API schickt Pushes mit firebase-admin direkt an FCM (HTTP v1). FCM stellt sie über APNs (Apple) und an Android-Geräte zu.
- Meldet FCM ein Token als nicht mehr registriert, löscht die API es. Ohne Schlüsseldatei des Dienstkontos (`FCM_SCHLUESSEL_DATEI`) startet die API und sendet keine Pushes.
- Pushes enthalten nie Nachrichtentext und nie Namen von Kindern.
- Deep Link: Jeder Push trägt als Daten genau `typ` und `id`. Bei `typ: "chat"` ist `id` die Chat-ID, bei `typ: "programm"` die Programm-ID. Die App baut daraus das Ziel (Chat oder Programm-Detail), auch beim Kaltstart; die API liefert keine URL. Android-Kanäle: `chat` für Chat-Pushes, `programme` für Programm-Pushes. Die App legt sie an und kann pro Kanal stummschalten.
- Schalter: Jede Person steuert `pushChat` und `pushProgramme` selbst (`PATCH /api/v1/ich`, beide standardmässig an). Die API prüft sie beim Senden: Wer einen Schalter ausschaltet, bekommt diese Art Push nicht mehr, ohne dass das Token gelöscht wird. Den Push für den gerade offenen Chat unterdrückt die App.
- Anmelde-Push: Ändert sich die Teilnahme eines Kindes an einem Programm (`PUT /api/v1/programme/{id}/teilnahmen/{kindId}`, gleicher Wert zählt nicht), bekommen die Leitenden der Stufen des Programms einen Push («Neue Anmeldung für …» bzw. «Neue Abmeldung für …», nur Programm und Datum). Ausgenommen sind die handelnde Person und alle mit ausgeschaltetem `pushAnmeldungen` (Standard an, `GET /api/v1/ich` gibt ihn nur Personen mit Stufenrolle zurück). Typ `programm`, Kanal `programme`.

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
| API             | Google Calendar API                 | HTTPS, Service-Account       | Termine lesen, alle 5 Minuten                                                                                 |
| API             | Pwned Passwords (Have I Been Pwned) | HTTPS                        | Neue Passwörter mit bekannten Datenlecks abgleichen; gesendet werden nur die ersten 5 Zeichen des SHA-1-Hashs |
| App             | Firebase (FCM)                      | HTTPS                        | Push-Token holen                                                                                              |
| API             | FCM                                 | HTTPS, firebase-admin        | Pushes senden                                                                                                 |
| FCM             | Gerät                               | über APNs (Apple) und Google | Pushes zustellen                                                                                              |

Wie Cevi OS die Daten schützt und welche Risiken bleiben, steht im [Bedrohungsmodell](sicherheit/bedrohungsmodell.md).
