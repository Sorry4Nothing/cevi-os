import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { abteilung } from "./schema.js";

// Einstellung der Cevi-Datenbank je Abteilung (#691). Token und Adresse stehen nie hier, nur in der Umgebung (CEVI_DB_URL, CEVI_DB_TOKEN). Gespeichert sind die Gruppe (Ebene) der Abteilung und der Stand des letzten Abrufs; ohne Zeile ist nichts eingestellt.
export const ceviDbEinstellung = pgTable(
  "cevi_db_einstellung",
  {
    abteilungId: uuid("abteilung_id")
      .primaryKey()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    // Nummer der Gruppe (Ebene) in der Cevi-Datenbank, zum Prüfen der Verbindung; null = nicht gesetzt
    gruppeId: text("gruppe_id"),
    letzterAbrufAm: timestamp("letzter_abruf_am", { withTimezone: true }),
    // «ok» oder «fehler»; nie ein Fehlertext
    letzterStatus: text("letzter_status"),
    anzahlPersonen: integer("anzahl_personen"),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "cevi_db_einstellung_gruppe_check",
      sql`${t.gruppeId} is null or ${t.gruppeId} ~ '^[0-9]{1,20}$'`,
    ),
    check(
      "cevi_db_einstellung_status_check",
      sql`${t.letzterStatus} is null or ${t.letzterStatus} in ('ok', 'fehler')`,
    ),
  ],
);
