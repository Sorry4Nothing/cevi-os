import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
import {
  BLOCKGROESSE,
  EXPORTE_PRO_FENSTER,
} from "../../src/routes/termine/admin-anmeldungen.js";
import { ladeSeiten } from "../../src/seiten.js";
import { ladeSeite } from "../../src/termine/anmeldungen-liste.js";
import { BOM, entschaerfe, zelle } from "../../src/termine/csv.js";
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
import { KONTO_FUER, TERMINE_PERSONAS, type TerminePersona } from "./matrix.js";

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
// Neue App je Test: Die Ratenbegrenzung des Exports zählt je Instanz
let app = erstelleApp({ ...optionen, db });
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
  app = erstelleApp({ ...optionen, db });
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Antworten der Routen sind in den Tests untypisiert
type Json = any;

const konto = (persona: TerminePersona) => konten[KONTO_FUER[persona]];
const anfrage = (
  persona: TerminePersona,
  pfad: string,
  zielApp: { request: typeof app.request } = app,
) => zielApp.request(pfad, { headers: konto(persona).headers });
const BASIS = (anlassId: string) =>
  `/api/v1/admin/anlaesse/${anlassId}/anmeldungen`;
const liste = async (anlassId: string, abfrage = "") => {
  const antwort = await anfrage(
    "abteilungsleitung",
    `${BASIS(anlassId)}${abfrage}`,
  );
  return { status: antwort.status, body: (await antwort.json()) as Json };
};

// Die Bytes der Datei, damit das BOM nicht verschwindet (Response.text() entfernt es)
async function ladeCsv(
  persona: TerminePersona,
  anlassId: string,
  abfrage = "",
  zielApp: { request: typeof app.request } = app,
) {
  const antwort = await anfrage(
    persona,
    `${BASIS(anlassId)}.csv${abfrage}`,
    zielApp,
  );
  const bytes = new Uint8Array(await antwort.arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { antwort, bytes, text, zeilen: text.split("\r\n") };
}

type FeldSpez = {
  schluessel: string;
  beschriftung: string;
  typ?: "text" | "ja_nein" | "auswahl";
  optionen?: string[];
};
const STANDARD_FELDER: FeldSpez[] = [
  { schluessel: "bemerkung", beschriftung: "Bemerkung" },
  { schluessel: "schwimmer", beschriftung: "Schwimmer", typ: "ja_nein" },
  {
    schluessel: "essen",
    beschriftung: "Essen",
    typ: "auswahl",
    optionen: ["Fleisch", "Vegi"],
  },
];
async function neuerAnlass(
  fuer: "kind" | "person" = "kind",
  felder: FeldSpez[] = STANDARD_FELDER,
  abteilungId = welt.testabteilungId,
) {
  const termin = await legeProgrammAn(db, { abteilungId });
  const [zeile] = await db
    .insert(schema.anlass)
    .values({
      abteilungId,
      programmId: termin.id,
      anmeldungFuer: fuer,
      anmeldungOffen: true,
      sichtbarkeit: "angemeldet",
    })
    .returning({ id: schema.anlass.id });
  if (felder.length > 0) {
    await db.insert(schema.anlassFeld).values(
      felder.map((f, i) => ({
        anlassId: zeile.id,
        schluessel: f.schluessel,
        beschriftung: f.beschriftung,
        typ: f.typ ?? "text",
        optionen: f.optionen ?? [],
        reihenfolge: i,
      })),
    );
  }
  return zeile.id;
}
const melde = async (
  anlassId: string,
  werte: {
    userId: string;
    kindId?: string | null;
    antworten?: Record<string, string | boolean>;
    status?: "angemeldet" | "abgemeldet";
    geaendertAm?: Date;
  },
) => {
  const [zeile] = await db
    .insert(schema.anlassAnmeldung)
    .values({
      anlassId,
      userId: werte.userId,
      kindId: werte.kindId ?? null,
      antworten: werte.antworten ?? {},
      status: werte.status ?? "angemeldet",
      ...(werte.geaendertAm && { geaendertAm: werte.geaendertAm }),
    })
    .returning({ id: schema.anlassAnmeldung.id });
  return zeile.id;
};
const setzeUser = (
  persona: Persona,
  werte: { name?: string; telefon?: string | null },
) =>
  db
    .update(schema.user)
    .set(werte)
    .where(eq(schema.user.id, konten[persona].id!));

describe("CSV-Zellen", () => {
  test("entschärft jedes Formelzeichen am Anfang, auch Tabulator und Zeilenumbruch", () => {
    for (const anfang of ["=", "+", "-", "@", "\t", "\r", "\n"]) {
      expect(entschaerfe(`${anfang}1+1`)).toBe(`'${anfang}1+1`);
    }
    expect(entschaerfe("1+1")).toBe("1+1");
    expect(entschaerfe("Müller")).toBe("Müller");
    expect(entschaerfe("")).toBe("");
    // Nur der Anfang zählt
    expect(entschaerfe("a=b")).toBe("a=b");
  });

  test("setzt Zellen mit Trenner, Anführungszeichen oder Zeilenumbruch in Anführungszeichen", () => {
    expect(zelle("a;b")).toBe('"a;b"');
    expect(zelle('sagt "hallo"')).toBe('"sagt ""hallo"""');
    expect(zelle("zwei\nZeilen")).toBe('"zwei\nZeilen"');
    // Erst entschärfen, dann quoten
    expect(zelle("=A;B")).toBe(`"'=A;B"`);
    expect(zelle("\nX")).toBe(`"'\nX"`);
    expect(zelle("einfach")).toBe("einfach");
  });
});

describe("Anmeldungen ansehen", () => {
  test("zeigt Konto-Daten live, Kind mit Stufe und die Antworten", async () => {
    const anlassId = await neuerAnlass();
    await setzeUser("elternA", {
      name: "Rösli Müller",
      telefon: "079 000 00 01",
    });
    const id = await melde(anlassId, {
      userId: konten.elternA.id!,
      kindId: welt.kindAId,
      antworten: { bemerkung: "Freue mich", schwimmer: true, essen: "Vegi" },
    });
    const a = await liste(anlassId);
    expect(a.status).toBe(200);
    expect(a.body.eintraege).toEqual([
      {
        id,
        person: {
          id: konten.elternA.id,
          name: "Rösli Müller",
          telefon: "079 000 00 01",
        },
        kind: {
          id: welt.kindAId,
          vorname: "Kind",
          nachname: "A",
          ceviName: null,
          stufe: "Stufe A",
        },
        status: "angemeldet",
        antworten: { bemerkung: "Freue mich", schwimmer: true, essen: "Vegi" },
        geaendertAm: expect.any(String),
      },
    ]);
    expect(a.body.summe).toEqual({ angemeldet: 1, abgemeldet: 0 });
    expect(a.body.weitere).toBe(false);
    expect(a.body.naechste).toBeNull();

    // Ändert das Konto, zeigt die Liste es sofort: Die Anmeldung hält keine Kopie
    await setzeUser("elternA", { name: "Rösli Meier", telefon: null });
    const b = await liste(anlassId);
    expect(b.body.eintraege[0].person).toMatchObject({
      name: "Rösli Meier",
      telefon: null,
    });
  });

  test("bei «person» ist kind null", async () => {
    const anlassId = await neuerAnlass("person");
    await melde(anlassId, { userId: konten.slA.id! });
    const a = await liste(anlassId);
    expect(a.body.eintraege).toHaveLength(1);
    expect(a.body.eintraege[0].kind).toBeNull();
  });

  test("Seitenwechsel: jede Anmeldung genau einmal, neueste zuerst, auch bei gleicher Zeit", async () => {
    const anlassId = await neuerAnlass("person");
    const gleich = new Date("2027-01-02T10:00:00.123456Z");
    const werte = [
      ["admin", new Date("2027-01-01T10:00:00Z")],
      ["slA", gleich],
      ["slB", gleich],
      ["leitendeA", new Date("2027-01-03T10:00:00Z")],
      ["leitendeB", new Date("2027-01-04T10:00:00Z")],
      ["elternA", gleich],
      ["elternB", new Date("2027-01-05T10:00:00Z")],
    ] as const;
    const ids = new Set<string>();
    for (const [persona, geaendertAm] of werte) {
      ids.add(
        await melde(anlassId, { userId: konten[persona].id!, geaendertAm }),
      );
    }
    const gesehen: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const a: { status: number; body: Json } = await liste(
        anlassId,
        `?limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      expect(a.status).toBe(200);
      expect(a.body.eintraege.length).toBeLessThanOrEqual(2);
      expect(a.body.summe.angemeldet).toBe(7);
      gesehen.push(...a.body.eintraege.map((e: { id: string }) => e.id));
      nach = a.body.naechste;
      expect(a.body.weitere).toBe(nach !== null);
      seiten++;
    } while (nach && seiten < 10);
    expect(seiten).toBe(4);
    expect(gesehen).toHaveLength(7);
    expect(new Set(gesehen)).toEqual(ids);
    // Zuletzt geänderte zuerst: der erste ist der von elternB, der letzte der von admin
    expect(gesehen[0]).toBe(
      (await liste(anlassId, "?limit=1")).body.eintraege[0].id,
    );
    const zeiten = (await liste(anlassId, "?limit=100")).body.eintraege.map(
      (e: { geaendertAm: string }) => e.geaendertAm,
    );
    expect([...zeiten].sort().reverse()).toEqual(zeiten);
  });

  test("Filter nach Status; die Summe zählt beide Status unabhängig vom Filter", async () => {
    const anlassId = await neuerAnlass("person");
    await melde(anlassId, { userId: konten.slA.id! });
    await melde(anlassId, { userId: konten.slB.id! });
    await melde(anlassId, {
      userId: konten.leitendeA.id!,
      status: "abgemeldet",
    });
    const vorgabe = await liste(anlassId);
    expect(vorgabe.body.eintraege.map((e: Json) => e.status)).toEqual([
      "angemeldet",
      "angemeldet",
    ]);
    const abgemeldet = await liste(anlassId, "?status=abgemeldet");
    expect(abgemeldet.body.eintraege).toHaveLength(1);
    expect(abgemeldet.body.eintraege[0]).toMatchObject({
      status: "abgemeldet",
      antworten: {},
    });
    const alle = await liste(anlassId, "?status=alle");
    expect(alle.body.eintraege).toHaveLength(3);
    for (const a of [vorgabe, abgemeldet, alle]) {
      expect(a.body.summe).toEqual({ angemeldet: 2, abgemeldet: 1 });
    }
  });

  test("ein Anlass ohne Anmeldungen ist eine leere Liste", async () => {
    const anlassId = await neuerAnlass();
    const a = await liste(anlassId);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      eintraege: [],
      summe: { angemeldet: 0, abgemeldet: 0 },
      weitere: false,
      naechste: null,
    });
  });

  test("ungültige Eingaben sind 400", async () => {
    const anlassId = await neuerAnlass();
    for (const abfrage of [
      "?limit=0",
      "?limit=101",
      "?limit=abc",
      "?status=egal",
      "?nach=kaputt",
      `?nach=${Buffer.from("[1,2]").toString("base64url")}`,
      "?unbekannt=1",
    ]) {
      expect((await liste(anlassId, abfrage)).status, abfrage).toBe(400);
    }
    expect(
      (await anfrage("abteilungsleitung", BASIS("kein-uuid"))).status,
    ).toBe(400);
    expect(
      (await anfrage("abteilungsleitung", `${BASIS(anlassId)}.csv?status=egal`))
        .status,
    ).toBe(400);
  });

  test("Liste: höchstens 2 Abfragen, unabhängig von der Seitengrösse", async () => {
    const anlassId = await neuerAnlass("person");
    for (const p of [
      "slA",
      "slB",
      "leitendeA",
      "leitendeB",
      "elternA",
    ] as const) {
      await melde(anlassId, { userId: konten[p].id! });
    }
    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    for (const limit of [1, 5]) {
      abfragen.length = 0;
      const antwort = await anfrage(
        "abteilungsleitung",
        `${BASIS(anlassId)}?limit=${limit}`,
        zaehlApp,
      );
      expect(antwort.status).toBe(200);
      expect(abfragen.filter((q) => /anlass/.test(q))).toHaveLength(2);
    }
  });
});

describe("Rechte", () => {
  test("alle 14 Personas, Liste und Export", async () => {
    const anlassId = await neuerAnlass();
    await melde(anlassId, { userId: konten.elternA.id!, kindId: welt.kindAId });
    const erwartet: Record<TerminePersona, number> = {
      abteilungsleitung: 200,
      adminOhneFaktor: 403,
      stufenleitungA: 403,
      stufenleitungB: 403,
      leitungA: 403,
      leitungB: 403,
      leitungAElternB: 403,
      elternA: 403,
      elternB: 403,
      passwortPflicht: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      fremdeAbteilungsleitung: 404,
      fremdeEltern: 404,
    };
    for (const persona of TERMINE_PERSONAS) {
      for (const pfad of [BASIS(anlassId), `${BASIS(anlassId)}.csv`]) {
        const antwort = await anfrage(persona, pfad);
        expect(antwort.status, `${persona} ${pfad}`).toBe(erwartet[persona]);
        await antwort.arrayBuffer();
      }
    }
  });

  test("ein Anlass der anderen Abteilung ist für die Leitung 404, ein unbekannter auch", async () => {
    const fremd = await neuerAnlass("kind", [], welt.demoAbteilungId);
    for (const id of [fremd, randomUUID()]) {
      expect((await anfrage("abteilungsleitung", BASIS(id))).status).toBe(404);
      expect(
        (await anfrage("abteilungsleitung", `${BASIS(id)}.csv`)).status,
      ).toBe(404);
    }
    // Die fremde Leitung sieht ihren eigenen
    expect(
      (await anfrage("fremdeAbteilungsleitung", BASIS(fremd))).status,
    ).toBe(200);
  });

  test("ein Export einer fremden Abteilung schreibt kein Protokoll", async () => {
    const fremd = await neuerAnlass("kind", [], welt.demoAbteilungId);
    await anfrage("abteilungsleitung", `${BASIS(fremd)}.csv`);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "anlass_export"),
          eq(schema.auditLog.zielId, fremd),
        ),
      );
    expect(zeilen).toHaveLength(0);
  });
});

describe("Export als CSV", () => {
  test("Kopfzeile aus den Feldbeschriftungen, BOM, Semikolon, Umlaute, Ja und Nein", async () => {
    const anlassId = await neuerAnlass();
    await setzeUser("elternA", {
      name: "Rösli Müller",
      telefon: "079 111 22 33",
    });
    await melde(anlassId, {
      userId: konten.elternA.id!,
      kindId: welt.kindAId,
      antworten: { bemerkung: "Freue mich", schwimmer: false, essen: "Vegi" },
    });
    const { antwort, bytes, text, zeilen } = await ladeCsv(
      "abteilungsleitung",
      anlassId,
    );
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(antwort.headers.get("content-disposition")).toBe(
      `attachment; filename="anlass-${anlassId}.csv"`,
    );
    expect(antwort.headers.get("cache-control")).toBe("no-store");
    // UTF-8-BOM
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.startsWith(BOM)).toBe(true);
    expect(zeilen[0]).toBe(
      `${BOM}Angemeldet von;Telefon;Kind Vorname;Kind Nachname;Kind Cevi-Name;Kind Stufe;Status;Geändert am;Bemerkung;Schwimmer;Essen`,
    );
    const zellen = zeilen[1]!.split(";");
    expect(zellen.slice(0, 7)).toEqual([
      "Rösli Müller",
      "079 111 22 33",
      "Kind",
      "A",
      "",
      "Stufe A",
      "angemeldet",
    ]);
    expect(zellen[7]).toMatch(/^\d{2}\.\d{2}\.\d{2,4}, \d{2}:\d{2}$/);
    expect(zellen.slice(8)).toEqual(["Freue mich", "Nein", "Vegi"]);
    // Letzte Zeile endet mit CRLF
    expect(zeilen).toHaveLength(3);
    expect(zeilen[2]).toBe("");
  });

  test("entschärft Formeln in Zellen und Kopfzeile; Trenner, Anführungszeichen und Zeilenumbruch bleiben Text", async () => {
    const anlassId = await neuerAnlass("person", [
      { schluessel: "a", beschriftung: "=Bemerkung" },
      { schluessel: "b", beschriftung: "Zweite" },
      { schluessel: "c", beschriftung: "Dritte" },
      { schluessel: "d", beschriftung: "Vierte" },
    ]);
    await setzeUser("slA", {
      name: "=cmd|' /C calc'!A0",
      telefon: "+41 79 000 00 00",
    });
    await melde(anlassId, {
      userId: konten.slA.id!,
      antworten: {
        a: "=1+1",
        b: "-5;@x",
        c: 'sagt "hallo"\nzweite Zeile',
        d: "\t=tab",
      },
    });
    const { text } = await ladeCsv("abteilungsleitung", anlassId);
    expect(text).toContain(";'=Bemerkung;Zweite;Dritte;Vierte\r\n");
    // Name und Telefon aus dem Konto sind ebenfalls geschützt
    expect(text).toContain("\r\n'=cmd|' /C calc'!A0;'+41 79 000 00 00;");
    expect(text).toContain(
      `;'=1+1;"'-5;@x";"sagt ""hallo""\nzweite Zeile";'\t=tab\r\n`,
    );
  });

  test("Filter «alle» nimmt die Abgemeldeten mit, die Vorgabe nicht", async () => {
    const anlassId = await neuerAnlass("person");
    await melde(anlassId, {
      userId: konten.slA.id!,
      antworten: { bemerkung: "x" },
    });
    await melde(anlassId, { userId: konten.slB.id!, status: "abgemeldet" });
    const vorgabe = await ladeCsv("abteilungsleitung", anlassId);
    expect(vorgabe.zeilen.filter(Boolean)).toHaveLength(2);
    expect(vorgabe.text).not.toContain("abgemeldet");
    const alle = await ladeCsv("abteilungsleitung", anlassId, "?status=alle");
    expect(alle.zeilen.filter(Boolean)).toHaveLength(3);
    expect(alle.text).toContain(";abgemeldet;");
    const nurAb = await ladeCsv(
      "abteilungsleitung",
      anlassId,
      "?status=abgemeldet",
    );
    expect(nurAb.zeilen.filter(Boolean)).toHaveLength(2);
  });

  test("ohne Anmeldungen: nur die Kopfzeile", async () => {
    const anlassId = await neuerAnlass();
    const { antwort, zeilen } = await ladeCsv("abteilungsleitung", anlassId);
    expect(antwort.status).toBe(200);
    expect(zeilen.filter(Boolean)).toHaveLength(1);
  });

  test("mehr als ein Block: vollständig, ohne Doppelte, in vier Abfragen und mit Protokoll ohne Inhalt", async () => {
    const anlassId = await neuerAnlass("kind", [
      { schluessel: "bemerkung", beschriftung: "Bemerkung" },
    ]);
    const anzahl = BLOCKGROESSE * 2 + 100;
    const kinder = await db
      .insert(schema.kind)
      .values(
        Array.from({ length: anzahl }, (_, i) => ({
          abteilungId: welt.testabteilungId,
          vorname: `K${String(i).padStart(5, "0")}`,
          nachname: "Export",
          stufeId: welt.stufeAId,
        })),
      )
      .returning({ id: schema.kind.id });
    await db.insert(schema.anlassAnmeldung).values(
      kinder.map((k, i) => ({
        anlassId,
        userId: konten.elternA.id!,
        kindId: k.id,
        antworten: { bemerkung: `Antwort ${i}` },
        status: "angemeldet" as const,
      })),
    );
    // Eine Abgemeldete zählt nicht mit
    await melde(anlassId, { userId: konten.slA.id!, status: "abgemeldet" });

    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    const { antwort, zeilen } = await ladeCsv(
      "abteilungsleitung",
      anlassId,
      "",
      zaehlApp,
    );
    expect(antwort.status).toBe(200);
    const daten = zeilen.filter(Boolean).slice(1);
    expect(daten).toHaveLength(anzahl);
    const vornamen = daten.map((z) => z.split(";")[2]);
    expect(new Set(vornamen).size).toBe(anzahl);
    // 1 für den Anlass, je 1 für die Blöcke zu 500, 500 und 100 Zeilen; kein Zugriff je Zeile
    expect(abfragen.filter((q) => /"anlass_anmeldung"/.test(q))).toHaveLength(
      4,
    );

    const protokoll = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "anlass_export"),
          eq(schema.auditLog.zielId, anlassId),
        ),
      );
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]).toMatchObject({
      akteurId: konten.admin.id,
      abteilungId: welt.testabteilungId,
      zielTyp: "anlass",
      details: { anzahl },
    });
    // Nie Namen oder Antworten
    expect(JSON.stringify(protokoll[0])).not.toMatch(/Export|Antwort/);
  });

  test("der Export sortiert nach ID: Eine Änderung verschiebt nur die Liste, nie den Export", async () => {
    const anlassId = await neuerAnlass("person", []);
    const ids = [
      await melde(anlassId, { userId: konten.slA.id! }),
      await melde(anlassId, { userId: konten.slB.id! }),
    ];
    // Die Liste sortiert nach Änderungszeit, der Export nach ID: eine Änderung verschiebt nur die Liste
    await db
      .update(schema.anlassAnmeldung)
      .set({ geaendertAm: new Date("2030-01-01T00:00:00Z") })
      .where(eq(schema.anlassAnmeldung.id, ids[0]!));
    const { zeilen } = await ladeCsv("abteilungsleitung", anlassId);
    expect(zeilen.filter(Boolean).slice(1)).toHaveLength(2);
    const seite = await ladeSeite(db, anlassId, "angemeldet", 10);
    expect(seite.eintraege[0]!.id).toBe(ids[0]);
  });

  test("Ratenbegrenzung: ab dem 11. Export in 10 Minuten 429, nur für diese Person", async () => {
    const anlassId = await neuerAnlass();
    for (let i = 0; i < EXPORTE_PRO_FENSTER; i++) {
      const { antwort } = await ladeCsv("abteilungsleitung", anlassId);
      expect(antwort.status).toBe(200);
    }
    const zuViel = await ladeCsv("abteilungsleitung", anlassId);
    expect(zuViel.antwort.status).toBe(429);
    // Die Liste bleibt frei
    expect((await liste(anlassId)).status).toBe(200);
    // Ein verbotener Aufruf verbraucht kein Kontingent der Leitung
    expect((await ladeCsv("elternA", anlassId)).antwort.status).toBe(403);
  });
});

describe("Gesundheitsdaten", () => {
  test("ein Feld nach Gesundheitsdaten lässt sich nicht anlegen, der Export hat so nie eine solche Spalte", async () => {
    const anlassId = await neuerAnlass();
    const antwort = await app.request(
      `/api/v1/admin/anlaesse/${anlassId}/felder`,
      {
        method: "PUT",
        headers: {
          ...konto("abteilungsleitung").headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          felder: [
            { schluessel: "allergien", beschriftung: "Allergien", typ: "text" },
          ],
        }),
      },
    );
    expect(antwort.status).toBe(400);
    expect((await antwort.json()).code).toBe("FELD_GESUNDHEIT");
    const { zeilen } = await ladeCsv("abteilungsleitung", anlassId);
    expect(zeilen[0]).not.toMatch(/allerg/i);
  });
});
