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
import { aktiveVerwalter } from "../src/verwalter.js";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladePerson } from "../src/rechtemodell/person.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Die Abteilungsleitung steht in abteilungsleitung_person; user.role ist seit #784 immer «user» und gilt nirgends (#720)
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
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const ichAdmin = async (konto: PersonaKonto) => {
  const antwort = await app.request("/api/v1/ich", { headers: konto.headers });
  expect(antwort.status).toBe(200);
  return ((await antwort.json()) as { abteilungsleitung: boolean })
    .abteilungsleitung;
};
const tabelle = (id: string) =>
  db
    .select()
    .from(schema.abteilungsleitungPerson)
    .where(eq(schema.abteilungsleitungPerson.userId, id));
const rolleVon = async (id: string) =>
  (
    await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, id))
  )[0].role;

const aktiveIds = async (abteilungId: string) =>
  (await aktiveVerwalter(db, abteilungId)).map((v) => v.id);

describe("Quelle der Abteilungsleitung", () => {
  test("die Fabrik legt die Tabellenzeile an; sie genügt, role bleibt «user»", async () => {
    const al = await legePersonaAn(welt, "admin");
    expect(await tabelle(al.id!)).toHaveLength(1);
    expect(await ichAdmin(al)).toBe(true);
    expect(await rolleVon(al.id!)).toBe("user");
    expect(
      (await ladePerson(db, welt.testabteilungId, al.id!))?.abteilungsleitung,
    ).toBe(true);
  });

  test("die Datenbank lehnt role = 'admin' ab (CHECK user_role_nur_user), ohne Zeile in der Tabelle gibt es keine Abteilungsleitung", async () => {
    const konto = await legePersonaAn(welt, "slA");
    await expect(
      db
        .update(schema.user)
        .set({ role: "admin" })
        .where(eq(schema.user.id, konto.id!)),
    ).rejects.toHaveProperty("cause.constraint_name", "user_role_nur_user");
    expect(await ichAdmin(konto)).toBe(false);
    expect(
      (await ladePerson(db, welt.testabteilungId, konto.id!))
        ?.abteilungsleitung,
    ).toBe(false);
    expect(await aktiveIds(welt.testabteilungId)).not.toContain(konto.id);
  });

  test("die Zeile eines Kontos macht es zur Abteilungsleitung, ohne dass role gesetzt ist", async () => {
    const konto = await legePersonaAn(welt, "slA");
    expect(await ichAdmin(konto)).toBe(false);
    await db
      .insert(schema.abteilungsleitungPerson)
      .values({ userId: konto.id! });
    expect(await ichAdmin(konto)).toBe(true);
    expect(await aktiveIds(welt.testabteilungId)).toContain(konto.id);
  });

  test("das Löschen des Kontos löscht die Zeile mit", async () => {
    const konto = await legePersonaAn(welt, "admin");
    await db.delete(schema.user).where(eq(schema.user.id, konto.id!));
    expect(await tabelle(konto.id!)).toEqual([]);
  });
});

describe("PATCH /api/v1/admin/personen/:id schreibt die Tabelle, role bleibt «user»", () => {
  test("Abteilungsleitung vergeben und nehmen", async () => {
    // Eigene Welt: In einer Abteilung mit einer zweiten Abteilungsleitung ist das Zurückstufen erlaubt
    const eigene = await erstelleWelt(db, auth);
    const akteur = await legePersonaAn(eigene, "admin");
    const ziel = await legePersonaAn(eigene, "slA");
    const patch = (abteilungsleitung: boolean) =>
      app.request(`/api/v1/admin/personen/${ziel.id}`, {
        method: "PATCH",
        headers: { ...akteur.headers, "content-type": "application/json" },
        body: JSON.stringify({ abteilungsleitung }),
      });

    expect((await patch(true)).status).toBe(204);
    expect(await tabelle(ziel.id!)).toHaveLength(1);
    expect(await rolleVon(ziel.id!)).toBe("user");

    expect((await patch(false)).status).toBe(204);
    expect(await tabelle(ziel.id!)).toEqual([]);
    expect(await rolleVon(ziel.id!)).toBe("user");

    // Wieder vergeben: eine zweite Zeile derselben Person gäbe es nicht
    expect((await patch(true)).status).toBe(204);
    expect((await patch(true)).status).toBe(204);
    expect(await tabelle(ziel.id!)).toHaveLength(1);
  });

  test("die Sperre des letzten Mitglieds zählt die Tabelle", async () => {
    const eigene = await erstelleWelt(db, auth);
    const einzige = await legePersonaAn(eigene, "admin");
    // Ein Konto ohne Zeile ist keine zweite Abteilungsleitung
    await legePersonaAn(eigene, "slA");
    const antwort = await app.request(`/api/v1/admin/personen/${einzige.id}`, {
      method: "PATCH",
      headers: { ...einzige.headers, "content-type": "application/json" },
      body: JSON.stringify({ abteilungsleitung: false }),
    });
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({
      code: "LETZTE_ABTEILUNGSLEITUNG",
    });
    expect(await tabelle(einzige.id!)).toHaveLength(1);
  });
});
