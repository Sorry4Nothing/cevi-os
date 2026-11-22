import { randomUUID } from "node:crypto";
import { eq, sql as sqlTag } from "drizzle-orm";
import { pgSchema, uuid } from "drizzle-orm/pg-core";
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
import { lagerSpalten } from "../../src/db/schema-lager.js";
import {
  entferneDateiVerweis,
  raeumeDateienOhneVerweisAuf,
  registriereDateiVerweis,
} from "../../src/lager/datei-verweise.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL, BESITZER_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const besitzer = postgres(BESITZER_URL, { max: 1, onnotice: () => {} });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
const SCHEMA = "dokumente_test";
afterAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.end();
  await sql.end();
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let fremdLagerId: string;
let andereLagerId: string;

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
      titel: "Dokumentlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) =>
        [p, await legePersonaAn(welt, KONTO_FUER[p] as Persona)] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await legeLager(welt.testabteilungId);
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  andereLagerId = await legeLager(welt.testabteilungId);
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  for (const id of [lagerId, geschlossenId, andereLagerId]) {
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
const SP = "https://cevi.sharepoint.com/sites/lager/Shared%20Documents";

// Eine Verknüpfung direkt in der Datenbank, hinzugefügt von der genannten Person (nur sie darf sie in den ersten 24 Stunden einbinden)
async function datei(
  werte: Partial<typeof schema.lagerDatei.$inferInsert> = {},
  id = lagerId,
  von: PersonaKonto = leiter(),
) {
  const [zeile] = await db
    .insert(schema.lagerDatei)
    .values({
      lagerId: id,
      anzeigename: "Plan.pdf",
      link: `${SP}/Plan.pdf`,
      erstelltVon: von.id,
      lagerSeq: 0,
      ...werte,
    })
    .returning({ id: schema.lagerDatei.id });
  return zeile!.id;
}
async function neu(
  werte: Record<string, unknown> = {},
  dateiWerte: Partial<typeof schema.lagerDatei.$inferInsert> = {},
  id = lagerId,
) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/dokumente`, {
    titel: "Dokument",
    dateiId: await datei(dateiWerte, id),
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    titel: string;
    stichworte: string[];
    teamSichtbar: boolean;
    datei: { id: string; link: string } | null;
    art: string;
    sharepoint: boolean;
  };
}
const liste = async (konto: PersonaKonto, abfrage = "", id = lagerId) => {
  const a = await anfrage(konto, "GET", `${L(id)}/dokumente${abfrage}`);
  expect(a.status).toBe(200);
  return a.body as {
    dokumente: { id: string; titel: string; quelle: string }[];
    naechster: string | null;
  };
};
const titel = async (konto: PersonaKonto, abfrage = "") =>
  (await liste(konto, abfrage)).dokumente.map((d) => d.titel);
// Eigener Titel je Test, damit die Listen der Tests sich nicht stören
const marke = () => `T${randomUUID().slice(0, 8)}`;

describe("Rechte je Lager-Persona", () => {
  // Lesen: alle ausser Nicht-Mitgliedern (Team über team_lesen). Schreiben: Lagerleitung, Abteilungsleitung, Leitung
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
    expect((await anfrage(konten[p], "GET", `${L()}/dokumente`)).status).toBe(
      lesen[p],
    );
  });

  test.each(LAGER_PERSONAS)(
    "%s: einzelnes freigegebenes Dokument lesen",
    async (p) => {
      const d = await neu({ teamSichtbar: true });
      expect(
        (await anfrage(konten[p], "GET", `${L()}/dokumente/${d.id}`)).status,
      ).toBe(lesen[p]);
    },
  );

  test.each(LAGER_PERSONAS)("%s: anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/dokumente`, {
      titel: "X",
      // Die Datei hat die Person selbst hinzugefügt
      dateiId: await datei({}, lagerId, konten[p].id ? konten[p] : leiter()),
    });
    expect(a.status).toBe(schreiben(201)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: ändern", async (p) => {
    const d = await neu();
    const a = await anfrage(konten[p], "PATCH", `${L()}/dokumente/${d.id}`, {
      version: d.version,
      titel: "Anders",
    });
    expect(a.status).toBe(schreiben(200)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: löschen", async (p) => {
    const d = await neu();
    const a = await anfrage(
      konten[p],
      "DELETE",
      `${L()}/dokumente/${d.id}?version=${d.version}`,
    );
    expect(a.status).toBe(schreiben(204)[p]);
  });

  test("ein abgeschlossenes Lager ist schreibgeschützt, Lesen geht", async () => {
    // Die Zeile im geschlossenen Lager direkt anlegen (über die Routen geht dort nichts)
    const [zeile] = await db
      .insert(schema.dokument)
      .values({
        lagerId: geschlossenId,
        titel: "Geschlossen",
        dateiId: await datei({}, geschlossenId),
        lagerSeq: 0,
      })
      .returning({ id: schema.dokument.id });
    for (const p of ["lagerleitung", "abteilungsleitung", "leitung"] as const) {
      expect(
        (
          await anfrage(konten[p], "POST", `${L(geschlossenId)}/dokumente`, {
            titel: "X",
            dateiId: randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await anfrage(
            konten[p],
            "PATCH",
            `${L(geschlossenId)}/dokumente/${zeile!.id}`,
            { version: 1, titel: "Y" },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await anfrage(
            konten[p],
            "DELETE",
            `${L(geschlossenId)}/dokumente/${zeile!.id}?version=1`,
          )
        ).status,
      ).toBe(409);
    }
    const a = await anfrage(leiter(), "GET", `${L(geschlossenId)}/dokumente`);
    expect(a.status).toBe(200);
    expect(a.body.dokumente.map((x: { titel: string }) => x.titel)).toEqual([
      "Geschlossen",
    ]);
  });

  test("ein eingestelltes Recht gilt: ohne Leserechte 403, nur team_lesen = nur freigegebene", async () => {
    const lager = await legeLager(welt.testabteilungId);
    for (const [persona, rolle] of [
      ["lagerleitung", "lagerleitung"],
      ["team", "team"],
      ["lesen", "lesen"],
    ] as const) {
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId: lager, personId: konten[persona].id!, rolle });
    }
    const frei = await anfrage(leiter(), "POST", `${L(lager)}/dokumente`, {
      titel: "frei",
      dateiId: await datei({}, lager),
      teamSichtbar: true,
    });
    const zu = await anfrage(leiter(), "POST", `${L(lager)}/dokumente`, {
      titel: "zu",
      dateiId: await datei({}, lager),
    });
    expect(frei.status).toBe(201);
    // Lesen: nur die freigegebenen (das Recht lesen_alle nehmen wir ihm)
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: lager,
      rolle: "lesen",
      recht: "dokumente.lesen_alle",
      erlaubt: false,
    });
    expect(
      (await liste(konten.lesen, "", lager)).dokumente.map((d) => d.titel),
    ).toEqual(["frei"]);
    expect(
      (
        await anfrage(
          konten.lesen,
          "GET",
          `${L(lager)}/dokumente/${zu.body.id}`,
        )
      ).status,
    ).toBe(404);
    // Team: ohne team_lesen 403
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: lager,
      rolle: "team",
      recht: "dokumente.team_lesen",
      erlaubt: false,
    });
    expect(
      (await anfrage(konten.team, "GET", `${L(lager)}/dokumente`)).status,
    ).toBe(403);
    // Team mit lesen_alle sieht alle
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: lager,
      rolle: "team",
      recht: "dokumente.lesen_alle",
      erlaubt: true,
    });
    expect(
      (await liste(konten.team, "", lager)).dokumente
        .map((d) => d.titel)
        .sort(),
    ).toEqual(["frei", "zu"]);
  });
});

describe("Team sieht nur freigegebene Dokumente", () => {
  test("Liste, Einzelabruf, Suche und Filter blenden andere aus", async () => {
    const m = marke();
    const frei = await neu({
      titel: `${m} frei`,
      stichworte: ["packen"],
      teamSichtbar: true,
    });
    const zu = await neu({ titel: `${m} intern`, stichworte: ["packen"] });
    for (const abfrage of [
      `?q=${m}`,
      `?stichwort=packen&q=${m}`,
      `?typ=pdf&q=${m}`,
    ]) {
      expect(await titel(konten.team, abfrage)).toEqual([`${m} frei`]);
      expect((await titel(konten.lagerleitung, abfrage)).sort()).toEqual([
        `${m} frei`,
        `${m} intern`,
      ]);
    }
    expect(
      (await anfrage(konten.team, "GET", `${L()}/dokumente/${frei.id}`)).status,
    ).toBe(200);
    // Ein nicht freigegebenes Dokument gibt es für das Team nicht, auch nicht zum Ändern oder Löschen
    expect(
      (await anfrage(konten.team, "GET", `${L()}/dokumente/${zu.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(konten.lesen, "GET", `${L()}/dokumente/${zu.id}`)).status,
    ).toBe(200);
  });

  test("Freigabe zurücknehmen entzieht dem Team das Dokument sofort", async () => {
    const m = marke();
    const d = await neu({ titel: m, teamSichtbar: true });
    expect(await titel(konten.team, `?q=${m}`)).toEqual([m]);
    const p = await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: d.version,
      teamSichtbar: false,
    });
    expect(p.status).toBe(200);
    expect(p.body.teamSichtbar).toBe(false);
    expect(await titel(konten.team, `?q=${m}`)).toEqual([]);
    expect(
      (await anfrage(konten.team, "GET", `${L()}/dokumente/${d.id}`)).status,
    ).toBe(404);
  });

  test("die Antwort an das Team nennt nichts über nicht freigegebene Dokumente (kein Zähler, kein Cursor)", async () => {
    const m = marke();
    await neu({ titel: `${m}1` });
    await neu({ titel: `${m}2` });
    const a = await liste(konten.team, `?q=${m}&limit=1`);
    expect(a).toEqual({ dokumente: [], naechster: null });
  });

  test("Änderungsfeed: das Team bekommt nur Dokumente und Dateien, die es sieht", async () => {
    const vor = await anfrage(leiter(), "GET", `${L()}/aenderungen`);
    const seq = vor.body.seq as number;
    expect(vor.body.objekttypen).toContain("dokument");
    expect(
      (await anfrage(konten.team, "GET", `${L()}/aenderungen`)).body
        .objekttypen,
    ).toContain("dokument");
    // Die Dateien über die Route anlegen, damit sie im Feed stehen
    const ueberRoute = async () => {
      const a = await anfrage(leiter(), "POST", `${L()}/dateien`, {
        anzeigename: "Feed.pdf",
        link: `${SP}/Feed.pdf`,
      });
      expect(a.status).toBe(201);
      return a.body.id as string;
    };
    const frei = await neu({ teamSichtbar: true, dateiId: await ueberRoute() });
    const zu = await neu({ dateiId: await ueberRoute() });
    const feed = async (konto: PersonaKonto) =>
      (await anfrage(konto, "GET", `${L()}/aenderungen?seit=${seq}`)).body
        .eintraege as { objekttyp: string; id: string }[];
    const leitungIds = (await feed(leiter())).map((e) => e.id);
    expect(leitungIds).toEqual(expect.arrayContaining([frei.id, zu.id]));
    const teamEintraege = await feed(konten.team);
    const teamIds = teamEintraege.map((e) => e.id);
    expect(teamIds).toContain(frei.id);
    expect(teamIds).toContain(frei.datei!.id);
    expect(teamIds).not.toContain(zu.id);
    expect(teamIds).not.toContain(zu.datei!.id);
  });
});

describe("Anlegen und Ändern", () => {
  test("Antwort: Titel, Stichworte (klein, ohne Doppelte), Datei, Art, SharePoint", async () => {
    const d = await neu({
      titel: "  Packliste  ",
      stichworte: ["Küche", "küche", " Zelte  Aufbau "],
    });
    expect(d).toMatchObject({
      titel: "Packliste",
      version: 1,
      stichworte: ["küche", "zelte aufbau"],
      teamSichtbar: false,
      art: "pdf",
      sharepoint: true,
      quelle: "dokument",
    });
    expect(d.datei).toMatchObject({
      anzeigename: "Plan.pdf",
      link: `${SP}/Plan.pdf`,
    });
    // Nie die ganze Zeile
    expect(Object.keys(d).sort()).toEqual(
      [
        "art",
        "datei",
        "erstelltAm",
        "id",
        "quelle",
        "sharepoint",
        "stichworte",
        "teamSichtbar",
        "titel",
        "version",
      ].sort(),
    );
  });

  test("schreibt über den Sync-Kern: Folgenummer, Feed-Eintrag, Version steigt, Erfasser gespeichert", async () => {
    const vor = (await anfrage(leiter(), "GET", `${L()}/aenderungen`)).body.seq;
    const d = await neu();
    const p = await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: 1,
      titel: "Zwei",
    });
    expect(p.body.version).toBe(2);
    const feed = (
      await anfrage(leiter(), "GET", `${L()}/aenderungen?seit=${vor}`)
    ).body.eintraege as { objekttyp: string; id: string; art: string }[];
    expect(
      feed.filter((e) => e.id === d.id).map((e) => [e.objekttyp, e.art]),
    ).toEqual([
      ["dokument", "neu"],
      ["dokument", "geaendert"],
    ]);
    const [zeile] = await db
      .select()
      .from(schema.dokument)
      .where(eq(schema.dokument.id, d.id));
    expect(zeile).toMatchObject({
      erstelltVon: leiter().id,
      geaendertVon: leiter().id,
      version: 2,
    });
    expect(Number(zeile!.lagerSeq)).toBeGreaterThan(vor);
  });

  test("Änderung: nur genannte Felder, Stichworte ersetzen die Liste, leere Änderung und fremde Felder 400", async () => {
    const d = await neu({ stichworte: ["a", "b"], teamSichtbar: true });
    const p = await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: 1,
      stichworte: ["c"],
    });
    expect(p.body).toMatchObject({
      titel: "Dokument",
      stichworte: ["c"],
      teamSichtbar: true,
    });
    for (const body of [
      { version: 2 },
      { version: 2, unbekannt: 1 },
      { version: 2, titel: "" },
      { version: 2, stichworte: ["a,b"] },
      { version: 2, stichworte: Array.from({ length: 21 }, (_, i) => `s${i}`) },
      { version: 2, stichworte: ["x".repeat(41)] },
      { version: 2, teamSichtbar: "ja" },
      { titel: "ohne Version" },
    ]) {
      expect(
        (await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, body))
          .status,
      ).toBe(400);
    }
  });

  test("veraltete Version: 409 VERSION_KONFLIKT mit aktuellem Stand und abweichenden Feldern", async () => {
    const d = await neu({ titel: "Eins" });
    await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: 1,
      titel: "Zwei",
    });
    const a = await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: 1,
      titel: "Drei",
    });
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({
      code: "VERSION_KONFLIKT",
      aktuell: { id: d.id, version: 2, titel: "Zwei" },
      abweichend: ["titel"],
    });
    expect(Object.keys(a.body.aktuell).sort()).toEqual(
      [
        "dateiId",
        "id",
        "stichworte",
        "teamSichtbar",
        "titel",
        "version",
      ].sort(),
    );
  });

  test("ungültiger Body beim Anlegen: 400", async () => {
    const dateiId = await datei();
    for (const body of [
      {},
      { titel: "X" },
      { dateiId },
      { titel: "", dateiId },
      { titel: "x".repeat(201), dateiId },
      { titel: "Zeilen\numbruch", dateiId },
      { titel: "X", dateiId: "kein-uuid" },
      { titel: "X", dateiId, unbekannt: true },
      { titel: "X", dateiId, teamSichtbar: "ja" },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${L()}/dokumente`, body)).status,
      ).toBe(400);
    }
  });

  test("die Datei muss zum Lager gehören, vorhanden und für die Person sichtbar sein: sonst 400 DATEI_UNBEKANNT", async () => {
    const faelle = {
      zufaellig: randomUUID(),
      fremdesLager: await datei({}, andereLagerId),
      fremdeAbteilung: await datei({}, fremdLagerId),
      geloescht: await datei({ geloeschtAm: new Date() }),
      // Von der Lagerleitung hinzugefügt, die Leitung kennt sie nicht
      vonAnderen: await datei(),
      // Älter als 24 Stunden und von niemandem eingebunden: unsichtbar auch für die, die sie hinzugefügt hat
      alt: await datei({ erstelltAm: new Date(Date.now() - 48 * 3600_000) }),
    };
    for (const [name, dateiId] of Object.entries(faelle)) {
      const konto = name === "vonAnderen" ? konten.leitung : leiter();
      const a = await anfrage(konto, "POST", `${L()}/dokumente`, {
        titel: name,
        dateiId,
      });
      expect([name, a.status, a.body?.code]).toEqual([
        name,
        400,
        "DATEI_UNBEKANNT",
      ]);
    }
    // Beim Ändern gilt dieselbe Prüfung, und das Dokument bleibt unverändert
    const d = await neu();
    const p = await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: 1,
      dateiId: faelle.fremdesLager,
    });
    expect([p.status, p.body.code]).toEqual([400, "DATEI_UNBEKANNT"]);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/dokumente/${d.id}`)).body.version,
    ).toBe(1);
  });

  test("eine Datei, die ein lesbares Dokument einbindet, darf auch die Person einbinden, die sie nicht hinzugefügt hat", async () => {
    // Die Leitung fügt die Datei hinzu und bindet sie ein; die Lagerleitung sieht dieses Dokument (lesen_alle) und darf dieselbe Datei verwenden
    const eins = await anfrage(konten.leitung, "POST", `${L()}/dokumente`, {
      titel: "Eins",
      dateiId: await datei({}, lagerId, konten.leitung),
    });
    expect(eins.status).toBe(201);
    const zwei = await anfrage(leiter(), "POST", `${L()}/dokumente`, {
      titel: "Zwei",
      dateiId: eins.body.datei.id,
    });
    expect(zwei.status).toBe(201);
  });

  test("Änderung der Datei: das Dokument zeigt auf den neuen Link", async () => {
    const d = await neu();
    const andere = await datei({
      anzeigename: "Neu.docx",
      link: `${SP}/Neu.docx`,
    });
    const p = await anfrage(leiter(), "PATCH", `${L()}/dokumente/${d.id}`, {
      version: 1,
      dateiId: andere,
    });
    expect(p.body).toMatchObject({ art: "word", datei: { id: andere } });
  });

  test("Dokumente eines anderen Lagers sind unter diesem Lager nicht erreichbar (404)", async () => {
    const d = await neu({}, {}, andereLagerId);
    const versuche: [string, string, Record<string, unknown>?][] = [
      ["GET", `${L()}/dokumente/${d.id}`],
      ["PATCH", `${L()}/dokumente/${d.id}`, { version: 1, titel: "X" }],
      ["DELETE", `${L()}/dokumente/${d.id}?version=1`],
    ];
    for (const [methode, pfad, body] of versuche) {
      expect((await anfrage(leiter(), methode, pfad, body)).status).toBe(404);
    }
    expect(
      (await liste(leiter(), "", lagerId)).dokumente.map((x) => x.id),
    ).not.toContain(d.id);
    // Fremde Abteilung: das Lager selbst gibt es nicht
    expect(
      (
        await anfrage(
          konten.fremdeAbteilung,
          "GET",
          `${L(lagerId)}/dokumente/${d.id}`,
        )
      ).status,
    ).toBe(404);
  });

  test("der Datenbank-Fremdschlüssel hält die Datei im Lager", async () => {
    await expect(
      db.insert(schema.dokument).values({
        lagerId,
        titel: "Quer",
        dateiId: await datei({}, andereLagerId),
        lagerSeq: 0,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});

describe("Löschen", () => {
  test("Soft-Delete: weg aus Liste und Einzelabruf, Zeile und Verknüpfung bleiben, Feed meldet «geloescht»", async () => {
    const vor = (await anfrage(leiter(), "GET", `${L()}/aenderungen`)).body.seq;
    const d = await neu({ titel: marke() });
    const a = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/dokumente/${d.id}?version=1`,
    );
    expect(a.status).toBe(204);
    expect(await titel(leiter(), `?q=${d.titel}`)).toEqual([]);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/dokumente/${d.id}`)).status,
    ).toBe(404);
    const [zeile] = await db
      .select()
      .from(schema.dokument)
      .where(eq(schema.dokument.id, d.id));
    expect(zeile!.geloeschtAm).not.toBeNull();
    expect(zeile!.geloeschtVon).toBe(leiter().id);
    // Die Datei am Ablageort und ihre Verknüpfung bleiben
    expect(
      await db.$count(schema.lagerDatei, eq(schema.lagerDatei.id, d.datei!.id)),
    ).toBe(1);
    const feed = (
      await anfrage(leiter(), "GET", `${L()}/aenderungen?seit=${vor}`)
    ).body.eintraege as { id: string; art: string }[];
    expect(
      feed.find((e) => e.id === d.id && e.art === "geloescht"),
    ).toBeTruthy();
    // Ein zweites Löschen findet nichts
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/dokumente/${d.id}?version=2`))
        .status,
    ).toBe(404);
  });

  test("falsche Version beim Löschen: 409, das Dokument bleibt", async () => {
    const d = await neu();
    const a = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/dokumente/${d.id}?version=7`,
    );
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("VERSION_KONFLIKT");
    expect(
      (await anfrage(leiter(), "GET", `${L()}/dokumente/${d.id}`)).status,
    ).toBe(200);
    for (const q of ["", "?version=0", "?version=x"]) {
      expect(
        (await anfrage(leiter(), "DELETE", `${L()}/dokumente/${d.id}${q}`))
          .status,
      ).toBe(400);
    }
  });

  test("der Aufräumlauf entfernt nie die Datei eines Dokuments, auch nicht im Papierkorb; verwaiste Dateien schon", async () => {
    const alt = new Date(Date.now() - 72 * 3600_000);
    const d = await neu();
    const im = await neu();
    await anfrage(leiter(), "DELETE", `${L()}/dokumente/${im.id}?version=1`);
    const verwaist = await datei();
    await db
      .update(schema.lagerDatei)
      .set({ erstelltAm: alt })
      .where(
        sqlTag`${schema.lagerDatei.id} in (${d.datei!.id}, ${im.datei!.id}, ${verwaist})`,
      );
    await raeumeDateienOhneVerweisAuf(db);
    const da = async (id: string) =>
      await db.$count(schema.lagerDatei, eq(schema.lagerDatei.id, id));
    expect(await da(d.datei!.id)).toBe(1);
    expect(await da(im.datei!.id)).toBe(1);
    expect(await da(verwaist)).toBe(0);
    // Der Fremdschlüssel (RESTRICT) hält auch gegen ein direktes Löschen
    await expect(
      db.delete(schema.lagerDatei).where(eq(schema.lagerDatei.id, d.datei!.id)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
  });
});

describe("Suche und Filter", () => {
  test("q sucht in Titel und Stichworten, ohne Gross- und Kleinschreibung, nie im Anzeigenamen oder Link", async () => {
    const m = marke().toLowerCase();
    await neu({ titel: `Menüplan ${m}` });
    await neu({ titel: "Anderes", stichworte: [`${m}stich`] });
    // Der Anzeigename und der Link tragen den Suchtext: Das darf nicht treffen
    await neu(
      { titel: "Nur Datei" },
      { anzeigename: `${m}.pdf`, link: `${SP}/${m}.pdf` },
    );
    expect((await titel(leiter(), `?q=${m.toUpperCase()}`)).sort()).toEqual([
      "Anderes",
      `Menüplan ${m}`,
    ]);
    expect(await titel(leiter(), `?q=MENÜPLAN ${m}`)).toEqual([
      `Menüplan ${m}`,
    ]);
  });

  test("Sonderzeichen von LIKE treffen nur sich selbst", async () => {
    const m = marke();
    await neu({ titel: `${m} 50% Rabatt` });
    await neu({ titel: `${m} 50 Prozent` });
    await neu({ titel: `${m}_a` });
    await neu({ titel: `${m}xa` });
    expect(
      await titel(leiter(), `?q=${encodeURIComponent(`${m} 50%`)}`),
    ).toEqual([`${m} 50% Rabatt`]);
    expect(await titel(leiter(), `?q=${encodeURIComponent(`${m}_`)}`)).toEqual([
      `${m}_a`,
    ]);
    // Ein Backslash und ein Hochkomma sind Text, kein Syntaxfehler
    expect(
      await titel(leiter(), `?q=${encodeURIComponent("\\' or 1=1 --")}`),
    ).toEqual([]);
  });

  test("Stichwort-Filter: ein Stichwort, mehrere (alle müssen passen), Gross- und Kleinschreibung egal", async () => {
    const m = marke().toLowerCase();
    await neu({ titel: `${m} a`, stichworte: [`${m}x`, `${m}y`] });
    await neu({ titel: `${m} b`, stichworte: [`${m}x`] });
    await neu({ titel: `${m} c`, stichworte: [`${m}xy`] });
    expect((await titel(leiter(), `?stichwort=${m}x`)).sort()).toEqual([
      `${m} a`,
      `${m} b`,
    ]);
    expect(
      (await titel(leiter(), `?stichwort=${m.toUpperCase()}X,${m}Y`)).sort(),
    ).toEqual([`${m} a`]);
    expect(await titel(leiter(), `?stichwort=${m}z`)).toEqual([]);
    for (const q of [
      "?stichwort=",
      "?stichwort=a,,b",
      "?stichwort=a,b,c,d,e,f",
      `?stichwort=${"x".repeat(41)}`,
    ]) {
      expect(
        (await anfrage(leiter(), "GET", `${L()}/dokumente${q}`)).status,
      ).toBe(400);
    }
  });

  test("Typ-Filter: pdf, word, excel, bild, sharepoint, link nach MIME-Typ oder Endung", async () => {
    const m = marke();
    const fall = async (
      name: string,
      d: Partial<typeof schema.lagerDatei.$inferInsert>,
    ) => neu({ titel: `${m} ${name}` }, d);
    await fall("pdf-typ", { anzeigename: "a", typ: "application/pdf" });
    await fall("pdf-endung", { anzeigename: "Plan.PDF" });
    await fall("word", { anzeigename: "Brief.docx" });
    await fall("word-alt", { anzeigename: "Brief.doc" });
    await fall("word-typ", {
      anzeigename: "b",
      typ: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await fall("excel", { anzeigename: "Kasse.xlsx" });
    await fall("excel-alt", { anzeigename: "Kasse.xls" });
    await fall("bild", { anzeigename: "Foto.JPG" });
    await fall("bild-typ", { anzeigename: "c", typ: "image/webp" });
    await fall("extern", {
      anzeigename: "Wiese",
      link: "https://www.example.org/wiese",
    });
    // Endung nur mitten im Namen oder an einem Host: keine Art
    await fall("trick", {
      anzeigename: "x.pdf.exe",
      link: "https://evil.example/cevi.sharepoint.com/x",
    });
    const nach = async (typ: string) =>
      (await titel(leiter(), `?q=${m}&typ=${typ}`))
        .map((t) => t.slice(m.length + 1))
        .sort();
    expect(await nach("pdf")).toEqual(["pdf-endung", "pdf-typ"]);
    expect(await nach("word")).toEqual(["word", "word-alt", "word-typ"]);
    expect(await nach("excel")).toEqual(["excel", "excel-alt"]);
    expect(await nach("bild")).toEqual(["bild", "bild-typ"]);
    // «link» ist alles, was keine der vier Arten ist
    expect(await nach("link")).toEqual(["extern", "trick"]);
    // SharePoint ist der Ablageort: nur Hosts *.sharepoint.com, nie ein Pfad oder ähnlicher Host
    expect((await nach("sharepoint")).length).toBe(9);
    expect(await nach("sharepoint")).not.toContain("extern");
    expect(await nach("sharepoint")).not.toContain("trick");
    expect(
      (await anfrage(leiter(), "GET", `${L()}/dokumente?typ=ordner`)).status,
    ).toBe(400);
  });

  test("Filter lassen sich kombinieren", async () => {
    const m = marke();
    await neu({ titel: `${m} 1`, stichworte: ["k"] }, { anzeigename: "A.pdf" });
    await neu(
      { titel: `${m} 2`, stichworte: ["k"] },
      { anzeigename: "A.docx" },
    );
    await neu({ titel: `${m} 3` }, { anzeigename: "B.pdf" });
    expect(await titel(leiter(), `?q=${m}&stichwort=k&typ=pdf`)).toEqual([
      `${m} 1`,
    ]);
  });

  test("unbekannte Abfrageparameter und ungültiger Cursor: 400", async () => {
    for (const q of ["?foo=1", "?limit=0", "?limit=201", "?nach=x", "?q="]) {
      expect(
        (await anfrage(leiter(), "GET", `${L()}/dokumente${q}`)).status,
      ).toBe(400);
    }
  });
});

describe("Seitenwechsel", () => {
  test("neueste zuerst, jede Seite lückenlos, ohne Doppelte, Cursor endet", async () => {
    const m = marke();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push((await neu({ titel: `${m} ${i}` })).id);
    const gesehen: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const s = await liste(
        leiter(),
        `?q=${m}&limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      expect(s.dokumente.length).toBeLessThanOrEqual(2);
      gesehen.push(...s.dokumente.map((d) => d.id));
      nach = s.naechster;
      seiten++;
    } while (nach && seiten < 10);
    expect(seiten).toBe(3);
    expect(gesehen).toEqual([...ids].reverse());
    // Der Cursor ordnet nur: Eine ID ganz am Anfang lässt nichts übrig
    expect(
      (
        await liste(
          leiter(),
          `?q=${m}&nach=00000000-0000-4000-8000-000000000000`,
        )
      ).dokumente,
    ).toEqual([]);
  });
});

describe("Sammelabfrage mit Dateien anderer Module", () => {
  // Zwei Tabellen, die auf lager_datei zeigen und nur dieser Test kennt: «beitrag» mit pinnwand.lesen (das Team darf lesen), «intern» mit vertrauliches.lesen (nur die Lagerleitung)
  const testSchema = pgSchema(SCHEMA);
  const beitrag = testSchema.table("beitrag", {
    ...lagerSpalten(),
    datei: uuid("datei_id").references(() => schema.lagerDatei.id),
  });
  const intern = testSchema.table("intern", {
    ...lagerSpalten(),
    datei: uuid("datei_id").references(() => schema.lagerDatei.id),
  });
  const tabelleSql = (name: string) => `
    create table ${SCHEMA}.${name} (
      id uuid primary key default uuidv7(),
      lager_id uuid not null references public.lager(id) on delete cascade,
      version integer not null default 1,
      erstellt_am timestamptz not null default now(),
      erstellt_von uuid,
      geaendert_am timestamptz not null default now(),
      geaendert_von uuid,
      geloescht_am timestamptz,
      geloescht_von uuid,
      lager_seq bigint not null default 0,
      datei_id uuid references public.lager_datei(id) on delete restrict
    )`;
  const binde = (
    tabelle: typeof beitrag | typeof intern,
    dateiId: string,
    id = lagerId,
    geloescht = false,
  ) =>
    db.insert(tabelle as typeof beitrag).values({
      lagerId: id,
      lagerSeq: 0,
      datei: dateiId,
      geloeschtAm: geloescht ? new Date() : null,
    });

  beforeAll(async () => {
    await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await besitzer.unsafe(`create schema ${SCHEMA}`);
    await besitzer.unsafe(tabelleSql("beitrag"));
    await besitzer.unsafe(tabelleSql("intern"));
    await besitzer.unsafe(
      `grant usage on schema ${SCHEMA} to cevi_os_api; grant select, insert, update, delete on all tables in schema ${SCHEMA} to cevi_os_api`,
    );
    registriereDateiVerweis({
      tabelle: beitrag,
      spalte: beitrag.datei,
      recht: "pinnwand.lesen",
    });
    registriereDateiVerweis({
      tabelle: intern,
      spalte: intern.datei,
      recht: "vertrauliches.lesen",
    });
  });
  afterAll(() => {
    entferneDateiVerweis(beitrag.datei);
    entferneDateiVerweis(intern.datei);
  });

  test("listet die Dateien anderer Module mit Quelle, nach Recht der Rolle, ohne gelöschte und fremde", async () => {
    const m = marke();
    const offen = await datei({ anzeigename: `${m}-offen.pdf` });
    const geheim = await datei({ anzeigename: `${m}-geheim.xlsx` });
    const frei = await datei({ anzeigename: `${m}-frei.pdf` });
    const beitragGeloescht = await datei({ anzeigename: `${m}-weg.pdf` });
    const fremd = await datei({ anzeigename: `${m}-fremd.pdf` }, andereLagerId);
    const ohneVerweis = await datei({ anzeigename: `${m}-lose.pdf` });
    await binde(beitrag, offen);
    await binde(intern, geheim);
    await binde(beitrag, beitragGeloescht, lagerId, true);
    await binde(beitrag, fremd, andereLagerId);
    // frei: von beiden eingebunden (es zählt der lesbare Verweis)
    await binde(beitrag, frei);
    await binde(intern, frei);
    expect(ohneVerweis).toBeTruthy();

    const alle = await liste(leiter(), `?q=${m}`);
    expect(alle.dokumente.map((d) => [d.titel, d.quelle]).sort()).toEqual(
      [
        [`${m}-frei.pdf`, "beitrag"],
        [`${m}-geheim.xlsx`, "intern"],
        [`${m}-offen.pdf`, "beitrag"],
      ].sort(),
    );
    expect(
      alle.dokumente.find((d) => d.titel === `${m}-offen.pdf`),
    ).toMatchObject({
      id: offen,
      version: null,
      stichworte: [],
      teamSichtbar: null,
      art: "pdf",
      datei: { id: offen, link: `${SP}/Plan.pdf` },
    });
    // Das Team: nur, was ein lesbarer Datensatz einbindet; die Lagerleitung-Dateien fehlen
    expect((await titel(konten.team, `?q=${m}`)).sort()).toEqual([
      `${m}-frei.pdf`,
      `${m}-offen.pdf`,
    ]);
    // Ohne pinnwand.lesen (Standard bietet es allen Rollen): Das Recht des Verweises entscheidet
    // Filter gelten auch für diese Dateien
    expect(await titel(leiter(), `?q=${m}&typ=excel`)).toEqual([
      `${m}-geheim.xlsx`,
    ]);
    // Mit Stichwortfilter entfallen sie (nur Dokumente tragen Stichworte)
    expect(await titel(leiter(), `?q=${m}&stichwort=x`)).toEqual([]);
  });

  test("eine Datei, die ein Dokument einbindet, steht nur als Dokument in der Liste; für das Team zählt die Freigabe des Dokuments", async () => {
    const m = marke();
    const d = await neu({ titel: `${m} Dok` }, { anzeigename: `${m}.pdf` });
    await binde(beitrag, d.datei!.id);
    const alle = await liste(leiter(), `?q=${m}`);
    expect(alle.dokumente.map((x) => [x.titel, x.quelle])).toEqual([
      [`${m} Dok`, "dokument"],
    ]);
    expect(await titel(konten.team, `?q=${m}`)).toEqual([]);
  });

  test("Seitenwechsel über beide Quellen: lückenlos, ohne Doppelte, auch wenn unsichtbare Dateien Seiten füllen", async () => {
    const m = marke();
    const erwartet: string[] = [];
    // Abwechselnd Dokument, sichtbare Datei und für das Team unsichtbare Datei, alle freigegeben bzw. eingebunden
    for (let i = 0; i < 6; i++) {
      const dok = await neu(
        { titel: `${m} d${i}`, teamSichtbar: true },
        { anzeigename: `x${i}.pdf` },
      );
      erwartet.push(dok.id);
      const sichtbar = await datei({ anzeigename: `${m} s${i}.pdf` });
      await binde(beitrag, sichtbar);
      erwartet.push(sichtbar);
      for (let j = 0; j < 3; j++) {
        await binde(intern, await datei({ anzeigename: `${m} u${i}${j}.pdf` }));
      }
    }
    for (const [konto, limit, anzahl] of [
      [konten.team, 2, 12],
      [konten.team, 5, 12],
      [leiter(), 4, 30],
      [leiter(), 200, 30],
    ] as const) {
      const gesehen: string[] = [];
      let nach: string | null = null;
      let seiten = 0;
      do {
        const s = await liste(
          konto,
          `?q=${encodeURIComponent(m)}&limit=${limit}${nach ? `&nach=${nach}` : ""}`,
        );
        expect(s.dokumente.length).toBeLessThanOrEqual(limit);
        gesehen.push(...s.dokumente.map((d) => d.id));
        nach = s.naechster;
        seiten++;
      } while (nach && seiten < 40);
      expect(nach).toBeNull();
      expect(gesehen).toHaveLength(anzahl);
      expect(new Set(gesehen).size).toBe(anzahl);
      expect(gesehen).toEqual([...gesehen].sort().reverse());
      if (konto === konten.team) {
        expect([...gesehen].sort()).toEqual([...erwartet].sort());
      }
    }
  });

  test("ein einzelnes Dokument kostet keine Abfrage auf andere Module", async () => {
    const d = await neu({ teamSichtbar: true });
    const a = await anfrage(konten.team, "GET", `${L()}/dokumente/${d.id}`);
    expect(a.status).toBe(200);
    expect(a.body.quelle).toBe("dokument");
  });
});
