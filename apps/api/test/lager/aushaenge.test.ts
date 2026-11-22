import postgres from "postgres";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ARTEN, type Art } from "../../src/lager/aushaenge.js";
import {
  AushangZuGross,
  erzeugePdf,
  MAX_ZEILEN,
  sauber,
} from "../../src/lager/pdf.js";
import { AUSHAENGE_PRO_MINUTE } from "../../src/routes/lager/aushaenge.js";
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
const neueApp = () =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    seiten: ladeSeiten(),
  });
// Der Zähler je Konto lebt in der App: Jeder Test bekommt eine frische
let app = neueApp();
beforeEach(() => {
  app = neueApp();
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
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

const holen = (konto: PersonaKonto, lagerId: string, art: string) =>
  app.request(`/api/v1/lager/${lagerId}/aushaenge/${art}`, {
    headers: konto.headers,
  });

// Der Text aller Seiten und die Angaben des Dokuments, gelesen mit dem PDF-Parser
async function lies(res: Response) {
  const pdf = await getDocument({
    data: new Uint8Array(await res.arrayBuffer()),
    verbosity: 0,
  }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const seite = await (await pdf.getPage(i)).getTextContent();
    text += seite.items.map((t) => ("str" in t ? t.str : "")).join(" ") + "\n";
  }
  const meta = (await pdf.getMetadata()).info as {
    Title?: string;
    Language?: string;
  };
  return { seiten: pdf.numPages, text, meta };
}

// Ein Lager mit allem, was auf einem Aushang steht: drei Kinder mit gleichem Vornamen oder Cevi-Namen, ein abgewähltes Kind in jeder Liste, ein Zimmer des Teams und eines fremder Kinder, Gruppe, Fahrt, Schicht und Ressort
async function legeLager(status: "aktiv" | "abgeschlossen" = "aktiv") {
  const [l] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Aushanglager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const lagerId = l!.id;
  for (const p of ["lagerleitung", "leitung", "team", "lesen"] as const) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId, personId: konten[p].id!, rolle: p });
  }
  const kinder = await db
    .insert(schema.teilnehmer)
    .values(
      [
        ["Zoë", "Müller", "Funke", false],
        ["Anna", "Meier", null, false],
        ["Anna", "Keller", null, false],
        ["Verschwunden", "Geist", "Nebel", true],
        ["Hugo", "Fremd", null, false],
      ].map(([vorname, nachname, ceviName, abgewaehlt]) => ({
        lagerId,
        vorname: vorname as string,
        nachname: nachname as string,
        ceviName: ceviName as string | null,
        abgewaehlt: abgewaehlt as boolean,
        stufe: "Wolf",
        lagerSeq: 0,
      })),
    )
    .returning({
      id: schema.teilnehmer.id,
      nachname: schema.teilnehmer.nachname,
    });
  // Nach Nachnamen: Müller (Cevi-Name Funke), Meier und Keller (beide Anna), Geist (abgewählt), Fremd (Hugo)
  const k = Object.fromEntries(kinder.map((x) => [x.nachname, x.id])) as Record<
    string,
    string
  >;
  const kiloIds = [k.Müller!, k.Geist!];

  // Zimmer: «Blauer Raum» mit Kindern und der Leitung, «Teamzelt» mit dem Team, «Fremdraum» mit Hugo
  const zimmer = await db
    .insert(schema.zimmer)
    .values(
      ["Blauer Raum", "Teamzelt", "Fremdraum"].map((name, i) => ({
        lagerId,
        name,
        art: i === 1 ? ("zelt" as const) : ("zimmer" as const),
        plaetze: 6,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    )
    .returning({ id: schema.zimmer.id, name: schema.zimmer.name });
  const z = Object.fromEntries(zimmer.map((x) => [x.name, x.id]));
  await db.insert(schema.zimmerZuordnung).values([
    ...[k.Müller!, k.Geist!, k.Meier!, k.Keller!].map((teilnehmerId) => ({
      lagerId,
      zimmerId: z["Blauer Raum"]!,
      teilnehmerId,
      lagerSeq: 0,
    })),
    {
      lagerId,
      zimmerId: z["Teamzelt"]!,
      personId: konten.team.id!,
      lagerSeq: 0,
    },
    { lagerId, zimmerId: z["Fremdraum"]!, teilnehmerId: k.Fremd!, lagerSeq: 0 },
  ]);

  // Gruppe «Adler»
  const [g] = await db
    .insert(schema.gruppe)
    .values({ lagerId, name: "Adler", lagerSeq: 0 })
    .returning({ id: schema.gruppe.id });
  await db.insert(schema.gruppeZuordnung).values(
    kiloIds.map((teilnehmerId) => ({
      lagerId,
      gruppeId: g!.id,
      teilnehmerId,
      lagerSeq: 0,
    })),
  );

  // Fahrt «Bus» hin, mit dem Fahrer und beiden Kindern
  const [f] = await db
    .insert(schema.fahrt)
    .values({
      lagerId,
      richtung: "hin",
      art: "auto",
      name: "Bus",
      fahrerPersonId: konten.leitung.id!,
      plaetze: 8,
      datum: "2027-07-10",
      zeit: "09:30",
      lagerSeq: 0,
    })
    .returning({ id: schema.fahrt.id });
  await db.insert(schema.fahrtMitfahrer).values(
    kiloIds.map((teilnehmerId) => ({
      lagerId,
      fahrtId: f!.id,
      richtung: "hin" as const,
      teilnehmerId,
      lagerSeq: 0,
    })),
  );

  // Schichtplan: ein Tag, ein Abschnitt, ein Dienst mit der Leitung, Zoë und dem abgewählten Kind
  const [tag] = await db
    .insert(schema.lagertag)
    .values({ lagerId, datum: "2027-07-10", lagerSeq: 0 })
    .returning({ id: schema.lagertag.id });
  const [abschnitt] = await db
    .insert(schema.tagesabschnitt)
    .values({ lagerId, name: "Abend", lagerSeq: 0 })
    .returning({ id: schema.tagesabschnitt.id });
  const [dienst] = await db
    .insert(schema.dienst)
    .values({
      lagerId,
      name: "Küche",
      tagesabschnittId: abschnitt!.id,
      lagerSeq: 0,
    })
    .returning({ id: schema.dienst.id });
  await db.insert(schema.schicht).values(
    [
      { personId: konten.leitung.id! },
      { teilnehmerId: k.Müller! },
      { teilnehmerId: k.Geist! },
    ].map((wer) => ({
      lagerId,
      lagertagId: tag!.id,
      tagesabschnittId: abschnitt!.id,
      dienstId: dienst!.id,
      lagerSeq: 0,
      ...wer,
    })),
  );

  // Ressorts: «Programm» mit Leitung, darunter «Spiele»
  const [r] = await db
    .insert(schema.ressort)
    .values({
      lagerId,
      kuerzel: "PRG",
      name: "Programm",
      leitungPersonId: konten.leitung.id!,
      lagerSeq: 0,
    })
    .returning({ id: schema.ressort.id });
  await db.insert(schema.ressort).values({
    lagerId,
    kuerzel: "SPI",
    name: "Spiele",
    parentId: r!.id,
    lagerSeq: 0,
  });
  return lagerId;
}

// Was auf dem jeweiligen Aushang stehen muss
const ERWARTET: Record<Art, string[]> = {
  schichtplan: ["Küche", "Zoë Müller", "Samstag, 10. Juli 2027"],
  zimmerliste: ["Blauer Raum", "Funke", "Anna K.", "Anna M.", "Teamzelt"],
  tuerschilder: ["Blauer Raum", "Funke", "Anna K.", "Anna M."],
  gruppenlisten: ["Adler", "Zoë Müller"],
  fahrtenliste: ["Hinfahrt: Bus", "Zoë Müller", "09:30"],
  organigramm: ["Programm (PRG)", "Spiele (SPI)"],
};

describe("Aushänge als PDF (#405)", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await legeLager();
  });

  test.each(ARTEN)(
    "%s: lesbares PDF mit Titel und Sprache, ohne Abgewählte, mit den Kopfzeilen",
    async (art) => {
      const res = await holen(konten.lagerleitung, lagerId, art);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="${art}.pdf"`,
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { seiten, text, meta } = await lies(res);
      expect(seiten).toBeGreaterThan(0);
      expect(meta.Title).toBeTruthy();
      expect(meta.Language).toBe("de-CH");
      for (const s of ERWARTET[art]) expect(text).toContain(s);
      expect(text).not.toMatch(/Verschwunden|Geist|Nebel/);
    },
  );

  test("Türschild: Cevi-Name, sonst Vorname, bei Gleichheit mit Anfangsbuchstabe des Nachnamens; keine Nachnamen sonst", async () => {
    const { text, seiten } = await lies(
      await holen(konten.lagerleitung, lagerId, "tuerschilder"),
    );
    // Ein Schild je Zimmer mit Kindern: Blauer Raum und Fremdraum (das Teamzelt hat keine Kinder)
    expect(seiten).toBe(2);
    expect(text).not.toMatch(/Müller|Meier|Keller|Teamzelt/);
    expect(text).not.toContain("Anna Meier");
  });

  test("Team sieht wie in der Ansicht nur das eigene Zimmer; das Organigramm ist ihm verwehrt", async () => {
    const liste = await lies(await holen(konten.team, lagerId, "zimmerliste"));
    expect(liste.text).toContain("Teamzelt");
    expect(liste.text).not.toMatch(/Blauer Raum|Fremdraum|Hugo|Funke/);
    const fahrten = await lies(
      await holen(konten.team, lagerId, "fahrtenliste"),
    );
    expect(fahrten.text).not.toContain("Bus");
    expect((await holen(konten.team, lagerId, "organigramm")).status).toBe(403);
  });

  test("jede Persona gegen jede Art; fremdes Lager 404", async () => {
    const fremd = (
      await db
        .insert(schema.lager)
        .values({
          abteilungId: welt.demoAbteilungId,
          titel: "Fremd",
          von: "2027-07-10",
          bis: "2027-07-11",
        })
        .returning({ id: schema.lager.id })
    )[0]!.id;
    for (const art of ARTEN) {
      const erwartet: Record<LagerPersona, number> = {
        abteilungsleitung: 200,
        lagerleitung: 200,
        leitung: 200,
        team: art === "organigramm" ? 403 : 200,
        lesen: 200,
        ohneMitgliedschaft: 404,
        fremdeAbteilung: 404,
        ohneLogin: 401,
      };
      for (const persona of LAGER_PERSONAS) {
        const res = await holen(konten[persona], lagerId, art);
        expect(res.status, `${art} ${persona}`).toBe(erwartet[persona]);
        await res.arrayBuffer();
      }
      expect((await holen(konten.lagerleitung, fremd, art)).status).toBe(404);
    }
  });

  test("ein abgeschlossenes Lager lässt sich lesen und drucken", async () => {
    const zu = await legeLager("abgeschlossen");
    const res = await holen(konten.lagerleitung, zu, "gruppenlisten");
    expect(res.status).toBe(200);
    expect((await lies(res)).text).toContain("Adler");
  });

  test("eine unbekannte Art ist 400", async () => {
    const res = await holen(konten.lagerleitung, lagerId, "unbekannt");
    expect(res.status).toBe(400);
  });

  test("nichts wird gespeichert: keine Tabelle mit lager_id bekommt oder verliert eine Zeile dieses Lagers", async () => {
    // Andere Testdateien laufen gleichzeitig in derselben Datenbank: Gezählt wird darum nur, was zu diesem Lager gehört
    const tabellen = await sql<{ t: string }[]>`
      select c.table_name as t from information_schema.columns c
      join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
      where c.table_schema = 'public' and c.column_name = 'lager_id' and t.table_type = 'BASE TABLE'`;
    expect(tabellen.map((x) => x.t)).toContain("lager_datei");
    const zaehle = async () =>
      (
        await sql.unsafe(
          tabellen
            .map(
              (x) =>
                `select '${x.t}' as t, count(*)::int as n from "${x.t}" where lager_id = '${lagerId}'`,
            )
            .join(" union all ") + " order by t",
        )
      ).map((z) => `${z.t}:${z.n}`);
    const vorher = await zaehle();
    for (const art of ARTEN) {
      await (await holen(konten.lagerleitung, lagerId, art)).arrayBuffer();
    }
    expect(await zaehle()).toEqual(vorher);
  });

  test("Rate-Limit je Konto: nach zehn Aufrufen in der Minute 429", async () => {
    for (let i = 0; i < AUSHAENGE_PRO_MINUTE; i++) {
      const res = await holen(konten.lesen, lagerId, "schichtplan");
      expect(res.status).toBe(200);
      await res.arrayBuffer();
    }
    expect((await holen(konten.lesen, lagerId, "schichtplan")).status).toBe(
      429,
    );
    // Ein anderes Konto ist nicht betroffen
    expect((await holen(konten.leitung, lagerId, "schichtplan")).status).toBe(
      200,
    );
  });
});

describe("PDF-Erzeugung", () => {
  test("zu viele Zeilen werden abgelehnt", async () => {
    await expect(
      erzeugePdf({
        titel: "Gross",
        abschnitte: [
          {
            titel: "A",
            tabelle: {
              spalten: ["Name"],
              zeilen: Array.from({ length: MAX_ZEILEN + 1 }, () => ["x"]),
            },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AushangZuGross);
  });

  test("lange Tabellen laufen über mehrere Seiten", async () => {
    const pdf = await erzeugePdf({
      titel: "Lang",
      abschnitte: [
        {
          titel: "A",
          tabelle: {
            spalten: ["Name"],
            zeilen: Array.from({ length: 200 }, (_, i) => [`Eintrag ${i}`]),
          },
        },
      ],
    });
    const { seiten, text } = await lies(new Response(new Uint8Array(pdf)));
    expect(seiten).toBeGreaterThan(2);
    expect(text).toContain("Eintrag 199");
  });

  test("Zeichen ausserhalb von WinAnsi werden zu «?», Umlaute bleiben", () => {
    expect(sauber("Łukasz Müller – Zoë")).toBe("?ukasz Müller – Zoë");
    expect(sauber("a\u0000b")).toBe("a?b");
  });
});
