import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { pgSchema, uuid } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { lagerSpalten } from "../../src/db/schema-lager.js";
import {
  DATEI_RECHTE,
  ladeDateien,
  LINK_MAX,
  pruefeDateiImLager,
  pruefeLink,
} from "../../src/lager/datei.js";
import {
  entferneDateiVerweis,
  raeumeDateienOhneVerweisAuf,
  registriereDateiVerweis,
} from "../../src/lager/datei-verweise.js";
import type { LagerEnv } from "../../src/lager/policy.js";
import { LagerAntwortFehler, legeZeileAn } from "../../src/lager/sync.js";
import { erstelleAdminLagerDateiRouten } from "../../src/routes/admin/lager-dateien.js";
import { erstelleAenderungenRouten } from "../../src/routes/lager/aenderungen.js";
import { erstelleLagerDateiRouten } from "../../src/routes/lager/dateien.js";
import type { Person } from "../../src/rechte.js";
import { API_URL, BESITZER_URL } from "../hilfen/datenbank.js";

const sql_ = postgres(API_URL);
const besitzer = postgres(BESITZER_URL, { max: 1, onnotice: () => {} });
const db = erstelleDb(sql_);
const SCHEMA = "lager_datei_test";
afterAll(async () => {
  entferneDateiVerweis(beitrag.datei);
  entferneDateiVerweis(intern.datei);
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.end();
  await sql_.end();
});

// Zwei Tabellen, die auf lager_datei zeigen und nur dieser Test kennt (eigenes Schema, nicht in einer Migration): «beitrag» mit pinnwand.lesen (Team darf lesen), «intern» mit dokumente.lesen_alle (Team darf nicht)
const testSchema = pgSchema(SCHEMA);
const beitrag = testSchema.table("beitrag", {
  ...lagerSpalten(),
  datei: uuid("datei_id").references(() => schema.lagerDatei.id),
});
const intern = testSchema.table("intern", {
  ...lagerSpalten(),
  datei: uuid("datei_id").references(() => schema.lagerDatei.id),
});
const tabelleSql = (name: string) => `
  create table ${SCHEMA}.${name} (
    id uuid primary key default uuidv7(),
    lager_id uuid not null references public.lager(id) on delete cascade,
    version integer not null default 1,
    erstellt_am timestamptz not null default now(),
    erstellt_von uuid,
    geaendert_am timestamptz not null default now(),
    geaendert_von uuid,
    lager_seq bigint not null default 0,
    datei_id uuid references public.lager_datei(id) on delete restrict
  )`;

const personen: Record<string, Person> = {};
let abteilungId: string;
let fremdeAbteilungId: string;
let lagerId: string;
let zuId: string;
let fremdLagerId: string;

const app = new Hono<LagerEnv>()
  .use(async (c, next) => {
    c.set("person", personen[c.req.header("x-person") ?? ""]!);
    await next();
  })
  .route("/", erstelleAenderungenRouten({ db }))
  .route("/", erstelleLagerDateiRouten({ db }))
  .route("/admin", erstelleAdminLagerDateiRouten({ db }))
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
const GUT =
  "https://cevi.sharepoint.com/sites/lager/Shared%20Documents/Plan.pdf";
const anlegen = (
  person: string,
  extra: Record<string, unknown> = {},
  id = lagerId,
) =>
  rufe(person, "POST", `/${id}/dateien`, {
    anzeigename: "Lagerplan",
    link: GUT,
    ...extra,
  });
// Über den Sync-Kern statt über die Route, damit das Rate-Limit der Route nur dort gezählt wird, wo es geprüft wird
const neueDatei = async (person = "leitung", id = lagerId) => {
  const zeile = await db.transaction((tx) =>
    legeZeileAn(
      tx,
      schema.lagerDatei,
      { lagerId: id, personId: personen[person]!.id },
      { anzeigename: "Lagerplan", link: GUT },
    ),
  );
  return { id: zeile.id, version: zeile.version };
};
const binde = (tabelle: typeof beitrag | typeof intern, dateiId: string) =>
  db
    .insert(tabelle as typeof beitrag)
    .values({
      lagerId,
      lagerSeq: 0,
      datei: dateiId,
    })
    .returning({ id: beitrag.id });

beforeAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.unsafe(`create schema ${SCHEMA}`);
  await besitzer.unsafe(tabelleSql("beitrag"));
  await besitzer.unsafe(tabelleSql("intern"));
  await besitzer.unsafe(
    `grant usage on schema ${SCHEMA} to cevi_os_api; grant select, insert, update, delete on all tables in schema ${SCHEMA} to cevi_os_api`,
  );
  registriereDateiVerweis({
    tabelle: beitrag,
    spalte: beitrag.datei,
    recht: "pinnwand.lesen",
  });
  registriereDateiVerweis({
    tabelle: intern,
    spalte: intern.datei,
    recht: "dokumente.lesen_alle",
  });

  [abteilungId, fremdeAbteilungId] = (
    await db
      .insert(schema.abteilung)
      .values([{ name: "Datei A" }, { name: "Datei B" }])
      .returning({ id: schema.abteilung.id })
  ).map((z) => z.id);
  const konto = async (name: string, abteilung: string, admin = false) => {
    const [zeile] = await db
      .insert(schema.user)
      .values({
        name,
        email: `${randomUUID()}@example.org`,
        username: `datei.${randomUUID().slice(0, 8)}`,
        abteilungId: abteilung,
        mussPasswortAendern: false,
      })
      .returning({ id: schema.user.id });
    personen[name] = {
      id: zeile!.id,
      abteilungId: abteilung,
      abteilungsleitung: admin,
      entwickler: false,
      // Die Lagerleitung braucht den zweiten Faktor (#423); dieser Test prüft die Rechte der Dateien, nicht ihn
      zweiterFaktor: true,
      rollen: [],
    };
  };
  await Promise.all(
    ["lagerleitung", "leitung", "team", "lesen", "ohne", "viel"].map((n) =>
      konto(n, abteilungId),
    ),
  );
  await konto("admin", abteilungId, true);
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
          titel: `Datei ${status}`,
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
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId, personId: personen.viel!.id, rolle: "lagerleitung" });
  // Die fremde Abteilung mit einer Zeile im Lager der Testabteilung gibt nichts frei
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

describe("Link-Prüfung mit bösen Eingaben", () => {
  test.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://cevi.sharepoint.com/x"],
    ["//cevi.sharepoint.com/x"],
    ["https:cevi.sharepoint.com/x"],
    ["https:/cevi.sharepoint.com/x"],
    ["ftp://cevi.sharepoint.com/x"],
    ["file:///etc/passwd"],
    ["vbscript:msgbox(1)"],
    ["blob:https://cevi.sharepoint.com/x"],
    [" https://cevi.sharepoint.com/x"],
    ["https://cevi.sharepoint.com/x y"],
    ["https://cevi.sharepoint.com/x\ny"],
    ["https://cevi.sharepoint.com/x\u0000"],
    ["https://cevi.sharepoint.com/x‮"],
    ["https://cevi.sharepoint.com\\@evil.example/x"],
    ["https:\\\\cevi.sharepoint.com\\x"],
    ["https://user@cevi.sharepoint.com/x"],
    ["https://user:geheim@cevi.sharepoint.com/x"],
    ["https://cevi.sharepoint.com@evil.example/x"],
    ["https://:geheim@cevi.sharepoint.com/x"],
    ["https://cevi.sharepoint.com:8443/x"],
    ["https://localhost/x"],
    ["https://intranet/x"],
    ["https://127.0.0.1/x"],
    ["https://2130706433/x"],
    ["https://0x7f.1/x"],
    ["https://[::1]/x"],
    ["https://.sharepoint.com/x"],
    ["https://cevi..sharepoint.com/x"],
    ["https:///x"],
    ["https://"],
    [""],
    [`https://cevi.sharepoint.com/${"a".repeat(LINK_MAX)}`],
  ])("lehnt %j ab", (link) => {
    expect(pruefeLink(link)).toEqual({ ok: false, grund: "ungueltig" });
  });

  test("nimmt einen gewöhnlichen SharePoint-Link an und normiert Schema und Host", () => {
    expect(pruefeLink(GUT)).toEqual({ ok: true, link: GUT });
    expect(pruefeLink("HTTPS://Cevi.SharePoint.com/Sites/x?web=1#a")).toEqual({
      ok: true,
      link: "https://cevi.sharepoint.com/Sites/x?web=1#a",
    });
  });

  test("Hosts der Abteilung: Host selbst oder Subdomain, nie ein ähnlicher Name", () => {
    const hosts = ["sharepoint.com"];
    expect(pruefeLink(GUT, hosts).ok).toBe(true);
    expect(pruefeLink("https://sharepoint.com/x", hosts).ok).toBe(true);
    for (const link of [
      "https://evilsharepoint.com/x",
      "https://sharepoint.com.evil.example/x",
      "https://sharepoint.org/x",
    ]) {
      expect(pruefeLink(link, hosts)).toEqual({ ok: false, grund: "host" });
    }
    // Ein ungültiger Link bleibt ungültig, auch wenn der Host passt
    expect(pruefeLink("http://sharepoint.com/x", hosts).ok).toBe(false);
    // null und leer: keine Einschränkung
    expect(pruefeLink("https://anders.example/x", null).ok).toBe(true);
    expect(pruefeLink("https://anders.example/x", []).ok).toBe(true);
  });
});

describe("Anlegen: Rechte je Rolle", () => {
  test("Lagerleitung und Leitung legen an, die Antwort zeigt nur die Ansicht", async () => {
    for (const person of ["lagerleitung", "leitung"]) {
      const antwort = await anlegen(person, {
        typ: "Application/PDF",
        groesse: 1234,
      });
      expect(antwort.status).toBe(201);
      expect(await antwort.json()).toEqual({
        id: expect.any(String),
        version: 1,
        anzeigename: "Lagerplan",
        link: GUT,
        typ: "application/pdf",
        groesse: 1234,
        hinzugefuegtVon: personen[person]!.id,
        hinzugefuegtAm: expect.any(String),
      });
    }
  });

  test("Team und Lesen bekommen 403, Nicht-Mitglied und fremde Abteilung 404", async () => {
    expect((await anlegen("team")).status).toBe(403);
    expect((await anlegen("lesen")).status).toBe(403);
    expect((await anlegen("ohne")).status).toBe(404);
    expect((await anlegen("fremd", {}, lagerId)).status).toBe(404);
  });

  test("fremdes Lager und unbekannte ID: 404", async () => {
    // Die fremde Person ist in ihrem eigenen Lager Lagerleitung (201), im Lager der Testabteilung zählt ihre Abteilung nicht
    expect((await anlegen("leitung", {}, fremdLagerId)).status).toBe(404);
    expect((await anlegen("leitung", {}, randomUUID())).status).toBe(404);
  });

  test("abgeschlossenes Lager: 409, Recht fehlt: 403 vor 409", async () => {
    expect((await anlegen("leitung", {}, zuId)).status).toBe(409);
    expect((await anlegen("team", {}, zuId)).status).toBe(403);
  });

  test("eine Einstellung der Lagerleitung wirkt: Leitung ohne Bearbeitungsrechte bekommt 403", async () => {
    const [l] = await db
      .insert(schema.lager)
      .values({
        abteilungId,
        titel: "Eingestellt",
        von: "2027-07-10",
        bis: "2027-07-24",
      })
      .returning({ id: schema.lager.id });
    await db.insert(schema.lagerMitglied).values({
      lagerId: l!.id,
      personId: personen.leitung!.id,
      rolle: "leitung",
    });
    expect((await anlegen("leitung", {}, l!.id)).status).toBe(201);
    await db.insert(schema.lagerRolleRecht).values(
      DATEI_RECHTE.map((recht) => ({
        lagerId: l!.id,
        rolle: "leitung" as const,
        recht,
        erlaubt: false,
      })),
    );
    expect((await anlegen("leitung", {}, l!.id)).status).toBe(403);
  });

  test("ungültige Eingabe: 400 (unbekanntes Feld, fehlender Name, zu langer Name, Steuerzeichen, Typ, Grösse)", async () => {
    for (const extra of [
      { inhalt: "abc" },
      { anzeigename: "" },
      { anzeigename: "   " },
      { anzeigename: "x".repeat(201) },
      { anzeigename: "a\nb" },
      { typ: "pdf" },
      { typ: "a/b/c" },
      { groesse: -1 },
      { groesse: 1.5 },
      { groesse: "10" },
      { link: 5 },
    ]) {
      expect((await anlegen("leitung", extra)).status).toBe(400);
    }
  });

  test("böser Link: 400 LINK_UNGUELTIG, nichts gespeichert", async () => {
    const vorher = await db.$count(
      schema.lagerDatei,
      eq(schema.lagerDatei.lagerId, lagerId),
    );
    for (const link of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "//cevi.sharepoint.com/x",
      "https://user:pw@cevi.sharepoint.com/x",
    ]) {
      const antwort = await anlegen("leitung", { link });
      expect(antwort.status).toBe(400);
      expect(await antwort.json()).toMatchObject({ code: "LINK_UNGUELTIG" });
    }
    expect(
      await db.$count(
        schema.lagerDatei,
        eq(schema.lagerDatei.lagerId, lagerId),
      ),
    ).toBe(vorher);
  });

  test("Hosts der Abteilung: andere Hosts 400 LINK_HOST_NICHT_ERLAUBT, danach wieder frei", async () => {
    const admin = (hosts: string[] | null) =>
      rufe("admin", "PUT", "/admin/hosts", { hosts });
    expect((await admin(["sharepoint.com"])).status).toBe(204);
    expect((await anlegen("leitung")).status).toBe(201);
    const antwort = await anlegen("leitung", {
      link: "https://drive.example/x",
    });
    expect(antwort.status).toBe(400);
    expect(await antwort.json()).toMatchObject({
      code: "LINK_HOST_NICHT_ERLAUBT",
    });
    // Die Einstellung einer Abteilung gilt nicht für eine andere
    expect(
      (
        await anlegen(
          "fremd",
          { link: "https://drive.example/x" },
          fremdLagerId,
        )
      ).status,
    ).toBe(201);
    expect((await admin(null)).status).toBe(204);
    expect(
      (await anlegen("leitung", { link: "https://drive.example/x" })).status,
    ).toBe(201);
  });

  test("Rate-Limit je Konto: nach 30 Einträgen 429, andere Konten bleiben frei", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await anlegen("viel")).status).toBe(201);
    }
    expect((await anlegen("viel")).status).toBe(429);
    expect((await anlegen("lagerleitung")).status).toBe(201);
  });
});

describe("Hosts der Abteilung", () => {
  test("nur die Abteilungsleitung liest und ändert; Eingabe streng; Audit ohne Hosts", async () => {
    expect((await rufe("leitung", "GET", "/admin/hosts")).status).toBe(403);
    expect(
      (await rufe("leitung", "PUT", "/admin/hosts", { hosts: null })).status,
    ).toBe(403);
    expect(await (await rufe("admin", "GET", "/admin/hosts")).json()).toEqual({
      hosts: null,
    });
    for (const hosts of [
      [],
      ["https://sharepoint.com"],
      ["a b"],
      ["x"],
      ["a.com/"],
      Array(21).fill("a.com"),
      "a.com",
    ]) {
      expect(
        (await rufe("admin", "PUT", "/admin/hosts", { hosts } as never)).status,
      ).toBe(400);
    }
    expect(
      (
        await rufe("admin", "PUT", "/admin/hosts", {
          hosts: ["Cevi.SharePoint.com", "cevi.sharepoint.com"],
          x: 1,
        } as never)
      ).status,
    ).toBe(400);
    expect(
      (
        await rufe("admin", "PUT", "/admin/hosts", {
          hosts: ["Cevi.SharePoint.com", "cevi.sharepoint.com"],
        })
      ).status,
    ).toBe(204);
    expect(await (await rufe("admin", "GET", "/admin/hosts")).json()).toEqual({
      hosts: ["cevi.sharepoint.com"],
    });
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.aktion, "lager_datei_hosts_geaendert"))
      .orderBy(desc(schema.auditLog.erstelltAm))
      .limit(1);
    expect(audit).toMatchObject({
      zielTyp: "abteilung",
      details: { anzahl: 1 },
    });
    expect(JSON.stringify(audit!.details)).not.toContain("sharepoint");
    await rufe("admin", "PUT", "/admin/hosts", { hosts: null });
  });
});

describe("Lesen: sichtbar nur über einen lesbaren Datensatz", () => {
  test("ohne Verweis sieht nur die Person den Eintrag, die ihn hinzugefügt hat", async () => {
    const datei = await neueDatei("leitung");
    const lesen = (p: string) =>
      rufe(p, "GET", `/${lagerId}/dateien/${datei.id}`);
    expect((await lesen("leitung")).status).toBe(200);
    for (const p of ["lagerleitung", "team", "lesen", "ohne", "fremd"]) {
      expect((await lesen(p)).status).toBe(404);
    }
    // Nach 24 Stunden sieht auch die Person ihn nicht mehr
    await db
      .update(schema.lagerDatei)
      .set({ erstelltAm: sql`now() - interval '25 hours'` })
      .where(eq(schema.lagerDatei.id, datei.id));
    expect((await lesen("leitung")).status).toBe(404);
  });

  test("mit Verweis sieht ihn, wer den Datensatz lesen darf (Recht des Moduls)", async () => {
    const datei = await neueDatei("leitung");
    await binde(beitrag, datei.id);
    const lesen = (p: string, id = lagerId) =>
      rufe(p, "GET", `/${id}/dateien/${datei.id}`);
    for (const p of ["lagerleitung", "leitung", "team", "lesen"]) {
      expect((await lesen(p)).status).toBe(200);
    }
    expect((await lesen("ohne")).status).toBe(404);
    expect((await lesen("fremd")).status).toBe(404);
    // Fremdes Lager: 404, auch mit der richtigen Datei-ID
    expect((await lesen("fremd", fremdLagerId)).status).toBe(404);
    expect((await lesen("leitung", fremdLagerId)).status).toBe(404);
  });

  test("ein Datensatz mit strengerem Recht zeigt den Eintrag dem Team nicht", async () => {
    const datei = await neueDatei("leitung");
    await binde(intern, datei.id);
    const lesen = (p: string) =>
      rufe(p, "GET", `/${lagerId}/dateien/${datei.id}`);
    expect((await lesen("team")).status).toBe(404);
    expect((await lesen("lesen")).status).toBe(200);
    expect((await lesen("lagerleitung")).status).toBe(200);
  });

  test("ein gelöschter Datensatz gibt den Eintrag nicht mehr frei", async () => {
    const datei = await neueDatei("leitung");
    const [zeile] = await binde(beitrag, datei.id);
    await db.delete(beitrag).where(eq(beitrag.id, zeile!.id));
    expect(
      (await rufe("team", "GET", `/${lagerId}/dateien/${datei.id}`)).status,
    ).toBe(404);
  });

  test("ein Verweis aus einem anderen Lager gibt nichts frei", async () => {
    const datei = await neueDatei("leitung");
    const [fremd] = await db
      .insert(beitrag)
      .values({ lagerId: zuId, lagerSeq: 0, datei: datei.id })
      .returning({ id: beitrag.id });
    expect(fremd).toBeDefined();
    expect(
      (await rufe("team", "GET", `/${lagerId}/dateien/${datei.id}`)).status,
    ).toBe(404);
  });

  test("Pfad: keine UUID 400", async () => {
    expect(
      (await rufe("leitung", "GET", `/${lagerId}/dateien/abc`)).status,
    ).toBe(400);
  });
});

describe("Änderungsfeed", () => {
  test("meldet nur Einträge mit lesbarem Verweis, ohne Inhalt", async () => {
    const frei = await neueDatei("leitung");
    const verwiesen = await neueDatei("leitung");
    const nurLesen = await neueDatei("leitung");
    await binde(beitrag, verwiesen.id);
    await binde(intern, nurLesen.id);
    const feed = async (p: string) =>
      (await (
        await rufe(p, "GET", `/${lagerId}/aenderungen?seit=0&limit=500`)
      ).json()) as {
        eintraege: { objekttyp: string; id: string; art: string }[];
      };
    const ids = (f: Awaited<ReturnType<typeof feed>>) =>
      f.eintraege.filter((e) => e.objekttyp === "lager_datei").map((e) => e.id);
    const team = ids(await feed("team"));
    expect(team).toContain(verwiesen.id);
    expect(team).not.toContain(frei.id);
    expect(team).not.toContain(nurLesen.id);
    const lesen = ids(await feed("lesen"));
    expect(lesen).toContain(verwiesen.id);
    expect(lesen).toContain(nurLesen.id);
    expect(lesen).not.toContain(frei.id);
    // Der Typ steht in der Liste der lesbaren Objekttypen, auch ohne eigenes Recht
    const stand = (await (
      await rufe("lesen", "GET", `/${lagerId}/aenderungen`)
    ).json()) as {
      objekttypen: string[];
    };
    expect(stand.objekttypen).toContain("lager_datei");
  });
});

describe("Löschen entfernt nur die Verknüpfung", () => {
  test("Version nötig, Konflikt 409, danach 204 und 404; die Zeile ist weg", async () => {
    const datei = await neueDatei("leitung");
    const url = `/${lagerId}/dateien/${datei.id}`;
    expect((await rufe("leitung", "DELETE", url)).status).toBe(400);
    expect((await rufe("leitung", "DELETE", `${url}?version=2`)).status).toBe(
      409,
    );
    expect((await rufe("team", "DELETE", `${url}?version=1`)).status).toBe(403);
    expect((await rufe("ohne", "DELETE", `${url}?version=1`)).status).toBe(404);
    expect(
      (
        await rufe(
          "fremd",
          "DELETE",
          `/${fremdLagerId}/dateien/${datei.id}?version=1`,
        )
      ).status,
    ).toBe(404);
    expect((await rufe("leitung", "DELETE", `${url}?version=1`)).status).toBe(
      204,
    );
    expect((await rufe("leitung", "GET", url)).status).toBe(404);
    expect((await rufe("leitung", "DELETE", `${url}?version=2`)).status).toBe(
      404,
    );
    // Endgültig: Die Zeile ist weg
    expect(
      await db
        .select()
        .from(schema.lagerDatei)
        .where(eq(schema.lagerDatei.id, datei.id)),
    ).toHaveLength(0);
  });

  test("eine Datei, die ein Datensatz einbindet, lässt sich nicht löschen: 409 IN_VERWENDUNG, die Zeile bleibt", async () => {
    const datei = await neueDatei("leitung");
    await binde(beitrag, datei.id);
    const a = await rufe(
      "leitung",
      "DELETE",
      `/${lagerId}/dateien/${datei.id}?version=1`,
    );
    expect(a.status).toBe(409);
    expect(((await a.json()) as { code: string }).code).toBe("IN_VERWENDUNG");
    expect(
      await db
        .select()
        .from(schema.lagerDatei)
        .where(eq(schema.lagerDatei.id, datei.id)),
    ).toHaveLength(1);
  });

  test("ein Eintrag, den die Person nicht sieht, lässt sich nicht löschen (404 vor 403)", async () => {
    const datei = await neueDatei("leitung");
    expect(
      (
        await rufe(
          "team",
          "DELETE",
          `/${lagerId}/dateien/${datei.id}?version=1`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await rufe(
          "lagerleitung",
          "DELETE",
          `/${lagerId}/dateien/${datei.id}?version=1`,
        )
      ).status,
    ).toBe(404);
  });

  test("im abgeschlossenen Lager 409", async () => {
    const [d] = await db
      .insert(schema.lagerDatei)
      .values({
        lagerId: zuId,
        lagerSeq: 0,
        anzeigename: "x",
        link: GUT,
        erstelltVon: personen.leitung!.id,
      })
      .returning({ id: schema.lagerDatei.id });
    expect(
      (await rufe("leitung", "DELETE", `/${zuId}/dateien/${d!.id}?version=1`))
        .status,
    ).toBe(409);
  });

  test("Lager löschen nimmt die Einträge mit (CASCADE)", async () => {
    const [l] = await db
      .insert(schema.lager)
      .values({
        abteilungId,
        titel: "Weg",
        von: "2027-07-10",
        bis: "2027-07-24",
      })
      .returning({ id: schema.lager.id });
    await db.insert(schema.lagerDatei).values({
      lagerId: l!.id,
      lagerSeq: 0,
      anzeigename: "x",
      link: GUT,
    });
    await db.delete(schema.lager).where(eq(schema.lager.id, l!.id));
    expect(
      await db.$count(schema.lagerDatei, eq(schema.lagerDatei.lagerId, l!.id)),
    ).toBe(0);
  });
});

describe("Datenbank-CHECKs halten die Link-Regeln ohne die Routen", () => {
  test.each([
    ["http://cevi.sharepoint.com/x"],
    ["javascript:alert(1)"],
    ["https://cevi.sharepoint.com/ x"],
    ["https://cevi.sharepoint.com\\x"],
    [`https://cevi.sharepoint.com/${"a".repeat(LINK_MAX)}`],
  ])("lehnt %j ab", async (link) => {
    await expect(
      db.insert(schema.lagerDatei).values({
        lagerId,
        lagerSeq: 0,
        anzeigename: "x",
        link: link.slice(0, 3000),
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("Hilfen für Module", () => {
  test("ladeDateien: eine Abfrage, nur Einträge dieses Lagers, keine gelöschten", async () => {
    const a = await neueDatei("leitung");
    const b = await neueDatei("leitung");
    const [fremd] = await db
      .insert(schema.lagerDatei)
      .values({
        lagerId: fremdLagerId,
        lagerSeq: 0,
        anzeigename: "f",
        link: GUT,
      })
      .returning({ id: schema.lagerDatei.id });
    await rufe("leitung", "DELETE", `/${lagerId}/dateien/${b.id}?version=1`);
    const karte = await ladeDateien(db, lagerId, [a.id, b.id, fremd!.id]);
    expect([...karte.keys()]).toEqual([a.id]);
    expect(karte.get(a.id)).toMatchObject({
      link: GUT,
      anzeigename: "Lagerplan",
    });
    expect((await ladeDateien(db, lagerId, [])).size).toBe(0);
  });

  test("pruefeDateiImLager: fremd, gelöscht und unbekannt werfen 400", async () => {
    const a = await neueDatei("leitung");
    await expect(
      pruefeDateiImLager(db, lagerId, a.id),
    ).resolves.toBeUndefined();
    await expect(pruefeDateiImLager(db, zuId, a.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      pruefeDateiImLager(db, lagerId, randomUUID()),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("Aufräumlauf", () => {
  const alt = (id: string) =>
    db
      .update(schema.lagerDatei)
      .set({ erstelltAm: sql`now() - interval '25 hours'` })
      .where(eq(schema.lagerDatei.id, id));
  const gibt = async (id: string) =>
    (await db.$count(schema.lagerDatei, eq(schema.lagerDatei.id, id))) === 1;

  test("entfernt alte Einträge ohne Verweis, lässt verwiesene und junge stehen", async () => {
    await raeumeDateienOhneVerweisAuf(db, undefined, lagerId);
    const ohne = await neueDatei();
    const jung = await neueDatei();
    const mitBeitrag = await neueDatei();
    const mitIntern = await neueDatei();
    await binde(beitrag, mitBeitrag.id);
    await binde(intern, mitIntern.id);
    for (const d of [ohne, mitBeitrag, mitIntern]) {
      await alt(d.id);
    }
    expect(await raeumeDateienOhneVerweisAuf(db, undefined, lagerId)).toBe(1);
    expect(await gibt(ohne.id)).toBe(false);
    for (const d of [jung, mitBeitrag, mitIntern]) {
      expect(await gibt(d.id)).toBe(true);
    }
    // Zweiter Lauf: nichts mehr zu tun
    expect(await raeumeDateienOhneVerweisAuf(db, undefined, lagerId)).toBe(0);
  });

  test("ein Verweis, der wegfällt, gibt den Eintrag zum Abräumen frei", async () => {
    const datei = await neueDatei();
    const [zeile] = await binde(beitrag, datei.id);
    await alt(datei.id);
    expect(await raeumeDateienOhneVerweisAuf(db, undefined, lagerId)).toBe(0);
    await db.delete(beitrag).where(eq(beitrag.id, zeile!.id));
    expect(await raeumeDateienOhneVerweisAuf(db, undefined, lagerId)).toBe(1);
    expect(await gibt(datei.id)).toBe(false);
  });

  test("der Fremdschlüssel schützt einen Eintrag vor dem Löschen, den ein Datensatz einbindet", async () => {
    const datei = await neueDatei();
    await binde(beitrag, datei.id);
    await expect(
      db.delete(schema.lagerDatei).where(eq(schema.lagerDatei.id, datei.id)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
  });

  test("ein Lauf ist eine einzige Abfrage", async () => {
    const abfragen: string[] = [];
    const zaehler = postgres(API_URL, {
      max: 1,
      debug: (_c, q) => abfragen.push(q),
    });
    try {
      await raeumeDateienOhneVerweisAuf(
        erstelleDb(zaehler),
        undefined,
        lagerId,
      );
    } finally {
      await zaehler.end();
    }
    expect(abfragen).toHaveLength(1);
  });
});

describe("Verweisregister", () => {
  test("ein Verweis lässt sich nicht doppelt anmelden", () => {
    expect(() =>
      registriereDateiVerweis({
        tabelle: beitrag,
        spalte: beitrag.datei,
        recht: "pinnwand.lesen",
      }),
    ).toThrow();
  });

  test("ein Zeilenfilter des Moduls entscheidet über die Sichtbarkeit", async () => {
    const datei = await neueDatei("leitung");
    await binde(beitrag, datei.id);
    // Der Filter lässt nur die Lagerleitung durch
    entferneDateiVerweis(beitrag.datei);
    registriereDateiVerweis({
      tabelle: beitrag,
      spalte: beitrag.datei,
      recht: "pinnwand.lesen",
      sichtbar: async (_db, zugriff, ids) =>
        zugriff.rolle === "lagerleitung" ? new Set(ids) : new Set(),
    });
    try {
      const lesen = (p: string) =>
        rufe(p, "GET", `/${lagerId}/dateien/${datei.id}`);
      expect((await lesen("lagerleitung")).status).toBe(200);
      expect((await lesen("team")).status).toBe(404);
    } finally {
      entferneDateiVerweis(beitrag.datei);
      registriereDateiVerweis({
        tabelle: beitrag,
        spalte: beitrag.datei,
        recht: "pinnwand.lesen",
      });
    }
  });
});
