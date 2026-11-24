import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { user } from "./schema.js";

// Persönlicher ICS-Link (Epic #430, TC1 #437). Gespeichert wird nur der SHA-256-Hash des Tokens (256 Bit Zufall, ein Passwort-Hash ist nicht nötig) und die letzten vier Zeichen für die Anzeige. Höchstens ein aktiver Token je Person; ein widerrufener bleibt 30 Tage als Zeile stehen
export const kalenderToken = pgTable(
  "kalender_token",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    endung: text("endung").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Schreibt der Feed (#438) höchstens einmal je Stunde (pruefeToken)
    zuletztAbgerufenAm: timestamp("zuletzt_abgerufen_am", {
      withTimezone: true,
    }),
    widerrufenAm: timestamp("widerrufen_am", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("kalender_token_aktiv_je_person")
      .on(t.userId)
      .where(sql`${t.widerrufenAm} is null`),
  ],
);
