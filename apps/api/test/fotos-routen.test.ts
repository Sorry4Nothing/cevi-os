import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
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
  QuellFehler,
  type FotoQuelle,
  type QuellAlbum,
  type QuellBild,
} from "../src/fotos/quelle.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Fotos aus Flickr (#690): Zugang nur mit Sitzung, nur sichtbare Alben, nur Bilder aus dem Album, Verwaltung mit Recht. Die Quelle ist eine Attrappe mit erfundenen Alben und erzeugten Pixelbildern; es gibt keine Verbindung zu Flickr.
const fcm = bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

const KONTO = "12345678@N00";
const ALBUM_A = "72157000000000001";
const ALBUM_B = "72157000000000002";
const ALBUM_C = "72157000000000003";
const GEHEIM_SERVER = "4321";
const GEHEIM_SECRET = "0a1b2c3d4e";

const bild = (id: string): QuellBild => ({
  id,
  server: GEHEIM_SERVER,
  secret: GEHEIM_SECRET,
  titel: `Bild ${id}`,
  breite: 4,
  hoehe: 3,
  groessen: ["klein", "mittel", "gross"],
});
const alben: QuellAlbum[] = [
  {
    id: ALBUM_A,
    titel: "Album A bei Flickr",
    anzahl: 2,
    datum: "2026-05-28",
    titelbild: bild("5000000001"),
  },
  { id: ALBUM_B, titel: "Album B", anzahl: 1, datum: null, titelbild: null },
  { id: ALBUM_C, titel: "Album C", anzahl: 1, datum: null, titelbild: null },
];
const bilderVon: Record<string, QuellBild[]> = {
  [ALBUM_A]: [bild("6000000001"), bild("6000000002")],
  [ALBUM_B]: [bild("6000000003")],
  [ALBUM_C]: [bild("6000000004")],
};

// Eine Quelle, die zählt und Fehler auf Wunsch wirft
function quelle() {
  const z = {
    alben: 0,
    album: 0,
    dateien: [] as { id: string; groesse: string }[],
    fehler: null as QuellFehler | null,
  };
  const q: FotoQuelle = {
    alben: async (konto) => {
      z.alben++;
      if (z.fehler) throw z.fehler;
      if (konto !== KONTO) throw new QuellFehler("nicht_gefunden");
      return alben;
    },
    album: async (konto, id) => {
      z.album++;
      if (z.fehler) throw z.fehler;
      const a = alben.find((x) => x.id === id);
      if (konto !== KONTO || !a) throw new QuellFehler("nicht_gefunden");
      return { album: a, bilder: bilderVon[id] ?? [] };
    },
    datei: async (b, groesse) => {
      z.dateien.push({ id: b.id, groesse });
      // Ein erzeugtes Bild aus vier Bytes: keine echte Datei
      return {
        body: new ReadableStream<Uint8Array>({
          start(ctl) {
            ctl.enqueue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
            ctl.close();
          },
        }),
        typ: "image/jpeg",
        laenge: 4,
      };
    },
  };
  return { q, z };
}

let q = quelle();
const bauen = (mit: Partial<Parameters<typeof erstelleApp>[0]> = {}) =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    fcm,
    seiten: ladeSeiten(),
    fotos: q.q,
    ...mit,
  });
let app = bauen();

let welt: Welt;
let admin: PersonaKonto;
let eltern: PersonaKonto;
let leitung: PersonaKonto;
let ohneLogin: PersonaKonto;
let demoAdmin: PersonaKonto;
let kindKonto: PersonaKonto;
let webmaster: PersonaKonto;
let ohneRecht: PersonaKonto;

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

async function raeume() {
  const abt = [welt.testabteilungId, welt.demoAbteilungId];
  await db
    .delete(schema.fotoAlbum)
    .where(inArray(schema.fotoAlbum.abteilungId, abt));
  await db
    .delete(schema.fotoEinstellung)
    .where(inArray(schema.fotoEinstellung.abteilungId, abt));
}
const richteEin = async (
  mit: { konto?: string | null; link?: boolean; sichtbar?: string[] } = {},
) => {
  await db.insert(schema.fotoEinstellung).values({
    abteilungId: welt.testabteilungId,
    flickrKonto: mit.konto === undefined ? KONTO : mit.konto,
    flickrLinkZeigen: mit.link ?? false,
  });
  const sichtbar = mit.sichtbar ?? [ALBUM_A];
  await db.insert(schema.fotoAlbum).values(
    [ALBUM_A, ALBUM_B, ALBUM_C].map((id, i) => ({
      abteilungId: welt.testabteilungId,
      flickrAlbumId: id,
      reihenfolge: i,
      sichtbar: sichtbar.includes(id),
    })),
  );
};

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  eltern = await legePersonaAn(welt, "elternA");
  leitung = await legePersonaAn(welt, "leitendeA");
  ohneLogin = await legePersonaAn(welt, "ohneLogin");
  demoAdmin = await legePersonaAn(welt, "demoAdmin");
  // «elternB» hat schon einen zweiten Faktor (die Lager-Matrix braucht ihn)
  webmaster = await legePersonaAn(welt, "elternB");
  ohneRecht = await legePersonaAn(welt, "slB");
  // Das Konto eines Kindes: ein Konto, auf das «kind.user_id» zeigt
  kindKonto = await legePersonaAn(welt, "leitendeB");
  await db.delete(schema.rolle).where(eq(schema.rolle.userId, kindKonto.id!));
  await db.insert(schema.kind).values({
    abteilungId: welt.testabteilungId,
    vorname: "Test",
    nachname: `Fotos-${randomUUID().slice(0, 6)}`,
    stufeId: welt.stufeAId,
    userId: kindKonto.id!,
  });
  // «Webmaster»: Plattformrolle mit dem Recht, ohne weitere Rechte
  const [rolle] = await db
    .insert(schema.plattformRolle)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Fotos ${randomUUID().slice(0, 6)}`,
    })
    .returning({ id: schema.plattformRolle.id });
  await db
    .insert(schema.plattformRolleRecht)
    .values({ rolleId: rolle!.id, recht: "fotos.verwalten" });
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: webmaster.id!, rolleId: rolle!.id });
});

beforeEach(async () => {
  await raeume();
  q = quelle();
  app = bauen();
});

describe("Zugang", () => {
  test("ohne Sitzung 401 bei jeder Route, auch bei Bildern", async () => {
    await richteEin();
    for (const pfad of [
      "/fotos/alben",
      `/fotos/alben/${ALBUM_A}`,
      `/fotos/alben/${ALBUM_A}/titel`,
      `/fotos/alben/${ALBUM_A}/bilder/6000000001`,
    ]) {
      expect((await aufruf(ohneLogin, "GET", pfad)).status, pfad).toBe(401);
    }
    // Nichts hat Flickr berührt
    expect(q.z.alben + q.z.album + q.z.dateien.length).toBe(0);
  });

  test("Eltern und Leitende sehen die Alben, das Konto eines Kindes nie", async () => {
    await richteEin();
    for (const k of [eltern, leitung, admin]) {
      expect((await aufruf(k, "GET", "/fotos/alben")).status).toBe(200);
    }
    for (const pfad of [
      "/fotos/alben",
      `/fotos/alben/${ALBUM_A}`,
      `/fotos/alben/${ALBUM_A}/titel`,
      `/fotos/alben/${ALBUM_A}/bilder/6000000001`,
    ]) {
      expect((await aufruf(kindKonto, "GET", pfad)).status, pfad).toBe(403);
    }
    expect(q.z.dateien).toHaveLength(0);
  });

  test("die Alben einer anderen Abteilung sind nie zu sehen", async () => {
    await richteEin();
    const r = await json(await aufruf(demoAdmin, "GET", "/fotos/alben"));
    expect(r).toEqual({ konfiguriert: false, flickrLink: false, alben: [] });
    expect(
      (await aufruf(demoAdmin, "GET", `/fotos/alben/${ALBUM_A}`)).status,
    ).toBe(404);
    expect(
      (
        await aufruf(
          demoAdmin,
          "GET",
          `/fotos/alben/${ALBUM_A}/bilder/6000000001`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("Lesen", () => {
  test("ohne Zugangsdaten oder ohne Konto: nicht eingerichtet, leere Liste, kein Abruf", async () => {
    app = bauen({ fotos: undefined });
    await richteEin();
    expect(await json(await aufruf(eltern, "GET", "/fotos/alben"))).toEqual({
      konfiguriert: false,
      flickrLink: false,
      alben: [],
    });
    app = bauen();
    await raeume();
    await richteEin({ konto: null });
    expect(
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).konfiguriert,
    ).toBe(false);
    expect(q.z.alben).toBe(0);
  });

  test("zeigt nur sichtbare Alben in der Reihenfolge der Abteilung, mit eigenem Titel", async () => {
    await richteEin({ sichtbar: [ALBUM_A, ALBUM_C] });
    await db
      .update(schema.fotoAlbum)
      .set({ reihenfolge: 0 })
      .where(eq(schema.fotoAlbum.flickrAlbumId, ALBUM_C));
    await db
      .update(schema.fotoAlbum)
      .set({ reihenfolge: 5, titel: "Eigener Titel" })
      .where(eq(schema.fotoAlbum.flickrAlbumId, ALBUM_A));
    const r = await json(await aufruf(eltern, "GET", "/fotos/alben"));
    expect(r.konfiguriert).toBe(true);
    expect(r.alben.map((a: { id: string }) => a.id)).toEqual([
      ALBUM_C,
      ALBUM_A,
    ]);
    expect(r.alben[1]).toEqual({
      id: ALBUM_A,
      titel: "Eigener Titel",
      anzahl: 2,
      datum: "2026-05-28",
      titelbild: true,
    });
    // Das unsichtbare Album kommt weder in der Liste noch einzeln noch als Bild
    expect(JSON.stringify(r)).not.toContain(ALBUM_B);
    expect(
      (await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_B}`)).status,
    ).toBe(404);
    expect(
      (await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_B}/bilder/6000000003`))
        .status,
    ).toBe(404);
    expect(
      (await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_B}/titel`)).status,
    ).toBe(404);
  });

  test("ein neues Album bei Flickr ohne Zeile bleibt unsichtbar", async () => {
    await richteEin({ sichtbar: [] });
    await db
      .delete(schema.fotoAlbum)
      .where(eq(schema.fotoAlbum.flickrAlbumId, ALBUM_B));
    const r = await json(await aufruf(eltern, "GET", "/fotos/alben"));
    expect(r.alben).toEqual([]);
    expect(
      (await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_B}`)).status,
    ).toBe(404);
  });

  test("das Album nennt Bilder ohne Server und Secret; der Link zu Flickr nur auf Wunsch", async () => {
    await richteEin();
    const r = await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_A}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(GEHEIM_SECRET);
    expect(text).not.toContain(GEHEIM_SERVER);
    expect(text).not.toContain("staticflickr");
    const d = JSON.parse(text);
    expect(d.bilder).toEqual([
      { id: "6000000001", titel: "Bild 6000000001", breite: 4, hoehe: 3 },
      { id: "6000000002", titel: "Bild 6000000002", breite: 4, hoehe: 3 },
    ]);
    expect(d.flickrUrl).toBeUndefined();
    await raeume();
    await richteEin({ link: true });
    const mit = await json(
      await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_A}`),
    );
    expect(mit.flickrUrl).toBe(
      `https://www.flickr.com/photos/${KONTO}/albums/${ALBUM_A}`,
    );
  });

  test("Eingaben: nur Ziffern als Kennung, nur feste Grössen", async () => {
    await richteEin();
    for (const pfad of [
      "/fotos/alben/abc",
      "/fotos/alben/1..2",
      `/fotos/alben/${ALBUM_A}/bilder/x`,
      `/fotos/alben/${ALBUM_A}/bilder/6000000001?groesse=1024`,
      `/fotos/alben/${ALBUM_A}/bilder/6000000001?groesse=gross&url=http://evil.example.org/`,
      `/fotos/alben/${ALBUM_A}/titel?groesse=riesig`,
    ]) {
      expect((await aufruf(eltern, "GET", pfad)).status, pfad).toBe(400);
    }
    expect(q.z.dateien).toHaveLength(0);
  });
});

describe("Bilder", () => {
  test("liefert die Datei durch, mit privaten Kopfzeilen und ETag, in der gewählten Grösse", async () => {
    await richteEin();
    const r = await aufruf(
      eltern,
      "GET",
      `/fotos/alben/${ALBUM_A}/bilder/6000000001?groesse=gross`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("vary")).toContain("Cookie");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("etag")).toBe(`"6000000001-${GEHEIM_SECRET}-gross"`);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );
    expect(q.z.dateien).toEqual([{ id: "6000000001", groesse: "gross" }]);
    // Ohne Angabe gilt «mittel»
    await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_A}/bilder/6000000002`);
    expect(q.z.dateien[1]).toEqual({ id: "6000000002", groesse: "mittel" });
  });

  test("mit dem ETag antwortet der Server 304, ohne Flickr zu fragen, aber erst nach der Sitzungsprüfung", async () => {
    await richteEin();
    const url = `/fotos/alben/${ALBUM_A}/bilder/6000000001?groesse=klein`;
    const etag = `"6000000001-${GEHEIM_SECRET}-klein"`;
    const kopf = { ...eltern.headers, "if-none-match": etag };
    const r = await app.request(`/api/v1${url}`, { headers: kopf });
    expect(r.status).toBe(304);
    expect(q.z.dateien).toHaveLength(0);
    const ohne = await app.request(`/api/v1${url}`, {
      headers: { ...ohneLogin.headers, "if-none-match": etag },
    });
    expect(ohne.status).toBe(401);
  });

  test("SSRF: Ein Bild, das nicht im Album steht, öffnet nichts, auch wenn es bei Flickr existiert", async () => {
    await richteEin();
    // 6000000003 gehört zu Album B (unsichtbar), 6000000004 zu Album C, 9 zu keinem
    for (const id of ["6000000003", "6000000004", "9"]) {
      expect(
        (await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_A}/bilder/${id}`))
          .status,
        id,
      ).toBe(404);
    }
    expect(q.z.dateien).toHaveLength(0);
  });

  test("das Titelbild: aus der Albumliste, 404 ohne Titelbild", async () => {
    await richteEin({ sichtbar: [ALBUM_A, ALBUM_B] });
    const r = await aufruf(
      eltern,
      "GET",
      `/fotos/alben/${ALBUM_A}/titel?groesse=klein`,
    );
    expect(r.status).toBe(200);
    expect(q.z.dateien).toEqual([{ id: "5000000001", groesse: "klein" }]);
    expect(
      (await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_B}/titel`)).status,
    ).toBe(404);
  });

  test("der Zwischenspeicher: viele Abrufe, ein Abruf bei Flickr", async () => {
    await richteEin();
    for (let i = 0; i < 5; i++) {
      await aufruf(eltern, "GET", "/fotos/alben");
      await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_A}`);
      await aufruf(eltern, "GET", `/fotos/alben/${ALBUM_A}/bilder/6000000001`);
    }
    expect(q.z.alben).toBe(1);
    expect(q.z.album).toBe(1);
  });

  test("Grenze je Konto: danach 429, ein anderes Konto ist nicht betroffen", async () => {
    await richteEin();
    const { erstelleFotoRouten } = await import("../src/routes/fotos/index.js");
    const routen = erstelleFotoRouten({
      db,
      quelle: q.q,
      grenzen: { listen: 2, bilder: 3 },
    });
    const person = (id: string) => ({
      id,
      abteilungId: welt.testabteilungId,
      admin: false,
      zweiterFaktor: false,
      rollen: [],
    });
    const eng = (id: string) =>
      new Hono<{ Variables: { person: ReturnType<typeof person> } }>()
        .use(async (c, next) => {
          c.set("person", person(id));
          await next();
        })
        .route("/", routen.oeffentlich);
    const a = eng("konto-a");
    const bild = `/alben/${ALBUM_A}/bilder/6000000001`;
    const stati: number[] = [];
    for (let i = 0; i < 4; i++) stati.push((await a.request(bild)).status);
    expect(stati).toEqual([200, 200, 200, 429]);
    // Die Listen zählen für sich: zwei erlaubt, die dritte nicht
    const liste: number[] = [];
    for (let i = 0; i < 3; i++)
      liste.push((await eng("konto-b").request("/alben")).status);
    expect(liste.filter((s) => s === 429)).toHaveLength(1);
    expect((await eng("konto-c").request(bild)).status).toBe(200);
  });
});

describe("Fehler von Flickr", () => {
  test.each([
    ["zugang", 503, "FOTOS_NICHT_EINGERICHTET"],
    ["nicht_erreichbar", 502, "FOTOS_NICHT_ERREICHBAR"],
  ] as const)("%s: %i ohne Geheimnisse im Text", async (art, status, code) => {
    await richteEin();
    q.z.fehler = new QuellFehler(art, "98");
    const r = await aufruf(eltern, "GET", "/fotos/alben");
    expect(r.status).toBe(status);
    const d = await json(r);
    expect(d.code).toBe(code);
    expect(JSON.stringify(d)).not.toMatch(/flickr|schl|token|secret/i);
  });

  test("ein Album, das Flickr nicht mehr kennt: 404; in der Liste fehlt es", async () => {
    await richteEin({ sichtbar: [ALBUM_A] });
    await db.insert(schema.fotoAlbum).values({
      abteilungId: welt.testabteilungId,
      flickrAlbumId: "72157000000009999",
      sichtbar: true,
      reihenfolge: 9,
    });
    const r = await json(await aufruf(eltern, "GET", "/fotos/alben"));
    expect(r.alben.map((a: { id: string }) => a.id)).toEqual([ALBUM_A]);
    expect(
      (await aufruf(eltern, "GET", "/fotos/alben/72157000000009999")).status,
    ).toBe(404);
  });
});

describe("Verwaltung", () => {
  test("Rechte: die Abteilungsleitung und eine Rolle mit dem Recht; sonst 403", async () => {
    await richteEin();
    expect((await aufruf(admin, "GET", "/admin/fotos")).status).toBe(200);
    expect((await aufruf(webmaster, "GET", "/admin/fotos")).status).toBe(200);
    expect((await aufruf(ohneRecht, "GET", "/admin/fotos")).status).toBe(403);
    expect((await aufruf(eltern, "GET", "/admin/fotos")).status).toBe(403);
    expect((await aufruf(kindKonto, "GET", "/admin/fotos")).status).toBe(403);
    expect((await aufruf(ohneLogin, "GET", "/admin/fotos")).status).toBe(401);
  });

  test("Stand: Konto, Verbindung und Alben, neue Alben unsichtbar am Ende; keine Zugangsdaten", async () => {
    await richteEin({ sichtbar: [ALBUM_A] });
    await db
      .delete(schema.fotoAlbum)
      .where(eq(schema.fotoAlbum.flickrAlbumId, ALBUM_C));
    const r = await aufruf(admin, "GET", "/admin/fotos");
    const text = await r.text();
    expect(text).not.toContain(GEHEIM_SECRET);
    const d = JSON.parse(text);
    expect(d).toMatchObject({
      eingerichtet: true,
      flickrKonto: KONTO,
      flickrLinkZeigen: false,
      verbindung: "ok",
    });
    expect(
      d.alben.map((a: { id: string; sichtbar: boolean }) => [a.id, a.sichtbar]),
    ).toEqual([
      [ALBUM_A, true],
      [ALBUM_B, false],
      [ALBUM_C, false],
    ]);
    expect(d.alben[2].version).toBe(0);
  });

  test("Stand ohne Zugangsdaten und ohne Konto; ein Fehler von Flickr ist kein HTTP-Fehler", async () => {
    app = bauen({ fotos: undefined });
    expect(
      (await json(await aufruf(admin, "GET", "/admin/fotos"))).verbindung,
    ).toBe("nicht_eingerichtet");
    app = bauen();
    expect(
      (await json(await aufruf(admin, "GET", "/admin/fotos"))).verbindung,
    ).toBe("kein_konto");
    await richteEin();
    q.z.fehler = new QuellFehler("zugang", "98");
    const r = await aufruf(admin, "GET", "/admin/fotos");
    expect(r.status).toBe(200);
    expect((await json(r)).verbindung).toBe("zugang");
  });

  test("Verbindung testen: frischer Abruf, nie ein Geheimnis; auch ein Konto vor dem Speichern", async () => {
    await richteEin();
    await aufruf(admin, "GET", "/admin/fotos");
    const ersteAnzahl = q.z.alben;
    const r = await json(
      await aufruf(admin, "POST", "/admin/fotos/verbindung", {}),
    );
    expect(r).toEqual({ ok: true, alben: 3 });
    // Der Speicher wurde übergangen
    expect(q.z.alben).toBe(ersteAnzahl + 1);
    const falsch = await json(
      await aufruf(admin, "POST", "/admin/fotos/verbindung", {
        flickrKonto: "99999999@N00",
      }),
    );
    expect(falsch).toEqual({ ok: false, art: "nicht_gefunden" });
    q.z.fehler = new QuellFehler("zugang", "100");
    expect(
      await json(await aufruf(admin, "POST", "/admin/fotos/verbindung", {})),
    ).toEqual({
      ok: false,
      art: "zugang",
    });
    expect(
      (
        await aufruf(admin, "POST", "/admin/fotos/verbindung", {
          flickrKonto: "x@y",
        })
      ).status,
    ).toBe(400);
    expect(
      (await aufruf(eltern, "POST", "/admin/fotos/verbindung", {})).status,
    ).toBe(403);
  });

  test("ein Konto, das schon einer anderen Abteilung gehört, gibt 409 FLICKR_KONTO_VERGEBEN, beim Speichern und beim Testen (#777)", async () => {
    await db.insert(schema.fotoEinstellung).values({
      abteilungId: welt.demoAbteilungId,
      flickrKonto: KONTO,
      flickrLinkZeigen: false,
    });
    const put = await aufruf(admin, "PUT", "/admin/fotos/einstellung", {
      flickrKonto: KONTO,
      flickrLinkZeigen: false,
      version: 0,
    });
    expect(put.status).toBe(409);
    expect((await json(put)).code).toBe("FLICKR_KONTO_VERGEBEN");
    const test = await aufruf(admin, "POST", "/admin/fotos/verbindung", {
      flickrKonto: KONTO,
    });
    expect(test.status).toBe(409);
    expect((await json(test)).code).toBe("FLICKR_KONTO_VERGEBEN");
    // Nichts gespeichert; ein anderes Konto geht
    expect(
      await db
        .select()
        .from(schema.fotoEinstellung)
        .where(eq(schema.fotoEinstellung.abteilungId, welt.testabteilungId)),
    ).toEqual([]);
    expect(
      (
        await aufruf(admin, "PUT", "/admin/fotos/einstellung", {
          flickrKonto: "87654321@N00",
          flickrLinkZeigen: false,
          version: 0,
        })
      ).status,
    ).toBe(200);
  });

  test("Einstellung: Konto und Link speichern, Version prüfen, Konto-Format prüfen", async () => {
    const put = (body: unknown) =>
      aufruf(admin, "PUT", "/admin/fotos/einstellung", body);
    const a = await put({
      flickrKonto: KONTO,
      flickrLinkZeigen: true,
      version: 0,
    });
    expect(a.status).toBe(200);
    expect((await json(a)).version).toBe(1);
    const stand = await json(await aufruf(admin, "GET", "/admin/fotos"));
    expect(stand).toMatchObject({
      flickrKonto: KONTO,
      flickrLinkZeigen: true,
      version: 1,
    });
    // Veraltete Version: 409
    const konflikt = await put({
      flickrKonto: null,
      flickrLinkZeigen: false,
      version: 0,
    });
    expect(konflikt.status).toBe(409);
    expect((await json(konflikt)).code).toBe("VERSION_KONFLIKT");
    for (const konto of [
      "12345678",
      "jemand@example.org",
      "1@N0",
      "x".repeat(40),
    ]) {
      expect(
        (await put({ flickrKonto: konto, flickrLinkZeigen: false, version: 1 }))
          .status,
        konto,
      ).toBe(400);
    }
    expect(
      (
        await put({
          flickrKonto: null,
          flickrLinkZeigen: false,
          version: 1,
          mehr: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await aufruf(eltern, "PUT", "/admin/fotos/einstellung", {
          flickrKonto: null,
          flickrLinkZeigen: false,
          version: 1,
        })
      ).status,
    ).toBe(403);
    // Wechsel des Kontos entfernt das Konto; die Alben-Entscheide bleiben stehen
    await db.insert(schema.fotoAlbum).values({
      abteilungId: welt.testabteilungId,
      flickrAlbumId: ALBUM_A,
      sichtbar: true,
    });
    expect(
      (await put({ flickrKonto: null, flickrLinkZeigen: false, version: 1 }))
        .status,
    ).toBe(200);
    expect(
      (
        await db
          .select()
          .from(schema.fotoAlbum)
          .where(eq(schema.fotoAlbum.abteilungId, welt.testabteilungId))
      ).length,
    ).toBe(1);
  });

  test("Album zeigen, ausblenden und umbenennen; die Website folgt; Version prüft", async () => {
    await richteEin({ sichtbar: [] });
    await db
      .delete(schema.fotoAlbum)
      .where(eq(schema.fotoAlbum.abteilungId, welt.testabteilungId));
    const put = (id: string, body: unknown) =>
      aufruf(admin, "PUT", `/admin/fotos/alben/${id}`, body);
    expect(
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).alben,
    ).toEqual([]);
    const an = await put(ALBUM_B, { sichtbar: true, version: 0 });
    expect(an.status).toBe(200);
    expect((await json(an)).version).toBe(1);
    expect(
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).alben.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([ALBUM_B]);
    const titel = await put(ALBUM_B, { titel: "  Mein Titel  ", version: 1 });
    expect((await json(titel)).version).toBe(2);
    expect(
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).alben[0].titel,
    ).toBe("Mein Titel");
    // Alte Version
    expect((await put(ALBUM_B, { sichtbar: false, version: 1 })).status).toBe(
      409,
    );
    // Zurück auf den Titel von Flickr und ausblenden
    expect(
      (await put(ALBUM_B, { titel: null, sichtbar: false, version: 2 })).status,
    ).toBe(200);
    expect(
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).alben,
    ).toEqual([]);
    // Eingaben
    for (const body of [
      { version: 3 },
      { sichtbar: "ja", version: 3 },
      { titel: "", version: 3 },
      { titel: "x".repeat(121), version: 3 },
      { sichtbar: true },
    ]) {
      expect((await put(ALBUM_B, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await put("abc", { sichtbar: true, version: 0 })).status).toBe(400);
    // Ein Album, das das Konto nicht hat, lässt sich nicht zeigen
    expect(
      (await put("72157000000009999", { sichtbar: true, version: 0 })).status,
    ).toBe(404);
    // Ohne Recht 403
    expect(
      (
        await aufruf(eltern, "PUT", `/admin/fotos/alben/${ALBUM_B}`, {
          sichtbar: true,
          version: 2,
        })
      ).status,
    ).toBe(403);
  });

  test("Mehrere Alben zeigen und ausblenden: alles oder nichts, neue ans Ende der sichtbaren (#794)", async () => {
    await richteEin({ sichtbar: [ALBUM_A] });
    // Das Album B hat noch keine Zeile
    await db
      .delete(schema.fotoAlbum)
      .where(eq(schema.fotoAlbum.flickrAlbumId, ALBUM_B));
    const put = (body: unknown, wer = admin) =>
      aufruf(wer, "PUT", "/admin/fotos/alben/sichtbarkeit", body);
    const website = async () =>
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).alben.map(
        (a: { id: string }) => a.id,
      );
    const version = async (id: string) =>
      (
        await db
          .select({ v: schema.fotoAlbum.version })
          .from(schema.fotoAlbum)
          .where(
            and(
              eq(schema.fotoAlbum.abteilungId, welt.testabteilungId),
              eq(schema.fotoAlbum.flickrAlbumId, id),
            ),
          )
      )[0]?.v;
    expect(await website()).toEqual([ALBUM_A]);
    const vC = (await version(ALBUM_C))!;
    // Eine Version passt nicht: nichts ändert sich, auch nicht für das Album mit der richtigen Version
    const konflikt = await put({
      sichtbar: true,
      alben: [
        { id: ALBUM_C, version: vC },
        { id: ALBUM_B, version: 7 },
      ],
    });
    expect(konflikt.status).toBe(409);
    expect((await json(konflikt)).code).toBe("VERSION_KONFLIKT");
    expect(await website()).toEqual([ALBUM_A]);
    expect(await version(ALBUM_C)).toBe(vC);
    // Beide zeigen, B und C in der genannten Reihenfolge am Ende; B bekommt eine Zeile
    const an = await put({
      sichtbar: true,
      alben: [
        { id: ALBUM_B, version: 0 },
        { id: ALBUM_C, version: vC },
      ],
    });
    expect(an.status).toBe(200);
    expect((await json(an)).alben).toEqual([
      { id: ALBUM_B, version: 1 },
      { id: ALBUM_C, version: vC + 1 },
    ]);
    expect(await website()).toEqual([ALBUM_A, ALBUM_B, ALBUM_C]);
    // Ausblenden mit den neuen Versionen
    expect(
      (
        await put({
          sichtbar: false,
          alben: [
            { id: ALBUM_A, version: (await version(ALBUM_A))! },
            { id: ALBUM_B, version: 1 },
          ],
        })
      ).status,
    ).toBe(200);
    expect(await website()).toEqual([ALBUM_C]);
    // Ein einzelnes Album, das wieder erscheint, steht ebenfalls am Ende
    expect(
      (
        await aufruf(admin, "PUT", `/admin/fotos/alben/${ALBUM_A}`, {
          sichtbar: true,
          version: (await version(ALBUM_A))!,
        })
      ).status,
    ).toBe(200);
    expect(await website()).toEqual([ALBUM_C, ALBUM_A]);
    // Eingaben, Objekt und Recht
    for (const body of [
      { sichtbar: true, alben: [] },
      { sichtbar: true },
      { alben: [{ id: ALBUM_A, version: 0 }] },
      {
        sichtbar: true,
        alben: [
          { id: ALBUM_A, version: 0 },
          { id: ALBUM_A, version: 0 },
        ],
      },
      { sichtbar: true, alben: [{ id: "abc", version: 0 }] },
      { sichtbar: true, alben: [{ id: ALBUM_A }] },
      { sichtbar: true, alben: [{ id: ALBUM_A, version: 0 }], mehr: 1 },
    ]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (
        await put({
          sichtbar: true,
          alben: [{ id: "72157000000009999", version: 0 }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await put(
          { sichtbar: true, alben: [{ id: ALBUM_A, version: 0 }] },
          eltern,
        )
      ).status,
    ).toBe(403);
  });

  test("Reihenfolge: speichert sie, legt unsichtbare Zeilen an und lässt Sichtbarkeit und Version unberührt", async () => {
    await richteEin({ sichtbar: [ALBUM_A, ALBUM_B] });
    const r = await aufruf(admin, "PUT", "/admin/fotos/alben/reihenfolge", {
      ids: [ALBUM_B, ALBUM_C, ALBUM_A, "72157000000000004"],
    });
    expect(r.status).toBe(204);
    const zeilen = await db
      .select()
      .from(schema.fotoAlbum)
      .where(eq(schema.fotoAlbum.abteilungId, welt.testabteilungId));
    const nach = (id: string) => zeilen.find((z) => z.flickrAlbumId === id)!;
    expect(
      [ALBUM_B, ALBUM_C, ALBUM_A, "72157000000000004"].map(
        (id) => nach(id).reihenfolge,
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(nach(ALBUM_A).sichtbar).toBe(true);
    expect(nach("72157000000000004")).toMatchObject({
      sichtbar: false,
      version: 0,
    });
    expect(
      (await json(await aufruf(eltern, "GET", "/fotos/alben"))).alben.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([ALBUM_B, ALBUM_A]);
    for (const ids of [
      [],
      ["a"],
      [ALBUM_A, ALBUM_A],
      Array.from({ length: 501 }, (_, i) => String(i)),
    ]) {
      expect(
        (await aufruf(admin, "PUT", "/admin/fotos/alben/reihenfolge", { ids }))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await aufruf(eltern, "PUT", "/admin/fotos/alben/reihenfolge", {
          ids: [ALBUM_A],
        })
      ).status,
    ).toBe(403);
  });
});
