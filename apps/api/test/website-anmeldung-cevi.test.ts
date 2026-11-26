import { describe, expect, test } from "vitest";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as tm from "../public/website/tm.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as anmeldung from "../public/website/anmeldung.js";

// Angaben aus der Cevi-Datenbank in der Anmeldung (#691): reine Ansichten, ohne DOM
const text = tm.text as (d: unknown) => string;
const html = tm.html as (d: unknown) => string;

const feld = (mehr: Record<string, unknown> = {}) => ({
  schluessel: "geburtsdatum",
  beschriftung: "Geburtsdatum",
  typ: "text",
  optionen: [],
  pflicht: false,
  ceviQuelle: "geburtsdatum",
  ...mehr,
});
const flatText = (inhalt: unknown[]) =>
  inhalt
    .map((d) => text(d))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

describe("Zeile über den Feldern", () => {
  test("beim Laden, bei einem Fehler und nach der Übernahme", () => {
    expect(
      flatText(
        anmeldung.ceviStatusInhalt({ ...anmeldung.KEIN_CEVI, laedt: "selbst" }),
      ),
    ).toBe("Angaben aus der Cevi-Datenbank werden geholt …");
    expect(
      flatText(
        anmeldung.ceviStatusInhalt({ ...anmeldung.KEIN_CEVI, fehler: true }),
      ),
    ).toBe(
      "Die Cevi-Datenbank antwortet gerade nicht. Bitte füll die Angaben selbst aus.",
    );
    expect(
      flatText(
        anmeldung.ceviStatusInhalt({
          laedt: null,
          fehler: false,
          herkunft: { a: "1", b: "2" },
        }),
      ),
    ).toBe("2 Angaben aus der Cevi-Datenbank übernommen. Bitte prüfen.");
    // nichts übernommen: nichts sagen (das Feld bleibt eine normale Frage)
    expect(anmeldung.ceviStatusInhalt(anmeldung.KEIN_CEVI)).toEqual([]);
  });
});

describe("Herkunft unter dem Feld", () => {
  const c = (herkunft: Record<string, string>) => ({
    laedt: null,
    fehler: false,
    herkunft,
  });

  test("Text und Symbol, nie nur Farbe; nach einer Änderung ein anderer Text", () => {
    const f = feld();
    const unveraendert = anmeldung.ceviNotizInhalt(
      f,
      c({ geburtsdatum: "17.05.2014" }),
      "17.05.2014",
    );
    expect(flatText(unveraendert)).toBe("Aus der Cevi-Datenbank übernommen");
    expect(html(unveraendert[0])).toContain("<svg");
    expect(
      flatText(
        anmeldung.ceviNotizInhalt(
          f,
          c({ geburtsdatum: "17.05.2014" }),
          "01.01.2000",
        ),
      ),
    ).toBe("Aus der Cevi-Datenbank, von dir geändert");
  });

  test("ein Feld ohne Quelle oder ohne Vorschlag trägt keine Notiz", () => {
    expect(
      anmeldung.ceviNotizInhalt(
        feld({ ceviQuelle: null }),
        anmeldung.KEIN_CEVI,
        "",
      ),
    ).toEqual([]);
    expect(anmeldung.ceviNotizInhalt(feld(), anmeldung.KEIN_CEVI, "")).toEqual(
      [],
    );
  });

  test("beim Laden steht ein Platzhalter für Hilfstechnik versteckt (kein Sprung)", () => {
    const [skelett] = anmeldung.ceviNotizInhalt(
      feld(),
      { ...anmeldung.KEIN_CEVI, laedt: "selbst" },
      "",
    );
    expect(html(skelett)).toContain('aria-hidden="true"');
  });
});

describe("Formular", () => {
  const z = (felder: unknown[], cevi?: unknown) => ({
    a: {
      id: "11111111-1111-4111-8111-111111111111",
      titel: "Lager",
      anmeldungOffen: true,
      felder,
      teilnehmende: [{ kindId: "k", name: "Lea", konto: [], anmeldung: null }],
    },
    wahl: 0,
    werte: {},
    fehler: {},
    zusammenfassung: [],
    senden: false,
    offline: false,
    band: null,
    bearbeiten: false,
    ...(cevi ? { cevi } : {}),
  });

  test("mit Quelle: Zeile mit aria-live und Notiz am Feld, Beschreibung des Feldes verweist darauf", () => {
    const h = html(anmeldung.formularView(z([feld()])));
    expect(h).toContain('id="tm-cevi-status"');
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('id="a-geburtsdatum-c"');
    expect(h).toContain("a-geburtsdatum-h a-geburtsdatum-c");
  });

  test("ohne Quelle bleibt das Formular wie bisher", () => {
    const h = html(anmeldung.formularView(z([feld({ ceviQuelle: null })])));
    expect(h).not.toContain("tm-cevi-status");
    expect(h).not.toContain("cevi-note");
  });
});
