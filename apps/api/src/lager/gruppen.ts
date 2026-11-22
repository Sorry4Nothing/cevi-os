import { z } from "zod";
import { gruppe, gruppeZuordnung } from "../db/schema.js";
import {
  MISCHEN_MAX_GRUPPEN,
  MISCHEN_MIN_GRUPPEN,
  SEED_MAX,
} from "./mischen.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Programmgruppen des Lagers (#387). Beide Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit einteilung.lesen, kein Zeilenfilter; der Feed nennt nur IDs).
for (const tabelle of [gruppe, gruppeZuordnung]) {
  registriereLagerTabelle({ tabelle, recht: "einteilung.lesen" });
}

// Höchstens so viele Gruppen je Lager und so viele Einträge je Anfrage (SR-71)
export const MAX_GRUPPEN = 50;
export const MAX_ZUORDNUNG = 200;

export const gruppeKurz = (r: typeof gruppe.$inferSelect) => ({
  id: r.id,
  version: r.version,
  name: r.name,
  reihenfolge: r.reihenfolge,
});

// Eingaben: strikt, nur die genannten Felder (SR-72); Leerzeichen am Rand fallen weg, Umlaute werden zusammengesetzt (NFC), Steuerzeichen sind verboten
const name = z
  .string()
  .transform((w) => w.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(100)
      .refine((w) => !/\p{Cc}/u.test(w)),
  );
const reihenfolge = z.number().int().min(0).max(1000);
const eindeutig = (liste: string[]) => new Set(liste).size === liste.length;

export const gruppeAnlegen = z.strictObject({
  name,
  reihenfolge: reihenfolge.optional(),
});
export const gruppeAendern = z
  .strictObject({
    version: z.number().int().min(1),
    name: name.optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// gruppeId null nimmt die genannten aus ihrer Gruppe. rolle gilt nur für personIds (Mitglieder des Lagers); Teilnehmende sind immer «mitglied»
export const zuordnen = z
  .strictObject({
    gruppeId: z.uuid().nullable(),
    teilnehmerIds: z.array(z.uuid()).max(MAX_ZUORDNUNG).default([]),
    personIds: z.array(z.uuid()).max(MAX_ZUORDNUNG).default([]),
    rolle: z.enum(["leitung", "mitglied"]).default("mitglied"),
  })
  .refine(
    (b) =>
      b.teilnehmerIds.length + b.personIds.length >= 1 &&
      b.teilnehmerIds.length + b.personIds.length <= MAX_ZUORDNUNG &&
      eindeutig(b.teilnehmerIds) &&
      eindeutig(b.personIds),
  );

export const abwaehlen = z.strictObject({
  abgewaehlt: z.boolean(),
  teilnehmerIds: z.array(z.uuid()).min(1).max(MAX_ZUORDNUNG).refine(eindeutig),
});

// uebernehmen false: nur Vorschlag, es wird nichts geschrieben. seed (optional) macht die Verteilung wiederholbar; ohne ihn zieht der Server einen und nennt ihn in der Antwort
export const mischen = z.strictObject({
  anzahl: z.number().int().min(MISCHEN_MIN_GRUPPEN).max(MISCHEN_MAX_GRUPPEN),
  uebernehmen: z.boolean(),
  seed: z.number().int().min(0).max(SEED_MAX).optional(),
});
