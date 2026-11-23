import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import {
  EINSTELLUNG_VORGABE,
  ladeEinstellung,
  ladeLadenDaten,
} from "../src/laden/laden.js";
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

// Lädeli-Einstellungen (#642): Regeln und Texte der Abteilung. Standardwerte entsprechen den Annahmen vor #642; der Server erzwingt jede Regel.
const fcm = bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = {
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  fcm,
  seiten: ladeSeiten(),
};
let app = erstelleApp(optionen);
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let eltern: PersonaKonto;
let sl: PersonaKonto;
let demoAdmin: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  eltern = await legePersonaAn(welt, "elternA");
  sl = await legePersonaAn(welt, "slA");
  demoAdmin = await legePersonaAn(welt, "demoAdmin");
});
beforeEach(async () => {
  app = erstelleApp(optionen);
  await db
    .delete(schema.ladenBestellung)
    .where(
      inArray(schema.ladenBestellung.abteilungId, [
        welt.testabteilungId,
        welt.demoAbteilungId,
      ]),
    );
  await db
    .delete(schema.ladenEinstellung)
    .where(
      inArray(schema.ladenEinstellung.abteilungId, [
        welt.testabteilungId,
        welt.demoAbteilungId,
      ]),
    );
});

const aufruf = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) =>
  app.request(`/api/v1${pfad}`, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;
const setze = (body: Record<string, unknown>) =>
  aufruf(admin, "PUT", "/admin/laden/einstellungen", body);
const ABHOLUNG = "Abholung im Lädeli";

async function neuerArtikel(preisRappen = 1500) {
  const [a] = await db
    .insert(schema.ladenArtikel)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Artikel ${randomUUID().slice(0, 8)}`,
      preisRappen,
    })
    .returning();
  return a!;
}
const bestelle = (
  positionen: { artikelId: string; menge: number }[],
  mehr: Record<string, unknown> = {},
) =>
  aufruf(eltern, "POST", "/laden/bestellungen", {
    positionen,
    uebergabe: ABHOLUNG,
    ...mehr,
  });

describe("Standardwerte", () => {
  test("ohne Zeile gelten die Annahmen von vor #642, in Verwaltung und im Laden", async () => {
    const v = await json(
      await aufruf(admin, "GET", "/admin/laden/einstellungen"),
    );
    expect(v).toMatchObject({
      uebergabearten: [ABHOLUNG],
      bestellenOffen: true,
      schnellDazu: true,
      preiseOeffentlich: true,
      maxMenge: 10,
      maxPositionen: 20,
      maxOffene: 5,
      mindestRappen: 0,
      bezahlhinweis: "Bezahlt wird bei der Übergabe, nicht online.",
      zahlungsart: "Bei der Übergabe",
      uebergabehinweis: "",
      bedingungen: "",
    });
    expect(v.vorgaben).toEqual(EINSTELLUNG_VORGABE);
    const laden = await json(await aufruf(eltern, "GET", "/laden"));
    expect(laden.grenzen).toEqual({
      positionen: 20,
      menge: 10,
      offeneBestellungen: 5,
    });
    expect(laden.einstellungen.bezahlhinweis).toBe(v.bezahlhinweis);
    expect(laden.einstellungen.uebergabearten).toBeUndefined();
  });

  test("ein Text, der der Vorgabe gleicht, wird als null gespeichert; ein leerer Text bleibt leer", async () => {
    expect(
      (
        await setze({
          bezahlhinweis: EINSTELLUNG_VORGABE.bezahlhinweis,
          zahlungsart: "",
          bedingungen: "Umtausch nur mit Beleg.",
        })
      ).status,
    ).toBe(204);
    const [z] = await db
      .select()
      .from(schema.ladenEinstellung)
      .where(eq(schema.ladenEinstellung.abteilungId, welt.testabteilungId));
    expect(z!.bezahlhinweis).toBeNull();
    expect(z!.zahlungsart).toBe("");
    const e = await ladeEinstellung(db, welt.testabteilungId);
    expect(e.bezahlhinweis).toBe(EINSTELLUNG_VORGABE.bezahlhinweis);
    expect(e.zahlungsart).toBe("");
    expect(e.bedingungen).toBe("Umtausch nur mit Beleg.");
  });
});

describe("Einstellungen speichern", () => {
  test("nur die Abteilungsleitung; fremde Abteilung wirkt nur auf die eigene; Meldung an die Website", async () => {
    expect(
      (
        await aufruf(sl, "PUT", "/admin/laden/einstellungen", {
          schnellDazu: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (await aufruf(eltern, "GET", "/admin/laden/einstellungen")).status,
    ).toBe(403);
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    expect((await setze({ schnellDazu: false })).status).toBe(204);
    ab();
    expect(ereignisse).toContainEqual({
      art: "laden_geaendert",
      abteilungId: welt.testabteilungId,
    });
    expect((await ladeEinstellung(db, welt.testabteilungId)).schnellDazu).toBe(
      false,
    );
    // Die Demo-Abteilung bleibt bei den Vorgaben
    expect((await ladeEinstellung(db, welt.demoAbteilungId)).schnellDazu).toBe(
      true,
    );
    // Eine andere Person der Abteilungsleitung ändert nur seine eigene Abteilung
    expect(
      (
        await aufruf(demoAdmin, "PUT", "/admin/laden/einstellungen", {
          maxMenge: 3,
        })
      ).status,
    ).toBe(204);
    expect((await ladeEinstellung(db, welt.testabteilungId)).maxMenge).toBe(10);
  });

  test("Felder ohne Schlüssel bleiben; das Protokoll nennt nur Namen der Felder, nie Texte", async () => {
    await setze({ bedingungen: "Geheimer Text XY", maxMenge: 4 });
    await setze({ schnellDazu: false });
    const e = await ladeEinstellung(db, welt.testabteilungId);
    expect(e).toMatchObject({
      bedingungen: "Geheimer Text XY",
      maxMenge: 4,
      schnellDazu: false,
    });
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, welt.testabteilungId));
    expect(JSON.stringify(zeilen)).not.toContain("Geheimer");
    // Die Einträge nennen nur Namen der Felder
    expect(
      zeilen
        .filter((z) => z.aktion === "laden_einstellung_geaendert")
        .map((z) => JSON.stringify(z.details)),
    ).toEqual(
      expect.arrayContaining([
        '{"felder":["maxMenge","bedingungen"]}',
        '{"felder":["schnellDazu"]}',
      ]),
    );
  });

  test("ungültige Eingaben: 400 und nichts gespeichert", async () => {
    for (const schlecht of [
      { maxMenge: 0 },
      { maxMenge: 100 },
      { maxPositionen: 51 },
      { maxOffene: 21 },
      { mindestRappen: -1 },
      { mindestRappen: 1_000_001 },
      { mindestRappen: 12.5 },
      { bezahlhinweis: "x".repeat(121) },
      { zahlungsart: "x".repeat(61) },
      { bestaetigung: "x".repeat(241) },
      { uebergabehinweis: "x".repeat(201) },
      { bedingungen: "x".repeat(601) },
      { geschlossenText: "x".repeat(201) },
      { bezahlhinweis: "a\u0000b" },
      { bedingungen: "a\u0007b" },
      { schnellDazu: "ja" },
      { unbekannt: 1 },
    ]) {
      expect((await setze(schlecht)).status, JSON.stringify(schlecht)).toBe(
        400,
      );
    }
    // Zeilenumbrüche sind in den Bedingungen erlaubt
    expect((await setze({ bedingungen: "Eins\nZwei" })).status).toBe(204);
    const zeilen = await db
      .select()
      .from(schema.ladenEinstellung)
      .where(eq(schema.ladenEinstellung.abteilungId, welt.testabteilungId));
    expect(zeilen[0]?.maxMenge).toBe(10);
  });
});

describe("Der Server erzwingt die Regeln beim Bestellen", () => {
  test("geschlossen: 409 LADEN_GESCHLOSSEN mit dem Text der Abteilung, nichts entsteht", async () => {
    const a = await neuerArtikel();
    await setze({
      bestellenOffen: false,
      geschlossenText: "Bis zum Herbst zu.",
    });
    const r = await bestelle([{ artikelId: a.id, menge: 1 }]);
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({
      code: "LADEN_GESCHLOSSEN",
      message: "Bis zum Herbst zu.",
    });
    // Leerer Text: der Standardtext
    await setze({ geschlossenText: "" });
    expect(
      (await json(await bestelle([{ artikelId: a.id, menge: 1 }]))).message,
    ).toBe(EINSTELLUNG_VORGABE.geschlossenText);
    await setze({ bestellenOffen: true });
    expect((await bestelle([{ artikelId: a.id, menge: 1 }])).status).toBe(201);
  });

  test("grösste Menge, Positionen und offene Bestellungen gelten je Abteilung", async () => {
    const a = await neuerArtikel();
    const b = await neuerArtikel();
    await setze({ maxMenge: 3, maxPositionen: 1, maxOffene: 2 });
    const zuViel = await bestelle([{ artikelId: a.id, menge: 4 }]);
    expect(zuViel.status).toBe(400);
    expect((await json(zuViel)).code).toBe("MENGE_ZU_GROSS");
    const zwei = await bestelle([
      { artikelId: a.id, menge: 1 },
      { artikelId: b.id, menge: 1 },
    ]);
    expect(zwei.status).toBe(400);
    expect((await json(zwei)).code).toBe("POSITIONEN_ZU_VIELE");
    expect((await bestelle([{ artikelId: a.id, menge: 3 }])).status).toBe(201);
    expect((await bestelle([{ artikelId: a.id, menge: 1 }])).status).toBe(201);
    const limit = await bestelle([{ artikelId: a.id, menge: 1 }]);
    expect(limit.status).toBe(409);
    const d = await json(limit);
    expect(d.code).toBe("BESTELL_LIMIT");
    expect(d.message).toContain("schon 2 offene");
    // GET /laden nennt dieselben Grenzen
    expect((await json(await aufruf(eltern, "GET", "/laden"))).grenzen).toEqual(
      {
        positionen: 1,
        menge: 3,
        offeneBestellungen: 2,
      },
    );
  });

  test("eine Menge bis 99 ist möglich, wenn die Abteilung sie erlaubt", async () => {
    const a = await neuerArtikel(100);
    await setze({ maxMenge: 99 });
    const r = await bestelle([{ artikelId: a.id, menge: 99 }]);
    expect(r.status).toBe(201);
    expect((await json(r)).summeRappen).toBe(9900);
    // Über der Obergrenze lehnt schon die Eingabe ab
    expect((await bestelle([{ artikelId: a.id, menge: 100 }])).status).toBe(
      400,
    );
  });

  test("Mindestbestellung: darunter 409 MINDESTBESTELLUNG mit der Grenze, genau am Wert geht es", async () => {
    const a = await neuerArtikel(1000);
    await setze({ mindestRappen: 2500 });
    const zuWenig = await bestelle([{ artikelId: a.id, menge: 2 }]);
    expect(zuWenig.status).toBe(409);
    expect(await json(zuWenig)).toMatchObject({
      code: "MINDESTBESTELLUNG",
      mindestRappen: 2500,
      message: "Die Mindestbestellung beträgt CHF 25.–.",
    });
    expect((await bestelle([{ artikelId: a.id, menge: 3 }])).status).toBe(201);
    await setze({ mindestRappen: 2000 });
    expect((await bestelle([{ artikelId: a.id, menge: 2 }])).status).toBe(201);
  });

  test("Übergabearten aus den Einstellungen gelten weiter", async () => {
    const a = await neuerArtikel();
    await setze({ uebergabearten: ["Am Samstag", "Per Post"] });
    expect((await bestelle([{ artikelId: a.id, menge: 1 }])).status).toBe(400);
    expect(
      (
        await bestelle([{ artikelId: a.id, menge: 1 }], {
          uebergabe: "Am Samstag",
        })
      ).status,
    ).toBe(201);
  });
});

describe("Die Website bekommt die Einstellungen", () => {
  test("die Datenquelle liefert sie, erst nach dem Speichern mit den neuen Werten", async () => {
    await neuerArtikel();
    const dokumente = new Map([
      [
        randomUUID(),
        {
          bausteine: [{ typ: "laden" }],
        },
      ],
    ]) as unknown as Parameters<typeof ladeLadenDaten>[3];
    const vorher = await ladeLadenDaten(
      db,
      welt.testabteilungId,
      [],
      dokumente,
    );
    expect(vorher.ladenEinstellung?.get("e")?.preiseOeffentlich).toBe(true);
    await setze({ preiseOeffentlich: false, uebergabehinweis: "Samstags." });
    const nachher = await ladeLadenDaten(
      db,
      welt.testabteilungId,
      [],
      dokumente,
    );
    expect(nachher.ladenEinstellung?.get("e")).toMatchObject({
      preiseOeffentlich: false,
      uebergabehinweis: "Samstags.",
    });
    // Ohne den Baustein «laden» keine Abfrage und keine Daten
    expect(
      await ladeLadenDaten(db, welt.testabteilungId, [], new Map()),
    ).toEqual({});
  });
});
