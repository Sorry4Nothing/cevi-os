import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { SPERRLISTE } from "../src/gesundheit-sperrliste.js";
import {
  antwortText,
  pruefeAntworten,
  type Feld,
} from "../src/website/bausteine-formular.js";
import { pruefeDokument } from "../src/website/dokument.js";
import { rendereGeschuetzte, serialisiere } from "../src/website/rendern.js";
import { keineDaten, rendereBausteine } from "../src/website/rendern.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { baueKnoten } from "../public/website/knoten.js";

// Baustein «formular» (#819): Schema, Prüfung der Antworten, Renderer und die Elemente, die knoten.js beim Nachladen kennt
const id = () => randomUUID();
const text = (extra: object = {}): Feld => ({
  id: id(),
  typ: "text",
  beschriftung: "Name",
  pflicht: true,
  ...extra,
});
const formular = (felder: unknown[], extra: object = {}) => ({
  id: id(),
  typ: "formular",
  daten: {
    felder,
    datenschutz: "Wir planen damit das Lager. Die Leitung sieht die Antworten.",
    ...extra,
  },
});
const dok = (...bausteine: unknown[]) => ({ v: 1, titel: "Seite", bausteine });

describe("Schema", () => {
  test("ein gültiges Formular bekommt seine Vorgaben", () => {
    const r = pruefeDokument(dok(formular([text()])));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.dokument.bausteine[0]!;
    expect(b.typ === "formular" && b.daten).toMatchObject({
      absenden: "Antwort senden",
      aufbewahrenTage: 180,
      maxAntworten: 2000,
      eineProPerson: false,
    });
  });

  test.each([
    ["ohne Datenschutzhinweis", formular([text()], { datenschutz: "" })],
    ["ohne Felder", formular([])],
    ["31 Felder", formular(Array.from({ length: 31 }, () => text()))],
    ["doppelte Feld-ID", (() => { const f = text(); return formular([f, f]); })()],
    ["unbekannte Eigenschaft", formular([text()], { zusatz: 1 })],
    ["Auswahl mit einer Antwort", formular([{ id: id(), typ: "auswahl", beschriftung: "A", pflicht: false, optionen: ["Eins"] }])],
    ["doppelte Antwort", formular([{ id: id(), typ: "optionsfelder", beschriftung: "A", pflicht: false, optionen: ["Eins", "Eins"] }])],
    ["Zustimmung ohne Pflicht", formular([{ id: id(), typ: "zustimmung", beschriftung: "Ja", pflicht: false }])],
    ["Frist unter 7 Tagen", formular([text()], { aufbewahrenTage: 3 })],
    ["Frist über 730 Tagen", formular([text()], { aufbewahrenTage: 731 })],
    ["mehr als 10000 Antworten", formular([text()], { maxAntworten: 10001 })],
    ["Datei als Feldart", formular([{ id: id(), typ: "datei", beschriftung: "A", pflicht: false }])],
    ["kleinster Wert grösser als grösster", formular([{ id: id(), typ: "zahl", beschriftung: "A", pflicht: false, min: 5, max: 1 }])],
    ["Datum «31.12.2026»", formular([text()], { schliesstAm: "31.12.2026" })],
    ["Steuerzeichen in der Beschriftung", formular([text({ beschriftung: "A\u0000B" })])],
  ])("%s ist ungültig", (_n, baustein) => {
    expect(pruefeDokument(dok(baustein)).ok).toBe(false);
  });

  test.each(["Hast du Allergien?", "Nimmst du Medikamente?", "Impfstatus", "Gesundheit", "Psychische Belastung"])(
    "Gesundheitsdaten werden abgelehnt: «%s»",
    (t) => {
      expect(pruefeDokument(dok(formular([text({ beschriftung: t })]))).ok).toBe(false);
      expect(pruefeDokument(dok(formular([text({ hilfe: t })]))).ok).toBe(false);
      expect(
        pruefeDokument(
          dok(formular([{ id: id(), typ: "auswahl", beschriftung: "A", pflicht: false, optionen: [t, "Nein"] }])),
        ).ok,
      ).toBe(false);
    },
  );

  test("der Editor kennt dieselbe Sperrliste wie der Server", () => {
    // Das Modul des Editors braucht den DOM: Die Liste steht im Text der Datei
    const quelle = readFileSync(
      new URL("../public/admin/website-felder-formular.js", import.meta.url),
      "utf8",
    );
    const liste = /SPERRLISTE = \[([^\]]*)\]/.exec(quelle)![1]!;
    expect([...liste.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual(SPERRLISTE);
  });
});

describe("Antworten prüfen", () => {
  const f = (extra: object): Feld =>
    ({ id: id(), beschriftung: "F", pflicht: false, ...extra }) as Feld;
  const eine = (feld: Feld, wert: unknown) =>
    pruefeAntworten([feld], wert === undefined ? {} : { [feld.id]: wert });
  const code = (r: ReturnType<typeof pruefeAntworten>) =>
    r.ok ? null : r.fehler[0]!.code;

  test("Pflicht fehlt: PFLICHT, freiwillig leer: fehlt in den Antworten", () => {
    expect(code(eine(f({ typ: "text", pflicht: true }), undefined))).toBe("PFLICHT");
    expect(code(eine(f({ typ: "text", pflicht: true }), "   "))).toBe("PFLICHT");
    const r = eine(f({ typ: "text" }), "");
    expect(r).toEqual({ ok: true, antworten: {} });
  });

  test("unbekannte Feld-ID: UNBEKANNT, auch für __proto__", () => {
    const feld = f({ typ: "text" });
    const r = pruefeAntworten([feld], JSON.parse('{"__proto__": "x"}'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.fehler).toEqual([{ feld: "__proto__", code: "UNBEKANNT" }]);
    expect(code(pruefeAntworten([feld], { [id()]: "x" }))).toBe("UNBEKANNT");
  });

  test("Text: getrimmt, Länge, Steuerzeichen, Typ", () => {
    const feld = f({ typ: "text", maxLaenge: 5, minLaenge: 2 });
    expect(eine(feld, "  abc ")).toMatchObject({ ok: true, antworten: { [feld.id]: "abc" } });
    expect(code(eine(feld, "abcdef"))).toBe("ZU_LANG");
    expect(code(eine(feld, "a"))).toBe("ZU_KURZ");
    expect(code(eine(feld, "a\nb"))).toBe("STEUERZEICHEN");
    expect(code(eine(feld, "a​b"))).toBe("STEUERZEICHEN");
    expect(code(eine(feld, 5))).toBe("TYP");
    // Ohne maxLaenge gilt 200
    expect(code(eine(f({ typ: "text" }), "x".repeat(201)))).toBe("ZU_LANG");
  });

  test("Textbereich: Zeilenumbruch erlaubt, Tabulator nicht, Standard 1000", () => {
    const feld = f({ typ: "textbereich" });
    expect(eine(feld, "a\r\nb")).toMatchObject({ ok: true, antworten: { [feld.id]: "a\nb" } });
    expect(code(eine(feld, "a\tb"))).toBe("STEUERZEICHEN");
    expect(code(eine(feld, "x".repeat(1001)))).toBe("ZU_LANG");
  });

  test("Zahl: nur Zahlen, ganz, Bereich", () => {
    const feld = f({ typ: "zahl", ganzzahl: true, min: 1, max: 10 });
    expect(eine(feld, 5).ok).toBe(true);
    expect(code(eine(feld, "5"))).toBe("TYP");
    expect(code(eine(feld, 5.5))).toBe("FORMAT");
    expect(code(eine(feld, 11))).toBe("BEREICH");
    expect(code(eine(feld, 0))).toBe("BEREICH");
    expect(code(eine(feld, Number.NaN))).toBe("TYP");
    expect(code(eine(f({ typ: "zahl" }), 1e12))).toBe("BEREICH");
  });

  test("Datum: Format, echter Kalendertag, Bereich", () => {
    const feld = f({ typ: "datum", von: "2026-01-01", bis: "2026-12-31" });
    expect(eine(feld, "2026-06-15").ok).toBe(true);
    expect(code(eine(feld, "2026-02-30"))).toBe("FORMAT");
    expect(code(eine(feld, "15.06.2026"))).toBe("FORMAT");
    expect(code(eine(feld, "2027-01-01"))).toBe("BEREICH");
  });

  test("E-Mail und Telefon", () => {
    expect(eine(f({ typ: "email" }), "a@beispiel.ch").ok).toBe(true);
    expect(code(eine(f({ typ: "email" }), "a@b"))).toBe("FORMAT");
    expect(eine(f({ typ: "telefon" }), "079 123 45 67").ok).toBe(true);
    expect(eine(f({ typ: "telefon" }), "+41 79 123 45 67").ok).toBe(true);
    expect(code(eine(f({ typ: "telefon" }), "abc"))).toBe("FORMAT");
    expect(code(eine(f({ typ: "telefon" }), "=1+1"))).toBe("FORMAT");
  });

  test("Auswahl: nur eine Option der Definition", () => {
    const feld = f({ typ: "auswahl", optionen: ["A", "B"] });
    expect(eine(feld, "A").ok).toBe(true);
    expect(code(eine(feld, "C"))).toBe("OPTION");
    expect(code(eine(feld, ["A"]))).toBe("TYP");
  });

  test("Mehrfachwahl: Optionen, keine Doppelten, Anzahl, Reihenfolge der Definition", () => {
    const feld = f({ typ: "mehrfachwahl", optionen: ["A", "B", "C"], minAuswahl: 1, maxAuswahl: 2 });
    expect(eine(feld, ["C", "A"])).toMatchObject({ ok: true, antworten: { [feld.id]: ["A", "C"] } });
    expect(code(eine(feld, ["A", "B", "C"]))).toBe("ANZAHL");
    expect(code(eine(feld, ["A", "A"]))).toBe("OPTION");
    expect(code(eine(feld, ["X"]))).toBe("OPTION");
    expect(code(eine(feld, "A"))).toBe("TYP");
  });

  test("Ja oder Nein: false ist eine Antwort; Zustimmung braucht true", () => {
    const jn = f({ typ: "janein", pflicht: true });
    expect(eine(jn, false)).toMatchObject({ ok: true, antworten: { [jn.id]: false } });
    expect(code(eine(jn, undefined))).toBe("PFLICHT");
    expect(code(eine(jn, "ja"))).toBe("TYP");
    const z = f({ typ: "zustimmung", pflicht: true });
    expect(eine(z, true).ok).toBe(true);
    expect(code(eine(z, false))).toBe("PFLICHT");
    expect(code(eine(z, undefined))).toBe("PFLICHT");
    expect(code(eine(z, "true"))).toBe("TYP");
  });

  test("ein Fehler trägt nie den Wert der Antwort", () => {
    const geheim = "GEHEIMER-WERT-12345";
    const feld = f({ typ: "text", maxLaenge: 3 });
    expect(JSON.stringify(eine(feld, geheim))).not.toContain(geheim);
  });

  test("antwortText: Anzeige für Liste und CSV", () => {
    expect(antwortText(f({ typ: "janein" }), true)).toBe("Ja");
    expect(antwortText(f({ typ: "janein" }), false)).toBe("Nein");
    expect(antwortText(f({ typ: "zustimmung", pflicht: true }), true)).toBe("Ja, zugestimmt");
    expect(antwortText(undefined, ["A", "B"])).toBe("A, B");
    expect(antwortText(undefined, undefined)).toBe("");
  });
});

describe("Renderer", () => {
  const felder: Feld[] = [
    text({ beschriftung: "Wie heisst du?", hilfe: "Vorname genügt" }),
    { id: id(), typ: "textbereich", beschriftung: "Was noch?", pflicht: false },
    { id: id(), typ: "zahl", beschriftung: "Wie viele?", pflicht: false, ganzzahl: true, min: 1, max: 5 },
    { id: id(), typ: "datum", beschriftung: "Wann?", pflicht: false },
    { id: id(), typ: "email", beschriftung: "E-Mail", pflicht: false },
    { id: id(), typ: "telefon", beschriftung: "Telefon", pflicht: false },
    { id: id(), typ: "auswahl", beschriftung: "Stufe", pflicht: true, optionen: ["Biber", "Wölfe"] },
    { id: id(), typ: "optionsfelder", beschriftung: "Wie lange?", pflicht: true, optionen: ["Kurz", "Lang"] },
    { id: id(), typ: "mehrfachwahl", beschriftung: "Was bringst du mit?", pflicht: false, optionen: ["Zelt", "Topf"] },
    { id: id(), typ: "janein", beschriftung: "Kommst du?", pflicht: true },
    { id: id(), typ: "zustimmung", beschriftung: "Ich bin einverstanden.", pflicht: true },
  ];
  const baustein = formular(felder, { titel: "Umfrage <b>fett</b>" });
  const seite = () => {
    const r = pruefeDokument(dok(baustein));
    if (!r.ok) throw new Error(JSON.stringify(r.fehler));
    return r.dokument;
  };
  const html = () => rendereBausteine(seite(), randomUUID(), keineDaten(), "/umfrage");

  test("jedes Feld hat ein Label, Hilfen sind verknüpft, der Titel ist maskiert", () => {
    const h = html();
    expect(h).toContain("Umfrage &lt;b&gt;fett&lt;/b&gt;");
    expect(h).not.toContain("<b>fett</b>");
    // Eingabefelder: label for = id
    for (const m of h.matchAll(/<input[^>]*type="(?:text|email|tel|date)"[^>]*id="([^"]+)"/g)) {
      if (m[1]!.endsWith("-fall")) continue;
      expect(h).toContain(`<label for="${m[1]}">`);
    }
    expect(h).toContain('aria-describedby="f-');
    expect(h).toContain('class="hilfe"');
    expect(h).toContain("<legend");
    expect(h).toContain("(optional)");
    expect(h).toContain('autocomplete="email"');
    expect(h).toContain('autocomplete="tel"');
    expect(h).toContain("novalidate");
    expect(h).toContain('type="submit"');
    expect(h).toContain("Antwort senden");
    expect(h).toContain("Wir löschen die Antworten nach 180 Tagen");
    expect(h).toContain("Datenschutz.");
  });

  test("Pflicht ist required, die Falle ist versteckt und nicht erreichbar", () => {
    const h = html();
    expect(h).toContain('name="homepage"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).toContain('tabindex="-1"');
    expect(h).toMatch(/<input[^>]*required[^>]*>/);
  });

  test("Option und Beschriftung mit Spitzklammern werden maskiert", () => {
    const b = formular([{ id: id(), typ: "auswahl", beschriftung: "<script>x</script>", pflicht: false, optionen: ["<img src=x onerror=1>", "B"] }]);
    const r = pruefeDokument(dok(b));
    if (!r.ok) throw new Error("ungültig");
    const h = rendereBausteine(r.dokument, randomUUID(), keineDaten(), "/x");
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;script&gt;");
  });

  test("beim Nachladen kennt knoten.js jedes Element und Attribut des Formulars", () => {
    const s = seite();
    const knoten = rendereGeschuetzte(s, randomUUID(), keineDaten(), () => true)[0]!.knoten;
    // Die Attrappe baut einen Baum, den man wieder zu Text machen kann
    const doc = attrappe();
    const gebaut = baueKnoten(doc, knoten) as unknown as Attr;
    const sollTags = tagsVon(knoten);
    const istTags = tagsVon(gebaut);
    expect(istTags).toEqual(sollTags);
    // Alle Attribute, die der Renderer setzt, bleiben stehen
    expect(attrVon(gebaut)).toEqual(attrVon(knoten, true));
    expect(serialisiere(knoten)).toContain("<form");
  });
});

// Eine kleine Attrappe des DOM ohne Browser (wie in website-skripte.test.ts)
type Attr = { tag: string; attr: Record<string, string>; kinder: Attr[] } | string;
function attrappe() {
  return {
    createTextNode: (t: string) => t,
    createElement: (tag: string) => {
      const e = {
        tag,
        attr: {} as Record<string, string>,
        kinder: [] as unknown[],
        setAttribute(n: string, w: string) {
          this.attr[n] = w;
        },
        appendChild(k: unknown) {
          this.kinder.push(k);
        },
      };
      return e;
    },
  } as never;
}
function tagsVon(k: unknown): string[] {
  if (typeof k === "string") return [];
  const n = k as { tag: string; kinder?: unknown[] };
  // Der Hinweis für Browser ohne Skript fällt beim Nachladen weg (knoten.js kennt noscript nicht)
  if (n.tag === "noscript") return [];
  return [n.tag, ...(n.kinder ?? []).flatMap(tagsVon)];
}
function attrVon(k: unknown, roh = false): string[] {
  if (typeof k === "string") return [];
  const n = k as { tag: string; attr?: Record<string, unknown>; kinder?: unknown[] };
  if (roh && n.tag === "noscript") return [];
  return [
    ...Object.keys(n.attr ?? {}).map((a) => `${n.tag}.${a}`),
    ...(n.kinder ?? []).flatMap((x) => attrVon(x, roh)),
  ];
}

describe("Skript und Stil", () => {
  test("die Dateien gibt es, das Skript setzt nie innerHTML", () => {
    const js = readFileSync(new URL("../public/website/formular.js", import.meta.url), "utf8");
    const ohneKommentare = js.replace(/^\s*\/\/.*$/gm, "");
    expect(ohneKommentare).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(readFileSync(new URL("../public/website/formular.css", import.meta.url), "utf8")).toContain(".bformular");
  });
});
