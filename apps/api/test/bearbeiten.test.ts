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
import { erstelleApp } from "../src/app.js";
import {
  bearbeitbar,
  darfBearbeiten,
  type ObjektTyp,
} from "../src/bearbeiten.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Person } from "../src/rechte.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { macheWebmaster } from "./hilfen/webmaster.js";

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

const BASIS = "/api/v1/admin/bearbeiter";
const SEITE: ObjektTyp = "seite";

// Frisches Konto der Persona, damit jeder Test sein eigenes hat und Rollen oder Sperren frei ändern darf
const neuePerson = (persona: Persona) => legePersonaAn(welt, persona);

// Wie personAusSitzung (rechte.ts): Rolle und Stufenrollen frisch aus der Datenbank, nie zwischengespeichert
async function personVon(konto: PersonaKonto): Promise<Person> {
  const [u] = await db
    .select({ abteilungId: schema.user.abteilungId, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, konto.id!));
  const rollen = await db
    .select({ stufeId: schema.rolle.stufeId, typ: schema.rolle.typ })
    .from(schema.rolle)
    .innerJoin(
      schema.stufe,
      and(
        eq(schema.rolle.stufeId, schema.stufe.id),
        eq(schema.stufe.abteilungId, u.abteilungId),
      ),
    )
    .where(eq(schema.rolle.userId, konto.id!));
  return {
    id: konto.id!,
    abteilungId: u.abteilungId,
    admin: u.role === "admin",
    zweiterFaktor: true,
    rollen,
  };
}

const darf = async (konto: PersonaKonto, objektId: string, stufeId?: string) =>
  darfBearbeiten(db, await personVon(konto), SEITE, objektId, { stufeId });

async function setze(
  akteur: PersonaKonto,
  body: Record<string, unknown>,
): Promise<string> {
  const antwort = await anfrage(akteur, "POST", BASIS, {
    objektTyp: SEITE,
    objektId: randomUUID(),
    ...body,
  });
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { id: string }).id;
}

async function legeTagAn(abteilungId = welt.testabteilungId) {
  const [zeile] = await db
    .insert(schema.tag)
    .values({
      abteilungId,
      typ: "team",
      name: `Team ${randomUUID()}`,
      kuerzel: "R",
    })
    .returning({ id: schema.tag.id });
  return zeile.id;
}

const traegt = (userId: string, tagId: string) =>
  db.insert(schema.personTag).values({ userId, tagId });

const auditZeilen = (zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.zielId, zielId))
    .orderBy(schema.auditLog.erstelltAm);

describe("darfBearbeiten: Rollen", () => {
  test("Abteilungsleitung darf jedes Objekt, auch ohne Eintrag", async () => {
    expect(await darf(admin, randomUUID())).toBe(true);
    expect(await darf(admin, randomUUID(), welt.stufeBId)).toBe(true);
  });

  test("Eltern, Leitende und Personen ohne Recht dürfen nichts", async () => {
    const objekt = randomUUID();
    expect(await darf(eltern, objekt)).toBe(false);
    expect(await darf(eltern, objekt, welt.stufeAId)).toBe(false);
    // «leitung» ist keine Stufenleitung: auch nicht für die eigene Stufe
    expect(await darf(leitende, objekt, welt.stufeAId)).toBe(false);
  });

  test("Stufenleitung darf nur Objekte der eigenen Stufe", async () => {
    const objekt = randomUUID();
    expect(await darf(sl, objekt, welt.stufeAId)).toBe(true);
    expect(await darf(sl, objekt, welt.stufeBId)).toBe(false);
    // Ohne Stufe am Objekt gibt es kein Stufenrecht
    expect(await darf(sl, objekt)).toBe(false);
  });

  test("Stufenleitung einer Stufe der Fremdabteilung zählt nicht", async () => {
    const person = await personVon(sl);
    const fremd = { ...person, abteilungId: welt.demoAbteilungId, rollen: [] };
    expect(
      await darfBearbeiten(db, fremd, SEITE, randomUUID(), {
        stufeId: welt.stufeAId,
      }),
    ).toBe(false);
  });

  test("Webmaster darf alle Seiten, aber nichts in der Verwaltung", async () => {
    const webmaster = await neuePerson("elternA");
    const objekt = randomUUID();
    expect(await darf(webmaster, objekt)).toBe(false);
    await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
    expect(await darf(webmaster, objekt)).toBe(true);
    expect(await darf(webmaster, randomUUID(), welt.stufeBId)).toBe(true);
    // Keine Person der Abteilungsleitung-Rechte: Verwaltung bleibt 403, und die Abteilungsleitung-Status ist unverändert
    expect((await anfrage(webmaster, "GET", BASIS)).status).toBe(403);
    expect(
      (
        await anfrage(webmaster, "POST", BASIS, {
          objektTyp: SEITE,
          objektId: objekt,
          userId: webmaster.id,
        })
      ).status,
    ).toBe(403);
    expect((await personVon(webmaster)).admin).toBe(false);
  });

  test("Das Recht «Seiten bearbeiten» entscheidet; Veröffentlichen ist ein eigenes Recht", async () => {
    const objekt = randomUUID();
    const nurBearbeiten = await neuePerson("elternA");
    await macheWebmaster(db, welt.testabteilungId, nurBearbeiten.id!, [
      "seiten.bearbeiten",
    ]);
    const nurVeroeffentlichen = await neuePerson("elternA");
    await macheWebmaster(db, welt.testabteilungId, nurVeroeffentlichen.id!, [
      "seiten.veroeffentlichen",
    ]);
    const nurMedien = await neuePerson("elternA");
    await macheWebmaster(db, welt.testabteilungId, nurMedien.id!, [
      "medien.verwalten",
    ]);
    const frage = async (konto: PersonaKonto, veroeffentlichen: boolean) =>
      darfBearbeiten(db, await personVon(konto), SEITE, objekt, {
        veroeffentlichen,
      });
    expect(await frage(nurBearbeiten, false)).toBe(true);
    expect(await frage(nurBearbeiten, true)).toBe(false);
    expect(await frage(nurVeroeffentlichen, false)).toBe(false);
    expect(await frage(nurVeroeffentlichen, true)).toBe(true);
    // Ein anderes Recht der Rolle öffnet keine Seite
    expect(await frage(nurMedien, false)).toBe(false);
    expect(await frage(nurMedien, true)).toBe(false);
    // Stufenleitung und Abteilungsleitung veröffentlichen immer; ein Sonderrecht auf die Seite auch
    expect(
      await darfBearbeiten(db, await personVon(sl), SEITE, objekt, {
        stufeId: welt.stufeAId,
        veroeffentlichen: true,
      }),
    ).toBe(true);
    expect(
      await darfBearbeiten(db, await personVon(admin), SEITE, objekt, {
        veroeffentlichen: true,
      }),
    ).toBe(true);
    await setze(admin, { objektId: objekt, userId: nurMedien.id });
    expect(await frage(nurMedien, true)).toBe(true);
  });

  test("Die Rolle Webmaster einer anderen Abteilung gibt nichts", async () => {
    const person = await neuePerson("elternA");
    await macheWebmaster(db, welt.demoAbteilungId, person.id!);
    expect(await darf(person, randomUUID())).toBe(false);
  });
});

describe("darfBearbeiten: Sonderrechte", () => {
  test("Sonderrecht für eine Person gilt nur für ihr Objekt und endet sofort mit dem Entzug", async () => {
    const person = await neuePerson("elternA");
    const objekt = randomUUID();
    const id = await setze(admin, { objektId: objekt, userId: person.id });
    expect(await darf(person, objekt)).toBe(true);
    expect(await darf(person, randomUUID())).toBe(false);
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(await darf(person, objekt)).toBe(false);
  });

  test("Sonderrecht für einen Tag gilt für Personen, die ihn tragen, und endet mit dem Tag", async () => {
    const person = await neuePerson("elternA");
    const andere = await neuePerson("elternA");
    const tagId = await legeTagAn();
    const objekt = randomUUID();
    // Ein Tag allein verleiht nichts
    await traegt(person.id!, tagId);
    expect(await darf(person, objekt)).toBe(false);
    await setze(admin, { objektId: objekt, tagId });
    expect(await darf(person, objekt)).toBe(true);
    expect(await darf(person, randomUUID())).toBe(false);
    expect(await darf(andere, objekt)).toBe(false);
    // Tag entzogen: Das Recht ist sofort weg
    await db
      .delete(schema.personTag)
      .where(eq(schema.personTag.userId, person.id!));
    expect(await darf(person, objekt)).toBe(false);
  });

  test("«Alle Seiten» gibt es nicht mehr als Sonderrecht: ohne Objekt 400, in der Datenbank nicht möglich", async () => {
    const person = await neuePerson("elternA");
    const tagId = await legeTagAn();
    await traegt(person.id!, tagId);
    for (const ziel of [{ tagId }, { userId: person.id }]) {
      expect(
        (await anfrage(admin, "POST", BASIS, { objektTyp: SEITE, ...ziel }))
          .status,
      ).toBe(400);
    }
    await expect(
      db.insert(schema.bearbeiter).values({
        abteilungId: welt.testabteilungId,
        objektTyp: SEITE,
        tagId,
      } as typeof schema.bearbeiter.$inferInsert),
    ).rejects.toThrow();
    expect(await darf(person, randomUUID())).toBe(false);
  });

  test("Das Recht für einen Typ gilt nicht für andere Abteilungen: Zeile und Tag der Fremdabteilung geben nichts", async () => {
    const person = await neuePerson("elternA");
    const objekt = randomUUID();
    // Direkt eingefügt, wie es die Routen nie zulassen: Zeile der Demo-Abteilung auf eine Person der Testabteilung
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.demoAbteilungId,
      objektTyp: SEITE,
      objektId: objekt,
      userId: person.id,
    });
    expect(await darf(person, objekt)).toBe(false);
    // Zeile der Testabteilung auf einen Tag der Demo-Abteilung, den die Person trägt
    const fremderTag = await legeTagAn(welt.demoAbteilungId);
    await traegt(person.id!, fremderTag);
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: SEITE,
      objektId: objekt,
      tagId: fremderTag,
    });
    expect(await darf(person, objekt)).toBe(false);
  });

  test("Rollenwechsel: Wer nicht mehr Abteilungsleitung ist, verliert das Recht; wer die Stufe verliert, die Stufenleitung", async () => {
    const zweiter = await neuePerson("admin");
    const objekt = randomUUID();
    expect(await darf(zweiter, objekt)).toBe(true);
    await db
      .update(schema.user)
      .set({ role: "user" })
      .where(eq(schema.user.id, zweiter.id!));
    expect(await darf(zweiter, objekt)).toBe(false);

    const zweiteSl = await neuePerson("slA");
    expect(await darf(zweiteSl, objekt, welt.stufeAId)).toBe(true);
    await db.delete(schema.rolle).where(eq(schema.rolle.userId, zweiteSl.id!));
    expect(await darf(zweiteSl, objekt, welt.stufeAId)).toBe(false);
  });

  test("Deaktivierte Personen kommen gar nicht erst an die Routen (401)", async () => {
    const webmaster = await neuePerson("elternA");
    await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
    await db
      .update(schema.user)
      .set({ banned: true, deaktiviertAm: new Date() })
      .where(eq(schema.user.id, webmaster.id!));
    expect((await anfrage(webmaster, "GET", "/api/v1/ich")).status).toBe(401);
  });
});

describe("bearbeitbar (Filter für Listen)", () => {
  // Die Kinder der Welt stehen für Objekte mit id, Abteilung und Stufe
  const spalten = {
    id: schema.kind.id,
    abteilungId: schema.kind.abteilungId,
    stufeId: schema.kind.stufeId,
  };
  const liste = async (konto: PersonaKonto) =>
    (
      await db
        .select({ id: schema.kind.id })
        .from(schema.kind)
        .where(bearbeitbar(await personVon(konto), SEITE, spalten))
    )
      .map((z) => z.id)
      .sort();
  const sortiert = (...ids: string[]) => ids.sort();

  test("Abteilungsleitung sieht alle Objekte der eigenen Abteilung, nie die der fremden", async () => {
    expect(await liste(admin)).toEqual(sortiert(welt.kindAId, welt.kindBId));
    expect(await liste(demoAdmin)).toEqual([welt.demoKindId]);
  });

  test("Stufenleitung nur die eigene Stufe, Eltern nichts", async () => {
    expect(await liste(sl)).toEqual([welt.kindAId]);
    expect(await liste(eltern)).toEqual([]);
    expect(await liste(leitende)).toEqual([]);
  });

  test("Sonderrecht auf ein Objekt, über eine Person oder einen Tag, und Webmaster", async () => {
    const mitPerson = await neuePerson("elternA");
    await setze(admin, { objektId: welt.kindBId, userId: mitPerson.id });
    expect(await liste(mitPerson)).toEqual([welt.kindBId]);

    const mitTag = await neuePerson("elternB");
    const tagId = await legeTagAn();
    await traegt(mitTag.id!, tagId);
    await setze(admin, { objektId: welt.kindAId, tagId });
    expect(await liste(mitTag)).toEqual([welt.kindAId]);

    // Stufenrecht und Sonderrecht zusammen: jedes Objekt höchstens einmal
    const slMitSonderrecht = await neuePerson("slA");
    await setze(admin, { objektId: welt.kindAId, userId: slMitSonderrecht.id });
    await setze(admin, { objektId: welt.kindBId, userId: slMitSonderrecht.id });
    expect(await liste(slMitSonderrecht)).toEqual(
      sortiert(welt.kindAId, welt.kindBId),
    );

    const webmaster = await neuePerson("elternA");
    await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
    expect(await liste(webmaster)).toEqual(
      sortiert(welt.kindAId, welt.kindBId),
    );
    // Ohne das Recht «Seiten bearbeiten» zeigt die Rolle nichts
    const ohneSeiten = await neuePerson("elternA");
    await macheWebmaster(db, welt.testabteilungId, ohneSeiten.id!, [
      "medien.verwalten",
    ]);
    expect(await liste(ohneSeiten)).toEqual([]);
  });

  test("Zeile der Fremdabteilung gibt kein Objekt frei", async () => {
    const person = await neuePerson("elternA");
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.demoAbteilungId,
      objektTyp: SEITE,
      objektId: welt.kindAId,
      userId: person.id,
    });
    expect(await liste(person)).toEqual([]);
  });
});

// Verantwortliche eines Teams (#352, Annahme: Rolle «verantwortlich» am Tag): Option tagId in darfBearbeiten und bearbeitbar
describe("Team-Verantwortliche (Option tagId)", () => {
  const rolleAmTag = async (
    rolle: string | null,
    typ: "team" | "stufe" | "funktion" = "team",
  ) => {
    const [tag] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ,
        name: `Team ${randomUUID()}`,
        kuerzel: "T",
      })
      .returning({ id: schema.tag.id });
    const person = await neuePerson("leitendeA");
    await db
      .insert(schema.personTag)
      .values({ userId: person.id!, tagId: tag.id, rolle });
    return { tagId: tag.id, person };
  };
  const darfTag = async (konto: PersonaKonto, tagId: string | undefined) =>
    darfBearbeiten(db, await personVon(konto), SEITE, randomUUID(), { tagId });

  test("«verantwortlich» am Team-Tag gibt das Recht, ohne die Option nicht", async () => {
    const { tagId, person } = await rolleAmTag("verantwortlich");
    expect(await darfTag(person, tagId)).toBe(true);
    // Gross-/Kleinschreibung der Rolle zählt nicht
    const gross = await rolleAmTag("Verantwortlich");
    expect(await darfTag(gross.person, gross.tagId)).toBe(true);
    // Die Seite gehört zu keiner Gruppe: kein Recht
    expect(await darfTag(person, undefined)).toBe(false);
  });

  test("ein anderer Tag, eine andere oder keine Rolle gibt nichts", async () => {
    const { tagId, person } = await rolleAmTag("verantwortlich");
    expect(await darfTag(person, randomUUID())).toBe(false);
    expect(await darfTag(person, await legeTagAn())).toBe(false);
    for (const rolle of [null, "Mitglied", "verantwortlich "]) {
      const t = await rolleAmTag(rolle);
      expect(await darfTag(t.person, t.tagId), String(rolle)).toBe(false);
    }
    expect(await darfTag(eltern, tagId)).toBe(false);
  });

  test("an einem Stufen- oder Funktions-Tag gibt die Rolle nichts (Rechteausweitung)", async () => {
    for (const typ of ["stufe", "funktion"] as const) {
      const t = await rolleAmTag("verantwortlich", typ);
      expect(await darfTag(t.person, t.tagId), typ).toBe(false);
    }
  });

  test("ein Team der Fremdabteilung gibt nichts", async () => {
    const [fremd] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.demoAbteilungId,
        typ: "team",
        name: `Fremd ${randomUUID()}`,
        kuerzel: "F",
      })
      .returning({ id: schema.tag.id });
    const person = await neuePerson("leitendeA");
    await db.insert(schema.personTag).values({
      userId: person.id!,
      tagId: fremd.id,
      rolle: "verantwortlich",
    });
    expect(await darfTag(person, fremd.id)).toBe(false);
  });

  test("der Filter für Listen nimmt die Seiten des Teams mit, nicht die anderen", async () => {
    const mein = await rolleAmTag("verantwortlich");
    const anderer = await legeTagAn();
    const lege = async (tagId: string | null) => {
      const [zeile] = await db
        .insert(schema.seite)
        .values({
          abteilungId: welt.testabteilungId,
          adresse: `t-${randomUUID().slice(0, 12)}`,
          titel: "T",
          sichtbarkeit: "angemeldet",
          tagId,
        })
        .returning({ id: schema.seite.id });
      return zeile.id;
    };
    const meine = await lege(mein.tagId);
    await lege(anderer);
    await lege(null);
    const liste = async (tagSpalte: boolean) =>
      (
        await db
          .select({ id: schema.seite.id })
          .from(schema.seite)
          .where(
            bearbeitbar(await personVon(mein.person), SEITE, {
              id: schema.seite.id,
              abteilungId: schema.seite.abteilungId,
              ...(tagSpalte && { tagId: schema.seite.tagId }),
            }),
          )
      ).map((z) => z.id);
    expect(await liste(true)).toEqual([meine]);
    // Ohne die Option gibt es kein Teamrecht
    expect(await liste(false)).toEqual([]);
  });
});

describe("/api/v1/admin/bearbeiter", () => {
  test("legt ein Recht an, listet es und schreibt das Audit-Log ohne Inhalte", async () => {
    const person = await neuePerson("elternA");
    const objekt = randomUUID();
    const id = await setze(admin, { objektId: objekt, userId: person.id });
    const liste = await anfrage(admin, "GET", BASIS);
    expect(liste.status).toBe(200);
    expect(
      ((await liste.json()) as { bearbeiter: { id: string }[] }).bearbeiter,
    ).toContainEqual({
      id,
      objektTyp: SEITE,
      objektId: objekt,
      userId: person.id,
      tagId: null,
    });
    await anfrage(admin, "DELETE", `${BASIS}/${id}`);
    const audit = await auditZeilen(id);
    expect(audit.map((a) => a.aktion)).toEqual([
      "bearbeiter_gesetzt",
      "bearbeiter_entzogen",
    ]);
    expect(audit[0]).toMatchObject({
      abteilungId: welt.testabteilungId,
      akteurId: admin.id,
      zielTyp: "bearbeiter",
      details: { objektTyp: SEITE, objektId: objekt, userId: person.id },
    });
  });

  test("dasselbe Recht zweimal gibt 409", async () => {
    const person = await neuePerson("elternA");
    const objektId = randomUUID();
    await setze(admin, { objektId, userId: person.id });
    const antwort = await anfrage(admin, "POST", BASIS, {
      objektTyp: SEITE,
      objektId,
      userId: person.id,
    });
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({
      code: "BEARBEITER_VORHANDEN",
    });
  });

  test.each([
    ["weder Person noch Tag", {}],
    ["Person und Tag zugleich", { userId: randomUUID(), tagId: randomUUID() }],
    ["unbekannter Objekttyp", { userId: randomUUID(), objektTyp: "termin" }],
    ["Objekt-ID keine uuid", { userId: randomUUID(), objektId: "x" }],
    [
      "Objekt-ID fehlt: alle Seiten ist das Recht Seiten bearbeiten",
      { userId: randomUUID() },
    ],
    ["Objekt-ID null", { userId: randomUUID(), objektId: null }],
    ["unbekanntes Feld", { userId: randomUUID(), rolle: "x" }],
  ])("%s: 400", async (_, body) => {
    const antwort = await anfrage(admin, "POST", BASIS, {
      objektTyp: SEITE,
      ...body,
    });
    expect(antwort.status).toBe(400);
  });

  test("Person, Tag oder Recht einer anderen Abteilung sind unbekannt (404), nichts wird geschrieben", async () => {
    const person = await neuePerson("elternA");
    const tagId = await legeTagAn();
    for (const ziel of [{ userId: person.id }, { tagId }]) {
      expect(
        (
          await anfrage(demoAdmin, "POST", BASIS, {
            objektTyp: SEITE,
            objektId: randomUUID(),
            ...ziel,
          })
        ).status,
      ).toBe(404);
    }
    const id = await setze(admin, { userId: person.id });
    expect((await anfrage(demoAdmin, "DELETE", `${BASIS}/${id}`)).status).toBe(
      404,
    );
    expect(
      (await anfrage(admin, "DELETE", `${BASIS}/${randomUUID()}`)).status,
    ).toBe(404);
    // Die Liste der Demo-Abteilung zeigt es nicht
    const liste = (await (await anfrage(demoAdmin, "GET", BASIS)).json()) as {
      bearbeiter: { id: string }[];
    };
    expect(liste.bearbeiter.map((z) => z.id)).not.toContain(id);
    expect(
      await db
        .select()
        .from(schema.bearbeiter)
        .where(
          and(
            eq(schema.bearbeiter.userId, person.id!),
            eq(schema.bearbeiter.abteilungId, welt.demoAbteilungId),
          ),
        ),
    ).toEqual([]);
  });

  test("Stufenleitung, Leitende und Eltern bekommen 403 und können sich nichts geben", async () => {
    const person = await neuePerson("elternA");
    const id = await setze(admin, { userId: person.id });
    for (const konto of [sl, leitende, eltern]) {
      expect((await anfrage(konto, "GET", BASIS)).status).toBe(403);
      expect(
        (
          await anfrage(konto, "POST", BASIS, {
            objektTyp: SEITE,
            objektId: randomUUID(),
            userId: konto.id,
          })
        ).status,
      ).toBe(403);
      expect((await anfrage(konto, "DELETE", `${BASIS}/${id}`)).status).toBe(
        403,
      );
    }
  });
});

describe("Datenbank", () => {
  test("eine Zeile hat genau eine Person oder einen Tag", async () => {
    const person = await neuePerson("elternA");
    const tagId = await legeTagAn();
    const einfuegen = (werte: { userId?: string; tagId?: string }) =>
      db.insert(schema.bearbeiter).values({
        abteilungId: welt.testabteilungId,
        objektTyp: SEITE,
        objektId: randomUUID(),
        ...werte,
      });
    await expect(einfuegen({})).rejects.toThrow();
    await expect(einfuegen({ userId: person.id!, tagId })).rejects.toThrow();
  });

  test("Löscht man einen Tag oder eine Person, fallen ihre Rechte mit", async () => {
    const person = await neuePerson("elternA");
    const tagId = await legeTagAn();
    await setze(admin, { userId: person.id });
    await setze(admin, { tagId });
    await db.delete(schema.tag).where(eq(schema.tag.id, tagId));
    await db.delete(schema.user).where(eq(schema.user.id, person.id!));
    expect(
      await db
        .select()
        .from(schema.bearbeiter)
        .where(eq(schema.bearbeiter.userId, person.id!)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.bearbeiter)
        .where(eq(schema.bearbeiter.tagId, tagId)),
    ).toEqual([]);
  });
});
