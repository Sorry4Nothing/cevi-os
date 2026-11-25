import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
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
import { kodiereMedienbild } from "../src/bild-sharp.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import { ladeSeiten } from "../src/seiten.js";
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

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt S3
const objekte = new Map<string, Uint8Array>();
const medienspeicher: Medienspeicher = {
  ablegen: async (inhalt) => {
    const schluessel = randomUUID();
    objekte.set(schluessel, inhalt);
    return schluessel;
  },
  holen: async (schluessel) => objekte.get(schluessel) ?? new Uint8Array(),
  loeschen: async (schluessel) => {
    objekte.delete(schluessel);
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  kodiereMedienbild,
  medienspeicher,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const ICH = "/api/v1/redaktion/ich";
const MEDIEN = "/api/v1/redaktion/medien";
const HOCH = `${MEDIEN}?sichtbarkeit=angemeldet`;

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let webmaster: PersonaKonto;
let ohneRecht: PersonaKonto;
let eltern: PersonaKonto;
let demoEltern: PersonaKonto;
let bild: Buffer;
const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const holen = (konto: PersonaKonto, pfad: string) =>
  app.request(pfad, { headers: konto.headers });
const senden = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) =>
  app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
const hochladen = (
  konto: PersonaKonto,
  daten: Buffer = bild,
  query = "&altText=Blaues%20Feld",
) =>
  app.request(HOCH + query, {
    method: "POST",
    headers: konto.headers,
    body: new Uint8Array(daten),
  });
// Lädt hoch und prüft den Status 201
async function lege(konto: PersonaKonto, daten?: Buffer, query?: string) {
  const antwort = await hochladen(konto, daten, query);
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { id: string }).id;
}
const code = async (antwort: Response) =>
  ((await antwort.json()) as { code: string }).code;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  bild = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
  [
    admin,
    adminOhne,
    demoAdmin,
    demoEltern,
    slA,
    slB,
    webmaster,
    ohneRecht,
    eltern,
  ] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "adminOhneZweitenFaktor"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "demoEltern"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "slB"),
    // Eine Leitende ohne Stufenleitung, der die Abteilungsleitung das Recht auf alle Seiten gibt
    legePersonaMitFaktorAn(welt, "leitendeA"),
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "elternA"),
  ]);
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
  // Telefon, E-Mail und Cevi-Name der Stufenleitung A: Die Auswahlliste darf nur den Namen zeigen
  await db
    .update(schema.user)
    .set({ ceviName: "Flink", telefon: "+41791234567" })
    .where(eq(schema.user.id, slA.id!));
});

describe("GET /api/v1/redaktion/ich", () => {
  test.each([
    ["Abteilungsleitung", () => admin, { redigieren: true, verwalten: true }],
    ["Webmaster", () => webmaster, { redigieren: true, verwalten: true }],
    ["Stufenleitung", () => slA, { redigieren: true, verwalten: false }],
    [
      "Leitende ohne Recht",
      () => ohneRecht,
      { redigieren: false, verwalten: false },
    ],
    ["Eltern", () => eltern, { redigieren: false, verwalten: false }],
  ])("%s", async (name, konto, erwartet) => {
    const antwort = await holen(konto(), ICH);
    expect(antwort.status).toBe(200);
    const koerper = (await antwort.json()) as {
      redigieren: boolean;
      bereiche: string[];
      verwalten: boolean;
    };
    expect(koerper).toMatchObject(erwartet);
    // Die Abteilungsleitung darf auch den Wartungsmodus schalten (#424): «plattform», und hat die Rechte für Lädeli, Lager und System (#648)
    expect(koerper.bereiche).toEqual(
      !koerper.redigieren
        ? []
        : name === "Abteilungsleitung"
          ? ["website", "plattform", "laedeli", "lager", "system", "fotos", "formulare"]
          : // Die Vorgabe «Webmaster» hat auch «fotos.verwalten» (#690)
            name === "Webmaster"
            ? ["website", "fotos"]
            : ["website"],
    );
    expect(koerper.verwalten).toBe(erwartet.verwalten);
  });

  test("Abteilungsleitung ohne zweiten Faktor bleibt gesperrt, ohne Sitzung 401", async () => {
    const gesperrt = await holen(adminOhne, ICH);
    expect(gesperrt.status).toBe(403);
    expect(await code(gesperrt)).toBe("ZWEITER_FAKTOR_FEHLT");
    expect((await app.request(ICH)).status).toBe(401);
  });
});

describe("Medien", () => {
  test("Stufenleitung und Webmaster laden hoch; ein Bild ohne Alt-Text ist 400", async () => {
    expect((await hochladen(slA)).status).toBe(201);
    expect((await hochladen(webmaster)).status).toBe(201);
    const ohneText = await hochladen(slA, bild, "");
    expect(ohneText.status).toBe(400);
    expect(await code(ohneText)).toBe("ALT_TEXT");
    const dekorativ = await hochladen(slA, bild, "&dekorativ=true");
    expect(dekorativ.status).toBe(201);
    expect(
      await hochladen(slA, bild, "&altText=Text&dekorativ=true"),
    ).toHaveProperty("status", 400);
  });

  test("ohne Zugang 403 (Eltern, Leitende ohne Recht, Abteilungsleitung ohne zweiten Faktor), kein Upload und keine Liste", async () => {
    for (const konto of [eltern, ohneRecht, adminOhne]) {
      expect((await hochladen(konto)).status).toBe(403);
      expect((await holen(konto, MEDIEN)).status).toBe(403);
    }
    expect((await app.request(MEDIEN)).status).toBe(401);
  });

  test("die Liste zeigt nur die eigene Abteilung", async () => {
    const id = await lege(slA);
    const eigene = (await (await holen(slB, MEDIEN)).json()) as {
      medien: { id: string }[];
    };
    expect(eigene.medien.map((m) => m.id)).toContain(id);
    const fremde = (await (await holen(demoAdmin, MEDIEN)).json()) as {
      medien: { id: string }[];
    };
    expect(fremde.medien.map((m) => m.id)).not.toContain(id);
  });

  test("Alt-Text nachtragen: die Person, die hochgeladen hat, die Webmaster und die Abteilungsleitung; im Audit-Log ohne Text", async () => {
    const id = await lege(slA);
    const eigenes = await senden(slA, "PATCH", `${MEDIEN}/${id}`, {
      altText: "Neuer Text",
    });
    expect(eigenes.status).toBe(200);
    expect(await eigenes.json()).toMatchObject({
      id,
      altText: "Neuer Text",
      dekorativ: false,
    });
    const reaktion = await senden(webmaster, "PATCH", `${MEDIEN}/${id}`, {
      dekorativ: true,
    });
    expect(await reaktion.json()).toMatchObject({
      altText: null,
      dekorativ: true,
    });
    expect(
      (
        await senden(admin, "PATCH", `${MEDIEN}/${id}`, {
          altText: "Abteilungsleitung",
        })
      ).status,
    ).toBe(200);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id),
          eq(schema.auditLog.aktion, "medium_beschrieben"),
        ),
      );
    expect(zeilen).toHaveLength(3);
    expect(JSON.stringify(zeilen)).not.toContain("Neuer Text");
  });

  test("fremde Uploads beschreibt eine Stufenleitung nicht (403), Eltern ebenso", async () => {
    const id = await lege(admin);
    for (const konto of [slA, slB, ohneRecht, eltern]) {
      const antwort = await senden(konto, "PATCH", `${MEDIEN}/${id}`, {
        altText: "Fremd",
      });
      expect(antwort.status).toBe(403);
    }
    const [m] = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, id));
    expect(m.altText).toBe("Blaues Feld");
  });

  test("ein anderer Hochlader ohne Zugang verliert das Recht an seinem Upload", async () => {
    // Eine eigene Stufenleitung, damit die übrigen Tests ihre Rolle behalten
    const sl = await legePersonaAn(welt, "slA");
    const id = await lege(sl);
    // Die Rolle fällt weg: Zugang weg, der Upload bleibt, das Recht daran nicht
    await db
      .delete(schema.personTag)
      .where(eq(schema.personTag.userId, sl.id!));
    expect((await holen(sl, MEDIEN)).status).toBe(403);
    expect(
      (await senden(sl, "PATCH", `${MEDIEN}/${id}`, { altText: "Nochmals" }))
        .status,
    ).toBe(403);
  });

  test("Eingabe: genau eines von altText und dekorativ, PDF-Upload 415, fremde Abteilung 404", async () => {
    const id = await lege(slB);
    for (const body of [
      {},
      { altText: "A", dekorativ: true },
      { altText: "" },
      { dekorativ: false },
      { sichtbarkeit: "oeffentlich" },
    ]) {
      expect((await senden(slB, "PATCH", `${MEDIEN}/${id}`, body)).status).toBe(
        400,
      );
    }
    // Seit #428 nimmt der Medienspeicher keine PDF mehr an (Dateien sind Verknüpfungen auf SharePoint)
    const pdfAntwort = await hochladen(slB, pdf, "");
    expect(pdfAntwort.status).toBe(415);
    for (const konto of [demoAdmin, demoEltern]) {
      expect(
        (await senden(konto, "PATCH", `${MEDIEN}/${id}`, { altText: "X" }))
          .status,
      ).toBe(404);
    }
    expect(
      (
        await senden(slB, "PATCH", `${MEDIEN}/${randomUUID()}`, {
          altText: "X",
        })
      ).status,
    ).toBe(404);
  });

  test("Löschen nur Abteilungsleitung und Webmaster; eine Stufenleitung nicht einmal ihr eigenes Medium", async () => {
    const id = await lege(slA);
    expect((await senden(slA, "DELETE", `${MEDIEN}/${id}`)).status).toBe(403);
    expect((await senden(eltern, "DELETE", `${MEDIEN}/${id}`)).status).toBe(
      403,
    );
    expect((await senden(demoAdmin, "DELETE", `${MEDIEN}/${id}`)).status).toBe(
      404,
    );
    expect((await senden(webmaster, "DELETE", `${MEDIEN}/${id}`)).status).toBe(
      204,
    );
    const rest = await db
      .select()
      .from(schema.medium)
      .where(eq(schema.medium.id, id));
    expect(rest).toHaveLength(0);
    expect((await senden(admin, "DELETE", `${MEDIEN}/${id}`)).status).toBe(404);
  });
});

describe("Auswahllisten", () => {
  type TagListe = { tags: Record<string, unknown>[] };
  type PersonenListe = { personen: Record<string, unknown>[] };

  test("Tags der Abteilung: nur Id, Name und Typ", async () => {
    for (const konto of [admin, slA, webmaster]) {
      const antwort = await holen(konto, "/api/v1/redaktion/tags");
      expect(antwort.status).toBe(200);
      const { tags } = (await antwort.json()) as TagListe;
      expect(tags.map((t) => t.id)).toEqual(
        expect.arrayContaining([welt.stufeAId, welt.stufeBId]),
      );
      expect(tags.map((t) => t.id)).not.toContain(welt.demoStufeId);
      for (const t of tags) {
        expect(Object.keys(t).sort()).toEqual(["id", "name", "typ"]);
      }
    }
  });

  test("Personen mit Tag: Id, Anzeigename und Funktion, nie Telefon oder E-Mail", async () => {
    const antwort = await holen(
      webmaster,
      `/api/v1/redaktion/personen?tag=${welt.stufeAId}`,
    );
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    const { personen } = JSON.parse(text) as PersonenListe;
    const meine = personen.find((p) => p.id === slA.id);
    expect(meine).toEqual({
      id: slA.id,
      anzeigename: "Flink",
      funktion: "stufenleitung",
      // Stufenleitung: eine Rolle mit Aussenwirkung (#610)
      aufWebsite: true,
      gruppe: expect.any(String),
      tagId: welt.stufeAId,
      // Kein Profilbild: kein Pfad (die Auswahl zeigt Initialen)
      bildUrl: null,
    });
    // Wer den Tag nicht trägt, steht nicht in der Liste
    expect(personen.map((p) => p.id)).not.toContain(slB.id);
    for (const p of personen) {
      expect(Object.keys(p).sort()).toEqual([
        "anzeigename",
        "aufWebsite",
        "bildUrl",
        "funktion",
        "gruppe",
        "id",
        "tagId",
      ]);
    }
    expect(text).not.toContain("+41791234567");
    expect(text).not.toContain("@example.org");
  });

  test("ohne Tag: alle Leitenden der Abteilung nach Gruppe und Name, nie Eltern oder andere Abteilungen (#755)", async () => {
    // Eltern in der Gruppe, ohne Rolle: erscheinen auf der Website nie
    await db
      .insert(schema.personTag)
      .values({ userId: eltern.id!, tagId: welt.stufeAId, rolle: null });
    const pfad = "/api/v1/redaktion/personen";
    const antwort = await holen(webmaster, pfad);
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    const { personen } = JSON.parse(text) as PersonenListe;
    const ids = personen.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([slA.id, slB.id]));
    expect(ids).not.toContain(eltern.id);
    expect(ids).not.toContain(demoEltern.id);
    for (const p of personen) {
      expect(["leitung", "stufenleitung"]).toContain(p.funktion);
      expect(p.aufWebsite).toBe(true);
    }
    const gruppen = personen.map((p) => p.gruppe as string);
    expect(gruppen).toEqual(
      [...gruppen].sort(new Intl.Collator("de-CH").compare),
    );
    expect(personen.find((p) => p.id === slA.id)).toMatchObject({
      anzeigename: "Flink",
      tagId: welt.stufeAId,
    });
    expect(text).not.toContain("+41791234567");
    // Auch mit Tag steht nur, wer auf die Website darf
    const mitTag = (await (
      await holen(webmaster, `${pfad}?tag=${welt.stufeAId}`)
    ).json()) as PersonenListe;
    expect(mitTag.personen.map((p) => p.id)).not.toContain(eltern.id);
    // Die Demo-Abteilung sieht nur ihre eigenen Leitenden
    const demo = (await (await holen(demoAdmin, pfad)).json()) as PersonenListe;
    expect(demo.personen.map((p) => p.id)).not.toContain(slA.id);
    for (const konto of [eltern, ohneRecht, demoEltern]) {
      expect((await holen(konto, pfad)).status).toBe(403);
    }
  });

  test("ein deaktiviertes Konto steht nicht in der Liste", async () => {
    const weg = await legePersonaAn(welt, "slA");
    const pfad = `/api/v1/redaktion/personen?tag=${welt.stufeAId}`;
    const vorher = (await (await holen(admin, pfad)).json()) as PersonenListe;
    expect(vorher.personen.map((p) => p.id)).toContain(weg.id);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, weg.id!));
    const nachher = (await (await holen(admin, pfad)).json()) as PersonenListe;
    expect(nachher.personen.map((p) => p.id)).not.toContain(weg.id);
  });

  test("Zugang, Eingabe und Abteilung", async () => {
    const pfad = `/api/v1/redaktion/personen?tag=${welt.stufeAId}`;
    for (const konto of [eltern, ohneRecht, adminOhne, demoEltern]) {
      expect((await holen(konto, pfad)).status).toBe(403);
      expect((await holen(konto, "/api/v1/redaktion/tags")).status).toBe(403);
    }
    expect((await holen(admin, "/api/v1/redaktion/personen")).status).toBe(200);
    expect(
      (await holen(admin, "/api/v1/redaktion/personen?tag=kein-uuid")).status,
    ).toBe(400);
    expect(
      (await holen(admin, `${pfad}&weiter=1`)).status,
      "unbekannter Parameter",
    ).toBe(400);
    // Ein Tag der Demo-Abteilung gibt es für die Testabteilung nicht
    expect(
      (await holen(admin, `/api/v1/redaktion/personen?tag=${welt.demoStufeId}`))
        .status,
    ).toBe(404);
    expect(
      (
        await holen(
          demoAdmin,
          `/api/v1/redaktion/personen?tag=${welt.stufeAId}`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("Personenwahl mit Foto und Leitungsteam (#760)", () => {
  type Team = {
    gruppe: string;
    stufe: boolean;
    personen: {
      id: string;
      anzeigename: string;
      funktion: string | null;
      bildUrl: string | null;
    }[];
  };
  const team = async (konto: PersonaKonto, tagId: string) =>
    holen(konto, `/api/v1/redaktion/leitungsteam?tag=${tagId}`);
  const bildSetzen = (userId: string) =>
    db
      .insert(schema.profilbild)
      .values({ userId, inhalt: new Uint8Array(bild) })
      .onConflictDoUpdate({
        target: schema.profilbild.userId,
        set: { inhalt: new Uint8Array(bild), geaendertAm: new Date() },
      });

  test("die Liste nennt den Pfad des Bildes, nur wo es eines gibt; das Bild kommt über die Redaktions-Route", async () => {
    await bildSetzen(slA.id!);
    const antwort = await holen(webmaster, "/api/v1/redaktion/personen");
    const { personen } = (await antwort.json()) as {
      personen: { id: string; bildUrl: string | null }[];
    };
    const meine = personen.find((p) => p.id === slA.id)!;
    expect(meine.bildUrl).toMatch(
      new RegExp(`^/api/v1/redaktion/personen/${slA.id}/bild\\?v=\\d+$`),
    );
    expect(personen.find((p) => p.id === slB.id)!.bildUrl).toBeNull();
    const bildAntwort = await holen(webmaster, meine.bildUrl!);
    expect(bildAntwort.status).toBe(200);
    expect(bildAntwort.headers.get("content-type")).toBe("image/jpeg");
    expect(bildAntwort.headers.get("cache-control")).toBe("private, no-store");
    expect(bildAntwort.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await bildAntwort.arrayBuffer())).toEqual(bild);
  });

  test("das Bild gibt es nur für Personen, die auf der Website erscheinen dürfen, und nur mit Redaktionszugang", async () => {
    const pfad = (id: string) => `/api/v1/redaktion/personen/${id}/bild`;
    // Eltern und Personen der Demo-Abteilung mit Bild, aber ohne Rolle mit Aussenwirkung bzw. in einer anderen Abteilung
    await bildSetzen(eltern.id!);
    await bildSetzen(demoEltern.id!);
    for (const id of [eltern.id!, demoEltern.id!, randomUUID()]) {
      expect((await holen(webmaster, pfad(id))).status).toBe(404);
    }
    // Wer kein Bild hat, bekommt dasselbe 404
    expect((await holen(webmaster, pfad(slB.id!))).status).toBe(404);
    // Ein deaktiviertes Konto erscheint nicht, also auch sein Bild nicht
    const weg = await legePersonaAn(welt, "slA");
    await bildSetzen(weg.id!);
    expect((await holen(admin, pfad(weg.id!))).status).toBe(200);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, weg.id!));
    expect((await holen(admin, pfad(weg.id!))).status).toBe(404);
    // Die Demo-Abteilung sieht das Bild der Testabteilung nie
    await bildSetzen(slA.id!);
    expect((await holen(demoAdmin, pfad(slA.id!))).status).toBe(404);
    for (const konto of [eltern, ohneRecht, adminOhne]) {
      expect((await holen(konto, pfad(slA.id!))).status).toBe(403);
    }
    // Eine andere Abteilung kennt das Objekt nicht (404 vor dem Recht)
    expect((await holen(demoEltern, pfad(slA.id!))).status).toBe(404);
    expect((await holen(webmaster, pfad("kein-uuid"))).status).toBe(400);
  });

  test("Leitungsteam einer Stufe: Stufenleitung vor Leitung, Cevi-Name, Bild nur wo es eines gibt, nie Telefon oder E-Mail", async () => {
    await bildSetzen(slA.id!);
    const antwort = await team(webmaster, welt.stufeAId);
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    const t = JSON.parse(text) as Team;
    expect(t.stufe).toBe(true);
    expect(t.personen[0]).toEqual({
      id: slA.id,
      anzeigename: "Flink",
      funktion: "Stufenleitung",
      bildUrl: expect.stringContaining(`/personen/${slA.id}/bild?v=`),
    });
    // Die Leitende der Stufe (webmaster, Rolle «leitung») steht danach
    const leitung = t.personen.findIndex((p) => p.id === webmaster.id);
    expect(leitung).toBeGreaterThan(0);
    expect(t.personen[leitung]!.funktion).toBe("Leitung");
    expect(t.personen[leitung]!.bildUrl).toBeNull();
    // Wer die Stufe nicht trägt oder Elternteil ist, steht nicht da
    expect(t.personen.map((p) => p.id)).not.toContain(slB.id);
    expect(t.personen.map((p) => p.id)).not.toContain(eltern.id);
    for (const p of t.personen) {
      expect(Object.keys(p).sort()).toEqual([
        "anzeigename",
        "bildUrl",
        "funktion",
        "id",
      ]);
    }
    expect(text).not.toContain("+41791234567");
    expect(text).not.toContain("@example.org");
  });

  test("jedes andere Team zeigt seine Mitglieder mit Cevi-Name und Rolle, ohne Bild; ohne Cevi-Namen niemanden; die Gruppe eines Anlasses nie", async () => {
    const [gruppe] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Runde",
        typ: "team",
        kuerzel: "Ru",
      })
      .returning();
    const [oK] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        name: "OK",
        typ: "anlass",
        kuerzel: "OK",
      })
      .returning();
    await db.insert(schema.personTag).values([
      { userId: slA.id!, tagId: gruppe!.id, rolle: "Co-Leitung" },
      // Ohne Cevi-Namen erscheint die Person in einem Team nicht
      { userId: eltern.id!, tagId: gruppe!.id, rolle: null },
      { userId: slA.id!, tagId: oK!.id, rolle: "Kasse" },
    ]);
    await bildSetzen(slA.id!);
    const t = (await (await team(webmaster, gruppe!.id)).json()) as Team;
    expect(t.stufe).toBe(false);
    expect(t.personen).toEqual([
      {
        id: slA.id,
        anzeigename: "Flink",
        funktion: "Co-Leitung",
        bildUrl: null,
      },
    ]);
    const anlass = (await (await team(webmaster, oK!.id)).json()) as Team;
    expect(anlass.personen).toEqual([]);
  });

  test("eine Stufe ohne Leitende hat ein leeres Team", async () => {
    const [leer] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Neu",
        typ: "stufe",
        kuerzel: "Ne",
      })
      .returning();
    await db
      .insert(schema.personTag)
      .values({ userId: eltern.id!, tagId: leer!.id, rolle: null });
    const t = (await (await team(admin, leer!.id)).json()) as Team;
    expect(t).toEqual({ gruppe: "Neu", stufe: true, personen: [] });
  });

  test("Zugang, Eingabe und Abteilung", async () => {
    const pfad = `/api/v1/redaktion/leitungsteam?tag=${welt.stufeAId}`;
    for (const konto of [eltern, ohneRecht, adminOhne, demoEltern]) {
      expect((await holen(konto, pfad)).status).toBe(403);
    }
    expect((await holen(admin, "/api/v1/redaktion/leitungsteam")).status).toBe(
      400,
    );
    expect(
      (await holen(admin, "/api/v1/redaktion/leitungsteam?tag=kein-uuid"))
        .status,
    ).toBe(400);
    expect((await holen(admin, `${pfad}&weiter=1`)).status).toBe(400);
    // Ein Tag der Demo-Abteilung gibt es für die Testabteilung nicht, und umgekehrt
    expect((await team(admin, welt.demoStufeId)).status).toBe(404);
    expect((await team(demoAdmin, welt.stufeAId)).status).toBe(404);
  });
});

describe("Panel", () => {
  test("die Seite des Panels erlaubt eigene Rahmen für die Vorschau, sonst bleibt die CSP streng", async () => {
    const antwort = await app.request("/admin");
    const csp = antwort.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe");
    expect(antwort.headers.get("x-frame-options")).toBe("DENY");
  });

  test("das Gerüst verlinkt die vier Module samt Stilen", async () => {
    const html = await (await app.request("/admin")).text();
    for (const name of ["", "-seiten", "-editor", "-medien", "-stufenfakten"]) {
      expect(html).toContain(`href="/admin/website${name}.css"`);
      expect((await app.request(`/admin/website${name}.css`)).status).toBe(200);
    }
    for (const modul of ["seiten", "editor", "medien", "stufenfakten"]) {
      expect((await app.request(`/admin/website-${modul}.js`)).status).toBe(
        200,
      );
    }
  });
});
