# Endpunkte mit Postman prüfen

Die Collection `postman/collections/Cevi OS API/` enthält jede Route der Rechte-Matrizen: die Hauptmatrix (`apps/api/test/rechte-matrix.test.ts`), die des Lagers (`apps/api/test/lager/matrix/*.ts`) und die der Termine (`apps/api/test/termine/matrix/*.ts`). Ihr Test erwartet den Status, den die Matrix für die gewählte Persona festhält. Für das Lager gilt der Status der Rolle, die die Persona im Lager hat (admin ist die Abteilungsleitung, elternB die Lagerleitung, slB die Leitung, leitendeA das Team, leitendeB Lesen, elternA ein Konto ohne Mitgliedschaft, demoEltern die Lagerleitung einer anderen Abteilung; Zuordnung in `apps/api/test/lager/matrix.ts`), gegen ein aktives Lager. Personas ohne Rolle im Lager überspringen die Lager-Anfragen. Mit der Persona `ohneLogin` oder einer fremden Stufe prüft sie also auch Zugriffe ohne Recht (401, 403, 404). Alle Routen und Stati stehen in [endpunkte.md](endpunkte.md).

Die Umgebungen (je Persona eine, mit Sitzung und IDs) enthalten Sitzungen und liegen nur lokal in `apps/api/.postman-lokal/` (git-ignoriert). Sie gehören nie ins Repo.

## Ablauf

Voraussetzung: PostgreSQL aus `docker-compose.yml` läuft, `npm ci` ist gelaufen.

1. Umgebungen erzeugen. Der Test baut die Datenbank `cevi_os_test` neu auf und legt alle Personas an:

   ```sh
   cd apps/api
   POSTMAN_EXPORT=1 npx vitest run test/rechte-matrix.test.ts -t Postman-Export
   ```

2. API auf dieser Datenbank starten (Port 3999, falls 3000 belegt ist). Das Geheimnis muss das Standardgeheimnis von better-auth sein, mit dem der Test die Sitzungen signiert:

   ```sh
   DATABASE_URL=postgres://cevi_os_api@localhost:5432/cevi_os_test APP_MIN_VERSION=0.1.0 PORT=3999 \
   BETTER_AUTH_SECRET=better-auth-secret-12345678901234567890 BETTER_AUTH_URL=https://cevi-os.invalid \
   BETTER_AUTH_TRUSTED_ORIGINS=testapp:// npx tsx src/server.ts
   ```

3. Collection mit der Postman CLI laufen lassen, je Persona einmal:

   ```sh
   postman collection run "postman/collections/Cevi OS API" \
     -e apps/api/.postman-lokal/elternA.environment.yaml --env-var baseUrl=http://localhost:3999
   ```

   In der Postman-App: Collection-Ordner und eine Umgebung importieren, dann «Run».

## Wichtig

- Ein Lauf verbraucht die Sitzungen (am Ende stehen `sign-out` und `revoke-sessions`) und ändert Daten. Für einen zweiten Lauf Schritt 1 wiederholen und die API neu starten.
- Die 14 Personas lassen sich nacheinander gegen dieselbe Datenbank laufen. Bei Routen mit Ziel (Lager, Termine) legt der Export je Persona ein neues Ziel an (Variablen `pfad_L<n>` und `pfad_T<n>` in der Umgebung); einzelne Anfragen mit einem festen Body oder einem festen Objekt können nach einem früheren Lauf anders antworten. Für ein verlässliches Ergebnis je Persona Schritt 1 wiederholen und die API neu starten.
- Stand beim Erzeugen (22.11.2026, erster Lauf der Persona admin gegen eine frische Datenbank): 15 von 424 Anfragen weichen ab, weil die lokale API Attrappen hat (Kalender-Abgleich 200 statt 501, Mitteilung 503 ohne FCM-Schlüssel) oder ein Body ein Objekt der Matrix voraussetzt (Rollen der Plattform, Eckdaten, Anwesenheit, Eingang, Traktandum, Zeitplan, Umfrage, Anlass, Kategorie-Zuordnung, Terminvorschlag). Die Personas leitendeA, ohneLogin und demoEltern liefen ohne Abweichung. Massgebend bleibt die Matrix im Test (`rechte-matrix.test.ts`).
- Der Event-Stream des Lagers (`GET /api/v1/lager/{id}/ereignisse`) fehlt in der Collection, weil die Antwort nie endet. Die Matrix prüft ihn im Test.
- Das Bild-Hochladen (`PUT /api/v1/ich/bild`) fehlt in der Collection, weil der Body binär ist. Die Matrix prüft es im Test.
- Die Medien-Routen (`/api/v1/admin/medien`, `/api/v1/medien/{id}`, #335) fehlen ebenfalls: Der Upload ist binär, und die übrigen brauchen einen Medienspeicher (S3), den die lokale API dieser Anleitung nicht hat. Die Matrix prüft sie im Test mit einer Attrappe.
- Neue Route: Zeile in die passende Matrix (Hauptmatrix, `test/lager/matrix/<modul>.ts` oder `test/termine/matrix/<modul>.ts`), dann `node apps/api/scripts/postman-erzeugen.mjs` nach Schritt 1, danach `npx prettier --write docs/api/endpunkte.md`; das Skript schreibt `endpunkte.md` und die Collection neu. Beide nicht von Hand ändern.
