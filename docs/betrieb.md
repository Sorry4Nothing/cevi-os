# Betrieb

Abläufe für den Betrieb von Cevi OS; hier stehen Server, Konten, Deploy, die Release-Checkliste, Backups, Überwachung, Logs und der Ablauf bei einer Datenpanne.

## Server

- Ein VPS in der Schweiz; Anbieter und Domain sind noch offen (#68).
- Auf dem Server laufen Linux mit systemd-journald, die Docker Engine mit dem Compose-Plugin und git.
- Härtung (#68): SSH nur mit Schlüssel und nur für zwei Personen, Firewall, automatische Sicherheitsupdates. Nach der Einrichtung bestätigt ein Portscan von aussen, dass nur SSH, 80 und 443 offen sind.
- Das Repo liegt auf dem Server als Checkout des ausgerollten Tags. Befehle in dieser Doku laufen im Wurzelordner dieses Checkouts.
- Nur auf dem Server, nie im Repo: `deploy/.env` (Rechte 600, Vorlage `deploy/.env.example`) und der Schlüssel des Google-Service-Accounts unter `deploy/secrets/` (Ordner 700, Datei 400).

## Konten

Der Betrieb braucht diese Konten: Apple Developer Program, Google Play Console, Expo, das Google-Konto des Cloud-Projekts, Hoster, DNS, S3-Speicher, Uptime-Dienst und GitHub (Repo und GHCR). Hier stehen Rollen, keine Personen. Für jedes Konto gilt:

- Zwei-Faktor-Anmeldung.
- Wo der Dienst es erlaubt, hat eine zweite Person Zugriff.
- Die Wiederherstellungscodes liegen in einem Passwort-Tresor, den auch die Abteilungsleitung öffnen kann.
- Das Expo-Konto ist so heikel wie der Server: EAS Update signiert im Gratis-Plan nicht; wer das Konto übernimmt, kann Code auf alle Geräte schicken.

## Deploy

Erste Einrichtung auf dem Server:

1. Das Repo klonen und den Release-Tag auschecken: `git fetch --tags && git checkout vX.Y.Z`
2. `deploy/.env.example` nach `deploy/.env` kopieren und die Werte setzen (Passwörter hexadezimal, etwa aus `openssl rand -hex 32`), dann `chmod 600 deploy/.env`
3. Den Schlüssel des Google-Service-Accounts (#26) nach `deploy/secrets/google-service-account.json` legen: Ordner 700, Datei 400, Besitzer `1000:1000` (die UID der API im Container)
4. `deploy/Caddyfile` mit `reverse_proxy api:3000` anlegen (#68)
5. Nach dem ersten Tag das API-Image auf GHCR öffentlich schalten (#70), sonst findet der Server es nicht

Jedes Release rollt `deploy/deploy.sh vX.Y.Z` aus, nach `git fetch --tags && git checkout vX.Y.Z`. Das Skript aktualisiert die Images von postgres und caddy, sichert die Datenbank (siehe «Backups»), setzt die Passwörter der Datenbankrollen aus `deploy/.env`, führt die Migrationen mit der Besitzerrolle aus — nur vorwärts, nie zurück —, startet alle Dienste mit dem Tag neu und stoppt jeden Dienst ausser caddy, der einen Port veröffentlicht.

Das erste Admin-Konto folgt mit #20.

## Release-Checkliste

Sie läuft von Hand vor jedem Store-Release: einmal auf Android und einmal auf einem iPhone, mit dem `production`-Build aus `main` über TestFlight bzw. einen Testtrack der Play Console, nur in der Demo-Abteilung der Produktion (Screenshots nur von dort). Voraussetzung: Die Demo-Abteilung hat ein Demo-Kind in einer Stufe und ein Programm, das Eltern sehen (#76).

- [ ] Demo-Konten für das Review aktivieren (#76)
- [ ] Ein Admin der Demo-Abteilung meldet sich mit zweitem Faktor an und legt eine Person an: ein Elternteil eines Demo-Kindes, mit erfundenem Namen
- [ ] Mit der neuen Person: Login mit Startpasswort, Passwort setzen, App-Sperre
- [ ] Programm öffnen und Kind mit Ja/Nein melden
- [ ] Nachricht im Gruppenchat
- [ ] «Kontakt» öffnet den Einzelchat
- [ ] Nach dem Review die Demo-Konten und die angelegten Personen wieder deaktivieren

Die Schritte vom Anmelden des Admins bis «Kontakt» laufen auf jedem Gerät einmal, jedes Mal mit einer neu angelegten Person, denn das Startpasswort gilt nur für die erste Anmeldung. Aktivieren und Deaktivieren laufen einmal vor und einmal nach beiden Durchgängen.

## Backups

- Vor jeder Migration sichert `deploy/deploy.sh` die Datenbank mit `pg_dump -Fc` nach `vor-deploy.dump` im Volume von postgres. Der alte Dump bleibt, bis der neue vollständig ist.
- Tägliche, verschlüsselte Backups mit restic folgen mit #71.

## Überwachung

`/health` antwortet ohne Login mit `ok` (Status 200) oder `fehler` (Status 503). `fehler` heisst: Die Datenbank ist nicht erreichbar oder ihre Tabellen fehlen, oder bei einer Abteilung mit Kalender (auch der Demo-Abteilung) liegt der letzte erfolgreiche Sync mehr als 30 Minuten zurück. Den Grund nennt nur das Log der API, nie die Antwort. Ist die Datenbank nicht erreichbar, dauert die Antwort rund 5 Sekunden.

Ein kostenloser Uptime-Dienst ruft `/health` auf; er sieht nur `ok` oder `fehler`. Anforderungen:

- Gratis-Plan; für das Konto gelten die Regeln aus «Konten».
- HTTPS-Check auf `https://<Domain>/health`, im kürzesten Intervall des Gratis-Plans. HEAD oder GET: Die API beantwortet HEAD wie GET, samt Status.
- Timeout über 5 Sekunden, damit der langsame 503 noch als Antwort zählt.
- Alarm bei jedem Status ausser 200 und wenn keine Antwort kommt.
- Alarm per E-Mail an die betreuende Person und, wo der Dienst es erlaubt, an eine zweite Person.

Nach der Einrichtung einmal mit der Abfrage unter «Bei Alarm» prüfen, dass jede Abteilung mit Kalender ein `sync_ok_am` hat: Eine Abteilung, die noch nie erfolgreich synchronisiert hat, löst den Sync-Alarm nie aus.

Kein Sentry in V1 (Datenschutz); später neu prüfen.

Bei Alarm:

1. Das API-Log der letzten Stunde lesen: `docker compose -f deploy/docker-compose.prod.yml logs --since 1h api`
2. Den Sync-Stand abfragen (die `id` entspricht den `abteilungIds` im Log): `docker compose -f deploy/docker-compose.prod.yml exec postgres psql -U postgres -d cevi_os -c "select id, name, google_kalender_id is not null as kalender, sync_ok_am, now() - sync_ok_am as sync_alter, sync_fehler from abteilung"`

Alarmtest, einmal nach der Einrichtung:

1. Mit der Abfrage oben prüfen, dass jede Abteilung mit `kalender` ein `sync_alter` von wenigen Minuten zeigt.
2. Den Schlüssel unlesbar machen: `sudo chmod 000 deploy/secrets/google-service-account.json`. Die API läuft weiter, aber jeder Sync-Lauf scheitert. Nicht die Datei verschieben (per Bind eingebunden bliebe sie im Container sichtbar) und nicht `api` oder ein Netz stoppen (der Alarm käme aus einem anderen Grund).
3. 30 Minuten nach dem letzten erfolgreichen Sync antwortet `/health` mit 503, und der Uptime-Dienst gibt Alarm.
4. Zurücksetzen: `sudo chmod 400 deploy/secrets/google-service-account.json`, der Besitzer bleibt `1000`. Der nächste Sync-Lauf folgt innert 5 Minuten, danach meldet der Uptime-Dienst die Erholung.

## Logs

Alle Dienste aus `deploy/docker-compose.prod.yml` loggen über den journald-Treiber von Docker. journald löscht nach Alter statt nach Grösse: Server-Logs und Container-Logs, auch die von Caddy, bleiben so 14 Tage.

Lesen:

- `docker compose -f deploy/docker-compose.prod.yml logs <dienst>`
- `sudo journalctl CONTAINER_NAME=<Name>`; die Namen zeigt `docker compose -f deploy/docker-compose.prod.yml ps`. Für schon entfernte Container (etwa die Migration aus `docker compose run`) listet `sudo journalctl -F CONTAINER_NAME` alle Namen, die journald kennt.

Was in den Logs steht:

- API: eine JSON-Zeile pro Anfrage mit `requestId`, Routen-Muster und Status, ohne Personendaten. Der Healthcheck des Containers ruft `/health` alle 5 Sekunden auf, rund 17'000 Zeilen pro Tag; das Löschen nach Alter fängt das auf.
- Caddy: IP-Adressen. Caddy schreibt auf stderr und damit nach journald; keine Log-Datei, kein Volume.
- PostgreSQL: Fehlerzeilen können Werte aus Abfragen zitieren, etwa `DETAIL: Key (…)=(…)` oder `STATEMENT: …`.

Die Ausgabe von `docker compose run` landet im Log des Dienstes und bleibt 14 Tage; die Ausgabe von `docker compose exec` landet in keinem Log.

Auf dem Server begrenzt ein Drop-in journald auf 14 Tage, als `/etc/systemd/journald.conf.d/60-cevi-os.conf`:

```ini
[Journal]
Storage=persistent
MaxRetentionSec=14day
MaxFileSec=1day
```

Danach `sudo systemctl restart systemd-journald`; prüfen mit `systemd-analyze cat-config systemd/journald.conf`. `MaxRetentionSec` löscht ganze Journal-Dateien; ohne `MaxFileSec=1day` wechselten die Dateien nur monatlich, und Einträge blieben Wochen über die 14 Tage hinaus. `Storage=persistent` legt die Logs auf die Platte; der Standardwert ist beim Kompilieren festgelegt, und `auto` hielte sie ohne `/var/log/journal` nur im RAM.

Andere Log-Dateien auf dem Server, etwa die eines Syslog-Dienstes mit den IP-Adressen von SSH-Clients: ebenfalls höchstens 14 Tage aufbewahren oder den Schreiber abschalten. Die Befehle dazu hängen vom System ab (#68).

## Datenpanne

Der Ablauf gilt, sobald Daten in falsche Hände geraten sein könnten, etwa durch ein gekapertes Konto, ein geleaktes Geheimnis oder eine kopierte Datenbank. Es handeln Rollen, keine bestimmten Personen: Wer den Server betreibt, führt die Befehle aus; der Vorstand entscheidet und meldet.

1. **Alle Sitzungen beenden:** `npm run sitzungen:beenden -w apps/api`. Der Befehl liest `DATABASE_URL` aus der Umgebung oder aus `apps/api/.env` und meldet «Beendete Sitzungen: n». Alle müssen sich neu anmelden; Konten, Passwörter und zweite Faktoren bleiben.
2. **Den Vorstand informieren.** Bedeutet die Panne wahrscheinlich ein hohes Risiko für die betroffenen Personen, geht so rasch als möglich eine Meldung an den EDÖB über <https://databreach.edoeb.admin.ch/report> (Art. 24 Abs. 1 DSG), ohne auf die Schritte 3 und 4 zu warten; noch fehlende Angaben folgen so rasch als möglich (Art. 15 Abs. 2 DSV).
3. **Geheimnisse wechseln,** jedes einzeln:
   - Auth-Geheimnis: in `BETTER_AUTH_SECRET` einen neuen Zufallswert setzen und die API neu starten. Alte Cookies gelten dann nicht mehr, und die gespeicherten TOTP-Geheimnisse und Ersatzcodes lassen sich nicht mehr entschlüsseln: Kein Admin besteht den zweiten Faktor, bis er neu eingerichtet ist (Schritt 4). Den alten Wert vollständig entfernen, auch nicht als ältere Version in `BETTER_AUTH_SECRETS` behalten: Wer ihn kennt, könnte damit weiterhin Codes berechnen.
   - Passwörter der Datenbankrollen (#69).
   - Google-Service-Account: einen neuen Schlüssel erzeugen, ihn überall einsetzen, wo der alte lag, die API neu starten und erst dann den alten Schlüssel löschen (#26, #27, #69).
   - Expo-Zugriffstoken (#43).
   - restic- und S3-Schlüssel (#71).
4. **Gekapertes Konto sperren, dann zweite Faktoren neu einrichten.** Nach Schritt 3 besteht kein Admin den zweiten Faktor. Die CLI (#23) setzt den Faktor genau eines vertrauenswürdigen Admins zurück; diese Person meldet sich an und richtet ihren Faktor neu ein. Dann deaktiviert sie das gekaperte Konto oder gibt ihm ein neues Startpasswort (#18); nie den Faktor eines Kontos zurücksetzen, solange sein altes Passwort noch gilt, sonst richtet die fremde Person den neuen Faktor selbst ein. Danach setzt sie die Faktoren der übrigen Admins zurück (#23), und diese richten ihre neu ein. Bleibt kein vertrauenswürdiger Admin übrig, legt die CLI (#20) einen neuen an.
5. **Dokumentieren:** die Tatsachen rund um die Panne, ihre Auswirkungen und die getroffenen Massnahmen (Art. 15 Abs. 4 DSV), dazu ob gemeldet wurde und warum. Die Dokumentation bleibt mindestens zwei Jahre erhalten, nie im Repo, in Issues oder in PRs.
