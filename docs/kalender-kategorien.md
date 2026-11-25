# Termine und Outlook-Kategorien

Wer einen Termin sieht, hängt seit #449 nur noch an seinen **Tags**. Die Tags eines Termins kommen aus den **Kategorien**, die du im Outlook-Kalender setzt. Die Regel nach dem Titel («Stufen», Stufenname im Titel) und die Zuordnung von Hand im Bereich «Kalender» gibt es nicht mehr.

Diese Anleitung sagt dir, welche Kategorien du in Outlook anlegen kannst und wie du die Umstellung durchführst. **Die Umstellung ist freiwillig und du bestimmst den Zeitpunkt.** Bis du Kategorien setzt, bleibt alles, wie es war. Namen von Stufen, Teams und Funktionen stehen nicht in diesem Repo: Du findest sie im Bereich der Verwaltung «Tags». Unten stehen deshalb Platzhalter wie `<Stufenname>`.

## So funktioniert es

- Alle 5 Minuten liest der Server den Outlook-Kalender: Termine von gestern bis 400 Tage voraus. Er übernimmt nur Termine an einem Samstag (Samstagsfilter) und keine privaten oder vertraulichen.
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
3. **Bestehende Termine umkategorisieren.** Setze bei jedem kommenden Samstagstermin die Kategorien, die früher aus dem Titel oder von Hand kamen. Ein Termin für mehrere Stufen bekommt mehrere Kategorien. Der nächste Lauf (höchstens 5 Minuten) übernimmt sie.
4. **Warnliste leeren.** Öffne Verwaltung → Termine → Warnliste.
   - «Termine ohne Tag» zeigt kommende Termine ohne Tag. Sie sind keiner Gruppe zugewiesen. Setze in Outlook eine Kategorie.
   - «Kategorien ohne Tag» zeigt Kategorien, die keinem Tag entsprechen. Lege den Tag an oder verbinde die Kategorie im Reiter «Kategorien» mit einem Tag.
   - Warte nach jeder Änderung bis zum nächsten Lauf und lade die Seite neu. Die Warnliste ist leer, wenn alle kommenden Termine einen Tag haben.
5. **Gegenprobe.** Lege in Outlook einen Test-Termin an einem Samstag mit der Kategorie einer Stufe an. Nach 5 Minuten muss er bei den Leitenden und Eltern dieser Stufe erscheinen und nicht bei anderen Stufen. Erscheint er in der Warnliste, liefert der Kalender die Kategorien nicht oder der Name passt nicht.

### Was beim Einspielen passiert

- Die Migration 0126 schreibt die bisherigen Zuordnungen der Termine zu Stufen in die Tags. Ein Termin ohne bisherige Zuordnung (galt für alle Stufen) bleibt ohne Tag.
- **Übergangsregel:** Termine, die vor dem Einspielen eine Stufe hatten (auch eine aus dem Titel), behalten sie, bis du Kategorien setzt. Neue Termine ohne Kategorie sind keiner Gruppe zugewiesen: Es gibt keine Titelregel mehr. Sie erscheinen im Alle-Kalender und in der Warnliste, bis sie eine Kategorie bekommen.
- Der Abgleich rechnet nur Termine von gestern bis 400 Tage voraus. Ältere Termine behalten ihre Tags, damit Auswertungen wie die Anwesenheit sie weiter sehen.

### Alte App-Versionen

Die Android-App ruft noch `GET /api/v1/programme` auf. Die Route liefert weiter Termine, aber nur noch nach den Stufen-Tags: Ein Termin ohne Tag liefert sie Leitenden und Eltern nicht mehr (die Abteilungsleitung und Stufenleitungen sehen ihn weiter). Das Zuordnen in der App (`PUT /api/v1/programme/{id}/zuordnung`) gibt es nicht mehr. Die Apps sollen auf `GET /api/v1/termine/mein` und `GET /api/v1/termine/{id}` umstellen. Die Ja/Nein-Antwort der Teilnahme bleibt.
