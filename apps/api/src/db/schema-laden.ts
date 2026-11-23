import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, medium, user } from "./schema.js";

// Lädeli (#566): Artikel der Abteilung, Bestellungen angemeldeter Personen und die Übergabearten.
// Es gibt keinen Lagerbestand und keine Zahlung: Ein Artikel ist verfügbar oder nicht, bezahlt wird bei der Übergabe.

// Ein Artikel des Lädelis. Varianten sind eine freie Liste (Grössen, Farben); ohne Einträge hat der Artikel keine Auswahl
export const ladenArtikel = pgTable(
  "laden_artikel",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    preisRappen: integer("preis_rappen").notNull(),
    // Bild aus der Medienbibliothek; fällt das Medium weg, bleibt der Artikel ohne Bild
    mediumId: uuid("medium_id").references(() => medium.id, {
      onDelete: "set null",
    }),
    varianten: text("varianten")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Grössen aus «varianten», die gerade nicht zu haben sind (#629). Leer: alle Grössen verfügbar
    nichtVerfuegbar: text("nicht_verfuegbar")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hinweis: text("hinweis"),
    verfuegbar: boolean("verfuegbar").notNull().default(true),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("laden_artikel_abteilung_idx").on(t.abteilungId, t.reihenfolge),
    check(
      "laden_artikel_name_check",
      sql`char_length(${t.name}) between 1 and 100`,
    ),
    check(
      "laden_artikel_preis_check",
      sql`${t.preisRappen} between 0 and 1000000`,
    ),
    check(
      "laden_artikel_varianten_check",
      sql`cardinality(${t.varianten}) <= 20`,
    ),
    check(
      "laden_artikel_nicht_verfuegbar_check",
      sql`${t.nichtVerfuegbar} <@ ${t.varianten}`,
    ),
    check(
      "laden_artikel_hinweis_check",
      sql`${t.hinweis} is null or char_length(${t.hinweis}) between 1 and 200`,
    ),
    check(
      "laden_artikel_reihenfolge_check",
      sql`${t.reihenfolge} between 0 and 9999`,
    ),
  ],
);

// Einstellungen des Lädelis je Abteilung (#566, #642): die Übergabearten, die Regeln (offen, Schnell dazu, Preise für Besucher, Mengen, Mindestbestellung) und die Texte. Ein Text ohne Wert (null) gilt als Vorgabe; die Vorgaben stehen in laden/laden.ts (EINSTELLUNG_VORGABE). Ohne Zeile gelten alle Vorgaben
export const ladenEinstellung = pgTable(
  "laden_einstellung",
  {
    abteilungId: uuid("abteilung_id")
      .primaryKey()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    uebergabearten: text("uebergabearten").array().notNull(),
    bestellenOffen: boolean("bestellen_offen").notNull().default(true),
    schnellDazu: boolean("schnell_dazu").notNull().default(true),
    preiseOeffentlich: boolean("preise_oeffentlich").notNull().default(true),
    maxMenge: integer("max_menge").notNull().default(10),
    maxPositionen: integer("max_positionen").notNull().default(20),
    maxOffene: integer("max_offene").notNull().default(5),
    mindestRappen: integer("mindest_rappen").notNull().default(0),
    bezahlhinweis: text("bezahlhinweis"),
    zahlungsart: text("zahlungsart"),
    bestaetigung: text("bestaetigung"),
    uebergabehinweis: text("uebergabehinweis"),
    bedingungen: text("bedingungen"),
    geschlossenText: text("geschlossen_text"),
  },
  (t) => [
    check(
      "laden_einstellung_uebergabe_check",
      sql`cardinality(${t.uebergabearten}) between 1 and 5`,
    ),
    check(
      "laden_einstellung_grenzen_check",
      sql`${t.maxMenge} between 1 and 99 and ${t.maxPositionen} between 1 and 50 and ${t.maxOffene} between 1 and 20 and ${t.mindestRappen} between 0 and 1000000`,
    ),
    check(
      "laden_einstellung_texte_check",
      sql`(${t.bezahlhinweis} is null or char_length(${t.bezahlhinweis}) <= 120) and (${t.zahlungsart} is null or char_length(${t.zahlungsart}) <= 60) and (${t.bestaetigung} is null or char_length(${t.bestaetigung}) <= 240) and (${t.uebergabehinweis} is null or char_length(${t.uebergabehinweis}) <= 200) and (${t.bedingungen} is null or char_length(${t.bedingungen}) <= 600) and (${t.geschlossenText} is null or char_length(${t.geschlossenText}) <= 200)`,
    ),
  ],
);

// Eine Bestellung: wer (user_id), wie übergeben (Text der gewählten Übergabeart zum Zeitpunkt der Bestellung), Stand und Summe. Die Summe rechnet der Server aus den Artikeln.
// Wird das Konto gelöscht, fällt die Bestellung mit (CASCADE). abgeschlossen_am steht, sobald sie übergeben oder storniert ist: Ab dann läuft die Löschfrist
export const ladenBestellung = pgTable(
  "laden_bestellung",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["offen", "bereit", "uebergeben", "storniert"],
    })
      .notNull()
      .default("offen"),
    uebergabe: text("uebergabe").notNull(),
    summeRappen: integer("summe_rappen").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    abgeschlossenAm: timestamp("abgeschlossen_am", { withTimezone: true }),
  },
  (t) => [
    // Liste der Verwaltung: je Abteilung und Stand, neueste zuerst (uuidv7 ist nach Zeit geordnet)
    index("laden_bestellung_abteilung_idx").on(t.abteilungId, t.status, t.id),
    index("laden_bestellung_user_idx").on(t.userId),
    check(
      "laden_bestellung_status_check",
      sql`${t.status} in ('offen', 'bereit', 'uebergeben', 'storniert')`,
    ),
    check(
      "laden_bestellung_uebergabe_check",
      sql`char_length(${t.uebergabe}) between 1 and 80`,
    ),
    check("laden_bestellung_summe_check", sql`${t.summeRappen} >= 0`),
    check(
      "laden_bestellung_abschluss_check",
      sql`(${t.status} in ('uebergeben', 'storniert')) = (${t.abgeschlossenAm} is not null)`,
    ),
  ],
);

// Eine Position: Name, Variante und Einzelpreis sind der Stand beim Bestellen, damit eine spätere Änderung am Artikel die Bestellung nicht verändert. Fällt der Artikel weg, bleibt die Position
export const ladenBestellposition = pgTable(
  "laden_bestellposition",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    bestellungId: uuid("bestellung_id")
      .notNull()
      .references(() => ladenBestellung.id, { onDelete: "cascade" }),
    artikelId: uuid("artikel_id").references(() => ladenArtikel.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    variante: text("variante"),
    menge: integer("menge").notNull(),
    einzelpreisRappen: integer("einzelpreis_rappen").notNull(),
  },
  (t) => [
    index("laden_bestellposition_bestellung_idx").on(t.bestellungId),
    index("laden_bestellposition_artikel_idx").on(t.artikelId),
    check(
      "laden_bestellposition_menge_check",
      sql`${t.menge} between 1 and 99`,
    ),
    check(
      "laden_bestellposition_preis_check",
      sql`${t.einzelpreisRappen} >= 0`,
    ),
  ],
);
