# Design der Website: Hülle, Tokens, Komponenten

Die öffentliche Website folgt dem Design «Cevi Web» (Tag und Nacht, Desktop und Mobile). Dieses Dokument beschreibt, was der Renderer (`apps/api/src/website/rendern.ts`) und die Stilvorlage (`apps/api/public/website/website.css`) dafür bereitstellen und wie ein neuer Seitentyp sie nutzt. Ablauf der Auslieferung: [website-auslieferung.md](website-auslieferung.md). Prüfpunkte: [barrierefreiheit.md](barrierefreiheit.md), Abschnitt 11.

## Regeln der Ausgabe

- **Eine Stilvorlage, kein Inline-Stil.** Die CSP der Seiten erlaubt `style-src 'self'`: Alle Stile stehen in `website/website.css` und, für den Kopf, in `website/kopf.css` (#558, jede Seite lädt beide), nie in `style=`-Attributen oder `<style>`-Blöcken. Die Vorschau im Editor und die Sperrseite sind die einzigen Ausnahmen (siehe unten).
- **Kein Skript nötig.** Ein Skript laden nur Seiten mit geschützten Bausteinen (`geschuetzt.js`) und die Anmeldeseite (`anmelden.js`) sowie jede Seite mit Navigation das Menü (`menue.js`, eine Verbesserung: Öffnen beim Zeigen, Pfeiltasten, Esc); es gibt nie ein Inline-Skript. Das Menü am Handy, jedes Untermenü und «Mehr» sind `<details>`-Elemente: Sie öffnen sich ohne Skript mit Maus, Finger und Tastatur.
- **Nichts von aussen.** Archivo als eigene Datei (`website/archivo-latin.woff2`, SIL OFL, `@font-face` mit `font-display: swap`, CSP `font-src 'self'`), Bilder nur aus dem Medienspeicher (`/api/v1/medien/<ID>`), Symbole als Inline-SVG.
- **Tag und Nacht** über `prefers-color-scheme` und die Wahl des Besuchers (`data-theme` auf `<html>`, gesetzt von `theme.js`; Tokens für beide Wege); `<meta name="color-scheme" content="light dark">` und `color-scheme` am `:root` sorgen für Formularelemente und Scrollleisten.
- **Bewegung** (Schimmer des Skeletons, Lade-Kreis) läuft nur unter `prefers-reduced-motion: no-preference`.
- **Erzwungene Farben:** Knöpfe, Chips, Bänder, Karten und Zustände haben einen Rand (`CanvasText`); nichts hängt nur an einer Hintergrundfarbe.
- **Masse in `rem`** (200 Prozent Zoom), Umbruch bei 64 em (Tablet) und 47.5 em (Handy). Berührflächen mindestens 48 px.

## Tokens (Grundlagen G1)

Farben stehen nur als `var(--token)`. Die Namen sind die des Designs; Werte für Tag und Nacht stehen am Anfang von `website.css`.

| Token                                                                             | Rolle                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------- |
| `--surface`, `--surface-container-low`, `--surface-container`, `…-high`           | Flächen (Grund, Karten und Logozeile, Leisten) |
| `--on-surface`, `--on-surface-variant`                                            | Haupttext, Zweittext                           |
| `--outline`, `--outline-variant`                                                  | Rand bedienbarer Elemente, Trennlinien         |
| `--primary`, `--on-primary`, `--primary-text`                                     | Markenrot: Fläche, Text darauf, Rot als Text   |
| `--secondary`, `--on-secondary`, `--on-secondary-muted`                           | Markenblau: Leiste, Fuss, Teaser-Box           |
| `--secondary-container`, `--on-secondary-container`                               | Info-Band, Chip                                |
| `--accent`                                                                        | «hier bist du», gewählter Zustand              |
| `--success-…`, `--error-…`, `--warning-…`, `--stufe-…` (je `-container`/`--on-…`) | Zustandsflächen und Etiketten                  |
| `--focus`                                                                         | Fokusring (3 px, 3:1 zum Umfeld)               |
| `--skeleton`, `--skeleton-highlight`                                              | Skeleton und Schimmer                          |
| `--r-sm`, `--r-md`, `--r-full`                                                    | Radien                                         |

Kontraste (Text mindestens 4.5:1, Ränder und Fokus mindestens 3:1) sind in den Grundlagen G1 des Designs gemessen. Weicht ein Wert in `website.css` ab, gilt der der Grundlagen.

## Die Hülle

`rahmen()` in `rendern.ts` erzeugt jede Seite gleich:

```html
<a class="sprunglink" href="#inhalt">Zum Inhalt</a>
<header>
  <div class="kopf">
    … <a class="marke" href="/"><b>CEVI</b><span>Stäfa</span></a>
  </div>
  <div class="leiste">
    <nav class="hauptnav" aria-label="Hauptnavigation">…</nav>
    <!-- Computer -->
    <details class="menue-mobil">
      <summary>Menü</summary>
      <nav aria-label="Menü">…</nav>
    </details>
    <!-- Handy -->
    <div class="rechts"><a href="/anmelden">Anmelden</a></div>
  </div>
  <nav class="unterleiste" aria-label="Unterseiten von …">…</nav>
  <!-- nur im Bereich mit Unterseiten -->
</header>
<main id="inhalt" tabindex="-1"><div class="wrap">…Inhalt…</div></main>
<footer class="fuss">…</footer>
```

- **Genau ein `h1`:** der Seitentitel. Ihn schreibt der Seitentyp selbst (siehe «Neuer Seitentyp»); die Bausteine «Überschrift» beginnen bei Ebene 2.
- **Marke:** «Cevi Stäfa» wird zu `CEVI` und `Stäfa` (`markenname()` in `kopf.ts`). Mit Logo (#550) steht statt der Wortmarke das Bild (`.marke--logo`, Höhe 2,25 rem, 1,875 rem unter 64 em), ohne Hintergrund; der Name bleibt für Screenreader im Link. Gibt es eine Fassung für den dunklen Modus (#558), stehen beide Bilder im Markup (`.logo--hell`, `.logo--dunkel`, Klasse `marke--zwei`) und `kopf.css` zeigt je nach Darstellung eines (System und gewählte Darstellung); das verborgene ist `display: none` und wird nicht vorgelesen. Gibt es nur eine Fassung, steht sie im dunklen Modus auf einem hellen Feld (`--logo-grund`).
- **Umschalter Hell und Dunkel (#558):** `.thema` mit zwei runden Knöpfen (44 px) nur mit Symbol, Sonne und Mond; der Name steht im `aria-label`, der Zustand in `aria-pressed`. Gewählt ist gefüllt mit innerem Ring (Form, nicht nur Farbe; bei erzwungenen Farben ein dicker Rahmen). Ohne gespeicherte Wahl folgt die Seite dem System, der passende Knopf ist markiert und nichts wird gespeichert; ein Klick speichert. Ohne Skript `hidden`. Der Umschalter steht im Band und, weil er unter 30 em dort keinen Platz hat, ein zweites Mal im Fuss des Menüs; `theme.js` hält beide gleich.
- **Navigation (#558, `kopf.ts`, `kopf.css`, `menue.js`):** Der Kopf ist ein Band, das oben stehen bleibt (`position: sticky`). Unter 64 em übernimmt das Menü. Ab 64 em steht die Navigation in einer zweiten Zeile desselben Bands, und beim Scrollen bleibt nur diese Zeile stehen. Sobald Marke, Navigation und Knöpfe nebeneinander Platz haben, stehen sie in einer Zeile: Der Server schätzt die Breite der Navigation aus den Titeln und setzt eine Stufe (`kopf--kurz`, `--mittel`, `--lang`, `--weit`: eine Zeile ab 76, 88, 96 oder 106 em). Was auch im schmalsten Fenster mit Leiste nicht in die Zeile passt, steht unter «Mehr»; reicht die Schätzung nicht, bricht die Zeile um. Ein Punkt mit Unterseiten ist ein Link zur Seite und daneben ein `<details>` (`li.mit-unter`), dessen Dreieck (`summary` mit `aria-label` «Unterseiten von …») die Tafel `.unter` öffnet; haben die Unterseiten selbst Unterseiten, wird die Tafel zur Spaltentafel (`.unter--gruppen`), tiefere Ebenen stehen eingerückt. `menue.js` ergänzt: Öffnen beim Zeigen mit der Maus (80 ms, Schliessen nach 200 ms, damit der Weg zur Tafel nichts schliesst), nur eine Tafel offen, Esc schliesst und gibt den Fokus zurück, Klick daneben und Verlassen mit der Tastatur schliessen, Pfeiltasten, Tafel am rechten Rand öffnet nach links. Im Menü am Handy steht der ganze Baum; Unterseiten sind zugeklappt, der Zweig der aktuellen Seite ist offen. Die Unterseiten des gewählten Bereichs stehen ab 64 em zusätzlich in der Unterleiste. Die aktuelle Seite trägt `aria-current="page"`, ihre Oberseiten `aria-current="true"`. Die Seiten `impressum` und `datenschutz-website` stehen im Fuss, nicht in der Navigation.
- **Anmelden:** Ein Link auf `/anmelden`. Die statischen Seiten kennen die Sitzung nicht; ein Konto-Menü für angemeldete Personen (Design W11) gibt es darum nicht (Lücke, siehe PR).
- **Fusszeile (W1):** drei Spalten (Name und Anschrift, Telefon und E-Mail, Impressum und Datenschutz) und «©». Die Angaben kommen aus der Konfiguration (siehe [website-auslieferung.md](website-auslieferung.md), «Konfiguration»); was fehlt, fehlt auch im Fuss.
- **Optionen von `rahmen()`:** `nurMarke` (nur das Logo, für Wartung und Serverfehler), `robots`, `canonical`, `skript` (erlaubt zusätzlich `connect-src` im Meta-CSP), `zusatzSkripte` (weitere eigene Skripte mit `defer`, zum Beispiel das Karussell; jede Seite lädt `theme.js` im `<head>`), `hauptAttr`.

## Klassen und Komponenten

| Klasse                                                                      | Bedeutung                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.wrap`                                                                     | Fliessende Spalte: höchstens 105 rem (1680 px), seitlicher Rand `--rand` (16 bis 72 px)                         |
| `.seitenkopf`                                                               | Block mit dem `h1` (und optional `.unter`, `.kicker`, `.knopfreihe`)                                            |
| `.inhalt`                                                                   | Spalte der Bausteine, Abstand 24 px; `h2` bekommt mehr Luft                                                     |
| `.abschnitt`, `.abschnitt-kopf`                                             | Abschnitt mit Überschrift und «Alle …»-Link rechts                                                              |
| `.zweispalten` mit `.spalte` und `aside`                                    | Text links, blaue Tafel rechts (18 bis 27 rem); am Handy untereinander                                          |
| `.lesetext`                                                                 | Fliesstext, höchstens 70 Zeichen breit                                                                          |
| `.karte`                                                                    | Fläche mit Rand und Radius 12 px                                                                                |
| `.btn` mit `.p` (rot), `.s` (Rand), `.t` (Text), `.gross`, `.voll`          | Knöpfe; nur eine rote Hauptaktion je Seite; `aria-disabled="true"` und `aria-busy` im Ladezustand               |
| `.chip` mit `.st`, `.ok`, `.fe`, `.wa`                                      | Etikett (Stufe, Erfolg, Fehler, Warnung); Zustand nie nur über Farbe, immer mit Wort                            |
| `.band` mit `.ok`, `.fe`, `.wa`, `.oben`                                    | Hinweisband mit Symbol, `strong` als Titel und Text; `role="status"` oder `role="alert"`                        |
| `.zustand` mit `.fe`                                                        | Zustand im Inhalt (leer, Fehler, kein Zugriff): `.kopfzeile` mit Symbol, Text, Aktion                           |
| `.schutz`, `.schutzblock`                                                   | Hinweis «Nur angemeldet sichtbar» mit Link «Anmelden»                                                           |
| `.termine`, `.termin`, `.datum`                                             | Termin-Liste: Datumskachel (`.tag`, `.nr`, `.mo`), `.titel`, `.meta`, `.chips`                                  |
| `.team`, `.person`, `.ava`                                                  | Leitungsteam mit Avatar (Initialen), `.name`, `.funktion`                                                       |
| `.fakten`, `.fakt`                                                          | Faktenkasten (`dt` Bezeichnung, `dd` Wert)                                                                      |
| `.karten`, `.liste`, `.merkmale`, `.stufenkarten`, `.zeitstrahl`, `.zahlen` | Darstellungen des Bausteins «Karten», siehe «Gestaltung der Seiten»                                             |
| `.titelbild`, `.hero`, `.fahne`                                             | Titelbild bis zum Fensterrand; die blaue Fahne mit dem `h1` ragt von links hinein                               |
| `.galerie`                                                                  | Kacheln im Seitenverhältnis 4:3 mit Platzhalterfläche, auch ohne geladene Bilder                                |
| `.kontaktkarte`, `.wege`, `.weg`                                            | Kontakt: Frage und Ansprechperson in der Titelschiene, Telefon und E-Mail als grosse Zeilen                     |
| `.mit-unter`, `.unter`, `.weitere`                                          | Untermenü eines Punktes der Leiste und «Mehr»                                                                   |
| `.datei`                                                                    | Verknüpfung auf eine Datei im SharePoint mit `.info` (Typ, Grösse)                                              |
| `.teaser`, `.teaser-text`                                                   | Einstieg der Startseite: Fahne mit `h1` und Schaltflächen, der Text daneben                                     |
| `.formular`, `.feld`, `.eingabe`, `.pw`, `.hilfe`, `.fehlertext`            | Formulare (Anmelden); Fehler stehen als Text beim Feld und in einer Zusammenfassung oben                        |
| `.sk`, `.skel`, `.skel-rahmen`, `.schimmer`                                 | Skeleton (siehe unten)                                                                                          |
| `.nur-sr`                                                                   | Nur für Screenreader                                                                                            |
| `.i`, darin `.f`                                                            | Symbol (Inline-SVG, 24 px, `currentcolor`): Linie 2 px, gerade Enden, spitze Ecken; `.f` ist eine gefüllte Form |

`[hidden]` blendet immer aus (`display: none !important`).

### Symbole

`symbol(name)` aus `src/website/symbole.ts` liefert ein Inline-SVG als `HtmlKnoten` (`info`, `warnung`, `schloss`, `person`, `menue`, `schliessen`, `nochmals`, `auge`, `auge-zu`, `sonne`, `mond`, `gruppe`, `zelt`, `kalender`, `stern`, `herz`, `ort`, `pfeil`, `dreieck`). Der Satz ist eigens gezeichnet (24er Raster) und folgt einer Logik: Linien 2 px mit geraden Enden und spitzen Ecken, Formen aus Gerade, Kreis und Bogen; was eine Richtung zeigt oder betont, ist ein gefülltes Dreieck oder Quadrat (das Dreieck ist die Form des Cevi-Zeichens). Ein Symbol steht nur, wo es etwas beiträgt: Telefon und E-Mail der Kontaktkarte tragen ihre Art als Wort. Das Skript für geschützte Bausteine kennt keine SVG-Elemente (`knoten.js`); geschützte Bausteine tragen darum keine Symbole. Skripte erzeugen dieselben Formen mit `symbol()` aus `website/ui.js`.

### Skeleton (Grundlagen G3)

Wo Daten nachgeladen werden, steht ein formgleicher Platzhalter:

```html
<div class="skel-rahmen" aria-busy="true">
  <div class="skel karte" aria-hidden="true">
    <span class="sk k w40"></span>
    <span class="sk t w90"></span>
    <span class="sk t w60"></span>
    <span class="schimmer"></span>
  </div>
</div>
<p class="nur-sr" role="status">Lädt …</p>
```

- Die Information liefert die Live-Region, das Skeleton ist `aria-hidden`.
- Es erscheint erst nach 200 ms (kein Flackern), der Schimmer läuft nur mit erlaubter Bewegung.
- Nach 4 Sekunden steht «Das dauert länger als sonst.», nach 15 Sekunden der Fehlerzustand mit «Nochmals versuchen» (`geschuetzt.js`).

## Gestaltung der Seiten (#555)

Die Seiten nutzen die ganze Breite: Jeder Abschnitt (`section.sektion`) hat einen Hintergrund bis zum Fensterrand, sein Inhalt steht in der Spalte `.wrap`. Fliesstext bleibt über `.lesetext` bei höchstens 70 Zeichen.

| Regel        | Umsetzung                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abschnitt    | Jede Überschrift der Ebene 2 beginnt einen Abschnitt; Hinweis, Aufruf, Termin-Liste und Kontaktkarte bilden je einen eigenen (`rendereAbschnitte` in `rendern.ts`)                                                                                                                                                                                   |
| Titelschiene | Ab 1025 px steht der Titel links (`.sektion-kopf`, ein Drittel), der Inhalt rechts (`.sektion-rumpf`): Text, Liste, Zeitstrahl, Zahlen, Termine und Kontakt (`.sektion--text`). Der Titel bleibt stehen, solange sein Abschnitt durchläuft                                                                                                           |
| Ganze Breite | Merkmale, Bildkarten, Karten, Galerie und Karussell stehen unter dem Titel über die ganze Spalte (`.sektion--breit`); ein kurzer Text zwischen Titel und Karten gehört zum Titel                                                                                                                                                                     |
| Ton          | Der Hintergrund wechselt, wo die Art des Inhalts wechselt: Abschnitte mit Titelschiene teilen sich hintereinander die Fläche und trennen sich mit einer Linie von Fensterrand zu Fensterrand (`.sektion--folge`); Abschnitte über die ganze Breite heben sich mit der Tönung ab (`.sektion--toenung`). Hinweis (getönt) und Aufruf (rot) sind Bänder |
| Einstieg     | Der erste Abschnitt ohne Überschrift gleich unter dem Seitentitel ist grösser gesetzt (`.sektion--einstieg`)                                                                                                                                                                                                                                         |
| Kartenarten  | Jede Art sieht nach ihrem Zweck aus: Merkmale stehen gross in einem blauen Band, ohne Link, Bildkarten tragen ein Foto und einen Link über die ganze Karte, Termine haben vorn das Datumsfeld, der Aufruf ist ein rotes Band mit einer Schaltfläche, Kontakt sind grosse Zeilen. Karten haben einen feinen Rand statt Schatten                       |

Tokens der Gestaltung in `:root`: `--rand` (Seitenrand), `--abstand` (über und unter einem Abschnitt), `--spalt` (zwischen Titelschiene und Inhalt), `--titel` (Farbe der Titel: blau am Tag, hell in der Nacht), `--karte` (Fläche einer Karte).

### Links

Ein Linkbild für die ganze Website: Ein Link im Text ist blau (`--accent`, in der Nacht hellblau) und unterstrichen, nie nur farbig; beim Zeigen wird der Strich dicker. Rot bleibt der einen Hauptaktion. Ein Link auf eine fremde Seite (`rel="noopener noreferrer"`) trägt hinten einen kleinen Pfeil nach oben rechts (im Stil gezeichnet, nach der Logik des Symbolsatzes) und für Screenreader den Zusatz «(externe Seite)», den der Renderer ergänzt. Ein Verweis, der allein steht (`.verweis`: Schaltfläche in der Darstellung «Link», Videolink; `a.mehr` in Karten), ist fett, ohne Strich und trägt einen Pfeil; beim Zeigen kommt der Strich dazu und der Pfeil rückt vor. Termin-Zeilen bekommen beim Zeigen eine ruhige Fläche als eigene Schicht hinter der Zeile (gleicher Abstand rundum, die Trennlinien bleiben frei), der Text bewegt sich nicht.

### Bewegung

Eine Kurve und zwei Dauern gelten für alles: `--kurve`, `--dauer` (0.2 s, Zeigen und Drücken) und `--dauer-lang` (0.5 s, Einblenden und Wechsel). Jede Bewegung steht im Block «Bewegung (#555)» am Ende von `website.css` und gilt nur am Bildschirm und ohne «Bewegung reduzieren» (`@media screen and (prefers-reduced-motion: no-preference)`); ein Test prüft, dass ausserhalb kein `animation` und kein `transition` steht. Der Ruhezustand ist immer der sichtbare: Läuft eine Animation nicht (älterer Browser, Druck, kein Skript), steht der Inhalt da.

- Beim Laden: Das Titelbild setzt sich, die Fahne kommt von links, der Text folgt.
- Beim Scrollen: Titel, Karten und Zeilen steigen kurz auf, sobald sie ins Fenster kommen. Reines CSS (`animation-timeline: view()` in `@supports`), kein Skript; lange Texte bewegen sich nicht. Für eigene Bausteine: Klasse `einblenden`.
- Zeigen und Drücken: Knöpfe, Karten und Pfeile antworten mit Farbe und kleiner Verschiebung.
- Für Vollseiten-Screenshots «Bewegung reduzieren» einschalten: Sonst bleiben Stücke unterhalb des Fensters unsichtbar, weil ihre Animation noch nicht begonnen hat.

## Neuer Seitentyp

1. Inhalt in `rahmen(k, { titel, aktuell, inhalt, … })` übergeben. `inhalt` ist fertiges Markup, das in `.wrap` steht. `titel` landet im `<title>` («Titel | Abteilung»), den `h1` schreibt der Seitentyp.
2. Strings maskieren mit `esc()`, Bausteine nur über `HtmlKnoten` (`el()`, `serialisiere()`), Adressen nur über `linkArt()`; nie Rohtext aus der Datenbank ins Markup.
3. Seitenkopf: `<div class="seitenkopf"><h1>Titel</h1></div>`, danach `<div class="inhalt">…</div>` oder eigene Abschnitte mit `.abschnitt`.
4. Zustände (leer, Fehler, kein Zugriff, Laden) mit `.zustand` und `.skel-rahmen`; Fehler mit `role="alert"` und einer Aktion («Nochmals versuchen»).
5. Neue Datei in `abgleich.ts` (`gesamt`) eintragen und in `test/website-abgleich.test.ts` und `test/website-ausgabe.test.ts` nachführen.
6. Neue Klassen in `website.css` nur mit Token-Farben, in `rem`, mit Fokuszustand; danach hier eintragen.

Die Seiten für Termine und Anlässe (Boards W3, W5 bis W8) bauen auf `.termine`, `.termin`, `.datum`, `.chip`, `.band`, `.zustand`, `.skel` und `.formular` auf; fehlt eine Klasse, wird sie in `website.css` ergänzt (additiv, eigener Abschnitt am Ende).

## Seitentypen und Fehlerseiten

| Datei                                   | Funktion                                 | Design     | Inhalt                                                                                                              |
| --------------------------------------- | ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `<adresse>/index.html`, `index.html`    | `rendereSeite`                           | W1, W2, W4 | Titel, Bausteine; Startseite mit Teaser; Stufenfakten neben dem Text davor                                          |
| `<adresse>/index.html` (ganz geschützt) | `rendereHuelle`                          | W10        | Titel «Geschützte Seite», Hinweis und Link «Anmelden»; das Skript ersetzt sie nach der Anmeldung                    |
| `anmelden/index.html`                   | `rendereAnmeldung`                       | W9         | Formular, zweiter Faktor, Zustände durch `anmelden.js`                                                              |
| `404.html`                              | `rendereFehlerseite` (`fehlerseiten.ts`) | #567       | «Diese Seite gibt es nicht.», Knöpfe «Zur Startseite» und «Termine ansehen», E-Mail der Abteilung für kaputte Links |
| `500.html`                              | `rendereServerfehler`                    | #567       | «Bei uns ist etwas schiefgegangen.», Link «Nochmals versuchen» (dieselbe Adresse), «Zur Startseite»                 |
| `wartung.html`                          | `rendereWartung`                         | #567       | «Wir sind gleich wieder da.», «Nochmals versuchen»                                                                  |
| `<alte-adresse>/index.html`             | `rendereWeiterleitungsseite`             | #567       | «Diese Seite ist umgezogen», Knopf «Weiter zur neuen Adresse», `meta refresh`                                       |
| `index.html`/`404.html` bei Sperre      | `HINWEISSEITE` (`sperre.ts`)             | #567       | Neutrale Seite mit eigener Stildatei `gesperrt.css` (die Stilvorlage ist dann gelöscht)                             |

### Fehlerseiten (#567)

Die Fehlerseiten haben die Anlage des Kopfs der Startseite (`fehlerBuehne` in `src/website/fehlerseiten.ts`, Stil `website/fehler.css`, nur auf diesen Seiten geladen): Wo dort das Titelbild steht, steht ein getöntes Feld bis zum Fensterrand mit der Nummer des Fehlers in Archivo 900 (Schmuck, `aria-hidden`), die blaue Fahne mit dem Satz und den Knöpfen ragt von links hinein, daneben steht in einem bis zwei Sätzen, was nun geht, und klein der Code. Sie wiederholen das Menü nicht: Es steht im Kopf. Die 404-Seite nennt die zwei Wege, die fast immer weiterhelfen (Startseite, Termine), und die E-Mail der Abteilung (`KONTAKT_EMAIL`), wenn es sie gibt.

- Kein Bild, kein Abruf, kein Skript ausser `theme.js`: `500.html` und `wartung.html` stehen auch, wenn die API nicht antwortet (nur das Logo im Kopf ist ein Bild der API; fehlt es, steht sein Alt-Text).
- Die Rückfallseite einer Weiterleitung und die Hinweisseite der Informationssperre haben keinen Kopf und kein Feld: nur die Fahne mit Satz und Knopf. Die Hinweisseite steht allein (eigene Datei `gesperrt.css` mit den Farben in Tag und Nacht, geschrieben und gelöscht von `sperre.ts`); die Schrift bleibt bei einer Sperre liegen. Ein Inline-Stil bliebe unter der CSP des Hosts (`style-src 'self'`) wirkungslos.
- Bewegung: ein Auftritt beim Laden (Ziffern setzen sich, Fahne von links), nichts bei «Bewegung reduzieren».

Geschützte Bausteine tragen im statischen HTML einen Platzhalter mit dem Hinweis «Nur angemeldet sichtbar» und dem Link «Anmelden» (nie Typ oder Inhalt). `geschuetzt.js` tauscht ihn nach der Anmeldung aus und zeigt dabei die Zustände Laden (Skeleton), Fehler, nicht angemeldet und kein Zugriff.

### Abbildung der Bausteine

| Baustein                    | Darstellung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Überschrift                 | `h2` bis `h4` in der Reihenfolge der Seite                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Text                        | `.text.lesetext`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Bild, Galerie               | `figure` mit `img` (Radius 12 px) und `figcaption`; Galerie als Raster                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Karten                      | «Karten»: `ul.karten`, Kachel mit feinem Rand, der Link «Mehr zu …» deckt die Kachel ab; «Liste»: `ul.liste`, Zeilen mit Link am Titel; «Merkmale»: `ul.merkmale` in einem blauen Band (`.sektion--marke`), grosse Stichworte mit Text, ohne Link und ohne Symbol, auf Wunsch je mit Foto; «Bildkarten» (`stufen`): `ul.stufenkarten`, Foto mit Etikett im Bild (`.alterschip`: Alter oder Preis), Titel, Text, ein Link im Titel deckt die Karte ab; «Zeitstrahl»: `ol.zeitstrahl`; «Zahlen»: `ul.zahlen` |
| Schaltfläche                | erste: `.btn.p.gross`, weitere: `.btn.s.gross`; Darstellung «Link»: Verweis mit Pfeil (`.verweis`). Schaltflächen, die unmittelbar aufeinander folgen, stehen in einer Zeile als Gruppe (`div.knopfreihe.aktionen`): gleiche Form und Höhe, nur die Hauptaktion ist gefüllt, ein Verweis ist dort ein Knopf mit Rand und Pfeil                                                                                                                                                                             |
| Datei                       | `p.datei.karte` mit Link auf den Ablageort                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Kontaktperson, Leitungsteam | `ul.team` mit `li.person` (Avatar mit Initialen, Name, Funktion)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Stufenfakten, Eckdaten      | `dl.fakten.karte` (blaue Tafel); neben dem Text und den Bildern davor (zweispaltig). «Eckdaten» trägt frei benannte Angaben (Datum, Ort, Kosten)                                                                                                                                                                                                                                                                                                                                                           |
| Trenner, Videolink          | `hr` oder Abstand, einfacher Link                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Terminliste                 | `section.abschnitt` mit `h2` «Das steht an», Link «Alle Termine» und `ul.termine` (Daten aus dem Abgleich, siehe [website-auslieferung.md](website-auslieferung.md)); die einzige Liste kommender Anlässe einer Seite                                                                                                                                                                                                                                                                                      |
| Hinweis                     | `div.band` mit Symbol, Satz (`strong`) und optionalem Link                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Kontaktkarte                | `section.kontaktkarte`; Telefon und E-Mail aus der Konfiguration                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Aufruf                      | `div.aufruf` in einem roten Band über die ganze Breite: Titel, Text, eine weisse Schaltfläche                                                                                                                                                                                                                                                                                                                                                                                                              |

Das erste Bild einer Seite ist ihr Titelbild und geht bis zum Fensterrand; der Seitentitel steht in der blauen Fahne, die von links unten ins Bild ragt. Auf der Startseite (Adresse `/`) stehen in der Fahne zusätzlich die Schaltflächen vom Anfang der Seite, der erste Text steht daneben. Ohne Bild steht der Titel gross auf der Fläche mit dem roten Strich darunter. Das Titelbild lädt sofort (`fetchpriority="high"`), die Bilder der ersten drei Abschnitte sofort ohne Vorrang, alle weiteren nachladend.

## Hinweise für den Betrieb

- Der Host liefert `500.html` bei 5xx-Fehlern der Website und `wartung.html` mit Status 503 (Vorschlag im Abschnitt «Vorschlag für den Edge-Caddy» in [website-auslieferung.md](website-auslieferung.md)).
- Die Vorschau im Editor nutzt dieselbe Stilvorlage (`/admin/website-vorschau.css` ist `website.css`).
- Nach einer Änderung an Renderer oder Stilvorlage schreibt der Abgleich alle Dateien beim nächsten Lauf neu (der Hash ändert sich).
