# Gerüst der Verwaltung

Das Gerüst der Verwaltung unter `/admin` folgt dem Design «Cevi Web» (Boards A1, A2, A30, G4 bis G6). Diese Seite ist die Anleitung für alle, die einen Bereich neu bauen. Die Seiten laufen ohne Build-Schritt, mit ES-Modulen und strenger CSP (keine Inline-Skripte, keine `style`-Attribute, keine fremden Hosts, keine fremden Schriften).

## Aufbau der Seite

```
Kopf (header.kopfzeile)
  Logozeile        Marke «CEVI», «Verwaltung», Konto, Abmelden
  Bereichsleiste   blau, ein Eintrag je Bereich, aktiver Bereich mit rotem Strich
  Unterleiste      die Unterseiten des aktiven Bereichs, Zähler als rote Pille
main#inhalt        .rahmen (max. 1248 px)
  #seitenkopf      h1 + Untertitel + rechts die Hauptaktion
  #rueckmeldung    gestapelte Hinweise
  #bereich         hier zeichnet dein Modul
```

Die Leisten stehen im Kopf, nicht in einer Seitenleiste: So zeigt es das Design (G4, «Kopf mit Bereichsleiste und Unterleiste statt Dock»). Unter 1100 px rücken Name und Rolle des Kontos zu den Screenreadern, unter 760 px laufen die Leisten waagrecht.

## Dateien (alle flach in `apps/api/public/admin/`)

| Datei                | Aufgabe                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `index.html`         | lädt die Stilvorlagen und `admin.js`                                                                         |
| `admin.js`           | Anmeldung, zweiter Faktor, Sperren, Router, `ctx` für die Module                                             |
| `navigation.js`      | **Bereiche und Unterseiten.** Hier meldet sich ein Modul an                                                  |
| `rahmen.js`          | Logozeile, Leisten, Seitenkopf, Rückmeldungen                                                                |
| `lader.js`           | `erstelleLader` (Laden mit Skeleton) und die Skeleton-Bausteine                                              |
| `zustaende.js`       | `zustandsDaten`, `rahmenzustand`, `zustandsKarte`, `leerKarte`, `nochmals`, `zeichen`                        |
| `platzhalter.js`     | Karte «noch nicht umgesetzt» für Unterseiten ohne Modul                                                      |
| `komponenten.js`     | System, Komponenten: Skeleton-Galerie (G5) und Zustandstafel (G6) mit den echten Bausteinen                  |
| `dom.js`             | Bausteine: `el`, `knopf`, `chip`, `feld`, `auswahl`, `tabelle`, `dialogFormular`, `seitenblatt` …            |
| `api.js`             | `anfrage`, `ApiFehler`, `fehlertext`                                                                         |
| `admin.css`          | Tokens (Tag und Nacht) und die bestehenden Bausteine                                                         |
| `geruest.css`        | Kopf, Leisten, Zustandsseiten, Rückmeldungen                                                                 |
| `komponenten.css`    | Fläche, Skeleton, Schalter, Pillen, Wahlkarte, Snackbar, Fortschritt, Schritte, Konflikt                     |
| `liste-hilfen.js`    | Listen: `macheSortierbar`, `seitenleiste` (25/50/100 Zeilen), `feldFehler`, `pruefHinweis`, `mitFehlertitel` |
| `<bereich>-*.js/css` | Module und Stile der Bereiche (Klassen mit eigenem Vorsatz, z. B. `tm-`, `ws-`)                              |

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

`ctx.melde(text, art, aktion)` stapelt Hinweise in einer Live-Region (`#rueckmeldung`). Keine Meldung verschwindet von selbst: jede hat «Hinweis schliessen». Fehler sind `role="alert"`. Dieselbe Meldung ersetzt sich, statt sich zu stapeln. `melde("")` leert alle; der Router tut das bei jeder Navigation.

## Tokens (Tag und Nacht)

Definiert in `admin.css` (`:root`, in der Nacht überschrieben unter `@media (prefers-color-scheme: dark)`). Die Verwaltung folgt dem Gerät, es gibt keinen Umschalter. Farben nur über diese Variablen, nie als Hex im Bereichs-CSS.

| Variable                  | Rolle im Design                       | Variable                    | Rolle im Design                |
| ------------------------- | ------------------------------------- | --------------------------- | ------------------------------ |
| `--surface`               | surface (Grund)                       | `--ok` / `--ok-f`           | Text / Fläche «ok»             |
| `--karte`                 | surface-container-low (Karten)        | `--wa` / `--wa-f`           | Warnung                        |
| `--leiste`                | surface-container (Leisten, Filter)   | `--fe` / `--fe-f`           | Fehler                         |
| `--erhoben`               | surface-container-high (Dialoge)      | `--st` / `--st-f`           | Stufen-Etikett                 |
| `--text` / `--leise`      | on-surface / on-surface-variant       | `--blau` / `--auf-blau`     | Bereichsleiste, gewählt        |
| `--rand` / `--rand-leise` | outline (Bedienelemente) / Trennlinie | `--blau-f` / `--auf-blau-f` | Info-Band                      |
| `--rot` / `--auf-rot`     | primary (Hauptaktion, Zähler)         | `--akzent`                  | «hier bist du», gewählte Pille |
| `--rot-text`              | Rot als Text                          | `--fokus`                   | Fokusring (3 px)               |
| `--titel`                 | H1 und H2 (Tag rot, Nacht weiss)      | `--umkehr` / `--auf-umkehr` | Snackbar                       |
| `--skeleton`              | Skeleton-Fläche (Dekor)               | `--schleier` / `--schatten` | scrim / elevation-float        |

Schrift: Archivo, wenn sie auf dem Gerät liegt, sonst die Systemschrift (die CSP erlaubt keine fremden Schriften, und das Repo enthält keine Schriftdatei). H1 36/42 (700), H2 22/28 (700), Text 16, klein 14, Tabellenkopf 13 (700). Zielgrösse mindestens 44 px, Kontrast mindestens 4.5:1, Zustand nie nur über Farbe.

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
| Dialog             | `dialogFormular({...})`, `bestaetigen({...})` (zerstörend: Fokus auf «Abbrechen»)            | `dialog`                                |
| Seitenblatt        | `seitenblatt({ titel, untertitel, inhalt, fusszeile })` (ohne Radius, 600 px)                | `blatt`                                 |
| Snackbar           | `div.snack` (nur wenn nötig; sonst `ctx.melde`)                                              | `snack`                                 |
| Fortschritt        | `div.fortschritt > span`, `ol.schritte > li[aria-current=step]`                              | `fortschritt`, `schritte`               |
| Konflikt           | `div.konflikt` mit zwei Spalten                                                              | `konflikt`                              |
| Zähler Unterleiste | `ctx.zaehler(unterSchluessel, n)`                                                            | `pille-zaehler`                         |

Regeln, die weiter gelten: genau eine rote Hauptaktion je Ansicht; fehlt die Aktion in der API, fehlt der Knopf (nicht ausgegraut); Löschen, Wiederherstellen und Archivieren nie rot-primär und immer mit Rückfrage; Tabellen mit `th scope` und `aria-sort`; keine Meldung verschwindet von selbst.

### Listen und Formulare (Personen, Gruppen und Tags)

- Sortierbare Tabelle: `tabelle(...)`, danach `macheSortierbar(wurzel, [{ index, schluessel, name }], zustand, beiAenderung)`; der Kopf wird ein Knopf mit Sortierwort, `aria-sort` steht am `th`. `sortiere(liste, zustand, schluesselVon)` ordnet die Zeilen. «Aktionen» ist im Kopf nur für Screenreader sichtbar (`aktionenKopfVerstecken`).
- Blättern: `seitenleiste({ beiWechsel })` mit «Einträge a bis b von n», Zurück und Weiter und «Zeilen pro Seite» (25, 50, 100); sie bleibt bis 25 Zeilen unsichtbar.
- Fehler beim Feld: `feldFehler(feld, text)` und `entferneFehler(feld)`, dazu `pruefHinweis([{ name, … }])` für die Zusammenfassung «2 Angaben prüfen» (Knöpfe statt Links, ein Hash würde die Seite wechseln). Der Fehler eines Dialogs steht oben (`pe-dialog`).
- Auswahlleiste (`.auswahlleiste`, `role="region"`) für Mehrfachauswahl, `.pe-wahl` für die Checkbox-Spalte.

Die Seite «System → Komponenten» (`#system/komponenten`) zeigt alle Bausteine in ihren Zuständen und die Skeleton-Galerie; öffne sie in Tag und Nacht, wenn du einen Baustein änderst.

## Lokal prüfen

Der Server liest alle Dateien aus `public/admin/` **einmal beim Start** (`src/seiten.ts`). Nach jeder Änderung an einer Datei dort den Server neu starten, sonst zeigt der Browser die alte Fassung. Eigener Dev-Server und Datenbank wie in der Regel für UI-Arbeit; der zweite Faktor lässt sich in Playwright umgehen, indem `GET /api/auth/get-session` und die Daten-Routen mit `page.route` beantwortet werden (siehe die Antwortformen in `docs/api/openapi.yaml`). Prüfe jede Ansicht bei 1280, 1024 und 390 px in Tag und Nacht (`emulateMedia({ colorScheme })`), mit Tastatur und mit `reducedMotion: "reduce"`.

## Änderungen am Gerüst

Das Gerüst ändert sich nach dem ersten Stand nur additiv: neue Klassen in der eigenen Datei, neue Einträge in `navigation.js`. Wer `admin.js`, `admin.css`, `dom.js` oder `index.html` anfasst, hält die Änderung klein und nennt sie im PR. Stile eines Bereichs gehören in `<bereich>.css` mit eigenem Klassenvorsatz.
