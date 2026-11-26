import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { gleicheAb, gleicheAlleAb } from "../../src/cevi-db/abgleich.js";
import type { CeviDbDienst } from "../../src/cevi-db/dienst.js";
import type { CeviPerson } from "../../src/cevi-db/felder.js";
import { ordneZu, type Anfrage } from "../../src/cevi-db/zuordnung.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import type { Geschlecht } from "../../src/geschlecht.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import { erstelleWelt, type Welt } from "../hilfen/personas.js";

// Täglicher Abgleich mit der Cevi-Datenbank (#857): Nummer merken, Regel «Vorname plus Nachname» nur bei Eindeutigkeit auf beiden Seiten, nie ein Kind, danach das Geschlecht. Erfundene Personen, Namen und Nummern
bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
let welt: Welt;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
});
afterAll(() => sql.end());

// Jeder Test eigene Namen: Die Dateien teilen sich die Datenbank
const zufall = () =>
  randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 6) || "x";
const cevi = (
  vorname: string,
  nachname: string,
  geschlecht: Geschlecht | null,
  email: string | null = null,
): CeviPerson => ({
  id: randomUUID(),
  vorname,
  nachname,
  email,
  geburtsdatum: null,
  telefon: null,
  strasse: null,
  plz: null,
  ort: null,
  geschlecht,
});
const dienst = (personen: CeviPerson[]): CeviDbDienst => ({
  personen: async () => ({ ok: true, personen }),
  pruefe: async () => ({ ok: true, gruppe: null }),
});

async function neueAbteilung() {
  const [a] = await db
    .insert(schema.abteilung)
    .values({ name: `Abgleich ${randomUUID()}` })
    .returning({ id: schema.abteilung.id });
  return a.id;
}
async function konto(
  abteilungId: string,
  name: string,
  felder: Partial<typeof schema.user.$inferInsert> = {},
) {
  const [u] = await db
    .insert(schema.user)
    .values({
      name,
      email: `${randomUUID()}@benutzer.invalid`,
      abteilungId,
      ...felder,
    })
    .returning({ id: schema.user.id });
  return u.id;
}
const zeile = async (id: string) =>
  (
    await db
      .select({
        ceviDbId: schema.user.ceviDbId,
        geschlecht: schema.user.geschlecht,
      })
      .from(schema.user)
      .where(eq(schema.user.id, id))
  )[0]!;

describe("ordneZu: Vorname plus Nachname (#857)", () => {
  const anfrage = (vorname: string, nachname: string): Anfrage => ({
    ceviDbId: null,
    emails: [],
    vorname,
    nachname,
    geburtsdatum: null,
  });
  const lea = cevi("Léa", "Muster", "w");

  test("bei der Anmeldung nie ein Treffer, im Abgleich nur bei genau einem Konto", () => {
    expect(ordneZu([lea], anfrage("lea", "MUSTER")).art).toBe("keiner");
    expect(ordneZu([lea], anfrage("lea", "MUSTER"), 1)).toEqual({
      art: "treffer",
      person: lea,
    });
    expect(ordneZu([lea], anfrage("lea", "Muster"), 2).art).toBe("keiner");
  });

  test("zwei Personen der Cevi-Datenbank mit diesem Namen: mehrdeutig", () => {
    expect(
      ordneZu([lea, cevi("Lea", "Muster", "w")], anfrage("Lea", "Muster"), 1)
        .art,
    ).toBe("mehrdeutig");
  });

  test("ohne Nachnamen kein Vergleich über den Namen", () => {
    expect(
      ordneZu([lea], { ...anfrage("Lea", ""), nachname: null }, 1).art,
    ).toBe("keiner");
  });
});

describe("gleicheAb (#857)", () => {
  test("ordnet eindeutig zu, übernimmt das Geschlecht und zählt nur", async () => {
    const abteilungId = await neueAbteilung();
    const n = zufall();
    const perEmail = cevi(
      `Anna${n}`,
      "Beispiel",
      "w",
      `anna.${n}@cevi.invalid`,
    );
    const perName = cevi(`Ben${n}`, `Muster${n}`, "m");
    const doppelt = cevi(`Max${n}`, `Doppel${n}`, "m");
    const zwilling1 = cevi(`Eva${n}`, `Zwilling${n}`, "w");
    const zwilling2 = cevi(`Eva${n}`, `Zwilling${n}`, "w");
    const kindPerson = cevi(`Kim${n}`, `Kind${n}`, "w");
    const bekannt = cevi(`Ola${n}`, `Bekannt${n}`, "m");
    const vonHand = cevi(`Ida${n}`, `Hand${n}`, "m");

    const a = await konto(abteilungId, `Anna${n} Anders`, {
      email: `anna.${n}@cevi.invalid`,
    });
    const b = await konto(abteilungId, `ben${n} MUSTER${n}`);
    const c1 = await konto(abteilungId, `Max${n} Doppel${n}`);
    const c2 = await konto(abteilungId, `Max${n} Doppel${n}`);
    const e = await konto(abteilungId, `Eva${n} Zwilling${n}`);
    const k = await konto(abteilungId, `Kim${n} Kind${n}`);
    const o = await konto(abteilungId, `Ola${n} Bekannt${n}`, {
      ceviDbId: bekannt.id,
    });
    const h = await konto(abteilungId, `Ida${n} Hand${n}`, {
      geschlecht: "w",
      geschlechtVonHand: true,
    });
    const [kindZeile] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Kim",
        nachname: "Kind",
        stufeId: welt.stufeAId,
        userId: k,
      })
      .returning({ id: schema.kind.id });

    const personen = [
      perEmail,
      perName,
      doppelt,
      zwilling1,
      zwilling2,
      kindPerson,
      bekannt,
      vonHand,
    ];
    try {
      expect(await gleicheAb(db, dienst(personen), abteilungId)).toEqual({
        zugeordnet: 1,
        perName: 2,
        geaendert: 3,
        mehrdeutig: 1,
        keinTreffer: 2,
      });
      // Zweiter Lauf: nichts mehr zu tun; Regel 4 prüft jeden Tag neu
      expect(await gleicheAb(db, dienst(personen), abteilungId)).toEqual({
        zugeordnet: 0,
        perName: 2,
        geaendert: 0,
        mehrdeutig: 1,
        keinTreffer: 2,
      });
    } finally {
      await db.delete(schema.kind).where(eq(schema.kind.id, kindZeile.id));
    }
    expect(await zeile(a)).toEqual({ ceviDbId: perEmail.id, geschlecht: "w" });
    // Nur über den Namen: das Geschlecht, aber keine Nummer, damit die Anmeldung nichts dieser Person vorfüllt
    expect(await zeile(b)).toEqual({ ceviDbId: null, geschlecht: "m" });
    // Zwei Konten heissen gleich: keines bekommt die Nummer
    expect(await zeile(c1)).toEqual({ ceviDbId: null, geschlecht: null });
    expect(await zeile(c2)).toEqual({ ceviDbId: null, geschlecht: null });
    // Zwei Personen heissen gleich: mehrdeutig
    expect(await zeile(e)).toEqual({ ceviDbId: null, geschlecht: null });
    // Nie das Konto eines Kindes
    expect(await zeile(k)).toEqual({ ceviDbId: null, geschlecht: null });
    // Gemerkte Nummer bleibt, das Geschlecht folgt
    expect(await zeile(o)).toEqual({ ceviDbId: bekannt.id, geschlecht: "m" });
    // Von Hand bleibt (nur über den Namen getroffen, also ohne Nummer)
    expect(await zeile(h)).toEqual({ ceviDbId: null, geschlecht: "w" });
  });

  test("eine Person der Cevi-Datenbank gehört zu höchstens einem Konto", async () => {
    const abteilungId = await neueAbteilung();
    const n = zufall();
    const p = cevi(`Udo${n}`, `Einmal${n}`, "m", `udo.${n}@cevi.invalid`);
    // Schon vergeben an ein anderes Konto: die E-Mail trifft, zählt aber als mehrdeutig
    await konto(abteilungId, `Ueli${n} Anders${n}`, { ceviDbId: p.id });
    const zweites = await konto(abteilungId, `Udo${n} Zweit`, {
      email: `udo.${n}@cevi.invalid`,
    });
    expect(await gleicheAb(db, dienst([p]), abteilungId)).toMatchObject({
      zugeordnet: 0,
      mehrdeutig: 1,
    });
    expect((await zeile(zweites)).ceviDbId).toBeNull();
  });

  test("ohne Verbindung: nichts geändert, kein Ergebnis", async () => {
    const abteilungId = await neueAbteilung();
    const ausfall: CeviDbDienst = {
      personen: async () => ({ ok: false, art: "nicht_erreichbar" }),
      pruefe: async () => ({ ok: false, art: "nicht_erreichbar" }),
    };
    expect(await gleicheAb(db, ausfall, abteilungId)).toBeNull();
  });
});

test("gleicheAlleAb: nur Abteilungen mit eingetragener Gruppe", async () => {
  const [mit, ohne] = [await neueAbteilung(), await neueAbteilung()];
  await db.insert(schema.ceviDbEinstellung).values([
    { abteilungId: mit, gruppeId: "123" },
    { abteilungId: ohne, gruppeId: null },
  ]);
  const n = zufall();
  const p = cevi(`Rea${n}`, `Gruppe${n}`, "w");
  const inMit = await konto(mit, `Rea${n} Gruppe${n}`);
  const inOhne = await konto(ohne, `Rea${n} Gruppe${n}`);
  await gleicheAlleAb(db, dienst([p]));
  expect(await zeile(inMit)).toEqual({ ceviDbId: null, geschlecht: "w" });
  expect(await zeile(inOhne)).toEqual({ ceviDbId: null, geschlecht: null });
});
