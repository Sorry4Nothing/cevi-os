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
import { legeSystemrollenAn } from "../src/rechtemodell/gruppenrollen.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

// Personen, Kinder, Stufen, Gruppen, Import, Anwesenheit, Programme und Mitteilungen über Rechte statt über «Abteilungsleitung» (#650). Eine Persona-Matrix je Route mit echten Konten: Rollen der Plattform und der Gruppen geben genau ihre Rechte, die Stufenrollen bleiben, wie sie waren, und was Rechte vergibt, bleibt bei der Abteilungsleitung.

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  // Eine Attrappe statt firebase-admin: Kein Test geht ins Netz
  fcm: {
    sendEach: async (nachrichten) => ({
      responses: nachrichten.map(() => ({ success: true })),
    }),
  },
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let welt: Welt;
let abt: string;
let admin: PersonaKonto;
let sl: PersonaKonto;
let leitung: PersonaKonto;
// Konten mit zweitem Faktor und je einer Rolle, die genau ein Recht trägt
const P: Record<string, PersonaKonto> = {};
let ohneFaktor: PersonaKonto;
let teamA: string;
let teamB: string;
let ziel: PersonaKonto;
let zielMitRolle: PersonaKonto;
let zielAdmin: PersonaKonto;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const zeile = async <T>(q: Promise<T[]>) => (await q)[0];

async function gruppe(name: string) {
  const { id } = await zeile(
    db
      .insert(schema.tag)
      .values({
        abteilungId: abt,
        typ: "team",
        name: `${name} ${randomUUID().slice(0, 6)}`,
        kuerzel: "",
      })
      .returning({ id: schema.tag.id }),
  );
  await legeSystemrollenAn(db, abt, id, "team");
  return id;
}

// Eine Plattformrolle mit den Rechten (abteilungsweit) für das Konto
async function plattformRolle(konto: PersonaKonto, rechte: string[]) {
  const { id } = await zeile(
    db
      .insert(schema.plattformRolle)
      .values({ abteilungId: abt, name: `Rolle ${randomUUID().slice(0, 6)}` })
      .returning({ id: schema.plattformRolle.id }),
  );
  await db
    .insert(schema.plattformRolleRecht)
    .values(rechte.map((recht) => ({ rolleId: id, recht })));
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: konto.id!, rolleId: id });
}

// Eine Rolle in einer Gruppe (Stufe oder Team) mit den Rechten und Geltungen, dem Konto zugeordnet
async function gruppenRolle(
  konto: PersonaKonto,
  tagId: string,
  rechte: { recht: string; geltung: "alle" | "eigene" }[],
) {
  const { id } = await zeile(
    db
      .insert(schema.gruppenRolle)
      .values({
        abteilungId: abt,
        tagId,
        name: `Rolle ${randomUUID().slice(0, 6)}`,
      })
      .returning({ id: schema.gruppenRolle.id }),
  );
  await db
    .insert(schema.gruppenRolleRecht)
    .values(rechte.map((r) => ({ rolleId: id, ...r })));
  await db
    .insert(schema.personTag)
    .values({ userId: konto.id!, tagId, rolleId: id });
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  abt = welt.testabteilungId;
  admin = await legePersonaAn(welt, "admin");
  sl = await legePersonaAn(welt, "slA");
  leitung = await legePersonaAn(welt, "leitendeA");
  for (const stufeId of [welt.stufeAId, welt.stufeBId]) {
    await legeSystemrollenAn(db, abt, stufeId, "stufe");
  }
  teamA = await gruppe("Team A");
  teamB = await gruppe("Team B");

  const neu = async (name: string) => {
    P[name] = await legePersonaMitFaktorAn(welt, "elternA");
  };
  await Promise.all(
    [
      "verwalter",
      "verwalterKinder",
      "seher",
      "kinderStufeA",
      "gruppenleitung",
      "gruppenVerwalter",
      "importeur",
      "mitteiler",
      "mitteilerAlle",
      "anwesenheit",
      "programme",
    ].map(neu),
  );
  ohneFaktor = await legePersonaAn(welt, "elternA");
  ziel = await legePersonaAn(welt, "elternA");
  zielMitRolle = await legePersonaAn(welt, "elternA");
  zielAdmin = await legePersonaAn(welt, "admin");

  await plattformRolle(P.verwalter, ["personen.verwalten"]);
  await plattformRolle(P.verwalterKinder, [
    "personen.verwalten",
    "kinder.verwalten",
  ]);
  await plattformRolle(P.seher, ["personen.sehen"]);
  await plattformRolle(ohneFaktor, ["personen.verwalten"]);
  await plattformRolle(P.gruppenVerwalter, ["gruppen.verwalten"]);
  await plattformRolle(P.importeur, ["import.ausfuehren"]);
  await plattformRolle(P.mitteilerAlle, ["mitteilung.senden"]);
  await plattformRolle(P.programme, [
    "programm.alle_sehen",
    "programm.intern_sehen",
  ]);
  await plattformRolle(zielMitRolle, ["medien.verwalten"]);
  await gruppenRolle(P.kinderStufeA, welt.stufeAId, [
    { recht: "kinder.sehen", geltung: "eigene" },
    { recht: "kinder.verwalten", geltung: "eigene" },
  ]);
  await gruppenRolle(P.anwesenheit, welt.stufeAId, [
    { recht: "anwesenheit.fuehren", geltung: "eigene" },
    { recht: "stufe.einblick", geltung: "eigene" },
  ]);
  await gruppenRolle(P.programme, welt.stufeAId, [
    { recht: "stufe.einblick", geltung: "eigene" },
  ]);
  await gruppenRolle(P.gruppenleitung, teamA, [
    { recht: "gruppen.mitglieder", geltung: "eigene" },
    { recht: "personen.sehen", geltung: "alle" },
  ]);
  await gruppenRolle(P.mitteiler, teamA, [
    { recht: "mitteilung.senden", geltung: "eigene" },
  ]);
});

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
const A = "/api/v1/admin";

async function status(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return (await anfrage(konto, methode, pfad, body)).status;
}

const neuerBenutzername = () => `person.${randomUUID().slice(0, 8)}`;
const personBody = (extra: Record<string, unknown> = {}) => ({
  vorname: "Neu",
  nachname: "Person",
  benutzername: neuerBenutzername(),
  abteilungsleitung: false,
  rollen: [],
  elternteilVon: [],
  ...extra,
});

describe("Personen: Liste", () => {
  test("Personen verwalten und Personen sehen öffnen die Liste, kein anderes Recht", async () => {
    expect(await status(admin, "GET", `${A}/personen`)).toBe(200);
    expect(await status(P.verwalter, "GET", `${A}/personen`)).toBe(200);
    expect(await status(P.seher, "GET", `${A}/personen`)).toBe(200);
    // Mitglieder ändern allein öffnet die Liste nicht; die Rolle der Gruppenleitung trägt «Personen sehen» dazu
    expect(await status(P.gruppenleitung, "GET", `${A}/personen`)).toBe(200);
    for (const konto of [
      P.importeur,
      P.mitteiler,
      P.gruppenVerwalter,
      P.kinderStufeA,
      sl,
      leitung,
    ]) {
      expect(await status(konto, "GET", `${A}/personen`)).toBe(403);
    }
  });

  test("ohne zweiten Faktor: 403 mit dem Code ZWEITER_FAKTOR_FEHLT, ohne Recht 403 ohne Code", async () => {
    const antwort = await anfrage(ohneFaktor, "GET", `${A}/personen`);
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { code?: string }).code).toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
    const ohneRecht = await anfrage(sl, "GET", `${A}/personen`);
    expect(((await ohneRecht.json()) as { code?: string }).code).not.toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
  });

  test("Startpasswörter: nur mit «Personen verwalten», und nie von Konten mit Rechten (ausser der Abteilungsleitung)", async () => {
    // Zwei Konten mit offenem Startpasswort: eines ohne Rechte, eines mit einer Plattformrolle
    const frei = (await (
      await anfrage(admin, "POST", `${A}/personen`, personBody())
    ).json()) as { id: string; startpasswort: string };
    const mitRechten = (await (
      await anfrage(admin, "POST", `${A}/personen`, personBody())
    ).json()) as { id: string; startpasswort: string };
    await plattformRolle({ id: mitRechten.id } as PersonaKonto, [
      "medien.verwalten",
    ]);
    type Liste = {
      personen: { id: string; startpasswort: string | null }[];
      kinder: unknown[];
    };
    const lies = async (konto: PersonaKonto) =>
      (await (await anfrage(konto, "GET", `${A}/personen`)).json()) as Liste;
    const wert = (l: Liste, id: string) =>
      l.personen.find((p) => p.id === id)!.startpasswort;

    const alsAdmin = await lies(admin);
    expect(wert(alsAdmin, frei.id)).toBe(frei.startpasswort);
    expect(wert(alsAdmin, mitRechten.id)).toBe(mitRechten.startpasswort);
    const alsVerwalter = await lies(P.verwalter);
    expect(wert(alsVerwalter, frei.id)).toBe(frei.startpasswort);
    expect(wert(alsVerwalter, mitRechten.id)).toBeNull();
    const alsSeher = await lies(P.seher);
    expect(wert(alsSeher, frei.id)).toBeNull();
    expect(wert(alsSeher, mitRechten.id)).toBeNull();
  });

  test("Kinder in der Liste nur, wenn die Person Kinder sehen darf (je Stufe)", async () => {
    type Liste = { kinder: { id: string }[] };
    const lies = async (konto: PersonaKonto) =>
      (await (await anfrage(konto, "GET", `${A}/personen`)).json()) as Liste;
    expect((await lies(admin)).kinder.map((k) => k.id)).toEqual(
      expect.arrayContaining([welt.kindAId, welt.kindBId]),
    );
    expect((await lies(P.seher)).kinder).toEqual([]);
    // Personen verwalten und Kinder verwalten (alle): beide Stufen
    expect((await lies(P.verwalterKinder)).kinder.map((k) => k.id)).toEqual(
      expect.arrayContaining([welt.kindAId, welt.kindBId]),
    );
  });
});

describe("Personen: ändern", () => {
  test("anlegen: mit «Personen verwalten» eine Person ohne Rechte; Abteilungsleitung, Stufenrolle und Eltern-Zuordnung brauchen mehr", async () => {
    expect(
      await status(P.verwalter, "POST", `${A}/personen`, personBody()),
    ).toBe(201);
    expect(
      await status(
        P.verwalter,
        "POST",
        `${A}/personen`,
        personBody({ abteilungsleitung: true }),
      ),
    ).toBe(403);
    expect(
      await status(
        P.verwalter,
        "POST",
        `${A}/personen`,
        personBody({
          rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
        }),
      ),
    ).toBe(403);
    // Eltern einem Kind zuordnen: «Kinder verwalten» in dessen Stufe
    expect(
      await status(
        P.verwalter,
        "POST",
        `${A}/personen`,
        personBody({ elternteilVon: [welt.kindAId] }),
      ),
    ).toBe(403);
    expect(
      await status(
        P.verwalterKinder,
        "POST",
        `${A}/personen`,
        personBody({ elternteilVon: [welt.kindAId] }),
      ),
    ).toBe(201);
    // Die Abteilungsleitung darf alles, wie bisher
    expect(
      await status(
        admin,
        "POST",
        `${A}/personen`,
        personBody({
          rollen: [{ stufeId: welt.stufeAId, typ: "leitung" }],
        }),
      ),
    ).toBe(201);
    for (const konto of [P.seher, P.importeur, sl, leitung, ohneFaktor]) {
      expect(await status(konto, "POST", `${A}/personen`, personBody())).toBe(
        403,
      );
    }
  });

  test("ändern: Namen ja; die Abteilungsleitung, Stufenrollen und die Konten der Abteilungsleitung nicht", async () => {
    const pfad = `${A}/personen/${ziel.id}`;
    expect(
      await status(P.verwalter, "PATCH", pfad, { name: "Anna Muster" }),
    ).toBe(204);
    // Ein Rollen-Editor schickt das ganze Formular: ohne Änderung kein Fehler
    expect(
      await status(P.verwalter, "PATCH", pfad, {
        name: "Anna Muster",
        abteilungsleitung: false,
        rollen: [],
        elternteilVon: [welt.kindAId],
      }),
    ).toBe(204);
    expect(
      await status(P.verwalter, "PATCH", pfad, { abteilungsleitung: true }),
    ).toBe(403);
    expect(
      await status(P.verwalter, "PATCH", pfad, {
        rollen: [{ stufeId: welt.stufeAId, typ: "leitung" }],
      }),
    ).toBe(403);
    expect(
      await status(P.verwalter, "PATCH", pfad, {
        elternteilVon: [welt.kindBId],
      }),
    ).toBe(403);
    // Das Konto einer Abteilungsleitung bleibt bei ihr
    expect(
      await status(P.verwalter, "PATCH", `${A}/personen/${zielAdmin.id}`, {
        name: "Anna Muster",
      }),
    ).toBe(403);
    // Nichts davon hat etwas geändert
    const [bisher] = await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, ziel.id!));
    expect(bisher.role).toBe("user");
    // Ohne das Recht, ohne Faktor, fremde Rollen
    expect(await status(P.seher, "PATCH", pfad, { name: "X Y" })).toBe(403);
    expect(await status(ohneFaktor, "PATCH", pfad, { name: "X Y" })).toBe(403);
    expect(await status(sl, "PATCH", pfad, { name: "X Y" })).toBe(403);
    expect(await status(admin, "PATCH", pfad, { name: "Anna Muster" })).toBe(
      204,
    );
  });

  test("zurücksetzen, deaktivieren, aktivieren: Konten ohne Rechte ja; Konten mit Rechten und die Abteilungsleitung nur die Abteilungsleitung", async () => {
    const frei = await legePersonaAn(welt, "elternA");
    expect(
      await status(
        P.verwalter,
        "POST",
        `${A}/personen/${frei.id}/startpasswort`,
      ),
    ).toBe(200);
    expect(
      await status(
        P.verwalter,
        "POST",
        `${A}/personen/${frei.id}/deaktivieren`,
      ),
    ).toBe(204);
    expect(
      await status(P.verwalter, "POST", `${A}/personen/${frei.id}/aktivieren`),
    ).toBe(200);
    for (const gesperrt of [zielMitRolle, zielAdmin, sl]) {
      for (const weg of ["startpasswort", "deaktivieren", "aktivieren"]) {
        expect(
          await status(
            P.verwalter,
            "POST",
            `${A}/personen/${gesperrt.id}/${weg}`,
          ),
          `${weg} ${gesperrt.benutzername}`,
        ).toBe(403);
      }
      expect(
        await status(
          P.verwalter,
          "POST",
          `${A}/personen/${gesperrt.id}/zweiter-faktor-zuruecksetzen`,
        ),
      ).toBe(403);
    }
    // Die Abteilungsleitung setzt ein Konto mit Rechten zurück, wie bisher
    expect(
      await status(
        admin,
        "POST",
        `${A}/personen/${zielMitRolle.id}/startpasswort`,
      ),
    ).toBe(200);
  });

  test("löschen ist fest: nur die Abteilungsleitung", async () => {
    const weg = await legePersonaAn(welt, "elternA");
    expect(await status(P.verwalter, "DELETE", `${A}/personen/${weg.id}`)).toBe(
      403,
    );
    expect(await status(admin, "DELETE", `${A}/personen/${weg.id}`)).toBe(204);
  });

  test("ein Konto einer anderen Abteilung bleibt 404, auch mit dem Recht", async () => {
    const fremd = await legePersonaAn(welt, "demoEltern");
    expect(
      await status(P.verwalter, "PATCH", `${A}/personen/${fremd.id}`, {
        name: "X Y",
      }),
    ).toBe(404);
  });
});

describe("Kinder", () => {
  type KinderListe = { kinder: { id: string }[] };
  const lies = async (konto: PersonaKonto) =>
    (await (await anfrage(konto, "GET", `${A}/kinder`)).json()) as KinderListe;

  test("eine Rolle in der Stufe: nur die Kinder dieser Stufe", async () => {
    const ids = (await lies(P.kinderStufeA)).kinder.map((k) => k.id);
    expect(ids).toContain(welt.kindAId);
    expect(ids).not.toContain(welt.kindBId);
    expect((await lies(admin)).kinder.map((k) => k.id)).toEqual(
      expect.arrayContaining([welt.kindAId, welt.kindBId]),
    );
    for (const konto of [P.seher, P.verwalter, sl, leitung, P.mitteiler]) {
      expect(await status(konto, "GET", `${A}/kinder`)).toBe(403);
    }
  });

  test("verwalten je Stufe: anlegen, ändern, verschieben und löschen nur in der eigenen Stufe", async () => {
    const eigen = P.kinderStufeA;
    const neu = (stufeId: string) => ({
      vorname: "Neu",
      nachname: "Kind",
      stufeId,
    });
    expect(await status(eigen, "POST", `${A}/kinder`, neu(welt.stufeBId))).toBe(
      403,
    );
    const antwort = await anfrage(
      eigen,
      "POST",
      `${A}/kinder`,
      neu(welt.stufeAId),
    );
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };
    expect(
      await status(eigen, "PATCH", `${A}/kinder/${id}`, { vorname: "Neo" }),
    ).toBe(204);
    // In eine andere Stufe setzen braucht das Recht auch dort
    expect(
      await status(eigen, "PATCH", `${A}/kinder/${id}`, {
        stufeId: welt.stufeBId,
      }),
    ).toBe(403);
    expect(
      await status(eigen, "PATCH", `${A}/kinder/${welt.kindBId}`, {
        vorname: "Neo",
      }),
    ).toBe(403);
    expect(await status(eigen, "DELETE", `${A}/kinder/${welt.kindBId}`)).toBe(
      403,
    );
    expect(await status(eigen, "DELETE", `${A}/kinder/${id}`)).toBe(204);
    // Ein Kind einer anderen Abteilung bleibt 404
    expect(
      await status(eigen, "PATCH", `${A}/kinder/${welt.demoKindId}`, {
        vorname: "Neo",
      }),
    ).toBe(404);
  });

  test("Eltern zuordnen: mit «Kinder verwalten» in der Stufe des Kindes", async () => {
    expect(
      await status(P.kinderStufeA, "PATCH", `${A}/kinder/${welt.kindAId}`, {
        eltern: [ziel.id],
      }),
    ).toBe(204);
    expect(
      await status(P.kinderStufeA, "PATCH", `${A}/kinder/${welt.kindBId}`, {
        eltern: [ziel.id],
      }),
    ).toBe(403);
    const links = await db
      .select()
      .from(schema.kindEltern)
      .where(
        and(
          eq(schema.kindEltern.kindId, welt.kindAId),
          eq(schema.kindEltern.userId, ziel.id!),
        ),
      );
    expect(links).toHaveLength(1);
  });
});

describe("Gruppen, Tags und Stufen", () => {
  test("Mitglieder ändern: nur in der eigenen Gruppe, nie sich selbst, nie eine Rolle mit Rechten", async () => {
    const leiter = P.gruppenleitung;
    // Die Liste zeigt nur die eigene Gruppe
    const liste = (await (
      await anfrage(leiter, "GET", `${A}/tags`)
    ).json()) as {
      tags: { id: string }[];
    };
    expect(liste.tags.map((t) => t.id)).toEqual([teamA]);
    expect(await status(leiter, "GET", `${A}/tags/${teamA}`)).toBe(200);
    expect(await status(leiter, "GET", `${A}/tags/${teamB}`)).toBe(403);

    const mit = (tagId: string, userId: string) =>
      `${A}/tags/${tagId}/personen/${userId}`;
    expect(await status(leiter, "PUT", mit(teamA, ziel.id!), {})).toBe(204);
    expect(await status(leiter, "PUT", mit(teamB, ziel.id!), {})).toBe(403);
    expect(await status(leiter, "PUT", mit(teamA, leiter.id!), {})).toBe(403);
    // Ein Freitext ohne Wirkung ja, «verantwortlich» gibt der Gruppe Rechte und bleibt bei der Abteilungsleitung
    expect(
      await status(leiter, "PUT", mit(teamA, ziel.id!), { rolle: "Kasse" }),
    ).toBe(204);
    expect(
      await status(leiter, "PUT", mit(teamA, ziel.id!), {
        rolle: "Verantwortlich",
      }),
    ).toBe(403);
    expect(
      await status(admin, "PUT", mit(teamA, ziel.id!), {
        rolle: "verantwortlich",
      }),
    ).toBe(204);
    // Wer die Rolle schon trägt, wird nicht von jemandem ohne das Recht umgeschrieben
    expect(
      await status(leiter, "PUT", mit(teamA, ziel.id!), { rolle: "Kasse" }),
    ).toBe(403);
    expect(await status(leiter, "DELETE", mit(teamB, ziel.id!))).toBe(403);
    // Auch entziehen darf nur, wer Rechte vergibt (#777): Die Rolle «verantwortlich» gibt der Gruppe Rechte
    expect(await status(leiter, "DELETE", mit(teamA, ziel.id!))).toBe(403);
    expect(await status(admin, "DELETE", mit(teamA, ziel.id!))).toBe(204);
    // Ohne Rolle mit Rechten entzieht auch die Gruppenleitung
    expect(await status(leiter, "PUT", mit(teamA, ziel.id!), {})).toBe(204);
    expect(await status(leiter, "DELETE", mit(teamA, ziel.id!))).toBe(204);
  });

  test("Gruppen anlegen, umbenennen, löschen: nur mit «Gruppen verwalten», nie mit dem Recht für Mitglieder", async () => {
    const body = { typ: "team", name: `Neu ${randomUUID().slice(0, 6)}` };
    expect(await status(P.gruppenleitung, "POST", `${A}/tags`, body)).toBe(403);
    expect(
      await status(P.gruppenleitung, "PATCH", `${A}/tags/${teamA}`, {
        name: "X",
      }),
    ).toBe(403);
    expect(await status(P.gruppenleitung, "DELETE", `${A}/tags/${teamA}`)).toBe(
      403,
    );
    const antwort = await anfrage(
      P.gruppenVerwalter,
      "POST",
      `${A}/tags`,
      body,
    );
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };
    expect(
      await status(P.gruppenVerwalter, "PATCH", `${A}/tags/${id}`, {
        name: `Umbenannt ${randomUUID().slice(0, 6)}`,
      }),
    ).toBe(204);
    // Die Mitglieder ändert dieses Recht nicht
    expect(
      await status(
        P.gruppenVerwalter,
        "PUT",
        `${A}/tags/${id}/personen/${ziel.id}`,
        {},
      ),
    ).toBe(403);
    expect(await status(P.gruppenVerwalter, "DELETE", `${A}/tags/${id}`)).toBe(
      204,
    );
  });

  test("Stufen: anlegen und löschen mit «Gruppen verwalten», die Reihenfolge der Stufenleitung mit «Mitglieder ändern»", async () => {
    const antwort = await anfrage(P.gruppenVerwalter, "POST", `${A}/stufen`, {
      name: `Stufe ${randomUUID().slice(0, 6)}`,
    });
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };
    expect(
      await status(
        P.gruppenVerwalter,
        "PUT",
        `${A}/stufen/${id}/stufenleitung`,
        {
          ids: [],
        },
      ),
    ).toBe(403);
    expect(
      await status(P.gruppenVerwalter, "DELETE", `${A}/stufen/${id}`),
    ).toBe(204);
    expect(
      await status(P.gruppenleitung, "POST", `${A}/stufen`, { name: "X" }),
    ).toBe(403);
    expect(
      await status(sl, "PATCH", `${A}/stufen/${welt.stufeAId}`, { name: "X" }),
    ).toBe(403);
  });
});

describe("Import", () => {
  const body = (art: string) => ({
    stufeId: welt.stufeAId,
    zeilen: [
      { vorname: "Ida", nachname: `Muster${randomUUID().slice(0, 6)}`, art },
    ],
  });

  test("«Import ausführen»: Kinder ja, Leitende nur mit «Rechte vergeben»", async () => {
    expect(
      await status(P.importeur, "POST", `${A}/import/vorschau`, body("kind")),
    ).toBe(200);
    expect(await status(P.importeur, "POST", `${A}/import`, body("kind"))).toBe(
      201,
    );
    expect(
      await status(
        P.importeur,
        "POST",
        `${A}/import/vorschau`,
        body("leitung"),
      ),
    ).toBe(403);
    expect(
      await status(P.importeur, "POST", `${A}/import`, body("stufenleitung")),
    ).toBe(403);
    expect(
      await status(admin, "POST", `${A}/import/vorschau`, body("leitung")),
    ).toBe(200);
    for (const konto of [
      P.verwalter,
      P.seher,
      P.kinderStufeA,
      sl,
      ohneFaktor,
    ]) {
      expect(
        await status(konto, "POST", `${A}/import/vorschau`, body("kind")),
      ).toBe(403);
    }
  });
});

describe("Anwesenheit, Teilnahmen und Programme", () => {
  test("Anwesenheit führen: Stufenrollen wie bisher, Gruppenrolle nur für ihre Stufe, mit zweitem Faktor", async () => {
    const pfad = (stufeId: string) => `/api/v1/stufen/${stufeId}/anwesenheit`;
    expect(await status(sl, "GET", pfad(welt.stufeAId))).toBe(200);
    expect(await status(leitung, "GET", pfad(welt.stufeAId))).toBe(200);
    expect(await status(sl, "GET", pfad(welt.stufeBId))).toBe(403);
    expect(await status(admin, "GET", pfad(welt.stufeBId))).toBe(200);
    expect(await status(P.anwesenheit, "GET", pfad(welt.stufeAId))).toBe(200);
    expect(await status(P.anwesenheit, "GET", pfad(welt.stufeBId))).toBe(403);
    // Ein anderes Recht in derselben Stufe führt keine Anwesenheit
    expect(await status(P.kinderStufeA, "GET", pfad(welt.stufeAId))).toBe(403);
    expect(await status(P.verwalter, "GET", pfad(welt.stufeAId))).toBe(403);
    // Ohne zweiten Faktor: eine Gruppenrolle braucht ihn, die Stufenrolle nicht
    const ohne = await legePersonaAn(welt, "elternA");
    await gruppenRolle(ohne, welt.stufeAId, [
      { recht: "anwesenheit.fuehren", geltung: "eigene" },
    ]);
    const antwort = await anfrage(ohne, "GET", pfad(welt.stufeAId));
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { code?: string }).code).toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
  });

  test("Teilnahmen der Kinder und Kontakte der Stufe: «Teilnahmen und Kontakte der Stufe sehen» je Stufe", async () => {
    const p = await legeProgrammAn(db, {
      abteilungId: abt,
      sichtbarkeit: "leitende",
      stufen: [welt.stufeAId],
      beginn: new Date("2027-06-05T13:00:00Z"),
    });
    const liste = `/api/v1/programme/${p.id}/teilnahmen`;
    // Wer das Programm nicht sieht (kein Recht auf alle Programme), bekommt 404
    expect(await status(P.anwesenheit, "GET", liste)).toBe(404);
    // Das Programm sieht die Person nur, wenn sie es sehen darf: P.programme kann es (alle Programme sehen) und hat Einblick in die Stufe A
    expect(await status(P.programme, "GET", liste)).toBe(200);
    const andere = await legeProgrammAn(db, {
      abteilungId: abt,
      sichtbarkeit: "leitende",
      stufen: [welt.stufeBId],
      beginn: new Date("2027-06-05T13:00:00Z"),
    });
    expect(
      await status(
        P.programme,
        "GET",
        `/api/v1/programme/${andere.id}/teilnahmen`,
      ),
    ).toBe(403);
    expect(await status(sl, "GET", liste)).toBe(200);
    expect(await status(admin, "GET", liste)).toBe(200);
    expect(
      await status(
        P.anwesenheit,
        "GET",
        `/api/v1/stufen/${welt.stufeAId}/kontakte`,
      ),
    ).toBe(200);
    expect(
      await status(
        P.kinderStufeA,
        "GET",
        `/api/v1/stufen/${welt.stufeAId}/kontakte`,
      ),
    ).toBe(404);
  });

  test("Alle Programme sehen und interne Programme sehen: Rollen mit dem Recht, sonst die eigene Stufe", async () => {
    const fremd = await legeProgrammAn(db, {
      abteilungId: abt,
      sichtbarkeit: "leitende",
      stufen: [welt.stufeBId],
      beginn: new Date("2027-06-12T13:00:00Z"),
    });
    const intern = await legeProgrammAn(db, {
      abteilungId: abt,
      sichtbarkeit: "intern",
      beginn: new Date("2027-06-19T13:00:00Z"),
    });
    const fenster = "von=2027-06-01&bis=2027-06-30";
    const sieht = async (konto: PersonaKonto, extra = "") => {
      const antwort = await anfrage(
        konto,
        "GET",
        `/api/v1/programme?${fenster}${extra}`,
      );
      expect(antwort.status).toBe(200);
      return (
        (await antwort.json()) as { programme: { id: string }[] }
      ).programme.map((x) => x.id);
    };
    // Leitung A kennt Programme der Stufe B nicht, wer das Recht trägt, sieht sie
    expect(await sieht(leitung)).not.toContain(fremd.id);
    expect(await sieht(P.programme)).toContain(fremd.id);
    expect(await sieht(sl)).toContain(fremd.id);
    // Interne Programme: nur mit alle=1 und dem Recht
    expect(await sieht(P.programme)).not.toContain(intern.id);
    expect(await sieht(P.programme, "&alle=1")).toContain(intern.id);
    expect(await sieht(sl, "&alle=1")).not.toContain(intern.id);
    expect(await sieht(admin, "&alle=1")).toContain(intern.id);
    expect(
      await status(P.programme, "GET", `/api/v1/programme/${fremd.id}`),
    ).toBe(200);
    expect(await status(leitung, "GET", `/api/v1/programme/${fremd.id}`)).toBe(
      404,
    );
  });
});

describe("Mitteilungen", () => {
  const ziele = (...gruppeIds: string[]) => ({
    ziele: gruppeIds.map((gruppeId) => ({ gruppeId, rollen: ["alle"] })),
  });

  test("eine Rolle in der Gruppe sendet nur an die eigene Gruppe, je Ziel geprüft, auch in der Vorschau", async () => {
    const vorschau = `${A}/mitteilungen/vorschau`;
    expect(await status(P.mitteiler, "POST", vorschau, ziele(teamA))).toBe(200);
    expect(await status(P.mitteiler, "POST", vorschau, ziele(teamB))).toBe(403);
    // Ein erlaubtes und ein fremdes Ziel: das Ganze scheitert, es wird nichts gezählt
    expect(
      await status(P.mitteiler, "POST", vorschau, ziele(teamA, teamB)),
    ).toBe(403);
    expect(
      await status(P.mitteiler, "POST", vorschau, { empfaenger: "alle" }),
    ).toBe(403);
    expect(
      await status(P.mitteiler, "POST", vorschau, {
        empfaenger: "stufen",
        stufeIds: [welt.stufeAId],
      }),
    ).toBe(403);
    expect(
      await status(P.mitteiler, "POST", `${A}/mitteilungen`, {
        titel: "Hallo",
        ...ziele(teamB),
      }),
    ).toBe(403);
    expect(
      await status(P.mitteiler, "POST", `${A}/mitteilungen`, {
        titel: "Hallo",
        ...ziele(teamA),
      }),
    ).toBe(200);
  });

  test("ein Recht für alle Gruppen, ohne zweiten Faktor und ohne Recht", async () => {
    const vorschau = `${A}/mitteilungen/vorschau`;
    expect(
      await status(P.mitteilerAlle, "POST", vorschau, { empfaenger: "alle" }),
    ).toBe(200);
    expect(await status(P.mitteilerAlle, "POST", vorschau, ziele(teamB))).toBe(
      200,
    );
    const ohne = await legePersonaAn(welt, "elternA");
    await gruppenRolle(ohne, teamA, [
      { recht: "mitteilung.senden", geltung: "eigene" },
    ]);
    const antwort = await anfrage(ohne, "POST", vorschau, ziele(teamA));
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { code?: string }).code).toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
    for (const konto of [sl, leitung, P.verwalter]) {
      expect(await status(konto, "POST", vorschau, ziele(teamA))).toBe(403);
    }
  });
});

describe("Eigenes Profil: die Rechte der Person", () => {
  type Ich = { rechte: { recht: string; geltung: string }[] };
  const rechte = async (konto: PersonaKonto) =>
    ((await (await anfrage(konto, "GET", "/api/v1/ich")).json()) as Ich).rechte;

  test("eine Rolle in der Gruppe zeigt ihre Rechte mit Geltung, die Stufenleitung ihre Standardrechte", async () => {
    expect(await rechte(P.gruppenleitung)).toEqual(
      expect.arrayContaining([
        { recht: "gruppen.mitglieder", geltung: "eigene" },
        { recht: "personen.sehen", geltung: "alle" },
      ]),
    );
    expect(await rechte(P.verwalter)).toEqual(
      expect.arrayContaining([
        { recht: "personen.verwalten", geltung: "alle" },
      ]),
    );
    const slRechte = await rechte(sl);
    expect(slRechte).toEqual(
      expect.arrayContaining([
        { recht: "anwesenheit.fuehren", geltung: "eigene" },
        { recht: "programm.alle_sehen", geltung: "alle" },
      ]),
    );
    expect(slRechte.map((r) => r.recht)).not.toContain("personen.verwalten");
    // Die Abteilungsleitung hat alles, was nicht nur der Entwickler hat
    const alle = (await rechte(admin)).map((r) => r.recht);
    expect(alle).toEqual(
      expect.arrayContaining(["rechte.verwalten", "kinder.verwalten"]),
    );
    expect(alle).not.toContain("protokoll.lesen");
    // Strukturelles (jede Person darf es) steht nicht in der Liste
    expect(alle).not.toContain("termine.mein_kalender");
  });
});

describe("Plattformrollen: Rechte vergeben bleibt bei der Abteilungsleitung", () => {
  test("auch mit allen anderen Rechten kein Zugang zu den Plattformrollen", async () => {
    for (const konto of [P.verwalter, P.gruppenVerwalter, sl, leitung]) {
      expect(await status(konto, "GET", `${A}/plattform/rollen`)).toBe(403);
      expect(
        await status(konto, "POST", `${A}/plattform/rollen`, {
          name: "Eigene Rolle",
          rechte: [],
        }),
      ).toBe(403);
    }
    expect(await status(admin, "GET", `${A}/plattform/rollen`)).toBe(200);
  });
});
