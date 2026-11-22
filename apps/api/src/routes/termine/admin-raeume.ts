import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, raum } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { tagsGehoerenZurAbteilung } from "../../sichtbarkeit.js";
import {
  ladeRaum,
  ladeRaeume,
  pruefeRaumRecht,
  raeumeListeSchema,
  zaehleOffeneAnfragen,
} from "../../termine/raum.js";
import { HTTPException } from "hono/http-exception";
import type { TermineEnv } from "./index.js";

// Räume verwalten (#446, Epic #430): Nur die Abteilungsleitung (termine/raum.ts); die Pfade tragen /api/v1/admin und erben den zweiten Faktor. Löschen ist endgültig; offene Raumanfragen (#447) sperren es.
const text = (max: number) => z.string().trim().min(1).max(max);
const anlegenSchema = z.strictObject({
  name: text(100),
  ort: text(200).nullable().optional(),
  beschreibung: text(1000).nullable().optional(),
  kapazitaet: z.number().int().min(1).max(1000).nullable().optional(),
  teamId: z.uuid().nullable().optional(),
  aktiv: z.boolean().optional(),
});
// Ohne Schlüssel bleibt der Wert; null löscht Ort, Beschreibung, Kapazität und Team
const aendernSchema = z.strictObject({
  name: text(100).optional(),
  ort: text(200).nullable().optional(),
  beschreibung: text(1000).nullable().optional(),
  kapazitaet: z.number().int().min(1).max(1000).nullable().optional(),
  teamId: z.uuid().nullable().optional(),
  aktiv: z.boolean().optional(),
});
const pfad = z.strictObject({ id: z.uuid() });

const RAUM_VORHANDEN = {
  code: "RAUM_VORHANDEN",
  message: "Es gibt schon einen Raum mit diesem Namen.",
} as const;
const TEAM_UNBEKANNT = {
  code: "TEAM_UNBEKANNT",
  message: "Das Team gehört nicht zur Abteilung.",
} as const;
const ANFRAGEN_OFFEN = {
  code: "ANFRAGEN_OFFEN",
  message:
    "Es gibt noch offene Raumanfragen. Deaktiviere den Raum stattdessen.",
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

export function erstelleAdminRaeumeRouten({ db }: { db: Db }) {
  return new Hono<TermineEnv>()
    .post("/admin/raeume", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      // Ohne Objekt im Pfad: erst das Recht
      pruefeRaumRecht(person);
      const b = c.req.valid("json");
      if (
        b.teamId &&
        !(await tagsGehoerenZurAbteilung(db, person.abteilungId, [b.teamId]))
      ) {
        return c.json(TEAM_UNBEKANNT, 400);
      }
      try {
        const id = await db.transaction(async (tx) => {
          const [zeile] = await tx
            .insert(raum)
            .values({
              abteilungId: person.abteilungId,
              name: b.name,
              ort: b.ort ?? null,
              beschreibung: b.beschreibung ?? null,
              kapazitaet: b.kapazitaet ?? null,
              teamTagId: b.teamId ?? null,
              aktiv: b.aktiv ?? true,
            })
            .returning({ id: raum.id });
          // Nur Kennungen, nie Namen
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "raum_angelegt",
            zielTyp: "raum",
            zielId: zeile.id,
            details: {},
          });
          return zeile.id;
        });
        return c.json({ id }, 201);
      } catch (fehler) {
        if (pgCode(fehler) === "23505") return c.json(RAUM_VORHANDEN, 409);
        throw fehler;
      }
    })
    .get("/admin/raeume", eingabe("query", raeumeListeSchema), async (c) => {
      const person = c.get("person");
      pruefeRaumRecht(person);
      const { limit, nach } = c.req.valid("query");
      // Eine Abfrage je Seite, auch die inaktiven Räume
      return c.json(
        await ladeRaeume(db, {
          abteilungId: person.abteilungId,
          nurAktiv: false,
          limit,
          nach,
        }),
      );
    })
    .patch(
      "/admin/raeume/:id",
      eingabe("param", pfad),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        // Erst das Objekt (404), dann das Recht (403), dann die Eingabe gegen die Datenbank
        if (!(await ladeRaum(db, person.abteilungId, id)))
          throw new HTTPException(404);
        pruefeRaumRecht(person);
        if (
          b.teamId &&
          !(await tagsGehoerenZurAbteilung(db, person.abteilungId, [b.teamId]))
        ) {
          return c.json(TEAM_UNBEKANNT, 400);
        }
        const { teamId, ...rest } = b;
        const aenderung = {
          ...rest,
          ...(teamId !== undefined && { teamTagId: teamId }),
        };
        // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
        if (Object.keys(aenderung).length === 0) return c.body(null, 204);
        try {
          await db.transaction(async (tx) => {
            await tx.update(raum).set(aenderung).where(eq(raum.id, id));
            // Welche Angaben, nie die Werte
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "raum_geaendert",
              zielTyp: "raum",
              zielId: id,
              details: { felder: Object.keys(b) },
            });
          });
        } catch (fehler) {
          if (pgCode(fehler) === "23505") return c.json(RAUM_VORHANDEN, 409);
          throw fehler;
        }
        return c.body(null, 204);
      },
    )
    .delete("/admin/raeume/:id", eingabe("param", pfad), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      if (!(await ladeRaum(db, person.abteilungId, id)))
        throw new HTTPException(404);
      pruefeRaumRecht(person);
      const belegt = await db.transaction(async (tx) => {
        // Sperrt den Raum: Eine Anfrage, die zugleich entsteht, wartet (Fremdschlüssel) und zählt dann mit
        const ziel = await ladeRaum(tx, person.abteilungId, id, true);
        // Zwei Löschungen zugleich: Die zweite findet den Raum nicht mehr und ist fertig
        if (!ziel) return false;
        if ((await zaehleOffeneAnfragen(tx, id)) > 0) return true;
        await tx.delete(raum).where(eq(raum.id, id));
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "raum_geloescht",
          zielTyp: "raum",
          zielId: id,
          details: {},
        });
        return false;
      });
      if (belegt) return c.json(ANFRAGEN_OFFEN, 409);
      return c.body(null, 204);
    });
}
