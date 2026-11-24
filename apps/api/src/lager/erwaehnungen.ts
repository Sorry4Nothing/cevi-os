import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  aufgabe,
  aufgabeCheckpunkt,
  aufgabeLink,
  aufgabeStichwort,
  aufgabeUnterstuetzung,
  beschluss,
  erwaehnung,
  lagerMitglied,
  pinnwandBeitrag,
  traktandum,
  user,
  type ErwaehnungQuelle,
} from "../db/schema.js";
import { ladeAufgabeZeile, legeAufgabeAn, loescheAufgabe } from "./aufgaben.js";
import { benachrichtige, type Zustellung } from "./benachrichtigung.js";
import { darfTabelleLesen, type LagerZugriff } from "./policy.js";
import { ladeRollenRechte, type EinstellbareRolle } from "./rechte.js";
import type { LagerRecht } from "./rechte-katalog.js";
import { sperreLager } from "./ressorts.js";
import { LagerAntwortFehler, type Tx } from "./sync.js";
import { holeLagerTabelle } from "./tabellen.js";
// Die Tabellen von Höck, Pinnwand und Protokoll melden sich beim Laden ihres Moduls im Register an; die Sichtbarkeit lesen wir von dort
import "./hoecks.js";
import "./pinnwand.js";
import "./protokolle.js";

// Erwähnungen im Lager (#380). Ein Inhalt von Cevi OS (Aufgabe, Traktandum, Pinnwand-Beitrag, Beschluss) nennt eine Person mit der Marke «@{person:<id>}», die die App beim Auswählen einfügt. Der Server liest nur diese Marken und rät nie einen Namen. Protokolle liegen im SharePoint (#379): Ihren Text kennt Cevi OS nicht, sie haben keine Erwähnungen.
//
// Abgleich (gleicheErwaehnungenAb, PUT .../erwaehnungen/{typ}/{id}): Die App ruft ihn nach dem Speichern eines Inhalts mit Marken. Neue Marken legen eine Erwähnung an und benachrichtigen die Person genau einmal (Art «erwaehnung», fester Text, nie der Inhalt); eine Marke, die schon eine Erwähnung hat, tut nichts; entfällt eine Marke, geht ihre Erwähnung weg, ausser es ist daraus schon eine Aufgabe entstanden. Eine neue Marke gilt nur für ein Mitglied des Lagers, das den Inhalt selbst sehen darf (Recht und Zeilenfilter der Tabelle im Register von tabellen.ts, mit den Rechten der erwähnten Person); sonst wird der Abgleich abgelehnt. Eine bestehende Erwähnung wird nicht noch einmal geprüft: Ein später entferntes Mitglied nimmt seine Erwähnungen mit (Fremdschlüssel), eine geänderte Rolle ändert nur, was die Liste der Person noch zeigt.
// «Als Aufgabe» (alsAufgabe): Die erwähnte Person legt aus der Erwähnung eine Aufgabe für sich an (lager/aufgaben.ts, Titel des Inhalts, quelle «erwaehnung:<id>»). Genau eine je Erwähnung, auch bei doppelter Anfrage.

export const MAX_MARKEN = 10;

const MARKE =
  /@\{person:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}/gi;

// Die Personen-IDs der Marken, ohne Wiederholung, klein geschrieben
export function markenVon(texte: readonly (string | null)[]) {
  const ids = new Set<string>();
  for (const text of texte) {
    if (!text) continue;
    for (const m of text.matchAll(MARKE)) ids.add(m[1]!.toLowerCase());
  }
  return [...ids];
}

type Quelle = { id: string; titel: string; texte: (string | null)[] };
type Lader = (
  d: Pick<Db, "select">,
  lagerId: string,
  ids: string[],
) => Promise<Quelle[]>;

// Beschlüsse haben keinen Titel: die erste Zeile
const ersteZeile = (text: string) =>
  text.split(/\r?\n/)[0]!.trim().slice(0, 200) || "Beschluss";

// Je Inhalt: die Tabelle im Register, das Recht, das Marken setzen darf (wer den Inhalt schreibt), und der Lader (nicht gelöschte Zeilen des Lagers, Titel und die Texte mit Marken)
const QUELLEN: Record<
  ErwaehnungQuelle,
  { tabelle: string; schreiben: LagerRecht; laden: Lader }
> = {
  aufgabe: {
    tabelle: "aufgabe",
    schreiben: "aufgaben.bearbeiten",
    laden: async (d, lagerId, ids) =>
      (
        await d
          .select({
            id: aufgabe.id,
            titel: aufgabe.titel,
            notiz: aufgabe.notiz,
          })
          .from(aufgabe)
          .where(and(eq(aufgabe.lagerId, lagerId), inArray(aufgabe.id, ids)))
      ).map((z) => ({ id: z.id, titel: z.titel, texte: [z.titel, z.notiz] })),
  },
  traktandum: {
    tabelle: "traktandum",
    schreiben: "hoecks.bearbeiten",
    laden: async (d, lagerId, ids) =>
      (
        await d
          .select({
            id: traktandum.id,
            titel: traktandum.titel,
            text: traktandum.text,
            entscheid: traktandum.entscheid,
          })
          .from(traktandum)
          .where(
            and(eq(traktandum.lagerId, lagerId), inArray(traktandum.id, ids)),
          )
      ).map((z) => ({
        id: z.id,
        titel: z.titel,
        texte: [z.titel, z.text, z.entscheid],
      })),
  },
  pinnwand: {
    tabelle: "pinnwand_beitrag",
    schreiben: "pinnwand.bearbeiten",
    laden: async (d, lagerId, ids) =>
      (
        await d
          .select({
            id: pinnwandBeitrag.id,
            titel: pinnwandBeitrag.titel,
            text: pinnwandBeitrag.text,
          })
          .from(pinnwandBeitrag)
          .where(
            and(
              eq(pinnwandBeitrag.lagerId, lagerId),
              inArray(pinnwandBeitrag.id, ids),
            ),
          )
      ).map((z) => ({ id: z.id, titel: z.titel, texte: [z.titel, z.text] })),
  },
  beschluss: {
    tabelle: "beschluss",
    schreiben: "protokolle.bearbeiten",
    laden: async (d, lagerId, ids) =>
      (
        await d
          .select({ id: beschluss.id, text: beschluss.text })
          .from(beschluss)
          .where(
            and(eq(beschluss.lagerId, lagerId), inArray(beschluss.id, ids)),
          )
      ).map((z) => ({ id: z.id, titel: ersteZeile(z.text), texte: [z.text] })),
  },
};

export const schreibRecht = (typ: ErwaehnungQuelle) => QUELLEN[typ].schreiben;
export const SCHREIB_RECHTE = Object.values(QUELLEN).map((q) => q.schreiben);

// Die Sichtbarkeitsregeln des Ziels, wie der Feed sie anwendet: Leserecht der Tabelle und Zeilenfilter der Rolle
async function sichtbareIds(
  db: Db,
  zugriff: LagerZugriff,
  typ: ErwaehnungQuelle,
  ids: string[],
) {
  const eintrag = holeLagerTabelle(QUELLEN[typ].tabelle);
  if (
    !eintrag ||
    ids.length === 0 ||
    !darfTabelleLesen(zugriff, eintrag.recht)
  ) {
    return new Set<string>();
  }
  return eintrag.sichtbar ? eintrag.sichtbar(db, zugriff, ids) : new Set(ids);
}

// Die Sichtbarkeitsfunktionen lesen nur; eine Transaktion kann sie ohne Umweg bedienen
const alsDb = (tx: Tx) => tx as unknown as Db;

export type AbgleichFehler = "ERWAEHNUNG_UNGUELTIG" | "ZU_VIELE_MARKEN";
export type AbgleichErgebnis =
  | { fehler: AbgleichFehler }
  | { personIds: string[]; neu: number; zustellung: Zustellung };

// Neue Marken: Jede Person ist aktives Mitglied des Lagers (Abteilung des Lagers, nicht gesperrt) und darf den Inhalt mit ihren Rechten sehen. Mitglieder in einer Abfrage, Rechte je Rolle in einer Abfrage (höchstens drei), der Zeilenfilter je Person nur dort, wo das Ziel einen hat
async function pruefeNeue(
  tx: Tx,
  zugriff: LagerZugriff,
  typ: ErwaehnungQuelle,
  quelleId: string,
  personIds: string[],
) {
  const lagerId = zugriff.lager.id;
  const mitglieder = await tx
    .select({
      personId: lagerMitglied.personId,
      rolle: lagerMitglied.rolle,
      konto: user.role,
    })
    .from(lagerMitglied)
    .innerJoin(
      user,
      and(
        eq(user.id, lagerMitglied.personId),
        eq(user.abteilungId, zugriff.lager.abteilungId),
      ),
    )
    .where(
      and(
        eq(lagerMitglied.lagerId, lagerId),
        inArray(lagerMitglied.personId, personIds),
        isNull(user.deaktiviertAm),
        sql`coalesce(${user.banned}, false) = false`,
      ),
    );
  if (mitglieder.length !== personIds.length) return false;

  const rechteJeRolle = new Map<string, ReadonlyMap<string, boolean>>();
  for (const m of mitglieder) {
    const rolle = m.konto === "admin" ? "lagerleitung" : m.rolle;
    let rechte: ReadonlyMap<string, boolean> = new Map();
    if (rolle !== "lagerleitung") {
      if (!rechteJeRolle.has(rolle)) {
        rechteJeRolle.set(
          rolle,
          await ladeRollenRechte(tx, lagerId, rolle as EinstellbareRolle),
        );
      }
      rechte = rechteJeRolle.get(rolle)!;
    }
    const sieht = await sichtbareIds(
      alsDb(tx),
      {
        personId: m.personId,
        lager: zugriff.lager,
        rolle: rolle as LagerZugriff["rolle"],
        mitglied: true,
        geschlossen: zugriff.geschlossen,
        rechte,
      },
      typ,
      [quelleId],
    );
    if (!sieht.has(quelleId)) return false;
  }
  return true;
}

// Gleicht die Erwähnungen eines Inhalts mit seinen Marken ab. In der Transaktion des Aufrufers; nach dem Commit zustellung.senden. zugriff ist der der anfragenden Person: Sie muss den Inhalt sehen (sonst 404) und ihn schreiben dürfen (prüft die Route)
export async function gleicheErwaehnungenAb(
  tx: Tx,
  zugriff: LagerZugriff,
  typ: ErwaehnungQuelle,
  quelleId: string,
): Promise<AbgleichErgebnis> {
  const lagerId = zugriff.lager.id;
  // Die Sperre des Lagers macht den Abgleich zweier gleichzeitiger Anfragen zu einer Reihe: Die zweite sieht die Erwähnungen der ersten und benachrichtigt niemanden noch einmal
  await sperreLager(tx, lagerId);
  const [quelle] = await QUELLEN[typ].laden(tx, lagerId, [quelleId]);
  if (
    !quelle ||
    !(await sichtbareIds(alsDb(tx), zugriff, typ, [quelleId])).has(quelleId)
  ) {
    throw new HTTPException(404);
  }
  const marken = markenVon(quelle.texte);
  if (marken.length > MAX_MARKEN) return { fehler: "ZU_VIELE_MARKEN" };

  const vorhanden = await tx
    .select({
      id: erwaehnung.id,
      personId: erwaehnung.personId,
      aufgabeId: erwaehnung.aufgabeId,
    })
    .from(erwaehnung)
    .where(
      and(
        eq(erwaehnung.lagerId, lagerId),
        eq(erwaehnung.quelleTyp, typ),
        eq(erwaehnung.quelleId, quelleId),
      ),
    );
  const bekannt = new Set(vorhanden.map((v) => v.personId));
  const neue = marken.filter((id) => !bekannt.has(id));
  if (
    neue.length > 0 &&
    !(await pruefeNeue(tx, zugriff, typ, quelleId, neue))
  ) {
    return { fehler: "ERWAEHNUNG_UNGUELTIG" };
  }

  const weg = vorhanden.filter(
    (v) => !marken.includes(v.personId) && !v.aufgabeId,
  );
  if (weg.length > 0) {
    await tx.delete(erwaehnung).where(
      inArray(
        erwaehnung.id,
        weg.map((v) => v.id),
      ),
    );
  }
  const eingefuegt =
    neue.length === 0
      ? []
      : await tx
          .insert(erwaehnung)
          .values(
            neue.map((personId) => ({
              lagerId,
              quelleTyp: typ,
              quelleId,
              personId,
            })),
          )
          .onConflictDoNothing()
          .returning({ personId: erwaehnung.personId });
  const zustellung = await benachrichtige(tx, {
    lagerId,
    empfaengerIds: eingefuegt.map((e) => e.personId),
    art: "erwaehnung",
    objekt: { typ, id: quelleId },
    ausgeloestVon: zugriff.personId,
  });
  return { personIds: marken, neu: eingefuegt.length, zustellung };
}

export const erwaehnungenAbfrage = z.strictObject({
  // Cursor: die ID der letzten Erwähnung der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Nur offene (nicht erledigte)
  offen: z
    .enum(["true", "false"])
    .transform((w) => w === "true")
    .optional(),
});
export const erledigtSetzen = z.strictObject({ erledigt: z.boolean() });

export type ErwaehnungAnsicht = {
  id: string;
  quelleTyp: ErwaehnungQuelle;
  quelleId: string;
  // Titel des Inhalts; wer die Erwähnung hat, sieht den Inhalt auch
  titel: string;
  erledigt: boolean;
  aufgabeId: string | null;
  erstelltAm: Date;
};

// Die eigenen Erwähnungen, neueste zuerst. Je Seite eine Abfrage für die Zeilen und je vorkommender Inhaltsart zwei (Inhalte, Sichtbarkeit): höchstens neun. Was gelöscht ist oder die Person nicht mehr sehen darf, fehlt (die Seite kann deshalb kürzer sein als das Limit; «naechster» zeigt, ob es weitergeht)
export async function ladeErwaehnungen(
  db: Db,
  zugriff: LagerZugriff,
  p: { nach?: string; limit?: number; offen?: boolean; id?: string },
) {
  const limit = p.limit ?? 50;
  const zeilen = await db
    .select()
    .from(erwaehnung)
    .where(
      and(
        eq(erwaehnung.lagerId, zugriff.lager.id),
        eq(erwaehnung.personId, zugriff.personId),
        p.id ? eq(erwaehnung.id, p.id) : undefined,
        p.nach ? lt(erwaehnung.id, p.nach) : undefined,
        p.offen ? isNull(erwaehnung.erledigtAm) : undefined,
      ),
    )
    .orderBy(desc(erwaehnung.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);

  const jeTyp = new Map<ErwaehnungQuelle, string[]>();
  for (const z of seite) {
    jeTyp.set(z.quelleTyp, [...(jeTyp.get(z.quelleTyp) ?? []), z.quelleId]);
  }
  const titel = new Map<string, string>();
  for (const [typ, ids] of jeTyp) {
    const sichtbar = await sichtbareIds(db, zugriff, typ, ids);
    if (sichtbar.size === 0) continue;
    for (const q of await QUELLEN[typ].laden(db, zugriff.lager.id, [
      ...sichtbar,
    ])) {
      titel.set(q.id, q.titel);
    }
  }
  const eintraege: ErwaehnungAnsicht[] = seite.flatMap((z) =>
    titel.has(z.quelleId)
      ? [
          {
            id: z.id,
            quelleTyp: z.quelleTyp,
            quelleId: z.quelleId,
            titel: titel.get(z.quelleId)!,
            erledigt: z.erledigtAm !== null,
            aufgabeId: z.aufgabeId,
            erstelltAm: z.erstelltAm,
          },
        ]
      : [],
  );
  return {
    eintraege,
    naechster: zeilen.length > limit ? seite[seite.length - 1]!.id : null,
  };
}

// Setzt «erledigt» der eigenen Erwähnung; wiederholt gesetzt bleibt der erste Zeitpunkt
export const setzeErledigt = (
  db: Db,
  zugriff: LagerZugriff,
  id: string,
  erledigt: boolean,
) =>
  db
    .update(erwaehnung)
    .set({
      erledigtAm: erledigt
        ? sql`coalesce(${erwaehnung.erledigtAm}, now())`
        : null,
    })
    .where(
      and(
        eq(erwaehnung.id, id),
        eq(erwaehnung.lagerId, zugriff.lager.id),
        eq(erwaehnung.personId, zugriff.personId),
      ),
    );

// Legt aus der Erwähnung eine Aufgabe für die erwähnte Person an (die bestehende Anlage aus aufgaben.ts, Titel des Inhalts), höchstens eine je Erwähnung: Unter der Sperre des Lagers liest ein zweiter Aufruf die erste mit. neu: false heisst, die Aufgabe gab es schon. Der Titel kommt aus ladeErwaehnungen (nur eigene und sichtbare)
export async function alsAufgabe(
  tx: Tx,
  k: { lagerId: string; personId: string },
  e: Pick<ErwaehnungAnsicht, "id" | "titel">,
): Promise<{ aufgabeId: string; neu: boolean }> {
  await sperreLager(tx, k.lagerId);
  const [zeile] = await tx
    .select({ aufgabeId: erwaehnung.aufgabeId })
    .from(erwaehnung)
    .where(
      and(
        eq(erwaehnung.id, e.id),
        eq(erwaehnung.lagerId, k.lagerId),
        eq(erwaehnung.personId, k.personId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
  if (zeile.aufgabeId) return { aufgabeId: zeile.aufgabeId, neu: false };

  // Die Aufgabe gehört der erwähnten Person: kein Push (sie ist die Auslöserin)
  const ergebnis = await legeAufgabeAn(tx, k, {
    titel: e.titel,
    verantwortlichPersonId: k.personId,
    quelle: `erwaehnung:${e.id}`,
  });
  if ("fehler" in ergebnis) throw new HTTPException(400);
  await tx
    .update(erwaehnung)
    .set({ aufgabeId: ergebnis.id })
    .where(eq(erwaehnung.id, e.id));
  return { aufgabeId: ergebnis.id, neu: true };
}

// Nimmt «Als Aufgabe» zurück (#521): Die Aufgabe, die die Erwähnung angelegt hat, wird endgültig gelöscht, die Erwähnung ist wieder offen (der Fremdschlüssel setzt aufgabe_id auf leer). Nur solange die Aufgabe unverändert ist: Version 1 und weder Unterstützung noch Checkpunkte, Links, Stichworte oder ein Traktandum, das auf sie zeigt; sonst 409 AUFGABE_VERAENDERT, und nichts geht verloren. Hat die Erwähnung keine Aufgabe (mehr), tut der Aufruf nichts. Die Erwähnung muss der Person gehören (404)
export async function nimmAlsAufgabeZurueck(
  tx: Tx,
  k: { lagerId: string; personId: string },
  erwaehnungId: string,
) {
  await sperreLager(tx, k.lagerId);
  const [zeile] = await tx
    .select({ aufgabeId: erwaehnung.aufgabeId })
    .from(erwaehnung)
    .where(
      and(
        eq(erwaehnung.id, erwaehnungId),
        eq(erwaehnung.lagerId, k.lagerId),
        eq(erwaehnung.personId, k.personId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
  const a =
    zeile.aufgabeId && (await ladeAufgabeZeile(tx, k.lagerId, zeile.aufgabeId));
  if (!a) return;
  const [d] = await tx.execute<{ abhaengig: boolean }>(sql`
    select
      exists (select 1 from ${aufgabeUnterstuetzung} where ${aufgabeUnterstuetzung.aufgabeId} = ${a.id})
      or exists (select 1 from ${aufgabeCheckpunkt} where ${aufgabeCheckpunkt.aufgabeId} = ${a.id})
      or exists (select 1 from ${aufgabeLink} where ${aufgabeLink.aufgabeId} = ${a.id})
      or exists (select 1 from ${aufgabeStichwort} where ${aufgabeStichwort.aufgabeId} = ${a.id})
      or exists (select 1 from ${traktandum} where ${traktandum.aufgabeId} = ${a.id})
      as abhaengig`);
  if (a.version !== 1 || d!.abhaengig) {
    throw new LagerAntwortFehler(409, {
      code: "AUFGABE_VERAENDERT",
      message:
        "Die Aufgabe wurde schon bearbeitet. Lösche sie bei den Aufgaben, wenn du sie nicht mehr brauchst.",
    });
  }
  await loescheAufgabe(tx, k, a.id, a.version);
}
