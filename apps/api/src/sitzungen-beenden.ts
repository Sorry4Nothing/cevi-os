import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { session, user } from "./db/schema.js";

// Beendet Sitzungen sofort; Konten, Passwörter und zweite Faktoren bleiben. Der Ablauf bei einer Datenpanne (docs/betrieb.md) ruft sie über die Kommandozeile (alle Abteilungen) oder über die Informationssperre (#425, nur eine Abteilung) auf.
// abteilungId: nur die Sitzungen dieser Abteilung; ausser: eine Sitzung, die bleibt (die der Person, die sperrt, damit sie die Sperre wieder aufheben kann)
export async function beendeSitzungen(
  db: Db,
  { abteilungId, ausser }: { abteilungId?: string; ausser?: string } = {},
) {
  const beendet = await db
    .delete(session)
    .where(
      and(
        abteilungId === undefined
          ? undefined
          : inArray(
              session.userId,
              // Unterabfrage statt Liste: eine Abfrage, auch bei vielen Personen
              db
                .select({ id: user.id })
                .from(user)
                .where(eq(user.abteilungId, abteilungId)),
            ),
        ausser === undefined ? undefined : ne(session.id, ausser),
      ),
    )
    .returning({ id: session.id });
  return beendet.length;
}
