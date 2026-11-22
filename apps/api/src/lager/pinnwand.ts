import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  gruppe,
  gruppeZuordnung,
  lagerDatei,
  lagerMitglied,
  pinnwandBeitrag,
  pinnwandDatei,
  pinnwandEmpfaenger,
  pinnwandGesehen,
  ressort,
  user,
} from "../db/schema.js";
import { dateiAnsicht, ladeSichtbareDatei } from "./datei.js";
import { registriereDateiVerweis } from "./datei-verweise.js";
import { benachrichtige, type Zustellung } from "./benachrichtigung.js";
import { lehneAb, registriereOperation } from "./operationen.js";
import { darf, type LagerZugriff } from "./policy.js";
import { ladeRollenRechte } from "./rechte.js";
import { ladeReaktionen, ladeUmfragen } from "./umfragen.js";
import {
  aendereZeile,
  legeZeileAn,
  loescheZeile,
  type SchreibKontext,
  type Tx,
} from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";
import { anzeigeNamenLager } from "./zimmer.js";

// Pinnwand des Lagers (#381): Beiträge mit Wichtig, Anheften, Zeitfenster, Empfängern und Dateien (Verknüpfungen aus #370, kein Upload). Der Server filtert die Sichtbarkeit:
//   - Wer pinnwand.bearbeiten hat (Lagerleitung, Abteilungsleitung, im Standard die Leitung), sieht jeden Beitrag.
//   - Alle anderen mit pinnwand.lesen sehen einen Beitrag nur im Zeitfenster und nur, wenn er zu ihnen passt: ohne Empfänger gilt er für alle Mitglieder, sonst für die genannten Rollen und Personen.
// Das Zeitfenster wertet die Abfrage aus (now()); es gibt keinen Job. Ein Beitrag, der ins Fenster tritt oder es verlässt, erzeugt deshalb keinen Eintrag im Änderungsfeed: Die Apps lesen die Liste beim Öffnen und halten sichtbarAb und sichtbarBis fest.
// Empfänger und Dateien gehören zum Beitrag: Eine Änderung daran zählt die Version des Beitrags hoch und erscheint im Feed als Änderung des Beitrags.
// Schnittstelle für den Eingang (#383): Eine Rückfrage zu einer Mitteilung verweist auf die ID des Beitrags; beitragLesbar() sagt, ob die Person ihn sehen darf.

export const kannAlleSehen = (z: Pick<LagerZugriff, "rolle" | "rechte">) =>
  darf(z, "pinnwand.bearbeiten");

// Qualifizierte Namen von Hand: Ein Zeilenfilter steht in Abfragen mit und ohne Verbund, und drizzle lässt den Tabellennamen in einer Abfrage ohne Verbund weg (dann träfe «id» im Unterselect die Empfänger-Tabelle)
const B = {
  id: sql.raw('"pinnwand_beitrag"."id"'),
  ab: sql.raw('"pinnwand_beitrag"."sichtbar_ab"'),
  bis: sql.raw('"pinnwand_beitrag"."sichtbar_bis"'),
  erstellt: sql.raw('"pinnwand_beitrag"."erstellt_am"'),
};
const IM_FENSTER = sql`(${B.ab} is null or ${B.ab} <= now()) and (${B.bis} is null or ${B.bis} > now())`;

// Eine Teilabfrage statt einer je Empfänger: bool_or über die Empfänger des Beitrags; ohne Empfänger (NULL) gilt er für alle. coalesce je Vergleich, weil «false or NULL» NULL ist und eine fremde Rolle sonst nicht als Nein zählt
// Ein Ressort als Empfänger meint dessen Leitung, Stellvertretung und die Mitglieder, die diesem Ressort zugeordnet sind (lager_mitglied.ressort_id); eine Gruppe meint die Leitenden in dieser Gruppe (gruppe_zuordnung). Ein gelöschtes Ressort oder eine gelöschte Gruppe trifft niemanden, der Beitrag bleibt aber eingeschränkt (kein Fremdschlüssel, Migration 0107)
const empfaengerPasst = (z: Pick<LagerZugriff, "rolle" | "personId">) =>
  sql`coalesce((select bool_or(
    coalesce(e.rolle = ${z.rolle}, false)
    or coalesce(e.person_id = ${z.personId}::uuid, false)
    or (e.ressort_id is not null and exists (select 1 from ressort r where r.lager_id = e.lager_id and r.id = e.ressort_id and (r.leitung_person_id = ${z.personId}::uuid or r.stv_person_id = ${z.personId}::uuid or exists (select 1 from lager_mitglied m where m.lager_id = e.lager_id and m.person_id = ${z.personId}::uuid and m.ressort_id = r.id))))
    or (e.gruppe_id is not null and exists (select 1 from gruppe_zuordnung g where g.lager_id = e.lager_id and g.gruppe_id = e.gruppe_id and g.person_id = ${z.personId}::uuid))
  ) from pinnwand_empfaenger e where e.beitrag_id = ${B.id}), true)`;

// Welche nicht gelöschten Beiträge die Person sieht. alle: ohne Zeitfenster (nur wer bearbeiten darf)
function lesbar(zugriff: LagerZugriff, alle = false) {
  if (kannAlleSehen(zugriff)) return alle ? undefined : IM_FENSTER;
  return and(IM_FENSTER, empfaengerPasst(zugriff));
}

// Suche (#399): Titel und Text, mit der Sicht der Liste (Zeitfenster und Empfänger; wer bearbeiten darf, findet auch Beiträge ausserhalb des Fensters)
registriereSuchquelle({
  typ: "pinnwand",
  recht: "pinnwand.lesen",
  tabelle: pinnwandBeitrag,
  spalten: [pinnwandBeitrag.titel, pinnwandBeitrag.text],
  titel: sql`${pinnwandBeitrag.titel}`,
  filter: (zugriff) => lesbar(zugriff, true),
});

// Für den Eingang (#383) und alle, die einen Beitrag von Dritten aufrufen lassen: darf die Person ihn lesen?
export async function beitragLesbar(db: Db, zugriff: LagerZugriff, id: string) {
  const [zeile] = await db
    .select({ id: pinnwandBeitrag.id })
    .from(pinnwandBeitrag)
    .where(
      and(
        eq(pinnwandBeitrag.id, id),
        eq(pinnwandBeitrag.lagerId, zugriff.lager.id),
        lesbar(zugriff, true),
      ),
    );
  return zeile !== undefined;
}

// Der Feed meldet nur IDs, nie Inhalt: Er meldet einen Beitrag, wenn er zur Person passt (Zeitfenster gilt hier nicht, sonst bliebe ein Beitrag auf dem Gerät, der gerade ausserhalb des Fensters geändert wurde) und jeden gelöschten (damit Geräte ihn entfernen). Die Route liefert den Inhalt nur im Fenster. Dateien am Beitrag meldet der Feed nicht: Die Änderung zählt die Version des Beitrags hoch
registriereLagerTabelle({
  tabelle: pinnwandBeitrag,
  recht: "pinnwand.lesen",
  sichtbar: async (db, zugriff, ids) => {
    const zeilen = await db
      .select({ id: pinnwandBeitrag.id })
      .from(pinnwandBeitrag)
      .where(
        and(
          eq(pinnwandBeitrag.lagerId, zugriff.lager.id),
          inArray(pinnwandBeitrag.id, ids),
          kannAlleSehen(zugriff) ? undefined : empfaengerPasst(zugriff),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});
registriereLagerTabelle({
  tabelle: pinnwandDatei,
  recht: null,
  sichtbar: async () => new Set(),
});

// Eine Datei ist sichtbar, wenn ein Beitrag sie einbindet, den die Person lesen darf. Eine Abfrage für alle Einträge
registriereDateiVerweis({
  tabelle: pinnwandDatei,
  spalte: pinnwandDatei.dateiId,
  recht: "pinnwand.lesen",
  sichtbar: async (db, zugriff, dateiIds) => {
    const zeilen = await db
      .selectDistinct({ id: pinnwandDatei.dateiId })
      .from(pinnwandDatei)
      .innerJoin(
        pinnwandBeitrag,
        eq(pinnwandBeitrag.id, pinnwandDatei.beitragId),
      )
      .where(
        and(
          inArray(pinnwandDatei.dateiId, dateiIds),
          eq(pinnwandDatei.lagerId, zugriff.lager.id),
          lesbar(zugriff, true),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});

// Ansichten: nur die Spalten der Route, nie die ganze Zeile (auch für die Konfliktantwort des Sync-Kerns)
export const beitragAnsicht = (b: typeof pinnwandBeitrag.$inferSelect) => ({
  id: b.id,
  version: b.version,
  titel: b.titel,
  text: b.text,
  wichtig: b.wichtig,
  angeheftet: b.angeheftet,
  sichtbarAb: b.sichtbarAb,
  sichtbarBis: b.sichtbarBis,
  vonPersonId: b.erstelltVon,
  erstelltAm: b.erstelltAm,
});
const bindungAnsicht = (d: typeof pinnwandDatei.$inferSelect) => ({
  id: d.id,
  version: d.version,
  beitragId: d.beitragId,
  dateiId: d.dateiId,
  reihenfolge: d.reihenfolge,
});

// Eingaben: strikt, nur die genannten Felder (SR-72)
const einmalig = (l: unknown[]) => new Set(l).size === l.length;
const empfaengerSchema = z.strictObject({
  rollen: z
    .array(z.enum(["leitung", "team", "lesen"]))
    .max(3)
    .refine(einmalig),
  personen: z.array(z.uuid()).max(100).refine(einmalig),
  // Ressorts und Gruppen des Lagers als Empfänger (#520); ohne Angabe keine
  ressortIds: z.array(z.uuid()).max(50).refine(einmalig).default([]),
  gruppeIds: z.array(z.uuid()).max(50).refine(einmalig).default([]),
});
export type EmpfaengerEingabe = z.output<typeof empfaengerSchema>;
const titel = z.string().trim().min(1).max(200);
const text = z.string().trim().max(10000);
const zeit = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .nullable();
const dateiIds = z.array(z.uuid()).max(10).refine(einmalig);

export const beitragAnlegen = z.strictObject({
  titel,
  text: text.default(""),
  wichtig: z.boolean().default(false),
  angeheftet: z.boolean().default(false),
  sichtbarAb: zeit.optional(),
  sichtbarBis: zeit.optional(),
  empfaenger: empfaengerSchema.optional(),
  dateiIds: dateiIds.optional(),
});
export const beitragAendern = z
  .strictObject({
    version: z.number().int().min(1),
    titel: titel.optional(),
    text: text.optional(),
    wichtig: z.boolean().optional(),
    angeheftet: z.boolean().optional(),
    sichtbarAb: zeit.optional(),
    sichtbarBis: zeit.optional(),
    empfaenger: empfaengerSchema.optional(),
    dateiIds: dateiIds.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});
export const listeAbfrage = z.strictObject({
  // aktiv: was jetzt im Zeitfenster liegt; alle: auch Vergangenes und Künftiges, nur mit pinnwand.bearbeiten
  status: z.enum(["aktiv", "alle"]).default("aktiv"),
  // Cursor: die ID des letzten Beitrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type Pruefung =
  | {
      fehler:
        | "KEIN_MITGLIED"
        | "RESSORT_UNBEKANNT"
        | "GRUPPE_UNBEKANNT"
        | "DATEI_UNBEKANNT"
        | "ZEITFENSTER_UNGUELTIG";
    }
  | undefined;

export const fensterGueltig = (ab?: Date | null, bis?: Date | null) =>
  !ab || !bis || bis > ab;

// Personen als Empfänger müssen Mitglieder dieses Lagers sein, Dateien im Lager liegen und für die Person sichtbar sein (sie bindet nichts ein, was sie nicht sieht); bereits eingebundene Dateien bleiben unberührt
export async function pruefeBeitragWerte(
  db: Pick<Db, "select" | "selectDistinct">,
  zugriff: LagerZugriff,
  w: {
    personen?: string[];
    ressortIds?: string[];
    gruppeIds?: string[];
    dateiIds?: string[];
    schonEingebunden?: Set<string>;
  },
): Promise<Pruefung> {
  if (w.personen && w.personen.length > 0) {
    const gefunden = await db
      .select({ id: lagerMitglied.personId })
      .from(lagerMitglied)
      .where(
        and(
          eq(lagerMitglied.lagerId, zugriff.lager.id),
          inArray(lagerMitglied.personId, w.personen),
        ),
      );
    if (gefunden.length !== w.personen.length) {
      return { fehler: "KEIN_MITGLIED" };
    }
  }
  // Ressorts und Gruppen müssen zu diesem Lager gehören
  if (w.ressortIds && w.ressortIds.length > 0) {
    const gefunden = await db
      .select({ id: ressort.id })
      .from(ressort)
      .where(
        and(
          eq(ressort.lagerId, zugriff.lager.id),
          inArray(ressort.id, w.ressortIds),
        ),
      );
    if (gefunden.length !== w.ressortIds.length) {
      return { fehler: "RESSORT_UNBEKANNT" };
    }
  }
  if (w.gruppeIds && w.gruppeIds.length > 0) {
    const gefunden = await db
      .select({ id: gruppe.id })
      .from(gruppe)
      .where(
        and(
          eq(gruppe.lagerId, zugriff.lager.id),
          inArray(gruppe.id, w.gruppeIds),
        ),
      );
    if (gefunden.length !== w.gruppeIds.length) {
      return { fehler: "GRUPPE_UNBEKANNT" };
    }
  }
  for (const id of w.dateiIds ?? []) {
    if (w.schonEingebunden?.has(id)) continue;
    if (!(await ladeSichtbareDatei(db, zugriff, zugriff.personId, id))) {
      return { fehler: "DATEI_UNBEKANNT" };
    }
  }
  return undefined;
}

// Ersetzt die Empfänger des Beitrags (Löschen und Einfügen in der Transaktion; es sind höchstens 203 Zeilen)
export async function setzeEmpfaenger(
  tx: Tx,
  lagerId: string,
  beitragId: string,
  e: EmpfaengerEingabe,
) {
  await tx
    .delete(pinnwandEmpfaenger)
    .where(eq(pinnwandEmpfaenger.beitragId, beitragId));
  const zeilen = [
    ...e.rollen.map((rolle) => ({ lagerId, beitragId, rolle })),
    ...e.personen.map((personId) => ({ lagerId, beitragId, personId })),
    ...e.ressortIds.map((ressortId) => ({ lagerId, beitragId, ressortId })),
    ...e.gruppeIds.map((gruppeId) => ({ lagerId, beitragId, gruppeId })),
  ];
  if (zeilen.length > 0) await tx.insert(pinnwandEmpfaenger).values(zeilen);
}

// Gleicht die Dateien des Beitrags mit der Liste ab (Reihenfolge der Liste gilt): fehlende Verweise werden gelöscht, neue angelegt. Die Datei selbst (lager_datei) und der Ablageort bleiben; ein Eintrag ohne Verweis entfällt nach 24 Stunden (lager/datei-verweise.ts)
export async function setzeDateien(
  tx: Tx,
  k: SchreibKontext,
  beitragId: string,
  ids: string[],
) {
  const vorhanden = await tx
    .select()
    .from(pinnwandDatei)
    .where(
      and(
        eq(pinnwandDatei.lagerId, k.lagerId),
        eq(pinnwandDatei.beitragId, beitragId),
      ),
    );
  const gewollt = new Set(ids);
  for (const v of vorhanden) {
    if (!gewollt.has(v.dateiId)) {
      await loescheZeile(tx, pinnwandDatei, k, {
        id: v.id,
        version: v.version,
        ansicht: bindungAnsicht,
      });
    }
  }
  const nach = new Map(vorhanden.map((v) => [v.dateiId, v]));
  for (const [reihenfolge, dateiId] of ids.entries()) {
    const v = nach.get(dateiId);
    if (!v) {
      await legeZeileAn(tx, pinnwandDatei, k, {
        beitragId,
        dateiId,
        reihenfolge,
      });
    } else if (v.reihenfolge !== reihenfolge) {
      await aendereZeile(tx, pinnwandDatei, k, {
        id: v.id,
        version: v.version,
        werte: { reihenfolge },
        ansicht: bindungAnsicht,
      });
    }
  }
}

export const istJetztSichtbar = (
  ab: Date | null | undefined,
  bis: Date | null | undefined,
  jetzt = new Date(),
) => (!ab || ab <= jetzt) && (!bis || bis > jetzt);

// Push bei einer wichtigen Mitteilung (Art pinnwand_wichtig, #369): Der Push nennt nur den festen Titel und den Lagertitel, nie den Inhalt. Empfänger sind die Mitglieder, die der Beitrag meint und die pinnwand.lesen haben; der Auslöser nicht. Ein Beitrag, der erst später sichtbar wird, löst nichts aus (kein Job; Annahme, im PR genannt)
export async function benachrichtigeUeberBeitrag(
  tx: Tx,
  lagerId: string,
  beitragId: string,
  e: EmpfaengerEingabe,
  ausgeloestVon: string,
) {
  const mitglieder = await tx
    .select({
      id: lagerMitglied.personId,
      rolle: lagerMitglied.rolle,
      ressortId: lagerMitglied.ressortId,
    })
    .from(lagerMitglied)
    .where(eq(lagerMitglied.lagerId, lagerId));
  // Wer zu den genannten Ressorts (Leitung, Stellvertretung, Zuordnung) und Gruppen gehört, wie in der Sicht (empfaengerPasst); je eine Abfrage, nur wenn der Beitrag sie nennt
  const ausZielen = new Set<string>();
  if (e.ressortIds.length > 0) {
    const leitung = await tx
      .select({ leitung: ressort.leitungPersonId, stv: ressort.stvPersonId })
      .from(ressort)
      .where(
        and(eq(ressort.lagerId, lagerId), inArray(ressort.id, e.ressortIds)),
      );
    for (const z of leitung) {
      if (z.leitung) ausZielen.add(z.leitung);
      if (z.stv) ausZielen.add(z.stv);
    }
    for (const m of mitglieder) {
      if (m.ressortId && e.ressortIds.includes(m.ressortId)) {
        ausZielen.add(m.id);
      }
    }
  }
  if (e.gruppeIds.length > 0) {
    const zeilen = await tx
      .select({ personId: gruppeZuordnung.personId })
      .from(gruppeZuordnung)
      .where(
        and(
          eq(gruppeZuordnung.lagerId, lagerId),
          inArray(gruppeZuordnung.gruppeId, e.gruppeIds),
        ),
      );
    for (const z of zeilen) if (z.personId) ausZielen.add(z.personId);
  }
  const anAlle =
    e.rollen.length === 0 &&
    e.personen.length === 0 &&
    e.ressortIds.length === 0 &&
    e.gruppeIds.length === 0;
  const passend = mitglieder.filter(
    (m) =>
      anAlle ||
      (m.rolle !== "lagerleitung" && e.rollen.includes(m.rolle)) ||
      e.personen.includes(m.id) ||
      ausZielen.has(m.id),
  );
  // Das Recht je Rolle einmal (höchstens drei Abfragen)
  const darfLesen = new Map<string, boolean>();
  for (const rolle of new Set(passend.map((m) => m.rolle))) {
    darfLesen.set(
      rolle,
      rolle === "lagerleitung" ||
        darf(
          { rolle, rechte: await ladeRollenRechte(tx, lagerId, rolle) },
          "pinnwand.lesen",
        ),
    );
  }
  return benachrichtige(tx, {
    lagerId,
    empfaengerIds: passend
      .filter((m) => darfLesen.get(m.rolle))
      .map((m) => m.id),
    art: "pinnwand_wichtig",
    objekt: { typ: "pinnwand_beitrag", id: beitragId },
    ausgeloestVon,
  });
}

// Eine Seite Beiträge in einer Abfrage mit Zeilenfilter (Zeitfenster und Empfänger), Name der Autorin oder des Autors und den Empfängern als Teilabfragen; dazu eine Abfrage für die Dateien der ganzen Seite. Reihenfolge: Angeheftete zuerst, dann nach Sichtbarkeitsbeginn (ohne: Erstellung), neueste zuerst
export async function ladeBeitraege(
  db: Db,
  zugriff: LagerZugriff,
  p: { id?: string; nach?: string; limit: number; alle?: boolean },
) {
  const lagerId = zugriff.lager.id;
  const sortzeit = sql`coalesce(${B.ab}, ${B.erstellt})`;
  const zeilen = await db
    .select({
      zeile: pinnwandBeitrag,
      name: user.name,
      ceviName: user.ceviName,
      rollen: sql<
        string[]
      >`coalesce((select array_agg(e.rolle order by e.rolle) from pinnwand_empfaenger e where e.beitrag_id = ${B.id} and e.rolle is not null), '{}')`,
      personen: sql<
        string[]
      >`coalesce((select array_agg(e.person_id::text order by e.person_id) from pinnwand_empfaenger e where e.beitrag_id = ${B.id} and e.person_id is not null), '{}')`,
      ressortIds: sql<
        string[]
      >`coalesce((select array_agg(e.ressort_id::text order by e.ressort_id) from pinnwand_empfaenger e where e.beitrag_id = ${B.id} and e.ressort_id is not null), '{}')`,
      gruppeIds: sql<
        string[]
      >`coalesce((select array_agg(e.gruppe_id::text order by e.gruppe_id) from pinnwand_empfaenger e where e.beitrag_id = ${B.id} and e.gruppe_id is not null), '{}')`,
    })
    .from(pinnwandBeitrag)
    .leftJoin(user, eq(user.id, pinnwandBeitrag.erstelltVon))
    .where(
      and(
        eq(pinnwandBeitrag.lagerId, lagerId),
        p.id ? eq(pinnwandBeitrag.id, p.id) : undefined,
        lesbar(zugriff, p.alle),
        // Nach (angeheftet, Sortierzeit, ID) der letzten bekannten Zeile; ist sie unbekannt, bleibt die Seite leer
        p.nach
          ? sql`(${pinnwandBeitrag.angeheftet}, ${sortzeit}, ${B.id}) < (select b.angeheftet, coalesce(b.sichtbar_ab, b.erstellt_am), b.id from pinnwand_beitrag b where b.id = ${p.nach} and b.lager_id = ${lagerId})`
          : undefined,
      ),
    )
    .orderBy(desc(pinnwandBeitrag.angeheftet), desc(sortzeit), desc(B.id))
    .limit(p.limit + 1);
  const seite = zeilen.slice(0, p.limit);

  const dateien = new Map<string, ReturnType<typeof dateiAnsicht>[]>();
  if (seite.length > 0) {
    const links = await db
      .select({ beitragId: pinnwandDatei.beitragId, datei: lagerDatei })
      .from(pinnwandDatei)
      .innerJoin(lagerDatei, eq(lagerDatei.id, pinnwandDatei.dateiId))
      .where(
        and(
          eq(pinnwandDatei.lagerId, lagerId),
          inArray(
            pinnwandDatei.beitragId,
            seite.map((z) => z.zeile.id),
          ),
          eq(lagerDatei.lagerId, lagerId),
        ),
      )
      .orderBy(pinnwandDatei.reihenfolge, pinnwandDatei.id);
    for (const l of links) {
      dateien.set(l.beitragId, [
        ...(dateien.get(l.beitragId) ?? []),
        dateiAnsicht(l.datei),
      ]);
    }
  }

  // Umfragen und Reaktionen der ganzen Seite gebündelt (#382, lager/umfragen.ts), additiv zu den Feldern aus #381
  const ids = seite.map((z) => z.zeile.id);
  const gesehen = await ladeGesehen(db, zugriff, ids);
  const umfragen = await ladeUmfragen(db, zugriff, ids);
  const reaktionen = await ladeReaktionen(db, zugriff, "pinnwand_beitrag", ids);

  // Die Personen unter den Empfängern kennen nur, die den Beitrag verwalten
  const mitPersonen = kannAlleSehen(zugriff);
  return {
    beitraege: seite.map((z) => ({
      ...beitragAnsicht(z.zeile),
      von: z.zeile.erstelltVon && {
        id: z.zeile.erstelltVon,
        name: z.name,
        ceviName: z.ceviName,
      },
      empfaenger: {
        anAlle:
          z.rollen.length === 0 &&
          z.personen.length === 0 &&
          z.ressortIds.length === 0 &&
          z.gruppeIds.length === 0,
        rollen: z.rollen,
        personen: mitPersonen ? z.personen : [],
        // Ressorts und Gruppen wie die Personen nur für wen den Beitrag verwaltet
        ressortIds: mitPersonen ? z.ressortIds : [],
        gruppeIds: mitPersonen ? z.gruppeIds : [],
      },
      dateien: dateien.get(z.zeile.id) ?? [],
      gesehen: gesehen.get(z.zeile.id) ?? NIEMAND(zugriff),
      umfrage: umfragen.get(z.zeile.id) ?? null,
      reaktionen: reaktionen.get(z.zeile.id)!,
    })),
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.zeile.id : null,
  };
}

const NIEMAND = (zugriff: LagerZugriff) => ({
  anzahl: 0,
  eigene: false,
  personen: kannAlleSehen(zugriff) ? [] : null,
});

// «Gesehen» für die Beiträge einer Seite (#520): Anzahl und ob die Person selbst gesehen hat, eine Abfrage mit GROUP BY für die ganze Seite. Wer die Pinnwand verwalten darf (pinnwand.bearbeiten), bekommt dazu die Personen mit dem Anzeigenamen des Lagers (eine weitere Abfrage, nur wenn es Einträge gibt); alle anderen sehen nie Namen (personen: null)
async function ladeGesehen(db: Db, zugriff: LagerZugriff, ids: string[]) {
  const je = new Map<
    string,
    {
      anzahl: number;
      eigene: boolean;
      personen: { id: string; name: string }[] | null;
    }
  >();
  if (ids.length === 0) return je;
  const mitNamen = kannAlleSehen(zugriff);
  const zeilen = await db
    .select({
      beitragId: pinnwandGesehen.beitragId,
      anzahl: sql<number>`count(*)`.mapWith(Number),
      eigene: sql<boolean>`bool_or(${pinnwandGesehen.personId} = ${zugriff.personId}::uuid)`,
      personen: mitNamen
        ? sql<
            string[]
          >`array_agg(${pinnwandGesehen.personId}::text order by ${pinnwandGesehen.gesehenAm}, ${pinnwandGesehen.personId})`
        : sql<null>`null`,
    })
    .from(pinnwandGesehen)
    .where(
      and(
        eq(pinnwandGesehen.lagerId, zugriff.lager.id),
        inArray(pinnwandGesehen.beitragId, ids),
      ),
    )
    .groupBy(pinnwandGesehen.beitragId);
  const namen =
    mitNamen && zeilen.length > 0
      ? await anzeigeNamenLager(
          db,
          zugriff.lager.id,
          darf(zugriff, "teilnehmer.bearbeiten"),
        )
      : new Map<string, string>();
  for (const z of zeilen) {
    je.set(z.beitragId, {
      anzahl: z.anzahl,
      eigene: z.eigene,
      personen: z.personen
        ? z.personen.flatMap((id) => {
            const name = namen.get(id);
            return name ? [{ id, name }] : [];
          })
        : null,
    });
  }
  return je;
}

// Die Person hat diese Beiträge geöffnet (#520). Jeder muss für sie lesbar sein, sonst ändert sich nichts und die Antwort ist false (404). Zwei Abfragen für beliebig viele Beiträge: lesen prüfen, dann ein Insert ON CONFLICT DO NOTHING (doppeltes Melden ist ohne Wirkung)
export async function meldeGesehen(
  db: Pick<Db, "select" | "insert">,
  zugriff: LagerZugriff,
  beitragIds: string[],
) {
  const ids = [...new Set(beitragIds)];
  const lesbare = await db
    .select({ id: pinnwandBeitrag.id })
    .from(pinnwandBeitrag)
    .where(
      and(
        eq(pinnwandBeitrag.lagerId, zugriff.lager.id),
        inArray(pinnwandBeitrag.id, ids),
        lesbar(zugriff, true),
      ),
    );
  if (lesbare.length !== ids.length) return false;
  await db
    .insert(pinnwandGesehen)
    .values(
      ids.map((beitragId) => ({
        lagerId: zugriff.lager.id,
        beitragId,
        personId: zugriff.personId,
      })),
    )
    .onConflictDoNothing();
  return true;
}

// Der Beitrag, den die Person ändern oder löschen will: ohne Zeitfenster und Empfängerfilter (wer bearbeiten darf, sieht alle); fremdes Lager oder gelöscht = undefined
export async function ladeBeitragZeile(
  db: Db | Tx,
  lagerId: string,
  id: string,
) {
  const [zeile] = await db
    .select()
    .from(pinnwandBeitrag)
    .where(
      and(eq(pinnwandBeitrag.id, id), eq(pinnwandBeitrag.lagerId, lagerId)),
    );
  return zeile;
}

// Die Empfänger des Beitrags für die Entscheidung über den Push
export async function ladeEmpfaenger(tx: Tx, beitragId: string) {
  const zeilen = await tx
    .select({
      rolle: pinnwandEmpfaenger.rolle,
      personId: pinnwandEmpfaenger.personId,
      ressortId: pinnwandEmpfaenger.ressortId,
      gruppeId: pinnwandEmpfaenger.gruppeId,
    })
    .from(pinnwandEmpfaenger)
    .where(eq(pinnwandEmpfaenger.beitragId, beitragId));
  return {
    rollen: zeilen.flatMap((z) => (z.rolle ? [z.rolle] : [])),
    personen: zeilen.flatMap((z) => (z.personId ? [z.personId] : [])),
    ressortIds: zeilen.flatMap((z) => (z.ressortId ? [z.ressortId] : [])),
    gruppeIds: zeilen.flatMap((z) => (z.gruppeId ? [z.gruppeId] : [])),
  } satisfies EmpfaengerEingabe;
}

const FEHLER_TEXT = {
  KEIN_MITGLIED: "Empfänger müssen Mitglieder dieses Lagers sein.",
  RESSORT_UNBEKANNT: "Ein Ressort als Empfänger gibt es in diesem Lager nicht.",
  GRUPPE_UNBEKANNT: "Eine Gruppe als Empfänger gibt es in diesem Lager nicht.",
  DATEI_UNBEKANNT:
    "Eine Datei gibt es in diesem Lager nicht oder du darfst sie nicht einbinden.",
  ZEITFENSTER_UNGUELTIG: "«Sichtbar bis» muss nach «sichtbar ab» liegen.",
} as const;
// Antwort der Route (400) und Ablehnung der Operation mit demselben Code und Text
export const fehlerAntwort = (f: NonNullable<Pruefung>) => ({
  code: f.fehler,
  message: FEHLER_TEXT[f.fehler],
});

type Person = { id: string };
export type BeitragErgebnis =
  | NonNullable<Pruefung>
  | { id: string; version: number; zustellung?: Zustellung };

// Legt einen Beitrag an: Prüfungen, Zeile, Empfänger, Dateien und die Benachrichtigung bei «wichtig» in der Transaktion des Aufrufers. Den Push nach dem Commit (zustellung.senden) schickt der Aufrufer
export async function legeBeitragAn(
  tx: Tx,
  zugriff: LagerZugriff,
  person: Person,
  felder: z.output<typeof beitragAnlegen>,
): Promise<BeitragErgebnis> {
  const k = { lagerId: zugriff.lager.id, personId: person.id };
  if (!fensterGueltig(felder.sichtbarAb, felder.sichtbarBis)) {
    return { fehler: "ZEITFENSTER_UNGUELTIG" };
  }
  const fehler = await pruefeBeitragWerte(tx, zugriff, {
    personen: felder.empfaenger?.personen,
    ressortIds: felder.empfaenger?.ressortIds,
    gruppeIds: felder.empfaenger?.gruppeIds,
    dateiIds: felder.dateiIds,
  });
  if (fehler) return fehler;
  const empfaenger = felder.empfaenger ?? {
    rollen: [],
    personen: [],
    ressortIds: [],
    gruppeIds: [],
  };
  const neu = await legeZeileAn(tx, pinnwandBeitrag, k, {
    titel: felder.titel,
    text: felder.text,
    wichtig: felder.wichtig,
    angeheftet: felder.angeheftet,
    sichtbarAb: felder.sichtbarAb ?? null,
    sichtbarBis: felder.sichtbarBis ?? null,
  });
  await setzeEmpfaenger(tx, k.lagerId, neu.id, empfaenger);
  await setzeDateien(tx, k, neu.id, felder.dateiIds ?? []);
  const zustellung =
    neu.wichtig && istJetztSichtbar(neu.sichtbarAb, neu.sichtbarBis)
      ? await benachrichtigeUeberBeitrag(
          tx,
          k.lagerId,
          neu.id,
          empfaenger,
          person.id,
        )
      : undefined;
  return { id: neu.id, version: neu.version, zustellung };
}

export async function aendereBeitrag(
  tx: Tx,
  zugriff: LagerZugriff,
  person: Person,
  beitragId: string,
  eingabe: z.output<typeof beitragAendern>,
): Promise<BeitragErgebnis> {
  const { version, empfaenger, dateiIds, ...werte } = eingabe;
  const k = { lagerId: zugriff.lager.id, personId: person.id };
  const alt = await ladeBeitragZeile(tx, k.lagerId, beitragId);
  if (!alt) throw new HTTPException(404);
  const ab = werte.sichtbarAb === undefined ? alt.sichtbarAb : werte.sichtbarAb;
  const bis =
    werte.sichtbarBis === undefined ? alt.sichtbarBis : werte.sichtbarBis;
  if (!fensterGueltig(ab, bis)) return { fehler: "ZEITFENSTER_UNGUELTIG" };
  let schon: Set<string> | undefined;
  if (dateiIds) {
    const bestehend = await tx
      .select({ id: pinnwandDatei.dateiId })
      .from(pinnwandDatei)
      .where(and(eq(pinnwandDatei.beitragId, beitragId)));
    schon = new Set(bestehend.map((z) => z.id));
  }
  const fehler = await pruefeBeitragWerte(tx, zugriff, {
    personen: empfaenger?.personen,
    ressortIds: empfaenger?.ressortIds,
    gruppeIds: empfaenger?.gruppeIds,
    dateiIds,
    schonEingebunden: schon,
  });
  if (fehler) return fehler;
  // Zuerst der Beitrag: Er prüft die Version (409) und sperrt das Lager, bevor Empfänger und Dateien sich ändern. Eine Änderung nur an Empfängern oder Dateien zählt die Version trotzdem hoch
  const neu = await aendereZeile(tx, pinnwandBeitrag, k, {
    id: beitragId,
    version,
    werte,
    ansicht: beitragAnsicht,
  });
  if (empfaenger) await setzeEmpfaenger(tx, k.lagerId, beitragId, empfaenger);
  if (dateiIds) await setzeDateien(tx, k, beitragId, dateiIds);
  // Push, wenn der Beitrag jetzt wichtig und sichtbar ist und es vorher nicht war (keine Wiederholung bei jeder Änderung)
  const zustellung =
    !alt.wichtig &&
    neu.wichtig &&
    istJetztSichtbar(neu.sichtbarAb, neu.sichtbarBis)
      ? await benachrichtigeUeberBeitrag(
          tx,
          k.lagerId,
          beitragId,
          empfaenger ?? (await ladeEmpfaenger(tx, beitragId)),
          person.id,
        )
      : undefined;
  return { id: beitragId, version: neu.version, zustellung };
}

// Endgültig, über den Sync-Kern (#427)
export async function loescheBeitrag(
  tx: Tx,
  k: SchreibKontext,
  id: string,
  version: number,
) {
  if (!(await ladeBeitragZeile(tx, k.lagerId, id))) {
    throw new HTTPException(404);
  }
  await loescheZeile(tx, pinnwandBeitrag, k, {
    id,
    version,
    ansicht: beitragAnsicht,
  });
}

// Operationen der Warteschlange (#367, #521): dieselben Schreibwege wie die Routen, mit demselben Recht. Den Push einer wichtigen Mitteilung kennt die Warteschlange noch nicht (lager/operationen.ts hat dafür keinen Haken); die Zeilen der Glocke entstehen
const FEHLER_BEITRAG = [
  "KEIN_MITGLIED",
  "RESSORT_UNBEKANNT",
  "GRUPPE_UNBEKANNT",
  "DATEI_UNBEKANNT",
  "ZEITFENSTER_UNGUELTIG",
];
const schreibeBeitrag = (e: BeitragErgebnis) => {
  if ("fehler" in e) {
    const { code, message } = fehlerAntwort(e);
    throw lehneAb(code, message);
  }
  return { id: e.id, version: e.version };
};
registriereOperation({
  typ: "pinnwand.anlegen",
  recht: "pinnwand.bearbeiten",
  fehler: FEHLER_BEITRAG,
  schema: beitragAnlegen,
  fuehreAus: async ({ tx, zugriff, person }, n) =>
    schreibeBeitrag(await legeBeitragAn(tx, zugriff, person, n)),
});
registriereOperation({
  typ: "pinnwand.aendern",
  recht: "pinnwand.bearbeiten",
  fehler: FEHLER_BEITRAG,
  schema: z
    .strictObject({ id: z.uuid(), ...beitragAendern.shape })
    .refine((b) => Object.keys(b).length > 2),
  fuehreAus: async ({ tx, zugriff, person }, { id, ...n }) =>
    schreibeBeitrag(await aendereBeitrag(tx, zugriff, person, id, n)),
});
registriereOperation({
  typ: "pinnwand.loeschen",
  recht: "pinnwand.bearbeiten",
  schema: z.strictObject({ id: z.uuid(), version: z.number().int().min(1) }),
  fuehreAus: async ({ tx, zugriff, person }, n) => {
    await loescheBeitrag(
      tx,
      { lagerId: zugriff.lager.id, personId: person.id },
      n.id,
      n.version,
    );
    return { id: n.id };
  },
});

// Gesehen melden (#520) über die Warteschlange: dieselbe Funktion wie die Route. Ein nicht lesbarer Beitrag ist 404 (abgelehnt), ohne etwas zu melden. Ein abgeschlossenes Lager nimmt die Warteschlange nicht an; die Route erlaubt es
registriereOperation({
  typ: "pinnwand.gesehen",
  recht: "pinnwand.lesen",
  schema: z.strictObject({
    beitragIds: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine((l) => new Set(l).size === l.length),
  }),
  fuehreAus: async ({ tx, zugriff }, n) => {
    if (!(await meldeGesehen(tx, zugriff, n.beitragIds))) {
      throw new HTTPException(404);
    }
    return {};
  },
});
