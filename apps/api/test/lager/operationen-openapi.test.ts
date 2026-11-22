import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { z } from "zod";
// Meldet die Operationen aller Module an
import "../../src/routes/lager/index.js";
import { listeOperationen } from "../../src/lager/operationen.js";

// Die Liste der Operationen in der OpenAPI-Beschreibung von POST /lager/{id}/aenderungen (#521) kommt aus den Anmeldungen im Code: typ, Recht, Felder der Nutzlast und zusätzliche Ablehnungscodes. Dieser Test erzeugt sie und vergleicht sie mit dem Text zwischen den Markern; eine neue oder geänderte Operation ohne neue Beschreibung lässt ihn scheitern.
// Neu schreiben: OPERATIONEN_SCHREIBEN=1 npx vitest run test/lager/operationen-openapi.test.ts
const DATEI = new URL("../../../../docs/api/openapi.yaml", import.meta.url);
const ANFANG = "<!-- operationen:anfang -->";
const ENDE = "<!-- operationen:ende -->";
const EINZUG = "        ";

function felder(schema: z.ZodType): string[] {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> })
    .shape;
  if (!shape) throw new Error("Die Nutzlast ist kein Objekt");
  return Object.entries(shape).map(([name, feld]) =>
    feld.safeParse(undefined).success ? `\`${name}?\`` : `\`${name}\``,
  );
}

function erzeugeListe() {
  return listeOperationen()
    .map((o) => {
      const fehler = o.fehler?.length
        ? ` Zusätzliche Ablehnungen: ${o.fehler.map((f) => `\`${f}\``).join(", ")}.`
        : "";
      return `- \`${o.typ}\` (Recht \`${o.recht}\`): ${felder(o.schema).join(", ")}.${fehler}`;
    })
    .join("\n");
}

function leseBlock(text: string) {
  const a = text.indexOf(ANFANG);
  const b = text.indexOf(ENDE);
  if (a < 0 || b < a) throw new Error("Marker der Operationen fehlen");
  return {
    a: a + ANFANG.length,
    b,
    inhalt: text
      .slice(a + ANFANG.length, b)
      .split("\n")
      .map((z) => z.replace(EINZUG, ""))
      .join("\n")
      .trim(),
  };
}

describe("OpenAPI: Liste der Warteschlangen-Operationen", () => {
  test("jede angemeldete Operation steht mit Recht und Feldern in der Beschreibung", () => {
    const text = readFileSync(DATEI, "utf8");
    const soll = erzeugeListe();
    if (process.env.OPERATIONEN_SCHREIBEN) {
      const { a, b } = leseBlock(text);
      const neu = soll
        .split("\n")
        .map((z) => `${EINZUG}${z}`)
        .join("\n");
      writeFileSync(
        DATEI,
        `${text.slice(0, a)}\n\n${neu}\n\n${EINZUG}${text.slice(b)}`,
      );
      return;
    }
    expect(leseBlock(text).inhalt).toBe(soll);
  });

  test("die Liste nennt jeden Typ genau einmal und kennt die neuen Module", () => {
    const typen = listeOperationen().map((o) => o.typ);
    expect(new Set(typen).size).toBe(typen.length);
    expect(typen).toEqual(
      expect.arrayContaining([
        "aufgabe.anlegen",
        "checkpunkt.reihenfolge",
        "hoeck.anlegen",
        "hoeck.anwesend",
        "traktandum.reihenfolge",
        "pinnwand.anlegen",
        "beschluss.anlegen",
        "ressort_notiz.anlegen",
        "ressort.reihenfolge",
      ]),
    );
  });
});
