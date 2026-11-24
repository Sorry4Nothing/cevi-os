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
import { LAGER_RECHTE } from "../../src/lager/rechte-katalog.js";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { dienst } from "./wetter-hilfen.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

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
  // Kein Abruf ins Netz: Beim Anlegen mit Ort sucht der Server den Wetterort
  wetter: dienst(
    async () => [],
    async () => [],
  ),
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let demoAdmin: PersonaKonto;
let eltern: PersonaKonto;
let sl: PersonaKonto;
let leitende: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, eltern, sl, leitende] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "leitendeA"),
  ]);
});

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

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

const ADMIN = "/api/v1/admin/lager";
const LAGER = "/api/v1/lager";
const NEU = { titel: "Sommerlager", von: "2027-07-10", bis: "2027-07-24" };

type Status = (typeof schema.lager.$inferSelect)["status"];
type Rolle = (typeof schema.lagerMitglied.$inferSelect)["rolle"];

// Direkt in die Datenbank: Die Tests der Routen sollen nicht an der Anlegen-Route hängen
async function legeLager(
  status: Status = "aktiv",
  mitglieder: [PersonaKonto, Rolle][] = [],
  abteilungId = welt.testabteilungId,
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Testlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  for (const [konto, rolle] of mitglieder) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: zeile.id, personId: konto.id!, rolle });
  }
  return zeile.id;
}

const wegwerfPerson = async (
  extra: Partial<typeof schema.user.$inferInsert> = {},
) =>
  (
    await db
      .insert(schema.user)
      .values({
        name: "Wegwerf Person",
        email: `${randomUUID()}@example.org`,
        username: `wegwerf.${randomUUID().slice(0, 8)}`,
        abteilungId: welt.testabteilungId,
        mussPasswortAendern: false,
        ...extra,
      })
      .returning({ id: schema.user.id })
  )[0].id;

const zeile = async (id: string) =>
  (await db.select().from(schema.lager).where(eq(schema.lager.id, id)))[0];
const mitgliedZeile = async (lagerId: string, personId: string) =>
  (
    await db
      .select()
      .from(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, personId),
        ),
      )
  )[0];
const auditZeilen = (zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.zielId, zielId))
    .orderBy(schema.auditLog.erstelltAm);
const setzeRolle = (lagerId: string, personId: string, rolle: Rolle) =>
  anfrage(admin, "PUT", `${ADMIN}/${lagerId}/mitglieder/${personId}`, {
    rolle,
  });

describe("POST /api/v1/admin/lager", () => {
  test("legt das Lager im Entwurf an und schreibt das Audit-Log ohne Inhalte", async () => {
    const antwort = await anfrage(admin, "POST", ADMIN, {
      ...NEU,
      titel: "  Geheimer Titel  ",
      ort: "Ort Geheim",
      adresse: "Adresse Geheim",
      vorbereitungAb: "2027-06-01",
      farbe: "#AABBCC",
    });
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };
    expect(await zeile(id)).toMatchObject({
      abteilungId: welt.testabteilungId,
      titel: "Geheimer Titel",
      von: "2027-07-10",
      bis: "2027-07-24",
      vorbereitungAb: "2027-06-01",
      ort: "Ort Geheim",
      adresse: "Adresse Geheim",
      status: "entwurf",
      uebung: false,
      anlassId: null,
      farbe: "#aabbcc",
    });
    const [audit] = await auditZeilen(id);
    expect(audit).toMatchObject({
      abteilungId: welt.testabteilungId,
      akteurId: admin.id,
      aktion: "lager_angelegt",
      zielTyp: "lager",
      details: null,
    });
    expect(JSON.stringify(audit)).not.toMatch(/Geheim/);
  });

  test.each([
    ["bis vor von", { bis: "2027-07-09" }],
    ["Vorbereitung nach von", { vorbereitungAb: "2027-07-11" }],
    ["ungültiges Datum", { von: "2027-02-30" }],
    ["Datum mit Zeit", { von: "2027-07-10T00:00:00Z" }],
    ["leerer Titel", { titel: "   " }],
    ["Farbe ohne Raute", { farbe: "aabbcc" }],
    ["Farbe zu kurz", { farbe: "#abc" }],
    ["unbekanntes Feld status", { status: "aktiv" }],
    ["unbekanntes Feld anlassId", { anlassId: randomUUID() }],
    ["unbekanntes Feld uebung", { uebung: true }],
    ["unbekanntes Feld abteilungId", { abteilungId: randomUUID() }],
    ["unbekanntes Logo", { logoMediumId: randomUUID() }],
  ])("%s ist 400 und legt nichts an", async (_name, extra) => {
    const antwort = await anfrage(admin, "POST", ADMIN, { ...NEU, ...extra });
    expect(antwort.status).toBe(400);
  });

  test("Logo: ein Bild der eigenen Abteilung ja, ein PDF und ein fremdes Bild nein", async () => {
    const medium = async (abteilungId: string, mimeTyp: string) =>
      (
        await db
          .insert(schema.medium)
          .values({
            abteilungId,
            mimeTyp,
            groesse: 10,
            ...(mimeTyp === "application/pdf"
              ? {}
              : { breite: 10, hoehe: 10, altText: "Logo" }),
            sichtbarkeit: "angemeldet",
            speicherSchluessel: randomUUID(),
          })
          .returning({ id: schema.medium.id })
      )[0].id;
    const eigenesBild = await medium(welt.testabteilungId, "image/webp");
    const pdf = await medium(welt.testabteilungId, "application/pdf");
    const fremdesBild = await medium(welt.demoAbteilungId, "image/webp");
    expect(
      (await anfrage(admin, "POST", ADMIN, { ...NEU, logoMediumId: pdf }))
        .status,
    ).toBe(400);
    expect(
      (
        await anfrage(admin, "POST", ADMIN, {
          ...NEU,
          logoMediumId: fremdesBild,
        })
      ).status,
    ).toBe(400);
    const gut = await anfrage(admin, "POST", ADMIN, {
      ...NEU,
      logoMediumId: eigenesBild,
    });
    expect(gut.status).toBe(201);
    expect(
      (await zeile(((await gut.json()) as { id: string }).id)).logoMediumId,
    ).toBe(eigenesBild);
  });

  test("Lager-Rollen und Eltern dürfen nicht anlegen", async () => {
    const lagerId = await legeLager("aktiv", [[sl, "lagerleitung"]]);
    expect(lagerId).toBeDefined();
    for (const konto of [sl, eltern]) {
      expect((await anfrage(konto, "POST", ADMIN, NEU)).status).toBe(403);
    }
  });
});

describe("GET /api/v1/admin/lager und /{id}", () => {
  test("die Liste zeigt nur Lager der eigenen Abteilung", async () => {
    const eigenes = await legeLager();
    const fremdes = await legeLager("aktiv", [], welt.demoAbteilungId);
    const antwort = await anfrage(admin, "GET", ADMIN);
    expect(antwort.status).toBe(200);
    const { lager } = (await antwort.json()) as { lager: { id: string }[] };
    const ids = lager.map((l) => l.id);
    expect(ids).toContain(eigenes);
    expect(ids).not.toContain(fremdes);
  });

  test("das Lager einer anderen Abteilung ist 404, auch für deren Abteilungsleitung; alle anderen 403", async () => {
    const id = await legeLager();
    expect((await anfrage(demoAdmin, "GET", `${ADMIN}/${id}`)).status).toBe(
      404,
    );
    expect((await anfrage(eltern, "GET", `${ADMIN}/${id}`)).status).toBe(403);
    expect(
      (await anfrage(admin, "GET", `${ADMIN}/${randomUUID()}`)).status,
    ).toBe(404);
    expect((await anfrage(admin, "GET", `${ADMIN}/kein-uuid`)).status).toBe(
      400,
    );
    expect((await anfrage(admin, "GET", `${ADMIN}/${id}`)).status).toBe(200);
  });
});

describe("PATCH /api/v1/admin/lager/{id}", () => {
  test("ändert Felder, null leert, das Audit-Log nennt nur die Namen der Felder", async () => {
    const id = (
      (await (
        await anfrage(admin, "POST", ADMIN, {
          ...NEU,
          ort: "Alter Ort",
          farbe: "#112233",
        })
      ).json()) as { id: string }
    ).id;
    const antwort = await anfrage(admin, "PATCH", `${ADMIN}/${id}`, {
      titel: "Neuer Titel Geheim",
      ort: null,
      farbe: "#FFEEDD",
      bis: "2027-07-25",
    });
    expect(antwort.status).toBe(204);
    expect(await zeile(id)).toMatchObject({
      titel: "Neuer Titel Geheim",
      ort: null,
      farbe: "#ffeedd",
      bis: "2027-07-25",
      von: "2027-07-10",
    });
    const audit = (await auditZeilen(id)).filter(
      (a) => a.aktion === "lager_geaendert",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toEqual({
      felder: ["titel", "bis", "ort", "farbe"],
    });
    expect(JSON.stringify(audit)).not.toMatch(/Geheim|Alter Ort/);
  });

  test("ein leerer Body ändert nichts und schreibt kein Audit-Log", async () => {
    const id = await legeLager();
    expect((await anfrage(admin, "PATCH", `${ADMIN}/${id}`, {})).status).toBe(
      204,
    );
    expect(await auditZeilen(id)).toEqual([]);
  });

  test.each([
    ["bis vor dem gespeicherten von", { bis: "2027-07-01" }],
    ["von nach dem gespeicherten bis", { von: "2027-08-01" }],
    [
      "Vorbereitung nach dem gespeicherten von",
      { vorbereitungAb: "2027-07-11" },
    ],
    ["unbekanntes Feld uebung", { uebung: true }],
    ["unbekannter Status", { status: "geloescht" }],
  ])("%s ist 400", async (_name, felder) => {
    const id = await legeLager("entwurf");
    expect(
      (await anfrage(admin, "PATCH", `${ADMIN}/${id}`, felder)).status,
    ).toBe(400);
    expect((await zeile(id)).titel).toBe("Testlager");
  });

  test("ein abgeschlossenes oder archiviertes Lager sperrt Stammdaten (409), der Status bleibt änderbar", async () => {
    for (const status of ["abgeschlossen", "archiviert"] as const) {
      const id = await legeLager(status, [[sl, "lagerleitung"]]);
      const gesperrt = await anfrage(admin, "PATCH", `${ADMIN}/${id}`, {
        titel: "Neu",
      });
      expect(gesperrt.status).toBe(409);
      expect(await gesperrt.json()).toMatchObject({
        code: "LAGER_GESCHLOSSEN",
      });
      // Stammdaten zusammen mit dem Status sind auch gesperrt
      expect(
        (
          await anfrage(admin, "PATCH", `${ADMIN}/${id}`, {
            titel: "Neu",
            status: "aktiv",
          })
        ).status,
      ).toBe(409);
      expect((await zeile(id)).status).toBe(status);
      expect(
        (await anfrage(admin, "PATCH", `${ADMIN}/${id}`, { status: "aktiv" }))
          .status,
      ).toBe(204);
      expect((await zeile(id)).status).toBe("aktiv");
    }
  });

  test("aktiv braucht eine Lagerleitung; der Statuswechsel steht im Audit-Log", async () => {
    const id = await legeLager("entwurf", [[leitende, "leitung"]]);
    const ohne = await anfrage(admin, "PATCH", `${ADMIN}/${id}`, {
      status: "aktiv",
    });
    expect(ohne.status).toBe(409);
    expect(await ohne.json()).toMatchObject({ code: "LAGERLEITUNG_FEHLT" });
    expect((await zeile(id)).status).toBe("entwurf");

    expect((await setzeRolle(id, sl.id!, "lagerleitung")).status).toBe(204);
    expect(
      (await anfrage(admin, "PATCH", `${ADMIN}/${id}`, { status: "aktiv" }))
        .status,
    ).toBe(204);
    const audit = (await auditZeilen(id)).filter(
      (a) => a.aktion === "lager_status",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      akteurId: admin.id,
      details: { von: "entwurf", nach: "aktiv" },
    });
    // Derselbe Status noch einmal ist kein Wechsel und schreibt nichts
    await anfrage(admin, "PATCH", `${ADMIN}/${id}`, { status: "aktiv" });
    expect(
      (await auditZeilen(id)).filter((a) => a.aktion === "lager_status"),
    ).toHaveLength(1);
  });

  test("Lager-Rollen verleihen keine Verwaltung, die fremde Abteilung sieht das Lager nicht", async () => {
    const id = await legeLager("aktiv", [[sl, "lagerleitung"]]);
    expect(
      (await anfrage(sl, "PATCH", `${ADMIN}/${id}`, { titel: "X" })).status,
    ).toBe(403);
    expect(
      (await anfrage(demoAdmin, "PATCH", `${ADMIN}/${id}`, { titel: "X" }))
        .status,
    ).toBe(404);
    expect((await zeile(id)).titel).toBe("Testlager");
  });
});

describe("Mitglieder: /api/v1/admin/lager/{id}/mitglieder", () => {
  test("setzt, ändert und entfernt ein Mitglied und schreibt das Audit-Log ohne Namen", async () => {
    const id = await legeLager("entwurf");
    expect((await setzeRolle(id, leitende.id!, "team")).status).toBe(204);
    expect(await mitgliedZeile(id, leitende.id!)).toMatchObject({
      rolle: "team",
    });
    expect((await setzeRolle(id, leitende.id!, "leitung")).status).toBe(204);
    expect(await mitgliedZeile(id, leitende.id!)).toMatchObject({
      rolle: "leitung",
    });
    expect(
      (
        await anfrage(
          admin,
          "DELETE",
          `${ADMIN}/${id}/mitglieder/${leitende.id}`,
        )
      ).status,
    ).toBe(204);
    expect(await mitgliedZeile(id, leitende.id!)).toBeUndefined();
    const audit = await auditZeilen(id);
    expect(audit.map((a) => [a.aktion, a.details])).toEqual([
      [
        "mitglied_gesetzt",
        { personId: leitende.id, rolle: "team", vorher: null },
      ],
      [
        "mitglied_gesetzt",
        { personId: leitende.id, rolle: "leitung", vorher: "team" },
      ],
      ["mitglied_entfernt", { personId: leitende.id, rolle: "leitung" }],
    ]);
  });

  test("die Liste nennt Name und Rolle, nie Zugangsdaten", async () => {
    const id = await legeLager("aktiv", [
      [sl, "lagerleitung"],
      [leitende, "team"],
    ]);
    const antwort = await anfrage(admin, "GET", `${ADMIN}/${id}/mitglieder`);
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    const { mitglieder } = JSON.parse(text) as {
      mitglieder: Record<string, unknown>[];
    };
    expect(mitglieder).toHaveLength(2);
    for (const m of mitglieder) {
      expect(Object.keys(m).sort()).toEqual([
        "bildUrl",
        "ceviName",
        "name",
        "personId",
        "rolle",
      ]);
    }
    expect(text).not.toMatch(/passw|hash|secret|token|mail|username|cookie/i);
  });

  test("die Liste nennt den Pfad des Profilbilds, ohne Bild null (#668)", async () => {
    const id = await legeLager("aktiv", [
      [sl, "lagerleitung"],
      [leitende, "team"],
    ]);
    await db
      .insert(schema.profilbild)
      .values({ userId: leitende.id!, inhalt: new Uint8Array([1, 2, 3]) })
      .onConflictDoNothing();
    const { mitglieder } = (await (
      await anfrage(admin, "GET", `${ADMIN}/${id}/mitglieder`)
    ).json()) as { mitglieder: { personId: string; bildUrl: string | null }[] };
    const bild = (pid?: string | null) =>
      mitglieder.find((m) => m.personId === pid)?.bildUrl;
    expect(bild(leitende.id)).toMatch(
      new RegExp(`^/api/v1/personen/${leitende.id}/bild[?]v=[0-9]+$`),
    );
    expect(bild(sl.id)).toBeNull();
    await db
      .delete(schema.profilbild)
      .where(eq(schema.profilbild.userId, leitende.id!));
  });

  test("nur ein aktives Konto der Abteilung wird Mitglied; unbekannt, deaktiviert und fremd sind 404", async () => {
    const id = await legeLager("entwurf");
    const deaktiviert = await wegwerfPerson({
      banned: true,
      deaktiviertAm: new Date(),
    });
    const nurGesperrt = await wegwerfPerson({ banned: true });
    const fremd = await wegwerfPerson({ abteilungId: welt.demoAbteilungId });
    for (const personId of [randomUUID(), deaktiviert, nurGesperrt, fremd]) {
      expect((await setzeRolle(id, personId, "team")).status).toBe(404);
      expect(await mitgliedZeile(id, personId)).toBeUndefined();
    }
  });

  test.each([
    ["unbekannte Rolle", { rolle: "admin" }],
    ["fehlende Rolle", {}],
    [
      "ressortId (kommt mit den Ressorts)",
      { rolle: "team", ressortId: randomUUID() },
    ],
    ["unbekanntes Feld", { rolle: "team", lagerId: randomUUID() }],
  ])("%s ist 400", async (_name, body) => {
    const id = await legeLager("entwurf");
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `${ADMIN}/${id}/mitglieder/${leitende.id}`,
          body,
        )
      ).status,
    ).toBe(400);
  });

  test("ein aktives Lager behält seine letzte Lagerleitung (Rolle ändern und Entfernen), ein Entwurf nicht", async () => {
    const aktiv = await legeLager("aktiv", [
      [sl, "lagerleitung"],
      [leitende, "team"],
    ]);
    const herabstufen = await setzeRolle(aktiv, sl.id!, "leitung");
    expect(herabstufen.status).toBe(409);
    expect(await herabstufen.json()).toMatchObject({
      code: "LAGERLEITUNG_FEHLT",
    });
    const entfernen = await anfrage(
      admin,
      "DELETE",
      `${ADMIN}/${aktiv}/mitglieder/${sl.id}`,
    );
    expect(entfernen.status).toBe(409);
    expect(await entfernen.json()).toMatchObject({
      code: "LAGERLEITUNG_FEHLT",
    });
    expect(await mitgliedZeile(aktiv, sl.id!)).toMatchObject({
      rolle: "lagerleitung",
    });
    // Dieselbe Rolle erneut setzen ist kein Verlust
    expect((await setzeRolle(aktiv, sl.id!, "lagerleitung")).status).toBe(204);
    // Mit einer zweiten Lagerleitung geht beides
    expect((await setzeRolle(aktiv, leitende.id!, "lagerleitung")).status).toBe(
      204,
    );
    expect((await setzeRolle(aktiv, sl.id!, "leitung")).status).toBe(204);

    const entwurf = await legeLager("entwurf", [[sl, "lagerleitung"]]);
    expect(
      (
        await anfrage(
          admin,
          "DELETE",
          `${ADMIN}/${entwurf}/mitglieder/${sl.id}`,
        )
      ).status,
    ).toBe(204);
  });

  test("zwei gleichzeitige Herabstufungen der beiden Lagerleitungen lassen eine übrig", async () => {
    const id = await legeLager("aktiv", [
      [sl, "lagerleitung"],
      [leitende, "lagerleitung"],
    ]);
    const antworten = await Promise.all([
      setzeRolle(id, sl.id!, "lesen"),
      setzeRolle(id, leitende.id!, "lesen"),
    ]);
    expect(antworten.map((a) => a.status).sort()).toEqual([204, 409]);
    const rollen = await db
      .select({ rolle: schema.lagerMitglied.rolle })
      .from(schema.lagerMitglied)
      .where(eq(schema.lagerMitglied.lagerId, id));
    expect(rollen.filter((r) => r.rolle === "lagerleitung")).toHaveLength(1);
  });

  test("in einem abgeschlossenen Lager ändert sich kein Mitglied (409), ein fremdes Lager ist 404", async () => {
    const zu = await legeLager("abgeschlossen", [[sl, "lagerleitung"]]);
    const setzen = await setzeRolle(zu, leitende.id!, "team");
    expect(setzen.status).toBe(409);
    expect(await setzen.json()).toMatchObject({ code: "LAGER_GESCHLOSSEN" });
    expect(
      (await anfrage(admin, "DELETE", `${ADMIN}/${zu}/mitglieder/${sl.id}`))
        .status,
    ).toBe(409);
    expect(await mitgliedZeile(zu, sl.id!)).toBeDefined();
    expect(
      (
        await anfrage(
          demoAdmin,
          "PUT",
          `${ADMIN}/${zu}/mitglieder/${leitende.id}`,
          { rolle: "team" },
        )
      ).status,
    ).toBe(404);
  });

  test("Entfernen: wer kein Mitglied ist, ist 404", async () => {
    const id = await legeLager("entwurf");
    expect(
      (
        await anfrage(
          admin,
          "DELETE",
          `${ADMIN}/${id}/mitglieder/${leitende.id}`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("Rolle bei jeder Anfrage: /api/v1/lager", () => {
  test("Rollenwechsel und Entfernen wirken bei der nächsten Anfrage, ohne neue Anmeldung", async () => {
    const id = await legeLager("aktiv", [
      [sl, "lagerleitung"],
      [leitende, "team"],
    ]);
    const lies = async () => {
      const antwort = await anfrage(leitende, "GET", `${LAGER}/${id}`);
      return [
        antwort.status,
        antwort.status === 200
          ? ((await antwort.json()) as { rolle: string }).rolle
          : null,
      ];
    };
    expect(await lies()).toEqual([200, "team"]);
    expect((await setzeRolle(id, leitende.id!, "lesen")).status).toBe(204);
    expect(await lies()).toEqual([200, "lesen"]);
    expect(
      (
        await anfrage(
          admin,
          "DELETE",
          `${ADMIN}/${id}/mitglieder/${leitende.id}`,
        )
      ).status,
    ).toBe(204);
    expect(await lies()).toEqual([404, null]);
    const liste = (await (await anfrage(leitende, "GET", LAGER)).json()) as {
      lager: { id: string }[];
    };
    expect(liste.lager.map((l) => l.id)).not.toContain(id);
  });

  test("die Liste zeigt nur Lager mit Mitgliedschaft, mit der eigenen Rolle; die Abteilungsleitung alle der Abteilung", async () => {
    const mitglied = await legeLager("aktiv", [[eltern, "lesen"]]);
    const keinMitglied = await legeLager("aktiv", [[sl, "lagerleitung"]]);
    const fremdes = await legeLager("aktiv", [], welt.demoAbteilungId);
    const ids = async (konto: PersonaKonto) =>
      (
        (await (await anfrage(konto, "GET", LAGER)).json()) as {
          lager: { id: string; rolle: string }[];
        }
      ).lager;
    const meine = await ids(eltern);
    expect(meine.map((l) => l.id)).toContain(mitglied);
    expect(meine.map((l) => l.id)).not.toContain(keinMitglied);
    expect(meine.find((l) => l.id === mitglied)?.rolle).toBe("lesen");
    const alle = await ids(admin);
    expect(alle.map((l) => l.id)).toEqual(
      expect.arrayContaining([mitglied, keinMitglied]),
    );
    expect(alle.map((l) => l.id)).not.toContain(fremdes);
    expect(alle.every((l) => l.rolle === "lagerleitung")).toBe(true);
    // Die andere Abteilung sieht nichts aus der Testabteilung
    expect((await ids(demoAdmin)).map((l) => l.id)).toContain(fremdes);
    expect((await ids(demoAdmin)).map((l) => l.id)).not.toContain(mitglied);
  });

  test("das Lager gibt den Schreibschutz an und liefert weder Zugangsdaten noch interne Felder", async () => {
    const id = await legeLager("archiviert", [[sl, "team"]]);
    const antwort = await anfrage(sl, "GET", `${LAGER}/${id}`);
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    expect(JSON.parse(text)).toEqual({
      id,
      titel: "Testlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      vorbereitungAb: null,
      ort: null,
      adresse: null,
      status: "archiviert",
      farbe: null,
      logoMediumId: null,
      wetterOrt: { status: "kein_ort", name: null },
      uebung: false,
      rolle: "team",
      schreibgeschuetzt: true,
      rechte: expect.any(Array),
    });
    expect(text).not.toMatch(
      /passw|hash|secret|token|mail|username|cookie|abteilung/i,
    );
  });

  test("ein Konto ohne Mitgliedschaft und die andere Abteilung bekommen 404, unbekannt und ungültig ebenso 404 und 400", async () => {
    const id = await legeLager("aktiv", [[sl, "lagerleitung"]]);
    expect((await anfrage(eltern, "GET", `${LAGER}/${id}`)).status).toBe(404);
    expect((await anfrage(demoAdmin, "GET", `${LAGER}/${id}`)).status).toBe(
      404,
    );
    expect((await anfrage(sl, "GET", `${LAGER}/${randomUUID()}`)).status).toBe(
      404,
    );
    expect((await anfrage(sl, "GET", `${LAGER}/kein-uuid`)).status).toBe(400);
  });

  test("die Abteilungsleitung ohne Mitgliedschaft gilt als Lagerleitung", async () => {
    const id = await legeLager("entwurf");
    const antwort = await anfrage(admin, "GET", `${LAGER}/${id}`);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({ rolle: "lagerleitung" });
  });
});

describe("Datenbank", () => {
  test("ein gelöschtes Lager nimmt seine Mitglieder mit, ein gelöschtes Konto seine Mitgliedschaft", async () => {
    const id = await legeLager("aktiv");
    const person = await wegwerfPerson();
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: person, rolle: "team" });
    await db.delete(schema.user).where(eq(schema.user.id, person));
    expect(await mitgliedZeile(id, person)).toBeUndefined();
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: sl.id!, rolle: "team" });
    await db.delete(schema.lager).where(eq(schema.lager.id, id));
    expect(await mitgliedZeile(id, sl.id!)).toBeUndefined();
  });

  test("eine Person ist je Lager nur einmal Mitglied", async () => {
    const id = await legeLager("aktiv", [[sl, "team"]]);
    await expect(
      db
        .insert(schema.lagerMitglied)
        .values({ lagerId: id, personId: sl.id!, rolle: "lesen" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });
});

describe("Eigene Rechte, Übungslager und Neuigkeiten (#520)", () => {
  const detail = async (konto: PersonaKonto, id: string) =>
    (await (await anfrage(konto, "GET", `${LAGER}/${id}`)).json()) as {
      uebung: boolean;
      rechte: string[];
    };

  test("das Lager nennt die Rechte der eigenen Rolle, nie die anderer Rollen", async () => {
    const id = await legeLager("aktiv", [
      [leitende, "team"],
      [sl, "leitung"],
    ]);
    const team = (await detail(leitende, id)).rechte;
    expect(team).toEqual(
      expect.arrayContaining(["aufgaben.eigene", "einteilung.lesen"]),
    );
    expect(team).not.toContain("aufgaben.bearbeiten");
    expect(team).not.toContain("ressorts.bearbeiten");
    const leitung = (await detail(sl, id)).rechte;
    expect(leitung).toContain("aufgaben.bearbeiten");
    expect(leitung).not.toContain("ressorts.bearbeiten");
    // Die Lagerleitung und die Abteilungsleitung haben jedes Recht des Katalogs
    expect((await detail(admin, id)).rechte).toEqual(
      expect.arrayContaining([...LAGER_RECHTE]),
    );
    expect((await detail(admin, id)).rechte).toHaveLength(LAGER_RECHTE.length);
  });

  test("eine eingestellte Änderung wirkt bei der nächsten Anfrage ohne zusätzliche Abfrage der Rechte", async () => {
    const id = await legeLager("aktiv", [[leitende, "team"]]);
    expect((await detail(leitende, id)).rechte).toContain("einteilung.lesen");
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "team",
      recht: "einteilung.lesen",
      erlaubt: false,
    });
    expect((await detail(leitende, id)).rechte).not.toContain(
      "einteilung.lesen",
    );
  });

  test("die Liste und das Detail nennen uebung", async () => {
    const id = await legeLager("aktiv", [[leitende, "team"]]);
    await db
      .update(schema.lager)
      .set({ uebung: true })
      .where(eq(schema.lager.id, id));
    expect((await detail(leitende, id)).uebung).toBe(true);
    const liste = (await (await anfrage(leitende, "GET", LAGER)).json()) as {
      lager: { id: string; uebung: boolean }[];
    };
    expect(liste.lager.find((l) => l.id === id)?.uebung).toBe(true);
  });

  test("Neuigkeiten: je Lager ein Punkt bei ungelesenen Benachrichtigungen, ohne Inhalte", async () => {
    const mitNeuem = await legeLager("aktiv", [[leitende, "team"]]);
    const ohneNeues = await legeLager("aktiv", [[leitende, "team"]]);
    const fremd = await legeLager("aktiv", [[sl, "lagerleitung"]]);
    const [b] = await db
      .insert(schema.lagerBenachrichtigung)
      .values({
        lagerId: mitNeuem,
        personId: leitende.id!,
        art: "aufgabe_zugeteilt",
        objektTyp: "aufgabe",
        objektId: randomUUID(),
      })
      .returning({ id: schema.lagerBenachrichtigung.id });
    // Eine ungelesene Benachrichtigung einer anderen Person zählt nicht
    await db.insert(schema.lagerBenachrichtigung).values({
      lagerId: ohneNeues,
      personId: sl.id!,
      art: "aufgabe_zugeteilt",
      objektTyp: "aufgabe",
      objektId: randomUUID(),
    });
    const lesen = async () => {
      const antwort = await anfrage(leitende, "GET", `${LAGER}/neuigkeiten`);
      expect(antwort.status).toBe(200);
      return (await antwort.json()) as {
        lager: { lagerId: string; neu: boolean }[];
        programme: { neu: boolean };
      };
    };
    const vorher = await lesen();
    expect(vorher.lager.find((l) => l.lagerId === mitNeuem)?.neu).toBe(true);
    expect(vorher.lager.find((l) => l.lagerId === ohneNeues)?.neu).toBe(false);
    // Kein Lager ohne Mitgliedschaft
    expect(vorher.lager.map((l) => l.lagerId)).not.toContain(fremd);
    expect(Object.keys(vorher.lager[0]!).sort()).toEqual(["lagerId", "neu"]);
    expect(typeof vorher.programme.neu).toBe("boolean");
    await db
      .update(schema.lagerBenachrichtigung)
      .set({ gelesenAm: new Date() })
      .where(eq(schema.lagerBenachrichtigung.id, b!.id));
    expect((await lesen()).lager.find((l) => l.lagerId === mitNeuem)?.neu).toBe(
      false,
    );
  });

  test("Neuigkeiten: ohne Anmeldung 401", async () => {
    expect((await app.request(`${LAGER}/neuigkeiten`)).status).toBe(401);
  });
});
