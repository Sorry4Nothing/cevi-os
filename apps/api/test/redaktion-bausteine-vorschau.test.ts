import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import { ladeSeiten } from "../src/seiten.js";
import { MAX_VORSCHAU_BAUSTEINE } from "../src/website/vorschau.js";
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

// Vorschau einzelner Bausteine (#739): Katalog mit Platzhaltern, Editor mit den echten Daten der Abteilung
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const speicher: Medienspeicher = {
  ablegen: async () => randomUUID(),
  holen: async () => new Uint8Array(),
  loeschen: async () => {},
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  medienspeicher: speicher,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const URL_VORSCHAU = "/api/v1/redaktion/bausteine/vorschau";

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let webmaster: PersonaKonto;
let eltern: PersonaKonto;
let stufeSeite: string;

function sende(konto: PersonaKonto | null, body: unknown, roh?: string) {
  return app.request(URL_VORSCHAU, {
    method: "POST",
    headers: {
      ...(konto?.headers ?? {}),
      "content-type": "application/json",
    },
    body: roh ?? JSON.stringify(body),
  });
}

type Vorschauen = {
  vorschauen: { html: string | null; grund?: "leer" | "ungueltig" }[];
};
const lies = async (antwort: Response) => (await antwort.json()) as Vorschauen;

const baustein = (typ: string, daten: Record<string, unknown>) => ({
  id: randomUUID(),
  typ,
  daten,
});
const ueberschrift = (text: string) =>
  baustein("ueberschrift", { ebene: 2, text });

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, adminOhne, demoAdmin, slA, slB, webmaster, eltern] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "adminOhneZweitenFaktor"),
      legePersonaAn(welt, "demoAdmin"),
      legePersonaAn(welt, "slA"),
      legePersonaAn(welt, "slB"),
      legePersonaMitFaktorAn(welt, "leitendeA"),
      legePersonaAn(welt, "elternA"),
    ]);
  // Ein eigener Webmaster für den Zähler: Die anderen Tests zählen auf ihrer Person nicht mit
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: `s-${randomUUID().slice(0, 12)}`,
      titel: "Seite",
      sichtbarkeit: "angemeldet",
      tagId: welt.stufeAId,
    })
    .returning({ id: schema.seite.id });
  stufeSeite = z.id;
});

describe("Katalog: Beispiele ohne Seite", () => {
  test("jeder Baustein kommt als Seite im Rahmen: ohne Skript, mit eigener CSP, Text maskiert", async () => {
    const antwort = await sende(admin, {
      bausteine: [
        ueberschrift("<script>alert(1)</script>"),
        baustein("trenner", { art: "linie" }),
        baustein("hinweis", {
          text: "Hinweis",
          link: { beschriftung: "Mehr", ziel: "/anmelden" },
        }),
      ],
    });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("cache-control")).toBe("private, no-store");
    const { vorschauen } = await lies(antwort);
    expect(vorschauen).toHaveLength(3);
    const [kopf, linie, hinweis] = vorschauen.map((v) => v.html!);
    expect(kopf).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(kopf).not.toContain("<script");
    expect(kopf).toContain('href="/admin/website-vorschau.css"');
    expect(kopf).toContain("default-src 'none'");
    expect(kopf).not.toContain("script-src");
    expect(linie).toContain("<hr");
    // Links führen nirgends hin: ohne href kein Ziel und kein Tabstopp
    expect(hinweis).toContain("Mehr");
    expect(hinweis).not.toMatch(/<a\b[^>]*\shref=/);
  });

  test("Platzhalter statt Daten: Bilder aus dem Code, Namen aus dem Code, nie ein Wert aus der Datenbank", async () => {
    const [echt] = await db
      .select({ name: schema.user.ceviName })
      .from(schema.user)
      .where(eq(schema.user.id, admin.id!));
    const bild = randomUUID();
    const { vorschauen } = await lies(
      await sende(admin, {
        bausteine: [
          baustein("bild", { mediumId: bild, unterschrift: "Unterschrift" }),
          baustein("personen", {
            eintraege: [{ personId: admin.id, funktion: "Leitung" }],
          }),
          baustein("terminliste", { anzahl: 3 }),
          baustein("stufenfakten", {}),
          baustein("laden", {}),
          baustein("kontaktkarte", { titel: "Fragen?" }),
        ],
      }),
    );
    expect(vorschauen.map((v) => v.grund)).toEqual(Array(6).fill(undefined));
    const [bildHtml, personen, termine, fakten, laden, kontakt] =
      vorschauen.map((v) => v.html!);
    expect(bildHtml).toContain("data:image/svg+xml,");
    expect(bildHtml).not.toContain("/api/v1/medien/");
    expect(bildHtml).toContain("Unterschrift");
    expect(personen).toContain("Kiwi");
    if (echt?.name) expect(personen).not.toContain(echt.name);
    expect(termine).toContain("Beispiel");
    expect(fakten).toContain("Treffpunkt");
    expect(laden).toContain("Beispiel: Pullover");
    expect(kontakt).toContain("kontakt@beispiel.example");
  });

  test("ein ungültiger Baustein (Bild ohne Medium, fremdes Feld) zeigt «ungueltig», die übrigen erscheinen; HTML aus der Eingabe gibt es nie", async () => {
    const { vorschauen } = await lies(
      await sende(admin, {
        bausteine: [
          baustein("bild", {}),
          baustein("ueberschrift", { ebene: 2, text: "Gut", html: "<b>" }),
          { id: randomUUID(), typ: "html", daten: { html: "<b>x</b>" } },
          "kein Objekt",
          ueberschrift("Gültig"),
        ],
      }),
    );
    expect(vorschauen.map((v) => v.grund)).toEqual([
      "ungueltig",
      "ungueltig",
      "ungueltig",
      "ungueltig",
      undefined,
    ]);
    expect(vorschauen[4]!.html).toContain("Gültig");
  });

  test("ein Baustein ohne Inhalt (Fotoalben im Katalog sind ein Behälter, ein Laden ohne Artikel) ist «leer» oder ein Behälter, nie ein Fehler", async () => {
    const { vorschauen } = await lies(
      await sende(admin, { bausteine: [baustein("fotoalben", {})] }),
    );
    expect(vorschauen).toHaveLength(1);
    expect(vorschauen[0]!.html ?? "").not.toContain("<script");
  });

  test("es entsteht nichts: keine Version, kein Entwurf, kein Protokolleintrag der Seite", async () => {
    const vorher = await db
      .select({ n: schema.seite.entwurfZaehler })
      .from(schema.seite)
      .where(eq(schema.seite.id, stufeSeite));
    const antwort = await sende(slA, {
      seiteId: stufeSeite,
      bausteine: [ueberschrift("Entwurf")],
    });
    expect(antwort.status).toBe(200);
    const nachher = await db
      .select({ n: schema.seite.entwurfZaehler, e: schema.seite.entwurf })
      .from(schema.seite)
      .where(eq(schema.seite.id, stufeSeite));
    expect(nachher[0]!.n).toBe(vorher[0]!.n);
    expect(nachher[0]!.e).toBeNull();
  });
});

describe("Editor: mit Seite, die echten Daten der Abteilung", () => {
  async function medium(abteilungId: string, sichtbarkeit = "angemeldet") {
    const [z] = await db
      .insert(schema.medium)
      .values({
        abteilungId,
        mimeTyp: "image/png",
        groesse: 10,
        breite: 10,
        hoehe: 10,
        altText: "Echtes Bild",
        dekorativ: false,
        sichtbarkeit: sichtbarkeit as "angemeldet",
        speicherSchluessel: randomUUID(),
      })
      .returning({ id: schema.medium.id });
    return z.id;
  }

  test("ein Medium der Abteilung erscheint mit seiner Adresse, auch ein nicht öffentliches; ein fremdes nie", async () => {
    const eigenes = await medium(welt.testabteilungId);
    const fremdes = await medium(welt.demoAbteilungId);
    const { vorschauen } = await lies(
      await sende(slA, {
        seiteId: stufeSeite,
        bausteine: [
          baustein("bild", { mediumId: eigenes }),
          baustein("bild", { mediumId: fremdes }),
        ],
      }),
    );
    expect(vorschauen[0]!.html).toContain(`/api/v1/medien/${eigenes}`);
    expect(vorschauen[0]!.html).not.toContain("data:image");
    expect(vorschauen[1]).toEqual({ html: null, grund: "leer" });
  });

  test("Bausteine mit engerer Sichtbarkeit erscheinen offen", async () => {
    const { vorschauen } = await lies(
      await sende(admin, {
        seiteId: stufeSeite,
        bausteine: [
          {
            ...ueberschrift("Nur für Gruppe"),
            sichtbarkeit: { art: "angemeldet" },
          },
        ],
      }),
    );
    expect(vorschauen[0]!.html).toContain("Nur für Gruppe");
    expect(vorschauen[0]!.html).not.toContain("data-geschuetzt");
  });
});

describe("Rechte und Grenzen", () => {
  const eins = { bausteine: [ueberschrift("Hallo")] };

  test("nur mit Zugang zur Website-Verwaltung: Eltern 403, ohne zweiten Faktor 403, ohne Anmeldung 401", async () => {
    expect((await sende(eltern, eins)).status).toBe(403);
    expect((await sende(adminOhne, eins)).status).toBe(403);
    expect((await sende(null, eins)).status).toBe(401);
    expect((await sende(admin, eins)).status).toBe(200);
  });

  test("mit Seite dasselbe Recht wie die Vorschau der Seite: Stufenleitung A ja, B nein, fremde Abteilung 404", async () => {
    const mit = { seiteId: stufeSeite, ...eins };
    expect((await sende(slA, mit)).status).toBe(200);
    expect((await sende(slB, mit)).status).toBe(403);
    expect((await sende(demoAdmin, mit)).status).toBe(404);
    expect((await sende(admin, { ...mit, seiteId: randomUUID() })).status).toBe(
      404,
    );
  });

  test("Eingabe: strenges Schema, höchstens so viele Bausteine, mindestens einer, Grösse begrenzt", async () => {
    expect((await sende(admin, { bausteine: [] })).status).toBe(400);
    expect((await sende(admin, { ...eins, fremd: 1 })).status).toBe(400);
    expect((await sende(admin, { ...eins, seiteId: "x" })).status).toBe(400);
    expect((await sende(admin, {})).status).toBe(400);
    const zuViele = Array.from({ length: MAX_VORSCHAU_BAUSTEINE + 1 }, () =>
      ueberschrift("a"),
    );
    expect((await sende(admin, { bausteine: zuViele })).status).toBe(400);
    const genau = Array.from({ length: MAX_VORSCHAU_BAUSTEINE }, () =>
      ueberschrift("a"),
    );
    expect((await sende(admin, { bausteine: genau })).status).toBe(200);
    const gross = "x".repeat(300 * 1024);
    expect((await sende(admin, { bausteine: [gross] })).status).toBe(413);
  });

  test("Rate-Limit: höchstens 60 Anfragen je Minute und Person, danach 429", async () => {
    let letzte = 200;
    for (let i = 0; i < 61 && letzte === 200; i++) {
      letzte = (await sende(webmaster, eins)).status;
    }
    expect(letzte).toBe(429);
  });
});
