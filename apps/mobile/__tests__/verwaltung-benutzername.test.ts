import {
  BENUTZERNAME_FEHLER,
  benutzernameGueltig,
  schlageBenutzernameVor,
} from "../src/verwaltung/benutzername";

describe("schlageBenutzernameVor", () => {
  test.each([
    ["Umlaut ä", "Käthi", "Muster", "kaethi.muster"],
    ["Umlaute ö und ü", "Jörg", "Bühler", "joerg.buehler"],
    ["Akzent é", "René", "Meier", "rene.meier"],
    ["Cedille ç", "François", "Progin", "francois.progin"],
    ["Eszett", "Gro\u00dfe", "Strau\u00df", "grosse.strauss"],
    ["Bindestrich bleibt", "Anna-Lena", "Muster", "anna-lena.muster"],
    ["Leerzeichen wird Bindestrich", "Anna", "De la Cruz", "anna.de-la-cruz"],
    ["Sonderzeichen fallen weg", "A!nna", "M@uster", "anna.muster"],
  ])("%s: %s %s wird %s", (_titel, vorname, nachname, erwartet) => {
    expect(schlageBenutzernameVor(vorname, nachname, [])).toBe(erwartet);
  });

  test("ein vergebener Name bekommt eine Zahl: 2, dann 3", () => {
    expect(schlageBenutzernameVor("Anna", "Muster", ["anna.muster"])).toBe(
      "anna.muster2",
    );
    expect(
      schlageBenutzernameVor("Anna", "Muster", ["anna.muster", "anna.muster2"]),
    ).toBe("anna.muster3");
  });

  test("höchstens 64 Zeichen, die Zahl zählt mit", () => {
    const lang = "a".repeat(80);
    const basis = schlageBenutzernameVor(lang, "b", []);
    expect(basis).toHaveLength(64);
    const mitZahl = schlageBenutzernameVor(lang, "b", [basis]);
    expect(mitZahl).toHaveLength(64);
    expect(mitZahl.endsWith("2")).toBe(true);
  });
});

describe("benutzernameGueltig", () => {
  test.each([
    ["anna.muster", true],
    ["Anna-Lena_2", true],
    ["ab", false],
    ["a".repeat(65), false],
    ["mit!zeichen", false],
    ["mit umlaut ä", false],
  ])("%s: %s", (name, erwartet) => {
    expect(benutzernameGueltig(name)).toBe(erwartet);
  });

  test("der Fehlertext nennt die Regel", () => {
    expect(BENUTZERNAME_FEHLER).toContain("3 bis 64 Zeichen");
  });
});
