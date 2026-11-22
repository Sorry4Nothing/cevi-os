import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { normalisiereTitel } from "../../src/lager/duplikate.js";
import { naechsteFrist } from "../../src/lager/wiederholung.js";
import type { Fcm } from "../../src/push.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Jede Abfrage an die Datenbank zählt mit: Die Tests der Datenbanklast vergleichen die Zahl für kleine und grosse Listen
let abfragen = 0;
const sql = postgres(API_URL, {
  debug: () => {
    abfragen++;
  },
});
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

const fcm: Fcm = {
  async sendEach(nachrichten) {
    return { responses: nachrichten.map(() => ({ success: true })) };
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  fcm,
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let andereLagerId: string;
let fremdLagerId: string;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;

async function neuesLager(
  abteilungId = welt.testabteilungId,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Detaillager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  if (abteilungId !== welt.testabteilungId) return id;
  // Die falsche Zeile der fremden Abteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of MITGLIEDER) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
  return id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await neuesLager();
  geschlossenId = await neuesLager(welt.testabteilungId, "abgeschlossen");
  andereLagerId = await neuesLager();
  fremdLagerId = await neuesLager(welt.demoAbteilungId);
});

// Die Bodys prüfen die Tests Feld für Feld; ein Typ je Route brächte hier nichts
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

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const A = (aufgabeId: string, id = lagerId) => `${L(id)}/aufgaben/${aufgabeId}`;
const leiter = () => konten.lagerleitung;
const team = () => konten.team;

type AufgabeAntwort = {
  id: string;
  version: number;
  titel: string;
  status: string;
  frist: string | null;
};
async function neu(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/aufgaben`, {
    titel: "Aufgabe",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as AufgabeAntwort;
}
type Punkt = { id: string; version: number; text: string; erledigt: boolean };
async function punkt(aufgabeId: string, text = "Punkt", id = lagerId) {
  const p = await anfrage(leiter(), "POST", `${A(aufgabeId, id)}/checkliste`, {
    text,
  });
  expect(p.status).toBe(201);
  return p.body as Punkt;
}
async function link(aufgabeId: string, url = "https://beispiel.example.org") {
  const p = await anfrage(leiter(), "POST", `${A(aufgabeId)}/links`, {
    titel: "Plan",
    url,
  });
  expect(p.status).toBe(201);
  return p.body as { id: string; version: number; url: string };
}
async function details(aufgabeId: string, konto = leiter(), id = lagerId) {
  const d = await anfrage(konto, "GET", `${A(aufgabeId, id)}/details`);
  expect(d.status).toBe(200);
  return d.body as {
    checkliste: (Punkt & {
      erledigtVonPersonId: string | null;
      erledigtVon: { id: string; name: string } | null;
      reihenfolge: number;
    })[];
    links: { id: string; version: number; url: string; titel: string }[];
    stichworte: string[];
  };
}
async function aufgabeLesen(aufgabeId: string, id = lagerId) {
  const a = await anfrage(leiter(), "GET", A(aufgabeId, id));
  expect(a.status).toBe(200);
  return a.body;
}
async function mitglied(lager = lagerId) {
  const [p] = await db
    .insert(schema.user)
    .values({
      name: "Mitglied Test",
      email: `${randomUUID()}@example.org`,
      username: `m.${randomUUID().slice(0, 8)}`,
      abteilungId: welt.testabteilungId,
      mussPasswortAendern: false,
    })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId: lager, personId: p!.id, rolle: "team" });
  return p!.id;
}
async function ressort(lager = lagerId) {
  const [r] = await db
    .insert(schema.ressort)
    .values({
      lagerId: lager,
      kuerzel: `R${randomUUID().slice(0, 8)}`,
      name: "Küche",
      lagerSeq: 0,
    })
    .returning({ id: schema.ressort.id });
  return r!.id;
}
const statusSetzen = (
  aufgabe: { id: string },
  version: number,
  status: string,
  id = lagerId,
  konto = leiter(),
) => anfrage(konto, "PUT", `${A(aufgabe.id, id)}/status`, { version, status });

describe("Rechte je Lager-Persona", () => {
  const erwartung = (
    werte: Partial<Record<LagerPersona, number>>,
    grundlage: number,
  ): Record<LagerPersona, number> => ({
    abteilungsleitung: grundlage,
    lagerleitung: grundlage,
    leitung: grundlage,
    team: grundlage,
    lesen: grundlage,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
    ...werte,
  });
  // Die Aufgabe gehört niemandem: Das Team sieht sie nicht. Leitung und Lesen lesen alles
  const lesen = erwartung({ team: 404 }, 200);
  const schreiben = (erfolg: number) =>
    erwartung({ team: 403, lesen: 403 }, erfolg);

  test.each(LAGER_PERSONAS)("%s: lesen und schreiben", async (p) => {
    const a = await neu();
    const pk = await punkt(a.id);
    const l = await link(a.id);
    const konto = konten[p];
    const r = {
      details: await anfrage(konto, "GET", `${A(a.id)}/details`),
      verlauf: await anfrage(konto, "GET", `${A(a.id)}/verlauf`),
      duplikate: await anfrage(konto, "GET", `${L()}/aufgaben/duplikate`),
      anlegen: await anfrage(konto, "POST", `${A(a.id)}/checkliste`, {
        text: "X",
      }),
      aendern: await anfrage(konto, "PATCH", `${A(a.id)}/checkliste/${pk.id}`, {
        version: 1,
        text: "Y",
      }),
      linkAnlegen: await anfrage(konto, "POST", `${A(a.id)}/links`, {
        titel: "L",
        url: "https://beispiel.example.org/x",
      }),
      linkAendern: await anfrage(konto, "PATCH", `${A(a.id)}/links/${l.id}`, {
        version: 1,
        titel: "N",
      }),
      stichworte: await anfrage(konto, "PUT", `${A(a.id)}/stichworte`, {
        version: 1,
        stichworte: ["x"],
      }),
      zusammen: await anfrage(konto, "POST", `${A(a.id)}/zusammenfuehren`, {
        version: 1,
        mitId: randomUUID(),
        mitVersion: 1,
      }),
    };
    const nurBearbeiter = erwartung({ team: 403, lesen: 403 }, 200);
    expect(r.details.status).toBe(lesen[p]);
    // Der Verlauf braucht verlauf.lesen: Das hat das Team nicht
    expect(r.verlauf.status).toBe(erwartung({ team: 403 }, 200)[p]);
    expect(r.duplikate.status).toBe(nurBearbeiter[p]);
    // Anlegen 201, Ändern 200 (Version 1 ist noch frisch, ausser der Text-Test unten)
    expect(r.anlegen.status).toBe(schreiben(201)[p]);
    expect(r.aendern.status).toBe(erwartung({ team: 404, lesen: 403 }, 200)[p]);
    expect(r.linkAnlegen.status).toBe(schreiben(201)[p]);
    expect(r.linkAendern.status).toBe(schreiben(200)[p]);
    expect(r.stichworte.status).toBe(schreiben(200)[p]);
    // Die zweite Aufgabe gibt es nicht: Wer schreiben darf, bekommt 404
    expect(r.zusammen.status).toBe(schreiben(404)[p]);
  });

  test("abgeschlossenes Lager: schreiben 409, lesen 200", async () => {
    const [a] = await db
      .insert(schema.aufgabe)
      .values({ lagerId: geschlossenId, titel: "Alt", lagerSeq: 0 })
      .returning({ id: schema.aufgabe.id });
    const [p] = await db
      .insert(schema.aufgabeCheckpunkt)
      .values({
        lagerId: geschlossenId,
        aufgabeId: a!.id,
        text: "Alt",
        lagerSeq: 0,
      })
      .returning({ id: schema.aufgabeCheckpunkt.id });
    const pfad = A(a!.id, geschlossenId);
    for (const [methode, url, body] of [
      ["POST", `${pfad}/checkliste`, { text: "X" }],
      ["PATCH", `${pfad}/checkliste/${p!.id}`, { version: 1, erledigt: true }],
      ["DELETE", `${pfad}/checkliste/${p!.id}?version=1`, undefined],
      ["POST", `${pfad}/links`, { titel: "T", url: "https://a.example.org" }],
      ["PUT", `${pfad}/stichworte`, { version: 1, stichworte: [] }],
    ] as const) {
      const r = await anfrage(leiter(), methode, url, body);
      expect(r.status, `${methode} ${url}`).toBe(409);
      expect(r.body.code).toBe("LAGER_GESCHLOSSEN");
    }
    expect((await anfrage(konten.lesen, "GET", `${pfad}/details`)).status).toBe(
      200,
    );
  });

  test("Lager der fremden Abteilung: 404, auch für die Abteilungsleitung", async () => {
    const [a] = await db
      .insert(schema.aufgabe)
      .values({ lagerId: fremdLagerId, titel: "Fremd", lagerSeq: 0 })
      .returning({ id: schema.aufgabe.id });
    for (const [methode, url] of [
      ["GET", `${A(a!.id, fremdLagerId)}/details`],
      ["GET", `${A(a!.id, fremdLagerId)}/verlauf`],
      ["GET", `${L(fremdLagerId)}/aufgaben/duplikate`],
    ] as const) {
      expect(
        (await anfrage(konten.abteilungsleitung, methode, url)).status,
      ).toBe(404);
    }
  });

  test("Details einer Aufgabe eines anderen Lagers sind über dieses Lager nie erreichbar (SR-11)", async () => {
    const andere = await neu({}, andereLagerId);
    const fremderPunkt = await punkt(andere.id, "Punkt", andereLagerId);
    const eigene = await neu();
    // Die fremde Aufgabe über dieses Lager
    for (const [methode, url, body] of [
      ["GET", `${A(andere.id)}/details`, undefined],
      ["POST", `${A(andere.id)}/checkliste`, { text: "X" }],
      ["PUT", `${A(andere.id)}/stichworte`, { version: 1, stichworte: ["x"] }],
      [
        "POST",
        `${A(andere.id)}/zusammenfuehren`,
        {
          version: 1,
          mitId: eigene.id,
          mitVersion: 1,
        },
      ],
      // Ein Punkt einer fremden Aufgabe über die eigene
      [
        "PATCH",
        `${A(eigene.id)}/checkliste/${fremderPunkt.id}`,
        {
          version: 1,
          text: "X",
        },
      ],
      [
        "DELETE",
        `${A(eigene.id)}/checkliste/${fremderPunkt.id}?version=1`,
        undefined,
      ],
    ] as const) {
      const r = await anfrage(leiter(), methode, url, body);
      expect(r.status, `${methode} ${url}`).toBe(404);
    }
    // Die eigene Aufgabe lässt sich nicht mit einer fremden zusammenführen
    expect(
      (
        await anfrage(leiter(), "POST", `${A(eigene.id)}/zusammenfuehren`, {
          version: 1,
          mitId: andere.id,
          mitVersion: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await details(andere.id, leiter(), andereLagerId)).checkliste,
    ).toHaveLength(1);
  });
});

describe("Team an eigenen Aufgaben", () => {
  test("liest die Details und hakt ab, ändert aber sonst nichts; eine fremde Aufgabe ist 404", async () => {
    const eigene = await neu({ verantwortlichPersonId: team().id });
    const unterstuetzt = await neu({ unterstuetzungPersonIds: [team().id] });
    const fremde = await neu();
    for (const a of [eigene, unterstuetzt]) {
      const p = await punkt(a.id);
      expect((await details(a.id, team())).checkliste).toHaveLength(1);
      const hakt = await anfrage(
        team(),
        "PATCH",
        `${A(a.id)}/checkliste/${p.id}`,
        {
          version: 1,
          erledigt: true,
        },
      );
      expect(hakt.status).toBe(200);
      expect(hakt.body).toMatchObject({
        erledigt: true,
        erledigtVonPersonId: team().id,
        version: 2,
      });
      // Wieder öffnen leert die Person
      const offen = await anfrage(
        team(),
        "PATCH",
        `${A(a.id)}/checkliste/${p.id}`,
        {
          version: 2,
          erledigt: false,
        },
      );
      expect(offen.body).toMatchObject({
        erledigt: false,
        erledigtVonPersonId: null,
      });
      // Den Text ändern, anlegen, löschen darf das Team nicht
      for (const [methode, url, body] of [
        ["PATCH", `${A(a.id)}/checkliste/${p.id}`, { version: 3, text: "X" }],
        [
          "PATCH",
          `${A(a.id)}/checkliste/${p.id}`,
          { version: 3, text: "X", erledigt: true },
        ],
        ["POST", `${A(a.id)}/checkliste`, { text: "X" }],
        ["DELETE", `${A(a.id)}/checkliste/${p.id}?version=3`, undefined],
        [
          "POST",
          `${A(a.id)}/links`,
          { titel: "T", url: "https://a.example.org" },
        ],
        ["PUT", `${A(a.id)}/stichworte`, { version: 1, stichworte: [] }],
      ] as const) {
        expect(
          (await anfrage(team(), methode, url, body)).status,
          `${methode} ${url}`,
        ).toBe(403);
      }
    }
    const pf = await punkt(fremde.id);
    expect(
      (await anfrage(team(), "GET", `${A(fremde.id)}/details`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(team(), "PATCH", `${A(fremde.id)}/checkliste/${pf.id}`, {
          version: 1,
          erledigt: true,
        })
      ).status,
    ).toBe(404);
    // Auch mit einem Text: erst die Aufgabe (404), dann das Recht
    expect(
      (
        await anfrage(team(), "PATCH", `${A(fremde.id)}/checkliste/${pf.id}`, {
          version: 1,
          text: "X",
        })
      ).status,
    ).toBe(404);
  });

  test("der Feed zeigt dem Team nur die Details eigener Aufgaben", async () => {
    const id = await neuesLager();
    const [vorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    const eigene = await neu({ verantwortlichPersonId: team().id }, id);
    const fremde = await neu({}, id);
    const pe = await punkt(eigene.id, "Eigen", id);
    const pf = await punkt(fremde.id, "Fremd", id);
    const feed = async (konto: PersonaKonto) =>
      (
        await anfrage(konto, "GET", `${L(id)}/aenderungen?seit=${vorher!.seq}`)
      ).body.eintraege
        .filter(
          (e: { objekttyp: string }) => e.objekttyp === "aufgabe_checkpunkt",
        )
        .map((e: { id: string }) => e.id);
    expect(await feed(team())).toEqual([pe.id]);
    expect((await feed(konten.lesen)).sort()).toEqual([pe.id, pf.id].sort());
  });
});

describe("Checkliste", () => {
  test("anlegen ans Ende, ändern, abhaken, öffnen, ordnen und löschen", async () => {
    const a = await neu();
    const [p1, p2, p3] = [
      await punkt(a.id, "Eins"),
      await punkt(a.id, "Zwei"),
      await punkt(a.id, "Drei"),
    ];
    let d = await details(a.id);
    expect(d.checkliste.map((p) => [p.text, p.reihenfolge, p.version])).toEqual(
      [
        ["Eins", 0, 1],
        ["Zwei", 1, 1],
        ["Drei", 2, 1],
      ],
    );

    const umbenannt = await anfrage(
      leiter(),
      "PATCH",
      `${A(a.id)}/checkliste/${p1.id}`,
      {
        version: 1,
        text: "  Eins neu ",
      },
    );
    expect(umbenannt.body).toMatchObject({ text: "Eins neu", version: 2 });
    // Veralteter Stand: 409 mit dem aktuellen Stand und den abweichenden Feldern
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${A(a.id)}/checkliste/${p1.id}`,
      {
        version: 1,
        text: "Anders",
      },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body).toMatchObject({
      code: "VERSION_KONFLIKT",
      aktuell: { text: "Eins neu", version: 2 },
      abweichend: ["text"],
    });

    // Abhaken setzt die Person, ein zweites Abhaken ändert sie nicht, Öffnen leert sie
    const hakt = await anfrage(
      leiter(),
      "PATCH",
      `${A(a.id)}/checkliste/${p2.id}`,
      {
        version: 1,
        erledigt: true,
      },
    );
    expect(hakt.body).toMatchObject({
      erledigt: true,
      erledigtVonPersonId: leiter().id,
    });
    const nochmal = await anfrage(
      konten.leitung,
      "PATCH",
      `${A(a.id)}/checkliste/${p2.id}`,
      {
        version: 2,
        erledigt: true,
      },
    );
    expect(nochmal.body.erledigtVonPersonId).toBe(leiter().id);
    d = await details(a.id);
    expect(d.checkliste.find((p) => p.id === p2.id)?.erledigtVon?.id).toBe(
      leiter().id,
    );
    const offen = await anfrage(
      leiter(),
      "PATCH",
      `${A(a.id)}/checkliste/${p2.id}`,
      {
        version: 3,
        erledigt: false,
      },
    );
    expect(offen.body).toMatchObject({
      erledigt: false,
      erledigtVonPersonId: null,
    });

    // Ordnen: Die Stelle in der Liste ist die neue Reihenfolge; was stimmt, bleibt unberührt
    const stand = await details(a.id);
    const v = (id: string) =>
      stand.checkliste.find((p) => p.id === id)!.version;
    const ordnen = await anfrage(
      leiter(),
      "PUT",
      `${A(a.id)}/checkliste/reihenfolge`,
      {
        eintraege: [
          { id: p3.id, version: v(p3.id) },
          { id: p1.id, version: v(p1.id) },
          { id: p2.id, version: v(p2.id) },
        ],
      },
    );
    expect(ordnen.status).toBe(204);
    d = await details(a.id);
    expect(d.checkliste.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
    // Ein veralteter Eintrag nimmt die ganze Änderung zurück
    const vorherDetails = d.checkliste.map((p) => p.id);
    const veraltet = await anfrage(
      leiter(),
      "PUT",
      `${A(a.id)}/checkliste/reihenfolge`,
      {
        eintraege: [
          {
            id: p2.id,
            version: d.checkliste.find((p) => p.id === p2.id)!.version,
          },
          { id: p3.id, version: 1 },
        ],
      },
    );
    expect(veraltet.status).toBe(409);
    expect((await details(a.id)).checkliste.map((p) => p.id)).toEqual(
      vorherDetails,
    );

    const aktuell = (await details(a.id)).checkliste.find(
      (p) => p.id === p3.id,
    )!;
    const weg = await anfrage(
      leiter(),
      "DELETE",
      `${A(a.id)}/checkliste/${p3.id}?version=${aktuell.version}`,
    );
    expect(weg.status).toBe(204);
    expect((await details(a.id)).checkliste.map((p) => p.id)).toEqual([
      p1.id,
      p2.id,
    ]);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${A(a.id)}/checkliste/${p3.id}?version=${aktuell.version + 1}`,
        )
      ).status,
    ).toBe(404);
  });

  test("zwei Personen, die verschiedene Punkte abhaken, überschreiben sich nicht", async () => {
    const a = await neu({ verantwortlichPersonId: team().id });
    const [p1, p2] = [await punkt(a.id, "Eins"), await punkt(a.id, "Zwei")];
    const [r1, r2] = await Promise.all([
      anfrage(leiter(), "PATCH", `${A(a.id)}/checkliste/${p1.id}`, {
        version: 1,
        erledigt: true,
      }),
      anfrage(team(), "PATCH", `${A(a.id)}/checkliste/${p2.id}`, {
        version: 1,
        erledigt: true,
      }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const d = await details(a.id);
    expect(
      d.checkliste.map((p) => [p.text, p.erledigt, p.erledigtVonPersonId]),
    ).toEqual([
      ["Eins", true, leiter().id],
      ["Zwei", true, team().id],
    ]);
  });

  test("Eingaben: strikt, Text 1 bis 500 Zeichen, höchstens 100 Punkte, gelöschte Aufgabe 404", async () => {
    const a = await neu();
    const p = await punkt(a.id);
    for (const body of [
      { text: "" },
      { text: "   " },
      { text: "x".repeat(501) },
      { text: "X", unbekannt: 1 },
      { text: "X", reihenfolge: -1 },
      { text: "X", erledigt: true },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${A(a.id)}/checkliste`, body)).status,
      ).toBe(400);
    }
    for (const body of [
      { version: 1 },
      { text: "X" },
      { version: 0, text: "X" },
      { version: 1, text: "X", person: randomUUID() },
      { version: 1, erledigtVonPersonId: randomUUID() },
    ]) {
      expect(
        (
          await anfrage(
            leiter(),
            "PATCH",
            `${A(a.id)}/checkliste/${p.id}`,
            body,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await anfrage(leiter(), "POST", `${A(a.id)}/checkliste`, {
          text: "x".repeat(500),
        })
      ).status,
    ).toBe(201);

    // Obergrenze: 100 Punkte
    const voll = await neu();
    await db.insert(schema.aufgabeCheckpunkt).values(
      Array.from({ length: 100 }, (_, i) => ({
        lagerId,
        aufgabeId: voll.id,
        text: `P${i}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    );
    const zuviel = await anfrage(leiter(), "POST", `${A(voll.id)}/checkliste`, {
      text: "Einer zu viel",
    });
    expect(zuviel.status).toBe(400);
    expect(zuviel.body.code).toBe("ZU_VIELE_CHECKPUNKTE");

    // Gelöschte Aufgabe: 404
    await anfrage(leiter(), "DELETE", `${A(a.id)}?version=1`);
    expect((await anfrage(leiter(), "GET", `${A(a.id)}/details`)).status).toBe(
      404,
    );
    expect(
      (await anfrage(leiter(), "POST", `${A(a.id)}/checkliste`, { text: "X" }))
        .status,
    ).toBe(404);
  });

  test("Datenbanklast: Details und Schreiben hängen nicht von der Zahl der Punkte ab", async () => {
    const a1 = await neu();
    const a2 = await neu();
    await punkt(a1.id);
    await db.insert(schema.aufgabeCheckpunkt).values(
      Array.from({ length: 60 }, (_, i) => ({
        lagerId,
        aufgabeId: a2.id,
        text: `P${i}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    );
    const messe = async (aufgabeId: string) => {
      const vorher = abfragen;
      expect(
        (await anfrage(leiter(), "GET", `${A(aufgabeId)}/details`)).status,
      ).toBe(200);
      return abfragen - vorher;
    };
    await messe(a1.id);
    expect(await messe(a2.id)).toBe(await messe(a1.id));
  });
});

describe("Abteilungsleitung ohne Mitgliedschaft", () => {
  test("hakt Punkte ab, ohne dass eine Person im Punkt steht (der Fremdschlüssel verlangt ein Mitglied)", async () => {
    const a = await neu();
    const p = await punkt(a.id);
    const r = await anfrage(
      konten.abteilungsleitung,
      "PATCH",
      `${A(a.id)}/checkliste/${p.id}`,
      { version: 1, erledigt: true },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ erledigt: true, erledigtVonPersonId: null });
    const offen = await anfrage(
      konten.abteilungsleitung,
      "PATCH",
      `${A(a.id)}/checkliste/${p.id}`,
      { version: 2, erledigt: false },
    );
    expect(offen.body.erledigt).toBe(false);
  });
});

describe("Links", () => {
  test("anlegen, ändern und löschen; nur https, ohne Zugangsdaten; der Server ruft nichts ab", async () => {
    const abruf = vi.spyOn(globalThis, "fetch");
    const a = await neu();
    const l = await anfrage(leiter(), "POST", `${A(a.id)}/links`, {
      titel: " Plan ",
      url: "HTTPS://Beispiel.Example.org/Pfad?x=1",
    });
    expect(l.status).toBe(201);
    expect(l.body).toMatchObject({
      titel: "Plan",
      url: "https://beispiel.example.org/Pfad?x=1",
      version: 1,
      aufgabeId: a.id,
    });
    for (const url of [
      "http://beispiel.example.org",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://example.org:8443/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://example.org\\@evil.example/x",
      "https://example.org/a b",
      "https://exa\u202Emple.org/x",
      "ftp://beispiel.example.org",
      "https://nutzer:geheim@beispiel.example.org",
      "kein link",
      `https://beispiel.example.org/${"a".repeat(2000)}`,
    ]) {
      expect(
        (
          await anfrage(leiter(), "POST", `${A(a.id)}/links`, {
            titel: "T",
            url,
          })
        ).status,
        url.slice(0, 40),
      ).toBe(400);
    }
    expect(
      (
        await anfrage(leiter(), "POST", `${A(a.id)}/links`, {
          titel: "",
          url: "https://a.example.org",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "POST", `${A(a.id)}/links`, {
          titel: "T",
          url: "https://a.example.org",
          x: 1,
        })
      ).status,
    ).toBe(400);

    const g = await anfrage(
      leiter(),
      "PATCH",
      `${A(a.id)}/links/${l.body.id}`,
      {
        version: 1,
        titel: "Neu",
      },
    );
    expect(g.body).toMatchObject({ titel: "Neu", version: 2 });
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${A(a.id)}/links/${l.body.id}`,
      {
        version: 1,
        titel: "Alt",
      },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.abweichend).toEqual(["titel"]);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${A(a.id)}/links/${l.body.id}`, {
          version: 2,
          url: "http://a.example.org",
        })
      ).status,
    ).toBe(400);
    expect((await details(a.id)).links).toEqual([
      expect.objectContaining({ id: l.body.id, titel: "Neu", version: 2 }),
    ]);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${A(a.id)}/links/${l.body.id}?version=2`,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${A(a.id)}/links/${l.body.id}?version=3`,
        )
      ).status,
    ).toBe(404);
    expect((await details(a.id)).links).toEqual([]);
    expect(abruf).not.toHaveBeenCalled();
  });

  test("höchstens 30 Links je Aufgabe", async () => {
    const a = await neu();
    await db.insert(schema.aufgabeLink).values(
      Array.from({ length: 30 }, (_, i) => ({
        lagerId,
        aufgabeId: a.id,
        titel: `L${i}`,
        url: `https://beispiel.example.org/${i}`,
        lagerSeq: 0,
      })),
    );
    const r = await anfrage(leiter(), "POST", `${A(a.id)}/links`, {
      titel: "31",
      url: "https://a.example.org",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ZU_VIELE_LINKS");
  });
});

describe("Stichworte", () => {
  test("setzen ersetzt die Liste, zählt die Version der Aufgabe hoch und filtert die Liste", async () => {
    const id = await neuesLager();
    const a = await neu({}, id);
    const andere = await neu({}, id);
    const gesetzt = await anfrage(
      leiter(),
      "PUT",
      `${A(a.id, id)}/stichworte`,
      {
        version: 1,
        stichworte: [" Material ", "küche"],
      },
    );
    expect(gesetzt.status).toBe(200);
    expect(gesetzt.body.stichworte).toEqual(["küche", "Material"]);
    expect((await aufgabeLesen(a.id, id)).version).toBe(2);
    // Veralteter Stand
    const konflikt = await anfrage(
      leiter(),
      "PUT",
      `${A(a.id, id)}/stichworte`,
      { version: 1, stichworte: [] },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");

    // Ersetzen: Es bleibt genau, was gesendet wird (auch eine andere Schreibweise)
    const ersetzt = await anfrage(
      leiter(),
      "PUT",
      `${A(a.id, id)}/stichworte`,
      {
        version: 2,
        stichworte: ["MATERIAL", "Zelte"],
      },
    );
    expect(ersetzt.body.stichworte).toEqual(["MATERIAL", "Zelte"]);
    const ids = async (query: string) =>
      (
        await anfrage(leiter(), "GET", `${L(id)}/aufgaben?${query}&limit=200`)
      ).body.aufgaben.map((t: { id: string }) => t.id);
    expect(await ids("stichwort=material")).toEqual([a.id]);
    expect(await ids("stichwort=ZELTE")).toEqual([a.id]);
    expect(await ids("stichwort=kueche")).toEqual([]);
    expect(await ids(`stichwort=zelte&ressortId=${randomUUID()}`)).toEqual([]);
    expect(andere.id).toBeTruthy();

    const leer = await anfrage(leiter(), "PUT", `${A(a.id, id)}/stichworte`, {
      version: 3,
      stichworte: [],
    });
    expect(leer.body.stichworte).toEqual([]);
  });

  test("Eingaben: strikt, ohne Doppelte (ohne Gross- und Kleinschreibung), 1 bis 40 Zeichen, höchstens 30", async () => {
    const a = await neu();
    for (const stichworte of [
      ["A", "a"],
      [""],
      ["   "],
      ["x".repeat(41)],
      ["Zelt\u0000"],
      ["Zelt\u202E"],
      Array.from({ length: 31 }, (_, i) => `w${i}`),
    ]) {
      expect(
        (
          await anfrage(leiter(), "PUT", `${A(a.id)}/stichworte`, {
            version: 1,
            stichworte,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await anfrage(leiter(), "PUT", `${A(a.id)}/stichworte`, {
          version: 1,
          stichworte: ["x"],
          mehr: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "PUT", `${A(a.id)}/stichworte`, {
          stichworte: ["x"],
        })
      ).status,
    ).toBe(400);
    const dreissig = await anfrage(leiter(), "PUT", `${A(a.id)}/stichworte`, {
      version: 1,
      stichworte: Array.from({ length: 30 }, (_, i) => `w${i}`),
    });
    expect(dreissig.status).toBe(200);
    // Der Filter mit zu langem Stichwort: 400
    expect(
      (
        await anfrage(
          leiter(),
          "GET",
          `${L()}/aufgaben?stichwort=${"x".repeat(41)}`,
        )
      ).status,
    ).toBe(400);
  });
});

describe("Wiederholung", () => {
  test("naechsteFrist: wöchentlich, alle zwei Wochen, monatlich mit Monatsende", () => {
    expect(naechsteFrist("2027-07-10", "w1")).toBe("2027-07-17");
    expect(naechsteFrist("2027-07-25", "w2")).toBe("2027-08-08");
    expect(naechsteFrist("2027-12-28", "w1")).toBe("2028-01-04");
    expect(naechsteFrist("2027-07-10", "m1")).toBe("2027-08-10");
    expect(naechsteFrist("2027-01-31", "m1")).toBe("2027-02-28");
    expect(naechsteFrist("2028-01-31", "m1")).toBe("2028-02-29");
    expect(naechsteFrist("2027-01-30", "m1")).toBe("2027-02-28");
    expect(naechsteFrist("2027-03-31", "m1")).toBe("2027-04-30");
    expect(naechsteFrist("2027-12-15", "m1")).toBe("2028-01-15");
    expect(naechsteFrist("2027-12-31", "m1")).toBe("2028-01-31");
    expect(naechsteFrist("2027-02-28", "m1")).toBe("2027-03-28");
  });

  const folgen = (aufgabeId: string, id = lagerId) =>
    db
      .select()
      .from(schema.aufgabe)
      .where(
        and(
          eq(schema.aufgabe.lagerId, id),
          eq(schema.aufgabe.quelle, `wiederholung:${aufgabeId}`),
        ),
      );

  test("Erledigen legt die nächste Aufgabe an: Angaben, verschobene Frist, Checkliste von vorn, Links, Stichworte, Unterstützung", async () => {
    const v = await mitglied();
    const u = await mitglied();
    const r = await ressort();
    const a = await neu({
      titel: "Zelte prüfen",
      ressortId: r,
      teil: "Material",
      verantwortlichPersonId: v,
      unterstuetzungPersonIds: [u],
      notiz: "Jede Woche",
      frist: "2027-07-12",
      spaeterAb: "2027-07-10",
      stern: true,
      laufend: true,
      wiederholung: "w1",
    });
    const p1 = await punkt(a.id, "Heringe zählen");
    await punkt(a.id, "Planen flicken");
    await anfrage(leiter(), "PATCH", `${A(a.id)}/checkliste/${p1.id}`, {
      version: 1,
      erledigt: true,
    });
    await link(a.id, "https://beispiel.example.org/plan");
    const mitWorten = await anfrage(leiter(), "PUT", `${A(a.id)}/stichworte`, {
      version: 1,
      stichworte: ["material", "Küche"],
    });
    expect(mitWorten.status).toBe(200);

    const erledigt = await statusSetzen(a, 2, "erledigt");
    expect(erledigt.status).toBe(200);
    expect(erledigt.body.status).toBe("erledigt");

    const [folge] = await folgen(a.id);
    expect(await folgen(a.id)).toHaveLength(1);
    expect(folge).toMatchObject({
      titel: "Zelte prüfen",
      ressortId: r,
      teil: "Material",
      verantwortlichPersonId: v,
      notiz: "Jede Woche",
      frist: "2027-07-19",
      spaeterAb: "2027-07-17",
      stern: true,
      laufend: true,
      wiederholung: "w1",
      status: "offen",
      erledigtAm: null,
      version: 1,
      erstelltVon: leiter().id,
    });
    const aktuell = await anfrage(leiter(), "GET", A(folge!.id));
    expect(
      aktuell.body.unterstuetzung.map((x: { id: string }) => x.id),
    ).toEqual([u]);
    const d = await details(folge!.id);
    expect(
      d.checkliste.map((p) => [
        p.text,
        p.erledigt,
        p.erledigtVonPersonId,
        p.reihenfolge,
      ]),
    ).toEqual([
      ["Heringe zählen", false, null, 0],
      ["Planen flicken", false, null, 1],
    ]);
    expect(d.links.map((l) => l.url)).toEqual([
      "https://beispiel.example.org/plan",
    ]);
    expect(d.stichworte).toEqual(["Küche", "material"]);
    // Die erledigte Aufgabe behält ihre Checkliste
    expect((await details(a.id)).checkliste.map((p) => p.erledigt)).toEqual([
      true,
      false,
    ]);
    // Die Verantwortliche bekommt Bescheid über die neue Aufgabe
    const glocke = await db
      .select({ art: schema.lagerBenachrichtigung.art })
      .from(schema.lagerBenachrichtigung)
      .where(
        and(
          eq(schema.lagerBenachrichtigung.personId, v),
          eq(schema.lagerBenachrichtigung.objektId, folge!.id),
        ),
      );
    expect(glocke.map((g) => g.art)).toEqual(["aufgabe_zugeteilt"]);
    // Die Folgeaufgabe wiederholt sich selbst weiter
    const weiter = await statusSetzen(folge!, 1, "erledigt");
    expect(weiter.status).toBe(200);
    expect((await folgen(folge!.id))[0]).toMatchObject({ frist: "2027-07-26" });
  });

  test("genau einmal: erneutes Erledigen, doppeltes Senden und gleichzeitige Anfragen legen keine zweite an", async () => {
    const a = await neu({
      titel: "Einmal",
      frist: "2027-07-12",
      wiederholung: "w2",
    });
    expect((await statusSetzen(a, 1, "erledigt")).status).toBe(200);
    // Dieselbe Anfrage noch einmal: veraltete Version
    expect((await statusSetzen(a, 1, "erledigt")).status).toBe(409);
    expect(await folgen(a.id)).toHaveLength(1);
    // Aktuelle Version, Status bleibt erledigt
    expect((await statusSetzen(a, 2, "erledigt")).status).toBe(200);
    expect(await folgen(a.id)).toHaveLength(1);
    // Wieder öffnen und erneut erledigen
    expect((await statusSetzen(a, 3, "offen")).status).toBe(200);
    expect((await statusSetzen(a, 4, "erledigt")).status).toBe(200);
    expect(await folgen(a.id)).toHaveLength(1);
    expect((await folgen(a.id))[0]!.frist).toBe("2027-07-26");

    const b = await neu({
      titel: "Parallel",
      frist: "2027-07-12",
      wiederholung: "w1",
    });
    const antworten = await Promise.all(
      Array.from({ length: 6 }, () => statusSetzen(b, 1, "erledigt")),
    );
    expect(antworten.map((x) => x.status).sort()).toEqual([
      200, 409, 409, 409, 409, 409,
    ]);
    expect(await folgen(b.id)).toHaveLength(1);
  });

  test("eine gelöschte Folgeaufgabe ist endgültig weg: wer die Aufgabe erneut erledigt, bekommt wieder eine", async () => {
    const a = await neu({ titel: "Gelöscht", wiederholung: "w1" });
    await statusSetzen(a, 1, "erledigt");
    const [folge] = await folgen(a.id);
    expect(
      (await anfrage(leiter(), "DELETE", `${A(folge!.id)}?version=1`)).status,
    ).toBe(204);
    await statusSetzen(a, 2, "offen");
    await statusSetzen(a, 3, "erledigt");
    // Es gibt keine Spur der gelöschten mehr, die eine neue verhindert (#427)
    const nach = await folgen(a.id);
    expect(nach).toHaveLength(1);
    expect(nach[0]!.id).not.toBe(folge!.id);
  });

  test("über PATCH, mit gleichzeitigen Änderungen und ohne Frist; ohne Wiederholung keine Folge", async () => {
    const a = await neu({
      titel: "Monatlich",
      frist: "2027-01-31",
      wiederholung: "m1",
    });
    const patch = await anfrage(leiter(), "PATCH", A(a.id), {
      version: 1,
      status: "erledigt",
      titel: "Monatlich neu",
    });
    expect(patch.status).toBe(200);
    expect((await folgen(a.id))[0]).toMatchObject({
      titel: "Monatlich neu",
      frist: "2027-02-28",
      wiederholung: "m1",
    });
    // PATCH ohne Statuswechsel legt nichts an
    const b = await neu({ titel: "Nur Titel", wiederholung: "w1" });
    await anfrage(leiter(), "PATCH", A(b.id), { version: 1, titel: "Anders" });
    expect(await folgen(b.id)).toHaveLength(0);
    // Ohne Frist bleibt auch die Frist der nächsten leer
    await statusSetzen(b, 2, "erledigt");
    expect((await folgen(b.id))[0]!.frist).toBeNull();
    // Ohne Wiederholung keine nächste
    const c = await neu({ titel: "Einmalig" });
    await statusSetzen(c, 1, "erledigt");
    expect(await folgen(c.id)).toHaveLength(0);
    // Wechsel von «erledigt» auf einen anderen Status legt nichts an
    const d = await neu({
      titel: "Zurück",
      wiederholung: "w1",
      status: "erledigt",
    });
    await statusSetzen(d, 1, "laeuft");
    expect(await folgen(d.id)).toHaveLength(0);
  });

  test("das Team erledigt eine eigene wiederkehrende Aufgabe; die Warteschlange legt die nächste einmal an", async () => {
    const a = await neu({
      titel: "Team",
      wiederholung: "w1",
      verantwortlichPersonId: team().id,
    });
    expect((await statusSetzen(a, 1, "erledigt", lagerId, team())).status).toBe(
      200,
    );
    expect(await folgen(a.id)).toHaveLength(1);

    const b = await neu({ titel: "Queue", wiederholung: "w1" });
    const clientOpId = randomUUID();
    const sende = () =>
      anfrage(leiter(), "POST", `${L()}/aenderungen`, {
        operationen: [
          {
            clientOpId,
            typ: "aufgabe.status",
            nutzlast: { id: b.id, version: 1, status: "erledigt" },
          },
        ],
      });
    expect((await sende()).body.ergebnisse[0].status).toBe("ok");
    expect((await sende()).body.ergebnisse[0].status).toBe("ok");
    expect(await folgen(b.id)).toHaveLength(1);
  });
});

describe("Duplikate", () => {
  test("normalisiereTitel: Gross- und Kleinschreibung, Satzzeichen, Leerraum und Akzente zählen nicht", () => {
    expect(normalisiereTitel("  Zelte   prüfen! ")).toBe("zelte prufen");
    expect(normalisiereTitel("ZELTE PRÜFEN.")).toBe("zelte prufen");
    expect(normalisiereTitel("Zelte prüfen")).toBe(
      normalisiereTitel("zelte  Prüfen,"),
    );
    expect(normalisiereTitel("Zelte 2")).not.toBe(normalisiereTitel("Zelte 3"));
    expect(normalisiereTitel("!!!")).toBe("");
  });

  test("meldet gleiche Titel im selben Ressort, erledigte und gelöschte Aufgaben zählen nicht", async () => {
    const id = await neuesLager();
    const [r1, r2] = [await ressort(id), await ressort(id)];
    const a1 = await neu({ titel: "Zelte prüfen", ressortId: r1 }, id);
    const a2 = await neu({ titel: "zelte  prüfen!", ressortId: r1 }, id);
    const a3 = await neu({ titel: "Zelte prüfen", ressortId: r2 }, id);
    const a4 = await neu({ titel: "ZELTE PRÜFEN." }, id);
    const erledigt = await neu({ titel: "Zelte prüfen", ressortId: r1 }, id);
    await statusSetzen(erledigt, 1, "erledigt", id);
    const weg = await neu({ titel: "Zelte prüfen", ressortId: r1 }, id);
    await anfrage(leiter(), "DELETE", `${A(weg.id, id)}?version=1`);
    await neu({ titel: "Anderes", ressortId: r1 }, id);

    const gruppe = async (query: string) =>
      (await anfrage(leiter(), "GET", `${L(id)}/aufgaben/duplikate?${query}`))
        .body.gruppen as {
        ressortId: string | null;
        aufgaben: { id: string; version: number }[];
      }[];
    const ids = (g: { aufgaben: { id: string }[] }[]) =>
      g.map((x) => x.aufgaben.map((a) => a.id));
    // Hinweis beim Anlegen: derselbe Titel im selben Ressort
    expect(
      ids(
        await gruppe(
          `titel=${encodeURIComponent("Zelte prüfen")}&ressortId=${r1}`,
        ),
      ),
    ).toEqual([[a1.id, a2.id]]);
    expect(
      ids(
        await gruppe(
          `titel=${encodeURIComponent("Zelte prüfen")}&ressortId=${r2}`,
        ),
      ),
    ).toEqual([[a3.id]]);
    expect(
      ids(await gruppe(`titel=${encodeURIComponent("Zelte prüfen")}`)),
    ).toEqual([[a4.id]]);
    expect(
      await gruppe(
        `titel=${encodeURIComponent("Gibt es nicht")}&ressortId=${r1}`,
      ),
    ).toEqual([]);
    expect(await gruppe(`titel=${encodeURIComponent("!!!")}`)).toEqual([]);
    // Ohne Titel: alle Gruppen mit mindestens zwei Aufgaben
    const alle = await gruppe("");
    expect(ids(alle)).toEqual([[a1.id, a2.id]]);
    expect(alle[0]).toMatchObject({ ressortId: r1 });
    expect(alle[0]!.aufgaben[0]).toMatchObject({ version: 1 });
    expect(await gruppe(`ressortId=${r2}`)).toEqual([]);
    // Eingaben: strikt
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/aufgaben/duplikate?x=1`))
        .status,
    ).toBe(400);
    expect(
      (
        await anfrage(
          leiter(),
          "GET",
          `${L(id)}/aufgaben/duplikate?ressortId=kein`,
        )
      ).status,
    ).toBe(400);
  });

  test("Datenbanklast: eine Abfrage für die Aufgaben, gleich viele bei wenigen und vielen", async () => {
    const klein = await neuesLager();
    const gross = await neuesLager();
    await neu({ titel: "A" }, klein);
    await db.insert(schema.aufgabe).values(
      Array.from({ length: 50 }, (_, i) => ({
        lagerId: gross,
        titel: `T${i}`,
        lagerSeq: 0,
      })),
    );
    const messe = async (id: string) => {
      const vorher = abfragen;
      await anfrage(leiter(), "GET", `${L(id)}/aufgaben/duplikate`);
      return abfragen - vorher;
    };
    await messe(klein);
    expect(await messe(gross)).toBe(await messe(klein));
  });
});

describe("Zusammenführen", () => {
  async function paar(id: string) {
    const a = await neu(
      { titel: "A", notiz: "Notiz A", frist: "2027-07-20" },
      id,
    );
    const b = await neu(
      { titel: "B", notiz: "Notiz B", frist: "2027-07-15" },
      id,
    );
    const pa = [
      await punkt(a.id, "Heringe zählen", id),
      await punkt(a.id, "Zelt", id),
    ];
    const pb = [
      await punkt(b.id, "heringe zählen!", id),
      await punkt(b.id, "Plane", id),
    ];
    await anfrage(leiter(), "PATCH", `${A(b.id, id)}/checkliste/${pb[1]!.id}`, {
      version: 1,
      erledigt: true,
    });
    for (const [aufgabe, url] of [
      [a, "https://beispiel.example.org/plan"],
      [b, "https://beispiel.example.org/plan"],
      [b, "https://beispiel.example.org/liste"],
    ] as const) {
      await anfrage(leiter(), "POST", `${A(aufgabe.id, id)}/links`, {
        titel: "L",
        url,
      });
    }
    await anfrage(leiter(), "PUT", `${A(a.id, id)}/stichworte`, {
      version: 1,
      stichworte: ["Material"],
    });
    await anfrage(leiter(), "PUT", `${A(b.id, id)}/stichworte`, {
      version: 1,
      stichworte: ["material", "Küche"],
    });
    return { a: { ...a, version: 2 }, b: { ...b, version: 2 }, pa, pb };
  }

  test("vereint Checkliste, Links, Stichworte, Notiz und Frist; die zweite Aufgabe ist samt ihren Details weg", async () => {
    const id = await neuesLager();
    const { a, b } = await paar(id);
    const r = await anfrage(
      leiter(),
      "POST",
      `${A(a.id, id)}/zusammenfuehren`,
      {
        version: a.version,
        mitId: b.id,
        mitVersion: b.version,
      },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: a.id,
      titel: "A",
      notiz: "Notiz A\n\nNotiz B",
      frist: "2027-07-15",
      version: a.version + 1,
    });
    const d = await details(a.id, leiter(), id);
    expect(d.checkliste.map((p) => [p.text, p.erledigt])).toEqual([
      ["Heringe zählen", false],
      ["Zelt", false],
      ["Plane", true],
    ]);
    expect(d.checkliste[2]!.erledigtVonPersonId).toBe(leiter().id);
    expect(d.links.map((l) => l.url).sort()).toEqual([
      "https://beispiel.example.org/liste",
      "https://beispiel.example.org/plan",
    ]);
    expect(d.stichworte).toEqual(["Küche", "Material"]);

    // Die zweite Aufgabe ist endgültig weg, mit ihren Details
    expect((await anfrage(leiter(), "GET", A(b.id, id))).status).toBe(404);
    expect(
      await db.select().from(schema.aufgabe).where(eq(schema.aufgabe.id, b.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.aufgabeCheckpunkt)
        .where(eq(schema.aufgabeCheckpunkt.aufgabeId, b.id)),
    ).toHaveLength(0);
    // Der Feed meldet die Löschung der Aufgabe und ihrer Checkpunkte
    const feed = await anfrage(leiter(), "GET", `${L(id)}/aenderungen?seit=0`);
    expect(feed.body.eintraege).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: b.id, art: "geloescht" }),
        expect.objectContaining({
          objekttyp: "aufgabe_checkpunkt",
          art: "geloescht",
        }),
      ]),
    );
  });

  test("hat nur eine Aufgabe eine Notiz oder Frist, gilt diese", async () => {
    const id = await neuesLager();
    const a = await neu({ titel: "A" }, id);
    const b = await neu(
      { titel: "B", notiz: "Nur B", frist: "2027-08-01" },
      id,
    );
    const r = await anfrage(
      leiter(),
      "POST",
      `${A(a.id, id)}/zusammenfuehren`,
      {
        version: 1,
        mitId: b.id,
        mitVersion: 1,
      },
    );
    expect(r.body).toMatchObject({ notiz: "Nur B", frist: "2027-08-01" });
  });

  test("ein Konflikt, dieselbe Aufgabe, eine gesprengte Obergrenze oder eine zu lange Notiz schreiben nichts", async () => {
    const id = await neuesLager();
    const { a, b } = await paar(id);
    const vorher = await details(a.id, leiter(), id);
    const gleich = async () => {
      expect(await details(a.id, leiter(), id)).toEqual(vorher);
      expect((await anfrage(leiter(), "GET", A(b.id, id))).status).toBe(200);
      expect((await aufgabeLesen(a.id, id)).version).toBe(a.version);
    };
    const falschA = await anfrage(
      leiter(),
      "POST",
      `${A(a.id, id)}/zusammenfuehren`,
      {
        version: a.version + 5,
        mitId: b.id,
        mitVersion: b.version,
      },
    );
    expect(falschA.status).toBe(409);
    expect(falschA.body.code).toBe("VERSION_KONFLIKT");
    await gleich();
    const falschB = await anfrage(
      leiter(),
      "POST",
      `${A(a.id, id)}/zusammenfuehren`,
      {
        version: a.version,
        mitId: b.id,
        mitVersion: b.version + 5,
      },
    );
    expect(falschB.status).toBe(409);
    await gleich();
    const selbst = await anfrage(
      leiter(),
      "POST",
      `${A(a.id, id)}/zusammenfuehren`,
      {
        version: a.version,
        mitId: a.id,
        mitVersion: a.version,
      },
    );
    expect([selbst.status, selbst.body.code]).toEqual([400, "GLEICHE_AUFGABE"]);
    await gleich();

    // Zu viele Checkpunkte: 60 und 60 verschiedene
    const g1 = await neu({ titel: "G1" }, id);
    const g2 = await neu({ titel: "G2" }, id);
    for (const [aufgabe, vorsilbe] of [
      [g1, "x"],
      [g2, "y"],
    ] as const) {
      await db.insert(schema.aufgabeCheckpunkt).values(
        Array.from({ length: 60 }, (_, i) => ({
          lagerId: id,
          aufgabeId: aufgabe.id,
          text: `${vorsilbe}${i}`,
          reihenfolge: i,
          lagerSeq: 0,
        })),
      );
    }
    const zuviele = await anfrage(
      leiter(),
      "POST",
      `${A(g1.id, id)}/zusammenfuehren`,
      {
        version: 1,
        mitId: g2.id,
        mitVersion: 1,
      },
    );
    expect([zuviele.status, zuviele.body.code]).toEqual([
      400,
      "ZU_VIELE_CHECKPUNKTE",
    ]);
    expect((await anfrage(leiter(), "GET", A(g2.id, id))).status).toBe(200);

    // Zu lange Notiz
    const n1 = await neu({ titel: "N1", notiz: "a".repeat(3000) }, id);
    const n2 = await neu({ titel: "N2", notiz: "b".repeat(3000) }, id);
    const zulang = await anfrage(
      leiter(),
      "POST",
      `${A(n1.id, id)}/zusammenfuehren`,
      {
        version: 1,
        mitId: n2.id,
        mitVersion: 1,
      },
    );
    expect([zulang.status, zulang.body.code]).toEqual([400, "NOTIZ_ZU_LANG"]);
    expect((await aufgabeLesen(n2.id, id)).version).toBe(1);

    // Eine gelöschte zweite Aufgabe gibt es nicht
    await anfrage(leiter(), "DELETE", `${A(n2.id, id)}?version=1`);
    expect(
      (
        await anfrage(leiter(), "POST", `${A(n1.id, id)}/zusammenfuehren`, {
          version: 1,
          mitId: n2.id,
          mitVersion: 2,
        })
      ).status,
    ).toBe(404);
  });
});

describe("Verlauf", () => {
  test("zeigt die Änderungen der Aufgabe, ihrer Checkpunkte und Links, neueste zuerst, mit Seitenwechsel", async () => {
    const id = await neuesLager();
    const a = await neu({ titel: "Verlauf" }, id);
    const andere = await neu({ titel: "Andere" }, id);
    await punkt(andere.id, "Fremd", id);
    const p = await punkt(a.id, "Punkt", id);
    const l = await anfrage(leiter(), "POST", `${A(a.id, id)}/links`, {
      titel: "L",
      url: "https://a.example.org",
    });
    await anfrage(leiter(), "PATCH", `${A(a.id, id)}/checkliste/${p.id}`, {
      version: 1,
      erledigt: true,
    });
    await anfrage(leiter(), "PATCH", A(a.id, id), { version: 1, stern: true });

    const v = await anfrage(leiter(), "GET", `${A(a.id, id)}/verlauf`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({
      aufgabeId: a.id,
      erstelltVon: { id: leiter().id },
      geaendertVon: { id: leiter().id },
      naechster: null,
    });
    expect(
      v.body.eintraege.map(
        (e: { objekttyp: string; art: string; version: number }) => [
          e.objekttyp,
          e.art,
          e.version,
        ],
      ),
    ).toEqual([
      ["aufgabe", "geaendert", 2],
      ["aufgabe_checkpunkt", "geaendert", 2],
      ["aufgabe_link", "neu", 1],
      ["aufgabe_checkpunkt", "neu", 1],
      ["aufgabe", "neu", 1],
    ]);
    const seqs = v.body.eintraege.map((e: { seq: number }) => e.seq);
    expect([...seqs].sort((x: number, y: number) => y - x)).toEqual(seqs);
    expect(v.body.eintraege.map((e: { id: string }) => e.id)).not.toContain(
      andere.id,
    );
    expect(l.status).toBe(201);

    // Seitenwechsel
    const s1 = await anfrage(leiter(), "GET", `${A(a.id, id)}/verlauf?limit=2`);
    expect(s1.body.eintraege).toHaveLength(2);
    expect(s1.body.naechster).toBe(s1.body.eintraege[1].seq);
    const s2 = await anfrage(
      leiter(),
      "GET",
      `${A(a.id, id)}/verlauf?limit=10&vor=${s1.body.naechster}`,
    );
    expect(s2.body.eintraege.map((e: { seq: number }) => e.seq)).toEqual(
      seqs.slice(2),
    );
    expect(
      (await anfrage(leiter(), "GET", `${A(a.id, id)}/verlauf?limit=0`)).status,
    ).toBe(400);
    expect(
      (await anfrage(leiter(), "GET", `${A(a.id, id)}/verlauf?x=1`)).status,
    ).toBe(400);
    // Lesen darf, das Team nicht
    expect(
      (await anfrage(konten.lesen, "GET", `${A(a.id, id)}/verlauf`)).status,
    ).toBe(200);
    expect(
      (await anfrage(team(), "GET", `${A(a.id, id)}/verlauf`)).status,
    ).toBe(403);
  });
});

describe("Warteschlange für Offline-Änderungen", () => {
  type Ergebnis = {
    status: string;
    ergebnis?: { id: string; version: number };
  };
  async function sende(
    konto: PersonaKonto,
    operationen: { typ: string; nutzlast: Record<string, unknown> }[],
  ) {
    const a = await anfrage(konto, "POST", `${L()}/aenderungen`, {
      operationen: operationen.map((o) => ({ clientOpId: randomUUID(), ...o })),
    });
    expect(a.status).toBe(200);
    return a.body.ergebnisse as Ergebnis[];
  }

  test("anlegen, ändern, abhaken, Links, Stichworte und löschen laufen wie über die Routen", async () => {
    const a = await neu();
    const [angelegt] = await sende(leiter(), [
      {
        typ: "checkpunkt.anlegen",
        nutzlast: { aufgabeId: a.id, text: "Offline" },
      },
    ]);
    expect(angelegt).toMatchObject({ status: "ok", ergebnis: { version: 1 } });
    const pid = angelegt!.ergebnis!.id;
    const [geaendert, abgehakt, linkOp, linkAendern, worte] = await sende(
      leiter(),
      [
        {
          typ: "checkpunkt.aendern",
          nutzlast: { aufgabeId: a.id, id: pid, version: 1, text: "Neu" },
        },
        {
          typ: "checkpunkt.abhaken",
          nutzlast: { aufgabeId: a.id, id: pid, version: 2, erledigt: true },
        },
        {
          typ: "aufgabe_link.anlegen",
          nutzlast: {
            aufgabeId: a.id,
            titel: "L",
            url: "https://a.example.org",
          },
        },
        {
          typ: "aufgabe_link.anlegen",
          nutzlast: {
            aufgabeId: a.id,
            titel: "L",
            url: "http://unsicher.example.org",
          },
        },
        {
          typ: "aufgabe.stichworte",
          nutzlast: { aufgabeId: a.id, version: 1, stichworte: ["offline"] },
        },
      ],
    );
    expect(geaendert).toMatchObject({ status: "ok" });
    expect(abgehakt).toMatchObject({ status: "ok", ergebnis: { version: 3 } });
    expect(linkOp).toMatchObject({ status: "ok" });
    expect(linkAendern!.status).toBe("abgelehnt");
    expect(worte).toMatchObject({ status: "ok" });
    const d = await details(a.id);
    expect(d.checkliste).toEqual([
      expect.objectContaining({
        text: "Neu",
        erledigt: true,
        erledigtVonPersonId: leiter().id,
      }),
    ]);
    expect(d.links).toHaveLength(1);
    expect(d.stichworte).toEqual(["offline"]);
    const [loeschen, linkLoeschen] = await sende(leiter(), [
      {
        typ: "checkpunkt.loeschen",
        nutzlast: { aufgabeId: a.id, id: pid, version: 3 },
      },
      {
        typ: "aufgabe_link.loeschen",
        nutzlast: { aufgabeId: a.id, id: d.links[0]!.id, version: 1 },
      },
    ]);
    expect([loeschen!.status, linkLoeschen!.status]).toEqual(["ok", "ok"]);
    expect(await details(a.id)).toMatchObject({ checkliste: [], links: [] });
  });

  test("das Team darf eigene Punkte abhaken, sonst nichts; eine fremde Aufgabe wird abgelehnt", async () => {
    const eigene = await neu({ verantwortlichPersonId: team().id });
    const fremde = await neu();
    const pe = await punkt(eigene.id);
    const pf = await punkt(fremde.id);
    const [ok, fremd, anlegen, text] = await sende(team(), [
      {
        typ: "checkpunkt.abhaken",
        nutzlast: {
          aufgabeId: eigene.id,
          id: pe.id,
          version: 1,
          erledigt: true,
        },
      },
      {
        typ: "checkpunkt.abhaken",
        nutzlast: {
          aufgabeId: fremde.id,
          id: pf.id,
          version: 1,
          erledigt: true,
        },
      },
      {
        typ: "checkpunkt.anlegen",
        nutzlast: { aufgabeId: eigene.id, text: "X" },
      },
      {
        typ: "checkpunkt.aendern",
        nutzlast: { aufgabeId: eigene.id, id: pe.id, version: 2, text: "X" },
      },
    ]);
    expect([ok!.status, fremd!.status, anlegen!.status, text!.status]).toEqual([
      "ok",
      "abgelehnt",
      "abgelehnt",
      "abgelehnt",
    ]);
    expect((await details(fremde.id)).checkliste[0]!.erledigt).toBe(false);
  });
});

describe("Verknüpfte Daten", () => {
  test("Details gehen mit der Aufgabe; ein Mitglied, das geht, nimmt nur seinen Namen vom Haken", async () => {
    const m = await mitglied();
    const a = await neu();
    const p = await punkt(a.id);
    // Das Mitglied hakt ab (über die Datenbank: Das Konto hat keine Sitzung im Test)
    await db
      .update(schema.aufgabeCheckpunkt)
      .set({ erledigt: true, personId: m })
      .where(eq(schema.aufgabeCheckpunkt.id, p.id));
    expect((await details(a.id)).checkliste[0]).toMatchObject({
      erledigt: true,
      erledigtVonPersonId: m,
    });
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, m),
        ),
      );
    expect((await details(a.id)).checkliste[0]).toMatchObject({
      erledigt: true,
      erledigtVonPersonId: null,
      erledigtVon: null,
    });
    // Die Aufgabe endgültig weg: die Details gehen mit
    await db.delete(schema.aufgabe).where(inArray(schema.aufgabe.id, [a.id]));
    const rest = await db
      .select()
      .from(schema.aufgabeCheckpunkt)
      .where(eq(schema.aufgabeCheckpunkt.aufgabeId, a.id));
    expect(rest).toEqual([]);
  });
});
