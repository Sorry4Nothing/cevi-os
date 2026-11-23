# Betrieb

Abläufe für den Betrieb von Cevi OS; hier stehen Server, Konten, Edge-Caddy, Deploy, Release, Release-Checkliste, Backups, Überwachung, Logs, der zweite Faktor und der Ablauf bei einer Datenpanne. Ausgerollt wird nur von `main`.

## Server

- Ein VPS; Anbieter, Region und Domain sind noch offen (#68). Im Gespräch ist Oracle Cloud «Always Free» (ARM, Ampere); ob die Region in der Schweiz liegt, ist ungeprüft, und die Home-Region lässt sich nach der Anmeldung nicht ändern.
- Das API-Image ist nur für arm64 gebaut (`image.yml` läuft auf `ubuntu-24.04-arm`). Die Images von postgres, caddy und restic gibt es auch für arm64. Auf einem amd64-Server startet das API-Image nicht.
- Auf dem Server laufen Linux mit systemd-journald, die Docker Engine mit dem Compose-Plugin und git.
- Der Dienst `api` hat in `deploy/docker-compose.prod.yml` höchstens 1 GB Arbeitsspeicher (`mem_limit`) und 256 Prozesse und Threads (`pids_limit`), damit viele gleichzeitige Bild-Uploads (bis 16 Mio. Pixel, beim Dekodieren rund 64 MB je Bild) nur die API treffen und nicht Postgres; der Wert muss zum Server passen, und meldet `docker inspect` für den Container `OOMKilled`, ist er zu klein.
- Härtung (#68): SSH nur mit Schlüssel und nur für zwei Personen, Firewall, automatische Sicherheitsupdates. Nach der Einrichtung bestätigt ein Portscan von aussen, dass nur SSH, 80 und 443 offen sind. Docker öffnet veröffentlichte Ports an der Host-Firewall vorbei; darum veröffentlicht nur der Edge-Caddy Ports (siehe «Edge-Caddy»).
- Das Repo liegt auf dem Server als Checkout des ausgerollten Tags. Befehle in dieser Doku laufen im Wurzelordner dieses Checkouts, jene im Abschnitt «Backups» im Ordner `deploy/`.
- Nur auf dem Server, nie im Repo: `deploy/.env` (Rechte 600, Vorlage `deploy/.env.example`) und der Schlüssel des Firebase-Dienstkontos unter `deploy/secrets/` (Ordner 700, Datei 400). Die geheime iCal-Adresse des Outlook-Kalenders steht nur in der Datenbank (Spalte `abteilung.google_kalender_id`, Name aus der Zeit vor Outlook).

## Konten

Der Betrieb braucht diese Konten: Apple Developer Program, Google Play Console, das Google-Konto des Cloud-Projekts, Hoster, DNS, S3-Speicher, Uptime-Dienst und GitHub (Repo und GHCR). Hier stehen Rollen, keine Personen. Für jedes Konto gilt:

- Zwei-Faktor-Anmeldung.
- Wo der Dienst es erlaubt, hat eine zweite Person Zugriff.
- Die Wiederherstellungscodes liegen in einem Passwort-Tresor, den auch die Abteilungsleitung öffnen kann.

## Edge-Caddy

Die Ports 80 und 443 kann nur ein Prozess belegen, der Server hat aber mehrere Stacks mit je einer Domain. Darum belegt sie ein eigener, kleiner Stack, der Edge-Caddy; dieser Stack hat keinen eigenen Caddy und veröffentlicht keine Ports. Der Edge-Caddy liegt in einem eigenen Ordner ausserhalb des Checkouts, denn der Checkout wechselt mit jedem Release den Stand: `docker-compose.yml` (Compose-Projekt `edge`, ein gehärteter Caddy mit den Ports 80 und 443), `Caddyfile` mit der einen Zeile `import /etc/caddy/sites/*.caddy` und der Ordner `sites/` mit einer Datei je Stack.

Je Stack ein eigenes Docker-Netz, damit sich die Stacks nicht untereinander erreichen; der Edge-Caddy hängt an allen. Für Cevi OS heisst es `edge-cevi-os`, und die API hat darin den eindeutigen Alias `cevi-os-api` (`deploy/docker-compose.prod.yml`), weil der Dienstname `api` bei mehreren Stacks gleich hiesse. In `<Edge-Ordner>/docker-compose.yml` stehen für Cevi OS zwei Stellen:

```yaml
services:
  caddy:
    networks:
      - edge-cevi-os

networks:
  # Der Stack cevi-os nimmt es als externes Netz (deploy/docker-compose.prod.yml)
  edge-cevi-os:
    name: edge-cevi-os
```

Die Seite der API ist [`deploy/edge/cevi-os.caddy`](../deploy/edge/cevi-os.caddy). Sie kommt als `<Edge-Ordner>/sites/cevi-os.caddy` auf den Server, mit der echten Domain statt `api.example.org`; Header und HSTS bleiben, `reverse_proxy` zeigt auf `cevi-os-api:3000`. Die Domain muss auf die IP des Servers zeigen, Caddy holt das Zertifikat selbst.

Eine Seite ändern oder hinzufügen, ohne Unterbruch: Datei nach `<Edge-Ordner>/sites/` kopieren, dann im Edge-Ordner `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` und `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`. Ist die neue Datei fehlerhaft, melden beide Befehle den Fehler und der Caddy läuft mit der alten Konfiguration weiter. Ändert sich `deploy/edge/cevi-os.caddy` in einem Release, die Änderung von Hand übernehmen (die Domain bleibt). Prüfen mit `curl -sI https://<Domain>/health`: Die Antwort zeigt `strict-transport-security`, aber keine Zeile `server`. `deploy.sh` aktualisiert das Image des Edge-Caddys nicht: gelegentlich im Edge-Ordner `docker compose pull && docker compose up -d`.

Kalender-Feed (#438): Die Ratenbegrenzung von `GET /ical/<Token>.ics` zählt je IP-Adresse und nimmt dafür den letzten Eintrag von `X-Forwarded-For`, also die Adresse, die der Edge-Caddy gesehen hat. Steht ein weiterer Proxy vor dem Edge-Caddy, zählt die API alle Anfragen unter einer Adresse und bremst nach 300 Abrufen in 10 Minuten alle gemeinsam; dann den Eintrag (`ip` in `termine/ical.ts`) anpassen. Der `log`-Block derselben Seite verbirgt den Token im Zugriffslog (siehe «Logs»).

Server-Sent Events des Lagers (#367): `GET /api/v1/lager/{id}/ereignisse` hält die Verbindung offen und schickt alle 25 Sekunden einen Herzschlag. Dazwischen darf kein Proxy die Antwort puffern oder früh abbrechen. `deploy/edge/cevi-os.caddy` hat dafür nichts nötig: `reverse_proxy` ohne `encode` und ohne Zeitlimit für Antworten. Wer die Seite ändert, behält das bei (kein `encode` und keine Antwort-Zeitlimits für diese Route). Kommen Meldungen gebündelt oder verspätet an, steht in `reverse_proxy` die Zeile `flush_interval -1`; dann ist es eine Änderung an `deploy/edge/cevi-os.caddy` in einem eigenen Issue. Prüfen am Server: `curl -N -H "Cookie: ..." https://<Domain>/api/v1/lager/<ID>/ereignisse` zeigt sofort `event: bereit` und dann alle 25 Sekunden `: herzschlag`. Die API setzt `Cache-Control: no-cache, no-transform` und `X-Accel-Buffering: no`, schickt keine komprimierte Antwort und beginnt mit `retry: 5000`; die erste Nachricht ist `event: bereit` (die App meldet keinen Stand), `event: aenderung` (sie meldet über `Last-Event-ID` oder `?seit=` einen älteren Stand) oder `event: neu-laden` (ihr Stand liegt vor dem des Lagers, etwa nach dem Zurückspielen eines Backups; die App lädt dann alles neu). Dass Caddy Event-Streams ohne `flush_interval` sofort weiterreicht, ist Verhalten von Caddy und am Server zu prüfen (der Edge-Ordner liegt ausserhalb dieses Repos). Die API hält die Verbindungen im Arbeitsspeicher der einen Instanz (höchstens 200, je Lager 100 und je Konto 3; darüber antwortet sie mit 429 und `Retry-After`); beim Neustart der API verbinden sich die Apps von selbst neu. Läuft die API einmal auf mehr als einer Instanz, brauchen die Verbindungen `LISTEN/NOTIFY` (siehe `docs/architektur.md`, Lager-Modul).

Umzug vom bisherigen eigenen Caddy dieses Stacks (#300): Die Domain ist dabei für einige Minuten nicht erreichbar, am besten in einer ruhigen Stunde. Der Stand mit dem Edge-Caddy darf erst ausgerollt werden, wenn der Edge-Ordner steht; ein Release-Deploy ohne das Netz `edge-cevi-os` bricht ab.

1. Den Edge-Ordner anlegen, mit `sites/cevi-os.caddy` (die Domain aus dem bisherigen `deploy/Caddyfile`) und dem Netz `edge-cevi-os` in `docker-compose.yml`. Vorher `docker compose config` im Edge-Ordner.
2. Den bisherigen Caddy stoppen: in `deploy/` `docker compose -f docker-compose.prod.yml stop caddy`, noch mit dem alten Stand des Checkouts.
3. Im Edge-Ordner `docker compose up -d`. Das legt das Netz an, und der Edge-Caddy holt die Zertifikate neu bei Let's Encrypt; die Abfragen sind im Gratis-Rahmen.
4. Das Release mit diesem Stand ausrollen (`deploy/deploy.sh vX.Y.Z`, von Hand oder aus GitHub): Die API hängt danach am Netz `edge-cevi-os`.
5. Aufräumen: `docker rm cevi-os-caddy-1`, `docker volume rm cevi-os_caddy_data cevi-os_caddy_config` und `deploy/Caddyfile` löschen.
6. Prüfen: die Domain über HTTPS, `docker compose ps` in `deploy/` und im Edge-Ordner, `docker network ls` zeigt `edge-cevi-os`, Portscan von aussen.

## Deploy

Erste Einrichtung auf dem Server:

1. Das Repo klonen und den Release-Tag auschecken: `git fetch --tags && git checkout vX.Y.Z`
2. `deploy/.env.example` nach `deploy/.env` kopieren und die Werte setzen (Passwörter hexadezimal, etwa aus `openssl rand -hex 32`; `BETTER_AUTH_SECRET` aus `openssl rand -base64 32`, `BETTER_AUTH_URL` ist die öffentliche Adresse der API mit `https://`; mit `http://` startet die API in Produktion nicht), dann `chmod 600 deploy/.env`. Die verantwortliche Stelle, ihre Anschrift und ihre E-Mail-Adresse (Seiten `/datenschutz`, `/konto-loeschen` und `/support`, #63, #548) sind öffentlich und stehen als Vorgabe in `apps/api/src/konfiguration.ts`; sie brauchen keinen Eintrag in `deploy/.env`. Ändern sich die Werte, setzt man `VERANTWORTLICHE_STELLE`, `VERANTWORTLICHE_ADRESSE` oder `KONTAKT_EMAIL` in `deploy/.env` (`docker-compose.prod.yml` reicht sie an die API weiter; eine leere Zeile gilt als nicht gesetzt)
3. Den Schlüssel des Firebase-Dienstkontos für die Pushes (#154) nach `deploy/secrets/fcm-service-account.json` legen: Ordner 700, Datei 400, Besitzer `1000:1000` (die UID der API im Container). Die iCal-Adresse des Outlook-Kalenders danach in die Datenbank eintragen: `update abteilung set google_kalender_id = '<https-Adresse>' where id = '<abteilungs-id>'`; webcal:// wird zu https:// umgeschrieben. Die Adresse nie in Issues, Chats oder Logs
4. Den Edge-Caddy einrichten (siehe «Edge-Caddy», #68); ohne ihn bricht `deploy/deploy.sh` ab
5. Nach dem ersten Tag das API-Image auf GHCR öffentlich schalten (#70), sonst findet der Server es nicht

Jedes Release rollt `deploy/deploy.sh vX.Y.Z` aus, nach `git fetch --tags && git checkout vX.Y.Z`. Das Skript bricht ab, wenn das Docker-Netz `edge-cevi-os` fehlt, aktualisiert das Image von postgres, sichert die Datenbank (siehe «Backups»), setzt die Passwörter der Datenbankrollen aus `deploy/.env`, führt die Migrationen mit der Besitzerrolle aus — nur vorwärts, nie zurück —, startet alle Dienste mit dem Tag neu und stoppt jeden Dienst, der einen Port veröffentlicht.

### Deploy aus GitHub

Statt von Hand rollt der Workflow «Deploy» ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) einen Tag aus, nachdem eine Person ihn in GitHub freigegeben hat (#252). Er prüft, dass der Tag `vX.Y.Z` heisst, auf `main` liegt und sein Image im GHCR existiert, und verbindet sich dann per SSH. Der Server führt für diesen Schlüssel nur [`deploy/ssh-deploy.sh`](../deploy/ssh-deploy.sh) aus: Es nimmt den Tag als einziges Argument, checkt ihn aus und startet `deploy/deploy.sh vX.Y.Z`. Der Ablauf auf dem Server bleibt derselbe wie von Hand.

Einrichtung, einmal:

1. Auf dem Server ein eigenes Schlüsselpaar nur für den Deploy erzeugen: `ssh-keygen -t ed25519 -N "" -C cevi-os-deploy -f cevi-os-deploy`. Den öffentlichen Teil in `~/.ssh/authorized_keys` des Deploy-Benutzers eintragen, in einer Zeile mit festem Befehl: `restrict,command="<Pfad des Checkouts>/deploy/ssh-deploy.sh" ssh-ed25519 AAAA… cevi-os-deploy`. `restrict` schaltet Terminal, Port- und Agent-Weiterleitung ab. Der private Teil kommt nur in das Secret und wird danach vom Server gelöscht.
2. Der Deploy-Benutzer muss `deploy/deploy.sh` ohne `sudo` ausführen können: Docker-Gruppe, Leserecht auf `deploy/secrets/` (siehe Schritt 3 oben) und ein Checkout, in dem er `git fetch` und `git checkout` ausführen darf.
3. In GitHub unter Settings → Environments die Umgebung `production` anlegen. «Required reviewers»: die Person, die freigibt; «Prevent self-review» ist nur sinnvoll, wenn eine zweite Person freigibt. «Deployment branches»: nur `main`, sonst könnte ein Branch den Workflow ändern.
4. In der Umgebung `production` vier Secrets setzen: `DEPLOY_HOST` (Name oder Adresse des Servers), `DEPLOY_USER`, `DEPLOY_SSH_KEY` (der private Schlüssel) und `DEPLOY_HOST_KEY` (eine Zeile für `known_hosts`, aus `ssh-keyscan -t ed25519 <Host>` auf dem Server selbst geholt, nicht aus dem Internet). Der Workflow verbindet sich nur mit diesem Hostschlüssel.
5. Die Firewall des Servers lässt SSH aus dem Internet zu, oder aus den Adressen der GitHub-Runner (die Liste steht unter `https://api.github.com/meta`, Feld `actions`, und ändert sich).

Ablauf: Der Workflow «Release» ruft «Deploy» nach dem Image selbst auf (#262); die Umgebung `production` wartet dann auf die Freigabe. Ohne den Haken «ausrollen» bleibt es beim Image. Einen vorhandenen Tag, etwa zum erneuten Ausrollen, rollt man unter Actions → Deploy → Run workflow aus: Tag eintragen und freigeben. Der Lauf zeigt die Ausgabe von `deploy.sh`; sie enthält keine Passwörter. Ein Schlüssel wird rotiert, indem man ein neues Paar erzeugt, die Zeile in `authorized_keys` ersetzt und das Secret setzt.

Das erste Admin-Konto legt die CLI im laufenden API-Container an, in `deploy/`: `docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/admin-anlegen.ts --benutzername <name> --name "<Vorname Nachname>" --neue-abteilung "<Name>"`. Sie zeigt das Startpasswort; es steht danach auch in der Personenliste, bis die Person es ersetzt hat. Immer `exec`, nie `run`: Die Ausgabe von `run` landet für 14 Tage im journald (siehe «Logs»), die von `exec` in keinem Log.

## Release

Ein Release der API ist ein Tag `vX.Y.Z` auf `main`; die Nummer steigt nur. Die iOS- und die Android-App liegen in eigenen Repos und haben dort ihren eigenen Release-Ablauf.

1. Release-PR von `develop` nach `main`, gemergt mit «Create a merge commit» ([GIT_WORKFLOW.md](GIT_WORKFLOW.md) sagt warum).
2. Der Merge nach `main` startet den Workflow «Release» von selbst mit Stufe `minor` und Ausrollen; von Hand geht es unter Actions → Release → Run workflow, Branch `main`, etwa für `major` oder eine Version. Er setzt den annotierten Tag auf den Commit, der den Lauf auslöst (beim Merge der Merge-Commit, von Hand der Kopf von `main`), baut das Image und rollt es nach der Freigabe der Umgebung `production` aus (Haken «ausrollen»). Die Stufe `minor` erhöht z (`v0.9.9` → `v0.9.10`), `major` erhöht y und setzt z auf 0 (`v0.9.9` → `v0.10.0`). x steigt nie von selbst: Nur das Feld «version» (z. B. `1.0.0`) erhöht es, und die Nummer muss grösser als der letzte Tag sein. Jede Stelle ist eine ganze Zahl ohne Obergrenze; die Rechnung steht in `deploy/naechste-version.sh`. Von Hand geht es weiter: `git fetch origin`, `git tag -a vX.Y.Z -m "Release X.Y.Z" origin/main`, `git push origin vX.Y.Z`.
3. Warten, bis der Workflow «Image» ([`.github/workflows/image.yml`](../.github/workflows/image.yml)) grün ist: Er prüft, dass der Tag `vX.Y.Z` heisst, baut das API-Image und legt es als `ghcr.io/sorry4nothing/cevi-os-api:vX.Y.Z` in GHCR ab. Ein falscher Tag baut kein Image.
4. Auf dem Server ausrollen: «Release» tut das nach dem Image, sobald die Umgebung `production` freigegeben ist (siehe «Deploy aus GitHub»); sonst Workflow «Deploy» von Hand starten, oder von Hand den Tag auschecken und `deploy/deploy.sh vX.Y.Z` ausführen (Backup, Migration, Neustart, Portprüfung).

Vor dem Store-Release einer App läuft die «Release-Checkliste» unten.

Ein Tag, dessen Lauf ein Image gebaut hat, wird nie verschoben, gelöscht oder neu vergeben. Hat der Lauf keines gebaut, weil die Tag-Prüfung oder der Build rot war: den Tag löschen (`git push origin --delete vX.Y.Z` und `git tag -d vX.Y.Z`), die Ursache per PR beheben und neu taggen.

`APP_MIN_VERSION` in `deploy/.env` auf dem Server steigt nur, um eine alte App auszusperren, und erst, wenn die neue Version in beiden Stores ist.

## Release-Checkliste

Sie läuft von Hand vor jedem Store-Release einer App: einmal auf Android und einmal auf einem iPhone, mit dem Release-Build aus dem Repo der jeweiligen App über TestFlight bzw. einen Testtrack der Play Console, nur in der Demo-Abteilung der Produktion (Screenshots nur von dort). Voraussetzung: Die Demo-Abteilung hat ein Demo-Kind in einer Stufe und ein Programm, das Eltern sehen (#76).

- [ ] Demo-Konten für das Review aktivieren (#76)
- [ ] Ein Admin der Demo-Abteilung meldet sich mit zweitem Faktor an und legt eine Person an: ein Elternteil eines Demo-Kindes, mit erfundenem Namen
- [ ] Mit der neuen Person: Login mit Startpasswort, Passwort setzen, App-Sperre
- [ ] Programm öffnen und Kind mit Ja/Nein melden
- [ ] Nachricht im Gruppenchat
- [ ] «Kontakt» öffnet den Einzelchat
- [ ] Nach dem Review die Demo-Konten und die angelegten Personen wieder deaktivieren

Die Schritte vom Anmelden des Admins bis «Kontakt» laufen auf jedem Gerät einmal, jedes Mal mit einer neu angelegten Person, denn das Startpasswort gilt nur für die erste Anmeldung. Aktivieren und Deaktivieren laufen einmal vor und einmal nach beiden Durchgängen.

## Abhängigkeiten und Images (SR-62, SR-63)

Entscheid vom 22.11.2026 (#226).

- **`npm audit`:** Die CI sperrt ab «high» (`npm audit --omit=dev --audit-level=high -w apps/api`). Der Review vor dem Pilot (#65) zählte 6 mittlere Funde (glob und minimatch über firebase-admin, google-gax und rimraf). Am 22.11.2026 meldet `npm audit` (mit und ohne `--omit=dev`) 0 Funde (der Stand der Lock-Datei hat sich seither geändert). Abhängigkeiten ändert dieser Entscheid nicht. Taucht ein Fund auf, gilt: «high» und «critical» beheben vor dem Merge; «moderate» in einer Laufzeit-Abhängigkeit beheben, sobald ein Patch ohne Bruch da ist, und sonst im Issue mit Begründung stehen lassen (erreichbar nur über Dev-Werkzeuge oder vertrauenswürdige Eingaben).
- **Images ohne Digest:** `postgres:18` und `node:26-alpine` bleiben bei Tags. `deploy/deploy.sh` holt bei jedem Release die Korrekturen hinter `postgres:18` (`compose pull postgres`); ein fester Digest würde sie sperren, und Dependabot ist für Docker nicht eingerichtet. Das API-Image trägt den Release-Tag `vX.Y.Z`, der nie neu vergeben wird (siehe «Release»). Offen: Digests samt Dependabot-Eintrag für Docker, signierte Images, und das Caddy-Image des Edge-Servers (liegt ausserhalb dieses Repos). Digests brauchen eine Prüfung gegen die Registry; sie stehen nicht ohne diese im Repo.

## Datenbank-Erweiterung pg_trgm (Volltextsuche im Lager, #399)

Die Suche im Lager braucht die PostgreSQL-Erweiterung `pg_trgm` (Tippfehler). Die Migration `0098_lager_suche` legt sie mit `CREATE EXTENSION IF NOT EXISTS pg_trgm` an. Voraussetzungen:

- **Rolle:** Die Migration läuft mit `cevi_os_besitzer`, der Besitzerin der Datenbank (`apps/api/src/db/rollen.sql`). `pg_trgm` ist seit PostgreSQL 13 eine vertrauenswürdige Erweiterung: Wer die Datenbank besitzt (Recht `CREATE`), darf sie ohne Superuser anlegen. Es braucht keine Änderung an den Rollen. Der Test `test/lager/suche.test.ts` und die CI migrieren eine frische Datenbank mit genau dieser Rolle.
- **Paket:** Das Image `postgres:18` bringt `pg_trgm` mit (contrib). Ein anderes oder gebündeltes Postgres (ein verwalteter Dienst, ein Paket ohne `postgresql-contrib`) muss `pg_trgm` bereitstellen, sonst bricht die Migration ab und `deploy.sh` rollt nicht aus (kein halber Stand: die Migration läuft in einer Transaktion). Prüfen vor dem Deploy: `compose exec -T postgres psql -U postgres -d cevi_os -c "select name, trusted from pg_available_extensions where name = 'pg_trgm'"`.
- **Rückweg:** `drizzle/rueckweg/0098_lager_suche.sql` löscht die Indizes und die Funktion `lager_suche_liste`, nicht die Erweiterung.
- **Backup und Wiederherstellung:** Der Dump enthält `CREATE EXTENSION pg_trgm`; die Wiederherstellung braucht dieselbe Voraussetzung.
- **Last:** Die Indizes (zwei GIN-Indizes je durchsuchter Tabelle) werden beim Schreiben mitgeführt; bei den Tabellen eines Lagers (einige hundert Zeilen) ist das vernachlässigbar. Neue Zeilen sind sofort suchbar, es gibt keinen Indexlauf.

## Datenbank-Erweiterung btree_gist (Raumbuchungen der Termine, #447)

Bestätigte Buchungen eines Raums dürfen sich nicht überschneiden. Das hält die Datenbank selbst fest: Die Tabelle `raum_buchung` hat einen Exclusion-Constraint auf `(raum_id, Zeitbereich)` für den Status `bestaetigt`. Er braucht die PostgreSQL-Erweiterung `btree_gist` (die Gleichheit auf `raum_id` im GiST-Index). Die Migration `0127_raum_buchung` legt sie mit `CREATE EXTENSION IF NOT EXISTS btree_gist` an. Voraussetzungen wie bei `pg_trgm`:

- **Rolle:** Die Migration läuft mit `cevi_os_besitzer`, der Besitzerin der Datenbank. `btree_gist` ist seit PostgreSQL 13 eine vertrauenswürdige Erweiterung: Wer die Datenbank besitzt (Recht `CREATE`), darf sie ohne Superuser anlegen. Es braucht keine Änderung an den Rollen. Der Test `test/termine/migration-0127.test.ts` und die CI migrieren eine frische Datenbank mit genau dieser Rolle.
- **Paket:** Das Image `postgres:18` bringt `btree_gist` mit (contrib). Ein anderes oder gebündeltes Postgres ohne `postgresql-contrib` muss sie bereitstellen, sonst bricht die Migration ab und `deploy.sh` rollt nicht aus (kein halber Stand). Prüfen vor dem Deploy: `compose exec -T postgres psql -U postgres -d cevi_os -c "select name, trusted from pg_available_extensions where name = 'btree_gist'"`.
- **Rückweg:** `drizzle/rueckweg/0127_raum_buchung.sql` löscht die Tabelle, nicht die Erweiterung.
- **Backup und Wiederherstellung:** Der Dump enthält `CREATE EXTENSION btree_gist`; die Wiederherstellung braucht dieselbe Voraussetzung.
- **Last:** Der Index wird nur für bestätigte Buchungen geführt (Teilindex); bei einigen Dutzend Buchungen je Raum und Jahr ist das vernachlässigbar.

## Aufräumläufe der API

Die API räumt selbst auf: Alle Läufe sind Zeitgeber im Prozess der API (`apps/api/src/server.ts`), es gibt keinen Cron und keinen externen Planer. Jeder Lauf startet beim Start der API sofort und danach im Takt; nach einem Deploy laufen sie also einmal sofort, was bei Löschläufen unkritisch ist (sie sind idempotent). Ins Log (journald, siehe «Logs») kommen nur der Name des Laufs und die Zahl der Zeilen, bei einem Fehler nur ein Code; ein Fehler bricht nichts ab, der nächste Lauf folgt im nächsten Takt. Es gibt keinen Alarm dafür: Wer prüfen will, ob ein Lauf läuft, sucht im Log nach dem Ereignisnamen.

| Lauf (Ereignis im Log)                                | Takt                          | Was und Frist                                                                                                                                                                                                                                    | Audit-Log                                           |
| ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Änderungsprotokoll (`aktivitaet_aufraeumen`)          | 24 h                          | Einträge des Änderungsprotokolls nach 90 Tagen (`PROTOKOLL_TAGE`, 7 bis 365) und über 500000 Zeilen (`PROTOKOLL_MAX_ZEILEN`, mindestens 10000), die ältesten zuerst (#637); die Datenbank-Funktion hat Untergrenzen von 7 Tagen und 10000 Zeilen | nein                                                |
| Sitzungen (`sitzungen`)                               | 24 h                          | abgelaufene Sitzungen; das Push-Token der Sitzung geht mit                                                                                                                                                                                       | nein                                                |
| Änderungsfeed (`lager_aenderungen`)                   | 24 h                          | Einträge des Änderungsfeeds und Ergebnisse der Warteschlange nach 30 Tagen (#366, #367); danach antwortet der Feed 410                                                                                                                           | nein                                                |
| Benachrichtigungen (`lager_benachrichtigungen`)       | 24 h                          | gelesene Einträge der Glocke nach 90 Tagen (Annahme, noch nicht bestätigt); ungelesene bleiben bis zum Löschen des Lagers                                                                                                                        | nein                                                |
| Dateien (`lager_dateien`)                             | 24 h                          | Verknüpfungen auf Dateien (`lager_datei`) ohne Verweis eines Datensatzes nach 24 Stunden, also 24 bis 48 Stunden (#370)                                                                                                                          | nein                                                |
| Teilnehmende (`lager_teilnehmende`)                   | 24 h                          | Teilnehmende samt Haken, Zimmer, Gruppen und Diensten sechs Monate nach dem Ende des Lagers (#384)                                                                                                                                               | ja, nur die Anzahl (`lager_teilnehmende_geloescht`) |
| Adressbuch-Erinnerung (`lager_adressbuch_erinnerung`) | 24 h                          | Benachrichtigung an die Lagerleitung 14 Tage vor dem Löschtag, einmal je Lager (#397)                                                                                                                                                            | nein                                                |
| Adressbuch (`lager_adressbuch_aufraeumen`)            | 24 h                          | Kontakte ohne «behalten» 180 Tage nach dem Ende des Lagers (Tag 180 ist weg, Tag 179 noch da) (#397)                                                                                                                                             | ja, nur die Anzahl (`lager_adressbuch_aufgeraeumt`) |
| Frist-Erinnerung (`lager_fristen`)                    | 1 h                           | Erinnerung für Aufgaben mit Frist heute bis in 3 Tagen, ab 07:00 Zürcher Zeit, höchstens einmal je Aufgabe und Tag (#374)                                                                                                                        | nein                                                |
| Kalender-Token (`kalender_token`)                     | 24 h                          | widerrufene persönliche Kalenderlinks 30 Tage nach dem Widerruf (#437)                                                                                                                                                                           | nein                                                |
| Anmeldungen zu Anlässen (`anlass_anmeldungen`)        | 24 h                          | Anmeldungen 180 Tage nach dem Ende des Anlasses (#443); Anlässe der Art Lager nimmt der Lauf «Teilnehmende» mit                                                                                                                                  | ja, nur die Anzahl (`anlass_anmeldungen_geloescht`) |
| Raumanfragen (`raum_buchungen`)                       | 24 h                          | Raumanfragen und Buchungen jedes Stands 180 Tage nach dem Ende der angefragten Zeit (#447)                                                                                                                                                       | nein                                                |
| Lädeli (`laden_bestellungen`)                         | 24 h                          | Bestellungen 180 Tage nach Übergabe oder Stornieren, nie abgeschlossene 365 Tage nach der letzten Änderung, samt Positionen (#566)                                                                                                               | nein                                                |
| Kalender-Abgleich (`kalender`)                        | 5 min                         | Programme aus dem Outlook-Kalender lesen (kein Aufräumen); Sperre in der Datenbank, eine zweite Instanz überspringt                                                                                                                              | nein                                                |
| Website-Abgleich (`website_ausgabe`)                  | 10 min und bei jedem Ereignis | statische Dateien der Website erzeugen (siehe [website-auslieferung.md](website-auslieferung.md)); nur mit den drei `WEBSITE_*`-Werten; Sperre in der Datenbank                                                                                  | nein                                                |
| Zeitregeln (`zeitregel`)                              | 1 min                         | fällige Erinnerungen an Eltern senden; nur mit FCM-Schlüssel; Sperre in der Datenbank                                                                                                                                                            | nein                                                |
| Event-Stream des Lagers                               | 25 s und 5 min                | Herzschlag an offene Verbindungen und Kontrolle von Sitzung, Konto, Rolle und Lager (#367); läuft nur, solange Verbindungen offen sind                                                                                                           | nein                                                |

Nicht aufgeräumt wird, was ausdrücklich bleibt oder an einem Konto, Lager oder einer Abteilung hängt: Meldungen im Eingang (nur manuell, endgültig, oder mit dem Lager; #383), der Wetter-Cache (eine Zeile je Lager, geht mit dem Lager; kein Lauf, die API holt das Wetter nur beim Lesen), Chats (gehen mit dem Konto) und Bilder im Medienspeicher (kein Aufräumlauf, siehe «Medienspeicher»). Für Lager-Daten gibt es keinen Papierkorb: Löschen ist endgültig (Entscheid vom 22.11.2026, #427); Export, Wiederherstellen und Übungslager sind kein Teil der Lager-Erweiterung. Ein Lager als Ganzes zu löschen kommt mit #400.

Mehrere Instanzen: Heute läuft eine Instanz. Kalender, Zeitregeln und Website haben eine Sperre in der Datenbank (`pg_try_advisory_lock`), die Frist-Erinnerung vermerkt die Aufgaben in derselben Anweisung. Die Löschläufe haben keine Sperre; die Adressbuch-Erinnerung und der Adressbuch-Löschlauf wurden mit zwei Instanzen nicht geprüft. Vor einer zweiten Instanz auch den Event-Stream (`LISTEN/NOTIFY`, siehe `docs/architektur.md`), die Zähler der Rate-Limits (im Arbeitsspeicher) und die Schalter des Wartungsmodus (beim Start geladen) prüfen.

## Website

Die öffentliche Website besteht aus fertigen Dateien, die die API in ein eigenes Verzeichnis schreibt (`WEBSITE_AUSGABE_PFAD`) und ein Host ausliefert; Besucher belasten die Datenbank nicht. Ablauf, Konfiguration, Vorschlag für den Edge-Caddy, Vorschau im Editor und Datenbanklast stehen in [website-auslieferung.md](website-auslieferung.md). Hier nur, was der Betrieb wissen muss:

- **Heute nicht eingerichtet:** Domain (#68), Ort der Dateien und die Änderung am Edge-Caddy stehen nicht fest. `deploy/.env.example` und `deploy/docker-compose.prod.yml` führen die drei `WEBSITE_*`-Variablen noch nicht; ohne sie erzeugt die API nichts (Log `website_ausgabe`, Art `aus`). Der Dienst `api` läuft mit `read_only: true` und braucht für das Verzeichnis ein beschreibbares Volume.
- **Neuaufbau der Dateien:** Fehlt eine Datei oder das ganze Verzeichnis, schreibt der Abgleich sie beim nächsten Lauf neu (beim Start der API, bei jedem Ereignis, spätestens nach 10 Minuten). Einen vollständigen Neuaufbau erzwingt man, indem man den Inhalt des Verzeichnisses löscht und die API neu startet.
- **Backup:** Der Ausgabeordner ist aus der Datenbank ableitbar und wird **nicht gesichert**. Gesichert sind die Seiten, Versionen und Weiterleitungen (Tabellen `seite`, `seite_version`, `weiterleitung`) im Dump; nach einer Wiederherstellung gleicht der Abgleich die Dateien selbst ab. Die Bilder der Website liegen im Medienspeicher (siehe «Medienspeicher»), Dateien zum Herunterladen im SharePoint.
- **Vom Netz nehmen:** Die Informationssperre mit «Öffentliche Website vom Netz nehmen» leert das Verzeichnis und schreibt eine Hinweisseite (siehe «Informationssperre»).

## Ausgehende Verbindungen der API

Die API ruft ausserhalb des Servers nur diese Dienste auf; der Dienst `api` braucht dafür das Docker-Netz `default` (Weg nach aussen).

| Ziel                                          | Wofür                                                                                                                                                                                                    | Wenn es fehlt                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `api.open-meteo.com` (HTTPS, ohne Schlüssel)  | Wettervorhersage für den Lagerort (#391): nur Breite und Länge auf zwei Stellen gerundet; höchstens ein Abruf je Lager in 6 Stunden, Zeitlimit 5 Sekunden, Antwort höchstens 64 KiB, keine Weiterleitung | Das Lager zeigt kein Wetter; die Antwort ist kein Fehler, der Fehlertext steht nie in Antwort oder Log |
| Outlook-Kalender (iCal-Adresse der Abteilung) | Programme, alle 5 Minuten                                                                                                                                                                                | `/health` meldet 503 nach 30 Minuten ohne erfolgreichen Abgleich                                       |
| FCM (Firebase)                                | Pushes                                                                                                                                                                                                   | ohne Schlüsseldatei keine Pushes                                                                       |
| Pwned Passwords                               | Neue Passwörter gegen bekannte Datenlecks prüfen; nur die ersten 5 Zeichen des SHA-1-Hashs gehen hinaus                                                                                                  | siehe Bedrohung 12                                                                                     |
| S3-Medienspeicher                             | Bilder (nur wenn `MEDIEN_S3_*` gesetzt ist)                                                                                                                                                              | die Medien-Routen antworten 501                                                                        |

Die Adresse von Open-Meteo steht im Code und ist keine Einstellung; es gibt keine Umgebungsvariable dafür. Das Wetter, die PDF-Aushänge und die Suche brauchen keine neuen Umgebungsvariablen.

## Lager: PDF-Aushänge und Dateien

- **Aushänge als PDF (#405):** `GET /api/v1/lager/{id}/aushaenge/{art}` erzeugt das PDF beim Aufruf im Prozess der API (Bibliothek `pdfkit`, MIT, in `dependencies`; Abruf-Grenzen: höchstens 2000 Zeilen, 300 Abschnitte und 100 Seiten, sonst 413; 10 Aushänge je Konto und Minute, 429). Nichts wird gespeichert, es braucht weder Platz noch einen Bucket. Das Zeitlimit von 10 Sekunden bricht eine Zeichnung, die selbst blockiert, nicht ab; gegen Last wirken die Grenzen und das Limit je Konto. Der Arbeitsspeicher der API ist auf 1 GB begrenzt (siehe «Server»).
- **Dateien sind Verknüpfungen (#370):** Das Lager speichert keine Dateien, nur Links auf das SharePoint der Abteilung. Die Abteilungsleitung kann in der Verwaltung festlegen, auf welche Hosts Links zeigen dürfen (`/api/v1/admin/lager-dateien/hosts`, höchstens 20; ohne Einstellung ist jeder https-Host erlaubt). Es gibt nichts zu sichern und nichts am Ablageort zu löschen; wer die Datei öffnen darf, regelt das SharePoint.
- **Wartung und Sperre:** Wie sie für das Lager wirken, steht unter «Wartungsmodus» und «Informationssperre».

## Backups

`deploy/backup.sh` sichert die Datenbank verschlüsselt mit [restic](https://restic.net) auf einen S3-Speicher in der Schweiz: täglich per Cron und vor jedem Deploy (`deploy.sh` ruft das Skript auf). restic behält 30 tägliche und 3 monatliche Stände; Älteres räumt das Skript bei jedem Lauf weg. Solange noch keine Migrationen gelaufen sind, beendet es sich ohne Backup.

### Nicht im Backup

- Sitzungen, offene Bestätigungscodes, die Schlüssel des Rate-Limits und Push-Tokens (Tabellen `session`, `verification`, `rate_limit`, `push_token`): Sitzungen enthalten Tokens, und Push-Tokens hängen an ihrer Sitzung. **Nach einer Wiederherstellung melden sich darum alle neu an.**
- Dateien auf dem Server: `deploy/.env` (Passwörter und restic-Schlüssel), `deploy/secrets/fcm-service-account.json` und die Zertifikate des Edge-Caddys (Volume im Edge-Ordner). Caddy holt Zertifikate selbst neu; die Dateien ausser den Zertifikaten sind ohne eigene Kopie verloren.
- Die erzeugten Dateien der Website (`WEBSITE_AUSGABE_PFAD`): Sie lassen sich aus der Datenbank neu erzeugen, siehe «Website».
- Die Dateien der Medien (nur Bilder, #335): Sie liegen im Bucket des Medienspeichers, nicht in der Datenbank. Der Dump enthält nur die Tabelle `medium` (Metadaten), siehe «Medienspeicher» unten.

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

### Medienspeicher

Bilder (`medium`, #335) liegen in einem eigenen S3-Bucket, den `MEDIEN_S3_*` in `deploy/.env` benennen; ohne die Variablen startet die API ohne Medien, und deren Routen antworten 501. `deploy/backup.sh` sichert nur die Datenbank: Der Dump enthält die Zeilen von `medium`, nicht die Dateien. Folgen:

- **Verlust oder Löschen des Buckets:** Die Dateien sind ohne eine Kopie des Anbieters weg. Die Zeilen bleiben, ihr Abruf antwortet dann 500 (Datei fehlt), und die Dateien müssen neu hochgeladen werden.
- **Wiederherstellung der Datenbank auf einen älteren Stand:** Dateien, die nach dem Backup hochgeladen wurden, bleiben als Waisen im Bucket (keine Zeile, keine Route liefert sie aus). Dateien, die nach dem Backup gelöscht wurden, fehlen, obwohl die Zeile zurückkommt.
- **Waisen im Normalbetrieb:** Scheitert der Speicher nach dem Löschen einer Zeile, bleibt die Datei im Bucket; das Log nennt es mit `"code":"WAISE"`. Waisen sind unsichtbar und nur Platz; ein Aufräumlauf gehört nicht zum Umfang von #335.
- **Schutz:** Der Server-Zugangsschlüssel muss Dateien löschen können (die Route «Medium löschen»). Der Schutz vor versehentlichem oder böswilligem Löschen liegt darum beim Anbieter, wie beim Backup-Bucket: Versionierung oder Object Lock, mit einer Regel, die alte Versionen nach einer festen Frist entfernt. Ob der gewählte Anbieter das bietet, ist offen und vor dem Einsatz zu klären.
- **Nur Bilder (#428):** Der Medienspeicher nimmt JPEG, PNG und WebP an; ein PDF-Upload ist 415. Dateien zum Herunterladen liegen im SharePoint der Abteilung und stehen auf der Website als Link (Baustein «Datei»); sie belegen keinen Platz im Bucket und fehlen im Backup, wie alles im SharePoint. PDF-Medien aus der Zeit vor #428 liefert keine Route mehr aus; sie bleiben in der Medienliste und lassen sich dort löschen (das entfernt auch die Datei im Bucket). Bausteine «Datei» aus dem alten Schema (mit `mediumId`) sind ungültig und müssen mit einem Link neu angelegt werden: Das Veröffentlichen antwortet 422, eine schon veröffentlichte Seite behält ihr letztes HTML.
- **Zugang:** Eigener Bucket und eigener Schlüssel, der nur diesen Bucket lesen, schreiben und löschen darf; nie der Schlüssel des Backups. Der Bucket hat keinen öffentlichen Zugriff: Auch öffentliche Medien liefert die API aus.

Einrichtung: Bucket und Schlüssel beim Anbieter anlegen, die fünf Werte `MEDIEN_S3_*` in `deploy/.env` füllen (Vorlage: `deploy/.env.example`, `MEDIEN_S3_PFADSTIL=true` nur, wenn der Anbieter den Bucket im Pfad verlangt), mit `./deploy.sh <Tag>` ausrollen. Anbieter und Bucket-Name stehen noch nicht fest.

### Prüfung einmal pro Quartal

Auf dem Server, nie auf einem persönlichen Rechner: `deploy/backup.sh pruefen` spielt den letzten Stand in einen Wegwerf-Container ohne Netz zurück, zählt die Zeilen je Tabelle neben dem Live-Stand (nur Zahlen) und öffnet psql für Stichproben. Danach löscht das Skript den Container samt Daten.

### Ernstfall: leere Datenbank

1. `docker compose -f docker-compose.prod.yml up -d --wait postgres`
2. Rollen anlegen: `docker compose -f docker-compose.prod.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d cevi_os < ../apps/api/src/db/rollen.sql`
3. Letzten Stand zurückspielen: `docker compose -f docker-compose.prod.yml run --rm -T backup dump --retry-lock 5m latest /cevi_os.dump | docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U postgres -d cevi_os --exit-on-error --single-transaction`
4. Release ausrollen: `./deploy.sh <Tag>`. Danach melden sich alle neu an.
5. Medien: Die Dateien liegen im Bucket und sind vom Verlust der Datenbank nicht betroffen. Stimmt der zurückgespielte Stand nicht mit dem Bucket überein, gelten die Folgen unter «Medienspeicher».

Fehlt auch die alte `deploy/.env`: Das Passwort der betreuenden Person oder der Abteilungsleitung als `RESTIC_PASSWORD` in die neue `deploy/.env` eintragen, denn die Wiederherstellung läuft über `run -T` und kann kein Passwort versteckt abfragen. Danach einen neuen Server-Schlüssel anlegen (`key add`, Wert als `RESTIC_PASSWORD` in `deploy/.env`) und den verlorenen entfernen (`key list` zeigt die IDs, `key remove <ID>`). Die zweiten Faktoren lassen sich ohne die alte `.env` nicht mehr entschlüsseln; die Admins richten sie neu ein, nachdem die CLI sie zurückgesetzt hat (siehe «Zweiter Faktor»).

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
2. Die Adresse in der Datenbank ungültig machen: `update abteilung set google_kalender_id = 'https://ungueltig.invalid/' where id = '<abteilungs-id>'`; die alte Adresse vorher an einem sicheren Ort notieren. Die API läuft weiter, aber jeder Sync-Lauf scheitert. Nicht `api` oder ein Netz stoppen (der Alarm käme aus einem anderen Grund).
3. 30 Minuten nach dem letzten erfolgreichen Sync antwortet `/health` mit 503, und der Uptime-Dienst gibt Alarm.
4. Zurücksetzen: die alte Adresse wieder eintragen. Der nächste Sync-Lauf folgt innert 5 Minuten, danach meldet der Uptime-Dienst die Erholung.

## Logs

Alle Dienste aus `deploy/docker-compose.prod.yml` loggen über den journald-Treiber von Docker. journald löscht nach Alter statt nach Grösse: Server-Logs und Container-Logs, auch die des Edge-Caddys, bleiben so 14 Tage.

Lesen:

- `docker compose -f deploy/docker-compose.prod.yml logs <dienst>`
- `sudo journalctl CONTAINER_NAME=<Name>`; die Namen zeigt `docker compose -f deploy/docker-compose.prod.yml ps`. Für schon entfernte Container (etwa die Migration aus `docker compose run`) listet `sudo journalctl -F CONTAINER_NAME` alle Namen, die journald kennt.

Was in den Logs steht:

- API: eine JSON-Zeile pro Anfrage mit `requestId`, Routen-Muster und Status, ohne Namen, Inhalte oder IP-Adressen. Bei 401 und 403 einer angemeldeten Anfrage steht zusätzlich `nutzerId` darin, die ID des Kontos (siehe «Abgewiesene Anfragen prüfen»). Der Healthcheck des Containers ruft `/health` alle 30 Sekunden auf; erfolgreiche Aufrufe stehen weder im Log noch in den Zahlen der Übersicht, Fehler schon. Beim Start und danach alle 24 Stunden löscht die API abgelaufene Sitzungen samt ihren Push-Tokens und schreibt eine Zeile mit `"ereignis":"sitzungen"` und der Anzahl (`geloescht`), bei einem Fehler nur dessen Code. Das Löschen nach Alter begrenzt das Log.
- Änderungsprotokoll (#637, #662): Eine Tabelle der Datenbank, nicht des Logs. Die API schreibt, was geändert wurde (erfolgreiche schreibende Anfragen mit Satz, Feldern und Namen von Rechten, Änderungen der Kommandozeile, wenige Systemereignisse mit Wirkung) gepuffert hinein (ein Schreiben je Sekunde); Sicherheitsereignisse (fehlgeschlagene Anmeldung, falscher zweiter Faktor, Begrenzung) je Konto und Stunde zusammengezogen. Zugriffe, abgelehnte Anfragen und Anmelde-Erfolge stehen dort nicht (die Logs der API zeigen sie); Fehler und Aufräumläufe des Systems auch nicht. Nur der Entwickler liest sie unter «System, Protokoll». Ohne Inhalte, mit gekürztem Tages-Hash der IP. Ein Update der Datenbank (`npm run db:migrieren`) schreibt eine Zeile «Datenbank aktualisiert» mit der Zahl der Migrationen. Beim Beenden (SIGTERM) schreibt die API den Puffer zu Ende. Die Zeile `{"ereignis":"aktivitaet","code":…}` im Log meldet, dass ein Schreiben scheiterte (nur der Code der Datenbank).
- Edge-Caddy: IP-Adressen. Er schreibt auf stderr und damit nach journald; keine Log-Datei, kein Volume. Lesen im Edge-Ordner mit `docker compose logs caddy`.
- Kalender-Feed (#438): `GET /ical/<Token>.ics` trägt den geheimen Token im Pfad. Die API loggt nur das Muster `/ical/:datei`. Der Edge-Caddy dagegen schriebe den Pfad in sein Zugriffslog; darum hat `deploy/edge/cevi-os.caddy` einen `log`-Block, der den Pfad unter `/ical/` ersetzt (`/ical/<verborgen>`) und so auch die Fehlerzeilen des Reverse-Proxys abdeckt. Das ist ein Vorschlag, den niemand gegen einen laufenden Caddy geprüft hat: nach dem Übernehmen `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`, dann `curl -s -o /dev/null https://<Domain>/ical/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics` und in `docker compose logs caddy` prüfen, dass die Zeile `/ical/<verborgen>` zeigt und nicht die 43 Zeichen. Zeigt sie den Pfad, den `log`-Block ändern oder entfernen, bevor Links verteilt werden. Dasselbe gilt für jedes Log davor (Proxy, Überwachung): Der Token darf in keinem stehen.
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

### Abgewiesene Anfragen prüfen

Einen Alarm für gehäufte 401 (nicht angemeldet, Anmeldung fehlgeschlagen) und 403 (keine Berechtigung) gibt es nicht; geprüft wird von Hand im Log der API, in `deploy/`:

1. Nach Route zählen, hier für die letzten 24 Stunden: `docker compose -f docker-compose.prod.yml logs --since 24h --no-log-prefix api | grep -oE '"route":"[^"]*","status":40[13]' | sort | uniq -c | sort -rn`
2. Nach Konto zählen: `docker compose -f docker-compose.prod.yml logs --since 24h --no-log-prefix api | grep -oE '"nutzerId":"[^"]*"' | sort | uniq -c | sort -rn`. `nutzerId` steht nur bei 401 und 403 und nur, wenn die Anfrage eine gültige Sitzung hatte.

Worauf achten:

- Viele 401 auf `/api/auth/sign-in/username`: Jemand rät Passwörter. Wartezeit und Rate-Limit bremsen; die IP-Adressen dazu stehen nur im Log von Caddy.
- Viele 403 bei derselben `nutzerId`: Ein Konto versucht, was es nicht darf. Die ID ist die Spalte `id` der Tabelle `user`. Deutet es auf ein gekapertes Konto, gilt «Datenpanne».
- 403 ohne `nutzerId` auf einer ändernden Route unter `/api/v1`: Die Anfrage kam mit einem fremden `Origin`, etwa von einer anderen Webseite im Browser einer angemeldeten Person.

## Zweiter Faktor

Admins melden sich zusätzlich mit einem Code aus einer Authenticator-App oder einem Passwort-Manager an (TOTP, zehn Ersatzcodes, kein «Gerät vertrauen»). Ohne zweiten Faktor ist die Verwaltung gesperrt (`/api/v1/admin/*`); einrichten lässt er sich im Profil. Es handeln Rollen, keine bestimmten Personen.

- **Neues Gerät, das alte ist gelöscht:** Ein anderer Admin setzt den zweiten Faktor in der Verwaltung zurück («Zweiten Faktor zurücksetzen» auf der Seite der Person). Die Person meldet sich danach ohne Code an und richtet ihn neu ein.
- **Gerät verloren:** Derselbe Admin setzt zuerst ein «Neues Startpasswort» (das beendet jede Sitzung der Person; im Passwort-Manager des verlorenen Geräts kann das alte Passwort stehen) und setzt erst dann den zweiten Faktor zurück. Nie zurücksetzen, solange ein altes Passwort noch gilt, sonst richtet die fremde Person den neuen Faktor selbst ein (siehe «Datenpanne»).
- **Kein Admin besteht den zweiten Faktor mehr:** Wer den Server betreibt, setzt ihn mit der CLI zurück, in `deploy/`: `docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/zweiter-faktor-zuruecksetzen.ts --benutzername <name>`; immer `exec`, nie `run`. Lokal: `npm run zweiter-faktor:zuruecksetzen -w apps/api -- --benutzername <name>`. Die CLI braucht nur `DATABASE_URL` und läuft ohne Anmeldung, auch nach einem Wechsel des Auth-Geheimnisses.
- **Das Auth-Geheimnis ändert sich:** better-auth verschlüsselt die TOTP-Geheimnisse und die Ersatzcodes mit `BETTER_AUTH_SECRET`. Nach einem Wechsel lassen sie sich nicht mehr entschlüsseln: Wer den Server betreibt, setzt den Faktor jedes Admins mit der CLI zurück, danach meldet sich jeder an und richtet ihn neu ein.

Jede Zurücksetzung schreibt eine Zeile ins Audit-Log; bei der CLI steht «cli» als Akteur.

## Plattformrollen

Der **Entwickler** hat jedes Recht der Plattform und lässt sich nur mit der CLI vergeben und entziehen, nie über die Verwaltung oder eine Route (#423). In `deploy/`: `docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/entwickler.ts vergeben --benutzername <name>`, zum Entziehen `entziehen` statt `vergeben`. Lokal: `npm run entwickler:vergeben -w apps/api -- --benutzername <name>` und `npm run entwickler:entziehen -w apps/api -- --benutzername <name>`. Die CLI braucht nur `DATABASE_URL`; jede Änderung steht im Audit-Log mit «cli» als Akteur. Der Entwickler braucht den zweiten Faktor: Ohne ihn antwortet die API mit 403 `ZWEITER_FAKTOR_FEHLT`.

Die **Abteilungsleitung** hat die Rechte fest. Weitere Rollen (zuerst der Webmaster, den jede Abteilung als Vorgabe hat) legt die Abteilungsleitung an und stellt ihre Rechte ein (`/api/v1/admin/plattform/rollen`). Jedes dieser Rechte ist «erweitert» und braucht den zweiten Faktor; einfach ist nur die Arbeit der Stufenleitung an der eigenen Stufenseite. Die Lager-Rolle `lagerleitung` braucht ihn nur, um die Rechte der Rollen zu ändern (im Web, #523); in der App arbeitet sie ohne zweiten Faktor. Die Rolle einer Person ändert sich mit der nächsten Anfrage, ohne neue Anmeldung.

## Wartungsmodus

Bevor ein Bereich gewartet wird (zum Beispiel ein Update der Datenbank oder ein Umbau der Website), setzt ihn die Abteilungsleitung oder der Entwickler in den **Wartungsmodus** (#424): In der Verwaltung unter «Plattform» den Bereich wählen, «Wartung einschalten», einen Hinweistext und ein geplantes Ende eintragen. Dieselbe Seite hebt die Wartung wieder auf. Die Rolle «Webmaster» darf nur die Wartung der Website schalten, und nur mit dem einstellbaren Recht `wartungsmodus.website` (die Vorgabe hat es nicht). Jede Schaltung braucht den zweiten Faktor und steht im Audit-Log.

- **Immer nur lesbar:** Ansehen geht, jede schreibende Anfrage und jede Bearbeitungsansicht der Website antwortet mit 503 und dem Code `IN_WARTUNG` samt Hinweistext und Ende. Es gibt keine ganz gesperrte Wartung; das ist die Informationssperre.
- **Bereiche:** `website`, `lager`, `chat`, `programme`, `verwaltung` oder `alles`. Abteilungsleitung und Entwickler arbeiten in jedem Bereich weiter, die Verwaltung bleibt für sie erreichbar. Anmeldung und `/health` sind nie in Wartung.
- **Kein Ende von selbst:** Das geplante Ende ist nur eine Anzeige; die Wartung dauert, bis sie jemand aufhebt. Aufheben wirkt mit der nächsten Anfrage.
- **Zustand:** Er liegt in der Tabelle `bereichsschalter` und wird beim Start in den Speicher der API geladen; ein Neustart behält ihn. Läuft die API auf mehr als einer Instanz, wirkt eine Schaltung erst nach dem Neustart der übrigen (heute läuft eine Instanz).
- **Ohne Verwaltung:** Fällt die Verwaltung aus, lässt sich der Zustand in der Datenbank ändern (`delete from bereichsschalter where bereich = '<bereich>' and art = 'wartung'`) und die API neu starten.

## Lager löschen

Die Abteilungsleitung löscht ein Lager endgültig mit `DELETE /api/v1/admin/lager/{id}` (#400; zweiter Faktor, Titel des Lagers im Body als Bestätigung). Das geht nur für einen Entwurf, ein archiviertes Lager oder ein Übungslager; ein aktives oder abgeschlossenes Lager ist 409. Das Löschen ist **nicht rückgängig zu machen**: Es entfernt in einer Transaktion alle Daten des Lagers aus der Datenbank (Mitglieder, Aufgaben, Pinnwand, Eingang, Adressbuch, Rechte, Änderungsfeed, Dateiverknüpfungen). Vorher bei Bedarf den Export des Lagers ziehen (#401).

- **Dateien:** Sie liegen im SharePoint; Cevi OS löscht dort nichts, nur die Verknüpfungen verschwinden. Das Logo bleibt in der Mediathek der Abteilung. Im Medienspeicher (S3) hält ein Lager sonst nichts.
- **Backups:** Ältere Sicherungen enthalten das Lager weiter, bis restic sie nach den 30 Tagen und 3 Monaten (siehe «Backups») entfernt. Wer Daten früher loswerden muss, spielt keine Sicherung zurück, die das Lager noch enthält.
- **Wartung:** Der Wartungsmodus des Bereichs `lager` (siehe oben) sperrt schreibende Lager-Routen inklusive der Warteschlange `POST /api/v1/lager/{id}/aenderungen`; es gibt keinen eigenen Wartungsmodus je Lager. Die Abteilungsleitung kann auch in Wartung löschen.
- **Audit-Log:** `lager_geloescht` nennt nur die Lagerkennung und die Zahl der entfernten Dateiverknüpfungen, nie Titel oder Inhalte.

## Informationssperre

Die **Informationssperre** (#425) dämmt einen Vorfall ein, bevor die Ursache geklärt ist: Ein gesperrter Bereich liefert keine Inhalte mehr. Auslösen und Aufheben dürfen nur der Entwickler und die Abteilungsleitung, mit zweitem Faktor; der Webmaster nie. In der Verwaltung unter «Plattform», Abschnitt «Informationssperre».

- **Wirkung:** Jede Anfrage des Bereichs antwortet 423 mit dem Code `GESPERRT` und einem neutralen Text, lesend und schreibend, auch für die Abteilungsleitung und den Entwickler. Offen bleiben nur die Schalter selbst (`/api/v1/plattform`), die Anmeldung, `/health` und die statischen Seiten der Verwaltung. Bei `alles` melden sich nur Abteilungsleitung und Entwickler noch an; für alle anderen antwortet die Anmeldung wie bei jedem Fehler mit 401 `ANMELDUNG_FEHLGESCHLAGEN` (es entsteht keine Sitzung). Die Sperre geht der Wartung vor.
- **Bereiche:** `website` (auch die öffentlichen Medien), `lager`, `chat`, `programme`, `verwaltung` oder `alles`.
- **Grenzen der Bereiche:** Die Zuordnung steht in `apps/api/src/bereichsschalter.ts` (`BEREICH_NACH_PFAD`). Der Bereich `programme` umfasst `/api/v1/programme`, `/api/v1/termine`, die Anlässe, die Terminvorschläge, die Kategorie-Zuordnungen (auch unter `/api/v1/admin`), den Kalenderlink (`/api/v1/ich/kalender-link`) und die Anwesenheit der Stufen; `lager` auch `/api/v1/ich/lager-benachrichtigungen`. Ohne Bereich bleiben nur Konto-Grundfunktionen (`ich`, Profilbild, `push-token`, `stufen`); sie trifft nur `alles`, und `/api/v1/plattform` nie. Der Test `bereichsschalter-routen.test.ts` hält fest, dass keine Route ohne Bereich dazukommt. Der Kalender-Feed `GET /ical/<Token>.ics` liegt ausserhalb von `/api/v1`, prüft den Schalter aber selbst: Unter einer Sperre von `programme` oder `alles` antwortet er wie bei einem unbekannten Token (404). Der Block auf `/ical/*` am Edge-Caddy ist nur noch eine zusätzliche Schicht.
- **Auf Wunsch zusätzlich:** «Alle Sitzungen der Abteilung beenden» (dieselbe Funktion wie `npm run sitzungen:beenden`, aber nur für die Abteilung und ohne die Sitzung der Person, die sperrt) und «Öffentliche Website vom Netz nehmen» (nur bei `website` und `alles`): Der Server löscht die Dateien der Website in `WEBSITE_AUSGABE_PFAD`, ausser `weiterleitungen.caddy`, und schreibt eine neutrale Hinweisseite (`index.html` und `404.html`). Der Abgleich erzeugt die Website in dieser Zeit nicht neu. Beim Aufheben löscht der Server die Hinweisseiten und löst den Abgleich aus; die Website erscheint wieder, sobald er durch ist. Ohne eingerichtete Website (`WEBSITE_*` nicht gesetzt) entfällt dieser Wunsch.
- **Push:** Bei der Auslösung gehen alle anderen Entwickler der Abteilung per Push auf den Vorfall hin (Titel «Informationssperre ausgelöst», nur der Bereich, nie der Anlass). Das Audit-Log hat einen Eintrag je Schaltung (`schalter_gesetzt`, `schalter_geaendert`, `schalter_aufgehoben`) mit Akteur, Zeit, Bereich und den Wünschen, ohne die Notiz.
- **Zustand:** wie beim Wartungsmodus in der Tabelle `bereichsschalter`, beim Start in den Speicher geladen; ein Neustart behält die Sperre. Läuft die API auf mehr als einer Instanz, wirkt eine Schaltung erst nach dem Neustart der übrigen.
- **Ohne Verwaltung:** Ist die Verwaltung selbst gesperrt, öffnet sich die Seite «Plattform» trotzdem (sie braucht nur `/api/v1/plattform` und die Anmeldung); andere Seiten der Verwaltung zeigen den Hinweis auf die Sperre. Als Notausgang bleibt die Datenbank: `delete from bereichsschalter where art = 'sperre'` und die API neu starten.

## Datenpanne

Der Ablauf gilt, sobald Daten in falsche Hände geraten sein könnten, etwa durch ein gekapertes Konto, ein geleaktes Geheimnis oder eine kopierte Datenbank. Es handeln Rollen, keine bestimmten Personen: Wer den Server betreibt, führt die Befehle aus; der Vorstand entscheidet und meldet.

0. **Sofort eindämmen:** Der Entwickler oder die Abteilungsleitung löst die Informationssperre aus (Abschnitt «Informationssperre», Bereich `alles`, wenn unklar ist, was betroffen ist), mit «Alle Sitzungen der Abteilung beenden» und, wenn die öffentliche Website betroffen sein kann, «Öffentliche Website vom Netz nehmen». Das geht ohne Kommandozeile und wirkt mit der nächsten Anfrage. Die Sperre hebt erst auf, wer sie nach Schritt 4 für unbedenklich hält.
1. **Alle Sitzungen beenden:** `npm run sitzungen:beenden -w apps/api` (alle Abteilungen; die Sperre beendet auf Wunsch nur die der eigenen Abteilung). Der Befehl liest `DATABASE_URL` aus der Umgebung oder aus `apps/api/.env` und meldet «Beendete Sitzungen: n». Alle müssen sich neu anmelden; Konten, Passwörter und zweite Faktoren bleiben.
2. **Den Vorstand informieren.** Bedeutet die Panne wahrscheinlich ein hohes Risiko für die betroffenen Personen, geht so rasch als möglich eine Meldung an den EDÖB über <https://databreach.edoeb.admin.ch/report> (Art. 24 Abs. 1 DSG), ohne auf die Schritte 3 und 4 zu warten; noch fehlende Angaben folgen so rasch als möglich (Art. 15 Abs. 2 DSV).
3. **Geheimnisse wechseln,** jedes einzeln:
   - Auth-Geheimnis: in `BETTER_AUTH_SECRET` einen neuen Zufallswert setzen und die API neu starten. Alte Cookies gelten dann nicht mehr, und die gespeicherten TOTP-Geheimnisse und Ersatzcodes lassen sich nicht mehr entschlüsseln: Kein Admin besteht den zweiten Faktor, bis er neu eingerichtet ist (Schritt 4). Den alten Wert vollständig entfernen, auch nicht als ältere Version in `BETTER_AUTH_SECRETS` behalten: Wer ihn kennt, könnte damit weiterhin Codes berechnen.
   - Passwörter der Datenbankrollen (#69).
   - Outlook-Kalenderadresse: in Outlook die Freigabe neu veröffentlichen (neue Adresse, die alte erlischt), die neue Adresse in die Datenbank eintragen.
   - Schlüssel des Firebase-Dienstkontos für FCM (#154): einen neuen Schlüssel erzeugen, ihn nach `deploy/secrets/fcm-service-account.json` legen, die API neu starten und erst dann den alten Schlüssel löschen.
   - restic- und S3-Schlüssel (#71).
   - S3-Schlüssel des Medienspeichers (#335): beim Anbieter einen neuen Schlüssel für den Bucket der Medien erzeugen, die zwei Werte `MEDIEN_S3_ZUGANGSSCHLUESSEL` und `MEDIEN_S3_GEHEIMSCHLUESSEL` in `deploy/.env` ersetzen, die API neu starten und erst dann den alten Schlüssel löschen.
4. **Gekapertes Konto sperren, dann zweite Faktoren neu einrichten.** Nach Schritt 3 besteht kein Admin den zweiten Faktor. Die CLI (`docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/zweiter-faktor-zuruecksetzen.ts --benutzername <name>`, in `deploy/`) setzt den Faktor genau eines vertrauenswürdigen Admins zurück; diese Person meldet sich an und richtet ihren Faktor neu ein. Dann deaktiviert sie das gekaperte Konto oder gibt ihm ein neues Startpasswort (#18); nie den Faktor eines Kontos zurücksetzen, solange sein altes Passwort noch gilt, sonst richtet die fremde Person den neuen Faktor selbst ein. Danach setzt sie die Faktoren der übrigen Admins zurück (#23), und diese richten ihre neu ein. Bleibt kein vertrauenswürdiger Admin übrig, legt die CLI (#20) einen neuen an, in `deploy/`: `docker compose -f docker-compose.prod.yml exec api node --import tsx src/cli/admin-anlegen.ts --benutzername <name> --name "<Vorname Nachname>" --abteilung "<Name>"`; immer `exec`, nie `run`, sonst steht das Startpasswort 14 Tage im journald (siehe «Logs»).
5. **Dokumentieren:** die Tatsachen rund um die Panne, ihre Auswirkungen und die getroffenen Massnahmen (Art. 15 Abs. 4 DSV), dazu ob gemeldet wurde und warum. Die Dokumentation bleibt mindestens zwei Jahre erhalten, nie im Repo, in Issues oder in PRs.
