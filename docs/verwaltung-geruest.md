# Gerüst der Verwaltung

Das Gerüst der Verwaltung unter `/admin` ist Teil **eines** Designsystems mit der öffentlichen Website (#578): dieselben Tokens, dieselbe Schrift, derselbe Kopf, dieselben Knöpfe, Chips, Karten, Felder, Auswahlfelder, Scrollleisten und dieselbe Bewegung. Die Dichte darf höher sein (Arbeitsoberfläche), die Handschrift ist dieselbe. Entstanden aus dem Design «Cevi Web» (Boards A1, A2, A30, G4 bis G6). Diese Seite ist die Anleitung für alle, die einen Bereich neu bauen. Die Seiten laufen ohne Build-Schritt, mit ES-Modulen und strenger CSP (keine Inline-Skripte, keine `style`-Attribute, keine fremden Hosts, keine fremden Schriften).

## Aufbau der Seite

```
Kopf (header.kopfzeile, wie website/kopf.css)
  Logozeile        Marke (Logo hell/dunkel oder Wortmarke «CEVI» mit Name), «Verwaltung», Konto, Umschalter Hell/Dunkel, Abmelden
  Bereichsleiste   weisses Band, ein Eintrag je Bereich, roter Strich unter dem aktuellen; haftet beim Scrollen oben (unter 960 px: Bereichsauswahl)
  Unterleiste      die Unterseiten des aktiven Bereichs auf der Fläche der Seite, Zähler als roter Kreis; scrollt mit weg
main#inhalt        .rahmen (max. 105 rem und Seitenrand clamp(1rem, 4vw, 4.5rem): dieselben Werte wie .wrap und --rand der Website, in der Verwaltung als --seitenbreite und --seitenrand, weil --rand hier die Randfarbe ist; Kopf, Leisten, Hinweisband, Seitenkopf und Inhalt haben exakt dieselben Kanten wie die Website)
  #seitenkopf      h1 + Untertitel + rechts die Hauptaktion
  #rueckmeldung    Meldungen; darunter die Toasts mit «Rückgängig»
  #bereich         hier zeichnet dein Modul
```

**Marke:** Name und Logo kommen aus den Einstellungen der Website (`GET /api/v1/redaktion/website`: `name`, `logoMediumId`, `logoDunkelMediumId`; das Bild liefert `/api/v1/medien/<id>`) und stehen nie im Code. Fehlt das Recht auf die Einstellungen (403), kommen Logo und Name aus dem Kopf der öffentlichen Website; ist kein Logo gesetzt oder gibt es keine Quelle, steht die Wortmarke «CEVI» (mit dem Namen, wenn bekannt). Ein Logo ohne dunkle Fassung steht in der Nacht auf hellem Feld (`--logo-grund`). `setzeMarke()` in `rahmen.js` ersetzt die Marke; die Anmeldeseite trägt denselben Kopf ohne Konto.

**Umschalter Hell/Dunkel:** zwei Knöpfe mit Symbol (Sonne, Mond), `aria-pressed`, `role="group"`; die Wahl liegt im Browser (`localStorage`, Schlüssel `cevi-darstellung`, dieselbe wie auf der Website, `/admin/theme.js` ist `website/theme.js`). Ohne gespeicherte Wahl folgt die Verwaltung dem Gerät.

Die Leisten stehen im Kopf, nicht in einer Seitenleiste (G4). Unter 1100 px rücken Name und Rolle des Kontos zu den Screenreadern, unter 960 px ersetzt die Bereichsauswahl beide Leisten (eine Zeile mit dem aktuellen Ort, die zum Panel wächst; siehe «Navigation, Rahmen und Suche»).

`.kopfzeile` und `.leisten` sind `display: contents`: Logozeile, Bereichsleiste und Unterleiste sind Geschwister im Gerüst, damit nur die Zeile der Navigation haftet.

## Dateien (alle flach in `apps/api/public/admin/`)

| Datei                                                 | Aufgabe                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                                          | lädt die Stilvorlagen und `admin.js`                                                                                                |
| `admin.js`                                            | Anmeldung, zweiter Faktor, Sperren, Router, `ctx` für die Module                                                                    |
| `navigation.js`                                       | **Bereiche und Unterseiten**, Recht je Eintrag (`darfSehen`), Rolle im Kopf (`rolleVon`). Hier meldet sich ein Modul an             |
| `rahmen.js`                                           | Marke, Logozeile, Leisten, Bereichsauswahl (schmal), Seitenkopf, Rückmeldungen, Toasts                                              |
| `lader.js`                                            | `erstelleLader` (Laden mit Skeleton) und die Skeleton-Bausteine                                                                     |
| `zustaende.js`                                        | `zustandsDaten`, `rahmenzustand`, `zustandsKarte`, `leerKarte`, `nochmals`, `zeichen`                                               |
| `platzhalter.js`                                      | Karte «noch nicht umgesetzt» für Unterseiten ohne Modul                                                                             |
| `komponenten.js`                                      | Skeleton-Galerie (G5) und Zustandstafel (G6); nicht mehr verlinkt (#607)                                                            |
| `dom.js`                                              | Bausteine: `el`, `knopf`, `chip`, `feld`, `auswahl`, `tabelle`, `dialogFormular`, `seitenblatt` …                                   |
| `api.js`                                              | `anfrage`, `ApiFehler`, `fehlertext`                                                                                                |
| `tokens.css`                                          | **Gemeinsame Tokens und Schrift** (Kopie von `public/website/tokens.css`, vor `admin.css` geladen)                                  |
| `theme.js`                                            | Umschalter Hell/Dunkel (Kopie von `public/website/theme.js`)                                                                        |
| `auswahl.js`, `auswahl.css`                           | Eigenes Auswahlfeld (Kopien der Dateien der Website), wertet jedes `select` auf                                                     |
| `fluss.js`, `fluss.css`, `verlauf.js`                 | Seiten im Fluss statt Dialoge, Panel im Editor, Verlauf und Zurück                                                                  |
| `rueckgaengig.js`, `toast.css`                        | Toasts mit «Rückgängig», zweistufige Knöpfe                                                                                         |
| `admin.css`                                           | Verweise auf die Tokens und die Bausteine der Verwaltung                                                                            |
| `geruest.css`                                         | Kopf, Leisten, Zustandsseiten, Rückmeldungen                                                                                        |
| `komponenten.css`                                     | Fläche, Skeleton, Schalter, Pillen, Wahlkarte, Snackbar, Fortschritt, Schritte, Konflikt                                            |
| `liste-hilfen.js`                                     | Listen: `macheSortierbar`, `seitenleiste` (25/50/100 Zeilen), `feldFehler`, `pruefHinweis`, `mitFehlertitel`                        |
| `mitglieder.js`                                       | Mitglieder-Darstellung: Karten und Liste, Abschnitte (#624)                                                                         |
| `uebersicht.js`                                       | Übersicht: ein Abruf, Skelett, Aufbau der Seite aus den Kacheln (#583)                                                              |
| `uebersicht-kacheln.js`                               | Kacheln der Übersicht: Aufgabenband, Kennzahlen, Kommendes, Stufen, Zustand, Fehlerkachel                                           |
| `uebersicht-diagramme.js`                             | Inline-SVG ohne Bibliothek: Verlaufslinie, Säulen, Rangbalken, Wertetabelle, Ablesung mit Pfeiltasten                               |
| `uebersicht.css`                                      | Stile der Übersicht (Klassenvorsatz `ub-`)                                                                                          |
| `lager-personenwahl.js`                               | Personen für ein Lager wählen (Suche, Gesichter, Rolle, mehrere auf einmal; Assistent und Mitglieder)                               |
| `lager-rechte.js`                                     | Rechte der Rollen eines Lagers in Klartext (Bereiche, Filter, Leiste mit Änderungen)                                                |
| `termine-monat.js`                                    | Monatsansicht des Kalenders: reine Funktionen und Knoten (Klassenvorsatz `tm-`, Stile in `termine.css`)                             |
| `anlass-gemeinsam.js`, `anlass-anmeldungen.js`        | Anlässe: Adressen, Texte, Stand der Anmeldung, Einstellungsfelder, Speicher; Reiter «Anmeldungen» mit Export (#608)                 |
| `anlass-felder.js`, `termine-anlaesse.css`            | Anlässe: Reiter «Zusatzfelder» (Sortierliste, Speicherleiste); Stile der Anlässe (Klassenvorsatz `anl-`)                            |
| `konto.js`, `konto.css`                               | Mein Konto (#konto): Profilkarte, Deine Angaben, Sicherheit, Datenschutz; Klassenvorsatz `kt-` (#621)                               |
| `hinweisband.js`                                      | Hinweisband unter dem Kopf bei Wartung oder Informationssperre (#593); `BEREICHE` der Plattform                                     |
| `system.js`, `plattform.js`                           | System (Übersicht mit Kennzahlen, Verlauf und Streifen der Anfragen; Anfragen; Abrufe) und Plattform (Wartung, Sperre) (#593, #606) |
| `zeitregeln.js`, `mitteilungen.js`                    | Erinnerungen mit Zeitplan-Vorschau, Mitteilungen mit Vorschau (#593)                                                                |
| `system.css`                                          | Stile dieser Seiten und des Hinweisbands (Vorsätze `hinweisband-`, `sch-`, `zr-`, `sv-`)                                            |
| `website-baumansicht.js`                              | Website: Seitenbaum als Baum (Tastatur, Ziehen, Umbenennen, Weiterleitungs-Hinweis)                                                 |
| `website-skizzen.js`                                  | Website: Skizzen der Seitenvorlagen für «Neue Seite»                                                                                |
| `website-unteransicht.js`                             | Website: Unteransicht im Panel (Bild wählen, Zugriff eines Bausteins), nie ein zweites Panel                                        |
| `bildwahl.js`, `bildwahl.css`                         | Bildwahl in der Seite (Bilder der Medienbibliothek unter dem Feld) und `bildMitLader` (Platzhalter bis das Bild da ist) (#591)      |
| `website-einstellungen.css`                           | Vorschau der Website-Einstellungen (Klassen `ws-einst-`, `ws-v-`) (#591)                                                            |
| `personen-blatt.js`, `personen-wahl.js`, `telefon.js` | Person als Seite, Zuordnen per Suche und Dateifeld, Telefonnummer (#594)                                                            |
| `sortieren.js`, `filterleiste.js`, `datumsfeld.js`    | Querschnitt: Sortierliste, Filterleiste, Datum, Zeit und Zahl in eigenen Feldern (#578)                                             |
| `aktionen.js`, `formularraster.js`, `werkzeuge.css`   | Querschnitt: geteilter Knopf, Bestätigung am Ort, Zweispalter und die Stile aller Querschnitt-Bausteine (#578, #602)                |
| `lager*.js`, `lager.css`                              | Bereich Lager: Liste, Assistent, Mitglieder, Rechte, Ausdrucke, Vorlagen (Vorsatz `lg-`) (#592)                                     |
| `website-*.js`, `website-*.css`                       | Website: Seiten, Baum, Editor, Bausteine, Medien, Stufenfelder, Einstellungen (Vorsatz `ws-`) (#591, #595)                          |
| `<bereich>-*.js/css`                                  | Module und Stile der Bereiche (Klassen mit eigenem Vorsatz, z. B. `tm-`, `ws-`)                                                     |

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

- `zugang`: `"admin"` (Vorgabe), `"alle"`, ein Bereich aus `GET /api/v1/redaktion/ich` (`"website"`, `"plattform"`), `"entwickler"` oder `"recht:<name>"` (siehe «Navigation, Rahmen und Suche»). Die Anzeige folgt dem Server, jede Route prüft selbst.
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

## Bereiche im Einzelnen

Was der Bereich einer Ansicht über die Bausteine hinaus beschreibt: eine Liste nach der Reihenfolge der Navigation.

### Übersicht (#583)

Die Übersicht ist ein Dashboard: Sie zeigt je Rolle, was jetzt zu tun ist und wie es der Abteilung geht. Sie lädt **einen** Abruf, `GET /api/v1/admin/uebersicht` (beim Öffnen und auf «Aktualisieren», kein Polling). Der Server gibt jeder Person nur die Teile, die sie sehen darf (Rechte je Teil: siehe die Beschreibung der Route in `docs/api/openapi.yaml` und Bedrohung 50); die Oberfläche blendet nur aus, was in der Antwort fehlt, und verlässt sich auf nichts.

- **Aufbau:** «Jetzt zu tun» (Kachel je offener Punkt mit Zahl und Sprung auf den richtigen Bildschirm; erledigtes steht in einem Satz) · «Kennzahlen» (Anmeldungen, Konten, Bestellungen, Termine) · «Kommendes» und «Kinder je Stufe» · «Zustand» (nur Website und Kalender-Abgleich). Das Raster füllt die Breite des Rahmens, wenige Kacheln werden breiter.
- **Jetzt zu tun (#607):** Alle Aufgabenkacheln sind gleich gross und gleich aufgebaut (Raster mit gleich hohen Zeilen, mindestens 11 rem): oben Zahl und Marke, in der Mitte der Satz, unten eine Aktionszeile von 44 px Höhe. Ohne Recht auf die Zielseite bleibt die Zeile leer.
- **Kennzahlen (#607)** nach den Statistikkacheln von Kokonut UI Pro (`stats-feature`, `clinic-dashboard`): Titel, grosse Zahl mit Einheit, Veränderung als Marke mit Pfeil und Vorzeichen (nie nur Farbe) und dem Vergleich in Worten, darunter eine kleine Grafik. Nur Zahlen, die die Route schon liefert und die für die Abteilung etwas sagen; «Bestellungen» erscheint nur, wenn das Lädeli in den letzten acht Wochen benutzt wurde. Die Anfragen an die API sind Sache des Systems und stehen dort.
- **Zustand (#607):** ein Streifen mit einem Punkt je Dienst (Name, Zustand als Wort mit Symbol, ein Satz, Verweis). Medien (Dateien, Speicher) und Antwortzeit der Datenbank zeigt die Übersicht nicht mehr; die Route liefert die Teile `zustand.medien` und `zustand.datenbank` weiter.
- **Sprung:** Eine Aufgabenkachel ist nur dann ein Link, wenn die Person die Zielseite sehen darf (`darfSehen` aus `navigation.js`); sonst zeigt sie nur die Zahl.
- **Zustände je Kachel:** Lädt (Skelett in der Form der Seite), leer (ein Satz), Fehler (steht der Teil in `fehlt`, zeigt nur diese Kachel «Nochmals versuchen»; der Rest bleibt). Fehlt die ganze Antwort, zeigt `ctx.lade` die Fehlerkarte der Seite.
- **Diagramme** (`uebersicht-diagramme.js`): Inline-SVG, Farben nur über Klassen aus den Tokens (Randfarbe für die Vergangenheit, Akzent für den aktuellen Zeitraum, Fehlerfarbe für Fehler), Säulen immer ab 0, Fehleranteil als zweiter Teil mit 2 px Luft. Jede Grafik hat einen Satz mit allen Werten für Screenreader (`role="img"`) und eine Ablesung mit Zeiger oder Pfeiltasten (Text darunter, `aria-live`). Eine Tabelle daneben und den Schalter «Tabellen statt Diagramme» gibt es in der Übersicht nicht mehr (#607); `wertetabelle` bleibt für das System. In erzwungenen Farben tragen Form und Umriss die Information (der Fehleranteil wird zum Umriss).
- **Neue Kachel:** eine Funktion in `uebersicht-kacheln.js`, die aus der Antwort einen Knoten baut (`kachel({ titel, inhalt })`) und `null` liefert, wenn der Teil fehlt; ein Eintrag in `zeichne` von `uebersicht.js`. Der Teil gehört zuerst in die Route (`routes/admin/uebersicht.ts`) mit seinem eigenen Recht, Eintrag in OpenAPI und Test.
- **Zähler der Unterleiste** (Vorschläge, Ohne Kategorie, Anfragen) kommen aus denselben Zahlen (`ctx.zaehler`), ohne eigene Abfrage; sie sind jetzt exakt statt «100+».

### Personen, Gruppen, Kinder, Stufen, Import (#594)

Der Bereich «Personen» nutzt die Bausteine aus `werkzeuge.css` (Filterleiste, Sortierliste, Formularraster) und ein paar eigene in `personen-wahl.js`:

- **Person** (`personen-blatt.js`, `oeffnePerson`): eine Seite im Fluss für Erfassen und Bearbeiten. `formularRaster` stellt die Karten links und das Profil mit dem Bild der Person rechts. Das Bild setzt die Person selbst in der App (`PUT /api/v1/ich/bild`); die Verwaltung zeigt es aus `bildUrl`. Telefon: `telefon.js` (`normalisiereTelefon`) schreibt Schweizer Nummern einheitlich; der Server (`src/telefon.ts`) prüft weiter, und eine Nummer gibt es nur bei der Rolle Stufenleitung.
- **Stufen und Website der Person (#610):** «Rechte und Rollen» zeigt keine Stufen vorab, sondern die zugewiesenen Zeilen (`rollenFelder`: Stufe, Rolle Leitung oder Stufenleitung, «Entfernen» mit «Rückgängig» bis «Speichern») und «Stufe hinzufügen». Die API bleibt `PATCH /api/v1/admin/personen/{id}` mit `rollen` (ersetzt alle Stufenrollen). «Gruppen und Tags» bietet keine Stufen-Tags an, weil die Stufenrolle selbst die Zuordnung ist (`person_tag` an einem Stufen-Tag). Ob die Person auf der Website steht, wählt niemand: Leitung und Stufenleitung einer Stufe erscheinen mit Name und Profilbild (Hinweistext ohne Auswahl).
- **Mitglieder-Darstellung** (`mitglieder.js`, #624): Personen, Kinder, Mitglieder einer Gruppe und die Stufenleitung zeigen sich einheitlich. Die Seite baut Karte und Zeile selbst (`mitgliedKarte`, `mitgliedKopf`, `marke`, `chipListe`), `ansichtsleiste` liefert die Umschalter «Karten | Liste» und «Gruppieren», `gliedere` und `abschnitte` ordnen die Treffer in Abschnitte, `zeichneAnsicht` zeichnet Raster, Tabelle oder Zeilen. Die Ansicht bleibt im Browser, die Gruppierung in der Sitzung; die Stile stehen in `personen.css` (`mg-`). Die Darstellung ruft die API nie selbst auf. Neue Seite: Einträge bauen, Gruppen nennen, `zeichneAnsicht` aufrufen.
- **Personenliste** (`personen.js`): `filterleiste` mit Suche, Tag, Rolle, Konto; Auswahlleiste (`.auswahlleiste`) für «Tag setzen» und «Tag entziehen» mit `ctx.mitRueckgaengig`. Die Zeilen ändern sich sofort (`ansicht.weg`), die Anfragen gehen nach der Frist; `ansicht.zurueck` stellt den alten Stand her. Je Person ein Aufruf, höchstens fünf gleichzeitig (die API kennt nur die Einzelzuordnung).
- **Zuordnen per Suche** (`personen-wahl.js`): `kandidatenSuche` (Suchfeld mit Treffern), `suchWahl` (Gewählte als Liste, dazu die Suche; für Kinder einer Person und Eltern eines Kindes), `personZeile`, `dateiFeld` (Knopf «Datei wählen» statt des Dateifelds des Browsers).
- **Gruppe** (`tags-detail.js`, `zeigeDetail`): Mitgliederliste mit Live-Filter, Rolle in der Zeile ändern, Hinzufügen und Entfernen mit «Rückgängig» (Änderung sofort sichtbar, Anfrage nach der Frist). Die Rollen `leitung` und `stufenleitung` stehen im Klartext.
- **Stufen** (`stufen.js`): Ruhige Karten, gleich hoch: Kasten mit Anfangsbuchstaben (oder eigenem Logo), Name, Zahl der Kinder, darunter die Stufenleitung einmal (Name oder `sortierListe`), unten die Aktionen. Ohne Leitung steht ein Satz, kein Warn-Chip. `ctx.mitRueckgaengig` verzögert das `PUT …/stufenleitung`. Das Logo hat eine Vorschau neben dem Feld.
- **Import** (`import.js`, `schrittfolge.js`): Eine senkrechte Schrittfolge (Muster «stepper-form», eigener Bau) mit den Schritten Datei, Spalten, Rollen, Vorschau, Fertig. Zustand je Schritt (offen, aktuell, erledigt, Fehler), erledigte Schritte mit Zusammenfassung und «Ändern». Beim Export der Cevi-Datenbank sind Spalten und Rollen erkannt: Die Folge springt von der Datei zur Vorschau, «Ändern» führt zurück. Jeder Schritt ist ein Eintrag im Verlauf (`history.state.importSchritt`), Browser-Zurück geht schrittweise und behält die Eingaben; nach dem Import führt «Zurück» nicht in die Vorschau. Ein Neuladen verliert die Datei (sie liegt nur im Browser).
- **Kinder** (`kinder.js`): Die Spalte «Zugang» und der Filter «Ohne Zugang» ersetzen «Eltern»; ein Kind ohne Elternteil ist ein Hinweis, keine Warnung (ein eigenes Konto für Kinder gibt es im Modell nicht, Entwurf liegt vor). «Kind anlegen» und «Kind bearbeiten» sind eine Seite im Fluss mit `formularRaster` (Karten Angaben, Stufe, Eltern und Zugang).

### Website: Seiten und Editor (#595)

- **Seitenbaum** (`website-baumansicht.js`): `role="tree"`, Zeilen mit `aria-level`; das Modell liegt im Browser (`website-baum.js`: `plane`, `wendeAn`, `ablehnung`, `geaenderteAdressen`), der Server prüft jede Änderung. Ziehen, Tastatur und Menü «Mehr» rufen dieselbe Funktion `verschiebe`, die den Schritt über `ctx.mitRueckgaengig` ausführt (höchstens einer wartet). Ändert sich eine Adresse, weist `weiterleitungsHinweis` darauf hin und legt mit dem Recht «Weiterleitungen verwalten» Weiterleitungen an (`POST /api/v1/redaktion/weiterleitungen`); das Verschieben selbst legt keine an (Entscheid der API, #356).
- **Reihenfolgen** (Bausteine, Karten, Bilder): `sortieren.js` (`sortierListe`); nie eine eigene Ziehlogik.
- **Ziehen mit Bewegung** (#609): `zieheMitBewegung` in `sortieren.js` ist die einzige Ziehlogik. Die Zeile bleibt im Dokument und folgt dem Zeiger per `transform`, die anderen Zeilen weichen per `transform` aus (`.sortier-weicht`), ein Platzhalter (`.sortier-platzhalter`) zeigt den Zielplatz; erst nach dem Absetzen ruft sie `beiEnde`, und der Aufrufer ordnet neu. Es gibt keine Zeigerfassung (`setPointerCapture`), weil das Dokument während des Ziehens nicht umgebaut wird. `sortierListe`, der Seitenbaum (eigene Zielzonen über `ziel`, Einzug und Rahmen) und die Lädeli-Artikel (Tabellenzeilen, `huelle` = Tabellenrahmen) rufen sie auf. Die Übergänge stehen in `werkzeuge.css` nur unter `prefers-reduced-motion: no-preference`; Inline-Styles aus dem Skript sind wegen der CSP nur über `element.style.…` erlaubt, nie als Attribut. Umordnen per Knopf: `merkePlaetze` und `rutscheAnPlatz`.
- **Speicherleiste** (`speicherLeiste` in `kalenderhilfen.js`): Ein Formular mit wenigen Feldern (Termine, Kategorien; Lädeli, Einstellungen) speichert in der Leiste unten, die erst bei einer Änderung erscheint; es gibt keinen Speichern-Knopf im Formular.
- **Editor-Kopf:** Titel direkt umbenennen (PATCH `titel`), Speicherstand (Text, rechnet im Browser), «Zugriff», «Vorschau», «Veröffentlichen» als `splitKnopf` (`aktionen.js`). Einstellungen (Adresse, Elternseite) mit Live-Prüfung; ungespeicherte Einstellungen zählen für die Rückfrage beim Verlassen.
- **Unteransicht statt zweitem Panel:** `unteransicht(blatt, …)` ersetzt den Inhalt des offenen Panels; `bildDialog` und `sichtbarkeitBlatt` nehmen `{ in: blatt }`.
- **Format-Leiste** über dem Text-Baustein: `formatiere()` in `website-richtext.js` (rein, getestet) setzt die Schreibweise im Feld um.

### Website: Medien, Einstellungen, Stufenfelder und Lädeli (#591)

- **Zweispalter:** Felder links, Bild oder Vorschau rechts (`formularRaster` aus `formularraster.js`): das Raster wächst mit der Seite, nur die rechte Spalte bleibt beim Scrollen stehen (siehe «Navigation, Rahmen und Suche»).
- **Website-Einstellungen:** links Name und die vier Bildfelder, rechts «So sieht es aus» (Kopf am Tag, Kopf in der Nacht, Tab im Browser, Fehlerseite). Die Vorschau folgt jeder Wahl und dem Namen; der Zustand «Nicht gespeichert» steht als Wort mit Punkt in der Leiste unten.
- **Bildwahl in der Seite** (`bildwahl.js`): Ein Knopf öffnet die Bilder unter dem Feld (Suche im Alt-Text, 24 Bilder je Anfrage, nur öffentliche Bilder). Ein Klick wählt und schliesst; Escape schliesst nur die Wahl. Kein Fenster über der Seite. Eine Wahl löst ein `change` am Formular aus, damit die Frage «Änderungen verwerfen?» greift.
- **Medien:** Ansicht Raster oder Liste (dieselben Karten, `medien--liste`; nichts wird im Browser gespeichert, jeder Besuch beginnt mit dem Raster), Filterleiste (`filterleiste.js`: Suche im Alt-Text auf dem Server, Art und Sichtbarkeit auf den geladenen Medien, Trefferzahl), Auswahlleiste am unteren Rand mit «Alle wählen», «Löschen» (mit «Rückgängig») und «Auswahl aufheben». Alt-Text ändern und Hochladen sind Seiten im Fluss mit dem Bild gross neben den Feldern.
- **Ladezustände:** Bilder haben einen Platzhalter bis zum Laden (`bildMitLader`), Karten laden als Skeleton (Raster, Nachladen, Suche), Einstellungen, Bestellungen und Artikel haben ein Skeleton in ihrer Form.
- **Stufenfelder:** Stufen als Pillen, Datum und Zeit mit `datumsfeld.js`, rechts im Formular «So steht es auf der Stufenseite».
- **Lädeli:** Bestellungen sind Karten (Kopf mit Initialen und Stand, Statusschiene als Linie mit drei Punkten, Positionen mit Zeilensumme, Summe; #609) mit einer Statusschiene Offen, Bereit, Übergeben (`aria-current="step"`, erledigt mit Haken) und einem geteilten Knopf (nächster Schritt, im Menü die übrigen Wechsel). Artikel öffnen als Seite mit dem Bild gross neben den Feldern und der Bildwahl; die Reihenfolge der Artikel bleibt unverändert (Griff, Tastatur, Menü «Mehr»).

### Termine, Räume, Anlässe (#590)

Der Kalender ist eine **Monatsansicht** (`termine-monat.js`): Raster mit Terminchips (über mehrere Tage als verbundener Balken, höchstens drei Bahnen je Tag und «+N weitere»), rechts die Tagesliste des gewählten Tages. In der Zeile des Monats stehen nur noch die Gruppe und «Monat | Liste»; die Suche gibt es nur in der Liste. Oben im Kopf wechselt der Umschalter «Alle Termine | Meine Termine» (#608): Meine sind die Termine der Gruppen der angemeldeten Person, die API markiert sie je Termin mit `meine`, es gibt keine eigene Route. Die Tabelle bleibt als Ansicht «Liste» (3 oder 12 Monate, ohne Spalte «Quelle»). Adressen: `#termine/kalender` (dieser Monat), `…/2027-01`, `…/2027-01-16` (Tag gewählt), `…/liste`, `…/liste/12` (die alte Adresse `…/12` gilt weiter); Standard ist «Alle Termine»; Meine Termine nur mit «meine» nach «kalender», zum Beispiel `#termine/kalender/meine/2027-01`. Reine Funktionen (Wochen eines Monats, Tage eines Termins, Bahnen, Tastatursprünge, Filter, Speicher je Monat) stehen oben in der Datei und sind in `test/admin-termine-monat.test.ts` geprüft.

- **Abfragen:** ein Abruf der Gruppen für den Filter; je Monat eine Seite von bis zu 100 Terminen (weitere Seiten nur, wenn die API `weitere` meldet, höchstens 5); die Monate liegen 2 Minuten im Speicher. Filtern, Suchen und Sortieren läuft im Browser. Kein Polling.
- **Raster:** `role="grid"`, Roving Tabindex, Pfeile, Pos1/Ende, Bild auf/ab. Die Chips sind nur Zierde (`aria-hidden`); der Name des Tages nennt Datum und Zahl der Termine. Farben nur über Tokens: Auswahl und Balken in `--focus`, Abgesagt in der Fehlerfarbe und durchgestrichen, ohne Gruppe in der Warnfarbe und gestrichelt.
- **Speicherleiste** (`speicherLeiste` in `kalenderhilfen.js`): Statt «Speichern» im Seitenkopf erscheint unten eine Leiste, sobald etwas geändert ist (Zusatzfelder eines Anlasses, Kategorien). Ohne Änderung gibt es keinen Speichern-Knopf.
- **Anlässe (#608):** Die Liste steht nach Monaten (Vorlage: Zeitleiste mit Liste, Kokonut `event-timeline` und `calendar-schedule`): Monat links, rechts Karten mit Datumsblock, Titel, Zeit und Stand, Zahl der Angemeldeten, ganze Karte als Link. «Kommend | Vergangen | Alle» filtert im Browser. Ein Anlass hat vier Reiter mit eigener Adresse: Übersicht, Anmeldungen, Zusatzfelder, Einstellungen (`#anlaesse/<id>[/anmeldungen|/felder|/einstellungen]`). Die Einstellungen sind eine Seite mit Speicherleiste (Vorlage: `settings-dialog`: Änderungen sammeln, Zahl der Änderungen, Verwerfen). Zusatzfelder ordnet man mit der Sortierliste (`sortieren.js`); der Anmeldeschluss ist ein `datumZeitFeld`; die Plätze eines Raums ein `zahlfeld`. Die Liste bekommt die Rückmeldungen je Anlass mit derselben Abfrage (`anmeldungen: { angemeldet, abgemeldet }`).
- **Anmeldungen nur über den Anlass:** Es gibt keinen eigenen Menüpunkt und keine zweite Anlass-Auswahl. Der Reiter «Anmeldungen» hat Suche, Stand und die Tabelle; der Export ist eine Zeile mit Download-Muster (bereit, läuft, fertig, fehlgeschlagen). Rückmeldungen als Balkenzeilen stehen auf dem Reiter «Übersicht» (Vorlage: `poll-card`: Balken hinter der Zeile, Prozente mit grösstem Rest, Zählen nur bei erlaubter Bewegung). Die API kennt kein «Offen», darum gibt es nur Angemeldet und Abgemeldet. Der Bereich hat nur eine Unterseite: Liste `#anlaesse`, Anlass `#anlaesse/<id>`, Reiter `#anlaesse/<id>/felder`. Die alten Adressen schreibt `ALIASE` in `navigation.js` um (`#anlaesse/anlaesse/…` zu `#anlaesse/…`, `#anlaesse/anmeldungen[/<id>]` zur Liste bzw. zur Übersicht des Anlasses); zur Sicherheit leiten auch `termine-anlaesse.js` und die kleine Weiterleitung `termine-anmeldungen.js` um.
- **Räume:** Die Liste zeigt je Raum die offenen Anfragen (eine Abfrage, bis 50, sonst «Mindestens»); eine Belegungsansicht gibt es nicht, weil die API bestätigte Buchungen nicht auflistet. Die Anfragen stehen ab 70 rem Breite neben dem Detail. In der Liste und im Detail steht der Zweck an erster Stelle (Spalte «Wofür», Titel des Details, #622): Eine Anfrage trägt nur den Zweck als Freitext, keine Stufe und keinen Anlass; Raum, Zeitraum und Person folgen. Eine Stufe oder ein Anlass als Verknüpfung braucht eine Erweiterung von API und Apps (Entwurf, Entscheid offen).

### Hinweisband, System, Plattform, Erinnerungen, Mitteilungen (#593)

- **Hinweisband** (`hinweisband.js`): Solange ein Bereich in Wartung oder durch eine Informationssperre gesperrt ist, steht unter dem Kopf jeder Seite ein Band (Sperre rot, Wartung gelb, immer mit Wort und Symbol) mit Bereich, Zeitpunkt, Hinweistext und Verweis auf `#system/plattform`. Es erscheint nur für Personen, die die Plattform sehen (Abteilungsleitung, Plattformrecht `wartungsmodus.website`); wer nicht schalten darf, bekommt auch keinen Abruf. Quelle ist `GET /api/v1/plattform/schalter` (Speicher der API, keine Datenbankabfrage). Der Abruf läuft beim Öffnen der Verwaltung, nach jeder Schaltung auf der Plattform (Ereignis `plattform:geaendert`) und bei einer Navigation höchstens einmal je Minute, nie im Takt.
- **System** lädt nur beim Öffnen und auf «Aktualisieren», kein Polling (`aufWunsch` statt des früheren Takts von 15 Sekunden). Auf der Übersicht steht der Verlauf der Anfragen der letzten 24 Stunden als Säulen je Stunde mit Fehleranteil (`saeulen` aus `uebersicht-diagramme.js`, Tabelle dahinter).
- **Plattform** zeigt je Bereich eine Zeile mit Zustand (Chip), Einzelheiten und Aktionen; auf dem Handy stehen die Aktionen unter dem Text, es gibt keine Tabelle zum Seitwärtsscrollen. Das geplante Ende der Wartung ist ein `datumZeitFeld` (kein natives `datetime-local`); ein Datum ohne Uhrzeit wird beim Speichern gemeldet.
- **Erinnerungen** bauen den Zeitplan aus Wochentag (Segment mit Radioknöpfen), Uhrzeit (`zeitfeld`) und zeigen darunter die nächsten sechs Termine als Streifen (`naechsteTermine`, gerechnet in Schweizer Zeit). Die Liste nennt je Regel das nächste Mal.
- **Mitteilungen** (#625): Formular links, Vorschau rechts (`formularRaster`). Die Empfänger sind eine **Liste von Zielen**: Ein Ziel ist eine Gruppe (jeder Tag: Stufe, Funktion, Team, Lager, Anlass) mit den Rollen, die zu ihrer Art passen. Bei einer Stufe: Kinder (über die Eltern), Leitende, Stufenleitung; bei allen anderen Gruppen: Alle Mitglieder, Verantwortliche. Mehrere Ziele lassen sich kombinieren («Leitende von Artemis» und «Kinder von Exodus» und «Team Material, alle»). Gruppen wählt die Suche (Muster «action-search-bar»: Suchfeld, Reiter je Art mit Zahl, Liste mit Pfeiltasten und Enter), die Rollen sind Umschalter mit Haken (Muster «team-invite-card»). «Alle aktiven Konten der Abteilung» bleibt ein eigenes Ankreuzfeld und schliesst die Ziele aus. Rechts steht der Push und die Zahl der Konten je Ziel und gesamt (eine Person in mehreren Zielen zählt im Total einmal); sie kommt vom Server (`POST /api/v1/admin/mitteilungen/vorschau`, nur Zahlen, nie Namen) einmal je Änderung der Wahl nach 250 ms Pause, gleiche Wahl aus dem Speicher der Seite, kein Polling. Die Gruppen kommen mit einem Abruf (`GET /api/v1/admin/tags`). Die Rückfrage vor dem Senden bleibt ein zweistufiger Knopf und nennt die Zahl der Konten; eine Wahl ohne Konten sendet nicht. Gesendet wird die neue Form (`ziele`) oder, bei «Alle», `empfaenger: "alle"`; die API nimmt die frühere Form (`stufeIds`, `rollen`) weiter an, für Apps und Skripte. Verantwortliche sind die Mitglieder mit der Rolle «verantwortlich» an der Zuordnung (wie bei den Teams, `TEAM_ROLLE`).
- **Komponenten** (`komponenten.js`) steht seit #607 in keiner Navigation mehr; die Datei bleibt für die Entwicklung, die Beschreibung der Bausteine zieht später in die Doku um.

### Lager (#592)

Der Bereich `#lager` nutzt die Querschnitt-Bausteine (`sortieren.js`, `filterleiste.js`, `datumsfeld.js`, `aktionen.js`) und trägt sonst nur eigene Klassen mit dem Vorsatz `lg-` (`lager.css`). Funktion, Routen und Rechte sind unverändert; der Server prüft weiter alles.

| Ansicht (Adresse)                         | Aufbau                                                                                                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liste (`#lager/lager`)                    | `filterleiste` (Suche, Status, Trefferzahl), sortierbare Tabelle (am Handy Kartenliste, `kartenTabelle`)                                                                                                                                      |
| Detail (`…/<id>`)                         | Hauptaktion je Status als geteilter Knopf (Aktivieren, Abschliessen; Archivieren im Menü), Statuswechsel sofort mit «Rückgängig» in der Meldung; Löschen als `bestaetigungAmOrt` mit Namenseingabe in der Fläche unten                        |
| Neues Lager (`…/neu`, `…/neu/<schritt>`)  | vier Schritte mit eigener Adresse (`grunddaten`, `vorlage`, `mitglieder`, `pruefen`), senkrechte Zeitleiste, erledigte Schritte als Zeile mit «Ändern»; die Eingaben liegen im Modul (`entwurf`), Zurück im Browser geht einen Schritt zurück |
| Mitglieder (`…/<id>/mitglieder`)          | `personenWahl` (Suche mit Gesichtern, mehrere Personen, eine Rolle für alle), Liste mit Rolle am Ort ändern und Entfernen, beides über `ctx.mitRueckgaengig`                                                                                  |
| Rechte (`…/<id>/rechte`)                  | nach Bereichen gruppiert in Klartext (`BEREICHE`, `KLARTEXT` in `lager-rechte.js`), Filter Lesen/Ändern und «Weicht ab», Leiste «N Änderungen» mit Verwerfen und Speichern                                                                    |
| Ausdrucke (`…/<id>/ausdrucke`)            | je Aushang Dateiname, Typ, Grösse, Fortschritt (`progress`), Abbrechen, Herunterladen                                                                                                                                                         |
| Vorlagen (`#lager/vorlagen[/packlisten]`) | Liste je Art; Anlegen und Bearbeiten als Seite im Fluss mit `sortierListe` (Griff, Tastatur, Pfeilknöpfe), Titel am Ort, Einfügen mehrerer Zeilen auf einmal                                                                                  |

Das Rechte-Modell ist nicht verändert: Die Rechte der Rollen heissen im Server weiter wie bisher; nur die Anzeige zeigt statt des Schlüssels einen Satz.

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
| Zähler Unterleiste | `ctx.zaehler(unterSchluessel, n)` (roter Kreis, 24 px)                                       | `pille-zaehler`                         |

Regeln, die weiter gelten: genau eine rote Hauptaktion je Ansicht; fehlt die Aktion in der API, fehlt der Knopf (nicht ausgegraut); Löschen, Wiederherstellen und Archivieren nie rot-primär und immer mit «Rückgängig» (Toast) oder, wo das nicht geht, zwei Stufen im Knopf, nie mit einem Popup; Tabellen mit `th scope` und `aria-sort`; nur Erfolgs- und Infomeldungen verschwinden von selbst, nie ein Fehler oder eine Rückfrage. Eine Meldung, die bleiben muss, bis jemand handelt, bekommt die Art `warn` oder `fehler` oder eine Aktion.

### Listen und Formulare (Personen, Gruppen und Tags)

- Sortierbare Tabelle: `tabelle(...)`, danach `macheSortierbar(wurzel, [{ index, schluessel, name }], zustand, beiAenderung)`; der Kopf wird ein Knopf mit Sortierwort, `aria-sort` steht am `th`. `sortiere(liste, zustand, schluesselVon)` ordnet die Zeilen. «Aktionen» ist im Kopf nur für Screenreader sichtbar (`aktionenKopfVerstecken`).
- Blättern: `seitenleiste({ beiWechsel })` mit «Einträge a bis b von n», Zurück und Weiter und «Zeilen pro Seite» (25, 50, 100); sie bleibt bis 25 Zeilen unsichtbar.
- Fehler beim Feld: `feldFehler(feld, text)` und `entferneFehler(feld)`, dazu `pruefHinweis([{ name, … }])` für die Zusammenfassung «2 Angaben prüfen» (Knöpfe statt Links, ein Hash würde die Seite wechseln). Der Fehler eines Dialogs steht oben (`pe-dialog`).
- Auswahlleiste (`.auswahlleiste`, `role="region"`) für Mehrfachauswahl, `.pe-wahl` für die Checkbox-Spalte.

Die Galerie der Bausteine (`komponenten.js`) hängt seit #607 an keinem Menüpunkt mehr; Zustände eines Bausteins prüfst du in der Seite, die ihn braucht, in Tag und Nacht.

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

## Navigation, Rahmen und Suche (#602, #611)

- **Eintrag nach Recht:** `darfSehen` in `navigation.js` entscheidet, welche Einträge die Person sieht: `admin` (Vorgabe), `alle`, ein Bereich aus `GET /api/v1/redaktion/ich`, `entwickler` (Signal `nameAenderbar` in `GET /api/v1/redaktion/website`, gilt auch für die Abteilungsleitung nicht automatisch) oder `recht:<name>` (ein Plattformrecht aus `rechte` der Antwort von `redaktion/ich`; die Abteilungsleitung hat alle). «Einstellungen» der Website `recht:seiten.veroeffentlichen` (die Route verlangt das Recht; die Stufenleitung lief sonst in ein 403). Das Menü ist nur Anzeige: Jede Route prüft selbst, und ein Tiefenlink auf einen versteckten Eintrag zeigt «Kein Zugriff».
- **Alte Adressen (`ALIASE`):** `#anlaesse/anmeldungen` (mit oder ohne Kennung) führt seit #607 zur Liste der Anlässe bzw. zum Anlass `#anlaesse/<id>`; «Anmeldungen» ist kein eigener Menüpunkt mehr, die Anmeldungen gehören zum Anlass.
- **Rolle im Kopf:** `rolleVon` (`navigation.js`) setzt die Zeile unter dem Namen aus dem, was bekannt ist: Abteilungsleitung (mit «Entwickler ·» davor, wenn `nameAenderbar` gilt), sonst Stufenleitung und Leitung mit den Namen der Stufen aus `GET /api/v1/ich`, «Website-Redaktion» bei Rechten auf Seiten oder Medien, «Wartung der Website» bei nur dem Wartungsrecht. Die Namen der Plattformrollen kennt nur die Abteilungsleitung (`/admin/plattform/rollen`); darum steht hier die Funktion, nicht der Rollenname. Zwei Abrufe laufen vor dem ersten Bild (`GET /api/v1/redaktion/website` nur mit dem Recht «Seiten veröffentlichen», `GET /api/v1/ich` nur ohne Abteilungsleitung), damit Kopf und Menü gleich stimmen.
- **Marke ohne Einstellungen:** Wer die Einstellungen der Website nicht lesen darf, und die Anmeldung vor der Sitzung, zeigen den Kopf der öffentlichen Website (`ladeOeffentlicheMarke` in `rahmen.js` liest die Startseite `/`, die jede Person ohne Sitzung sieht, und nimmt Logo und Namen aus `header a.marke`). Es gibt dafür keine eigene Route. Fehlt die Seite (Wartung, Sperre, anderer Aufbau), bleibt die Wortmarke «CEVI». Die Einstellungen gehen vor. Der Ortsname steht nirgends im Code.
- **Bereichsauswahl schmal:** Unter 960 px (die zehn Bereiche brauchen 850 px) ersetzt `erstelleBereichswahl` in `rahmen.js` beide Leisten. Die Zeile zeigt Bereich und Seite, das Panel wächst aus ihr (Prinzip «Workspace-Switcher»), der aktive Bereich zeigt seine Unterseiten mit den Zählern, das geschlossene Panel ist `inert`. Tastatur und Verhalten: `docs/barrierefreiheit.md`, 22.3 bis 22.5. Beide Leisten bleiben im Quelltext und sind nur verborgen (`display: none`), die Auswahl am Computer ebenso.
- **Suche** (`befehlspalette.js`, Strg oder Cmd + K, Knopf «Suchen» im Kopf; #602, #611; Vorlage im Aufbau: «Action Search Bar» für Feld, Reiter und Tastenhilfe, «Team Member List» für die Zeile mit Bild, Angaben und Zustand, «Slash Command Menu» für die Treffer im Text): ein nativer `dialog` mit Suchfeld (`role="combobox"`), Reitern mit Trefferzahl und einer Liste (`role="listbox"`, `aria-activedescendant`) in Gruppen. Die Karte ist so breit wie der Inhalt der Website (105 rem, Seitenrand wie dort), über abgedunkeltem Grund; Klassen `palette-*` und `pz-*` in `geruest.css`.
  - **Gruppen und Zeilen:** Aktionen («Neue Person», «Neues Lager»), Seiten der Verwaltung (Titel, was sie zeigt, wo sie steht, «Du bist hier»), Personen (Bild oder Initialen, Name, Cevi-Name, Rollen im Klartext wie in der Personenliste, die ersten drei Tags als Chips, Zustand des Kontos), Gruppen und Tags (Typ, Zahl der Mitglieder), Termine (Datum, Zeit, Ort, Gruppen), Anlässe (Zeitraum, Stand der Anmeldung), Seiten der Website (Adresse, Zugriff, Veröffentlicht oder Entwurf), Lager (Zeitraum, Ort, Stand). Treffer im Text sind hervorgehoben. «Alle» zeigt je Gruppe wenige Zeilen und «Alle 16 Personen anzeigen»; die Gruppe mit dem besten Treffer steht oben, damit Enter das Wahrscheinlichste öffnet. Ohne Frage stehen «Zuletzt benutzt» (nur im Speicher dieser Sitzung), die Aktionen und die ersten Seiten.
  - **Recht:** Eine Gruppe erscheint nur, wenn die Navigation der Person die zugehörige Seite zeigt (`hatSeite` auf `bereiche()`): Personen und Gruppen, Termine, Anlässe, Lager gehören der Abteilungsleitung, Website-Seiten allen mit Zugang zur Website. Kinder sind nicht dabei. Die Daten kommen aus den Routen, die diese Seiten ohnehin aufrufen; der Server prüft jede.
  - **Last:** Keine Abfrage je Tastendruck. Beim Öffnen läuft je Quelle eine Abfrage (nur mit Recht, höchstens eine zugleich): `GET /api/v1/redaktion/seiten`, `GET /api/v1/termine/alle` (die nächsten 92 Tage, höchstens 100), `GET /api/v1/admin/anlaesse` (50), `GET /api/v1/admin/lager`, und für Personen `ladeDaten()` aus `personen.js` (Liste, Tags und je belegtem Tag ein Abruf; die Liste der API bringt die Tags einer Person nicht mit). Das Ergebnis liegt fünf Minuten im Speicher der Seite, nie auf dem Gerät; die Suche filtert im Browser. Hat die Seite «Personen» ihre Liste geladen, übergibt sie sie mit `meldePersonen` und die Suche fragt dort nicht nochmals. Beim Abmelden und beim Wechsel des Kontos wird der Speicher geleert (`vergiss`). Von einer Person bleiben nur Name, Cevi-Name, Benutzername, Bild, Rollen, Tags und Konto-Zustand: nie Startpasswort, Telefon oder Kinder. Termine reichen drei Monate voraus; was weiter weg liegt, steht im Kalender.
  - **Aktion:** Eine Person oder «Neue Person» setzt einen Wunsch (`nimmWunsch`), den `personen.js` beim Öffnen genau einmal abholt (Suche setzen und den Fokus auf die Zeile der Person, Formular öffnen); alle anderen Treffer sind Adressen (`#personen/gruppen/<id>`, `#termine/kalender/<Tag>`, `#anlaesse/<id>`, `#website/seiten/<id>`, `#lager/lager/<id>`).
  - Die Suche ist die einzige Überlagerung der Verwaltung und gehört dem Suchfeld: Escape schliesst, der Fokus kehrt zurück, vor der Anmeldung tut das Kürzel nichts. Prüfpunkte: `docs/barrierefreiheit.md`, Abschnitt 30.
- **Mein Konto** (`konto.js`, `konto.css`, Adresse `#konto`, #621; Vorlage im Aufbau: «Profile Card» für die Karte und «Edit Profile Form» für die Marke bei Geändertem und die Speicherleiste): kein Bereich der Leiste. Der Name im Kopf ist der Link (`a.konto`, `aria-current="page"`, solange die Seite offen ist, mit dem Profilbild); `loese` in `navigation.js` kennt `#konto` (`KONTO`, `KONTO_BEREICH`) und liefert die Seite jeder Person mit Zugang. Sie zeigt nur die eigene Person und benutzt nur Routen für sie: `GET` und `PATCH /api/v1/ich` (Telefon nur Stufenleitung, Push-Schalter), `PUT` und `DELETE /api/v1/ich/bild`, `POST /api/auth/change-password` und `POST /api/auth/revoke-sessions`. Name, Cevi-Name und Benutzername stehen gesperrt (sie ändert die Abteilungsleitung unter «Personen»). **Lücken der API:** eigene Gruppen und Tags, Liste der Sitzungen und Geräte, zweiten Faktor einrichten, ändern oder abschalten, Name, Cevi-Name und E-Mail ändern. Der Hinweis «Auf der Website» folgt der Regel nach Rolle (#610) und ist reiner Text ohne Schalter. Prüfpunkte: `docs/barrierefreiheit.md`, Abschnitt 36.
- **Formularraster:** `formularRaster` hat keine eigenen Scrollbereiche; die rechte Spalte (Vorschau, Bild) haftet beim Scrollen der Seite (`position: sticky`). `scroll: true` gibt jeder Spalte ab 1100 px einen Scrollbereich in Fensterhöhe, nur für Ansichten ohne Kopf, die das ganze Fenster füllen (heute keine). Eine Flussseite mit Zweispalter ist so breit wie die breiten Seiten (`fluss.css`, `bildwahl.css`). Die früheren Überschreibungen `ws-frei` und `mt-raster` sind entfallen.

## Favicon (#581)

Die Verwaltung zeigt im Tab dasselbe Zeichen wie die Website der Abteilung, nicht ihr eigenes Symbol. `index.html` trägt zwei Einträge: `<link rel="icon" href="/favicon.ico">` und `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`. Die API liefert beide Adressen selbst (`app.ts`, ohne Anmeldung, mit `ETag`, ohne Datenbankabfrage je Aufruf): `seiten.zeichen` hält die Dateien im Speicher, `server.ts` füllt sie beim Start und nach jedem Abgleich mit dem gewählten Zeichen der Abteilung, sonst mit dem Cevi-Zeichen (`admin/favicon.svg`). Weil eine Instanz genau eine Abteilung trägt, ist das Zeichen schon vor der Anmeldung das der Abteilung (es ist öffentlich); ohne Wahl ist es das Cevi-Zeichen. Die CSP der Verwaltung (`img-src 'self' data:`) erlaubt beide Adressen. `admin/favicon.svg` bleibt als Quelle des Cevi-Zeichens und als Ersatzbild in Listen (`STANDARD_LOGO`). Ein neuer Einstieg (weitere HTML-Seite der Verwaltung oder der Plattform) braucht dieselben zwei Einträge; der Test in `test/seiten.test.ts` prüft sie für `/admin`, `/datenschutz`, `/support` und `/konto-loeschen`.

## Lokal prüfen

Der Server liest alle Dateien aus `public/admin/` **einmal beim Start** (`src/seiten.ts`). Nach jeder Änderung an einer Datei dort den Server neu starten, sonst zeigt der Browser die alte Fassung. Eigener Dev-Server und Datenbank wie in der Regel für UI-Arbeit; der zweite Faktor lässt sich in Playwright umgehen, indem `GET /api/auth/get-session` und die Daten-Routen mit `page.route` beantwortet werden (siehe die Antwortformen in `docs/api/openapi.yaml`). Prüfe jede Ansicht bei 1280, 1024 und 390 px in Tag und Nacht (`emulateMedia({ colorScheme })`), mit Tastatur und mit `reducedMotion: "reduce"`.

## Änderungen am Gerüst

Das Gerüst ändert sich nach dem ersten Stand nur additiv: neue Klassen in der eigenen Datei, neue Einträge in `navigation.js`. Wer `admin.js`, `admin.css`, `dom.js` oder `index.html` anfasst, hält die Änderung klein und nennt sie im PR. Stile eines Bereichs gehören in `<bereich>.css` mit eigenem Klassenvorsatz.
