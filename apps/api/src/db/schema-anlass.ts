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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, kind, programm, seite, user } from "./schema.js";

// Anlässe der Termine (#442, Epic #430): Ein Anlass ist ein Termin (programm) mit Anmeldung. Die Anmeldungen (#443) stehen am Ende dieser Datei.
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
    // Aus welcher Angabe der Cevi-Datenbank die Anmeldung dieses Textfeld vorausfüllt (#691); null = nie. Nie Gesundheit: Die Liste der Quellen ist fest (cevi-db/felder.ts)
    ceviQuelle: text("cevi_quelle"),
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
    check(
      "anlass_feld_cevi_quelle_check",
      sql`${t.ceviQuelle} is null or (${t.typ} = 'text' and ${t.ceviQuelle} in ('geburtsdatum', 'telefon', 'adresse', 'plz', 'ort', 'email'))`,
    ),
  ],
);

// Eine Anmeldung zu einem Anlass (#443): einer Person oder, bei «kind», eines Kindes (kind_id), angemeldet von einem Elternteil (user_id).
// Sie speichert nur die Antworten auf die Zusatzfelder, keine Kopie der Kontodaten: Name, Cevi-Name und Stufe liest jede Ansicht live aus dem Konto. Die ID ist das Ziel von teilnehmer.anmeldung_id des Lager-Moduls (kein Fremdschlüssel von dort, bis #363 ihn setzt).
// Abmelden setzt den Status und leert die Antworten; die Zeile bleibt bis zur Löschfrist (180 Tage nach dem Ende des Anlasses).
export const anlassAnmeldung = pgTable(
  "anlass_anmeldung",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    anlassId: uuid("anlass_id")
      .notNull()
      .references(() => anlass.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kindId: uuid("kind_id").references(() => kind.id, { onDelete: "cascade" }),
    // Schlüssel des Feldes -> Wert (Text, Ja/Nein oder Option); die Route prüft sie gegen die Felder des Anlasses
    antworten: jsonb("antworten")
      .$type<Record<string, string | boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status", { enum: ["angemeldet", "abgemeldet"] }).notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Eine Person oder ein Elternteil mit Kind je Anlass nur einmal; NULLS NOT DISTINCT, damit auch die Anmeldung der Person selbst (kind_id leer) eindeutig ist
    unique("anlass_anmeldung_eindeutig")
      .on(t.anlassId, t.userId, t.kindId)
      .nullsNotDistinct(),
    // Ein Kind hat je Anlass eine Anmeldung, auch wenn beide Elternteile anmelden
    uniqueIndex("anlass_anmeldung_kind_eindeutig")
      .on(t.anlassId, t.kindId)
      .where(sql`${t.kindId} is not null`),
    index("anlass_anmeldung_user_idx").on(t.userId),
    index("anlass_anmeldung_kind_idx").on(t.kindId),
    check(
      "anlass_anmeldung_status_check",
      sql`${t.status} in ('angemeldet', 'abgemeldet')`,
    ),
  ],
);
