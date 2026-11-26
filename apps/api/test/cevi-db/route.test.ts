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
import { erstelleApp } from "../../src/app.js";
import { erstelleCeviDbClient } from "../../src/cevi-db/client.js";
import { erstelleCeviDbDienst } from "../../src/cevi-db/dienst.js";
import { speichereStand } from "../../src/cevi-db/stand.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { VORSCHLAEGE_PRO_MINUTE } from "../../src/routes/cevi-db.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { legeProgrammAn } from "../hilfen/programme.js";

// Vorschlag aus der Cevi-Datenbank und Verbindung (#691). Ein Test-Double ersetzt die Cevi-Datenbank (fetch), erfundene Personen, ein erfundenes Token: keine echte Verbindung.
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

const TOKEN = "nur-fuer-tests-token-0123456789";
const URL_ = "https://cevi-db.example.org";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Antworten der Routen sind in den Tests untypisiert
type Json = any;

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
let elternEmail: string;
let kindVorname: string;

// Was die Cevi-Datenbank (Test-Double) antwortet; die Tests setzen es je Fall
let personenListe: Json[] = [];
let modus: "ok" | "aus" | "401" = "ok";
const abrufe = vi.fn();
const doubleFetch = (async (
  ziel: URL | string | Request,
  init?: RequestInit,
) => {
  abrufe(String(ziel), init);
  if (modus === "aus") throw new TypeError("fetch failed");
  if (modus === "401") return new Response("{}", { status: 401 });
  const u = new URL(String(ziel));
  if (u.pathname.startsWith("/api/groups/"))
    return new Response("{}", {
      status: u.pathname.endsWith("/1234") ? 200 : 404,
    });
  const nr = Number(u.searchParams.get("page[number]") ?? "1");
  return new Response(
    JSON.stringify({ data: nr === 1 ? personenListe : [], included: [] }),
    { status: 200 },
  );
}) as unknown as typeof fetch;

function erstelle(mitCevi = true) {
  const dienst = mitCevi
    ? erstelleCeviDbDienst({
        client: erstelleCeviDbClient({
          url: URL_,
          token: TOKEN,
          holen: doubleFetch,
        }),
        beiAbruf: speichereStand(db),
      })
    : undefined;
  return erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    seiten: ladeSeiten(),
    ceviDb: dienst,
  });
}
let app = erstelle();

const cevi = (id: number, a: Record<string, unknown> = {}) => ({
  id: String(id),
  type: "people",
  attributes: {
    first_name: kindVorname,
    last_name: "Muster",
    email: elternEmail,
    birthday: "2014-05-17",
    address: "Teststrasse 1",
    zip_code: "8000",
    town: "Testdorf",
    ...a,
  },
});

let ausgabe: MockInstance<typeof console.log>;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
  const [e] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, konten.elternA.id!));
  elternEmail = e.email.toLowerCase();
  const [k] = await db
    .select({ vorname: schema.kind.vorname })
    .from(schema.kind)
    .where(eq(schema.kind.id, welt.kindAId));
  kindVorname = k.vorname;
});
beforeEach(() => {
  app = erstelle();
  modus = "ok";
  personenListe = [cevi(1)];
  abrufe.mockClear();
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function anfrage(
  persona: Persona,
  methode: string,
  pfad: string,
  body?: unknown,
  a = app,
) {
  const konto = konten[persona];
  return a.request(pfad, {
    method: methode,
    headers:
      body === undefined
        ? konto.headers
        : { ...konto.headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function neuerAnlass(
  felder: {
    schluessel: string;
    quelle: string | null;
    typ?: "text" | "ja_nein";
  }[],
) {
  const termin = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
  });
  const [a] = await db
    .insert(schema.anlass)
    .values({
      abteilungId: welt.testabteilungId,
      programmId: termin.id,
      anmeldungOffen: true,
      sichtbarkeit: "angemeldet",
    })
    .returning({ id: schema.anlass.id });
  if (felder.length)
    await db.insert(schema.anlassFeld).values(
      felder.map((f, i) => ({
        anlassId: a.id,
        schluessel: f.schluessel,
        beschriftung: f.schluessel,
        typ: f.typ ?? "text",
        reihenfolge: i,
        ceviQuelle: f.quelle as "geburtsdatum" | null,
      })),
    );
  return a.id;
}
const vorschlag = (
  persona: Persona,
  anlassId: string,
  kindId?: string,
  a = app,
) =>
  anfrage(
    persona,
    "GET",
    `/api/v1/cevi-db/vorschlag?anlassId=${anlassId}${kindId ? `&kindId=${kindId}` : ""}`,
    undefined,
    a,
  );

describe("Vorschlag", () => {
  test("füllt nur die Felder mit Quelle, mit Herkunft «cevi-db», und gibt nie mehr zurück", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
      { schluessel: "ort", quelle: "ort" },
      { schluessel: "frei", quelle: null },
    ]);
    const r = await vorschlag("elternA", id, welt.kindAId);
    expect(r.status).toBe(200);
    const j: Json = await r.json();
    expect(j).toEqual({
      status: "ok",
      felder: {
        geb: { wert: "17.05.2014", quelle: "cevi-db" },
        ort: { wert: "Testdorf", quelle: "cevi-db" },
      },
    });
    // nie Name, Nummer, E-Mail oder Token
    const text = JSON.stringify(j);
    expect(text).not.toMatch(/Muster|"id"|example|nur-fuer-tests/);
  });

  test("das Token geht nur im Kopf zur Cevi-Datenbank und steht nie in Antwort, Log oder Audit", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    const r = await vorschlag("elternA", id, welt.kindAId);
    expect(await r.text()).not.toContain(TOKEN);
    expect(abrufe).toHaveBeenCalled();
    const [ziel, init] = abrufe.mock.calls[0]!;
    expect(ziel).not.toContain(TOKEN);
    expect(init.headers["X-TOKEN"]).toBe(TOKEN);
    expect(JSON.stringify(ausgabe.mock.calls)).not.toContain(TOKEN);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "cevi_db_vorschlag"),
          eq(schema.auditLog.zielId, id),
        ),
      );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.details).toEqual({ kind: true, status: "ok", felder: 1 });
    expect(JSON.stringify(zeilen)).not.toMatch(/Testdorf|2014|Muster/);
  });

  test("nur das eigene Kind: ein fremdes Kind und fremde Eltern sind 404", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    expect((await vorschlag("elternB", id, welt.kindAId)).status).toBe(404);
    expect((await vorschlag("admin", id, welt.kindAId)).status).toBe(404);
    expect((await vorschlag("demoEltern", id, welt.kindAId)).status).toBe(404);
    // kein Abruf bei der Cevi-Datenbank für Fremde
    expect(abrufe).not.toHaveBeenCalled();
  });

  test("ohne Anmeldung 401, mit Pflichtwechsel 403", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    expect((await vorschlag("ohneLogin", id, welt.kindAId)).status).toBe(401);
    expect(
      (await vorschlag("mussPasswortAendern", id, welt.kindAId)).status,
    ).toBe(403);
  });

  test("kein Treffer und mehrere Treffer: kein Vorschlag, und die Antwort ist gleich (keine Auskunft über Dritte)", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    personenListe = [cevi(1, { email: "andere@example.org" })];
    const keiner: Json = await (
      await vorschlag("elternA", id, welt.kindAId)
    ).json();
    app = erstelle();
    personenListe = [cevi(1), cevi(2, { last_name: "Zwilling" })];
    const mehrere: Json = await (
      await vorschlag("elternA", id, welt.kindAId)
    ).json();
    expect(keiner).toEqual({ status: "kein_treffer", felder: {} });
    expect(mehrere).toEqual(keiner);
  });

  test("ein Name allein genügt nie", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    personenListe = [cevi(1, { email: null })];
    const j: Json = await (await vorschlag("elternA", id, welt.kindAId)).json();
    expect(j.status).toBe("kein_treffer");
  });

  test("fehlt eine Angabe in der Cevi-Datenbank, bleibt das Feld ohne Vorschlag", async () => {
    const id = await neuerAnlass([
      { schluessel: "tel", quelle: "telefon" },
      { schluessel: "ort", quelle: "ort" },
    ]);
    const j: Json = await (await vorschlag("elternA", id, welt.kindAId)).json();
    expect(j.status).toBe("ok");
    expect(Object.keys(j.felder)).toEqual(["ort"]);
  });

  test("der eigene Wert gewinnt: ein schon beantwortetes Feld bekommt keinen Vorschlag", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
      { schluessel: "ort", quelle: "ort" },
    ]);
    await db.insert(schema.anlassAnmeldung).values({
      anlassId: id,
      userId: konten.elternA.id!,
      kindId: welt.kindAId,
      antworten: { ort: "Eigener Ort" },
      status: "angemeldet",
    });
    const j: Json = await (await vorschlag("elternA", id, welt.kindAId)).json();
    expect(Object.keys(j.felder)).toEqual(["geb"]);
  });

  test("Cevi-Datenbank antwortet nicht, lehnt das Token ab oder liefert Unsinn: «nicht_erreichbar», die Anmeldung geht weiter", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    for (const m of ["aus", "401"] as const) {
      modus = m;
      app = erstelle();
      const r = await vorschlag("elternA", id, welt.kindAId);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({
        status: "nicht_erreichbar",
        felder: {},
      });
    }
    const anmeldung = await anfrage(
      "elternA",
      "PUT",
      `/api/v1/anlaesse/${id}/anmeldung`,
      {
        kindId: welt.kindAId,
        antworten: { geb: "01.01.2014" },
      },
    );
    expect(anmeldung.status).toBe(200);
  });

  test("ohne Verbindung (Funktion aus) bleibt alles beim Alten", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    const r = await vorschlag("elternA", id, welt.kindAId, erstelle(false));
    expect(await r.json()).toEqual({ status: "aus", felder: {} });
    expect(abrufe).not.toHaveBeenCalled();
  });

  test("ein Anlass ohne Cevi-Felder ruft die Cevi-Datenbank nie ab", async () => {
    const id = await neuerAnlass([{ schluessel: "frei", quelle: null }]);
    const r = await vorschlag("elternA", id, welt.kindAId);
    expect(await r.json()).toEqual({ status: "aus", felder: {} });
    expect(abrufe).not.toHaveBeenCalled();
  });

  test("der Zwischenspeicher: viele Aufrufe, ein Abruf", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    await vorschlag("elternA", id, welt.kindAId);
    await vorschlag("elternA", id, welt.kindAId);
    await vorschlag("elternA", id, welt.kindAId);
    // eine Seite mit Person und die leere Folgeseite
    expect(abrufe).toHaveBeenCalledTimes(2);
  });

  test("je Konto höchstens so viele Abrufe je Minute (429)", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    let letzter = 0;
    for (let i = 0; i <= VORSCHLAEGE_PRO_MINUTE; i++) {
      letzter = (await vorschlag("elternA", id, welt.kindAId)).status;
    }
    expect(letzter).toBe(429);
  });

  test("eine Person meldet sich selbst an: Zuordnung über ihre E-Mail und ihren Vornamen", async () => {
    const id = await neuerAnlass([{ schluessel: "tel", quelle: "telefon" }]);
    const [u] = await db
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, konten.leitendeA.id!));
    const teile = u.name.split(" ");
    const nachname = teile.pop()!;
    personenListe = [
      {
        id: "5",
        type: "people",
        attributes: {
          first_name: teile.join(" "),
          last_name: nachname,
          email: u.email,
          birthday: null,
          address: null,
          zip_code: null,
          town: null,
        },
        relationships: { phone_numbers: { data: [{ id: "t1" }] } },
      },
    ];
    // Telefonnummer kommt über «included»; das Test-Double liefert hier keine: der Treffer zählt trotzdem
    const j: Json = await (await vorschlag("leitendeA", id)).json();
    expect(j.status).toBe("ok");
  });
});

describe("Nummer merken", () => {
  // Die gemerkte Nummer bleibt nie liegen, auch wenn eine Prüfung davor fehlschlägt: sonst scheitert der nächste Test an fremdem Zustand
  afterEach(async () => {
    await db
      .update(schema.kind)
      .set({ ceviDbId: null })
      .where(eq(schema.kind.id, welt.kindAId));
  });

  test("nach dem Absenden einer Anmeldung mit einem Feld aus der Cevi-Datenbank merkt der Server die Nummer des eindeutigen Treffers", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    personenListe = [cevi(7340291)];
    // Der Vorschlag allein speichert nichts
    await vorschlag("elternA", id, welt.kindAId);
    const vorher = await db
      .select({ nr: schema.kind.ceviDbId })
      .from(schema.kind)
      .where(eq(schema.kind.id, welt.kindAId));
    expect(vorher[0]!.nr).toBeNull();
    const r = await anfrage(
      "elternA",
      "PUT",
      `/api/v1/anlaesse/${id}/anmeldung`,
      {
        kindId: welt.kindAId,
        antworten: { geb: "17.05.2014" },
      },
    );
    expect(r.status).toBe(200);
    const nachher = await db
      .select({ nr: schema.kind.ceviDbId })
      .from(schema.kind)
      .where(eq(schema.kind.id, welt.kindAId));
    expect(nachher[0]!.nr).toBe("7340291");
    // die Nummer steht nie in einer Antwort (eine siebenstellige Zahl, damit keine zufällige UUID oder Zeit sie enthält)
    expect(JSON.stringify(await r.json())).not.toContain("7340291");
    await db
      .update(schema.kind)
      .set({ ceviDbId: null })
      .where(eq(schema.kind.id, welt.kindAId));
  });

  test("meldet sich eine Person selbst an, übernimmt ihr Konto mit der Nummer gleich das Geschlecht (#843)", async () => {
    const id = await neuerAnlass([{ schluessel: "tel", quelle: "telefon" }]);
    const [u] = await db
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, konten.leitendeA.id!));
    const teile = u.name.split(" ");
    const nachname = teile.pop()!;
    personenListe = [
      cevi(7340292, {
        first_name: teile.join(" "),
        last_name: nachname,
        email: u.email,
        gender: "w",
        nickname: "Sunny",
      }),
    ];
    try {
      const r = await anfrage(
        "leitendeA",
        "PUT",
        `/api/v1/anlaesse/${id}/anmeldung`,
        { antworten: { tel: "079 000 00 00" } },
      );
      expect(r.status).toBe(200);
      const [nachher] = await db
        .select({
          nr: schema.user.ceviDbId,
          geschlecht: schema.user.geschlecht,
          vonHand: schema.user.geschlechtVonHand,
        })
        .from(schema.user)
        .where(eq(schema.user.id, konten.leitendeA.id!));
      expect(nachher).toEqual({
        nr: "7340292",
        geschlecht: "w",
        vonHand: false,
      });
    } finally {
      await db
        .update(schema.user)
        .set({ ceviDbId: null, geschlecht: null })
        .where(eq(schema.user.id, konten.leitendeA.id!));
    }
  });

  test("mehrdeutig: nichts wird gemerkt", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    personenListe = [cevi(1), cevi(2, { last_name: "Zwilling" })];
    await anfrage("elternA", "PUT", `/api/v1/anlaesse/${id}/anmeldung`, {
      kindId: welt.kindAId,
      antworten: { geb: "17.05.2014" },
    });
    const [k] = await db
      .select({ nr: schema.kind.ceviDbId })
      .from(schema.kind)
      .where(eq(schema.kind.id, welt.kindAId));
    expect(k.nr).toBeNull();
  });
});

describe("Zusatzfelder mit Quelle", () => {
  async function anlassMitFeldern(felder: unknown[]) {
    const termin = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
    });
    const [a] = await db
      .insert(schema.anlass)
      .values({
        abteilungId: welt.testabteilungId,
        programmId: termin.id,
        anmeldungOffen: true,
        sichtbarkeit: "angemeldet",
      })
      .returning({ id: schema.anlass.id });
    return {
      id: a.id,
      put: (f: unknown[]) =>
        anfrage("admin", "PUT", `/api/v1/admin/anlaesse/${a.id}/felder`, {
          felder: f,
        }),
      felder,
    };
  }
  const feld = (mehr: Record<string, unknown>) => ({
    schluessel: "geb",
    beschriftung: "Geburtsdatum",
    typ: "text",
    ...mehr,
  });

  test("die Abteilungsleitung stellt die Quelle ein, sie kommt zurück und in die Vorlage der Anmeldung", async () => {
    const a = await anlassMitFeldern([]);
    const r = await a.put([feld({ ceviQuelle: "geburtsdatum" })]);
    expect(r.status).toBe(200);
    expect(((await r.json()) as Json).felder[0].ceviQuelle).toBe(
      "geburtsdatum",
    );
    const gelesen: Json = await (
      await anfrage("elternA", "GET", `/api/v1/anlaesse/${a.id}`)
    ).json();
    expect(gelesen.felder[0].ceviQuelle).toBe("geburtsdatum");
  });

  test("keine Gesundheit und nichts ausserhalb der Liste: unbekannte Quellen und Nicht-Textfelder sind 400", async () => {
    const a = await anlassMitFeldern([]);
    for (const quelle of ["gesundheit", "allergien", "rolle", "name"]) {
      expect((await a.put([feld({ ceviQuelle: quelle })])).status, quelle).toBe(
        400,
      );
    }
    expect(
      (await a.put([feld({ typ: "ja_nein", ceviQuelle: "telefon" })])).status,
    ).toBe(400);
    // die Sperrliste für Gesundheitsdaten gilt weiter
    expect(
      (
        await a.put([
          feld({ beschriftung: "Allergien", ceviQuelle: "telefon" }),
        ])
      ).status,
    ).toBe(400);
  });
});

describe("Verwaltung der Verbindung", () => {
  test("nur die Abteilungsleitung mit zweitem Faktor", async () => {
    for (const p of [
      "adminOhneZweitenFaktor",
      "slA",
      "leitendeA",
      "elternA",
    ] as const) {
      expect((await anfrage(p, "GET", "/api/v1/admin/cevi-db")).status, p).toBe(
        403,
      );
      expect(
        (await anfrage(p, "POST", "/api/v1/admin/cevi-db/pruefen")).status,
        p,
      ).toBe(403);
      expect(
        (await anfrage(p, "PUT", "/api/v1/admin/cevi-db", { gruppeId: "1" }))
          .status,
        p,
      ).toBe(403);
    }
    expect(
      (await anfrage("admin", "GET", "/api/v1/admin/cevi-db")).status,
    ).toBe(200);
  });

  test("Stand ohne Geheimnisse; die Gruppe lässt sich einstellen", async () => {
    const r = await anfrage("admin", "PUT", "/api/v1/admin/cevi-db", {
      gruppeId: "1234",
    });
    expect(r.status).toBe(204);
    const j: Json = await (
      await anfrage("admin", "GET", "/api/v1/admin/cevi-db")
    ).json();
    expect(j.verbunden).toBe(true);
    expect(j.gruppeId).toBe("1234");
    expect(JSON.stringify(j)).not.toMatch(/nur-fuer-tests|example\.org/);
    // ungültige Nummer
    expect(
      (
        await anfrage("admin", "PUT", "/api/v1/admin/cevi-db", {
          gruppeId: "12ab",
        })
      ).status,
    ).toBe(400);
  });

  test("Verbindung prüfen: ok, Gruppe, abgelehnt, nicht erreichbar; nie Text der Gegenseite", async () => {
    await anfrage("admin", "PUT", "/api/v1/admin/cevi-db", {
      gruppeId: "1234",
    });
    let j: Json = await (
      await anfrage("admin", "POST", "/api/v1/admin/cevi-db/pruefen")
    ).json();
    expect(j).toEqual({ ergebnis: "ok", gruppe: true });
    await anfrage("admin", "PUT", "/api/v1/admin/cevi-db", { gruppeId: "999" });
    j = await (
      await anfrage("admin", "POST", "/api/v1/admin/cevi-db/pruefen")
    ).json();
    expect(j).toEqual({ ergebnis: "ok", gruppe: false });
    modus = "401";
    app = erstelle();
    j = await (
      await anfrage("admin", "POST", "/api/v1/admin/cevi-db/pruefen")
    ).json();
    expect(j).toEqual({ ergebnis: "abgelehnt" });
    modus = "aus";
    app = erstelle();
    j = await (
      await anfrage("admin", "POST", "/api/v1/admin/cevi-db/pruefen")
    ).json();
    expect(j).toEqual({ ergebnis: "nicht_erreichbar" });
    await anfrage("admin", "PUT", "/api/v1/admin/cevi-db", { gruppeId: null });
  });

  test("ohne Verbindung auf dem Server: «nicht_eingerichtet»", async () => {
    const a = erstelle(false);
    const g: Json = await (
      await anfrage("admin", "GET", "/api/v1/admin/cevi-db", undefined, a)
    ).json();
    expect(g.verbunden).toBe(false);
    const j: Json = await (
      await anfrage(
        "admin",
        "POST",
        "/api/v1/admin/cevi-db/pruefen",
        undefined,
        a,
      )
    ).json();
    expect(j).toEqual({ ergebnis: "nicht_eingerichtet" });
  });

  test("Abruf der Personen hält Stand und Anzahl fest (nie Namen)", async () => {
    const id = await neuerAnlass([
      { schluessel: "geb", quelle: "geburtsdatum" },
    ]);
    await vorschlag("elternA", id, welt.kindAId);
    const j: Json = await (
      await anfrage("admin", "GET", "/api/v1/admin/cevi-db")
    ).json();
    expect(j.letzterStatus).toBe("ok");
    expect(j.anzahlPersonen).toBe(1);
    expect(j.letzterAbrufAm).toBeTruthy();
  });

  test("das Recht steht im Katalog und ist an Rollen vergebbar", async () => {
    const { RECHTE_KATALOG, VERGEBBARE_RECHTE } =
      await import("../../src/rechtemodell/katalog.js");
    expect(RECHTE_KATALOG["cevi_db.verwalten"].art).toBe("vergebbar");
    expect(RECHTE_KATALOG["cevi_db.verwalten"].risiko).toBe("erweitert");
    expect(VERGEBBARE_RECHTE as readonly string[]).toContain(
      "cevi_db.verwalten",
    );
  });
});
