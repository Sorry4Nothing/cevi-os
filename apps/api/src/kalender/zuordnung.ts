import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, programm, programmStufe, stufe } from "../db/schema.js";

// Akteur der automatischen Zuordnung im Audit-Log; Personen tragen ihre UUID
export const AKTEUR_SYSTEM = "system";
const AKTION = "programm_zugeordnet";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type StufeRef = { id: string; name: string; kuerzel: string };

// Annahmen der Regel (im PR zur Prüfung durch die Abteilung festgehalten):
// - Das eigene Wort «Stufen» im Titel (Gross- und Kleinschreibung egal) meint alle Stufen der Abteilung.
// - Sonst gilt jede Stufe, deren Name oder Kürzel als ganzes Wort im Titel steht; mehrere Treffer ergeben mehrere Stufen.
// - Zugeordnet ist ein Termin für Eltern sichtbar; ohne Treffer bleibt er unzugeordnet und intern (fail-closed).
// Ganzes Wort heisst: Vor und nach dem Namen steht kein Buchstabe und keine Ziffer.
const wortRegex = (wort: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${wort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
const ALLE_STUFEN = wortRegex("Stufen");

export function stufenFuerTitel(titel: string, stufen: StufeRef[]): string[] {
  if (ALLE_STUFEN.test(titel)) return stufen.map((s) => s.id);
  return stufen
    .filter(
      (s) =>
        (s.name.trim() !== "" && wortRegex(s.name.trim()).test(titel)) ||
        (s.kuerzel.trim() !== "" && wortRegex(s.kuerzel.trim()).test(titel)),
    )
    .map((s) => s.id);
}

const gleich = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

// Ordnet die Programme nach dem Titel zu. Eine Zuordnung von Hand (Audit-Eintrag einer Person) und ein Zustand,
// den weder der Standard noch die Automatik gesetzt hat, bleiben unberührt. Jedes andere Programm rechnet die Automatik bei jedem Lauf neu,
// folgt also einem neuen Titel oder einem umbenannten Stufennamen; ohne Änderung schreibt sie nichts.
export async function ordneAutomatischZu(
  tx: Tx,
  abteilungId: string,
  programmIds: string[],
) {
  if (programmIds.length === 0) return;
  const stufen = await tx
    .select({ id: stufe.id, name: stufe.name, kuerzel: stufe.kuerzel })
    .from(stufe)
    .where(eq(stufe.abteilungId, abteilungId));
  const programme = await tx
    .select({
      id: programm.id,
      titel: programm.titel,
      sichtbarkeit: programm.sichtbarkeit,
    })
    .from(programm)
    .where(
      and(
        eq(programm.abteilungId, abteilungId),
        inArray(programm.id, programmIds),
      ),
    );
  const zuordnungen = await tx
    .select({
      programmId: programmStufe.programmId,
      stufeId: programmStufe.stufeId,
    })
    .from(programmStufe)
    .where(inArray(programmStufe.programmId, programmIds));
  const audit = await tx
    .select({ zielId: auditLog.zielId, akteurId: auditLog.akteurId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.abteilungId, abteilungId),
        eq(auditLog.zielTyp, "programm"),
        eq(auditLog.aktion, AKTION),
        inArray(auditLog.zielId, programmIds),
      ),
    );
  const vonHand = new Set(
    audit.filter((a) => a.akteurId !== AKTEUR_SYSTEM).map((a) => a.zielId),
  );
  const vomSystem = new Set(
    audit.filter((a) => a.akteurId === AKTEUR_SYSTEM).map((a) => a.zielId),
  );

  for (const p of programme) {
    if (vonHand.has(p.id)) continue;
    const vorher = zuordnungen
      .filter((z) => z.programmId === p.id)
      .map((z) => z.stufeId);
    const istStandard = vorher.length === 0 && p.sichtbarkeit === "intern";
    // Weder Standard noch von der Automatik gesetzt: Jemand hat es ausserhalb der API geändert, das gilt als von Hand
    if (!istStandard && !vomSystem.has(p.id)) continue;

    const nachher = stufenFuerTitel(p.titel, stufen);
    const sichtbarkeit = nachher.length > 0 ? "eltern" : "intern";
    const stufenAendern = !gleich(vorher, nachher);
    const sichtbarkeitAendern = sichtbarkeit !== p.sichtbarkeit;
    if (!stufenAendern && !sichtbarkeitAendern) continue;

    const entfernt = vorher.filter((s) => !nachher.includes(s));
    const neu = nachher.filter((s) => !vorher.includes(s));
    if (entfernt.length > 0) {
      await tx
        .delete(programmStufe)
        .where(
          and(
            eq(programmStufe.programmId, p.id),
            inArray(programmStufe.stufeId, entfernt),
          ),
        );
    }
    if (neu.length > 0) {
      await tx
        .insert(programmStufe)
        .values(neu.map((stufeId) => ({ programmId: p.id, stufeId })));
    }
    if (sichtbarkeitAendern) {
      await tx
        .update(programm)
        .set({ sichtbarkeit })
        .where(eq(programm.id, p.id));
    }
    // Wie bei der Zuordnung von Hand: nur geänderte Schlüssel, ohne Personendaten
    const details: Record<string, unknown> = {};
    if (stufenAendern) details.stufen = [...nachher].sort();
    if (sichtbarkeitAendern) details.sichtbarkeit = sichtbarkeit;
    await tx.insert(auditLog).values({
      abteilungId,
      akteurId: AKTEUR_SYSTEM,
      aktion: AKTION,
      zielTyp: "programm",
      zielId: p.id,
      details,
    });
  }
}
