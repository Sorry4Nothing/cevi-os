import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TokenMessage } from "firebase-admin/messaging";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { ADMIN_PUSH_TITEL } from "../src/admin-push.js";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  fcmNachricht,
  PASSWORT,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

const fcmAttrappe = bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  fcm: fcmAttrappe,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

// Die Zeilen im Audit-Log der übrigen Aktionen prüft test/audit.test.ts (#22), hier nur das Zurücksetzen des zweiten Faktors
let welt: Welt;
let aktor: PersonaKonto;
let admin2: PersonaKonto;
let ohneFaktor: PersonaKonto;
let resetZiel: PersonaKonto;
let slA: PersonaKonto;
let elternA: PersonaKonto;
let demoAdmin: PersonaKonto;
let demoEltern: PersonaKonto;
// Die Tokens, die nach jeder Aktion einen Push bekommen: alle Admins der Testabteilung ausser dem Aktor; Aktor, SL, Eltern und Demo haben auch eines und bekommen nie etwas
let empfaenger: string[];

const neuesToken = () => `fcm-test-${randomUUID()}`;

async function melde(konto: PersonaKonto) {
  const token = neuesToken();
  const antwort = await app.request("/api/v1/push-token", {
    method: "PUT",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify({ token, plattform: "android" }),
  });
  expect(antwort.status).toBe(204);
  return token;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const lege = (persona: Persona) => legePersonaAn(welt, persona);
  [aktor, admin2, ohneFaktor, resetZiel, slA, elternA, demoAdmin, demoEltern] =
    await Promise.all([
      lege("admin"),
      lege("admin"),
      lege("adminOhneZweitenFaktor"),
      lege("admin"),
      lege("slA"),
      lege("elternA"),
      lege("demoAdmin"),
      lege("demoEltern"),
    ]);
  const [, ...andere] = await Promise.all(
    [
      aktor,
      admin2,
      ohneFaktor,
      resetZiel,
      slA,
      elternA,
      demoAdmin,
      demoEltern,
    ].map(melde),
  );
  empfaenger = andere.slice(0, 3);
});

beforeEach(() => fcmAttrappe.zuruecksetzen());

const BASIS = "/api/v1/admin/personen";

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad = "",
  body?: Record<string, unknown>,
) {
  return app.request(`${BASIS}${pfad}`, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

const benutzername = () => `person.${randomUUID().slice(0, 8)}`;

async function legeAn(
  extra: Record<string, unknown> = {},
  konto = aktor,
  name = { vorname: "Vreni", nachname: "Muster" },
) {
  const antwort = await anfrage(konto, "POST", "", {
    ...name,
    benutzername: benutzername(),
    admin: false,
    rollen: [],
    elternteilVon: [],
    ...extra,
  });
  expect(antwort.status).toBe(201);
  return (await antwort.json()) as {
    id: string;
    benutzername: string;
    startpasswort: string;
  };
}

// Eine Person ohne Admin und Rolle: das Anlegen allein löst keinen Push aus
async function legeZielAn() {
  const ziel = await legeAn();
  expect(fcmAttrappe.nachrichten).toEqual([]);
  return ziel;
}

const nachNachricht = (a: TokenMessage, b: TokenMessage) =>
  `${a.token}${a.notification?.title}`.localeCompare(
    `${b.token}${b.notification?.title}`,
  );

function erwarte(
  aktionen: (keyof typeof ADMIN_PUSH_TITEL)[],
  zielId: string,
  tokens = empfaenger,
) {
  const erwartet = aktionen
    .flatMap((aktion) =>
      tokens.map((token) =>
        fcmNachricht(token, ADMIN_PUSH_TITEL[aktion], {
          typ: "person",
          id: zielId,
        }),
      ),
    )
    .sort(nachNachricht);
  const erhalten = [...fcmAttrappe.nachrichten].sort(nachNachricht);
  // Streng: «channelId» darf nicht einmal als undefined auftauchen
  expect(erhalten).toStrictEqual(erwartet);
}

const keinPush = () => expect(fcmAttrappe.nachrichten).toEqual([]);

describe("Push an die anderen Admins", () => {
  test("neues Startpasswort", async () => {
    const ziel = await legeZielAn();
    const antwort = await anfrage(aktor, "POST", `/${ziel.id}/startpasswort`);
    expect(antwort.status).toBe(200);
    erwarte(["startpasswort_neu"], ziel.id);
  });

  test("Anlegen mit Admin, mit Stufenleitung und mit beidem", async () => {
    const admin = await legeAn({ admin: true });
    erwarte(["admin_vergeben"], admin.id);

    fcmAttrappe.zuruecksetzen();
    const sl = await legeAn({
      rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
    });
    erwarte(["stufenleitung_vergeben"], sl.id);

    // Zwei Rollen sind zwei Pushes, mehrere Stufen mit SL nur einer
    fcmAttrappe.zuruecksetzen();
    const beides = await legeAn({
      admin: true,
      rollen: [
        { stufeId: welt.stufeAId, typ: "stufenleitung" },
        { stufeId: welt.stufeBId, typ: "stufenleitung" },
      ],
    });
    erwarte(["admin_vergeben", "stufenleitung_vergeben"], beides.id);
  });

  test("Anlegen mit Leitung oder ohne Rolle: kein Push", async () => {
    await legeAn({ rollen: [{ stufeId: welt.stufeAId, typ: "leitung" }] });
    keinPush();
  });

  test("PATCH vergibt Admin nur, wenn die Person es noch nicht ist", async () => {
    const ziel = await legeZielAn();
    expect(
      (await anfrage(aktor, "PATCH", `/${ziel.id}`, { admin: true })).status,
    ).toBe(204);
    erwarte(["admin_vergeben"], ziel.id);

    fcmAttrappe.zuruecksetzen();
    await anfrage(aktor, "PATCH", `/${ziel.id}`, { admin: true });
    keinPush();

    await anfrage(aktor, "PATCH", `/${ziel.id}`, { admin: false });
    keinPush();
  });

  test("PATCH vergibt Stufenleitung bei neuer Rolle und bei Wechsel von Leitung, nicht bei Bestand oder Entzug", async () => {
    const ziel = await legeZielAn();
    const patch = (rollen: { stufeId: string; typ: string }[]) =>
      anfrage(aktor, "PATCH", `/${ziel.id}`, { rollen });
    const rolleA = (typ: string) => ({ stufeId: welt.stufeAId, typ });

    expect((await patch([rolleA("leitung")])).status).toBe(204);
    keinPush();

    expect((await patch([rolleA("stufenleitung")])).status).toBe(204);
    erwarte(["stufenleitung_vergeben"], ziel.id);

    fcmAttrappe.zuruecksetzen();
    await patch([rolleA("stufenleitung")]);
    keinPush();

    await patch([rolleA("leitung")]);
    await patch([]);
    keinPush();

    // Mehrere Stufen auf einmal: ein Push
    await patch([
      rolleA("stufenleitung"),
      { stufeId: welt.stufeBId, typ: "stufenleitung" },
    ]);
    erwarte(["stufenleitung_vergeben"], ziel.id);
  });

  test("Admin und Stufenleitung in einer Anfrage: zwei Pushes pro Token", async () => {
    const ziel = await legeZielAn();
    const antwort = await anfrage(aktor, "PATCH", `/${ziel.id}`, {
      admin: true,
      rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
    });
    expect(antwort.status).toBe(204);
    erwarte(["admin_vergeben", "stufenleitung_vergeben"], ziel.id);
  });

  test("PATCH ohne Rollenvergabe: kein Push", async () => {
    const ziel = await legeZielAn();
    const kind = welt.kindAId;
    for (const body of [
      {},
      { name: "Neuer Name" },
      { elternteilVon: [kind] },
      { elternteilVon: [] },
    ]) {
      expect((await anfrage(aktor, "PATCH", `/${ziel.id}`, body)).status).toBe(
        204,
      );
    }
    keinPush();
  });

  test("Stufenleitung für sich selbst: die anderen Admins erfahren es, der Aktor nicht", async () => {
    const antwort = await anfrage(aktor, "PATCH", `/${aktor.id}`, {
      rollen: [{ stufeId: welt.stufeBId, typ: "stufenleitung" }],
    });
    expect(antwort.status).toBe(204);
    erwarte(["stufenleitung_vergeben"], aktor.id!);
  });

  test("zweiten Faktor zurücksetzen: auch die Zielperson mit Token erfährt es, das Audit-Log bleibt", async () => {
    const antwort = await anfrage(
      aktor,
      "POST",
      `/${resetZiel.id}/zweiter-faktor-zuruecksetzen`,
    );
    expect(antwort.status).toBe(204);
    erwarte(["zweiter_faktor_zurueckgesetzt"], resetZiel.id!);
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, resetZiel.id!),
          eq(schema.auditLog.aktion, "zweiter_faktor_zurueckgesetzt"),
        ),
      );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      akteurId: aktor.id,
      zielTyp: "person",
      abteilungId: welt.testabteilungId,
    });
  });

  test("Person löschen", async () => {
    const ziel = await legeZielAn();
    const antwort = await anfrage(aktor, "DELETE", `/${ziel.id}`);
    expect(antwort.status).toBe(204);
    erwarte(["person_geloescht"], ziel.id);
  });
});

describe("kein Push", () => {
  test("deaktivieren, aktivieren, Admin und Rollen entziehen", async () => {
    const ziel = await legeAn({
      admin: true,
      rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
    });
    fcmAttrappe.zuruecksetzen();
    for (const [methode, pfad, body] of [
      ["POST", `/${ziel.id}/deaktivieren`],
      ["POST", `/${ziel.id}/aktivieren`],
      ["PATCH", `/${ziel.id}`, { admin: false, rollen: [] }],
    ] as const) {
      const antwort = await anfrage(aktor, methode, pfad, body);
      expect(antwort.status, `${methode} ${pfad}`).toBeLessThan(300);
    }
    keinPush();
  });

  test("Kind löschen und eigenes Konto löschen sind keine Admin-Aktionen an Personen", async () => {
    const [kind] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Kind",
        nachname: "Weg",
        stufeId: welt.stufeAId,
      })
      .returning();
    const kindLoeschen = await app.request(`/api/v1/admin/kinder/${kind!.id}`, {
      method: "DELETE",
      headers: aktor.headers,
    });
    expect(kindLoeschen.status).toBe(204);

    const eltern = await legePersonaAn(welt, "elternA");
    const kontoLoeschen = await app.request("/api/v1/ich", {
      method: "DELETE",
      headers: { ...eltern.headers, "content-type": "application/json" },
      body: JSON.stringify({ passwort: PASSWORT }),
    });
    expect(kontoLoeschen.status).toBe(204);
    keinPush();
  });

  test("abgelehnte Anfragen", async () => {
    const ziel = await legeZielAn();
    const faelle: [
      PersonaKonto,
      string,
      string,
      number,
      Record<string, unknown>?,
    ][] = [
      [slA, "POST", `/${ziel.id}/startpasswort`, 403],
      [slA, "DELETE", `/${ziel.id}`, 403],
      [slA, "PATCH", `/${ziel.id}`, 403, { admin: true }],
      // Admin einer anderen Abteilung sieht die Person nicht
      [demoAdmin, "POST", `/${ziel.id}/startpasswort`, 404],
      [demoAdmin, "DELETE", `/${ziel.id}`, 404],
      [demoAdmin, "POST", `/${ziel.id}/zweiter-faktor-zuruecksetzen`, 404],
      [demoAdmin, "PATCH", `/${ziel.id}`, 404, { admin: true }],
      // Eigenes Konto
      [aktor, "POST", `/${aktor.id}/startpasswort`, 409],
      [aktor, "DELETE", `/${aktor.id}`, 409],
      [aktor, "POST", `/${aktor.id}/zweiter-faktor-zuruecksetzen`, 409],
      // Keinen zweiten Faktor: der Admin ohne Faktor selbst
      [aktor, "POST", `/${ohneFaktor.id}/zweiter-faktor-zuruecksetzen`, 409],
      // Unbekanntes Feld
      [aktor, "PATCH", `/${ziel.id}`, 400, { admin: true, extra: 1 }],
      // Ohne zweiten Faktor lässt die Verwaltung den Admin nicht handeln
      [ohneFaktor, "POST", `/${ziel.id}/startpasswort`, 403],
    ];
    for (const [konto, methode, pfad, status, body] of faelle) {
      const antwort = await anfrage(konto, methode, pfad, body);
      expect(antwort.status, `${methode} ${pfad}`).toBe(status);
    }
    keinPush();
  });

  test("Demo-Abteilung und Testabteilung bleiben getrennt", async () => {
    const antwort = await anfrage(
      demoAdmin,
      "POST",
      `/${demoEltern.id}/startpasswort`,
    );
    expect(antwort.status).toBe(200);
    keinPush();
  });
});

describe("Inhalt und Ausfall", () => {
  test("Namen, Benutzername, Startpasswort und Stufen stehen in keiner Anfrage an FCM", async () => {
    const vorname = `Vorname${randomUUID().slice(0, 8)}`;
    const nachname = `Nachname${randomUUID().slice(0, 8)}`;
    const ziel = await legeAn(
      {
        admin: true,
        rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
      },
      aktor,
      { vorname, nachname },
    );
    const neu = await anfrage(aktor, "POST", `/${ziel.id}/startpasswort`);
    const { startpasswort } = (await neu.json()) as { startpasswort: string };
    await anfrage(aktor, "DELETE", `/${ziel.id}`);

    expect(fcmAttrappe.nachrichten).toHaveLength(empfaenger.length * 4);
    const text = JSON.stringify(fcmAttrappe.nachrichten);
    for (const geheim of [
      vorname,
      nachname,
      ziel.benutzername,
      ziel.startpasswort,
      startpasswort,
      "Stufe A",
      "Stufe B",
      "Testabteilung",
    ]) {
      expect(text).not.toContain(geheim);
    }
  });

  test("FCM fällt aus: gleiche Antwort, die Änderung bleibt, eine Log-Zeile", async () => {
    const zeilen: Record<string, unknown>[] = [];
    const ausgabe = vi.spyOn(console, "log").mockImplementation((zeile) => {
      zeilen.push(JSON.parse(String(zeile)) as Record<string, unknown>);
    });
    try {
      fcmAttrappe.ausfall = true;
      const ziel = await legeZielAn();
      zeilen.length = 0;

      const antwort = await anfrage(aktor, "PATCH", `/${ziel.id}`, {
        admin: true,
      });
      expect(antwort.status).toBe(204);
      expect(
        (
          await db.select().from(schema.user).where(eq(schema.user.id, ziel.id))
        )[0]?.role,
      ).toBe("admin");
      expect(zeilen.filter((z) => z.ereignis === "push")).toHaveLength(1);

      zeilen.length = 0;
      const neu = await anfrage(aktor, "POST", `/${ziel.id}/startpasswort`);
      expect(neu.status).toBe(200);
      expect(zeilen.filter((z) => z.ereignis === "push")).toHaveLength(1);

      const mitFaktor = await legePersonaAn(welt, "admin");
      zeilen.length = 0;
      const faktor = await anfrage(
        aktor,
        "POST",
        `/${mitFaktor.id}/zweiter-faktor-zuruecksetzen`,
      );
      expect(faktor.status).toBe(204);
      expect(zeilen.filter((z) => z.ereignis === "push")).toHaveLength(1);
      const audit = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.zielId, mitFaktor.id!));
      expect(audit).toHaveLength(1);
    } finally {
      ausgabe.mockRestore();
    }
  });
});
