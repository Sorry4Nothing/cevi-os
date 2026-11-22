import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  lagerMitglied,
  ressort,
  ressortLink,
  ressortNotiz,
} from "../db/schema.js";
import type { Tx } from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Ressorts des Lagers (#371): Ansichten, Eingabeschemas und die Prüfungen, die in der Schreib-Transaktion laufen. Die Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit ressorts.lesen); einen Zeilenfilter gibt es nicht, jede Rolle mit dem Recht liest alle Ressorts.
for (const tabelle of [ressort, ressortLink, ressortNotiz]) {
  registriereLagerTabelle({ tabelle, recht: "ressorts.lesen" });
}

// Suche (#399): Kürzel, Name und Notiz des Ressorts; der Text einer Ressort-Notiz findet das Ressort. Links werden nicht durchsucht
registriereSuchquelle({
  typ: "ressort",
  recht: "ressorts.lesen",
  tabelle: ressort,
  spalten: [ressort.name, ressort.kuerzel, ressort.notiz],
  titel: sql`${ressort.name}`,
});
registriereSuchquelle({
  typ: "ressort",
  recht: "ressorts.lesen",
  tabelle: ressortNotiz,
  spalten: [ressortNotiz.text],
  titel: sql`${ressort.name}`,
  von: sql`${ressortNotiz} join ${ressort} on ${ressort.lagerId} = ${ressortNotiz.lagerId} and ${ressort.id} = ${ressortNotiz.ressortId}`,
  id: sql`${ressort.id}`,
  aktiv: sql`${ressortNotiz.geloeschtAm} is null and ${ressort.geloeschtAm} is null`,
});

// Ansichten für die Antwort und die Konfliktantwort des Sync-Kerns: nur die Spalten der Route, nie die ganze Zeile. Personen nur als ID, die Namen löst die Route beim Lesen auf
export const ressortAnsicht = (r: typeof ressort.$inferSelect) => ({
  id: r.id,
  version: r.version,
  kuerzel: r.kuerzel,
  name: r.name,
  leitungPersonId: r.leitungPersonId,
  stvPersonId: r.stvPersonId,
  notiz: r.notiz,
  parentId: r.parentId,
  reihenfolge: r.reihenfolge,
});
export const linkAnsicht = (r: typeof ressortLink.$inferSelect) => ({
  id: r.id,
  version: r.version,
  ressortId: r.ressortId,
  titel: r.titel,
  url: r.url,
});
export const notizAnsicht = (r: typeof ressortNotiz.$inferSelect) => ({
  id: r.id,
  version: r.version,
  ressortId: r.ressortId,
  text: r.text,
  vonPersonId: r.erstelltVon,
  erstelltAm: r.erstelltAm,
});

// Eingaben: strikt, nur die genannten Felder (SR-72)
const kuerzel = z.string().trim().min(1).max(20);
const name = z.string().trim().min(1).max(100);
const person = z.uuid().nullable();
const notiz = z.string().trim().max(5000).nullable();
const version = z.number().int().min(1);

export const ressortAnlegen = z.strictObject({
  kuerzel,
  name,
  leitungPersonId: person.optional(),
  stvPersonId: person.optional(),
  notiz: notiz.optional(),
  parentId: z.uuid().nullable().optional(),
  reihenfolge: z.number().int().min(0).max(100000).optional(),
});
export const ressortAendern = z
  .strictObject({
    version,
    kuerzel: kuerzel.optional(),
    name: name.optional(),
    leitungPersonId: person.optional(),
    stvPersonId: person.optional(),
    notiz: notiz.optional(),
    parentId: z.uuid().nullable().optional(),
    reihenfolge: z.number().int().min(0).max(100000).optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const reihenfolgeSetzen = z.strictObject({
  eintraege: z
    .array(z.strictObject({ id: z.uuid(), version }))
    .min(1)
    .max(200)
    .refine((l) => new Set(l.map((e) => e.id)).size === l.length),
});

// Nur https, ohne Zugangsdaten in der Adresse. Der Server ruft die Adresse nie ab (SR-26); gespeichert wird die normalisierte Form (kleingeschriebenes Schema und Host)
export const httpsAdresse = z
  .string()
  .trim()
  .max(2000)
  .refine((wert) => {
    try {
      const u = new URL(wert);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  })
  .transform((wert) => new URL(wert).href)
  .refine((wert) => wert.length <= 2000);
const linkTitel = z.string().trim().min(1).max(200);
export const linkAnlegen = z.strictObject({
  titel: linkTitel,
  url: httpsAdresse,
});
export const linkAendern = z
  .strictObject({
    version,
    titel: linkTitel.optional(),
    url: httpsAdresse.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const notizAnlegen = z.strictObject({
  text: z.string().trim().min(1).max(10000),
});
export const notizAendern = z.strictObject({
  version,
  text: z.string().trim().min(1).max(10000),
});
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// Die Schreib-Transaktion eines Ressorts sperrt das Lager (dieselbe Zeile, die der Sync-Kern für die Folgenummer sperrt): So sehen die Prüfungen unten den Stand, den die Schreiber vor ihnen hinterlassen haben, und zwei gleichzeitige Verschiebungen bauen keinen Zyklus
export const sperreLager = (tx: Tx, lagerId: string) =>
  tx.execute(sql`select id from lager where id = ${lagerId} for update`);

export type Pruefung =
  | { fehler: "KEIN_MITGLIED" | "RESSORT_UNBEKANNT" | "RESSORT_ZYKLUS" }
  | undefined;

// Leitung und Stellvertretung sind Mitglieder dieses Lagers; das Ressort-Elternteil gibt es in diesem Lager und der Baum bleibt ohne Zyklus (id: das Ressort, das verschoben wird, bei einem neuen Ressort leer)
export async function pruefeRessortWerte(
  tx: Tx,
  lagerId: string,
  werte: {
    leitungPersonId?: string | null;
    stvPersonId?: string | null;
    parentId?: string | null;
  },
  id?: string,
): Promise<Pruefung> {
  const personen = [
    ...new Set([werte.leitungPersonId, werte.stvPersonId]),
  ].filter((p): p is string => typeof p === "string");
  if (personen.length > 0) {
    const gefunden = await tx
      .select({ id: lagerMitglied.personId })
      .from(lagerMitglied)
      .where(
        and(
          eq(lagerMitglied.lagerId, lagerId),
          inArray(lagerMitglied.personId, personen),
        ),
      );
    if (gefunden.length !== personen.length) return { fehler: "KEIN_MITGLIED" };
  }
  if (typeof werte.parentId === "string") {
    // Der Elternteil und seine Vorfahren (UNION statt UNION ALL: bricht auch bei einem unerwarteten Kreis ab)
    const [r] = await tx.execute<{ vorhanden: boolean; zyklus: boolean }>(sql`
      with recursive oben as (
        select id, parent_id from ressort
          where id = ${werte.parentId} and lager_id = ${lagerId} and geloescht_am is null
        union
        select r.id, r.parent_id from ressort r join oben o on r.id = o.parent_id
          where r.lager_id = ${lagerId}
      )
      select
        exists (select 1 from oben where id = ${werte.parentId}) as vorhanden,
        ${id ?? null}::uuid is not null and exists (select 1 from oben where id = ${id ?? null}::uuid) as zyklus`);
    if (!r?.vorhanden) return { fehler: "RESSORT_UNBEKANNT" };
    if (r.zyklus) return { fehler: "RESSORT_ZYKLUS" };
  }
  return undefined;
}

export async function ladeRessortZeile(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(ressort)
    .where(
      and(
        eq(ressort.id, id),
        eq(ressort.lagerId, lagerId),
        isNull(ressort.geloeschtAm),
      ),
    );
  return zeile;
}
