import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
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
  erzeugeSeiteAusVorlage,
  legeSeiteFuerTagAn,
} from "../src/website/automatik.js";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../src/website/ereignisse.js";
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

// Durchreichen, ausser ein Test lässt die Automatik gezielt scheitern
vi.mock("../src/website/automatik.js", async (original) => {
  const echt = await original<typeof import("../src/website/automatik.js")>();
  return { ...echt, legeSeiteFuerTagAn: vi.fn(echt.legeSeiteFuerTagAn) };
});

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

const REDAKTION = "/api/v1/redaktion";
const SEITEN = `${REDAKTION}/seiten`;
const TAGS = "/api/v1/admin/tags";
const ANGEMELDET = { art: "angemeldet" } as const;

let welt: Welt;
let admin: PersonaKonto;
let demoAdmin: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let webmaster: PersonaKonto;
let ohneRecht: PersonaKonto;
let eltern: PersonaKonto;

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

const eindeutig = (vorsatz: string) => `${vorsatz} ${randomUUID().slice(0, 8)}`;
const json = async <T>(antwort: Response) => (await antwort.json()) as T;

type Erzeugt = { id: string; adresse: string };
async function ausVorlage(konto: PersonaKonto, body: Record<string, unknown>) {
  return anfrage(konto, "POST", `${SEITEN}/aus-vorlage`, {
    sichtbarkeit: ANGEMELDET,
    ...body,
  });
}

// Legt einen Tag über die API der Abteilungsleitung an: Hier läuft die Automatik
async function legeTagAn(typ: string, name: string, konto = admin) {
  const antwort = await anfrage(konto, "POST", TAGS, { typ, name });
  expect(antwort.status, JSON.stringify(await antwort.clone().json())).toBe(
    201,
  );
  return (await json<{ id: string }>(antwort)).id;
}

// Nur die Abteilungen dieser Datei: Andere Testdateien schreiben parallel in dieselbe Datenbank
const zaehleSeiten = async () =>
  (
    await db
      .select({ n: count() })
      .from(schema.seite)
      .where(
        inArray(schema.seite.abteilungId, [
          welt.testabteilungId,
          welt.demoAbteilungId,
        ]),
      )
  )[0]!.n;

const seitenZu = (tagId: string) =>
  db.select().from(schema.seite).where(eq(schema.seite.tagId, tagId));

// Eine Person der Testabteilung, die als Leitende startet und nur trägt, was der Test ihr gibt
const leitende = () => legePersonaMitFaktorAn(welt, "leitendeA");

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, slA, slB, webmaster, ohneRecht, eltern] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "demoAdmin"),
      legePersonaAn(welt, "slA"),
      legePersonaAn(welt, "slB"),
      legePersonaMitFaktorAn(welt, "leitendeA"),
      legePersonaAn(welt, "leitendeB"),
      legePersonaAn(welt, "elternA"),
    ]);
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
});

describe("GET /vorlagen", () => {
  test("nennt Schlüssel, Name, Beschreibung und ob ein Tag nötig ist, ohne Dokumente", async () => {
    for (const konto of [admin, webmaster]) {
      const antwort = await anfrage(konto, "GET", `${REDAKTION}/vorlagen`);
      expect(antwort.status).toBe(200);
      const { vorlagen } = await json<{
        vorlagen: { schluessel: string; brauchtTag: boolean }[];
      }>(antwort);
      expect(vorlagen.map((v) => v.schluessel)).toEqual([
        "stufenseite",
        "anlass",
        "textseite",
        "leer",
      ]);
      expect(vorlagen[0]!.brauchtTag).toBe(true);
      expect(JSON.stringify(vorlagen)).not.toContain("bausteine");
    }
  });

  test("ohne das Recht «Vorlagen nutzen» 403, auch die Stufenleitung", async () => {
    for (const konto of [ohneRecht, eltern, slA]) {
      expect(
        (await anfrage(konto, "GET", `${REDAKTION}/vorlagen`)).status,
      ).toBe(403);
    }
  });
});

describe("POST /seiten/aus-vorlage", () => {
  test("legt eine Seite als Entwurf an: gültiges Dokument, nie veröffentlicht", async () => {
    const titel = eindeutig("Ausflug");
    const antwort = await ausVorlage(admin, { vorlage: "anlass", titel });
    expect(antwort.status).toBe(201);
    const { id, adresse } = await json<Erzeugt>(antwort);
    expect(adresse).toMatch(/^ausflug-[0-9a-f]{8}$/);

    const [zeile] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, id));
    expect(zeile).toMatchObject({
      titel,
      elternId: null,
      tagId: null,
      sichtbarkeit: "angemeldet",
      veroeffentlichteVersionId: null,
      entwurfZaehler: 1,
    });
    expect(pruefeDokument(zeile!.entwurf).ok).toBe(true);
    const versionen = await db
      .select({ n: count() })
      .from(schema.seiteVersion)
      .where(eq(schema.seiteVersion.seiteId, id));
    expect(versionen[0]!.n).toBe(0);

    // Über die Entwurfs-Route des Editors erreichbar, und «unveröffentlicht»
    const entwurf = await json<{
      zaehler: number;
      veroeffentlichteNr: number | null;
      unveroeffentlicht: boolean;
    }>(await anfrage(admin, "GET", `${SEITEN}/${id}/entwurf`));
    expect(entwurf).toMatchObject({
      zaehler: 1,
      veroeffentlichteNr: null,
      unveroeffentlicht: true,
    });
    const struktur = await json<{ veroeffentlicht: boolean }>(
      await anfrage(admin, "GET", `${SEITEN}/${id}`),
    );
    expect(struktur.veroeffentlicht).toBe(false);
  });

  test("der Entwurf lässt sich unverändert veröffentlichen", async () => {
    const { id } = await json<Erzeugt>(
      await ausVorlage(admin, {
        vorlage: "textseite",
        titel: eindeutig("Text"),
      }),
    );
    expect(
      (await anfrage(admin, "POST", `${SEITEN}/${id}/veroeffentlichen`)).status,
    ).toBe(201);
  });

  test("gleicher Titel: die Adresse bekommt einen Zusatz, die Anfrage scheitert nie", async () => {
    const titel = eindeutig("Gleich");
    const a = await json<Erzeugt>(
      await ausVorlage(admin, { vorlage: "leer", titel }),
    );
    const b = await json<Erzeugt>(
      await ausVorlage(admin, { vorlage: "leer", titel }),
    );
    const c = await json<Erzeugt>(
      await ausVorlage(admin, { vorlage: "leer", titel }),
    );
    expect(b.adresse).toBe(`${a.adresse}-2`);
    expect(c.adresse).toBe(`${a.adresse}-3`);
  });

  test("eine reservierte Adresse auf der obersten Ebene bekommt einen Zusatz, unter einer Elternseite nicht", async () => {
    const api = await json<Erzeugt>(
      await ausVorlage(admin, { vorlage: "leer", titel: "API" }),
    );
    expect(api.adresse).toBe("api-2");
    const eltern = await json<Erzeugt>(
      await ausVorlage(admin, {
        vorlage: "leer",
        titel: eindeutig("Oben"),
      }),
    );
    const unten = await json<Erzeugt>(
      await ausVorlage(admin, {
        vorlage: "leer",
        titel: "Admin",
        elternId: eltern.id,
      }),
    );
    expect(unten.adresse).toBe("admin");
    const geschwister = await db
      .select({ reihenfolge: schema.seite.reihenfolge })
      .from(schema.seite)
      .where(eq(schema.seite.id, unten.id));
    expect(geschwister[0]!.reihenfolge).toBe(0);
  });

  test("die Stufenseite braucht einen Tag; mit Tag gehört sie der Gruppe, ein zweites Mal gibt 409", async () => {
    const ohne = await ausVorlage(admin, {
      vorlage: "stufenseite",
      titel: "Ohne",
    });
    expect(ohne.status).toBe(400);
    expect((await json<{ code: string }>(ohne)).code).toBe("TAG_ERFORDERLICH");

    const tagId = await legeTagOhneAutomatik("stufe");
    const mit = await ausVorlage(admin, {
      vorlage: "stufenseite",
      titel: eindeutig("Stufe"),
      tagId,
    });
    expect(mit.status).toBe(201);
    const [zeile] = await seitenZu(tagId);
    expect(pruefeDokument(zeile!.entwurf).ok).toBe(true);
    expect(JSON.stringify(zeile!.entwurf)).toContain(tagId);

    const nochmal = await ausVorlage(admin, {
      vorlage: "stufenseite",
      titel: eindeutig("Stufe"),
      tagId,
    });
    expect(nochmal.status).toBe(409);
    expect((await json<{ code: string }>(nochmal)).code).toBe("TAG_VERGEBEN");
    expect(await seitenZu(tagId)).toHaveLength(1);
  });

  test("ungültige Eingabe 400: unbekannte Vorlage, zusätzliches Feld, leerer Titel, fremder Tag in der Sichtbarkeit", async () => {
    const basis = { vorlage: "leer", titel: eindeutig("X") };
    for (const body of [
      { ...basis, vorlage: "gibtsnicht" },
      { ...basis, adresse: "x" },
      { ...basis, titel: "  " },
      { ...basis, sichtbarkeit: { art: "tags", tagIds: [randomUUID()] } },
    ]) {
      expect((await ausVorlage(admin, body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
  });

  test("Elternseite: unbekannt 404, zu tief 400", async () => {
    expect(
      (
        await ausVorlage(admin, {
          vorlage: "leer",
          titel: "X",
          elternId: randomUUID(),
        })
      ).status,
    ).toBe(404);
    let eltern: string | undefined;
    for (let ebene = 1; ebene <= 5; ebene++) {
      const antwort = await ausVorlage(admin, {
        vorlage: "leer",
        titel: eindeutig(`Ebene ${ebene}`),
        elternId: eltern,
      });
      if (ebene < 6) expect(antwort.status).toBe(201);
      eltern = (await json<Erzeugt>(antwort)).id;
    }
    const zuTief = await ausVorlage(admin, {
      vorlage: "leer",
      titel: "Sechs",
      elternId: eltern,
    });
    expect(zuTief.status).toBe(400);
    expect((await json<{ code: string }>(zuTief)).code).toBe("SEITE_ZU_TIEF");
  });

  test("Rechte: Anlegen nur Abteilungsleitung und Webmaster", async () => {
    const body = { vorlage: "leer", titel: eindeutig("Recht") };
    expect((await ausVorlage(webmaster, body)).status).toBe(201);
    // Stufenleitung hat den Zugang, darf aber nicht anlegen
    expect((await ausVorlage(slA, body)).status).toBe(403);
    expect((await ausVorlage(ohneRecht, body)).status).toBe(403);
    expect((await ausVorlage(eltern, body)).status).toBe(403);
  });

  test("Fremdabteilung: fremder Tag und fremde Elternseite sind unbekannt (404), die Seite entsteht nicht", async () => {
    const meine = await json<Erzeugt>(
      await ausVorlage(admin, { vorlage: "leer", titel: eindeutig("Meine") }),
    );
    const vorher = await zaehleSeiten();
    const mitFremdemTag = await ausVorlage(demoAdmin, {
      vorlage: "stufenseite",
      titel: "Fremd",
      tagId: welt.stufeAId,
    });
    expect(mitFremdemTag.status).toBe(404);
    const mitFremderEltern = await ausVorlage(demoAdmin, {
      vorlage: "leer",
      titel: "Fremd",
      elternId: meine.id,
    });
    expect(mitFremderEltern.status).toBe(404);
    const nachher = await zaehleSeiten();
    expect(nachher).toBe(vorher);
    // Die eigene Abteilung geht
    const eigene = await ausVorlage(demoAdmin, {
      vorlage: "textseite",
      titel: "Demo",
    });
    expect(eigene.status).toBe(201);
    const [zeile] = await db
      .select({ abteilungId: schema.seite.abteilungId })
      .from(schema.seite)
      .where(eq(schema.seite.id, (await json<Erzeugt>(eigene)).id));
    expect(zeile!.abteilungId).toBe(welt.demoAbteilungId);
  });

  test("Audit: Vorlage und Kennungen, nie Titel oder Inhalt", async () => {
    const titel = eindeutig("Geheimtitel");
    const { id } = await json<Erzeugt>(
      await ausVorlage(admin, { vorlage: "anlass", titel }),
    );
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id),
          eq(schema.auditLog.aktion, "seite_angelegt"),
        ),
      );
    expect(eintrag!.akteurId).toBe(admin.id);
    expect(eintrag!.details).toMatchObject({
      vorlage: "anlass",
      sichtbarkeit: "angemeldet",
    });
    expect(JSON.stringify(eintrag)).not.toContain(titel);
  });
});

describe("Dienst erzeugeSeiteAusVorlage", () => {
  test("zweimal mit demselben Tag: eine Seite, der zweite Aufruf meldet neu: false", async () => {
    const tagId = await legeTagOhneAutomatik("team");
    const optionen = {
      abteilungId: welt.testabteilungId,
      vorlage: "textseite" as const,
      titel: eindeutig("Dienst"),
      tagId,
      sichtbarkeit: ANGEMELDET,
      autorId: admin.id!,
    };
    const [a, b] = await db.transaction(async (tx) => [
      await erzeugeSeiteAusVorlage(tx, optionen),
      await erzeugeSeiteAusVorlage(tx, optionen),
    ]);
    expect(a).toMatchObject({ neu: true });
    expect(b).toEqual({ id: a!.id, adresse: a!.adresse, neu: false });
    expect(await seitenZu(tagId)).toHaveLength(1);
  });

  test("zwei gleichzeitige Aufrufe mit demselben Titel: zwei Seiten mit verschiedenen Adressen", async () => {
    const titel = eindeutig("Parallel");
    const lege = () =>
      db.transaction((tx) =>
        erzeugeSeiteAusVorlage(tx, {
          abteilungId: welt.testabteilungId,
          vorlage: "leer",
          titel,
          sichtbarkeit: ANGEMELDET,
          autorId: admin.id!,
        }),
      );
    const [a, b] = await Promise.all([lege(), lege()]);
    expect(new Set([a.adresse, b.adresse]).size).toBe(2);
  });
});

describe("Automatik bei neuem Tag", () => {
  test("ein Stufen-Tag erzeugt genau eine Seite als Entwurf unter «Stufen»", async () => {
    const name = `Wölfe ${randomUUID().slice(0, 8)}`;
    const tagId = await legeTagAn("stufe", name);
    const seiten = await seitenZu(tagId);
    expect(seiten).toHaveLength(1);
    const seite = seiten[0]!;
    expect(seite).toMatchObject({
      titel: name,
      tagId,
      sichtbarkeit: "angemeldet",
      veroeffentlichteVersionId: null,
      abteilungId: welt.testabteilungId,
    });
    expect(seite.adresse).toMatch(/^woelfe-[0-9a-f]{8}$/);
    // Stufenseite: Dokument mit dem Tag (Leitungsteam, Termine), gültig
    expect(pruefeDokument(seite.entwurf).ok).toBe(true);
    expect(JSON.stringify(seite.entwurf)).toContain(tagId);
    expect((seite.entwurf as { titel: string }).titel).toBe(name);

    const [eltern] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, seite.elternId!));
    expect(eltern).toMatchObject({
      adresse: "stufen",
      elternId: null,
      veroeffentlichteVersionId: null,
      sichtbarkeit: "angemeldet",
    });
    const versionen = await db
      .select({ n: count() })
      .from(schema.seiteVersion)
      .where(eq(schema.seiteVersion.seiteId, seite.id));
    expect(versionen[0]!.n).toBe(0);

    // Der Pfad ist /stufen/<adresse>; die Elternseite entsteht nur einmal
    await legeTagAn("stufe", eindeutig("Biber"));
    const oben = await db
      .select({ id: schema.seite.id })
      .from(schema.seite)
      .where(
        and(
          eq(schema.seite.abteilungId, welt.testabteilungId),
          isNull(schema.seite.elternId),
          eq(schema.seite.adresse, "stufen"),
        ),
      );
    expect(oben).toHaveLength(1);
  });

  test("ein Team-Tag erzeugt eine Textseite unter «Teams»", async () => {
    const name = eindeutig("Küche");
    const tagId = await legeTagAn("team", name);
    const [seite] = await seitenZu(tagId);
    expect(seite).toMatchObject({ titel: name, tagId });
    expect(seite!.adresse).toMatch(/^kueche-/);
    const [eltern] = await db
      .select({ adresse: schema.seite.adresse, titel: schema.seite.titel })
      .from(schema.seite)
      .where(eq(schema.seite.id, seite!.elternId!));
    expect(eltern).toEqual({ adresse: "teams", titel: "Teams" });
    const dok = pruefeDokument(seite!.entwurf);
    expect(dok.ok).toBe(true);
    // Keine Stufenfakten bei einem Team
    expect(JSON.stringify(seite!.entwurf)).not.toContain("stufenfakten");
  });

  test("Funktion und Lager erzeugen keine Seite", async () => {
    for (const typ of ["funktion", "lager"]) {
      const tagId = await legeTagAn(typ, eindeutig(typ));
      expect(await seitenZu(tagId)).toHaveLength(0);
    }
  });

  test("Namen mit gleicher Adresse: der zweite bekommt einen Zusatz und der Tag entsteht trotzdem", async () => {
    const stamm = randomUUID().slice(0, 8);
    const a = await legeTagAn("stufe", `Biber Äpfel ${stamm}`);
    const b = await legeTagAn("stufe", `Biber Aepfel ${stamm}`);
    const [seiteA] = await seitenZu(a);
    const [seiteB] = await seitenZu(b);
    expect(seiteA!.adresse).toBe(`biber-aepfel-${stamm}`);
    expect(seiteB!.adresse).toBe(`biber-aepfel-${stamm}-2`);
  });

  test("eine bestehende Seite «stufen» wird die Elternseite, auch mit Unterseiten", async () => {
    // Nur wenn eine andere Abteilung noch keine hat: die Demo-Abteilung als frische Welt
    const demoStufen = await json<Erzeugt>(
      await ausVorlage(demoAdmin, {
        vorlage: "textseite",
        titel: "Stufen",
        sichtbarkeit: { art: "oeffentlich" },
      }),
    );
    expect(demoStufen.adresse).toBe("stufen");
    const tagId = await legeTagAn("stufe", eindeutig("Demo"), demoAdmin);
    const [seite] = await seitenZu(tagId);
    expect(seite!.elternId).toBe(demoStufen.id);
    expect(seite!.abteilungId).toBe(welt.demoAbteilungId);
  });

  test("POST /admin/stufen legt ebenfalls eine Seite an", async () => {
    const name = eindeutig("Pfadi");
    const antwort = await anfrage(admin, "POST", "/api/v1/admin/stufen", {
      name,
    });
    expect(antwort.status).toBe(201);
    const { id } = await json<{ id: string }>(antwort);
    const seiten = await seitenZu(id);
    expect(seiten).toHaveLength(1);
    expect(seiten[0]!.titel).toBe(name);
  });

  test("meldet «seite_geaendert» für die neuen Seiten nach dem Commit", async () => {
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    try {
      const tagId = await legeTagAn("team", eindeutig("Ereignis"));
      const [seite] = await seitenZu(tagId);
      expect(ereignisse).toContainEqual({
        art: "seite_geaendert",
        abteilungId: welt.testabteilungId,
        seiteId: seite!.id,
      });
    } finally {
      ab();
    }
  });

  test("scheitert die Seite, entsteht auch der Tag nicht (eine Transaktion)", async () => {
    const name = eindeutig("Rollback");
    vi.mocked(legeSeiteFuerTagAn).mockRejectedValueOnce(new Error("kaputt"));
    const antwort = await anfrage(admin, "POST", TAGS, { typ: "stufe", name });
    expect(antwort.status).toBe(500);
    expect(
      await db.select().from(schema.tag).where(eq(schema.tag.name, name)),
    ).toHaveLength(0);
    // Auch kein Gruppenchat ohne Stufe
    expect(
      (await db.select().from(schema.seite).where(eq(schema.seite.titel, name)))
        .length,
    ).toBe(0);
    // Danach geht es wieder
    await legeTagAn("stufe", name);
  });

  test("ein doppelter Tag-Name bleibt 409 und legt keine Seite an", async () => {
    const name = eindeutig("Doppelt");
    await legeTagAn("team", name);
    const vorher = await zaehleSeiten();
    const antwort = await anfrage(admin, "POST", TAGS, { typ: "team", name });
    expect(antwort.status).toBe(409);
    const nachher = await zaehleSeiten();
    expect(nachher).toBe(vorher);
  });
});

describe("Rechte an der automatisch erzeugten Seite", () => {
  test("die Stufenleitung der neuen Stufe bearbeitet die Seite, andere Stufenleitungen nicht", async () => {
    const tagId = await legeTagAn("stufe", eindeutig("Neue Stufe"));
    const [seite] = await seitenZu(tagId);
    const neueSl = await leitende();
    await db
      .insert(schema.rolle)
      .values({ userId: neueSl.id!, stufeId: tagId, typ: "stufenleitung" });

    const entwurf = `${SEITEN}/${seite!.id}/entwurf`;
    expect((await anfrage(neueSl, "GET", entwurf)).status).toBe(200);
    expect(
      (await anfrage(neueSl, "PATCH", `${SEITEN}/${seite!.id}`, { titel: "N" }))
        .status,
    ).toBe(204);
    // Die Stufenleitung einer anderen Stufe, die Webmaster und die Abteilungsleitung
    expect((await anfrage(slA, "GET", entwurf)).status).toBe(403);
    expect((await anfrage(slB, "GET", entwurf)).status).toBe(403);
    expect((await anfrage(ohneRecht, "GET", entwurf)).status).toBe(403);
    expect((await anfrage(eltern, "GET", entwurf)).status).toBe(403);
    expect((await anfrage(admin, "GET", entwurf)).status).toBe(200);
    expect((await anfrage(webmaster, "GET", entwurf)).status).toBe(200);
    // Die neue Stufenleitung sieht in der Liste nur ihre Seite; Anlegen und Löschen bleibt der Webmaster
    const liste = await json<{ seiten: { id: string }[] }>(
      await anfrage(neueSl, "GET", SEITEN),
    );
    expect(liste.seiten.map((s) => s.id)).toEqual([seite!.id]);
    expect(
      (await anfrage(neueSl, "DELETE", `${SEITEN}/${seite!.id}`)).status,
    ).toBe(403);
  });

  describe("Verantwortliche eines Teams (Annahme: Rolle «verantwortlich» am Tag)", () => {
    async function teamMitVerantwortlichem(rolle: string | null) {
      const tagId = await legeTagAn("team", eindeutig("Team"));
      const [seite] = await seitenZu(tagId);
      const person = await leitende();
      await db
        .insert(schema.personTag)
        .values({ userId: person.id!, tagId, rolle });
      return { tagId, seiteId: seite!.id, person };
    }

    test("die Verantwortlichen bearbeiten die Seite ihres Teams, nur diese", async () => {
      const a = await teamMitVerantwortlichem("verantwortlich");
      const b = await teamMitVerantwortlichem("Verantwortlich");
      const entwurf = (id: string) => `${SEITEN}/${id}/entwurf`;
      expect((await anfrage(a.person, "GET", entwurf(a.seiteId))).status).toBe(
        200,
      );
      // Gross-/Kleinschreibung der Rolle ist egal
      expect((await anfrage(b.person, "GET", entwurf(b.seiteId))).status).toBe(
        200,
      );
      expect((await anfrage(a.person, "GET", entwurf(b.seiteId))).status).toBe(
        403,
      );
      const liste = await json<{ seiten: { id: string }[] }>(
        await anfrage(a.person, "GET", SEITEN),
      );
      expect(liste.seiten.map((s) => s.id)).toEqual([a.seiteId]);
      // Der Entwurf ist speicherbar und veröffentlichbar
      const e = await json<{ zaehler: number; dokument: unknown }>(
        await anfrage(a.person, "GET", entwurf(a.seiteId)),
      );
      const gespeichert = await anfrage(a.person, "PUT", entwurf(a.seiteId), {
        zaehler: e.zaehler,
        dokument: e.dokument,
      });
      expect(gespeichert.status).toBe(200);
      // Löschen und Anlegen bleiben bei Abteilungsleitung und Webmaster
      expect(
        (await anfrage(a.person, "DELETE", `${SEITEN}/${a.seiteId}`)).status,
      ).toBe(403);
      expect(
        (await ausVorlage(a.person, { vorlage: "leer", titel: "X" })).status,
      ).toBe(403);
    });

    test("ohne die Rolle (keine oder eine andere) 403", async () => {
      for (const rolle of [null, "Mitglied", "verantwortlich-fuer-nichts"]) {
        const t = await teamMitVerantwortlichem(rolle);
        expect(
          (await anfrage(t.person, "GET", `${SEITEN}/${t.seiteId}`)).status,
        ).toBe(403);
        expect((await anfrage(t.person, "GET", SEITEN)).status).toBe(403);
      }
    });

    test("an einem Stufen-Tag verleiht die Rolle nichts", async () => {
      const tagId = await legeTagAn("stufe", eindeutig("Stufe"));
      const [seite] = await seitenZu(tagId);
      const person = await leitende();
      await db
        .insert(schema.personTag)
        .values({ userId: person.id!, tagId, rolle: "verantwortlich" });
      expect(
        (await anfrage(person, "GET", `${SEITEN}/${seite!.id}`)).status,
      ).toBe(403);
    });

    test("die Rolle an einem Team der anderen Abteilung verleiht nichts", async () => {
      const [fremd] = await db
        .insert(schema.tag)
        .values({
          abteilungId: welt.demoAbteilungId,
          typ: "team",
          name: eindeutig("Fremdteam"),
          kuerzel: "F",
        })
        .returning({ id: schema.tag.id });
      const fremdeSeite = await json<Erzeugt>(
        await ausVorlage(demoAdmin, {
          vorlage: "textseite",
          titel: "Fremd",
          tagId: fremd!.id,
        }),
      );
      const person = await leitende();
      await db.insert(schema.personTag).values({
        userId: person.id!,
        tagId: fremd!.id,
        rolle: "verantwortlich",
      });
      expect(
        (await anfrage(person, "GET", `${SEITEN}/${fremdeSeite.id}`)).status,
      ).toBe(404);
      expect((await anfrage(person, "GET", SEITEN)).status).toBe(403);
    });
  });
});

// Ein Tag, der ohne die Automatik entsteht (direkt in der Datenbank), für Tests der Route und des Dienstes
async function legeTagOhneAutomatik(typ: "stufe" | "team") {
  const [zeile] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ,
      name: eindeutig(`Roh ${typ}`),
      kuerzel: "R",
    })
    .returning({ id: schema.tag.id });
  return zeile!.id;
}
