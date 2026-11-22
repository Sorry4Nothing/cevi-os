# Checkliste Barrierefreiheit

Mit dieser Checkliste wird jeder Bildschirm der App von Hand geprüft, auf einem iPhone und einem Android-Gerät. Massstab ist WCAG 2.2 AA, sinngemäss für Apps.

## Wann prüfen

- Neuer Bildschirm: mindestens die Punkte aus Abschnitt 1 mit VoiceOver und TalkBack, dazu alle anderen Punkte, die er berührt.
- Geänderter Bildschirm: die Punkte, die die Änderung berührt.
- Vor dem Pilot und vor Version 1.0: alle Punkte auf jedem Bildschirm.
- Öffentliche Seiten der Website und Editor der Verwaltung (Web statt App): Abschnitt 11, im Browser geprüft.
- Bereich «Termine» der Verwaltung (Web statt App): Abschnitt 12, im Browser geprüft.
- Ein Punkt ohne Angabe des Systems gilt für iOS und Android. Punkte, die auf einen Bildschirm nicht zutreffen, entfallen.
- Die Nummern bleiben fest, damit ältere PRs stimmen: Neue Punkte kommen ans Ende ihres Abschnitts.

## Vorbereitung

- Geprüft wird auf echten Geräten. Ausser dem Kontrastprüfer am PC laufen alle Werkzeuge auf den Geräten selbst, einen Mac braucht es nicht.
- iPhone: VoiceOver, Schaltersteuerung, Sprachsteuerung, «Grösserer Text» und «Bewegung reduzieren» liegen unter «Einstellungen > Bedienungshilfen».
- Grösste Schrift auf dem iPhone: bei «Grösserer Text» die grösseren Schriftgrössen einschalten und den Regler ganz nach rechts schieben.
- Android: TalkBack liegt in den Einstellungen bei den Bedienungshilfen; der Weg dorthin hängt vom Hersteller ab. Switch Access («Schalterzugriff»), Voice Access und Accessibility Scanner gibt es in Google Play; nach der Installation stehen sie bei den Bedienungshilfen.
- Das Android-Gerät hat Android 14 oder neuer, weil die Schrift erst dort bis 200 % geht.
- Schaltersteuerung ohne externen Schalter: unter «Schaltersteuerung > Schalter > Neuen Schalter hinzufügen» die Quelle «Bildschirm» wählen und ihr «Objekt auswählen» zuweisen. Dreimal schnell die Seitentaste drücken beendet die Schaltersteuerung.
- Switch Access ohne externen Schalter: TalkBack und das automatische Scannen ausschalten, dann die Lautstärketasten als Schalter zuweisen. Lautstärke leiser springt zum nächsten Element, lauter wählt es aus.

## 1. Screenreader: VoiceOver (iOS) und TalkBack (Android)

- [ ] **1.1** Mit Wischen nach rechts erreicht man alle Inhalte in sinnvoller Reihenfolge. Nichts fehlt, nichts kommt doppelt.
- [ ] **1.2** Jedes Bedienelement wird mit Name, Rolle und Zustand angesagt (`accessibilityLabel`, `accessibilityRole`, `accessibilityState`).
- [ ] **1.3** Der angesagte Name beginnt mit dem sichtbaren Text.
- [ ] **1.4** Die Ja/Nein-Auswahl sagt auf beiden Systemen an, welche Antwort gewählt ist.
- [ ] **1.5** Überschriften werden als Überschrift angesagt (`accessibilityRole="header"`).
- [ ] **1.6** Symbole mit Bedeutung haben einen Namen. Reine Zierde wird übersprungen.
- [ ] **1.7** Meldungen, die ohne Fokuswechsel erscheinen, werden angesagt, ohne eine laufende Ansage abzubrechen (Android: Statustext mit `accessibilityLiveRegion="polite"`, iOS: `AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true })`).
- [ ] **1.8** Neue Nachrichten werden nur im offenen Chat angesagt, und zwar gesammelt, z. B. «2 neue Nachrichten».

## 2. Schaltersteuerung (iOS) und Switch Access (Android)

- [ ] **2.1** Jedes Bedienelement lässt sich mit dem Schalter erreichen und auslösen.
- [ ] **2.2** Lange Listen lassen sich mit dem Schalter bis zum Ende scrollen.

## 3. Sprachsteuerung (iOS) und Voice Access (Android)

- [ ] **3.1** Jedes Bedienelement lässt sich mit dem Text auslösen, der darauf steht.
- [ ] **3.2** Mit eingeblendeten Nummern trägt jedes Bedienelement eine Nummer.

## 4. Accessibility Scanner (Android)

- [ ] **4.1** Der Scan des Bildschirms ergibt keinen Vorschlag, oder der PR begründet jeden, der bleibt.

Auf dem iPhone gibt es keinen Scanner. Den Kontrast (5.5) misst man dort an einem Bildschirmfoto mit einem Kontrastprüfer am PC. Die Grösse der Touch-Ziele (5.7) steht im Code: Grösse plus `hitSlop`, in pt auf iOS und dp auf Android; `hitSlop` zählt nur innerhalb des übergeordneten Elements. Das ist vor allem dort nötig, wo iOS anders aussieht als Android.

## 5. Darstellung

- [ ] **5.1** Bei grösster Schrift wird kein Text abgeschnitten, überdeckt oder gekürzt; Zeilen brechen um.
- [ ] **5.2** Bei grösster Schrift bleibt alles erreichbar; wo der Platz nicht reicht, scrollt der Bildschirm.
- [ ] **5.3** Im Code steht kein `allowFontScaling={false}` und kein `maxFontSizeMultiplier` unter 2 ausser 0 (0 heisst: keine Grenze).
- [ ] **5.4** Die App folgt dem Dunkelmodus des Systems. Im hellen und im dunklen Modus ist alles gut lesbar.
- [ ] **5.5** Der Kontrast beträgt mindestens 4.5:1 für Text und 3:1 für Bedienelemente, hell und dunkel.
- [ ] **5.6** Ein Zustand zeigt sich nie nur über Farbe, sondern immer mit Symbol und Text.
- [ ] **5.7** Touch-Ziele sind mindestens 44 × 44 pt (iOS) bzw. 48 × 48 dp (Android) gross.
- [ ] **5.8** Jeder Bildschirm dreht ins Querformat mit und bleibt dort ganz bedienbar (`orientation: "default"`).
- [ ] **5.9** Mit «Bewegung reduzieren» (iOS) bzw. ausgeschalteten Animationen (Android) gleitet und zoomt nichts; Wechsel blenden höchstens über.
- [ ] **5.10** Bei grösster Schrift ist jeder Text deutlich grösser als bei Standardgrösse. Ausnahme: die Tab-Leiste auf iOS, wenn langes Drücken auf einen Tab seinen Namen vergrössert anzeigt.

## 6. Fokus

Fokus heisst hier: das Element, das Screenreader oder Schalter gerade ausgewählt hat, oder das Textfeld, in das man gerade schreibt.

- [ ] **6.1** Nach einer Navigation liegt der Fokus auf der Überschrift des neuen Bildschirms.
- [ ] **6.2** Nach dem Schliessen eines Dialogs liegt der Fokus wieder auf dem Element, das ihn geöffnet hat.
- [ ] **6.3** Nach einem Fehler liegt der Fokus auf der Fehlermeldung.
- [ ] **6.4** Der Fokus liegt nie unter Tab-Leiste, Tastatur oder Eingabezeile; der Inhalt scrollt mit.
- [ ] **6.5** Öffnet sich ein Dialog, liegt der Fokus im Dialog. Screenreader und Schalter erreichen nichts dahinter, bis er geschlossen ist.

## 7. App-Sperre

- [ ] **7.1** Solange die Sperre angezeigt wird, erreichen Screenreader, Schalter und Sprachsteuerung nur die Elemente der Sperre, nichts darunter (iOS: `accessibilityViewIsModal` auf der Sperre, Android: `importantForAccessibility="no-hide-descendants"` auf dem Inhalt darunter).
- [ ] **7.2** Ein angefangener Entwurf, z. B. eine Chat-Nachricht, ist nach dem Entsperren noch da.

## 8. Gesten und Zeit

- [ ] **8.1** Jede Wisch-, Zieh- oder Mehrfingeraktion lässt sich auch mit einem Finger ohne Wischen und Ziehen auslösen, mit einem Knopf oder über ein Menü. Für Screenreader und Schalter gibt es sie zusätzlich als Aktion (`accessibilityActions` mit `onAccessibilityAction`).
- [ ] **8.2** Ausser der App-Sperre gibt es kein Zeitlimit: Keine Eingabe läuft ab, keine Meldung verschwindet von selbst.

## 9. Textfelder und Login

`autoComplete` wirkt auf beiden Systemen (einzelne Werte nur auf Android), `textContentType` nur auf iOS.

- [ ] **9.1** Benutzername: `autoComplete="username"` und `textContentType="username"`.
- [ ] **9.2** Passwort beim Anmelden: `autoComplete="current-password"` und `textContentType="password"`.
- [ ] **9.3** Neues Passwort: `autoComplete="new-password"`, `textContentType="newPassword"` und auf iOS `passwordRules="minlength: 12;"`.
- [ ] **9.4** Code des zweiten Faktors aus der Authenticator-App: auf iOS `textContentType="oneTimeCode"`, auf Android `autoComplete="2fa-app-otp"`. Auf Android nicht `one-time-code`: React Native macht daraus den Hinweis für SMS-Codes.
- [ ] **9.5** Der Passwort-Manager des Geräts füllt Benutzername und Passwort aus.
- [ ] **9.6** Einfügen geht in jedem Textfeld (kein `contextMenuHidden`).
- [ ] **9.7** Es gibt kein Feld zum Wiederholen des Passworts.
- [ ] **9.8** «Passwort anzeigen» sagt an, ob das Passwort gerade sichtbar ist.
- [ ] **9.9** Fehler stehen als Text beim betroffenen Feld und werden angesagt.
- [ ] **9.10** Jedes Textfeld hat eine sichtbare Beschriftung, die beim Tippen stehen bleibt. Ein Platzhalter allein reicht nicht.

## 10. Sprache und Texte

- [ ] **10.1** Auf iOS ist Deutsch als Sprache der App gesetzt (`CFBundleDevelopmentRegion` `de`).
- [ ] **10.2** Ist das Gerät auf Englisch gestellt, liest der Screenreader die App trotzdem mit deutscher Aussprache vor.
- [ ] **10.3** Die Texte sind in einfacher Sprache: kurze Sätze, bekannte Wörter.
- [ ] **10.4** Schweizer Schreibweise: immer ss, kein Eszett.
- [ ] **10.5** Anführungszeichen sind «».

## 11. Website und Editor

Dieser Abschnitt gilt für die öffentlichen Seiten der Website (die erzeugten Dateien, das Nachladen geschützter Bausteine und `/anmelden`) und für den Editor in der Verwaltung unter `/admin` (Bereich «Website»). Massstab ist WCAG 2.2 AA. Geprüft wird im Browser am PC und am Handy; die Abschnitte 1 bis 4 und 7 gelten dafür nicht, ihr Gegenstück sind die Punkte hier. Ein Punkt, der auf eine Seite nicht zutrifft, entfällt.

Vorbereitung: eine Seite im Editor aufbauen und veröffentlichen, dann die erzeugte Datei und den Editor prüfen. Screenreader am PC: NVDA mit Firefox, VoiceOver mit Safari; am Handy VoiceOver und TalkBack im Browser. Zoom: Browser auf 200 Prozent und eine Breite von 320 CSS-Pixeln. Erzwungene Farben, Dunkelmodus und «Bewegung reduzieren» in den Einstellungen des Systems einschalten.

### Öffentliche Seiten

- [ ] **11.1** Jede Seite hat genau ein `h1` (der Titel der Seite). Die Bausteine «Überschrift» beginnen bei Ebene 2, und eine Überschrift springt höchstens eine Ebene tiefer als die vorherige; der Renderer hebt eine zu tiefe Ebene an.
- [ ] **11.2** Das Dokument hat die Sprache `de-CH` und einen Titel mit dem Namen der Abteilung.
- [ ] **11.3** Ein Sprunglink «Zum Inhalt» ist der erste fokussierbare Punkt, wird beim Fokus sichtbar und führt zu `main` (`id="inhalt"`). Die Navigation ist ein `nav` mit Beschriftung, die aktuelle Seite trägt `aria-current="page"`, ihre Oberseiten `aria-current="true"`. Am Handy öffnet «Menü» ein `details`-Element (ohne Skript, mit Tastatur bedienbar); die Unterseiten des Bereichs stehen in einer eigenen Unterleiste mit Beschriftung.
- [ ] **11.4** Der Fokus ist überall sichtbar (Umriss von mindestens 2 Pixeln, Kontrast 3:1 zum Umfeld) und wird nie verdeckt. Die Reihenfolge folgt der Leserichtung.
- [ ] **11.5** Alles geht mit der Tastatur: Navigation, Links, Schaltflächen, Anmeldeformular. Es gibt keine Falle und keine Funktion, die nur mit der Maus geht.
- [ ] **11.6** Kontrast: Text mindestens 4.5:1, grosser Text und Bedienelemente mindestens 3:1, hell und dunkel (`prefers-color-scheme`) und mit erzwungenen Farben. Ein Zustand zeigt sich nie nur über Farbe.
- [ ] **11.7** Jedes Bild hat ein `alt`: den Alt-Text des Mediums (Pflicht beim Hochladen) oder leer, wenn das Medium «Nur Zierde» ist. Die Unterschrift steht zusätzlich in `figcaption`. Der Alt-Text nennt nie den Dateinamen und beginnt nicht mit «Bild von».
- [ ] **11.8** Links sagen, wohin sie führen (kein «hier» oder «mehr»). Eine Datei zum Herunterladen nennt Typ und Grösse in Klammern, und ein Link auf eine andere Website ist als solcher erkennbar.
- [ ] **11.9** Bei 200 Prozent Zoom und bei 320 Pixeln Breite gibt es kein Scrollen in zwei Richtungen, nichts wird abgeschnitten oder überdeckt, Texte brechen um. Mit einem Zeilenabstand von 1.5 geht kein Inhalt verloren.
- [ ] **11.10** Touch-Ziele sind mindestens 44 × 44 Pixel gross (WCAG 2.2 verlangt 24 × 24; hier gilt dasselbe Mass wie in der App).
- [ ] **11.11** Mit «Bewegung reduzieren» bewegt sich nichts. Es gibt keine automatische Bewegung, kein Karussell und kein Blinken.
- [ ] **11.12** Geschützte Bausteine laden nach: Der Platzhalter meldet «Wird geladen» (`aria-busy`, Live-Region), der Fehlerzustand und der Zustand «nicht angemeldet» sind Text mit einem Link oder einer Schaltfläche (zum Beispiel «Nochmals versuchen»), und der Fokus springt nicht ohne Grund. Ohne JavaScript bleibt die Seite lesbar: Der Platzhalter sagt «Nur angemeldet sichtbar» und führt mit «Anmelden» zur Anmeldung, die Hülle nennt den Grund. Das Skelett erscheint erst nach 200 ms, steht bei «Bewegung reduzieren» still, und nach 4 Sekunden meldet die Live-Region «Das dauert länger als sonst.».
- [ ] **11.13** `/anmelden`: Jedes Feld hat eine sichtbare Beschriftung (`label`), ein Fehler steht als Text oben und trägt den Fokus (bei fehlenden Angaben als Liste mit Links auf die Felder und je Feld ein Text, das Feld trägt `aria-invalid` und `aria-describedby`), Benutzername und Passwort tragen `autocomplete`, der Code des zweiten Faktors `one-time-code` und `inputmode="numeric"`, das Einfügen geht, und ein Passwort-Manager füllt aus.
- [ ] **11.14** Es gibt kein Zeitlimit und keine automatische Weiterleitung: Die Hülle einer geschützten Seite nennt den Link «Anmelden», statt selbst zu wechseln.

### Termine und Anlässe (#530)

Gilt für `/termine`, `/termine/vorschlagen`, `/anlass` und `/anlass/anmeldung` zusätzlich zu 11.1 bis 11.11.

- [ ] **11.40** Jeder Zustand ist Text mit Symbol, nie nur Farbe: Laden (`aria-busy`, «Lädt …» in einer Live-Region, Skeleton `aria-hidden`), leer, Fehler mit «Nochmals versuchen» (`role="alert"`), nicht angemeldet mit Link «Anmelden», kein Zugriff. «Abgesagt» und «Noch unklar» stehen als Wort im Etikett.
- [ ] **11.41** Reiter «Alle» und «Mein Kalender»: `role="tab"` mit `aria-selected`, Pfeiltasten, Pos1 und Ende wechseln; ohne Sitzung ist «Mein Kalender» `aria-disabled` und der Grund steht daneben.
- [ ] **11.42** Der Termin ist ein Link mit sprechendem Namen (Wochentag, Datum, Titel, Zeit, Ort, Gruppen). Das Monatsraster ist eine Liste von Tagen mit ausgeschriebenem Wochentag, nicht nur Zahlen; heute trägt `aria-current="date"`; am Handy zeigen Punkte die Termine und die Liste darunter nennt sie.
- [ ] **11.43** Das Filterblatt am Handy ist ein `dialog` (Fokus hinein, Esc schliesst, Fokus zurück auf «Filter»); die Auswahl sind Schalter mit `aria-pressed`, aktive Filter stehen auch als Text.
- [ ] **11.44** Formulare (Terminvorschlag, Anmeldung): jedes Feld hat ein `label`, Fehler stehen oben in einer Zusammenfassung (`role="alert"`, trägt den Fokus, Links auf die Felder) und beim Feld (`aria-invalid`, `aria-describedby`). Eine Auswahl aus einer Antwort ist eine `radiogroup` mit Pfeiltasten. Beim Senden sind die Felder `readonly`, der Knopf `aria-disabled` und `aria-busy`; der Entwurf bleibt bei Fehler und ohne Verbindung erhalten.
- [ ] **11.45** Rückfragen («Neuen Link erzeugen?», «Abmelden?») sind ein `alertdialog` mit Fokus auf «Abbrechen». Eine Meldung wie «Link kopiert» verschwindet nie von selbst, sondern mit «OK».

### Editor

- [ ] **11.15** Der Editor lässt sich vollständig mit der Tastatur bedienen: Seitenliste, Einstellungen, Bausteine hinzufügen, bearbeiten, verschieben, duplizieren und löschen, Vorschau, Veröffentlichen, Versionen, Medienbibliothek. Verschieben geht mit Knöpfen («Nach oben», «Nach unten», «Einrücken», «Ausrücken», «Position»), nie nur durch Ziehen (WCAG 2.5.7).
- [ ] **11.16** Jedes Bedienelement hat einen Namen, der mit dem sichtbaren Text beginnt, und eine Rolle. Der Zustand einer Seite, eines Bausteins und einer Version ist ein Wort, nie nur ein Symbol oder eine Farbe.
- [ ] **11.17** Dialoge (Einstellungen, Rückfrage beim Löschen, Konflikt, Veröffentlichen, Hochladen) setzen den Fokus hinein, halten ihn darin und geben ihn beim Schliessen an das Element zurück, das sie geöffnet hat; Esc schliesst, wo nichts verloren geht.
- [ ] **11.18** Nach dem Löschen eines Bausteins steht an der Stelle «Rückgängig» und der Fokus liegt dort. Hinzufügen, Verschieben, Speichern und Veröffentlichen melden das Ergebnis in der Statusmeldung (Live-Region), ohne den Fokus zu stehlen.
- [ ] **11.19** Fehler vom Server (400 mit Feldpfad, 409 Konflikt, 413, 429, offline) stehen als Text beim betroffenen Feld und in einer Meldung, die der Screenreader ansagt; der Fokus liegt danach auf der Meldung oder dem ersten fehlerhaften Feld.
- [ ] **11.20** Der Rich Text ist ein Textfeld mit einer kleinen Schreibweise (`**fett**`, `*kursiv*`, `[Text](Adresse)`, `- `, `1. `), kein `contenteditable`. Die Schreibweise steht als Text beim Feld, nicht nur in einem Tooltip.
- [ ] **11.21** Beim Hochladen ist genau eines von «Alt-Text» und «Nur Zierde» Pflicht, die Sichtbarkeit ohne Vorgabe. Die Medienbibliothek zeigt den Alt-Text-Zustand als Wort («ja», «nein», «Nur Zierde»); die Vorschau eines Bildes ersetzt den Alt-Text nie.
- [ ] **11.22** Die Vorschau im Rahmen hat einen Titel (`title` am `iframe`), lässt sich ohne Maus verlassen und zeigt dieselbe Darstellung wie die erzeugte Seite (Computer und Handy).
- [ ] **11.23** Ungespeicherte Änderungen: Beim Verlassen kommt eine Rückfrage; der Zustand «gespeichert» oder «nicht gespeichert» steht als Text da. Es gibt keinen Autospeicher, der unbemerkt Fehler erzeugt.
- [ ] **11.24** Tabellen (Seitenliste) haben Spaltenköpfe; auf schmalen Bildschirmen scrollt die Tabelle in ihrem Rahmen, nicht die Seite.
- [ ] **11.25** Der Editor ist bei 200 Prozent Zoom und bei 320 Pixeln Breite benutzbar und folgt dem Dunkelmodus und den erzwungenen Farben. Bekannter Befund: In erzwungenen Farben ist der gewählte Filter nicht erkennbar (`filterGruppe` in `dom.js`); ein Issue mit dem Label `accessibility` ist noch nicht angelegt.

## 12. Verwaltung: Bereich «Termine»

Dieser Abschnitt gilt für die fünf Reiter des Bereichs «Termine» unter `/admin` (`apps/api/public/admin/termine*.js`): Warnliste (#433), Kategorien (#434), Vorschläge (#441), Anlässe (#445) und Räume (#446, #447). Der Bereich «Anwesenheit» (#195) ist ein eigener Bereich der Verwaltung, kein Reiter von «Termine»; er liest nur, erfasst wird in den Apps. Er hat den Punkt 12.19. Massstab ist WCAG 2.2 AA, geprüft wird im Browser am PC und am Handy wie in Abschnitt 11 (Editor); die Abschnitte 1 bis 4 und 7 gelten nicht. Ein Punkt, der auf einen Reiter nicht zutrifft, entfällt.

Vorbereitung: die Demo-Abteilung mit je einem Beispiel pro Reiter (Termine ohne Tag, eine unbekannte Kategorie, offene und entschiedene Vorschläge, ein Anlass mit Feldern und Anmeldungen, ein Raum mit offener Anfrage). Screenreader am PC: NVDA mit Firefox, VoiceOver mit Safari. Zoom: Browser auf 200 Prozent und eine Breite von 320 CSS-Pixeln. Erzwungene Farben und «Bewegung reduzieren» einschalten. Keine echten Namen und Telefonnummern verwenden.

### Alle Reiter

- [ ] **12.1** Die Reiter lassen sich mit der Tastatur erreichen und auslösen. Der aktive Reiter trägt `aria-current="page"`, und die Adresse (`#termine/<Reiter>`) führt beim Neuladen zum selben Reiter.
- [ ] **12.2** Jeder Reiter hat eine Überschrift (`h2`) und sagt ehrlich, was los ist: Laden, leer (als Satz), Fehler, nicht angemeldet und keine Berechtigung stehen als Text mit einem Knopf wie «Nochmals versuchen», nie als leere Fläche.
- [ ] **12.3** Ein Zustand (Grund in der Warnliste, Stand eines Anlasses, Status eines Vorschlags oder einer Raumanfrage) steht als Wort, nie nur als Farbe oder Symbol.
- [ ] **12.4** Tabellen haben Spaltenköpfe. Der Name eines Termins, Vorschlags oder Anlasses in der Zeile ist ein Link, der sagt, wohin er führt. Auf schmalen Bildschirmen scrollt die Tabelle in ihrem Rahmen, nicht die Seite.
- [ ] **12.5** «Weitere laden» hängt Einträge an, ohne den Fokus zu verlieren, und meldet das Ergebnis in einer Live-Region («höflich»), ohne eine laufende Ansage abzubrechen.
- [ ] **12.6** Dialoge (Ablehnen mit Begründung, Tag zuordnen, Anlass anlegen, Raum anlegen, ändern und löschen, jede Bestätigung) setzen den Fokus hinein, halten ihn darin und geben ihn beim Schliessen an den Auslöser zurück. Ist der Auslöser nach dem Neuzeichnen weg, liegt der Fokus auf der Überschrift oder dem Hinweis, nie im Leeren. Esc schliesst, wo nichts verloren geht.
- [ ] **12.7** Formulare haben sichtbare Beschriftungen, Pflichtfelder sind als solche benannt, Zähler für Zeichen sind Text. Ein Fehler vom Server (400, 403, 404, 409, 429, offline) steht als Text beim Feld oder in einer Meldung, die der Screenreader ansagt; der Fokus liegt danach auf der Meldung oder dem ersten fehlerhaften Feld, und die Eingaben bleiben.
- [ ] **12.8** Aktionen mit Folgen (Freigeben, Ablehnen, «Als in Outlook eingetragen markieren», Raumanfrage annehmen oder ablehnen, Anlass oder Raum löschen) fragen nach und nennen im Dialog, was geschieht. Bei einem Konflikt (409) zeigt die Seite den aktuellen Stand und setzt den Fokus auf den Hinweis.
- [ ] **12.9** Filter (Status der Vorschläge, Angemeldet, Abgemeldet und Alle bei den Anmeldungen) zeigen die Auswahl nicht nur über Farbe und behalten den Fokus auf dem Knopf, wenn die Liste sich ändert; das Ergebnis wird angesagt.
- [ ] **12.10** Zeiten stehen als Text mit Wochentag und Datum in Schweizer Zeit; ein mehrtägiger Termin nennt Anfang und Ende. Felder für Datum und Zeit haben eine Beschriftung und nennen das Format.
- [ ] **12.11** Der Bereich ist bei 200 Prozent Zoom und bei 320 Pixeln Breite benutzbar, ohne Scrollen in zwei Richtungen, mit erzwungenen Farben lesbar (der gewählte Filter ist erkennbar: siehe den bekannten Befund bei 11.25) und mit Kontrast von mindestens 4.5:1 für Text und 3:1 für Bedienelemente. Touch-Ziele sind mindestens 44 × 44 Pixel gross.
- [ ] **12.12** Die Texte sind kurz, Deutsch in Schweizer Schreibweise (ss, «»), und Knöpfe sind Verben.

### Je Reiter

- [ ] **12.13** Warnliste: Der Zähler im Kopf nennt «Mindestens N», wenn es weitere Termine gibt. Der Hinweis, dass eine Zuordnung erst beim nächsten Abgleich wirkt (bis zu 5 Minuten), steht als Text. Die Tabelle der unbekannten Kategorien verweist auf den Reiter «Kategorien».
- [ ] **12.14** Kategorien: Entfernen fragt zurück; «Tag zuordnen» aus der Warnliste öffnet den Dialog mit der Kategorie (Adresse `#termine/kategorien/<Kategorie>`) und setzt den Fokus hinein; schlägt der Abruf der Warnliste fehl, fehlt der Abschnitt «Kategorien ohne Tag», ohne den Reiter zu stören.
- [ ] **12.15** Vorschläge: Die Aktionen hängen am Stand (offen: Freigeben und Ablehnen; freigegeben: Kopieren und Eintragen; sonst keine); beim eigenen Vorschlag gibt es keinen Knopf, nur den Hinweis. «Kategorien kopieren» meldet das Ergebnis als Text. Die Begründung beim Ablehnen ist Pflicht und nennt die Grenze von 500 Zeichen.
- [ ] **12.16** Anlässe: Die Reihenfolge der Zusatzfelder ändert man mit den Knöpfen «Nach oben», «Nach unten» und «Entfernen», nie nur durch Ziehen (WCAG 2.5.7); nach dem Verschieben liegt der Fokus auf dem Knopf, und die neue Position wird angesagt. Der Hinweis zu Gesundheitsdaten steht immer als Text, ebenso «Änderungen sind noch nicht gespeichert.».
- [ ] **12.17** Anmeldungen und Export: Die Summen stehen als Zahl im Filterknopf. Der Export ist ein Link mit `download`, nennt Dateityp und Personendaten und weist auf das führende Hochkomma bei Formelzeichen hin; er löst keinen Abruf im Speicher aus.
- [ ] **12.18** Räume: Das Team wird erst beim Öffnen eines Dialogs geladen; der Abschnitt «Offene Anfragen» nennt Raum, Zeit und Zweck als Text, und Annehmen und Ablehnen sind getrennte Knöpfe mit Rückfrage.
- [ ] **12.19** Anwesenheit (Bereich «Anwesenheit», #195): Die Tabelle je Stufe hat Spaltenköpfe, die Reiter «Kinder» und «Leitende» tragen `aria-current="page"`, die Auswahl der Anzahl (5, 10, 20) und der Stufe ist per Tastatur bedienbar und zeigt den Zustand nicht nur über Farbe, eine Zelle ohne Eintrag ist als Text lesbar (nicht nur «–» als Zeichen), und beim Wechsel bleibt der Fokus auf dem gewählten Element.

### Stand der Prüfung

Aus den PRs der Issues, ohne neue Messung für dieses Dokument: Jeder Reiter wurde im Browser (Chromium, Playwright) mit der echten `termine.js` und `admin.css` und erfundenen Antworten geprüft, mit Demo-Namen, bei 390 Pixeln Breite und, wo der PR es vermerkt, 1280 Pixeln: Warnliste (#433: Liste, Nachladen, leer), Vorschläge (#441: Tastaturablauf von Liste bis Eintragen, 409, Netzausfall, erzwungene Farben), Anlässe (#445: Verschieben und Entfernen per Tastatur, Validierung, Export, 403, 401, 500, offline) und Räume (#446, #447); der Bereich «Anwesenheit» ist hier nicht Teil dieser Angabe. Nicht geprüft: ein echter Server mit zweitem Faktor, Screenreader (NVDA, VoiceOver, TalkBack) und 200 Prozent Zoom von Hand. Die Punkte oben sind das Mass für diese Prüfung und noch von Hand abzuhaken; ein Hellmodus existiert nicht (die Verwaltung kennt nur das dunkle Thema).

## Im PR angeben

Bei UI-Änderungen nennt der PR-Text unter «Evidence»:

- die geprüften Punkte mit Nummer
- Gerät und Systemversion
- was nicht geprüft werden konnte, und warum
- offene Befunde mit der Nummer ihres Issues (Label `accessibility`)

Beispiel:

```text
Geprüft auf <Gerät> mit Android <Version>: 1.1–1.7, 2.1, 5.1–5.4, 6.1, 6.3
Nicht geprüft: iPhone, noch kein Dev-Build
Offen: 5.1 bei grösster Schrift (#<Issue>)
```
