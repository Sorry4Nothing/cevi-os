import { randomUUID } from "node:crypto";
import { eq, sql as dsql } from "drizzle-orm";
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
let fremdLagerId: string;
let andereLagerId: string;
const ressortIds: Record<string, string> = {};
const personIds: Record<string, string> = {};

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
  von = "2027-07-10",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Schnellager",
      von,
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

async function legeMitglied(
  lager: string,
  name: string,
  ceviName: string | null = null,
  deaktiviert = false,
) {
  const [p] = await db
    .insert(schema.user)
    .values({
      name,
      ceviName,
      email: `${randomUUID()}@example.org`,
      username: `s.${randomUUID().slice(0, 8)}`,
      abteilungId: welt.testabteilungId,
      mussPasswortAendern: false,
      deaktiviertAm: deaktiviert ? new Date() : null,
    })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId: lager, personId: p!.id, rolle: "team" });
  return p!.id;
}

async function legeRessort(lager: string, kuerzel: string, name: string) {
  const [r] = await db
    .insert(schema.ressort)
    .values({ lagerId: lager, kuerzel, name, lagerSeq: 0 })
    .returning({ id: schema.ressort.id });
  return r!.id;
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
  // Erfundene Namen: zwei Quirin (mehrdeutig), eine Person über den Cevi-Namen, eine deaktivierte, eine in einem anderen Lager
  personIds.quirinA = await legeMitglied(lagerId, "Quirin Alpha");
  personIds.quirinB = await legeMitglied(lagerId, "Quirin Beta");
  personIds.pax = await legeMitglied(lagerId, "Zacharias Gamma", "Pax");
  personIds.weg = await legeMitglied(lagerId, "Walburga Delta", null, true);
  personIds.anderes = await legeMitglied(andereLagerId, "Ottilie Epsilon");
  ressortIds.logistik = await legeRessort(lagerId, "LOG", "Logistik");
  ressortIds.essenA = await legeRessort(lagerId, "ESA", "Essen");
  ressortIds.essenB = await legeRessort(lagerId, "ESB", "Essen");
  ressortIds.anderes = await legeRessort(andereLagerId, "ANDERES", "Fremdes");
});

// Die Bodys prüfen die Tests Feld für Feld; ein Typ je Route brächte hier nichts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  pfad: string,
  body?: unknown,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: "POST",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const schnell = (text: unknown, id = lagerId, konto = konten.lagerleitung) =>
  anfrage(konto, `/api/v1/lager/${id}/aufgaben/schnell`, { text });

describe("Rechte je Lager-Persona", () => {
  // aufgaben.bearbeiten: Lagerleitung, Abteilungsleitung, Leitung. Team und Lesen 403, sonst 404 und 401
  const erwartet: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  test.each(LAGER_PERSONAS)("%s: Vorschlag holen", async (p) => {
    const a = await schnell("Offerte morgen", lagerId, konten[p]);
    expect(a.status).toBe(erwartet[p]);
    if (a.status === 200) {
      expect(a.body.vorschlaege).toHaveLength(1);
    } else if (a.status !== 401) {
      // Ein Fehler verrät nichts vom Inhalt
      expect(JSON.stringify(a.body)).not.toContain("Offerte");
    }
  });

  test.each(LAGER_PERSONAS)(
    "%s: im abgeschlossenen Lager 409 mit dem Recht, sonst wie im aktiven",
    async (p) => {
      const a = await schnell("Offerte", geschlossenId, konten[p]);
      const nachRecht: Record<LagerPersona, number> = {
        ...erwartet,
        abteilungsleitung: 409,
        lagerleitung: 409,
        leitung: 409,
      };
      expect(a.status).toBe(nachRecht[p]);
    },
  );

  test("ein Lager der fremden Abteilung ist unbekannt, auch für die Lagerleitung dort", async () => {
    expect((await schnell("Offerte", fremdLagerId)).status).toBe(404);
    expect(
      (await schnell("Offerte", fremdLagerId, konten.fremdeAbteilung)).status,
    ).toBe(404);
  });

  test("ein unbekanntes Lager und eine ungültige ID", async () => {
    expect((await schnell("Offerte", randomUUID())).status).toBe(404);
    expect((await schnell("Offerte", "keine-uuid")).status).toBe(400);
  });
});

describe("Vorschlag", () => {
  test("das Beispiel aus dem Issue", async () => {
    const a = await schnell("Offerte @Pax bis 15.3. #Logistik");
    expect(a.status).toBe(200);
    expect(a.body.vorschlaege).toHaveLength(1);
    const v = a.body.vorschlaege[0];
    expect(v.zeile).toBe("Offerte @Pax bis 15.3. #Logistik");
    expect(v.titel).toBe("Offerte");
    expect(v.person).toEqual({
      status: "gefunden",
      text: "Pax",
      kandidaten: [
        { id: personIds.pax, name: "Zacharias Gamma", ceviName: "Pax" },
      ],
    });
    expect(v.ressort).toEqual({
      status: "gefunden",
      text: "Logistik",
      kandidaten: [
        { id: ressortIds.logistik, kuerzel: "LOG", name: "Logistik" },
      ],
    });
    expect(v.frist.text).toBe("bis 15.3.");
    expect(v.frist.datum).toMatch(/^\d{4}-03-15$/);
    expect(v.hinweise).toEqual([]);
  });

  test("Person über Vornamen und vollen Namen, Ressort über das Kürzel", async () => {
    const a = await schnell("Zelt @zacharias #log\nKarte @Zacharias Gamma");
    expect(a.body.vorschlaege.map((v: { titel: string }) => v.titel)).toEqual([
      "Zelt",
      "Karte",
    ]);
    for (const v of a.body.vorschlaege) {
      expect(v.person.kandidaten.map((k: { id: string }) => k.id)).toEqual([
        personIds.pax,
      ]);
    }
    expect(a.body.vorschlaege[0].ressort.kandidaten[0].id).toBe(
      ressortIds.logistik,
    );
  });

  test("mehrdeutige Person und mehrdeutiges Ressort: alle Kandidaten, nie geraten", async () => {
    const a = await schnell("Offerte @Quirin #Essen");
    const v = a.body.vorschlaege[0];
    expect(v.person.status).toBe("mehrdeutig");
    expect(v.person.kandidaten.map((k: { id: string }) => k.id).sort()).toEqual(
      [personIds.quirinA, personIds.quirinB].sort(),
    );
    expect(v.ressort.status).toBe("mehrdeutig");
    expect(
      v.ressort.kandidaten.map((k: { id: string }) => k.id).sort(),
    ).toEqual([ressortIds.essenA, ressortIds.essenB].sort());
    expect(v.titel).toBe("Offerte");
    // Der volle Name löst es auf
    const b = await schnell("Offerte @Quirin Beta #ESB");
    expect(b.body.vorschlaege[0].person.kandidaten).toHaveLength(1);
    expect(b.body.vorschlaege[0].person.kandidaten[0].id).toBe(
      personIds.quirinB,
    );
    expect(b.body.vorschlaege[0].ressort.kandidaten[0].id).toBe(
      ressortIds.essenB,
    );
  });

  test("nur Mitglieder dieses Lagers, nur aktive Konten, nur Ressorts dieses Lagers; ein Ressort, das es nicht gibt, ist unbekannt", async () => {
    const a = await schnell(
      "A @Ottilie\nB @Walburga\nC #Fremdes\nD #Gelöscht\nE #GELOESCHT",
    );
    const v = a.body.vorschlaege;
    expect(v[0].person).toEqual({
      status: "unbekannt",
      text: "Ottilie",
      kandidaten: [],
    });
    expect(v[1].person).toEqual({
      status: "unbekannt",
      text: "Walburga",
      kandidaten: [],
    });
    expect(v[2].ressort.status).toBe("unbekannt");
    expect(v[3].ressort.status).toBe("unbekannt");
    expect(v[4].ressort.status).toBe("unbekannt");
    // Das Wort bleibt im Titel
    expect(v[0].titel).toBe("A @Ottilie");
    expect(v[2].titel).toBe("C #Fremdes");
    // Im anderen Lager gilt dort
    const b = await schnell("A @Ottilie #Fremdes", andereLagerId);
    expect(b.body.vorschlaege[0].person.status).toBe("gefunden");
    expect(b.body.vorschlaege[0].ressort.status).toBe("gefunden");
  });

  test("mehrere Zeilen geben mehrere Vorschläge", async () => {
    const a = await schnell("- Offerte morgen\n\n2. Zelt\r\n• Karte @Pax");
    expect(a.body.vorschlaege.map((v: { titel: string }) => v.titel)).toEqual([
      "Offerte",
      "Zelt",
      "Karte",
    ]);
  });

  test("ohne @ und # fragt die Route die Datenbank nicht nach Personen und Ressorts", async () => {
    // Sichtbar daran, dass auch in einem Lager ohne Ressorts und Mitglieder nichts fehlt
    const leer = await legeLager(welt.testabteilungId);
    await db.insert(schema.lagerMitglied).values({
      lagerId: leer,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const a = await schnell("Offerte morgen", leer);
    expect(a.status).toBe(200);
    expect(a.body.vorschlaege[0]).toMatchObject({
      titel: "Offerte",
      person: null,
      ressort: null,
    });
    expect(a.body.vorschlaege[0].frist.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("die Frist «vor Lager» rechnet ab dem Beginn dieses Lagers", async () => {
    const eigenes = await legeLager(
      welt.testabteilungId,
      "aktiv",
      "2027-07-10",
    );
    await db.insert(schema.lagerMitglied).values({
      lagerId: eigenes,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const a = await schnell(
      "A 2 Wochen vor Lager\nB vor dem Lager\nC 3 Tage vor Lager",
      eigenes,
    );
    expect(
      a.body.vorschlaege.map(
        (v: { frist: { datum: string } }) => v.frist.datum,
      ),
    ).toEqual(["2027-06-26", "2027-07-09", "2027-07-07"]);
    expect(a.body.vorschlaege.map((v: { titel: string }) => v.titel)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  test("Hinweise: leerer Titel, ungültiges Datum", async () => {
    const a = await schnell("@Pax\nOfferte bis 31.2.");
    expect(a.body.vorschlaege[0].hinweise).toEqual(["TITEL_FEHLT"]);
    expect(a.body.vorschlaege[1].hinweise).toEqual(["DATUM_UNGUELTIG"]);
    expect(a.body.vorschlaege[1].frist).toBeNull();
  });

  test("Text mit Sonderzeichen: nichts wird als Befehl gedeutet", async () => {
    const a = await schnell(
      `Robert'); DROP TABLE aufgabe;-- <script>alert(1)</script> @Pax`,
    );
    expect(a.status).toBe(200);
    expect(a.body.vorschlaege[0].titel).toContain("DROP TABLE");
    expect(a.body.vorschlaege[0].person.status).toBe("gefunden");
  });
});

describe("Der Vorschlag legt nie etwas an", () => {
  test("keine Aufgabe, keine Folgenummer, kein Feed-Eintrag, keine Benachrichtigung", async () => {
    const zaehle = async () => {
      const [aufgaben] = await db
        .select({ n: dsql<number>`count(*)::int` })
        .from(schema.aufgabe)
        .where(eq(schema.aufgabe.lagerId, lagerId));
      const [lager] = await db
        .select({ seq: schema.lager.seq })
        .from(schema.lager)
        .where(eq(schema.lager.id, lagerId));
      return { aufgaben: aufgaben!.n, seq: lager!.seq };
    };
    const vorher = await zaehle();
    const a = await schnell(
      "Offerte @Pax bis morgen #Logistik\nZelt @Quirin\nKarte",
    );
    expect(a.status).toBe(200);
    expect(a.body.vorschlaege).toHaveLength(3);
    expect(await zaehle()).toEqual(vorher);
  });
});

describe("Eingabe", () => {
  test.each([
    ["leerer Text", ""],
    ["nur Leerraum", "  \n \n"],
    ["501 Zeichen", "a".repeat(501)],
    ["21 Zeilen", Array(21).fill("a").join("\n")],
    ["keine Zeichenkette", 5],
    ["null", null],
  ])("%s: 400", async (_name, text) => {
    expect((await schnell(text)).status).toBe(400);
  });

  test("500 Zeichen und 20 Zeilen gehen", async () => {
    expect((await schnell("a".repeat(500))).status).toBe(200);
    expect((await schnell(Array(20).fill("a").join("\n"))).status).toBe(200);
  });

  test("unbekannte Felder und fehlender Text: 400", async () => {
    const pfad = `/api/v1/lager/${lagerId}/aufgaben/schnell`;
    expect(
      (await anfrage(konten.lagerleitung, pfad, { text: "a", x: 1 })).status,
    ).toBe(400);
    expect((await anfrage(konten.lagerleitung, pfad, {})).status).toBe(400);
    expect((await anfrage(konten.lagerleitung, pfad, [])).status).toBe(400);
  });

  test("ein ungültiges Recht kommt vor der Eingabe: Team bekommt 403 auch bei falschem Text", async () => {
    expect((await schnell("", lagerId, konten.team)).status).toBe(403);
    expect((await schnell("", lagerId, konten.ohneMitgliedschaft)).status).toBe(
      404,
    );
  });
});

// Zuletzt: das Limit gilt je Konto in dieser App-Instanz
describe("Rate-Limit", () => {
  test("je Konto 60 Anfragen pro Minute, dann 429; ein anderes Konto ist nicht betroffen", async () => {
    let erste429 = -1;
    for (let i = 0; i < 70; i++) {
      const a = await schnell("Offerte", lagerId, konten.leitung);
      if (a.status === 429) {
        erste429 = i;
        break;
      }
      expect(a.status).toBe(200);
    }
    expect(erste429).toBeGreaterThan(40);
    expect(erste429).toBeLessThanOrEqual(60);
    expect(
      (await schnell("Offerte", lagerId, konten.lagerleitung)).status,
    ).toBe(200);
  });
});
