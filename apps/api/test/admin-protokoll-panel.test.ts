import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { bereichVon } from "../src/aktivitaet-middleware.js";
import { AKTIVITAET_KATALOG } from "../src/aktivitaet-titel.js";
// @ts-expect-error: Skript ohne Typen
import { GRUPPEN as API_GRUPPEN } from "../scripts/aktivitaet-titel-erzeugen.mjs";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as liste from "../public/admin/protokoll-text.js";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import { BEREICHE, darfSehen } from "../public/admin/navigation.js";

// Die Seite «Protokoll» der Verwaltung (#637, #662): Einbindung, Sichtbarkeit nur für den Entwickler, reine Logik der Zeitleiste, Kurzformen für Felder, Rechte und Vorher/Nachher
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");
const DATEIEN = [
  "protokoll.js",
  "protokoll-liste.js",
  "protokoll-text.js",
  "protokoll.css",
];

describe("Einbindung und Zugang", () => {
  const eintrag = BEREICHE.find(
    (b: { schluessel: string }) => b.schluessel === "system",
  ).unter.find((u: { schluessel: string }) => u.schluessel === "protokoll");

  test("Seite und Stile sind eingebunden", () => {
    expect(eintrag.modul).toBe("./protokoll.js");
    expect(lies("index.html")).toContain('href="/admin/protokoll.css"');
  });

  test("sichtbar nur für den Entwickler: nicht für die Abteilungsleitung, nicht für andere Rollen", () => {
    expect(eintrag.zugang).toBe("entwickler");
    expect(darfSehen(eintrag, { istAdmin: true, entwickler: false })).toBe(
      false,
    );
    expect(
      darfSehen(eintrag, {
        istAdmin: false,
        zugang: { bereiche: ["website", "plattform"], rechte: [] },
      }),
    ).toBe(false);
    expect(darfSehen(eintrag, { istAdmin: true, entwickler: true })).toBe(true);
  });
});

describe("Quelltext", () => {
  const alle = DATEIEN.slice(0, 3).map(lies).join("\n");

  test("sie ruft nur die Routen des Protokolls auf", () => {
    expect(alle).toContain("/api/v1/admin/protokoll");
    expect(alle).toContain("/verlauf");
    expect(alle).toContain("/export.csv");
    expect(alle).not.toMatch(/\/api\/v1\/(?!admin\/protokoll)/);
  });

  test("sie fragt nach Änderungen: kein Filter «Ergebnis», nur die Parameter der API", () => {
    expect(alle).not.toMatch(/ergebnis/i);
    expect(alle).toContain('art: "sicherheit"');
    expect(alle).toContain("gruppe");
  });

  test("kein Popup, kein Polling, keine Inline-Stile, keine Farbwerte, kein HTML aus Daten", () => {
    expect(alle).not.toMatch(
      /\balert\(|\bconfirm\(|\bprompt\(|setInterval|\.style\b|setAttribute\("style"|<dialog|innerHTML/,
    );
    expect(lies("protokoll.css")).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });

  test("Bewegung nur unter prefers-reduced-motion: no-preference", () => {
    const css = lies("protokoll.css");
    const ausserhalb = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g,
      "",
    );
    expect(ausserhalb).not.toMatch(/transition|animation/);
  });
});

describe("Zeitleiste (reine Funktionen)", () => {
  const jetzt = new Date("2026-11-23T12:00:00Z");

  test("relative Zeit: eben, Minuten, Stunden, sonst die Uhrzeit", () => {
    const vor = (s: number) =>
      liste.relativ(
        new Date(jetzt.getTime() - s * 1000).toISOString(),
        jetzt.getTime(),
      );
    expect(vor(10)).toBe("gerade eben");
    expect(vor(5 * 60)).toMatch(/5 Minuten/);
    expect(vor(3 * 3600)).toMatch(/3 Stunden/);
    expect(vor(30 * 3600)).toMatch(/^\d{2}:\d{2}$/);
  });

  test("Tageskopf: Heute, Gestern, sonst Wochentag und Datum in Schweizer Zeit", () => {
    expect(liste.tagText("2026-11-23T08:00:00Z", jetzt)).toBe("Heute");
    expect(liste.tagText("2026-11-22T08:00:00Z", jetzt)).toBe("Gestern");
    expect(liste.tagText("2026-11-01T08:00:00Z", jetzt)).toMatch(
      /Sonntag, 1\. November 2026/,
    );
    // 23:30 UTC ist in Zürich schon der nächste Tag
    expect(liste.tagSchluessel("2026-11-22T23:30:00Z")).toBe("2026-11-23");
  });

  test("Wer: Name, sonst die Art des Akteurs", () => {
    const eintrag = (benutzer: object) => ({ benutzer });
    expect(liste.wer(eintrag({ name: "Muster", akteur: "person" }))).toBe(
      "Muster",
    );
    expect(liste.wer(eintrag({ name: null, akteur: "anonym" }))).toBe(
      "Nicht angemeldet",
    );
    expect(liste.wer(eintrag({ name: null, akteur: "cli" }))).toBe(
      "Kommandozeile",
    );
    expect(liste.wer(eintrag({ name: null, akteur: "system" }))).toBe("System");
  });
});

describe("Änderungsprotokoll (reine Funktionen)", () => {
  test("die Gruppen der Aktion sind die der API, jede mit Wort und Symbol", () => {
    expect(Object.keys(liste.GRUPPEN)).toEqual(API_GRUPPEN);
    for (const [wort, symbol] of Object.values(liste.GRUPPEN) as string[][]) {
      expect(wort).toMatch(/^\p{Lu}/u);
      expect(symbol).toMatch(/^[a-z]+$/);
    }
    expect(liste.GRUPPEN_OPTIONEN[0]).toEqual(["", "Alle Aktionen"]);
    expect(liste.GRUPPEN_OPTIONEN).toHaveLength(API_GRUPPEN.length + 1);
  });

  test("Marke: Gruppe der Aktion, bei System und Sicherheit die Art", () => {
    expect(liste.gruppeInfo({ art: "aktion", gruppe: "geloescht" })[0]).toBe(
      "Gelöscht",
    );
    expect(liste.gruppeInfo({ art: "aktion", gruppe: "geloescht" })[2]).toBe(
      "warn",
    );
    expect(liste.gruppeInfo({ art: "sicherheit", gruppe: null })[0]).toBe(
      "Sicherheit",
    );
    expect(liste.gruppeInfo({ art: "system", gruppe: null })[0]).toBe(
      "Ereignis",
    );
    expect(liste.gruppeInfo({ art: "audit", gruppe: null })[0]).toBe(
      "Änderung",
    );
  });

  test("jeder Bereich der Routen hat ein deutsches Wort", () => {
    for (const [schluessel, e] of Object.entries(AKTIVITAET_KATALOG)) {
      if ((e as { nicht?: string }).nicht) continue;
      const route = schluessel.split(" ")[1]!.replace(/:p/g, ":id");
      const bereich = bereichVon(route);
      expect(liste.BEREICHE, schluessel).toHaveProperty(bereich);
    }
    expect(liste.bereichText("laden")).toBe("Lädeli");
    expect(liste.bereichText("gibtsnicht")).toBe("gibtsnicht");
  });

  test("Felder: höchstens vier als Chips, der Rest als Zahl", () => {
    expect(liste.feldChips(["a", "b"])).toEqual({
      sichtbar: ["a", "b"],
      rest: 0,
    });
    expect(liste.feldChips(["a", "b", "c", "d", "e", "f"])).toEqual({
      sichtbar: ["a", "b", "c", "d"],
      rest: 2,
    });
    expect(liste.feldChips(null)).toEqual({ sichtbar: [], rest: 0 });
  });

  test("Rechte: neu, entzogen und mit anderer Geltung getrennt; Kurzform mit Zahlen", () => {
    const a = {
      hinzu: ["seiten.bearbeiten", "seiten.veroeffentlichen"],
      weg: ["seiten.bearbeiten", "raum.verwalten"],
    };
    expect(liste.rechteAenderung(a)).toEqual({
      neu: ["seiten.veroeffentlichen"],
      entzogen: ["raum.verwalten"],
      geaendert: ["seiten.bearbeiten"],
    });
    expect(liste.rechteKurz(a)).toBe(
      "+1 Recht, −1 Recht, 1 Recht mit anderer Geltung",
    );
    expect(liste.rechteKurz({ hinzu: ["a", "b"] })).toBe("+2 Rechte");
    expect(liste.rechteKurz(null)).toBe("");
  });

  test("Vorher und nachher: je Feld, Kurzform mit Pfeil, Ja und Nein", () => {
    const a = {
      vorher: { status: "aktiv", verfuegbar: true },
      nachher: { status: "inaktiv", verfuegbar: false, neu: 3 },
    };
    expect(liste.wechsel(a)).toEqual([
      { feld: "neu", vorher: "", nachher: "3" },
      { feld: "status", vorher: "aktiv", nachher: "inaktiv" },
      { feld: "verfuegbar", vorher: "ja", nachher: "nein" },
    ]);
    expect(liste.wechselKurz(a)).toEqual(["neu: 3", "status: aktiv → inaktiv"]);
    expect(liste.wechsel(null)).toEqual([]);
  });

  test("weitere Angaben tragen lesbare Namen", () => {
    expect(liste.schluesselText("umbenannt")).toBe("Umbenannt");
    expect(liste.schluesselText("anlassId")).toBe("Anlass id");
    expect(
      liste.werteListe({ werte: { umbenannt: false, anzahl: 3 } }),
    ).toEqual([
      ["Umbenannt", "nein"],
      ["Anzahl", "3"],
    ]);
  });

  test("Objekt und Elternobjekt: Typ mit Namen in «»", () => {
    expect(liste.objektText({ typ: "rollen", name: "Kasse" })).toBe(
      "Rolle «Kasse»",
    );
    expect(liste.objektText({ typ: "personen", name: null })).toBe("Person");
    expect(liste.objektText(null)).toBe("");
    expect(
      liste.elternText({ eltern: { typ: "gruppen", name: "OK Kirmes" } }),
    ).toBe("Gruppe «OK Kirmes»");
    expect(liste.elternText({ eltern: { typ: "gruppen" } })).toBe("");
  });

  test("Sicherheit: Wort der Marke und Zahl der Ereignisse", () => {
    expect(liste.sicherheitStatus({ status: 401 })).toBe("Fehlgeschlagen");
    expect(liste.sicherheitStatus({ status: 429 })).toBe("Begrenzt");
    expect(liste.malText({ anzahl: 4 })).toBe("4-mal");
    expect(liste.malText({ anzahl: 1 })).toBe("");
  });

  test("Quelle ohne Anfrage: System und Kommandozeile", () => {
    expect(liste.quelleText({ art: "system", benutzer: {} })).toBe(
      "Von selbst, ohne Person",
    );
    expect(
      liste.quelleText({ art: "audit", benutzer: { akteur: "cli" } }),
    ).toBe("Über die Kommandozeile");
    expect(
      liste.quelleText({ art: "aktion", benutzer: { akteur: "person" } }),
    ).toBe("");
  });
});
