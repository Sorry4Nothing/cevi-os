import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
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
import {
  schluesselMitAntworten,
  zaehleAnmeldungen,
} from "../../src/termine/anlass-anmeldungen.js";
import { findeGesundheitsfeld } from "../../src/termine/anlass-felder.js";
import { erzeugeSeiteAusVorlage } from "../../src/website/automatik.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../../src/website/ereignisse.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { legeProgrammAn } from "../hilfen/programme.js";

// Die Seite der Anlassseite lässt sich scheitern lassen; sonst läuft die echte Funktion
vi.mock("../../src/website/automatik.js", async (original) => {
  const echt =
    await original<typeof import("../../src/website/automatik.js")>();
  return {
    ...echt,
    erzeugeSeiteAusVorlage: vi.fn(echt.erzeugeSeiteAusVorlage),
  };
});
// Anmeldungen gibt es erst mit #443: Die Tests stellen sie vor
vi.mock("../../src/termine/anlass-anmeldungen.js", () => ({
  zaehleAnmeldungen: vi.fn(async () => 0),
  schluesselMitAntworten: vi.fn(async () => new Set<string>()),
}));

bereiteAuthTestsVor();

const sql = postgres(API_URL);
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
let leitung: PersonaKonto;
let ohneFaktor: PersonaKonto;
let eltern: PersonaKonto;
let fremdeLeitung: PersonaKonto;

let ausgabe: MockInstance<typeof console.log>;
const ereignisse: WebsiteEreignis[] = [];
let abmelden: () => void;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  leitung = await legePersonaAn(welt, "admin");
  ohneFaktor = await legePersonaAn(welt, "adminOhneZweitenFaktor");
  eltern = await legePersonaAn(welt, "elternA");
  fremdeLeitung = await legePersonaAn(welt, "demoAdmin");
  abmelden = aufWebsiteEreignis((e) => void ereignisse.push(e));
});
afterAll(() => abmelden?.());
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
  ereignisse.length = 0;
});
afterEach(() => ausgabe.mockRestore());

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

const BASIS = "/api/v1/admin/anlaesse";
const feld = (werte: Record<string, unknown> = {}) => ({
  schluessel: `f${randomUUID().slice(0, 8).replace(/-/g, "")}`,
  beschriftung: "Mitbringsel",
  typ: "text",
  ...werte,
});
const anlegen = (programmId: string, werte: Record<string, unknown> = {}) =>
  anfrage(leitung, "POST", BASIS, {
    programmId,
    anmeldungFuer: "kind",
    anmeldungOffen: true,
    sichtbarkeit: { art: "angemeldet" },
    felder: [],
    ...werte,
  });
async function neuerTermin(
  werte: Parameters<typeof legeProgrammAn>[1] = {
    abteilungId: welt.testabteilungId,
  },
) {
  return (await legeProgrammAn(db, werte)).id;
}
async function neuerAnlass(werte: Record<string, unknown> = {}) {
  const termin = await neuerTermin();
  const a = await anlegen(termin, werte);
  expect(a.status).toBe(201);
  return { id: a.body.id as string, seiteId: a.body.seiteId as string, termin };
}
const anzahlSeiten = async () =>
  (
    await db
      .select({ n: count() })
      .from(schema.seite)
      .where(eq(schema.seite.abteilungId, welt.testabteilungId))
  )[0]!.n;
const anzahlAnlaesse = async () =>
  (
    await db
      .select({ n: count() })
      .from(schema.anlass)
      .where(eq(schema.anlass.abteilungId, welt.testabteilungId))
  )[0]!.n;

describe("Anlass anlegen", () => {
  test("legt Anlass, Felder und die Anlassseite als Entwurf an und meldet die Seite der Website", async () => {
    const termin = await neuerTermin({
      abteilungId: welt.testabteilungId,
      titel: "Sommerfest",
    });
    const frist = "2027-02-20T18:00:00+01:00";
    const a = await anlegen(termin, {
      anmeldungFuer: "person",
      frist,
      felder: [
        feld({ schluessel: "gruppe", beschriftung: "Gruppe", pflicht: true }),
        feld({
          schluessel: "wahl",
          beschriftung: "Essen",
          typ: "auswahl",
          optionen: ["Fleisch", "Gemüse"],
        }),
        feld({ schluessel: "ja", beschriftung: "Kommt mit?", typ: "ja_nein" }),
      ],
    });
    expect(a.status).toBe(201);
    const { id, seiteId } = a.body as { id: string; seiteId: string };

    const [zeile] = await db
      .select()
      .from(schema.anlass)
      .where(eq(schema.anlass.id, id));
    expect(zeile).toMatchObject({
      abteilungId: welt.testabteilungId,
      programmId: termin,
      art: "anlass",
      anmeldungOffen: true,
      anmeldungFuer: "person",
      sichtbarkeit: "angemeldet",
      sichtbarkeitTags: [],
      seiteId,
    });
    expect(zeile!.frist!.toISOString()).toBe("2027-02-20T17:00:00.000Z");
    expect(zeile!.erstelltVon).toBe(leitung.id);

    const [seite] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, seiteId));
    expect(seite).toMatchObject({
      abteilungId: welt.testabteilungId,
      titel: "Sommerfest",
      sichtbarkeit: "angemeldet",
      veroeffentlichteVersionId: null,
    });
    expect(seite!.entwurf).not.toBeNull();

    const felder = await db
      .select()
      .from(schema.anlassFeld)
      .where(eq(schema.anlassFeld.anlassId, id))
      .orderBy(schema.anlassFeld.reihenfolge);
    expect(
      felder.map((f) => [f.schluessel, f.typ, f.pflicht, f.reihenfolge]),
    ).toEqual([
      ["gruppe", "text", true, 0],
      ["wahl", "auswahl", false, 1],
      ["ja", "ja_nein", false, 2],
    ]);
    expect(felder[1]!.optionen).toEqual(["Fleisch", "Gemüse"]);

    // Genau ein Ereignis, nach dem Commit
    expect(ereignisse).toEqual([
      {
        art: "seite_geaendert",
        abteilungId: welt.testabteilungId,
        seiteId,
      },
    ]);
    // Das Audit-Log nennt Kennungen, nie den Titel
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(eintrag).toMatchObject({
      aktion: "anlass_angelegt",
      akteurId: leitung.id,
      details: { programmId: termin, seiteId, felder: 3 },
    });
  });

  test("Sichtbarkeit nach Tags: eigene Tags gehen, ein fremder Tag ist 400 und legt nichts an", async () => {
    const vorher = await anzahlAnlaesse();
    const gut = await anlegen(await neuerTermin(), {
      sichtbarkeit: { art: "tags", tagIds: [welt.stufeAId] },
    });
    expect(gut.status).toBe(201);
    const [zeile] = await db
      .select()
      .from(schema.anlass)
      .where(eq(schema.anlass.id, gut.body.id));
    expect(zeile).toMatchObject({
      sichtbarkeit: "tags",
      sichtbarkeitTags: [welt.stufeAId],
    });
    const seiten = await anzahlSeiten();
    const fremd = await anlegen(await neuerTermin(), {
      sichtbarkeit: { art: "tags", tagIds: [welt.demoStufeId] },
    });
    expect(fremd.status).toBe(400);
    expect(fremd.body.code).toBe("TAG_UNBEKANNT");
    expect(await anzahlAnlaesse()).toBe(vorher + 1);
    expect(await anzahlSeiten()).toBe(seiten);
  });

  test("ein zweiter Aufruf für denselben Termin ist 409 und legt keine zweite Seite an", async () => {
    const { termin } = await neuerAnlass();
    const seiten = await anzahlSeiten();
    const noch = await anlegen(termin);
    expect(noch.status).toBe(409);
    expect(noch.body.code).toBe("ANLASS_VORHANDEN");
    expect(await anzahlSeiten()).toBe(seiten);
    expect(ereignisse).toHaveLength(1);
  });

  test("scheitert die Seite, bleibt kein Anlass und keine Seite zurück", async () => {
    const termin = await neuerTermin();
    const seiten = await anzahlSeiten();
    const anlaesse = await anzahlAnlaesse();
    // Die Seite entsteht in der Transaktion und scheitert erst danach: Alles muss zurückgerollt werden
    vi.mocked(erzeugeSeiteAusVorlage).mockImplementationOnce(async (tx, o) => {
      const echt = await vi
        .importActual<typeof import("../../src/website/automatik.js")>(
          "../../src/website/automatik.js",
        )
        .then((m) => m.erzeugeSeiteAusVorlage(tx, o));
      expect(echt.neu).toBe(true);
      throw new Error("Seite scheitert");
    });
    const a = await anlegen(termin, { felder: [feld()] });
    expect(a.status).toBe(500);
    expect(await anzahlSeiten()).toBe(seiten);
    expect(await anzahlAnlaesse()).toBe(anlaesse);
    expect(ereignisse).toEqual([]);
    // Ein neuer Versuch gelingt
    expect((await anlegen(termin)).status).toBe(201);
  });

  test("fremder oder unbekannter Termin 404, andere Rollen 403, Termin vorbei 409", async () => {
    const eigener = await neuerTermin();
    const fremder = await neuerTermin({ abteilungId: welt.demoAbteilungId });
    const vorher = await anzahlAnlaesse();
    expect((await anlegen(fremder)).status).toBe(404);
    expect((await anlegen(randomUUID())).status).toBe(404);
    // Die Abteilungsleitung der anderen Abteilung kennt unseren Termin nicht
    const ausFremder = await anfrage(fremdeLeitung, "POST", BASIS, {
      programmId: eigener,
      anmeldungFuer: "kind",
      anmeldungOffen: true,
      sichtbarkeit: { art: "angemeldet" },
    });
    expect(ausFremder.status).toBe(404);
    for (const konto of [eltern, ohneFaktor]) {
      const a = await anfrage(konto, "POST", BASIS, {
        programmId: eigener,
        anmeldungFuer: "kind",
        anmeldungOffen: true,
        sichtbarkeit: { art: "angemeldet" },
      });
      expect(a.status).toBe(403);
    }
    const vorbei = await anlegen(
      await neuerTermin({
        abteilungId: welt.testabteilungId,
        beginn: new Date("2020-05-01T10:00:00Z"),
      }),
    );
    expect(vorbei.status).toBe(409);
    expect(vorbei.body.code).toBe("TERMIN_VORBEI");
    const ganztaegig = await anlegen(
      await neuerTermin({
        abteilungId: welt.testabteilungId,
        tagVon: "2020-05-01",
        tagBis: "2020-05-02",
      }),
    );
    expect(ganztaegig.status).toBe(409);
    expect(await anzahlAnlaesse()).toBe(vorher);
  });
});

describe("Feldvalidierung", () => {
  const sechsundzwanzig = (n: number) =>
    Array.from({ length: n }, (_, i) => `Option ${i}`);
  const faelle: [string, Record<string, unknown>][] = [
    ["Schlüssel mit Grossbuchstaben", feld({ schluessel: "Gruppe" })],
    ["Schlüssel mit Bindestrich", feld({ schluessel: "a-b" })],
    ["Schlüssel zu lang", feld({ schluessel: "a".repeat(41) })],
    ["leere Beschriftung", feld({ beschriftung: "  " })],
    ["Beschriftung zu lang", feld({ beschriftung: "x".repeat(101) })],
    ["unbekannter Typ", feld({ typ: "zahl" })],
    ["unbekanntes Feld im Feld", feld({ extra: 1 })],
    ["Auswahl ohne Optionen", feld({ typ: "auswahl" })],
    ["Auswahl mit einer Option", feld({ typ: "auswahl", optionen: ["Eine"] })],
    [
      "Auswahl mit 21 Optionen",
      feld({ typ: "auswahl", optionen: sechsundzwanzig(21) }),
    ],
    [
      "Auswahl mit doppelter Option",
      feld({ typ: "auswahl", optionen: ["A", "A"] }),
    ],
    [
      "Option zu lang",
      feld({ typ: "auswahl", optionen: ["A", "x".repeat(101)] }),
    ],
    ["Text mit Optionen", feld({ optionen: ["A", "B"] })],
    ["Pflicht kein Wahrheitswert", feld({ pflicht: "ja" })],
  ];

  test.each(faelle)("%s ist 400 und legt nichts an", async (_name, f) => {
    const vorher = await anzahlAnlaesse();
    const seiten = await anzahlSeiten();
    const a = await anlegen(await neuerTermin(), { felder: [f] });
    expect(a.status).toBe(400);
    expect(await anzahlAnlaesse()).toBe(vorher);
    expect(await anzahlSeiten()).toBe(seiten);
  });

  test("mehr als 20 Felder und doppelte Schlüssel sind 400, genau 20 gehen", async () => {
    const viele = (n: number) =>
      Array.from({ length: n }, (_, i) => feld({ schluessel: `f${i}` }));
    expect(
      (await anlegen(await neuerTermin(), { felder: viele(21) })).status,
    ).toBe(400);
    expect(
      (
        await anlegen(await neuerTermin(), {
          felder: [feld({ schluessel: "a" }), feld({ schluessel: "a" })],
        })
      ).status,
    ).toBe(400);
    expect(
      (await anlegen(await neuerTermin(), { felder: viele(20) })).status,
    ).toBe(201);
  });

  test("Felder nach Gesundheitsdaten sind 400 mit eigenem Code, auch in den Optionen", async () => {
    for (const f of [
      feld({ beschriftung: "Hat dein Kind eine Allergie?" }),
      feld({ beschriftung: "UNVERTRÄGLICHKEITEN" }),
      feld({
        typ: "auswahl",
        beschriftung: "Bemerkung",
        optionen: ["Keine", "Medikamente nötig"],
      }),
    ]) {
      const a = await anlegen(await neuerTermin(), { felder: [f] });
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("FELD_GESUNDHEIT");
    }
  });

  test("die Sperrliste lässt gewöhnliche Fragen durch", () => {
    for (const beschriftung of [
      "Schlafsack mitgebracht?",
      "Ernährung",
      "Kommt mit dem Velo",
      "T-Shirt-Grösse",
    ]) {
      expect(
        findeGesundheitsfeld([
          {
            schluessel: "a",
            beschriftung,
            typ: "text",
            optionen: [],
            pflicht: false,
            ceviQuelle: null,
          },
        ]),
      ).toBeNull();
    }
  });
});

describe("Liste und Detail", () => {
  test("die Liste zählt die Rückmeldungen je Anlass in derselben Abfrage", async () => {
    const mit = await neuerAnlass();
    const ohne = await neuerAnlass();
    await db.insert(schema.anlassAnmeldung).values([
      { anlassId: mit.id, userId: eltern.id as string, status: "angemeldet" },
      { anlassId: mit.id, userId: leitung.id as string, status: "abgemeldet" },
    ]);
    const antwort = await anfrage(leitung, "GET", `${BASIS}?limit=10`);
    const nach = (id: string) =>
      antwort.body.anlaesse.find((x: { id: string }) => x.id === id);
    expect(nach(mit.id).anmeldungen).toEqual({ angemeldet: 1, abgemeldet: 1 });
    expect(nach(ohne.id).anmeldungen).toEqual({ angemeldet: 0, abgemeldet: 0 });
  });

  test("die Liste teilt in Seiten, zeigt nur die eigene Abteilung und zählt die Felder", async () => {
    const a = await neuerAnlass({ felder: [feld(), feld()] });
    const b = await neuerAnlass();
    const c = await neuerAnlass();
    const erste = await anfrage(leitung, "GET", `${BASIS}?limit=2`);
    expect(erste.status).toBe(200);
    expect(erste.body.anlaesse.map((x: { id: string }) => x.id)).toEqual([
      c.id,
      b.id,
    ]);
    expect(erste.body.weitere).toBe(true);
    expect(erste.body.naechste).toBe(b.id);
    const zweite = await anfrage(
      leitung,
      "GET",
      `${BASIS}?limit=2&nach=${erste.body.naechste}`,
    );
    expect(zweite.body.anlaesse[0]).toMatchObject({
      id: a.id,
      anzahlFelder: 2,
      art: "anlass",
      sichtbarkeit: { art: "angemeldet" },
      titel: "Testprogramm",
    });
    expect(
      zweite.body.anlaesse.every((x: { id: string }) => x.id !== c.id),
    ).toBe(true);

    // Die andere Abteilung sieht keinen davon
    const fremd = await anfrage(fremdeLeitung, "GET", BASIS);
    expect(fremd.status).toBe(200);
    expect(fremd.body.anlaesse).toEqual([]);
    expect(fremd.body.naechste).toBeNull();
    for (const q of ["?limit=0", "?limit=101", "?nach=x", "?foo=1"]) {
      expect((await anfrage(leitung, "GET", `${BASIS}${q}`)).status).toBe(400);
    }
    expect((await anfrage(eltern, "GET", BASIS)).status).toBe(403);
  });

  test("das Detail liefert den Anlass mit den Feldern in der Reihenfolge; fremd 404, andere Rollen 403", async () => {
    const { id } = await neuerAnlass({
      felder: [
        feld({ schluessel: "b", beschriftung: "Zweites" }),
        feld({
          schluessel: "a",
          beschriftung: "Erstes",
          typ: "auswahl",
          optionen: ["X", "Y"],
          pflicht: true,
        }),
      ],
    });
    const d = await anfrage(leitung, "GET", `${BASIS}/${id}`);
    expect(d.status).toBe(200);
    expect(d.body.felder).toEqual([
      {
        schluessel: "b",
        beschriftung: "Zweites",
        typ: "text",
        optionen: [],
        pflicht: false,
        ceviQuelle: null,
        reihenfolge: 0,
      },
      {
        schluessel: "a",
        beschriftung: "Erstes",
        typ: "auswahl",
        optionen: ["X", "Y"],
        pflicht: true,
        ceviQuelle: null,
        reihenfolge: 1,
      },
    ]);
    expect(d.body).not.toHaveProperty("feld");
    // Ein Anlass ohne Felder hat eine leere Liste
    const leer = await neuerAnlass();
    expect(
      (await anfrage(leitung, "GET", `${BASIS}/${leer.id}`)).body.felder,
    ).toEqual([]);
    expect((await anfrage(fremdeLeitung, "GET", `${BASIS}/${id}`)).status).toBe(
      404,
    );
    expect(
      (await anfrage(leitung, "GET", `${BASIS}/${randomUUID()}`)).status,
    ).toBe(404);
    expect((await anfrage(leitung, "GET", `${BASIS}/kein-uuid`)).status).toBe(
      400,
    );
    expect((await anfrage(eltern, "GET", `${BASIS}/${id}`)).status).toBe(403);
    expect((await anfrage(ohneFaktor, "GET", `${BASIS}/${id}`)).status).toBe(
      403,
    );
  });
});

describe("Ändern", () => {
  test("setzt Anmeldung, Frist und Sichtbarkeit; frist null löscht, ein leerer Körper ändert nichts", async () => {
    const { id } = await neuerAnlass({ frist: "2027-01-01T10:00:00Z" });
    const p = (body: Record<string, unknown>) =>
      anfrage(leitung, "PATCH", `${BASIS}/${id}`, body);
    expect((await p({ anmeldungOffen: false })).status).toBe(204);
    expect((await p({ frist: null })).status).toBe(204);
    expect(
      (await p({ sichtbarkeit: { art: "tags", tagIds: [welt.stufeBId] } }))
        .status,
    ).toBe(204);
    expect((await p({})).status).toBe(204);
    const d = (await anfrage(leitung, "GET", `${BASIS}/${id}`)).body;
    expect(d).toMatchObject({
      anmeldungOffen: false,
      frist: null,
      sichtbarkeit: { art: "tags", tagIds: [welt.stufeBId] },
      anmeldungFuer: "kind",
    });
    expect((await p({ anmeldungFuer: "person" })).status).toBe(204);
    expect((await p({ frist: "2027-03-01T10:00:00Z" })).status).toBe(204);
    const d2 = (await anfrage(leitung, "GET", `${BASIS}/${id}`)).body;
    expect(d2).toMatchObject({
      anmeldungFuer: "person",
      frist: "2027-03-01T10:00:00.000Z",
    });
  });

  test("ungültige Eingabe 400, fremder Tag 400, fremder Anlass 404, andere Rollen 403", async () => {
    const { id } = await neuerAnlass();
    const p = (konto: PersonaKonto, body: Record<string, unknown>) =>
      anfrage(konto, "PATCH", `${BASIS}/${id}`, body);
    expect((await p(leitung, { art: "lager" })).status).toBe(400);
    expect((await p(leitung, { frist: "morgen" })).status).toBe(400);
    expect((await p(leitung, { anmeldungFuer: "alle" })).status).toBe(400);
    const fremderTag = await p(leitung, {
      sichtbarkeit: { art: "tags", tagIds: [welt.demoStufeId] },
    });
    expect(fremderTag.status).toBe(400);
    expect(fremderTag.body.code).toBe("TAG_UNBEKANNT");
    expect((await p(fremdeLeitung, { anmeldungOffen: false })).status).toBe(
      404,
    );
    expect((await p(eltern, { anmeldungOffen: false })).status).toBe(403);
  });

  test("anmeldungFuer lässt sich mit Anmeldungen nicht ändern, derselbe Wert schon", async () => {
    const { id } = await neuerAnlass();
    vi.mocked(zaehleAnmeldungen).mockResolvedValue(3);
    try {
      const geaendert = await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {
        anmeldungFuer: "person",
      });
      expect(geaendert.status).toBe(409);
      expect(geaendert.body.code).toBe("ANMELDUNGEN_VORHANDEN");
      expect(
        (
          await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {
            anmeldungFuer: "kind",
            anmeldungOffen: false,
          })
        ).status,
      ).toBe(204);
    } finally {
      vi.mocked(zaehleAnmeldungen).mockResolvedValue(0);
    }
    const d = (await anfrage(leitung, "GET", `${BASIS}/${id}`)).body;
    expect(d).toMatchObject({ anmeldungFuer: "kind", anmeldungOffen: false });
  });
});

describe("Felder ersetzen", () => {
  const put = (id: string, felder: unknown[], konto = leitung) =>
    anfrage(konto, "PUT", `${BASIS}/${id}/felder`, { felder });
  const schluessel = async (id: string) =>
    (await anfrage(leitung, "GET", `${BASIS}/${id}`)).body.felder.map(
      (f: { schluessel: string }) => f.schluessel,
    );

  test("ersetzt die ganze Liste: hinzufügen, ändern, umordnen, entfernen, leeren", async () => {
    const { id } = await neuerAnlass({
      felder: [
        feld({ schluessel: "a", beschriftung: "A" }),
        feld({ schluessel: "b", beschriftung: "B" }),
        feld({ schluessel: "c", beschriftung: "C" }),
      ],
    });
    const r = await put(id, [
      feld({ schluessel: "c", beschriftung: "C neu", pflicht: true }),
      feld({
        schluessel: "d",
        beschriftung: "D",
        typ: "auswahl",
        optionen: ["1", "2"],
      }),
      feld({ schluessel: "a", beschriftung: "A" }),
    ]);
    expect(r.status).toBe(200);
    expect(
      r.body.felder.map((f: { schluessel: string; reihenfolge: number }) => [
        f.schluessel,
        f.reihenfolge,
      ]),
    ).toEqual([
      ["c", 0],
      ["d", 1],
      ["a", 2],
    ]);
    const d = (await anfrage(leitung, "GET", `${BASIS}/${id}`)).body.felder;
    expect(d.map((f: { schluessel: string }) => f.schluessel)).toEqual([
      "c",
      "d",
      "a",
    ]);
    expect(d[0]).toMatchObject({ beschriftung: "C neu", pflicht: true });
    // «b» ist weg, die Liste zählt keine alten Zeilen
    expect(
      await db
        .select({ n: count() })
        .from(schema.anlassFeld)
        .where(eq(schema.anlassFeld.anlassId, id)),
    ).toEqual([{ n: 3 }]);
    // Ein Typwechsel ohne Antworten geht
    expect(
      (await put(id, [feld({ schluessel: "c", typ: "ja_nein" })])).status,
    ).toBe(200);
    expect((await put(id, [])).status).toBe(200);
    expect(await schluessel(id)).toEqual([]);
  });

  test("Felder mit Antworten behalten Schlüssel und Typ; sonst 409 und die Liste bleibt, wie sie war", async () => {
    const { id } = await neuerAnlass({
      felder: [
        feld({ schluessel: "a", beschriftung: "A" }),
        feld({ schluessel: "b", beschriftung: "B", typ: "ja_nein" }),
      ],
    });
    vi.mocked(schluesselMitAntworten).mockResolvedValue(new Set(["a", "b"]));
    try {
      // Entfernen
      const weg = await put(id, [feld({ schluessel: "a", beschriftung: "A" })]);
      expect(weg.status).toBe(409);
      expect(weg.body).toMatchObject({
        code: "FELD_IN_BENUTZUNG",
        schluessel: ["b"],
      });
      // Typ ändern
      const typ = await put(id, [
        feld({ schluessel: "a", typ: "ja_nein" }),
        feld({ schluessel: "b", typ: "ja_nein" }),
      ]);
      expect(typ.status).toBe(409);
      expect(typ.body.schluessel).toEqual(["a"]);
      expect(await schluessel(id)).toEqual(["a", "b"]);
      // Beschriftung, Pflicht und Reihenfolge dürfen sich ändern, neue Felder dazukommen
      const ok = await put(id, [
        feld({ schluessel: "b", beschriftung: "B anders", typ: "ja_nein" }),
        feld({ schluessel: "a", beschriftung: "A anders", pflicht: true }),
        feld({ schluessel: "neu", beschriftung: "Neu" }),
      ]);
      expect(ok.status).toBe(200);
    } finally {
      vi.mocked(schluesselMitAntworten).mockResolvedValue(new Set());
    }
    expect(await schluessel(id)).toEqual(["b", "a", "neu"]);
  });

  test("ungültige Felder 400, Gesundheitsfelder 400, fremd 404, andere Rollen 403", async () => {
    const { id } = await neuerAnlass({ felder: [feld({ schluessel: "a" })] });
    expect((await put(id, [feld({ schluessel: "Gross" })])).status).toBe(400);
    expect(
      (await anfrage(leitung, "PUT", `${BASIS}/${id}/felder`, {})).status,
    ).toBe(400);
    const g = await put(id, [feld({ beschriftung: "Medikamente" })]);
    expect(g.status).toBe(400);
    expect(g.body.code).toBe("FELD_GESUNDHEIT");
    expect((await put(id, [], fremdeLeitung)).status).toBe(404);
    expect((await put(id, [], eltern)).status).toBe(403);
    expect(await schluessel(id)).toEqual(["a"]);
  });
});

describe("Löschen", () => {
  test("löscht Anlass und Felder, die Anlassseite bleibt", async () => {
    const { id, seiteId } = await neuerAnlass({ felder: [feld(), feld()] });
    expect((await anfrage(leitung, "DELETE", `${BASIS}/${id}`)).status).toBe(
      204,
    );
    expect(
      await db.select().from(schema.anlass).where(eq(schema.anlass.id, id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.anlassFeld)
        .where(eq(schema.anlassFeld.anlassId, id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.seite).where(eq(schema.seite.id, seiteId)),
    ).toHaveLength(1);
    expect((await anfrage(leitung, "DELETE", `${BASIS}/${id}`)).status).toBe(
      404,
    );
  });

  test("mit Anmeldungen 409, fremd 404, andere Rollen 403", async () => {
    const { id } = await neuerAnlass({ felder: [feld()] });
    expect(
      (await anfrage(fremdeLeitung, "DELETE", `${BASIS}/${id}`)).status,
    ).toBe(404);
    expect((await anfrage(eltern, "DELETE", `${BASIS}/${id}`)).status).toBe(
      403,
    );
    vi.mocked(zaehleAnmeldungen).mockResolvedValue(1);
    try {
      const a = await anfrage(leitung, "DELETE", `${BASIS}/${id}`);
      expect(a.status).toBe(409);
      expect(a.body.code).toBe("ANMELDUNGEN_VORHANDEN");
    } finally {
      vi.mocked(zaehleAnmeldungen).mockResolvedValue(0);
    }
    const d = await anfrage(leitung, "GET", `${BASIS}/${id}`);
    expect(d.status).toBe(200);
    expect(d.body.felder).toHaveLength(1);
  });
});
