import { and, eq, like } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { synchronisiereEckdaten } from "../src/kalender/eckdaten-sync.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

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

const SEITE = `<section><h2>Eckdaten zum nächsten Anlass</h2><div>
<b>Cevi-Programm:</b><br />
Samstag, 10. April 2027<br />
<br />
<b>Treff und Schlusspunkt:</b><br />
14:00-17:00 Uhr<br />
Beispielhaus 1, Musterdorf<br />
<br />
Mitnehmen:<br />
<ul><li>Trinkflasche</li><li>Zvieri</li></ul><br />
</div></section>`;
const ERWARTET = {
  treffpunkt: "14:00 Uhr\nBeispielhaus 1, Musterdorf",
  schlussOrt: "Beispielhaus 1, Musterdorf",
  schlussZeit: "17:00",
  mitnehmen: "Trinkflasche\nZvieri",
};
const LEER = {
  treffpunkt: null,
  schlussOrt: null,
  schlussZeit: null,
  mitnehmen: null,
};

let welt: Welt;
let eltern: PersonaKonto;
let froeschliId: string;
const urls: string[] = [];

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  eltern = await legePersonaAn(welt, "elternA");
  const [froeschli] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: "Fröschli",
      kuerzel: "F",
    })
    .returning();
  froeschliId = froeschli.id;
  // Nur die Seite von «Stufe A» und «Fröschli» gibt es; jede andere Stufe hat keine (wie das geschützte Exodus)
  await synchronisiereEckdaten({
    datenbankUrl: API_URL,
    basisUrl: "https://seite.example.org/",
    abrufen: async (url) => {
      urls.push(url);
      return url.endsWith("/cevistufe-stufea") ||
        url.endsWith("/cevistufe-froeschli")
        ? SEITE
        : null;
    },
  });
});

const detail = async (id: string) => {
  const res = await app.request(`/api/v1/programme/${id}`, {
    headers: eltern.headers,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};

test("der Stufenname wird klein und ohne Umlaut zur Adresse", () => {
  expect(urls).toContain("https://seite.example.org/cevistufe-froeschli");
  expect(urls).toContain("https://seite.example.org/cevistufe-stufea");
});

test("das Detail trägt die Angaben, wenn Tag und Stufe passen (mit Zeit und ganztägig)", async () => {
  const mitZeit = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen: [welt.stufeAId],
    // 22:30 UTC ist in Zürich schon der 11. April; 12:00 UTC der 10.
    beginn: new Date("2027-04-10T12:00:00Z"),
  });
  const ganztaegig = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen: [welt.stufeAId],
    tagVon: "2027-04-10",
  });
  expect(await detail(mitZeit.id)).toMatchObject(ERWARTET);
  expect(await detail(ganztaegig.id)).toMatchObject(ERWARTET);
});

test("anderer Tag oder später Abend in UTC (schon der Folgetag in Zürich): null", async () => {
  const andererTag = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen: [welt.stufeAId],
    beginn: new Date("2027-04-17T12:00:00Z"),
  });
  // In Zürich schon der 11. April
  const spaet = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen: [welt.stufeAId],
    beginn: new Date("2027-04-10T22:30:00Z"),
  });
  for (const p of [andererTag, spaet]) {
    expect(await detail(p.id)).toMatchObject(LEER);
  }
  // Eine Stufe ohne Seite bekommt keine Zeile
  const zeilen = await db.select().from(schema.programmEckdaten);
  expect(zeilen.some((z) => z.stufeId === welt.stufeBId)).toBe(false);
  expect(zeilen.some((z) => z.stufeId === froeschliId)).toBe(true);
});

const webProgramme = (stufeId: string) =>
  db
    .select({
      titel: schema.programm.titel,
      beginn: schema.programm.beginn,
      ende: schema.programm.ende,
      ganztaegig: schema.programm.ganztaegig,
      tagVon: schema.programm.tagVon,
      ort: schema.programm.googleOrt,
      sichtbarkeit: schema.programm.sichtbarkeit,
    })
    .from(schema.programm)
    .innerJoin(
      schema.programmStufe,
      eq(schema.programmStufe.programmId, schema.programm.id),
    )
    .where(
      and(
        eq(schema.programmStufe.stufeId, stufeId),
        like(schema.programm.googleEventId, "web:%"),
      ),
    );

test("ohne Kalender legt der Abruf das Programm an: Zeiten in Zürich, für Eltern sichtbar, der Stufe zugeordnet", async () => {
  const zeilen = await webProgramme(froeschliId);
  expect(zeilen).toEqual([
    {
      titel: "Cevi-Programm Fröschli",
      // 14:00 und 17:00 Uhr Sommerzeit
      beginn: new Date("2027-04-10T12:00:00Z"),
      ende: new Date("2027-04-10T15:00:00Z"),
      ganztaegig: false,
      tagVon: null,
      ort: "Beispielhaus 1, Musterdorf",
      sichtbarkeit: "eltern",
    },
  ]);
  // Ein zweiter Lauf desselben Tags legt kein zweites an
  await synchronisiereEckdaten({
    datenbankUrl: API_URL,
    basisUrl: "https://seite.example.org",
    abrufen: async (url) =>
      url.endsWith("/cevistufe-froeschli") ? SEITE : null,
  });
  expect(await webProgramme(froeschliId)).toHaveLength(1);
});

test("ohne Zeit ganztägig; mit Kalender in der Abteilung entsteht nichts", async () => {
  const ohneZeit = SEITE.replace("14:00-17:00 Uhr<br />", "");
  const [mitKalender] = await db
    .insert(schema.abteilung)
    .values({ name: "Mit Kalender", googleKalenderId: "kalender-test" })
    .returning();
  const [kalenderStufe] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: mitKalender.id,
      name: "Kalenderstufe",
      kuerzel: "K",
    })
    .returning();
  await synchronisiereEckdaten({
    datenbankUrl: API_URL,
    basisUrl: "https://seite.example.org",
    abrufen: async (url) =>
      url.endsWith("/cevistufe-stufeb")
        ? ohneZeit
        : url.endsWith("/cevistufe-kalenderstufe")
          ? SEITE
          : null,
  });
  expect(await webProgramme(welt.stufeBId)).toMatchObject([
    { ganztaegig: true, beginn: null, ende: null, tagVon: "2027-04-10" },
  ]);
  expect(await webProgramme(kalenderStufe.id)).toEqual([]);
});

test("ein neuer Lauf ersetzt den alten Tag der Stufe", async () => {
  const neu = SEITE.replace("10. April 2027", "17. April 2027");
  await synchronisiereEckdaten({
    datenbankUrl: API_URL,
    basisUrl: "https://seite.example.org",
    abrufen: async (url) => (url.endsWith("/cevistufe-stufea") ? neu : null),
  });
  const tage = await db
    .select({ tag: schema.programmEckdaten.tag })
    .from(schema.programmEckdaten)
    .where(eq(schema.programmEckdaten.stufeId, welt.stufeAId));
  expect(tage).toEqual([{ tag: "2027-04-17" }]);
  // Das kommende Programm des alten Tags ist weg, das des neuen da
  const programme = await webProgramme(welt.stufeAId);
  expect(programme).toHaveLength(1);
  expect(programme[0].beginn).toEqual(new Date("2027-04-17T12:00:00Z"));
});

test("ein Fehler beim Abruf lässt den Lauf der übrigen Stufen weiterlaufen und loggt nur den Code", async () => {
  const ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
  await expect(
    synchronisiereEckdaten({
      datenbankUrl: API_URL,
      basisUrl: "https://seite.example.org",
      abrufen: async () => {
        throw new Error("https://geheim.example.org/pfad");
      },
    }),
  ).resolves.toBe("fertig");
  expect(JSON.stringify(ausgabe.mock.calls)).not.toContain("geheim");
  ausgabe.mockRestore();
});
