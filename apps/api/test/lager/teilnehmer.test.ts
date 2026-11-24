import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
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
import { loescheAlteTeilnehmende } from "../../src/lager/teilnehmer.js";
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
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let andereLagerId: string;
let fremdLagerId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
  bis = "2027-07-24",
) {
  const von = bis < "2027-07-10" ? "2020-01-01" : "2027-07-10";
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Teilnehmerlager",
      von,
      bis,
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
  andereLagerId = await legeLager(welt.testabteilungId);
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  for (const id of [lagerId, geschlossenId, andereLagerId]) {
    await mitgliederEintragen(id);
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
// Jeder Test arbeitet in einem frischen Lager, damit Zähler und Listen nicht von anderen Tests abhängen
async function frischesLager() {
  const id = await legeLager(welt.testabteilungId);
  await mitgliederEintragen(id);
  return id;
}
async function neu(
  werte: Record<string, unknown> = {},
  id = lagerId,
  konto = leiter(),
) {
  const a = await anfrage(konto, "POST", `${L(id)}/teilnehmer`, {
    vorname: "Anna",
    nachname: "Muster",
    stufe: "Wolf",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    vorname: string;
    nachname: string;
    stufe: string | null;
    ceviName?: string | null;
  };
}
const importiere = (
  text: string,
  uebernehmen: boolean,
  id = lagerId,
  konto = leiter(),
) =>
  anfrage(konto, "POST", `${L(id)}/teilnehmer/import`, { text, uebernehmen });
const zaehle = async (id: string) =>
  (
    await db
      .select()
      .from(schema.teilnehmer)
      .where(eq(schema.teilnehmer.lagerId, id))
  ).length;
const feed = async (id: string, tabelle: string) =>
  db
    .select()
    .from(schema.lagerAenderung)
    .where(
      and(
        eq(schema.lagerAenderung.lagerId, id),
        eq(schema.lagerAenderung.tabelle, tabelle),
      ),
    )
    .orderBy(asc(schema.lagerAenderung.seq));

describe("Rechte je Lager-Persona", () => {
  // Lesen: jede Rolle mit teilnehmer.lesen (alle vier Lager-Rollen). Schreiben und Import: nur Lagerleitung und Abteilungsleitung
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
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });
  // Abzählen: Lagerleitung, Abteilungsleitung, Leitung und Team; Lesen nicht
  const abzaehlen = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: erfolg,
    team: erfolg,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });

  test.each(LAGER_PERSONAS)("%s: Liste und Abzählliste lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", `${L()}/teilnehmer`)).status).toBe(
      lesen[p],
    );
    expect((await anfrage(konten[p], "GET", `${L()}/abzaehlen`)).status).toBe(
      lesen[p],
    );
  });

  test.each(LAGER_PERSONAS)("%s: erfassen und importieren", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/teilnehmer`, {
      vorname: "Rolle",
      nachname: p,
    });
    expect(a.status).toBe(schreiben(201)[p]);
    const i = await importiere("Import;Rolle", false, lagerId, konten[p]);
    expect(i.status).toBe(schreiben(200)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: ändern und löschen", async (p) => {
    const t = await neu();
    const g = await anfrage(konten[p], "GET", `${L()}/teilnehmer/${t.id}`);
    expect(g.status).toBe(lesen[p]);
    const a = await anfrage(konten[p], "PATCH", `${L()}/teilnehmer/${t.id}`, {
      version: t.version,
      stufe: "Biber",
    });
    expect(a.status).toBe(schreiben(200)[p]);
    const bleibt = a.status === 200 ? t.version + 1 : t.version;
    const d = await anfrage(
      konten[p],
      "DELETE",
      `${L()}/teilnehmer/${t.id}?version=${bleibt}`,
    );
    expect(d.status).toBe(schreiben(204)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: abhaken und zurücksetzen", async (p) => {
    const t = await neu();
    const a = await anfrage(konten[p], "PUT", `${L()}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [t.id],
    });
    expect(a.status).toBe(abzaehlen(200)[p]);
    const z = await anfrage(
      konten[p],
      "POST",
      `${L()}/abzaehlen/zuruecksetzen`,
      { bestaetigt: true },
    );
    expect(z.status).toBe(abzaehlen(200)[p]);
  });

  test("geschlossenes Lager: nichts schreiben, lesen geht", async () => {
    const t = await db
      .insert(schema.teilnehmer)
      .values({
        lagerId: geschlossenId,
        vorname: "Zu",
        nachname: "Spät",
        lagerSeq: 0,
      })
      .returning({ id: schema.teilnehmer.id });
    const id = t[0]!.id;
    for (const p of ["lagerleitung", "team"] as const) {
      expect(
        (await anfrage(konten[p], "GET", `${L(geschlossenId)}/teilnehmer`))
          .status,
      ).toBe(200);
    }
    const stand = [
      ["POST", `/teilnehmer`, { vorname: "A", nachname: "B" }],
      ["PATCH", `/teilnehmer/${id}`, { version: 1, stufe: "X" }],
      ["DELETE", `/teilnehmer/${id}?version=1`, undefined],
      ["POST", `/teilnehmer/import`, { text: "A;B", uebernehmen: true }],
      ["PUT", `/abzaehlen`, { geprueft: true, teilnehmerIds: [id] }],
      ["POST", `/abzaehlen/zuruecksetzen`, { bestaetigt: true }],
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
    expect(await zaehle(geschlossenId)).toBe(1);
  });

  test("fremdes Lager: Teilnehmende sind unbekannt, auch für die Lagerleitung dort", async () => {
    await db.insert(schema.lagerMitglied).values({
      lagerId: fremdLagerId,
      personId: konten.fremdeAbteilung.id!,
      rolle: "lagerleitung",
    });
    const t = await neu();
    // Ein Teilnehmender dieses Lagers über ein anderes Lager der Abteilung
    expect(
      (await anfrage(leiter(), "GET", `${L(andereLagerId)}/teilnehmer/${t.id}`))
        .status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          leiter(),
          "PATCH",
          `${L(andereLagerId)}/teilnehmer/${t.id}`,
          {
            version: t.version,
            stufe: "X",
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PUT", `${L(andereLagerId)}/abzaehlen`, {
          geprueft: true,
          teilnehmerIds: [t.id],
        })
      ).status,
    ).toBe(404);
    // Das fremde Lager für die fremde Lagerleitung: 404 für alles
    expect(
      (await anfrage(konten.fremdeAbteilung, "GET", `${L()}/teilnehmer`))
        .status,
    ).toBe(404);
  });
});

describe("Datenschutz: keine Gesundheitsdaten", () => {
  test("die Tabelle hat nur Name, Stufe und Verknüpfungen, kein Gesundheitsfeld", () => {
    expect(Object.keys(getTableColumns(schema.teilnehmer)).sort()).toEqual(
      [
        "abgewaehlt",
        "anmeldungId",
        "ceviName",
        "erstelltAm",
        "erstelltVon",
        "geaendertAm",
        "geaendertVon",
        "id",
        "kindId",
        "lagerId",
        "lagerSeq",
        "nachname",
        "stufe",
        "version",
        "vorname",
      ].sort(),
    );
  });

  test.each([
    "gesundheit",
    "allergien",
    "krankheiten",
    "medikamente",
    "ernaehrung",
    "telefon",
    "adresse",
    "email",
    "geburtstag",
    "kindId",
    "anmeldungId",
    "lagerId",
    "version",
    "unbekannt",
  ])("unbekanntes Feld «%s» wird beim Erfassen abgelehnt", async (feld) => {
    const a = await anfrage(leiter(), "POST", `${L()}/teilnehmer`, {
      vorname: "Anna",
      nachname: "Muster",
      [feld]: "x",
    });
    expect(a.status).toBe(400);
  });

  test("unbekannte Felder werden beim Ändern und Abzählen abgelehnt", async () => {
    const t = await neu();
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L()}/teilnehmer/${t.id}`, {
          version: t.version,
          allergien: "Nüsse",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "PUT", `${L()}/abzaehlen`, {
          geprueft: true,
          teilnehmerIds: [t.id],
          notiz: "krank",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "POST", `${L()}/teilnehmer/import`, {
          text: "A;B",
          uebernehmen: false,
          gesundheit: true,
        })
      ).status,
    ).toBe(400);
  });

  test("das Team sieht Vorname, Nachname und Stufe, die Lagerleitung zusätzlich den Cevi-Namen", async () => {
    const id = await frischesLager();
    const t = await neu({ ceviName: "Balu" }, id);
    expect(t.ceviName).toBe("Balu");
    const team = await anfrage(konten.team, "GET", `${L(id)}/teilnehmer`);
    expect(team.body.teilnehmer).toEqual([
      {
        id: t.id,
        version: 1,
        vorname: "Anna",
        nachname: "Muster",
        stufe: "Wolf",
        abgewaehlt: false,
      },
    ]);
    const einzeln = await anfrage(
      konten.lesen,
      "GET",
      `${L(id)}/teilnehmer/${t.id}`,
    );
    expect(Object.keys(einzeln.body).sort()).toEqual(
      ["abgewaehlt", "id", "nachname", "stufe", "version", "vorname"].sort(),
    );
    const leitung = await anfrage(leiter(), "GET", `${L(id)}/teilnehmer`);
    expect(leitung.body.teilnehmer[0].ceviName).toBe("Balu");
    // Die Abzählliste zeigt dem Team ebenfalls nur Name und Stufe
    const abz = await anfrage(konten.team, "GET", `${L(id)}/abzaehlen`);
    expect(Object.keys(abz.body.eintraege[0]).sort()).toEqual(
      [
        "geprueft",
        "geprueftAm",
        "id",
        "nachname",
        "stufe",
        "teilnehmerId",
        "vorname",
      ].sort(),
    );
  });
});

describe("Erfassen, ändern, löschen", () => {
  test("Eingaben werden bereinigt: Leerraum, Umlaute in NFC, Länge", async () => {
    const id = await frischesLager();
    const t = await neu(
      {
        vorname: "  Zoë  ",
        nachname: "Müller   von  Allmen",
        stufe: " Pfadi ",
      },
      id,
    );
    expect(t.vorname).toBe("Zoë");
    expect(t.nachname).toBe("Müller von Allmen");
    expect(t.stufe).toBe("Pfadi");
    for (const werte of [
      { vorname: "" },
      { nachname: "   " },
      { vorname: "x".repeat(101) },
      { stufe: "x".repeat(51) },
      { ceviName: "x".repeat(51) },
      { vorname: "A\u0000B" },
      { vorname: 5 },
    ]) {
      const a = await anfrage(leiter(), "POST", `${L(id)}/teilnehmer`, {
        vorname: "Anna",
        nachname: "Muster",
        ...werte,
      });
      expect(a.status, JSON.stringify(werte)).toBe(400);
    }
    // Stufe und Cevi-Name sind freiwillig
    const ohne = await anfrage(leiter(), "POST", `${L(id)}/teilnehmer`, {
      vorname: "Nur",
      nachname: "Name",
    });
    expect(ohne.status).toBe(201);
    expect(ohne.body.stufe).toBeNull();
  });

  test("ändern zählt die Version hoch, veraltete Version gibt 409 mit aktuellem Stand", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    const a = await anfrage(leiter(), "PATCH", `${L(id)}/teilnehmer/${t.id}`, {
      version: 1,
      stufe: "Biber",
      ceviName: null,
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      version: 2,
      stufe: "Biber",
      ceviName: null,
    });
    const k = await anfrage(leiter(), "PATCH", `${L(id)}/teilnehmer/${t.id}`, {
      version: 1,
      nachname: "Anders",
    });
    expect(k.status).toBe(409);
    expect(k.body.code).toBe("VERSION_KONFLIKT");
    expect(k.body.aktuell).toMatchObject({ version: 2, nachname: "Muster" });
    expect(k.body.abweichend).toEqual(["nachname"]);
    // Ein PATCH ohne Änderung ist ungültig
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(id)}/teilnehmer/${t.id}`, {
          version: 2,
        })
      ).status,
    ).toBe(400);
  });

  test("löschen ist endgültig: weg aus Liste, Abzählen und Tabelle, Feed meldet «geloescht»", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    await anfrage(leiter(), "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [t.id],
    });
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/teilnehmer/${t.id}?version=1`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/teilnehmer`)).body.teilnehmer,
    ).toEqual([]);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/teilnehmer/${t.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/abzaehlen`)).body,
    ).toMatchObject({ eintraege: [], da: 0, gesamt: 0 });
    // Das Löschen mit alter Version und das zweite Löschen
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/teilnehmer/${t.id}?version=1`,
        )
      ).status,
    ).toBe(404);
    const zeile = await db
      .select()
      .from(schema.teilnehmer)
      .where(eq(schema.teilnehmer.id, t.id));
    expect(zeile).toHaveLength(0);
    const art = (await feed(id, "teilnehmer")).map((e) => e.art);
    expect(art).toEqual(["neu", "geloescht"]);
  });

  test("Liste: Seitenwechsel nach Name, Filter nach Stufe ohne Gross- und Kleinschreibung", async () => {
    const id = await frischesLager();
    const namen = ["Zeller", "Ammann", "Bühler", "Äbi", "Berger"];
    for (const [i, n] of namen.entries()) {
      await neu(
        { nachname: n, vorname: "K", stufe: i % 2 ? "Wolf" : "Pfadi" },
        id,
      );
    }
    const seite1 = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/teilnehmer?limit=2`,
    );
    expect(seite1.body.teilnehmer).toHaveLength(2);
    expect(seite1.body.naechster).toBe(seite1.body.teilnehmer[1].id);
    const alle = [...seite1.body.teilnehmer];
    let nach = seite1.body.naechster as string | null;
    while (nach) {
      const s = await anfrage(
        leiter(),
        "GET",
        `${L(id)}/teilnehmer?limit=2&nach=${nach}`,
      );
      alle.push(...s.body.teilnehmer);
      nach = s.body.naechster;
    }
    expect(alle).toHaveLength(5);
    expect(new Set(alle.map((z) => z.id)).size).toBe(5);
    // Die Reihenfolge ist die der Datenbank-Sortierung nach Nachname; ohne Seitenwechsel dieselbe
    const ganz = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/teilnehmer?limit=200`,
    );
    expect(alle.map((z) => z.id)).toEqual(
      ganz.body.teilnehmer.map((z: { id: string }) => z.id),
    );
    const wolf = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/teilnehmer?stufe=WOLF`,
    );
    expect(
      wolf.body.teilnehmer.map((z: { nachname: string }) => z.nachname).sort(),
    ).toEqual(["Ammann", "Äbi"].sort());
    // Eine unbekannte Seite ist leer, ein zu hohes Limit ungültig
    expect(
      (
        await anfrage(
          leiter(),
          "GET",
          `${L(id)}/teilnehmer?nach=${randomUUID()}`,
        )
      ).body.teilnehmer,
    ).toEqual([]);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/teilnehmer?limit=201`)).status,
    ).toBe(400);
  });
});

describe("Import", () => {
  test("Vorschau schreibt nichts und nennt neue Zeilen, Fehler und doppelte Namen", async () => {
    const id = await frischesLager();
    await neu({ vorname: "Anna", nachname: "Muster", stufe: "Wolf" }, id);
    const text = [
      "Vorname;Nachname;Stufe",
      "Béla;Müller;Pfadi",
      "",
      "   ;  ;",
      "Anna;Muster;Wolf",
      "anna;MUSTER;wolf",
      "Anna;Muster;Biber",
      "Nur Vorname",
      ";Ohnevorname;Wolf",
      "Ohne;;Wolf",
      "Zu;Viele;Wolf;Balu;Extra",
      `${"x".repeat(101)};Lang;Wolf`,
      "Béla;Müller;Pfadi",
    ].join("\n");
    const a = await importiere(text, false, id);
    expect(a.status).toBe(200);
    expect(a.body.vorschau).toBe(true);
    expect(a.body.angelegt).toBe(0);
    expect(a.body.neu.map((z: { zeile: number }) => z.zeile)).toEqual([2, 7]);
    expect(a.body.neu[0]).toMatchObject({
      vorname: "Béla",
      nachname: "Müller",
      stufe: "Pfadi",
      ceviName: null,
    });
    expect(
      a.body.fehler.map((f: { zeile: number; code: string }) => [
        f.zeile,
        f.code,
      ]),
    ).toEqual([
      [8, "ZU_WENIG_SPALTEN"],
      [9, "VORNAME_FEHLT"],
      [10, "NACHNAME_FEHLT"],
      [11, "ZU_VIELE_SPALTEN"],
      [12, "ZU_LANG"],
    ]);
    expect(a.body.fehler[0].message).toContain("Vorname und Nachname");
    // Doppelte: «Anna Muster Wolf» gibt es im Lager schon (Zeile 5), ihre zweite Schreibweise in Zeile 6 und «Béla» in Zeile 13 stehen zweimal im Text
    expect(a.body.doppelt).toEqual([
      { zeile: 5, grund: "vorhanden" },
      { zeile: 6, grund: "im_text" },
      { zeile: 13, grund: "im_text" },
    ]);
    expect(await zaehle(id)).toBe(1);
  });

  test("übernehmen legt die gültigen Zeilen in einer Transaktion an, der Feed hat je Zeile einen Eintrag", async () => {
    const id = await frischesLager();
    const text =
      "Vorname\tNachname\tStufe\tCevi-Name\nJonas\tKeller\tPfadi\tBalu\nLéa\tMeier\t\t\nKaputt\n";
    // Die Kopfzeile «Vorname, Nachname, ...» wird übersprungen, die letzte Zeile hat nur eine Spalte
    const a = await importiere(text, true, id);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ vorschau: false, angelegt: 2 });
    expect(a.body.fehler).toEqual([
      { zeile: 4, code: "ZU_WENIG_SPALTEN", message: expect.any(String) },
    ]);
    const zeilen = await db
      .select()
      .from(schema.teilnehmer)
      .where(eq(schema.teilnehmer.lagerId, id))
      .orderBy(asc(schema.teilnehmer.lagerSeq));
    expect(
      zeilen.map((z) => [z.vorname, z.nachname, z.stufe, z.ceviName]),
    ).toEqual([
      ["Jonas", "Keller", "Pfadi", "Balu"],
      ["Léa", "Meier", null, null],
    ]);
    // Folgenummern ohne Lücke, je Zeile ein Feed-Eintrag in derselben Reihenfolge
    const e = await feed(id, "teilnehmer");
    expect(e.map((x) => x.art)).toEqual(["neu", "neu"]);
    expect(e.map((x) => x.seq)).toEqual(zeilen.map((z) => z.lagerSeq));
    expect(e[1]!.seq - e[0]!.seq).toBe(1);
    const [l] = await db
      .select()
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    expect(l!.seq).toBe(e[1]!.seq);
    // Audit: nur die Anzahl
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(
      audit.filter((x) => x.aktion === "lager_teilnehmende_importiert"),
    ).toMatchObject([
      { details: { anzahl: 2 }, akteurId: konten.lagerleitung.id },
    ]);
    expect(JSON.stringify(audit)).not.toContain("Keller");
  });

  test("zweiter Import derselben Liste legt nichts doppelt an", async () => {
    const id = await frischesLager();
    const text = "Eins;Test;Wolf\nZwei;Test;Wolf";
    expect((await importiere(text, true, id)).body.angelegt).toBe(2);
    const zweit = await importiere(text, true, id);
    expect(zweit.body.angelegt).toBe(0);
    expect(zweit.body.doppelt).toHaveLength(2);
    expect(await zaehle(id)).toBe(2);
  });

  test("Tab geht vor Semikolon, Anführungszeichen aus Excel, Windows-Zeilenenden, Umlaute", async () => {
    const id = await frischesLager();
    const text =
      '﻿"Zoë"\t"Müller; Küng"\tPfadi\r\nÅsa\tØstergaard\tBiber\r\n\r\n"Say ""Hi"""\tX\n';
    const a = await importiere(text, false, id);
    expect(a.body.fehler).toEqual([]);
    expect(
      a.body.neu.map((z: { vorname: string; nachname: string }) => [
        z.vorname,
        z.nachname,
      ]),
    ).toEqual([
      ["Zoë", "Müller; Küng"],
      ["Åsa", "Østergaard"],
      ['Say "Hi"', "X"],
    ]);
    // Zerlegte Umlaute (a + Trema) werden zusammengesetzt und gelten als gleich
    const b = await importiere("Müller;Zoë", false, id);
    expect(b.body.neu[0]).toMatchObject({ vorname: "Müller", nachname: "Zoë" });
  });

  test("leerer Text und nur leere Zeilen: nichts zu tun", async () => {
    const id = await frischesLager();
    for (const text of ["", "\n\n  \n;;\n"]) {
      const a = await importiere(text, true, id);
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({
        angelegt: 0,
        neu: [],
        fehler: [],
        doppelt: [],
      });
    }
  });

  test("Steuerzeichen in einer Zelle sind ein Fehler der Zeile", async () => {
    const id = await frischesLager();
    const a = await importiere("A\u0007B;Test\nGut;Test", false, id);
    expect(a.body.fehler).toMatchObject([{ zeile: 1, code: "STEUERZEICHEN" }]);
    expect(a.body.neu).toHaveLength(1);
  });

  test("Obergrenze: 500 Zeilen gehen, 501 sind 400; Text über 40000 Zeichen ist 400", async () => {
    const id = await frischesLager();
    const zeilen = (n: number) =>
      Array.from({ length: n }, (_, i) => `Kind${i};Nummer${i};Wolf`).join(
        "\n",
      );
    const ok = await importiere(zeilen(500), true, id);
    expect(ok.status).toBe(200);
    expect(ok.body.angelegt).toBe(500);
    expect(await zaehle(id)).toBe(500);
    const id2 = await frischesLager();
    const zuviel = await importiere(zeilen(501), true, id2);
    expect(zuviel.status).toBe(400);
    expect(zuviel.body.code).toBe("ZU_VIELE_ZEILEN");
    expect((await importiere(zeilen(501), false, id2)).status).toBe(400);
    expect(await zaehle(id2)).toBe(0);
    // Leere Zeilen zählen nicht
    expect(
      (await importiere(`${"\n".repeat(900)}A;B`, true, id2)).body.angelegt,
    ).toBe(1);
    expect((await importiere("x".repeat(40_001), false, id2)).status).toBe(400);
  });

  test("500 Zeilen brauchen wenige Statements: Folgenummern am Stück, eine Transaktion", async () => {
    const id = await frischesLager();
    const text = Array.from({ length: 200 }, (_, i) => `K${i};N${i}`).join(
      "\n",
    );
    const vorher = (
      await db.select().from(schema.lager).where(eq(schema.lager.id, id))
    )[0]!.seq;
    expect((await importiere(text, true, id)).body.angelegt).toBe(200);
    const nachher = (
      await db.select().from(schema.lager).where(eq(schema.lager.id, id))
    )[0]!.seq;
    expect(nachher - vorher).toBe(200);
    const e = await feed(id, "teilnehmer");
    expect(e).toHaveLength(200);
    expect(e.at(-1)!.seq - e[0]!.seq).toBe(199);
  });

  test("Rate-Limit: zu viele Importe je Minute geben 429", async () => {
    const id = await frischesLager();
    const antworten: number[] = [];
    for (let i = 0; i < 12; i++) {
      antworten.push(
        (await importiere("A;B", false, id, konten.abteilungsleitung)).status,
      );
    }
    expect(antworten.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(antworten.slice(10)).toEqual([429, 429]);
  });
});

describe("Abzählen", () => {
  type Abz = {
    id: string;
    geprueft: boolean;
    geprueftAm: string | null;
    vorname?: string;
    name?: string;
  };
  async function liste(konto: PersonaKonto, id: string, abfrage = "") {
    const a = await anfrage(konto, "GET", `${L(id)}/abzaehlen${abfrage}`);
    expect(a.status).toBe(200);
    return a.body as {
      eintraege: Abz[];
      naechster: string | null;
      da: number;
      gesamt: number;
    };
  }

  test("abhaken, Zähler «x von y da», Filter nach Stufe, zurücksetzen durch das Team", async () => {
    const id = await frischesLager();
    const a = await neu({ nachname: "A", stufe: "Wolf" }, id);
    const b = await neu({ nachname: "B", stufe: "Wolf" }, id);
    const c = await neu({ nachname: "C", stufe: "Pfadi" }, id);
    expect(await liste(konten.team, id)).toMatchObject({ da: 0, gesamt: 3 });

    const ersterHaken = await anfrage(
      konten.team,
      "PUT",
      `${L(id)}/abzaehlen`,
      {
        geprueft: true,
        teilnehmerIds: [a.id, c.id],
      },
    );
    expect(ersterHaken).toEqual({ status: 200, body: { geaendert: 2 } });
    const stand = await liste(konten.leitung, id);
    expect(stand).toMatchObject({ da: 2, gesamt: 3 });
    expect(stand.eintraege.map((e) => e.geprueft)).toEqual([true, false, true]);
    expect(stand.eintraege[0]!.geprueftAm).not.toBeNull();
    expect(stand.eintraege[1]!.geprueftAm).toBeNull();
    // Filter nach Stufe: Summen gelten für den Filter
    expect(await liste(konten.team, id, "?stufe=wolf")).toMatchObject({
      da: 1,
      gesamt: 2,
    });
    expect(await liste(konten.team, id, "?stufe=Pfadi")).toMatchObject({
      da: 1,
      gesamt: 1,
    });

    // Dasselbe nochmals abhaken ändert nichts: keine neue Version, kein Feed-Eintrag
    const feedVorher = (await feed(id, "abzaehlen")).length;
    expect(
      (
        await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
          geprueft: true,
          teilnehmerIds: [a.id],
        })
      ).body,
    ).toEqual({ geaendert: 0 });
    expect((await feed(id, "abzaehlen")).length).toBe(feedVorher);
    // Abhaken zurücknehmen
    expect(
      (
        await anfrage(konten.leitung, "PUT", `${L(id)}/abzaehlen`, {
          geprueft: false,
          teilnehmerIds: [a.id, b.id],
        })
      ).body,
    ).toEqual({ geaendert: 1 });
    expect(await liste(konten.team, id)).toMatchObject({ da: 1, gesamt: 3 });
    // Erneut abhaken nutzt dieselbe Zeile (eine Zeile je Teilnehmenden)
    await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [a.id],
    });
    const zeilen = await db
      .select()
      .from(schema.abzaehlen)
      .where(eq(schema.abzaehlen.lagerId, id));
    expect(zeilen).toHaveLength(2);
    expect(zeilen.find((z) => z.teilnehmerId === a.id)).toMatchObject({
      version: 3,
      geprueft: true,
    });

    // Zurücksetzen durch das Team: nur die gesetzten Haken, die Teilnehmenden bleiben
    const z = await anfrage(
      konten.team,
      "POST",
      `${L(id)}/abzaehlen/zuruecksetzen`,
      {
        bestaetigt: true,
      },
    );
    expect(z).toEqual({ status: 200, body: { zurueckgesetzt: 2 } });
    expect(await liste(konten.team, id)).toMatchObject({ da: 0, gesamt: 3 });
    expect(await zaehle(id)).toBe(3);
    const nachReset = await db
      .select()
      .from(schema.abzaehlen)
      .where(eq(schema.abzaehlen.lagerId, id));
    expect(nachReset.every((r) => !r.geprueft && r.geprueftAm === null)).toBe(
      true,
    );
    // Ein zweites Zurücksetzen findet nichts mehr
    expect(
      (
        await anfrage(konten.team, "POST", `${L(id)}/abzaehlen/zuruecksetzen`, {
          bestaetigt: true,
        })
      ).body,
    ).toEqual({ zurueckgesetzt: 0 });
  });

  test("Zurücksetzen braucht die Bestätigung im Body", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [t.id],
    });
    for (const body of [
      {},
      { bestaetigt: false },
      { bestaetigt: "ja" },
      { bestaetigt: true, alle: true },
    ]) {
      expect(
        (
          await anfrage(
            konten.team,
            "POST",
            `${L(id)}/abzaehlen/zuruecksetzen`,
            body,
          )
        ).status,
      ).toBe(400);
    }
    expect(await liste(konten.team, id)).toMatchObject({ da: 1 });
  });

  test("das Team löscht und ändert keine Teilnehmenden, auch nicht über das Abzählen", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [t.id],
    });
    await anfrage(konten.team, "POST", `${L(id)}/abzaehlen/zuruecksetzen`, {
      bestaetigt: true,
    });
    expect(
      (
        await anfrage(
          konten.team,
          "DELETE",
          `${L(id)}/teilnehmer/${t.id}?version=1`,
        )
      ).status,
    ).toBe(403);
    const zeile = (
      await db
        .select()
        .from(schema.teilnehmer)
        .where(eq(schema.teilnehmer.id, t.id))
    )[0]!;
    expect(zeile).toMatchObject({
      version: 1,
      vorname: "Anna",
      stufe: "Wolf",
    });
  });

  test("unbekannte, gelöschte und fremde IDs geben 404 und schreiben nichts", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    const fremd = await neu({}, andereLagerId);
    const geloescht = await neu({}, id);
    await anfrage(
      leiter(),
      "DELETE",
      `${L(id)}/teilnehmer/${geloescht.id}?version=1`,
    );
    for (const ids of [
      [randomUUID()],
      [fremd.id],
      [geloescht.id],
      [t.id, fremd.id],
    ]) {
      const a = await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
        geprueft: true,
        teilnehmerIds: ids,
      });
      expect(a.status, ids.join()).toBe(404);
    }
    // Eine Person, die nicht Mitglied dieses Lagers ist
    const fremdePerson = konten.ohneMitgliedschaft.id!;
    expect(
      (
        await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
          geprueft: true,
          personIds: [fremdePerson],
        })
      ).status,
    ).toBe(404);
    expect(
      await db
        .select()
        .from(schema.abzaehlen)
        .where(eq(schema.abzaehlen.lagerId, id)),
    ).toHaveLength(0);
  });

  test("ungültige Eingaben: leere Liste, doppelte IDs, mehr als 200, falscher Typ", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    const ungueltig: Record<string, unknown>[] = [
      { geprueft: true },
      { geprueft: true, teilnehmerIds: [] },
      { geprueft: true, teilnehmerIds: [t.id, t.id] },
      {
        geprueft: true,
        teilnehmerIds: Array.from({ length: 201 }, () => randomUUID()),
      },
      { geprueft: "ja", teilnehmerIds: [t.id] },
      { teilnehmerIds: [t.id] },
      { geprueft: true, teilnehmerIds: ["x"] },
    ];
    for (const body of ungueltig) {
      expect(
        (await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, body)).status,
        JSON.stringify(body).slice(0, 60),
      ).toBe(400);
    }
  });

  test("Mitglieder des Lagers abzählen (art=team), nur aktive Konten", async () => {
    const id = await frischesLager();
    const team = await liste(konten.team, id, "?art=team");
    // Lagerleitung, Leitung, Team und Lesen; die falsche Mitgliedszeile des fremden Kontos zählt nicht
    expect(team.gesamt).toBe(4);
    expect(team.da).toBe(0);
    expect(Object.keys(team.eintraege[0]!).sort()).toEqual(
      [
        "bildUrl",
        "ceviName",
        "geprueft",
        "geprueftAm",
        "id",
        "name",
        "personId",
      ].sort(),
    );
    const a = await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      personIds: [konten.team.id!, konten.leitung.id!],
    });
    expect(a.body).toEqual({ geaendert: 2 });
    expect(await liste(konten.lesen, id, "?art=team")).toMatchObject({
      da: 2,
      gesamt: 4,
    });
    // Die Teilnehmenden zählen getrennt
    expect(await liste(konten.lesen, id)).toMatchObject({ da: 0, gesamt: 0 });
    // Ein deaktiviertes Konto zählt nicht mit
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, konten.lesen.id!));
    try {
      expect(await liste(konten.team, id, "?art=team")).toMatchObject({
        da: 2,
        gesamt: 3,
      });
    } finally {
      await db
        .update(schema.user)
        .set({ deaktiviertAm: null })
        .where(eq(schema.user.id, konten.lesen.id!));
    }
    // Zurücksetzen nimmt auch die Haken der Mitglieder
    await anfrage(konten.team, "POST", `${L(id)}/abzaehlen/zuruecksetzen`, {
      bestaetigt: true,
    });
    expect(await liste(konten.team, id, "?art=team")).toMatchObject({ da: 0 });
  });

  test("Seitenwechsel der Abzählliste", async () => {
    const id = await frischesLager();
    for (const n of ["D", "A", "C", "B", "E"]) await neu({ nachname: n }, id);
    const s1 = await liste(konten.team, id, "?limit=2");
    expect(s1.eintraege).toHaveLength(2);
    expect(s1).toMatchObject({ gesamt: 5 });
    const s2 = await liste(konten.team, id, `?limit=2&nach=${s1.naechster}`);
    const s3 = await liste(konten.team, id, `?limit=2&nach=${s2.naechster}`);
    expect(s3.naechster).toBeNull();
    expect(
      [...s1.eintraege, ...s2.eintraege, ...s3.eintraege].map(
        (e) => (e as unknown as { nachname: string }).nachname,
      ),
    ).toEqual(["A", "B", "C", "D", "E"]);
  });

  test("Haken kommen mit eigener Folgenummer in den Feed, die Zeile gehört dem Lager", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    const u = await neu({ nachname: "Zwei" }, id);
    await anfrage(konten.team, "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [t.id, u.id],
    });
    await anfrage(konten.team, "POST", `${L(id)}/abzaehlen/zuruecksetzen`, {
      bestaetigt: true,
    });
    const e = await feed(id, "abzaehlen");
    expect(e.map((x) => [x.art, x.version])).toEqual([
      ["neu", 1],
      ["neu", 1],
      ["geaendert", 2],
      ["geaendert", 2],
    ]);
    const alle = await db
      .select()
      .from(schema.lagerAenderung)
      .where(eq(schema.lagerAenderung.lagerId, id))
      .orderBy(asc(schema.lagerAenderung.seq));
    // Ohne Lücke von 1 an
    expect(alle.map((x) => x.seq)).toEqual(alle.map((_, i) => i + 1));
    // Der Feed zeigt Teilnehmenden und Abzählen mit teilnehmer.lesen: das Team sieht beide Typen, ohne Inhalt
    const f = await anfrage(
      konten.team,
      "GET",
      `${L(id)}/aenderungen?seit=0&limit=500`,
    );
    expect(f.status).toBe(200);
    expect(
      new Set(f.body.eintraege.map((x: { objekttyp: string }) => x.objekttyp)),
    ).toEqual(new Set(["teilnehmer", "abzaehlen"]));
    expect(JSON.stringify(f.body)).not.toContain("Muster");
  });

  test("gleichzeitiges Abhaken derselben Person durch zwei Konten ergibt eine Zeile", async () => {
    const id = await frischesLager();
    const t = await neu({}, id);
    const antworten = await Promise.all(
      [
        konten.team,
        konten.leitung,
        konten.lagerleitung,
        konten.team,
        konten.leitung,
      ].map((k) =>
        anfrage(k, "PUT", `${L(id)}/abzaehlen`, {
          geprueft: true,
          teilnehmerIds: [t.id],
        }),
      ),
    );
    expect(antworten.every((a) => a.status === 200)).toBe(true);
    expect(antworten.map((a) => a.body.geaendert).sort()).toEqual([
      0, 0, 0, 0, 1,
    ]);
    expect(
      await db
        .select()
        .from(schema.abzaehlen)
        .where(eq(schema.abzaehlen.lagerId, id)),
    ).toHaveLength(1);
  });
});

describe("Löschen nach dem Lager", () => {
  test("sechs Monate nach dem Lagerende: Teilnehmende und Haken weg, andere Lager bleiben, Audit nur mit Anzahl", async () => {
    const alt = await legeLager(
      welt.testabteilungId,
      "abgeschlossen",
      "2027-01-31",
    );
    const grenze = await legeLager(
      welt.testabteilungId,
      "abgeschlossen",
      "2027-02-01",
    );
    const neuer = await legeLager(welt.testabteilungId, "aktiv", "2027-07-24");
    const leer = await legeLager(
      welt.testabteilungId,
      "abgeschlossen",
      "2020-01-01",
    );
    for (const id of [alt, grenze, neuer, leer]) await mitgliederEintragen(id);
    // Drei Teilnehmende im alten Lager, je einer in den anderen
    const einfuegen = async (id: string, n: number) => {
      const zeilen = await db
        .insert(schema.teilnehmer)
        .values(
          Array.from({ length: n }, (_, i) => ({
            lagerId: id,
            vorname: `Kind${i}`,
            nachname: "Alt",
            lagerSeq: 0,
          })),
        )
        .returning({ id: schema.teilnehmer.id });
      return zeilen.map((z) => z.id);
    };
    const [a1] = await einfuegen(alt, 2);
    await einfuegen(alt, 1);
    await einfuegen(grenze, 1);
    await einfuegen(neuer, 1);
    await db.insert(schema.abzaehlen).values({
      lagerId: alt,
      teilnehmerId: a1!,
      geprueft: true,
      geprueftAm: new Date(),
      lagerSeq: 0,
    });
    await db.insert(schema.abzaehlen).values({
      lagerId: alt,
      personId: konten.team.id!,
      geprueft: true,
      geprueftAm: new Date(),
      lagerSeq: 0,
    });

    // Der Lauf am 2027-08-01: Lager mit Ende vor dem 2027-02-01 sind älter als sechs Monate
    const lager = [alt, grenze, neuer, leer];
    const n = await loescheAlteTeilnehmende(
      db,
      new Date("2027-08-01T05:00:00Z"),
      lager,
    );
    expect(n).toBe(3);
    expect(await zaehle(alt)).toBe(0);
    expect(await zaehle(grenze)).toBe(1);
    expect(await zaehle(neuer)).toBe(1);
    // Die Haken der Teilnehmenden gehen mit, der Haken einer Person bleibt (kein Kinderdatum)
    const haken = await db
      .select()
      .from(schema.abzaehlen)
      .where(eq(schema.abzaehlen.lagerId, alt));
    expect(haken.map((h) => h.personId)).toEqual([konten.team.id]);
    // Ein Audit-Eintrag je betroffenes Lager, nur mit der Anzahl
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.aktion, "lager_teilnehmende_geloescht"));
    const meine = audit.filter((x) =>
      [alt, grenze, neuer, leer].includes(x.zielId),
    );
    expect(meine).toHaveLength(1);
    expect(meine[0]).toMatchObject({
      zielId: alt,
      akteurId: "system",
      zielTyp: "lager",
      details: { anzahl: 3 },
      abteilungId: welt.testabteilungId,
    });
    // Am Tag darauf gilt die Grenze für das nächste Lager; ein zweiter Lauf am selben Tag findet nichts
    expect(
      await loescheAlteTeilnehmende(
        db,
        new Date("2027-08-01T20:00:00Z"),
        lager,
      ),
    ).toBe(0);
    expect(
      await loescheAlteTeilnehmende(
        db,
        new Date("2027-08-02T05:00:00Z"),
        lager,
      ),
    ).toBe(1);
    expect(await zaehle(grenze)).toBe(0);
    expect(await zaehle(neuer)).toBe(1);
  });
});
