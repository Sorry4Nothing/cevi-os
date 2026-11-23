import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Person } from "../src/rechte.js";
import { HTTPException } from "hono/http-exception";
import {
  darf,
  schattenAbweichungen,
  schattenZuruecksetzen,
  verlange,
  ZweiterFaktorFehlt,
} from "../src/rechtemodell/darf.js";
import { pruefeEigeneRechte } from "../src/rechtemodell/eskalation.js";
import { RECHT_IDS } from "../src/rechtemodell/katalog.js";
import { setzeRechteModus } from "../src/rechtemodell/modus.js";
import { ladeRechteSatz, type Objekt } from "../src/rechtemodell/satz.js";
import { rechtSql } from "../src/rechtemodell/sql.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { erstelleWelt } from "./hilfen/personas.js";
import { legeRechtewelt, type Rechtewelt } from "./hilfen/rechtewelt.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Ein eigener Client zählt die Abfragen: Wie viele löst die Prüfung der Rechte aus?
const abfragen: string[] = [];
const zaehlSql = postgres(API_URL, {
  debug: (_verbindung, abfrage) => {
    abfragen.push(abfrage);
  },
});
const zaehlDb = erstelleDb(zaehlSql);
afterAll(() => Promise.all([sql.end(), zaehlSql.end()]));

let w: Rechtewelt;
let O: Record<string, Objekt>;
beforeAll(async () => {
  w = await legeRechtewelt(await erstelleWelt(db, auth), sql);
  const seite = () => randomUUID();
  O = {
    seiteTeam: { seiteId: seite(), tagId: w.team },
    seiteStufeA: { seiteId: seite(), tagId: w.stufeA, stufeId: w.stufeA },
    seiteStufeB: { seiteId: seite(), tagId: w.stufeB, stufeId: w.stufeB },
    seiteOk: { seiteId: seite(), anlassId: w.anlassOk },
    seiteSonder: { seiteId: w.seiteSonder },
    seiteFrei: { seiteId: seite() },
    raumTeam: { raumTeamTagId: w.team },
    raumOhneTeam: { raumTeamTagId: null },
    raumKueche: { raumTeamTagId: w.teamOhneRaum },
    anlassOk: { anlassId: w.anlassOk },
    anlassAnderer: { anlassId: w.anlassAnderer },
    gruppeTeam: { tagId: w.team },
    gruppeStufeA: { tagId: w.stufeA },
    gruppeStufeB: { tagId: w.stufeB },
    gruppeOk: { tagId: w.ok },
    // Eine Stufe ist zugleich eine Gruppe: Stufenrollen treffen über stufeId, Gruppenrollen über tagId
    stufeObjA: { tagId: w.stufeA, stufeId: w.stufeA },
    stufeObjB: { tagId: w.stufeB, stufeId: w.stufeB },
    leer: {},
  };
});

// Eine frische Kopie je Frage: Der Satz hängt am Person-Objekt (eine Abfrage je Anfrage)
const satzVon = (name: string) => ladeRechteSatz(db, { ...w.personen[name] });

// Von Hand gegengelesen, nie aus dem Katalog berechnet: Person, Recht, Objekt, Erwartung
type Fall = [string, string, string | undefined, boolean];
const FAELLE: Fall[] = [
  // Abteilungsleitung: alles, ausser dem, was nur der Entwickler hat
  ["al", "rechte.verwalten", undefined, true],
  ["al", "seiten.bearbeiten", "seiteFrei", true],
  ["al", "mitteilung.senden", "gruppeStufeB", true],
  ["al", "konto.loeschen", undefined, true],
  ["al", "protokoll.lesen", undefined, false],
  // Die Rechte der Abteilungsleitung ändert nur der Entwickler (#663)
  ["al", "rechte.abteilungsleitung", undefined, false],
  ["slA", "rechte.abteilungsleitung", undefined, false],
  ["entwickler", "rechte.abteilungsleitung", undefined, true],
  ["al", "entwickler.vergeben", undefined, true],
  // Entwickler: nur Plattform und Website, nie das Verwalten von Rechten
  ["entwickler", "seiten.bearbeiten", "seiteFrei", true],
  ["entwickler", "medien.verwalten", undefined, true],
  ["entwickler", "protokoll.lesen", undefined, true],
  ["entwickler", "plattform.sperren", undefined, true],
  ["entwickler", "profilbild.entfernen", undefined, true],
  ["entwickler", "rechte.verwalten", undefined, false],
  ["entwickler", "mitteilung.senden", "gruppeTeam", false],
  ["entwickler", "personen.verwalten", undefined, false],
  // Stufenleitung: die Seiten ihrer Stufe, Vorschläge, Belegung
  ["slA", "seiten.bearbeiten", "seiteStufeA", true],
  ["slA", "seiten.veroeffentlichen", "seiteStufeA", true],
  ["slA", "seiten.bearbeiten", "seiteStufeB", false],
  ["slA", "seiten.bearbeiten", "seiteFrei", false],
  ["slA", "vorschlag.einreichen", undefined, true],
  ["slA", "raum.belegung", "raumTeam", true],
  ["slA", "mitteilung.senden", "gruppeStufeA", false],
  ["slA", "anlass.anmeldungen_sehen", "anlassOk", false],
  // Leitung: Vorschläge und Belegung, keine Seiten
  ["leitungB", "vorschlag.einreichen", undefined, true],
  ["leitungB", "raum.belegung", "raumOhneTeam", true],
  ["leitungB", "seiten.bearbeiten", "seiteStufeB", false],
  // Team: Verantwortliche über die Systemrolle, Mitglieder über die Mitgliedschaft
  ["teamVerantwortlich", "seiten.bearbeiten", "seiteTeam", true],
  ["teamVerantwortlich", "seiten.veroeffentlichen", "seiteTeam", true],
  ["teamVerantwortlich", "seiten.bearbeiten", "seiteStufeA", false],
  ["teamVerantwortlich", "raum.belegung", "raumOhneTeam", true],
  ["teamVerantwortlich", "raum.anfrage_entscheiden", "raumTeam", true],
  ["teamVerantwortlich", "raum.anfrage_entscheiden", "raumOhneTeam", false],
  ["teamVerantwortlich", "vorschlag.einreichen", undefined, true],
  ["teamVerantwortlich", "mitteilung.senden", "gruppeTeam", false],
  ["teamMitglied", "seiten.bearbeiten", "seiteTeam", false],
  ["teamMitglied", "raum.anfrage_entscheiden", "raumTeam", true],
  ["teamMitglied", "raum.belegung", "raumOhneTeam", true],
  ["teamMitglied", "vorschlag.einreichen", undefined, true],
  // Gruppenrolle im Team: eigene Objekte, nie fremde
  ["teamRolle", "seiten.bearbeiten", "seiteTeam", true],
  ["teamRolle", "seiten.bearbeiten", "seiteFrei", false],
  ["teamRolle", "seiten.bearbeiten", "seiteStufeA", false],
  ["teamRolle", "seiten.veroeffentlichen", "seiteTeam", false],
  ["teamRolle", "raum.verwalten", "raumTeam", true],
  ["teamRolle", "raum.verwalten", "raumOhneTeam", false],
  ["teamRolle", "raum.verwalten", "raumKueche", false],
  ["teamRolle", "mitteilung.senden", "gruppeTeam", true],
  ["teamRolle", "mitteilung.senden", "gruppeStufeA", false],
  ["teamRolle", "mitteilung.senden", undefined, true],
  ["teamRolle", "gruppen.mitglieder", "gruppeTeam", true],
  ["teamRolle", "gruppen.mitglieder", "gruppeOk", false],
  ["teamRolle", "gruppen.mitglieder", undefined, true],
  // Gruppen anlegen, umbenennen und löschen gibt es nur für alle (#650)
  ["teamRolle", "gruppen.verwalten", "gruppeTeam", false],
  ["teamRolle", "rechte.verwalten", undefined, false],
  // Funktion: nur Vorschläge
  ["funktionMitglied", "vorschlag.einreichen", undefined, true],
  ["funktionMitglied", "raum.belegung", "raumTeam", false],
  ["funktionMitglied", "seiten.bearbeiten", "seiteFrei", false],
  // OK: Rechte gelten für den Anlass des OK, nie für einen anderen
  ["okKasse", "anlass.anmeldungen_sehen", "anlassOk", true],
  ["okKasse", "anlass.anmeldungen_sehen", "anlassAnderer", false],
  ["okKasse", "anlass.anmeldungen_exportieren", "anlassOk", false],
  ["okKasse", "anlass.verwalten", "anlassOk", false],
  ["okLeitung", "anlass.verwalten", "anlassOk", true],
  ["okLeitung", "anlass.verwalten", "anlassAnderer", false],
  ["okLeitung", "anlass.anmeldungen_exportieren", "anlassOk", true],
  ["okLeitung", "anlass.anmeldungen_exportieren", "anlassAnderer", false],
  ["okLeitung", "seiten.bearbeiten", "seiteOk", true],
  ["okLeitung", "seiten.bearbeiten", "seiteTeam", false],
  ["okLeitung", "mitteilung.senden", "gruppeOk", true],
  ["okLeitung", "mitteilung.senden", "gruppeTeam", false],
  ["okLeitung", "anlass.anlegen", undefined, false],
  ["okOhneRolle", "anlass.anmeldungen_sehen", "anlassOk", false],
  ["okOhneRolle", "anlass.anmeldungen_sehen", undefined, false],
  ["okKasse", "anlass.anmeldungen_sehen", undefined, true],
  // Gruppenrolle mit Geltung «alle»
  ["alleRolle", "raum.belegung", "raumOhneTeam", true],
  ["alleRolle", "personen.verwalten", undefined, true],
  ["alleRolle", "mitteilung.senden", "gruppeStufeB", true],
  ["alleRolle", "seiten.bearbeiten", "seiteStufeB", true],
  ["alleRolle", "seiten.veroeffentlichen", "seiteStufeB", false],
  ["alleRolle", "konto.loeschen", undefined, false],
  // Eine Rolle in einer Stufe gibt zusätzlich, nur für die Stufe
  ["stufeKassier", "mitteilung.senden", "gruppeStufeA", true],
  ["stufeKassier", "mitteilung.senden", "gruppeStufeB", false],
  // Plattformrolle: abteilungsweit, auch mit Rechten ausserhalb der Website
  ["plattform", "medien.verwalten", undefined, true],
  ["plattform", "mitteilung.senden", "gruppeStufeB", true],
  ["plattform", "laden.ansehen", undefined, true],
  ["plattform", "seiten.bearbeiten", "seiteFrei", false],
  // Sonderrechte je Seite: Person oder Gruppe
  ["sonderPerson", "seiten.bearbeiten", "seiteSonder", true],
  ["sonderPerson", "seiten.veroeffentlichen", "seiteSonder", true],
  ["sonderPerson", "seiten.bearbeiten", "seiteFrei", false],
  ["sonderGruppe", "seiten.bearbeiten", "seiteSonder", true],
  ["sonderGruppe", "seiten.bearbeiten", "seiteFrei", false],
  // Personen, Kinder, Stufenarbeit und Programme (#650)
  ["al", "personen.sehen", undefined, true],
  ["al", "kinder.verwalten", "stufeObjB", true],
  ["al", "anwesenheit.fuehren", "stufeObjA", true],
  ["al", "stufe.einblick", "stufeObjB", true],
  ["al", "import.ausfuehren", undefined, true],
  ["al", "gruppen.mitglieder", "gruppeOk", true],
  ["al", "programm.alle_sehen", undefined, true],
  ["al", "programm.intern_sehen", undefined, true],
  ["entwickler", "kinder.sehen", undefined, false],
  ["entwickler", "personen.sehen", undefined, false],
  ["entwickler", "programm.intern_sehen", undefined, false],
  // Die Stufenleitung führt die Anwesenheit ihrer Stufe und sieht jedes Programm, aber nie die Verwaltung der Kinder
  ["slA", "anwesenheit.fuehren", "stufeObjA", true],
  ["slA", "anwesenheit.fuehren", "stufeObjB", false],
  ["slA", "anwesenheit.fuehren", undefined, true],
  ["slA", "stufe.einblick", "stufeObjA", true],
  ["slA", "stufe.einblick", "stufeObjB", false],
  ["slA", "programm.alle_sehen", undefined, true],
  ["slA", "programm.intern_sehen", undefined, false],
  ["slA", "kinder.sehen", "stufeObjA", false],
  ["slA", "kinder.verwalten", "stufeObjA", false],
  ["slA", "personen.sehen", undefined, false],
  ["slA", "import.ausfuehren", undefined, false],
  ["slA", "gruppen.mitglieder", "stufeObjA", false],
  // Leitung: wie die Stufenleitung, aber ohne alle Programme
  ["leitungB", "anwesenheit.fuehren", "stufeObjB", true],
  ["leitungB", "anwesenheit.fuehren", "stufeObjA", false],
  ["leitungB", "stufe.einblick", "stufeObjB", true],
  ["leitungB", "programm.alle_sehen", undefined, false],
  // Eine Rolle in der Stufe gibt die Rechte nur für diese Stufe
  ["stufeKassier", "kinder.sehen", "stufeObjA", true],
  ["stufeKassier", "kinder.sehen", "stufeObjB", false],
  ["stufeKassier", "kinder.verwalten", "stufeObjA", true],
  ["stufeKassier", "kinder.verwalten", "stufeObjB", false],
  ["stufeKassier", "kinder.verwalten", undefined, true],
  ["stufeKassier", "anwesenheit.fuehren", "stufeObjA", true],
  ["stufeKassier", "anwesenheit.fuehren", "stufeObjB", false],
  ["stufeKassier", "stufe.einblick", "stufeObjA", true],
  ["stufeKassier", "personen.verwalten", undefined, false],
  // Eine Rolle mit «alle»: jede Stufe, aber nichts, was die Rolle nicht trägt
  ["alleRolle", "kinder.sehen", "stufeObjB", true],
  ["alleRolle", "kinder.verwalten", "stufeObjB", false],
  ["alleRolle", "import.ausfuehren", undefined, true],
  ["alleRolle", "gruppen.verwalten", "gruppeTeam", true],
  ["alleRolle", "gruppen.mitglieder", "gruppeTeam", false],
  ["alleRolle", "personen.sehen", undefined, false],
  // Die Plattformrolle gilt abteilungsweit
  ["plattform", "personen.sehen", undefined, true],
  ["plattform", "personen.verwalten", undefined, false],
  ["plattform", "programm.intern_sehen", undefined, true],
  ["plattform", "kinder.sehen", "stufeObjA", false],
  // Ohne alles: nur, was strukturell ist
  ["ohneAlles", "termine.mein_kalender", undefined, true],
  ["ohneAlles", "anlass.anmelden", undefined, true],
  ["ohneAlles", "laden.bestellen", undefined, true],
  ["ohneAlles", "vorschlag.einreichen", undefined, false],
  ["ohneAlles", "seiten.bearbeiten", undefined, false],
  ["ohneAlles", "mitteilung.senden", undefined, false],
  ["ohneAlles", "raum.belegung", undefined, false],
  // Ein Name, den der Katalog nicht kennt
  ["al", "seiten.bearbeitenn", undefined, false],
  ["al", "toString", undefined, false],
];

describe("RechteSatz: die Standardmatrix als Literal", () => {
  test.each(FAELLE)(
    "%s darf %s (%s): %s",
    async (name, recht, objekt, erwartet) => {
      const satz = await satzVon(name);
      expect(satz.hat(recht, objekt ? O[objekt] : undefined)).toBe(erwartet);
    },
  );

  test("ein Objekt einer fremden Abteilung gibt nie ein Recht, auch der Abteilungsleitung nicht", async () => {
    const satz = await satzVon("al");
    expect(
      satz.hat("seiten.bearbeiten", {
        ...O.seiteFrei,
        abteilungId: w.fremdeAbteilungId,
      }),
    ).toBe(false);
    expect(
      satz.hat("seiten.bearbeiten", {
        ...O.seiteFrei,
        abteilungId: w.abteilungId,
      }),
    ).toBe(true);
  });

  test("eine Rolle oder Gruppe einer anderen Abteilung gibt nie ein Recht", async () => {
    const p = w.personen.ohneAlles;
    // Eine Gruppenrolle in der fremden Abteilung, der Person zugeordnet (die Fremdschlüssel erlauben es; die Abfrage schränkt auf die Abteilung ein)
    const [fremderTag] = await db
      .select({ id: schema.tag.id })
      .from(schema.tag)
      .where(eq(schema.tag.abteilungId, w.fremdeAbteilungId));
    const [rolle] = await db
      .insert(schema.gruppenRolle)
      .values({
        abteilungId: w.fremdeAbteilungId,
        tagId: fremderTag.id,
        name: "Fremd",
      })
      .returning({ id: schema.gruppenRolle.id });
    await db.insert(schema.gruppenRolleRecht).values({
      rolleId: rolle.id,
      recht: "seiten.bearbeiten",
      geltung: "alle",
    });
    await db
      .insert(schema.personTag)
      .values({ userId: p.id, tagId: fremderTag.id, rolleId: rolle.id });
    const satz = await ladeRechteSatz(db, { ...p });
    expect(satz.hat("seiten.bearbeiten")).toBe(false);
    expect(satz.hat("seiten.bearbeiten", O.seiteFrei)).toBe(false);
    await db.delete(schema.personTag).where(eq(schema.personTag.userId, p.id));
  });

  test("eine Geltung, die der Katalog für das Recht nicht kennt, gibt nichts (fail-closed)", async () => {
    // seiten.anlegen_loeschen kennt nur «alle»: Eine Zeile mit «eigene» wirkt nicht
    const p = w.personen.okOhneRolle;
    const [rolle] = await db
      .insert(schema.gruppenRolle)
      .values({
        abteilungId: w.abteilungId,
        tagId: w.ok,
        name: `Falsch ${randomUUID().slice(0, 6)}`,
      })
      .returning({ id: schema.gruppenRolle.id });
    await db.insert(schema.gruppenRolleRecht).values([
      {
        rolleId: rolle.id,
        recht: "seiten.anlegen_loeschen",
        geltung: "eigene",
      },
      { rolleId: rolle.id, recht: "konto.loeschen", geltung: "alle" },
      { rolleId: rolle.id, recht: "unbekannt.recht", geltung: "alle" },
    ]);
    await db
      .update(schema.personTag)
      .set({ rolleId: rolle.id })
      .where(eq(schema.personTag.userId, p.id));
    const satz = await ladeRechteSatz(db, { ...p });
    expect(satz.hat("seiten.anlegen_loeschen")).toBe(false);
    // Ein festes Recht lässt sich nicht an eine Rolle hängen
    expect(satz.hat("konto.loeschen")).toBe(false);
    expect(satz.hat("unbekannt.recht")).toBe(false);
    await db
      .update(schema.personTag)
      .set({ rolleId: null })
      .where(eq(schema.personTag.userId, p.id));
    await db
      .delete(schema.gruppenRolle)
      .where(eq(schema.gruppenRolle.id, rolle.id));
  });

  test("eine Rolle einer anderen Gruppe in person_tag gibt nichts (die Rolle muss zur Gruppe gehören)", async () => {
    const p = w.personen.funktionMitglied;
    await db
      .update(schema.personTag)
      .set({ rolleId: w.rollen.alleRolle })
      .where(eq(schema.personTag.userId, p.id));
    const satz = await ladeRechteSatz(db, { ...p });
    expect(satz.hat("personen.verwalten")).toBe(false);
    await db
      .update(schema.personTag)
      .set({ rolleId: null })
      .where(eq(schema.personTag.userId, p.id));
  });

  test("Herkunft: jede Quelle nennt sich mit Rolle und Gruppe", async () => {
    const satz = await satzVon("okLeitung");
    const h = satz.herkuenfte("anlass.anmeldungen_sehen", O.anlassOk);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      art: "gruppenrolle",
      geltung: "eigene",
      rolle: "Leitung",
      gruppeId: w.ok,
    });
    const al = await satzVon("al");
    expect(al.herkuenfte("seiten.bearbeiten")[0].art).toBe("abteilungsleitung");
    const p = await satzVon("plattform");
    expect(p.herkuenfte("medien.verwalten")[0]).toMatchObject({
      art: "plattformrolle",
      geltung: "alle",
    });
    const sl = await satzVon("slA");
    expect(sl.herkuenfte("seiten.bearbeiten", O.seiteStufeA)[0]).toMatchObject({
      art: "stufenrolle",
    });
  });

  test("der zweite Faktor entfällt nur für die Stufenleitung an der eigenen Stufenseite", async () => {
    expect(
      (await satzVon("slA")).braucht2Faktor("seiten.bearbeiten", O.seiteStufeA),
    ).toBe(false);
    expect(
      (await satzVon("slA")).braucht2Faktor(
        "seiten.veroeffentlichen",
        O.seiteStufeA,
      ),
    ).toBe(false);
    // Team-Verantwortliche, Gruppenrollen und Sonderrechte brauchen ihn
    expect(
      (await satzVon("teamVerantwortlich")).braucht2Faktor(
        "seiten.bearbeiten",
        O.seiteTeam,
      ),
    ).toBe(true);
    expect(
      (await satzVon("sonderPerson")).braucht2Faktor(
        "seiten.bearbeiten",
        O.seiteSonder,
      ),
    ).toBe(true);
    expect(
      (await satzVon("okKasse")).braucht2Faktor(
        "anlass.anmeldungen_sehen",
        O.anlassOk,
      ),
    ).toBe(true);
    // Normal heisst: kein zweiter Faktor
    expect((await satzVon("slA")).braucht2Faktor("vorschlag.einreichen")).toBe(
      false,
    );
    expect(
      (await satzVon("funktionMitglied")).braucht2Faktor(
        "vorschlag.einreichen",
      ),
    ).toBe(false);
    expect((await satzVon("leitungB")).braucht2Faktor("raum.belegung")).toBe(
      false,
    );
    // Stufenarbeit (#650): ohne zweiten Faktor für Stufenrollen und die Abteilungsleitung, mit für eine Rolle der Gruppe oder der Plattform
    expect(
      (await satzVon("slA")).braucht2Faktor("anwesenheit.fuehren", O.stufeObjA),
    ).toBe(false);
    expect(
      (await satzVon("leitungB")).braucht2Faktor("stufe.einblick", O.stufeObjB),
    ).toBe(false);
    expect(
      (await satzVon("al")).braucht2Faktor("anwesenheit.fuehren", O.stufeObjA),
    ).toBe(false);
    expect(
      (await satzVon("stufeKassier")).braucht2Faktor(
        "anwesenheit.fuehren",
        O.stufeObjA,
      ),
    ).toBe(true);
    expect((await satzVon("al")).braucht2Faktor("kinder.sehen")).toBe(true);
    // Hat die Stufenleitung dieselbe Stufenseite auch über eine zweite Quelle, gilt die strengere
    expect((await satzVon("slA")).braucht2Faktor("mitteilung.senden")).toBe(
      true,
    );
  });

  test("eine Abfrage je Person und Anfrage, und keine, wenn niemand fragt", async () => {
    const person = { ...w.personen.okLeitung };
    abfragen.length = 0;
    await ladeRechteSatz(zaehlDb, person);
    await ladeRechteSatz(zaehlDb, person);
    const satz = await ladeRechteSatz(zaehlDb, person);
    satz.hat("seiten.bearbeiten", O.seiteOk);
    satz.herkuenfte("anlass.verwalten", O.anlassOk);
    expect(abfragen).toHaveLength(1);
  });
});

describe("rechtSql gegen RechteSatz (Property-Test)", () => {
  // Dieselbe Frage zweimal gerechnet, einmal im Speicher, einmal in der Datenbank, über alle Personen, alle Rechte und alle Objekte der Welt
  const spaltenFuer = (o: Objekt) => {
    const uuid = (wert: string | null | undefined) =>
      wert == null ? postgresNull : postgresUuid(wert);
    return {
      abteilungId: postgresUuid(o.abteilungId ?? w.abteilungId),
      id: uuid(o.seiteId),
      tagId: uuid(o.tagId),
      stufeId: uuid(o.stufeId),
      anlassId: uuid(o.anlassId),
      raumTeamTagId: uuid(o.raumTeamTagId),
    };
  };
  const personen = () => Object.keys(w.personen);
  const objekte = () => Object.keys(O).filter((k) => k !== "leer");

  test("für jede Person, jedes Recht und jedes Objekt gleich", async () => {
    let geprueft = 0;
    for (const name of personen()) {
      const person = { ...w.personen[name] };
      const satz = await ladeRechteSatz(db, { ...person });
      for (const objektName of objekte()) {
        const objekt = O[objektName];
        const spalten = spaltenFuer(objekt);
        const spaltenSql = RECHT_IDS.map(
          (recht, i) =>
            [
              recht,
              rechtSql(person, recht, spalten),
              rechtSql(person, recht, spalten, "rollen"),
              i,
            ] as const,
        );
        // Alle Rechte in einer Abfrage
        const abfrage = db.execute(
          sqlTemplate(
            spaltenSql.flatMap(([, alles, rollen]) => [alles, rollen]),
          ),
        ) as unknown as Promise<Record<string, boolean>[]>;
        const [zeile] = await abfrage;
        for (const [recht, , , i] of spaltenSql) {
          expect(zeile[`a${i}`], `${name} ${recht} ${objektName} (alles)`).toBe(
            satz.hat(recht, objekt),
          );
          expect(
            zeile[`r${i}`],
            `${name} ${recht} ${objektName} (Rollen)`,
          ).toBe(satz.ausRollen(recht, objekt));
          geprueft++;
        }
      }
    }
    expect(geprueft).toBeGreaterThan(5000);
  });

  test("ein Objekt einer anderen Abteilung gibt in SQL nie etwas", async () => {
    const person = { ...w.personen.al };
    const spalten = spaltenFuer({
      ...O.seiteFrei,
      abteilungId: w.fremdeAbteilungId,
    });
    const [zeile] = (await db.execute(
      sqlTemplate([rechtSql(person, "seiten.bearbeiten", spalten)]),
    )) as unknown as Record<string, boolean>[];
    expect(zeile.a0).toBe(false);
  });

  test("ein unbekanntes Recht ist in SQL false", async () => {
    const [zeile] = (await db.execute(
      sqlTemplate([rechtSql(w.personen.al, "unbekannt.recht")]),
    )) as unknown as Record<string, boolean>[];
    expect(zeile.a0).toBe(false);
  });
});

describe("darf(): alt, schatten, neu", () => {
  const eigene = (name: string): Person => ({ ...w.personen[name] });

  test("alt: Rollen der Gruppen wirken nicht, nur die alten Funktionen", async () => {
    setzeRechteModus("alt");
    try {
      // Das Recht stammt allein aus der Gruppenrolle «Materialwart»
      expect(
        await darf(db, eigene("teamRolle"), "mitteilung.senden", O.gruppeTeam),
      ).toBe(false);
      expect(
        await darf(db, eigene("al"), "mitteilung.senden", O.gruppeTeam),
      ).toBe(true);
      // Die alten Wege bleiben: Team-Verantwortliche an der Teamseite (die Funktion liest die Seite nur über die Gruppe)
      expect(await darf(db, eigene("slA"), "vorschlag.einreichen")).toBe(true);
    } finally {
      setzeRechteModus("schatten");
    }
  });

  test("schatten: der alte Weg und die Rollen setzen durch, alles andere nicht", async () => {
    setzeRechteModus("schatten");
    expect(
      await darf(db, eigene("teamRolle"), "mitteilung.senden", O.gruppeTeam),
    ).toBe(true);
    expect(
      await darf(db, eigene("teamRolle"), "mitteilung.senden", O.gruppeStufeA),
    ).toBe(false);
    expect(
      await darf(db, eigene("plattform"), "mitteilung.senden", O.gruppeStufeB),
    ).toBe(true);
    expect(
      await darf(db, eigene("ohneAlles"), "mitteilung.senden", O.gruppeTeam),
    ).toBe(false);
    expect(await darf(db, eigene("al"), "personen.verwalten")).toBe(true);
    expect(await darf(db, eigene("teamRolle"), "unbekannt.recht")).toBe(false);
  });

  test("schatten: Abweichungen zwischen altem und neuem Weg stehen im Protokoll, der alte Weg setzt durch", async () => {
    schattenZuruecksetzen();
    // Freitext «verantwortlich», aber ohne die Systemrolle (rolle_id leer): Der alte Weg kennt den Freitext, der neue nicht
    const p = eigene("teamVerantwortlich");
    await db
      .update(schema.personTag)
      .set({ rolleId: null })
      .where(eq(schema.personTag.userId, p.id));
    try {
      expect(
        await darf(db, { ...p }, "seiten.bearbeiten", {
          ...O.seiteTeam,
          abteilungId: w.abteilungId,
        }),
      ).toBe(true);
      expect(schattenAbweichungen()).toMatchObject({
        "seiten.bearbeiten:alt_ja_neu_nein": 1,
      });
      // Im Modus «neu» gibt die Person dort nichts mehr
      setzeRechteModus("neu");
      expect(await darf(db, { ...p }, "seiten.bearbeiten", O.seiteTeam)).toBe(
        false,
      );
    } finally {
      setzeRechteModus("schatten");
      await db
        .update(schema.personTag)
        .set({ rolleId: (await rolleDerGruppe(w.team)) ?? null })
        .where(eq(schema.personTag.userId, p.id));
    }
  });

  test("schatten: eine Person, bei der beide Wege übereinstimmen, löst keine Abweichung aus", async () => {
    schattenZuruecksetzen();
    for (const [name, recht, objekt] of [
      ["slA", "seiten.bearbeiten", "seiteStufeA"],
      ["slA", "vorschlag.einreichen", undefined],
      ["teamVerantwortlich", "seiten.bearbeiten", "seiteTeam"],
      ["teamVerantwortlich", "raum.belegung", undefined],
      ["leitungB", "raum.belegung", undefined],
      ["funktionMitglied", "vorschlag.einreichen", undefined],
      ["sonderPerson", "seiten.bearbeiten", "seiteSonder"],
      ["plattform", "medien.verwalten", undefined],
      ["al", "personen.verwalten", undefined],
      ["entwickler", "medien.verwalten", undefined],
      ["entwickler", "protokoll.lesen", undefined],
      ["ohneAlles", "seiten.bearbeiten", "seiteFrei"],
    ] as const) {
      await darf(db, eigene(name), recht, objekt ? O[objekt] : undefined);
    }
    expect(schattenAbweichungen()).toEqual({});
  });

  test("neu: nur der RechteSatz entscheidet", async () => {
    setzeRechteModus("neu");
    try {
      expect(
        await darf(
          db,
          eigene("okKasse"),
          "anlass.anmeldungen_sehen",
          O.anlassOk,
        ),
      ).toBe(true);
      expect(
        await darf(
          db,
          eigene("okKasse"),
          "anlass.anmeldungen_sehen",
          O.anlassAnderer,
        ),
      ).toBe(false);
      expect(await darf(db, eigene("entwickler"), "protokoll.lesen")).toBe(
        true,
      );
      expect(await darf(db, eigene("al"), "protokoll.lesen")).toBe(false);
    } finally {
      setzeRechteModus("schatten");
    }
  });

  test("ein Objekt einer fremden Abteilung ist in jedem Modus verweigert", async () => {
    for (const modus of ["alt", "schatten", "neu"] as const) {
      setzeRechteModus(modus);
      try {
        expect(
          await darf(db, eigene("al"), "seiten.bearbeiten", {
            abteilungId: w.fremdeAbteilungId,
          }),
        ).toBe(false);
      } finally {
        setzeRechteModus("schatten");
      }
    }
  });

  test("verlange: 403 ohne Recht, danach 403 ZWEITER_FAKTOR_FEHLT, sonst still", async () => {
    // Ohne Recht
    await expect(
      verlange(db, eigene("ohneAlles"), "mitteilung.senden", O.gruppeTeam),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verlange(db, eigene("ohneAlles"), "mitteilung.senden", O.gruppeTeam),
    ).rejects.not.toBeInstanceOf(ZweiterFaktorFehlt);
    // Recht ja, zweiter Faktor nein
    const ohne = { ...eigene("teamRolle"), zweiterFaktor: false };
    const fehler = await verlange(
      db,
      ohne,
      "mitteilung.senden",
      O.gruppeTeam,
    ).catch((f) => f);
    expect(fehler).toBeInstanceOf(ZweiterFaktorFehlt);
    expect(fehler).toBeInstanceOf(HTTPException);
    expect(fehler.status).toBe(403);
    // Mit zweitem Faktor
    await expect(
      verlange(
        db,
        { ...ohne, zweiterFaktor: true },
        "mitteilung.senden",
        O.gruppeTeam,
      ),
    ).resolves.toBeUndefined();
    // Die Stufenleitung braucht ihn an der eigenen Stufenseite nicht
    await expect(
      verlange(
        db,
        { ...eigene("slA"), zweiterFaktor: false },
        "seiten.bearbeiten",
        O.seiteStufeA,
      ),
    ).resolves.toBeUndefined();
    // Normale Rechte brauchen ihn nie
    await expect(
      verlange(
        db,
        { ...eigene("funktionMitglied"), zweiterFaktor: false },
        "vorschlag.einreichen",
      ),
    ).resolves.toBeUndefined();
  });

  test("ein Datenbankfehler gibt nie «erlaubt» (die Abfrage wirft)", async () => {
    const kaputt = {
      select: () => {
        throw new Error("Datenbank weg");
      },
      execute: () => Promise.reject(new Error("Datenbank weg")),
    } as unknown as Parameters<typeof darf>[0];
    await expect(
      darf(
        kaputt,
        { ...w.personen.teamRolle },
        "mitteilung.senden",
        O.gruppeTeam,
      ),
    ).rejects.toThrow("Datenbank weg");
  });
});

describe("Eskalationsschutz", () => {
  test("wer nur «eigene» hat, vergibt nie «alle»; wer ein Recht nicht hat, vergibt es nicht", async () => {
    const teamRolle = { ...w.personen.teamRolle };
    // Hat «Mitteilungen senden» für die eigene Gruppe: darf «eigene» vergeben, nicht «alle»
    await expect(
      pruefeEigeneRechte(db, teamRolle, [
        { recht: "mitteilung.senden", geltung: "eigene" },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      pruefeEigeneRechte(db, { ...w.personen.teamRolle }, [
        { recht: "mitteilung.senden", geltung: "alle" },
      ]),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      pruefeEigeneRechte(db, { ...w.personen.teamRolle }, [
        { recht: "personen.verwalten", geltung: "alle" },
      ]),
    ).rejects.toMatchObject({ status: 403 });
    // Die Abteilungsleitung hat jedes Recht in jeder Geltung
    await expect(
      pruefeEigeneRechte(db, { ...w.personen.al }, [
        { recht: "personen.verwalten", geltung: "alle" },
        { recht: "seiten.bearbeiten", geltung: "eigene" },
      ]),
    ).resolves.toBeUndefined();
  });
});

async function rolleDerGruppe(tagId: string) {
  const [z] = await db
    .select({ id: schema.gruppenRolle.id })
    .from(schema.gruppenRolle)
    .where(
      and(
        eq(schema.gruppenRolle.tagId, tagId),
        eq(schema.gruppenRolle.schluessel, "verantwortlich"),
      ),
    );
  return z?.id;
}

// Hilfen für die SQL-Abfrage: ein Ausdruck je Spalte, a0, r0, a1, r1 ...
import { sql as dsql, type SQL } from "drizzle-orm";
const postgresNull = dsql`null::uuid`;
const postgresUuid = (wert: string) => dsql`${wert}::uuid`;
function sqlTemplate(ausdruecke: SQL[]): SQL {
  const spalten = ausdruecke.map((a, i) =>
    ausdruecke.length === 1
      ? dsql`(${a}) as ${dsql.raw("a0")}`
      : dsql`coalesce((${a}), false) as ${dsql.raw(i % 2 === 0 ? `a${i / 2}` : `r${(i - 1) / 2}`)}`,
  );
  return dsql`select ${dsql.join(spalten, dsql`, `)}`;
}

describe("alter und neuer Weg über alle Personen", () => {
  // Jedes Recht mit eigener Hülle um eine alte Funktion, an allen Objekten der Welt: Der neue Weg gibt dasselbe, ausser in den Fällen, die der Nutzer entschieden hat (docs/rechte.md 8.4)
  const MIT_HUELLE = [
    "seiten.bearbeiten",
    "seiten.veroeffentlichen",
    "seiten.anlegen_loeschen",
    "medien.verwalten",
    "weiterleitungen.verwalten",
    "vorlagen.nutzen",
    "wartungsmodus.website",
    "vorschlag.einreichen",
    "raum.belegung",
    "raum.anfrage_entscheiden",
    "plattform.sperren",
    "protokoll.lesen",
  ];

  test("keine unerklärte Abweichung", async () => {
    setzeRechteModus("alt");
    const abweichungen: string[] = [];
    try {
      for (const name of Object.keys(w.personen)) {
        // Gruppenrollen kennt der alte Weg nicht: nur Personen ohne Rolle in einer Gruppe vergleichen, die Rechte aus Rollen sind der Zuwachs
        for (const recht of MIT_HUELLE) {
          for (const [objektName, objekt] of Object.entries(O)) {
            // Eine Stufe ohne Seite (stufeObj*) kennt der alte Weg der Seiten nicht: Er fragt immer nach der Seite
            if (
              objektName.startsWith("stufeObj") &&
              recht.startsWith("seiten.")
            ) {
              continue;
            }
            const person = { ...w.personen[name] };
            const alt = await darf(db, person, recht, {
              ...objekt,
              abteilungId: w.abteilungId,
            });
            const satz = await ladeRechteSatz(db, { ...w.personen[name] });
            const neu = satz.hat(recht, {
              ...objekt,
              abteilungId: w.abteilungId,
            });
            const ausRolle = satz.ausRollen(recht, {
              ...objekt,
              abteilungId: w.abteilungId,
            });
            // Was nur die Rollen geben, ist der gewollte Zuwachs
            if (alt !== neu && !(neu && ausRolle)) {
              abweichungen.push(
                `${name} ${recht} ${objektName}: alt ${alt}, neu ${neu}`,
              );
            }
          }
        }
      }
    } finally {
      setzeRechteModus("schatten");
    }
    // Gewollt: Die Abteilungsleitung entscheidet Raumanfragen eines Teams mit (alt nur Mitglieder des Teams)
    expect(
      abweichungen.filter((a) => !a.startsWith("al raum.anfrage_entscheiden")),
    ).toEqual([]);
  }, 120_000);
});
