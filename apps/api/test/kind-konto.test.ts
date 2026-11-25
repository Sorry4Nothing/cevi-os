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
import { normalisiereStartpasswort } from "../src/startpasswort.js";
import {
  APP,
  bereiteAuthTestsVor,
  cookiesAus,
  erstelleTestAuth,
  zufallsIp,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

// Kind mit eigenem Konto (#644): anlegen, übergeben, sperren, entfernen und vor allem: was das Konto sieht und nie sieht

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
let admin: PersonaKonto;
let demoAdmin: PersonaKonto;
let elternA: PersonaKonto;
let slA: PersonaKonto;
let programmA: string;
let programmB: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const KINDER = "/api/v1/admin/kinder";
const FENSTER = "von=2027-01-01&bis=2027-12-31";

function anfrage(
  konto: Pick<PersonaKonto, "headers">,
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
const lesen = async <T = Record<string, unknown>>(antwort: Response) =>
  (await antwort.json()) as T;

const heute = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

const einstellen = (werte: Partial<Record<string, unknown>> = {}) =>
  anfrage(admin, "PUT", `${KINDER}/konto-einstellung`, {
    erlaubt: true,
    chat: "aus",
    mindestalter: null,
    elternEinsichtVorgabe: true,
    ...werte,
  });

async function neuesKind(stufeId = welt.stufeAId, nachname = "Konto") {
  const [k] = await db
    .insert(schema.kind)
    .values({
      abteilungId: welt.testabteilungId,
      vorname: "Test",
      nachname: `${nachname}-${randomUUID().slice(0, 6)}`,
      stufeId,
    })
    .returning({ id: schema.kind.id });
  return k.id;
}

const kontoBody = (extra: Record<string, unknown> = {}) => ({
  benutzername: `kind.${randomUUID().slice(0, 8)}`,
  elternInformiertAm: heute(),
  ...extra,
});

interface Angelegt {
  benutzername: string;
  startpasswort: string;
}
async function legeKontoAn(
  kindId: string,
  extra: Record<string, unknown> = {},
) {
  const antwort = await anfrage(
    admin,
    "POST",
    `${KINDER}/${kindId}/konto`,
    kontoBody(extra),
  );
  expect(antwort.status).toBe(201);
  return lesen<Angelegt>(antwort);
}

const anmelden = (benutzername: string, passwort: string) =>
  auth.api.signInUsername({
    body: { username: benutzername, password: passwort },
    returnHeaders: true,
  });

// Das Konto mit Startpasswort anmelden und den Pflichtwechsel überspringen: Die Sicht ist das Thema, nicht der Passwortwechsel
async function kindKonto(
  kindId: string,
  extra: Record<string, unknown> = {},
): Promise<PersonaKonto & { id: string; benutzername: string }> {
  const angelegt = await legeKontoAn(kindId, extra);
  const anmeldung = await anmelden(
    angelegt.benutzername,
    normalisiereStartpasswort(angelegt.startpasswort),
  );
  const [k] = await db
    .select({ userId: schema.kind.userId })
    .from(schema.kind)
    .where(eq(schema.kind.id, kindId));
  await db
    .update(schema.user)
    .set({ mussPasswortAendern: false })
    .where(eq(schema.user.id, k.userId!));
  return {
    id: k.userId!,
    benutzername: angelegt.benutzername,
    passwort: null,
    abteilungId: welt.testabteilungId,
    headers: {
      "expo-origin": APP,
      "x-forwarded-for": zufallsIp(),
      cookie: cookiesAus(anmeldung),
    },
  };
}

const kindZeile = async (id: string) =>
  (await db.select().from(schema.kind).where(eq(schema.kind.id, id)))[0];
const userZeile = async (id: string) =>
  (await db.select().from(schema.user).where(eq(schema.user.id, id)))[0];
const auditFuer = (zielId: string, aktion: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.zielId, zielId),
        eq(schema.auditLog.aktion, aktion),
      ),
    );

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  demoAdmin = await legePersonaAn(welt, "demoAdmin");
  elternA = await legePersonaAn(welt, "elternA");
  slA = await legePersonaAn(welt, "slA");
  await db
    .update(schema.user)
    .set({ telefon: "+41 79 000 00 00" })
    .where(eq(schema.user.id, slA.id!));
  programmA = (
    await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      titel: "Programm A",
    })
  ).id;
  programmB = (
    await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeBId],
      titel: "Programm B",
    })
  ).id;
});

describe("Einstellungen der Abteilung", () => {
  test("ohne Zeile gilt die vorsichtige Vorgabe: Konten aus, Chat aus, Eltern behalten die Einsicht", async () => {
    const antwort = await anfrage(admin, "GET", `${KINDER}/konto-einstellung`);
    expect(antwort.status).toBe(200);
    expect(await lesen(antwort)).toEqual({
      erlaubt: false,
      chat: "aus",
      mindestalter: null,
      elternEinsichtVorgabe: true,
    });
  });

  test("ohne Einstellung «erlaubt» entsteht kein Konto (409 KONTEN_AUS)", async () => {
    // Eine Abteilung ohne Zeile: die Demo-Abteilung der Welt
    const [demoKind] = await db
      .select({ id: schema.kind.id })
      .from(schema.kind)
      .where(eq(schema.kind.abteilungId, welt.demoAbteilungId));
    const antwort = await anfrage(
      demoAdmin,
      "POST",
      `${KINDER}/${demoKind.id}/konto`,
      kontoBody(),
    );
    expect(antwort.status).toBe(409);
    expect((await lesen<{ code: string }>(antwort)).code).toBe("KONTEN_AUS");
  });

  test("speichern, lesen und ungültige Werte; nur die Abteilungsleitung; Audit ohne Personendaten", async () => {
    expect((await einstellen({ chat: "lesen", mindestalter: 11 })).status).toBe(
      204,
    );
    expect(
      await lesen(await anfrage(admin, "GET", `${KINDER}/konto-einstellung`)),
    ).toEqual({
      erlaubt: true,
      chat: "lesen",
      mindestalter: 11,
      elternEinsichtVorgabe: true,
    });
    expect((await einstellen({ chat: "alle" })).status).toBe(400);
    expect((await einstellen({ mindestalter: 3 })).status).toBe(400);
    expect(
      (
        await anfrage(slA, "PUT", `${KINDER}/konto-einstellung`, {
          erlaubt: true,
          chat: "aus",
          mindestalter: null,
          elternEinsichtVorgabe: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (await anfrage(elternA, "GET", `${KINDER}/konto-einstellung`)).status,
    ).toBe(403);
    await einstellen({ chat: "aus", mindestalter: null });
  });
});

describe("POST /api/v1/admin/kinder/:id/konto", () => {
  beforeAll(async () => {
    expect((await einstellen()).status).toBe(204);
  });

  test("das Konto eines Kindes ist nie Elternteil eines Kindes: PATCH mit seiner ID gibt 400, nichts verknüpft (#777)", async () => {
    const kontoKind = await neuesKind();
    await legeKontoAn(kontoKind);
    const [k] = await db
      .select({ userId: schema.kind.userId })
      .from(schema.kind)
      .where(eq(schema.kind.id, kontoKind));
    const anderes = await neuesKind();
    const antwort = await anfrage(admin, "PATCH", `${KINDER}/${anderes}`, {
      eltern: [k.userId],
    });
    expect(antwort.status).toBe(400);
    expect(
      await db
        .select()
        .from(schema.kindEltern)
        .where(eq(schema.kindEltern.kindId, anderes)),
    ).toEqual([]);
  });

  test("legt ein gewöhnliches Konto ohne Rolle an: Teilnehmer, keine Eltern-Verknüpfung, Startpasswort einmal, Audit ohne Namen", async () => {
    const kindId = await neuesKind();
    const angelegt = await legeKontoAn(kindId);
    expect(angelegt.startpasswort).toMatch(
      /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
    );
    const kind = await kindZeile(kindId);
    expect(kind.userId).not.toBeNull();
    expect(kind.kontoSeit).toBeInstanceOf(Date);
    expect(kind.elternInformiertAm).toBe(heute());
    expect(kind.elternEinsicht).toBe(true);
    const konto = await userZeile(kind.userId!);
    expect(konto.role).toBe("user");
    expect(konto.mussPasswortAendern).toBe(true);
    // 7 Tage gültig
    const tage =
      (konto.startpasswortGueltigBis!.getTime() - Date.now()) / 86_400_000;
    expect(tage).toBeGreaterThan(6.9);
    expect(tage).toBeLessThanOrEqual(7);
    expect(
      await db
        .select()
        .from(schema.rolle)
        .where(eq(schema.rolle.userId, konto.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.kindEltern)
        .where(eq(schema.kindEltern.userId, konto.id)),
    ).toEqual([]);
    const [eintrag] = await auditFuer(kindId, "kind_konto_erstellt");
    expect(eintrag.akteurId).toBe(admin.id);
    const text = JSON.stringify(eintrag);
    expect(text).not.toContain(angelegt.benutzername);
    expect(text).not.toContain(angelegt.startpasswort);
  });

  test("mit dem Startpasswort meldet sich das Kind an; bis zum Passwortwechsel gilt nur das eigene Profil", async () => {
    const kindId = await neuesKind();
    const angelegt = await legeKontoAn(kindId);
    const anmeldung = await anmelden(
      angelegt.benutzername,
      normalisiereStartpasswort(angelegt.startpasswort),
    );
    const headers = {
      "expo-origin": APP,
      "x-forwarded-for": zufallsIp(),
      cookie: cookiesAus(anmeldung),
    };
    const ich = await app.request("/api/v1/ich", { headers });
    expect(ich.status).toBe(200);
    const profil = await lesen<Record<string, unknown>>(ich);
    expect(profil.mussPasswortAendern).toBe(true);
    expect(profil.abteilungsleitung).toBe(false);
    expect(profil.rollen).toEqual([]);
    const programme = await app.request(`/api/v1/programme?${FENSTER}`, {
      headers,
    });
    expect(programme.status).toBe(403);
  });

  test("Pflichtangaben: Datum des Vermerks, gültiges Datum, Benutzername, keine fremden Felder", async () => {
    const kindId = await neuesKind();
    const post = (body: Record<string, unknown>) =>
      anfrage(admin, "POST", `${KINDER}/${kindId}/konto`, body);
    expect((await post({ benutzername: "nur.name" })).status).toBe(400);
    expect(
      (await post(kontoBody({ elternInformiertAm: "gestern" }))).status,
    ).toBe(400);
    expect((await post(kontoBody({ benutzername: "a" }))).status).toBe(400);
    expect((await post(kontoBody({ admin: true }))).status).toBe(400);
    expect((await post(kontoBody({ userId: randomUUID() }))).status).toBe(400);
    const morgen = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const zukunft = await post(kontoBody({ elternInformiertAm: morgen }));
    expect(zukunft.status).toBe(400);
    expect((await lesen<{ code: string }>(zukunft)).code).toBe(
      "DATUM_UNGUELTIG",
    );
    const alt = await post(kontoBody({ elternInformiertAm: "2020-01-01" }));
    expect(alt.status).toBe(400);
    expect((await kindZeile(kindId)).userId).toBeNull();
  });

  test("ein inaktives Kind, ein zweites Konto und ein vergebener Benutzername sind 409", async () => {
    const inaktiv = await neuesKind();
    await db
      .update(schema.kind)
      .set({ inaktivSeit: new Date() })
      .where(eq(schema.kind.id, inaktiv));
    const a = await anfrage(
      admin,
      "POST",
      `${KINDER}/${inaktiv}/konto`,
      kontoBody(),
    );
    expect(a.status).toBe(409);
    expect((await lesen<{ code: string }>(a)).code).toBe("KIND_INAKTIV");

    const kindId = await neuesKind();
    const angelegt = await legeKontoAn(kindId);
    const zweites = await anfrage(
      admin,
      "POST",
      `${KINDER}/${kindId}/konto`,
      kontoBody(),
    );
    expect(zweites.status).toBe(409);
    expect((await lesen<{ code: string }>(zweites)).code).toBe(
      "KONTO_VORHANDEN",
    );

    const anderes = await neuesKind();
    const vergeben = await anfrage(
      admin,
      "POST",
      `${KINDER}/${anderes}/konto`,
      kontoBody({ benutzername: angelegt.benutzername.toUpperCase() }),
    );
    expect(vergeben.status).toBe(409);
    expect((await lesen<{ code: string }>(vergeben)).code).toBe(
      "BENUTZERNAME_VERGEBEN",
    );
    // Der Fehlschlag hinterlässt kein halbes Konto
    expect((await kindZeile(anderes)).userId).toBeNull();
  });

  test("nur die Abteilungsleitung; ein fremdes Kind ist 404, vor dem Recht", async () => {
    const kindId = await neuesKind();
    for (const konto of [slA, elternA]) {
      const antwort = await anfrage(
        konto,
        "POST",
        `${KINDER}/${kindId}/konto`,
        kontoBody(),
      );
      expect(antwort.status).toBe(403);
    }
    const fremd = await anfrage(
      demoAdmin,
      "POST",
      `${KINDER}/${kindId}/konto`,
      kontoBody(),
    );
    expect(fremd.status).toBe(404);
    expect((await kindZeile(kindId)).userId).toBeNull();
  });

  test("Drosselung: ab 20 neuen Konten je Stunde 429", async () => {
    const eigeneAdmin = await legePersonaAn(welt, "admin");
    await db.insert(schema.auditLog).values(
      Array.from({ length: 20 }, () => ({
        abteilungId: welt.testabteilungId,
        akteurId: eigeneAdmin.id!,
        aktion: "kind_konto_erstellt",
        zielTyp: "kind",
        zielId: randomUUID(),
      })),
    );
    const kindId = await neuesKind();
    const antwort = await anfrage(
      eigeneAdmin,
      "POST",
      `${KINDER}/${kindId}/konto`,
      kontoBody(),
    );
    expect(antwort.status).toBe(429);
    expect((await kindZeile(kindId)).userId).toBeNull();
  });
});

describe("Liste der Kinder: Zugang", () => {
  type Zeile = {
    id: string;
    zugang: string;
    eltern: string[];
    konto: null | Record<string, unknown>;
  };
  const liste = async () =>
    (await lesen<{ kinder: Zeile[] }>(await anfrage(admin, "GET", KINDER)))
      .kinder;

  test("keiner, Eltern, eigenes Konto und beides; Benutzername und offenes Startpasswort nur in der Verwaltung", async () => {
    await einstellen();
    const keiner = await neuesKind();
    const mitEltern = await neuesKind();
    await db
      .insert(schema.kindEltern)
      .values({ kindId: mitEltern, userId: elternA.id! });
    const nurKonto = await neuesKind();
    const beides = await neuesKind();
    await db
      .insert(schema.kindEltern)
      .values({ kindId: beides, userId: elternA.id! });
    const angelegt = await legeKontoAn(nurKonto);
    await legeKontoAn(beides);
    const zeilen = new Map((await liste()).map((z) => [z.id, z]));
    expect(zeilen.get(keiner)?.zugang).toBe("keiner");
    expect(zeilen.get(mitEltern)?.zugang).toBe("eltern");
    expect(zeilen.get(nurKonto)?.zugang).toBe("konto");
    expect(zeilen.get(beides)?.zugang).toBe("beides");
    expect(zeilen.get(keiner)?.konto).toBeNull();
    expect(zeilen.get(nurKonto)?.konto).toMatchObject({
      benutzername: angelegt.benutzername.toLowerCase(),
      gesperrt: false,
      mussPasswortAendern: true,
      startpasswort: angelegt.startpasswort,
      elternEinsicht: true,
    });
    // «Konto übergeben»: Die Eltern bleiben verknüpft, sehen aber nichts mehr; der Zugang heisst dann «konto»
    const [{ userId }] = await db
      .select({ userId: schema.kind.userId })
      .from(schema.kind)
      .where(eq(schema.kind.id, beides));
    expect(userId).not.toBeNull();
    const uebergeben = await anfrage(
      admin,
      "PATCH",
      `${KINDER}/${beides}/konto`,
      { elternEinsicht: false },
    );
    expect(uebergeben.status).toBe(204);
    const danach = new Map((await liste()).map((z) => [z.id, z]));
    expect(danach.get(beides)?.zugang).toBe("konto");
    expect(danach.get(beides)?.eltern).toEqual([elternA.id]);
    expect(
      (await auditFuer(beides, "kind_konto_eltern_einsicht"))[0]?.details,
    ).toEqual({ elternEinsicht: false });
  });

  test("die Liste der Personen zeigt das Konto eines Kindes nie; es bekommt dort keine Rolle und kein Abteilungsleitung", async () => {
    await einstellen();
    const kindId = await neuesKind();
    await legeKontoAn(kindId);
    const kontoId = (await kindZeile(kindId)).userId!;
    const personen = (
      await lesen<{ personen: { id: string }[] }>(
        await anfrage(admin, "GET", "/api/v1/admin/personen"),
      )
    ).personen;
    expect(personen.some((p) => p.id === kontoId)).toBe(false);
    const aendern = await anfrage(
      admin,
      "PATCH",
      `/api/v1/admin/personen/${kontoId}`,
      { abteilungsleitung: true },
    );
    expect(aendern.status).toBe(404);
    const rolle = await anfrage(
      admin,
      "PATCH",
      `/api/v1/admin/personen/${kontoId}`,
      { rollen: [{ stufeId: welt.stufeAId, typ: "leitung" }] },
    );
    expect(rolle.status).toBe(404);
    for (const pfad of ["startpasswort", "deaktivieren", "aktivieren"]) {
      expect(
        (
          await anfrage(
            admin,
            "POST",
            `/api/v1/admin/personen/${kontoId}/${pfad}`,
          )
        ).status,
      ).toBe(404);
    }
    expect(
      (await anfrage(admin, "DELETE", `/api/v1/admin/personen/${kontoId}`))
        .status,
    ).toBe(404);
    const tag = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "funktion",
        name: `Funktion ${randomUUID().slice(0, 6)}`,
        kuerzel: "F",
      })
      .returning({ id: schema.tag.id });
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `/api/v1/admin/tags/${tag[0].id}/personen/${kontoId}`,
          {},
        )
      ).status,
    ).toBe(404);
    expect((await userZeile(kontoId)).role).toBe("user");
  });
});

describe("Was das Konto eines Kindes sieht", () => {
  let kind1: string;
  let kind2: string;
  let kindB: string;
  let konto1: PersonaKonto & { id: string };
  let konto2: PersonaKonto & { id: string };
  let kontoB: PersonaKonto & { id: string };

  beforeAll(async () => {
    await einstellen({ chat: "aus" });
    kind1 = await neuesKind(welt.stufeAId, "Eins");
    kind2 = await neuesKind(welt.stufeAId, "Zwei");
    kindB = await neuesKind(welt.stufeBId, "Bee");
    konto1 = await kindKonto(kind1);
    konto2 = await kindKonto(kind2);
    kontoB = await kindKonto(kindB);
  });

  test("/ich: nur das eigene Kind, keine Rolle, keine Abteilungsleitung; Eltern anderer Kinder bleiben fremd", async () => {
    const antwort = await app.request("/api/v1/ich", {
      headers: konto1.headers,
    });
    const profil = await lesen<{
      abteilungsleitung: boolean;
      rollen: unknown[];
      kinder: { id: string }[];
      teilnehmer: { kindId: string; stufeId: string; chat: string };
    }>(antwort);
    expect(profil.abteilungsleitung).toBe(false);
    expect(profil.rollen).toEqual([]);
    expect(profil.kinder.map((k) => k.id)).toEqual([kind1]);
    expect(profil.teilnehmer).toMatchObject({
      kindId: kind1,
      stufeId: welt.stufeAId,
      chat: "aus",
    });
    expect(JSON.stringify(profil)).not.toContain(kind2);
  });

  test("Programme: nur die der eigenen Stufe, mit nur dem eigenen Kind", async () => {
    const liste = await lesen<{
      programme: { id: string; kinder: { id: string }[] }[];
    }>(
      await app.request(`/api/v1/programme?${FENSTER}`, {
        headers: konto1.headers,
      }),
    );
    expect(liste.programme.map((p) => p.id)).toContain(programmA);
    expect(liste.programme.map((p) => p.id)).not.toContain(programmB);
    for (const p of liste.programme) {
      expect(p.kinder.every((k) => k.id === kind1)).toBe(true);
    }
    expect(
      (
        await app.request(`/api/v1/programme/${programmB}`, {
          headers: konto1.headers,
        })
      ).status,
    ).toBe(404);
  });

  test("Anwesenheit: nur sich selbst; ein anderes Kind der Stufe ist 403, ein Kind einer anderen Stufe 403", async () => {
    const setze = (konto: PersonaKonto, programm: string, kindId: string) =>
      anfrage(
        konto,
        "PUT",
        `/api/v1/programme/${programm}/teilnahmen/${kindId}`,
        {
          status: "ja",
        },
      );
    expect((await setze(konto1, programmA, kind1)).status).toBe(204);
    expect((await setze(konto1, programmA, kind2)).status).toBe(403);
    expect((await setze(konto1, programmA, kindB)).status).toBe(403);
    expect((await setze(konto2, programmA, kind1)).status).toBe(403);
    const zeilen = await db
      .select({ kindId: schema.teilnahme.kindId })
      .from(schema.teilnahme)
      .where(eq(schema.teilnahme.programmId, programmA));
    expect(zeilen.map((z) => z.kindId)).toEqual([kind1]);
    // Die Übersicht der Teilnahmen zeigt dem Konto nur sein Kind
    const uebersicht = await lesen<{ kinder: { id: string }[] }>(
      await app.request(`/api/v1/programme/${programmA}/teilnahmen`, {
        headers: konto2.headers,
      }),
    );
    expect(uebersicht.kinder.map((k) => k.id)).toEqual([kind2]);
  });

  test("Kontakte: die Stufenleitung der eigenen Stufe, nie mit Telefonnummer; die Eltern desselben Kindes bekommen sie", async () => {
    await db
      .insert(schema.kindEltern)
      .values({ kindId: kind1, userId: elternA.id! });
    const kontakte = async (konto: PersonaKonto, stufeId: string) => {
      const res = await app.request(`/api/v1/stufen/${stufeId}/kontakte`, {
        headers: konto.headers,
      });
      return {
        status: res.status,
        kontakte:
          res.status === 200
            ? (
                (await res.json()) as {
                  kontakte: { id: string; telefon: string | null }[];
                }
              ).kontakte
            : [],
      };
    };
    const kind = await kontakte(konto1, welt.stufeAId);
    expect(kind.status).toBe(200);
    expect(kind.kontakte.map((k) => k.id)).toContain(slA.id);
    expect(kind.kontakte.every((k) => k.telefon === null)).toBe(true);
    const eltern = await kontakte(elternA, welt.stufeAId);
    expect(eltern.kontakte.find((k) => k.id === slA.id)?.telefon).toBe(
      "+41 79 000 00 00",
    );
    expect((await kontakte(konto1, welt.stufeBId)).status).toBe(404);
    const programm = await app.request(
      `/api/v1/programme/${programmA}/kontakte`,
      { headers: konto1.headers },
    );
    expect(
      (
        (await programm.json()) as { kontakte: { telefon: string | null }[] }
      ).kontakte.every((k) => k.telefon === null),
    ).toBe(true);
    await db
      .delete(schema.kindEltern)
      .where(eq(schema.kindEltern.kindId, kind1));
  });

  test("Chat: aus, lesen, schreiben; nur der Gruppenchat der eigenen Stufe, nie ein Einzelchat", async () => {
    const chats = async (konto: PersonaKonto) =>
      (
        await lesen<{ chats: { id: string; typ: string }[] }>(
          await app.request("/api/v1/chats", { headers: konto.headers }),
        )
      ).chats;
    await einstellen({ chat: "aus" });
    expect(await chats(konto1)).toEqual([]);
    expect(
      (
        await app.request(`/api/v1/chats/${welt.gruppenchatAId}/nachrichten`, {
          headers: konto1.headers,
        })
      ).status,
    ).toBe(404);

    await einstellen({ chat: "lesen" });
    expect((await chats(konto1)).map((c) => c.id)).toEqual([
      welt.gruppenchatAId,
    ]);
    expect((await chats(kontoB)).map((c) => c.id)).toEqual([
      welt.gruppenchatBId,
    ]);
    const lesenOk = await app.request(
      `/api/v1/chats/${welt.gruppenchatAId}/nachrichten`,
      { headers: konto1.headers },
    );
    expect(lesenOk.status).toBe(200);
    // Der Gruppenchat der anderen Stufe ist unbekannt
    expect(
      (
        await app.request(`/api/v1/chats/${welt.gruppenchatBId}/nachrichten`, {
          headers: konto1.headers,
        })
      ).status,
    ).toBe(404);
    const schreibenAbgelehnt = await anfrage(
      konto1,
      "POST",
      `/api/v1/chats/${welt.gruppenchatAId}/nachrichten`,
      { text: "Hallo" },
    );
    expect(schreibenAbgelehnt.status).toBe(403);
    expect((await lesen<{ code: string }>(schreibenAbgelehnt)).code).toBe(
      "KIND_CHAT_NUR_LESEN",
    );

    await einstellen({ chat: "schreiben" });
    const geschrieben = await anfrage(
      konto1,
      "POST",
      `/api/v1/chats/${welt.gruppenchatAId}/nachrichten`,
      { text: "Hallo" },
    );
    expect(geschrieben.status).toBe(201);
    // Kein Einzelchat mit der Leitung: weder selbst noch durch die Leitung
    expect(
      (
        await anfrage(konto1, "POST", "/api/v1/chats/direkt", {
          stufeId: welt.stufeAId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(slA, "POST", "/api/v1/chats/direkt", {
          stufeId: welt.stufeAId,
          elternUserId: konto1.id,
        })
      ).status,
    ).toBe(404);
    expect((await chats(konto1)).every((c) => c.typ === "stufe")).toBe(true);

    // Schalter «Konten aus» nimmt auch den Chat
    await einstellen({ erlaubt: false, chat: "schreiben" });
    expect(await chats(konto1)).toEqual([]);
    await einstellen({ chat: "aus" });
  });

  test("Chat: Eltern und Kind sind getrennte Mitglieder; Eltern ohne Einsicht verlieren Chat und Programme, das Kind behält sie", async () => {
    await einstellen({ chat: "lesen" });
    const kind = await neuesKind(welt.stufeAId, "Mit Eltern");
    const eltern = await legePersonaAn(welt, "elternA");
    // Nur dieses Kind: Die Persona hat sonst noch Kind A in derselben Stufe
    await db
      .delete(schema.kindEltern)
      .where(eq(schema.kindEltern.userId, eltern.id!));
    await db
      .insert(schema.kindEltern)
      .values({ kindId: kind, userId: eltern.id! });
    const konto = await kindKonto(kind);
    const chats = async (k: PersonaKonto) =>
      (
        await lesen<{ chats: { id: string }[] }>(
          await app.request("/api/v1/chats", { headers: k.headers }),
        )
      ).chats.map((c) => c.id);
    const programme = async (k: PersonaKonto) =>
      (
        await lesen<{ programme: { id: string }[] }>(
          await app.request(`/api/v1/programme?${FENSTER}`, {
            headers: k.headers,
          }),
        )
      ).programme.map((p) => p.id);
    expect(await chats(eltern)).toContain(welt.gruppenchatAId);
    expect(await programme(eltern)).toContain(programmA);

    const uebergeben = await anfrage(
      admin,
      "PATCH",
      `${KINDER}/${kind}/konto`,
      {
        elternEinsicht: false,
      },
    );
    expect(uebergeben.status).toBe(204);
    expect(await chats(eltern)).toEqual([]);
    expect(await programme(eltern)).toEqual([]);
    const profil = await lesen<{ kinder: unknown[] }>(
      await app.request("/api/v1/ich", { headers: eltern.headers }),
    );
    expect(profil.kinder).toEqual([]);
    expect(await chats(konto)).toEqual([welt.gruppenchatAId]);
    expect(await programme(konto)).toContain(programmA);

    // Zurück: Die Eltern sehen wieder
    await anfrage(admin, "PATCH", `${KINDER}/${kind}/konto`, {
      elternEinsicht: true,
    });
    expect(await chats(eltern)).toContain(welt.gruppenchatAId);
    await einstellen({ chat: "aus" });
  });

  test("Verwaltung und fremde Daten: jede Verwaltungsroute ist 403, nie 2xx; kein Profilbild, keine Telefonnummer", async () => {
    const lesend = [
      KINDER,
      `${KINDER}/konto-einstellung`,
      "/api/v1/admin/personen",
      "/api/v1/admin/stufen",
      "/api/v1/admin/tags",
      "/api/v1/admin/protokoll",
      "/api/v1/admin/rechte",
      "/api/v1/admin/system/uebersicht",
      "/api/v1/admin/mitteilungen/vorschau",
    ];
    for (const pfad of lesend) {
      const status = (await anfrage(konto1, "GET", pfad)).status;
      expect([403, 404, 405], pfad).toContain(status);
    }
    expect(
      (await anfrage(konto1, "POST", `${KINDER}/${kind1}/konto`, kontoBody()))
        .status,
    ).toBe(403);
    expect(
      (await anfrage(konto1, "PATCH", `${KINDER}/${kind2}`, { aktiv: false }))
        .status,
    ).toBe(403);
    expect((await anfrage(konto1, "DELETE", `${KINDER}/${kind2}`)).status).toBe(
      403,
    );
    expect((await kindZeile(kind2)).inaktivSeit).toBeNull();
    // Kein Profilbild von Kindern
    const bild = await app.request("/api/v1/ich/bild", {
      method: "PUT",
      headers: { ...konto1.headers, "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(bild.status).toBe(403);
    // Keine Telefonnummer speichern
    expect(
      (
        await anfrage(konto1, "PATCH", "/api/v1/ich", {
          telefon: "+41790000000",
        })
      ).status,
    ).toBe(403);
  });

  test("jede Route unter /api/v1/admin verweigert dem Konto eines Kindes: nie 2xx, nie ein Serverfehler", async () => {
    const routen = app.routes.filter(
      (r) => r.path.startsWith("/api/v1/admin/") && r.method !== "ALL",
    );
    expect(routen.length).toBeGreaterThan(100);
    const abweichend: string[] = [];
    for (const r of routen) {
      const pfad = r.path.replace(/:[A-Za-z]+/g, () => randomUUID());
      const mitBody = !["GET", "DELETE", "HEAD"].includes(r.method);
      const antwort = await app.request(pfad, {
        method: r.method,
        headers: mitBody
          ? { ...konto1.headers, "content-type": "application/json" }
          : konto1.headers,
        body: mitBody ? "{}" : undefined,
      });
      // 501: Die Testanwendung hat keinen Medienspeicher; auch das ist kein Zugriff
      if (
        antwort.status < 400 ||
        (antwort.status >= 500 && antwort.status !== 501)
      ) {
        abweichend.push(`${r.method} ${r.path}: ${antwort.status}`);
      }
    }
    expect(abweichend).toEqual([]);
  }, 120_000);

  test("Kalender: nur Termine der eigenen Stufe in «Mein Kalender»", async () => {
    const antwort = await app.request(
      "/api/v1/termine/mein?von=2027-01-01&bis=2027-12-31",
      {
        headers: konto1.headers,
      },
    );
    if (antwort.status === 200) {
      const text = JSON.stringify(await antwort.json());
      expect(text).toContain(programmA);
      expect(text).not.toContain(programmB);
    } else {
      // Die Route heisst anders: dann gilt die Programmliste oben
      expect(antwort.status).toBe(404);
    }
  });
});

describe("Sperren, Startpasswort, Entfernen und Löschen", () => {
  beforeAll(async () => {
    await einstellen();
  });

  test("sperren beendet die Sitzungen und die Anmeldung; entsperren gibt ein neues Startpasswort", async () => {
    const kindId = await neuesKind();
    const konto = await kindKonto(kindId);
    const vorher = await app.request("/api/v1/ich", { headers: konto.headers });
    expect(vorher.status).toBe(200);
    const sperre = await anfrage(
      admin,
      "POST",
      `${KINDER}/${kindId}/konto/sperren`,
    );
    expect(sperre.status).toBe(204);
    expect(
      (await app.request("/api/v1/ich", { headers: konto.headers })).status,
    ).toBe(401);
    expect((await userZeile(konto.id)).deaktiviertAm).toBeInstanceOf(Date);
    await expect(
      anmelden(konto.benutzername, "egal-egal-egal"),
    ).rejects.toThrow();
    expect(
      (
        await lesen<{ kinder: { konto: { gesperrt: boolean } }[] }>(
          await anfrage(admin, "GET", KINDER),
        )
      ).kinder.find((k: Record<string, unknown>) => k.id === kindId)?.konto
        .gesperrt,
    ).toBe(true);

    const frei = await anfrage(
      admin,
      "POST",
      `${KINDER}/${kindId}/konto/entsperren`,
    );
    expect(frei.status).toBe(200);
    const { startpasswort } = await lesen<{ startpasswort: string }>(frei);
    expect(startpasswort).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const neu = await anmelden(
      konto.benutzername,
      normalisiereStartpasswort(startpasswort),
    );
    expect(cookiesAus(neu)).not.toBe("");
    expect((await userZeile(konto.id)).mussPasswortAendern).toBe(true);
    expect((await auditFuer(kindId, "kind_konto_gesperrt")).length).toBe(1);
    expect((await auditFuer(kindId, "kind_konto_entsperrt")).length).toBe(1);
  });

  test("neues Startpasswort beendet die Sitzungen, das alte Passwort gilt nicht mehr", async () => {
    const kindId = await neuesKind();
    const angelegt = await legeKontoAn(kindId);
    const alt = normalisiereStartpasswort(angelegt.startpasswort);
    const anmeldung = await anmelden(angelegt.benutzername, alt);
    const headers = {
      "expo-origin": APP,
      "x-forwarded-for": zufallsIp(),
      cookie: cookiesAus(anmeldung),
    };
    const antwort = await anfrage(
      admin,
      "POST",
      `${KINDER}/${kindId}/konto/startpasswort`,
    );
    expect(antwort.status).toBe(200);
    const { startpasswort } = await lesen<{ startpasswort: string }>(antwort);
    expect(startpasswort).not.toBe(angelegt.startpasswort);
    expect((await app.request("/api/v1/ich", { headers })).status).toBe(401);
    await expect(anmelden(angelegt.benutzername, alt)).rejects.toThrow();
    expect(
      cookiesAus(
        await anmelden(
          angelegt.benutzername,
          normalisiereStartpasswort(startpasswort),
        ),
      ),
    ).not.toBe("");
  });

  test("Aktionen am Konto ohne Konto sind 404; fremde Kinder 404; alle anderen 403", async () => {
    const ohne = await neuesKind();
    for (const [methode, pfad] of [
      ["PATCH", "konto"],
      ["POST", "konto/startpasswort"],
      ["POST", "konto/sperren"],
      ["POST", "konto/entsperren"],
      ["DELETE", "konto"],
    ] as const) {
      const body = methode === "PATCH" ? { elternEinsicht: false } : undefined;
      expect(
        (await anfrage(admin, methode, `${KINDER}/${ohne}/${pfad}`, body))
          .status,
        pfad,
      ).toBe(404);
      expect(
        (await anfrage(demoAdmin, methode, `${KINDER}/${ohne}/${pfad}`, body))
          .status,
        pfad,
      ).toBe(404);
      expect(
        (await anfrage(slA, methode, `${KINDER}/${ohne}/${pfad}`, body)).status,
        pfad,
      ).toBe(403);
    }
  });

  test("Konto entfernen: Kind bleibt, Konto und Nachrichten gehen, die Eltern sehen wieder", async () => {
    await einstellen({ chat: "schreiben" });
    const kindId = await neuesKind();
    const konto = await kindKonto(kindId, { elternEinsicht: false });
    await anfrage(
      konto,
      "POST",
      `/api/v1/chats/${welt.gruppenchatAId}/nachrichten`,
      { text: "Von mir" },
    );
    expect(
      await db
        .select()
        .from(schema.nachricht)
        .where(eq(schema.nachricht.autorId, konto.id)),
    ).toHaveLength(1);
    const weg = await anfrage(admin, "DELETE", `${KINDER}/${kindId}/konto`);
    expect(weg.status).toBe(204);
    const kind = await kindZeile(kindId);
    expect(kind).toBeDefined();
    expect(kind.userId).toBeNull();
    expect(kind.kontoSeit).toBeNull();
    expect(kind.elternEinsicht).toBe(true);
    expect(kind.elternInformiertAm).toBeNull();
    expect(await userZeile(konto.id)).toBeUndefined();
    expect(
      await db
        .select()
        .from(schema.nachricht)
        .where(eq(schema.nachricht.autorId, konto.id)),
    ).toEqual([]);
    expect(
      (await app.request("/api/v1/ich", { headers: konto.headers })).status,
    ).toBe(401);
    expect((await auditFuer(kindId, "kind_konto_entfernt")).length).toBe(1);
    await einstellen({ chat: "aus" });
  });

  test("ein Kind löschen löscht sein Konto mit", async () => {
    const kindId = await neuesKind();
    const konto = await kindKonto(kindId);
    const weg = await anfrage(admin, "DELETE", `${KINDER}/${kindId}`);
    expect(weg.status).toBe(204);
    expect(await kindZeile(kindId)).toBeUndefined();
    expect(await userZeile(konto.id)).toBeUndefined();
  });

  test("ein Kind inaktiv setzen lässt sein Konto leer: nichts mehr zu sehen", async () => {
    const kindId = await neuesKind();
    const konto = await kindKonto(kindId);
    expect(
      (await anfrage(admin, "PATCH", `${KINDER}/${kindId}`, { aktiv: false }))
        .status,
    ).toBe(204);
    const liste = await lesen<{ programme: unknown[] }>(
      await app.request(`/api/v1/programme?${FENSTER}`, {
        headers: konto.headers,
      }),
    );
    expect(liste.programme).toEqual([]);
    const profil = await lesen<{ kinder: unknown[] }>(
      await app.request("/api/v1/ich", { headers: konto.headers }),
    );
    expect(profil.kinder).toEqual([]);
  });
});
