import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { erzeugeWebsite } from "../src/website/abgleich.js";
import { dateisystemAusgabe } from "../src/website/ausgabe.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../src/website/ereignisse.js";
import {
  faktenAus,
  heuteZuerich,
  ladeStufenfakten,
  ladeStufenfaktenGemerkt,
  vergissStufenfakten,
} from "../src/website/stufenfakten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { macheWebmaster } from "./hilfen/webmaster.js";
import { legeProgrammAn } from "./hilfen/programme.js";
import { antwortVerletzungen } from "./hilfen/vertrag.js";

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

let ausgabeLog: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabeLog = vi.spyOn(console, "log").mockImplementation(() => {});
  vergissStufenfakten();
});
afterEach(() => ausgabeLog.mockRestore());

let welt: Welt;
let admin: PersonaKonto;
let adminOhneFaktor: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let webmaster: PersonaKonto;
let eltern: PersonaKonto;
let demoAdmin: PersonaKonto;
let ohneLogin: PersonaKonto;
let seiteAId: string;

// Daten relativ zu heute (Zürich), damit kein Test an einem Kalendertag hängt
const tagIn = (n: number) => {
  const d = new Date(`${heuteZuerich()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const url = (stufeId: string, tag?: string) =>
  `/api/v1/redaktion/stufen/${stufeId}/eckdaten${tag ? `/${tag}` : ""}`;

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const FELDER = {
  treffZeit: "14:00",
  treffpunkt: "Beispielhaus 1, Musterdorf",
  schlussZeit: "17:00",
  schlussOrt: "Bahnhof",
  mitnehmen: "Trinkflasche\nZvieri",
};

// Neue Stufe mit eigener Stufenseite, damit Tests einander nicht stören
async function neueStufe(name: string, opts: { inhalt?: unknown } = {}) {
  const [s] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: `${name} ${randomUUID().slice(0, 6)}`,
      kuerzel: "N",
    })
    .returning();
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: `s-${randomUUID().slice(0, 12)}`,
      titel: name,
      tagId: s!.id,
      sichtbarkeit: opts.inhalt === undefined ? "angemeldet" : "oeffentlich",
    })
    .returning();
  if (opts.inhalt !== undefined) {
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: z!.id, nr: 1, inhalt: opts.inhalt })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, z!.id));
  }
  return { stufeId: s!.id, seiteId: z!.id, adresse: z!.adresse, name: s!.name };
}

const faktenDok = (titel: string) => ({
  v: 1,
  titel,
  bausteine: [
    { id: randomUUID(), typ: "stufenfakten", daten: {}, sichtbarkeit: "erbt" },
  ],
});

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, adminOhneFaktor, slA, slB, webmaster, eltern, demoAdmin, ohneLogin] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "adminOhneZweitenFaktor"),
      legePersonaAn(welt, "slA"),
      legePersonaAn(welt, "slB"),
      legePersonaMitFaktorAn(welt, "leitendeA"),
      legePersonaAn(welt, "elternA"),
      legePersonaAn(welt, "demoAdmin"),
      legePersonaAn(welt, "ohneLogin"),
    ]);
  // Webmaster = Plattformrolle mit allen Rechten ausser dem Wartungsmodus
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: `stufe-a-${randomUUID().slice(0, 8)}`,
      titel: "Stufe A",
      tagId: welt.stufeAId,
      sichtbarkeit: "angemeldet",
    })
    .returning();
  seiteAId = z!.id;
});

describe("Rechte", () => {
  test("Stufenleitung der Stufe schreibt, liest und löscht ohne zweiten Faktor; Abteilungsleitung und Webmaster (mit zweitem Faktor) auch", async () => {
    for (const [konto, n] of [
      [slA, 3],
      [admin, 4],
      [webmaster, 5],
    ] as const) {
      const tag = tagIn(n);
      expect(
        (await anfrage(konto, "PUT", url(welt.stufeAId, tag), FELDER)).status,
      ).toBe(204);
      const gelesen = await anfrage(konto, "GET", url(welt.stufeAId, tag));
      expect(gelesen.status).toBe(200);
      expect(await gelesen.json()).toEqual({
        tag,
        ...FELDER,
        treffpunktOrtId: null,
        schlussOrtId: null,
        quelle: "seite",
      });
      expect(
        (await anfrage(konto, "DELETE", url(welt.stufeAId, tag))).status,
      ).toBe(204);
    }
  });

  test("eine andere Stufenleitung, Eltern und Leitende ohne Recht: 403 auf allen Routen", async () => {
    const tag = tagIn(6);
    for (const konto of [slB, eltern]) {
      expect(
        (await anfrage(konto, "GET", url(welt.stufeAId))).status,
        "liste",
      ).toBe(403);
      expect(
        (await anfrage(konto, "GET", url(welt.stufeAId, tag))).status,
      ).toBe(403);
      expect(
        (await anfrage(konto, "PUT", url(welt.stufeAId, tag), FELDER)).status,
      ).toBe(403);
      expect(
        (await anfrage(konto, "DELETE", url(welt.stufeAId, tag))).status,
      ).toBe(403);
    }
    const [zeile] = await db
      .select()
      .from(schema.programmEckdaten)
      .where(
        and(
          eq(schema.programmEckdaten.stufeId, welt.stufeAId),
          eq(schema.programmEckdaten.tag, tag),
        ),
      );
    expect(zeile).toBeUndefined();
  });

  test("Fremdabteilung und unbekannte Stufe: 404, vor dem Recht; ohne Sitzung 401; Admin ohne zweiten Faktor 403", async () => {
    const tag = tagIn(6);
    expect(
      (await anfrage(demoAdmin, "PUT", url(welt.stufeAId, tag), FELDER)).status,
    ).toBe(404);
    expect((await anfrage(demoAdmin, "GET", url(welt.stufeAId))).status).toBe(
      404,
    );
    expect(
      (await anfrage(admin, "GET", url(welt.demoStufeId, tag))).status,
    ).toBe(404);
    expect((await anfrage(admin, "GET", url(randomUUID(), tag))).status).toBe(
      404,
    );
    expect((await anfrage(ohneLogin, "GET", url(welt.stufeAId))).status).toBe(
      401,
    );
    expect(
      (await anfrage(adminOhneFaktor, "GET", url(welt.stufeAId))).status,
    ).toBe(403);
  });

  test("ein Tag, der keine Stufe ist, ist 404", async () => {
    const [t] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Team ${randomUUID().slice(0, 6)}`,
        kuerzel: "T",
      })
      .returning();
    expect((await anfrage(admin, "GET", url(t!.id))).status).toBe(404);
  });
});

describe("Eingabe", () => {
  const put = (body: unknown, tag = tagIn(8)) =>
    anfrage(admin, "PUT", url(welt.stufeAId, tag), body);

  test.each([
    ["Zeit 25:00", { treffZeit: "25:00" }],
    ["Zeit ohne Doppelpunkt", { schlussZeit: "1700" }],
    ["Treffpunkt zu lang", { treffpunkt: "x".repeat(501) }],
    ["Mitnehmen zu lang", { mitnehmen: "x".repeat(1001) }],
    ["NUL im Text", { treffpunkt: "a\u0000b" }],
    ["unbekanntes Feld", { treffpunkt: "a", farbe: "rot" }],
    ["leerer Body", {}],
    ["nur leere Werte", { treffpunkt: "  ", mitnehmen: "" }],
  ])("%s: 400", async (_name, body) => {
    expect((await put(body)).status).toBe(400);
  });

  test("ungültiges Datum und Datum in der Vergangenheit", async () => {
    expect((await put({ treffpunkt: "a" }, "2027-02-30")).status).toBe(400);
    expect((await put({ treffpunkt: "a" }, "morgen")).status).toBe(400);
    const vergangen = await put({ treffpunkt: "a" }, tagIn(-1));
    expect(vergangen.status).toBe(400);
    expect(((await vergangen.json()) as { code: string }).code).toBe(
      "DATUM_VERGANGEN",
    );
    // Heute ist erlaubt
    expect((await put({ treffpunkt: "heute" }, tagIn(0))).status).toBe(204);
    await anfrage(admin, "DELETE", url(welt.stufeAId, tagIn(0)));
  });

  test("leere Felder werden null, Text wird gekürzt um Leerraum", async () => {
    const tag = tagIn(9);
    expect(
      (
        await put(
          { treffpunkt: "  Wald  ", schlussOrt: "", treffZeit: "" },
          tag,
        )
      ).status,
    ).toBe(204);
    const z = await (
      await anfrage(admin, "GET", url(welt.stufeAId, tag))
    ).json();
    expect(z).toMatchObject({
      treffpunkt: "Wald",
      schlussOrt: null,
      treffZeit: null,
    });
    await anfrage(admin, "DELETE", url(welt.stufeAId, tag));
  });

  test("Obergrenze: 20 gepflegte kommende Daten je Stufe, Ändern bleibt möglich", async () => {
    const s = await neueStufe("Grenze");
    for (let i = 1; i <= 20; i++) {
      expect(
        (await anfrage(admin, "PUT", url(s.stufeId, tagIn(i)), FELDER)).status,
      ).toBe(204);
    }
    const zuviel = await anfrage(
      admin,
      "PUT",
      url(s.stufeId, tagIn(21)),
      FELDER,
    );
    expect(zuviel.status).toBe(409);
    expect(((await zuviel.json()) as { code: string }).code).toBe(
      "ECKDATEN_ZU_VIELE",
    );
    expect(
      (
        await anfrage(admin, "PUT", url(s.stufeId, tagIn(5)), {
          treffpunkt: "geändert",
        })
      ).status,
    ).toBe(204);
    const liste = (await (
      await anfrage(admin, "GET", url(s.stufeId))
    ).json()) as {
      eckdaten: unknown[];
    };
    expect(liste.eckdaten).toHaveLength(20);
  });

  test("Audit nennt Datum und Feldnamen, nie die Werte", async () => {
    const tag = tagIn(10);
    await put({ treffpunkt: "GEHEIMER-ORT", mitnehmen: "GEHEIMES-ZEUG" }, tag);
    await anfrage(admin, "DELETE", url(welt.stufeAId, tag));
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, welt.stufeAId));
    const geaendert = zeilen.find(
      (z) =>
        z.aktion === "eckdaten_geaendert" &&
        (z.details as { tag: string }).tag === tag,
    );
    expect(geaendert?.details).toEqual({
      tag,
      felder: ["treffpunkt", "mitnehmen"],
    });
    expect(zeilen.some((z) => z.aktion === "eckdaten_geloescht")).toBe(true);
    expect(JSON.stringify(zeilen)).not.toContain("GEHEIM");
  });
});

describe("Programm aus den gepflegten Feldern (#361)", () => {
  const programmeVon = (stufeId: string) =>
    db
      .select({
        titel: schema.programm.titel,
        beginn: schema.programm.beginn,
        ende: schema.programm.ende,
        ganztaegig: schema.programm.ganztaegig,
        tagVon: schema.programm.tagVon,
        sichtbarkeit: schema.programm.sichtbarkeit,
        googleEventId: schema.programm.googleEventId,
      })
      .from(schema.programm)
      .innerJoin(
        schema.programmTag,
        eq(schema.programmTag.programmId, schema.programm.id),
      )
      .where(eq(schema.programmTag.tagId, stufeId));

  test("ohne Kalender entsteht das Programm beim Speichern: Zeiten in Zürich, für Eltern sichtbar, der Stufe zugeordnet; ein zweites Speichern legt kein zweites an", async () => {
    const s = await neueStufe("Programm");
    // 10. April 2027: Sommerzeit, 14:00 und 17:00 Uhr in Zürich sind 12:00 und 15:00 UTC
    const tag = "2027-04-10";
    expect(
      (await anfrage(admin, "PUT", url(s.stufeId, tag), FELDER)).status,
    ).toBe(204);
    const erwartet = {
      titel: `Cevi-Programm ${s.name}`,
      beginn: new Date("2027-04-10T12:00:00Z"),
      ende: new Date("2027-04-10T15:00:00Z"),
      ganztaegig: false,
      tagVon: null,
      sichtbarkeit: "eltern",
      googleEventId: `web:${s.stufeId}:${tag}`,
    };
    expect(await programmeVon(s.stufeId)).toEqual([erwartet]);
    await anfrage(admin, "PUT", url(s.stufeId, tag), {
      ...FELDER,
      treffpunkt: "Anderer Ort",
    });
    expect(await programmeVon(s.stufeId)).toEqual([erwartet]);
    // Weitere Daten sind weitere Programme; das Löschen der Zeile nimmt nur das eigene mit
    await anfrage(admin, "PUT", url(s.stufeId, "2027-04-17"), FELDER);
    expect(await programmeVon(s.stufeId)).toHaveLength(2);
    expect(
      (await anfrage(admin, "DELETE", url(s.stufeId, "2027-04-17"))).status,
    ).toBe(204);
    expect(await programmeVon(s.stufeId)).toEqual([erwartet]);
  });

  test("ohne beide Zeiten (oder mit Schluss vor Beginn) ganztägig", async () => {
    const s = await neueStufe("Ganztaegig");
    await anfrage(admin, "PUT", url(s.stufeId, "2027-05-01"), {
      treffpunkt: "Wald",
    });
    await anfrage(admin, "PUT", url(s.stufeId, "2027-05-08"), {
      treffZeit: "17:00",
      schlussZeit: "14:00",
    });
    const zeilen = await programmeVon(s.stufeId);
    expect(zeilen).toHaveLength(2);
    expect(zeilen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ganztaegig: true,
          beginn: null,
          ende: null,
          tagVon: "2027-05-01",
        }),
        expect.objectContaining({ ganztaegig: true, tagVon: "2027-05-08" }),
      ]),
    );
  });

  test("mit Kalender in der Abteilung entsteht nichts", async () => {
    const s = await neueStufe("Kalender");
    await db
      .update(schema.abteilung)
      .set({ googleKalenderId: "kalender-test" })
      .where(eq(schema.abteilung.id, welt.testabteilungId));
    try {
      expect(
        (await anfrage(admin, "PUT", url(s.stufeId, tagIn(20)), FELDER)).status,
      ).toBe(204);
      expect(await programmeVon(s.stufeId)).toEqual([]);
    } finally {
      // Die ungültige Adresse bliebe sonst in der Datenbank und störte jeden Kalender-Sync
      await db
        .update(schema.abteilung)
        .set({ googleKalenderId: null })
        .where(eq(schema.abteilung.id, welt.testabteilungId));
    }
  });

  test("kein Abruf fremder Webseiten: weder im Code noch beim Speichern", async () => {
    const abruf = vi.spyOn(globalThis, "fetch");
    const s = await neueStufe("Ohnefetch");
    await anfrage(admin, "PUT", url(s.stufeId, tagIn(21)), FELDER);
    expect(abruf).not.toHaveBeenCalled();
    abruf.mockRestore();
  });
});

describe("App-Vertrag bleibt", () => {
  test("GET /api/v1/programme/{id} zeigt die gepflegten Werte im alten Format", async () => {
    const tag = tagIn(14);
    const p = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      tagVon: tag,
    });
    const lies = async () => {
      const antwort = await app.request(`/api/v1/programme/${p.id}`, {
        headers: eltern.headers,
      });
      expect(antwort.status).toBe(200);
      const body = (await antwort.json()) as Record<string, unknown>;
      expect(
        antwortVerletzungen("/api/v1/programme/{id}", "get", 200, body),
      ).toEqual([]);
      return body;
    };
    const vorher = await lies();
    expect(vorher).toMatchObject({
      treffpunkt: null,
      schlussOrt: null,
      schlussZeit: null,
      mitnehmen: null,
    });
    expect(
      (await anfrage(slA, "PUT", url(welt.stufeAId, tag), FELDER)).status,
    ).toBe(204);
    const nachher = await lies();
    expect(nachher).toMatchObject({
      treffpunkt: FELDER.treffpunkt,
      schlussOrt: FELDER.schlussOrt,
      schlussZeit: FELDER.schlussZeit,
      mitnehmen: FELDER.mitnehmen,
    });
    // Dieselben Schlüssel wie vorher: Die Treffzeit kommt nicht dazu
    expect(Object.keys(nachher).sort()).toEqual(Object.keys(vorher).sort());
    expect(nachher).not.toHaveProperty("treffZeit");
    await anfrage(admin, "DELETE", url(welt.stufeAId, tag));
  });

  test("das aus den gepflegten Feldern angelegte Programm hat in der App dasselbe Format und dieselben Werte (#361)", async () => {
    const tag = tagIn(30);
    await anfrage(slA, "PUT", url(welt.stufeAId, tag), FELDER);
    const [p] = await db
      .select({ id: schema.programm.id })
      .from(schema.programm)
      .where(eq(schema.programm.googleEventId, `web:${welt.stufeAId}:${tag}`));
    const antwort = await app.request(`/api/v1/programme/${p!.id}`, {
      headers: eltern.headers,
    });
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as Record<string, unknown>;
    expect(
      antwortVerletzungen("/api/v1/programme/{id}", "get", 200, body),
    ).toEqual([]);
    expect(body).toMatchObject({
      treffpunkt: FELDER.treffpunkt,
      schlussOrt: FELDER.schlussOrt,
      schlussZeit: FELDER.schlussZeit,
      mitnehmen: FELDER.mitnehmen,
    });
    await anfrage(admin, "DELETE", url(welt.stufeAId, tag));
  });

  test("die Antworten der neuen Routen entsprechen openapi.yaml", async () => {
    const tag = tagIn(15);
    await anfrage(admin, "PUT", url(welt.stufeAId, tag), FELDER);
    const einzeln = await anfrage(admin, "GET", url(welt.stufeAId, tag));
    expect(
      antwortVerletzungen(
        "/api/v1/redaktion/stufen/{stufeId}/eckdaten/{tag}",
        "get",
        200,
        await einzeln.json(),
      ),
    ).toEqual([]);
    const liste = await anfrage(admin, "GET", url(welt.stufeAId));
    expect(
      antwortVerletzungen(
        "/api/v1/redaktion/stufen/{stufeId}/eckdaten",
        "get",
        200,
        await liste.json(),
      ),
    ).toEqual([]);
    await anfrage(admin, "DELETE", url(welt.stufeAId, tag));
  });
});

describe("Datenquelle für den Baustein «stufenfakten»", () => {
  test("die Zeile des nächsten Datums zählt; vergangene nicht; nach dem Löschen gilt die nächste", async () => {
    const s = await neueStufe("Naechste");
    await db.insert(schema.programmEckdaten).values([
      { stufeId: s.stufeId, tag: tagIn(2), treffpunkt: "Nah-Ort" },
      { stufeId: s.stufeId, tag: tagIn(-3), treffpunkt: "Vergangen" },
    ]);
    await anfrage(admin, "PUT", url(s.stufeId, tagIn(9)), FELDER);
    const nah = await ladeStufenfakten(db, welt.testabteilungId, [s.seiteId]);
    expect(nah.stufenfakten?.get(s.seiteId)).toEqual([
      expect.objectContaining({ bezeichnung: "Datum" }),
      { bezeichnung: "Treffpunkt", wert: "Nah-Ort" },
    ]);
    await anfrage(admin, "DELETE", url(s.stufeId, tagIn(2)));
    const spaeter = await ladeStufenfakten(db, welt.testabteilungId, [
      s.seiteId,
    ]);
    expect(
      spaeter.stufenfakten?.get(s.seiteId)?.map((f) => f.bezeichnung),
    ).toEqual([
      "Datum",
      "Treffzeit",
      "Treffpunkt",
      "Schlusszeit",
      "Schlussort",
      "Mitnehmen",
    ]);
    expect(spaeter.stufenfakten?.get(s.seiteId)?.[1]).toEqual({
      bezeichnung: "Treffzeit",
      wert: "14:00 Uhr",
    });
  });

  test("Seiten ohne Stufe, ohne Zeile oder aus einer anderen Abteilung bekommen nichts", async () => {
    const s = await neueStufe("Leer");
    const [ohneTag] = await db
      .insert(schema.seite)
      .values({
        abteilungId: welt.testabteilungId,
        adresse: `o-${randomUUID().slice(0, 8)}`,
        titel: "Ohne Tag",
        sichtbarkeit: "angemeldet",
      })
      .returning();
    await db.insert(schema.programmEckdaten).values({
      stufeId: s.stufeId,
      tag: tagIn(3),
      treffpunkt: "x",
    });
    const mehr = await ladeStufenfakten(db, welt.testabteilungId, [
      ohneTag!.id,
      seiteAId,
    ]);
    expect(mehr.stufenfakten?.size).toBe(0);
    const fremd = await ladeStufenfakten(db, welt.demoAbteilungId, [s.seiteId]);
    expect(fremd.stufenfakten?.size).toBe(0);
    expect(
      (await ladeStufenfakten(db, welt.testabteilungId, [])).stufenfakten,
    ).toEqual(new Map());
  });

  test("zwei Seiten, eine Abfrage; das Nachladen merkt sich das Ergebnis", async () => {
    const a = await neueStufe("Eins");
    const b = await neueStufe("Zwei");
    for (const s of [a, b]) {
      await db.insert(schema.programmEckdaten).values({
        stufeId: s.stufeId,
        tag: tagIn(4),
        treffpunkt: s.name,
      });
    }
    const abfrage = vi.spyOn(db, "selectDistinctOn");
    const beide = await ladeStufenfakten(db, welt.testabteilungId, [
      a.seiteId,
      b.seiteId,
    ]);
    expect(abfrage).toHaveBeenCalledTimes(1);
    expect(beide.stufenfakten?.size).toBe(2);
    abfrage.mockClear();
    await ladeStufenfaktenGemerkt(db, welt.testabteilungId, a.seiteId);
    await ladeStufenfaktenGemerkt(db, welt.testabteilungId, a.seiteId);
    expect(abfrage).toHaveBeenCalledTimes(1);
    abfrage.mockRestore();
  });

  test("faktenAus: nur Felder mit Inhalt, Datum auf Deutsch", () => {
    expect(
      faktenAus({
        tag: "2027-04-10",
        treffZeit: null,
        treffpunkt: "Wald",
        schlussZeit: null,
        schlussOrt: "  ",
        mitnehmen: null,
      }),
    ).toEqual([
      { bezeichnung: "Datum", wert: "Samstag, 10. April 2027" },
      { bezeichnung: "Treffpunkt", wert: "Wald" },
    ]);
  });
});

describe("Mitnehmen als Liste (#645)", () => {
  const zeile = (mitnehmen: string | null) => ({
    tag: "2027-04-10",
    treffZeit: null,
    treffpunkt: null,
    schlussZeit: null,
    schlussOrt: null,
    mitnehmen,
  });
  const letzter = (mitnehmen: string | null) =>
    faktenAus(zeile(mitnehmen)).at(-1);

  test("mehrere Dinge: Liste, der Wortlaut bleibt als Wert", () => {
    expect(letzter(" Kluft, Zvieri ")).toEqual({
      bezeichnung: "Mitnehmen",
      wert: "Kluft, Zvieri",
      lang: true,
      liste: ["Kluft", "Zvieri"],
    });
  });

  test("ein Satz ohne Trenner: Text ohne Liste; leer: keine Zeile", () => {
    expect(letzter("Warme Kleidung")).toEqual({
      bezeichnung: "Mitnehmen",
      wert: "Warme Kleidung",
      lang: true,
    });
    expect(letzter("  ")?.bezeichnung).toBe("Datum");
    expect(letzter(null)?.bezeichnung).toBe("Datum");
  });
});

describe("Seite und Nachladen", () => {
  let wurzel: string;
  beforeEach(async () => {
    wurzel = await mkdtemp(join(tmpdir(), "cevi-eckdaten-"));
  });
  afterEach(() => rm(wurzel, { recursive: true, force: true }));

  // Der Merker hält die Hashes der Gesamtdateien wie im Betrieb
  const merker = new Map<string, string>();
  const lauf = () =>
    erzeugeWebsite(db, {
      merker,
      ausgabe: dateisystemAusgabe(wurzel),
      abteilungId: welt.testabteilungId,
      basisUrl: "https://www.example.org",
      stylesheet: "body{}",
      datenquellen: [ladeStufenfakten],
    });

  test("die statische Seite zeigt die Felder, maskiert Text und wird nur bei Änderung neu erzeugt", async () => {
    // Eigene Abteilung der Welt: Der Lauf rendert alle ihre Seiten; diese eine ist die öffentliche Stufenseite
    const s = await neueStufe("Render", { inhalt: faktenDok("Render") });
    const boese = `<script>alert(1)</script> & "Anführung"`;
    await anfrage(admin, "PUT", url(s.stufeId, tagIn(7)), {
      ...FELDER,
      treffpunkt: boese,
    });
    expect((await lauf()).fehler).toBe(0);
    const datei = `${s.adresse}/index.html`;
    const html = await readFile(join(wurzel, datei), "utf8");
    expect(html).toContain("<dt>Treffzeit</dt><dd>14:00 Uhr</dd>");
    expect(html).toContain("<dt>Schlussort</dt><dd>Bahnhof</dd>");
    expect(html).toContain("<dt>Mitnehmen</dt>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp;");
    expect(html).not.toContain("<script>alert(1)");
    // Zweiter Lauf ohne Änderung: nichts wird geschrieben
    expect(await lauf()).toEqual({ geschrieben: 0, geloescht: 0, fehler: 0 });
    // Änderung über die Route meldet das Ereignis, und der nächste Lauf erzeugt die Seite neu
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    await anfrage(admin, "PUT", url(s.stufeId, tagIn(7)), {
      ...FELDER,
      treffpunkt: "Neuer Ort",
    });
    ab();
    expect(ereignisse).toEqual([
      {
        art: "seite_geaendert",
        abteilungId: welt.testabteilungId,
        seiteId: s.seiteId,
      },
    ]);
    const neu = await lauf();
    expect(neu.geschrieben).toBe(1);
    expect(await readFile(join(wurzel, datei), "utf8")).toContain(
      "<dd>Neuer Ort</dd>",
    );
  });

  test("Nachladen geschützter Samstagsangaben der Stufen: neue Werte nach dem Speichern, Eltern sehen sie, ohne Sitzung 401", async () => {
    const s = await neueStufe("Geschuetzt");
    const dok = faktenDok("Geschützt");
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: s.seiteId, nr: 1, inhalt: dok })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, s.seiteId));
    const tag = tagIn(5);
    await anfrage(admin, "PUT", url(s.stufeId, tag), {
      treffpunkt: "Erster Ort",
    });
    const hole = (konto: PersonaKonto) =>
      app.request(
        `/api/v1/website/inhalt?pfad=${encodeURIComponent(`/${s.adresse}`)}`,
        { headers: konto.headers },
      );
    const erste = await hole(eltern);
    expect(erste.status).toBe(200);
    expect(JSON.stringify(await erste.json())).toContain("Erster Ort");
    await anfrage(admin, "PUT", url(s.stufeId, tag), {
      treffpunkt: "Zweiter Ort",
    });
    const zweite = JSON.stringify(await (await hole(eltern)).json());
    expect(zweite).toContain("Zweiter Ort");
    expect(zweite).not.toContain("Erster Ort");
    expect((await hole(ohneLogin)).status).toBe(401);
  });
});
