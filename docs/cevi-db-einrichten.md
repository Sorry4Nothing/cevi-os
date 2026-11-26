# Cevi-Datenbank einrichten

Die Anmeldung zu einem Anlass oder Lager kann freiwillige Angaben aus der Cevi-Datenbank vorausfüllen (Geburtsdatum, Telefon, Adresse, E-Mail). Die Mitglieder haben diese Angaben dort selbst gemacht; Cevi OS holt sie nur, wenn der Anlass sie fragt, und nur lesend. Die Person ändert jeden Wert vor dem Absenden. Fehlt etwas oder antwortet die Cevi-Datenbank nicht, bleibt das Feld eine normale Frage.

**Was Cevi OS nie tut:** in die Cevi-Datenbank schreiben, Gesundheitsangaben, Rollen oder Zusatzfelder holen, Personen ausserhalb der eigenen Ebene sehen, Angaben vor dem Absenden speichern.

## Was du brauchst

- Ein Konto in der Cevi-Datenbank mit der Rolle Hauptleitung der Abteilung (nur sie darf Dienstkonto-Tokens anlegen).
- Zugang zu `deploy/.env` auf dem Server.

## Token erstellen

1. In der Cevi-Datenbank bei der Gruppe der Abteilung «API-Schlüssel» (Dienstkonten) öffnen und einen neuen Schlüssel anlegen.
2. Als Recht nur **Personen dieser Ebene** wählen und sonst nichts. Nicht «Personen dieser und der darunterliegenden Ebenen», nicht Gruppen, Anlässe, Rechnungen oder Teilnehmende.
3. Das Token einmal kopieren. Es steht danach nie wieder an einem anderen Ort als `deploy/.env`: nicht im Repo, nicht in einem Chat oder Ticket, nicht in einem Screenshot.

## Auf dem Server eintragen

In `deploy/.env` beide Zeilen setzen (oder beide leer lassen, dann ist die Funktion aus):

```
CEVI_DB_URL=https://<adresse-der-cevi-datenbank>
CEVI_DB_TOKEN=<token>
```

Die Adresse ist nur die Herkunft (ohne Pfad). Danach die API neu starten (`docker compose up -d api`). Mit nur einer der beiden Zeilen startet die API nicht und nennt den Namen der fehlenden Variable.

## Prüfen

1. Verwaltung > System > **Cevi-Datenbank** öffnen (Recht «Cevi-Datenbank einrichten», standardmässig die Abteilungsleitung).
2. Die Nummer der Gruppe der Abteilung eintragen (die Zahl in der Adresse der Gruppe in der Cevi-Datenbank) und speichern.
3. «Verbindung prüfen» wählen. Mögliche Ergebnisse: Die Verbindung steht (mit oder ohne sichtbare Gruppe), das Token wird abgelehnt, die Cevi-Datenbank antwortet nicht, die Antwort hat ein unerwartetes Format, die Verbindung ist nicht eingerichtet.
4. Beim Anlass unter «Zusatzfelder» bei einem Textfeld «Aus der Cevi-Datenbank füllen» wählen und die Anmeldung als Elternteil öffnen. Die Seite zeigt die übernommenen Angaben mit «Aus der Cevi-Datenbank übernommen».

## Token rotieren

Neues Token wie oben erstellen, in `deploy/.env` ersetzen, API neu starten, Verbindung prüfen, danach das alte Token in der Cevi-Datenbank löschen. Bei Verdacht auf Diebstahl zuerst das alte Token löschen.

## Wie die Zuordnung funktioniert

Cevi OS lädt die Personen der eigenen Ebene (höchstens 15 Minuten im Arbeitsspeicher, nie in der Datenbank) und ordnet nur bei **genau einem** Treffer zu: über die gemerkte Nummer, sonst über E-Mail (beim Kind die der Eltern) plus Vornamen, sonst über Vorname, Nachname und Geburtsdatum. Bei der Anmeldung genügt ein Name allein nie. Bei keinem oder mehreren Treffern gibt es keinen Vorschlag. Nach dem Absenden einer Anmeldung mit einem Feld aus der Cevi-Datenbank merkt sich Cevi OS die Nummer des Eintrags, damit die nächste Zuordnung eindeutig ist.

## Täglicher Abgleich der Konten

Eine Minute nach dem Start der API und danach alle 24 Stunden ordnet der Server die Konten jeder Abteilung, deren Gruppe unter Verwaltung > System > Cevi-Datenbank eingetragen ist, der Cevi-Datenbank zu (#857). Er merkt die Nummer bei Konten, die noch keine haben, nie beim Konto eines Kindes, und überschreibt nie eine gemerkte Nummer. Er nutzt dieselben Regeln wie die Anmeldung und zusätzlich **Vorname plus Nachname**, aber nur, wenn es in der Cevi-Datenbank genau eine Person und in der Abteilung genau ein Konto mit diesem Namen gibt (Entscheid des Auftraggebers, Abweichung von #691). Ein solcher Treffer übernimmt nur das Geschlecht und merkt **keine** Nummer: Mit der gemerkten Nummer füllt die Anmeldung Adresse, Telefon und Geburtsdatum vor, und die dürfen nie von einer gleichnamigen anderen Person kommen. Der Abgleich prüft diese Regel darum jeden Tag neu. Eine Person der Cevi-Datenbank gehört zu höchstens einem Konto. Danach übernimmt er das Geschlecht (siehe unten). Ins Log kommt je Abteilung eine Zeile `cevi_db_abgleich` mit Zahlen (`zugeordnet`, `perName`, `geaendert`, `mehrdeutig`, `keinTreffer`), nie Namen, E-Mails oder Nummern.

## Geschlecht

Ist die Nummer eines Kontos gemerkt, übernimmt Cevi OS das Geschlecht aus der Cevi-Datenbank (`m` oder `w`, sonst keine Angabe) in das Konto, damit die Verwaltung den Rollennamen richtig bildet (#843). Das geschieht nach jedem Abruf der Personen, gleich nach dem Merken der Nummer und im täglichen Abgleich. Nie bei Kindern oder dem Konto eines Kindes, und nie, wenn jemand die Angabe im Blatt der Person gewählt hat: Die Wahl in der Verwaltung hat immer Vorrang. Seit #857 ist das Geschlecht beim Erfassen und Bearbeiten einer Person Pflicht; Konten ohne Angabe (zum Beispiel aus dem Import ohne Treffer) zeigen im Blatt der Person «Geschlecht fehlt». Das Token braucht dafür das Recht, die Details der Personen zu sehen; sonst liefert die Cevi-Datenbank kein Geschlecht.

## Offen bis zur ersten Prüfung mit dem echten Token

Die Pfade und Feldnamen stammen aus der Dokumentation von hitobito (JSON:API), nicht aus der Instanz der Cevi. Sie stehen als `ANNAHMEN` in `apps/api/src/cevi-db/client.ts`: Pfad der Personen (`/api/people`), Pfad einer Gruppe, Kopf `X-TOKEN`, Seitengrösse, `include` für Telefonnummern. Stimmt etwas nicht (zum Beispiel «die Antwort hat ein unerwartetes Format» oder keine Telefonnummer), wird nur diese Stelle angepasst. Ob ein Token auf «nur lesen» festgelegt werden kann, sagt die Dokumentation nicht; Cevi OS schreibt in jedem Fall nie.

Siehe auch: [Betrieb](betrieb.md) (Ausgehende Verbindungen), [Bedrohungsmodell](sicherheit/bedrohungsmodell.md) (Abschnitt 65).
