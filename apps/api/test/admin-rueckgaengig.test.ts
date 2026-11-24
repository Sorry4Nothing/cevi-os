import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as r from "../public/admin/rueckgaengig.js";

const ordner = new URL("../public/admin/", import.meta.url);
const lies = (datei: string) => readFileSync(new URL(datei, ordner), "utf8");
const jsDateien = readdirSync(ordner).filter((d) => d.endsWith(".js"));

// Eine Uhr von Hand: setTimeout merkt sich Frist und Funktion, fortschritt() lässt Zeit vergehen
function uhr() {
  let jetzt = 0;
  let nr = 0;
  const timer = new Map<number, { zu: number; f: () => void }>();
  return {
    setTimeout: (f: () => void, ms: number) => {
      timer.set(++nr, { zu: jetzt + ms, f });
      return nr;
    },
    clearTimeout: (t: number) => timer.delete(t),
    jetzt: () => jetzt,
    async fortschritt(ms: number) {
      const ziel = jetzt + ms;
      for (;;) {
        const faellig = [...timer.entries()]
          .filter(([, t]) => t.zu <= ziel)
          .sort((a, b) => a[1].zu - b[1].zu)[0];
        if (!faellig) break;
        jetzt = faellig[1].zu;
        timer.delete(faellig[0]);
        faellig[1].f();
        // Die Aktion läuft asynchron: Mikroaufgaben abwarten
        await Promise.resolve();
        await Promise.resolve();
      }
      jetzt = ziel;
    },
  };
}

function aufbau(optionen: Record<string, unknown> = {}) {
  const zeit = uhr();
  const staende: unknown[][] = [];
  const ansagen: string[] = [];
  const verlassen = vi.fn();
  const s = r.erstelleRueckgaengig({
    zeit,
    beiAenderung: (l: unknown[]) => staende.push(l),
    ansage: (t: string) => ansagen.push(t),
    beimVerlassen: verlassen,
    ...optionen,
  });
  return { s, zeit, staende, ansagen, verlassen };
}

describe("rueckgaengig.js: Aktion mit Frist", () => {
  test("die Aktion geht erst nach der Frist raus, nie früher", async () => {
    const { s, zeit } = aufbau();
    const ausfuehren = vi.fn(async () => "ok");
    s.starte({ text: "Seite gelöscht", ausfuehren });
    await zeit.fortschritt(r.FRIST_MS - 1);
    expect(ausfuehren).not.toHaveBeenCalled();
    await zeit.fortschritt(1);
    expect(ausfuehren).toHaveBeenCalledTimes(1);
  });

  test("Rückgängig vor Ablauf: die Anfrage geht nie, die Ansicht kommt zurück", async () => {
    const { s, zeit, ansagen } = aufbau();
    const ausfuehren = vi.fn(async () => {});
    const ansicht = { weg: vi.fn(), zurueck: vi.fn() };
    const hinweis = vi.fn();
    const a = s.starte({
      text: "Stufe gelöscht",
      ausfuehren,
      ansicht,
      rueckgaengig: hinweis,
    });
    // «Sofort anzeigen»: Die Zeile ist schon weg
    expect(ansicht.weg).toHaveBeenCalledTimes(1);
    expect(s.macheRueckgaengig(a)).toBe(true);
    expect(ansicht.zurueck).toHaveBeenCalledTimes(1);
    expect(hinweis).toHaveBeenCalledTimes(1);
    await zeit.fortschritt(r.FRIST_MS * 3);
    expect(ausfuehren).not.toHaveBeenCalled();
    expect(s.liste()).toEqual([]);
    // Zweimal zurücknehmen schadet nicht
    expect(s.macheRueckgaengig(a)).toBe(false);
    expect(ansagen.at(-1)).toMatch(/Rückgängig gemacht: Stufe gelöscht/);
  });

  test("die Statusregion sagt die Aktion und das Rückgängigmachen an", () => {
    const { s, ansagen } = aufbau();
    s.starte({ text: "Seite gelöscht", ausfuehren: async () => {} });
    expect(ansagen[0]).toBe(
      "Seite gelöscht. Rückgängig mit dem Knopf oder mit Strg Z.",
    );
  });

  test("Zeigen und Fokus halten die Frist an; danach läuft der Rest weiter", async () => {
    const { s, zeit } = aufbau();
    const ausfuehren = vi.fn(async () => {});
    const a = s.starte({ text: "x", ausfuehren });
    await zeit.fortschritt(5000);
    s.halte(a);
    expect(a.pausiert).toBe(true);
    await zeit.fortschritt(60000);
    expect(ausfuehren).not.toHaveBeenCalled();
    s.weiter(a);
    await zeit.fortschritt(2999);
    expect(ausfuehren).not.toHaveBeenCalled();
    await zeit.fortschritt(1);
    expect(ausfuehren).toHaveBeenCalledTimes(1);
  });

  test("nach dem Ausführen steht «Erledigt», danach geht der Toast nach 6 Sekunden von selbst", async () => {
    const { s, zeit } = aufbau();
    const danach = vi.fn();
    const a = s.starte({
      text: "Erinnerung gelöscht",
      ausfuehren: async () => 42,
      danach,
    });
    await zeit.fortschritt(r.FRIST_MS);
    expect(a.phase).toBe("erledigt");
    expect(a.text).toBe("Erledigt.");
    expect(danach).toHaveBeenCalledWith(42);
    await zeit.fortschritt(r.ERLEDIGT_MS - 1);
    expect(s.liste()).toHaveLength(1);
    await zeit.fortschritt(1);
    expect(s.liste()).toHaveLength(0);
  });

  test("Fehler beim Ausführen: Ansicht kommt zurück, der Toast nennt den Fehler und bleibt", async () => {
    const { s, zeit, ansagen } = aufbau();
    const ansicht = { weg: vi.fn(), zurueck: vi.fn() };
    const a = s.starte({
      text: "Raum gelöscht",
      ausfuehren: async () => {
        throw new Error("Raum belegt");
      },
      fehlertext: (f: Error) => `Nicht gelöscht. ${f.message}`,
      ansicht,
    });
    await zeit.fortschritt(r.FRIST_MS);
    expect(a.phase).toBe("fehler");
    expect(a.fehlerText).toBe("Nicht gelöscht. Raum belegt");
    expect(ansicht.zurueck).toHaveBeenCalledTimes(1);
    expect(ansagen.at(-1)).toBe("Nicht gelöscht. Raum belegt");
    // Ein Fehler bleibt, bis die Person ihn schliesst
    await zeit.fortschritt(60000);
    expect(s.liste()).toHaveLength(1);
    s.schliesse(a);
    expect(s.liste()).toHaveLength(0);
  });

  test("mehrere Aktionen stapeln sich; die jüngste in der Frist nimmt Strg Z zurück", async () => {
    const { s, zeit } = aufbau();
    const f1 = vi.fn(async () => {});
    const f2 = vi.fn(async () => {});
    s.starte({ text: "eins", ausfuehren: f1 });
    await zeit.fortschritt(1000);
    const zwei = s.starte({ text: "zwei", ausfuehren: f2 });
    expect(s.liste()).toHaveLength(2);
    expect(s.letzte()).toBe(zwei);
    s.macheRueckgaengig(s.letzte());
    await zeit.fortschritt(r.FRIST_MS);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).not.toHaveBeenCalled();
  });

  test("Schliessen in der Frist führt die Aktion sofort aus, nichts wird verworfen", async () => {
    const { s } = aufbau();
    const ausfuehren = vi.fn(async () => {});
    const a = s.starte({ text: "x", ausfuehren });
    await s.schliesse(a);
    expect(ausfuehren).toHaveBeenCalledTimes(1);
  });

  test("pagehide: alle offenen Aktionen laufen sofort, mit keepalive-Merker, genau einmal", async () => {
    const { s, zeit, verlassen } = aufbau();
    const f1 = vi.fn(async () => {});
    const f2 = vi.fn(async () => {});
    s.starte({ text: "eins", ausfuehren: f1 });
    s.starte({ text: "zwei", ausfuehren: f2 });
    await s.alleAusfuehren({ verlassen: true });
    expect(verlassen).toHaveBeenCalledTimes(1);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
    await zeit.fortschritt(r.FRIST_MS * 2);
    expect(f1).toHaveBeenCalledTimes(1);
  });

  test("ohne offene Aktion setzt das Verlassen keinen keepalive-Merker", async () => {
    const { s, verlassen } = aufbau();
    await s.alleAusfuehren({ verlassen: true });
    expect(verlassen).not.toHaveBeenCalled();
  });
});

// Ein kleines DOM, das für zweiStufig genügt
function knopfAttrappe(text: string) {
  const ereignisse = new Map<string, ((e: unknown) => void)[]>();
  const kind = { textContent: text };
  const attribute = new Map<string, string>();
  const klassen = new Set<string>();
  const nachbarn: unknown[] = [];
  const knopf = {
    lastChild: kind,
    dataset: {} as Record<string, string>,
    classList: {
      add: (k: string) => klassen.add(k),
      remove: (k: string) => klassen.delete(k),
    },
    ownerDocument: {
      createElement: () => ({
        className: "",
        textContent: "",
        isConnected: false,
        setAttribute() {},
      }),
    },
    hasAttribute: (n: string) => attribute.has(n),
    getAttribute: (n: string) => attribute.get(n),
    setAttribute: (n: string, w: string) => attribute.set(n, w),
    removeAttribute: (n: string) => attribute.delete(n),
    after: (k: { isConnected: boolean }) => {
      k.isConnected = true;
      nachbarn.push(k);
    },
    addEventListener: (n: string, f: (e: unknown) => void) =>
      ereignisse.set(n, [...(ereignisse.get(n) ?? []), f]),
    klick: () => ereignisse.get("click")?.forEach((f) => f({})),
    taste: (key: string) =>
      ereignisse.get("keydown")?.forEach((f) => f({ key })),
  };
  return { knopf, kind, klassen, attribute, nachbarn };
}

describe("rueckgaengig.js: zweiStufig", () => {
  test("der erste Klick macht scharf, der zweite führt aus, ohne Bestätigung fällt er zurück", async () => {
    const { knopf, kind, klassen, nachbarn } = knopfAttrappe("Senden");
    const uhrwerk = uhr();
    const ausfuehren = vi.fn();
    r.zweiStufig(knopf, {
      frage: "Wirklich senden?",
      ausfuehren,
      zeit: uhrwerk,
    });
    knopf.klick();
    expect(ausfuehren).not.toHaveBeenCalled();
    expect(kind.textContent).toBe("Wirklich senden?");
    expect(klassen.has("knopf--scharf")).toBe(true);
    // Die Frage wird angesagt
    expect((nachbarn[0] as { textContent: string }).textContent).toMatch(
      /Wirklich senden\? Bestätige mit einem zweiten Klick/,
    );
    await uhrwerk.fortschritt(r.SCHARF_MS);
    expect(kind.textContent).toBe("Senden");
    expect(klassen.has("knopf--scharf")).toBe(false);
    knopf.klick();
    knopf.klick();
    expect(ausfuehren).toHaveBeenCalledTimes(1);
    expect(kind.textContent).toBe("Senden");
  });

  test("Escape nimmt die Frage zurück; ein eigenes aria-label wird währenddessen ersetzt", () => {
    const { knopf, kind, attribute } = knopfAttrappe("Aufheben");
    attribute.set("aria-label", "Aufheben: Website");
    r.zweiStufig(knopf, {
      frage: "Wirklich aufheben?",
      ausfuehren: vi.fn(),
      zeit: uhr(),
    });
    knopf.klick();
    expect(attribute.has("aria-label")).toBe(false);
    knopf.taste("Escape");
    expect(kind.textContent).toBe("Aufheben");
    expect(attribute.get("aria-label")).toBe("Aufheben: Website");
  });

  test("im Formular: ändert sich der Schlüssel zwischen den Stufen, gilt der Klick wieder als erster", () => {
    const { knopf } = knopfAttrappe("Senden");
    const z = r.zweiStufig(knopf, { zeit: uhr() });
    const aktion = vi.fn();
    z.verlange("Wirklich an alle senden?", aktion, "a");
    z.verlange("Wirklich an alle senden?", aktion, "b");
    expect(aktion).not.toHaveBeenCalled();
    z.verlange("Wirklich an alle senden?", aktion, "b");
    expect(aktion).toHaveBeenCalledTimes(1);
  });
});

describe("Verwaltung: keine Popups für Rückfragen (#578)", () => {
  test.each(jsDateien.filter((d) => d !== "theme.js"))(
    "%s ruft weder confirm noch alert noch prompt auf",
    (datei) => {
      expect(lies(datei)).not.toMatch(/(?<![\w.])(confirm|alert|prompt)\(/);
    },
  );

  test("bestaetigen gibt es nicht mehr", () => {
    for (const datei of jsDateien) {
      expect(lies(datei), datei).not.toMatch(/\bbestaetigen\(/);
      // Eine lokale Variable gleichen Namens ist kein Import
      expect(lies(datei), datei).not.toMatch(
        /import\s*\{[^}]*\bbestaetigen\b[^}]*\}\s*from\s*"\.\/dom\.js"/,
      );
    }
    expect(lies("dom.js")).not.toContain("export function bestaetigen");
  });

  test("die Rückfragen sind Toasts mit Rückgängig oder zwei Stufen im Fluss", () => {
    // Mit Rückgängig: Löschen, die sich zurücknehmen lassen
    for (const datei of [
      "laedeli.js",
      "personen-blatt.js",
      "stufen.js",
      "tags-detail.js",
      "termine-anlaesse.js",
      "termine-raeume.js",
      "website-stufenfakten.js",
      "website-orte.js",
      "zeitregeln.js",
      "lager-mitglieder.js",
      "lager-vorlagen.js",
      "website-seiten.js",
      "website-medien.js",
      "website-veroeffentlichen.js",
    ]) {
      expect(lies(datei), datei).toMatch(/mitRueckgaengig/);
    }
    // Zwei Stufen: Folge trifft sofort andere oder ist nicht umkehrbar
    for (const datei of [
      "import.js",
      "mitteilungen.js",
      "personen-blatt.js",
      "plattform.js",
      "lager-rechte.js",
      "rechte.js",
      "website-orte.js",
    ]) {
      expect(lies(datei), datei).toMatch(/zweiStufig|zweistufig/);
    }
  });

  test("api.js setzt beim Verlassen keepalive, admin.js führt offene Aktionen bei pagehide und vor dem Abmelden aus", () => {
    expect(lies("api.js")).toContain("keepalive: verlassen || undefined");
    const admin = lies("admin.js");
    expect(admin).toContain('window.addEventListener("pagehide"');
    expect(admin).toContain("alleAusfuehren({ verlassen: true })");
    expect(admin).toMatch(
      /async function abmelden\(\) \{\s*\/\/[^\n]*\n\s*await steuerung\.alleAusfuehren\(\)/,
    );
    expect(admin).toContain("mitRueckgaengig,");
  });

  test("Toast: Region nach dem Kopf, kein Fokusraub, Strg und Cmd Z, F6, Statusregion", () => {
    const rahmen = lies("rahmen.js");
    expect(rahmen).toContain('"aria-label": "Rückgängig"');
    expect(rahmen).toContain('"aria-live": "polite"');
    expect(rahmen).toContain('e.key === "F6"');
    expect(rahmen).toMatch(/e\.ctrlKey \|\| e\.metaKey/);
    // Nie im Eingabefeld: dort gilt das Rückgängig des Feldes
    expect(rahmen).toContain("input, textarea, select");
    // Der Toast bekommt den Fokus nie von selbst
    const toast = rahmen.slice(
      rahmen.indexOf("export function erstelleToasts"),
    );
    expect(toast).not.toMatch(/li\.focus\(|wurzel\.focus\(|k\.li\.focus\(/);
    const admin = lies("admin.js");
    // Im Seitenaufbau der Verwaltung: nach dem Kopf (Leisten), vor dem Inhalt
    const aufbau = admin.slice(admin.indexOf("function zeigeVerwaltung()"));
    expect(aufbau.indexOf("toasts.wurzel")).toBeGreaterThan(
      aufbau.indexOf("leisten.wurzel"),
    );
    expect(aufbau.indexOf("toasts.wurzel")).toBeLessThan(
      aufbau.indexOf('"main"'),
    );
  });

  test("toast.css: Tokens statt Hex-Farben, Balken nur bei erlaubter Bewegung, Fokus sichtbar, Handy über die ganze Breite", () => {
    const css = lies("toast.css");
    const ohneKommentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(ohneKommentar).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain("var(--inverse-surface)");
    expect(css).toContain("var(--inverse-on-surface)");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*toast-frist 8s linear/,
    );
    expect(
      ohneKommentar.replace(
        /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/,
        "",
      ),
    ).not.toMatch(/animation:/);
    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.toasts \{/);
    expect(lies("index.html")).toContain('href="/admin/toast.css"');
    // Die Frist des Balkens ist die der Logik
    expect(r.FRIST_MS).toBe(8000);
  });
});
