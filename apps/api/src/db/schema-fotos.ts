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
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Der Verweis steht nur in einer Funktion, die erst beim Aufbau der Fremdschlüssel läuft
import { abteilung } from "./schema.js";

// Fotos aus Flickr (#690): Welches Flickr-Konto die Abteilung zeigt und welche seiner Alben auf der Website erscheinen. Die Bilder selbst, die Titel und die Zahlen der Alben liegen bei Flickr; hier steht nur die Auswahl der Abteilung.
// Die Zugangsdaten zu Flickr (Schlüssel, Secret, Token) stehen nie in der Datenbank, nur in der Umgebung des Servers.

// Eine Zeile je Abteilung. «flickr_konto» ist die Kennung des Kontos (NSID, zum Beispiel «12345678@N00»), kein Name
export const fotoEinstellung = pgTable(
  "foto_einstellung",
  {
    abteilungId: uuid("abteilung_id")
      .primaryKey()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    flickrKonto: text("flickr_konto"),
    // «Album auf Flickr öffnen» zeigen? Aus, solange die Abteilung es nicht einschaltet: Der Link führt aus der Website hinaus zu einem Dritten
    flickrLinkZeigen: boolean("flickr_link_zeigen").notNull().default(false),
    version: integer("version").notNull().default(1),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "foto_einstellung_konto_check",
      sql`${t.flickrKonto} is null or ${t.flickrKonto} ~ '^[0-9]{1,20}@N[0-9]{2}$'`,
    ),
  ],
);

// Ein Album, über das die Abteilung entschieden hat. Ein Album von Flickr ohne Zeile hier erscheint nie auf der Website
export const fotoAlbum = pgTable(
  "foto_album",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    flickrAlbumId: text("flickr_album_id").notNull(),
    sichtbar: boolean("sichtbar").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    // Eigener Titel statt des Titels bei Flickr
    titel: text("titel"),
    version: integer("version").notNull().default(1),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("foto_album_flickr_idx").on(t.abteilungId, t.flickrAlbumId),
    index("foto_album_abteilung_idx").on(t.abteilungId, t.reihenfolge),
    check("foto_album_flickr_check", sql`${t.flickrAlbumId} ~ '^[0-9]{1,20}$'`),
    check(
      "foto_album_titel_check",
      sql`${t.titel} is null or char_length(${t.titel}) between 1 and 120`,
    ),
    check(
      "foto_album_reihenfolge_check",
      sql`${t.reihenfolge} between 0 and 9999`,
    ),
  ],
);
