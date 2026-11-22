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
import { bearbeitbar, darfBearbeiten } from "../src/bearbeiten.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import type { PlattformRecht } from "../src/plattform.js";
import type { Person } from "../src/rechte.js";
import { ladeSeiten } from "../src/seiten.js";
import { hatWebsiteZugang } from "../src/website/seiten.js";
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

// Rechte-Matrix der Website-Verwaltung (#426): Der Webmaster (Plattformrolle) ersetzt die Redaktion. Jede Zeile ist eine Route, jede Spalte eine Person; die Wirkung der Routen selbst steht in den Tests redaktion-*.test.ts
bereiteAuthTestsVor();

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
// Ein eigener Client zählt die Abfragen der Rechteprüfung
const abfragen: string[] = [];
const zaehlSql = postgres(API_URL, {
  debug: (_verbindung, abfrage) => {
    abfragen.push(abfrage);
  },
});
const zaehlDb = erstelleDb(zaehlSql);
afterAll(() => Promise.all([sql.end(), zaehlSql.end()]));

const R = "/api/v1/redaktion";

let welt: Welt;
let stufenseite: string;
const konten: Record<string, PersonaKonto> = {};

// Webmaster mit genau diesen Rechten (eine eigene Rolle); «voll» ist die Vorgabe
const EINGESCHRAENKT: Record<string, PlattformRecht[]> = {
  nurSeitenBearbeiten: ["seiten.bearbeiten"],
  nurVeroeffentlichen: ["seiten.veroeffentlichen"],
  nurAnlegen: ["seiten.anlegen_loeschen"],
  nurMedien: ["medien.verwalten"],
  nurWeiterleitungen: ["weiterleitungen.verwalten"],
  nurVorlagen: ["vorlagen.nutzen"],
  anlegenUndVorlagen: ["seiten.anlegen_loeschen", "vorlagen.nutzen"],
  nurWartung: ["wartungsmodus.website"],
};

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten.admin = await legePersonaAn(welt, "admin");
  konten.demoAdmin = await legePersonaAn(welt, "demoAdmin");
  konten.slA = await legePersonaAn(welt, "slA");
  konten.slB = await legePersonaAn(welt, "slB");
  konten.eltern = await legePersonaAn(welt, "elternA");
  konten.voll = await legePersonaMitFaktorAn(welt, "leitendeA");
  await macheWebmaster(db, welt.testabteilungId, konten.voll.id!);
  for (const [name, rechte] of Object.entries(EINGESCHRAENKT)) {
    konten[name] = await legePersonaMitFaktorAn(welt, "leitendeB");
    await macheWebmaster(db, welt.testabteilungId, konten[name].id!, rechte);
  }
  // Webmaster der Fremdabteilung: Die Rolle gilt nur in ihrer Abteilung
  konten.demoWebmaster = await legePersonaMitFaktorAn(welt, "demoEltern");
  await macheWebmaster(db, welt.demoAbteilungId, konten.demoWebmaster.id!);
  stufenseite = await neueSeite(welt.stufeAId, true);
  // Webmaster ohne zweiten Faktor
  konten.ohneFaktor = await legePersonaAn(welt, "leitendeA");
  await macheWebmaster(db, welt.testabteilungId, konten.ohneFaktor.id!);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const anfrage = (
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
    body: body ? JSON.stringify(body) : undefined,
  });

const dokument = {
  v: 1,
  titel: "Titel",
  bausteine: [
    { id: randomUUID(), typ: "ueberschrift", daten: { ebene: 2, text: "Hi" } },
  ],
};
// Eine Seite direkt in der Datenbank; ohne tagId gehört sie keiner Stufe
async function neueSeite(
  tagId: string | null = null,
  mitEntwurf = false,
  abteilungId = welt.testabteilungId,
) {
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId,
      adresse: `s-${randomUUID().slice(0, 12)}`,
      titel: "Seite",
      sichtbarkeit: "angemeldet",
      tagId,
      ...(mitEntwurf ? { entwurf: dokument } : {}),
    })
    .returning({ id: schema.seite.id });
  return z.id;
}
// Die Stufenseite A (je Stufe gibt es nur eine): Jede Zelle der Matrix setzt sie auf «Entwurf da, nicht veröffentlicht» zurück
async function stufenseiteFrisch() {
  await db
    .update(schema.seite)
    .set({ entwurf: dokument, veroeffentlichteVersionId: null })
    .where(eq(schema.seite.id, stufenseite));
  return stufenseite;
}
async function neuesMedium() {
  const [z] = await db
    .insert(schema.medium)
    .values({
      abteilungId: welt.testabteilungId,
      mimeTyp: "image/png",
      groesse: 10,
      breite: 10,
      hoehe: 10,
      altText: "Test",
      dekorativ: false,
      sichtbarkeit: "angemeldet",
      speicherSchluessel: randomUUID(),
    })
    .returning({ id: schema.medium.id });
  return z.id;
}
async function neueWeiterleitung() {
  const [z] = await db
    .insert(schema.weiterleitung)
    .values({
      abteilungId: welt.testabteilungId,
      alterPfad: `/alt-${randomUUID().slice(0, 8)}`,
      zielPfad: "/neu",
      status: 301,
    })
    .returning({ id: schema.weiterleitung.id });
  return z.id;
}

type Frage = { methode: string; pfad: string; body?: unknown };
type Zeile = {
  name: string;
  // Baut die Anfrage frisch (eigene Seite, eigenes Medium): Jede Zelle der Matrix ändert nur ihre eigenen Daten
  baue: () => Promise<Frage>;
  // Erwarteter Status je Person; was fehlt, ist 403
  erwartet: Record<string, number>;
};

// Wer bei fast allen Zeilen nie etwas darf, steht nur dort, wo er etwas darf
const FREMD = { demoAdmin: 404, demoWebmaster: 404 };
const ZEILEN: Zeile[] = [
  {
    name: "GET /seiten (Tür der Verwaltung)",
    baue: async () => ({ methode: "GET", pfad: `${R}/seiten` }),
    erwartet: {
      admin: 200,
      slA: 200,
      slB: 200,
      voll: 200,
      nurSeitenBearbeiten: 200,
      nurVeroeffentlichen: 200,
      nurAnlegen: 200,
      nurMedien: 200,
      nurWeiterleitungen: 200,
      nurVorlagen: 200,
      anlegenUndVorlagen: 200,
      // Der Wartungsmodus öffnet die Verwaltung nicht
      nurWartung: 403,
      demoAdmin: 200,
      demoWebmaster: 200,
      eltern: 403,
      ohneFaktor: 403,
    },
  },
  {
    name: "GET /seiten/:id (Stufenseite A)",
    baue: async () => ({
      methode: "GET",
      pfad: `${R}/seiten/${await stufenseiteFrisch()}`,
    }),
    erwartet: {
      admin: 200,
      slA: 200,
      voll: 200,
      nurSeitenBearbeiten: 200,
      ...FREMD,
    },
  },
  {
    name: "PATCH /seiten/:id (Titel, Stufenseite A)",
    baue: async () => ({
      methode: "PATCH",
      pfad: `${R}/seiten/${await stufenseiteFrisch()}`,
      body: { titel: "Neu" },
    }),
    erwartet: {
      admin: 204,
      slA: 204,
      voll: 204,
      nurSeitenBearbeiten: 204,
      ...FREMD,
    },
  },
  {
    name: "PATCH /seiten/:id (auf die oberste Ebene setzen)",
    baue: async () => {
      const eltern = await neueSeite();
      const [kind] = await db
        .insert(schema.seite)
        .values({
          abteilungId: welt.testabteilungId,
          elternId: eltern,
          adresse: `k-${randomUUID().slice(0, 8)}`,
          titel: "Kind",
          sichtbarkeit: "angemeldet",
          tagId: null,
        })
        .returning({ id: schema.seite.id });
      return {
        methode: "PATCH",
        pfad: `${R}/seiten/${kind.id}`,
        body: { elternId: null },
      };
    },
    // Die oberste Ebene setzt nur, wer Seiten anlegen darf; die Stufenleitung nicht
    erwartet: { admin: 204, voll: 204, ...FREMD },
  },
  {
    name: "GET /seiten/:id/entwurf",
    baue: async () => ({
      methode: "GET",
      pfad: `${R}/seiten/${await stufenseiteFrisch()}/entwurf`,
    }),
    erwartet: {
      admin: 200,
      slA: 200,
      voll: 200,
      nurSeitenBearbeiten: 200,
      ...FREMD,
    },
  },
  {
    name: "POST /seiten/:id/veroeffentlichen",
    baue: async () => ({
      methode: "POST",
      pfad: `${R}/seiten/${await stufenseiteFrisch()}/veroeffentlichen`,
    }),
    // «Seiten bearbeiten» allein genügt nicht, «Seiten veröffentlichen» allein schon
    erwartet: {
      admin: 201,
      slA: 201,
      voll: 201,
      nurVeroeffentlichen: 201,
      ...FREMD,
    },
  },
  {
    name: "POST /seiten/:id/zurueckziehen (nichts veröffentlicht: 409 heisst, das Recht war da)",
    baue: async () => ({
      methode: "POST",
      pfad: `${R}/seiten/${await stufenseiteFrisch()}/zurueckziehen`,
    }),
    erwartet: {
      admin: 409,
      slA: 409,
      voll: 409,
      nurVeroeffentlichen: 409,
      ...FREMD,
    },
  },
  {
    name: "POST /seiten (anlegen)",
    baue: async () => ({
      methode: "POST",
      pfad: `${R}/seiten`,
      body: {
        adresse: `n-${randomUUID().slice(0, 8)}`,
        titel: "Neu",
        sichtbarkeit: { art: "angemeldet" },
      },
    }),
    erwartet: {
      admin: 201,
      voll: 201,
      nurAnlegen: 201,
      anlegenUndVorlagen: 201,
      // Seiten der eigenen Abteilung: Die Rolle der Fremdabteilung gilt dort
      demoAdmin: 201,
      demoWebmaster: 201,
    },
  },
  {
    name: "DELETE /seiten/:id",
    baue: async () => ({
      methode: "DELETE",
      pfad: `${R}/seiten/${await neueSeite()}`,
    }),
    erwartet: {
      admin: 204,
      voll: 204,
      nurAnlegen: 204,
      anlegenUndVorlagen: 204,
      ...FREMD,
    },
  },
  {
    name: "GET /medien",
    baue: async () => ({ methode: "GET", pfad: `${R}/medien` }),
    erwartet: {
      admin: 200,
      slA: 200,
      slB: 200,
      voll: 200,
      nurSeitenBearbeiten: 200,
      nurVeroeffentlichen: 200,
      nurAnlegen: 200,
      nurMedien: 200,
      nurWeiterleitungen: 200,
      nurVorlagen: 200,
      anlegenUndVorlagen: 200,
      demoAdmin: 200,
      demoWebmaster: 200,
      ohneFaktor: 403,
    },
  },
  {
    name: "PATCH /medien/:id (ein fremdes Medium beschreiben)",
    baue: async () => ({
      methode: "PATCH",
      pfad: `${R}/medien/${await neuesMedium()}`,
      body: { altText: "Neuer Text" },
    }),
    erwartet: { admin: 200, voll: 200, nurMedien: 200, ...FREMD },
  },
  {
    name: "DELETE /medien/:id",
    baue: async () => ({
      methode: "DELETE",
      pfad: `${R}/medien/${await neuesMedium()}`,
    }),
    erwartet: { admin: 204, voll: 204, nurMedien: 204, ...FREMD },
  },
  {
    name: "GET /weiterleitungen",
    baue: async () => ({ methode: "GET", pfad: `${R}/weiterleitungen` }),
    erwartet: {
      admin: 200,
      voll: 200,
      nurWeiterleitungen: 200,
      demoAdmin: 200,
      demoWebmaster: 200,
    },
  },
  {
    name: "POST /weiterleitungen",
    baue: async () => ({
      methode: "POST",
      pfad: `${R}/weiterleitungen`,
      body: { alterPfad: `/alt-${randomUUID().slice(0, 8)}`, zielPfad: "/neu" },
    }),
    erwartet: {
      admin: 201,
      voll: 201,
      nurWeiterleitungen: 201,
      demoAdmin: 201,
      demoWebmaster: 201,
    },
  },
  {
    name: "DELETE /weiterleitungen/:id",
    baue: async () => ({
      methode: "DELETE",
      pfad: `${R}/weiterleitungen/${await neueWeiterleitung()}`,
    }),
    erwartet: { admin: 204, voll: 204, nurWeiterleitungen: 204, ...FREMD },
  },
  {
    name: "GET /vorlagen",
    baue: async () => ({ methode: "GET", pfad: `${R}/vorlagen` }),
    erwartet: {
      admin: 200,
      voll: 200,
      nurVorlagen: 200,
      anlegenUndVorlagen: 200,
      demoAdmin: 200,
      demoWebmaster: 200,
    },
  },
  {
    name: "POST /seiten/aus-vorlage (beide Rechte nötig)",
    baue: async () => ({
      methode: "POST",
      pfad: `${R}/seiten/aus-vorlage`,
      body: {
        vorlage: "textseite",
        titel: "Aus Vorlage",
        sichtbarkeit: { art: "angemeldet" },
      },
    }),
    erwartet: {
      admin: 201,
      voll: 201,
      anlegenUndVorlagen: 201,
      demoAdmin: 201,
      demoWebmaster: 201,
    },
  },
  {
    name: "GET /stufen/:stufeId/eckdaten (Stufe A)",
    baue: async () => ({
      methode: "GET",
      pfad: `${R}/stufen/${welt.stufeAId}/eckdaten`,
    }),
    erwartet: {
      admin: 200,
      slA: 200,
      voll: 200,
      nurSeitenBearbeiten: 200,
      ...FREMD,
    },
  },
  {
    name: "GET /tags (Auswahl für den Editor)",
    baue: async () => ({ methode: "GET", pfad: `${R}/tags` }),
    erwartet: {
      admin: 200,
      slA: 200,
      slB: 200,
      voll: 200,
      nurSeitenBearbeiten: 200,
      nurVeroeffentlichen: 200,
      nurAnlegen: 200,
      nurMedien: 200,
      nurWeiterleitungen: 200,
      nurVorlagen: 200,
      anlegenUndVorlagen: 200,
      demoAdmin: 200,
      demoWebmaster: 200,
    },
  },
];

const PERSONEN = [
  "admin",
  "slA",
  "slB",
  "voll",
  ...Object.keys(EINGESCHRAENKT),
  "demoAdmin",
  "demoWebmaster",
  "eltern",
  "ohneFaktor",
];

describe("Rechte-Matrix der Website-Verwaltung", () => {
  for (const zeile of ZEILEN) {
    test.each(PERSONEN)(`${zeile.name}: %s`, async (name) => {
      const frage = await zeile.baue();
      const antwort = await anfrage(
        konten[name],
        frage.methode,
        frage.pfad,
        frage.body,
      );
      expect(antwort.status, await antwort.clone().text()).toBe(
        zeile.erwartet[name] ?? 403,
      );
    });
  }

  test("ohne zweiten Faktor sagt jeder erweiterte Weg 403 ZWEITER_FAKTOR_FEHLT, die Stufenleitung arbeitet ohne", async () => {
    const antwort = await anfrage(konten.ohneFaktor, "GET", `${R}/seiten`);
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { code: string }).code).toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
    expect(
      (
        await anfrage(
          konten.slA,
          "GET",
          `${R}/seiten/${await stufenseiteFrisch()}`,
        )
      ).status,
    ).toBe(200);
  });

  test("ohne Recht oder mit einer Rolle ohne Bereich bleibt es beim 403 der Route (KEINE_BERECHTIGUNG)", async () => {
    for (const name of ["eltern", "nurWartung"]) {
      const antwort = await anfrage(konten[name], "GET", `${R}/seiten`);
      expect(antwort.status).toBe(403);
      expect(((await antwort.json()) as { code: string }).code).toBe(
        "KEINE_BERECHTIGUNG",
      );
    }
  });
});

describe("Listen und Panel", () => {
  const ids = async (konto: PersonaKonto) =>
    (
      (await (await anfrage(konto, "GET", `${R}/seiten`)).json()) as {
        seiten: { id: string }[];
      }
    ).seiten.map((s) => s.id);

  test("Die Liste der Seiten folgt dem Recht «Seiten bearbeiten»", async () => {
    const freie = await neueSeite();
    const fremde = await neueSeite(null, false, welt.demoAbteilungId);
    for (const name of ["admin", "voll", "nurSeitenBearbeiten"]) {
      const liste = await ids(konten[name]);
      expect(liste, name).toEqual(expect.arrayContaining([stufenseite, freie]));
      expect(liste, name).not.toContain(fremde);
    }
    // Die Stufenleitung sieht nur die Seite der eigenen Stufe, die übrigen Rollen keine
    const sl = await ids(konten.slA);
    expect(sl).toContain(stufenseite);
    expect(sl).not.toContain(freie);
    for (const name of ["nurVeroeffentlichen", "nurMedien", "nurAnlegen"]) {
      expect(await ids(konten[name]), name).toEqual([]);
    }
    // Die Rolle der Fremdabteilung sieht nichts in dieser Abteilung
    expect(await ids(konten.demoWebmaster)).not.toContain(freie);
  });

  test("Ein Sonderrecht auf eine Seite bleibt neben der Rolle bestehen", async () => {
    const seite = await neueSeite();
    const andere = await neueSeite();
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: seite,
      userId: konten.nurMedien.id!,
    });
    expect(await ids(konten.nurMedien)).toEqual([seite]);
    expect(
      (await anfrage(konten.nurMedien, "GET", `${R}/seiten/${seite}`)).status,
    ).toBe(200);
    expect(
      (await anfrage(konten.nurMedien, "GET", `${R}/seiten/${andere}`)).status,
    ).toBe(403);
  });

  test("GET /ich nennt die Plattformrechte der Person", async () => {
    const ich = async (name: string) =>
      (await (await anfrage(konten[name], "GET", `${R}/ich`)).json()) as {
        redigieren: boolean;
        bereiche: string[];
        verwalten: boolean;
        rechte: string[];
      };
    expect(await ich("voll")).toMatchObject({
      redigieren: true,
      verwalten: true,
      rechte: [
        "medien.verwalten",
        "seiten.anlegen_loeschen",
        "seiten.bearbeiten",
        "seiten.veroeffentlichen",
        "vorlagen.nutzen",
        "weiterleitungen.verwalten",
      ],
    });
    expect(await ich("nurMedien")).toMatchObject({
      redigieren: true,
      verwalten: false,
      rechte: ["medien.verwalten"],
    });
    // Der Wartungsmodus öffnet nur den Bereich «plattform», nicht die Website-Verwaltung
    expect(await ich("nurWartung")).toMatchObject({
      redigieren: false,
      bereiche: ["plattform"],
      rechte: ["wartungsmodus.website"],
    });
    // Stufenleitung: Zugang, aber keine Plattformrechte
    expect(await ich("slA")).toMatchObject({
      redigieren: true,
      verwalten: false,
      rechte: [],
    });
    expect((await ich("admin")).rechte).toContain("wartungsmodus.website");
  });
});

describe("Datenbanklast der Rechteprüfung", () => {
  const person = (konto: PersonaKonto): Person => ({
    id: konto.id!,
    abteilungId: konto.abteilungId!,
    admin: false,
    zweiterFaktor: true,
    rollen: [],
  });

  test("Tür, Recht am Objekt und Listenfilter kosten je eine Abfrage, die Rolle keine zusätzliche", async () => {
    abfragen.length = 0;
    expect(await hatWebsiteZugang(zaehlDb, person(konten.voll))).toBe(true);
    expect(abfragen).toHaveLength(1);

    abfragen.length = 0;
    expect(
      await darfBearbeiten(zaehlDb, person(konten.voll), "seite", randomUUID()),
    ).toBe(true);
    expect(abfragen).toHaveLength(1);
    abfragen.length = 0;
    expect(
      await darfBearbeiten(
        zaehlDb,
        person(konten.voll),
        "seite",
        randomUUID(),
        {
          veroeffentlichen: true,
        },
      ),
    ).toBe(true);
    expect(abfragen).toHaveLength(1);

    // Der Listenfilter ist Teil der Abfrage der Liste: Er löst keine eigene aus
    abfragen.length = 0;
    const zeilen = await zaehlDb
      .select({ id: schema.seite.id })
      .from(schema.seite)
      .where(
        bearbeitbar(person(konten.voll), "seite", {
          id: schema.seite.id,
          abteilungId: schema.seite.abteilungId,
          stufeId: schema.seite.tagId,
          tagId: schema.seite.tagId,
        }),
      );
    expect(zeilen.length).toBeGreaterThan(0);
    expect(abfragen).toHaveLength(1);
  });
});
