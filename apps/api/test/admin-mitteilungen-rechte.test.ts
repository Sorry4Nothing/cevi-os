import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { legeSystemrollenAn } from "../src/rechtemodell/gruppenrollen.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  schalteZweitenFaktorEin,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Mitteilungen senden läuft über das Recht «mitteilung.senden» (#643): je Gruppe oder abteilungsweit, mit zweitem Faktor. Auflösung, Limit und Audit der Empfänger stehen in admin-mitteilungen*.test.ts

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const gesendet: string[][] = [];
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  fcm: {
    sendEach: async (nachrichten) => {
      gesendet.push(nachrichten.map((n) => JSON.stringify(n)));
      return { responses: nachrichten.map(() => ({ success: true })) };
    },
  },
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let teamA: string;
let teamB: string;
let nurTeamA: PersonaKonto;
let nurTeamAOhneFaktor: PersonaKonto;
let alleRolle: PersonaKonto;
let ohneRecht: PersonaKonto;
let empfaengerA: PersonaKonto;

async function gruppe(name: string) {
  const [z] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "team",
      name: `${name} ${randomUUID().slice(0, 6)}`,
      kuerzel: "",
    })
    .returning({ id: schema.tag.id });
  await legeSystemrollenAn(db, welt.testabteilungId, z.id, "team");
  return z.id;
}
async function rolle(
  tagId: string,
  geltung: "alle" | "eigene",
  recht = "mitteilung.senden",
) {
  const [r] = await db
    .insert(schema.gruppenRolle)
    .values({
      abteilungId: welt.testabteilungId,
      tagId,
      name: `Rolle ${randomUUID().slice(0, 6)}`,
    })
    .returning({ id: schema.gruppenRolle.id });
  await db
    .insert(schema.gruppenRolleRecht)
    .values({ rolleId: r.id, recht, geltung });
  return r.id;
}
const mitRolle = (konto: PersonaKonto, tagId: string, rolleId: string) =>
  db.insert(schema.personTag).values({ userId: konto.id!, tagId, rolleId });

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  teamA = await gruppe("Mat");
  teamB = await gruppe("Küche");
  // Mitglieder mit eingeschalteter Option «Mitteilungen» (sonst erreicht der Push niemanden)
  empfaengerA = await legePersonaAn(welt, "elternA");
  await db
    .insert(schema.personTag)
    .values({ userId: empfaengerA.id!, tagId: teamA });
  await db
    .update(schema.user)
    .set({ pushProgramme: true })
    .where(eq(schema.user.id, empfaengerA.id!));
  const mitFaktor = async () =>
    schalteZweitenFaktorEin(welt, await legePersonaAn(welt, "leitendeA"));
  nurTeamA = await mitFaktor();
  await mitRolle(nurTeamA, teamA, await rolle(teamA, "eigene"));
  nurTeamAOhneFaktor = await legePersonaAn(welt, "leitendeB");
  await mitRolle(nurTeamAOhneFaktor, teamA, await rolle(teamA, "eigene"));
  alleRolle = await mitFaktor();
  await mitRolle(alleRolle, teamB, await rolle(teamB, "alle"));
  ohneRecht = await mitFaktor();
  // Eine Rolle mit einem anderen Recht gibt kein Senden
  await mitRolle(
    ohneRecht,
    teamA,
    await rolle(teamA, "eigene", "raum.verwalten"),
  );
});

const senden = (
  konto: PersonaKonto,
  body: Record<string, unknown>,
  pfad = "",
) =>
  app.request(`/api/v1/admin/mitteilungen${pfad}`, {
    method: "POST",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const zielTeam = (gruppeId: string) => ({
  ziele: [{ gruppeId, rollen: ["alle"] }],
});

describe("Mitteilungen senden über das Recht", () => {
  test("die Rolle mit «eigene» erreicht die eigene Gruppe: Vorschau und Senden", async () => {
    const vorschau = await senden(nurTeamA, zielTeam(teamA), "/vorschau");
    expect(vorschau.status).toBe(200);
    expect((await vorschau.json()).empfaenger).toBeGreaterThan(0);
    const a = await senden(nurTeamA, { titel: "Hallo", ...zielTeam(teamA) });
    expect(a.status).toBe(200);
    expect((await a.json()).empfaenger).toBeGreaterThan(0);
    // Der Audit-Eintrag nennt Gruppen und Zahl, nie den Text
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "mitteilung_gesendet"),
          eq(schema.auditLog.akteurId, nurTeamA.id!),
        ),
      );
    expect(zeilen).toHaveLength(1);
    expect(JSON.stringify(zeilen[0].details)).not.toContain("Hallo");
  });

  test("eine andere Gruppe ist 403, und das auch in der Vorschau", async () => {
    for (const pfad of ["", "/vorschau"]) {
      const a = await senden(
        nurTeamA,
        pfad ? zielTeam(teamB) : { titel: "X", ...zielTeam(teamB) },
        pfad,
      );
      expect(a.status, pfad).toBe(403);
    }
    // Zwei Ziele, eines fremd: nichts geht raus
    const gemischt = await senden(nurTeamA, {
      titel: "X",
      ziele: [
        { gruppeId: teamA, rollen: ["alle"] },
        { gruppeId: teamB, rollen: ["alle"] },
      ],
    });
    expect(gemischt.status).toBe(403);
  });

  test("«eigene» erreicht nie alle: weder die alte Form «alle» noch alle Stufen", async () => {
    expect(
      (await senden(nurTeamA, { titel: "X", empfaenger: "alle" })).status,
    ).toBe(403);
    expect(
      (
        await senden(nurTeamA, {
          titel: "X",
          empfaenger: "alle",
          rollen: ["eltern"],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await senden(nurTeamA, {
          titel: "X",
          empfaenger: "stufen",
          stufeIds: [welt.stufeAId],
        })
      ).status,
    ).toBe(403);
  });

  test("die Rolle mit «alle» erreicht jede Gruppe und «alle»", async () => {
    expect(
      (await senden(alleRolle, { titel: "X", ...zielTeam(teamA) })).status,
    ).toBe(200);
    expect(
      (await senden(alleRolle, { empfaenger: "alle" }, "/vorschau")).status,
    ).toBe(200);
    expect(
      (
        await senden(
          alleRolle,
          { empfaenger: "stufen", stufeIds: [welt.stufeAId] },
          "/vorschau",
        )
      ).status,
    ).toBe(200);
  });

  test("ohne das Recht 403, auch mit einer Rolle für ein anderes Recht; ohne Faktor 403 mit Code", async () => {
    for (const konto of [ohneRecht]) {
      expect(
        (await senden(konto, { titel: "X", ...zielTeam(teamA) })).status,
      ).toBe(403);
    }
    const a = await senden(nurTeamAOhneFaktor, {
      titel: "X",
      ...zielTeam(teamA),
    });
    expect(a.status).toBe(403);
    expect((await a.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("unbekannte oder fremde Gruppen sind 400, vor dem Recht je Gruppe", async () => {
    const a = await senden(nurTeamA, { titel: "X", ...zielTeam(randomUUID()) });
    expect(a.status).toBe(400);
  });

  test("das Kennzeichen «Verantwortliche/r» wählt die Rolle als Ziel", async () => {
    const verantwortlich = await legePersonaAn(welt, "elternA");
    const [r] = await db
      .insert(schema.gruppenRolle)
      .values({
        abteilungId: welt.testabteilungId,
        tagId: teamA,
        name: "Chefin",
        verantwortlich: true,
      })
      .returning({ id: schema.gruppenRolle.id });
    await db
      .insert(schema.personTag)
      .values({ userId: verantwortlich.id!, tagId: teamA, rolleId: r.id });
    await db
      .update(schema.user)
      .set({ pushProgramme: true })
      .where(eq(schema.user.id, verantwortlich.id!));
    const a = await senden(
      admin,
      { ziele: [{ gruppeId: teamA, rollen: ["verantwortliche"] }] },
      "/vorschau",
    );
    expect(a.status).toBe(200);
    expect((await a.json()).empfaenger).toBeGreaterThan(0);
  });

  test("ein Konto ohne Recht, ohne Rolle und ohne Abteilungsleitung: 403", async () => {
    const eltern = await legePersonaAn(welt, "elternA");
    expect(
      (await senden(eltern, { titel: "X", empfaenger: "alle" })).status,
    ).toBe(403);
  });
});
