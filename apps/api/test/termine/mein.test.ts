import { randomUUID } from "node:crypto";
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
  status: string;
  beginn: string | null;
  tagVon: string | null;
  tags: { id: string; name: string; typ: string }[];
  kinder: { id: string; vorname: string; status: string | null }[];
  anlass: unknown;
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
const liste = async (persona: TerminePersona, query: string) => {
  const antwort = await hole(persona, `/api/v1/termine/mein?${query}`);
  expect(antwort.status).toBe(200);
  return (await antwort.json()) as Seite;
};
const titel = (s: Seite) => s.termine.map((t) => t.titel);

interface TerminSpez {
  titel: string;
  tags: string[];
  abteilungId?: string;
  sichtbarkeit?: "intern" | "leitende" | "eltern";
  status?: "aktiv" | "abgesagt" | "pruefen";
  beginn?: Date;
  tagVon?: string;
  tagBis?: string;
}
async function termin(spez: TerminSpez) {
  const t = await legeProgrammAn(db, {
    abteilungId: spez.abteilungId ?? welt.testabteilungId,
    sichtbarkeit: spez.sichtbarkeit ?? "eltern",
    titel: spez.titel,
    beginn: spez.beginn,
    tagVon: spez.tagVon,
    tagBis: spez.tagBis,
  });
  if (spez.status) {
    await db
      .update(schema.programm)
      .set({ status: spez.status })
      .where(eq(schema.programm.id, t.id));
  }
  if (spez.tags.length > 0) {
    await db
      .insert(schema.programmTag)
      .values(spez.tags.map((tagId) => ({ programmId: t.id, tagId })));
  }
  return t.id;
}

const FENSTER = "von=2027-03-01&bis=2027-03-07";

describe("Mein Kalender: wer welche Termine sieht", () => {
  let ids: Record<string, string>;
  beforeAll(async () => {
    const { stufeAId: a, stufeBId: b, demoStufeId: d } = welt;
    // Eine Stunde Abstand: Die Liste muss in dieser Reihenfolge antworten
    const spezen: [string, Omit<TerminSpez, "titel" | "beginn">][] = [
      ["A", { tags: [a] }],
      ["B", { tags: [b] }],
      ["AB", { tags: [a, b] }],
      ["ohne Tag", { tags: [] }],
      ["A abgesagt", { tags: [a], status: "abgesagt" }],
      ["A intern", { tags: [a], sichtbarkeit: "intern" }],
      ["A leitende", { tags: [a], sichtbarkeit: "leitende" }],
      ["Team", { tags: [funktionTagId] }],
      [
        "Demo",
        {
          tags: [d],
          abteilungId: welt.demoAbteilungId,
          sichtbarkeit: "eltern",
        },
      ],
    ];
    ids = {};
    for (const [i, [name, spez]] of spezen.entries()) {
      ids[name] = await termin({
        ...spez,
        titel: name,
        beginn: new Date(Date.UTC(2027, 2, 1, 8 + i)),
      });
    }
    // Ein Mitglied des Leitungsteams: zeigt, dass jeder Tag-Typ zählt
    await db.insert(schema.personTag).values({
      userId: konten[KONTO_FUER.leitungB].id!,
      tagId: funktionTagId,
    });
  });

  // Sichtbar ist, was einen Tag der Person trägt; «intern» nie, «leitende» nur über eigene Tags, ohne Tag niemand (auch nicht die Abteilungsleitung)
  const SICHT: Record<
    Exclude<TerminePersona, "passwortPflicht" | "deaktiviert" | "ohneLogin">,
    string[]
  > = {
    abteilungsleitung: [],
    adminOhneFaktor: [],
    stufenleitungA: ["A", "AB", "A abgesagt", "A leitende"],
    stufenleitungB: ["B", "AB"],
    leitungA: ["A", "AB", "A abgesagt", "A leitende"],
    leitungB: ["B", "AB", "Team"],
    leitungAElternB: ["A", "B", "AB", "A abgesagt", "A leitende"],
    elternA: ["A", "AB", "A abgesagt"],
    elternB: ["B", "AB"],
    fremdeAbteilungsleitung: [],
    fremdeEltern: ["Demo"],
  };

  test.each(Object.entries(SICHT))("%s sieht %j", async (persona, erwartet) => {
    const s = await liste(persona as TerminePersona, FENSTER);
    expect(titel(s)).toEqual(erwartet);
    expect(s.weitere).toBe(false);
    expect(s.naechste).toBeNull();
  });

  test("ein Termin mit zwei passenden Tags erscheint einmal, mit beiden Tags", async () => {
    const s = await liste("leitungAElternB", FENSTER);
    const ab = s.termine.filter((t) => t.titel === "AB");
    expect(ab).toHaveLength(1);
    expect(ab[0].tags.map((t) => t.name).sort()).toEqual([
      "Stufe A",
      "Stufe B",
    ]);
  });

  test("die Tags zeigen nur, was die Person selbst hat", async () => {
    const s = await liste("elternA", FENSTER);
    expect(s.termine.find((t) => t.titel === "AB")?.tags).toEqual([
      { id: welt.stufeAId, name: "Stufe A", typ: "stufe" },
    ]);
  });

  test("Felder: abgesagter Termin bleibt sichtbar, Ort und Anlass sind nullbar, keine Fremdfelder", async () => {
    const s = await liste("elternA", FENSTER);
    const ab = s.termine.find((t) => t.titel === "A abgesagt")!;
    expect(ab.status).toBe("abgesagt");
    expect(ab.anlass).toBeNull();
    expect(Object.keys(ab).sort()).toEqual(
      [
        "anlass",
        "beginn",
        "ende",
        "ganztaegig",
        "id",
        "kinder",
        "ort",
        "status",
        "tagBis",
        "tagVon",
        "tags",
        "titel",
      ].sort(),
    );
  });

  test("Kinder und Antwort kommen gebündelt: eigenes Kind in der Stufe des Termins", async () => {
    await db.insert(schema.teilnahme).values({
      programmId: ids["A"],
      kindId: welt.kindAId,
      status: "ja",
    });
    const s = await liste("elternA", FENSTER);
    const kinderVon = (name: string) =>
      s.termine.find((t) => t.titel === name)!.kinder;
    expect(kinderVon("A")).toEqual([
      { id: welt.kindAId, vorname: "Kind", status: "ja" },
    ]);
    expect(kinderVon("AB")).toEqual([
      { id: welt.kindAId, vorname: "Kind", status: null },
    ]);
    // Leitende ohne eigenes Kind: keine Kinder
    expect(
      (await liste("leitungA", FENSTER)).termine.every(
        (t) => t.kinder.length === 0,
      ),
    ).toBe(true);
  });

  test("Eltern ohne aktives Kind sehen nichts mehr", async () => {
    await db
      .update(schema.kind)
      .set({ inaktivSeit: new Date() })
      .where(eq(schema.kind.id, welt.kindBId));
    try {
      expect(titel(await liste("elternB", FENSTER))).toEqual([]);
    } finally {
      await db
        .update(schema.kind)
        .set({ inaktivSeit: null })
        .where(eq(schema.kind.id, welt.kindBId));
    }
    expect(titel(await liste("elternB", FENSTER))).toEqual(["B", "AB"]);
  });

  test("Tags kommen nur aus der eigenen Abteilung", async () => {
    // Tag der Demo-Abteilung an einem Termin der Testabteilung (nur bei Dateninkonsistenz möglich): erscheint nie
    const id = await termin({
      titel: "Fremder Tag",
      tags: [welt.demoStufeId],
      beginn: new Date(Date.UTC(2027, 2, 2, 8)),
    });
    expect(titel(await liste("fremdeEltern", FENSTER))).not.toContain(
      "Fremder Tag",
    );
    expect(titel(await liste("elternA", FENSTER))).not.toContain("Fremder Tag");
    await db.delete(schema.programm).where(eq(schema.programm.id, id));
  });

  test("die Abteilungsleitung sieht mit eigenen Tags genau diese Termine", async () => {
    await db.insert(schema.personTag).values({
      userId: konten[KONTO_FUER.fremdeAbteilungsleitung].id!,
      tagId: welt.demoStufeId,
    });
    expect(titel(await liste("fremdeAbteilungsleitung", FENSTER))).toEqual([
      "Demo",
    ]);
  });

  test("ohne Anmeldung 401, mit Passwortpflicht 403, deaktiviert 401", async () => {
    const pfad = `/api/v1/termine/mein?${FENSTER}`;
    expect((await hole("ohneLogin", pfad)).status).toBe(401);
    expect((await hole("deaktiviert", pfad)).status).toBe(401);
    expect((await hole("passwortPflicht", pfad)).status).toBe(403);
  });

  describe("Detail", () => {
    const detail = (persona: TerminePersona, id: string, kopf: object = {}) =>
      hole(persona, `/api/v1/termine/${id}`, kopf);

    test("sichtbar: alle Felder der Liste plus Eckdaten, Teilnahmefenster und Anlass", async () => {
      const antwort = await detail("elternA", ids["A"]);
      expect(antwort.status).toBe(200);
      const t = (await antwort.json()) as Record<string, unknown>;
      expect(t).toMatchObject({
        id: ids["A"],
        titel: "A",
        status: "aktiv",
        ort: null,
        anlass: null,
        treffpunkt: null,
        schlussOrt: null,
        schlussZeit: null,
        mitnehmen: null,
        // Der Termin liegt im Jahr 2027: noch offen für Antworten
        teilnahmeOffen: true,
        kinder: [{ id: welt.kindAId, vorname: "Kind", status: "ja" }],
        tags: [{ id: welt.stufeAId, name: "Stufe A", typ: "stufe" }],
      });
      // Eltern bekommen die eigene Anmeldung als Leitung nie
      expect("eigeneAnmeldung" in t).toBe(false);
    });

    test("ein abgesagter Termin ist sichtbar, aber nicht mehr offen", async () => {
      const t = (await (await detail("elternA", ids["A abgesagt"])).json()) as {
        status: string;
        teilnahmeOffen: boolean;
      };
      expect(t).toMatchObject({ status: "abgesagt", teilnahmeOffen: false });
    });

    test("Unsichtbares ist 404: ohne Tag, fremde Stufe, intern, Abteilungsleitung ohne Tag, fremde Abteilung, unbekannt", async () => {
      for (const [persona, name] of [
        ["elternA", "ohne Tag"],
        ["elternA", "B"],
        ["elternA", "A intern"],
        ["elternA", "A leitende"],
        ["elternA", "Team"],
        ["leitungA", "A intern"],
        ["abteilungsleitung", "A"],
        ["fremdeEltern", "A"],
        ["fremdeAbteilungsleitung", "A"],
      ] as [TerminePersona, string][]) {
        expect(
          (await detail(persona, ids[name])).status,
          `${persona} ${name}`,
        ).toBe(404);
      }
      expect((await detail("elternA", randomUUID())).status).toBe(404);
      expect((await detail("elternA", "kein-uuid")).status).toBe(400);
    });

    test("Leitende sehen ihre eigene Anmeldung, offen oder gemeldet", async () => {
      const lesen = async () =>
        (
          (await (await detail("leitungA", ids["A"])).json()) as {
            eigeneAnmeldung?: string;
          }
        ).eigeneAnmeldung;
      expect(await lesen()).toBe("offen");
      await db.insert(schema.leitungAnmeldung).values({
        programmId: ids["A"],
        userId: konten[KONTO_FUER.leitungA].id!,
        status: "ja",
      });
      expect(await lesen()).toBe("ja");
      // Eine Leitung der Stufe B hat für einen Termin der Stufe A keine Anmeldung
      const b = await detail("leitungB", ids["AB"]);
      expect(
        ((await b.json()) as { eigeneAnmeldung?: string }).eigeneAnmeldung,
      ).toBe("offen");
      expect((await detail("leitungB", ids["A"])).status).toBe(404);
    });

    test("Eckdaten der Stufenseite, wenn Tag und Stufe passen", async () => {
      await db.insert(schema.programmEckdaten).values({
        stufeId: welt.stufeBId,
        tag: "2027-03-01",
        treffpunkt: "14:00 Uhr beim Brunnen",
        mitnehmen: "Zvieri",
      });
      // Termin «B» liegt am 1. März 2027 um 09:00 UTC
      const t = (await (await detail("elternB", ids["B"])).json()) as {
        treffpunkt: string | null;
        mitnehmen: string | null;
      };
      expect(t).toMatchObject({
        treffpunkt: "14:00 Uhr beim Brunnen",
        mitnehmen: "Zvieri",
      });
      // Für die Stufe A gibt es nichts
      const a = (await (await detail("elternA", ids["A"])).json()) as {
        treffpunkt: string | null;
      };
      expect(a.treffpunkt).toBeNull();
    });
  });

  describe("Zwischenspeicher", () => {
    test("Liste und Detail: private, ETag, bei gleichem Stand 304 ohne Inhalt", async () => {
      for (const pfad of [
        `/api/v1/termine/mein?${FENSTER}`,
        `/api/v1/termine/${ids["AB"]}`,
      ]) {
        const erste = await hole("elternA", pfad);
        expect(erste.status).toBe(200);
        expect(erste.headers.get("Cache-Control")).toBe("private, no-cache");
        const stempel = erste.headers.get("ETag");
        expect(stempel).toBeTruthy();
        const zweite = await hole("elternA", pfad, {
          "If-None-Match": stempel!,
        });
        expect(zweite.status).toBe(304);
        expect(await zweite.text()).toBe("");
        expect(zweite.headers.get("Cache-Control")).toBe("private, no-cache");
        // Andere Person, anderer Inhalt: kein 304 mit fremdem Stempel
        const andere = await hole("leitungAElternB", pfad, {
          "If-None-Match": stempel!,
        });
        expect(andere.status).not.toBe(304);
      }
    });

    test("ändert sich ein Termin, ändert sich der ETag", async () => {
      const pfad = `/api/v1/termine/mein?${FENSTER}`;
      const vorher = (await hole("elternB", pfad)).headers.get("ETag");
      await db
        .update(schema.programm)
        .set({ titel: "B umbenannt" })
        .where(eq(schema.programm.id, ids["B"]));
      const nachher = await hole("elternB", pfad, {
        "If-None-Match": vorher!,
      });
      expect(nachher.status).toBe(200);
      expect(nachher.headers.get("ETag")).not.toBe(vorher);
    });
  });

  describe("Abfragen je Aufruf", () => {
    test("Liste höchstens 3, Detail höchstens 5, nie je Zeile", async () => {
      const abfragen: string[] = [];
      const zaehlend = drizzle(sql, {
        schema,
        logger: { logQuery: (q) => abfragen.push(q) },
      }) as unknown as Db;
      const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
      const betrifft = (q: string) =>
        /programm|person_tag|"kind"|leitung_anmeldung/.test(q);
      // Eine weitere Seite Termine, damit je Zeile gezählt auffiele
      for (let i = 0; i < 5; i++) {
        await termin({
          titel: `Zusatz ${i}`,
          tags: [welt.stufeAId, welt.stufeBId],
          beginn: new Date(Date.UTC(2027, 2, 3, 8 + i)),
        });
      }
      const liefere = async (pfad: string) => {
        abfragen.length = 0;
        const antwort = await zaehlApp.request(pfad, {
          headers: konten[KONTO_FUER.leitungAElternB].headers,
        });
        expect(antwort.status).toBe(200);
        return abfragen.filter(betrifft).length;
      };
      expect(
        await liefere(`/api/v1/termine/mein?${FENSTER}`),
      ).toBeLessThanOrEqual(3);
      expect(await liefere(`/api/v1/termine/${ids["AB"]}`)).toBeLessThanOrEqual(
        5,
      );
    });
  });
});

describe("Mein Kalender: Zeitraum in Zürcher Zeit", () => {
  const Z: TerminePersona[] = ["elternA"];
  beforeAll(async () => {
    const a = [welt.stufeAId];
    const bei = (iso: string) => new Date(iso);
    await Promise.all([
      // Vor der Umstellung auf Sommerzeit (28. März 2027, 02:00): 00:30 Uhr in Zürich am 28. März (Winterzeit, UTC+1)
      termin({
        titel: "vor Umstellung",
        tags: a,
        beginn: bei("2027-03-27T23:30:00Z"),
      }),
      // Danach UTC+2: 22:30 UTC am 28. März ist 00:30 Uhr am 29. März
      termin({
        titel: "nach Umstellung",
        tags: a,
        beginn: bei("2027-03-28T22:30:00Z"),
      }),
      // Rückstellung am 31. Oktober 2027 (03:00 Sommerzeit auf 02:00): 22:30 UTC am 30. Oktober ist 00:30 Uhr am 31. Oktober (UTC+2)
      termin({
        titel: "vor Rückstellung",
        tags: a,
        beginn: bei("2027-10-30T22:30:00Z"),
      }),
      // 23:30 UTC am 31. Oktober ist 00:30 Uhr am 1. November (UTC+1)
      termin({
        titel: "nach Rückstellung",
        tags: a,
        beginn: bei("2027-10-31T23:30:00Z"),
      }),
      termin({
        titel: "Lager",
        tags: a,
        tagVon: "2027-05-01",
        tagBis: "2027-05-03",
      }),
    ]);
  });
  const tage = async (von: string, bis: string, p: TerminePersona = Z[0]) =>
    titel(await liste(p, `von=${von}&bis=${bis}`));

  test("Sommerzeit: der Kalendertag zählt in Zürcher Zeit, nicht in UTC", async () => {
    expect(await tage("2027-03-28", "2027-03-28")).toEqual(["vor Umstellung"]);
    expect(await tage("2027-03-29", "2027-03-29")).toEqual(["nach Umstellung"]);
    expect(await tage("2027-03-27", "2027-03-27")).toEqual([]);
    expect(await tage("2027-03-27", "2027-03-29")).toEqual([
      "vor Umstellung",
      "nach Umstellung",
    ]);
  });

  test("Winterzeit: Rückstellung im Oktober", async () => {
    expect(await tage("2027-10-31", "2027-10-31")).toEqual([
      "vor Rückstellung",
    ]);
    expect(await tage("2027-10-30", "2027-10-30")).toEqual([]);
    expect(await tage("2027-11-01", "2027-11-01")).toEqual([
      "nach Rückstellung",
    ]);
  });

  test("ein mehrtägiger Termin erscheint an jedem seiner Tage, beide Grenzen inklusive", async () => {
    for (const tag of ["2027-05-01", "2027-05-02", "2027-05-03"]) {
      expect(await tage(tag, tag)).toEqual(["Lager"]);
    }
    expect(await tage("2027-04-30", "2027-04-30")).toEqual([]);
    expect(await tage("2027-05-04", "2027-05-04")).toEqual([]);
    const s = await liste("elternA", "von=2027-05-02&bis=2027-05-02");
    expect(s.termine[0]).toMatchObject({
      ganztaegig: true,
      beginn: null,
      ende: null,
      tagVon: "2027-05-01",
      tagBis: "2027-05-03",
    });
  });

  test("Zeitraum und Eingaben werden geprüft", async () => {
    const status = async (q: string) =>
      (await hole("elternA", `/api/v1/termine/mein?${q}`)).status;
    // 400 Tage (inklusive beider Grenzen) gehen, 401 nicht
    expect(await status("von=2027-01-01&bis=2028-02-04")).toBe(200);
    expect(await status("von=2027-01-01&bis=2028-02-05")).toBe(400);
    // Schaltjahr 2028 zählt mit
    expect(await status("von=2028-01-01&bis=2028-02-04")).toBe(200);
    expect(await status("von=2027-03-02&bis=2027-03-01")).toBe(400);
    expect(await status("von=2027-03-01")).toBe(400);
    expect(await status("bis=2027-03-01")).toBe(400);
    expect(await status("von=0000-01-01&bis=2027-03-01")).toBe(400);
    expect(await status("von=2027-02-30&bis=2027-03-01")).toBe(400);
    expect(await status(`${FENSTER}&limit=0`)).toBe(400);
    expect(await status(`${FENSTER}&limit=101`)).toBe(400);
    expect(await status(`${FENSTER}&limit=abc`)).toBe(400);
    expect(await status(`${FENSTER}&limit=100`)).toBe(200);
    expect(await status(`${FENSTER}&limit=1`)).toBe(200);
    expect(await status(`${FENSTER}&alle=1`)).toBe(400);
    expect(await status(`${FENSTER}&nach=%25%25`)).toBe(400);
    const gefaelscht = (wert: unknown) =>
      Buffer.from(JSON.stringify(wert)).toString("base64url");
    expect(await status(`${FENSTER}&nach=${gefaelscht([1, "x"])}`)).toBe(400);
    expect(await status(`${FENSTER}&nach=${gefaelscht({ a: 1 })}`)).toBe(400);
    expect(
      await status(`${FENSTER}&nach=${gefaelscht([-1, randomUUID()])}`),
    ).toBe(400);
    expect(
      await status(`${FENSTER}&nach=${gefaelscht([1e300, randomUUID()])}`),
    ).toBe(400);
  });
});

describe("Mein Kalender: Seitenwechsel", () => {
  const FEN = "von=2028-01-01&bis=2028-01-31";
  const erwartet: string[] = [];
  beforeAll(async () => {
    // Sieben Termine, vier davon zur selben Zeit: Der Gleichstand entscheidet die ID
    const gleich = new Date("2028-01-08T10:00:00Z");
    const zeiten = [
      new Date("2028-01-08T09:00:00Z"),
      gleich,
      gleich,
      gleich,
      gleich,
      new Date("2028-01-08T11:00:00Z"),
      new Date("2028-01-09T08:00:00Z"),
    ];
    const reihe: { id: string; beginn: Date }[] = [];
    for (const [i, beginn] of zeiten.entries()) {
      reihe.push({
        id: await termin({
          titel: `Seite ${i}`,
          tags: [welt.stufeAId, welt.stufeBId],
          beginn,
        }),
        beginn,
      });
    }
    reihe.sort(
      (x, y) =>
        x.beginn.getTime() - y.beginn.getTime() || (x.id < y.id ? -1 : 1),
    );
    erwartet.push(...reihe.map((r) => r.id));
  });

  test.each([1, 2, 3, 7, 50])(
    "Seitengrösse %i: ohne Lücke und Doppelte, in fester Reihenfolge",
    async (limit) => {
      const gesehen: string[] = [];
      let nach: string | null = null;
      let seiten = 0;
      do {
        const s: Seite = await liste(
          // Mehrere Tags und zwei Stufen: ein Termin darf nie doppelt kommen
          "leitungAElternB",
          `${FEN}&limit=${limit}${nach ? `&nach=${nach}` : ""}`,
        );
        expect(s.termine.length).toBeLessThanOrEqual(limit);
        expect(s.weitere).toBe(s.naechste !== null);
        gesehen.push(...s.termine.map((t) => t.id));
        nach = s.naechste;
        seiten += 1;
      } while (nach && seiten < 20);
      expect(gesehen).toEqual(erwartet);
      expect(seiten).toBe(Math.ceil(7 / limit));
    },
  );

  test("Standardgrösse ist 50; eine volle letzte Seite meldet keine weitere", async () => {
    const s = await liste("leitungAElternB", `${FEN}&limit=7`);
    expect(s.termine).toHaveLength(7);
    expect(s.weitere).toBe(false);
    expect(s.naechste).toBeNull();
    expect((await liste("leitungAElternB", FEN)).termine).toHaveLength(7);
  });

  test("ein Cursor mit anderem Zeitraum liefert den Rest dieses Zeitraums", async () => {
    const erste = await liste("leitungAElternB", `${FEN}&limit=3`);
    const rest = await liste(
      "leitungAElternB",
      `von=2028-01-08&bis=2028-01-08&nach=${erste.naechste}`,
    );
    expect(rest.termine.map((t) => t.id)).toEqual(erwartet.slice(3, 6));
  });
});
