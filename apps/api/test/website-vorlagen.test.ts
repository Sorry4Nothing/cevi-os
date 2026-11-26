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

describe("Vorlage «Anmeldung» (#881)", () => {
  const formular = () => {
    const b = dokumentAusVorlage("anmeldung", "Anmeldung").bausteine[1]!;
    if (b.typ !== "formular") throw new Error("kein Formular");
    return b;
  };

  test("Überschrift und Formular mit den Feldern der früheren Anleitung", () => {
    const dok = dokumentAusVorlage("anmeldung", "Anmeldung");
    expect(dok.bausteine.map((b) => b.typ)).toEqual([
      "ueberschrift",
      "formular",
    ]);
    const felder = formular().daten.felder;
    expect(felder.map((f) => [f.beschriftung, f.typ, f.pflicht])).toEqual([
      ["Vorname", "text", true],
      ["Nachname", "text", true],
      ["Geburtsdatum", "datum", true],
      ["Strasse und Nummer", "text", true],
      ["Postleitzahl", "text", true],
      ["Ort", "text", true],
      ["E-Mail-Adresse", "email", true],
      ["Aktuelle Schulklasse", "auswahl", true],
      ["Notfallkontakt: Name", "text", true],
      ["Notfallkontakt: Telefonnummer", "telefon", true],
      ["Cevi-Name", "text", false],
    ]);
    expect(felder.map((f) => "autocomplete" in f && f.autocomplete)).toEqual([
      "given-name",
      "family-name",
      "bday",
      "street-address",
      "postal-code",
      "address-level2",
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(formular().daten.datenschutz.length).toBeGreaterThan(20);
  });

  test("jeder Aufruf hat neue Feld-IDs", () => {
    const a = formular().daten.felder.map((f) => f.id);
    const b = formular().daten.felder.map((f) => f.id);
    expect(a.filter((x) => b.includes(x))).toEqual([]);
    expect(new Set(a).size).toBe(a.length);
  });
});
