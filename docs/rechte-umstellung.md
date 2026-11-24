# Rechte: Umstellung der Routen auf `darf()`

Anleitung für die Arbeit, die auf dem Fundament aus #643 folgt: die Stellen, die heute `person.abteilungsleitung` (bis #735 `person.admin`) oder eine der alten Funktionen prüfen, auf das Recht aus dem Katalog umstellen. Das Modell steht in [rechte.md](rechte.md), Abschnitt 8. Massgebend sind der Code unter `apps/api/src/rechtemodell/` und die Matrizen der Tests.

## 1. Muster

Eine Route prüft in dieser Reihenfolge; die Antworten ändern sich nicht:

1. Sitzung, Pflichtwechsel, Sperre und Wartung (Middleware, wie bisher).
2. Das Objekt in SQL auf `person.abteilungId` gefiltert laden. Fremd oder unbekannt: **404**, auch wenn die Person es nicht sehen dürfte.
3. `await verlange(db, person, "bereich.recht", objekt)`: **403** ohne das Recht, danach **403 `ZWEITER_FAKTOR_FEHLT`**, wenn das Recht `erweitert` ist und die Person keinen zweiten Faktor hat.
4. Der Zustand (**409**).

```ts
// vorher
if (!person.abteilungsleitung) throw new HTTPException(403);

// nachher: Tür (das Recht irgendwo), dann je Objekt
const anlass = await ladeAnlass(db, person.abteilungId, id); // 404
await verlange(db, person, "anlass.anmeldungen_sehen", {
  abteilungId: person.abteilungId,
  anlassId: anlass.id,
});
```

- `objekt` nennt nur, was die Route weiss: `seiteId`, `tagId` (Gruppe der Seite oder Ziel), `stufeId`, `anlassId`, `raumTeamTagId` (Team des Raums, `null` ohne Team), `abteilungsweit: true` (Frage gilt der ganzen Abteilung, nur Geltung «alle» zählt). Ohne `objekt` fragt `darf` «irgendwo»: Das passt für die Tür einer Seite der Verwaltung, nie für eine Handlung an einem Objekt.
- `darf` gibt `boolean`, wenn die Route mehr als 403 antworten will (zum Beispiel Felder weglassen). `darfEines` prüft mehrere Rechte für eine Tür.
- Listen filtern in SQL: `rechtSql(person, "recht", { abteilungId: tabelle.abteilungId, tagId: …, anlassId: …, raumTeamTagId: …, id: … })` statt «alles laden, dann je Zeile `darf`». Im Schattenbetrieb setzt der alte Weg durch: `or(alteBedingung, rechtSql(…, "rollen"))` gibt, was der alte Weg und die Rollen zusammen erlauben.
- **Identität ist kein Recht.** Prüfungen wie «nie die eigene Anfrage entscheiden» oder «nur das eigene Kind» bleiben als Code in der Route.
- Ein neues Recht kommt zuerst in `rechtemodell/katalog.ts` (Bereich, Klartext, Erklärung, Risiko, Art, Geltungen, Bezug), dann in `docs/rechte.md` Abschnitt 8.2 (der Test `rechte-doku.test.ts` hält Tabelle und Katalog gleich).
- Hat ein Recht die Geltung «eigene», muss der Bezug im `objekt` ankommen; sonst trifft «eigene» nichts (fail-closed). Beispiel Seite des OK: `{ seiteId, anlassId }`, die Route sucht den Anlass über `anlass.seite_id`.

Das erste umgestellte Beispiel ist `POST /api/v1/admin/mitteilungen` und `/vorschau` (`routes/admin/mitteilungen.ts`): Tür mit `verlange(…, "mitteilung.senden")`, je Ziel `darf(…, { tagId })`, für «alle» `{ abteilungsweit: true }`. Tests: `test/admin-mitteilungen-rechte.test.ts`.

## 2. Reihenfolge

1. **Website** (`routes/redaktion/*`, `bearbeiten.ts`, `website/seiten.ts`): `darfBearbeiten` und `hatPlattformRecht` durch `darf` ersetzen. Seiten des OK brauchen `anlassId` (Anlass über `anlass.seite_id` suchen).
2. **Termine, Anlässe, Räume** (`termine/*`, `routes/termine/*`): `darfAnlaesseVerwalten`, `darfVorschlagen`, `darfEntscheiden`, `darfBelegungSehen`, `darfRaeumeVerwalten` ersetzen. Die Anmeldungen (sehen, exportieren) bekommen zwei Rechte.
3. **Lädeli** (`laden/laden.ts`, `routes/laden/*`): `darfLadenVerwalten` in vier Rechte aufteilen.
4. **Verwaltung** (`routes/admin/*`): Personen, Kinder, Import, Gruppen, Stufen, Medien, Profilbild.
5. **Plattform** (`routes/plattform.ts`, `bereichsschalter.ts`, `routes/admin/system.ts`, `protokoll.ts`): feste Rechte.
6. Danach den Modus auf `neu` stellen (Abschnitt 4) und die alten Funktionen in `alt.ts`, `plattform.ts`, `bearbeiten.ts` und den Modulen der Termine entfernen.

Ein Bereich je Pull Request. Nach jedem Bereich laufen die Matrizen unverändert.

## 3. Teststrategie

- **Die Matrizen bleiben die Sicherung.** `test/rechte-matrix.test.ts`, `test/lager/matrix`, `test/termine/matrix` ändern sich nur für neue Routen oder dort, wo eine Abweichung bewusst entschieden ist (im Pull Request unter «Merge Danger» nennen, mit dem Entscheid des Nutzers). `rechte-matrix.test.ts` enthält ungültiges UTF-8: nur byte-erhaltend ändern.
- **Vor der Umstellung einer Route:** `test/rechtemodell.test.ts` zeigt, ob alter und neuer Weg für die Personas übereinstimmen. Neue Personen und Objekte der Route dort in `test/hilfen/rechtewelt.ts` ergänzen.
- **Neue Zeilen im Literal** (`FAELLE` in `test/rechtemodell.test.ts`): von Hand gegengelesen, nie aus dem Katalog berechnet.
- **Eigene Tests je Route:** Gruppenrolle mit «eigene» wirkt am eigenen Objekt und nie am fremden; Rolle einer anderen Abteilung wirkt nie; ohne zweiten Faktor 403 `ZWEITER_FAKTOR_FEHLT`; Reihenfolge 404 vor 403.
- **Property-Test:** Wer ein Recht in einer Liste auswertet, ergänzt es in `test/rechtemodell.test.ts` (`rechtSql` gegen `RechteSatz`); der Test läuft über alle Rechte des Katalogs.
- **Schattenbetrieb:** `schattenAbweichungen()` (`darf.ts`) zählt die Abweichungen; ein Test, der eine Route aufruft, darf keine neue auslösen, ausser einer dokumentierten.

## 4. Modus und Schattenbetrieb

`RECHTE_MODELL=alt|schatten|neu` (Umgebung, Vorgabe `schatten`):

- `schatten`: Der alte Weg und was Plattform- und Gruppenrollen zusätzlich geben, setzen durch. Jede Abweichung des neuen Wegs steht im Log und im Aktivitätsprotokoll als `rechte_schatten` (Recht, Richtung `alt_ja_neu_nein` oder `alt_nein_neu_ja`, Art der Objekt-Felder; nie Personen).
- Umschalten auf `neu`, wenn die Abweichungen des Betriebs über zwei Wochen erklärt oder behoben sind und die Matrizen grün sind. Zurück per Variable, ohne Code.
- Gewollte Abweichungen heute: Die Abteilungsleitung entscheidet im neuen Weg Raumanfragen aller Teams (alt: nur Mitglieder des Teams); der Entwickler hat jedes Recht des Katalogs (alt: nur 12 von 57; #722), auch Personen-, Kinder- und Lagerdaten, und besteht die Prüfung im Schattenbetrieb über `ausRollen`. Die Abweichungen stehen in `docs/rechte.md` 8.4.
- Ein Team-Verantwortlicher, dessen Freitext «verantwortlich» ohne die Systemrolle gesetzt wurde (zum Beispiel durch direktes Schreiben in die Datenbank), fällt im neuen Weg aus der Funktion: Der Trigger `person_tag_rolle_abgleich` verhindert das für alle Wege über die Datenbank; ein Abweichungsprotokoll `alt_ja_neu_nein` zeigt den Rest.

## 5. Stellen mit `person.admin` und Vorschlag je Stelle

**Benennung seit #735:** Das Feld heisst `Person.abteilungsleitung` (vorher `admin`); dazu `Person.entwickler` und der Helfer `siehtAlles(person)` in `rechte.ts` (Abteilungsleitung oder Entwickler). Die Stellen der Tabelle heissen unten noch `person.admin`, wie sie am 23.11.2026 gezählt wurden. Die Zeilen «bleibt (Sicht …)» und «Abteilungsleitung ist Lagerleitung» hängen jetzt an `siehtAlles`, damit der Entwickler dieselben Sichten hat (Lücke 16 in [rechte.md](rechte.md) ist zu); der alte Weg `rechtemodell/alt.ts`, die Pflicht des zweiten Faktors und die Regeln der Identität bleiben an `Person.abteilungsleitung`.

Gezählt am 23.11.2026 mit `grep -rn "person\.admin\|\.admin\b" apps/api/src`: 104 Treffer in 49 Dateien. «Bleibt» heisst: Es ist Identität, Struktur oder ein fester Schutz, kein Recht des Katalogs. Wo ein Entscheid fehlt, steht er in der Zeile.

| Stelle                                                                                                         | Heute                                             | Vorschlag                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/admin/mitteilungen.ts` (2)                                                                             | Abteilungsleitung                                 | **umgestellt:** `mitteilung.senden`                                                                                                                                                                                                            |
| `routes/admin/rechte.ts` (1), `plattform-rollen.ts` (1), `bearbeiter.ts` (3)                                   | Abteilungsleitung                                 | **umgestellt** (#663): `rechte.verwalten` (fest), die Rechte der Rollen auch `rechte.abteilungsleitung` (Entwickler)                                                                                                                           |
| `routes/admin/personen.ts` (8)                                                                                 | Abteilungsleitung                                 | `personen.verwalten`; Rolle der Abteilungsleitung setzen (`aenderung.abteilungsleitung`) und Konto löschen: `rechte.verwalten` und `konto.loeschen` (fest)                                                                                     |
| `routes/admin/kinder.ts` (3), `import.ts` (2)                                                                  | Abteilungsleitung                                 | `personen.verwalten`                                                                                                                                                                                                                           |
| `routes/admin/tags.ts` (3)                                                                                     | Abteilungsleitung                                 | `gruppen.verwalten` (Geltung «eigene»: die Gruppe als `tagId`); Rolle zuordnen bleibt `rechte.verwalten`                                                                                                                                       |
| `routes/admin/stufen.ts` (4), `routes/stufenlogo.ts` (2)                                                       | Abteilungsleitung                                 | `gruppen.verwalten`; Stufenleitung setzen: `rechte.verwalten`                                                                                                                                                                                  |
| `routes/admin/lager.ts` (3), `lager-dateien.ts` (2), `lager-rechte.ts` (1), `vorlagen.ts` (1)                  | Abteilungsleitung                                 | `lager.verwalten` (fest); die Rechte im Lager bleiben je Lager                                                                                                                                                                                 |
| `lager/policy.ts` (2), `routes/lager/lager.ts` (3)                                                             | Abteilungsleitung ist Lagerleitung                | bleibt als `siehtAlles` (Lager-Rechte; auch der Entwickler)                                                                                                                                                                                    |
| `routes/admin/system.ts` (4)                                                                                   | Abteilungsleitung                                 | `system.lesen` (fest)                                                                                                                                                                                                                          |
| `routes/admin/uebersicht.ts` (12)                                                                              | Kacheln je `rechte.admin`                         | je Teil das Recht der Kachel: Anlässe `anlass.verwalten`, Anfragen `raum.anfrage_entscheiden`, Vorschläge `vorschlag.entscheiden`, Bestellungen `laden.ansehen`, Website `seiten.bearbeiten` (irgendwo); Rolle der Person als Liste statt Flag |
| `routes/admin/zeitregeln.ts` (3)                                                                               | Abteilungsleitung                                 | **Entscheid nötig:** neues Recht `termine.zeitregeln` (erweitert) oder `termine.kategorien_zuordnen`                                                                                                                                           |
| `routes/admin/protokoll.ts`                                                                                    | Entwickler                                        | `protokoll.lesen` (fest, nur Entwickler)                                                                                                                                                                                                       |
| `routes/termine/admin-vorschlaege.ts` (3), `vorschlaege.ts` (2)                                                | Abteilungsleitung; eigene Vorschläge die Person   | `vorschlag.entscheiden`; «eigener Vorschlag» bleibt Identität                                                                                                                                                                                  |
| `routes/termine/kategorie-zuordnungen.ts` (1)                                                                  | Abteilungsleitung                                 | `termine.kategorien_zuordnen`                                                                                                                                                                                                                  |
| `routes/termine/warnungen.ts` (1)                                                                              | Abteilungsleitung                                 | `termine.warnliste`                                                                                                                                                                                                                            |
| `routes/termine/mein.ts` (1), `termine/sicht.ts` (1), `sichtbarkeit.ts` (2), `programmsicht.ts` (`alleOderSl`) | Abteilungsleitung sieht alles                     | bleibt als `siehtAlles` (Sicht folgt Beziehungen, nicht Rechten)                                                                                                                                                                               |
| `termine/anlass-recht.ts` (1)                                                                                  | Abteilungsleitung                                 | `anlass.verwalten` (Objekt `{ anlassId }`), Anlegen und Löschen `anlass.anlegen`; Anmeldungen `anlass.anmeldungen_sehen` und `anlass.anmeldungen_exportieren`                                                                                  |
| `termine/raum.ts` (2), `raum-buchung.ts` (2)                                                                   | Abteilungsleitung, Team des Raums                 | `raum.verwalten`, `raum.anfrage_entscheiden`, `raum.belegung` (Objekt `{ raumTeamTagId }`); die eigene Anfrage entscheidet nie dieselbe Person (Identität)                                                                                     |
| `termine/vorschlag.ts` (1)                                                                                     | Abteilungsleitung, Rollen, Gruppen                | `vorschlag.einreichen`                                                                                                                                                                                                                         |
| `laden/laden.ts` (1)                                                                                           | Abteilungsleitung                                 | `laden.ansehen` (lesen), `laden.artikel_pflegen`, `laden.bestellungen_bearbeiten`, `laden.einstellungen`                                                                                                                                       |
| `routes/medien.ts` (2)                                                                                         | Abteilungsleitung                                 | `medien.verwalten`                                                                                                                                                                                                                             |
| `routes/profilbild.ts` (1)                                                                                     | Abteilungsleitung                                 | `profilbild.entfernen` (mit Protokolleintrag; der Entscheid vom 23.11.2026 nennt auch den Entwickler: Der Katalog tut es)                                                                                                                      |
| `routes/plattform.ts` (1), `bereichsschalter.ts` (1)                                                           | Abteilungsleitung oder Entwickler                 | `plattform.sperren` (fest); Wartung der Website `wartungsmodus.website`                                                                                                                                                                        |
| `routes/programme.ts` (4), `routes/stufen.ts` (2)                                                              | Abteilungsleitung oder Leitung der Stufe          | bleibt (Programme und Anwesenheit folgen der Stufe; Struktur)                                                                                                                                                                                  |
| `website/seiten.ts` (2)                                                                                        | Tür der Website-Verwaltung                        | `darfEines(["seiten.bearbeiten", …])` ohne Objekt                                                                                                                                                                                              |
| `bearbeiten.ts` (3), `plattform.ts` (3)                                                                        | Quelle des alten Wegs                             | entfällt mit dem Modus `neu`                                                                                                                                                                                                                   |
| `routes/ich.ts` (1)                                                                                            | zeigt `abteilungsleitung` und `entwickler`        | Vertrag seit #736, kein Alias; `rechte` als Liste                                                                                                                                                                                              |
| `verwalter.ts` (1), `personen-anlegen.ts` (2), `rechte.ts` (zweiterFaktorPflicht)                              | letzte Verwalter, Anlegen, zweiter Faktor je Pfad | bleibt (Schutz vor Aussperren, Kommandozeile)                                                                                                                                                                                                  |

Neu zu bauen, wenn die Umstellung sie trifft: Weg für «Kind mit eigenem Konto» und «Eltern verwalten das Konto» (Agent V), `profilbild.entfernen` mit Protokolleintrag.

## 6. Stand nach #663: die Rechte der Abteilungsleitung sind einstellbar

Die Abteilungsleitung ist eine Systemrolle, deren vergebbare Rechte der Entwickler wegnehmen kann ([rechte.md](rechte.md), Abschnitt 8.6). Das wirkt an jeder Route, die `verlange` oder `darf` fragt. Wer eine Stelle umstellt, wählt für das Recht der Abteilungsleitung nichts Besonderes: Sie ist ein Fall von `darf()`. Seit #735 an `siehtAlles` (Abteilungsleitung oder Entwickler) hängen und folgen der Einstellung erst nach der Umstellung: die Kacheln der Übersicht (`routes/admin/uebersicht.ts`), die Sicht auf Programme, Seiten und Termine (`programmsicht.ts`, `sichtbarkeit.ts`, `termine/sicht.ts`, `routes/termine/mein.ts`), die Listen des Editors (`bearbeiten.ts`, `website/seiten.ts`, `routes/redaktion/orte.ts`), die Lagerleitung (`lager/policy.ts`, `routes/lager/lager.ts`), die Wartungsausnahme (`bereichsschalter.ts`) und das Sehen fremder Profilbilder (`routes/profilbild.ts`). Diese Stellen sind Sichten oder Ausnahmen und keine Rechte des Katalogs; wer sie umstellt, ergänzt zuerst das Recht im Katalog.
