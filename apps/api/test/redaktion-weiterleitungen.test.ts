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

const BASIS = "/api/v1/redaktion/weiterleitungen";

let welt: Welt;
let admin: PersonaKonto;
let slA: PersonaKonto;
let redaktion: PersonaKonto;
let eltern: PersonaKonto;
let demoAdmin: PersonaKonto;

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

// Pfade je Test eindeutig: Die Tests teilen die Abteilung
const pfad = (vorsatz: string) => `/${vorsatz}-${randomUUID().slice(0, 8)}`;

async function lege(
  konto: PersonaKonto,
  alterPfad: string,
  zielPfad: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const antwort = await anfrage(konto, "POST", BASIS, {
    alterPfad,
    zielPfad,
    ...extra,
  });
  expect(antwort.status, JSON.stringify(await antwort.clone().json())).toBe(
    201,
  );
  return ((await antwort.json()) as { id: string }).id;
}
const fehlercode = async (antwort: Response) =>
  ((await antwort.json()) as { code: string }).code;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, slA, redaktion, eltern, demoAdmin] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "leitendeA"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "demoAdmin"),
  ]);
  // Redaktion = Recht auf alle Seiten (Objekt leer)
  await db.insert(schema.bearbeiter).values({
    abteilungId: welt.testabteilungId,
    objektTyp: "seite",
    userId: redaktion.id!,
  });
});

describe("Rechte", () => {
  test("Abteilungsleitung und Redaktion legen an, listen, ändern und löschen", async () => {
    const a = pfad("alt");
    const id = await lege(redaktion, a, pfad("neu"));
    const liste = (await (await anfrage(admin, "GET", BASIS)).json()) as {
      weiterleitungen: { id: string; alterPfad: string; status: number }[];
    };
    expect(liste.weiterleitungen.find((w) => w.id === id)).toMatchObject({
      alterPfad: a,
      status: 301,
    });
    expect(
      (await anfrage(redaktion, "PATCH", `${BASIS}/${id}`, { status: 302 }))
        .status,
    ).toBe(204);
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
  });

  test("Stufenleitung und Eltern: 403 auf allen vier Routen, auch auf bestehende Zeilen", async () => {
    const id = await lege(admin, pfad("alt"), pfad("neu"));
    for (const konto of [slA, eltern]) {
      expect((await anfrage(konto, "GET", BASIS)).status).toBe(403);
      expect(
        (
          await anfrage(konto, "POST", BASIS, {
            alterPfad: pfad("x"),
            zielPfad: "/y",
          })
        ).status,
      ).toBe(403);
      expect(
        (await anfrage(konto, "PATCH", `${BASIS}/${id}`, { status: 302 }))
          .status,
      ).toBe(403);
      expect((await anfrage(konto, "DELETE", `${BASIS}/${id}`)).status).toBe(
        403,
      );
    }
  });

  test("eine fremde Abteilung sieht und ändert nichts: 404, die Liste ist leer", async () => {
    const id = await lege(admin, pfad("alt"), pfad("neu"));
    expect(
      (await anfrage(demoAdmin, "PATCH", `${BASIS}/${id}`, { status: 302 }))
        .status,
    ).toBe(404);
    expect((await anfrage(demoAdmin, "DELETE", `${BASIS}/${id}`)).status).toBe(
      404,
    );
    const liste = (await (await anfrage(demoAdmin, "GET", BASIS)).json()) as {
      weiterleitungen: unknown[];
    };
    expect(liste.weiterleitungen).toEqual([]);
    // Dieselbe alte Adresse in der anderen Abteilung ist erlaubt
    const a = pfad("gleich");
    await lege(admin, a, "/ziel");
    await lege(demoAdmin, a, "/ziel");
  });
});

describe("Kein offener Redirect", () => {
  const boeseZiele = [
    "https://fremd.example/x",
    "http://fremd.example",
    "//fremd.example",
    "/\\fremd.example",
    "\\\\fremd.example",
    "javascript:alert(1)",
    "/a/../b",
    "/a/./b",
    "/a?x=1",
    "/a#x",
    "/a//b",
    "/a b",
    "/a\nb",
    "/a\r\nredir /x /y 301",
    "/a{b}",
    "/a;b",
    '/a"b',
    "/a'b",
    "/a#kommentar",
    "/Gross",
    "/ä",
    "/%2e%2e/x",
    "/a/",
    "a",
    "",
    "/" + "a".repeat(200),
    "/a/b/c/d/e/f/g/h",
  ];

  test.each(boeseZiele)("Ziel %j wird abgelehnt", async (ziel) => {
    const antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: pfad("alt"),
      zielPfad: ziel,
    });
    expect(antwort.status).toBe(400);
  });

  test.each([...boeseZiele, "/", "/api/x", "/admin", "/website/x"])(
    "alte Adresse %j wird abgelehnt",
    async (alt) => {
      const antwort = await anfrage(admin, "POST", BASIS, {
        alterPfad: alt,
        zielPfad: "/ziel",
      });
      expect(antwort.status).toBe(400);
    },
  );

  test("ein Status ausser 301 und 302 und unbekannte Felder sind 400", async () => {
    for (const body of [
      { status: 307 },
      { status: "301" },
      { status: 200 },
      { host: "fremd.example" },
    ]) {
      expect(
        (
          await anfrage(admin, "POST", BASIS, {
            alterPfad: pfad("alt"),
            zielPfad: "/ziel",
            ...body,
          })
        ).status,
      ).toBe(400);
    }
  });

  test("auch die Datenbank lehnt einen offenen Redirect ab (CHECK)", async () => {
    for (const ziel of [
      "https://fremd.example",
      "//fremd.example",
      "/a/../b",
    ]) {
      await expect(
        db.insert(schema.weiterleitung).values({
          abteilungId: welt.testabteilungId,
          alterPfad: pfad("db"),
          zielPfad: ziel,
        }),
      ).rejects.toThrow();
    }
    await expect(
      db.insert(schema.weiterleitung).values({
        abteilungId: welt.testabteilungId,
        alterPfad: "/a",
        zielPfad: "/a",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.weiterleitung).values({
        abteilungId: welt.testabteilungId,
        alterPfad: pfad("db"),
        zielPfad: "/ziel",
        status: 307,
      }),
    ).rejects.toThrow();
  });

  test("Ziel «/» und Endungen sind erlaubt", async () => {
    await lege(admin, pfad("alt"), "/");
    await lege(admin, `${pfad("alt")}.html`, "/stufen/woelfe");
  });
});

describe("Schleifen und Ketten", () => {
  test("A nach B, dann B nach A: Schleife", async () => {
    const [a, b] = [pfad("a"), pfad("b")];
    await lege(admin, a, b);
    const antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: b,
      zielPfad: a,
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("WEITERLEITUNG_SCHLEIFE");
  });

  test("eine Adresse auf sich selbst: Schleife", async () => {
    const a = pfad("selbst");
    const antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: a,
      zielPfad: a,
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("WEITERLEITUNG_SCHLEIFE");
  });

  test("Kette: Das Ziel ist eine alte Adresse, oder die alte Adresse ist ein Ziel", async () => {
    const [a, b, c, d] = [pfad("a"), pfad("b"), pfad("c"), pfad("d")];
    await lege(admin, a, b);
    // C nach A: A ist selbst eine alte Adresse
    let antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: c,
      zielPfad: a,
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("WEITERLEITUNG_KETTE");
    // B nach D: B ist das Ziel von A
    antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: b,
      zielPfad: d,
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("WEITERLEITUNG_KETTE");
  });

  test("Ändern prüft gegen den Stand ohne die eigene Zeile", async () => {
    const [a, b, c, d] = [pfad("a"), pfad("b"), pfad("c"), pfad("d")];
    const idA = await lege(admin, a, b);
    const idC = await lege(admin, c, d);
    // Das eigene Ziel zu wiederholen ist keine Kette mit sich selbst
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${idA}`, { zielPfad: b }))
        .status,
    ).toBe(204);
    // C auf A zeigen lassen: A ist eine alte Adresse
    let antwort = await anfrage(admin, "PATCH", `${BASIS}/${idC}`, {
      zielPfad: a,
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("WEITERLEITUNG_KETTE");
    // A auf D zeigen lassen ist in Ordnung; danach ist D ein Ziel von beiden
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${idA}`, { zielPfad: d }))
        .status,
    ).toBe(204);
    // D als alte Adresse geht nicht mehr
    antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: d,
      zielPfad: pfad("e"),
    });
    expect(antwort.status).toBe(409);
  });

  test("eine alte Adresse gibt es je Abteilung einmal", async () => {
    const a = pfad("a");
    await lege(admin, a, "/ziel");
    const antwort = await anfrage(admin, "POST", BASIS, {
      alterPfad: a,
      zielPfad: "/anders",
    });
    expect(antwort.status).toBe(409);
    expect(await fehlercode(antwort)).toBe("WEITERLEITUNG_ADRESSE_VERGEBEN");
    // Auch beim Ändern
    const id = await lege(admin, pfad("b"), "/ziel");
    const g = await anfrage(admin, "PATCH", `${BASIS}/${id}`, { alterPfad: a });
    expect(g.status).toBe(409);
    expect(await fehlercode(g)).toBe("WEITERLEITUNG_ADRESSE_VERGEBEN");
  });

  test("zwei gleichzeitige Gegenrichtungen ergeben nie eine Schleife", async () => {
    const [a, b] = [pfad("a"), pfad("b")];
    const stati = (
      await Promise.all([
        anfrage(admin, "POST", BASIS, { alterPfad: a, zielPfad: b }),
        anfrage(admin, "POST", BASIS, { alterPfad: b, zielPfad: a }),
      ])
    ).map((r) => r.status);
    expect(stati.sort()).toEqual([201, 409]);
  });
});

describe("Audit und Ereignis", () => {
  test("das Audit-Log nennt nie die Pfade, und die Auslieferung bekommt ein Ereignis", async () => {
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    const a = pfad("geheim-alt");
    const n = pfad("geheim-neu");
    const id = await lege(admin, a, n, { status: 302 });
    await anfrage(admin, "PATCH", `${BASIS}/${id}`, { zielPfad: pfad("z") });
    await anfrage(admin, "DELETE", `${BASIS}/${id}`);
    ab();
    const eintraege = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(eintraege.map((e) => e.aktion).sort()).toEqual([
      "weiterleitung_angelegt",
      "weiterleitung_geaendert",
      "weiterleitung_geloescht",
    ]);
    const angelegt = eintraege.find(
      (e) => e.aktion === "weiterleitung_angelegt",
    );
    expect(angelegt).toMatchObject({
      akteurId: admin.id,
      details: { status: 302 },
    });
    expect(
      eintraege.find((e) => e.aktion === "weiterleitung_geaendert")?.details,
    ).toEqual({ felder: ["zielPfad"] });
    expect(JSON.stringify(eintraege)).not.toContain("geheim");
    expect(
      ereignisse.filter(
        (e) =>
          e.art === "weiterleitung_geaendert" &&
          e.abteilungId === welt.testabteilungId,
      ),
    ).toHaveLength(3);
  });

  test("Löschen entfernt die Zeile", async () => {
    const id = await lege(admin, pfad("alt"), "/ziel");
    await anfrage(admin, "DELETE", `${BASIS}/${id}`);
    const zeilen = await db
      .select()
      .from(schema.weiterleitung)
      .where(
        and(
          eq(schema.weiterleitung.id, id),
          eq(schema.weiterleitung.abteilungId, welt.testabteilungId),
        ),
      );
    expect(zeilen).toEqual([]);
  });
});
