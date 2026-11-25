import { eq, inArray, sql as roh } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  kategorieZuordnung,
  outlookAenderung,
  programmTag,
  tag,
} from "../db/schema.js";
import { SCHUTZ_STUNDEN } from "../outlook/termin-tags.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const schluessel = (name: string) => name.trim().toLowerCase();

// Ordnet die Kategorien dem Tag zu: erst eine Abweichung aus kategorie_zuordnung, sonst der Tag mit gleichem Namen
// (getrimmt, ohne Gross-/Kleinschreibung). Eine unbekannte Kategorie ergibt keinen Tag
export function tagsFuerKategorien(
  kategorien: string[],
  abweichungen: Map<string, string>,
  tagsNachName: Map<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const kategorie of kategorien) {
    const id =
      abweichungen.get(schluessel(kategorie)) ??
      tagsNachName.get(schluessel(kategorie));
    if (id) ids.add(id);
  }
  return [...ids];
}

// Berechnet programm_tag der Programme neu und schreibt nur den Unterschied. Übergangsregel (#449): Ein Termin ohne eine einzige Kategorie, die einem Tag entspricht,
// behält seine vorhandenen Zeilen (aus der Migration 0126 oder früher gesetzt); erst eine zuordenbare Kategorie ersetzt sie, dann gewinnen die Kategorien. Je Lauf und Abteilung drei Abfragen
// (Tags, Abweichungen, bisherige Zeilen) und höchstens ein Löschen und ein Einfügen, unabhängig von der Zahl der Termine.
// Eine geänderte Zuordnung oder ein umbenannter Tag wirkt so beim nächsten Lauf
export async function ordneTagsZu(
  tx: Tx,
  abteilungId: string,
  programme: { id: string; kategorien: string[] }[],
) {
  if (programme.length === 0) return;
  const tags = await tx
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(eq(tag.abteilungId, abteilungId));
  const abweichungen = await tx
    .select({
      kategorie: kategorieZuordnung.kategorie,
      tagId: kategorieZuordnung.tagId,
    })
    .from(kategorieZuordnung)
    .where(eq(kategorieZuordnung.abteilungId, abteilungId));
  const bisher = await tx
    .select({ programmId: programmTag.programmId, tagId: programmTag.tagId })
    .from(programmTag)
    .where(
      inArray(
        programmTag.programmId,
        programme.map((p) => p.id),
      ),
    );
  const tagsNachName = new Map(tags.map((t) => [schluessel(t.name), t.id]));
  const nachKategorie = new Map(
    abweichungen.map((a) => [schluessel(a.kategorie), a.tagId]),
  );
  const vorhanden = new Set(bisher.map((z) => `${z.programmId} ${z.tagId}`));

  // Tags, die Cevi OS selbst geändert hat und die der Feed noch nicht zeigt (#835), dürfen nicht zurückgeschrieben werden: Zeigt der Feed dasselbe, ist die Änderung bestätigt und der Schutz endet; nach SCHUTZ_STUNDEN endet er auch ohne Bestätigung (Outlook gewinnt)
  const geschuetzt = new Map(
    (
      await tx
        .select({
          programmId: outlookAenderung.programmId,
          geaendertAm: outlookAenderung.geaendertAm,
        })
        .from(outlookAenderung)
        .where(
          inArray(
            outlookAenderung.programmId,
            programme.map((p) => p.id),
          ),
        )
    ).map((z) => [z.programmId, z.geaendertAm]),
  );
  const schutzEnde: string[] = [];

  const neu: { programmId: string; tagId: string }[] = [];
  const soll = new Set<string>();
  const neuBerechnet = new Set<string>();
  for (const p of programme) {
    const ids = tagsFuerKategorien(p.kategorien, nachKategorie, tagsNachName);
    const seit = geschuetzt.get(p.id);
    if (seit !== undefined) {
      const lokal = bisher.filter((z) => z.programmId === p.id);
      const gleich =
        lokal.length === ids.length &&
        lokal.every((z) => ids.includes(z.tagId));
      const abgelaufen =
        Date.now() - seit.getTime() > SCHUTZ_STUNDEN * 3_600_000;
      if (gleich || abgelaufen) schutzEnde.push(p.id);
      else continue;
    }
    if (ids.length === 0) continue;
    neuBerechnet.add(p.id);
    for (const tagId of ids) {
      soll.add(`${p.id} ${tagId}`);
      if (!vorhanden.has(`${p.id} ${tagId}`))
        neu.push({ programmId: p.id, tagId });
    }
  }
  const weg = bisher.filter(
    (z) =>
      neuBerechnet.has(z.programmId) && !soll.has(`${z.programmId} ${z.tagId}`),
  );

  if (schutzEnde.length > 0) {
    await tx
      .delete(outlookAenderung)
      .where(inArray(outlookAenderung.programmId, schutzEnde));
  }
  if (weg.length > 0) {
    await tx.delete(programmTag).where(
      roh`(${programmTag.programmId}, ${programmTag.tagId}) in (${roh.join(
        weg.map((z) => roh`(${z.programmId}::uuid, ${z.tagId}::uuid)`),
        roh`, `,
      )})`,
    );
  }
  if (neu.length > 0) await tx.insert(programmTag).values(neu);
}
