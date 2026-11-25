# Termine und Outlook-Kategorien

Wer einen Termin sieht, hängt seit #449 nur noch an seinen **Tags**. Die Tags eines Termins kommen aus den **Kategorien**, die du im Outlook-Kalender setzt. Seit #835 kann Cevi OS die Kategorien auch **selbst nach Outlook schreiben** und die Kategorien der Termine von Microsoft Graph lesen (siehe «Quelle der Kategorien»). Die Regel nach dem Titel («Stufen», Stufenname im Titel) und die Zuordnung von Hand im Bereich «Kalender» gibt es nicht mehr.

Diese Anleitung sagt dir, welche Kategorien du in Outlook anlegen kannst und wie du die Umstellung durchführst. **Die Umstellung ist freiwillig und du bestimmst den Zeitpunkt.** Bis du Kategorien setzt, bleibt alles, wie es war. Namen von Stufen, Teams und Funktionen stehen nicht in diesem Repo: Du findest sie im Bereich der Verwaltung «Tags». Unten stehen deshalb Platzhalter wie `<Stufenname>`.

## Quelle der Kategorien

Ohne Anbindung an Microsoft Graph (Standard, `OUTLOOK_GRAPH` aus) liest der Server die Kategorien aus dem Feld `CATEGORIES` der iCal-Adresse. Auf dem Server der Abteilung enthielt der Feed bei einer Messung am 25.11.2026 in 66 Terminen keine einzige solche Zeile, obwohl in Outlook Kategorien gesetzt waren: Der Feed ist als Quelle der Kategorien unzuverlässig. Mit der Anbindung (`OUTLOOK_GRAPH=true`, Einrichtung in [betrieb.md](betrieb.md)) kommen die Kategorien von Graph; der Feed liefert weiter Titel, Zeit und Ort.

- **Zuordnung:** Ein einzelner Termin über seine UID, ein Termin einer Serie über die UID der Serie und seinen Beginn. Ein Termin, den Graph nicht kennt, behält seine bisherigen Kategorien.
- **Ausfall:** Fällt Graph beim Lesen aus, behalten alle Termine ihre bisherigen Kategorien und Tags, nie leer; der Fehler steht im Log.
- **Schreiben aus Cevi OS:** Die Tags eines Termins ändert die Abteilungsleitung in der Verwaltung (Kalender: «Tags ändern»; Warnliste: «Tags ändern» und die Sammelaktion «Tags setzen»). Cevi OS speichert die Tags zuerst und schreibt dann nur die Kategorien dieses einen Termins nach Outlook. Fremde Kategorien an dem Termin bleiben. Auch die Kategorienliste des Postfachs führt Cevi OS nach, wenn du in Verwaltung → Tags einen Tag anlegst, umbenennst oder löschst (Tag-Namen ohne Komma). Die Quelle der Wahrheit bleibt Outlook: Setzt jemand in Outlook andere Kategorien, gewinnen sie beim nächsten Lesen.
- **Schalter aus:** Die Tags eines bestehenden Termins lassen sich trotzdem in Cevi OS ändern, aber nur dort. Die Verwaltung sagt «Nur in Cevi OS gespeichert, nicht in Outlook.» Bekommt der Termin später in Outlook eine Kategorie, die einem Tag entspricht, ersetzt sie die lokal gesetzten Tags (Outlook gewinnt). Ein Termin ohne passende Kategorie behält die lokalen Tags.
- **Schutz vor dem Zurückschreiben:** Solange Outlook eine Änderung aus Cevi OS noch nicht zeigt (der Feed und Graph hinken), rechnet der Abgleich die Tags dieses Termins nicht zurück; spätestens nach 24 Stunden gewinnt Outlook.

## So funktioniert es

- Alle 5 Minuten liest der Server den Outlook-Kalender: Termine von gestern bis 400 Tage voraus, **an jedem Wochentag** (den Samstagsfilter gibt es seit #835 nicht mehr), ohne private oder vertrauliche. Wer einen Termin sieht, entscheiden wie immer seine Tags.
- Jede Kategorie eines Termins wird einem Tag zugeordnet:
  1. Zuerst gilt eine **Abweichung** aus dem Reiter «Kategorien» (Verwaltung → Termine → Kategorien).
  2. Gibt es keine, gilt der **Tag mit demselben Namen**. Der Vergleich ignoriert Gross- und Kleinschreibung und Leerzeichen am Rand: Die Kategorie ` biber` trifft den Tag `Biber`.
- Eine Kategorie ohne passenden Tag ergibt keinen Tag. Sie erscheint in der Warnliste unter «Kategorien ohne Tag».
- Hat ein Termin **mindestens eine Kategorie, die einem Tag entspricht**, werden seine Tags bei jedem Lauf aus den Kategorien neu berechnet. Änderst du in Outlook die Kategorien, gilt das nach höchstens 5 Minuten. Die Kategorien gewinnen dann gegen Tags, die vorher durch die Migration gesetzt waren.
- Hat ein Termin **keine Kategorie oder keine, die einem Tag entspricht**, bleiben seine Tags unberührt. Das gilt auch für Tags aus der Migration 0126, die die frühere Stufen-Zuordnung übernommen hat. Entfernst du alle Kategorien eines Termins, bleiben darum seine bisherigen Tags stehen.

### Wer sieht einen Termin

- Eine Person sieht einen Termin, wenn sie **einen** der Tags des Termins trägt (ODER, nicht UND). Das gilt für Tags jedes Typs.
- Eltern tragen keine Tags. Sie sehen Termine der Stufen-Tags ihrer aktiven Kinder.
- **Ohne Tag:** Der Termin ist keiner Gruppe zugewiesen. Er steht im Alle-Kalender (`GET /api/v1/termine/alle`, nur für die Abteilungsleitung), nicht in «Mein Kalender» und nicht im Kalender-Link. Leitende und Eltern sehen ihn nicht. Er steht in der Warnliste (Verwaltung → Termine → Warnliste), bis er eine passende Kategorie hat.
- **Mit Tag:** Der Termin erscheint bei allen, die den Tag tragen (Eltern über die Stufe ihrer Kinder).
- Ein Termin mit mehreren Kategorien, zum Beispiel `<Stufenname A>` und `<Stufenname B>`, gehört zu beiden Stufen.
- Es gibt **keine Sammelkategorie «alle Stufen»**. Gilt ein Termin für alle Stufen, setze alle Stufen-Kategorien. Die Zuordnung im Reiter «Kategorien» verbindet eine Kategorie mit genau einem Tag.

### Mehrere Kategorien je Termin

Das geht. Der Server liest alle Kategorien eines Termins (mehrere Zeilen oder durch Komma getrennt), ohne Doppelte, höchstens 20 je Termin. Namen über 100 Zeichen werden verworfen. Jede Kategorie, die einem Tag entspricht, ergibt einen Tag des Termins.

### Serien und einzelne Termine

- Bei einem Serientermin zählt die Kategorie des einzelnen Termins. Änderst du **einen** Termin der Serie in Outlook, hat er seine eigenen Kategorien: Setzt du dort keine, hat dieser Termin **keine** (er erbt sie nicht von der Serie).
- Ändere deshalb die Kategorie wenn möglich für die ganze Serie. Prüfe danach die Warnliste.

## Welche Tags und Kategorien gibt es

| Tag-Typ    | Tag-Name (aus der Datenbank der Abteilung)                         | Outlook-Kategorie                                         |
| ---------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Stufe      | `<Stufenname>`, ein Tag je Stufe (Verwaltung → Stufen und → Tags)  | `<Stufenname>`                                            |
| Funktion   | `<Funktionsname>` (zum Beispiel für ein Leitungsteam)              | `<Funktionsname>`                                         |
| Team       | `<Teamname>`                                                       | `<Teamname>`                                              |
| Lager      | `<Lagername>`                                                      | `<Lagername>`                                             |
| Abweichung | beliebiger Tag, im Reiter «Kategorien» mit der Kategorie verbunden | `<Name in Outlook>`, wenn er vom Tag-Namen abweichen soll |

- Die **Stufen-Tags** entstanden mit der Umstellung der Stufen auf Tags (#331, #332): Jede Stufe ist ein Tag vom Typ «Stufe». Ihr Name ist der Name der Stufe.
- **Funktions- und Team-Tags** legst du unter Verwaltung → Tags selbst an. Wer den Tag trägt, sieht die Termine mit dieser Kategorie. Eltern sehen sie nie. So bleiben Termine nur für Leitende sichtbar.
- **Sondertags** mit eingebauter Wirkung gibt es nicht. Insbesondere gibt es keinen Tag `intern`: Die frühere Sichtbarkeit je Termin (`intern`, `leitende`, `eltern`) ist mit #807 entfallen, und mit ihr die Ausblendung. Wer einen Termin sieht, bestimmen allein seine Tags (und bei einem Anlass dessen Sichtbarkeit). Für einen Termin nur für Leitende nimm eine Funktions- oder Team-Kategorie (siehe oben); trägt er einen Stufen-Tag, sehen ihn auch die Eltern der Stufe.
- Tag-Namen sind in der Abteilung eindeutig, unabhängig vom Typ und ohne Gross- und Kleinschreibung. Vermeide Kommas im Tag-Namen: Ein Komma trennt in Outlook zwei Kategorien.

## Umstellung Schritt für Schritt

Die Kategorien liest der Server schon seit #432. Du kannst die Schritte zu jedem beliebigen Zeitpunkt erledigen, vor oder nach dem Einspielen dieser Version, auch nur für einzelne Stufen. Ein Termin, den du noch nicht umgestellt hast, behält seine bisherigen Tags.

1. **Tags prüfen oder anlegen.** Öffne Verwaltung → Tags. Jede Stufe hat einen Tag vom Typ «Stufe». Lege fehlende Funktions-, Team- und Lager-Tags an und notiere die genauen Namen.
2. **Kategorien in Outlook anlegen.** Lege für jeden Tag, der Termine bekommen soll, eine Kategorie mit **demselben Namen** an. Willst du einen anderen Namen, lege die Kategorie so an, wie du sie willst, und verbinde sie in Schritt 4 im Reiter «Kategorien» mit dem Tag.
3. **Bestehende Termine umkategorisieren.** Setze bei jedem kommenden Termin die Kategorien, die früher aus dem Titel oder von Hand kamen. Ein Termin für mehrere Stufen bekommt mehrere Kategorien. Der nächste Lauf (höchstens 5 Minuten) übernimmt sie.
4. **Warnliste leeren.** Öffne Verwaltung → Termine → Warnliste.
   - «Termine ohne Tag» zeigt kommende Termine ohne Tag. Sie sind keiner Gruppe zugewiesen. Setze in Outlook eine Kategorie.
   - «Kategorien ohne Tag» zeigt Kategorien, die keinem Tag entsprechen. Lege den Tag an oder verbinde die Kategorie im Reiter «Kategorien» mit einem Tag.
   - Warte nach jeder Änderung bis zum nächsten Lauf und lade die Seite neu. Die Warnliste ist leer, wenn alle kommenden Termine einen Tag haben.
5. **Gegenprobe.** Lege in Outlook einen Test-Termin mit der Kategorie einer Stufe an. Nach 5 Minuten muss er bei den Leitenden und Eltern dieser Stufe erscheinen und nicht bei anderen Stufen. Erscheint er in der Warnliste, liefert der Kalender die Kategorien nicht oder der Name passt nicht.

### Was beim Einspielen passiert

- Die Migration 0126 schreibt die bisherigen Zuordnungen der Termine zu Stufen in die Tags. Ein Termin ohne bisherige Zuordnung (galt für alle Stufen) bleibt ohne Tag.
- **Mehr Termine (#835):** Ohne Samstagsfilter liest der Abgleich alle Termine des Feeds. Auf dem Server der Abteilung steigt die Zahl von 11 auf rund 66. Termine ohne Tag sehen nur Abteilungsleitung und Entwickler; die Warnliste «Ohne Kategorie» wird lang. Setze die Tags mit der Sammelaktion in der Warnliste. Die öffentliche Website zeigt einen Termin ohne Anlass nur, wenn er mindestens einen Stufen-Tag trägt und keinen anderen Tag (siehe [website-auslieferung.md](website-auslieferung.md)); ein Termin ohne Tag steht nie dort.
- **Übergangsregel:** Termine, die vor dem Einspielen eine Stufe hatten (auch eine aus dem Titel), behalten sie, bis du Kategorien setzt. Neue Termine ohne Kategorie sind keiner Gruppe zugewiesen: Es gibt keine Titelregel mehr. Sie erscheinen im Alle-Kalender und in der Warnliste, bis sie eine Kategorie bekommen.
- Der Abgleich rechnet nur Termine von gestern bis 400 Tage voraus. Ältere Termine behalten ihre Tags, damit Auswertungen wie die Anwesenheit sie weiter sehen.

### Alte App-Versionen

Die Android-App ruft noch `GET /api/v1/programme` auf. Die Route liefert weiter Termine, aber nur noch nach den Stufen-Tags: Ein Termin ohne Tag liefert sie Leitenden und Eltern nicht mehr (die Abteilungsleitung und Stufenleitungen sehen ihn weiter). Das Zuordnen in der App (`PUT /api/v1/programme/{id}/zuordnung`) gibt es nicht mehr. Die Apps sollen auf `GET /api/v1/termine/mein` und `GET /api/v1/termine/{id}` umstellen. Die Ja/Nein-Antwort der Teilnahme bleibt.
