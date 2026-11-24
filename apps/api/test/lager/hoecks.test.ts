import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import ICAL from "ical.js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
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

// Jede Abfrage an die Datenbank zählt mit: Die Tests der Datenbanklast vergleichen die Zahl für kleine und grosse Listen
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
let lagerId: string;
let geschlossenId: string;
let fremdLagerId: string;

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
      titel: "Höcklager",
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
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await neuesLager();
  geschlossenId = await neuesLager(welt.testabteilungId, "abgeschlossen");
  fremdLagerId = await neuesLager(welt.demoAbteilungId);
});

// Die Bodys prüfen die Tests Feld für Feld; ein Typ je Route brächte hier nichts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any; headers: Headers; text: string };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
  kopf: Record<string, string> = {},
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, ...kopf, "content-type": "application/json" }
      : { ...konto.headers, ...kopf },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const istJson = res.headers.get("content-type")?.includes("json");
  return {
    status: res.status,
    body: text && istJson ? JSON.parse(text) : null,
    headers: res.headers,
    text,
  };
}

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
const team = () => konten.team;

async function neuerHoeck(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/hoecks`, {
    titel: "Höck",
    art: "lagerleitung",
    datum: "2027-06-15",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    art: string;
    datum: string;
    zeit: string | null;
    titel: string;
    ort: string | null;
    gaeste: string | null;
    protokollId: string | null;
    anwesende: { id: string; name: string }[];
    traktanden: TraktandumAntwort[];
  };
}
type TraktandumAntwort = {
  id: string;
  version: number;
  hoeckId: string | null;
  titel: string;
  text: string | null;
  entscheid: string | null;
  links: { titel: string; url: string }[];
  reihenfolge: number;
  aufgabeId: string | null;
  status: string;
  dauerMinuten: number | null;
  verantwortliche: { id: string; name: string }[];
};
async function neuesTraktandum(
  werte: Record<string, unknown> = {},
  id = lagerId,
) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/traktanden`, {
    titel: "Traktandum",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as TraktandumAntwort;
}
async function mitglied(lager = lagerId, rolle: "team" | "leitung" = "team") {
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
    .values({ lagerId: lager, personId: p!.id, rolle });
  return p!.id;
}
const setzeRecht = (
  id: string,
  rolle: "leitung" | "team" | "lesen",
  recht: string,
  erlaubt: boolean,
) =>
  db
    .insert(schema.lagerRolleRecht)
    .values({ lagerId: id, rolle, recht, erlaubt })
    .onConflictDoUpdate({
      target: [
        schema.lagerRolleRecht.lagerId,
        schema.lagerRolleRecht.rolle,
        schema.lagerRolleRecht.recht,
      ],
      set: { erlaubt },
    });

describe("Rechte je Lager-Persona", () => {
  // Standard: Lagerleitung, Abteilungsleitung und Leitung lesen und bearbeiten, Lesen liest alle, Team liest nur Team-Höcks (reduziert)
  const lesenListe: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 200,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const nurAlle: Record<LagerPersona, number> = {
    ...lesenListe,
    team: 403,
  };
  const schreiben: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 201,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };

  test.each(LAGER_PERSONAS)("%s: Liste lesen", async (p) => {
    const a = await anfrage(konten[p], "GET", `${L()}/hoecks`);
    expect(a.status).toBe(lesenListe[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Höck anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/hoecks`, {
      titel: "Rechte",
      art: "team",
      datum: "2027-06-15",
    });
    expect(a.status).toBe(schreiben[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Traktandum anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/traktanden`, {
      titel: "Rechte",
    });
    expect(a.status).toBe(schreiben[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Höck-Modus", async (p) => {
    const h = await neuerHoeck();
    const a = await anfrage(konten[p], "GET", `${L()}/hoecks/${h.id}/modus`);
    expect(a.status).toBe(nurAlle[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Entscheide und wartende Punkte", async (p) => {
    expect((await anfrage(konten[p], "GET", `${L()}/entscheide`)).status).toBe(
      nurAlle[p],
    );
    expect(
      (await anfrage(konten[p], "GET", `${L()}/traktanden/naechster`)).status,
    ).toBe(nurAlle[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Anwesenheit abhaken", async (p) => {
    const h = await neuerHoeck();
    const a = await anfrage(
      konten[p],
      "PUT",
      `${L()}/hoecks/${h.id}/anwesende/${konten.lesen.id}`,
    );
    expect(a.status).toBe(
      { ...schreiben, abteilungsleitung: 204, lagerleitung: 204, leitung: 204 }[
        p
      ],
    );
  });

  test("ein Höck eines fremden Lagers ist 404, auch mit Recht im eigenen Lager", async () => {
    const h = await neuerHoeck();
    expect(
      (await anfrage(leiter(), "GET", `${L(fremdLagerId)}/hoecks/${h.id}`))
        .status,
    ).toBe(404);
    // Ein Höck des eigenen Lagers über die URL eines anderen Lagers der Abteilung
    const anderes = await neuesLager();
    expect(
      (await anfrage(leiter(), "GET", `${L(anderes)}/hoecks/${h.id}`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(anderes)}/hoecks/${h.id}`, {
          version: 1,
          titel: "Fremd",
        })
      ).status,
    ).toBe(404);
  });

  test("abgeschlossenes Lager: lesen geht, jede Änderung ist 409", async () => {
    expect(
      (await anfrage(leiter(), "GET", `${L(geschlossenId)}/hoecks`)).status,
    ).toBe(200);
    for (const [methode, pfad, body] of [
      ["POST", "hoecks", { titel: "x", art: "team", datum: "2027-06-15" }],
      ["POST", "traktanden", { titel: "x" }],
    ] as const) {
      const a = await anfrage(
        leiter(),
        methode,
        `${L(geschlossenId)}/${pfad}`,
        body,
      );
      expect(a.status).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
  });
});

describe("Team-Sicht", () => {
  test("das Team sieht von Höcks nur Team-Höcks mit Datum, Zeit, Titel und Ort", async () => {
    const id = await neuesLager();
    const intern = await neuerHoeck(
      { titel: "Intern", art: "lagerleitung", ort: "Geheim" },
      id,
    );
    const offen = await neuerHoeck(
      {
        titel: "Teamabend",
        art: "team",
        datum: "2027-06-20",
        zeit: "19:00",
        ort: "Pfadiheim",
        gaeste: "Gast Eins",
      },
      id,
    );
    const t = await neuesTraktandum({ hoeckId: offen.id, titel: "Essen" }, id);

    const liste = await anfrage(team(), "GET", `${L(id)}/hoecks`);
    expect(liste.status).toBe(200);
    expect(liste.body.hoecks).toEqual([
      {
        id: offen.id,
        version: 1,
        datum: "2027-06-20",
        zeit: "19:00",
        titel: "Teamabend",
        ort: "Pfadiheim",
      },
    ]);
    // Keine Gäste, keine Art, keine Zahlen, keine Traktanden
    expect(liste.text).not.toContain("Gast Eins");
    expect(liste.text).not.toContain(intern.id);

    const einzeln = await anfrage(team(), "GET", `${L(id)}/hoecks/${offen.id}`);
    expect(einzeln.status).toBe(200);
    expect(Object.keys(einzeln.body).sort()).toEqual(
      ["datum", "id", "ort", "titel", "version", "zeit"].sort(),
    );
    expect(einzeln.text).not.toContain(t.id);
    expect(einzeln.text).not.toContain("Essen");

    // Der Höck der Lagerleitung gibt es für das Team nicht, wie einen unbekannten
    const fremd = await anfrage(team(), "GET", `${L(id)}/hoecks/${intern.id}`);
    expect(fremd.status).toBe(404);
    const unbekannt = await anfrage(
      team(),
      "GET",
      `${L(id)}/hoecks/${randomUUID()}`,
    );
    expect(unbekannt.status).toBe(404);
    expect(fremd.body).toEqual(unbekannt.body);
    // ... auch als Kalenderdatei
    expect(
      (await anfrage(team(), "GET", `${L(id)}/hoecks/${intern.id}.ics`)).status,
    ).toBe(404);
    expect(
      (await anfrage(team(), "GET", `${L(id)}/hoecks/${offen.id}.ics`)).status,
    ).toBe(200);
    // Traktanden und Modus bleiben dem Team verschlossen
    expect(
      (await anfrage(team(), "GET", `${L(id)}/hoecks/${offen.id}/modus`))
        .status,
    ).toBe(403);

    // Die Lagerleitung sieht beide
    const alle = await anfrage(leiter(), "GET", `${L(id)}/hoecks`);
    expect(alle.body.hoecks.map((h: { id: string }) => h.id)).toEqual([
      intern.id,
      offen.id,
    ]);
    expect(alle.body.hoecks[1]).toMatchObject({
      art: "team",
      gaeste: "Gast Eins",
      anzahlTraktanden: 1,
      anzahlAnwesende: 0,
    });
  });

  test("wird ein Höck zu «team», sieht das Team ihn ab sofort", async () => {
    const h = await neuerHoeck({ art: "lagerleitung" });
    expect((await anfrage(team(), "GET", `${L()}/hoecks/${h.id}`)).status).toBe(
      404,
    );
    await anfrage(leiter(), "PATCH", `${L()}/hoecks/${h.id}`, {
      version: h.version,
      art: "team",
    });
    expect((await anfrage(team(), "GET", `${L()}/hoecks/${h.id}`)).status).toBe(
      200,
    );
  });

  test("ohne hoecks.team_lesen sieht das Team nichts (403), mit hoecks.lesen_alle alles", async () => {
    const id = await neuesLager();
    const h = await neuerHoeck({ art: "lagerleitung", gaeste: "Gast" }, id);
    await setzeRecht(id, "team", "hoecks.team_lesen", false);
    expect((await anfrage(team(), "GET", `${L(id)}/hoecks`)).status).toBe(403);
    await setzeRecht(id, "team", "hoecks.lesen_alle", true);
    const a = await anfrage(team(), "GET", `${L(id)}/hoecks/${h.id}`);
    expect(a.status).toBe(200);
    expect(a.body.gaeste).toBe("Gast");
    expect(
      (await anfrage(team(), "GET", `${L(id)}/hoecks/${h.id}/modus`)).status,
    ).toBe(200);
    // Lesen heisst nicht schreiben
    expect(
      (
        await anfrage(team(), "PATCH", `${L(id)}/hoecks/${h.id}`, {
          version: 1,
          titel: "x",
        })
      ).status,
    ).toBe(403);
  });

  test("der Feed zeigt dem Team nur Team-Höcks, Traktanden gar nicht", async () => {
    const id = await neuesLager();
    const [vorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    const intern = await neuerHoeck({ art: "lagerleitung" }, id);
    const offen = await neuerHoeck({ art: "team" }, id);
    const t = await neuesTraktandum({ hoeckId: offen.id }, id);
    const feed = async (konto: PersonaKonto) =>
      (
        await anfrage(konto, "GET", `${L(id)}/aenderungen?seit=${vorher!.seq}`)
      ).body.eintraege.map((e: { id: string }) => e.id);
    expect(await feed(team())).toEqual([offen.id]);
    expect((await feed(leiter())).sort()).toEqual(
      [intern.id, offen.id, t.id].sort(),
    );
    const typen = await anfrage(team(), "GET", `${L(id)}/aenderungen`);
    expect(typen.body.objekttypen).toContain("hoeck");
    expect(typen.body.objekttypen).not.toContain("traktandum");
  });
});

describe("Höcks", () => {
  test("anlegen, lesen, ändern, löschen", async () => {
    const h = await neuerHoeck({
      titel: "  Planung  ",
      art: "lagerleitung",
      datum: "2027-06-15",
      zeit: "20:15",
      ort: "Pfarrhaus",
      gaeste: "Gast Eins, Gast Zwei",
    });
    expect(h).toMatchObject({
      version: 1,
      titel: "Planung",
      art: "lagerleitung",
      datum: "2027-06-15",
      zeit: "20:15",
      ort: "Pfarrhaus",
      gaeste: "Gast Eins, Gast Zwei",
      protokollId: null,
      anwesende: [],
      traktanden: [],
    });
    const gelesen = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`);
    expect(gelesen.body).toEqual(h);

    const geaendert = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/hoecks/${h.id}`,
      { version: 1, zeit: null, ort: null, titel: "Neu" },
    );
    expect(geaendert.status).toBe(200);
    expect(geaendert.body).toMatchObject({
      version: 2,
      zeit: null,
      ort: null,
      titel: "Neu",
      gaeste: "Gast Eins, Gast Zwei",
    });

    const weg = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/hoecks/${h.id}?version=2`,
    );
    expect(weg.status).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`)).status,
    ).toBe(404);
  });

  test("lehnt ungültige Eingaben ab", async () => {
    const post = (body: Record<string, unknown>) =>
      anfrage(leiter(), "POST", `${L()}/hoecks`, body);
    const gut = { titel: "x", art: "team", datum: "2027-06-15" };
    expect((await post({ ...gut, art: "alle" })).status).toBe(400);
    expect((await post({ ...gut, datum: "15.06.2027" })).status).toBe(400);
    expect((await post({ ...gut, datum: "2027-02-30" })).status).toBe(400);
    expect((await post({ ...gut, zeit: "24:00" })).status).toBe(400);
    expect((await post({ ...gut, zeit: "7:30" })).status).toBe(400);
    expect((await post({ ...gut, titel: "   " })).status).toBe(400);
    expect((await post({ ...gut, titel: "x".repeat(201) })).status).toBe(400);
    expect((await post({ ...gut, gaeste: "x".repeat(501) })).status).toBe(400);
    // Unbekannte Felder, auch die der Datenbank, die nur der Server oder #379 setzt
    expect((await post({ ...gut, protokollId: randomUUID() })).status).toBe(
      400,
    );
    expect((await post({ ...gut, version: 5 })).status).toBe(400);
    expect((await post({ ...gut, lagerId: randomUUID() })).status).toBe(400);
    expect((await post({ ...gut, anwesende: [] })).status).toBe(400);
    expect((await post(gut)).status).toBe(201);
    const h = await neuerHoeck();
    const patch = (body: Record<string, unknown>) =>
      anfrage(leiter(), "PATCH", `${L()}/hoecks/${h.id}`, body);
    expect((await patch({ version: 1 })).status).toBe(400);
    expect((await patch({ titel: "x" })).status).toBe(400);
    expect(
      (await patch({ version: 1, protokollId: randomUUID() })).status,
    ).toBe(400);
    expect((await patch({ version: 0, titel: "x" })).status).toBe(400);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks?limit=0`)).status,
    ).toBe(400);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks?extra=1`)).status,
    ).toBe(400);
  });

  test("ein Konflikt liefert den aktuellen Stand und die abweichenden Felder", async () => {
    const h = await neuerHoeck();
    await anfrage(leiter(), "PATCH", `${L()}/hoecks/${h.id}`, {
      version: 1,
      titel: "Von A",
    });
    const b = await anfrage(leiter(), "PATCH", `${L()}/hoecks/${h.id}`, {
      version: 1,
      titel: "Von B",
    });
    expect(b.status).toBe(409);
    expect(b.body.code).toBe("VERSION_KONFLIKT");
    expect(b.body.aktuell).toMatchObject({
      id: h.id,
      version: 2,
      titel: "Von A",
    });
    expect(b.body.abweichend).toEqual(["titel"]);
    // Löschen mit alter Version
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/hoecks/${h.id}?version=1`))
        .status,
    ).toBe(409);
  });

  test("ein Höck mit Traktanden lässt sich nicht löschen", async () => {
    const h = await neuerHoeck();
    const t = await neuesTraktandum({ hoeckId: h.id });
    const a = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/hoecks/${h.id}?version=1`,
    );
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("HOECK_HAT_TRAKTANDEN");
    // Auf den nächsten Höck geschoben, geht es
    const g = await anfrage(leiter(), "PATCH", `${L()}/traktanden/${t.id}`, {
      version: 1,
      hoeckId: null,
    });
    expect(g.status).toBe(200);
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/hoecks/${h.id}?version=1`))
        .status,
    ).toBe(204);
  });

  test("Liste: sortiert nach Datum, Filter und Seitenwechsel", async () => {
    const id = await neuesLager();
    const daten = ["2027-06-03", "2027-06-01", "2027-06-02", "2027-06-02"];
    const ids: string[] = [];
    for (const datum of daten) ids.push((await neuerHoeck({ datum }, id)).id);
    const alle = await anfrage(leiter(), "GET", `${L(id)}/hoecks`);
    expect(alle.body.hoecks.map((h: { datum: string }) => h.datum)).toEqual([
      "2027-06-01",
      "2027-06-02",
      "2027-06-02",
      "2027-06-03",
    ]);
    expect(alle.body.naechster).toBeNull();
    const gefiltert = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/hoecks?von=2027-06-02&bis=2027-06-02`,
    );
    expect(gefiltert.body.hoecks).toHaveLength(2);
    const gesehen: string[] = [];
    let nach: string | null = null;
    for (let i = 0; i < 5; i++) {
      const s: Antwort = await anfrage(
        leiter(),
        "GET",
        `${L(id)}/hoecks?limit=3${nach ? `&nach=${nach}` : ""}`,
      );
      gesehen.push(...s.body.hoecks.map((h: { id: string }) => h.id));
      nach = s.body.naechster;
      if (!nach) break;
    }
    expect(gesehen).toEqual(alle.body.hoecks.map((h: { id: string }) => h.id));
    expect(new Set(gesehen).size).toBe(4);
  });
});

describe("Traktanden", () => {
  test("anlegen mit allen Feldern, ohne Höck für den nächsten Höck", async () => {
    const h = await neuerHoeck();
    const v = await mitglied();
    const aufgabe = await db
      .insert(schema.aufgabe)
      .values({ lagerId, titel: "Aufgabe", lagerSeq: 0 })
      .returning({ id: schema.aufgabe.id });
    const t = await neuesTraktandum({
      hoeckId: h.id,
      titel: "Budget",
      text: "Notizen",
      links: [{ titel: "Tabelle", url: "https://Example.org/budget" }],
      verantwortlichePersonIds: [v],
      aufgabeId: aufgabe[0]!.id,
    });
    expect(t).toMatchObject({
      version: 1,
      hoeckId: h.id,
      titel: "Budget",
      text: "Notizen",
      entscheid: null,
      links: [{ titel: "Tabelle", url: "https://example.org/budget" }],
      reihenfolge: 0,
      aufgabeId: aufgabe[0]!.id,
      status: "offen",
      verantwortliche: [{ id: v, name: "Mitglied Test", ceviName: null }],
    });
    const zweites = await neuesTraktandum({ hoeckId: h.id });
    expect(zweites.reihenfolge).toBe(1);
    const warten = await neuesTraktandum({ titel: "Später" });
    expect(warten.hoeckId).toBeNull();
    const detail = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`);
    expect(detail.body.traktanden.map((x: { id: string }) => x.id)).toEqual([
      t.id,
      zweites.id,
    ]);
    const naechster = await anfrage(
      leiter(),
      "GET",
      `${L()}/traktanden/naechster`,
    );
    expect(
      naechster.body.traktanden.map((x: { id: string }) => x.id),
    ).toContain(warten.id);
    expect(naechster.text).not.toContain(t.id);
  });

  test("prüft Verantwortliche, Höck, Aufgabe und Links", async () => {
    const post = (body: Record<string, unknown>) =>
      anfrage(leiter(), "POST", `${L()}/traktanden`, { titel: "x", ...body });
    // Verantwortliche nur aus dem Lager
    const andere = await neuesLager();
    const fremdesMitglied = await mitglied(andere);
    const nein = await post({ verantwortlichePersonIds: [fremdesMitglied] });
    expect(nein.status).toBe(400);
    expect(nein.body.code).toBe("KEIN_MITGLIED");
    expect(
      (await post({ verantwortlichePersonIds: [randomUUID()] })).body.code,
    ).toBe("KEIN_MITGLIED");
    // Höck und Aufgabe aus einem anderen Lager gibt es nicht
    const fremderHoeck = await neuerHoeck({}, andere);
    expect((await post({ hoeckId: fremderHoeck.id })).body.code).toBe(
      "HOECK_UNBEKANNT",
    );
    const [fremdeAufgabe] = await db
      .insert(schema.aufgabe)
      .values({ lagerId: andere, titel: "Fremd", lagerSeq: 0 })
      .returning({ id: schema.aufgabe.id });
    expect((await post({ aufgabeId: fremdeAufgabe!.id })).body.code).toBe(
      "AUFGABE_UNBEKANNT",
    );
    // Ein gelöschter Höck zählt nicht
    const weg = await neuerHoeck();
    await anfrage(leiter(), "DELETE", `${L()}/hoecks/${weg.id}?version=1`);
    expect((await post({ hoeckId: weg.id })).body.code).toBe("HOECK_UNBEKANNT");
    // Links: nur https, keine Zugangsdaten, höchstens 10
    for (const url of [
      "http://example.org",
      "javascript:alert(1)",
      "https://user:pw@example.org",
      "//example.org",
      "data:text/html,x",
    ]) {
      expect((await post({ links: [{ titel: "x", url }] })).status).toBe(400);
    }
    expect(
      (
        await post({
          links: Array.from({ length: 11 }, () => ({
            titel: "x",
            url: "https://example.org",
          })),
        })
      ).status,
    ).toBe(400);
    // Unbekannte Felder und ungültige Werte
    expect((await post({ status: "erledigt" })).status).toBe(400);
    expect((await post({ entscheid: "" })).status).toBe(400);
    expect((await post({ text: "x".repeat(5001) })).status).toBe(400);
    expect((await post({ lagerSeq: 5 })).status).toBe(400);
    expect((await post({ reihenfolge: -1 })).status).toBe(400);
    expect(
      (await post({ verantwortlichePersonIds: [randomUUID(), "keine-id"] }))
        .status,
    ).toBe(400);
  });

  test("ändern: zuweisen, auf den nächsten Höck schieben, Entscheid, Verantwortliche ersetzen", async () => {
    const [a, b] = [await neuerHoeck(), await neuerHoeck()];
    const [v1, v2] = [await mitglied(), await mitglied()];
    const ersterInB = await neuesTraktandum({ hoeckId: b.id });
    const t = await neuesTraktandum({
      hoeckId: a.id,
      verantwortlichePersonIds: [v1],
    });
    // In einen anderen Höck: ans Ende dessen Liste
    const zuB = await anfrage(leiter(), "PATCH", `${L()}/traktanden/${t.id}`, {
      version: 1,
      hoeckId: b.id,
      verantwortlichePersonIds: [v2],
    });
    expect(zuB.status).toBe(200);
    expect(zuB.body).toMatchObject({
      version: 2,
      hoeckId: b.id,
      reihenfolge: ersterInB.reihenfolge + 1,
    });
    expect(zuB.body.verantwortliche.map((p: { id: string }) => p.id)).toEqual([
      v2,
    ]);
    // Entscheid und Status
    const e = await anfrage(leiter(), "PATCH", `${L()}/traktanden/${t.id}`, {
      version: 2,
      entscheid: "  Wir kaufen ein.  ",
      status: "besprochen",
    });
    expect(e.body).toMatchObject({
      version: 3,
      entscheid: "Wir kaufen ein.",
      status: "besprochen",
    });
    // Auf den nächsten Höck schieben
    const schieben = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/traktanden/${t.id}`,
      { version: 3, hoeckId: null, status: "offen" },
    );
    expect(schieben.body).toMatchObject({ hoeckId: null, status: "offen" });
    // Nur die Verantwortlichen ändern zählt die Version hoch
    const nurPersonen = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/traktanden/${t.id}`,
      { version: 4, verantwortlichePersonIds: [] },
    );
    expect(nurPersonen.body.version).toBe(5);
    expect(nurPersonen.body.verantwortliche).toEqual([]);
    // Konflikt
    const k = await anfrage(leiter(), "PATCH", `${L()}/traktanden/${t.id}`, {
      version: 4,
      titel: "Alt",
    });
    expect(k.status).toBe(409);
    expect(k.body.code).toBe("VERSION_KONFLIKT");
  });

  test("Reihenfolge: die Stelle ist die neue Reihenfolge, nur für die Liste eines Höcks", async () => {
    const h = await neuerHoeck();
    const [a, b, c] = [
      await neuesTraktandum({ hoeckId: h.id, titel: "a" }),
      await neuesTraktandum({ hoeckId: h.id, titel: "b" }),
      await neuesTraktandum({ hoeckId: h.id, titel: "c" }),
    ];
    const r = await anfrage(leiter(), "PUT", `${L()}/traktanden/reihenfolge`, {
      hoeckId: h.id,
      eintraege: [b, a, c].map((x) => ({ id: x.id, version: x.version })),
    });
    expect(r.status).toBe(204);
    const nachher = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`);
    expect(
      nachher.body.traktanden.map((x: { titel: string }) => x.titel),
    ).toEqual(["b", "a", "c"]);
    // c stand schon an der Stelle 2: keine neue Version
    expect(
      nachher.body.traktanden.find((x: { id: string }) => x.id === c.id)
        .version,
    ).toBe(1);
    // Ein Traktandum aus einer anderen Liste: alles oder nichts
    const warten = await neuesTraktandum({ titel: "warten" });
    const fremd = await anfrage(
      leiter(),
      "PUT",
      `${L()}/traktanden/reihenfolge`,
      {
        hoeckId: h.id,
        eintraege: [
          { id: b.id, version: 1 },
          { id: warten.id, version: 1 },
        ],
      },
    );
    expect(fremd.status).toBe(404);
    // Konflikt rollt alles zurück
    const k = await anfrage(leiter(), "PUT", `${L()}/traktanden/reihenfolge`, {
      hoeckId: h.id,
      eintraege: [
        { id: a.id, version: 99 },
        { id: b.id, version: 1 },
      ],
    });
    expect(k.status).toBe(409);
    expect(
      (
        await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`)
      ).body.traktanden.map((x: { titel: string }) => x.titel),
    ).toEqual(["b", "a", "c"]);
  });

  test("offene Punkte für den nächsten Höck übernehmen", async () => {
    const id = await neuesLager();
    const h = await neuerHoeck({}, id);
    const vorhanden = await neuesTraktandum({ hoeckId: h.id }, id);
    const [w1, w2, w3] = [
      await neuesTraktandum({ titel: "w1" }, id),
      await neuesTraktandum({ titel: "w2" }, id),
      await neuesTraktandum({ titel: "w3", status: "besprochen" }, id),
    ];
    // Nur ein Teil
    const teil = await anfrage(
      leiter(),
      "POST",
      `${L(id)}/hoecks/${h.id}/traktanden/uebernehmen`,
      { traktandumIds: [w2.id, vorhanden.id] },
    );
    expect(teil.body).toEqual({ uebernommen: 1 });
    // Der Rest der offenen: w1; w3 ist besprochen und bleibt
    const alle = await anfrage(
      leiter(),
      "POST",
      `${L(id)}/hoecks/${h.id}/traktanden/uebernehmen`,
      {},
    );
    expect(alle.body).toEqual({ uebernommen: 1 });
    const detail = await anfrage(leiter(), "GET", `${L(id)}/hoecks/${h.id}`);
    expect(detail.body.traktanden.map((x: { id: string }) => x.id)).toEqual([
      vorhanden.id,
      w2.id,
      w1.id,
    ]);
    expect(
      detail.body.traktanden.map((x: { reihenfolge: number }) => x.reihenfolge),
    ).toEqual([0, 1, 2]);
    const rest = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/traktanden/naechster`,
    );
    expect(rest.body.traktanden.map((x: { id: string }) => x.id)).toEqual([
      w3.id,
    ]);
    // Nichts mehr zu tun
    expect(
      (
        await anfrage(
          leiter(),
          "POST",
          `${L(id)}/hoecks/${h.id}/traktanden/uebernehmen`,
          {},
        )
      ).body,
    ).toEqual({ uebernommen: 0 });
    // Unbekannter Höck
    expect(
      (
        await anfrage(
          leiter(),
          "POST",
          `${L(id)}/hoecks/${randomUUID()}/traktanden/uebernehmen`,
          {},
        )
      ).status,
    ).toBe(404);
  });

  test("löschen geht über den Sync-Kern und erscheint im Feed", async () => {
    const t = await neuesTraktandum();
    const [vorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    const d = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/traktanden/${t.id}?version=1`,
    );
    expect(d.status).toBe(204);
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L()}/aenderungen?seit=${vorher!.seq}`,
    );
    expect(feed.body.eintraege).toEqual([
      expect.objectContaining({
        objekttyp: "traktandum",
        id: t.id,
        art: "geloescht",
      }),
    ]);
    // Die Zeile ist endgültig weg (#427)
    expect(
      await db.$count(schema.traktandum, eq(schema.traktandum.id, t.id)),
    ).toBe(0);
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/traktanden/${t.id}?version=2`))
        .status,
    ).toBe(404);
  });
});

describe("Anwesenheit", () => {
  test("abhaken, wieder entfernen, wiederholt ist dasselbe", async () => {
    const h = await neuerHoeck();
    const p = await mitglied();
    const url = `${L()}/hoecks/${h.id}/anwesende/${p}`;
    expect((await anfrage(leiter(), "PUT", url)).status).toBe(204);
    expect((await anfrage(leiter(), "PUT", url)).status).toBe(204);
    const gelesen = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`);
    expect(gelesen.body.anwesende).toEqual([
      { id: p, name: "Mitglied Test", ceviName: null, bildUrl: null },
    ]);
    const liste = await anfrage(leiter(), "GET", `${L()}/hoecks`);
    expect(
      liste.body.hoecks.find((x: { id: string }) => x.id === h.id)
        .anzahlAnwesende,
    ).toBe(1);
    expect((await anfrage(leiter(), "DELETE", url)).status).toBe(204);
    expect((await anfrage(leiter(), "DELETE", url)).status).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`)).body.anwesende,
    ).toEqual([]);
  });

  test("nur Mitglieder des Lagers, nur in diesem Lager", async () => {
    const h = await neuerHoeck();
    const nichtMitglied = await db
      .insert(schema.user)
      .values({
        name: "Ohne",
        email: `${randomUUID()}@example.org`,
        username: `o.${randomUUID().slice(0, 8)}`,
        abteilungId: welt.testabteilungId,
        mussPasswortAendern: false,
      })
      .returning({ id: schema.user.id });
    const a = await anfrage(
      leiter(),
      "PUT",
      `${L()}/hoecks/${h.id}/anwesende/${nichtMitglied[0]!.id}`,
    );
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("KEIN_MITGLIED");
    // Ein unbekannter Höck
    expect(
      (
        await anfrage(
          leiter(),
          "PUT",
          `${L()}/hoecks/${randomUUID()}/anwesende/${konten.team.id}`,
        )
      ).status,
    ).toBe(404);
    // Wer als Mitglied entfernt wird, ist auch nicht mehr anwesend
    const p = await mitglied();
    await anfrage(leiter(), "PUT", `${L()}/hoecks/${h.id}/anwesende/${p}`);
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, p),
        ),
      );
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`)).body.anwesende,
    ).toEqual([]);
  });
});

describe("Höck-Modus", () => {
  test("liefert Höck, Traktanden, Mitglieder mit Haken und die Ressort-Runde", async () => {
    const id = await neuesLager();
    const person = await mitglied(id);
    const h = await neuerHoeck({ gaeste: "Gast" }, id);
    const t1 = await neuesTraktandum({ hoeckId: h.id, titel: "Eins" }, id);
    await neuesTraktandum({ hoeckId: h.id, titel: "Zwei" }, id);
    await anfrage(
      leiter(),
      "PUT",
      `${L(id)}/hoecks/${h.id}/anwesende/${person}`,
    );
    const [ressortA, ressortB] = await db
      .insert(schema.ressort)
      .values([
        {
          lagerId: id,
          kuerzel: "KU",
          name: "Küche",
          leitungPersonId: person,
          reihenfolge: 0,
          lagerSeq: 0,
        },
        {
          lagerId: id,
          kuerzel: "PR",
          name: "Programm",
          reihenfolge: 1,
          lagerSeq: 0,
        },
      ])
      .returning({ id: schema.ressort.id });
    const gestern = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const morgen = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db.insert(schema.aufgabe).values([
      {
        lagerId: id,
        ressortId: ressortA!.id,
        titel: "a",
        status: "offen",
        frist: gestern,
        lagerSeq: 0,
      },
      {
        lagerId: id,
        ressortId: ressortA!.id,
        titel: "b",
        status: "laeuft",
        frist: morgen,
        lagerSeq: 0,
      },
      {
        lagerId: id,
        ressortId: ressortA!.id,
        titel: "c",
        status: "erledigt",
        erledigtAm: new Date(),
        frist: gestern,
        lagerSeq: 0,
      },
    ]);
    void ressortB;

    const m = await anfrage(leiter(), "GET", `${L(id)}/hoecks/${h.id}/modus`);
    expect(m.status).toBe(200);
    expect(m.body.hoeck).toMatchObject({ id: h.id, gaeste: "Gast" });
    expect(
      m.body.hoeck.traktanden.map((x: { titel: string }) => x.titel),
    ).toEqual(["Eins", "Zwei"]);
    expect(m.body.hoeck.traktanden[0].id).toBe(t1.id);
    expect(m.body.hoeck).not.toHaveProperty("anwesende");
    const mitglieder = m.body.mitglieder as {
      id: string;
      rolle: string;
      anwesend: boolean;
    }[];
    expect(mitglieder.find((x) => x.id === person)).toMatchObject({
      rolle: "team",
      anwesend: true,
    });
    expect(mitglieder.filter((x) => x.anwesend)).toHaveLength(1);
    // Alle vier Rollen des Lagers und die zusätzliche Person
    expect(mitglieder).toHaveLength(6);
    expect(m.body.ressortRunde).toEqual([
      {
        id: ressortA!.id,
        kuerzel: "KU",
        name: "Küche",
        leitung: {
          id: person,
          name: "Mitglied Test",
          ceviName: null,
          bildUrl: null,
        },
        aufgaben: { gesamt: 3, erledigt: 1, offen: 2, ueberfaellig: 1 },
        // Nur die offenen, nach Frist: «a» (gestern) vor «b» (morgen); die Leitung des Ressorts ist die wirksame Verantwortliche
        offeneAufgaben: [
          {
            id: expect.any(String),
            titel: "a",
            status: "offen",
            verantwortlich: {
              id: person,
              name: expect.any(String),
              bildUrl: null,
            },
          },
          {
            id: expect.any(String),
            titel: "b",
            status: "laeuft",
            verantwortlich: {
              id: person,
              name: expect.any(String),
              bildUrl: null,
            },
          },
        ],
      },
      {
        id: ressortB!.id,
        kuerzel: "PR",
        name: "Programm",
        leitung: null,
        aufgaben: { gesamt: 0, erledigt: 0, offen: 0, ueberfaellig: 0 },
        offeneAufgaben: [],
      },
    ]);
  });

  test("nach Rolle gefiltert: ohne Ressort-Recht keine Runde, ohne Aufgaben-Recht keine Zahlen", async () => {
    const id = await neuesLager();
    const h = await neuerHoeck({}, id);
    await db
      .insert(schema.ressort)
      .values({ lagerId: id, kuerzel: "KU", name: "Küche", lagerSeq: 0 });
    const modus = (konto: PersonaKonto) =>
      anfrage(konto, "GET", `${L(id)}/hoecks/${h.id}/modus`);
    expect((await modus(konten.lesen)).body.ressortRunde).toHaveLength(1);
    await setzeRecht(id, "lesen", "aufgaben.lesen_alle", false);
    const ohneAufgaben = await modus(konten.lesen);
    expect(ohneAufgaben.body.ressortRunde).toEqual([
      expect.objectContaining({
        kuerzel: "KU",
        aufgaben: null,
        offeneAufgaben: null,
      }),
    ]);
    await setzeRecht(id, "lesen", "ressorts.lesen", false);
    expect((await modus(konten.lesen)).body.ressortRunde).toBeNull();
    // Die Lagerleitung bleibt unberührt
    expect(
      (await modus(leiter())).body.ressortRunde[0].aufgaben,
    ).not.toBeNull();
  });

  test("ein unbekannter oder gelöschter Höck ist 404", async () => {
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${randomUUID()}/modus`))
        .status,
    ).toBe(404);
    const h = await neuerHoeck();
    await anfrage(leiter(), "DELETE", `${L()}/hoecks/${h.id}?version=1`);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}/modus`)).status,
    ).toBe(404);
  });
});

describe("Entscheide-Sammlung", () => {
  test("listet Traktanden mit Entscheid, neueste Höcks zuerst, mit Seitenwechsel", async () => {
    const id = await neuesLager();
    const alt = await neuerHoeck({ datum: "2027-05-01", titel: "Alt" }, id);
    const neu = await neuerHoeck({ datum: "2027-06-01", titel: "Neu" }, id);
    const mit = (hoeckId: string, titel: string) =>
      neuesTraktandum({ hoeckId, titel, entscheid: `Entscheid ${titel}` }, id);
    const [a1, a2, n1] = [
      await mit(alt.id, "A1"),
      await mit(alt.id, "A2"),
      await mit(neu.id, "N1"),
    ];
    await neuesTraktandum({ hoeckId: neu.id, titel: "ohne" }, id);
    // Ohne Höck, mit Entscheid: gehört nicht in die Sammlung
    await neuesTraktandum({ titel: "lose", entscheid: "lose" }, id);
    const s = await anfrage(leiter(), "GET", `${L(id)}/entscheide`);
    expect(s.status).toBe(200);
    expect(s.body.entscheide.map((e: { id: string }) => e.id)).toEqual([
      n1.id,
      a2.id,
      a1.id,
    ]);
    expect(s.body.entscheide[0]).toEqual({
      id: n1.id,
      titel: "N1",
      entscheid: "Entscheid N1",
      aufgabeId: null,
      hoeck: { id: neu.id, datum: "2027-06-01", titel: "Neu" },
    });
    const erste = await anfrage(leiter(), "GET", `${L(id)}/entscheide?limit=2`);
    expect(erste.body.entscheide).toHaveLength(2);
    expect(erste.body.naechster).toBe(a2.id);
    const zweite = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/entscheide?limit=2&nach=${erste.body.naechster}`,
    );
    expect(zweite.body.entscheide.map((e: { id: string }) => e.id)).toEqual([
      a1.id,
    ]);
    expect(zweite.body.naechster).toBeNull();
    // Gelöschte Traktanden fehlen
    await anfrage(leiter(), "DELETE", `${L(id)}/traktanden/${n1.id}?version=1`);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/entscheide`)).body.entscheide,
    ).toHaveLength(2);
  });
});

describe("Kalenderdatei", () => {
  test("liefert text/calendar, ical.js liest sie zurück, Kopfzeilen und ETag", async () => {
    const h = await neuerHoeck({
      titel: "Planung; Budget, Menüs",
      datum: "2027-06-15",
      zeit: "19:30",
      ort: "Pfarrhaus, Stäfa",
      gaeste: "Gast Eins",
    });
    await neuesTraktandum({ hoeckId: h.id, titel: "Geheimes Traktandum" });
    const p = await mitglied();
    await anfrage(leiter(), "PUT", `${L()}/hoecks/${h.id}/anwesende/${p}`);
    const a = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}.ics`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(a.headers.get("cache-control")).toBe("private, no-cache");
    expect(a.headers.get("content-disposition")).toBe(
      'attachment; filename="hoeck-2027-06-15.ics"',
    );
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = a.headers.get("etag")!;
    expect(etag).toBe(`"${h.id}-1"`);
    const vevent = new ICAL.Component(ICAL.parse(a.text)).getFirstSubcomponent(
      "vevent",
    )!;
    const termin = new ICAL.Event(vevent);
    expect(termin.summary).toBe("Planung; Budget, Menüs");
    expect(termin.location).toBe("Pfarrhaus, Stäfa");
    expect(termin.startDate.toString()).toBe("2027-06-15T19:30:00");
    expect(termin.uid).toBe(`${h.id}@cevi-os`);
    // Keine Personendaten: weder Gäste noch Anwesende noch Traktanden
    for (const geheim of [
      "Gast Eins",
      "Geheimes Traktandum",
      "Mitglied Test",
      p,
    ]) {
      expect(a.text).not.toContain(geheim);
    }
    // Gleicher ETag: 304 ohne Inhalt, mit denselben Cache-Kopfzeilen
    const nochmal = await anfrage(
      leiter(),
      "GET",
      `${L()}/hoecks/${h.id}.ics`,
      undefined,
      { "If-None-Match": etag },
    );
    expect(nochmal.status).toBe(304);
    expect(nochmal.text).toBe("");
    expect(nochmal.headers.get("etag")).toBe(etag);
    expect(nochmal.headers.get("cache-control")).toBe("private, no-cache");
    // Nach einer Änderung neuer ETag und höhere Folgenummer
    await anfrage(leiter(), "PATCH", `${L()}/hoecks/${h.id}`, {
      version: 1,
      zeit: null,
    });
    const neu = await anfrage(
      leiter(),
      "GET",
      `${L()}/hoecks/${h.id}.ics`,
      undefined,
      { "If-None-Match": etag },
    );
    expect(neu.status).toBe(200);
    expect(neu.headers.get("etag")).toBe(`"${h.id}-2"`);
    expect(neu.text).toContain("DTSTART;VALUE=DATE:20270615");
    expect(neu.text).toContain("SEQUENCE:1");
  });

  test("ungültige ID: 400, unbekannt oder gelöscht: 404, ohne Anmeldung: 401", async () => {
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/abc.ics`)).status,
    ).toBe(400);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${randomUUID()}.ics`))
        .status,
    ).toBe(404);
    const h = await neuerHoeck();
    await anfrage(leiter(), "DELETE", `${L()}/hoecks/${h.id}?version=1`);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}.ics`)).status,
    ).toBe(404);
    expect(
      (await anfrage(konten.ohneLogin, "GET", `${L()}/hoecks/${h.id}.ics`))
        .status,
    ).toBe(401);
    // Ein Höck aus einem anderen Lager
    const h2 = await neuerHoeck();
    expect(
      (await anfrage(leiter(), "GET", `${L(fremdLagerId)}/hoecks/${h2.id}.ics`))
        .status,
    ).toBe(404);
    // Im abgeschlossenen Lager darf man die Datei laden (lesend)
    const [zu] = await db
      .insert(schema.hoeck)
      .values({
        lagerId: geschlossenId,
        art: "team",
        datum: "2027-01-01",
        titel: "Alt",
        lagerSeq: 0,
      })
      .returning({ id: schema.hoeck.id });
    expect(
      (await anfrage(team(), "GET", `${L(geschlossenId)}/hoecks/${zu!.id}.ics`))
        .status,
    ).toBe(200);
  });
});

describe("Mitglied entfernt", () => {
  test("der Höck bleibt, Anwesenheit und Verantwortliche gehen mit dem Mitglied", async () => {
    const p = await mitglied();
    const h = await neuerHoeck();
    const t = await neuesTraktandum({
      hoeckId: h.id,
      verantwortlichePersonIds: [p],
    });
    await anfrage(leiter(), "PUT", `${L()}/hoecks/${h.id}/anwesende/${p}`);
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, p),
        ),
      );
    const d = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`);
    expect(d.body.anwesende).toEqual([]);
    expect(d.body.traktanden[0].id).toBe(t.id);
    expect(d.body.traktanden[0].verantwortliche).toEqual([]);
  });
});

describe("Datenbanklast", () => {
  test("Höck mit Traktanden: zwei Abfragen für die Daten, unabhängig von der Zahl der Traktanden", async () => {
    const id = await neuesLager();
    const personen = [await mitglied(id), await mitglied(id)];
    const h = await neuerHoeck({}, id);
    await neuesTraktandum(
      { hoeckId: h.id, verantwortlichePersonIds: personen, links: [] },
      id,
    );
    for (const p of personen) {
      await anfrage(leiter(), "PUT", `${L(id)}/hoecks/${h.id}/anwesende/${p}`);
    }
    const messe = async (pfad: string) => {
      const vorher = abfragen;
      const r = await anfrage(leiter(), "GET", `${L(id)}${pfad}`);
      expect(r.status).toBe(200);
      return { n: abfragen - vorher, r };
    };
    const wenige = await messe(`/hoecks/${h.id}`);
    const wenigeModus = await messe(`/hoecks/${h.id}/modus`);
    const wenigeListe = await messe("/hoecks");
    for (let i = 0; i < 30; i++) {
      await neuesTraktandum(
        { hoeckId: h.id, verantwortlichePersonIds: personen, entscheid: "e" },
        id,
      );
    }
    for (let i = 0; i < 10; i++) await neuerHoeck({}, id);
    const viele = await messe(`/hoecks/${h.id}`);
    const vieleModus = await messe(`/hoecks/${h.id}/modus`);
    const vieleListe = await messe("/hoecks");
    expect(wenige.r.body.traktanden).toHaveLength(1);
    expect(viele.r.body.traktanden).toHaveLength(31);
    expect(vieleModus.r.body.hoeck.traktanden).toHaveLength(31);
    expect(vieleListe.r.body.hoecks).toHaveLength(11);
    expect(viele.n).toBe(wenige.n);
    expect(vieleModus.n).toBe(wenigeModus.n);
    expect(vieleListe.n).toBe(wenigeListe.n);
    // Policy (Sitzung, Konto, Lager mit Mitgliedschaft, Rechte) plus 2 für Höck und Traktanden beziehungsweise 4 für den Modus beziehungsweise 1 für die Liste
    const policy = wenigeListe.n - 1;
    expect(wenige.n).toBe(policy + 2);
    expect(wenigeModus.n).toBe(policy + 4);
  });

  test("Entscheide und wartende Punkte: eine Abfrage", async () => {
    const id = await neuesLager();
    const messe = async (pfad: string) => {
      const vorher = abfragen;
      await anfrage(leiter(), "GET", `${L(id)}${pfad}`);
      return abfragen - vorher;
    };
    const hoecks = await messe("/hoecks");
    expect(await messe("/entscheide")).toBe(hoecks);
    expect(await messe("/traktanden/naechster")).toBe(hoecks);
  });
});

describe("Höck-Modus: offene Aufgaben je Ressort (#520)", () => {
  test("höchstens 50 je Ressort, nur offene, nur dieses Lager, in einer Abfrage unabhängig von der Zahl der Ressorts", async () => {
    const id = await neuesLager();
    const anderes = await neuesLager();
    const h = await neuerHoeck({}, id);
    const [a, b] = await db
      .insert(schema.ressort)
      .values([
        { lagerId: id, kuerzel: "A", name: "A", reihenfolge: 0, lagerSeq: 0 },
        { lagerId: id, kuerzel: "B", name: "B", reihenfolge: 1, lagerSeq: 0 },
      ])
      .returning({ id: schema.ressort.id });
    await db.insert(schema.aufgabe).values([
      ...Array.from({ length: 55 }, (_, i) => ({
        lagerId: id,
        ressortId: a!.id,
        titel: `offen ${String(i).padStart(2, "0")}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
      {
        lagerId: id,
        ressortId: a!.id,
        titel: "fertig",
        status: "erledigt" as const,
        erledigtAm: new Date(),
        lagerSeq: 0,
      },
      { lagerId: id, ressortId: b!.id, titel: "b1", lagerSeq: 0 },
    ]);
    const modus = async () =>
      anfrage(leiter(), "GET", `${L(id)}/hoecks/${h.id}/modus`);
    const m = await modus();
    const [ra, rb] = m.body.ressortRunde;
    expect(ra.offeneAufgaben).toHaveLength(50);
    expect(ra.offeneAufgaben[0].titel).toBe("offen 00");
    expect(
      ra.offeneAufgaben.map((x: { titel: string }) => x.titel),
    ).not.toContain("fertig");
    // Die Zahl aller offenen steht weiter bei den Zahlen: Die App erkennt die Kürzung
    expect(ra.aufgaben.offen).toBe(55);
    expect(rb.offeneAufgaben).toEqual([
      {
        id: expect.any(String),
        titel: "b1",
        status: "offen",
        verantwortlich: null,
      },
    ]);
    // Aufgaben eines anderen Lagers kommen nie vor
    await db
      .insert(schema.aufgabe)
      .values({ lagerId: anderes, titel: "fremd", lagerSeq: 0 });
    expect(JSON.stringify((await modus()).body)).not.toContain("fremd");
    // Abfragen: unabhängig von der Zahl der Ressorts und Aufgaben
    await modus();
    const vorher = abfragen;
    await modus();
    const n = abfragen - vorher;
    await db.insert(schema.ressort).values(
      Array.from({ length: 5 }, (_, i) => ({
        lagerId: id,
        kuerzel: `Z${i}`,
        name: `Z${i}`,
        reihenfolge: 5 + i,
        lagerSeq: 0,
      })),
    );
    const vorher2 = abfragen;
    const m2 = await modus();
    expect(m2.body.ressortRunde).toHaveLength(7);
    expect(abfragen - vorher2).toBe(n);
  });

  test("wer nur eigene Aufgaben lesen darf, sieht nur die eigenen, ohne Aufgaben-Recht gibt es null", async () => {
    const id = await neuesLager();
    const h = await neuerHoeck({}, id);
    const [r] = await db
      .insert(schema.ressort)
      .values({ lagerId: id, kuerzel: "K", name: "K", lagerSeq: 0 })
      .returning({ id: schema.ressort.id });
    await db.insert(schema.aufgabe).values([
      {
        lagerId: id,
        ressortId: r!.id,
        titel: "meine",
        verantwortlichPersonId: konten.leitung.id!,
        lagerSeq: 0,
      },
      { lagerId: id, ressortId: r!.id, titel: "andere", lagerSeq: 0 },
    ]);
    const lies = async (konto: PersonaKonto) =>
      (await anfrage(konto, "GET", `${L(id)}/hoecks/${h.id}/modus`)).body
        .ressortRunde[0];
    expect((await lies(konten.leitung)).offeneAufgaben).toHaveLength(2);
    await setzeRecht(id, "leitung", "aufgaben.lesen_alle", false);
    await setzeRecht(id, "leitung", "aufgaben.bearbeiten", false);
    const eigene = await lies(konten.leitung);
    expect(eigene.aufgaben).toBeNull();
    expect(
      eigene.offeneAufgaben.map((x: { titel: string }) => x.titel),
    ).toEqual(["meine"]);
    expect(eigene.offeneAufgaben[0].verantwortlich.id).toBe(konten.leitung.id);
    await setzeRecht(id, "leitung", "aufgaben.eigene", false);
    expect((await lies(konten.leitung)).offeneAufgaben).toBeNull();
  });
});

describe("Dauer je Traktandum (#520)", () => {
  test("optional, 1 bis 600 Minuten, null löscht sie", async () => {
    const t = await neuesTraktandum();
    expect(t.dauerMinuten).toBeNull();
    const mit = await neuesTraktandum({ dauerMinuten: 15 });
    expect(mit.dauerMinuten).toBe(15);
    const a = await anfrage(leiter(), "PATCH", `${L()}/traktanden/${t.id}`, {
      version: t.version,
      dauerMinuten: 600,
    });
    expect(a.status).toBe(200);
    expect(a.body.dauerMinuten).toBe(600);
    const b = await anfrage(leiter(), "PATCH", `${L()}/traktanden/${t.id}`, {
      version: a.body.version,
      dauerMinuten: null,
    });
    expect(b.body.dauerMinuten).toBeNull();
    for (const wert of [0, -1, 601, 1.5, "10"]) {
      const c = await anfrage(leiter(), "POST", `${L()}/traktanden`, {
        titel: "x",
        dauerMinuten: wert,
      });
      expect([wert, c.status]).toEqual([wert, 400]);
    }
  });

  test("die Dauer steht im Höck, im Modus und im Feed-Eintrag der Zeile", async () => {
    const h = await neuerHoeck();
    const t = await neuesTraktandum({ hoeckId: h.id, dauerMinuten: 5 });
    const d = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}`);
    expect(d.body.traktanden[0].dauerMinuten).toBe(5);
    const m = await anfrage(leiter(), "GET", `${L()}/hoecks/${h.id}/modus`);
    expect(m.body.hoeck.traktanden[0]).toMatchObject({
      id: t.id,
      dauerMinuten: 5,
    });
    // Die Datenbank hält die Grenze auch ohne die Route
    await expect(
      db
        .update(schema.traktandum)
        .set({ dauerMinuten: 0 })
        .where(eq(schema.traktandum.id, t.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
