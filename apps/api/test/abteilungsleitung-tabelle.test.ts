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
import { aktiveAdminIds } from "../src/admins.js";
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

// Die Abteilungsleitung steht in abteilungsleitung_person; user.role ist nur noch der Spiegel (#720)
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
  return ((await antwort.json()) as { admin: boolean }).admin;
};
const tabelle = (id: string) =>
  db
    .select()
    .from(schema.abteilungsleitungPerson)
    .where(eq(schema.abteilungsleitungPerson.userId, id));
const setzeRole = (id: string, role: string) =>
  db.update(schema.user).set({ role }).where(eq(schema.user.id, id));

describe("Quelle der Abteilungsleitung", () => {
  test("die Fabrik legt Tabellenzeile und Spiegel an; die Zeile genügt, role ist ohne Wirkung", async () => {
    const al = await legePersonaAn(welt, "admin");
    expect(await tabelle(al.id!)).toHaveLength(1);
    expect(await ichAdmin(al)).toBe(true);
    // Ohne Spiegel bleibt sie Abteilungsleitung
    await setzeRole(al.id!, "user");
    expect(await ichAdmin(al)).toBe(true);
    expect((await ladePerson(db, welt.testabteilungId, al.id!))?.admin).toBe(
      true,
    );
  });

  test("role = 'admin' ohne Zeile in der Tabelle macht nicht zur Abteilungsleitung", async () => {
    const konto = await legePersonaAn(welt, "slA");
    await setzeRole(konto.id!, "admin");
    expect(await ichAdmin(konto)).toBe(false);
    expect((await ladePerson(db, welt.testabteilungId, konto.id!))?.admin).toBe(
      false,
    );
    expect(await aktiveAdminIds(db, welt.testabteilungId)).not.toContain(
      konto.id,
    );
  });

  test("die Zeile eines Kontos macht es zur Abteilungsleitung, ohne dass role gesetzt ist", async () => {
    const konto = await legePersonaAn(welt, "slA");
    expect(await ichAdmin(konto)).toBe(false);
    await db
      .insert(schema.abteilungsleitungPerson)
      .values({ userId: konto.id! });
    expect(await ichAdmin(konto)).toBe(true);
    expect(await aktiveAdminIds(db, welt.testabteilungId)).toContain(konto.id);
  });

  test("das Löschen des Kontos löscht die Zeile mit", async () => {
    const konto = await legePersonaAn(welt, "admin");
    await db.delete(schema.user).where(eq(schema.user.id, konto.id!));
    expect(await tabelle(konto.id!)).toEqual([]);
  });
});

describe("PATCH /api/v1/admin/personen/:id schreibt Tabelle und Spiegel", () => {
  test("Abteilungsleitung vergeben und nehmen", async () => {
    // Eigene Welt: In einer Abteilung mit einer zweiten Abteilungsleitung ist das Zurückstufen erlaubt
    const eigene = await erstelleWelt(db, auth);
    const akteur = await legePersonaAn(eigene, "admin");
    const ziel = await legePersonaAn(eigene, "slA");
    const patch = (admin: boolean) =>
      app.request(`/api/v1/admin/personen/${ziel.id}`, {
        method: "PATCH",
        headers: { ...akteur.headers, "content-type": "application/json" },
        body: JSON.stringify({ admin }),
      });

    expect((await patch(true)).status).toBe(204);
    expect(await tabelle(ziel.id!)).toHaveLength(1);
    expect(
      (
        await db.select().from(schema.user).where(eq(schema.user.id, ziel.id!))
      )[0].role,
    ).toBe("admin");

    expect((await patch(false)).status).toBe(204);
    expect(await tabelle(ziel.id!)).toEqual([]);
    expect(
      (
        await db.select().from(schema.user).where(eq(schema.user.id, ziel.id!))
      )[0].role,
    ).toBe("user");

    // Wieder vergeben: eine zweite Zeile derselben Person gäbe es nicht
    expect((await patch(true)).status).toBe(204);
    expect((await patch(true)).status).toBe(204);
    expect(await tabelle(ziel.id!)).toHaveLength(1);
  });

  test("die Sperre des letzten Mitglieds zählt die Tabelle, nicht role", async () => {
    const eigene = await erstelleWelt(db, auth);
    const einzige = await legePersonaAn(eigene, "admin");
    // Ein Konto mit role = 'admin' ohne Zeile ist keine zweite Abteilungsleitung
    const schein = await legePersonaAn(eigene, "slA");
    await setzeRole(schein.id!, "admin");
    const antwort = await app.request(`/api/v1/admin/personen/${einzige.id}`, {
      method: "PATCH",
      headers: { ...einzige.headers, "content-type": "application/json" },
      body: JSON.stringify({ admin: false }),
    });
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({ code: "LETZTER_ADMIN" });
    expect(await tabelle(einzige.id!)).toHaveLength(1);
  });
});
