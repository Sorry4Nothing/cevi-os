import { randomUUID } from "node:crypto";
import { and, eq, sql as sqlTag } from "drizzle-orm";
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
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import {
  aufraeumenAb,
  erinnereAnAufraeumen,
  loescheAlteKontakte,
} from "../../src/lager/adressbuch.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

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
afterAll(async () => {
  await sql.end();
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const TAG = 24 * 60 * 60 * 1000;
const plusTage = (datum: string, tage: number) =>
  new Date(Date.parse(`${datum}T00:00:00Z`) + tage * TAG);

// Lager der Testabteilung mit den Lager-Personas als Mitglieder (Lagerleitung, Leitung, Team, Lesen)
async function legeLager(
  bis = "2027-07-24",
  status: "aktiv" | "abgeschlossen" = "aktiv",
  abteilungId = welt.testabteilungId,
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Adressbuchlager",
      von: "2027-07-10",
      bis,
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}
async function mitglieder(id: string) {
  // Die falsche Zeile der fremden Abteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: konten[persona].id!,
      rolle,
    });
  }
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) =>
        [p, await legePersonaAn(welt, KONTO_FUER[p] as Persona)] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await legeLager();
  geschlossenId = await legeLager("2027-07-24", "abgeschlossen");
  await mitglieder(lagerId);
  await mitglieder(geschlossenId);
});

// Die Bodys prüfen die Tests Feld für Feld; ein Typ je Route brächte hier nichts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
// Eigener Name je Test, damit die Listen der Tests sich nicht stören
const marke = () => `T${randomUUID().slice(0, 8)}`;

async function neu(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/adressbuch`, {
    name: "Kontakt",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    name: string;
    funktion: string | null;
    gruppe: string | null;
    telefon: string | null;
    email: string | null;
    notiz: string | null;
    behalten: boolean;
    aufraeumenAb: string | null;
  };
}
const namen = async (konto: PersonaKonto, abfrage = "", id = lagerId) => {
  const a = await anfrage(konto, "GET", `${L(id)}/adressbuch${abfrage}`);
  expect(a.status).toBe(200);
  return (a.body.kontakte as { name: string }[]).map((k) => k.name);
};
// Zeile direkt in die Datenbank (für die Läufe mit Testuhr)
async function lege(
  id: string,
  werte: Partial<typeof schema.adressbuchKontakt.$inferInsert> = {},
) {
  const [zeile] = await db
    .insert(schema.adressbuchKontakt)
    .values({ lagerId: id, name: "Direkt", lagerSeq: 0, ...werte })
    .returning({ id: schema.adressbuchKontakt.id });
  return zeile!.id;
}
const vorhanden = async (id: string) =>
  (
    await db
      .select({ id: schema.adressbuchKontakt.id })
      .from(schema.adressbuchKontakt)
      .where(eq(schema.adressbuchKontakt.id, id))
  ).length === 1;

describe("Rechte je Lager-Persona", () => {
  // Im Standard hat nur die Lagerleitung (und als solche die Abteilungsleitung) das Adressbuch; Leitung, Team und Lesen bekommen 403
  const nur = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });

  test.each(LAGER_PERSONAS)("%s: Liste lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", `${L()}/adressbuch`)).status).toBe(
      nur(200)[p],
    );
  });

  test.each(LAGER_PERSONAS)("%s: einzelnen Kontakt lesen", async (p) => {
    const k = await neu();
    expect(
      (await anfrage(konten[p], "GET", `${L()}/adressbuch/${k.id}`)).status,
    ).toBe(nur(200)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/adressbuch`, {
      name: "X",
    });
    expect(a.status).toBe(nur(201)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: ändern", async (p) => {
    const k = await neu();
    const a = await anfrage(konten[p], "PATCH", `${L()}/adressbuch/${k.id}`, {
      version: k.version,
      name: "Anders",
    });
    expect(a.status).toBe(nur(200)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: löschen", async (p) => {
    const k = await neu();
    const a = await anfrage(
      konten[p],
      "DELETE",
      `${L()}/adressbuch/${k.id}?version=${k.version}`,
    );
    expect(a.status).toBe(nur(204)[p]);
  });

  test("ein abgeschlossenes Lager ist schreibgeschützt, Lesen geht", async () => {
    const id = await lege(geschlossenId, { name: "Geschlossen" });
    for (const p of ["lagerleitung", "abteilungsleitung"] as const) {
      expect(
        (
          await anfrage(konten[p], "POST", `${L(geschlossenId)}/adressbuch`, {
            name: "X",
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await anfrage(
            konten[p],
            "PATCH",
            `${L(geschlossenId)}/adressbuch/${id}`,
            { version: 1, name: "Y" },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await anfrage(
            konten[p],
            "DELETE",
            `${L(geschlossenId)}/adressbuch/${id}?version=1`,
          )
        ).status,
      ).toBe(409);
    }
    expect(await namen(leiter(), "", geschlossenId)).toEqual(["Geschlossen"]);
    // Das Recht gilt vor dem Schreibschutz: Wer nicht lesen darf, bekommt 403, nicht 409
    expect(
      (
        await anfrage(konten.team, "POST", `${L(geschlossenId)}/adressbuch`, {
          name: "X",
        })
      ).status,
    ).toBe(403);
  });

  test("ein eingestelltes Recht gilt: die Leitung liest, schreibt aber nicht; das Team bleibt draussen", async () => {
    const id = await legeLager();
    await mitglieder(id);
    await neu({ name: "Eingestellt" }, id);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "leitung",
      recht: "adressbuch.lesen",
      erlaubt: true,
    });
    expect(await namen(konten.leitung, "", id)).toEqual(["Eingestellt"]);
    expect(
      (
        await anfrage(konten.leitung, "POST", `${L(id)}/adressbuch`, {
          name: "X",
        })
      ).status,
    ).toBe(403);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/adressbuch`)).status,
    ).toBe(403);
    // Wird das Recht wieder entzogen, sieht die Leitung nichts mehr
    await db
      .update(schema.lagerRolleRecht)
      .set({ erlaubt: false })
      .where(
        and(
          eq(schema.lagerRolleRecht.lagerId, id),
          eq(schema.lagerRolleRecht.recht, "adressbuch.lesen"),
        ),
      );
    expect(
      (await anfrage(konten.leitung, "GET", `${L(id)}/adressbuch`)).status,
    ).toBe(403);
  });
});

describe("kein Leck an Dritte", () => {
  test("Änderungsfeed: Leitung, Team und Lesen sehen weder Typ noch Zeilen-ID des Adressbuchs", async () => {
    const id = await legeLager();
    await mitglieder(id);
    const vor = (await anfrage(leiter(), "GET", `${L(id)}/aenderungen`)).body
      .seq as number;
    const k = await neu({ name: "Geheim" }, id);
    for (const p of ["leitung", "team", "lesen"] as const) {
      const typen = (await anfrage(konten[p], "GET", `${L(id)}/aenderungen`))
        .body.objekttypen as string[];
      expect(typen).not.toContain("adressbuch_kontakt");
      const feed = await anfrage(
        konten[p],
        "GET",
        `${L(id)}/aenderungen?seit=${vor}`,
      );
      expect(JSON.stringify(feed.body)).not.toContain(k.id);
    }
    // Die Lagerleitung sieht den Eintrag, aber ohne Inhalt
    const eigene = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/aenderungen?seit=${vor}`,
    );
    expect(eigene.body.eintraege).toEqual([
      expect.objectContaining({ objekttyp: "adressbuch_kontakt", id: k.id }),
    ]);
    expect(JSON.stringify(eigene.body)).not.toContain("Geheim");
  });

  test("Benachrichtigungsauflösung gibt kein Adressbuch frei", async () => {
    const k = await neu();
    const a = await anfrage(
      konten.team,
      "GET",
      `/api/v1/lager/aufloesen/lager_pinnwand/${k.id}`,
    );
    expect(a.status).toBe(404);
  });

  test("ein Kontakt eines anderen Lagers ist 404, auch mit dem Recht im eigenen", async () => {
    const anderes = await legeLager();
    await mitglieder(anderes);
    const k = await neu({ name: "Anderswo" }, anderes);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/adressbuch/${k.id}`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L()}/adressbuch/${k.id}`, {
          version: 1,
          name: "X",
        })
      ).status,
    ).toBe(404);
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/adressbuch/${k.id}?version=1`))
        .status,
    ).toBe(404);
  });

  test("Lager der Fremdabteilung: 404", async () => {
    const fremd = await legeLager("2027-07-24", "aktiv", welt.demoAbteilungId);
    expect(
      (await anfrage(leiter(), "GET", `${L(fremd)}/adressbuch`)).status,
    ).toBe(404);
  });
});

describe("Audit-Log", () => {
  const eintraege = async (aktion: string, zielId: string) =>
    db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, aktion),
          eq(schema.auditLog.zielId, zielId),
        ),
      );

  test("die Liste steht im Protokoll: Person, Ziel und Anzahl, nie ein Inhalt", async () => {
    const id = await legeLager();
    await mitglieder(id);
    await neu({ name: "Bäckerei Muster", telefon: "044 123 45 67" }, id);
    await neu({ name: "Platzwart", email: "wart@example.invalid" }, id);
    expect((await anfrage(leiter(), "GET", `${L(id)}/adressbuch`)).status).toBe(
      200,
    );
    const zeilen = await eintraege("lager_adressbuch_gelesen", id);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      akteurId: leiter().id,
      zielTyp: "lager",
      details: { anzahl: 2 },
    });
    expect(JSON.stringify(zeilen[0]!.details)).not.toMatch(
      /Bäckerei|Platzwart|044|example/,
    );
  });

  test("der Einzelabruf steht im Protokoll; ein verweigerter Zugriff nicht", async () => {
    const id = await legeLager();
    await mitglieder(id);
    const k = await neu({ name: "Einzeln" }, id);
    await anfrage(konten.team, "GET", `${L(id)}/adressbuch/${k.id}`);
    expect(await eintraege("lager_adressbuch_gelesen", k.id)).toHaveLength(0);
    await anfrage(leiter(), "GET", `${L(id)}/adressbuch/${k.id}`);
    const zeilen = await eintraege("lager_adressbuch_gelesen", k.id);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      zielTyp: "adressbuch_kontakt",
      details: { anzahl: 1 },
    });
  });
});

describe("Anlegen, Ändern, Löschen", () => {
  test("Antwort: gekürzte Texte, leere Angaben als null, Aufräumdatum aus dem Lagerende", async () => {
    const k = await neu({
      name: "  Bäckerei Muster  ",
      funktion: " Lieferant ",
      gruppe: "",
      telefon: "044 123 45 67",
      email: "backerei@example.invalid",
      notiz: "Brot bis 7 Uhr\nBestellung am Vortag",
    });
    expect(k).toMatchObject({
      name: "Bäckerei Muster",
      version: 1,
      funktion: "Lieferant",
      gruppe: null,
      telefon: "044 123 45 67",
      email: "backerei@example.invalid",
      notiz: "Brot bis 7 Uhr\nBestellung am Vortag",
      behalten: false,
      // Lagerende 2027-07-24 plus 180 Tage
      aufraeumenAb: "2028-01-20",
    });
    // Nie die ganze Zeile
    expect(Object.keys(k).sort()).toEqual(
      [
        "aufraeumenAb",
        "behalten",
        "email",
        "erstelltAm",
        "funktion",
        "gruppe",
        "id",
        "name",
        "notiz",
        "telefon",
        "version",
      ].sort(),
    );
  });

  test.each([
    ["Name leer", { name: " " }],
    ["Name zu lang", { name: "x".repeat(101) }],
    ["Steuerzeichen im Namen", { name: "A\u0000B" }],
    ["Telefon ungültig", { telefon: "abc" }],
    ["E-Mail ungültig", { email: "ohne-at" }],
    ["E-Mail mit Leerzeichen", { email: "a b@example.invalid" }],
    ["Notiz zu lang", { notiz: "x".repeat(2001) }],
    ["unbekanntes Feld", { geburtstag: "2001-01-01" }],
    ["ID von aussen", { id: randomUUID() }],
    ["Version beim Anlegen", { version: 1 }],
  ])("anlegen mit ungültiger Eingabe: %s", async (_beschreibung, werte) => {
    const a = await anfrage(leiter(), "POST", `${L()}/adressbuch`, {
      name: "Gut",
      ...werte,
    });
    expect(a.status).toBe(400);
  });

  test("ändern: nur die genannten Felder, Version steigt, behalten nimmt das Aufräumdatum weg", async () => {
    const k = await neu({ funktion: "Alt", telefon: "044 123 45 67" });
    const p = await anfrage(leiter(), "PATCH", `${L()}/adressbuch/${k.id}`, {
      version: 1,
      funktion: "Neu",
      telefon: null,
      behalten: true,
    });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({
      version: 2,
      name: "Kontakt",
      funktion: "Neu",
      telefon: null,
      behalten: true,
      aufraeumenAb: null,
    });
    // Ohne «behalten» gilt die Frist wieder
    const zurueck = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/adressbuch/${k.id}`,
      { version: 2, behalten: false },
    );
    expect(zurueck.body.aufraeumenAb).toBe("2028-01-20");
    // Leere Änderung: 400
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L()}/adressbuch/${k.id}`, {
          version: 3,
        })
      ).status,
    ).toBe(400);
  });

  test("veraltete Version: 409 VERSION_KONFLIKT mit dem aktuellen Stand und den abweichenden Feldern", async () => {
    const k = await neu({ funktion: "Eins" });
    await anfrage(leiter(), "PATCH", `${L()}/adressbuch/${k.id}`, {
      version: 1,
      funktion: "Zwei",
    });
    const a = await anfrage(leiter(), "PATCH", `${L()}/adressbuch/${k.id}`, {
      version: 1,
      funktion: "Drei",
    });
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({
      code: "VERSION_KONFLIKT",
      aktuell: { version: 2, funktion: "Zwei" },
      abweichend: ["funktion"],
    });
  });

  test("schreibt über den Sync-Kern: Feed-Einträge neu, geändert, gelöscht", async () => {
    const id = await legeLager();
    await mitglieder(id);
    const vor = (await anfrage(leiter(), "GET", `${L(id)}/aenderungen`)).body
      .seq as number;
    const k = await neu({}, id);
    await anfrage(leiter(), "PATCH", `${L(id)}/adressbuch/${k.id}`, {
      version: 1,
      name: "Zwei",
    });
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/adressbuch/${k.id}?version=2`,
        )
      ).status,
    ).toBe(204);
    const feed = (
      await anfrage(leiter(), "GET", `${L(id)}/aenderungen?seit=${vor}`)
    ).body.eintraege as { objekttyp: string; art: string }[];
    expect(feed.map((e) => [e.objekttyp, e.art])).toEqual([
      ["adressbuch_kontakt", "neu"],
      ["adressbuch_kontakt", "geaendert"],
      ["adressbuch_kontakt", "geloescht"],
    ]);
  });

  test("löschen: weg aus Liste und Einzelabruf, zweites Löschen 404, falsche Version 409", async () => {
    const k = await neu({ name: marke() });
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/adressbuch/${k.id}?version=7`))
        .status,
    ).toBe(409);
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/adressbuch/${k.id}?version=1`))
        .status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/adressbuch/${k.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(leiter(), "DELETE", `${L()}/adressbuch/${k.id}?version=2`))
        .status,
    ).toBe(404);
    expect(await namen(leiter(), `?q=${k.name}`)).toEqual([]);
  });
});

describe("Liste, Suche und Seitenwechsel", () => {
  test("alphabetisch ohne Beachtung der Gross- und Kleinschreibung, Suche in Name, Funktion und Gruppe", async () => {
    const id = await legeLager();
    await mitglieder(id);
    await neu({ name: "zimmermann", funktion: "Schreiner" }, id);
    await neu({ name: "Albrecht", gruppe: "Küche" }, id);
    await neu({ name: "Meier", funktion: "Platzwart" }, id);
    expect(await namen(leiter(), "", id)).toEqual([
      "Albrecht",
      "Meier",
      "zimmermann",
    ]);
    expect(await namen(leiter(), "?q=KÜCHE", id)).toEqual(["Albrecht"]);
    expect(await namen(leiter(), "?q=platz", id)).toEqual(["Meier"]);
    expect(await namen(leiter(), "?q=zimmer", id)).toEqual(["zimmermann"]);
    // Sonderzeichen der Suche sind kein Muster
    expect(await namen(leiter(), "?q=%25", id)).toEqual([]);
  });

  test("Seitenwechsel mit Cursor: jede Seite eine Abfrage, nichts doppelt, nichts fehlt", async () => {
    const id = await legeLager();
    await mitglieder(id);
    for (const n of ["B", "D", "A", "C", "E"]) await neu({ name: n }, id);
    const gesehen: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const a: Antwort = await anfrage(
        leiter(),
        "GET",
        `${L(id)}/adressbuch?limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      expect(a.status).toBe(200);
      gesehen.push(...a.body.kontakte.map((k: { name: string }) => k.name));
      nach = a.body.naechster;
      seiten++;
    } while (nach);
    expect(gesehen).toEqual(["A", "B", "C", "D", "E"]);
    expect(seiten).toBe(3);
    // Unbekannter Cursor: leere Seite
    const leer = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/adressbuch?nach=${randomUUID()}`,
    );
    expect(leer.body).toEqual({ kontakte: [], naechster: null });
    // Grenzen von limit
    for (const limit of [0, 201, "x"]) {
      expect(
        (await anfrage(leiter(), "GET", `${L(id)}/adressbuch?limit=${limit}`))
          .status,
      ).toBe(400);
    }
  });
});

describe("Aufräumlauf mit Testuhr", () => {
  // Lagerende 2030-06-30; der Kontakt ohne «behalten» geht am Tag 180 danach (2030-12-27)
  const BIS = "2030-06-30";
  const GRENZE = plusTage(BIS, 180);

  test("aufraeumenAb: Lagerende plus 180 Tage", () => {
    expect(aufraeumenAb(BIS)).toBe("2030-12-27");
    expect(aufraeumenAb("2028-02-29")).toBe("2028-08-27");
    expect(aufraeumenAb("2027-12-31")).toBe("2028-06-28");
  });

  test("am Tag 179 nichts, am Tag 180 ohne «behalten» weg, mit «behalten» bleibt", async () => {
    const id = await legeLager(BIS);
    const weg = await lege(id, { name: "Weg" });
    const bleibt = await lege(id, { name: "Bleibt", behalten: true });
    // Eine Sekunde vor dem Tag 180 (UTC): noch da
    expect(
      await loescheAlteKontakte(db, new Date(GRENZE.getTime() - 1000), [id]),
    ).toBe(0);
    expect(await vorhanden(weg)).toBe(true);
    // Um 00:00 Uhr des Tages 180: weg
    expect(await loescheAlteKontakte(db, GRENZE, [id])).toBe(1);
    expect(await vorhanden(weg)).toBe(false);
    expect(await vorhanden(bleibt)).toBe(true);
    // Auch viel später bleibt der markierte Kontakt, und ein zweiter Lauf findet nichts
    expect(await loescheAlteKontakte(db, plusTage(BIS, 5000), [id])).toBe(0);
    expect(await vorhanden(bleibt)).toBe(true);
  });

  test("ein Tag nach dem Ende ist nichts fällig; ein Kontakt, dessen «behalten» entfällt, geht beim nächsten Lauf", async () => {
    const id = await legeLager(BIS);
    const k = await lege(id, { behalten: true });
    expect(await loescheAlteKontakte(db, plusTage(BIS, 1), [id])).toBe(0);
    expect(await loescheAlteKontakte(db, plusTage(BIS, 400), [id])).toBe(0);
    await db
      .update(schema.adressbuchKontakt)
      .set({ behalten: false })
      .where(eq(schema.adressbuchKontakt.id, k));
    expect(await loescheAlteKontakte(db, plusTage(BIS, 400), [id])).toBe(1);
  });

  test("die Frist folgt dem Lagerende: Wird das Lager verlängert, verschiebt sich die Löschung", async () => {
    const id = await legeLager(BIS);
    const k = await lege(id);
    await db
      .update(schema.lager)
      .set({ bis: "2030-07-30" })
      .where(eq(schema.lager.id, id));
    expect(await loescheAlteKontakte(db, GRENZE, [id])).toBe(0);
    expect(await vorhanden(k)).toBe(true);
    expect(
      await loescheAlteKontakte(db, plusTage("2030-07-30", 180), [id]),
    ).toBe(1);
  });

  test("auch im abgeschlossenen Lager und mit weichgelöschten Kontakten; andere Lager bleiben unberührt", async () => {
    const id = await legeLager(BIS, "abgeschlossen");
    const anderes = await legeLager(BIS);
    const a = await lege(id, { name: "A" });
    const b = await lege(id, { name: "B", geloeschtAm: GRENZE });
    const fremd = await lege(anderes, { name: "Fremd" });
    expect(await loescheAlteKontakte(db, GRENZE, [id])).toBe(2);
    expect(await vorhanden(a)).toBe(false);
    expect(await vorhanden(b)).toBe(false);
    expect(await vorhanden(fremd)).toBe(true);
    await loescheAlteKontakte(db, GRENZE, [anderes]);
  });

  test("Papierkorb: ein gelöschter Kontakt geht nach 30 Tagen, auch mit «behalten» und lange vor der Frist", async () => {
    const id = await legeLager(BIS);
    const jetzt = plusTage(BIS, 10);
    const frisch = await lege(id, {
      name: "Frisch",
      behalten: true,
      geloeschtAm: new Date(jetzt.getTime() - 29 * TAG),
    });
    const alt = await lege(id, {
      name: "Alt",
      behalten: true,
      geloeschtAm: new Date(jetzt.getTime() - 31 * TAG),
    });
    expect(await loescheAlteKontakte(db, jetzt, [id])).toBe(1);
    expect(await vorhanden(frisch)).toBe(true);
    expect(await vorhanden(alt)).toBe(false);
  });

  test("Audit-Eintrag mit der Anzahl und ohne Inhalte; Feed meldet «geloescht» und zählt die Folgenummer lückenlos", async () => {
    const id = await legeLager(BIS);
    await mitglieder(id);
    const vor = (await anfrage(leiter(), "GET", `${L(id)}/aenderungen`)).body
      .seq as number;
    const ids = [
      await lege(id, { name: "Geheim Eins", telefon: "044 123 45 67" }),
      await lege(id, { name: "Geheim Zwei" }),
      await lege(id, { name: "Geheim Drei", behalten: true }),
    ];
    expect(await loescheAlteKontakte(db, GRENZE, [id])).toBe(2);
    expect(await vorhanden(ids[2]!)).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "lager_adressbuch_aufgeraeumt"),
          eq(schema.auditLog.zielId, id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      akteurId: "system",
      zielTyp: "lager",
      abteilungId: welt.testabteilungId,
      details: { anzahl: 2 },
    });
    expect(JSON.stringify(audit[0]!.details)).not.toMatch(/Geheim|044/);

    const feed = await db
      .select()
      .from(schema.lagerAenderung)
      .where(
        and(
          eq(schema.lagerAenderung.lagerId, id),
          sqlTag`${schema.lagerAenderung.seq} > ${vor}`,
        ),
      )
      .orderBy(schema.lagerAenderung.seq);
    expect(feed.map((e) => [e.art, e.tabelle])).toEqual([
      ["geloescht", "adressbuch_kontakt"],
      ["geloescht", "adressbuch_kontakt"],
    ]);
    expect(feed.map((e) => e.zeileId).sort()).toEqual(
      [ids[0]!, ids[1]!].sort(),
    );
    expect(feed.map((e) => e.seq)).toEqual([vor + 1, vor + 2]);
    const [l] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    expect(l!.seq).toBe(vor + 2);
    // Ein Gerät mit altem Stand liest den Eintrag über den Feed der API (ohne Inhalt)
    const api = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/aenderungen?seit=${vor}`,
    );
    expect(api.body.eintraege.map((e: { art: string }) => e.art)).toEqual([
      "geloescht",
      "geloescht",
    ]);
    // Ein zweiter Lauf schreibt nichts mehr
    expect(await loescheAlteKontakte(db, GRENZE, [id])).toBe(0);
    expect(
      await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.aktion, "lager_adressbuch_aufgeraeumt"),
            eq(schema.auditLog.zielId, id),
          ),
        ),
    ).toHaveLength(1);
  });

  test("ein Lauf über mehrere Lager: jedes bekommt seinen Audit-Eintrag und seine Folgenummern", async () => {
    const eins = await legeLager(BIS);
    const zwei = await legeLager(BIS);
    await lege(eins);
    await lege(zwei);
    await lege(zwei);
    expect(await loescheAlteKontakte(db, GRENZE, [eins, zwei])).toBe(3);
    const feed = await db
      .select({ lagerId: schema.lagerAenderung.lagerId })
      .from(schema.lagerAenderung)
      .where(
        sqlTag`${schema.lagerAenderung.lagerId} in (${eins}, ${zwei}) and ${schema.lagerAenderung.art} = 'geloescht'`,
      );
    expect(feed.filter((e) => e.lagerId === eins)).toHaveLength(1);
    expect(feed.filter((e) => e.lagerId === zwei)).toHaveLength(2);
  });
});

describe("Erinnerung an die Lagerleitung", () => {
  // Eigenes Lagerende, damit nur dieses Lager in das Fenster fällt
  const BIS = "2033-03-31";
  const empfaengerVon = async (id: string) =>
    (
      await db
        .select({ personId: schema.lagerBenachrichtigung.personId })
        .from(schema.lagerBenachrichtigung)
        .where(
          and(
            eq(schema.lagerBenachrichtigung.lagerId, id),
            eq(schema.lagerBenachrichtigung.art, "adressbuch_aufraeumen"),
          ),
        )
    ).map((z) => z.personId);

  test("14 Tage vor dem Löschen einmal, nur an die Lagerleitung, und nur bei Kontakten ohne «behalten»", async () => {
    const id = await legeLager(BIS);
    await mitglieder(id);
    await lege(id, { name: "Geheim" });
    // Tag 165: noch zu früh
    expect(await erinnereAnAufraeumen(db, undefined, plusTage(BIS, 165))).toBe(
      0,
    );
    expect(await empfaengerVon(id)).toEqual([]);
    // Tag 166: 14 Tage vor dem Tag 180
    expect(await erinnereAnAufraeumen(db, undefined, plusTage(BIS, 166))).toBe(
      1,
    );
    expect(await empfaengerVon(id)).toEqual([leiter().id]);
    const [zeile] = await db
      .select()
      .from(schema.lagerBenachrichtigung)
      .where(eq(schema.lagerBenachrichtigung.lagerId, id));
    expect(zeile).toMatchObject({
      objektTyp: "adressbuch",
      objektId: id,
      gelesenAm: null,
    });
    // Nie ein zweites Mal für dasselbe Lager
    expect(await erinnereAnAufraeumen(db, undefined, plusTage(BIS, 170))).toBe(
      0,
    );
    expect(await empfaengerVon(id)).toHaveLength(1);
  });

  test("ohne Kontakt zum Aufräumen, mit nur markierten Kontakten und nach der Frist keine Erinnerung", async () => {
    const markiert = await legeLager("2034-04-30");
    await mitglieder(markiert);
    await lege(markiert, { behalten: true });
    const leer = await legeLager("2035-05-31");
    await mitglieder(leer);
    const spaet = await legeLager("2036-06-30");
    await mitglieder(spaet);
    await lege(spaet);
    expect(
      await erinnereAnAufraeumen(db, undefined, plusTage("2034-04-30", 170)),
    ).toBe(0);
    expect(
      await erinnereAnAufraeumen(db, undefined, plusTage("2035-05-31", 170)),
    ).toBe(0);
    // Am Tag 180 löscht der Lauf; erinnert wird dann nicht mehr
    expect(
      await erinnereAnAufraeumen(db, undefined, plusTage("2036-06-30", 180)),
    ).toBe(0);
    for (const id of [markiert, leer, spaet]) {
      expect(await empfaengerVon(id)).toEqual([]);
    }
  });

  test("wer die Art abgeschaltet hat, bekommt nichts; ohne Empfänger zählt das Lager nicht", async () => {
    const id = await legeLager("2037-07-31");
    await mitglieder(id);
    await lege(id);
    await db.insert(schema.lagerBenachrichtigungEinstellung).values({
      personId: leiter().id!,
      art: "adressbuch_aufraeumen",
      aktiv: false,
    });
    expect(
      await erinnereAnAufraeumen(db, undefined, plusTage("2037-07-31", 170)),
    ).toBe(0);
    expect(await empfaengerVon(id)).toEqual([]);
    await db
      .delete(schema.lagerBenachrichtigungEinstellung)
      .where(
        eq(schema.lagerBenachrichtigungEinstellung.personId, leiter().id!),
      );
  });
});
