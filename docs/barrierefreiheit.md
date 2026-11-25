# Checkliste Barrierefreiheit

Mit dieser Checkliste wird jeder Bildschirm der App von Hand geprüft, auf einem iPhone und einem Android-Gerät. Massstab ist WCAG 2.2 AA, sinngemäss für Apps.

## Wann prüfen

- Neuer Bildschirm: mindestens die Punkte aus Abschnitt 1 mit VoiceOver und TalkBack, dazu alle anderen Punkte, die er berührt.
- Geänderter Bildschirm: die Punkte, die die Änderung berührt.
- Vor dem Pilot und vor Version 1.0: alle Punkte auf jedem Bildschirm.
- Öffentliche Seiten der Website und Editor der Verwaltung (Web statt App): Abschnitt 11, im Browser geprüft.
- Bereich «Termine» der Verwaltung (Web statt App): Abschnitt 12, im Browser geprüft.
- Lädeli auf der Website: Abschnitt 11 («Lädeli»); Bereich «Lädeli» der Verwaltung: Abschnitt 13, im Browser geprüft.
- Verwaltung insgesamt (Web statt App), im Browser geprüft: Toasts und zweistufige Knöpfe Abschnitt 14, Rückmeldungen als Toast Abschnitt 84, Kopf, Auswahlfelder und Seiten im Fluss Abschnitt 15, Übersicht Abschnitt 16, Anmeldung, System und Mitteilungen Abschnitt 17, Website-Medien, Einstellungen und Lädeli Abschnitt 18, Personen Abschnitt 19, Lager Abschnitt 20, Seiten und Editor Abschnitt 21, Navigation, Bereichsauswahl und Befehlspalette Abschnitt 22.
- Ein Punkt ohne Angabe des Systems gilt für iOS und Android. Punkte, die auf einen Bildschirm nicht zutreffen, entfallen.
- Zweiten Faktor einrichten (Verwaltung, Pflichtseite und Mein Konto): Abschnitt 73; Rollen «Abteilungsleitung» und «Entwickler» in der Verwaltung: Abschnitt 74; beide im Browser geprüft.
- Rückmeldungen nach einer Aktion auf der öffentlichen Website (Toasts): Abschnitt 83, im Browser geprüft.
- Fotos in der Verwaltung (Albumliste mit Suche, Filter und Sammelaktionen): Abschnitt 87, im Browser geprüft.
- Funktionen im Blatt der Person (Verwaltung, Personen) und Rollenseite nur zum Lesen: Abschnitt 89, im Browser geprüft.
- Rufname in der Verwaltung (Personenliste, Blatt, Kontomenü, Suche, Personenwahl): Abschnitt 94, im Browser geprüft.
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
- [ ] **8.2** Ausser der App-Sperre gibt es kein Zeitlimit: Keine Eingabe läuft ab, keine Rückfrage und kein Fehler in einem Feld oder Formular verschwindet von selbst. Ausnahme in der Web-Verwaltung (Entscheid des Auftraggebers, #570, erweitert in #761): Rückmeldungen nach einer Aktion sind Toasts und gehen von selbst, Erfolg und Info nach 4 Sekunden, Warnung und Fehler nach 8 Sekunden, eine Meldung mit Aktion («Nochmals versuchen») bleibt bis zum Schliessen. Bedingungen: Der Toast steht sofort und ganz in einer Live-Region (höflich, Fehler `role="alert"`), die Zeit hält bei Zeiger und Fokus an und beginnt danach neu, «Hinweis schliessen» und Esc bleiben, mit «Bewegung reduzieren» ohne Übergang. Der Toast bestätigt nur, was auf der Seite ohnehin sichtbar ist, oder nennt einen Fehler, dessen Folge eine dauerhafte Marke zeigt («Nicht gespeichert»); er ist keine Voraussetzung, um weiterzuarbeiten (WCAG 2.2.1 betrifft Zeitlimits für Aufgaben, 2.2.3 ist AAA). Abschnitt 84.

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
- [ ] **11.3** Ein Sprunglink «Zum Inhalt» ist der erste fokussierbare Punkt, wird beim Fokus sichtbar und führt zu `main` (`id="inhalt"`). Die Navigation ist ein `nav` mit Beschriftung, die aktuelle Seite trägt `aria-current="page"`, ihre Oberseiten `aria-current="true"`. Am Handy öffnet «Menü» ein `details`-Element (ohne Skript, mit Tastatur bedienbar); darin sind die Unterseiten zugeklappt, der Zweig der aktuellen Seite ist offen. Am Computer ist ein Punkt mit Unterseiten ein Link und daneben ein Dreieck (`summary` eines `details`, Name «Unterseiten von …», 28 × 48 px, mit Finger 44 px breit): Es öffnet die Tafel mit Klick, Tipp, Enter oder Leertaste, auch ohne Skript; die Unterseiten des Bereichs stehen zusätzlich in einer Unterleiste mit Beschriftung. Mit `menue.js` öffnet die Tafel auch beim Zeigen und bleibt offen, solange der Zeiger auf Punkt oder Tafel steht (WCAG 1.4.13); Pfeiltasten gehen links und rechts zwischen den Punkten, runter in die Tafel, dort rauf und runter; Esc schliesst und gibt den Fokus zurück; verlässt der Fokus den Punkt, schliesst die Tafel. Der Kopf bleibt beim Scrollen stehen und verdeckt den Fokus nicht (`scroll-padding-top`, WCAG 2.4.11). Der Umschalter Hell und Dunkel hat zwei Knöpfe mit `aria-label` und `aria-pressed`; der gewählte unterscheidet sich in der Form, nicht nur in der Farbe.
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

- [ ] **11.40** Jeder Zustand ist Text mit Symbol, nie nur Farbe: Laden (`aria-busy`, Ansage in der Statusregion erst nach 700 ms und einmal, Skeleton `aria-hidden`), leer, Fehler mit «Nochmals versuchen» (`role="alert"`), nicht angemeldet mit Link «Anmelden», kein Zugriff. «Abgesagt» und «Noch unklar» stehen als Wort im Etikett.
- [ ] **11.41** Reiter «Alle» und «Mein Kalender»: `role="tab"` mit `aria-selected`, Pfeiltasten, Pos1 und Ende wechseln; ohne Sitzung ist «Mein Kalender» `aria-disabled`, und in der Zeile der Reiter steht das Angebot «Nur die Termine deiner Gruppen sehen?» mit dem Link «Anmelden» (#564). Der öffentliche Datenplan (Liste und Monat) ist ohne Anmeldung und als Liste auch ohne Skript lesbar.
- [ ] **11.42** Der Termin ist ein Link mit sprechendem Namen (Wochentag, Datum, Titel, Zeit, Ort, Gruppen). Der Monat (#564) ist ein Kalender mit Tagesfeld: Jeder Tag ist eine Schaltfläche mit Namen («Samstag, 13. März, 6 Termine»), der gewählte trägt `aria-pressed`, heute `aria-current="date"`. Genau ein Tag steht in der Tab-Reihenfolge; Pfeiltasten gehen einen Tag oder eine Woche, Pos1 und Ende an den Rand der Woche, Bild auf und ab einen Monat (mit Umschalt ein Jahr), der Fokus bleibt beim Monatswechsel auf dem Tag. Eingabe, Leertaste, Klick oder Finger wählen den Tag; das Tagesfeld nennt alle seine Termine mit Zeit, Ort und Gruppen, und eine Live-Region meldet die Zahl. Ein Tag mit Terminen zeigt Titel und «+ n weitere», am Handy Punkte (Form, nicht nur Farbe); die Tage sind am Handy mindestens 44 px gross. Kalender und Tagesfeld behalten beim Blättern ihre Höhe; das Tagesfeld rollt in sich und ist mit der Tastatur erreichbar.
- [ ] **11.43** Das Filterblatt am Handy ist ein `dialog` (Fokus hinein, Esc schliesst, Fokus zurück auf «Filter»); die Auswahl sind Schalter mit `aria-pressed`, aktive Filter stehen auch als Text.
- [ ] **11.44** Formulare (Terminvorschlag, Anmeldung): jedes Feld hat ein `label`, Fehler stehen oben in einer Zusammenfassung (`role="alert"`, trägt den Fokus, Links auf die Felder) und beim Feld (`aria-invalid`, `aria-describedby`). Eine Auswahl aus einer Antwort ist eine `radiogroup` mit Pfeiltasten. Beim Senden sind die Felder `readonly`, der Knopf `aria-disabled` und `aria-busy`; der Entwurf bleibt bei Fehler und ohne Verbindung erhalten.
- [ ] **11.46** Auswahlfelder (#564, `auswahl.js`): Das Feld ist eine Schaltfläche mit `role="combobox"`, `aria-expanded` und dem Namen des `label`; die Liste ist eine `listbox`, die aktive Option steht in `aria-activedescendant`, die gewählte trägt `aria-selected` und einen Haken. Pfeiltasten, Pos1, Ende, Bild auf und ab, Eingabe, Leertaste, Escape, Tab und Tippen zum Springen wirken wie beim Feld des Browsers; ein Klick daneben schliesst. Die Liste klappt nach oben oder richtet sich rechts aus, wenn der Platz fehlt; Optionen sind 44 px hoch. Ohne Skript steht das `<select>` des Browsers da.
- [ ] **11.45** Rückfragen («Neuen Link erzeugen?», «Abmelden?») sind ein `alertdialog` mit Fokus auf «Abbrechen». Eine Meldung wie «Link kopiert» verschwindet nie von selbst, sondern mit «OK».

### Lädeli (#566)

Gilt für den Baustein «laden» zusätzlich zu 11.1 bis 11.11, mit und ohne Anmeldung (Demo-Konto).

- [ ] **11.50** Ohne Anmeldung: Der Laden ist ein Katalog. Statt Warenkorb und Bestellen steht ein Text mit dem Link «Zum Bestellen anmelden» (Link, keine Schaltfläche, führt auf `/anmelden?weiter=…`), im Kopf des Ladens und im Artikelfenster. Bis klar ist, ob jemand angemeldet ist, sind die Bedienelemente nicht da (kein Sprung, nichts wird zuerst angesagt und dann entfernt).
- [ ] **11.51** Die Kachel ist eine Schaltfläche mit Name, Preis und, wo es zutrifft, «nicht verfügbar» (auch als Text in der Ecke, nie nur als blasseres Bild). Das schnelle Hinzufügen (nur angemeldet) erscheint beim Zeigen und beim Fokus auf der Kachel; das Plus in der Ecke gibt es nur auf Geräten ohne Zeigen, ist 44 px gross und trägt den Namen «Schnell dazu: <Artikel>». Esc schliesst den offenen Streifen und gibt den Fokus an das Plus zurück.
- [ ] **11.52** Artikelfenster, Warenkorb und Bestellübersicht sind ein `dialog` mit `aria-labelledby` (`showModal`): Der Fokus geht hinein und beim Schliessen zurück an den Auslöser, Esc und der Knopf «Schliessen» schliessen, der Hintergrund ist nicht bedienbar.
- [ ] **11.53** Mengenknöpfe: «Eins weniger» und «Eins mehr» tragen einen Namen mit dem Artikel (Gruppe mit `legend` «Menge <Artikel>»), die Grenzen (1 und 10) sind `aria-disabled`, die Menge steht als Zahl und die neue Menge und Summe sagt eine Live-Region an («Menge 2. Summe CHF 80.–»). Touch-Ziele mindestens 44 px.
- [ ] **11.54** Die Wahl der Grösse (nur bei einer Liste) sind Schalter mit `aria-pressed`, der gewählte unterscheidet sich in der Form und nicht nur in der Farbe; fehlt die Wahl, ist «In den Warenkorb» `aria-disabled` und ein Klick führt zur Wahl und sagt «Wähle zuerst eine Variante». Bei Einheitsgrösse gibt es keine Wahl.
- [ ] **11.55** Entfernen im Warenkorb zeigt an der Stelle der Zeile «Entfernt: <Artikel>» mit dem Knopf «Rückgängig»; der Fokus liegt auf «Rückgängig», die Zeile verschwindet nicht von selbst (keine Frist, WCAG 2.2.1), sondern erst mit der nächsten Änderung des Korbs. Nach «Rückgängig» liegt der Fokus auf dem ersten Knopf der Zeile.
- [ ] **11.56** Statusmeldungen (Artikel liegt im Warenkorb, Menge, entfernt, «Wird gesendet …», «Deine Bestellung ist eingegangen», storniert) stehen in einer Live-Region (`role="status"`) ohne Fokussprung; Fehler beim Bestellen (zu viele Versuche, Preis geändert, nicht verfügbar, keine Verbindung) stehen als Text mit Symbol in einem `role="alert"`-Band, der Warenkorb bleibt erhalten. Beim Senden ist der Knopf `aria-disabled` und trägt «Wird gesendet …».
- [ ] **11.57** «Deine Bestellungen»: Überschrift, Liste mit Datum, Stand als Wort (Offen, Bereit zur Übergabe, Übergeben, Storniert), Positionen und Summe; «Stornieren» nennt die Bestellung im Namen. Zustände Lädt, leer und Fehler sind Text, der Fehler mit «Nochmals versuchen».
- [ ] **11.58** Mit «Bewegung reduzieren» rollen Zahlen nicht, der Streifen gleitet nicht und das Blatt blendet nur ein; mit erzwungenen Farben haben Kachel, Plus, Streifen und Knöpfe einen Rand.

### Ladezustände (#574)

Gilt für jede Seite mit Bildern und für jede Stelle, die per Skript nachlädt (Termine, Anlass, Anmeldung, Terminvorschlag, geschützte Bausteine, Anmelden).

- [ ] **11.60** Skelette stehen in der Form des Inhalts und erscheinen erst nach 150 ms: Bei einer schnellen Antwort (oder einem Bild aus dem Cache) blitzt nichts auf. Mit «Bewegung reduzieren» steht das Skelett still und getönt, ohne Streifen.
- [ ] **11.61** Das Skelett ist `aria-hidden`, der Bereich trägt `aria-busy="true"`; die Ansage («… werden geladen») steht in einer Statusregion, kommt erst nach 700 ms, nur einmal, und wird vor dem Ergebnis geleert. Das Ergebnis wird angesagt («117 Termine geladen.», «Das hat nicht geklappt.»).
- [ ] **11.62** Nichts bleibt für immer im Ladezustand: Nach 15 s (Änderungen 30 s) steht der Fehlerzustand mit «Nochmals versuchen»; der Knopf «Melde an …» wird wieder bedienbar. Prüfen mit gedrosseltem Netz (Entwicklerwerkzeuge, Netzwerk, «Langsames 3G») und mit gesperrtem Abruf.
- [ ] **11.63** Bilder: Die Fläche hat von Anfang an die Form des Bildes (kein Springen); nach dem Laden blendet das Bild ein (bei «Bewegung reduzieren» nicht). Ein Bild, das nicht lädt, zeigt eine ruhige Fläche mit gestricheltem Rand und Zeichen und den Alt-Text für Screenreader, nie das kaputte Bild-Symbol des Browsers. Ohne Skript erscheinen die Bilder, wie der Browser sie zeichnet.
- [ ] **11.64** Skelette haben genug Kontrast, um als Fläche erkennbar zu sein, und sind nicht grell (hell und dunkel); in erzwungenen Farben haben sie einen Rand.
- [ ] **11.65** Der Seitenwechsel blendet ruhig über (0.2 s), der Kopf bleibt stehen, bei «Bewegung reduzieren» gibt es keinen Übergang, und Fokus und Sprunglink arbeiten danach wie bei einem normalen Seitenwechsel.

### Editor

- [ ] **11.15** Der Editor lässt sich vollständig mit der Tastatur bedienen: Seitenliste, Einstellungen, Bausteine hinzufügen, bearbeiten, verschieben, duplizieren und löschen, Vorschau, Veröffentlichen, Versionen, Medienbibliothek. Verschieben geht mit Knöpfen («Nach oben», «Nach unten») und am Griff mit der Tastatur (Leertaste nimmt auf, Pfeiltasten verschieben, Leertaste legt ab, Escape bricht ab), nie nur durch Ziehen (WCAG 2.5.7). Der Seitenbaum ist ein Baum (Abschnitt 21), die Bausteine und die Karten im Baustein sind Sortierlisten (Griff, Tastatur, Knöpfe).
- [ ] **11.16** Jedes Bedienelement hat einen Namen, der mit dem sichtbaren Text beginnt, und eine Rolle. Der Zustand einer Seite, eines Bausteins und einer Version ist ein Wort, nie nur ein Symbol oder eine Farbe.
- [ ] **11.17** Dialoge (Einstellungen, Rückfrage beim Löschen, Konflikt, Veröffentlichen, Hochladen) setzen den Fokus hinein, halten ihn darin und geben ihn beim Schliessen an das Element zurück, das sie geöffnet hat; Esc schliesst, wo nichts verloren geht.
- [ ] **11.18** Nach dem Löschen eines Bausteins erscheint ein Toast mit «Rückgängig» (auch Strg+Z); Rückmeldungen im Editor sind Toasts (Abschnitt 84). Hinzufügen, Verschieben, Speichern und Veröffentlichen melden das Ergebnis als Toast (Live-Region), ohne den Fokus zu stehlen.
- [ ] **11.19** Fehler vom Server (400 mit Feldpfad, 409 Konflikt, 413, 429, offline) stehen als Text beim betroffenen Feld und in einer Meldung, die der Screenreader ansagt; der Fokus liegt danach auf der Meldung oder dem ersten fehlerhaften Feld.
- [ ] **11.20** Der Rich Text ist ein Textfeld mit einer kleinen Schreibweise (`**fett**`, `*kursiv*`, `[Text](Adresse)`, `- `, `1. `), kein `contenteditable`. Die Schreibweise steht als Text beim Feld, nicht nur in einem Tooltip. Eine Format-Leiste (Fett, Kursiv, Link, Liste, Nummerierung; Strg+B und Strg+I) setzt sie im Feld um; die Knöpfe sind gewöhnliche Knöpfe, der Text bleibt derselbe.
- [ ] **11.21** Beim Hochladen ist genau eines von «Alt-Text» und «Nur Zierde» Pflicht, die Sichtbarkeit ohne Vorgabe. Die Medienbibliothek zeigt den Alt-Text-Zustand als Wort («Alt-Text vorhanden», «Alt-Text fehlt», «Nur Zierde»); die Vorschau eines Bildes ersetzt den Alt-Text nie.
- [ ] **11.22** Die Vorschau im Rahmen hat einen Titel (`title` am `iframe`), lässt sich ohne Maus verlassen und zeigt dieselbe Darstellung wie die erzeugte Seite (Computer und Handy).
- [ ] **11.23** Ungespeicherte Änderungen: Beim Verlassen kommt eine Rückfrage; der Zustand «gespeichert» oder «nicht gespeichert» steht als Text da. Es gibt keinen Autospeicher, der unbemerkt Fehler erzeugt.
- [ ] **11.24** Die Seitenliste ist ein Baum (`role="tree"`, Abschnitt 21); auf schmalen Bildschirmen bricht die Zeile um, die Seite scrollt nicht waagrecht.
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
- [ ] **12.14** Kategorien: Alle Zuordnungen stehen in einer Tabelle; jede Auswahl der Gruppe hat eine Beschriftung für Screenreader («Gruppe für <Kategorie>»), der Zustand steht als Wort («Zugeordnet», «Nicht zugeordnet», «Nicht gespeichert»). «Speichern» schreibt nur die geänderten Zeilen; bei einem Fehler bleiben die Wahlen stehen, und die Meldung sagt es. «Gruppe zuordnen» aus «Ohne Kategorie» (Adresse `#termine/kategorien/<Kategorie>`) setzt den Fokus in die Auswahl der Zeile; schlägt der Abruf der Warnliste fehl, fehlen die unbekannten Kategorien, ohne die Seite zu stören.
- [ ] **12.15** Vorschläge: Die Aktionen hängen am Stand (offen: Freigeben und Ablehnen; freigegeben: Kopieren und Eintragen; sonst keine); beim eigenen Vorschlag gibt es keinen Knopf, nur den Hinweis. «Kategorien kopieren» meldet das Ergebnis als Text. Die Begründung beim Ablehnen ist Pflicht und nennt die Grenze von 500 Zeichen.
- [ ] **12.16** Anlässe: Die Reihenfolge der Zusatzfelder ändert man per Ziehen am Griff, mit der Tastatur (Leertaste nimmt auf, Pfeile bewegen, Leertaste legt ab, Escape bricht ab) und mit den Knöpfen «Nach oben» und «Nach unten», nie nur durch Ziehen (WCAG 2.5.7); die neue Position wird angesagt (Sortierliste, siehe 12.22). Der Hinweis zu Gesundheitsdaten steht immer als Text, die ungespeicherten Änderungen stehen in der Speicherleiste (12.23).
- [ ] **12.17** Anmeldungen und Export: Die Summen stehen als Zahl im Filterknopf. Der Export ist eine Zeile auf dem Reiter «Anmeldungen» des Anlasses (kein Fenster, siehe 25.6), nennt Dateiname, Format, Stand und Personendaten und weist auf das führende Hochkomma bei Formelzeichen hin. «Der Export wird erstellt …», «Bereit: <Datei> (<Grösse>)» und «Der Export ist fehlgeschlagen» stehen als Text in einer Live-Region; der Fortschrittsbalken hat einen Namen und steht bei «Bewegung reduzieren» still. Der Fokus liegt auf dem nächsten sinnvollen Knopf, «Abbrechen» bricht den Abruf ab, und die Datei liegt nur im Speicher der Seite, bis sie heruntergeladen oder die Seite verlassen wird. Der Knopf wechselt von «Export erstellen» über «Abbrechen» zu «Herunterladen» und behält den Fokus.
- [ ] **12.18** Räume und Anfragen: Das Team wird erst beim Öffnen des Blatts geladen. Das Blatt «Raum bearbeiten» zeigt Fehler beim Feld und in einer Zusammenfassung «N Angaben prüfen» mit Knöpfen, die das Feld fokussieren; beim Speichern sind die Felder gesperrt, der Knopf trägt `aria-busy`. Die Anfragen nennen Raum, Zeit und Zweck als Text, «Bestätigen» und «Ablehnen» sind getrennte Knöpfe, «Ablehnen» fragt mit Begründung (Pflicht) zurück; bei einer Überschneidung bleibt «Bestätigen» mit `aria-disabled` erreichbar, und der Grund steht als Text.
- [ ] **12.19** Anwesenheit (Bereich «Anwesenheit», #195): Die Tabelle je Stufe hat Spaltenköpfe, die Reiter «Kinder» und «Leitende» tragen `aria-current="page"`, die Auswahl der Anzahl (5, 10, 20) und der Stufe ist per Tastatur bedienbar und zeigt den Zustand nicht nur über Farbe, eine Zelle ohne Eintrag ist als Text lesbar (nicht nur «–» als Zeichen), und beim Wechsel bleibt der Fokus auf dem gewählten Element.

### Stand der Prüfung

Aus den PRs der Issues, ohne neue Messung für dieses Dokument: Jeder Reiter wurde im Browser (Chromium, Playwright) mit der echten `termine.js` und `admin.css` und erfundenen Antworten geprüft, mit Demo-Namen, bei 390 Pixeln Breite und, wo der PR es vermerkt, 1280 Pixeln: Warnliste (#433: Liste, Nachladen, leer), Vorschläge (#441: Tastaturablauf von Liste bis Eintragen, 409, Netzausfall, erzwungene Farben), Anlässe (#445: Verschieben und Entfernen per Tastatur, Validierung, Export, 403, 401, 500, offline) und Räume (#446, #447); der Bereich «Anwesenheit» ist hier nicht Teil dieser Angabe. Nicht geprüft: ein echter Server mit zweitem Faktor, Screenreader (NVDA, VoiceOver, TalkBack) und 200 Prozent Zoom von Hand. Die Punkte oben sind das Mass für diese Prüfung und noch von Hand abzuhaken; die Verwaltung folgt seit dem Neuaufbau (#524) Tag und Nacht des Geräts, die Aussage oben bezieht sich auf die frühere Fassung.

### Kalender, Anlässe, Räume (#590)

- [ ] **12.20** Kalender, Monatsansicht: Das Raster ist ein `grid` mit Zeilen, Spaltenköpfen (`abbr` mit ausgeschriebenem Wochentag) und Tagesknöpfen; genau ein Tag liegt in der Tabulatorreihenfolge (Roving Tabindex). Pfeile bewegen um einen Tag oder eine Woche, Pos1 und Ende an den Wochenrand, Bild auf und ab um einen Monat (mit Umschalt um ein Jahr); über den Monatsrand wechselt die Ansicht und der Fokus bleibt auf dem Zieltag. Jeder Tag trägt als Namen Datum, «heute» und die Zahl der Termine; die Chips im Raster sind `aria-hidden`, die Termine des gewählten Tages stehen als Liste neben oder unter dem Raster, die Auswahl wird angesagt (Statusregion). «Heute» ist ein gefüllter Kreis, der gewählte Tag hat einen Rahmen, beides nicht nur über Farbe.
- [ ] **12.21** Kalender, Zustände: Abgesagt ist durchgestrichen und trägt das Wort «Abgesagt» in der Liste, ein Termin ohne Gruppe ist gestrichelt und trägt «Keine Gruppe»; ein Termin über mehrere Tage ist ein verbundener Balken, die Liste nennt «Tag 2 von 5». Unter 40 rem zeigt das Raster Punkte statt Chips (Form unterscheidet: Kreis, Ring, Quadrat). Der Monat lädt mit `aria-busy`; schlägt er fehl, steht ein Hinweis mit «Nochmals versuchen» (`role="alert"`). Monatswechsel legen einen Verlaufseintrag an (Zurück führt zum Vormonat), die Wahl eines Tages ändert nur die Adresse. Die Tabelle («Liste») bleibt als Ansicht mit demselben Inhalt.
- [ ] **12.22** Anlässe: Zusatzfelder, Reihenfolge, Griff 44 px mit Namen «Verschieben: <Feld>»; die Zeile hat «Bearbeiten» und «Entfernen» mit dem Feldnamen im Namen. Anmeldeschluss hat ein Datumsfeld und ein Zeitfeld mit Format «TT.MM.JJJJ» und «HH:MM» (Tippen und Kalender), kein natives Feld. Plätze eines Raums sind ein Zahlfeld mit Knöpfen «Weniger» und «Mehr».
- [ ] **12.23** Speicherleiste (Zusatzfelder, Kategorien): Sie erscheint erst, wenn etwas geändert ist (`role="region"`, Text in einer Statusregion: «2 Zuordnungen geändert, noch nicht gespeichert.»), bietet «Verwerfen» und «Speichern», haftet unten und verdeckt den Fokus nicht; ohne Änderungen gibt es keinen Speichern-Knopf, auch nicht bei leerer Seite.
- [ ] **12.24** Anmeldungen, Balken: Angemeldet und Abgemeldet stehen als Zahl und Prozent im Text, der Balken ist `aria-hidden` und wächst nur bei erlaubter Bewegung; die Frist nennt Datum, Uhrzeit und die Tage bis dahin. Die Rückmeldungen stehen seit #608 auf dem Reiter «Übersicht» des Anlasses (siehe 25.5).

## 13. Verwaltung: Bereich «Lädeli»

Dieser Abschnitt gilt für die drei Unterseiten des Bereichs «Lädeli» unter `/admin` (`apps/api/public/admin/laedeli.js`): Bestellungen, Artikel, Einstellungen. Geprüft wird im Browser am PC und am Handy; die Abschnitte 1 bis 4 und 7 gelten dafür sinngemäss.

- [ ] **13.1** Die Unterseiten lassen sich mit der Tastatur erreichen (`aria-current="page"`), jede hat eine Überschrift und sagt ehrlich, was los ist: Laden, leer (als Satz), Fehler mit «Nochmals versuchen», kein Zugriff.
- [ ] **13.2** Bestellungen: Der Stand ist ein Wort mit Symbol, nie nur Farbe; der Filter nach Stand zeigt die Auswahl nicht nur über Farbe und behält den Fokus; «Weitere laden» meldet das Ergebnis in einer Live-Region. Der Stand lässt sich mit dem geteilten Knopf setzen (Schiene Offen, Bereit, Übergeben, siehe 18.7); «Übergeben» und «Storniert» bieten «Rückgängig» an und nennen die Folge; bei einem Konflikt (409) zeigt die Seite den aktuellen Stand und setzt den Fokus auf den Hinweis.
- [ ] **13.3** Artikel: Die Tabelle hat Spaltenköpfe und die Spalte «Grösse» («Einheitsgrösse» oder die Liste); der Zustand «Verfügbar» oder «Nicht verfügbar» steht als Wort. Das Bild in der Zeile hat `alt=""`, weil der Name daneben steht. Überschriften und Werte stehen untereinander (Preis rechts, Text links, Aktionen rechts; feste Spaltenbreiten, die Tabelle scrollt bei 390 px in ihrem Rahmen).
- [ ] **13.9** Reihenfolge der Artikel: Der Griff am Zeilenanfang ist eine Schaltfläche (44 × 44 px) mit dem Namen «Position ändern: <Artikel>» und `aria-pressed`. Mit der Tastatur greift die Leertaste die Zeile, Pfeil hoch und runter verschiebt sie, die Leertaste setzt sie ab, Escape bricht ab; jede Position sagt eine Live-Region an («Position 3 von 21»), Verlassen des Griffs setzt ab. Nie nur Ziehen (WCAG 2.5.7): «Nach oben» und «Nach unten» stehen im Menü «Mehr» jeder Zeile. Mit Maus und Finger folgt die Zeile dem Zeiger, die anderen weichen aus und ein Platzhalter zeigt den Zielplatz (siehe 26); nach dem Absetzen speichert ein Aufruf, die Meldung «Reihenfolge gespeichert» bietet «Rückgängig» ohne Frist an, und der Fokus bleibt auf dem Griff.
- [ ] **13.4** «Artikel» ist eine Seite im Fluss (Fokus hinein, Zurück und Esc schliessen, Fokus zurück; siehe 15 und 18.8). Die Grösse ist eine Pflichtangabe als Gruppe zweier Wahlkarten (`fieldset` mit `legend` «Grösse (Pflicht)», Radioknöpfe mit Pfeiltasten); das Feld «Vorhandene Grössen» erscheint nur bei «Liste mit Grössen». Ohne Wahl lässt sich nicht speichern.
- [ ] **13.5** Fehler stehen oben in einer Zusammenfassung («N Angaben prüfen», Knöpfe fokussieren das Feld, `role="alert"`, trägt den Fokus) und beim Feld (`aria-invalid`, `aria-describedby`); ein Fehler vom Server (422 mit Feld, 400, 409, offline) steht als Text. Beim Speichern sind die Felder und die Wahl gesperrt, der Knopf trägt `aria-busy`.
- [ ] **13.6** «Artikel löschen» fragt nach und nennt, was geschieht (Bestellungen behalten ihre Positionen); danach liegt der Fokus auf der Überschrift.
- [ ] **13.7** Einstellungen: Die Übergabearten haben eine sichtbare Beschriftung mit Hilfetext (1 bis 5, eine je Zeile), Fehler stehen beim Feld. Das Speichern geschieht in der Speicherleiste unten (siehe 26.7), nicht mit einem Knopf im Formular.
- [ ] **13.8** Der Bereich ist bei 200 Prozent Zoom und bei 320 Pixeln Breite benutzbar (die Tabelle scrollt in ihrem Rahmen), Kontrast und Ziele wie 12.11, Texte kurz, Schweizer Schreibweise, Knöpfe sind Verben.

## 14. Verwaltung: Toasts mit «Rückgängig» und zweistufige Knöpfe (#578)

Dieser Abschnitt gilt für jede Aktion der Verwaltung, die früher eine Rückfrage hatte (die Region trägt seit #761 auch alle Rückmeldungen, Abschnitt 84) (`ctx.mitRueckgaengig`, `zweistufig`; Beschreibung in [verwaltung-geruest.md](verwaltung-geruest.md)). Geprüft wird im Browser am PC und am Handy, in Tag und Nacht; die Abschnitte 1 bis 6 gelten sinngemäss.

- [ ] **14.1** Der Toast erscheint in einer Region mit Namen («Meldungen») gleich nach dem Kopf im Seitenaufbau, nimmt dem Fokus nichts weg und erscheint am Handy über die ganze Breite, ohne Inhalt zu verdecken, der gerade bedient wird.
- [ ] **14.2** Ein Screenreader sagt beim Auslösen die Aktion und die Möglichkeit zum Rückgängigmachen an («Seite gelöscht. Rückgängig mit dem Knopf oder mit Strg Z.»), beim Zurücknehmen «Rückgängig gemacht: …», beim Ausführen «Erledigt.» und bei einem Fehler den Fehlertext (`role="alert"`).
- [ ] **14.3** «Rückgängig» ist mit der Tastatur erreichbar: über Tab (die Region steht vor dem Inhalt), über F6 und, ausserhalb von Eingabefeldern, mit Strg oder Cmd + Z. Der Knopf ist mindestens 44 Pixel hoch und hat einen sichtbaren Fokusring; Zustand und Knopf sind Wort und Unterstreichung, nie nur Farbe.
- [ ] **14.4** Die Frist von 8 Sekunden hält an, solange der Zeiger auf dem Toast steht oder der Fokus darin liegt; ohne «Bewegung reduzieren» läuft ein Balken, mit ihr gibt es keinen Balken und keine Einblendung, die Frist gilt gleich.
- [ ] **14.5** Der Schliessen-Knopf heisst «Jetzt ausführen und schliessen» (in der Frist), danach «Schliessen»; er verwirft nie eine Aktion. Wer die Seite verlässt oder sich abmeldet, führt offene Aktionen aus.
- [ ] **14.6** Zweistufige Knöpfe wechseln beim ersten Klick Beschriftung und Aussehen («Wirklich senden?», Fläche und Text in der Fehlerfarbe), sagen die Frage in einer Statusregion an, ersetzen ein eigenes `aria-label` solange sie scharf sind, fallen nach 6 Sekunden zurück und lassen sich mit Escape zurücknehmen.
- [ ] **14.7** Kontrast: Text auf dem Toast im Tag 10.4:1, in der Nacht 16.6:1, Fehler 6.8:1 und 7.5:1; bei erzwungenen Farben hat der Toast einen Rand. Kein Popup, kein `confirm`, `alert` oder `prompt`.

## 15. Verwaltung: Kopf, Auswahlfelder, Scrollbereiche, Seiten im Fluss (#578)

Die Verwaltung teilt Tokens, Kopf und Bausteine mit der Website (Beschreibung in [verwaltung-geruest.md](verwaltung-geruest.md)). Geprüft in Tag und Nacht, bei 1440 und 390 Pixeln, mit Tastatur.

- [ ] **15.1** Kopf: Marke (Logo oder Wortmarke), «Verwaltung», Konto, Umschalter und «Abmelden» stehen in einer Zeile; darunter die Bereichsleiste mit dem roten Strich unter dem aktuellen Bereich (`aria-current`) und die Unterleiste (unter 960 Pixeln die Bereichsauswahl, Abschnitt 22). Ziele mindestens 44 Pixel, Fokusring sichtbar, Reihenfolge Marke, Bereiche, Unterseiten, Konto.
- [ ] **15.2** Name und Logo der Abteilung kommen aus den Einstellungen der Website, ohne Recht darauf und vor der Anmeldung aus dem Kopf der öffentlichen Website; gibt es beides nicht oder kein Logo, steht die Wortmarke. Das Logo hat leeren Alt-Text, der Name steht für Screenreader im Link; ein Logo ohne dunkle Fassung steht in der Nacht auf hellem Feld (Kontrast).
- [ ] **15.3** Umschalter Hell/Dunkel: Gruppe «Darstellung», zwei Knöpfe mit Namen («Hell», «Dunkel»), `aria-pressed` zeigt die Wahl, die gewählte Seite ist gefüllt und hat einen Ring (nie nur Farbe); die Wahl bleibt nach Neuladen und gilt auch auf der Anmeldeseite.
- [ ] **15.4** Auswahlfelder: Pfeiltasten, Pos1, Ende, Bild auf/ab, Tippen zum Springen, Eingabe oder Leertaste wählt, Escape schliesst nur die Liste; der Name steht im Knopf (`aria-labelledby`), die gewählte Option trägt einen Haken und `aria-selected`; die Liste klappt nach oben, wenn unten der Platz fehlt; gesperrte Felder sind gesperrt. Ohne Skript bleibt das Feld des Browsers.
- [ ] **15.5** Scrollbereiche: Im Editor scrollen die zwei Spalten für sich, nichts wird abgeschnitten (Fokusring sichtbar am Rand), die Seite springt nicht, wenn eine Leiste erscheint; die Leisten sind mit Maus erreichbar und mit Tastatur (Bereich fokussierbar, wenn er scrollt). Bei 200 Prozent Zoom und 320 Pixeln Breite wird daraus eine Spalte ohne Seitenscroll in zwei Richtungen.
- [ ] **15.6** Seiten im Fluss: Der Fokus geht beim Öffnen auf den Titel oder das erste Feld, beim Schliessen zurück zum Auslöser; Browser-Zurück, der Zurück-Knopf und Escape schliessen; «Änderungen verwerfen?» ist eine Zeile mit zwei Knöpfen, kein Popup; das Panel im Editor ist nicht modal (der Inhalt dahinter bleibt bedienbar), Escape schliesst es.
- [ ] **15.7** Verlauf: Jede Ansicht hat eine eigene Adresse; Zurück und Vor im Browser führen zum vorherigen Bildschirm samt Scrollposition; ein Tiefenlink funktioniert nach Neuladen.

## 16. Verwaltung: Übersicht (#583)

Dieser Abschnitt gilt für die Übersicht unter `/admin#uebersicht` (`apps/api/public/admin/uebersicht*.js`, `uebersicht.css`). Geprüft wird im Browser am PC und am Handy, mit je einem Konto der Abteilungsleitung, einer Stufenleitung und eines Webmasters; die Abschnitte 1 bis 4 und 7 gelten dafür sinngemäss (NVDA oder VoiceOver am Browser).

- [ ] **16.1** Die Seite hat eine Überschriftenfolge (`h1` Übersicht, `h2` je Abschnitt «Jetzt zu tun», «Kennzahlen», «Kommendes und Stufen» (nur für Screenreader), «Zustand», `h3` je Kachel und je Dienst im Zustand); jeder Abschnitt ist eine `section` mit `aria-labelledby`.
- [ ] **16.2** Jede Aufgabenkachel ist ein Link mit einem Namen aus Zahl, Satz und Aktion («2 Terminvorschläge warten auf deinen Entscheid, Prüfen»); ohne Recht auf die Zielseite gibt es keinen Link, nur die Zahl. Störung und Sicherheit stehen als Wort mit Symbol, nie nur als Farbe.
- [ ] **16.3** Jede Grafik ist ein Element mit `role="img"` und einem Satz, der alle Werte nennt; sie ist mit Tab erreichbar, zeigt einen sichtbaren Fokusring (3 px) und lässt sich mit Pfeiltasten, Pos1 und Ende ablesen. Der Text der Ablesung steht in einer höflichen Live-Region. Wer keinen Zeiger hat, verliert nichts.
- [ ] **16.4** Die Übersicht hat keinen Schalter «Tabellen statt Diagramme» und keine Tabellenansicht (#607). Die Werte jeder Grafik stehen im Satz (`role="img"`, `aria-label`) und in der Ablesung (16.3); Zahl, Einheit und Veränderung der Kachel stehen als Text neben der Grafik.
- [ ] **16.5** Die Information liegt nie nur in der Farbe: Der aktuelle Zeitraum hat Akzent und steht in der Ablesung, die Veränderung einer Kennzahl trägt Pfeil, Vorzeichen und Worte (nie nur Farbe), Termine von heute tragen das Wort «Heute».
- [ ] **16.6** Lädt: Skelett in der Form der Seite (`aria-hidden`), «Lädt …» in der Live-Region. Fehler einer einzelnen Kachel («Nicht geladen», «Nochmals versuchen») lassen den Rest stehen; ein Fehler der ganzen Seite zeigt die Zustandskarte mit «Nochmals versuchen». Leer steht als Satz («Gerade ist nichts offen.», «In den nächsten 8 Wochen steht nichts an.»).
- [ ] **16.7** «Aktualisieren» im Seitenkopf behält den Fokus und lässt den alten Inhalt stehen, bis der neue da ist («Wird aktualisiert …»).
- [ ] **16.8** Zeiten und Daten stehen in Schweizer Zeit mit Wochentag; das Datumsfeld der Liste «Kommendes» ist für Screenreader ein Satz («Samstag, 5. Dezember: …»), der Block daneben ist `aria-hidden`.
- [ ] **16.9** Hell, Dunkel und erzwungene Farben: Text mindestens 4.5:1, Ränder von Bedienelementen und Marken 3:1; Hover und Fokus sind in jedem Modus erkennbar. Mit «Bewegung reduzieren» wachsen die Säulen nicht ein und nichts gleitet.
- [ ] **16.10** 1440, 1024 und 390 Pixel sowie 320 Pixel und 200 Prozent Zoom: das Raster bricht um, nichts scrollt waagrecht, Zielgrössen mindestens 44 Pixel.
- [ ] **16.11** Je Rolle zeigt die Seite nur ihre Kacheln (Abteilungsleitung alles, Webmaster Website und Medien, Stufenleitung die eigene Stufe); fehlt eine Kachel, bleibt keine Lücke, und eine Rolle ohne Teile bekommt einen Satz statt einer leeren Seite.

### Stand der Prüfung (#583)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 16.1 bis 16.7 und 16.9 bis 16.11 (1440, 390 und 320 Pixel, Hell, Dunkel, erzwungene Farben, Tabellenansicht, Tastaturfolge mit Pfeiltasten in den Grafiken, je ein Konto der Abteilungsleitung, der Stufenleitung und des Webmasters). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack: 14.2, 14.3 und 14.8 nur an den Attributen), 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug.

## 17. Verwaltung: Anmeldung, System, Plattform, Erinnerungen, Mitteilungen (#593)

Dieser Abschnitt gilt für `admin.js` (Anmeldung, zweiter Faktor, Sitzungsablauf), `system.js`, `plattform.js`, `hinweisband.js`, `zeitregeln.js`, `mitteilungen.js` und `system.css`. Die Abschnitte 1 bis 4, 6 und 9 gelten dafür sinngemäss.

- [ ] **17.1** Das Hinweisband ist ein Bereich mit Namen («Betriebshinweis»); Sperre und Wartung stehen als Wort («Informationssperre: …», «Wartung: … ist nur lesbar») mit Symbol, nie nur als Farbe. Text und Verweis erreichen 4.5:1, der Verweis «Zur Plattform» ist mit Tab erreichbar und mindestens 44 Pixel hoch.
- [ ] **17.2** Die Plattform zeigt jeden Zustand als Chip mit Wort («Frei», «In Wartung», «Offen», «Gesperrt»); die Knöpfe tragen den Bereich im Namen («Aufheben: Website»). «Aufheben» fragt im Knopf («Wirklich aufheben?»), Esc nimmt die Frage zurück.
- [ ] **17.3** Das geplante Ende ist Datum und Uhrzeit in eigenen Feldern mit Beschriftung; eine unvollständige Angabe nennt der Fehlertext beim Feld, der Fokus geht dorthin.
- [ ] **17.4** Der Wochentag der Erinnerung ist eine Gruppe mit Legende; jeder Tag hat den vollen Namen für Screenreader («Montag», sichtbar «Mo»), die Pfeiltasten wechseln den Tag. Die Vorschau der nächsten Termine ist eine Liste mit Legende; der nächste Termin trägt Rahmen und steht an erster Stelle.
- [ ] **17.5** Die Vorschau der Mitteilung ist für Screenreader ausgeblendet (`aria-hidden`), die Angaben stehen in den Feldern selbst; «Geht an» und «Rollen» stehen als Liste mit Name und Wert. Der Knopf «Senden» fragt im Knopf, die Frage nennt Empfänger und Rollen. Seit #625 gilt dafür Abschnitt 35.
- [ ] **17.6** Das Diagramm der Anfragen hat einen Satz mit allen Werten, eine Ablesung mit Pfeiltasten und eine Tabelle («Als Tabelle anzeigen»); der Fehleranteil hat Legende und Zahl, nicht nur Farbe.
- [ ] **17.7** Die Seite System aktualisiert sich nie von selbst; «Aktualisieren» meldet «Zahlen aktualisiert.» in der Live-Region.
- [ ] **17.8** Anmeldung: Fehler, «zu viele Versuche» (Chip mit Wort) und der zweite Faktor (Codefeld mit sechs Zellen, Einfügen, Autofill) sind Meldungen mit `role="alert"`; der Fokus liegt auf der Meldung oder dem Titel. Der Sitzungsablauf sagt ehrlich, was verloren geht, und führt nach dem Anmelden auf dieselbe Seite zurück.
- [ ] **17.9** Hell, Dunkel und «Bewegung reduzieren»: Das Band und die Termine der Vorschau gleiten nur bei erlaubter Bewegung ein.
- [ ] **17.10** 320, 390, 720 und 1440 Pixel: nichts scrollt waagrecht, auch Personen und Gruppen nicht (die Beschriftung der Tabelle für Screenreader liegt im Rahmen).

### Stand der Prüfung (#593)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 17.1 bis 17.4, 17.6 bis 17.7 und 17.9 bis 17.10 (320, 390, 720 und 1440 Pixel, Hell und Dunkel, Tastatur im Wochentag, Wartung und Sperre ein- und ausgeschaltet). Anmeldung (17.8) mit falscher Eingabe, 429 und falschem Code im Browser, der echte zweite Faktor und der Sitzungsablauf nur mit nachgestellten Antworten. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug.

## 18. Verwaltung: Website-Medien, Einstellungen, Samstagsangaben der Stufen und Lädeli (#591)

Dieser Abschnitt gilt für `#website/medien`, `#website/einstellungen`, `#website/stufenfakten` und `#laedeli/*` (`website-medien.js`, `website-einstellungen.js`, `website-stufenfakten.js`, `laedeli.js`, `bildwahl.js`). Er ergänzt den Abschnitt 13 für das Lädeli. Geprüft wird im Browser am PC und am Handy, Tag und Nacht.

- [ ] **18.1** Zweispalter: Links stehen die Felder, rechts Bild oder Vorschau; unter 1100 Pixeln steht alles in einer Spalte, die Reihenfolge im Quelltext ist Felder vor Vorschau (beim Alt-Text steht das Bild schmal zuerst). Die rechte Spalte ist ein `aside` mit Überschrift; nichts scrollt waagrecht.
- [ ] **18.2** Bildwahl: Der Knopf trägt `aria-expanded` und `aria-controls`; die Bilder sind Knöpfe mit `aria-pressed`, das gewählte trägt ausserdem einen Haken (nie nur Farbe). Ein Klick wählt, schliesst und setzt den Fokus auf den Knopf zurück; Escape schliesst nur die Wahl. Enter in der Suche schickt das Formular nicht ab. Das Laden meldet «Bilder werden geladen …» (Live-Region), ein Fehler hat «Nochmals versuchen».
- [ ] **18.3** Vorschau der Einstellungen: Sie ist rein darstellend (`alt=""`, die Beschriftung steht darüber); «Nicht gespeichert» und «Alles gespeichert» stehen als Wort in einer Live-Region.
- [ ] **18.4** Medien: Die Ansichtswahl besteht aus zwei Knöpfen mit `aria-pressed` (44 Pixel hoch); in der Liste hat jede Zeile die Auswahl, das Bild, den Namen mit Chips und die Aktion. Die Filterleiste meldet die Trefferzahl («5 von 24 Medien»); gesetzte Filter sind Chips mit Namen. Die Auswahlleiste ist eine Region «Auswahl» mit Zahl in einer Live-Region; «Löschen» bietet «Rückgängig» an.
- [ ] **18.5** Ladezustände: Karten, Raster und Listen zeigen Platzhalter in der Form des Inhalts (`aria-hidden`) und «Lädt …» für Screenreader; das Pulsieren läuft nur mit erlaubter Bewegung. Fehlt ein Bild, steht ein Wort an seiner Stelle.
- [ ] **18.6** Samstagsangaben der Stufen: Die Stufenpillen sind Knöpfe mit `aria-pressed`; Datum und Zeit lassen sich tippen und per Kalender wählen; ein Datum ohne Wahl nennt den Fehler beim Feld.
- [ ] **18.7** Bestellungen: Die Schiene ist eine Liste «Stand der Bestellung» mit `aria-current="step"` am aktuellen Schritt; erledigte Schritte tragen Haken und für Screenreader «(erledigt)». Der geteilte Knopf ist mit Pfeiltasten bedienbar; «Übergeben» und «Stornieren» bieten «Rückgängig» an.
- [ ] **18.8** Artikel: Das Bild steht gross neben den Feldern, die Vorschau nennt Name, Preis, Hinweis, Grössen und Stand; ein Wechsel des Bildes löst die Frage «Änderungen verwerfen?» beim Verlassen aus.

### Stand der Prüfung (#591)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 18.1 bis 18.8 bei 1440, 1024, 720 und 390 Pixeln (kein waagrechter Überlauf, keine Bedienelemente unter 44 Pixeln Höhe ausser den Kontrollkästchen der Medienkarten), Tag und Nacht, Ablauf Einstellungen speichern, Artikel mit neuem Bild speichern, Bestellung bereit melden und zurück auf offen, Alt-Text speichern, Löschen mit «Rückgängig», Suche, Samstagsangaben ändern. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom von Hand, Kontrastwerte mit einem Messwerkzeug, das Hochladen einer echten Datei (kein Speicher lokal).

## 19. Verwaltung: Personen, Gruppen, Kinder, Stufen, Import (#594)

Dieser Abschnitt gilt für den Bereich «Personen» unter `/admin#personen` (`personen*.js`, `tags*.js`, `kinder.js`, `stufen.js`, `import.js`, `telefon.js`, `personen.css`). Geprüft wird im Browser am PC und am Handy, in Tag und Nacht, mit Tastatur; die Abschnitte 1 bis 6 und 14 bis 15 gelten sinngemäss.

- [ ] **19.1** Person erfassen und bearbeiten sind eine Seite im Fluss mit Zurück, Titel und Karten je Abschnitt (Angaben, Rechte und Rollen, Gruppen und Tags, Elternteil von, Konto). Rechts steht das Profil mit dem Bild der Person; ohne Bild stehen die Initialen, beim Erfassen laufen sie mit dem Namen mit. Das Bild hat leeren Alt-Text, der Name steht daneben. Unter 1100 Pixeln steht das Profil zuerst und ist kompakt, nichts scrollt waagrecht.
- [ ] **19.2** Die Knöpfe «Abbrechen» und «Speichern» bleiben unten im Blick (kleben am unteren Rand der Spalte). Beim Absenden steht ein Fehler beim Feld («Bitte ausfüllen.», «Der Benutzername ist schon vergeben.») und eine Zusammenfassung «2 Angaben prüfen» mit einem Knopf je Feld; der Fokus geht auf die Zusammenfassung. Zurück mit ungespeicherten Eingaben fragt in einer Zeile, nie in einem Popup.
- [ ] **19.3** Telefon: Das Feld nimmt 079 …, 0041 … und +41 … an, schreibt beim Verlassen «+41 79 123 45 67» und sagt darunter, was gespeichert wird (höfliche Statusregion). Eine Nummer ohne die Rolle Stufenleitung wird beim Feld abgewiesen, mit Satz und Weg dorthin; der Server prüft weiter alles.
- [ ] **19.4** Kinder und Eltern werden per Suche zugeordnet (`personen-wahl.js`): Gewählte stehen als Liste mit «Entfernen: Name», die Suche zeigt bis zu 6 Treffer mit «Hinzufügen: Name», sagt «N weitere. Tippe weiter, um sie zu finden.» und bei der Obergrenze, warum nichts mehr geht. Hinzufügen und Entfernen werden angesagt; der Fokus bleibt im Suchfeld.
- [ ] **19.5** Personenliste: Filterleiste mit Suche, Tag, Rolle, Konto; gesetzte Filter stehen als Chips mit «Filter entfernen: …», «Zurücksetzen» und die Trefferzahl («5 von 19 Personen») in einer Statusregion. Die Spalte «Konto» zeigt genau einen Zustand (Aktiv, Startpasswort offen, abgelaufen, Deaktiviert) und den zweiten Faktor, die Rolle steht im Klartext («Stufenleitung», nie «leitung»).
- [ ] **19.6** Auswahlleiste: «3 gewählt» (Statusregion), «Tag setzen», «Tag entziehen» (`aria-expanded`) öffnen das Formular in der Leiste; die Änderung ist sofort in der Liste sichtbar, ein Toast bietet «Rückgängig» (Strg Z), die Anfragen gehen erst nach der Frist. Ein Fehler stellt den alten Stand wieder her und nennt, was nicht ging.
- [ ] **19.7** Gruppe: «Zurück» steht über dem Titel; die Mitgliederliste hat einen Live-Filter («2 von 4 Mitgliedern»), die Rolle lässt sich in der Zeile ändern (Enter speichert, Escape bricht ab, der Fokus kehrt zum Knopf zurück), «Entfernen» und «Hinzufügen» haben «Rückgängig». Nach dem Entfernen liegt der Fokus auf der Überschrift der Karte, nicht im Suchfeld, damit Strg Z wirkt.
- [ ] **19.8** Stufen: Die Stufenleitung ist eine Sortierliste in der Karte (Griff, Leertaste und Pfeiltasten, Knöpfe Nach oben und Nach unten als Alternative zum Ziehen nach WCAG 2.5.7, Ansage der Position, Toast mit «Rückgängig»). Die Chips nennen Kinder und Stufenleitung statt immer «Cevi-Logo»; «Keine Stufenleitung» ist Wort und Symbol. Das Logo hat eine Vorschau neben dem Feld; «Löschen» ist ein stiller Knopf mit «Rückgängig».
- [ ] **19.9** Dateifelder (Logo der Stufe, CSV des Imports) sind ein Knopf «Datei wählen» mit dem Namen der Datei oder «Keine Datei gewählt» in einer Statusregion; die echte Eingabe bleibt mit der Tastatur erreichbar, der Knopf zeigt den Fokusring, die Sprache hängt nicht vom Browser ab.
- [ ] **19.10** Import: Jeder weitere Schritt (Spalten, Rollen, Vorschau) ist eine Seite im Fluss mit «Schritt 2 von 4», Zurück und einer Schrittleiste (`aria-current="step"`, erledigte Schritte mit Haken, dem Wort «Erledigt» für Screenreader und einer Zusammenfassung). Browser-Zurück geht Schritt für Schritt zurück und behält die Eingaben; Zurück fragt nicht nach, die Datei bleibt im Schritt davor. Nach «Importieren» (zweistufiger Knopf) steht das Ergebnis mit den Startpasswörtern im Bereich, die Schritte sind geschlossen.
- [ ] **19.11** Überschriften und Werte passen: «Konto» statt «Status», «Zustand» bei den Kindern, «Öffnen» statt «Bearbeiten» bei den Gruppen, ein leerer Bereich hat einen Satz und keine zweite Hauptaktion neben der im Kopf.
- [ ] **19.12** Zielgrössen mindestens 44 Pixel (Sortierknöpfe im Tabellenkopf, Anzahl der Anlässe), mobil läuft keine Seite waagrecht über, Hell und Dunkel erreichen 4.5:1.

### Stand der Prüfung (#594)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 19.1 bis 19.12 bei 1440 und 390 Pixeln in Tag und Nacht (Messung von Überlauf, Zielgrössen und Namen aller Bedienelemente), Erfassen, Bearbeiten, Sammelaktion mit Rückgängig, Mitglieder (Filter, Hinzufügen, Entfernen, Rolle), Reihenfolge der Stufenleitung mit Knopf und Rückgängig, Import in beiden Wegen mit Browser-Zurück. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack nur an den Attributen), Ziehen mit der Maus und mit dem Finger, 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug, Seitenblättern ab 25 Zeilen, echter Upload des Stufenlogos (kein Speicher lokal).

## 20. Verwaltung: Bereich «Lager» (#592)

Dieser Abschnitt gilt für `#lager/…` (`lager*.js`, `lager.css`). Geprüft wird im Browser am PC und am Handy, in Tag und Nacht, mit Tastatur; die Abschnitte 1 bis 6 und 14 und 15 gelten sinngemäss.

- [ ] **20.1** Assistent «Neues Lager»: jeder Schritt hat eine Adresse, Browser-Zurück geht einen Schritt zurück und behält die Eingaben; die Zeitleiste ist eine nummerierte Liste (`aria-current="step"` am aktuellen Schritt), erledigte Schritte nennen «erledigt» und bieten «Ändern»; der Fokus liegt nach jedem Schrittwechsel auf dem Namen des Schritts.
- [ ] **20.2** Fehler im ersten Schritt: Zusammenfassung («3 Angaben prüfen», Knöpfe springen ins Feld), Fehler beim Feld mit Text (`role="alert"`, `aria-invalid`), nie nur Farbe. Beginn und Ende sind eigene Datumsfelder (Tippen und Kalender, Format TT.MM.JJJJ).
- [ ] **20.3** Personenwahl: Suchfeld mit Namen, Kästchen je Person mit Gesicht (Initialen) und Name, die Gewählten als Chips mit «Entfernen: Name» (44 Pixel), eine Statusregion nennt Trefferzahl und Ergebnis («2 Personen als Lagerleitung hinzugefügt»); der Knopf nennt die Zahl.
- [ ] **20.4** Mitgliederliste: die Rolle ändert sich im Auswahlfeld jeder Zeile (Label «Rolle von Name» für Screenreader), die Änderung und das Entfernen laufen mit «Rückgängig» (Abschnitt 14); am Handy ist jede Zeile eine Karte mit Spaltennamen vor dem Wert, ohne Seitenscroll.
- [ ] **20.5** Rechte der Rollen: Gruppen mit Überschrift (`h2`), je Recht ein Satz und drei Kästchen mit Namen «Leitung», «Team», «Lesen» (für Screenreader mit dem Satz des Rechts); kein technischer Schlüssel sichtbar; geänderte Zeilen tragen einen Balken und den Text «Geändert, noch nicht gespeichert»; die Leiste «N Änderungen» ist eine Region mit Statusansage, Speichern und Verwerfen sind Knöpfe; beim Neuladen mit offenen Änderungen fragt der Browser.
- [ ] **20.6** Aktivieren ohne Lagerleitung wird vorab erklärt (Knopf gesperrt, `aria-describedby` auf den Hinweis, Link «Mitglieder öffnen») statt mit einem Fehler zu enden. Aktivieren, Abschliessen, Archivieren und Wiederherstellen melden das Ergebnis mit «Rückgängig» und bleiben stehen, bis man sie schliesst.
- [ ] **20.7** Geteilter Knopf: Pfeiltasten, Pos1, Ende, Escape, Fokus zurück zum Pfeil (`aria-haspopup="menu"`, `aria-expanded`); Löschen als Karte am Ort: Fokus im Namensfeld, Escape bricht ab, «Endgültig löschen» wird erst mit dem richtigen Namen frei, die Frage steht in einer Statusregion.
- [ ] **20.8** Ausdrucke: je Zeile Name, Beschreibung, Dateiname, Typ «PDF»; beim Erstellen ein `progress`-Element mit Namen (unbestimmt, solange der Server keine Länge nennt) und «Abbrechen»; danach «Herunterladen» mit Dateiname und Grösse im Namen; Fehler mit Text und «Nochmals versuchen».
- [ ] **20.9** Vorlagen-Editor: Sortierliste mit Griff (Leertaste nimmt auf, Pfeile bewegen, Leertaste legt ab, Escape bricht ab) und Knöpfen «Nach oben» und «Nach unten» als Alternative ohne Ziehen (WCAG 2.5.7), Ansage der Position, «Entfernen» mit «Rückgängig» in der Zeile darunter; ungespeicherte Eingaben fragt die Seite im Fluss ab.
- [ ] **20.10** 1440, 1024, 390 Pixel, Hell und Dunkel: nichts scrollt waagrecht, Ziele mindestens 44 Pixel, Kontrast mindestens 4.5:1, kein Popup.

### Stand der Prüfung (#592)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 20.1 bis 20.9 (Menü und Karte, Tastatur am Griff, Entfernen, Rückgängig) und 20.10 (1440 und 390 Pixel, Hell und Dunkel, ohne Seitenüberlauf). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack: nur an den Attributen), Ziehen mit Maus und Finger am Handy, 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug, 1024 Pixel von Hand.

## 21. Verwaltung: Website, Seiten und Editor (#595)

Dieser Abschnitt gilt für `#website/seiten` und den Editor (`website-seiten.js`, `website-baumansicht.js`, `website-editor.js`, `website-bausteine.js`, `website-felder.js`, `website-veroeffentlichen.js`, `website-sichtbarkeit.js`, `website-unteransicht.js`). Die Abschnitte 11 und 15 gelten dazu; geprüft wird in Tag und Nacht, bei 1440 und 390 Pixeln, mit Tastatur.

### Seitenbaum

- [ ] **21.1** Die Liste ist ein Baum: `role="tree"`, jede Zeile `role="treeitem"` mit `aria-level`, `aria-posinset`, `aria-setsize`, bei Unterseiten `aria-expanded`; der Name der Zeile ist der Titel. Nur eine Zeile ist per Tab erreichbar (Roving Tabindex), ihre Knöpfe folgen ihr. Pfeil hoch und runter, Pos1, Ende, rechts (aufklappen, in die Unterseiten), links (zuklappen, zur Elternseite), Enter öffnet den Editor.
- [ ] **21.2** Die Ebene steht nie nur als Linie da: `aria-level`, Einrückung und Führungslinien zeigen sie; die Linien sind `aria-hidden`.
- [ ] **21.3** Verschieben ohne Ziehen (WCAG 2.5.7): Leertaste nimmt eine Zeile auf, Pfeil hoch und runter ordnet unter Geschwistern, Pfeil rechts macht sie zur Unterseite der Seite darüber, Pfeil links stellt sie auf die Ebene der Elternseite, Leertaste legt ab, Escape bricht ab; jeder Schritt wird angesagt («Position 2 von 4, unter …»). Dieselben Schritte stehen im Menü «Mehr».
- [ ] **21.4** Ziehen am Griff (Maus, Finger, Stift): Das Ziel zeigt eine Linie davor, einen Rahmen für «darunter» oder eine Linie danach; ein unmögliches Ziel (unter sich selbst, zu tief) ist gestrichelt, der Grund steht danach in einer Meldung. Nahe am Rand scrollt die Seite mit.
- [ ] **21.5** Das Verschieben läuft über «Rückgängig» (Toast, Strg+Z); höchstens eines wartet zugleich. Ändert sich dabei die Adresse einer veröffentlichten Seite oder ihrer Unterseiten, sagt eine Meldung es und bietet (mit dem Recht «Weiterleitungen verwalten») «Weiterleitung anlegen» an; ohne das Recht verweist sie an die Abteilungsleitung.
- [ ] **21.6** F2 und «Umbenennen» im Menü ersetzen den Titel durch ein Feld (Enter speichert, Escape bricht ab, Fokus kehrt zur Zeile zurück); Entf löscht mit Toast und «Rückgängig». Suche und Filter blenden Zeilen aus, behalten aber die Elternseiten der Treffer sichtbar; solange sie aktiv sind, lässt sich der Baum nicht ordnen (die Meldung sagt es).
- [ ] **21.7** Ziele mindestens 44 Pixel (Griff, Faltknopf, Name, Knöpfe), Fokus sichtbar (3 Pixel), Zeilenhöhe 64 Pixel; bei 390 Pixeln liegen Chips und Zeit unter dem Namen.

### Neue Seite

- [ ] **21.8** Die Vorlagen sind Radiokarten mit Skizze (`aria-hidden`) und Name; die Adresse folgt dem Titel, bis die Person sie ändert; der Stand («Die Adresse ist frei.», «… schon vergeben …») steht mit Symbol und Text in einer Statusregion beim Feld. Der feste Anfang zeigt die Adresse der Elternseite.

### Editor

- [ ] **21.9** Kopf: Titel, Zeichen des Standes und «Umbenennen» (Name beginnt mit dem sichtbaren Text, F2 geht ausserhalb von Feldern); darunter der Speicherstand als Text («Gespeichert vor 2 Min.», «Änderungen noch nicht gespeichert», «Wird gespeichert …»), der Takt rechnet im Browser und belastet den Server nicht.
- [ ] **21.10** «Veröffentlichen» ist ein geteilter Knopf: Menü mit Pfeiltasten, Escape, Tippen springt; «Entwurf speichern», «Versionen ansehen», «Seite zurückziehen» (gesperrt, solange die Seite nicht online ist).
- [ ] **21.11** Versionen sind eine Zeitleiste (`ol`, neueste oben): Der Punkt ist `aria-hidden`, die veröffentlichte Version trägt zusätzlich das Wort «Veröffentlicht», der heutige Entwurf steht ganz oben, solange er nicht veröffentlicht ist. Es gibt keinen Vergleich der Texte.
- [ ] **21.12** «Zugriff» (Sichtbarkeit und Bearbeiter) ist ein Panel neben dem Editor, nicht modal, Escape schliesst es. Eine Gruppe oder Person lässt sich im Panel selbst hinzufügen, nie auf einer Seite über dem Panel.
- [ ] **21.13** Bild wählen und Zugriff eines Bausteins ersetzen den Inhalt des Baustein-Panels (Knopf «Zurück zum Baustein», Escape); es gibt nie ein zweites Panel über dem ersten. Das Formular des Bausteins bleibt dabei erhalten.
- [ ] **21.14** Bausteine und Karten (Galerie, Karussell, Eckdaten, Kontaktkarte) sind Sortierlisten: Griff mit Maus oder Finger, am Griff Leertaste und Pfeile, Knöpfe «Nach oben» und «Nach unten»; Löschen von Bausteinen mit Toast und «Rückgängig».
- [ ] **21.15** Ungespeicherte Einstellungen (Adresse, Elternseite) zählen wie der Entwurf: Ein Link oder das Schliessen des Tabs fragt zuerst («Speichern und verlassen», «Verlassen», «Bleiben»).
- [ ] **21.16** Hell, Dunkel, erzwungene Farben; 1440, 1024, 390 Pixel, 200 Prozent Zoom; mit «Bewegung reduzieren» keine Übergänge am Faltknopf und an den Zeilen.

### Stand der Prüfung (#595)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 21.1 bis 21.9 und 21.11 bis 21.15 (Tastatur, Ziehen mit der Maus, Rückgängig, Weiterleitungs-Hinweis), Tag und Nacht, 1440, 1024 und 390 Pixel (Messung: kein Seitenüberlauf, keine Ziele unter 44 Pixel). **Nicht geprüft:** Screenreader (NVDA, VoiceOver), Ziehen mit dem Finger, 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug, erzwungene Farben.

## 22. Verwaltung: Navigation, Bereichsauswahl, Rolle im Kopf und Befehlspalette (#602)

Dieser Abschnitt gilt für `navigation.js`, `rahmen.js` (Marke, Bereichsauswahl, Befehlspalette), `geruest.css` und die Rolle im Kopf (`admin.js`). Geprüft wird im Browser mit je einem Konto der Abteilungsleitung, des Entwicklers, eines Webmasters und einer Stufenleitung, bei 1440, 960 und 390 Pixeln, in Tag und Nacht, mit Tastatur.

- [ ] **22.1** Jeder Eintrag des Menüs führt zu einer Seite, die die Person öffnen darf: Die Stufenleitung sieht «Einstellungen» der Website nicht. «Komponenten» und «Anmeldungen» stehen in keinem Menü mehr (#607). Das Menü ist nur Anzeige; der Server prüft jede Route.
- [ ] **22.2** Der Kopf nennt die Rolle der Person («Abteilungsleitung», «Stufenleitung Pilami», «Website-Redaktion», «Wartung der Website»), nie das Sammelwort «Redaktion».
- [ ] **22.3** Unter 960 Pixeln ersetzt die Bereichsauswahl beide Leisten. Die Zeile ist ein Knopf mit `aria-expanded` und `aria-controls`, 52 Pixel hoch, und nennt Bereich und Seite als Text; das Panel wächst aus der Zeile, das geschlossene Panel ist `inert` (kein Fokus, wird nicht vorgelesen).
- [ ] **22.4** Tastatur der Bereichsauswahl: Enter und Leertaste öffnen, der Fokus geht auf die aktuelle Seite, Pfeil hoch und runter wechseln die Einträge, Escape schliesst und gibt den Fokus an die Zeile zurück, ein Klick daneben schliesst. Die aktuelle Seite trägt `aria-current="page"` und einen Balken (nie nur Farbe); Zähler offener Dinge stehen als Zahl mit «offen».
- [ ] **22.5** Mit «Bewegung reduzieren» öffnet und schliesst das Panel ohne Übergang; in erzwungenen Farben ist die aktuelle Seite unterstrichen.
- [ ] **22.6** Die Wartungsseite heisst «Wartung und Sperre» (Menü und Überschrift), nicht «Plattform».
- [ ] **22.7** Zweispalter (Einstellungen, Samstagsangaben der Stufen, Mitteilungen, Artikel, Person): kein eigener Scrollbereich; die rechte Spalte (Vorschau, Bild) bleibt beim Scrollen stehen und ist nie höher als das Fenster; unter 1100 Pixeln steht alles in einer Spalte.
- [ ] **22.8** Suche (Strg oder Cmd + K, auch der Knopf «Suchen» im Kopf): ein Dialog mit Namen, Suchfeld mit `role="combobox"`, Trefferliste mit `role="listbox"` und `aria-activedescendant`, Pfeiltasten, Enter öffnet, Escape schliesst und gibt den Fokus zurück; die Zahl der Treffer steht in einer Statusregion. Das Kürzel steht im Knopf. Alle Prüfpunkte der Suche stehen in Abschnitt 30.

## 25. Verwaltung: Kalender mit Umschalter, Anlässe mit Reitern (#608)

Dieser Abschnitt gilt für `termine-kalender.js`, `termine-monat.js`, `termine-anlaesse.js` (Liste, Anlass), `anlass-anmeldungen.js`, `anlass-felder.js`, `anlass-gemeinsam.js` und `termine-anlaesse.css`. Er ersetzt, wo er etwas anderes sagt, 12.16, 12.17 und 12.24. Geprüft wird im Browser mit dem Konto der Abteilungsleitung und der Demo-Abteilung, bei 1440, 1920 und 390 Pixeln, in Tag und Nacht, mit Tastatur, «Bewegung reduzieren» und erzwungenen Farben.

- [ ] **25.1** Kalender, Umschalter: «Alle Termine» und «Meine Termine» stehen oben im Kopf als Gruppe von Knöpfen mit `aria-pressed` (genau einer gedrückt; Zustand auch ohne Farbe lesbar, der gedrückte Knopf hat Hintergrund und kräftige Schrift). Er gilt für Monat und Liste, filtert im Browser (die Antwort von `GET /api/v1/termine/alle` trägt `meine`) und legt keinen Verlaufseintrag an; die Adresse bekommt «meine» (`#termine/kalender/meine/2027-01`) und gilt auch als Direktadresse. Ein Satz unter dem Kalender sagt, was «Meine Termine» sind. Ist nichts zu sehen, steht ein Satz dafür («Für deine Gruppen steht in diesem Monat nichts an.»), nicht ein leeres Raster ohne Wort.
- [ ] **25.2** Kalender, nur das Nötige: In der Monatsansicht stehen Monat, «Heute», die Auswahl der Gruppe und «Monat | Liste» in einer Zeile; es gibt keine Suche und keine Trefferzahl. Die Liste hat Suche, Gruppe und Zeitraum, aber keine Spalte «Quelle» (alle Termine kommen aus Outlook, das sagt der Satz unter dem Kalender). Die Auswahl der Gruppe hat eine Beschriftung für Screenreader, auch wenn sie nicht sichtbar steht.
- [ ] **25.3** Anlässe, Liste: Die Anlässe stehen nach Monat gruppiert, kommende zuerst mit dem frühesten Termin oben, vergangene danach mit dem neuesten oben. Eine Karte ist ein einziger Link (Name = Titel des Anlasses, Beschreibung = Zeit, Stand der Anmeldung und Frist); sie ist mindestens 88 Pixel hoch, der Fokus ist sichtbar. Der Block mit Datum ist `aria-hidden` (das Datum steht in der Beschreibung als Text). Stand der Anmeldung als Wort mit Symbol («Anmeldung offen», «Frist vorbei», «Anmeldung geschlossen», «Termin vorbei»), nie nur Farbe. Die Zahl «angemeldet» steht als Zahl und Wort. «Kommend | Vergangen | Alle» ist eine Gruppe von Knöpfen mit `aria-pressed` und der Zahl; die Suche erscheint erst ab 12 Anlässen. Unter 60 rem steht die Karte in einer Spalte, Chip und Zahl unter dem Titel.
- [ ] **25.4** Anlass, Reiter: «Übersicht», «Anmeldungen», «Zusatzfelder», «Einstellungen» sind Links in einer `nav` mit Namen; der aktive trägt `aria-current="page"` und einen Balken. Jeder Reiter hat eine eigene Adresse (`#anlaesse/<id>`, `…/anmeldungen`, `…/felder`, `…/einstellungen`); Zurück führt zum vorherigen Reiter. Die Zähler im Reiter sind rund und zentriert. Anmeldungen gibt es nur über den Anlass: Die alten Adressen `#anlaesse/anmeldungen` und `…/anmeldungen/<id>` leiten auf die Liste der Anlässe bzw. auf den Reiter «Anmeldungen» des Anlasses (ersetzen den Verlaufseintrag, Zurück führt nicht im Kreis).
- [ ] **25.5** Rückmeldungen (Reiter «Übersicht»): Angemeldet und Abgemeldet stehen als Zeile mit Name, Zahl und Prozent im Text. Der Balken liegt hinter der Zeile (`aria-hidden`), wächst und zählt nur bei erlaubter Bewegung (mit «Bewegung reduzieren» steht alles sofort da). Prozente ergeben immer 100. Wer nicht geantwortet hat, kennt Cevi OS nicht; das sagt ein Satz. Die Zeile mit dem grösseren Wert ist kräftig und hat einen Rahmen, die Zahlen tragen die Aussage.
- [ ] **25.6** Reiter «Anmeldungen»: Suche, Stand (Alle, Angemeldet, Abgemeldet mit Zahl) und der Export stehen über der Tabelle. Der Export ist eine Zeile, kein Fenster: Dateiname, Format, Stand, Hinweis auf Personendaten und das führende Hochkomma; der Knopf wechselt von «Export erstellen» über «Abbrechen» zu «Herunterladen», Fortschritt und Fehler stehen als Text. Beim Wechsel des Stands geht eine fertige Datei zurück auf «bereit».
- [ ] **25.7** Reiter «Einstellungen»: eine Seite im Fluss, keine Dialoge. Die Speicherleiste unten erscheint erst, wenn sich etwas ändert, und nennt die Zahl («2 Änderungen noch nicht gespeichert.»); «Verwerfen» stellt den Stand her. Gibt es Anmeldungen, ist «Wer meldet sich an?» gesperrt und ein Satz sagt warum. «Anlass löschen» ist mit Anmeldungen gesperrt und der Satz nennt die Zahl; sonst läuft es über «Rückgängig» (Toast).
- [ ] **25.8** Wechsel und Laden: Der Anlass lädt als Skeleton in der Form der Seite; der Wechsel zwischen Reitern fragt innerhalb von 30 Sekunden nicht neu (der Speicher wird nach jeder Änderung geleert). Fehler stehen mit «Nochmals versuchen». Karten blenden nur bei erlaubter Bewegung ein (höchstens 160 ms Versatz).
- [ ] **25.9** Zielgrössen und Kontrast: Karten, Reiter (48 px), Knöpfe und Filter sind mindestens 44 Pixel hoch; Text auf den Flächen der Zeilen und Karten erreicht 4.5:1 in Tag und Nacht; in erzwungenen Farben haben Karten und Rückmeldungszeilen einen Rahmen.
- [ ] **25.10** Kategorien: Der Hinweis auf der Seite sagt, dass Kategorien in Outlook angelegt werden und Cevi OS nur liest, und was die Zuordnung hier leistet.

## 23. Verwaltung: Breite, Übersicht, Zähler, Auswahlfelder (#607)

Dieser Abschnitt gilt für das Gerüst (`admin.css`, `geruest.css`, `navigation.js`) und die Übersicht (`uebersicht*.js`, `uebersicht.css`). Die Abschnitte 15, 16 und 22 gelten weiter.

- [ ] **23.1** Breite: Kopf, Bereichsleiste, Unterleiste, Hinweisband, Seitenkopf und Inhalt haben bei 1440, 1920 und 2560 Pixeln dieselbe linke und rechte Kante wie `.wrap` der Website (Maximalbreite 105 rem, Seitenrand `clamp(1rem, 4vw, 4.5rem)`); gemessen über `getBoundingClientRect` auf allen Seiten der Navigation. Raster, Tabellen, Kalender, Zweispalter und Seiten im Fluss laufen nicht über den Rand und scrollen die Seite nicht waagrecht.
- [ ] **23.2** «Jetzt zu tun»: Jede Zeile ist ein Link mit dem Namen aus Zahl, Titel, Satz und Aktion (16.2), mindestens 56 Pixel hoch; ohne Recht auf die Zielseite steht die Zeile ohne Aktion und ohne Link. Weiter: 32.1.
- [ ] **23.3** Kennzahlen: Jede Zelle nennt Titel, Zahl mit Einheit und (wo es einen Vergleich gibt) die Veränderung mit Pfeil, Vorzeichen und Worten. Die Zahl hat Kontrast 4.5:1 in Hell und Dunkel. Weiter: 32.3.
- [ ] **23.4** Zustand: Jeder Dienst (Website, Kalender-Abgleich) steht mit Name, Zustand als Wort mit Symbol und einem Satz; Verweis mindestens 44 Pixel hoch. Fehlt das Recht, fehlt der Dienst.
- [ ] **23.5** Zähler in der Unterleiste und der Bereichsauswahl sind Kreise (24 Pixel, Zahl mittig, bis 99); der Screenreader hört «<Zahl> offen» nach dem Namen. Der Kreis hat in erzwungenen Farben einen Rand.
- [ ] **23.6** Auswahlfelder: Alle `select` der Verwaltung werden zum Auswahlfeld der Website (`auswahl.js`, dieselben Masse: 52 Pixel hoch, 17 Pixel, Radius 12, Liste mit Haken); kein `select` zeigt die Liste des Browsers, kein Auswahlfeld hat `multiple`. Oben in den Listen (Filterleiste) stehen sie wie bei den Terminen der Website: 220 Pixel breit, Beschriftung 16 Pixel mit 8 Pixel Abstand, Pfeil in der leisen Textfarbe. Geprüft per Durchgang durch alle Seiten der Navigation.
- [ ] **23.7** Navigation: «Komponenten» und «Anmeldungen» stehen nirgends im Menü; `#anlaesse/anmeldungen` führt zur Liste der Anlässe, mit Kennung zum Anlass.

### Stand der Prüfung (#607)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 23.1 (alle 33 Seiten der Navigation, 1440, 1920 und 2560 Pixel, Hell), 23.2 bis 23.5 und 23.7 (Übersicht in Hell und Dunkel bei 1440 und 2560 Pixeln, Zähler vermessen), 23.6 (Durchgang durch alle Seiten, Masse der Felder verglichen). **Nicht geprüft:** Screenreader, 200 Prozent Zoom am Gerät, Messung der Kontraste mit einem Werkzeug, Dunkel bei 1920 Pixeln auf allen Seiten.

## 27. Verwaltung: System, Verlauf der Anfragen und Samstagsangaben der Stufen (#606)

Dieser Abschnitt gilt für `system.js` (Kennzahlen, Verlauf, Streifen, Liste der letzten Fehler), `system.css` und den Einleitungstext in `website-stufenfakten.js`. Er ergänzt 17.6. Geprüft wird bei 390, 1440, 1920 und 2560 Pixeln, in Tag und Nacht, mit Tastatur.

- [ ] **27.1** Der Umschalter «Letzte Stunde» und «Letzte 24 Stunden» ist eine Gruppe mit Namen («Zeitraum»); der gewählte Knopf trägt `aria-pressed`. Nach dem Wechsel liegt der Fokus auf dem gewählten Knopf, nicht im Nichts.
- [ ] **27.2** Jede Kennzahl nennt Titel, Zahl und Veränderung als Text («Stunde davor: 380 (+8 %)»). «Erhöht» bei den Serverfehlern steht als Chip mit Wort, nie nur als Farbe. Ohne Vergleichsgrundlage (die API läuft erst kurz) steht der Satz «Noch kein Vergleich», nie eine erfundene Zahl. Einen Vergleich mit dem Vortag gibt es nicht: Die API behält nur 24 Stunden.
- [ ] **27.3** Die Säulen haben einen Satz mit allen Werten (`role="img"`), eine Ablesung mit Zeiger und Pfeiltasten (Text darunter, `aria-live`) und eine Tabelle («Als Tabelle anzeigen», auch bei den Serverfehlern in der Spalte «Anteil 5xx»). Achsenwerte (0, Mitte, Höchstwert) und Zeitmarken sind Zierde; der Satz nennt alle Werte.
- [ ] **27.4** Der Streifen «Serverfehler je Stunde» zeigt den Zustand nicht nur über die Farbe: Die Höhe trägt ihn mit (leer 2, ruhig 5, vereinzelt 10, erhöht 16), Legende und Ablesung nennen das Wort («keine Serverfehler», «vereinzelte Serverfehler», «Serverfehler erhöht» mit Zahl und Anteil). Er ist mit Tab erreichbar und mit Pfeiltasten lesbar.
- [ ] **27.5** Alle Texte der Achsen erreichen 4.5:1 (Token `--leise` auf Karte), in Tag und Nacht; in erzwungenen Farben sind Fehler und «vereinzelt» umrandet, «erhöht» ist gefüllt.
- [ ] **27.6** «Letzte Fehler» ist eine Liste: Status als Chip mit Wort und Zahl, Methode und Route, die Zeit als «vor 7 Minuten» in einem `time`-Element mit Datum im Titel. Die Tabelle mit allen Fehlern steht im Reiter «Anfragen».
- [ ] **27.7** «Bewegung reduzieren»: Die Säulen und Zellen wachsen nur bei erlaubter Bewegung ein. 390 Pixel: Kennzahlen untereinander, die Achse zeigt Anfang und «jetzt», nichts scrollt waagrecht.
- [ ] **27.8** Samstagsangaben der Stufen: Die Einleitung sagt in drei Sätzen, was die Seite ist (Treffzeit, Treffpunkt, Schlusszeit, Schlussort, Mitnehmen je Treffen), wo man die Wirkung sieht (Stufenseite der Website, Tafel zum nächsten Datum) und dass nichts veröffentlicht werden muss. Zeilenlänge höchstens 44 rem, Schrift 16 Pixel.

### Stand der Prüfung (#606)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 27.1 bis 27.4 und 27.6 bis 27.8 bei 390, 1440 und 1920 Pixeln, Hell und Dunkel, Tastatur (Umschalter, Ablesung, Streifen, Tabelle). Die Verläufe über 24 Stunden mit nachgestellten Antworten der API (Beispieldaten), denn die Zahlen der API leben nur im Arbeitsspeicher und fangen nach jedem Neustart bei null an; die echten Zahlen der Kopie zeigen nur die letzten Minuten. **Nicht geprüft:** Screenreader (NVDA, VoiceOver), 200 Prozent Zoom am Gerät, 2560 Pixel, Kontrastwerte mit einem Messwerkzeug, erzwungene Farben im Browser.

## 24. Verwaltung: Import-Schritte, Stufen und Kinder (#604)

Dieser Abschnitt gilt für `schrittfolge.js` und `import.js` (Schrittfolge nach dem Muster «stepper-form», eigener Bau), `stufen.js` (Stufenkarten) und `kinder.js` (Liste und Seite «Kind»). Geprüft wird im Browser mit der Abteilungsleitung bei 320 bis 2560 Pixeln, Tag und Nacht, mit Tastatur und mit «Bewegung reduzieren».

- [ ] **24.1** Jeder Schritt der Schrittfolge hat einen von vier Zuständen: offen, aktuell, erledigt, Fehler. Der Zustand steht nie nur in der Farbe: Der Marker trägt die Nummer, den Haken oder das Warnsymbol, die Überschrift des Schritts nennt den Zustand für Screenreader («Spalten, erledigt»), ein Fehler trägt zusätzlich den Chip «Fehler».
- [ ] **24.2** Der aktuelle Schritt hat `aria-current="step"`; beim Wechsel geht der Fokus auf seine Überschrift. Die Zeile «Schritt 2 von 4: Spalten» ist eine Statusregion, der Balken darüber ist nur Zierde (`aria-hidden`).
- [ ] **24.3** Erledigte Schritte zeigen eine Zusammenfassung in einem Satz und den Knopf «Ändern» (44 Pixel, der Name nennt den Schritt: «Spalten ändern»). Offene Schritte zeigen nur Name und kurzen Hinweis, nichts ist verborgen, was eine Eingabe braucht.
- [ ] **24.4** Browser-Zurück und -Vor gehen einen Schritt, die Eingaben bleiben. Ein Eintrag aus einem früheren Besuch führt nie weiter als die Eingaben reichen. Nach dem Import führt «Zurück» nicht in die Vorschau: ein zweiter Import derselben Zeilen ist so nicht möglich.
- [ ] **24.5** Ein Fehler steht im Schritt, in dem er entstand, als Meldung mit `role="alert"` und nimmt den Fokus. Eingaben bleiben erhalten; «Weiter» versucht es nochmals.
- [ ] **24.6** Vorschau: Die Filter zeigen die Zahl je Zustand und «Zu prüfen» für Doppelte und Ungültige; jede Zeile nennt ihren Zustand als Wort mit Symbol und den Grund. Zeilen mit Warnung oder Fehler tragen zusätzlich einen Balken am Rand. Schmal steht jede Zeile als Karte; leere Zellen («Art», «Benutzername») fallen dort weg.
- [ ] **24.7** Der Import bleibt ein Knopf mit zwei Stufen («Wirklich 10 Kinder und 2 Leitende anlegen?»), kein Popup. Die Startpasswörter erscheinen nur im letzten Schritt und werden beim Verlassen gelöscht.
- [ ] **24.8** Bewegung (Einblenden des Schritts, Marker, Linie) nur unter `prefers-reduced-motion: no-preference`; sonst wechselt alles ohne Übergang.
- [ ] **24.9** Stufen: Die Karten sind gleich hoch, die Aktionen stehen unten. Ohne eigenes Logo steht der Anfangsbuchstabe im Kasten (Zierde, `aria-hidden`); der Name steht als Überschrift. Die Stufenleitung steht einmal (Liste oder Name), nicht zusätzlich als Zähler; ohne Leitung steht ein ruhiger Satz, kein Warn-Chip.
- [ ] **24.10** Stufenleitung umsortieren geht per Ziehen am Griff, mit Tastatur und mit den Knöpfen «Nach oben» und «Nach unten» (WCAG 2.5.7); die Änderung wird angesagt und lässt sich zurücknehmen.
- [ ] **24.11** Kinder: Die Spalte heisst «Zugang», der Filter «Ohne Zugang». Ein Kind ohne verknüpften Elternteil ist ein Hinweis (Text «hat keinen Zugang: Ohne verknüpften Elternteil kann niemand es in der App sehen»), keine Warnung und kein Fehler. In der Liste steht dafür ruhiger Text statt eines Chips je Zeile.
- [ ] **24.12** «Kind» ist wie die Person eine Seite im Fluss mit eigener Adresse im Verlauf (Karten «Angaben», «Stufe», «Eltern und Zugang», rechts das Kind mit Zustand); Speichern und Abbrechen stehen in der Leiste unten, ungespeicherte Eingaben fragt der Fluss ab.

## 28. Website: Kontaktkarte und Fuss (#605)

Gilt für die Kontaktkarte am Ende der Startseite und für den Fuss jeder Seite (`src/website/kontakt.ts`, `public/website/fuss.css`). Vorbereitung: Startseite mit Kontaktkarte öffnen, einmal mit und einmal ohne `KONTAKT_TELEFON`; Tag und Nacht, 320, 390, 768, 1024, 1440 und 2560 px.

- [ ] **28.1** Die Kontaktkarte ist ein `section` mit einer Überschrift (`h2`); die Gruppe «Weitere Informationen» hat eine Überschrift eine Ebene tiefer. Die Angaben stehen in `address` als Liste (E-Mail, Telefon, Anschrift).
- [ ] **28.2** Die Symbole der Zeilen (E-Mail, Telefon, Ort) sind `aria-hidden`; die Art («E-Mail», «Telefon», «Anschrift») steht als sichtbarer Text in derselben Zeile, ein Screenreader liest Art und Wert zusammen als Link.
- [ ] **28.3** E-Mail und Telefon sind Links über die ganze Zeile (mindestens 44 px, tatsächlich 80 px hoch); «E-Mail schreiben», «Anrufen», «Nach oben», die Verweise und jede Zeile des Fusses sind mindestens 44 px hoch (gemessen bei 320 bis 2560 px). Die Anschrift ist kein Link.
- [ ] **28.4** Fehlt die Telefonnummer, fehlen «Anrufen» und die Zeile Telefon ohne Lücke und ohne leeren Link; ohne Bild steht rechts eine getönte Fläche mit den Angaben; ohne Angaben und Person entfällt die Karte.
- [ ] **28.5** Tastatur: Alle Links der Karte und des Fusses sind in Leserichtung erreichbar (Karte: Knöpfe, E-Mail, Telefon, Verweise; Fuss: Marke, Bereiche, Kontakt, Rechtliches, «Nach oben»), der Fokusring ist überall sichtbar (auf Blau in Weiss) und wird nie verdeckt.
- [ ] **28.6** Kontrast hell und dunkel: Text mindestens 4.5:1 (Arten und Verweise auf getönter Fläche, Kontaktzeilen, Fuss auf Blau mit gedämpftem Weiss), Symbol-Kacheln und Pfeile mindestens 3:1; Zustand (Hover) nie nur über Farbe, die Zeile ist ein Link mit Pfeil.
- [ ] **28.7** Der Fuss hat sichtbare Überschriften für Bereiche, Kontakt und Rechtliches; die beiden Navigationen («Bereiche», «Rechtliches») tragen `aria-labelledby`, es gibt genau ein `footer`.
- [ ] **28.8** Bewegung nur ohne «Bewegung reduzieren»: Hintergrund der Zeile, Pfeile der Kontaktzeilen und der Bereiche, Pfeil von «Nach oben»; ohne Bewegung bleibt alles sichtbar und benutzbar.
- [ ] **28.9** Reflow: bei 320 px und bei 200 Prozent Zoom kein seitliches Scrollen; die lange E-Mail-Adresse bricht um, statt abzuschneiden; das Bild hat ein `alt` (Alt-Text des Mediums) oder ist Zierde.
- [ ] **28.10** Erzwungene Farben: der Fuss hat eine Kante, Text und Links bleiben lesbar; der Pfeil der Bereiche ist redundant (die ganze Zeile ist der Link).

## 30. Verwaltung: Suche mit reichen Treffern (#611)

Dieser Abschnitt gilt für `befehlspalette.js` und den Block «Suche» in `geruest.css`. Geprüft wird im Browser mit je einem Konto der Abteilungsleitung, eines Webmasters und einer Stufenleitung, bei 390, 720 (entspricht 200 % Zoom bei 1440), 1024, 1440 und 2560 Pixeln, in Tag und Nacht, mit Tastatur und mit «Bewegung reduzieren».

- [ ] **30.1** Öffnen und Schliessen: Strg oder Cmd + K und der Knopf «Suchen» öffnen die Suche, der Fokus liegt im Feld. Escape, die Schaltfläche «Suche schliessen» und ein Klick neben die Karte schliessen sie, der Fokus kehrt an den Auslöser zurück. Sie ist die einzige Überlagerung der Verwaltung.
- [ ] **30.2** Aufbau für Screenreader: Feld mit `role="combobox"` (`aria-controls`, `aria-activedescendant`), Treffer als `role="listbox"` mit Gruppen (`role="group"`, benannt durch die Gruppenzeile) und Optionen. Die Zahl der Treffer steht in einer Statusregion (nur mit Frage). Jede Zeile trägt ihre Angaben als Text: Name, Cevi-Name, Rollen, Tags, Konto-Zustand; Zustände sind Chips mit Wort und Symbol, nie nur Farbe.
- [ ] **30.3** Tastatur: Pfeil hoch und runter wählen (rund herum), Bild auf und Bild ab springen zur ersten Zeile der vorigen oder nächsten Gruppe, Strg + Pos1 und Strg + Ende zur ersten und letzten Zeile, Enter öffnet. Tab erreicht die Reiter, Pfeil links und rechts wechseln sie, Pfeil runter geht zurück ins Feld, ein Buchstabe im Reiter geht ins Feld.
- [ ] **30.4** Reiter «Alle», «Seiten», «Personen», «Gruppen», «Termine», «Anlässe», «Website», «Lager» (je nach Recht) tragen die Zahl der Treffer; solange eine Quelle lädt, steht «…» statt einer täuschenden Null. Jeder Reiter ist 44 Pixel hoch; auf schmalen Bildschirmen scrollt die Leiste waagrecht und bleibt per Tab erreichbar.
- [ ] **30.5** Treffer im Text sind getönt und fett (`mark`), nie nur farbig; in erzwungenen Farben tragen sie einen Rand. Umlaute und Grossschreibung zählen nicht («uebersicht» findet «Übersicht»).
- [ ] **30.6** Leerzustand: Ohne Frage steht ein Satz, was sich finden lässt («Tippe einen Namen oder Cevi-Namen, eine Seite, …»), darunter «Zuletzt benutzt», die Aktionen und die ersten Seiten. Ohne Treffer steht «Nichts gefunden für «…»» mit demselben Satz. Während Quellen laden, stehen «Lade Personen …» und ruhige Platzhalter; scheitert eine, steht ein Hinweis mit Symbol (`role="alert"`), und die übrigen Gruppen bleiben benutzbar.
- [ ] **30.7** Breite: Die Karte ist so breit wie der Inhalt der Website (bis 105 rem, Seitenrand `clamp(1rem, 4vw, 4.5rem)`), mobil volle Breite abzüglich des Rands. Kein waagrechter Seitenscroll bei 390, 720, 1024, 1440 und 2560 Pixeln. Eine Zeile hat fünf Felder (Bild oder Symbol, Titel mit Zusatz, Angabe, Chips, Zustand) in festen Spalten; unter 56 rem stehen sie untereinander.
- [ ] **30.8** Zielgrössen: Reiter und Schaltflächen sind mindestens 44 Pixel hoch, Zeilen mindestens 48 Pixel. Die Tastenhilfe im Fuss entfällt auf Geräten ohne Tastatur und schmal.
- [ ] **30.9** Bewegung: Das Einblenden der Karte und das Pulsieren der Platzhalter laufen nur ohne «Bewegung reduzieren». Die Liste scrollt nicht weich.
- [ ] **30.10** Bilder: Das Profilbild lädt erst, wenn die Zeile sichtbar wird (`loading="lazy"`); bis dahin und bei einem Fehler stehen die Initialen im Kreis.
- [ ] **30.11** Rechte und Daten: Eine Gruppe erscheint nur, wenn die Navigation der Person die zugehörige Seite zeigt (Stufenleitung und Webmaster: nur Seiten der Verwaltung und Website-Seiten). Kinder kommen nie vor. Im Speicher stehen nur Name, Cevi-Name, Benutzername, Bild, Rollen, Tags und Konto-Zustand einer Person, nie Startpasswort, Telefon oder Kinder.
- [ ] **30.12** Last: Beim Öffnen läuft höchstens eine Abfrage je Quelle, nie eine je Tastendruck; das Ergebnis gilt fünf Minuten, hat die Liste «Personen» ihre Daten schon, fragt die Suche dort nicht nochmals.

## 29. Verwaltung: Person, Stufen zuweisen und Website nach Rolle (#610)

Dieser Abschnitt gilt für das Personenformular (`personen-blatt.js`, `personen.css`) und die Gruppe einer Stufe (`tags-detail.js`). Geprüft wird im Browser mit der Abteilungsleitung, bei 1440 und 390 Pixeln, in Tag und Nacht, mit Tastatur.

- [ ] **29.1** «Rechte und Rollen»: Die Karte hat zwei Gruppen mit gleicher Zwischenüberschrift: «Abteilung» (eine Zeile: Chip «Abteilungsleitung», Segment «Nein | Ja» als `radiogroup` mit Namen «Abteilungsleitung: <Person>», Pfeiltasten, Fokus bleibt nach der Änderung, Zielgrösse mindestens 44 Pixel) und «Stufen und Rollen». Beide Zeilen haben dieselbe Form, denselben Abstand und dieselbe Segmentwahl; die Abteilungsleitung ist kein loses Kontrollkästchen (#799). Stufen stehen nicht vorab da. Die Karte zeigt nur zugewiesene Stufen als Zeilen (Stufe als Chip mit Text, Rolle als Segment mit Radioknöpfen in einer `radiogroup` mit Namen «Rolle in <Stufe>», «Entfernen»). Eine Person hat keine, eine oder mehrere Stufen; eine Stufe nur einmal.
- [ ] **29.2** «Stufe hinzufügen»: Auswahl «Stufe» und «Rolle in der Stufe» (eigene Auswahlfelder, Tastatur), dazu der Knopf. Fehlt eine Angabe, steht die Meldung am Feld («Wähle eine Stufe.», «Wähle eine Rolle.»), das Feld hat `aria-invalid` und den Fokus. Die Rolle hat keine Vorgabe: Es wird nie still eine Rolle mit Rechten gesetzt. «Teilnehmer» gibt es nicht, weil das Rechtemodell für Personen mit Konto nur Leitung und Stufenleitung kennt.
- [ ] **29.3** «Entfernen» streicht die Zeile durch und schreibt «wird beim Speichern entfernt» (nie nur Farbe); der Knopf heisst dann «Rückgängig». Eine Stufe, die erst neu dazukam, ist mit dem Entfernen weg. Jede Änderung steht in einer Statusregion (`role="status"`), der Fokus bleibt bei der Zeile oder geht zur Auswahl; nichts gilt vor «Speichern», das Formular fragt beim Verlassen.
- [ ] **29.4** Der Hinweis zur Website ist reiner Text ohne Auswahl und nennt die Rolle («Wer Leitung oder Stufenleitung einer Stufe ist, erscheint mit Name und Profilbild auf der Seite der Stufe. Das ist keine Auswahl, es folgt der Rolle.») und die betroffenen Stufen; er ändert sich mit den Zeilen. Es gibt keinen Schalter «auf der Website zeigen» mehr, weder hier noch in «Mein Profil».
- [ ] **29.5** «Gruppen und Tags» bietet keine Stufen an. Stufen der Person stehen darunter als Hinweiszeile («Stufe X: über «Rechte und Rollen» (Stufenleitung).»); eine Zuordnung ohne Rolle sagt das und nennt, wo man sie entfernt. In der Gruppe einer Stufe lassen sich Leitung und Stufenleitung nicht ändern oder entfernen («Bei der Person ändern»); Mitglieder fügt man dort nicht hinzu, die Karte verweist auf die Person.
- [ ] **29.6** Mit «Bewegung reduzieren» erscheinen neue Zeilen ohne Übergang; sonst blenden sie kurz ein (`--dauer`, `--kurve`). Bei 390 Pixeln stehen Auswahl, Auswahl und Knopf untereinander, Ziele sind mindestens 44 Pixel hoch, nichts scrollt waagrecht; bei 200 % Zoom bleibt jede Zeile lesbar.

## 26. Verwaltung: Ziehen mit Bewegung, Lädeli Bestellungen und Einstellungen (#609)

Dieser Abschnitt gilt für `sortieren.js` (`zieheMitBewegung`, `sortierListe`), den Seitenbaum (`website-baumansicht.js`), die Artikel im Lädeli und die Unterseiten «Bestellungen» und «Einstellungen» (`laedeli.js`, `laedeli.css`, `werkzeuge.css`). Geprüft wird im Browser mit Maus und Finger (Pointer Events), mit Tastatur und mit «Bewegung reduzieren», bei 1440 und 390 Pixeln, in Tag und Nacht.

- [ ] **26.1** Ziehen mit Zeiger: Die gezogene Zeile folgt dem Zeiger und ist angehoben (Schatten, kein Wachsen). Die anderen Zeilen weichen aus und rutschen an ihren neuen Platz; ein gestrichelter Platzhalter zeigt den Zielplatz und wandert mit. Beim Loslassen setzt sich die Zeile an den Platzhalter. Das gilt für alle Sortierlisten (Bausteine, Karten, Lager-Vorlagen, Zusatzfelder, Stufenleitung), den Seitenbaum und die Artikel des Lädelis, ohne eigenen Code je Liste.
- [ ] **26.2** Mit «Bewegung reduzieren» entfallen alle Übergänge: Die Zeilen stehen sofort am neuen Platz, die gezogene folgt dem Zeiger (Eingabe der Person, keine Animation) und setzt sich ohne Gleiten ab. Die Ansage und die Funktion sind dieselben.
- [ ] **26.3** Kein Ziehen als einziger Weg (WCAG 2.5.7): Der Griff ist eine Schaltfläche mit Namen («Verschieben: <Name>», 44 × 44 Pixel); Leertaste greift, Pfeile bewegen, Leertaste setzt ab, Escape bricht ab. «Nach oben» und «Nach unten» stehen als Knöpfe oder im Menü «Mehr»; sie lassen die Zeilen kurz an ihren Platz gleiten (nur mit erlaubter Bewegung). Jede neue Position sagt eine Live-Region an; nach dem Ziehen steht «2 nach oben» oder «2 nach unten» kurz neben der Zeile (Zierde, `aria-hidden`, die Ansage sagt dasselbe).
- [ ] **26.4** Escape beim Ziehen bricht ab: Die Zeile gleitet zurück, nichts wird gespeichert. Ein Abbruch des Zeigers (Finger weg, Fenster verliert den Fokus) wirkt gleich. Nach jedem Ende bleibt nichts hängen (keine Klassen, keine Verschiebungen, kein Platzhalter).
- [ ] **26.5** Touch: Der Griff hat `touch-action: none`, die Seite scrollt beim Ziehen am Rand des Fensters mit; die Zeile verliert den Zeiger nie, weil das Dokument erst nach dem Absetzen umgebaut wird.
- [ ] **26.6** Seitenbaum: Die Zone der Zeile unter dem Zeiger entscheidet (oben davor, unten danach, Mitte als Unterseite). «Als Unterseite» umrahmt die Elternseite und rückt den Platzhalter ein; ein gesperrtes Ziel (Tiefe, eigene Unterseite) hat einen gestrichelten roten Rahmen und macht keinen Platz, die Meldung nennt beim Loslassen den Grund (nie nur Farbe). Unterseiten wandern mit der gezogenen Seite. Tastatur und Menü «Mehr» bleiben wie in 21.
- [ ] **26.7** Lädeli, Einstellungen: Die Übergabearten werden in der Speicherleiste unten gespeichert, wie bei den Kategorien der Termine. Die Leiste erscheint erst bei einer Änderung («Die Übergabearten sind geändert, noch nicht gespeichert.», Statusregion, «Verwerfen» und «Speichern»); ohne Änderung gibt es keinen Speichern-Knopf. Rechts zeigt eine Vorschau, wie die Wahl beim Bestellen aussieht.
- [ ] **26.8** Lädeli, Bestellungen: Die Karte nennt oben Initialen (`aria-hidden`), Name und Zeit der Bestellung und den Stand als Wort mit Symbol. Die Schiene ist eine Liste «Stand der Bestellung» mit `aria-current="step"`; erledigte Schritte tragen einen Haken und für Screenreader «(erledigt)», beim aktuellen Schritt von «Bereit» und «Übergeben» steht seit wann. Die Positionen nennen Name, Grösse, Menge mit Einzelpreis und die Zeilensumme; darunter steht die Summe. Stornierte Bestellungen zeigen keine Schiene, die Namen der Artikel sind durchgestrichen und der Stand «Storniert» steht als Wort.
- [ ] **26.9** Farbe und Kontrast: Schiene, Punkte und Haken nutzen `--accent` und `--on-accent` (Tag und Nacht, mindestens 3:1 zum Grund); der Stand steht nie nur als Farbe.

### Stand der Prüfung (#609)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 26.1 bis 26.6 mit Maus (Artikel im Lädeli, Seitenbaum, Beispielliste, Bausteine einer Seite, Aufgaben-Vorlage) und mit Finger (CDP-Touch: Artikel, Beispielliste), 26.2 mit `reducedMotion: reduce`, 26.3 mit Tastatur und Menü, 26.7 und 26.8 bei 1440 und 390 Pixeln, Tag und Nacht. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), ein echtes Touch-Gerät, 200 Prozent Zoom von Hand, Kontrastwerte mit einem Messwerkzeug, die Sortierliste der Stufenleitung und der Zusatzfelder im Browser (gleicher Code, keine Demo-Daten dafür).

## 34. Verwaltung: Gruppentyp «Anlass» (#626)

Dieser Abschnitt gilt für «Gruppen und Tags» (`tags.js`, `tags-detail.js`, `tags-anlass.js`) und den Verweis auf die Gruppe in der Übersicht eines Anlasses (`termine-anlaesse.js`). Geprüft wird im Browser mit der Abteilungsleitung, bei 1440 und 390 Pixeln, in Tag und Nacht, mit Tastatur.

- [ ] **34.1** «Neue Gruppe»: Typ und Anlass sind eigene Auswahlfelder (`role="combobox"` mit Namen «Typ» und «Anlass», Tastatur: Pfeile, Eingabe, Escape). Das Feld «Anlass» erscheint erst beim Typ «Anlass»; die Anlässe kommen mit einer Abfrage und stehen als «Titel · Datum», kommende zuerst. Hat kein Anlass mehr Platz, steht der Hinweis als Text im Feld (`role="status"`).
- [ ] **34.2** Fehlt der Anlass, steht «Wähle einen Anlass.» am Feld (nicht nur Farbe, `aria-invalid`, Symbol), die Zusammenfassung oben nennt «Anlass» und führt mit dem Fokus dorthin. Ein zweiter Versuch für denselben Anlass sagt «Zu diesem Anlass gibt es schon eine Gruppe.» und verlangt einen anderen Anlass.
- [ ] **34.3** Liste: Der Typ steht als Chip mit Wort und Symbol («Anlass»), nie nur als Farbe; unter dem Namen steht der Anlass mit Datum als Link (Trefferfläche mindestens 44 Pixel hoch). Ist der Anlass gelöscht, steht «Der Anlass ist gelöscht». «Anlass» ist im Typfilter und in der Suche der Befehlspalette.
- [ ] **34.4** Gruppe: Die Karte «Anlass» nennt Titel (Link «<Titel>, öffnen») und Termin als Definitionsliste und sagt, dass die Gruppe keine zusätzlichen Rechte gibt und nie auf der Website erscheint. Mitglieder und Rollen verhalten sich wie bei einem Team.
- [ ] **34.5** Anlass, Übersicht: Die Zeile «Gruppe» in «Angaben» ist ein Link auf die Gruppe oder der Knopf «Gruppe anlegen» (Seite im Fluss, der Anlass steht in der Beschreibung, Typ und Anlass entfallen). Nach dem Erstellen steht die Meldung in der Statusregion und die Zeile zeigt die Gruppe.
- [ ] **34.6** Bei 390 Pixeln stehen die Felder untereinander, Ziele sind mindestens 44 Pixel hoch, nichts scrollt ausser der Tabelle der Gruppen in ihrem beschrifteten Bereich; bei 200 % Zoom bleibt alles lesbar. Es gibt keine neue Bewegung.

## 37. Verwaltung: Rollen und Rechte (#623)

Dieser Abschnitt gilt für die Seite «Rollen und Rechte» (`rechte.js`, `rechte-rollen.js`, `rechte-gruppen.js`, `rechte-uebersicht.js`, `rechte.css`) mit den Reitern «Rollen», «Gruppen» und «Was darf wer?». Geprüft wird im Browser mit Tastatur, bei 390 und 1440 Pixeln, in Tag und Nacht und mit «Bewegung reduzieren».

- [ ] **37.1** Matrix: eine echte Tabelle (`caption` nur für Screenreader, `th scope="col"` je Rolle, `th scope="row"` je Recht, `th scope="rowgroup"` je Bereich). Jede Zelle enthält ein echtes Kontrollkästchen mit dem vollen Namen («Webmaster: Seiten bearbeiten»; bei einer Änderung mit «, neu, noch nicht gespeichert» oder «, entzogen, …»). Die Spalte der Abteilungsleitung ist fest und nennt «immer erlaubt». Die Tabelle scrollt in einem beschrifteten, per Tastatur fokussierbaren Bereich.
- [ ] **37.2** Hauptweg ohne Tabelle: Jede Rolle hat eine Seite (`#personen/rechte/rolle/<id>`) mit allen Rechten als Schalter (`role="switch"`, Name und Erklärung per `aria-labelledby` und `aria-describedby`), Personen, Namen und Löschen. Unter 48 rem (auch bei 200 % Zoom) ersetzen Karten mit «Öffnen» die Matrix; es gibt kein waagrechtes Scrollen der Seite (geprüft bei 390 Pixeln; bei 320 Pixeln läuft die Kopfzeile des Gerüsts über, das gilt für alle Seiten).
- [ ] **37.3** Tastatur: Alles ist per Tab, Leertaste und Enter bedienbar; die Kästchen sind 44 × 44 Pixel gross und tragen einen sichtbaren Fokusring (3 Pixel, `--fokus`). Zweistufige Knöpfe und Rückfragen am Ort nimmt Escape zurück und geben den Fokus zurück; `Bestätigen` bekommt den Fokus beim Öffnen. Kein Popup, kein Fokusfang.
- [ ] **37.4** Nie nur Farbe: «Neu» und «Entzogen» stehen als Text in der Zelle und in der Zeile der Rolle; die Wirkung eines Rechts («Wirkt öffentlich», «Löscht», «Sperrt die Website») steht als Wort mit Symbol; «2. Faktor» als Wort mit Symbol; Zustände der Konten («Zweiter Faktor fehlt», «Konto gesperrt») als Wort mit Symbol.
- [ ] **37.5** Speicherleiste: Die Zahl («2 Änderungen, noch nicht gespeichert») ist eine Statusregion; die Vorschau «wer ist betroffen» ist ein aufklappbares `details` mit Text. «Speichern» bei Rechten mit grosser Wirkung ist zweistufig (der Knopf nennt die Rechte). Fehler und Konflikte stehen als Meldung mit dem Namen der Rolle. Beim Verlassen mit Entwurf fragt eine Zeile am Ort (`role="alert"`, «Bleiben» / «Verwerfen und gehen»); Tab schliessen und Neuladen warnt der Browser.
- [ ] **37.6** Vergeben und Entziehen: Entziehen (Person aus Rolle, Verantwortung, Sonderrecht, Rolle löschen) ist ein zweistufiger Knopf; Vergeben bei Rechten mit grosser Wirkung fragt in einer Zeile am Ort. Beides sagt die Folge in Worten (««Name» verliert die Rechte dieser Rolle.»).
- [ ] **37.7** Gruppen und Übersicht: Suche und Filter wie überall (`filterleiste`, laufende Trefferzahl), Karten und Zeilen mit Links von mindestens 44 Pixeln Höhe. Die Karte «Noch nicht möglich» sagt ehrlich, was fehlt, ohne Fehlerton. «Was darf wer?» ist nur lesend; jede Quelle nennt Umfang, Herkunft und zweiten Faktor, mit Link zur Stelle, wo man es ändert.
- [ ] **37.8** Farben und Kontrast: Alle Farben kommen aus den Tokens (`--akzent`, `--karte`, `--wa-f` …), Tag und Nacht; das gesetzte Kästchen ist `--akzent` mit `--auf-akzent`. Keine Farbwerte im Stil.
- [ ] **37.9** Bewegung: Die Speicherleiste gleitet nur mit erlaubter Bewegung ein; sonst steht sie sofort da. Keine andere Animation.

### Stand der Prüfung (#623)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 37.1 bis 37.6 bei 1440 Pixeln mit Tastatur und Maus (Rolle anlegen, Rechte setzen, speichern mit zweistufigem Knopf, Person geben und entziehen, umbenennen, löschen, Verantwortliche im Team), 37.2 und 37.7 bei 390 Pixeln (kein Seitenüberlauf, Kartenliste, Detailseite), 37.8 in Tag und Nacht (Sichtprüfung), Zielgrössen per Messung (alle Knöpfe und Kästchen mindestens 44 Pixel hoch; die Schalter sind 32 Pixel hoch und haben eine 44 Pixel grosse Trefferfläche). **Nicht geprüft:** Screenreader (NVDA, VoiceOver), 200 % Zoom von Hand, gemessene Kontrastwerte (nur Sichtprüfung gegen die Tokens), Safari und Firefox.

## 32. Verwaltung: Übersicht als Dashboard (#620)

Dieser Abschnitt gilt für die Übersicht (`uebersicht.js`, `uebersicht-kacheln.js`, `uebersicht-verlauf.js`, `uebersicht-kommend.js`, `uebersicht-diagramme.js`, `uebersicht.css`). Die Abschnitte 14, 16 und 23 gelten weiter, soweit sie nicht hier ersetzt sind.

- [ ] **32.1** Überschriften und Reihenfolge: Die Seite hat eine `h1` (Begrüssung); jede Karte hat eine `h2`, die Zustandsstreifen-Punkte eine `h3`. Die Reihenfolge im Dokument ist die Lesereihenfolge (Aufgaben, Verlauf, Kennzahlen, Kommendes, Aktivität, Teilnahme, Zustand). Die Gruppen der Aufgaben sind `role="group"` mit Namen; Störung und Sicherheit tragen Symbol und Wort, nie nur Farbe.
- [ ] **32.2** Hauptdiagramm per Tastatur: Der Schieber ist erreichbar (Tab), hat einen Fokusring (3 px, 3:1), Pfeile, Bild auf/ab, Pos1 und Ende wählen die Woche, `aria-valuetext` nennt Woche und Wert, die Zeile darunter (`aria-live="polite"`) nennt die Anmeldefrist der Woche. Mass und Zeitraum sind Knöpfe mit `aria-pressed` (44 Pixel hoch). Ein Satz (nur für Screenreader) fasst das Diagramm zusammen; die Zeichnung ist `aria-hidden`.
- [ ] **32.3** Zahlen und Grafiken: Jede Zahl, die hochzählt, hat den Endwert sofort als Text für Screenreader; jede Spur (kleine Grafik) hat `role="img"` mit einem Satz mit allen Werten. Kein Wert steht nur als Farbe oder Höhe (Zahl, Wort oder Vorzeichen daneben). Kontrast Linie, Balken und Text mindestens 3:1 (Grafik) und 4.5:1 (Text) in Hell und Dunkel.
- [ ] **32.4** Bewegung: Nur unter `prefers-reduced-motion: no-preference` kommen Karten gestaffelt, zeichnen sich Linie, Spuren und Balken ein und zählen Zahlen hoch; mit «Bewegung reduzieren» steht alles sofort da und nichts flackert. Keine Bewegung ist Pflicht, um etwas zu bedienen.
- [ ] **32.5** Breite und Umbruch: Das Raster liegt in der Breite der Website (23.1); bei 1100 Pixeln und weniger eine Spalte, bei 390 Pixeln kein Querscrollen, bei 200 Prozent Zoom bleibt jede Funktion erreichbar; Umschalter und Zeilen sind mindestens 44 Pixel hoch.
- [ ] **32.6** Rollen: Stufenleitung und Webmaster sehen nur ihre Teile (kein Hauptdiagramm, kein Band); die Karten stehen ohne Lücken in einer Reihe. Ein gescheiterter Teil zeigt nur seine Karte mit «Nochmals versuchen».
- [ ] **32.7** Erzwungene Farben: Linie, Fadenkreuz, Balken und Marken bleiben in Systemfarben sichtbar (Highlight, CanvasText), Karten haben einen Rand.

### Stand der Prüfung (#620)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit gefüllten Demo-Daten geprüft: 32.1 bis 32.6 als Abteilungsleitung bei 1440, 1920, 2560 und 390 Pixeln in Hell und Dunkel (Ablesen mit Zeiger und Pfeiltasten, Umschalten von Mass und Zeitraum, Antwort der Route als Stufenleitung, Webmaster, leer und mit gescheiterten Teilen nachgestellt). **Nicht geprüft:** Screenreader, 200 Prozent Zoom am Gerät, erzwungene Farben am Gerät (32.7 nur aus dem Stil gelesen), Touch am Gerät.

## 33. Verwaltung: Mitglieder-Darstellung für Personen, Kinder und Gruppen (#624)

Dieser Abschnitt gilt für `mitglieder.js` und den Block «Mitglieder-Darstellung» in `personen.css` (Klassenvorsatz `mg-`) auf den Seiten «Personen», «Kinder», dem Detail einer Gruppe und der Stufenleitung auf «Stufen». Geprüft wird im Browser bei 390, 720, 1440, 1920 und 2560 Pixeln, in Tag und Nacht, mit Tastatur und mit «Bewegung reduzieren».

- [ ] **33.1** Umschalter «Karten | Liste» und «Gruppieren»: je eine Gruppe von Auswahlknöpfen (`role="radiogroup"`, benannt durch «Ansicht» und «Gruppieren nach»). Pfeiltasten wechseln, Tab verlässt die Gruppe, der Fokus ist sichtbar (3 Pixel). Jede Option ist 44 Pixel hoch. Die gewählte Option trägt Rand und Fläche, nie nur eine Farbe. Der Schieber gleitet nur ohne «Bewegung reduzieren».
- [ ] **33.2** Die Wahl der Ansicht (nur «karten» oder «liste») gilt, solange die Seite offen ist, und wird nicht im Browser gespeichert; nach dem Neuladen gilt «karten». Die Gruppierung gilt ebenso für die Sitzung.
- [ ] **33.3** Abschnitte: Jeder Abschnitt hat eine Überschrift (Ebene 2, im Detail einer Gruppe Ebene 3) mit der Zahl der Treffer, das Raster oder die Tabelle trägt den Namen des Abschnitts. Die Zahl zählt alle Treffer, nicht nur die der Seite.
- [ ] **33.4** Karte: Bild oder Initialen, Name, Cevi-Name, Rollen und Tags als Chips mit Wort (höchstens drei, der Rest als «+n weitere» mit Aufzählung im Titel), darunter «Bearbeiten». Der Name der Person steht im Namen jedes Knopfs (`kontext`, `aria-label`). Konto und Zugang sind ruhige Marken mit Symbol und Wort (`Konto aktiv`, `Eltern verknüpft`, `Kein Zugang`, `Zweiter Faktor`); was Aufmerksamkeit verlangt (Startpasswort offen, abgelaufen, deaktiviert, Inaktiv, Telefon fehlt) bleibt ein Chip mit Symbol.
- [ ] **33.5** Kontrast: Marken (`--leise`, `--ok`) und Chips erreichen 4.5:1 auf Karte und Fläche in Tag und Nacht; Rand von Karte und Umschalter mindestens 3:1 zu `--outline` beim Zeigen und beim Wählen.
- [ ] **33.6** Auswahl: Das Kästchen steht oben rechts in der Karte, die Trefferfläche ist 44 Pixel gross; «Alle auf der Seite wählen» steht in der Leiste und gilt für Karten und Liste. Die Auswahlleiste (Tag setzen, Tag entziehen, Rückgängig) bleibt unverändert.
- [ ] **33.7** Liste: eine Tabelle mit Spaltenköpfen (`scope="col"`), Abschnittszeilen (`scope="colgroup"`) und sortierbaren Köpfen (`aria-sort`); nach dem Sortieren bleibt der Fokus auf dem Kopf. Auf schmalem Platz scrollt der Rahmen waagrecht und ist mit der Tastatur erreichbar. Im Detail einer Gruppe steht die Liste als Zeilen, nicht als Tabelle.
- [ ] **33.8** Bewegung: Das gestaffelte Einblenden der Karten läuft nur beim Wechsel von Ansicht oder Gruppierung und nur ohne «Bewegung reduzieren»; beim Tippen im Filter bewegt sich nichts.
- [ ] **33.9** Laden und leer: Das Skelett hat die Form der Karten (oder der Tabelle, wenn die Liste gewählt ist). Ohne Treffer steht der Satz mit «Filter zurücksetzen».
- [ ] **33.10** Rechte und Daten: Keine neue Abfrage und kein neues Feld. Kinder zeigen Name, Cevi-Name, Stufe, Zugang und die verknüpften Eltern wie bisher; Alter und Bild gibt es nicht und stehen nicht da. Der Knopf «Anrufen» (`tel:`) erscheint nur bei einer Person, deren Nummer die Antwort der Verwaltung ohnehin enthält (Stufenleitung).

- [ ] **33.11** Stufenkarte: Das hinterlegte Bild (erstes Bild der Stufenseite auf der Website) steht oben in der Karte mit leerem `alt` (Zierde, der Name der Stufe steht darunter als Überschrift); bis es geladen ist, steht ein ruhiger Platzhalter, fehlt die Datei, das Wort «Vorschau fehlt». Ohne Seite, ohne Bild oder ohne Recht bleibt die Karte wie vorher mit dem Buchstaben. Abfragen: die Seitenliste und je Stufe mit Seite der Entwurf, nur lesend.

### Stand der Prüfung (#624)

Im Browser geprüft bei 1440, 1920, 2560 und 390 Pixeln in Tag und Nacht (Karten, Liste, Gruppierung nach Rolle, Stufe und Zugang) mit der Demo-Abteilung. Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack) und 200 % Zoom auf echten Geräten.

## 36. Verwaltung: Mein Konto (#621)

Dieser Abschnitt gilt für `konto.js`, `konto.css` und den Link im Kopf (`rahmen.js`, `geruest.css`). Geprüft wird im Browser (Chromium, headless) mit einer Abteilungsleitung, einer Stufenleitung und einem Webmaster, bei 390, 720 (entspricht 200 % Zoom bei 1440), 1024, 1440 und 2560 Pixeln, in Tag und Nacht, mit Tastatur und mit «Bewegung reduzieren».

- [ ] **36.1** Zugang: Der Name im Kopf ist ein Link «Mein Konto: <Name>» (Screenreader), mindestens 44 Pixel hoch, mit `aria-current="page"` und einem Rand, solange die Seite offen ist. Unter 1100 Pixeln bleibt nur das Bild, Name und Rolle bleiben für Screenreader. Die Seite ist kein Eintrag der Bereichsleiste (dort steht keiner als aktuell); Zurück im Browser führt dahin, woher die Person kam.
- [ ] **36.2** Aufbau: eine `h1` «Mein Konto», die Profilkarte als Bereich mit dem Namen als `h2`, danach die Abschnitte «Deine Angaben», «Sicherheit» und «Datenschutz» je mit `h2` und Gruppen mit `h3`. Nach dem Speichern liegt der Fokus auf «Deine Angaben». Die Seite zeigt nur die eigene Person, jede Rolle mit Zugang öffnet sie.
- [ ] **36.3** Karte: Das Profilbild liegt auf einem ruhigen Grund mit Initialen (`aria-hidden`); lädt es nicht, bleiben die Initialen. Die Kennwerte (Konto, Zweiter Faktor, Website) stehen als Wert mit Symbol und Wort, nie nur als Farbe. Die Rollen sind eine Liste «Rollen» mit Chips in Worten. Unter 1100 Pixeln steht das Porträt links vom Text, unter 640 Pixeln darüber (nie über die ganze Breite).
- [ ] **36.4** Profilbild: «Bild wählen» oder «Bild wechseln» öffnet die Dateiwahl (JPEG, PNG, WebP, höchstens 5 MB; zu grosse und falsche Dateien nennen den Grund, bevor etwas gesendet wird); danach folgt die Seite «Profilbild zuschneiden» (Abschnitt 40). Während des Hochladens trägt das Porträt `aria-busy`, eine Statusregion sagt «Das Bild wird hochgeladen …», die Knöpfe sind gesperrt. «Bild entfernen» ist zweistufig («Wirklich entfernen?», Escape nimmt zurück). Das neue Bild erscheint in der Karte und im Kopf; der Fokus bleibt am Knopf.
- [ ] **36.5** Angaben: Name, Cevi-Name und Benutzername stehen gesperrt (`readonly`, flache Fläche, Hinweis darunter, wer sie ändert). Das Telefon ist änderbar für Stufenleitungen; alle anderen dürfen eine vorhandene Nummer nur entfernen. Die Schreibweise wird beim Verlassen des Felds vereinheitlicht und darunter angesagt («Wird gespeichert als …»); eine ungültige Nummer meldet sich beim Feld mit Symbol (`aria-invalid`, Fokus). Die Schalter «Mitteilungen auf dem Handy» sind `role="switch"` mit Namen und Hilfe (`aria-labelledby`, `aria-describedby`), Trefferfläche 44 Pixel.
- [ ] **36.6** Geändertes: Ein Punkt vor dem Label und «(geändert)» für Screenreader markieren jedes geänderte Feld. Die Speicherleiste («1 Änderung nicht gespeichert: Telefon», Statusregion, «Verwerfen», «Speichern») erscheint erst bei einer Änderung und haftet unten; ohne Änderung gibt es keinen Speichern-Knopf. Verwerfen stellt den gespeicherten Stand her. Der Browser warnt beim Schliessen des Tabs mit ungespeicherten Änderungen.
- [ ] **36.7** Passwort: zwei Felder (kein «Wiederholen»), `autocomplete` `current-password` und `new-password`, Einfügen erlaubt, «Passwörter anzeigen» als Kontrollkästchen. Fehler stehen beim Feld mit Symbol: falsches Passwort, weniger als 12 oder mehr als 128 Zeichen, gleiches Passwort, Passwort aus einem Datenleck, zu viele Versuche. Nach Erfolg steht eine Meldung («Auf allen anderen Geräten bist du abgemeldet.») und die Felder sind leer.
- [ ] **36.8** Zweiter Faktor und Geräte: Der Stand steht als Chip mit Symbol und Wort («Aktiv», «Nicht eingerichtet»). «Auf allen Geräten abmelden» ist zweistufig, führt danach zur Anmeldung mit dem Hinweis «Du bist auf allen Geräten abgemeldet.» und löst keine Warnung des Browsers aus. Eine Liste der Sitzungen gibt es nicht (Lücke der API) und wird nicht vorgetäuscht.
- [ ] **36.9** Datenschutz: Der Text zur Website folgt der Rolle (Leitung oder Stufenleitung mit Cevi-Name: erscheint mit Cevi-Name und Bild auf der Seite der Stufe; sonst nicht) und nennt, dass es keine Auswahl ist und Name im Konto, Benutzername und Telefon nie erscheinen. «Datenschutzerklärung» und «Konto löschen» sind echte Links (44 Pixel hoch) auf die vorhandenen Seiten.
- [ ] **36.10** Breite und Reflow: kein waagrechter Seitenscroll bei 390, 720, 1024, 1440 und 2560 Pixeln; ab 1100 Pixeln Karte links, Abschnitte rechts, Gruppen nebeneinander, solange der Platz für 24 rem reicht, sonst untereinander mit Trennlinie; bei 200 % Zoom bleibt alles lesbar.
- [ ] **36.11** Bewegung: Das Einblenden des Bildes und der Punkt für Geändertes laufen nur ohne «Bewegung reduzieren»; die Speicherleiste blendet wie in den Terminen ein (`termine.css`).
- [ ] **36.12** Last und Daten: Beim Öffnen läuft eine Abfrage (`GET /api/v1/ich`), nach einem Bild eine weitere; kein Polling. Es gibt keine neue Route; Telefon, Bild und Passwort laufen über die Routen, die es für die eigene Person ohnehin gibt (der Server prüft jede). Die Seite zeigt nie E-Mail, Startpasswort oder Codes des zweiten Faktors.

### Stand der Prüfung (#621)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 36.1 bis 36.9 mit Stufenleitung (Telefon speichern, ändern, entfernen, ungültig; Schalter; Bild hochladen und entfernen; Passwort falsch, zu kurz, ändern und zurücksetzen; überall abmelden) und Abteilungsleitung (Karte, Rollen), 36.10 bei 390, 720, 1024, 1440 und 2560 Pixeln, Tag und Nacht, 36.1 und 36.6 mit Tastatur (Tabreihenfolge, Fokusring 3 Pixel), 36.11 mit `reducedMotion: reduce`. **Nicht geprüft:** Screenreader (NVDA, VoiceOver), erzwungene Farben, Webmaster mit eigenem zweitem Faktor (nur der Stand der Karte), Zoom 400 %.

## 35. Verwaltung: Mitteilungen an Gruppen und Rollen (#625)

Dieser Abschnitt gilt für `mitteilungen.js` und den Teil «Mitteilungen» in `system.css`. Die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss. Die Seite hat eine Liste von Zielen (Gruppe mit Rollen), eine Suche nach Gruppen (Muster «action-search-bar») und rechts die Vorschau mit dem Push und den Zahlen.

- [ ] **35.1** Die Suche nach Gruppen ist ein Eingabefeld mit `role="combobox"`, `aria-controls` auf die Liste (`role="listbox"`) und `aria-activedescendant` auf die markierte Zeile (`role="option"`, `aria-selected`). Pfeil auf und ab markieren, Enter fügt hinzu (und sendet nicht), Escape leert die Suche. Der Fokus bleibt im Feld; das Hinzufügen und Entfernen sagt die Live-Region an («Material-Team hinzugefügt.»). Die markierte Zeile trägt einen Balken links, nicht nur eine Farbe.
- [ ] **35.2** Die Art der Gruppe (Alle, Stufen, Teams, Funktionen, Lager, Anlässe) ist eine Gruppe von Schaltflächen mit `aria-pressed` und der Zahl der noch wählbaren Gruppen; Arten ohne Gruppe fehlen. Die Zeilen nennen Name und Art (bei Teams, Funktionen, Lagern und Anlässen die Zahl der Mitglieder), das Plus ist Zierde.
- [ ] **35.3** Jedes Ziel ist ein Listeneintrag mit Name, Art als Wort und «Entfernen» (Name im Aufruf: «Entfernen: Artemis»). Die Rollen sind Schaltflächen mit `aria-pressed` in einer Gruppe «Rollen für <Gruppe>», 44 Pixel hoch; gewählt zeigt ein Haken und die Füllung, nie nur die Farbe. Bei einer Stufe: Kinder (über die Eltern), Leitende, Stufenleitung; bei allen anderen Gruppen: Alle Mitglieder, Verantwortliche.
- [ ] **35.4** Ein Ziel ohne Rolle ist rot umrandet, nennt «Keine Rolle» und den Satz «Wähle mindestens eine Rolle, sonst zählt das Ziel nicht.» (mit Symbol); «Senden» stoppt mit einer Meldung (`role="alert"`, Fokus darauf), die Gesamtzahl sagt «Wähle bei jedem Ziel mindestens eine Rolle.»
- [ ] **35.5** Die Vorschau zeigt den Push (für Screenreader ausgeblendet, die Angaben stehen in den Feldern), die Gesamtzahl der Konten als Zustandsmeldung (`role="status"`, `aria-busy` beim Zählen) und je Ziel eine Zeile mit Satz und Zahl. Doppelte Personen nennt ein Hinweis («Wer in mehreren Zielen steht, zählt im Gesamttotal einmal.»). Kein Name eines Kindes oder einer Person steht irgendwo.
- [ ] **35.6** «Alle aktiven Konten der Abteilung» ist ein Ankreuzfeld; ist es gewählt, ist die Auswahl der Ziele ausgeblendet (nicht nur grau) und die Vorschau zählt alle Konten.
- [ ] **35.7** «Senden» fragt im Knopf («Wirklich an 8 Konten (die Leitenden von «Artemis») senden?»), ein zweiter Klick sendet, Escape nimmt die Frage zurück. Ändern sich Ziele oder Zahl, gilt der nächste Klick wieder als erster. Eine Wahl ohne Konten stoppt mit einer Meldung; während der Zählung sagt eine Meldung «Einen Moment».
- [ ] **35.8** Hell, Dunkel und «Bewegung reduzieren»: Ein neues Ziel gleitet nur bei erlaubter Bewegung ein, die Rollen blenden ihren Zustand nur dann weich um. Mit erzwungenen Farben bleiben Haken, Rand und Balken sichtbar.
- [ ] **35.9** 320, 390, 720, 1440 und 1920 Pixel: nichts scrollt waagrecht; auf dem Handy entfällt der innere Rahmen der Empfänger, «Entfernen» steht rechts neben dem Namen, die Rollen brechen um. Die Liste der Gruppen scrollt in ihrem Rahmen (höchstens 16 rem), nicht die Seite.

### Stand der Prüfung (#625)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Demo-Daten geprüft: 35.1 bis 35.7 mit Tastatur und Maus (Titel leer, keine Wahl, Ziel ohne Rolle, Senden in zwei Stufen, «Alle»), 35.9 bei 390, 1440 und 1920 Pixel, Hell und Dunkel (Bilder). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, erzwungene Farben, Kontrastwerte mit einem Messwerkzeug, Bewegung reduzieren im Browser.

## 31. Website: «Nach oben» und Aufruf, Verwaltung: Kalender-Standard und Raumanfragen (#622)

Gilt für den Fuss (`public/website/fuss.css`, `src/website/kontakt.ts`), das Band «Aufruf» (`public/website/website.css`), den Kalender (`termine-kalender.js`) und die Raumanfragen (`termine-anfragen.js`). Geprüft im Browser bei 390, 1024, 1440, 1920, 2560 und 2764 px, Tag und Nacht.

- [ ] **31.1** «Nach oben» ist ein Verweis (`a.verweis`), kein Knopf mit Pfeil: fett, ohne Strich, der Pfeil zeigt nach oben und steht hinter dem Wort (16 × 24 px, wie die Pfeile der Bereiche). Das Ziel ist mindestens 44 px hoch (gemessen 44 px).
- [ ] **31.2** «Nach oben» endet auf der rechten Linie der Spalte (gleiche Kante wie die Pfeile der Bereiche und der Kopf); gemessen bei 1440 px: rechte Kante 1368 px wie «Bereiche», bei 2764 px 2143 px, links und rechts gleicher Rand. Am Handy steht es rechtsbündig in der Zeile von «©», ohne Umbruch.
- [ ] **31.3** Zustände: Zeigen unterstreicht das Wort und macht den Pfeil hell, Fokus zeigt den Ring (auf Blau in Weiss, nie verdeckt); Zustand nie nur über Farbe (Strich, Ring). Pfeil und Verschiebung nach oben nur ohne «Bewegung reduzieren». Der Pfeil allein ist dekorativ (`::after`), der Linktext «Nach oben» trägt die Bedeutung. Im Druck entfällt der Verweis.
- [ ] **31.4** Aufruf (rotes Band «Schnuppern im Cevi»): Text und weisse Schaltfläche stehen auf einer Mittellinie, die Ränder sind die der Spalte (`.wrap`), links wie rechts gleich; bei Umbruch (Handy) stehen sie untereinander, linksbündig. Die Schaltfläche behält 56 px Höhe.
- [ ] **31.5** Kalender: Beim Öffnen von `#termine/kalender` ist «Alle Termine» gedrückt (`aria-pressed="true"`), «Meine Termine» nur über den Knopf oder die Adresse `#termine/kalender/meine/…`; genau ein Knopf der Gruppe ist gedrückt, der gedrückte hat Hintergrund und kräftige Schrift. Die Navigation «Kalender» führt immer zu «Alle Termine».
- [ ] **31.6** Raumanfragen: Der Zweck (zum Beispiel «Sitzung OK») steht in der Liste in der ersten Spalte «Wofür» (als Knopf, Name mit Zweck, Raum und Tag) und im Detail als Überschrift der Ebene 2 unter dem Satz «Wofür der Raum gedacht ist»; Raum, Zeitraum und Person stehen als Liste darunter. Ein langer Zweck (bis 200 Zeichen) bricht um und wird nie abgeschnitten.
- [ ] **31.7** Am Handy zeigt die Liste «Wofür» und «Raum»; Zeitraum und Person stehen im Detail. Entscheid und Meldungen nennen den Zweck und den Raum («Die Anfrage von … («Sitzung OK», Demo-Saal) ist bestätigt.»).

## 44. Verwaltung: Lädeli-Einstellungen und Profilbild entfernen (#642)

Dieser Abschnitt gilt für «Lädeli, Einstellungen» (`laedeli.js`, `laedeli.css`), den Knopf «Profilbild entfernen» im Personenformular (`personen-blatt.js`) und für die Meldungen der Website zu den neuen Einstellungen (`public/website/laden.js`). Die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss.

- [ ] **44.1** Formular: Jedes Feld hat eine sichtbare Beschriftung und eine Hilfe, die `aria-describedby` anbindet; die Schalter (Kontrollkästchen) haben ihre Hilfe unter der Zeile und verbunden. Zahlen stehen in Textfeldern mit `inputmode`, nicht in nativen Zahlenfeldern. Abschnitte haben Überschriften der Ebene 3.
- [ ] **44.2** Fehler: Ungültige Eingaben stehen beim Feld (`role="alert"`, `aria-invalid`), oben nennt ein Hinweis jedes Feld mit einem Knopf, der es fokussiert; die Eingaben bleiben. Fehler beim Speichern stehen auf der Seite mit Fokus.
- [ ] **44.3** Speichern: Die Speicherleiste unten erscheint erst bei einer Änderung, nennt sie als Text («noch nicht gespeichert») und hat «Verwerfen» und «Speichern» mit mindestens 44 Pixeln; «Gespeichert» kommt als Statusmeldung.
- [ ] **44.4** Vorschau: Rechts steht, was die Besucher lesen, als Text in Blöcken mit Überschriften; sie ist Hilfe, nicht Pflicht, und sagt Änderungen nicht laufend an. Zustand («Ohne Schnell dazu», «Preis nach Anmeldung») steht als Wort, nie nur über Farbe.
- [ ] **44.5** «Standardtext einsetzen» ist ein Knopf (44 Pixel) und nur da, wo der Text abweicht; nach dem Klick liegt der Fokus im Feld.
- [ ] **44.6** Website: Hinweise bei geschlossenem Lädeli und zur Mindestbestellung stehen als Text mit `role="status"`, auch bei 390 Pixeln (nicht nur in der Notiz, die es erst ab 48 rem gibt); gesperrte Knöpfe tragen `aria-disabled` und bleiben fokussierbar; «Preis nach Anmeldung» ersetzt den Preis als Text; Bedingungen stehen als Absätze in der Bestellübersicht.
- [ ] **44.7** Profilbild entfernen: zweistufiger Knopf («Wirklich entfernen?»), kein Popup; das Ergebnis steht als Statusmeldung («Das Profilbild von … ist entfernt»); der Knopf verschwindet, der Fokus bleibt auf der Seite (Initialen statt Bild). Zustand und Name stehen als Text.
- [ ] **44.8** Reflow: kein waagrechter Seitenscroll von 390 bis 2560 Pixeln; die Vorschau steht ab 1100 Pixeln rechts, sonst unter dem Formular.

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 44.1 bis 44.4 und 44.7 bei 1440 und 390 Pixeln (Tag und Nacht für die Einstellungen), Ablauf Einstellungen ändern, Fehler bei ungültiger Zahl, Speichern, Profilbild entfernen in zwei Stufen, Lädeli mit Mindestbestellung, Besucher ohne Preise und Angemeldete mit Preisen. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom von Hand, Kontrastwerte mit einem Messwerkzeug, 44.5 und 44.8 nur nach Sicht, «Bewegung reduzieren».

## 41. Verwaltung: Protokoll (#637)

Dieser Abschnitt gilt für `protokoll.js`, `protokoll-liste.js`, `protokoll-text.js` und `protokoll.css`. Die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss. Die Seite zeigt dem Entwickler Kennzahlen, ein Säulendiagramm, eine Werkzeugleiste mit Filtern und die Einträge als Zeitleiste; ein Klick öffnet das Detail im Fluss. **Seit #662 gilt für die Seite Abschnitt 52** (Änderungsprotokoll); die Punkte 41.2, 41.3 und 41.5 sind dort ersetzt (kein Ergebnis und keine Fehleranteile mehr, andere Filter), die übrigen gelten weiter.

- [ ] **41.1** Die Seite ist nur für den Entwickler sichtbar (Navigation) und der Server antwortet allen anderen mit 403; ein Tiefenlink für eine andere Person zeigt «Kein Zugriff». Der Titel ist die Überschrift der Ebene 1, «Aktivität» und «Verlauf» sind Ebene 2, die Tage der Zeitleiste Ebene 3.
- [ ] **41.2** Jede Zeile der Zeitleiste ist ein Knopf (44 Pixel hoch, sichtbarer Fokus); sein Name enthält Person, Funktionen, Art, Aktion, Objekt, Ergebnis und die absolute Zeit als Text (die relative Zeit steht sichtbar, die absolute zusätzlich nur für Screenreader und im Titel). Das Ergebnis steht als Wort («Erfolgreich», «Fehlgeschlagen») mit Symbol und Statuszahl, ein roter Rand verstärkt es nur.
- [ ] **41.3** Die Werkzeugleiste hat beschriftete Felder (Von, Bis, Benutzer, Aktion, Bereich, Art, Ergebnis); die Datumsfelder sind die eigenen Felder der Verwaltung (Tippen und Kalender). Gesetzte Filter stehen als Knöpfe mit Namen («Filter entfernen: Ergebnis Fehlgeschlagen»); die Trefferzahl ist eine Zustandsmeldung. Tippen in Textfeldern fragt erst nach 350 ms.
- [ ] **41.4** «Aktualisieren» holt neue Einträge auf Wunsch, nie im Takt (kein Polling); Fehler stehen als Zustandsmeldung, der alte Stand bleibt. Während des Ladens ist die Liste `aria-busy`. «Mehr laden» hängt 50 Einträge an; der Knopf zeigt «Lädt …» und ist dann gesperrt.
- [ ] **41.5** Das Diagramm ist mit Pfeiltasten ablesbar (wie in der Übersicht), hat eine Beschriftung mit allen Werten und als Entsprechung eine Tabelle («Bereiche und Zahlen als Tabelle», aufklappbar, 44 Pixel hohe Überschrift). Fehlgeschlagene Anteile sind eine zweite Farbe und in der Beschriftung genannt, die Legende nennt beide mit Wort.
- [ ] **41.6** Das Detail ist eine Seite im Fluss mit eigenem Verlaufseintrag (Zurück, Browser-Zurück, Escape schliessen sie, der Fokus kehrt zur Zeile zurück). Alle gespeicherten Felder stehen als Definitionsliste; Werte nur als Text. «Alle Einträge dieser Person / zu diesem Objekt / dieser Anfrage» sind Knöpfe mit Namen.
- [ ] **41.7** Leer- (Filter ohne Treffer, leeres Protokoll), Lade- (Skeleton) und Fehlerzustand (Zustandskarte mit «Nochmals versuchen», 403 mit dem Satz des Servers) sind vorhanden. Der CSV-Export meldet seinen Zustand als `role="status"`.
- [ ] **41.8** Hell, Dunkel, «Bewegung reduzieren» (Übergänge nur unter `no-preference`) und erzwungene Farben (der Fehlerrand und die Spur bleiben als Linie); Kontrast der Chips und Texte wie in den Tokens (4.5 : 1).
- [ ] **41.9** 320, 390, 720, 1440, 1920 und 2560 Pixel: nichts scrollt waagrecht; auf dem Handy rutschen Ergebnis und Zeit unter den Text, das Detail steht untereinander (Begriff über Wert).

### Stand der Prüfung (#637)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Demo-Daten gesehen: 41.1, 41.2, 41.3, 41.6 mit Tastatur und Maus (Enter auf der Zeile, Escape), 41.8 Hell und Dunkel bei 1440 und 390 Pixel, 41.9 (kein waagrechter Überlauf bei 390 und 1440). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, erzwungene Farben im Browser, Kontrastwerte mit einem Messwerkzeug, Bewegung reduzieren im Browser, 2560 Pixel, Fehlerzustand und 403 in der Oberfläche.

## 38. Verwaltung: Belegungsplan der Räume (#628)

Gilt für `termine-belegung.js`, `termine-belegung.css` und `belegung-layout.js` (Bereich «Räume», Unterseite «Belegung», Startseite für alle Leitenden). Geprüft im Browser bei 390, 1440, 1920 und 2560 px, Tag und Nacht, mit Tastatur; Demo-Buchungen nur in der eigenen Testdatenbank.

- [ ] **38.1** Zustand nie nur über Farbe: Bestätigt ist ausgefüllt (Akzentfarbe) mit Haken, Angefragt ist hell, gestrichelt umrandet und schraffiert mit Uhr; in der Tagesansicht und in der Liste steht zusätzlich das Wort («angefragt», «Bestätigt»). Die Legende über dem Plan erklärt Bestätigt, Angefragt, Frei und «Jetzt». Bei erzwungenen Farben (`forced-colors`) bleiben Füllung und gestrichelter Rand erhalten.
- [ ] **38.2** Jeder Block ist ein Knopf mit voller Beschriftung («Raum, Mo 23.11., 18:00–20:00, Zweck, Person, Bestätigt»); die Karte mit den Angaben (Hover, Fokus; Klick hält sie fest, Escape schliesst sie) ist nur zur Ansicht (`aria-hidden`), nichts steht nur in ihr. Fokusring 3 px; die Karte bleibt im Fenster (sie erscheint über dem Block, wenn unten kein Platz ist).
- [ ] **38.3** Tastatur: Ein Block liegt in der Tabulatorfolge (rollende Marke), Pfeil links und rechts gehen in der Zeit desselben Raums, Pfeil auf und ab zum nächsten Raum (Block mit dem nächsten Beginn), Pos1 und Ende zum ersten und letzten Block des Raums. Die Tage in der Kopfzeile, die Pfeile, «Heute», Ansicht, Raum und «Angefragte zeigen» sind Knöpfe oder Felder mit mindestens 44 px.
- [ ] **38.4** Der Zeitraum steht als Überschrift der Ebene 2 in einer höflichen Live-Region («Woche 48 · 23.–29. November 2026», beim Tag mit Wochentag), darunter die Zahl der Buchungen und Anfragen; die Pfeile heissen «Vorige Woche» / «Nächste Woche» beziehungsweise «Vorheriger Tag» / «Nächster Tag». «Heute» ist im aktuellen Zeitraum deaktiviert. Der heutige Tag trägt `aria-current="date"`, eine Marke «Heute» und die Linie «Jetzt» (im Tagesplan mit Uhrzeit); alle Zeiten in Schweizer Zeit.
- [ ] **38.5** Freie Zeitfenster sind erkennbar: in der Woche als leere Fläche mit Zeitskala 07, 12, 18, 23 im Kopf jedes Tages, im Tagesplan als Zeile «frei 07:00–10:00, 12:00–23:00» im Kopf jedes Raums, in der Liste unter jedem Raum. Fenster unter 30 Minuten zählen nicht. Die Achse reicht von 07 bis 23 Uhr und wächst um volle Stunden, wenn eine Buchung davor oder danach liegt.
- [ ] **38.6** Schmal (bis 760 px) und als dritte Ansicht «Liste» gibt es je Raum eine Karte mit den Buchungen des Tages (Zeit, Zweck, Person, Stand), darüber einen Streifen mit den sieben Tagen (`aria-pressed`, `aria-current`, Zahl der Buchungen im Namen; die Punkte sind nur Zugabe). Kein waagrechtes Scrollen der Seite bei 390 px; der Tagesplan scrollt nur in seinem Rahmen, wenn viele Räume nebeneinander stehen.
- [ ] **38.7** Zustände: lädt (Skeleton in Form der Wochenzeilen, beim Wochenwechsel ein Platzhalter mit «Belegung wird geladen …» für Screenreader), Fehler (Karte mit «Nochmals versuchen»), keine Räume (Satz, für die Abteilungsleitung mit Verweis), ein Tag ohne Belegung («Alle Räume sind den ganzen Tag frei»), mehr als 500 Buchungen (Hinweis mit Rat). Bewegung (Einblenden) nur ohne «Bewegung reduzieren».
- [ ] **38.8** Adressen: `#raeume/belegung/woche|tag|liste/<Datum>[/<Raum>]`; ein Wechsel von Woche, Tag oder Liste legt einen Verlaufseintrag an (Zurück führt zur vorigen Ansicht), Raum und «Angefragte zeigen» ändern die Adresse nur.
- [ ] **38.9** Navigation: Wer nur Leitende ist (keine Abteilungsleitung, kein Zugang zur Website), sieht nur den Bereich «Räume» mit der Seite «Belegung»; Räume und Anfragen bleiben bei der Abteilungsleitung, die Übersicht beim Zugang zur Website. Eltern bekommen unverändert die Seite «Kein Zugang». Die Prüfung steht auf dem Server (`GET /api/v1/raeume/belegung`: 403).

- [ ] **38.10** Wechsel ohne Sprung: Beim Blättern, bei «Heute» und beim Wechsel von Woche, Tag und Liste bleibt die alte Ansicht stehen, bis die neuen Daten da sind (nach 150 ms wird sie matt); Kopf mit Zeitraum und Zahlen hat feste Höhe und Breite, die Fläche gleitet von der alten zur neuen Höhe, Woche und Tag behalten dieselbe Höhe auch ohne Buchung. Nur ohne «Bewegung reduzieren» gleitet die neue Seite in Richtung des Wechsels herein (vorwärts von rechts, zurück von links, 320 ms), Ansichtswechsel blenden über, Blöcke blenden gestaffelt ein, Titel und Zahlen blenden sanft; mit «Bewegung reduzieren» ersetzt die neue Seite die alte sofort. Die alte Seite ist während des Gleitens `aria-hidden` und `inert`; der Fokus bleibt auf dem Knopf, der den Wechsel auslöste. Ab 1280 px steht der Zweck als Kurztext unter dem Balken der Woche (abgeschnitten, nur Zierde: Beschriftung und Karte tragen den Text).

### Stand der Prüfung (#628)

Im Browser (Chromium, headless) bei 390, 1440, 1920 und 2560 px in Tag und Nacht gesehen, Höhen beim Wechsel gemessen (Woche zu Woche 491 und 490 px, Tag zu Tag 1009 px, Kopf 448 × 52 px), Tastatur (Pfeile, Escape, Zurück) durchgespielt, Konten Abteilungsleitung, Stufenleitung und Eltern. Nicht geprüft: Screenreader (VoiceOver, TalkBack, NVDA), echtes Gerät, 400 % Zoom, Kontrastmessung mit dem Skript (die Farben sind die geprüften Tokens).

## 40. Verwaltung: Bilder zuschneiden (#633)

Dieser Abschnitt gilt für `zuschneiden.js` und `zuschneiden.css` und für alle Stellen, an denen man ein Bild von der eigenen Platte wählt: Mein Konto (Profilbild), Medien hochladen und das Logo einer Stufe. Geprüft wird im Browser (Chromium, headless) bei 390 und 1440 Pixeln, in Tag und Nacht, mit Maus, Tastatur, Zeigerereignissen für zwei Finger und mit «Bewegung reduzieren».

- [ ] **40.1** Ablauf: Nach «Datei wählen» öffnet sich die Seite «Bild zuschneiden» im Fluss (eigene Adresse im Verlauf, «Zurück» und Browser-Zurück schliessen sie ohne Rückfrage, Escape ebenso). Der Fokus liegt auf der Bildfläche und kehrt beim Schliessen zum Auslöser zurück. Abbrechen heisst: nichts gewählt, nichts gesendet.
- [ ] **40.2** Alternativen zum Ziehen (WCAG 2.5.7): Verschieben mit vier Pfeilknöpfen und mit den Pfeiltasten auf der Fläche (Umschalttaste: grössere Schritte); Zoomen mit Regler, Knöpfen «Verkleinern» und «Vergrössern» und den Tasten Plus und Minus; bei freiem Seitenverhältnis stellen die Regler «Breite» und «Höhe» den Ausschnitt ein. Nichts verlangt Ziehen, Pinch oder das Mausrad.
- [ ] **40.3** Bedienelemente: alle Knöpfe, Regler und Seitenverhältnis-Chips mindestens 44 Pixel; Regler mit Beschriftung und `aria-valuetext` («150 Prozent»); Seitenverhältnis als Gruppe mit Wahlknöpfen («Frei», «1:1», «4:3», «16:9», «3:2»); sichtbarer Fokus (3 Pixel) auf der Fläche, den Reglern und allen Knöpfen. Das Seitenverhältnis des Profilbilds ist fest (1:1, Kreisvorschau), die Wahl entfällt.
- [ ] **40.4** Ansagen: Jede Änderung mit Tastatur oder Knopf sagt eine Statusregion an («Ausschnitt bei 120 und 80, 512 mal 512 Pixel», «Bild nach rechts gedreht»); beim Ziehen mit dem Zeiger bleibt sie still. Die Fläche ist eine Gruppe «Bildausschnitt» mit Beschreibung der Bedienung.
- [ ] **40.5** Vorschau: Das Ergebnis steht daneben (beim Profilbild rund) mit Grösse in Pixeln und Dateigrösse; die Zahlen stehen als Text, nicht nur im Bild. Der Hinweis nennt, dass Kameradaten und Aufnahmeort entfernt werden.
- [ ] **40.6** Fehler stehen beim Feld und nennen den Grund: «Dieses Bild lässt sich nicht lesen», «zu viele Pixel» (über 64 Millionen), «Ergebnis zu gross». Fehler beim Hochladen aus dem Profilbild erscheinen auf der Seite selbst (`role="alert"`, Fokus), die Eingabe bleibt erhalten.
- [ ] **40.7** Zustand und Farben: Der Rahmen der Fläche hat helle Linie mit dunklem Saum und ist auf jedem Bild sichtbar; Abdunkeln ausserhalb des Ausschnitts, Zustand nie nur über Farbe. Tag und Nacht nutzen nur Tokens (`--akzent` für den Reglergriff, 3:1 gegen den Grund).
- [ ] **40.8** Reflow: kein waagrechter Seitenscroll bei 390 bis 2560 Pixeln; die Seitenleiste steht ab 1024 Pixeln rechts, sonst unter der Fläche; die Fläche passt sich dem Bild an (mindestens 14 rem, höchstens 62 Prozent der Fensterhöhe). Auf der Fläche gilt `touch-action: none`; die übrige Seite scrollt wie sonst.
- [ ] **40.9** Bewegung: Reglergriff mit Übergang nur ohne «Bewegung reduzieren»; es gibt keine weiteren Animationen.
- [ ] **40.10** Daten und Last: Das Bild wird nur im Browser gelesen und auf Leinwänden gezeichnet (keine blob:-Adressen, die CSP bleibt `img-src 'self' data:`). Das Ergebnis entsteht neu: EXIF, Aufnahmeort und Kameradaten sind danach weg; die Ausrichtung nach EXIF wird beachtet. Die Grenzen der Schnittstelle gelten für das Ergebnis (Profilbild höchstens 5 MB und 512 Pixel, Medien höchstens 10 MB und 2048 Pixel, Logo höchstens 5 MB und 1024 Pixel); «Original verwenden» ist gesperrt, wenn das Original über 16 Millionen Pixel hat. Es gibt keine neue Route.

### Stand der Prüfung (#633)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 40.1 bis 40.10 am Profilbild (Ziehen, Mausrad, Pfeiltasten, Plus, Hochladen), an Medien (Frei und 16:9, Regler, Drehen, EXIF-Bild, Übernehmen in den Dialog) und am Stufenlogo (durchsichtiges PNG bleibt PNG, Seitenverhältnis 1:1); zwei Finger mit Zeigerereignissen; ein unlesbares Bild meldet sich am Feld; bei 1440 und 390 Pixeln, Tag und Nacht. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), ein echtes Touch-Gerät, 200 Prozent Zoom von Hand, Safari und Firefox (Leinwand-Grenzen auf iOS: das Arbeitsbild ist deshalb auf 4096 Pixel begrenzt), Kontrastwerte mit einem Messwerkzeug.

## 39. Lädeli: Verfügbarkeit je Grösse (#629)

Gilt für die Artikelliste und das Artikelblatt der Verwaltung (`public/admin/laedeli.js`, `laedeli.css`) und für Kachel, Artikelfenster, Warenkorb und Bestellübersicht der Website (`src/website/laden.ts`, `public/website/laden.js`, `laden.css`). Geprüft im Browser bei 390, 1440 px, Tag und Nacht.

- [ ] **39.1** Der Zustand einer Grösse steht nie nur in der Farbe: Symbol (Haken oder Kreuz), Durchstreichung, gestrichelter Rand und das Wort «nicht verfügbar» (im Artikelblatt im Schalter, in der Artikelliste in der Spalte «Stand» direkt daneben, auf der Website in der Notiz unter der Wahl).
- [ ] **39.2** Verwaltung: Jede Grösse ist ein Schalter (`role="switch"`, `aria-checked`, Name «S verfügbar, Cevianerpulli»), mindestens 44 × 44 px, mit sichtbarem Fokusring und Bedienung mit Enter und Leertaste. Nach dem Umschalten behält der Schalter den Fokus.
- [ ] **39.3** Verwaltung: Das Umschalten in der Liste meldet im Toast «M ist bei «Cevianertshirt» als nicht verfügbar gemeldet.» mit «Rückgängig» (Statusregion, kein Fenster, keine Frist). Fehler stehen im Toast, der Schalter bleibt unverändert.
- [ ] **39.4** Verwaltung am Handy (390 px): Jede Zeile der Artikelliste ist eine Karte; die Schalter sind ohne Seitwärtsscrollen erreichbar, «Grösse» und «Stand» tragen ihren Namen. Die Spaltenköpfe bleiben für Hilfstechnik im Dokument.
- [ ] **39.5** Website: Eine gemeldete Grösse ist sichtbar, durchgestrichen, `aria-disabled="true"` und trägt für Hilfstechnik das Wort «nicht verfügbar»; sie bleibt fokussierbar, ein Klick wählt nichts aus und sagt «S ist nicht verfügbar.» in der Statusregion. Die sichtbare Notiz «S nicht verfügbar» steht in Kachel und Artikelfenster.
- [ ] **39.6** Website: Eine entfallene Grösse im Warenkorb ist am Rand, am Symbol und am Satz in der Zeile erkennbar; das Band darüber ist eine Statusmeldung (`role="status"`, bei einer Serverantwort `alert`). «Zur Bestellübersicht» und «Bestellen» sind `aria-disabled` und sagen auf Klick, warum.
- [ ] **39.7** Kontrast: Gemeldete Grössen (Text `--l-leise` und `--on-surface-variant` auf der Fläche) erreichen in Tag und Nacht mindestens 4.5:1; der gestrichelte Rand ist nicht das einzige Merkmal. Erzwungene Farben: Schalter und Knöpfe behalten einen Rand.
- [ ] **39.8** Ohne Skript bleibt die Seite lesbar: durchgestrichene Grössen, Wort «nicht verfügbar» für Hilfstechnik, sichtbare Notiz.
- [ ] **39.9** Verwaltung: Mit Grössen gibt es nur eine Verfügbarkeit (die Schalter je Grösse) und die Hinweiszeile «Der Artikel ist bestellbar, solange mindestens eine Grösse verfügbar ist.»; bei Einheitsgrösse nur die Checkbox. Ein älterer Artikel mit Grössen und ausgeschaltetem Artikel zeigt alle Grössen als nicht verfügbar und erklärt es in der Hinweiszeile.
- [ ] **39.10** Website: Mit Sitzung steht über dem Raster «Angemeldet als …» (oder «Angemeldet») mit dem Knopf «Abmelden» (Text, mindestens 44 px Trefferfläche, Fokusring); Fehler beim Abmelden steht als Text (`role="alert"`). Nach dem Abmelden geht der Fokus zu «Zum Bestellen anmelden» und die Statusregion sagt «Du bist abgemeldet.».
- [ ] **39.11** Website: Ohne Sitzung gibt es keine Bedienelemente des Warenkorbs; endet die Sitzung (401, Abmelden, Zurück-Taste, anderer Tab), verschwinden sie, geöffnete Fenster schliessen, der Hinweis «Du bist nicht mehr angemeldet.» steht als Band (Symbol und Text) und die Statusregion sagt es.

### Stand der Prüfung (#629)

Geprüft im Browser (headless, Kopie der Demo-Datenbank) bei 390 und 1440 px, Tag und Nacht: 39.1, 39.2, 39.3 (Umschalten, Toast, Rückgängig gegen die Datenbank geprüft), 39.4, 39.5 (Klick auf die gesperrte Grösse wählt nichts, `aria-pressed="false"`), 39.6 (Sperre und Freigabe nach dem Entfernen der Zeile). Nicht geprüft: Bildschirmleser (kein Gerät), 39.7 nicht gemessen mit dem Werkzeug des Skills `barrierefreiheit-pruefen`, Zoom 200 %.

## 47. Verwaltung: Termine, Anlässe und Räume nach Rechten (#649)

Dieser Abschnitt gilt für die Stellen, die sich nach den Rechten der Person ändern: die Navigation der Bereiche «Räume», «Anlässe» und «Termine» (`navigation.js`, Signale `termine` aus `GET /api/v1/redaktion/ich`), den Anlass mit seinen Reitern (`termine-anlaesse.js`, `anlass-gemeinsam.js`), die Seite «Räume» (`termine-raeume.js`) und die Karte «Räume» in der Ansicht einer Gruppe (`tags-raeume.js`). Die Oberfläche blendet nur aus; der Server prüft jede Route.

- [ ] **47.1** Was die Person nicht darf, erscheint nicht: Ein Eintrag der Navigation, ein Reiter oder ein Knopf, der in ein 403 liefe, wird nicht gezeigt (kein ausgegrauter Knopf, der nichts erklärt). Wer nur Anmeldungen sehen darf, sieht den Anlass ohne die Reiter «Zusatzfelder» und «Einstellungen» und ohne den Knopf «Anmeldung schliessen»; wer nur verwalten darf, sieht keine Namen und keine Zahlen der Rückmeldungen.
- [ ] **47.2** Die Reiter eines Anlasses bleiben eine Navigation mit `aria-current="page"` auf dem aktiven Reiter. Öffnet jemand die Adresse eines Reiters, den er nicht sieht (`#anlaesse/<id>/felder`), zeigt die Seite die Übersicht, nie eine leere Fläche oder einen Fehler.
- [ ] **47.3** Zuständiges Team im Raum-Formular: Wer das Team nicht zuweisen darf, sieht das Team als schreibgeschütztes Feld mit demselben Namen und Hilfetext, der sagt, wer es ändert («Das Team ändert, wer Räume einem Team zuweisen darf»). Der Wert ist per Tastatur lesbar (`readonly`, kein `disabled`).
- [ ] **47.4** Karte «Räume» in der Ansicht einer Gruppe: Eine Überschrift der Ebene 2, ein Satz zur Wirkung, eine Liste der zugewiesenen Räume mit «Entziehen» (Name des Raums im Namen des Knopfs über `kontext`) und das eigene Auswahlfeld «Raum zuweisen» mit dem Knopf «Zuweisen». Die Zahl der zugewiesenen Räume steht in einer Statusregion (`role="status"`). Beide Änderungen laufen mit «Rückgängig» (acht Sekunden) und kommen bei einem Fehler an die alte Stelle zurück; es gibt kein Popup.
- [ ] **47.5** Zustände der Karte: lädt («Räume werden geladen …»), Fehler (Hinweis mit `role="alert"`), leer («Dem Team ist noch kein Raum zugewiesen.»), alle Räume vergeben («Es gibt keinen weiteren Raum.»), mehr als 100 Räume (Hinweis, den Rest unter «Räume» zuweisen).
- [ ] **47.6** Zielgrössen und Fokus wie überall in der Verwaltung: Knöpfe mindestens 44 Pixel hoch, Fokusring 3 Pixel, Tab-Reihenfolge wie die Leserichtung; bei 390 Pixeln ohne waagrechtes Scrollen (die Karte nutzt `pe-karte` und `liste-zeilen`). Keine neuen Farben, keine Animation.
- [ ] **47.7** Die Meldungen stehen in der Schweizer Schreibweise, in kurzen Sätzen, ohne Fachwörter wie «Geltung» oder «eigene»; ein fehlender zweiter Faktor führt wie überall zur Einrichtung.

### Stand der Prüfung (#649)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit drei Testkonten ohne Stufenrolle gesehen: Mitglied eines Teams mit Rolle (Seiten «Belegung», «Räume», «Anfragen» sichtbar, «Neuer Raum» fehlt, Team im Formular schreibgeschützt), OK-Mitglied «Kasse» (Anlass mit den Reitern «Übersicht» und «Anmeldungen»; die Adresse von «Zusatzfelder» zeigt die Übersicht) und OK-Leitung (alle vier Reiter, Einstellungen laden ohne Zugriff auf die Gruppenverwaltung). Die Karte «Räume» in der Gruppenansicht bei 1440 Pixeln hell und 390 Pixeln dunkel: Zuweisen und Entziehen mit «Rückgängig», Speichern nach der Frist, Auswahl mit Maus. 47.1 bis 47.5 damit geprüft. Nicht gesehen: Tastaturablauf der Karte (Tab, Pfeile in der Auswahl) durchgespielt nur mit der Maus, Zielgrössen nicht ausgemessen, Reduced Motion nicht geprüft; 47.6 und 47.7 ruhen auf den bestehenden Bausteinen. Screenreader nicht geprüft.

## 50. Verwaltung: Rechte-Matrix, Gruppenrollen und OK (#651)

Gilt für «Rollen und Rechte» (`rechte*.js`, `rechte.css`) und «OK anlegen» am Anlass. Massstab WCAG 2.2 AA.

- [ ] **50.1** Jede Zelle der Matrix ist eine Radiogruppe (`role="radiogroup"`, Segmente `role="radio"`, `aria-checked`) mit vollem Namen «Rolle: Recht»; ein Tabstopp je Zelle, Pfeiltasten wechseln und wählen, kein Zustand nur über Farbe (Wort «Aus», «Eigene», «Alle», Haken, Rand).
- [ ] **50.2** Jedes Segment ist mindestens 44 px hoch und breit; der Fokusring (3 px) liegt innen und ist in Tag und Nacht sichtbar.
- [ ] **50.3** Die Tabelle hat `caption` (für Leser), `th scope` für Spalten, Zeilen und Bereiche; der waagrecht scrollbare Bereich ist eine beschriftete Region mit Fokus. Kopf und erste Spalte bleiben beim Scrollen stehen.
- [ ] **50.4** Am Telefon und bei grosser Schrift gibt es dieselben Rechte als Karten je Rolle (Matrix/Je Rolle umschaltbar); 200 % Zoom und 390 px ohne seitliches Scrollen der Seite.
- [ ] **50.5** Geänderte Zellen zeigen den alten Stand als Text («war aus») und einen Rand; «N Änderungen» steht in einer Statusregion, jede Änderung wird angesagt.
- [ ] **50.6** Die Speicherleiste ist erreichbar und verdeckt keinen Fokus; Speichern bei grosser Wirkung ist ein zweistufiger Knopf mit Ansage und Escape. Kein Popup, keine native Rückfrage: Löschen fragt in einer Zeile am Ort mit Folgenanzeige.
- [ ] **50.7** Reihenfolge der Rollen per Ziehen, mit Leertaste und Pfeilen und mit den Knöpfen Hoch und Runter (WCAG 2.5.7).
- [ ] **50.8** Feste Punkte sind als «Fest» gekennzeichnet und erklärt, nicht nur ausgegraut.
- [ ] **50.9** Marken («2. Faktor», «Öffentlich», «Löscht») tragen Wort und Symbol; Kontrast der Marken mindestens 4.5:1 in Tag und Nacht (Tokens).
- [ ] **50.10** Ladezustände sind Skelette in der Form der Seite; Fehler tragen «Nochmals versuchen»; Reduced Motion schaltet die Übergänge ab.
- [ ] **50.11** «OK anlegen»: Seite im Fluss mit Zurück, Fehler am Feld, Rollenzeilen mit beschrifteten Haken und Namensfeldern; nach dem Anlegen führt die Seite zur neuen Gruppe.

### Stand der Prüfung (#651)

Geprüft im Browser (headless, Kopie der Demo-Datenbank) bei 1440 und 390 px, Tag und Nacht: 50.1 bis 50.5, 50.7 (Tasten), 50.8, 50.11. Mit Tastatur: Pfeil in der Zelle, Speichern zweistufig. Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack), 200 % Zoom per Browser-Einstellung, 2560 px, Kontrast-Thema.

## 43. Verwaltung: Kind mit eigenem Konto (#644)

Dieser Abschnitt gilt für `kinder.js`, `kinder-konto.js` und die Seiten «Eigenes Konto erstellen» und «Konten für Kinder». Die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss. Alles sind Seiten im Fluss; Rückfragen stehen am Knopf (zweistufig), nie in einem Popup.

- [ ] **43.1** Der Zugang eines Kindes steht als Wort mit Symbol (Kein Zugang, Eltern verknüpft, Eigenes Konto, Eltern und eigenes Konto), nie nur als Farbe; «Kein Zugang» ist ein ruhiger Hinweis, kein Fehler. Die Gruppierung «Zugang» und der Filter «Mit eigenem Konto» benennen dieselben Zustände.
- [ ] **43.2** Auf der Karte «Eigenes Konto» hat jede Aktion einen Titel, einen Erklärsatz und einen Knopf mit Namen (44 Pixel hoch). Folgenreiche Aktionen (Konto übergeben, neues Startpasswort, sperren, entfernen) sind zweistufig: Der erste Klick stellt die Frage im Knopf und sagt sie als Zustandsmeldung an, der zweite führt aus, Escape nimmt zurück.
- [ ] **43.3** «Eigenes Konto erstellen» hat beschriftete Felder (Benutzername mit Vorschlag und Hilfetext, Haken «Die Eltern sind informiert und einverstanden», Datumsfeld «Informiert am», Haken zur Einsicht der Eltern). Fehlt etwas, nennt eine Zusammenfassung «n Angaben prüfen» mit einem Knopf je Feld, und am Feld steht der Fehler als Text mit Symbol. Ein vergebener Benutzername steht am Feld.
- [ ] **43.3a** Das Startpasswort erscheint genau einmal in der Karte im Fluss (Kopieren-Knopf, Zustandsmeldung «Kopiert.»), beim Schliessen ist der Text aus der Seite gelöscht; bei offenem Startpasswort lässt sich die Anzeige in der Karte «Eigenes Konto» wieder öffnen.
- [ ] **43.4** «Konten für Kinder» (Einstellungen) hat beschriftete Felder, das eigene Auswahlfeld der Verwaltung für Chat und Mindestalter und Hilfetexte; der Satz, was ein Konto sieht, steht als Liste.
- [ ] **43.5** Hell, Dunkel, «Bewegung reduzieren» und erzwungene Farben; Kontrast der Marken, Chips und Texte wie in den Tokens (4.5 : 1).
- [ ] **43.6** 320, 390, 720, 1440, 1920 und 2560 Pixel: nichts scrollt waagrecht, die Aktionen der Karte brechen unter den Text.

### Stand der Prüfung (#644)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Demo-Daten gesehen: 43.1 bis 43.3a bei 1440 Pixel Hell (Liste, Kind mit Konto, Erstellen mit Fehlerzusammenfassung und mit Startpasswort, Einstellungen), dazu das Konto eines Kindes in der Verwaltung («Kein Zugang», 403). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, erzwungene Farben, Kontrastwerte mit einem Messwerkzeug, Bewegung reduzieren, 2560 Pixel, der Ablauf der zweistufigen Knöpfe mit Tastatur.

## 45. Website: Stufenseite, Tafel und «Mitnehmen» (#645)

Gilt für die blaue Tafel `dl.fakten.karte` der Stufenfakten (`stufenfakten.ts`, `mitnehmen.ts`, `rendern.ts`, Stil in `website.css`). Geprüft im Browser (Chromium, headless) bei 195 (200 % von 390), 390, 720 (200 % von 1440), 1024, 1440 und 2560 Pixeln, Tag und Nacht, ohne Skript, mit erzwungenen Farben.

- [ ] **45.1** Struktur: Die Tafel bleibt eine Definitionsliste (`dl` mit `div.fakt`, `dt`, `dd`). «Mitnehmen» ist darin eine echte Liste (`dd > ul.mitnehmen[role=list] > li`, die Rolle hält die Liste für Safari und VoiceOver trotz `list-style: none`); die Zahl der Einträge ist für Hilfstechnik hörbar, nicht nur sichtbar.
- [ ] **45.2** Lesbarkeit: Die Einträge stehen in Lesegrösse (18 px, Zeilenhöhe 26 px) und normaler Stärke; kurze Fakten bleiben die einzigen fetten Werte. Ein langer Text in der Tafel hat nie die Wirkung einer Überschrift.
- [ ] **45.3** Kontrast: Eintrag weiss auf `--secondary` 11.4:1, Beschriftung `--on-secondary-muted` 7.6:1 (gemessen, Tag und Nacht gleich). Der Haken hat die Farbe des Texts; Zustand und Bedeutung hängen nicht an der Farbe.
- [ ] **45.4** Haken ohne Bild: Der Haken ist ein gezeichneter Rand (`li::before`), kein SVG und kein Bild; er ist dekorativ und wird nicht vorgelesen. In erzwungenen Farben nimmt er die Textfarbe des Systems.
- [ ] **45.5** Reflow: einspaltig in der schmalen Tafel und am Handy, zweispaltig, sobald zwei Spalten à 11 rem Platz haben (Tafel über Seitenbreite, z. B. bei 200 % Zoom auf 1440 Pixeln); kein waagrechter Scroll durch die Tafel, lange Wörter brechen um (`overflow-wrap`, Silbentrennung `de`).
- [ ] **45.6** Ohne Skript und mit strenger CSP: Die Liste ist statisches HTML, keine Inline-Stile, keine Bilder; sie steht auch im nachgeladenen, geschützten Baustein.
- [ ] **45.7** Text bleibt Text: Freitext ohne Trenner, ein einzelnes Ding oder mehr als 30 Einträge stehen als Absatz im selben Stil (nichts geht verloren); Markup in Einträgen wird maskiert angezeigt.
- [ ] **45.8** Keine Bewegung: Die Tafel hat keine Animation.

### Stand der Prüfung (#645)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank) bei 195, 320, 390, 720, 1024, 1440 und 2560 Pixeln, Tag und Nacht, mit ausgeschaltetem Skript und in erzwungenen Farben geprüft; Randfälle (ein Ding, Satz ohne Komma, Zeilenumbrüche mit Aufzählungszeichen, Klammern, offene Klammer, 31 Einträge, Markup, sehr langes Wort). Kontrast mit eigener Berechnung. **Nicht geprüft:** Bildschirmleser (NVDA, VoiceOver, TalkBack; die Ansage der Liste ist nicht gehört), Zoom 400 %.

## 46. Verwaltung und Website: Orte der Samstagsangaben (#646)

Gilt für `website-orte.js`, `website-orte.css`, `orte-logik.js` und die Ortswahl in `website-stufenfakten.js` sowie für den Verweis «Auf Google Maps ansehen» in der Tafel der Stufenseite (`.fakt-karte`). Die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss.

- [ ] **46.1** Die beiden Reiter «Angaben» und «Orte» sind Links in einer `nav` mit Beschriftung; der aktive trägt `aria-current="page"`, der Zustand ist auch am Strich und am Gewicht erkennbar, nicht nur an der Farbe. Der Browser-Zurück führt von «Orte» zu «Angaben».
- [ ] **46.2** Die Liste der Orte ist eine Sortierliste: Ziehen am Griff, Tastatur (Leertaste nimmt auf, Pfeile bewegen, Leertaste legt ab, Escape bricht ab) und die Knöpfe Nach oben und Nach unten (WCAG 2.5.7); die neue Reihenfolge wird angesagt. Jede Zeile nennt Name, Adresszeile, Verwendung und Standort als Text («Standort bestätigt» mit Haken, «Standort nicht bestätigt» mit Warnzeichen, «Ohne Standort»).
- [ ] **46.3** Jeder Knopf der Zeile hat einen Namen mit dem Ort («Bearbeiten: Pfadiheim»), ist 44 Pixel hoch und liegt in der Tabulatorfolge. Löschen: ohne Verwendung gleich mit «Rückgängig» im Toast; wird der Ort noch gebraucht, fragt der Knopf in zwei Stufen («Trotzdem löschen?», Statusansage, Escape nimmt zurück), nie mit einem Popup des Browsers.
- [ ] **46.4** Das Formular ist eine Seite im Fluss mit eigenem Verlauf. Alle Felder haben sichtbare Beschriftung und Hilfetext; der Standort sagt nach dem Tippen in einer höflichen Statusregion, was der Server gelesen hat («Gelesen als Koordinaten: 47.2391, 8.7258»), oder zeigt den Fehler in Worten beim Feld (`aria-invalid`, die Meldung gehört zu `aria-describedby`). Ein abgelehnter Standort hält das Speichern auf und setzt den Fokus ins Feld. Der Verweis zur Karte öffnet in einem neuen Tab und sagt es (`(Google Maps, öffnet in neuem Tab)` für Screenreader); seine Form steht in 51.5.
- [ ] **46.5** Die Ortswahl in den Angaben ist das Auswahlfeld der Verwaltung (Combobox, Pfeiltasten, Tippen springt). Die Überschriften «Zuletzt verwendet» und «Alle Orte» sind gesperrte Einträge, die Pfeiltasten überspringen. «Neuer Ort …» öffnet das Formular, bei Abbruch bleibt die alte Wahl; nach dem Speichern ist der neue Ort gewählt. «Anderer Ort (Freitext)» zeigt ein Textfeld mit eigener Beschriftung («Treffpunkt als Text»).
- [ ] **46.6** Website: Der Verweis ist ein externer Link (Pfeil nach oben rechts, für Screenreader «(externe Seite)»), seit #661 ein Pill mit Rand und Standort-Symbol (51.6), 44 Pixel hoch, weiss auf der blauen Tafel (Kontrast 11.4 : 1), Fokusring hell (3 Pixel, `--on-secondary`) und in erzwungenen Farben als Linkfarbe sichtbar. Er braucht kein Skript, lädt keine Karte und setzt keine Cookies; Name und Adresszeile stehen als Text vor dem Verweis.
- [ ] **46.7** 390, 1024, 1440 und 2560 Pixel, Tag und Nacht: nichts scrollt waagrecht; auf dem Handy stehen Standort und Knöpfe unter dem Text, die Knöpfe nebeneinander. 200 Prozent Zoom ohne Seitenscroll.
- [ ] **46.8** Leerzustand («Noch keine Orte.» mit Knopf «Neuer Ort»), Ladezustand (Skeleton der Seite), Fehler (Zustandskarte mit «Nochmals versuchen») und «Kein Recht» (403) sind vorhanden.

### Stand der Prüfung (#646)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Orten gesehen: 46.1 (Reiter und Zustand; Browser-Zurück nicht von Hand geprüft), 46.2 (Knopf Nach unten mit Speichern nach der Frist; Tastatur und Ziehen sind die der gemeinsamen Sortierliste, hier nicht erneut geprüft), 46.3 (Rückgängig, zweite Stufe), 46.4 (Fehlerfall mit fremdem Host, gültiger Link, Speichern), 46.5 («Neuer Ort …» aus der Auswahl, Liste mit Überschriften) bei 1440 und 390 Pixel, Tag und Nacht, und 46.6 bei 390, 1024 (ohne Skript), 1440 und 2560 Pixel, Tag und Nacht, mit Tastatur (Tab auf den Verweis, Fokusring hell) und in erzwungenen Farben. Nicht geprüft: Screenreader (VoiceOver, TalkBack, NVDA), 200 Prozent Zoom von Hand, 46.8 Fehlerzustand (nur Leer- und Normalzustand gesehen).

## 48. Verwaltung: Zugang nach Rechten (#648)

Gilt für die Navigation der Verwaltung (`public/admin/navigation.js`, `admin.js`) und die Detailseite eines Lagers (`lager.js`), soweit sie dem Recht der Person folgen. Die Oberfläche zeigt nur Seiten, die der Server dieser Person öffnet; der Server prüft jede Route neu.

- [ ] **48.1** Eine Seite, die für die Person in ein 403 liefe, erscheint nicht in der Navigation (weder Bereichsleiste noch Unterleiste noch Suche). Es gibt keine ausgegraute oder tote Auswahl, deren Grund nur ein Tooltip nennt.
- [ ] **48.2** Eine Person, die nur ein Recht für einen Bereich hat (zum Beispiel Lädeli), landet nach der Anmeldung in diesem Bereich und sieht keine leere Übersicht. Bereiche ohne sichtbare Seite fehlen ganz.
- [ ] **48.3** Hat die Person kein Recht, das die Verwaltung öffnet, steht auf der Seite der Text «Dieses Konto hat keinen Zugang zur Verwaltung.» mit Statusangabe (Symbol und Text, nicht nur Farbe).
- [ ] **48.4** Fehlt der zweite Faktor, sagt die Meldung in Worten, was zu tun ist; sie steht in einer Statusregion und verschwindet nicht von selbst.
- [ ] **48.5** Lager ohne das Recht, Mitglieder zu vergeben: Das Lager zeigt nur Angaben und Stand. Der Abschnitt «Mitglieder» und die Verweise darauf fehlen, es bleibt keine Zahl «0 Mitglieder» stehen, die falsch wäre.
- [ ] **48.6** Reihenfolge von Fokus und Überschriften bleibt gleich, wenn Abschnitte entfallen (eine Überschrift der Ebene 1 pro Seite, keine übersprungenen Ebenen).
- [ ] **48.7** Tastatur: Jede sichtbare Seite ist mit Tab und Enter erreichbar; die Reihenfolge der Unterleiste folgt der Reihenfolge im Quelltext.

### Stand der Prüfung (#648)

Geprüft: 48.1 bis 48.3 und 48.5 am Quelltext und in den Tests (`test/admin-navigation.test.ts`, `test/rechte-website-lager-plattform.test.ts`: Antwort von `GET /api/v1/redaktion/ich` je Rolle). Die Navigation ist in dieser Änderung nicht neu gestaltet; es kommen nur Bedingungen dazu. Nicht im Browser geprüft: Screenreader, 200 % Zoom, 390 px; 48.4, 48.6 und 48.7 folgen aus unveränderten Bausteinen und gelten als nicht geprüft, bis die Vorschau durchgegangen ist.

## 51. Verwaltung und Website: Leisten, «Was darf wer?» und Verweis zur Karte (#661)

Gilt für den Kopf der Verwaltung (`geruest.css`, `rahmen.js`), die Karte «Person» unter «Rollen und Rechte > Was darf wer?» (`rechte-uebersicht.js`, `rechte.css`, Logik in `rechte-modell.js`) und den Verweis zur Karte (`website-orte.js/css`, `.fakt-karte` in `website.css`, `rendern.ts`). Die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss.

- [ ] **51.1** Die drei Leisten (Logozeile, Bereichsleiste, Unterleiste) waren in #661 gleich hoch (3.5rem); seit #667 haben sie die Höhen der Website (siehe 54.1). Schrift (1 rem), Innenabstand (0.75 rem) und der rote Strich (3 Pixel auf der Linie) sind in Bereichs- und Unterleiste dieselben, die Unterleiste ist wie auf der Website leiser (siehe 54.2); der aktive Punkt ist fett und blau, der Strich ist nicht der einzige Hinweis. Zähler bleiben runde 24-Pixel-Kreise, die Zahl in der Mitte.
- [ ] **51.2** Unter 960 Pixel ersetzt die Bereichsauswahl beide Leisten und ist ebenso hoch wie die Logozeile (64 Pixel, siehe 54.1); die Logozeile bleibt eine Zeile (Konto, Suche, «Abmelden» und Umschalter nur als Symbol, der Name steht für Screenreader im Knopf, `abmelden-text`; «Verwaltung» entfällt; unter 520 Pixel bleibt von der Marke das Wort «CEVI»). Alle Ziele sind 44 Pixel gross, nichts scrollt waagrecht (gemessen ab 345 Pixel Fensterbreite).
- [ ] **51.3** «Person» unter «Was darf wer?»: Die Suche misst 52 Pixel (nur das Feld); darunter steht die Zahl der Treffer in einer Statusregion («20 Personen», «Keine Person gefunden»). Die Liste scrollt in der Karte (höchstens 46 rem oder Fensterhöhe minus Leisten), die Karte bleibt ab 960 Pixel unter der Bereichsleiste stehen, die Suche bleibt oben. Die gewählte Zeile liegt im Blick; die Seite scrollt dafür nicht.
- [ ] **51.4** Jede Zeile nennt Bild oder Initialen, Name, die Rolle im Klartext («Abteilungsleitung», «Stufenleitung Artemis», «Leitung Exodus») und, wo der Name mehrfach vorkommt, Cevi-Name und Benutzername. Die Zeile ist ein Link mit `aria-current="true"`; der Zustand erkennt man an Fläche und Gewicht, nicht nur an der Farbe. Die Detailkarte nennt oben Name, Rolle, Cevi-Name und Benutzername, rechts die Zahl der Rechte (ohne Umbruch). Ohne Wahl steht rechts eine kleine Karte mit einem Satz, keine hohe leere Fläche. Schmal rückt die Detailkarte nach der Wahl ins Bild.
- [ ] **51.5** Verwaltung, Orte: «Auf Karte ansehen» ist ein kleiner Knopf (`knopf--klein`, 44 Pixel) in der Gruppe der Aktionen, vor «Bearbeiten», mit Standort-Symbol, Beschriftung und dem Zeichen für eine fremde Seite; Fläche der Chips (`--blau-f`, Text `--auf-blau-f`), Rand beim Zeigen. Screenreader hören «(Google Maps, öffnet in neuem Tab)». Link mit `target="_blank"` und `rel="noopener noreferrer"`, kein Skript. Unter 30 rem bricht die Beschriftung um, statt über den Rand zu laufen.
- [ ] **51.6** Website, Tafel der Stufenseite: «Auf Google Maps ansehen» ist ein Pill mit Rand (55 Prozent Weiss auf Blau), Standort-Symbol vorn, Pfeil für «externe Seite» hinten, ohne Strich im Ruhezustand, beim Zeigen gefüllt und unterstrichen, 44 Pixel hoch, Text weiss auf Blau (11.4 : 1), Fokusring hell. Weiterhin nur ein Link: keine Karte, kein Skript, keine Cookies, `rel="noopener noreferrer"`.
- [ ] **51.7** Reihenfolge von Fokus und Überschriften ändert sich nicht: Die Leisten bleiben `nav` mit Beschriftung, die Liste der Personen ist eine `ul` mit der Beschriftung «Personen».

### Stand der Prüfung (#661)

Im Browser (Chromium, headless) gegen eine Kopie der Demo-Abteilung mit erfundenen Personen (zwei mit demselben Namen) und Orten gemessen und gesehen: 51.1 bei 390, 1440, 1920 und 2560 Pixel, Tag und Nacht (alle drei Leisten 56 Pixel), 51.2 bei 345, 390 und 820 Pixel, 51.3 und 51.4 bei 390, 1440 und 1920 Pixel, Tag und Nacht (Suche 52 Pixel, vorher 280), 51.5 bei 390 und 1440 Pixel, Tag und Nacht, 51.6 bei 390, 1440 und 1920 Pixel, Tag und Nacht. **Nicht geprüft:** Bildschirmleser (NVDA, VoiceOver, TalkBack), Zoom 400 Prozent, erzwungene Farben von Hand, Tastatur durch die ganze Liste mit mehr als 100 Personen.

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

## 49. Verwaltung: Rechte für Personen, Kinder, Gruppen und Stufenarbeit (#650)

Dieser Abschnitt gilt für den Server (`/api/v1/admin/personen`, `kinder`, `tags`, `stufen`, `import`, `mitteilungen`, `plattform/rollen`, die Programme und die Anwesenheit). Die Änderung baut keine Oberfläche: Die Seiten der Verwaltung bleiben, wie sie sind; neu ist, dass der Server die Rechte der Rollen kennt und `GET /api/v1/ich` sie als `rechte` liefert. Die Abschnitte 1 bis 4 und 6 gelten für jede Oberfläche, die diese Rechte später zeigt (Rechte-Matrix, Navigation nach Recht).

- [ ] **49.1** Eine Person ohne Recht oder ohne zweiten Faktor bekommt 403 mit dem Text des Servers (`ZWEITER_FAKTOR_FEHLT` führt zur Einrichtung); die Oberfläche zeigt ihn als Meldung mit `role="alert"` beim Bereich, nicht nur als Farbe. Der Server antwortet in dieser Reihenfolge: 404, 403, zweiter Faktor, 409.
- [ ] **49.2** `rechte` aus `GET /api/v1/ich` sind Kennungen. Eine Oberfläche übersetzt sie in Klartext des Katalogs (`klartext`, `erklaerung`), zeigt nie die Kennung allein, und zeigt «alle» und «eigene» mit Worten («alle Gruppen», «nur die eigene Gruppe»), nie nur mit einem Symbol oder einer Farbe.
- [ ] **49.3** Die Navigation blendet aus, was der Server nicht erlaubt (nur Komfort, die Prüfung bleibt auf dem Server). Eine Seite, deren Recht fehlt, zeigt den Satz «Kein Zugriff» mit der Rückkehr zur Übersicht, nie eine leere Seite.

### Stand der Prüfung (#650)

Geprüft mit Tests gegen die API (`test/rechte-personen.test.ts`, Rechte-Matrix, OpenAPI). **Nicht geprüft:** jede Oberfläche, denn es gibt keine neue; Screenreader, Tastatur und Kontrast sind für die Punkte 49.1 bis 49.3 offen, bis eine Seite die Rechte zeigt (Rechte-Matrix, #651).

## 52. Verwaltung: Änderungsprotokoll (#662)

Dieser Abschnitt gilt für `protokoll.js`, `protokoll-liste.js`, `protokoll-text.js` und `protokoll.css` (System, Protokoll). Die Seite zeigt nur noch Änderungen (wer, wann, was) und in einem zweiten Reiter Sicherheitsereignisse. Die Abschnitte 1 bis 4, 6, 9, 17 und 41 gelten sinngemäss; 41.2, 41.3 und 41.5 sind durch 52.2 bis 52.5 ersetzt.

- [ ] **52.1** Die Seite hat zwei Reiter, «Änderungen» (Vorgabe) und «Sicherheit», als Gruppe von Knöpfen mit `aria-pressed` (Name der Gruppe «Art der Einträge»). Der Erklärtext wechselt mit dem Reiter und nennt, was nicht erfasst wird (Klicks, Ansichten, abgelehnte Anfragen, Alltagseingaben) und wo Fehlanmeldungen stehen. Der Reiter «Sicherheit» zeigt keine Aktion als Filter.
- [ ] **52.2** Jede Zeile ist ein Knopf (44 Pixel hoch, sichtbarer Fokus). Hauptzeile ist der Satz zur Änderung («Rolle «Kasse» der Gruppe «OK Kirmes» geändert»), darunter Person mit Funktionen, dann Bereich, Felder (höchstens vier, der Rest als «+n»), Rechte («+2 Rechte, −1 Recht») und Vorher/Nachher als Text. Der Name des Knopfes nennt Person, Funktionen, Art, Aktion, Satz und die absolute Zeit; die Aktion steht als Marke mit Symbol und Wort (Angelegt, Geändert, Gelöscht …), nie nur als Farbe. Zeilen ohne Person (System, Kommandozeile) tragen ein Symbol statt der Initialen.
- [ ] **52.3** Sicherheitszeilen tragen die Marke «Fehlgeschlagen» oder «Begrenzt» mit Symbol und Statuszahl und «n-mal», der rote Rand verstärkt sie nur. Es gibt keinen Ergebnis-Filter und keine Fehlerzahl mehr.
- [ ] **52.4** Die Werkzeugleiste hat beschriftete Felder (Von, Bis, Person, Suche, Bereich, Aktion); Bereich und Aktion sind die eigenen Auswahlfelder der Verwaltung mit deutschen Namen. Gesetzte Filter stehen als Knöpfe mit Namen («Filter entfernen: Aktion Gelöscht»); die Trefferzahl ist eine Zustandsmeldung. Tippen in Textfeldern fragt erst nach 350 Millisekunden.
- [ ] **52.5** Vier Kennzahlen (Änderungen heute, Letzte 7 Tage, Beteiligte Personen, Sicherheit in 7 Tagen mit Knopf «Ansehen»); im Reiter «Sicherheit» vier andere. Das Diagramm «Änderungen je Tag/Stunde» hat nur eine Farbe, eine Beschriftung mit allen Werten, ist mit Pfeiltasten ablesbar und hat als Entsprechung aufklappbare Tabellen (44 Pixel hohe Überschrift «Zahlen als Tabelle»).
- [ ] **52.6** Das Detail ist eine Seite im Fluss mit eigenem Verlaufseintrag (Zurück, Browser-Zurück und Escape schliessen sie, der Fokus kehrt zur Zeile zurück). Abschnitte mit Überschrift der Ebene 3: «Was sich geändert hat» (Objekt, Ort, Felder, Rechte neu, Rechte entzogen, Geltung geändert, Vorher und nachher, weitere Angaben; bei Sicherheit und System «Was geschah»), «Wer und wann», «Technische Angaben» (eingeklappt, Überschrift 44 Pixel hoch). Leere Abschnitte und Zeilen fehlen; Werte nur als Text. «Alle Einträge dieser Person / zu diesem Objekt / dieser Anfrage» sind Knöpfe.
- [ ] **52.7** Leer- (mit und ohne Filter, je nach Reiter), Lade- (Skeleton), Fehlerzustand (Zustandskarte mit «Nochmals versuchen») und der Export als `role="status"` sind vorhanden. «Aktualisieren» holt neue Einträge auf Wunsch, nie im Takt.
- [ ] **52.8** Hell, Dunkel, «Bewegung reduzieren» (Übergänge nur unter `no-preference`) und erzwungene Farben (Rand der Sicherheitszeile, Spur und Feldmarken bleiben als Linie). 320, 390, 720, 1440 und 2560 Pixel: nichts im Protokoll scrollt waagrecht; auf dem Handy rutschen Marke und Zeit unter den Text.

### Stand der Prüfung (#662)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Demo-Daten gesehen: 52.1 bis 52.4 und 52.6 (Hell und Dunkel, 1440 und 390 Pixel), 52.5 ohne Messung der Kontraste, 52.6 mit Tastatur (Enter auf der Zeile, Escape, Fokus kehrt zurück), 52.7 (Leerzustand per Suche, Fehlerzustand mit abgebrochener Anfrage), 52.8 Überlauf bei 390, 720, 1440 und 2560 Pixel (keiner im Protokoll). Bei 320 Pixel läuft die Kopfzeile der Verwaltung (Schalter Hell/Dunkel) 32 Pixel über; das gehört nicht zum Protokoll. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, erzwungene Farben im Browser, Kontrastwerte mit einem Messwerkzeug, Bewegung reduzieren im Browser (nur der Quelltext), Skeleton-Optik.

## 53. Verwaltung: Zeile «Abteilungsleitung» in «Rollen und Rechte» (#663)

Gilt für die Zeile «Abteilungsleitung» (Reiter «Rollen», `rechte-rollen.js`, `rechte-matrix.js`) und die Sicht des Entwicklers auf «Rollen und Rechte». Massstab WCAG 2.2 AA.

- [ ] **53.1** Eine gesperrte Rolle (die Abteilungsleitung für sich selbst, alle Rollen für den Entwickler) zeigt in jeder Zelle Symbol, Wort und Zustand («Gesperrt: An», «Gesperrt: Aus») und für Leser den vollen Satz mit dem Grund («Diese Rechte setzt der Entwickler», «Nur lesen»). Der Zustand steht nie nur in Farbe oder Grau.
- [ ] **53.2** Über der Tabelle steht eine sichtbare Erklärung mit Symbol («Diese Rechte setzt der Entwickler. Du kannst sie nicht ändern.»), nicht nur ein Tooltip; die Seite der Rolle erklärt es in Worten, auch auf dem Telefon in der Karte «Abteilungsleitung».
- [ ] **53.3** Die Zeile «Abteilungsleitung» trägt die Marke «Eingebaut», kein Umbenennen, kein Löschen, keine Personenliste; die Spaltenüberschrift sagt «Jedes Konto der Abteilungsleitung» statt einer Zahl.
- [ ] **53.4** Für den Entwickler zeigt die Seite nur den Reiter «Rollen»; die anderen Reiter fehlen ganz (kein totes Menü) und die Navigation führt ohne die Seiten der Personen. Es erscheinen keine Namen von Personen.
- [ ] **53.5** Das Speichern der Rechte der Abteilungsleitung ist ein zweistufiger Knopf mit Klartext der Folge («Das ändert, was die Abteilungsleitung darf»), mit Escape und Ansage; die Vorschau sagt «Gilt für jedes Konto der Abteilungsleitung».
- [ ] **53.6** Tastatur, Fokus, Zielgrösse 44 px, 200 % Zoom und 390 px wie Abschnitt 50; die gesperrte Zelle ist kein Tabstopp, weil sie nichts auslöst, ihr Text ist aber für Leser lesbar.

### Stand der Prüfung (#663)

Geprüft im Browser (headless, Kopie der Demo-Datenbank) bei 1440 und 390 px, Tag und Nacht, aus Sicht der Abteilungsleitung und des Entwicklers: 53.1 bis 53.5. Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack), 200 % Zoom per Browser-Einstellung, 2560 px, Kontrast-Thema, 53.6 mit der Tastatur über alle Bildschirmgrössen.

## 57. Verwaltung: Lager-Arbeitsbereich (#672)

Gilt für `lager-rahmen.js`, `lager-module.js`, `lager-detail.js`, `lager-konflikt.js`, `lager-ereignisse.js`, `lager-start-teile.js`, `lager-m-heute.js`, `lager-m-woche.js`, `lager-m-check.js`, `lager-m-suche.js`, `lager-m-ressorts.js`, `lager-m-benachrichtigungen.js` und `lager-rahmen.css`. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6 und 9 gelten sinngemäss. Die Module der weiteren Lager-Issues nutzen denselben Rahmen und weisen ihre Punkte in eigenen Abschnitten nach.

- [ ] **57.1** Die Navigation der Module ist ein `nav` mit Namen («Bereiche von «Lager»»), Gruppen mit Überschrift (Ebene 2) und Listen; die Seite, auf der du bist, trägt `aria-current="page"` und ist zusätzlich gefüllt und fett (nie nur Farbe). Jeder Eintrag ist 44 px hoch und hat einen sichtbaren Fokus.
- [ ] **57.2** Unter 900 px klappt die Navigation hinter einem Knopf auf, der den aktuellen Bereich nennt (`aria-expanded`, `aria-controls`); über 900 px steht sie links und bleibt beim Scrollen sichtbar.
- [ ] **57.3** Die Navigation zeigt nur Module, für die die Rolle im Lager das Leserecht hat; ein Modul ohne Recht, das über die Adresse erreicht wird, zeigt eine Zustandskarte «Dieser Bereich ist für dich nicht freigegeben» mit Fehlernummer, nicht eine leere Seite. Ein ungültiger Modulname zeigt «Diesen Bereich gibt es nicht».
- [ ] **57.4** Seitentitel (Ebene 1) ist der Name des Lagers, der Titel des Moduls steht als Ebene 2, Karten darin als Ebene 3. Status (Chip mit Wort und Symbol) und Hinweis «schreibgeschützt» stehen im Kopf; ein geschlossenes Lager blendet Schreib-Knöpfe aus und sagt es in Worten.
- [ ] **57.5** Das Suchfeld im Kopf hat ein Label (nur für Screenreader), die Suche ein eigenes Formular mit `role="search"`; Treffer, Anzahl und Fehler stehen in `role="status"` beziehungsweise `role="alert"`. Der Suchbegriff steht nie in der Adresse.
- [ ] **57.6** Zustände nie nur über Farbe: Check (Bereit, Mit Hinweisen, Nicht bereit; Offen, Hinweis), Fristen («Überfällig seit …»), Gelesen und Neu, Besetzung («1 von 2») tragen Wort und Symbol.
- [ ] **57.7** Kästchen und Schalter sind die eigenen (`.wahl`, `role="switch"` mit `aria-checked` und Name); Aufgaben und Check-Punkte lassen sich per Tastatur abhaken, das Löschen geht über «Rückgängig», die Reihenfolge der Ressorts per Ziehen, mit Tastatur (Leertaste, Pfeiltasten) und mit Hoch/Runter-Knöpfen.
- [ ] **57.8** Ein Versionskonflikt (409) zeigt am Ort der Zeile, was jetzt auf dem Server steht, und lässt wählen («Meine Änderung übernehmen», «Stand des Servers übernehmen»); in Formularen steht der Stand im Fehlertext. Es wird nie still überschrieben.
- [ ] **57.9** Der Hinweis «Es gibt Neues im Lager» (Event-Stream) ist `role="status"` und nimmt den Fokus nicht; die Seite lädt nur auf Knopfdruck neu. Kein Takt, kein Polling.
- [ ] **57.10** Lade-, Leer- und Fehlerzustände sind vorhanden (Skeleton, Leerkarte, Zustandskarte mit «Nochmals versuchen»); Bewegung nur unter `prefers-reduced-motion: no-preference`; 390 bis 1920 px ohne waagrechtes Scrollen; Hell und Dunkel.

### Stand der Prüfung (#672)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung gesehen: 57.1 bis 57.4, 57.6, 57.10 bei 1440 und 390 px, Hell und Dunkel (Heute, Check, Ressorts mit Detail und Notiz, Benachrichtigungen). Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack), Kontrast-Thema, 200 % Zoom per Browser-Einstellung, 2560 px, 57.5 bis 57.9 nur teilweise mit der Tastatur.

## 58. Verwaltung: Lager, Aufgaben, Zeitplan und To-dos (#670)

Gilt für `lager-m-aufgaben.js`, `lager-aufgaben-neu.js`, `lager-aufgaben-detail.js`, `lager-m-zeitplan.js`, `lager-m-todos.js`, `lager-aufgaben-gemeinsam.js`, `lager-aufgaben-logik.js` und `lager-aufgaben.css`. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9, 15 und 57 gelten sinngemäss.

- [ ] **58.1** Die Aufgabenliste hat vier Ansichten als Gruppe von Knöpfen mit `aria-pressed` (Name «Ansicht»): Tabelle, Board, Meine, Reihenfolge (nur mit dem Recht, Aufgaben zu bearbeiten). Die Tabelle gruppiert nach Frist, Person oder Ressort; die Gruppen sind Zeilen mit Überschrift und Zahl («Überfällig (1)»). Spaltenköpfe sortieren (`aria-sort`).
- [ ] **58.2** Jede Zeile hat ein eigenes Kästchen «Auswählen: Titel» und einen runden Knopf «Erledigt: Titel» beziehungsweise «Wieder öffnen: Titel» (`aria-pressed`, 44 px). Erledigt ist Haken, Wort «Erledigt» und gefüllter Knopf, nie nur Farbe; «Überfällig seit 3 Tagen» trägt Symbol und Wort. Nach dem Abhaken bietet die Rückmeldung «Rückgängig» an.
- [ ] **58.3** Die Mehrfachauswahl steht in einer Leiste mit dem Namen «Mehrfachauswahl»: Zahl der gewählten Aufgaben als `role="status"`, Knöpfe Status, Person, Frist, Ressort, Löschen und «Auswahl aufheben». Jede Änderung hat ein kleines Formular am Ort (eigene Auswahlfelder, eigenes Datumsfeld), kein Popup. Löschen läuft über «Rückgängig» (die Anfrage geht erst nach der Frist hinaus). Das Ergebnis nennt, was geändert wurde und was nicht (Konflikt, Fehler).
- [ ] **58.4** Das Board hat eine Spalte je Status als Bereich mit Namen («Aufgaben mit Status Offen»), die Spaltenüberschrift Ebene 2 mit Zahl. Reihenfolge: Ziehen am Griff, Tastatur (Leertaste nimmt auf, Pfeile bewegen, Leertaste legt ab, Escape bricht ab) und Knöpfe «Nach oben» und «Nach unten» (WCAG 2.5.7). Den Status ändert das Menü «Mehr» an der Karte («Verschieben nach «Läuft»»). Ziehen von Spalte zu Spalte gibt es nicht; das Menü ersetzt es. Das Board scrollt waagrecht in einem fokussierbaren Bereich mit Namen.
- [ ] **58.5** Die Seite «Reihenfolge» ordnet alle (gefilterten) Aufgaben mit der Sortierliste (Griff, Tastatur, Knöpfe, Ansage der Position) und «Rückgängig». Über 200 Aufgaben erklärt die Seite, dass erst gefiltert werden muss.
- [ ] **58.6** Filter: Suche, Ressort, Person, Status, Frist, Gemerkt als beschriftete Felder; gesetzte Filter stehen als Knöpfe («Filter entfernen: …»), die Trefferzahl in `role="status"`. Ohne Treffer steht ein Satz mit «Filter zurücksetzen».
- [ ] **58.7** Neue Aufgabe, Schnelleingabe, Vorlage anwenden, «Später erinnern», Meilenstein, Lagertag und Abschnitt sind Seiten im Fluss (Zurück, Browser-Zurück und Escape schliessen sie, der Fokus kehrt zurück). Beim Anlegen warnt eine Meldung mit `role="alert"` vor einer ähnlichen Aufgabe; ein zweiter Klick legt trotzdem an.
- [ ] **58.8** Die Schnelleingabe zeigt den Vorschlag des Servers als Liste: je Zeile Kästchen «Anlegen: Titel», Titel, erkannte Person, Ressort und Frist als Text. Ein unklarer Treffer («Zu @Jo passen mehrere Personen», «#Mat habe ich nicht gefunden») hat ein beschriftetes Auswahlfeld («Bitte wählen», «Keine Angabe»); die Zeile ist erst bereit, wenn alles entschieden ist. Der Knopf nennt die Zahl («3 Aufgaben anlegen»).
- [ ] **58.9** Das Detail einer Aufgabe hat Abschnitte mit Überschrift (Angaben, Checkliste, Links, Stichworte, Ähnliche Aufgaben, Verlauf). Ungespeicherte Änderungen zeigt eine Leiste «Ungespeicherte Änderungen» mit «Speichern» und «Verwerfen». Die Checkliste hat eigene Kästchen, Bearbeiten, Löschen (mit «Rückgängig») und Ordnen wie 58.4. Links öffnen in einem neuen Tab und sagen es («öffnet in einem neuen Tab»); nur https-Adressen. «Zusammenführen» ist ein zweistufiger Knopf mit Klartext der Folge.
- [ ] **58.10** Ein Versionskonflikt (409) steht als Meldung mit `role="alert"`: Tabelle «Feld, Du, Server» der abweichenden Felder und die Knöpfe «Meine Änderung übernehmen» und «Stand des Servers übernehmen». In Listen zeigt die Zeile den Stand des Servers und die Meldung bietet «Meine Änderung übernehmen». Nichts wird still überschrieben.
- [ ] **58.11** Rechte: Was die Rolle nicht darf, fehlt (keine toten Knöpfe): Wer nur eigene Aufgaben lesen darf, sieht den Satz dazu und kann nur Status setzen und abhaken; Lesende sehen keine Knöpfe zum Ändern; ein geschlossenes Lager zeigt den Hinweis und blendet alle Schreib-Knöpfe aus. Der Server prüft jede Anfrage.
- [ ] **58.12** Der Zeitplan zeigt je Tag eine Karte (Überschrift Ebene 2 mit Wochentag und Datum, «Heute» als Wort mit Symbol und starkem Rand), darin Lagertag, Meilensteine und Fristen als Liste mit Marke «Meilenstein» beziehungsweise «Frist». Die Monatsansicht ist eine Tabelle mit Spaltenköpfen Mo bis So, Beschriftung des Monats, Knöpfen «Vorheriger Monat» und «Nächster Monat»; Tage im Lager tragen den Eintrag «Lagertag n», nicht nur eine Farbe.
- [ ] **58.13** Meilenstein verschieben: Seite im Fluss mit Datumsfeld, «Vorschau zeigen» (Tabelle «Aufgabe, Frist jetzt, Neue Frist» mit dem Satz «2 Aufgaben ändern ihre Frist.»), erst dann «Verschieben». Ändert sich die Vorschau inzwischen (409 `VORSCHAU_VERALTET`), steht die neue Vorschau mit einem Hinweis und die Person bestätigt nochmals. Nach dem Verschieben sagt die Rückmeldung, wie viele Aufgaben eine neue Frist haben.
- [ ] **58.14** Tagesabschnitte ordnen wie 58.4; Abschnitte löschen ist ein zweistufiger Knopf, Lagertage und Meilensteine löschen geht über «Rückgängig». Der Vorschlag des Servers ist eine Seite mit Zusammenfassung und «Übernehmen»; er schreibt erst nach Bestätigung.
- [ ] **58.15** «Meine To-dos» sagt in einem Satz, dass nur die eigene Person sie sieht. Kästchen, Bearbeiten, Löschen mit «Rückgängig», Ordnen wie 58.4; Zähler «3 offen von 5» in `role="status"`; bei 200 To-dos erscheint die Meldung beim Feld.
- [ ] **58.16** Lade- (Skeleton), Leer- und Fehlerzustand (Zustandskarte mit «Nochmals versuchen») sind vorhanden; Hell, Dunkel, erzwungene Farben (Haken der erledigten Aufgabe, Rand von «Heute» bleiben Linie), «Bewegung reduzieren» (Übergänge nur unter `no-preference`); 390 bis 1920 px: Tabellen werden Karten, nichts im Modul scrollt waagrecht ausser dem Board und dem Monat in ihren Bereichen.

### Stand der Prüfung (#670)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Daten gesehen und bedient: 58.1 bis 58.3 (Haken mit «Rückgängig», Mehrfachauswahl mit Status, Löschen mit «Rückgängig» und nach Ablauf der Frist), 58.4 (Spalten, Menü), 58.5 (Reihenfolge nur mit der Tastatur: Leertaste, Pfeil, Leertaste), 58.6 bis 58.10 (inklusive Konflikt mit einem zweiten Konto), 58.12 bis 58.15 (Verschieben mit Vorschau, Monat, To-dos) bei 1440 px Hell, Teile bei 390 px Hell und Dunkel; 58.11 mit nachgebildeten Rechten (die Antwort des Lagers wurde im Browser auf die Rechte «Lesen», «Team» und «geschlossen» gesetzt). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 % Zoom per Browser-Einstellung, 2560 px, erzwungene Farben im Browser, Kontrastwerte mit einem Messwerkzeug, Ziehen mit der Maus (nur Quelltext und Tastatur), die Seiten mit echten Konten der Rollen Leitung, Team und Lesen (der Bereich «Lager» der Verwaltung ist heute der Abteilungsleitung vorbehalten).

## 60. Verwaltung: Lager, Menschen und Einteilung (#675)

Gilt für die Module `lager-m-teilnehmer.js`, `lager-m-abzaehlen.js`, `lager-m-anwesenheit.js`, `lager-m-gruppen.js`, `lager-m-zimmer.js`, `lager-m-fahrten.js`, `lager-m-schichtplan.js`, `lager-m-diensttausch.js`, `lager-m-adressbuch.js`, ihre Helfer `lager-menschen.js`, `lager-menschen-logik.js`, `lager-ziehen.js` und `lager-menschen.css` im Arbeitsbereich des Lagers (`#lager/lager/<id>/<modul>`). Massstab WCAG 2.2 AA.

- [ ] **60.1** Jede Zuteilung per Ziehen hat eine Alternative ohne Ziehen (WCAG 2.5.7): das Menü «Mehr» der Person (Einträge «Verschieben nach …», «Aus dem Zimmer nehmen»), die Auswahlleiste unten («2 ausgewählt», Ziel, «Einteilen») und im Schichtplan «Besetzen». Der Ziehgriff ist ein Knopf («Ziehen: Name»); Enter oder Leertaste auf dem Griff öffnet das Menü der Zeile. Escape bricht ein Ziehen ab.
- [ ] **60.2** Beim Ziehen folgt eine Hülle mit dem Namen (bei Auswahl «n Personen») dem Zeiger; die Fläche unter dem Zeiger bekommt einen gestrichelten Rand und eine getönte Fläche, nicht nur Farbe. Hülle und Übergänge laufen nur unter `prefers-reduced-motion: no-preference`; am Fensterrand läuft die Seite mit.
- [ ] **60.3** Zustand nie nur über Farbe: Belegung als Satz («3 von 4 Plätzen belegt») neben dem Balken, Überbelegung als Chip «Überbelegt: n zu viel» mit Symbol, Anwesenheit als Wort und Symbol («Da», «Frei», «Offen»), Besetzung als Wort («noch ein Platz frei», «voll besetzt») mit Symbol, «Nicht dabei» und «Dabei» als Chip mit Symbol, Abzählen als «Da» und «Nicht gezählt» mit Haken.
- [ ] **60.4** Jede Matrixzelle der Anwesenheit ist ein Knopf mit vollem Namen («Anna Beispiel, Morgen, Sa 17.07.: Da. Antippen wechselt den Wert.», dazu «noch nicht gespeichert»). Änderungen sammeln sich unten in einer Leiste mit Anzahl, «Speichern» und «Änderungen verwerfen». Spaltenköpfe haben «Alle Da» mit eigenem Namen je Abschnitt.
- [ ] **60.5** Ein Versionskonflikt (409) zeigt beide Stände nebeneinander in einer Tabelle (Feld, Deine Änderung, Stand des Servers) mit «Meine Änderung übernehmen» und «Stand des Servers übernehmen» als `role="alert"`-Hinweis über den Knöpfen; der Fokus wandert auf den ersten Knopf. Nichts wird still überschrieben, gesendet werden nur geänderte Felder.
- [ ] **60.6** Der Import der Teilnehmenden zeigt zuerst eine Vorschau (neue Personen als Tabelle, Fehler und übersprungene Zeilen als Liste mit Zeilennummer und Satz), Zeilenzahl und Limit (500) stehen im Text; die Bereiche sind `aria-live="polite"`. Erst «n Personen übernehmen» schreibt.
- [ ] **60.7** Löschen läuft mit «Rückgängig» (Toast, 8 Sekunden, Strg Z), nie mit einem Popup; das Zurücksetzen der Abzählliste und die Rückfrage «Wer übernimmt die Schicht?» sind am Ort (zweistufiger Knopf, Seite im Fluss). Alle Formulare sind Seiten im Fluss mit Adresse, Zurück und Escape.
- [ ] **60.8** Tastatur: alle Knöpfe, Menüs, Kästchen und Zellen sind mit Tab erreichbar, der Fokusring ist sichtbar (3 px). Die Kästchen sind 24 px gross, ihre Fläche zum Treffen 44 px (das Etikett deckt sie ab); Ziehgriffe sind 36 × 44 px (Griffe in Chips des Schichtplans 32 × 44 px), also über den 24 px von WCAG 2.5.8, aber unter den 44 px der Projektregel in der Breite. Das ist eine bewusste Abweichung wegen der Zeilenbreite; die Alternative nach 60.1 hat 44 px.
- [ ] **60.9** Leer-, Lade- (Skeleton des Rahmens), Fehler- und Konfliktzustand sind vorhanden; fehlt das Leserecht, erklärt die Seite, wer es vergeben kann; im geschlossenen Lager sind alle Schreibknöpfe weg und der Rahmen sagt «schreibgeschützt». Knöpfe ohne Recht erscheinen nicht (die Rolle sieht, was sie darf; der Server prüft weiter alles).
- [ ] **60.10** Hell, Dunkel, «Bewegung reduzieren» und erzwungene Farben; 390 bis 2560 Pixel ohne Seitenscroll (breite Tabellen scrollen im eigenen Rahmen mit Tastaturfokus; die Tabelle der Teilnehmenden wird am Handy zur Kartenliste). 200 % Zoom ohne Verlust.
- [ ] **60.11** Vertrauliches (Adressbuch: Telefon, E-Mail, Notiz Dritter) steht nur mit Leserecht in der Seite und nie in Titel, Adresse oder Rückmeldung; der Hinweis «Jeder Abruf wird protokolliert» und die Aufräumfrist («Wird am … gelöscht» oder «Behalten») stehen sichtbar. Gesundheitsdaten gibt es in diesen Modulen nicht.

### Stand der Prüfung (#675)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Daten gesehen und bedient: 60.1 (Ziehen mit Maus in Zimmer, Fahrt, Zelle des Schichtplans; Menü «Verschieben»; Auswahlleiste), 60.2, 60.3, 60.4 und 60.5 (Konflikt in Teilnehmenden und Anwesenheit), 60.6, 60.7 (Rückgängig beim Adressbuch), 60.8 (Zielgrössen gemessen), 60.10 bei 390 und 1440 Pixel, Tag und Nacht (Bilder aus Hell und Dunkel gesichtet, Kontraste nicht gemessen). Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack), Ziehen mit Finger und Stift, 200 % Zoom und 2560 Pixel in allen Modulen, erzwungene Farben, die Sicht von Rollen ohne Rechte im echten Betrieb (die Abteilungsleitung ist immer Lagerleitung; die Ausblendung ist im Test mit abgeschnittenen Rechten gesehen).

## 62. Website und Verwaltung: Gleichstand mit der App ausserhalb des Lagers (#671)

Gilt für die Website-Seiten `/termin` (`termin.js`) und `/konto` (`konto.js`) sowie für «Meine Anfragen» der Räume in der Verwaltung (`raeume-meine.js`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9 und 10 gelten, ebenso die Abschnitte 11 (Website), 12 (Verwaltung, Termine) und 31 (Raumanfragen).

- [ ] **62.1** Antworten Ja oder Nein (`/termin`) sind eine Gruppe von Knöpfen mit `aria-pressed`, benannt nach der Person (`aria-labelledby` auf den Namen); ohne Antwort steht «Noch keine Antwort» als Text. Ist der Termin abgesagt oder begonnen, gibt es keine Knöpfe, die Antwort steht als Wort («Ja», «Nein», «Noch keine Antwort») mit der Erklärung «Antworten ist nicht mehr möglich».
- [ ] **62.2** Beim Speichern einer Antwort sind die Knöpfe `aria-disabled` und `aria-busy`; das Ergebnis kommt als Ansage in der Statusregion («Gespeichert: Ja.») und der Fokus bleibt auf dem gedrückten Knopf. Ein Fehler steht als Band mit `role="alert"` über der Liste, die Auswahl bleibt unverändert.
- [ ] **62.3** Die Zusagen für Leitende («Antworten») nennen Zahlen und Namen als Text mit Wort («Ja», «Noch keine Antwort»); Farbe verstärkt nur. Telefonnummern sind echte Links (`tel:`), Name und Nummer stehen in einer Zeile oder umbrechen ohne waagrechtes Scrollen.
- [ ] **62.4** `/konto`: Beim Startpasswort steht nur die Karte «Wähle dein Passwort» mit Erklärung; Felder haben sichtbare Beschriftungen, `autocomplete` (`current-password`, `new-password`), Einfügen ist erlaubt (WCAG 3.3.8), Fehler stehen beim Feld mit Symbol und Text (`aria-describedby`, `aria-invalid`), der Fokus geht auf das erste fehlerhafte Feld. «Passwörter anzeigen» ist ein Knopf mit `aria-pressed`. Das Passwort wird nach dem Senden geleert.
- [ ] **62.5** Mitteilungsschalter: je eine Gruppe «Ein/Aus» mit `aria-pressed` und sichtbarem Text, Zustand nie nur über Farbe; der Hinweis sagt, dass sie für die App gelten.
- [ ] **62.6** «Überall abmelden» fragt in der Zeile nach («Alle anderen Geräte abmelden?» mit «Ja, überall abmelden» und «Abbrechen», Ansage per `role="status"`, Fokus auf dem ersten Knopf der Frage); kein Dialog des Browsers.
- [ ] **62.7** «Meine Anfragen» (Verwaltung): Das Formular ist eine Seite im Fluss mit Zurück; Fehler stehen beim Feld und in einer Zusammenfassung mit Sprungmarken; Datum und Uhrzeit sind die eigenen Felder (Tippen und Kalender); der Status steht als Wort mit Symbol; «Zurückziehen» ist zweistufig mit Ansage, der Fokus geht danach an die Überschrift.
- [ ] **62.8** Alle Seiten: Zielgrösse 44 px, sichtbarer Fokus, Hell und Dunkel, 390 bis 1440 px ohne waagrechtes Scrollen, kein Inline-Skript und kein `style`-Attribut (CSP), Bewegung nur unter `no-preference`. Ohne Anmeldung zeigt jede Seite «Melde dich an» mit Weg zurück zur Seite (nur ein Pfad der eigenen Website, `sicheresZiel`).

### Stand der Prüfung (#671)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank mit erfundenen Demo-Konten für Eltern, Stufenleitung und Entwickler) gesehen und bedient: 62.1 und 62.2 (Antwort setzen, Fokus bleibt), 62.3, 62.4 (auch der Pflichtwechsel mit Startpasswort bis zur Seite danach), 62.5 (Schalter, Telefon speichern), 62.6 nur die Darstellung der Frage in der Ansicht (Test), 62.7 (anfragen, zurückziehen, Fehlerzusammenfassung), 62.8 bei 1440 und 390 px, Hell und Dunkel, Ziele unter 44 px: keine gefunden. Per Test: Ansichten ohne Browser (`test/website-konto-termin.test.ts`, `test/admin-raeume-meine.test.ts`). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), Kontrastmessung, 200 % Zoom per Browser-Einstellung, 2560 px, Windows-Hochkontrast, das Verhalten bei sehr langen Namen.

## 59. Verwaltung: Lager, Sitzungen und Mitteilen (#673)

Gilt für die Module Höcks, Protokolle, Pinnwand, Eingang, Erwähnungen und Dokumente im Arbeitsbereich des Lagers (`lager-m-*.js`, `lager-sm-*.js`, `lager-sitzungen.css`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss.

- [ ] **59.1** Jede Ansicht hat eine Überschrift der Ebene 2 (Titel des Moduls); Formulare sind Seiten im Fluss (Zurück, Escape, Browser-Zurück). Jeder Knopf in einer Zeile nennt den Gegenstand im Namen («Bearbeiten: Budget besprechen»).
- [ ] **59.2** Zustand nie nur über Farbe: Status (Besprochen, Neu, Erledigt), «Wichtig», «Angeheftet», «Geschlossen» und «Anonym» tragen Wort und, wo sinnvoll, ein Symbol. Reaktionen sind Knöpfe mit `aria-pressed` und Zahl.
- [ ] **59.3** Reihenfolgen (Traktanden) lassen sich mit Maus, Finger, Tastatur (Leertaste, Pfeile, Escape) und den Knöpfen «Nach oben» und «Nach unten» ändern (2.5.7); das Ändern geht mit «Rückgängig».
- [ ] **59.4** Kästchen und Auswahlfelder sind die eigenen der Verwaltung; die Einzelwahl einer Umfrage ist eine Karte mit Rundknopf (`.wahlkarte`), die Mehrfachwahl `.wahl`. Das Ergebnis steht als Text («3 Stimmen (50 %)») und als `progress` mit Namen.
- [ ] **59.5** Fehler stehen beim Formular mit `role="alert"`; ein Versionskonflikt öffnet eine Gruppe mit Titel, dem Stand des Servers als Liste und zwei Knöpfen, der Fokus liegt in ihr.
- [ ] **59.6** Links zu Dateien am Ablageort öffnen in einem neuen Tab, sagen das für Screenreader («öffnet in neuem Tab») und tragen `rel="noopener noreferrer"`. Es werden nie Links ausserhalb von `https` angeboten.
- [ ] **59.7** Anonyme Meldungen: Der Rückfragecode steht in einer Seite mit Titel und «Kopieren», nur einmal; weder Meldungstext noch Code stehen in der Adresse oder im Titel des Dokuments.
- [ ] **59.8** Höck-Modus: Die Punkte sind Knöpfe mit `aria-current="step"`; Häkchen der Anwesenheit sind erreichbar und melden Fehler als Meldung. Die Zielgrösse ist 44 Pixel, auch in der Kartenliste am Handy.
- [ ] **59.9** Hell, Dunkel, «Bewegung reduzieren», erzwungene Farben; 390 bis 2560 Pixel ohne waagrechtes Scrollen der Seite, Tabellen werden am Handy zu Karten.

### Stand der Prüfung (#673)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Daten gesehen: alle sechs Module bei 1440 Pixel (Hell), Höck-Detail bei 390 Pixel (Dunkel), Höck-Modus (Dunkel), Formulare Höck, Traktandum, Beitrag, Protokoll, Dokument, Orte; Versionskonflikt (Box, «Meine Änderung übernehmen»), Abstimmen, Reagieren, anonymes Senden mit Code, Link-Prüfung (Host, Form). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), Tastatur-Durchgang aller Ansichten, 200 Prozent Zoom, erzwungene Farben, Kontrastwerte mit Messwerkzeug, 320 und 2560 Pixel, Rollen unterhalb der Lagerleitung im Browser (die Navigation der Verwaltung öffnet den Lager-Bereich nur der Abteilungsleitung; die Rechte der Module sind über Quelltext und API geprüft).

## 61. Verwaltung: Lager, Material und Infos (#674)

Gilt für `lager-m-packliste.js`, `lager-m-einkauf.js`, `lager-m-notfall.js`, `lager-m-infos.js`, `lager-m-tagesseiten.js`, `lager-m-wetter.js`, `lager-m-hilfen.js` und `lager-material.css` im Arbeitsbereich eines Lagers. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9 und 17 gelten sinngemäss.

- [ ] **61.1** Jedes Modul steht nur in der Navigation, wenn die Rolle das Leserecht hat; Knöpfe zum Ändern fehlen ohne das Schreibrecht und in einem abgeschlossenen oder archivierten Lager. Sortierlisten (Griff, Pfeilknöpfe) erscheinen nur, wenn sich die Reihenfolge ändern lässt.
- [ ] **61.2** Abhaken (Packliste, Einkauf) geschieht mit dem gemeinsamen Kästchen (`ankreuzen`, 44 Pixel, sichtbarer Fokus); der Zustand steht auch als Text («5 von 9 gepackt», durchgestrichen und «erledigt» im Stand), nie nur in Farbe. Der Stand ist eine Zustandsmeldung (`role="status"`).
- [ ] **61.3** Reihenfolgen (Vorlage der Packliste, Infos, Notfall-Kontakte, Blöcke der Tagesseite) ändern sich per Ziehen am Griff, mit Leertaste und Pfeiltasten und mit den Knöpfen «Nach oben» und «Nach unten» (WCAG 2.5.7); jede Änderung wird angesagt und lässt sich mit «Rückgängig» zurücknehmen.
- [ ] **61.4** Löschen und Entfernen laufen mit «Rückgängig» (Knopf und Strg Z), keine Rückfrage per Popup. Ändert jemand anderes dieselbe Zeile (409), zeigt das Formular die Konflikt-Box mit «Dein Wert» und «Server» und zwei Knöpfen («Meine Änderung übernehmen», «Stand des Servers übernehmen»); bei Aktionen in der Liste sagt eine Meldung, dass der Stand des Servers geladen ist.
- [ ] **61.5** Tabellen (Einkauf, Wetter) haben Beschriftung und Spaltenköpfe; am Handy werden sie zur Kartenliste mit Spaltenname vor dem Wert. Formulare haben sichtbare Beschriftungen, Fehler stehen beim Feld (`role="alert"`) und setzen den Fokus.
- [ ] **61.6** Notfall: Nummern sind Links (`tel:`) mit 44 Pixel Höhe und dem Zusatz «Anrufen» für Screenreader; sie stehen nie im Seitentitel, in der Adresse oder in einer Meldung. Externe Links (Kartenlink, Infos) nur mit https und mit dem Zusatz «öffnet in einem neuen Tab» für Screenreader.
- [ ] **61.7** Infos: Abschnitte sind `details` mit `summary` (44 Pixel hoch, Tastatur); «Alle öffnen» und «Alle schliessen» sind Knöpfe. Drucken öffnet vorher alle Abschnitte.
- [ ] **61.8** Tagesseiten: Die Tagesliste ist eine Navigation mit `aria-current="page"`; «Voriger Tag» und «Nächster Tag» nennen für Screenreader das Datum.
- [ ] **61.9** Wetter: Warnungen sind Marken mit Symbol und Wort (Gewitter, Starke Böen, Hitze, Viel Regen); der Stand der Vorhersage steht als Text.
- [ ] **61.10** Drucken (`window.print`): Das Druck-Stylesheet blendet Kopf, Navigation, Filter und Knöpfe aus (`lm-nicht-drucken`) und druckt schwarz auf weiss.
- [ ] **61.11** Hell, Dunkel, «Bewegung reduzieren» (Übergänge nur unter `no-preference`), 390 bis 1920 Pixel ohne waagrechtes Scrollen der Seite.

### Stand der Prüfung (#674)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Datenbank mit erfundenen Daten gesehen: alle sechs Module bei 1440 und 390 Pixel (Hell, Einkauf und Notfall auch Dunkel), die Abläufe Abhaken, eigener Punkt mit «Rückgängig» (Strg Z), Konflikt-Box mit «Meine Änderung übernehmen», Artikel anlegen und abhaken, «Zusammengezählt», Info bearbeiten und ungültigen Link ablehnen, Kontakt anlegen, Tag wechseln und Notiz speichern, Wetter laden; ein abgeschlossenes Lager ohne Änderungsknöpfe. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, erzwungene Farben, Kontrastwerte mit einem Messwerkzeug, Druckvorschau, Ziehen mit der Maus (nur Quelltext und Tastaturweg der Sortierliste), 320 und 2560 Pixel.

## 54. Verwaltung: Leisten wie die Website, ungültige Adressen (#667)

Gilt für Logozeile, Bereichsleiste, Unterleiste und Bereichsauswahl (`geruest.css`) und für Adressen, die es nicht gibt (`admin.js` mit `ctx.nichtGefunden`, `rechte.js`, `tags.js`, `termine-anlaesse.js`, `termine-belegung.js`, `termine-monat.js`). Vorlage der Leisten: `public/website/kopf.css`.

- [ ] **54.1** Die Höhen folgen der Website (Token `--logozeile-hoehe`, `--nav-hoehe`, `--unter-hoehe`, Linien eingerechnet): ab 106 em (1696 Pixel) sind Logozeile und Bereichsleiste je 72 Pixel hoch (die eine Zeile des Kopfs der Website), darunter ab 961 Pixel 64 und 50 Pixel (die zwei Zeilen der Website: 64 und 48 plus Linien), die Unterleiste ist überall 45 Pixel (44 plus Linie), am Handy (bis 960 Pixel) sind Logozeile und Bereichsauswahl je 64 Pixel. Nichts springt beim Wechsel der Seite; die haftende Leiste verdeckt keinen Anker (`--leiste-hoehe`).
- [ ] **54.2** Schrift und Zustände wie auf der Website: Hauptnavigation 1 rem (unter 72 em 0.9375 rem) im Gewicht 600, aktiv 800 und blau, roter Strich 3 Pixel unter dem aktiven Punkt, wächst beim Zeigen von links; Unterleiste 0.9375 rem im Gewicht 500, beim Zeigen unterstrichen (2 Pixel), der aktive Punkt fett, blau und mit rotem Strich unten. Der aktive Punkt ist nie nur an der Farbe erkennbar (Gewicht und Strich); in erzwungenen Farben bleibt er unterstrichen.
- [ ] **54.3** Logo 36 Pixel hoch ab 961 Pixel (wie auf der Website), darunter 30 und am Handy bis 760 Pixel 26 Pixel; «Suchen» und «Abmelden» sind 44 Pixel hoch mit 1 rem im Gewicht 600 und demselben Innenabstand wie «Anmelden» auf der Website; der Umschalter Hell/Dunkel ist unverändert (zwei Knöpfe zu 44 Pixel). Alle Ziele bleiben mindestens 44 Pixel gross, der Fokusring ist sichtbar.
- [ ] **54.4** Eine Adresse, die es nicht gibt (unbekannter Reiter wie `#personen/rechte/system/protokoll`, Kennung ohne UUID wie `#personen/gruppen/x` oder `#anlaesse/x`, ein Datum wie 2026-13-45), zeigt «Diese Seite gibt es nicht.» mit «Zur Übersicht» und Fokus auf der Überschrift, dieselbe Karte wie bei einem toten Link; es geht keine Anfrage an den Server (vorher: Antworten 400 und, bei einem Datum, ein Fehler in der Seite). Die Karte ist eine Meldung (`role="alert"`), keine leere Seite.
- [ ] **54.5** Hell, Dunkel und «Bewegung reduzieren» (der Strich wächst nur unter `no-preference`); 390 bis 2560 Pixel ohne waagrechtes Scrollen der Seite.

### Stand der Prüfung (#667)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung gemessen: 54.1 bis 54.3 bei 320, 360, 390, 430, 520, 760, 960, 961, 1024, 1100, 1152, 1215, 1280, 1695, 1696 und 2560 Pixel, Tag und Nacht (Höhen der drei Leisten, Zeile der Logozeile; gegen die Website bei 390, 1440, 1920 und 2560 verglichen), 54.4 mit 200 Adressen (jeder Bereich und jede Unterseite mit sechs ungültigen Endungen, dazu 14 gezielte Adressen): keine Antwort 400 oder 404 und kein Seitenfehler; derselbe Lauf gegen den Stand vor der Änderung fand 23 Adressen mit Fehler. **Bekannt, nicht neu:** Unter etwa 380 Pixel Fensterbreite läuft die Logozeile über (Konto, Suche, «Abmelden» und Umschalter brauchen mehr Platz als die Zeile hat); bei 390 Pixel passt sie jetzt. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, erzwungene Farben im Browser, Kontrastwerte mit einem Messwerkzeug, Bewegung reduzieren im Browser (nur der Quelltext).

## 55. Verwaltung: Kästchen und Profilbilder im Lager (#668)

Gilt für alle Kästchen (`input[type="checkbox"]`) der Verwaltung, vor allem im Bereich Lager (Personenwahl, Rechte der Rollen), und für die Kreise mit Profilbild im Lager (Assistent, Mitglieder, Personenwahl). Massstab WCAG 2.2 AA.

- [ ] **55.1** Es gibt kein rohes Browser-Kästchen: Jedes Kästchen trägt die gemeinsame Gestaltung aus `admin.css` (`appearance: none`, Rand, Haken), auch wenn die ganze Zeile ein `label` ist. Ein Test (`admin-kaestchen.test.ts`) hält fest, dass kein Stylesheet ein Kästchen mit `accent-color` nachzeichnet.
- [ ] **55.2** Der Zustand «angekreuzt» steht in Haken und Farbe, nie nur in Farbe; der Rand des leeren Kästchens hat gegen den Grund mindestens 3 : 1 (Tag und Nacht).
- [ ] **55.3** Fokusring (3 px, versetzt), Hover (kräftiger Rand, auch über der ganzen Zeile), deaktiviert (halb deckend, Verbotszeiger) und der Haken-Übergang (nur unter `prefers-reduced-motion: no-preference`) sind für jedes Kästchen gleich.
- [ ] **55.4** Erzwungene Farben (`forced-colors: active`): Rand `ButtonText`, angekreuzt `Highlight` mit Haken `HighlightText`, deaktiviert `GrayText`.
- [ ] **55.5** Die Fläche zum Treffen ist die ganze Zeile und mindestens 44 px hoch (Personenzeile 52 px, Schalter der Rechte 44 px); das Kästchen selbst ist 24 px.
- [ ] **55.6** Im Lager zeigt der Kreis einer Person ihr Profilbild, wenn sie eins hat und die Verwaltung es sehen darf; sonst bleiben die Initialen, auch wenn das Bild nicht lädt (403 oder 404). Das Bild ist dekorativ (`alt=""`), der Name steht daneben.

### Stand der Prüfung (#668)

Geprüft im Browser (headless, Kopie der Demo-Datenbank mit erfundenen Bildern) bei 1440 und 390 px, Tag und Nacht: 55.1 bis 55.3, 55.5 und 55.6; Tastatur (Tab, Leertaste, Fokusring) in der Personenwahl. Gemessen: Rand des leeren Kästchens 4.5 : 1 (Tag) und 4.7 : 1 (Nacht). Offen: Der Rand des angekreuzten Kästchens hat in der Nacht zum Grund nur 1.3 : 1; der Haken (Weiss auf Marineblau) trägt die Information, das Kästchen sieht in der ganzen Verwaltung gleich aus. Nicht geprüft: Screenreader, 200 % Zoom per Browser-Einstellung, 2560 px, `forced-colors` im echten Kontrast-Thema (55.4 nur nach dem Quelltext).

## 64. Verwaltung: Lager, Ladezustände und Bewegung in Aufgaben, Zeitplan, To-dos und Menschen (#685)

Gilt für `lager-m-aufgaben.js`, `lager-m-zeitplan.js`, `lager-m-todos.js`, `lager-aufgaben-*.js`, `lager-m-teilnehmer.js`, `lager-m-abzaehlen.js`, `lager-m-anwesenheit.js`, `lager-m-gruppen.js`, `lager-m-zimmer.js`, `lager-m-fahrten.js`, `lager-m-schichtplan.js`, `lager-m-diensttausch.js`, `lager-m-adressbuch.js`, `lager-anim.js`, `lager-einteilung-laden.js` und die Stile `lager-anim.css`, `lager-aufgaben.css`, `lager-menschen.css`. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9, 58 und 60 gelten sinngemäss.

- [ ] **64.1** Jedes Modul zeigt beim Laden nach 250 ms ein Skeleton in der Form des Inhalts (gleiche Spalten, Höhen, Radien; die Seite springt beim Austausch nicht oder kaum), mindestens 400 ms lang; es ist `aria-hidden`, die Information liefert die Live-Region «Lädt …». Nach 4 Sekunden steht «Das dauert länger.» mit «Nochmals versuchen».
- [ ] **64.2** Teile, die nachladen (anderer Tag, andere Gruppe, Plan, Anfragen, Vorschau, «Aktualisieren»), behalten den alten Inhalt bis zum Skeleton oder zur neuen Anzeige; der Teil trägt dabei `aria-busy="true"`. Ein Fehler zeigt die Zustandskarte mit «Nochmals versuchen», der Fokus liegt auf ihrem Titel. Leer- und Fehlerzustände gleichen denen der übrigen Verwaltung.
- [ ] **64.3** Alle Bewegung (Einblenden, Gleiten, Ausblenden, Puls, Zähler, Balken, Aufklappen, Ziehhülle, Pulsieren des Skeletons) läuft nur unter `prefers-reduced-motion: no-preference`. Mit «Bewegung reduzieren» steht jeder Inhalt sofort da, Zähler zeigen den Endwert, es laufen keine Animationen (gemessen mit `document.getAnimations()`).
- [ ] **64.4** Bewegung trägt keine Information allein: Zustand und Ergebnis stehen als Wort, Symbol und Zahl im Text (Status, «Da» und «Frei», «3 von 4 Plätzen belegt»); Meldungen kommen weiter über die Statusregionen. Nichts blinkt; einzelne Bewegungen dauern 0.2 bis 0.45 Sekunden, dazu kommt das ruhige Pulsieren des Skeletons.
- [ ] **64.5** Zähler (Aufgaben offen, Lagertage, Checkliste, Abzählen, Anwesenheit, Offen im Diensttausch) zählen sichtbar hoch (`aria-hidden`), daneben steht der Endwert für Screenreader sofort und ohne Zwischenschritte.
- [ ] **64.6** Gleiten und Ausblenden nehmen keinen Fokus weg: Die ausblendende Kopie ist `inert` und `aria-hidden`, hat keine Kennungen, reagiert auf nichts und nimmt keinen Platz weg. Antippen einer Zelle der Anwesenheit oder des Abzählens ändert die Zeile an Ort und Stelle; der Fokus bleibt auf dem Knopf.
- [ ] **64.7** Ziehen von Personen und Aufgaben hat weiter die Alternativen ohne Ziehen aus 60.1 und 58.5; die Bewegung beim Ablegen ändert daran nichts. Erzwungene Farben: die ausblendende Kopie hat einen Rand in `CanvasText`, Hülle und Zielflächen bleiben an Rand und Fläche erkennbar.
- [ ] **64.8** Hell, Dunkel, 390 bis 1440 Pixel; kein Inline-Skript, kein `style`-Attribut (die Bewegung läuft über Web Animations und CSSOM), kein Polling.

### Stand der Prüfung (#685)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung mit erfundenen Daten und mit verzögerten Antworten der API gesehen: 64.1 und 64.2 (Skeleton aller zwölf Module, Fehlerzustand bei abgebrochener Anfrage mit «Nochmals versuchen»), 64.3 (mit `reducedMotion: reduce` laufen null Animationen, keine Seitenfehler), 64.5 bis 64.7 (Bewegung nach Haken, Filter, Statuswechsel im Board, Ansichtenwechsel, Zuteilen, Ziehen mit der Maus, Antippen in Anwesenheit und Abzählen, Diensttausch entscheiden), 64.8 bei 1440 und 390 px, Tag und Nacht. Per Test: Quelltext-Regeln und das Verhalten ohne Bewegung (`test/admin-lager-bewegung-2.test.ts`). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), erzwungene Farben im Browser (nur nach dem Quelltext), 200 % Zoom per Browser-Einstellung, 2560 px, Kontrastwerte der Skeletons in der Nacht, Ziehen mit Finger und Stift. Die Skeleton-Zeilen am Handy bleiben eine Tabelle, während die echte Tabelle dort zur Kartenliste wird; die Höhe weicht leicht ab.

## 63. Verwaltung: Lager, Ladezustände und Bewegung (#686)

Gilt für den Lager-Arbeitsbereich (`lager-rahmen.js`, `lager-bewegung.js`, `lager-skeleton.js`, `lager-rahmen.css`) und für alle Module darin. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9, 10 und 57 gelten, ebenso 55 (Kästchen).

- [ ] **63.1** Jedes Modul zeigt beim ersten Laden ein Skeleton, das dem fertigen Inhalt gleicht (Hauptknopf, Reiter, Filter, Tabelle, Liste, Karten oder Flächen; `skeletonSeite()` in `lager-skeleton.js`). Beim Wechsel zwischen Modulen bleiben Leiste und Navigation stehen, nur das Modul lädt; der Arbeitsbereich zeigt vor dem ersten Laden ein Skeleton mit Leiste, Navigation und Titel. Es springt nichts. Das Skeleton ist für Screenreader unsichtbar (`aria-hidden`), die Ansage «Lädt …» steht in einer Statusregion; nach 4 Sekunden kommt «Das dauert länger.» mit «Nochmals versuchen».
- [ ] **63.2** Der Ladezustand erscheint erst nach 250 ms und bleibt mindestens 400 ms (kein Flackern, `lader.js`). «Aktualisieren» lässt den alten Inhalt stehen («Wird aktualisiert …»), der Knopf trägt `aria-busy` und zeigt den Ladekreis; der Arbeitsbereich blendet dabei nicht neu ein. Die Suche zeigt nach 250 ms Platzhalter an Stelle der Treffer und `aria-busy` am Knopf; «Personen hinzufügen» trägt `aria-busy`, bis die Personen da sind.
- [ ] **63.3** Fehler beim Laden eines Moduls (Netz, Server) und leere Listen zeigen die Karten aus `zustaende.js` mit «Nochmals versuchen» statt einer leeren Seite.
- [ ] **63.4** Eintritt: Beim ersten Öffnen eines Lagers blenden Leiste und Arbeitsbereich ein, beim Wechsel zwischen Modulen nur das Modul (Titel, dann die Karten gestaffelt, höchstens 200 ms Versatz). Nach «Aktualisieren» und beim Nachladen bleibt alles still. Der Fokus geht beim Wechsel in der Navigation auf den Titel des Moduls.
- [ ] **63.5** Die Navigation: Der aktive Eintrag trägt `aria-current="page"` und eine Marke, die vom alten an den neuen Platz gleitet; ohne Bewegung und unter 900 px trägt der Eintrag selbst den Grund. Die Navigation scrollt für sich (höchstens Fensterhöhe) und hält den aktiven Eintrag im Bild. Unter 900 px klappt die Liste auf und zu (Höhe, Pfeil dreht sich), geschlossen ist sie für Tastatur und Screenreader nicht erreichbar (`visibility: hidden`), `aria-expanded` stimmt.
- [ ] **63.6** Zeilen und Listeneinträge: Neue Zeilen blenden ein, die übrigen rutschen an ihren neuen Platz (Hinzufügen, Entfernen, Filtern, Sortieren; `beobachteListen()` im Rahmen, für jedes Modul). Sortierlisten (`sortieren.js`), Menüs, Auswahllisten und Reiter sind ausgenommen. Die Reihenfolge und der Fokus ändern sich dadurch nicht.
- [ ] **63.7** Fortschrittsbalken (`progress`, `fuelle()`) wachsen auf ihren Wert; die Zahl daneben steht als Text sofort. `details` klappt, wo der Browser es kann (`::details-content`), mit gleitender Höhe auf und zu. Fehler an Feldern, Hinweise, die Speicherleiste und die Personenwahl blenden ein, wenn sie erscheinen.
- [ ] **63.8** `prefers-reduced-motion: reduce`: Es läuft keine Animation und kein Übergang im Arbeitsbereich (Test `admin-lager-bewegung.test.ts`: jede Regel mit `animation` oder `transition` steht unter `no-preference`); Inhalte erscheinen sofort an ihrem Platz. Skeletons pulsieren nicht.
- [ ] **63.9** Erzwungene Farben (`forced-colors: active`): Die Marke der Navigation trägt einen Rahmen in `Highlight`, der aktive Eintrag ist zusätzlich unterstrichen, Skeleton-Formen haben einen Rand in `GrayText`. Hell und Dunkel: Skeleton und Marke heben sich vom Grund ab (Tokens `--skeleton`, `--secondary-container`).
- [ ] **63.10** Kein `style`-Attribut im Markup und kein Inline-Skript (CSP); Positionen der Marke und der gleitenden Zeilen laufen als Web Animations (`element.animate`), Dauer und Kurve kommen aus den Tokens `--dauer`, `--dauer-lang`, `--kurve`.

### Stand der Prüfung (#686)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank mit erfundenen Daten) bei 1440 und 390 px, Hell, Dunkel und erzwungenen Farben, mit künstlich verzögerten Antworten (0,5 bis 1,5 Sekunden) gesehen: 63.1 (Skeleton je Modul beim Wechsel zwischen Heute, Meine Woche, Sind wir bereit?, Höcks, Protokolle, Pinnwand, Eingang, Packliste, Wetter und weiteren; Arbeitsbereich beim ersten Laden), 63.4 und 63.5 (Marke gleitet, Navigation auf 390 px klappt auf), 63.6 (Einkauf: neue Zeile blendet ein, die anderen gleiten), 63.8 (gemessen: unter `reduce` null Animationen und null Übergänge im Arbeitsbereich, unter `no-preference` laufen sie), 63.9 (Hell, Dunkel und `forced-colors`). Per Test: Reduced-Motion-Regel, Skeleton in jedem Modul des Registers. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 % Zoom per Browser-Einstellung, Firefox und Safari (`::details-content` und der Übergang des `progress` gibt es dort nicht überall; die Seite funktioniert ohne), die Module Aufgaben, Zeitplan, To-dos und Menschen (folgen im Schwester-Issue).

## 56. Website und Verwaltung: Konto-Menü und «Zur Website» (#669)

Gilt für das Konto-Menü im Kopf der öffentlichen Website (Vorlage in `src/website/kopf.ts`, `public/website/konto-menue.js`, Stil im Abschnitt «Konto-Menü» von `kopf.css`) und für den Link «Zur Website» in der Logozeile der Verwaltung (`rahmen.js`, `geruest.css`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4 und 9 gelten sinngemäss.

- [ ] **56.1** Ohne Skript, ohne Sitzung (401) und bei jedem Fehler bleibt «Anmelden» stehen; die Seite ist für alle gleich und trägt nichts über eine Person. Mit Sitzung ersetzt das Menü den Knopf, am Computer im Band, am Handy als ausgeklappte Liste im Menü.
- [ ] **56.2** Der Knopf des Menüs (`summary`) zeigt Bild oder Initiale und den Anzeigenamen (Cevi-Name, sonst Vorname; nie Benutzername, Telefon, E-Mail); sein Name für Screenreader beginnt mit «Konto: » und enthält den sichtbaren Namen. Das Bild ist dekorativ (`alt=""`), bei einem Fehler bleibt die Initiale. Das Bild lädt nur das eigene Profilbild.
- [ ] **56.3** Aufbau als Offenlegungsmenü: `details` mit Links («Verwaltung» nur mit Zugang zur Verwaltung, «Mein Konto» für alle zur Seite `/konto` der Website) und einem Knopf «Abmelden», jeder Eintrag mit Symbol und Wort, kein ARIA-«menu». Zustand «offen» steht in Farbe, Dreieck (gedreht) und im Zustand des `details`.
- [ ] **56.4** Tastatur: Tab und Umschalt-Tab gehen durch das Menü, Enter und Leertaste öffnen und lösen aus, Pfeil runter und hoch gehen durch die Einträge (und öffnen vom Knopf aus), Pos1 und Ende springen, Esc schliesst und gibt den Fokus an den Knopf zurück, Verlassen mit Tab und ein Klick daneben schliessen. Der Fokus ist sichtbar (Ring 3 Pixel, 3 : 1).
- [ ] **56.5** Alle Ziele mindestens 44 Pixel hoch (Knopf, Einträge, Profilknopf der Verwaltung, 44 × 44 Pixel als Bild).
- [ ] **56.6** «Abmelden» zeigt «aria-busy», gibt bei einem Fehler einen Fehler-Toast («Abmelden hat nicht geklappt. Versuche es nochmals.») aus und lädt bei Erfolg die Seite neu: Geschützte Inhalte verschwinden, der Kopf zeigt wieder «Anmelden».
- [ ] **56.7** Kein Aufblitzen, kein Sprung: Der Platz im Band bleibt (gleiche Höhe 44 Pixel wie «Anmelden», Name auf 6,5 rem gekürzt); wer in diesem Tab schon angemeldet war, sieht «Anmelden» gar nicht erst blitzen (Merker, nach zwei Sekunden ohne Antwort ist der Knopf wieder da). Die Tafel fährt nur unter «Bewegung nicht reduzieren» kurz ein.
- [ ] **56.8** Hell, Dunkel und erzwungene Farben (Tafel mit Rand, Bild mit Rand); Kontrast aller Texte mindestens 4,5 : 1. 390 bis 2560 Pixel: nichts läuft über, die Tafel bleibt im Fenster.
- [ ] **56.9** Verwaltung: Das Profil in der Logozeile (Bild, Name, Rolle) ist der Knopf eines Konto-Menüs mit demselben Aufbau wie auf der Website: «Zur Website», «Mein Konto» (`#konto`, trägt `aria-current`, solange die Seite offen ist) und «Abmelden» (`aria-busy`, bei Fehler eine Meldung als `role="status"`). Tastatur wie 56.4. Bis 1100 Pixel bleibt nur das Bild (44 × 44 Pixel) als Knopf, sein Name für Screenreader «Konto: <Name>». Das Logo führt zur Website (Name «Cevi: zur Website», Hinweis «Zur Website»), «Verwaltung» daneben zur Übersicht (44 Pixel hoch, Hinweis «Zur Übersicht der Verwaltung»). Die Leiste hat rechts nur noch Suchen, Konto-Menü, Umschalter (Reihenfolge Menü vor Umschalter wie auf der Website); die Logozeile läuft bei 390 Pixel nicht mehr über.
- [ ] **56.10** Der Knopf des Konto-Menüs hat Rand (1 Pixel, `--outline`), Pillenform, Höhe 44 Pixel, Zeigen und Zustand «geöffnet» wie «Anmelden», «Suchen» und der Umschalter: blau gefüllt, Rolle und Bild bleiben lesbar (Rolle in `--on-secondary-muted`, Bild auf heller Fläche). Gilt für den Kopf der Website und der Verwaltung; in der Verwaltung ist bis 1100 Pixel das Bild der Knopf und hat denselben runden Rand (44 × 44 Pixel). Erzwungene Farben: Rand in Systemfarbe, geöffnet mit 3 Pixel `Highlight` wie der gedrückte Umschalter.

### Stand der Prüfung (#669)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung gesehen: Menü der Leitung (mit «Verwaltung») und der Eltern (ohne) bei 1440 und 390 Pixel, Hell und Dunkel, das Konto-Menü der Verwaltung bei 390, 1440 und 2560 Pixel, Tag und Nacht (Tastatur: Pfeile, Pos1, Ende, Esc, Klick daneben; «Mein Konto», «Zur Website», «Abmelden»), Höhen der Leisten 72/72 bei 2560 und 64/50 bei 1440 unverändert. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), erzwungene Farben im Browser (nur der Quelltext), 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug.

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung gesehen: Menü der Leitung (mit «Verwaltung») und der Eltern (ohne) bei 1440 und 390 Pixel, Hell und Dunkel, «Zur Website» in der Verwaltung bei 1440, 800 und 390 Pixel. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), erzwungene Farben im Browser (nur der Quelltext), 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug. Bekannt, nicht von diesem Abschnitt: Die Logozeile der Verwaltung läuft bei 390 Pixel schon ohne «Zur Website» über (Umschalter Hell und Dunkel).

## 67. Anmeldung: Angaben aus der Cevi-Datenbank (#691)

Gilt für die Seite «Anlass-Anmeldung» der Website (`public/website/anmeldung.js`, Stil im Abschnitt «Angaben aus der Cevi-Datenbank» von `termine.css`) und den Editor der Zusatzfelder in der Verwaltung (`public/admin/anlass-felder.js`) sowie die Seite «Cevi-Datenbank» unter System (`public/admin/cevi-db.js`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4 und 9 gelten sinngemäss.

- [ ] **67.1** Die Herkunft eines vorbefüllten Feldes steht als Text mit Symbol unter dem Feld («Aus der Cevi-Datenbank übernommen», nach einer Änderung «Aus der Cevi-Datenbank, von dir geändert»), nie nur über Farbe; die Notiz ist Teil der Beschreibung des Feldes (`aria-describedby`).
- [ ] **67.2** Eine Zeile über den Feldern (`aria-live="polite"`) sagt einmal an, was geschah: «Angaben aus der Cevi-Datenbank werden geholt …», dann «2 Angaben aus der Cevi-Datenbank übernommen. Bitte prüfen.» oder «Die Cevi-Datenbank antwortet gerade nicht. Bitte füll die Angaben selbst aus.» Der Hinweis bei einem Fehler ist ruhig (kein `role="alert"`), die Anmeldung bleibt bedienbar.
- [ ] **67.3** Kein Layoutsprung: Notiz und Zeile über den Feldern haben immer die Mindesthöhe von 1,75 rem; beim Laden steht ein Platzhalter (Skeleton, für Screenreader versteckt) gleicher Höhe, und beim Eintreffen der Werte wird nicht neu gezeichnet: Fokus, Cursor und bereits getippter Text bleiben.
- [ ] **67.4** Der eigene Wert gewinnt: Was die Person schon getippt hat, überschreibt der Vorschlag nie. Jedes vorbefüllte Feld bleibt ein normales, änderbares Feld mit Beschriftung, Zeichenzähler und Fehlermeldung.
- [ ] **67.5** Ohne JavaScript, bei Fehlern, Zeitüberschreitung und Funktion «aus» ist das Formular unverändert benutzbar; die Felder sind dann leer und tragen ihre normale Frage.
- [ ] **67.6** Verwaltung, Editor der Zusatzfelder: Das Auswahlfeld «Aus der Cevi-Datenbank füllen» hat eine sichtbare Beschriftung und eine Hilfe («… Sie kann sie ändern … Gesundheitsangaben holt Cevi OS nie»); es erscheint nur bei Textfeldern; die Quelle steht auch in der Zeile des Feldes als Text.
- [ ] **67.7** Verwaltung, Seite «Cevi-Datenbank»: Der Zustand der Verbindung steht als Chip mit Text und Symbol (eingerichtet, nicht eingerichtet, letzter Abruf ok oder Fehler); das Ergebnis von «Verbindung prüfen» steht in einer Statusregion (`role="status"`) in Worten; der Knopf zeigt `aria-busy` und ist 44 Pixel hoch; die Fehlermeldung der Gruppen-ID hängt am Feld (`aria-invalid`) und holt den Fokus dorthin.
- [ ] **67.8** Hell, Dunkel und erzwungene Farben; 390 bis 1920 Pixel ohne waagrechtes Scrollen; 200 % Zoom ohne Verlust.

### Stand der Prüfung (#691)

Im Browser (Chromium, headless) gegen eine Kopie der Demo-Datenbank mit einem lokalen Test-Double der Cevi-Datenbank (erfundene Personen) gesehen; siehe die Angaben im Pull Request. Nicht geprüft: Screenreader, Kontrastmessung mit Werkzeug, Windows-Hochkontrast.

## 66. Website und Verwaltung: Fotos aus Flickr (#690)

Gilt für die Seite mit dem Baustein «Fotoalben» (`src/website/fotoalben.ts`, `public/website/fotos.js`, `fotos.css`, Grossansicht `lichtkasten.js`) und für die Unterseite «Fotos» in der Verwaltung (`public/admin/website-fotos.js`, `website-fotos.css`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4 und 9 gelten sinngemäss.

**Website**

- [ ] **66.1** Ohne JavaScript steht ein Hinweis («Zum Anzeigen braucht diese Seite JavaScript.») als Band; die Seite ist sonst statisch und enthält weder Titel noch Bilder noch Alben.
- [ ] **66.2** Ohne Sitzung (401) steht «Nur angemeldet sichtbar» mit Schloss-Symbol, Satz und dem Knopf «Anmelden» (Ziel: die Anmeldung mit Rückweg zum selben Album). Der Wechsel wird angesagt (Statusregion); nichts blinkt, nichts springt.
- [ ] **66.3** Zustände: lädt (Skeleton in der Form der Albumkarten oder Kacheln, `aria-busy`, nach 4 Sekunden «Das dauert länger als sonst.»), leer («Hier gibt es noch keine Fotos.» mit Hilfe), kein Zugriff für das Konto eines Kindes, Zeitlimit und Fehler (`role="alert"`, «Nochmals versuchen»), 429, Album nicht gefunden (mit «Alle Alben»).
- [ ] **66.4** Alben sind Links (`a.fotos-album`) mit Titel als Überschrift (`h2`), Anzahl und Datum als Text; ein Album ohne Titelbild zeigt eine ruhige Fläche mit Symbol, nie ein kaputtes Bild. Titelbilder sind dekorativ (`alt=""`), weil der Titel daneben steht.
- [ ] **66.5** Ein Album hat eine teilbare Adresse (`?album=<Kennung>`); Browser-Zurück führt zur Übersicht zurück, der Fokus liegt dort wieder auf dem Album. Beim Öffnen springt der Fokus auf den Titel des Albums, der Titel des Tabs folgt.
- [ ] **66.6** Das Bilderraster ist eine Liste (`role="list"`); jedes Bild ist ein Link zur Grossansicht mit Alt-Text (Titel bei Flickr, sonst «Foto 3 von 80»). Bilder haben `width` und `height` und `loading="lazy"`: Der Platz steht fest, bevor das Bild geladen ist (kein Layoutsprung); ein Bild, das nicht lädt, zeigt die ruhige Fläche mit Alt-Text.
- [ ] **66.7** Grossansicht (`lichtkasten.js`, natives `dialog`): Fokus im Dialog, Esc und Klick daneben schliessen, Pfeiltasten und Knöpfe «Vorheriges Bild» und «Nächstes Bild» blättern, Wischen am Handy, «Bild 3 von 80» als Ansage, Fokus zurück aufs Bild.
- [ ] **66.8** «Album auf Flickr öffnen» steht nur, wenn die Abteilung es einschaltet; es ist ein externer Link mit dem Zeichen für «fremde Seite» und öffnet in einem neuen Tab (`rel="noopener noreferrer"`).
- [ ] **66.9** Zielgrössen mindestens 44 Pixel (Albumkarte, Zurück, Knöpfe); sichtbarer Fokus (Ring 3 Pixel, 3 : 1); Kontrast aller Texte mindestens 4,5 : 1 in Hell und Dunkel; 390, 1440 und 2560 Pixel ohne Seitenscroll, 200 Prozent Zoom.
- [ ] **66.10** Bewegung: Das leichte Heranzoomen des Titelbilds beim Zeigen nur unter «Bewegung nicht reduzieren»; Skeleton und Einblenden folgen den Regeln der Website (kein Schimmer bei reduzierter Bewegung).

**Verwaltung**

- [ ] **66.11** «Verbindung testen» zeigt das Ergebnis als Meldung (`role="status"`, Fehler `role="alert"`) ohne Geheimnisse; der Knopf zeigt `aria-busy`. Die Verbindung steht als Wort im Band («Die Verbindung zu Flickr steht.» oder der Grund), nie nur als Farbe.
- [ ] **66.12** Ohne Zugangsdaten steht eine Anleitung Schritt für Schritt (geordnete Liste), ohne Werte.
- [ ] **66.13** Die Kennung des Kontos hat ein sichtbares Label, Hilfetext, Prüfung beim Speichern mit Meldung beim Feld und Fokus darauf; die Wahl «Link zu Flickr» ist ein Kästchen mit Erklärung.
- [ ] **66.14** (Seit #794 gilt für die Liste Abschnitt 87; die Zeile hat dort kein Zustandswort mehr, der Bereich sagt es.) Jedes Album: Schalter «Auf der Website zeigen» (`role="switch"`, `aria-checked`, Name nennt das Album) mit dem Zustand als Wort («Sichtbar», «Nicht sichtbar»); Änderungen gelten sofort, die Meldung bietet «Rückgängig» an. «Titel ändern» öffnet ein Feld in der Zeile (`aria-expanded`), Fokus ins Feld und beim Schliessen zurück auf den Knopf.
- [ ] **66.15** Die Reihenfolge lässt sich per Ziehen, mit Tastatur (Leertaste, Pfeile) und mit Knöpfen «Nach oben» und «Nach unten» ändern (2.5.7); die Änderung wird angesagt und lässt sich in der Frist zurücknehmen.
- [ ] **66.16** (Seit #794 siehe 87.) Zustände der Liste: lädt (Skeleton), leer (Bei Flickr gibt es noch keine Alben), Fehler mit «Nochmals versuchen»; Zielgrössen 44 Pixel, Hell und Dunkel, 390 bis 1440 Pixel.

### Stand der Prüfung (#690)

Im Browser (Chromium, headless, Playwright) gegen eine Attrappe von Flickr (eigener kleiner Server mit erfundenen Alben und erzeugten Pixelbildern, keine Verbindung zu Flickr) gesehen: Übersicht, Album und Grossansicht der Website bei 390, 1440 und 2560 Pixel, Hell und Dunkel, ohne Sitzung, mit Sitzung und mit reduzierter Bewegung; Verwaltung bei 1440 und 390 Pixel. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), echte Fotos und echte Antworten von Flickr (es gibt keine Zugangsdaten), Kontrastwerte mit einem Messwerkzeug, 200 Prozent Zoom am Gerät, Ladezeit grosser Alben über ein langsames Netz.

## 68. Lager: Wetter aus dem Lagerort (#694)

Gilt für das Modul «Wetter» (`lager-m-wetter.js`), die Zeile unter dem Feld «Ort» (Assistent «Neues Lager» und «Angaben ändern») und die Zeile «Wetter» in den Angaben des Lagers. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6 und 9 gelten.

- [ ] **68.1** Es gibt kein Feld für Koordinaten, weder im Modul noch im Assistenten noch in den Angaben. Der Ort steht im Feld «Ort» des Lagers; das Modul «Wetter» zeigt nur, wofür es gilt, und führt mit einem Verweis («Zu den Angaben») dorthin.
- [ ] **68.2** Der Stand der Ortssuche steht als Satz, nie nur als Farbe oder Symbol: gefunden («Das Wetter kommt für …»), nicht gefunden, mehrere Orte passen, Ortsdienst nicht erreichbar, kein Ort. Jeder Satz nennt den nächsten Schritt («Schreibe nur den Ortsnamen», «Ergänze die Postleitzahl», «Trage einen Ort ein»).
- [ ] **68.3** Das Feld «Ort» trägt die Zeile «Das Wetter wird für diesen Ort geholt.» in `aria-describedby` (Hilfetext des Feldes), sie wird beim Fokus vorgelesen. Nach dem Speichern meldet die Statusmeldung (`role="status"`) den Stand der Suche; bei «nicht gefunden» und «mehrere Orte» mit der Art «warn», nicht als Fehler.
- [ ] **68.4** Fällt der Wetterdienst aus, steht «Das Wetter ist gerade nicht verfügbar. Versuche es später nochmals.» als Karte, keine leere Seite und kein Fehler. Der Verweis «Zu den Angaben» hat ein sichtbares Fokuszeichen und eine Zielgrösse von mindestens 44 px (Verweise der Verwaltung, `lg-verweis`).
- [ ] **68.5** Überschriften: «Wetter für <Ort>» (h2) steht vor der Vorhersage; die Tabelle behält ihre Beschriftung und die Kartenansicht unter 640 px.

### Stand der Prüfung (#694)

Siehe PR (Abschnitt «Barrierefreiheit»): Der Stand der Prüfung im Browser steht dort. Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack), 200 % Zoom per Browser-Einstellung.

## 69. Verwaltung: Adresssuche der Orte (#695)

Gilt für `ort-suche.js` (Kombinationsfeld), das Formular in `website-orte.js` und den Abschnitt «Adresssuche» in `website-orte.css`. Ergänzt 46.4. Massstab WCAG 2.2 AA; das Muster ist «Combobox with listbox popup» der ARIA Authoring Practices.

- [ ] **69.1** Das Feld hat eine sichtbare Beschriftung «Adresse oder Ort suchen» und einen Hilfetext (`aria-describedby`), `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` (nur `true`, solange Vorschläge stehen), `aria-controls` auf die Liste (`role="listbox"`) und `aria-activedescendant` auf die aktive Option; der Fokus bleibt immer im Feld. Jede Option hat `role="option"`, `aria-selected` und den ganzen Text der Adresse als Namen.
- [ ] **69.2** Tastatur: Pfeil nach unten und oben bewegen (umlaufend), Pos1 und Ende springen, sobald eine Option aktiv ist, Enter übernimmt, Escape schliesst nur die Liste (nicht die Seite dahinter), Tab schliesst die Liste ohne Wahl. Solange die Liste offen ist, schickt Enter das Formular nie ab. Pfeil nach unten öffnet eine geschlossene Liste wieder.
- [ ] **69.3** Eine Suche startet erst ab drei Zeichen und 300 ms nach dem letzten Tastendruck; eine neue Eingabe bricht die alte Anfrage ab (`AbortController`), eine späte Antwort ersetzt nie eine neuere.
- [ ] **69.4** Zustände: Laden (Skelett in der Form der Zeilen, kleiner Kreis im Feld, `aria-busy`), Treffer, «Keine Adresse gefunden.» mit Hinweis auf die Eingabe von Hand, «Die Adresssuche ist gerade nicht erreichbar.» mit Knopf «Nochmals suchen», «Zu viele Suchen in kurzer Zeit.». Jeder Zustand steht als Text und mit Symbol, nie nur über Farbe. Eine höfliche Statusregion sagt die Zahl der Vorschläge, «keine Adresse», den Fehler und die Wahl («Adresse übernommen: …») an.
- [ ] **69.5** Zielgrössen: Optionen mindestens 44 px hoch, «Suche leeren» 44 x 44 px, der Knopf «Adresse suchen» 44 px. Der Fokus ist sichtbar (Rand um das Feld, Rahmen um die aktive Option, in erzwungenen Farben `Highlight`). Treffer stehen in Tinte, der Rest in der gedämpften Textfarbe (beide ab 4,5 : 1); der Treffer ist nie nur über Farbe erkennbar, weil die ganze Zeile steht.
- [ ] **69.6** Bestätigung: Nach der Wahl zeigt eine Karte mit `role="status"` den Chip «Adresse bestätigt» (Haken und Text), die gewählte Adresse, die Koordinaten und den Link «Auf Karte ansehen». Bestehende Orte ohne Koordinaten zeigen «Standort noch nicht bestätigt» (Warnsymbol und Text) mit dem Knopf «Adresse suchen»; in der Liste steht «Standort bestätigt», «Standort nicht bestätigt» oder «Ohne Standort» als Text.
- [ ] **69.7** Der Ausweg bleibt: «Link oder Koordinaten von Hand eintragen» ist ein Knopf mit `aria-expanded` und `aria-controls`; das Feld öffnet sich von selbst, wo schon ein Link oder eine Adresse steht oder der Server einen Standort ablehnt (Meldung beim Feld).
- [ ] **69.8** Bewegung nur bei erlaubter Bewegung: Liste und Bestätigung blenden weich ein (200 und 500 ms), Skelett und Kreis bewegen sich; mit «Bewegung reduzieren» steht alles ohne Animation. 390, 1440 und 2560 px, Hell und Dunkel: nichts scrollt waagrecht, die Liste liegt über dem Formular und bleibt im Bild.

### Stand der Prüfung (#695)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank, erfundene Adressen; der Dienst im Browser durch eine Attrappe ersetzt, der Server einmal gegen den echten Dienst) gesehen und bedient: 69.1 bis 69.6 bei 1440 px Hell und 390 px Dunkel (Laden, Treffer, Pfeile, Ende, Enter, Escape, keine Treffer, Fehler, zu kurz ohne Anfrage), Bestätigung und «noch nicht bestätigt» mit «Adresse suchen» und Speichern. Nicht geprüft: Screenreader (NVDA, VoiceOver, TalkBack), 2560 px, erzwungene Farben, 200 Prozent Zoom, Bewegung reduzieren in einem zweiten Lauf (nur über die Einstellung des Browsers).

## 65. Website: Mein Konto, neu gestaltet (#689)

Gilt für `/konto` (`konto.js`, `konto.css`) und ersetzt die Gestaltung aus 62.4 bis 62.6; deren Inhalt (Pflichtwechsel, Schalter, Abmelden mit Rückfrage) gilt weiter. Massstab WCAG 2.2 AA.

- [ ] **65.1** Die Seite hat zwei Spalten ab 60 em Breite (links die Profilkarte und darunter «Abmelden», rechts die Karten), darunter eine Spalte; die Reihenfolge im Dokument ist Profil, Datenschutz (nur solange nicht gelesen), Mitteilungen, Telefon, Passwort, Hilfe, Abmelden. Jede Karte ist ein `section` mit `aria-labelledby` auf ihre Überschrift der Ebene 2; die Profilkarte trägt den Namen als Überschrift.
- [ ] **65.2** Die Profilkarte zeigt Bild oder Initialen (das Bild hat `alt=""`, der Name steht daneben), Rollen als Liste mit Namen «Rollen», Benutzername, bei Eltern die Kinder; keine Symbole vor den Angaben. Der Hinweis «Name und Benutzername ändert die Abteilungsleitung» steht als Text.
- [ ] **65.3** Schalter sind `button` mit `role="switch"` und `aria-checked`, benannt über `aria-labelledby` und beschrieben über `aria-describedby`; Text «Ein» oder «Aus» steht neben der Spur, der Zustand ist nie nur Farbe (Stellung des Knopfes, Text). Zielgrösse mindestens 44 x 44 px, Leertaste und Enter schalten, der Fokus bleibt nach dem Speichern auf dem Schalter. Die Spur hat im Tag und in der Nacht mindestens 3 : 1 zum Grund (Farbe `accent`).
- [ ] **65.4** Passwortfelder haben eine sichtbare Beschriftung; das Auge im Feld ist ein Knopf mit `aria-label` («Passwort anzeigen» oder «verbergen») und `aria-pressed`, 52 px breit, mit sichtbarem Fokus; es betrifft nur sein Feld. Der Hinweis zur Länge hängt per `aria-describedby` am Feld, steht als Satz mit Symbol («Noch 7 Zeichen bis zum Minimum», «Lang genug») und als Balken (`aria-hidden`); er meldet sich nicht bei jeder Eingabe an. Es zählt nur die Länge, die Seite behauptet keine Stärke. Der Hauptknopf «Passwort speichern» steht rechtsbündig, am Handy in voller Breite.
- [ ] **65.5** Rückmeldung nach dem Speichern: Bestätigungsband in der Karte (`role="status"`), Fehler als `role="alert"`, dazu eine Ansage in der Statusregion. Die geänderte Karte wird kurz grün hinterlegt (nur bei erlaubter Bewegung) und behält einen grünen Rand; ohne Bewegung gibt es nur den Rand. Wer als Elternteil die Nummer entfernt, sieht die Karte mit der Rückmeldung, bis die Seite neu lädt.
- [ ] **65.6** Ladezustand: Skelett in der Form der Seite (Profilkarte links, Karten rechts), `aria-busy`, für Hilfstechnik verborgen, Ansage erst nach 700 ms.
- [ ] **65.7** 390, 768, 1024, 1440 und 2560 px, Hell und Dunkel: kein waagrechtes Scrollen, kein Ziel unter 44 px, im 2560er Fenster bleibt der Inhalt in der Breite der Website. Erzwungene Farben: Spur, Balken und Porträt behalten eine Linie.
- [ ] **65.8** Anordnung (#711): Der Inhalt steht in der Breite der Website (`.wrap`). Links stehen Profilkarte und «Abmelden» untereinander, rechts füllen die übrigen Karten die Zeilen lückenlos (eine einzelne Karte am Ende der Zeile wächst über die Zeile, «Mitteilungen» und «Datenschutz» stehen über die ganze Breite). Die Reihenfolge im Dokument und die Tab-Reihenfolge bleiben Profil, Datenschutz, Mitteilungen, Telefon, Passwort, Hilfe, Abmelden; nur das Raster setzt «Abmelden» um. Bei 1280, 1440, 1920 und 2560 px, auch mit wenigen Karten, bleibt keine Fläche über 250 px Höhe leer.

### Stand der Prüfung (#689)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank mit erfundenen Demo-Konten) gesehen und bedient: 65.1 bis 65.7 bei 390, 768, 1024, 1440 und 2560 px, Hell und Dunkel (Eltern nur in Dunkel, Stufenleitung in beiden), Pflichtwechsel mit Startpasswort, Schalter mit Maus und Leertaste, Auge, Länge live, Telefon speichern und entfernen, Datenschutz, Rückfrage «Überall abmelden», sichtbarer Fokus auf Schalter und Auge, Zielgrössen gemessen (keine unter 44 px). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), Kontrastmessung mit Werkzeug (nur Augenschein), 200 % Zoom per Browser-Einstellung, Windows-Hochkontrast, sehr lange Namen.

Anordnung (#711) im Browser (Chromium, headless, Demo-Konto der Abteilungsleitung, Stil und Skript aus dem Zweig) bei 390, 1280, 1440, 1920 und 2560 px, Hell und Dunkel: 65.8, dazu mit entfernten Karten und entfernter Rollenzeile und mit der Karte «Datenschutz» oben, kein waagrechtes Scrollen, kein Ziel unter 44 px. **Nicht geprüft:** ein Konto mit Telefon-Karte (Eltern, Stufenleitung; Stand-in durch Kopie der Passwort-Karte, bei 1280 px bleibt darunter links eine freie Fläche von etwa 220 px), Tab-Reihenfolge von Hand, Screenreader, Hochkontrast.

## 69. Verwaltung: Lager, Navigation ohne Hochspringen und verständliche Status-Schritte (#693)

Gilt für `lager-rahmen.js`, `lager-status.js`, `lager-detail.js`, `lager-rahmen.css` und `verlauf.js`. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9, 10, 57 und 63 gelten. Dieser Abschnitt ersetzt 63.5, soweit er die Navigation beschreibt.

- [ ] **69.1** Die Navigation links ist kurz: Jede Gruppe (Start, Planen, Sitzungen …) ist eine Überschrift mit einem Knopf (`aria-expanded`, `aria-controls`, 44 px hoch), der die Gruppe auf- und zuklappt (die Höhe gleitet, der Pfeil dreht sich). Die Gruppe des aktiven Moduls ist immer offen; was die Person auf- oder zugeklappt hat, bleibt beim Wechsel der Module bestehen, solange die Seite offen ist (nicht im Speicher des Browsers). Zugeklappte Gruppen sind für Tastatur und Screenreader nicht erreichbar (`visibility: hidden`). Unter 900 px steht die ganze Navigation hinter dem Knopf mit dem Namen des Moduls.
- [ ] **69.2** Die Navigation braucht in der Regel keine eigene Scrollleiste. Reicht der Platz nicht (kleines Fenster), scrollt sie für sich mit der Leiste der Verwaltung (`tokens.css`, dünn, rund; es gibt keine eigene Regel dafür) und haftet unter den Leisten (`--leiste-hoehe`). Beim Wechsel der Module behält sie ihre Scrollposition und hält den aktiven Eintrag im Bild.
- [ ] **69.3** Ein Wechsel des Moduls in der Navigation und ein Wechsel des Reiters (Protokolle, Eingang, Vorlagen) lässt die Seite nicht nach oben springen. Reiter: Die Stelle der Seite bleibt genau. Anderes Modul oder Detailseite: Stand die Seite weiter unten, steht der Anfang des Moduls oben im Fenster (unter den Leisten), stand sie weiter oben, bleibt sie dort. Handeln in einem Modul (Haken, Auswahl, Filter, Speichern) lädt den Rahmen nicht neu und ändert die Scrollposition nicht. Zurück und Vor im Browser stellen die gemerkte Stelle wieder her (`verlauf.js`). Wer selbst scrollt, wird nicht zurückgeholt.
- [ ] **69.4** Der Status steht im Kopf des Arbeitsbereichs (nicht mehr rechts im Seitenkopf der Angaben): ein Chip mit Symbol und Wort und ein Satz, was er heute bedeutet. Entwurf: «In Vorbereitung. Alles lässt sich ändern, und das Lager lässt sich noch löschen.» Aktiv: «Das Lager läuft. Alles lässt sich ändern.» Abgeschlossen: «… vorbei und nur noch zum Lesen.» Archiviert: «… liegt im Archiv und ist nur zum Lesen. In der Liste steht es nur unter «Archiviert».» Die Sätze nennen nur, was der Server tut.
- [ ] **69.5** Genau eine Hauptaktion mit einem Verb für den nächsten Schritt, die übrigen Schritte im Menü neben dem Knopf (geteilter Knopf, Pfeiltasten, Escape): Entwurf «Lager starten» (Menü: «Ins Archiv legen»); Aktiv «Lager abschliessen» (Menü: «Ins Archiv legen»); Abgeschlossen «Ins Archiv legen» (Menü: «Lager wieder öffnen»); Archiviert «Lager wiederherstellen». Die Schritte sehen nur Personen mit dem Recht «Lager verwalten»; alle anderen sehen Chip und Satz.
- [ ] **69.6** Vor jedem Wechsel fragt eine Zeile im Kopf (kein Fenster): fette Frage («Lager abschliessen?»), die Folge in einem Satz («Danach kann niemand mehr etwas ändern. Du kannst es jederzeit wieder öffnen.»), «Abbrechen» und der Schritt. Der Fokus liegt auf «Abbrechen», Escape bricht ab und der Fokus kehrt zum Knopf zurück. Ein Fehler (zum Beispiel fehlende Lagerleitung) steht in der Zeile mit `role="alert"`. Nach dem Wechsel kommt die Meldung mit «Rückgängig».
- [ ] **69.7** Ohne Lagerleitung ist «Lager starten» gesperrt; der Grund steht darunter (`aria-describedby`) mit dem Weg zu den Mitgliedern.
- [ ] **69.8** Hell, Dunkel, 390 bis 1440 px, «Bewegung reduzieren» (das Aufklappen und die Zeile mit der Frage erscheinen sofort), erzwungene Farben (Chip mit Symbol und Wort, Knöpfe mit Rand).

### Stand der Prüfung (#693)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank) bei 1440 und 390 px gemessen: Wechsel des Moduls von weit unten (Seite bleibt, der Anfang des Moduls steht oben), Reiter bei Protokollen (Stelle bleibt), Haken in Packliste und Einkauf (Stelle bleibt), Navigation ohne Scrollleiste (Höhe 472 px, keine Überlänge) bei 900 und 640 px Fensterhöhe. Status: Entwurf, Frage, Starten, Meldung, Menü, «Rückgängig». Per Test: Schritte je Status, Folgesätze, kein «Aktivieren» auf einem Knopf, Verdrahtung des Behaltens der Stelle. **Nicht geprüft:** Screenreader, 200 % Zoom per Browser-Einstellung, Firefox und Safari, das Verhalten ohne Recht «Lager verwalten» im Browser (nur nach dem Quelltext), mehrere Wechsel in schneller Folge auf langsamer Leitung.

## 70. Verwaltung: Profilbilder in den Lager-Modulen (#697)

Gilt für alle Stellen in `lager-*.js`, an denen eine Person mit Namen steht (Mitglieder, Personenwahl, Aufgaben, Höcks, Pinnwand, Fahrten, Gruppen, Zimmer, Schichtplan, Anwesenheit, Diensttausch, Ressorts, Notfallkontakte, Umfragen). Die Schnittstelle liefert dafür neu das optionale Feld `bildUrl` (`LagerBildUrl` in `docs/api/openapi.yaml`); die Anzeige selbst ist `avatar()` aus `dom.js`. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4, 6, 9, 55 und 64 gelten sinngemäss.

- [ ] **70.1** Wo die Antwort `bildUrl` nennt, zeigt der Kreis der Person das Bild, sonst die Initialen. Fehlt das Feld (ältere Antwort) oder lädt das Bild nicht (403, 404, Netz), bleiben die Initialen; es gibt keinen kaputten Bildrahmen und keine Fehlermeldung.
- [ ] **70.2** Das Bild ist dekorativ (`alt=""`), der Name steht als Text daneben und ist die einzige Beschriftung. Ein Bild ersetzt nie den Namen; der Zustand einer Zeile (zum Beispiel «anwesend») steht weiter in Wort und Symbol, nie nur im Bild.
- [ ] **70.3** Teilnehmende ohne Konto (Kinder) zeigen immer Initialen: Die Antwort nennt für sie kein `bildUrl` oder `null`. Ein Test hält es fest (`test/lager/profilbild.test.ts`).
- [ ] **70.4** Das Bild lädt erst, wenn die Zeile sichtbar wird (`loading="lazy"`), mit fester Grösse im Kreis (kein Springen des Layouts, auch nicht in langen Listen wie der Personenwahl oder dem Schichtplan).
- [ ] **70.5** Ein Konto, das nicht (mehr) Mitglied des Lagers ist, und die Abteilungsleitung ohne Mitgliedschaft zeigen Initialen (die Antwort nennt kein `bildUrl`). Das ist gewollt: Es erscheint nie ein Bild, das die Route der Person nicht herausgäbe.

- [ ] **70.6** Die Kreise stehen überall gleich: 32 px in Personenzeilen (Fahrten, Gruppen, Zimmer, Abzählen), 28 px in Chips (Schichtplan, Notfallkontakte), 40 px in Tabellen (Mitglieder, Anwesenheit, Verteilung). Teilnehmende zeigen dort Initialen auf demselben Kreis, damit die Zeilen gleich hoch und gleich breit sind. Die Kreise sind `aria-hidden`; der Name steht als Text in der Zeile.

### Stand der Prüfung (#697)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank, erfundene Bilder) bei 1440 px hell und 390 px dunkel: alle Module des Bereichs Menschen und Material geöffnet (Mitglieder, Aufgaben, Höcks, Pinnwand, Fahrten, Gruppen, Zimmer, Schichtplan, Anwesenheit, Diensttausch, Abzählen, Ressorts, Notfall, Tagesseiten, Einkauf, Eingang): Bilder laden mit 200, keine 403 oder 404 und keine Fehler in der Konsole, kein seitliches Scrollen; Konto mit Bild zeigt das Bild, Konto ohne Bild und Kinder die Initialen (Schichtplan, Fahrten gesehen). Per Test (Schnittstelle): `bildUrl` bei Mitgliedern, Aufgaben (Verantwortliche, Unterstützung), Ressorts, Pinnwand, Fahrten, Personen ohne Fahrt, Gruppen, Schichtplan, Statistik, Anwesenheit; Teilnehmende `null` oder ohne Feld; Nicht-Mitglieder und deaktivierte Konten `null`; Weg «gemeinsames Lager» in `GET /personen/{id}/bild` (Mitglied 200, Aussenstehende 404). **Nicht geprüft:** Screenreader, 200 % Zoom, echtes Touch-Gerät, Zimmer, Gruppen und Anwesenheit nur nach Zahl der Kreise (nicht per Bild angesehen).

## 71. Verwaltung und Website: nichts vom Browser gezeichnet (#699)

Der Browser zeichnet an einigen Stellen eigene Oberflächen: Popups, Blasen, Listen, Wähler, Tooltips. Ihr Aussehen, ihre Sprache und ihr Verhalten liegen nicht in unserer Hand, und sie brechen das Design. Darum gibt es sie in Verwaltung und Website nicht mehr. Der Test `test/admin-keine-browserdialoge.test.ts` liest alle Dateien unter `public/` und das Server-HTML in `src/website` und sperrt sie dauerhaft; neue Dateien fallen von selbst hinein.

### Was der Browser selbst zeichnet und wie wir es ersetzen

| Vom Browser gezeichnet                                            | Bei uns                                                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alert`, `confirm`, `prompt`                                      | Zweistufiger Knopf am Ort (`zweiStufig`), Toast mit «Rückgängig» (`mitRueckgaengig`), Seite im Fluss. Der Test verbietet die Aufrufe (auch über `window`, `globalThis`, `onclick`). |
| «Seite verlassen?» bei Menü, Link, Zurück                         | Eine Zeile im Inhalt: «Änderungen verwerfen?», «Bleiben», «Verwerfen und gehen» (`ungespeichert.js`; Seiten im Fluss fragen mit ihrer eigenen Zeile).                               |
| «Seite verlassen?» beim Schliessen oder Neuladen des Tabs         | **Bleibt** als letzte Rückfallebene: Dafür gibt es keinen anderen Weg. Nur eine Stelle (`ungespeichert.js`), nur mit echten ungespeicherten Änderungen.                             |
| Validierungsblasen («Bitte füllen Sie dieses Feld aus»)           | Jedes Formular hat `novalidate`; Fehler stehen am Feld (`feld-fehler`, `aria-describedby`) und in der Zusammenfassung. Kein `setCustomValidity`, kein `reportValidity`.             |
| Aufklappliste des `select`                                        | Eigenes Auswahlfeld (`auswahl.js`, Website `auswahl.js`); das `select` bleibt nur als Wertträger.                                                                                   |
| Datums-, Zeit-, Monats-, Farb- und Zahlenwähler, `datalist`       | `datumsfeld.js` (Datum, Zeit, Zahl), eigene Vorschlagslisten (`ort-suche.js`, Personenwahl). Der Test verbietet die Typen und `datalist`.                                           |
| Tooltip des `title`-Attributs                                     | Eigener Hinweis `data-tipp` (`tipp.js`): Maus nach 450 ms, Tastatur sofort, Escape schliesst, `role="tooltip"`. Reine Wiederholungen des Namens stehen nicht darin.                 |
| Dateiwahl                                                         | Eigener Knopf (`dateiFeld`), das rohe Feld bleibt unsichtbar. Der **Systemdialog der Dateiwahl bleibt**: Er ist unvermeidlich.                                                      |
| Native `details`/`summary`, `dialog.showModal()`, Drucken, Teilen | Erlaubt: eigener Inhalt, Nutzeraktion.                                                                                                                                              |

### Prüfpunkte

- [ ] **71.1** Kein Browser-Popup: Weder `alert`, `confirm` noch `prompt` kommt vor. Rückfragen sind ein zweistufiger Knopf am Ort, ein Toast mit «Rückgängig» oder eine Seite im Fluss.
- [ ] **71.2** Ungespeicherte Eingaben: Menü, Link, Browser-Zurück und jede Adressänderung zeigen die eigene Zeile «Änderungen verwerfen?» (`role="alert"`, der Fokus steht auf «Bleiben»). «Bleiben» lässt alles, wie es ist, die Adresse bleibt; «Verwerfen und gehen» setzt zurück und führt zum Ziel. Das gilt für Mein Konto, jede Speicherleiste (Termine, Anlässe, Lädeli), Rollen und Rechte, Rechte des Lagers, Neues Lager, Aufgaben-Detail, Website-Editor und jede Seite im Fluss.
- [ ] **71.3** Der Dialog des Browsers «Seite verlassen?» erscheint nur beim Schliessen oder Neuladen des Tabs und nur bei echten ungespeicherten Änderungen: nicht nach dem Laden, nicht nach «Speichern», «Verwerfen» oder «Rückgängig».
- [ ] **71.4** Kein Formular zeigt eine Blase des Browsers: Jedes `form` hat `novalidate`. Ein leeres Pflichtfeld meldet sich mit Text am Feld («Bitte ausfüllen.»), `aria-invalid="true"` und `aria-describedby`; der Fokus geht auf das erste Fehlerfeld.
- [ ] **71.5** Keine native Aufklappliste, kein nativer Datums-, Zeit-, Farb- oder Zahlenwähler, keine `datalist`; jedes `select` ist das eigene Auswahlfeld.
- [ ] **71.6** Kein `title`-Attribut als Tooltip. Wo ein Element mehr sagt, als sein Name hergibt, steht `data-tipp`: Der Hinweis ist mit der Tastatur erreichbar (Fokus), mit Escape schliessbar, hält beim Darüberfahren (WCAG 1.4.13), hat 4.5:1 Kontrast und braucht keine Bewegung. Information, die nur im Hinweis stünde, steht zusätzlich als Text (gesperrter Knopf: Grund neben dem Knopf).
- [ ] **71.7** Die Dateiwahl hat einen eigenen Knopf mit Namen; das rohe Feld ist unsichtbar, aber per Tastatur erreichbar und beschriftet. Nur der Systemdialog zur Dateiwahl kommt vom Browser.

### Stand der Prüfung (#699)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank, Tag und Nacht) geprüft:

- **Skriptprobe aller Seiten:** Alle 32 Seiten der Verwaltung, 34 Seiten und Unterseiten des Lagers (Arbeitsbereich, alle Module, «Neues Lager», Rechte, Vorlagen) und 14 Seiten der Website (angemeldet und abgemeldet: Termine, Vorschlag, Anmeldung, Konto, Lädeli, Fotos, Mitmachen, Gruppen) liefen mit Protokoll der Dialoge des Browsers. Jede Seite wurde geladen, danach wurde jeder sichtbare Knopf einzeln angeklickt (bis zu 30 je Seite, im Lager 22, ausser «Abmelden»), bei einem offenen Formular zusätzlich leer abgesendet. Nach jedem Schritt wurden alle `form`, `select`, `input`, `datalist`, `title`, SVG-`title` und der Zustand von `beforeunload` gelesen und alle Aufrufe von `alert`, `confirm`, `prompt`, `reportValidity`, `setCustomValidity` mitgeschrieben.
- **Ergebnis:** Kein Dialog des Browsers, keine Validierungsblase, kein natives `select`, kein Datums-, Zeit- oder Farbwähler, keine `datalist`, kein sichtbares Dateifeld. `beforeunload` war nach keinem Laden und keinem Klick scharf.
- **Gefunden und ersetzt:** (1) Drei Formulare ohne `novalidate` (Lager-Kopfsuche, Punktformulare der Aufgaben und To-dos); (2) Tooltips per `title` (Logo und «Verwaltung» im Kopf, Marken «Öffentlich», «Löscht», «Kinderdaten», «2. Faktor» und «Fest» bei den Rechten, Griff zum Ziehen, Anruf-Knopf, Stern «Gemerkt», Marke «Jetzt» in der Belegung, Kürzel der Wochentage, Zeitangaben im Systemzustand und im Protokoll, Zahl «+3» bei den Chips, runde Knöpfe im Zuschneiden, Werkzeugleiste des Editors); (3) der Grund des gesperrten Knopfes «Original verwenden» stand nur als Tooltip und steht jetzt als Text neben dem Knopf; (4) «Seite verlassen?» des Browsers erschien nur beim Schliessen und Neuladen, nie bei Menü, Link oder Browser-Zurück: Dort wurden ungespeicherte Änderungen still verworfen (Mein Konto, Speicherleisten, Rollen und Rechte per Zurück). Jetzt fragt überall die eigene Zeile.
- **Ungespeichert, Szenarien:** Mein Konto (Schalter ändern, Menü, Browser-Zurück, «Bleiben», «Verwerfen und gehen»), Seite im Fluss (Person erfassen: Menü, Browser-Zurück, «Verwerfen»), «Verwerfen» über die Speicherleiste: jeweils kein Browserdialog, Adresse bleibt beim «Bleiben», danach ist `beforeunload` nicht mehr scharf.
- **Nicht geprüft:** Safari und Firefox; Bildschirmleser; Touch (der Hinweis `data-tipp` erscheint dort nicht, die Information steht im Namen oder im Text); jede einzelne Zeile der Seiten, die nur mit Daten erreichbar sind, die die Demo-Datenbank nicht enthält.
- **Bleibt unvermeidlich:** der Dialog des Browsers beim Schliessen oder Neuladen des Tabs mit echten ungespeicherten Änderungen, und der Systemdialog der Dateiwahl.

## 78. Website und Verwaltung: Bausteine mit Daten aus Cevi OS (#740)

Gilt für die Bausteine «Nächster Anlass», «Anlässe», «Lager-Karte», «Countdown», «Treffpunkte», «Dokumente» und «Cevi in Zahlen» (`src/website/dynamisch.ts`, Stil `public/website/dynamisch.css`) und ihre Felder im Editor (`public/admin/website-felder-dynamisch.js`). Massstab WCAG 2.2 AA; die Seiten sind statisch und ohne Skript benutzbar.

**Website**

- [ ] **78.1** Jede Karte hat eine Überschrift (Anlass, Ort) auf der Ebene unter der letzten Überschrift der Seite, höchstens `h3`; Datum, Zeit, Ort, Anmeldeschluss und Kosten stehen als Beschreibungsliste (`dl`), das Datum als `<time datetime>`.
- [ ] **78.2** Das Datumsfeld ist `aria-hidden`; derselbe Inhalt steht als Text in den Angaben. Der Zustand «Anmeldung offen» steht als Wort im Etikett, nicht nur als Farbe; die Art (Anlass, Lager) ebenfalls.
- [ ] **78.3** Jeder Knopf nennt sein Ziel für Screenreader («Anmelden zu Sommerlager», `nur-sr`), auch in einer Liste mit mehreren gleichen Knöpfen; nur der erste rote Knopf der Seite ist Hauptaktion.
- [ ] **78.4** Countdown: ein Satz im Fliesstext («Noch 12 Tage bis …»), Datum als Text daneben; kein Zähler im Browser, nichts blinkt oder wird angesagt; «Heute» und «1 Tag» stimmen in der Einzahl.
- [ ] **78.5** Treffpunkte: der Link zur Karte steht als Verweis mit dem Zeichen für «fremde Seite» und dem Namen des Orts für Screenreader («Auf Google Maps ansehen: Pfadiheim»); keine eingebettete Karte.
- [ ] **78.6** Dokumente: jeder Link nennt den Titel und «(externe Seite)»; Typ und Grösse stehen als Text dahinter; die Trefferfläche ist mindestens 44 Pixel hoch.
- [ ] **78.7** «Cevi in Zahlen»: grosse Zahl mit Beschriftung im Text (Einzahl und Mehrzahl richtig), Kontrast mindestens 4,5 : 1 in Hell und Dunkel, Zahl nie allein ohne Wort.
- [ ] **78.8** Leere Liste: «Im Moment sind keine Anlässe eingetragen.» als Zustand, nie eine leere Fläche.
- [ ] **78.9** 390, 1280 und 1920 Pixel ohne Seitenscroll, 200 Prozent Zoom, Hell und Dunkel nur über Tokens; die Karte stapelt sich unter 47.5 em (Datum über dem Text); erzwungene Farben: Rand statt Fläche.

**Verwaltung**

- [ ] **78.10** Die Wahl des Anlasses ist ein Auswahlfeld mit Label; sie meldet Laden («Anlässe werden geladen …», `role="status"`), Fehler (`role="alert"` mit «Nochmals versuchen») und Leere (Hinweis, wo man den Anlass anlegt). Ein gewählter Anlass, der nicht mehr öffentlich ist, bleibt sichtbar als «Gewählter Anlass (nicht mehr öffentlich oder gelöscht)».
- [ ] **78.11** Orte und Zahlen sind Ankreuzlisten in einer Gruppe (`fieldset`, `legend`), jede Zeile mindestens 44 Pixel hoch, das Label ist das Ziel; ein Fehler steht beim Feld.
- [ ] **78.12** Fehler der Verweisprüfung (`ANLASS_UNBEKANNT`, `ANLASS_NICHT_OEFFENTLICH`, `ORT_UNBEKANNT`) erscheinen als Satz beim Baustein; kein Browserdialog.

### Stand der Prüfung (#740)

Im Browser (Chromium, Playwright) gegen die Demo-Abteilung: Seite mit allen sieben Bausteinen in der Vorschau und als erzeugte Datei bei 390, 1280 und 1920 Pixel, Hell und Dunkel. Nicht geprüft: Screenreader (VoiceOver, TalkBack, NVDA) und echte Geräte; Kontraste aus den Tokens der Website, nicht neu gemessen. Befunde: PR zu #740.

## 72. Website: feste Seite «Datenschutz: Cevi OS, App, Verwaltung und Website» (#712)

Gilt für `/datenschutz-cevi-os` (`datenschutz-cevi-os.ts`, `datenschutz.css`) und die neuen Links auf sie (Fuss, Mein Konto, `/support`, `/konto-loeschen`). Massstab WCAG 2.2 AA. Es ist eine lange Seite aus Text ohne Skript und ohne Formular.

- [ ] **72.1** Genau eine Überschrift der Ebene 1 (der Seitentitel), eine der Ebene 2 («11 Zusätzlich für Cevi OS …»), acht der Ebene 3 (11.1 bis 11.8) und die Kategorien als Ebene 4; keine Ebene wird übersprungen. Der Fuss bringt seine eigenen Überschriften der Ebene 2 mit, wie auf jeder Seite.
- [ ] **72.2** `lang="de-CH"`; Sprunglink «Zum Inhalt», `main` mit `id="inhalt"`.
- [ ] **72.3** Die Liste «Auf dieser Seite» ist eine `nav` mit `aria-labelledby` auf ihren Titel; jeder Link führt auf eine vorhandene `id` der Überschrift (`abschnitt-11-1` bis `abschnitt-11-8`); jede Zeile ist mindestens 44 px hoch; der Fokus ist sichtbar, und die Sprungmarke verdeckt der feste Kopf nicht (`scroll-padding-top` in `kopf.css`).
- [ ] **72.4** Links sind unterstrichen und tragen ihren Zweck im Text («Konto löschen», «Allgemeine Datenschutzerklärung des Cevi Stäfa-Hombrechtikon»); keine Farbe als einziges Zeichen. Der Link zurück steht oben und unten.
- [ ] **72.5** Farben nur aus den Tokens der Website: Tag, Nacht und erhöhter Kontrast gelten wie auf jeder Seite (Text 4,5 : 1, Rahmen der Liste 3 : 1).
- [ ] **72.6** Zoom 200 % und 320 px Breite: kein waagrechtes Scrollen, der Text bricht um; Zeilenlänge höchstens 70 Zeichen (`.lesetext`).
- [ ] **72.7** Bewegung: Das Einblenden beim Scrollen ist für den langen Textblock ausgeschaltet (er stünde sonst über seine ganze Länge blass); ohne Skript und mit «Bewegung reduzieren» ändert sich nichts.

### Stand der Prüfung (#712)

Im Browser (Chromium, headless, die Seite aus dem Code in eine Datei erzeugt und von einem lokalen Dateiserver ausgeliefert, Abteilung mit Beispieldaten) gesehen: 72.1, 72.3, 72.5 und 72.6 bei 1440, 390 und 320 px, Hell und Dunkel (Text hell auf dunkel rund 14 : 1), kein waagrechtes Scrollen, Zielhöhe der Liste 44 px, Fokus sichtbar, alle acht Anker vorhanden; 72.2, 72.4 und 72.7 im Markup und im Stil geprüft, nicht im Browser bedient. Im Test (`website-datenschutz-cevi-os.test.ts`): Überschriftenfolge, acht Abschnitte, 42 Kategorien, Anker, Links, Maskierung. **Nicht geprüft:** Bildschirmleser, Safari und Firefox, Touch, erhöhter Kontrast mit erzwungenen Farben, 400 % Zoom.

## 73. Verwaltung: Zweiten Faktor einrichten (#715)

Die Seite «Zweiten Faktor einrichten» erscheint nach der Anmeldung, wenn ein Recht den zweiten Faktor verlangt und keiner eingerichtet ist (`admin.js`, `zeigeEinrichtung`). Derselbe Ablauf (`zweiter-faktor-einrichten.js`) steht freiwillig unter «Mein Konto». Er hat drei Schritte: Passwort bestätigen, Konto in der App eintragen (QR-Code oder Schlüssel, erster Code), Ersatzcodes speichern. Den QR-Code zeichnet `qr.js` im Browser als SVG, ohne Abhängigkeit und ohne Skript von Dritten.

### Prüfpunkte

- [ ] **73.1** Tastatur: Jeder Schritt ist ohne Maus zu bedienen; die Tabfolge geht Feld, Hauptknopf, «Abbrechen» oder «Abmelden». Nach jedem Schritt steht der Fokus auf der neuen Überschrift (`h2`, `tabindex="-1"`), damit der Bildschirmleser den Schritt ansagt. Enter im Passwortfeld geht weiter, die sechste Ziffer des Codes bestätigt von selbst.
- [ ] **73.2** Fokus: Jedes Bedienelement trägt einen sichtbaren Fokusring (3 px), auch im dunklen Theme. Nach einem Fehler geht der Fokus ins Feld; ein Fehler ohne Feld (Netz, Server) bekommt `role="alert"` und den Fokus.
- [ ] **73.3** Fehlermeldungen am Feld: «Das Passwort stimmt nicht», «Der Code stimmt nicht» und «Gib die sechs Ziffern aus der App ein» stehen als Text mit Symbol beim Feld (`aria-invalid`, `aria-describedby`), nie nur als Farbe. Das Formular hat `novalidate`; kein Dialog und keine Blase des Browsers.
- [ ] **73.4** Schlüssel für den Bildschirmleser: Der Schlüssel steht in Gruppen zu vier Zeichen zum Abtippen und wird zeichenweise vorgelesen («K Q Y G, Y 2 S S, …», `nur-leser`); die sichtbare Fassung ist für den Bildschirmleser versteckt, damit er ihn nicht doppelt liest. «Schlüssel kopieren» meldet das Ergebnis in einer Statusregion, auch wenn das Kopieren nicht geht («Markiere den Schlüssel von Hand»).
- [ ] **73.5** QR-Code mit Textalternative: Das SVG ist ein Bild (`role="img"`) mit der Beschriftung «QR-Code für die Authenticator-App. Den Schlüssel dazu findest du als Text darunter.» Der Code ist immer Schwarz auf Weiss mit Ruhezone, im hellen und im dunklen Theme, und der Schlüssel als Text steht immer dabei: Wer nicht scannen kann, kommt ohne Kamera zum Ziel.
- [ ] **73.6** Kontrast: Text mindestens 4,5:1, Knöpfe und Rahmen mindestens 3:1, hell und dunkel. Der Fehlertext erreicht mindestens 7:1.
- [ ] **73.7** Reflow und Schrift: Bei 320 px Breite gibt es kein waagrechtes Scrollen; die Ersatzcodes stehen unter 32 em in einer Spalte und brechen nicht mitten im Code um. Text und Schlüssel wachsen mit der Schrift.
- [ ] **73.8** Ersatzcodes: Sie stehen als Liste «Ersatzcodes» mit «Ersatzcodes kopieren». «Zur Verwaltung» oder «Fertig» verlangt das Häkchen «Ich habe die Ersatzcodes gespeichert»; ohne Häkchen erscheint ein Hinweis beim Häkchen (`role="alert"`) und der Fokus geht dorthin. Danach sind die Codes aus der Seite gelöscht.
- [ ] **73.9** Bewegung: Der Ablauf kommt ohne Animation aus; nichts blinkt.

### Stand der Prüfung (#715)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank, Demo-Abteilung) mit einem Test-TOTP (RFC 6238, im Skript nachgerechnet) geprüft: Pflichtseite für ein Konto der Abteilungsleitung und für eine Person mit Webmaster-Rolle, «Mein Konto» für eine Stufenleitung, hell und dunkel, 1100 und 375 px; danach verlangt die neue Anmeldung den Code. Punkte 73.1 bis 73.3, 73.6 und 73.7 sind mit Tabfolge, berechnetem Fokusring, berechnetem Kontrast (hell mindestens 5,4:1, Fehlertext 7,9:1, dunkel 5,4:1 und 7,0:1) und der Messung der Breite bei 320 px belegt. Der QR-Code aus dem Browser wurde mit zbar und OpenCV dekodiert und gleicht dem Link der API.

**Nicht geprüft:** VoiceOver, TalkBack und NVDA (73.4, 73.5, 73.8 nur als Quelltext und Rolle), echte Authenticator-Apps auf einem Telefon, Safari und Firefox, 400 % Zoom von Hand, die Wirkung von «Bewegung reduzieren» im Betriebssystem.

## 74. Verwaltung: Rollen «Abteilungsleitung» und «Entwickler» aus dem Konto (#737)

Dieser Abschnitt gilt für die Chips und Schalter, die die Rolle zeigen: «Mein Konto» (`konto.js`), Rolle im Kopf (`navigation.js`, `rolleVon`), Personenliste und Personenblatt (`personen.js`, `personen-blatt.js`). Die Rollen kommen aus `GET /api/v1/ich` (`abteilungsleitung`, `entwickler`) und werden über `sicht.js` gelesen. Neu sind der Chip und die Zeile «Entwickler», der Filter und die Gruppe «Entwickler» in der Personenliste und ein Hilfetext im Personenblatt. Es gibt keine neue Bedienung.

### Prüfpunkte

- [ ] **74.1** Die Rolle steht als Text, nie nur als Farbe: «Abteilungsleitung» und «Entwickler» sind Chips mit Beschriftung (Mein Konto, Personenkarte, Liste) und eine Textzeile unter dem Namen (Kopf, Personenblatt). Ein Konto mit beiden zeigt beide Wörter.
- [ ] **74.2** Der Filter «Rolle» in der Personenliste hat die Optionen «Abteilungsleitung» und «Entwickler» und bleibt mit der Tastatur bedienbar; die Gruppen «Abteilungsleitung» und «Entwickler» tragen je eine Überschrift mit Zähler.
- [ ] **74.3** Der Hilfetext im Personenblatt («Diese Person ist auch Entwickler …») steht als Absatz unter der Zeile «Abteilungsleitung» (Gruppe «Abteilung», Segment «Nein | Ja», seit #799 kein Kontrollkästchen mehr) und ist für Bildschirmleser lesbar (kein `title`, kein Tooltip). Die Segmentwahl hat den Namen «Abteilungsleitung: <Person>»; die Rolle «Entwickler» ist nur zu lesen und hat keine Wahl.
- [ ] **74.4** Kontrast und Reflow der neuen Chips wie die übrigen Chips (4,5:1 Text, 3:1 Rahmen, hell und dunkel; bei 320 px brechen die Chips um).

### Stand der Prüfung (#737)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank, Demo-Abteilung, Server auf einem lokalen Port mit dem Vertrag aus Teil 8) gesehen bei 1280 und 2560 px, hell und dunkel: Personenliste mit Filter und Chips, Personenblatt einer Person mit Rolle «Entwickler» (Hilfetext), Schalter «Abteilungsleitung» (PATCH mit `abteilungsleitung`, 204, danach der Chip in der Liste), «Mein Konto» und Übersicht für Abteilungsleitung, Entwickler, Stufenleitung und Webmaster, ein Konto ohne Zugang («Dieses Konto hat keinen Zugang zur Verwaltung»).

**Nicht geprüft:** VoiceOver, TalkBack und NVDA, Safari und Firefox, 320 px und 400 % Zoom von Hand, die Wirkung von «Bewegung reduzieren» im Betriebssystem.

## 79. Website: Bausteine «Einstieg und Handlung» (#743)

Gilt für die Bausteine `kopfbereich`, `inhaltsverzeichnis`, `weiterfuehrend`, `kontaktleiste`, `weitersagen`, `seitenwechsel` und `brotkrumen` (`handlung.ts`, Abschnitt «Einstieg und Handlung» in `website.css`) und ihre Formulare im Seiten-Editor (`website-felder-handlung.js`). Massstab WCAG 2.2 AA. Alles ohne Skript.

- [ ] **79.1** Der Kopfbereich hat genau eine Überschrift der Ebene 2 (der Seitentitel bleibt die Ebene 1; die Ebene springt nie um mehr als eine). Das Bild trägt den Alt-Text des Mediums; ohne Bild entfällt es ganz.
- [ ] **79.2** Weisse Schrift auf dem blauen Kasten und Band: Text 4,5 : 1 und mehr in Hell und Dunkel (das Blau ändert sich nicht); der Fokusring der Schaltflächen ist hell (`outline-color: var(--on-secondary)`). Nur die erste Schaltfläche der Seite ist rot.
- [ ] **79.3** Das Inhaltsverzeichnis ist eine `nav` mit `aria-labelledby` auf ihren Titel (ein `p`, keine Überschrift, damit die Gliederung der Seite gleich bleibt). Jeder Link führt auf eine vorhandene `id` einer Überschrift der Ebene 2; jede Zeile ist mindestens 44 px hoch; der feste Kopf verdeckt das Ziel nicht (`scroll-padding-top` in `kopf.css`).
- [ ] **79.4** Weiterführende Links: Die ganze Karte ist genau ein Link (kein Link in einem Link, keine Überschrift im Link); der Name des Links ist Titel und Kurztext; der Pfeil ist `aria-hidden`. Eine fremde Adresse trägt «(externe Seite)» für Screenreader und einen Pfeil nach oben rechts; Farbe ist nie das einzige Zeichen. Zielhöhe mindestens 44 px.
- [ ] **79.5** Kontaktleiste: eine `address` mit Liste; Telefon und E-Mail sind Links (`tel:`, `mailto:`) mit sichtbarem Wort «Telefon», «E-Mail» davor; Symbole sind `aria-hidden`. Werte brechen um (`overflow-wrap: anywhere`), auch bei 320 px.
- [ ] **79.6** Weitersagen ist ein Link mit sichtbarem Text und Symbol (kein Knopf ohne Wort); er öffnet das Mailprogramm, ohne Skript und ohne Dienst von aussen.
- [ ] **79.7** Brotkrumen: `nav` mit `aria-label="Du bist hier"` und geordneter Liste; die letzte Stufe trägt `aria-current="page"` und ist kein Link; das Trennzeichen hat einen leeren Alternativtext (`content: "›" / ""`). Seitenwechsel: `nav` mit `aria-label="Weitere Seiten"`, jeder Link nennt Richtung und Titel («Nächste Seite Stufe Exodus»), `rel="prev"` und `rel="next"`; Pfeile sind `aria-hidden`.
- [ ] **79.8** Zoom 200 % und 320 px: kein waagrechtes Scrollen; Karten und Seitenwechsel stehen untereinander. Mit `prefers-reduced-motion: reduce` bewegt sich nichts (der Pfeil rückt nur ohne diese Einstellung vor); im Modus für erzwungene Farben behalten Karten und Knöpfe ihren Rand.
- [ ] **79.9** Formulare im Editor: Jedes Feld hat ein sichtbares Label über dem Feld, Fehler stehen am Feld (Pfad wie beim Server), die Angaben der Kontaktleiste sind Kästchen in einer Gruppe mit Legende, die Auswahl der Darstellung ist ein Segment (Radios); keine Browserdialoge. Die Hilfetexte sagen, wann ein Baustein nichts zeigt (Verzeichnis mit weniger als zwei Überschriften, Seitenwechsel ohne Nachbarn).

### Stand der Prüfung (#743)

Im Browser (Chromium, headless, lokale Kopie der Datenbank mit Beispieldaten, Testseite mit allen sieben Bausteinen im Menübaum, veröffentlicht und vom Abgleich erzeugt) gesehen: 79.1, 79.2, 79.3, 79.4, 79.5, 79.7 und 79.8 bei 1280, 1920 und 390 px, Hell und Dunkel, kein waagrechtes Scrollen, alle Anker vorhanden. Die Formulare des Editors wurden in der Seite geladen und gezeichnet (Module, Zyklus der Importe, Kästchen, Segment, Listen), aber nicht in der angemeldeten Verwaltung durchgeklickt. Im Test (`website-handlung.test.ts`): Schema mit Grenzen und Ablehnung, Verweise, Rendern mit Maskierung, Anker, Menübaum, `mailto`. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), Zoom 400 %, erzwungene Farben im Browser, Safari und Firefox, die angemeldete Bedienung der Formulare mit Tastatur, die Vorschau im Katalog («Baustein hinzufügen») dieses Zweigs.

## 75. Verwaltung: Bausteine mit Vorschau im Katalog und im Editor (#739)

Gilt für den Katalog «Baustein hinzufügen» (`katalogDialog` in `website-bausteine.js`, Einträge in `KATALOG`) und für «Vorschau zeigen» in der Bausteinliste des Editors (`website-vorschau.js`, `website-editor.js`). Beide zeigen den Baustein mit demselben Renderer wie die Website (`POST /api/v1/redaktion/bausteine/vorschau`) in einem Rahmen ohne Skript. Massstab WCAG 2.2 AA.

- [ ] **75.1** Der Katalog ist eine Seite im Fluss mit Suche, Gruppenwahl (Pillen mit `aria-pressed`, «Alle» zuerst), «Einfügen»-Auswahl und den Gruppen Text, Bilder und Medien, Karten und Listen, Handlung, Personen, Dynamisch, Gestaltung, je mit einer Überschrift der Ebene 3 und einer Liste von Kacheln. Jede Kachel hat einen Namen und einen Satz als Text; die Vorschau ist nur Bild (`inert`, `aria-hidden`), nie die einzige Information.
- [ ] **75.2** Tastatur: Tab erreicht genau eine Kachel (roving tabindex), Pfeiltasten wandern durch die sichtbaren Kacheln (links und rechts einzeln, oben und unten über die Zeile, Pos1 und Ende), Enter oder Leertaste fügt den Baustein ein (der Editor des Bausteins öffnet sich), Escape schliesst den Katalog. Aus der Suche führt Pfeil nach unten oder Enter zur ersten Kachel. Der Fokus bleibt sichtbar: Ring 3 px um die ganze Kachel (Farbe `--akzent`: Tag rgb(1, 57, 116), rund 11 : 1 auf Weiss; Nacht rgb(157, 192, 234)), nie nur am Text.
- [ ] **75.3** Die Eingabe in der Suche filtert sofort (Name, Beschreibung und Gruppe); die Zahl der Treffer steht in einer Statusregion; ohne Treffer erscheint «Keinen Baustein gefunden.» mit «Suche zurücksetzen». Eine Gruppe ohne sichtbare Kachel verschwindet samt Überschrift.
- [ ] **75.4** Laden: Jede Kachel zeigt sofort ein Skelett in der Form einer Seite; die Statusregion sagt «Vorschauen laden …» und «Die Vorschauen sind geladen.». Scheitert das Laden, steht ein Hinweis mit «Nochmals versuchen» und dem Satz «Du kannst trotzdem einen Baustein wählen.»; jede Kachel bleibt wählbar («Keine Vorschau»).
- [ ] **75.5** Hell und Dunkel: Die Verwaltung folgt dem Farbschema, die Vorschau bleibt immer hell, weil so die meisten Besucher die Seite sehen; der Satz unter der Suche sagt es («so wie die Website ihn zeigt (hell)»). Der Text der Kachel (`--text`, `--leise`) und der Rahmen kommen aus den Tokens der Verwaltung.
- [ ] **75.6** Bildschirmgrössen: Die Kachel ist 300 px breit (260 px bis 480 px Fensterbreite) und zeigt die Website 1100 px breit verkleinert; Raster mit so vielen Spalten, wie passen; kein waagrechtes Scrollen bei 390 px.
- [ ] **75.7** Bewegung: Nur der Wechsel von Hintergrund und Rand beim Darüberfahren (0,15 s) steht in `@media (prefers-reduced-motion: no-preference)`; das Skelett pulsiert nur dort (`komponenten.css`). Das Karussell und andere Bewegung der Website laufen in der Vorschau nie (kein Skript).
- [ ] **75.8** Editor: «Vorschau zeigen» steht in jeder Zeile der Bausteinliste, ist ein Knopf mit `aria-expanded` und `aria-controls`, der Name nennt den Baustein («Vorschau zeigen: Karten»). Die Vorschau klappt unter der Zeile auf, zeigt die aktuellen Eingaben des Entwurfs auch ungespeichert und bleibt beim Neuzeichnen der Liste offen. Der Rahmen hat einen Namen («Vorschau: Karten»); der Satz darunter nennt Grenzen (hell, Breite der Spalte, Links und Bewegung ohne Funktion). Links in der Vorschau haben kein Ziel und sind kein Tabstopp.
- [ ] **75.9** Zustände der Vorschau im Editor: lädt (Skelett, `aria-busy`, Statusregion), geladen, «Noch nichts zu zeigen. Fülle den Baustein aus, dann erscheint die Vorschau.» (Baustein ungültig), «Dieser Baustein zeigt auf der Website noch nichts …» (leer), Fehler mit «Nochmals versuchen» (offline, zu viele Anfragen, kein Recht).
- [ ] **75.10** Sicherheit der Vorschau: Rahmen mit `sandbox="allow-same-origin"` (nie `allow-scripts`), `srcdoc`, eigene CSP in der Seite ohne Skript und ohne Verbindungen; kein `innerHTML` in der Verwaltung; HTML entsteht nur im Renderer aus Daten, die das Schema des Bausteins geprüft hat.

### Stand der Prüfung (#739)

Im Browser (Chromium, headless, Kopie der Datenbank, Seite mit erfundenen Texten, `RECHTE_MODELL=neu`) bei 1280, 2560 und 390 px, Tag und Nacht, dazu 1280 px mit «Bewegung reduzieren»: 27 Kacheln in 7 Gruppen, direkt nach dem Öffnen 27 Skelette, danach 27 Rahmen mit Vorschau (keine «Keine Vorschau»); eine Kachel ist per Tab erreichbar; Suche nach «karte» zeigt 9 Treffer, «zzzz» den Leerzustand, «Suche zurücksetzen» und die Gruppe «Personen» (4 Kacheln) wirken; Pfeil nach unten aus der Suche, Pfeiltasten und Enter fügen ein (der Editor des Bausteins öffnet sich), Escape schliesst; Fokusring 3 px in Tag und Nacht; kein waagrechtes Scrollen bei 390 px; keine Fehler und keine CSP-Meldungen in der Konsole. Im Editor: 7 Knöpfe «Vorschau zeigen», die Vorschau klappt auf und zeigt die echte Karten-Darstellung der Website. Im Test (`admin-website-vorschau.test.ts`, `redaktion-bausteine-vorschau.test.ts`): jeder Katalogeintrag hat `gruppe` und `beispiel`, das Beispiel erfüllt das Schema und der Renderer zeigt etwas; Platzhalter statt Datenbank; Recht, Grenzen und Rate-Limit der Route. **Nicht geprüft:** Bildschirmleser (NVDA, VoiceOver, TalkBack), 200 % und 400 % Zoom, echtes Touch-Gerät, Safari und Firefox, erhöhter Kontrast mit erzwungenen Farben.

## 76. Website und Verwaltung: Bilder und Medien (#742)

Gilt für die Bausteine «Bildraster», «Bild mit Text», «Bildvergleich», «Logo-Reihe», «Breites Bild», «Bildstreifen», «Bilderpaket» und für die Videokarte des Bausteins «Link zu Video» (`src/website/medien-bausteine.ts`, `public/website/medien.css`, `vergleich.js`, Grossansicht `lichtkasten.js`) sowie ihre Felder im Editor (`public/admin/website-felder-medien.js`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4 und 9 gelten sinngemäss.

**Website**

- [ ] **76.1** Der Alt-Text liegt nur am Medium. Im Bildvergleich und in der Logo-Reihe verlangt der Server ihn (`MEDIUM_ALT_FEHLT`): ein Logo ist ohne Namen ein Link ohne Namen, ein Vergleich ohne Beschreibung kein Vergleich. In Raster, Streifen, breitem Bild und Bild mit Text darf ein Bild als Zierde markiert sein (leerer Alt-Text). Wiederholt der Alt-Text nur den Titel daneben (Vorschaubild von Paket und Video), bleibt er leer.
- [ ] **76.2** Der Titel auf dem Bild und der Titel des Bilderpakets sind Überschriften eine Ebene unter der letzten Überschrift der Seite (höchstens Ebene 3), nie ein fetter Absatz. Die Reihenfolge im Quelltext ist die Lesereihenfolge: Bild, Titel, Text, Link.
- [ ] **76.3** Text auf einem Bild liegt auf einem dunklen Verlauf, der mit dem Text wächst: Weiss auf mindestens 86 % Schwarz (15,5 : 1 über einem reinweissen Foto), beim Text über dem ganzen Bild auf 62 % (6,2 : 1). Der Fokusring ist dort weiss. Mit erzwungenen Farben (`forced-colors`) tritt eine Fläche des Systems an die Stelle des Verlaufs.
- [ ] **76.4** Tastatur: Jedes Bild eines Rasters, Streifens und das breite Bild sind Links zur Grossansicht (Tab, Enter; Esc schliesst, der Fokus geht zurück aufs Bild, Pfeiltasten blättern in der Folge des Rasters oder Streifens). Logos mit Link und die Videokarte sind je ein Tabstopp mit dem Namen des Ziels. Der Bildstreifen scrollt mit der Tastatur über die Links seiner Bilder; er ist eine Gruppe mit Namen und Zahl («Bildstreifen mit 12 Bildern»).
- [ ] **76.5** Bildvergleich: Der Schieber ist ein echtes `input type="range"` mit Namen («Schieber: Früher und Heute vergleichen») und Wert für Screenreader («60 Prozent Früher, 40 Prozent Heute»); Pfeiltasten bewegen um 5 %, Pos1 und Ende gehen an den Rand, ein Klick oder Ziehen setzt die Kante (2.5.7: kein Ziehen ist nötig). Die Linie und der Knopf sind unsichtbar für Screenreader; der Fokus zeigt sich am Knopf (Ring 3 Pixel). Ohne Skript stehen beide Bilder mit ihrer Bezeichnung nebeneinander oder untereinander und tragen dieselbe Information.
- [ ] **76.6** Bewegung: Nichts bewegt sich von selbst. Die Farbe der Logos in Graustufen kommt beim Zeigen und mit Fokus zurück, ein weicher Übergang nur unter «Bewegung nicht reduzieren»; Einblenden beim Scrollen folgt den Regeln der Website.
- [ ] **76.7** Zielgrössen mindestens 44 Pixel: Logo-Kachel 6,5 rem hoch, Knöpfe «Bilder ansehen und herunterladen» und im Bild mit Text mindestens 3 rem, Videokarte als ganze Fläche; Abstand der Kacheln mindestens 0,75 rem.
- [ ] **76.8** Fremde Ziele (Logo, Videokarte, Bilderpaket) tragen für Screenreader «(externe Seite)»; das sichtbare Zeichen «fremde Seite» entfällt bei Logo und Videokarte, weil die Fläche ein Bild ist, und die Videokarte nennt das Ziel als Text («Video auf video.example.org»). Es gibt keine eingebettete Wiedergabe, kein automatisches Abspielen und keinen Dienst von Dritten.
- [ ] **76.9** Layout: Der Platz jedes Bildes steht vor dem Laden fest (Breite und Höhe der Datei, Seitenverhältnis oder feste Höhe), also kein Layoutsprung. Reflow bei 320 px und 200 % Zoom: Raster und Streifen brechen auf eine bis zwei Spalten, lange Unterschriften und Titel brechen um (`overflow-wrap`), nichts weitet die Seite waagrecht.
- [ ] **76.10** Farben nur aus den Tokens der Website, Tag und Nacht; ausgenommen sind Weiss und Schwarz auf Bildern. Logos stehen auf einer hellen Kachel, auch in der Nacht (Logos sind für hellen Grund gezeichnet). Die Seite braucht keine Skripte oder Bilder von Dritten, die Meta-CSP bleibt unverändert.
- [ ] **76.11** Fotos von Kindern: Das Bilderpaket verknüpft nur; ob und wer die Dateien im SharePoint öffnen darf, stellt die Abteilung dort ein (Handbuch 7.3). Das Vorschaubild folgt der Freigabe des Mediums (öffentlich nur mit Einwilligung).

**Verwaltung**

- [ ] **76.12** Jedes Feld hat ein sichtbares Label und, wo nötig, einen Hilfetext; Fehler stehen am Feld (`aria-describedby`), die Prüfung vor «Übernehmen» meldet fehlende Bilder, zu wenige Bilder und fehlende Alt-Texte mit dem Pfad des Feldes; die Fehler des Servers (`MEDIUM_*`, `SEITE_UNBEKANNT`) erscheinen im selben Weg.
- [ ] **76.13** Die Bildwahl ist die der übrigen Bausteine (Bibliothek im Fluss, kein Browserdialog); Listen von Bildern haben «Hinzufügen», «Entfernen» und die Reihenfolge per Griff, Tastatur und Knöpfen (2.5.7).

### Stand der Prüfung (#742)

Im Browser (Chromium, headless, Playwright, Kopie der Demo-Datenbank mit ihren Bildern, eine Testseite mit allen neuen Bausteinen veröffentlicht und die erzeugte Datei geprüft) bei 1280, 1920 und 390 px, Hell und Dunkel gesehen: 76.3, 76.5 (Tastatur, Maus, Namen und Wert), 76.7, 76.9 und 76.10; Grossansicht aus Raster, Streifen und breitem Bild mit Folge, Esc und Fokus zurück; geschützte Bausteine nach der Anmeldung nachgeladen (Gruppe mit Namen, Schieber, Grossansicht); kein Seitenscroll, keine Fehler in der Konsole ausser dem erwarteten 401 ohne Sitzung, keine Verstösse gegen die CSP; Felder im Editor für alle Bausteine geöffnet. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), echtes Touch-Gerät (Wischen am Schieber und im Streifen), Safari und Firefox, Kontrastwerte mit einem Messwerkzeug (die Werte in 76.3 sind gerechnet), 200 % Zoom am Gerät, erzwungene Farben am Gerät.

## 77. Website und Verwaltung: Bausteine «Text und Gestaltung» (#741)

Gilt für die Bausteine `hinweisbox`, `zitat`, `fragen`, `spalten`, `bildneben`, `tabelle`, `schritte` und `checkliste` auf der Website (`src/website/bausteine-text-rendern.ts`, Abschnitt «Text und Gestaltung» in `public/website/website.css`) und für ihre Felder im Seiten-Editor (`public/admin/website-felder-text.js`). Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4 und 9 gelten sinngemäss. Kein Skript: Die Aufklappliste ist das Element `details`.

### Prüfpunkte

- [ ] **77.1** Hinweisbox: Das Wort der Art («Info», «Tipp», «Wichtig», «Achtung») steht immer im Kasten; das Zeichen ist `aria-hidden`, die Farbe nur Zugabe (WCAG 1.4.1). Text auf Grund mindestens 4.5:1 in Tag und Nacht (gemessen, niedrigster Wert 5.41:1); «Achtung» ist ein Dreieck, die anderen sind rund. Bei hohem Kontrast des Systems behält das Dreieck seine Farbe.
- [ ] **77.2** Zitat: `figure` mit `blockquote` und `figcaption`; Anführungszeichen «…» im Text. Das runde Foto hat einen leeren Alt-Text, wenn dieser nur den Namen daneben wiederholt; sonst steht der des Mediums. Im Editor weist ein Hinweis darauf hin, dass Namen von Kindern nur mit Einwilligung der Eltern stehen.
- [ ] **77.3** Fragen und Antworten: `details` und `summary`, mit Enter und Leertaste zu öffnen und zu schliessen, der Fokusring (3 px) ist sichtbar, die Zeile ist mindestens 56 px hoch. Nichts ist von Anfang an offen. Der Pfeil dreht nur bei erlaubter Bewegung; bei «Bewegung reduzieren» wechselt er ohne Übergang. Jede Frage hat einen Anker in der Adresse; er führt zur Frage (öffnet sie nicht).
- [ ] **77.4** Zwei Spalten und Bild neben Text: Die Reihenfolge im Markup ist die Lesereihenfolge (Bild zuerst, linke Spalte vor der rechten); «rechts» ändert nur die Anordnung ab 48 em. Am Handy stehen die Teile untereinander (Reflow ab 320 px). Der Alt-Text liegt am Medium; fehlt das Bild, steht der Text allein. Titel liegen eine Ebene unter der letzten Überschrift, höchstens Ebene 3.
- [ ] **77.5** Tabelle: `caption` mit der Beschriftung, `th scope="col"` für die Kopfzeile und `th scope="row"` für den Zeilenkopf, nie Zellen als Überschriften. Die scrollbare Fläche ist `role="region"` mit Namen (Beschriftung oder «Tabelle») und `tabindex="0"`; der Fokusring ist sichtbar (WCAG 2.1.1, 2.4.7). Bei 390 px scrollt die Tabelle in ihrer Fläche, die Seite nicht (WCAG 1.4.10, Tabellen sind ausgenommen). Zahlenspalten stehen rechtsbündig, Ziffern gleich breit.
- [ ] **77.6** Schritte: geordnete Liste (`ol`, `role="list"`, weil Safari sonst die Liste nicht nennt); die Zahl im Kreis kommt aus einem Zähler mit leerer Alternative, der Screenreader liest sie nicht doppelt. Ein Link im Schritt ist ein Verweis mit mindestens 44 px Höhe und Pfeil.
- [ ] **77.7** Checkliste: Liste mit `role="list"`; die Zeichen (Haken, leeres Kästchen) sind `aria-hidden`, der Punkt steht als Text. Haken und Kästchen unterscheiden sich in der Form, nicht nur in der Farbe. Gedruckt behalten die Zeichen ihre Form.
- [ ] **77.8** Nacht und Kontrast: Alle Paare aus Tokens, in Tag und Nacht mindestens 4.5:1 für Text und 3:1 für Zeichen und Kanten; Fokusringe wie überall (3 px, `--focus`).
- [ ] **77.9** Editor: Jedes Feld hat eine sichtbare Beschriftung; Fehler stehen am Feld und in der Zusammenfassung oben mit Sprungmarken (WCAG 3.3.1, 3.3.3). Die Art der Hinweisbox, die Seite des Bildes und die Zeichen der Checkliste sind Segmente (Radiogruppe mit Pfeiltasten). Zellen einer Tabelle heissen wie ihre Spalte (die Beschriftung folgt dem Kopf), nach «Spalte hinzufügen» steht der Fokus im neuen Feld. Kein Browserdialog, kein `innerHTML`.
- [ ] **77.10** Geschützte Bausteine: Nach der Anmeldung laden dieselben Elemente und Attribute (`knoten.js`); Tabelle, Aufklappliste und Zitat bleiben bedienbar.

### Stand der Prüfung (#741)

Im Browser (Chromium, headless, Kopie der Demo-Datenbank, erfundene Texte, Bilder aus der Demo-Medienbibliothek) bei 1280, 1920 und 390 px, hell und dunkel: Eine Seite mit allen acht Bausteinen (in jeder Art der Hinweisbox, beide Darstellungen der Checkliste, Bild links und rechts, Tabelle mit Zeilenkopf und Zahlenspalten) wurde im Editor Baustein für Baustein angelegt, gespeichert und veröffentlicht; die erzeugte Seite wurde angesehen. Tastatur: Enter und Leertaste öffnen und schliessen die Fragen, der Fokusring der Fragen und der Tabellenfläche ist sichtbar (3 px), die Tabellenfläche ist nach vier Tabs erreichbar. Überschriftenfolge: H1, H2, H3 ohne Sprung. Kein seitliches Scrollen der Seite bei 390 px. Der Server lehnte einen Link auf eine Seite ab, die es nicht gibt (Meldung am Baustein). Per Test: Schema mit allen Grenzen und Ablehnungen, Verweise, Maskierung (kein Markup aus Daten), kein Skript und kein `style`, jedes Element und Attribut der Renderer passiert `knoten.js`. **Nicht geprüft:** Screenreader (VoiceOver, TalkBack, NVDA), 200 % und 400 % Zoom, echtes Touch-Gerät, Firefox und Safari (das Verhalten von `details` bei einem Anker in der Adresse ist dort unbestätigt), hoher Kontrast des Systems (nur die Regel ist gesetzt).

## 80. Verwaltung: Person direkt wählen im Seiten-Editor (#755)

Gilt für die Auswahl «Person» in den Bausteinen «Personen», «Kontaktperson» und «Kontaktkarte» (`personWahl` in `website-felder.js`). Massstab WCAG 2.2 AA.

- [ ] **80.1** (abgelöst durch 82.1) Die Auswahl ist ein beschriftetes Feld «Person» (sichtbares Label über dem Feld, `select` mit der Auswahlliste der Verwaltung); sie hat keinen Gruppenschritt mehr. Jeder Eintrag nennt Cevi-Name, Funktion und Gruppe («Sancho (Stufenleitung, Imperius)»), damit zwei gleiche Namen unterscheidbar sind; die Gruppe steht im Text, weil die Auswahlliste keine Gruppenköpfe kennt.
- [ ] **80.2** Der Hilfetext («Nur Leitende erscheinen auf der Website. Kinder und andere Personen stehen hier nicht zur Auswahl.») hängt per `aria-describedby` am Feld.
- [ ] **80.3** Zustände: «Personen werden geladen …» (`role="status"`), Fehler mit `role="alert"` und Knopf «Erneut laden», leere Liste («Niemand zur Auswahl»). Eine Person, die nicht mehr zur Auswahl steht, bleibt als «Bisherige Person (nicht mehr wählbar)» gewählt und trägt einen Hinweis in Worten (`role="status"`, nicht nur Farbe).
- [ ] **80.4** Tastatur: Tab erreicht das Feld, Enter öffnet die Liste, Pfeiltasten und Enter wählen, Escape schliesst. Nach «Person hinzufügen» liegt der Fokus auf der Auswahl der neuen Person (die Liste ist dann schon geladen).
- [ ] **80.5** Ein Fehler des Servers (`PERSON_NICHT_AUF_WEBSITE`, `PERSON_UNBEKANNT`) steht in Worten am Baustein, mit Sprungmarke zum Feld.
- [ ] **80.6** 390 px: kein seitliches Scrollen. Bekannte Schwäche: In den Karten der Listen im Blatt (Person 1, Person 2 …) ist die Auswahl schmal (rund 100 px), der gewählte Name wird im Feld gekürzt; die geöffnete Liste umbricht ganze Einträge. Gilt für alle Listenformulare, nicht nur hier. (Seit #760 behoben, siehe 82.10.)

### Stand der Prüfung (#755)

Im Browser (Chromium, headless, Kopie der Vorschau-Datenbank, Konto der Abteilungsleitung mit zweitem Faktor) bei 1280 und 390 px: Baustein «Personen» angelegt, Person per Tastatur gewählt, gespeichert; Eltern ohne Rolle erscheinen nicht in der Liste; nach Entzug der Rolle zeigt das Blatt den Hinweis und der Server lehnt das Speichern am Baustein ab. **Nicht geprüft:** Screenreader, Dunkel und hoher Kontrast, 200 % und 400 % Zoom, Touch, Firefox und Safari, Veröffentlichen mit einer entzogenen Rolle (nur Speichern geprüft; dieselbe Verweisprüfung).

## 81. Verwaltung: keine leeren Flächen, Höhe aus dem verfügbaren Platz (#756)

Gilt für jede Ansicht der Verwaltung unter `public/admin`, besonders für Bereiche mit eigenen Scrollspalten (Editor einer Seite, `formularraster--scroll`, Lager-Navigation, Tagesliste der Termine). Das Dokument ist nie höher als sein Inhalt: Scrollen und Bild-ab landen nicht in leerer Fläche, und Bildschirmleser und Tastatur finden keinen Bereich, der nichts enthält (WCAG 2.4.3, 1.4.10).

### Prüfpunkte

- [ ] **81.1** Das Dokument ragt nie über `main.inhalt` hinaus: Absolut gesetzte, unsichtbare Knoten (`.nur-leser`, Live-Regionen) haben einen Versatz (`top: 0; left: 0`) oder einen Bezugsrahmen (`position: relative`) und verlängern die Seite nicht (Messung: `scrollHeight` des Dokuments minus Unterkante von `main.inhalt` ist 0).
- [ ] **81.2** Höhen kommen aus dem verfügbaren Platz: Ein Scrollbereich nutzt `var(--scroll-hoehe)` (Fenster minus haftende Leiste minus Abstand) oder rechnet `var(--leiste-hoehe)` ein. Nie `vh` minus eine geschätzte Kopfhöhe (wie `8.25rem`) und nie `min-height` in Fensterhöhe. Der Test `admin-keine-leere-flaeche.test.ts` lässt `vh`/`dvh` im CSS nur mit Token oder auf der Liste mit Grund zu.
- [ ] **81.3** Am Seitenende füllt jede Scrollspalte das Fenster unter der Leiste, ohne dass die Oberkante unter der haftenden Leiste verschwindet; ein haftender Bereich (`position: sticky`) setzt `top` auf `calc(var(--leiste-hoehe) + 1rem)`.
- [ ] **81.4** Innen bleibt Platz für den Fokusring (`padding: 4px` im Scrollbereich), die erste und letzte Zeile sind mit der Tastatur erreichbar, `scrollbar-gutter: stable` hält die Breite; nichts springt beim Wechsel der Ansicht.
- [ ] **81.5** Unter 1100 px bleibt die Ansicht einspaltig und scrollt als eine Seite.

### Stand der Prüfung (#756)

Im Browser (Chromium, headless, Playwright, Kopie der Demo-Datenbank, Entwickler-Konto, eigener Dev-Server) bei 1280 x 720, 390 x 844, 2560 x 1440, 3774 x 2020 (Zoom 100 % und 150 %), dunkel; Editor der Seite «Datenschutz» (66 Bausteine) und Lager zusätzlich hell: 81.1 bis 81.3 gemessen, 81.5 gesehen.

**Nicht geprüft:** Screenreader (VoiceOver, TalkBack, NVDA), Safari und Firefox, Zoom 200 % und 400 % von Hand.

## 82. Verwaltung: Personenwahl mit Foto und Leitungsteam im Seiten-Editor (#760)

Gilt für die Auswahl «Person» in den Bausteinen «Personen», «Kontaktperson» und «Kontaktkarte» und für die Anzeige unter der Gruppenwahl des Bausteins «Leitungsteam» (`public/admin/website-personenwahl.js`, Stil `website.css`, Klassen `pw-`). Ersetzt die Auswahl aus 80.1. Massstab WCAG 2.2 AA.

- [ ] **82.1** Die Auswahl ist ein Kombinationsfeld nach WAI-ARIA (APG «Combobox with listbox popup»): ein beschriftetes `input` («Person», sichtbares Label) mit `role="combobox"`, `aria-expanded`, `aria-controls` und `aria-activedescendant`; die Liste hat `role="listbox"`, jede Zeile `role="option"` mit `aria-selected`. Der Fokus bleibt im Feld. Der Hilfetext hängt per `aria-describedby` am Feld.
- [ ] **82.2** Jede Zeile zeigt Foto (40 px, rund), Cevi-Name und «Funktion, Gruppe». Das Foto ist dekorativ (`alt=""`, Kreis `aria-hidden`); der Name steht als Text daneben und ist die Beschriftung der Zeile. Ohne Foto steht ein Kreis mit Initialen (wie auf der Website); lädt das Bild nicht, bleiben die Initialen, ohne kaputten Rahmen. Der Haken zeigt die gewählte Zeile (nicht nur die Farbe).
- [ ] **82.3** Die Bilder laden einzeln und erst, wenn die Zeile sichtbar wird (`loading="lazy"`), über `GET /api/v1/redaktion/personen/:id/bild`, nur für Personen, die auf der Website erscheinen dürfen. Die Liste der Personen enthält nur den Pfad (`bildUrl`), keine weiteren Personendaten. Das gewählte Feld zeigt das Foto der gewählten Person.
- [ ] **82.4** Tastatur: Pfeile öffnen und bewegen (Pos1 und Ende im schreibgeschützten Feld), Enter oder Leertaste wählen, Escape schliesst nur die Liste (nicht das Blatt dahinter) und stellt die bisherige Person wieder ein, Tab schliesst. Enter schickt nie ein Formular ab.
- [ ] **82.5** Bis 8 Personen ist das Feld schreibgeschützt: Tippen springt zum nächsten Namen mit diesem Anfang. Ab 9 Personen ist es ein Suchfeld («Name suchen»): Tippen filtert nach Name, Funktion und Gruppe, ohne Akzente (zoe findet Zoë). Keine Treffer: «Keine Person gefunden.» in der Liste. Eine Statusregion (`role="status"`) sagt die Zahl der Personen und die Wahl an.
- [ ] **82.6** Die Liste klappt nach oben, wenn unten der Platz fehlt, und schiebt sich in schmalen Feldern ins Fenster (nie über den Rand hinaus). Keine Höhe in Fensterhöhe (`vh`); die Liste scrollt selbst, nicht die Hülle.
- [ ] **82.7** Eine Person, die nicht mehr zur Auswahl steht, bleibt als «Bisherige Person (nicht mehr wählbar)» gewählt und trägt den Hinweis in Worten (siehe 80.3). «Kontaktkarte» bietet «Keine Person» als erste Zeile.
- [ ] **82.8** Leitungsteam: Unter der Gruppenwahl steht in einer Statusregion (`role="status"`, `aria-live="polite"`), wer erscheint, in der Reihenfolge der Website: «Zeigt 4 Personen der Gruppe Pilami: Stufenleitung: Anna, Ben; Leitung: Clara, Dani.» Dazu eine kleine Reihe von Fotos oder Initialen (`aria-hidden`; die Namen stehen im Satz). Eine Gruppe ohne Leitende sagt: «In dieser Gruppe gibt es keine Leitenden, der Baustein bleibt leer.» Beim Wechsel der Gruppe bleibt der alte Inhalt stehen, bis der neue da ist; ein Fehler steht in Worten mit Knopf «Erneut laden». Server und Website nehmen dieselbe Abfrage (`stufenteamZeilen`).
- [ ] **82.9** Die Zeile in der Bausteinliste sagt, was erscheint: «Gruppe Pilami · 4 Personen» (die Zahl, sobald der Stand geladen ist), «3 Personen · Anna, Ben, Clara», der Name bei «Kontaktperson» und «Kontaktkarte».
- [ ] **82.10** 390 px: Die Pfeile der Listenkarten im Blatt stehen unter dem Eintrag, damit das Feld die Breite bekommt (löst 80.6); in einem schmalen Feld ist das Foto 32 px. Kein seitliches Scrollen. Fokusring 3 px, erzwungene Farben (`forced-colors`): aktive Zeile mit `Highlight`-Rand.

### Stand der Prüfung (#760)

Im Browser (Chromium, headless, Playwright, Kopie der Demo-Datenbank, Konto des Entwicklers mit zweitem Faktor, eigener Dev-Server) bei 1280 und 390 px, hell und dunkel: Baustein «Personen» (11 Leitende, Suchfeld): Öffnen per Klick und Pfeiltaste, Filtern («li» ergibt drei Personen), Wählen per Enter, Escape, Foto und Initialen in Liste und Feld, Liste ohne Treffer. Mit auf fünf Personen gekürzter Antwort (Abfangen im Browser): schreibgeschütztes Feld, Tippen springt, Pos1 und Ende, «Keine Person» in der Kontaktkarte. Baustein «Leitungsteam»: Gruppenwechsel, Satz und Fotoreihe, Zeile in der Bausteinliste nach «Übernehmen». Messung der Anfragen: Beim Laden der Seite und bei geschlossener Liste keine Bildanfrage, bei offener Liste eine je Person mit Bild. axe-core (WCAG 2.2 AA und Best Practice) bei geöffneter Liste und beim Leitungsteam in den vier Fällen: keine Verstösse gegen Kontrast, Rollen und Namen; offen bleibt «heading-order» der bestehenden Überschrift «Person 1» in der Listenkarte (nicht aus #760). Per Test: Pfade der Bilder, 404 für Kinder, Eltern, fremde Abteilungen und Konten ohne Rolle, Reihenfolge und Auswahl des Leitungsteams wie auf der Website.

**Nicht geprüft:** Screenreader (VoiceOver, TalkBack, NVDA), Zoom 200 % und 400 % von Hand, hoher Kontrast und `forced-colors` im Browser, Touch, Firefox und Safari, Teams mit mehr als 12 Personen in der Fotoreihe.

## 83. Website: Rückmeldungen als Toast (#762)

Gilt für jede Aktion auf der öffentlichen Website: Anmelden, Abmelden, Mein Konto (Passwort, Telefon, Mitteilungen, Datenschutz), Anlass-Anmeldung, Antwort auf einen Termin, Kalender-Link, Terminvorschlag und Lädeli. Das Ergebnis erscheint als Toast an einer festen Stelle (`website/toast.js`, Stil `website.css`, Regel in `docs/website-design.md`, «Rückmeldungen»). Massstab WCAG 2.2.1 (Zeitbegrenzung), 4.1.3 (Statusmeldungen), 2.1.1, 2.4.3, 1.4.3, 1.4.10, 2.5.8.

### Prüfpunkte

- [ ] **83.1** Erfolg, ein nicht blockierender Fehler und eine Info erscheinen als Toast, nie als Kasten oder Absatz im Inhalt, der stehen bleibt. Der Toast steht überall an derselben Stelle (unten in der Mitte, am Handy über die Breite) und sieht überall gleich aus. Der Test `website-toasts.test.ts` hält neue Kästen draussen.
- [ ] **83.2** Inline bleiben: Feldfehler am Feld (`aria-describedby`, `aria-invalid`), die Fehlerzusammenfassung beim Absenden, Lade- und Leerzustände, dauerhafte Seitenzustände («Du bist angemeldet.», Pflicht-Passwortwechsel, Anmeldeschluss), Meldungen, die der Warenkorb selbst auslöst, und Fehler mit eigener Aktion («Nochmals versuchen»).
- [ ] **83.3** Erfolg und Info gehen nach 4 Sekunden, ein Fehler nach 8 Sekunden von selbst. Solange der Zeiger auf dem Toast steht oder der Fokus darin liegt, läuft die Zeit nicht (WCAG 2.2.1); danach läuft der Rest. «Schliessen» (mindestens 44 × 44 px, Name «Schliessen») und Esc schliessen jederzeit.
- [ ] **83.4** Ansage (WCAG 4.1.3): Erfolg und Info in einer Region mit `aria-live="polite"`, Fehler in einer mit `aria-live="assertive"`, beide stehen schon im Dokument, bevor ein Toast dazukommt. Der Toast nimmt dem Fokus nichts weg; die Region steht im Seitenaufbau gleich vor dem Inhalt, Tab erreicht den Knopf «Schliessen» nach dem Kopf. Nach dem Schliessen kehrt der Fokus dorthin zurück, wo die Person herkam.
- [ ] **83.5** Höchstens 3 Toasts stehen zugleich (der älteste weicht), derselbe Text wird nicht verdoppelt. Am Handy (390 px) verdeckt der Toast keinen Knopf, den die Person gerade bedient (Lädeli-Knopf unten rechts: der Toast steht darüber); in einem geöffneten Dialog (Warenkorb, Artikel, Bestellübersicht) steht er oben im Dialog und bleibt bedienbar, auch wenn der Dialog sich neu zeichnet; er deckt dort kurz den Kopf des Dialogs ab (bekannte Einschränkung, «Schliessen» und Esc genügen).
- [ ] **83.6** Nach «Anmelden» und «Abmelden», die die Seite wechseln, erscheint «Angemeldet.» oder «Abgemeldet.» auf der neuen Seite. Seiten ohne Aktion laden `toast.js` nicht.
- [ ] **83.7** Kontrast Tag und Nacht (Tokens): Erfolg und Info 10.4:1 und 16.6:1, Fehler 6.8:1 und 7.5:1; Art nie nur über die Farbe (Haken, Kreis, Dreieck mit Text); bei erzwungenen Farben hat der Toast einen Rand. Mit «Bewegung reduzieren» keine Einblendung, die Zeiten gelten gleich.
- [ ] **83.8** Texte: kurze Sätze mit Zustand oder Verb («Angemeldet.», «Passwort geändert.», «Bestellung gesendet.»), ein Fehler sagt, was zu tun ist; keine Emojis, Schweizer Schreibweise.

### Stand der Prüfung (#762)

Im Browser (Chromium headless, Playwright, Kopie der Demo-Datenbank, eigener Dev-Server mit Proxy für die erzeugten Seiten, Konto ohne Rolle) bei 390 x 844 und 1280 x 900, hell und dunkel, je ein voller Lauf: Anmelden falsch (inline, kein Toast), ohne Netz (Fehler-Toast), erfolgreich («Angemeldet.» auf der nächsten Seite, 83.6), Abmelden im Kopf («Abgemeldet.» nach dem Neuladen), Passwort ändern (Toast; Feldfehler inline), Anlass-Anmeldung und Abmeldung, Kalender-Link erzeugen und kopieren, Lädeli (Bestellung gesendet und storniert, im Dialog; Abmelden ohne Netz; Bestellen ohne Netz im Dialog, auch nach dem Neuzeichnen). Tastatur und Zeiger: Fokus auf «Schliessen» hält den Fehler-Toast länger als 8 s, Esc schliesst, der Zeiger hält die Zeit an, der Erfolg geht nach 4 s. Kontraste gerechnet (83.7). Screenshots nur im Scratchpad.

**Nicht geprüft:** Bildschirmleser (VoiceOver, TalkBack, NVDA: die Ansage ist über `aria-live` gebaut, nicht gehört), Safari und Firefox, Zoom 200 % und 400 %, «Bewegung reduzieren» von Hand (der Stil ist im Test geprüft), erzwungene Farben, Telefon-Karte und Mitteilungen in «Mein Konto» (keine Stufenleitung und keine App-Schalter im Testkonto), Antwort auf einen Termin und Terminvorschlag (Stil und Texte im Test, nicht im Browser).

## 84. Verwaltung: Rückmeldungen nach Aktionen als Toast (#761)

Gilt für jede Ansicht unter `public/admin`: Das Ergebnis einer Aktion (Erfolg, nicht blockierender Fehler, Info wie «Link kopiert.») ist ein Toast an einer festen Stelle (unten links, am Handy über die ganze Breite), nie ein Kasten im Inhalt. Regel, Bauteil und Liste der Ausnahmen: [verwaltung-geruest.md](verwaltung-geruest.md), «Rückmeldungen: Toast oder inline»; die Leitplanke ist `test/admin-toasts.test.ts`.

### Prüfpunkte

- [ ] **84.1** Jede Aktion, die etwas speichert, löscht, kopiert, hochlädt oder sendet, meldet ihr Ergebnis als Toast in derselben Region; es gibt keinen Absatz, Kasten oder Banner im Inhalt, der das Ergebnis zeigt und stehen bleibt. Die Texte sind kurz, im Perfekt oder Zustand («Gespeichert.», «Link kopiert.»), ohne Emoji.
- [ ] **84.2** Erfolg und Info verschwinden nach 4 Sekunden, Warnung und Fehler nach 8 Sekunden; ein Toast mit Aktion («Nochmals versuchen») bleibt bis zum Schliessen. Zeiger auf dem Toast und Tastaturfokus darin halten die Zeit an, nach dem Verlassen läuft sie neu (WCAG 2.2.1).
- [ ] **84.3** Jeder Toast hat einen Schliessen-Knopf («Hinweis schliessen», mindestens 44 Pixel, sichtbarer Fokusring); Esc schliesst den Toast mit Fokus oder unter dem Zeiger; F6 setzt den Fokus auf den ersten Knopf der Region, Tab erreicht sie vor dem Inhalt.
- [ ] **84.4** Ein Screenreader hört Erfolg, Info und Warnung höflich (`aria-live="polite"`) und nur einen Fehler sofort (`role="alert"`), genau einmal (WCAG 4.1.3). Der Toast stiehlt den Fokus nie.
- [ ] **84.5** Höchstens drei Rückmeldungen sind zugleich sichtbar; dieselbe Meldung ersetzt sich, statt sich zu stapeln. Eine Meldung überlebt den Wechsel der Ansicht (Speichern, dann Weiterleitung).
- [ ] **84.6** Mit «Bewegung reduzieren» gibt es kein Einblenden und kein Ausblenden. Am Handy (390 Pixel) steht der Toast über die ganze Breite im Fenster, ohne waagrechtes Scrollen und ohne den bedienten Inhalt dauerhaft zu verdecken (er geht von selbst oder per Esc). Tag und Nacht aus den Tokens; die Art zeigt ein Symbol (Haken, Info, Warndreieck), nie nur Farbe.
- [ ] **84.7** Inline bleiben nur: Feldfehler am Feld (`aria-describedby`), Fehlerzusammenfassung eines offenen Formulars, Lade-, Leer- und Fehlerzustände der Ansicht, dauerhafte Zustände der Seite (Marke «Nicht gespeichert», Banner, Berechtigungshinweise, Verbindungsstatus, Fortschritt) und Meldungen, die eine Entscheidung verlangen (Konflikt, Rückfrage). Ein Fehler, der nach 8 Sekunden weg ist, hat eine dauerhafte Marke daneben, wenn Eingaben nicht gespeichert sind.

### Stand der Prüfung (#761)

**STAND**

## 85. Verwaltung: Konto einer Person endgültig löschen (#769)

Im Blatt einer Person (Bereich Personen, Abschnitt «Konto») löscht «Konto löschen» das Konto samt Anmeldung, Chats und Verknüpfungen zu Gruppen und Rollen (`DELETE /api/v1/admin/personen/{id}`, Recht `konto.loeschen`: Abteilungsleitung und Entwickler, zweiter Faktor). Die Sicherheitsabfrage ist die Karte am Ort (`bestaetigungAmOrt` in `aktionen.js`), kein Browserdialog und kein Toast mit «Rückgängig»; die Leitplanke ist `test/admin-personen-konto-loeschen.test.ts`.

### Prüfpunkte

- [ ] **85.1** Der Knopf steht im Abschnitt «Konto» nach «Deaktivieren», als gefährlich gezeichnet (Rot, Papierkorb-Symbol, Text «Konto löschen»). Er fehlt beim eigenen Konto (dort steht «Für das eigene Konto gibt es diese Aktionen nicht.») und für alle ohne das Recht `konto.loeschen` (seit #771, siehe 86).
- [ ] **85.2** Der Knopf öffnet die Karte unter sich (`aria-expanded`, `aria-controls`); sie trägt die Frage «Konto von <Name> endgültig löschen?» als Namen (`aria-labelledby`) und den Text, was verloren geht, als Beschreibung (`aria-describedby`). Der Text nennt Konto, Anmeldung, Chats und Verknüpfungen zu Gruppen und Rollen, dass Einträge im Änderungsprotokoll bleiben, und dass man stattdessen deaktivieren kann.
- [ ] **85.3** Der Fokus liegt auf dem Feld «Tippe «<Name>» zur Bestätigung». «Endgültig löschen» bleibt ausgeschaltet, bis der Name stimmt (Leerzeichen am Rand zählen nicht). Enter im Feld schickt das Formular der Person nie ab; es bestätigt nur bei richtigem Namen.
- [ ] **85.4** Esc und «Abbrechen» schliessen die Karte, leeren das Feld und bringen den Fokus zum Knopf «Konto löschen». Tab erreicht Feld, «Abbrechen» und «Endgültig löschen» in dieser Reihenfolge.
- [ ] **85.5** Ein Fehler (409 `LETZTE_ABTEILUNGSLEITUNG`, 403, 404, kein Netz) steht in der Karte (`role="alert"`), beginnt mit «Nicht gelöscht.», sagt, was zu tun ist, und lässt die Karte offen; der Name bleibt im Feld, «Endgültig löschen» ist wieder bedienbar. Kein Toast.
- [ ] **85.6** Nach Erfolg schliesst das Blatt, die Liste lädt neu, der Fokus liegt auf der Überschrift, und der Toast «Konto von <Name> gelöscht.» steht 4 Sekunden (`aria-live="polite"`). Es gibt kein «Rückgängig».
- [ ] **85.7** Bei 390 und 1280 Pixel, hell und dunkel: Die Karte läuft nicht über, kein waagrechtes Scrollen, Text und Feld lesbar; der Fokusring des Felds ist sichtbar.

### Stand der Prüfung (#769)

Im Browser (Chromium headless, Playwright, Kopie der Demo-Datenbank, eigener Dev-Server, Sitzung des Test-Entwicklers) bei 390 x 844 (hell, dunkel) und 1280 x 900 (hell, dunkel):

- **85.1:** Knopf mit Symbol neben «Deaktivieren»; beim eigenen Konto kein Knopf (geprüft).
- **85.2, 85.3:** Fokus im Feld; leer und bei «Spidy» bleibt «Endgültig löschen» aus, Enter bei falschem Namen tut nichts (das Blatt bleibt offen, nichts gespeichert); bei «Spidy Demo» frei.
- **85.4:** Esc schliesst, Fokus auf dem Knopf; Enter auf dem Knopf öffnet mit leerem Feld; Tab: Feld, «Abbrechen».
- **85.5:** Antworten von Hand ersetzt (409 `LETZTE_ABTEILUNGSLEITUNG`, 409 `EIGENES_KONTO`, 403, 404, Verbindungsabbruch): je ein Text in der Karte, kein Toast, Karte offen, Knopf wieder frei. Den echten 409 gibt es für Verwalter nicht auszulösen, weil sie selbst aktiv bleiben.
- **85.6:** Löschen mit Enter bei richtigem Namen: 204, Blatt zu, Liste neu, Fokus auf der Überschrift, Toast «Konto von Sancho Demo gelöscht.».
- **85.7:** Bei 390 Pixel steht die Karte in der Spalte (41 bis 335 Pixel), kein waagrechtes Scrollen; dunkel wie hell lesbar.
- Server (Kopie der Daten): Löschen zweier Abteilungsleitungen (eine mit zweitem Faktor), eines Elternteils, einer Person mit Webmaster-Rolle und einer Stufenleitung: je 204, kein 500, keine Zeile mit der ID ausser im Audit-Log.

**Nicht geprüft:** Bildschirmleser (VoiceOver, TalkBack, NVDA: Namen und Beschreibung sind über `aria-labelledby` und `aria-describedby` gebaut, nicht gehört), Safari und Firefox, Zoom 200 % und 400 %, erzwungene Farben, Touch am echten Gerät.

## 86. Verwaltung: «Konto löschen» als verteilbares Recht (#771)

«Konto löschen» hängt nicht mehr an der Abteilungsleitung, sondern am Recht `konto.loeschen` (Bereich «Personen und Gruppen», Klartext «Konten endgültig löschen»). Es lässt sich im Rechte-Editor (Seite «Rollen und Rechte») einer Rolle geben und wieder nehmen; die Erklärung dort trägt die Warnung. Der Knopf im Blatt der Person folgt `ich.rechte` (aus `GET /api/v1/ich`). Ein Konto über der Person ist geschützt: Konten von Entwicklern löscht nur ein Entwickler, Konten der Abteilungsleitung nur Abteilungsleitung oder Entwickler (403 `KONTO_GESCHUETZT`). Dann steht statt des Knopfs ein Satz mit dem Grund. Die Karte mit dem Namen zum Eintippen bleibt wie bei 85.

### Prüfpunkte

- [ ] **86.1** Der Knopf «Konto löschen» erscheint nur, wenn die angemeldete Person das Recht hat; hat die Abteilungsleitung es nicht (der Entwickler hat es ihr genommen), fehlt der ganze Eintrag, ohne leere Zeile. Der Entwickler hat den Knopf immer.
- [ ] **86.2** Bei einem Konto, das die Person nicht löschen darf, steht unter dem Titel «Konto löschen» der Satz «Dieses Konto darf nur ein Entwickler löschen.» oder «Dieses Konto darf nur die Abteilungsleitung oder ein Entwickler löschen.» als normaler Text (kein Tooltip, nicht nur Farbe, kontrastreich wie die anderen Beschreibungen), ohne Knopf und ohne Tab-Stopp.
- [ ] **86.3** Das eigene Konto zeigt weiter nur «Für das eigene Konto gibt es diese Aktionen nicht.».
- [ ] **86.4** Ein 403 `KONTO_GESCHUETZT` (zum Beispiel nach einem Wechsel der Rolle während das Blatt offen ist) steht als Text in der Karte, mit «Nicht gelöscht.» am Anfang; kein Toast.
- [ ] **86.5** Im Rechte-Editor steht das Recht mit Klartext «Konten endgültig löschen» und der Erklärung, die vor den Folgen warnt und die Schutzregeln nennt; der Schalter hat einen Namen und ist mit der Tastatur bedienbar (wie jedes andere Recht).
- [ ] **86.6** Bei 390 und 1280 Pixel, hell und dunkel: Der Grundsatz läuft nicht über, kein waagrechtes Scrollen.

### Stand der Prüfung (#771)

Im Browser (Chromium headless, Playwright, eigener Dev-Server, frisch migrierte Datenbank mit Testpersonen; Sitzungen mit geprüftem zweiten Faktor) bei 390 x 844 und 1280 x 900, hell und dunkel:

- **86.1:** Abteilungsleitung sieht den Knopf bei einer Person ohne Rechte und bei einer anderen Abteilungsleitung. Mit einem Abzug `konto.loeschen` in den Rechten der Abteilungsleitung fehlt der Eintrag ganz; der Entwickler behält den Knopf trotz Abzug.
- **86.2:** Beim Konto eines Entwicklers steht «Dieses Konto darf nur ein Entwickler löschen.», kein Knopf. Der zweite Satz (nur Abteilungsleitung oder Entwickler) lässt sich im Browser nicht auslösen, weil nur Abteilungsleitung und Entwickler die Seite «Personen» öffnen; er ist durch den Quelltext-Test gesichert.
- **86.3, 86.6:** In allen vier Kombinationen kein waagrechtes Scrollen; Text lesbar (Ansichten im Browser angeschaut, kein Messwert).
- Tastatur: Fokus auf den Knopf, Enter öffnet die Karte (Fokus im Feld), Name tippen, Enter löscht: 204, Toast «Konto von … gelöscht.», Fokus auf der Überschrift, Zeile weg.
- Server über HTTP mit einer Rolle «Datenschutz» (nur `konto.loeschen`, zweiter Faktor): Konto ohne Rechte 204; Entwickler 403 `KONTO_GESCHUETZT`; Abteilungsleitung 403 `KONTO_GESCHUETZT`; eigenes Konto 409 `EIGENES_KONTO`; Personenliste 403 (das Recht gibt keine Liste).

**Nicht geprüft:** 86.4 und 86.5 im Browser (86.5: nur die Katalogantwort mit Klartext und Erklärung gelesen, die Seite des Rechte-Editors nicht bedient), Bildschirmleser, Safari und Firefox, Zoom 200 %. Offen: Die Seite «Personen» der Verwaltung öffnet sich nur für Abteilungsleitung und Entwickler (`navigation.js`, Standard `abteilungsleitung`). Eine Rolle mit `konto.loeschen` kann die Route über die API nutzen, bekommt in der Verwaltung aber noch keinen Weg zum Blatt der Person.

## 87. Verwaltung: Fotos, Albumliste für viele Alben (#794)

Die Seite «Website, Fotos» (`public/admin/website-fotos.js`, `website-fotos-alben.js`, `website-fotos-logik.js`, `website-fotos.css`) zeigt die Alben in zwei Bereichen: «Auf der Website» (nur sichtbare, in ihrer Reihenfolge, nur hier lässt sie sich ordnen) und «Weitere Alben bei Flickr» (nach Jahr gruppiert, schrittweise gebaut). Darüber stehen die Verbindung in einer Zeile, das Konto als aufklappbarer Abschnitt und eine Werkzeugleiste mit Suche, Sicht, Jahr und Sortierung. Zeigen und Ausblenden laufen immer über `PUT /api/v1/admin/fotos/alben/sichtbarkeit` (ein Album oder viele, alles oder nichts). Massstab WCAG 2.2 AA; die Abschnitte 66 (Fotos), 14 und 84 (Toasts) und 15 (Auswahlfelder) gelten weiter.

### Prüfpunkte

- [ ] **87.1** Verbindung und «Verbindung testen» stehen in einer Zeile (Band mit Symbol und Wort, nie nur Farbe; `role="status"`, bei Fehlern `role="alert"`). Das Konto ist ein `details` mit Namen «Flickr-Konto» und der Kennung als Text; es ist zu, solange ein Konto gesetzt ist und die Verbindung Alben liefert, sonst offen. Bei fehlendem Konto, fehlender Verbindung oder leerer Albumliste nennt ein Satz die Betreiber-Einstellung `FLICKR_KONTO` (`deploy/.env`).
- [ ] **87.2** Die Werkzeugleiste ist eine Region mit Namen (`role="search"`). Das Suchfeld hat ein Label (nur für Screenreader sichtbar) und den Kurzbefehl `/` (`aria-keyshortcuts`), der nur ausserhalb von Eingaben fokussiert. Die Sicht (Alle, Sichtbar, Nicht sichtbar) ist eine Gruppe mit `aria-pressed` und den Zahlen im Namen; Jahr und Sortierung haben je einen Namen (Label per `aria-labelledby`).
- [ ] **87.3** Die Trefferzahl («23 von 87 Alben», ohne Filter «87 Alben») ist eine Statusregion (höflich) und ändert sich beim Tippen. «Filter zurücksetzen» erscheint nur, wenn etwas gesetzt ist, und setzt Suche, Sicht und Jahr zurück (der Fokus geht ins Suchfeld).
- [ ] **87.4** Ab 48 em haftet die Werkzeugleiste unter der Navigation (`top: var(--leiste-hoehe)`, keine feste Höhe in `vh`); darunter scrollt sie mit (am Handy nähme sie zu viel Platz). Der Fokus bleibt sichtbar und wird weder von der Leiste oben noch von der Auswahlleiste unten verdeckt (`scroll-margin`, WCAG 2.4.11).
- [ ] **87.5** Jede Zeile ist ein Listeneintrag mit Kästchen («Auswählen: <Album>»), Titel (Titel bei Flickr, bei eigenem Titel dazu «Bei Flickr: «…»»), «393 Fotos · Okt. 2026», Schalter (`role="switch"`, `aria-checked`, Name «Auf der Website zeigen: <Album>») und «Mehr» mit «Titel ändern». Zielgrössen mindestens 44 Pixel; der Titel bricht um, nichts läuft über.
- [ ] **87.6** Nach dem Zeigen oder Ausblenden verschwindet die Zeile aus ihrem Bereich. Der Fokus geht auf den Schalter der Nachbarzeile derselben Liste, sonst auf die Überschrift des Bereichs; nichts springt. Der Toast sagt «<Album> ist jetzt auf der Website zu sehen.» und bleibt mit «Rückgängig» bis zum Schliessen.
- [ ] **87.7** Die Reihenfolge lässt sich nur im Bereich «Auf der Website» ändern: Ziehen, Tastatur (Leertaste nimmt auf, Pfeile bewegen, Leertaste legt ab, Esc bricht ab) und die Knöpfe «Nach oben» und «Nach unten» (2.5.7); die neue Stelle wird angesagt, die Änderung lässt sich in der Frist zurücknehmen. Bei Suche oder Jahr steht der Hinweis «Zum Ordnen setze Suche und Jahr zurück.» und die Liste ist ohne Griffe.
- [ ] **87.8** «Weitere Alben» sind nach Jahr gruppiert, wenn nach Datum sortiert wird; jede Gruppe ist eine Überschrift mit Knopf (`aria-expanded`, `aria-controls`), zuerst ist das neueste Jahr offen (bei Suche oder Jahr alle). Bei Titel oder Grösse gibt es eine flache Liste. Höchstens 40 Zeilen werden gebaut; «Weitere 40 anzeigen» setzt den Fokus auf das erste neue Album. Der Fokus bleibt beim Auf- und Zuklappen auf dem Knopf der Gruppe.
- [ ] **87.9** Auswahl: «Alle n auswählen» je Bereich wählt alle gefilterten Alben (auch die nicht gebauten; teilweise gewählt ist `indeterminate`). Die Auswahlleiste (Region «Auswahl», haftet unten) sagt «n ausgewählt» als Statusregion und bietet nur die passenden Aktionen: «Auf der Website zeigen (k)», «Ausblenden (m)», «Auswahl aufheben». Eine Aktion, die nichts ändern würde, fehlt.
- [ ] **87.10** Mehr als 5 Alben auf einmal zu zeigen verlangt eine Bestätigung in der Leiste (kein Browserdialog, kein Fenster): Satz mit Hinweis auf Kinderfotos und Einwilligung, «<n> Alben zeigen» (Fokus darauf) und «Abbrechen». Bis 5 Alben läuft die Aktion sofort mit «Rückgängig».
- [ ] **87.11** Sammelaktionen sind atomar: Bei einem Fehler oder Konflikt (409 `VERSION_KONFLIKT`) steht alles wie vorher, die Auswahl bleibt, und der Toast sagt es («Es wurde nichts geändert.» beziehungsweise «Jemand anders hat das gerade geändert. Die Seite lädt neu.»).
- [ ] **87.12** Zustände: lädt (Skeleton), Fehler mit «Nochmals versuchen», leer («Keine Alben gefunden. Prüfe das Konto und die Verbindung.»), kein Treffer («Kein Album passt zu «…».» mit «Suche zurücksetzen», bei Filtern «Filter zurücksetzen»), leerer Bereich («Noch kein Album auf der Website.», «Alle Alben sind auf der Website.»).
- [ ] **87.13** Hell und Dunkel, 320, 390, 1280 und 2560 Pixel: kein waagrechtes Scrollen, keine leere Fläche unter dem Inhalt. Ab 90 em stehen die beiden Bereiche nebeneinander, darunter untereinander; auf dem Handy bekommt die geordnete Liste ein gemeinsames Raster aus Griff, Kästchen, Titel, Schalter, «Mehr» und Pfeilen.
- [ ] **87.14** Bewegung: Der Pfeil der Jahresgruppen dreht sich nur unter «Bewegung nicht reduzieren»; Zeilen blenden nicht ein.

### Stand der Prüfung (#794)

Im Browser (Chromium headless, Playwright) gegen einen eigenen Dev-Server mit Wegwerf-Kopie der Demo-Datenbank und einer Attrappe von Flickr (erfundene Alben, keine Verbindung zu Flickr), mit 5, 90 und 300 Alben:

- **87.1:** Band, Konto zu mit Kennung und Verbindung; ohne Kennung offen mit dem Satz zu `FLICKR_KONTO`.
- **87.2, 87.3:** `/` fokussiert die Suche; «wald» findet 15 von 90; «zzzzzz» zeigt die Karte «Kein Album passt zu «zzzzzz».» mit «Suche zurücksetzen» (Fokus danach im Suchfeld). Namen und Rollen der Leiste (Region, Suchfeld, Gruppe «Anzeigen», Jahr, Sortierung, Statusregion) aus dem Zugänglichkeitsbaum gelesen.
- **87.4:** Bei 1280 und 2560 Pixel haftet die Leiste unmittelbar unter der Navigation (Abstand 0); Tab durch Leiste und Zeilen: Reihenfolge logisch, überall Fokusring 3 Pixel, nichts von der Leiste verdeckt.
- **87.5 bis 87.7:** Drei Alben auswählen und zeigen (eine Anfrage), einzeln mit Enter schalten (Fokus auf der Nachbarzeile), Reihenfolge per Tastatur (Leertaste, Pfeil, Leertaste: eine Anfrage nach der Frist) und per Maus (Ziehen), «Titel ändern» mit Enter (Fokus danach auf «Mehr»).
- **87.8:** Bei 300 Alben baut die Seite beim Öffnen 34 Zeilen; Jahr öffnen per Enter (Fokus bleibt), Sortierung «Titel A–Z» (40 Zeilen, «Weitere 40 anzeigen», Fokus auf der ersten neuen Zeile), Jahr 2022 (33 von 300).
- **87.9 bis 87.11:** Alle 300 auswählen, Bestätigung, Zeigen: eine Anfrage, 300 Zeilen im Bereich «Auf der Website»; Konflikt (Version in der Datenbank geändert): Toast, Ansicht wie vorher, Seite lädt neu.
- **87.13:** 320, 390, 1280, 2560 Pixel, hell und dunkel angeschaut; Dokumentbreite gleich Fensterbreite (kein waagrechtes Scrollen).

**Nicht geprüft:** Bildschirmleser (VoiceOver, TalkBack, NVDA: Namen und Rollen nur im Zugänglichkeitsbaum gelesen, nicht gehört), Safari und Firefox, Zoom 200 % und 400 % am echten Gerät, erzwungene Farben, Touch am echten Gerät, Kontrastmessung mit Werkzeug (die Farben sind Tokens der Verwaltung), «Bewegung reduzieren» im Browser. Offen: Der Bereich «Auf der Website» baut alle sichtbaren Alben auf einmal (300 sichtbare Alben: rund 17 000 Pixel Seitenhöhe); die Sortierliste hat keine schrittweise Anzeige, weil sie die ganze Reihenfolge hält.

## 88. Website: Fotoalben neu gestaltet (#796)

Gilt für die Seite mit dem Baustein «Fotoalben» (`src/website/fotoalben.ts`, `public/website/fotos.js`, `fotos-logik.js`, `fotos.css`) und die Grossansicht (`lichtkasten.js`). Sie ersetzt die Punkte 66.4, 66.6, 66.9 und 66.10 (Markup und Raster haben sich geändert); die übrigen Punkte von 66 gelten weiter. Massstab WCAG 2.2 AA; die Abschnitte 1 bis 4 und 9 gelten sinngemäss.

**Entscheide.** Die Bilder im Raster sind **dekorativ** (`alt=""`); der Link darum herum trägt den Namen «Foto 3 von 393» (mit dem Titel von Flickr dahinter, ausser er ist ein Dateiname wie «IMG_4021.jpg»). Grund: Ein Alt-Text pro Bild wäre bei 393 Fotos 393 Mal dieselbe Information, und Flickr-Titel sind meist Dateinamen; die Anzahl steht einmal im Kopf («393 Fotos · 4. Oktober 2026»), am Raster («Fotos im Album …») und im Stand («48 von 393 Fotos angezeigt.»). Die Grossansicht übernimmt den Namen des Links als Alt-Text des grossen Bildes. Mehr Bilder kommen **mit einem Knopf** («Weitere 48 Fotos anzeigen»), nicht durch Nachladen beim Scrollen: Die Person bestimmt das Tempo, das Ende der Seite (Fuss, Links) bleibt erreichbar, und die Tastatur kommt nicht in eine Falle.

### Prüfpunkte

- [ ] **88.1** Überschriften: `h1` der Seite, in der Übersicht ab 9 Alben `h2` je Jahr (Knopf darin) und `h3` je Album, darunter `h2` je Album; im Album `h2` mit dem Titel, danach kein weiterer Titel. Keine Ebene wird übersprungen.
- [ ] **88.2** Eine Albumkarte ist ein Link mit sprechendem Namen («Album 2026 - Herbstlager, 393 Fotos, 4. Oktober 2026»); der sichtbare Titel steht im Namen (2.5.3). Das Titelbild ist dekorativ.
- [ ] **88.3** Jahre sind Knöpfe mit `aria-expanded` und `aria-controls`; das Dreieck dreht, der Zustand hängt nicht an der Farbe. Ältere Jahre sind zu, Treffer der Suche klappen auf.
- [ ] **88.4** Die Suche hat ein sichtbares Label («Alben suchen»), die Taste `/` fokussiert sie (`aria-keyshortcuts`), nur wenn die Person nicht schreibt und keine Grossansicht offen ist; Esc leert. Die Anzahl («23 von 87 Alben») steht in einer Statusregion und wechselt erst, wenn die Person kurz nicht mehr tippt. Ohne Treffer steht «Keine Alben für «…».» mit «Suche zurücksetzen».
- [ ] **88.5** Das Raster ist eine Liste mit Namen («Fotos im Album …»); jedes Bild ist ein Link «Foto 3 von 393». Der Platz jeder Kachel steht fest (Seitenverhältnis), nichts springt, wenn Bilder laden.
- [ ] **88.6** «Weitere 48 Fotos anzeigen»: Der Fokus geht auf das erste neue Foto, die Statusregion sagt «96 von 393 Fotos angezeigt.», die Fortschrittsleiste ist für Screenreader verborgen (der Text trägt die Information).
- [ ] **88.7** Grossansicht: Der Dialog heisst «Fotos im Album …: Grossansicht», der Stand «Bild 24 von 393» zählt über das ganze Album (auch über noch nicht gezeigte Bilder), Pfeiltasten, Esc und Wischen wie bisher, Schliessen-Knopf 44 px. Beim Schliessen steht der Fokus auf dem zuletzt gezeigten Bild, auch wenn es erst jetzt eingeblendet wird, und die Seite scrollt dorthin.
- [ ] **88.8** Zielgrössen mindestens 44 px (Karte, Jahr, Suchfeld, «Alle Fotos», «Album auf Flickr öffnen»); Fokusring 3 px in allen Ansichten, auch auf den Fotos (ausserhalb der Kachel).
- [ ] **88.9** Kontrast Hell und Dunkel (Titel, Meta, Anzahl, Jahr, Rand des Suchfelds) mindestens 4,5 : 1, Rand des Suchfelds und Fortschritt mindestens 3 : 1.
- [ ] **88.10** 320 px, Zoom 200 % und 400 % ohne waagrechtes Scrollen; 1, 2, 3 und 4 Spalten bei 40, 62 und 80 em.
- [ ] **88.11** Bewegung: Heranzoomen der Bilder beim Zeigen und Drehen des Dreiecks nur unter «Bewegung nicht reduzieren»; Skelette und Einblenden der Bilder folgen den Regeln der Website. Erzwungene Farben: Karten, Taste und Jahre behalten Rand und Linie.
- [ ] **88.12** Ladezustand (#816): Die Seite «Fotos» ist eine geschützte Hülle. Solange die Sitzung nicht geklärt ist, steht nur ein ruhiges Skelett (`aria-hidden`, erscheint nach 150 ms, `aria-busy` am Behälter, Ansage «Geschützte Inhalte werden geladen.» in der Statusregion) und **nie** «Nur angemeldet sichtbar»; der Hinweis erscheint nur nach der Antwort 401 (`role="status"`-Ansage «Melde dich an, um das zu sehen.»). Eine angemeldete Person sieht Skelett, dann direkt die Fotos: ohne Hinweis, ohne zweiten Ladevorgang und ohne dass der Fuss ins Bild springt (das Skelett reicht über die Höhe des Fensters). Ohne Skript und wenn `geschuetzt.js` nach acht Sekunden nicht läuft, steht der Hinweis mit dem Link zur Anmeldung (Rückfall, `data-skript-spaet`).
- [ ] **88.13** Abstand unten (#816): Unter dem letzten Foto, «Weitere Fotos anzeigen» und dem Ende der Übersicht steht der Abschnittsabstand der Website (`--abstand`: 3 rem bis 5,5 rem, gemessen 48, 59 und 77 px bei 320 bis 390, 768 und 1280 px), gleich in Hell und Dunkel; er gilt für alle Zustände der Hülle (Hinweis, Fehler, Inhalt).

### Stand der Prüfung (#796)

Im Browser (Chromium headless, Playwright) gegen eine Kopie der Vorschau-Datenbank und eine Attrappe von Flickr (erfundene Alben, selbst erzeugte Bilder in verschiedenen Seitenverhältnissen) bei 320, 390, 640 (Zoom 200 %), 1280 und 2560 Pixel, hell und dunkel; Tastatur: `/`, Tab, Enter, Esc, Pfeile, Zurück im Browser; Szenarien mit 90, 12, 1 und 0 Alben und mit 393, 48, 12 und 1 Foto. Gemessen: kein waagrechtes Scrollen, Kontraste und Zielgrössen (88.8 bis 88.10), Anzahl der Bildanfragen (vorher 52 bis 90 beim Öffnen und 393 nach dem Scrollen, nachher höchstens 48). **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), echte Fotos, Zoom 400 % am Gerät, Wischen am Handy, Safari und Firefox, Windows-Hochkontrast am Gerät.

## 89. Verwaltung: Funktionen im Blatt der Person (#801)

Funktionen (globale Rollen wie «Webmaster» oder «Redaktion») vergibt und entzieht man im Blatt der Person (Bereich Personen, Abschnitt «Rechte und Rollen», Block «Funktionen», `funktionenFelder` in `personen-blatt.js`), im Muster der Stufenrollen. Auf der Seite einer globalen Rolle (Rechte, Rollen) steht nur noch die Liste «Personen mit der Rolle …» zum Lesen, mit dem Link «Bearbeiten im Blatt» (`#personen/personen/<id>`) und dem Hinweis «Funktionen vergibst du im Blatt der Person (Personen → Person → Rechte und Rollen).». Gruppenrollen bleiben unverändert. Leitplanke: `test/admin-personen-umbau.test.ts`.

### Prüfpunkte

- [ ] **89.1** Der Block «Funktionen» steht unter «Stufen und Rollen» mit derselben Zwischenüberschrift, Zeilenform und Abständen. Jede Funktion der Person ist eine Zeile: Chip mit Text, «Entfernen». Ohne Funktion steht «Die Person hat keine Funktion.». Wer «Rechte und Rollen vergeben» nicht hat, sieht den Block nicht. Bei «Person erfassen» steht der Hinweis, dass Funktionen erst nach dem Erfassen möglich sind.
- [ ] **89.2** «Entfernen» hat den Namen «Funktion <Funktion> entfernen: <Person>», streicht die Zeile durch und schreibt «wird beim Speichern entfernt» (nie nur Farbe); der Knopf heisst dann «Rückgängig» (Name «Entfernen rückgängig: Funktion <Funktion>, <Person>»). Eine Funktion, die erst neu dazukam, ist mit dem Entfernen weg. Der Fokus bleibt auf dem Knopf der Zeile. Jede Änderung meldet ein Toast (Info, 4 Sekunden); nichts gilt vor «Speichern», das Formular fragt beim Verlassen.
- [ ] **89.3** «Funktion hinzufügen»: Auswahl «Funktion» (eigenes Auswahlfeld, Tastatur) und Knopf. Ohne Wahl steht die Meldung am Feld («Wähle eine Funktion.», `aria-invalid`, Fokus auf dem Feld). Zur Auswahl stehen nur Funktionen, deren Rechte die handelnde Person selbst in der Geltung «alle» hat und die die Person noch nicht trägt; sonst steht ein Satz («Es gibt keine weitere Funktion, die du vergeben darfst.»). Nach dem Hinzufügen liegt der Fokus auf «Entfernen» der neuen Zeile.
- [ ] **89.4** «Speichern» entzieht zuerst und vergibt dann; das Toast sagt «Die Funktionen gelten ab der nächsten Anfrage der Person.». Geht eine Änderung nicht durch (403 Eskalationsschutz, 403 `KONTO_GESCHUETZT`, 404), steht ein Warn-Toast (8 Sekunden) mit Funktion und Grund; die übrigen Angaben sind gespeichert.
- [ ] **89.5** Die Seite einer globalen Rolle hat kein «Personen zuordnen», kein «Zuordnen» und kein «Entziehen». Jede Zeile hat «Bearbeiten im Blatt» (Link mit Namen «Bearbeiten im Blatt: <Person>», Zielgrösse mindestens 44 Pixel); der Link öffnet das Blatt der Person. Eine ungültige Kennung in der Adresse zeigt «Diese Seite gibt es nicht».
- [ ] **89.6** Bei 390 und 1280 Pixel, hell und dunkel: kein waagrechtes Scrollen, Chip, Hinweis und Fehlermeldung lesbar, Fokusring sichtbar, Knöpfe mindestens 44 Pixel hoch.

### Stand der Prüfung (#801)

Im Browser (Chromium headless, Playwright, eigener Dev-Server, Kopie der Demo-Datenbank, Sitzung des Test-Entwicklers mit zweitem Faktor) bei 1280 x 900 hell und 390 x 844 dunkel:

- **89.1:** Block unter «Stufen und Rollen» mit gleicher Zeilenform; Chip «Webmaster» bei «Webmaster Demo».
- **89.2:** Entfernen mit Enter: Zeile durchgestrichen, «wird beim Speichern entfernt», Fokus auf «Entfernen rückgängig: Funktion Webmaster, Webmaster Demo»; Knopf 142 x 44 Pixel.
- **89.3:** «Funktion hinzufügen» ohne Wahl: «Wähle eine Funktion.» am Feld (dunkel, 390 Pixel gesehen); mit Wahl «Webmaster»: Zeile da, Fokus auf deren «Entfernen».
- **89.4:** Speichern entzog die Funktion (Datenbank: 0 Zeilen), erneutes Speichern vergab sie (1 Zeile); Toast wie beschrieben. Fehlerfälle im Browser nicht ausgelöst.
- **89.5:** Rollenseite «Webmaster»: Liste mit «Bearbeiten im Blatt», kein Zuordnen, Hinweis da; der Link öffnet das Blatt (`#personen/personen/<id>`).
- **89.6:** bei beiden Grössen ohne waagrechtes Scrollen (Ansichten gesehen, kein Messwert).

**Nicht geprüft:** Bildschirmleser (VoiceOver, TalkBack, NVDA), Safari und Firefox, Zoom 200 % und 400 %, erzwungene Farben, Touch am echten Gerät, die Sicht einer Person ohne «Rechte und Rollen vergeben», die Fehlerfälle 89.4 im Browser.

## 90. Hinweisseite der Sperre: Anmelden für Berechtigte (#803)

Auf der Hinweisseite der Informationssperre (`index.html`, `404.html`, Code in `apps/api/src/website/sperre.ts`) steht unter «Nochmals versuchen» der Link «Für Berechtigte: Anmelden» zur Anmeldung der Verwaltung (`/admin#system/plattform`). Die Seite bleibt eine einzelne Datei mit eigener Stilvorlage, ohne Skript. Unter einer Sperre von `alles` öffnet die Verwaltung für Berechtigte nur «Wartung und Sperre» (`admin.js`, Rückfall in `pruefeKonto`).

### Prüfpunkte

- [ ] **90.1** Der Link ist ein echter Link (`a href`), erreichbar mit Tab nach «Nochmals versuchen», Enter folgt ihm. Der Name «Für Berechtigte: Anmelden» sagt allein, wohin er führt.
- [ ] **90.2** Sichtbarer Fokus (3 px Rahmen, Abstand 3 px), auch in Hell und Dunkel; Zielgrösse mindestens 44 Pixel hoch (24 x 24 verlangt WCAG 2.5.8).
- [ ] **90.3** Der Link ist unterstrichen, nicht nur durch Farbe erkennbar. Kontrast der Schriftfarbe `--leise` zur Fläche: hell #4d4d4d auf #ffffff, dunkel #bebeb6 auf #1c1c1a (je über 4,5:1).
- [ ] **90.4** Bei 390 und 1280 Pixel, hell und dunkel: der Link bleibt in der Textspalte, kein waagrechtes Scrollen. Im Modus «Erzwungene Farben» trägt er keinen Rahmen und bleibt als Linktext lesbar.
- [ ] **90.5** Die Hinweisseite bleibt neutral: Kein Wort zu Anlass, Daten, Panne oder Sicherheit; der Link benennt keine Rollen und keine Sperre.
- [ ] **90.6** Nach dem Link zeigt die Anmeldung der Verwaltung dieselben Prüfpunkte wie bisher (Abschnitt 9, Fokus auf der Überschrift, Fehler als `role="alert"`); nach dem Code liegt der Fokus auf der Überschrift «Wartung und Sperre», das Band «Informationssperre» steht als Bereich «Betriebshinweis» darüber.

### Stand der Prüfung (#803)

Im Browser (Chromium headless, Playwright, eigener Dev-Server mit Proxy für die Website, Kopie der Vorschau-Datenbank, Demo-Konten mit zweitem Faktor) bei 390 x 844 und 1280 x 900, hell und dunkel:

- **90.1, 90.2:** Tab, Tab erreicht den Link, Enter öffnet `/admin#system/plattform`; der Fokusrahmen ist in Hell und Dunkel sichtbar (Ansicht angeschaut).
- **90.4:** Kein waagrechtes Scrollen (`scrollWidth` gleich `clientWidth`).
- **90.6:** Entwickler und Abteilungsleitung (Sperre `alles` mit «Öffentliche Website vom Netz nehmen»): Anmeldung, Code, «Wartung und Sperre» mit Band und «Aufheben»; danach ist die Website wieder da. Ein Elternkonto bekommt «Anmeldung nicht möglich …» (401).

**Nicht geprüft:** Bildschirmleser, Safari und Firefox, Zoom 200 %, Modus «Erzwungene Farben» (nur im CSS vorgesehen), Kontrast 90.3 nicht gemessen (Werte aus den Tokens).

## 91. Website: Menü für Angemeldete (#795)

Seiten, die nur für Angemeldete oder für Gruppen sichtbar sind, stehen im Hauptmenü der Website, sobald die Person angemeldet ist und die Seite sehen darf: im Menü am Computer, im Menü am Handy und in der Unterleiste, an der Stelle im Seitenbaum. Für Besucher ohne Anmeldung und ohne Skript bleibt das Menü wie es war. Das Skript `navigation.js` fügt die Einträge nur ein; die Bedienung bleibt die der öffentlichen Punkte. In der Verwaltung steht beim Blatt «Sichtbarkeit» einer Seite der Hinweis, wo die Seite im Menü erscheint.

### Prüfpunkte

- [ ] **91.1** Ohne Anmeldung (und ohne Skript) fehlt jeder geschützte Punkt im Menü; die direkte Adresse einer geschützten Seite zeigt die Hülle mit «Nur angemeldet sichtbar» und dem Link zur Anmeldung, wie bisher.
- [ ] **91.2** Nach der Anmeldung erscheinen die Punkte an ihrer Stelle (Eltern, Gruppen, Reihenfolge der Seitenliste) ohne Sprung des Kopfes: Die Kopfzeile wird nicht höher, nichts rutscht in eine zweite Zeile; was nicht mehr passt, steht unter «Mehr».
- [ ] **91.3** Neue Links sind mit der Tastatur wie die öffentlichen erreichbar: Tab-Reihenfolge von links nach rechts und in die Tafel, Pfeiltasten in der Tafel, Esc schliesst die Tafel und gibt den Fokus an das Dreieck zurück. Ein neues Untermenü hat einen Namen («Unterseiten von …») und öffnet sich mit Dreieck, Enter und Leertaste.
- [ ] **91.4** Auf einer geschützten Seite trägt ihr Punkt `aria-current="page"`, ihre Oberseiten `aria-current="true"`, im Menü am Handy ist der Zweig offen. Die aktuelle Seite ist nicht nur an der Farbe erkennbar (roter Strich, fette Schrift).
- [ ] **91.5** Das Einblenden dauert 0,2 s und entfällt bei «Bewegung reduzieren». Es gibt keine Ansage der Bildschirmleser für das Einfügen (kein Live-Bereich); die Links erscheinen in der Lesereihenfolge des Menüs.
- [ ] **91.6** Hell, dunkel und bei 390, 1280 und 2560 Pixel: Texte lesbar, kein waagrechtes Scrollen, Ziele mindestens 44 mal 44 Pixel wie bei den übrigen Punkten.
- [ ] **91.7** Netzfehler, 401 und eine ungültige Antwort der Schnittstelle lassen das statische Menü unverändert, ohne Meldung.
- [ ] **91.8** Verwaltung, Blatt «Sichtbarkeit» einer Seite: Der Satz zum Menü steht unter den Wahlkarten, ändert sich mit der Wahl («Steht im Menü der Website für alle, sobald die Seite veröffentlicht ist.» oder «Erscheint im Menü nur für angemeldete Personen, die die Seite sehen dürfen.») und ist über `aria-describedby` mit der Gruppe der Wahlkarten verbunden. Bei einem Baustein steht er nicht.

### Stand der Prüfung (#795)

Im Browser (Chromium headless, Playwright, eigener Dev-Server mit Kopie der Vorschau-Datenbank, Konten mit Sitzung für Eltern, Leitung einer Stufe und Abteilungsleitung; Seiten «Fotos» und «Dokumente» nur für Angemeldete, eine Seite für die Gruppe Pilami, eine Unterseite für Angemeldete, ein Entwurf und eine Seite für eine fremde Stufe):

- **91.1:** Ohne Anmeldung kein Punkt im Menü am Computer und am Handy; `/fotos` zeigt die Hülle mit Anmeldelink. In keiner erzeugten Datei der Website steht ein Titel der geschützten Seiten.
- **91.2:** Eltern sehen «Fotos» und «Dokumente» am Ende der obersten Ebene und «Intern für Angemeldete» im Untermenü «Über den Cevi Stäfa-Hombi»; die Leitung der Pilami zusätzlich «Pilami intern» unter «Unsere Gruppen» an der Stelle der Seitenliste; die Abteilungsleitung auch die Seite einer anderen Stufe. Nie der Entwurf. Ein Untermenü, das nur geschützte Seiten hat («Fotos» mit «Fotoarchiv»), entsteht im Menü am Computer, am Handy und in der Unterleiste. Bei 1024 und 1280 Pixel mit neun Punkten wandern die letzten unter «Mehr», die Höhe des Kopfs bleibt gleich (Abteilungsleitung); bei 2560 Pixel bleibt der Kopf einzeilig. Die Layoutverschiebung (CLS) lag beim Einfügen auf einer öffentlichen Seite bei 0,001; auf den geschützten Seiten selbst zwischen 0,07 und 0,14 durch den nachgeladenen Inhalt, wie bei der Hülle ohne Anmeldung (0,07).
- **91.3:** Pfeil runter im Untermenü «Unsere Gruppen»: Fröschli, Pilami, Pilami intern, Imperius; Esc: Fokus zurück auf das Dreieck «Unterseiten von Unsere Gruppen». Das neue Untermenü «Fotos»: Pfeil runter auf «Fotoarchiv», Esc zurück auf das Dreieck. Tab-Reihenfolge: Link, Dreieck, nächster Link und in die Tafel.
- **91.4:** Auf `/fotos` trägt «Fotos» `aria-current="page"`, auf `/fotos/archiv` «Fotos» `"true"` und «Fotoarchiv» `"page"`; im Menü am Handy ist der Zweig offen.
- **91.6:** Menü am Handy (390, hell und dunkel) und Computer (1280 hell und dunkel, 2560 hell) angeschaut, kein waagrechtes Scrollen (Ansicht, kein Messwert).
- **Ablauf von Anfang bis Ende:** Sitzung, Seite «Fotos»: Hülle, danach Titel, Text und Baustein Fotoalben (ohne Alben: «Hier gibt es noch keine Fotos.»); Klick auf «Fotoarchiv» im Untermenü lädt die Seite und markiert den Punkt.

**Nicht geprüft:** 91.5 (Bewegung reduzieren) und 91.7 (Netzfehler) nur im Quelltext und mit den reinen Funktionen (Test), nicht im Browser; 91.8 (Verwaltung) nicht im Browser; Bildschirmleser, Safari, Firefox, Zoom 200 %; ein Konto eines Kindes (es hat keine eigene Regel und folgt `sichtbarFuer` wie jedes Konto; ein Konto ohne Gruppe wurde mit Eltern geprüft); Albumdaten von Flickr (ohne Schlüssel im Dev-Server).

## 92. Verwaltung: Rollenname nach Geschlecht der Person (#817)

Die Verwaltung nennt die Rolle einer bestimmten Person nach ihrem Geschlecht: «Stufenleiter» und «Gruppenleiter» für Männer, «Stufenleiterin» und «Gruppenleiterin» für Frauen, sonst «Stufenleitung» und «Gruppenleitung» (Helfer `rollenName` in `rollenname.js`). Die Angabe ist freiwillig und wird im Blatt der Person gepflegt (Abschnitt «Angaben», Auswahl «Geschlecht (optional)»); in «Mein Konto» steht sie als gesperrtes Feld. Allgemeine Beschriftungen ohne Person (Rechtekatalog, Auswahl der Rolle, Mitteilungsziele) und die öffentliche Website bleiben neutral.

### Prüfpunkte

- [ ] **92.1** Die Auswahl «Geschlecht (optional)» im Blatt der Person ist eine Radiogruppe (`role="radiogroup"`) mit sichtbarer Beschriftung (`aria-labelledby`) und dem Hilfetext «Bestimmt, wie die Rolle heisst, z. B. Stufenleiterin. Ohne Angabe heisst sie neutral, z. B. Stufenleitung.» (`aria-describedby`). Der Bildschirmleser nennt Gruppe, Hilfetext, Option («Weiblich», «Männlich», «Keine Angabe oder andere») und Zustand (ausgewählt).
- [ ] **92.2** Die Auswahl ist mit Tab erreichbar, die Pfeiltasten wechseln die Option, der Fokusring ist sichtbar; jede Option ist mindestens 44 Pixel hoch. Der gewählte Zustand zeigt einen Haken, nie nur Farbe.
- [ ] **92.3** Die Wahl gilt erst mit «Speichern»; ohne Wahl bleibt «Keine Angabe oder andere» (neutrale Form). Beim Erfassen ist die Angabe leer.
- [ ] **92.4** Wo eine Person mit Rolle steht, stimmt die Form: Chips im Blatt und in der Personenliste, Untertitel des Blatts, Chips der Gruppe einer Stufe («Mitglieder»), «Was darf wer?» (Personenliste), Anwesenheit (Leitende), Kopf und «Mein Konto». Die Gruppierung «Funktion» bleibt neutral («Stufenleitung», «Leitung»), damit eine Gruppe nicht in Männer und Frauen zerfällt.
- [ ] **92.5** Die Suche findet beide Formen: «Stufenleitung» findet auch eine Stufenleiterin (Befehlspalette, «Was darf wer?», Mitglieder einer Gruppe).
- [ ] **92.6** In «Mein Konto» ist das Feld «Geschlecht» gesperrt (`readonly`), hat Beschriftung und Hilfetext und zeigt «Weiblich», «Männlich», «Andere» oder «Keine Angabe».
- [ ] **92.7** Bei 390 und 1280 Pixel, hell und dunkel: kein waagrechtes Scrollen, die Auswahl bricht um, statt abgeschnitten zu werden; Kontrast von Text und gewählter Option mindestens 4,5 zu 1.

### Stand der Prüfung (#817)

Siehe Pull Request, Abschnitt «Barrierefreiheit».

## 94. Verwaltung: Rufname statt vollem Namen (#815)

Die Verwaltung nennt eine Person wie die Website: mit dem Cevi-Namen, sonst mit dem Vornamen (bei Konten das erste Wort des Namens, bei Kindern der Vorname), sonst mit dem vollen Namen. Leere Werte und Leerzeichen zählen als nicht vorhanden. Der volle Name bleibt sichtbar, damit Personen eindeutig bleiben: als zweite Zeile unter dem Rufnamen, ausser beide sind gleich. Die Regel steht an einer Stelle (`rufname` und `vollerNameZusatz` in `dom.js`) und gilt für Karte und Zeile der Personen, Kinder, Stufenleitung und Gruppenmitglieder (`mitgliedKopf`), den Titel des Blatts der Person und seine Profilkarte, das Kontomenü im Kopf, die Suche (Strg K), die Personenwahl bei Rollen, Eltern eines Kindes und im Lager. Bewusst unverändert, weil sie den vollen Namen brauchen: die Felder «Name», «Vorname» und «Nachname» in den Formularen, Exporte und Import, die Datenschutz-Auskunft, die Teilnehmerlisten der Lager, das Protokoll, Beschriftungen von Knöpfen («Entfernen: Anna Muster») und die Suche selbst (sie findet über Cevi-Name, Name und Benutzername). Leitplanke: `test/admin-rufname.test.ts`.

### Prüfpunkte

- [ ] **94.1** Der Titel der Karte, der Zeile und des Blatts ist der Rufname, die zweite Zeile der volle Name; ohne Unterschied steht nur eine Zeile. Der Bildschirmleser liest zuerst den Rufnamen, danach den vollen Namen (Reihenfolge im Quelltext, kein `aria-label`, das den Namen ersetzt).
- [ ] **94.2** Die Initialen im Kreis stammen aus dem Rufnamen (der Kreis bleibt `aria-hidden`); beim «(du)» steht der Zusatz hinter dem Rufnamen im Titel.
- [ ] **94.3** Kontomenü: Im Kopf steht der Rufname, im offenen Menü darunter der volle Name und die Rolle; der Name der Schaltfläche beginnt mit «Konto: » und dem Rufnamen.
- [ ] **94.4** Befehlspalette: Rufname als Titel, voller Name als Zusatz; wer nach dem Nachnamen, dem Cevi-Namen oder dem Benutzernamen sucht, findet die Person weiter, die Treffer im Zusatz sind markiert.
- [ ] **94.5** Personenwahl (Rollen zuordnen, Eltern eines Kindes, Lager): Rufname vorne, voller Name im Nebentext; gleiche Rufnamen sind am vollen Namen unterscheidbar. Namen von Knöpfen («Entfernen: …», «Hinzufügen: …») behalten den vollen Namen.
- [ ] **94.6** Der Titel im Formular bleibt: «Name» zeigt den vollen Namen, das Feld «Cevi-Name» den Cevi-Namen; die Vorschau rechts folgt beiden Feldern beim Tippen.
- [ ] **94.7** Bei 390 und 1280 Pixel, hell und dunkel: lange Namen umbrechen, kein waagrechtes Scrollen, Kontrast der zweiten Zeile wie bisher (`--on-surface-variant`).

### Stand der Prüfung (#815)

Im Browser (Chromium headless, Playwright, eigener Dev-Server, Kopie der Demo-Datenbank, Konto der Abteilungsleitung mit zweitem Faktor), 1280 x 900 hell und 390 x 844 dunkel:

- **94.1:** Personenliste: «Linn» mit «Linn Demo», «Stufenleitung» mit «Stufenleitung Demo»; Blatt: Titel «Linn», darunter «Linn Demo · Stufenleitung», Profilkarte «Linn» / «Linn Demo».
- **94.2, 94.3:** Das eigene Konto ohne Cevi-Namen steht als «Demo (du)» mit «Demo Admin» darunter; Kontomenü zeigt «Demo», «Demo Admin», «Abteilungsleitung».
- **94.4:** Suche «demo»: Titel «Linn», Zusatz «Linn Demo» und so weiter.
- **94.7:** kein waagrechtes Scrollen bei beiden Grössen (`scrollWidth` gleich `clientWidth`), Ansichten von Liste, Blatt und Kontomenü angeschaut.

**Nicht geprüft:** Bildschirmleser (VoiceOver, TalkBack, NVDA), Safari und Firefox, Zoom 200 %, erzwungene Farben, Kontrast nicht gemessen (Tokens unverändert), 94.5 (Personenwahl) und 94.6 (Vorschau beim Tippen) nicht im Browser, Tabellenansicht der Personen nur über denselben Baustein.
