import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { synchronisiere } from "../../src/kalender/sync.js";
import { API_URL } from "../hilfen/datenbank.js";

const JETZT = new Date();
const TOKEN = "zugangstoken-geheim-1";
const BESCHREIBUNG =
  "Wurst & Brot mitnehmen\nFragen an leitung@example.org\nAnmeldung: Formular (https://example.org/anmeldung)";

// Erwartete Programme nach dem ersten Lauf, sortiert nach Titel und Beginn (Zeitpunkte, wie Postgres sie als Text liefert: UTC)
const ERWARTET_LAUF_1 = [
  {
    titel: "Gruppenstunde",
    google_serie: "gruppenstunde001",
    ganztaegig: false,
    beginn: "2027-09-04 12:00:00+00",
    ende: "2027-09-04 14:00:00+00",
    tag_von: null,
    tag_bis: null,
    google_ort: "Kirchgemeindehaus",
    google_beschreibung: null,
  },
  {
    titel: "Gruppenstunde",
    google_serie: "gruppenstunde001",
    ganztaegig: false,
    beginn: "2027-09-11 12:00:00+00",
    ende: "2027-09-11 14:00:00+00",
    tag_von: null,
    tag_bis: null,
    google_ort: "Kirchgemeindehaus",
    google_beschreibung: null,
  },
  {
    titel: "Gruppenstunde",
    google_serie: "gruppenstunde001",
    ganztaegig: false,
    beginn: "2027-09-18 12:00:00+00",
    ende: "2027-09-18 14:00:00+00",
    tag_von: null,
    tag_bis: null,
    google_ort: "Kirchgemeindehaus",
    google_beschreibung: null,
  },
  {
    titel: "Herbstlager",
    google_serie: null,
    ganztaegig: true,
    beginn: null,
    ende: null,
    tag_von: "2027-10-29",
    tag_bis: "2027-10-31",
    google_ort: null,
    google_beschreibung: null,
  },
  {
    titel: "Herbstweekend",
    google_serie: null,
    ganztaegig: false,
    beginn: "2027-10-30 08:00:00+00",
    ende: "2027-10-31 15:00:00+00",
    tag_von: null,
    tag_bis: null,
    google_ort: null,
    google_beschreibung: null,
  },
  {
    titel: "Leitertreffen",
    google_serie: null,
    ganztaegig: false,
    beginn: "2027-09-08 17:30:00+00",
    ende: "2027-09-08 19:00:00+00",
    tag_von: null,
    tag_bis: null,
    google_ort: null,
    google_beschreibung: null,
  },
  {
    titel: "Sommerlager",
    google_serie: null,
    ganztaegig: true,
    beginn: null,
    ende: null,
    tag_von: "2027-07-30",
    tag_bis: "2027-08-02",
    google_ort: null,
    google_beschreibung: null,
  },
  {
    titel: "Waldtag",
    google_serie: null,
    ganztaegig: false,
    beginn: "2027-09-25 11:30:00+00",
    ende: "2027-09-25 15:00:00+00",
    tag_von: null,
    tag_bis: null,
    google_ort: "Waldhütte",
    google_beschreibung: BESCHREIBUNG,
  },
];

// Feste Zeitzone der Sitzung: Die Erwartungstabelle vergleicht timestamptz als Text in UTC
const sql = postgres(API_URL, { connection: { TimeZone: "UTC" } });
afterAll(() => sql.end());

const lies = async (datei: string) =>
  JSON.parse(
    await readFile(
      new URL(`./aufzeichnungen/${datei}`, import.meta.url),
      "utf8",
    ),
  ) as unknown[];
const lauf1 = await lies("erster-lauf.json");
const lauf2 = await lies("zweiter-lauf.json");
const vorher = await lies("serie-vorher.json");
const geteilt = await lies("serie-geteilt.json");

let schluesselDatei: string;
beforeAll(async () => {
  const paar = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  schluesselDatei = join(await mkdtemp(join(tmpdir(), "kalender-")), "s.json");
  await writeFile(
    schluesselDatei,
    JSON.stringify({
      client_email: "sync@example.org",
      private_key: paar.privateKey,
    }),
  );
});

// Eigene Abteilung samt Stufe pro Test; die Kalender-ID trägt nur sie, und afterEach räumt sie weg
let abteilungId: string;
let stufeId: string;
let kalenderId: string;
let ausgabe: MockInstance<typeof console.log>;

beforeEach(async () => {
  kalenderId = `${randomUUID()}@example.org`;
  const [abteilung] = await sql`
    insert into abteilung (name, google_kalender_id)
    values ('Sync-Testabteilung', ${kalenderId}) returning id`;
  abteilungId = abteilung.id as string;
  const [stufe] = await sql`
    insert into stufe (abteilung_id, name, kuerzel, reihenfolge)
    values (${abteilungId}, 'Teststufe', 'TS', 1) returning id`;
  stufeId = stufe.id as string;
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  ausgabe.mockRestore();
  vi.unstubAllGlobals();
  await sql`update abteilung set google_kalender_id = null where id = ${abteilungId}`;
});

// Bedient Token- und Kalenderanfragen; jede fremde URL wirft, und die Seiten kommen der Reihe nach aus der Warteschlange
function stubGoogle(seiten: (unknown | Response)[]) {
  const warteschlange = [...seiten];
  const stub = vi.fn(async (eingabe: unknown) => {
    const url = new URL(String(eingabe));
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: TOKEN });
    }
    if (
      url.origin === "https://www.googleapis.com" &&
      url.pathname ===
        `/calendar/v3/calendars/${encodeURIComponent(kalenderId)}/events`
    ) {
      const seite = warteschlange.shift();
      if (seite === undefined) throw new Error("keine Seite mehr im Test");
      return seite instanceof Response ? seite : Response.json(seite);
    }
    throw new Error("unerwartete URL im Test");
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

const programme = () => sql`
  select google_event_id, google_serie, titel, ganztaegig,
         beginn::text as beginn, ende::text as ende, tag_von::text as tag_von, tag_bis::text as tag_bis,
         google_ort, google_beschreibung, status, sichtbarkeit, id,
         treffpunkt, schluss_ort, schluss_zeit::text as schluss_zeit, mitnehmen, info_eltern,
         geaendert_von, geaendert_am
  from programm where abteilung_id = ${abteilungId} order by titel, beginn`;

const eigeneAbteilung = async () =>
  (
    await sql`select sync_ok_am, sync_fehler from abteilung where id = ${abteilungId}`
  )[0];

test("erster Lauf: Alle Termine aus der Aufzeichnung landen intern, aktiv und ohne Stufe in der Datenbank (fail-closed), Private und Titellose nicht", async () => {
  stubGoogle(lauf1);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei,
      jetzt: JETZT,
    }),
  ).toBe("fertig");

  const zeilen = await programme();
  expect(
    zeilen.map((z) => ({
      titel: z.titel,
      google_serie: z.google_serie,
      ganztaegig: z.ganztaegig,
      beginn: z.beginn,
      ende: z.ende,
      tag_von: z.tag_von,
      tag_bis: z.tag_bis,
      google_ort: z.google_ort,
      google_beschreibung: z.google_beschreibung,
    })),
  ).toEqual(ERWARTET_LAUF_1);
  for (const zeile of zeilen) {
    expect(zeile).toMatchObject({
      status: "aktiv",
      sichtbarkeit: "intern",
      treffpunkt: null,
      schluss_ort: null,
      schluss_zeit: null,
      mitnehmen: null,
      info_eltern: null,
      geaendert_von: null,
      geaendert_am: null,
    });
  }
  // Fail-closed, Bedrohung 8: keine Zuordnung zu einer Stufe, bis SL oder Admin sie setzen
  expect(
    await sql`select ps.* from programm_stufe ps join programm p on p.id = ps.programm_id where p.abteilung_id = ${abteilungId}`,
  ).toEqual([]);

  const abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBeNull();
  expect(
    Math.abs((abteilung.sync_ok_am as Date).getTime() - Date.now()),
  ).toBeLessThan(60_000);
  // Erfolg bleibt still
  expect(ausgabe).not.toHaveBeenCalled();
});

test("zweiter Lauf: Änderungen kommen an, Absagen setzen nur den Status, und Zuordnung samt Ergänzungen bleiben", async () => {
  stubGoogle([...lauf1, ...lauf2]);
  const starte = () =>
    synchronisiere({ datenbankUrl: API_URL, schluesselDatei, jetzt: JETZT });
  expect(await starte()).toBe("fertig");

  // Wie eine SL nach dem ersten Lauf: Stufe zuordnen, Sichtbarkeit öffnen, Treffpunkt ergänzen
  const [waldtag] = await sql`
    select id from programm where abteilung_id = ${abteilungId} and google_event_id = '0aldtag000000001'`;
  await sql`update programm set sichtbarkeit = 'eltern', treffpunkt = 'Dorfbrunnen' where id = ${waldtag.id}`;
  await sql`insert into programm_stufe (programm_id, stufe_id) values (${waldtag.id}, ${stufeId})`;

  expect(await starte()).toBe("fertig");
  const zeilen = await programme();

  // Geändert (Titel, Zeit, Ort): aktualisiert, Zuordnung und Ergänzungen unberührt
  const feuer = zeilen.find((z) => z.google_event_id === "0aldtag000000001");
  expect(feuer).toMatchObject({
    titel: "Waldtag mit Feuer",
    beginn: "2027-09-25 12:00:00+00",
    ende: "2027-09-25 15:30:00+00",
    google_ort: "Bahnhof",
    status: "aktiv",
    sichtbarkeit: "eltern",
    treffpunkt: "Dorfbrunnen",
  });
  expect(
    await sql`select stufe_id from programm_stufe where programm_id = ${waldtag.id}`,
  ).toEqual([{ stufe_id: stufeId }]);

  // Abgesagte Instanz über Serie und Beginn gefunden: nur der Status ändert sich
  const abgesagteInstanz = zeilen.find(
    (z) =>
      z.google_serie === "gruppenstunde001" &&
      z.beginn === "2027-09-11 12:00:00+00",
  );
  expect(abgesagteInstanz).toMatchObject({
    titel: "Gruppenstunde",
    status: "abgesagt",
    google_ort: "Kirchgemeindehaus",
  });
  for (const beginn of ["2027-09-04 12:00:00+00", "2027-09-18 12:00:00+00"]) {
    expect(
      zeilen.find(
        (z) => z.google_serie === "gruppenstunde001" && z.beginn === beginn,
      ),
    ).toMatchObject({ status: "aktiv" });
  }
  expect(zeilen.find((z) => z.titel === "Leitertreffen")).toMatchObject({
    status: "abgesagt",
  });

  // Neuer Termin: wieder fail-closed
  expect(zeilen.find((z) => z.titel === "Elternabend")).toMatchObject({
    beginn: "2027-09-17 17:30:00+00",
    status: "aktiv",
    sichtbarkeit: "intern",
  });

  // Die Absage eines nie übernommenen (privaten) Termins trifft nichts
  expect(zeilen.map((z) => z.google_event_id)).not.toContain(
    "privat0000000001",
  );
  expect(zeilen).toHaveLength(ERWARTET_LAUF_1.length + 1);
  expect(ausgabe).not.toHaveBeenCalled();
});

test("zwei gleichzeitige Läufe: Der zweite meldet «gesperrt», ohne eine einzige Anfrage an Google", async () => {
  let gibToken!: (antwort: Response) => void;
  const haengt = new Promise<Response>((loese) => (gibToken = loese));
  const seiten = [...lauf1];
  const stub = vi.fn(async (eingabe: unknown) => {
    const url = new URL(String(eingabe));
    if (url.href === "https://oauth2.googleapis.com/token") return haengt;
    return Response.json(seiten.shift());
  });
  vi.stubGlobal("fetch", stub);

  const laufA = synchronisiere({
    datenbankUrl: API_URL,
    schluesselDatei,
    jetzt: JETZT,
  });
  // Lauf A hält die Sperre und hängt in der Token-Anfrage
  await vi.waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei,
      jetzt: JETZT,
    }),
  ).toBe("gesperrt");
  expect(stub).toHaveBeenCalledTimes(1);

  gibToken(Response.json({ access_token: TOKEN }));
  expect(await laufA).toBe("fertig");
  expect((await eigeneAbteilung()).sync_fehler).toBeNull();
  // «gesperrt» bleibt still
  expect(ausgabe).not.toHaveBeenCalled();
});

test("HTTP 500: Die Abteilung trägt den festen Fehlertext, sync_ok_am bleibt stehen, und der nächste Lauf bekommt die Sperre", async () => {
  const vorhin = new Date(JETZT.getTime() - 5 * 60 * 1000);
  await sql`update abteilung set sync_ok_am = ${vorhin} where id = ${abteilungId}`;

  stubGoogle([new Response("kaputt", { status: 500 })]);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei,
      jetzt: JETZT,
    }),
  ).toBe("fertig");
  let abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBe("Google antwortet mit HTTP 500");
  expect((abteilung.sync_ok_am as Date).getTime()).toBe(vorhin.getTime());
  expect(ausgabe).toHaveBeenCalledTimes(1);
  expect(JSON.parse(ausgabe.mock.calls[0][0] as string)).toEqual({
    zeit: expect.any(String),
    ereignis: "kalender",
    abteilungId,
    fehler: "Google antwortet mit HTTP 500",
  });

  // Die Sperre ist wieder frei: Der nächste Lauf arbeitet und räumt den Fehler weg
  stubGoogle(lauf1);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei,
      jetzt: JETZT,
    }),
  ).toBe("fertig");
  abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBeNull();
  expect(
    Math.abs((abteilung.sync_ok_am as Date).getTime() - Date.now()),
  ).toBeLessThan(60_000);
});

test("ein Fehler aus der Datenbank: «Unerwarteter Fehler» mit Code, nie Titel, Kalender-ID oder Token", async () => {
  const vorhin = new Date(JETZT.getTime() - 5 * 60 * 1000);
  await sql`update abteilung set sync_ok_am = ${vorhin} where id = ${abteilungId}`;
  // NUL lehnt Postgres mit 22021 ab; der geplante Titel darf nirgends auftauchen
  stubGoogle([
    {
      items: [
        {
          id: "nul0000000000001",
          summary: "Max Muster\u0000",
          start: { dateTime: "2027-09-04T14:00:00+02:00" },
          end: { dateTime: "2027-09-04T16:00:00+02:00" },
        },
      ],
    },
  ]);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei,
      jetzt: JETZT,
    }),
  ).toBe("fertig");

  const abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBe("Unerwarteter Fehler");
  expect((abteilung.sync_ok_am as Date).getTime()).toBe(vorhin.getTime());
  expect(ausgabe).toHaveBeenCalledTimes(1);
  const zeile = ausgabe.mock.calls[0][0] as string;
  for (const verboten of ["max muster", kalenderId, TOKEN.toLowerCase()]) {
    expect(zeile.toLowerCase()).not.toContain(verboten);
  }
  expect(JSON.parse(zeile)).toEqual({
    zeit: expect.any(String),
    ereignis: "kalender",
    abteilungId,
    fehler: "Unerwarteter Fehler",
    code: "22021",
  });
});

test("ohne Schlüsseldatei trägt jede Abteilung mit Kalender den Schlüsselfehler, und kein fetch läuft", async () => {
  const stub = vi.fn(async () => {
    throw new Error("unerwartete Anfrage im Test");
  });
  vi.stubGlobal("fetch", stub);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei: undefined,
      jetzt: JETZT,
    }),
  ).toBe("fertig");
  const abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBe(
    "Schlüssel für Google fehlt oder ist ungültig",
  );
  expect(abteilung.sync_ok_am).toBeNull();
  expect(stub).not.toHaveBeenCalled();
  expect(ausgabe).toHaveBeenCalledTimes(1);
});

test("mit zwei Seiten kommen die Termine beider Seiten an", async () => {
  stubGoogle(await lies("zwei-seiten.json"));
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      schluesselDatei,
      jetzt: JETZT,
    }),
  ).toBe("fertig");
  const zeilen = await programme();
  expect(zeilen.map((z) => z.titel)).toEqual([
    "Termin der ersten Seite",
    "Termin der zweiten Seite",
  ]);
});

// Serien «ab diesem Termin»: Ein fester Zeitpunkt vor dem ersten Termin der Aufzeichnungen, damit die Tests nicht ablaufen
const JETZT_SERIE = new Date("2027-09-30T10:00:00Z");
const A = "gruppenstunde002";
const A2 = `${A}_R20271009T113000`;
const B = "atelier0000000b1";
const B2 = `${B}_R20271014T160000`;

// «vorher» ist der Beginn nach dem ersten Lauf (null: neuer Termin); der Rest gilt nach dem Lauf mit «serie-geteilt.json».
// A wird übernommen (andere Zeit, gleiche Zeile), B hat keinen Nachfolger am gleichen Tag und geht zu «Prüfen»
const ERWARTET_GETEILT = [
  {
    titel: "Gruppenstunde",
    vorher: "2027-10-02 12:00:00+00",
    beginn: "2027-10-02 12:00:00+00",
    event: `${A}_20271002T120000Z`,
    status: "aktiv",
  },
  {
    titel: "Gruppenstunde",
    vorher: "2027-10-09 12:00:00+00",
    beginn: "2027-10-09 11:30:00+00",
    event: `${A2}_20271009T113000Z`,
    status: "aktiv",
  },
  {
    titel: "Gruppenstunde",
    vorher: "2027-10-16 12:00:00+00",
    beginn: "2027-10-16 11:30:00+00",
    event: `${A2}_20271016T113000Z`,
    status: "aktiv",
  },
  {
    titel: "Werkstatt",
    vorher: "2027-10-06 16:00:00+00",
    beginn: "2027-10-06 16:00:00+00",
    event: `${B}_20271006T160000Z`,
    status: "aktiv",
  },
  {
    titel: "Werkstatt",
    vorher: "2027-10-13 16:00:00+00",
    beginn: "2027-10-13 16:00:00+00",
    event: `${B}_20271013T160000Z`,
    status: "pruefen",
  },
  {
    titel: "Werkstatt",
    vorher: "2027-10-20 16:00:00+00",
    beginn: "2027-10-20 16:00:00+00",
    event: `${B}_20271020T160000Z`,
    status: "pruefen",
  },
  {
    titel: "Werkstatt",
    vorher: null,
    beginn: "2027-10-14 16:00:00+00",
    event: `${B2}_20271014T160000Z`,
    status: "aktiv",
  },
  {
    titel: "Werkstatt",
    vorher: null,
    beginn: "2027-10-21 16:00:00+00",
    event: `${B2}_20271021T160000Z`,
    status: "aktiv",
  },
];
// Diese vier Programme bekommen nach dem ersten Lauf Zuordnung, Sichtbarkeit, Treffpunkt und eine Leitungsanmeldung
const MIT_ERGAENZUNG = [
  "Gruppenstunde|2027-10-09 12:00:00+00",
  "Gruppenstunde|2027-10-16 12:00:00+00",
  "Werkstatt|2027-10-13 16:00:00+00",
  "Werkstatt|2027-10-20 16:00:00+00",
];

const starteSerie = (jetzt = JETZT_SERIE) =>
  synchronisiere({ datenbankUrl: API_URL, schluesselDatei, jetzt });
const schluessel = (z: Record<string, unknown>) => `${z.titel}|${z.beginn}`;
const finde = async (titel: string, beginn: string) => {
  const zeile = (await programme()).find(
    (z) => z.titel === titel && z.beginn === beginn,
  );
  if (!zeile) throw new Error(`Programm fehlt: ${titel} ${beginn}`);
  return zeile;
};
const anhang = async (programmId: string) => ({
  stufen:
    await sql`select stufe_id from programm_stufe where programm_id = ${programmId}`,
  leitung:
    await sql`select user_id, status from leitung_anmeldung where programm_id = ${programmId}`,
});

// Erster Lauf mit «serie-vorher.json» (der Stub muss die Seite bereithalten), dann Ergänzungen wie von einer SL
async function ersterSerienLauf() {
  expect(await starteSerie()).toBe("fertig");
  const [person] = await sql`
    insert into "user" (name, email, abteilung_id)
    values ('Leitung Test', ${`${randomUUID()}@example.org`}, ${abteilungId}) returning id`;
  const ids = new Map<string, string>();
  for (const z of await programme()) {
    ids.set(schluessel(z), z.id as string);
    if (!MIT_ERGAENZUNG.includes(schluessel(z))) continue;
    await sql`update programm set sichtbarkeit = 'eltern', treffpunkt = 'Dorfbrunnen' where id = ${z.id}`;
    await sql`insert into programm_stufe (programm_id, stufe_id) values (${z.id}, ${stufeId})`;
    await sql`insert into leitung_anmeldung (programm_id, user_id, status) values (${z.id}, ${person.id}, 'ja')`;
  }
  return { ids, personId: person.id as string };
}

test("geteilte Serie: A wird umgeschlüsselt und behält id und Ergänzungen, B ohne Nachfolger geht zu «Prüfen», neue Termine kommen intern dazu", async () => {
  stubGoogle([...vorher, ...geteilt]);
  const { ids, personId } = await ersterSerienLauf();
  expect(ids.size).toBe(6);
  expect(await starteSerie()).toBe("fertig");

  const zeilen = await programme();
  expect(zeilen).toHaveLength(ERWARTET_GETEILT.length);
  for (const erwartet of ERWARTET_GETEILT) {
    const zeile = await finde(erwartet.titel, erwartet.beginn);
    expect(zeile).toMatchObject({
      google_event_id: erwartet.event,
      status: erwartet.status,
    });
    if (erwartet.vorher === null) {
      // Neuer Termin: wieder fail-closed
      expect([...ids.values()]).not.toContain(zeile.id);
      expect(zeile).toMatchObject({ sichtbarkeit: "intern", treffpunkt: null });
      expect((await anhang(zeile.id as string)).stufen).toEqual([]);
      continue;
    }
    const vorherKey = `${erwartet.titel}|${erwartet.vorher}`;
    expect(zeile.id).toBe(ids.get(vorherKey));
    if (MIT_ERGAENZUNG.includes(vorherKey)) {
      expect(zeile).toMatchObject({
        sichtbarkeit: "eltern",
        treffpunkt: "Dorfbrunnen",
      });
      expect(await anhang(zeile.id as string)).toEqual({
        stufen: [{ stufe_id: stufeId }],
        leitung: [{ user_id: personId, status: "ja" }],
      });
    }
  }
  expect((await eigeneAbteilung()).sync_fehler).toBeNull();
  expect(ausgabe).not.toHaveBeenCalled();
});

test("ein zweiter Lauf mit derselben geteilten Serie ändert nichts", async () => {
  stubGoogle([...vorher, ...geteilt, ...geteilt]);
  await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  const davor = await programme();
  expect(await starteSerie()).toBe("fertig");
  expect(await programme()).toEqual(davor);
});

test("begonnene Programme bleiben unberührt: Der 09.10. von A behält Zeit und Event-ID, der 16.10. wird übernommen", async () => {
  stubGoogle([...vorher, ...geteilt]);
  const { ids } = await ersterSerienLauf();
  expect(await starteSerie(new Date("2027-10-09T13:00:00Z"))).toBe("fertig");

  expect(await finde("Gruppenstunde", "2027-10-09 12:00:00+00")).toMatchObject({
    id: ids.get("Gruppenstunde|2027-10-09 12:00:00+00"),
    google_event_id: `${A}_20271009T120000Z`,
    status: "aktiv",
  });
  expect(await finde("Gruppenstunde", "2027-10-16 11:30:00+00")).toMatchObject({
    id: ids.get("Gruppenstunde|2027-10-16 12:00:00+00"),
    google_event_id: `${A2}_20271016T113000Z`,
  });
  // Der neue Termin vom 09.10. ist nur ein neues, internes Programm
  expect(await finde("Gruppenstunde", "2027-10-09 11:30:00+00")).toMatchObject({
    sichtbarkeit: "intern",
  });
});

test("ein abgesagtes Programm, das im Abruf fehlt, bleibt abgesagt", async () => {
  stubGoogle([...vorher, ...geteilt]);
  const { ids } = await ersterSerienLauf();
  await sql`update programm set status = 'abgesagt' where id = ${ids.get("Werkstatt|2027-10-13 16:00:00+00")!}`;
  expect(await starteSerie()).toBe("fertig");
  expect(await finde("Werkstatt", "2027-10-13 16:00:00+00")).toMatchObject({
    status: "abgesagt",
  });
  expect(await finde("Werkstatt", "2027-10-20 16:00:00+00")).toMatchObject({
    status: "pruefen",
  });
});

test("ein Programm in «Prüfen» wird übernommen, sobald sein Nachfolger im Abruf auftaucht", async () => {
  const ohneA2 = structuredClone(geteilt) as {
    items: { recurringEventId?: string }[];
  }[];
  ohneA2[0].items = ohneA2[0].items.filter(
    (e) => !e.recurringEventId?.startsWith(A2),
  );
  stubGoogle([...vorher, ...ohneA2, ...geteilt]);
  const { ids } = await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  expect(await finde("Gruppenstunde", "2027-10-09 12:00:00+00")).toMatchObject({
    status: "pruefen",
  });

  expect(await starteSerie()).toBe("fertig");
  expect(await finde("Gruppenstunde", "2027-10-09 11:30:00+00")).toMatchObject({
    id: ids.get("Gruppenstunde|2027-10-09 12:00:00+00"),
    status: "aktiv",
    google_event_id: `${A2}_20271009T113000Z`,
  });
});

test("ein bekannter Termin, der privat wird, geht zu «Prüfen»", async () => {
  const privat = structuredClone(vorher) as {
    items: { id: string; visibility?: string }[];
  }[];
  privat[0].items.find((e) => e.id === `${B}_20271013T160000Z`)!.visibility =
    "private";
  stubGoogle([...vorher, ...privat]);
  await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  for (const z of await programme()) {
    expect(z.status).toBe(
      z.google_event_id === `${B}_20271013T160000Z` ? "pruefen" : "aktiv",
    );
  }
});

test("ein leerer Abruf schickt jedes kommende Programm zu «Prüfen»", async () => {
  stubGoogle([...vorher, {}]);
  await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  const zeilen = await programme();
  expect(zeilen).toHaveLength(6);
  expect(zeilen.every((z) => z.status === "pruefen")).toBe(true);
});

test("ein gescheiterter Lauf (HTTP 500) ändert keinen Status", async () => {
  stubGoogle([...vorher, new Response("kaputt", { status: 500 })]);
  await ersterSerienLauf();
  const davor = await programme();
  expect(await starteSerie()).toBe("fertig");
  expect(await programme()).toEqual(davor);
  expect((await eigeneAbteilung()).sync_fehler).toBe(
    "Google antwortet mit HTTP 500",
  );
});
