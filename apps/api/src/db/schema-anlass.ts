import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, programm, seite, user } from "./schema.js";

// Anlässe der Termine (#442, Epic #430): Ein Anlass ist ein Termin (programm) mit Anmeldung. Die Anmeldungen kommen mit #443 in diese Datei.
// Dass die Tag-IDs in sichtbarkeit_tags zur Abteilung gehören, prüft die Route (wie bei der Seite); ein gelöschter Tag lässt eine tote ID, die nie passt (#333)
export const anlass = pgTable(
  "anlass",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    // Ein Termin hat höchstens einen Anlass; fällt der Termin weg (gepflegtes Stufenprogramm), fällt der Anlass mit
    programmId: uuid("programm_id")
      .notNull()
      .references(() => programm.id, { onDelete: "cascade" }),
    // «lager» legt das Lager-Modul an (#363); die Route für Anlässe setzt nur «anlass»
    art: text("art", { enum: ["anlass", "lager"] })
      .notNull()
      .default("anlass"),
    anmeldungOffen: boolean("anmeldung_offen").notNull().default(false),
    frist: timestamp("frist", { withTimezone: true }),
    anmeldungFuer: text("anmeldung_fuer", {
      enum: ["kind", "person"],
    }).notNull(),
    sichtbarkeit: text("sichtbarkeit", {
      enum: ["oeffentlich", "angemeldet", "tags"],
    }).notNull(),
    sichtbarkeitTags: uuid("sichtbarkeit_tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Die Anlassseite der Website (Entwurf); sie bleibt, wenn der Anlass gelöscht wird
    seiteId: uuid("seite_id").references(() => seite.id, {
      onDelete: "set null",
    }),
    erstelltVon: uuid("erstellt_von").references(() => user.id, {
      onDelete: "set null",
    }),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("anlass_programm_eindeutig").on(t.programmId),
    index("anlass_abteilung_idx").on(t.abteilungId),
    index("anlass_seite_idx").on(t.seiteId),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check("anlass_art_check", sql`${t.art} in ('anlass', 'lager')`),
    check(
      "anlass_anmeldung_fuer_check",
      sql`${t.anmeldungFuer} in ('kind', 'person')`,
    ),
    check(
      "anlass_sichtbarkeit_check",
      sql`${t.sichtbarkeit} in ('oeffentlich', 'angemeldet', 'tags')`,
    ),
  ],
);

// Ein Zusatzfeld der Anmeldung. Schlüssel und Typ bleiben fest, sobald es Antworten gibt (die Route prüft es). Gesundheitsdaten gehören nicht in ein Feld
export const anlassFeld = pgTable(
  "anlass_feld",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    anlassId: uuid("anlass_id")
      .notNull()
      .references(() => anlass.id, { onDelete: "cascade" }),
    schluessel: text("schluessel").notNull(),
    beschriftung: text("beschriftung").notNull(),
    typ: text("typ", { enum: ["text", "ja_nein", "auswahl"] }).notNull(),
    // Nur bei «auswahl»: 2 bis 20 Optionen, sonst leer
    optionen: text("optionen")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    pflicht: boolean("pflicht").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    unique("anlass_feld_schluessel_eindeutig").on(t.anlassId, t.schluessel),
    check(
      "anlass_feld_typ_check",
      sql`${t.typ} in ('text', 'ja_nein', 'auswahl')`,
    ),
    check(
      "anlass_feld_schluessel_check",
      sql`${t.schluessel} ~ '^[a-z0-9_]{1,40}$'`,
    ),
    check(
      "anlass_feld_beschriftung_check",
      sql`char_length(${t.beschriftung}) between 1 and 100`,
    ),
    check(
      "anlass_feld_optionen_check",
      sql`(${t.typ} = 'auswahl' and cardinality(${t.optionen}) between 2 and 20) or (${t.typ} <> 'auswahl' and cardinality(${t.optionen}) = 0)`,
    ),
    check(
      "anlass_feld_reihenfolge_check",
      sql`${t.reihenfolge} between 0 and 19`,
    ),
  ],
);
