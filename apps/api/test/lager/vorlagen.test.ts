import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { fristAb } from "../../src/lager/vorlagen.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Jede Abfrage an die Datenbank zählt mit: Das Anwenden braucht gleich viele für wenige und viele Einträge
let abfragen = 0;
const sql = postgres(API_URL, {
  debug: () => {
    abfragen++;
  },
});
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

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;

async function neuesLager(
  werte: { von?: string; status?: "aktiv" | "abgeschlossen" } = {},
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Vorlagenlager",
      von: werte.von ?? "2027-07-10",
      bis: "2028-12-31",
      status: werte.status ?? "aktiv",
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  for (const [persona, rolle] of MITGLIEDER) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
  return id;
}

async function neueVorlage(
  inhalt: Record<string, unknown>,
  art: "aufgaben" | "packliste" = "aufgaben",
  abteilungId = welt.testabteilungId,
) {
  const [zeile] = await db
    .insert(schema.vorlage)
    .values({ abteilungId, art, name: `Test ${randomUUID()}`, inhalt })
    .returning({ id: schema.vorlage.id });
  return zeile!.id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
});

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
const admin = () => konten.abteilungsleitung;
const aufgabenInhalt = (n: number) => ({
  aufgaben: Array.from({ length: n }, (_, i) => ({
    titel: `Aufgabe ${i}`,
    fristTage: i - 5,
  })),
});
const aufgabenImLager = (lagerId: string) =>
  db
    .select()
    .from(schema.aufgabe)
    .where(and(eq(schema.aufgabe.lagerId, lagerId)));
const punkteImLager = (lagerId: string) =>
  db
    .select()
    .from(schema.packlistePunkt)
    .where(and(eq(schema.packlistePunkt.lagerId, lagerId)));
const seqVon = async (lagerId: string) =>
  (
    await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId))
  )[0]!.seq;

describe("Fristen relativ zum Lagerbeginn", () => {
  test("Tage addieren über Monats-, Jahres- und Schaltjahrgrenzen", () => {
    expect(fristAb("2027-07-10", 0)).toBe("2027-07-10");
    expect(fristAb("2027-07-10", -7)).toBe("2027-07-03");
    expect(fristAb("2027-07-10", 25)).toBe("2027-08-04");
    expect(fristAb("2028-03-01", -1)).toBe("2028-02-29");
    expect(fristAb("2027-03-01", -1)).toBe("2027-02-28");
    expect(fristAb("2027-12-30", 3)).toBe("2028-01-02");
    expect(fristAb("2027-01-05", -366)).toBe("2026-01-04");
  });
});

describe("Admin-Routen /admin/vorlagen", () => {
  test("anlegen, lesen, auflisten, ändern, löschen", async () => {
    const name = `Standardlager ${randomUUID()}`;
    const neu = await anfrage(admin(), "POST", "/api/v1/admin/vorlagen", {
      art: "aufgaben",
      name,
      inhalt: {
        aufgaben: [
          { titel: "  Zeltplatz buchen ", fristTage: -90, stern: true },
          { titel: "Packliste verschicken", fristTage: -14 },
        ],
      },
    });
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({ art: "aufgaben", name, anzahl: 2 });
    // Getrimmt gespeichert
    expect(neu.body.inhalt.aufgaben[0].titel).toBe("Zeltplatz buchen");
    const id = neu.body.id as string;

    const gelesen = await anfrage(
      admin(),
      "GET",
      `/api/v1/admin/vorlagen/${id}`,
    );
    expect(gelesen.body).toEqual(neu.body);

    const alle = await anfrage(
      admin(),
      "GET",
      "/api/v1/admin/vorlagen?art=aufgaben",
    );
    const zeile = alle.body.vorlagen.find((v: { id: string }) => v.id === id);
    expect(zeile).toMatchObject({ name, anzahl: 2 });
    // Die Liste trägt keinen Inhalt
    expect(zeile.inhalt).toBeUndefined();
    expect(
      (
        await anfrage(admin(), "GET", "/api/v1/admin/vorlagen?art=packliste")
      ).body.vorlagen.some((v: { id: string }) => v.id === id),
    ).toBe(false);

    const geaendert = await anfrage(
      admin(),
      "PATCH",
      `/api/v1/admin/vorlagen/${id}`,
      { name: `${name} neu`, inhalt: aufgabenInhalt(3) },
    );
    expect(geaendert.status).toBe(200);
    expect(geaendert.body).toMatchObject({ name: `${name} neu`, anzahl: 3 });

    expect(
      (await anfrage(admin(), "DELETE", `/api/v1/admin/vorlagen/${id}`)).status,
    ).toBe(204);
    expect(
      (await anfrage(admin(), "GET", `/api/v1/admin/vorlagen/${id}`)).status,
    ).toBe(404);
  });

  test("strenge Eingabe: Inhalt muss zur Art passen, keine fremden Felder", async () => {
    const post = (body: Record<string, unknown>) =>
      anfrage(admin(), "POST", "/api/v1/admin/vorlagen", body);
    const name = () => `Prüfung ${randomUUID()}`;
    for (const body of [
      // Inhalt einer anderen Art
      { art: "aufgaben", name: name(), inhalt: { punkte: [] } },
      {
        art: "packliste",
        name: name(),
        inhalt: aufgabenInhalt(1),
      },
      // Fremde Felder im Inhalt und im Eintrag
      {
        art: "aufgaben",
        name: name(),
        inhalt: { aufgaben: [{ titel: "A" }], extra: 1 },
      },
      {
        art: "aufgaben",
        name: name(),
        inhalt: { aufgaben: [{ titel: "A", verantwortlich: randomUUID() }] },
      },
      // Leer, zu lang, Frist ausser Reichweite, keine ganze Zahl
      { art: "aufgaben", name: name(), inhalt: { aufgaben: [] } },
      {
        art: "aufgaben",
        name: name(),
        inhalt: { aufgaben: [{ titel: "x".repeat(201) }] },
      },
      {
        art: "aufgaben",
        name: name(),
        inhalt: { aufgaben: [{ titel: "A", fristTage: 367 }] },
      },
      {
        art: "aufgaben",
        name: name(),
        inhalt: { aufgaben: [{ titel: "A", fristTage: 1.5 }] },
      },
      {
        art: "aufgaben",
        name: name(),
        inhalt: aufgabenInhalt(201),
      },
      { art: "packliste", name: name(), inhalt: { punkte: [{ text: "A" }] } },
      { art: "unbekannt", name: name(), inhalt: {} },
      { art: "aufgaben", name: "", inhalt: aufgabenInhalt(1) },
      { art: "aufgaben", name: "x".repeat(101), inhalt: aufgabenInhalt(1) },
      { art: "aufgaben", name: name(), inhalt: aufgabenInhalt(1), extra: 1 },
    ]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 80)).toBe(
        400,
      );
    }
    // Änderung: der neue Inhalt muss zur Art der bestehenden Vorlage passen
    const id = await neueVorlage(aufgabenInhalt(1));
    expect(
      (
        await anfrage(admin(), "PATCH", `/api/v1/admin/vorlagen/${id}`, {
          inhalt: { punkte: [{ abschnitt: "A", text: "B" }] },
        })
      ).status,
    ).toBe(400);
    expect(
      (await anfrage(admin(), "PATCH", `/api/v1/admin/vorlagen/${id}`, {}))
        .status,
    ).toBe(400);
    expect(
      (
        await anfrage(admin(), "PATCH", `/api/v1/admin/vorlagen/${id}`, {
          art: "packliste",
        })
      ).status,
    ).toBe(400);
  });

  test("der Name ist je Abteilung und Art eindeutig", async () => {
    const name = `Doppelt ${randomUUID()}`;
    const body = { art: "aufgaben", name, inhalt: aufgabenInhalt(1) };
    expect(
      (await anfrage(admin(), "POST", "/api/v1/admin/vorlagen", body)).status,
    ).toBe(201);
    const zweite = await anfrage(
      admin(),
      "POST",
      "/api/v1/admin/vorlagen",
      body,
    );
    expect(zweite.status).toBe(409);
    expect(zweite.body.code).toBe("VORLAGENNAME_VERGEBEN");
    // Dieselbe Bezeichnung für eine andere Art ist frei
    expect(
      (
        await anfrage(admin(), "POST", "/api/v1/admin/vorlagen", {
          art: "packliste",
          name,
          inhalt: { punkte: [{ abschnitt: "A", text: "B" }] },
        })
      ).status,
    ).toBe(201);
    // Umbenennen auf einen vergebenen Namen
    const andere = await neueVorlage(aufgabenInhalt(1));
    const umbenannt = await anfrage(
      admin(),
      "PATCH",
      `/api/v1/admin/vorlagen/${andere}`,
      { name },
    );
    expect(umbenannt.status).toBe(409);
  });

  test("nur die Abteilungsleitung; eine fremde Vorlage ist unbekannt", async () => {
    const id = await neueVorlage(aufgabenInhalt(1));
    for (const p of LAGER_PERSONAS.filter((p) => p !== "abteilungsleitung")) {
      if (p === "ohneLogin") continue;
      expect(
        (await anfrage(konten[p], "GET", "/api/v1/admin/vorlagen")).status,
        p,
      ).toBe(403);
      const objekt = await anfrage(
        konten[p],
        "GET",
        `/api/v1/admin/vorlagen/${id}`,
      );
      // Die fremde Abteilung findet die Vorlage nicht (404), alle anderen dürfen nicht (403)
      expect(objekt.status, p).toBe(p === "fremdeAbteilung" ? 404 : 403);
    }
    expect(
      (await anfrage(konten.ohneLogin, "GET", "/api/v1/admin/vorlagen")).status,
    ).toBe(401);
    // Die Vorlage der Demo-Abteilung gibt es für die Testabteilung nicht
    const fremd = await neueVorlage(
      aufgabenInhalt(1),
      "aufgaben",
      welt.demoAbteilungId,
    );
    for (const [m, body] of [
      ["GET", undefined],
      ["PATCH", { name: "Übernommen" }],
      ["DELETE", undefined],
    ] as const) {
      expect(
        (await anfrage(admin(), m, `/api/v1/admin/vorlagen/${fremd}`, body))
          .status,
        m,
      ).toBe(404);
    }
    const liste = await anfrage(admin(), "GET", "/api/v1/admin/vorlagen");
    expect(liste.body.vorlagen.map((v: { id: string }) => v.id)).not.toContain(
      fremd,
    );
  });

  test("das Audit-Log nennt Vorlage und Art, nie den Inhalt", async () => {
    const neu = await anfrage(admin(), "POST", "/api/v1/admin/vorlagen", {
      art: "aufgaben",
      name: `Audit ${randomUUID()}`,
      inhalt: { aufgaben: [{ titel: "Geheimer Titel" }] },
    });
    await anfrage(admin(), "PATCH", `/api/v1/admin/vorlagen/${neu.body.id}`, {
      name: `Audit ${randomUUID()}`,
    });
    await anfrage(admin(), "DELETE", `/api/v1/admin/vorlagen/${neu.body.id}`);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, neu.body.id));
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([
      "vorlage_angelegt",
      "vorlage_geaendert",
      "vorlage_geloescht",
    ]);
    expect(JSON.stringify(zeilen)).not.toContain("Geheimer Titel");
  });
});

describe("Vorlage anwenden: Aufgaben", () => {
  test("Trockenlauf nennt die Aufgaben mit Fristen und schreibt nichts", async () => {
    const lager = await neuesLager({ von: "2028-03-01" });
    const id = await neueVorlage({
      aufgaben: [
        { titel: "Vor dem Lager", fristTage: -1 },
        { titel: "Am ersten Tag", fristTage: 0 },
        { titel: "Danach", fristTage: 30 },
        { titel: "Ohne Frist" },
      ],
    });
    const seq = await seqVon(lager);
    const a = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/vorlagen/${id}/anwenden?trocken=true`,
    );
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      trocken: true,
      art: "aufgaben",
      aufgaben: [
        { titel: "Vor dem Lager", frist: "2028-02-29" },
        { titel: "Am ersten Tag", frist: "2028-03-01" },
        { titel: "Danach", frist: "2028-03-31" },
        { titel: "Ohne Frist", frist: null },
      ],
    });
    expect(await aufgabenImLager(lager)).toHaveLength(0);
    expect(await seqVon(lager)).toBe(seq);
  });

  test("Anwenden legt die Aufgaben an: Fristen ab Lagerbeginn, ans Ende der Liste, mit Feed", async () => {
    const lager = await neuesLager({ von: "2027-07-10" });
    // Schon eine Aufgabe da: Die neuen kommen dahinter
    const vorhanden = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/aufgaben`,
      { titel: "Schon da" },
    );
    expect(vorhanden.status).toBe(201);
    const id = await neueVorlage({
      aufgaben: [
        {
          titel: "Zeltplatz buchen",
          teil: "Platz",
          notiz: "Frühzeitig",
          stern: true,
          laufend: true,
          fristTage: -90,
        },
        { titel: "Einkauf planen", fristTage: -7 },
        { titel: "Ohne Frist" },
      ],
    });
    const seq = await seqVon(lager);
    const a = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
    );
    expect(a.status).toBe(201);
    expect(a.body.trocken).toBe(false);
    const zeilen = (await aufgabenImLager(lager)).sort(
      (x, y) => x.reihenfolge - y.reihenfolge,
    );
    expect(zeilen.map((z) => z.titel)).toEqual([
      "Schon da",
      "Zeltplatz buchen",
      "Einkauf planen",
      "Ohne Frist",
    ]);
    expect(zeilen.map((z) => z.reihenfolge)).toEqual([0, 1, 2, 3]);
    expect(zeilen.map((z) => z.frist)).toEqual([
      null,
      "2027-04-11",
      "2027-07-03",
      null,
    ]);
    expect(zeilen[1]).toMatchObject({
      teil: "Platz",
      notiz: "Frühzeitig",
      stern: true,
      laufend: true,
      status: "offen",
      version: 1,
      verantwortlichPersonId: null,
      ressortId: null,
      erstelltVon: konten.lagerleitung.id,
    });
    // Sync-Kern: eine Folgenummer je Aufgabe und ein Feed-Eintrag je Aufgabe
    expect(await seqVon(lager)).toBe(seq + 3);
    const feed = await db
      .select()
      .from(schema.lagerAenderung)
      .where(eq(schema.lagerAenderung.lagerId, lager));
    expect(
      feed.filter((f) => f.tabelle === "aufgabe" && f.art === "neu"),
    ).toHaveLength(4);
    // Audit: Vorlage und Art, kein Titel
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, lager));
    expect(audit.map((z) => z.aktion)).toContain("vorlage_angewendet");
    expect(JSON.stringify(audit)).not.toContain("Zeltplatz");
    // Der Feed zeigt die Aufgaben der Lagerleitung
    const lesen = await anfrage(
      konten.lagerleitung,
      "GET",
      `/api/v1/lager/${lager}/aufgaben`,
    );
    expect(lesen.body.aufgaben).toHaveLength(4);
  });

  test("zweimal angewendet gibt jeden Eintrag zweimal; die Vorlage bleibt", async () => {
    const lager = await neuesLager();
    const id = await neueVorlage(aufgabenInhalt(2));
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await anfrage(
            konten.lagerleitung,
            "POST",
            `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
          )
        ).status,
      ).toBe(201);
    }
    expect(await aufgabenImLager(lager)).toHaveLength(4);
    expect(
      (await anfrage(admin(), "GET", `/api/v1/admin/vorlagen/${id}`)).status,
    ).toBe(200);
  });

  test("die Zahl der Abfragen hängt nicht von der Zahl der Einträge ab", async () => {
    const gezaehlt = async (n: number) => {
      const lager = await neuesLager();
      const id = await neueVorlage(aufgabenInhalt(n));
      abfragen = 0;
      const a = await anfrage(
        konten.lagerleitung,
        "POST",
        `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
      );
      expect(a.status).toBe(201);
      return abfragen;
    };
    const wenig = await gezaehlt(2);
    expect(await gezaehlt(100)).toBe(wenig);
  });

  test("Abteilungsleitung ohne Mitgliedschaft wendet an (gilt als Lagerleitung)", async () => {
    const lager = await neuesLager();
    const id = await neueVorlage(aufgabenInhalt(1));
    expect(
      (
        await anfrage(
          admin(),
          "POST",
          `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
        )
      ).status,
    ).toBe(201);
    expect((await aufgabenImLager(lager))[0]!.erstelltVon).toBe(
      konten.abteilungsleitung.id,
    );
  });
});

describe("Vorlage anwenden: Packliste", () => {
  const inhalt = {
    punkte: [
      { abschnitt: "Kleidung", text: "Regenjacke" },
      { abschnitt: "Kleidung", text: "Wanderschuhe" },
      { abschnitt: "Hygiene", text: "Zahnbürste", nurLagerleitung: true },
    ],
  };

  test("legt die Punkte ans Ende der Packliste, mit Feed", async () => {
    const lager = await neuesLager();
    const vorhanden = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/packliste/punkte`,
      { abschnitt: "Sonstiges", text: "Schon da" },
    );
    expect(vorhanden.status).toBe(201);
    const id = await neueVorlage(inhalt, "packliste");
    const seq = await seqVon(lager);
    const trocken = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/vorlagen/${id}/anwenden?trocken=true`,
    );
    expect(trocken.body).toEqual({
      trocken: true,
      art: "packliste",
      punkte: [
        { abschnitt: "Kleidung", text: "Regenjacke", nurLagerleitung: false },
        { abschnitt: "Kleidung", text: "Wanderschuhe", nurLagerleitung: false },
        { abschnitt: "Hygiene", text: "Zahnbürste", nurLagerleitung: true },
      ],
    });
    expect(await punkteImLager(lager)).toHaveLength(1);
    expect(await seqVon(lager)).toBe(seq);

    const a = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
    );
    expect(a.status).toBe(201);
    const zeilen = (await punkteImLager(lager)).sort(
      (x, y) => x.reihenfolge - y.reihenfolge,
    );
    expect(
      zeilen.map((z) => [z.text, z.reihenfolge, z.nurLagerleitung]),
    ).toEqual([
      ["Schon da", 0, false],
      ["Regenjacke", 1, false],
      ["Wanderschuhe", 2, false],
      ["Zahnbürste", 3, true],
    ]);
    expect(await seqVon(lager)).toBe(seq + 3);
    // Die Packliste der Person zeigt sie; der vertrauliche Punkt nur mit dem Recht
    const gelesen = await anfrage(
      konten.team,
      "GET",
      `/api/v1/lager/${lager}/packliste`,
    );
    expect(gelesen.body.punkte.map((p: { text: string }) => p.text)).toEqual([
      "Schon da",
      "Regenjacke",
      "Wanderschuhe",
    ]);
  });

  test("über 500 Punkte geschieht nichts (409), auch im Trockenlauf", async () => {
    const lager = await neuesLager();
    await db.insert(schema.packlistePunkt).values(
      Array.from({ length: 499 }, (_, i) => ({
        lagerId: lager,
        abschnitt: "Viel",
        text: `Punkt ${i}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    );
    const id = await neueVorlage(
      {
        punkte: [
          { abschnitt: "A", text: "1" },
          { abschnitt: "A", text: "2" },
        ],
      },
      "packliste",
    );
    for (const q of ["", "?trocken=true"]) {
      const a = await anfrage(
        konten.lagerleitung,
        "POST",
        `/api/v1/lager/${lager}/vorlagen/${id}/anwenden${q}`,
      );
      expect(a.status, q).toBe(409);
      expect(a.body.code).toBe("LIMIT_ERREICHT");
    }
    expect(await punkteImLager(lager)).toHaveLength(499);
    // Ein Punkt passt noch
    const einer = await neueVorlage(
      { punkte: [{ abschnitt: "A", text: "1" }] },
      "packliste",
    );
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "POST",
          `/api/v1/lager/${lager}/vorlagen/${einer}/anwenden`,
        )
      ).status,
    ).toBe(201);
  });
});

describe("Vorlage anwenden: Recht und Zugriff", () => {
  test("nur die Lagerleitung (vorlagen.anwenden); Leitung, Team und Lesen 403, Nicht-Mitglied 404, geschlossen 409", async () => {
    const lager = await neuesLager();
    const zu = await neuesLager({ status: "abgeschlossen" });
    const id = await neueVorlage(aufgabenInhalt(1));
    const url = (l: string, q = "") =>
      `/api/v1/lager/${l}/vorlagen/${id}/anwenden${q}`;
    for (const p of ["leitung", "team", "lesen"] as const) {
      expect(
        (await anfrage(konten[p], "POST", url(lager, "?trocken=true"))).status,
        p,
      ).toBe(403);
    }
    for (const p of ["ohneMitgliedschaft", "fremdeAbteilung"] as const) {
      expect((await anfrage(konten[p], "POST", url(lager))).status, p).toBe(
        404,
      );
    }
    expect((await anfrage(konten.ohneLogin, "POST", url(lager))).status).toBe(
      401,
    );
    const geschlossen = await anfrage(konten.lagerleitung, "POST", url(zu));
    expect(geschlossen.status).toBe(409);
    expect(geschlossen.body.code).toBe("LAGER_GESCHLOSSEN");
    expect(await aufgabenImLager(lager)).toHaveLength(0);
    expect(await aufgabenImLager(zu)).toHaveLength(0);
  });

  test("das Recht lässt sich einer Rolle geben", async () => {
    const lager = await neuesLager();
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: lager,
      rolle: "leitung",
      recht: "vorlagen.anwenden",
      erlaubt: true,
    });
    const id = await neueVorlage(aufgabenInhalt(1));
    expect(
      (
        await anfrage(
          konten.leitung,
          "POST",
          `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
        )
      ).status,
    ).toBe(201);
  });

  test("eine Vorlage einer anderen Abteilung oder eine unbekannte ID ist 404, ein ungültiger Parameter 400", async () => {
    const lager = await neuesLager();
    const fremd = await neueVorlage(
      aufgabenInhalt(1),
      "aufgaben",
      welt.demoAbteilungId,
    );
    for (const vorlageId of [fremd, randomUUID()]) {
      expect(
        (
          await anfrage(
            konten.lagerleitung,
            "POST",
            `/api/v1/lager/${lager}/vorlagen/${vorlageId}/anwenden`,
          )
        ).status,
      ).toBe(404);
    }
    const id = await neueVorlage(aufgabenInhalt(1));
    for (const q of ["?trocken=ja", "?trocken=true&x=1"]) {
      expect(
        (
          await anfrage(
            konten.lagerleitung,
            "POST",
            `/api/v1/lager/${lager}/vorlagen/${id}/anwenden${q}`,
          )
        ).status,
        q,
      ).toBe(400);
    }
    expect(await aufgabenImLager(lager)).toHaveLength(0);
  });

  test("ein beschädigter Inhalt in der Datenbank (409 VORLAGE_UNGUELTIG) schreibt nichts", async () => {
    const lager = await neuesLager();
    const id = await neueVorlage({ aufgaben: "kaputt" });
    const a = await anfrage(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${lager}/vorlagen/${id}/anwenden`,
    );
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("VORLAGE_UNGUELTIG");
    expect(await aufgabenImLager(lager)).toHaveLength(0);
  });
});

describe("Neues Lager aus einer Vorlage (POST /admin/lager)", () => {
  const lagerBody = (extra: Record<string, unknown> = {}) => ({
    titel: `Aus Vorlage ${randomUUID()}`,
    von: "2028-03-01",
    bis: "2028-03-15",
    ...extra,
  });

  test("mit vorlageId entstehen die Aufgaben in derselben Transaktion", async () => {
    const id = await neueVorlage({
      aufgaben: [
        { titel: "Vorher", fristTage: -1 },
        { titel: "Später", fristTage: 3 },
      ],
    });
    const body = lagerBody({ vorlageId: id });
    const neu = await anfrage(admin(), "POST", "/api/v1/admin/lager", body);
    expect(neu.status).toBe(201);
    const zeilen = (await aufgabenImLager(neu.body.id)).sort(
      (x, y) => x.reihenfolge - y.reihenfolge,
    );
    expect(zeilen.map((z) => [z.titel, z.frist])).toEqual([
      ["Vorher", "2028-02-29"],
      ["Später", "2028-03-04"],
    ]);
  });

  test("mit einer Packlisten-Vorlage entstehen die Punkte", async () => {
    const id = await neueVorlage(
      { punkte: [{ abschnitt: "A", text: "B" }] },
      "packliste",
    );
    const neu = await anfrage(
      admin(),
      "POST",
      "/api/v1/admin/lager",
      lagerBody({ vorlageId: id }),
    );
    expect(neu.status).toBe(201);
    expect(await punkteImLager(neu.body.id)).toHaveLength(1);
  });

  test("ohne vorlageId bleibt das Lager leer", async () => {
    const neu = await anfrage(
      admin(),
      "POST",
      "/api/v1/admin/lager",
      lagerBody(),
    );
    expect(neu.status).toBe(201);
    expect(await aufgabenImLager(neu.body.id)).toHaveLength(0);
    expect(await punkteImLager(neu.body.id)).toHaveLength(0);
  });

  test("eine fremde oder unbekannte Vorlage ist 400, und es entsteht kein Lager", async () => {
    const fremd = await neueVorlage(
      aufgabenInhalt(1),
      "aufgaben",
      welt.demoAbteilungId,
    );
    for (const vorlageId of [fremd, randomUUID()]) {
      const body = lagerBody({ vorlageId });
      expect(
        (await anfrage(admin(), "POST", "/api/v1/admin/lager", body)).status,
      ).toBe(400);
      expect(
        await db
          .select()
          .from(schema.lager)
          .where(eq(schema.lager.titel, body.titel)),
      ).toHaveLength(0);
    }
  });
});
