# Gerüst der Verwaltung

Das Gerüst der Verwaltung unter `/admin` ist Teil **eines** Designsystems mit der öffentlichen Website (#578): dieselben Tokens, dieselbe Schrift, derselbe Kopf, dieselben Knöpfe, Chips, Karten, Felder, Auswahlfelder, Scrollleisten und dieselbe Bewegung. Die Dichte darf höher sein (Arbeitsoberfläche), die Handschrift ist dieselbe. Entstanden aus dem Design «Cevi Web» (Boards A1, A2, A30, G4 bis G6). Diese Seite ist die Anleitung für alle, die einen Bereich neu bauen. Die Seiten laufen ohne Build-Schritt, mit ES-Modulen und strenger CSP (keine Inline-Skripte, keine `style`-Attribute, keine fremden Hosts, keine fremden Schriften).

## Aufbau der Seite

```
Kopf (header.kopfzeile, wie website/kopf.css)
  Logozeile        Marke (Logo hell/dunkel oder Wortmarke «CEVI» mit Name), «Verwaltung», Konto, Umschalter Hell/Dunkel, Abmelden
  Bereichsleiste   weisses Band, ein Eintrag je Bereich, roter Strich unter dem aktuellen; haftet beim Scrollen oben
  Unterleiste      die Unterseiten des aktiven Bereichs auf der Fläche der Seite, Zähler als rote Pille; scrollt mit weg
main#inhalt        .rahmen (max. 90 rem wie der Kopf, Seitenrand clamp(1rem, 4vw, 4.5rem) wie --rand der Website)
  #seitenkopf      h1 + Untertitel + rechts die Hauptaktion
  #rueckmeldung    Meldungen; darunter die Toasts mit «Rückgängig»
  #bereich         hier zeichnet dein Modul
```

**Marke:** Name und Logo kommen aus den Einstellungen der Website (`GET /api/v1/redaktion/website`: `name`, `logoMediumId`, `logoDunkelMediumId`; das Bild liefert `/api/v1/medien/<id>`) und stehen nie im Code. Fehlt das Recht auf die Einstellungen (403) oder ist kein Logo gesetzt, steht die Wortmarke «CEVI» (mit dem Namen, wenn bekannt). Ein Logo ohne dunkle Fassung steht in der Nacht auf hellem Feld (`--logo-grund`). `setzeMarke()` in `rahmen.js` ersetzt die Marke; die Anmeldeseite trägt denselben Kopf ohne Konto.

**Umschalter Hell/Dunkel:** zwei Knöpfe mit Symbol (Sonne, Mond), `aria-pressed`, `role="group"`; die Wahl liegt im Browser (`localStorage`, Schlüssel `cevi-darstellung`, dieselbe wie auf der Website, `/admin/theme.js` ist `website/theme.js`). Ohne gespeicherte Wahl folgt die Verwaltung dem Gerät.

Die Leisten stehen im Kopf, nicht in einer Seitenleiste (G4). Unter 1100 px rücken Name und Rolle des Kontos zu den Screenreadern, unter 760 px laufen die Leisten waagrecht (nur die Verwaltung braucht so viele Bereiche; ein Menü wie am Handy der Website gibt es hier nicht).

`.kopfzeile` und `.leisten` sind `display: contents`: Logozeile, Bereichsleiste und Unterleiste sind Geschwister im Gerüst, damit nur die Zeile der Navigation haftet.

## Dateien (alle flach in `apps/api/public/admin/`)

## Hinweisband, System, Plattform, Erinnerungen, Mitteilungen (#593)

- **Hinweisband** (`hinweisband.js`): Solange ein Bereich in Wartung oder durch eine Informationssperre gesperrt ist, steht unter dem Kopf jeder Seite ein Band (Sperre rot, Wartung gelb, immer mit Wort und Symbol) mit Bereich, Zeitpunkt, Hinweistext und Verweis auf `#system/plattform`. Es erscheint nur für Personen, die die Plattform sehen (Abteilungsleitung, Plattformrecht `wartungsmodus.website`); wer nicht schalten darf, bekommt auch keinen Abruf. Quelle ist `GET /api/v1/plattform/schalter` (Speicher der API, keine Datenbankabfrage). Der Abruf läuft beim Öffnen der Verwaltung, nach jeder Schaltung auf der Plattform (Ereignis `plattform:geaendert`) und bei einer Navigation höchstens einmal je Minute, nie im Takt.
- **System** lädt nur beim Öffnen und auf «Aktualisieren», kein Polling (`aufWunsch` statt des früheren Takts von 15 Sekunden). Auf der Übersicht steht der Verlauf der Anfragen der letzten 24 Stunden als Säulen je Stunde mit Fehleranteil (`saeulen` aus `uebersicht-diagramme.js`, Tabelle dahinter).
- **Plattform** zeigt je Bereich eine Zeile mit Zustand (Chip), Einzelheiten und Aktionen; auf dem Handy stehen die Aktionen unter dem Text, es gibt keine Tabelle zum Seitwärtsscrollen. Das geplante Ende der Wartung ist ein `datumZeitFeld` (kein natives `datetime-local`); ein Datum ohne Uhrzeit wird beim Speichern gemeldet.
- **Erinnerungen** bauen den Zeitplan aus Wochentag (Segment mit Radioknöpfen), Uhrzeit (`zeitfeld`) und zeigen darunter die nächsten sechs Termine als Streifen (`naechsteTermine`, gerechnet in Schweizer Zeit). Die Liste nennt je Regel das nächste Mal.
- **Mitteilungen**: Formular links, Vorschau rechts (so sieht der Push aus, an wen er geht); die Rückfrage vor dem Senden bleibt ein zweistufiger Knopf. Die Spalten haben keine eigenen Scrollbereiche (`formularRaster` passt für ein so kurzes Formular nicht).
- **Komponenten** zeigt Personen ohne Entwicklerrolle eine Karte statt der Galerie; das Signal ist `nameAenderbar` in `GET /api/v1/redaktion/website`. Die Navigation blendet den Eintrag noch nicht aus.
  | `bildwahl.js`, `bildwahl.css` | Bildwahl in der Seite (Bilder der Medienbibliothek unter dem Feld) und `bildMitLader` (Platzhalter bis das Bild da ist) (#591) |
  | `website-einstellungen.css` | Vorschau der Website-Einstellungen (Klassen `ws-einst-`, `ws-v-`) (#591) |

Wer eine neue Datei anlegt, trägt sie ein: `docs/api/openapi.yaml` (Pfad `/admin/<Datei>`), `apps/api/test/rechte-matrix.test.ts` (Zeile `"GET /admin/<Datei>": { erwartet: alle(200) }`, **nur byte-erhaltend ändern**, die Datei enthält ungültige UTF-8-Bytes) und `index.html` für eine `.css`. Eine `.js`-Datei braucht keinen Eintrag in `index.html`: Der Router lädt sie mit `import()`. Der Server liest alle Dateien aus `public/admin/` ein (`src/seiten.ts`), Unterordner gibt es nicht.

## Wie ein Bereichsmodul sich anmeldet

1. Lege `apps/api/public/admin/<name>.js` an und exportiere `zeige(bereich, ctx)`.
2. Trage in `navigation.js` bei der Unterseite `modul: "./<name>.js"` ein. Fehlt `modul`, zeigt der Router `platzhalter.js`.
3. Eine neue `.css` bindest du in `index.html` ein (je eine Zeile, am Ende der Liste).

Die Struktur in `navigation.js`:

```js
{ schluessel: "termine", name: "Termine", symbol: "termine", start: "vorschlaege",
  unter: [
    { schluessel: "vorschlaege", name: "Vorschläge", modul: "./termine-vorschlaege.js",
      untertitel: "Terminvorschläge entscheiden.", zugang: "admin" },
  ] }
```

- `zugang`: `"admin"` (Vorgabe), `"alle"`, oder ein Bereich aus `GET /api/v1/redaktion/ich` (`"website"`, `"plattform"`). Die Anzeige folgt dem Server, jede Route prüft selbst.
- Ein Bereich mit nur einer Unterseite hat keine Unterleiste; alles nach dem Bereich gehört dem Modul (`#website/seiten/<id>`).
- Adressen: `#<bereich>` (landet auf `start` oder der ersten Unterseite), `#<bereich>/<unterseite>`, `#<bereich>/<unterseite>/<rest…>`. `ctx.pfad` ist der Rest.
- Alte Adressen stehen in `ALIASE` (`#tags` → `#personen/gruppen`, `#termine/raeume` → `#raeume/raeume` …). Ein Link, den ein Modul setzt, muss die neue Adresse nennen.
- Ein Bereich, den es gibt, den die Rolle aber nicht sieht, zeigt «Kein Zugriff» (403) mit der Leiste, ein unbekannter Hash «Diese Seite gibt es nicht» (404).

### `ctx`

```js
ctx = {
  ich,                      // das Konto (better-auth), nur lesen
  zugang,                   // { redigieren, bereiche, verwalten, rechte, darf(recht) }, nur für die Anzeige
  pfad,                     // Rest der Adresse, z. B. ["<id>"]
  seite: { bereich, unter },// Eintrag aus navigation.js
  melde(text, art, aktion), // Rückmeldung: art «ok» | «info» | «warn» | «fehler»; aktion { text, onclick }
  lade(laden, zeichnen, { skeleton }), // Laden mit Skeleton, siehe unten
  erstelleLader(container), // eigener Lader für einen Unter-Container
  kopfAktion(...knoten),    // Hauptaktion rechts im Seitenkopf (genau eine rote je Ansicht)
  titel(text, untertitel),  // Titel und Untertitel ersetzen, z. B. mit dem Namen eines geöffneten Eintrags
  zaehler(unterSchluessel, n), // Zähler der Unterleiste; nur melden, wenn du die Zahl ohnehin geladen hast
}
```

Jede Navigation baut `#bereich` neu auf; ein Modul hält seinen Zustand selbst (Adresse, Modulvariable), nicht im DOM. Kein Polling.

### Beispiel

```js
import { anfrage } from "./api.js";
import { el, knopf, tabelle } from "./dom.js";
import { leerKarte } from "./zustaende.js";

export function zeige(bereich, ctx) {
  ctx.kopfAktion(
    knopf("Raum anlegen", { art: "haupt", symbol: "plus", onclick: anlegen }),
  );
  ctx.lade(
    () => anfrage("GET", "/api/v1/admin/raeume"),
    (daten, neuLaden) => {
      if (daten.length === 0) {
        bereich.append(leerKarte("Noch kein Raum angelegt."));
        return;
      }
      const t = tabelle({
        beschriftung: "Räume",
        spalten: ["Name", "Aktionen"],
        zeilen: [],
      });
      bereich.append(t.wurzel);
      // … Zeilen mit el("tr", …)
    },
    { skeleton: "tabelle" },
  );
}
```

## Übersicht (#583)

Die Übersicht ist ein Dashboard: Sie zeigt je Rolle, was jetzt zu tun ist und wie es der Abteilung geht. Sie lädt **einen** Abruf, `GET /api/v1/admin/uebersicht` (beim Öffnen und auf «Aktualisieren», kein Polling). Der Server gibt jeder Person nur die Teile, die sie sehen darf (Rechte je Teil: siehe die Beschreibung der Route in `docs/api/openapi.yaml` und Bedrohung 50); die Oberfläche blendet nur aus, was in der Antwort fehlt, und verlässt sich auf nichts.

- **Aufbau:** «Jetzt zu tun» (Kachel je offener Punkt mit Zahl und Sprung auf den richtigen Bildschirm; erledigtes steht in einem Satz) · «Kennzahlen» (Wert, Vergleich mit dem Zeitraum davor, kleine Grafik) · «Kommendes» und «Kinder je Stufe» · «Zustand» (Website, Kalender-Abgleich, Medien, Datenbank). Das Raster füllt die Breite des Rahmens (`auto-fit`, mindestens 240 bis 260 px je Kachel), wenige Kacheln werden breiter.
- **Sprung:** Eine Aufgabenkachel ist nur dann ein Link, wenn die Person die Zielseite sehen darf (`darfSehen` aus `navigation.js`); sonst zeigt sie nur die Zahl.
- **Zustände je Kachel:** Lädt (Skelett in der Form der Seite), leer (ein Satz), Fehler (steht der Teil in `fehlt`, zeigt nur diese Kachel «Nochmals versuchen»; der Rest bleibt). Fehlt die ganze Antwort, zeigt `ctx.lade` die Fehlerkarte der Seite.
- **Diagramme** (`uebersicht-diagramme.js`): Inline-SVG, Farben nur über Klassen aus den Tokens (Randfarbe für die Vergangenheit, Akzent für den aktuellen Zeitraum, Fehlerfarbe für Fehler), Säulen immer ab 0, Fehleranteil als zweiter Teil mit 2 px Luft. Jede Grafik hat einen Satz mit allen Werten für Screenreader (`role="img"`), eine Ablesung mit Zeiger oder Pfeiltasten (Text darunter, `aria-live`) und eine Entsprechung als Tabelle; der Schalter «Tabellen statt Diagramme» tauscht beide für die ganze Seite. In erzwungenen Farben tragen Form und Umriss die Information (der Fehleranteil wird zum Umriss).
- **Neue Kachel:** eine Funktion in `uebersicht-kacheln.js`, die aus der Antwort einen Knoten baut (`kachel({ titel, inhalt })`) und `null` liefert, wenn der Teil fehlt; ein Eintrag in `zeichne` von `uebersicht.js`. Der Teil gehört zuerst in die Route (`routes/admin/uebersicht.ts`) mit seinem eigenen Recht, Eintrag in OpenAPI und Test.
- **Zähler der Unterleiste** (Vorschläge, Ohne Kategorie, Anfragen) kommen aus denselben Zahlen (`ctx.zaehler`), ohne eigene Abfrage; sie sind jetzt exakt statt «100+».

## Website: Medien, Einstellungen, Stufenfelder und Lädeli (#591)

- **Zweispalter:** Felder links, Bild oder Vorschau rechts (`formularRaster` aus `formularraster.js`). Auf Seiten mit Kopf und in Formularen mit Knöpfen unter dem Raster steht es in einem Knoten mit der Klasse `ws-frei` (Stil in `bildwahl.css`): Das Raster wächst mit, nur die rechte Spalte bleibt beim Scrollen stehen, und eine Flussseite mit `ws-frei` ist so breit wie die breiten Seiten.
- **Website-Einstellungen:** links Name und die vier Bildfelder, rechts «So sieht es aus» (Kopf am Tag, Kopf in der Nacht, Tab im Browser, Fehlerseite). Die Vorschau folgt jeder Wahl und dem Namen; der Zustand «Nicht gespeichert» steht als Wort mit Punkt in der Leiste unten.
- **Bildwahl in der Seite** (`bildwahl.js`): Ein Knopf öffnet die Bilder unter dem Feld (Suche im Alt-Text, 24 Bilder je Anfrage, nur öffentliche Bilder). Ein Klick wählt und schliesst; Escape schliesst nur die Wahl. Kein Fenster über der Seite. Eine Wahl löst ein `change` am Formular aus, damit die Frage «Änderungen verwerfen?» greift.
- **Medien:** Ansicht Raster oder Liste (dieselben Karten, `medien--liste`; die Wahl merkt sich der Browser), Filterleiste (`filterleiste.js`: Suche im Alt-Text auf dem Server, Art und Sichtbarkeit auf den geladenen Medien, Trefferzahl), Auswahlleiste am unteren Rand mit «Alle wählen», «Löschen» (mit «Rückgängig») und «Auswahl aufheben». Alt-Text ändern und Hochladen sind Seiten im Fluss mit dem Bild gross neben den Feldern.
- **Ladezustände:** Bilder haben einen Platzhalter bis zum Laden (`bildMitLader`), Karten laden als Skeleton (Raster, Nachladen, Suche), Einstellungen, Bestellungen und Artikel haben ein Skeleton in ihrer Form.
- **Stufenfelder:** Stufen als Pillen, Datum und Zeit mit `datumsfeld.js`, rechts im Formular «So steht es auf der Stufenseite».
- **Lädeli:** Bestellungen sind Karten mit einer Statusschiene Offen, Bereit, Übergeben (`aria-current="step"`, erledigt mit Haken) und einem geteilten Knopf (nächster Schritt, im Menü die übrigen Wechsel). Artikel öffnen als Seite mit dem Bild gross neben den Feldern und der Bildwahl; die Reihenfolge der Artikel bleibt unverändert (Griff, Tastatur, Menü «Mehr»).

## Hinweisband, System, Plattform, Erinnerungen, Mitteilungen (#593)

- **Hinweisband** (`hinweisband.js`): Solange ein Bereich in Wartung oder durch eine Informationssperre gesperrt ist, steht unter dem Kopf jeder Seite ein Band (Sperre rot, Wartung gelb, immer mit Wort und Symbol) mit Bereich, Zeitpunkt, Hinweistext und Verweis auf `#system/plattform`. Es erscheint nur für Personen, die die Plattform sehen (Abteilungsleitung, Plattformrecht `wartungsmodus.website`); wer nicht schalten darf, bekommt auch keinen Abruf. Quelle ist `GET /api/v1/plattform/schalter` (Speicher der API, keine Datenbankabfrage). Der Abruf läuft beim Öffnen der Verwaltung, nach jeder Schaltung auf der Plattform (Ereignis `plattform:geaendert`) und bei einer Navigation höchstens einmal je Minute, nie im Takt.
- **System** lädt nur beim Öffnen und auf «Aktualisieren», kein Polling (`aufWunsch` statt des früheren Takts von 15 Sekunden). Auf der Übersicht steht der Verlauf der Anfragen der letzten 24 Stunden als Säulen je Stunde mit Fehleranteil (`saeulen` aus `uebersicht-diagramme.js`, Tabelle dahinter).
- **Plattform** zeigt je Bereich eine Zeile mit Zustand (Chip), Einzelheiten und Aktionen; auf dem Handy stehen die Aktionen unter dem Text, es gibt keine Tabelle zum Seitwärtsscrollen. Das geplante Ende der Wartung ist ein `datumZeitFeld` (kein natives `datetime-local`); ein Datum ohne Uhrzeit wird beim Speichern gemeldet.
- **Erinnerungen** bauen den Zeitplan aus Wochentag (Segment mit Radioknöpfen), Uhrzeit (`zeitfeld`) und zeigen darunter die nächsten sechs Termine als Streifen (`naechsteTermine`, gerechnet in Schweizer Zeit). Die Liste nennt je Regel das nächste Mal.
- **Mitteilungen**: Formular links, Vorschau rechts (so sieht der Push aus, an wen er geht); die Rückfrage vor dem Senden bleibt ein zweistufiger Knopf. Die Spalten haben keine eigenen Scrollbereiche (`formularRaster` passt für ein so kurzes Formular nicht).
- **Komponenten** zeigt Personen ohne Entwicklerrolle eine Karte statt der Galerie; das Signal ist `nameAenderbar` in `GET /api/v1/redaktion/website`. Die Navigation blendet den Eintrag noch nicht aus.

## Laden, Leer, Fehler

`ctx.lade(laden, zeichnen, { skeleton })` (`lader.js`) macht, was G5 verlangt:

- Skeleton erst nach 250 ms, danach mindestens 400 ms; kommt die Antwort früher, gibt es keines.
- Nach 4 Sekunden: «Das dauert länger.» mit «Nochmals versuchen».
- Skeleton nur beim ersten Laden. Ruft `zeichnen` die zweite Funktion (`neuLaden`) auf, bleibt der alte Inhalt, darüber steht «Wird aktualisiert …».
- Fehler: Zustandskarte mit «Nochmals versuchen» (bei 404 zusätzlich «Zur Übersicht»); der Fokus liegt auf dem Titel.
- `skeleton`: `"tabelle"` (Vorgabe), `"flaeche"`, `"formular"`, `"detail"`, `"liste"`, eine Funktion, die einen Knoten liefert, oder `false`. Bausteine: `sk(art, breite)`, `skeletonTabelle`, `skeletonFlaeche`, `skeletonFormular`, `skeletonDetail`, `skeletonListe`. Breiten sind Klassen (`sk-b<px>`), weil die CSP `style`-Attribute verbietet.
- Der Skeleton hat die Form des echten Inhalts (gleiche Spaltenzahl, Höhen, Radien), pulsiert nur bei erlaubter Bewegung und ist `aria-hidden`; die Information liefert die Live-Region «Lädt …».

Zustände in `zustaende.js`:

| Zustand                                             | Baustein                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Leer                                                | `leerKarte("Gerade ist nichts offen.", [knopf])`                                     |
| Fehler in einer Fläche                              | `zustandsKarte(zustandsDaten(fehler), [nochmals(fn)])`                               |
| Ganze Seite (401 bis 503, offline, Wartung, Sperre) | `rahmenzustand(zustandsDaten(fehler), [knöpfe])`                                     |
| Kein Zugriff, 404                                   | macht der Router; ein Modul liefert bei 403 und 404 einfach den Fehler an `lade`     |
| Validierung                                         | `feld`-Fehler beim Feld (`aria-invalid`, `.feld-fehler`), Zusammenfassung im Hinweis |

`zustandsDaten(f)` kennt 401, 403, 404, 429, 502/503, offline (`status 0`), `IN_WARTUNG` und `GESPERRT`.

Für Fehler ohne eigenen Fall (500 und andere) kann eine Ansicht den Titel nennen, den ihr Board vorgibt: `ctx.lade(mitFehlertitel("Die Gruppen konnten nicht geladen werden.", laden), …)` (`liste-hilfen.js`). Der Fehler trägt dann `zustandTitel`; `zustandsDaten` zeigt ihn mit «Prüfe die Verbindung und versuche es nochmals.». Verbindung, Sitzung, Rechte und 404 behalten ihre Texte.

## Rückmeldungen

`ctx.melde(text, art, aktion)` stapelt Hinweise in einer Live-Region (`#rueckmeldung`). Jede hat «Hinweis schliessen». Erfolg und Info (`ok`, `info`) ohne Aktion blenden nach 6 Sekunden von selbst aus; die Zeit hält an, solange der Zeiger auf der Meldung steht oder der Fokus darin liegt, und beginnt danach neu. Warnungen, Fehler und jede Meldung mit einer Aktion bleiben, bis man sie schliesst. Fehler sind `role="alert"`. Dieselbe Meldung ersetzt sich, statt sich zu stapeln. `melde("")` leert alle; der Router tut das bei jeder Navigation.

### Aktionen mit «Rückgängig» statt Rückfrage (#578)

Es gibt keine Rückfrage-Dialoge mehr («Wirklich löschen?»). Was sich zurücknehmen lässt, läuft über **eine** Funktion, `ctx.mitRueckgaengig(...)` (oder `mitRueckgaengig` aus `rueckgaengig.js`): Die Aktion wird sofort angezeigt, aber erst nach einer Frist von 8 Sekunden an die API geschickt.

```js
ctx.mitRueckgaengig({
  text: "Seite «Wölfe» gelöscht", // Vergangenheit, so steht es im Toast und in der Statusregion
  ansicht: ansichtVonKnopf(e), // optional: { weg(), zurueck() }; blendet die Zeile sofort aus
  ausfuehren: () => anfrage("DELETE", `/api/v1/…`), // die verzögerte Anfrage, wirft bei Fehlern
  fehlertext: (f) => fehlertext(f), // Text bei Fehlern
  danach: neu, // nach Erfolg: Liste neu laden o. ä.
  rueckgaengig: () => {}, // optional: wenn die Person zurücknimmt
  erledigt: "Erledigt.", // optional
});
```

- Der Toast (unten links, am Handy volle Breite) trägt den Text, «Rückgängig», einen Schliessen-Knopf und einen Balken, der in 8 Sekunden abläuft (nur bei erlaubter Bewegung). Zeiger und Fokus halten die Frist an. «Schliessen» heisst in der Frist «jetzt ausführen» (Beschriftung «Jetzt ausführen und schliessen»), nie «verwerfen».
- «Rückgängig» geht per Knopf, mit Strg oder Cmd + Z (ausser in Eingabefeldern, dort gilt das Rückgängig des Feldes) und über F6, das den Fokus auf den ersten Knopf setzt. Der Toast bekommt den Fokus nie von selbst; die Region steht im Seitenaufbau gleich nach dem Kopf, und die Statusregion sagt die Aktion mit der Möglichkeit zum Rückgängigmachen an («… Rückgängig mit dem Knopf oder mit Strg Z.»).
- Nach der Frist läuft die Anfrage; der Toast wechselt zu «Erledigt.» und geht nach 6 Sekunden von selbst. Ein Fehler stellt die Ansicht wieder her und bleibt als Toast (`role="alert"`) stehen, bis man ihn schliesst.
- Verlässt die Person die Seite oder den Tab vor Ablauf (`pagehide`) oder meldet sie sich ab, laufen alle offenen Aktionen sofort (mit `keepalive`), nie still verworfen. Mehrere Aktionen stapeln sich.
- Die Logik steht rein in `rueckgaengig.js` (Zeitgeber einsetzbar, Test `admin-rueckgaengig.test.ts`), die Darstellung in `rahmen.js` (`erstelleToasts`) und `toast.css`.

**Ausnahmen** (Folge trifft sofort andere oder ist nicht umkehrbar): kein Popup, sondern ein Knopf mit zwei Stufen, `zweistufig(knopf, frage, ausfuehren)` (`zweiStufig` für Knöpfe in Formularen). Der erste Klick macht ihn scharf («Wirklich senden?»), der zweite führt aus; ohne Bestätigung fällt er nach 6 Sekunden zurück, Escape nimmt die Frage zurück, eine Statusregion sagt sie an. So laufen: Mitteilung senden, Import ausführen, neues Startpasswort erzeugen, Person aktivieren (neues Startpasswort), zweiten Faktor zurücksetzen, Rechte eines Lagers auf den Standard zurücksetzen, Wartungsmodus und Informationssperre aufheben. Formulare mit Pflichteingabe bleiben Formulare (Informationssperre auslösen, Lager mit Titel-Bestätigung löschen, Anfragen und Vorschläge ablehnen, entscheiden): Dort ist der Absenden-Knopf die zweite Stufe.

## Tokens (Tag und Nacht)

**Eine Datei für Website und Verwaltung:** `public/website/tokens.css` (Farben für Tag und Nacht, Radien, Bewegung `--kurve`/`--dauer`/`--dauer-lang`, Scrollleisten `--leiste-*`, Schrift `--schrift`, `@font-face` Archivo mit relativer Adresse). Die Website lädt sie als `/website/tokens.css`, die Verwaltung als `/admin/tokens.css` (`src/seiten.ts` liefert dieselben Bytes). Die Namen sind die des Designs (`--surface`, `--surface-container-low`, `--on-surface`, `--outline`, `--primary`, `--secondary`, `--accent`, `--focus`, `--success-container` …, `--inverse-surface`, `--scrim`). Werte ändert man nur dort.

Tag und Nacht gelten über `prefers-color-scheme` und über `data-theme` am `<html>` (Umschalter im Kopf). Farben stehen im Bereichs-CSS nur als `var(--token)`, nie als Hex.

Die Namen der Verwaltung aus der Zeit vor #578 bleiben als **Verweise** in `admin.css` (`:root`), damit die Stile der Bereiche unverändert laufen; neuer Code nutzt die Namen des Designs:

| Name der Verwaltung       | Token                                    | Name der Verwaltung         | Token                                            |
| ------------------------- | ---------------------------------------- | --------------------------- | ------------------------------------------------ |
| `--karte`                 | `--karte` (Tokens)                       | `--ok` / `--ok-f`           | `--on-success-container` / `--success-container` |
| `--leiste`                | `--surface-container`                    | `--wa` / `--wa-f`           | `--on-warning-container` / `--warning-container` |
| `--erhoben`               | `--surface-container-high`               | `--fe` / `--fe-f`           | `--on-error-container` / `--error-container`     |
| `--text` / `--leise`      | `--on-surface` / `--on-surface-variant`  | `--st` / `--st-f`           | `--on-stufe-container` / `--stufe-container`     |
| `--rand` / `--rand-leise` | `--outline` / `--outline-variant`        | `--blau` / `--auf-blau`     | `--secondary` / `--on-secondary`                 |
| `--rot` / `--auf-rot`     | `--primary` / `--on-primary`             | `--akzent`                  | `--accent`                                       |
| `--rot-text`              | `--primary-text`                         | `--fokus`                   | `--focus`                                        |
| `--titel`                 | `--titel` (Tokens; Tag blau, Nacht hell) | `--umkehr` / `--auf-umkehr` | `--inverse-surface` / `--inverse-on-surface`     |

Der Seitenrand `--rand` der Website (Abstand) und `--rand` der Verwaltung (Farbe des Rands) heissen gleich, sind aber verschieden: Der Seitenrand steht in `website.css`, nicht in den Tokens, und gilt in der Verwaltung nicht.

Schrift: Archivo als eigene Datei (`/admin/archivo-latin.woff2`, die CSP der Verwaltung erlaubt `font-src 'self'`). H1 36/42 (700), H2 22/28 (700), Text 16, klein 14, Tabellenkopf 13 (700). Titel sind wie auf der Website blau (Nacht hell). Zielgrösse mindestens 44 px, Kontrast mindestens 4.5:1, Zustand nie nur über Farbe.

## Bausteine: Klassen

Das Design schreibt `knopf haupt`, im Code heisst es `knopf knopf--haupt`. Die Helfer in `dom.js` setzen die Klassen für dich.

| Baustein           | Code                                                                                         | Design (G4/G6)                          |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| Knopf              | `knopf(text, { art: "haupt" \| "blau" \| "gefahr" \| "still", klein, symbol })`              | `knopf haupt/blau/gefahr/still/kompakt` |
| Knopf lädt         | `aria-busy="true"` und `disabled` am Knopf (Ladekreis per CSS)                               | Ladekreis im Aktionsknopf               |
| Knopf rund         | `class="knopf knopf--rund"` mit `aria-label`                                                 | `knopf rund`                            |
| Chip               | `chip(text, "ok" \| "warn" \| "fehler" \| "stufe", symbol)` in `ul.chips`; `zeichen([...])`  | `chip ok/wa/fe/st`                      |
| Hinweis            | `ctx.melde(...)`; fest eingebaut `div.hinweis.hinweis--ok/--info/--warn/--fehler`            | `hinweis ok/wa/fe`                      |
| Fläche             | `section.flaeche` (mit `h2`), `ul.liste-zeilen`, `dl.werte > div > dt + dd`                  | `flaeche`, `liste-zeilen`, `werte`      |
| Tabelle            | `tabelle({ beschriftung, spalten, zeilen })`; `th scope`, `aria-sort` und Sortierwort selbst | `box table`                             |
| Blättern           | `seitenwahl({ beiWechsel })` (`nav.seitenwahl`)                                              | `pagination`                            |
| Filter             | `filterGruppe({...})` (`aria-pressed`)                                                       | `filter`                                |
| Pillen             | `button.pille[aria-pressed]` in `div.pillen`                                                 | `pille`                                 |
| Schalter           | `button.schalter[role=switch][aria-checked]`, Zeile `div.schalterzeile`                      | `schalter`                              |
| Wahlkarte          | `label.wahlkarte > input[type=radio] + div(strong, span)`                                    | `wahlkarte`                             |
| Feld               | `feld({ label, hilfe, wert })`, `auswahl`, `ankreuzen`, `gruppe`, `codefeld`                 | `feld`, `eingabe`                       |
| Dialog             | `dialogFormular({...})`; Rückfragen: `ctx.mitRueckgaengig({...})` (Toast), `zweistufig(...)` | `dialog`                                |
| Seitenblatt        | `seitenblatt({ titel, untertitel, inhalt, fusszeile })` (ohne Radius, 600 px)                | `blatt`                                 |
| Snackbar           | `div.snack` (nur wenn nötig; sonst `ctx.melde`)                                              | `snack`                                 |
| Fortschritt        | `div.fortschritt > span`, `ol.schritte > li[aria-current=step]`                              | `fortschritt`, `schritte`               |
| Konflikt           | `div.konflikt` mit zwei Spalten                                                              | `konflikt`                              |
| Zähler Unterleiste | `ctx.zaehler(unterSchluessel, n)`                                                            | `pille-zaehler`                         |

Regeln, die weiter gelten: genau eine rote Hauptaktion je Ansicht; fehlt die Aktion in der API, fehlt der Knopf (nicht ausgegraut); Löschen, Wiederherstellen und Archivieren nie rot-primär und immer mit «Rückgängig» (Toast) oder, wo das nicht geht, zwei Stufen im Knopf, nie mit einem Popup; Tabellen mit `th scope` und `aria-sort`; nur Erfolgs- und Infomeldungen verschwinden von selbst, nie ein Fehler oder eine Rückfrage. Eine Meldung, die bleiben muss, bis jemand handelt, bekommt die Art `warn` oder `fehler` oder eine Aktion.

### Listen und Formulare (Personen, Gruppen und Tags)

- Sortierbare Tabelle: `tabelle(...)`, danach `macheSortierbar(wurzel, [{ index, schluessel, name }], zustand, beiAenderung)`; der Kopf wird ein Knopf mit Sortierwort, `aria-sort` steht am `th`. `sortiere(liste, zustand, schluesselVon)` ordnet die Zeilen. «Aktionen» ist im Kopf nur für Screenreader sichtbar (`aktionenKopfVerstecken`).
- Blättern: `seitenleiste({ beiWechsel })` mit «Einträge a bis b von n», Zurück und Weiter und «Zeilen pro Seite» (25, 50, 100); sie bleibt bis 25 Zeilen unsichtbar.
- Fehler beim Feld: `feldFehler(feld, text)` und `entferneFehler(feld)`, dazu `pruefHinweis([{ name, … }])` für die Zusammenfassung «2 Angaben prüfen» (Knöpfe statt Links, ein Hash würde die Seite wechseln). Der Fehler eines Dialogs steht oben (`pe-dialog`).
- Auswahlleiste (`.auswahlleiste`, `role="region"`) für Mehrfachauswahl, `.pe-wahl` für die Checkbox-Spalte.

Die Seite «System → Komponenten» (`#system/komponenten`) zeigt alle Bausteine in ihren Zuständen und die Skeleton-Galerie; öffne sie in Tag und Nacht, wenn du einen Baustein änderst.

## Seiten im Fluss statt Dialoge, Verlauf (#578)

Es gibt keine Modale mehr. `dialogFormular`, `seitenblatt` und `geheimnisDialog` in `dom.js` behalten ihre Aufrufe, öffnen aber eine **Seite im Fluss** (`fluss.js`): Sie ersetzt die Ansicht in `#bereich` (Zurück-Knopf, Titel, Felder, «Abbrechen» und «Speichern»), bekommt einen eigenen Verlaufseintrag (`pushState`), und Browser-Zurück, der Zurück-Knopf und Escape schliessen sie, mit Ansicht, Scrollposition und Fokus wie vorher. Der Rückgabewert hat `close()`, `versuchSchliessen()` und das Ereignis `close`. Bei ungespeicherten Eingaben fragt eine Zeile im Fluss («Änderungen verwerfen?», «Weiter bearbeiten»/«Verwerfen»), `beforeunload` deckt Neuladen und Tab schliessen ab. Im Editor einer Seite sind «Baustein bearbeiten», «Bild wählen» und «Sichtbarkeit» ein nicht modales **Panel** rechts im Layout (`panel: true`); unter 75 rem wird daraus eine Seite im Fluss. Das Startpasswort steht als Karte oben in der Ansicht.

Verlauf (`verlauf.js`): Jede Ansicht ist eine Adresse mit eigenem Eintrag; `replaceState` schreibt nur Korrekturen (alte Adressen, Stand des Eintrags). `zurueck(ziel)` macht dasselbe wie Browser-Zurück (zur Herkunft), nur ohne Herkunft (Tiefenlink) führt es zu `ziel`; `zurueckKlick` hängt es an einen Zurück-Link; `gehe(hash)` wechselt die Adresse mit eigenem Eintrag. Scrollposition und Zustand liegen je Eintrag im `history.state`.

Rückfragen sind Toasts mit «Rückgängig» (`rueckgaengig.js`, siehe «Rückmeldungen»); wo eine Verzögerung nicht sicher ist, gibt es `zweiStufig` (Knopf wird zum «Wirklich …?»-Knopf).

## Scrollleisten (#572, #578)

Die Regeln für Scrollleisten stehen **einmal** in `tokens.css` und gelten für Website und Verwaltung: schmal, runder Griff (`--leiste-griff` = `--outline`, mindestens 3:1), bei Hover `--leiste-griff-hover`, beim Ziehen `--leiste-griff-aktiv`, durchsichtige Spur. Sie gelten für die Seite und für jeden inneren Scrollbereich. `html` hat `scrollbar-gutter: stable`, damit nichts springt.

- Chrome, Edge und Safari zeichnen den Griff über `::-webkit-scrollbar`; Firefox bekommt `scrollbar-width` und `scrollbar-color` in `@supports not selector(::-webkit-scrollbar)`. Beide Wege gelten nie zugleich.
- Mit Finger oder Stift (`pointer: coarse`) und in erzwungenen Farben bleibt die Leiste des Systems.
- Ein neuer Scrollbereich braucht nichts ausser `overflow: auto`.
- **Zwei Spalten, zwei Scrollbereiche:** Im Editor einer Seite hat ab 1100 px jede Spalte (Bausteine, Vorschau und Einstellungen) einen eigenen Scrollbereich in der Höhe des Fensters unter der Navigation (`.ws-editor`, `website-editor.css`); die Seite scrollt nur, bis der Editor oben steht. Innen bleibt Platz für den Fokusring (`padding: 4px`), `scrollbar-gutter: stable` hält die Breite.

## Auswahlfelder (#578)

Jedes `<select>` der Verwaltung wird zu dem Auswahlfeld der Website (`auswahl.js`, Select-Only-Combobox nach den ARIA Authoring Practices; Stil `auswahl.css`): das native `select` bleibt darunter (Wert, `change`, Formular), Knopf und Liste sind eigene Elemente mit Pfeiltasten, Pos1/Ende, Tippen zum Springen, Escape, Haken bei der gewählten Option. `auswahl({ label, optionen, wert })` in `dom.js` baut Label und Feld; ein selbst gebautes `select` stellt `auswahl.js` von selbst um (`data-nativ` lässt eines aus). Optionen können ein Bild tragen (`data-bild`, Symbole der Stufen). Der Knopf trägt zusätzlich die Klasse `auswahl-knopf`, nach der die Bereiche ihn finden.

## Favicon (#581)

Die Verwaltung zeigt im Tab dasselbe Zeichen wie die Website der Abteilung, nicht ihr eigenes Symbol. `index.html` trägt zwei Einträge: `<link rel="icon" href="/favicon.ico">` und `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`. Die API liefert beide Adressen selbst (`app.ts`, ohne Anmeldung, mit `ETag`, ohne Datenbankabfrage je Aufruf): `seiten.zeichen` hält die Dateien im Speicher, `server.ts` füllt sie beim Start und nach jedem Abgleich mit dem gewählten Zeichen der Abteilung, sonst mit dem Cevi-Zeichen (`admin/favicon.svg`). Weil eine Instanz genau eine Abteilung trägt, ist das Zeichen schon vor der Anmeldung das der Abteilung (es ist öffentlich); ohne Wahl ist es das Cevi-Zeichen. Die CSP der Verwaltung (`img-src 'self' data:`) erlaubt beide Adressen. `admin/favicon.svg` bleibt als Quelle des Cevi-Zeichens und als Ersatzbild in Listen (`STANDARD_LOGO`). Ein neuer Einstieg (weitere HTML-Seite der Verwaltung oder der Plattform) braucht dieselben zwei Einträge; der Test in `test/seiten.test.ts` prüft sie für `/admin`, `/datenschutz`, `/support` und `/konto-loeschen`.

## Lokal prüfen

Der Server liest alle Dateien aus `public/admin/` **einmal beim Start** (`src/seiten.ts`). Nach jeder Änderung an einer Datei dort den Server neu starten, sonst zeigt der Browser die alte Fassung. Eigener Dev-Server und Datenbank wie in der Regel für UI-Arbeit; der zweite Faktor lässt sich in Playwright umgehen, indem `GET /api/auth/get-session` und die Daten-Routen mit `page.route` beantwortet werden (siehe die Antwortformen in `docs/api/openapi.yaml`). Prüfe jede Ansicht bei 1280, 1024 und 390 px in Tag und Nacht (`emulateMedia({ colorScheme })`), mit Tastatur und mit `reducedMotion: "reduce"`.

## Änderungen am Gerüst

Das Gerüst ändert sich nach dem ersten Stand nur additiv: neue Klassen in der eigenen Datei, neue Einträge in `navigation.js`. Wer `admin.js`, `admin.css`, `dom.js` oder `index.html` anfasst, hält die Änderung klein und nennt sie im PR. Stile eines Bereichs gehören in `<bereich>.css` mit eigenem Klassenvorsatz.
