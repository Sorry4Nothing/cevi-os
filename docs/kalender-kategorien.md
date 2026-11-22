# Termine und Outlook-Kategorien

Wer einen Termin sieht, hängt seit #449 nur noch an seinen **Tags**. Die Tags eines Termins kommen aus den **Kategorien**, die du im Outlook-Kalender setzt. Die Regel nach dem Titel («Stufen», Stufenname im Titel) und die Zuordnung von Hand im Bereich «Kalender» gibt es nicht mehr.

Diese Anleitung sagt dir, welche Kategorien du in Outlook anlegen musst und wie du die Umstellung durchführst. Namen von Stufen, Teams und Funktionen stehen nicht in diesem Repo: Du findest sie im Admin-Bereich «Tags». Unten stehen deshalb Platzhalter wie `<Stufenname>`.

## So funktioniert es

- Alle 5 Minuten liest der Server den Outlook-Kalender: Termine von gestern bis 400 Tage voraus. Er übernimmt nur Termine an einem Samstag (Samstagsfilter) und keine privaten oder vertraulichen.
- Jede Kategorie eines Termins wird einem Tag zugeordnet:
  1. Zuerst gilt eine **Abweichung** aus dem Reiter «Kategorien» (Admin → Termine → Kategorien).
  2. Gibt es keine, gilt der **Tag mit demselben Namen**. Der Vergleich ignoriert Gross- und Kleinschreibung und Leerzeichen am Rand: Die Kategorie ` biber` trifft den Tag `Biber`.
- Eine Kategorie ohne passenden Tag ergibt keinen Tag. Sie erscheint in der Warnliste unter «Kategorien ohne Tag».
- Die Tags eines Termins werden bei **jedem Lauf neu berechnet**. Änderst du in Outlook die Kategorien, gilt das nach höchstens 5 Minuten. Das gilt auch für Tags, die vorher von Hand oder durch die Migration gesetzt waren: Bei Terminen aus dem Kalender zählen allein die Kategorien.

### Wer sieht einen Termin

- Eine Person sieht einen Termin, wenn sie **einen** der Tags des Termins trägt (ODER, nicht UND). Das gilt für Tags jedes Typs.
- Eltern tragen keine Tags. Sie sehen Termine der Stufen-Tags ihrer aktiven Kinder.
- Ein Termin **ohne Tag** sieht niemand, auch nicht die Abteilungsleitung. Er steht in der Warnliste (Admin → Termine → Warnliste), bis er eine passende Kategorie hat.
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
| Stufe      | `<Stufenname>`, ein Tag je Stufe (Admin → Stufen und → Tags)       | `<Stufenname>`                                            |
| Funktion   | `<Funktionsname>` (zum Beispiel für ein Leitungsteam)              | `<Funktionsname>`                                         |
| Team       | `<Teamname>`                                                       | `<Teamname>`                                              |
| Lager      | `<Lagername>`                                                      | `<Lagername>`                                             |
| Abweichung | beliebiger Tag, im Reiter «Kategorien» mit der Kategorie verbunden | `<Name in Outlook>`, wenn er vom Tag-Namen abweichen soll |

- Die **Stufen-Tags** entstanden mit der Umstellung der Stufen auf Tags (#331, #332): Jede Stufe ist ein Tag vom Typ «Stufe». Ihr Name ist der Name der Stufe.
- **Funktions- und Team-Tags** legst du unter Admin → Tags selbst an. Wer den Tag trägt, sieht die Termine mit dieser Kategorie. Eltern sehen sie nie. So bleiben Termine nur für Leitende sichtbar.
- **Sondertags** mit eingebauter Wirkung gibt es nicht. Insbesondere gibt es keinen Tag `intern`: Die frühere Sichtbarkeit «Für niemanden» liess sich nur im alten Bereich «Kalender» setzen. Bestehende interne Termine bleiben ausgeblendet. Für einen neuen internen Termin nimm eine Funktions- oder Team-Kategorie (siehe oben).
- Tag-Namen sind in der Abteilung eindeutig, unabhängig vom Typ und ohne Gross- und Kleinschreibung. Vermeide Kommas im Tag-Namen: Ein Komma trennt in Outlook zwei Kategorien.

## Umstellung Schritt für Schritt

Die Kategorien liest der Server schon seit #432. Du kannst die Schritte 1 bis 3 deshalb **vor** dem Einspielen dieser Version erledigen.

1. **Tags prüfen oder anlegen.** Öffne Admin → Tags. Jede Stufe hat einen Tag vom Typ «Stufe». Lege fehlende Funktions-, Team- und Lager-Tags an und notiere die genauen Namen.
2. **Kategorien in Outlook anlegen.** Lege für jeden Tag, der Termine bekommen soll, eine Kategorie mit **demselben Namen** an. Willst du einen anderen Namen, lege die Kategorie so an, wie du sie willst, und verbinde sie in Schritt 4 im Reiter «Kategorien» mit dem Tag.
3. **Bestehende Termine umkategorisieren.** Setze bei jedem kommenden Samstagstermin die Kategorien, die früher aus dem Titel oder von Hand kamen. Ein Termin für mehrere Stufen bekommt mehrere Kategorien. Der nächste Lauf (höchstens 5 Minuten) übernimmt sie.
4. **Warnliste leeren.** Öffne Admin → Termine → Warnliste.
   - «Termine ohne Tag» zeigt kommende Termine, die niemand sieht. Setze in Outlook eine Kategorie.
   - «Kategorien ohne Tag» zeigt Kategorien, die keinem Tag entsprechen. Lege den Tag an oder verbinde die Kategorie im Reiter «Kategorien» mit einem Tag.
   - Warte nach jeder Änderung bis zum nächsten Lauf und lade die Seite neu. Die Warnliste ist leer, wenn alle kommenden Termine einen Tag haben.
5. **Gegenprobe.** Lege in Outlook einen Test-Termin an einem Samstag mit der Kategorie einer Stufe an. Nach 5 Minuten muss er in der App der Leitenden dieser Stufe erscheinen und nicht bei anderen Stufen. Erscheint er in der Warnliste, liefert der Kalender die Kategorien nicht oder der Name passt nicht.

### Was beim Einspielen passiert

- Die Migration 0126 schreibt die bisherige Zuordnung der Termine zu Stufen in die Tags. Ein Termin ohne eigene Zuordnung (galt für alle Stufen) bekommt alle Stufen-Tags der Abteilung.
- Termine aus dem Kalender behalten diese Tags **nur bis zum nächsten Lauf**. Dann rechnet der Server sie aus den Kategorien neu. Ein kommender Termin ohne Kategorie ist danach für niemanden sichtbar und steht in der Warnliste. Erledige darum die Schritte 1 bis 3 vor dem Einspielen.
- Der Abgleich rechnet nur Termine von gestern bis 400 Tage voraus neu. Ältere Termine behalten die Tags aus der Migration, damit Auswertungen wie die Anwesenheit sie weiter sehen.

### Alte App-Versionen

Die Android-App ruft noch `GET /api/v1/programme` auf. Die Route liefert weiter Termine, aber nur noch nach den Stufen-Tags. Das Zuordnen in der App (`PUT /api/v1/programme/{id}/zuordnung`) gibt es nicht mehr. Die Apps sollen auf `GET /api/v1/termine/mein` und `GET /api/v1/termine/{id}` umstellen. Die Ja/Nein-Antwort der Teilnahme bleibt.
