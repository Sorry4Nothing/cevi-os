import { Expo } from "expo-server-sdk";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
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
import { z } from "zod";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { eingabe } from "../src/eingabe.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  chatFuerPerson,
  chatMitglieder,
  sichtbareNachrichten,
} from "../src/rechte.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const t = (iso: string) => new Date(iso);

// Ganze Sekunden statt defaultNow(): Postgres speichert Mikrosekunden, ein JS-Date nur Millisekunden, sonst läge eine Nachricht zum zurückgelesenen Datum knapp davor
const setzeKind = (kindId: string, stufeSeit: Date) =>
  db.update(schema.kind).set({ stufeSeit }).where(eq(schema.kind.id, kindId));
const setzeVerknuepfung = (kindId: string, userId: string, erstelltAm: Date) =>
  db
    .update(schema.kindEltern)
    .set({ erstelltAm })
    .where(
      and(
        eq(schema.kindEltern.kindId, kindId),
        eq(schema.kindEltern.userId, userId),
      ),
    );

const einzelchat = async (
  welt: Welt,
  stufeId: string,
  elternUserId: string,
) => {
  const [chat] = await db
    .insert(schema.chat)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "direkt",
      stufeId,
      elternUserId,
    })
    .returning();
  return chat.id;
};

const neuesKindA = async (welt: Welt, stufeSeit: Date) => {
  const [kind] = await db
    .insert(schema.kind)
    .values({
      abteilungId: welt.testabteilungId,
      vorname: "Kind",
      nachname: "A2",
      stufeId: welt.stufeAId,
      stufeSeit,
    })
    .returning();
  return kind.id;
};

const verknuepfe = (kindId: string, userId: string, erstelltAm: Date) =>
  db.insert(schema.kindEltern).values({ kindId, userId, erstelltAm });

type Mitgliedschaft = { chatId: string; sichtAb: Date | null };
const nachChat = (a: Mitgliedschaft, b: Mitgliedschaft) =>
  a.chatId.localeCompare(b.chatId);

async function mitgliedschaften(abteilungId: string, userId: string) {
  const m = chatMitglieder(db, abteilungId);
  const zeilen = await db
    .select({ chatId: m.chatId, sichtAb: m.sichtAb })
    .from(m)
    .where(eq(m.userId, userId));
  return zeilen.sort(nachChat);
}

const erwartet = (zeilen: Mitgliedschaft[]) => [...zeilen].sort(nachChat);

async function sichtbareTexte(abteilungId: string, userId: string) {
  const n = sichtbareNachrichten(db, { id: userId, abteilungId });
  const zeilen = await db
    .select({ text: n.text, erstelltAm: n.erstelltAm })
    .from(n);
  return zeilen
    .sort((a, b) => a.erstelltAm.getTime() - b.erstelltAm.getTime())
    .map((z) => z.text);
}

describe("Stufenwechsel eines Kindes", () => {
  test("beide Chats der alten Stufe enden sofort, der neue Gruppenchat beginnt mit stufe_seit", async () => {
    const welt = await erstelleWelt(db, auth);
    const eltern = await legePersonaAn(welt, "elternA");
    const elternId = eltern.id as string;
    await setzeKind(welt.kindAId, t("2026-01-01T00:00:00Z"));
    await setzeVerknuepfung(welt.kindAId, elternId, t("2026-01-02T00:00:00Z"));
    const einzelA = await einzelchat(welt, welt.stufeAId, elternId);

    expect(await mitgliedschaften(welt.testabteilungId, elternId)).toEqual(
      erwartet([
        { chatId: welt.gruppenchatAId, sichtAb: t("2026-01-02T00:00:00Z") },
        { chatId: einzelA, sichtAb: null },
      ]),
    );

    // Der Wechsel setzt Stufe und stufe_seit neu
    await db
      .update(schema.kind)
      .set({ stufeId: welt.stufeBId, stufeSeit: t("2026-06-01T00:00:00Z") })
      .where(eq(schema.kind.id, welt.kindAId));
    expect(await mitgliedschaften(welt.testabteilungId, elternId)).toEqual([
      { chatId: welt.gruppenchatBId, sichtAb: t("2026-06-01T00:00:00Z") },
    ]);
  });
});

describe("inaktives Kind", () => {
  test("ein zweites aktives Kind erhält die Mitgliedschaft, ohne eines endet sie", async () => {
    const welt = await erstelleWelt(db, auth);
    const eltern = await legePersonaAn(welt, "elternA");
    const elternId = eltern.id as string;
    await setzeKind(welt.kindAId, t("2026-01-01T00:00:00Z"));
    await setzeVerknuepfung(welt.kindAId, elternId, t("2026-01-02T00:00:00Z"));
    const kindA2 = await neuesKindA(welt, t("2026-02-01T00:00:00Z"));
    await verknuepfe(kindA2, elternId, t("2026-02-02T00:00:00Z"));
    const einzelA = await einzelchat(welt, welt.stufeAId, elternId);

    await db
      .update(schema.kind)
      .set({ inaktivSeit: new Date() })
      .where(eq(schema.kind.id, welt.kindAId));
    expect(await mitgliedschaften(welt.testabteilungId, elternId)).toEqual(
      erwartet([
        { chatId: welt.gruppenchatAId, sichtAb: t("2026-02-02T00:00:00Z") },
        { chatId: einzelA, sichtAb: null },
      ]),
    );

    await db
      .update(schema.kind)
      .set({ inaktivSeit: new Date() })
      .where(eq(schema.kind.id, kindA2));
    expect(await mitgliedschaften(welt.testabteilungId, elternId)).toEqual([]);
  });
});

describe("gelöste Eltern-Verknüpfung", () => {
  test("mit einem anderen aktiven Kind bleibt der Zugang, ohne endet er ganz", async () => {
    const welt = await erstelleWelt(db, auth);
    const eltern = await legePersonaAn(welt, "elternA");
    const elternId = eltern.id as string;
    await setzeKind(welt.kindAId, t("2026-01-01T00:00:00Z"));
    await setzeVerknuepfung(welt.kindAId, elternId, t("2026-01-02T00:00:00Z"));
    const kindA2 = await neuesKindA(welt, t("2026-02-01T00:00:00Z"));
    await verknuepfe(kindA2, elternId, t("2026-02-02T00:00:00Z"));
    const einzelA = await einzelchat(welt, welt.stufeAId, elternId);

    await db
      .delete(schema.kindEltern)
      .where(eq(schema.kindEltern.kindId, kindA2));
    expect(await mitgliedschaften(welt.testabteilungId, elternId)).toEqual(
      erwartet([
        { chatId: welt.gruppenchatAId, sichtAb: t("2026-01-02T00:00:00Z") },
        { chatId: einzelA, sichtAb: null },
      ]),
    );

    await db
      .delete(schema.kindEltern)
      .where(eq(schema.kindEltern.kindId, welt.kindAId));
    expect(await mitgliedschaften(welt.testabteilungId, elternId)).toEqual([]);
  });
});

describe("deaktiviertes Konto", () => {
  test("banned und deaktiviert_am beenden die Mitgliedschaft je allein, auch die einer SL", async () => {
    const welt = await erstelleWelt(db, auth);
    const eltern = await legePersonaAn(welt, "elternA");
    const sl = await legePersonaAn(welt, "slA");
    await einzelchat(welt, welt.stufeAId, eltern.id as string);

    for (const konto of [eltern, sl]) {
      const userId = konto.id as string;
      expect(await mitgliedschaften(welt.testabteilungId, userId)).toHaveLength(
        2,
      );
      // Das Deaktivieren setzt beide Felder; hier wirkt jedes allein
      await db
        .update(schema.user)
        .set({ banned: true })
        .where(eq(schema.user.id, userId));
      expect(await mitgliedschaften(welt.testabteilungId, userId)).toEqual([]);
      await db
        .update(schema.user)
        .set({ banned: false, deaktiviertAm: new Date() })
        .where(eq(schema.user.id, userId));
      expect(await mitgliedschaften(welt.testabteilungId, userId)).toEqual([]);
    }
  });
});

describe("Beitrittsdatum", () => {
  let welt: Welt;
  let sl: PersonaKonto;
  let elternA: PersonaKonto;
  let elternB: PersonaKonto;
  let zweiKinder: PersonaKonto;
  let einzelA: string;

  beforeAll(async () => {
    welt = await erstelleWelt(db, auth);
    sl = await legePersonaAn(welt, "slA");
    elternA = await legePersonaAn(welt, "elternA");
    elternB = await legePersonaAn(welt, "elternB");
    zweiKinder = await legePersonaAn(welt, "elternA");
    await setzeKind(welt.kindAId, t("2026-01-01T00:00:00Z"));
    await setzeKind(welt.kindBId, t("2026-04-01T00:00:00Z"));
    // Verknüpfung später als stufe_seit
    await setzeVerknuepfung(
      welt.kindAId,
      elternA.id as string,
      t("2026-03-01T00:00:00Z"),
    );
    // stufe_seit später als Verknüpfung
    await setzeVerknuepfung(
      welt.kindBId,
      elternB.id as string,
      t("2026-02-01T00:00:00Z"),
    );
    // Zwei Kinder in der Stufe: Kind A ab 2026-05-01, das zweite ab 2026-02-01
    await setzeVerknuepfung(
      welt.kindAId,
      zweiKinder.id as string,
      t("2026-05-01T00:00:00Z"),
    );
    const kindA2 = await neuesKindA(welt, t("2026-02-01T00:00:00Z"));
    await verknuepfe(
      kindA2,
      zweiKinder.id as string,
      t("2026-01-10T00:00:00Z"),
    );

    einzelA = await einzelchat(welt, welt.stufeAId, elternA.id as string);
    const nachricht = (chatId: string, text: string, erstelltAm: Date) =>
      db.insert(schema.nachricht).values({
        chatId,
        autorId: sl.id as string,
        text,
        erstelltAm,
      });
    await nachricht(
      einzelA,
      "Antwort vor dem Beitritt",
      t("2026-01-05T00:00:00Z"),
    );
    await nachricht(
      welt.gruppenchatAId,
      "Eine Sekunde vor dem Beitritt",
      t("2026-02-28T23:59:59Z"),
    );
    await nachricht(
      welt.gruppenchatAId,
      "Am Beitritt",
      t("2026-03-01T00:00:00Z"),
    );
  });

  test("es gilt das spätere Datum von Verknüpfung und stufe_seit, über Kinder das früheste", async () => {
    const zeilen = await mitgliedschaften(
      welt.testabteilungId,
      elternA.id as string,
    );
    expect(zeilen).toEqual(
      erwartet([
        { chatId: welt.gruppenchatAId, sichtAb: t("2026-03-01T00:00:00Z") },
        { chatId: einzelA, sichtAb: null },
      ]),
    );
    expect(
      zeilen.find((z) => z.chatId === welt.gruppenchatAId)?.sichtAb,
    ).toBeInstanceOf(Date);
    expect(
      await mitgliedschaften(welt.testabteilungId, elternB.id as string),
    ).toEqual([
      { chatId: welt.gruppenchatBId, sichtAb: t("2026-04-01T00:00:00Z") },
    ]);
    expect(
      await mitgliedschaften(welt.testabteilungId, zweiKinder.id as string),
    ).toEqual([
      { chatId: welt.gruppenchatAId, sichtAb: t("2026-02-01T00:00:00Z") },
    ]);
  });

  test("Nachrichten vor dem Beitritt bleiben Eltern verborgen, ab dem Beitritt nicht; SL und der eigene Einzelchat ganz", async () => {
    expect(
      await sichtbareTexte(welt.testabteilungId, elternA.id as string),
    ).toEqual(["Antwort vor dem Beitritt", "Am Beitritt"]);
    expect(
      await sichtbareTexte(welt.testabteilungId, zweiKinder.id as string),
    ).toEqual(["Eine Sekunde vor dem Beitritt", "Am Beitritt"]);
    expect(await sichtbareTexte(welt.testabteilungId, sl.id as string)).toEqual(
      [
        "Antwort vor dem Beitritt",
        "Eine Sekunde vor dem Beitritt",
        "Am Beitritt",
      ],
    );
  });
});

describe("SL und Elternteil in derselben Stufe", () => {
  test("eine Zeile pro Chat, mit ganzem Verlauf", async () => {
    const welt = await erstelleWelt(db, auth);
    const sl = await legePersonaAn(welt, "slA");
    await verknuepfe(welt.kindAId, sl.id as string, t("2026-03-01T00:00:00Z"));
    const eltern = await legePersonaAn(welt, "elternA");
    const einzelA = await einzelchat(welt, welt.stufeAId, eltern.id as string);

    expect(
      await mitgliedschaften(welt.testabteilungId, sl.id as string),
    ).toEqual(
      erwartet([
        { chatId: welt.gruppenchatAId, sichtAb: null },
        { chatId: einzelA, sichtAb: null },
      ]),
    );
  });
});

describe("Leitung in einer Stufe und Elternteil in einer anderen", () => {
  test("nur die Eltern-Stufe zählt: Gruppenchat ab Beitritt, eigener Einzelchat, nichts aus der geleiteten Stufe", async () => {
    const welt = await erstelleWelt(db, auth);
    const konto = await legePersonaAn(welt, "leitendeAElternB");
    const userId = konto.id as string;
    await setzeKind(welt.kindBId, t("2026-01-01T00:00:00Z"));
    await setzeVerknuepfung(welt.kindBId, userId, t("2026-02-01T00:00:00Z"));
    const einzelB = await einzelchat(welt, welt.stufeBId, userId);

    expect(await mitgliedschaften(welt.testabteilungId, userId)).toEqual(
      erwartet([
        { chatId: welt.gruppenchatBId, sichtAb: t("2026-02-01T00:00:00Z") },
        { chatId: einzelB, sichtAb: null },
      ]),
    );
  });
});

describe("Demo-Abteilung", () => {
  test("ihre Mitglieder sind genau demoEltern; eine fremde Rolle in der Demo-Stufe zählt nicht", async () => {
    const welt = await erstelleWelt(db, auth);
    const demoEltern = await legePersonaAn(welt, "demoEltern");
    const demoAdmin = await legePersonaAn(welt, "demoAdmin");
    const sl = await legePersonaAn(welt, "slA");
    await setzeKind(welt.demoKindId, t("2026-01-01T00:00:00Z"));
    await setzeVerknuepfung(
      welt.demoKindId,
      demoEltern.id as string,
      t("2026-01-15T00:00:00Z"),
    );
    // Datenfehler: Eine SL der Testabteilung bekommt eine Rolle in der Demo-Stufe; die Abteilungs-Bedingung am Konto hält sie draussen
    await db.insert(schema.rolle).values({
      userId: sl.id as string,
      stufeId: welt.demoStufeId,
      typ: "stufenleitung",
    });

    const m = chatMitglieder(db, welt.demoAbteilungId);
    expect(
      await db
        .select({ chatId: m.chatId, userId: m.userId, sichtAb: m.sichtAb })
        .from(m),
    ).toEqual([
      {
        chatId: welt.demoGruppenchatId,
        userId: demoEltern.id,
        sichtAb: t("2026-01-15T00:00:00Z"),
      },
    ]);
    expect(
      await mitgliedschaften(welt.testabteilungId, demoAdmin.id as string),
    ).toEqual([]);
  });
});

describe("Fremde Chats liefern per ID 404", () => {
  // Testroute wie die späteren Chat-Routen (#49): chatFuerPerson, undefined wird 404
  const app = erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    expo: new Expo({ accessToken: "test-zugang" }),
    seiten: ladeSeiten(),
  }).get(
    "/api/v1/test/chats/:id",
    eingabe("param", z.strictObject({ id: z.uuid() })),
    async (c) => {
      const chat = await chatFuerPerson(
        db,
        c.get("person"),
        c.req.valid("param").id,
      );
      if (!chat) throw new HTTPException(404);
      return c.json({ id: chat.id });
    },
  );

  let welt: Welt;
  let konten: Record<Persona, PersonaKonto>;
  // Reihenfolge der Ziele: Gruppenchat A, B, Demo, Einzelchat von elternA, eines zweiten Elternteils von Kind A, von elternB, zufällige ID
  let ziele: string[];

  beforeAll(async () => {
    welt = await erstelleWelt(db, auth);
    konten = Object.fromEntries(
      await Promise.all(
        PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
      ),
    ) as Record<Persona, PersonaKonto>;
    const zweitesElternteilA = await legePersonaAn(welt, "elternA");
    ziele = [
      welt.gruppenchatAId,
      welt.gruppenchatBId,
      welt.demoGruppenchatId,
      await einzelchat(welt, welt.stufeAId, konten.elternA.id as string),
      await einzelchat(welt, welt.stufeAId, zweitesElternteilA.id as string),
      await einzelchat(welt, welt.stufeBId, konten.elternB.id as string),
      randomUUID(),
    ];
  });

  // 200 nur für Mitglieder (SL der Stufe oder das Elternteil selbst), alles andere 404, auch für Admins; ohne gültige Sitzung 401, vor dem Pflichtwechsel 403 (#15)
  const ERWARTET: Record<Persona, number[]> = {
    admin: [404, 404, 404, 404, 404, 404, 404],
    adminOhneZweitenFaktor: [404, 404, 404, 404, 404, 404, 404],
    slA: [200, 404, 404, 200, 200, 404, 404],
    slB: [404, 200, 404, 404, 404, 200, 404],
    leitendeA: [404, 404, 404, 404, 404, 404, 404],
    leitendeB: [404, 404, 404, 404, 404, 404, 404],
    leitendeAElternB: [404, 200, 404, 404, 404, 404, 404],
    elternA: [200, 404, 404, 200, 404, 404, 404],
    elternB: [404, 200, 404, 404, 404, 200, 404],
    mussPasswortAendern: [403, 403, 403, 403, 403, 403, 403],
    deaktiviert: [401, 401, 401, 401, 401, 401, 401],
    ohneLogin: [401, 401, 401, 401, 401, 401, 401],
    demoAdmin: [404, 404, 404, 404, 404, 404, 404],
    demoEltern: [404, 404, 200, 404, 404, 404, 404],
  };

  test.each(PERSONAS)("%s", async (persona) => {
    const { headers } = konten[persona];
    const antworten = await Promise.all(
      ziele.map((id) => app.request(`/api/v1/test/chats/${id}`, { headers })),
    );
    expect(antworten.map((a) => a.status)).toEqual(ERWARTET[persona]);
  });

  test("eine gelöste Verknüpfung wirkt sofort, auch in der laufenden Sitzung", async () => {
    const konto = await legePersonaAn(welt, "elternA");
    const eigene = [
      welt.gruppenchatAId,
      await einzelchat(welt, welt.stufeAId, konto.id as string),
    ];
    for (const chatId of eigene) {
      const vorher = await app.request(`/api/v1/test/chats/${chatId}`, {
        headers: konto.headers,
      });
      expect(vorher.status).toBe(200);
    }
    await db
      .delete(schema.kindEltern)
      .where(eq(schema.kindEltern.userId, konto.id as string));
    for (const chatId of eigene) {
      const nachher = await app.request(`/api/v1/test/chats/${chatId}`, {
        headers: konto.headers,
      });
      expect(nachher.status).toBe(404);
    }
  });
});
