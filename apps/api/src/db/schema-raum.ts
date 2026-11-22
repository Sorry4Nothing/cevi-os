import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, tag } from "./schema.js";

// Räume der Abteilung (#446, Epic #430). Die Raumanfragen (#447) kommen mit ihrer eigenen Migration dazu.
export const raum = pgTable(
  "raum",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ort: text("ort"),
    beschreibung: text("beschreibung"),
    kapazitaet: integer("kapazitaet"),
    // Das zuständige Team (#447 entscheidet über Anfragen); fällt der Tag weg, bleibt der Raum ohne Team
    teamTagId: uuid("team_tag_id").references(() => tag.id, {
      onDelete: "set null",
    }),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Zugleich der Index der Liste (sortiert nach lower(name)); der Name ist je Abteilung eindeutig, ohne Gross-/Kleinschreibung
    uniqueIndex("raum_name_eindeutig").on(t.abteilungId, sql`lower(${t.name})`),
    index("raum_team_tag_idx").on(t.teamTagId),
    check("raum_name_check", sql`char_length(${t.name}) between 1 and 100`),
    check("raum_ort_check", sql`char_length(${t.ort}) between 1 and 200`),
    check(
      "raum_beschreibung_check",
      sql`char_length(${t.beschreibung}) between 1 and 1000`,
    ),
    check("raum_kapazitaet_check", sql`${t.kapazitaet} between 1 and 1000`),
  ],
);
