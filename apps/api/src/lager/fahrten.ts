import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  fahrt,
  fahrtMitfahrer,
  lagerMitglied,
  teilnehmer,
  user,
} from "../db/schema.js";
import { LINK_MAX, pruefeLink } from "../link-pruefung.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Fahrten des Lagers (#386): Ansichten, Eingabeschemas, Abfragen und die Prüfungen, die in der Schreib-Transaktion laufen. Beide Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit einteilung.lesen; der Zeilenfilter lässt dem Team nur die eigene Fahrt).
//
// Rechte (lager/rechte-katalog.ts): einteilung.lesen liest, einteilung.bearbeiten schreibt. Das Team sieht nur die eigene Fahrt (als Fahrer oder Mitfahrende), solange es einteilung.bearbeiten nicht hat; eine fremde Fahrt ist für das Team unbekannt (404, wie eine Fahrt eines fremden Lagers), und «Personen ohne Fahrt» liest es nicht (403). Alle anderen Rollen mit einteilung.lesen sehen alle Fahrten.
//
// Eine Person sitzt je Richtung in höchstens einer Fahrt (als Fahrer oder Mitfahrende); ein Teilnehmender ebenso (Mitfahrende). Die Datenbank hält es für Mitfahrende und für Fahrer je für sich (Teilindizes), die Route prüft unter der Lagersperre auch die Kombination (Fahrer und Mitfahrende).
//
// Überbelegung ist nur eine Warnung: Mehr Mitfahrende als Plätze lässt der Server zu und meldet «ueberbelegt» (wie im bisherigen Tool); die Lagerleitung entscheidet.
registriereLagerTabelle({
  tabelle: fahrt,
  recht: "einteilung.lesen",
  sichtbar: fahrtSichtbar,
});
registriereLagerTabelle({
  tabelle: fahrtMitfahrer,
  recht: "einteilung.lesen",
  sichtbar: mitfahrerSichtbar,
});

export type FahrtZeile = typeof fahrt.$inferSelect;
export type MitfahrerZeile = typeof fahrtMitfahrer.$inferSelect;

// Sieht die Rolle alle Fahrten? Alle ausser dem Team; das Team nur mit einteilung.bearbeiten (die Lagerleitung kann es einstellen)
export const siehtAlleFahrten = (zugriff: Parameters<typeof darf>[0]) =>
  zugriff.rolle !== "team" || darf(zugriff, "einteilung.bearbeiten");

// Die eigene Fahrt: als Fahrer oder als Mitfahrende (auch eine Mitfahrt im Papierkorb zählt für den Feed, damit das Entfernen die Person erreicht; die Liste prüft zusätzlich geloescht_am)
const eigeneFahrt = (personId: string, nurAktiv: boolean) =>
  or(
    eq(fahrt.fahrerPersonId, personId),
    nurAktiv
      ? sql`exists (select 1 from fahrt_mitfahrer x where x.fahrt_id = ${fahrt.id} and x.lager_id = ${fahrt.lagerId} and x.person_id = ${personId} and x.geloescht_am is null)`
      : sql`exists (select 1 from fahrt_mitfahrer x where x.fahrt_id = ${fahrt.id} and x.lager_id = ${fahrt.lagerId} and x.person_id = ${personId})`,
  );

async function fahrtSichtbar(db: Db, zugriff: LagerZugriff, ids: string[]) {
  if (siehtAlleFahrten(zugriff)) return new Set(ids);
  const zeilen = await db
    .select({ id: fahrt.id })
    .from(fahrt)
    .where(
      and(
        eq(fahrt.lagerId, zugriff.lager.id),
        inArray(fahrt.id, ids),
        eigeneFahrt(zugriff.personId, false),
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}

// Eine Mitfahrt sieht, wer in derselben Fahrt sitzt (oder fährt) oder selbst die Mitfahrt ist
async function mitfahrerSichtbar(db: Db, zugriff: LagerZugriff, ids: string[]) {
  if (siehtAlleFahrten(zugriff)) return new Set(ids);
  const ich = zugriff.personId;
  const zeilen = await db
    .select({ id: fahrtMitfahrer.id })
    .from(fahrtMitfahrer)
    .where(
      and(
        eq(fahrtMitfahrer.lagerId, zugriff.lager.id),
        inArray(fahrtMitfahrer.id, ids),
        or(
          eq(fahrtMitfahrer.personId, ich),
          sql`exists (select 1 from fahrt f where f.id = ${fahrtMitfahrer.fahrtId} and f.lager_id = ${fahrtMitfahrer.lagerId} and f.fahrer_person_id = ${ich})`,
          sql`exists (select 1 from fahrt_mitfahrer x where x.fahrt_id = ${fahrtMitfahrer.fahrtId} and x.lager_id = ${fahrtMitfahrer.lagerId} and x.person_id = ${ich})`,
        ),
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}

// Ansichten für die Antwort und die Konfliktantwort des Sync-Kerns: nur die Spalten der Route, nie die ganze Zeile
export const fahrtAnsicht = (r: FahrtZeile) => ({
  id: r.id,
  version: r.version,
  richtung: r.richtung,
  art: r.art,
  name: r.name,
  fahrerPersonId: r.fahrerPersonId,
  plaetze: r.plaetze,
  datum: r.datum,
  zeit: r.zeit,
  von: r.von,
  nach: r.nach,
  treffpunkt: r.treffpunkt,
  link: r.link,
  zielBezeichnung: r.zielBezeichnung,
  zielAdresse: r.zielAdresse,
  zielLat: r.zielLat,
  zielLon: r.zielLon,
  zielLink: r.zielLink,
});
export const mitfahrerAnsicht = (r: MitfahrerZeile) => ({
  id: r.id,
  version: r.version,
  fahrtId: r.fahrtId,
  personId: r.personId,
  teilnehmerId: r.teilnehmerId,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Leerraum fällt zusammen, Umlaute werden zusammengesetzt (NFC), Steuerzeichen sind verboten
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
// Nur https, ohne Zugangsdaten, kein javascript: oder data:; der Server ruft die Adresse nie ab (SR-26). Gespeichert wird die normalisierte Form. Ohne Einschränkung auf Hosts: Fahrplan und Karten-Apps liegen auf vielen Hosts
const httpsLink = z
  .string()
  .max(LINK_MAX)
  .refine((w) => pruefeLink(w).ok)
  .transform((w) => {
    const e = pruefeLink(w);
    return e.ok ? e.link : w;
  });
const version = z.number().int().min(1);
const richtung = z.enum(["hin", "rueck"]);
const art = z.enum(["auto", "oev"]);
export const ZEIT = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// Die Felder einer Fahrt, die die App setzen darf (Richtung und Art nur beim Anlegen); beim Ändern ist jedes optional. Der Kartenpunkt: Bezeichnung mit Adresse, Koordinaten oder Link; die Koordinaten kommen nur zusammen
const felder = {
  name: text(100).nullable(),
  fahrerPersonId: z.uuid().nullable(),
  plaetze: z.number().int().min(1).max(99).nullable(),
  datum: z.iso
    .date()
    .refine((w) => !w.startsWith("0000"))
    .nullable(),
  zeit: z.string().regex(ZEIT).nullable(),
  von: text(200).nullable(),
  nach: text(200).nullable(),
  treffpunkt: text(200).nullable(),
  link: httpsLink.nullable(),
  zielBezeichnung: text(100).nullable(),
  zielAdresse: text(200).nullable(),
  zielLat: z.number().min(-90).max(90).nullable(),
  zielLon: z.number().min(-180).max(180).nullable(),
  zielLink: httpsLink.nullable(),
};
const optional = Object.fromEntries(
  Object.entries(felder).map(([k, f]) => [k, f.optional()]),
) as { [K in keyof typeof felder]: z.ZodOptional<(typeof felder)[K]> };

export const fahrtAnlegen = z.strictObject({ richtung, art, ...optional });
export const fahrtAendern = z
  .strictObject({ version, ...optional })
  .refine((b) => Object.keys(b).length > 1);
export const mitfahrerAnlegen = z
  .strictObject({
    personId: z.uuid().optional(),
    teilnehmerId: z.uuid().optional(),
  })
  // Genau eines von beiden
  .refine((b) => (b.personId === undefined) !== (b.teilnehmerId === undefined));
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});
export const listeAbfrage = z.strictObject({
  richtung: richtung.optional(),
  // Cursor: die ID der letzten Fahrt der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const ohneFahrtAbfrage = z.strictObject({
  richtung,
  // Cursor: «teilnehmer:<id>» oder «person:<id>» des letzten Eintrags der vorigen Seite
  nach: z
    .string()
    .regex(
      /^(teilnehmer|person):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type FahrtFehler =
  | "PLAETZE_FEHLEN"
  | "NUR_FUER_AUTO"
  | "LINK_NUR_FUER_OEV"
  | "KOORDINATEN_UNVOLLSTAENDIG"
  | "KARTENPUNKT_UNVOLLSTAENDIG";

// Die Regeln über mehrere Felder (die Datenbank hält dieselben als CHECK): ein Auto hat Plätze und keinen Fahrplan-Link, eine ÖV-Gruppe weder Plätze noch Fahrer; der Kartenpunkt ist ganz oder gar nicht da. Beim Ändern mit dem Stand der Zeile zusammengeführt aufrufen
export function pruefeFahrt(
  w: Pick<
    FahrtZeile,
    | "art"
    | "plaetze"
    | "fahrerPersonId"
    | "link"
    | "zielBezeichnung"
    | "zielAdresse"
    | "zielLat"
    | "zielLon"
    | "zielLink"
  >,
): FahrtFehler | undefined {
  if (w.art === "auto") {
    if (w.plaetze === null) return "PLAETZE_FEHLEN";
    if (w.link !== null) return "LINK_NUR_FUER_OEV";
  } else if (w.plaetze !== null || w.fahrerPersonId !== null) {
    return "NUR_FUER_AUTO";
  }
  if ((w.zielLat === null) !== (w.zielLon === null)) {
    return "KOORDINATEN_UNVOLLSTAENDIG";
  }
  const hatKartenpunkt = [
    w.zielBezeichnung,
    w.zielAdresse,
    w.zielLat,
    w.zielLink,
  ].some((v) => v !== null);
  if (
    hatKartenpunkt &&
    (w.zielBezeichnung === null ||
      (w.zielAdresse === null && w.zielLat === null && w.zielLink === null))
  ) {
    return "KARTENPUNKT_UNVOLLSTAENDIG";
  }
  return undefined;
}

export type MitfahrerEintrag = {
  id: string;
  version: number;
  personId: string | null;
  teilnehmerId: string | null;
  name: string;
  stufe: string | null;
};

// Antwort einer Fahrt mit Fahrer, Mitfahrenden und Belegung: «belegt» zählt die Mitfahrenden ohne den Fahrer, «frei» sind die Plätze «x von y» (nie unter 0), «ueberbelegt» die Warnung bei mehr Mitfahrenden als Plätzen
function fahrtMitBelegung(
  f: FahrtZeile,
  fahrerName: string | null,
  mitfahrer: MitfahrerEintrag[],
) {
  const belegt = mitfahrer.length;
  return {
    ...fahrtAnsicht(f),
    fahrer: f.fahrerPersonId
      ? { personId: f.fahrerPersonId, name: fahrerName }
      : null,
    mitfahrer,
    belegt,
    frei: f.plaetze === null ? null : Math.max(f.plaetze - belegt, 0),
    ueberbelegt: f.plaetze !== null && belegt > f.plaetze,
  };
}

// Eine Abfrage für die Seite der Fahrten samt Fahrer und Mitfahrenden (Join und json_agg, keine Abfrage je Fahrt). Das Team bekommt nur die eigene Fahrt. Sortiert nach ID (Reihenfolge des Anlegens); die App sortiert nach Datum und Zeit
export async function ladeFahrten(
  db: Db,
  zugriff: LagerZugriff,
  p: { id?: string; richtung?: "hin" | "rueck"; nach?: string; limit?: number },
) {
  const limit = p.limit ?? 100;
  const fahrer = alias(user, "fahrer");
  const mitfahrerUser = alias(user, "mitfahrer_user");
  const mitfahrer = sql<
    MitfahrerEintrag[]
  >`coalesce(json_agg(json_build_object('id', ${fahrtMitfahrer.id}, 'version', ${fahrtMitfahrer.version}, 'personId', ${fahrtMitfahrer.personId}, 'teilnehmerId', ${fahrtMitfahrer.teilnehmerId}, 'name', coalesce(${mitfahrerUser.name}, ${teilnehmer.vorname} || ' ' || ${teilnehmer.nachname}), 'stufe', ${teilnehmer.stufe}) order by ${fahrtMitfahrer.erstelltAm}, ${fahrtMitfahrer.id}) filter (where ${fahrtMitfahrer.id} is not null), '[]'::json)`;
  const zeilen = await db
    .select({ f: getTableColumns(fahrt), fahrerName: fahrer.name, mitfahrer })
    .from(fahrt)
    .leftJoin(fahrer, eq(fahrer.id, fahrt.fahrerPersonId))
    .leftJoin(
      fahrtMitfahrer,
      and(
        eq(fahrtMitfahrer.fahrtId, fahrt.id),
        eq(fahrtMitfahrer.lagerId, fahrt.lagerId),
        isNull(fahrtMitfahrer.geloeschtAm),
      ),
    )
    .leftJoin(mitfahrerUser, eq(mitfahrerUser.id, fahrtMitfahrer.personId))
    .leftJoin(teilnehmer, eq(teilnehmer.id, fahrtMitfahrer.teilnehmerId))
    .where(
      and(
        eq(fahrt.lagerId, zugriff.lager.id),
        isNull(fahrt.geloeschtAm),
        p.id ? eq(fahrt.id, p.id) : undefined,
        p.richtung ? eq(fahrt.richtung, p.richtung) : undefined,
        p.nach ? sql`${fahrt.id} > ${p.nach}` : undefined,
        siehtAlleFahrten(zugriff)
          ? undefined
          : eigeneFahrt(zugriff.personId, true),
      ),
    )
    .groupBy(fahrt.id, fahrer.id)
    .orderBy(asc(fahrt.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  return {
    fahrten: seite.map((z) =>
      fahrtMitBelegung(z.f as FahrtZeile, z.fahrerName, z.mitfahrer),
    ),
    naechster: zeilen.length > limit ? seite[limit - 1]!.f.id : null,
  };
}

// «Personen ohne Fahrt»: die Teilnehmenden und die Mitglieder des Lagers (Leitende, Team, Lesen mit aktivem Konto der Abteilung), die in dieser Richtung weder fahren noch mitfahren. Eine Abfrage für die Seite und die Gesamtzahl (CTE einmal ausgewertet), Seitenwechsel über (Sortiername, ID)
export async function ladeOhneFahrt(
  db: Db,
  zugriff: LagerZugriff,
  abteilungId: string,
  p: {
    richtung: "hin" | "rueck";
    nach?: string;
    limit: number;
  },
) {
  const lagerId = zugriff.lager.id;
  const [nachArt, nachId] = p.nach?.split(":") ?? [];
  const seitenwechsel = p.nach
    ? sql`where (o.sortname, o.id) > (select s.sortname, s.id from ohne s where s.art = ${nachArt!} and s.id = ${nachId!})`
    : sql``;
  const zeilen = await db.execute<{
    art: "teilnehmer" | "person";
    id: string;
    name: string;
    stufe: string | null;
    gesamt: number;
  }>(sql`
    with ohne as (
      select 'teilnehmer'::text as art, t.id::text as id, t.vorname || ' ' || t.nachname as name, t.stufe as stufe, t.nachname || ' ' || t.vorname as sortname
      from teilnehmer t
      where t.lager_id = ${lagerId} and t.geloescht_am is null
        and not exists (
          select 1 from fahrt_mitfahrer m
          where m.lager_id = t.lager_id and m.teilnehmer_id = t.id and m.richtung = ${p.richtung} and m.geloescht_am is null
        )
      union all
      select 'person'::text, lm.person_id::text, u.name, null::text, u.name
      from lager_mitglied lm
      join "user" u on u.id = lm.person_id
      where lm.lager_id = ${lagerId} and u.abteilung_id = ${abteilungId}
        and u.deaktiviert_am is null and coalesce(u.banned, false) = false
        and not exists (
          select 1 from fahrt_mitfahrer m
          where m.lager_id = lm.lager_id and m.person_id = lm.person_id and m.richtung = ${p.richtung} and m.geloescht_am is null
        )
        and not exists (
          select 1 from fahrt f
          where f.lager_id = lm.lager_id and f.fahrer_person_id = lm.person_id and f.richtung = ${p.richtung} and f.geloescht_am is null
        )
    )
    select o.art, o.id, o.name, o.stufe, (select count(*)::int from ohne) as gesamt
    from ohne o
    ${seitenwechsel}
    order by o.sortname, o.id
    limit ${p.limit + 1}`);
  const seite = [...zeilen].slice(0, p.limit);
  return {
    personen: seite.map((z) => ({
      teilnehmerId: z.art === "teilnehmer" ? z.id : null,
      personId: z.art === "person" ? z.id : null,
      name: z.name,
      stufe: z.stufe,
    })),
    gesamt: zeilen[0]?.gesamt ?? 0,
    naechster:
      zeilen.length > p.limit
        ? `${seite[p.limit - 1]!.art}:${seite[p.limit - 1]!.id}`
        : null,
  };
}

// Ist die Person aktives Mitglied dieses Lagers (Konto der Abteilung, nicht deaktiviert, nicht gesperrt)? Unbekannte, fremde und gesperrte Konten sind für die Route dasselbe
export async function istAktivesMitglied(
  tx: Pick<Tx, "select">,
  lagerId: string,
  abteilungId: string,
  personId: string,
) {
  const [zeile] = await tx
    .select({ id: lagerMitglied.personId })
    .from(lagerMitglied)
    .innerJoin(user, eq(user.id, lagerMitglied.personId))
    .where(
      and(
        eq(lagerMitglied.lagerId, lagerId),
        eq(lagerMitglied.personId, personId),
        eq(user.abteilungId, abteilungId),
        isNull(user.deaktiviertAm),
        sql`coalesce(${user.banned}, false) = false`,
      ),
    );
  return zeile !== undefined;
}

// Die Fahrt dieser Richtung, in der die Person oder der Teilnehmende schon fährt oder mitfährt; höchstens eine, sonst undefined. Eine Abfrage
export async function bestehendeFahrt(
  tx: Pick<Tx, "execute">,
  lagerId: string,
  richtung: "hin" | "rueck",
  wer: { personId: string } | { teilnehmerId: string },
) {
  const gefunden =
    "personId" in wer
      ? await tx.execute<{ id: string }>(sql`
          select f.id from fahrt f
          where f.lager_id = ${lagerId} and f.richtung = ${richtung} and f.geloescht_am is null and f.fahrer_person_id = ${wer.personId}
          union all
          select m.fahrt_id from fahrt_mitfahrer m
          where m.lager_id = ${lagerId} and m.richtung = ${richtung} and m.geloescht_am is null and m.person_id = ${wer.personId}
          limit 1`)
      : await tx.execute<{ id: string }>(sql`
          select m.fahrt_id as id from fahrt_mitfahrer m
          where m.lager_id = ${lagerId} and m.richtung = ${richtung} and m.geloescht_am is null and m.teilnehmer_id = ${wer.teilnehmerId}
          limit 1`);
  return gefunden[0]?.id;
}
