import { type AnyColumn, and, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { abteilung, abteilungsleitungPerson, user } from "./db/schema.js";

// Ob das Konto zur Abteilungsleitung gehört, als Ausdruck für Auswahlen und Bedingungen. Die Quelle ist allein die Tabelle abteilungsleitung_person, nie user.role (#720)
export const istAbteilungsleitungSql = (userId: AnyColumn) =>
  sql<boolean>`exists (select 1 from ${abteilungsleitungPerson} where ${abteilungsleitungPerson.userId} = ${userId})`;

export async function istAbteilungsleitung(
  db: Pick<Db, "select">,
  userId: string,
) {
  const [zeile] = await db
    .select({ id: abteilungsleitungPerson.userId })
    .from(abteilungsleitungPerson)
    .where(eq(abteilungsleitungPerson.userId, userId));
  return zeile !== undefined;
}

// Serialisiert das Entfernen von der Abteilungsleitung einer Abteilung (#18): erst die Abteilungszeile sperren, dann zählen.
// Zwei Statements, weil unter READ COMMITTED nur ein nach dem Warten gestartetes Statement den fremden Commit sieht.
// «no key update» statt «for update»: Fremdschlüssel-Prüfungen anderer Verbindungen nehmen «key share» und warteten sonst
export async function aktiveAdminIds(
  tx: Pick<Db, "select">,
  abteilungId: string,
) {
  await tx
    .select({ id: abteilung.id })
    .from(abteilung)
    .where(eq(abteilung.id, abteilungId))
    .for("no key update");
  const zeilen = await tx
    .select({ id: user.id })
    .from(user)
    .innerJoin(
      abteilungsleitungPerson,
      eq(abteilungsleitungPerson.userId, user.id),
    )
    .where(
      and(
        eq(user.abteilungId, abteilungId),
        // banned ist nullable, «is not true» zählt auch null als aktiv
        sql`${user.banned} is not true`,
      ),
    );
  return zeilen.map((zeile) => zeile.id);
}

// Ziel gelistet und keine zweite aktive ID der Abteilungsleitung: die letzte Abteilungsleitung bleibt
export function istLetzterAdmin(admins: readonly string[], zielId: string) {
  return admins.includes(zielId) && !admins.some((id) => id !== zielId);
}

// Der Text, den die App kennt (fehlertexte.ts); die Verwaltung antwortet damit
export const LETZTER_ADMIN = {
  code: "LETZTER_ADMIN",
  message: "Die letzte Abteilungsleitung lässt sich nicht entfernen.",
} as const;
