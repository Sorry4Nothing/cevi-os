# Architektur

Cevi OS besteht aus einer App für iOS und Android und einem Server mit API und Datenbank. Die Programme kommen aus dem Google-Kalender der Abteilung, die Pushes laufen über Expo. Dieses Dokument beschreibt den Aufbau von Version 1.

## Teile

### App

- Expo mit expo-router, eine Codebasis für iOS und Android.
- Ihre Daten holt die App nur von der API, über HTTPS.
- Daten vom Server hält sie nur im Arbeitsspeicher. Auf dem Gerät bleibt nur das Sitzungs-Token, im geschützten Speicher des Systems (Secure Store).

### API

- Hono auf Node 26; zod prüft jede Eingabe.
- REST mit JSON unter `/api/v1`.
- Login und Sitzungen mit better-auth unter `/api/auth`. Dort sind nur acht Pfade offen, jeder andere liefert 404.
- Die Rechte prüft die API bei jeder Anfrage, nie die App. Jede Abfrage ist auf die Abteilung aus der Sitzung beschränkt.
- Ohne Login liefert sie ausserdem die Seiten `/datenschutz`, `/konto-loeschen` und `/support`, die die App-Stores verlangen, sowie `/health`. `/health` antwortet nur «ok» oder mit einem Fehler, ohne Details.

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

### Push über Expo

- Die App holt ihr Push-Token bei Expo und registriert es bei der API.
- Die API schickt Pushes mit expo-server-sdk an den Expo Push Service. Er stellt sie über APNs (Apple) und FCM (Google) zu.
- Pushes enthalten nie Nachrichtentext und nie Namen von Kindern.

## Wer spricht mit wem

| Von               | Zu                                  | Weg                                | Wozu                                                                                                          |
| ----------------- | ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App               | Caddy                               | HTTPS                              | Login, Programme, Anmeldungen, Chat, Push-Token registrieren                                                  |
| Browser           | Caddy                               | HTTPS                              | Seiten `/datenschutz`, `/konto-loeschen` und `/support`                                                       |
| Caddy             | API                                 | internes Netz des Servers          | Anfragen weiterleiten                                                                                         |
| Caddy             | Zertifizierungsstelle               | HTTPS (ACME)                       | Zertifikate holen und erneuern                                                                                |
| API               | PostgreSQL                          | internes Netz, eigene Rolle        | Daten lesen und schreiben                                                                                     |
| Migrationen       | PostgreSQL                          | Besitzerrolle der Datenbank        | Tabellen anlegen und umbauen                                                                                  |
| Backup (restic)   | S3-Speicher in der Schweiz          | HTTPS                              | Verschlüsselte Backups ablegen, täglich und vor jedem Deploy                                                  |
| API               | Google Calendar API                 | HTTPS, Service-Account             | Termine lesen, alle 5 Minuten                                                                                 |
| API               | Pwned Passwords (Have I Been Pwned) | HTTPS                              | Neue Passwörter mit bekannten Datenlecks abgleichen; gesendet werden nur die ersten 5 Zeichen des SHA-1-Hashs |
| App               | Expo                                | HTTPS                              | Push-Token holen                                                                                              |
| API               | Expo Push Service                   | HTTPS, expo-server-sdk             | Pushes senden                                                                                                 |
| Expo Push Service | Gerät                               | über APNs (Apple) und FCM (Google) | Pushes zustellen                                                                                              |

Wie Cevi OS die Daten schützt und welche Risiken bleiben, steht im [Bedrohungsmodell](sicherheit/bedrohungsmodell.md).
