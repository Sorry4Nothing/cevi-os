import { and, eq } from "drizzle-orm";
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
const sql = postgres(API_URL, { debug: () => abfragen++ });
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

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Fahrtenlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

async function mitgliederEintragen(id: string) {
  // Die falsche Zeile der fremden Abteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: konten[persona].id!,
      rolle,
    });
  }
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
  lagerId = await legeLager(welt.testabteilungId);
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  for (const id of [lagerId, geschlossenId]) await mitgliederEintragen(id);
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
const leiter = () => konten.lagerleitung;
// Jeder Test arbeitet in einem frischen Lager, damit Zähler und Listen nicht von anderen Tests abhängen
async function frischesLager() {
  const id = await legeLager(welt.testabteilungId);
  await mitgliederEintragen(id);
  return id;
}
async function neueFahrt(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, {
    richtung: "hin",
    art: "oev",
    name: "Gruppe",
    ...werte,
  });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  return a.body as { id: string; version: number; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const auto = (werte: Record<string, unknown> = {}, id = lagerId) =>
  neueFahrt({ art: "auto", name: "Auto", plaetze: 4, ...werte }, id);
async function mitfahrt(
  fahrtId: string,
  wer: Record<string, unknown>,
  id = lagerId,
  konto = leiter(),
) {
  return anfrage(konto, "POST", `${L(id)}/fahrten/${fahrtId}/mitfahrer`, wer);
}
async function kind(
  id = lagerId,
  vorname = "Kind",
  stufe: string | null = "Wolf",
) {
  const [z] = await db
    .insert(schema.teilnehmer)
    .values({ lagerId: id, vorname, nachname: "Muster", stufe, lagerSeq: 0 })
    .returning({ id: schema.teilnehmer.id });
  return z!.id;
}
const nameVon = async (id: string | null) =>
  (
    await db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, id!))
  )[0]!.name;
const liste = async (konto: PersonaKonto, id = lagerId, abfrage = "") =>
  (await anfrage(konto, "GET", `${L(id)}/fahrten${abfrage}`)).body.fahrten as {
    id: string;
    mitfahrer: { name: string }[];
  }[];

describe("Rechte je Lager-Persona", () => {
  // Lesen: jede Rolle mit einteilung.lesen. Schreiben: Lagerleitung, Abteilungsleitung und Leitung
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
  const schreiben = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: erfolg,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });

  test.each(LAGER_PERSONAS)("%s: Liste lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", `${L()}/fahrten`)).status).toBe(
      lesen[p],
    );
  });

  test.each(LAGER_PERSONAS)(
    "%s: «Personen ohne Fahrt» (das Team nur mit eigener Sicht gesperrt)",
    async (p) => {
      const a = await anfrage(
        konten[p],
        "GET",
        `${L()}/fahrten/ohne?richtung=hin`,
      );
      expect(a.status).toBe(p === "team" ? 403 : lesen[p]);
    },
  );

  test.each(LAGER_PERSONAS)("%s: anlegen, ändern, löschen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/fahrten`, {
      richtung: "rueck",
      art: "oev",
      name: `Rolle ${p}`,
    });
    expect(a.status).toBe(schreiben(201)[p]);
    const f = await neueFahrt({ richtung: "rueck" });
    const g = await anfrage(konten[p], "GET", `${L()}/fahrten/${f.id}`);
    // Das Team sieht eine fremde Fahrt nicht
    expect(g.status).toBe(p === "team" ? 404 : lesen[p]);
    const c = await anfrage(konten[p], "PATCH", `${L()}/fahrten/${f.id}`, {
      version: f.version,
      name: "Neu",
    });
    expect(c.status).toBe(schreiben(200)[p]);
    const bleibt = c.status === 200 ? f.version + 1 : f.version;
    const d = await anfrage(
      konten[p],
      "DELETE",
      `${L()}/fahrten/${f.id}?version=${bleibt}`,
    );
    expect(d.status).toBe(schreiben(204)[p]);
  });

  test.each(LAGER_PERSONAS)(
    "%s: Mitfahrt hinzufügen und entfernen",
    async (p) => {
      const f = await neueFahrt({ richtung: "rueck" });
      const t = await kind();
      const a = await mitfahrt(f.id, { teilnehmerId: t }, lagerId, konten[p]);
      expect(a.status).toBe(schreiben(201)[p]);
      const mid =
        a.status === 201
          ? a.body.id
          : (await mitfahrt(f.id, { teilnehmerId: t })).body.id;
      const d = await anfrage(
        konten[p],
        "DELETE",
        `${L()}/fahrten/${f.id}/mitfahrer/${mid}?version=1`,
      );
      expect(d.status).toBe(schreiben(204)[p]);
      // Aufräumen für die nächste Persona: der Teilnehmende sitzt nur in dieser Fahrt
      await db.delete(schema.fahrt).where(and(eq(schema.fahrt.id, f.id)));
    },
  );

  test("geschlossenes Lager: nichts schreiben, lesen geht", async () => {
    const [f] = await db
      .insert(schema.fahrt)
      .values({
        lagerId: geschlossenId,
        richtung: "hin",
        art: "oev",
        lagerSeq: 0,
      })
      .returning({ id: schema.fahrt.id });
    expect(
      (await anfrage(leiter(), "GET", `${L(geschlossenId)}/fahrten`)).status,
    ).toBe(200);
    const stand = [
      ["POST", `/fahrten`, { richtung: "hin", art: "oev" }],
      ["PATCH", `/fahrten/${f!.id}`, { version: 1, name: "X" }],
      ["DELETE", `/fahrten/${f!.id}?version=1`, undefined],
      ["POST", `/fahrten/${f!.id}/mitfahrer`, { personId: konten.team.id }],
    ] as const;
    for (const [methode, pfad, body] of stand) {
      const a = await anfrage(
        leiter(),
        methode,
        `${L(geschlossenId)}${pfad}`,
        body as Record<string, unknown> | undefined,
      );
      expect(a.status, `${methode} ${pfad}`).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
  });

  test("fremdes Lager: Fahrten sind unbekannt, auch über ein anderes Lager der Abteilung", async () => {
    const f = await neueFahrt();
    const anderes = await frischesLager();
    for (const [methode, pfad, body] of [
      ["GET", `/fahrten/${f.id}`, undefined],
      ["PATCH", `/fahrten/${f.id}`, { version: 1, name: "X" }],
      ["DELETE", `/fahrten/${f.id}?version=1`, undefined],
      ["POST", `/fahrten/${f.id}/mitfahrer`, { personId: konten.team.id }],
    ] as const) {
      const a = await anfrage(
        leiter(),
        methode,
        `${L(anderes)}${pfad}`,
        body as Record<string, unknown> | undefined,
      );
      expect(a.status, `${methode} ${pfad}`).toBe(404);
    }
    // Ein Lager einer anderen Abteilung: auch für deren Lagerleitung bleibt die Fahrt dieses Lagers unbekannt
    await db.insert(schema.lagerMitglied).values({
      lagerId: fremdLagerId,
      personId: konten.fremdeAbteilung.id!,
      rolle: "lagerleitung",
    });
    expect(
      (await anfrage(konten.fremdeAbteilung, "GET", `${L()}/fahrten/${f.id}`))
        .status,
    ).toBe(404);
  });
});

describe("Fahrt anlegen und die Regeln über mehrere Felder", () => {
  test("Auto mit Fahrer, Plätzen, Datum, Zeit und Treffpunkt; ÖV-Gruppe mit Fahrplan-Link", async () => {
    const id = await frischesLager();
    const a = await auto(
      {
        fahrerPersonId: konten.leitung.id,
        datum: "2027-07-10",
        zeit: "07:30",
        von: "Stäfa",
        nach: "Lagerhaus",
        treffpunkt: "  Bahnhof   Haupteingang ",
      },
      id,
    );
    expect(a).toMatchObject({
      richtung: "hin",
      art: "auto",
      plaetze: 4,
      datum: "2027-07-10",
      zeit: "07:30",
      treffpunkt: "Bahnhof Haupteingang",
      fahrerPersonId: konten.leitung.id,
      fahrer: { personId: konten.leitung.id },
      mitfahrer: [],
      belegt: 0,
      frei: 4,
      ueberbelegt: false,
      link: null,
      zielBezeichnung: null,
    });
    const o = await neueFahrt(
      {
        richtung: "rueck",
        von: "Lagerhaus",
        nach: "Stäfa",
        link: "HTTPS://Fahrplan.Example.ch/verbindung?von=A&nach=B",
      },
      id,
    );
    expect(o).toMatchObject({
      art: "oev",
      plaetze: null,
      frei: null,
      fahrer: null,
      link: "https://fahrplan.example.ch/verbindung?von=A&nach=B",
    });
  });

  test("ungültige Eingaben und Regeln über mehrere Felder: 400, nichts geschrieben", async () => {
    const id = await frischesLager();
    const faelle: [Record<string, unknown>, string | undefined][] = [
      [{ richtung: "hin", art: "auto" }, "PLAETZE_FEHLEN"],
      [{ richtung: "hin", art: "oev", plaetze: 3 }, "NUR_FUER_AUTO"],
      [
        { richtung: "hin", art: "oev", fahrerPersonId: konten.team.id },
        "NUR_FUER_AUTO",
      ],
      [
        {
          richtung: "hin",
          art: "auto",
          plaetze: 3,
          link: "https://fahrplan.example.ch/x",
        },
        "LINK_NUR_FUER_OEV",
      ],
      // Strikte Schemas: unbekannte Felder, Gesundheitsangaben, falsche Werte
      [{ richtung: "hin", art: "oev", gesundheit: "Allergie" }, undefined],
      [{ richtung: "quer", art: "oev" }, undefined],
      [{ richtung: "hin", art: "zug" }, undefined],
      [{ richtung: "hin", art: "auto", plaetze: 0 }, undefined],
      [{ richtung: "hin", art: "auto", plaetze: 100 }, undefined],
      [{ richtung: "hin", art: "auto", plaetze: 2.5 }, undefined],
      [{ richtung: "hin", art: "oev", zeit: "24:00" }, undefined],
      [{ richtung: "hin", art: "oev", zeit: "7:30" }, undefined],
      [{ richtung: "hin", art: "oev", datum: "2027-02-30" }, undefined],
      [{ richtung: "hin", art: "oev", name: "" }, undefined],
      [{ richtung: "hin", art: "oev", name: "x".repeat(101) }, undefined],
      [{ richtung: "hin", art: "oev", treffpunkt: "a\u0007b" }, undefined],
      [{ art: "oev" }, undefined],
    ];
    for (const [body, code] of faelle) {
      const a = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, body);
      expect(a.status, JSON.stringify(body)).toBe(400);
      if (code) expect(a.body.code).toBe(code);
    }
    expect((await liste(leiter(), id)).length).toBe(0);
  });

  test("ändern: Version zählt, Art und Richtung lassen sich nicht ändern, Regeln gelten für den Stand danach", async () => {
    const id = await frischesLager();
    const f = await auto({ fahrerPersonId: konten.leitung.id }, id);
    const p = (body: Record<string, unknown>) =>
      anfrage(leiter(), "PATCH", `${L(id)}/fahrten/${f.id}`, body);
    const a = await p({ version: 1, plaetze: 6, zeit: "08:15" });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ version: 2, plaetze: 6, zeit: "08:15" });
    expect((await p({ version: 2, richtung: "rueck" })).status).toBe(400);
    expect((await p({ version: 2, art: "oev" })).status).toBe(400);
    expect((await p({ version: 2 })).status).toBe(400);
    // Plätze entfernen: Ein Auto braucht sie
    const ohnePlaetze = await p({ version: 2, plaetze: null });
    expect(ohnePlaetze.status).toBe(400);
    expect(ohnePlaetze.body.code).toBe("PLAETZE_FEHLEN");
    // Link nur bei einer ÖV-Gruppe
    expect(
      (await p({ version: 2, link: "https://fahrplan.example.ch/x" })).body
        .code,
    ).toBe("LINK_NUR_FUER_OEV");
    // Veraltete Version: 409 mit dem aktuellen Stand
    const alt = await p({ version: 1, name: "Zu spät" });
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
    expect(alt.body.aktuell).toMatchObject({ version: 2, plaetze: 6 });
    // null leert ein freiwilliges Feld
    const leer = await p({ version: 2, zeit: null, name: null });
    expect(leer.body).toMatchObject({ version: 3, zeit: null, name: null });
  });

  test("Weniger Plätze als Mitfahrende sind erlaubt und ergeben die Warnung", async () => {
    const id = await frischesLager();
    const f = await auto({ plaetze: 3 }, id);
    for (const n of ["A", "B"]) {
      expect(
        (await mitfahrt(f.id, { teilnehmerId: await kind(id, n) }, id)).status,
      ).toBe(201);
    }
    const a = await anfrage(leiter(), "PATCH", `${L(id)}/fahrten/${f.id}`, {
      version: 1,
      plaetze: 1,
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ belegt: 2, frei: 0, ueberbelegt: true });
  });
});

describe("Kartenpunkt", () => {
  const link = "https://maps.example.ch/?q=Lagerhaus";

  test("Adresse, Koordinaten oder Link mit Bezeichnung, auch Koordinaten bei Null", async () => {
    const id = await frischesLager();
    const a = await neueFahrt(
      { zielBezeichnung: "Lagerhaus", zielAdresse: "Dorfstrasse 1, 8000 Ort" },
      id,
    );
    expect(a).toMatchObject({
      zielBezeichnung: "Lagerhaus",
      zielAdresse: "Dorfstrasse 1, 8000 Ort",
      zielLat: null,
      zielLon: null,
      zielLink: null,
    });
    const b = await neueFahrt(
      { zielBezeichnung: "Gipfel", zielLat: 47.3769, zielLon: 8.5417 },
      id,
    );
    expect(b).toMatchObject({ zielLat: 47.3769, zielLon: 8.5417 });
    // Null Grad ist ein Wert, kein «fehlt»
    const c = await neueFahrt(
      { zielBezeichnung: "Nullpunkt", zielLat: 0, zielLon: 0 },
      id,
    );
    expect(c).toMatchObject({ zielLat: 0, zielLon: 0 });
    // Die Grenzen selbst
    const d = await neueFahrt(
      { zielBezeichnung: "Pol", zielLat: -90, zielLon: 180 },
      id,
    );
    expect(d).toMatchObject({ zielLat: -90, zielLon: 180 });
    const e = await neueFahrt(
      {
        zielBezeichnung: "Karte",
        zielLink: "HTTPS://Maps.Example.CH/Pfad?q=1",
      },
      id,
    );
    expect(e.zielLink).toBe("https://maps.example.ch/Pfad?q=1");
  });

  test("Koordinaten ausserhalb der Wertebereiche und unvollständige Punkte: 400", async () => {
    const id = await frischesLager();
    const ziel = { zielBezeichnung: "Ort" };
    const faelle: [Record<string, unknown>, string | undefined][] = [
      [{ ...ziel, zielLat: 90.0001, zielLon: 8 }, undefined],
      [{ ...ziel, zielLat: -90.5, zielLon: 8 }, undefined],
      [{ ...ziel, zielLat: 47, zielLon: 180.0001 }, undefined],
      [{ ...ziel, zielLat: 47, zielLon: -181 }, undefined],
      [{ ...ziel, zielLat: "47", zielLon: 8 }, undefined],
      [
        { ...ziel, zielLat: null, zielLon: 8, zielAdresse: "A" },
        "KOORDINATEN_UNVOLLSTAENDIG",
      ],
      [{ ...ziel, zielLat: 47 }, "KOORDINATEN_UNVOLLSTAENDIG"],
      [{ ...ziel, zielLon: 8 }, "KOORDINATEN_UNVOLLSTAENDIG"],
      // Bezeichnung allein, oder ein Punkt ohne Bezeichnung
      [ziel, "KARTENPUNKT_UNVOLLSTAENDIG"],
      [{ zielAdresse: "Dorfstrasse 1" }, "KARTENPUNKT_UNVOLLSTAENDIG"],
      [{ zielLat: 47, zielLon: 8 }, "KARTENPUNKT_UNVOLLSTAENDIG"],
      [{ zielLink: link }, "KARTENPUNKT_UNVOLLSTAENDIG"],
      [{ ...ziel, zielAdresse: "x".repeat(201) }, undefined],
      [{ zielBezeichnung: "x".repeat(101), zielAdresse: "A" }, undefined],
      [{ ...ziel, zielAdresse: "" }, undefined],
    ];
    for (const [body, code] of faelle) {
      const a = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, {
        richtung: "hin",
        art: "oev",
        ...body,
      });
      expect(a.status, JSON.stringify(body)).toBe(400);
      if (code) expect(a.body.code, JSON.stringify(body)).toBe(code);
    }
    expect((await liste(leiter(), id)).length).toBe(0);
  });

  test("böse Links werden abgelehnt (Kartenpunkt und Fahrplan), der Server ruft nie etwas ab", async () => {
    const id = await frischesLager();
    const abruf = vi.spyOn(globalThis, "fetch");
    const boese = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://maps.example.ch/x",
      "ftp://maps.example.ch/x",
      "//maps.example.ch/x",
      "maps.example.ch/x",
      "https://user:pw@maps.example.ch/",
      "https://maps.example.ch:8443/",
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://localhost/",
      "https://[::1]/",
      "https://maps.example.ch/a b",
      "https://maps.example.ch/\\evil",
      "https://maps.example.ch/‮",
      "https://maps.example.ch/\nSet-Cookie: x=1",
      "https://" + "a".repeat(2050) + ".ch/",
      "",
    ];
    try {
      for (const b of boese) {
        const ziel = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, {
          richtung: "hin",
          art: "oev",
          zielBezeichnung: "Ort",
          zielLink: b,
        });
        expect(ziel.status, `zielLink ${b}`).toBe(400);
        const fahrplan = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, {
          richtung: "hin",
          art: "oev",
          link: b,
        });
        expect(fahrplan.status, `link ${b}`).toBe(400);
      }
      // Auch beim Ändern
      const f = await neueFahrt(
        { zielBezeichnung: "Ort", zielAdresse: "A" },
        id,
      );
      const p = await anfrage(leiter(), "PATCH", `${L(id)}/fahrten/${f.id}`, {
        version: 1,
        zielLink: "javascript:alert(1)",
      });
      expect(p.status).toBe(400);
      // Gespeichert wurde nichts
      expect((await liste(leiter(), id)).length).toBe(1);
      expect(abruf).not.toHaveBeenCalled();
    } finally {
      abruf.mockRestore();
    }
  });

  test("ändern: ergänzen, leeren, Rest nie ohne Bezeichnung", async () => {
    const id = await frischesLager();
    const f = await neueFahrt({}, id);
    const p = (version: number, body: Record<string, unknown>) =>
      anfrage(leiter(), "PATCH", `${L(id)}/fahrten/${f.id}`, {
        version,
        ...body,
      });
    // Nur die Bezeichnung: noch kein Punkt
    expect((await p(1, { zielBezeichnung: "Ort" })).body.code).toBe(
      "KARTENPUNKT_UNVOLLSTAENDIG",
    );
    const a = await p(1, { zielBezeichnung: "Ort", zielLink: link });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ zielBezeichnung: "Ort", zielLink: link });
    // Den Link entfernen, obwohl sonst nichts da ist: unvollständig
    expect((await p(2, { zielLink: null })).body.code).toBe(
      "KARTENPUNKT_UNVOLLSTAENDIG",
    );
    // Adresse dazu, dann geht der Link
    expect(
      (await p(2, { zielAdresse: "Dorfstrasse 1", zielLink: null })).status,
    ).toBe(200);
    // Den ganzen Punkt leeren
    const leer = await p(3, {
      zielBezeichnung: null,
      zielAdresse: null,
      zielLat: null,
      zielLon: null,
      zielLink: null,
    });
    expect(leer.status).toBe(200);
    expect(leer.body).toMatchObject({
      zielBezeichnung: null,
      zielAdresse: null,
    });
    // Koordinaten nur zusammen
    expect(
      (await p(4, { zielBezeichnung: "Ort", zielLat: 47.1 })).body.code,
    ).toBe("KOORDINATEN_UNVOLLSTAENDIG");
  });
});

describe("Fahrer", () => {
  test("nur aktive Mitglieder des Lagers; je Richtung höchstens eine Fahrt", async () => {
    const id = await frischesLager();
    // Konto der Abteilung ohne Mitgliedschaft, Konto der fremden Abteilung (falsche Zeile im Lager)
    for (const wer of [konten.ohneMitgliedschaft, konten.fremdeAbteilung]) {
      const a = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, {
        richtung: "hin",
        art: "auto",
        plaetze: 3,
        fahrerPersonId: wer.id,
      });
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("KEIN_MITGLIED");
    }
    const f = await auto({ fahrerPersonId: konten.leitung.id }, id);
    const doppelt = await anfrage(leiter(), "POST", `${L(id)}/fahrten`, {
      richtung: "hin",
      art: "auto",
      plaetze: 3,
      fahrerPersonId: konten.leitung.id,
    });
    expect(doppelt.status).toBe(409);
    expect(doppelt.body).toMatchObject({
      code: "BEREITS_IN_FAHRT",
      fahrtId: f.id,
    });
    // In der anderen Richtung fährt dieselbe Person wieder
    const rueck = await auto(
      { richtung: "rueck", fahrerPersonId: konten.leitung.id },
      id,
    );
    expect(rueck.fahrer.personId).toBe(konten.leitung.id);
    // Fahrer wechseln: auf jemand anderen geht, auf einen, der schon fährt, nicht
    const zwei = await auto({}, id);
    const wechsel = (fahrerPersonId: string) =>
      anfrage(leiter(), "PATCH", `${L(id)}/fahrten/${zwei.id}`, {
        version: zwei.version,
        fahrerPersonId,
      });
    expect((await wechsel(konten.leitung.id!)).status).toBe(409);
    expect((await wechsel(konten.team.id!)).status).toBe(200);
    // Der Fahrer, der sich nicht ändert, löst nichts aus
    const gleich = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/fahrten/${f.id}`,
      { version: 1, fahrerPersonId: konten.leitung.id, name: "Gleich" },
    );
    expect(gleich.status).toBe(200);
  });

  test("Fahrer und Mitfahrende schliessen sich in einer Richtung aus, in beide Richtungen der Prüfung", async () => {
    const id = await frischesLager();
    const a = await auto({ fahrerPersonId: konten.leitung.id }, id);
    const b = await auto({}, id);
    // Der Fahrer von A sitzt nicht auch in B
    const sitzt = await mitfahrt(b.id, { personId: konten.leitung.id }, id);
    expect(sitzt.status).toBe(409);
    expect(sitzt.body).toMatchObject({
      code: "BEREITS_IN_FAHRT",
      fahrtId: a.id,
    });
    // Wer in B mitfährt, fährt nicht auch A (anderer Fahrer als Wechsel)
    expect(
      (await mitfahrt(b.id, { personId: konten.team.id }, id)).status,
    ).toBe(201);
    const wechsel = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/fahrten/${a.id}`,
      {
        version: 1,
        fahrerPersonId: konten.team.id,
      },
    );
    expect(wechsel.status).toBe(409);
    expect(wechsel.body.fahrtId).toBe(b.id);
    // Der Fahrer von A kann nicht Mitfahrer von A sein
    const selbst = await mitfahrt(a.id, { personId: konten.leitung.id }, id);
    expect(selbst.status).toBe(409);
    // Rückfahrt ist frei
    const rueck = await auto({ richtung: "rueck" }, id);
    expect(
      (await mitfahrt(rueck.id, { personId: konten.leitung.id }, id)).status,
    ).toBe(201);
  });
});

describe("Mitfahrende", () => {
  test("Person und Teilnehmender als Einzelzeilen, Belegung «x von y», Namen aufgelöst", async () => {
    const id = await frischesLager();
    const f = await auto({ plaetze: 3, fahrerPersonId: konten.leitung.id }, id);
    const t = await kind(id, "Anna", "Wolf");
    const a = await mitfahrt(f.id, { teilnehmerId: t }, id);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      fahrtId: f.id,
      teilnehmerId: t,
      personId: null,
      version: 1,
      belegt: 1,
      plaetze: 3,
      ueberbelegt: false,
    });
    const b = await mitfahrt(f.id, { personId: konten.team.id }, id);
    expect(b.status).toBe(201);
    expect(b.body.belegt).toBe(2);
    const g = await anfrage(leiter(), "GET", `${L(id)}/fahrten/${f.id}`);
    expect(g.body).toMatchObject({ belegt: 2, frei: 1, ueberbelegt: false });
    expect(g.body.mitfahrer).toEqual([
      {
        id: a.body.id,
        version: 1,
        personId: null,
        teilnehmerId: t,
        name: "Anna Muster",
        stufe: "Wolf",
      },
      expect.objectContaining({ personId: konten.team.id, stufe: null }),
    ]);
    // Der Name kommt aus dem Konto, die Antwort trägt keine weiteren Felder der Person
    expect(Object.keys(g.body.mitfahrer[1]).sort()).toEqual(
      ["id", "name", "personId", "stufe", "teilnehmerId", "version"].sort(),
    );
  });

  test("Überbelegung ist nur eine Warnung", async () => {
    const id = await frischesLager();
    const f = await auto({ plaetze: 1 }, id);
    const eins = await mitfahrt(
      f.id,
      { teilnehmerId: await kind(id, "A") },
      id,
    );
    expect(eins.body).toMatchObject({ belegt: 1, ueberbelegt: false });
    const zwei = await mitfahrt(
      f.id,
      { teilnehmerId: await kind(id, "B") },
      id,
    );
    expect(zwei.status).toBe(201);
    expect(zwei.body).toMatchObject({
      belegt: 2,
      plaetze: 1,
      ueberbelegt: true,
    });
    const g = await anfrage(leiter(), "GET", `${L(id)}/fahrten/${f.id}`);
    expect(g.body).toMatchObject({ belegt: 2, frei: 0, ueberbelegt: true });
    // Eine ÖV-Gruppe hat keine Platzgrenze
    const o = await neueFahrt({}, id);
    const m = await mitfahrt(o.id, { teilnehmerId: await kind(id, "C") }, id);
    expect(m.body).toMatchObject({ plaetze: null, ueberbelegt: false });
  });

  test("einmalig je Richtung: nicht doppelt, nicht in zwei Fahrten, in der anderen Richtung ja", async () => {
    const id = await frischesLager();
    const [f1, f2] = [await neueFahrt({}, id), await neueFahrt({}, id)];
    const r1 = await neueFahrt({ richtung: "rueck" }, id);
    const t = await kind(id);
    for (const wer of [{ teilnehmerId: t }, { personId: konten.team.id }]) {
      expect((await mitfahrt(f1.id, wer, id)).status).toBe(201);
      const nochmal = await mitfahrt(f1.id, wer, id);
      expect(nochmal.status).toBe(409);
      expect(nochmal.body).toMatchObject({
        code: "BEREITS_IN_FAHRT",
        fahrtId: f1.id,
      });
      const andere = await mitfahrt(f2.id, wer, id);
      expect(andere.status).toBe(409);
      expect(andere.body.fahrtId).toBe(f1.id);
      expect((await mitfahrt(r1.id, wer, id)).status).toBe(201);
      await db
        .delete(schema.fahrtMitfahrer)
        .where(eq(schema.fahrtMitfahrer.lagerId, id));
    }
  });

  test("gleichzeitig: dieselbe Person in vielen Fahrten, genau eine gewinnt", async () => {
    const id = await frischesLager();
    const fahrten = await Promise.all(
      Array.from({ length: 6 }, () => neueFahrt({}, id)),
    );
    const t = await kind(id);
    const antworten = await Promise.all(
      fahrten.map((f) => mitfahrt(f.id, { teilnehmerId: t }, id)),
    );
    expect(antworten.filter((a) => a.status === 201)).toHaveLength(1);
    expect(antworten.filter((a) => a.status === 409)).toHaveLength(5);
    const zeilen = await db
      .select()
      .from(schema.fahrtMitfahrer)
      .where(eq(schema.fahrtMitfahrer.lagerId, id));
    expect(zeilen).toHaveLength(1);
  });

  test("nur Mitglieder und Teilnehmende dieses Lagers; genau eines von beiden", async () => {
    const id = await frischesLager();
    const f = await neueFahrt({}, id);
    const anderes = await frischesLager();
    const fremdesKind = await kind(anderes);
    const a = await mitfahrt(f.id, { teilnehmerId: fremdesKind }, id);
    expect([a.status, a.body.code]).toEqual([400, "TEILNEHMER_UNBEKANNT"]);
    for (const wer of [
      konten.ohneMitgliedschaft.id!,
      konten.fremdeAbteilung.id!,
    ]) {
      const b = await mitfahrt(f.id, { personId: wer }, id);
      expect([b.status, b.body.code]).toEqual([400, "KEIN_MITGLIED"]);
    }
    for (const body of [
      {},
      { personId: konten.team.id, teilnehmerId: fremdesKind },
      { personId: "kein-uuid" },
      { personId: konten.team.id, gesundheit: "x" },
    ]) {
      const c = await anfrage(
        leiter(),
        "POST",
        `${L(id)}/fahrten/${f.id}/mitfahrer`,
        body,
      );
      expect(c.status, JSON.stringify(body)).toBe(400);
    }
    // Ein gelöschter Teilnehmender ist unbekannt
    const weg = await kind(id);
    await db
      .update(schema.teilnehmer)
      .set({ geloeschtAm: new Date() })
      .where(eq(schema.teilnehmer.id, weg));
    expect((await mitfahrt(f.id, { teilnehmerId: weg }, id)).status).toBe(400);
    expect((await liste(leiter(), id))[0]!.mitfahrer).toHaveLength(0);
  });

  test("entfernen: Version, richtige Fahrt, danach ist die Person frei", async () => {
    const id = await frischesLager();
    const [f1, f2] = [await neueFahrt({}, id), await neueFahrt({}, id)];
    const t = await kind(id);
    const m = (await mitfahrt(f1.id, { teilnehmerId: t }, id)).body;
    const entf = (fahrtId: string, version: number) =>
      anfrage(
        leiter(),
        "DELETE",
        `${L(id)}/fahrten/${fahrtId}/mitfahrer/${m.id}?version=${version}`,
      );
    // Die Mitfahrt gehört zu f1, nicht zu f2
    expect((await entf(f2.id, 1)).status).toBe(404);
    const alt = await entf(f1.id, 7);
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
    expect((await entf(f1.id, 1)).status).toBe(204);
    expect((await entf(f1.id, 1)).status).toBe(404);
    expect((await mitfahrt(f2.id, { teilnehmerId: t }, id)).status).toBe(201);
  });

  test("Fahrt löschen: die Mitfahrenden fallen mit, der Feed meldet alles als gelöscht, die Personen sind frei", async () => {
    const id = await frischesLager();
    const f = await auto({ fahrerPersonId: konten.leitung.id }, id);
    const andere = await neueFahrt({}, id);
    const t1 = await kind(id, "A");
    const t2 = await kind(id, "B");
    const m1 = (await mitfahrt(f.id, { teilnehmerId: t1 }, id)).body;
    const m2 = (await mitfahrt(f.id, { teilnehmerId: t2 }, id)).body;
    const [lager] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    const veraltet = await anfrage(
      leiter(),
      "DELETE",
      `${L(id)}/fahrten/${f.id}?version=9`,
    );
    expect(veraltet.status).toBe(409);
    expect(
      (await anfrage(leiter(), "DELETE", `${L(id)}/fahrten/${f.id}?version=1`))
        .status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/fahrten/${f.id}`)).status,
    ).toBe(404);
    expect((await liste(leiter(), id)).map((x) => x.id)).toEqual([andere.id]);
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/aenderungen?seit=${lager!.seq}`,
    );
    const geloescht = feed.body.eintraege
      .filter((e: { art: string }) => e.art === "geloescht")
      .map((e: { objekttyp: string; id: string }) => `${e.objekttyp}:${e.id}`)
      .sort();
    expect(geloescht).toEqual(
      [
        `fahrt:${f.id}`,
        `fahrt_mitfahrer:${m1.id}`,
        `fahrt_mitfahrer:${m2.id}`,
      ].sort(),
    );
    // Wieder frei: Teilnehmende und Fahrer
    expect((await mitfahrt(andere.id, { teilnehmerId: t1 }, id)).status).toBe(
      201,
    );
    expect((await mitfahrt(andere.id, { teilnehmerId: t2 }, id)).status).toBe(
      201,
    );
    expect(
      (await auto({ fahrerPersonId: konten.leitung.id }, id)).fahrer,
    ).not.toBeNull();
  });
});

describe("Sicht des Teams", () => {
  test("das Team sieht nur die eigene Fahrt, Liste, Einzelabruf, Feed und «ohne Fahrt»", async () => {
    const id = await frischesLager();
    // Ein frisches Lager hat Folgenummer 0: Der Feed ab 0 zeigt alles, was danach geschieht
    const lager = { seq: 0 };
    const f1 = await neueFahrt({ name: "Meine" }, id);
    const f2 = await neueFahrt({ name: "Fremde" }, id);
    const f3 = await auto(
      { richtung: "rueck", fahrerPersonId: konten.team.id },
      id,
    );
    const meine = (await mitfahrt(f1.id, { personId: konten.team.id }, id))
      .body;
    const fremde = (await mitfahrt(f2.id, { personId: konten.lesen.id }, id))
      .body;
    const kameraden = (
      await mitfahrt(f1.id, { teilnehmerId: await kind(id) }, id)
    ).body;

    expect((await liste(konten.team, id)).map((x) => x.id).sort()).toEqual(
      [f1.id, f3.id].sort(),
    );
    expect(
      (await liste(konten.team, id, "?richtung=hin")).map((x) => x.id),
    ).toEqual([f1.id]);
    // Die eigene Fahrt zeigt alle, die mitfahren
    expect(
      (await liste(konten.team, id, "?richtung=hin"))[0]!.mitfahrer,
    ).toHaveLength(2);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/fahrten/${f1.id}`)).status,
    ).toBe(200);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/fahrten/${f3.id}`)).status,
    ).toBe(200);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/fahrten/${f2.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/fahrten/ohne?richtung=hin`))
        .status,
    ).toBe(403);
    // Leitung, Lesen und Lagerleitung sehen alle
    for (const p of [
      "leitung",
      "lesen",
      "lagerleitung",
      "abteilungsleitung",
    ] as const) {
      expect((await liste(konten[p], id)).length, p).toBe(3);
    }
    // Der Feed meldet dem Team nur die eigene Fahrt und die Mitfahrten in ihr
    const feed = await anfrage(
      konten.team,
      "GET",
      `${L(id)}/aenderungen?seit=${lager.seq}`,
    );
    const gesehen = feed.body.eintraege.map(
      (e: { objekttyp: string; id: string }) => `${e.objekttyp}:${e.id}`,
    );
    expect(gesehen).toEqual(
      expect.arrayContaining([
        `fahrt:${f1.id}`,
        `fahrt:${f3.id}`,
        `fahrt_mitfahrer:${meine.id}`,
        `fahrt_mitfahrer:${kameraden.id}`,
      ]),
    );
    expect(gesehen).not.toContain(`fahrt:${f2.id}`);
    expect(gesehen).not.toContain(`fahrt_mitfahrer:${fremde.id}`);
    // Die Leitung sieht den Feed ganz
    const leitung = await anfrage(
      konten.leitung,
      "GET",
      `${L(id)}/aenderungen?seit=${lager.seq}`,
    );
    expect(leitung.body.eintraege.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining([f2.id, fremde.id]),
    );
  });

  test("mit einteilung.bearbeiten sieht das Team alle Fahrten und «ohne Fahrt»", async () => {
    const id = await frischesLager();
    await neueFahrt({}, id);
    await neueFahrt({}, id);
    expect((await liste(konten.team, id)).length).toBe(0);
    const r = await anfrage(leiter(), "PUT", `${L(id)}/rechte`, {
      rechte: [
        { rolle: "team", recht: "einteilung.bearbeiten", erlaubt: true },
      ],
    });
    expect(r.status).toBe(204);
    expect((await liste(konten.team, id)).length).toBe(2);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/fahrten/ohne?richtung=hin`))
        .status,
    ).toBe(200);
  });

  test("ist einteilung.lesen für das Team abgeschaltet, ist die Liste 403", async () => {
    const id = await frischesLager();
    await anfrage(leiter(), "PUT", `${L(id)}/rechte`, {
      rechte: [{ rolle: "team", recht: "einteilung.lesen", erlaubt: false }],
    });
    expect((await anfrage(konten.team, "GET", `${L(id)}/fahrten`)).status).toBe(
      403,
    );
  });
});

describe("Personen ohne Fahrt", () => {
  test("Teilnehmende und Mitglieder ohne Zuordnung je Richtung, mit Gesamtzahl und Seitenwechsel", async () => {
    const id = await frischesLager();
    const [a, b, c] = [
      await kind(id, "Anna", "Wolf"),
      await kind(id, "Berta", "Pfadi"),
      await kind(id, "Carla", null),
    ];
    const hin = await auto({ fahrerPersonId: konten.leitung.id }, id);
    await mitfahrt(hin.id, { teilnehmerId: a }, id);
    await mitfahrt(hin.id, { personId: konten.team.id }, id);
    const ohne = async (richtung: string, abfrage = "") =>
      (
        await anfrage(
          leiter(),
          "GET",
          `${L(id)}/fahrten/ohne?richtung=${richtung}${abfrage}`,
        )
      ).body;

    const h = await ohne("hin");
    // Berta, Carla, Lagerleitung, Lesen (Leitung fährt, Team und Anna sitzen)
    expect(h.gesamt).toBe(4);
    expect(h.personen.map((p: { name: string }) => p.name).sort()).toEqual(
      [
        "Berta Muster",
        "Carla Muster",
        await nameVon(konten.lagerleitung.id),
        await nameVon(konten.lesen.id),
      ].sort(),
    );
    const berta = h.personen.find(
      (p: { teilnehmerId: string | null }) => p.teilnehmerId === b,
    );
    expect(berta).toEqual({
      teilnehmerId: b,
      personId: null,
      name: "Berta Muster",
      stufe: "Pfadi",
    });
    expect(
      h.personen.find(
        (p: { teilnehmerId: string | null }) => p.teilnehmerId === c,
      ).stufe,
    ).toBeNull();
    // In der Rückfahrt sitzt noch niemand: alle sieben
    expect((await ohne("rueck")).gesamt).toBe(7);
    // Seitenwechsel über den Cursor, ohne Lücke und ohne doppelte Einträge
    const gesehen: string[] = [];
    let nach: string | null = null;
    for (let i = 0; i < 10; i++) {
      const s: {
        personen: { name: string }[];
        naechster: string | null;
        gesamt: number;
      } = await ohne("rueck", `&limit=3${nach ? `&nach=${nach}` : ""}`);
      expect(s.gesamt).toBe(7);
      gesehen.push(...s.personen.map((p) => p.name));
      nach = s.naechster;
      if (!nach) break;
    }
    expect(gesehen).toHaveLength(7);
    expect(new Set(gesehen).size).toBe(7);
    // Ein Teilnehmender im Papierkorb zählt nicht
    await db
      .update(schema.teilnehmer)
      .set({ geloeschtAm: new Date() })
      .where(eq(schema.teilnehmer.id, c));
    expect((await ohne("hin")).gesamt).toBe(3);
    // Richtung ist Pflicht, der Cursor streng
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/fahrten/ohne`)).status,
    ).toBe(400);
    expect(
      (
        await anfrage(
          leiter(),
          "GET",
          `${L(id)}/fahrten/ohne?richtung=hin&nach=x`,
        )
      ).status,
    ).toBe(400);
  });

  test("ein deaktiviertes Konto zählt nicht; fremde Lager und Teilnehmende bleiben aussen vor", async () => {
    const id = await frischesLager();
    const anderes = await frischesLager();
    await kind(anderes, "Fremd");
    const gesamt = async () =>
      (await anfrage(leiter(), "GET", `${L(id)}/fahrten/ohne?richtung=hin`))
        .body.gesamt;
    expect(await gesamt()).toBe(4);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, konten.lesen.id!));
    try {
      expect(await gesamt()).toBe(3);
    } finally {
      await db
        .update(schema.user)
        .set({ deaktiviertAm: null })
        .where(eq(schema.user.id, konten.lesen.id!));
    }
  });
});

describe("Datenbanklast", () => {
  test("die Zahl der Abfragen hängt nicht von der Zahl der Fahrten und Mitfahrenden ab", async () => {
    const id = await frischesLager();
    const zaehle = async (pfad: string, erwartet = 200) => {
      const vor = abfragen;
      expect((await anfrage(leiter(), "GET", pfad)).status).toBe(erwartet);
      return abfragen - vor;
    };
    const f0 = await auto({}, id);
    await mitfahrt(f0.id, { teilnehmerId: await kind(id, "Eins") }, id);
    const listeWenige = await zaehle(`${L(id)}/fahrten`);
    const ohneWenige = await zaehle(`${L(id)}/fahrten/ohne?richtung=hin`);
    for (let i = 0; i < 12; i++) {
      const f = await auto({ plaetze: 5 }, id);
      for (let k = 0; k < 4; k++) {
        await mitfahrt(
          f.id,
          { teilnehmerId: await kind(id, `K${i}x${k}`) },
          id,
        );
      }
    }
    expect((await liste(leiter(), id)).length).toBe(13);
    expect(await zaehle(`${L(id)}/fahrten`)).toBe(listeWenige);
    expect(await zaehle(`${L(id)}/fahrten/ohne?richtung=hin`)).toBe(ohneWenige);
    // Anmeldung (Sitzung, Konto), Lager mit Mitgliedschaft, Rechte der Rolle und die eine Abfrage der Liste
    expect(listeWenige).toBeLessThanOrEqual(5);
    expect(ohneWenige).toBeLessThanOrEqual(5);
    // Auch für das Team: dieselbe Zahl
    const vor = abfragen;
    expect((await anfrage(konten.team, "GET", `${L(id)}/fahrten`)).status).toBe(
      200,
    );
    // Eine mehr als die Lagerleitung: Das Team liest die eingestellten Rechte
    expect(abfragen - vor).toBeLessThanOrEqual(6);
  });
});
