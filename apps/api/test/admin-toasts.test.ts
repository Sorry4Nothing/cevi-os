import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Rückmeldungen nach einer Aktion sind Toasts (#761): `ctx.melde(text, art, aktion)` (oder `melde` aus melden.js). Diese Prüfung hindert daran, dass neue Rückmeldungen als eigene Kästen im Inhalt entstehen.
// Sie zählt je Datei die Elemente mit role="status", role="alert", aria-live und die Klasse «hinweis». Jede Datei darf genau so viele haben, wie hier mit Grund stehen (genau, damit die Liste nicht veraltet).
// Kommt eines dazu: Ist es das Ergebnis einer Aktion, ist es ein Toast. Passt es zu einem Grund unten, trage die neue Zahl samt Grund ein; sonst gehört es nicht in den Inhalt.
// Das Verhalten der Toasts im Browser prüft die Skriptprobe in docs/barrierefreiheit.md, Abschnitt 84.

const WURZEL = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const ORDNER = join(WURZEL, "public", "admin");

// Die erlaubten Fälle; die Zeile je Datei nennt ihre Gründe mit «+» verbunden
const GRUENDE: Record<string, string> = {
  feld: "Fehler direkt am Feld, mit aria-describedby (WCAG 3.3.1)",
  absenden:
    "Fehlerzusammenfassung eines Formulars, Blatts oder Assistenten, der offen bleibt; der Fokus springt hin (WCAG 3.3.1, 3.3.3)",
  zustand:
    "Lade-, Leer- und Fehlerzustand der Ansicht selbst, Zähler und Ergebnis von Suche und Filter",
  dauerhaft:
    "dauerhafter Zustand der Seite: Marke, Banner, Berechtigungs- und Erklärhinweis, Fortschritt eines Vorgangs, Vorschau eines Werts",
  entscheidung:
    "Meldung, die eine Entscheidung verlangt: Versionskonflikt, Rückfrage mit Knöpfen",
  ansage:
    "Live-Region für Screenreader, die etwas sagt, das kein Toast sagt (neue Position, Auswahl, Monatswechsel, Statusregion der Toasts)",
  bauteil:
    "Bauteil oder Beispielseite: die Rolle kommt vom Aufrufer oder zeigt Muster der Design-Seite",
};

// Datei: [role="status", role="alert", aria-live, Klasse hinweis, Gründe]
const ERLAUBT: Record<string, [number, number, number, number, string]> = {
  "admin.js": [1, 1, 0, 2, "absenden+dauerhaft"],
  "aktionen.js": [1, 1, 0, 1, "entscheidung+ansage"],
  "anlass-anmeldungen.js": [3, 1, 0, 1, "zustand+dauerhaft+ansage"],
  "anlass-felder.js": [2, 1, 0, 2, "entscheidung+dauerhaft+absenden+ansage"],
  "anlass-gemeinsam.js": [0, 1, 0, 0, "feld"],
  "anwesenheit.js": [1, 0, 0, 1, "dauerhaft"],
  "befehlspalette.js": [1, 1, 1, 0, "zustand+ansage"],
  "bildwahl.js": [2, 1, 0, 1, "zustand"],
  "cevi-db.js": [1, 0, 0, 1, "dauerhaft"],
  "datumsfeld.js": [0, 1, 1, 0, "feld+ansage"],
  "dom.js": [1, 2, 0, 1, "feld+absenden+zustand"],
  "filterleiste.js": [1, 0, 0, 0, "zustand"],
  "import.js": [3, 1, 0, 4, "absenden+dauerhaft+zustand"],
  "kalenderhilfen.js": [2, 2, 0, 2, "feld+absenden+entscheidung+dauerhaft"],
  "kinder-konto.js": [0, 2, 0, 5, "absenden+dauerhaft"],
  "kinder.js": [1, 2, 0, 4, "absenden+dauerhaft"],
  "komponenten.js": [0, 0, 0, 1, "bauteil"],
  "konto.js": [2, 1, 0, 1, "absenden+dauerhaft"],
  "lader.js": [3, 0, 0, 0, "zustand"],
  "laedeli.js": [2, 2, 0, 2, "dauerhaft+ansage+absenden"],
  "lager-anim.js": [2, 0, 0, 0, "zustand+ansage"],
  "lager-anlegen.js": [1, 2, 0, 3, "absenden+dauerhaft"],
  "lager-aufgaben-detail.js": [2, 0, 0, 0, "dauerhaft"],
  "lager-aufgaben-gemeinsam.js": [1, 1, 0, 2, "entscheidung+dauerhaft"],
  "lager-aufgaben-neu.js": [2, 2, 0, 2, "absenden+zustand"],
  "lager-ausdrucke.js": [2, 0, 0, 1, "dauerhaft"],
  "lager-gemeinsam.js": [0, 1, 0, 0, "feld"],
  "lager-konflikt.js": [0, 1, 0, 1, "entscheidung"],
  "lager-m-abzaehlen.js": [1, 0, 1, 0, "dauerhaft+ansage"],
  "lager-m-adressbuch.js": [0, 1, 0, 2, "feld+dauerhaft"],
  "lager-m-anwesenheit.js": [2, 1, 0, 0, "dauerhaft+entscheidung"],
  "lager-m-aufgaben.js": [3, 0, 0, 1, "zustand+dauerhaft"],
  "lager-m-check.js": [1, 1, 0, 1, "feld+dauerhaft"],
  "lager-m-diensttausch.js": [0, 1, 0, 0, "feld"],
  "lager-m-eingang.js": [1, 1, 0, 3, "absenden+zustand+dauerhaft"],
  "lager-m-einkauf.js": [2, 2, 0, 1, "zustand+feld"],
  "lager-m-fahrten.js": [0, 1, 0, 0, "feld"],
  "lager-m-gruppen.js": [0, 1, 1, 1, "absenden+zustand"],
  "lager-m-heute.js": [1, 0, 0, 1, "dauerhaft"],
  "lager-m-hilfen.js": [0, 0, 0, 1, "entscheidung"],
  "lager-m-hoecks.js": [1, 0, 0, 2, "dauerhaft"],
  "lager-m-packliste.js": [1, 1, 0, 0, "dauerhaft+feld"],
  "lager-m-schichtplan.js": [1, 3, 1, 4, "absenden+feld+dauerhaft+zustand"],
  "lager-m-suche.js": [1, 1, 0, 0, "zustand+absenden"],
  "lager-m-tagesseiten.js": [0, 1, 0, 0, "absenden"],
  "lager-m-teilnehmer.js": [2, 1, 1, 1, "dauerhaft+absenden+zustand"],
  "lager-m-todos.js": [1, 0, 0, 0, "dauerhaft"],
  "lager-m-zeitplan.js": [1, 3, 0, 4, "zustand+absenden+entscheidung"],
  "lager-m-zimmer.js": [0, 1, 0, 0, "feld"],
  "lager-menschen.js": [2, 0, 0, 1, "dauerhaft+absenden"],
  "lager-mitglieder.js": [1, 0, 0, 1, "dauerhaft"],
  "lager-personenwahl.js": [1, 1, 0, 0, "ansage+feld"],
  "lager-rahmen.js": [1, 0, 0, 1, "dauerhaft"],
  "lager-rechte.js": [3, 0, 0, 2, "dauerhaft"],
  "lager-sm-gemeinsam.js": [0, 0, 0, 1, "entscheidung"],
  "lager-status.js": [0, 1, 0, 3, "absenden+dauerhaft"],
  "lager-vorlagen.js": [1, 1, 0, 1, "absenden+dauerhaft"],
  "liste-hilfen.js": [1, 1, 0, 1, "zustand+absenden"],
  "mitteilungen.js": [2, 2, 0, 1, "ansage+zustand+absenden+feld"],
  "ort-suche.js": [1, 0, 1, 0, "ansage"],
  "personen-blatt.js": [1, 1, 0, 1, "absenden+dauerhaft"],
  "personen-wahl.js": [3, 0, 0, 0, "dauerhaft+ansage"],
  "personen.js": [1, 1, 0, 1, "zustand+feld"],
  "plattform.js": [1, 1, 0, 1, "dauerhaft+feld"],
  "protokoll.js": [2, 0, 0, 0, "zustand"],
  "raeume-meine.js": [0, 1, 0, 1, "absenden"],
  "rahmen.js": [1, 0, 1, 0, "ansage (Statusregion der Toasts)"],
  "rechte-gemeinsam.js": [0, 1, 0, 1, "entscheidung"],
  "rechte-gruppen.js": [1, 1, 0, 0, "zustand+feld"],
  "rechte-matrix.js": [2, 0, 0, 0, "ansage+zustand"],
  "rechte-rolle.js": [0, 1, 0, 1, "absenden"],
  "rechte-rollen.js": [0, 0, 0, 1, "dauerhaft"],
  "rechte-uebersicht.js": [2, 2, 2, 6, "zustand+dauerhaft"],
  "rechte.js": [1, 0, 0, 1, "dauerhaft"],
  "schrittfolge.js": [1, 0, 0, 1, "dauerhaft"],
  "sortieren.js": [1, 0, 0, 0, "ansage"],
  "stufen.js": [1, 0, 0, 0, "zustand"],
  "system.js": [2, 0, 0, 3, "dauerhaft+zustand"],
  "tags-detail.js": [2, 0, 0, 0, "zustand"],
  "tags-raeume.js": [1, 1, 0, 1, "zustand"],
  "termine-anfragen.js": [2, 0, 0, 1, "dauerhaft"],
  "termine-anlaesse.js": [1, 1, 0, 1, "dauerhaft+feld"],
  "termine-belegung.js": [3, 0, 1, 4, "zustand+dauerhaft+ansage"],
  "termine-kalender.js": [1, 1, 0, 1, "dauerhaft+zustand"],
  "termine-kategorien.js": [1, 0, 0, 1, "dauerhaft"],
  "termine-monat.js": [2, 1, 1, 2, "ansage+zustand+dauerhaft"],
  "termine-outlook.js": [1, 0, 0, 0, "dauerhaft"],
  "termine-raeume.js": [1, 1, 0, 1, "dauerhaft+absenden"],
  "termine-vorschlaege.js": [3, 0, 0, 2, "zustand+dauerhaft"],
  "termine-warnliste.js": [3, 0, 0, 1, "dauerhaft+zustand"],
  "uebersicht-diagramme.js": [0, 0, 1, 0, "ansage"],
  "uebersicht-kacheln.js": [3, 0, 0, 1, "zustand"],
  "uebersicht-kommend.js": [4, 0, 0, 0, "zustand"],
  "uebersicht-verlauf.js": [0, 0, 1, 0, "ansage"],
  "uebersicht.js": [1, 0, 0, 0, "dauerhaft"],
  "website-baumansicht.js": [1, 0, 0, 0, "ansage"],
  "website-bausteine.js": [4, 1, 0, 1, "zustand+absenden"],
  "website-dialoge.js": [0, 0, 0, 1, "bauteil"],
  "website-editor.js": [
    3,
    5,
    0,
    3,
    "dauerhaft+zustand+absenden+entscheidung+ansage",
  ],
  "website-einstellungen.js": [1, 0, 0, 0, "dauerhaft"],
  "website-felder-dynamisch.js": [2, 2, 0, 0, "zustand"],
  "website-felder.js": [3, 2, 0, 0, "zustand+dauerhaft"],
  "website-medien.js": [3, 0, 0, 0, "zustand+dauerhaft"],
  "website-orte.js": [1, 0, 0, 1, "dauerhaft"],
  "website-seiten.js": [3, 0, 0, 0, "zustand+dauerhaft"],
  "website-sichtbarkeit.js": [2, 0, 0, 0, "zustand"],
  "website-stufenfakten.js": [0, 1, 0, 0, "feld"],
  "website-veroeffentlichen.js": [1, 0, 0, 0, "zustand"],
  "website-vorschau.js": [2, 1, 0, 0, "zustand"],
  "zeitregeln.js": [1, 0, 0, 0, "zustand"],
  "zuschneiden.js": [1, 1, 0, 1, "ansage+absenden"],
  "zustaende.js": [1, 2, 0, 0, "zustand"],
  "zweiter-faktor-einrichten.js": [0, 2, 0, 2, "absenden+dauerhaft"],
};

const ohneKommentare = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, "$1");

const MUSTER = [
  /role:\s*["']status["']/g,
  /role:\s*["']alert["']/g,
  /aria-live/g,
  /class:\s*[`"'][^`"']*\bhinweis\b/g,
];

const dateien = readdirSync(ORDNER)
  .filter((n) => n.endsWith(".js"))
  .map((name) => {
    const text = ohneKommentare(readFileSync(join(ORDNER, name), "utf8"));
    return {
      name,
      zahlen: MUSTER.map((m) => (text.match(m) ?? []).length),
    };
  });

describe("Rückmeldungen als Toast", () => {
  test("die Prüfung sieht die Dateien der Verwaltung", () => {
    expect(dateien.length).toBeGreaterThan(100);
    expect(dateien.some((d) => d.name === "rahmen.js")).toBe(true);
  });

  test("keine neuen Rückmeldungs-Kästen: Zahl je Datei wie in der Liste", () => {
    const abweichungen = dateien.flatMap((d) => {
      const soll = ERLAUBT[d.name]?.slice(0, 4) ?? [0, 0, 0, 0];
      return d.zahlen.every((n, i) => n === soll[i])
        ? []
        : [`${d.name}: ${d.zahlen.join("/")} statt ${soll.join("/")}`];
    });
    expect(
      abweichungen,
      "Ergebnis einer Aktion? Dann ctx.melde(...). Sonst die Zahl samt Grund in ERLAUBT eintragen (status/alert/aria-live/hinweis).",
    ).toEqual([]);
  });

  test("jede Datei der Liste gibt es, jeder Grund ist bekannt", () => {
    const namen = new Set(dateien.map((d) => d.name));
    for (const [datei, eintrag] of Object.entries(ERLAUBT)) {
      expect(namen.has(datei), datei).toBe(true);
      // Das erste Wort jedes Teils vor «+» ist ein Grund aus der Liste
      for (const teil of eintrag[4].split("+"))
        expect(Object.keys(GRUENDE), `${datei}: ${teil}`).toContain(
          teil.trim().split(" ")[0],
        );
    }
  });

  test("die Rückmeldung ist ein Toast: eine Region, Fehler als alert, sonst höflich, Esc und Schliessen-Knopf", () => {
    const rahmen = ohneKommentare(
      readFileSync(join(ORDNER, "rahmen.js"), "utf8"),
    );
    expect(rahmen).toContain("export function erstelleToasts");
    expect(rahmen).not.toContain("erstelleRueckmeldungen");
    expect(rahmen).toContain('role: art === "fehler" ? "alert" : undefined');
    expect(rahmen).toContain('if (art !== "fehler") sage(text)');
    expect(rahmen).toContain("Hinweis schliessen");
    expect(rahmen).toContain('e.key === "Escape"');
    expect(rahmen).toContain("TOAST_MAX");
    const admin = readFileSync(join(ORDNER, "admin.js"), "utf8");
    expect(admin).toContain("toasts.melde(text, art, aktion)");
    // Es gibt keine zweite Region mit Rückmeldungen im Inhalt
    expect(admin).not.toContain("rueckmeldung");
  });

  test("Zeiten: Erfolg und Info 4 Sekunden, Warnung und Fehler 8 Sekunden", () => {
    const rahmen = readFileSync(join(ORDNER, "rahmen.js"), "utf8");
    expect(rahmen).toContain("OK_MS = 4000");
    expect(rahmen).toContain("FEHLER_MS = 8000");
  });
});
