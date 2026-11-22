import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
afterAll(async () => {
  await sql.end();
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let fremdLagerId: string;
let andereLagerId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(abteilungId: string) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Protokolllager",
      von: "2027-07-10",
      bis: "2027-07-24",
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}
async function mitglieder(id: string) {
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
}

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
  andereLagerId = await legeLager(welt.testabteilungId);
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  for (const id of [lagerId, andereLagerId]) await mitglieder(id);
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

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
const SP = "https://cevi.sharepoint.com/sites/lager/Protokolle";

// Eine Verknüpfung direkt in der Datenbank, hinzugefügt von der genannten Person (nur sie darf sie in den ersten 24 Stunden einbinden)
async function datei(id = lagerId, von: PersonaKonto = leiter()) {
  const [zeile] = await db
    .insert(schema.lagerDatei)
    .values({
      lagerId: id,
      anzeigename: "Protokoll.docx",
      link: `${SP}/Protokoll.docx`,
      erstelltVon: von.id,
      lagerSeq: 0,
    })
    .returning({ id: schema.lagerDatei.id });
  return zeile!.id;
}
async function hoeck(art: "team" | "lagerleitung", id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/hoecks`, {
    titel: `Höck ${art}`,
    art,
    datum: "2027-07-12",
  });
  expect(a.status).toBe(201);
  return a.body as { id: string; version: number };
}
type P = {
  id: string;
  version: number;
  art: string;
  titel: string;
  datum: string;
  hoeckId: string | null;
  dateiId: string;
  datei: { id: string; link: string; anzeigename: string } | null;
};
async function neu(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/protokolle`, {
    art: "notiz",
    titel: "Protokoll",
    datum: "2027-07-12",
    dateiId: await datei(id),
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as P;
}
type B = {
  id: string;
  version: number;
  text: string;
  protokollId: string | null;
  hoeckId: string | null;
};
async function neuerBeschluss(werte: Record<string, unknown>, id = lagerId) {
  return anfrage(leiter(), "POST", `${L(id)}/beschluesse`, {
    text: "Beschluss",
    ...werte,
  });
}
const hoeckHolen = async (id: string) =>
  (await anfrage(leiter(), "GET", `${L()}/hoecks/${id}`)).body as {
    protokollId: string | null;
    version: number;
  };
const marke = () => `T${randomUUID().slice(0, 8)}`;
const protokollTitel = async (konto: PersonaKonto, abfrage = "") => {
  const a = await anfrage(konto, "GET", `${L()}/protokolle${abfrage}`);
  expect(a.status).toBe(200);
  return (a.body.protokolle as P[]).map((p) => p.titel).sort();
};
// Die Verknüpfung über die Route anlegen: Nur so steht sie im Änderungsfeed
async function dateiUeberRoute(id: string) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/dateien`, {
    anzeigename: `Feed-${randomUUID().slice(0, 6)}.docx`,
    link: `${SP}/Feed.docx`,
  });
  expect(a.status).toBe(201);
  return a.body.id as string;
}
// Das Team bekommt das Leserecht eingestellt: Die Regel «nie Protokolle der Lagerleitung» gilt trotzdem
async function teamDarfLesen(id: string) {
  await db.insert(schema.lagerRolleRecht).values({
    lagerId: id,
    rolle: "team",
    recht: "protokolle.lesen",
    erlaubt: true,
  });
}

describe("Rechte je Lager-Persona", () => {
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const schreiben = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: erfolg,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });

  test.each(LAGER_PERSONAS)("%s: Protokolle lesen", async (p) => {
    const eins = await neu();
    expect((await anfrage(konten[p], "GET", `${L()}/protokolle`)).status).toBe(
      lesen[p],
    );
    expect(
      (await anfrage(konten[p], "GET", `${L()}/protokolle/${eins.id}`)).status,
    ).toBe(lesen[p]);
  });

  test.each(LAGER_PERSONAS)("%s: Protokoll anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/protokolle`, {
      art: "sitzung",
      titel: "X",
      datum: "2027-07-12",
      dateiId: await datei(lagerId, konten[p].id ? konten[p] : leiter()),
    });
    expect(a.status).toBe(schreiben(201)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: Protokoll ändern und löschen", async (p) => {
    const eins = await neu();
    const patch = await anfrage(
      konten[p],
      "PATCH",
      `${L()}/protokolle/${eins.id}`,
      { version: eins.version, titel: "Anders" },
    );
    expect(patch.status).toBe(schreiben(200)[p]);
    const zwei = await neu();
    const loeschen = await anfrage(
      konten[p],
      "DELETE",
      `${L()}/protokolle/${zwei.id}?version=${zwei.version}`,
    );
    expect(loeschen.status).toBe(schreiben(204)[p]);
  });

  test.each(LAGER_PERSONAS)("%s: Beschlüsse", async (p) => {
    const b = (await neuerBeschluss({})).body as B;
    expect((await anfrage(konten[p], "GET", `${L()}/beschluesse`)).status).toBe(
      lesen[p],
    );
    expect(
      (await anfrage(konten[p], "GET", `${L()}/beschluesse/${b.id}`)).status,
    ).toBe(lesen[p]);
    expect(
      (
        await anfrage(konten[p], "POST", `${L()}/beschluesse`, {
          text: "Neu",
        })
      ).status,
    ).toBe(schreiben(201)[p]);
    expect(
      (
        await anfrage(konten[p], "PATCH", `${L()}/beschluesse/${b.id}`, {
          version: b.version,
          text: "Anders",
        })
      ).status,
    ).toBe(schreiben(200)[p]);
    const c = (await neuerBeschluss({})).body as B;
    expect(
      (
        await anfrage(
          konten[p],
          "DELETE",
          `${L()}/beschluesse/${c.id}?version=${c.version}`,
        )
      ).status,
    ).toBe(schreiben(204)[p]);
  });

  test("ein abgeschlossenes Lager ist schreibgeschützt, Lesen geht", async () => {
    const id = await legeLager(welt.testabteilungId);
    await mitglieder(id);
    const p = await neu({}, id);
    await db
      .update(schema.lager)
      .set({ status: "abgeschlossen" })
      .where(eq(schema.lager.id, id));
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(id)}/protokolle/${p.id}`, {
          version: 1,
          titel: "Y",
        })
      ).status,
    ).toBe(409);
    expect(
      (await anfrage(leiter(), "POST", `${L(id)}/beschluesse`, { text: "Y" }))
        .status,
    ).toBe(409);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/protokolle/${p.id}`)).status,
    ).toBe(200);
  });

  test("Fremdlager und ein anderes Lager: 404, nie der Eintrag", async () => {
    const p = await neu();
    for (const pfad of [
      `${L(andereLagerId)}/protokolle/${p.id}`,
      `${L(fremdLagerId)}/protokolle/${p.id}`,
    ]) {
      expect((await anfrage(leiter(), "GET", pfad)).status).toBe(404);
    }
    expect(
      (
        await anfrage(
          leiter(),
          "PATCH",
          `${L(andereLagerId)}/protokolle/${p.id}`,
          { version: 1, titel: "Fremd" },
        )
      ).status,
    ).toBe(404);
    const b = (await neuerBeschluss({})).body as B;
    expect(
      (
        await anfrage(
          leiter(),
          "GET",
          `${L(andereLagerId)}/beschluesse/${b.id}`,
        )
      ).status,
    ).toBe(404);
    // Die Datei eines anderen Lagers lässt sich nicht einbinden
    const fremdeDatei = await datei(andereLagerId);
    const a = await anfrage(leiter(), "POST", `${L()}/protokolle`, {
      art: "notiz",
      titel: "X",
      datum: "2027-07-12",
      dateiId: fremdeDatei,
    });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("DATEI_UNBEKANNT");
  });
});

describe("Verknüpfung auf die Datei", () => {
  test("Antwort: Art, Titel, Datum, Link der Datei, nie mehr als die Spalten der Route", async () => {
    const p = await neu({ art: "sitzung", titel: "  Sitzung 3  " });
    expect(p).toMatchObject({
      art: "sitzung",
      titel: "Sitzung 3",
      datum: "2027-07-12",
      hoeckId: null,
      version: 1,
    });
    expect(p.datei).toMatchObject({
      anzeigename: "Protokoll.docx",
      link: `${SP}/Protokoll.docx`,
    });
    expect(Object.keys(p).sort()).toEqual(
      [
        "art",
        "datei",
        "dateiId",
        "datum",
        "erstelltAm",
        "erstelltVon",
        "hoeckId",
        "id",
        "titel",
        "version",
      ].sort(),
    );
  });

  test("böse Links werden schon beim Anlegen der Verknüpfung abgelehnt, ein Protokoll bekommt nie einen", async () => {
    for (const link of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "//cevi.sharepoint.com/x",
      "http://cevi.sharepoint.com/x",
      "https://user:pass@cevi.sharepoint.com/x",
      `https://cevi.sharepoint.com/${"a".repeat(3000)}`,
      "ftp://cevi.sharepoint.com/x",
      "/relativ",
    ]) {
      const a = await anfrage(leiter(), "POST", `${L()}/dateien`, {
        anzeigename: "Böse.docx",
        link,
      });
      expect(a.status).toBe(400);
    }
    // Ohne Verknüpfung kein Protokoll
    const a = await anfrage(leiter(), "POST", `${L()}/protokolle`, {
      art: "notiz",
      titel: "X",
      datum: "2027-07-12",
      dateiId: randomUUID(),
    });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("DATEI_UNBEKANNT");
  });

  test("über die Route angelegte Verknüpfung lässt sich einbinden", async () => {
    const d = await anfrage(leiter(), "POST", `${L()}/dateien`, {
      anzeigename: "Route.docx",
      link: `${SP}/Route.docx`,
    });
    expect(d.status).toBe(201);
    const p = await neu({ dateiId: d.body.id });
    expect(p.datei!.link).toBe(`${SP}/Route.docx`);
  });

  test("eine Datei, die jemand anderes eben hinzugefügt hat, lässt sich nicht einbinden (kein Link ohne Nachweis)", async () => {
    const fremd = await datei(lagerId, konten.leitung);
    const a = await anfrage(leiter(), "POST", `${L()}/protokolle`, {
      art: "notiz",
      titel: "X",
      datum: "2027-07-12",
      dateiId: fremd,
    });
    expect(a.status).toBe(400);
  });

  test("Ändern: andere Datei, gleiche Prüfung; veraltete Version ist 409", async () => {
    const p = await neu();
    const schlecht = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/protokolle/${p.id}`,
      { version: 1, dateiId: randomUUID() },
    );
    expect(schlecht.status).toBe(400);
    const gut = await anfrage(leiter(), "PATCH", `${L()}/protokolle/${p.id}`, {
      version: 1,
      dateiId: await datei(),
      datum: "2027-07-13",
    });
    expect(gut.status).toBe(200);
    expect(gut.body).toMatchObject({ version: 2, datum: "2027-07-13" });
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/protokolle/${p.id}`,
      { version: 1, titel: "Alt" },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
  });

  test("Eingaben sind strikt: unbekannte Felder, falsche Art, leerer Titel, Steuerzeichen", async () => {
    const d = await datei();
    for (const abweichung of [
      { inhalt: "Text" },
      { link: "https://x.example/" },
      { art: "geheim" },
      { titel: "" },
      { titel: "a\u0000b" },
      { datum: "2027-13-40" },
    ]) {
      const a = await anfrage(leiter(), "POST", `${L()}/protokolle`, {
        art: "notiz",
        titel: "X",
        datum: "2027-07-12",
        dateiId: d,
        ...abweichung,
      });
      expect(a.status).toBe(400);
    }
  });

  test("Löschen ist endgültig: weg aus Liste, Einzelabruf und Tabelle, Datei bleibt", async () => {
    const p = await neu();
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L()}/protokolle/${p.id}?version=${p.version}`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/protokolle/${p.id}`)).status,
    ).toBe(404);
    expect(
      await db.$count(schema.protokoll, eq(schema.protokoll.id, p.id)),
    ).toBe(0);
    // Die Datei am Ablageort und ihr Eintrag bleiben (der Aufräumlauf entfernt ihn nach 24 Stunden)
    expect(
      await db.$count(schema.lagerDatei, eq(schema.lagerDatei.id, p.dateiId)),
    ).toBe(1);
  });

  test("Liste: Filter nach Art, Höck und Titel, Seitenwechsel", async () => {
    const m = marke();
    const h = await hoeck("team");
    await neu({ titel: `${m} a`, art: "sitzung", hoeckId: h.id });
    await neu({ titel: `${m} b`, art: "idee" });
    await neu({ titel: `${m} c`, art: "idee" });
    expect(await protokollTitel(leiter(), `?q=${m}`)).toEqual([
      `${m} a`,
      `${m} b`,
      `${m} c`,
    ]);
    expect(await protokollTitel(leiter(), `?q=${m}&art=idee`)).toEqual([
      `${m} b`,
      `${m} c`,
    ]);
    expect(await protokollTitel(leiter(), `?q=${m}&hoeckId=${h.id}`)).toEqual([
      `${m} a`,
    ]);
    // Sonderzeichen der Suche gelten wörtlich
    expect(
      await protokollTitel(leiter(), `?q=${encodeURIComponent("%")}`),
    ).toEqual([]);
    const eins = await anfrage(
      leiter(),
      "GET",
      `${L()}/protokolle?q=${m}&limit=2`,
    );
    expect(eins.body.protokolle).toHaveLength(2);
    expect(eins.body.naechster).toBe(eins.body.protokolle[1].id);
    const zwei = await anfrage(
      leiter(),
      "GET",
      `${L()}/protokolle?q=${m}&limit=2&nach=${eins.body.naechster}`,
    );
    expect(zwei.body.protokolle).toHaveLength(1);
    expect(zwei.body.naechster).toBeNull();
  });
});

describe("Höck und Zeiger hoeck.protokollId", () => {
  test("ein Sitzungsprotokoll setzt den Zeiger, ein zweites überschreibt ihn nicht, Löschen nimmt ihn zurück", async () => {
    const h = await hoeck("team");
    const notiz = await neu({ art: "notiz", hoeckId: h.id });
    expect((await hoeckHolen(h.id)).protokollId).toBeNull();
    const erstes = await neu({ art: "sitzung", hoeckId: h.id });
    expect((await hoeckHolen(h.id)).protokollId).toBe(erstes.id);
    const zweites = await neu({ art: "sitzung", hoeckId: h.id });
    expect((await hoeckHolen(h.id)).protokollId).toBe(erstes.id);
    // Löschen eines anderen Protokolls lässt den Zeiger stehen
    await anfrage(
      leiter(),
      "DELETE",
      `${L()}/protokolle/${zweites.id}?version=${zweites.version}`,
    );
    expect((await hoeckHolen(h.id)).protokollId).toBe(erstes.id);
    await anfrage(
      leiter(),
      "DELETE",
      `${L()}/protokolle/${erstes.id}?version=${erstes.version}`,
    );
    expect((await hoeckHolen(h.id)).protokollId).toBeNull();
    // Die Notiz bleibt am Höck
    expect(await protokollTitel(leiter(), `?hoeckId=${h.id}`)).toEqual([
      notiz.titel,
    ]);
  });

  test("Umhängen und Art ändern pflegen den Zeiger; die Höck-Version steigt und der Feed meldet den Höck", async () => {
    const eins = await hoeck("team");
    const zwei = await hoeck("team");
    const vor = (await anfrage(leiter(), "GET", `${L()}/aenderungen`)).body.seq;
    const p = await neu({ art: "sitzung", hoeckId: eins.id });
    expect((await hoeckHolen(eins.id)).version).toBe(eins.version + 1);
    const feed = (
      await anfrage(leiter(), "GET", `${L()}/aenderungen?seit=${vor}`)
    ).body.eintraege as { objekttyp: string; id: string }[];
    expect(feed.map((e) => e.objekttyp)).toEqual(
      expect.arrayContaining(["protokoll", "hoeck"]),
    );
    await anfrage(leiter(), "PATCH", `${L()}/protokolle/${p.id}`, {
      version: 1,
      hoeckId: zwei.id,
    });
    expect((await hoeckHolen(eins.id)).protokollId).toBeNull();
    expect((await hoeckHolen(zwei.id)).protokollId).toBe(p.id);
    await anfrage(leiter(), "PATCH", `${L()}/protokolle/${p.id}`, {
      version: 2,
      art: "notiz",
    });
    expect((await hoeckHolen(zwei.id)).protokollId).toBeNull();
    await anfrage(leiter(), "PATCH", `${L()}/protokolle/${p.id}`, {
      version: 3,
      art: "sitzung",
      hoeckId: null,
    });
    expect((await hoeckHolen(zwei.id)).protokollId).toBeNull();
  });

  test("ein unbekannter Höck und der eines anderen Lagers: 400 HOECK_UNBEKANNT", async () => {
    const fremderHoeck = await hoeck("team", andereLagerId);
    for (const hoeckId of [randomUUID(), fremderHoeck.id]) {
      const a = await anfrage(leiter(), "POST", `${L()}/protokolle`, {
        art: "sitzung",
        titel: "X",
        datum: "2027-07-12",
        dateiId: await datei(),
        hoeckId,
      });
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("HOECK_UNBEKANNT");
    }
  });

  test("der Zeiger lässt sich über die Höck-Route weiter nicht setzen", async () => {
    const h = await hoeck("team");
    const a = await anfrage(leiter(), "PATCH", `${L()}/hoecks/${h.id}`, {
      version: h.version,
      protokollId: randomUUID(),
    });
    expect(a.status).toBe(400);
  });
});

describe("Protokolle der Lagerleitung sieht das Team nie", () => {
  test("auch mit eingestelltem Leserecht: Liste, Einzelabruf, Beschlüsse, Feed und Datei blenden sie aus", async () => {
    const id = await legeLager(welt.testabteilungId);
    await mitglieder(id);
    await teamDarfLesen(id);
    const intern = await hoeck("lagerleitung", id);
    const offen = await hoeck("team", id);
    const pIntern = await neu(
      {
        art: "sitzung",
        titel: "intern",
        hoeckId: intern.id,
        dateiId: await dateiUeberRoute(id),
      },
      id,
    );
    const pOffen = await neu(
      {
        art: "sitzung",
        titel: "offen",
        hoeckId: offen.id,
        dateiId: await dateiUeberRoute(id),
      },
      id,
    );
    const pOhne = await neu({ art: "notiz", titel: "ohne" }, id);
    const bIntern = (
      await neuerBeschluss({ protokollId: pIntern.id, text: "geheim" }, id)
    ).body as B;
    const bOffen = (
      await neuerBeschluss({ protokollId: pOffen.id, text: "offen" }, id)
    ).body as B;
    const bHoeck = (
      await neuerBeschluss({ hoeckId: intern.id, text: "geheim 2" }, id)
    ).body as B;

    const team = konten.team;
    const liste = await anfrage(team, "GET", `${L(id)}/protokolle`);
    expect((liste.body.protokolle as P[]).map((p) => p.titel).sort()).toEqual([
      "offen",
      "ohne",
    ]);
    expect(
      (await anfrage(team, "GET", `${L(id)}/protokolle/${pIntern.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(team, "GET", `${L(id)}/protokolle/${pOffen.id}`)).status,
    ).toBe(200);
    expect(
      (await anfrage(team, "GET", `${L(id)}/protokolle/${pOhne.id}`)).status,
    ).toBe(200);
    // Auch nach Höck gefiltert gibt es nichts
    const nachHoeck = await anfrage(
      team,
      "GET",
      `${L(id)}/protokolle?hoeckId=${intern.id}`,
    );
    expect(nachHoeck.body).toEqual({ protokolle: [], naechster: null });
    const beschluesse = await anfrage(team, "GET", `${L(id)}/beschluesse`);
    expect((beschluesse.body.beschluesse as B[]).map((b) => b.text)).toEqual([
      "offen",
    ]);
    for (const b of [bIntern, bHoeck]) {
      expect(
        (await anfrage(team, "GET", `${L(id)}/beschluesse/${b.id}`)).status,
      ).toBe(404);
    }
    expect(
      (await anfrage(team, "GET", `${L(id)}/beschluesse/${bOffen.id}`)).status,
    ).toBe(200);
    // Die Lagerleitung sieht alles
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/protokolle`)).body.protokolle,
    ).toHaveLength(3);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/beschluesse`)).body.beschluesse,
    ).toHaveLength(3);

    // Änderungsfeed: das Team bekommt weder Protokoll noch Beschluss der Lagerleitung noch deren Datei
    const feed = (await anfrage(team, "GET", `${L(id)}/aenderungen?seit=0`))
      .body.eintraege as { objekttyp: string; id: string }[];
    const ids = feed.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([pOffen.id, pOhne.id, bOffen.id]),
    );
    for (const verborgen of [
      pIntern.id,
      pIntern.dateiId,
      bIntern.id,
      bHoeck.id,
    ]) {
      expect(ids).not.toContain(verborgen);
    }
    expect(ids).toContain(pOffen.dateiId);
    // Die Datei des Protokolls der Lagerleitung gibt es für das Team nicht (404)
    expect(
      (await anfrage(team, "GET", `${L(id)}/dateien/${pIntern.dateiId}`))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(team, "GET", `${L(id)}/dateien/${pOffen.dateiId}`)).status,
    ).toBe(200);
  });

  test("ohne alle Höcks bleiben sie ebenfalls verborgen, und sie lassen sich nicht anbinden", async () => {
    const id = await legeLager(welt.testabteilungId);
    await mitglieder(id);
    const intern = await hoeck("lagerleitung", id);
    const p = await neu({ art: "sitzung", hoeckId: intern.id }, id);
    await db.insert(schema.lagerRolleRecht).values([
      {
        lagerId: id,
        rolle: "lesen",
        recht: "hoecks.lesen_alle",
        erlaubt: false,
      },
      {
        lagerId: id,
        rolle: "leitung",
        recht: "hoecks.lesen_alle",
        erlaubt: false,
      },
      {
        lagerId: id,
        rolle: "leitung",
        recht: "hoecks.bearbeiten",
        erlaubt: false,
      },
    ]);
    // Die Rolle «lesen» hat protokolle.lesen, aber keinen Höck mehr: Das Protokoll der Lagerleitung gibt es für sie nicht
    expect(
      (await anfrage(konten.lesen, "GET", `${L(id)}/protokolle/${p.id}`))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(konten.lesen, "GET", `${L(id)}/protokolle`)).body
        .protokolle,
    ).toEqual([]);
    // Wer schreiben darf, aber den Höck nicht sieht, kann nichts an ihn hängen
    const a = await anfrage(konten.leitung, "POST", `${L(id)}/beschluesse`, {
      text: "X",
      hoeckId: intern.id,
    });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("HOECK_UNBEKANNT");
    const b = await anfrage(konten.leitung, "POST", `${L(id)}/beschluesse`, {
      text: "X",
      protokollId: p.id,
    });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("PROTOKOLL_UNBEKANNT");
    expect(
      (
        await anfrage(konten.leitung, "PATCH", `${L(id)}/protokolle/${p.id}`, {
          version: 1,
          titel: "Zugriff",
        })
      ).status,
    ).toBe(404);
  });
});

describe("Beschlüsse", () => {
  test("anlegen, lesen, ändern, löschen; Antwort ohne weitere Felder", async () => {
    const a = await neuerBeschluss({ text: "  Wir packen am Freitag  " });
    expect(a.status).toBe(201);
    const b = a.body as B;
    expect(b).toMatchObject({
      text: "Wir packen am Freitag",
      protokollId: null,
      hoeckId: null,
      version: 1,
    });
    expect(Object.keys(b).sort()).toEqual(
      [
        "erstelltAm",
        "erstelltVon",
        "hoeckId",
        "id",
        "protokollId",
        "text",
        "version",
      ].sort(),
    );
    const p = await anfrage(leiter(), "PATCH", `${L()}/beschluesse/${b.id}`, {
      version: 1,
      text: "Zwei\nZeilen",
    });
    expect(p.body).toMatchObject({ version: 2, text: "Zwei\nZeilen" });
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L()}/beschluesse/${b.id}`, {
          version: 1,
          text: "alt",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L()}/beschluesse/${b.id}?version=2`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/beschluesse/${b.id}`)).status,
    ).toBe(404);
  });

  test("Verweis auf Protokoll übernimmt dessen Höck; ein anderer Höck passt nicht; Unbekanntes ist 400", async () => {
    const h = await hoeck("team");
    const anderer = await hoeck("team");
    const p = await neu({ art: "sitzung", hoeckId: h.id });
    const ok = (await neuerBeschluss({ protokollId: p.id })).body as B;
    expect(ok).toMatchObject({ protokollId: p.id, hoeckId: h.id });
    const passt = await neuerBeschluss({
      protokollId: p.id,
      hoeckId: anderer.id,
    });
    expect(passt.status).toBe(400);
    expect(passt.body.code).toBe("HOECK_PASST_NICHT");
    const unbekannt = await neuerBeschluss({ protokollId: randomUUID() });
    expect(unbekannt.body.code).toBe("PROTOKOLL_UNBEKANNT");
    const fremd = await neu({}, andereLagerId);
    expect((await neuerBeschluss({ protokollId: fremd.id })).body.code).toBe(
      "PROTOKOLL_UNBEKANNT",
    );
    expect((await neuerBeschluss({ hoeckId: randomUUID() })).body.code).toBe(
      "HOECK_UNBEKANNT",
    );
    // Ändern: Verweis lösen
    const geloest = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/beschluesse/${ok.id}`,
      { version: 1, protokollId: null, hoeckId: null },
    );
    expect(geloest.body).toMatchObject({ protokollId: null, hoeckId: null });
  });

  test("Beschlüsse bleiben, wenn das Protokoll gelöscht wird, ohne Verweis darauf und mit dem Höck; Liste filtert nach Protokoll und Höck", async () => {
    const h = await hoeck("team");
    const p = await neu({ art: "notiz", hoeckId: h.id });
    const b = (await neuerBeschluss({ protokollId: p.id })).body as B;
    await neuerBeschluss({});
    await anfrage(
      leiter(),
      "DELETE",
      `${L()}/protokolle/${p.id}?version=${p.version}`,
    );
    const nachProtokoll = await anfrage(
      leiter(),
      "GET",
      `${L()}/beschluesse?protokollId=${p.id}`,
    );
    expect(nachProtokoll.body.beschluesse).toEqual([]);
    const [danach] = await db
      .select()
      .from(schema.beschluss)
      .where(eq(schema.beschluss.id, b.id));
    expect(danach).toMatchObject({ protokollId: null, version: 2 });
    const nachHoeck = await anfrage(
      leiter(),
      "GET",
      `${L()}/beschluesse?hoeckId=${h.id}`,
    );
    expect(nachHoeck.body.beschluesse.map((x: B) => x.id)).toEqual([b.id]);
    const seite = await anfrage(leiter(), "GET", `${L()}/beschluesse?limit=1`);
    expect(seite.body.beschluesse).toHaveLength(1);
    expect(seite.body.naechster).toBe(seite.body.beschluesse[0].id);
  });

  test("Eingaben sind strikt", async () => {
    for (const abweichung of [
      { text: "" },
      { text: "x".repeat(1001) },
      { text: "a\u0000b" },
      { protokollId: "kein-uuid" },
      { extra: 1 },
    ]) {
      expect((await neuerBeschluss(abweichung)).status).toBe(400);
    }
  });
});

describe("Datei im Verweisregister", () => {
  test("die Datei eines Protokolls sieht, wer das Protokoll sieht; der Fremdschlüssel hält sie fest", async () => {
    const p = await neu();
    expect(
      (await anfrage(konten.lesen, "GET", `${L()}/dateien/${p.dateiId}`))
        .status,
    ).toBe(200);
    // Das Team hat protokolle.lesen nicht: Die Datei gibt es für es nicht
    expect(
      (await anfrage(konten.team, "GET", `${L()}/dateien/${p.dateiId}`)).status,
    ).toBe(404);
    await expect(
      db.delete(schema.lagerDatei).where(eq(schema.lagerDatei.id, p.dateiId)),
    ).rejects.toThrow();
  });
});
