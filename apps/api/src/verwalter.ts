import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { abteilung, user } from "./db/schema.js";
import { istAbteilungsleitungSql } from "./admins.js";

// Ein Verwalter ist eine aktive Person mit Abteilungsleitung oder ein aktiver Entwickler im Konto der Abteilung (#731). Der Entwickler zählt, weil er die Abteilungsleitung per Kommandozeile neu vergeben kann
export type Verwalter = { id: string; entwickler: boolean };

const istEntwicklerSql = sql<boolean>`exists (select 1 from plattform_entwickler e where e.user_id = ${user.id})`;

// Serialisiert das Entfernen von Verwaltern einer Abteilung (#18): erst die Abteilungszeile sperren, dann zählen.
// Zwei Statements, weil unter READ COMMITTED nur ein nach dem Warten gestartetes Statement den fremden Commit sieht.
// «no key update» statt «for update»: Fremdschlüssel-Prüfungen anderer Verbindungen nehmen «key share» und warteten sonst
export async function aktiveVerwalter(
  tx: Pick<Db, "select">,
  abteilungId: string,
): Promise<Verwalter[]> {
  await tx
    .select({ id: abteilung.id })
    .from(abteilung)
    .where(eq(abteilung.id, abteilungId))
    .for("no key update");
  return tx
    .select({ id: user.id, entwickler: istEntwicklerSql })
    .from(user)
    .where(
      and(
        eq(user.abteilungId, abteilungId),
        // banned ist nullable, «is not true» zählt auch null als aktiv
        sql`${user.banned} is not true`,
        isNull(user.deaktiviertAm),
        or(istAbteilungsleitungSql(user.id), istEntwicklerSql),
      ),
    );
}

// Das Ziel ist Verwalter und nach der Aktion bleibt keine aktive Person übrig. Beim Entziehen nur der Abteilungsleitung (nurAbteilungsleitung) bleibt das Ziel, wenn es auch Entwickler ist
export function istLetzterVerwalter(
  verwalter: readonly Verwalter[],
  zielId: string,
  nurAbteilungsleitung = false,
) {
  const rest = verwalter.filter(
    (v) => v.id !== zielId || (nurAbteilungsleitung && v.entwickler),
  );
  return rest.length === 0 && verwalter.some((v) => v.id === zielId);
}

// Der Text und Code, den die Apps kennen (fehlertexte.ts); die Verwaltung antwortet damit
export const LETZTE_ABTEILUNGSLEITUNG = {
  code: "LETZTE_ABTEILUNGSLEITUNG",
  message:
    "Die Abteilung braucht mindestens eine aktive Person der Abteilungsleitung oder einen aktiven Entwickler.",
} as const;
