import { createHash, randomUUID } from "node:crypto";
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
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import {
  erzeuge,
  loescheWiderrufene,
  pruefeToken,
  TOKEN_FORMAT,
} from "../../src/termine/ical-token.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

bereiteAuthTestsVor();
// Jede Persona rechnet scrypt
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

const PFAD = "/api/v1/ich/kalender-link";
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

let welt: Welt;
let eltern: PersonaKonto;
let andere: PersonaKonto;
let admin: PersonaKonto;
let ausgabe: MockInstance<typeof console.log>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  eltern = await legePersonaAn(welt, "elternA");
  andere = await legePersonaAn(welt, "elternB");
  admin = await legePersonaAn(welt, "admin");
});
afterAll(() => sql.end());
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const rufe = (konto: PersonaKonto, methode = "GET") =>
  app.request(PFAD, { method: methode, headers: konto.headers });
const status = async (konto: PersonaKonto) => {
  const antwort = await rufe(konto);
  expect(antwort.status).toBe(200);
  return (await antwort.json()) as {
    aktiv: boolean;
    erstelltAm: string | null;
    zuletztAbgerufenAm: string | null;
    endung: string | null;
  };
};
const erzeugeUeberRoute = async (konto: PersonaKonto) => {
  const antwort = await rufe(konto, "POST");
  expect(antwort.status).toBe(201);
  return (await antwort.json()) as {
    token: string;
    pfad: string;
    erstelltAm: string;
    endung: string;
  };
};
const zeilen = (userId: string) =>
  db
    .select()
    .from(schema.kalenderToken)
    .where(eq(schema.kalenderToken.userId, userId));

// Jede Spalte der Datenbank, die Text, UUID oder JSON trägt, auf den Wert (wie in konto-loeschen.test.ts)
async function treffer(wert: string) {
  const spalten = await sql<{ tabelle: string; spalte: string }[]>`
    select table_name as tabelle, column_name as spalte
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('uuid', 'text', 'character varying', 'jsonb')`;
  const gefunden: string[] = [];
  for (const { tabelle, spalte } of spalten) {
    const z = await sql`
      select 1 from ${sql(tabelle)}
      where strpos(${sql(spalte)}::text, ${wert}) > 0 limit 1`;
    if (z.length > 0) gefunden.push(`${tabelle}.${spalte}`);
  }
  return gefunden;
}

describe("Token: Format und Entropie", () => {
  test("32 Byte base64url, Pfad und Endung passen zum Token", async () => {
    const neu = await erzeugeUeberRoute(eltern);
    expect(neu.token).toMatch(TOKEN_FORMAT);
    expect(Buffer.from(neu.token, "base64url")).toHaveLength(32);
    expect(neu.pfad).toBe(`/ical/${neu.token}.ics`);
    expect(neu.endung).toBe(neu.token.slice(-4));
    expect(Object.keys(neu).sort()).toEqual([
      "endung",
      "erstelltAm",
      "pfad",
      "token",
    ]);
  });

  test("200 Token sind verschieden, und ihre Bits sind gleichmässig verteilt", async () => {
    const person = { id: andere.id!, abteilungId: welt.testabteilungId };
    const tokens: string[] = [];
    for (let i = 0; i < 200; i++)
      tokens.push((await erzeuge(db, person)).token);
    expect(new Set(tokens).size).toBe(200);
    let einsen = 0;
    for (const t of tokens) {
      for (const byte of Buffer.from(t, "base64url")) {
        einsen += byte.toString(2).replaceAll("0", "").length;
      }
    }
    // 51200 Bits; der Mittelwert liegt bei 25600, die Standardabweichung bei etwa 113: 1000 Abstand sind rund neun Abweichungen
    expect(Math.abs(einsen - 25600)).toBeLessThan(1000);
  });
});

describe("Speicherung", () => {
  test("die Datenbank hält nur den Hash und die Endung, den Klartext nirgends", async () => {
    const neu = await erzeugeUeberRoute(eltern);
    const [zeile] = (await zeilen(eltern.id!)).filter(
      (z) => z.widerrufenAm === null,
    );
    expect(zeile).toMatchObject({
      tokenHash: sha256(neu.token),
      endung: neu.endung,
      zuletztAbgerufenAm: null,
      widerrufenAm: null,
    });
    expect(await treffer(neu.token)).toEqual([]);
  });

  test("ein zweiter aktiver Token einer Person scheitert am Index", async () => {
    await erzeugeUeberRoute(eltern);
    await expect(
      db.insert(schema.kalenderToken).values({
        userId: eltern.id!,
        tokenHash: sha256(randomUUID()),
        endung: "abcd",
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "kalender_token_aktiv_je_person" },
    });
  });

  test("Audit nennt nur die Aktion und die Zeile, nie den Token", async () => {
    const person = { id: andere.id!, abteilungId: welt.testabteilungId };
    const { token } = await erzeuge(db, person);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.akteurId, person.id));
    const aktionen = audit.map((a) => a.aktion);
    expect(aktionen).toContain("ical_token_erzeugt");
    expect(aktionen).toContain("ical_token_widerrufen");
    for (const a of audit.filter((a) => a.zielTyp === "kalender_token")) {
      expect(a.details).toBeNull();
      expect(JSON.stringify(a)).not.toContain(token);
    }
  });
});

describe("Status", () => {
  test("ohne Token: nicht aktiv; nach POST aktiv, GET zeigt nie den Token", async () => {
    const person = await legePersonaAn(welt, "leitendeB");
    expect(await status(person)).toEqual({
      aktiv: false,
      erstelltAm: null,
      zuletztAbgerufenAm: null,
      endung: null,
    });
    const neu = await erzeugeUeberRoute(person);
    const danach = await rufe(person);
    const text = await danach.text();
    expect(text).not.toContain(neu.token);
    expect(JSON.parse(text)).toEqual({
      aktiv: true,
      erstelltAm: neu.erstelltAm,
      zuletztAbgerufenAm: null,
      endung: neu.endung,
    });
  });

  test("jede Person sieht nur ihren eigenen Link", async () => {
    const a = await legePersonaAn(welt, "slA");
    const b = await legePersonaAn(welt, "slB");
    const neu = await erzeugeUeberRoute(a);
    expect((await status(a)).endung).toBe(neu.endung);
    expect((await status(b)).aktiv).toBe(false);
    expect((await rufe(b, "DELETE")).status).toBe(204);
    expect((await status(a)).aktiv).toBe(true);
  });
});

describe("Ersetzen und Widerrufen", () => {
  test("ein zweites POST macht den ersten Token ungültig", async () => {
    const person = await legePersonaAn(welt, "leitendeA");
    const erster = await erzeugeUeberRoute(person);
    expect(await pruefeToken(db, erster.token)).toMatchObject({
      userId: person.id,
    });
    const zweiter = await erzeugeUeberRoute(person);
    expect(zweiter.token).not.toBe(erster.token);
    expect(await pruefeToken(db, erster.token)).toBeNull();
    expect(await pruefeToken(db, zweiter.token)).toMatchObject({
      userId: person.id,
    });
    const alle = await zeilen(person.id!);
    expect(alle).toHaveLength(2);
    expect(alle.filter((z) => z.widerrufenAm === null)).toHaveLength(1);
    expect((await status(person)).endung).toBe(zweiter.endung);
  });

  test("gleichzeitige POST laufen nacheinander: alle 201, ein aktiver Token", async () => {
    const person = await legePersonaAn(welt, "leitendeAElternB");
    const antworten = await Promise.all(
      Array.from({ length: 5 }, () => rufe(person, "POST")),
    );
    expect(antworten.map((a) => a.status)).toEqual([201, 201, 201, 201, 201]);
    const alle = await zeilen(person.id!);
    expect(alle.filter((z) => z.widerrufenAm === null)).toHaveLength(1);
  });

  test("DELETE widerruft sofort und ist wiederholbar, Audit nur beim ersten Mal", async () => {
    const person = await legePersonaAn(welt, "slA");
    const neu = await erzeugeUeberRoute(person);
    const erste = await rufe(person, "DELETE");
    expect(erste.status).toBe(204);
    expect(await erste.text()).toBe("");
    expect(await pruefeToken(db, neu.token)).toBeNull();
    expect((await status(person)).aktiv).toBe(false);
    expect((await rufe(person, "DELETE")).status).toBe(204);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.akteurId, person.id!));
    expect(
      audit.filter((a) => a.aktion === "ical_token_widerrufen"),
    ).toHaveLength(1);
  });

  test("nach dem Widerruf lässt sich ein neuer Link erzeugen", async () => {
    const person = await legePersonaAn(welt, "slB");
    await erzeugeUeberRoute(person);
    await rufe(person, "DELETE");
    const neu = await erzeugeUeberRoute(person);
    expect(await pruefeToken(db, neu.token)).toMatchObject({
      userId: person.id,
    });
  });
});

describe("Prüfung für den Feed", () => {
  test("zuletzt abgerufen wird höchstens einmal je Stunde geschrieben", async () => {
    const person = await legePersonaAn(welt, "leitendeB");
    const neu = await erzeugeUeberRoute(person);
    const lies = async () => {
      const [zeile] = await sql<{ am: string | null; xmin: string }[]>`
        select zuletzt_abgerufen_am::text as am, xmin::text from kalender_token
        where token_hash = ${sha256(neu.token)}`;
      return { am: zeile!.am ? new Date(zeile!.am) : null, xmin: zeile!.xmin };
    };
    expect((await lies()).am).toBeNull();

    expect(await pruefeToken(db, neu.token)).toMatchObject({
      userId: person.id,
      abteilungId: welt.testabteilungId,
    });
    const nachErstem = await lies();
    expect(nachErstem.am).toBeInstanceOf(Date);
    expect((await status(person)).zuletztAbgerufenAm).toBe(
      nachErstem.am!.toISOString(),
    );

    // Ein zweiter Abruf innerhalb der Stunde schreibt nichts: dieselbe Zeilenversion
    await pruefeToken(db, neu.token);
    expect((await lies()).xmin).toBe(nachErstem.xmin);

    // Nach mehr als einer Stunde schreibt er wieder
    await sql`
      update kalender_token set zuletzt_abgerufen_am = now() - interval '61 minutes'
      where token_hash = ${sha256(neu.token)}`;
    await pruefeToken(db, neu.token);
    const spaeter = await lies();
    expect(Date.now() - spaeter.am!.getTime()).toBeLessThan(60_000);
  });

  test("falsches Format, unbekannter Token und deaktiviertes Konto geben null", async () => {
    const person = await legePersonaAn(welt, "slA");
    const neu = await erzeugeUeberRoute(person);
    expect(await pruefeToken(db, "kurz")).toBeNull();
    expect(await pruefeToken(db, `${neu.token}x`)).toBeNull();
    expect(await pruefeToken(db, "A".repeat(43))).toBeNull();
    expect(await pruefeToken(db, neu.token)).not.toBeNull();
    await sql`update "user" set deaktiviert_am = now() where id = ${person.id!}`;
    expect(await pruefeToken(db, neu.token)).toBeNull();
    await sql`update "user" set deaktiviert_am = null, banned = true where id = ${person.id!}`;
    expect(await pruefeToken(db, neu.token)).toBeNull();
  });
});

describe("Aufräumen", () => {
  test("widerrufene Zeilen verschwinden nach 30 Tagen, aktive und junge bleiben", async () => {
    const person = await legePersonaAn(welt, "leitendeA");
    const alt = await erzeugeUeberRoute(person);
    const jung = await erzeugeUeberRoute(person);
    const aktiv = await erzeugeUeberRoute(person);
    await sql`
      update kalender_token set widerrufen_am = now() - interval '31 days'
      where token_hash = ${sha256(alt.token)}`;
    await sql`
      update kalender_token set widerrufen_am = now() - interval '29 days'
      where token_hash = ${sha256(jung.token)}`;
    expect(await loescheWiderrufene(db)).toBeGreaterThanOrEqual(1);
    const hashes = (await zeilen(person.id!)).map((z) => z.tokenHash);
    expect(hashes).not.toContain(sha256(alt.token));
    expect(hashes).toContain(sha256(jung.token));
    expect(hashes).toContain(sha256(aktiv.token));
  });
});

describe("Konto löschen", () => {
  test("das Löschen des Kontos entfernt Token und macht den Link ungültig; im Audit bleibt kein Token", async () => {
    const opfer = await legePersonaAn(welt, "leitendeB");
    const neu = await erzeugeUeberRoute(opfer);
    expect(await zeilen(opfer.id!)).toHaveLength(1);
    const antwort = await app.request(`/api/v1/admin/personen/${opfer.id}`, {
      method: "DELETE",
      headers: admin.headers,
    });
    expect(antwort.status).toBe(204);
    expect(await zeilen(opfer.id!)).toEqual([]);
    expect(await pruefeToken(db, neu.token)).toBeNull();
    expect(await treffer(neu.token)).toEqual([]);
  });
});

describe("Ratenbegrenzung (SR-71)", () => {
  test("10 Änderungen je Person und 10 Minuten, dann 429; GET und andere Personen bleiben frei", async () => {
    const person = await legePersonaAn(welt, "slB");
    for (let i = 0; i < 5; i++) {
      expect((await rufe(person, "POST")).status).toBe(201);
      expect((await rufe(person, "DELETE")).status).toBe(204);
    }
    const zuViel = await rufe(person, "POST");
    expect(zuViel.status).toBe(429);
    expect(await zuViel.json()).toEqual({
      code: "ZU_VIELE_ANFRAGEN",
      message: "Zu viele Anfragen",
    });
    expect((await rufe(person, "DELETE")).status).toBe(429);
    expect((await rufe(person)).status).toBe(200);
    expect((await rufe(andere, "POST")).status).toBe(201);
  });
});

describe("Keine Token in Logs", () => {
  test("weder Anfrage-Log noch Fehler-Log nennen den Token", async () => {
    const person = await legePersonaAn(welt, "leitendeAElternB");
    const neu = await erzeugeUeberRoute(person);
    await rufe(person);
    await rufe(person, "POST");
    await rufe(person, "DELETE");
    // Ein Fehlerfall mit dem Token im Pfad eines fremden Aufrufs
    await app.request(`/ical/${neu.token}.ics`, { headers: person.headers });
    const zeilenImLog = ausgabe.mock.calls.map(([z]) => String(z));
    expect(zeilenImLog.length).toBeGreaterThan(0);
    for (const z of zeilenImLog) expect(z).not.toContain(neu.token);
    // Auch nicht die Endung zusammen mit einem Pfad
    expect(zeilenImLog.join("\n")).not.toContain("/ical/");
  });
});
