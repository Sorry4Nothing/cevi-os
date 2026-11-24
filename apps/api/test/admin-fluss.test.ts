import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";

// Seiten im Fluss statt Dialoge (#578): fluss.js und die Umbauten in dom.js, website-dialoge.js und admin.js.
// Die Module sind Browser-Module ohne Typen; das Verhalten läuft hier in einer kleinen Umgebung mit Attrappen für Dokument, Verlauf und Fenster.

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");
const FLUSS = lies("fluss.js");

type Handler = (e: unknown) => void;

class Knoten {
  hidden = false;
  className = "";
  textContent = "";
  type = "";
  verbunden = true;
  kinder: Knoten[] = [];
  attr = new Map<string, string>();
  handler = new Map<string, Handler[]>();
  klassen = new Set<string>();
  classList = {
    toggle: (n: string, an: boolean) =>
      an ? this.klassen.add(n) : this.klassen.delete(n),
    add: (n: string) => this.klassen.add(n),
    remove: (n: string) => this.klassen.delete(n),
    contains: (n: string) => this.klassen.has(n),
  };
  fokus = 0;
  addEventListener(art: string, f: Handler) {
    this.handler.set(art, [...(this.handler.get(art) ?? []), f]);
  }
  dispatchEvent(e: { type: string }) {
    for (const f of this.handler.get(e.type) ?? []) f(e);
  }
  append(...k: Knoten[]) {
    this.kinder.push(...k);
  }
  before(k: Knoten) {
    this.kinder.push(k);
  }
  remove() {
    this.verbunden = false;
  }
  setAttribute(n: string, w: string) {
    this.attr.set(n, w);
  }
  querySelector(wahl: string) {
    // Die Frage («.fluss-frage») steht nach dem Anzeigen unter den Kindern der Seite
    if (wahl === ".fluss-frage") {
      return (
        this.kinder.find(
          (k) => k.verbunden && k.className.includes("fluss-frage"),
        ) ?? null
      );
    }
    return null;
  }
  contains() {
    return false;
  }
  focus() {
    this.fokus++;
  }
  click() {
    for (const f of this.handler.get("click") ?? []) f({});
  }
}

function umgebung() {
  const fenster = new Map<string, Handler[]>();
  const dokument = new Map<string, Handler[]>();
  const bereich = new Knoten();
  const seitenkopf = new Knoten();
  const verlauf = {
    state: null as unknown,
    pushes: [] as unknown[],
    zurueck: 0,
    pushState(s: unknown) {
      this.state = s;
      this.pushes.push(s);
    },
    replaceState(s: unknown) {
      this.state = s;
    },
    back() {
      this.zurueck++;
    },
    go() {},
  };
  const location = {
    hash: "#personen",
    href: "http://x/admin#personen",
    pathname: "/admin",
    search: "",
  };
  // Der Wächter (ungespeichert.js, #699) ist hier eine Attrappe: Sie hält, was fluss.js anmeldet, und merkt Wechsel
  const waechter = [] as {
    geaendert: () => boolean;
    innerhalb: (h: string) => boolean;
    frage: (ziel: string) => void;
  }[];
  const gewechselt: string[] = [];
  const sandbox = {
    schuetze: (o: (typeof waechter)[number]) => waechter.push(o),
    wechsle: (z: string) => gewechselt.push(z),
    Date,
    Event: class {
      constructor(public type: string) {}
    },
    window: {
      history: verlauf,
      scrollY: 120,
      scrollTo: () => {},
      matchMedia: () => ({ matches: false }),
      addEventListener: (a: string, f: Handler) =>
        fenster.set(a, [...(fenster.get(a) ?? []), f]),
    },
    document: {
      body: bereich,
      getElementById: (id: string) =>
        id === "bereich" ? bereich : id === "seitenkopf" ? seitenkopf : null,
      createElement: () => new Knoten(),
      querySelector: () => null,
      addEventListener: (a: string, f: Handler) =>
        dokument.set(a, [...(dokument.get(a) ?? []), f]),
    },
    location,
  };
  const api = runInNewContext(
    `${FLUSS.replace(/^import .*$/gm, "").replace(/^export /gm, "")}\n;({ oeffneFluss, schliesseAlle, flussOffen, nachVerlauf })`,
    sandbox,
  ) as {
    oeffneFluss: (w: Knoten, o?: { panel?: boolean }) => { id: string };
    schliesseAlle: () => void;
    flussOffen: () => boolean;
    nachVerlauf: (f: () => void) => void;
  };
  const popstate = (state: unknown) => {
    verlauf.state = state;
    for (const f of fenster.get("popstate") ?? []) f({ state });
  };
  // Eine Seite, die wie die aus dom.js close(), versuchSchliessen() und open bekommt
  const neueSeite = () => new Knoten() as Knoten & Record<string, unknown>;
  return {
    api,
    bereich,
    seitenkopf,
    verlauf,
    popstate,
    fenster,
    location,
    neueSeite,
    waechter,
    gewechselt,
  };
}

describe("Seiten im Fluss (fluss.js)", () => {
  test("Öffnen legt einen Verlaufseintrag an und ersetzt die Ansicht: Kopf und Inhalt darunter weichen", () => {
    const u = umgebung();
    const s = u.neueSeite();
    const e = u.api.oeffneFluss(s);
    expect(u.verlauf.pushes).toEqual([{ fluss: e.id }]);
    expect(u.bereich.klassen.has("fluss-offen")).toBe(true);
    expect(u.seitenkopf.klassen.has("fluss-weg")).toBe(true);
    expect(u.api.flussOffen()).toBe(true);
    expect(s.open).toBe(true);
  });

  test("close() schliesst sofort, meldet «close» und geht im Verlauf genau einen Schritt zurück", () => {
    const u = umgebung();
    const s = u.neueSeite();
    let geschlossen = 0;
    s.addEventListener("close", () => geschlossen++);
    u.api.oeffneFluss(s);
    (s.close as () => void)();
    expect(geschlossen).toBe(1);
    expect(s.verbunden).toBe(false);
    expect(u.bereich.klassen.has("fluss-offen")).toBe(false);
    expect(u.seitenkopf.klassen.has("fluss-weg")).toBe(false);
    expect(u.verlauf.zurueck).toBe(1);
    // Das popstate unseres eigenen back() schliesst nichts weiter
    const zweite = u.neueSeite();
    u.api.oeffneFluss(zweite);
    u.popstate(null);
    expect(zweite.verbunden).toBe(true);
    expect(u.api.flussOffen()).toBe(true);
  });

  test("Browser-Zurück schliesst die Seite, ohne den Verlauf noch einmal anzufassen", () => {
    const u = umgebung();
    const s = u.neueSeite();
    u.api.oeffneFluss(s);
    u.popstate({ von: null });
    expect(s.verbunden).toBe(false);
    expect(u.verlauf.zurueck).toBe(0);
    expect(u.api.flussOffen()).toBe(false);
  });

  test("mit Eingaben fragt Browser-Zurück erst: Die Seite bleibt, ihr Eintrag kommt zurück, die Frage steht", () => {
    const u = umgebung();
    const s = u.neueSeite();
    const e = u.api.oeffneFluss(s);
    s.dispatchEvent({ type: "input" });
    u.popstate({ von: null });
    expect(s.verbunden).toBe(true);
    expect(u.verlauf.pushes).toHaveLength(2);
    expect(u.verlauf.pushes[1]).toEqual({ fluss: e.id });
    const frage = s.kinder.find((k) => k.className.includes("fluss-frage"));
    expect(frage?.attr.get("role")).toBe("alert");
    // Zweistufig: «Weiter bearbeiten» schliesst die Frage, «Verwerfen» die Seite
    const [, weiter, verwerfen] = frage!.kinder;
    weiter!.click();
    expect(frage!.verbunden).toBe(false);
    (s.versuchSchliessen as () => void)();
    const frage2 = s.kinder
      .filter((k) => k.className.includes("fluss-frage"))
      .at(-1)!;
    frage2.kinder[2]!.click();
    expect(s.verbunden).toBe(false);
    expect(verwerfen).toBeDefined();
  });

  test("ohne Eingaben schliesst versuchSchliessen() ohne Frage; mit Eingaben nicht, bis die Person verwirft", () => {
    const u = umgebung();
    const sauber = u.neueSeite();
    u.api.oeffneFluss(sauber);
    (sauber.versuchSchliessen as () => void)();
    expect(sauber.verbunden).toBe(false);
    const schmutzig = u.neueSeite();
    u.api.oeffneFluss(schmutzig);
    schmutzig.dispatchEvent({ type: "change" });
    (schmutzig.versuchSchliessen as () => void)();
    expect(schmutzig.verbunden).toBe(true);
  });

  test("der Wächter (Tab schliessen, Menü, Zurück) meldet nur ungespeicherte Eingaben", () => {
    const u = umgebung();
    const s = u.neueSeite();
    u.api.oeffneFluss(s);
    const [w] = u.waechter;
    expect(w!.geaendert()).toBe(false);
    s.dispatchEvent({ type: "input" });
    expect(w!.geaendert()).toBe(true);
    // Dieselbe Adresse der Seite ist kein Verlassen, jede andere schon
    expect(w!.innerhalb("#personen")).toBe(true);
    expect(w!.innerhalb("#termine")).toBe(false);
  });

  test("zu einer anderen Adresse ohne Eingaben schliesst alles ohne Frage; die Seite gehört zur alten Ansicht", () => {
    const u = umgebung();
    const s = u.neueSeite();
    u.api.oeffneFluss(s);
    u.location.hash = "#termine";
    u.popstate({ von: "#personen" });
    expect(s.verbunden).toBe(false);
  });

  test("Sprung im Verlauf zu einer anderen Adresse mit Eingaben: die Seite bleibt, die Frage steht, «Verwerfen» führt zum Ziel", () => {
    const u = umgebung();
    const s = u.neueSeite();
    const e = u.api.oeffneFluss(s);
    s.dispatchEvent({ type: "input" });
    u.location.hash = "#termine";
    u.popstate({ von: "#personen" });
    expect(s.verbunden).toBe(true);
    expect(u.verlauf.state).toEqual({ fluss: e.id });
    const frage = s.kinder.find((k) => k.className.includes("fluss-frage"));
    expect(frage?.attr.get("role")).toBe("alert");
    frage!.kinder[2]!.click();
    expect(s.verbunden).toBe(false);
    // Das Ziel folgt, sobald der Verlauf zurück ist
    u.popstate({ von: "#personen" });
    expect(u.gewechselt).toEqual(["#termine"]);
  });

  test("schliesseAlle() räumt auf, ohne den Verlauf anzufassen (die Navigation hat ihn schon gewechselt)", () => {
    const u = umgebung();
    const a = u.neueSeite();
    const b = u.neueSeite();
    u.api.oeffneFluss(a);
    u.api.oeffneFluss(b);
    u.api.schliesseAlle();
    expect([a.verbunden, b.verbunden]).toEqual([false, false]);
    expect(u.verlauf.zurueck).toBe(0);
    expect(u.bereich.klassen.has("fluss-offen")).toBe(false);
  });

  test("zwei Seiten übereinander: nur die oberste ist sichtbar, nach dem Schliessen die darunter", () => {
    const u = umgebung();
    const a = u.neueSeite();
    const b = u.neueSeite();
    u.api.oeffneFluss(a);
    u.api.oeffneFluss(b);
    expect([a.hidden, b.hidden]).toEqual([true, false]);
    (b.close as () => void)();
    expect(a.hidden).toBe(false);
    expect(u.bereich.klassen.has("fluss-offen")).toBe(true);
  });

  test("nachVerlauf() wartet auf das eigene back(), bevor die Adresse geändert wird", () => {
    const u = umgebung();
    const s = u.neueSeite();
    u.api.oeffneFluss(s);
    (s.close as () => void)();
    const reihenfolge: string[] = [];
    u.api.nachVerlauf(() => reihenfolge.push("adresse"));
    expect(reihenfolge).toEqual([]);
    u.popstate({ von: null });
    expect(reihenfolge).toEqual(["adresse"]);
    // Ohne laufendes back() läuft es sofort
    u.api.nachVerlauf(() => reihenfolge.push("sofort"));
    expect(reihenfolge).toEqual(["adresse", "sofort"]);
  });

  test("das Panel im Editor hat keinen Verlaufseintrag und lässt die Ansicht stehen", () => {
    const u = umgebung();
    // Schmales Fenster: matchMedia meldet false, das Panel wird zur Seite
    const schmal = u.neueSeite();
    u.api.oeffneFluss(schmal, { panel: true });
    expect(u.verlauf.pushes).toHaveLength(1);
    u.api.schliesseAlle();
  });
});

describe("Umbau der Dialoge (Quelltext)", () => {
  const dom = lies("dom.js");

  test("dialogFormular und seitenblatt öffnen keine modalen Fenster mehr, sondern Seiten im Fluss", () => {
    const formular = dom.slice(
      dom.indexOf("export function dialogFormular"),
      dom.indexOf("export function seitenblatt"),
    );
    expect(formular).toContain("oeffneFluss(seite)");
    expect(formular).not.toContain("showModal");
    expect(formular).toContain("versuchSchliessen");
    const blatt = dom.slice(
      dom.indexOf("export function seitenblatt"),
      dom.indexOf("export function geheimnisDialog"),
    );
    expect(blatt).toContain("oeffneFluss(blatt, { panel })");
    expect(blatt).not.toContain("showModal");
  });

  test("keine Datei der Verwaltung öffnet ein modales Fenster, ausser der Rückfrage der Website und der Befehlspalette (#602)", () => {
    const dateien = readdirSyncAdmin().filter((d) => d.endsWith(".js"));
    const treffer = dateien.filter((d) => /\.showModal\(/.test(lies(d)));
    expect(treffer).toEqual(["befehlspalette.js", "website-dialoge.js"]);
    // Die Palette ist ein Suchfeld mit Tastatur, kein Formular und keine Rückfrage
    expect(lies("befehlspalette.js")).toContain('role: "combobox"');
    // Dort nur im Zweig «rueckfrage»: Ohne sie ist fenster() eine Seite im Fluss
    const quelle = lies("website-dialoge.js");
    expect(quelle).toContain("if (!rueckfrage) {");
    expect(quelle.indexOf("oeffneFluss(seite)")).toBeLessThan(
      quelle.indexOf("dialog.showModal()"),
    );
  });

  test("der Editor (Baustein, Bild, Sichtbarkeit) öffnet ein Panel neben dem Layout", () => {
    expect(lies("website-bausteine.js").match(/panel: true/g)).toHaveLength(2);
    expect(lies("website-sichtbarkeit.js")).toContain("panel: true");
  });

  test("der Editor fragt beim Verlassen im Fluss, nicht im Fenster", () => {
    const editor = lies("website-editor.js");
    expect(editor).toContain("ws-verlassen");
    expect(editor).not.toMatch(/fenster\(\{/);
  });

  test("admin.js schliesst Seiten im Fluss bei jeder Navigation und merkt den Verlaufseintrag", () => {
    const admin = lies("admin.js");
    expect(admin).toContain("schliesseAlle()");
    expect(admin).toContain("merkeEintrag()");
    expect(admin).toContain("stelleWiederHer()");
  });

  test("fluss.css und die Dateien sind eingetragen", () => {
    expect(lies("index.html")).toContain("/admin/fluss.css");
    const css = lies("fluss.css");
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /#[0-9a-f]{3,8}\b/i,
    );
    expect(css).toContain(".fluss-offen > :not(.fluss-seite)");
    expect(css).toContain("prefers-reduced-motion: no-preference");
  });
});

function readdirSyncAdmin() {
  return readdirSync(new URL("../public/admin/", import.meta.url));
}
