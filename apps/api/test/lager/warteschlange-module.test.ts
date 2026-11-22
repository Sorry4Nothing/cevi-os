import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Die Operationen der Warteschlange für Höcks, Traktanden, Pinnwand, Beschlüsse, Ressort-Notizen und Reihenfolgen (#521) gegen die ganze App. Jede Operation: anwenden, doppelt senden, Konflikt, fehlendes Recht, geschlossenes Lager. Die Logik selbst prüfen die Tests der Module über die Routen; hier zählt, dass die Operation dieselbe aufruft.
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
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;

async function neuesLager(status: "aktiv" | "abgeschlossen" = "aktiv") {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Warteschlangenlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
  return id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await neuesLager();
  geschlossenId = await neuesLager("abgeschlossen");
});

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

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
type Ergebnis = {
  clientOpId: string;
  status: string;
  code?: string;
  ergebnis?: { id: string; version?: number };
  aktuell?: Record<string, unknown>;
};
// Die Warteschlange nimmt je Konto höchstens ANFRAGEN_PRO_MINUTE Anfragen je Minute an: Alle zehn Anfragen läuft die Uhr der Tests eine Minute weiter (nur Date, die Sitzung gilt eine Stunde)
let gesendet = 0;
async function sende(
  konto: PersonaKonto,
  operationen: {
    typ: string;
    nutzlast: Record<string, unknown>;
    clientOpId?: string;
  }[],
  id = lagerId,
) {
  if (++gesendet % 10 === 0) vi.setSystemTime(Date.now() + 61_000);
  const a = await anfrage(konto, "POST", `${L(id)}/aenderungen`, {
    operationen: operationen.map((o) => ({ clientOpId: randomUUID(), ...o })),
  });
  return { status: a.status, ergebnisse: a.body?.ergebnisse as Ergebnis[] };
}
async function einzeln(
  typ: string,
  nutzlast: Record<string, unknown>,
  konto = leiter(),
) {
  const r = await sende(konto, [{ typ, nutzlast }]);
  expect(r.status).toBe(200);
  return r.ergebnisse[0]!;
}

// Fixtures über die Routen (die Module prüfen ihre Eingaben selbst)
async function post(pfad: string, body: Record<string, unknown>) {
  const a = await anfrage(leiter(), "POST", `${L()}${pfad}`, body);
  expect(a.status).toBe(201);
  return a.body as { id: string; version: number };
}
let zaehler = 0;
const hoeck = (art = "team") =>
  post("/hoecks", { titel: "Höck", art, datum: "2027-07-12" });
const traktandum = (hoeckId: string | null = null) =>
  post("/traktanden", { titel: "Punkt", hoeckId });
const beitrag = () => post("/pinnwand", { titel: "Mitteilung" });
const beschluss = () => post("/beschluesse", { text: "Wir fahren früh." });
const ressort = () =>
  post("/ressorts", { kuerzel: `r${zaehler++}`, name: "Ressort" });
const notiz = async () => {
  const r = await ressort();
  return {
    ressortId: r.id,
    ...(await post(`/ressorts/${r.id}/notizen`, { text: "Notiz" })),
  };
};
const aufgabe = () => post("/aufgaben", { titel: "Aufgabe" });
const mitgliedsId = () => konten.team.id!;

// Ein Fall je Operation: nutzlast() legt frische Ziele an und liefert die Nutzlast; konflikt() (falls die Operation eine Version prüft) liefert eine Nutzlast mit veralteter Version; pruefe() liest das Ergebnis in der Datenbank
type Fall = {
  typ: string;
  nutzlast: () => Promise<Record<string, unknown>>;
  konflikt?: () => Promise<Record<string, unknown>>;
};
const veraltet = (n: Record<string, unknown>) => ({ ...n, version: 99 });
const FAELLE: Fall[] = [
  {
    typ: "hoeck.anlegen",
    nutzlast: async () => ({
      titel: "Neuer Höck",
      art: "team",
      datum: "2027-07-13",
    }),
  },
  {
    typ: "hoeck.aendern",
    nutzlast: async () => ({
      id: (await hoeck()).id,
      version: 1,
      titel: "Neu",
    }),
    konflikt: async () => veraltet({ id: (await hoeck()).id, titel: "Neu" }),
  },
  {
    typ: "hoeck.loeschen",
    nutzlast: async () => ({ id: (await hoeck()).id, version: 1 }),
    konflikt: async () => veraltet({ id: (await hoeck()).id }),
  },
  {
    typ: "hoeck.anwesend",
    nutzlast: async () => ({
      hoeckId: (await hoeck()).id,
      personId: mitgliedsId(),
      anwesend: true,
    }),
  },
  {
    typ: "traktandum.anlegen",
    nutzlast: async () => ({ titel: "Neuer Punkt" }),
  },
  {
    typ: "traktandum.aendern",
    nutzlast: async () => ({
      id: (await traktandum()).id,
      version: 1,
      titel: "Neu",
    }),
    konflikt: async () =>
      veraltet({ id: (await traktandum()).id, titel: "Neu" }),
  },
  {
    typ: "traktandum.loeschen",
    nutzlast: async () => ({ id: (await traktandum()).id, version: 1 }),
    konflikt: async () => veraltet({ id: (await traktandum()).id }),
  },
  {
    typ: "traktandum.reihenfolge",
    nutzlast: async () => {
      const h = (await hoeck()).id;
      const [a, b] = [await traktandum(h), await traktandum(h)];
      return {
        hoeckId: h,
        eintraege: [
          { id: b.id, version: 1 },
          { id: a.id, version: 1 },
        ],
      };
    },
    konflikt: async () => {
      const h = (await hoeck()).id;
      const [a, b] = [await traktandum(h), await traktandum(h)];
      return {
        hoeckId: h,
        eintraege: [
          { id: b.id, version: 99 },
          { id: a.id, version: 99 },
        ],
      };
    },
  },
  {
    typ: "pinnwand.anlegen",
    nutzlast: async () => ({ titel: "Neue Mitteilung" }),
  },
  {
    typ: "pinnwand.aendern",
    nutzlast: async () => ({
      id: (await beitrag()).id,
      version: 1,
      titel: "Neu",
    }),
    konflikt: async () => veraltet({ id: (await beitrag()).id, titel: "Neu" }),
  },
  {
    typ: "pinnwand.loeschen",
    nutzlast: async () => ({ id: (await beitrag()).id, version: 1 }),
    konflikt: async () => veraltet({ id: (await beitrag()).id }),
  },
  {
    typ: "beschluss.anlegen",
    nutzlast: async () => ({ text: "Neuer Beschluss" }),
  },
  {
    typ: "beschluss.aendern",
    nutzlast: async () => ({
      id: (await beschluss()).id,
      version: 1,
      text: "Neu",
    }),
    konflikt: async () => veraltet({ id: (await beschluss()).id, text: "Neu" }),
  },
  {
    typ: "beschluss.loeschen",
    nutzlast: async () => ({ id: (await beschluss()).id, version: 1 }),
    konflikt: async () => veraltet({ id: (await beschluss()).id }),
  },
  {
    typ: "ressort_notiz.anlegen",
    nutzlast: async () => ({ ressortId: (await ressort()).id, text: "Neu" }),
  },
  {
    typ: "ressort_notiz.aendern",
    nutzlast: async () => {
      const n = await notiz();
      return { ressortId: n.ressortId, id: n.id, version: 1, text: "Neu" };
    },
    konflikt: async () => {
      const n = await notiz();
      return veraltet({ ressortId: n.ressortId, id: n.id, text: "Neu" });
    },
  },
  {
    typ: "ressort_notiz.loeschen",
    nutzlast: async () => {
      const n = await notiz();
      return { ressortId: n.ressortId, id: n.id, version: 1 };
    },
    konflikt: async () => {
      const n = await notiz();
      return veraltet({ ressortId: n.ressortId, id: n.id });
    },
  },
  {
    typ: "ressort.ruhig",
    nutzlast: async () => ({
      id: (await ressort()).id,
      version: 1,
      ruhig: true,
    }),
    konflikt: async () => veraltet({ id: (await ressort()).id, ruhig: true }),
  },
  {
    typ: "ressort.reihenfolge",
    nutzlast: async () => {
      const [a, b] = [await ressort(), await ressort()];
      return {
        eintraege: [
          { id: b.id, version: 1 },
          { id: a.id, version: 1 },
        ],
      };
    },
    konflikt: async () => {
      const [a, b] = [await ressort(), await ressort()];
      return {
        eintraege: [
          { id: b.id, version: 99 },
          { id: a.id, version: 99 },
        ],
      };
    },
  },
  {
    typ: "checkpunkt.reihenfolge",
    nutzlast: async () => {
      const a = await aufgabe();
      const p = async () =>
        post(`/aufgaben/${a.id}/checkliste`, { text: "Punkt" });
      const [x, y] = [await p(), await p()];
      return {
        aufgabeId: a.id,
        eintraege: [
          { id: y.id, version: 1 },
          { id: x.id, version: 1 },
        ],
      };
    },
    konflikt: async () => {
      const a = await aufgabe();
      const p = async () =>
        post(`/aufgaben/${a.id}/checkliste`, { text: "Punkt" });
      const [x, y] = [await p(), await p()];
      return {
        aufgabeId: a.id,
        eintraege: [
          { id: y.id, version: 99 },
          { id: x.id, version: 99 },
        ],
      };
    },
  },
];

describe("Operationen der Module: anwenden, doppelt senden, Konflikt", () => {
  for (const fall of FAELLE) {
    test(`${fall.typ}: ok, dieselbe clientOpId liefert dasselbe Ergebnis`, async () => {
      const nutzlast = await fall.nutzlast();
      const clientOpId = randomUUID();
      const erste = await sende(leiter(), [
        { typ: fall.typ, nutzlast, clientOpId },
      ]);
      expect(erste.ergebnisse[0]).toMatchObject({ status: "ok", clientOpId });
      const zweite = await sende(leiter(), [
        { typ: fall.typ, nutzlast, clientOpId },
      ]);
      expect(zweite.ergebnisse[0]).toEqual(erste.ergebnisse[0]);
    });

    if (fall.konflikt) {
      test(`${fall.typ}: eine veraltete Version ist ein Konflikt mit dem aktuellen Stand`, async () => {
        const e = await einzeln(fall.typ, await fall.konflikt!());
        expect(e).toMatchObject({
          status: "konflikt",
          code: "VERSION_KONFLIKT",
        });
        expect(e.aktuell).toBeTruthy();
      });
    }

    test(`${fall.typ}: Team und Lesen haben das Recht nicht, ein geschlossenes Lager nimmt nichts an`, async () => {
      const nutzlast = await fall.nutzlast();
      for (const persona of ["team", "lesen"] as const) {
        const e = await einzeln(fall.typ, nutzlast, konten[persona]);
        expect(e).toMatchObject({
          status: "abgelehnt",
          code: "KEINE_BERECHTIGUNG",
        });
      }
      const zu = await sende(
        leiter(),
        [{ typ: fall.typ, nutzlast }],
        geschlossenId,
      );
      expect(zu.status).toBe(409);
      // Die Operation hat nichts geschrieben: Sie läuft danach im offenen Lager
      expect((await einzeln(fall.typ, nutzlast)).status).toBe("ok");
    });
  }

  test("jeder neue Typ hat einen Fall (die Liste hier und die Anmeldungen laufen nicht auseinander)", async () => {
    const { listeOperationen } = await import("../../src/lager/operationen.js");
    const neu = listeOperationen()
      .map((o) => o.typ)
      .filter(
        (t) =>
          /^(hoeck|traktandum|pinnwand|beschluss|ressort|ressort_notiz)\./.test(
            t,
          ) || t === "checkpunkt.reihenfolge",
      )
      // Hat eigene Tests: Team und Lesen dürfen es (pinnwand.lesen), ein geschlossenes Lager nimmt es nicht an
      .filter((t) => t !== "pinnwand.gesehen");
    expect(FAELLE.map((f) => f.typ).sort()).toEqual(neu.sort());
  });
});

describe("Ergebnisse und Wirkung wie über die Routen", () => {
  test("Höck: anlegen, ändern, Anwesenheit, löschen; ein Höck mit Traktandum bleibt (HOECK_HAT_TRAKTANDEN)", async () => {
    const angelegt = await einzeln("hoeck.anlegen", {
      titel: "Offline-Höck",
      art: "team",
      datum: "2027-07-14",
    });
    expect(angelegt).toMatchObject({ status: "ok", ergebnis: { version: 1 } });
    const id = angelegt.ergebnis!.id;
    expect(
      await einzeln("hoeck.aendern", { id, version: 1, ort: "Zelt" }),
    ).toMatchObject({ status: "ok", ergebnis: { id, version: 2 } });
    const [z] = await db
      .select()
      .from(schema.hoeck)
      .where(eq(schema.hoeck.id, id));
    expect(z).toMatchObject({ titel: "Offline-Höck", ort: "Zelt", version: 2 });

    const mitglied = { hoeckId: id, personId: konten.team.id! };
    await einzeln("hoeck.anwesend", { ...mitglied, anwesend: true });
    const anwesend = () =>
      db
        .select({ n: count() })
        .from(schema.hoeckAnwesenheit)
        .where(eq(schema.hoeckAnwesenheit.hoeckId, id));
    expect((await anwesend())[0]!.n).toBe(1);
    await einzeln("hoeck.anwesend", { ...mitglied, anwesend: true });
    expect((await anwesend())[0]!.n).toBe(1);
    await einzeln("hoeck.anwesend", { ...mitglied, anwesend: false });
    expect((await anwesend())[0]!.n).toBe(0);
    expect(
      await einzeln("hoeck.anwesend", {
        hoeckId: id,
        personId: konten.ohneMitgliedschaft.id!,
        anwesend: true,
      }),
    ).toMatchObject({ status: "abgelehnt", code: "KEIN_MITGLIED" });

    const t = await traktandum(id);
    expect(await einzeln("hoeck.loeschen", { id, version: 2 })).toMatchObject({
      status: "abgelehnt",
      code: "HOECK_HAT_TRAKTANDEN",
    });
    await einzeln("traktandum.loeschen", { id: t.id, version: 1 });
    expect(await einzeln("hoeck.loeschen", { id, version: 2 })).toMatchObject({
      status: "ok",
    });
    expect(
      await db.select().from(schema.hoeck).where(eq(schema.hoeck.id, id)),
    ).toEqual([]);
  });

  test("Traktandum: anlegen, ändern (Prüfung wie die Route), Reihenfolge, löschen", async () => {
    const h = (await hoeck()).id;
    const a = (await einzeln("traktandum.anlegen", { titel: "A", hoeckId: h }))
      .ergebnis!;
    const b = (await einzeln("traktandum.anlegen", { titel: "B", hoeckId: h }))
      .ergebnis!;
    expect(
      await einzeln("traktandum.anlegen", {
        titel: "X",
        hoeckId: randomUUID(),
      }),
    ).toMatchObject({ status: "abgelehnt", code: "HOECK_UNBEKANNT" });
    expect(
      await einzeln("traktandum.aendern", {
        id: a.id,
        version: 1,
        verantwortlichePersonIds: [konten.ohneMitgliedschaft.id!],
      }),
    ).toMatchObject({ status: "abgelehnt", code: "KEIN_MITGLIED" });
    expect(
      await einzeln("traktandum.aendern", {
        id: a.id,
        version: 1,
        entscheid: "Ja",
        status: "besprochen",
      }),
    ).toMatchObject({ status: "ok", ergebnis: { version: 2 } });

    await einzeln("traktandum.reihenfolge", {
      hoeckId: h,
      eintraege: [
        { id: b.id, version: 1 },
        { id: a.id, version: 2 },
      ],
    });
    const reihenfolge = async () =>
      (
        await db
          .select({
            id: schema.traktandum.id,
            r: schema.traktandum.reihenfolge,
          })
          .from(schema.traktandum)
          .where(eq(schema.traktandum.hoeckId, h))
      )
        .sort((x, y) => x.r - y.r)
        .map((z) => z.id);
    expect(await reihenfolge()).toEqual([b.id, a.id]);
    // Ein Eintrag aus einer anderen Liste: nichts ändert sich
    expect(
      await einzeln("traktandum.reihenfolge", {
        hoeckId: h,
        eintraege: [{ id: (await traktandum()).id, version: 1 }],
      }),
    ).toMatchObject({ status: "abgelehnt", code: "NICHT_GEFUNDEN" });
    await einzeln("traktandum.loeschen", { id: a.id, version: 3 });
    expect(await reihenfolge()).toEqual([b.id]);
  });

  test("Pinnwand: anlegen mit Empfängern, ändern, Zeitfenster und Mitglieder prüft wie die Route, löschen", async () => {
    const e = await einzeln("pinnwand.anlegen", {
      titel: "Packliste",
      text: "Schlafsack",
      wichtig: true,
      empfaenger: { rollen: ["team"], personen: [] },
    });
    expect(e).toMatchObject({ status: "ok", ergebnis: { version: 1 } });
    const id = e.ergebnis!.id;
    const empfaenger = () =>
      db
        .select()
        .from(schema.pinnwandEmpfaenger)
        .where(eq(schema.pinnwandEmpfaenger.beitragId, id));
    expect(await empfaenger()).toHaveLength(1);
    // «wichtig» legt Zeilen der Glocke an (der Push entfällt in der Warteschlange)
    expect(
      await db
        .select()
        .from(schema.lagerBenachrichtigung)
        .where(eq(schema.lagerBenachrichtigung.objektId, id)),
    ).toHaveLength(1);

    expect(
      await einzeln("pinnwand.aendern", {
        id,
        version: 1,
        titel: "Neu",
        empfaenger: { rollen: [], personen: [] },
      }),
    ).toMatchObject({ status: "ok", ergebnis: { version: 2 } });
    expect(await empfaenger()).toHaveLength(0);
    expect(
      await einzeln("pinnwand.aendern", {
        id,
        version: 2,
        sichtbarAb: "2027-07-12T10:00:00Z",
        sichtbarBis: "2027-07-11T10:00:00Z",
      }),
    ).toMatchObject({ status: "abgelehnt", code: "ZEITFENSTER_UNGUELTIG" });
    expect(
      await einzeln("pinnwand.anlegen", {
        titel: "X",
        empfaenger: { rollen: [], personen: [konten.ohneMitgliedschaft.id!] },
      }),
    ).toMatchObject({ status: "abgelehnt", code: "KEIN_MITGLIED" });
    expect(
      await einzeln("pinnwand.anlegen", {
        titel: "X",
        dateiIds: [randomUUID()],
      }),
    ).toMatchObject({ status: "abgelehnt", code: "DATEI_UNBEKANNT" });

    expect(
      await einzeln("pinnwand.loeschen", { id, version: 2 }),
    ).toMatchObject({
      status: "ok",
    });
    expect(
      await einzeln("pinnwand.loeschen", { id, version: 2 }),
    ).toMatchObject({ status: "abgelehnt", code: "NICHT_GEFUNDEN" });
  });

  test("Beschluss: anlegen, ändern, unbekannter Höck, löschen; ein Beschluss eines Lagerleitungs-Höcks ist für die Leitung ohne alle Höcks unbekannt", async () => {
    const b = await einzeln("beschluss.anlegen", { text: "Wir fahren früh." });
    expect(b).toMatchObject({ status: "ok", ergebnis: { version: 1 } });
    const id = b.ergebnis!.id;
    expect(
      await einzeln("beschluss.aendern", {
        id,
        version: 1,
        text: "Wir fahren spät.",
      }),
    ).toMatchObject({ status: "ok", ergebnis: { version: 2 } });
    expect(
      await einzeln("beschluss.aendern", {
        id,
        version: 2,
        hoeckId: randomUUID(),
      }),
    ).toMatchObject({ status: "abgelehnt", code: "HOECK_UNBEKANNT" });
    expect(
      await einzeln("beschluss.anlegen", {
        text: "X",
        protokollId: randomUUID(),
      }),
    ).toMatchObject({ status: "abgelehnt", code: "PROTOKOLL_UNBEKANNT" });
    expect(
      await einzeln("beschluss.loeschen", { id, version: 2 }),
    ).toMatchObject({
      status: "ok",
    });
    expect(
      await db
        .select()
        .from(schema.beschluss)
        .where(eq(schema.beschluss.id, id)),
    ).toEqual([]);
  });

  test("Ressort-Notiz und Reihenfolge der Ressorts und der Checkliste", async () => {
    const r = await ressort();
    const n = (
      await einzeln("ressort_notiz.anlegen", { ressortId: r.id, text: "Eins" })
    ).ergebnis!;
    expect(
      await einzeln("ressort_notiz.aendern", {
        ressortId: r.id,
        id: n.id,
        version: 1,
        text: "Zwei",
      }),
    ).toMatchObject({ status: "ok", ergebnis: { version: 2 } });
    // Die Notiz gehört zu einem anderen Ressort: 404
    expect(
      await einzeln("ressort_notiz.loeschen", {
        ressortId: (await ressort()).id,
        id: n.id,
        version: 2,
      }),
    ).toMatchObject({ status: "abgelehnt", code: "NICHT_GEFUNDEN" });
    expect(
      await einzeln("ressort_notiz.loeschen", {
        ressortId: r.id,
        id: n.id,
        version: 2,
      }),
    ).toMatchObject({ status: "ok" });

    const [x, y] = [await ressort(), await ressort()];
    await einzeln("ressort.reihenfolge", {
      eintraege: [
        { id: y.id, version: 1 },
        { id: x.id, version: 1 },
      ],
    });
    const stelle = async (id: string) =>
      (
        await db
          .select({ r: schema.ressort.reihenfolge })
          .from(schema.ressort)
          .where(eq(schema.ressort.id, id))
      )[0]!.r;
    expect(await stelle(y.id)).toBeLessThan(await stelle(x.id));

    const a = await aufgabe();
    const p = () => post(`/aufgaben/${a.id}/checkliste`, { text: "P" });
    const [p1, p2] = [await p(), await p()];
    await einzeln("checkpunkt.reihenfolge", {
      aufgabeId: a.id,
      eintraege: [
        { id: p2.id, version: 1 },
        { id: p1.id, version: 1 },
      ],
    });
    const lage = async (id: string) =>
      (
        await db
          .select({ r: schema.aufgabeCheckpunkt.reihenfolge })
          .from(schema.aufgabeCheckpunkt)
          .where(eq(schema.aufgabeCheckpunkt.id, id))
      )[0]!.r;
    expect(await lage(p2.id)).toBeLessThan(await lage(p1.id));
  });

  test("#520: Dauer, Empfänger Ressort und Gruppe, ruhig und gesehen über die Warteschlange", async () => {
    const t = await einzeln("traktandum.anlegen", {
      titel: "Mit Dauer",
      dauerMinuten: 20,
    });
    expect(t.status).toBe("ok");
    const [zeile] = await db
      .select()
      .from(schema.traktandum)
      .where(eq(schema.traktandum.id, t.ergebnis!.id));
    expect(zeile!.dauerMinuten).toBe(20);
    expect(
      await einzeln("traktandum.aendern", {
        id: t.ergebnis!.id,
        version: 1,
        dauerMinuten: 0,
      }),
    ).toMatchObject({ status: "abgelehnt", code: "UNGUELTIGE_EINGABE" });

    expect(
      await einzeln("pinnwand.anlegen", {
        titel: "X",
        empfaenger: { rollen: [], personen: [], ressortIds: [randomUUID()] },
      }),
    ).toMatchObject({ status: "abgelehnt", code: "RESSORT_UNBEKANNT" });
    expect(
      await einzeln("pinnwand.anlegen", {
        titel: "X",
        empfaenger: { rollen: [], personen: [], gruppeIds: [randomUUID()] },
      }),
    ).toMatchObject({ status: "abgelehnt", code: "GRUPPE_UNBEKANNT" });
    const r = await ressort();
    const b = await einzeln("pinnwand.anlegen", {
      titel: "Für ein Ressort",
      empfaenger: { rollen: [], personen: [], ressortIds: [r.id] },
    });
    expect(b.status).toBe("ok");
    const empfaenger = await db
      .select()
      .from(schema.pinnwandEmpfaenger)
      .where(eq(schema.pinnwandEmpfaenger.beitragId, b.ergebnis!.id));
    expect(empfaenger.map((e) => e.ressortId)).toEqual([r.id]);

    const ruhig = await einzeln("ressort.ruhig", {
      id: r.id,
      version: 1,
      ruhig: true,
    });
    expect(ruhig).toMatchObject({ status: "ok", ergebnis: { version: 2 } });
    const [rz] = await db
      .select()
      .from(schema.ressort)
      .where(eq(schema.ressort.id, r.id));
    expect(rz!.ruhig).toBe(true);

    // Gesehen: Das Team darf, ein unbekannter Beitrag ist 404, zweimal ist ohne Wirkung, ein geschlossenes Lager nimmt es nicht an
    const beitrag1 = (await einzeln("pinnwand.anlegen", { titel: "Gesehen" }))
      .ergebnis!.id;
    for (let i = 0; i < 2; i++) {
      expect(
        await einzeln(
          "pinnwand.gesehen",
          { beitragIds: [beitrag1] },
          konten.team,
        ),
      ).toMatchObject({ status: "ok" });
    }
    expect(
      await db
        .select()
        .from(schema.pinnwandGesehen)
        .where(eq(schema.pinnwandGesehen.beitragId, beitrag1)),
    ).toHaveLength(1);
    expect(
      await einzeln(
        "pinnwand.gesehen",
        { beitragIds: [randomUUID()] },
        konten.team,
      ),
    ).toMatchObject({ status: "abgelehnt", code: "NICHT_GEFUNDEN" });
    const zu = await sende(
      leiter(),
      [{ typ: "pinnwand.gesehen", nutzlast: { beitragIds: [beitrag1] } }],
      geschlossenId,
    );
    expect(zu.status).toBe(409);
  });

  test("eine abgelehnte Operation bricht die anderen der Anfrage nicht ab", async () => {
    const r = await sende(leiter(), [
      {
        typ: "hoeck.anlegen",
        nutzlast: { titel: "A", art: "team", datum: "2027-07-15" },
      },
      {
        typ: "traktandum.anlegen",
        nutzlast: { titel: "B", hoeckId: randomUUID() },
      },
      { typ: "beschluss.anlegen", nutzlast: { text: "C" } },
    ]);
    expect(r.ergebnisse.map((e) => e.status)).toEqual([
      "ok",
      "abgelehnt",
      "ok",
    ]);
  });

  test("ein Team-Konto darf die eigenen Aufgaben-Operationen weiter, aber keine der neuen", async () => {
    const t = await anfrage(leiter(), "POST", `${L()}/aufgaben`, {
      titel: "Eigene",
      verantwortlichPersonId: konten.team.id,
    });
    const r = await einzeln(
      "aufgabe.status",
      { id: t.body.id, version: 1, status: "laeuft" },
      konten.team,
    );
    expect(r.status).toBe("ok");
    expect(
      (
        await einzeln(
          "hoeck.anlegen",
          { titel: "X", art: "team", datum: "2027-07-12" },
          konten.team,
        )
      ).code,
    ).toBe("KEINE_BERECHTIGUNG");
  });

  test("ein Höck eines anderen Lagers ist unbekannt", async () => {
    const fremdesLager = await neuesLager();
    const h = await anfrage(leiter(), "POST", `${L(fremdesLager)}/hoecks`, {
      titel: "Fremd",
      art: "team",
      datum: "2027-07-12",
    });
    expect(
      await einzeln("hoeck.aendern", { id: h.body.id, version: 1, titel: "X" }),
    ).toMatchObject({ status: "abgelehnt", code: "NICHT_GEFUNDEN" });
    expect(
      await db
        .select()
        .from(schema.hoeck)
        .where(
          and(eq(schema.hoeck.id, h.body.id), eq(schema.hoeck.titel, "Fremd")),
        ),
    ).toHaveLength(1);
  });
});
