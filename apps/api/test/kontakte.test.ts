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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

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

const ROLLEN = [
  "admin",
  "slA",
  "slB",
  "leitendeA",
  "leitendeB",
  "leitendeAElternB",
  "elternA",
  "elternB",
] as const;
type Rolle = (typeof ROLLEN)[number];

const NUMMER_A = "+41 79 111 22 33";
const NUMMER_B = "+41 79 444 55 66";

const setzeNummer = (konto: PersonaKonto, telefon: string | null) =>
  db
    .update(schema.user)
    .set({ telefon })
    .where(eq(schema.user.id, konto.id as string));

let welt: Welt;
let konten: Record<Rolle, PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      ROLLEN.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Rolle, PersonaKonto>;
  await setzeNummer(konten.slA, NUMMER_A);
  await setzeNummer(konten.slB, NUMMER_B);
});

// Die Konten dieser Datei haben alle eine ID
const idVon = (rolle: Rolle) => konten[rolle].id as string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Beginn in einem Jahr: Die Anmeldung der Leitung schliesst mit dem Beginn
const frisch = (stufen: string[]) =>
  legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen,
    beginn: new Date(Date.now() + 365 * 86_400_000),
  });

const anmelden = (
  programmId: string,
  konto: PersonaKonto,
  status: "ja" | "nein",
) =>
  db
    .insert(schema.leitungAnmeldung)
    .values({ programmId, userId: konto.id as string, status })
    .onConflictDoUpdate({
      target: [
        schema.leitungAnmeldung.programmId,
        schema.leitungAnmeldung.userId,
      ],
      set: { status },
    });

type Kontakt = { id: string; name: string; telefon: string | null };

const lies = async (pfad: string, konto: PersonaKonto) => {
  const res = await app.request(pfad, { headers: konto.headers });
  const text = await res.text();
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    text,
    kontakte: (res.status === 200
      ? JSON.parse(text).kontakte
      : []) as Kontakt[],
  };
};
const programmKontakte = (id: string, konto: PersonaKonto) =>
  lies(`/api/v1/programme/${id}/kontakte`, konto);
const stufeKontakte = (id: string, konto: PersonaKonto) =>
  lies(`/api/v1/stufen/${id}/kontakte`, konto);

// Name der SL zur Nummer, die die Person sieht
const nummernNachName = (kontakte: Kontakt[]) =>
  Object.fromEntries(kontakte.map((k) => [k.name, k.telefon]));

describe("GET /api/v1/programme/:id/kontakte", () => {
  test("ohne angemeldete SL: leere Liste, 200", async () => {
    const p = await frisch([welt.stufeAId]);
    const r = await programmKontakte(p.id, konten.elternA);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ kontakte: [] });
  });

  test("nur SL mit Status Ja zählen, nicht «nein», nicht «offen», nicht Leitende", async () => {
    const p = await frisch([welt.stufeAId]);
    await anmelden(p.id, konten.slA, "ja");
    await anmelden(p.id, konten.leitendeA, "ja");
    await anmelden(p.id, await legePersonaAn(welt, "slA"), "nein");
    // Eine SL ganz ohne Zeile: «offen»
    await legePersonaAn(welt, "slA");
    const r = await programmKontakte(p.id, konten.elternA);
    expect(r.kontakte).toEqual([
      {
        id: idVon("slA"),
        name: "SL A",
        ceviName: null,
        bildUrl: null,
        telefon: NUMMER_A,
      },
    ]);
  });

  test("Eltern der Stufe sehen die Nummer, alle anderen nie, auch Admins nicht", async () => {
    const p = await frisch([welt.stufeAId, welt.stufeBId]);
    await anmelden(p.id, konten.slA, "ja");
    await anmelden(p.id, konten.slB, "ja");
    const sicht = async (rolle: Rolle) => {
      const r = await programmKontakte(p.id, konten[rolle]);
      expect(r.status).toBe(200);
      expect(r.cacheControl).toBe("no-store");
      return r;
    };
    // Die Namen sehen alle, die das Programm sehen; die Nummer nur Eltern mit aktivem Kind in der Stufe der SL
    const a = await sicht("elternA");
    const b = await sicht("elternB");
    // Leitende A und zugleich Elternteil B: die Nummer nur als Elternteil
    const gemischt = await sicht("leitendeAElternB");
    expect(a.kontakte.map((k) => k.name)).toEqual(["SL A", "SL B"]);
    expect(nummernNachName(a.kontakte)).toEqual({
      "SL A": NUMMER_A,
      "SL B": null,
    });
    expect(nummernNachName(b.kontakte)).toEqual({
      "SL A": null,
      "SL B": NUMMER_B,
    });
    expect(nummernNachName(gemischt.kontakte)).toEqual({
      "SL A": null,
      "SL B": NUMMER_B,
    });
    for (const rolle of [
      "admin",
      "slA",
      "slB",
      "leitendeA",
      "leitendeB",
    ] as const) {
      const r = await sicht(rolle);
      expect(nummernNachName(r.kontakte)).toEqual({
        "SL A": null,
        "SL B": null,
      });
      expect(r.text).not.toContain("79 111");
      expect(r.text).not.toContain("79 444");
    }
  });

  test("Eltern einer anderen Stufe sehen das Programm nicht: 404 ohne Nummer", async () => {
    const p = await frisch([welt.stufeAId]);
    await anmelden(p.id, konten.slA, "ja");
    const r = await programmKontakte(p.id, konten.elternB);
    expect(r.status).toBe(404);
    expect(r.text).not.toContain("79 111");
  });

  test("eine abgemeldete SL verschwindet sofort", async () => {
    const p = await frisch([welt.stufeAId]);
    await anmelden(p.id, konten.slA, "ja");
    expect(
      (await programmKontakte(p.id, konten.elternA)).kontakte,
    ).toHaveLength(1);

    const res = await app.request(`/api/v1/programme/${p.id}/leitung`, {
      method: "PUT",
      headers: { ...konten.slA.headers, "content-type": "application/json" },
      body: JSON.stringify({ status: "nein" }),
    });
    expect(res.status).toBe(204);
    const danach = await programmKontakte(p.id, konten.elternA);
    expect(danach.status).toBe(200);
    expect(danach.kontakte).toEqual([]);
  });

  test("eine deaktivierte SL und eine ohne Rolle fehlen", async () => {
    const p = await frisch([welt.stufeAId]);
    const sl = await legePersonaAn(welt, "slA");
    await setzeNummer(sl, "044 123 45 67");
    await anmelden(p.id, sl, "ja");
    const ids = async () =>
      (await programmKontakte(p.id, konten.elternA)).kontakte.map((k) => k.id);
    expect(await ids()).toEqual([sl.id]);

    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, sl.id as string));
    expect(await ids()).toEqual([]);

    await db
      .update(schema.user)
      .set({ deaktiviertAm: null })
      .where(eq(schema.user.id, sl.id as string));
    expect(await ids()).toEqual([sl.id]);
    await db
      .delete(schema.rolle)
      .where(eq(schema.rolle.userId, sl.id as string));
    expect(await ids()).toEqual([]);
  });

  test("Eltern mit nur noch inaktivem Kind verlieren Programm und Nummer", async () => {
    const p = await frisch([welt.stufeAId]);
    await anmelden(p.id, konten.slA, "ja");
    const eltern = await legePersonaAn(welt, "elternA");
    expect((await programmKontakte(p.id, eltern)).status).toBe(200);
    await db
      .update(schema.kind)
      .set({ inaktivSeit: new Date() })
      .where(eq(schema.kind.id, welt.kindAId));
    try {
      const r = await programmKontakte(p.id, eltern);
      expect(r.status).toBe(404);
      expect(r.text).not.toContain("79 111");
    } finally {
      await db
        .update(schema.kind)
        .set({ inaktivSeit: null })
        .where(eq(schema.kind.id, welt.kindAId));
    }
  });

  test("unbekannte Programme sind 404, eine ungültige ID 400", async () => {
    const unbekannt = "00000000-0000-4000-8000-000000000000";
    expect((await programmKontakte(unbekannt, konten.admin)).status).toBe(404);
    expect((await programmKontakte("keine-uuid", konten.admin)).status).toBe(
      400,
    );
  });
});

describe("GET /api/v1/stufen/:id/kontakte", () => {
  test("liefert die aktiven SL der Stufe; die Nummer nur den Eltern der Stufe", async () => {
    // Weitere SL der Stufe aus anderen Tests tragen keine Nummer; ohne Rolle oder deaktiviert fehlen sie
    const ohneNummer = await legePersonaAn(welt, "slA");
    const eltern = await stufeKontakte(welt.stufeAId, konten.elternA);
    expect(eltern.status).toBe(200);
    expect(eltern.cacheControl).toBe("no-store");
    expect(eltern.kontakte).toEqual(
      expect.arrayContaining([
        {
          id: idVon("slA"),
          name: "SL A",
          ceviName: null,
          bildUrl: null,
          telefon: NUMMER_A,
        },
        {
          id: ohneNummer.id,
          name: "SL A",
          ceviName: null,
          bildUrl: null,
          telefon: null,
        },
      ]),
    );
    expect(eltern.kontakte.map((k) => k.id)).not.toContain(idVon("slB"));

    // Wer die Stufe nur leitet oder verwaltet, sieht die Namen, aber keine Nummer
    for (const rolle of [
      "admin",
      "leitendeA",
      "slA",
      "leitendeAElternB",
    ] as const) {
      const r = await stufeKontakte(welt.stufeAId, konten[rolle]);
      expect(r.status).toBe(200);
      expect(r.cacheControl).toBe("no-store");
      expect(r.kontakte.length).toBeGreaterThan(0);
      expect(r.kontakte.every((k) => k.telefon === null)).toBe(true);
      expect(r.text).not.toContain("79 111");
    }
  });

  test("eine deaktivierte SL fehlt", async () => {
    const sl = await legePersonaAn(welt, "slA");
    const ids = async () =>
      (await stufeKontakte(welt.stufeAId, konten.elternA)).kontakte.map(
        (k) => k.id,
      );
    expect(await ids()).toContain(sl.id);
    await db
      .update(schema.user)
      .set({ banned: true, deaktiviertAm: new Date() })
      .where(eq(schema.user.id, sl.id as string));
    expect(await ids()).not.toContain(sl.id);
  });

  test("Eltern einer anderen Stufe, Leitende und SL anderer Stufen: 404 ohne Nummer", async () => {
    for (const rolle of ["elternB", "leitendeB", "slB"] as const) {
      const r = await stufeKontakte(welt.stufeAId, konten[rolle]);
      expect(r.status).toBe(404);
      expect(r.text).not.toContain("79 111");
    }
  });

  test("Elternteil mit nur noch inaktivem Kind in der Stufe: 404", async () => {
    const eltern = await legePersonaAn(welt, "elternA");
    await db
      .update(schema.kind)
      .set({ inaktivSeit: new Date() })
      .where(eq(schema.kind.id, welt.kindAId));
    try {
      expect((await stufeKontakte(welt.stufeAId, eltern)).status).toBe(404);
    } finally {
      await db
        .update(schema.kind)
        .set({ inaktivSeit: null })
        .where(eq(schema.kind.id, welt.kindAId));
    }
  });

  test("Stufe einer anderen Abteilung und unbekannte Stufe: 404", async () => {
    const unbekannt = "00000000-0000-4000-8000-000000000000";
    expect((await stufeKontakte(welt.demoStufeId, konten.admin)).status).toBe(
      404,
    );
    expect((await stufeKontakte(unbekannt, konten.admin)).status).toBe(404);
  });
});

describe("PATCH /api/v1/ich: Telefon", () => {
  const patch = (konto: PersonaKonto, body: unknown) =>
    app.request("/api/v1/ich", {
      method: "PATCH",
      headers: { ...konto.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const telefon = async (konto: PersonaKonto) =>
    (
      await (
        await app.request("/api/v1/ich", { headers: konto.headers })
      ).json()
    ).telefon;

  test("SL speichert, ändert und entfernt ihre Nummer", async () => {
    const sl = await legePersonaAn(welt, "slA");
    expect((await patch(sl, { telefon: "  079 123 45 67 " })).status).toBe(204);
    expect(await telefon(sl)).toBe("079 123 45 67");
    expect(
      (await patch(sl, { telefon: "+41 44 123 45 67", pushChat: false }))
        .status,
    ).toBe(204);
    expect(await telefon(sl)).toBe("+41 44 123 45 67");
    expect((await patch(sl, { telefon: null })).status).toBe(204);
    expect(await telefon(sl)).toBeNull();
    expect((await patch(sl, { telefon: "079 123 45 67" })).status).toBe(204);
    expect((await patch(sl, { telefon: "" })).status).toBe(204);
    expect(await telefon(sl)).toBeNull();
  });

  test.each(["elternA", "leitendeA", "admin"] as const)(
    "%s darf keine Nummer speichern: 403, nichts geändert",
    async (persona) => {
      const konto = await legePersonaAn(welt, persona);
      expect((await patch(konto, { telefon: "079 123 45 67" })).status).toBe(
        403,
      );
      expect(await telefon(konto)).toBeNull();
    },
  );

  test("wer die Rolle verloren hat, darf die Nummer nicht mehr setzen, aber entfernen", async () => {
    const sl = await legePersonaAn(welt, "slA");
    await setzeNummer(sl, "079 123 45 67");
    await db
      .delete(schema.rolle)
      .where(eq(schema.rolle.userId, sl.id as string));
    expect((await patch(sl, { telefon: "079 765 43 21" })).status).toBe(403);
    expect(await telefon(sl)).toBe("079 123 45 67");
    expect((await patch(sl, { telefon: null })).status).toBe(204);
    expect(await telefon(sl)).toBeNull();
  });

  test.each([
    ["Buchstaben", "079 abc 45 67"],
    ["zu kurz", "123"],
    ["zu lang", "0".repeat(31)],
    ["ein Link", "tel:079 123 45 67"],
    ["eine Zahl", 791234567],
  ])("%s ergibt 400 und ändert nichts", async (_titel, wert) => {
    const sl = await legePersonaAn(welt, "slA");
    expect((await patch(sl, { telefon: wert })).status).toBe(400);
    expect(await telefon(sl)).toBeNull();
  });
});
