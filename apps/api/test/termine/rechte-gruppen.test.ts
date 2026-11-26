import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { legeSystemrollenAn } from "../../src/rechtemodell/gruppenrollen.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

// Rechte der Termine, Anlässe und Räume über Gruppenrollen (#649): Die Persona-Matrix der Standardrollen steht in test/termine/matrix; hier gilt, was eine Gruppenrolle zusätzlich gibt. Je Route: Rolle mit dem Recht, ohne das Recht, Gruppe eines fremden Anlasses oder Teams, ohne zweiten Faktor, fremde Abteilung.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Antworten der Routen sind in den Tests untypisiert
type Json = any;

let welt: Welt;
const abt = () => welt.testabteilungId;

const aufruf = async (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) => {
  const r = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await r.text();
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON (CSV, 204) */
  }
  return { status: r.status, body: json, text };
};
const ZF = "ZWEITER_FAKTOR_FEHLT";

const gruppe = async (
  typ: "team" | "anlass",
  name: string,
  anlassId?: string,
) => {
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId: abt(),
      typ,
      name: `${name} ${randomUUID().slice(0, 6)}`,
      kuerzel: "",
      anlassId,
    })
    .returning({ id: schema.tag.id });
  await legeSystemrollenAn(db, abt(), t!.id, typ);
  return t!.id;
};
const rolle = async (
  tagId: string,
  name: string,
  rechte: { recht: string; geltung: "alle" | "eigene" }[],
) => {
  const [r] = await db
    .insert(schema.gruppenRolle)
    .values({ abteilungId: abt(), tagId, name })
    .returning({ id: schema.gruppenRolle.id });
  await db
    .insert(schema.gruppenRolleRecht)
    .values(rechte.map((z) => ({ rolleId: r!.id, ...z })));
  return r!.id;
};
const mitglied = (konto: PersonaKonto, tagId: string, rolleId?: string) =>
  db
    .insert(schema.personTag)
    .values({ userId: konto.id!, tagId, rolle: null, rolleId });
const person = (mitFaktor: boolean, persona: Persona = "elternA") =>
  mitFaktor
    ? legePersonaMitFaktorAn(welt, persona)
    : legePersonaAn(welt, persona);

const neuerAnlass = async (titel: string) => {
  const [p] = await sql<
    { id: string }[]
  >`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis) values (${abt()}, ${`g-${randomUUID()}`}, ${titel}, true, '2099-05-01', '2099-05-01') returning id`;
  const [a] = await sql<
    { id: string }[]
  >`insert into anlass (abteilung_id, programm_id, sichtbarkeit) values (${abt()}, ${p!.id}, 'angemeldet') returning id`;
  return a!.id;
};
const neuerRaum = async (teamTagId: string | null) => {
  const [r] = await db
    .insert(schema.raum)
    .values({
      abteilungId: abt(),
      name: `Raum ${randomUUID().slice(0, 8)}`,
      teamTagId,
    })
    .returning({ id: schema.raum.id });
  return r!.id;
};
const neueAnfrage = async (raumId: string, vonId: string) => {
  const [b] = await db
    .insert(schema.raumBuchung)
    .values({
      raumId,
      userId: vonId,
      beginn: new Date("2099-01-01T10:00:00Z"),
      ende: new Date("2099-01-01T12:00:00Z"),
      zweck: "Test",
      status: "angefragt",
    })
    .returning({ id: schema.raumBuchung.id });
  return b!.id;
};

// Die Welt: zwei Anlässe mit OK, ein Team mit Räumen und ein fremdes Team
let al: PersonaKonto;
let fremdAl: PersonaKonto;
let anlassA: string;
let anlassB: string;
let okA: string;
let okB: string;
let kasse: PersonaKonto;
let kasseOhneFaktor: PersonaKonto;
let okLeitung: PersonaKonto;
let okFremd: PersonaKonto;
let okOhneRolle: PersonaKonto;
let teamT: string;
let teamF: string;
let raumT: string;
let raumF: string;
let raumOhne: string;
let materialwart: PersonaKonto;
let materialwartOhneFaktor: PersonaKonto;
let teamMitglied: PersonaKonto;
let teamFremd: PersonaKonto;
let anfragerin: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  al = await legePersonaAn(welt, "admin");
  fremdAl = await legePersonaAn(welt, "demoAdmin");
  anfragerin = await person(false);

  anlassA = await neuerAnlass("Kirmes");
  anlassB = await neuerAnlass("Ausflug");
  okA = await gruppe("anlass", "OK Kirmes", anlassA);
  okB = await gruppe("anlass", "OK Ausflug", anlassB);
  const rKasse = await rolle(okA, "Kasse", [
    { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
  ]);
  const rLeitung = await rolle(okA, "Leitung", [
    { recht: "anlass.verwalten", geltung: "eigene" },
    { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
    { recht: "anlass.anmeldungen_exportieren", geltung: "eigene" },
  ]);
  const rFremd = await rolle(okB, "Leitung", [
    { recht: "anlass.verwalten", geltung: "eigene" },
    { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
    { recht: "anlass.anmeldungen_exportieren", geltung: "eigene" },
  ]);
  kasse = await person(true);
  kasseOhneFaktor = await person(false);
  okLeitung = await person(true);
  okFremd = await person(true);
  okOhneRolle = await person(true);
  await mitglied(kasse, okA, rKasse);
  await mitglied(kasseOhneFaktor, okA, rKasse);
  await mitglied(okLeitung, okA, rLeitung);
  await mitglied(okFremd, okB, rFremd);
  await mitglied(okOhneRolle, okA);

  teamT = await gruppe("team", "Mat");
  teamF = await gruppe("team", "Küche");
  raumT = await neuerRaum(teamT);
  raumF = await neuerRaum(teamF);
  raumOhne = await neuerRaum(null);
  const rMat = await rolle(teamT, "Materialwart", [
    { recht: "raum.anfrage_entscheiden", geltung: "eigene" },
    { recht: "raum.verwalten", geltung: "eigene" },
  ]);
  materialwart = await person(true);
  materialwartOhneFaktor = await person(false);
  teamMitglied = await person(false);
  teamFremd = await person(false);
  await mitglied(materialwart, teamT, rMat);
  await mitglied(materialwartOhneFaktor, teamT, rMat);
  await mitglied(teamMitglied, teamT);
  await mitglied(teamFremd, teamF);
});

const ANM = (id: string) => `/api/v1/admin/anlaesse/${id}/anmeldungen`;

describe("Anmeldungen sehen und exportieren (OK-Rolle, Geltung «eigene»)", () => {
  test("Kasse mit Recht und zweitem Faktor sieht die Anmeldungen des eigenen Anlasses, nicht die des fremden", async () => {
    expect((await aufruf(kasse, "GET", ANM(anlassA))).status).toBe(200);
    expect((await aufruf(kasse, "GET", ANM(anlassB))).status).toBe(403);
  });

  test("ohne zweiten Faktor: 403 mit Code, auch für das eigene Recht", async () => {
    const r = await aufruf(kasseOhneFaktor, "GET", ANM(anlassA));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe(ZF);
  });

  test("Gruppe ohne Rolle und Rolle ohne das Recht: 403", async () => {
    expect((await aufruf(okOhneRolle, "GET", ANM(anlassA))).status).toBe(403);
    // Die Kasse sieht, exportiert aber nicht
    expect((await aufruf(kasse, "GET", `${ANM(anlassA)}.csv`)).status).toBe(
      403,
    );
  });

  test("Leitung des OK exportiert den eigenen Anlass, den fremden nicht", async () => {
    const eigen = await aufruf(okLeitung, "GET", `${ANM(anlassA)}.csv`);
    expect(eigen.status).toBe(200);
    expect(eigen.text).toContain("Angemeldet von");
    expect((await aufruf(okLeitung, "GET", `${ANM(anlassB)}.csv`)).status).toBe(
      403,
    );
    // Das OK des anderen Anlasses sieht diesen Anlass nicht
    expect((await aufruf(okFremd, "GET", ANM(anlassA))).status).toBe(403);
  });

  test("Abteilungsleitung 200, fremde Abteilung 404, unbekannter Anlass 404 vor dem Recht", async () => {
    expect((await aufruf(al, "GET", ANM(anlassA))).status).toBe(200);
    expect((await aufruf(fremdAl, "GET", ANM(anlassA))).status).toBe(404);
    expect((await aufruf(kasse, "GET", ANM(randomUUID()))).status).toBe(404);
  });
});

describe("Anlässe verwalten (OK-Rolle)", () => {
  test("die Liste zeigt nur die Anlässe der eigenen Gruppen und was die Person daran darf", async () => {
    const r = await aufruf(kasse, "GET", "/api/v1/admin/anlaesse");
    expect(r.status).toBe(200);
    expect(r.body.anlaesse.map((a: Json) => a.id)).toEqual([anlassA]);
    expect(r.body.anlaesse[0].rechte).toEqual({
      verwalten: false,
      anmeldungenSehen: true,
      anmeldungenExportieren: false,
      loeschen: false,
    });
    const alle = await aufruf(al, "GET", "/api/v1/admin/anlaesse?limit=100");
    expect(alle.body.anlaesse.map((a: Json) => a.id)).toEqual(
      expect.arrayContaining([anlassA, anlassB]),
    );
  });

  test("Person ohne Recht an einem Anlass: Liste 403, Detail 403", async () => {
    expect(
      (await aufruf(okOhneRolle, "GET", "/api/v1/admin/anlaesse")).status,
    ).toBe(403);
    expect(
      (await aufruf(okOhneRolle, "GET", `/api/v1/admin/anlaesse/${anlassA}`))
        .status,
    ).toBe(403);
  });

  test("Detail: Kasse liest den eigenen Anlass, den fremden nicht", async () => {
    expect(
      (await aufruf(kasse, "GET", `/api/v1/admin/anlaesse/${anlassA}`)).status,
    ).toBe(200);
    expect(
      (await aufruf(kasse, "GET", `/api/v1/admin/anlaesse/${anlassB}`)).status,
    ).toBe(403);
  });

  test("ändern: Leitung des OK den eigenen Anlass, Kasse und fremdes OK nicht", async () => {
    const pfad = `/api/v1/admin/anlaesse/${anlassA}`;
    expect(
      (await aufruf(okLeitung, "PATCH", pfad, { anmeldungOffen: false }))
        .status,
    ).toBe(204);
    expect(
      (await aufruf(kasse, "PATCH", pfad, { anmeldungOffen: true })).status,
    ).toBe(403);
    expect(
      (await aufruf(okFremd, "PATCH", pfad, { anmeldungOffen: true })).status,
    ).toBe(403);
    expect(
      (await aufruf(fremdAl, "PATCH", pfad, { anmeldungOffen: true })).status,
    ).toBe(404);
  });

  test("die Gruppen für die Sichtbarkeit liest, wer Anlässe verwalten darf, mit Name und Typ und sonst nichts", async () => {
    const r = await aufruf(okLeitung, "GET", "/api/v1/admin/anlaesse/gruppen");
    expect(r.status).toBe(200);
    expect(r.body.tags.length).toBeGreaterThan(0);
    for (const t of r.body.tags) {
      expect(Object.keys(t).sort()).toEqual(["id", "name", "typ"]);
    }
    expect(
      (await aufruf(kasse, "GET", "/api/v1/admin/anlaesse/gruppen")).status,
    ).toBe(403);
    expect(
      (await aufruf(okOhneRolle, "GET", "/api/v1/admin/anlaesse/gruppen"))
        .status,
    ).toBe(403);
  });

  test("anlegen und löschen bleibt der Abteilungsleitung: eine Rolle mit «eigene» genügt nicht", async () => {
    expect(
      (
        await aufruf(okLeitung, "POST", "/api/v1/admin/anlaesse", {
          programmId: randomUUID(),
          anmeldungOffen: true,
          sichtbarkeit: { art: "angemeldet" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await aufruf(okLeitung, "DELETE", `/api/v1/admin/anlaesse/${anlassA}`))
        .status,
    ).toBe(403);
  });

  test("ohne zweiten Faktor 403 mit Code", async () => {
    const ohne = await person(false);
    const rOhne = await rolle(okA, "Ohne Faktor", [
      { recht: "anlass.verwalten", geltung: "eigene" },
    ]);
    await mitglied(ohne, okA, rOhne);
    const r = await aufruf(ohne, "PATCH", `/api/v1/admin/anlaesse/${anlassA}`, {
      anmeldungOffen: true,
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe(ZF);
  });
});

describe("Raumanfragen entscheiden (Team des Raums)", () => {
  test("die Liste zeigt nur die Anfragen der Räume des eigenen Teams", async () => {
    const t = await neueAnfrage(raumT, anfragerin.id!);
    const f = await neueAnfrage(raumF, anfragerin.id!);
    const o = await neueAnfrage(raumOhne, anfragerin.id!);
    for (const k of [materialwart, teamMitglied]) {
      const r = await aufruf(k, "GET", "/api/v1/raeume/anfragen/offen");
      expect(r.status).toBe(200);
      const ids = r.body.anfragen.map((a: Json) => a.id);
      expect(ids).toContain(t);
      expect(ids).not.toContain(f);
      expect(ids).not.toContain(o);
    }
    const fremd = await aufruf(
      teamFremd,
      "GET",
      "/api/v1/raeume/anfragen/offen",
    );
    expect(fremd.body.anfragen.map((a: Json) => a.id)).toEqual(
      expect.arrayContaining([f]),
    );
    expect(fremd.body.anfragen.map((a: Json) => a.id)).not.toContain(t);
    // Räume ohne Team entscheidet die Abteilungsleitung
    const leitung = await aufruf(al, "GET", "/api/v1/raeume/anfragen/offen");
    expect(leitung.body.anfragen.map((a: Json) => a.id)).toContain(o);
  });

  test("Entscheid: Rolle des Teams ja, Team ohne Rolle ja (wie bisher, ohne zweiten Faktor), fremdes Team nein", async () => {
    const ent = (id: string) => `/api/v1/raeume/anfragen/${id}/entscheid`;
    const body = { entscheid: "ablehnen", begruendung: "Passt nicht." };
    const a1 = await neueAnfrage(raumT, anfragerin.id!);
    expect((await aufruf(materialwart, "POST", ent(a1), body)).status).toBe(
      200,
    );
    const a2 = await neueAnfrage(raumT, anfragerin.id!);
    expect((await aufruf(teamMitglied, "POST", ent(a2), body)).status).toBe(
      200,
    );
    const a3 = await neueAnfrage(raumT, anfragerin.id!);
    expect((await aufruf(teamFremd, "POST", ent(a3), body)).status).toBe(403);
    expect((await aufruf(okLeitung, "POST", ent(a3), body)).status).toBe(403);
    // Ein Raum der Abteilung ohne Team: nie das Team, nur die Abteilungsleitung
    const a4 = await neueAnfrage(raumOhne, anfragerin.id!);
    expect((await aufruf(materialwart, "POST", ent(a4), body)).status).toBe(
      403,
    );
    expect((await aufruf(fremdAl, "POST", ent(a1), body)).status).toBe(404);
  });

  test("eine Gruppenrolle mit dem Recht braucht den zweiten Faktor", async () => {
    const a = await neueAnfrage(raumT, anfragerin.id!);
    const r = await aufruf(
      materialwartOhneFaktor,
      "POST",
      `/api/v1/raeume/anfragen/${a}/entscheid`,
      { entscheid: "ablehnen", begruendung: "Nein." },
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe(ZF);
  });

  test("über die eigene Anfrage entscheidet nie dieselbe Person", async () => {
    const a = await neueAnfrage(raumT, materialwart.id!);
    const r = await aufruf(
      materialwart,
      "POST",
      `/api/v1/raeume/anfragen/${a}/entscheid`,
      { entscheid: "ablehnen", begruendung: "Nein." },
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("EIGENE_ANFRAGE");
  });
});

describe("Räume verwalten und einem Team zuweisen", () => {
  test("die Liste der Verwaltung zeigt dem Team seine Räume, der Abteilungsleitung alle", async () => {
    const r = await aufruf(
      materialwart,
      "GET",
      "/api/v1/admin/raeume?limit=100",
    );
    expect(r.status).toBe(200);
    expect(r.body.raeume.map((x: Json) => x.id)).toEqual([raumT]);
    const alle = await aufruf(al, "GET", "/api/v1/admin/raeume?limit=100");
    expect(alle.body.raeume.map((x: Json) => x.id)).toEqual(
      expect.arrayContaining([raumT, raumF, raumOhne]),
    );
    const teamAnsicht = await aufruf(
      al,
      "GET",
      `/api/v1/admin/raeume?teamId=${teamF}`,
    );
    expect(teamAnsicht.body.raeume.map((x: Json) => x.id)).toEqual([raumF]);
    expect(
      (await aufruf(teamMitglied, "GET", "/api/v1/admin/raeume")).status,
    ).toBe(403);
  });

  test("ändern: die Rolle den Raum des Teams, den fremden nicht, das Team nicht", async () => {
    expect(
      (
        await aufruf(materialwart, "PATCH", `/api/v1/admin/raeume/${raumT}`, {
          beschreibung: "Mit Schlüssel",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await aufruf(materialwart, "PATCH", `/api/v1/admin/raeume/${raumF}`, {
          beschreibung: "Nein",
        })
      ).status,
    ).toBe(403);
    // Das Team wechseln ist «zuweisen», nicht «verwalten»
    expect(
      (
        await aufruf(materialwart, "PATCH", `/api/v1/admin/raeume/${raumT}`, {
          teamId: teamF,
        })
      ).status,
    ).toBe(403);
    // Dieselbe Angabe, die nichts ändert, ist erlaubt
    expect(
      (
        await aufruf(materialwart, "PATCH", `/api/v1/admin/raeume/${raumT}`, {
          teamId: teamT,
          beschreibung: "Nochmals",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await aufruf(
          materialwart,
          "PATCH",
          `/api/v1/admin/raeume/${randomUUID()}`,
          {
            beschreibung: "x",
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await aufruf(materialwart, "POST", "/api/v1/admin/raeume", {
          name: "Neu",
        })
      ).status,
    ).toBe(403);
  });

  test("zuweisen und entziehen: die Abteilungsleitung, das Team danach sieht und entscheidet", async () => {
    const raum = await neuerRaum(null);
    const a = await neueAnfrage(raum, anfragerin.id!);
    const ent = `/api/v1/raeume/anfragen/${a}/entscheid`;
    const body = { entscheid: "ablehnen", begruendung: "Nein." };
    expect((await aufruf(teamMitglied, "POST", ent, body)).status).toBe(403);
    expect(
      (
        await aufruf(al, "PATCH", `/api/v1/admin/raeume/${raum}`, {
          teamId: teamT,
        })
      ).status,
    ).toBe(204);
    const liste = await aufruf(
      teamMitglied,
      "GET",
      "/api/v1/raeume/anfragen/offen",
    );
    expect(liste.body.anfragen.map((x: Json) => x.id)).toContain(a);
    expect((await aufruf(teamMitglied, "POST", ent, body)).status).toBe(200);
    // Entziehen: Der Raum gehört wieder keinem Team
    expect(
      (
        await aufruf(al, "PATCH", `/api/v1/admin/raeume/${raum}`, {
          teamId: null,
        })
      ).status,
    ).toBe(204);
    const [zeile] = await db
      .select({ team: schema.raum.teamTagId })
      .from(schema.raum)
      .where(eq(schema.raum.id, raum));
    expect(zeile?.team).toBeNull();
    const b = await neueAnfrage(raum, anfragerin.id!);
    expect(
      (
        await aufruf(
          teamMitglied,
          "POST",
          `/api/v1/raeume/anfragen/${b}/entscheid`,
          body,
        )
      ).status,
    ).toBe(403);
  });

  test("zuweisen ist ein eigenes Recht: eine Rolle mit «zuweisen» ändert nur das Team", async () => {
    const zuweiser = await person(true);
    const rZ = await rolle(teamF, "Raumplanung", [
      { recht: "raum.team_zuweisen", geltung: "alle" },
    ]);
    await mitglied(zuweiser, teamF, rZ);
    const raum = await neuerRaum(null);
    const pfad = `/api/v1/admin/raeume/${raum}`;
    expect(
      (await aufruf(zuweiser, "PATCH", pfad, { teamId: teamF })).status,
    ).toBe(204);
    expect(
      (await aufruf(zuweiser, "PATCH", pfad, { beschreibung: "x" })).status,
    ).toBe(403);
    // Die Liste öffnet sich mit diesem Recht und zeigt alle Räume
    const r = await aufruf(zuweiser, "GET", "/api/v1/admin/raeume?limit=100");
    expect(r.status).toBe(200);
    expect(r.body.raeume.map((x: Json) => x.id)).toEqual(
      expect.arrayContaining([raumT, raumF, raumOhne, raum]),
    );
    // Ein Team, das nicht zur Abteilung gehört, bleibt 400
    expect(
      (await aufruf(zuweiser, "PATCH", pfad, { teamId: randomUUID() })).status,
    ).toBe(400);
  });

  test("einen Raum anlegen mit Team verlangt «verwalten» für alle und «zuweisen»", async () => {
    const r = await aufruf(al, "POST", "/api/v1/admin/raeume", {
      name: `Neu ${randomUUID().slice(0, 6)}`,
      teamId: teamT,
    });
    expect(r.status).toBe(201);
    expect(
      (
        await aufruf(teamMitglied, "POST", "/api/v1/admin/raeume", {
          name: "x",
        })
      ).status,
    ).toBe(403);
  });
});

describe("Belegung und Zugangssignale", () => {
  test("die Belegung sieht, wer ein Team eines Raums trägt; Eltern nicht", async () => {
    const pfad = "/api/v1/raeume/belegung?von=2099-01-01&bis=2099-01-07";
    expect((await aufruf(teamMitglied, "GET", pfad)).status).toBe(200);
    expect((await aufruf(materialwart, "GET", pfad)).status).toBe(200);
    expect((await aufruf(anfragerin, "GET", pfad)).status).toBe(403);
  });

  test("GET /redaktion/ich nennt die Rechte für Räume und Anlässe", async () => {
    const mat = (await aufruf(materialwart, "GET", "/api/v1/redaktion/ich"))
      .body;
    expect(mat.termine).toMatchObject({
      raumBelegung: true,
      raumAnfragen: true,
      raumVerwalten: true,
      raumZuweisen: false,
      anlassVerwalten: false,
      vorschlaegeEntscheiden: false,
    });
    expect(mat.belegung).toBe(true);
    const k = (await aufruf(kasse, "GET", "/api/v1/redaktion/ich")).body;
    expect(k.termine).toMatchObject({
      anmeldungenSehen: true,
      anmeldungenExportieren: false,
      anlassVerwalten: false,
      raumAnfragen: false,
    });
    const eltern = (await aufruf(anfragerin, "GET", "/api/v1/redaktion/ich"))
      .body;
    expect(Object.values(eltern.termine).every((v) => v === false)).toBe(true);
  });
});

describe("Termine: Vorschläge, Warnliste, Kategorien", () => {
  test("Vorschläge entscheiden und Warnliste und Kategorien: einzeln vergebbar, mit zweitem Faktor", async () => {
    const gruppeX = await gruppe("team", "Planung");
    const rolleX = await rolle(gruppeX, "Termine", [
      { recht: "vorschlag.entscheiden", geltung: "alle" },
      { recht: "termine.warnliste", geltung: "alle" },
    ]);
    const mit = await person(true);
    const ohne = await person(false);
    const fremd = await person(true);
    await mitglied(mit, gruppeX, rolleX);
    await mitglied(ohne, gruppeX, rolleX);
    const liste = "/api/v1/admin/termin-vorschlaege";
    expect((await aufruf(mit, "GET", liste)).status).toBe(200);
    const r = await aufruf(ohne, "GET", liste);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe(ZF);
    expect((await aufruf(fremd, "GET", liste)).status).toBe(403);
    expect(
      (await aufruf(mit, "GET", "/api/v1/admin/termine/warnungen")).status,
    ).toBe(200);
    // Die Rolle hat «Kategorien zuordnen» nicht
    expect(
      (await aufruf(mit, "GET", "/api/v1/admin/kategorie-zuordnungen")).status,
    ).toBe(403);
  });

  test("Termine vorschlagen: eine Gruppenrolle gibt es auch Personen ohne Funktion", async () => {
    // Eine Gruppe vom Typ «anlass»: Team und Funktion dürfen als Mitglieder schon vorschlagen (Annahme A9)
    const gruppeX = await gruppe(
      "anlass",
      "OK Vorschlag",
      await neuerAnlass("Fest"),
    );
    const rolleX = await rolle(gruppeX, "Vorschlagende", [
      { recht: "vorschlag.einreichen", geltung: "alle" },
    ]);
    const k = await person(false);
    const optionen = "/api/v1/termin-vorschlaege/optionen";
    expect((await aufruf(k, "GET", optionen)).body.darfVorschlagen).toBe(false);
    await db
      .insert(schema.personTag)
      .values({ userId: k.id!, tagId: gruppeX, rolle: null, rolleId: rolleX });
    expect((await aufruf(k, "GET", optionen)).body.darfVorschlagen).toBe(true);
  });

  test("Kategorien zuordnen: nur wer das Recht hat", async () => {
    const gruppeX = await gruppe("team", "Kalender");
    const rolleX = await rolle(gruppeX, "Kalenderpflege", [
      { recht: "termine.kategorien_zuordnen", geltung: "alle" },
    ]);
    const mit = await person(true);
    await mitglied(mit, gruppeX, rolleX);
    expect(
      (await aufruf(mit, "GET", "/api/v1/admin/kategorie-zuordnungen")).status,
    ).toBe(200);
    expect(
      (await aufruf(kasse, "GET", "/api/v1/admin/kategorie-zuordnungen"))
        .status,
    ).toBe(403);
  });
});
