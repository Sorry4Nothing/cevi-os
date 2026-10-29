import {
  anzahlText,
  istNichtZugeordnet,
  istZuPruefen,
  siehtEingaenge,
  zuordnungsRechte,
} from "../src/programme/zuordnen";

const A = "a";
const B = "b";
const ADMIN = { admin: true, rollen: [] };
const SL_A = { admin: false, rollen: [{ stufeId: A, typ: "stufenleitung" }] };
const LEITUNG_A = { admin: false, rollen: [{ stufeId: A, typ: "leitung" }] };
const ELTERN = { admin: false, rollen: [] };
const stufen = (...ids: string[]) => ids.map((id) => ({ id, name: id }));

test.each([
  ["Admin", ADMIN, true],
  ["SL", SL_A, true],
  ["Leitende", LEITUNG_A, false],
  ["Eltern", ELTERN, false],
])("%s: Eingänge sichtbar %s", (_, ich, erwartet) => {
  expect(siehtEingaenge(ich)).toBe(erwartet);
});

test.each([
  ["intern", [], true],
  ["intern", [A], false],
  ["leitende", [], false],
  ["eltern", [], false],
] as const)(
  "nicht zugeordnet: %s mit Stufen %j gilt als %s",
  (sichtbarkeit, ids, erwartet) => {
    expect(istNichtZugeordnet({ sichtbarkeit, stufen: stufen(...ids) })).toBe(
      erwartet,
    );
  },
);

test("zu prüfen ist nur der Status pruefen", () => {
  expect(istZuPruefen({ status: "pruefen" })).toBe(true);
  expect(istZuPruefen({ status: "aktiv" })).toBe(false);
  expect(istZuPruefen({ status: "abgesagt" })).toBe(false);
});

test.each([
  [0, "keine Programme"],
  [1, "1 Programm"],
  [3, "3 Programme"],
])("%i Programme als Text", (anzahl, text) => {
  expect(anzahlText(anzahl)).toBe(text);
});

// Gespiegelt aus darfZuordnen der API: Welche Stufen und welche Sichtbarkeit ein Mensch hier ändern darf
describe("zuordnungsRechte", () => {
  test.each([
    ["Admin, ohne Stufe", ADMIN, [], true, true],
    ["Admin, fremde Stufe", ADMIN, [B], true, true],
    ["SL, ohne Stufe", SL_A, [], true, true],
    ["SL, eigene Stufe", SL_A, [A], true, true],
    ["SL, eigene und fremde Stufe", SL_A, [A, B], true, false],
    ["SL, nur fremde Stufe", SL_A, [B], true, false],
    ["Leitende", LEITUNG_A, [A], false, false],
    ["Eltern", ELTERN, [A], false, false],
  ])("%s", (_, ich, zugeordnet, darf, sichtbarkeit) => {
    const rechte = zuordnungsRechte(ich, { stufen: stufen(...zugeordnet) });
    expect(rechte.darf).toBe(darf);
    expect(rechte.sichtbarkeit).toBe(sichtbarkeit);
  });

  test("eine SL darf nur ihre eigene Stufe zuordnen, ein Admin jede", () => {
    const sl = zuordnungsRechte(SL_A, { stufen: [] });
    expect([sl.stufe(A), sl.stufe(B)]).toEqual([true, false]);
    const admin = zuordnungsRechte(ADMIN, { stufen: [] });
    expect([admin.stufe(A), admin.stufe(B)]).toEqual([true, true]);
  });
});
