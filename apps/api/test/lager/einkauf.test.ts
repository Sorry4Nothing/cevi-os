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
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import {
  leiteWarengruppeAb,
  normalisiereName,
  STICHWORTE,
} from "../../src/lager/einkauf.js";
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
afterAll(() => sql.end());

describe("Namen und Warengruppen (Stichwortliste)", () => {
  test("normalisiert Gross- und Kleinschreibung, Umlaute, Akzente und Leerraum", () => {
    expect(normalisiereName("  KÄSE ")).toBe("kaese");
    expect(normalisiereName("Käse")).toBe("kaese");
    expect(normalisiereName("Kaese")).toBe("kaese");
    // Zerlegte Schreibweise (a und Trema einzeln) gleich wie die zusammengesetzte
    expect(normalisiereName("Käse")).toBe("kaese");
    expect(normalisiereName("Café   au\tlait")).toBe("cafe au lait");
    expect(normalisiereName("Rüebli")).toBe("rueebli");
  });

  test.each<[string, string]>([
    ["Äpfel", "obst_gemuese"],
    ["ÄPFEL", "obst_gemuese"],
    ["Rüebli", "obst_gemuese"],
    ["Kartoffeln", "obst_gemuese"],
    ["Weintrauben", "obst_gemuese"],
    ["Brot", "brot"],
    ["Vollkornbrot", "brot"],
    ["Brötchen", "brot"],
    ["BRÖTCHEN", "brot"],
    ["Milch", "milch_kaese"],
    ["Hafermilch", "milch_kaese"],
    ["Käse", "milch_kaese"],
    ["KÄSE", "milch_kaese"],
    ["Kaese", "milch_kaese"],
    ["Aufschnittkäse", "milch_kaese"],
    ["Eier", "milch_kaese"],
    ["Ei", "milch_kaese"],
    ["Fleischkäse", "fleisch_fisch"],
    ["Leberkäse", "fleisch_fisch"],
    ["Rindfleisch", "fleisch_fisch"],
    ["Schweinsfilet", "fleisch_fisch"],
    ["Schwein", "fleisch_fisch"],
    ["Bratwürste", "fleisch_fisch"],
    ["Räucherlachs", "fleisch_fisch"],
    ["Reis", "vorrat"],
    ["Basmatireis", "vorrat"],
    ["Spaghetti", "vorrat"],
    ["Tomatenmark", "vorrat"],
    ["Olivenöl", "vorrat"],
    ["Erdnussbutter", "vorrat"],
    ["Rote Linsen", "vorrat"],
    ["Apfelsaft", "getraenke"],
    ["Orangensaft", "getraenke"],
    ["Mineralwasser", "getraenke"],
    ["Rotwein", "getraenke"],
    ["Wein rot", "getraenke"],
    ["Kräutertee", "getraenke"],
    ["Tee", "getraenke"],
    ["Kaffeebohnen", "getraenke"],
    ["WC-Papier", "haushalt"],
    ["Spülmittel", "haushalt"],
    ["Zahnpasta", "haushalt"],
    ["Gummibärli", "diverses"],
    ["Flammkuchen", "diverses"],
    ["Brei", "diverses"],
    ["", "diverses"],
  ])("leitet «%s» als %s ab", (name, gruppe) => {
    expect(leiteWarengruppeAb(name)).toBe(gruppe);
  });

  test("kein Stichwort steht in zwei Gruppen, jede Gruppe der Datenbank ist abgedeckt", () => {
    const alle = Object.values(STICHWORTE).flat().map(normalisiereName);
    expect(new Set(alle).size).toBe(alle.length);
    expect(Object.keys(STICHWORTE).sort()).toEqual(
      schema.EINKAUF_WARENGRUPPEN.filter((g) => g !== "diverses").sort(),
    );
  });
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let geschlossenId: string;
let fremdLagerId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Einkaufslager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

// Jeder Test arbeitet in einem frischen Lager: Die Liste und die Summen sind je Lager, so stören sich die Tests nicht
async function frischesLager() {
  const id = await legeLager(welt.testabteilungId);
  await mitgliederSetzen(id);
  return id;
}
async function mitgliederSetzen(id: string) {
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  await mitgliederSetzen(geschlossenId);
  // Die falsche Mitgliedszeile der fremden Abteilung gibt nichts frei
  for (const id of [geschlossenId, fremdLagerId]) {
    await db
      .insert(schema.lagerMitglied)
      .values({
        lagerId: id,
        personId: konten.fremdeAbteilung.id!,
        rolle: "lagerleitung",
      })
      .onConflictDoNothing();
  }
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

const E = (id: string) => `/api/v1/lager/${id}/einkauf`;
const leiter = () => konten.lagerleitung;
async function neu(id: string, werte: Record<string, unknown>) {
  const a = await anfrage(leiter(), "POST", E(id), werte);
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    name: string;
    menge: number | null;
    einheit: string | null;
    warengruppe: string;
    einkaeuferPersonId: string | null;
    einkaeufer: { id: string; name: string } | null;
    erledigt: boolean;
  };
}
async function zusammen(id: string, abfrage = "") {
  const a = await anfrage(leiter(), "GET", `${E(id)}/zusammen${abfrage}`);
  expect(a.status).toBe(200);
  return a.body as {
    artikel: {
      name: string;
      menge: number | null;
      einheit: string | null;
      warengruppe: string;
      einkaeuferPersonId: string | null;
      erledigt: boolean;
      anzahl: number;
      eintraege: { id: string; version: number }[];
    }[];
    naechster: string | null;
  };
}

describe("Rechte je Lager-Persona", () => {
  // Lesen (einkauf.lesen): Lagerleitung, Abteilungsleitung, Leitung, Lesen; das Team hat das Recht im Standard nicht. Schreiben (einkauf.bearbeiten): Lagerleitung, Abteilungsleitung, Leitung
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const schreiben: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 201,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };

  test.each(LAGER_PERSONAS)(
    "%s: Liste, Zusammenfassung, Vorschläge lesen",
    async (p) => {
      const id = await frischesLager();
      const status = [];
      for (const pfad of ["", "/zusammen", "/vorschlaege"]) {
        status.push((await anfrage(konten[p], "GET", E(id) + pfad)).status);
      }
      expect(status).toEqual([lesen[p], lesen[p], lesen[p]]);
    },
  );

  test.each(LAGER_PERSONAS)("%s: Artikel anlegen", async (p) => {
    const id = await frischesLager();
    const a = await anfrage(konten[p], "POST", E(id), { name: "Reis" });
    expect(a.status).toBe(schreiben[p]);
  });

  test.each(LAGER_PERSONAS)("%s: abhaken und löschen", async (p) => {
    const id = await frischesLager();
    const artikel = await neu(id, { name: "Reis" });
    const erfolg = schreiben[p] === 201;
    const abhaken = await anfrage(
      konten[p],
      "PATCH",
      `${E(id)}/${artikel.id}`,
      {
        version: 1,
        erledigt: true,
      },
    );
    expect(abhaken.status).toBe(erfolg ? 200 : schreiben[p]);
    const loeschen = await anfrage(
      konten[p],
      "DELETE",
      `${E(id)}/${artikel.id}?version=${erfolg ? 2 : 1}`,
    );
    expect(loeschen.status).toBe(erfolg ? 204 : schreiben[p]);
  });

  test("abgeschlossenes Lager: schreiben 409, lesen 200", async () => {
    const [zeile] = await db
      .insert(schema.einkaufArtikel)
      .values({
        lagerId: geschlossenId,
        name: "Alt",
        nameNorm: "alt",
        warengruppe: "diverses",
        lagerSeq: 0,
      })
      .returning({ id: schema.einkaufArtikel.id });
    const post = await anfrage(leiter(), "POST", E(geschlossenId), {
      name: "X",
    });
    expect(post.status).toBe(409);
    expect(post.body.code).toBe("LAGER_GESCHLOSSEN");
    const patch = await anfrage(
      konten.leitung,
      "PATCH",
      `${E(geschlossenId)}/${zeile!.id}`,
      { version: 1, erledigt: true },
    );
    expect(patch.status).toBe(409);
    expect((await anfrage(konten.lesen, "GET", E(geschlossenId))).status).toBe(
      200,
    );
  });

  test("Lager der fremden Abteilung: 404, auch für die Lagerleitung des anderen Lagers", async () => {
    expect((await anfrage(leiter(), "GET", E(fremdLagerId))).status).toBe(404);
    expect(
      (
        await anfrage(konten.abteilungsleitung, "POST", E(fremdLagerId), {
          name: "X",
        })
      ).status,
    ).toBe(404);
  });

  test("ein Artikel eines anderen Lagers ist über dieses Lager nicht erreichbar", async () => {
    const eigenes = await frischesLager();
    const anderes = await frischesLager();
    const artikel = await neu(anderes, { name: "Reis" });
    for (const [methode, pfad, body] of [
      ["GET", `${E(eigenes)}/${artikel.id}`],
      ["PATCH", `${E(eigenes)}/${artikel.id}`, { version: 1, erledigt: true }],
      ["DELETE", `${E(eigenes)}/${artikel.id}?version=1`],
    ] as const) {
      expect((await anfrage(leiter(), methode, pfad, body)).status).toBe(404);
    }
    expect(
      (await anfrage(leiter(), "GET", `${E(anderes)}/${artikel.id}`)).body
        .version,
    ).toBe(1);
  });
});

describe("Artikel anlegen, ändern, löschen", () => {
  test("leitet die Warengruppe ab, speichert Menge und Einheit klein und kommt in die Liste", async () => {
    const id = await frischesLager();
    const a = await neu(id, {
      name: "  Käse   am Stück ",
      menge: 1.5,
      einheit: " KG ",
    });
    expect(a).toMatchObject({
      name: "Käse am Stück",
      menge: 1.5,
      einheit: "kg",
      warengruppe: "milch_kaese",
      erledigt: false,
      einkaeufer: null,
      version: 1,
    });
    const liste = await anfrage(konten.lesen, "GET", E(id));
    expect(liste.body.artikel).toHaveLength(1);
    expect(liste.body.artikel[0].id).toBe(a.id);
    // Eine leere Einheit heisst keine Einheit
    const b = await neu(id, { name: "Salz", einheit: "  " });
    expect(b.einheit).toBeNull();
    expect(b.menge).toBeNull();
  });

  test("eigene Warengruppe gilt und der Stamm merkt sie für gleiche Namen", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Gummibärli", warengruppe: "vorrat" });
    expect(a.warengruppe).toBe("vorrat");
    // Gleicher Name in anderer Schreibweise: Warengruppe aus dem Stamm
    const b = await neu(id, { name: "GUMMIBAERLI" });
    expect(b.warengruppe).toBe("vorrat");
    // In einem anderen Lager gilt der Stamm nicht
    const anderes = await frischesLager();
    expect((await neu(anderes, { name: "Gummibärli" })).warengruppe).toBe(
      "diverses",
    );
    // Wer die Vorgabe der Stichwortliste wiederherstellt, entfernt die Zeile im Stamm
    const c = await anfrage(leiter(), "PATCH", `${E(id)}/${b.id}`, {
      version: 1,
      warengruppe: "diverses",
    });
    expect(c.status).toBe(200);
    expect(c.body.warengruppe).toBe("diverses");
    expect(
      await db
        .select()
        .from(schema.einkaufArtikelstamm)
        .where(eq(schema.einkaufArtikelstamm.lagerId, id)),
    ).toHaveLength(0);
    expect((await neu(id, { name: "Gummibärli" })).warengruppe).toBe(
      "diverses",
    );
  });

  test("ein neuer Name ohne eigene Warengruppe leitet neu ab, mit Warengruppe gilt sie", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Brot" });
    expect(a.warengruppe).toBe("brot");
    const b = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 1,
      name: "Apfelsaft",
    });
    expect(b.body).toMatchObject({
      name: "Apfelsaft",
      warengruppe: "getraenke",
      version: 2,
    });
    const c = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 2,
      name: "Wasser",
      warengruppe: "haushalt",
    });
    expect(c.body.warengruppe).toBe("haushalt");
    // Nur die Warengruppe ändern: Der Name der Zeile bestimmt, was der Stamm merkt
    const d = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 3,
      warengruppe: "diverses",
    });
    expect(d.status).toBe(200);
    expect((await neu(id, { name: "Wasser" })).warengruppe).toBe("diverses");
  });

  test("abhaken ist ein einzelnes Update; ein veralteter Stand gibt 409 mit dem aktuellen", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Reis", menge: 2, einheit: "kg" });
    const erledigt = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 1,
      erledigt: true,
    });
    expect(erledigt.status).toBe(200);
    expect(erledigt.body).toMatchObject({ erledigt: true, version: 2 });
    const veraltet = await anfrage(
      konten.leitung,
      "PATCH",
      `${E(id)}/${a.id}`,
      {
        version: 1,
        menge: 5,
      },
    );
    expect(veraltet.status).toBe(409);
    expect(veraltet.body.code).toBe("VERSION_KONFLIKT");
    expect(veraltet.body.aktuell).toMatchObject({ erledigt: true, version: 2 });
    // Zurück auf offen
    const offen = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 2,
      erledigt: false,
    });
    expect(offen.body.erledigt).toBe(false);
  });

  test("löschen entfernt aus Liste und Einzelabruf, die Zeile ist endgültig weg", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Reis" });
    const del = await anfrage(leiter(), "DELETE", `${E(id)}/${a.id}?version=1`);
    expect(del.status).toBe(204);
    expect((await anfrage(leiter(), "GET", `${E(id)}/${a.id}`)).status).toBe(
      404,
    );
    expect((await anfrage(leiter(), "GET", E(id))).body.artikel).toHaveLength(
      0,
    );
    expect((await zusammen(id)).artikel).toHaveLength(0);
    expect(
      await db.$count(
        schema.einkaufArtikel,
        eq(schema.einkaufArtikel.id, a.id),
      ),
    ).toBe(0);
    // Nochmals löschen: 404
    expect(
      (await anfrage(leiter(), "DELETE", `${E(id)}/${a.id}?version=2`)).status,
    ).toBe(404);
  });

  test("ungültige Eingaben: 400", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Reis" });
    for (const body of [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(101) },
      { name: "Reis", menge: 0 },
      { name: "Reis", menge: -1 },
      { name: "Reis", menge: 0.0001 },
      { name: "Reis", menge: 1_000_001 },
      { name: "Reis", menge: "2" },
      { name: "Reis", einheit: "x".repeat(21) },
      { name: "Reis", warengruppe: "Getränke" },
      { name: "Reis", einkaeuferPersonId: "keine-uuid" },
      { name: "Reis", erledigt: true },
      { name: "Reis", lagerId: randomUUID() },
      { name: "Reis", version: 3 },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", E(id), body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    for (const body of [
      { version: 1 },
      { erledigt: true },
      { version: 0, erledigt: true },
      { version: 1, erledigt: "ja" },
      { version: 1, nameNorm: "x" },
      { version: 1, menge: 0 },
    ]) {
      expect(
        (await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect((await anfrage(leiter(), "DELETE", `${E(id)}/${a.id}`)).status).toBe(
      400,
    );
    expect((await anfrage(leiter(), "GET", `${E(id)}?limit=0`)).status).toBe(
      400,
    );
    expect(
      (await anfrage(leiter(), "GET", `${E(id)}?einkaeufer=jemand`)).status,
    ).toBe(400);
    expect(
      (await anfrage(leiter(), "GET", `${E(id)}/zusammen?x=1`)).status,
    ).toBe(400);
  });
});

describe("Wer kauft ein", () => {
  test("nur Mitglieder des Lagers; der Name wird beim Lesen aufgelöst", async () => {
    const id = await frischesLager();
    const leitungId = konten.leitung.id!;
    const a = await neu(id, { name: "Reis", einkaeuferPersonId: leitungId });
    expect(a.einkaeuferPersonId).toBe(leitungId);
    expect(a.einkaeufer).toMatchObject({ id: leitungId });
    await db
      .update(schema.user)
      .set({ name: "Neuer Name", ceviName: "Biber" })
      .where(eq(schema.user.id, leitungId));
    const lese = await anfrage(konten.lesen, "GET", `${E(id)}/${a.id}`);
    expect(lese.body.einkaeufer).toEqual({
      id: leitungId,
      name: "Neuer Name",
      ceviName: "Biber",
      bildUrl: null,
    });
    // Kein Mitglied: weder anlegen noch ändern; auch eine Person der fremden Abteilung oder eine unbekannte nicht
    for (const person of [
      konten.ohneMitgliedschaft.id!,
      konten.fremdeAbteilung.id!,
      randomUUID(),
    ]) {
      const post = await anfrage(leiter(), "POST", E(id), {
        name: "Brot",
        einkaeuferPersonId: person,
      });
      expect(post.status).toBe(400);
      expect(post.body.code).toBe("KEIN_MITGLIED");
      const patch = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
        version: 1,
        einkaeuferPersonId: person,
      });
      expect(patch.status).toBe(400);
      expect(patch.body.code).toBe("KEIN_MITGLIED");
    }
    // Nach den Fehlern ist nichts verändert und es gibt nichts Halbes
    expect(
      (await anfrage(leiter(), "GET", `${E(id)}/${a.id}`)).body,
    ).toMatchObject({ version: 1, einkaeuferPersonId: leitungId });
    expect((await anfrage(leiter(), "GET", E(id))).body.artikel).toHaveLength(
      1,
    );
    // Leeren
    const leer = await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 1,
      einkaeuferPersonId: null,
    });
    expect(leer.body.einkaeufer).toBeNull();
  });

  test("wer das Lager verlässt, kauft nicht mehr ein", async () => {
    const id = await frischesLager();
    const [p] = await db
      .insert(schema.user)
      .values({
        name: "Gast",
        email: `${randomUUID()}@example.org`,
        username: `g.${randomUUID().slice(0, 8)}`,
        abteilungId: welt.testabteilungId,
        mussPasswortAendern: false,
      })
      .returning({ id: schema.user.id });
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: p!.id, rolle: "team" });
    const a = await neu(id, { name: "Reis", einkaeuferPersonId: p!.id });
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, id),
          eq(schema.lagerMitglied.personId, p!.id),
        ),
      );
    const lese = await anfrage(leiter(), "GET", `${E(id)}/${a.id}`);
    expect(lese.body.einkaeuferPersonId).toBeNull();
    // Das Lager selbst und seine Zeilen bleiben
    expect(lese.body.name).toBe("Reis");
  });

  test("Filter «nur was ich einkaufe» für Liste und Zusammenfassung", async () => {
    const id = await frischesLager();
    await neu(id, { name: "Reis", einkaeuferPersonId: konten.leitung.id });
    await neu(id, { name: "Brot", einkaeuferPersonId: konten.lagerleitung.id });
    await neu(id, { name: "Milch" });
    const ich = await anfrage(konten.leitung, "GET", `${E(id)}?einkaeufer=ich`);
    expect(ich.body.artikel.map((x: { name: string }) => x.name)).toEqual([
      "Reis",
    ]);
    const lieber = await anfrage(
      konten.lesen,
      "GET",
      `${E(id)}?einkaeufer=${konten.lagerleitung.id}`,
    );
    expect(lieber.body.artikel.map((x: { name: string }) => x.name)).toEqual([
      "Brot",
    ]);
    const z = await anfrage(
      konten.leitung,
      "GET",
      `${E(id)}/zusammen?einkaeufer=ich`,
    );
    expect(z.body.artikel.map((x: { name: string }) => x.name)).toEqual([
      "Reis",
    ]);
    // Wer nichts einkauft, bekommt eine leere Liste
    const keiner = await anfrage(
      konten.lesen,
      "GET",
      `${E(id)}?einkaeufer=ich`,
    );
    expect(keiner.body.artikel).toEqual([]);
  });
});

describe("Zusammenfassung", () => {
  test("zählt gleiche Artikel mit gleicher Einheit zusammen, getrennt nach Einheit", async () => {
    const id = await frischesLager();
    await neu(id, { name: "Reis", menge: 2, einheit: "kg" });
    await neu(id, { name: "reis", menge: 3.5, einheit: "KG" });
    await neu(id, { name: "REIS", menge: 500, einheit: "g" });
    await neu(id, { name: "Reis" });
    await neu(id, { name: "Salz", menge: 1 });
    await neu(id, { name: "Salz", menge: 2 });
    const z = await zusammen(id);
    const nach = (name: string, einheit: string | null) =>
      z.artikel.find(
        (a) => a.name.toLowerCase() === name && a.einheit === einheit,
      );
    expect(nach("reis", "kg")).toMatchObject({
      menge: 5.5,
      anzahl: 2,
      warengruppe: "vorrat",
    });
    expect(nach("reis", "g")).toMatchObject({ menge: 500, anzahl: 1 });
    // Ohne Einheit und ohne Menge: eigene Zeile, die Menge bleibt leer
    expect(nach("reis", null)).toMatchObject({ menge: null, anzahl: 1 });
    // Ohne Einheit werden die Mengen gezählt
    expect(nach("salz", null)).toMatchObject({ menge: 3, anzahl: 2 });
    expect(z.artikel).toHaveLength(4);
  });

  test("Umlaute und Grossschreibung zählen zusammen, die neueste Schreibweise gilt", async () => {
    const id = await frischesLager();
    await neu(id, { name: "Käse", menge: 1, einheit: "kg" });
    await neu(id, { name: "KAESE", menge: 2, einheit: "kg" });
    await neu(id, { name: "Rüebli", menge: 1, einheit: "kg" });
    const z = await zusammen(id);
    expect(z.artikel).toHaveLength(2);
    const kaese = z.artikel.find((a) => a.warengruppe === "milch_kaese")!;
    expect(kaese).toMatchObject({ name: "KAESE", menge: 3, anzahl: 2 });
  });

  test("offene und erledigte Artikel und verschiedene Personen bleiben getrennt; die Menge ist exakt", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Reis", menge: 0.1, einheit: "kg" });
    await neu(id, { name: "Reis", menge: 0.2, einheit: "kg" });
    await neu(id, {
      name: "Reis",
      menge: 1,
      einheit: "kg",
      einkaeuferPersonId: konten.leitung.id,
    });
    await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 1,
      erledigt: true,
    });
    const alle = await zusammen(id);
    expect(alle.artikel).toHaveLength(3);
    const offen = await zusammen(id, "?erledigt=false");
    expect(offen.artikel).toHaveLength(2);
    // 0.2 allein; 0.1 + 0.2 wäre als Fliesskommazahl 0.30000000000000004
    expect(offen.artikel.map((x) => x.menge).sort()).toEqual([0.2, 1]);
    const fertig = await zusammen(id, "?erledigt=true");
    expect(fertig.artikel).toEqual([
      expect.objectContaining({ menge: 0.1, erledigt: true, anzahl: 1 }),
    ]);
    await neu(id, { name: "Hafer", menge: 0.1, einheit: "kg" });
    await neu(id, { name: "Hafer", menge: 0.2, einheit: "kg" });
    expect(
      (await zusammen(id)).artikel.find((x) => x.name === "Hafer")!.menge,
    ).toBe(0.3);
  });

  test("nennt die Artikel hinter einer Zeile mit Version, gelöschte zählen nicht", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Reis", menge: 1, einheit: "kg" });
    const b = await neu(id, { name: "Reis", menge: 2, einheit: "kg" });
    const c = await neu(id, { name: "Reis", menge: 4, einheit: "kg" });
    await anfrage(leiter(), "DELETE", `${E(id)}/${c.id}?version=1`);
    const z = await zusammen(id);
    expect(z.artikel).toHaveLength(1);
    expect(z.artikel[0]).toMatchObject({ menge: 3, anzahl: 2 });
    expect(z.artikel[0]!.eintraege).toEqual([
      { id: a.id, version: 1 },
      { id: b.id, version: 1 },
    ]);
  });

  test("Seitenwechsel über nach und limit, ohne Lücke und Doppelte", async () => {
    const id = await frischesLager();
    for (const name of ["A1", "B2", "C3", "D4", "E5"]) {
      await neu(id, { name, menge: 1 });
      await neu(id, { name, menge: 1 });
    }
    const gesehen: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const z = await zusammen(id, `?limit=2${nach ? `&nach=${nach}` : ""}`);
      gesehen.push(...z.artikel.map((a) => a.name));
      expect(z.artikel.every((a) => a.menge === 2 && a.anzahl === 2)).toBe(
        true,
      );
      nach = z.naechster;
      seiten++;
    } while (nach);
    expect(gesehen).toEqual(["A1", "B2", "C3", "D4", "E5"]);
    expect(seiten).toBe(3);
  });

  test("die Liste der Artikel wechselt die Seite mit nach und limit", async () => {
    const id = await frischesLager();
    const namen = ["A", "B", "C", "D", "E"];
    for (const name of namen) await neu(id, { name });
    const gesehen: string[] = [];
    let nach: string | null = null;
    do {
      const a: Antwort = await anfrage(
        leiter(),
        "GET",
        `${E(id)}?limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      gesehen.push(...a.body.artikel.map((x: { name: string }) => x.name));
      nach = a.body.naechster;
    } while (nach);
    expect(gesehen).toEqual(namen);
  });
});

describe("Vorschläge", () => {
  test("häufige Artikel zuerst, Anfang des Namens, ohne Beachtung von Gross- und Kleinschreibung und Umlauten", async () => {
    const id = await frischesLager();
    for (const name of ["Reis", "reis", "Reis", "Rüebli", "Rahm", "Salz"]) {
      await neu(id, { name });
    }
    await neu(id, { name: "Rüebli" });
    await neu(id, { name: "RUEEBLI" });
    const alle = await anfrage(konten.lesen, "GET", `${E(id)}/vorschlaege`);
    expect(alle.status).toBe(200);
    // Reis 3, Rüebli 3 (neueste Schreibweise), dann Rahm und Salz mit 1
    expect(alle.body.vorschlaege).toEqual([
      { name: "Reis", haeufigkeit: 3 },
      { name: "RUEEBLI", haeufigkeit: 3 },
      { name: "Rahm", haeufigkeit: 1 },
      { name: "Salz", haeufigkeit: 1 },
    ]);
    const r = await anfrage(leiter(), "GET", `${E(id)}/vorschlaege?q=R`);
    expect(r.body.vorschlaege.map((v: { name: string }) => v.name)).toEqual([
      "Reis",
      "RUEEBLI",
      "Rahm",
    ]);
    const ue = await anfrage(leiter(), "GET", `${E(id)}/vorschlaege?q=rü`);
    expect(ue.body.vorschlaege.map((v: { name: string }) => v.name)).toEqual([
      "RUEEBLI",
    ]);
    const eins = await anfrage(leiter(), "GET", `${E(id)}/vorschlaege?limit=1`);
    expect(eins.body.vorschlaege).toHaveLength(1);
  });

  test("% und _ in der Eingabe sind Zeichen, kein Muster; ein anderes Lager hat eigene Vorschläge", async () => {
    const id = await frischesLager();
    await neu(id, { name: "Reis" });
    for (const q of ["%", "_", "R%", "\\"]) {
      const a = await anfrage(
        leiter(),
        "GET",
        `${E(id)}/vorschlaege?q=${encodeURIComponent(q)}`,
      );
      expect(a.body.vorschlaege, q).toEqual([]);
    }
    const anderes = await frischesLager();
    expect(
      (await anfrage(leiter(), "GET", `${E(anderes)}/vorschlaege`)).body
        .vorschlaege,
    ).toEqual([]);
  });

  test("steigen mit der Nutzung beim Anlegen, nicht beim Ändern oder Löschen", async () => {
    const id = await frischesLager();
    const a = await neu(id, { name: "Reis" });
    await anfrage(leiter(), "PATCH", `${E(id)}/${a.id}`, {
      version: 1,
      erledigt: true,
    });
    await anfrage(leiter(), "DELETE", `${E(id)}/${a.id}?version=2`);
    const [v] = await db
      .select()
      .from(schema.einkaufVorschlag)
      .where(eq(schema.einkaufVorschlag.lagerId, id));
    expect(v).toMatchObject({ nameNorm: "reis", name: "Reis", haeufigkeit: 1 });
    await neu(id, { name: "Reis" });
    const [w] = await db
      .select()
      .from(schema.einkaufVorschlag)
      .where(eq(schema.einkaufVorschlag.lagerId, id));
    expect(w!.haeufigkeit).toBe(2);
  });

  test("gleichzeitiges Anlegen desselben Artikels zählt jedes Mal", async () => {
    const id = await frischesLager();
    const antworten = await Promise.all(
      Array.from({ length: 8 }, () =>
        anfrage(leiter(), "POST", E(id), { name: "Reis" }),
      ),
    );
    expect(antworten.map((a) => a.status)).toEqual(Array(8).fill(201));
    const [v] = await db
      .select()
      .from(schema.einkaufVorschlag)
      .where(eq(schema.einkaufVorschlag.lagerId, id));
    expect(v!.haeufigkeit).toBe(8);
  });
});

describe("Lager löschen", () => {
  test("das Lager nimmt Artikel, Stamm und Vorschläge mit", async () => {
    const id = await frischesLager();
    await neu(id, { name: "Gummibärli", warengruppe: "vorrat" });
    await db.delete(schema.lager).where(eq(schema.lager.id, id));
    for (const t of [
      schema.einkaufArtikel,
      schema.einkaufArtikelstamm,
      schema.einkaufVorschlag,
    ]) {
      expect(await db.select().from(t).where(eq(t.lagerId, id))).toHaveLength(
        0,
      );
    }
  });
});
