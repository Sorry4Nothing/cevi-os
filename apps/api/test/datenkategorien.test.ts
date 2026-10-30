import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import {
  GERAET,
  KATEGORIEN,
  SPALTEN,
  type KategorieId,
} from "../src/datenkategorien.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";

// Tabelle -> Spalten, wie das Drizzle-Schema sie anlegt
const tabellen = Object.fromEntries(
  Object.values(schema)
    .filter((t) => t instanceof PgTable)
    .map((t) => {
      const { name, columns } = getTableConfig(t);
      return [name, columns.map((c) => c.name)];
    }),
);
// Leerraum einheitlich: Prettier bricht die Zeilen der Seite um
const seite = ladeSeiten().datenschutz.replace(/\s+/g, " ");
const ids = Object.keys(KATEGORIEN) as KategorieId[];

describe("Datenkategorien und Schema", () => {
  test("das Schema hat Tabellen", () => {
    expect(Object.keys(tabellen).length).toBeGreaterThan(15);
  });

  test("jede Tabelle des Schemas steht in datenkategorien.ts und umgekehrt", () => {
    expect(Object.keys(SPALTEN).sort()).toEqual(Object.keys(tabellen).sort());
  });

  test.each(Object.keys(tabellen))(
    "%s: jede Spalte hat genau eine Kategorie, und keine Spalte ist erfunden",
    (tabelle) => {
      const eingetragen = Object.values(SPALTEN[tabelle] ?? {}).flat();
      expect([...eingetragen].sort()).toEqual([...tabellen[tabelle]!].sort());
    },
  );

  test("jede Kategorie in SPALTEN und GERAET gibt es", () => {
    const benutzt = [
      ...Object.values(SPALTEN).flatMap((t) => Object.keys(t)),
      ...Object.values(GERAET),
    ];
    for (const id of benutzt) expect(ids).toContain(id);
  });

  test("jede Kategorie hat Spalten oder einen Schlüssel auf dem Gerät", () => {
    const benutzt = new Set([
      ...Object.values(SPALTEN).flatMap((t) => Object.keys(t)),
      ...Object.values(GERAET),
    ]);
    expect([...benutzt].sort()).toEqual([...ids].sort());
  });
});

describe("Datenkategorien und datenschutz.html", () => {
  test.each(ids.filter((id) => id !== "ungenutzt"))(
    "%s: Titel, Zweck und Aufbewahrung stehen in der Erklärung",
    (id) => {
      const k = KATEGORIEN[id];
      expect(seite).toContain(`>${k.titel}<`);
      expect(seite).toContain(k.zweck);
      expect(seite).toContain(k.frist);
    },
  );

  test("die Erklärung hat keine Kategorie, die es nicht gibt", () => {
    const titel = [...seite.matchAll(/<h3 id="k-[^"]+">([^<]+)<\/h3>/g)].map(
      (m) => m[1],
    );
    expect(titel.sort()).toEqual(
      ids
        .filter((id) => id !== "ungenutzt")
        .map((id) => KATEGORIEN[id].titel)
        .sort(),
    );
  });
});

describe("Angaben für die Stores", () => {
  test.each(ids)("%s: apple und google sind Listen", (id) => {
    expect(Array.isArray(KATEGORIEN[id].apple)).toBe(true);
    expect(Array.isArray(KATEGORIEN[id].google)).toBe(true);
  });

  // Wer Namen, Nachrichten oder Telefonnummern bearbeitet, nennt sie im Formular
  test.each<[KategorieId, string]>([
    ["konto", "Name"],
    ["telefon", "Phone"],
    ["kinder", "Name"],
    ["chat", "Messages"],
  ])("%s steht mit %s im Formular beider Stores", (id, wort) => {
    const k = KATEGORIEN[id];
    expect(k.apple.join(" ") + k.google.join(" ")).toContain(wort);
    expect(k.apple.length).toBeGreaterThan(0);
    expect(k.google.length).toBeGreaterThan(0);
  });
});
