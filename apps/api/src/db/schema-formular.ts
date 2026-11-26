import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, seite, seiteVersion, user } from "./schema.js";

// Antworten auf den Baustein «formular» (#819). Die Definition des Formulars steht im Dokument der Seite (seite_version.inhalt); hier liegen nur die Antworten.
// formular_id ist die ID des Bausteins im Dokument; version_id die Version der Seite, die zur Zeit der Antwort veröffentlicht war: Daraus liest die Verwaltung die Beschriftungen, mit denen die Antwort entstand (spätere Änderungen am Formular machen sie nicht kaputt).
// «antworten» ist ein JSON-Objekt mit den Feld-IDs als Schlüssel. Mit dem Konto verschwindet nur die Zuordnung (user_id wird leer), die Antwort bleibt anonym. Fällt die Seite weg, fallen ihre Antworten mit.
// loeschen_am: Die Frist des Formulars zum Zeitpunkt der Antwort; ein täglicher Lauf löscht danach.
// stand (#881): wie weit die Verwaltung die Antwort bearbeitet hat (neu, in Bearbeitung, erledigt); nur die Verwaltung setzt ihn
export const FORMULAR_STAENDE = ["neu", "in_bearbeitung", "erledigt"] as const;
export type FormularStand = (typeof FORMULAR_STAENDE)[number];
export const formularAntwort = pgTable(
  "formular_antwort",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    seiteId: uuid("seite_id")
      .notNull()
      .references(() => seite.id, { onDelete: "cascade" }),
    formularId: uuid("formular_id").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => seiteVersion.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    antworten: jsonb("antworten").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    loeschenAm: timestamp("loeschen_am", { withTimezone: true }).notNull(),
    stand: text("stand", { enum: FORMULAR_STAENDE }).notNull().default("neu"),
  },
  (t) => [
    // Liste der Verwaltung: je Formular, neueste zuerst (uuidv7 ist nach Zeit geordnet)
    index("formular_antwort_formular_idx").on(t.formularId, t.id),
    index("formular_antwort_abteilung_idx").on(t.abteilungId),
    index("formular_antwort_seite_idx").on(t.seiteId),
    index("formular_antwort_user_idx").on(t.userId),
    index("formular_antwort_loeschen_idx").on(t.loeschenAm),
    check(
      "formular_antwort_stand_check",
      sql`${t.stand} in ('neu', 'in_bearbeitung', 'erledigt')`,
    ),
    check(
      "formular_antwort_antworten_check",
      sql`jsonb_typeof(${t.antworten}) = 'object' and octet_length(${t.antworten}::text) <= 20000`,
    ),
  ],
);
