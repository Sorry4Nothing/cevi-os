import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, programm, tag } from "./schema.js";

// Termine (#432): Die Kategorien eines Outlook-Termins ergeben Tags. Ein Termin ohne Zeile hier ist für niemanden sichtbar
// (seit #449 gilt das auch für die Stufen: «kein Stufen-Tag» heisst «keine Stufe», nicht mehr «alle Stufen»). Geschrieben wird vom Kalender-Abgleich und, für Abteilungen ohne Kalender, vom gepflegten Stufenprogramm (website/stufenprogramm.ts)
export const programmTag = pgTable(
  "programm_tag",
  {
    programmId: uuid("programm_id")
      .notNull()
      .references(() => programm.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.programmId, t.tagId] }),
    index("programm_tag_tag_id_idx").on(t.tagId),
  ],
);

// Abweichung von der Vorgabe «Kategorie heisst wie der Tag»: Diese Kategorie meint diesen Tag
export const kategorieZuordnung = pgTable(
  "kategorie_zuordnung",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    kategorie: text("kategorie").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("kategorie_zuordnung_kategorie_eindeutig").on(
      t.abteilungId,
      sql`lower(${t.kategorie})`,
    ),
  ],
);
