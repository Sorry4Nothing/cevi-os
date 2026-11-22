import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import { rendereSeite, keineDaten } from "../src/website/rendern.js";
import { pruefeDokument } from "../src/website/dokument.js";
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

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const GEHEIM = "GEHEIMER-MARKER-TEXT";
const BOESE = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

let welt: Welt;
let admin: PersonaKonto;
let slA: PersonaKonto;
let leitendeA: PersonaKonto;
let elternA: PersonaKonto;
let elternB: PersonaKonto;
let mussWechseln: PersonaKonto;
let ohneLogin: PersonaKonto;
let demoAdmin: PersonaKonto;
let demoEltern: PersonaKonto;
let tagId: string;

function inhalt(konto: PersonaKonto, pfad: string) {
  return app.request(
    `/api/v1/website/inhalt?pfad=${encodeURIComponent(pfad)}`,
    {
      headers: konto.headers,
    },
  );
}
type Antwort = {
  titel: string;
  bausteine: { id: string; knoten: unknown }[];
};
const lies = async (konto: PersonaKonto, pfad: string) => {
  const a = await inhalt(konto, pfad);
  expect(a.status).toBe(200);
  return (await a.json()) as Antwort;
};

const text = (t: string, extra: object = {}) => ({
  id: randomUUID(),
  typ: "text",
  daten: { inhalt: [{ typ: "absatz", inhalt: [{ text: t }] }] },
  ...extra,
});
const dok = (titel: string, ...bausteine: unknown[]) => ({
  v: 1,
  titel,
  bausteine,
});
const angemeldet = { sichtbarkeit: { art: "angemeldet" } };
const nurTag = () => ({ sichtbarkeit: { art: "tags", tagIds: [tagId] } });

// Eine veröffentlichte Seite direkt in der Datenbank (die Routen der Website-Verwaltung testet #350)
async function seite(
  adresse: string,
  sichtbarkeit: "oeffentlich" | "angemeldet" | "tags",
  inhaltDok: unknown,
  abteilungId = welt.testabteilungId,
  veroeffentlicht = true,
  elternId: string | null = null,
) {
  const [s] = await db
    .insert(schema.seite)
    .values({
      abteilungId,
      elternId,
      adresse,
      titel: adresse,
      sichtbarkeit,
      sichtbarkeitTags: sichtbarkeit === "tags" ? [tagId] : [],
    })
    .returning();
  if (veroeffentlicht) {
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: s!.id, nr: 1, inhalt: inhaltDok })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, s!.id));
  }
  return s!.id;
}

const slug = () => `s-${randomUUID().slice(0, 12)}`;
// Der Text eines Knotens, ohne die Form zu kennen
const alleTexte = (a: Antwort) => JSON.stringify(a.bausteine);

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, slA, leitendeA, elternA, elternB, mussWechseln, ohneLogin] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "slA"),
      legePersonaAn(welt, "leitendeA"),
      legePersonaAn(welt, "elternA"),
      legePersonaAn(welt, "elternB"),
      legePersonaAn(welt, "mussPasswortAendern"),
      legePersonaAn(welt, "ohneLogin"),
    ]);
  [demoAdmin, demoEltern] = await Promise.all([
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "demoEltern"),
  ]);
  // Der Tag «Leitende»: nur leitendeA trägt ihn
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: "Leitende Test",
      kuerzel: "LT",
    })
    .returning();
  tagId = t!.id;
  await db
    .insert(schema.personTag)
    .values({ userId: leitendeA.id!, tagId, rolle: "Leitung" });
  await db
    .update(schema.user)
    .set({ ceviName: "Cevi Name Leitung" })
    .where(eq(schema.user.id, leitendeA.id!));
});

describe("öffentliche Seite mit geschützten Bausteinen", () => {
  let pfad: string;
  let ids: { offen: string; angemeldet: string; tag: string };

  beforeAll(async () => {
    const adresse = slug();
    pfad = `/${adresse}`;
    const offen = text("Offen für alle");
    const ang = text(`Für Angemeldete ${GEHEIM}`, angemeldet);
    const tg = text(`Für Leitende ${GEHEIM}`, nurTag());
    ids = { offen: offen.id, angemeldet: ang.id, tag: tg.id };
    await seite(adresse, "oeffentlich", dok("Titel", offen, ang, tg));
  });

  test("ohne Sitzung 401 mit neutralem Body, ohne Hinweis auf den Inhalt", async () => {
    const a = await inhalt(ohneLogin, pfad);
    expect(a.status).toBe(401);
    const body = await a.text();
    expect(body).not.toContain(GEHEIM);
    expect(body).not.toContain(ids.tag);
  });

  test.each([
    ["Eltern A", () => elternA, ["angemeldet"]],
    ["Eltern B", () => elternB, ["angemeldet"]],
    // Stufenleitung ohne den Tag: Die Sichtbarkeit hängt nur an Tags, nicht an der Rolle
    ["Stufenleitung A", () => slA, ["angemeldet"]],
    ["Leitende mit Tag", () => leitendeA, ["angemeldet", "tag"]],
    ["Admin der Abteilung", () => admin, ["angemeldet", "tag"]],
  ] as const)(
    "%s sieht genau die erlaubten Bausteine",
    async (_n, konto, erwartet) => {
      const a = await lies(konto(), pfad);
      expect(a.bausteine.map((b) => b.id)).toEqual(erwartet.map((k) => ids[k]));
      // Nie der öffentliche Baustein: Er steht schon im HTML
      expect(alleTexte(a)).not.toContain("Offen für alle");
    },
  );

  test("Knoten statt HTML: Der Text ist eine Zeichenkette im Element", async () => {
    const a = await lies(elternA, pfad);
    expect(a.bausteine[0]!.knoten).toEqual({
      tag: "div",
      attr: { class: "text" },
      kinder: [{ tag: "p", kinder: [`Für Angemeldete ${GEHEIM}`] }],
    });
  });

  test("Fremdabteilung und Demo: 404, auch mit gleicher Adresse nichts aus der Website-Abteilung", async () => {
    for (const k of [demoAdmin, demoEltern]) {
      const a = await inhalt(k, pfad);
      expect(a.status).toBe(404);
      expect(await a.text()).not.toContain(GEHEIM);
    }
  });

  test("Antwortköpfe: nie in einem gemeinsamen Zwischenspeicher", async () => {
    const a = await inhalt(elternA, pfad);
    expect(a.headers.get("cache-control")).toBe("private, no-store");
    expect(a.headers.get("vary")).toBe("Cookie");
  });

  test("Pflichtwechsel des Passworts: 403, kein Inhalt", async () => {
    const a = await inhalt(mussWechseln, pfad);
    expect(a.status).toBe(403);
    expect(await a.text()).not.toContain(GEHEIM);
  });

  test("das statische HTML derselben Version enthält nur leere Platzhalter", async () => {
    const [{ inhalt: roh }] = await db
      .select({ inhalt: schema.seiteVersion.inhalt })
      .from(schema.seiteVersion)
      .innerJoin(
        schema.seite,
        eq(schema.seite.veroeffentlichteVersionId, schema.seiteVersion.id),
      )
      .where(eq(schema.seite.adresse, pfad.slice(1)));
    const p = pruefeDokument(roh);
    if (!p.ok) throw new Error("Dokument");
    const html = rendereSeite(
      { id: randomUUID(), pfad, dokument: p.dokument },
      {
        abteilung: "Test",
        basisUrl: "https://www.example.org",
        navigation: [],
        daten: keineDaten(),
      },
    );
    expect(html).not.toContain(GEHEIM);
    expect(html).toContain(`<div data-geschuetzt="${ids.angemeldet}"></div>`);
    expect(html).toContain(`<div data-geschuetzt="${ids.tag}"></div>`);
  });

  test("Nachladen verändert nichts: Seiten und Versionen bleiben gleich", async () => {
    // Nur die Seiten dieser Abteilung: Andere Testdateien legen gleichzeitig Seiten an
    const stand = async () =>
      JSON.stringify([
        await db
          .select()
          .from(schema.seite)
          .where(eq(schema.seite.abteilungId, welt.testabteilungId))
          .orderBy(schema.seite.id),
        await db
          .select({ v: schema.seiteVersion })
          .from(schema.seiteVersion)
          .innerJoin(
            schema.seite,
            eq(schema.seite.id, schema.seiteVersion.seiteId),
          )
          .where(eq(schema.seite.abteilungId, welt.testabteilungId))
          .orderBy(schema.seiteVersion.id),
      ]);
    const vorher = await stand();
    await inhalt(admin, pfad);
    await inhalt(elternA, pfad);
    await inhalt(ohneLogin, pfad);
    const nachher = await stand();
    expect(nachher).toBe(vorher);
  });
});

describe("ganz geschützte Seite", () => {
  let tagSeite: string;
  let angSeite: string;
  let eigene: string;

  beforeAll(async () => {
    tagSeite = slug();
    angSeite = slug();
    const eng = text(`Nur Admin und Leitende ${GEHEIM}`, nurTag());
    eigene = eng.id;
    await seite(
      tagSeite,
      "tags",
      dok("Titel der Gruppe", text(`Innen ${GEHEIM}`), eng),
    );
    await seite(
      angSeite,
      "angemeldet",
      dok("Titel intern", text("Für alle Angemeldeten"), eng),
    );
  });

  test("ohne Sitzung 401", async () => {
    expect((await inhalt(ohneLogin, `/${tagSeite}`)).status).toBe(401);
    expect((await inhalt(ohneLogin, `/${angSeite}`)).status).toBe(401);
  });

  test("Seite für einen Tag: nur wer ihn trägt (und der Admin) bekommt Titel und Inhalt, alle anderen 404", async () => {
    for (const k of [elternA, elternB, slA, demoEltern, demoAdmin]) {
      const a = await inhalt(k, `/${tagSeite}`);
      expect(a.status).toBe(404);
      const body = await a.text();
      expect(body).not.toContain(GEHEIM);
      expect(body).not.toContain("Titel der Gruppe");
    }
    for (const k of [leitendeA, admin]) {
      const a = await lies(k, `/${tagSeite}`);
      expect(a.titel).toBe("Titel der Gruppe");
      expect(a.bausteine).toHaveLength(2);
    }
  });

  test("Seite für Angemeldete: Eltern sehen sie, den Baustein mit engerer Sichtbarkeit nicht", async () => {
    const eltern = await lies(elternA, `/${angSeite}`);
    expect(eltern.titel).toBe("Titel intern");
    expect(eltern.bausteine.map((b) => b.id)).not.toContain(eigene);
    expect(eltern.bausteine).toHaveLength(1);
    const leitung = await lies(leitendeA, `/${angSeite}`);
    expect(leitung.bausteine.map((b) => b.id)).toContain(eigene);
    expect((await inhalt(demoEltern, `/${angSeite}`)).status).toBe(404);
  });
});

describe("Pfad und Seite", () => {
  test.each([
    "",
    "stufen",
    "//evil.example",
    "/\\evil",
    "/stufen/",
    "/Stufen",
    "/a/../b",
    "/api",
    "/admin/x",
    "/anmelden",
    "/%2e%2e",
    "/a?x=1",
    "/a#b",
    `/${"a".repeat(61)}`,
    "/a/b/c/d/e/f",
  ])("ungültiger Pfad %j: 404", async (p) => {
    expect((await inhalt(elternA, p)).status).toBe(404);
  });

  test("ohne Parameter 404, unbekannte Seite 404", async () => {
    const a = await app.request("/api/v1/website/inhalt", {
      headers: elternA.headers,
    });
    expect(a.status).toBe(404);
    expect((await inhalt(elternA, "/gibt-es-nicht")).status).toBe(404);
  });

  test("eine Seite ohne veröffentlichte Version: 404, auch für den Admin", async () => {
    const adresse = slug();
    await seite(
      adresse,
      "oeffentlich",
      dok("Entwurf", text(GEHEIM, angemeldet)),
      welt.testabteilungId,
      false,
    );
    expect((await inhalt(admin, `/${adresse}`)).status).toBe(404);
  });

  test("Unterseite und Startseite", async () => {
    const eltern = slug();
    const e = await seite(eltern, "oeffentlich", dok("E"));
    const kind = slug();
    await seite(
      kind,
      "oeffentlich",
      dok("K", text("Kind", angemeldet)),
      welt.testabteilungId,
      true,
      e,
    );
    const a = await lies(elternA, `/${eltern}/${kind}`);
    expect(a.bausteine).toHaveLength(1);
    // Die Kind-Adresse allein gibt es nicht auf der obersten Ebene
    expect((await inhalt(elternA, `/${kind}`)).status).toBe(404);
  });
});

describe("Inhalte der Bausteine", () => {
  test("XSS: Schadtext bleibt eine Zeichenkette, nie ein Element", async () => {
    const adresse = slug();
    const b = {
      id: randomUUID(),
      typ: "text",
      sichtbarkeit: { art: "angemeldet" },
      daten: {
        inhalt: [
          {
            typ: "absatz",
            inhalt: [{ text: BOESE, fett: true }],
          },
        ],
      },
    };
    const ueberschrift = {
      id: randomUUID(),
      typ: "ueberschrift",
      sichtbarkeit: { art: "angemeldet" },
      daten: { ebene: 2, text: BOESE },
    };
    await seite(adresse, "oeffentlich", dok("T", b, ueberschrift));
    const a = await lies(elternA, `/${adresse}`);
    const tags = new Set<string>();
    const sammle = (k: unknown) => {
      if (typeof k === "string") return;
      const e = k as { tag: string; attr?: object; kinder?: unknown[] };
      tags.add(e.tag);
      for (const attr of Object.keys(e.attr ?? {})) {
        expect(attr).toMatch(/^(href|rel|class)$/);
      }
      e.kinder?.forEach(sammle);
    };
    a.bausteine.forEach((x) => sammle(x.knoten));
    // Nur Elemente des Katalogs, kein img und kein script, und kein javascript:-Link
    expect([...tags].sort()).toEqual(["div", "h2", "p", "strong"]);
    expect(JSON.stringify(a)).toContain(BOESE.replaceAll('"', '\\"'));
    expect(JSON.stringify(a)).not.toContain("href");
  });

  test("Bilder: ein Medium nur für Angemeldete erscheint nur im nachgeladenen Baustein", async () => {
    const [m] = await db
      .insert(schema.medium)
      .values({
        abteilungId: welt.testabteilungId,
        mimeTyp: "image/png",
        groesse: 10,
        breite: 10,
        hoehe: 10,
        altText: "Ein Bild",
        dekorativ: false,
        sichtbarkeit: "angemeldet",
        speicherSchluessel: randomUUID(),
      })
      .returning();
    const adresse = slug();
    const bild = {
      id: randomUUID(),
      typ: "bild",
      sichtbarkeit: { art: "angemeldet" },
      daten: { mediumId: m!.id },
    };
    await seite(adresse, "oeffentlich", dok("T", bild));
    const a = await lies(elternA, `/${adresse}`);
    expect(JSON.stringify(a)).toContain(`/api/v1/medien/${m!.id}`);
    expect(JSON.stringify(a)).toContain("Ein Bild");
  });

  test("Leitungsteam: nur Cevi-Name und Funktion, nie E-Mail oder Telefon", async () => {
    const adresse = slug();
    const team = {
      id: randomUUID(),
      typ: "leitungsteam",
      sichtbarkeit: { art: "angemeldet" },
      daten: { tagId },
    };
    await seite(adresse, "oeffentlich", dok("T", team));
    const a = await lies(elternA, `/${adresse}`);
    const s = JSON.stringify(a);
    expect(s).toContain("Cevi Name Leitung");
    expect(s).toContain("Leitung");
    expect(s).not.toMatch(/@|tel:|mailto:/);
  });
});
