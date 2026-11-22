import { describe, expect, test } from "vitest";
import { pruefeDokument } from "../src/website/dokument.js";
// Reines Browser-Modul der Verwaltung ohne Typen; es hat keine Abhängigkeit auf DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as rt from "../public/admin/website-richtext.js";

const absatz = (...inhalt: object[]) => ({ typ: "absatz", inhalt });
const a = (text: string, marken: object = {}) => ({ text, ...marken });

describe("Text zu Knoten", () => {
  test("ein Absatz je Zeile, leere Zeilen trennen nur", () => {
    expect(rt.textZuBloecken("Eins\n\n\nZwei\nDrei")).toEqual([
      absatz(a("Eins")),
      absatz(a("Zwei")),
      absatz(a("Drei")),
    ]);
  });

  test("leere Eingabe ergibt keinen Block", () => {
    expect(rt.textZuBloecken("")).toEqual([]);
    expect(rt.textZuBloecken("  \n\t\n")).toEqual([]);
  });

  test("fett, kursiv und beides", () => {
    expect(rt.textZuBloecken("a **b** *c* ***d*** e")).toEqual([
      absatz(
        a("a "),
        a("b", { fett: true }),
        a(" "),
        a("c", { kursiv: true }),
        a(" "),
        a("d", { fett: true, kursiv: true }),
        a(" e"),
      ),
    ]);
  });

  test("Marken dürfen sich überlappen", () => {
    expect(rt.textZuBloecken("**a *b** c*")).toEqual([
      absatz(
        a("a ", { fett: true }),
        a("b", { fett: true, kursiv: true }),
        a(" c", { kursiv: true }),
      ),
    ]);
  });

  test("ein Stern am Leerraum oder ohne Partner bleibt Text", () => {
    expect(rt.textZuBloecken("3 * 4 * 5")).toEqual([absatz(a("3 * 4 * 5"))]);
    expect(rt.textZuBloecken("Stern* und **offen")).toEqual([
      absatz(a("Stern* und **offen")),
    ]);
  });

  test("Links mit Marken im Text", () => {
    expect(
      rt.textZuBloecken("Siehe [die **Seite**](/stufen/woelfe) oder [x](u)."),
    ).toEqual([
      absatz(
        a("Siehe "),
        a("die ", { link: "/stufen/woelfe" }),
        a("Seite", { fett: true, link: "/stufen/woelfe" }),
        a(" oder "),
        a("x", { link: "u" }),
        a("."),
      ),
    ]);
  });

  test("Marken um einen Link gelten für seinen Text", () => {
    expect(rt.textZuBloecken("**[a](u)**")).toEqual([
      absatz(a("a", { fett: true, link: "u" })),
    ]);
  });

  test("eine Klammer ohne Adresse bleibt Text", () => {
    expect(rt.textZuBloecken("[Text] und [a]() und [b](")).toEqual([
      absatz(a("[Text] und [a]() und [b](")),
    ]);
  });

  test("Rückstrich nimmt die Bedeutung", () => {
    expect(rt.textZuBloecken("\\*kein\\* \\[x\\](y) \\\\")).toEqual([
      absatz(a("*kein* [x](y) \\")),
    ]);
    expect(rt.textZuBloecken("\\- kein Punkt\n1\\. keine Zahl")).toEqual([
      absatz(a("- kein Punkt")),
      absatz(a("1. keine Zahl")),
    ]);
  });

  test("Listen: Punkte und Zahlen, eine leere Zeile beendet sie", () => {
    expect(rt.textZuBloecken("- a\n- **b**\n\n- c\n1. x\n2. y\nText")).toEqual([
      {
        typ: "liste",
        geordnet: false,
        eintraege: [[a("a")], [a("b", { fett: true })]],
      },
      { typ: "liste", geordnet: false, eintraege: [[a("c")]] },
      { typ: "liste", geordnet: true, eintraege: [[a("x")], [a("y")]] },
      absatz(a("Text")),
    ]);
  });

  test("ein Strich ohne Text ist keine Liste", () => {
    expect(rt.textZuBloecken("-")).toEqual([absatz(a("-"))]);
    expect(rt.textZuBloecken("- ")).toEqual([absatz(a("-"))]);
  });

  test("Tabulator und Steuerzeichen werden zu Leerzeichen", () => {
    expect(rt.textZuBloecken("a\tb\u0000c")).toEqual([absatz(a("a b c"))]);
  });

  test("Windows-Zeilenenden", () => {
    expect(rt.textZuBloecken("a\r\nb")).toEqual([
      absatz(a("a")),
      absatz(a("b")),
    ]);
  });
});

describe("Knoten zu Text", () => {
  test("Absätze mit einer Leerzeile dazwischen, Listen zeilenweise", () => {
    const text = rt.bloeckeZuText([
      absatz(a("Eins")),
      {
        typ: "liste",
        geordnet: true,
        eintraege: [[a("x")], [a("y", { kursiv: true })]],
      },
    ]);
    expect(text).toBe("Eins\n\n1. x\n2. *y*");
  });

  test("Sonderzeichen im Text bekommen einen Rückstrich", () => {
    expect(rt.bloeckeZuText([absatz(a("a*b [c] \\ (d)"))])).toBe(
      "a\\*b \\[c] \\\\ (d)",
    );
  });

  test("Leerraum am Rand steht ausserhalb der Marken", () => {
    expect(
      rt.bloeckeZuText([absatz(a("x"), a(" fett ", { fett: true }), a("y"))]),
    ).toBe("x **fett** y");
  });

  test("ein Absatz, der wie eine Liste aussieht, wird geschützt", () => {
    const bloecke = [absatz(a("- kein Punkt")), absatz(a("2. keine Zahl"))];
    const text = rt.bloeckeZuText(bloecke);
    expect(text).toBe("\\- kein Punkt\n\n2\\. keine Zahl");
    expect(rt.textZuBloecken(text)).toEqual(bloecke);
  });
});

describe("Hin und zurück", () => {
  const beispiele = [
    "Hallo Welt",
    "**fett** und *kursiv* und ***beides***",
    "**a *b** c*",
    "Siehe [**diese** Seite](/stufen/woelfe), [Mail](mailto:a@example.org).",
    "- eins\n- **zwei**\n\n1. a\n2. b",
    "Text mit \\* und \\[ und \\] und \\\\",
    "[Klammer (innen)](https://example.org/a\\)b)",
    "a ** b ** c",
    "*a* *b*",
    "**a****b**",
    "[a](u)[b](u)",
    "Ä ö ü – «Anführung»",
  ];

  test.each(beispiele)(
    "Text, Knoten, Text, Knoten bleibt gleich: %s",
    (text) => {
      const eins = rt.textZuBloecken(text);
      const zwei = rt.textZuBloecken(rt.bloeckeZuText(eins));
      expect(zwei).toEqual(eins);
    },
  );

  // Zufällige Eingaben aus den kritischen Zeichen (feste Zufallsfolge, damit der Test wiederholbar ist)
  test("200 zufällige Texte: Umwandlung ist stabil und vom Server gültig", () => {
    let seed = 7;
    const zufall = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const stuecke = [
      "a",
      "b ",
      " ",
      "*",
      "**",
      "[",
      "]",
      "(",
      ")",
      "\\",
      "- ",
      "1. ",
      "\n",
      "\n\n",
      "/x",
      "](u)",
      "[t](/seite)",
    ];
    for (let n = 0; n < 200; n++) {
      let text = "";
      for (let i = zufall() * 12; i > 0; i--) {
        text += stuecke[Math.floor(zufall() * stuecke.length)];
      }
      const eins = rt.textZuBloecken(text);
      expect(rt.textZuBloecken(rt.bloeckeZuText(eins)), text).toEqual(eins);
    }
  });

  test("das Ergebnis besteht die Prüfung des Servers", () => {
    const text =
      "Hallo **Welt**\n\n- eins\n- [zwei](/stufen/woelfe)\n\nMail an [uns](mailto:info@example.org)";
    const bloecke = rt.textZuBloecken(text);
    const p = pruefeDokument({
      v: 1,
      titel: "Test",
      bausteine: [
        {
          id: "7c1f2d1e-3b8a-4f5e-9d6a-2b1c0e9f8a7b",
          typ: "text",
          daten: { inhalt: bloecke },
        },
      ],
    });
    expect(p.ok).toBe(true);
  });
});

test("Zeichen zählen wie der Server", () => {
  expect(
    rt.zaehleZeichen([
      absatz(a("abc"), a("de")),
      { typ: "liste", geordnet: false, eintraege: [[a("f")], [a("gh")]] },
    ]),
  ).toBe(8);
});
