import { eq, sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import {
  ladeTagIds,
  sichtbarFuer,
  sichtbarkeitAusSpalten,
  sichtbarkeitFilter,
  sichtbarkeitSchema,
  sichtbarkeitSpalten,
  tagsGehoerenZurAbteilung,
  type Sichtbarkeit,
} from "../src/sichtbarkeit.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sqlClient = postgres(API_URL);
const db = erstelleDb(sqlClient);
const auth = erstelleTestAuth(db);
afterAll(() => sqlClient.end());

// Stand-in für ein Objekt eines Folge-Issues: dieselben zwei Spalten, wie sie das Modul beschreibt
const objekt = pgTable("sicht_objekt", {
  id: text("id").primaryKey(),
  abteilungId: uuid("abteilung_id").notNull(),
  sichtbarkeit: text("sichtbarkeit", {
    enum: ["oeffentlich", "angemeldet", "tags"],
  }).notNull(),
  sichtbarkeitTags: uuid("sichtbarkeit_tags")
    .array()
    .notNull()
    .default(sql`'{}'`),
});

let welt: Welt;
let personen: Record<
  Persona,
  { id: string; abteilungId: string; admin: boolean; tagIds: string[] } | null
>;
let tags: { t1: string; t2: string; t3: string; demo: string };
let objekte: {
  id: string;
  abteilungId: string;
  sichtbarkeit: Sichtbarkeit;
}[];
// Persona -> Ids, die der SQL-Filter liefert (eine Transaktion: die Temp-Tabelle verschwindet mit ihr)
let ausSql: Record<Persona, string[]>;

const OBJEKT_IDS = [
  "oeffentlich",
  "angemeldet",
  "nur-t1",
  "t1-und-t2",
  "t3",
  "leer",
  "fremder-tag",
  "demo-oeffentlich",
  "demo-angemeldet",
  "demo-tag",
] as const;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const neuerTag = async (abteilungId: string, name: string) =>
    (
      await db
        .insert(schema.tag)
        .values({ abteilungId, typ: "team", name, kuerzel: name })
        .returning({ id: schema.tag.id })
    )[0].id;
  tags = {
    t1: await neuerTag(welt.testabteilungId, "T1"),
    t2: await neuerTag(welt.testabteilungId, "T2"),
    t3: await neuerTag(welt.testabteilungId, "T3"),
    demo: await neuerTag(welt.demoAbteilungId, "Demo-Tag"),
  };
  const konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  );
  // Zuordnung: slA trägt T1 und T2 (beide passen auf «t1-und-t2»), elternA nur T1, leitendeB T3, demoEltern den Demo-Tag
  const zuordnung: Partial<Record<Persona, string[]>> = {
    slA: [tags.t1, tags.t2],
    elternA: [tags.t1],
    leitendeB: [tags.t3],
    demoEltern: [tags.demo],
  };
  for (const [persona, tagIds] of Object.entries(zuordnung)) {
    for (const tagId of tagIds) {
      await db
        .insert(schema.personTag)
        .values({ userId: konten[persona].id, tagId });
    }
  }
  personen = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => {
        const konto = konten[p];
        if (!konto.id) return [p, null];
        const [u] = await db
          .select({ id: schema.abteilungsleitungPerson.userId })
          .from(schema.abteilungsleitungPerson)
          .where(eq(schema.abteilungsleitungPerson.userId, konto.id));
        const person = {
          id: konto.id,
          abteilungId: konto.abteilungId,
          admin: u !== undefined,
        };
        return [p, { ...person, tagIds: await ladeTagIds(db, person) }];
      }),
    ),
  );

  const t = welt.testabteilungId;
  const d = welt.demoAbteilungId;
  const wert = (id: (typeof OBJEKT_IDS)[number]): Sichtbarkeit => {
    switch (id) {
      case "oeffentlich":
      case "demo-oeffentlich":
        return { art: "oeffentlich" };
      case "angemeldet":
      case "demo-angemeldet":
        return { art: "angemeldet" };
      case "nur-t1":
        return { art: "tags", tagIds: [tags.t1] };
      case "t1-und-t2":
        return { art: "tags", tagIds: [tags.t1, tags.t2] };
      case "t3":
        return { art: "tags", tagIds: [tags.t3] };
      case "leer":
        return { art: "tags", tagIds: [] };
      // Tag einer anderen Abteilung an einem Objekt dieser Abteilung: darf nie passen
      case "fremder-tag":
        return { art: "tags", tagIds: [tags.demo] };
      case "demo-tag":
        return { art: "tags", tagIds: [tags.demo] };
    }
  };
  objekte = OBJEKT_IDS.map((id) => ({
    id,
    abteilungId: id.startsWith("demo-") ? d : t,
    sichtbarkeit: wert(id),
  }));

  ausSql = await db.transaction(async (tx) => {
    await tx.execute(
      sql`create temp table sicht_objekt (id text primary key, abteilung_id uuid not null, sichtbarkeit text not null, sichtbarkeit_tags uuid[] not null default '{}') on commit drop`,
    );
    await tx.insert(objekt).values(
      objekte.map((o) => ({
        id: o.id,
        abteilungId: o.abteilungId,
        ...sichtbarkeitSpalten(o.sichtbarkeit),
      })),
    );
    const ergebnis: Record<string, string[]> = {};
    for (const p of PERSONAS) {
      const zeilen = await tx
        .select({ id: objekt.id })
        .from(objekt)
        .where(sichtbarkeitFilter(personen[p], objekt))
        .orderBy(objekt.id);
      ergebnis[p] = zeilen.map((z) => z.id);
    }
    return ergebnis as Record<Persona, string[]>;
  });
});

const ids = (...liste: (typeof OBJEKT_IDS)[number][]) => [...liste].sort();

describe("Eigenschaft: SQL-Filter und Einzelprüfung liefern dasselbe", () => {
  test.each(PERSONAS)("%s", (persona) => {
    const erwartet = objekte
      .filter((o) => sichtbarFuer(personen[persona], o))
      .map((o) => o.id)
      .sort();
    expect(ausSql[persona]).toEqual(erwartet);
  });
});

describe("Sichtbarkeit je Persona", () => {
  const ADMIN = ids(
    "oeffentlich",
    "angemeldet",
    "nur-t1",
    "t1-und-t2",
    "t3",
    "leer",
    "fremder-tag",
  );
  const OHNE_TAG = ids("oeffentlich", "angemeldet");
  const ERWARTET: Record<Persona, string[]> = {
    // Abteilungsleitung: alles der eigenen Abteilung, auch die leere Menge
    admin: ADMIN,
    adminOhneZweitenFaktor: ADMIN,
    // Zwei passende Tags auf «t1-und-t2»: trotzdem eine Zeile
    slA: ids("oeffentlich", "angemeldet", "nur-t1", "t1-und-t2"),
    elternA: ids("oeffentlich", "angemeldet", "nur-t1", "t1-und-t2"),
    leitendeB: ids("oeffentlich", "angemeldet", "t3"),
    // Kein passender Tag: nur öffentlich und angemeldet
    slB: OHNE_TAG,
    leitendeA: OHNE_TAG,
    leitendeAElternB: OHNE_TAG,
    elternB: OHNE_TAG,
    mussPasswortAendern: OHNE_TAG,
    deaktiviert: OHNE_TAG,
    // Fremdabteilung: nur die eigenen Objekte, nie die der Testabteilung
    demoAdmin: ids("demo-oeffentlich", "demo-angemeldet", "demo-tag"),
    demoEltern: ids("demo-oeffentlich", "demo-angemeldet", "demo-tag"),
    // Ohne Sitzung: nur öffentlich (die Abteilung setzt der Aufrufer)
    ohneLogin: ids("oeffentlich", "demo-oeffentlich"),
  };
  test.each(PERSONAS)("%s", (persona) => {
    expect(ausSql[persona]).toEqual(ERWARTET[persona]);
  });

  test("leere Menge: nur Abteilungsleitung der Abteilung", () => {
    const leer = objekte.find((o) => o.id === "leer")!;
    const sieht = PERSONAS.filter((p) => sichtbarFuer(personen[p], leer));
    expect(sieht.sort()).toEqual(["admin", "adminOhneZweitenFaktor"]);
  });

  test("Fremdabteilung sieht nichts aus der Testabteilung, auch nichts Öffentliches", () => {
    for (const p of ["demoAdmin", "demoEltern"] as const) {
      const fremd = ausSql[p].filter((id) => !id.startsWith("demo-"));
      expect(fremd).toEqual([]);
    }
  });

  test("ein Tag aus einer anderen Abteilung passt nie, auch nicht für dessen Träger", () => {
    const o = objekte.find((x) => x.id === "fremder-tag")!;
    expect(sichtbarFuer(personen.demoEltern, o)).toBe(false);
    expect(ausSql.demoEltern).not.toContain("fremder-tag");
  });
});

describe("Hilfen", () => {
  test("ladeTagIds: nur Tags der eigenen Abteilung", async () => {
    // Die Stufe ist seit 0035 ein Tag: Wer in Stufe A leitet, trägt ihn
    expect([...personen.slA!.tagIds].sort()).toEqual(
      [tags.t1, tags.t2, welt.stufeAId].sort(),
    );
    expect(personen.demoEltern!.tagIds).toEqual([tags.demo]);
    expect(personen.elternB!.tagIds).toEqual([]);
  });

  test("tagsGehoerenZurAbteilung", async () => {
    const t = welt.testabteilungId;
    expect(await tagsGehoerenZurAbteilung(db, t, [])).toBe(true);
    expect(await tagsGehoerenZurAbteilung(db, t, [tags.t1, tags.t2])).toBe(
      true,
    );
    expect(await tagsGehoerenZurAbteilung(db, t, [tags.t1, tags.demo])).toBe(
      false,
    );
    expect(
      await tagsGehoerenZurAbteilung(db, t, [
        tags.t1,
        "00000000-0000-4000-8000-000000000000",
      ]),
    ).toBe(false);
  });

  test("Schema und Spalten: Rundlauf, strenge Form", () => {
    for (const wert of [
      { art: "oeffentlich" },
      { art: "angemeldet" },
      { art: "tags", tagIds: [tags.t1, tags.t2] },
      { art: "tags", tagIds: [] },
    ] satisfies Sichtbarkeit[]) {
      const geparst = sichtbarkeitSchema.parse(wert);
      expect(sichtbarkeitAusSpalten(sichtbarkeitSpalten(geparst))).toEqual(
        wert,
      );
    }
    expect(sichtbarkeitSpalten({ art: "angemeldet" })).toEqual({
      sichtbarkeit: "angemeldet",
      sichtbarkeitTags: [],
    });
    for (const falsch of [
      { art: "geheim" },
      { art: "oeffentlich", tagIds: [] },
      { art: "tags" },
      { art: "tags", tagIds: ["kein-uuid"] },
      { art: "tags", tagIds: [tags.t1, tags.t1] },
    ]) {
      expect(sichtbarkeitSchema.safeParse(falsch).success).toBe(false);
    }
  });
});
