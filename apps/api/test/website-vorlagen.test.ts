import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { adresseAusName } from "../src/website/automatik.js";
import { pruefeDokument, sammleVerweise } from "../src/website/dokument.js";
import { adresseSchema } from "../src/website/seiten.js";
import {
  dokumentAusVorlage,
  VORLAGEN_SCHLUESSEL,
  vorlageBrauchtTag,
  vorlagenInfos,
} from "../src/website/vorlagen.js";

describe("Vorlagen sind gültige Seitendokumente", () => {
  const tagId = randomUUID();
  test.each(VORLAGEN_SCHLUESSEL)("%s besteht pruefeDokument", (vorlage) => {
    const dok = dokumentAusVorlage(vorlage, "Titel", tagId);
    const pruefung = pruefeDokument(dok);
    expect(pruefung.ok, JSON.stringify(pruefung)).toBe(true);
  });

  test("auch ohne Tag, wo die Vorlage keinen braucht", () => {
    for (const vorlage of VORLAGEN_SCHLUESSEL) {
      if (vorlageBrauchtTag(vorlage)) continue;
      expect(pruefeDokument(dokumentAusVorlage(vorlage, "Titel")).ok).toBe(
        true,
      );
    }
  });

  test("die Stufenseite ohne Tag wirft", () => {
    expect(() => dokumentAusVorlage("stufenseite", "Titel")).toThrow();
  });

  test("die Stufenseite verweist nur auf ihren Tag", () => {
    const dok = dokumentAusVorlage("stufenseite", "Titel", tagId);
    expect(sammleVerweise(dok)).toEqual({
      medien: [],
      tags: [tagId],
      personen: [],
      seiten: [],
    });
  });

  test("Baustein-IDs sind bei jedem Aufruf neu", () => {
    const a = dokumentAusVorlage("anlass", "A").bausteine.map((b) => b.id);
    const b = dokumentAusVorlage("anlass", "A").bausteine.map((b) => b.id);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  test("ein langer Titel wird fürs Dokument gekürzt und bleibt gültig", () => {
    const dok = dokumentAusVorlage("textseite", "x".repeat(150));
    expect(dok.titel).toHaveLength(120);
    expect(pruefeDokument(dok).ok).toBe(true);
  });

  test("Platzhalter ohne Namen, Adressen und Zahlen: nur Anleitungen", () => {
    for (const vorlage of VORLAGEN_SCHLUESSEL) {
      const json = JSON.stringify(dokumentAusVorlage(vorlage, "T", tagId));
      // Nur die Texte: Die IDs enthalten Ziffern
      const texte = [...json.matchAll(/"text":"([^"]*)"/g)].map((m) => m[1]);
      expect(texte.join(" ")).not.toMatch(/@|https?:|tel:|\d/);
    }
  });

  test("die Liste nennt Schlüssel, Name, Beschreibung und Tag, nie Bausteine", () => {
    const liste = vorlagenInfos();
    expect(liste.map((v) => v.schluessel)).toEqual([...VORLAGEN_SCHLUESSEL]);
    for (const v of liste) {
      expect(Object.keys(v).sort()).toEqual([
        "beschreibung",
        "brauchtTag",
        "name",
        "schluessel",
      ]);
    }
    expect(liste.find((v) => v.schluessel === "stufenseite")?.brauchtTag).toBe(
      true,
    );
  });
});

describe("Adresse aus dem Namen", () => {
  test.each([
    ["Wölfe", "woelfe"],
    ["Biber Äpfel", "biber-aepfel"],
    ["Pfadi  -  Stufe!", "pfadi-stufe"],
    ["Café Straße", "cafe-strasse"],
    ["  Rover (Team) ", "rover-team"],
    ["!!!", "seite"],
    ["", "seite"],
    ["日本", "seite"],
  ])("%j wird %j", (name, erwartet) => {
    expect(adresseAusName(name)).toBe(erwartet);
  });

  test("höchstens 60 Zeichen, nie mit «-» am Ende, immer gültig", () => {
    for (const name of [
      "a".repeat(100),
      `${"a".repeat(59)} b`,
      "a-".repeat(50),
    ]) {
      const adresse = adresseAusName(name);
      expect(adresse.length).toBeLessThanOrEqual(60);
      expect(adresse).not.toMatch(/-$/);
      expect(adresseSchema.safeParse(adresse).success).toBe(true);
    }
  });
});
