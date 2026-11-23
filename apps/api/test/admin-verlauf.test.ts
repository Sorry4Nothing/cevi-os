import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";

// Verlauf der Verwaltung (#578): verlauf.js und die Stellen, an denen die Verwaltung die Adresse ändert.

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");
const VERLAUF = lies("verlauf.js");

type Handler = (e: unknown) => void;

function umgebung(startHash = "#personen") {
  const fenster = new Map<string, Handler[]>();
  const eintraege: { state: unknown; hash: string }[] = [
    { state: null, hash: startHash },
  ];
  let stelle = 0;
  const location = {
    get hash() {
      return eintraege[stelle]!.hash;
    },
    // Ein Hash-Wechsel legt einen neuen Eintrag an (wie im Browser), der Zustand ist leer
    set hash(h: string) {
      eintraege.splice(stelle + 1, Infinity, { state: null, hash: h });
      stelle++;
    },
    get href() {
      return `http://x/admin${eintraege[stelle]!.hash}`;
    },
  };
  const verlauf = {
    scrollRestoration: "",
    get state() {
      return eintraege[stelle]!.state;
    },
    pushState(state: unknown, _t: string, url: string) {
      eintraege.splice(stelle + 1, Infinity, {
        state,
        hash: url.slice(url.indexOf("#")),
      });
      stelle++;
    },
    replaceState(state: unknown) {
      eintraege[stelle]!.state = state;
    },
    back() {
      stelle--;
    },
  };
  const gewartet: (() => void)[] = [];
  const sandbox = {
    window: {
      history: verlauf,
      scrollY: 0,
      scrollTo: (_x: number, y: number) => {
        sandbox.window.scrollY = y;
      },
      clearTimeout: () => {},
      setTimeout: () => 0,
      addEventListener: (a: string, f: Handler) =>
        fenster.set(a, [...(fenster.get(a) ?? []), f]),
      removeEventListener: () => {},
    },
    location,
    nachVerlauf: (f: () => void) => gewartet.push(f),
  };
  const api = runInNewContext(
    `${VERLAUF.replace(/^import .*$/gm, "").replace(/^export /gm, "")}\n;({ merkeEintrag, zurueck, schiebeAdresse, ersetzeAdresse, gehe, stelleWiederHer, zurueckKlick })`,
    sandbox,
  ) as Record<string, (...a: never[]) => void>;
  return {
    api,
    eintraege,
    location,
    verlauf,
    sandbox,
    gewartet,
    stelle: () => stelle,
  };
}

describe("verlauf.js", () => {
  test("der Browser merkt die Scrollposition nicht selbst: sie liegt im Eintrag", () => {
    const u = umgebung();
    expect(u.verlauf.scrollRestoration).toBe("manual");
  });

  test("jeder Eintrag merkt, woher man kam; der erste kennt keinen Herkunftsort", () => {
    const u = umgebung("#personen");
    u.api.merkeEintrag!();
    expect(u.verlauf.state).toEqual({ von: null });
    u.location.hash = "#termine";
    u.api.merkeEintrag!();
    expect(u.verlauf.state).toEqual({ von: "#personen" });
    // Ein Eintrag aus dem Verlauf (Zurück, Vor, Neuladen) behält, was er schon weiss
    u.verlauf.back();
    u.api.merkeEintrag!();
    expect(u.verlauf.state).toEqual({ von: null });
  });

  test("«Zurück» geht im Verlauf zurück, wenn man von dort kam: kein neuer Eintrag, die Ansicht davor kommt mit ihrem Stand", () => {
    const u = umgebung("#lager/lager");
    u.api.merkeEintrag!();
    u.location.hash = "#lager/lager/abc";
    u.api.merkeEintrag!();
    const anzahl = u.eintraege.length;
    (u.api.zurueck as (z: string) => void)("#lager/lager");
    expect(u.location.hash).toBe("#lager/lager");
    expect(u.eintraege).toHaveLength(anzahl);
  });

  test("«Zurück» nach einem Tiefenlink führt zur Liste, mit neuem Eintrag", () => {
    const u = umgebung("#lager/lager/abc");
    u.api.merkeEintrag!();
    const anzahl = u.eintraege.length;
    (u.api.zurueck as (z: string) => void)("#lager/lager");
    expect(u.location.hash).toBe("#lager/lager");
    expect(u.eintraege).toHaveLength(anzahl + 1);
  });

  test("«Zurück» aus einem anderen Bereich führt zum Link, den die Seite nennt, nicht blind zurück", () => {
    const u = umgebung("#termine");
    u.api.merkeEintrag!();
    u.location.hash = "#lager/lager/abc";
    u.api.merkeEintrag!();
    (u.api.zurueck as (z: string) => void)("#lager/lager");
    expect(u.location.hash).toBe("#lager/lager");
  });

  test("schiebeAdresse legt einen Eintrag an (Auswahl in einer Liste mit Detail), ersetzeAdresse korrigiert den aktuellen", () => {
    const u = umgebung("#termine/vorschlaege");
    u.api.merkeEintrag!();
    (u.api.schiebeAdresse as (h: string) => void)("#termine/vorschlaege/a");
    expect(u.eintraege).toHaveLength(2);
    expect(u.verlauf.state).toEqual({ von: "#termine/vorschlaege" });
    (u.api.ersetzeAdresse as (h: string) => void)("#termine/vorschlaege/b");
    expect(u.eintraege).toHaveLength(2);
    expect(u.location.hash).toBe("#termine/vorschlaege/a");
    // Dieselbe Adresse legt keinen zweiten Eintrag an
    (u.api.schiebeAdresse as (h: string) => void)("#termine/vorschlaege/a");
    expect(u.eintraege).toHaveLength(2);
  });

  test("der Klick auf einen Zurück-Link: gewöhnlicher Klick läuft über zurueck(), Strg und mittlere Taste öffnen wie gewohnt", () => {
    const u = umgebung("#lager/lager");
    u.api.merkeEintrag!();
    u.location.hash = "#lager/lager/abc";
    u.api.merkeEintrag!();
    let verhindert = 0;
    const klick = (extra: object) => ({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      currentTarget: { getAttribute: () => "#lager/lager" },
      preventDefault: () => verhindert++,
      ...extra,
    });
    (u.api.zurueckKlick as (e: unknown) => void)(klick({ ctrlKey: true }));
    (u.api.zurueckKlick as (e: unknown) => void)(klick({ button: 1 }));
    expect(verhindert).toBe(0);
    (u.api.zurueckKlick as (e: unknown) => void)(klick({}));
    expect(verhindert).toBe(1);
    expect(u.location.hash).toBe("#lager/lager");
  });

  test("gehe() wartet auf ein laufendes back() einer geschlossenen Seite", () => {
    const u = umgebung();
    (u.api.gehe as (h: string) => void)("#personen/gruppen");
    expect(u.gewartet).toHaveLength(1);
    expect(u.location.hash).toBe("#personen");
    u.gewartet[0]!();
    expect(u.location.hash).toBe("#personen/gruppen");
  });

  test("stelleWiederHer: Eintrag mit Position springt dorthin, ein neuer Eintrag beginnt oben", () => {
    const u = umgebung();
    u.verlauf.replaceState({ von: null, y: 400 });
    u.sandbox.window.scrollY = 0;
    u.api.stelleWiederHer!();
    expect(u.sandbox.window.scrollY).toBe(400);
    u.location.hash = "#termine";
    u.api.merkeEintrag!();
    u.api.stelleWiederHer!();
    expect(u.sandbox.window.scrollY).toBe(0);
  });
});

describe("Verlauf in den Bereichen (Quelltext)", () => {
  const dateien = readdirSync(
    new URL("../public/admin/", import.meta.url),
  ).filter((d) => d.endsWith(".js"));

  test("kein Bereich schreibt mit replaceState eine Ansicht: nur verlauf.js und die Normalisierung alter Adressen in admin.js", () => {
    const treffer = dateien.filter((d) =>
      /history\.replaceState/.test(lies(d)),
    );
    expect(treffer.sort()).toEqual(["admin.js", "fluss.js", "verlauf.js"]);
    // admin.js: nur für alte Adressen (neueAdresse), der Zustand bleibt erhalten
    expect(lies("admin.js")).toMatch(
      /replaceState\(window\.history\.state, "", neu\)/,
    );
  });

  test("Zurück-Links der Bereiche laufen über verlauf.js", () => {
    expect(lies("lager-gemeinsam.js")).toContain("zurueckKlick");
    expect(lies("website-editor.js")).toContain("zurueckKlick");
    expect(lies("lager-anlegen.js")).toContain("zurueck(ADRESSE)");
    // Der Assistent ersetzt seinen Eintrag, damit Zurück danach zur Liste führt
    expect(lies("lager-anlegen.js")).toContain("location.replace(ADRESSE)");
  });

  test("nach dem Schliessen einer Seite im Fluss ändert die Verwaltung die Adresse erst nach dem Zurück im Verlauf", () => {
    // Das Löschen am Ort öffnet keine Seite im Fluss: Die Adresse der Liste ersetzt die des gelöschten Lagers
    expect(lies("lager.js")).toContain("location.replace(ADRESSE)");
    expect(lies("termine-anlaesse.js")).toMatch(/gehe\(adresse\(neu\.id\)\)/);
  });

  test("Vorschläge: Auswahl und Stand sind eigene Einträge und folgen Browser-Zurück", () => {
    const q = lies("termine-vorschlaege.js");
    expect(q).toContain("schiebeAdresse(");
    expect(q).toContain('window.addEventListener("popstate", beiVerlauf)');
    expect(q).not.toMatch(/history\.replaceState/);
  });

  test("der Sprunglink legt keinen Eintrag an", () => {
    expect(lies("admin.js")).toContain('closest?.("a.sprung")');
  });
});
