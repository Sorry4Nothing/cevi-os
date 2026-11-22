import { describe, expect, test } from "vitest";
import {
  parseSchnelleingabe,
  parseZeile,
  schnelleingabeEingabe,
  zeilenVon,
  type Kontext,
} from "../../src/lager/schnelleingabe.js";

// Parser ohne Datenbank (#375): «heute» und das Lager kommen als Parameter, jeder Fall ist festgelegt.
// Referenz: Sonntag 22.11.2026; das Lager beginnt am 10.7.2027.
const HEUTE = "2026-11-22";
const kontext = (ueberschreibe: Partial<Kontext> = {}): Kontext => ({
  heute: HEUTE,
  lagerVon: "2027-07-10",
  personen: [],
  ressorts: [],
  ...ueberschreibe,
});
const frist = (text: string, k: Partial<Kontext> = {}) =>
  parseZeile(text, kontext(k)).frist?.datum ?? null;
const titel = (text: string, k: Partial<Kontext> = {}) =>
  parseZeile(text, kontext(k)).titel;

describe("Datum", () => {
  // Wochentage von HEUTE (So 22.11.): Mo 23., Di 24., Mi 25., Do 26., Fr 27., Sa 28.
  test.each([
    ["Offerte heute", "2026-11-22"],
    ["Offerte bis heute", "2026-11-22"],
    ["Offerte morgen", "2026-11-23"],
    ["Offerte bis morgen", "2026-11-23"],
    ["Offerte übermorgen", "2026-11-24"],
    ["Offerte uebermorgen", "2026-11-24"],
    ["Offerte bis übermorgen", "2026-11-24"],
    ["Offerte MORGEN", "2026-11-23"],
    ["Offerte in 3 Tagen", "2026-11-25"],
    ["Offerte in 1 Tag", "2026-11-23"],
    ["Offerte in 2 Wochen", "2026-12-06"],
    ["Offerte bis in 1 Woche", "2026-11-29"],
    ["Offerte in 1 Monat", "2026-12-22"],
    ["Offerte in 3 Monaten", "2027-02-22"],
    ["Offerte Ende Woche", "2026-11-27"],
    ["Offerte bis Ende dieser Woche", "2026-11-27"],
    ["Offerte nächste Woche", "2026-11-27"],
    ["Offerte Ende Monat", "2026-11-30"],
    ["Offerte bis Ende des Monats", "2026-11-30"],
    ["Offerte Montag", "2026-11-23"],
    ["Offerte am Mittwoch", "2026-11-25"],
    ["Offerte bis Freitag", "2026-11-27"],
    ["Offerte bis nächsten Donnerstag", "2026-11-26"],
    ["Offerte kommenden Samstag", "2026-11-28"],
    ["Offerte Sonntag", "2026-11-29"],
  ])("%s", (text, erwartet) => {
    expect(frist(text)).toBe(erwartet);
  });

  test.each([
    ["Offerte bis 15.3.", "2027-03-15"],
    ["Offerte 15.3.", "2027-03-15"],
    ["Offerte bis 5.1.", "2027-01-05"],
    ["Offerte bis 05.01.", "2027-01-05"],
    ["Offerte bis 22.11.", "2026-11-22"],
    ["Offerte bis 21.11.", "2027-11-21"],
    ["Offerte bis 15.3.27", "2027-03-15"],
    ["Offerte bis 15.3.2028", "2028-03-15"],
    ["Offerte bis 1.12.2026", "2026-12-01"],
    ["Offerte bis 15.3.2020", "2020-03-15"],
    ["Offerte bis 2027-03-15", "2027-03-15"],
    ["Offerte 2027-03-15", "2027-03-15"],
  ])("Datum %s", (text, erwartet) => {
    expect(frist(text)).toBe(erwartet);
  });

  test.each([
    ["Anfang Mai", "2027-05-01"],
    ["Mitte Mai", "2027-05-15"],
    ["Ende Mai", "2027-05-31"],
    ["bis Anfang Dezember", "2026-12-01"],
    ["Mitte Dezember", "2026-12-15"],
    ["Ende Dezember", "2026-12-31"],
    // Der laufende Monat: Anfang ist vorbei und gilt im nächsten Jahr, Ende steht noch bevor
    ["Anfang November", "2027-11-01"],
    ["Mitte November", "2027-11-15"],
    ["Ende November", "2026-11-30"],
    ["Ende Februar", "2027-02-28"],
    ["Mitte März", "2027-03-15"],
    ["Mitte Maerz", "2027-03-15"],
    ["Ende Oktober", "2027-10-31"],
  ])("Anfang, Mitte, Ende: %s", (monat, erwartet) => {
    expect(frist(`Offerte ${monat}`)).toBe(erwartet);
  });

  test.each([
    ["Offerte 2 Wochen vor Lager", "2027-06-26"],
    ["Offerte bis 2 Wochen vor Lager", "2027-06-26"],
    ["Offerte 1 Woche vor dem Lager", "2027-07-03"],
    ["Offerte 3 Tage vor Lager", "2027-07-07"],
    ["Offerte 10 Tage vor Lagerbeginn", "2027-06-30"],
    ["Offerte vor Lager", "2027-07-09"],
    ["Offerte bis vor dem Lager", "2027-07-09"],
  ])("relativ zum Lager: %s", (text, erwartet) => {
    expect(frist(text)).toBe(erwartet);
  });

  test("ohne Lagerbeginn bleibt «vor Lager» im Titel, ohne Frist", () => {
    const v = parseZeile(
      "Offerte 2 Wochen vor Lager",
      kontext({ lagerVon: null }),
    );
    expect(v.frist).toBeNull();
    expect(v.titel).toBe("Offerte 2 Wochen vor Lager");
  });

  describe("Randfälle", () => {
    test("Jahreswechsel: ein Datum ohne Jahr, das heuer vorbei ist, gilt im nächsten Jahr", () => {
      expect(frist("Offerte 5.1.", { heute: "2026-12-30" })).toBe("2027-01-05");
      expect(frist("Offerte Ende Woche", { heute: "2026-12-30" })).toBe(
        "2027-01-01",
      );
      expect(frist("Offerte morgen", { heute: "2026-12-31" })).toBe(
        "2027-01-01",
      );
      expect(frist("Offerte in 2 Monaten", { heute: "2026-12-31" })).toBe(
        "2027-02-28",
      );
      expect(frist("Offerte Mitte Januar", { heute: "2026-12-30" })).toBe(
        "2027-01-15",
      );
      expect(
        frist("Offerte 2 Wochen vor Lager", { lagerVon: "2027-01-05" }),
      ).toBe("2026-12-22");
    });

    test("Schaltjahr: der 29.2. wartet auf das nächste Schaltjahr", () => {
      expect(frist("Offerte 29.2.", { heute: "2027-03-01" })).toBe(
        "2028-02-29",
      );
      expect(frist("Offerte 29.2.", { heute: "2028-02-28" })).toBe(
        "2028-02-29",
      );
      expect(frist("Offerte 29.2.", { heute: "2028-03-01" })).toBe(
        "2032-02-29",
      );
      expect(frist("Offerte bis 29.2.2028")).toBe("2028-02-29");
      expect(frist("Offerte morgen", { heute: "2028-02-28" })).toBe(
        "2028-02-29",
      );
      expect(frist("Offerte übermorgen", { heute: "2028-02-28" })).toBe(
        "2028-03-01",
      );
      expect(frist("Offerte morgen", { heute: "2027-02-28" })).toBe(
        "2027-03-01",
      );
      expect(frist("Offerte Ende Februar", { heute: "2027-12-01" })).toBe(
        "2028-02-29",
      );
    });

    test("Monatsende: kein Überlauf in den Folgemonat", () => {
      expect(frist("Offerte in 1 Monat", { heute: "2027-01-31" })).toBe(
        "2027-02-28",
      );
      expect(frist("Offerte in 1 Monat", { heute: "2028-01-31" })).toBe(
        "2028-02-29",
      );
      expect(frist("Offerte in 1 Monat", { heute: "2026-08-31" })).toBe(
        "2026-09-30",
      );
      expect(frist("Offerte Ende Monat", { heute: "2027-02-10" })).toBe(
        "2027-02-28",
      );
      expect(frist("Offerte Ende Monat", { heute: "2028-02-10" })).toBe(
        "2028-02-29",
      );
      expect(frist("Offerte Ende Monat", { heute: "2026-12-10" })).toBe(
        "2026-12-31",
      );
      expect(frist("Offerte 31.1.", { heute: "2027-01-31" })).toBe(
        "2027-01-31",
      );
    });

    test("Wochentage: heute selbst gilt erst in sieben Tagen; Ende Woche ist der Freitag", () => {
      // Montag 23.11.
      expect(frist("Offerte Montag", { heute: "2026-11-23" })).toBe(
        "2026-11-30",
      );
      expect(frist("Offerte Dienstag", { heute: "2026-11-23" })).toBe(
        "2026-11-24",
      );
      expect(frist("Offerte Ende Woche", { heute: "2026-11-23" })).toBe(
        "2026-11-27",
      );
      expect(frist("Offerte nächste Woche", { heute: "2026-11-23" })).toBe(
        "2026-12-04",
      );
      // Freitag 27.11.: Ende Woche ist heute
      expect(frist("Offerte Ende Woche", { heute: "2026-11-27" })).toBe(
        "2026-11-27",
      );
      expect(frist("Offerte Freitag", { heute: "2026-11-27" })).toBe(
        "2026-12-04",
      );
      // Samstag 28.11.: die Woche ist vorbei
      expect(frist("Offerte Ende Woche", { heute: "2026-11-28" })).toBe(
        "2026-12-04",
      );
      expect(frist("Offerte nächste Woche", { heute: "2026-11-28" })).toBe(
        "2026-12-04",
      );
      // Sonntag 22.11.: die nächste Woche beginnt morgen
      expect(frist("Offerte nächste Woche")).toBe("2026-11-27");
      expect(frist("Offerte Ende Woche")).toBe("2026-11-27");
    });

    test("ungültige Daten: keine Frist, Hinweis, der Text bleibt im Titel", () => {
      for (const text of [
        "Offerte bis 31.2.",
        "Offerte bis 30.2.",
        "Offerte bis 31.4.",
        "Offerte bis 29.2.2027",
        "Offerte bis 32.1.",
        "Offerte bis 15.13.",
        "Offerte bis 0.1.",
        "Offerte bis 2027-02-30",
      ]) {
        const v = parseZeile(text, kontext());
        expect(v.frist, text).toBeNull();
        expect(v.hinweise, text).toContain("DATUM_UNGUELTIG");
        expect(v.titel, text).toBe(text);
      }
    });

    test("keine Frist ohne Datumsform; Teilwörter zählen nicht", () => {
      for (const text of [
        "Offerte einholen",
        "Morgenstern anrufen",
        "Heuteam besprechen",
        "Montagsmaler vorbereiten",
        "Version 1.5 testen",
        "5 Wochen Lager",
        "Mai",
        "Anfang Mai2",
        "Sonntagsbrunch planen",
      ]) {
        const v = parseZeile(text, kontext());
        expect(v.frist, text).toBeNull();
        expect(v.titel, text).toBe(text);
        expect(v.hinweise, text).toEqual([]);
      }
    });

    test("nur die erste Frist; eine zweite bleibt im Titel", () => {
      const v = parseZeile(
        "Offerte bis 15.3. und morgen nachfragen",
        kontext(),
      );
      expect(v.frist).toEqual({ datum: "2027-03-15", text: "bis 15.3." });
      expect(v.titel).toBe("Offerte und morgen nachfragen");
    });
  });

  test("der erkannte Text der Frist kommt zurück", () => {
    expect(parseZeile("Offerte bis morgen", kontext()).frist).toEqual({
      datum: "2026-11-23",
      text: "bis morgen",
    });
    expect(parseZeile("Zelt am Montag aufbauen", kontext()).frist).toEqual({
      datum: "2026-11-23",
      text: "am Montag",
    });
  });
});

describe("Titel", () => {
  test("Frist, Person und Ressort fallen aus dem Titel, der Rest bleibt", () => {
    const k = kontext({
      personen: [{ id: "p1", schluessel: ["Jonas"] }],
      ressorts: [{ id: "r1", schluessel: ["Logistik"] }],
    });
    for (const text of [
      "Offerte @Jonas bis 15.3. #Logistik",
      "@Jonas Offerte bis 15.3. #Logistik",
      "#Logistik Offerte @Jonas bis 15.3.",
      "Offerte bis 15.3. @Jonas #Logistik",
      "  Offerte   @Jonas   bis  15.3.   #Logistik  ",
    ]) {
      expect(titel(text, k), text).toBe("Offerte");
    }
  });

  test("Satzzeichen hinter Person, Ressort und Frist stören nicht", () => {
    const k = kontext({
      personen: [{ id: "p1", schluessel: ["Jonas"] }],
      ressorts: [{ id: "r1", schluessel: ["Logistik"] }],
    });
    const v = parseZeile("Offerte einholen @Jonas, #Logistik, bis morgen.", k);
    expect(v.person?.status).toBe("gefunden");
    expect(v.ressort?.status).toBe("gefunden");
    expect(v.frist?.datum).toBe("2026-11-23");
    expect(v.titel).toBe("Offerte einholen , , .");
  });

  test("leerer Titel und zu langer Titel", () => {
    const k = kontext({ personen: [{ id: "p1", schluessel: ["Jonas"] }] });
    expect(parseZeile("@Jonas bis morgen", k).hinweise).toEqual([
      "TITEL_FEHLT",
    ]);
    expect(parseZeile("a".repeat(201), k).hinweise).toEqual(["TITEL_ZU_LANG"]);
    expect(parseZeile("a".repeat(200), k).hinweise).toEqual([]);
  });

  test("Umlaute, Grossbuchstaben und Sonderzeichen bleiben erhalten", () => {
    expect(titel("Küche: Öl & Essig <b>fett</b> «test» bestellen")).toBe(
      "Küche: Öl & Essig <b>fett</b> «test» bestellen",
    );
  });
});

describe("Person (@)", () => {
  const personen = [
    { id: "jonas-b", schluessel: ["Pax", "Jonas Beispiel", "Jonas"] },
    { id: "jonas-m", schluessel: ["Jonas Muster", "Jonas"] },
    { id: "anna", schluessel: ["Anna Beispiel", "Anna"] },
    { id: "anna-lena", schluessel: ["Anna Lena Probe", "Anna"] },
    { id: "lea", schluessel: ["Lea Test", "Lea"] },
    { id: "lea-doppel", schluessel: ["Lea Testa", "Lea"] },
    { id: "max", schluessel: ["Max Mustermann", "Max"] },
  ];
  const person = (text: string, k: Partial<Kontext> = {}) =>
    parseZeile(text, kontext({ personen, ...k }));

  test("eindeutig über Cevi-Name, vollen Namen und Vornamen", () => {
    for (const [text, id] of [
      ["Offerte @Pax", "jonas-b"],
      ["Offerte @pax", "jonas-b"],
      ["Offerte @PAX", "jonas-b"],
      ["Offerte @Max", "max"],
      ["Offerte @Max Mustermann", "max"],
      ["Offerte @max mustermann", "max"],
      ["Offerte @Max  Mustermann", "max"],
      ["Offerte @Jonas Muster", "jonas-m"],
      ["Offerte @Jonas Beispiel", "jonas-b"],
      ["Offerte @Anna Lena Probe", "anna-lena"],
      ["Offerte @Anna Beispiel", "anna"],
    ] as const) {
      const v = person(text);
      expect(v.person, text).toEqual({
        status: "gefunden",
        text: expect.any(String),
        ids: [id],
      });
      expect(v.titel, text).toBe("Offerte");
    }
  });

  test("mehrdeutig: alle Kandidaten, nie geraten", () => {
    for (const [text, ids] of [
      ["Offerte @Jonas", ["jonas-b", "jonas-m"]],
      ["Offerte @jonas bis morgen", ["jonas-b", "jonas-m"]],
      ["Offerte @Anna", ["anna", "anna-lena"]],
      ["Offerte @Lea", ["lea", "lea-doppel"]],
    ] as const) {
      const v = person(text);
      expect(v.person?.status, text).toBe("mehrdeutig");
      expect(v.person?.ids, text).toEqual(ids);
      expect(v.titel.startsWith("Offerte"), text).toBe(true);
    }
  });

  test("der längere Name geht vor: «@Jonas Beispiel» ist nicht «@Jonas» plus Text", () => {
    const v = person("Offerte @Jonas Beispiel bis morgen");
    expect(v.person).toMatchObject({ status: "gefunden", ids: ["jonas-b"] });
    expect(v.titel).toBe("Offerte");
  });

  test("ein Wort nach dem Namen gehört zum Titel, solange es nicht zum Namen passt", () => {
    const v = person("Offerte @Max einholen");
    expect(v.person).toMatchObject({ status: "gefunden", ids: ["max"] });
    expect(v.titel).toBe("Offerte einholen");
  });

  test("ein Name ist kein Teilwort: «@Maxi» ist nicht «@Max»", () => {
    const v = person("Offerte @Maxi");
    expect(v.person).toEqual({ status: "unbekannt", text: "Maxi", ids: [] });
    expect(v.titel).toBe("Offerte @Maxi");
  });

  test("unbekannt: der Text bleibt im Titel, die Person bleibt offen", () => {
    const v = person("Offerte @Unbekannt bis morgen");
    expect(v.person).toEqual({
      status: "unbekannt",
      text: "Unbekannt",
      ids: [],
    });
    expect(v.titel).toBe("Offerte @Unbekannt");
    expect(v.frist?.datum).toBe("2026-11-23");
  });

  test("ohne Mitglieder ist jeder Name unbekannt", () => {
    const v = parseZeile("Offerte @Jonas", kontext());
    expect(v.person?.status).toBe("unbekannt");
  });

  test("kein @ gibt keine Person; E-Mail-Adressen und ein einzelnes @ zählen nicht", () => {
    for (const text of [
      "Offerte einholen",
      "Mail an jonas@example.org schicken",
      "Offerte @ Jonas",
      "Offerte @",
    ]) {
      expect(person(text).person, text).toBeNull();
    }
    expect(person("Mail an jonas@example.org schicken").titel).toBe(
      "Mail an jonas@example.org schicken",
    );
  });

  test("nur die erste Erwähnung zählt", () => {
    const v = person("Offerte @Max @Lea");
    expect(v.person).toMatchObject({ status: "gefunden", ids: ["max"] });
    expect(v.titel).toBe("Offerte @Lea");
  });

  test("dieselbe Person über zwei Schlüssel ist kein Mehrdeutig", () => {
    const v = parseZeile(
      "Offerte @Pax",
      kontext({ personen: [{ id: "x", schluessel: ["Pax", "pax"] }] }),
    );
    expect(v.person).toMatchObject({ status: "gefunden", ids: ["x"] });
  });

  test("Namen mit Umlauten und Bindestrich", () => {
    const k = kontext({
      personen: [
        { id: "m", schluessel: ["Jörg Müller-Frei", "Jörg"] },
        { id: "l", schluessel: ["Zoë", "Zoë Probe"] },
      ],
    });
    expect(parseZeile("Offerte @Jörg", k).person).toMatchObject({ ids: ["m"] });
    expect(parseZeile("Offerte @jörg müller-frei", k).person).toMatchObject({
      ids: ["m"],
    });
    expect(parseZeile("Offerte @Zoë", k).person).toMatchObject({ ids: ["l"] });
  });
});

describe("Ressort (#)", () => {
  const ressorts = [
    { id: "log", schluessel: ["LOG", "Logistik"] },
    { id: "prog", schluessel: ["PRO", "Programm"] },
    { id: "prog-leit", schluessel: ["PL", "Programm Leitung"] },
    { id: "kueche", schluessel: ["KÜ", "Küche"] },
    { id: "a1", schluessel: ["Essen", "Essen A"] },
    { id: "a2", schluessel: ["Essen", "Essen B"] },
  ];
  const ressort = (text: string) => parseZeile(text, kontext({ ressorts }));

  test("eindeutig über Name oder Kürzel, ohne Gross- und Kleinschreibung", () => {
    for (const [text, id] of [
      ["Offerte #Logistik", "log"],
      ["Offerte #logistik", "log"],
      ["Offerte #LOG", "log"],
      ["Offerte #Küche", "kueche"],
      ["Offerte #küche", "kueche"],
      ["Offerte #KÜ", "kueche"],
      ["Offerte #Programm", "prog"],
      ["Offerte #Programm Leitung", "prog-leit"],
      ["Offerte #pl", "prog-leit"],
    ] as const) {
      const v = ressort(text);
      expect(v.ressort, text).toMatchObject({ status: "gefunden", ids: [id] });
      expect(v.titel, text).toBe("Offerte");
    }
  });

  test("mehrdeutig: gleiches Kürzel oder gleicher Name", () => {
    const v = ressort("Offerte #Essen");
    expect(v.ressort).toMatchObject({
      status: "mehrdeutig",
      ids: ["a1", "a2"],
    });
    expect(v.titel).toBe("Offerte");
    expect(ressort("Offerte #Essen B").ressort).toMatchObject({
      status: "gefunden",
      ids: ["a2"],
    });
  });

  test("unbekannt: das Wort bleibt im Titel (es kann ein Stichwort sein)", () => {
    const v = ressort("Offerte #Wichtig");
    expect(v.ressort).toEqual({
      status: "unbekannt",
      text: "Wichtig",
      ids: [],
    });
    expect(v.titel).toBe("Offerte #Wichtig");
  });

  test("nur die erste Erwähnung zählt", () => {
    const v = ressort("Offerte #Logistik #Küche");
    expect(v.ressort).toMatchObject({ ids: ["log"] });
    expect(v.titel).toBe("Offerte #Küche");
  });

  test("Zahlen, Anker und Teilwörter: «Zelt#3» und «#Logistiker» sind kein Ressort", () => {
    expect(ressort("Zelt#3 aufstellen").ressort).toBeNull();
    expect(ressort("Zelt#3 aufstellen").titel).toBe("Zelt#3 aufstellen");
    expect(ressort("Offerte #Logistiker").ressort?.status).toBe("unbekannt");
  });
});

describe("Zeilen", () => {
  test("eine Zeile je Aufgabe; leere Zeilen, Aufzählungszeichen und Nummern fallen weg", () => {
    expect(
      zeilenVon(
        "Offerte\r\n\n  - Zelt bestellen \n• Essen planen\n1. Bus mieten\n2) Karten\n* Kasse\n3 Zelte bestellen",
      ),
    ).toEqual([
      "Offerte",
      "Zelt bestellen",
      "Essen planen",
      "Bus mieten",
      "Karten",
      "Kasse",
      "3 Zelte bestellen",
    ]);
  });

  test("mehrere Zeilen geben mehrere Vorschläge, jede mit eigener Person, Frist und Ressort", () => {
    const k = kontext({
      personen: [{ id: "p", schluessel: ["Pax"] }],
      ressorts: [{ id: "r", schluessel: ["Logistik"] }],
    });
    const v = parseSchnelleingabe(
      "Offerte @Pax bis 15.3.\nZelt bestellen #Logistik morgen\nKarte",
      k,
    );
    expect(v.map((x) => x.titel)).toEqual([
      "Offerte",
      "Zelt bestellen",
      "Karte",
    ]);
    expect(v.map((x) => x.person?.ids ?? null)).toEqual([["p"], null, null]);
    expect(v.map((x) => x.ressort?.ids ?? null)).toEqual([null, ["r"], null]);
    expect(v.map((x) => x.frist?.datum ?? null)).toEqual([
      "2027-03-15",
      "2026-11-23",
      null,
    ]);
    expect(v[0]!.zeile).toBe("Offerte @Pax bis 15.3.");
  });

  test("das Beispiel aus dem Issue", () => {
    const v = parseZeile(
      "Offerte @Jonas bis 15.3. #Logistik",
      kontext({
        personen: [{ id: "j", schluessel: ["Jonas Beispiel", "Jonas"] }],
        ressorts: [{ id: "l", schluessel: ["Logistik"] }],
      }),
    );
    expect(v).toEqual({
      zeile: "Offerte @Jonas bis 15.3. #Logistik",
      titel: "Offerte",
      person: { status: "gefunden", text: "Jonas", ids: ["j"] },
      ressort: { status: "gefunden", text: "Logistik", ids: ["l"] },
      frist: { datum: "2027-03-15", text: "bis 15.3." },
      hinweise: [],
    });
  });

  test("ohne alles: nur ein Titel", () => {
    expect(parseZeile("Offerte einholen", kontext())).toEqual({
      zeile: "Offerte einholen",
      titel: "Offerte einholen",
      person: null,
      ressort: null,
      frist: null,
      hinweise: [],
    });
  });

  test("deterministisch: gleiche Eingabe, gleiches Ergebnis", () => {
    const k = kontext();
    const text = "Offerte bis Ende Woche\nZelt Montag";
    expect(parseSchnelleingabe(text, k)).toEqual(parseSchnelleingabe(text, k));
  });
});

describe("Eingabe", () => {
  test("höchstens 500 Zeichen und 20 Zeilen, mindestens eine nicht leere Zeile", () => {
    const ok = (text: string) =>
      schnelleingabeEingabe.safeParse({ text }).success;
    expect(ok("Offerte")).toBe(true);
    expect(ok("a".repeat(500))).toBe(true);
    expect(ok("a".repeat(501))).toBe(false);
    expect(ok("")).toBe(false);
    expect(ok("  \n \n")).toBe(false);
    expect(ok(Array(20).fill("a").join("\n"))).toBe(true);
    expect(ok(Array(21).fill("a").join("\n"))).toBe(false);
    expect(
      schnelleingabeEingabe.safeParse({ text: "a", extra: 1 }).success,
    ).toBe(false);
    expect(schnelleingabeEingabe.safeParse({}).success).toBe(false);
    expect(schnelleingabeEingabe.safeParse({ text: 5 }).success).toBe(false);
  });

  test("lange Eingaben bleiben schnell (kein katastrophales Backtracking)", () => {
    const k = kontext({ personen: [{ id: "p", schluessel: ["Pax"] }] });
    const boese = `@${"a".repeat(240)} ${"1.".repeat(120)}`;
    const t0 = performance.now();
    parseZeile(boese, k);
    parseZeile(`${"bis ".repeat(120)}x`, k);
    parseZeile(`${"in ".repeat(160)}1`, k);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
