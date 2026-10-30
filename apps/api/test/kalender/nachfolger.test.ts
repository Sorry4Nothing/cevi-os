import { expect, test } from "vitest";
import {
  findeNachfolger,
  programmTag,
  serienstamm,
} from "../../src/kalender/nachfolger.js";

// Sommerzeit: 14:00 Schweizer Zeit = 12:00Z
const samstag = (tag: string, stunde = "12") =>
  new Date(`2027-10-${tag}T${stunde}:00:00Z`);

const fehlt = (
  id: string,
  tag: string,
  titel: string,
  serie: string | null = null,
) => ({
  id,
  googleSerie: serie,
  titel,
  tagVon: null,
  beginn: samstag(tag),
});
const neu = (
  event: string,
  tag: string,
  titel: string,
  serie: string | null = null,
) => ({
  googleEventId: event,
  googleSerie: serie,
  titel,
  tagVon: null,
  beginn: samstag(tag, "11"),
});

const keine = new Set<string>();

test("gleicher Serienstamm am gleichen Tag: Übernahme", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Gruppenstunde", "a1")],
      [neu("e1", "09", "Gruppenstunde um halb zwei", "a1_R20271009T113000")],
      keine,
    ),
  ).toEqual({
    uebernahmen: [{ programmId: "p1", googleEventId: "e1" }],
    pruefen: [],
  });
});

test("serienstamm kürzt ab dem ersten «_R», auch wenn es zweimal vorkommt", () => {
  expect(serienstamm("a1_R20271009T113000")).toBe("a1");
  expect(serienstamm("a1_R20271009T113000_R20271016T113000")).toBe("a1");
  expect(serienstamm("a1")).toBe("a1");
  expect(serienstamm(null)).toBeNull();
});

test("gleicher Titel am gleichen Tag ohne Serie: Übernahme", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Waldtag")],
      [neu("e1", "09", "Waldtag")],
      keine,
    ).uebernahmen,
  ).toEqual([{ programmId: "p1", googleEventId: "e1" }]);
});

test("gleicher Serienstamm an einem anderen Tag: Prüfen", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "13", "Werkstatt", "b1")],
      [neu("e1", "14", "Werkstatt", "b1_R20271014T160000")],
      keine,
    ),
  ).toEqual({ uebernahmen: [], pruefen: ["p1"] });
});

test("gleicher Titel an einem anderen Tag: Prüfen", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Waldtag")],
      [neu("e1", "10", "Waldtag")],
      keine,
    ),
  ).toEqual({ uebernahmen: [], pruefen: ["p1"] });
});

test("zwei passende Kandidaten: Prüfen", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Waldtag")],
      [neu("e1", "09", "Waldtag"), neu("e2", "09", "Waldtag")],
      keine,
    ),
  ).toEqual({ uebernahmen: [], pruefen: ["p1"] });
});

test("ein Treffer über den Serienstamm schlägt einen Treffer über den Titel", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Gruppenstunde", "a1")],
      [
        neu("titel", "09", "Gruppenstunde"),
        neu("stamm", "09", "Anders benannt", "a1_R1"),
      ],
      keine,
    ).uebernahmen,
  ).toEqual([{ programmId: "p1", googleEventId: "stamm" }]);
});

test("zwei fehlende Programme wählen denselben Kandidaten: beide Prüfen, auch wenn die Gruppe des anderen zwei hält", () => {
  const einer = [neu("e1", "09", "Waldtag")];
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Waldtag"), fehlt("p2", "09", "Waldtag")],
      einer,
      keine,
    ),
  ).toEqual({ uebernahmen: [], pruefen: ["p1", "p2"] });
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Waldtag"), fehlt("p2", "09", "Waldtag", "a1")],
      [neu("e1", "09", "Waldtag", "a1_R1"), neu("e2", "09", "Waldtag")],
      keine,
    ),
  ).toEqual({
    // p2 trifft über den Stamm genau e1, aber p1 trifft über den Titel e1 und e2: e1 ist nicht eindeutig
    uebernahmen: [],
    pruefen: ["p1", "p2"],
  });
});

test("ein bekannter Termin ist nie Kandidat", () => {
  expect(
    findeNachfolger(
      [fehlt("p1", "09", "Waldtag")],
      [neu("e1", "09", "Waldtag")],
      new Set(["e1"]),
    ),
  ).toEqual({ uebernahmen: [], pruefen: ["p1"] });
});

test("ganztägige Programme treffen sich über tag_von", () => {
  const ganz = { tagVon: "2027-10-29", beginn: null };
  expect(
    findeNachfolger(
      [{ id: "p1", googleSerie: null, titel: "Lager", ...ganz }],
      [{ googleEventId: "e1", googleSerie: null, titel: "Lager", ...ganz }],
      keine,
    ).uebernahmen,
  ).toEqual([{ programmId: "p1", googleEventId: "e1" }]);
});

test("programmTag zählt das Schweizer Datum, auch in den beiden Zeitumstellungsnächten 2027", () => {
  expect(
    programmTag({ tagVon: null, beginn: new Date("2027-03-27T23:30:00Z") }),
  ).toBe("2027-03-28");
  expect(
    programmTag({ tagVon: null, beginn: new Date("2027-10-30T22:30:00Z") }),
  ).toBe("2027-10-31");
  expect(programmTag({ tagVon: "2027-10-29", beginn: null })).toBe(
    "2027-10-29",
  );
});
