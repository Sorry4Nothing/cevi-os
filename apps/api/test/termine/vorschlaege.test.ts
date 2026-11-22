import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { terminVorschlag } from "../../src/db/schema-vorschlag.js";
import { ladeSeiten } from "../../src/seiten.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  fcmNachricht,
} from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

const fcmAttrappe = bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  fcm: fcmAttrappe,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const BASIS = "/api/v1/termin-vorschlaege";
const tageAb = (n: number) => new Date(Date.now() + n * 864e5);
const tag = (n: number) => tageAb(n).toISOString().slice(0, 10);

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
let tagId: string;
let zweiterTagId: string;
let fremderTagId: string;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(PERSONAS.map((p) => legePersonaAn(welt, p)));
  konten = Object.fromEntries(
    PERSONAS.map((p, i) => [p, liste[i]]),
  ) as typeof konten;
  const neuerTag = async (
    abteilungId: string,
    typ: "stufe" | "funktion" | "team" | "lager",
  ) =>
    (
      await db
        .insert(schema.tag)
        .values({
          abteilungId,
          typ,
          name: `Tag ${randomUUID().slice(0, 8)}`,
          kuerzel: "T",
        })
        .returning({ id: schema.tag.id })
    )[0]!.id;
  tagId = await neuerTag(welt.testabteilungId, "funktion");
  zweiterTagId = await neuerTag(welt.testabteilungId, "stufe");
  fremderTagId = await neuerTag(welt.demoAbteilungId, "funktion");
});
beforeEach(() => fcmAttrappe.zuruecksetzen());

const aufruf = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) =>
  app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ganztaegig = (extra: Record<string, unknown> = {}) => ({
  titel: "Waldweihnacht",
  ganztaegig: true,
  tagVon: tag(30),
  tagBis: tag(30),
  tagIds: [tagId],
  ...extra,
});
const zeitlich = (extra: Record<string, unknown> = {}) => ({
  titel: "Sitzung",
  ganztaegig: false,
  beginn: new Date(tageAb(10).setUTCHours(18, 0, 0, 0)).toISOString(),
  ende: new Date(tageAb(10).setUTCHours(20, 0, 0, 0)).toISOString(),
  tagIds: [tagId],
  ...extra,
});

// Frische Person je Test, die ein Limit oder einen Zähler für sich braucht
const neuePerson = (persona: Persona) => legePersonaAn(welt, persona);

// Direkt in die Datenbank: so viele Vorschläge, ohne dass die Route sie zählt
async function fuegeEin(
  vonId: string,
  n: number,
  status:
    "offen" | "freigegeben" | "abgelehnt" | "in_outlook_eingetragen" = "offen",
) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [z] = await db
      .insert(terminVorschlag)
      .values({
        abteilungId: welt.testabteilungId,
        vorgeschlagenVon: vonId,
        titel: `Direkt ${i}`,
        ganztaegig: true,
        tagVon: tag(40),
        tagBis: tag(40),
        tagIds: [tagId],
        status,
      })
      .returning({ id: terminVorschlag.id });
    ids.push(z!.id);
  }
  return ids;
}

async function token(konto: PersonaKonto) {
  const wert = `fcm-test-${randomUUID()}`;
  const antwort = await aufruf(konto, "PUT", "/api/v1/push-token", {
    token: wert,
    plattform: "android",
  });
  expect(antwort.status).toBe(204);
  return wert;
}

describe("Wer vorschlagen darf (Annahme A9), alle 14 Personas", () => {
  const erwartet: Record<Persona, [number, boolean | null]> = {
    admin: [200, true],
    adminOhneZweitenFaktor: [200, true],
    slA: [200, true],
    slB: [200, true],
    leitendeA: [200, true],
    leitendeB: [200, true],
    leitendeAElternB: [200, true],
    elternA: [200, false],
    elternB: [200, false],
    mussPasswortAendern: [403, null],
    deaktiviert: [401, null],
    ohneLogin: [401, null],
    demoAdmin: [200, true],
    demoEltern: [200, false],
  };

  test.each(PERSONAS)("%s: optionen", async (persona) => {
    const antwort = await aufruf(konten[persona], "GET", `${BASIS}/optionen`);
    const [status, darf] = erwartet[persona];
    expect(antwort.status).toBe(status);
    if (darf === null) return;
    const body = (await antwort.json()) as {
      darfVorschlagen: boolean;
      tags: { id: string; name: string; typ: string }[];
    };
    expect(body.darfVorschlagen).toBe(darf);
    // Nur Tags der eigenen Abteilung (dazu die Stufen, die als Tags gelten), und nur wer vorschlagen darf, bekommt sie
    const ids = body.tags.map((t) => t.id);
    if (!darf) return expect(ids).toEqual([]);
    if (persona === "demoAdmin") {
      expect(ids).toContain(fremderTagId);
      expect(ids).toContain(welt.demoStufeId);
      expect(ids).not.toContain(tagId);
    } else {
      expect(ids).toEqual(
        expect.arrayContaining([tagId, zweiterTagId, welt.stufeAId]),
      );
      expect(ids).not.toContain(fremderTagId);
      expect(ids).not.toContain(welt.demoStufeId);
    }
  });

  test.each(PERSONAS)("%s: POST", async (persona) => {
    const antwort = await aufruf(
      konten[persona],
      "POST",
      BASIS,
      ganztaegig({ titel: `Von ${persona}` }),
    );
    const [, darf] = erwartet[persona];
    const status = {
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      // Die Tags gehören zur Testabteilung
      demoAdmin: 400,
    }[persona as string];
    expect(antwort.status).toBe(status ?? (darf ? 201 : 403));
  });

  test("ein Tag vom Typ funktion oder team gibt das Recht, stufe, lager und ein Tag einer anderen Abteilung nicht", async () => {
    const eltern = await neuePerson("elternA");
    const darf = async () =>
      (
        (await (await aufruf(eltern, "GET", `${BASIS}/optionen`)).json()) as {
          darfVorschlagen: boolean;
        }
      ).darfVorschlagen;
    const setze = async (id: string) => {
      await db
        .delete(schema.personTag)
        .where(eq(schema.personTag.userId, eltern.id!));
      await db
        .insert(schema.personTag)
        .values({ userId: eltern.id!, tagId: id });
    };
    expect(await darf()).toBe(false);
    for (const [typ, erwartetes] of [
      ["funktion", true],
      ["team", true],
      ["stufe", false],
      ["lager", false],
    ] as const) {
      const [t] = await db
        .insert(schema.tag)
        .values({
          abteilungId: welt.testabteilungId,
          typ,
          name: `Recht ${typ} ${randomUUID().slice(0, 8)}`,
          kuerzel: "R",
        })
        .returning({ id: schema.tag.id });
      await setze(t!.id);
      expect(await darf(), typ).toBe(erwartetes);
    }
    await setze(fremderTagId);
    expect(await darf()).toBe(false);
    // Mit dem Tag darf die Person einreichen
    const [funktion] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Team ${randomUUID().slice(0, 8)}`,
        kuerzel: "T",
      })
      .returning({ id: schema.tag.id });
    await setze(funktion!.id);
    expect((await aufruf(eltern, "POST", BASIS, ganztaegig())).status).toBe(
      201,
    );
  });
});

describe("POST /termin-vorschlaege", () => {
  test("ganztägig: 201, Status offen, Zeile, eigene Liste, Detail und Protokoll ohne Inhalt", async () => {
    const sl = konten.slA;
    const antwort = await aufruf(
      sl,
      "POST",
      BASIS,
      ganztaegig({
        ort: "Pfadihütte",
        beschreibung: "Mit Punsch\nund Kerzen",
        bemerkung: "Bitte vor den Ferien",
      }),
    );
    expect(antwort.status).toBe(201);
    const { id, status } = (await antwort.json()) as {
      id: string;
      status: string;
    };
    expect(status).toBe("offen");

    const [zeile] = await db
      .select()
      .from(terminVorschlag)
      .where(eq(terminVorschlag.id, id));
    expect(zeile).toMatchObject({
      abteilungId: welt.testabteilungId,
      vorgeschlagenVon: sl.id,
      titel: "Waldweihnacht",
      ganztaegig: true,
      beginn: null,
      ende: null,
      tagVon: tag(30),
      tagBis: tag(30),
      ort: "Pfadihütte",
      bemerkung: "Bitte vor den Ferien",
      tagIds: [tagId],
      status: "offen",
      entschiedenVon: null,
    });

    const liste = (await (
      await aufruf(sl, "GET", `${BASIS}/meine`)
    ).json()) as { vorschlaege: { id: string }[] };
    expect(liste.vorschlaege.map((v) => v.id)).toContain(id);
    const detail = (await (
      await aufruf(sl, "GET", `${BASIS}/${id}`)
    ).json()) as {
      titel: string;
      status: string;
      tags: { id: string; typ: string }[];
      begruendung: string | null;
    };
    expect(detail).toMatchObject({
      titel: "Waldweihnacht",
      status: "offen",
      begruendung: null,
    });
    expect(detail.tags).toEqual([
      expect.objectContaining({ id: tagId, typ: "funktion" }),
    ]);

    const protokoll = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id),
          eq(schema.auditLog.aktion, "termin_vorgeschlagen"),
        ),
      );
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]).toMatchObject({
      akteurId: sl.id,
      abteilungId: welt.testabteilungId,
      details: null,
    });
    expect(JSON.stringify(protokoll)).not.toContain("Waldweihnacht");
  });

  test("mit Beginn und Ende; Ganztägig darf heute beginnen", async () => {
    const sl = konten.slB;
    const a = await aufruf(sl, "POST", BASIS, zeitlich({ ort: "  " }));
    expect(a.status).toBe(201);
    const { id } = (await a.json()) as { id: string };
    const [zeile] = await db
      .select()
      .from(terminVorschlag)
      .where(eq(terminVorschlag.id, id));
    expect(zeile!.beginn).toEqual(new Date(zeitlich().beginn));
    expect(zeile!.tagVon).toBeNull();
    // Leerer Ort heisst nicht gesetzt
    expect(zeile!.ort).toBeNull();
    const heute = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Zurich",
    });
    expect(
      (
        await aufruf(
          sl,
          "POST",
          BASIS,
          ganztaegig({ tagVon: heute, tagBis: heute }),
        )
      ).status,
    ).toBe(201);
  });

  const ungueltig: [string, Record<string, unknown>][] = [
    ["Titel leer", { titel: "  " }],
    ["Titel 121 Zeichen", { titel: "x".repeat(121) }],
    ["Titel mit Zeilenumbruch", { titel: "a\nb" }],
    ["Titel mit NUL", { titel: "a\u0000b" }],
    ["Ort 121 Zeichen", { ort: "x".repeat(121) }],
    ["Ort mit Zeilenumbruch", { ort: "a\nb" }],
    ["Beschreibung 2001 Zeichen", { beschreibung: "x".repeat(2001) }],
    ["Beschreibung mit NUL", { beschreibung: "a\u0000b" }],
    ["Bemerkung 1001 Zeichen", { bemerkung: "x".repeat(1001) }],
    ["ohne Tags", { tagIds: [] }],
    ["21 Tags", { tagIds: Array.from({ length: 21 }, () => randomUUID()) }],
    ["doppelter Tag", { tagIds: [tagId, tagId] }],
    ["Tag keine UUID", { tagIds: ["x"] }],
    ["Ganztägig ohne Tag bis", { tagBis: undefined }],
    ["Ganztägig mit Beginn", { beginn: new Date().toISOString() }],
    ["Ende vor Anfang (Tage)", { tagVon: tag(31), tagBis: tag(30) }],
    ["Jahr 0000", { tagVon: "0000-01-01", tagBis: "0000-01-02" }],
    ["Feld unbekannt", { abteilungId: randomUUID() }],
    ["Status gesetzt", { status: "freigegeben" }],
  ];
  test.each(ungueltig)("400: %s", async (_name, extra) => {
    const antwort = await aufruf(
      konten.leitendeA,
      "POST",
      BASIS,
      ganztaegig(extra),
    );
    expect(antwort.status).toBe(400);
  });

  test.each([
    ["zeitlich ohne Ende", { ende: undefined }],
    ["zeitlich mit Tagen", { tagVon: tag(30), tagBis: tag(30) }],
    ["Ende gleich Beginn", { ende: zeitlich().beginn }],
    ["Ende vor Beginn", { ende: new Date(tageAb(9)).toISOString() }],
    ["Beginn ohne Zeitzone", { beginn: "2099-01-01T10:00:00" }],
  ])("400: %s", async (_name, extra) => {
    const antwort = await aufruf(
      konten.leitendeA,
      "POST",
      BASIS,
      zeitlich(extra),
    );
    expect(antwort.status).toBe(400);
  });

  test("400 ohne JSON-Body und mit nicht-boolschem ganztaegig", async () => {
    expect((await aufruf(konten.leitendeA, "POST", BASIS, {})).status).toBe(
      400,
    );
    expect(
      (
        await aufruf(
          konten.leitendeA,
          "POST",
          BASIS,
          ganztaegig({ ganztaegig: "ja" }),
        )
      ).status,
    ).toBe(400);
  });

  test("Beginn in der Vergangenheit: 400 TERMIN_VERGANGEN, nichts gespeichert", async () => {
    const sl = await neuePerson("slA");
    for (const body of [
      zeitlich({
        beginn: tageAb(-2).toISOString(),
        ende: tageAb(-1).toISOString(),
      }),
      ganztaegig({ tagVon: tag(-1), tagBis: tag(1) }),
    ]) {
      const antwort = await aufruf(sl, "POST", BASIS, body);
      expect(antwort.status).toBe(400);
      expect(await antwort.json()).toMatchObject({ code: "TERMIN_VERGANGEN" });
    }
    expect(
      await db
        .select()
        .from(terminVorschlag)
        .where(eq(terminVorschlag.vorgeschlagenVon, sl.id!)),
    ).toEqual([]);
  });

  test("fremde oder unbekannte Tags: 400 TAG_UNBEKANNT, nichts gespeichert", async () => {
    const sl = await neuePerson("slA");
    for (const ids of [[fremderTagId], [tagId, fremderTagId], [randomUUID()]]) {
      const antwort = await aufruf(
        sl,
        "POST",
        BASIS,
        ganztaegig({ tagIds: ids }),
      );
      expect(antwort.status).toBe(400);
      expect(await antwort.json()).toMatchObject({ code: "TAG_UNBEKANNT" });
    }
    expect(
      await db
        .select()
        .from(terminVorschlag)
        .where(eq(terminVorschlag.vorgeschlagenVon, sl.id!)),
    ).toEqual([]);
  });

  test("Obergrenze: 10 offene je Person (409), Zurückziehen und Entscheid geben Platz frei, andere Personen bleiben unberührt", async () => {
    const sl = await neuePerson("slA");
    const ids = await fuegeEin(sl.id!, 10);
    const voll = await aufruf(sl, "POST", BASIS, ganztaegig());
    expect(voll.status).toBe(409);
    expect(await voll.json()).toMatchObject({ code: "VORSCHLAG_LIMIT" });
    // Eine andere Person ist nicht betroffen
    expect(
      (await aufruf(konten.leitendeB, "POST", BASIS, ganztaegig())).status,
    ).toBe(201);
    expect((await aufruf(sl, "DELETE", `${BASIS}/${ids[0]}`)).status).toBe(204);
    expect((await aufruf(sl, "POST", BASIS, ganztaegig())).status).toBe(201);
    expect((await aufruf(sl, "POST", BASIS, ganztaegig())).status).toBe(409);
    // Ein entschiedener Vorschlag zählt nicht mehr
    await db
      .update(terminVorschlag)
      .set({ status: "abgelehnt" })
      .where(eq(terminVorschlag.id, ids[1]!));
    expect((await aufruf(sl, "POST", BASIS, ganztaegig())).status).toBe(201);
  });

  test("gleichzeitige Anfragen überspringen die Obergrenze nicht", async () => {
    const sl = await neuePerson("slA");
    await fuegeEin(sl.id!, 9);
    const antworten = await Promise.all(
      Array.from({ length: 5 }, () => aufruf(sl, "POST", BASIS, ganztaegig())),
    );
    expect(antworten.map((a) => a.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
  });

  test("Rate-Limit je Konto: nach 20 Anfragen in 10 Minuten 429, andere Konten bleiben frei", async () => {
    const sl = await neuePerson("slA");
    // Ein unbekannter Tag zählt mit, speichert aber nichts
    for (let i = 0; i < 20; i++) {
      expect(
        (
          await aufruf(
            sl,
            "POST",
            BASIS,
            ganztaegig({ tagIds: [randomUUID()] }),
          )
        ).status,
      ).toBe(400);
    }
    expect((await aufruf(sl, "POST", BASIS, ganztaegig())).status).toBe(429);
    expect(
      (await aufruf(konten.leitendeA, "POST", BASIS, ganztaegig())).status,
    ).toBe(201);
  });
});

describe("Push an die Abteilungsleitung", () => {
  test("nur aktive Admins der eigenen Abteilung, nicht die vorschlagende Person; fester Text ohne Titel und Namen", async () => {
    const sl = await neuePerson("slA");
    const admin2 = await neuePerson("admin");
    const gebannt = await neuePerson("admin");
    const [tAdmin, tAdmin2, tOhne, tGebannt] = await Promise.all(
      [konten.admin, admin2, konten.adminOhneZweitenFaktor, gebannt].map(token),
    );
    // Alle anderen, auch Leitung, Eltern und die Admins der Demo-Abteilung, haben ein Token und bekommen nichts
    await Promise.all(
      [
        sl,
        konten.leitendeA,
        konten.slB,
        konten.elternA,
        konten.demoAdmin,
        konten.demoEltern,
      ].map(token),
    );
    await db
      .update(schema.user)
      .set({ banned: true, deaktiviertAm: new Date() })
      .where(eq(schema.user.id, gebannt.id!));

    const antwort = await aufruf(
      sl,
      "POST",
      BASIS,
      ganztaegig({ titel: "Geheimer Titel", bemerkung: "Geheime Bemerkung" }),
    );
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };

    expect(fcmAttrappe.nachrichten.map((n) => n.token).sort()).toEqual(
      [tAdmin, tAdmin2, tOhne].sort(),
    );
    expect(tGebannt).toBeDefined();
    expect(fcmAttrappe.nachrichten).toContainEqual(
      fcmNachricht(
        tAdmin,
        "Neuer Terminvorschlag",
        { typ: "termin_vorschlag", id },
        "termine",
        "Ein Vorschlag wartet auf deinen Entscheid.",
      ),
    );
    const alles = JSON.stringify(fcmAttrappe.nachrichten);
    for (const verboten of [
      "Geheimer Titel",
      "Geheime Bemerkung",
      "Waldweihnacht",
    ]) {
      expect(alles).not.toContain(verboten);
    }
    const [person] = await db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, sl.id!));
    expect(alles).not.toContain(person!.name);
  });

  test("schlägt die Abteilungsleitung selbst vor, geht der Push nur an die anderen Admins", async () => {
    const eigener = await neuePerson("admin");
    const tEigener = await token(eigener);
    const tAnderer = await token(konten.admin);
    const antwort = await aufruf(eigener, "POST", BASIS, ganztaegig());
    expect(antwort.status).toBe(201);
    const tokens = fcmAttrappe.nachrichten.map((n) => n.token);
    expect(tokens).toContain(tAnderer);
    expect(tokens).not.toContain(tEigener);
  });

  test("ohne Empfänger, bei abgelehnter oder ungültiger Anfrage und bei Ausfall von FCM", async () => {
    const eltern = konten.elternA;
    await token(konten.admin);
    // Kein Recht, ungültig, Tag unbekannt, Vergangenheit: kein Push
    await aufruf(eltern, "POST", BASIS, ganztaegig());
    await aufruf(konten.leitendeA, "POST", BASIS, ganztaegig({ titel: "" }));
    await aufruf(
      konten.leitendeA,
      "POST",
      BASIS,
      ganztaegig({ tagIds: [fremderTagId] }),
    );
    await aufruf(
      konten.leitendeA,
      "POST",
      BASIS,
      ganztaegig({ tagVon: tag(-3), tagBis: tag(-3) }),
    );
    expect(fcmAttrappe.nachrichten).toEqual([]);
    // FCM fällt aus: Der Vorschlag ist trotzdem eingereicht
    fcmAttrappe.ausfall = true;
    const antwort = await aufruf(konten.leitendeA, "POST", BASIS, ganztaegig());
    expect(antwort.status).toBe(201);
  });
});

describe("GET /termin-vorschlaege/meine", () => {
  test("neueste zuerst, Seiten ohne Doppelte, nur die eigenen der eigenen Abteilung", async () => {
    const sl = await neuePerson("slA");
    const eigene = await fuegeEin(sl.id!, 7, "offen");
    await fuegeEin(konten.leitendeA.id!, 2);
    const gesehen: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const antwort = await aufruf(
        sl,
        "GET",
        `${BASIS}/meine?limit=3${nach ? `&nach=${nach}` : ""}`,
      );
      expect(antwort.status).toBe(200);
      const body = (await antwort.json()) as {
        vorschlaege: { id: string }[];
        weitere: boolean;
        naechste: string | null;
      };
      expect(body.weitere).toBe(body.naechste !== null);
      gesehen.push(...body.vorschlaege.map((v) => v.id));
      nach = body.naechste;
      seiten++;
    } while (nach && seiten < 10);
    expect(seiten).toBe(3);
    expect(gesehen).toEqual([...eigene].sort().reverse());
    expect(new Set(gesehen).size).toBe(7);
  });

  test("eine Person ohne Vorschläge bekommt eine leere Liste; Eltern dürfen die Route aufrufen", async () => {
    const antwort = await aufruf(konten.elternB, "GET", `${BASIS}/meine`);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({
      vorschlaege: [],
      weitere: false,
      naechste: null,
    });
  });

  test.each(["limit=0", "limit=101", "limit=x", "nach=x", "foo=1"])(
    "400 bei %s",
    async (abfrage) => {
      expect(
        (await aufruf(konten.slA, "GET", `${BASIS}/meine?${abfrage}`)).status,
      ).toBe(400);
    },
  );

  test("die Liste zeigt den Stand und die Begründung eines Entscheids", async () => {
    const sl = await neuePerson("slA");
    const [id] = await fuegeEin(sl.id!, 1);
    await db
      .update(terminVorschlag)
      .set({
        status: "abgelehnt",
        begruendung: "Schon belegt",
        entschiedenAm: new Date(),
        entschiedenVon: konten.admin.id,
      })
      .where(eq(terminVorschlag.id, id!));
    const body = (await (await aufruf(sl, "GET", `${BASIS}/meine`)).json()) as {
      vorschlaege: Record<string, unknown>[];
    };
    expect(body.vorschlaege[0]).toMatchObject({
      id,
      status: "abgelehnt",
      begruendung: "Schon belegt",
    });
    // Wer entschieden hat, bleibt verborgen
    expect(body.vorschlaege[0]).not.toHaveProperty("entschiedenVon");
    expect(body.vorschlaege[0]).not.toHaveProperty("abteilungId");
  });
});

describe("GET /termin-vorschlaege/:id", () => {
  test("die vorschlagende Person und die Abteilungsleitung sehen ihn, alle anderen nicht (404)", async () => {
    const sl = await neuePerson("slA");
    const [id] = await fuegeEin(sl.id!, 1);
    const erwartet: Record<string, number> = {
      slA: 200,
      admin: 200,
      adminOhneZweitenFaktor: 200,
      slB: 404,
      leitendeA: 404,
      leitendeAElternB: 404,
      elternA: 404,
      // Die Abteilungsleitung einer anderen Abteilung kennt ihn nicht
      demoAdmin: 404,
      demoEltern: 404,
    };
    for (const [persona, status] of Object.entries(erwartet)) {
      const konto = persona === "slA" ? sl : konten[persona as Persona];
      expect(
        (await aufruf(konto, "GET", `${BASIS}/${id}`)).status,
        persona,
      ).toBe(status);
    }
  });

  test("unbekannte ID 404, keine UUID 400, ohne Login 401", async () => {
    expect(
      (await aufruf(konten.admin, "GET", `${BASIS}/${randomUUID()}`)).status,
    ).toBe(404);
    expect((await aufruf(konten.admin, "GET", `${BASIS}/x`)).status).toBe(400);
    expect(
      (await aufruf(konten.ohneLogin, "GET", `${BASIS}/${randomUUID()}`))
        .status,
    ).toBe(401);
  });

  test("ein gelöschter Tag fehlt in der Anzeige, der Vorschlag bleibt lesbar", async () => {
    const sl = await neuePerson("slA");
    const [kurz] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Kurz ${randomUUID().slice(0, 8)}`,
        kuerzel: "K",
      })
      .returning({ id: schema.tag.id });
    const antwort = await aufruf(
      sl,
      "POST",
      BASIS,
      ganztaegig({ tagIds: [tagId, kurz!.id] }),
    );
    const { id } = (await antwort.json()) as { id: string };
    await db.delete(schema.tag).where(eq(schema.tag.id, kurz!.id));
    const detail = (await (
      await aufruf(sl, "GET", `${BASIS}/${id}`)
    ).json()) as {
      tags: { id: string }[];
    };
    expect(detail.tags.map((t) => t.id)).toEqual([tagId]);
  });
});

describe("DELETE /termin-vorschlaege/:id (zurückziehen)", () => {
  test("die vorschlagende Person zieht einen offenen zurück: 204, weg, Protokoll mit ID", async () => {
    const sl = await neuePerson("slA");
    const [id] = await fuegeEin(sl.id!, 1);
    expect((await aufruf(sl, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect((await aufruf(sl, "GET", `${BASIS}/${id}`)).status).toBe(404);
    expect((await aufruf(sl, "DELETE", `${BASIS}/${id}`)).status).toBe(404);
    const protokoll = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id!),
          eq(schema.auditLog.aktion, "termin_zurueckgezogen"),
        ),
      );
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]).toMatchObject({ akteurId: sl.id, details: null });
  });

  test.each(["freigegeben", "abgelehnt", "in_outlook_eingetragen"] as const)(
    "ein Vorschlag im Status %s bleibt: 409 VORSCHLAG_ENTSCHIEDEN",
    async (status) => {
      const sl = await neuePerson("slA");
      const [id] = await fuegeEin(sl.id!, 1, status);
      const antwort = await aufruf(sl, "DELETE", `${BASIS}/${id}`);
      expect(antwort.status).toBe(409);
      expect(await antwort.json()).toMatchObject({
        code: "VORSCHLAG_ENTSCHIEDEN",
      });
      expect((await aufruf(sl, "GET", `${BASIS}/${id}`)).status).toBe(200);
    },
  );

  test("fremde Vorschläge: die Abteilungsleitung bekommt 403, alle anderen 404, nichts wird gelöscht", async () => {
    const sl = await neuePerson("slA");
    const [id] = await fuegeEin(sl.id!, 1);
    for (const [persona, status] of [
      ["admin", 403],
      ["adminOhneZweitenFaktor", 403],
      ["slB", 404],
      ["leitendeA", 404],
      ["elternA", 404],
      ["demoAdmin", 404],
      ["demoEltern", 404],
    ] as const) {
      expect(
        (await aufruf(konten[persona], "DELETE", `${BASIS}/${id}`)).status,
        persona,
      ).toBe(status);
    }
    expect((await aufruf(sl, "GET", `${BASIS}/${id}`)).status).toBe(200);
  });

  test("ohne Recht zum Vorschlagen darf die Person ihren eigenen Vorschlag trotzdem zurückziehen", async () => {
    const [id] = await fuegeEin(konten.elternB.id!, 1);
    expect(
      (await aufruf(konten.elternB, "DELETE", `${BASIS}/${id}`)).status,
    ).toBe(204);
  });
});
