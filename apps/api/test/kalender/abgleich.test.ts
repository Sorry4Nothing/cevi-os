import { describe, expect, test } from "vitest";
import {
  gleicheAb,
  htmlZuText,
  liegtAmSamstag,
} from "../../src/kalender/abgleich.js";
import {
  ANTWORT_UNGUELTIG,
  KalenderFehler,
} from "../../src/kalender/fehler.js";

const JETZT = new Date("2027-09-01T00:00:00Z");
const MIT_ZEIT = ["DTSTART:20270904T120000Z", "DTEND:20270904T140000Z"];

const vevent = (uid: string, zeilen: string[]) =>
  ["BEGIN:VEVENT", `UID:${uid}`, ...zeilen, "END:VEVENT"].join("\r\n");
const kalender = (...termine: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...termine, "END:VCALENDAR", ""].join(
    "\r\n",
  );
const eineSeite = (zeilen: string[]) =>
  gleicheAb(kalender(vevent("termin0000000001", zeilen)), JETZT);

describe("Abbildung einzelner Termine", () => {
  test.each<[string, string[]]>([
    ["class «private»", ["SUMMARY:Intern", "CLASS:PRIVATE", ...MIT_ZEIT]],
    [
      "class «confidential»",
      ["SUMMARY:Intern", "CLASS:CONFIDENTIAL", ...MIT_ZEIT],
    ],
    ["ohne Titel", MIT_ZEIT],
    ["mit leerem Titel", ["SUMMARY:   ", ...MIT_ZEIT]],
  ])("übergeht einen Termin %s", (_, zeilen) => {
    expect(eineSeite(zeilen)).toEqual({ programme: [], absagen: [] });
  });

  test("«tentative» und fehlender Status werden zu aktiven Programmen", () => {
    const { programme } = gleicheAb(
      kalender(
        vevent("a0000000000000001", [
          "SUMMARY:Vielleicht",
          "STATUS:TENTATIVE",
          ...MIT_ZEIT,
        ]),
        vevent("b0000000000000001", ["SUMMARY:Ohne Status", ...MIT_ZEIT]),
      ),
      JETZT,
    );
    expect(programme.map((p) => p.titel)).toEqual([
      "Vielleicht",
      "Ohne Status",
    ]);
  });

  test("eine Absage zählt auch ohne Titel, denn sie wird vor der Titelregel geprüft", () => {
    expect(eineSeite(["STATUS:CANCELLED", ...MIT_ZEIT])).toEqual({
      programme: [],
      absagen: ["termin0000000001"],
    });
  });

  test("nur «CANCELLED» gilt als Absage", () => {
    const { absagen } = eineSeite([
      "SUMMARY:Bleibt",
      "STATUS:TENTATIVE",
      ...MIT_ZEIT,
    ]);
    expect(absagen).toEqual([]);
  });

  test("Titel wird getrimmt, Ort und Beschreibung kommen mit, ein Einzeltermin hat keine Serie", () => {
    const { programme } = eineSeite([
      "SUMMARY:  Waldtag  ",
      "LOCATION:Waldhütte",
      "DESCRIPTION:Wurst & Brot",
      ...MIT_ZEIT,
    ]);
    expect(programme).toEqual([
      {
        googleEventId: "termin0000000001",
        googleSerie: null,
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
    const { programme } = eineSeite([
      "SUMMARY:Sommerlager",
      "DTSTART;VALUE=DATE:20270930",
      "DTEND;VALUE=DATE:20271004",
    ]);
    expect(programme[0]).toMatchObject({
      ganztaegig: true,
      tagVon: "2027-09-30",
      tagBis: "2027-10-03",
      beginn: null,
      ende: null,
    });
  });

  test.each([
    ["20270905", "2027-09-04"],
    ["20271001", "2027-09-30"],
    ["20271101", "2027-10-31"],
    ["20280101", "2027-12-31"],
  ])("das exklusive Enddatum %s wird zum letzten Tag %s", (ende, tagBis) => {
    const { programme } = eineSeite([
      "SUMMARY:Lager",
      "DTSTART;VALUE=DATE:20270904",
      `DTEND;VALUE=DATE:${ende}`,
    ]);
    expect(programme[0].tagBis).toBe(tagBis);
  });

  test("Termine ausserhalb des Fensters (gestern bis rund 400 Tage voraus) fallen weg", () => {
    // Sonntag: Der Samstag davor ist «gestern» und läuft noch
    const sonntag = new Date("2027-09-05T00:00:00Z");
    const { programme } = gleicheAb(
      kalender(
        vevent("alt0000000000001", [
          "SUMMARY:Alt",
          "DTSTART:20270731T120000Z",
          "DTEND:20270731T140000Z",
        ]),
        vevent("fern000000000001", [
          "SUMMARY:Fern",
          "DTSTART:20290106T120000Z",
          "DTEND:20290106T140000Z",
        ]),
        vevent("laeuft0000000001", [
          "SUMMARY:Läuft noch",
          "DTSTART:20270904T120000Z",
          "DTEND:20270905T120000Z",
        ]),
      ),
      sonntag,
    );
    expect(programme.map((p) => p.titel)).toEqual(["Läuft noch"]);
  });

  test("nur Termine, die auf einen Samstag fallen, werden übernommen", () => {
    const tag = (uid: string, titel: string, von: string, bis: string) =>
      vevent(uid, [
        `SUMMARY:${titel}`,
        `DTSTART:${von}T120000Z`,
        `DTEND:${bis}T140000Z`,
      ]);
    const { programme } = gleicheAb(
      kalender(
        tag("freitag000000001", "Freitag", "20270903", "20270903"),
        tag("samstag00000001", "Samstag", "20270904", "20270904"),
        tag("sonntag00000001", "Sonntag", "20270905", "20270905"),
        tag("lager0000000001", "Lager", "20270903", "20270905"),
      ),
      JETZT,
    );
    expect(programme.map((p) => p.titel)).toEqual(["Samstag", "Lager"]);
  });

  test.each<[string, string[]]>([
    [
      "Datum und Zeitpunkt gemischt",
      [
        "SUMMARY:Kaputt",
        "DTSTART;VALUE=DATE:20270904",
        "DTEND:20270904T140000Z",
      ],
    ],
    [
      "ein Zeitpunkt ohne Zeitzone",
      ["SUMMARY:Kaputt", "DTSTART:20270904T120000", "DTEND:20270904T140000"],
    ],
  ])(
    "%s: Die Abteilung scheitert mit «Antwort des Kalenders ungültig»",
    (_, zeilen) => {
      expect(() => eineSeite(zeilen)).toThrow(
        new KalenderFehler(ANTWORT_UNGUELTIG),
      );
    },
  );

  test.each<[string, string]>([
    ["kein Kalender", "hallo"],
    ["kein VCALENDAR", "BEGIN:VEVENT\r\nEND:VEVENT\r\n"],
    ["ein leerer Text", ""],
  ])("ungültiger Text (%s): «Antwort des Kalenders ungültig»", (_, text) => {
    expect(() => gleicheAb(text, JETZT)).toThrow(
      new KalenderFehler(ANTWORT_UNGUELTIG),
    );
  });

  test("ein Kalender ohne Termine ist leer", () => {
    expect(gleicheAb(kalender(), JETZT)).toEqual({
      programme: [],
      absagen: [],
    });
  });
});

describe("Serien", () => {
  const serie = (zeilen: string[], ausnahmen: string[] = []) =>
    gleicheAb(
      kalender(
        vevent("serie00000000001", [
          "SUMMARY:Gruppenstunde",
          "DTSTART:20270904T120000Z",
          "DTEND:20270904T140000Z",
          ...zeilen,
        ]),
        ...ausnahmen,
      ),
      JETZT,
    );

  test("jede Instanz ist ein Programm mit eigener ID aus Serie und ursprünglichem Beginn", () => {
    const { programme } = serie(["RRULE:FREQ=WEEKLY;COUNT=3"]);
    expect(
      programme.map((p) => [p.googleEventId, p.googleSerie, p.beginn]),
    ).toEqual([
      [
        "serie00000000001_20270904T120000Z",
        "serie00000000001",
        new Date("2027-09-04T12:00:00Z"),
      ],
      [
        "serie00000000001_20270911T120000Z",
        "serie00000000001",
        new Date("2027-09-11T12:00:00Z"),
      ],
      [
        "serie00000000001_20270918T120000Z",
        "serie00000000001",
        new Date("2027-09-18T12:00:00Z"),
      ],
    ]);
  });

  test("EXDATE nimmt eine Instanz heraus", () => {
    const { programme } = serie([
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "EXDATE:20270911T120000Z",
    ]);
    expect(programme.map((p) => p.beginn?.toISOString())).toEqual([
      "2027-09-04T12:00:00.000Z",
      "2027-09-18T12:00:00.000Z",
    ]);
  });

  test("eine verschobene Instanz behält ihre ID und trägt die neue Zeit", () => {
    const { programme } = serie(
      ["RRULE:FREQ=WEEKLY;COUNT=2"],
      [
        vevent("serie00000000001", [
          "RECURRENCE-ID:20270911T120000Z",
          "SUMMARY:Gruppenstunde",
          "DTSTART:20270911T130000Z",
          "DTEND:20270911T150000Z",
        ]),
      ],
    );
    expect(programme[1]).toMatchObject({
      googleEventId: "serie00000000001_20270911T120000Z",
      beginn: new Date("2027-09-11T13:00:00Z"),
    });
  });

  test("eine abgesagte Instanz kommt als Absage mit der Instanz-ID", () => {
    const { programme, absagen } = serie(
      ["RRULE:FREQ=WEEKLY;COUNT=2"],
      [
        vevent("serie00000000001", [
          "RECURRENCE-ID:20270911T120000Z",
          "STATUS:CANCELLED",
          "SUMMARY:Gruppenstunde",
          "DTSTART:20270911T120000Z",
          "DTEND:20270911T140000Z",
        ]),
      ],
    );
    expect(absagen).toEqual(["serie00000000001_20270911T120000Z"]);
    expect(programme).toHaveLength(1);
  });

  test("eine endlose Serie bricht am Fensterende ab", () => {
    // Täglich wiederholt, aber nur die Samstage zählen: rund 57 in 400 Tagen
    const { programme } = serie(["RRULE:FREQ=DAILY"]);
    expect(programme.length).toBeGreaterThan(50);
    expect(programme.length).toBeLessThan(65);
  });
});

describe("liegtAmSamstag", () => {
  const tage = (von: string, bis: string) =>
    liegtAmSamstag(
      true,
      new Date(`${von}T00:00:00Z`),
      new Date(`${bis}T00:00:00Z`),
    );

  test.each<[string, string, string, boolean]>([
    ["Freitag", "2027-09-03", "2027-09-04", false],
    ["Samstag", "2027-09-04", "2027-09-05", true],
    ["Sonntag", "2027-09-05", "2027-09-06", false],
    ["Freitag bis Montag", "2027-09-03", "2027-09-07", true],
    ["Montag bis Freitag", "2027-09-06", "2027-09-11", false],
    ["Sonntag bis Samstag (eine Woche)", "2027-09-05", "2027-09-12", true],
    ["drei Wochen", "2027-09-06", "2027-09-27", true],
  ])("ganztägig: %s", (_, von, bis, erwartet) => {
    expect(tage(von, bis)).toBe(erwartet);
  });

  // Schweizer Zeit: im September UTC+2, im Dezember UTC+1
  test.each<[string, string, string, boolean]>([
    [
      "Sommerzeit: Freitag 00:00",
      "2027-09-02T22:00:00Z",
      "2027-09-02T23:00:00Z",
      false,
    ],
    [
      "Sommerzeit: Samstag 00:00",
      "2027-09-03T22:00:00Z",
      "2027-09-03T23:00:00Z",
      true,
    ],
    [
      "Sommerzeit: endet um Mitternacht auf den Samstag",
      "2027-09-03T20:00:00Z",
      "2027-09-03T22:00:00Z",
      false,
    ],
    [
      "Sommerzeit: endet um Mitternacht auf den Sonntag",
      "2027-09-04T12:00:00Z",
      "2027-09-04T22:00:00Z",
      true,
    ],
    [
      "Sommerzeit: beginnt um Mitternacht auf den Sonntag",
      "2027-09-04T22:00:00Z",
      "2027-09-05T10:00:00Z",
      false,
    ],
    [
      "Winterzeit: Samstag 00:00",
      "2027-12-03T23:00:00Z",
      "2027-12-04T01:00:00Z",
      true,
    ],
    [
      "Winterzeit: endet um Mitternacht auf den Samstag",
      "2027-12-03T21:00:00Z",
      "2027-12-03T23:00:00Z",
      false,
    ],
    [
      "Freitag Abend bis Sonntag Morgen",
      "2027-09-03T18:00:00Z",
      "2027-09-05T06:00:00Z",
      true,
    ],
    ["zwei Wochen", "2027-09-06T10:00:00Z", "2027-09-20T10:00:00Z", true],
  ])("mit Zeit: %s", (_, von, bis, erwartet) => {
    expect(liegtAmSamstag(false, new Date(von), new Date(bis))).toBe(erwartet);
  });

  test("ein Termin ohne Dauer zählt am Tag seines Beginns", () => {
    const samstag = new Date("2027-09-04T10:00:00Z");
    expect(liegtAmSamstag(false, samstag, samstag)).toBe(true);
    const freitag = new Date("2027-09-03T10:00:00Z");
    expect(liegtAmSamstag(false, freitag, freitag)).toBe(false);
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
