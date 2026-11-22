import { and, eq, ne } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "../db/client.js";
import { user } from "../db/schema.js";
import { log } from "../log.js";
import { sendePush, type Fcm } from "../push.js";
import { aktivesKonto } from "../rechte.js";
import { TERMINE_PUSH_ARTEN } from "./push-arten.js";

// Der Text ist fest: Der Push steht je nach Handy auf dem gesperrten Bildschirm, darum nie der Titel des Vorschlags und kein Name
const TEXT = "Ein Vorschlag wartet auf deinen Entscheid.";

// Push «termin_vorschlag» an alle aktiven Konten der Abteilungsleitung (Admins) der Abteilung des Vorschlags, ausser der vorschlagenden Person selbst. Nach dem Commit aufrufen. Wirft nie; ohne Fcm geht nichts hinaus und die Abfrage entfällt. Eine Abfrage für die Empfänger, dann die von sendePush
export async function pushNeuerVorschlag(
  { db, fcm, c }: { db: Db; fcm?: Fcm; c?: Context },
  {
    abteilungId,
    vorschlagId,
    vonId,
  }: {
    abteilungId: string;
    vorschlagId: string;
    vonId: string;
  },
): Promise<void> {
  if (!fcm) return;
  try {
    const empfaenger = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          aktivesKonto(abteilungId),
          eq(user.role, "admin"),
          ne(user.id, vonId),
        ),
      );
    if (empfaenger.length === 0) return;
    await sendePush(
      { db, fcm, c },
      empfaenger.map((e) => e.id),
      {
        typ: "termin_vorschlag",
        id: vorschlagId,
        titel: TERMINE_PUSH_ARTEN.termin_vorschlag.titel,
        text: TEXT,
      },
    );
  } catch {
    // Nur die Tatsache, nie die Meldung: Drizzles message trägt die SQL-Parameter
    log(c, { ereignis: "push" });
  }
}
