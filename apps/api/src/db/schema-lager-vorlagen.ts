import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { abteilung, user } from "./schema.js";
import { lager } from "./schema-lager.js";

// Private To-dos und Vorlagen des Lagers (#376). Eigene Datei, damit sich die Lager-Issues nicht in schema-lager.ts begegnen

// Ein privates To-do: Nur die Person selbst liest und schreibt es, auch die Lagerleitung und die Abteilungsleitung sehen es nie. Ohne Sync-Kern, Feed und Version (nichts davon ist für andere bestimmt); jede Anweisung wiederholt dasselbe Ergebnis. Hart gelöscht, weil rein persönlich. Fällt mit dem Konto und dem Lager weg
export const todoPrivat = pgTable(
  "todo_privat",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    erledigt: boolean("erledigt").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("todo_privat_liste_idx").on(
      t.lagerId,
      t.personId,
      t.reihenfolge,
      t.id,
    ),
    index("todo_privat_person_idx").on(t.personId),
    check(
      "todo_privat_text_check",
      sql`char_length(${t.text}) between 1 and 500 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

export const VORLAGE_ARTEN = ["aufgaben", "packliste"] as const;

// Eine Vorlage gehört der Abteilung, nicht einem Lager. Der Inhalt ist je Art ein Objekt (zod-Schema in lager/vorlagen.ts), Fristen stehen als Tage relativ zum Lagerbeginn. Nur die Abteilungsleitung ändert Vorlagen; das Anwenden schreibt Zeilen im Lager über den Sync-Kern und lässt von der Vorlage nichts zurück
export const vorlage = pgTable(
  "vorlage",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    art: text("art", { enum: VORLAGE_ARTEN }).notNull(),
    name: text("name").notNull(),
    inhalt: jsonb("inhalt").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    erstelltVon: uuid("erstellt_von").references(() => user.id, {
      onDelete: "set null",
    }),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    geaendertVon: uuid("geaendert_von").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    unique("vorlage_name_uq").on(t.abteilungId, t.art, t.name),
    check("vorlage_art_check", sql`${t.art} in ('aufgaben', 'packliste')`),
    check(
      "vorlage_inhalt_check",
      sql`char_length(${t.name}) between 1 and 100 and jsonb_typeof(${t.inhalt}) = 'object'`,
    ),
  ],
);
