import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { legeSystemrollenAn } from "../../src/rechtemodell/gruppenrollen.js";
import type { Zuteilung } from "../../src/rechtemodell/standard.js";
import type { Person } from "../../src/rechte.js";
import { legePersonaAn, type Welt } from "./personas.js";

// Eine Welt für die Tests des Rechtemodells (#643): zwei Stufen, ein Team mit Raum, ein Team ohne Raum, eine Funktion, ein Anlass mit OK, Gruppenrollen mit Rechten, eine Plattformrolle, Sonderrechte und Personen für jede Quelle von Rechten. Jede Person ist ein echtes Konto, damit die Fremdschlüssel halten; das Person-Objekt baut der Test wie personAusSitzung.

export interface Rechtewelt {
  welt: Welt;
  abteilungId: string;
  fremdeAbteilungId: string;
  stufeA: string;
  stufeB: string;
  team: string;
  teamOhneRaum: string;
  funktion: string;
  ok: string;
  anlassOk: string;
  anlassAnderer: string;
  raum: string;
  raumOhneTeam: string;
  seiteSonder: string;
  rollen: {
    teamRolle: string;
    okKasse: string;
    okLeitung: string;
    alleRolle: string;
    stufeRolle: string;
    plattform: string;
  };
  personen: Record<string, Person>;
}

type Rollen = Rechtewelt["rollen"];

const zeile = async (db: Db, q: Promise<{ id: string }[]>) => (await q)[0].id;

export async function legeRechtewelt(
  welt: Welt,
  sql: postgres.Sql,
): Promise<Rechtewelt> {
  const { db } = welt;
  const abt = welt.testabteilungId;

  const gruppe = async (
    typ: "team" | "funktion" | "anlass",
    name: string,
    anlassId?: string,
  ) => {
    const id = await zeile(
      db,
      db
        .insert(schema.tag)
        .values({
          abteilungId: abt,
          typ,
          name: `${name} ${randomUUID().slice(0, 6)}`,
          kuerzel: "",
          anlassId,
        })
        .returning({ id: schema.tag.id }),
    );
    await legeSystemrollenAn(db, abt, id, typ);
    return id;
  };
  for (const stufeId of [welt.stufeAId, welt.stufeBId]) {
    await legeSystemrollenAn(db, abt, stufeId, "stufe");
  }
  const team = await gruppe("team", "Mat");
  const teamOhneRaum = await gruppe("team", "Küche");
  const funktion = await gruppe("funktion", "Kasse");

  // Zwei Anlässe, einer mit OK
  const anlass = async (titel: string) => {
    const [p] = await sql<
      { id: string }[]
    >`insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis, sichtbarkeit) values (${abt}, ${`g-${randomUUID()}`}, ${titel}, true, '2027-05-01', '2027-05-01', 'intern') returning id`;
    const [a] = await sql<
      { id: string }[]
    >`insert into anlass (abteilung_id, programm_id, anmeldung_fuer, sichtbarkeit) values (${abt}, ${p.id}, 'person', 'angemeldet') returning id`;
    return a.id;
  };
  const anlassOk = await anlass("Kirmes");
  const anlassAnderer = await anlass("Ausflug");
  const ok = await gruppe("anlass", "OK Kirmes", anlassOk);

  const raum = await zeile(
    db,
    db
      .insert(schema.raum)
      .values({
        abteilungId: abt,
        name: `Materialraum ${randomUUID().slice(0, 6)}`,
        teamTagId: team,
      })
      .returning({ id: schema.raum.id }),
  );
  const raumOhneTeam = await zeile(
    db,
    db
      .insert(schema.raum)
      .values({ abteilungId: abt, name: `Saal ${randomUUID().slice(0, 6)}` })
      .returning({ id: schema.raum.id }),
  );

  const rolle = async (
    tagId: string,
    name: string,
    rechte: Zuteilung[],
    verantwortlich = false,
  ) => {
    const id = await zeile(
      db,
      db
        .insert(schema.gruppenRolle)
        .values({ abteilungId: abt, tagId, name, verantwortlich })
        .returning({ id: schema.gruppenRolle.id }),
    );
    if (rechte.length > 0) {
      await db
        .insert(schema.gruppenRolleRecht)
        .values(rechte.map((z) => ({ rolleId: id, ...z })));
    }
    return id;
  };
  const rollen: Rollen = {
    teamRolle: await rolle(team, "Materialwart", [
      { recht: "seiten.bearbeiten", geltung: "eigene" },
      { recht: "raum.anfrage_entscheiden", geltung: "eigene" },
      { recht: "raum.verwalten", geltung: "eigene" },
      { recht: "mitteilung.senden", geltung: "eigene" },
      { recht: "gruppen.verwalten", geltung: "eigene" },
    ]),
    okKasse: await rolle(ok, "Kasse", [
      { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
    ]),
    okLeitung: await rolle(
      ok,
      "Leitung",
      [
        { recht: "anlass.verwalten", geltung: "eigene" },
        { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
        { recht: "anlass.anmeldungen_exportieren", geltung: "eigene" },
        { recht: "seiten.bearbeiten", geltung: "eigene" },
        { recht: "seiten.veroeffentlichen", geltung: "eigene" },
        { recht: "mitteilung.senden", geltung: "eigene" },
      ],
      true,
    ),
    alleRolle: await rolle(teamOhneRaum, "Allrounder", [
      { recht: "raum.belegung", geltung: "alle" },
      { recht: "personen.verwalten", geltung: "alle" },
      { recht: "mitteilung.senden", geltung: "alle" },
      { recht: "seiten.bearbeiten", geltung: "alle" },
    ]),
    // Eine Rolle in einer Stufe: gibt zusätzlich zur Stufenrolle ein Recht, nur für die Stufe
    stufeRolle: await rolle(welt.stufeAId, "Kassier", [
      { recht: "mitteilung.senden", geltung: "eigene" },
    ]),
    plattform: await zeile(
      db,
      db
        .insert(schema.plattformRolle)
        .values({
          abteilungId: abt,
          name: `Helfer ${randomUUID().slice(0, 6)}`,
        })
        .returning({ id: schema.plattformRolle.id }),
    ),
  };
  await db.insert(schema.plattformRolleRecht).values(
    ["medien.verwalten", "mitteilung.senden", "laden.ansehen"].map((recht) => ({
      rolleId: rollen.plattform,
      recht,
    })),
  );

  const konto = async (name: string, admin = false): Promise<Person> => {
    const k = await legePersonaAn(welt, admin ? "admin" : "elternA");
    return {
      id: k.id!,
      abteilungId: abt,
      admin,
      zweiterFaktor: admin,
      rollen: [],
    };
  };
  const mitglied = (
    p: Person,
    tagId: string,
    rolleText: string | null,
    rolleId?: string,
  ) =>
    db
      .insert(schema.personTag)
      .values({ userId: p.id, tagId, rolle: rolleText, rolleId });
  const stufenrolle = async (
    p: Person,
    stufeId: string,
    typ: "leitung" | "stufenleitung",
  ) => {
    await db.insert(schema.rolle).values({ userId: p.id, stufeId, typ });
    p.rollen.push({ stufeId, typ });
  };

  const personen: Record<string, Person> = {};
  for (const name of [
    "al",
    "entwickler",
    "slA",
    "leitungB",
    "teamVerantwortlich",
    "teamMitglied",
    "teamRolle",
    "funktionMitglied",
    "okKasse",
    "okLeitung",
    "okOhneRolle",
    "alleRolle",
    "stufeKassier",
    "plattform",
    "sonderPerson",
    "sonderGruppe",
    "ohneAlles",
  ]) {
    personen[name] = await konto(name, name === "al");
  }
  await db
    .insert(schema.plattformEntwickler)
    .values({ userId: personen.entwickler.id });
  await stufenrolle(personen.slA, welt.stufeAId, "stufenleitung");
  await stufenrolle(personen.leitungB, welt.stufeBId, "leitung");
  await mitglied(personen.teamVerantwortlich, team, "verantwortlich");
  await mitglied(personen.teamMitglied, team, "Mitglied");
  await mitglied(personen.teamRolle, team, "Materialwart", rollen.teamRolle);
  await mitglied(personen.funktionMitglied, funktion, null);
  await mitglied(personen.okKasse, ok, null, rollen.okKasse);
  await mitglied(personen.okLeitung, ok, "Leitung", rollen.okLeitung);
  await mitglied(personen.okOhneRolle, ok, null);
  await mitglied(personen.alleRolle, teamOhneRaum, null, rollen.alleRolle);
  await mitglied(personen.stufeKassier, welt.stufeAId, null, rollen.stufeRolle);
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: personen.plattform.id, rolleId: rollen.plattform });

  // Sonderrechte je Seite: eine Person und eine Gruppe
  const seiteSonder = randomUUID();
  await db.insert(schema.bearbeiter).values({
    abteilungId: abt,
    objektTyp: "seite",
    objektId: seiteSonder,
    userId: personen.sonderPerson.id,
  });
  await mitglied(personen.sonderGruppe, funktion, null);
  await db.insert(schema.bearbeiter).values({
    abteilungId: abt,
    objektTyp: "seite",
    objektId: seiteSonder,
    tagId: funktion,
  });

  // Eine fremde Abteilung mit einer Rolle, die nie wirken darf
  const fremd = welt.demoAbteilungId;
  const fremderTag = await zeile(
    db,
    db
      .insert(schema.tag)
      .values({
        abteilungId: fremd,
        typ: "team",
        name: `Fremd ${randomUUID().slice(0, 6)}`,
        kuerzel: "",
      })
      .returning({ id: schema.tag.id }),
  );
  await legeSystemrollenAn(db, fremd, fremderTag, "team");

  return {
    welt,
    abteilungId: abt,
    fremdeAbteilungId: fremd,
    stufeA: welt.stufeAId,
    stufeB: welt.stufeBId,
    team,
    teamOhneRaum,
    funktion,
    ok,
    anlassOk,
    anlassAnderer,
    raum,
    raumOhneTeam,
    seiteSonder,
    rollen,
    personen,
  };
}

export const rolleVon = (db: Db, tagId: string, schluessel: string) =>
  db
    .select({ id: schema.gruppenRolle.id })
    .from(schema.gruppenRolle)
    .where(
      and(
        eq(schema.gruppenRolle.tagId, tagId),
        eq(schema.gruppenRolle.schluessel, schluessel as "verantwortlich"),
      ),
    )
    .then((z) => z[0]?.id);
