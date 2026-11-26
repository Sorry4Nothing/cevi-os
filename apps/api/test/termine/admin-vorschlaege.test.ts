import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { terminVorschlag } from "../../src/db/schema-vorschlag.js";
import { ladeSeiten } from "../../src/seiten.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  fcmNachricht,
} from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

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

const ADMIN = "/api/v1/admin/termin-vorschlaege";
const BASIS = "/api/v1/termin-vorschlaege";
const TITEL = "Geheimer Waldabend";

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
let tagId: string;
let tagName: string;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(PERSONAS.map((p) => legePersonaAn(welt, p)));
  konten = Object.fromEntries(
    PERSONAS.map((p, i) => [p, liste[i]]),
  ) as typeof konten;
  tagName = `Kat ${randomUUID().slice(0, 8)}`;
  [{ id: tagId }] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: tagName,
      kuerzel: "K",
    })
    .returning({ id: schema.tag.id });
});
beforeEach(() => fcmAttrappe.zuruecksetzen());

const aufruf = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) =>
  app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Stand = "offen" | "freigegeben" | "abgelehnt" | "in_outlook_eingetragen";
async function vorschlag(
  vonId: string | null,
  stand: Stand = "offen",
  extra: Partial<typeof terminVorschlag.$inferInsert> = {},
) {
  const [z] = await db
    .insert(terminVorschlag)
    .values({
      abteilungId: welt.testabteilungId,
      vorgeschlagenVon: vonId,
      titel: TITEL,
      ganztaegig: true,
      tagVon: "2099-01-01",
      tagBis: "2099-01-01",
      tagIds: [tagId],
      status: stand,
      ...extra,
    })
    .returning({ id: terminVorschlag.id });
  return z!.id;
}

const zeile = async (id: string) =>
  (
    await db.select().from(terminVorschlag).where(eq(terminVorschlag.id, id))
  )[0]!;
const protokoll = (id: string, aktion: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(eq(schema.auditLog.zielId, id), eq(schema.auditLog.aktion, aktion)),
    );

async function token(konto: PersonaKonto) {
  const wert = `fcm-test-${randomUUID()}`;
  const antwort = await aufruf(konto, "PUT", "/api/v1/push-token", {
    token: wert,
    plattform: "android",
  });
  expect(antwort.status).toBe(204);
  return wert;
}

describe("GET /admin/termin-vorschlaege", () => {
  test("Standard: nur offene der eigenen Abteilung, mit Name der vorschlagenden Person", async () => {
    const offen = await vorschlag(konten.slA.id!);
    const frei = await vorschlag(konten.slA.id!, "freigegeben");
    const fremd = (
      await db
        .insert(terminVorschlag)
        .values({
          abteilungId: welt.demoAbteilungId,
          vorgeschlagenVon: konten.demoAdmin.id!,
          titel: "Fremd",
          ganztaegig: true,
          tagVon: "2099-01-01",
          tagBis: "2099-01-01",
          tagIds: [tagId],
        })
        .returning({ id: terminVorschlag.id })
    )[0]!.id;

    const antwort = await aufruf(konten.admin, "GET", `${ADMIN}?limit=100`);
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as {
      vorschlaege: {
        id: string;
        status: string;
        vorgeschlagenVonName: string | null;
        tags: { id: string }[];
      }[];
      weitere: boolean;
    };
    const idsListe = body.vorschlaege.map((v) => v.id);
    expect(idsListe).toContain(offen);
    expect(idsListe).not.toContain(frei);
    expect(idsListe).not.toContain(fremd);
    expect(body.vorschlaege.every((v) => v.status === "offen")).toBe(true);
    const meiner = body.vorschlaege.find((v) => v.id === offen)!;
    expect(meiner.tags.map((t) => t.id)).toEqual([tagId]);
    expect(typeof meiner.vorgeschlagenVonName).toBe("string");
    // Nie die Abteilung und nie, wer entschieden hat
    expect(JSON.stringify(body)).not.toContain("abteilung");
    expect(JSON.stringify(body)).not.toContain("entschiedenVon");

    const freigegeben = (await (
      await aufruf(konten.admin, "GET", `${ADMIN}?status=freigegeben&limit=100`)
    ).json()) as { vorschlaege: { id: string }[] };
    expect(freigegeben.vorschlaege.map((v) => v.id)).toContain(frei);
    expect(freigegeben.vorschlaege.map((v) => v.id)).not.toContain(offen);
  });

  test("Seitenwechsel: neueste zuerst, nichts doppelt oder verloren", async () => {
    // Eigene Abteilung ist geteilt: nur die eigenen fünf zählen
    const eigene: string[] = [];
    for (let i = 0; i < 5; i++) eigene.push(await vorschlag(konten.slB.id!));
    const gesehen: string[] = [];
    let nach: string | null = null;
    for (let seite = 0; seite < 100; seite++) {
      const antwort = await aufruf(
        konten.admin,
        "GET",
        `${ADMIN}?limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      const body = (await antwort.json()) as {
        vorschlaege: { id: string }[];
        weitere: boolean;
        naechste: string | null;
      };
      expect(body.vorschlaege.length).toBeLessThanOrEqual(2);
      gesehen.push(...body.vorschlaege.map((v) => v.id));
      if (!body.weitere) {
        expect(body.naechste).toBeNull();
        break;
      }
      nach = body.naechste;
    }
    expect(new Set(gesehen).size).toBe(gesehen.length);
    expect(gesehen.filter((id) => eigene.includes(id))).toEqual(
      [...eigene].reverse(),
    );
  });

  test.each([
    ["Status unbekannt", "status=erledigt"],
    ["limit 0", "limit=0"],
    ["limit 101", "limit=101"],
    ["nach keine UUID", "nach=x"],
    ["Parameter unbekannt", "abteilung=1"],
  ])("400: %s", async (_name, abfrage) => {
    expect(
      (await aufruf(konten.admin, "GET", `${ADMIN}?${abfrage}`)).status,
    ).toBe(400);
  });
});

describe("GET /admin/termin-vorschlaege/{id}", () => {
  test("kategorien: Name des Tags, bei Zuordnung der Outlook-Name; ohne Doppelte", async () => {
    const zugeordnet = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Zugeordnet ${randomUUID().slice(0, 8)}`,
        kuerzel: "Z",
      })
      .returning({ id: schema.tag.id, name: schema.tag.name });
    const outlook = `Outlook ${randomUUID().slice(0, 8)}`;
    await db.insert(schema.kategorieZuordnung).values({
      abteilungId: welt.testabteilungId,
      kategorie: outlook,
      tagId: zugeordnet[0]!.id,
    });
    const id = await vorschlag(konten.slA.id!, "offen", {
      tagIds: [tagId, zugeordnet[0]!.id],
    });
    const antwort = await aufruf(konten.admin, "GET", `${ADMIN}/${id}`);
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as {
      kategorien: string[];
      titel: string;
      tags: { id: string }[];
    };
    expect(body.titel).toBe(TITEL);
    expect(body.tags.map((t) => t.id)).toEqual([tagId, zugeordnet[0]!.id]);
    expect(body.kategorien).toEqual([tagName, outlook]);
  });

  test("ein gelöschter Tag fällt weg, auch aus den Kategorien", async () => {
    const [weg] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "team",
        name: `Weg ${randomUUID().slice(0, 8)}`,
        kuerzel: "W",
      })
      .returning({ id: schema.tag.id });
    const id = await vorschlag(konten.slA.id!, "offen", {
      tagIds: [tagId, weg!.id],
    });
    await db.delete(schema.tag).where(eq(schema.tag.id, weg!.id));
    const body = (await (
      await aufruf(konten.admin, "GET", `${ADMIN}/${id}`)
    ).json()) as { kategorien: string[] };
    expect(body.kategorien).toEqual([tagName]);
  });

  test("Fremdabteilung 404, andere Rollen 403, unbekannt 404, keine UUID 400", async () => {
    const id = await vorschlag(konten.slA.id!);
    expect(
      (await aufruf(konten.demoAdmin, "GET", `${ADMIN}/${id}`)).status,
    ).toBe(404);
    // Auch die vorschlagende Person kommt nicht an die Verwaltung; ihre Sicht ist /termin-vorschlaege/{id}
    expect((await aufruf(konten.slA, "GET", `${ADMIN}/${id}`)).status).toBe(
      403,
    );
    expect((await aufruf(konten.slA, "GET", `${BASIS}/${id}`)).status).toBe(
      200,
    );
    expect(
      (await aufruf(konten.admin, "GET", `${ADMIN}/${randomUUID()}`)).status,
    ).toBe(404);
    expect((await aufruf(konten.admin, "GET", `${ADMIN}/x`)).status).toBe(400);
  });
});

describe("POST /admin/termin-vorschlaege/{id}/entscheid", () => {
  test("freigeben: 200, Zeile, Protokoll ohne Inhalt, Push nur an die vorschlagende Person ohne Titel", async () => {
    const sl = await legePersonaAn(welt, "slA");
    const tSl = await token(sl);
    // Andere Personen mit Token, auch die entscheidende Abteilungsleitung, bekommen nichts
    await token(konten.admin);
    await token(konten.slB);
    const id = await vorschlag(sl.id!);

    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/entscheid`,
      {
        entscheid: "freigeben",
      },
    );
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ id, status: "freigegeben" });

    expect(await zeile(id)).toMatchObject({
      status: "freigegeben",
      entschiedenVon: konten.admin.id,
      begruendung: null,
    });
    expect((await zeile(id)).entschiedenAm).toBeInstanceOf(Date);

    const spur = await protokoll(id, "termin_vorschlag_entschieden");
    expect(spur).toHaveLength(1);
    expect(spur[0]).toMatchObject({
      akteurId: konten.admin.id,
      abteilungId: welt.testabteilungId,
      zielTyp: "termin_vorschlag",
      details: { status: "freigegeben" },
    });
    expect(JSON.stringify(spur)).not.toContain(TITEL);

    expect(fcmAttrappe.nachrichten).toEqual([
      fcmNachricht(
        tSl,
        "Entscheid zu deinem Terminvorschlag",
        { typ: "termin_entscheid", id },
        "termine",
        "Dein Vorschlag ist freigegeben.",
      ),
    ]);
    expect(JSON.stringify(fcmAttrappe.nachrichten)).not.toContain(TITEL);
  });

  test("ablehnen: Begründung gespeichert, nie im Push, die vorschlagende Person sieht sie", async () => {
    const sl = await legePersonaAn(welt, "slA");
    const tSl = await token(sl);
    const id = await vorschlag(sl.id!);
    const begruendung = "Streng vertraulicher Grund 4711";
    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/entscheid`,
      {
        entscheid: "ablehnen",
        begruendung: `  ${begruendung}  `,
      },
    );
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ id, status: "abgelehnt" });
    expect(await zeile(id)).toMatchObject({ status: "abgelehnt", begruendung });

    const alles = JSON.stringify([
      fcmAttrappe.nachrichten,
      await protokoll(id, "termin_vorschlag_entschieden"),
    ]);
    expect(alles).not.toContain(begruendung);
    expect(alles).not.toContain(TITEL);
    expect(fcmAttrappe.nachrichten).toEqual([
      fcmNachricht(
        tSl,
        "Entscheid zu deinem Terminvorschlag",
        { typ: "termin_entscheid", id },
        "termine",
        "Dein Vorschlag ist abgelehnt.",
      ),
    ]);

    // Die App öffnet den Vorschlag über die eigene Route
    const detail = (await (
      await aufruf(sl, "GET", `${BASIS}/${id}`)
    ).json()) as {
      status: string;
      begruendung: string;
    };
    expect(detail).toMatchObject({ status: "abgelehnt", begruendung });
  });

  test.each([
    ["Ablehnen ohne Begründung", { entscheid: "ablehnen" }],
    [
      "Ablehnen mit leerer Begründung",
      { entscheid: "ablehnen", begruendung: "  " },
    ],
    [
      "Begründung 501 Zeichen",
      { entscheid: "ablehnen", begruendung: "x".repeat(501) },
    ],
    ["Begründung mit NUL", { entscheid: "ablehnen", begruendung: "a\u0000b" }],
    ["Freigeben mit Begründung", { entscheid: "freigeben", begruendung: "ok" }],
    ["Entscheid unbekannt", { entscheid: "vielleicht" }],
    ["ohne Entscheid", {}],
    ["Feld unbekannt", { entscheid: "freigeben", status: "abgelehnt" }],
  ])("400: %s, der Vorschlag bleibt offen", async (_name, body) => {
    const id = await vorschlag(konten.slA.id!);
    expect(
      (await aufruf(konten.admin, "POST", `${ADMIN}/${id}/entscheid`, body))
        .status,
    ).toBe(400);
    expect((await zeile(id)).status).toBe("offen");
  });

  test("Begründung mit genau 500 Zeichen und Zeilenumbruch geht", async () => {
    const id = await vorschlag(konten.slA.id!);
    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/entscheid`,
      {
        entscheid: "ablehnen",
        begruendung: `a\n${"x".repeat(498)}`,
      },
    );
    expect(antwort.status).toBe(200);
  });

  test("Rechte: alle anderen 403, Fremdabteilung 404, kein Push, nichts geändert", async () => {
    const id = await vorschlag(konten.slA.id!);
    await token(konten.slA);
    const body = { entscheid: "freigeben" };
    for (const p of [
      "adminOhneZweitenFaktor",
      "slA",
      "slB",
      "leitendeA",
      "elternA",
    ] as const) {
      expect(
        (await aufruf(konten[p], "POST", `${ADMIN}/${id}/entscheid`, body))
          .status,
        p,
      ).toBe(403);
    }
    for (const p of ["demoAdmin", "demoEltern"] as const) {
      expect(
        (await aufruf(konten[p], "POST", `${ADMIN}/${id}/entscheid`, body))
          .status,
        p,
      ).toBe(404);
    }
    expect(
      (
        await aufruf(
          konten.admin,
          "POST",
          `${ADMIN}/${randomUUID()}/entscheid`,
          body,
        )
      ).status,
    ).toBe(404);
    expect(
      (await aufruf(konten.admin, "POST", `${ADMIN}/x/entscheid`, body)).status,
    ).toBe(400);
    expect(await zeile(id)).toMatchObject({
      status: "offen",
      entschiedenVon: null,
      entschiedenAm: null,
    });
    expect(fcmAttrappe.nachrichten).toEqual([]);
  });

  test("die Abteilungsleitung entscheidet nicht über den eigenen Vorschlag", async () => {
    const id = await vorschlag(konten.admin.id!);
    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/entscheid`,
      {
        entscheid: "freigeben",
      },
    );
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { code: string }).code).toBe(
      "EIGENER_VORSCHLAG",
    );
    expect((await zeile(id)).status).toBe("offen");
  });

  test("zweiter Entscheid 409, auch in die andere Richtung; Protokoll und Push nur einmal", async () => {
    const sl = await legePersonaAn(welt, "slA");
    await token(sl);
    const id = await vorschlag(sl.id!);
    const entscheid = (body: unknown) =>
      aufruf(konten.admin, "POST", `${ADMIN}/${id}/entscheid`, body);
    expect((await entscheid({ entscheid: "freigeben" })).status).toBe(200);
    for (const body of [
      { entscheid: "freigeben" },
      { entscheid: "ablehnen", begruendung: "Doch nicht" },
    ]) {
      const antwort = await entscheid(body);
      expect(antwort.status).toBe(409);
      expect(((await antwort.json()) as { code: string }).code).toBe(
        "STATUS_UNGUELTIG",
      );
    }
    expect(await zeile(id)).toMatchObject({
      status: "freigegeben",
      begruendung: null,
    });
    expect(await protokoll(id, "termin_vorschlag_entschieden")).toHaveLength(1);
    expect(fcmAttrappe.nachrichten).toHaveLength(1);
  });

  test("gleichzeitige Entscheide: genau ein Sieger, ein Protokoll, ein Push", async () => {
    const sl = await legePersonaAn(welt, "slB");
    await token(sl);
    for (let runde = 0; runde < 5; runde++) {
      fcmAttrappe.zuruecksetzen();
      const id = await vorschlag(sl.id!);
      const antworten = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          aufruf(
            konten.admin,
            "POST",
            `${ADMIN}/${id}/entscheid`,
            i % 2 === 0
              ? { entscheid: "freigeben" }
              : { entscheid: "ablehnen", begruendung: `Grund ${i}` },
          ),
        ),
      );
      const stati = antworten.map((a) => a.status).sort();
      expect(stati).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
      const sieger = (await antworten
        .find((a) => a.status === 200)!
        .json()) as { status: string };
      const z = await zeile(id);
      expect(z.status).toBe(sieger.status);
      // Die Begründung gehört zum Sieger, nie zu einem Verlierer
      expect(z.begruendung === null).toBe(sieger.status === "freigegeben");
      expect(await protokoll(id, "termin_vorschlag_entschieden")).toHaveLength(
        1,
      );
      expect(fcmAttrappe.nachrichten).toHaveLength(1);
    }
  });

  test("Schalter pushTerminEntscheid aus (#847): kein Push, der Entscheid gilt", async () => {
    const sl = await legePersonaAn(welt, "slA");
    await token(sl);
    const id = await vorschlag(sl.id!);
    const aus = await aufruf(sl, "PATCH", "/api/v1/ich", {
      pushTerminEntscheid: false,
    });
    expect(aus.status).toBe(204);
    fcmAttrappe.zuruecksetzen();
    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/entscheid`,
      { entscheid: "freigeben" },
    );
    expect(antwort.status).toBe(200);
    expect((await zeile(id)).status).toBe("freigegeben");
    expect(fcmAttrappe.nachrichten).toEqual([]);
  });

  test("ohne Konto der vorschlagenden Person (gelöscht oder deaktiviert) kein Push, der Entscheid gilt", async () => {
    const alt = await legePersonaAn(welt, "slA");
    await token(alt);
    const weg = await vorschlag(null);
    const aus = await vorschlag(alt.id!);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, alt.id!));
    for (const id of [weg, aus]) {
      const antwort = await aufruf(
        konten.admin,
        "POST",
        `${ADMIN}/${id}/entscheid`,
        {
          entscheid: "freigeben",
        },
      );
      expect(antwort.status).toBe(200);
      expect((await zeile(id)).status).toBe("freigegeben");
    }
    expect(fcmAttrappe.nachrichten).toEqual([]);
    // Die Verwaltung sieht den Vorschlag ohne Namen
    const detail = (await (
      await aufruf(konten.admin, "GET", `${ADMIN}/${weg}`)
    ).json()) as { vorgeschlagenVonName: string | null };
    expect(detail.vorgeschlagenVonName).toBeNull();
  });

  test("ein Ausfall von FCM ändert den Entscheid nicht", async () => {
    const sl = await legePersonaAn(welt, "slA");
    await token(sl);
    const id = await vorschlag(sl.id!);
    fcmAttrappe.ausfall = true;
    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/entscheid`,
      {
        entscheid: "freigeben",
      },
    );
    expect(antwort.status).toBe(200);
    expect((await zeile(id)).status).toBe("freigegeben");
  });

  test("ein zurückgezogener (gelöschter) Vorschlag ist 404", async () => {
    const sl = await legePersonaAn(welt, "slA");
    const id = await vorschlag(sl.id!);
    expect((await aufruf(sl, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(
      (
        await aufruf(konten.admin, "POST", `${ADMIN}/${id}/entscheid`, {
          entscheid: "freigeben",
        })
      ).status,
    ).toBe(404);
  });
});

describe("POST /admin/termin-vorschlaege/{id}/eingetragen", () => {
  test("freigegeben wird in_outlook_eingetragen; Protokoll ohne Inhalt, kein Push", async () => {
    const sl = await legePersonaAn(welt, "slA");
    await token(sl);
    const id = await vorschlag(sl.id!, "freigegeben");
    const antwort = await aufruf(
      konten.admin,
      "POST",
      `${ADMIN}/${id}/eingetragen`,
    );
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({
      id,
      status: "in_outlook_eingetragen",
    });
    expect((await zeile(id)).status).toBe("in_outlook_eingetragen");
    const spur = await protokoll(id, "termin_vorschlag_eingetragen");
    expect(spur).toHaveLength(1);
    expect(JSON.stringify(spur)).not.toContain(TITEL);
    expect(fcmAttrappe.nachrichten).toEqual([]);
    // Der Vorschlag lässt sich nicht mehr zurückziehen
    expect((await aufruf(sl, "DELETE", `${BASIS}/${id}`)).status).toBe(409);
  });

  test("alle anderen Übergänge sind 409", async () => {
    for (const stand of [
      "offen",
      "abgelehnt",
      "in_outlook_eingetragen",
    ] as const) {
      const id = await vorschlag(konten.slA.id!, stand);
      const antwort = await aufruf(
        konten.admin,
        "POST",
        `${ADMIN}/${id}/eingetragen`,
      );
      expect(antwort.status, stand).toBe(409);
      expect(((await antwort.json()) as { code: string }).code).toBe(
        "STATUS_UNGUELTIG",
      );
      expect((await zeile(id)).status).toBe(stand);
      expect(await protokoll(id, "termin_vorschlag_eingetragen")).toHaveLength(
        0,
      );
    }
  });

  test("gleichzeitig gemeldet: genau ein Sieger", async () => {
    const id = await vorschlag(konten.slA.id!, "freigegeben");
    const antworten = await Promise.all(
      Array.from({ length: 6 }, () =>
        aufruf(konten.admin, "POST", `${ADMIN}/${id}/eingetragen`),
      ),
    );
    expect(antworten.map((a) => a.status).sort()).toEqual([
      200, 409, 409, 409, 409, 409,
    ]);
    expect(await protokoll(id, "termin_vorschlag_eingetragen")).toHaveLength(1);
  });

  test("Rechte: alle anderen 403, Fremdabteilung 404", async () => {
    const id = await vorschlag(konten.slA.id!, "freigegeben");
    expect(
      (await aufruf(konten.slA, "POST", `${ADMIN}/${id}/eingetragen`)).status,
    ).toBe(403);
    expect(
      (await aufruf(konten.demoAdmin, "POST", `${ADMIN}/${id}/eingetragen`))
        .status,
    ).toBe(404);
    expect((await zeile(id)).status).toBe("freigegeben");
  });
});

test("die Abteilungsleitung ohne zweiten Faktor kommt an keine Route (403)", async () => {
  const id = await vorschlag(konten.slA.id!);
  for (const [methode, pfad, body] of [
    ["GET", ADMIN, undefined],
    ["GET", `${ADMIN}/${id}`, undefined],
    ["POST", `${ADMIN}/${id}/entscheid`, { entscheid: "freigeben" }],
    ["POST", `${ADMIN}/${id}/eingetragen`, undefined],
  ] as const) {
    expect(
      (await aufruf(konten.adminOhneZweitenFaktor, methode, pfad, body)).status,
      `${methode} ${pfad}`,
    ).toBe(403);
  }
  expect((await zeile(id)).status).toBe("offen");
});
