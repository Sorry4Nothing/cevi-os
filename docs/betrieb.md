# Betrieb

Dieses Dokument beschreibt den Betrieb von Cevi OS; ausgerollt wird nur von `main`. Die Befehle in den Abschnitten «Backups» und «Datenpanne» laufen auf dem Server, jene im Abschnitt «Backups» im Ordner `deploy/`.

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

## Backups

`deploy/backup.sh` sichert die Datenbank verschlüsselt mit [restic](https://restic.net) auf einen S3-Speicher in der Schweiz: täglich per Cron und vor jedem Deploy (`deploy.sh` ruft das Skript auf). restic behält 30 tägliche und 3 monatliche Stände; Älteres räumt das Skript bei jedem Lauf weg. Solange noch keine Migrationen gelaufen sind, beendet es sich ohne Backup.

### Nicht im Backup

- Sitzungen, offene Bestätigungscodes und die Schlüssel des Rate-Limits (Tabellen `session`, `verification`, `rate_limit`): Sitzungen enthalten Tokens. **Nach einer Wiederherstellung melden sich darum alle neu an.** Push-Tokens hängen an Sitzungen; sobald es ihre Tabelle gibt, wird sie ebenso ausgeschlossen.
- Dateien auf dem Server: `deploy/.env` (Passwörter und restic-Schlüssel), `deploy/secrets/google-service-account.json` und die Zertifikate von Caddy. Caddy holt Zertifikate selbst neu; die beiden Dateien sind ohne eigene Kopie verloren.

Das Skript bricht ohne Backup ab, wenn eine ausgeschlossene Tabelle fehlt oder eine andere Tabelle per Fremdschlüssel auf eine ausgeschlossene verweist, denn solche Zeilen machten die ganze Wiederherstellung ungültig. Dann die Ausschlussliste in `deploy/backup.sh` nachführen.

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
