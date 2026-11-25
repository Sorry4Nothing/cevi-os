import { randomUUID } from "node:crypto";
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
import { Attrappe, ausfall } from "../outlook/attrappe.js";

// Mit der Graph-Anbindung kommen die Kategorien von Outlook, nicht aus dem Feed (#835). Erfundener Feed ohne eine einzige Zeile CATEGORIES, wie auf dem Live-Server gemessen.
const JETZT = new Date("2027-09-01T00:00:00Z");
const sql = postgres(API_URL, { connection: { TimeZone: "UTC" } });
afterAll(() => sql.end());

const vevent = (zeilen: string[]) =>
  ["BEGIN:VEVENT", ...zeilen, "END:VEVENT"].join("\r\n");
const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  vevent([
    "UID:einzel0000000001",
    "SUMMARY:Einzeltermin",
    "DTSTART:20270904T120000Z",
    "DTEND:20270904T140000Z",
  ]),
  vevent([
    "UID:serie00000000001",
    "SUMMARY:Serie",
    "DTSTART:20270905T120000Z",
    "DTEND:20270905T140000Z",
    "RRULE:FREQ=WEEKLY;COUNT=2",
  ]),
  "END:VCALENDAR",
  "",
].join("\r\n");

let abteilungId: string;
let kalenderId: string;
let ausgabe: MockInstance<typeof console.log>;
let outlook: Attrappe;

const dienst = { fuer: async () => outlook };

const tagAnlegen = async (name: string) =>
  (
    await sql`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilungId}, 'stufe', ${name}, 'K') returning id`
  )[0].id as string;

beforeEach(async () => {
  kalenderId = `https://kalender.example.org/${randomUUID()}/calendar.ics`;
  abteilungId = (
    await sql`insert into abteilung (name, google_kalender_id) values ('Graph-Testabteilung', ${kalenderId}) returning id`
  )[0].id as string;
  await tagAnlegen("Biber");
  await tagAnlegen("Wölfe");
  outlook = new Attrappe();
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (eingabe: unknown) => {
      if (String(eingabe) !== kalenderId) throw new Error("unerwartete URL");
      return new Response(ics);
    }),
  );
});
afterEach(async () => {
  ausgabe.mockRestore();
  vi.unstubAllGlobals();
  await sql`update abteilung set google_kalender_id = null where id = ${abteilungId}`;
});

const lauf = (mitGraph = true) =>
  synchronisiere({
    datenbankUrl: API_URL,
    jetzt: JETZT,
    outlook: mitGraph ? dienst : undefined,
  });
const termine = async () =>
  await sql`
    select p.titel, p.beginn::text as beginn, p.kategorien,
      coalesce(array_agg(t.name order by t.name) filter (where t.name is not null), '{}') as tags
    from programm p left join programm_tag pt on pt.programm_id = p.id left join tag t on t.id = pt.tag_id
    where p.abteilung_id = ${abteilungId} group by p.id order by p.beginn`;

test("Kategorien und Tags kommen von Graph: einzeln über die UID, Serie über UID und Beginn", async () => {
  outlook.graphKategorien = [
    {
      iCalUId: "einzel0000000001",
      serie: false,
      ganztaegig: false,
      start: "2027-09-04T12:00:00.0000000",
      kategorien: ["Biber"],
    },
    {
      iCalUId: "serie00000000001",
      serie: true,
      ganztaegig: false,
      start: "2027-09-12T12:00:00.0000000",
      kategorien: ["Wölfe", "Unbekannt"],
    },
  ];
  expect(await lauf()).toBe("fertig");
  const z = await termine();
  expect(z.map((r) => [r.titel, r.kategorien, r.tags])).toEqual([
    ["Einzeltermin", ["Biber"], ["Biber"]],
    // Die erste Instanz kennt Graph nicht: unbekannt, nicht leer
    ["Serie", [], []],
    ["Serie", ["Wölfe", "Unbekannt"], ["Wölfe"]],
  ]);
});

test("fällt Graph aus, behalten die Termine ihre bisherigen Kategorien und Tags, nie leer", async () => {
  outlook.graphKategorien = [
    {
      iCalUId: "einzel0000000001",
      serie: false,
      ganztaegig: false,
      start: "2027-09-04T12:00:00.0000000",
      kategorien: ["Biber"],
    },
  ];
  await lauf();
  const vorher = await termine();
  outlook.ausfall = ausfall("NICHT_ERREICHBAR");
  expect(await lauf()).toBe("fertig");
  expect(await termine()).toEqual(vorher);
  // Der Ausfall steht im Log, mit festem Code und ohne Text von Microsoft
  expect(
    ausgabe.mock.calls.some((a) => String(a[0]).includes("NICHT_ERREICHBAR")),
  ).toBe(true);
});

test("Outlook gewinnt: Eine neue Kategorie ersetzt die Tags, eine leere Liste lässt sie stehen (Übergangsregel)", async () => {
  const eintrag = (kategorien: string[]) => ({
    iCalUId: "einzel0000000001",
    serie: false,
    ganztaegig: false,
    start: "2027-09-04T12:00:00.0000000",
    kategorien,
  });
  outlook.graphKategorien = [eintrag(["Biber"])];
  await lauf();
  outlook.graphKategorien = [eintrag(["Wölfe"])];
  await lauf();
  expect((await termine())[0].tags).toEqual(["Wölfe"]);
  outlook.graphKategorien = [eintrag([])];
  await lauf();
  const z = (await termine())[0];
  expect(z.kategorien).toEqual([]);
  expect(z.tags).toEqual(["Wölfe"]);
});

test("ohne Graph (Schalter aus) bleibt es beim Feed: keine Kategorien, kein Aufruf", async () => {
  await lauf(false);
  expect(outlook.aufrufe).toEqual([]);
  expect((await termine())[0].kategorien).toEqual([]);
});
