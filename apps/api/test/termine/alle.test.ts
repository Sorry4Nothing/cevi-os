import { drizzle } from "drizzle-orm/postgres-js";
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
import { KONTO_FUER, type TerminePersona } from "./matrix.js";
import { legeProgrammAn } from "../hilfen/programme.js";

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
let funktionTagId: string;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: "Leitungsteam",
      kuerzel: "LT",
    })
    .returning({ id: schema.tag.id });
  funktionTagId = t.id;
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

interface Eintrag {
  id: string;
  titel: string;
  meine?: boolean;
  tags: { id: string; name: string; typ: string }[];
  [schluessel: string]: unknown;
}
interface Seite {
  termine: Eintrag[];
  weitere: boolean;
  naechste: string | null;
}

const hole = (persona: TerminePersona, pfad: string, kopf: object = {}) =>
  app.request(pfad, {
    headers: { ...konten[KONTO_FUER[persona]].headers, ...kopf },
  });
const liste = async (
  persona: TerminePersona,
  query: string,
  art: "alle" | "mein" = "alle",
) => {
  const antwort = await hole(persona, `/api/v1/termine/${art}?${query}`);
  expect(antwort.status).toBe(200);
  return (await antwort.json()) as Seite;
};
const titel = (s: Seite) => s.termine.map((t) => t.titel);

async function termin(spez: {
  titel: string;
  tags: string[];
  abteilungId?: string;
  beginn: Date;
}) {
  const t = await legeProgrammAn(db, {
    abteilungId: spez.abteilungId ?? welt.testabteilungId,
    titel: spez.titel,
    beginn: spez.beginn,
  });
  if (spez.tags.length > 0) {
    await db
      .insert(schema.programmTag)
      .values(spez.tags.map((tagId) => ({ programmId: t.id, tagId })));
  }
  return t.id;
}

const FENSTER = "von=2027-03-01&bis=2027-03-07";

describe("Alle Termine: wer welche Termine sieht", () => {
  let ids: Record<string, string>;
  beforeAll(async () => {
    const { stufeAId: a, stufeBId: b, demoStufeId: d } = welt;
    const spezen: [string, Parameters<typeof termin>[0]["tags"], object][] = [
      ["A", [a], {}],
      ["B", [b], {}],
      ["AB", [a, b], {}],
      ["ohne Tag", [], {}],
      ["Team", [funktionTagId], {}],
      ["Demo", [d], { abteilungId: welt.demoAbteilungId }],
      // Tag einer fremden Abteilung an einem Termin der Testabteilung: zählt nicht als Tag
      ["Fremder Tag", [d], {}],
    ];
    ids = {};
    for (const [i, [name, tags, rest]] of spezen.entries()) {
      ids[name] = await termin({
        titel: name,
        tags,
        beginn: new Date(Date.UTC(2027, 2, 1, 8 + i)),
        ...rest,
      });
    }
    await db.insert(schema.personTag).values([
      { userId: konten[KONTO_FUER.leitungB].id!, tagId: funktionTagId },
      {
        userId: konten[KONTO_FUER.fremdeAbteilungsleitung].id!,
        tagId: welt.demoStufeId,
      },
    ]);
  });

  // Abteilungsleitung: jeder Termin der Abteilung, auch ohne Tag (#449), alle mit meine=false (sie hat keinen eigenen Tag).
  // Alle anderen: genau «Mein Kalender» (meine=true). Ohne Tag nie.
  const ALLE_DER_ABTEILUNG = [
    "A",
    "B",
    "AB",
    "ohne Tag",
    "Team",
    // Der Tag gehört zu einer fremden Abteilung: für die Testabteilung also ohne Tag
    "Fremder Tag",
  ];
  const SICHT: Record<
    Exclude<TerminePersona, "passwortPflicht" | "deaktiviert" | "ohneLogin">,
    { titel: string[]; meine: string[] }
  > = {
    abteilungsleitung: { titel: ALLE_DER_ABTEILUNG, meine: [] },
    adminOhneFaktor: { titel: ALLE_DER_ABTEILUNG, meine: [] },
    stufenleitungA: {
      titel: ["A", "AB"],
      meine: ["A", "AB"],
    },
    stufenleitungB: { titel: ["B", "AB"], meine: ["B", "AB"] },
    leitungA: {
      titel: ["A", "AB"],
      meine: ["A", "AB"],
    },
    leitungB: { titel: ["B", "AB", "Team"], meine: ["B", "AB", "Team"] },
    leitungAElternB: {
      titel: ["A", "B", "AB"],
      meine: ["A", "B", "AB"],
    },
    elternA: { titel: ["A", "AB"], meine: ["A", "AB"] },
    elternB: { titel: ["B", "AB"], meine: ["B", "AB"] },
    // Mit eigenem Tag der Demo-Abteilung; der Tag am Termin «Fremder Tag» gehört nicht zur Testabteilung
    fremdeAbteilungsleitung: { titel: ["Demo"], meine: ["Demo"] },
    fremdeEltern: { titel: ["Demo"], meine: ["Demo"] },
  };

  test.each(Object.entries(SICHT))(
    "%s sieht genau das Erwartete, je Termin einmal",
    async (persona, erwartet) => {
      const s = await liste(persona as TerminePersona, FENSTER);
      expect(titel(s)).toEqual(erwartet.titel);
      expect(s.termine.filter((t) => t.meine).map((t) => t.titel)).toEqual(
        erwartet.meine,
      );
      expect(s.termine.every((t) => typeof t.meine === "boolean")).toBe(true);
      expect(s.weitere).toBe(false);
      expect(s.naechste).toBeNull();
    },
  );

  test("die Abteilungsleitung sieht ohne eigenen Tag alle Tags eines Termins, alle anderen nur die eigenen", async () => {
    const al = await liste("abteilungsleitung", FENSTER);
    expect(
      al.termine
        .find((t) => t.titel === "AB")!
        .tags.map((t) => t.id)
        .sort(),
    ).toEqual([welt.stufeAId, welt.stufeBId].sort());
    const eltern = await liste("elternA", FENSTER);
    expect(
      eltern.termine.find((t) => t.titel === "AB")?.tags.map((t) => t.id),
    ).toEqual([welt.stufeAId]);
  });

  test("ein Termin ohne Tag steht in «Alle» für die Abteilungsleitung (meine=false), nie in «Mein Kalender»; fremde Abteilungen fehlen", async () => {
    const s = await liste("abteilungsleitung", FENSTER);
    const ohne = s.termine.find((t) => t.titel === "ohne Tag");
    expect(ohne).toMatchObject({ meine: false, tags: [] });
    for (const name of ["Demo"]) {
      expect(titel(s)).not.toContain(name);
    }
    for (const persona of Object.keys(SICHT) as TerminePersona[]) {
      const mein = await liste(persona, FENSTER, "mein");
      expect(titel(mein), persona).not.toContain("ohne Tag");
    }
    // Wer nicht Abteilungsleitung ist, sieht ihn auch in «Alle» nicht
    for (const persona of [
      "stufenleitungA",
      "elternA",
      "fremdeAbteilungsleitung",
    ] as const) {
      expect(titel(await liste(persona, FENSTER)), persona).not.toContain(
        "ohne Tag",
      );
    }
  });

  test("Felder wie in «Mein Kalender» plus meine", async () => {
    const s = await liste("elternA", FENSTER);
    const mein = await liste("elternA", FENSTER, "mein");
    expect(Object.keys(s.termine[0]).sort()).toEqual(
      [...Object.keys(mein.termine[0]), "meine"].sort(),
    );
    expect(mein.termine.every((t) => !("meine" in t))).toBe(true);
  });

  test("mein ist für jede Person genau der Teil von «Alle» mit meine=true", async () => {
    for (const persona of Object.keys(SICHT) as TerminePersona[]) {
      const alle = await liste(persona, FENSTER);
      const mein = await liste(persona, FENSTER, "mein");
      expect(mein.termine.map((t) => t.id)).toEqual(
        alle.termine.filter((t) => t.meine).map((t) => t.id),
      );
    }
  });

  describe("Apps", () => {
    const MIT = { "X-App-Version": "1.2.0" };

    test("mit X-App-Version 404, ohne 200, für jede Person", async () => {
      const pfad = `/api/v1/termine/alle?${FENSTER}`;
      for (const persona of Object.keys(SICHT) as TerminePersona[]) {
        expect((await hole(persona, pfad, MIT)).status, persona).toBe(404);
        expect((await hole(persona, pfad)).status, persona).toBe(200);
      }
    });

    test("das 404 gilt auch bei ungültiger Eingabe, ohne Anmeldung bleibt es 401", async () => {
      expect(
        (await hole("elternA", "/api/v1/termine/alle?von=x", MIT)).status,
      ).toBe(404);
      const ohne = await app.request(`/api/v1/termine/alle?${FENSTER}`, {
        headers: MIT,
      });
      expect(ohne.status).toBe(401);
    });

    test("zu alte Version bleibt 426", async () => {
      const antwort = await hole("elternA", `/api/v1/termine/alle?${FENSTER}`, {
        "X-App-Version": "1.0.0",
      });
      expect(antwort.status).toBe(426);
    });

    test("die App-Routen liefern nie Termine ausserhalb von «Mein Kalender»", async () => {
      const alle = await liste("abteilungsleitung", FENSTER);
      expect(alle.termine.length).toBeGreaterThan(0);
      // Abteilungsleitung ohne eigenen Tag: Liste leer, jedes Detail 404
      const antwort = await hole(
        "abteilungsleitung",
        `/api/v1/termine/mein?${FENSTER}`,
        MIT,
      );
      expect(((await antwort.json()) as Seite).termine).toEqual([]);
      for (const t of alle.termine) {
        const detail = await hole(
          "abteilungsleitung",
          `/api/v1/termine/${t.id}`,
          MIT,
        );
        expect(detail.status).toBe(404);
      }
      // Eltern A: das Detail eines Termins von Stufe B ist 404, auch mit App-Header
      expect(
        (await hole("elternA", `/api/v1/termine/${ids["B"]}`, MIT)).status,
      ).toBe(404);
    });
  });

  describe("Zwischenspeicher", () => {
    test("private, ETag und 304", async () => {
      const pfad = `/api/v1/termine/alle?${FENSTER}`;
      const erst = await hole("elternA", pfad);
      expect(erst.headers.get("Cache-Control")).toBe("private, no-cache");
      const etag = erst.headers.get("ETag")!;
      expect(etag).toBeTruthy();
      const nochmal = await hole("elternA", pfad, { "If-None-Match": etag });
      expect(nochmal.status).toBe(304);
    });
  });

  describe("Eingabe", () => {
    test.each([
      ["ohne von und bis", ""],
      ["von nach bis", "von=2027-03-07&bis=2027-03-01"],
      ["mehr als 400 Tage", "von=2027-01-01&bis=2028-03-01"],
      ["limit 0", `${FENSTER}&limit=0`],
      ["limit 101", `${FENSTER}&limit=101`],
      ["gefälschter Cursor", `${FENSTER}&nach=xyz`],
      ["fremder Parameter", `${FENSTER}&x=1`],
    ])("%s ist 400", async (_name, query) => {
      expect(
        (await hole("elternA", `/api/v1/termine/alle?${query}`)).status,
      ).toBe(400);
    });
  });

  describe("Abfragen je Aufruf", () => {
    test("höchstens 4 wie «Mein Kalender», nie je Zeile", async () => {
      const abfragen: string[] = [];
      const zaehlend = drizzle(sql, {
        schema,
        logger: { logQuery: (q) => abfragen.push(q) },
      }) as unknown as Db;
      const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
      const betrifft = (q: string) =>
        // Die Abfrage der Sitzung (Rollen und eigenes Kind, #644) zählt nicht mit
        /programm|person_tag|"kind"|leitung_anmeldung|anlass/.test(q) &&
        !q.includes("null::uuid");
      for (let i = 0; i < 5; i++) {
        await termin({
          titel: `Zusatz ${i}`,
          tags: [welt.stufeAId, welt.stufeBId],
          beginn: new Date(Date.UTC(2027, 2, 3, 8 + i)),
        });
      }
      const zaehle = async (persona: TerminePersona, art: string) => {
        abfragen.length = 0;
        const antwort = await zaehlApp.request(
          `/api/v1/termine/${art}?${FENSTER}`,
          { headers: konten[KONTO_FUER[persona]].headers },
        );
        expect(antwort.status).toBe(200);
        return abfragen.filter(betrifft).length;
      };
      const mein = await zaehle("leitungAElternB", "mein");
      for (const persona of ["leitungAElternB", "abteilungsleitung"] as const) {
        const n = await zaehle(persona, "alle");
        expect(n).toBeLessThanOrEqual(4);
        expect(n).toBeLessThanOrEqual(mein);
      }
    });
  });
});

describe("Alle Termine: Anlässe", () => {
  const FEN = "von=2027-04-05&bis=2027-04-05";
  beforeAll(async () => {
    const b = welt.stufeBId;
    const spezen: [string, string[], string, string[]][] = [
      ["Anlass angemeldet", [b], "angemeldet", []],
      // Der Tag des Termins trägt keine der Personen: sichtbar nur über den Anlass
      ["Anlass öffentlich", [funktionTagId], "oeffentlich", []],
      ["Anlass Tags", [b], "tags", [b]],
      ["Anlass ohne Tag", [], "angemeldet", []],
    ];
    for (const [i, [name, tags, sicht, sichtTags]] of spezen.entries()) {
      const id = await termin({
        titel: name,
        tags,
        beginn: new Date(Date.UTC(2027, 3, 5, 8 + i)),
      });
      await db.insert(schema.anlass).values({
        abteilungId: welt.testabteilungId,
        programmId: id,
        art: "anlass",
        sichtbarkeit: sicht as "angemeldet",
        sichtbarkeitTags: sichtTags,
      });
    }
  });

  test("Anlässe für Angemeldete und für alle stehen in «Alle», auch ohne eigenen Tag, nie ohne Tag am Termin (ausser für die Abteilungsleitung)", async () => {
    const s = await liste("elternA", FEN);
    expect(titel(s)).toEqual(["Anlass angemeldet", "Anlass öffentlich"]);
    expect(s.termine.every((t) => t.meine === false)).toBe(true);
    expect(s.termine.every((t) => t.tags.length === 0)).toBe(true);
    expect(s.termine.every((t) => t.anlass !== null)).toBe(true);
    // «Mein Kalender» bleibt leer
    expect((await liste("elternA", FEN, "mein")).termine).toEqual([]);
  });

  test("wer den Tag hat, sieht auch den Anlass mit Tags; meine ist wahr", async () => {
    const s = await liste("elternB", FEN);
    expect(titel(s)).toEqual([
      "Anlass angemeldet",
      "Anlass öffentlich",
      "Anlass Tags",
    ]);
    // «Anlass öffentlich» trägt keinen Tag der Person: Eltern sehen ihn nur über den Anlass, nicht in «Mein Kalender»
    expect(s.termine.map((t) => t.meine)).toEqual([true, false, true]);
  });

  test("die Abteilungsleitung sieht jeden, auch ohne Tag", async () => {
    expect(titel(await liste("abteilungsleitung", FEN))).toEqual([
      "Anlass angemeldet",
      "Anlass öffentlich",
      "Anlass Tags",
      "Anlass ohne Tag",
    ]);
  });

  test("fremde Abteilungen sehen nichts davon", async () => {
    expect(titel(await liste("fremdeEltern", FEN))).toEqual([]);
  });
});

describe("Alle Termine: Seitenwechsel", () => {
  const FEN = "von=2028-01-01&bis=2028-01-31";
  const erwartet: string[] = [];
  beforeAll(async () => {
    for (let i = 0; i < 7; i++) {
      erwartet.push(
        await termin({
          titel: `Seite ${i}`,
          tags: [welt.stufeAId, welt.stufeBId],
          beginn: new Date(Date.UTC(2028, 0, 8, 9 + i)),
        }),
      );
    }
  });

  test.each([1, 3, 50])(
    "Seitengrösse %i: ohne Lücke und Doppelte",
    async (limit) => {
      for (const persona of ["abteilungsleitung", "leitungAElternB"] as const) {
        const gesehen: string[] = [];
        let nach: string | null = null;
        do {
          const s: Seite = await liste(
            persona,
            `${FEN}&limit=${limit}${nach ? `&nach=${nach}` : ""}`,
          );
          expect(s.termine.length).toBeLessThanOrEqual(limit);
          expect(s.weitere).toBe(s.naechste !== null);
          gesehen.push(...s.termine.map((t) => t.id));
          nach = s.naechste;
        } while (nach);
        expect(gesehen).toEqual(erwartet);
      }
    },
  );
});
