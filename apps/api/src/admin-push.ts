import { and, eq, ne, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "./db/client.js";
import { user } from "./db/schema.js";
import { log } from "./log.js";
import { type Fcm, sendePush } from "./push.js";
import type { Person } from "./rechte.js";

// Nur die Aktion, nie Namen, Benutzernamen, Stufen oder Abteilung: Eine Stufe kann auf eine Person zeigen
export const ADMIN_PUSH_TITEL = {
  startpasswort_neu: "Ein Admin hat ein neues Startpasswort erstellt",
  admin_vergeben: "Ein Admin hat einer Person die Rolle Admin gegeben",
  stufenleitung_vergeben:
    "Ein Admin hat einer Person die Rolle Stufenleitung gegeben",
  zweiter_faktor_zurueckgesetzt:
    "Ein Admin hat einen zweiten Faktor zurückgesetzt",
  person_geloescht: "Ein Admin hat eine Person gelöscht",
} as const;

// Nach dem Commit der Aktion aufrufen; wirft nie: Ein Fehler hier darf die Aktion nicht wiederholen lassen
export async function pushAnAndereAdmins(
  { db, fcm, c }: { db: Db; fcm?: Fcm; c?: Context },
  akteur: Pick<Person, "id" | "abteilungId">,
  zielId: string,
  aktion: keyof typeof ADMIN_PUSH_TITEL,
): Promise<void> {
  let admins: { id: string }[];
  try {
    // Wie aktiveAdminIds, aber ohne Sperre: Nach dem Commit gibt es nichts mehr zu serialisieren
    admins = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.abteilungId, akteur.abteilungId),
          eq(user.role, "admin"),
          sql`${user.banned} is not true`,
          ne(user.id, akteur.id),
        ),
      );
  } catch (fehler) {
    log(c, { ereignis: "push", code: (fehler as { code?: unknown }).code });
    return;
  }
  if (admins.length === 0) return;
  await sendePush(
    { db, fcm, c },
    admins.map(({ id }) => id),
    { typ: "person", id: zielId, titel: ADMIN_PUSH_TITEL[aktion] },
  );
}
