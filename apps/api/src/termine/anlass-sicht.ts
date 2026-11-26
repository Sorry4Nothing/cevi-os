import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { anlass, programm } from "../db/schema.js";
import {
  rolleErlaubt,
  rolleErlaubtSql,
  sichtbarkeitFilter,
  type Sichtbarkeit,
  type SichtPerson,
  type SichtRollen,
} from "../sichtbarkeit.js";

// Sicht und Frist eines Anlasses (#443): wer ihn sehen und sich anmelden darf und ob die Anmeldung offen ist. Die Abfragen der Routen und von «Mein Kalender» (#435) benutzen dieselben Ausdrücke.

// Der Termin ist vorbei, wenn sein Ende (bei Ganztägigen: das Ende des letzten Tages, Schweizer Zeit) erreicht ist
export const terminVorbei = sql<boolean>`coalesce(${programm.ende}, (${programm.tagBis} + 1)::timestamp at time zone 'Europe/Zurich') <= now()`;

// Die Anmeldung ist offen, wenn der Anlass sie erlaubt, die Frist (Serverzeit) nicht vorbei ist und der Termin weder abgesagt noch vorbei ist. Braucht anlass und programm im FROM
export const anmeldungOffenSql = sql<boolean>`(${anlass.anmeldungOffen} and (${anlass.frist} is null or ${anlass.frist} > now()) and ${programm.status} <> 'abgesagt' and not ${terminVorbei})`;

// Wer den Anlass sehen darf, darf sich anmelden. Die Regeln der Sichtbarkeit (sichtbarkeit.ts) gelten für die eigenen Tags; dazu sehen Eltern einen Anlass mit Tags auch, wenn ein Tag die Stufe eines ihrer aktiven Kinder ist (Annahme A1 wie in «Mein Kalender»), ausser der Anlass schränkt diese Stufe auf Rollen ohne die Teilnehmenden ein (#844). Braucht anlass im FROM
export function anlassSichtbar(person: SichtPerson): SQL {
  const eigene = sichtbarkeitFilter(person, {
    abteilungId: anlass.abteilungId,
    sichtbarkeit: anlass.sichtbarkeit,
    sichtbarkeitTags: anlass.sichtbarkeitTags,
    sichtbarkeitRollen: anlass.sichtbarkeitRollen,
  });
  return sql`(${eigene} or (${anlass.abteilungId} = ${person.abteilungId} and ${anlass.sichtbarkeit} = 'tags' and exists (select 1 from kind_zugang as sicht_ke inner join kind as sicht_kind on sicht_kind.id = sicht_ke.kind_id where sicht_ke.user_id = ${person.id} and sicht_kind.abteilung_id = ${anlass.abteilungId} and sicht_kind.inaktiv_seit is null and sicht_kind.stufe_id = any(${anlass.sichtbarkeitTags}) and ${rolleErlaubtSql(anlass.sichtbarkeitRollen, sql`sicht_kind.stufe_id::text`, sql`'teilnehmende'::text`)})))`;
}

// Zielgruppe (#844): für wen die Person anmelden darf. Sich selbst, wenn die eigenen Tags passen (bei «angemeldet» und «oeffentlich» jede Person der Abteilung); anders als bei der Sicht gilt die Abteilungsleitung hier nicht von selbst. Braucht anlass im FROM
export function selbstInZielgruppe(person: SichtPerson): SQL {
  return sichtbarkeitFilter(
    { ...person, abteilungsleitung: false, entwickler: false },
    {
      abteilungId: anlass.abteilungId,
      sichtbarkeit: anlass.sichtbarkeit,
      sichtbarkeitTags: anlass.sichtbarkeitTags,
      sichtbarkeitRollen: anlass.sichtbarkeitRollen,
    },
  );
}

// Ein verbundenes Kind gehört zur Zielgruppe, wenn der Anlass für alle Angemeldeten oder öffentlich ist oder seine Stufe unter den Tags steht und dort die Teilnehmenden zugelassen sind (wie die Sicht der Eltern oben)
export function kindInZielgruppe(sicht: Sichtbarkeit, stufeId: string) {
  if (sicht.art !== "tags") return true;
  const rollen: SichtRollen = sicht.rollen ?? {};
  return (
    sicht.tagIds.includes(stufeId) &&
    rolleErlaubt(
      Object.hasOwn(rollen, stufeId) ? rollen[stufeId] : undefined,
      "teilnehmende",
    )
  );
}

export type AnlassInfo = {
  id: string;
  anmeldeschluss: Date | null;
  anmeldungOffen: boolean;
  angemeldet: boolean;
};

// Der Anlass zu jedem Termin der Seite («Mein Kalender», #435), wenn die Person ihn sehen darf: eine Abfrage für alle Termine. «angemeldet» heisst: Die Person selbst oder eines ihrer Kinder ist angemeldet
export async function ladeAnlassInfos(
  db: Db,
  person: SichtPerson,
  programmIds: string[],
) {
  const karte = new Map<string, AnlassInfo>();
  if (programmIds.length === 0) return karte;
  const zeilen = await db
    .select({
      programmId: anlass.programmId,
      id: anlass.id,
      anmeldeschluss: anlass.frist,
      anmeldungOffen: anmeldungOffenSql,
      angemeldet: sql<boolean>`exists (select 1 from anlass_anmeldung as m where m.anlass_id = ${anlass.id} and m.status = 'angemeldet' and ((m.kind_id is null and m.user_id = ${person.id}) or m.kind_id in (select ke.kind_id from kind_zugang as ke where ke.user_id = ${person.id})))`,
    })
    .from(anlass)
    .innerJoin(programm, eq(programm.id, anlass.programmId))
    .where(
      and(
        inArray(anlass.programmId, programmIds),
        eq(anlass.abteilungId, person.abteilungId),
        anlassSichtbar(person),
      ),
    );
  for (const { programmId, ...info } of zeilen) karte.set(programmId, info);
  return karte;
}
