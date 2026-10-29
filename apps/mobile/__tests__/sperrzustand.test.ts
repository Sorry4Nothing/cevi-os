import { SecurityLevel } from "expo-local-authentication";

import { sperrzustand, type Sperrzustand } from "../src/sperre/sperrzustand";

type Person = { admin: boolean; rollen: string[] };

const ELTERN: Person = { admin: false, rollen: [] };
const LEITENDE: Person = { admin: false, rollen: ["leitung"] };
const SL: Person = { admin: false, rollen: ["sl"] };
const ADMIN: Person = { admin: true, rollen: [] };
// Leitende in einer Abteilung und Elternteil in einer anderen: «rollen» ist nicht leer, das zählt
const LEITENDE_UND_ELTERN: Person = { admin: false, rollen: ["leitung"] };

const MIT_CODE = [
  ["SECRET", SecurityLevel.SECRET],
  ["BIOMETRIC_WEAK", SecurityLevel.BIOMETRIC_WEAK],
  ["BIOMETRIC_STRONG", SecurityLevel.BIOMETRIC_STRONG],
] as const;
const KOMBINATIONEN = [
  { gesperrt: true, aus: false },
  { gesperrt: true, aus: true },
  { gesperrt: false, aus: false },
  { gesperrt: false, aus: true },
];

function pruefe(
  ich: Person,
  niveau: SecurityLevel | undefined,
  erwartet: (kombi: { gesperrt: boolean; aus: boolean }) => Sperrzustand,
) {
  for (const kombi of KOMBINATIONEN) {
    expect(sperrzustand({ ich, niveau, ...kombi })).toBe(erwartet(kombi));
  }
}

describe.each([
  ["Leitende", LEITENDE],
  ["SL", SL],
  ["Admin", ADMIN],
  ["Leitende und Elternteil", LEITENDE_UND_ELTERN],
])("%s (vorgegeben)", (_name, ich) => {
  test("ohne Geräte-Code sehen sie keine Daten: «code-fehlt», auch mit «aus»", () => {
    pruefe(ich, SecurityLevel.NONE, () => "code-fehlt");
  });

  test.each(MIT_CODE)(
    "mit Geräte-Code (%s): gesperrt, wenn gesperrt; «aus» zählt nicht",
    (_n, niveau) => {
      pruefe(ich, niveau, ({ gesperrt }) => (gesperrt ? "gesperrt" : "frei"));
    },
  );

  test("bis zur ersten Antwort des Geräts bleibt es zu, auch mit «aus»", () => {
    pruefe(ich, undefined, ({ gesperrt }) => (gesperrt ? "gesperrt" : "frei"));
  });
});

describe("Eltern (vorgeschlagen)", () => {
  test("ohne Geräte-Code gibt es nichts zu entsperren: immer «frei»", () => {
    pruefe(ELTERN, SecurityLevel.NONE, () => "frei");
  });

  test.each(MIT_CODE)(
    "mit Geräte-Code (%s): gesperrt, wenn gesperrt und nicht abgeschaltet",
    (_n, niveau) => {
      pruefe(ELTERN, niveau, ({ gesperrt, aus }) =>
        gesperrt && !aus ? "gesperrt" : "frei",
      );
    },
  );

  test("bis zur ersten Antwort des Geräts: zu, ausser abgeschaltet", () => {
    pruefe(ELTERN, undefined, ({ gesperrt, aus }) =>
      gesperrt && !aus ? "gesperrt" : "frei",
    );
  });
});

test("ohne «ich» zeigt das Tor keine Serverdaten: «frei»", () => {
  for (const niveau of [undefined, SecurityLevel.NONE, SecurityLevel.SECRET]) {
    expect(
      sperrzustand({ ich: undefined, niveau, gesperrt: true, aus: false }),
    ).toBe("frei");
  }
});
