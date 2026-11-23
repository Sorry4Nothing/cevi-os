# Checkliste Barrierefreiheit

Mit dieser Checkliste wird jeder Bildschirm der App von Hand geprüft, auf einem iPhone und einem Android-Gerät. Massstab ist WCAG 2.2 AA, sinngemäss für Apps.

## Wann prüfen

- Neuer Bildschirm: mindestens die Punkte aus Abschnitt 1 mit VoiceOver und TalkBack, dazu alle anderen Punkte, die er berührt.
- Geänderter Bildschirm: die Punkte, die die Änderung berührt.
- Vor dem Pilot und vor Version 1.0: alle Punkte auf jedem Bildschirm.
- Öffentliche Seiten der Website und Editor der Verwaltung (Web statt App): Abschnitt 11, im Browser geprüft.
- Bereich «Termine» der Verwaltung (Web statt App): Abschnitt 12, im Browser geprüft.
- Lädeli auf der Website: Abschnitt 11 («Lädeli»); Bereich «Lädeli» der Verwaltung: Abschnitt 13, im Browser geprüft.
- Verwaltung insgesamt (Web statt App), im Browser geprüft: Toasts und zweistufige Knöpfe Abschnitt 14, Kopf, Auswahlfelder und Seiten im Fluss Abschnitt 15, Übersicht Abschnitt 16, Anmeldung, System und Mitteilungen Abschnitt 17, Website-Medien, Einstellungen und Lädeli Abschnitt 18, Personen Abschnitt 19, Lager Abschnitt 20, Seiten und Editor Abschnitt 21, Navigation, Bereichsauswahl und Befehlspalette Abschnitt 22.
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
- [ ] **8.2** Ausser der App-Sperre gibt es kein Zeitlimit: Keine Eingabe läuft ab, keine Fehlermeldung, Warnung oder Rückfrage verschwindet von selbst. Ausnahme in der Web-Verwaltung (Entscheid des Auftraggebers, #570): Erfolgs- und Infomeldungen ohne Aktion («Gespeichert», «Veröffentlicht») blenden nach 6 Sekunden aus. Bedingungen: Die Meldung steht sofort und ganz in der Statusregion (`role="status"`), die Zeit hält bei Zeiger und Fokus auf der Meldung an und beginnt danach neu, «Hinweis schliessen» bleibt, mit «Bewegung reduzieren» ohne Übergang. Die Meldung bestätigt nur, was auf der Seite ohnehin sichtbar ist (Zustand, Liste); sie ist keine Voraussetzung, um weiterzuarbeiten (WCAG 2.2.1 betrifft Zeitlimits für Aufgaben, 2.2.3 ist AAA).

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
- [ ] **11.18** Nach dem Löschen eines Bausteins erscheint ein Toast mit «Rückgängig» (auch Strg+Z); Erfolgsmeldungen im Editor gehen nach 6 Sekunden von selbst, Warnungen, Fehler und Meldungen mit Aktion bleiben. Hinzufügen, Verschieben, Speichern und Veröffentlichen melden das Ergebnis in der Statusmeldung (Live-Region), ohne den Fokus zu stehlen.
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
- [ ] **12.17** Anmeldungen und Export: Die Summen stehen als Zahl im Filterknopf. Der Export ist eine Karte auf der Seite (kein Fenster), nennt Dateiname, Format, Stand und Personendaten und weist auf das führende Hochkomma bei Formelzeichen hin. «Der Export wird erstellt …», «Bereit: <Datei> (<Grösse>)» und «Der Export ist fehlgeschlagen» stehen als Text in einer Live-Region; der Fortschrittsbalken hat einen Namen und steht bei «Bewegung reduzieren» still. Der Fokus liegt auf dem nächsten sinnvollen Knopf, «Abbrechen» bricht den Abruf ab, und die Datei liegt nur im Speicher der Seite, bis sie heruntergeladen oder die Seite verlassen wird. Der Knopf wechselt von «Export erstellen» über «Abbrechen» zu «Herunterladen» und behält den Fokus.
- [ ] **12.18** Räume und Anfragen: Das Team wird erst beim Öffnen des Blatts geladen. Das Blatt «Raum bearbeiten» zeigt Fehler beim Feld und in einer Zusammenfassung «N Angaben prüfen» mit Knöpfen, die das Feld fokussieren; beim Speichern sind die Felder gesperrt, der Knopf trägt `aria-busy`. Die Anfragen nennen Raum, Zeit und Zweck als Text, «Bestätigen» und «Ablehnen» sind getrennte Knöpfe, «Ablehnen» fragt mit Begründung (Pflicht) zurück; bei einer Überschneidung bleibt «Bestätigen» mit `aria-disabled` erreichbar, und der Grund steht als Text.
- [ ] **12.19** Anwesenheit (Bereich «Anwesenheit», #195): Die Tabelle je Stufe hat Spaltenköpfe, die Reiter «Kinder» und «Leitende» tragen `aria-current="page"`, die Auswahl der Anzahl (5, 10, 20) und der Stufe ist per Tastatur bedienbar und zeigt den Zustand nicht nur über Farbe, eine Zelle ohne Eintrag ist als Text lesbar (nicht nur «–» als Zeichen), und beim Wechsel bleibt der Fokus auf dem gewählten Element.

### Stand der Prüfung

Aus den PRs der Issues, ohne neue Messung für dieses Dokument: Jeder Reiter wurde im Browser (Chromium, Playwright) mit der echten `termine.js` und `admin.css` und erfundenen Antworten geprüft, mit Demo-Namen, bei 390 Pixeln Breite und, wo der PR es vermerkt, 1280 Pixeln: Warnliste (#433: Liste, Nachladen, leer), Vorschläge (#441: Tastaturablauf von Liste bis Eintragen, 409, Netzausfall, erzwungene Farben), Anlässe (#445: Verschieben und Entfernen per Tastatur, Validierung, Export, 403, 401, 500, offline) und Räume (#446, #447); der Bereich «Anwesenheit» ist hier nicht Teil dieser Angabe. Nicht geprüft: ein echter Server mit zweitem Faktor, Screenreader (NVDA, VoiceOver, TalkBack) und 200 Prozent Zoom von Hand. Die Punkte oben sind das Mass für diese Prüfung und noch von Hand abzuhaken; die Verwaltung folgt seit dem Neuaufbau (#524) Tag und Nacht des Geräts, die Aussage oben bezieht sich auf die frühere Fassung.

### Kalender, Anlässe, Räume (#590)

- [ ] **12.20** Kalender, Monatsansicht: Das Raster ist ein `grid` mit Zeilen, Spaltenköpfen (`abbr` mit ausgeschriebenem Wochentag) und Tagesknöpfen; genau ein Tag liegt in der Tabulatorreihenfolge (Roving Tabindex). Pfeile bewegen um einen Tag oder eine Woche, Pos1 und Ende an den Wochenrand, Bild auf und ab um einen Monat (mit Umschalt um ein Jahr); über den Monatsrand wechselt die Ansicht und der Fokus bleibt auf dem Zieltag. Jeder Tag trägt als Namen Datum, «heute» und die Zahl der Termine; die Chips im Raster sind `aria-hidden`, die Termine des gewählten Tages stehen als Liste neben oder unter dem Raster, die Auswahl wird angesagt (Statusregion). «Heute» ist ein gefüllter Kreis, der gewählte Tag hat einen Rahmen, beides nicht nur über Farbe.
- [ ] **12.21** Kalender, Zustände: Abgesagt ist durchgestrichen und trägt das Wort «Abgesagt» in der Liste, ein Termin ohne Gruppe ist gestrichelt und trägt «Keine Gruppe»; ein Termin über mehrere Tage ist ein verbundener Balken, die Liste nennt «Tag 2 von 5». Unter 40 rem zeigt das Raster Punkte statt Chips (Form unterscheidet: Kreis, Ring, Quadrat). Der Monat lädt mit `aria-busy`; schlägt er fehl, steht ein Hinweis mit «Nochmals versuchen» (`role="alert"`). Monatswechsel legen einen Verlaufseintrag an (Zurück führt zum Vormonat), die Wahl eines Tages ändert nur die Adresse. Die Tabelle («Liste») bleibt als Ansicht mit demselben Inhalt.
- [ ] **12.22** Anlässe: Zusatzfelder, Reihenfolge, Griff 44 px mit Namen «Verschieben: <Feld>»; die Zeile hat «Bearbeiten» und «Entfernen» mit dem Feldnamen im Namen. Anmeldeschluss hat ein Datumsfeld und ein Zeitfeld mit Format «TT.MM.JJJJ» und «HH:MM» (Tippen und Kalender), kein natives Feld. Plätze eines Raums sind ein Zahlfeld mit Knöpfen «Weniger» und «Mehr».
- [ ] **12.23** Speicherleiste (Zusatzfelder, Kategorien): Sie erscheint erst, wenn etwas geändert ist (`role="region"`, Text in einer Statusregion: «2 Zuordnungen geändert, noch nicht gespeichert.»), bietet «Verwerfen» und «Speichern», haftet unten und verdeckt den Fokus nicht; ohne Änderungen gibt es keinen Speichern-Knopf, auch nicht bei leerer Seite.
- [ ] **12.24** Anmeldungen, Balken: Angemeldet und Abgemeldet stehen als Zahl und Prozent im Text, der Balken ist `aria-hidden` und wächst nur bei erlaubter Bewegung; die Frist nennt Datum, Uhrzeit und die Tage bis dahin. Die Karte «Rückmeldungen» und der Export stehen untereinander ab 56 rem Breite nebeneinander.

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

Dieser Abschnitt gilt für jede Aktion der Verwaltung, die früher eine Rückfrage hatte (`ctx.mitRueckgaengig`, `zweistufig`; Beschreibung in [verwaltung-geruest.md](verwaltung-geruest.md)). Geprüft wird im Browser am PC und am Handy, in Tag und Nacht; die Abschnitte 1 bis 6 gelten sinngemäss.

- [ ] **14.1** Der Toast erscheint in einer Region mit Namen («Rückgängig») gleich nach dem Kopf im Seitenaufbau, nimmt dem Fokus nichts weg und erscheint am Handy über die ganze Breite, ohne Inhalt zu verdecken, der gerade bedient wird.
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
- [ ] **17.5** Die Vorschau der Mitteilung ist für Screenreader ausgeblendet (`aria-hidden`), die Angaben stehen in den Feldern selbst; «Geht an» und «Rollen» stehen als Liste mit Name und Wert. Der Knopf «Senden» fragt im Knopf, die Frage nennt Empfänger und Rollen.
- [ ] **17.6** Das Diagramm der Anfragen hat einen Satz mit allen Werten, eine Ablesung mit Pfeiltasten und eine Tabelle («Als Tabelle anzeigen»); der Fehleranteil hat Legende und Zahl, nicht nur Farbe.
- [ ] **17.7** Die Seite System aktualisiert sich nie von selbst; «Aktualisieren» meldet «Zahlen aktualisiert.» in der Live-Region.
- [ ] **17.8** Anmeldung: Fehler, «zu viele Versuche» (Chip mit Wort) und der zweite Faktor (Codefeld mit sechs Zellen, Einfügen, Autofill) sind Meldungen mit `role="alert"`; der Fokus liegt auf der Meldung oder dem Titel. Der Sitzungsablauf sagt ehrlich, was verloren geht, und führt nach dem Anmelden auf dieselbe Seite zurück.
- [ ] **17.9** Hell, Dunkel und «Bewegung reduzieren»: Das Band und die Termine der Vorschau gleiten nur bei erlaubter Bewegung ein.
- [ ] **17.10** 320, 390, 720 und 1440 Pixel: nichts scrollt waagrecht, auch Personen und Gruppen nicht (die Beschriftung der Tabelle für Screenreader liegt im Rahmen).

### Stand der Prüfung (#593)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 17.1 bis 17.4, 17.6 bis 17.7 und 17.9 bis 17.10 (320, 390, 720 und 1440 Pixel, Hell und Dunkel, Tastatur im Wochentag, Wartung und Sperre ein- und ausgeschaltet). Anmeldung (17.8) mit falscher Eingabe, 429 und falschem Code im Browser, der echte zweite Faktor und der Sitzungsablauf nur mit nachgestellten Antworten. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom am Gerät, Kontrastwerte mit einem Messwerkzeug.

## 18. Verwaltung: Website-Medien, Einstellungen, Stufenfelder und Lädeli (#591)

Dieser Abschnitt gilt für `#website/medien`, `#website/einstellungen`, `#website/stufenfakten` und `#laedeli/*` (`website-medien.js`, `website-einstellungen.js`, `website-stufenfakten.js`, `laedeli.js`, `bildwahl.js`). Er ergänzt den Abschnitt 13 für das Lädeli. Geprüft wird im Browser am PC und am Handy, Tag und Nacht.

- [ ] **18.1** Zweispalter: Links stehen die Felder, rechts Bild oder Vorschau; unter 1100 Pixeln steht alles in einer Spalte, die Reihenfolge im Quelltext ist Felder vor Vorschau (beim Alt-Text steht das Bild schmal zuerst). Die rechte Spalte ist ein `aside` mit Überschrift; nichts scrollt waagrecht.
- [ ] **18.2** Bildwahl: Der Knopf trägt `aria-expanded` und `aria-controls`; die Bilder sind Knöpfe mit `aria-pressed`, das gewählte trägt ausserdem einen Haken (nie nur Farbe). Ein Klick wählt, schliesst und setzt den Fokus auf den Knopf zurück; Escape schliesst nur die Wahl. Enter in der Suche schickt das Formular nicht ab. Das Laden meldet «Bilder werden geladen …» (Live-Region), ein Fehler hat «Nochmals versuchen».
- [ ] **18.3** Vorschau der Einstellungen: Sie ist rein darstellend (`alt=""`, die Beschriftung steht darüber); «Nicht gespeichert» und «Alles gespeichert» stehen als Wort in einer Live-Region.
- [ ] **18.4** Medien: Die Ansichtswahl besteht aus zwei Knöpfen mit `aria-pressed` (44 Pixel hoch); in der Liste hat jede Zeile die Auswahl, das Bild, den Namen mit Chips und die Aktion. Die Filterleiste meldet die Trefferzahl («5 von 24 Medien»); gesetzte Filter sind Chips mit Namen. Die Auswahlleiste ist eine Region «Auswahl» mit Zahl in einer Live-Region; «Löschen» bietet «Rückgängig» an.
- [ ] **18.5** Ladezustände: Karten, Raster und Listen zeigen Platzhalter in der Form des Inhalts (`aria-hidden`) und «Lädt …» für Screenreader; das Pulsieren läuft nur mit erlaubter Bewegung. Fehlt ein Bild, steht ein Wort an seiner Stelle.
- [ ] **18.6** Stufenfelder: Die Stufenpillen sind Knöpfe mit `aria-pressed`; Datum und Zeit lassen sich tippen und per Kalender wählen; ein Datum ohne Wahl nennt den Fehler beim Feld.
- [ ] **18.7** Bestellungen: Die Schiene ist eine Liste «Stand der Bestellung» mit `aria-current="step"` am aktuellen Schritt; erledigte Schritte tragen Haken und für Screenreader «(erledigt)». Der geteilte Knopf ist mit Pfeiltasten bedienbar; «Übergeben» und «Stornieren» bieten «Rückgängig» an.
- [ ] **18.8** Artikel: Das Bild steht gross neben den Feldern, die Vorschau nennt Name, Preis, Hinweis, Grössen und Stand; ein Wechsel des Bildes löst die Frage «Änderungen verwerfen?» beim Verlassen aus.

### Stand der Prüfung (#591)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 18.1 bis 18.8 bei 1440, 1024, 720 und 390 Pixeln (kein waagrechter Überlauf, keine Bedienelemente unter 44 Pixeln Höhe ausser den Kontrollkästchen der Medienkarten), Tag und Nacht, Ablauf Einstellungen speichern, Artikel mit neuem Bild speichern, Bestellung bereit melden und zurück auf offen, Alt-Text speichern, Löschen mit «Rückgängig», Suche, Stufenfeld ändern. **Nicht geprüft:** Screenreader (NVDA, VoiceOver, TalkBack), 200 Prozent Zoom von Hand, Kontrastwerte mit einem Messwerkzeug, das Hochladen einer echten Datei (kein Speicher lokal).

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
- [ ] **22.7** Zweispalter (Einstellungen, Stufenfelder, Mitteilungen, Artikel, Person): kein eigener Scrollbereich; die rechte Spalte (Vorschau, Bild) bleibt beim Scrollen stehen und ist nie höher als das Fenster; unter 1100 Pixeln steht alles in einer Spalte.
- [ ] **22.8** Befehlspalette (Strg oder Cmd + K, auch der Knopf «Suchen» im Kopf): ein Dialog mit Namen, Suchfeld mit `role="combobox"`, Trefferliste mit `role="listbox"` und `aria-activedescendant`, Pfeiltasten, Enter öffnet, Escape schliesst und gibt den Fokus zurück; die Zahl der Treffer steht in einer Statusregion. Das Kürzel steht im Knopf und im Hinweis. «Neue Person» erscheint nur mit dem Recht, Personen erscheinen nur, wenn ihre Liste schon geladen ist.

## 23. Verwaltung: Breite, Übersicht, Zähler, Auswahlfelder (#607)

Dieser Abschnitt gilt für das Gerüst (`admin.css`, `geruest.css`, `navigation.js`) und die Übersicht (`uebersicht*.js`, `uebersicht.css`). Die Abschnitte 15, 16 und 22 gelten weiter.

- [ ] **23.1** Breite: Kopf, Bereichsleiste, Unterleiste, Hinweisband, Seitenkopf und Inhalt haben bei 1440, 1920 und 2560 Pixeln dieselbe linke und rechte Kante wie `.wrap` der Website (Maximalbreite 105 rem, Seitenrand `clamp(1rem, 4vw, 4.5rem)`); gemessen über `getBoundingClientRect` auf allen Seiten der Navigation. Raster, Tabellen, Kalender, Zweispalter und Seiten im Fluss laufen nicht über den Rand und scrollen die Seite nicht waagrecht.
- [ ] **23.2** «Jetzt zu tun»: Alle Kacheln einer Ansicht sind gleich gross, die Aktionszeile unten ist überall 44 Pixel hoch und gleich platziert; die ganze Kachel ist ein Link mit dem Namen aus Zahl, Satz und Aktion (16.2). Ohne Recht auf die Zielseite bleibt die Zeile leer, die Kachel gleich gross.
- [ ] **23.3** Kennzahlen: Jede Kachel nennt Titel, Zahl mit Einheit und (wo es einen Vergleich gibt) die Veränderung mit Pfeil, Vorzeichen und Worten. Die Zahl hat Kontrast 4.5:1 in Hell und Dunkel. Mit «Bewegung reduzieren» schiebt sich die Zahl nicht ein, und die Säulen wachsen nicht.
- [ ] **23.4** Zustand: Jeder Dienst (Website, Kalender-Abgleich) steht mit Name, Zustand als Wort mit Symbol und einem Satz; Verweis mindestens 44 Pixel hoch. Fehlt das Recht, fehlt der Dienst.
- [ ] **23.5** Zähler in der Unterleiste und der Bereichsauswahl sind Kreise (24 Pixel, Zahl mittig, bis 99); der Screenreader hört «<Zahl> offen» nach dem Namen. Der Kreis hat in erzwungenen Farben einen Rand.
- [ ] **23.6** Auswahlfelder: Alle `select` der Verwaltung werden zum Auswahlfeld der Website (`auswahl.js`, dieselben Masse: 52 Pixel hoch, 17 Pixel, Radius 12, Liste mit Haken); kein `select` zeigt die Liste des Browsers, kein Auswahlfeld hat `multiple`. Oben in den Listen (Filterleiste) stehen sie wie bei den Terminen der Website: 220 Pixel breit, Beschriftung 16 Pixel mit 8 Pixel Abstand, Pfeil in der leisen Textfarbe. Geprüft per Durchgang durch alle Seiten der Navigation.
- [ ] **23.7** Navigation: «Komponenten» und «Anmeldungen» stehen nirgends im Menü; `#anlaesse/anmeldungen` führt zur Liste der Anlässe, mit Kennung zum Anlass.

### Stand der Prüfung (#607)

Im Browser (Chromium, headless, Playwright) gegen eine Kopie der Demo-Abteilung geprüft: 23.1 (alle 33 Seiten der Navigation, 1440, 1920 und 2560 Pixel, Hell), 23.2 bis 23.5 und 23.7 (Übersicht in Hell und Dunkel bei 1440 und 2560 Pixeln, Zähler vermessen), 23.6 (Durchgang durch alle Seiten, Masse der Felder verglichen). **Nicht geprüft:** Screenreader, 200 Prozent Zoom am Gerät, Messung der Kontraste mit einem Werkzeug, Dunkel bei 1920 Pixeln auf allen Seiten.

## 27. Verwaltung: System, Verlauf der Anfragen und Stufenfelder (#606)

Dieser Abschnitt gilt für `system.js` (Kennzahlen, Verlauf, Streifen, Liste der letzten Fehler), `system.css` und den Einleitungstext in `website-stufenfakten.js`. Er ergänzt 17.6. Geprüft wird bei 390, 1440, 1920 und 2560 Pixeln, in Tag und Nacht, mit Tastatur.

- [ ] **27.1** Der Umschalter «Letzte Stunde» und «Letzte 24 Stunden» ist eine Gruppe mit Namen («Zeitraum»); der gewählte Knopf trägt `aria-pressed`. Nach dem Wechsel liegt der Fokus auf dem gewählten Knopf, nicht im Nichts.
- [ ] **27.2** Jede Kennzahl nennt Titel, Zahl und Veränderung als Text («Stunde davor: 380 (+8 %)»). «Erhöht» bei den Serverfehlern steht als Chip mit Wort, nie nur als Farbe. Ohne Vergleichsgrundlage (die API läuft erst kurz) steht der Satz «Noch kein Vergleich», nie eine erfundene Zahl. Einen Vergleich mit dem Vortag gibt es nicht: Die API behält nur 24 Stunden.
- [ ] **27.3** Die Säulen haben einen Satz mit allen Werten (`role="img"`), eine Ablesung mit Zeiger und Pfeiltasten (Text darunter, `aria-live`) und eine Tabelle («Als Tabelle anzeigen», auch bei den Serverfehlern in der Spalte «Anteil 5xx»). Achsenwerte (0, Mitte, Höchstwert) und Zeitmarken sind Zierde; der Satz nennt alle Werte.
- [ ] **27.4** Der Streifen «Serverfehler je Stunde» zeigt den Zustand nicht nur über die Farbe: Die Höhe trägt ihn mit (leer 2, ruhig 5, vereinzelt 10, erhöht 16), Legende und Ablesung nennen das Wort («keine Serverfehler», «vereinzelte Serverfehler», «Serverfehler erhöht» mit Zahl und Anteil). Er ist mit Tab erreichbar und mit Pfeiltasten lesbar.
- [ ] **27.5** Alle Texte der Achsen erreichen 4.5:1 (Token `--leise` auf Karte), in Tag und Nacht; in erzwungenen Farben sind Fehler und «vereinzelt» umrandet, «erhöht» ist gefüllt.
- [ ] **27.6** «Letzte Fehler» ist eine Liste: Status als Chip mit Wort und Zahl, Methode und Route, die Zeit als «vor 7 Minuten» in einem `time`-Element mit Datum im Titel. Die Tabelle mit allen Fehlern steht im Reiter «Anfragen».
- [ ] **27.7** «Bewegung reduzieren»: Die Säulen und Zellen wachsen nur bei erlaubter Bewegung ein. 390 Pixel: Kennzahlen untereinander, die Achse zeigt Anfang und «jetzt», nichts scrollt waagrecht.
- [ ] **27.8** Stufenfelder: Die Einleitung sagt in drei Sätzen, was die Seite ist (Treffzeit, Treffpunkt, Schlusszeit, Schlussort, Mitnehmen je Treffen), wo man die Wirkung sieht (Stufenseite der Website, Tafel zum nächsten Datum) und dass nichts veröffentlicht werden muss. Zeilenlänge höchstens 44 rem, Schrift 16 Pixel.

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
