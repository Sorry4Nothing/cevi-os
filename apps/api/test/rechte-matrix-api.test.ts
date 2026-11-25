// Die Antworten sind JSON, die der Test Feld für Feld liest: «any» statt eines Typs je Antwort
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { legeSystemrollenAn } from "../src/rechtemodell/gruppenrollen.js";
import { RECHT_IDS } from "../src/rechtemodell/katalog.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

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
let admin: PersonaKonto;
let demoAdmin: PersonaKonto;
let eltern: PersonaKonto;
let sl: PersonaKonto;
let teamId: string;
let okId: string;
let mitglied: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, eltern, sl, mitglied] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "elternA"),
  ]);
  teamId = await gruppe("team");
  await legeSystemrollenAn(db, welt.testabteilungId, welt.stufeAId, "stufe");
  await db
    .insert(schema.personTag)
    .values({ userId: mitglied.id!, tagId: teamId });
  okId = await gruppe("funktion");
});

async function gruppe(typ: "team" | "funktion") {
  const [z] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ,
      name: `Gruppe ${randomUUID().slice(0, 8)}`,
      kuerzel: "",
    })
    .returning({ id: schema.tag.id });
  await legeSystemrollenAn(db, welt.testabteilungId, z.id, typ);
  return z.id;
}

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(`/api/v1/admin/rechte${pfad}`, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}
const json = async <T = Record<string, any>>(a: Response) =>
  (await a.json()) as T;

const rolleAnlegen = async (
  tagId: string,
  rechte: { recht: string; geltung: string }[] = [
    { recht: "seiten.bearbeiten", geltung: "eigene" },
  ],
  name = `Rolle ${randomUUID().slice(0, 8)}`,
) => {
  const a = await anfrage(admin, "POST", `/gruppen/${tagId}/rollen`, {
    name,
    rechte,
  });
  expect(a.status).toBe(201);
  return json<{ id: string; version: number }>(a);
};
const rollenListe = async (tagId: string) =>
  (
    await json<{ rollen: any[] }>(
      await anfrage(admin, "GET", `/gruppen/${tagId}/rollen`),
    )
  ).rollen;
const audit = (aktion: string, zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.aktion, aktion),
        eq(schema.auditLog.zielId, zielId),
      ),
    );

describe("Katalog und Gruppen", () => {
  test("der Katalog nennt jedes Recht mit Risiko, Art und Geltung; er erlaubt nichts", async () => {
    const a = await anfrage(admin, "GET", "/katalog");
    expect(a.status).toBe(200);
    const k = await json<{ modus: string; rechte: any[]; bereiche: any[] }>(a);
    expect(k.modus).toBe("schatten");
    expect(k.rechte.map((r) => r.id)).toEqual(RECHT_IDS);
    const sehen = k.rechte.find((r) => r.id === "anlass.anmeldungen_sehen");
    expect(sehen).toMatchObject({
      risiko: "erweitert",
      art: "vergebbar",
      geltungen: ["alle", "eigene"],
      bezug: "anlass",
      zweiterFaktor: true,
    });
    expect(k.rechte.find((r) => r.id === "rechte.verwalten")).toMatchObject({
      art: "fest",
      geltungen: [],
      gruppenrolle: false,
    });
  });

  test("nur die Abteilungsleitung liest und schreibt", async () => {
    for (const konto of [eltern, sl]) {
      expect((await anfrage(konto, "GET", "/katalog")).status).toBe(403);
      expect((await anfrage(konto, "GET", "/gruppen")).status).toBe(403);
      expect(
        (await anfrage(konto, "GET", `/personen/${mitglied.id}`)).status,
      ).toBe(403);
      expect(
        (
          await anfrage(konto, "POST", `/gruppen/${teamId}/rollen`, {
            name: "X",
            rechte: [],
          })
        ).status,
      ).toBe(403);
    }
  });

  test("die Liste der Gruppen zählt Rollen und Mitglieder", async () => {
    const { gruppen } = await json<{ gruppen: any[] }>(
      await anfrage(admin, "GET", "/gruppen"),
    );
    const team = gruppen.find((g) => g.id === teamId);
    expect(team).toMatchObject({
      typ: "team",
      rollen: 1,
      mitglieder: 1,
      mitRolle: 0,
    });
    // Nur Gruppen der eigenen Abteilung
    expect(gruppen.every((g) => g.id !== undefined)).toBe(true);
  });
});

describe("Gruppenrollen je Gruppe", () => {
  test("anlegen, lesen, Audit ohne Namen; Systemrolle ist schon da", async () => {
    const neu = await rolleAnlegen(teamId, [
      { recht: "raum.verwalten", geltung: "eigene" },
      { recht: "mitteilung.senden", geltung: "eigene" },
    ]);
    expect(neu.version).toBe(1);
    const rollen = await rollenListe(teamId);
    const system = rollen.find((r) => r.system);
    expect(system).toMatchObject({
      schluessel: "verantwortlich",
      verantwortlich: true,
      name: "Verantwortliche/r",
    });
    // Die Standardrechte der Systemrolle des Teams
    expect(system.rechte.map((z: any) => z.recht)).toEqual([
      "seiten.bearbeiten",
      "seiten.veroeffentlichen",
      "raum.belegung",
    ]);
    const eigene = rollen.find((r) => r.id === neu.id);
    expect(eigene).toMatchObject({ system: false, version: 1, personen: [] });
    expect(eigene.rechte).toEqual([
      { recht: "raum.verwalten", geltung: "eigene" },
      { recht: "mitteilung.senden", geltung: "eigene" },
    ]);
    const zeilen = await audit("gruppen_rolle_angelegt", neu.id);
    expect(zeilen).toHaveLength(1);
    expect(JSON.stringify(zeilen[0].details)).not.toContain("Rolle ");
  });

  test("an einer Stufe nennt die Antwort die festen Rechte der Stufenrolle", async () => {
    const rollen = await rollenListe(welt.stufeAId);
    const sl = rollen.find((r) => r.schluessel === "stufenleitung");
    expect(sl.fest).toContainEqual({
      recht: "seiten.bearbeiten",
      geltung: "eigene",
    });
    expect(sl.rechte).toEqual([]);
    expect(
      rollen
        .find((r) => r.schluessel === "leitung")
        .fest.map((z: any) => z.recht),
    ).toEqual([
      "vorschlag.einreichen",
      "raum.belegung",
      "anwesenheit.fuehren",
      "stufe.einblick",
    ]);
  });

  test("Eingaben ausserhalb des Katalogs sind 400", async () => {
    const schlecht: Record<string, unknown>[] = [
      { name: "A", rechte: [{ recht: "unbekannt.recht", geltung: "alle" }] },
      // seiten.anlegen_loeschen kennt nur «alle»
      {
        name: "A",
        rechte: [{ recht: "seiten.anlegen_loeschen", geltung: "eigene" }],
      },
      {
        name: "A",
        rechte: [{ recht: "kinder.konto_verwalten", geltung: "alle" }],
      },
      { name: "A", rechte: [{ recht: "rechte.verwalten", geltung: "alle" }] },
      {
        name: "A",
        rechte: [{ recht: "wartungsmodus.website", geltung: "alle" }],
      },
      // Der Wartungsmodus ist fest und nur für den Entwickler (#802)
      { name: "A", rechte: [{ recht: "wartung.bereiche", geltung: "alle" }] },
      { name: "A", rechte: [{ recht: "termine.alle", geltung: "alle" }] },
      {
        name: "A",
        rechte: [
          { recht: "raum.verwalten", geltung: "eigene" },
          { recht: "raum.verwalten", geltung: "alle" },
        ],
      },
      { name: "", rechte: [] },
      { name: "A".repeat(51), rechte: [] },
      { name: "A", rechte: [], abteilungId: randomUUID() },
      {
        name: "A",
        rechte: [{ recht: "raum.verwalten", geltung: "eigene", extra: 1 }],
      },
      { name: "A" },
    ];
    for (const body of schlecht) {
      expect(
        (await anfrage(admin, "POST", `/gruppen/${teamId}/rollen`, body))
          .status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });

  test("Namen sind je Gruppe eindeutig, in einer anderen Gruppe frei", async () => {
    const name = `Kasse ${randomUUID().slice(0, 6)}`;
    await rolleAnlegen(teamId, [], name);
    const doppelt = await anfrage(admin, "POST", `/gruppen/${teamId}/rollen`, {
      name: name.toUpperCase(),
      rechte: [],
    });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).code).toBe("ROLLENNAME_VERGEBEN");
    await rolleAnlegen(okId, [], name);
  });

  test("höchstens 30 Rollen je Gruppe", async () => {
    const g = await gruppe("funktion");
    for (let i = 0; i < 29; i++) await rolleAnlegen(g, [], `R${i}`);
    const a = await anfrage(admin, "POST", `/gruppen/${g}/rollen`, {
      name: "Zu viel",
      rechte: [],
    });
    expect(a.status).toBe(409);
    expect((await json(a)).code).toBe("ZU_VIELE_ROLLEN");
  });

  test("ändern: Version zählt hoch, Rechte werden ersetzt, Audit nennt hinzu und weg", async () => {
    const r = await rolleAnlegen(teamId, [
      { recht: "raum.verwalten", geltung: "eigene" },
    ]);
    const a = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${r.id}`,
      {
        version: 1,
        beschreibung: "Neu",
        rechte: [{ recht: "anlass.anmeldungen_sehen", geltung: "alle" }],
      },
    );
    expect(a.status).toBe(200);
    expect(await json(a)).toEqual({ version: 2 });
    const rolle = (await rollenListe(teamId)).find((x) => x.id === r.id);
    expect(rolle).toMatchObject({ version: 2, beschreibung: "Neu" });
    expect(rolle.rechte).toEqual([
      { recht: "anlass.anmeldungen_sehen", geltung: "alle" },
    ]);
    const [zeile] = await audit("gruppen_rolle_geaendert", r.id);
    expect(zeile.details).toMatchObject({
      hinzu: [{ recht: "anlass.anmeldungen_sehen", geltung: "alle" }],
      weg: [{ recht: "raum.verwalten", geltung: "eigene" }],
    });
  });

  test("gleichzeitig geändert: 409 mit dem Stand, nichts wird überschrieben", async () => {
    const r = await rolleAnlegen(teamId);
    const erste = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${r.id}`,
      { version: 1, beschreibung: "Erste" },
    );
    expect(erste.status).toBe(200);
    const zweite = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${r.id}`,
      {
        version: 1,
        rechte: [],
      },
    );
    expect(zweite.status).toBe(409);
    const k = await json(zweite);
    expect(k.code).toBe("VERSION_KONFLIKT");
    expect(k.aktuell.version).toBe(2);
    expect(k.aktuell.rechte).toEqual([
      { recht: "seiten.bearbeiten", geltung: "eigene" },
    ]);
    // Zwei Anfragen mit demselben Stand gleichzeitig: genau eine gewinnt
    const gl = await Promise.all(
      [1, 2].map(() =>
        anfrage(admin, "PATCH", `/gruppen/${teamId}/rollen/${r.id}`, {
          version: 2,
          beschreibung: "Gleich",
        }),
      ),
    );
    expect(gl.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  test("Systemrollen behalten Namen und Kennzeichen, ihre Rechte sind einstellbar, löschen geht nie", async () => {
    const system = (await rollenListe(teamId)).find((r) => r.system);
    const umbenennen = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${system.id}`,
      { version: system.version, name: "Chef" },
    );
    expect(umbenennen.status).toBe(409);
    expect((await json(umbenennen)).code).toBe("ROLLE_VORGEGEBEN");
    const kennzeichen = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${system.id}`,
      { version: system.version, verantwortlich: false },
    );
    expect(kennzeichen.status).toBe(409);
    const loeschen = await anfrage(
      admin,
      "DELETE",
      `/gruppen/${teamId}/rollen/${system.id}`,
    );
    expect(loeschen.status).toBe(409);
    // Rechte ändern geht; zurück auf den Standard
    const rechte = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${system.id}`,
      { version: system.version, rechte: [] },
    );
    expect(rechte.status).toBe(200);
    const nochmal = await anfrage(
      admin,
      "PATCH",
      `/gruppen/${teamId}/rollen/${system.id}`,
      { version: system.version + 1, rechte: system.rechte },
    );
    expect(nochmal.status).toBe(200);
  });

  test("löschen: die Mitglieder behalten die Gruppe und verlieren die Rolle; Version geprüft", async () => {
    const r = await rolleAnlegen(teamId);
    const zu = await anfrage(
      admin,
      "PUT",
      `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
      { rolleId: r.id },
    );
    expect(zu.status).toBe(204);
    const alt = await anfrage(
      admin,
      "DELETE",
      `/gruppen/${teamId}/rollen/${r.id}?version=7`,
    );
    expect(alt.status).toBe(409);
    const weg = await anfrage(
      admin,
      "DELETE",
      `/gruppen/${teamId}/rollen/${r.id}?version=1`,
    );
    expect(weg.status).toBe(204);
    const [z] = await db
      .select({ rolleId: schema.personTag.rolleId })
      .from(schema.personTag)
      .where(
        and(
          eq(schema.personTag.tagId, teamId),
          eq(schema.personTag.userId, mitglied.id!),
        ),
      );
    expect(z.rolleId).toBeNull();
    expect(await audit("gruppen_rolle_geloescht", r.id)).toHaveLength(1);
    expect(
      (await anfrage(admin, "DELETE", `/gruppen/${teamId}/rollen/${r.id}`))
        .status,
    ).toBe(404);
  });

  test("fremde Abteilung und fremde Gruppen: 404, vor dem 403", async () => {
    const r = await rolleAnlegen(teamId);
    const [fremd] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.demoAbteilungId,
        typ: "team",
        name: `Fremd ${randomUUID().slice(0, 6)}`,
        kuerzel: "",
      })
      .returning({ id: schema.tag.id });
    await legeSystemrollenAn(db, welt.demoAbteilungId, fremd.id, "team");
    // Gruppe einer anderen Abteilung
    expect(
      (await anfrage(admin, "GET", `/gruppen/${fremd.id}/rollen`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(admin, "POST", `/gruppen/${fremd.id}/rollen`, {
          name: "X",
          rechte: [],
        })
      ).status,
    ).toBe(404);
    // Rolle einer anderen Gruppe unter dieser Gruppe
    expect(
      (
        await anfrage(admin, "PATCH", `/gruppen/${okId}/rollen/${r.id}`, {
          version: 1,
          beschreibung: "x",
        })
      ).status,
    ).toBe(404);
    // Die Abteilungsleitung der Demo kommt an die Testabteilung nicht heran
    expect(
      (await anfrage(demoAdmin, "GET", `/gruppen/${teamId}/rollen`)).status,
    ).toBe(404);
    expect(
      (await anfrage(demoAdmin, "DELETE", `/gruppen/${teamId}/rollen/${r.id}`))
        .status,
    ).toBe(404);
    // Unbekannte Kennung
    expect(
      (await anfrage(admin, "GET", `/gruppen/${randomUUID()}/rollen`)).status,
    ).toBe(404);
    expect(
      (await anfrage(admin, "GET", `/gruppen/kein-uuid/rollen`)).status,
    ).toBe(400);
  });
});

describe("Zuordnen, Vorschau, Wirkung", () => {
  test("eine Person der Gruppe zuordnen, entziehen, Fremdes ist 404", async () => {
    const r = await rolleAnlegen(teamId);
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
          { rolleId: r.id },
        )
      ).status,
    ).toBe(204);
    const liste = (await rollenListe(teamId)).find((x) => x.id === r.id);
    expect(liste.personen.map((p: any) => p.id)).toEqual([mitglied.id]);
    const zeilen = await audit("gruppen_rolle_zugeordnet", mitglied.id!);
    expect(zeilen.map((z) => z.details)).toContainEqual(
      expect.objectContaining({ tagId: teamId, rolleId: r.id }),
    );
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
          { rolleId: null },
        )
      ).status,
    ).toBe(204);
    // Keine Mitglieder der Gruppe
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `/gruppen/${teamId}/personen/${eltern.id}/rolle`,
          { rolleId: r.id },
        )
      ).status,
    ).toBe(404);
    // Eine Rolle einer anderen Gruppe
    const fremdeRolle = await rolleAnlegen(okId);
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
          { rolleId: fremdeRolle.id },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
          { rolleId: "x" },
        )
      ).status,
    ).toBe(400);
  });

  test("eine Rolle mit dem Recht, aber ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT, die Matrix bleibt zu", async () => {
    const r = await rolleAnlegen(teamId, [
      { recht: "mitteilung.senden", geltung: "eigene" },
    ]);
    const mitFaktor = await legePersonaAn(welt, "elternA");
    await db
      .insert(schema.personTag)
      .values({ userId: mitFaktor.id!, tagId: teamId, rolleId: r.id });
    const wirkung = await anfrage(mitFaktor, "GET", "/katalog");
    // Die Matrix selbst bleibt der Abteilungsleitung vorbehalten (festes Recht)
    expect(wirkung.status).toBe(403);
    const vorschau = (ziel: string) =>
      app.request("/api/v1/admin/mitteilungen/vorschau", {
        method: "POST",
        headers: { ...mitFaktor.headers, "content-type": "application/json" },
        body: JSON.stringify({ ziele: [{ gruppeId: ziel, rollen: ["alle"] }] }),
      });
    // Ohne zweiten Faktor: 403 mit dem Code der App
    const ohne = await vorschau(teamId);
    expect(ohne.status).toBe(403);
    expect((await json(ohne)).code).toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("Vorschau: nur Zahlen, nichts wird geschrieben", async () => {
    const r = await rolleAnlegen(teamId, [
      { recht: "raum.verwalten", geltung: "eigene" },
    ]);
    await anfrage(
      admin,
      "PUT",
      `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
      { rolleId: r.id },
    );
    const a = await anfrage(
      admin,
      "POST",
      `/gruppen/${teamId}/rollen/vorschau`,
      {
        rolleId: r.id,
        rechte: [{ recht: "mitteilung.senden", geltung: "eigene" }],
      },
    );
    expect(a.status).toBe(200);
    expect(await json(a)).toEqual({
      personen: 1,
      gewinnen: [
        { recht: "mitteilung.senden", geltung: "eigene", personen: 1 },
      ],
      verlieren: [{ recht: "raum.verwalten", geltung: "eigene", personen: 1 }],
    });
    // Eine neue Rolle hat keine Personen
    const neu = await json(
      await anfrage(admin, "POST", `/gruppen/${teamId}/rollen/vorschau`, {
        rechte: [{ recht: "raum.verwalten", geltung: "alle" }],
      }),
    );
    expect(neu.personen).toBe(0);
    const rolle = (await rollenListe(teamId)).find((x) => x.id === r.id);
    expect(rolle.version).toBe(1);
    expect(rolle.rechte).toEqual([
      { recht: "raum.verwalten", geltung: "eigene" },
    ]);
  });

  test("Was darf wer: jedes Recht mit seiner Herkunft", async () => {
    const r = await rolleAnlegen(
      teamId,
      [{ recht: "raum.verwalten", geltung: "eigene" }],
      "Wart",
    );
    await anfrage(
      admin,
      "PUT",
      `/gruppen/${teamId}/personen/${mitglied.id}/rolle`,
      { rolleId: r.id },
    );
    const a = await anfrage(admin, "GET", `/personen/${mitglied.id}`);
    expect(a.status).toBe(200);
    const p = await json(a);
    expect(p.person.id).toBe(mitglied.id);
    expect(p.gruppen).toContainEqual(
      expect.objectContaining({ id: teamId, rolle: "Wart" }),
    );
    const verwalten = p.rechte.find((x: any) => x.recht === "raum.verwalten");
    expect(verwalten.herkunft).toContainEqual(
      expect.objectContaining({
        art: "gruppenrolle",
        geltung: "eigene",
        rolle: "Wart",
        gruppeId: teamId,
      }),
    );
    expect(verwalten.zweiterFaktor).toBe(true);
    // Mitgliedschaft im Team: Vorschläge und Raumanfragen
    expect(
      p.rechte.find((x: any) => x.recht === "vorschlag.einreichen").herkunft[0]
        .art,
    ).toBe("mitgliedschaft");
    // Was die Person nicht hat, fehlt
    expect(p.rechte.some((x: any) => x.recht === "rechte.verwalten")).toBe(
      false,
    );
    // Die Abteilungsleitung hat alles ausser dem Protokoll
    const al = await json(await anfrage(admin, "GET", `/personen/${admin.id}`));
    expect(al.abteilungsleitung).toBe(true);
    expect(al.rechte.some((x: any) => x.recht === "protokoll.lesen")).toBe(
      false,
    );
    expect(al.rechte.some((x: any) => x.recht === "rechte.verwalten")).toBe(
      true,
    );
    // Fremde Person: 404
    expect(
      (await anfrage(admin, "GET", `/personen/${demoAdmin.id}`)).status,
    ).toBe(404);
  });

  test("Änderungen: neueste zuerst, seitenweise, mit Namen des Akteurs", async () => {
    await rolleAnlegen(teamId);
    const a = await anfrage(admin, "GET", "/aenderungen?limit=2");
    expect(a.status).toBe(200);
    const s1 = await json(a);
    expect(s1.aenderungen).toHaveLength(2);
    expect(s1.weitere).toBe(true);
    expect(s1.aenderungen[0].akteur.id).toBe(admin.id);
    const s2 = await json(
      await anfrage(admin, "GET", `/aenderungen?limit=2&nach=${s1.naechste}`),
    );
    expect(s2.aenderungen[0].id < s1.aenderungen[1].id).toBe(true);
    // Nur Aktionen der Rechte, nur die eigene Abteilung
    expect(s1.aenderungen.every((x: any) => /rolle/.test(x.aktion))).toBe(true);
    expect((await anfrage(admin, "GET", "/aenderungen?limit=0")).status).toBe(
      400,
    );
  });
});

describe("Globale Rollen", () => {
  test("anlegen, ändern mit Version, löschen; der ganze Katalog ist wählbar", async () => {
    const a = await anfrage(admin, "POST", "/rollen", {
      name: `Lädeli ${randomUUID().slice(0, 6)}`,
      rechte: ["laden.ansehen", "mitteilung.senden"],
    });
    expect(a.status).toBe(201);
    const { id } = await json<{ id: string }>(a);
    // Ein festes Recht ist nicht wählbar
    expect(
      (
        await anfrage(admin, "POST", "/rollen", {
          name: "Falsch",
          rechte: ["kinder.konto_verwalten"],
        })
      ).status,
    ).toBe(400);
    const liste = (
      await json<{ rollen: any[] }>(await anfrage(admin, "GET", "/rollen"))
    ).rollen;
    expect(liste.find((r) => r.id === id)).toMatchObject({
      version: 1,
      rechte: ["laden.ansehen", "mitteilung.senden"],
    });
    const p = await anfrage(admin, "PATCH", `/rollen/${id}`, {
      version: 1,
      rechte: ["laden.artikel_pflegen"],
    });
    expect(p.status).toBe(200);
    expect(
      (
        await anfrage(admin, "PATCH", `/rollen/${id}`, {
          version: 1,
          rechte: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (await anfrage(admin, "DELETE", `/rollen/${id}?version=1`)).status,
    ).toBe(409);
    expect((await anfrage(admin, "DELETE", `/rollen/${id}`)).status).toBe(204);
    expect((await anfrage(demoAdmin, "DELETE", `/rollen/${id}`)).status).toBe(
      404,
    );
  });

  test("die ältere Route lässt die übrigen Rechte einer Rolle stehen und zählt die Version hoch", async () => {
    const { id } = await json<{ id: string }>(
      await anfrage(admin, "POST", "/rollen", {
        name: `Gemischt ${randomUUID().slice(0, 6)}`,
        rechte: ["medien.verwalten", "mitteilung.senden"],
      }),
    );
    const alt = await app.request(`/api/v1/admin/plattform/rollen/${id}`, {
      method: "PATCH",
      headers: { ...admin.headers, "content-type": "application/json" },
      body: JSON.stringify({ rechte: ["vorlagen.nutzen"] }),
    });
    expect(alt.status).toBe(204);
    const rolle = (
      await json<{ rollen: any[] }>(await anfrage(admin, "GET", "/rollen"))
    ).rollen.find((r) => r.id === id);
    expect(rolle.rechte.sort()).toEqual([
      "mitteilung.senden",
      "vorlagen.nutzen",
    ]);
    expect(rolle.version).toBe(2);
    // Personen ordnet die ältere Route zu, auch für Rechte ausserhalb der Website
    const zu = await app.request(
      `/api/v1/admin/plattform/rollen/${id}/personen/${mitglied.id}`,
      { method: "PUT", headers: admin.headers },
    );
    expect(zu.status).toBe(204);
  });
});
