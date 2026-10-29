import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  auditLog,
  kind,
  kindEltern,
  leitungAnmeldung,
  programm,
  programmStufe,
  stufe,
  teilnahme,
} from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import {
  darfErgaenzen,
  darfLeitungAnmelden,
  darfZuordnen,
  hatRolle,
  programmBeginn,
  programmLeitungssicht,
  programmSichtbar,
  type Person,
} from "../rechte.js";

// PostgreSQL 18 lehnt das Jahr 0000 ab (Fehler 22008), zod lässt es durch
const tag = z.iso.date().refine((wert) => !wert.startsWith("0000"));
const fensterSchema = z.strictObject({ von: tag, bis: tag });
const pfadSchema = z.strictObject({ id: z.uuid() });
const leitungSchema = z.strictObject({ status: z.enum(["ja", "nein"]) });
const teilnahmePfad = z.strictObject({ id: z.uuid(), kindId: z.uuid() });
const teilnahmeSchema = z.strictObject({ status: z.enum(["ja", "nein"]) });
// Beginn in Schweizer Zeit: Ein ganztägiges Programm beginnt um Mitternacht seines ersten Tages
const BEGINN = sql`coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich')`;
// Kleingeschrieben, weil die Route die IDs mit denen aus PostgreSQL vergleicht
const zuordnungSchema = z.strictObject({
  stufen: z
    .array(z.uuid().toLowerCase())
    .max(50)
    .refine((stufen) => new Set(stufen).size === stufen.length),
  sichtbarkeit: z.enum(["intern", "leitende", "eltern"]),
});

// NUL lehnt PostgreSQL in text ab (22021); leer heisst «Angabe entfernen»: Dann gilt wieder der Ort aus Google
const ergaenzung = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((wert) => !wert.includes("\u0000"))
    .transform((wert) => wert || null)
    .nullable()
    .optional();
const ergaenzungenSchema = z
  .strictObject({
    treffpunkt: ergaenzung(200),
    schlussOrt: ergaenzung(200),
    schlussZeit: z
      .union([z.iso.time({ precision: -1 }), z.literal("")])
      .transform((wert) => wert || null)
      .nullable()
      .optional(),
    mitnehmen: ergaenzung(2000),
    infoEltern: ergaenzung(2000),
  })
  .refine((werte) => Object.keys(werte).length > 0);

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
    // Mit Namen für die App; nur Stufen der eigenen Abteilung, falls je eine fremde verknüpft wäre
    stufen: sql<
      { id: string; name: string }[]
    >`coalesce((select jsonb_agg(jsonb_build_object('id', stufe.id, 'name', stufe.name) order by stufe.id) from programm_stufe join stufe on stufe.id = programm_stufe.stufe_id and stufe.abteilung_id = programm.abteilung_id where programm_stufe.programm_id = programm.id), '[]'::jsonb)`,
    // Die Google-Beschreibung gilt als intern: nur mit Leitungssicht, sonst null
    googleBeschreibung: sql<
      string | null
    >`case when ${programmLeitungssicht(person)} then programm.google_beschreibung end`,
  };
}

export function erstelleProgrammRouten({ db }: { db: Db }) {
  // Aktiv und noch nicht begonnen: nur dann lässt sich die Teilnahme melden und ändern
  async function teilnahmeOffen(programmId: string) {
    const [zeile] = await db
      .select({ id: programm.id })
      .from(programm)
      .where(
        and(
          eq(programm.id, programmId),
          eq(programm.status, "aktiv"),
          sql`${BEGINN} > now()`,
        ),
      );
    return !!zeile;
  }

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
      // Nur wer sich anmelden dürfte, bekommt den Schlüssel; undefined fällt aus dem JSON, für alle anderen fehlt er
      let eigeneAnmeldung: "ja" | "nein" | "offen" | undefined;
      if (
        darfLeitungAnmelden(
          person,
          zeile.stufen.map((s) => s.id),
        )
      ) {
        const [anmeldung] = await db
          .select({ status: leitungAnmeldung.status })
          .from(leitungAnmeldung)
          .where(
            and(
              eq(leitungAnmeldung.programmId, id),
              eq(leitungAnmeldung.userId, person.id),
            ),
          );
        eigeneAnmeldung = anmeldung?.status ?? "offen";
      }
      // Nur die eigenen Kinder in einer zugeordneten Stufe; Leitende korrigieren per PUT, ihre Übersicht folgt mit #38
      const kinder = await db
        .select({
          id: kind.id,
          vorname: kind.vorname,
          status: teilnahme.status,
        })
        .from(kind)
        .innerJoin(
          kindEltern,
          and(eq(kindEltern.kindId, kind.id), eq(kindEltern.userId, person.id)),
        )
        .innerJoin(
          programmStufe,
          and(
            eq(programmStufe.stufeId, kind.stufeId),
            eq(programmStufe.programmId, id),
          ),
        )
        .leftJoin(
          teilnahme,
          and(eq(teilnahme.kindId, kind.id), eq(teilnahme.programmId, id)),
        )
        .where(
          and(
            eq(kind.abteilungId, person.abteilungId),
            isNull(kind.inaktivSeit),
          ),
        )
        .orderBy(kind.vorname, kind.id);
      return c.json({
        ...zeile,
        teilnahmeOffen: await teilnahmeOffen(id),
        kinder,
        eigeneAnmeldung,
        darfErgaenzen: darfErgaenzen(
          person,
          zeile.stufen.map((s) => s.id),
        ),
      });
    })
    .patch(
      "/:id",
      eingabe("param", pfadSchema),
      eingabe("json", ergaenzungenSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const daten = c.req.valid("json");
        const [zeile] = await db
          .select({
            stufen: sql<
              string[]
            >`coalesce((select array_agg(programm_stufe.stufe_id) from programm_stufe where programm_stufe.programm_id = programm.id), '{}')`,
          })
          .from(programm)
          .where(and(eq(programm.id, id), programmSichtbar(person)));
        if (!zeile) throw new HTTPException(404);
        if (!darfErgaenzen(person, zeile.stufen)) throw new HTTPException(403);
        await db
          .update(programm)
          .set({ ...daten, geaendertVon: person.id, geaendertAm: sql`now()` })
          .where(
            and(
              eq(programm.id, id),
              eq(programm.abteilungId, person.abteilungId),
            ),
          );
        return c.body(null, 204);
      },
    )
    .put(
      "/:id/leitung",
      eingabe("param", pfadSchema),
      eingabe("json", leitungSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { status } = c.req.valid("json");
        // Die Uhr der Datenbank entscheidet, nicht JavaScript
        const [zeile] = await db
          .select({
            begonnen: sql<boolean>`${programmBeginn} <= now()`,
            stufen: sql<
              string[]
            >`coalesce((select array_agg(programm_stufe.stufe_id) from programm_stufe where programm_stufe.programm_id = programm.id), '{}')`,
          })
          .from(programm)
          .where(and(eq(programm.id, id), programmSichtbar(person)));
        if (!zeile) throw new HTTPException(404);
        if (!darfLeitungAnmelden(person, zeile.stufen)) {
          throw new HTTPException(403);
        }
        // Eigener Code per c.json: onError machte aus einem unbekannten HTTPException-Status den allgemeinen Text
        if (zeile.begonnen) {
          return c.json(
            {
              code: "PROGRAMM_BEGONNEN",
              message: "Das Programm hat schon begonnen.",
            },
            409,
          );
        }
        await db
          .insert(leitungAnmeldung)
          .values({ programmId: id, userId: person.id, status })
          .onConflictDoUpdate({
            target: [leitungAnmeldung.programmId, leitungAnmeldung.userId],
            set: { status },
          });
        return c.body(null, 204);
      },
    )
    .put(
      "/:id/teilnahmen/:kindId",
      eingabe("param", teilnahmePfad),
      eingabe("json", teilnahmeSchema),
      async (c) => {
        const person = c.get("person");
        const { id, kindId } = c.req.valid("param");
        const { status } = c.req.valid("json");
        // Fremde wie unbekannte Programme und Kinder sind 404, erst danach zählt das Recht
        const [zeile] = await db
          .select({ id: programm.id })
          .from(programm)
          .where(and(eq(programm.id, id), programmSichtbar(person)));
        const [ziel] = await db
          .select({ stufeId: kind.stufeId, inaktivSeit: kind.inaktivSeit })
          .from(kind)
          .where(
            and(eq(kind.id, kindId), eq(kind.abteilungId, person.abteilungId)),
          );
        if (!zeile || !ziel) throw new HTTPException(404);
        const [eigenes] = await db
          .select({ eins: sql`1` })
          .from(kindEltern)
          .where(
            and(
              eq(kindEltern.kindId, kindId),
              eq(kindEltern.userId, person.id),
            ),
          );
        const zustaendig =
          person.admin ||
          hatRolle(person, ziel.stufeId, "leitung") ||
          !!eigenes;
        const [zugeordnet] = await db
          .select({ eins: sql`1` })
          .from(programmStufe)
          .where(
            and(
              eq(programmStufe.programmId, id),
              eq(programmStufe.stufeId, ziel.stufeId),
            ),
          );
        if (!zustaendig || !zugeordnet || ziel.inaktivSeit) {
          throw new HTTPException(403);
        }
        if (!(await teilnahmeOffen(id))) {
          return c.json(
            {
              code: "PROGRAMM_GESCHLOSSEN",
              message:
                "Das Programm ist abgesagt oder hat schon begonnen. Die Teilnahme lässt sich nicht mehr ändern.",
            },
            409,
          );
        }
        await db
          .insert(teilnahme)
          .values({
            programmId: id,
            kindId,
            status,
            geaendertVon: person.id,
          })
          .onConflictDoUpdate({
            target: [teilnahme.programmId, teilnahme.kindId],
            set: { status, geaendertVon: person.id, geaendertAm: sql`now()` },
          });
        return c.body(null, 204);
      },
    )
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
