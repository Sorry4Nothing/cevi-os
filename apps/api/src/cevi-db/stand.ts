import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ceviDbEinstellung } from "../db/schema.js";

// Hält den Stand des letzten Abrufs fest (Verwaltung > System > Cevi-Datenbank): Zeitpunkt, Ausgang und Zahl der Personen, nie Namen oder Fehlertexte
export const speichereStand =
  (db: Db) =>
  async (
    abteilungId: string,
    stand: { ok: boolean; anzahl: number | null },
  ) => {
    const werte = {
      letzterAbrufAm: sql`now()`,
      letzterStatus: stand.ok ? "ok" : "fehler",
      anzahlPersonen: stand.anzahl,
    };
    await db
      .insert(ceviDbEinstellung)
      .values({ abteilungId, ...werte })
      .onConflictDoUpdate({
        target: ceviDbEinstellung.abteilungId,
        set: werte,
      });
  };
