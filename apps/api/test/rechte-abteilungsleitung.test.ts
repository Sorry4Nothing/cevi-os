// Die Antworten sind JSON, die der Test Feld für Feld liest: «any» statt eines Typs je Antwort
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { and, eq, sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Person } from "../src/rechte.js";
import { darf, verlange } from "../src/rechtemodell/darf.js";
import {
  RECHT_IDS,
  VERGEBBARE_RECHTE,
  eintragVon,
} from "../src/rechtemodell/katalog.js";
import { setzeRechteModus } from "../src/rechtemodell/modus.js";
import { ladeRechteSatz } from "../src/rechtemodell/satz.js";
import { rechtSql } from "../src/rechtemodell/sql.js";
import { legeWebmasterAn } from "../src/plattform.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Die Rechte der Abteilungsleitung (#663): Sie sind eine einstellbare Systemrolle, die nur der Entwickler ändert. Die Abteilungsleitung ändert ihre eigenen Rechte nie; der Entwickler hat seit #722 jedes Recht und sieht und ändert alles, auch Namen von Personen.

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

const BASIS = "/api/v1/admin/rechte";
let welt: Welt;
let al: PersonaKonto;
let demoAl: PersonaKonto;
let entwickler: PersonaKonto;
let entwicklerOhneFaktor: PersonaKonto;
let eltern: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [al, demoAl, entwicklerOhneFaktor, eltern] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "elternA"),
  ]);
  entwickler = await legePersonaMitFaktorAn(welt, "leitendeA");
  await db
    .insert(schema.plattformEntwickler)
    .values([{ userId: entwickler.id! }, { userId: entwicklerOhneFaktor.id! }]);
});

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}
const json = async <T = any>(a: Response) => (await a.json()) as T;
const rollen = async (konto: PersonaKonto) =>
  json(await anfrage(konto, "GET", `${BASIS}/rollen`));

const person = (konto: PersonaKonto, admin: boolean): Person => ({
  id: konto.id!,
  abteilungId: konto.abteilungId!,
  abteilungsleitung: admin,
  entwickler: false,
  zweiterFaktor: true,
  rollen: [],
});

// Setzt die Rechte der Abteilungsleitung der Testabteilung als Entwickler (der Test prüft den Weg über die API)
async function setzeAl(rechte: string[]) {
  const stand = (await rollen(entwickler)).abteilungsleitung;
  const a = await anfrage(entwickler, "PATCH", `${BASIS}/abteilungsleitung`, {
    version: stand.version,
    rechte,
  });
  expect(a.status).toBe(200);
  return (await json(a)).version as number;
}
const ALLE = [...VERGEBBARE_RECHTE] as string[];

describe("Standard: die Abteilungsleitung hat alles Vergebbare", () => {
  test("die Rolle steht in der Liste, Version 1, alle vergebbaren Rechte, gesperrt für sie selbst", async () => {
    const a = await anfrage(al, "GET", `${BASIS}/rollen`);
    expect(a.status).toBe(200);
    const k = (await json(a)).abteilungsleitung;
    expect(k.version).toBe(1);
    expect(k.rechte).toEqual(VERGEBBARE_RECHTE);
    // Fest bleibt, was Aussperren verhindert; das Recht des Entwicklers gehört nicht dazu
    expect(k.fest).toContain("rechte.verwalten");
    // Konten löschen ist seit #771 vergebbar: Die Abteilungsleitung hat es als Standard, der Entwickler kann es ihr nehmen
    expect(k.fest).not.toContain("konto.loeschen");
    expect(k.rechte).toContain("konto.loeschen");
    expect(k.fest).not.toContain("rechte.abteilungsleitung");
    expect(k.fest).not.toContain("protokoll.lesen");
    expect(k.aenderbar).toBe(false);
  });

  test("der Katalog nennt das neue Recht: fest, nur der Entwickler", async () => {
    const k = await json(await anfrage(al, "GET", `${BASIS}/katalog`));
    expect(
      k.rechte.find((r: any) => r.id === "rechte.abteilungsleitung"),
    ).toMatchObject({
      art: "fest",
      risiko: "fest",
      nurEntwickler: true,
    });
    expect(k.ich).toEqual({
      rechteVerwalten: true,
      abteilungsleitungAendern: false,
    });
  });

  test("RechteSatz: die Abteilungsleitung hat jedes Recht ausser denen nur für den Entwickler", async () => {
    const satz = await ladeRechteSatz(db, person(al, true));
    for (const recht of RECHT_IDS) {
      expect(satz.hat(recht), recht).toBe(!eintragVon(recht).nurEntwickler);
    }
  });
});

describe("Die Abteilungsleitung ändert ihre eigenen Rechte nie", () => {
  test("PATCH /abteilungsleitung ist für sie 403, mit jedem Body", async () => {
    for (const rechte of [ALLE, [], ["seiten.bearbeiten"]]) {
      const a = await anfrage(al, "PATCH", `${BASIS}/abteilungsleitung`, {
        version: 1,
        rechte,
      });
      expect(a.status).toBe(403);
    }
    expect((await rollen(al)).abteilungsleitung.version).toBe(1);
  });

  test("die Rolle liegt in keiner Tabelle der anderen Rollen: weder die Matrix noch die ältere Plattformrollen-API erreichen sie", async () => {
    const abteilung = al.abteilungId!;
    // Kein Eintrag «Abteilungsleitung» in den Listen der Plattformrollen
    const matrix = await rollen(al);
    expect(matrix.rollen.map((r: any) => r.name)).not.toContain(
      "Abteilungsleitung",
    );
    const alt = await json(
      await anfrage(al, "GET", "/api/v1/admin/plattform/rollen"),
    );
    expect(alt.rollen.map((r: any) => r.name)).not.toContain(
      "Abteilungsleitung",
    );
    // Die Kennung der Abteilung ist keine Rolle: 404 auf jedem Weg, auch beim Ändern und Zuordnen
    for (const [methode, pfad, body] of [
      [
        "PATCH",
        `${BASIS}/rollen/${abteilung}`,
        { version: 1, rechte: ["seiten.bearbeiten"] },
      ],
      [
        "PATCH",
        `/api/v1/admin/plattform/rollen/${abteilung}`,
        { rechte: ["seiten.bearbeiten"] },
      ],
      ["PUT", `/api/v1/admin/plattform/rollen/${abteilung}/personen/${al.id}`],
      ["DELETE", `${BASIS}/rollen/${abteilung}`],
    ] as const) {
      const a = await anfrage(al, methode, pfad, body);
      expect(a.status, `${methode} ${pfad}`).toBe(404);
    }
    // Der Name gehört der Systemrolle: keine zweite Rolle «Abteilungsleitung», auch nicht durch Umbenennen
    for (const name of ["Abteilungsleitung", " abteilungsleitung "]) {
      const neu = await anfrage(al, "POST", `${BASIS}/rollen`, {
        name,
        rechte: [],
      });
      expect(neu.status).toBe(409);
      expect(await json(neu)).toMatchObject({ code: "ROLLENNAME_VERGEBEN" });
      const alt = await anfrage(al, "POST", "/api/v1/admin/plattform/rollen", {
        name,
        rechte: [],
      });
      expect(alt.status).toBe(409);
    }
    const eigene = await json(
      await anfrage(al, "POST", `${BASIS}/rollen`, {
        name: `Kasse ${randomUUID().slice(0, 6)}`,
        rechte: [],
      }),
    );
    const umbenennen = await anfrage(
      al,
      "PATCH",
      `${BASIS}/rollen/${eigene.id}`,
      { version: eigene.version, name: "Abteilungsleitung" },
    );
    expect(umbenennen.status).toBe(409);
    expect((await rollen(al)).abteilungsleitung.rechte).toEqual(
      VERGEBBARE_RECHTE,
    );
  });

  test("Abteilungsleitung ohne zweiten Faktor, Eltern und fremde Abteilung: 403 oder 401, nie 200", async () => {
    const ohneFaktor = await legePersonaAn(welt, "adminOhneZweitenFaktor");
    for (const konto of [ohneFaktor, eltern, demoAl]) {
      const a = await anfrage(konto, "PATCH", `${BASIS}/abteilungsleitung`, {
        version: 1,
        rechte: [],
      });
      expect(a.status).toBe(403);
    }
  });
});

describe("Der Entwickler: hat jedes Recht, auch «Rechte und Rollen vergeben» (#722)", () => {
  test("ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT, lesend und schreibend", async () => {
    for (const [methode, pfad, body] of [
      ["GET", `${BASIS}/katalog`],
      ["GET", `${BASIS}/rollen`],
      ["PATCH", `${BASIS}/abteilungsleitung`, { version: 1, rechte: ALLE }],
    ] as const) {
      const a = await anfrage(entwicklerOhneFaktor, methode, pfad, body);
      expect(a.status, pfad).toBe(403);
      expect(await json(a), pfad).toMatchObject({
        code: "ZWEITER_FAKTOR_FEHLT",
      });
    }
  });

  test("mit zweitem Faktor liest er Katalog, Gruppen, Rollen und Änderungen und darf die Rechte der Rollen und der Abteilungsleitung ändern", async () => {
    const katalog = await json(
      await anfrage(entwickler, "GET", `${BASIS}/katalog`),
    );
    expect(katalog.ich).toEqual({
      rechteVerwalten: true,
      abteilungsleitungAendern: true,
    });
    // Der Katalog nennt den Entwickler nicht mehr je Recht: Er hat jedes
    expect(katalog.rechte.every((r: any) => !("entwickler" in r))).toBe(true);
    for (const pfad of ["/gruppen", "/rollen", "/aenderungen"]) {
      const a = await anfrage(entwickler, "GET", `${BASIS}${pfad}`);
      expect(a.status, pfad).toBe(200);
    }
    const r = await rollen(entwickler);
    expect(r.abteilungsleitung.aenderbar).toBe(true);
    const alt = await anfrage(
      entwickler,
      "GET",
      "/api/v1/admin/plattform/rollen",
    );
    expect(alt.status).toBe(200);
  });

  test("er sieht die Rollen mit den Namen der Personen und den Verlauf mit den Namen der Akteure", async () => {
    // Die Abteilungsleitung legt eine Rolle an und weist sie einer Person zu
    const neu = await json(
      await anfrage(al, "POST", `${BASIS}/rollen`, {
        name: `Redaktion ${randomUUID().slice(0, 6)}`,
        rechte: ["seiten.bearbeiten"],
      }),
    );
    const zu = await anfrage(
      al,
      "PUT",
      `/api/v1/admin/plattform/rollen/${neu.id}/personen/${eltern.id}`,
    );
    expect(zu.status).toBe(204);
    const sichtEntwickler = (await rollen(entwickler)).rollen.find(
      (r: any) => r.id === neu.id,
    );
    expect(sichtEntwickler.personen).toHaveLength(1);
    expect(sichtEntwickler.personen[0].id).toBe(eltern.id);
    const liste = await json(
      await anfrage(entwickler, "GET", "/api/v1/admin/plattform/rollen"),
    );
    expect(
      liste.rollen.find((r: any) => r.id === neu.id).personen,
    ).toHaveLength(1);
    const verlauf = await json(
      await anfrage(entwickler, "GET", `${BASIS}/aenderungen`),
    );
    expect(verlauf.aenderungen.length).toBeGreaterThan(0);
    expect(verlauf.aenderungen.some((z: any) => z.akteur !== null)).toBe(true);
  });

  test("er weist Personen eine Rolle zu und entzieht sie, auf beiden Wegen, und liest «Was darf wer?»", async () => {
    const rolle = await json(
      await anfrage(entwickler, "POST", `${BASIS}/rollen`, {
        name: `Zuweisung ${randomUUID().slice(0, 6)}`,
        rechte: ["medien.verwalten"],
      }),
    );
    const pfad = `/api/v1/admin/plattform/rollen/${rolle.id}/personen/${eltern.id}`;
    expect((await anfrage(entwickler, "PUT", pfad)).status).toBe(204);
    const was = await json(
      await anfrage(entwickler, "GET", `${BASIS}/personen/${eltern.id}`),
    );
    expect(
      was.rechte.find((r: any) => r.recht === "medien.verwalten"),
    ).toBeDefined();
    expect((await anfrage(entwickler, "DELETE", pfad)).status).toBe(204);
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}/zuordnungen`)).status,
    ).toBe(200);
    expect(
      (await anfrage(entwickler, "DELETE", `${BASIS}/rollen/${rolle.id}`))
        .status,
    ).toBe(204);
  });

  test("er legt Rollen an, ändert und löscht ihre Rechte, auch die der vorgegebenen Rolle «Webmaster»; umbenennen und löschen lässt sich diese nicht", async () => {
    // Die Testwelt hat keine Rolle «Webmaster»; sie entsteht wie in der Produktion mit der Abteilung
    await legeWebmasterAn(db, welt.testabteilungId);
    const webmaster = (await rollen(entwickler)).rollen.find(
      (r: any) => r.vorgabe,
    );
    expect(webmaster).toBeDefined();
    const gut = await anfrage(
      entwickler,
      "PATCH",
      `${BASIS}/rollen/${webmaster.id}`,
      {
        version: webmaster.version,
        rechte: ["seiten.bearbeiten", "medien.verwalten", "personen.sehen"],
      },
    );
    expect(gut.status).toBe(200);
    const danach = (await rollen(entwickler)).rollen.find(
      (r: any) => r.id === webmaster.id,
    );
    expect(danach.rechte).toEqual([
      "seiten.bearbeiten",
      "medien.verwalten",
      "personen.sehen",
    ]);
    // Zurück auf den Stand davor, damit die Rolle für die übrigen Tests bleibt, was sie war
    const zurueck = await anfrage(
      entwickler,
      "PATCH",
      `${BASIS}/rollen/${webmaster.id}`,
      { version: danach.version, rechte: webmaster.rechte },
    );
    expect(zurueck.status).toBe(200);
    const weg = await anfrage(
      entwickler,
      "DELETE",
      `${BASIS}/rollen/${webmaster.id}`,
    );
    expect(weg.status).toBe(409);
    expect(await json(weg)).toMatchObject({ code: "ROLLE_VORGEGEBEN" });
  });

  test("seine Rechte an anderen Rollen reichen so weit wie seine eigenen: jedes Recht, auch Personen und Kinder", async () => {
    const name = `Entwurf ${randomUUID().slice(0, 6)}`;
    const gut = await anfrage(entwickler, "POST", `${BASIS}/rollen`, {
      name,
      rechte: ["seiten.bearbeiten", "personen.verwalten"],
    });
    expect(gut.status).toBe(201);
    const id = (await json(gut)).id;
    const patch = await anfrage(entwickler, "PATCH", `${BASIS}/rollen/${id}`, {
      version: 1,
      rechte: ["seiten.bearbeiten", "kinder.sehen"],
    });
    expect(patch.status).toBe(200);
    const weg = await anfrage(entwickler, "DELETE", `${BASIS}/rollen/${id}`);
    expect(weg.status).toBe(204);
  });

  test("RechteSatz: er hat jedes Recht des Katalogs, abteilungsweit; ein Objekt einer fremden Abteilung gibt ihm nichts", async () => {
    const satz = await ladeRechteSatz(db, person(entwickler, false));
    for (const recht of RECHT_IDS) {
      expect(satz.hat(recht), recht).toBe(true);
    }
    expect(satz.hat("personen.verwalten", { abteilungId: randomUUID() })).toBe(
      false,
    );
  });
});

describe("Der Entwickler ändert die Rechte der Abteilungsleitung", () => {
  test("Wegnehmen wirkt bei der nächsten Anfrage, im Audit-Log stehen nur Rechte und Akteur", async () => {
    // Vorher: Zeitregeln gehen
    const vorher = await anfrage(al, "GET", "/api/v1/admin/zeitregeln");
    expect(vorher.status).toBe(200);
    const version = await setzeAl(
      ALLE.filter((r) => r !== "zeitregeln.verwalten"),
    );
    expect(version).toBe(2);
    const nachher = await anfrage(al, "GET", "/api/v1/admin/zeitregeln");
    expect(nachher.status).toBe(403);
    // Sie sieht den Stand, kann ihn aber nicht ändern
    const stand = (await rollen(al)).abteilungsleitung;
    expect(stand.rechte).not.toContain("zeitregeln.verwalten");
    expect(stand.rechte).toHaveLength(VERGEBBARE_RECHTE.length - 1);
    expect(stand.aenderbar).toBe(false);
    const eintrag = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "abteilungsleitung_rechte_geaendert"),
          eq(schema.auditLog.akteurId, entwickler.id!),
        ),
      );
    expect(eintrag).toHaveLength(1);
    expect(eintrag[0].details).toEqual({
      hinzu: [],
      weg: ["zeitregeln.verwalten"],
    });
    expect(eintrag[0].abteilungId).toBe(welt.testabteilungId);
    // Zurück
    await setzeAl(ALLE);
    expect((await anfrage(al, "GET", "/api/v1/admin/zeitregeln")).status).toBe(
      200,
    );
  });

  test("alle vergebbaren Rechte weg: Die feste Verwaltung bleibt, die Abteilung sperrt sich nicht aus", async () => {
    await setzeAl([]);
    try {
      // Rechte und Rollen vergeben ist fest: Die Abteilungsleitung liest weiter
      expect((await anfrage(al, "GET", `${BASIS}/katalog`)).status).toBe(200);
      expect((await rollen(al)).abteilungsleitung.rechte).toEqual([]);
      // Alles Vergebbare ist weg
      expect((await anfrage(al, "GET", "/api/v1/admin/personen")).status).toBe(
        403,
      );
      const satz = await ladeRechteSatz(db, person(al, true));
      expect(satz.hat("rechte.verwalten")).toBe(true);
      // Auch «Konten löschen» ist vergebbar und mit dem Rest weg (#771)
      expect(satz.hat("konto.loeschen")).toBe(false);
      expect(satz.hat("personen.verwalten")).toBe(false);
      expect(satz.hat("rechte.abteilungsleitung")).toBe(false);
    } finally {
      await setzeAl(ALLE);
    }
  });

  test("was die Abteilungsleitung nicht mehr hat, vergibt sie nicht (Eskalationsschutz)", async () => {
    const rolle = await json(
      await anfrage(al, "POST", `${BASIS}/rollen`, {
        name: `Zeit ${randomUUID().slice(0, 6)}`,
        rechte: ["zeitregeln.verwalten", "seiten.bearbeiten"],
      }),
    );
    await setzeAl(ALLE.filter((r) => r !== "zeitregeln.verwalten"));
    try {
      // Neue Rolle mit dem Recht, ändern, zuordnen: auf jedem Weg 403
      const neu = await anfrage(al, "POST", `${BASIS}/rollen`, {
        name: `Zeit ${randomUUID().slice(0, 6)}`,
        rechte: ["zeitregeln.verwalten"],
      });
      expect(neu.status).toBe(403);
      const alt = await anfrage(al, "POST", "/api/v1/admin/plattform/rollen", {
        name: `Zeit ${randomUUID().slice(0, 6)}`,
        rechte: ["seiten.bearbeiten"],
      });
      expect(alt.status).toBe(201);
      const zuordnen = await anfrage(
        al,
        "PUT",
        `/api/v1/admin/plattform/rollen/${rolle.id}/personen/${al.id}`,
      );
      // Die Rolle trägt ein Recht, das die Abteilungsleitung nicht mehr hat
      expect(zuordnen.status).toBe(403);
      const zuordnenMatrix = await anfrage(
        al,
        "PUT",
        `/api/v1/admin/plattform/rollen/${rolle.id}/personen/${eltern.id}`,
      );
      expect(zuordnenMatrix.status).toBe(403);
    } finally {
      await setzeAl(ALLE);
    }
  });

  test("ein veralteter Stand ist 409 mit dem aktuellen Stand", async () => {
    const stand = (await rollen(entwickler)).abteilungsleitung;
    const a = await anfrage(entwickler, "PATCH", `${BASIS}/abteilungsleitung`, {
      version: stand.version + 5,
      rechte: ALLE,
    });
    expect(a.status).toBe(409);
    const k = await json(a);
    expect(k.code).toBe("VERSION_KONFLIKT");
    expect(k.aktuell.version).toBe(stand.version);
    expect(k.aktuell.rechte).toHaveLength(VERGEBBARE_RECHTE.length);
    expect(k.aktuell.rechte[0]).toEqual({
      recht: VERGEBBARE_RECHTE[0],
      geltung: "alle",
    });
  });

  test("Eingaben: unbekannte, feste und doppelte Rechte und fremde Felder sind 400", async () => {
    const stand = (await rollen(entwickler)).abteilungsleitung;
    for (const body of [
      { version: stand.version, rechte: ["gibt.es.nicht"] },
      { version: stand.version, rechte: ["rechte.verwalten"] },
      { version: stand.version, rechte: ["rechte.abteilungsleitung"] },
      {
        version: stand.version,
        rechte: ["seiten.bearbeiten", "seiten.bearbeiten"],
      },
      { version: stand.version, rechte: ALLE, name: "x" },
      { version: stand.version },
      { rechte: ALLE },
    ]) {
      const a = await anfrage(
        entwickler,
        "PATCH",
        `${BASIS}/abteilungsleitung`,
        body as any,
      );
      expect(a.status, JSON.stringify(body)).toBe(400);
    }
  });

  test("die Änderung gilt nur für die eigene Abteilung", async () => {
    await setzeAl([]);
    try {
      const fremd = (await rollen(demoAl)).abteilungsleitung;
      expect(fremd.rechte).toEqual(VERGEBBARE_RECHTE);
      expect(fremd.version).toBe(1);
    } finally {
      await setzeAl(ALLE);
    }
  });

  test("andere Personen verlieren nichts: Rollen, Stufenrollen und Gruppen geben ihr Recht weiter", async () => {
    // Die Person ist Abteilungsleitung und trägt eine Rolle mit dem Recht: Sie behält es über die Rolle
    const konto = await legePersonaAn(welt, "admin");
    const rolle = await json(
      await anfrage(al, "POST", `${BASIS}/rollen`, {
        name: `Zeitplan ${randomUUID().slice(0, 6)}`,
        rechte: ["zeitregeln.verwalten"],
      }),
    );
    const zu = await anfrage(
      al,
      "PUT",
      `/api/v1/admin/plattform/rollen/${rolle.id}/personen/${konto.id}`,
    );
    expect(zu.status).toBe(204);
    await setzeAl(ALLE.filter((r) => r !== "zeitregeln.verwalten"));
    try {
      expect(
        (await anfrage(konto, "GET", "/api/v1/admin/zeitregeln")).status,
      ).toBe(200);
      expect(
        (await anfrage(al, "GET", "/api/v1/admin/zeitregeln")).status,
      ).toBe(403);
      const herkunft = (
        await ladeRechteSatz(db, person(konto, true))
      ).herkuenfte("zeitregeln.verwalten");
      expect(herkunft.map((h) => h.art)).toEqual(["plattformrolle"]);
    } finally {
      await setzeAl(ALLE);
    }
  });
});

describe("alter und neuer Weg, alle Modi", () => {
  test("mit einem Abzug entscheiden «schatten» und «neu» gleich; «alt» ist der Notschalter und kennt die Einstellung nicht", async () => {
    await setzeAl(ALLE.filter((r) => r !== "kinder.sehen"));
    try {
      const alPerson = () => ({ ...person(al, true) });
      setzeRechteModus("schatten");
      expect(await darf(db, alPerson(), "kinder.sehen")).toBe(false);
      expect(await darf(db, alPerson(), "kinder.verwalten")).toBe(true);
      await expect(
        verlange(db, alPerson(), "kinder.sehen"),
      ).rejects.toMatchObject({ status: 403 });
      setzeRechteModus("neu");
      expect(await darf(db, alPerson(), "kinder.sehen")).toBe(false);
      expect(await darf(db, alPerson(), "kinder.verwalten")).toBe(true);
      setzeRechteModus("alt");
      expect(await darf(db, alPerson(), "kinder.sehen")).toBe(true);
    } finally {
      setzeRechteModus("schatten");
      await setzeAl(ALLE);
    }
  });

  test("rechtSql und RechteSatz sind für die Abteilungsleitung mit Abzug gleich, für jedes Recht", async () => {
    const abzug = ["kinder.sehen", "mitteilung.senden", "seiten.bearbeiten"];
    await setzeAl(ALLE.filter((r) => !abzug.includes(r)));
    try {
      const p = person(al, true);
      const satz = await ladeRechteSatz(db, { ...p });
      for (const recht of RECHT_IDS) {
        const zeile = await db.execute(
          dsql`select ${rechtSql(p, recht, {})} as ok`,
        );
        const ok = (zeile as unknown as { ok: boolean }[])[0].ok;
        expect(ok, recht).toBe(satz.hat(recht));
      }
      expect(satz.hat("kinder.sehen")).toBe(false);
      expect(satz.hat("kinder.verwalten")).toBe(true);
    } finally {
      await setzeAl(ALLE);
    }
  });
});
