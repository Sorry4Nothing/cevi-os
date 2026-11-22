import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { abteilung, tag, user } from "./schema.js";

// Tabellen der Website (#348). schema.ts re-exportiert diese Datei; die Importe aus schema.ts stehen nur in Rückruffunktionen, der Zyklus ist damit harmlos
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const zeitpunkt = (name: string) => timestamp(name, { withTimezone: true });

// Eine Seite im Navigationsbaum. Adresse, Eltern, Titel, Reihenfolge und Sichtbarkeit wirken sofort; nur der Inhalt ist versioniert (entwurf = ein JSON-Dokument, seite_version.inhalt je Stand).
// Dass tag_id und sichtbarkeit_tags zur Abteilung gehören, prüfen die Routen (wie bei bearbeiter); ein gelöschter Tag in sichtbarkeit_tags lässt eine tote ID, die nie passt (#333)
export const seite = pgTable(
  "seite",
  {
    id: id(),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    // Ohne Elternseite = oberste Ebene; löschen lässt sich eine Seite nur ohne Unterseiten
    elternId: uuid("eltern_id").references((): AnyPgColumn => seite.id, {
      onDelete: "restrict",
    }),
    // Ein Pfadstück: a-z, 0-9 und «-», höchstens 60 Zeichen
    adresse: text("adresse").notNull(),
    titel: text("titel").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    sichtbarkeit: text("sichtbarkeit", {
      enum: ["oeffentlich", "angemeldet", "tags"],
    }).notNull(),
    sichtbarkeitTags: uuid("sichtbarkeit_tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Gruppenseite (Stufe, Team, ...); fällt der Tag weg, bleibt die Seite
    tagId: uuid("tag_id").references(() => tag.id, { onDelete: "set null" }),
    // Alte Adresse auf der bisherigen Website, nur für den Umzug
    herkunft: text("herkunft"),
    veroeffentlichteVersionId: uuid("veroeffentlichte_version_id").references(
      (): AnyPgColumn => seiteVersion.id,
      { onDelete: "set null" },
    ),
    // Noch ohne Schema: Das Dokument der Bausteine legt #349 fest, Speichern und Veröffentlichen #350
    entwurf: jsonb("entwurf"),
    // Zählt jedes Speichern des Entwurfs; wer mit altem Stand speichert, wird erkannt (Konflikt)
    entwurfZaehler: integer("entwurf_zaehler").notNull().default(0),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
    geaendertAm: zeitpunkt("geaendert_am").notNull().defaultNow(),
    // Statische Auslieferung (#351): SHA-256 der zuletzt erzeugten HTML-Datei und der Zeitpunkt des Schreibens; leer, solange keine Datei besteht
    ausgabeHash: text("ausgabe_hash"),
    ausgabeAm: zeitpunkt("ausgabe_am"),
  },
  (t) => [
    unique("seite_adresse_eindeutig")
      .on(t.abteilungId, t.elternId, t.adresse)
      .nullsNotDistinct(),
    unique("seite_tag_eindeutig").on(t.tagId),
    unique("seite_herkunft_eindeutig").on(t.abteilungId, t.herkunft),
    index("seite_abteilung_idx").on(t.abteilungId),
    index("seite_eltern_id_idx").on(t.elternId),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check("seite_adresse_check", sql`${t.adresse} ~ '^[a-z0-9-]{1,60}$'`),
    check("seite_titel_check", sql`char_length(${t.titel}) between 1 and 150`),
    check(
      "seite_ausgabe_hash_check",
      sql`${t.ausgabeHash} is null or ${t.ausgabeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "seite_sichtbarkeit_check",
      sql`${t.sichtbarkeit} in ('oeffentlich', 'angemeldet', 'tags')`,
    ),
  ],
);

// Ein veröffentlichter Stand, nie geändert (die API-Rolle darf nicht UPDATEn); nr zählt je Seite ab 1. Fällt das Konto weg, bleibt die Version ohne Autor
export const seiteVersion = pgTable(
  "seite_version",
  {
    id: id(),
    seiteId: uuid("seite_id")
      .notNull()
      .references((): AnyPgColumn => seite.id, { onDelete: "cascade" }),
    nr: integer("nr").notNull(),
    inhalt: jsonb("inhalt").notNull(),
    autorId: uuid("autor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    unique("seite_version_nr_eindeutig").on(t.seiteId, t.nr),
    check("seite_version_nr_check", sql`${t.nr} >= 1`),
  ],
);
