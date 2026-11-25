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
let demoEltern: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, eltern, sl, demoEltern] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "demoEltern"),
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

const BASIS = "/api/v1/admin/tags";
let zaehler = 0;
// In einer Abteilung ist der Name eindeutig: Jeder Aufruf braucht einen eigenen
const neuerName = () =>
  `Tag ${++zaehler} ${Math.random().toString(36).slice(2)}`;

async function legeTagAn(
  konto = admin,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const antwort = await anfrage(konto, "POST", BASIS, {
    typ: "team",
    name: neuerName(),
    ...extra,
  });
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { id: string }).id;
}

const zeile = async (id: string) =>
  (await db.select().from(schema.tag).where(eq(schema.tag.id, id)))[0];

const zuordnung = async (tagId: string, userId: string) =>
  (
    await db
      .select()
      .from(schema.personTag)
      .where(
        and(
          eq(schema.personTag.tagId, tagId),
          eq(schema.personTag.userId, userId),
        ),
      )
  )[0];

const auditZeilen = (zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.zielId, zielId))
    .orderBy(schema.auditLog.erstelltAm);

describe("POST /api/v1/admin/tags", () => {
  test("legt den Tag in der Abteilung der Abteilungsleitung an, getrimmt, und schreibt das Audit-Log ohne Namen", async () => {
    const id = await legeTagAn(admin, {
      typ: "funktion",
      name: "  Kasse Geheim  ",
      kuerzel: " K ",
    });
    expect(await zeile(id)).toMatchObject({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: "Kasse Geheim",
      kuerzel: "K",
    });
    const [audit] = await auditZeilen(id);
    expect(audit).toMatchObject({
      abteilungId: welt.testabteilungId,
      akteurId: admin.id,
      aktion: "tag_angelegt",
      zielTyp: "tag",
      details: { typ: "funktion" },
    });
    expect(JSON.stringify(audit)).not.toContain("Geheim");
  });

  test("das Kürzel ist optional und leer, wenn es fehlt", async () => {
    expect((await zeile(await legeTagAn()))?.kuerzel).toBe("");
  });

  test("der Name ist pro Abteilung ohne Gross-/Kleinschreibung eindeutig, über alle Typen", async () => {
    const name = neuerName();
    await legeTagAn(admin, { name, typ: "team" });
    for (const variante of [name, name.toUpperCase(), name.toLowerCase()]) {
      const antwort = await anfrage(admin, "POST", BASIS, {
        typ: "lager",
        name: variante,
      });
      expect(antwort.status).toBe(409);
      expect(await antwort.json()).toEqual({
        code: "TAGNAME_VERGEBEN",
        message: "Es gibt schon einen Tag mit diesem Namen.",
      });
    }
  });

  test("dieselben Namen in einer anderen Abteilung sind frei", async () => {
    const name = neuerName();
    await legeTagAn(admin, { name });
    await legeTagAn(demoAdmin, { name });
  });

  test("Eltern und Leitung bekommen 403 und nichts entsteht", async () => {
    const name = neuerName();
    for (const konto of [eltern, sl]) {
      expect(
        (await anfrage(konto, "POST", BASIS, { typ: "team", name })).status,
      ).toBe(403);
    }
    expect(
      await db.select().from(schema.tag).where(eq(schema.tag.name, name)),
    ).toEqual([]);
  });

  test.each([
    ["unbekannter Typ", { typ: "gruppe" }],
    ["fehlender Typ", { typ: undefined }],
    ["leerer Name", { name: "   " }],
    ["Name mit 101 Zeichen", { name: "a".repeat(101) }],
    ["Kürzel mit 21 Zeichen", { kuerzel: "a".repeat(21) }],
    ["leeres Kürzel", { kuerzel: "  " }],
    ["abteilungId im Body", { abteilungId: "x" }],
  ])("%s gibt 400", async (_titel, extra) => {
    const antwort = await anfrage(admin, "POST", BASIS, {
      typ: "team",
      name: neuerName(),
      ...extra,
    });
    expect(antwort.status).toBe(400);
  });
});

describe("GET /api/v1/admin/tags", () => {
  test("listet nur die Tags der eigenen Abteilung mit der Zahl der Personen", async () => {
    const mit = await legeTagAn(admin, { typ: "stufe" });
    const fremd = await legeTagAn(demoAdmin);
    await anfrage(admin, "PUT", `${BASIS}/${mit}/personen/${eltern.id}`, {});
    await anfrage(admin, "PUT", `${BASIS}/${mit}/personen/${sl.id}`, {});
    const antwort = await anfrage(admin, "GET", BASIS);
    expect(antwort.status).toBe(200);
    const { tags } = (await antwort.json()) as {
      tags: { id: string; anzahlPersonen: number; typ: string }[];
    };
    expect(tags.map((t) => t.id)).not.toContain(fremd);
    expect(tags.find((t) => t.id === mit)).toMatchObject({
      typ: "stufe",
      anzahlPersonen: 2,
    });
  });

  test("Eltern bekommen 403", async () => {
    expect((await anfrage(eltern, "GET", BASIS)).status).toBe(403);
  });
});

describe("GET /api/v1/admin/tags/:id", () => {
  test("zeigt, wer den Tag trägt", async () => {
    const id = await legeTagAn();
    await anfrage(admin, "PUT", `${BASIS}/${id}/personen/${eltern.id}`, {
      rolle: "Kasse",
      prioritaet: 2,
    });
    const antwort = await anfrage(admin, "GET", `${BASIS}/${id}`);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({
      id,
      typ: "team",
      verwendung: { personen: 1 },
      personen: [{ userId: eltern.id, rolle: "Kasse", prioritaet: 2 }],
    });
  });

  test("ein Tag einer anderen Abteilung und ein unbekannter sind 404, auch für Eltern", async () => {
    const fremd = await legeTagAn(demoAdmin);
    for (const id of [fremd, crypto.randomUUID()]) {
      for (const konto of [admin, eltern]) {
        expect((await anfrage(konto, "GET", `${BASIS}/${id}`)).status).toBe(
          404,
        );
      }
    }
  });

  test("Eltern bekommen 403", async () => {
    const id = await legeTagAn();
    expect((await anfrage(eltern, "GET", `${BASIS}/${id}`)).status).toBe(403);
  });
});

describe("PATCH /api/v1/admin/tags/:id", () => {
  test("benennt um, ohne den Typ zu ändern, und schreibt das Audit-Log ohne Werte", async () => {
    const id = await legeTagAn(admin, { typ: "lager" });
    const antwort = await anfrage(admin, "PATCH", `${BASIS}/${id}`, {
      name: "Neuer Geheimname",
      kuerzel: "N",
    });
    expect(antwort.status).toBe(204);
    expect(await zeile(id)).toMatchObject({
      typ: "lager",
      name: "Neuer Geheimname",
      kuerzel: "N",
    });
    const audit = (await auditZeilen(id)).find(
      (z) => z.aktion === "tag_geaendert",
    );
    expect(audit?.details).toEqual({ name: true, kuerzel: true });
    expect(JSON.stringify(audit)).not.toContain("Geheimname");
  });

  test("der Typ lässt sich nicht ändern", async () => {
    const id = await legeTagAn();
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${id}`, { typ: "lager" }))
        .status,
    ).toBe(400);
  });

  test("ein leeres Objekt ist ein No-op ohne Audit-Eintrag", async () => {
    const id = await legeTagAn();
    expect((await anfrage(admin, "PATCH", `${BASIS}/${id}`, {})).status).toBe(
      204,
    );
    expect((await auditZeilen(id)).map((z) => z.aktion)).toEqual([
      "tag_angelegt",
    ]);
  });

  test("ein vergebener Name gibt 409, der eigene Name in anderer Schreibweise ist erlaubt", async () => {
    const andere = neuerName();
    await legeTagAn(admin, { name: andere });
    const id = await legeTagAn();
    const antwort = await anfrage(admin, "PATCH", `${BASIS}/${id}`, {
      name: andere.toUpperCase(),
    });
    expect(antwort.status).toBe(409);
    const eigener = (await zeile(id))!.name;
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${id}`, {
          name: eigener.toUpperCase(),
        })
      ).status,
    ).toBe(204);
  });

  test("ein Tag einer anderen Abteilung ist 404 und bleibt unverändert", async () => {
    const fremd = await legeTagAn(demoAdmin);
    const vorher = await zeile(fremd);
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${fremd}`, { name: "x" }))
        .status,
    ).toBe(404);
    expect(await zeile(fremd)).toEqual(vorher);
  });

  test("Eltern bekommen 403", async () => {
    const id = await legeTagAn();
    expect(
      (await anfrage(eltern, "PATCH", `${BASIS}/${id}`, { name: "x" })).status,
    ).toBe(403);
  });
});

describe("DELETE /api/v1/admin/tags/:id", () => {
  test("löscht einen unbenutzten Tag und schreibt das Audit-Log", async () => {
    const id = await legeTagAn(admin, { typ: "lager" });
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(await zeile(id)).toBeUndefined();
    expect(
      (await auditZeilen(id)).map((z) => [z.aktion, z.details]),
    ).toContainEqual(["tag_geloescht", { typ: "lager" }]);
  });

  test("ein zugewiesener Tag gibt 409 mit Hinweis auf die Verwendung und bleibt", async () => {
    const id = await legeTagAn();
    await anfrage(admin, "PUT", `${BASIS}/${id}/personen/${eltern.id}`, {});
    const antwort = await anfrage(admin, "DELETE", `${BASIS}/${id}`);
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({
      code: "TAG_BELEGT",
      verwendung: { personen: 1 },
    });
    expect(await zeile(id)).toBeDefined();
    // Nach dem Entzug geht es
    await anfrage(admin, "DELETE", `${BASIS}/${id}/personen/${eltern.id}`);
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
  });

  test("ein Tag einer anderen Abteilung ist 404 und bleibt", async () => {
    const fremd = await legeTagAn(demoAdmin);
    expect((await anfrage(admin, "DELETE", `${BASIS}/${fremd}`)).status).toBe(
      404,
    );
    expect(await zeile(fremd)).toBeDefined();
  });

  test("Eltern bekommen 403 und der Tag bleibt", async () => {
    const id = await legeTagAn();
    expect((await anfrage(eltern, "DELETE", `${BASIS}/${id}`)).status).toBe(
      403,
    );
    expect(await zeile(id)).toBeDefined();
  });
});

describe("PUT und DELETE /api/v1/admin/tags/:id/personen/:userId", () => {
  const url = (tagId: string, userId: string | null) =>
    `${BASIS}/${tagId}/personen/${userId}`;

  test("weist zu, mit Rolle und Priorität, und schreibt das Audit-Log ohne die Rolle", async () => {
    const id = await legeTagAn();
    const antwort = await anfrage(admin, "PUT", url(id, eltern.id), {
      rolle: "  Geheimrolle ",
      prioritaet: 1,
    });
    expect(antwort.status).toBe(204);
    expect(await zuordnung(id, eltern.id!)).toMatchObject({
      rolle: "Geheimrolle",
      prioritaet: 1,
    });
    const audit = (await auditZeilen(id)).find(
      (z) => z.aktion === "tag_zugewiesen",
    );
    expect(audit).toMatchObject({
      akteurId: admin.id,
      zielTyp: "tag",
      details: { userId: eltern.id, rolle: true, prioritaet: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain("Geheimrolle");
  });

  test("eine Person ohne Angaben trägt den Tag ohne Rolle und Priorität", async () => {
    const id = await legeTagAn();
    expect((await anfrage(admin, "PUT", url(id, sl.id), {})).status).toBe(204);
    expect(await zuordnung(id, sl.id!)).toMatchObject({
      rolle: null,
      prioritaet: null,
    });
  });

  test("ein zweiter Aufruf ändert nur die genannten Felder, null leert, eine Zeile bleibt", async () => {
    const id = await legeTagAn();
    await anfrage(admin, "PUT", url(id, eltern.id), {
      rolle: "A",
      prioritaet: 3,
    });
    await anfrage(admin, "PUT", url(id, eltern.id), { rolle: "B" });
    expect(await zuordnung(id, eltern.id!)).toMatchObject({
      rolle: "B",
      prioritaet: 3,
    });
    await anfrage(admin, "PUT", url(id, eltern.id), {});
    await anfrage(admin, "PUT", url(id, eltern.id), { prioritaet: null });
    expect(await zuordnung(id, eltern.id!)).toMatchObject({
      rolle: "B",
      prioritaet: null,
    });
    const zeilen = await db
      .select()
      .from(schema.personTag)
      .where(eq(schema.personTag.tagId, id));
    expect(zeilen).toHaveLength(1);
  });

  test("eine Person einer anderen Abteilung ist 404 und trägt nichts", async () => {
    const id = await legeTagAn();
    expect(
      (await anfrage(admin, "PUT", url(id, demoEltern.id), {})).status,
    ).toBe(404);
    expect(await zuordnung(id, demoEltern.id!)).toBeUndefined();
    expect(
      (await anfrage(admin, "PUT", url(id, crypto.randomUUID()), {})).status,
    ).toBe(404);
  });

  test("ein Tag einer anderen Abteilung ist 404: Die Leitung kann ihre Person nicht dort eintragen", async () => {
    const fremd = await legeTagAn(demoAdmin);
    expect(
      (await anfrage(admin, "PUT", url(fremd, eltern.id), {})).status,
    ).toBe(404);
    expect(await zuordnung(fremd, eltern.id!)).toBeUndefined();
  });

  test("Eltern und Leitung bekommen 403 und können sich keinen Tag geben", async () => {
    const id = await legeTagAn();
    for (const konto of [eltern, sl]) {
      expect((await anfrage(konto, "PUT", url(id, konto.id), {})).status).toBe(
        403,
      );
      expect(await zuordnung(id, konto.id!)).toBeUndefined();
    }
  });

  test.each([
    ["Priorität 0", { prioritaet: 0 }],
    ["Priorität als Text", { prioritaet: "1" }],
    ["Priorität 1.5", { prioritaet: 1.5 }],
    ["leere Rolle", { rolle: "  " }],
    ["Rolle mit 51 Zeichen", { rolle: "a".repeat(51) }],
    ["unbekanntes Feld", { admin: true }],
  ])("%s gibt 400", async (_titel, body) => {
    const id = await legeTagAn();
    expect((await anfrage(admin, "PUT", url(id, eltern.id), body)).status).toBe(
      400,
    );
  });

  describe("Stufenrollen (#344)", () => {
    const neuePerson = async () => {
      const [p] = await db
        .insert(schema.user)
        .values({
          name: "Stufenrolle Person",
          email: `${crypto.randomUUID()}@example.org`,
          username: `stufenrolle.${crypto.randomUUID().slice(0, 8)}`,
          abteilungId: welt.testabteilungId,
          mussPasswortAendern: false,
        })
        .returning({ id: schema.user.id });
      return p.id;
    };

    test.each(["leitung", "stufenleitung", "  stufenleitung "])(
      "an einem Stufen-Tag ist die Rolle «%s» 400 und legt nichts an; die Antwort zeigt keine Details",
      async (rolle) => {
        const antwort = await anfrage(
          admin,
          "PUT",
          url(welt.stufeAId, eltern.id),
          { rolle },
        );
        expect(antwort.status).toBe(400);
        expect(await antwort.json()).toEqual({
          code: "UNGUELTIGE_EINGABE",
          message: "Ungültige Eingabe",
        });
        expect(await zuordnung(welt.stufeAId, eltern.id!)).toBeUndefined();
      },
    );

    test("eine bestehende Stufenrolle bleibt bei einer abgelehnten Änderung unberührt", async () => {
      const userId = await neuePerson();
      const patch = await anfrage(
        admin,
        "PATCH",
        `/api/v1/admin/personen/${userId}`,
        { rollen: [{ stufeId: welt.stufeAId, typ: "leitung" }] },
      );
      expect(patch.status).toBe(204);
      expect(
        (
          await anfrage(admin, "PUT", url(welt.stufeAId, userId), {
            rolle: "stufenleitung",
          })
        ).status,
      ).toBe(400);
      expect(await zuordnung(welt.stufeAId, userId)).toMatchObject({
        rolle: "leitung",
      });
    });

    test("die Stufenrolle setzt PATCH /admin/personen/:id und schreibt «rolle_geaendert»", async () => {
      const userId = await neuePerson();
      const patch = await anfrage(
        admin,
        "PATCH",
        `/api/v1/admin/personen/${userId}`,
        { rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }] },
      );
      expect(patch.status).toBe(204);
      expect(await zuordnung(welt.stufeAId, userId)).toMatchObject({
        rolle: "stufenleitung",
      });
      expect(
        (await auditZeilen(userId)).filter(
          (z) => z.aktion === "rolle_geaendert",
        ),
      ).toEqual([
        expect.objectContaining({
          akteurId: admin.id,
          zielTyp: "person",
          details: {
            rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
          },
        }),
      ]);
    });

    test("eine freie Rolle an einem Stufen-Tag bleibt möglich", async () => {
      const userId = await neuePerson();
      expect(
        (
          await anfrage(admin, "PUT", url(welt.stufeAId, userId), {
            rolle: "Material",
          })
        ).status,
      ).toBe(204);
      expect(await zuordnung(welt.stufeAId, userId)).toMatchObject({
        rolle: "Material",
      });
    });

    test.each(["team", "funktion", "lager"])(
      "an einem Tag vom Typ %s ist die Rolle «leitung» möglich",
      async (typ) => {
        const id = await legeTagAn(admin, { typ });
        expect(
          (
            await anfrage(admin, "PUT", url(id, eltern.id), {
              rolle: "leitung",
            })
          ).status,
        ).toBe(204);
        expect(await zuordnung(id, eltern.id!)).toMatchObject({
          rolle: "leitung",
        });
      },
    );
  });

  test("entzieht den Tag und schreibt das Audit-Log; ein zweiter Entzug ist 404", async () => {
    const id = await legeTagAn();
    await anfrage(admin, "PUT", url(id, eltern.id), {});
    expect((await anfrage(admin, "DELETE", url(id, eltern.id))).status).toBe(
      204,
    );
    expect(await zuordnung(id, eltern.id!)).toBeUndefined();
    expect((await auditZeilen(id)).map((z) => z.aktion)).toContain(
      "tag_entzogen",
    );
    expect((await anfrage(admin, "DELETE", url(id, eltern.id))).status).toBe(
      404,
    );
  });

  test("Eltern können keinen Tag entziehen", async () => {
    const id = await legeTagAn();
    await anfrage(admin, "PUT", url(id, eltern.id), {});
    expect((await anfrage(eltern, "DELETE", url(id, eltern.id))).status).toBe(
      403,
    );
    expect(await zuordnung(id, eltern.id!)).toBeDefined();
  });

  test("das Löschen der Person nimmt ihre Zuordnungen mit", async () => {
    const id = await legeTagAn();
    const [wegwerf] = await db
      .insert(schema.user)
      .values({
        name: "Wegwerf Person",
        email: `${crypto.randomUUID()}@example.org`,
        username: `wegwerf.${crypto.randomUUID().slice(0, 8)}`,
        abteilungId: welt.testabteilungId,
        mussPasswortAendern: false,
      })
      .returning({ id: schema.user.id });
    await anfrage(admin, "PUT", url(id, wegwerf.id), {});
    expect(await zuordnung(id, wegwerf.id)).toBeDefined();
    await db.delete(schema.user).where(eq(schema.user.id, wegwerf.id));
    expect(await zuordnung(id, wegwerf.id)).toBeUndefined();
  });
});

describe("Gruppentyp «anlass» (#626)", () => {
  // Ein Anlass mit Termin; art «lager» legt sonst das Lager-Modul an
  async function legeAnlassAn(
    abteilungId: string,
    art: "anlass" | "lager" = "anlass",
    titel = "Anlass für Gruppen",
  ) {
    const [p] = await db
      .insert(schema.programm)
      .values({
        abteilungId,
        googleEventId: `test-${crypto.randomUUID()}`,
        titel,
        ganztaegig: true,
        tagVon: "2027-05-01",
        tagBis: "2027-05-01",
      })
      .returning({ id: schema.programm.id });
    const [a] = await db
      .insert(schema.anlass)
      .values({
        abteilungId,
        programmId: p.id,
        art,
        anmeldungFuer: "person",
        sichtbarkeit: "angemeldet",
      })
      .returning({ id: schema.anlass.id });
    return a.id;
  }
  const legeGruppeAn = (anlassId: string, name = neuerName()) =>
    anfrage(admin, "POST", BASIS, { typ: "anlass", name, anlassId });
  const idVon = async (antwort: Response) =>
    ((await antwort.json()) as { id: string }).id;

  test("legt die Gruppe zum Anlass an, ohne Seite, und schreibt das Audit-Log ohne Namen", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    const seiten = () =>
      db
        .select()
        .from(schema.seite)
        .where(eq(schema.seite.abteilungId, welt.testabteilungId));
    const vorher = (await seiten()).length;
    const antwort = await legeGruppeAn(anlassId, "  OK Geheim  ");
    expect(antwort.status).toBe(201);
    const id = await idVon(antwort);
    expect(await zeile(id)).toMatchObject({
      typ: "anlass",
      anlassId,
      name: "OK Geheim",
      abteilungId: welt.testabteilungId,
    });
    // Der Typ legt keine Seite der Website an
    expect(await seiten()).toHaveLength(vorher);
    const [audit] = await auditZeilen(id);
    expect(audit).toMatchObject({
      aktion: "tag_angelegt",
      details: { typ: "anlass", anlassId },
    });
    expect(JSON.stringify(audit)).not.toContain("Geheim");
  });

  test("Liste und Detail nennen den Anlass mit Titel und Datum; andere Typen haben keinen", async () => {
    const anlassId = await legeAnlassAn(
      welt.testabteilungId,
      "anlass",
      "Sitzungsanlass",
    );
    const id = await idVon(await legeGruppeAn(anlassId));
    const andere = await legeTagAn();
    const liste = (await (await anfrage(admin, "GET", BASIS)).json()) as {
      tags: { id: string; anlass: Record<string, unknown> | null }[];
    };
    expect(liste.tags.find((t) => t.id === id)?.anlass).toMatchObject({
      id: anlassId,
      titel: "Sitzungsanlass",
      ganztaegig: true,
      tagVon: "2027-05-01",
    });
    expect(liste.tags.find((t) => t.id === andere)?.anlass).toBeNull();
    const detail = (await (
      await anfrage(admin, "GET", `${BASIS}/${id}`)
    ).json()) as { typ: string; anlass: { titel: string } | null };
    expect(detail).toMatchObject({
      typ: "anlass",
      anlass: { titel: "Sitzungsanlass" },
    });
    const anderesDetail = (await (
      await anfrage(admin, "GET", `${BASIS}/${andere}`)
    ).json()) as { anlass: unknown };
    expect(anderesDetail.anlass).toBeNull();
  });

  test("der Anlass zeigt seine Gruppe in Detail und Liste", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    const pfad = `/api/v1/admin/anlaesse/${anlassId}`;
    const ohne = await anfrage(admin, "GET", pfad);
    expect(((await ohne.json()) as { gruppe: unknown }).gruppe).toBeNull();
    const id = await idVon(await legeGruppeAn(anlassId, "OK Test"));
    const mit = await anfrage(admin, "GET", pfad);
    expect(((await mit.json()) as { gruppe: unknown }).gruppe).toEqual({
      id,
      name: "OK Test",
    });
    const liste = (await (
      await anfrage(admin, "GET", "/api/v1/admin/anlaesse?limit=100")
    ).json()) as { anlaesse: { id: string; gruppe: { id: string } | null }[] };
    expect(liste.anlaesse.find((a) => a.id === anlassId)?.gruppe?.id).toBe(id);
  });

  test("höchstens eine Gruppe je Anlass: die zweite gibt 409, ein Namenskonflikt bleibt TAGNAME_VERGEBEN", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    await legeGruppeAn(anlassId);
    const zweite = await legeGruppeAn(anlassId);
    expect(zweite.status).toBe(409);
    expect(await zweite.json()).toMatchObject({ code: "ANLASS_HAT_GRUPPE" });
    const name = neuerName();
    await legeTagAn(admin, { name });
    const andererAnlass = await legeAnlassAn(welt.testabteilungId);
    const doppelt = await legeGruppeAn(andererAnlass, name);
    expect(doppelt.status).toBe(409);
    expect(await doppelt.json()).toMatchObject({ code: "TAGNAME_VERGEBEN" });
  });

  test("fremder, unbekannter und Lager-Anlass geben 400, nichts entsteht", async () => {
    const fremd = await legeAnlassAn(demoAdmin.abteilungId!);
    const lager = await legeAnlassAn(welt.testabteilungId, "lager");
    for (const anlassId of [fremd, lager, crypto.randomUUID()]) {
      const name = neuerName();
      const antwort = await legeGruppeAn(anlassId, name);
      expect(antwort.status).toBe(400);
      expect(await antwort.json()).toMatchObject({ code: "ANLASS_UNBEKANNT" });
      expect(
        await db.select().from(schema.tag).where(eq(schema.tag.name, name)),
      ).toEqual([]);
    }
  });

  test.each([
    ["Typ «anlass» ohne anlassId", { typ: "anlass" }],
    ["anlassId bei einem anderen Typ", { typ: "team", anlassId: "x" }],
    ["anlassId keine UUID", { typ: "anlass", anlassId: "x" }],
  ])("%s gibt 400", async (_titel, extra) => {
    const antwort = await anfrage(admin, "POST", BASIS, {
      name: neuerName(),
      ...extra,
    });
    expect(antwort.status).toBe(400);
  });

  test("anlassId bei einem anderen Typ gibt 400, und die Datenbank hält es auch", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    const antwort = await anfrage(admin, "POST", BASIS, {
      typ: "team",
      name: neuerName(),
      anlassId,
    });
    expect(antwort.status).toBe(400);
    await expect(
      db.insert(schema.tag).values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: neuerName(),
        kuerzel: "",
        anlassId,
      }),
    ).rejects.toThrow();
  });

  test("Eltern und Leitung bekommen 403, auch für den Typ «anlass»", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    for (const konto of [eltern, sl]) {
      const antwort = await anfrage(konto, "POST", BASIS, {
        typ: "anlass",
        name: neuerName(),
        anlassId,
      });
      expect(antwort.status).toBe(403);
    }
  });

  test("Mitglieder wie bei Teams: Rolle als Freitext, Entfernen, Löschen erst ohne Mitglieder", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    const id = await idVon(await legeGruppeAn(anlassId));
    const url = `${BASIS}/${id}/personen/${eltern.id}`;
    expect(
      (await anfrage(admin, "PUT", url, { rolle: "verantwortlich" })).status,
    ).toBe(204);
    expect((await zuordnung(id, eltern.id!))?.rolle).toBe("verantwortlich");
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(409);
    expect((await anfrage(admin, "DELETE", url)).status).toBe(204);
    expect((await anfrage(admin, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(await zeile(id)).toBeUndefined();
  });

  test("der Typ gibt keine Rechte: Ein Mitglied bleibt Eltern und erreicht keine Verwaltung", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    const id = await idVon(await legeGruppeAn(anlassId));
    await anfrage(admin, "PUT", `${BASIS}/${id}/personen/${eltern.id}`, {
      rolle: "verantwortlich",
    });
    for (const pfad of [
      BASIS,
      `${BASIS}/${id}`,
      "/api/v1/admin/anlaesse",
      `/api/v1/admin/anlaesse/${anlassId}`,
    ]) {
      expect((await anfrage(eltern, "GET", pfad)).status).toBe(403);
    }
    await anfrage(admin, "DELETE", `${BASIS}/${id}/personen/${eltern.id}`);
  });

  test("fällt der Anlass weg, bleibt die Gruppe mit ihren Mitgliedern, ohne Verknüpfung", async () => {
    const anlassId = await legeAnlassAn(welt.testabteilungId);
    const id = await idVon(await legeGruppeAn(anlassId));
    await anfrage(admin, "PUT", `${BASIS}/${id}/personen/${sl.id}`, {});
    expect(
      (await anfrage(admin, "DELETE", `/api/v1/admin/anlaesse/${anlassId}`))
        .status,
    ).toBe(204);
    expect(await zeile(id)).toMatchObject({ typ: "anlass", anlassId: null });
    expect(await zuordnung(id, sl.id!)).toBeDefined();
    const detail = (await (
      await anfrage(admin, "GET", `${BASIS}/${id}`)
    ).json()) as { anlass: unknown; verwendung: { personen: number } };
    expect(detail.anlass).toBeNull();
    expect(detail.verwendung.personen).toBe(1);
    await anfrage(admin, "DELETE", `${BASIS}/${id}/personen/${sl.id}`);
  });
});
