import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSchichtplan } from "../../src/lager/schichtplan.js";
import { VORSCHLAEGE_PRO_MINUTE } from "../../src/routes/lager/schichtplan.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Jede Abfrage an die Datenbank zählt mit: Der Test der Datenbanklast vergleicht die Zahl für kleine und grosse Pläne
let abfragen = 0;
const sql = postgres(API_URL, {
  debug: () => {
    abfragen++;
  },
});
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const L = (id: string) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
const UNBEKANNT = "00000000-0000-4000-8000-000000000000";

// Ein frisches Lager mit den vier Rollen der Personas (bei `alle`) oder nur der Lagerleitung: Das Lager nimmt sonst jede Persona als Kandidat in den Vorschlag auf
async function legeLager(
  alle: boolean,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Schichtlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    if (!alle && persona !== "lagerleitung") continue;
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
  return id;
}

async function mitglied(lagerId: string, name = "Mitglied Test") {
  const [p] = await db
    .insert(schema.user)
    .values({
      name,
      email: `${randomUUID()}@example.org`,
      username: `m.${randomUUID().slice(0, 8)}`,
      abteilungId: welt.testabteilungId,
      mussPasswortAendern: false,
    })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId, personId: p!.id, rolle: "team" });
  return p!.id;
}
async function kind(lagerId: string, nachname: string, abgewaehlt = false) {
  const [z] = await db
    .insert(schema.teilnehmer)
    .values({
      lagerId,
      vorname: "Kind",
      nachname,
      stufe: "Wolf",
      ceviName: "Geheim",
      abgewaehlt,
      lagerSeq: 0,
    })
    .returning({ id: schema.teilnehmer.id });
  return z!.id;
}

// Lagertage und Abschnitte direkt in der Datenbank; die Abschnitte heissen morgen, mittag, abend, nacht in dieser Reihenfolge
async function zeitplan(lagerId: string, tage = 7) {
  const t = await db
    .insert(schema.lagertag)
    .values(
      Array.from({ length: tage }, (_, i) => ({
        lagerId,
        datum: new Date(Date.UTC(2027, 6, 10 + i)).toISOString().slice(0, 10),
        lagerSeq: 0,
      })),
    )
    .returning({ id: schema.lagertag.id, datum: schema.lagertag.datum });
  const a = await db
    .insert(schema.tagesabschnitt)
    .values(
      ["morgen", "mittag", "abend", "nacht"].map((name, i) => ({
        lagerId,
        name,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    )
    .returning({
      id: schema.tagesabschnitt.id,
      name: schema.tagesabschnitt.name,
    });
  return {
    tage: t.sort((x, y) => (x.datum < y.datum ? -1 : 1)).map((x) => x.id),
    abschnitt: Object.fromEntries(a.map((x) => [x.name, x.id])) as Record<
      "morgen" | "mittag" | "abend" | "nacht",
      string
    >,
  };
}
type Zeitplan = Awaited<ReturnType<typeof zeitplan>>;

const dienstAnlegen = async (
  lagerId: string,
  abschnittId: string,
  name: string,
  mindest = 1,
  nacht = false,
) => {
  const a = await anfrage(
    leiter(),
    "POST",
    `${L(lagerId)}/schichtplan/dienste`,
    {
      name,
      tagesabschnittId: abschnittId,
      mindestbesetzung: mindest,
      nacht,
    },
  );
  expect(a.status).toBe(201);
  return a.body as { id: string; version: number; name: string };
};
const plan = async (lagerId: string, konto = leiter()) => {
  const a = await anfrage(konto, "GET", `${L(lagerId)}/schichtplan`);
  expect(a.status).toBe(200);
  return a.body as {
    dienste: { id: string; name: string }[];
    schichten: {
      id: string;
      dienstId: string;
      lagertagId: string;
      personId: string | null;
      teilnehmerId: string | null;
      name: string;
      ceviName?: string | null;
    }[];
    statistik: { personId: string | null; anzahl: number }[];
  };
};
const besetzen = (
  lagerId: string,
  body: Record<string, unknown>,
  konto = leiter(),
) => anfrage(konto, "PUT", `${L(lagerId)}/schichtplan/schichten`, body);
const vorschlag = (
  lagerId: string,
  body: Record<string, unknown>,
  konto = leiter(),
) => anfrage(konto, "POST", `${L(lagerId)}/schichtplan/vorschlag`, body);
const anwesend = (
  lagerId: string,
  z: Zeitplan,
  personIds: string[],
  wert: "A" | "F" | "O" = "A",
  nurAbschnitte: (keyof Zeitplan["abschnitt"])[] = [
    "morgen",
    "mittag",
    "abend",
    "nacht",
  ],
  tage = z.tage,
) =>
  db.insert(schema.anwesenheit).values(
    personIds.flatMap((personId) =>
      tage.flatMap((lagertagId) =>
        nurAbschnitte.map((a) => ({
          lagerId,
          personId,
          lagertagId,
          tagesabschnittId: z.abschnitt[a],
          wert,
          lagerSeq: 0,
        })),
      ),
    ),
  );
const schichtZeilen = (lagerId: string) =>
  db
    .select()
    .from(schema.schicht)
    .where(
      and(
        eq(schema.schicht.lagerId, lagerId),
        isNull(schema.schicht.geloeschtAm),
      ),
    );
const feed = async (lagerId: string, tabelle: string) =>
  (
    await db
      .select()
      .from(schema.lagerAenderung)
      .where(eq(schema.lagerAenderung.lagerId, lagerId))
  )
    .filter((z) => z.tabelle === tabelle)
    .sort((a, b) => a.seq - b.seq);

describe("Rechte je Lager-Persona", () => {
  // Lesen: alle vier Lager-Rollen. Ändern: Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen nicht
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 200,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const aendern = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: erfolg,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });
  let id: string;
  let z: Zeitplan;
  beforeAll(async () => {
    id = await legeLager(true);
    z = await zeitplan(id, 3);
    // Die falsche Zeile der fremden Abteilung gibt nichts frei
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: konten.fremdeAbteilung.id!,
      rolle: "lagerleitung",
    });
  });

  test.each(LAGER_PERSONAS)("%s: lesen", async (p) => {
    expect(
      (await anfrage(konten[p], "GET", `${L(id)}/schichtplan`)).status,
    ).toBe(lesen[p]);
  });

  test.each(LAGER_PERSONAS)(
    "%s: Dienst anlegen, ändern, besetzen, Vorschlag und löschen",
    async (p) => {
      const k = konten[p];
      const neu = await anfrage(k, "POST", `${L(id)}/schichtplan/dienste`, {
        name: `Dienst ${p}`,
        tagesabschnittId: z.abschnitt.morgen,
      });
      expect(neu.status).toBe(aendern(201)[p]);
      const d = await dienstAnlegen(id, z.abschnitt.mittag, `Ziel ${p}`);
      const stand = [
        [
          "PATCH",
          `/schichtplan/dienste/${d.id}`,
          { version: d.version, name: "X" },
        ],
        [
          "PUT",
          `/schichtplan/schichten`,
          { lagertagId: z.tage[0], dienstId: d.id },
        ],
        ["POST", `/schichtplan/vorschlag`, { uebernehmen: false, seed: 1 }],
      ] as const;
      const status: number[] = [];
      for (const [methode, pfad, body] of stand) {
        const a = await anfrage(k, methode, `${L(id)}${pfad}`, body);
        expect(a.status, `${methode} ${pfad}`).toBe(aendern(200)[p]);
        status.push(a.status);
      }
      const bleibt = status[0] === 200 ? d.version + 1 : d.version;
      const w = await anfrage(
        k,
        "DELETE",
        `${L(id)}/schichtplan/dienste/${d.id}?version=${bleibt}`,
      );
      expect(w.status).toBe(aendern(204)[p]);
    },
  );

  test("ein abgeschlossenes Lager ist schreibgeschützt, auch für den Vorschlag, lesen geht", async () => {
    const zu = await legeLager(false, "abgeschlossen");
    expect(
      (await anfrage(leiter(), "GET", `${L(zu)}/schichtplan`)).status,
    ).toBe(200);
    for (const [methode, pfad, body] of [
      [
        "POST",
        "/schichtplan/dienste",
        { name: "X", tagesabschnittId: UNBEKANNT },
      ],
      ["POST", "/schichtplan/vorschlag", { uebernehmen: false }],
      [
        "PUT",
        "/schichtplan/schichten",
        { lagertagId: UNBEKANNT, dienstId: UNBEKANNT },
      ],
    ] as const) {
      const a = await anfrage(leiter(), methode, `${L(zu)}${pfad}`, body);
      expect(a.status, pfad).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
  });
});

describe("Dienste verwalten", () => {
  test("anlegen, doppelter Name, Abschnitt eines anderen Lagers, Versionskonflikt, löschen mit Schichten", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 2);
    const anderes = await zeitplan(await legeLager(false), 1);
    const k = await dienstAnlegen(id, z.abschnitt.morgen, "  Küche  ", 2);
    expect(k.name).toBe("Küche");
    // Derselbe Name im selben Abschnitt, auch in anderer Schreibweise; in einem anderen Abschnitt geht er
    for (const name of ["Küche", "KÜCHE"]) {
      const doppelt = await anfrage(
        leiter(),
        "POST",
        `${L(id)}/schichtplan/dienste`,
        { name, tagesabschnittId: z.abschnitt.morgen },
      );
      expect(doppelt.status).toBe(409);
      expect(doppelt.body.code).toBe("DIENST_VORHANDEN");
    }
    await dienstAnlegen(id, z.abschnitt.abend, "Küche");
    // Unbekannter Abschnitt und Abschnitt eines anderen Lagers: 404
    for (const a of [UNBEKANNT, anderes.abschnitt.morgen]) {
      expect(
        (
          await anfrage(leiter(), "POST", `${L(id)}/schichtplan/dienste`, {
            name: "Nirgends",
            tagesabschnittId: a,
          })
        ).status,
      ).toBe(404);
    }
    // Eingaben: strikt, Grenzen, Steuerzeichen
    for (const body of [
      { name: "X", tagesabschnittId: z.abschnitt.morgen, sonst: 1 },
      { name: "", tagesabschnittId: z.abschnitt.morgen },
      { name: "x".repeat(101), tagesabschnittId: z.abschnitt.morgen },
      { name: "A\u0007B", tagesabschnittId: z.abschnitt.morgen },
      { name: "X", tagesabschnittId: z.abschnitt.morgen, mindestbesetzung: 0 },
      { name: "X", tagesabschnittId: z.abschnitt.morgen, mindestbesetzung: 21 },
      { name: "X", tagesabschnittId: "kaputt" },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${L(id)}/schichtplan/dienste`, body))
          .status,
      ).toBe(400);
    }
    // Ändern: Name, Nachtwache, Beschreibung; der Abschnitt ist nicht änderbar; alte Version 409
    const g = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/schichtplan/dienste/${k.id}`,
      {
        version: k.version,
        name: "Grossküche",
        nacht: true,
        beschreibung: "Kochen",
      },
    );
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({
      name: "Grossküche",
      nacht: true,
      beschreibung: "Kochen",
      version: 2,
      tagesabschnittId: z.abschnitt.morgen,
    });
    expect(
      (
        await anfrage(
          leiter(),
          "PATCH",
          `${L(id)}/schichtplan/dienste/${k.id}`,
          {
            version: 2,
            tagesabschnittId: z.abschnitt.abend,
          },
        )
      ).status,
    ).toBe(400);
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/schichtplan/dienste/${k.id}`,
      { version: 1, name: "Neu" },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
    expect(konflikt.body.aktuell.name).toBe("Grossküche");
    // Umbenennen auf einen vorhandenen Namen im Abschnitt: 409
    const zweiter = await dienstAnlegen(id, z.abschnitt.morgen, "Abwasch");
    const umbenennen = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/schichtplan/dienste/${zweiter.id}`,
      { version: 1, name: "grossküche" },
    );
    expect(umbenennen.body.code).toBe("DIENST_VORHANDEN");

    // Löschen: Version nötig, die Schichten gehen mit (weich), der Feed meldet beide
    const person = await mitglied(id);
    expect(
      (
        await besetzen(id, {
          lagertagId: z.tage[0],
          dienstId: k.id,
          personIds: [person],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/schichtplan/dienste/${k.id}?version=1`,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/schichtplan/dienste/${k.id}?version=2`,
        )
      ).status,
    ).toBe(204);
    expect((await plan(id)).schichten).toEqual([]);
    expect(await schichtZeilen(id)).toHaveLength(0);
    expect((await feed(id, "schicht")).map((x) => x.art)).toEqual([
      "neu",
      "geloescht",
    ]);
    expect((await feed(id, "dienst")).map((x) => x.art)).toEqual([
      "neu",
      "neu",
      "geaendert",
      "neu",
      "geloescht",
    ]);
    // Gelöscht ist gelöscht: noch einmal 404, auch ändern
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/schichtplan/dienste/${k.id}?version=3`,
        )
      ).status,
    ).toBe(404);
    // Ein Dienst eines anderen Lagers ist hier unbekannt
    const fremd = await legeLager(false);
    expect(
      (
        await anfrage(
          leiter(),
          "PATCH",
          `${L(fremd)}/schichtplan/dienste/${zweiter.id}`,
          {
            version: 1,
            name: "X",
          },
        )
      ).status,
    ).toBe(404);
  });

  test("höchstens 100 Dienste je Lager", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 1);
    await db.insert(schema.dienst).values(
      Array.from({ length: 100 }, (_, i) => ({
        lagerId: id,
        name: `Dienst ${i}`,
        tagesabschnittId: z.abschnitt.morgen,
        lagerSeq: 0,
      })),
    );
    const a = await anfrage(leiter(), "POST", `${L(id)}/schichtplan/dienste`, {
      name: "Einer zu viel",
      tagesabschnittId: z.abschnitt.morgen,
    });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("LIMIT_ERREICHT");
  });
});

describe("Schichten von Hand besetzen", () => {
  test("einteilen, idempotent, austeilen, Teilnehmende, Cevi-Name bleibt verborgen", async () => {
    const id = await legeLager(true);
    const z = await zeitplan(id, 3);
    const d = await dienstAnlegen(id, z.abschnitt.mittag, "Küche", 2);
    const [p1, p2] = [await mitglied(id, "Anna"), await mitglied(id, "Beat")];
    const t = await kind(id, "Muster");
    const body = {
      lagertagId: z.tage[0],
      dienstId: d.id,
      personIds: [p1, p2],
      teilnehmerIds: [t],
    };
    const erst = await besetzen(id, body);
    expect(erst.status).toBe(200);
    expect(erst.body).toEqual({ geaendert: 3 });
    // Dieselbe Besetzung noch einmal: nichts ändert sich, nichts im Feed
    const vorher = (await feed(id, "schicht")).length;
    expect((await besetzen(id, body)).body).toEqual({ geaendert: 0 });
    expect((await feed(id, "schicht")).length).toBe(vorher);
    const p = await plan(id, konten.team);
    expect(p.schichten.map((s) => s.name).sort()).toEqual([
      "Anna",
      "Beat",
      "Kind Muster",
    ]);
    // Weder in der Antwort noch im Plan steht der Cevi-Name der Teilnehmenden
    expect(JSON.stringify(p)).not.toContain("Geheim");
    expect(p.statistik).toHaveLength(3);
    // Austeilen: nur wer genannt bleibt
    const weniger = await besetzen(id, {
      ...body,
      personIds: [p1],
      teilnehmerIds: [],
    });
    expect(weniger.body).toEqual({ geaendert: 2 });
    expect((await plan(id)).schichten.map((s) => s.name)).toEqual(["Anna"]);
    // Leere Listen leeren den Dienst für den Tag
    expect(
      (await besetzen(id, { lagertagId: z.tage[0], dienstId: d.id })).body,
    ).toEqual({ geaendert: 1 });
    expect((await plan(id)).schichten).toEqual([]);
    // Wieder einteilen, nachdem die Zeile weich gelöscht ist: der Platz ist frei
    expect((await besetzen(id, { ...body, teilnehmerIds: [] })).body).toEqual({
      geaendert: 2,
    });
  });

  test("abgelehnt: abgewählt, abwesend, doppelt im Abschnitt, Fremde und Unbekanntes; nichts wird geändert", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 2);
    const mittag = await dienstAnlegen(id, z.abschnitt.mittag, "Mittag");
    const abwasch = await dienstAnlegen(id, z.abschnitt.mittag, "Abwasch");
    const abend = await dienstAnlegen(id, z.abschnitt.abend, "Abend");
    const [da, weg, offen] = [
      await mitglied(id),
      await mitglied(id),
      await mitglied(id),
    ];
    await anwesend(id, z, [weg], "F", ["mittag"]);
    await anwesend(id, z, [offen], "O", ["mittag"]);
    const abgewaehlt = await kind(id, "Nichtdabei", true);
    const fremdesKind = await kind(await legeLager(false), "Fremd");
    const ausserhalb = await (async () => {
      // Ein Konto, das zwar in der Abteilung ist, aber nicht im Lager
      const [p] = await db
        .insert(schema.user)
        .values({
          name: "Draussen",
          email: `${randomUUID()}@example.org`,
          username: `d.${randomUUID().slice(0, 8)}`,
          abteilungId: welt.testabteilungId,
          mussPasswortAendern: false,
        })
        .returning({ id: schema.user.id });
      return p!.id;
    })();
    const tag = z.tage[0];
    // Wer abwesend ist: 409 ABWESEND; wer offen ist, darf eingeteilt werden
    const a = await besetzen(id, {
      lagertagId: tag,
      dienstId: mittag.id,
      personIds: [da, weg],
    });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("ABWESEND");
    expect(await schichtZeilen(id)).toHaveLength(0);
    expect(
      (
        await besetzen(id, {
          lagertagId: tag,
          dienstId: mittag.id,
          personIds: [da, offen],
        })
      ).status,
    ).toBe(200);
    // Im selben Abschnitt desselben Tages nicht in einem zweiten Dienst, an einem anderen Tag und Abschnitt schon
    const doppelt = await besetzen(id, {
      lagertagId: tag,
      dienstId: abwasch.id,
      personIds: [da],
    });
    expect(doppelt.status).toBe(409);
    expect(doppelt.body.code).toBe("DOPPELBELEGT");
    expect(
      (
        await besetzen(id, {
          lagertagId: z.tage[1],
          dienstId: abwasch.id,
          personIds: [da],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await besetzen(id, {
          lagertagId: tag,
          dienstId: abend.id,
          personIds: [da],
        })
      ).status,
    ).toBe(200);
    // Abgewählte Teilnehmende nie
    const ab = await besetzen(id, {
      lagertagId: tag,
      dienstId: abend.id,
      teilnehmerIds: [abgewaehlt],
    });
    expect(ab.status).toBe(409);
    expect(ab.body.code).toBe("ABGEWAEHLT");
    // 404: Kind eines anderen Lagers, Konto ohne Mitgliedschaft, unbekannter Tag, Dienst und Dienst eines anderen Lagers
    for (const b of [
      { lagertagId: tag, dienstId: abend.id, teilnehmerIds: [fremdesKind] },
      { lagertagId: tag, dienstId: abend.id, personIds: [ausserhalb] },
      { lagertagId: UNBEKANNT, dienstId: abend.id },
      { lagertagId: tag, dienstId: UNBEKANNT },
    ]) {
      expect((await besetzen(id, b)).status, JSON.stringify(b)).toBe(404);
    }
    // Eingaben: Doppelte und zu viele
    for (const b of [
      { lagertagId: tag, dienstId: abend.id, personIds: [da, da] },
      {
        lagertagId: tag,
        dienstId: abend.id,
        personIds: Array.from({ length: 51 }, () => randomUUID()),
      },
      { lagertagId: tag, dienstId: abend.id, sonst: 1 },
    ]) {
      expect((await besetzen(id, b)).status).toBe(400);
    }
    // Ein ganzer abgelehnter Satz ändert nichts: da bleibt, wo es steht
    expect((await schichtZeilen(id)).length).toBe(4);
  });

  test("gleichzeitig dieselbe Person in zwei Diensten desselben Abschnitts: genau eine Anfrage gelingt", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 1);
    const [a, b] = [
      await dienstAnlegen(id, z.abschnitt.mittag, "A"),
      await dienstAnlegen(id, z.abschnitt.mittag, "B"),
    ];
    const person = await mitglied(id);
    const antworten = await Promise.all(
      [a, b, a, b].map((d) =>
        besetzen(id, {
          lagertagId: z.tage[0],
          dienstId: d.id,
          personIds: [person],
        }),
      ),
    );
    const ok = antworten.filter(
      (r) => r.status === 200 && r.body.geaendert === 1,
    );
    expect(ok).toHaveLength(1);
    expect(antworten.every((r) => r.status === 200 || r.status === 409)).toBe(
      true,
    );
    expect(await schichtZeilen(id)).toHaveLength(1);
  });

  test("nicht mehr abwesend und wieder auswählbar: das Entfernen eines Mitglieds nimmt seine Schichten mit", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 1);
    const d = await dienstAnlegen(id, z.abschnitt.mittag, "A");
    const person = await mitglied(id);
    await besetzen(id, {
      lagertagId: z.tage[0],
      dienstId: d.id,
      personIds: [person],
    });
    expect((await plan(id)).schichten).toHaveLength(1);
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, id),
          eq(schema.lagerMitglied.personId, person),
        ),
      );
    expect(await schichtZeilen(id)).toHaveLength(0);
  });
});

describe("Schichtplan lesen", () => {
  test("abgewählte, gelöschte und deaktivierte Leute, gelöschte Tage und Abschnitte erscheinen nicht; Statistik zählt Nachtwachen", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 3);
    const tag = await dienstAnlegen(id, z.abschnitt.mittag, "Küche");
    const nacht = await dienstAnlegen(
      id,
      z.abschnitt.nacht,
      "Nachtwache",
      1,
      true,
    );
    const [anna, beat, weg] = [
      await mitglied(id, "Anna"),
      await mitglied(id, "Beat"),
      await mitglied(id, "Deaktiviert"),
    ];
    const [dabei, nichtDabei] = [
      await kind(id, "Dabei"),
      await kind(id, "Raus"),
    ];
    await besetzen(id, {
      lagertagId: z.tage[0],
      dienstId: tag.id,
      personIds: [anna, beat, weg],
      teilnehmerIds: [dabei, nichtDabei],
    });
    await besetzen(id, {
      lagertagId: z.tage[0],
      dienstId: nacht.id,
      personIds: [anna],
    });
    await besetzen(id, {
      lagertagId: z.tage[1],
      dienstId: tag.id,
      personIds: [anna],
    });
    expect((await plan(id)).schichten).toHaveLength(7);
    // Abwählen, löschen, deaktivieren
    await db
      .update(schema.teilnehmer)
      .set({ abgewaehlt: true })
      .where(eq(schema.teilnehmer.id, nichtDabei));
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, weg));
    const p = await plan(id);
    expect(p.schichten.map((s) => s.name).sort()).toEqual([
      "Anna",
      "Anna",
      "Anna",
      "Beat",
      "Kind Dabei",
    ]);
    expect(p.statistik).toEqual([
      {
        personId: anna,
        teilnehmerId: null,
        name: "Anna",
        anzahl: 3,
        nachtwachen: 1,
      },
      {
        personId: beat,
        teilnehmerId: null,
        name: "Beat",
        anzahl: 1,
        nachtwachen: 0,
      },
      {
        personId: null,
        teilnehmerId: dabei,
        name: "Kind Dabei",
        anzahl: 1,
        nachtwachen: 0,
      },
    ]);
    // Sortiert nach Tag, Abschnitt, Dienst
    expect(p.schichten.map((s) => s.lagertagId)).toEqual(
      [...p.schichten.map((s) => s.lagertagId)].sort(
        (x, y) => z.tage.indexOf(x) - z.tage.indexOf(y),
      ),
    );
    // Die Funktion ist für den Ausdruck (#405) wiederverwendbar und liefert dasselbe
    const direkt = await ladeSchichtplan(db, id);
    expect(direkt.schichten.map((s) => s.id)).toEqual(
      p.schichten.map((s) => s.id),
    );
    expect(direkt.schichten[0]!.datum).toBe("2027-07-10");
    // Ein gelöschter Lagertag und ein gelöschter Abschnitt nehmen Dienste und Schichten aus dem Plan
    await db
      .update(schema.lagertag)
      .set({ geloeschtAm: new Date() })
      .where(eq(schema.lagertag.id, z.tage[1]!));
    await db
      .update(schema.tagesabschnitt)
      .set({ geloeschtAm: new Date() })
      .where(eq(schema.tagesabschnitt.id, z.abschnitt.nacht));
    const rest = await plan(id);
    expect(rest.dienste.map((d) => d.name)).toEqual(["Küche"]);
    expect(rest.schichten).toHaveLength(3);
  });

  test("Datenbanklast: die Zahl der Abfragen hängt nicht von der Zahl der Schichten ab", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 7);
    const dienste = [
      await dienstAnlegen(id, z.abschnitt.morgen, "A", 3),
      await dienstAnlegen(id, z.abschnitt.mittag, "B", 3),
    ];
    const leute = [await mitglied(id), await mitglied(id), await mitglied(id)];
    const messe = async () => {
      const vorher = abfragen;
      const r = await anfrage(leiter(), "GET", `${L(id)}/schichtplan`);
      expect(r.status).toBe(200);
      return { n: abfragen - vorher, zeilen: r.body.schichten.length };
    };
    await besetzen(id, {
      lagertagId: z.tage[0],
      dienstId: dienste[0]!.id,
      personIds: [leute[0]!],
    });
    const wenige = await messe();
    for (const t of z.tage) {
      for (const d of dienste) {
        await besetzen(id, { lagertagId: t, dienstId: d.id, personIds: leute });
      }
    }
    const viele = await messe();
    expect(wenige.zeilen).toBe(1);
    expect(viele.zeilen).toBe(42);
    expect(viele.n).toBe(wenige.n);
    // Anmeldung, Policy (Lager mit Mitgliedschaft, Rechte der Rolle) und der Plan in einer Abfrage
    expect(viele.n).toBeLessThanOrEqual(6);
  });
});

describe("Vorschlag", () => {
  // Ein Lager mit sechs Mitgliedern, die an allen Tagen und Abschnitten anwesend sind, und den Diensten Frühstück, Mittag, Abend (je 2) und Nachtwache (1)
  async function einrichten(tage = 7, leute = 6) {
    const id = await legeLager(false);
    const z = await zeitplan(id, tage);
    const personen = await Promise.all(
      Array.from({ length: leute }, (_, i) => mitglied(id, `Person ${i}`)),
    );
    await anwesend(id, z, personen);
    const dienste = {
      morgen: await dienstAnlegen(id, z.abschnitt.morgen, "Frühstück", 2),
      mittag: await dienstAnlegen(id, z.abschnitt.mittag, "Mittag", 2),
      abend: await dienstAnlegen(id, z.abschnitt.abend, "Abend", 2),
      nacht: await dienstAnlegen(id, z.abschnitt.nacht, "Nachtwache", 1, true),
    };
    return { id, z, personen, dienste };
  }

  test("Vorschau schreibt nichts, gibt mit seed dasselbe, nennt den Startwert ohne seed", async () => {
    const { id } = await einrichten();
    const a = await vorschlag(id, { uebernehmen: false, seed: 42 });
    expect(a.status).toBe(200);
    expect(a.body.vorschau).toBe(true);
    expect(a.body.seed).toBe(42);
    expect(a.body.schichten).toHaveLength(7 * 7);
    expect(a.body.unbesetzt).toEqual([]);
    expect(a.body.gekuerzt).toBe(false);
    expect(await schichtZeilen(id)).toHaveLength(0);
    expect(await feed(id, "schicht")).toHaveLength(0);
    // Wiederholbar
    const b = await vorschlag(id, { uebernehmen: false, seed: 42 });
    expect(b.body).toEqual(a.body);
    // Ohne seed zieht der Server einen und nennt ihn; mit ihm lässt sich der Vorschlag wiederholen
    const c = await vorschlag(id, { uebernehmen: false });
    expect(Number.isInteger(c.body.seed)).toBe(true);
    const d = await vorschlag(id, { uebernehmen: false, seed: c.body.seed });
    expect(d.body).toEqual(c.body);
  });

  test("Übernehmen schreibt genau den Vorschlag, eine Wiederholung ändert nichts, die Regeln und die Fairness halten", async () => {
    const { id, z, personen, dienste } = await einrichten(14, 6);
    const vor = await vorschlag(id, { uebernehmen: false, seed: 7 });
    const u = await vorschlag(id, { uebernehmen: true, seed: 7 });
    expect(u.status).toBe(200);
    expect(u.body.vorschau).toBe(false);
    expect(u.body.geaendert).toBe(14 * 7);
    expect({ ...u.body, vorschau: true, geaendert: undefined }).toEqual({
      ...vor.body,
      geaendert: undefined,
    });
    const p = await plan(id);
    expect(p.schichten).toHaveLength(14 * 7);
    expect(
      p.schichten
        .map((s) => `${s.lagertagId}|${s.dienstId}|${s.personId}`)
        .sort(),
    ).toEqual(
      u.body.schichten
        .map(
          (s: { lagertagId: string; dienstId: string; personId: string }) =>
            `${s.lagertagId}|${s.dienstId}|${s.personId}`,
        )
        .sort(),
    );
    // Je Dienst und Tag genau die Mindestbesetzung
    const je = new Map<string, number>();
    for (const s of p.schichten) {
      je.set(
        `${s.lagertagId}|${s.dienstId}`,
        (je.get(`${s.lagertagId}|${s.dienstId}`) ?? 0) + 1,
      );
    }
    for (const t of z.tage) {
      expect(je.get(`${t}|${dienste.morgen.id}`)).toBe(2);
      expect(je.get(`${t}|${dienste.nacht.id}`)).toBe(1);
    }
    // Keine Doppelbelegung im Abschnitt: Der Teilindex hält es, und die Zeilen zeigen es
    const felder = (await schichtZeilen(id)).map(
      (s) => `${s.personId}|${s.lagertagId}|${s.tagesabschnittId}`,
    );
    expect(new Set(felder).size).toBe(felder.length);
    // Keine Nachtwachen hintereinander
    const nachtTage = new Map<string, number[]>();
    for (const s of p.schichten.filter(
      (x) => x.dienstId === dienste.nacht.id,
    )) {
      nachtTage.set(s.personId!, [
        ...(nachtTage.get(s.personId!) ?? []),
        z.tage.indexOf(s.lagertagId),
      ]);
    }
    for (const tage of nachtTage.values()) {
      tage.sort((a, b) => a - b);
      tage.forEach(
        (t, i) => i > 0 && expect(t - tage[i - 1]!).toBeGreaterThan(1),
      );
    }
    // Fairness: Die Zahl der Dienste je Person unterscheidet sich um höchstens eins
    const zahlen = personen.map(
      (pid) => p.statistik.find((s) => s.personId === pid)?.anzahl ?? 0,
    );
    expect(Math.max(...zahlen) - Math.min(...zahlen)).toBeLessThanOrEqual(1);
    expect(zahlen.reduce((a, b) => a + b, 0)).toBe(14 * 7);
    // Nichts mehr zu füllen: Wiederholung ändert nichts, auch nichts im Feed
    const feedVorher = (await feed(id, "schicht")).length;
    const nochmal = await vorschlag(id, { uebernehmen: true, seed: 7 });
    expect(nochmal.body.geaendert).toBe(0);
    expect(nochmal.body.schichten).toEqual([]);
    expect((await feed(id, "schicht")).length).toBe(feedVorher);
    // Der Feed meldet alle neuen Schichten in einem Zug mit lückenlosen Folgenummern
    const folge = (await feed(id, "schicht")).map((x) => x.seq);
    expect(folge).toHaveLength(14 * 7);
    folge.forEach((s, i) => i > 0 && expect(s).toBe(folge[i - 1]! + 1));
  });

  test("bestehende Besetzung bleibt, nur freie Plätze werden gefüllt, nur die genannten Tage", async () => {
    const { id, z, personen, dienste } = await einrichten(5, 6);
    await besetzen(id, {
      lagertagId: z.tage[1],
      dienstId: dienste.morgen.id,
      personIds: [personen[0]!],
    });
    const u = await vorschlag(id, {
      uebernehmen: true,
      seed: 3,
      lagertagIds: [z.tage[1]!, z.tage[2]!],
    });
    expect(u.body.geaendert).toBe(2 * 7 - 1);
    const p = await plan(id);
    expect(new Set(p.schichten.map((s) => s.lagertagId))).toEqual(
      new Set([z.tage[1], z.tage[2]]),
    );
    // Die von Hand eingeteilte Person ist noch da und kommt am Tag nicht noch einmal im Frühstück vor
    const frueh = p.schichten.filter(
      (s) => s.lagertagId === z.tage[1] && s.dienstId === dienste.morgen.id,
    );
    expect(frueh).toHaveLength(2);
    expect(frueh.filter((s) => s.personId === personen[0])).toHaveLength(1);
    // Ein unbekannter oder fremder Tag: 404
    expect(
      (await vorschlag(id, { uebernehmen: false, lagertagIds: [UNBEKANNT] }))
        .status,
    ).toBe(404);
    expect(
      (
        await vorschlag(id, {
          uebernehmen: false,
          lagertagIds: [(await zeitplan(await legeLager(false), 1)).tage[0]!],
        })
      ).status,
    ).toBe(404);
  });

  test("Anwesenheit: nur Anwesende, nie Abwesende, offene nur auf Wunsch; ohne Daten bleibt alles unbesetzt", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 2);
    const d = await dienstAnlegen(id, z.abschnitt.mittag, "Küche", 2);
    const [a, f, o, nur] = [
      await mitglied(id, "Anwesend"),
      await mitglied(id, "Abwesend"),
      await mitglied(id, "Offen"),
      await mitglied(id, "Nur Morgen"),
    ];
    await anwesend(id, z, [a]);
    await anwesend(id, z, [f], "F");
    await anwesend(id, z, [o], "O");
    // Nur am Morgen anwesend: im Abschnitt Mittag nicht verfügbar
    await anwesend(id, z, [nur], "A", ["morgen"]);
    const streng = await vorschlag(id, { uebernehmen: false, seed: 1 });
    // Das Lager hat die Lagerleitung als Mitglied, ohne Anwesenheit: Nur «Anwesend» bleibt
    expect(
      new Set(
        streng.body.schichten.map((s: { personId: string }) => s.personId),
      ),
    ).toEqual(new Set([a]));
    expect(streng.body.schichten).toHaveLength(2);
    expect(streng.body.unbesetzt).toEqual([
      { lagertagId: z.tage[0], dienstId: d.id, fehlend: 1 },
      { lagertagId: z.tage[1], dienstId: d.id, fehlend: 1 },
    ]);
    // Mit offenen: auch wer nichts eingetragen hat, aber nie die Abwesenden
    const weit = await vorschlag(id, {
      uebernehmen: false,
      seed: 1,
      nurAnwesende: false,
    });
    const wer = new Set(
      weit.body.schichten.map((s: { personId: string }) => s.personId),
    );
    expect(wer.has(f)).toBe(false);
    expect(wer.has(a) || wer.has(o)).toBe(true);
    expect(weit.body.unbesetzt).toEqual([]);
    // Eine Zeile mit gelöschtem Eintrag zählt nicht
    await db
      .update(schema.anwesenheit)
      .set({ geloeschtAm: new Date() })
      .where(
        and(
          eq(schema.anwesenheit.lagerId, id),
          eq(schema.anwesenheit.personId, a),
        ),
      );
    const leer = await vorschlag(id, { uebernehmen: false, seed: 1 });
    expect(leer.body.schichten).toEqual([]);
    expect(leer.body.unbesetzt).toHaveLength(2);
  });

  test("Teilnehmende nur auf Wunsch, abgewählte nie", async () => {
    const id = await legeLager(false);
    const z = await zeitplan(id, 1);
    const d = await dienstAnlegen(id, z.abschnitt.mittag, "Tischdienst", 3);
    const person = await mitglied(id, "Leitung");
    await anwesend(id, z, [person]);
    const [dabei, raus] = [
      await kind(id, "Dabei"),
      await kind(id, "Raus", true),
    ];
    // Anwesenheit der Teilnehmenden
    await db.insert(schema.anwesenheit).values(
      [dabei, raus].map((teilnehmerId) => ({
        lagerId: id,
        teilnehmerId,
        lagertagId: z.tage[0]!,
        tagesabschnittId: z.abschnitt.mittag,
        wert: "A" as const,
        lagerSeq: 0,
      })),
    );
    const ohne = await vorschlag(id, { uebernehmen: false, seed: 1 });
    expect(
      ohne.body.schichten.map((s: { personId: string }) => s.personId),
    ).toEqual([person]);
    const mit = await vorschlag(id, {
      uebernehmen: true,
      seed: 1,
      mitTeilnehmenden: true,
    });
    expect(mit.body.geaendert).toBe(2);
    expect(
      mit.body.schichten
        .map((s: { teilnehmerId: string | null }) => s.teilnehmerId)
        .filter(Boolean),
    ).toEqual([dabei]);
    expect(mit.body.unbesetzt).toEqual([
      { lagertagId: z.tage[0], dienstId: d.id, fehlend: 1 },
    ]);
    expect(JSON.stringify(mit.body)).not.toContain("Geheim");
    const p = await plan(id);
    expect(p.schichten.some((s) => s.teilnehmerId === raus)).toBe(false);
    // Wer nach dem Einteilen abgewählt wird, verschwindet aus Plan und Statistik und blockiert den Platz nicht
    await db
      .update(schema.teilnehmer)
      .set({ abgewaehlt: true })
      .where(eq(schema.teilnehmer.id, dabei));
    expect((await plan(id)).schichten.map((s) => s.personId)).toEqual([person]);
  });

  test("zwei gleichzeitige Übernahmen schreiben jeden Platz genau einmal", async () => {
    const { id, personen } = await einrichten(7, 6);
    const antworten = await Promise.all(
      [1, 2, 3].map((seed) => vorschlag(id, { uebernehmen: true, seed })),
    );
    expect(antworten.every((a) => a.status === 200)).toBe(true);
    // Zusammen genau die 49 Plätze, nie mehr; jeder Lauf sieht unter der Lagersperre den Stand des vorigen
    expect(
      antworten.reduce((s, a) => s + (a.body.geaendert as number), 0),
    ).toBe(7 * 7);
    expect(await schichtZeilen(id)).toHaveLength(7 * 7);
    const felder = (await schichtZeilen(id)).map(
      (s) => `${s.personId}|${s.lagertagId}|${s.tagesabschnittId}`,
    );
    expect(new Set(felder).size).toBe(felder.length);
    expect(personen).toHaveLength(6);
  });

  test("zu knapp besetzt: unbesetzte Plätze werden genannt, die Statistik zeigt die Verteilung", async () => {
    const { id, z, personen } = await einrichten(2, 2);
    const a = await vorschlag(id, { uebernehmen: false, seed: 5 });
    // Zwei Leute: Frühstück, Mittag und Abend je 2, Nachtwache 1; die Nachtwache an zwei Tagen nacheinander gibt es nicht für dieselbe Person
    expect(a.body.schichten).toHaveLength(2 * 7);
    expect(a.body.unbesetzt).toEqual([]);
    const nachts = a.body.schichten.filter(
      (s: { tagesabschnittId: string }) =>
        s.tagesabschnittId === z.abschnitt.nacht,
    );
    expect(
      new Set(nachts.map((s: { personId: string }) => s.personId)).size,
    ).toBe(2);
    expect(a.body.statistik).toHaveLength(2);
    for (const s of a.body.statistik) {
      expect(personen).toContain(s.personId);
      expect(s).toMatchObject({ vorher: 0, neu: 7, gesamt: 7, nachtwachen: 1 });
    }
    // Mit einer Person ist die zweite Stelle je Dienst unbesetzt und die zweite Nachtwache in Folge ebenso
    const eine = await legeLager(false);
    const ze = await zeitplan(eine, 2);
    const p = await mitglied(eine);
    await anwesend(eine, ze, [p]);
    await dienstAnlegen(eine, ze.abschnitt.morgen, "Frühstück", 2);
    await dienstAnlegen(eine, ze.abschnitt.nacht, "Nachtwache", 1, true);
    const e = await vorschlag(eine, { uebernehmen: false, seed: 5 });
    expect(e.body.schichten).toHaveLength(3);
    expect(e.body.unbesetzt).toHaveLength(3);
  });

  test("Eingaben: strikt, Grenzen; Rate-Limit je Konto und Lager", async () => {
    const { id } = await einrichten(1, 2);
    for (const body of [
      {},
      { uebernehmen: "ja" },
      { uebernehmen: false, seed: -1 },
      { uebernehmen: false, seed: 4294967296 },
      { uebernehmen: false, lagertagIds: [] },
      { uebernehmen: false, lagertagIds: [UNBEKANNT, UNBEKANNT] },
      { uebernehmen: false, sonst: 1 },
    ]) {
      expect((await vorschlag(id, body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
    // Der Rest des Minutenbudgets geht auf; danach 429, auch für die Vorschau
    let letzter = 200;
    for (let i = 0; i < VORSCHLAEGE_PRO_MINUTE + 1; i++) {
      letzter = (await vorschlag(id, { uebernehmen: false, seed: 1 })).status;
      if (letzter === 429) break;
    }
    expect(letzter).toBe(429);
    // Ein anderes Lager zählt getrennt
    const anderes = await einrichten(1, 2);
    expect((await vorschlag(anderes.id, { uebernehmen: false })).status).toBe(
      200,
    );
  });

  test("Datenbanklast: der Vorschlag braucht eine feste Zahl Abfragen, unabhängig von der Grösse des Plans", async () => {
    const klein = await einrichten(2, 3);
    const gross = await einrichten(10, 12);
    const messe = async (id: string) => {
      const vorher = abfragen;
      const r = await vorschlag(id, { uebernehmen: false, seed: 1 });
      expect(r.status).toBe(200);
      return abfragen - vorher;
    };
    const n = await messe(klein.id);
    expect(await messe(gross.id)).toBe(n);
    // Anmeldung, Policy und fünf Abfragen für den Stand
    expect(n).toBeLessThanOrEqual(12);
    // Das Übernehmen: ein Insert für alle Schichten, kein Statement je Schicht
    const vorher = abfragen;
    const u = await vorschlag(gross.id, { uebernehmen: true, seed: 1 });
    expect(u.body.geaendert).toBe(10 * 7);
    expect(abfragen - vorher).toBeLessThanOrEqual(n + 12);
  });
});
