import { type AnyColumn, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { abteilungsleitungPerson } from "./db/schema.js";

// Ob das Konto zur Abteilungsleitung gehört, als Ausdruck für Auswahlen und Bedingungen. Die Quelle ist allein die Tabelle abteilungsleitung_person (#720)
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
