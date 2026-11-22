import { and, eq, getTableName, sql } from "drizzle-orm";
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
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeLagerZugriff } from "../../src/lager/policy.js";
import {
  listeSuchquellen,
  sucheImLager,
  SUCHE_TREFFER_MAX,
  suchWoerter,
  zweig,
} from "../../src/lager/suche.js";
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

const sqlClient = postgres(API_URL, { onnotice: () => {} });
const db = erstelleDb(sqlClient);
const auth = erstelleTestAuth(db);
const neueApp = () =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql: sqlClient,
    db,
    auth,
    seiten: ladeSeiten(),
  });
// Je Test eine neue App: Der Zähler des Rate-Limits liegt in der App
let app = neueApp();
const eigeneClients: postgres.Sql[] = [];
afterAll(async () => {
  await sqlClient.end();
  await Promise.all(eigeneClients.map((c) => c.end()));
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let andereLagerId: string;
let fremdLagerId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  app = neueApp();
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Ein Wort, das nirgends sonst vorkommt; alle Zeilen unten tragen es im Titel (oder in einem Kindeintrag)
const M = "Quarkstrudel";

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Suchlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const basis = (id = lagerId) => ({ lagerId: id, lagerSeq: 0 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function suche(
  konto: PersonaKonto,
  q: string,
  typ?: string,
  id = lagerId,
): Promise<Antwort> {
  const abfrage = new URLSearchParams({ q, ...(typ ? { typ } : {}) });
  const res = await app.request(`${L(id)}/suche?${abfrage}`, {
    headers: konto.headers,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
type Treffer = { typ: string; id: string; titel: string; auszug: string | null };
const treffer = async (konto: PersonaKonto, q = M, typ?: string) => {
  const a = await suche(konto, q, typ);
  expect(a.status).toBe(200);
  return (a.body.treffer as Treffer[]).map((t) => `${t.typ}|${t.titel}`).sort();
};

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) =>
        [p, await legePersonaAn(welt, KONTO_FUER[p] as Persona)] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await legeLager(welt.testabteilungId);
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  andereLagerId = await legeLager(welt.testabteilungId);
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  for (const id of [lagerId, geschlossenId, andereLagerId]) {
    // Die falsche Zeile der fremden Abteilung gibt nichts frei
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
      await db.insert(schema.lagerMitglied).values({
        lagerId: id,
        personId: konten[persona].id!,
        rolle,
      });
    }
  }
  await seed();
});

const team = () => konten.team.id!;
const leitung = () => konten.leitung.id!;

// Zeilen direkt in der Datenbank: eine lesbare und eine unlesbare je Quelle (nach Rolle, gelöscht, anderes Lager)
async function seed() {
  const jetzt = new Date();
  const vorbei = new Date(Date.now() - 86_400_000);
  // Aufgaben: eigene des Teams, eigene der Leitung, gelöschte, im anderen Lager; Treffer über Checkliste und Stichwort
  const aufgabe = async (
    titel: string,
    person: string,
    zusatz: Partial<typeof schema.aufgabe.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(schema.aufgabe)
        .values({
          ...basis(),
          titel,
          verantwortlichPersonId: person,
          ...zusatz,
        })
        .returning({ id: schema.aufgabe.id })
    )[0]!.id;
  await aufgabe(`${M} Aufgabe Team`, team());
  await aufgabe(`${M} Aufgabe Leitung`, leitung());
  await aufgabe(`${M} Aufgabe gelöscht`, team(), { geloeschtAm: jetzt });
  const mitListe = await aufgabe("Aufgabe Checkliste", team());
  await db.insert(schema.aufgabeCheckpunkt).values({
    ...basis(),
    aufgabeId: mitListe,
    text: `${M} abhaken`,
  });
  const geloeschtePunkte = await aufgabe("Aufgabe Gelöschter Punkt", team());
  await db.insert(schema.aufgabeCheckpunkt).values({
    ...basis(),
    aufgabeId: geloeschtePunkte,
    text: `${M} weg`,
    geloeschtAm: jetzt,
  });
  const mitStichwort = await aufgabe("Aufgabe Stichwort", leitung());
  await db.insert(schema.aufgabeStichwort).values({
    lagerId,
    aufgabeId: mitStichwort,
    stichwort: M.toLowerCase(),
  });
  await db.insert(schema.aufgabe).values({
    ...basis(andereLagerId),
    titel: `${M} Aufgabe anderes Lager`,
    verantwortlichPersonId: team(),
  });
  await db.insert(schema.aufgabe).values({
    ...basis(fremdLagerId),
    titel: `${M} Aufgabe fremde Abteilung`,
  });

  // Ressorts
  await db
    .insert(schema.ressort)
    .values({ ...basis(), kuerzel: "RQ", name: `${M} Ressort` });
  const [rn] = await db
    .insert(schema.ressort)
    .values({ ...basis(), kuerzel: "RN", name: "Ressort Notizen" })
    .returning({ id: schema.ressort.id });
  await db.insert(schema.ressortNotiz).values({
    ...basis(),
    ressortId: rn!.id,
    text: `${M} Notiz`,
  });

  // Höcks, Traktanden, Protokolle, Beschlüsse
  const hoeck = async (titel: string, art: "team" | "lagerleitung") =>
    (
      await db
        .insert(schema.hoeck)
        .values({ ...basis(), titel, art, datum: "2027-06-01" })
        .returning({ id: schema.hoeck.id })
    )[0]!.id;
  await hoeck(`${M} Höck Team`, "team");
  const hLeitung = await hoeck(`${M} Höck Leitung`, "lagerleitung");
  await db
    .insert(schema.traktandum)
    .values({ ...basis(), hoeckId: hLeitung, titel: `${M} Traktandum` });
  const datei = async (anzeigename: string) =>
    (
      await db
        .insert(schema.lagerDatei)
        .values({
          ...basis(),
          anzeigename,
          link: "https://cevi.sharepoint.com/sites/lager/Shared%20Documents/x.pdf",
        })
        .returning({ id: schema.lagerDatei.id })
    )[0]!.id;
  await db.insert(schema.protokoll).values({
    ...basis(),
    art: "notiz",
    titel: `${M} Protokoll offen`,
    datum: "2027-06-01",
    dateiId: await datei("Protokoll-offen.pdf"),
  });
  const [pLeitung] = await db
    .insert(schema.protokoll)
    .values({
      ...basis(),
      art: "sitzung",
      titel: `${M} Protokoll Leitungshöck`,
      datum: "2027-06-02",
      hoeckId: hLeitung,
      dateiId: await datei("Protokoll-leitung.pdf"),
    })
    .returning({ id: schema.protokoll.id });
  await db
    .insert(schema.beschluss)
    .values({ ...basis(), text: `${M} Beschluss offen` });
  await db.insert(schema.beschluss).values({
    ...basis(),
    text: `${M} Beschluss Leitungshöck`,
    protokollId: pLeitung!.id,
    hoeckId: hLeitung,
  });

  // Pinnwand: für alle, nur für die Leitung, gelöscht, abgelaufen
  const beitrag = async (
    titel: string,
    zusatz: Partial<typeof schema.pinnwandBeitrag.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(schema.pinnwandBeitrag)
        .values({ ...basis(), titel, ...zusatz })
        .returning({ id: schema.pinnwandBeitrag.id })
    )[0]!.id;
  await beitrag(`${M} Pinnwand alle`);
  const nurLeitung = await beitrag(`${M} Pinnwand Leitung`);
  await db
    .insert(schema.pinnwandEmpfaenger)
    .values({ lagerId, beitragId: nurLeitung, rolle: "leitung" });
  await beitrag(`${M} Pinnwand gelöscht`, { geloeschtAm: jetzt });
  await beitrag(`${M} Pinnwand abgelaufen`, { sichtbarBis: vorbei });

  // Eingang (anonym): nur wer alle Eingänge lesen darf
  await db.insert(schema.eingang).values({
    lagerId,
    art: "idee",
    text: `${M} Eingang`,
    anonym: true,
    rueckfragecodeHash: "hash-suche",
  });

  // Teilnehmende: der Cevi-Name ist nicht durchsuchbar
  await db.insert(schema.teilnehmer).values({
    ...basis(),
    vorname: M,
    nachname: "Teilnehmer",
    ceviName: "Kuckucksname",
  });

  // Zimmer: das eigene und ein fremdes (die Notiz ist nicht durchsuchbar)
  const zimmer = async (name: string, person: string) => {
    const [z] = await db
      .insert(schema.zimmer)
      .values({
        ...basis(),
        name,
        art: "zimmer",
        plaetze: 4,
        notiz: "Zimmernotizwort",
      })
      .returning({ id: schema.zimmer.id });
    await db
      .insert(schema.zimmerZuordnung)
      .values({ ...basis(), zimmerId: z!.id, personId: person });
  };
  await zimmer(`${M} Zimmer Team`, team());
  await zimmer(`${M} Zimmer Leitung`, leitung());

  // Fahrten: die eigene des Teams, eine fremde, eine mit gestrichener Mitfahrt des Teams
  const fahrt = (name: string, fahrer?: string) =>
    db
      .insert(schema.fahrt)
      .values({
        ...basis(),
        name,
        richtung: "hin",
        art: "auto",
        plaetze: 3,
        fahrerPersonId: fahrer,
      })
      .returning({ id: schema.fahrt.id });
  await fahrt(`${M} Fahrt Team`, team());
  await fahrt(`${M} Fahrt Leitung`, leitung());
  const [gestrichen] = await fahrt(`${M} Fahrt gestrichen`);
  await db.insert(schema.fahrtMitfahrer).values({
    ...basis(),
    fahrtId: gestrichen!.id,
    richtung: "hin",
    personId: team(),
    geloeschtAm: jetzt,
  });

  // Gruppe, Dienst, Einkauf, Meilenstein
  await db.insert(schema.gruppe).values({ ...basis(), name: `${M} Gruppe` });
  const [abschnitt] = await db
    .insert(schema.tagesabschnitt)
    .values({ ...basis(), name: "Morgen" })
    .returning({ id: schema.tagesabschnitt.id });
  await db.insert(schema.dienst).values({
    ...basis(),
    name: `${M} Dienst`,
    tagesabschnittId: abschnitt!.id,
  });
  await db.insert(schema.einkaufArtikel).values({
    ...basis(),
    name: `${M} Einkauf`,
    nameNorm: M.toLowerCase(),
    warengruppe: "brot",
  });
  await db.insert(schema.meilenstein).values({
    ...basis(),
    titel: `${M} Meilenstein`,
    datum: "2027-06-15",
  });

  // Packliste, Notfall, Infos: normal und nur für die Lagerleitung (Telefon ist nicht durchsuchbar)
  await db.insert(schema.packlistePunkt).values([
    { ...basis(), abschnitt: "Kleider", text: `${M} Packliste normal` },
    {
      ...basis(),
      abschnitt: "Kleider",
      text: `${M} Packliste geheim`,
      nurLagerleitung: true,
    },
  ]);
  await db.insert(schema.notfallKontakt).values({
    ...basis(),
    funktion: `${M} Notfall`,
    name: "Notfallperson",
    telefon: "+41790000001",
  });
  await db.insert(schema.infoAbschnitt).values([
    { ...basis(), titel: `${M} Info normal` },
    { ...basis(), titel: `${M} Info geheim`, nurLagerleitung: true },
  ]);

  // Dokumente: Team-sichtbar, nur intern, Treffer nur über das Stichwort; der Name der Datei ist nicht durchsuchbar
  const dok = async (
    titel: string,
    teamSichtbar: boolean,
    stichworte: string[] = [],
    dateiName = "Dok.pdf",
  ) =>
    db.insert(schema.dokument).values({
      ...basis(),
      titel,
      teamSichtbar,
      stichworte,
      dateiId: await datei(dateiName),
    });
  await dok(`${M} Dokument team`, true);
  await dok(`${M} Dokument intern`, false);
  await dok("Dokument Stichwort", false, [M.toLowerCase()]);
  await dok("Dokument nur Dateiname", true, [], "Schneeballschlacht.pdf");

  // Adressbuch (Telefon ist nicht durchsuchbar)
  await db.insert(schema.adressbuchKontakt).values({
    ...basis(),
    name: `${M} Kontakt`,
    funktion: "Metzger",
    telefon: "+41791112233",
  });
}

const LEITUNGSSICHT = [
  "aufgabe|Aufgabe Checkliste",
  "aufgabe|Aufgabe Stichwort",
  `aufgabe|${M} Aufgabe Leitung`,
  `aufgabe|${M} Aufgabe Team`,
  `beschluss|${M} Beschluss Leitungshöck`,
  `beschluss|${M} Beschluss offen`,
  `dienst|${M} Dienst`,
  "dokument|Dokument Stichwort",
  `dokument|${M} Dokument intern`,
  `dokument|${M} Dokument team`,
  `einkauf|${M} Einkauf`,
  `fahrt|${M} Fahrt Leitung`,
  `fahrt|${M} Fahrt Team`,
  `fahrt|${M} Fahrt gestrichen`,
  `gruppe|${M} Gruppe`,
  `hoeck|${M} Höck Leitung`,
  `hoeck|${M} Höck Team`,
  `info|${M} Info normal`,
  `meilenstein|${M} Meilenstein`,
  `notfall|${M} Notfall`,
  `packliste|${M} Packliste normal`,
  `pinnwand|${M} Pinnwand Leitung`,
  `pinnwand|${M} Pinnwand abgelaufen`,
  `pinnwand|${M} Pinnwand alle`,
  `protokoll|${M} Protokoll Leitungshöck`,
  `protokoll|${M} Protokoll offen`,
  "ressort|Ressort Notizen",
  `ressort|${M} Ressort`,
  `teilnehmer|${M} Teilnehmer`,
  `traktandum|${M} Traktandum`,
  `zimmer|${M} Zimmer Leitung`,
  `zimmer|${M} Zimmer Team`,
].sort();
// Die Lagerleitung sieht zusätzlich Vertrauliches, Eingang und Adressbuch
const LAGERLEITUNG = [
  ...LEITUNGSSICHT,
  `adressbuch|${M} Kontakt`,
  `eingang|${M} Eingang`,
  `info|${M} Info geheim`,
  `packliste|${M} Packliste geheim`,
].sort();
// Das Team: eigene Aufgaben, Team-Höcks, Pinnwand für alle im Fenster, eigenes Zimmer und eigene Fahrt, Team-Dokumente und die Listen für alle
const TEAM = [
  "aufgabe|Aufgabe Checkliste",
  `aufgabe|${M} Aufgabe Team`,
  `dienst|${M} Dienst`,
  `dokument|${M} Dokument team`,
  `fahrt|${M} Fahrt Team`,
  `gruppe|${M} Gruppe`,
  `hoeck|${M} Höck Team`,
  `info|${M} Info normal`,
  `meilenstein|${M} Meilenstein`,
  `notfall|${M} Notfall`,
  `packliste|${M} Packliste normal`,
  `pinnwand|${M} Pinnwand alle`,
  `teilnehmer|${M} Teilnehmer`,
  `zimmer|${M} Zimmer Team`,
].sort();
// Lesen: wie die Leitung, aber die Pinnwand nur im Fenster und für sich
const LESEN = LEITUNGSSICHT.filter(
  (t) => !t.startsWith("pinnwand|") || t.endsWith("alle"),
).sort();

describe("Suche je Lager-Persona: nur, was die Listen zeigen", () => {
  test("Lagerleitung und Abteilungsleitung finden alles, auch Vertrauliches, Eingang und Adressbuch", async () => {
    expect(await treffer(konten.lagerleitung)).toEqual(LAGERLEITUNG);
    expect(await treffer(konten.abteilungsleitung)).toEqual(LAGERLEITUNG);
  });

  test("Leitung: alles ausser Eingang, Adressbuch und Vertraulichem", async () => {
    expect(await treffer(konten.leitung)).toEqual(LEITUNGSSICHT);
  });

  test("Team: nur eigene Aufgaben, Team-Höcks, eigenes Zimmer und eigene Fahrt, Team-Dokumente; kein Adressbuch, Eingang, Protokoll, keine Ressorts", async () => {
    expect(await treffer(konten.team)).toEqual(TEAM);
  });

  test("Lesen: wie die Leitung, die Pinnwand nur im Fenster und für die Rolle", async () => {
    expect(await treffer(konten.lesen)).toEqual(LESEN);
  });

  test("Nicht-Mitglied, fremde Abteilung und ohne Login: 404 beziehungsweise 401", async () => {
    expect((await suche(konten.ohneMitgliedschaft, M)).status).toBe(404);
    expect((await suche(konten.fremdeAbteilung, M)).status).toBe(404);
    expect((await suche(konten.ohneLogin, M)).status).toBe(401);
    // Ein Lager der fremden Abteilung ist für die eigene Lagerleitung 404, auch mit einem Treffer dort
    expect((await suche(konten.lagerleitung, M, undefined, fremdLagerId)).status).toBe(
      404,
    );
  });

  test("Zeilen anderer Lager, gelöschte Zeilen und gelöschte Kinder zählen nicht", async () => {
    const alle = await treffer(konten.lagerleitung);
    expect(alle.join("\n")).not.toMatch(/anderes Lager|fremde Abteilung|gelöscht|Gelöschter/);
    // Im abgeschlossenen Lager (leer) findet die Suche nichts aus diesem Lager
    const a = await suche(konten.lagerleitung, M, undefined, geschlossenId);
    expect(a.status).toBe(200);
    expect(a.body.treffer).toEqual([]);
  });

  test("Eine gestrichene Mitfahrt gibt die Fahrt für das Team nicht frei (die Liste zeigt sie auch nicht)", async () => {
    expect(await treffer(konten.team, M, "fahrt")).toEqual([
      `fahrt|${M} Fahrt Team`,
    ]);
  });

  test("Mit eingestelltem Recht: das Team findet Protokolle, aber nie die eines Höcks der Lagerleitung", async () => {
    await db
      .insert(schema.lagerRolleRecht)
      .values({
        lagerId,
        rolle: "team",
        recht: "protokolle.lesen",
        erlaubt: true,
      });
    try {
      expect(await treffer(konten.team, M, "protokoll")).toEqual([
        `protokoll|${M} Protokoll offen`,
      ]);
      expect(await treffer(konten.team, M, "beschluss")).toEqual([
        `beschluss|${M} Beschluss offen`,
      ]);
    } finally {
      await db
        .delete(schema.lagerRolleRecht)
        .where(
          and(
            eq(schema.lagerRolleRecht.lagerId, lagerId),
            eq(schema.lagerRolleRecht.recht, "protokolle.lesen"),
          ),
        );
    }
    expect(await treffer(konten.team, M, "protokoll")).toEqual([]);
  });

  test("Ohne das Recht gibt es keine Treffer der Quelle (Adressbuch gesperrt für die Leitung, freigegeben für das Team nur mit Recht)", async () => {
    expect(await treffer(konten.leitung, M, "adressbuch")).toEqual([]);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId,
      rolle: "leitung",
      recht: "adressbuch.lesen",
      erlaubt: true,
    });
    try {
      expect(await treffer(konten.leitung, M, "adressbuch")).toEqual([
        `adressbuch|${M} Kontakt`,
      ]);
    } finally {
      await db
        .delete(schema.lagerRolleRecht)
        .where(
          and(
            eq(schema.lagerRolleRecht.lagerId, lagerId),
            eq(schema.lagerRolleRecht.recht, "adressbuch.lesen"),
          ),
        );
    }
  });

  test("Die Suche ist eine Teilmenge der Listen: Aufgaben, Dokumente, Zimmer, Höcks", async () => {
    const listen: [string, string][] = [
      ["aufgaben", "aufgabe"],
      ["dokumente", "dokument"],
      ["zimmer", "zimmer"],
      ["hoecks", "hoeck"],
    ];
    for (const persona of ["leitung", "team", "lesen"] as const) {
      const konto = konten[persona];
      for (const [pfad, typ] of listen) {
        const res = await app.request(`${L()}/${pfad}?limit=100`, {
          headers: konto.headers,
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids = new Set(
          (Object.values(body).find(Array.isArray) as { id: string }[]).map(
            (z) => z.id,
          ),
        );
        const a = await suche(konto, M, typ);
        for (const t of a.body.treffer as Treffer[]) {
          expect(ids.has(t.id), `${persona} ${typ} ${t.titel}`).toBe(true);
        }
      }
    }
  });
});

describe("Was nicht durchsuchbar ist", () => {
  test("Dateiname, Telefon, Cevi-Name und Notiz des Zimmers finden nichts", async () => {
    for (const q of [
      "Schneeballschlacht",
      "41791112233",
      "Kuckucksname",
      "Zimmernotizwort",
      "Schreinerei",
    ]) {
      expect(await treffer(konten.lagerleitung, q), q).toEqual([]);
    }
    // Die Funktion «Metzger» steht im Adressbuch (nur Lagerleitung)
    expect(await treffer(konten.lagerleitung, "Metzger")).toEqual([
      `adressbuch|${M} Kontakt`,
    ]);
  });
});

describe("Treffer, Tippfehler und Grenzen", () => {
  test("Wortanfang, Stamm, Gross- und Kleinschreibung und Tippfehler treffen", async () => {
    const soll = [`pinnwand|${M} Pinnwand alle`];
    for (const q of ["quarkstrudel pinnwand alle", "Quarkstru Pinnwand al"]) {
      expect(await treffer(konten.lesen, q, "pinnwand"), q).toEqual(soll);
    }
    // Tippfehler: ein Buchstabe fehlt, einer zu viel, zwei vertauscht
    for (const q of ["Quarkstrudl", "Quarkstrudell", "Qaurkstrudel"]) {
      expect(
        (await treffer(konten.lesen, q, "gruppe")).length,
        q,
      ).toBeGreaterThan(0);
    }
    // Der Wortstamm: Mehrzahl und Fall
    expect(await treffer(konten.lesen, "Quarkstrudel Gruppen", "gruppe")).toEqual(
      [`gruppe|${M} Gruppe`],
    );
    // Ein anderes Wort trifft nicht
    expect(await treffer(konten.lesen, "Himbeertorte")).toEqual([]);
  });

  test("Der Ausschnitt stammt aus der lesbaren Zeile und zeigt den Fund", async () => {
    const [b] = await db
      .insert(schema.pinnwandBeitrag)
      .values({
        ...basis(),
        titel: "Ausschnitt-Test",
        text: `${"Vorspann ".repeat(30)} Rosinenbroetchen gibt es ${"Nachspann ".repeat(30)}`,
      })
      .returning({ id: schema.pinnwandBeitrag.id });
    const a = await suche(konten.team, "Rosinenbroetchen", "pinnwand");
    const t = (a.body.treffer as Treffer[]).find((x) => x.id === b!.id)!;
    expect(t.auszug).toContain("Rosinenbroetchen");
    expect(t.auszug!.length).toBeLessThanOrEqual(150);
    // Ein Treffer im Titel allein hat keinen Ausschnitt
    const nurTitel = await suche(konten.team, "Ausschnitt-Test", "pinnwand");
    expect(
      (nurTitel.body.treffer as Treffer[]).find((x) => x.id === b!.id),
    ).toBeDefined();
  });

  test("Der Typ schränkt ein; ein unbekannter Typ ist ein Fehler", async () => {
    expect(await treffer(konten.lagerleitung, M, "gruppe")).toEqual([
      `gruppe|${M} Gruppe`,
    ]);
    expect((await suche(konten.lagerleitung, M, "gibtesnicht")).status).toBe(
      400,
    );
  });

  test("Eingabe: zu kurz, zu lang, Steuerzeichen, unbekannter Parameter, kein Wort", async () => {
    expect((await suche(konten.lagerleitung, "a")).status).toBe(400);
    expect((await suche(konten.lagerleitung, "a".repeat(101))).status).toBe(400);
    expect((await suche(konten.lagerleitung, "a".repeat(100))).status).toBe(200);
    expect((await suche(konten.lagerleitung, "ab\u0000cd")).status).toBe(400);
    const res = await app.request(`${L()}/suche?q=zelt&nach=1`, {
      headers: konten.lagerleitung.headers,
    });
    expect(res.status).toBe(400);
    const ohne = await app.request(`${L()}/suche`, {
      headers: konten.lagerleitung.headers,
    });
    expect(ohne.status).toBe(400);
    // Nur Satzzeichen: keine Wörter, leere Antwort
    const a = await suche(konten.lagerleitung, "?!?!");
    expect(a.status).toBe(200);
    expect(a.body.treffer).toEqual([]);
  });

  test("Syntax der Datenbank-Suche wird zu Text: Anführungszeichen, Operatoren, Klammern", async () => {
    for (const q of [`' & | ! ( ) :* <->`, `"a" or "b"`, `Quark'strudel`, "x:*y", "ab\\cd"]) {
      const a = await suche(konten.lagerleitung, q);
      expect(a.status, q).toBe(200);
    }
    expect(suchWoerter(`Qu'ark & strudel:*`)).toEqual(["Qu", "ark", "strudel"]);
  });

  test("Höchstens 50 Treffer", async () => {
    const wort = "Zeltbahnenlager";
    await db.insert(schema.gruppe).values(
      Array.from({ length: SUCHE_TREFFER_MAX + 10 }, (_, i) => ({
        ...basis(),
        name: `${wort} ${i}`,
      })),
    );
    const a = await suche(konten.lagerleitung, wort);
    expect(a.status).toBe(200);
    expect(a.body.treffer).toHaveLength(SUCHE_TREFFER_MAX);
  });
});

describe("Audit, Datenbanklast, Index", () => {
  test("Treffer aus dem Adressbuch erzeugen einen Audit-Eintrag nur mit Anzahl, andere Suchen keinen", async () => {
    const zaehle = async () =>
      db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.aktion, "lager_adressbuch_gelesen"),
            eq(schema.auditLog.zielId, lagerId),
            eq(schema.auditLog.akteurId, konten.lagerleitung.id!),
          ),
        );
    const vorher = (await zaehle()).length;
    await suche(konten.lagerleitung, "Gruppe", "gruppe");
    expect((await zaehle()).length).toBe(vorher);
    await suche(konten.lagerleitung, "Metzger");
    const nachher = await zaehle();
    expect(nachher.length).toBe(vorher + 1);
    const letzter = nachher[nachher.length - 1]!;
    expect(letzter.details).toEqual({ anzahl: 1 });
    expect(JSON.stringify(letzter)).not.toContain("Metzger");
  });

  test("Eine Suche ist eine UNION-ALL-Abfrage über alle offenen Quellen, nie eine je Zeile", async () => {
    const abfragen: string[] = [];
    const client = postgres(API_URL, {
      onnotice: () => {},
      debug: (_c, q) => {
        abfragen.push(q);
      },
    });
    eigeneClients.push(client);
    const eigene = erstelleDb(client);
    // Ohne HTTP: dieselbe Funktion wie die Route
    const person = {
      id: konten.lagerleitung.id!,
      abteilungId: welt.testabteilungId,
      admin: false,
    };
    const zugriff = (await ladeLagerZugriff(eigene, person, lagerId))!;
    abfragen.length = 0;
    const t = await sucheImLager(eigene, zugriff, M);
    expect(t.length).toBe(LAGERLEITUNG.length);
    const select = abfragen.filter((q) => /union all/i.test(q));
    expect(select).toHaveLength(1);
    // Begin, Lesemodus, Schwellenwert, Suche, Commit: nichts je Zeile
    expect(abfragen.length).toBeLessThanOrEqual(5);
  });

  test("Suche benutzt den Index: Der Ausdruck jeder Quelle ist wörtlich der Ausdruck ihrer beiden GIN-Indizes (Migration 0097)", async () => {
    const person = {
      id: konten.lagerleitung.id!,
      abteilungId: welt.testabteilungId,
      admin: false,
    };
    const z = (await ladeLagerZugriff(db, person, lagerId))!;
    const quellen = listeSuchquellen();
    expect(quellen.length).toBeGreaterThan(20);
    const indexdef = async (name: string) => {
      const zeilen = await db.execute<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where indexname = ${name}`,
      );
      expect(zeilen.length, name).toBe(1);
      return zeilen[0]!.indexdef;
    };
    for (const q of quellen) {
      const name = getTableName(q.tabelle);
      // Der Plan druckt den Ausdruck der Abfrage so, wie pg_indexes den des Index druckt (mit dem Tabellennamen vor den Spalten, den wir wegnehmen)
      const zeilen = await db.execute<{ "QUERY PLAN": string }>(
        sql`explain ${zweig(q, db, z, ["quark"])}`,
      );
      const plan = [...zeilen]
        .map((r) => r["QUERY PLAN"])
        .join("\n")
        .replaceAll(`${name}.`, "");
      const abfrage = /to_tsvector\('german'::regconfig, (.+?)\) @@ /.exec(plan);
      expect(abfrage, `${q.typ} ${name}: kein Suchausdruck im Plan`).not.toBeNull();
      const ausdruck = abfrage![1]!;
      expect(await indexdef(`${name}_suche_fts_idx`), `${q.typ} ${name}`).toContain(
        `USING gin (to_tsvector('german'::regconfig, ${ausdruck}))`,
      );
      // Ein Ausdruck aus einem einzigen Aufruf druckt Postgres ohne zweite Klammer
      const trgm = await indexdef(`${name}_suche_trgm_idx`);
      expect([
        `USING gin (${ausdruck} gin_trgm_ops)`,
        `USING gin ((${ausdruck}) gin_trgm_ops)`,
      ].some((teil) => trgm.includes(teil)), `${q.typ} ${name}: ${trgm}`).toBe(true);
    }
  });
});

describe("Rate-Limit je Konto (SR-71)", () => {
  test("Nach 30 Suchen in einer Minute folgt 429; ein anderes Konto ist nicht betroffen", async () => {
    let status = 200;
    let n = 0;
    while (status === 200 && n < 40) {
      status = (await suche(konten.team, "Gruppe", "gruppe")).status;
      n++;
    }
    expect(status).toBe(429);
    expect(n).toBeLessThanOrEqual(31);
    expect((await suche(konten.lesen, "Gruppe", "gruppe")).status).toBe(200);
  });
});
