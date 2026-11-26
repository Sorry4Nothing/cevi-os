import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
// Meldet die Tabellen aller Lager-Module an
import "../src/routes/lager/index.js";
import { listeLagerTabellen } from "../src/lager/tabellen.js";
import { LAGER_PUSH_TYPEN, PUSH_KANAL } from "../src/push.js";

// Push-Typen und Objekttypen des Lager-Feeds stehen vollständig im Vertrag (#872): Ein neuer Typ im Code ohne Eintrag im Enum und in der Beschreibung des Schemas lässt diesen Test scheitern
type Schema = { enum: string[]; description: string };
const { schemas } = (
  parse(
    readFileSync(
      new URL("../../../docs/api/openapi.yaml", import.meta.url),
      "utf8",
    ),
  ) as { components: { schemas: Record<string, Schema> } }
).components;

function pruefe(name: string, imCode: string[]) {
  const schema = schemas[name]!;
  expect([...schema.enum].sort()).toEqual([...imCode].sort());
  for (const typ of imCode) expect(schema.description).toContain(`\`${typ}\``);
}

describe("Vertrag: Push-Typen und Objekttypen des Feeds", () => {
  test("PushTyp nennt jeden Typ aus PUSH_KANAL und jeden Kanal", () => {
    pruefe("PushTyp", Object.keys(PUSH_KANAL));
    const text =
      schemas.PushTyp!.description + schemas.LagerPushTyp!.description;
    for (const kanal of new Set(Object.values(PUSH_KANAL)))
      expect(text).toContain(`\`${kanal}\``);
  });

  test("LagerPushTyp nennt jeden Push des Lagers", () => {
    pruefe("LagerPushTyp", [...LAGER_PUSH_TYPEN]);
  });

  test("LagerObjekttyp nennt jede angemeldete Lager-Tabelle", () => {
    pruefe(
      "LagerObjekttyp",
      listeLagerTabellen().map(([name]) => name),
    );
  });
});
