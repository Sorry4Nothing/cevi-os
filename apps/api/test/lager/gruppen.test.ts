import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

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
let konten: Record<LagerPersona, PersonaKonto>;

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Gruppenlager",
      von: status === "aktiv" ? "2027-07-10" : "2020-01-01",
      bis: status === "aktiv" ? "2027-07-24" : "2020-01-10",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

async function mitgliederEintragen(id: string) {
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: konten[persona].id!,
      rolle,
    });
  }
}

// Jeder Test arbeitet in einem frischen Lager, damit Zähler, Listen und das Rate-Limit nicht von anderen Tests abhängen
async function frischesLager() {
  const id = await legeLager(welt.testabteilungId);
  await mitgliederEintragen(id);
  return id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
});

// Die Bodys prüfen die Tests Feld für Feld; ein Typ je Route brächte hier nichts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const L = (id: string) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
const UNBEKANNT = "00000000-0000-4000-8000-000000000000";

async function kinder(
  lagerId: string,
  liste: [string, string | null][],
  ceviName: string | null = null,
) {
  const zeilen = await db
    .insert(schema.teilnehmer)
    .values(
      liste.map(([nachname, stufe]) => ({
        lagerId,
        vorname: "Kind",
        nachname,
        stufe,
        ceviName,
        lagerSeq: 0,
      })),
    )
    .returning({ id: schema.teilnehmer.id });
  return zeilen.map((z) => z.id);
}
const gruppeAnlegen = async (lagerId: string, name: string) => {
  const a = await anfrage(leiter(), "POST", `${L(lagerId)}/gruppen`, { name });
  expect(a.status).toBe(201);
  return a.body as { id: string; version: number; name: string };
};
const liste = async (lagerId: string, konto = leiter()) => {
  const a = await anfrage(konto, "GET", `${L(lagerId)}/gruppen`);
  expect(a.status).toBe(200);
  return a.body as {
    gruppen: {
      id: string;
      name: string;
      reihenfolge: number;
      personen: { personId: string; rolle: string }[];
      teilnehmer: { id: string; stufe: string | null; ceviName?: string }[];
    }[];
    ohneGruppe: number;
    abgewaehlt: number;
  };
};
const mischen = (
  lagerId: string,
  anzahl: number,
  uebernehmen: boolean,
  seed?: number,
  konto = leiter(),
) =>
  anfrage(konto, "POST", `${L(lagerId)}/gruppen/mischen`, {
    anzahl,
    uebernehmen,
    ...(seed === undefined ? {} : { seed }),
  });
const zuordnen = (lagerId: string, body: Record<string, unknown>) =>
  anfrage(leiter(), "PUT", `${L(lagerId)}/gruppen/zuordnung`, body);
const waehle = (lagerId: string, abgewaehlt: boolean, ids: string[]) =>
  anfrage(leiter(), "PUT", `${L(lagerId)}/gruppen/abgewaehlt`, {
    abgewaehlt,
    teilnehmerIds: ids,
  });
const zuordnungen = (lagerId: string) =>
  db
    .select()
    .from(schema.gruppeZuordnung)
    .where(
      and(
        eq(schema.gruppeZuordnung.lagerId, lagerId),
        isNull(schema.gruppeZuordnung.geloeschtAm),
      ),
    );
const feed = async (lagerId: string, tabelle: string) =>
  (
    await db
      .select()
      .from(schema.lagerAenderung)
      .where(eq(schema.lagerAenderung.lagerId, lagerId))
  )
    .filter((z) => z.tabelle === tabelle)
    .sort((a, b) => a.seq - b.seq);

describe("Rechte je Lager-Persona", () => {
  // Lesen: alle vier Lager-Rollen. Ändern: Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen nicht
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 200,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const aendern = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: erfolg,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });
  let id: string;
  beforeAll(async () => {
    id = await frischesLager();
    // Die falsche Zeile der fremden Abteilung gibt nichts frei
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: konten.fremdeAbteilung.id!,
      rolle: "lagerleitung",
    });
  });

  test.each(LAGER_PERSONAS)("%s: lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", `${L(id)}/gruppen`)).status).toBe(
      lesen[p],
    );
  });

  test.each(LAGER_PERSONAS)(
    "%s: anlegen, ändern, zuordnen, abwählen, mischen und löschen",
    async (p) => {
      const k = konten[p];
      const neu = await anfrage(k, "POST", `${L(id)}/gruppen`, { name: p });
      expect(neu.status).toBe(aendern(201)[p]);
      const g = await gruppeAnlegen(id, `Ziel ${p}`);
      const [t] = await kinder(id, [[`Rolle ${p}`, "Wolf"]]);
      const stand = [
        ["PATCH", `/gruppen/${g.id}`, { version: g.version, name: "X" }],
        ["PUT", `/gruppen/zuordnung`, { gruppeId: g.id, teilnehmerIds: [t] }],
        [
          "PUT",
          `/gruppen/abgewaehlt`,
          { abgewaehlt: false, teilnehmerIds: [t] },
        ],
        [
          "POST",
          `/gruppen/mischen`,
          { anzahl: 2, uebernehmen: false, seed: 1 },
        ],
      ] as const;
      const status: number[] = [];
      for (const [methode, pfad, body] of stand) {
        const a = await anfrage(k, methode, `${L(id)}${pfad}`, body);
        expect(a.status, `${methode} ${pfad}`).toBe(aendern(200)[p]);
        status.push(a.status);
      }
      const bleibt = status[0] === 200 ? g.version + 1 : g.version;
      const d = await anfrage(
        k,
        "DELETE",
        `${L(id)}/gruppen/${g.id}?version=${bleibt}`,
      );
      expect(d.status).toBe(aendern(204)[p]);
    },
  );
});

describe("Gruppen verwalten", () => {
  test("anlegen, sortiert listen, umbenennen, Versionskonflikt, löschen", async () => {
    const id = await frischesLager();
    const b = await gruppeAnlegen(id, "  Bär  ");
    expect(b.name).toBe("Bär");
    const a = await gruppeAnlegen(id, "Adler");
    // Ohne Angabe folgt die Reihenfolge der Anlage
    expect((await liste(id)).gruppen.map((g) => g.name)).toEqual([
      "Bär",
      "Adler",
    ]);
    const umgestellt = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/gruppen/${a.id}`,
      { version: a.version, reihenfolge: 0 },
    );
    expect(umgestellt.status).toBe(200);
    expect((await liste(id)).gruppen.map((g) => g.name)).toEqual([
      "Adler",
      "Bär",
    ]);
    // Alte Version: 409 mit dem aktuellen Stand
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/gruppen/${a.id}`,
      { version: a.version, name: "Neu" },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
    expect(konflikt.body.aktuell.name).toBe("Adler");
    // Unbekannte Felder, leerer Name, Steuerzeichen, zu lang
    for (const body of [
      { name: "X", gesundheit: "x" },
      { name: "" },
      { name: "A\u0000B" },
      { name: "x".repeat(101) },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${L(id)}/gruppen`, body)).status,
      ).toBe(400);
    }
    const weg = await anfrage(
      leiter(),
      "DELETE",
      `${L(id)}/gruppen/${b.id}?version=${b.version}`,
    );
    expect(weg.status).toBe(204);
    expect((await liste(id)).gruppen.map((g) => g.name)).toEqual(["Adler"]);
    // Eine Gruppe eines anderen Lagers ist unbekannt
    const anderes = await frischesLager();
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(anderes)}/gruppen/${a.id}`, {
          version: 1,
          name: "X",
        })
      ).status,
    ).toBe(404);
  });

  test("höchstens 50 Gruppen je Lager", async () => {
    const id = await frischesLager();
    await db.insert(schema.gruppe).values(
      Array.from({ length: 50 }, (_, i) => ({
        lagerId: id,
        name: `G${i}`,
        lagerSeq: 0,
      })),
    );
    const a = await anfrage(leiter(), "POST", `${L(id)}/gruppen`, {
      name: "Zu viel",
    });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("ZU_VIELE_GRUPPEN");
  });

  test("Team-Sicht: das Team liest Gruppen mit Namen und Stufe, ohne Cevi-Namen; die Lagerleitung sieht den Cevi-Namen", async () => {
    const id = await frischesLager();
    const [t] = await kinder(id, [["Muster", "Wolf"]], "Chnopf");
    const g = await gruppeAnlegen(id, "Adler");
    expect(
      (
        await zuordnen(id, {
          gruppeId: g.id,
          teilnehmerIds: [t],
          personIds: [konten.team.id],
          rolle: "leitung",
        })
      ).status,
    ).toBe(200);
    const team = await liste(id, konten.team);
    expect(team.gruppen[0]!.teilnehmer).toEqual([
      { id: t, vorname: "Kind", nachname: "Muster", stufe: "Wolf" },
    ]);
    expect(team.gruppen[0]!.personen).toMatchObject([
      { personId: konten.team.id, rolle: "leitung" },
    ]);
    const chef = await liste(id, leiter());
    expect(chef.gruppen[0]!.teilnehmer[0]!.ceviName).toBe("Chnopf");
    // Keine Gesundheitsdaten und keine Kontaktdaten in der Antwort
    expect(JSON.stringify(team)).not.toMatch(/telefon|email|adresse|gesund/i);
  });
});

describe("Zuordnen", () => {
  test("eine Person und ein Teilnehmender stehen höchstens in einer Gruppe; verschieben, Rolle ändern, entfernen", async () => {
    const id = await frischesLager();
    const [t1, t2] = await kinder(id, [
      ["A", "Wolf"],
      ["B", "Wolf"],
    ]);
    const g1 = await gruppeAnlegen(id, "Eins");
    const g2 = await gruppeAnlegen(id, "Zwei");
    const alle = {
      gruppeId: g1.id,
      teilnehmerIds: [t1, t2],
      personIds: [konten.team.id],
    };
    expect((await zuordnen(id, alle)).body).toEqual({ geaendert: 3 });
    // Dasselbe nochmal: nichts ändert sich
    expect((await zuordnen(id, alle)).body).toEqual({ geaendert: 0 });
    // Verschieben nach Zwei: aus Eins weg, nie in beiden
    expect(
      (
        await zuordnen(id, {
          gruppeId: g2.id,
          teilnehmerIds: [t1],
          personIds: [konten.team.id],
          rolle: "leitung",
        })
      ).body,
    ).toEqual({ geaendert: 2 });
    const stand = await liste(id);
    expect(
      stand.gruppen.map((g) => g.teilnehmer.map((t) => t.id).sort()),
    ).toEqual([[t2], [t1]]);
    expect(stand.gruppen[1]!.personen).toMatchObject([
      { personId: konten.team.id, rolle: "leitung" },
    ]);
    expect(stand.gruppen[0]!.personen).toEqual([]);
    expect(await zuordnungen(id)).toHaveLength(3);
    // Die Datenbank erzwingt es auch gegen einen Fehler im Code
    await expect(
      db.insert(schema.gruppeZuordnung).values({
        lagerId: id,
        gruppeId: g1.id,
        teilnehmerId: t1,
        lagerSeq: 0,
      }),
    ).rejects.toThrow();
    // Entfernen
    expect(
      (await zuordnen(id, { gruppeId: null, teilnehmerIds: [t1, t2] })).body,
    ).toEqual({ geaendert: 2 });
    expect((await liste(id)).ohneGruppe).toBe(2);
    expect(await zuordnungen(id)).toHaveLength(1);
  });

  test("Prüfungen: fremde und unbekannte IDs, Nicht-Mitglied, doppelte IDs, nicht dabei", async () => {
    const id = await frischesLager();
    const anderes = await frischesLager();
    const [t] = await kinder(id, [["A", "Wolf"]]);
    const [fremd] = await kinder(anderes, [["F", "Wolf"]]);
    const g = await gruppeAnlegen(id, "Eins");
    const fremdeGruppe = await gruppeAnlegen(anderes, "Fremd");
    expect(
      (await zuordnen(id, { gruppeId: g.id, teilnehmerIds: [fremd!] })).status,
    ).toBe(404);
    expect(
      (await zuordnen(id, { gruppeId: fremdeGruppe.id, teilnehmerIds: [t] }))
        .status,
    ).toBe(404);
    // Ein Konto, das nicht Mitglied dieses Lagers ist
    expect(
      (
        await zuordnen(id, {
          gruppeId: g.id,
          personIds: [konten.ohneMitgliedschaft.id],
        })
      ).status,
    ).toBe(404);
    for (const body of [
      { gruppeId: g.id },
      { gruppeId: g.id, teilnehmerIds: [t, t] },
      { gruppeId: g.id, teilnehmerIds: [t], unbekannt: 1 },
    ]) {
      expect((await zuordnen(id, body)).status).toBe(400);
    }
    expect(await zuordnungen(id)).toHaveLength(0);
    // Wer nicht dabei ist, lässt sich keiner Gruppe zuordnen
    await waehle(id, true, [t!]);
    const a = await zuordnen(id, { gruppeId: g.id, teilnehmerIds: [t] });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("ABGEWAEHLT");
  });

  test("eine Gruppe löschen nimmt ihre Zuordnungen mit", async () => {
    const id = await frischesLager();
    const [t] = await kinder(id, [["A", "Wolf"]]);
    const g = await gruppeAnlegen(id, "Eins");
    await zuordnen(id, {
      gruppeId: g.id,
      teilnehmerIds: [t],
      personIds: [konten.team.id],
    });
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/gruppen/${g.id}?version=${g.version}`,
        )
      ).status,
    ).toBe(204);
    expect(await zuordnungen(id)).toHaveLength(0);
    expect((await liste(id)).ohneGruppe).toBe(1);
    // Der Feed meldet beide Löschungen
    expect((await feed(id, "gruppe_zuordnung")).map((z) => z.art)).toEqual([
      "neu",
      "neu",
      "geloescht",
      "geloescht",
    ]);
  });
});

describe("Nicht dabei", () => {
  test("abgewählte Teilnehmende verlassen ihre Gruppe, erscheinen nirgends und lassen sich wieder zuwählen", async () => {
    const id = await frischesLager();
    const [t1, t2] = await kinder(id, [
      ["A", "Wolf"],
      ["B", "Wolf"],
    ]);
    const g = await gruppeAnlegen(id, "Eins");
    await zuordnen(id, { gruppeId: g.id, teilnehmerIds: [t1, t2] });
    expect((await waehle(id, true, [t1!])).body).toEqual({ geaendert: 1 });
    // Nochmal: nichts ändert sich
    expect((await waehle(id, true, [t1!])).body).toEqual({ geaendert: 0 });
    const stand = await liste(id);
    expect(stand.gruppen[0]!.teilnehmer.map((t) => t.id)).toEqual([t2]);
    expect(stand.abgewaehlt).toBe(1);
    expect(stand.ohneGruppe).toBe(0);
    // Die Liste der Teilnehmenden zeigt die Abwahl, die Abzählliste zählt die Person nicht
    const alle = await anfrage(leiter(), "GET", `${L(id)}/teilnehmer`);
    expect(
      alle.body.teilnehmer.map((t: { id: string; abgewaehlt: boolean }) => [
        t.id,
        t.abgewaehlt,
      ]),
    ).toEqual([
      [t1, true],
      [t2, false],
    ]);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/abzaehlen`)).body.gesamt,
    ).toBe(1);
    // Wieder zuwählen: in keiner Gruppe, bis sie zugeordnet wird
    expect((await waehle(id, false, [t1!])).body).toEqual({ geaendert: 1 });
    const danach = await liste(id);
    expect(danach.abgewaehlt).toBe(0);
    expect(danach.ohneGruppe).toBe(1);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/abzaehlen`)).body.gesamt,
    ).toBe(2);
    // Unbekannte ID: 404, nichts ändert sich
    expect((await waehle(id, true, [t1!, UNBEKANNT])).status).toBe(404);
    expect((await liste(id)).abgewaehlt).toBe(0);
    // Doppelte und fehlende IDs sind 400
    expect((await waehle(id, true, [t1!, t1!])).status).toBe(400);
    expect((await waehle(id, true, [])).status).toBe(400);
  });
});

describe("Gemischt einteilen", () => {
  const aufstellen = async () => {
    const id = await frischesLager();
    const reihe = (n: number, stufe: string | null, p: string) =>
      Array.from({ length: n }, (_, i): [string, string | null] => [
        `${p}${i}`,
        stufe,
      ]);
    await kinder(id, [
      ...reihe(7, "Biber", "B"),
      ...reihe(10, "Wolf", "W"),
      ...reihe(4, null, "O"),
    ]);
    return id;
  };
  type Plan = {
    gruppen: {
      gruppeId: string;
      anzahl: number;
      teilnehmer: { id: string; stufe: string | null }[];
    }[];
  };
  // Die Liste der Gruppen sortiert nach Name, der Vorschlag nach Verteilung: verglichen wird je Gruppe als Menge
  const verteilung = (p: Plan) =>
    p.gruppen.map((g) => g.teilnehmer.map((t) => t.id).sort());

  test("die Vorschau ändert nichts und gibt bei gleichem Startwert dieselbe Einteilung", async () => {
    const id = await aufstellen();
    const a = await mischen(id, 4, false, 12345);
    const b = await mischen(id, 4, false, 12345);
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(a.body.vorschau).toBe(true);
    expect(a.body.seed).toBe(12345);
    expect((await mischen(id, 4, false, 12346)).body).not.toEqual(a.body);
    // Nichts geschrieben: keine Gruppe, keine Zuordnung, nichts im Feed
    expect((await liste(id)).gruppen).toEqual([]);
    expect(await zuordnungen(id)).toHaveLength(0);
    expect(await feed(id, "gruppe")).toHaveLength(0);
    // Ohne Startwert zieht der Server einen und nennt ihn
    const frei = await mischen(id, 3, false);
    expect(Number.isInteger(frei.body.seed)).toBe(true);
    expect((await mischen(id, 3, false, frei.body.seed)).body.gruppen).toEqual(
      frei.body.gruppen,
    );
  });

  test("gleichmässig nach Stufe: Gruppen und Stufen unterscheiden sich um höchstens eins; Übernehmen entspricht der Vorschau", async () => {
    const id = await aufstellen();
    const vorschau = await mischen(id, 4, false, 7);
    const sizes: number[] = vorschau.body.gruppen.map(
      (g: { anzahl: number }) => g.anzahl,
    );
    expect(sizes.reduce((x, y) => x + y, 0)).toBe(21);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    for (const stufe of ["Biber", "Wolf", null]) {
      const n: number[] = (vorschau.body as Plan).gruppen.map(
        (g) => g.teilnehmer.filter((t) => t.stufe === stufe).length,
      );
      expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1);
    }
    const ok = await mischen(id, 4, true, 7);
    expect(ok.status).toBe(200);
    expect(ok.body.vorschau).toBe(false);
    // Gleiche Teilnehmende je Gruppe wie in der Vorschau; die fehlenden Gruppen sind neu angelegt
    expect(verteilung(ok.body)).toEqual(verteilung(vorschau.body));
    const stand = await liste(id);
    expect(stand.gruppen.map((g) => g.name)).toEqual([
      "Gruppe 1",
      "Gruppe 2",
      "Gruppe 3",
      "Gruppe 4",
    ]);
    expect(
      stand.gruppen.map((g) => g.teilnehmer.map((t) => t.id).sort()),
    ).toEqual(verteilung(vorschau.body));
    expect(stand.ohneGruppe).toBe(0);
  });

  test("Abgewählte sind ausgeschlossen", async () => {
    const id = await aufstellen();
    const alle = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/teilnehmer?limit=200`,
    );
    const weg: string[] = alle.body.teilnehmer
      .slice(0, 5)
      .map((t: { id: string }) => t.id);
    await waehle(id, true, weg);
    const ok = await mischen(id, 3, true, 1);
    const dabei = verteilung(ok.body).flat();
    expect(dabei).toHaveLength(16);
    for (const w of weg) expect(dabei).not.toContain(w);
    expect(await zuordnungen(id)).toHaveLength(16);
    const stand = await liste(id);
    expect(stand.abgewaehlt).toBe(5);
    expect(stand.ohneGruppe).toBe(0);
  });

  test("überschreibt die Einteilung der Teilnehmenden, die Leitungen bleiben; bestehende Gruppen werden genutzt", async () => {
    const id = await frischesLager();
    const ids = await kinder(id, [
      ["A", "Wolf"],
      ["B", "Wolf"],
      ["C", "Biber"],
      ["D", "Biber"],
    ]);
    const g1 = await gruppeAnlegen(id, "Adler");
    const g2 = await gruppeAnlegen(id, "Bär");
    const g3 = await gruppeAnlegen(id, "Chatz");
    // Alle vier in der dritten Gruppe, dazu eine Leitung in der ersten
    await zuordnen(id, { gruppeId: g3.id, teilnehmerIds: ids });
    await zuordnen(id, {
      gruppeId: g1.id,
      personIds: [konten.team.id],
      rolle: "leitung",
    });
    const ok = await mischen(id, 2, true, 5);
    expect(ok.status).toBe(200);
    // Nur die ersten zwei Gruppen werden genutzt, keine neue entsteht
    expect((ok.body as Plan).gruppen.map((g) => g.gruppeId)).toEqual([
      g1.id,
      g2.id,
    ]);
    const stand = await liste(id);
    expect(stand.gruppen.map((g) => g.name)).toEqual(["Adler", "Bär", "Chatz"]);
    expect(stand.gruppen.map((g) => g.teilnehmer.length)).toEqual([2, 2, 0]);
    expect(stand.gruppen[0]!.personen).toMatchObject([
      { personId: konten.team.id, rolle: "leitung" },
    ]);
    // Jede Stufe auf beide Gruppen verteilt
    for (const g of stand.gruppen.slice(0, 2)) {
      expect(g.teilnehmer.map((t) => t.stufe).sort()).toEqual([
        "Biber",
        "Wolf",
      ]);
    }
    expect(await zuordnungen(id)).toHaveLength(5);
    // Wer schon richtig steht, bleibt unberührt: Eine Wiederholung mit demselben Startwert ändert nichts im Feed
    const vorher = (await feed(id, "gruppe_zuordnung")).length;
    expect((await mischen(id, 2, true, 5)).body.geaendert).toBe(0);
    expect((await feed(id, "gruppe_zuordnung")).length).toBe(vorher);
  });

  test("Eingaben: Anzahl 2 bis 20, unbekannte Felder, ohne Teilnehmende", async () => {
    const id = await frischesLager();
    for (const anzahl of [1, 21, 2.5, "3"]) {
      const a = await anfrage(leiter(), "POST", `${L(id)}/gruppen/mischen`, {
        anzahl,
        uebernehmen: false,
      });
      expect(a.status, String(anzahl)).toBe(400);
    }
    for (const body of [
      { anzahl: 3 },
      { anzahl: 3, uebernehmen: false, seed: -1 },
      { anzahl: 3, uebernehmen: false, seed: 4294967296 },
      { anzahl: 3, uebernehmen: false, extra: 1 },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${L(id)}/gruppen/mischen`, body))
          .status,
      ).toBe(400);
    }
    const leer = await mischen(id, 20, true, 1);
    expect(leer.status).toBe(200);
    expect(leer.body.gruppen).toHaveLength(20);
    expect((await liste(id)).gruppen).toHaveLength(20);
  });

  test("Rate-Limit: zu viele Läufe je Minute geben 429", async () => {
    const id = await frischesLager();
    const status: number[] = [];
    for (let i = 0; i < 12; i++) {
      status.push((await mischen(id, 2, false, i)).status);
    }
    expect(status.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(status.slice(10)).toEqual([429, 429]);
  });

  test("geschlossenes Lager: lesen geht, mischen und ändern nicht", async () => {
    const id = await legeLager(welt.testabteilungId, "abgeschlossen");
    await mitgliederEintragen(id);
    expect((await anfrage(leiter(), "GET", `${L(id)}/gruppen`)).status).toBe(
      200,
    );
    for (const [methode, pfad, body] of [
      ["POST", "/gruppen", { name: "X" }],
      ["POST", "/gruppen/mischen", { anzahl: 2, uebernehmen: false }],
      ["PUT", "/gruppen/abgewaehlt", { abgewaehlt: true, teilnehmerIds: [] }],
    ] as const) {
      const a = await anfrage(leiter(), methode, `${L(id)}${pfad}`, body);
      expect(a.status, pfad).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
  });
});

describe("Abzählen nach Gruppe", () => {
  test("der Filter «gruppe» zeigt nur die Teilnehmenden und die Leitenden der Gruppe, Summen über den Filter", async () => {
    const id = await frischesLager();
    const [t1, t2, t3] = await kinder(id, [
      ["A", "Wolf"],
      ["B", "Wolf"],
      ["C", "Biber"],
    ]);
    const g1 = await gruppeAnlegen(id, "Eins");
    const g2 = await gruppeAnlegen(id, "Zwei");
    await zuordnen(id, {
      gruppeId: g1.id,
      teilnehmerIds: [t1, t2],
      personIds: [konten.team.id],
      rolle: "leitung",
    });
    await zuordnen(id, { gruppeId: g2.id, teilnehmerIds: [t3] });
    await anfrage(leiter(), "PUT", `${L(id)}/abzaehlen`, {
      geprueft: true,
      teilnehmerIds: [t1],
    });
    const eins = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/abzaehlen?gruppe=${g1.id}`,
    );
    expect(
      eins.body.eintraege
        .map((e: { teilnehmerId: string }) => e.teilnehmerId)
        .sort(),
    ).toEqual([t1, t2].sort());
    expect([eins.body.da, eins.body.gesamt]).toEqual([1, 2]);
    const zwei = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/abzaehlen?gruppe=${g2.id}&stufe=biber`,
    );
    expect(zwei.body.gesamt).toBe(1);
    const team = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/abzaehlen?art=team&gruppe=${g1.id}`,
    );
    expect(
      team.body.eintraege.map((e: { personId: string }) => e.personId),
    ).toEqual([konten.team.id]);
    // Ohne Filter bleibt alles wie vorher; eine unbekannte Gruppe ergibt eine leere Liste; keine UUID ist 400
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/abzaehlen`)).body.gesamt,
    ).toBe(3);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/abzaehlen?gruppe=${UNBEKANNT}`))
        .body.gesamt,
    ).toBe(0);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/abzaehlen?gruppe=x`)).status,
    ).toBe(400);
  });
});
