import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { pgSchema, text } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { lagerSpalten } from "../../src/db/schema-lager.js";
import { raeumeAenderungenAuf } from "../../src/lager/aufraeumen.js";
import { lagerZugriff, type LagerEnv } from "../../src/lager/policy.js";
import type { LagerRolle } from "../../src/lager/rechte-katalog.js";
import {
  aendereZeile,
  LagerAntwortFehler,
  legeZeileAn,
  loescheZeile,
  registriereSchreibHaken,
  type SchreibEreignis,
} from "../../src/lager/sync.js";
import { registriereLagerTabelle } from "../../src/lager/tabellen.js";
import type { Person } from "../../src/rechte.js";
import { erstelleAenderungenRouten } from "../../src/routes/lager/aenderungen.js";
import { API_URL, BESITZER_URL } from "../hilfen/datenbank.js";

// Der Sync-Kern (#366) an zwei Tabellen, die nur dieser Test kennt (Schema lager_sync_test, nicht in einer Migration): «objekt» mit Leserecht aufgaben.lesen_alle und Zeilenfilter, «offen» mit pinnwand.lesen. Eine eigene Schema statt public, damit Tests, die alle Tabellen von public durchgehen, sie nie sehen. Die Routen sind das Muster, das ein Modul baut: lagerZugriff, dann eine Transaktion mit den Schreib-Hilfen
const sql_ = postgres(API_URL);
const besitzer = postgres(BESITZER_URL, { max: 1, onnotice: () => {} });
const db = erstelleDb(sql_);
const SCHEMA = "lager_sync_test";
afterAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.end();
  await sql_.end();
});

const testSchema = pgSchema(SCHEMA);
const objekt = testSchema.table("objekt", {
  ...lagerSpalten(),
  titel: text("titel").notNull(),
  // Nur die Lagerleitung sieht dieses Feld
  geheim: text("geheim"),
});
const offen = testSchema.table("offen", {
  ...lagerSpalten(),
  titel: text("titel").notNull(),
});
const ohneAnmeldung = testSchema.table("ohne_anmeldung", {
  ...lagerSpalten(),
});

const tabelleSql = (name: string, extra: string) => `
  create table ${SCHEMA}.${name} (
    id uuid primary key default uuidv7(),
    lager_id uuid not null references public.lager(id) on delete cascade,
    version integer not null default 1,
    erstellt_am timestamptz not null default now(),
    erstellt_von uuid,
    geaendert_am timestamptz not null default now(),
    geaendert_von uuid,
    geloescht_am timestamptz,
    geloescht_von uuid,
    lager_seq bigint not null
    ${extra}
  )`;

// Die Ansicht, die die Rolle lesen darf: nur die Lagerleitung sieht «geheim»
const ansichtFuer = (rolle: LagerRolle) => (z: typeof objekt.$inferSelect) => ({
  id: z.id,
  titel: z.titel,
  version: z.version,
  ...(rolle === "lagerleitung" ? { geheim: z.geheim } : {}),
});

const personen: Record<string, Person> = {};
let lagerId: string;
let zuId: string;
let fremdLagerId: string;
let fremdeAbteilungId: string;
let abteilungId: string;

const app = new Hono<LagerEnv>()
  .use(async (c, next) => {
    c.set("person", personen[c.req.header("x-person") ?? ""]);
    await next();
  })
  .route("/", erstelleAenderungenRouten({ db }))
  .post(
    "/:id/objekte",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten" }),
    async (c) => {
      const zugriff = c.get("lager");
      const body = (await c.req.json()) as { titel: string; geheim?: string };
      const zeile = await db.transaction((tx) =>
        legeZeileAn(
          tx,
          objekt,
          { lagerId: zugriff.lager.id, personId: c.get("person").id },
          body,
        ),
      );
      return c.json(ansichtFuer(zugriff.rolle)(zeile), 201);
    },
  )
  .patch(
    "/:id/objekte/:oid",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten" }),
    async (c) => {
      const zugriff = c.get("lager");
      const { version, ...werte } = (await c.req.json()) as {
        version: number;
        titel?: string;
        geheim?: string;
      };
      const zeile = await db.transaction((tx) =>
        aendereZeile(
          tx,
          objekt,
          { lagerId: zugriff.lager.id, personId: c.get("person").id },
          {
            id: c.req.param("oid"),
            version,
            werte,
            ansicht: ansichtFuer(zugriff.rolle),
          },
        ),
      );
      return c.json(ansichtFuer(zugriff.rolle)(zeile));
    },
  )
  .delete(
    "/:id/objekte/:oid",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten" }),
    async (c) => {
      const zugriff = c.get("lager");
      const { version } = (await c.req.json()) as { version: number };
      await db.transaction((tx) =>
        loescheZeile(
          tx,
          objekt,
          { lagerId: zugriff.lager.id, personId: c.get("person").id },
          {
            id: c.req.param("oid"),
            version,
            ansicht: ansichtFuer(zugriff.rolle),
          },
        ),
      );
      return c.body(null, 204);
    },
  )
  .post(
    "/:id/offen",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten" }),
    async (c) => {
      const zugriff = c.get("lager");
      const zeile = await db.transaction((tx) =>
        legeZeileAn(
          tx,
          offen,
          { lagerId: zugriff.lager.id, personId: c.get("person").id },
          { titel: "offen" },
        ),
      );
      return c.json({ id: zeile.id }, 201);
    },
  )
  .onError((fehler, c) => {
    if (fehler instanceof LagerAntwortFehler) {
      return c.json(fehler.body, fehler.status);
    }
    if (fehler instanceof HTTPException) {
      return c.json({ code: "HTTP" }, fehler.status);
    }
    throw fehler;
  });

const rufe = (
  person: string,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) =>
  app.request(pfad, {
    method: methode,
    headers: { "x-person": person, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const anlegen = async (person: string, titel: string, geheim?: string) =>
  (await (
    await rufe(person, "POST", `/${lagerId}/objekte`, { titel, geheim })
  ).json()) as { id: string; version: number };
const lagerSeq = async (id = lagerId) =>
  (
    await db
      .select({ seq: schema.lager.seq, seqMin: schema.lager.seqMin })
      .from(schema.lager)
      .where(eq(schema.lager.id, id))
  )[0]!;
const eintraege = (id = lagerId) =>
  db
    .select()
    .from(schema.lagerAenderung)
    .where(eq(schema.lagerAenderung.lagerId, id))
    .orderBy(asc(schema.lagerAenderung.seq));
type Feed = {
  eintraege: {
    seq: number;
    objekttyp: string;
    id: string;
    art: string;
    version: number;
  }[];
  bis: number;
  weitere: boolean;
};
const feed = async (person: string, abfrage: string, id = lagerId) => {
  const antwort = await rufe(person, "GET", `/${id}/aenderungen${abfrage}`);
  return { status: antwort.status, body: await antwort.json() };
};

beforeAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.unsafe(`create schema ${SCHEMA}`);
  await besitzer.unsafe(
    tabelleSql("objekt", ", titel text not null, geheim text"),
  );
  await besitzer.unsafe(tabelleSql("offen", ", titel text not null"));
  await besitzer.unsafe(tabelleSql("ohne_anmeldung", ""));
  await besitzer.unsafe(
    `grant usage on schema ${SCHEMA} to cevi_os_api; grant select, insert, update, delete on all tables in schema ${SCHEMA} to cevi_os_api`,
  );
  registriereLagerTabelle({
    tabelle: objekt,
    recht: "aufgaben.lesen_alle",
    // Zeilenfilter: Wer nicht Lagerleitung ist, sieht keine Zeilen, deren Titel mit «intern» beginnt (auch gelöschte nicht)
    sichtbar: async (dbx, zugriff, ids) => {
      if (zugriff.rolle === "lagerleitung") return new Set(ids);
      const zeilen = await dbx
        .select({ id: objekt.id, titel: objekt.titel })
        .from(objekt)
        .where(
          and(eq(objekt.lagerId, zugriff.lager.id), inArray(objekt.id, ids)),
        );
      return new Set(
        zeilen.filter((z) => !z.titel.startsWith("intern")).map((z) => z.id),
      );
    },
  });
  registriereLagerTabelle({ tabelle: offen, recht: "pinnwand.lesen" });

  [abteilungId, fremdeAbteilungId] = (
    await db
      .insert(schema.abteilung)
      .values([{ name: "Sync A" }, { name: "Sync B" }])
      .returning({ id: schema.abteilung.id })
  ).map((z) => z.id);
  const konto = async (name: string, abteilung: string) => {
    const [zeile] = await db
      .insert(schema.user)
      .values({
        name,
        email: `${randomUUID()}@example.org`,
        username: `sync.${randomUUID().slice(0, 8)}`,
        abteilungId: abteilung,
        mussPasswortAendern: false,
      })
      .returning({ id: schema.user.id });
    personen[name] = {
      id: zeile!.id,
      abteilungId: abteilung,
      admin: false,
      // Die Lagerleitung braucht den zweiten Faktor (#423)
      zweiterFaktor: name === "lagerleitung" || name === "fremd",
      rollen: [],
    };
  };
  await Promise.all(
    ["lagerleitung", "leitung", "team", "lesen", "ohne"].map((n) =>
      konto(n, abteilungId),
    ),
  );
  await konto("fremd", fremdeAbteilungId);
  const legeLager = async (
    abteilung: string,
    status: "aktiv" | "abgeschlossen",
  ) =>
    (
      await db
        .insert(schema.lager)
        .values({
          abteilungId: abteilung,
          titel: `Sync ${status}`,
          von: "2027-07-10",
          bis: "2027-07-24",
          status,
        })
        .returning({ id: schema.lager.id })
    )[0]!.id;
  lagerId = await legeLager(abteilungId, "aktiv");
  zuId = await legeLager(abteilungId, "abgeschlossen");
  fremdLagerId = await legeLager(fremdeAbteilungId, "aktiv");
  for (const l of [lagerId, zuId]) {
    for (const rolle of ["lagerleitung", "leitung", "team", "lesen"] as const) {
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId: l, personId: personen[rolle]!.id, rolle });
    }
  }
  // Eine Zeile der fremden Abteilung im Lager der Testabteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId,
    personId: personen.fremd!.id,
    rolle: "lagerleitung",
  });
  await db.insert(schema.lagerMitglied).values({
    lagerId: fremdLagerId,
    personId: personen.fremd!.id,
    rolle: "lagerleitung",
  });
});

describe("Schreib-Hilfen: Version und Folgenummer", () => {
  test("Anlegen: Version 1, Folgenummer 1, Eintrag «neu» im Feed ohne Inhalt", async () => {
    const antwort = await rufe("lagerleitung", "POST", `/${lagerId}/objekte`, {
      titel: "Erstes",
      geheim: "nur für die Leitung",
    });
    expect(antwort.status).toBe(201);
    const zeile = (await antwort.json()) as { id: string; version: number };
    expect(zeile.version).toBe(1);
    expect(await lagerSeq()).toEqual({ seq: 1, seqMin: 1 });
    const [eintrag] = await eintraege();
    expect(eintrag).toMatchObject({
      seq: 1,
      tabelle: "objekt",
      zeileId: zeile.id,
      art: "neu",
      version: 1,
    });
    // Der Feed-Index hat keine Spalte für Inhalte
    expect(Object.keys(eintrag!).sort()).toEqual([
      "art",
      "lagerId",
      "seq",
      "tabelle",
      "version",
      "zeileId",
      "zeitpunkt",
    ]);
    const [roh] = await db.select().from(objekt);
    expect(roh).toMatchObject({
      lagerSeq: 1,
      erstelltVon: personen.lagerleitung!.id,
      geaendertVon: personen.lagerleitung!.id,
    });
  });

  test("Ändern mit der richtigen Version: Version und Folgenummer steigen", async () => {
    const z = await anlegen("lagerleitung", "Ändern");
    const vorher = await lagerSeq();
    const antwort = await rufe(
      "leitung",
      "PATCH",
      `/${lagerId}/objekte/${z.id}`,
      { version: 1, titel: "Geändert" },
    );
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({
      titel: "Geändert",
      version: 2,
    });
    expect((await lagerSeq()).seq).toBe(vorher.seq + 1);
    const letzter = (await eintraege()).at(-1)!;
    expect(letzter).toMatchObject({
      seq: vorher.seq + 1,
      zeileId: z.id,
      art: "geaendert",
      version: 2,
    });
  });

  test("veraltete Version: 409 VERSION_KONFLIKT mit dem Stand der Rolle, ohne Folgenummer und Eintrag", async () => {
    const z = await anlegen("lagerleitung", "Konflikt", "streng geheim");
    await rufe("lagerleitung", "PATCH", `/${lagerId}/objekte/${z.id}`, {
      version: 1,
      titel: "Von A",
    });
    const vorher = await lagerSeq();
    const anzahl = (await eintraege()).length;

    // B kennt nur Version 1 und will Titel und Geheimnis setzen
    const antwort = await rufe(
      "leitung",
      "PATCH",
      `/${lagerId}/objekte/${z.id}`,
      { version: 1, titel: "Von B", geheim: "neu" },
    );
    expect(antwort.status).toBe(409);
    const text = await antwort.text();
    const body = JSON.parse(text) as {
      code: string;
      aktuell: Record<string, unknown>;
      abweichend: string[];
    };
    expect(body.code).toBe("VERSION_KONFLIKT");
    expect(body.aktuell).toEqual({ id: z.id, titel: "Von A", version: 2 });
    // Das Geheimnis sieht die Leitung nicht: weder im Stand noch als abweichendes Feld, auch nicht im Rohtext
    expect(body.abweichend).toEqual(["titel"]);
    expect(text).not.toContain("streng geheim");
    expect(text).not.toContain("geheim");
    // Rollback: keine Folgenummer verbraucht, kein Eintrag, Zeile unverändert
    expect(await lagerSeq()).toEqual(vorher);
    expect(await eintraege()).toHaveLength(anzahl);
    const [zeile] = await db.select().from(objekt).where(eq(objekt.id, z.id));
    expect(zeile).toMatchObject({ titel: "Von A", version: 2 });

    // Die Lagerleitung bekommt im Konflikt ihre Ansicht (mit dem Feld)
    const leiter = await rufe(
      "lagerleitung",
      "PATCH",
      `/${lagerId}/objekte/${z.id}`,
      { version: 1, titel: "Von A", geheim: "streng geheim" },
    );
    expect(((await leiter.json()) as { aktuell: object }).aktuell).toEqual({
      id: z.id,
      titel: "Von A",
      version: 2,
      geheim: "streng geheim",
    });
  });

  test("Zeile eines anderen Lagers oder unbekannt: 404, auch mit richtiger Version", async () => {
    // Zeile in einem zweiten Lager der Abteilung
    const zweitesLager = (
      await db
        .insert(schema.lager)
        .values({
          abteilungId,
          titel: "Zweites",
          von: "2027-07-10",
          bis: "2027-07-24",
          status: "aktiv",
        })
        .returning({ id: schema.lager.id })
    )[0]!.id;
    await db.insert(schema.lagerMitglied).values({
      lagerId: zweitesLager,
      personId: personen.lagerleitung!.id,
      rolle: "lagerleitung",
    });
    const anderswo = (await (
      await rufe("lagerleitung", "POST", `/${zweitesLager}/objekte`, {
        titel: "Anderswo",
      })
    ).json()) as { id: string };
    const vorher = await lagerSeq();
    for (const id of [anderswo.id, randomUUID()]) {
      const a = await rufe(
        "lagerleitung",
        "PATCH",
        `/${lagerId}/objekte/${id}`,
        { version: 1, titel: "x" },
      );
      expect(a.status).toBe(404);
      expect(
        (
          await rufe("lagerleitung", "DELETE", `/${lagerId}/objekte/${id}`, {
            version: 1,
          })
        ).status,
      ).toBe(404);
    }
    expect(await lagerSeq()).toEqual(vorher);
    const [bleibt] = await db
      .select()
      .from(objekt)
      .where(eq(objekt.id, anderswo.id));
    expect(bleibt).toMatchObject({ titel: "Anderswo", version: 1 });
  });

  test("Löschen: Soft-Delete mit Version +1 und Eintrag «geloescht»; danach 404", async () => {
    const z = await anlegen("lagerleitung", "Weg");
    const antwort = await rufe(
      "lagerleitung",
      "DELETE",
      `/${lagerId}/objekte/${z.id}`,
      { version: 1 },
    );
    expect(antwort.status).toBe(204);
    const [zeile] = await db.select().from(objekt).where(eq(objekt.id, z.id));
    expect(zeile).toMatchObject({
      version: 2,
      geloeschtVon: personen.lagerleitung!.id,
    });
    expect(zeile!.geloeschtAm).toBeInstanceOf(Date);
    expect((await eintraege()).at(-1)).toMatchObject({
      zeileId: z.id,
      art: "geloescht",
      version: 2,
    });
    for (const m of ["PATCH", "DELETE"]) {
      expect(
        (
          await rufe("lagerleitung", m, `/${lagerId}/objekte/${z.id}`, {
            version: 2,
            titel: "x",
          })
        ).status,
      ).toBe(404);
    }
  });

  test("veraltete Version beim Löschen: 409, die Zeile bleibt", async () => {
    const z = await anlegen("lagerleitung", "Bleibt");
    await rufe("lagerleitung", "PATCH", `/${lagerId}/objekte/${z.id}`, {
      version: 1,
      titel: "Bleibt jetzt",
    });
    const a = await rufe(
      "lagerleitung",
      "DELETE",
      `/${lagerId}/objekte/${z.id}`,
      { version: 1 },
    );
    expect(a.status).toBe(409);
    expect(((await a.json()) as { code: string }).code).toBe(
      "VERSION_KONFLIKT",
    );
    const [zeile] = await db.select().from(objekt).where(eq(objekt.id, z.id));
    expect(zeile!.geloeschtAm).toBeNull();
  });

  test("eine Tabelle ohne Anmeldung wird nicht beschrieben", async () => {
    await expect(
      db.transaction((tx) =>
        legeZeileAn(
          tx,
          ohneAnmeldung,
          { lagerId, personId: personen.lagerleitung!.id },
          {},
        ),
      ),
    ).rejects.toThrow(/nicht angemeldet/);
  });
});

describe("Folgenummer unter Parallelität", () => {
  test("gleichzeitiges Anlegen im selben Lager: Folgenummern 1 bis n ohne Lücke und Doppel", async () => {
    const lager = (
      await db
        .insert(schema.lager)
        .values({
          abteilungId,
          titel: "Parallel",
          von: "2027-07-10",
          bis: "2027-07-24",
          status: "aktiv",
        })
        .returning({ id: schema.lager.id })
    )[0]!.id;
    const n = 25;
    const ergebnisse = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        db.transaction((tx) =>
          legeZeileAn(
            tx,
            offen,
            { lagerId: lager, personId: personen.lagerleitung!.id },
            { titel: `p${i}` },
          ),
        ),
      ),
    );
    expect(new Set(ergebnisse.map((z) => z.lagerSeq)).size).toBe(n);
    expect(ergebnisse.map((z) => z.lagerSeq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
    expect((await eintraege(lager)).map((e) => e.seq)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
    expect((await lagerSeq(lager)).seq).toBe(n);
  });

  test("gleichzeitiges Ändern derselben Zeile mit derselben Version: genau ein Schreiber gewinnt, die Folgenummern bleiben lückenlos", async () => {
    const z = await anlegen("lagerleitung", "Wettlauf");
    const vorher = (await lagerSeq()).seq;
    const antworten = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        rufe("lagerleitung", "PATCH", `/${lagerId}/objekte/${z.id}`, {
          version: 1,
          titel: `Schreiber ${i}`,
        }),
      ),
    );
    const status = antworten.map((a) => a.status).sort();
    expect(status).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
    // Nur der Gewinner verbraucht eine Nummer; die Verlierer rollen zurück
    expect((await lagerSeq()).seq).toBe(vorher + 1);
    const [zeile] = await db.select().from(objekt).where(eq(objekt.id, z.id));
    expect(zeile!.version).toBe(2);
    const seqs = (await eintraege()).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });

  test("gleichzeitige Schreibvorgänge in zwei Lagern bremsen sich nicht aus und zählen getrennt", async () => {
    const [a, b] = await Promise.all(
      ["Lager A", "Lager B"].map(async (titel) => {
        const id = (
          await db
            .insert(schema.lager)
            .values({
              abteilungId,
              titel,
              von: "2027-07-10",
              bis: "2027-07-24",
              status: "aktiv",
            })
            .returning({ id: schema.lager.id })
        )[0]!.id;
        return id;
      }),
    );
    await Promise.all(
      [a!, a!, b!, a!, b!].map((lager) =>
        db.transaction((tx) =>
          legeZeileAn(
            tx,
            offen,
            { lagerId: lager, personId: personen.lagerleitung!.id },
            { titel: "x" },
          ),
        ),
      ),
    );
    expect((await lagerSeq(a)).seq).toBe(3);
    expect((await lagerSeq(b)).seq).toBe(2);
  });
});

describe("Feed", () => {
  test("Seiten mit limit: lückenlose Folge, bis und weitere führen weiter", async () => {
    const lager = (
      await db
        .insert(schema.lager)
        .values({
          abteilungId,
          titel: "Seiten",
          von: "2027-07-10",
          bis: "2027-07-24",
          status: "aktiv",
        })
        .returning({ id: schema.lager.id })
    )[0]!.id;
    await db.insert(schema.lagerMitglied).values({
      lagerId: lager,
      personId: personen.lagerleitung!.id,
      rolle: "lagerleitung",
    });
    for (let i = 0; i < 7; i++) {
      await db.transaction((tx) =>
        legeZeileAn(
          tx,
          offen,
          { lagerId: lager, personId: personen.lagerleitung!.id },
          { titel: `s${i}` },
        ),
      );
    }
    const gesehen: number[] = [];
    let seit = 0;
    let seiten = 0;
    for (;;) {
      const { status, body } = await feed(
        "lagerleitung",
        `?seit=${seit}&limit=3`,
        lager,
      );
      expect(status).toBe(200);
      const seite = body as Feed;
      gesehen.push(...seite.eintraege.map((e) => e.seq));
      seiten++;
      if (!seite.weitere) {
        expect(seite.bis).toBe(7);
        break;
      }
      expect(seite.eintraege).toHaveLength(3);
      seit = seite.bis;
    }
    expect(seiten).toBe(3);
    expect(gesehen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Auf dem aktuellen Stand: leere Seite, bis bleibt
    const { body } = await feed("lagerleitung", "?seit=7", lager);
    expect(body).toMatchObject({ eintraege: [], bis: 7, weitere: false });
  });

  test("ein Eintrag nennt nur Objekttyp, ID, Art, Version und Zeitpunkt", async () => {
    const z = await anlegen("lagerleitung", "Form", "geheim");
    const { body } = await feed("lagerleitung", "?seit=0&limit=500");
    const eintrag = (body as Feed).eintraege.find((e) => e.id === z.id)!;
    expect(Object.keys(eintrag).sort()).toEqual([
      "art",
      "id",
      "objekttyp",
      "seq",
      "version",
      "zeitpunkt",
    ]);
    expect(eintrag.objekttyp).toBe("objekt");
    expect(JSON.stringify(body)).not.toContain("Form");
  });

  test("Aufräumen: alte Einträge fallen weg, seq_min steigt, ein zu alter Stand bekommt 410", async () => {
    const lager = (
      await db
        .insert(schema.lager)
        .values({
          abteilungId,
          titel: "Alt",
          von: "2027-07-10",
          bis: "2027-07-24",
          status: "aktiv",
        })
        .returning({ id: schema.lager.id })
    )[0]!.id;
    await db.insert(schema.lagerMitglied).values({
      lagerId: lager,
      personId: personen.lagerleitung!.id,
      rolle: "lagerleitung",
    });
    for (let i = 0; i < 5; i++) {
      await db.transaction((tx) =>
        legeZeileAn(
          tx,
          offen,
          { lagerId: lager, personId: personen.lagerleitung!.id },
          { titel: `a${i}` },
        ),
      );
    }
    // Die ersten drei sind 40 Tage alt, die anderen frisch
    await db
      .update(schema.lagerAenderung)
      .set({ zeitpunkt: sql`now() - interval '40 days'` })
      .where(
        and(
          eq(schema.lagerAenderung.lagerId, lager),
          sql`${schema.lagerAenderung.seq} <= 3`,
        ),
      );
    expect(await raeumeAenderungenAuf(db)).toBeGreaterThanOrEqual(3);
    expect(await lagerSeq(lager)).toEqual({ seq: 5, seqMin: 4 });
    expect((await eintraege(lager)).map((e) => e.seq)).toEqual([4, 5]);
    // Ein zweiter Lauf ändert nichts
    await raeumeAenderungenAuf(db);
    expect(await lagerSeq(lager)).toEqual({ seq: 5, seqMin: 4 });

    const alt = await feed("lagerleitung", "?seit=1", lager);
    expect(alt.status).toBe(410);
    expect(alt.body).toMatchObject({ code: "FEED_NEU_LADEN", seq: 5 });
    expect((await feed("lagerleitung", "?seit=2", lager)).status).toBe(410);
    // seit = 3: Der nächste Eintrag (4) ist noch da, der Stand ist lückenlos
    const genau = await feed("lagerleitung", "?seit=3", lager);
    expect(genau.status).toBe(200);
    expect((genau.body as Feed).eintraege.map((e) => e.seq)).toEqual([4, 5]);
    // Eine Nummer aus der Zukunft (zurückgespieltes Lager) heisst ebenfalls neu laden
    expect((await feed("lagerleitung", "?seit=6", lager)).status).toBe(410);
    expect((await feed("lagerleitung", "?seit=5", lager)).status).toBe(200);
  });

  test("ohne «seit»: aktuelle Folgenummer und die lesbaren Objekttypen der Rolle", async () => {
    const stand = async (person: string) =>
      (await feed(person, "")).body as { seq: number; objekttypen: string[] };
    const seq = (await lagerSeq()).seq;
    expect(await stand("lagerleitung")).toEqual({
      seq,
      objekttypen: ["objekt", "offen"],
    });
    expect(await stand("leitung")).toEqual({
      seq,
      objekttypen: ["objekt", "offen"],
    });
    expect(await stand("lesen")).toEqual({
      seq,
      objekttypen: ["objekt", "offen"],
    });
    // Das Team liest nicht alle Aufgaben
    expect(await stand("team")).toEqual({ seq, objekttypen: ["offen"] });
  });

  test("ungültige Abfrage: 400, auch bei unbekanntem Schlüssel", async () => {
    for (const q of [
      "?seit=-1",
      "?seit=abc",
      "?limit=0",
      "?limit=501",
      "?x=1",
    ]) {
      expect((await feed("lagerleitung", q)).status, q).toBe(400);
    }
  });
});

describe("Feed: Rechte und Mandanten", () => {
  let intern: string;
  let normal: string;
  let startSeq: number;
  beforeAll(async () => {
    startSeq = (await lagerSeq()).seq;
    intern = (await anlegen("lagerleitung", "intern: Budget")).id;
    normal = (await anlegen("lagerleitung", "Aufgabe für alle")).id;
    // Gelöscht, aber nicht lesbar: auch der Löscheintrag bleibt verborgen
    const geloescht = (await anlegen("lagerleitung", "intern: weg")).id;
    await rufe("lagerleitung", "DELETE", `/${lagerId}/objekte/${geloescht}`, {
      version: 1,
    });
    const offene = await rufe("lagerleitung", "POST", `/${lagerId}/offen`);
    expect(offene.status).toBe(201);
  });

  const ids = (b: unknown) => (b as Feed).eintraege.map((e) => e.id);
  const typen = (b: unknown) => [
    ...new Set((b as Feed).eintraege.map((e) => e.objekttyp)),
  ];

  test("Lagerleitung sieht alle Typen und alle Zeilen", async () => {
    const { status, body } = await feed("lagerleitung", `?seit=${startSeq}`);
    expect(status).toBe(200);
    expect(ids(body)).toContain(intern);
    expect(ids(body)).toContain(normal);
    expect(typen(body).sort()).toEqual(["objekt", "offen"]);
  });

  test("Leitung sieht den Typ, aber nicht die Zeilen, die der Zeilenfilter ausschliesst (auch nicht gelöschte)", async () => {
    const { body } = await feed("leitung", `?seit=${startSeq}`);
    expect(ids(body)).toContain(normal);
    expect(ids(body)).not.toContain(intern);
    const objekte = (body as Feed).eintraege.filter(
      (e) => e.objekttyp === "objekt",
    );
    // Ein «neu» der normalen Zeile; die zwei internen Zeilen fehlen samt ihrem Löscheintrag
    expect(objekte.map((e) => e.art)).toEqual(["neu"]);
    expect(typen(body).sort()).toEqual(["objekt", "offen"]);
  });

  test("Team ohne Leserecht an «objekt» bekommt nur den Typ «offen», nie eine Zeilen-ID von objekt", async () => {
    const { body } = await feed("team", `?seit=${startSeq}`);
    expect(typen(body)).toEqual(["offen"]);
    expect(ids(body)).not.toContain(normal);
    expect(ids(body)).not.toContain(intern);
  });

  test("auch eine Seite, deren Einträge alle herausgefiltert werden, bringt den Stand voran", async () => {
    const { body } = await feed("team", `?seit=${startSeq}&limit=2`);
    const seite = body as Feed;
    expect(seite.eintraege).toEqual([]);
    expect(seite.bis).toBe(startSeq + 2);
    expect(seite.weitere).toBe(true);
  });

  test("Nicht-Mitglied und fremde Abteilung: 404 wie ein unbekanntes Lager, ohne Einträge", async () => {
    expect((await feed("ohne", "?seit=0")).status).toBe(404);
    // Die falsche Mitgliedszeile der fremden Abteilung gibt nichts frei
    expect((await feed("fremd", "?seit=0")).status).toBe(404);
    expect((await feed("lagerleitung", "?seit=0", randomUUID())).status).toBe(
      404,
    );
    expect((await feed("lagerleitung", "?seit=0", "kein-uuid")).status).toBe(
      400,
    );
    // Ein Lager der fremden Abteilung für die Testabteilung
    expect((await feed("lagerleitung", "?seit=0", fremdLagerId)).status).toBe(
      404,
    );
    // Und die fremde Abteilung sieht in ihrem eigenen Lager nichts aus unserem
    const eigen = await feed("fremd", "?seit=0", fremdLagerId);
    expect(eigen.status).toBe(200);
    expect((eigen.body as Feed).eintraege).toEqual([]);
  });

  test("Schreiben über die Route eines fremden Lagers: 404 und keine Folgenummer", async () => {
    const vorher = await lagerSeq(fremdLagerId);
    const a = await rufe("lagerleitung", "POST", `/${fremdLagerId}/objekte`, {
      titel: "Einbruch",
    });
    expect(a.status).toBe(404);
    expect(await lagerSeq(fremdLagerId)).toEqual(vorher);
  });
});

describe("abgeschlossenes Lager", () => {
  test("Schreiben ist gesperrt (409 LAGER_GESCHLOSSEN), der Feed bleibt lesbar", async () => {
    const vorher = await lagerSeq(zuId);
    for (const [methode, pfad, body] of [
      ["POST", `/${zuId}/objekte`, { titel: "Neu" }],
      ["PATCH", `/${zuId}/objekte/${randomUUID()}`, { version: 1, titel: "x" }],
      ["DELETE", `/${zuId}/objekte/${randomUUID()}`, { version: 1 }],
    ] as const) {
      const a = await rufe("lagerleitung", methode, pfad, body);
      expect(a.status, methode).toBe(409);
      expect(((await a.json()) as { code: string }).code).toBe(
        "LAGER_GESCHLOSSEN",
      );
    }
    expect(await lagerSeq(zuId)).toEqual(vorher);
    expect((await eintraege(zuId)).length).toBe(0);
    expect((await feed("lagerleitung", "?seit=0", zuId)).status).toBe(200);
    expect((await feed("team", "", zuId)).status).toBe(200);
  });
});

describe("Haken für Revisionen (#368)", () => {
  test("ein angemeldeter Haken bekommt Ereignis, Zeile vorher und nachher in der Transaktion; wirft er, bleibt nichts zurück", async () => {
    const ereignisse: SchreibEreignis[] = [];
    let werfen = false;
    registriereSchreibHaken(async (_tx, e) => {
      ereignisse.push(e);
      if (werfen) throw new Error("Haken");
    });
    const z = await anlegen("lagerleitung", "Haken");
    expect(ereignisse.at(-1)).toMatchObject({
      art: "neu",
      tabelle: "objekt",
      zeileId: z.id,
      version: 1,
      vorher: undefined,
      nachher: { titel: "Haken" },
    });
    await rufe("lagerleitung", "PATCH", `/${lagerId}/objekte/${z.id}`, {
      version: 1,
      titel: "Haken 2",
    });
    expect(ereignisse.at(-1)).toMatchObject({
      art: "geaendert",
      version: 2,
      vorher: { titel: "Haken", version: 1 },
      nachher: { titel: "Haken 2", version: 2 },
      personId: personen.lagerleitung!.id,
    });

    werfen = true;
    const vorher = await lagerSeq();
    await expect(
      db.transaction((tx) =>
        aendereZeile(
          tx,
          objekt,
          { lagerId, personId: personen.lagerleitung!.id },
          {
            id: z.id,
            version: 2,
            werte: { titel: "Nie" },
            ansicht: ansichtFuer("lagerleitung"),
          },
        ),
      ),
    ).rejects.toThrow("Haken");
    expect(await lagerSeq()).toEqual(vorher);
    const [zeile] = await db.select().from(objekt).where(eq(objekt.id, z.id));
    expect(zeile).toMatchObject({ titel: "Haken 2", version: 2 });
  });
});
