import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { gruppe, gruppeZuordnung } from "../db/schema.js";
import {
  MISCHEN_MAX_GRUPPEN,
  MISCHEN_MIN_GRUPPEN,
  SEED_MAX,
} from "./mischen.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Programmgruppen des Lagers (#387). Beide Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit einteilung.lesen, kein Zeilenfilter; der Feed nennt nur IDs).
for (const tabelle of [gruppe, gruppeZuordnung]) {
  registriereLagerTabelle({ tabelle, recht: "einteilung.lesen" });
}
// Suche (#399): der Name der Gruppe (kein Zeilenfilter, wie in der Liste)
registriereSuchquelle({
  typ: "gruppe",
  recht: "einteilung.lesen",
  tabelle: gruppe,
  spalten: [gruppe.name],
  titel: sql`${gruppe.name}`,
});

// Höchstens so viele Gruppen je Lager und so viele Einträge je Anfrage (SR-71)
export const MAX_GRUPPEN = 50;
export const MAX_ZUORDNUNG = 200;

export const gruppeKurz = (r: typeof gruppe.$inferSelect) => ({
  id: r.id,
  version: r.version,
  name: r.name,
  reihenfolge: r.reihenfolge,
});

// Eingaben: strikt, nur die genannten Felder (SR-72); Leerzeichen am Rand fallen weg, Umlaute werden zusammengesetzt (NFC), Steuerzeichen sind verboten
const name = z
  .string()
  .transform((w) => w.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(100)
      .refine((w) => !/\p{Cc}/u.test(w)),
  );
const reihenfolge = z.number().int().min(0).max(1000);
const eindeutig = (liste: string[]) => new Set(liste).size === liste.length;

export const gruppeAnlegen = z.strictObject({
  name,
  reihenfolge: reihenfolge.optional(),
});
export const gruppeAendern = z
  .strictObject({
    version: z.number().int().min(1),
    name: name.optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// gruppeId null nimmt die genannten aus ihrer Gruppe. rolle gilt nur für personIds (Mitglieder des Lagers); Teilnehmende sind immer «mitglied»
export const zuordnen = z
  .strictObject({
    gruppeId: z.uuid().nullable(),
    teilnehmerIds: z.array(z.uuid()).max(MAX_ZUORDNUNG).default([]),
    personIds: z.array(z.uuid()).max(MAX_ZUORDNUNG).default([]),
    rolle: z.enum(["leitung", "mitglied"]).default("mitglied"),
  })
  .refine(
    (b) =>
      b.teilnehmerIds.length + b.personIds.length >= 1 &&
      b.teilnehmerIds.length + b.personIds.length <= MAX_ZUORDNUNG &&
      eindeutig(b.teilnehmerIds) &&
      eindeutig(b.personIds),
  );

export const abwaehlen = z.strictObject({
  abgewaehlt: z.boolean(),
  teilnehmerIds: z.array(z.uuid()).min(1).max(MAX_ZUORDNUNG).refine(eindeutig),
});

// uebernehmen false: nur Vorschlag, es wird nichts geschrieben. seed (optional) macht die Verteilung wiederholbar; ohne ihn zieht der Server einen und nennt ihn in der Antwort
export const mischen = z.strictObject({
  anzahl: z.number().int().min(MISCHEN_MIN_GRUPPEN).max(MISCHEN_MAX_GRUPPEN),
  uebernehmen: z.boolean(),
  seed: z.number().int().min(0).max(SEED_MAX).optional(),
});

type Person = { personId: string; name: string; ceviName: string | null };
type Kind = {
  id: string;
  vorname: string;
  nachname: string;
  stufe: string | null;
  ceviName?: string | null;
};

// Die Gruppen mit Personen und Teilnehmenden in einer Abfrage (GROUP BY je Gruppe, jede Zuordnung ist genau eine Person oder ein Teilnehmender, es gibt keine Vervielfachung); dazu eine Abfrage für die Zähler. Abgewählte und gelöschte Teilnehmende, Konten ausserhalb der Abteilung, deaktivierte und ehemalige Mitglieder erscheinen nicht. Die Route und der Aushang (#405) lesen mit dieser Funktion
export async function ladeGruppen(
  db: Pick<Db, "execute">,
  lagerId: string,
  abteilungId: string,
  mitCeviName: boolean,
) {
  const [gruppen, zaehler] = await Promise.all([
    db.execute<{
      id: string;
      version: number;
      name: string;
      reihenfolge: number;
      personen: (Person & { rolle: string })[];
      teilnehmer: Kind[];
    }>(sql`
      select g.id, g.version, g.name, g.reihenfolge,
        coalesce(jsonb_agg(jsonb_build_object('personId', u.id, 'name', u.name, 'ceviName', u.cevi_name, 'rolle', z.rolle)
          order by u.name, u.id) filter (where u.id is not null), '[]'::jsonb) as personen,
        coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'vorname', t.vorname, 'nachname', t.nachname, 'stufe', t.stufe, 'ceviName', t.cevi_name)
          order by t.nachname, t.vorname, t.id) filter (where t.id is not null), '[]'::jsonb) as teilnehmer
      from gruppe g
      left join gruppe_zuordnung z on z.lager_id = g.lager_id and z.gruppe_id = g.id and z.geloescht_am is null
      left join teilnehmer t on t.lager_id = z.lager_id and t.id = z.teilnehmer_id and t.geloescht_am is null and not t.abgewaehlt
      left join lager_mitglied m on m.lager_id = z.lager_id and m.person_id = z.person_id
      left join "user" u on u.id = m.person_id and u.abteilung_id = ${abteilungId} and u.deaktiviert_am is null and coalesce(u.banned, false) = false
      where g.lager_id = ${lagerId} and g.geloescht_am is null
      group by g.id
      order by g.reihenfolge, g.name, g.id`),
    db.execute<{ ohne_gruppe: number; abgewaehlt: number }>(sql`
      select
        count(*) filter (where not t.abgewaehlt and not exists (
          select 1 from gruppe_zuordnung z
          where z.lager_id = t.lager_id and z.teilnehmer_id = t.id and z.geloescht_am is null))::int as ohne_gruppe,
        count(*) filter (where t.abgewaehlt)::int as abgewaehlt
      from teilnehmer t
      where t.lager_id = ${lagerId} and t.geloescht_am is null`),
  ]);
  return {
    gruppen: gruppen.map((g) => ({
      ...g,
      teilnehmer: g.teilnehmer.map(({ ceviName, ...rest }) =>
        mitCeviName ? { ...rest, ceviName } : rest,
      ),
    })),
    ohneGruppe: zaehler[0]?.ohne_gruppe ?? 0,
    abgewaehlt: zaehler[0]?.abgewaehlt ?? 0,
  };
}
