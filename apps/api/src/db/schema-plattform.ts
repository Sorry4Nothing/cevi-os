import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { abteilung, user } from "./schema.js";

// Plattformrollen (#423). schema.ts re-exportiert diese Datei; die Importe aus schema.ts stehen nur in Rückruffunktionen, der Zyklus ist damit harmlos.
// Nicht «rolle»: So heissen die Stufenrollen (Sicht auf person_tag). Entwickler und Abteilungsleitung stehen nicht hier, sie sind fest im Code (plattform.ts)
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const zeitpunkt = (name: string) => timestamp(name, { withTimezone: true });

// Eine Rolle der Abteilung mit einstellbaren Rechten (plattform_rolle_recht). schluessel «webmaster» kennzeichnet die Vorgabe jeder Abteilung: Sie lässt sich nicht löschen und nicht umbenennen, ihre Rechte sind einstellbar
export const plattformRolle = pgTable(
  "plattform_rolle",
  {
    id: id(),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    schluessel: text("schluessel", { enum: ["webmaster"] }),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plattform_rolle_name_pro_abteilung").on(
      t.abteilungId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex("plattform_rolle_schluessel_pro_abteilung")
      .on(t.abteilungId, t.schluessel)
      .where(sql`${t.schluessel} is not null`),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check(
      "plattform_rolle_schluessel_check",
      sql`${t.schluessel} is null or ${t.schluessel} in ('webmaster')`,
    ),
    check(
      "plattform_rolle_name_check",
      sql`char_length(${t.name}) between 1 and 50`,
    ),
  ],
);

// Ein Recht der Rolle, benannt nach dem Rechtekatalog im Code. Die Datenbank kennt den Katalog nicht: Ein Name, den der Katalog nicht (mehr) kennt, gibt nichts (fail-closed, plattform.ts)
export const plattformRolleRecht = pgTable(
  "plattform_rolle_recht",
  {
    rolleId: uuid("rolle_id")
      .notNull()
      .references(() => plattformRolle.id, { onDelete: "cascade" }),
    recht: text("recht").notNull(),
  },
  (t) => [primaryKey({ columns: [t.rolleId, t.recht] })],
);

// Wer welche Rolle trägt. Dass Person und Rolle zur selben Abteilung gehören, prüfen die Routen und jede Abfrage in plattform.ts (die Rolle muss in der Abteilung der Person liegen)
export const personPlattformRolle = pgTable(
  "person_plattform_rolle",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rolleId: uuid("rolle_id")
      .notNull()
      .references(() => plattformRolle.id, { onDelete: "cascade" }),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.rolleId] }),
    index("person_plattform_rolle_rolle_id_idx").on(t.rolleId),
  ],
);

// Entwickler der Plattform: nur die Kommandozeile schreibt hier (cli/entwickler.ts), nie eine Route
export const plattformEntwickler = pgTable("plattform_entwickler", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
});
