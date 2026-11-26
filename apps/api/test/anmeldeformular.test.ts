import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, test, vi } from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Baustein } from "../src/website/bausteine.js";
import {
  AnmeldeFehler,
  ersetzeAbschnitt,
  setzeAnmeldeformular,
} from "../src/website/anmeldeformular.js";
import { anmeldeFormular } from "../src/website/vorlagen.js";
import { API_URL } from "./hilfen/datenbank.js";

// Seite auf das Anmeldeformular umstellen (#881): die reine Ersetzung, der Lauf gegen die Datenbank (Entwurf, Veröffentlichen, zweiter Lauf) und der Befehl
vi.setConfig({ testTimeout: 120_000 });

const db = erstelleDb(postgres(API_URL));
afterAll(() => db.$client.end());

const ABSCHNITT = "So meldest du dich an";
const ueberschrift = (text: string, ebene: 2 | 3 = 2): Baustein => ({
  id: randomUUID(),
  typ: "ueberschrift",
  daten: { ebene, text },
  sichtbarkeit: "erbt",
});
const text = (...absaetze: string[]): Baustein => ({
  id: randomUUID(),
  typ: "text",
  daten: {
    inhalt: absaetze.map((t) => ({ typ: "absatz", inhalt: [{ text: t }] })),
  },
  sichtbarkeit: "erbt",
});
const mailKnopf = (): Baustein => ({
  id: randomUUID(),
  typ: "schaltflaeche",
  daten: {
    darstellung: "schaltflaeche",
    beschriftung: "Anmeldung per E-Mail",
    ziel: "mailto:anmeldung@example.org",
  },
  sichtbarkeit: "erbt",
});
const trenner = (): Baustein => ({
  id: randomUUID(),
  typ: "trenner",
  daten: { art: "linie" },
  sichtbarkeit: "erbt",
});
// Die heutige Seite, nachgebaut: Einleitung, der Abschnitt mit Text und Knopf, danach ein weiterer Abschnitt
const heutigeSeite = () => [
  text("Wir freuen uns auf dich."),
  ueberschrift(ABSCHNITT),
  text(
    "Die Anmeldung läuft über die Abteilungsleitung. Schreib uns eine E-Mail mit den folgenden Angaben:",
  ),
  mailKnopf(),
  ueberschrift("Schnuppern"),
  text("Komm einfach an einem Samstag vorbei."),
];

describe("ersetzeAbschnitt", () => {
  test("nach einer Überschrift: Text und Knopf weg, das Formular dort, alles andere unverändert", () => {
    const alt = heutigeSeite();
    const e = ersetzeAbschnitt(alt, ABSCHNITT, anmeldeFormular);
    expect(e.entfernt).toEqual(["text", "schaltflaeche"]);
    expect(e.bausteine.map((b) => b.typ)).toEqual([
      "text",
      "ueberschrift",
      "formular",
      "ueberschrift",
      "text",
    ]);
    // Dieselben Objekte, nicht nur gleiche Typen
    expect(e.bausteine[0]).toBe(alt[0]);
    expect(e.bausteine[1]).toBe(alt[1]);
    expect(e.bausteine[3]).toBe(alt[4]);
    expect(e.bausteine[4]).toBe(alt[5]);
    // Die Überschrift bleibt, das Formular trägt keinen zweiten Titel
    const f = e.bausteine[2]!;
    expect(f.typ === "formular" && f.daten.titel).toBeUndefined();
  });

  test("ohne Überschrift: der Text mit dem Abschnitt und der Knopf direkt danach, das Formular mit Titel", () => {
    const vorne = trenner();
    const e = ersetzeAbschnitt(
      [vorne, text(`${ABSCHNITT}: Schreib uns eine E-Mail.`), mailKnopf()],
      ABSCHNITT,
      anmeldeFormular,
    );
    expect(e.entfernt).toEqual(["text", "schaltflaeche"]);
    expect(e.bausteine[0]).toBe(vorne);
    const f = e.bausteine[1]!;
    expect(f.typ === "formular" && f.daten.titel).toBe(ABSCHNITT);
    expect(e.bausteine).toHaveLength(2);
  });

  test("Gross- und Kleinschreibung und Abstände zählen nicht, ein Text in Stücken auch", () => {
    const geteilt: Baustein = {
      ...text(),
      daten: {
        inhalt: [
          {
            typ: "absatz",
            inhalt: [{ text: "so meldest " }, { text: "du  dich an" }],
          },
        ],
      },
    } as Baustein;
    const e = ersetzeAbschnitt([geteilt], ABSCHNITT, anmeldeFormular);
    expect(e.bausteine.map((b) => b.typ)).toEqual(["formular"]);
  });

  test("nicht eindeutig oder fremde Bausteine im Abschnitt: Fehler, nichts geändert", () => {
    const alt = heutigeSeite();
    const kopie = structuredClone(alt);
    expect(() => ersetzeAbschnitt([], ABSCHNITT, anmeldeFormular)).toThrow(
      AnmeldeFehler,
    );
    expect(() =>
      ersetzeAbschnitt(
        [...alt, text(`Noch einmal: ${ABSCHNITT}`)],
        ABSCHNITT,
        anmeldeFormular,
      ),
    ).toThrow(/2 Bausteine/);
    expect(() =>
      ersetzeAbschnitt(
        [ueberschrift(ABSCHNITT), text("x"), trenner()],
        ABSCHNITT,
        anmeldeFormular,
      ),
    ).toThrow(/trenner/);
    expect(alt).toEqual(kopie);
  });

  test("eine Unterüberschrift gehört zum Abschnitt und ist kein Text: Fehler", () => {
    expect(() =>
      ersetzeAbschnitt(
        [ueberschrift(ABSCHNITT), ueberschrift("Angaben", 3), text("x")],
        ABSCHNITT,
        anmeldeFormular,
      ),
    ).toThrow(/ueberschrift/);
  });

  test("mit anhaengen: ohne Abschnitt ans Ende", () => {
    const alt = [text("Hallo")];
    const e = ersetzeAbschnitt(alt, ABSCHNITT, anmeldeFormular, true);
    expect(e.bausteine.map((b) => b.typ)).toEqual(["text", "formular"]);
    expect(e.entfernt).toEqual([]);
  });
});

// Eine eigene Abteilung mit /<eltern>/anmeldung, veröffentlicht mit der heutigen Seite
async function legeSeiteAn() {
  const [abteilung] = await db
    .insert(schema.abteilung)
    .values({ name: `Testabteilung Anmeldung ${randomUUID()}` })
    .returning();
  const eltern = `mitmachen-${randomUUID().slice(0, 8)}`;
  const [oben] = await db
    .insert(schema.seite)
    .values({
      abteilungId: abteilung!.id,
      adresse: eltern,
      titel: "Mitmachen",
      sichtbarkeit: "oeffentlich",
    })
    .returning();
  const [s] = await db
    .insert(schema.seite)
    .values({
      abteilungId: abteilung!.id,
      elternId: oben!.id,
      adresse: "anmeldung",
      titel: "Anmeldung",
      sichtbarkeit: "oeffentlich",
    })
    .returning();
  const inhalt = { v: 1, titel: "Anmeldung", bausteine: heutigeSeite() };
  const [v] = await db
    .insert(schema.seiteVersion)
    .values({ seiteId: s!.id, nr: 1, inhalt })
    .returning();
  await db
    .update(schema.seite)
    .set({ veroeffentlichteVersionId: v!.id })
    .where(eq(schema.seite.id, s!.id));
  return {
    abteilungId: abteilung!.id,
    seiteId: s!.id,
    teile: [eltern, "anmeldung"],
  };
}
const lies = async (seiteId: string) => {
  const [z] = await db
    .select()
    .from(schema.seite)
    .where(eq(schema.seite.id, seiteId));
  const versionen = await db
    .select()
    .from(schema.seiteVersion)
    .where(eq(schema.seiteVersion.seiteId, seiteId));
  return { seite: z!, versionen };
};
const typen = (inhalt: unknown) =>
  (inhalt as { bausteine: { typ: string }[] }).bausteine.map((b) => b.typ);
const audit = (seiteId: string, aktion: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.zielId, seiteId),
        eq(schema.auditLog.aktion, aktion),
      ),
    );

describe("setzeAnmeldeformular", () => {
  test("erst Entwurf, dann veröffentlichen, dann nichts mehr: idempotent, mit Audit", async () => {
    const s = await legeSeiteAn();
    const e1 = await setzeAnmeldeformular(db, {
      ...s,
      veroeffentlichen: false,
    });
    expect(e1).toMatchObject({ art: "ersetzt", veroeffentlicht: null });
    let z = await lies(s.seiteId);
    expect(typen(z.seite.entwurf)).toEqual([
      "text",
      "ueberschrift",
      "formular",
      "ueberschrift",
      "text",
    ]);
    // Die Website zeigt noch den alten Stand
    expect(z.versionen).toHaveLength(1);
    const zaehler = z.seite.entwurfZaehler;
    const [a] = await audit(s.seiteId, "seite_anmeldeformular");
    expect(a).toMatchObject({ akteurId: "cli", zielTyp: "seite" });
    // Nur Arten, nie Texte der Seite
    expect(JSON.stringify(a!.details)).not.toContain("Abteilungsleitung");

    // Zweiter Lauf ohne Veröffentlichen: nichts geändert
    const e2 = await setzeAnmeldeformular(db, {
      ...s,
      veroeffentlichen: false,
    });
    expect(e2.art).toBe("vorhanden");
    expect((await lies(s.seiteId)).seite.entwurfZaehler).toBe(zaehler);

    // Mit Veröffentlichen: der Entwurf geht als Version 2 hinaus
    const e3 = await setzeAnmeldeformular(db, { ...s, veroeffentlichen: true });
    expect(e3).toMatchObject({ art: "vorhanden", veroeffentlicht: 2 });
    z = await lies(s.seiteId);
    const neu = z.versionen.find((v) => v.nr === 2)!;
    expect(z.seite.veroeffentlichteVersionId).toBe(neu.id);
    expect(typen(neu.inhalt)).toContain("formular");

    // Dritter Lauf: weder neues Formular noch neue Version
    const e4 = await setzeAnmeldeformular(db, { ...s, veroeffentlichen: true });
    expect(e4).toMatchObject({ art: "vorhanden", veroeffentlicht: null });
    expect((await lies(s.seiteId)).versionen).toHaveLength(2);
    expect(await audit(s.seiteId, "seite_anmeldeformular")).toHaveLength(1);
    expect(await audit(s.seiteId, "seite_veroeffentlicht")).toHaveLength(1);
  });

  test("direkt veröffentlichen; das veröffentlichte Formular nimmt Antworten an", async () => {
    const s = await legeSeiteAn();
    const e = await setzeAnmeldeformular(db, { ...s, veroeffentlichen: true });
    expect(e).toMatchObject({ art: "ersetzt", veroeffentlicht: 2 });
    const z = await lies(s.seiteId);
    const v = z.versionen.find((x) => x.nr === 2)!;
    expect(z.seite.entwurf).toEqual(v.inhalt);
    const f = (v.inhalt as { bausteine: Baustein[] }).bausteine.find(
      (b) => b.typ === "formular",
    );
    expect(f).toBeDefined();
  });

  test("unveröffentlichte Änderungen anderer: mit --veroeffentlichen nichts geändert", async () => {
    const s = await legeSeiteAn();
    await db
      .update(schema.seite)
      .set({
        entwurf: {
          v: 1,
          titel: "Anmeldung",
          bausteine: [...heutigeSeite(), text("Noch nicht fertig")],
        },
      })
      .where(eq(schema.seite.id, s.seiteId));
    const vorher = await lies(s.seiteId);
    await expect(
      setzeAnmeldeformular(db, { ...s, veroeffentlichen: true }),
    ).rejects.toThrow(/unveröffentlichte Änderungen/);
    const nachher = await lies(s.seiteId);
    expect(nachher.seite.entwurf).toEqual(vorher.seite.entwurf);
    expect(nachher.versionen).toHaveLength(1);
    // Ohne Veröffentlichen geht es in den Entwurf, der Rest des Entwurfs bleibt
    await setzeAnmeldeformular(db, { ...s, veroeffentlichen: false });
    expect(typen((await lies(s.seiteId)).seite.entwurf)).toEqual([
      "text",
      "ueberschrift",
      "formular",
      "ueberschrift",
      "text",
      "text",
    ]);
  });

  test("Abschnitt fehlt: Fehler, nichts geändert", async () => {
    const s = await legeSeiteAn();
    await expect(
      setzeAnmeldeformular(db, {
        ...s,
        veroeffentlichen: true,
        abschnitt: "Gibt es nicht",
      }),
    ).rejects.toThrow(AnmeldeFehler);
    const z = await lies(s.seiteId);
    expect(z.seite.entwurf).toBeNull();
    expect(z.versionen).toHaveLength(1);
    expect(await audit(s.seiteId, "seite_anmeldeformular")).toHaveLength(0);
  });
});

describe("Befehl", () => {
  const starte = (...argumente: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/anmeldeformular.ts", ...argumente],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, DATABASE_URL: API_URL },
        encoding: "utf8",
        timeout: 60_000,
      },
    );

  test("ohne --pfad: Verwendung, Code 1", () => {
    const r = starte();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Verwendung");
  });

  test("findet die Abteilung über den Pfad, setzt ein und veröffentlicht; zweiter Lauf ändert nichts", async () => {
    const s = await legeSeiteAn();
    const pfad = `/${s.teile.join("/")}`;
    const r = starte("--pfad", pfad, "--veroeffentlichen");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("ersetzt: text, schaltflaeche");
    expect(r.stdout).toContain("Version 2");
    const zweiter = starte("--pfad", pfad, "--veroeffentlichen");
    expect(zweiter.status).toBe(0);
    expect(zweiter.stdout).toContain("schon ein Formular");
    expect((await lies(s.seiteId)).versionen).toHaveLength(2);
  });

  test("unbekannter Pfad: Meldung, Code 1", () => {
    const r = starte("--pfad", `/gibt-es-nicht-${randomUUID().slice(0, 8)}`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Keine Seite");
  });
});
