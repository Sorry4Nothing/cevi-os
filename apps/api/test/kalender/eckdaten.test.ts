import { expect, test } from "vitest";
import { parseEckdaten, stufenSlug } from "../../src/kalender/eckdaten.js";

// Anonymisierte Nachbildungen der Seitenvarianten: gleiche Struktur, erfundene Orte
// Wie auf der echten Seite folgt auf jedes <br /> ein Umbruch im Quelltext
const abschnitt = (inhalt: string, titel = "Eckdaten zum nächsten Anlass") =>
  `<section><h2 class="x" id="abschnitt1">\n\t${titel}\n</h2><div class="bem-text">\n${inhalt.replaceAll("<br />", "<br />\n")}\n</div></section><section><h2>Datenplan</h2><div>Treffpunkt: nicht hier</div></section>`;
const LISTE = `<!-- st-markup --><ul class="st-markup"><li>Trinkflasche</li><li>Zvieri</li></ul><!-- st-markup -->`;

test("Standard: Treff und Schlusspunkt mit Zeitbereich, Mitnehmen als Liste", () => {
  expect(
    parseEckdaten(
      abschnitt(
        `<b>Cevi-Programm:</b><br />Samstag, 24. Oktober 2026<br /><br /><b>Treff und Schlusspunkt:</b><br />14:00-17:00 Uhr<br />Beispielhaus 1, Musterdorf<br /><br />Mitnehmen:<br />${LISTE}<br />`,
      ),
    ),
  ).toEqual({
    tag: "2026-10-24",
    treffpunkt: "14:00 Uhr\nBeispielhaus 1, Musterdorf",
    schlussOrt: "Beispielhaus 1, Musterdorf",
    schlussZeit: "17:00",
    mitnehmen: "Trinkflasche\nZvieri",
  });
});

test("Hinweis im Label und Tabelle danach: Hinweis bleibt beim Ort, Tabelle fällt weg", () => {
  const e = parseEckdaten(
    abschnitt(
      `<b>Cevi-Programm:</b><br />Samstag, 24. Oktober 2026<br /><br /><b>Treff und Schlusspunkt: Achtung! Ortswechsel!</b><br />14:00-17:00 Uhr<br />beim <u>Parkplatz</u> (anstatt Haus!)<br /><br />Mitnehmen:<br />${LISTE}<br /><br /><b>Treffpunkte im Jahr:</b><br /><table><tr><td>Sa, 17. Jan</td></tr></table>`,
    ),
  );
  expect(e?.treffpunkt).toBe(
    "14:00 Uhr\nAchtung! Ortswechsel!\nbeim Parkplatz (anstatt Haus!)",
  );
  expect(e?.schlussZeit).toBe("17:00");
});

test("Getrennte Zeilen für Treffpunkt und Schlusspunkt, «Mitbringen» ohne Doppelpunkt, Freitext am Ende", () => {
  expect(
    parseEckdaten(
      abschnitt(
        `<b>Cevi-Programm:</b><br />Samstag, 7. November 2026<br /><br /><b>Treffpunkt:</b><br />14:00 Uhr beim Haus<br /><br /><b>Schlusspunkt:</b><br />17:00 Uhr beim Haus<br /><br /><b>Mitbringen</b><br />${LISTE}<br /><br />Meldet euch bei a@example.org`,
      ),
    ),
  ).toEqual({
    tag: "2026-11-07",
    treffpunkt: "14:00 Uhr beim Haus",
    schlussOrt: "beim Haus",
    schlussZeit: "17:00",
    mitnehmen: "Trinkflasche\nZvieri",
  });
});

test("Ohne Überschrift «Eckdaten» gilt die ganze Seite; fehlende Angaben sind null", () => {
  expect(
    parseEckdaten(
      `<div><b>Cevi-Programm:</b><br />1. Dezember 2026<br /><b>Treffpunkt:</b> 9.30 Uhr Bahnhof</div>`,
    ),
  ).toEqual({
    tag: "2026-12-01",
    treffpunkt: "9.30 Uhr Bahnhof",
    schlussOrt: null,
    schlussZeit: null,
    mitnehmen: null,
  });
});

test("Ohne gültiges Datum nichts (Exodus, Anmeldeseite, 31. April)", () => {
  expect(parseEckdaten("<html><form>Passwort</form></html>")).toBeNull();
  expect(
    parseEckdaten(abschnitt(`<b>Cevi-Programm:</b><br />31. April 2026`)),
  ).toBeNull();
  expect(
    parseEckdaten(abschnitt(`<b>Cevi-Programm:</b><br />bald`)),
  ).toBeNull();
});

test("Stufenname wird klein, Umlaute ausgeschrieben, Rest entfernt", () => {
  expect(stufenSlug("Fröschli")).toBe("froeschli");
  expect(stufenSlug(" Pi-La Mi ")).toBe("pilami");
  expect(stufenSlug("../admin")).toBe("admin");
});
