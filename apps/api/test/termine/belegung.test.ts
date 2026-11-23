import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
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

// Belegungsplan der Räume (#628): GET /api/v1/raeume/belegung. Recht, Zeitraum, Zeitzone, Felder und Grenzen.
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

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
let raumId: string;
let fremderRaumId: string;
let teamTagId: string;

type Zeile = {
  id: string;
  raumId: string;
  beginn: string;
  ende: string;
  zweck: string;
  status: string;
  person: string;
};
type Antwort = {
  von: string;
  bis: string;
  zeitzone: string;
  raeume: { id: string; name: string; ort: string | null }[];
  buchungen: Zeile[];
  weitere: boolean;
};

const hole = (konto: PersonaKonto, abfrage: string) =>
  app.request(`/api/v1/raeume/belegung?${abfrage}`, {
    headers: konto.headers,
  });
const lies = async (konto: PersonaKonto, abfrage: string) => {
  const r = await hole(konto, abfrage);
  expect(r.status).toBe(200);
  return (await r.json()) as Antwort;
};
// Nur die Buchungen des Testraums; andere Testdateien teilen die Abteilung
const meine = (a: Antwort) => a.buchungen.filter((b) => b.raumId === raumId);

const buche = (opt: {
  raum?: string;
  userId: string;
  beginn: string;
  ende: string;
  status: (typeof schema.BUCHUNG_STATI)[number];
  zweck?: string;
}) =>
  db
    .insert(schema.raumBuchung)
    .values({
      raumId: opt.raum ?? raumId,
      userId: opt.userId,
      beginn: new Date(opt.beginn),
      ende: new Date(opt.ende),
      zweck: opt.zweck ?? "Sitzung",
      status: opt.status,
      entschiedenAm: opt.status === "angefragt" ? null : new Date(),
    })
    .returning({ id: schema.raumBuchung.id })
    .then(([z]) => z!.id);

const BASIS = "von=2099-03-01&bis=2099-03-07&raumId=";

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(PERSONAS.map((p) => legePersonaAn(welt, p)));
  konten = Object.fromEntries(
    PERSONAS.map((p, i) => [p, liste[i]]),
  ) as typeof konten;
  const [team] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "team",
      name: `Belegungsteam ${randomUUID().slice(0, 8)}`,
      kuerzel: "BT",
    })
    .returning({ id: schema.tag.id });
  teamTagId = team!.id;
  const [r] = await db
    .insert(schema.raum)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Belegung ${randomUUID().slice(0, 8)}`,
      teamTagId,
    })
    .returning({ id: schema.raum.id });
  raumId = r!.id;
  const [fremd] = await db
    .insert(schema.raum)
    .values({
      abteilungId: welt.demoAbteilungId,
      name: `Fremd ${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: schema.raum.id });
  fremderRaumId = fremd!.id;
});

describe("Recht", () => {
  test("Abteilungsleitung, Stufenleitung und Leitung sehen die Belegung", async () => {
    for (const p of [
      "admin",
      "adminOhneZweitenFaktor",
      "slA",
      "slB",
      "leitendeA",
      "leitendeB",
      "leitendeAElternB",
    ] as const) {
      expect((await hole(konten[p], BASIS + raumId)).status, p).toBe(200);
    }
  });

  test("Eltern, Konto mit Passwortpflicht und fremde Eltern: 403, ohne Sitzung: 401", async () => {
    for (const p of [
      "elternA",
      "elternB",
      "mussPasswortAendern",
      "demoEltern",
    ] as const) {
      expect((await hole(konten[p], BASIS + raumId)).status, p).toBe(403);
    }
    expect((await hole(konten.ohneLogin, BASIS + raumId)).status).toBe(401);
    expect((await hole(konten.deaktiviert, BASIS + raumId)).status).toBe(401);
  });

  test("wer das Team eines Raums trägt oder ein Team verantwortet, sieht sie auch ohne Stufenrolle", async () => {
    const eltern = konten.elternA;
    expect((await hole(eltern, BASIS + raumId)).status).toBe(403);
    await db
      .insert(schema.personTag)
      .values({ userId: eltern.id!, tagId: teamTagId });
    expect((await hole(eltern, BASIS + raumId)).status).toBe(200);
    await db
      .delete(schema.personTag)
      .where(eq(schema.personTag.userId, eltern.id!));
    expect((await hole(eltern, BASIS + raumId)).status).toBe(403);

    const verantwortlich = konten.elternB;
    await db.insert(schema.personTag).values({
      userId: verantwortlich.id!,
      tagId: teamTagId,
      rolle: "Verantwortlich",
    });
    // Die Verantwortung zählt auch, wenn der Raum das Team nicht trägt
    await db
      .update(schema.raum)
      .set({ teamTagId: null })
      .where(eq(schema.raum.id, raumId));
    expect((await hole(verantwortlich, BASIS + raumId)).status).toBe(200);
    await db
      .update(schema.raum)
      .set({ teamTagId })
      .where(eq(schema.raum.id, raumId));
    await db
      .delete(schema.personTag)
      .where(eq(schema.personTag.userId, verantwortlich.id!));
    expect((await hole(verantwortlich, BASIS + raumId)).status).toBe(403);
  });

  test("ein einfaches Mitglied eines beliebigen Tags sieht nichts", async () => {
    const [tag] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "funktion",
        name: `Mat ${randomUUID().slice(0, 8)}`,
        kuerzel: "M",
      })
      .returning({ id: schema.tag.id });
    await db
      .insert(schema.personTag)
      .values({ userId: konten.elternA.id!, tagId: tag!.id });
    expect((await hole(konten.elternA, BASIS + raumId)).status).toBe(403);
    await db
      .delete(schema.personTag)
      .where(eq(schema.personTag.userId, konten.elternA.id!));
  });
});

describe("Zeitraum", () => {
  test("ungültige Angaben: 400", async () => {
    const l = konten.leitendeA;
    for (const q of [
      "",
      "von=2099-03-01",
      "von=2099-03-01&bis=2099-02-28",
      "von=2099-3-1&bis=2099-03-07",
      "von=2099-02-30&bis=2099-03-07",
      "von=2099-03-01&bis=2099-03-07&anfragen=vielleicht",
      "von=2099-03-01&bis=2099-03-07&raumId=kein-uuid",
      "von=2099-03-01&bis=2099-03-07&mehr=1",
      // 32 Tage
      "von=2099-03-01&bis=2099-04-01",
    ]) {
      expect((await hole(l, q)).status, q).toBe(400);
    }
  });

  test("31 Tage sind erlaubt, ein Tag ebenso", async () => {
    const l = konten.leitendeA;
    expect((await hole(l, "von=2099-03-01&bis=2099-03-31")).status).toBe(200);
    const a = await lies(l, "von=2099-03-01&bis=2099-03-01");
    expect(a.zeitzone).toBe("Europe/Zurich");
    expect(a.von).toBe("2099-03-01");
  });

  test("Tage zählen in Schweizer Zeit, im Sommer und im Winter", async () => {
    const l = konten.leitendeA;
    const uid = konten.leitendeB.id!;
    // Sommer (UTC+2): 2099-07-01 22:30 UTC ist der 2. Juli, 00:30 Uhr
    const spaet = await buche({
      userId: uid,
      beginn: "2099-07-01T22:30:00.000Z",
      ende: "2099-07-01T23:30:00.000Z",
      status: "bestaetigt",
    });
    // endet genau um Mitternacht (Schweizer Zeit) des 2. Juli: gehört nicht mehr zum 2.
    const davor = await buche({
      userId: uid,
      beginn: "2099-07-01T20:00:00.000Z",
      ende: "2099-07-01T22:00:00.000Z",
      status: "bestaetigt",
    });
    const ids = async (tag: string) =>
      meine(await lies(l, `von=${tag}&bis=${tag}&raumId=${raumId}`)).map(
        (b) => b.id,
      );
    expect(await ids("2099-07-02")).toEqual([spaet]);
    expect(await ids("2099-07-01")).toEqual([davor]);

    // Winter (UTC+1): 2099-01-14 23:30 UTC ist der 15. Januar, 00:30 Uhr
    const winter = await buche({
      userId: uid,
      beginn: "2099-01-14T23:30:00.000Z",
      ende: "2099-01-15T00:30:00.000Z",
      status: "bestaetigt",
    });
    expect(await ids("2099-01-15")).toEqual([winter]);
    expect(await ids("2099-01-14")).toEqual([]);
  });
});

describe("Inhalt", () => {
  test("bestätigt und angefragt, nie abgelehnt, storniert oder vergangen; ohne Anfragen nur bestätigt", async () => {
    const uid = konten.leitendeB.id!;
    const best = await buche({
      userId: uid,
      beginn: "2099-03-02T08:00:00.000Z",
      ende: "2099-03-02T10:00:00.000Z",
      status: "bestaetigt",
      zweck: "Leitungssitzung",
    });
    const offen = await buche({
      userId: uid,
      beginn: "2099-03-02T12:00:00.000Z",
      ende: "2099-03-02T13:00:00.000Z",
      status: "angefragt",
    });
    await buche({
      userId: uid,
      beginn: "2099-03-02T14:00:00.000Z",
      ende: "2099-03-02T15:00:00.000Z",
      status: "abgelehnt",
    });
    await buche({
      userId: uid,
      beginn: "2099-03-02T16:00:00.000Z",
      ende: "2099-03-02T17:00:00.000Z",
      status: "storniert",
    });
    // Eine alte, nie entschiedene Anfrage ist keine Belegung mehr
    await buche({
      userId: uid,
      beginn: "2020-03-02T12:00:00.000Z",
      ende: "2020-03-02T13:00:00.000Z",
      status: "angefragt",
    });
    const l = konten.leitendeA;
    const alle = meine(await lies(l, BASIS + raumId));
    expect(alle.map((b) => [b.id, b.status])).toEqual([
      [best, "bestaetigt"],
      [offen, "angefragt"],
    ]);
    const alt = meine(
      await lies(l, `von=2020-03-01&bis=2020-03-07&raumId=${raumId}`),
    );
    expect(alt).toEqual([]);
    const nurBestaetigt = meine(
      await lies(l, `${BASIS}${raumId}&anfragen=nein`),
    );
    expect(nurBestaetigt.map((b) => b.id)).toEqual([best]);
    expect(alle[0]!.zweck).toBe("Leitungssitzung");
  });

  test("die Person nur mit Cevi-Name, sonst Vorname; keine weiteren Felder", async () => {
    const mowgli = konten.leitendeB;
    const vreni = konten.slB;
    await db
      .update(schema.user)
      .set({ name: "Hanna Beispiel", ceviName: " Mowgli " })
      .where(eq(schema.user.id, mowgli.id!));
    await db
      .update(schema.user)
      .set({ name: "Vreni Beispiel", ceviName: null })
      .where(eq(schema.user.id, vreni.id!));
    await buche({
      userId: mowgli.id!,
      beginn: "2099-03-03T08:00:00.000Z",
      ende: "2099-03-03T09:00:00.000Z",
      status: "bestaetigt",
    });
    await buche({
      userId: vreni.id!,
      beginn: "2099-03-03T10:00:00.000Z",
      ende: "2099-03-03T11:00:00.000Z",
      status: "bestaetigt",
    });
    const antwort = await lies(
      konten.leitendeA,
      `von=2099-03-03&bis=2099-03-03&raumId=${raumId}`,
    );
    expect(antwort.buchungen.map((b) => b.person)).toEqual(["Mowgli", "Vreni"]);
    for (const b of antwort.buchungen) {
      expect(Object.keys(b).sort()).toEqual([
        "beginn",
        "ende",
        "id",
        "person",
        "raumId",
        "status",
        "zweck",
      ]);
    }
    expect(Object.keys(antwort).sort()).toEqual([
      "bis",
      "buchungen",
      "raeume",
      "von",
      "weitere",
      "zeitzone",
    ]);
    const text = JSON.stringify(antwort);
    expect(text).not.toContain("Beispiel");
    expect(text).not.toContain("@");
  });

  test("raumId schränkt ein; inaktive Räume fehlen; Räume und Buchungen anderer Abteilungen nie", async () => {
    const uid = konten.leitendeB.id!;
    await db.insert(schema.raumBuchung).values({
      raumId: fremderRaumId,
      userId: konten.demoAdmin.id!,
      beginn: new Date("2099-03-02T08:00:00.000Z"),
      ende: new Date("2099-03-02T10:00:00.000Z"),
      zweck: "Fremd",
      status: "bestaetigt",
      entschiedenAm: new Date(),
    });
    const [still] = await db
      .insert(schema.raum)
      .values({
        abteilungId: welt.testabteilungId,
        name: `Still ${randomUUID().slice(0, 8)}`,
        aktiv: false,
      })
      .returning({ id: schema.raum.id });
    await buche({
      raum: still!.id,
      userId: uid,
      beginn: "2099-03-02T08:00:00.000Z",
      ende: "2099-03-02T09:00:00.000Z",
      status: "bestaetigt",
    });
    const l = konten.leitendeA;
    const eng = await lies(l, BASIS + raumId);
    expect(eng.raeume.map((r) => r.id)).toEqual([raumId]);
    const breit = await lies(l, "von=2099-03-01&bis=2099-03-07");
    const raumIds = breit.raeume.map((r) => r.id);
    expect(raumIds).toContain(raumId);
    expect(raumIds).not.toContain(fremderRaumId);
    expect(raumIds).not.toContain(still!.id);
    expect(breit.buchungen.some((b) => b.raumId === fremderRaumId)).toBe(false);
    expect(breit.buchungen.some((b) => b.raumId === still!.id)).toBe(false);
    // Die fremde Abteilungsleitung sieht nur ihre eigenen Räume
    const fremd = await lies(konten.demoAdmin, "von=2099-03-01&bis=2099-03-07");
    expect(fremd.raeume.map((r) => r.id)).toContain(fremderRaumId);
    expect(fremd.raeume.map((r) => r.id)).not.toContain(raumId);
    expect(fremd.buchungen.every((b) => b.raumId !== raumId)).toBe(true);
    // Ein Raum der anderen Abteilung als Filter: leer, kein Fehler, kein Hinweis auf den Raum
    const geraten = await lies(l, BASIS + fremderRaumId);
    expect(geraten.raeume).toEqual([]);
    expect(geraten.buchungen).toEqual([]);
  });

  test("höchstens 500 Buchungen, danach «weitere»", async () => {
    const [voll] = await db
      .insert(schema.raum)
      .values({
        abteilungId: welt.testabteilungId,
        name: `Voll ${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: schema.raum.id });
    const uid = konten.leitendeB.id!;
    const zeilen = Array.from({ length: 501 }, (_, i) => ({
      raumId: voll!.id,
      userId: uid,
      beginn: new Date(Date.UTC(2099, 5, 1, 8) + i * 60_000),
      ende: new Date(Date.UTC(2099, 5, 1, 8) + i * 60_000 + 30_000),
      zweck: "Dichte",
      status: "angefragt" as const,
    }));
    await db.insert(schema.raumBuchung).values(zeilen);
    const antwort = await lies(
      konten.leitendeA,
      `von=2099-06-01&bis=2099-06-01&raumId=${voll!.id}`,
    );
    expect(antwort.buchungen).toHaveLength(500);
    expect(antwort.weitere).toBe(true);
    await db
      .delete(schema.raumBuchung)
      .where(inArray(schema.raumBuchung.raumId, [voll!.id]));
  });
});
