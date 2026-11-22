import { sql, type SQL } from "drizzle-orm";
import type { Datenquelle } from "./abgleich.js";
import type { TerminEintrag } from "./rendern.js";
import { TERMIN_BEGINN } from "../termine/sicht.js";

// Die Termine für den Baustein «terminliste» (#549). Der Abgleich holt sie beim Erzeugen der Dateien, nie beim Abruf einer Seite: höchstens zwei Abfragen für alle Seiten und Bausteine, nie eine je Seite oder Termin.
// Was die öffentliche Seite zeigt:
// - ohne Gruppe: die kommenden Termine von Anlässen mit Sichtbarkeit «öffentlich»
// - mit Gruppe: die kommenden Termine, die an der Gruppe hängen (dieselben Daten zeigt die Stufenseite schon über die Stufenfelder)
// Beides nur für Termine mit Sichtbarkeit «eltern» und Status «aktiv»; «intern» und «leitende» erscheinen nie. Ein Termin steht in der Datei, bis der Abgleich das nächste Mal läuft (beim Veröffentlichen, bei Ereignissen, alle 10 Minuten).

type Zeile = {
  id: string;
  titel: string;
  von: string;
  bis: string;
  zeit_von: string | null;
  zeit_bis: string | null;
  ort: string | null;
  anlass_id: string | null;
  seite_id: string | null;
  stufen: string[];
  pool: string | null;
};

const zuEintrag = (z: Zeile): TerminEintrag => ({
  id: z.id,
  titel: z.titel,
  von: z.von,
  bis: z.bis,
  zeitVon: z.zeit_von,
  zeitBis: z.zeit_bis,
  ort: z.ort,
  stufen: z.stufen,
  anlassId: z.anlass_id,
  seiteId: z.seite_id,
});

// Tage und Zeiten kommen schon in Zürcher Zeit aus der Abfrage
const FELDER = sql`
  programm.id, programm.titel, programm.ort, anlass.id as anlass_id, anlass.seite_id,
  case when programm.ganztaegig then programm.tag_von::text else to_char(programm.beginn at time zone 'Europe/Zurich', 'YYYY-MM-DD') end as von,
  case when programm.ganztaegig then programm.tag_bis::text else to_char(coalesce(programm.ende, programm.beginn) at time zone 'Europe/Zurich', 'YYYY-MM-DD') end as bis,
  case when programm.ganztaegig then null else to_char(programm.beginn at time zone 'Europe/Zurich', 'HH24:MI') end as zeit_von,
  case when programm.ganztaegig or programm.ende is null then null else to_char(programm.ende at time zone 'Europe/Zurich', 'HH24:MI') end as zeit_bis,
  coalesce((select jsonb_agg(tag.name order by tag.name) from programm_tag join tag on tag.id = programm_tag.tag_id and tag.abteilung_id = programm.abteilung_id and tag.typ = 'stufe' where programm_tag.programm_id = programm.id), '[]'::jsonb) as stufen`;

const KOMMEND = sql`case when programm.ganztaegig then programm.tag_bis >= (now() at time zone 'Europe/Zurich')::date else programm.ende >= now() end`;

export const ladeTerminlisten: Datenquelle = async (
  db,
  abteilungId,
  _seitenIds,
  dokumente,
) => {
  const termine = new Map<string, TerminEintrag[]>();
  const listen: { id: string; tagId: string | undefined; anzahl: number }[] =
    [];
  for (const dok of dokumente?.values() ?? []) {
    for (const b of dok.bausteine) {
      if (b.typ === "terminliste") {
        listen.push({ id: b.id, tagId: b.daten.tagId, anzahl: b.daten.anzahl });
      }
    }
  }
  if (listen.length === 0) return { termine };
  const mehr = Math.max(...listen.map((l) => l.anzahl));

  const oeffentlich: TerminEintrag[] = [];
  if (listen.some((l) => l.tagId === undefined)) {
    const zeilen = await db.execute<Zeile>(sql`
      select ${FELDER}, null::uuid as pool
      from programm
      join anlass on anlass.programm_id = programm.id and anlass.abteilung_id = programm.abteilung_id
      where programm.abteilung_id = ${abteilungId} and programm.status = 'aktiv' and programm.sichtbarkeit = 'eltern'
        and anlass.sichtbarkeit = 'oeffentlich' and ${KOMMEND}
      order by ${TERMIN_BEGINN}, programm.id
      limit ${mehr}`);
    oeffentlich.push(...zeilen.map(zuEintrag));
  }

  const nachGruppe = new Map<string, TerminEintrag[]>();
  const tagIds = [
    ...new Set(listen.flatMap((l) => (l.tagId ? [l.tagId] : []))),
  ];
  if (tagIds.length > 0) {
    const ids: SQL = sql.join(
      tagIds.map((t) => sql`${t}::uuid`),
      sql`, `,
    );
    const zeilen = await db.execute<Zeile>(sql`
      select * from (
        select ${FELDER}, programm_tag.tag_id as pool,
          row_number() over (partition by programm_tag.tag_id order by ${TERMIN_BEGINN}, programm.id) as rn
        from programm
        join programm_tag on programm_tag.programm_id = programm.id and programm_tag.tag_id in (${ids})
        left join anlass on anlass.programm_id = programm.id and anlass.abteilung_id = programm.abteilung_id
        where programm.abteilung_id = ${abteilungId} and programm.status = 'aktiv' and programm.sichtbarkeit = 'eltern'
          and ${KOMMEND}
      ) t where rn <= ${mehr}
      order by pool, rn`);
    for (const z of zeilen) {
      const liste = nachGruppe.get(z.pool!) ?? [];
      liste.push(zuEintrag(z));
      nachGruppe.set(z.pool!, liste);
    }
  }

  for (const l of listen) {
    termine.set(
      l.id,
      (l.tagId ? (nachGruppe.get(l.tagId) ?? []) : oeffentlich).slice(
        0,
        l.anzahl,
      ),
    );
  }
  return { termine };
};

// Welche Seite zu welchem Anlass gehört (#560): eine Abfrage für alle Seiten des Laufs. Die Seite zeigt dann unter ihren Eckdaten die Schaltfläche zur Anmeldung.
// Nur Anlässe, die Besucher nach dem Anmelden sehen können («öffentlich» und «angemeldet»); die Anmeldung selbst prüft das Recht erneut
export const ladeAnlassSeiten: Datenquelle = async (
  db,
  abteilungId,
  seitenIds,
) => {
  const anlaesse = new Map<string, string>();
  if (seitenIds.length === 0) return { anlaesse };
  const ids: SQL = sql.join(
    seitenIds.map((s) => sql`${s}::uuid`),
    sql`, `,
  );
  const zeilen = await db.execute<{ id: string; seite_id: string }>(sql`
    select anlass.id, anlass.seite_id
    from anlass
    join programm on programm.id = anlass.programm_id and programm.status = 'aktiv'
    where anlass.abteilung_id = ${abteilungId} and anlass.seite_id in (${ids})
      and anlass.sichtbarkeit in ('oeffentlich', 'angemeldet')
    order by anlass.id`);
  for (const z of zeilen) anlaesse.set(z.seite_id, z.id);
  return { anlaesse };
};
