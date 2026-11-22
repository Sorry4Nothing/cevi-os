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
import type { Medienspeicher } from "../src/medien-speicher.js";
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
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { macheWebmaster } from "./hilfen/webmaster.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt S3: Das Löschen eines Mediums braucht einen Speicher
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

const BASIS = "/api/v1/redaktion/seiten";

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let demoEltern: PersonaKonto;
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
  body?: unknown,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

type Sicht = "oeffentlich" | "angemeldet";
// Eine Seite direkt in der Datenbank: schneller als über die API, die #348 testet
async function neueSeite(
  sichtbarkeit: Sicht = "angemeldet",
  tagId: string | null = null,
  abteilungId = welt.testabteilungId,
) {
  const [z] = await db
    .insert(schema.seite)
    .values({
      abteilungId,
      adresse: `s-${randomUUID().slice(0, 12)}`,
      titel: "Seite",
      sichtbarkeit,
      tagId,
    })
    .returning({ id: schema.seite.id });
  return z.id;
}

// Ein Medium direkt in der Datenbank (die Upload-Route testet #338)
async function neuesMedium(
  sichtbarkeit: Sicht,
  art: "bild" | "pdf" = "bild",
  abteilungId = welt.testabteilungId,
) {
  const pdf = art === "pdf";
  const [z] = await db
    .insert(schema.medium)
    .values({
      abteilungId,
      mimeTyp: pdf ? "application/pdf" : "image/png",
      groesse: 10,
      breite: pdf ? null : 10,
      hoehe: pdf ? null : 10,
      altText: pdf ? null : "Test",
      dekorativ: false,
      sichtbarkeit,
      speicherSchluessel: randomUUID(),
    })
    .returning({ id: schema.medium.id });
  return z.id;
}

const baustein = (
  typ: string,
  daten: Record<string, unknown>,
  sichtbarkeit?: unknown,
) => ({
  id: randomUUID(),
  typ,
  daten,
  ...(sichtbarkeit ? { sichtbarkeit } : {}),
});
const ueberschrift = (text = "Hallo") =>
  baustein("ueberschrift", { ebene: 2, text });
const dokument = (...bausteine: object[]) => ({
  v: 1,
  titel: "Titel",
  bausteine: bausteine.length ? bausteine : [ueberschrift()],
});

// Speichert und prüft den Status
async function speichere(
  konto: PersonaKonto,
  id: string,
  doc: object,
  zaehler: number,
  erwartet = 200,
) {
  const antwort = await anfrage(konto, "PUT", `${BASIS}/${id}/entwurf`, {
    zaehler,
    dokument: doc,
  });
  expect(antwort.status, JSON.stringify(await antwort.clone().json())).toBe(
    erwartet,
  );
  return antwort;
}
const veroeffentliche = (konto: PersonaKonto, id: string) =>
  anfrage(konto, "POST", `${BASIS}/${id}/veroeffentlichen`);
const code = async (antwort: Response) =>
  ((await antwort.json()) as { code: string }).code;

const versionen = (seiteId: string) =>
  db
    .select()
    .from(schema.seiteVersion)
    .where(eq(schema.seiteVersion.seiteId, seiteId))
    .orderBy(schema.seiteVersion.nr);

let stufeSeite: string;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
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
    legePersonaMitFaktorAn(welt, "leitendeA"),
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "elternA"),
  ]);
  // Webmaster = Plattformrolle mit allen Rechten ausser dem Wartungsmodus
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
  // Die Seite der Stufe A
  stufeSeite = await neueSeite("angemeldet", welt.stufeAId);
});

describe("Entwurf speichern", () => {
  test("eine neue Seite hat keinen Entwurf; Speichern zählt hoch und liefert den Stand", async () => {
    const id = await neueSeite();
    const leer = await anfrage(admin, "GET", `${BASIS}/${id}/entwurf`);
    expect(leer.status).toBe(200);
    expect(await leer.json()).toEqual({
      zaehler: 0,
      dokument: null,
      veroeffentlichteNr: null,
      unveroeffentlicht: false,
    });

    const doc = dokument(ueberschrift("Willkommen"));
    const antwort = await speichere(admin, id, doc, 0);
    expect(await antwort.json()).toEqual({ zaehler: 1 });
    const jetzt = await (
      await anfrage(admin, "GET", `${BASIS}/${id}/entwurf`)
    ).json();
    expect(jetzt).toMatchObject({
      zaehler: 1,
      dokument: { v: 1, titel: "Titel" },
      unveroeffentlicht: true,
    });
  });

  test("veralteter Zähler: 409 KONFLIKT mit dem aktuellen Stand, der Entwurf bleibt", async () => {
    const id = await neueSeite();
    await speichere(admin, id, dokument(ueberschrift("Erster")), 0);
    const konflikt = await speichere(
      webmaster,
      id,
      dokument(ueberschrift("Zweiter")),
      0,
      409,
    );
    const body = (await konflikt.json()) as {
      code: string;
      zaehler: number;
      dokument: { bausteine: { daten: { text: string } }[] };
    };
    expect(body.code).toBe("KONFLIKT");
    expect(body.zaehler).toBe(1);
    expect(body.dokument.bausteine[0].daten.text).toBe("Erster");
    const [z] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, id));
    expect(z.entwurfZaehler).toBe(1);
  });

  test("zwei gleichzeitige Speicherungen mit demselben Zähler: genau eine gewinnt", async () => {
    const id = await neueSeite();
    const status = await Promise.all(
      [admin, webmaster].map(async (k) => {
        const a = await anfrage(k, "PUT", `${BASIS}/${id}/entwurf`, {
          zaehler: 0,
          dokument: dokument(),
        });
        return a.status;
      }),
    );
    expect(status.sort()).toEqual([200, 409]);
  });

  test("ein ungültiges Dokument: 400 mit Pfad und Code, ohne Eingabe; nichts gespeichert", async () => {
    const id = await neueSeite();
    const geheim = "GEHEIMER-TEXT-12345";
    const antwort = await anfrage(admin, "PUT", `${BASIS}/${id}/entwurf`, {
      zaehler: 0,
      dokument: {
        v: 1,
        titel: "T",
        bausteine: [
          { ...ueberschrift(geheim), daten: { ebene: 9, text: geheim } },
        ],
      },
    });
    expect(antwort.status).toBe(400);
    const text = await antwort.text();
    expect(text).not.toContain(geheim);
    const body = JSON.parse(text) as {
      code: string;
      fehler: { pfad: string; code: string }[];
    };
    expect(body.code).toBe("DOKUMENT_UNGUELTIG");
    expect(body.fehler[0].pfad).toContain("bausteine.0");
    const [z] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, id));
    expect(z.entwurf).toBeNull();
    expect(z.entwurfZaehler).toBe(0);
  });

  test("Felder ausser zaehler und dokument sind 400, ebenso ein Zähler unter 0", async () => {
    const id = await neueSeite();
    for (const body of [
      { zaehler: 0, dokument: dokument(), extra: 1 },
      { zaehler: -1, dokument: dokument() },
      { zaehler: 1.5, dokument: dokument() },
    ]) {
      expect(
        (await anfrage(admin, "PUT", `${BASIS}/${id}/entwurf`, body)).status,
      ).toBe(400);
    }
  });

  test("Body-Limit: über 64 KiB bis 512 KiB gehen, darüber 413", async () => {
    const id = await neueSeite();
    const absatz = (n: number) => ({
      typ: "absatz",
      inhalt: Array.from({ length: 10 }, () => ({ text: "x".repeat(n) })),
    });
    // Fünf Textbausteine zu 20 000 Zeichen: gut 100 KB
    const gross = dokument(
      ...Array.from({ length: 5 }, () =>
        baustein("text", { inhalt: [absatz(2000)] }),
      ),
    );
    expect(JSON.stringify(gross).length).toBeGreaterThan(64 * 1024);
    await speichere(admin, id, gross, 0);

    const zuGross = await anfrage(admin, "PUT", `${BASIS}/${id}/entwurf`, {
      zaehler: 1,
      dokument: dokument(),
      fuellung: "x".repeat(513 * 1024),
    });
    expect(zuGross.status).toBe(413);
    expect(await code(zuGross)).toBe("ZU_GROSS");
  });

  test("Speichern ist nicht im Audit-Log; Veröffentlichen, Zurückholen, Zurückziehen ohne Inhalt", async () => {
    const id = await neueSeite();
    const geheim = "NUR-IM-ENTWURF-777";
    await speichere(admin, id, dokument(ueberschrift(geheim)), 0);
    expect((await veroeffentliche(admin, id)).status).toBe(201);
    expect(
      (await anfrage(admin, "POST", `${BASIS}/${id}/versionen/1/zurueckholen`))
        .status,
    ).toBe(200);
    expect(
      (await anfrage(admin, "POST", `${BASIS}/${id}/zurueckziehen`)).status,
    ).toBe(204);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([
      "seite_veroeffentlicht",
      "seite_zurueckgeholt",
      "seite_zurueckgezogen",
    ]);
    expect(JSON.stringify(zeilen)).not.toContain(geheim);
    expect(
      zeilen.find((z) => z.aktion === "seite_veroeffentlicht")?.details,
    ).toEqual({ nr: 1 });
  });

  test("Rate-Limit je Person: nach 120 Speicherungen in der Minute 429", async () => {
    const id = await neueSeite();
    const person = await legePersonaAn(welt, "admin");
    let letzte = 0;
    // Veralteter Zähler genügt: Auch ein 409 zählt
    for (let i = 0; i < 121; i++) {
      letzte = (
        await anfrage(person, "PUT", `${BASIS}/${id}/entwurf`, {
          zaehler: 99,
          dokument: dokument(),
        })
      ).status;
    }
    expect(letzte).toBe(429);
    // Eine andere Person ist nicht betroffen
    await speichere(admin, id, dokument(), 0);
  }, 60_000);
});

describe("Verweisprüfung", () => {
  const sichtbar = (art: Sicht) => ({ art });

  test("Medium der eigenen Abteilung: gültig; fremdes und unbekanntes sind gleich 422 MEDIUM_UNBEKANNT", async () => {
    const id = await neueSeite();
    const eigenes = await neuesMedium("oeffentlich");
    const fremdes = await neuesMedium(
      "oeffentlich",
      "bild",
      welt.demoAbteilungId,
    );
    await speichere(
      admin,
      id,
      dokument(baustein("bild", { mediumId: eigenes })),
      0,
    );
    for (const mediumId of [fremdes, randomUUID()]) {
      const antwort = await speichere(
        admin,
        id,
        dokument(baustein("bild", { mediumId })),
        1,
        422,
      );
      const body = (await antwort.json()) as {
        code: string;
        fehler: { pfad: string; code: string }[];
      };
      expect(body.code).toBe("MEDIUM_UNBEKANNT");
      expect(body.fehler).toEqual([
        { pfad: "bausteine.0", code: "MEDIUM_UNBEKANNT" },
      ]);
    }
  });

  test("in einer öffentlichen Seite nur öffentliche Medien: 422 MEDIUM_NICHT_OEFFENTLICH", async () => {
    const oeffentlich = await neueSeite("oeffentlich");
    const intern = await neuesMedium("angemeldet");
    const antwort = await speichere(
      admin,
      oeffentlich,
      dokument(
        ueberschrift(),
        baustein("galerie", { bilder: [{ mediumId: intern }] }),
      ),
      0,
      422,
    );
    const body = (await antwort.json()) as {
      code: string;
      fehler: { pfad: string }[];
    };
    expect(body.code).toBe("MEDIUM_NICHT_OEFFENTLICH");
    // Der Pfad nennt den Baustein
    expect(body.fehler[0].pfad).toBe("bausteine.1");
  });

  test("Sichtbarkeit des Bausteins zählt: «erbt» wie die Seite, eigener Wert gewinnt", async () => {
    const intern = await neuesMedium("angemeldet");
    const oeffentlich = await neueSeite("oeffentlich");
    const angemeldet = await neueSeite("angemeldet");
    // Baustein nur für Angemeldete auf einer öffentlichen Seite: das interne Bild darf
    await speichere(
      admin,
      oeffentlich,
      dokument(baustein("bild", { mediumId: intern }, sichtbar("angemeldet"))),
      0,
    );
    // Baustein «öffentlich» auf einer angemeldeten Seite: das interne Bild nicht
    const antwort = await speichere(
      admin,
      angemeldet,
      dokument(baustein("bild", { mediumId: intern }, sichtbar("oeffentlich"))),
      0,
      422,
    );
    expect(await code(antwort)).toBe("MEDIUM_NICHT_OEFFENTLICH");
    // Ohne eigenen Wert erbt der Baustein «angemeldet»: erlaubt
    await speichere(
      admin,
      angemeldet,
      dokument(baustein("bild", { mediumId: intern })),
      0,
    );
  });

  test("ein altes PDF-Medium ist kein Bild; eine Datei verweist auf keinen Mediumseintrag mehr (#428)", async () => {
    const id = await neueSeite();
    const pdf = await neuesMedium("angemeldet", "pdf");
    const antwort = await speichere(
      admin,
      id,
      dokument(baustein("bild", { mediumId: pdf })),
      0,
      422,
    );
    expect(await code(antwort)).toBe("MEDIUM_FORMAT");
    // Das alte Schema der Datei (Verweis auf ein Medium) ist ungültig
    await speichere(
      admin,
      id,
      dokument(baustein("datei", { mediumId: pdf })),
      0,
      400,
    );
    // Eine Datei ist ein Link: ohne Medium, ohne Verweisprüfung, auch auf einer öffentlichen Seite
    await speichere(
      admin,
      id,
      dokument(
        baustein("datei", {
          titel: "Packliste",
          link: "https://cevi.sharepoint.com/sites/lager/packliste.pdf",
        }),
      ),
      0,
    );
  });

  test("Tag, Person und Seite müssen zur Abteilung gehören und bestehen", async () => {
    const id = await neueSeite();
    const [fremderTag] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.demoAbteilungId,
        typ: "team",
        name: `Fremd ${randomUUID()}`,
        kuerzel: "F",
      })
      .returning({ id: schema.tag.id });
    const faelle: [object, string][] = [
      [baustein("leitungsteam", { tagId: fremderTag.id }), "TAG_UNBEKANNT"],
      [baustein("leitungsteam", { tagId: randomUUID() }), "TAG_UNBEKANNT"],
      [
        baustein(
          "ueberschrift",
          { ebene: 2, text: "x" },
          {
            art: "tags",
            tagIds: [fremderTag.id],
          },
        ),
        "TAG_UNBEKANNT",
      ],
      [
        baustein("kontaktperson", { personId: demoAdmin.id }),
        "PERSON_UNBEKANNT",
      ],
      [
        baustein("schaltflaeche", {
          darstellung: "link",
          beschriftung: "Weg",
          ziel: "/gibt/es/nicht",
        }),
        "SEITE_UNBEKANNT",
      ],
    ];
    for (const [b, erwartet] of faelle) {
      const antwort = await speichere(admin, id, dokument(b), 0, 422);
      expect(await code(antwort)).toBe(erwartet);
    }
    // Gültig: eigener Tag, eigene Person, Link auf eine bestehende Seite (mit Anker), Startseite
    const [eigenerTag] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Eigen ${randomUUID()}`,
        kuerzel: "E",
      })
      .returning({ id: schema.tag.id });
    const ziel = await neueSeite();
    const [{ adresse }] = await db
      .select({ adresse: schema.seite.adresse })
      .from(schema.seite)
      .where(eq(schema.seite.id, ziel));
    await speichere(
      admin,
      id,
      dokument(
        baustein("leitungsteam", { tagId: eigenerTag.id }),
        baustein("kontaktperson", { personId: slA.id }),
        baustein("schaltflaeche", {
          darstellung: "link",
          beschriftung: "Hin",
          ziel: `/${adresse}#abschnitt`,
        }),
        baustein("schaltflaeche", {
          darstellung: "link",
          beschriftung: "Start",
          ziel: "/",
        }),
      ),
      0,
    );
  });

  test("Veröffentlichen prüft noch einmal: Wird die Seite öffentlich, scheitert das interne Bild", async () => {
    const id = await neueSeite("angemeldet");
    const intern = await neuesMedium("angemeldet");
    await speichere(
      admin,
      id,
      dokument(baustein("bild", { mediumId: intern })),
      0,
    );
    await db
      .update(schema.seite)
      .set({ sichtbarkeit: "oeffentlich" })
      .where(eq(schema.seite.id, id));
    const antwort = await veroeffentliche(admin, id);
    expect(antwort.status).toBe(422);
    expect(await code(antwort)).toBe("MEDIUM_NICHT_OEFFENTLICH");
    expect(await versionen(id)).toHaveLength(0);
  });

  test("Medium löschen: 409 MEDIUM_VERWENDET mit der Zahl der Seiten (Entwurf oder Version), danach frei", async () => {
    const medium = await neuesMedium("oeffentlich");
    const a = await neueSeite();
    const b = await neueSeite();
    await speichere(
      admin,
      a,
      dokument(baustein("bild", { mediumId: medium })),
      0,
    );
    await speichere(
      admin,
      b,
      dokument(baustein("bild", { mediumId: medium })),
      0,
    );
    expect((await veroeffentliche(admin, b)).status).toBe(201);

    const url = `/api/v1/admin/medien/${medium}`;
    const verwendet = await anfrage(admin, "DELETE", url);
    expect(verwendet.status).toBe(409);
    expect(await verwendet.json()).toMatchObject({
      code: "MEDIUM_VERWENDET",
      seiten: 2,
    });
    // Seite a ändert den Entwurf; b steht noch in der Version, also bleibt das Medium
    await speichere(admin, a, dokument(), 1);
    await speichere(admin, b, dokument(), 1);
    const nurVersion = await anfrage(admin, "DELETE", url);
    expect(nurVersion.status).toBe(409);
    expect(await nurVersion.json()).toMatchObject({ seiten: 1 });
    // Auch eine zurückgezogene Version hält das Medium (sie lässt sich zurückholen)
    await anfrage(admin, "POST", `${BASIS}/${b}/zurueckziehen`);
    expect((await anfrage(admin, "DELETE", url)).status).toBe(409);
    // Erst wenn die Seite weg ist, geht es
    await db.delete(schema.seite).where(eq(schema.seite.id, b));
    expect((await anfrage(admin, "DELETE", url)).status).toBe(204);
    // Speichern mit dem gelöschten Medium: unbekannt
    await speichere(
      admin,
      a,
      dokument(baustein("bild", { mediumId: medium })),
      2,
      422,
    );
  });

  test("Medium löschen über die Webmaster: ebenfalls 409 MEDIUM_VERWENDET, danach frei", async () => {
    const medium = await neuesMedium("oeffentlich");
    const id = await neueSeite();
    await speichere(
      admin,
      id,
      dokument(baustein("bild", { mediumId: medium })),
      0,
    );
    const url = `/api/v1/redaktion/medien/${medium}`;
    const verwendet = await anfrage(admin, "DELETE", url);
    expect(verwendet.status).toBe(409);
    expect(await verwendet.json()).toMatchObject({
      code: "MEDIUM_VERWENDET",
      seiten: 1,
    });
    await speichere(admin, id, dokument(), 1);
    expect((await anfrage(admin, "DELETE", url)).status).toBe(204);
  });

  test("Medium löschen: unbekannt und fremd bleiben 404, Nicht-Admins 403", async () => {
    const medium = await neuesMedium("oeffentlich");
    const url = `/api/v1/admin/medien/${medium}`;
    expect((await anfrage(demoAdmin, "DELETE", url)).status).toBe(404);
    expect((await anfrage(slA, "DELETE", url)).status).toBe(403);
    expect(
      (await anfrage(admin, "DELETE", `/api/v1/admin/medien/${randomUUID()}`))
        .status,
    ).toBe(404);
  });
});

describe("Veröffentlichen, Versionen, Zurückholen, Zurückziehen", () => {
  test("ohne Entwurf oder bei gleichem Stand: 409 NICHTS_ZU_VEROEFFENTLICHEN, ohne Ereignis", async () => {
    const ereignisse: WebsiteEreignis[] = [];
    const abmelden = aufWebsiteEreignis((e) => void ereignisse.push(e));
    try {
      const id = await neueSeite();
      const leer = await veroeffentliche(admin, id);
      expect(leer.status).toBe(409);
      expect(await code(leer)).toBe("NICHTS_ZU_VEROEFFENTLICHEN");

      await speichere(admin, id, dokument(), 0);
      expect((await veroeffentliche(admin, id)).status).toBe(201);
      expect(await code(await veroeffentliche(admin, id))).toBe(
        "NICHTS_ZU_VEROEFFENTLICHEN",
      );
      expect(
        ereignisse.filter((e) => e.seiteId === id).map((e) => e.art),
      ).toEqual(["version_veroeffentlicht"]);
    } finally {
      abmelden();
    }
  });

  test("Versionen zählen ab 1; der Zeiger und die Liste folgen; jede Version behält ihren Inhalt", async () => {
    const id = await neueSeite();
    await speichere(admin, id, dokument(ueberschrift("Eins")), 0);
    const erste = await veroeffentliche(admin, id);
    expect(await erste.json()).toEqual({ nr: 1 });
    await speichere(admin, id, dokument(ueberschrift("Zwei")), 1);
    expect(await (await veroeffentliche(admin, id)).json()).toEqual({ nr: 2 });
    // Weiter am Entwurf arbeiten ändert keine Version
    await speichere(admin, id, dokument(ueberschrift("Drei")), 2);

    const liste = (await (
      await anfrage(admin, "GET", `${BASIS}/${id}/versionen`)
    ).json()) as {
      versionen: { nr: number; veroeffentlicht: boolean; autorId: string }[];
    };
    expect(liste.versionen.map((v) => [v.nr, v.veroeffentlicht])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(liste.versionen[0].autorId).toBe(admin.id);
    expect(JSON.stringify(liste)).not.toContain("Eins");

    const eins = (await (
      await anfrage(admin, "GET", `${BASIS}/${id}/versionen/1`)
    ).json()) as {
      nr: number;
      dokument: { bausteine: { daten: { text: string } }[] };
    };
    expect(eins.nr).toBe(1);
    expect(eins.dokument.bausteine[0].daten.text).toBe("Eins");
    expect(
      (await anfrage(admin, "GET", `${BASIS}/${id}/versionen/3`)).status,
    ).toBe(404);
    expect(
      (await anfrage(admin, "GET", `${BASIS}/${id}/versionen/0`)).status,
    ).toBe(400);
    expect(
      (await anfrage(admin, "GET", `${BASIS}/${id}/versionen/x`)).status,
    ).toBe(400);
  });

  test("zwei gleichzeitige Veröffentlichungen: genau eine Version, die zweite 409", async () => {
    const id = await neueSeite();
    await speichere(admin, id, dokument(), 0);
    const status = await Promise.all(
      [admin, webmaster].map(
        async (k) => (await veroeffentliche(k, id)).status,
      ),
    );
    expect(status.sort()).toEqual([201, 409]);
    expect((await versionen(id)).map((v) => v.nr)).toEqual([1]);
  });

  test("Zurückholen kopiert in den Entwurf, die veröffentlichte Seite und alle Versionen bleiben", async () => {
    const ereignisse: WebsiteEreignis[] = [];
    const abmelden = aufWebsiteEreignis((e) => void ereignisse.push(e));
    try {
      const id = await neueSeite();
      await speichere(admin, id, dokument(ueberschrift("Alt")), 0);
      await veroeffentliche(admin, id);
      await speichere(admin, id, dokument(ueberschrift("Neu")), 1);
      await veroeffentliche(admin, id);
      const vorher = await versionen(id);

      const antwort = await anfrage(
        admin,
        "POST",
        `${BASIS}/${id}/versionen/1/zurueckholen`,
      );
      expect(antwort.status).toBe(200);
      expect(await antwort.json()).toEqual({ zaehler: 3 });
      const entwurf = (await (
        await anfrage(admin, "GET", `${BASIS}/${id}/entwurf`)
      ).json()) as {
        dokument: { bausteine: { daten: { text: string } }[] };
        veroeffentlichteNr: number;
        unveroeffentlicht: boolean;
      };
      expect(entwurf.dokument.bausteine[0].daten.text).toBe("Alt");
      // Die Seite bleibt bei Version 2; der Entwurf weicht ab
      expect(entwurf.veroeffentlichteNr).toBe(2);
      expect(entwurf.unveroeffentlicht).toBe(true);
      expect(await versionen(id)).toEqual(vorher);
      // Kein Ereignis fürs Zurückholen: Die öffentliche Seite ändert sich nicht
      expect(
        ereignisse.filter((e) => e.seiteId === id).map((e) => e.art),
      ).toEqual(["version_veroeffentlicht", "version_veroeffentlicht"]);
      // Ein Editor mit altem Zähler wird erkannt
      await speichere(admin, id, dokument(), 2, 409);
      expect(
        (
          await anfrage(
            admin,
            "POST",
            `${BASIS}/${id}/versionen/9/zurueckholen`,
          )
        ).status,
      ).toBe(404);
      // Der zurückgeholte Stand lässt sich als neue Version veröffentlichen
      expect(await (await veroeffentliche(admin, id)).json()).toEqual({
        nr: 3,
      });
    } finally {
      abmelden();
    }
  });

  test("Zurückziehen setzt nur den Zeiger; Ereignis; zweites Mal 409; erneut veröffentlichen gibt eine neue Version", async () => {
    const ereignisse: WebsiteEreignis[] = [];
    const abmelden = aufWebsiteEreignis((e) => void ereignisse.push(e));
    try {
      const id = await neueSeite();
      await speichere(admin, id, dokument(), 0);
      await veroeffentliche(admin, id);
      const vorher = await versionen(id);

      expect(
        (await anfrage(admin, "POST", `${BASIS}/${id}/zurueckziehen`)).status,
      ).toBe(204);
      const zweites = await anfrage(
        admin,
        "POST",
        `${BASIS}/${id}/zurueckziehen`,
      );
      expect(zweites.status).toBe(409);
      expect(await code(zweites)).toBe("NICHT_VEROEFFENTLICHT");
      expect(await versionen(id)).toEqual(vorher);
      const [z] = await db
        .select()
        .from(schema.seite)
        .where(eq(schema.seite.id, id));
      expect(z.veroeffentlichteVersionId).toBeNull();
      expect(
        (
          (await (
            await anfrage(admin, "GET", `${BASIS}/${id}/versionen`)
          ).json()) as { versionen: { veroeffentlicht: boolean }[] }
        ).versionen.some((v) => v.veroeffentlicht),
      ).toBe(false);
      expect(
        ereignisse.filter((e) => e.seiteId === id).map((e) => e.art),
      ).toEqual(["version_veroeffentlicht", "version_zurueckgezogen"]);
      expect(await (await veroeffentliche(admin, id)).json()).toEqual({
        nr: 2,
      });
    } finally {
      abmelden();
    }
  });

  test("ein gespeicherter Entwurf, der das Schema nicht mehr besteht: 422 DOKUMENT_UNGUELTIG, keine Version", async () => {
    const id = await neueSeite();
    await db
      .update(schema.seite)
      .set({ entwurf: { v: 2, titel: "x" }, entwurfZaehler: 1 })
      .where(eq(schema.seite.id, id));
    const antwort = await veroeffentliche(admin, id);
    expect(antwort.status).toBe(422);
    expect(await code(antwort)).toBe("DOKUMENT_UNGUELTIG");
    expect(await versionen(id)).toHaveLength(0);
  });

  test("Versionen sind unveränderlich: kein UPDATE für die API-Rolle, keine Route ändert oder löscht eine", async () => {
    const id = await neueSeite();
    await speichere(admin, id, dokument(ueberschrift("Fest")), 0);
    await veroeffentliche(admin, id);
    const [v] = await versionen(id);
    await expect(
      db
        .update(schema.seiteVersion)
        .set({ inhalt: { v: 1, titel: "x", bausteine: [] } })
        .where(eq(schema.seiteVersion.id, v.id)),
    ).rejects.toThrow();
    // Alle Pfade, die Entwurf und Zeiger ändern, lassen die Version stehen
    await speichere(admin, id, dokument(ueberschrift("Anders")), 1);
    await anfrage(admin, "POST", `${BASIS}/${id}/versionen/1/zurueckholen`);
    await anfrage(admin, "POST", `${BASIS}/${id}/zurueckziehen`);
    expect(await versionen(id)).toEqual([v]);
    // Es gibt keine Route zum Ändern oder Löschen einer Version
    for (const methode of ["PUT", "PATCH", "DELETE"]) {
      const a = await anfrage(admin, methode, `${BASIS}/${id}/versionen/1`, {});
      expect(a.status, methode).toBe(404);
    }
    expect(await versionen(id)).toEqual([v]);
  });
});

describe("Rechte", () => {
  const routen = (id: string) =>
    [
      ["GET", `${BASIS}/${id}/entwurf`],
      ["PUT", `${BASIS}/${id}/entwurf`, { zaehler: 0, dokument: dokument() }],
      ["POST", `${BASIS}/${id}/veroeffentlichen`],
      ["POST", `${BASIS}/${id}/zurueckziehen`],
      ["GET", `${BASIS}/${id}/versionen`],
      ["GET", `${BASIS}/${id}/versionen/1`],
      ["POST", `${BASIS}/${id}/versionen/1/zurueckholen`],
    ] as const;

  test("Fremdabteilung und unbekannte Seiten sind 404, vor 403", async () => {
    for (const konto of [demoAdmin, demoEltern, admin]) {
      for (const id of [stufeSeite, randomUUID()]) {
        // Der Admin kennt die Stufenseite; nur die unbekannte ID ist für ihn 404
        if (konto === admin && id === stufeSeite) continue;
        for (const [methode, pfad, body] of routen(id)) {
          const a = await anfrage(konto, methode, pfad, body);
          expect(a.status, `${methode} ${pfad}`).toBe(404);
        }
      }
    }
  });

  test("ohne Recht 403: andere Stufe, Leitende ohne Stufenleitung, Eltern", async () => {
    for (const konto of [slB, ohneRecht, eltern]) {
      for (const [methode, pfad, body] of routen(stufeSeite)) {
        const a = await anfrage(konto, methode, pfad, body);
        expect(a.status, `${methode} ${pfad}`).toBe(403);
        expect(await code(a)).toBe("KEINE_BERECHTIGUNG");
      }
    }
  });

  test("Stufenleitung A bearbeitet und veröffentlicht nur die Seite ihrer Stufe", async () => {
    await speichere(slA, stufeSeite, dokument(ueberschrift("Von SL A")), 0);
    expect((await veroeffentliche(slA, stufeSeite)).status).toBe(201);
    expect(
      (await anfrage(slA, "POST", `${BASIS}/${stufeSeite}/zurueckziehen`))
        .status,
    ).toBe(204);
    // Eine Seite ohne Gruppe oder mit der Gruppe B bearbeitet sie nicht
    const fremd = await neueSeite("angemeldet", welt.stufeBId);
    const ohneGruppe = await neueSeite();
    for (const id of [fremd, ohneGruppe]) {
      expect(
        (
          await anfrage(slA, "PUT", `${BASIS}/${id}/entwurf`, {
            zaehler: 0,
            dokument: dokument(),
          })
        ).status,
      ).toBe(403);
    }
  });

  test("Webmaster (Recht auf alle Seiten) und ein Recht auf genau eine Seite", async () => {
    const id = await neueSeite();
    const andere = await neueSeite();
    await speichere(webmaster, id, dokument(), 0);
    const person = await legePersonaMitFaktorAn(welt, "leitendeA");
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: id,
      userId: person.id!,
    });
    await speichere(person, id, dokument(), 1);
    expect((await veroeffentliche(person, id)).status).toBe(201);
    expect(
      (await anfrage(person, "GET", `${BASIS}/${andere}/entwurf`)).status,
    ).toBe(403);
  });

  test("Admin ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT", async () => {
    const a = await anfrage(adminOhne, "GET", `${BASIS}/${stufeSeite}/entwurf`);
    expect(a.status).toBe(403);
    expect(await code(a)).toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("ein Recht ohne Auswirkung auf fremde Abteilungen: Zeile mit fremder Seiten-ID gibt kein Recht", async () => {
    const demoSeite = await neueSeite("angemeldet", null, welt.demoAbteilungId);
    const person = await legePersonaMitFaktorAn(welt, "leitendeA");
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: demoSeite,
      userId: person.id!,
    });
    expect(
      (await anfrage(person, "GET", `${BASIS}/${demoSeite}/entwurf`)).status,
    ).toBe(404);
    const [z] = await db
      .select({ n: schema.seite.entwurfZaehler })
      .from(schema.seite)
      .where(and(eq(schema.seite.id, demoSeite)));
    expect(z.n).toBe(0);
  });
});
