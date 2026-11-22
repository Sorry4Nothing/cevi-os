import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { abteilung } from "./schema.js";

// Bereichsschalter (#424 Wartungsmodus, #425 Informationssperre). schema.ts re-exportiert diese Datei; der Import aus schema.ts steht nur in einer Rückruffunktion, der Zyklus ist damit harmlos.
// Eine Zeile je Abteilung, Bereich und Art, solange der Schalter aktiv ist; Aufheben löscht die Zeile (das Audit-Log behält die Schaltung). Der Server liest die Tabelle beim Start und hält den Zustand im Speicher (bereichsschalter.ts), keine Anfrage fragt hier nach.
export const SCHALTER_BEREICHE = [
  "website",
  "lager",
  "chat",
  "programme",
  "verwaltung",
  "alles",
] as const;
export const SCHALTER_ARTEN = ["wartung", "sperre"] as const;

export const bereichsschalter = pgTable(
  "bereichsschalter",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    bereich: text("bereich", { enum: SCHALTER_BEREICHE }).notNull(),
    art: text("art", { enum: SCHALTER_ARTEN }).notNull(),
    // Text für die Anzeige; kein Personenbezug
    hinweis: text("hinweis"),
    // Geplantes Ende, nur zur Anzeige: Der Schalter endet nie von selbst
    ende: timestamp("ende", { withTimezone: true }),
    // Nur bei der Sperre: Die öffentliche Website ist vom Netz genommen, der Abgleich erzeugt nichts neu
    websiteOffline: boolean("website_offline").notNull().default(false),
    // UUID der Person, ohne Fremdschlüssel wie im Audit-Log
    ausgeloestVon: text("ausgeloest_von").notNull(),
    ausgeloestAm: timestamp("ausgeloest_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("bereichsschalter_abteilung_bereich_art").on(
      t.abteilungId,
      t.bereich,
      t.art,
    ),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check(
      "bereichsschalter_bereich_check",
      sql`${t.bereich} in ('website', 'lager', 'chat', 'programme', 'verwaltung', 'alles')`,
    ),
    check("bereichsschalter_art_check", sql`${t.art} in ('wartung', 'sperre')`),
    check(
      "bereichsschalter_hinweis_check",
      sql`${t.hinweis} is null or char_length(${t.hinweis}) between 1 and 500`,
    ),
    check(
      "bereichsschalter_offline_check",
      sql`not ${t.websiteOffline} or ${t.art} = 'sperre'`,
    ),
  ],
);
