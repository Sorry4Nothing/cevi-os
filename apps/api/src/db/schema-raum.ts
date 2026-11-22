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
import { abteilung, tag, user } from "./schema.js";

// Räume der Abteilung (#446, Epic #430). Die Raumanfragen stehen unten (#447).
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

// Raumanfragen und Buchungen (#447, Epic #430): Eine Person fragt einen Raum für eine Zeit an, das Team des Raums entscheidet. «bestaetigt» ist die Buchung. Personendaten: user_id und zweck (Freitext, höchstens 200 Zeichen); gelöscht 180 Tage nach dem Ende (termine/raum-buchung.ts), mit dem Konto oder dem Raum fallen sie weg.
// Den Constraint raum_buchung_keine_ueberschneidung kennt Drizzle nicht (Migration 0127): EXCLUDE USING gist (raum_id WITH =, tstzrange(beginn, ende) WITH &&) WHERE (status = 'bestaetigt'), mit btree_gist. Zwei gleichzeitige Bestätigungen überlappender Zeiten: genau eine gewinnt, die andere scheitert mit 23P01 (Route: 409 RAUM_BELEGT).
export const BUCHUNG_STATI = [
  "angefragt",
  "bestaetigt",
  "abgelehnt",
  "storniert",
] as const;
export const raumBuchung = pgTable(
  "raum_buchung",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    raumId: uuid("raum_id")
      .notNull()
      .references(() => raum.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    beginn: timestamp("beginn", { withTimezone: true }).notNull(),
    ende: timestamp("ende", { withTimezone: true }).notNull(),
    zweck: text("zweck").notNull(),
    status: text("status", { enum: BUCHUNG_STATI })
      .notNull()
      .default("angefragt"),
    entschiedenVon: uuid("entschieden_von").references(() => user.id, {
      onDelete: "set null",
    }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    begruendung: text("begruendung"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // «Meine Anfragen», neueste zuerst
    index("raum_buchung_user_idx").on(t.userId, t.id),
    // Offene Anfragen je Raum (Entscheidende)
    index("raum_buchung_offen_idx")
      .on(t.raumId, t.id)
      .where(sql`${t.status} = 'angefragt'`),
    // Löschlauf
    index("raum_buchung_ende_idx").on(t.ende),
    check(
      "raum_buchung_status_check",
      sql`${t.status} in ('angefragt', 'bestaetigt', 'abgelehnt', 'storniert')`,
    ),
    check(
      "raum_buchung_zeit_check",
      sql`${t.ende} > ${t.beginn} and ${t.ende} - ${t.beginn} <= interval '14 days'`,
    ),
    check(
      "raum_buchung_zweck_check",
      sql`char_length(${t.zweck}) between 1 and 200`,
    ),
    check(
      "raum_buchung_begruendung_check",
      sql`char_length(${t.begruendung}) between 1 and 500`,
    ),
    check(
      "raum_buchung_entscheid_check",
      sql`${t.status} not in ('bestaetigt', 'abgelehnt') or ${t.entschiedenAm} is not null`,
    ),
  ],
);
