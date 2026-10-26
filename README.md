# Cevi OS

App für eine Cevi-Abteilung: Programme aus dem Google-Kalender, Ja/Nein-Anmeldung und Chat zwischen Eltern und Stufenleitung (iOS und Android).

## Aufbau

Ein Monorepo mit npm workspaces:

- `apps/api`: das Backend, eine API mit Hono auf Node
- `apps/mobile`: die App für iOS und Android, mit Expo und expo-router
- `docs`: Doku zu Architektur, Sicherheit, Barrierefreiheit und Git-Workflow
- `deploy`: Dateien für den Betrieb auf dem Server
- `.github`: CI, Dependabot und PR-Vorlage
- `docker-compose.yml`: PostgreSQL 18 für die Entwicklung

## Lokal starten

Voraussetzungen: Node 26 wie in der CI und Docker mit Compose.

1. Im Wurzelordner des Repos die Pakete installieren: `npm ci`
2. Die Datenbank starten, PostgreSQL 18, nur von diesem Rechner aus erreichbar: `docker compose up -d db`
3. `apps/api/.env.example` nach `apps/api/.env` kopieren. Die Vorlage passt schon zur Datenbank aus `docker-compose.yml` und setzt `BETTER_AUTH_URL` auf `http://localhost:3000`. Nur `BETTER_AUTH_SECRET` fehlt: ein zufälliges Geheimnis mit mindestens 32 Zeichen, zum Beispiel aus `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
4. Die Migrationen ausführen: `npm run db:migrieren -w apps/api`. Das Skript legt die Tabellen an und vergibt die Rechte der API, als Besitzer der Tabellen mit `MIGRATION_DATABASE_URL` aus `apps/api/.env`. Bei Erfolg meldet es nichts.
5. Die API starten: `npm run dev -w apps/api`. Das Skript startet sie mit tsx im Watch-Modus: Sie liest `apps/api/.env` und startet bei Änderungen am Code neu. Ihren Start meldet sie nicht, danach steht pro Anfrage eine JSON-Zeile im Terminal.
6. `http://localhost:3000/health` im Browser öffnen. `ok` heisst: API und Datenbank laufen. `fehler` (Status 503) heisst: Die Datenbank ist nicht erreichbar oder ihre Tabellen fehlen, oder bei einer Abteilung mit Kalender liegt der letzte erfolgreiche Sync mehr als 30 Minuten zurück; den Grund nennt das Log der API. Der Port kommt aus `PORT` in `apps/api/.env`, in der Vorlage 3000.
7. Falls noch kein Dev-Build der App installiert ist, in `apps/mobile` bei Expo anmelden, mit einem Konto, das Zugriff auf das EAS-Projekt der App hat: `npx eas-cli login`
8. Falls noch kein Dev-Build der App installiert ist, ihn in `apps/mobile` bei EAS bauen lassen, mit dem Profil `development` aus `apps/mobile/eas.json`: `npx eas-cli build --profile development --platform android`. Auf ein Gerät kommt er über den QR-Code oder den Link, den eas-cli am Ende ausgibt; auf einem Emulator bietet eas-cli die Installation selbst an.
9. In `apps/mobile` den Entwicklungsserver starten: `npx expo start`. Er bedient von selbst den Dev-Build und nicht Expo Go, weil `expo-dev-client` direkt in `apps/mobile/package.json` steht. Gerät und Rechner müssen im selben Netz sein. Dann den QR-Code aus dem Terminal scannen oder im Dev-Build den Server wählen.

Einen neuen Dev-Build braucht es nur nach einem neuen oder aktualisierten Paket mit nativem Code, nach einer Änderung an `apps/mobile/app.json` oder nach einem Update des Expo-SDK. Auf einem Emulator installiert `npx eas-cli build:run -p android` einen fertigen Build später noch einmal.

EAS baut nur, was committet ist (`requireCommit` in `apps/mobile/eas.json`). Darum vor dem Build alles committen. Fragt eas-cli trotzdem «Commit changes to git?», mit `n` antworten: eas-cli bricht ab, danach von Hand committen und den Build neu starten. Mit `y` oder Enter führt eas-cli `git add -A` aus und committet jede nicht ignorierte Datei im ganzen Repo, ohne sie vorher zu zeigen.

Der Dev-Build für das iPhone folgt mit #6.

## Prüfen

Die CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) prüft jeden PR mit diesen Befehlen. Lokal laufen sie gleich, im Wurzelordner des Repos.

API, wie die Jobs «API und Rechte» und «Abhaengigkeiten (npm audit)»:

```sh
npm run db:migrieren -w apps/api
npm run typecheck -w apps/api
npm run lint -w apps/api
npx prettier --check apps/api
npm test -w apps/api
npm audit --omit=dev --audit-level=high -w apps/api
```

App, wie der Job «App (Typen, Lint, Tests)»:

```sh
npm run typecheck -w apps/mobile
npm run lint -w apps/mobile
npx prettier --check apps/mobile
npm test -w apps/mobile
```

- Die Tests der API brauchen die Datenbank aus `docker compose up -d db` mit den Rollen aus `apps/api/src/db/rollen.sql`; auf einem neuen Volume legt Compose sie selbst an. Jeder Lauf von `npm test -w apps/api` baut die Testdatenbank `cevi_os_test` frisch aus den Migrationen auf und lässt `cevi_os` unberührt; ein zweiter Lauf, der währenddessen startet, wartet auf den ersten. Die Tests lesen weder `DATABASE_URL` noch `apps/api/.env`.
- Der Audit der API macht die CI bei Funden ab `high` rot. Für die App läuft er in der CI nur als Hinweis.
- `npm run format` formatiert nur `apps/`. Dateien ausserhalb, etwa die Doku, prüft `npx prettier --check <Pfad>`; die CI prüft sie nicht.

## Mitwirken

- Wie Branches, PRs, Commits und Releases laufen und was nie ins Repo, in Issues oder PRs gehört, steht in [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md).
- Fehler als Issue melden.
- Sicherheitslücken nie als Issue, nur wie in [`SECURITY.md`](SECURITY.md) beschrieben.

## Doku

- [Architektur](docs/architektur.md): die Teile von Cevi OS und wer mit wem spricht
- [Git-Workflow](docs/GIT_WORKFLOW.md): Branches, PRs, Commits und Releases
- [Sicherheit](SECURITY.md): Sicherheitslücken melden
- [Bedrohungsmodell](docs/sicherheit/bedrohungsmodell.md): Bedrohungen, Massnahmen und bewusste Verzichte
- [Checkliste Barrierefreiheit](docs/barrierefreiheit.md): Prüfpunkte für jeden Bildschirm der App
- [Betrieb](docs/betrieb.md): der Ablauf bei einer Datenpanne
