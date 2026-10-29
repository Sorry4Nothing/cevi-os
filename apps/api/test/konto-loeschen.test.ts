import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";
import { aktiveAdminIds } from "../src/admins.js";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  APP,
  bereiteAuthTestsVor,
  cookiesAus,
  erstelleTestAuth,
  PASSWORT,
  zufallsIp,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  totpCode,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();
// Jede Persona und jede Anmeldung rechnet scrypt
vi.setConfig({ hookTimeout: 120_000 });

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

type Kopfzeilen = Record<string, string>;

// Eigene Welt pro Test: Die Fälle hängen an der genauen Zahl aktiver Admins ihrer Abteilung
async function eigeneWelt(persona: Persona = "admin") {
  const welt = await erstelleWelt(db, auth);
  return { welt, konto: await legePersonaAn(welt, persona) };
}

const loesche = (headers: Kopfzeilen, passwort: unknown = PASSWORT) =>
  app.request("/api/v1/ich", {
    method: "DELETE",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ passwort }),
  });
const post = (pfad: string, headers: Kopfzeilen, body: object) =>
  app.request(pfad, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      "x-forwarded-for": zufallsIp(),
    },
    body: JSON.stringify(body),
  });
const hole = (pfad: string, headers: Kopfzeilen) =>
  app.request(pfad, { headers });
const meldeAn = (konto: PersonaKonto) =>
  post(
    "/api/auth/sign-in/username",
    { "expo-origin": APP },
    { username: konto.benutzername, password: konto.passwort },
  );

// Eine zweite Sitzung, wie die App: Anmeldung, dann der Code des zweiten Faktors
async function zweiteSitzung(welt: Welt, konto: PersonaKonto) {
  const zwischen = cookiesAus(await meldeAn(konto));
  const antwort = await post(
    "/api/auth/two-factor/verify-totp",
    { "expo-origin": APP, cookie: zwischen },
    { code: await totpCode(welt, konto.id!) },
  );
  expect(antwort.status).toBe(200);
  return { "expo-origin": APP, cookie: cookiesAus(antwort) };
}

const userZeile = async (id: string) =>
  (await db.select().from(schema.user).where(eq(schema.user.id, id)))[0];
const sitzungen = (id: string) =>
  db.select().from(schema.session).where(eq(schema.session.userId, id));
const auditZeilen = (zielId: string) =>
  db.select().from(schema.auditLog).where(eq(schema.auditLog.zielId, zielId));

// Jede Spalte der Datenbank, die Text oder eine UUID trägt, auf einen der Werte; die Liste kommt aus dem Katalog, spätere Tabellen sind also dabei
async function treffer(werte: string[]) {
  const spalten = await sql<{ tabelle: string; spalte: string }[]>`
    select table_name as tabelle, column_name as spalte
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('uuid', 'text', 'character varying', 'jsonb')`;
  const gefunden: string[] = [];
  for (const { tabelle, spalte } of spalten) {
    for (const wert of werte) {
      const zeilen = await sql`
        select 1 from ${sql(tabelle)}
        where strpos(${sql(spalte)}::text, ${wert}) > 0 limit 1`;
      if (zeilen.length > 0) gefunden.push(`${tabelle}.${spalte}`);
    }
  }
  return gefunden;
}

describe("Konto löschen", () => {
  test("nach dem Löschen zeigt keine Zeile mehr auf die Person, ausser dem Audit-Log", async () => {
    const { welt, konto: admin } = await eigeneWelt();
    const id = admin.id!;
    // Ohne zweiten Faktor allein wäre «admin» der letzte; die Sperre (#23) trifft nur /api/v1/admin/*
    await legePersonaAn(welt, "adminOhneZweitenFaktor");
    const anderesElternteil = await legePersonaAn(welt, "elternA");
    await db
      .insert(schema.rolle)
      .values({ userId: id, stufeId: welt.stufeAId, typ: "leitung" });
    await db
      .insert(schema.kindEltern)
      .values({ userId: id, kindId: welt.kindAId });
    const zweite = await zweiteSitzung(welt, admin);
    // Eine Anmeldung bleibt beim Code stehen: Die Zeile «2fa-…» trägt die ID der Person
    expect(await (await meldeAn(admin)).json()).toMatchObject({
      twoFactorRedirect: true,
    });
    const [eigeneSitzung] = await sitzungen(id);
    await db.insert(schema.pushToken).values({
      sessionId: eigeneSitzung.id,
      userId: id,
      token: randomUUID(),
      plattform: "ios",
    });
    await db.insert(schema.auditLog).values({
      abteilungId: welt.testabteilungId,
      akteurId: id,
      aktion: "zweiter_faktor_zurueckgesetzt",
      zielTyp: "person",
      zielId: id,
    });
    expect((await sitzungen(id)).length).toBeGreaterThanOrEqual(2);
    const verifikation = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.value, id));
    expect(verifikation.length).toBeGreaterThanOrEqual(1);
    const { email } = await userZeile(id);

    const antwort = await loesche(admin.headers);
    expect(antwort.status).toBe(204);
    expect(await antwort.text()).toBe("");

    expect(await userZeile(id)).toBeUndefined();
    // Nur im Audit-Log, und da nur die ID: weder Benutzername noch E-Mail-Adresse stehen irgendwo
    const mitId = await treffer([id]);
    expect(new Set(mitId)).toEqual(
      new Set(["audit_log.akteur_id", "audit_log.ziel_id"]),
    );
    expect(await treffer([admin.benutzername!, email])).toEqual([]);
    expect(await auditZeilen(id)).toHaveLength(2);
    expect(
      (await auditZeilen(id)).find((z) => z.aktion === "person_geloescht"),
    ).toMatchObject({
      abteilungId: welt.testabteilungId,
      akteurId: id,
      zielTyp: "person",
      zielId: id,
      details: null,
    });
    // Kinder sind Einträge ohne Konto, das andere Elternteil behält seine Zuordnung
    const [kind] = await db
      .select()
      .from(schema.kind)
      .where(eq(schema.kind.id, welt.kindAId));
    expect(kind).toBeDefined();
    expect(
      await db
        .select()
        .from(schema.kindEltern)
        .where(
          and(
            eq(schema.kindEltern.kindId, welt.kindAId),
            eq(schema.kindEltern.userId, anderesElternteil.id!),
          ),
        ),
    ).toHaveLength(1);

    // Beide Sitzungen sind ungültig, die Anmeldung gibt den einen Fehler
    for (const headers of [admin.headers, zweite]) {
      expect((await hole("/api/v1/ich", headers)).status).toBe(401);
    }
    const neu = await meldeAn(admin);
    expect(neu.status).toBe(401);
    expect(await neu.json()).toMatchObject({
      code: "ANMELDUNG_FEHLGESCHLAGEN",
    });
  });

  test("Eltern ohne Admin-Recht löschen ihr Konto, auch wenn sie nicht der letzte Admin sind", async () => {
    const { welt, konto: eltern } = await eigeneWelt("elternA");
    // Nur dieser eine Admin in der Abteilung: Eltern sind kein Admin und dürfen trotzdem
    await legePersonaAn(welt, "admin");
    expect((await loesche(eltern.headers)).status).toBe(204);
    expect(await userZeile(eltern.id!)).toBeUndefined();
  });
});

describe("Eingabe und Passwort", () => {
  test("falsches Passwort: 400 PASSWORT_FALSCH, Konto, Sitzungen und Audit-Log unverändert, Fehlversuch gezählt", async () => {
    const { konto } = await eigeneWelt("elternA");
    const vorher = (await sitzungen(konto.id!)).length;
    const antwort = await loesche(konto.headers, "nicht-das-passwort");
    expect(antwort.status).toBe(400);
    expect(await antwort.json()).toEqual({
      code: "PASSWORT_FALSCH",
      message: "Das Passwort stimmt nicht.",
    });
    expect(await userZeile(konto.id!)).toMatchObject({ fehlversuche: 1 });
    expect(await sitzungen(konto.id!)).toHaveLength(vorher);
    expect(await auditZeilen(konto.id!)).toEqual([]);
    expect((await hole("/api/v1/ich", konto.headers)).status).toBe(200);
  });

  test.each([
    ["leer", { passwort: "" }],
    ["kein Text", { passwort: 12 }],
    ["zu lang", { passwort: "x".repeat(129) }],
    ["fehlt", {}],
    ["zusätzliches Feld", { passwort: PASSWORT, mehr: true }],
  ])("%s: 400 UNGUELTIGE_EINGABE, Konto bleibt", async (_, body) => {
    const { konto } = await eigeneWelt("elternA");
    const antwort = await app.request("/api/v1/ich", {
      method: "DELETE",
      headers: { ...konto.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(antwort.status).toBe(400);
    expect(await antwort.json()).toMatchObject({ code: "UNGUELTIGE_EINGABE" });
    expect(await userZeile(konto.id!)).toMatchObject({ fehlversuche: 0 });
  });

  test("ohne Body: 400, Konto bleibt", async () => {
    const { konto } = await eigeneWelt("elternA");
    const antwort = await app.request("/api/v1/ich", {
      method: "DELETE",
      headers: konto.headers,
    });
    expect(antwort.status).toBe(400);
    expect(await userZeile(konto.id!)).toBeDefined();
  });

  test("ohne Sitzung: 401", async () => {
    const antwort = await loesche({ "expo-origin": APP });
    expect(antwort.status).toBe(401);
  });

  test("Bremse: fünf falsche Passwörter, dann gibt auch das richtige 429; nach der Wartezeit geht es", async () => {
    const { konto } = await eigeneWelt("elternA");
    for (let i = 0; i < 5; i++) {
      expect((await loesche(konto.headers, "falsch-falsch")).status).toBe(400);
    }
    const zeile = await userZeile(konto.id!);
    expect(zeile).toMatchObject({ fehlversuche: 5 });
    expect(zeile.naechsterVersuchAb!.getTime()).toBeGreaterThan(Date.now());

    const gesperrt = await loesche(konto.headers);
    expect(gesperrt.status).toBe(429);
    expect(await gesperrt.json()).toEqual({
      code: "ZU_VIELE_ANFRAGEN",
      message: "Zu viele Anfragen. Bitte später nochmals versuchen.",
    });
    // Ohne Prüfung und ohne Zählen
    expect((await loesche(konto.headers, "falsch-falsch")).status).toBe(429);
    expect(await userZeile(konto.id!)).toMatchObject({ fehlversuche: 5 });

    await db
      .update(schema.user)
      .set({ naechsterVersuchAb: new Date(Date.now() - 1000) })
      .where(eq(schema.user.id, konto.id!));
    expect((await loesche(konto.headers)).status).toBe(204);
  });

  test("das Löschen und die Anmeldung zählen auf demselben Zähler", async () => {
    const { konto } = await eigeneWelt("elternA");
    for (let i = 0; i < 4; i++) {
      const falsch = await post(
        "/api/auth/sign-in/username",
        { "expo-origin": APP },
        { username: konto.benutzername, password: "falsch-falsch-1" },
      );
      expect(falsch.status).toBe(401);
    }
    expect((await loesche(konto.headers, "falsch-falsch")).status).toBe(400);
    expect(
      (await userZeile(konto.id!)).naechsterVersuchAb!.getTime(),
    ).toBeGreaterThan(Date.now());
    expect((await loesche(konto.headers)).status).toBe(429);
  });
});

describe("Der letzte Admin", () => {
  const letzter = {
    code: "LETZTER_ADMIN",
    message: "Der letzte Admin lässt sich nicht entfernen.",
  };

  test("der einzige Admin bleibt: 409, nichts verändert", async () => {
    const { konto } = await eigeneWelt();
    const vorher = (await sitzungen(konto.id!)).length;
    const antwort = await loesche(konto.headers);
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toEqual(letzter);
    expect(await userZeile(konto.id!)).toBeDefined();
    expect(await sitzungen(konto.id!)).toHaveLength(vorher);
    expect(await auditZeilen(konto.id!)).toEqual([]);
  });

  test("in der Demo-Abteilung gilt dasselbe", async () => {
    const { konto } = await eigeneWelt("demoAdmin");
    const antwort = await loesche(konto.headers);
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toEqual(letzter);
    expect(await userZeile(konto.id!)).toBeDefined();
  });

  test("ein deaktivierter zweiter Admin zählt nicht", async () => {
    const { welt, konto } = await eigeneWelt();
    const zweiter = await legePersonaAn(welt, "adminOhneZweitenFaktor");
    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.id, zweiter.id!));
    expect((await loesche(konto.headers)).status).toBe(409);
    expect(await userZeile(konto.id!)).toBeDefined();
  });

  test("mit einem zweiten aktiven Admin geht es", async () => {
    const { welt, konto } = await eigeneWelt();
    const zweiter = await legePersonaAn(welt, "adminOhneZweitenFaktor");
    expect((await loesche(konto.headers)).status).toBe(204);
    expect(await aktiveAdminIds(db, welt.testabteilungId)).toEqual([
      zweiter.id,
    ]);
  });

  test("zwei Admins löschen sich gleichzeitig: einer geht, einer bleibt", async () => {
    const { welt, konto } = await eigeneWelt();
    // Mit zweitem Faktor wie im Rennen mit PATCH unten: Beide handeln auf dem eigenen Konto
    const zweiter = await legePersonaAn(welt, "admin");
    const antworten = await Promise.all([
      loesche(konto.headers),
      loesche(zweiter.headers),
    ]);
    expect(antworten.map((a) => a.status).sort()).toEqual([204, 409]);
    expect(await aktiveAdminIds(db, welt.testabteilungId)).toHaveLength(1);
  });

  test("einer löscht sich, der andere stuft sich zurück: einer geht durch, einer bekommt 409", async () => {
    const { welt, konto } = await eigeneWelt();
    // Mit zweitem Faktor: Ohne ihn sperrt #23 die Anfrage an /api/v1/admin/* vor dem Rennen
    const zweiter = await legePersonaAn(welt, "admin");
    const antworten = await Promise.all([
      loesche(konto.headers),
      app.request(`/api/v1/admin/personen/${zweiter.id}`, {
        method: "PATCH",
        headers: { ...zweiter.headers, "content-type": "application/json" },
        body: JSON.stringify({ admin: false }),
      }),
    ]);
    expect(antworten.map((a) => a.status).sort()).toEqual([204, 409]);
    expect(await aktiveAdminIds(db, welt.testabteilungId)).toHaveLength(1);
  });
});
