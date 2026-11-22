import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  lagerMitglied,
  ressort,
  ressortLink,
  ressortNotiz,
} from "../db/schema.js";
import { LINK_MAX, pruefeLink } from "../link-pruefung.js";
import { registriereOperation } from "./operationen.js";
import { aendereZeile, legeZeileAn, loescheZeile, type Tx } from "./sync.js";
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

// Links von Ressorts, Aufgaben und Höcks gehen durch die strenge Prüfung von Dokumenten und Protokollen (link-pruefung.ts, #428): nur https, keine Zugangsdaten, kein Port, kein IP-Literal, keine Steuer- oder Trennzeichen. Der Server ruft die Adresse nie ab (SR-26); gespeichert wird die Schreibweise der URL-Norm. Keine Einschränkung auf die Hosts der Abteilung: Hier stehen auch Fahrplan- oder Kartenlinks, nicht nur Dateien
export const httpsAdresse = z
  .string()
  .trim()
  .max(LINK_MAX)
  .refine((wert) => pruefeLink(wert).ok)
  .transform((wert) => {
    const e = pruefeLink(wert);
    return e.ok ? e.link : wert;
  })
  // Die Tabellen der Links halten höchstens 2000 Zeichen fest (ressort_link_check, aufgabe_link_check)
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
          where id = ${werte.parentId} and lager_id = ${lagerId}
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
    .where(and(eq(ressort.id, id), eq(ressort.lagerId, lagerId)));
  return zeile;
}

// Das Ressort im Lager gibt es nicht (mehr): 404, auch für ein Ressort eines fremden Lagers
export async function ressortDa(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  const zeile = await ladeRessortZeile(tx, lagerId, id);
  if (!zeile) throw new HTTPException(404);
  return zeile;
}

// Die Notiz gehört zu diesem Ressort in diesem Lager, sonst 404: Eine ID aus der Anfrage ist nie ein Nachweis (SR-11)
async function notizDa(
  tx: Pick<Db, "select">,
  lagerId: string,
  ressortId: string,
  id: string,
) {
  const [zeile] = await tx
    .select({ id: ressortNotiz.id })
    .from(ressortNotiz)
    .where(
      and(
        eq(ressortNotiz.id, id),
        eq(ressortNotiz.lagerId, lagerId),
        eq(ressortNotiz.ressortId, ressortId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
}

type Akteur = { lagerId: string; personId: string };

export async function legeNotizAn(
  tx: Tx,
  k: Akteur,
  ressortId: string,
  eingabe: z.output<typeof notizAnlegen>,
) {
  await sperreLager(tx, k.lagerId);
  await ressortDa(tx, k.lagerId, ressortId);
  return legeZeileAn(tx, ressortNotiz, k, { ressortId, ...eingabe });
}

export async function aendereNotiz(
  tx: Tx,
  k: Akteur,
  ressortId: string,
  notizId: string,
  eingabe: z.output<typeof notizAendern>,
) {
  const { version: erwartet, ...werte } = eingabe;
  await sperreLager(tx, k.lagerId);
  await notizDa(tx, k.lagerId, ressortId, notizId);
  return aendereZeile(tx, ressortNotiz, k, {
    id: notizId,
    version: erwartet,
    werte,
    ansicht: notizAnsicht,
  });
}

export async function loescheNotiz(
  tx: Tx,
  k: Akteur,
  ressortId: string,
  notizId: string,
  erwartet: number,
) {
  await sperreLager(tx, k.lagerId);
  await notizDa(tx, k.lagerId, ressortId, notizId);
  await loescheZeile(tx, ressortNotiz, k, {
    id: notizId,
    version: erwartet,
    ansicht: notizAnsicht,
  });
}

// Die Stelle in der Liste ist die neue Reihenfolge; was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag). Alles oder nichts: Ein Eintrag, der nicht in diesem Lager steht, ist 404
export async function ordneRessorts(
  tx: Tx,
  k: Akteur,
  eintraege: z.output<typeof reihenfolgeSetzen>["eintraege"],
) {
  await sperreLager(tx, k.lagerId);
  const vorhanden = await tx
    .select()
    .from(ressort)
    .where(and(eq(ressort.lagerId, k.lagerId)));
  const nachId = new Map(vorhanden.map((z) => [z.id, z]));
  if (eintraege.some((e) => !nachId.has(e.id))) throw new HTTPException(404);
  for (const [stelle, e] of eintraege.entries()) {
    if (nachId.get(e.id)!.reihenfolge === stelle) continue;
    await aendereZeile(tx, ressort, k, {
      id: e.id,
      version: e.version,
      werte: { reihenfolge: stelle },
      ansicht: ressortAnsicht,
    });
  }
}

// Operationen der Warteschlange (#367, #521): dieselben Schreibwege wie die Routen, mit demselben Recht
const akteur = (z: {
  zugriff: { lager: { id: string } };
  person: { id: string };
}) => ({ lagerId: z.zugriff.lager.id, personId: z.person.id });
registriereOperation({
  typ: "ressort_notiz.anlegen",
  recht: "ressorts.bearbeiten",
  schema: z.strictObject({ ressortId: z.uuid(), ...notizAnlegen.shape }),
  fuehreAus: async (kontext, { ressortId, ...n }) => {
    const neu = await legeNotizAn(kontext.tx, akteur(kontext), ressortId, n);
    return { id: neu.id, version: neu.version };
  },
});
registriereOperation({
  typ: "ressort_notiz.aendern",
  recht: "ressorts.bearbeiten",
  schema: z.strictObject({
    ressortId: z.uuid(),
    id: z.uuid(),
    ...notizAendern.shape,
  }),
  fuehreAus: async (kontext, { ressortId, id, ...n }) => {
    const neu = await aendereNotiz(
      kontext.tx,
      akteur(kontext),
      ressortId,
      id,
      n,
    );
    return { id: neu.id, version: neu.version };
  },
});
registriereOperation({
  typ: "ressort_notiz.loeschen",
  recht: "ressorts.bearbeiten",
  schema: z.strictObject({ ressortId: z.uuid(), id: z.uuid(), version }),
  fuehreAus: async (kontext, n) => {
    await loescheNotiz(
      kontext.tx,
      akteur(kontext),
      n.ressortId,
      n.id,
      n.version,
    );
    return { id: n.id };
  },
});
registriereOperation({
  typ: "ressort.reihenfolge",
  recht: "ressorts.bearbeiten",
  schema: reihenfolgeSetzen,
  fuehreAus: async (kontext, n) => {
    await ordneRessorts(kontext.tx, akteur(kontext), n.eintraege);
    return {};
  },
});
