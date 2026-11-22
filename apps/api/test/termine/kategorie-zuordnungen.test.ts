import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ordneTagsZu } from "../../src/kalender/tags-zuordnen.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { legeProgrammAn } from "../hilfen/programme.js";
import { KONTO_FUER } from "./matrix.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  auth,
  seiten: ladeSeiten(),
  db,
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
const BASIS = "/api/v1/admin/kategorie-zuordnungen";

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
});

const admin = () => konten[KONTO_FUER.abteilungsleitung].headers;
const senden = (
  methode: string,
  pfad: string,
  body?: unknown,
  headers = admin(),
) =>
  app.request(pfad, {
    method: methode,
    headers: body
      ? { ...headers, "content-type": "application/json" }
      : headers,
    body: body ? JSON.stringify(body) : undefined,
  });

const neuerTag = async (abteilungId = welt.testabteilungId, name?: string) =>
  (
    await db
      .insert(schema.tag)
      .values({
        abteilungId,
        typ: "stufe",
        name: name ?? `Tag ${randomUUID().slice(0, 8)}`,
        kuerzel: "T",
      })
      .returning({ id: schema.tag.id })
  )[0]!.id;
const zeilen = (kategorie: string) =>
  db
    .select()
    .from(schema.kategorieZuordnung)
    .where(
      and(
        eq(schema.kategorieZuordnung.abteilungId, welt.testabteilungId),
        eq(schema.kategorieZuordnung.kategorie, kategorie),
      ),
    );
const audit = (aktion: string, zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.aktion, aktion),
        eq(schema.auditLog.zielId, zielId),
      ),
    );

describe("PUT", () => {
  test("legt an (201), ersetzt dieselbe Kategorie ohne Gross-/Kleinschreibung (200) und schreibt nur die Tag-ID ins Protokoll", async () => {
    const a = await neuerTag();
    const b = await neuerTag();
    const name = `Hockey ${randomUUID().slice(0, 8)}`;
    const erste = await senden("PUT", BASIS, {
      kategorie: `  ${name}  `,
      tagId: a,
    });
    expect(erste.status).toBe(201);
    const { id } = (await erste.json()) as { id: string };
    expect(await zeilen(name)).toMatchObject([{ id, tagId: a }]);

    const zweite = await senden("PUT", BASIS, {
      kategorie: name.toUpperCase(),
      tagId: b,
    });
    expect(zweite.status).toBe(200);
    expect(((await zweite.json()) as { id: string }).id).toBe(id);
    expect(await zeilen(name)).toEqual([]);
    expect(await zeilen(name.toUpperCase())).toMatchObject([{ id, tagId: b }]);

    const protokoll = await audit("kategorie_zugeordnet", id);
    expect(protokoll).toHaveLength(2);
    expect(JSON.stringify(protokoll.map((p) => p.details))).not.toContain(name);
    expect(protokoll[0]!.details).toEqual({ tagId: a });
  });

  test("ein Tag einer anderen Abteilung ist 400 TAG_UNBEKANNT und schreibt nichts", async () => {
    const fremd = await neuerTag(welt.demoAbteilungId);
    const name = `Fremd ${randomUUID()}`;
    const antwort = await senden("PUT", BASIS, {
      kategorie: name,
      tagId: fremd,
    });
    expect(antwort.status).toBe(400);
    expect(((await antwort.json()) as { code: string }).code).toBe(
      "TAG_UNBEKANNT",
    );
    expect(await zeilen(name)).toEqual([]);
  });

  test.each([
    ["leer", ""],
    ["nur Leerzeichen", "   "],
    ["zu lang", "x".repeat(101)],
    ["Zeilenumbruch", "a\nb"],
    ["Steuerzeichen", "a\u0007b"],
  ])("Kategorie %s ist 400", async (_n, kategorie) => {
    const antwort = await senden("PUT", BASIS, {
      kategorie,
      tagId: await neuerTag(),
    });
    expect(antwort.status).toBe(400);
  });

  test("fremde Felder und eine ungültige Tag-ID sind 400", async () => {
    expect(
      (await senden("PUT", BASIS, { kategorie: "x", tagId: "nein" })).status,
    ).toBe(400);
    expect(
      (
        await senden("PUT", BASIS, {
          kategorie: "x",
          tagId: await neuerTag(),
          extra: 1,
        })
      ).status,
    ).toBe(400);
  });

  test("Stufenleitung und Leitung dürfen nicht (403), nichts wird geschrieben", async () => {
    const name = `Verboten ${randomUUID()}`;
    for (const p of ["stufenleitungA", "leitungA", "elternA"] as const) {
      const antwort = await senden(
        "PUT",
        BASIS,
        { kategorie: name, tagId: await neuerTag() },
        konten[KONTO_FUER[p]].headers,
      );
      expect(antwort.status).toBe(403);
    }
    expect(await zeilen(name)).toEqual([]);
  });
});

describe("GET", () => {
  test("liefert die Zuordnungen der eigenen Abteilung mit Name und Typ des Tags, nie die einer fremden", async () => {
    const tagId = await neuerTag(
      welt.testabteilungId,
      `Liste ${randomUUID().slice(0, 8)}`,
    );
    const name = `Liste ${randomUUID()}`;
    await senden("PUT", BASIS, { kategorie: name, tagId });
    const fremdTag = await neuerTag(welt.demoAbteilungId);
    const fremdName = `Demo ${randomUUID()}`;
    await db.insert(schema.kategorieZuordnung).values({
      abteilungId: welt.demoAbteilungId,
      kategorie: fremdName,
      tagId: fremdTag,
    });
    const antwort = await senden("GET", BASIS);
    expect(antwort.status).toBe(200);
    const { zuordnungen } = (await antwort.json()) as {
      zuordnungen: { kategorie: string; tagId: string; tagTyp: string }[];
    };
    expect(zuordnungen.find((z) => z.kategorie === name)).toMatchObject({
      tagId,
      tagTyp: "stufe",
    });
    expect(zuordnungen.some((z) => z.kategorie === fremdName)).toBe(false);
  });
});

describe("DELETE", () => {
  test("entfernt (204) und protokolliert die Tag-ID; ein zweiter Aufruf ist 404", async () => {
    const tagId = await neuerTag();
    const name = `Weg ${randomUUID()}`;
    const { id } = (await (
      await senden("PUT", BASIS, { kategorie: name, tagId })
    ).json()) as { id: string };
    expect((await senden("DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(await zeilen(name)).toEqual([]);
    expect((await audit("kategorie_entfernt", id))[0]!.details).toEqual({
      tagId,
    });
    expect((await senden("DELETE", `${BASIS}/${id}`)).status).toBe(404);
  });

  test("eine Zuordnung der anderen Abteilung ist 404 (auch für deren Abteilungsleitung nicht sichtbar für Fremde) und bleibt bestehen", async () => {
    const [z] = await db
      .insert(schema.kategorieZuordnung)
      .values({
        abteilungId: welt.testabteilungId,
        kategorie: `Bleibt ${randomUUID()}`,
        tagId: await neuerTag(),
      })
      .returning({ id: schema.kategorieZuordnung.id });
    const fremd = konten[KONTO_FUER.fremdeAbteilungsleitung].headers;
    expect(
      (await senden("DELETE", `${BASIS}/${z!.id}`, undefined, fremd)).status,
    ).toBe(404);
    // Ohne Recht in der eigenen Abteilung: erst Objekt (gefunden), dann 403
    const el = konten[KONTO_FUER.leitungA].headers;
    expect(
      (await senden("DELETE", `${BASIS}/${z!.id}`, undefined, el)).status,
    ).toBe(403);
    expect(
      await db
        .select()
        .from(schema.kategorieZuordnung)
        .where(eq(schema.kategorieZuordnung.id, z!.id)),
    ).toHaveLength(1);
  });

  test("keine UUID im Pfad ist 400", async () => {
    expect((await senden("DELETE", `${BASIS}/abc`)).status).toBe(400);
  });
});

describe("Wirkung auf programm_tag", () => {
  test("der nächste Abgleichsschritt setzt den Tag nach der Zuordnung und lässt ihn nach dem Entfernen stehen (Übergangsregel #449)", async () => {
    const kategorie = `Eishockey ${randomUUID().slice(0, 8)}`;
    const tagId = await neuerTag();
    const p = await legeProgrammAn(db, { abteilungId: welt.testabteilungId });
    const lauf = () =>
      db.transaction((tx) =>
        ordneTagsZu(tx, welt.testabteilungId, [
          { id: p.id, kategorien: [kategorie] },
        ]),
      );
    const tagsDes = async () =>
      (
        await db
          .select({ tagId: schema.programmTag.tagId })
          .from(schema.programmTag)
          .where(eq(schema.programmTag.programmId, p.id))
      ).map((z) => z.tagId);

    await lauf();
    expect(await tagsDes()).toEqual([]);

    const { id } = (await (
      await senden("PUT", BASIS, { kategorie: kategorie.toLowerCase(), tagId })
    ).json()) as { id: string };
    await lauf();
    expect(await tagsDes()).toEqual([tagId]);

    // Ohne zuordenbare Kategorie bleiben die Tags stehen (Übergangsregel #449)
    await senden("DELETE", `${BASIS}/${id}`);
    await lauf();
    expect(await tagsDes()).toEqual([tagId]);
  });
});
