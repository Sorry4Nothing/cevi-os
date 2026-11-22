import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  lagerDatei,
  lagerMitglied,
  pinnwandBeitrag,
  pinnwandDatei,
  pinnwandEmpfaenger,
  user,
} from "../db/schema.js";
import { dateiAnsicht, ladeSichtbareDatei } from "./datei.js";
import { registriereDateiVerweis } from "./datei-verweise.js";
import { benachrichtige } from "./benachrichtigung.js";
import { darf, type LagerZugriff } from "./policy.js";
import { ladeRollenRechte } from "./rechte.js";
import {
  aendereZeile,
  legeZeileAn,
  loescheZeile,
  type SchreibKontext,
  type Tx,
} from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

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
const empfaengerPasst = (z: Pick<LagerZugriff, "rolle" | "personId">) =>
  sql`coalesce((select bool_or(coalesce(e.rolle = ${z.rolle}, false) or coalesce(e.person_id = ${z.personId}::uuid, false)) from pinnwand_empfaenger e where e.beitrag_id = ${B.id}), true)`;

// Welche nicht gelöschten Beiträge die Person sieht. alle: ohne Zeitfenster (nur wer bearbeiten darf)
function lesbar(zugriff: LagerZugriff, alle = false) {
  if (kannAlleSehen(zugriff)) return alle ? undefined : IM_FENSTER;
  return and(IM_FENSTER, empfaengerPasst(zugriff));
}

// Für den Eingang (#383) und alle, die einen Beitrag von Dritten aufrufen lassen: darf die Person ihn lesen?
export async function beitragLesbar(db: Db, zugriff: LagerZugriff, id: string) {
  const [zeile] = await db
    .select({ id: pinnwandBeitrag.id })
    .from(pinnwandBeitrag)
    .where(
      and(
        eq(pinnwandBeitrag.id, id),
        eq(pinnwandBeitrag.lagerId, zugriff.lager.id),
        isNull(pinnwandBeitrag.geloeschtAm),
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
          kannAlleSehen(zugriff)
            ? undefined
            : or(
                isNotNull(pinnwandBeitrag.geloeschtAm),
                empfaengerPasst(zugriff),
              ),
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
          isNull(pinnwandDatei.geloeschtAm),
          isNull(pinnwandBeitrag.geloeschtAm),
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
});
export type EmpfaengerEingabe = z.infer<typeof empfaengerSchema>;
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
  | { fehler: "KEIN_MITGLIED" | "DATEI_UNBEKANNT" | "ZEITFENSTER_UNGUELTIG" }
  | undefined;

export const fensterGueltig = (ab?: Date | null, bis?: Date | null) =>
  !ab || !bis || bis > ab;

// Personen als Empfänger müssen Mitglieder dieses Lagers sein, Dateien im Lager liegen und für die Person sichtbar sein (sie bindet nichts ein, was sie nicht sieht); bereits eingebundene Dateien bleiben unberührt
export async function pruefeBeitragWerte(
  db: Db,
  zugriff: LagerZugriff,
  w: {
    personen?: string[];
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
  for (const id of w.dateiIds ?? []) {
    if (w.schonEingebunden?.has(id)) continue;
    if (!(await ladeSichtbareDatei(db, zugriff, zugriff.personId, id))) {
      return { fehler: "DATEI_UNBEKANNT" };
    }
  }
  return undefined;
}

// Ersetzt die Empfänger des Beitrags (Löschen und Einfügen in der Transaktion; es sind höchstens 103 Zeilen)
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
        isNull(pinnwandDatei.geloeschtAm),
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
    .select({ id: lagerMitglied.personId, rolle: lagerMitglied.rolle })
    .from(lagerMitglied)
    .where(eq(lagerMitglied.lagerId, lagerId));
  const anAlle = e.rollen.length === 0 && e.personen.length === 0;
  const passend = mitglieder.filter(
    (m) =>
      anAlle ||
      (m.rolle !== "lagerleitung" && e.rollen.includes(m.rolle)) ||
      e.personen.includes(m.id),
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
    })
    .from(pinnwandBeitrag)
    .leftJoin(user, eq(user.id, pinnwandBeitrag.erstelltVon))
    .where(
      and(
        eq(pinnwandBeitrag.lagerId, lagerId),
        isNull(pinnwandBeitrag.geloeschtAm),
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
          isNull(pinnwandDatei.geloeschtAm),
          isNull(lagerDatei.geloeschtAm),
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
        anAlle: z.rollen.length === 0 && z.personen.length === 0,
        rollen: z.rollen,
        personen: mitPersonen ? z.personen : [],
      },
      dateien: dateien.get(z.zeile.id) ?? [],
    })),
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.zeile.id : null,
  };
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
      and(
        eq(pinnwandBeitrag.id, id),
        eq(pinnwandBeitrag.lagerId, lagerId),
        isNull(pinnwandBeitrag.geloeschtAm),
      ),
    );
  return zeile;
}

// Die Empfänger des Beitrags für die Entscheidung über den Push
export async function ladeEmpfaenger(tx: Tx, beitragId: string) {
  const zeilen = await tx
    .select({
      rolle: pinnwandEmpfaenger.rolle,
      personId: pinnwandEmpfaenger.personId,
    })
    .from(pinnwandEmpfaenger)
    .where(eq(pinnwandEmpfaenger.beitragId, beitragId));
  return {
    rollen: zeilen.flatMap((z) => (z.rolle ? [z.rolle] : [])),
    personen: zeilen.flatMap((z) => (z.personId ? [z.personId] : [])),
  } satisfies EmpfaengerEingabe;
}
