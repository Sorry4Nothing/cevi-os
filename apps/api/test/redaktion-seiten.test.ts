import { randomUUID } from "node:crypto";
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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../src/website/ereignisse.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

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

const BASIS = "/api/v1/redaktion/seiten";
const OEFFENTLICH = { art: "oeffentlich" } as const;
const ANGEMELDET = { art: "angemeldet" } as const;

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let demoEltern: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let redaktion: PersonaKonto;
let ohneRecht: PersonaKonto;
let eltern: PersonaKonto;
// Die Seiten der Testabteilung: stufen > a (Stufe A), b (Stufe B); verein
let stufenId: string;
let aId: string;
let bId: string;
let vereinId: string;

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

// Legt eine Seite über die API an und gibt die ID zurück; der Test prüft den Status 201
async function lege(
  konto: PersonaKonto,
  body: Record<string, unknown>,
): Promise<string> {
  const antwort = await anfrage(konto, "POST", BASIS, {
    sichtbarkeit: ANGEMELDET,
    ...body,
  });
  expect(antwort.status, JSON.stringify(await antwort.clone().json())).toBe(
    201,
  );
  return ((await antwort.json()) as { id: string }).id;
}

const eindeutig = (vorsatz: string) => `${vorsatz}-${randomUUID().slice(0, 8)}`;

async function fehlercode(antwort: Response) {
  return ((await antwort.json()) as { code: string }).code;
}

const wegwerfTag = async (abteilungId: string, typ: "team" | "funktion") => {
  const [zeile] = await db
    .insert(schema.tag)
    .values({
      abteilungId,
      typ,
      name: `Tag ${randomUUID()}`,
      kuerzel: "T",
    })
    .returning({ id: schema.tag.id });
  return zeile.id;
};

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [
    admin,
    adminOhne,
    demoAdmin,
    demoEltern,
    slA,
    slB,
    redaktion,
    ohneRecht,
    eltern,
  ] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "adminOhneZweitenFaktor"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "demoEltern"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "slB"),
    legePersonaAn(welt, "leitendeA"),
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "elternA"),
  ]);
  // Redaktion = Recht auf alle Seiten (Objekt leer), nur vom Admin gesetzt
  await db.insert(schema.bearbeiter).values({
    abteilungId: welt.testabteilungId,
    objektTyp: "seite",
    userId: redaktion.id!,
  });
  stufenId = await lege(admin, { titel: "Stufen", adresse: "stufen" });
  aId = await lege(admin, {
    titel: "Stufe A",
    adresse: "a",
    elternId: stufenId,
    tagId: welt.stufeAId,
  });
  bId = await lege(admin, {
    titel: "Stufe B",
    adresse: "b",
    elternId: stufenId,
    tagId: welt.stufeBId,
  });
  vereinId = await lege(admin, {
    titel: "Verein",
    adresse: "verein",
    sichtbarkeit: OEFFENTLICH,
  });
});

describe("Baum", () => {
  type Eintrag = { id: string; pfad: string; elternId: string | null };
  const liste = async (konto: PersonaKonto) => {
    const antwort = await anfrage(konto, "GET", BASIS);
    expect(antwort.status).toBe(200);
    return ((await antwort.json()) as { seiten: Eintrag[] }).seiten;
  };

  test("Abteilungsleitung und Redaktion sehen alle Seiten mit vollem Pfad", async () => {
    for (const konto of [admin, redaktion]) {
      const seiten = await liste(konto);
      const ids = seiten.map((s) => s.id);
      expect(ids).toEqual(
        expect.arrayContaining([stufenId, aId, bId, vereinId]),
      );
      expect(seiten.find((s) => s.id === aId)).toMatchObject({
        pfad: "/stufen/a",
        elternId: stufenId,
      });
    }
  });

  test("eine Stufenleitung sieht nur die Seite ihrer Stufe", async () => {
    expect((await liste(slA)).map((s) => s.id)).toEqual([aId]);
    expect((await liste(slB)).map((s) => s.id)).toEqual([bId]);
    // Die Elternseite fehlt in der Liste, der Pfad nennt sie trotzdem
    expect((await liste(slA))[0].pfad).toBe("/stufen/a");
  });

  test("ohne Zugang 403: Leitende ohne Stufenleitung, Eltern", async () => {
    for (const konto of [ohneRecht, eltern]) {
      const antwort = await anfrage(konto, "GET", BASIS);
      expect(antwort.status).toBe(403);
      expect(await fehlercode(antwort)).toBe("KEINE_BERECHTIGUNG");
    }
  });

  test("ein Recht auf genau eine Seite öffnet den Zugang nur für diese Seite", async () => {
    const person = await legePersonaAn(welt, "leitendeA");
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: vereinId,
      userId: person.id!,
    });
    expect((await liste(person)).map((s) => s.id)).toEqual([vereinId]);
    expect(
      (await anfrage(person, "PATCH", `${BASIS}/${vereinId}`, { titel: "V" }))
        .status,
    ).toBe(204);
    expect((await anfrage(person, "GET", `${BASIS}/${aId}`)).status).toBe(403);
    expect(
      (await anfrage(person, "DELETE", `${BASIS}/${vereinId}`)).status,
    ).toBe(403);
    expect(
      (
        await anfrage(person, "POST", BASIS, {
          titel: "X",
          adresse: eindeutig("x"),
          sichtbarkeit: ANGEMELDET,
        })
      ).status,
    ).toBe(403);
  });

  test("ein Tag mit Recht auf Seiten öffnet den Zugang für alle, die ihn tragen", async () => {
    const tagId = await wegwerfTag(welt.testabteilungId, "team");
    const person = await legePersonaAn(welt, "leitendeB");
    expect((await anfrage(person, "GET", BASIS)).status).toBe(403);
    await db.insert(schema.personTag).values({ userId: person.id!, tagId });
    // Der Tag allein verleiht nichts (#331)
    expect((await anfrage(person, "GET", BASIS)).status).toBe(403);
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      tagId,
    });
    expect((await liste(person)).length).toBeGreaterThanOrEqual(4);
  });

  test("ein Konto ohne zweiten Faktor: Admin 403 mit eigenem Code, andere nicht betroffen", async () => {
    const antwort = await anfrage(adminOhne, "GET", BASIS);
    expect(antwort.status).toBe(403);
    expect(await fehlercode(antwort)).toBe("ZWEITER_FAKTOR_FEHLT");
    expect((await anfrage(slA, "GET", BASIS)).status).toBe(200);
  });
});

describe("Anlegen", () => {
  test("Redaktion legt an; Reihenfolge ohne Angabe ans Ende; Audit ohne Titel", async () => {
    const eltern1 = await lege(redaktion, {
      titel: "Geheimer Titel",
      adresse: eindeutig("neu"),
    });
    for (const adresse of ["eins", "zwei", "drei"]) {
      await lege(redaktion, { titel: adresse, adresse, elternId: eltern1 });
    }
    const zeilen = await db
      .select({ adresse: schema.seite.adresse, r: schema.seite.reihenfolge })
      .from(schema.seite)
      .where(eq(schema.seite.elternId, eltern1));
    expect(
      zeilen.sort((x, y) => x.r - y.r).map((z) => [z.adresse, z.r]),
    ).toEqual([
      ["eins", 0],
      ["zwei", 1],
      ["drei", 2],
    ]);
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, eltern1));
    expect(eintrag).toMatchObject({
      aktion: "seite_angelegt",
      akteurId: redaktion.id,
      zielTyp: "seite",
      details: { elternId: null, tagId: null, sichtbarkeit: "angemeldet" },
    });
    expect(JSON.stringify(eintrag)).not.toContain("Geheimer");
  });

  test("eine Stufenleitung legt nicht an, auch nicht unter ihrer Seite", async () => {
    const antwort = await anfrage(slA, "POST", BASIS, {
      titel: "X",
      adresse: eindeutig("x"),
      elternId: aId,
      sichtbarkeit: ANGEMELDET,
    });
    expect(antwort.status).toBe(403);
  });

  test("die Adresse ist unter einer Elternseite eindeutig, unter einer anderen nicht", async () => {
    const adresse = eindeutig("doppelt");
    await lege(admin, { titel: "Eins", adresse });
    const zweite = await anfrage(admin, "POST", BASIS, {
      titel: "Zwei",
      adresse,
      sichtbarkeit: ANGEMELDET,
    });
    expect(zweite.status).toBe(409);
    expect(await fehlercode(zweite)).toBe("ADRESSE_VERGEBEN");
    await lege(admin, { titel: "Drei", adresse, elternId: vereinId });
  });

  test("Adressen der anderen Abteilung zählen nicht", async () => {
    const adresse = eindeutig("beide");
    await lege(admin, { titel: "Test", adresse });
    await lege(demoAdmin, { titel: "Demo", adresse });
  });

  test.each([
    "api",
    "admin",
    "health",
    "datenschutz",
    "konto-loeschen",
    "support",
    "website",
    "anmelden",
    "medien",
    "ical",
  ])(
    "reservierte Adresse %s: oben 400, als Unterseite erlaubt",
    async (adresse) => {
      const antwort = await anfrage(admin, "POST", BASIS, {
        titel: "R",
        adresse,
        sichtbarkeit: ANGEMELDET,
      });
      expect(antwort.status).toBe(400);
      expect(await fehlercode(antwort)).toBe("ADRESSE_RESERVIERT");
      await lege(admin, { titel: "R", adresse, elternId: stufenId });
    },
  );

  test.each([
    "sitemap.xml",
    "robots.txt",
    ".well-known",
    "Gross",
    "mit leer",
    "ä",
    "",
    "x".repeat(61),
  ])("Adresse %j ist ungültig (400)", async (adresse) => {
    const antwort = await anfrage(admin, "POST", BASIS, {
      titel: "U",
      adresse,
      sichtbarkeit: ANGEMELDET,
    });
    expect(antwort.status).toBe(400);
  });

  test("höchstens 5 Ebenen", async () => {
    let eltern1: string | null = null;
    for (let i = 1; i <= 5; i++) {
      eltern1 = await lege(admin, {
        titel: `E${i}`,
        adresse: i === 1 ? eindeutig("tief") : `e${i}`,
        elternId: eltern1,
      });
    }
    const antwort = await anfrage(admin, "POST", BASIS, {
      titel: "Sechs",
      adresse: "e6",
      elternId: eltern1,
      sichtbarkeit: ANGEMELDET,
    });
    expect(antwort.status).toBe(400);
    expect(await fehlercode(antwort)).toBe("SEITE_ZU_TIEF");
  });

  test("Elternseite und Gruppe einer anderen Abteilung sind unbekannt (404)", async () => {
    const demoSeite = await lege(demoAdmin, {
      titel: "Demo",
      adresse: eindeutig("demo"),
    });
    const demoTag = await wegwerfTag(welt.demoAbteilungId, "team");
    for (const zusatz of [{ elternId: demoSeite }, { tagId: demoTag }]) {
      const antwort = await anfrage(admin, "POST", BASIS, {
        titel: "F",
        adresse: eindeutig("f"),
        sichtbarkeit: ANGEMELDET,
        ...zusatz,
      });
      expect(antwort.status).toBe(404);
    }
  });

  test("Tags der Sichtbarkeit müssen zur Abteilung gehören (400); eigene gehen", async () => {
    const demoTag = await wegwerfTag(welt.demoAbteilungId, "team");
    const eigenerTag = await wegwerfTag(welt.testabteilungId, "funktion");
    const fremd = await anfrage(admin, "POST", BASIS, {
      titel: "T",
      adresse: eindeutig("t"),
      sichtbarkeit: { art: "tags", tagIds: [demoTag] },
    });
    expect(fremd.status).toBe(400);
    const id = await lege(admin, {
      titel: "T",
      adresse: eindeutig("t"),
      sichtbarkeit: { art: "tags", tagIds: [eigenerTag] },
    });
    const gelesen = await anfrage(admin, "GET", `${BASIS}/${id}`);
    expect((await gelesen.json()) as object).toMatchObject({
      sichtbarkeit: { art: "tags", tagIds: [eigenerTag] },
    });
  });

  test("eine Gruppe hat höchstens eine Seite", async () => {
    const tagId = await wegwerfTag(welt.testabteilungId, "team");
    await lege(admin, { titel: "Team", adresse: eindeutig("team"), tagId });
    const zweite = await anfrage(admin, "POST", BASIS, {
      titel: "Team 2",
      adresse: eindeutig("team"),
      tagId,
      sichtbarkeit: ANGEMELDET,
    });
    expect(zweite.status).toBe(409);
    expect(await fehlercode(zweite)).toBe("TAG_VERGEBEN");
  });

  test.each([
    ["ohne Sichtbarkeit", { titel: "X", adresse: "x-ohne" }],
    [
      "unbekanntes Feld",
      { titel: "X", adresse: "x-feld", sichtbarkeit: ANGEMELDET, entwurf: {} },
    ],
    [
      "leerer Titel",
      { titel: " ", adresse: "x-leer", sichtbarkeit: ANGEMELDET },
    ],
    [
      "zu langer Titel",
      { titel: "x".repeat(151), adresse: "x-lang", sichtbarkeit: ANGEMELDET },
    ],
    [
      "Tags ohne Menge",
      { titel: "X", adresse: "x-tags", sichtbarkeit: { art: "tags" } },
    ],
  ])("%s: 400", async (_name, body) => {
    expect((await anfrage(admin, "POST", BASIS, body)).status).toBe(400);
  });
});

describe("Lesen", () => {
  test("Rechte je Seite: Stufenleitung nur an ihrer Stufe", async () => {
    expect((await anfrage(slA, "GET", `${BASIS}/${aId}`)).status).toBe(200);
    expect((await anfrage(slA, "GET", `${BASIS}/${bId}`)).status).toBe(403);
    expect((await anfrage(slA, "GET", `${BASIS}/${stufenId}`)).status).toBe(
      403,
    );
    expect((await anfrage(eltern, "GET", `${BASIS}/${aId}`)).status).toBe(403);
    const antwort = await anfrage(redaktion, "GET", `${BASIS}/${aId}`);
    expect(await antwort.json()).toEqual({
      id: aId,
      elternId: stufenId,
      adresse: "a",
      pfad: "/stufen/a",
      titel: "Stufe A",
      reihenfolge: 0,
      sichtbarkeit: ANGEMELDET,
      tagId: welt.stufeAId,
      veroeffentlicht: false,
    });
  });

  test("Fremdabteilung und unbekannte Seiten sind 404, vor 403", async () => {
    for (const konto of [demoAdmin, demoEltern, admin]) {
      const id = konto === admin ? randomUUID() : aId;
      for (const methode of ["GET", "PATCH", "DELETE"]) {
        const antwort = await anfrage(
          konto,
          methode,
          `${BASIS}/${id}`,
          methode === "PATCH" ? { titel: "X" } : undefined,
        );
        expect(antwort.status, `${methode} ${konto.benutzername}`).toBe(404);
      }
    }
    expect((await anfrage(admin, "GET", `${BASIS}/keine-uuid`)).status).toBe(
      400,
    );
  });
});

describe("Ändern und Verschieben", () => {
  test("Stufenleitung ändert Titel, Sichtbarkeit und Reihenfolge ihrer Seite; Audit nennt nur die Feldnamen", async () => {
    // Eigene Stufe und eigene Stufenleitung, damit die Seiten der Gruppe und die geteilte Persona unberührt bleiben
    const [stufe] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "stufe",
        name: `Stufe ${randomUUID()}`,
        kuerzel: "S",
      })
      .returning({ id: schema.tag.id });
    const sl = await legePersonaAn(welt, "slA");
    await db
      .insert(schema.rolle)
      .values({ userId: sl.id!, stufeId: stufe.id, typ: "stufenleitung" });
    const id = await lege(admin, {
      titel: "Alt",
      adresse: eindeutig("sl"),
      tagId: stufe.id,
    });
    const antwort = await anfrage(sl, "PATCH", `${BASIS}/${id}`, {
      titel: "Neuer geheimer Titel",
      sichtbarkeit: OEFFENTLICH,
      reihenfolge: 7,
    });
    expect(antwort.status).toBe(204);
    const [zeile] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, id));
    expect(zeile).toMatchObject({
      titel: "Neuer geheimer Titel",
      sichtbarkeit: "oeffentlich",
      sichtbarkeitTags: [],
      reihenfolge: 7,
    });
    const eintraege = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id),
          eq(schema.auditLog.aktion, "seite_geaendert"),
        ),
      );
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].details).toEqual({
      felder: ["titel", "reihenfolge", "sichtbarkeit"],
    });
    expect(JSON.stringify(eintraege[0])).not.toContain("geheimer");
  });

  test("Stufenleitung ändert keine fremde Seite, setzt nicht auf die oberste Ebene und ändert die Gruppe nicht", async () => {
    expect(
      (await anfrage(slA, "PATCH", `${BASIS}/${bId}`, { titel: "X" })).status,
    ).toBe(403);
    // oberste Ebene, andere Elternseite ohne Recht, andere Gruppe
    for (const body of [
      { elternId: null },
      { elternId: vereinId },
      { tagId: welt.stufeBId },
      { tagId: null },
    ]) {
      expect(
        (await anfrage(slA, "PATCH", `${BASIS}/${aId}`, body)).status,
        JSON.stringify(body),
      ).toBe(403);
    }
    const [zeile] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, aId));
    expect(zeile).toMatchObject({ elternId: stufenId, tagId: welt.stufeAId });
  });

  test("Redaktion verschiebt; Zyklus, Selbstbezug und Tiefe werden abgelehnt", async () => {
    const wurzel = await lege(redaktion, {
      titel: "W",
      adresse: eindeutig("w"),
    });
    const mitte = await lege(redaktion, {
      titel: "M",
      adresse: "m",
      elternId: wurzel,
    });
    const blatt = await lege(redaktion, {
      titel: "B",
      adresse: "b",
      elternId: mitte,
    });
    const code = async (id: string, elternId: string | null) => {
      const antwort = await anfrage(redaktion, "PATCH", `${BASIS}/${id}`, {
        elternId,
      });
      return [
        antwort.status,
        antwort.status === 204 ? null : await fehlercode(antwort),
      ];
    };
    expect(await code(wurzel, wurzel)).toEqual([400, "SEITE_ZYKLUS"]);
    expect(await code(wurzel, blatt)).toEqual([400, "SEITE_ZYKLUS"]);
    expect(await code(mitte, blatt)).toEqual([400, "SEITE_ZYKLUS"]);
    // Teilbaum mit 3 Ebenen unter die dritte Ebene einer Kette von 3: 6 Ebenen
    const k1 = await lege(redaktion, { titel: "K1", adresse: eindeutig("k") });
    const k2 = await lege(redaktion, {
      titel: "K2",
      adresse: "k2",
      elternId: k1,
    });
    const k3 = await lege(redaktion, {
      titel: "K3",
      adresse: "k3",
      elternId: k2,
    });
    expect(await code(wurzel, k3)).toEqual([400, "SEITE_ZU_TIEF"]);
    expect(await code(wurzel, k2)).toEqual([204, null]);
    // Auf die oberste Ebene zurück
    expect(await code(wurzel, null)).toEqual([204, null]);
    const [zeile] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, wurzel));
    expect(zeile.elternId).toBeNull();
  });

  test("zwei gleichzeitige Verschiebungen ergeben keinen Zyklus", async () => {
    const x = await lege(redaktion, { titel: "X", adresse: eindeutig("x") });
    const y = await lege(redaktion, { titel: "Y", adresse: eindeutig("y") });
    const antworten = await Promise.all([
      anfrage(redaktion, "PATCH", `${BASIS}/${x}`, { elternId: y }),
      anfrage(redaktion, "PATCH", `${BASIS}/${y}`, { elternId: x }),
    ]);
    expect(antworten.map((a) => a.status).sort()).toEqual([204, 400]);
  });

  test("reservierte Adresse beim Umbenennen und beim Verschieben auf die oberste Ebene", async () => {
    const id = await lege(admin, { titel: "R", adresse: eindeutig("r") });
    const antwort = await anfrage(admin, "PATCH", `${BASIS}/${id}`, {
      adresse: "api",
    });
    expect(antwort.status).toBe(400);
    expect(await fehlercode(antwort)).toBe("ADRESSE_RESERVIERT");
    const unten = await lege(admin, {
      titel: "U",
      adresse: "api",
      elternId: id,
    });
    const hoch = await anfrage(admin, "PATCH", `${BASIS}/${unten}`, {
      elternId: null,
    });
    expect(hoch.status).toBe(400);
    expect(await fehlercode(hoch)).toBe("ADRESSE_RESERVIERT");
  });

  test("Adresse einer Geschwisterseite: 409; die eigene Adresse erneut setzen: 204", async () => {
    const eltern1 = await lege(admin, { titel: "P", adresse: eindeutig("p") });
    await lege(admin, { titel: "Eins", adresse: "eins", elternId: eltern1 });
    const zwei = await lege(admin, {
      titel: "Zwei",
      adresse: "zwei",
      elternId: eltern1,
    });
    const antwort = await anfrage(admin, "PATCH", `${BASIS}/${zwei}`, {
      adresse: "eins",
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("ADRESSE_VERGEBEN");
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${zwei}`, { adresse: "zwei" }))
        .status,
    ).toBe(204);
  });

  test("Gruppe ändern nur mit Recht zum Anlegen; Tags der Sichtbarkeit aus fremder Abteilung 400", async () => {
    const tagId = await wegwerfTag(welt.testabteilungId, "team");
    const id = await lege(admin, { titel: "G", adresse: eindeutig("g") });
    expect(
      (await anfrage(redaktion, "PATCH", `${BASIS}/${id}`, { tagId })).status,
    ).toBe(204);
    const demoTag = await wegwerfTag(welt.demoAbteilungId, "team");
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${id}`, { tagId: demoTag }))
        .status,
    ).toBe(404);
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${id}`, {
          sichtbarkeit: { art: "tags", tagIds: [demoTag] },
        })
      ).status,
    ).toBe(400);
  });

  test.each([
    ["leer", {}],
    ["unbekanntes Feld", { entwurf: {} }],
    ["ungültige Adresse", { adresse: "Gross" }],
  ])("%s: 400", async (_name, body) => {
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${vereinId}`, body)).status,
    ).toBe(400);
  });
});

describe("Löschen", () => {
  test("mit Unterseiten 409, ohne 204; Audit ohne Inhalt; Recht auf die Seite fällt weg", async () => {
    const eltern1 = await lege(admin, {
      titel: "Eltern",
      adresse: eindeutig("l"),
    });
    const kind = await lege(admin, {
      titel: "Kind",
      adresse: "kind",
      elternId: eltern1,
    });
    const mit = await anfrage(admin, "DELETE", `${BASIS}/${eltern1}`);
    expect(mit.status).toBe(409);
    expect(await fehlercode(mit)).toBe("SEITE_HAT_UNTERSEITEN");
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: kind,
      userId: ohneRecht.id!,
    });
    expect((await anfrage(admin, "DELETE", `${BASIS}/${kind}`)).status).toBe(
      204,
    );
    expect(
      await db
        .select()
        .from(schema.bearbeiter)
        .where(eq(schema.bearbeiter.objektId, kind)),
    ).toEqual([]);
    expect((await anfrage(admin, "GET", `${BASIS}/${kind}`)).status).toBe(404);
    expect(
      (await anfrage(redaktion, "DELETE", `${BASIS}/${eltern1}`)).status,
    ).toBe(204);
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, eltern1),
          eq(schema.auditLog.aktion, "seite_geloescht"),
        ),
      );
    expect(eintrag).toMatchObject({ akteurId: redaktion.id, details: {} });
  });

  test("die Stufenleitung der Seite löscht nicht", async () => {
    expect((await anfrage(slA, "DELETE", `${BASIS}/${aId}`)).status).toBe(403);
  });

  test("Versionen verschwinden mit der Seite", async () => {
    const id = await lege(admin, { titel: "V", adresse: eindeutig("v") });
    await db
      .insert(schema.seiteVersion)
      .values({ seiteId: id, nr: 1, inhalt: { v: 1 } });
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(
      await db
        .select()
        .from(schema.seiteVersion)
        .where(eq(schema.seiteVersion.seiteId, id)),
    ).toEqual([]);
  });
});

describe("Ereignisse", () => {
  test("Anlegen, Ändern und Löschen melden je ein Ereignis", async () => {
    const empfangen: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void empfangen.push(e));
    try {
      const id = await lege(admin, { titel: "E", adresse: eindeutig("e") });
      await anfrage(admin, "PATCH", `${BASIS}/${id}`, { titel: "E2" });
      await anfrage(admin, "DELETE", `${BASIS}/${id}`);
      // Abgelehnte Änderungen melden nichts
      await anfrage(slB, "PATCH", `${BASIS}/${aId}`, { titel: "X" });
      const meine = empfangen.filter((e) => e.seiteId === id);
      expect(meine.map((e) => e.art)).toEqual([
        "seite_geaendert",
        "seite_geaendert",
        "seite_geloescht",
      ]);
      expect(meine[0].abteilungId).toBe(welt.testabteilungId);
      expect(empfangen.some((e) => e.seiteId === aId)).toBe(false);
    } finally {
      ab();
    }
  });
});

describe("Datenbank", () => {
  const seite = async (
    zusatz: Partial<typeof schema.seite.$inferInsert> = {},
  ) => {
    const [z] = await db
      .insert(schema.seite)
      .values({
        abteilungId: welt.testabteilungId,
        adresse: eindeutig("db"),
        titel: "DB",
        sichtbarkeit: "angemeldet",
        ...zusatz,
      })
      .returning({ id: schema.seite.id });
    return z.id;
  };
  const code = async (f: () => Promise<unknown>) =>
    f().then(
      () => null,
      (e: { cause?: { code?: string } }) => e.cause?.code ?? "unbekannt",
    );

  test("eine Version bleibt, wie sie ist: UPDATE verboten, INSERT und Lesen gehen", async () => {
    const id = await seite();
    await db
      .insert(schema.seiteVersion)
      .values({ seiteId: id, nr: 1, inhalt: { a: 1 } });
    expect(
      await code(() =>
        db
          .update(schema.seiteVersion)
          .set({ inhalt: { a: 2 } })
          .where(eq(schema.seiteVersion.seiteId, id)),
      ),
    ).toBe("42501");
    const [v] = await db
      .select()
      .from(schema.seiteVersion)
      .where(eq(schema.seiteVersion.seiteId, id));
    expect(v.inhalt).toEqual({ a: 1 });
    // laufende Nummer je Seite eindeutig
    expect(
      await code(() =>
        db
          .insert(schema.seiteVersion)
          .values({ seiteId: id, nr: 1, inhalt: {} }),
      ),
    ).toBe("23505");
  });

  test("Zeiger auf die veröffentlichte Version; fällt die Version weg, bleibt die Seite", async () => {
    const id = await seite();
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: id, nr: 1, inhalt: {} })
      .returning({ id: schema.seiteVersion.id });
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v.id })
      .where(eq(schema.seite.id, id));
    await db
      .delete(schema.seiteVersion)
      .where(eq(schema.seiteVersion.id, v.id));
    const [z] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, id));
    expect(z.veroeffentlichteVersionId).toBeNull();
  });

  test("eine Gruppe, eine Herkunft je Abteilung, Adresse je Elternseite (auch oben) eindeutig", async () => {
    const tagId = await wegwerfTag(welt.testabteilungId, "team");
    await seite({ tagId });
    expect(await code(() => seite({ tagId }))).toBe("23505");
    const herkunft = eindeutig("alt");
    await seite({ herkunft });
    expect(await code(() => seite({ herkunft }))).toBe("23505");
    await db.insert(schema.seite).values({
      abteilungId: welt.demoAbteilungId,
      adresse: eindeutig("db"),
      titel: "DB",
      sichtbarkeit: "angemeldet",
      herkunft,
    });
    // Oberste Ebene: NULL gilt als gleich
    const adresse = eindeutig("oben");
    await seite({ adresse });
    expect(await code(() => seite({ adresse }))).toBe("23505");
  });

  test("CHECKs: Adresse, Titel, Sichtbarkeit", async () => {
    expect(await code(() => seite({ adresse: "Gross" }))).toBe("23514");
    expect(await code(() => seite({ adresse: "a".repeat(61) }))).toBe("23514");
    expect(await code(() => seite({ titel: "" }))).toBe("23514");
    expect(
      await code(() => seite({ sichtbarkeit: "alle" as unknown as "tags" })),
    ).toBe("23514");
  });

  test("ein gelöschter Tag lässt die Seite stehen (tag_id leer)", async () => {
    const tagId = await wegwerfTag(welt.testabteilungId, "team");
    const id = await seite({ tagId });
    await db.delete(schema.tag).where(eq(schema.tag.id, tagId));
    const [z] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, id));
    expect(z.tagId).toBeNull();
  });

  test("eine Seite mit Unterseiten lässt sich in der Datenbank nicht löschen", async () => {
    const eltern1 = await seite();
    await seite({ elternId: eltern1 });
    expect(
      await code(() =>
        db.delete(schema.seite).where(eq(schema.seite.id, eltern1)),
      ),
    ).toBe("23001");
  });
});
