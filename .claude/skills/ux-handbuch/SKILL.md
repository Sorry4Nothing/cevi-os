---
name: ux-handbuch
description: Pflicht-Handbuch für UX und Design auf höchstem Niveau (Web/Verwaltung, Android Compose, iOS SwiftUI). Immer zuerst laden bei jeder Arbeit an UI, Screens, Komponenten, Texten, Formularen, Navigation, Barrierefreiheit oder Design-Reviews.
---

# UX- & Design-Handbuch (Web · Android · iOS)

Version 3 · Stand der Recherche: 8. November 2026. Plattformregeln ändern sich jährlich (Google I/O im Mai, WWDC im Juni, Android-Release im Juni, iOS-Release im September). Bei Unsicherheit die Quellen am Schluss neu prüfen, bevor eine Zahl als «aktuell» bezeichnet wird. Mit *(unbestätigt)* markierte Angaben sind Praxiswerte oder nicht direkt in der Primärquelle geprüft.

## Wegweiser – welcher Teil für welche Aufgabe

| Aufgabe | Zuerst lesen |
|---|---|
| Neuer Screen / neue Funktion | 0 (Kontext, Zustände) → 1 (Hierarchie, Layout) → Plattformteil |
| Visuelles Design, Theme, Farben, Schrift | 1 → 5 (Tokens) → Plattformteil |
| Web-Verwaltung | 2 |
| Android-App | 3 |
| iOS-App | 4 |
| Gleiches Feature auf allen Plattformen | 5 |
| Anmeldung, Mitteilungen, Suche, Onboarding, Zahlung | 6 |
| Personendaten, Kinder, Einwilligungen, Recht | 7 |
| Review / Kritik eines bestehenden Screens | 8 |
| Projektspezifische Entscheide Cevi OS | 9 |
| Allgemein anerkannte Richtlinien-Sammlungen (Kanon) | 10 |
| Abschluss jeder UI-Arbeit (Qualitätstor) | 11 |

## Verbindlichkeit (zuerst lesen)

Dieses Handbuch gilt für **jede** Arbeit an Oberflächen, Abläufen, Texten, Design und Barrierefreiheit – Web, Android, iOS –, auch für Code-Änderungen, die nur «nebenbei» UI berühren. Rangfolge bei Widersprüchen:
1. **Projekt-Doku im Repo** (für Cevi OS: `docs/design.md`, `docs/barrierefreiheit.md`, Design System `tokens.json`, Entscheide des Auftraggebers) – sie geht immer vor.
2. **Dieses Handbuch** – füllt alles, was die Projekt-Doku nicht regelt.
3. Allgemeines Wissen – nur, wo beide schweigen; dann als Annahme kennzeichnen.
Widerspricht das Handbuch einer Projektregel, die Projektregel befolgen und den Widerspruch im PR/Antworttext nennen, wenn er die UX spürbar verschlechtert. Vor dem Abschluss jeder UI-Arbeit das Qualitätstor (Teil 11) durchgehen.

## Arbeitsweise

1. **Vor dem Bauen:** Klären, *wer* die Aufgabe *in welcher Situation* erledigt (0.1). Dann Muster wählen, Plattformregeln anwenden, alle Zustände entwerfen (0.6).
2. **Beim Review:** Methode aus Teil 8, Checklisten der Plattformteile, Schweregrad 0–4, Ausgabeformat 8.4.
3. **Prioritäten bei Konflikten:**
   1. Sicherheit der Aufgabe (keine Datenverluste, keine Fehlbedienung, kein Schaden für Kinder)
   2. Barrierefreiheit (WCAG 2.2 AA, Plattform-Accessibility)
   3. Plattformkonventionen (Jakob's Law)
   4. Konsistenz im eigenen Produkt
   5. Ästhetik und Markenausdruck
   Marke verliert *immer* gegen Lesbarkeit und Bedienbarkeit.
4. **Ehrlich bleiben:** Ungetestete Annahmen als Annahmen kennzeichnen und eine günstige Prüfmethode vorschlagen (0.9). Praxisregeln nicht als Forschung ausgeben.

---

# Teil 0 – UX-Fundament (alle Plattformen)

## 0.1 Was UX ist

- **UX** = die gesamte Erfahrung mit einem Produkt, vor, während und nach der Nutzung (Erwartung, Bedienung, Ergebnis, Support, Vertrauen). **UI** ist nur die Oberfläche.
- **Usability** (NN/g) hat fünf Komponenten: Erlernbarkeit, Effizienz, Einprägsamkeit, Fehler (wenige, leicht behebbar), Zufriedenheit.
- **Nützlichkeit = Usability + Utility.** Eine perfekt bedienbare Funktion, die niemand braucht, ist schlechte UX.
- **Jobs to be Done:** «Wenn ich [Situation], will ich [Motivation], damit ich [Ergebnis].» Jede Funktion muss auf einen solchen Job zurückführbar sein.
- **Kontext zuerst:** Gerät, Umgebung (draussen, Sonne, Kälte, Lärm, eine Hand frei), Zeitdruck, Netz (Wald/Lager = schlechtes Netz), Vorwissen, Häufigkeit.
  - Häufige Aufgaben → Effizienz (Abkürzungen, Defaults, wenige Taps, keine Animationen, die bremsen).
  - Seltene Aufgaben → Erlernbarkeit (Erklärung, Schritt-für-Schritt, gute Defaults).
- **Norman's drei Ebenen** (Emotional Design): *viszeral* (erster Eindruck in ca. 50 ms, Lindgaard 2006), *verhaltensbezogen* (Freude und Effizienz bei der Nutzung – für Werkzeuge wie eine Verwaltung die wichtigste Ebene), *reflektiv* (Bedeutung, Erinnerung, «was sagt die Nutzung über uns»). Ein Produkt kann bedienbar sein und trotzdem emotional verlieren.

## 0.2 Prozess (Double Diamond, schlank)

1. **Entdecken:** 5 kurze Gespräche mit echten Nutzenden pro Gruppe, Support-Fragen, Analytics.
2. **Definieren:** Problem in einem Satz + messbares Erfolgskriterium («Leitende erfassen die Anwesenheit in < 30 s»).
3. **Entwickeln:** Mehrere Varianten skizzieren (Low-Fi zuerst), nicht die erste Idee polieren.
4. **Ausliefern:** Bauen, testen, messen, iterieren. Kleine Releases > grosser Wurf.

## 0.3 Nielsens 10 Usability-Heuristiken (seit 1994 unverändert)

| # | Heuristik | Prüffrage |
|---|---|---|
| 1 | Sichtbarkeit des Systemstatus | Weiss ich jederzeit, was passiert (lädt, gespeichert, offline, fehlgeschlagen)? |
| 2 | Übereinstimmung mit der realen Welt | Sprache der Nutzenden statt DB-Feldnamen und Codes? |
| 3 | Kontrolle und Freiheit | Abbrechen, Zurück, Rückgängig? Komme ich aus jedem Zustand heraus? |
| 4 | Konsistenz und Standards | Wie andere Apps der Plattform und überall im Produkt gleich? |
| 5 | Fehlervermeidung | Auswahl statt Freitext, sinnvolle Grenzen, Schutz bei Zerstörerischem? |
| 6 | Wiedererkennen statt Erinnern | Muss ich mir etwas merken, das die App zeigen könnte? |
| 7 | Flexibilität und Effizienz | Abkürzungen für Geübte, ohne Neue zu überfordern? |
| 8 | Ästhetisches, minimalistisches Design | Verdient jedes Element seinen Platz? |
| 9 | Fehler erkennen, verstehen, beheben | Sagt die Meldung *was*, *warum*, *was jetzt*? |
| 10 | Hilfe und Dokumentation | Kontextuelle Hilfe dort, wo sie gebraucht wird? |

## 0.4 Laws of UX – mit Konsequenz

- **Fitts:** Zeit zum Treffen hängt von Grösse und Distanz ab → Primäraktion gross und daumennah; Zerstörerisches nicht neben Häufigem.
- **Hick:** Mehr Optionen = längere Entscheidung → Hauptnavigation 3–5 Ziele, ein klarer Default, lange Listen gruppieren/durchsuchbar.
- **Miller / Chunking:** Arbeitsgedächtnis ist klein → `079 123 45 67`, Formulare in Abschnitte.
- **Jakob:** Leute verbringen die meiste Zeit in *anderen* Apps → Plattformmuster nicht neu erfinden.
- **Tesler:** Komplexität wird verschoben, nicht entfernt → das System übernimmt sie (Defaults, Vorausfüllen).
- **Doherty:** Unter ca. 400 ms bleiben Nutzende im Fluss → sofortiges Feedback, optimistische UI.
- **Von Restorff:** Andersartiges fällt auf → *eine* hervorgehobene Primäraktion pro Bereich.
- **Serieller Positionseffekt:** Anfang und Ende werden erinnert → wichtigste Ziele aussen.
- **Goal-Gradient / Zeigarnik:** Fortschritt motiviert, Unfertiges bleibt im Kopf → Schrittanzeige, «Entwurf gespeichert».
- **Peak-End:** Höhepunkt und Ende prägen die Erinnerung → Erfolgsmomente gestalten, Fehlerenden vermeiden.
- **Aesthetic-Usability-Effekt** (Kurosu & Kashimura 1995; Tractinsky 2000): Schönes wirkt benutzbarer → verschafft Toleranz für *kleine* Probleme, nicht für grosse; verdeckt Probleme in Tests – Verhalten beobachten, nicht Lob zählen.
- **Gestalt:** Nähe, Ähnlichkeit, gemeinsame Region, Geschlossenheit → Abstand trennt stärker als Linien.
- **Postel:** Tolerant bei Eingaben (`+41`/`0041`/`079`, Leerzeichen, ä/ae), strikt bei Ausgaben.

## 0.5 Antwortzeiten (NN/g, nach Miller 1968)

| Dauer | Wahrnehmung | Design-Antwort |
|---|---|---|
| ≤ 0,1 s | direkte Manipulation | kein Indikator, Ergebnis zeigen |
| ≤ 1 s | Gedankenfluss bleibt | kein Indikator |
| 2–10 s | bewusstes Warten | Spinner für ein einzelnes Modul, Skeleton für ganze Seite |
| > 10 s | Aufmerksamkeit geht verloren | Fortschrittsbalken mit Zeitschätzung, Abbrechen, im Hintergrund weiterlaufen, Mitteilung bei Fertig |

- Indikator verzögert einblenden (Flackern bei < 300 ms ist schlimmer als Warten).
- Up-/Downloads: immer Fortschrittsbalken, nie Skeleton.
- Skeleton statisch oder mit dezentem Schimmer; Schimmer bei «Bewegung reduzieren» abschalten. Nur Rahmen ohne Inhalt nicht empfohlen (NN/g).
- **Optimistische UI** für reversible Aktionen mit hoher Erfolgsquote (Häkchen, Zusage, Anwesenheit): sofort anzeigen, bei Fehler sichtbar zurücksetzen und erklären. **Nie optimistisch:** Zahlungen, Nachrichten an Eltern, Löschen für alle.

## 0.6 Die Zustände jedes Screens (häufigste Lücke!)

1. **Leer – erstes Mal:** erklärt, was hierhin kommt + erste Aktion («Noch keine Anlässe. Lege den ersten an.»). Der Leerzustand *ist* das beste Onboarding.
2. **Leer – nach Filter/Suche:** «Keine Treffer für ‹xyz›» + Filter zurücksetzen + Alternative.
3. **Lädt:** Skeleton in Form des echten Inhalts.
4. **Teilweise geladen / Paginierung:** Position beim Zurückkehren erhalten.
5. **Ideal.**
6. **Zu viel / Extremwerte:** lange Namen, lange deutsche Komposita («Sommerlageranmeldeformular»), 0/1/1000 Einträge, fehlende Bilder, grösste Schrift, Querformat.
7. **Fehler:** verständlich, mit Lösung, Eingaben bleiben erhalten.
8. **Offline:** Was geht ohne Netz, was wird gepuffert? Klar sichtbar (6.8).
9. **Keine Berechtigung:** erklären, wer Zugriff geben kann.
10. **Erfolg:** Bestätigung, die zum nächsten sinnvollen Schritt führt.
11. **Interaktionszustände jedes Bedienelements:** Standard, Hover, Fokus, Gedrückt, Ausgewählt, Deaktiviert, Lädt, Fehler.

## 0.7 Formulare

- **Label immer sichtbar über dem Feld** (oder Floating Label). Nie nur Placeholder – er verschwindet beim Tippen, besonders beim Korrigieren geht der Kontext verloren (Baymard). Wichtige Infos nie nur im Hinweistext.
- Einspaltig; mehrspaltig nur für zusammengehörige Kurzfelder (PLZ + Ort).
- Nur fragen, was der *aktuelle* Schritt braucht; Rest später. Optionale Felder als «(optional)» markieren.
- **Inline-Validierung beim Verlassen des Feldes** (on blur), nie während des ersten Tippens. Nach einem Fehler live revalidieren, damit die Meldung verschwindet, sobald es stimmt. Positive Validierung nur, wo Erfolg nicht offensichtlich ist.
- Beim Absenden trotzdem validieren: Fokus aufs erste Fehlerfeld; bei langen Formularen Fehlerzusammenfassung oben mit Links zu den Feldern.
- Fehlermeldung beim Feld, in Text + Icon (nicht nur Rot), konkret: «Gib eine Handynummer im Format 079 123 45 67 ein».
- Passender Tastaturtyp, Autofill/Autocomplete, Passwort-Manager, **Einfügen nie blockieren** (bei Passwort- und Codefeldern verlangt das WCAG 3.3.8).
- Eingaben nie verlieren: Entwürfe speichern, beim Verlassen warnen.
- Absende-Button nicht stumm deaktivieren – aktiv lassen und beim Klick Fehler zeigen.
- Mehrstufig nur bei vielen Feldern: «Schritt 2 von 3», Zurück ohne Datenverlust, Zusammenfassung vor dem Absenden.
- **Redundant Entry (WCAG 3.3.7):** Bekanntes vorausfüllen oder auswählbar machen. Beim zweiten Kind dieselbe Adresse nicht nochmals verlangen.
- **Accessible Authentication (WCAG 3.3.8):** keine Gedächtnis-/Rätseltests; Passkeys, Magic Link, Code mit Autofill.

## 0.8 UX Writing und Sprache

**Schweizer Formate:** immer «ss», nie «ß»; Anführungszeichen «…» (innen ‹…›); Datum `08.11.2026` (Kurzform `Sa 8.11.`); Zeit in der UI einheitlich `14:30` oder im Fliesstext `14.30 Uhr` – eine Variante wählen; Beträge `CHF 12.50` bzw. `Fr. 12.50`; Tausender `1'250`; Telefon `079 123 45 67`.

**Grundregeln:**
- Du- oder Sie-Form einmal entscheiden, überall gleich (Cevi-Kultur: «du» für Leitende und Teilnehmende; für Eltern bewusst entscheiden).
- Buttons mit Verb + Objekt: «Anlass speichern», «Teilnahme bestätigen» statt «OK», «Weiter», «Ja».
- Bestätigungsdialog: Titel als Frage, Buttons benennen die Folge («Anlass löschen» / «Abbrechen»).
- Frontloading: Wichtigstes zuerst in Titeln, Listenzeilen, Mitteilungen.
- Kurze Sätze (≤ 25 Wörter, GOV.UK), aktiv, konkrete Verben, ein Gedanke pro Satz.
- Gleiches Ding = gleiches Wort, überall (Glossar führen: «Anlass» vs. «Aktivität» vs. «Termin» – eines wählen).
- Zahlen als Ziffern, keine Versalien zur Betonung, kein Ironie oder Humor in Fehlern.
- Icon ohne Text braucht eine Screenreader-Beschriftung; nicht universelle Icons brauchen ein sichtbares Label.

**Fehlermeldungen (NN/g):**
- Nah an der Ursache, Schwere passend platziert: Feld → inline; Seite → Banner; blockierend → Dialog.
- Menschlich, präzise, konstruktiv, ohne Schuldzuweisung; technischer Code höchstens klein für den Support.
- Eingaben behalten, Korrektur direkt anbieten («Meintest du …@gmail.com?»).
- Kein «Fehler!», kein «Ups».

**Geschlechtergerechte Sprache** (Leitfaden der Bundeskanzlei, 3. Auflage 2023; für Bundestexte verbindlich, für Cevi gute Referenz):
- Der Leitfaden setzt keine Rangfolge («Die Wahl ist situationsbezogen»). Für UI eignen sich meist **geschlechtsneutrale Formen**, weil sie kurz sind: «Leitende», «Teilnehmende», «Person», «Mitglied», «Leitungsteam», «Ansprechperson»; oder Umformulieren («Wer sich anmeldet, …»).
- **Paarform** im Fliesstext: «Leiterinnen und Leiter» (Singular mit «oder», nie «bzw.»).
- Kurzform mit Schrägstrich («Leiter/-in») nur in knappen Texten (Tabellen, Formulare, Labels).
- Der Leitfaden lässt Genderstern, Doppelpunkt, Unterstrich, Binnen-I nicht zu. Neutrale Formen schliessen nonbinäre Personen ein. Anrede bei unbekanntem Geschlecht: «Guten Tag Kim Müller».

**Zielgruppen:**
- **Kinder und Jugendliche:** kurze Sätze, konkrete Wörter, Beispiel statt Definition, Folgen klar benennen («Wenn du das löschst, sehen deine Leitenden es nicht mehr»), Icons mit Text. Keine nachgeahmte Jugendsprache.
- **Nichtmuttersprachliche Eltern:** keine Redewendungen, keine Synonymwechsel, keine Wortungetüme.
- **Leichte Sprache** (A1–A2, empfohlen A2; EBGB-Leitfaden v1.1, Juni 2026): ein Satz pro Zeile, keine Passivsätze, kein Konjunktiv, keine Verneinungen in Serie, lange Wörter mit Bindestrich («Anmelde-Formular»), Hervorhebung fett statt kursiv, mit der Zielgruppe testen. **Einfache Sprache** (B1) hilft vielen, ersetzt aber Leichte Sprache nicht.

## 0.9 Forschung und Messung

**Methoden nach Aufwand:**
- **Heuristische Evaluation** (0.3, Teil 8): schnell, ohne Nutzende. Mehrere Evaluierende finden mehr.
- **5-Sekunden-Test:** Screen 5 s zeigen, dann fragen: Was ist das? Was kann man hier tun? Was ist aufgefallen? (prüft Hierarchie und ersten Eindruck)
- **Guerilla-Test:** 5 Personen, je 10 min, 3 realistische Aufgaben, laut denken lassen, nicht helfen.
- **Moderierter Usability-Test:** Aufgaben als Ziel formulieren («Melde dein Kind für das Sommerlager an»), nicht als Anleitung.
- **Card Sorting / Tree Testing** für Navigation und Begriffe.
- **Analytics/Funnel:** Abbrüche, Suchen ohne Treffer, Rage Taps.
- **A/B-Test** nur mit genug Traffic; bei einer einzelnen Abteilung lieber qualitativ.

**Kennzahlen:**
- **SEQ** nach jeder Aufgabe, 7-stufig. Durchschnitt über viele Studien ca. 5,3–5,6; unter 5 genauer anschauen.
- **SUS** am Ende, 10 Aussagen, 0–100 (kein Prozentwert). Durchschnitt 68, ab ca. 80 gut. Bei 5–8 Personen grosse Unsicherheit – Trend über Releases verfolgen.
- **Erfolgsrate, Zeit pro Aufgabe, Fehlerrate** – die ehrlichsten Zahlen.
- **HEART** (Google): Happiness, Engagement, Adoption, Retention, Task success – je Ziel → Signal → Metrik.

## 0.10 Schweregrad (Nielsen)

| Grad | Bedeutung | Handlung |
|---|---|---|
| 0 | kein Problem | – |
| 1 | kosmetisch | wenn Zeit bleibt |
| 2 | klein | niedrige Priorität |
| 3 | gross | vor nächstem Release |
| 4 | Katastrophe (Datenverlust, Aufgabe unmöglich, Barriere, Datenschutzverletzung) | sofort, blockiert Release |

Schweregrad = Häufigkeit × Auswirkung × Hartnäckigkeit.

## 0.11 Barrierefreiheit – Grundlagen

- **Zielstandard: WCAG 2.2 AA** (seit Sept./Okt. 2025 auch ISO/IEC 40500:2025). In der Schweiz verweist eCH-0059 v3 auf WCAG 2.1 AA; WCAG 2.2 ist abwärtskompatibel und deckt das ab. Für Cevi besteht derzeit keine gesetzliche Pflicht – es ist ein Qualitätsziel. WCAG 3 ist noch Entwurf (Working Drafts März und September 2026), Abschluss erst in einigen Jahren – nicht darauf designen.
- **Kontrast WCAG 2:** Text ≥ 4,5 : 1; grosser Text (≥ 24 px bzw. ≥ 18,7 px fett) ≥ 3 : 1; UI-Bestandteile, Icons, Feldrahmen ≥ 3 : 1 (1.4.11 – gilt indirekt auch für Fokusindikatoren). 7 : 1 ist WCAG AAA (1.4.6) und ein gutes Ziel für kleinen Text. Apple HIG: 4,5 : 1 bis 17 pt, 3 : 1 ab 18 pt und für fetten Text.
- **APCA** nur als Zusatzprüfung, besonders im Dark Mode (WCAG 2 überschätzt helle Schrift auf dunklem Grund): Fliesstext Lc ≥ 75 (besser 90), anderer Text Lc ≥ 60, grosser Text Lc ≥ 45. Der WCAG-3-Entwurf (Sept. 2026) lässt das Kontrastverfahren offen und nennt APCA nicht; APCA ist nicht rechtsverbindlich. Apple HIG nennt APCA inzwischen neben WCAG als gängigen Standard.
- **Farbe nie als einziges Signal** – ca. 8 % der Männer und 0,5 % der Frauen haben eine Farbsehschwäche, meist Rot-Grün. Immer Farbe + Icon/Form + Text.
- **Trefferflächen:** WCAG 2.2 AA ≥ 24 × 24 CSS-px (oder genug Abstand); Praxis iOS 44 × 44 pt, Android 48 × 48 dp, Web-Touch 44 × 44 px. Grafik darf kleiner sein, Trefferfläche nicht.
- **Text skalierbar:** Web 200 % Zoom und Reflow bei 320 px; Android 200 % Schrift; iOS bis AX5 (Body 53 pt). Umbrechen statt abschneiden.
- **Bewegung:** «Bewegung reduzieren» respektieren – Bewegung durch Überblenden ersetzen, Feedback nicht ganz entfernen. Nichts blinkt > 3×/s.
- **Screenreader:** logische Reihenfolge, alles beschriftet, Zustände angesagt, Statusmeldungen live.
- **Ziehen (2.5.7):** Alternative mit einfachen Taps/Klicks. **Konsistente Hilfe (3.2.6):** immer am gleichen Ort. **Zeitlimits:** keine oder verlängerbar.
- **Kognitive Barrierefreiheit** (W3C COGA, 8 Ziele): verstehen, was Dinge sind; finden; klare Inhalte; Fehler vermeiden und beheben; Fokus halten; nicht aufs Gedächtnis angewiesen sein; Hilfe; Anpassung erlauben.
- Testen: VoiceOver, TalkBack, Tastatur + NVDA, grösste Schrift, Graustufen, Farbsehschwäche-Simulation (Chrome DevTools → Rendering; Android-Entwickleroptionen «Farbraum simulieren»; Sim Daltonism).

---

# Teil 1 – Visuelles Design: was gutes Design ausmacht

Legende: **[F]** = forschungsbasiert, **[P]** = bewährte Praxisregel (Refactoring UI, Butterick, Bringhurst, NN/g, Plattformen).

## 1.1 Haltung: Prinzipien guten Designs

**Dieter Rams – gutes Design ist:** innovativ, brauchbar, ästhetisch, verständlich, unaufdringlich, ehrlich, langlebig, konsequent bis ins Detail, umweltfreundlich, so wenig Design wie möglich. Für UI am wichtigsten:
- *Unaufdringlich* – Werkzeuge treten zurück, Inhalt und Nutzende stehen im Vordergrund.
- *Ehrlich* – keine Dark Patterns, keine falschen Affordanzen (Dinge sehen klickbar aus, wenn sie es sind – und nur dann).
- *Konsequent bis ins Detail* – auch Leer-, Fehler-, Lade- und Extremzustände sind gestaltet.
- *So wenig wie möglich* – alles weg, was der Aufgabe nicht dient.

**Apple-Designprinzipien** (HIG, wieder eingeführt am 8. Juni 2026): **Purpose** (Sinnvolles schaffen), **Agency** (Menschen ihren Weg gehen lassen), **Responsibility** (im Interesse der Menschen handeln), **Familiarity** (auf Bekanntem aufbauen), **Flexibility** (an Kontexte und Bedürfnisse anpassen), **Simplicity** (klar und direkt – «Einfachheit ist nicht Minimalismus», Hierarchie schaffen), **Craft** (jedes Detail zählt), **Delight** (menschlich – «Freude nicht mit Dekoration verwechseln»).

**Material 3 Expressive** stützt sich auf 46 Studien mit über 18'000 Teilnehmenden: wichtige Elemente wurden in expressiven Varianten bis zu 4× schneller gefunden; der Alters-Nachteil älterer Nutzender (45+) verschwand weitgehend; bei 18–24-Jährigen laut Berichten bis 87 % Präferenz. [F, von Google berichtet, nicht unabhängig geprüft] Lehre: **Ausdruck mit Zweck** (Grösse, Farbe, Form, um Wichtiges hervorzuheben) verbessert Usability – Dekoration ohne Zweck nicht.

**Persönlichkeit bewusst festlegen:** Zuerst 3 Adjektive für die Marke wählen (z. B. «warm, verlässlich, abenteuerlich»), dann daraus Schrift, Farbe, Radius, Bewegung und Ton ableiten. [P]
- Serifen → klassisch/elegant; runde Sans → freundlich; neutrale Sans → sachlich.
- Kleiner Radius → ernsthaft; grosser Radius → verspielt. Eine Radius-Familie für alles.
- Federnde Bewegung → lebendig; lineare/gedämpfte → sachlich.

## 1.2 Visuelle Hierarchie

**Werkzeuge, ungefähr nach Stärke** [P]:
1. **Grösse** – das Wichtigste ist am grössten. Pro Bereich max. ca. 3 Grössen, max. 2 Elemente in der grössten Stufe.
2. **Kontrast/Helligkeit und Sättigung** – nicht der Farbton selbst schafft Hierarchie, sondern der Kontrast zur Umgebung. Gesättigte Farben nur für Wichtiges.
3. **Schriftgewicht** – zwei Gewichte genügen meist (400/500 normal, 600/700 betont). Keine Gewichte < 400 für UI-Text.
4. **Abstand** – Weissraum isoliert und gibt Gewicht.
5. **Position** – oben links zuerst (F-/Z-Muster beim Scannen) [F, Eyetracking NN/g].
6. **Gemeinsame Region** (Rahmen, Hintergrundflächen) – zuletzt, weil sie Unruhe bringen.

**Hervorheben durch Zurücknehmen** [P]: Wenn das Hauptelement nicht heraussticht, nicht lauter machen, sondern Konkurrenz leiser: inaktive Navigation grau, Seitenleiste ohne Farbfläche. Drei Texttöne: Primär (dunkel), Sekundär (mittel), Tertiär (hell) – **aber nie unter die Kontrastgrenze**; zuerst über Grösse und Gewicht zurücknehmen.

**Semantik ≠ visuelles Gewicht:** Eine Überschrift muss nicht riesig sein. Abschnittstitel wirken oft besser als kleines, halbfettes, gedämpftes Label – der Inhalt ist der Star.

**Label/Wert:**
- «Label: Wert» vermeiden, wo der Wert sich selbst erklärt («12 Plätze frei» statt «Freie Plätze: 12»).
- Wenn ein Label nötig ist: Label kleiner/heller, Wert betont.
- Ausnahme Verwaltung/Datenblätter: wer nach dem Label sucht, braucht das Label stark.

**Button-Hierarchie:**
- **Primär:** gefüllt, hoher Kontrast – *eine* pro Ansicht/Bereich.
- **Sekundär:** tonal oder Kontur.
- **Tertiär:** Textbutton/Link-Stil.
- **Zerstörerisch:** nicht automatisch rot und gross. Ist Löschen nicht die Hauptaktion, sekundär/tertiär gestalten; rot und betont erst im Bestätigungsdialog, wo Löschen die Hauptaktion ist.

## 1.3 Layout, Abstände, Raster

**Abstandsskala nicht-linear** [P] – benachbarte Werte unterscheiden sich um mind. ca. 25 %, damit Entscheide eindeutig sind:
`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`
Werte ausserhalb der Skala (13, 17, 22) sind ein Warnsignal.

**Mit zu viel Weissraum beginnen, dann reduzieren.** Wer von der Minimalabstand-Seite her baut, landet bei gedrängt. Dichte ist eine bewusste Entscheidung.

**Nähe-Verhältnis:** Abstand *zwischen* Gruppen deutlich grösser als *innerhalb* (Faustregel ca. 2×, mind. 1,5×) [P]. Label näher an seinem Feld als am vorherigen Feld. Gleichmässige Abstände überall sind der häufigste Anfängerfehler.

**Raster:**

| Kontext | Spalten | Rand / Gutter |
|---|---|---|
| Android compact (< 600 dp) | 4 | 16 dp *(unbestätigt)* |
| Android medium (600–839 dp) | 8 | 24 dp *(unbestätigt)* |
| Android expanded+ (≥ 840 dp) | 12 | 24 dp+, Abstand zwischen Panes 24 dp *(unbestätigt)* |
| iOS | Systemränder (Layout Margins, Readable Content Guide) – keine festen Werte hart codieren | |
| Web-Verwaltung | 12-Spalten-Raster für Inhalt; Seitenleiste fix 240–280 px; Formulare max. 600–720 px | |

«Man muss nicht den ganzen Bildschirm füllen» – feste Breiten für Formulare und Text schlagen Prozentspalten. [P]

**Ausrichtung:**
- Pro Bereich eine starke linke Kante; möglichst wenige verschiedene Ausrichtungslinien.
- Text an der Grundlinie ausrichten, nicht an der Mitte.
- Tabellen: Text links, Zahlen rechts, Kopf wie Inhalt ausgerichtet.
- **Optische Korrektur:** geometrisch zentriert wirkt oft schief. Play-Dreiecke ca. 5–10 % Richtung Spitze schieben; runde Formen leicht grösser als eckige; Icons neben Text an Versal- oder x-Höhe ausrichten.

**Karten:**
- Innenabstand ≥ Abstand zwischen Karten (typisch 16–24).
- **Verschachtelter Radius = äusserer Radius − Innenabstand** (sonst wirken Ecken «falsch»).
- Trennen über Hintergrundkontrast *oder* dezenten Schatten – nicht Rahmen + Schatten + Fläche gleichzeitig.
- Nicht alles in Karten packen; Listen und Abschnitte brauchen oft nur Abstand und Trennlinien.

**Dichte:**
- **Verwaltung/Datenwerkzeuge:** dichter – Tabellenzeilen 36–44 px, Tabellentext 13–14 px, weniger Deko-Container.
- **Mobile Consumer-Apps:** luftiger – Listenzeilen 48–72 dp/pt, Abschnittsabstände 16–24.
- Trefferflächen bleiben unabhängig von der Dichte gleich (0.11).

## 1.4 Typografie

**Schriftgrössen-Skala:**
- Für UI eine **handverlesene Skala** statt strikt modularer Verhältnisse (die ergeben krumme Werte und zu wenige kleine Stufen) [P]: `12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 60`.
- Modulare Verhältnisse für redaktionelle Seiten: 1,125 (dichte UI), 1,2, 1,25 (allgemein), 1,333 (Marketing).
- Pro Screen meist 4–6 Grössen insgesamt; 2–3 reichen, um Struktur zu zeigen.
- Auf kleinen Bildschirmen Überschriften stärker verkleinern als Fliesstext.
- Auf Mobile die Plattform-Skalen verwenden (3.4 Android, 4.4 iOS).

**Fliesstext:** Web 16 px (Bereich 15–20; Verwaltungstabellen 13–14); iOS Body 17 pt; Android bodyLarge 16 sp. Nichts Lesbares unter 11–12.

**Zeilenhöhe – umgekehrt proportional zur Grösse:**
- Fliesstext 1,4–1,6
- Überschriften 1,1–1,25
- Display ≥ 48 px: 1,0–1,1
- Einzeilige Labels in Controls 1,2–1,3
- Breitere Zeilen → mehr Zeilenabstand.

**Zeilenlänge:** 45–75 Zeichen, ideal ca. 66 (Bringhurst); im Web `max-width: 65ch`.

**Laufweite (Letter-Spacing):**
- Versalien und Kapitälchen: +5 bis +12 % (`0.05–0.12em`), vor allem bei kleinen Grössen.
- Grosse Überschriften leicht enger: −0,01 bis −0,03em.
- Fliesstext in Kleinbuchstaben nie sperren.
- Variable Schriften mit Optical-Size-Achse (SF Pro, Roboto Flex) erledigen das automatisch – nicht zusätzlich manuell sperren.

**Betonung:** fett und kursiv sparsam, nie kombiniert; Unterstreichung nur für Links; Versalien höchstens kurze Labels (< 1 Zeile); zentrierter Text nur 1–3 Zeilen; **kein Blocksatz** in UI und Web (Löcher, «Flüsse»).

**Schriftwahl und -kombination:**
- Sicherste Lösung: eine Familie mit mehreren Gewichten. Wenn kombiniert: Kontrast der Struktur (Display + Text-Sans), nicht zwei ähnliche Sans.
- x-Höhen der Kombination angleichen.
- Für kleinen UI-Text: grosse x-Höhe, offene Formen (SF Pro, Roboto, Inter, Source Sans).
- Display-Schriften (z. B. Archivo) nur für Titel ≥ ca. 20, nie für Fliesstext oder kleine Labels.
- UI-Schriften mit mind. ca. 5 Gewichten; variable Schriften bevorzugen (eine Datei, Feinsteuerung).
- **Dark Mode:** Schrift wirkt auf dunklem Grund fetter/heller – bei variablen Schriften ein Gewichtsschritt leichter möglich.

**Details, die Profis unterscheiden:**
- **Tabellenziffern** (`font-variant-numeric: tabular-nums`; SwiftUI `.monospacedDigit()`) für Tabellen, Zeiten, Beträge, Zähler; Proportionalziffern im Fliesstext.
- Echte Zeichen: «…» statt "...", Auslassungspunkte `…`, Halbgeviertstrich für Bereiche (`14–16 Uhr`), echtes Minus `−`, geschütztes Leerzeichen vor Einheiten (`10 km`, `CHF 50`).
- Kerning immer an; Silbentrennung (`hyphens: auto` mit `lang="de-CH"`) für lange deutsche Wörter in schmalen Spalten.

## 1.5 Farbe

**Palette aufbauen** [P]:
- **Grautöne:** 8–10 Stufen, nicht reines #000/#888 – leicht temperiert (kühl blau oder warm gelb), an den Enden etwas mehr Sättigung.
- **Primärfarbe:** 5–10 Stufen (z. B. 50–900 oder Tonwerte 0–100). Dunkle Stufen für Text auf hellen Tönungen, helle für Hintergründe und Hinweise.
- **Semantische Farben:** Rot (zerstörerisch/Fehler), Bernstein (Warnung), Grün (Erfolg), Blau (Info) – je eigene Rampe.
- **Perzeptuelle Farbräume:** In **OKLCH** entspricht L der wahrgenommenen Helligkeit; gleiche L wirken bei jedem Farbton gleich hell. Paletten per Formel erzeugen, Kontrast wird vorhersagbar (z. B. schwarzer Text funktioniert ab ca. L ≥ 0,87). In HSL ist das nicht so. Material nutzt dafür HCT (Tone 0–100 ≈ L*).
- Beim Aufhellen/Abdunkeln ohne OKLCH den Farbton leicht verschieben, sonst wirken Farben ausgewaschen.

**Mengenverhältnis:** 60-30-10 als Faustregel (Interior Design, keine Forschung): ca. 60 % neutrale Fläche, 30 % Struktur, 10 % Akzent – in UI oft noch weniger Akzent. Akzent-Zurückhaltung macht die Primäraktion erst sichtbar (Von Restorff).

**Regeln:**
- Keine graue Schrift auf farbigem Grund – stattdessen eine hellere/dunklere Stufe desselben Farbtons oder Weiss mit reduzierter Deckkraft.
- Grosse Flächen nicht in gesättigter Markenfarbe; Markenfarbe nicht für *alles* Interaktive.
- Semantische Tokens statt Rohwerte (5.1).
- Jedes Farbpaar in Hell, Dunkel und erhöhtem Kontrast prüfen.

**Dark Mode bauen:**
- Keine reine Inversion. Abgestufte dunkle Flächen; **Elevation über hellere Flächen** statt Schatten (M3: surfaceContainerLowest N4 … Highest N22).
- Akzentfarben heller und weniger gesättigt (M3: primary Tone 40 hell → Tone 80 dunkel). Gesättigte Farben «vibrieren» auf Dunkel.
- Reines #000 nur bewusst (OLED-Spezialmodus) – sonst Schlieren beim Scrollen und Überstrahlen.
- Historische Faustregel (Material 2) *(unbestätigt)*: Text Weiss mit 87 % / 60 % / 38 % Deckkraft für hoch/mittel/deaktiviert.
- Bilder mit weissem Hintergrund leicht abdunkeln.

## 1.6 Tiefe, Schatten, Elevation

- **Elevation hat Bedeutung:** höher = näher = wichtiger oder vorübergehender. Max. ca. 5 Stufen als Tokens: 0 Inhalt · 1 Karten · 2 Sticky Header/Dropdown · 3 Popover · 4 Modal.
- **Zweiteilige Schatten** [P]: weicher grosser Umgebungsschatten + kleiner dunklerer Kontaktschatten, z. B. `0 1px 3px rgb(0 0 0 / .10), 0 4px 6px rgb(0 0 0 / .07)`. Höher = grösserer Versatz, mehr Unschärfe, weniger Deckkraft.
- **Eine Lichtquelle** (von oben): alle Schatten mit gleichem Winkel.
- Natürlich wirken mehrere schwache Schichten (z. B. 1/2/4/8/16 px Versatz); Schattenfarbe als dunkler Ton der Hintergrundfarbe statt reinem Schwarz.
- **Weniger Rahmen:** Elemente trennen in dieser Reihenfolge: 1. Abstand, 2. anderer Hintergrundton, 3. dezenter Schatten, 4. erst dann Rahmen (hellgrau, kontrastarm). Rahmen überall = Anfängersignal. Akzentkante (3–4 px farbig oben/links) gibt Karten und Hinweisen günstig Charakter.
- Plattformen: M3 setzt auf tonale Flächen statt Schatten; iOS auf Materialien/Liquid Glass.

## 1.7 Form (Radien)

- **Eine Radius-Familie** für das ganze Produkt, aus Tokens.
- **M3-Skala (dp):** none 0 · extraSmall 4 · small 8 · medium 12 · large 16 · largeIncreased 20 · extraLarge 28 · extraLargeIncreased 32 · extraExtraLarge 48 · full (Kreis/Pille).
- **Konzentrische Ecken:** innerer Radius = äusserer − Abstand. iOS 26+: `ConcentricRectangle()` bzw. `.rect(corners: .concentric)` mit `.containerShape(...)` am Elternelement; mit `.concentric(minimum:)` eine Untergrenze setzen.
- **iOS:** kontinuierliche Ecken (Squircle) – `RoundedRectangle(cornerRadius:style: .continuous)`. **Android:** kreisförmige Ecken nach M3; keine Squircles erzwingen. **Web:** `border-radius`; `corner-shape: squircle` höchstens als Progressive Enhancement *(unbestätigt, nur Chromium)*.
- **M3 Expressive Shape-Morphing** (`MaterialShapes`, `Morph`) für Zustandswechsel: gedrückte Buttons, Ladeindikatoren, ausgewählte Icon-Container – sparsam und immer mit Bedeutung.

## 1.8 Icons, Bilder, Illustration

**Icons:**
- **Ein Set, ein Stil:** Kontur *oder* gefüllt, nicht gemischt – Ausnahme: gefüllt für den ausgewählten Zustand (Tab Bar, Nav Bar).
- Gleiche Strichstärke, gleiche Ecken, gleiches Raster; Grössen 16/20/24/32. Plattformset verwenden: **Material Symbols** (Android), **SF Symbols** (iOS, Gewicht passt sich der Schrift an), ein SVG-Set für Web.
- **Kleine Icons nicht hochskalieren** – ein für 24 gezeichnetes Icon wirkt bei 64 klobig. Stattdessen in eine getönte Fläche (Kreis/abgerundetes Quadrat) setzen oder ein Set für grosse Grössen nutzen.
- **Icon + Label:** Nur wenige Icons sind universell (Home, Suche, Drucken, eingeschränkt Hamburger). Herz und Stern bedeuten überall anderes. Fällt dir in 5 s kein eindeutiges Icon ein, nimm ein Wort. Ein Icon = eine Bedeutung im ganzen Produkt. Hover-Labels funktionieren auf Touch nicht.

**Text auf Bildern:** immer Kontrast sichern – Verlauf von transparent zu ca. 70 % Schwarz über dem unteren Drittel, halbtransparente Fläche (30–60 %), Bild abdunkeln/entsättigen oder Textschatten mit grosser Unschärfe. Mit dem *schlechtesten* echten Foto testen, nicht mit dem Demo-Bild.

**Nutzerbilder und Avatare:**
- Festes Seitenverhältnis, `object-fit: cover`.
- Feine innere Kontur (`inset 0 0 0 1px rgb(0 0 0 / .1)`), damit helle Fotos nicht in den Hintergrund laufen.
- Fallback: Initialen auf einer aus dem Namen abgeleiteten, festen Farbe.
- Kreis für Personen, abgerundetes Quadrat für Gruppen/Objekte.

**Illustration:** ein System (Palette aus den Tokens, gleiche Linie, Perspektive, Figurenstil). Gemischte Stock-Stile sind ein Anfängersignal. Bester Ort: Leerzustände, Erfolgsmomente. Schlechtester: dichte Verwaltungsscreens.

## 1.9 Bewegung (Motion)

**Wozu Bewegung dient:** Feedback/Status, räumliche Orientierung (woher kommt etwas, wohin geht es), Kontinuität zwischen Zuständen, Aufmerksamkeit lenken – und sparsam Freude. Bewegung ist nie der einzige Informationsträger.

**Dauern (NN/g, Web):**
- Schalter/Checkbox ca. 100 ms
- Die meisten Übergänge 100–500 ms; Modale und grössere Wechsel 200–300 ms; grosse Wege bis 400 ms; > 500 ms wirkt träge.
- Eintreten etwas länger als Austreten (z. B. 300 ms rein, 200–250 ms raus).
- Je häufiger eine Animation gesehen wird, desto kürzer.
- Easing: ease-out für Eintreten, ease-in für Austreten, nie linear (ausser Fortschritt/Rotation).

**Federn statt Kurven auf Mobile:**
- Federn behalten beim Unterbrechen die Geschwindigkeit → unterbrochene Bewegung wirkt natürlich. Jede Animation muss unterbrechbar sein.
- **SwiftUI:** `.smooth` (kein Nachschwingen), `.snappy` (leicht, 0,15), `.bouncy` (0,3); Standarddauer 0,5 s. Bounce 0 ist der vielseitigste Default; > 0,4 in UI vermeiden.
- **M3 Expressive Federn** (Dämpfung / Steifigkeit):

| Feder | Expressive | Standard | Wofür |
|---|---|---|---|
| fastSpatial | 0,6 / 800 | 0,9 / 1400 | kleine Komponenten (Schalter, Buttons) |
| defaultSpatial | 0,8 / 380 | 0,9 / 700 | Teilflächen (Sheets, Drawer) |
| slowSpatial | 0,8 / 200 | 0,9 / 300 | Vollbild-Übergänge |
| fast/default/slowEffects | 1,0 / 3800 · 1600 · 800 | gleich | Farbe, Deckkraft (kein Überschwingen) |

  *Spatial* = Position, Grösse, Form (darf überschwingen). *Effects* = Farbe, Deckkraft (nie). `MotionScheme.expressive()` für prominente Elemente/Hero-Momente, `standard()` für zweckmässige, häufige Interaktionen.
- **M3-Dauertoken** (falls keine Federn): short 50–200 ms, medium 250–400, long 450–600, extraLong 700–1000. Je grösser Fläche/Weg, desto länger.

**Choreografie:** Elemente einer Liste leicht versetzt (ca. 20–50 ms pro Element, gesamt < 300 ms) *(unbestätigt)*; nicht alles gleichzeitig bewegen; ein Fokus pro Moment.

**Wann Bewegung schadet:** bei häufigen Aufgaben (bremst bei der 50. Nutzung), wenn sie die Aufgabe verzögert (Splash, erzwungene Onboarding-Animationen), in ernsten Momenten (Fehler), ohne «Bewegung reduzieren»-Unterstützung.

## 1.10 Mikrointeraktionen und Freude

**Modell (Saffer):** Auslöser (Nutzende oder System) → Regeln (was passiert) → Feedback (sichtbar, hörbar, fühlbar – es macht die Regeln verständlich) → Schleifen/Modi (Wiederholung, Langzeitverhalten).

**Button-Zustandsmatrix:** Standard · Hover · Fokus (sichtbarer Ring) · Gedrückt · Deaktiviert · Lädt · (Ausgewählt, Fehler).
- **Lädt:** gleiche Breite behalten, Label durch Indikator ersetzen oder ergänzen, Doppelklick sperren, `aria-busy`.
- M3-Zustandsebenen als Überlagerung: Hover 8 %, Fokus 10 %, Gedrückt 10 %, Ziehen 16 %; Deaktiviert Inhalt 38 % / Container 12 %.

**Haptik:**
- Weniger ist mehr; klar und kurz statt «brummig» – lieber keine Haptik als eine brummige.
- Bedeutung konsistent: Erfolg/Warnung/Fehler, Auswahl beim Durchlaufen von Werten, Aufprall passend zum «Gewicht» des Elements.
- Synchron zur sichtbaren Rückmeldung; Systemeinstellungen respektieren; Standard-Controls haben schon Haptik – nicht doppeln.

**Freude gezielt einsetzen:** seltene Momente (erste erfolgreiche Anmeldung, Lager-Countdown, abgeschlossene Abrechnung, Leerzustände). Die Verhaltensebene bleibt «langweilig exzellent». Keine Witze in Fehlern, keine Effekte, die Zeit kosten.

## 1.11 Datenvisualisierung (Dashboards)

**Diagrammwahl nach Frage** [F: Cleveland & McGill 1984 – Position auf gemeinsamer Skala wird am genauesten gelesen; Winkel, Fläche, Sättigung am schlechtesten]:
- Werte vergleichen → Balken (horizontal bei langen Labels)
- Verlauf über Zeit → Linie (Punkte bei wenigen Daten)
- Zusammenhang → Streudiagramm
- Anteil am Ganzen → 100-%-Balken; Kuchen nur bei 2–5 Segmenten, grösstes zuerst ab 12 Uhr
- Verteilung → Histogramm
- Einzelne Kennzahl → grosse Zahl + Veränderung + Sparkline
- **Nie 3D.**

**Regeln:**
- Balken beginnen bei 0 (Länge kodiert den Wert). Linien dürfen bei ≠ 0 beginnen, Achse klar beschriften.
- Direkt beschriften statt Legende; vollständige Bezeichnungen.
- Kein Chart-Ballast: Gitterlinien heller als Achsenbeschriftung, Titel am dunkelsten.
- Titel als Aussage oder Frage («Anmeldungen pro Woche, 2026»).
- **Farbe:** kategorisch 3–10 Farbtöne, auch in Helligkeit verschieden (Graustufen-tauglich), feste Reihenfolge; sequenziell ein Farbton über weiten Helligkeitsbereich; divergierend zwei Rampen mit hellem Mittelpunkt, Blau/Rot statt Grün/Rot; Grau für «Andere» und Kontext; die gesättigtste Farbe nur für die Fokus-Reihe. Grafische Elemente ≥ 3 : 1 zu Nachbarn – weisse Trennlinien helfen.
- Weniger Kategorien (zu «Andere» zusammenfassen) statt mehr Farben.
- Konsistente Zeiträume und Einheiten; Tabellenziffern mit `1'234`.
- Wichtigste Kennzahl oben links; jede Kachel beantwortet eine Frage und führt per Klick zur Liste.

## 1.12 Anfängersignale vs. Profi-Signale

| Anfänger | Profi |
|---|---|
| Gleiche Abstände überall, Gruppen nicht erkennbar | Klare Abstandshierarchie aus einer Skala |
| Willkürliche Werte (13, 17, 22 px) | Alle Werte aus Tokens |
| Rahmen um alles, Rahmen + Schatten + Fläche | Trennung über Abstand und Flächenton |
| 8+ Schriftgrössen, zwei ähnliche Sans | 4–6 Grössen, eine Familie (+ evtl. Display) |
| #000 auf #FFF, neutrales #888 | Temperierte Grautöne |
| Graue Schrift auf farbigem Grund | Ton-in-Ton-Abstufung |
| Mehrere gleich laute Primärbuttons, Löschen laut | Eine Primäraktion, Zerstörerisches zurückhaltend |
| Zentrierter langer Text, Blocksatz | Linksbündig, 45–75 Zeichen |
| Volle Breite auf Desktop, 1200 px breite Formulare | Begrenzte Breiten |
| Versal-Labels ohne Laufweite, lockere Riesentitel | Gesperrte Versalien, enge Displays |
| Proportionalziffern, linksbündige Zahlen | Tabellenziffern, rechtsbündig |
| Gemischte Icon-Stile, hochskalierte Icons | Ein Set, optisch zentriert |
| Uneinheitliche Radien | Eine Radius-Familie, konzentrisch |
| Schwere schwarze Schatten aus verschiedenen Richtungen | Weiche, mehrschichtige Schatten, eine Lichtquelle |
| Markenfarbe auf grossen Flächen | Akzent sparsam |
| Text auf Fotos ohne Verlauf | Verlauf/Abdunkelung, mit schlechtestem Foto getestet |
| "..." , "-" als Strich, «Label: Wert» überall | Echte Typografie, selbsterklärende Werte |
| Nur der Idealzustand gestaltet | Leer, Lädt, Fehler, Extremwerte gestaltet |
| Fast-gleiche Kanten, optisch schiefe Icons | Wenige Ausrichtungslinien, optische Korrektur |
| Deko so laut wie Inhalt | Inhalt im Vordergrund |

---

# Teil 2 – Web-Frontend und Web-Verwaltung

## 2.1 Performance = UX (Core Web Vitals, 75. Perzentil echter Besuche)

| Metrik | Gut | Schlecht | Bedeutung |
|---|---|---|---|
| **LCP** | ≤ 2,5 s | > 4,0 s | Hauptinhalt sichtbar |
| **INP** | ≤ 200 ms | > 500 ms | Reaktion auf jede Interaktion |
| **CLS** | ≤ 0,1 | > 0,25 | nichts springt |

Seit März 2024 unverändert (INP ersetzte FID).
- **LCP:** Server-Rendering/Streaming, Bilder in passender Grösse (`srcset`, AVIF/WebP), wichtigstes Bild `fetchpriority="high"` und nicht lazy; Schriften mit preload und `font-display: swap`.
- **INP:** lange Tasks aufteilen, Arbeit aus Event-Handlern auslagern, sofort visuelles Feedback, grosse Listen virtualisieren, wenig Third-Party-Skripte.
- **CLS:** Bildgrössen/`aspect-ratio` setzen, Platz für Nachgeladenes reservieren, nichts oberhalb einschieben, Fallback-Schrift-Metriken angleichen.

## 2.2 Semantik, Tastatur, Fokus

- Native Elemente: `<button>` für Aktionen, `<a href>` für Navigation, `<label for>`, `<table>` mit `<th scope>`, `<dialog>` für Modale. ARIA nur, wo HTML nicht reicht.
- Landmarks (`header`, `nav`, `main`, `footer`), Skip-Link «Zum Inhalt springen», lückenlose Überschriften (eine `h1`), `lang="de-CH"`.
- **Alles per Tastatur**, logische Tab-Reihenfolge, keine Tastaturfallen. Modale fangen Fokus und geben ihn an den Auslöser zurück; `Esc` schliesst.
- **Fokus sichtbar und nicht verdeckt** (2.4.7, 2.4.11): Sticky Header/Banner dürfen Fokus nicht verdecken → `scroll-padding-top`. Fokusring ≥ 3 : 1 über `:focus-visible`, z. B. `outline: 2px solid; outline-offset: 2px`.
- Statusmeldungen über `role="status"`/`aria-live="polite"`, kritische `role="alert"`.
- Präferenzen: `prefers-reduced-motion` (Bewegung nur in `@media (prefers-reduced-motion: no-preference)`), `prefers-color-scheme`, `prefers-contrast`, `forced-colors`.
- Zoom nie sperren; 400 % Zoom ohne horizontales Scrollen bei 320 px.
- Autocomplete-Kombinationsfeld nach ARIA-APG-Combobox-Muster (Pfeiltasten + Enter, Screenreader-Ansage).

## 2.3 Moderne CSS-Werkzeuge (Stand 2026)

- **`oklch()` und `color-mix()`:** Baseline «weitgehend verfügbar» seit November 2025 – für Paletten und Zustände (Hover = `color-mix(in oklch, var(--primary), black 8%)`) verwenden.
- **Relative Farbsyntax** (`oklch(from var(--accent) calc(l - .1) c h)`): Baseline neu seit Sept. 2024, «weitgehend» ab ca. März 2027 – für eine Verwaltung mit aktuellen Browsern okay, sonst Fallback.
- Farbumfang: sRGB-Wert als Basis, Display-P3 per `@media (color-gamut: p3)` ergänzen.
- **View Transitions:** innerhalb eines Dokuments Baseline seit Oktober 2025 – für Listen↔Detail, Filterwechsel. Zwischen Dokumenten (`@view-transition { navigation: auto; }`) in Chromium und Safari, Firefox nicht unterstützt – nur als Progressive Enhancement.
- Container Queries für Komponenten, `:has()` für Zustände, `text-wrap: balance` für Überschriften, `hyphens: auto`.

## 2.4 Layout und Responsive

- Die Verwaltung wird vor allem am Desktop genutzt, aber auch mal mobil → beides ernst nehmen.
- Text max. ca. 65–75 Zeichen, Formulare max. 600–720 px.
- Breakpoints nach Inhalt, nicht nach Gerät.
- Touch-Ziele ≥ 44 px bei `pointer: coarse`. Hover nie als einziger Weg.

## 2.5 Navigation und Informationsarchitektur

- Nach Aufgaben strukturieren, nicht nach Datenbank. Mit Card Sorting/Tree Testing prüfen.
- **Sichtbare Navigation schlägt versteckte** [F, NN/g]: versteckte Navigation wurde am Desktop nur in 27 % der Fälle genutzt (sichtbar 48 %), senkte die Auffindbarkeit von Inhalten um über 20 % und machte Aufgaben spürbar langsamer. → Verwaltung: sichtbare Seitenleiste; Hamburger nur für Sekundäres, beschriftet «Menü».
- Aktuelle Position sichtbar (aktiver Menüpunkt, Titel, Breadcrumbs ab 3 Ebenen).
- **URL ist UI:** Filter, Sortierung, Tab, Seite, geöffneter Datensatz in der URL → teilbar, Zurück funktioniert, Neuladen verliert nichts.
- Keine ungefragten neuen Tabs. Befehlspalette (`Ctrl/Cmd + K`) für Geübte.

## 2.6 Verwaltung / Admin-Oberflächen

**Tabellen:**
- Spalten nach Wichtigkeit, Verwandtes nebeneinander; erste Spalte (Name) fixiert, Kopf sticky.
- Text links, Zahlen rechts mit Tabellenziffern, einheitliches Datum.
- Sortieren per Spaltenkopf (Pfeil + `aria-sort`); Filter über der Tabelle; aktive Filter als entfernbare Chips + «Alle zurücksetzen».
- Dichte-Option; Paginierung mit Gesamtzahl («1–50 von 312») für Arbeitslisten; Infinite Scroll nur für Feeds.
- Leer-, Lade-, Fehlerzustände; mobil als Kartenliste mit 2–3 Kernfeldern.

**Aktionen:**
- Häufigste Zeilenaktion direkt, Rest im «…»-Menü.
- **Massenaktionen:** Checkbox pro Zeile + «Alle auswählen», Aktionsleiste mit Anzahl («3 ausgewählt»).
- Inline-Bearbeitung nur für einfache Felder; sonst Detailseite oder Seitenpanel.
- **Rückgängig** statt Bestätigung, wo möglich. Echte Löschung: Dialog nennt das Objekt («‹Sommerlager 2027› endgültig löschen?»); bei sehr Folgenschwerem Namen eintippen lassen.
- Speichern: klare Rückmeldung, «Zuletzt gespeichert um 14:32», Warnung bei ungespeicherten Änderungen.
- Gleichzeitige Bearbeitung erkennen und verständlich lösen (6.8).
- Rechte: Unerlaubtes eher ausblenden; muss es sichtbar sein, deaktiviert mit Begründung.
- Verlauf (wer hat was wann geändert) für geteilte Verwaltung.
- **Zweiter Faktor/OTP:** erklären, `autocomplete="one-time-code"`, Einfügen erlauben, Ablaufzeit anzeigen, «Code erneut senden» mit Cooldown.
- **Einladungen verwalten:** Status (gesendet/geöffnet/angenommen/abgelaufen), erneut senden (6.1).

**Dashboards:** beantworten «Was muss ich heute tun?» (offene Aufgaben, anstehende Anlässe, fehlende Rückmeldungen, Warnungen), nicht nur hübsche Kennzahlen (1.11).

## 2.7 Web-Komponenten-Regeln

- **Modale** sparsam, nur kurze fokussierte Aufgaben; nie Modal auf Modal; immer sichtbares Schliessen (X) und `Esc`.
- **Toasts:** nur Unkritisches, ≥ 5 s, pausieren bei Hover/Fokus, nicht einziger Weg zu einer Aktion (ausser Rückgängig).
- **Tooltips** nur ergänzend, per Tastatur erreichbar.
- **Auswahl:** < 5 Optionen Radio/Segmented; > 15 mit Suche.
- **Datum:** Format sichtbar (TT.MM.JJJJ), Kalender *und* Tippen.
- Links im Fliesstext unterstrichen.

## 2.8 Checkliste Web

- [ ] LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 (mobil)
- [ ] Tastatur, Fokus sichtbar und nicht verdeckt, Skip-Link
- [ ] Kontraste in Hell *und* Dunkel, Graustufen-Test bestanden
- [ ] Labels sichtbar, Fehler beim Feld mit Lösung, Autocomplete
- [ ] Alle Zustände (0.6)
- [ ] Zustand in der URL, Zurück korrekt
- [ ] Tabellen: sticky, sortierbar, Massenaktionen, mobile Alternative
- [ ] Rückgängig vs. Dialog richtig eingesetzt
- [ ] 200 %/400 % Zoom, 320 px
- [ ] Reduzierte Bewegung, Farbschema
- [ ] Werte aus Tokens, Schweizer Formate, `lang="de-CH"`

---

# Teil 3 – Android (Jetpack Compose, Material 3 Expressive)

## 3.1 Stand der Plattform (November 2026)

- **Android 17** ist seit 16. Juni 2026 stabil (Pixel zuerst).
- **Google Play:** Seit 31. August 2026 müssen neue Apps und Updates **API 36** anzielen. Für API 37 ist noch keine Frist publiziert; nach bisherigem Muster ca. Ende August 2027 *(Annahme)*.
- **Compose Material3:** Stabil ist **1.4.0 – sie enthält keine Expressive-APIs** (alles mit `@ExperimentalMaterial3ExpressiveApi` wurde für den stabilen Release entfernt, auch `MaterialExpressiveTheme`). Expressive gibt es auf der **1.5.0-Linie** (rc01 am 4. November 2026; stabil vermutlich in Kürze). Entscheid: 1.5.0 verwenden, sobald stabil; bis dahin rc bewusst einsetzen und Opt-ins erwarten. API-Namen änderten sich in den Alphas (z. B. `SplitButtonLayout` → `SplitButton`, `LocalMotionScheme` → `MaterialTheme.motionScheme`, `TonalToggleButton` → `FilledTonalToggleButton`, `RichTimePickerDialog` → `VibrantTimePickerDialog`; zustandslose `Slider`/`RangeSlider`-Überladungen veraltet) – gegen die Release Notes prüfen.

## 3.2 Designsystem: Material 3 Expressive

- Ausdruck über **Form** (Morphing), **Bewegung** (Federn, 1.9), **Typografie** (betonte Stile), **Farbe** – immer mit Zweck: Wichtiges hervorheben, Zustand erklären.
- Immer über `MaterialTheme`-Rollen (`colorScheme.*`, `typography.*`, `shapes.*`, `motionScheme`), nie Rohwerte im UI-Code.
- **Dynamic Color** ist Android-typisch. Bei starker eigener Marke bewusst entscheiden; Kompromiss: Marken-Theme als Standard, Dynamic Color optional in den Einstellungen.

**Farbrollen und Töne (Tonwert der Palette):**

| Rolle | Hell | Dunkel |
|---|---|---|
| primary / onPrimary | 40 / 100 | 80 / 20 |
| primaryContainer / onPrimaryContainer | 90 / 10 | 30 / 90 |
| secondary, tertiary | gleiches Muster | gleiches Muster |
| error / onError | 40 / 100 | 80 / 20 |
| surface | N98 | N6 |
| surfaceContainerLowest → Highest | N100 · 96 · 94 · 92 · 90 | N4 · 10 · 12 · 17 · 22 |
| onSurface / onSurfaceVariant | N10 / NV30 | N90 / NV80 |
| outline / outlineVariant | NV50 / NV80 | NV60 / NV30 |

→ Eigene Marken-Themes genauso aufbauen (z. B. mit dem Material Theme Builder aus einer Quellfarbe) und anschliessend Kontraste prüfen, besonders `onSurfaceVariant` auf dunklen Containern.

**Typografie-Skala (sp, Grösse/Zeilenhöhe):**

| Stil | L | M | S |
|---|---|---|---|
| Display (400) | 57/64 | 45/52 | 36/44 |
| Headline (400) | 32/40 | 28/36 | 24/32 |
| Title | 22/28 | 16/24 (500) | 14/20 (500) |
| Body (400) | 16/24 | 14/20 | 12/16 |
| Label (500) | 14/20 | 12/16 | 11/16 |

Expressive ergänzt **betonte Varianten** (z. B. `displayLargeEmphasized`) mit gleicher Grösse, aber einem Gewichtsschritt mehr – für Hervorhebung statt grösserer Schrift *(Gewichte unbestätigt)*. Eigene Schriften über `Typography(...)` einsetzen; Display-/Markenschrift nur für Display/Headline, Body/Label in einer gut lesbaren Text-Sans.

**Komponenten (Expressive, Compose-Namen):**
- **Navigation:** `ShortNavigationBar` (flexible Navigationsleiste, kürzer, in mittleren Fenstern Label neben Icon); `WideNavigationRail` (eingeklappt/ausgeklappt, ersetzt den Navigation Drawer auf grösseren Fenstern); `NavigationSuiteScaffold` wechselt automatisch.
- **Toolbars:** `FlexibleBottomAppBar` (angedockte Toolbar; M3 Expressive empfiehlt sie statt der klassischen Bottom App Bar, die in Compose aber stabil bleibt); `HorizontalFloatingToolbar`/`VerticalFloatingToolbar` für kontextuelle Seitenaktionen, kombinierbar mit FAB. **Nav Bar und Toolbar nicht gleichzeitig unten** – Nav Bar auf Hauptseiten, Toolbar auf Unterseiten.
- **Aktionen:** `ButtonGroup`, `SplitButton`, `FloatingActionButtonMenu`, Toggle-Buttons, Grössen XS–XL.
- **Feedback:** `LoadingIndicator`/`ContainedLoadingIndicator` (für kurze Wartezeiten statt Spinner), wellenförmige Fortschrittsanzeigen.
- **App Bars:** `MediumFlexibleTopAppBar`, `LargeFlexibleTopAppBar`; neue Listenelemente (Expressive-Listen) und `SearchBar` mit `SearchBarState`.
- **Eigene schwebende Navigation (Dock):** Eine offizielle schwebende Nav Bar gibt es nicht. Ein eigenes Dock muss sich **exakt wie eine Navigationsleiste** verhalten: 3–5 Ziele, Icon + Label, aktiver Indikator (gefülltes Icon), Insets korrekt, TalkBack-Semantik (`Role.Tab`, `selected`), Inhalt nicht verdeckt (unteres Content-Padding = Dock-Höhe + Inset + Abstand), Trefferflächen ≥ 48 dp, Kontrast des Docks zum darunterliegenden Inhalt in allen Scrollzuständen.

## 3.3 Navigation und Zurück

- Nav Bar (compact, 3–5 Ziele) → Navigation Rail (ab medium).
- Zustand pro Tab erhalten (eigener Back-Stack, Scrollposition); erneutes Tippen auf aktiven Tab → nach oben/zum Anfang.
- **Predictive Back** (für targetSdk 36+ standardmässig aktiv): `onBackPressed()` wird nicht mehr aufgerufen (Opt-out `android:enableOnBackInvokedCallback="false"` nur als Übergang). Zurück nur über `BackHandler`/`PredictiveBackHandler`/`OnBackPressedDispatcher`. Reihenfolge: Sheet/Dialog/Suche schliessen → eine Ebene hoch → Start-Tab → App verlassen.
- Top App Bar: Titel = wo bin ich; Zurück-Pfeil auf Unterseiten; max. 2–3 Aktionen, Rest im Überlaufmenü.
- FAB nur für *die* Hauptaktion eines Screens.
- Overlays: nie gestapelt, immer explizites Schliessen, System-Zurück schliesst sie (NN/g: versehentliches Wegwischen verliert Fortschritt).

## 3.4 Edge-to-Edge, Insets, adaptive Layouts

- Edge-to-Edge ist ab API 35 erzwungen, ab API 36 ohne Opt-out. Inhalte laufen hinter System-Leisten; Bedienelemente und Text mit `WindowInsets` (`safeDrawing`, `systemBars`, `ime`, `displayCutout`) einrücken; `Scaffold`-`innerPadding` immer anwenden; Listen mit `contentPadding`; `imePadding()` für Formulare.
- **Grosse Bildschirme:** Ab API 37 (Android 17) ignoriert das System auf Displays ≥ 600 dp kleinster Breite Ausrichtungs-, Grössen- und Seitenverhältnis-Sperren – ohne Opt-out. Auch eine Handy-App muss Hoch/Quer, Foldables, Fenstermodus und Rotation ohne Zustandsverlust können.
- **Fenstergrössenklassen (Breite):** compact < 600 · medium 600–839 · expanded 840–1199 · large 1200–1599 · extra-large ≥ 1600 dp. Höhe: compact < 480 · medium 480–899 · expanded ≥ 900. Klassen beschreiben das *Fenster*, nie für `isTablet`-Abfragen missbrauchen.
- **Kanonische Layouts:** Liste-Detail (`ListDetailPaneScaffold`), Supporting Pane, Feed. Inhalte nicht über die volle Breite strecken (`widthIn(max = …)`), lange Screens scrollbar, damit Buttons im Querformat erreichbar bleiben.

## 3.5 Interaktion, Ergonomie, Haptik

- Trefferflächen ≥ 48 dp (`minimumInteractiveComponentSize()` für eigene klickbare Elemente).
- Primäraktionen in der Daumenzone; Seltenes oben.
- Schrift und Zeilenhöhe in **sp**; bis 200 % testen (nicht-lineare Skalierung seit Android 14: grosse Schrift wächst weniger).
- **Haptik** (`HapticFeedbackType`): `Confirm`/`Reject` (Ergebnis), `LongPress`, `ToggleOn`/`ToggleOff`, `SegmentTick` (Schritte, Listenelemente), `GestureThresholdActivate` (z. B. Pull-to-Refresh-Schwelle), `TextHandleMove`. Keine langen Vibrationen.
- Wischgesten immer mit sichtbarer Alternative und Rückgängig; `PullToRefreshBox` für Serverlisten; Snackbar + «Rückgängig»; Bottom Sheets schliessen per Ziehen *und* Zurück.

## 3.6 Barrierefreiheit (TalkBack)

- Icon-only: `contentDescription` beschreibt die Aktion («Anlass löschen»); dekorativ `null`.
- Zeilen zusammenfassen: `Modifier.semantics(mergeDescendants = true)` bzw. `clearAndSetSemantics` mit eigenem Text.
- Zustände: `selected`, `toggleableState`, `stateDescription`, `Role`; Überschriften `heading()`; Live-Änderungen `liveRegion`; eigene Gesten als `customActions`.
- Prüfen: Accessibility Scanner, Compose UI Check, echter TalkBack-Durchlauf, hoher Kontrast.

## 3.7 Systemintegration (inkl. Android 17)

- **Mitteilungen:** Berechtigung (ab Android 13) erst nach erklärtem Nutzen; Kanäle pro Art (6.2); Deep Link mit korrektem Back-Stack. Android 17 bietet semantische Farben für Live-Update-Mitteilungen (Grün sicher, Orange Vorsicht, Rot Gefahr, Blau Info).
- **SMS-Codes:** Ab API 37 werden OTPs aus SMS für andere Apps 3 h zurückgehalten → SMS Retriever oder User Consent API verwenden (oder besser Passkeys/E-Mail-Link).
- **Kontakte:** System-Kontaktauswahl statt `READ_CONTACTS`; **Fotos:** Photo Picker statt Speicherberechtigung.
- Splash Screen API; Widgets/Shortcuts für die häufigste Aufgabe (Widgets: Bitmap-Speicherlimit ab API 37 beachten).
- Offline-first mit lokaler DB + WorkManager-Sync (6.8).
- Vorbereitung Android 18: URI-Rechte explizit vergeben – `ACTION_SEND`/`ACTION_SEND_MULTIPLE` mit `FLAG_GRANT_READ_URI_PERMISSION`, `ACTION_IMAGE_CAPTURE` mit Lese- *und* Schreibrecht (`FLAG_GRANT_WRITE_URI_PERMISSION`).

## 3.8 Checkliste Android

- [ ] Material3-Version bewusst gewählt (1.5.x für Expressive), Rollen statt Rohwerte
- [ ] Hell/Dunkel/Dynamic-Color-Entscheid, Kontraste gemessen
- [ ] Edge-to-Edge mit Insets (Status, Gesten, Tastatur, Cutout)
- [ ] Predictive Back, kein `onBackPressed`
- [ ] Nav Bar bzw. Dock mit identischem Verhalten, Zustand pro Tab
- [ ] Nicht Nav Bar + Toolbar gleichzeitig unten
- [ ] Hoch/Quer, Foldable, Fenstermodus, Rotation ohne Zustandsverlust
- [ ] 48 dp, sp, 200 % Schrift
- [ ] TalkBack vollständig
- [ ] Berechtigungen kontextuell, Mitteilungskanäle, OTP via Retriever
- [ ] Alle Zustände inkl. offline

---

# Teil 4 – iOS (SwiftUI, HIG, Liquid Glass)

## 4.1 Stand der Plattform (November 2026)

- **iOS 27** ist seit 14. September 2026 verfügbar (gleiche Geräte wie iOS 26: ab iPhone 11 und SE 2. Gen.). Neu im Sortiment: **iPhone Duo** (faltbar).
- **Liquid Glass ist Pflicht** für Apps, die mit dem iOS-27-SDK (Xcode 27) gebaut werden: Der Schlüssel `UIDesignRequiresCompatibility` wird dann ignoriert. Mit Xcode 26 gebaute Apps behalten ihn vorerst – aber **ab April 2027 verlangt der App Store das iOS-27-SDK** (Apple, 9. Sept. 2026). Damit endet der Aufschub praktisch im April 2027.
- **UIScene-Lebenszyklus** ist mit dem iOS-27-SDK Pflicht (sonst startet die App nicht).
- **iPhone-Apps sind mit dem iOS-27-SDK grössenveränderbar:** jede Kombination von Size Classes ist möglich. Kein `UIScreen.main`, keine Idiom-/Orientierungsabfragen, keine fixen Bildschirmgrössen. Auf dem iPhone Duo: mit iOS-26-SDK zentriert auf dem Innendisplay, mit iOS-27-SDK grösstenteils füllend, ab iOS-27.1-SDK randlos mit möglicherweise *vertikalen* Tab Bars und Toolbars. Laut Sekundärquelle verlangt Apple ab April 2027 auch Duo-Screenshots für Einreichungen. Testen mit den Resize-Griffen in Xcode-27-Previews und dem Duo-Simulator.

## 4.2 Liquid Glass richtig einsetzen

- Glas ist ein Material für die **Funktionsebene** (Tab Bar, Navigation Bar, Toolbars, schwebende Controls, Sheets). **Kein Glas im Inhalt** (Zeilen, Karten), kein Glas auf Glas.
- **iOS 27 Glas-Regler** (Einstellungen): Nutzende stellen von «ultra klar» bis «voll getönt». Systemkomponenten und `.glassEffect()` reagieren automatisch, ohne Code-Änderung. → UI in **beiden Extremen** sowie mit «Transparenz reduzieren» und «Kontrast erhöhen» testen; Lesbarkeit nie vom Glas abhängig machen.
- Varianten: `Glass.regular` (Standard); `Glass.clear` nur über reichen Medien (Fotos/Video), bei hellem Inhalt mit ca. 35 % dunkler Abdunkelungsschicht.
- Systemkomponenten verwenden; eigene Glas-Elemente sparsam mit `.glassEffect()` in `GlassEffectContainer`.
- **Keine eigenen opaken Leistenhintergründe**, keine eingefärbten Leisten. Statt fester Hintergründe hinter Controls: Scroll-Edge-Effekt und `backgroundExtensionEffect()`.
- **Farbe auf Glas:** Glas hat keine eigene Farbe. Tönung sparsam, nur für Betonung (z. B. die Primäraktion); nicht mehrere Controls in einer Leiste tönen; den Hintergrund des Controls färben, nicht das Symbol.
- NN/g kritisierte Liquid Glass in iOS 26 (Okt. 2025): geringe Lesbarkeit über unruhigem Inhalt, konkurrierende schwebende Controls, ablenkende Animationen, kleinere Trefferflächen, Zurück-Button ohne Label. → Bei eigenen Screens genau diese Punkte prüfen.

## 4.3 Navigation und Struktur

- **Tab Bar** (`TabView`) für Hauptbereiche, ca. 3–5 Tabs; nur Navigation, nie Aktionen; immer sichtbar (ausser unter Modalen); Ein-Wort-Labels; gefüllte SF Symbols; Badges nur für Wichtiges; «Mehr»-Überlauf vermeiden.
- Seit iOS 26 schwebende Kapsel; **Such-Tab** mit `Tab(role: .search)` am Ende; Minimieren beim Scrollen mit `.tabBarMinimizeBehavior(.onScrollDown)`, optional Bottom Accessory. **Neu in iOS 27:** `Tab(role: .prominent)` für einen hervorgehobenen Tab am Ende.
- Zustand und Stapel pro Tab erhalten; erneutes Tippen → Wurzel/nach oben.
- `NavigationStack`: grosser Titel auf Hauptseiten, Inline auf Unterseiten; Titel in normaler Schreibung, kurz (< 15 Zeichen in Toolbars).
- **Wischen vom linken Rand = Zurück** darf nie brechen. Standard-Zurück- und Schliessen-Symbole verwenden.
- **Toolbars:** max. 3 Gruppen; Navigation getrennt von Fertig/Schliessen/Sichern; randlose SF Symbols statt Text bevorzugen; **eine** Primäraktion rechts mit `.buttonStyle(.glassProminent)` bzw. `ToolbarItem(placement: .confirmationAction)`. iOS 27: `.visibilityPriority(.high)`, `ToolbarOverflowMenu`, `.toolbarMinimizeBehavior(.onScrollDown, for: .navigationBar)`.
- **Sheets** für abgeschlossene Teilaufgaben: Abbrechen links, Sichern/Fertig rechts; bei ungespeicherten Änderungen `.interactiveDismissDisabled()` + Rückfrage; Detents (`.medium`, `.large`).
- **Alert** nur für Kritisches; **Confirmation Dialog** für Auswahl mit zerstörerischer Option (`role: .destructive`); iOS 27 erlaubt Item-Bindings für beide.
- **Kontextmenüs** für Sekundäres, immer zusätzlich zu einem sichtbaren Weg. **Swipe Actions:** Löschen trailing rot, häufige Aktion leading. iOS 27: `reorderable()` für Umsortieren – mit Tap-Alternative (WCAG 2.5.7).

## 4.4 Typografie und Layout

**Dynamic-Type-Stile (Standardgrösse «Large», pt Grösse/Zeilenabstand):**

| Stil | Wert | Gewicht |
|---|---|---|
| Large Title | 34/41 | Regular (betont: Bold) |
| Title 1 | 28/34 | Regular (Bold) |
| Title 2 | 22/28 | Regular (Bold) |
| Title 3 | 20/25 | Regular (Semibold) |
| Headline | 17/22 | Semibold |
| Body | 17/22 | Regular (Semibold) |
| Callout | 16/21 | Regular |
| Subheadline | 15/20 | Regular |
| Footnote | 13/18 | Regular |
| Caption 1 / 2 | 12/16 · 11/13 | Regular |

Standard 17 pt, Minimum 11 pt. Body reicht von 14 pt (xSmall) bis 23 pt (xxxLarge) und in den Bedienungshilfe-Grössen bis **53 pt (AX5)**.

- **Dynamic Type ist Pflicht:** Textstile statt fixer Grössen; eigene Schriften mit `Font.custom(_:size:relativeTo:)`. Layout ab Accessibility-Grössen von horizontal auf vertikal (`ViewThatFits`, `dynamicTypeSize`), umbrechen statt abschneiden.
- **SF Pro** nutzt dynamische optische Grössen (Text/Display fliessend) – keine manuelle Laufweite. **Display-Schrift (z. B. Archivo) nur für Titel**, mit `relativeTo: .largeTitle/.title` an Dynamic Type gekoppelt.
- **SF Symbols** (Version 8 mit 7000+ Symbolen): Rendering-Modi monochrom, hierarchisch, Palette, mehrfarbig; variable Werte; Gewicht und Grösse folgen der Schrift.
- **Layout:** Safe Areas und Layout Guides, Size Classes (nie Idiom/Orientierung), gleiche Funktionalität in allen Grössen; Systemränder statt fixer Werte; `List`/`Form` mit Systemstilen (`.insetGrouped`).
- Trefferflächen ≥ 44 × 44 pt (`.contentShape(Rectangle())`, `.frame(minWidth: 44, minHeight: 44)`).
- **Farben:** semantische Systemfarben (`label`, `secondaryLabel`, `tertiaryLabel`, `systemBackground`, `secondarySystemBackground`, `systemGroupedBackground` …) nicht zweckentfremden (z. B. `separator` nicht als Textfarbe). Eigene Farben im Asset-Katalog mit **4 Varianten:** Hell, Dunkel, Hell + erhöhter Kontrast, Dunkel + erhöhter Kontrast. Im Dark Mode gibt es Basis- und erhöhte Hintergründe (Sheets/Popover automatisch erhöht) – Systemhintergründe verwenden.
- **Ecken:** konzentrisch zum Container (1.7), kontinuierliche Ecken.

## 4.5 Interaktion, Feedback, Haptik

- `.sensoryFeedback(...)`: `.success`/`.warning`/`.error` für Ergebnisse, `.selection` beim Durchlaufen von Werten, `.impact(weight:)` passend zum Gewicht, `.increase`/`.decrease`. Standard-Controls haben schon Haptik.
- Laden: `ProgressView`, Skeletons mit `.redacted(reason: .placeholder)`; Pull-to-Refresh `.refreshable`; Suche `.searchable` mit Vorschlägen und Scopes.
- Formulare: `Form`/`Section`, `keyboardType`, `textContentType` (`.oneTimeCode`, `.emailAddress`, `.telephoneNumber`, `.username`, `.password`), `@FocusState` für «Weiter» und Fokus aufs Fehlerfeld.
- Animationen mit Federn (`.smooth` als Default), `matchedGeometryEffect`/`navigationTransition(.zoom)` wo sie Herkunft erklären; `accessibilityReduceMotion` respektieren; Bewegung bei häufigen Interaktionen vermeiden.

## 4.6 Barrierefreiheit (VoiceOver)

- `.accessibilityLabel(...)` für Icons, `.accessibilityHidden(true)` für Dekoratives.
- `.accessibilityElement(children: .combine)` für Zeilen; `.accessibilityValue`; Traits `.isHeader`, `.isSelected`, `.isButton`.
- `.accessibilityAction(named:)` für eigene Gesten; `.accessibilitySortPriority` bei abweichender Lesereihenfolge.
- Prüfen: Accessibility Inspector, VoiceOver, AX5, erhöhter Kontrast, Transparenz reduzieren, Glasregler.

## 4.7 Systemintegration

- Berechtigungen nach eigenem Erklär-Screen, `NS…UsageDescription` konkret und auf Deutsch.
- Mitteilungen: Kategorien mit Aktionen, Deep Links; Unterbrechungsstufen passiv/aktiv/**zeitkritisch** (nur echte Kurzfriständerungen); kritische Hinweise nicht beantragen. Provisorische Berechtigung für stille Zustellung ohne Abfrage.
- Login: Passkeys, Passwort-Autofill, Sign in with Apple (6.1).
- Widgets, Live Activities, App Intents (Spotlight/Siri) für die häufigste Aufgabe.
- App-Icon im Icon Composer mit Ebenen (hell, dunkel, getönt, klar).

## 4.8 Checkliste iOS

- [ ] Gebaut/getestet mit iOS-27-SDK: Liquid Glass, UIScene, grössenveränderbar (Duo, Size Classes)
- [ ] Systemkomponenten statt Nachbauten, kein Glas im Inhalt, keine opaken Leisten
- [ ] Glasregler klar/getönt, Transparenz reduzieren, Kontrast erhöhen
- [ ] Tab Bar nur Navigation, Such-Tab, Toolbars max. 3 Gruppen, eine Primäraktion
- [ ] Wischen-zurück überall
- [ ] Dynamic Type bis AX5, SF Pro im Text, Display-Schrift nur Titel
- [ ] 44 pt, Safe Areas, Farben mit 4 Varianten
- [ ] VoiceOver vollständig
- [ ] Sheets mit Abbrechen/Sichern und Datenverlust-Schutz
- [ ] Berechtigungen mit Vorab-Erklärung, Autofill-Typen

---

# Teil 5 – Plattformübergreifend: ein System, native Bedienung

## 5.1 Design-Tokens als gemeinsame Quelle

- **Standard:** W3C Design Tokens Community Group, **Format 2025.10** (erste stabile Version, Oktober 2025; Community-Group-Bericht, kein W3C-Standard). JSON (`.tokens.json`) mit `$value`, `$type`, `$description`, Aliasen `{color.primary}`; Farbmodul unterstützt u. a. `oklch`, `display-p3`; **Resolver-Modul** für Themes (Modifier `theme: light | dark | lightHighContrast | darkHighContrast`).
- **Drei Ebenen:**
  1. **Referenz/Primitiv** – rohe Werte ohne Bedeutung (`ref.palette.blue40`, `ref.space.16`)
  2. **System/Semantik** – Bedeutung, je Theme anders verknüpft (`sys.color.primary` → hell `blue40`, dunkel `blue80`; `sys.shape.corner.medium`; `sys.motion.spring.fast`)
  3. **Komponente** – (`comp.button.primary.container` → `sys.color.primary`)
  Themes ändern nur die System-Ebene.
- **Benennung nach Zweck, nicht Aussehen:** `color.surface.container.high`, `button.primary.bg.hover` – nie `blue-500` auf der Semantik-Ebene. Reihenfolge: Kategorie → Eigenschaft → Variante → Zustand.
- **Eine Quelle, drei Ausgaben** (z. B. Style Dictionary oder Terrazzo): CSS Custom Properties (oklch) · Compose `ColorScheme`/`Typography`/`Shapes` · Xcode-Asset-Katalog mit 4 Erscheinungen + Swift-Konstanten. Plattform-Semantik respektieren (auf iOS auf `label`-Hierarchie abbilden, Systemfarben nicht überschreiben).
- **Token-Kategorien:** Farbe, Typografie, Abstand, Radius, Elevation/Schatten, Bewegung (Dauer, Easing, Federn), Deckkraft der Zustände, Breakpoints, Z-Index.

## 5.2 Komponenten dokumentieren

Pro Komponente: Anatomie (nummerierte Teile) · Varianten und Grössen · **Zustandsmatrix** (Variante × Standard/Hover/Fokus/Gedrückt/Deaktiviert/Lädt/Ausgewählt/Fehler, je mit Token) · Verhalten und Bewegung · Barrierefreiheit (Rolle, Label, Fokusreihenfolge, Trefferfläche) · Inhaltsregeln (Textlänge, Schreibweise) · Do/Don't mit Beispielen.

## 5.3 Gleiche Entscheide, native Muster

| Thema | Web | Android | iOS |
|---|---|---|---|
| Hauptnavigation | Sichtbare Seitenleiste; mobil Bottom-Nav | ShortNavigationBar → WideNavigationRail | Tab Bar (Kapsel), Such-Tab |
| Zurück | Browser + Breadcrumbs | System-Zurück (Predictive) | Pfeil oben links + Randwisch |
| Hauptaktion | Primärbutton | FAB oder Toolbar | Toolbar `.glassProminent` oder im Inhalt |
| Kurze Rückmeldung | Toast (`aria-live`) | Snackbar + Rückgängig | Inline-Bestätigung + Haptik |
| Mehr Optionen | «…»-Menü | Überlaufmenü ⋮ | `Menu` «…», Kontextmenü |
| Wenige Optionen | Radio/Segmented | Segmented Button/Chips | Segmented Picker |
| Datum | Eingabe + Kalender | Material DatePicker | `DatePicker` |
| Löschen in Listen | Zeilenaktion + Rückgängig | Menü/Swipe + Snackbar | Swipe Action |
| Schrift | Systemstack/Webfont | Theme-Schrift in sp | SF Pro + Dynamic Type |
| Icons | ein SVG-Set | Material Symbols | SF Symbols |
| Ecken | border-radius | M3-Skala, kreisförmig | kontinuierlich, konzentrisch |
| Bewegung | CSS/View Transitions, ease-out | M3-Federn | SwiftUI-Federn |
| Trefferfläche | 24 px (AA), Touch 44 px | 48 dp | 44 pt |

**Gemeinsam:** Begriffe (Glossar), Reihenfolge der Hauptbereiche, Inhalte, Rechte, Fehlertexte, Tonalität, Markenfarben als Akzent, Tokens.
**Plattformspezifisch:** Navigationselemente, Gesten, Dialogformen, Systemschriften, Icons, Bewegungscharakter.

---

# Teil 6 – Muster für zentrale Abläufe

## 6.1 Onboarding, Login, Einladungen

- **Keine Tutorial-Karussells** zu Beginn (werden durchgewischt und vergessen). Falls nötig: max. 3 Screens, überspringbar, einmalig.
- **Hilfe am Ort des Bedarfs** («Pull»): Leerzustände mit Erklärung, Inline-Tipps, «i»-Hinweise. Coach Marks höchstens einzeln, am Element, wegklickbar, nie wieder.
- **Rollenbasiert starten:** Leitende → nächster Anlass + Anwesenheit; Eltern → Kind, nächster Anlass, was mitnehmen; Verwaltung → Einrichtungs-Checkliste.
- **Spät registrieren:** Öffentliches (Programm) ohne Konto zeigen, wo möglich.
- **Einladungsbasiert:** Einladung sagt *wer* einlädt, *wohin/welche Rolle*, *was als Nächstes passiert*. E-Mail vorausgefüllt, Rolle sichtbar, ein Tap zum Annehmen, danach Anmeldemethode einrichten. Ablaufende Links (z. B. 7–14 Tage) mit Zustand «Link abgelaufen – neuen anfordern».
- **Eltern ↔ Kind verknüpfen:** eigener, expliziter Ablauf; zeigen, wer die Daten des Kindes sieht.
- **Mehrere Rollen** (Leiter und Elternteil): ein Konto, klarer Rollen-/Kontextwechsel.
- **Passkeys** (FIDO-Richtlinien): konsequent «Passkey» nennen und einfach erklären («Anmelden mit Fingerabdruck, Gesicht oder Bildschirmsperre – ohne Passwort»). Anbieten nach erfolgreicher Anmeldung, nach Passwort-Reset und in den Einstellungen – erst Nutzen, dann Systemdialog, «Später» erlauben, nie erzwingen. Anmeldung per Autofill (`autocomplete="username webauthn"`) + Button «Mit Passkey anmelden». Verwaltung in den Einstellungen (Gerät/Anbieter, erstellt, zuletzt benutzt, löschen). E-Mail als Wiederherstellungsweg.

## 6.2 Mitteilungen (Push)

- **Berechtigung im Kontext** fragen, nie beim ersten Start; eigene Vorab-Erklärung; bei «Nein» Systemdialog nicht auslösen (iOS fragt nur einmal).
- **Kategorien/Kanäle**, je einzeln abschaltbar und in den App-Einstellungen gespiegelt (Push/E-Mail/keine), z. B.: Programmänderungen & Absagen (hoch) · Erinnerungen · Nachrichten von Leitenden · Verwaltung/Abrechnung · News (tief).
- **Jede Mitteilung:** relevant für *diese* Person, rechtzeitig, mit Handlung. Weniges bündeln (Wochenübersicht), Updates zum selben Objekt ersetzen statt stapeln, nicht doppelt per E-Mail senden, wenn in der App gelesen. Zu viele Mitteilungen sind der Hauptgrund fürs Abschalten.
- **Ruhezeiten:** Unwichtiges nicht zwischen ca. 21:00 und 07:00 (bei Kindern strenger); Zustellung je Empfänger-Zeitzone.
- **Text:** Titel nennt das Objekt («Waldweihnacht Sa 14.12.»), Text sagt was sich geändert hat und was zu tun ist («Treffpunkt neu: Bahnhof Stäfa, 13.30 Uhr. Bitte bestätigen.»). Wichtigstes zuerst (1–2 Zeilen sichtbar). Aktionen (Zusagen/Absagen). Tap öffnet genau das Objekt. **Keine sensiblen Daten auf dem Sperrbildschirm** (Gesundheit, Kindernamen + Ort). Kein Clickbait, keine Versalien.

## 6.3 Suche und Filter

- Wo Suche zentral ist: sichtbares Suchfeld (nicht nur Lupe); Suchbegriff bleibt auf der Ergebnisseite stehen.
- Tolerant: Tippfehler, ä/ae, ss, Spitznamen; über Typen hinweg (Personen, Anlässe, Gruppen) mit Typ-Kennzeichnung.
- **Autovervollständigung:** ca. 4–8 Vorschläge mobil, max. ca. 10 Desktop, nicht getippter Teil hervorgehoben, Tastatur und Screenreader (Combobox).
- **Null Treffer nie als Sackgasse:** Begriff zeigen, Korrektur vorschlagen, aktive Filter zurücksetzen anbieten («3 Filter aktiv – zurücksetzen?»), Bereich erweitern, ggf. «Person ‹Muster› neu erfassen».
- **Filter:** Anzahl Treffer pro Wert; Werte mit 0 Treffern ausblenden/deaktivieren; aktive Filter als Chips + «Alle zurücksetzen»; Desktop live anwenden, mobil im Sheet mit «23 Ergebnisse anzeigen» (live aktualisiert); Filter beim Hin- und Zurücknavigieren erhalten.

## 6.4 Anmeldung zu Anlässen und Lagern

- **Anlass-Karte:** Datum, Zeit, Treffpunkt *und* Endpunkt/Abholort, Kosten, Mitnehmen, Anmeldeschluss, freie Plätze (nur wenn wahr und live), Kontakt.
- **Mehrere Kinder** in einem Ablauf; Bekanntes vorausgefüllt zum Bestätigen.
- Gesundheits-/Allergiefragen nur bei Anlässen, die sie brauchen (Lager), mit expliziter Einwilligung (7.2).
- **Klare Zustände:** angemeldet · Warteliste (Platz X) · abgemeldet · Anmeldeschluss vorbei. Nachrücken automatisch mit Mitteilung und befristeter Bestätigung.
- **Bestätigung:** Screen + E-Mail mit Zusammenfassung, Kalenderdatei und Link zum Ändern/Abmelden.
- **Abmelden so einfach wie Anmelden**, mit Frist und Folgen.

## 6.5 Zu-/Absagen (RSVP) und wiederkehrende Aktivitäten

- Ja / Nein (/ Vielleicht nur mit Frist – «Vielleicht» schwächt die Planung). Optionaler Grund bei «Nein».
- Leitende sehen Live-Zählung und **wer noch nicht geantwortet hat**; Erinnerung per Tap nur an diese – mit Cooldown gegen Spam.
- **Wöchentliche Aktivitäten** (z. B. Jungschar jeden Samstag): Standard «dabei» mit Abmelden statt wöchentlicher Zusage – spart Mitteilungen.

## 6.6 Kalender (ICS)

- Pro Anlass «Zum Kalender hinzufügen» (.ics nach RFC 5545 + Google-/Outlook-Links).
- Pro Gruppe abonnierbarer Feed (webcal/https), der sich aktualisiert: stabile UIDs (Änderungen aktualisieren statt duplizieren), Absagen als `STATUS:CANCELLED`, Zeitzone Europe/Zurich, Ort mit Adresse, Link zurück in die App.
- Geheime Feed-URLs: «Link neu erzeugen» anbieten; keine Kindernamen in öffentlichen Feeds.
- **Erinnerungen:** wöchentliche Aktivität am Vortag; Lager 7 Tage und 1 Tag vorher; Anmeldeschluss 2–3 Tage vorher; einstellbar; Erinnerung enthält Zeit, Ort, Mitnehmen.

## 6.7 Zahlung (TWINT u. a.)

- Betrag und Leistung *vor* dem Zahlungsschritt zeigen.
- **Mobil:** Wechsel in die TWINT-App und zurück; ohne TWINT-App: Hinweis + QR-Code fürs Zweitgerät. **Desktop:** QR-Code (ca. 200–300 px, pro Transaktion neu) + manueller Code.
- «Zahlung wird bestätigt …» bis der Server bestätigt – nie vorher Erfolg anzeigen. Beleg/Quittung.
- Alternative anbieten (Überweisung/QR-Rechnung). Rabatte/Solidaritätsbeiträge diskret und ohne Stigma.
- TWINT-Marken- und QR-Vorgaben des Anbieters beachten.

## 6.8 Offline-first und Synchronisation

- Lokaler Speicher als Quelle der UI; lokal schreiben, im Hintergrund synchronisieren.
- **Status pro Element:** ausstehend (Uhr/hohles Icon) · synchronisiert (nichts oder dezentes Häkchen) · fehlgeschlagen (rot + «Erneut versuchen»).
- **Global:** dezenter Offline-Hinweis («Offline – Änderungen werden später gesendet»), «Zuletzt synchronisiert 14:32», Anzahl wartender Änderungen; automatische Wiederholung mit Backoff.
- Lesen offline nie blockieren; nur wirklich serverpflichtige Aktionen deaktivieren – mit Begründung.
- **Konflikte vermeiden:** feldweise zusammenführen, Anwesenheit/Kommentare als Anhänge-Log; «Letzter gewinnt» nur bei unkritischen Einzelfeldern.
- **Echte Konflikte** (Gesundheitsnotizen, Zeiten): beide Versionen mit Autor und Zeit nebeneinander, «Meine behalten / Andere übernehmen / Zusammenführen», nie still verwerfen, im Verlauf protokollieren.

## 6.9 Nachrichten und Gruppenkommunikation

- **Keine Telefonnummern von Kindern/Eltern** standardmässig für andere sichtbar.
- **Ankündigungskanäle:** nur Leitende posten, Antworten gehen an Leitende, nicht an alle (keine Antwort-an-alle-Lawinen).
- **Prävention:** keine unbeobachtbaren 1:1-Kanäle zwischen erwachsenen Leitenden und Minderjährigen; Gruppen- oder transparente Kanäle bevorzugen (an Präventionskonzepte von J+S/Cevi anlehnen).
- Vor dem Senden klar zeigen, wer empfängt («an 23 Eltern der Jungschar»).
- Lesebestätigungen optional/aus für Teilnehmende; Melden und Moderation bei Teilnehmenden-Chats; Aufbewahrungs-/Löschregeln sichtbar.

## 6.10 KI-Funktionen (falls eingeführt)

Nach Microsoft HAX (18 Richtlinien) und Google PAIR:
- Klar machen, was die KI kann und wie gut («kann Fehler machen – prüfe Daten und Zeiten»).
- KI-Ausgaben kennzeichnen («Vorschlag (KI)») und als **bearbeitbaren Entwurf** liefern; nie automatisch an Eltern oder Kinder senden.
- Quellen zeigen (z. B. Links auf Originalnachrichten/Anlässe).
- Effizient aufrufen, verwerfen und korrigieren; Rückgängig zur menschlichen Version; feines Feedback.
- Vertrauen kalibrieren, nicht maximieren; Unsicherheit nur zeigen, wo sie Entscheide ändert; manueller Weg bleibt immer.
- Keine Kinderdaten an Drittmodelle ohne rechtliche Prüfung (7.2).

---

# Teil 7 – Recht, Ethik, Kinder und Datenschutz

*(Kein Rechtsrat – Orientierung für UX-Entscheide; bei Unsicherheit Fachperson beiziehen.)*

## 7.1 Ethisches Design – keine Dark Patterns

Typen (Brignull): Vergleich verhindern, Confirmshaming, getarnte Werbung, falsche Knappheit/Dringlichkeit/soziale Beweise, erzwungene Aktion, schwer kündbar, versteckte Kosten, Nörgeln, Hindernisse, Vorauswahl, Unterjubeln, Trickformulierungen, visuelle Störung. Die EU verbietet manipulative Oberflächen für Plattformen (DSA Art. 25); in der Schweiz gelten UWG und revDSG (freie, informierte Einwilligung).

**Regeln für Cevi OS:**
- Zustimmen und Ablehnen visuell gleichwertig.
- Keine vorangekreuzten Einwilligungen; Austreten/Abbestellen so einfach wie Beitreten.
- Keine Schuldgefühl-Texte («Willst du die Gruppe wirklich im Stich lassen?»).
- Knappheit nur wenn wahr und live; keine hoch vorausgewählten Beträge.
- Nach einem «Nein» nicht erneut fragen – ausser in einem wirklich neuen Kontext.
- **Für Kinder:** keine Streaks, Abzeichen oder Endlos-Feeds, die Nutzung maximieren.

## 7.2 Datenschutz (revDSG, seit 1. September 2023)

- **Privacy by Design & by Default (Art. 7):** Voreinstellungen auf das Minimum – Kontaktdaten nicht für alle Mitglieder sichtbar, Fotos nicht öffentlich.
- **Informationspflicht (Art. 19 ff.):** beim Erheben kurz und verständlich, wer verantwortlich ist, wozu, wer Daten erhält, ob ins Ausland (Cloud, Push-Dienste) – mit Link zur Datenschutzerklärung.
- **Besonders schützenswerte Daten** (Gesundheit wie Allergien/Medikamente fürs Lager, religiöse Ansichten, biometrische Daten): Einwilligung **ausdrücklich**; Zugriff rollenbasiert (nur Lagerleitung), befristet, nach dem Lager löschen. Datenschutz-Folgenabschätzung bei hohem Risiko prüfen.
- Auskunft (30 Tage), Datenherausgabe; Datenpannen mit voraussichtlich hohem Risiko für Betroffene dem EDÖB so rasch als möglich melden (Art. 24).
- **Minderjährige:** keine feste Altersgrenze – urteilsfähige Kinder können selbst einwilligen, je nach Tragweite. Für eingreifende Bearbeitungen (Fotos) Eltern *und* urteilsfähiges Kind einbeziehen.
- **UX-Folgen:** getrennte Einwilligungen (Lager-Gesundheitsdaten, Fotos, Newsletter); sichtbar, wer was sieht; einfacher Widerruf in den Einstellungen; Erklärung für Kinder in einfacher Sprache.

## 7.3 Fotos von Kindern und Jugendlichen

- Foto-Einwilligung getrennt von der Mitgliedschaft; Teilnahme darf nicht davon abhängen.
- Abgestuft: keine · nur intern · öffentliche Website · Social Media; Zweck, Kanäle, Dauer, Namensnennung, Widerruf.
- Jugendliche einbeziehen – ein «Nein» des Jugendlichen zählt auch bei Ja der Eltern.
- In der App: Foto-Status pro Kind für Leitende beim Hochladen/Markieren sichtbar (z. B. Hinweis «nicht veröffentlichen»).
- Gruppen- oder Rückenansichten bevorzugen.

## 7.4 Altersgerechtes Design (Benchmark: UK Children's Code, 15 Standards)

Kindeswohl zuerst · Folgenabschätzung · altersgerecht · Transparenz in kleinen Häppchen am Ort der Nutzung · keine schädliche Datennutzung · hohe Privatsphäre als Standard · Datenminimierung · zurückhaltendes Teilen · Standort standardmässig aus und sichtbar, wenn aktiv · Kind erfährt, wenn Eltern mitlesen · Profiling aus · keine Nudges zur Schwächung der Privatsphäre · Werkzeuge zur Rechte-Ausübung. Nicht Schweizer Recht, aber ein starker Massstab.

## 7.5 Barrierefreiheit rechtlich

- **eCH-0059 v3** (WCAG 2.1 AA) bleibt aktuell; kein Nachfolger auf Basis WCAG 2.2 publiziert. Ziel trotzdem WCAG 2.2 AA.
- BehiG-Teilrevision und Inklusionsgesetz (indirekter Gegenvorschlag zur Inklusions-Initiative) sind in Beratung – Stand Sept. 2026 Nationalrat, Ergebnis prüfen; noch nicht in Kraft; keine expliziten digitalen Pflichten für private Vereine in den geprüften Texten.
- **European Accessibility Act** gilt seit 28. Juni 2025 für bestimmte Produkte/Dienste im EU-Markt – für eine interne Vereins-App sehr wahrscheinlich nicht relevant.

---

# Teil 8 – Review- und Kritikmethode

## 8.1 Ablauf einer Design-Kritik

1. **Ziel zuerst:** Hauptaufgabe des Screens und das wichtigste Element benennen. Jede Bemerkung bezieht sich darauf.
2. **5-Sekunden-Test:** Was ist das? Was kann man tun? Was fiel auf?
3. **Unschärfe-/Squint-Test:** Screen unscharf (5–10 px, dann 20 px). Der beabsichtigte Fokus muss bleiben, kein ungewollter Hotspot.
4. **Graustufen-Test:** Hierarchie und Zustände müssen ohne Farbe funktionieren.
5. **Weglass-Test:** Für jedes Element: Schadet das Entfernen der Aufgabe? Wenn nicht → entfernen oder zurücknehmen.
6. **System-Audit:** Jeder Wert gegen Tokens (Abstand, Schrift, Farbe, Radius, Elevation, Bewegung); Ausrichtungslinien; Icon-Set; Typografie-Details.
7. **Stresstest:** echte und schlimmste Inhalte (lange Komposita, 0/1/1000, fehlende Bilder, Dark Mode, grösste Schrift, Querformat, iPhone Duo/Foldable).
8. **Zustands-Durchlauf:** Standard, Hover, Fokus, Gedrückt, Deaktiviert, Lädt, Leer, Fehler, Erfolg, Offline.
9. **Plattform-Check:** Checkliste des jeweiligen Teils (2.8, 3.8, 4.8).
10. **Barrierefreiheits-Durchlauf:** Kontrast, Screenreader, Tastatur, Trefferflächen.
11. **Heuristiken** (0.3) und **Anfängersignale** (1.12) durchgehen.

## 8.2 Feedback formulieren

Beobachtung → Auswirkung auf das Ziel → Vorschlag, jeweils mit Regel/Quelle, priorisiert nach Schweregrad. Gut Gelöstes ausdrücklich nennen, damit es beim Umbau bleibt.

## 8.3 Qualitätsstufen

1. **Funktioniert:** Aufgabe erledigbar, keine Fehler.
2. **Benutzbar:** Heuristiken erfüllt, alle Zustände, barrierefrei.
3. **Konsistent:** Tokens, Plattformmuster, Glossar.
4. **Ausgereift:** Typografie-Details, optische Korrektur, Bewegung mit Zweck, Extremfälle.
5. **Begeisternd:** gezielte Freude in seltenen Momenten, Persönlichkeit – ohne die Stufen 1–4 zu gefährden.
Nie eine höhere Stufe auf Kosten einer tieferen.

## 8.4 Ausgabeformat

```
## UX-/Design-Review: <Screen / Ablauf> (<Plattform>)

**Ziel des Screens:** <Job to be done in einem Satz>
**Gesamteindruck:** <2–3 Sätze, inkl. Qualitätsstufe 1–5>
**Das funktioniert gut:** <1–3 Punkte>

### Befunde
| # | Schweregrad (0–4) | Bereich (UX/Visuell/A11y/Plattform) | Problem | Regel/Quelle | Vorschlag (konkret: Komponente, Wert, Text) |
|---|---|---|---|---|---|

### Schnelle Gewinne (< 1 h)
### Offene Annahmen → so testen wir sie
```

---

# Teil 9 – Kontext Cevi OS (projektspezifisch)

Quelle: die Repos `Sorry4Nothing/cevi-os` (Backend + Web-Verwaltung `/admin`), `cevi-os-android`, `cevi-os-ios` (Stand 8. November 2026). **Die Doku im Repo geht diesem Abschnitt vor**; bei Abweichung gilt das Repo, und dieser Abschnitt ist nachzuführen.

**Produkt:** App für eine Cevi-Abteilung (Cevi Stäfa-Hombrechtikon): Programme aus dem Outlook-Kalender, Ja/Nein-Anmeldung, Chat zwischen Eltern und Stufenleitung. Admins verwalten Personen, Kinder, Stufen und Mitteilungen im Browser unter `/admin` (nur dort zweiter Faktor). Nutzergruppen: Eltern, Kinder/Teilnehmende, Leitende, Stufenleitung (SL), Admins.

**Verbindliche Projekt-Doku (vor jeder UI-Arbeit lesen):**
- `docs/design.md` (Android und iOS): Stil, Design-System-Zuordnung, Abweichungen, Muster.
- `docs/barrierefreiheit.md` (Backend-Repo): Checkliste mit festen Nummern; Massstab WCAG 2.2 AA sinngemäss für Apps. UI-PRs nennen unter «Evidence» die geprüften Nummern, Gerät, Systemversion, Nicht-Geprüftes, offene Befunde.
- `docs/GIT_WORKFLOW.md`: Branch pro Issue, PR nach `develop`, PR-Abschnitte Summary/Evidence/Merge Danger/Barrierefreiheit, Conventional Commits mit deutschem Betreff.
- **Nie ins Repo, in Issues, PRs oder Screenshots:** echte Namen, Kalender-Adresse, Exporte, Zugangsdaten, Server-Zugänge, `.env`. Screenshots nur aus der Demo-Abteilung.

**Design-Entscheide (Stand Repos):**
- **Stil «Nachthimmel»:** ruhiges, blau getöntes Dunkel; Nacht ist Hauptrichtung, Tag nach Systemeinstellung; **kein Dynamic Color**. Cevi-Blau (`secondary`) zeigt, wo man ist; Cevi-Rot (`primary`) nur für **die eine Hauptaktion** pro Screen und Zähler; `accent` für Links/Überzeilen. Grosse, fette Titel, runde Formen, **Karten mit feinem Rand statt Schatten**.
- **Design System (`tokens.json`) gilt vor den Bildschirm-Mockups.** Farben ohne Token werden nicht übernommen.
- **Android:** Archivo für **alle** Texte (mitgeliefert, in `sp`); bedienbare Elemente ≥ 48 dp, Haupt-Buttons 56 dp, Felder 52 dp; Strich-Icons 24 dp; eigenes Footer-Dock (Programme, Chat, Profil), im Querformat und ab 600 dp senkrecht links; Übergänge 260 ms, ohne System-Animationen keine; `ContrastTest` prüft Textpaare (4,5 : 1, `outline`/Fokus 3 : 1).
- **iOS:** Mindestversion **iOS 26**; nur iPhone; Archivo nur für Titel (800, Kartentitel 700), sonst SF Pro mit Systemstilen; Farben mit 4 Erscheinungen (Nacht, Tag, je mit mehr Kontrast); System-Tab-Bar und Navigationsleisten (Liquid Glass), nicht nachgezeichnet; Glas und Abdunkelung zeichnet iOS selbst.
- **Beide Apps nur Hochformat** (Entscheid, bewusste Abweichung von Checkliste 5.8).
- **«Die App zeigt nur, was die API erlaubt»:** fehlt eine Aktion in der API-Antwort, fehlt der Button – er wird **nicht** ausgegraut (geht der allgemeinen Regel in 2.6 vor).
- **Jede Aktion antwortet sofort** (Ladekreis im Knopf, Text bleibt, kein zweiter Tipp, Screenreader hört z. B. «Wird gespeichert»); Overlay über der App erst nach 250 ms und nie bei Hintergrundanfragen; Hinweis nach 4 s, dass es länger dauert.
- **Keine Meldung verschwindet von selbst** (Checkliste 8.2) → keine selbst verschwindenden Toasts/Snackbars; Meldungen bleiben, bis sie geschlossen oder ersetzt werden (geht 2.7/3.5 vor).
- **Kein Feld «Passwort wiederholen»** (Checkliste 9.7); Passwort-Auge mit Ansage des Zustands.
- **Neue Interaktionsmuster (Dialog, Sheet, Popup) nicht ungefragt einführen.** Wo der Entwurf mehr zeigt als API oder Issue, gilt das Issue.
- **Sprache:** nur Deutsch, Schweizer Schreibweise, «du», kurze Sätze, Buttons sind Verben, keine Emojis, Anführungszeichen «». Code/Bezeichner englisch, Texte und Doku deutsch.

**Risiken, die das Handbuch für Cevi OS sieht (beim Auftraggeber ansprechen, nicht eigenmächtig ändern):**
- **Hochformat-Sperre vs. Plattformen:** Android ignoriert sie ab 600 dp schon heute und mit API 37 ohne Ausweg; mit dem iOS-27-SDK (ab April 2027 Pflicht im App Store) sind auch iPhone-Apps grössenveränderbar (iPhone Duo). Layouts darum trotzdem robust für andere Grössen halten (keine fixen Bildschirmmasse, Size Classes/Window Size Classes, Scrollbarkeit).
- **Dunkles Theme:** Sekundärtext, Rahmen, Fokus und Dock zusätzlich mit APCA prüfen.
- **Eigenes Android-Dock:** Regeln aus 3.2 (Insets, Semantik, Inhalt nicht verdecken).
- **Kinderdaten:** Teil 7 bei jeder Funktion mit Personendaten (Sichtbarkeit, Fotos/Profilbilder, Chat, Telefonnummern).

---

# Teil 10 – Kanon: allgemein anerkannte Richtlinien-Sammlungen

Diese Sammlungen gelten in der Fachwelt als Standard. Sie überschneiden sich; zusammen bilden sie das Prüfraster «höchstes Niveau». Was schon in Teil 0–8 konkret steht, ist hier nur als Prinzip aufgeführt.

## 10.1 Normen und Grundbegriffe

- **ISO 9241-11 (Usability):** Ausmass, in dem bestimmte Nutzende in einem bestimmten Nutzungskontext Ziele **effektiv, effizient und zufriedenstellend** erreichen.
- **ISO 9241-210 (menschzentrierte Gestaltung):** Nutzungskontext verstehen → Anforderungen festlegen → Lösungen gestalten → mit Nutzenden evaluieren → iterieren; Nutzende über den ganzen Prozess einbeziehen.
- **ISO 9241-110:2020 – 7 Interaktionsprinzipien:**
  1. **Aufgabenangemessenheit** – unterstützt die Aufgabe ohne unnötige Schritte.
  2. **Selbstbeschreibungsfähigkeit** – jederzeit klar, wo man ist, was geht und wie.
  3. **Erwartungskonformität** – verhält sich, wie Nutzende es aus Kontext und Konventionen erwarten.
  4. **Erlernbarkeit** – unterstützt Entdecken und Lernen.
  5. **Steuerbarkeit** – Nutzende bestimmen Tempo, Reihenfolge, Abbruch.
  6. **Robustheit gegen Benutzungsfehler** – Fehler vermeiden, tolerieren, leicht beheben.
  7. **Benutzerbindung** – motivierend, vertrauenswürdig, angenehm.
- **WCAG-Prinzipien POUR:** wahrnehmbar, bedienbar, verständlich, robust.

## 10.2 Klassische Regelwerke

**Shneiderman – 8 goldene Regeln:**
1. Konsistenz anstreben.
2. Universelle Nutzbarkeit (Neue und Geübte, verschiedene Fähigkeiten).
3. Informatives Feedback zu jeder Aktion.
4. Dialoge mit klarem Abschluss gestalten.
5. Fehler verhindern, einfache Fehlerbehandlung.
6. Einfache Umkehrbarkeit von Aktionen.
7. Kontrolle bei den Nutzenden (keine Überraschungen).
8. Kurzzeitgedächtnis entlasten.

**Don Norman – «The Design of Everyday Things»:**
- **Auffindbarkeit** (was ist möglich?) und **Verständlichkeit** (was bedeutet es?).
- **Affordanz** (was ein Ding ermöglicht) und **Signifikant** (der sichtbare Hinweis darauf – in UI entscheidend).
- **Mapping** (Bedienelement entspricht räumlich/logisch der Wirkung), **Einschränkungen** (falsche Aktionen unmöglich machen), **Feedback**, **konzeptuelles Modell** (UI vermittelt ein stimmiges Bild, wie das System funktioniert).
- **Kluft der Ausführung** (wie mache ich das?) und **Kluft der Bewertung** (hat es geklappt?) – beide minimieren.
- Fehler sind Designfehler: Ausrutscher (slips) durch Einschränkungen und Rückgängig, Irrtümer (mistakes) durch klare Modelle verhindern.

**Tognazzini – First Principles (Auswahl):** Antizipation (Nutzenden geben, was sie als Nächstes brauchen), Autonomie mit Statusinformation, Farbe nie allein, Konsistenz, sinnvolle Defaults, Effizienz der *Nutzenden* (nicht des Systems), erkundbare Oberflächen (alles umkehrbar), Fitts, Latenz verringern und überbrücken, Erlernbarkeit, **Arbeit der Nutzenden schützen** (nie Eingaben verlieren), Lesbarkeit, Zustand merken (wo war ich?), sichtbare Navigation.

**Steve Krug – «Don't Make Me Think»:** Seiten sollen selbsterklärend sein; Nutzende scannen, wählen die erste brauchbare Option (satisficing) und wursteln sich durch statt Anleitungen zu lesen → klare visuelle Hierarchie, offensichtlich klickbare Elemente, Konventionen, wenig Text («die Hälfte der Wörter streichen, dann noch einmal die Hälfte»). **Trunk-Test:** Auf jeder beliebigen Seite muss sofort klar sein: Welche Seite/App ist das? Wo bin ich? Was kann ich hier tun? Wie komme ich zurück/weiter?

**GOV.UK – 10 Design-Prinzipien:** Mit Nutzerbedürfnissen beginnen · Weniger tun · Mit Daten gestalten · Die harte Arbeit machen, damit es einfach wird · Iterieren, dann wieder iterieren · Es ist für alle · Kontext verstehen · Dienste bauen, nicht Websites · Konsistent, nicht uniform · Offen arbeiten.

**Microsoft Inclusive Design:** Ausschluss erkennen · von Vielfalt lernen · für eine Person lösen, auf viele ausweiten. **Persona-Spektrum:** dauerhaft (ein Arm), vorübergehend (Armbruch), situativ (Kind auf dem Arm, Handschuhe im Lager, Sonne auf dem Display) – wer für die dauerhafte Einschränkung gestaltet, hilft allen.

## 10.3 Weitere Gesetze und Effekte (Ergänzung zu 0.4)

- **Choice Overload:** zu viele gleichwertige Optionen lähmen → empfehlen, vorauswählen, gruppieren.
- **Kognitive Last / Arbeitsgedächtnis:** nur zeigen, was für den aktuellen Schritt nötig ist (Progressive Disclosure).
- **Selektive Aufmerksamkeit / Banner-Blindheit:** Was wie Werbung oder Deko aussieht, wird übersehen → wichtige Hinweise nicht als bunte Banner tarnen, sondern in den Ablauf setzen.
- **Paradox des aktiven Nutzers:** Leute lesen keine Anleitungen, sie legen sofort los → Hilfe im Kontext, sichere Erkundung.
- **Mentales Modell:** Begriffe und Strukturen der Nutzenden übernehmen (Card Sorting).
- **Flow:** Unterbrechungen (Modale, unnötige Bestätigungen, Ladezeiten) minimieren.
- **Pareto (80/20):** die 20 % der Funktionen, die 80 % der Nutzung ausmachen, am besten machen.
- **Occam's Razor:** die einfachste Lösung, die die Aufgabe erfüllt.
- **Parkinson:** Aufgaben dehnen sich auf die verfügbare Zeit → Vorausfüllen, Autofill, kurze Wege.
- **Prägnanz:** Menschen sehen die einfachste Form → klare, einfache Formen und Icons.
- **Uniform Connectedness:** Verbundenes (Linie, Fläche) wirkt zusammengehörig.

## 10.4 Daumen und Haltung (mobil)

- Hoober (1'333 Beobachtungen): 49 % halten das Handy einhändig, 36 % stützen es mit einer Hand und tippen mit der anderen, 15 % nutzen beide Hände; die Mitte des Bildschirms ist am schnellsten und genauesten zu treffen. Leute wechseln die Haltung häufig.
- Folgerungen: Hauptaktionen und häufige Ziele unten/Mitte; selten Gebrauchtes und Zerstörerisches oben oder abgesetzt; immer für die eingeschränkteste Haltung (eine Hand) gestalten; grosse Bildschirme verkleinern die einhändig erreichbare Zone – nichts Wichtiges nur oben links.

## 10.5 Web Interface Guidelines (Vercel, Praxis-Checkliste)

Ergänzt Teil 2 um Regeln, die Profis oft vergessen:
- Icon-only-Buttons mit `aria-label`; dekorative Icons `aria-hidden="true"`; Bilder mit `alt` (dekorativ `alt=""`).
- Nie `outline: none` ohne `:focus-visible`-Ersatz; `:focus-within` für zusammengesetzte Controls; Fokus nie von Sticky-Elementen verdeckt.
- Felder mit `autocomplete`, sinnvollem `name`, richtigem `type`/`inputmode`; `spellcheck="false"` für E-Mail, Codes, Benutzernamen; Labels klickbar; Checkbox/Radio mit einer gemeinsamen Trefferfläche ohne tote Zonen.
- Absende-Button aktiv lassen, bis die Anfrage startet, dann Ladeindikator; Fehler beim Feld, Fokus aufs erste Fehlerfeld; vor dem Verlassen mit ungespeicherten Änderungen warnen.
- Animationen nur über `transform` und `opacity`; **nie `transition: all`**; Animationen unterbrechbar; Bewegung > 5 s braucht Pause/Stopp.
- Lange Inhalte abfangen (`truncate`/`line-clamp`/`overflow-wrap`), Flex-Kinder `min-width: 0`; Leerzustände ohne kaputte UI.
- `<img>` mit `width`/`height`; Bilder unterhalb der Falz `loading="lazy"`; Listen > 50 Einträge virtualisieren (oder `content-visibility: auto`); kein Layout-Lesen während des Renderns.
- Zustand (Filter, Tabs, Paginierung, offene Panels) in der URL; echte Links (`<a>`), damit Cmd/Ctrl-Klick und Mittelklick funktionieren.
- Zerstörerisches: bestätigen oder Rückgängig, nie sofort ausführen.
- Modale/Drawer `overscroll-behavior: contain`; `touch-action: manipulation`; Gesten immer mit Klick-/Tastatur-Alternative.
- Randlose Layouts mit `env(safe-area-inset-*)`.
- Dunkles Theme: `color-scheme: dark` auf `<html>`, `<meta name="theme-color">` passend; native `<select>` mit expliziten Farben.
- Datum, Zahl, Währung immer über `Intl.DateTimeFormat`/`Intl.NumberFormat` (`de-CH`), nie hart codiert.
- Hover-, Active- und Fokuszustände deutlicher als der Ruhezustand.
- Texte: aktiv, Ziffern für Zahlen, konkrete Button-Labels, Fehler mit nächstem Schritt. *(Die dort empfohlene «Title Case»-Schreibung gilt nicht für Deutsch – im Deutschen normale Satzschreibung.)*

## 10.6 Qualitätsmodelle für Funktionen

- **Kano-Modell:** Basismerkmale (fehlen = Ärger, vorhanden = selbstverständlich: z. B. Programm korrekt, Anmeldung klappt), Leistungsmerkmale (je besser, desto zufriedener: Geschwindigkeit, Übersicht), Begeisterungsmerkmale (unerwartet: Lager-Countdown, smarte Erinnerung). Reihenfolge: zuerst alle Basismerkmale fehlerfrei, dann Leistung, dann Begeisterung.
- **Zieldirigiertes Design (Cooper):** auf Ziele realer Personas gestalten, nicht auf Funktionslisten. Für Cevi: je eine Persona pro Rolle (Elternteil, Kind, Leitende, Stufenleitung, Admin) mit Zielen, Kontext und häufigsten Aufgaben.
- **Plattform-Qualitätsrichtlinien:** Android «App quality / Large screen app quality» (Stufen für adaptive Apps), Apple App Review Guidelines (Abschnitte Design und Datenschutz) als Mindestmass vor jeder Veröffentlichung.

---

# Teil 11 – Qualitätstor: vor dem Abschluss jeder UI-Arbeit

Jeder Agent und jede Person geht diese Punkte durch, bevor eine UI-Änderung als fertig gilt. Nicht erfüllte Punkte im PR bzw. in der Antwort offen nennen.

1. **Projekt-Doku geprüft:** `docs/design.md` und Checkliste Barrierefreiheit gelesen; Abweichungen dort nachgeführt.
2. **Aufgabe und Person:** Welche Rolle erledigt welchen Job in welchem Kontext? Kürzester Weg dafür?
3. **Alle Zustände** (0.6): leer, lädt, Fehler, offline, kein Zugriff, Extremwerte, Erfolg; jede Aktion antwortet sofort.
4. **Hierarchie:** eine Hauptaktion, Squint- und Graustufen-Test bestanden (Teil 8).
5. **System statt Einzelwerte:** alle Farben, Abstände, Radien, Schriften aus Tokens bzw. Theme.
6. **Plattform:** Checkliste 2.8 (Web), 3.8 (Android) oder 4.8 (iOS); native Muster statt Nachbauten.
7. **Barrierefreiheit:** Screenreader-Durchlauf, grösste Schrift, Kontrast hell/dunkel, Trefferflächen, Fokus, Bewegung reduziert; geprüfte Nummern der Projekt-Checkliste notieren.
8. **Texte:** Schweizer Schreibweise, «du», Verb-Buttons, Fehler mit Lösung, Glossar-Begriffe, keine Emojis.
9. **Daten und Ethik:** nur nötige Daten, sichtbar wer was sieht, keine Dark Patterns, keine echten Personendaten in Screenshots/Tests.
10. **Konsistenz zwischen Plattformen:** gleiche Inhalte, Begriffe und Entscheide wie auf den anderen Plattformen (Teil 5).
11. **Ehrlichkeit:** Was nicht geprüft werden konnte (Gerät fehlt, kein Build), steht im PR.

---

# Quellen (zum Nachprüfen)

**UX-Grundlagen:** NN/g – 10 Usability Heuristics; Response Times; Skeleton Screens 101; Error-Message Guidelines; Hamburger Menus / Hidden Navigation; Filters vs. Facets; Animation Duration; Icon Usability; Visual Hierarchy; Aesthetic-Usability Effect; Choosing Chart Types; Liquid Glass Is Cracked (2025) · Baymard – Inline Validation; Inline Labels; Mobile App UX Trends 2026 · Laws of UX (lawsofux.com) · MeasuringU (SUS, SEQ) · GOV.UK Content Design & Design System
**Visuelles Design:** Refactoring UI (Wathan/Schoger) · Butterick's Practical Typography · Bringhurst, The Elements of Typographic Style · Josh Comeau – Designing Shadows · Vitsœ – Dieter Rams' Good Design · Don Norman – Emotional Design · Datawrapper – Colors for Data Vis · Evil Martians – OKLCH in CSS
**Barrierefreiheit:** W3C WCAG 2.2, What's New, WCAG 3 Working Drafts · W3C COGA «Making Content Usable» · ARIA Authoring Practices · eCH-0059 · EBGB Leitfaden Leichte Sprache (2026) · APCA/ARC Bronze Simple Mode · Adrian Roselli – WCAG 3 Contrast (2026)
**Web:** web.dev Core Web Vitals, prefers-reduced-motion, View Transitions · web-platform-dx Baseline (oklch, color-mix, relative color)
**Android:** developer.android.com – Material 3 in Compose; Compose Material3 Release Notes; Window Size Classes; Android 16/17 Behavior Changes; Resizability in Android 17; Haptics Principles; Play Target-SDK Requirements · m3.material.io · androidx Token-Quellen (Color, Shape, Motion)
**iOS:** Apple HIG (Design Principles 2026, Typography, Color, Dark Mode, Materials, Layout, Tab Bars, Toolbars, Motion, Playing Haptics, Notifications) · WWDC26 «What's new in SwiftUI» & «Principles of great design» · WWDC23 «Animate with springs» · TN3187 (UIScene)
**Kanon:** ISO 9241-11/-110/-210 · Shneiderman, Designing the User Interface · Norman, The Design of Everyday Things · Tognazzini, First Principles of Interaction Design · Krug, Don't Make Me Think · GOV.UK Design Principles · Microsoft Inclusive Design · Vercel Web Interface Guidelines · Hoober, How Do Users Really Hold Mobile Devices (2013) · Kano-Modell · Cooper, About Face
**Abläufe/Recht:** FIDO/passkeycentral.org Design Guidelines · Microsoft HAX Toolkit · Google PAIR Guidebook · Ink & Switch Local-first · RFC 5545 · TWINT/Worldline Docs · Bundeskanzlei Leitfaden geschlechtergerechte Sprache (2023) · revDSG (fedlex), EDÖB · ICO Age Appropriate Design Code · deceptive.design · DSA Art. 25
