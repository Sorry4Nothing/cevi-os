import { and, eq, inArray, notInArray, sql as roh } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  auditLog,
  kategorieZuordnung,
  outlookAenderung,
  programm,
  programmTag,
  tag,
} from "../db/schema.js";
import { FEHLER, fehlerCodeVon, OutlookFehler } from "./fehler.js";
import type { OutlookDienst } from "./dienst.js";
import type { OutlookKalender } from "./graph.js";
import {
  berechneKategorien,
  gleicheKategorien,
  schluessel,
} from "./kategorien-regeln.js";

// Tags eines Termins in Cevi OS ändern und nach Outlook nachführen (#835). Reihenfolge: lokal speichern und die Änderung als «ausstehend» markieren (eine Transaktion), dann versuchen, nur das Feld categories des einen Termins in Outlook zu setzen. Die Markierung schützt den Termin vor dem Lese-Abgleich (kalender/tags-zuordnen.ts), bis der Feed die Änderung zeigt oder 24 Stunden vergangen sind.

export type OutlookStand = "aus" | "ausstehend" | "geschrieben";
export const SCHUTZ_STUNDEN = 24;

export class TerminFehlt extends Error {}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Termine, die in Cevi OS entstanden sind (Stufenseite ohne Kalender, «web:»), gibt es in Outlook nicht
const ausOutlook = (googleEventId: string) => !googleEventId.startsWith("web:");

// Ersetzt die Tags der Termine durch tagIds (die Route hat geprüft, dass sie zur Abteilung gehören). Ein Termin, der nicht zur Abteilung gehört, wirft TerminFehlt und lässt nichts zurück.
export async function setzeTerminTags(
  db: Db,
  dienst: OutlookDienst | undefined,
  {
    abteilungId,
    akteurId,
    terminIds,
    tagIds,
  }: {
    abteilungId: string;
    akteurId: string;
    terminIds: string[];
    tagIds: string[];
  },
): Promise<Map<string, OutlookStand>> {
  const ids = [...new Set(terminIds)];
  const verbunden = dienst ? (await dienst.fuer(abteilungId)) !== null : false;
  const stand = await db.transaction(async (tx) => {
    const termine = await tx
      .select({ id: programm.id, eventId: programm.googleEventId })
      .from(programm)
      .where(
        and(eq(programm.abteilungId, abteilungId), inArray(programm.id, ids)),
      );
    if (termine.length !== ids.length) throw new TerminFehlt();
    await ersetzeTags(tx, ids, tagIds);
    const markiert = verbunden
      ? termine.filter((t) => ausOutlook(t.eventId)).map((t) => t.id)
      : [];
    if (markiert.length > 0) {
      await tx
        .insert(outlookAenderung)
        .values(
          markiert.map((programmId) => ({ programmId, abteilungId, akteurId })),
        )
        .onConflictDoUpdate({
          target: outlookAenderung.programmId,
          set: {
            akteurId,
            geaendertAm: roh`now()`,
            geschriebenAm: null,
            versuche: 0,
            naechsterVersuch: roh`now()`,
            letzterFehler: null,
          },
        });
    }
    // Nur die Zahl der Tags, nie ein Titel
    await tx.insert(auditLog).values(
      ids.map((id) => ({
        abteilungId,
        akteurId,
        aktion: "termin_tags_geaendert",
        zielTyp: "programm",
        zielId: id,
        details: { tags: tagIds.length, outlook: markiert.includes(id) },
      })),
    );
    return new Map<string, OutlookStand>(
      ids.map((id) => [id, markiert.includes(id) ? "ausstehend" : "aus"]),
    );
  });
  // Ein einzelner Termin: gleich versuchen, ohne zu warten oder zu wiederholen; sonst holt der Lauf es nach
  if (ids.length === 1 && stand.get(ids[0]) === "ausstehend" && dienst) {
    const client = await dienst.fuer(abteilungId, "schnell");
    if (client && (await versucheSchreiben(db, client, ids[0])) === null) {
      stand.set(ids[0], "geschrieben");
    }
  }
  return stand;
}

async function ersetzeTags(tx: Tx, terminIds: string[], tagIds: string[]) {
  await tx
    .delete(programmTag)
    .where(
      tagIds.length > 0
        ? and(
            inArray(programmTag.programmId, terminIds),
            notInArray(programmTag.tagId, tagIds),
          )
        : inArray(programmTag.programmId, terminIds),
    );
  if (tagIds.length > 0) {
    await tx
      .insert(programmTag)
      .values(
        terminIds.flatMap((programmId) =>
          tagIds.map((tagId) => ({ programmId, tagId })),
        ),
      )
      .onConflictDoNothing();
  }
}

// Wie lange der Lauf zwischen zwei Versuchen wartet: 1, 2, 4 … Minuten, höchstens 6 Stunden; nie weniger, als Microsoft verlangt
export function wartezeitMs(versuche: number, wartenSek?: number) {
  const eigene = Math.min(2 ** Math.max(0, versuche - 1), 360) * 60_000;
  return Math.max(eigene, (wartenSek ?? 0) * 1000);
}

// Liest die Kategorien des Termins in Outlook und schreibt nur die Differenz (idempotent). Wirft OutlookFehler.
export async function schreibeTerminKategorien(
  db: Db,
  client: OutlookKalender,
  programmId: string,
): Promise<"geschrieben" | "unveraendert"> {
  const [p] = await db
    .select({
      abteilungId: programm.abteilungId,
      eventId: programm.googleEventId,
      serie: programm.googleSerie,
      beginn: programm.beginn,
      tagVon: programm.tagVon,
      akteurId: outlookAenderung.akteurId,
    })
    .from(programm)
    .leftJoin(outlookAenderung, eq(outlookAenderung.programmId, programm.id))
    .where(eq(programm.id, programmId));
  if (!p) throw new OutlookFehler(FEHLER.TERMIN_NICHT_GEFUNDEN);
  const [tags, abweichungsZeilen, sollZeilen] = await Promise.all([
    db
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(eq(tag.abteilungId, p.abteilungId)),
    db
      .select({
        kategorie: kategorieZuordnung.kategorie,
        tagId: kategorieZuordnung.tagId,
      })
      .from(kategorieZuordnung)
      .where(eq(kategorieZuordnung.abteilungId, p.abteilungId)),
    db
      .select({ tagId: programmTag.tagId })
      .from(programmTag)
      .where(eq(programmTag.programmId, programmId)),
  ]);
  const ereignis = await client.findeTermin({
    iCalUId: p.serie ?? p.eventId,
    serie: p.serie !== null,
    beginn: p.beginn,
    tagVon: p.tagVon,
  });
  if (!ereignis) throw new OutlookFehler(FEHLER.TERMIN_NICHT_GEFUNDEN);
  const { kategorien } = berechneKategorien({
    bestehend: ereignis.kategorien,
    sollTagIds: new Set(sollZeilen.map((z) => z.tagId)),
    tags,
    abweichungen: new Map(
      abweichungsZeilen.map((a) => [schluessel(a.kategorie), a.tagId]),
    ),
  });
  if (gleicheKategorien(kategorien, ereignis.kategorien)) return "unveraendert";
  await client.setzeTerminKategorien(ereignis.id, kategorien);
  // Wer und was, nie der Titel oder die Namen
  await db.insert(auditLog).values({
    abteilungId: p.abteilungId,
    akteurId: p.akteurId ?? "system",
    aktion: "outlook_termin_kategorien_geschrieben",
    zielTyp: "programm",
    zielId: programmId,
    details: { kategorien: kategorien.length },
  });
  return "geschrieben";
}

// Ein Versuch für einen Termin; der Ausgang landet in der Zeile (Backoff bei einem vorläufigen Fehler, Ende bei einem dauerhaften). null heisst: Outlook ist nachgeführt. Ein Fehler, der kein OutlookFehler ist (Code, Datenbank), wird geworfen.
export async function versucheSchreiben(
  db: Db,
  client: OutlookKalender,
  programmId: string,
  jetzt = new Date(),
): Promise<OutlookFehler | null> {
  try {
    await schreibeTerminKategorien(db, client, programmId);
    await db
      .update(outlookAenderung)
      .set({ geschriebenAm: jetzt, letzterFehler: null })
      .where(eq(outlookAenderung.programmId, programmId));
    return null;
  } catch (fehler) {
    if (!(fehler instanceof OutlookFehler)) throw fehler;
    const code = fehlerCodeVon(fehler);
    const f = fehler;
    if (f.dauerhaft && code !== FEHLER.ANMELDUNG_ABGELAUFEN) {
      // Wiederholen hilft nicht (Termin in Outlook nicht zu finden, abgelehnt): Die Markierung fällt weg, Outlook gewinnt beim nächsten Lesen
      await db
        .delete(outlookAenderung)
        .where(eq(outlookAenderung.programmId, programmId));
    } else {
      const [zeile] = await db
        .select({ versuche: outlookAenderung.versuche })
        .from(outlookAenderung)
        .where(eq(outlookAenderung.programmId, programmId));
      const versuche = (zeile?.versuche ?? 0) + 1;
      await db
        .update(outlookAenderung)
        .set({
          versuche,
          naechsterVersuch: new Date(
            jetzt.getTime() + wartezeitMs(versuche, f.wartenSek),
          ),
          letzterFehler: code,
        })
        .where(eq(outlookAenderung.programmId, programmId));
    }
    return fehler;
  }
}
