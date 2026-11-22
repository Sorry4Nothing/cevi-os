import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { zimmer, zimmerZuordnung } from "../db/schema.js";
import { darf, type LagerZugriff } from "./policy.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Zimmer und Zelte des Lagers (#385). Beide Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit einteilung.lesen; das Team sieht nur sein eigenes Zimmer und die Zuordnungen darin; der Feed nennt nur IDs).

// Das Team (ohne einteilung.bearbeiten) sieht nur das eigene Zimmer und seine Mitbewohner, nur mit Namen. Wer sonst lesen darf (Lagerleitung, Leitung, Lesen), sieht alle Zimmer mit Plätzen und Belegung
export const nurEigenes = (
  zugriff: Pick<LagerZugriff, "rolle"> & Partial<Pick<LagerZugriff, "rechte">>,
) => zugriff.rolle === "team" && !darf(zugriff, "einteilung.bearbeiten");

const meineZimmer = (db: Db, lagerId: string, personId: string) =>
  db
    .select({ id: zimmerZuordnung.zimmerId })
    .from(zimmerZuordnung)
    .where(
      and(
        eq(zimmerZuordnung.lagerId, lagerId),
        eq(zimmerZuordnung.personId, personId),
        isNull(zimmerZuordnung.geloeschtAm),
      ),
    );

// Suche (#399): der Name des Zimmers oder Zelts; das Team findet nur die eigenen (wie die Liste). Die Notiz ist nicht durchsuchbar: Das Team sieht sie nicht
registriereSuchquelle({
  typ: "zimmer",
  recht: "einteilung.lesen",
  tabelle: zimmer,
  spalten: [zimmer.name],
  titel: sql`${zimmer.name}`,
  filter: (zugriff, db) =>
    nurEigenes(zugriff)
      ? inArray(zimmer.id, meineZimmer(db, zugriff.lager.id, zugriff.personId))
      : undefined,
});
registriereLagerTabelle({
  tabelle: zimmer,
  recht: "einteilung.lesen",
  sichtbar: async (db, zugriff, ids) => {
    if (!nurEigenes(zugriff)) return new Set(ids);
    const zeilen = await db
      .select({ id: zimmer.id })
      .from(zimmer)
      .where(
        and(
          eq(zimmer.lagerId, zugriff.lager.id),
          inArray(zimmer.id, ids),
          inArray(
            zimmer.id,
            meineZimmer(db, zugriff.lager.id, zugriff.personId),
          ),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});
registriereLagerTabelle({
  tabelle: zimmerZuordnung,
  recht: "einteilung.lesen",
  sichtbar: async (db, zugriff, ids) => {
    if (!nurEigenes(zugriff)) return new Set(ids);
    // Die eigene Zuordnung (auch die gelöschte: Die Person erfährt, dass sie aus dem Zimmer ist) und die im eigenen Zimmer
    const zeilen = await db
      .select({ id: zimmerZuordnung.id })
      .from(zimmerZuordnung)
      .where(
        and(
          eq(zimmerZuordnung.lagerId, zugriff.lager.id),
          inArray(zimmerZuordnung.id, ids),
          or(
            eq(zimmerZuordnung.personId, zugriff.personId),
            inArray(
              zimmerZuordnung.zimmerId,
              meineZimmer(db, zugriff.lager.id, zugriff.personId),
            ),
          ),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});

export const zimmerAnsicht = (r: typeof zimmer.$inferSelect) => ({
  id: r.id,
  version: r.version,
  name: r.name,
  art: r.art,
  plaetze: r.plaetze,
  notiz: r.notiz,
  reihenfolge: r.reihenfolge,
});

// Eingaben: strikt, nur die genannten Felder (SR-72); Leerraum fällt weg, Umlaute werden zusammengesetzt (NFC), Steuerzeichen sind verboten
const text = (max: number) =>
  z
    .string()
    .transform((w) => w.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine((w) => !/\p{Cc}/u.test(w)),
    );
const name = text(100);
const art = z.enum(["zimmer", "zelt"]);
const plaetze = z.number().int().min(1).max(1000);
const notiz = text(500);
const reihenfolge = z.number().int().min(0).max(100_000);
const version = z.number().int().min(1);

export const zimmerAnlegen = z.strictObject({
  name,
  art,
  plaetze,
  notiz: notiz.nullable().optional(),
  reihenfolge: reihenfolge.optional(),
});
export const zimmerAendern = z
  .strictObject({
    version,
    name: name.optional(),
    art: art.optional(),
    plaetze: plaetze.optional(),
    notiz: notiz.nullable().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// Höchstens so viele Personen je Anfrage (SR-71)
export const MAX_ZUORDNUNG = 200;
export const zuordnung = z
  .strictObject({
    teilnehmerIds: z.array(z.uuid()).max(MAX_ZUORDNUNG).default([]),
    personIds: z.array(z.uuid()).max(MAX_ZUORDNUNG).default([]),
  })
  .refine(
    (b) =>
      b.teilnehmerIds.length + b.personIds.length >= 1 &&
      b.teilnehmerIds.length + b.personIds.length <= MAX_ZUORDNUNG &&
      new Set(b.teilnehmerIds).size === b.teilnehmerIds.length &&
      new Set(b.personIds).size === b.personIds.length,
  );

export type Anzeigeperson = {
  id: string;
  vorname: string;
  nachname: string;
  ceviName: string | null;
};

// Anzeigenamen für Aushänge und Türschilder (#385, benutzt von #405). Stufe 1: der Cevi-Name, sonst der Vorname. Ist der Name im ganzen Lager nicht eindeutig (ohne Beachtung der Gross- und Kleinschreibung), gilt für alle, die ihn teilen, Stufe 2: der Vorname. Bleibt er gleich, Stufe 3: Vorname und Anfangsbuchstabe des Nachnamens («Anna M.»). Weiter geht es nicht: Zwei gleiche Vornamen mit gleichem Anfangsbuchstaben behalten denselben Namen. Es wird so lange neu verglichen, bis sich keine Stufe mehr ändert, damit ein Vorname der Stufe 2 nie auf einen Cevi-Namen der Stufe 1 trifft
export function berechneAnzeigenamen(personen: Anzeigeperson[]) {
  const stufeVon = new Map(personen.map((p) => [p.id, 1]));
  const name = (p: Anzeigeperson, stufe: number) => {
    const roh =
      stufe === 1
        ? (p.ceviName ?? p.vorname)
        : stufe === 2
          ? p.vorname
          : p.nachname
            ? `${p.vorname} ${[...p.nachname][0]!.toUpperCase()}.`
            : p.vorname;
    return roh.trim();
  };
  for (let aenderung = true; aenderung;) {
    aenderung = false;
    const gruppen = new Map<string, Anzeigeperson[]>();
    for (const p of personen) {
      const schluessel = name(p, stufeVon.get(p.id)!).toLowerCase();
      gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), p]);
    }
    for (const gruppe of gruppen.values()) {
      if (gruppe.length < 2) continue;
      for (const p of gruppe) {
        const s = stufeVon.get(p.id)!;
        if (s < 3) {
          stufeVon.set(p.id, s + 1);
          aenderung = true;
        }
      }
    }
  }
  return new Map(personen.map((p) => [p.id, name(p, stufeVon.get(p.id)!)]));
}

// Die Anzeigenamen aller Teilnehmenden und Mitglieder des Lagers (Konten der Abteilung des Lagers, aktiv), in einer Abfrage: ID der teilnehmenden Person oder des Kontos -> Name. Mitglieder haben im Konto nur einen Namen: Der erste Teil ist der Vorname, der Rest der Nachname. Wer den Namen eines Lagers braucht (Aushang, Türschild, Listen), ruft diese Funktion einmal je Lager und nie je Person auf
export async function anzeigeNamenLager(
  db: Pick<Db, "execute">,
  lagerId: string,
) {
  const zeilen = await db.execute<{
    id: string;
    vorname: string;
    nachname: string;
    ceviName: string | null;
    konto: boolean;
  }>(sql`
    select t.id, t.vorname, t.nachname, t.cevi_name as "ceviName", false as konto
    from teilnehmer t
    where t.lager_id = ${lagerId} and t.geloescht_am is null
    union all
    select u.id, u.name, '', u.cevi_name, true
    from lager_mitglied m
    join lager l on l.id = m.lager_id
    join "user" u on u.id = m.person_id and u.abteilung_id = l.abteilung_id
    where m.lager_id = ${lagerId} and u.deaktiviert_am is null and coalesce(u.banned, false) = false`);
  return berechneAnzeigenamen(
    zeilen.map((z) => {
      if (!z.konto) return z;
      const [vorname = "", ...rest] = z.vorname.trim().split(/\s+/);
      return {
        ...z,
        vorname: vorname || z.vorname,
        nachname: rest.join(" "),
      };
    }),
  );
}

export type Mitglied = { typ: "teilnehmer" | "person"; id: string };
export type ZimmerZeile = ReturnType<typeof zimmerAnsicht> & {
  belegt: number;
  mitglieder: Mitglied[];
};

// Die Zimmer des Lagers mit Belegung in einer Abfrage (GROUP BY): belegt zählt nur gültige Einträge (Teilnehmende nicht im Papierkorb, Mitglieder des Lagers mit aktivem Konto der Abteilung). Mit zimmerId nur dieses Zimmer, mit nurPerson nur Zimmer, in denen die Person liegt (Team). Mehr Belegte als Plätze ist erlaubt
export async function ladeZimmer(
  db: Pick<Db, "execute">,
  lagerId: string,
  abteilungId: string,
  p: { zimmerId?: string; nurPerson?: string } = {},
): Promise<ZimmerZeile[]> {
  const zeilen = await db.execute<
    ReturnType<typeof zimmerAnsicht> & {
      belegt: number;
      mitglieder: Mitglied[];
    }
  >(sql`
    select z.id, z.version, z.name, z.art, z.plaetze, z.notiz, z.reihenfolge,
      count(*) filter (where t.id is not null or u.id is not null)::int as belegt,
      coalesce(
        jsonb_agg(jsonb_build_object('typ', case when t.id is not null then 'teilnehmer' else 'person' end, 'id', coalesce(t.id, u.id)))
          filter (where t.id is not null or u.id is not null),
        '[]'::jsonb) as mitglieder
    from zimmer z
    left join zimmer_zuordnung a on a.lager_id = z.lager_id and a.zimmer_id = z.id and a.geloescht_am is null
    left join teilnehmer t on t.lager_id = a.lager_id and t.id = a.teilnehmer_id and t.geloescht_am is null
    left join lager_mitglied m on m.lager_id = a.lager_id and m.person_id = a.person_id
    left join "user" u on u.id = m.person_id and u.abteilung_id = ${abteilungId}
      and u.deaktiviert_am is null and coalesce(u.banned, false) = false
    where z.lager_id = ${lagerId} and z.geloescht_am is null
      ${p.zimmerId ? sql`and z.id = ${p.zimmerId}` : sql``}
      ${
        p.nurPerson
          ? sql`and z.id in (select e.zimmer_id from zimmer_zuordnung e where e.lager_id = ${lagerId} and e.person_id = ${p.nurPerson} and e.geloescht_am is null)`
          : sql``
      }
    group by z.id
    order by z.reihenfolge, z.name, z.id`);
  return [...zeilen];
}

// Wer noch in keinem Zimmer liegt: Zähler für die Übersicht («Nicht eingeteilt: 3»), eine Abfrage
export async function zaehleOffene(
  db: Pick<Db, "execute">,
  lagerId: string,
  abteilungId: string,
) {
  const [z] = await db.execute<{ teilnehmer: number; team: number }>(sql`
    select
      (select count(*) from teilnehmer t where t.lager_id = ${lagerId} and t.geloescht_am is null
        and not exists (select 1 from zimmer_zuordnung a where a.lager_id = t.lager_id and a.teilnehmer_id = t.id and a.geloescht_am is null))::int as teilnehmer,
      (select count(*) from lager_mitglied m join "user" u on u.id = m.person_id
        where m.lager_id = ${lagerId} and u.abteilung_id = ${abteilungId} and u.deaktiviert_am is null and coalesce(u.banned, false) = false
        and not exists (select 1 from zimmer_zuordnung a where a.lager_id = m.lager_id and a.person_id = m.person_id and a.geloescht_am is null))::int as team`);
  return z!;
}
