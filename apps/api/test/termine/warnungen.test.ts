import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import type { Db } from "../../src/db/client.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { legeProgrammAn } from "../hilfen/programme.js";
import { KONTO_FUER, type TerminePersona } from "./matrix.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = {
  appMinVersion: "1.2.0",
  sql,
  auth,
  seiten: ladeSeiten(),
};
const app = erstelleApp({ ...optionen, db });
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

interface Eintrag {
  id: string;
  titel: string;
  ganztaegig: boolean;
  beginn: string | null;
  ende: string | null;
  tagVon: string | null;
  tagBis: string | null;
  grund: string;
  kategorien: string[];
}
interface Antwort {
  termine: Eintrag[];
  unbekannteKategorien: { name: string; anzahl: number }[];
  weitere: boolean;
  naechste: string | null;
}

const PFAD = "/api/v1/admin/termine/warnungen";
const hole = (persona: TerminePersona, query = "") =>
  app.request(`${PFAD}${query}`, {
    headers: konten[KONTO_FUER[persona]].headers,
  });
const liste = async (query = "") => {
  const antwort = await hole("abteilungsleitung", query);
  expect(antwort.status).toBe(200);
  return (await antwort.json()) as Antwort;
};
const titel = (a: Antwort) => a.termine.map((t) => t.titel);

// Weit in der Zukunft und weit in der Vergangenheit, damit kein Lauf des Tests ein Datum überholt
const ZUKUNFT = (stunde: number) => new Date(Date.UTC(2099, 0, 1, stunde));
const VERGANGEN = new Date(Date.UTC(2020, 0, 1, 8));

interface Spez {
  titel: string;
  kategorien?: string[];
  tags?: string[];
  abteilungId?: string;
  sichtbarkeit?: "intern" | "leitende" | "eltern";
  status?: "aktiv" | "abgesagt" | "pruefen";
  beginn?: Date;
  ende?: Date;
  tagVon?: string;
  tagBis?: string;
}
async function termin(spez: Spez) {
  const t = await legeProgrammAn(db, {
    abteilungId: spez.abteilungId ?? welt.testabteilungId,
    sichtbarkeit: spez.sichtbarkeit ?? "eltern",
    titel: spez.titel,
    beginn: spez.beginn,
    ende: spez.ende,
    tagVon: spez.tagVon,
    tagBis: spez.tagBis,
  });
  await db
    .update(schema.programm)
    .set({
      kategorien: spez.kategorien ?? [],
      ...(spez.status && { status: spez.status }),
    })
    .where(eq(schema.programm.id, t.id));
  if (spez.tags?.length) {
    await db
      .insert(schema.programmTag)
      .values(spez.tags.map((tagId) => ({ programmId: t.id, tagId })));
  }
  return t.id;
}

describe("Warnliste: welche Termine und welche Kategorien", () => {
  let wolfId: string;
  beforeAll(async () => {
    const [wolf] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "funktion",
        name: "Wolfsrudel",
        kuerzel: "WR",
      })
      .returning({ id: schema.tag.id });
    wolfId = wolf.id;
    // Abweichung: «Rudel-Sitzung» meint den Tag «Wolfsrudel»
    await db.insert(schema.kategorieZuordnung).values({
      abteilungId: welt.testabteilungId,
      kategorie: "Rudel-Sitzung",
      tagId: wolfId,
    });
    const spezen: Spez[] = [
      { titel: "1 ohne Kategorie", beginn: ZUKUNFT(8) },
      {
        titel: "2 nur unbekannt",
        kategorien: ["Mystery", " mystery "],
        beginn: ZUKUNFT(9),
      },
      // Sichtbar über die bekannte Kategorie: fehlt in der Liste, die unbekannte steht trotzdem in der Zusammenfassung
      {
        titel: "3 gemischt",
        kategorien: ["Wolfsrudel", "MYSTERY", "Zeltlager"],
        tags: [wolfId],
        beginn: ZUKUNFT(10),
      },
      { titel: "4 abgesagt", status: "abgesagt", beginn: ZUKUNFT(11) },
      { titel: "5 intern", sichtbarkeit: "intern", beginn: ZUKUNFT(12) },
      { titel: "6 vorbei", beginn: VERGANGEN },
      {
        titel: "7 ganztägig vorbei",
        tagVon: "2020-01-01",
        tagBis: "2020-01-02",
      },
      {
        titel: "8 ganztägig kommend",
        tagVon: "2099-02-01",
        tagBis: "2099-02-01",
        kategorien: ["Zeltlager"],
      },
      // Läuft gerade: Beginn vorbei, Ende noch nicht
      {
        titel: "0 laufend",
        beginn: new Date(Date.now() - 3_600_000),
        ende: new Date(Date.now() + 3_600_000),
      },
      // Über die Abweichung bekannt: ohne Tag in programm_tag (noch nicht abgeglichen), aber nicht unbekannt
      {
        titel: "9 Abweichung",
        kategorien: ["rudel-sitzung"],
        beginn: ZUKUNFT(13),
      },
      {
        titel: "Demo ohne Kategorie",
        abteilungId: welt.demoAbteilungId,
        beginn: ZUKUNFT(14),
      },
    ];
    for (const s of spezen) await termin(s);
  });

  test("nennt kommende und laufende Termine ohne Tag, mit Grund und rohen Namen", async () => {
    const a = await liste();
    expect(titel(a)).toEqual([
      "0 laufend",
      "1 ohne Kategorie",
      "2 nur unbekannt",
      "9 Abweichung",
      "8 ganztägig kommend",
    ]);
    const nach = Object.fromEntries(a.termine.map((t) => [t.titel, t]));
    expect(nach["1 ohne Kategorie"]).toMatchObject({
      grund: "keine_kategorie",
      kategorien: [],
      ganztaegig: false,
    });
    expect(nach["2 nur unbekannt"]).toMatchObject({
      grund: "unbekannte_kategorie",
      kategorien: ["Mystery", " mystery "],
    });
    expect(nach["8 ganztägig kommend"]).toMatchObject({
      ganztaegig: true,
      beginn: null,
      ende: null,
      tagVon: "2099-02-01",
      tagBis: "2099-02-01",
    });
    expect(a.weitere).toBe(false);
    expect(a.naechste).toBeNull();
  });

  test("ein Termin mit bekannter und unbekannter Kategorie fehlt, die unbekannte steht in der Zusammenfassung", async () => {
    const a = await liste();
    expect(titel(a)).not.toContain("3 gemischt");
    // Mystery: Termine 2 und 3, ohne Gross-/Kleinschreibung und Leerzeichen zu einem Eintrag; Zeltlager: Termine 3 und 8; bekannte Namen (Tag, Abweichung) fehlen
    expect(a.unbekannteKategorien).toEqual([
      { name: expect.stringMatching(/^mystery$/i), anzahl: 2 },
      { name: "Zeltlager", anzahl: 2 },
    ]);
  });

  test("abgesagte, interne, vergangene und fremde Termine fehlen", async () => {
    const t = titel(await liste());
    for (const name of [
      "4 abgesagt",
      "5 intern",
      "6 vorbei",
      "7 ganztägig vorbei",
      "Demo ohne Kategorie",
    ]) {
      expect(t).not.toContain(name);
    }
  });

  test("Seitenwechsel nach Beginn und ID, ohne Doppelte und ohne Lücke", async () => {
    const eins = await liste("?limit=2");
    expect(titel(eins)).toEqual(["0 laufend", "1 ohne Kategorie"]);
    expect(eins.weitere).toBe(true);
    const zwei = await liste(`?limit=2&nach=${eins.naechste}`);
    expect(titel(zwei)).toEqual(["2 nur unbekannt", "9 Abweichung"]);
    const drei = await liste(`?limit=2&nach=${zwei.naechste}`);
    expect(titel(drei)).toEqual(["8 ganztägig kommend"]);
    expect(drei.weitere).toBe(false);
    expect(drei.naechste).toBeNull();
  });

  test.each([
    "?limit=0",
    "?limit=101",
    "?limit=x",
    "?nach=kaputt",
    `?nach=${Buffer.from("[1,2]").toString("base64url")}`,
    "?fremd=1",
  ])("ungültige Eingabe %s ist 400", async (query) => {
    expect((await hole("abteilungsleitung", query)).status).toBe(400);
  });

  test("nur die Abteilungsleitung mit zweitem Faktor", async () => {
    for (const p of ["adminOhneFaktor", "stufenleitungA", "elternA"] as const) {
      expect((await hole(p)).status, p).toBe(403);
    }
    // Die fremde Abteilungsleitung sieht nur ihre eigene Abteilung
    const demo = await hole("fremdeAbteilungsleitung");
    expect(demo.status).toBe(200);
    expect(titel((await demo.json()) as Antwort)).toEqual([
      "Demo ohne Kategorie",
    ]);
  });

  test("höchstens zwei Abfragen, unabhängig von der Seitengrösse", async () => {
    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    for (const limit of [1, 100]) {
      abfragen.length = 0;
      const antwort = await zaehlApp.request(`${PFAD}?limit=${limit}`, {
        headers: konten[KONTO_FUER.abteilungsleitung].headers,
      });
      expect(antwort.status).toBe(200);
      expect(abfragen.filter((q) => /programm/.test(q)).length).toBe(2);
    }
  });
});
