import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { auditLog, programm, programmStufe, stufe } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import {
  darfZuordnen,
  programmLeitungssicht,
  programmSichtbar,
  type Person,
} from "../rechte.js";

// PostgreSQL 18 lehnt das Jahr 0000 ab (Fehler 22008), zod lässt es durch
const tag = z.iso.date().refine((wert) => !wert.startsWith("0000"));
const fensterSchema = z.strictObject({ von: tag, bis: tag });
const pfadSchema = z.strictObject({ id: z.uuid() });
// Kleingeschrieben, weil die Route die IDs mit denen aus PostgreSQL vergleicht
const zuordnungSchema = z.strictObject({
  stufen: z
    .array(z.uuid().toLowerCase())
    .max(50)
    .refine((stufen) => new Set(stufen).size === stufen.length),
  sichtbarkeit: z.enum(["intern", "leitende", "eltern"]),
});

// Ein Satz Felder für Liste und Detail; nie abteilung_id, google_event_id, google_serie oder geaendert_*
function programmFelder(person: Person) {
  return {
    id: programm.id,
    titel: programm.titel,
    status: programm.status,
    sichtbarkeit: programm.sichtbarkeit,
    ganztaegig: programm.ganztaegig,
    beginn: programm.beginn,
    ende: programm.ende,
    tagVon: programm.tagVon,
    tagBis: programm.tagBis,
    googleOrt: programm.googleOrt,
    treffpunkt: programm.treffpunkt,
    schlussOrt: programm.schlussOrt,
    schlussZeit: programm.schlussZeit,
    mitnehmen: programm.mitnehmen,
    infoEltern: programm.infoEltern,
    stufen: sql<
      string[]
    >`array(select stufe_id from programm_stufe where programm_stufe.programm_id = programm.id order by stufe_id)`,
    // Die Google-Beschreibung gilt als intern: nur mit Leitungssicht, sonst null
    googleBeschreibung: sql<
      string | null
    >`case when ${programmLeitungssicht(person)} then programm.google_beschreibung end`,
  };
}

export function erstelleProgrammRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .get("/", eingabe("query", fensterSchema), async (c) => {
      const person = c.get("person");
      const { von, bis } = c.req.valid("query");
      const programme = await db
        .select(programmFelder(person))
        .from(programm)
        .where(
          and(
            programmSichtbar(person),
            // Inklusive Schweizer Kalendertage: Ein Lager zählt an jedem seiner Tage
            sql`coalesce(programm.tag_bis, (programm.ende at time zone 'Europe/Zurich')::date) >= ${von}`,
            sql`coalesce(programm.tag_von, (programm.beginn at time zone 'Europe/Zurich')::date) <= ${bis}`,
          ),
        )
        .orderBy(
          sql`coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich')`,
          programm.id,
        );
      return c.json({ programme });
    })
    .get("/:id", eingabe("param", pfadSchema), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const [zeile] = await db
        .select(programmFelder(person))
        .from(programm)
        .where(and(eq(programm.id, id), programmSichtbar(person)));
      if (!zeile) throw new HTTPException(404);
      return c.json(zeile);
    })
    .put(
      "/:id/zuordnung",
      eingabe("param", pfadSchema),
      eingabe("json", zuordnungSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { stufen, sichtbarkeit } = c.req.valid("json");
        await db.transaction(async (tx) => {
          // Zeilensperre: Zwei gleichzeitige Zuordnungen ergäben sonst die Vereinigung statt des letzten Stands
          const [zeile] = await tx
            .select({ sichtbarkeit: programm.sichtbarkeit })
            .from(programm)
            .where(and(eq(programm.id, id), programmSichtbar(person)))
            .for("no key update");
          if (!zeile) throw new HTTPException(404);
          const vorher = (
            await tx
              .select({ stufeId: programmStufe.stufeId })
              .from(programmStufe)
              .where(eq(programmStufe.programmId, id))
          ).map((r) => r.stufeId);
          const sichtbarkeitAendert = sichtbarkeit !== zeile.sichtbarkeit;
          if (
            !darfZuordnen(person, {
              vorher,
              nachher: stufen,
              sichtbarkeitAendert,
            })
          ) {
            throw new HTTPException(403);
          }
          // Nur Stufen der eigenen Abteilung; fremde wie unbekannte IDs sind eine ungültige Eingabe, kein 404
          if (stufen.length > 0) {
            const eigene = await tx
              .select({ id: stufe.id })
              .from(stufe)
              .where(
                and(
                  inArray(stufe.id, stufen),
                  eq(stufe.abteilungId, person.abteilungId),
                ),
              );
            if (eigene.length !== stufen.length) throw new HTTPException(400);
          }
          // Ohne Stufe sähe ohnehin niemand ausser Admins und SL das Programm: Es bleibt «intern»
          if (stufen.length === 0 && sichtbarkeit !== "intern") {
            throw new HTTPException(400);
          }
          const nachherMenge = new Set(stufen);
          const vorherMenge = new Set(vorher);
          const entfernt = vorher.filter((s) => !nachherMenge.has(s));
          const neu = stufen.filter((s) => !vorherMenge.has(s));
          if (entfernt.length > 0) {
            await tx
              .delete(programmStufe)
              .where(
                and(
                  eq(programmStufe.programmId, id),
                  inArray(programmStufe.stufeId, entfernt),
                ),
              );
          }
          if (neu.length > 0) {
            await tx
              .insert(programmStufe)
              .values(neu.map((stufeId) => ({ programmId: id, stufeId })));
          }
          if (sichtbarkeitAendert) {
            await tx
              .update(programm)
              .set({ sichtbarkeit })
              .where(eq(programm.id, id));
          }
          // Nur geänderte Schlüssel, ohne Personendaten; ein No-op schreibt keinen Eintrag
          const details: Record<string, unknown> = {};
          if (entfernt.length > 0 || neu.length > 0) {
            details.stufen = [...stufen].sort();
          }
          if (sichtbarkeitAendert) details.sichtbarkeit = sichtbarkeit;
          if (Object.keys(details).length > 0) {
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "programm_zugeordnet",
              zielTyp: "programm",
              zielId: id,
              details,
            });
          }
        });
        return c.body(null, 204);
      },
    );
}
