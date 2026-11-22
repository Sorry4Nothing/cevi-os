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

// Fester Text je Entscheid, nie der Titel des Vorschlags und nie die Begründung (sie steht in der App im Vorschlag)
const ENTSCHEID_TEXT = {
  freigegeben: "Dein Vorschlag ist freigegeben.",
  abgelehnt: "Dein Vorschlag ist abgelehnt.",
} as const;

// Push «termin_entscheid» an die vorschlagende Person, nur wenn ihr Konto noch aktiv ist. Nach dem Commit aufrufen. Wirft nie; ohne Fcm entfällt alles. Eine Abfrage für das Konto, dann die von sendePush
export async function pushEntscheid(
  { db, fcm, c }: { db: Db; fcm?: Fcm; c?: Context },
  {
    abteilungId,
    vorschlagId,
    vonId,
    entscheid,
  }: {
    abteilungId: string;
    vorschlagId: string;
    vonId: string | null;
    entscheid: keyof typeof ENTSCHEID_TEXT;
  },
): Promise<void> {
  if (!fcm || !vonId) return;
  try {
    const [konto] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(aktivesKonto(abteilungId), eq(user.id, vonId)));
    if (!konto) return;
    await sendePush({ db, fcm, c }, [konto.id], {
      typ: "termin_entscheid",
      id: vorschlagId,
      titel: TERMINE_PUSH_ARTEN.termin_entscheid.titel,
      text: ENTSCHEID_TEXT[entscheid],
    });
  } catch {
    // Nur die Tatsache, nie die Meldung: Drizzles message trägt die SQL-Parameter
    log(c, { ereignis: "push" });
  }
}
