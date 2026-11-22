# Design der Website: Hülle, Tokens, Komponenten

Die öffentliche Website folgt dem Design «Cevi Web» (Tag und Nacht, Desktop und Mobile). Dieses Dokument beschreibt, was der Renderer (`apps/api/src/website/rendern.ts`) und die Stilvorlage (`apps/api/public/website/website.css`) dafür bereitstellen und wie ein neuer Seitentyp sie nutzt. Ablauf der Auslieferung: [website-auslieferung.md](website-auslieferung.md). Prüfpunkte: [barrierefreiheit.md](barrierefreiheit.md), Abschnitt 11.

## Regeln der Ausgabe

- **Eine Stilvorlage, kein Inline-Stil.** Die CSP der Seiten erlaubt `style-src 'self'`: Alle Stile stehen in `website/website.css`, nie in `style=`-Attributen oder `<style>`-Blöcken. Die Vorschau im Editor und die Sperrseite sind die einzigen Ausnahmen (siehe unten).
- **Kein Skript nötig.** Ein Skript laden nur Seiten mit geschützten Bausteinen (`geschuetzt.js`) und die Anmeldeseite (`anmelden.js`) sowie jede Seite mit Navigation das Menü (`menue.js`, nur Pfeiltasten und Esc als Verbesserung); es gibt nie ein Inline-Skript. Das Menü am Handy ist ein `<details>`-Element, die Untermenüs öffnen sich bei Hover und Fokus.
- **Nichts von aussen.** Archivo als eigene Datei (`website/archivo-latin.woff2`, SIL OFL, `@font-face` mit `font-display: swap`, CSP `font-src 'self'`), Bilder nur aus dem Medienspeicher (`/api/v1/medien/<ID>`), Symbole als Inline-SVG.
- **Tag und Nacht** über `prefers-color-scheme`; `<meta name="color-scheme" content="light dark">` und `color-scheme` am `:root` sorgen für Formularelemente und Scrollleisten.
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
- **Marke:** «Cevi Stäfa» wird zu `CEVI` und `Stäfa` (`markenname()`).
- **Navigation:** Die Leiste hat eine Zeile. Höchstens sechs Punkte und 80 Zeichen aller Titel stehen darin (der Rest unter «Mehr», einem `<details>`); ein Punkt mit Unterseiten hat ein Untermenü (`li.mit-unter`, offen bei Hover und Fokus, Pfeiltasten und Esc mit `menue.js`). Die Unterseiten des gewählten Bereichs stehen zusätzlich in der Unterleiste, im Menü am Handy (ab 74 em) der ganze Baum. Die aktuelle Seite trägt `aria-current="page"`, ihre Oberseiten `aria-current="true"`. Die Seiten `impressum` und `datenschutz-website` stehen im Fuss, nicht in der Leiste.
- **Anmelden:** Ein Link auf `/anmelden`. Die statischen Seiten kennen die Sitzung nicht; ein Konto-Menü für angemeldete Personen (Design W11) gibt es darum nicht (Lücke, siehe PR).
- **Fusszeile (W1):** drei Spalten (Name und Anschrift, Telefon und E-Mail, Impressum und Datenschutz) und «©». Die Angaben kommen aus der Konfiguration (siehe [website-auslieferung.md](website-auslieferung.md), «Konfiguration»); was fehlt, fehlt auch im Fuss.
- **Optionen von `rahmen()`:** `nurMarke` (nur das Logo, für Wartung und Serverfehler), `robots`, `canonical`, `skript` (erlaubt zusätzlich `script-src` und `connect-src` im Meta-CSP), `hauptAttr`.

## Klassen und Komponenten

| Klasse                                                             | Bedeutung                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `.wrap`                                                            | Spalte (76 rem breit, seitlicher Rand 48/24/20 px)                                                |
| `.seitenkopf`                                                      | Block mit dem `h1` (und optional `.unter`, `.kicker`, `.knopfreihe`)                              |
| `.inhalt`                                                          | Spalte der Bausteine, Abstand 24 px; `h2` bekommt mehr Luft                                       |
| `.abschnitt`, `.abschnitt-kopf`                                    | Abschnitt mit Überschrift und «Alle …»-Link rechts                                                |
| `.zweispalten` mit `.spalte` und `aside`                           | Text links, Kasten rechts (380 px); am Handy untereinander                                        |
| `.lesetext`                                                        | Fliesstext, höchstens 70 Zeichen breit                                                            |
| `.karte`                                                           | Fläche mit Rand und Radius 12 px                                                                  |
| `.btn` mit `.p` (rot), `.s` (Rand), `.t` (Text), `.gross`, `.voll` | Knöpfe; nur eine rote Hauptaktion je Seite; `aria-disabled="true"` und `aria-busy` im Ladezustand |
| `.chip` mit `.st`, `.ok`, `.fe`, `.wa`                             | Etikett (Stufe, Erfolg, Fehler, Warnung); Zustand nie nur über Farbe, immer mit Wort              |
| `.band` mit `.ok`, `.fe`, `.wa`, `.oben`                           | Hinweisband mit Symbol, `strong` als Titel und Text; `role="status"` oder `role="alert"`          |
| `.zustand` mit `.fe`                                               | Zustand im Inhalt (leer, Fehler, kein Zugriff): `.kopfzeile` mit Symbol, Text, Aktion             |
| `.schutz`, `.schutzblock`                                          | Hinweis «Nur angemeldet sichtbar» mit Link «Anmelden»                                             |
| `.termine`, `.termin`, `.datum`                                    | Termin-Liste: Datumskachel (`.tag`, `.nr`, `.mo`), `.titel`, `.meta`, `.chips`                    |
| `.team`, `.person`, `.ava`                                         | Leitungsteam mit Avatar (Initialen), `.name`, `.funktion`                                         |
| `.fakten`, `.fakt`                                                 | Faktenkasten (`dt` Bezeichnung, `dd` Wert)                                                        |
| `.karten`, `.liste`                                                | Bausteine «Karten» (Stufenkarte: Raster mit rotem Rand oben, Name, Text, «» Mehr zu …») und Liste |
| `.titelbild`                                                       | Bild über die ganze Breite am Anfang der Startseite, ausserhalb der Spalte (W1)                   |
| `.galerie`                                                         | Kacheln im Seitenverhältnis 4:3 mit Platzhalterfläche, auch ohne geladene Bilder                  |
| `.kontaktband`                                                     | Kontaktkarte: Frage und Ansprechperson links, `.wege` (Telefon, E-Mail) rechts                    |
| `.mit-unter`, `.unter`, `.weitere`                                 | Untermenü eines Punktes der Leiste und «Mehr»                                                     |
| `.datei`                                                           | Verknüpfung auf eine Datei im SharePoint mit `.info` (Typ, Grösse)                                |
| `.teaser` mit `.box`                                               | Startseite: Foto und blaue Box mit `h1`                                                           |
| `.formular`, `.feld`, `.eingabe`, `.pw`, `.hilfe`, `.fehlertext`   | Formulare (Anmelden); Fehler stehen als Text beim Feld und in einer Zusammenfassung oben          |
| `.sk`, `.skel`, `.skel-rahmen`, `.schimmer`                        | Skeleton (siehe unten)                                                                            |
| `.nur-sr`                                                          | Nur für Screenreader                                                                              |
| `.i`                                                               | Symbol (Inline-SVG, 24 px, `currentcolor`)                                                        |

`[hidden]` blendet immer aus (`display: none !important`).

### Symbole

`symbol(name)` in `rendern.ts` liefert ein Inline-SVG als `HtmlKnoten` (`info`, `warnung`, `schloss`, `person`, `menue`, `schliessen`, `nochmals`, `auge`, `auge-zu`). Das Skript für geschützte Bausteine kennt keine SVG-Elemente (`knoten.js`); Bausteine tragen darum keine Symbole. Skripte erzeugen Symbole mit `symbol()` aus `website/ui.js`.

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

## Neuer Seitentyp

1. Inhalt in `rahmen(k, { titel, aktuell, inhalt, … })` übergeben. `inhalt` ist fertiges Markup, das in `.wrap` steht. `titel` landet im `<title>` («Titel | Abteilung»), den `h1` schreibt der Seitentyp.
2. Strings maskieren mit `esc()`, Bausteine nur über `HtmlKnoten` (`el()`, `serialisiere()`), Adressen nur über `linkArt()`; nie Rohtext aus der Datenbank ins Markup.
3. Seitenkopf: `<div class="seitenkopf"><h1>Titel</h1></div>`, danach `<div class="inhalt">…</div>` oder eigene Abschnitte mit `.abschnitt`.
4. Zustände (leer, Fehler, kein Zugriff, Laden) mit `.zustand` und `.skel-rahmen`; Fehler mit `role="alert"` und einer Aktion («Nochmals versuchen»).
5. Neue Datei in `abgleich.ts` (`gesamt`) eintragen und in `test/website-abgleich.test.ts` und `test/website-ausgabe.test.ts` nachführen.
6. Neue Klassen in `website.css` nur mit Token-Farben, in `rem`, mit Fokuszustand; danach hier eintragen.

Die Seiten für Termine und Anlässe (Boards W3, W5 bis W8) bauen auf `.termine`, `.termin`, `.datum`, `.chip`, `.band`, `.zustand`, `.skel` und `.formular` auf; fehlt eine Klasse, wird sie in `website.css` ergänzt (additiv, eigener Abschnitt am Ende).

## Seitentypen und Fehlerseiten

| Datei                                   | Funktion                     | Design     | Inhalt                                                                                           |
| --------------------------------------- | ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `<adresse>/index.html`, `index.html`    | `rendereSeite`               | W1, W2, W4 | Titel, Bausteine; Startseite mit Teaser; Stufenfakten neben dem Text davor                       |
| `<adresse>/index.html` (ganz geschützt) | `rendereHuelle`              | W10        | Titel «Geschützte Seite», Hinweis und Link «Anmelden»; das Skript ersetzt sie nach der Anmeldung |
| `anmelden/index.html`                   | `rendereAnmeldung`           | W9         | Formular, zweiter Faktor, Zustände durch `anmelden.js`                                           |
| `404.html`                              | `rendereFehlerseite`         | W4         | «Diese Seite gibt es nicht.», Link zur Startseite, Hauptpunkte                                   |
| `500.html`                              | `rendereServerfehler`        | W4         | «Bei uns ist etwas schiefgegangen.», Link «Nochmals versuchen» (dieselbe Adresse)                |
| `wartung.html`                          | `rendereWartung`             | W4         | «Wir sind gleich wieder da.»                                                                     |
| `index.html`/`404.html` bei Sperre      | `HINWEISSEITE` (`sperre.ts`) | –          | Neutrale Seite mit Inline-Stil (die Stilvorlage ist dann gelöscht)                               |

Geschützte Bausteine tragen im statischen HTML einen Platzhalter mit dem Hinweis «Nur angemeldet sichtbar» und dem Link «Anmelden» (nie Typ oder Inhalt). `geschuetzt.js` tauscht ihn nach der Anmeldung aus und zeigt dabei die Zustände Laden (Skeleton), Fehler, nicht angemeldet und kein Zugriff.

### Abbildung der Bausteine

| Baustein                    | Darstellung                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Überschrift                 | `h2` bis `h4` in der Reihenfolge der Seite                                                                                                                              |
| Text                        | `.text.lesetext`                                                                                                                                                        |
| Bild, Galerie               | `figure` mit `img` (Radius 12 px) und `figcaption`; Galerie als Raster                                                                                                  |
| Karten                      | «Karten»: `ul.karten`, je Eintrag Überschrift (`h3`, nie ein Link), Text und «» Mehr zu …»; «Liste»: `ul.liste` mit Link am Titel                                       |
| Schaltfläche                | erste: `.btn.p.gross`, weitere: `.btn.s.gross`; Darstellung «Link»: einfacher Link                                                                                      |
| Datei                       | `p.datei.karte` mit Link auf den Ablageort                                                                                                                              |
| Kontaktperson, Leitungsteam | `ul.team` mit `li.person` (Avatar mit Initialen, Name, Funktion)                                                                                                        |
| Stufenfakten                | `dl.fakten.karte`; neben dem Text und den Bildern davor (zweispaltig)                                                                                                   |
| Trenner, Videolink          | `hr` oder Abstand, einfacher Link                                                                                                                                       |
| Terminliste                 | `section.abschnitt` mit `h2` «Nächste Termine», Link «Alle Termine» und `ul.termine` (Daten aus dem Abgleich, siehe [website-auslieferung.md](website-auslieferung.md)) |
| Hinweis                     | `div.band` mit Symbol, Satz (`strong`) und optionalem Link                                                                                                              |
| Kontaktkarte                | `section.karte.kontaktband`; Telefon und E-Mail aus der Konfiguration                                                                                                   |

Auf der Startseite (Adresse `/`) bilden ein Bild, ein Text und Schaltflächen am Anfang der Seite das Teaser-Feld (Foto links, blaue Box mit `h1` rechts); sonst steht der Titel im Seitenkopf. Stehen **zwei Bilder** am Anfang, ist das erste das Titelbild über die ganze Breite und das zweite das Foto im Teaser. Beide laden sofort (`fetchpriority="high"`), alle anderen Bilder nachladend.

## Hinweise für den Betrieb

- Der Host liefert `500.html` bei 5xx-Fehlern der Website und `wartung.html` mit Status 503 (Vorschlag im Abschnitt «Vorschlag für den Edge-Caddy» in [website-auslieferung.md](website-auslieferung.md)).
- Die Vorschau im Editor nutzt dieselbe Stilvorlage (`/admin/website-vorschau.css` ist `website.css`).
- Nach einer Änderung an Renderer oder Stilvorlage schreibt der Abgleich alle Dateien beim nächsten Lauf neu (der Hash ändert sich).
