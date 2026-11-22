import { randomUUID } from "node:crypto";
import { eq, sql as sqlRaw } from "drizzle-orm";
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
import { erstelleSchalterZustand } from "../../src/bereichsschalter.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { dateiVerweisTabellen } from "../../src/lager/datei-verweise.js";
import { getTableName } from "drizzle-orm";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

bereiteAuthTestsVor();

// Lager löschen (#400) gegen die ganze App. Wartung: der Schalter je Bereich «lager» (#424), kein eigener je Lager
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const schalter = erstelleSchalterZustand();
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  schalter,
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let lagerleitung: PersonaKonto;
let leitung: PersonaKonto;
let eltern: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, adminOhne, demoAdmin, lagerleitung, leitung, eltern] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "adminOhneZweitenFaktor"),
      legePersonaAn(welt, "demoAdmin"),
      legePersonaMitFaktorAn(welt, "slA"),
      legePersonaAn(welt, "leitendeA"),
      legePersonaAn(welt, "elternA"),
    ]);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  ausgabe.mockRestore();
  schalter.hebeAuf(welt.testabteilungId, "lager", "wartung");
});

const anfrage = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) =>
  app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });

type Status = (typeof schema.lager.$inferSelect)["status"];
const TITEL = "Sommerlager Löschtest";

async function legeLager(
  status: Status,
  extra: Partial<typeof schema.lager.$inferInsert> = {},
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: TITEL,
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
      ...extra,
    })
    .returning({ id: schema.lager.id });
  return zeile.id;
}
const loesche = (konto: PersonaKonto, id: string, titel: string = TITEL) =>
  anfrage(konto, "DELETE", `/api/v1/admin/lager/${id}`, { titel });
const gibtEs = async (id: string) =>
  (await db.select().from(schema.lager).where(eq(schema.lager.id, id)))
    .length === 1;

// Alle Tabellen mit einer Spalte lager_id, aus dem Schema abgeleitet: Ein neues Modul ist ohne weiteres Zutun dabei
const tabellenMitLagerId = async () =>
  (
    await db.execute<{ tabelle: string }>(sqlRaw`
      select table_name as tabelle from information_schema.columns
      where table_schema = 'public' and column_name = 'lager_id'
        and table_name in (select table_name from information_schema.tables where table_type = 'BASE TABLE')
      order by 1`)
  ).map((z) => z.tabelle);
const zaehle = async (tabelle: string, lagerId: string) =>
  Number(
    (
      await db.execute<{ n: string }>(
        sqlRaw`select count(*) as n from ${sqlRaw.identifier(tabelle)} where lager_id = ${lagerId}`,
      )
    )[0].n,
  );

describe("Schema: nichts hängt am Lager fest", () => {
  test("jede Tabelle mit lager_id hängt über ON DELETE CASCADE am Lager (direkt oder über ihre Eltern-Tabelle)", async () => {
    const tabellen = await tabellenMitLagerId();
    expect(tabellen.length).toBeGreaterThan(50);
    const erreicht = new Set(
      (
        await db.execute<{ tabelle: string }>(sqlRaw`
          with recursive kaskade(oid) as (
            select 'public.lager'::regclass::oid
            union
            select c.conrelid::oid from pg_constraint c
            join kaskade k on c.confrelid = k.oid
            where c.contype = 'f' and c.confdeltype = 'c'
          )
          select c.relname as tabelle from kaskade k join pg_class c on c.oid = k.oid`)
      ).map((z) => z.tabelle),
    );
    expect(tabellen.filter((t) => !erreicht.has(t))).toEqual([]);
  });

  test("jeder Fremdschlüssel auf lager kaskadiert oder leert nur seine Spalte", async () => {
    const zeilen = await db.execute<{ tabelle: string; aktion: string }>(
      sqlRaw`select conrelid::regclass::text as tabelle, confdeltype::text as aktion
        from pg_constraint where contype = 'f' and confrelid = 'public.lager'::regclass
          and confdeltype not in ('c', 'n')`,
    );
    expect(zeilen).toEqual([]);
  });

  test("jede Tabelle, die auf lager_datei zeigt, ist im Verweisregister (sonst hielte RESTRICT das Löschen auf)", async () => {
    const zeilen = await db.execute<{ tabelle: string }>(sqlRaw`
      select distinct conrelid::regclass::text as tabelle from pg_constraint
      where contype = 'f' and confrelid = 'public.lager_datei'::regclass
        and confdeltype in ('r', 'a') and conrelid <> 'public.lager_datei'::regclass`);
    const angemeldet = new Set(
      dateiVerweisTabellen().map((t) => getTableName(t)),
    );
    expect(
      zeilen.map((z) => z.tabelle).filter((t) => !angemeldet.has(t)),
    ).toEqual([]);
  });
});

// Eine Zeile in möglichst vielen Tabellen, darunter die ohne Feed und die persönlichen
async function fuelle(lagerId: string) {
  const person = lagerleitung.id!;
  const seq = { lagerSeq: 1 };
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId, personId: person, rolle: "lagerleitung" });
  await db.insert(schema.lagerRolleRecht).values({
    lagerId,
    rolle: "team",
    recht: "aufgaben.eigene",
    erlaubt: true,
  });
  await db.insert(schema.lagerAenderung).values({
    lagerId,
    seq: 1,
    tabelle: "aufgabe",
    zeileId: randomUUID(),
    art: "neu",
    version: 1,
  });
  await db.insert(schema.lagerClientOp).values({
    lagerId,
    personId: person,
    clientOpId: randomUUID(),
    ergebnis: { ok: true },
  });
  await db.insert(schema.eingang).values({
    lagerId,
    art: "idee",
    text: "Idee",
    anonym: false,
    personId: person,
  });
  await db
    .insert(schema.adressbuchKontakt)
    .values({ lagerId, name: "Kontakt Erfunden", ...seq });
  await db
    .insert(schema.todoPrivat)
    .values({ lagerId, personId: person, text: "Zelt prüfen" });
  const [punkt] = await db
    .insert(schema.packlistePunkt)
    .values({ lagerId, abschnitt: "Kleider", text: "Socken", ...seq })
    .returning({ id: schema.packlistePunkt.id });
  await db.insert(schema.packlisteAbhaken).values({
    lagerId,
    personId: person,
    punktId: punkt.id,
    zustand: "abgehakt",
  });
  await db
    .insert(schema.packlisteEigen)
    .values({ lagerId, personId: person, abschnitt: "Kleider", text: "Mütze" });
  await db.insert(schema.erwaehnung).values({
    lagerId,
    quelleTyp: "aufgabe",
    quelleId: randomUUID(),
    personId: person,
  });
  await db
    .insert(schema.wetterCache)
    .values({ lagerId, breite: 47, laenge: 8, versuchAm: new Date() });
  await db.insert(schema.aufgabe).values({ lagerId, titel: "Aufgabe", ...seq });
  // Beitrag mit Umfrage, Option, Stimme
  const [beitrag] = await db
    .insert(schema.pinnwandBeitrag)
    .values({ lagerId, titel: "Beitrag", ...seq })
    .returning({ id: schema.pinnwandBeitrag.id });
  const [umfrage] = await db
    .insert(schema.umfrage)
    .values({ lagerId, beitragId: beitrag.id, ...seq })
    .returning({ id: schema.umfrage.id });
  const [option] = await db
    .insert(schema.umfrageOption)
    .values({ lagerId, umfrageId: umfrage.id, text: "Ja", ...seq })
    .returning({ id: schema.umfrageOption.id });
  await db.insert(schema.umfrageStimme).values({
    lagerId,
    umfrageId: umfrage.id,
    optionId: option.id,
    personId: person,
    ...seq,
  });
  // Dateien: der Link ist eingebunden (Dokument, Pinnwand), RESTRICT darf das Löschen nicht aufhalten
  const link = {
    anzeigename: "Plan.pdf",
    link: "https://beispiel.sharepoint.com/plan.pdf",
    ...seq,
  };
  const [d1, d2] = await db
    .insert(schema.lagerDatei)
    .values([
      { lagerId, ...link },
      { lagerId, ...link, anzeigename: "Karte.pdf" },
    ])
    .returning({ id: schema.lagerDatei.id });
  await db
    .insert(schema.dokument)
    .values({ lagerId, titel: "Plan", dateiId: d1.id, ...seq });
  await db
    .insert(schema.pinnwandDatei)
    .values({ lagerId, beitragId: beitrag.id, dateiId: d2.id, ...seq });
}

describe("DELETE /api/v1/admin/lager/{id}", () => {
  test("entfernt alles: keine Tabelle mit lager_id behält eine Zeile", async () => {
    const id = await legeLager("archiviert");
    // Eine Nachbar-Lager mit denselben Daten bleibt unberührt
    const nachbar = await legeLager("archiviert", { titel: "Nachbar" });
    await fuelle(id);
    await fuelle(nachbar);
    const tabellen = await tabellenMitLagerId();
    const vorher: Record<string, number> = {};
    for (const t of tabellen) vorher[t] = await zaehle(t, id);
    // Das Seed trifft die Tabellen, die der Auftrag nennt
    for (const t of [
      "lager_mitglied",
      "lager_rolle_recht",
      "lager_aenderung",
      "eingang",
      "adressbuch_kontakt",
      "todo_privat",
      "packliste_abhaken",
      "packliste_eigen",
      "umfrage",
      "umfrage_option",
      "umfrage_stimme",
      "erwaehnung",
      "wetter_cache",
      "lager_datei",
      "dokument",
      "pinnwand_datei",
    ]) {
      expect(vorher[t], t).toBeGreaterThan(0);
    }

    const antwort = await loesche(admin, id);
    expect(antwort.status).toBe(204);

    expect(await gibtEs(id)).toBe(false);
    const geblieben: string[] = [];
    for (const t of tabellen) {
      if ((await zaehle(t, id)) !== 0) geblieben.push(t);
    }
    expect(geblieben).toEqual([]);
    // Das andere Lager hat alles behalten
    expect(await gibtEs(nachbar)).toBe(true);
    for (const t of Object.keys(vorher).filter((t) => vorher[t] > 0)) {
      expect(await zaehle(t, nachbar), t).toBeGreaterThan(0);
    }
  });

  test("Audit-Log ohne Inhalte: nur Lagerkennung und Anzahl", async () => {
    const id = await legeLager("entwurf");
    await fuelle(id);
    expect((await loesche(admin, id)).status).toBe(204);
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id))
      .then((z) => z.filter((e) => e.aktion === "lager_geloescht"));
    expect(eintrag).toMatchObject({
      akteurId: admin.id,
      zielTyp: "lager",
      zielId: id,
      details: { dateien: 2 },
    });
    expect(JSON.stringify(eintrag)).not.toContain(TITEL);
  });

  test.each(["entwurf", "archiviert"] as const)(
    "Status %s lässt sich löschen",
    async (status) => {
      const id = await legeLager(status);
      expect((await loesche(admin, id)).status).toBe(204);
      expect(await gibtEs(id)).toBe(false);
    },
  );

  test("ein Übungslager lässt sich in jedem Status löschen", async () => {
    const id = await legeLager("aktiv", { uebung: true });
    expect((await loesche(admin, id)).status).toBe(204);
    expect(await gibtEs(id)).toBe(false);
  });

  test.each(["aktiv", "abgeschlossen"] as const)(
    "Status %s: 409, das Lager bleibt",
    async (status) => {
      const id = await legeLager(status);
      await fuelle(id);
      const antwort = await loesche(admin, id);
      expect(antwort.status).toBe(409);
      expect((await antwort.json()).code).toBe("LAGER_NICHT_LOESCHBAR");
      expect(await gibtEs(id)).toBe(true);
      expect(await zaehle("dokument", id)).toBe(1);
    },
  );

  test("falscher Titel: 400, das Lager bleibt", async () => {
    const id = await legeLager("archiviert");
    expect((await loesche(admin, id, "Anderer Titel")).status).toBe(400);
    expect((await loesche(admin, id, TITEL.toLowerCase())).status).toBe(400);
    expect(await gibtEs(id)).toBe(true);
  });

  test("ohne Titel oder mit weiteren Feldern: 400", async () => {
    const id = await legeLager("archiviert");
    const pfad = `/api/v1/admin/lager/${id}`;
    expect((await anfrage(admin, "DELETE", pfad, {})).status).toBe(400);
    expect(
      (await anfrage(admin, "DELETE", pfad, { titel: TITEL, force: true }))
        .status,
    ).toBe(400);
    expect(await gibtEs(id)).toBe(true);
  });

  test("Abteilungsleitung ohne zweiten Faktor: 403", async () => {
    const id = await legeLager("archiviert");
    const antwort = await loesche(adminOhne, id);
    expect(antwort.status).toBe(403);
    expect((await antwort.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
    expect(await gibtEs(id)).toBe(true);
  });

  test("Lagerleitung, Leitung und Konto ohne Rechte: 403", async () => {
    const id = await legeLager("archiviert");
    await db.insert(schema.lagerMitglied).values([
      { lagerId: id, personId: lagerleitung.id!, rolle: "lagerleitung" },
      { lagerId: id, personId: leitung.id!, rolle: "leitung" },
    ]);
    for (const konto of [lagerleitung, leitung, eltern]) {
      expect((await loesche(konto, id)).status).toBe(403);
    }
    expect(await gibtEs(id)).toBe(true);
  });

  test("fremde Abteilung und unbekanntes Lager: 404, auch mit falschem Titel", async () => {
    const id = await legeLager("archiviert");
    expect((await loesche(demoAdmin, id)).status).toBe(404);
    expect((await loesche(demoAdmin, id, "egal")).status).toBe(404);
    expect((await loesche(admin, randomUUID())).status).toBe(404);
    expect(await gibtEs(id)).toBe(true);
  });

  test("ohne Anmeldung: 401", async () => {
    const id = await legeLager("archiviert");
    const antwort = await app.request(`/api/v1/admin/lager/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titel: TITEL }),
    });
    expect(antwort.status).toBe(401);
  });

  test("ungültige ID: 400", async () => {
    expect((await loesche(admin, "kein-uuid")).status).toBe(400);
  });
});

describe("Wartung des Bereichs «lager» (#424) und Löschen", () => {
  const wartung = () =>
    schalter.setze({
      id: randomUUID(),
      abteilungId: welt.testabteilungId,
      bereich: "lager",
      art: "wartung",
      hinweis: "Umbau",
      ende: null,
      websiteOffline: false,
      ausgeloestVon: admin.id!,
      ausgeloestAm: new Date(),
    });

  test("in Wartung blockiert der Schalter jede schreibende Lager-Route, auch die Warteschlange; Lesen bleibt", async () => {
    const id = await legeLager("aktiv");
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const warteschlange = () =>
      anfrage(lagerleitung, "POST", `/api/v1/lager/${id}/aenderungen`, {
        operationen: [
          { clientOpId: randomUUID(), typ: "gibt.es.nicht", nutzlast: {} },
        ],
      });
    // Ohne Wartung erreicht die Anfrage die Route
    expect((await warteschlange()).status).toBe(200);

    wartung();
    const gesperrt = await warteschlange();
    expect(gesperrt.status).toBe(503);
    expect((await gesperrt.json()).code).toBe("IN_WARTUNG");
    expect(
      (
        await anfrage(lagerleitung, "PUT", `/api/v1/lager/${id}/rechte`, {
          rechte: [],
        })
      ).status,
    ).toBe(503);
    expect(
      (await anfrage(lagerleitung, "GET", `/api/v1/lager/${id}`)).status,
    ).toBe(200);
  });

  test("die Abteilungsleitung kann in Wartung löschen (die Verwaltung bleibt erreichbar)", async () => {
    const id = await legeLager("archiviert");
    wartung();
    expect((await loesche(admin, id)).status).toBe(204);
  });
});
