import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as nav from "../public/admin/navigation.js";

// Verwaltung «Website, Fotos» (#690): Anmeldung im Gerüst, Zugang nur mit dem Recht, keine Popups und kein innerHTML
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");
const js = lies("website-fotos.js");

describe("Verwaltung der Fotos", () => {
  test("steht in der Navigation unter «Website», sichtbar nur mit dem Recht", () => {
    const website = nav.BEREICHE.find(
      (b: { schluessel: string }) => b.schluessel === "website",
    )!;
    const fotos = website.unter.find(
      (u: { schluessel: string }) => u.schluessel === "fotos",
    )!;
    expect(fotos.modul).toBe("./website-fotos.js");
    expect(fotos.zugang).toBe("recht:fotos.verwalten");
    const person = (rechte: string[], admin = false) => ({
      istAdmin: admin,
      zugang: { bereiche: [], rechte: [], katalogRechte: rechte },
    });
    expect(nav.darfSehen(fotos, person(["fotos.verwalten"]))).toBe(true);
    expect(nav.darfSehen(fotos, person(["laden.ansehen"]))).toBe(false);
    expect(nav.darfSehen(fotos, person([]))).toBe(false);
    expect(nav.darfSehen(fotos, person([], true))).toBe(true);
  });

  test("index.html bindet den Stil ein", () => {
    expect(lies("index.html")).toContain('href="/admin/website-fotos.css"');
  });

  test("kein innerHTML, keine Popups, nur die eigene Verwaltungs-API", () => {
    for (const verboten of [
      "innerHTML",
      "alert(",
      "confirm(",
      "prompt(",
      "localStorage",
      "<select",
    ]) {
      expect(js, verboten).not.toContain(verboten);
    }
    expect(js).toContain('const API = "/api/v1/admin/fotos"');
    expect(js).not.toMatch(/["'`]https?:\/\//);
  });

  test("Zustände und Bedienung: Schalter mit Wort, Reihenfolge per Liste mit Alternative, Rückgängig, Anleitung ohne Werte", () => {
    for (const text of [
      'role: "switch"',
      "sortierListe",
      "Rückgängig",
      "Verbindung testen",
      "Fotos einrichten",
      "FLICKR_API_KEY",
      "Nicht sichtbar",
      "VERSION_KONFLIKT",
    ]) {
      expect(js, text).toContain(text);
    }
    // In der Anleitung stehen nur Namen: kein Wert, der wie ein Schlüssel aussieht
    expect(js).not.toMatch(/[0-9a-f]{32}/);
  });

  test("der Baustein «Fotoalben» steht im Editor", () => {
    const felder = lies("website-felder.js");
    expect(felder).toContain('typ: "fotoalben"');
    expect(felder).toContain("fotoalben: {");
    expect(felder).toContain("#website/fotos");
  });
});
