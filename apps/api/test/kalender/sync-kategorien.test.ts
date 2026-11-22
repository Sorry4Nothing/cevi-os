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

// Erfundene Datei, nie der echte Feed; ein fester Zeitpunkt vor den Terminen, damit der Test nicht abläuft
const JETZT = new Date("2027-09-01T00:00:00Z");
const sql = postgres(API_URL, { connection: { TimeZone: "UTC" } });
afterAll(() => sql.end());

const ics = await readFile(
  new URL("./aufzeichnungen/kategorien.ics", import.meta.url),
  "utf8",
);

let abteilungId: string;
let kalenderId: string;
let ausgabe: MockInstance<typeof console.log>;
let tags: Record<string, string>;

const tagAnlegen = async (name: string) =>
  (
    await sql`insert into tag (abteilung_id, typ, name, kuerzel) values (${abteilungId}, 'stufe', ${name}, ${name.slice(0, 3)}) returning id`
  )[0].id as string;

beforeEach(async () => {
  kalenderId = `https://kalender.example.org/${randomUUID()}/calendar.ics`;
  const [a] = await sql`
    insert into abteilung (name, google_kalender_id)
    values ('Kategorien-Testabteilung', ${kalenderId}) returning id`;
  abteilungId = a.id as string;
  tags = {
    wolf: await tagAnlegen("Wolfsstufe"),
    pfadi: await tagAnlegen("Pfadistufe"),
  };
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  ausgabe.mockRestore();
  vi.unstubAllGlobals();
  await sql`update abteilung set google_kalender_id = null where id = ${abteilungId}`;
});

// Bedient nur die Adresse der Abteilung, die Texte der Reihe nach
function stubKalender(...texte: string[]) {
  const warteschlange = [...texte];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (eingabe: unknown) => {
      if (String(eingabe) !== kalenderId)
        throw new Error("unerwartete URL im Test");
      const text = warteschlange.shift();
      if (text === undefined) throw new Error("kein Kalender mehr im Test");
      return new Response(text);
    }),
  );
}
const lauf = () => synchronisiere({ datenbankUrl: API_URL, jetzt: JETZT });

// Titel (bei der Serie mit Beginn) zu den Namen der Tags, sortiert
const tagsJeTermin = async () => {
  const zeilen = await sql`
    select p.titel, p.beginn::text as beginn, t.name
    from programm p left join programm_tag pt on pt.programm_id = p.id left join tag t on t.id = pt.tag_id
    where p.abteilung_id = ${abteilungId}`;
  const je: Record<string, string[]> = {};
  for (const z of zeilen) {
    const schluessel =
      z.titel === "Serie mit Ausnahme"
        ? `${z.titel} ${(z.beginn as string).slice(0, 10)}`
        : (z.titel as string);
    (je[schluessel] ??= []).push(...(z.name ? [z.name as string] : []));
  }
  for (const liste of Object.values(je)) liste.sort();
  return je;
};
const markierung = async () =>
  await sql`select pt.programm_id, pt.tag_id, pt.xmin::text as x from programm_tag pt join programm p on p.id = pt.programm_id where p.abteilung_id = ${abteilungId} order by 1, 2`;

test("erster Lauf: Kategorien und Ort stehen am Termin, die Tags nach Name; ohne und mit unbekannter Kategorie fehlt der Tag", async () => {
  stubKalender(ics);
  expect(await lauf()).toBe("fertig");

  expect(await tagsJeTermin()).toEqual({
    "Eine Kategorie": ["Wolfsstufe"],
    "Mehrere Kategorien": ["Pfadistufe", "Wolfsstufe"],
    "Ohne Kategorie": [],
    "Unbekannte Kategorie": ["Wolfsstufe"],
    "Gross und klein": ["Wolfsstufe"],
    // «Hockey, Eis» hat keinen Tag, Pfadistufe schon
    "Maskiertes Komma": ["Pfadistufe"],
    "Serie mit Ausnahme 2027-09-11": ["Wolfsstufe"],
    "Serie mit Ausnahme 2027-09-18": ["Pfadistufe"],
    "Serie mit Ausnahme 2027-09-25": ["Wolfsstufe"],
  });
  const roh = await sql`
    select titel, kategorien, ort from programm
    where abteilung_id = ${abteilungId} and titel in ('Unbekannte Kategorie', 'Ohne Kategorie')`;
  expect(roh.find((z) => z.titel === "Unbekannte Kategorie")).toMatchObject({
    kategorien: ["Unbekannt", "Wolfsstufe"],
    ort: null,
  });
  expect(roh.find((z) => z.titel === "Ohne Kategorie")).toMatchObject({
    kategorien: [],
    ort: "Pfadiheim",
  });
  expect(ausgabe).not.toHaveBeenCalled();
});

test("zweiter Lauf ohne Änderung schreibt programm_tag nicht an", async () => {
  stubKalender(ics, ics);
  await lauf();
  const vorher = await markierung();
  expect(vorher.length).toBeGreaterThan(0);
  await lauf();
  expect(await markierung()).toEqual(vorher);
});

test("eine Abweichung in kategorie_zuordnung wirkt beim nächsten Lauf; ein umbenannter Tag lässt Termine ohne zuordenbare Kategorie unberührt", async () => {
  stubKalender(ics, ics, ics);
  await lauf();

  // «hockey, eis» ohne Gross-/Kleinschreibung zeigt auf Pfadistufe; eine zweite Schreibweise derselben Kategorie ist verboten
  await sql`insert into kategorie_zuordnung (abteilung_id, kategorie, tag_id) values (${abteilungId}, 'hockey, EIS', ${tags.pfadi})`;
  await expect(
    sql`insert into kategorie_zuordnung (abteilung_id, kategorie, tag_id) values (${abteilungId}, 'Hockey, Eis', ${tags.wolf})`,
  ).rejects.toMatchObject({ code: "23505" });
  // Wolfsstufe heisst jetzt anders: Namensgleichheit greift nicht mehr
  await sql`update tag set name = 'Woelfe' where id = ${tags.wolf}`;
  const vorher = await markierung();
  await lauf();
  const je = await tagsJeTermin();
  // Keine Kategorie der Termine «Eine Kategorie» und «Unbekannte Kategorie» ist mehr zuordenbar: Sie behalten ihre Zeilen (Übergangsregel #449)
  expect(je["Eine Kategorie"]).toEqual(["Woelfe"]);
  expect(je["Unbekannte Kategorie"]).toEqual(["Woelfe"]);
  expect(je["Maskiertes Komma"]).toEqual(["Pfadistufe"]);
  // «Mehrere Kategorien» hat mit Pfadistufe noch eine zuordenbare Kategorie: Sie gewinnt, der Tag Woelfe fällt weg
  expect(je["Mehrere Kategorien"]).toEqual(["Pfadistufe"]);
  expect((await markierung()).length).toBe(vorher.length - 1);

  // Die Abweichung bringt «Wolfsstufe» zum umbenannten Tag zurück
  await sql`insert into kategorie_zuordnung (abteilung_id, kategorie, tag_id) values (${abteilungId}, 'Wolfsstufe', ${tags.wolf})`;
  await lauf();
  expect((await tagsJeTermin())["Eine Kategorie"]).toEqual(["Woelfe"]);
});

test("entfällt die Kategorie im Kalender, bleibt der Tag (Übergangsregel #449); ein gelöschter Tag nimmt seine Zeilen mit", async () => {
  const ohne = ics.replace(
    "SUMMARY:Eine Kategorie\nCATEGORIES:Wolfsstufe\n",
    "SUMMARY:Eine Kategorie\n",
  );
  expect(ohne).not.toBe(ics);
  stubKalender(ics, ohne);
  await lauf();
  expect((await tagsJeTermin())["Eine Kategorie"]).toEqual(["Wolfsstufe"]);
  await lauf();
  expect((await tagsJeTermin())["Eine Kategorie"]).toEqual(["Wolfsstufe"]);
  expect(
    (
      await sql`select kategorien from programm where abteilung_id = ${abteilungId} and titel = 'Eine Kategorie'`
    )[0].kategorien,
  ).toEqual([]);

  await sql`delete from tag where id = ${tags.pfadi}`;
  expect((await tagsJeTermin())["Mehrere Kategorien"]).toEqual(["Wolfsstufe"]);
});

test("ohne Tags in der Abteilung bleibt jeder Termin ohne Zeile in programm_tag", async () => {
  await sql`delete from tag where abteilung_id = ${abteilungId}`;
  stubKalender(ics);
  await lauf();
  expect(await markierung()).toEqual([]);
});

test("ohne zuordenbare Kategorie bleiben die Tags eines Termins (auch aus der Migration 0126), mit zuordenbarer Kategorie gewinnen die Kategorien", async () => {
  stubKalender(ics, ics);
  await lauf();
  const id = async (titel: string) =>
    (
      await sql`select id from programm where abteilung_id = ${abteilungId} and titel = ${titel}`
    )[0].id as string;
  // Wie nach der Migration: «Ohne Kategorie» trägt Pfadistufe, «Eine Kategorie» (Kategorie Wolfsstufe) trägt zusätzlich Pfadistufe
  await sql`insert into programm_tag (programm_id, tag_id) values (${await id("Ohne Kategorie")}, ${tags.pfadi}), (${await id("Eine Kategorie")}, ${tags.pfadi})`;
  await lauf();
  const je = await tagsJeTermin();
  expect(je["Ohne Kategorie"]).toEqual(["Pfadistufe"]);
  expect(je["Eine Kategorie"]).toEqual(["Wolfsstufe"]);
});
