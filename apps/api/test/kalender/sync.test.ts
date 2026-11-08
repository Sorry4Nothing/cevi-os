import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { synchronisiere } from "../../src/kalender/sync.js";
import { API_URL } from "../hilfen/datenbank.js";

const JETZT = new Date();
const BESCHREIBUNG =
  "Wurst & Brot mitnehmen\nFragen an leitung@example.org\nAnmeldung: https://example.org/anmeldung";

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
    beginn: "2027-09-18 17:30:00+00",
    ende: "2027-09-18 19:00:00+00",
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

const lies = (datei: string) =>
  readFile(new URL(`./aufzeichnungen/${datei}`, import.meta.url), "utf8");
const kalender = (...termine: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...termine, "END:VCALENDAR", ""].join(
    "\r\n",
  );
const lauf1 = await lies("erster-lauf.ics");
const lauf2 = await lies("zweiter-lauf.ics");
const vorher = await lies("serie-vorher.ics");
const geteilt = await lies("serie-geteilt.ics");

// Eigene Abteilung samt Stufe pro Test; die Kalenderadresse trägt nur sie, und afterEach räumt sie weg
let abteilungId: string;
let stufeId: string;
let kalenderId: string;
let ausgabe: MockInstance<typeof console.log>;

beforeEach(async () => {
  kalenderId = `https://kalender.example.org/${randomUUID()}/calendar.ics`;
  const [abteilung] = await sql`
    insert into abteilung (name, google_kalender_id)
    values ('Sync-Testabteilung', ${kalenderId}) returning id`;
  abteilungId = abteilung.id as string;
  const [stufe] = await sql`
    insert into stufe (abteilung_id, name, kuerzel)
    values (${abteilungId}, 'Teststufe', 'TS') returning id`;
  stufeId = stufe.id as string;
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  ausgabe.mockRestore();
  vi.unstubAllGlobals();
  await sql`update abteilung set google_kalender_id = null where id = ${abteilungId}`;
});

// Bedient nur die Adresse der Abteilung; jede fremde URL wirft, und die Texte kommen der Reihe nach aus der Warteschlange
function stubKalender(texte: (string | Response)[]) {
  const warteschlange = [...texte];
  const stub = vi.fn(async (eingabe: unknown) => {
    if (String(eingabe) !== kalenderId)
      throw new Error("unerwartete URL im Test");
    const text = warteschlange.shift();
    if (text === undefined) throw new Error("kein Kalender mehr im Test");
    return text instanceof Response ? text : new Response(text);
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

const programme = () => sql`
  select google_event_id, google_serie, titel, ganztaegig,
         beginn::text as beginn, ende::text as ende, tag_von::text as tag_von, tag_bis::text as tag_bis,
         google_ort, google_beschreibung, status, sichtbarkeit, id
  from programm where abteilung_id = ${abteilungId} order by titel, beginn`;

const eigeneAbteilung = async () =>
  (
    await sql`select sync_ok_am, sync_fehler from abteilung where id = ${abteilungId}`
  )[0];

test("erster Lauf: Alle Termine aus der Aufzeichnung landen für Eltern sichtbar, aktiv und ohne Stufe (= alle Stufen) in der Datenbank, Private und Titellose nicht", async () => {
  stubKalender([lauf1]);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
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
      sichtbarkeit: "eltern",
    });
  }
  // Ohne Treffer im Titel keine Zuordnung: Der Termin gilt für alle Stufen
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

test("zweiter Lauf: Änderungen kommen an, Absagen setzen nur den Status, und die Zuordnung bleibt", async () => {
  stubKalender([lauf1, lauf2]);
  const starte = () =>
    synchronisiere({
      datenbankUrl: API_URL,
      jetzt: JETZT,
    });
  expect(await starte()).toBe("fertig");

  // Wie eine SL nach dem ersten Lauf: Stufe zuordnen, Sichtbarkeit öffnen
  const [waldtag] = await sql`
    select id from programm where abteilung_id = ${abteilungId} and google_event_id = '0aldtag000000001'`;
  await sql`update programm set sichtbarkeit = 'eltern' where id = ${waldtag.id}`;
  await sql`insert into programm_stufe (programm_id, stufe_id) values (${waldtag.id}, ${stufeId})`;

  expect(await starte()).toBe("fertig");
  const zeilen = await programme();

  // Geändert (Titel, Zeit, Ort): aktualisiert, Zuordnung unberührt
  const feuer = zeilen.find((z) => z.google_event_id === "0aldtag000000001");
  expect(feuer).toMatchObject({
    titel: "Waldtag mit Feuer",
    beginn: "2027-09-25 12:00:00+00",
    ende: "2027-09-25 15:30:00+00",
    google_ort: "Bahnhof",
    status: "aktiv",
    sichtbarkeit: "eltern",
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

  // Neuer Termin: für Eltern sichtbar, ohne Stufe
  expect(zeilen.find((z) => z.titel === "Elternabend")).toMatchObject({
    beginn: "2027-10-02 17:30:00+00",
    status: "aktiv",
    sichtbarkeit: "eltern",
  });

  // Die Absage eines nie übernommenen (privaten) Termins trifft nichts
  expect(zeilen.map((z) => z.google_event_id)).not.toContain(
    "privat0000000001",
  );
  expect(zeilen).toHaveLength(ERWARTET_LAUF_1.length + 1);
  expect(ausgabe).not.toHaveBeenCalled();
});

test("zwei gleichzeitige Läufe: Der zweite meldet «gesperrt», ohne eine einzige Anfrage an den Kalender", async () => {
  let gibKalender!: (antwort: Response) => void;
  const haengt = new Promise<Response>((loese) => (gibKalender = loese));
  const stub = vi.fn(async () => haengt);
  vi.stubGlobal("fetch", stub);

  const laufA = synchronisiere({ datenbankUrl: API_URL, jetzt: JETZT });
  // Lauf A hält die Sperre und hängt in der Kalenderanfrage
  await vi.waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
  expect(await synchronisiere({ datenbankUrl: API_URL, jetzt: JETZT })).toBe(
    "gesperrt",
  );
  expect(stub).toHaveBeenCalledTimes(1);

  gibKalender(new Response(lauf1));
  expect(await laufA).toBe("fertig");
  expect((await eigeneAbteilung()).sync_fehler).toBeNull();
  // «gesperrt» bleibt still
  expect(ausgabe).not.toHaveBeenCalled();
});

test("HTTP 500: Die Abteilung trägt den festen Fehlertext, sync_ok_am bleibt stehen, und der nächste Lauf bekommt die Sperre", async () => {
  const vorhin = new Date(JETZT.getTime() - 5 * 60 * 1000);
  await sql`update abteilung set sync_ok_am = ${vorhin} where id = ${abteilungId}`;

  stubKalender([new Response("kaputt", { status: 500 })]);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      jetzt: JETZT,
    }),
  ).toBe("fertig");
  let abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBe("Kalender antwortet mit HTTP 500");
  expect((abteilung.sync_ok_am as Date).getTime()).toBe(vorhin.getTime());
  expect(ausgabe).toHaveBeenCalledTimes(1);
  expect(JSON.parse(ausgabe.mock.calls[0][0] as string)).toEqual({
    zeit: expect.any(String),
    ereignis: "kalender",
    abteilungId,
    fehler: "Kalender antwortet mit HTTP 500",
  });

  // Die Sperre ist wieder frei: Der nächste Lauf arbeitet und räumt den Fehler weg
  stubKalender([lauf1]);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      jetzt: JETZT,
    }),
  ).toBe("fertig");
  abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBeNull();
  expect(
    Math.abs((abteilung.sync_ok_am as Date).getTime() - Date.now()),
  ).toBeLessThan(60_000);
});

test("ein Fehler aus der Datenbank: «Unerwarteter Fehler» mit Code, nie Titel oder Kalenderadresse", async () => {
  const vorhin = new Date(JETZT.getTime() - 5 * 60 * 1000);
  await sql`update abteilung set sync_ok_am = ${vorhin} where id = ${abteilungId}`;
  // NUL lehnt Postgres mit 22021 ab; der geplante Titel darf nirgends auftauchen
  stubKalender([
    kalender(
      termin("nul0000000000001", {
        summary: "Max Muster\u0000",
        von: "20270904T120000Z",
        bis: "20270904T140000Z",
      }),
    ),
  ]);
  expect(
    await synchronisiere({
      datenbankUrl: API_URL,
      jetzt: JETZT,
    }),
  ).toBe("fertig");

  const abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBe("Unerwarteter Fehler");
  expect((abteilung.sync_ok_am as Date).getTime()).toBe(vorhin.getTime());
  expect(ausgabe).toHaveBeenCalledTimes(1);
  const zeile = ausgabe.mock.calls[0][0] as string;
  for (const verboten of [
    "max muster",
    kalenderId,
    new URL(kalenderId).pathname,
  ]) {
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

test("eine Adresse ohne https trägt den Adressfehler, und kein fetch läuft", async () => {
  const stub = vi.fn(async () => {
    throw new Error("unerwartete Anfrage im Test");
  });
  vi.stubGlobal("fetch", stub);
  await sql`update abteilung set google_kalender_id = 'http://kalender.example.org/geheim.ics' where id = ${abteilungId}`;
  expect(await synchronisiere({ datenbankUrl: API_URL, jetzt: JETZT })).toBe(
    "fertig",
  );
  const abteilung = await eigeneAbteilung();
  expect(abteilung.sync_fehler).toBe("Kalenderadresse ungültig");
  expect(abteilung.sync_ok_am).toBeNull();
  expect(stub).not.toHaveBeenCalled();
  expect(ausgabe).toHaveBeenCalledTimes(1);
  expect(ausgabe.mock.calls[0][0]).not.toContain("geheim");
});

// Serien «ab diesem Termin»: Ein fester Zeitpunkt vor dem ersten Termin der Aufzeichnungen, damit die Tests nicht ablaufen
const JETZT_SERIE = new Date("2027-09-30T10:00:00Z");
const A = "gruppenstunde002";
const A2 = "gruppenstunde003";
const B = "atelier0000000b1";
const B2 = "atelier0000000b2";

// «vorher» ist der Beginn nach dem ersten Lauf (null: neuer Termin); der Rest gilt nach dem Lauf mit «serie-geteilt.json».
// A wird übernommen (andere Zeit, gleiche Zeile), B hat keinen Nachfolger am gleichen Tag und geht zu «Prüfen»
const ERWARTET_GETEILT = [
  {
    titel: "Gruppenstunde",
    vorher: "2027-10-02 12:00:00+00",
    beginn: "2027-10-02 12:00:00+00",
    event: `${A}_20271002T140000`,
    status: "aktiv",
  },
  {
    titel: "Gruppenstunde",
    vorher: "2027-10-09 12:00:00+00",
    beginn: "2027-10-09 11:30:00+00",
    event: `${A2}_20271009T133000`,
    status: "aktiv",
  },
  {
    titel: "Gruppenstunde",
    vorher: "2027-10-16 12:00:00+00",
    beginn: "2027-10-16 11:30:00+00",
    event: `${A2}_20271016T133000`,
    status: "aktiv",
  },
  {
    titel: "Werkstatt",
    vorher: "2027-10-02 16:00:00+00",
    beginn: "2027-10-02 16:00:00+00",
    event: `${B}_20271002T180000`,
    status: "aktiv",
  },
  {
    titel: "Werkstatt",
    vorher: "2027-10-09 16:00:00+00",
    beginn: "2027-10-09 16:00:00+00",
    event: `${B}_20271009T180000`,
    status: "pruefen",
  },
  {
    titel: "Werkstatt",
    vorher: "2027-10-16 16:00:00+00",
    beginn: "2027-10-16 16:00:00+00",
    event: `${B}_20271016T180000`,
    status: "pruefen",
  },
  {
    titel: "Werkstatt",
    vorher: null,
    beginn: "2027-10-23 16:00:00+00",
    event: `${B2}_20271023T180000`,
    status: "aktiv",
  },
  {
    titel: "Werkstatt",
    vorher: null,
    beginn: "2027-10-30 16:00:00+00",
    event: `${B2}_20271030T180000`,
    status: "aktiv",
  },
];
// Diese vier Programme bekommen nach dem ersten Lauf Zuordnung, Sichtbarkeit und eine Leitungsanmeldung
const MIT_ZUORDNUNG = [
  "Gruppenstunde|2027-10-09 12:00:00+00",
  "Gruppenstunde|2027-10-16 12:00:00+00",
  "Werkstatt|2027-10-09 16:00:00+00",
  "Werkstatt|2027-10-16 16:00:00+00",
];

const starteSerie = (jetzt = JETZT_SERIE) =>
  synchronisiere({ datenbankUrl: API_URL, jetzt });
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

// Erster Lauf mit «serie-vorher.json» (der Stub muss die Seite bereithalten), dann Zuordnungen wie von einer SL
async function ersterSerienLauf() {
  expect(await starteSerie()).toBe("fertig");
  const [person] = await sql`
    insert into "user" (name, email, abteilung_id)
    values ('Leitung Test', ${`${randomUUID()}@example.org`}, ${abteilungId}) returning id`;
  const ids = new Map<string, string>();
  for (const z of await programme()) {
    ids.set(schluessel(z), z.id as string);
    if (!MIT_ZUORDNUNG.includes(schluessel(z))) continue;
    await sql`update programm set sichtbarkeit = 'eltern' where id = ${z.id}`;
    await sql`insert into programm_stufe (programm_id, stufe_id) values (${z.id}, ${stufeId})`;
    await sql`insert into leitung_anmeldung (programm_id, user_id, status) values (${z.id}, ${person.id}, 'ja')`;
  }
  return { ids, personId: person.id as string };
}

test("geteilte Serie: A wird umgeschlüsselt und behält id und Zuordnung, B ohne Nachfolger geht zu «Prüfen», neue Termine kommen für Eltern dazu", async () => {
  stubKalender([vorher, geteilt]);
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
      // Neuer Termin: für Eltern sichtbar, ohne Stufe
      expect([...ids.values()]).not.toContain(zeile.id);
      expect(zeile).toMatchObject({ sichtbarkeit: "eltern" });
      expect((await anhang(zeile.id as string)).stufen).toEqual([]);
      continue;
    }
    const vorherKey = `${erwartet.titel}|${erwartet.vorher}`;
    expect(zeile.id).toBe(ids.get(vorherKey));
    if (MIT_ZUORDNUNG.includes(vorherKey)) {
      expect(zeile).toMatchObject({ sichtbarkeit: "eltern" });
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
  stubKalender([vorher, geteilt, geteilt]);
  await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  const davor = await programme();
  expect(await starteSerie()).toBe("fertig");
  expect(await programme()).toEqual(davor);
});

test("begonnene Programme bleiben unberührt: Der 09.10. von A behält Zeit und Event-ID, der 16.10. wird übernommen", async () => {
  stubKalender([vorher, geteilt]);
  const { ids } = await ersterSerienLauf();
  expect(await starteSerie(new Date("2027-10-09T13:00:00Z"))).toBe("fertig");

  expect(await finde("Gruppenstunde", "2027-10-09 12:00:00+00")).toMatchObject({
    id: ids.get("Gruppenstunde|2027-10-09 12:00:00+00"),
    google_event_id: `${A}_20271009T140000`,
    status: "aktiv",
  });
  expect(await finde("Gruppenstunde", "2027-10-16 11:30:00+00")).toMatchObject({
    id: ids.get("Gruppenstunde|2027-10-16 12:00:00+00"),
    google_event_id: `${A2}_20271016T133000`,
  });
  // Der neue Termin vom 09.10. ist nur ein neues Programm ohne Stufe
  expect(await finde("Gruppenstunde", "2027-10-09 11:30:00+00")).toMatchObject({
    sichtbarkeit: "eltern",
  });
});

test("ein abgesagtes Programm, das im Abruf fehlt, bleibt abgesagt", async () => {
  stubKalender([vorher, geteilt]);
  const { ids } = await ersterSerienLauf();
  await sql`update programm set status = 'abgesagt' where id = ${ids.get("Werkstatt|2027-10-09 16:00:00+00")!}`;
  expect(await starteSerie()).toBe("fertig");
  expect(await finde("Werkstatt", "2027-10-09 16:00:00+00")).toMatchObject({
    status: "abgesagt",
  });
  expect(await finde("Werkstatt", "2027-10-16 16:00:00+00")).toMatchObject({
    status: "pruefen",
  });
});

test("ein Programm in «Prüfen» wird übernommen, sobald sein Nachfolger im Abruf auftaucht", async () => {
  const ohneA2 = geteilt.replace(
    new RegExp(`BEGIN:VEVENT\\r?\\nUID:${A2}[\\s\\S]*?END:VEVENT\\r?\\n`),
    "",
  );
  expect(ohneA2).not.toContain(A2);
  stubKalender([vorher, ohneA2, geteilt]);
  const { ids } = await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  expect(await finde("Gruppenstunde", "2027-10-09 12:00:00+00")).toMatchObject({
    status: "pruefen",
  });

  expect(await starteSerie()).toBe("fertig");
  expect(await finde("Gruppenstunde", "2027-10-09 11:30:00+00")).toMatchObject({
    id: ids.get("Gruppenstunde|2027-10-09 12:00:00+00"),
    status: "aktiv",
    google_event_id: `${A2}_20271009T133000`,
  });
});

test("ein bekannter Termin, der privat wird, geht zu «Prüfen»", async () => {
  // Die Instanz vom 13.10. wird von einer Ausnahme überschrieben, die privat ist
  const privat = vorher.replace(
    "END:VCALENDAR",
    [
      "BEGIN:VEVENT",
      `UID:${B}`,
      "RECURRENCE-ID;TZID=W. Europe Standard Time:20271009T180000",
      "DTSTART;TZID=W. Europe Standard Time:20271009T180000",
      "DTEND;TZID=W. Europe Standard Time:20271013T193000",
      "SUMMARY:Werkstatt",
      "CLASS:PRIVATE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
  );
  stubKalender([vorher, privat]);
  await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  for (const z of await programme()) {
    expect(z.status).toBe(
      z.google_event_id === `${B}_20271009T180000` ? "pruefen" : "aktiv",
    );
  }
});

test("ein leerer Abruf schickt jedes kommende Programm zu «Prüfen»", async () => {
  stubKalender([vorher, kalender()]);
  await ersterSerienLauf();
  expect(await starteSerie()).toBe("fertig");
  const zeilen = await programme();
  expect(zeilen).toHaveLength(6);
  expect(zeilen.every((z) => z.status === "pruefen")).toBe(true);
});

test("ein gescheiterter Lauf (HTTP 500) ändert keinen Status", async () => {
  stubKalender([vorher, new Response("kaputt", { status: 500 })]);
  await ersterSerienLauf();
  const davor = await programme();
  expect(await starteSerie()).toBe("fertig");
  expect(await programme()).toEqual(davor);
  expect((await eigeneAbteilung()).sync_fehler).toBe(
    "Kalender antwortet mit HTTP 500",
  );
});

// Der Kalender als Attrappe; jede fremde URL wirft. Der Text gilt für jeden Lauf
function stubNetz(text: string) {
  vi.stubGlobal("fetch", async (eingabe: unknown) => {
    if (String(eingabe) !== kalenderId) {
      throw new Error(`unerwartete URL im Test: ${String(eingabe)}`);
    }
    return new Response(text);
  });
}

// Das Programm, wie der Sync es schon kennt; Zuordnung und Sichtbarkeit setzt sonst eine SL
async function programm(
  event: string,
  {
    titel = "Waldtag",
    ort = "Waldhütte",
    sichtbarkeit = "eltern",
    stufen = [stufeId],
    status = "aktiv",
  }: {
    titel?: string;
    ort?: string | null;
    sichtbarkeit?: string;
    stufen?: string[];
    status?: string;
  } = {},
) {
  const [zeile] = await sql`
    insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende,
                          google_ort, sichtbarkeit, status)
    values (${abteilungId}, ${event}, ${titel}, false, '2027-09-25T12:00:00Z',
            '2027-09-25T14:00:00Z', ${ort}, ${sichtbarkeit}, ${status})
    returning id`;
  for (const stufeId of stufen) {
    await sql`insert into programm_stufe (programm_id, stufe_id) values (${zeile.id}, ${stufeId})`;
  }
  return zeile.id as string;
}

// Ein Termin am Sa 25.9.2027, 14 bis 16 Uhr Sommerzeit; «von» und «bis» sind UTC-Zeitpunkte oder, mit «ganztaegig», Tage
const termin = (
  id: string,
  extra: {
    summary?: string;
    location?: string;
    description?: string;
    von?: string;
    bis?: string;
    ganztaegig?: boolean;
    status?: string;
  } = {},
) => {
  const { summary = "Waldtag", location = "Waldhütte", ganztaegig } = extra;
  const { von = "20270925T120000Z", bis = "20270925T140000Z" } = extra;
  const art = ganztaegig ? ";VALUE=DATE" : "";
  return [
    "BEGIN:VEVENT",
    `UID:${id}`,
    `DTSTART${art}:${von}`,
    `DTEND${art}:${bis}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    ...(extra.description ? [`DESCRIPTION:${extra.description}`] : []),
    ...(extra.status ? [`STATUS:${extra.status}`] : []),
    "END:VEVENT",
  ].join("\r\n");
};

const lauf = () =>
  synchronisiere({
    datenbankUrl: API_URL,
    jetzt: JETZT,
  });

// Automatische Zuordnung nach dem Titel (#34): «Stufen» meint alle, sonst Stufenname oder Kürzel als ganzes Wort
async function stufenFuerZuordnung() {
  const [biber] = await sql`
    insert into stufe (abteilung_id, name, kuerzel)
    values (${abteilungId}, 'Biber', 'BI') returning id`;
  const [woelfe] = await sql`
    insert into stufe (abteilung_id, name, kuerzel)
    values (${abteilungId}, 'Wölfe', 'WÖ') returning id`;
  return { biber: biber.id as string, woelfe: woelfe.id as string };
}

const mitTitel = (titel: string, id = "auto000000000001") =>
  stubNetz(kalender(termin(id, { summary: titel })));

const zugeordnet = async (id = "auto000000000001") => {
  const [p] = await sql`
    select id, sichtbarkeit from programm
    where abteilung_id = ${abteilungId} and google_event_id = ${id}`;
  const stufen = await sql`
    select stufe_id from programm_stufe where programm_id = ${p.id}`;
  return {
    id: p.id as string,
    sichtbarkeit: p.sichtbarkeit as string,
    stufen: stufen.map((s) => s.stufe_id as string).sort(),
  };
};

const auditEintraege = (programmId: string) => sql`
  select akteur_id, aktion, ziel_typ, details from audit_log
  where ziel_id = ${programmId} order by erstellt_am, id`;

test("«Stufen» im Titel: alle Stufen der Abteilung, für Eltern sichtbar, Audit-Eintrag vom System", async () => {
  const { biber, woelfe } = await stufenFuerZuordnung();
  mitTitel("Samstag aller STUFEN");
  await lauf();

  const z = await zugeordnet();
  expect(z.sichtbarkeit).toBe("eltern");
  expect(z.stufen).toEqual([stufeId, biber, woelfe].sort());
  expect(await auditEintraege(z.id)).toEqual([
    {
      akteur_id: "system",
      aktion: "programm_zugeordnet",
      ziel_typ: "programm",
      details: { stufen: z.stufen },
    },
  ]);
});

test("ein Stufenname im Titel: nur diese Stufe, für Eltern sichtbar", async () => {
  const { biber } = await stufenFuerZuordnung();
  mitTitel("Waldtag biber");
  await lauf();
  expect(await zugeordnet()).toMatchObject({
    sichtbarkeit: "eltern",
    stufen: [biber],
  });
});

test("zwei Stufennamen im Titel: beide Stufen", async () => {
  const { biber, woelfe } = await stufenFuerZuordnung();
  mitTitel("Biber und Wölfe: Waldtag");
  await lauf();
  expect(await zugeordnet()).toMatchObject({
    sichtbarkeit: "eltern",
    stufen: [biber, woelfe].sort(),
  });
});

test("kein Treffer: Der Termin bleibt für Eltern sichtbar und ohne Stufe (= alle Stufen), ohne Audit-Eintrag", async () => {
  await stufenFuerZuordnung();
  mitTitel("Waldtag mit Stufenleitung und Biberburg");
  await lauf();
  const z = await zugeordnet();
  expect(z).toMatchObject({ sichtbarkeit: "eltern", stufen: [] });
  expect(await auditEintraege(z.id)).toEqual([]);
});

test("eine Zuordnung von Hand bleibt, auch wenn der Titel eine Stufe nennt", async () => {
  const { biber } = await stufenFuerZuordnung();
  mitTitel("Waldtag Wölfe");
  await lauf();
  const vorher = await zugeordnet();

  // Wie eine SL: auf Biber umgestellt, mit Audit-Eintrag einer Person
  await sql`delete from programm_stufe where programm_id = ${vorher.id}`;
  await sql`insert into programm_stufe (programm_id, stufe_id) values (${vorher.id}, ${biber})`;
  await sql`update programm set sichtbarkeit = 'leitende' where id = ${vorher.id}`;
  await sql`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
            values (${abteilungId}, ${randomUUID()}, 'programm_zugeordnet', 'programm', ${vorher.id}, '{}')`;

  mitTitel("Waldtag Stufen");
  await lauf();
  expect(await zugeordnet()).toMatchObject({
    sichtbarkeit: "leitende",
    stufen: [biber],
  });
  expect(await auditEintraege(vorher.id)).toHaveLength(2);
});

test("eine Zuordnung von Hand, die alles wieder entfernt, bleibt unzugeordnet", async () => {
  await stufenFuerZuordnung();
  mitTitel("Waldtag");
  await lauf();
  const { id } = await zugeordnet();
  // Eine Person hat zugeordnet und wieder entfernt: Stand «ohne Stufe», aber mit ihrem Eintrag
  await sql`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
            values (${abteilungId}, ${randomUUID()}, 'programm_zugeordnet', 'programm', ${id}, '{}')`;

  mitTitel("Waldtag Biber");
  await lauf();
  expect(await zugeordnet()).toMatchObject({
    sichtbarkeit: "eltern",
    stufen: [],
  });
});

test("Titeländerung: Die Automatik folgt dem neuen Titel, bis keine Stufe mehr passt, und ein unveränderter Lauf schreibt nichts", async () => {
  const { biber, woelfe } = await stufenFuerZuordnung();
  mitTitel("Waldtag Biber");
  await lauf();
  const { id } = await zugeordnet();
  expect(await zugeordnet()).toMatchObject({ stufen: [biber] });

  await lauf();
  expect(await auditEintraege(id)).toHaveLength(1);

  mitTitel("Waldtag Wölfe");
  await lauf();
  expect(await zugeordnet()).toMatchObject({
    sichtbarkeit: "eltern",
    stufen: [woelfe],
  });

  mitTitel("Waldtag");
  await lauf();
  expect(await zugeordnet()).toMatchObject({
    sichtbarkeit: "eltern",
    stufen: [],
  });

  const eintraege = await auditEintraege(id);
  expect(eintraege.map((e) => e.akteur_id)).toEqual([
    "system",
    "system",
    "system",
  ]);
  expect(eintraege[2].details).toEqual({ stufen: [] });
});

test("ein Zustand, den weder Standard noch Automatik gesetzt haben, bleibt auch ohne Audit-Eintrag", async () => {
  await stufenFuerZuordnung();
  const id = await programm("hand0000000000001", {
    titel: "Waldtag",
    stufen: [stufeId],
    sichtbarkeit: "leitende",
  });
  mitTitel("Waldtag Biber", "hand0000000000001");
  await lauf();
  expect(await zugeordnet("hand0000000000001")).toMatchObject({
    id,
    sichtbarkeit: "leitende",
    stufen: [stufeId],
  });
});
