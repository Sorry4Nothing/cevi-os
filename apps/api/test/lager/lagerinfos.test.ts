import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
import { raeumeDateienOhneVerweisAuf } from "../../src/lager/datei-verweise.js";
import { pruefeNotfall, pruefePackliste } from "../../src/lager/lagerinfos.js";
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
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const TELEFON = {
  team: "+41 79 111 22 33",
  leitung: "+41 79 222 33 44",
  lesen: "+41 79 333 44 55",
};

// Ein Lager der Testabteilung mit allen Rollen; die falsche Zeile der fremden Abteilung gibt nichts frei
async function legeLager(
  abteilungId = welt.testabteilungId,
  status: "aktiv" | "abgeschlossen" = "aktiv",
  mitglieder = true,
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Infolager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
      ort: "Lagerhaus Beispielberg",
      adresse: "Beispielweg 1, 1234 Beispielort",
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  if (mitglieder) {
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
  return id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  // Telefonnummern der Konten: Sie dürfen nur dort erscheinen, wo ein Notfall-Kontakt sie zeigt
  for (const [persona, telefon] of Object.entries(TELEFON)) {
    await db
      .update(schema.user)
      .set({ telefon })
      .where(eq(schema.user.id, konten[persona as LagerPersona].id!));
  }
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

const L = (id: string) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;

// Alle Personas ausser den Lager-Mitgliedern gleichen Rechts; die Lesenden eines Lagers
const LESENDE = [
  "abteilungsleitung",
  "lagerleitung",
  "leitung",
  "team",
  "lesen",
] as const;

describe("Packliste", () => {
  let id: string;
  let normal: { id: string; version: number };
  let geheim: { id: string; version: number };
  beforeAll(async () => {
    id = await legeLager();
    const a = await anfrage(leiter(), "POST", `${L(id)}/packliste/punkte`, {
      abschnitt: "Kleidung",
      text: "Regenjacke",
    });
    expect(a.status).toBe(201);
    normal = a.body;
    const b = await anfrage(leiter(), "POST", `${L(id)}/packliste/punkte`, {
      abschnitt: "Material",
      text: "Kasse und Schlüssel",
      nurLagerleitung: true,
    });
    expect(b.status).toBe(201);
    geheim = b.body;
  });

  test("Punkte mit nur_lagerleitung liest nur, wer vertrauliches.lesen hat", async () => {
    for (const p of LESENDE) {
      const a = await anfrage(konten[p], "GET", `${L(id)}/packliste`);
      expect(a.status).toBe(200);
      const texte = a.body.punkte.map((x: { text: string }) => x.text);
      const vertraulich = p === "abteilungsleitung" || p === "lagerleitung";
      expect(texte).toContain("Regenjacke");
      expect(texte.includes("Kasse und Schlüssel"), p).toBe(vertraulich);
      expect(a.body.punkte[0]).toMatchObject({ zustand: "offen" });
    }
    // Der einzelne Punkt ist für die anderen unbekannt, auch zum Abhaken
    for (const p of ["leitung", "team"] as const) {
      const a = await anfrage(
        konten[p],
        "PUT",
        `${L(id)}/packliste/punkte/${geheim.id}/zustand`,
        { zustand: "abgehakt" },
      );
      expect(a.status, p).toBe(404);
    }
  });

  test("Nicht-Mitglied und fremde Abteilung 404, ohne Recht 403", async () => {
    for (const p of ["ohneMitgliedschaft", "fremdeAbteilung"] as const) {
      expect(
        (await anfrage(konten[p], "GET", `${L(id)}/packliste`)).status,
      ).toBe(404);
    }
    for (const p of ["leitung", "team", "lesen"] as const) {
      expect(
        (
          await anfrage(konten[p], "POST", `${L(id)}/packliste/punkte`, {
            abschnitt: "A",
            text: "B",
          })
        ).status,
        p,
      ).toBe(403);
    }
    // Lesen darf nicht abhaken
    expect(
      (
        await anfrage(
          konten.lesen,
          "PUT",
          `${L(id)}/packliste/punkte/${normal.id}/zustand`,
          { zustand: "abgehakt" },
        )
      ).status,
    ).toBe(403);
  });

  test("jede Person hat ihre eigene Kopie; gespeichert sind nur die Abweichungen", async () => {
    const vorher = (
      await db
        .select()
        .from(schema.packlisteAbhaken)
        .where(eq(schema.packlisteAbhaken.lagerId, id))
    ).length;
    for (const zustand of ["abgehakt", "abgehakt", "entfernt"]) {
      const a = await anfrage(
        konten.team,
        "PUT",
        `${L(id)}/packliste/punkte/${normal.id}/zustand`,
        { zustand },
      );
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ id: normal.id, zustand });
    }
    const team = await anfrage(konten.team, "GET", `${L(id)}/packliste`);
    expect(team.body.punkte[0].zustand).toBe("entfernt");
    // Die Leitung sieht ihre eigene Kopie, unberührt
    const leitung = await anfrage(konten.leitung, "GET", `${L(id)}/packliste`);
    expect(leitung.body.punkte[0].zustand).toBe("offen");
    // Eine Zeile je Abweichung, auch nach drei Aufrufen
    const nachher = await db
      .select()
      .from(schema.packlisteAbhaken)
      .where(eq(schema.packlisteAbhaken.lagerId, id));
    expect(nachher.length - vorher).toBe(1);
    // «offen» nimmt die Abweichung zurück: keine Zeile
    await anfrage(
      konten.team,
      "PUT",
      `${L(id)}/packliste/punkte/${normal.id}/zustand`,
      { zustand: "offen" },
    );
    expect(
      await db
        .select()
        .from(schema.packlisteAbhaken)
        .where(eq(schema.packlisteAbhaken.lagerId, id)),
    ).toHaveLength(vorher);
    // Unbekannte Werte sind 400
    expect(
      (
        await anfrage(
          konten.team,
          "PUT",
          `${L(id)}/packliste/punkte/${normal.id}/zustand`,
          { zustand: "fertig" },
        )
      ).status,
    ).toBe(400);
  });

  test("eigene Punkte sehen nur ihre Besitzer, auch die Lagerleitung nicht", async () => {
    const neu = await anfrage(
      konten.team,
      "POST",
      `${L(id)}/packliste/eigene`,
      {
        abschnitt: "Sonstiges",
        text: "Gitarre",
      },
    );
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({ text: "Gitarre", abgehakt: false });
    const team = await anfrage(konten.team, "GET", `${L(id)}/packliste`);
    expect(team.body.eigene).toHaveLength(1);
    for (const p of ["lagerleitung", "leitung", "abteilungsleitung"] as const) {
      const a = await anfrage(konten[p], "GET", `${L(id)}/packliste`);
      expect(a.body.eigene, p).toEqual([]);
      // Ein fremder Punkt ist unbekannt (404), ändern und löschen auch
      expect(
        (
          await anfrage(
            konten[p],
            "PATCH",
            `${L(id)}/packliste/eigene/${neu.body.id}`,
            { abgehakt: true },
          )
        ).status,
        p,
      ).toBe(404);
      expect(
        (
          await anfrage(
            konten[p],
            "DELETE",
            `${L(id)}/packliste/eigene/${neu.body.id}`,
          )
        ).status,
        p,
      ).toBe(404);
    }
    const haken = await anfrage(
      konten.team,
      "PATCH",
      `${L(id)}/packliste/eigene/${neu.body.id}`,
      { abgehakt: true },
    );
    expect(haken.body.abgehakt).toBe(true);
    // Unbekannte Felder und leere Änderungen sind 400
    for (const body of [{}, { person_id: randomUUID() }]) {
      expect(
        (
          await anfrage(
            konten.team,
            "PATCH",
            `${L(id)}/packliste/eigene/${neu.body.id}`,
            body,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await anfrage(
          konten.team,
          "DELETE",
          `${L(id)}/packliste/eigene/${neu.body.id}`,
        )
      ).status,
    ).toBe(204);
    // Lesen darf keine eigenen Punkte anlegen
    expect(
      (
        await anfrage(konten.lesen, "POST", `${L(id)}/packliste/eigene`, {
          abschnitt: "A",
          text: "B",
        })
      ).status,
    ).toBe(403);
  });

  test("Obergrenzen: 100 eigene Punkte, 500 Punkte der Vorlage", async () => {
    const lager = await legeLager();
    await db.insert(schema.packlisteEigen).values(
      Array.from({ length: 100 }, (_, i) => ({
        lagerId: lager,
        personId: konten.team.id!,
        abschnitt: "A",
        text: `P${i}`,
        reihenfolge: i,
      })),
    );
    const a = await anfrage(
      konten.team,
      "POST",
      `${L(lager)}/packliste/eigene`,
      {
        abschnitt: "A",
        text: "Zu viel",
      },
    );
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("LIMIT_ERREICHT");
    await db.insert(schema.packlistePunkt).values(
      Array.from({ length: 500 }, (_, i) => ({
        lagerId: lager,
        abschnitt: "A",
        text: `P${i}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    );
    const b = await anfrage(leiter(), "POST", `${L(lager)}/packliste/punkte`, {
      abschnitt: "A",
      text: "Zu viel",
    });
    expect(b.status).toBe(409);
    expect(b.body.code).toBe("LIMIT_ERREICHT");
  });

  test("Ändern und Löschen der Vorlage mit Version; die Abweichung fällt mit dem Punkt weg", async () => {
    const p = await anfrage(leiter(), "POST", `${L(id)}/packliste/punkte`, {
      abschnitt: "Hygiene",
      text: "Zahnbürste",
    });
    await anfrage(
      konten.team,
      "PUT",
      `${L(id)}/packliste/punkte/${p.body.id}/zustand`,
      { zustand: "abgehakt" },
    );
    const alt = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/packliste/punkte/${p.body.id}`,
      { version: 1, text: "Zahnbürste und Zahnpasta" },
    );
    expect(alt.status).toBe(200);
    expect(alt.body).toMatchObject({
      version: 2,
      text: "Zahnbürste und Zahnpasta",
    });
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L(id)}/packliste/punkte/${p.body.id}`,
      { version: 1, text: "x" },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
    const weg = await anfrage(
      leiter(),
      "DELETE",
      `${L(id)}/packliste/punkte/${p.body.id}?version=2`,
    );
    expect(weg.status).toBe(204);
    const team = await anfrage(konten.team, "GET", `${L(id)}/packliste`);
    expect(
      team.body.punkte.some((x: { id: string }) => x.id === p.body.id),
    ).toBe(false);
  });

  test("der Feed nennt einen Punkt nur Rollen, die ihn lesen dürfen", async () => {
    const lager = await legeLager();
    const g = await anfrage(leiter(), "POST", `${L(lager)}/packliste/punkte`, {
      abschnitt: "Material",
      text: "Kasse",
      nurLagerleitung: true,
    });
    const feed = async (p: LagerPersona) =>
      (await anfrage(konten[p], "GET", `${L(lager)}/aenderungen?seit=0`)).body
        .eintraege as { objekttyp: string; id: string }[];
    expect((await feed("lagerleitung")).map((e) => e.id)).toContain(g.body.id);
    for (const p of ["team", "leitung", "lesen"] as const) {
      expect(
        (await feed(p)).map((e) => e.id),
        p,
      ).not.toContain(g.body.id);
    }
  });

  test("ein abgeschlossenes Lager ist schreibgeschützt (409)", async () => {
    const lager = await legeLager(welt.testabteilungId, "abgeschlossen");
    expect(
      (
        await anfrage(leiter(), "POST", `${L(lager)}/packliste/punkte`, {
          abschnitt: "A",
          text: "B",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await anfrage(konten.team, "POST", `${L(lager)}/packliste/eigene`, {
          abschnitt: "A",
          text: "B",
        })
      ).status,
    ).toBe(409);
  });
});

describe("Notfall", () => {
  let id: string;
  beforeAll(async () => {
    id = await legeLager();
    // Das Ressort «si» mit einem Teilbereich: Leitung und Stellvertretung erscheinen im Notfall, eine fremde Leitung nicht
    const [si] = await db
      .insert(schema.ressort)
      .values({
        lagerId: id,
        kuerzel: "SI",
        name: "Sicherheit",
        leitungPersonId: konten.leitung.id!,
        lagerSeq: 0,
      })
      .returning({ id: schema.ressort.id });
    await db.insert(schema.ressort).values([
      {
        lagerId: id,
        kuerzel: "san",
        name: "Sanität",
        parentId: si!.id,
        stvPersonId: konten.lesen.id!,
        lagerSeq: 0,
      },
      {
        lagerId: id,
        kuerzel: "kue",
        name: "Küche",
        leitungPersonId: konten.team.id!,
        lagerSeq: 0,
      },
    ]);
  });

  test("das Team sieht nur Notfall-Kontakte mit Telefon, sonst keine Nummer", async () => {
    // Ein Name mit Nummer und ein Konto des Lagers (Nummer aus dem Konto)
    const extern = await anfrage(
      leiter(),
      "POST",
      `${L(id)}/notfall/kontakte`,
      {
        funktion: "Lagerarzt",
        name: "Dr. Beispiel",
        telefon: "044 123 45 67",
      },
    );
    expect(extern.status).toBe(201);
    expect(extern.body).toMatchObject({
      quelle: "eintrag",
      name: "Dr. Beispiel",
      telefon: "044 123 45 67",
      personId: null,
    });
    const konto = await anfrage(leiter(), "POST", `${L(id)}/notfall/kontakte`, {
      funktion: "Lagerleitung",
      personId: konten.lagerleitung.id,
    });
    expect(konto.status).toBe(201);
    for (const p of LESENDE) {
      const a = await anfrage(konten[p], "GET", `${L(id)}/notfall`);
      expect(a.status, p).toBe(200);
      expect(a.body.adresse).toMatchObject({
        ort: "Lagerhaus Beispielberg",
        adresse: "Beispielweg 1, 1234 Beispielort",
        kartenLink: null,
      });
      const funktionen = a.body.kontakte.map(
        (k: { funktion: string }) => k.funktion,
      );
      expect(funktionen).toEqual([
        "Lagerarzt",
        "Lagerleitung",
        "Sicherheit: Leitung",
        "Sanität: Stellvertretung",
      ]);
      const text = JSON.stringify(a.body);
      // Nummern der Sicherheitsverantwortlichen aus dem Konto; die Küche gehört nicht dazu
      expect(text).toContain(TELEFON.leitung);
      expect(text).toContain(TELEFON.lesen);
      expect(text).not.toContain(TELEFON.team);
    }
  });

  test("ein erfasstes Konto kommt nicht noch einmal aus dem Ressort", async () => {
    const lager = await legeLager();
    const [si] = await db
      .insert(schema.ressort)
      .values({
        lagerId: lager,
        kuerzel: "si",
        name: "Sicherheit",
        leitungPersonId: konten.leitung.id!,
        lagerSeq: 0,
      })
      .returning({ id: schema.ressort.id });
    expect(si).toBeTruthy();
    const a = await anfrage(leiter(), "POST", `${L(lager)}/notfall/kontakte`, {
      funktion: "Sicherheit",
      personId: konten.leitung.id,
      telefon: "079 000 11 22",
    });
    expect(a.status).toBe(201);
    const n = await anfrage(konten.team, "GET", `${L(lager)}/notfall`);
    expect(n.body.kontakte).toHaveLength(1);
    // Die eigene Nummer des Eintrags geht vor der Nummer des Kontos
    expect(n.body.kontakte[0]).toMatchObject({
      telefon: "079 000 11 22",
      quelle: "eintrag",
    });
  });

  test("Kontakte prüfen: Name braucht Nummer, nur Mitglieder, kein Konto und Name zugleich", async () => {
    const post = (body: Record<string, unknown>) =>
      anfrage(leiter(), "POST", `${L(id)}/notfall/kontakte`, body);
    expect((await post({ funktion: "A", name: "B" })).status).toBe(400);
    expect(
      (
        await post({
          funktion: "A",
          name: "B",
          personId: konten.team.id,
          telefon: "079 123 45 67",
        })
      ).status,
    ).toBe(400);
    expect((await post({ funktion: "A" })).status).toBe(400);
    expect(
      (await post({ funktion: "A", name: "B", telefon: "abc" })).status,
    ).toBe(400);
    expect(
      (await post({ funktion: "A", name: "B", telefon: "079 123", x: 1 }))
        .status,
    ).toBe(400);
    // Ein Konto ohne Mitgliedschaft im Lager
    const fremd = await post({
      funktion: "A",
      personId: konten.ohneMitgliedschaft.id,
    });
    expect(fremd.status).toBe(400);
    expect(fremd.body.code).toBe("KEIN_MITGLIED");
  });

  test("Kontakt ändern und löschen: Konto bleibt Konto, Name behält die Nummer", async () => {
    const lager = await legeLager();
    const name = await anfrage(
      leiter(),
      "POST",
      `${L(lager)}/notfall/kontakte`,
      {
        funktion: "Arzt",
        name: "Dr. Muster",
        telefon: "044 111 22 33",
      },
    );
    const konto = await anfrage(
      leiter(),
      "POST",
      `${L(lager)}/notfall/kontakte`,
      {
        funktion: "Leitung",
        personId: konten.leitung.id,
      },
    );
    const k = (kid: string) => `${L(lager)}/notfall/kontakte/${kid}`;
    // Das Konto hat keinen Namen zu ändern
    expect(
      (
        await anfrage(leiter(), "PATCH", k(konto.body.id), {
          version: 1,
          name: "X",
        })
      ).status,
    ).toBe(400);
    // Die Nummer eines Namens bleibt Pflicht
    const ohne = await anfrage(leiter(), "PATCH", k(name.body.id), {
      version: 1,
      telefon: null,
    });
    expect(ohne.status).toBe(400);
    expect(ohne.body.code).toBe("TELEFON_FEHLT");
    const neu = await anfrage(leiter(), "PATCH", k(name.body.id), {
      version: 1,
      telefon: "044 999 88 77",
    });
    expect(neu.body).toMatchObject({ telefon: "044 999 88 77", version: 2 });
    // Die eigene Nummer eines Kontos lässt sich zurücknehmen
    const eigen = await anfrage(leiter(), "PATCH", k(konto.body.id), {
      version: 1,
      telefon: "079 111 22 33",
    });
    expect(eigen.body.telefon).toBe("079 111 22 33");
    const zurueck = await anfrage(leiter(), "PATCH", k(konto.body.id), {
      version: 2,
      telefon: null,
    });
    expect(zurueck.body.telefon).toBe(TELEFON.leitung);
    expect(
      (await anfrage(leiter(), "DELETE", `${k(name.body.id)}?version=2`))
        .status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L(lager)}/notfall`)).body.kontakte,
    ).toHaveLength(1);
  });

  test("nur die Lagerleitung ändert Kontakte; Leitung, Team und Lesen bekommen 403", async () => {
    for (const p of ["leitung", "team", "lesen"] as const) {
      expect(
        (
          await anfrage(konten[p], "POST", `${L(id)}/notfall/kontakte`, {
            funktion: "A",
            name: "B",
            telefon: "079 123 45 67",
          })
        ).status,
        p,
      ).toBe(403);
      expect(
        (
          await anfrage(konten[p], "PUT", `${L(id)}/notfall/karte`, {
            kartenLink: null,
          })
        ).status,
        p,
      ).toBe(403);
    }
  });

  test("Kartenlink: nur gespeichert, nur https, im Protokoll", async () => {
    const lager = await legeLager();
    const a = await anfrage(leiter(), "PUT", `${L(lager)}/notfall/karte`, {
      kartenLink: "https://maps.example.org/?q=Beispielweg+1",
    });
    expect(a.status).toBe(200);
    const n = await anfrage(konten.team, "GET", `${L(lager)}/notfall`);
    expect(n.body.adresse.kartenLink).toBe(
      "https://maps.example.org/?q=Beispielweg+1",
    );
    for (const schlecht of [
      "javascript:alert(1)",
      "http://maps.example.org/",
      "https://user:pw@maps.example.org/",
      "//maps.example.org/",
    ]) {
      expect(
        (
          await anfrage(leiter(), "PUT", `${L(lager)}/notfall/karte`, {
            kartenLink: schlecht,
          })
        ).status,
        schlecht,
      ).toBe(400);
    }
    const protokoll = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "lager_notfall_karte"),
          eq(schema.auditLog.zielId, lager),
        ),
      );
    expect(protokoll).toHaveLength(1);
    // Das Protokoll nennt nicht den Link
    expect(JSON.stringify(protokoll[0]!.details)).not.toContain("maps");
    expect(
      (
        await anfrage(leiter(), "PUT", `${L(lager)}/notfall/karte`, {
          kartenLink: null,
        })
      ).body.kartenLink,
    ).toBeNull();
  });

  test("Info-Abschnitte mit Merkmal «notfall» erscheinen im Fenster, vertrauliche nur für die Lagerleitung", async () => {
    const lager = await legeLager();
    const mach = (body: Record<string, unknown>) =>
      anfrage(leiter(), "POST", `${L(lager)}/infos`, body);
    await mach({ titel: "Treffpunkt", text: "Beim Brunnen", notfall: true });
    await mach({
      titel: "Notfall vertraulich",
      notfall: true,
      nurLagerleitung: true,
    });
    await mach({ titel: "Nur Info" });
    const team = await anfrage(konten.team, "GET", `${L(lager)}/notfall`);
    expect(team.body.infos.map((i: { titel: string }) => i.titel)).toEqual([
      "Treffpunkt",
    ]);
    const leitung = await anfrage(leiter(), "GET", `${L(lager)}/notfall`);
    expect(leitung.body.infos.map((i: { titel: string }) => i.titel)).toEqual([
      "Treffpunkt",
      "Notfall vertraulich",
    ]);
  });
});

describe("Infos", () => {
  let id: string;
  beforeAll(async () => {
    id = await legeLager();
  });

  async function datei(lagerId: string, name = "Plan.pdf") {
    const [d] = await db
      .insert(schema.lagerDatei)
      .values({
        lagerId,
        anzeigename: name,
        link: `https://beispiel.sharepoint.com/${randomUUID()}`,
        lagerSeq: 0,
        erstelltVon: konten.lagerleitung.id!,
      })
      .returning();
    return d!;
  }

  test("Abschnitt mit Text, Links und Dateien als Verknüpfungen", async () => {
    const d = await datei(id);
    const a = await anfrage(leiter(), "POST", `${L(id)}/infos`, {
      titel: "Anreise",
      text: "Treffpunkt Bahnhof",
      links: [{ titel: "Fahrplan", url: "https://fahrplan.example.org/" }],
      dateiIds: [d.id],
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      titel: "Anreise",
      version: 1,
      nurLagerleitung: false,
      notfall: false,
      links: [{ titel: "Fahrplan", url: "https://fahrplan.example.org/" }],
    });
    expect(a.body.dateien).toHaveLength(1);
    expect(a.body.dateien[0]).toMatchObject({
      id: d.id,
      anzeigename: "Plan.pdf",
      link: d.link,
    });
    // Das Team liest den Abschnitt und die Verknüpfung (über den Datensatz, der sie einbindet)
    const team = await anfrage(
      konten.team,
      "GET",
      `${L(id)}/infos/${a.body.id}`,
    );
    expect(team.status).toBe(200);
    expect(team.body.dateien[0].id).toBe(d.id);
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/dateien/${d.id}`)).status,
    ).toBe(200);
    // Ändern ersetzt die Menge der Dateien; die Version steigt auch bei nur neuen Dateien
    const d2 = await datei(id, "Karte.pdf");
    const b = await anfrage(leiter(), "PATCH", `${L(id)}/infos/${a.body.id}`, {
      version: 1,
      dateiIds: [d2.id],
    });
    expect(b.status).toBe(200);
    expect(b.body.version).toBe(2);
    expect(b.body.dateien.map((x: { id: string }) => x.id)).toEqual([d2.id]);
    // Ein Wegfall gibt die Datei nicht frei: Ohne Verweis sieht das Team sie nicht mehr
    expect(
      (await anfrage(konten.team, "GET", `${L(id)}/dateien/${d.id}`)).status,
    ).toBe(404);
  });

  test("Links nur https und höchstens 20; Dateien nur aus diesem Lager; strikte Felder", async () => {
    const fremd = await legeLager();
    const andere = await datei(fremd);
    const post = (body: Record<string, unknown>) =>
      anfrage(leiter(), "POST", `${L(id)}/infos`, { titel: "T", ...body });
    expect((await post({ dateiIds: [andere.id] })).status).toBe(400);
    expect((await post({ dateiIds: [randomUUID()] })).status).toBe(400);
    expect(
      (
        await post({
          links: [{ titel: "x", url: "javascript:alert(1)" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ links: [{ titel: "x", url: "http://a.example.org/" }] }))
        .status,
    ).toBe(400);
    const viele = Array.from({ length: 21 }, (_, i) => ({
      titel: `L${i}`,
      url: "https://a.example.org/",
    }));
    expect((await post({ links: viele })).status).toBe(400);
    expect((await post({ unbekannt: 1 })).status).toBe(400);
    expect((await post({ titel: "" })).status).toBe(400);
  });

  test("Abschnitte mit nur_lagerleitung sind für Rollen ohne vertrauliches.lesen unbekannt", async () => {
    const lager = await legeLager();
    const g = await anfrage(leiter(), "POST", `${L(lager)}/infos`, {
      titel: "Schlüssel",
      nurLagerleitung: true,
    });
    const o = await anfrage(leiter(), "POST", `${L(lager)}/infos`, {
      titel: "Haus",
    });
    for (const p of LESENDE) {
      const liste = await anfrage(konten[p], "GET", `${L(lager)}/infos`);
      expect(liste.status).toBe(200);
      const titel = liste.body.abschnitte.map(
        (x: { titel: string }) => x.titel,
      );
      const vertraulich = p === "abteilungsleitung" || p === "lagerleitung";
      expect(titel.includes("Schlüssel"), p).toBe(vertraulich);
      expect(titel).toContain("Haus");
      const einzeln = await anfrage(
        konten[p],
        "GET",
        `${L(lager)}/infos/${g.body.id}`,
      );
      expect(einzeln.status, p).toBe(vertraulich ? 200 : 404);
    }
    // Der Feed meldet ihn nur der Lagerleitung
    const feed = async (p: LagerPersona) =>
      (
        (await anfrage(konten[p], "GET", `${L(lager)}/aenderungen?seit=0`)).body
          .eintraege as { id: string }[]
      ).map((e) => e.id);
    expect(await feed("lagerleitung")).toContain(g.body.id);
    for (const p of ["team", "leitung", "lesen"] as const) {
      const ids = await feed(p);
      expect(ids, p).toContain(o.body.id);
      expect(ids, p).not.toContain(g.body.id);
    }
    // Eine Datei an einem vertraulichen Abschnitt bleibt für das Team unsichtbar
    const d = await datei(lager, "Schluessel.pdf");
    await anfrage(leiter(), "PATCH", `${L(lager)}/infos/${g.body.id}`, {
      version: 1,
      dateiIds: [d.id],
    });
    expect(
      (await anfrage(konten.team, "GET", `${L(lager)}/dateien/${d.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(konten.lagerleitung, "GET", `${L(lager)}/dateien/${d.id}`))
        .status,
    ).toBe(200);
  });

  test("sortierbar über reihenfolge; die Seite hat einen Cursor", async () => {
    const lager = await legeLager();
    const ids: { id: string; version: number }[] = [];
    for (const titel of ["A", "B", "C"]) {
      const r = await anfrage(leiter(), "POST", `${L(lager)}/infos`, { titel });
      ids.push(r.body);
    }
    const liste = (q = "") =>
      anfrage(konten.team, "GET", `${L(lager)}/infos${q}`);
    expect(
      (await liste()).body.abschnitte.map((x: { titel: string }) => x.titel),
    ).toEqual(["A", "B", "C"]);
    const s = await anfrage(leiter(), "PUT", `${L(lager)}/infos/reihenfolge`, {
      eintraege: [ids[2]!, ids[0]!, ids[1]!].map((x) => ({
        id: x.id,
        version: x.version,
      })),
    });
    expect(s.status).toBe(204);
    const seite1 = await liste("?limit=2");
    expect(
      seite1.body.abschnitte.map((x: { titel: string }) => x.titel),
    ).toEqual(["C", "A"]);
    const seite2 = await liste(`?limit=2&nach=${seite1.body.naechster}`);
    expect(
      seite2.body.abschnitte.map((x: { titel: string }) => x.titel),
    ).toEqual(["B"]);
    expect(seite2.body.naechster).toBeNull();
    // Eine unbekannte ID ändert nichts
    const schlecht = await anfrage(
      leiter(),
      "PUT",
      `${L(lager)}/infos/reihenfolge`,
      { eintraege: [{ id: randomUUID(), version: 1 }] },
    );
    expect(schlecht.status).toBe(404);
  });

  test("Das Merkmal «notfall» braucht auch notfall.bearbeiten", async () => {
    const lager = await legeLager();
    // Die Leitung darf Infos bearbeiten, aber nicht den Notfall
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: lager,
      rolle: "leitung",
      recht: "infos.bearbeiten",
      erlaubt: true,
    });
    const post = (body: Record<string, unknown>) =>
      anfrage(konten.leitung, "POST", `${L(lager)}/infos`, {
        titel: "T",
        ...body,
      });
    expect((await post({ notfall: true })).status).toBe(403);
    const ok = await post({});
    expect(ok.status).toBe(201);
    expect(
      (
        await anfrage(
          konten.leitung,
          "PATCH",
          `${L(lager)}/infos/${ok.body.id}`,
          {
            version: 1,
            notfall: true,
          },
        )
      ).status,
    ).toBe(403);
    // Ein Notfall-Abschnitt der Lagerleitung lässt sich nicht ändern oder löschen
    const n = await anfrage(leiter(), "POST", `${L(lager)}/infos`, {
      titel: "Notfall",
      notfall: true,
    });
    expect(
      (
        await anfrage(
          konten.leitung,
          "PATCH",
          `${L(lager)}/infos/${n.body.id}`,
          {
            version: 1,
            titel: "X",
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await anfrage(
          konten.leitung,
          "DELETE",
          `${L(lager)}/infos/${n.body.id}?version=1`,
        )
      ).status,
    ).toBe(403);
    // Das Team darf nichts ändern
    expect(
      (await anfrage(konten.team, "POST", `${L(lager)}/infos`, { titel: "T" }))
        .status,
    ).toBe(403);
  });

  test("Löschen ist ein Soft-Delete; ein Versionskonflikt nennt den Stand", async () => {
    const lager = await legeLager();
    const a = await anfrage(leiter(), "POST", `${L(lager)}/infos`, {
      titel: "A",
    });
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L(lager)}/infos/${a.body.id}`,
      { version: 5, titel: "B" },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.aktuell).toMatchObject({ titel: "A", version: 1 });
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(lager)}/infos/${a.body.id}?version=1`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L(lager)}/infos/${a.body.id}`)).status,
    ).toBe(404);
    const zeilen = await db
      .select()
      .from(schema.infoAbschnitt)
      .where(eq(schema.infoAbschnitt.id, a.body.id));
    expect(zeilen[0]!.geloeschtAm).not.toBeNull();
  });

  test("ein Lager eines anderen Mandanten und ein fremder Abschnitt sind 404", async () => {
    const lager = await legeLager();
    const andere = await legeLager();
    const a = await anfrage(leiter(), "POST", `${L(andere)}/infos`, {
      titel: "A",
    });
    // Der Abschnitt gehört zu einem anderen Lager
    expect(
      (await anfrage(leiter(), "GET", `${L(lager)}/infos/${a.body.id}`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(lager)}/infos/${a.body.id}`, {
          version: 1,
          titel: "X",
        })
      ).status,
    ).toBe(404);
    const fremdeAbteilung = await legeLager(
      welt.demoAbteilungId,
      "aktiv",
      false,
    );
    for (const p of ["lagerleitung", "team"] as const) {
      expect(
        (await anfrage(konten[p], "GET", `${L(fremdeAbteilung)}/infos`)).status,
      ).toBe(404);
    }
  });

  test("der Aufräumlauf lässt eine eingebundene Datei stehen, das Lager lässt sich mit Verknüpfungen löschen", async () => {
    const lager = await legeLager();
    const d = await datei(lager);
    const lose = await datei(lager, "Lose.pdf");
    await anfrage(leiter(), "POST", `${L(lager)}/infos`, {
      titel: "Mit Datei",
      dateiIds: [d.id],
    });
    // Beide Einträge sind älter als die Frist
    await db
      .update(schema.lagerDatei)
      .set({ erstelltAm: new Date(Date.now() - 3 * 24 * 3600_000) })
      .where(inArray(schema.lagerDatei.id, [d.id, lose.id]));
    await raeumeDateienOhneVerweisAuf(db);
    const uebrig = await db
      .select({ id: schema.lagerDatei.id })
      .from(schema.lagerDatei)
      .where(eq(schema.lagerDatei.lagerId, lager));
    expect(uebrig.map((u) => u.id)).toEqual([d.id]);
    // Löschen des Lagers nimmt Abschnitte, Verknüpfungen und Einträge mit (Fremdschlüssel auf lager_datei)
    await db.delete(schema.lager).where(eq(schema.lager.id, lager));
    expect(
      await db
        .select()
        .from(schema.infoAbschnittDatei)
        .where(eq(schema.infoAbschnittDatei.lagerId, lager)),
    ).toHaveLength(0);
  });
});

describe("Prüfer für den Lager-Check", () => {
  test("Packliste braucht einen Punkt, Notfall einen Kontakt mit Nummer", async () => {
    const lager = await legeLager();
    expect(await pruefePackliste(db, lager)).toEqual({
      erfuellt: false,
      anzahl: 0,
    });
    expect(await pruefeNotfall(db, lager)).toEqual({
      erfuellt: false,
      anzahl: 0,
    });
    await anfrage(leiter(), "POST", `${L(lager)}/packliste/punkte`, {
      abschnitt: "A",
      text: "B",
    });
    expect((await pruefePackliste(db, lager)).erfuellt).toBe(true);
    // Ein Konto ohne Nummer zählt nicht
    await db
      .update(schema.user)
      .set({ telefon: null })
      .where(eq(schema.user.id, konten.ohneMitgliedschaft.id!));
    await db.insert(schema.lagerMitglied).values({
      lagerId: lager,
      personId: konten.ohneMitgliedschaft.id!,
      rolle: "team",
    });
    await anfrage(leiter(), "POST", `${L(lager)}/notfall/kontakte`, {
      funktion: "A",
      personId: konten.ohneMitgliedschaft.id,
    });
    expect((await pruefeNotfall(db, lager)).erfuellt).toBe(false);
    await anfrage(leiter(), "POST", `${L(lager)}/notfall/kontakte`, {
      funktion: "B",
      name: "N",
      telefon: "079 123 45 67",
    });
    expect(await pruefeNotfall(db, lager)).toEqual({
      erfuellt: true,
      anzahl: 1,
    });
  });
});
