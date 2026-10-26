import { describe, expect, test } from "vitest";
import { gleicheAb, htmlZuText } from "../../src/kalender/abgleich.js";
import {
  ANTWORT_UNGUELTIG,
  KalenderFehler,
} from "../../src/kalender/fehler.js";

const MIT_ZEIT = {
  start: { dateTime: "2027-09-04T14:00:00+02:00" },
  end: { dateTime: "2027-09-04T16:00:00+02:00" },
};

function eineSeite(termin: Record<string, unknown>) {
  return gleicheAb([{ items: [{ id: "termin0000000001", ...termin }] }]);
}

describe("Abbildung einzelner Termine", () => {
  test.each<[string, Record<string, unknown>]>([
    [
      "visibility «private»",
      { summary: "Intern", visibility: "private", ...MIT_ZEIT },
    ],
    [
      "visibility «confidential»",
      { summary: "Intern", visibility: "confidential", ...MIT_ZEIT },
    ],
    ["ohne Titel", MIT_ZEIT],
    ["mit leerem Titel", { summary: "   ", ...MIT_ZEIT }],
  ])("übergeht einen Termin %s", (_, termin) => {
    expect(eineSeite(termin)).toEqual({ programme: [], absagen: [] });
  });

  test("«tentative» und fehlender Status werden zu aktiven Programmen", () => {
    const { programme } = gleicheAb([
      {
        items: [
          {
            id: "a0000000000000001",
            summary: "Vielleicht",
            status: "tentative",
            ...MIT_ZEIT,
          },
          { id: "b0000000000000001", summary: "Ohne Status", ...MIT_ZEIT },
        ],
      },
    ]);
    expect(programme.map((p) => p.titel)).toEqual([
      "Vielleicht",
      "Ohne Status",
    ]);
  });

  test("eine Absage zählt auch ohne Titel, denn sie wird vor der Titelregel geprüft", () => {
    expect(eineSeite({ status: "cancelled" })).toEqual({
      programme: [],
      absagen: ["termin0000000001"],
    });
  });

  test("nur «cancelled» gilt als Absage", () => {
    const { absagen } = eineSeite({
      summary: "Bleibt",
      status: "tentative",
      ...MIT_ZEIT,
    });
    expect(absagen).toEqual([]);
  });

  test("Titel wird getrimmt, Serie, Ort und Beschreibung kommen mit", () => {
    const { programme } = eineSeite({
      summary: "  Waldtag  ",
      location: "Waldhütte",
      description: "<b>Wurst &amp; Brot</b>",
      recurringEventId: "serie00000000001_R20270904T120000",
      ...MIT_ZEIT,
    });
    expect(programme).toEqual([
      {
        googleEventId: "termin0000000001",
        googleSerie: "serie00000000001_R20270904T120000",
        titel: "Waldtag",
        ganztaegig: false,
        beginn: new Date("2027-09-04T12:00:00Z"),
        ende: new Date("2027-09-04T14:00:00Z"),
        tagVon: null,
        tagBis: null,
        googleOrt: "Waldhütte",
        googleBeschreibung: "Wurst & Brot",
      },
    ]);
  });

  test("ein ganztägiger Termin trägt Tage, keine Zeitpunkte", () => {
    const { programme } = eineSeite({
      summary: "Sommerlager",
      start: { date: "2027-07-30" },
      end: { date: "2027-08-03" },
    });
    expect(programme[0]).toMatchObject({
      ganztaegig: true,
      tagVon: "2027-07-30",
      tagBis: "2027-08-02",
      beginn: null,
      ende: null,
    });
  });

  test.each([
    ["2027-08-01", "2027-07-31"],
    ["2027-03-01", "2027-02-28"],
    ["2028-03-01", "2028-02-29"],
    ["2027-01-01", "2026-12-31"],
  ])(
    "Googles exklusives Enddatum %s wird zum letzten Tag %s",
    (ende, tagBis) => {
      const { programme } = eineSeite({
        summary: "Lager",
        start: { date: "2026-12-30" },
        end: { date: ende },
      });
      expect(programme[0].tagBis).toBe(tagBis);
    },
  );

  test.each<[string, Record<string, unknown>]>([
    [
      "Datum und Zeitpunkt gemischt",
      {
        start: { date: "2027-09-04" },
        end: { dateTime: "2027-09-04T16:00:00+02:00" },
      },
    ],
    ["ohne Ende", { start: { dateTime: "2027-09-04T14:00:00+02:00" } }],
    ["ohne Start und Ende", {}],
  ])(
    "%s: Die Abteilung scheitert mit «Antwort von Google ungültig»",
    (_, zeiten) => {
      expect(() => eineSeite({ summary: "Kaputt", ...zeiten })).toThrow(
        new KalenderFehler(ANTWORT_UNGUELTIG),
      );
    },
  );

  test.each<[string, unknown]>([
    ["keine Liste von Seiten", [42]],
    [
      "ein Zeitpunkt ohne Offset",
      [
        {
          items: [
            {
              id: "a0000000000000001",
              summary: "Ohne Offset",
              start: { dateTime: "2027-09-04T14:00:00" },
              end: { dateTime: "2027-09-04T16:00:00" },
            },
          ],
        },
      ],
    ],
    [
      "ein ungültiges Datum",
      [
        {
          items: [
            {
              id: "a0000000000000001",
              summary: "Kein Datum",
              start: { date: "30.07.2027" },
              end: { date: "2027-08-03" },
            },
          ],
        },
      ],
    ],
  ])("ungültige Seite (%s): «Antwort von Google ungültig»", (_, seiten) => {
    expect(() => gleicheAb(seiten as unknown[])).toThrow(ANTWORT_UNGUELTIG);
  });

  test("fehlende items zählen als leere Seite", () => {
    expect(gleicheAb([{}])).toEqual({ programme: [], absagen: [] });
  });
});

describe("htmlZuText", () => {
  test.each<[string, string | null]>([
    [
      '<b>Wurst &amp; Brot</b> mitnehmen<br>Fragen an leitung@example.org<br>Anmeldung: <a href="https://example.org/anmeldung">Formular</a>',
      "Wurst & Brot mitnehmen\nFragen an leitung@example.org\nAnmeldung: Formular (https://example.org/anmeldung)",
    ],
    ["Alter < 10 und > 5", "Alter < 10 und > 5"],
    ["&lt;b&gt;kein Tag&lt;/b&gt;", "<b>kein Tag</b>"],
    ["<ul><li>Eins</li><li>Zwei</li></ul>", "Eins\nZwei"],
    [
      '<a href="https://example.org">https://example.org</a>',
      "https://example.org",
    ],
    ["<p>Absatz</p><p>Zwei</p>", "Absatz\nZwei"],
    ["<p>Eins</p><br><br><br>Zwei", "Eins\n\nZwei"],
    ["  <br>  ", null],
    ["", null],
    ["Z&#252;ri &#x1F332; &nbsp;Wald", "Züri 🌲  Wald"],
    [
      "kaputt &#99999999; &#x110000; &#0;",
      "kaputt &#99999999; &#x110000; &#0;",
    ],
  ])("%j", (html, text) => {
    expect(htmlZuText(html)).toBe(text);
  });
});
