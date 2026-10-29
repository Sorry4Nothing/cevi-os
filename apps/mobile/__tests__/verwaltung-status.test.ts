import { statusText, warnungen } from "../src/verwaltung/status";

// Testdaten mittags UTC, damit der Kalendertag in jeder Zeitzone derselbe bleibt
const OFFEN_BIS = "2026-11-03T12:00:00.000Z";

describe("statusText", () => {
  test("offenes Startpasswort zeigt die Frist als T.M.JJJJ", () => {
    expect(
      statusText({
        deaktiviert: false,
        mussPasswortAendern: true,
        startpasswortGueltigBis: OFFEN_BIS,
      }),
    ).toBe("Startpasswort offen bis 3.11.2026");
  });

  test("ohne offenes Startpasswort steht «angemeldet»", () => {
    expect(
      statusText({
        deaktiviert: false,
        mussPasswortAendern: false,
        startpasswortGueltigBis: null,
      }),
    ).toBe("angemeldet");
  });

  test("deaktiviert steht vorne", () => {
    expect(
      statusText({
        deaktiviert: true,
        mussPasswortAendern: false,
        startpasswortGueltigBis: null,
      }),
    ).toBe("deaktiviert, angemeldet");
  });
});

describe("warnungen", () => {
  const stufen = [
    { id: "s1", name: "Stufe A", kuerzel: "A" },
    { id: "s2", name: "Stufe B", kuerzel: "B" },
  ];
  const person = (
    admin: boolean,
    deaktiviert: boolean,
    rollen: { stufeId: string; typ: "leitung" | "stufenleitung" }[] = [],
  ) => ({
    id: Math.random().toString(),
    name: "Person",
    benutzername: "person",
    admin,
    zweiterFaktor: false,
    deaktiviert,
    mussPasswortAendern: false,
    startpasswortGueltigBis: null,
    rollen,
    elternteilVon: [],
  });

  test("weniger als zwei aktive Admins und Stufen mit weniger als zwei SL werden gemeldet", () => {
    const meldungen = warnungen({
      personen: [
        person(true, false),
        // Deaktivierte zählen nicht, weder als Admin noch als SL
        person(true, true, [{ stufeId: "s1", typ: "stufenleitung" }]),
        person(false, false, [{ stufeId: "s1", typ: "stufenleitung" }]),
      ],
      stufen,
    });
    expect(meldungen).toEqual([
      "Weniger als zwei Admins: Bitte einen zweiten Admin bestimmen.",
      "Stufe A: weniger als zwei Personen in der Stufenleitung.",
      "Stufe B: weniger als zwei Personen in der Stufenleitung.",
    ]);
  });

  test("mit zwei Admins und zwei SL pro Stufe gibt es keine Warnung", () => {
    const sl = (stufeId: string) =>
      person(false, false, [{ stufeId, typ: "stufenleitung" }]);
    expect(
      warnungen({
        personen: [
          person(true, false),
          person(true, false),
          sl("s1"),
          sl("s1"),
          sl("s2"),
          sl("s2"),
        ],
        stufen,
      }),
    ).toEqual([]);
  });

  test("eine Leitung zählt nicht als Stufenleitung", () => {
    expect(
      warnungen({
        personen: [
          person(true, false),
          person(true, false),
          person(false, false, [{ stufeId: "s1", typ: "leitung" }]),
          person(false, false, [{ stufeId: "s1", typ: "leitung" }]),
        ],
        stufen: [stufen[0]],
      }),
    ).toEqual(["Stufe A: weniger als zwei Personen in der Stufenleitung."]);
  });
});
