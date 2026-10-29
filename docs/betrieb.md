# Betrieb

Abläufe für den Betrieb von Cevi OS; hier stehen Server, Konten, Deploy, Release, Release-Checkliste, Backups, Überwachung, Logs und der Ablauf bei einer Datenpanne. Ausgerollt wird nur von `main`.

## Server

- Ein VPS in der Schweiz; Anbieter und Domain sind noch offen (#68).
- Auf dem Server laufen Linux mit systemd-journald, die Docker Engine mit dem Compose-Plugin und git.
- Härtung (#68): SSH nur mit Schlüssel und nur für zwei Personen, Firewall, automatische Sicherheitsupdates. Nach der Einrichtung bestätigt ein Portscan von aussen, dass nur SSH, 80 und 443 offen sind.
- Das Repo liegt auf dem Server als Checkout des ausgerollten Tags. Befehle in dieser Doku laufen im Wurzelordner dieses Checkouts, jene im Abschnitt «Backups» im Ordner `deploy/`.
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

Das erste Admin-Konto legt die CLI im laufenden API-Container an, in `deploy/`: `docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/admin-anlegen.ts --benutzername <name> --name "<Vorname Nachname>" --neue-abteilung "<Name>"`. Sie zeigt das Startpasswort genau einmal. Immer `exec`, nie `run`: Die Ausgabe von `run` landet für 14 Tage im journald (siehe «Logs»), die von `exec` in keinem Log.

## Release

Die App-Version ist `expo.version` in `apps/mobile/app.json`, genau in der Form `X.Y.Z`: Jede andere Form behandelt die API als veraltet (426), und der Tag passt nicht mehr zu ihr. Der Tag eines Releases ist `v` plus diese Version. Build-Nummern vergibt EAS selbst (`appVersionSource: "remote"` und `autoIncrement` in `apps/mobile/eas.json`).

1. Versions-PR nach `develop`: hebt `expo.version` auf `X.Y.Z`, unter einem Issue wie jeder PR. Versionen steigen nur.
2. Release-PR von `develop` nach `main`, gemergt mit «Create a merge commit» ([GIT_WORKFLOW.md](GIT_WORKFLOW.md) sagt warum).
3. Tag von Hand auf dem Merge-Commit, annotiert: `git fetch origin`, dann `git tag -a vX.Y.Z -m "Release X.Y.Z" origin/main` und `git push origin vX.Y.Z`. Kein Workflow erzeugt Tags.
4. Warten, bis der Workflow «Image» ([`.github/workflows/image.yml`](../.github/workflows/image.yml)) grün ist: Er prüft, dass der Tag `vX.Y.Z` heisst und zur App-Version passt, baut das API-Image und legt es als `ghcr.io/sorry4nothing/cevi-os-api:vX.Y.Z` in GHCR ab. Ein falscher Tag baut kein Image.
5. Auf dem Server ausrollen: den Tag auschecken, dann `deploy/deploy.sh vX.Y.Z` (Backup, Migration, Neustart, Portprüfung).
6. Nur wenn sich die App geändert hat: Store-Build oder EAS Update, siehe unten.

Ein Tag, dessen Lauf ein Image gebaut hat, wird nie verschoben, gelöscht oder neu vergeben. Hat der Lauf keines gebaut, weil die Tag-Prüfung oder der Build rot war: den Tag löschen (`git push origin --delete vX.Y.Z` und `git tag -d vX.Y.Z`), die Ursache per PR beheben und neu taggen.

`APP_MIN_VERSION` in `deploy/.env` auf dem Server steigt nur, um eine alte App auszusperren, und erst, wenn die neue Version in beiden Stores ist.

### Store-Build oder EAS Update

`eas build --profile production`, `eas submit` und EAS Update auf dem Kanal `production` laufen nur von `main` und startet eine benannte Person von Hand, in `apps/mobile`:

- Vorher ein sauberer Checkout von `main`, dessen HEAD der Tag ist: `git describe --tags --exact-match` gibt `vX.Y.Z` aus. Danach im Wurzelordner `npm ci`, denn Export und Fingerprint rechnen mit den lokalen Paketen.
- Will eas-cli dabei eine Datei ändern, abbrechen und die Änderung per PR über `develop` bringen.

Nach einer nativen Änderung — ein neues oder aktualisiertes Paket mit nativem Code, ein Expo-SDK-Update oder eine Änderung an `app.json` (ausser `expo.version`, die der Fingerprint ignoriert) — braucht es einen Store-Build:

```sh
npx eas-cli build --profile production --platform all
npx eas-cli submit --platform android --latest
npx eas-cli submit --platform ios --latest
```

Nach dem Submit läuft die «Release-Checkliste» unten, bevor das Release in den Stores freigegeben wird.

Für eine reine JavaScript-Korrektur reicht ein EAS Update; sie ist trotzdem ein Release mit neuer Version, Tag und Image, nur der App-Teil geht als Update statt als Build. Die App nimmt ein Update nur an, wenn sein Fingerprint dem des installierten Builds entspricht (`runtimeVersion` mit `policy: "fingerprint"` in `app.json`); ein Update mit nativer Änderung erreicht installierte Builds also nicht. Vorher pro Plattform die ID des letzten Produktions-Builds holen und den Fingerprint vergleichen:

```sh
npx eas-cli build:list --build-profile production --status finished --limit 1 --platform android
npx eas-cli build:list --build-profile production --status finished --limit 1 --platform ios
npx eas-cli fingerprint:compare --build-id <ID> --environment production
```

Sind die Fingerprints auf beiden Plattformen gleich, das Update veröffentlichen; `--environment production` lädt dabei keine lokale `.env`:

```sh
npx eas-cli update --channel production --environment production --message "vX.Y.Z"
```

Sonst Store-Build und Submit statt Update.

### Kein `EXPO_TOKEN` in GitHub Actions

EAS Update signiert im Gratis-Plan nicht: Wer das Expo-Konto übernimmt, kann Code auf alle Geräte schicken. Darum gibt es kein `EXPO_TOKEN` in GitHub Actions, und kein Workflow spricht mit EAS.

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

`deploy/backup.sh` sichert die Datenbank verschlüsselt mit [restic](https://restic.net) auf einen S3-Speicher in der Schweiz: täglich per Cron und vor jedem Deploy (`deploy.sh` ruft das Skript auf). restic behält 30 tägliche und 3 monatliche Stände; Älteres räumt das Skript bei jedem Lauf weg. Solange noch keine Migrationen gelaufen sind, beendet es sich ohne Backup.

### Nicht im Backup

- Sitzungen, offene Bestätigungscodes, die Schlüssel des Rate-Limits und Push-Tokens (Tabellen `session`, `verification`, `rate_limit`, `push_token`): Sitzungen enthalten Tokens, und Push-Tokens hängen an ihrer Sitzung. **Nach einer Wiederherstellung melden sich darum alle neu an.**
- Dateien auf dem Server: `deploy/.env` (Passwörter und restic-Schlüssel), `deploy/secrets/google-service-account.json` und die Zertifikate von Caddy. Caddy holt Zertifikate selbst neu; die beiden Dateien sind ohne eigene Kopie verloren.

Das Skript bricht ohne Backup ab, wenn eine andere Tabelle per Fremdschlüssel auf eine ausgeschlossene verweist, denn solche Zeilen machten die ganze Wiederherstellung ungültig. Dann die Ausschlussliste in `deploy/backup.sh` nachführen. Fehlt eine ausgeschlossene Tabelle dagegen noch (beim Deploy läuft das Backup vor der Migration, die sie anlegt), warnt das Skript nur und sichert ohne sie; die Prüfung meldet eine solche Tabelle im zurückgespielten Stand ebenfalls nur als Hinweis.

### Schlüssel

Das Archiv hat drei Schlüssel; jeder entschlüsselt alles:

| Wer               | Ablage                                          |
| ----------------- | ----------------------------------------------- |
| Server            | `RESTIC_PASSWORD` in `deploy/.env` (Rechte 600) |
| Betreuende Person | eigenes Passwort, selbst verwahrt               |
| Abteilungsleitung | versiegelt im Tresor der Abteilung              |

Wiederherstellen kann nur, wer zusätzlich Zugang zum S3-Speicher hat. Mit nur lesendem S3-Zugang braucht jeder restic-Befehl zusätzlich `--no-lock`.

Jeder Schlüssel kann das Archiv auch löschen. Der Schutz dagegen liegt beim Anbieter: Versionierung oder Object Lock für 30 Tage, eine Regel, die alte Versionen nach 30 Tagen entfernt, und ein Server-Zugangsschlüssel, der Versionen weder löschen noch den Schutz aufheben darf. Gelöschte Daten können so bis 30 Tage über die Aufbewahrung hinaus im Speicher liegen.

### Einrichtung

1. Beim Anbieter einen Bucket mit dem Schutz von oben anlegen.
2. In `deploy/.env` die restic-Werte aus `deploy/.env.example` füllen.
3. Archiv anlegen: `docker compose -f docker-compose.prod.yml run --rm backup init`
4. Die zwei weiteren Schlüssel anlegen; die Eingabe erfolgt an der Eingabeaufforderung und landet nie in Dateien oder im Verlauf:
   - `docker compose -f docker-compose.prod.yml run --rm backup key add --user betreuung`
   - `docker compose -f docker-compose.prod.yml run --rm backup key add --user abteilungsleitung`
5. Cron-Eintrag im Konto, das auch `deploy.sh` ausführt; 03:15 gibt es an beiden Tagen der Zeitumstellung genau einmal:
   `15 3 * * * <Pfad zum Repo>/deploy/backup.sh 2>&1 | logger -t cevi-os-backup`

### Prüfung einmal pro Quartal

Auf dem Server, nie auf einem persönlichen Rechner: `deploy/backup.sh pruefen` spielt den letzten Stand in einen Wegwerf-Container ohne Netz zurück, zählt die Zeilen je Tabelle neben dem Live-Stand (nur Zahlen) und öffnet psql für Stichproben. Danach löscht das Skript den Container samt Daten.

### Ernstfall: leere Datenbank

1. `docker compose -f docker-compose.prod.yml up -d --wait postgres`
2. Rollen anlegen: `docker compose -f docker-compose.prod.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d cevi_os < ../apps/api/src/db/rollen.sql`
3. Letzten Stand zurückspielen: `docker compose -f docker-compose.prod.yml run --rm -T backup dump --retry-lock 5m latest /cevi_os.dump | docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U postgres -d cevi_os --exit-on-error --single-transaction`
4. Release ausrollen: `./deploy.sh <Tag>`. Danach melden sich alle neu an.

Fehlt auch die alte `deploy/.env`: Das Passwort der betreuenden Person oder der Abteilungsleitung als `RESTIC_PASSWORD` in die neue `deploy/.env` eintragen, denn die Wiederherstellung läuft über `run -T` und kann kein Passwort versteckt abfragen. Danach einen neuen Server-Schlüssel anlegen (`key add`, Wert als `RESTIC_PASSWORD` in `deploy/.env`) und den verlorenen entfernen (`key list` zeigt die IDs, `key remove <ID>`). Die zweiten Faktoren lassen sich ohne die alte `.env` nicht mehr entschlüsseln; die Admins richten sie neu ein.

Bleibt nach einem Abbruch ein Lock im Archiv zurück: `docker compose -f docker-compose.prod.yml run --rm backup unlock`

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

Alarmtest, einmal nach der Einrichtung und vor dem Pilotbetrieb — während des Tests synchronisiert rund 40 Minuten keine Abteilung:

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
4. **Gekapertes Konto sperren, dann zweite Faktoren neu einrichten.** Nach Schritt 3 besteht kein Admin den zweiten Faktor. Die CLI (#23) setzt den Faktor genau eines vertrauenswürdigen Admins zurück; diese Person meldet sich an und richtet ihren Faktor neu ein. Dann deaktiviert sie das gekaperte Konto oder gibt ihm ein neues Startpasswort (#18); nie den Faktor eines Kontos zurücksetzen, solange sein altes Passwort noch gilt, sonst richtet die fremde Person den neuen Faktor selbst ein. Danach setzt sie die Faktoren der übrigen Admins zurück (#23), und diese richten ihre neu ein. Bleibt kein vertrauenswürdiger Admin übrig, legt die CLI (#20) einen neuen an, in `deploy/`: `docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/admin-anlegen.ts --benutzername <name> --name "<Vorname Nachname>" --abteilung "<Name>"`; immer `exec`, nie `run`, sonst steht das Startpasswort 14 Tage im journald (siehe «Logs»).
5. **Dokumentieren:** die Tatsachen rund um die Panne, ihre Auswirkungen und die getroffenen Massnahmen (Art. 15 Abs. 4 DSV), dazu ob gemeldet wurde und warum. Die Dokumentation bleibt mindestens zwei Jahre erhalten, nie im Repo, in Issues oder in PRs.
