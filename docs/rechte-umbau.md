# Rechte-Umbau: Entwickler ist der einzige Admin (Epic #714)

Überblick über den Umbau vom 24.11.2026. Die Einzelheiten stehen in [rechte.md](rechte.md) (Modell), [betrieb.md](betrieb.md) (Server, Kommandozeile), dem [Bedrohungsmodell](sicherheit/bedrohungsmodell.md) (Nr. 6, 61) und im [API-Vertrag](api/openapi.yaml).

## Der Entscheid

- Es gibt keine Rolle «Admin» mehr. Admin ist allein der **Entwickler** (Tabelle `plattform_entwickler`, nur per Kommandozeile). Er hat alle Rechte und alle Sichten, auch an Personen-, Kinder- und Lagerdaten. Das weicht von SR-41 ab und steht im Bedrohungsmodell (Nr. 61).
- Die **Abteilungsleitung** ist eine Rolle, die vergeben wird (Tabelle `abteilungsleitung_person`), keine Administration. Ihre Rechte stellt der Entwickler ein.
- In jeder Abteilung bleibt mindestens eine aktive Person mit Abteilungsleitung oder Entwickler (`LETZTE_ABTEILUNGSLEITUNG`, 409).
- Die Apps passen sich der API an: kein Alias, kein Altfeld `admin`.
- **Konto löschen ist ein Recht wie jedes andere (#771, Entscheid vom 24.11.2026).** `konto.loeschen` ist «erweitert» und vergebbar: Entwickler und Abteilungsleitung haben es (die Abteilungsleitung einstellbar), eine Rolle oder Person bekommt es im Rechte-Editor. Es hängt nicht mehr an «Personen verwalten». Die Route schützt unabhängig vom Recht: das eigene Konto nie, Konten von Entwicklern nur durch einen Entwickler, Konten der Abteilungsleitung nur durch Abteilungsleitung oder Entwickler (403 `KONTO_GESCHUETZT`), die letzte Abteilungsleitung bleibt (409 `LETZTE_ABTEILUNGSLEITUNG`). Die Verwaltung zeigt den Knopf bei vorhandenem Recht und bei geschützten Konten den Grund. Keine Migration: Rechte sind der Code-Katalog, bestehende Zuweisungen und Abzüge bleiben.
- **Konten über dem Handelnden bleiben unberührt (#777).** Wer ein fremdes Konto ändert, deaktiviert, zurücksetzt oder ihm eine Plattformrolle gibt, kommt nie an ein Konto von Entwicklern, wenn er selbst keiner ist, und nie an ein Konto der Abteilungsleitung, wenn er weder Abteilungsleitung noch Entwickler ist (403 `KONTO_GESCHUETZT`). Das gilt an jeder dieser Routen, unabhängig vom Recht (`schuetzeUeberKonto`). Vorher schützte nur das Löschen die Entwickler; Abteilungsleitung und jede Rolle mit «Personen verwalten» konnten ein Entwickler-Konto übernehmen.

## Das Modell nachher

| Frage                             | Antwort                                                                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wer ist Abteilungsleitung?        | Wer eine Zeile in `abteilungsleitung_person` hat. Gelesen wird nur die Tabelle; `user.role` ist seit **Teil 10** (#784) immer «user» und gilt nirgends.                                                                                 |
| Wer ist Entwickler?               | Wer eine Zeile in `plattform_entwickler` hat. Er hat jedes Recht des Katalogs und über `siehtAlles` jede Sicht der Abteilungsleitung, nur in der eigenen Abteilung.                                                                     |
| Wo lese ich die Rolle?            | `GET /api/v1/ich`: `abteilungsleitung` und `entwickler`. `get-session` liefert kein `role` mehr.                                                                                                                                        |
| Zweiter Faktor                    | Jedes Konto darf ihn einrichten, ausser dem eigenen Konto eines Kindes. Pflicht für Abteilungsleitung, Entwickler und Rechte mit «erweitert», **nur in der Verwaltung**. Die Website und die Apps brauchen ihn nie.                     |
| Fehlt er bei Pflicht              | Die Verwaltung zeigt «Zweiten Faktor einrichten» (QR-Code, Schlüssel, Ersatzcodes). 403 `ZWEITER_FAKTOR_FEHLT`. Wird er durch eine Rechteänderung Pflicht, endet die Sitzung; beim nächsten Login kommt die Einrichtung.                |
| App ohne Code                     | Die App meldet sich mit Benutzername und Passwort an, auch mit Faktor am Konto. Die Sitzung ist markiert (`session.zweiter_faktor_geprueft = false`) und öffnet Verwaltung und «erweiterte» Rechte nicht: 403 `ZWEITER_FAKTOR_SITZUNG`. |
| Sperre «letzte Abteilungsleitung» | Gilt in der Verwaltung und bei `abteilungsleitung:entziehen`, nicht bei `entwickler:entziehen` und SQL. Notfall: `abteilungsleitung:vergeben` oder `entwickler:vergeben`.                                                               |

## Wo es im Code liegt (`apps/api`)

- Person und Sichten: `src/rechte.ts` (`Person.abteilungsleitung`, `Person.entwickler`, `siehtAlles`, `zweiterFaktorPflicht`, `zweiterFaktorFehlt`), `src/admins.ts` (`istAbteilungsleitung`), `src/rechtemodell/person.ts`, `satz.ts`, `sql.ts` (Entwickler hat jedes Recht).
- Sperre: `src/verwalter.ts`; Aufruf in `src/routes/admin/personen.ts`.
- Zweiter Faktor: `src/auth.ts` (Einrichten, App-Anmeldung, Markierung der Sitzung), `src/rechtemodell/faktor-pflicht.ts` (Sitzungen beenden bei neuer Pflicht), Verwaltung `public/admin/zweiter-faktor-einrichten.js` und `qr.js`.
- Verwaltung: `public/admin/sicht.js` (`istAbteilungsleitung`, `istEntwickler`, `siehtAlles`), `admin.js` (`pruefeKonto` holt `/ich`).
- Kommandozeile: `src/cli/konto-anlegen.ts` (`konto:anlegen`, Alias `admin:anlegen` in `admin-anlegen.ts`), `abteilungsleitung.ts`, `entwickler.ts`.
- Tabellen und Migrationen: `src/db/schema-plattform.ts`, `drizzle/0159_*`, `drizzle/0160_*`, Rückwege in `drizzle/rueckweg/`.

## Die Teile und ihre PRs

Die Teile 1 bis 9 liegen im Stack #727 und sind mit v0.10.1 und v0.10.2 ausgerollt. Teil 10 (#784) ist ein eigenes, späteres Release.

| Teil | PR        | Inhalt                                                                                       |
| ---- | --------- | -------------------------------------------------------------------------------------------- |
| 1    | #717      | Zweiten Faktor in der Verwaltung einrichten, Pflicht bei Rechten                             |
| 1b   | #726      | App-Anmeldung ohne zweiten Faktor, Markierung der Sitzung (0160)                             |
| 2    | #729      | Abteilungsleitung in eigener Tabelle, Spiegel `role` (0159)                                  |
| 6    | #732      | Entwickler hat alle Rechte                                                                   |
| 5    | #733      | Kommandozeile `konto:anlegen`, `abteilungsleitung:vergeben/entziehen`                        |
| 4    | #734      | Sperre «mindestens eine Abteilungsleitung oder ein Entwickler»                               |
| 3    | #744      | Umbenennung `admin` zu `abteilungsleitung`, `entwickler`, `siehtAlles`                       |
| 8    | #745      | API-Vertrag: `abteilungsleitung` und `entwickler` statt `admin`                              |
| 7    | #746      | Verwaltung liest die Rollen aus `/ich`                                                       |
| 9    | dieser PR | Doku-Sammelpass, dieses Dokument                                                             |
| 10   | #784      | Spiegel `user.role` entfernt (0162), `rollen`/`ac` in `auth.ts` weg; erst nach einem Release |

## Migrationen

| Nr.  | Inhalt                                                                                                                                                     | Rückweg (`psql -1 -f`, als Besitzer der Datenbank)                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0159 | Tabelle `abteilungsleitung_person`; kopiert jedes Konto mit `role = 'admin'` hinein (auf dem Server eines). `user.role` bleibt.                            | `rueckweg/0159_abteilungsleitung_person.sql`: setzt `role = 'admin'` für alle Mitglieder, löscht Tabelle und Journalzeile.                                            |
| 0160 | Spalte `session.zweiter_faktor_geprueft`; Sitzungen von Konten mit Faktor gelten als geprüft.                                                              | `rueckweg/0160_sitzung_zweiter_faktor.sql`: beendet vorher die ungeprüften Sitzungen von Konten mit Faktor, löscht Spalte und Journalzeile.                           |
| 0162 | Teil 10 (#784): setzt `user.role` für alle auf `user` und sperrt den Wert (CHECK `user_role_nur_user`: leer oder `user`). Die Spalte bleibt (better-auth). | `rueckweg/0162_user_role_spiegel_entfernt.sql`: löscht den CHECK, setzt `role = 'admin'` für alle Mitglieder von `abteilungsleitung_person`, löscht die Journalzeile. |

Reihenfolge: erst 0159, dann 0160, dann 0162 (Journal `when` 1793557900000, 1793558000000, 1793558200000; die Nummer 0161 gehört einem parallelen Fix). Zurückrollen umgekehrt: erst 0162, dann 0160, dann 0159, und den Code auf den vorigen Release zurückstellen. `deploy.sh` migriert vor dem Start der neuen API und nur vorwärts.

## Android (und später iOS)

Das Android-Repo ist nicht geändert. Die Schritte aus den PRs #726, #734 und #745:

1. `api-vertrag/openapi.yaml` aus dem Stand des Epics kopieren.
2. `chat/Profile.kt`: `admin` ersetzen durch `abteilungsleitung` und `entwickler` (je `Boolean = false`). Fehlt das Feld, fällt es still auf `false`: Die Abteilungsleitung sähe sonst keine Anmeldungen aller Programme.
3. `programs/Registrations.kt` (`maySee`): `abteilungsleitung || entwickler`. `termine/ProfileSections.kt` (`groupLabels`): Beschriftung aus `abteilungsleitung`.
4. `twoFactorRedirect` entfällt (`auth/Auth.kt`, `AuthViewModel.kt`, `net/ApiError.kt`, Text `login_admin_only`): Die Anmeldung der App gibt immer eine Sitzung. Weiter `Origin: cevi-os://` senden.
5. Neuer Code `ZWEITER_FAKTOR_SITZUNG` neben `ZWEITER_FAKTOR_FEHLT`; `LETZTER_ADMIN` heisst `LETZTE_ABTEILUNGSLEITUNG` (die App ruft die Route nicht auf).
6. Tests nachführen: `AuthApiTest.kt`, `ChatApiTest.kt`, `ProgramsApiTest.kt`, `RegistrationsTest.kt`, `TermineLogicTest.kt`.

## Nach dem Merge

1. Teil 7 (Verwaltung) und Teil 8 (API-Vertrag) gehören in dasselbe Release: Eine alte Verwaltung liest `admin` und `role`, eine neue API liefert sie nicht mehr.
2. Release ausrollen. Die Migrationen 0159 und 0160 laufen beim Deploy von selbst, in dieser Reihenfolge, vor dem Start der API.
3. Prüfen: Das Konto der Abteilungsleitung ist in `abteilungsleitung_person`; jeder Entwickler hat den zweiten Faktor eingerichtet (sonst sperrt ihn die Verwaltung aus); die Abteilung hat mindestens eine aktive Abteilungsleitung oder einen aktiven Entwickler.
4. Android-App anpassen und ausliefern (Abschnitt oben). Bis dahin zeigt die App für die Abteilungsleitung nicht alle Anmeldungen, und Konten mit zweitem Faktor melden sich erst mit dem neuen Stand an.
5. **Erst danach** Teil 10 (#784, erledigt): Der Code schreibt und liest `user.role` nicht mehr, die Migration 0162 setzt `role = 'admin'` auf `user` und sperrt den Wert (CHECK), mit Rückweg. Nie im selben Release wie Teil 1 bis 9: Ohne den Spiegel liest ein Rückgriff auf das vorige Release keine Abteilungsleitung mehr. Die Spalte bleibt, weil das admin-Plugin von better-auth sie in seinem Schema verlangt (ohne sie: «Drizzle schema mismatch user.role»); das Plugin bleibt für die Sperre bei der Anmeldung und `createUser`. Seine Rollen und Rechte (`ac`, `rollen`) sind entfernt: Die Aktionen am Konto (Passwort setzen, Sitzungen beenden, sperren, entsperren, entfernen) laufen über `src/konto-verwaltung.ts`, das Recht prüft die Route. `get-session` liefert kein `role` mehr (`returned: false` am Schema des Plugins).
6. **Apps:** Android und iOS dürfen `role` aus `get-session` nicht mehr lesen und keinen Wert `admin` erwarten; die Rollen kommen aus `GET /api/v1/ich` (`abteilungsleitung`, `entwickler`). Fehlt `role`, ändert sich für Apps nach Abschnitt «Android» nichts.

Related: [Rechte: Wer darf was?](rechte.md), [Betrieb](betrieb.md), [Umstellung auf darf()](rechte-umstellung.md), [Bedrohungsmodell](sicherheit/bedrohungsmodell.md)
