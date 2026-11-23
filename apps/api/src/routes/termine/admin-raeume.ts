import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, raum } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { tagsGehoerenZurAbteilung } from "../../sichtbarkeit.js";
import { verlange } from "../../rechtemodell/darf.js";
import {
  ladeRaum,
  ladeRaeume,
  raeumeListeSchema,
  zaehleOffeneAnfragen,
} from "../../termine/raum.js";
import {
  raeumeMit,
  hatRaeume,
  raumBedingung,
  verlangeEines,
} from "../../termine/rechte.js";
import { HTTPException } from "hono/http-exception";
import type { TermineEnv } from "./index.js";

// Räume verwalten (#446, Epic #430): Anlegen, Ändern und Löschen verlangt «Räume verwalten», das Team eines Raums ändern «Räume einem Team zuweisen» (rechtemodell/katalog.ts, beide erweitert: zweiter Faktor). Standardmässig hat sie nur die Abteilungsleitung; eine Gruppenrolle des Teams kann «Räume verwalten» für die Räume ihres Teams haben (#649). Die Pfade tragen /api/v1/admin. Löschen ist endgültig; offene Raumanfragen (#447) sperren es.
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
// Die Liste der Verwaltung kennt zusätzlich die Teamansicht: nur die Räume eines Teams
const adminListeSchema = raeumeListeSchema.extend({
  teamId: z.uuid().optional(),
});
// Die Liste öffnet, wer Räume verwalten oder Teams zuweisen darf
const LISTE_RECHTE = ["raum.verwalten", "raum.team_zuweisen"] as const;

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
      // Ohne Objekt im Pfad: erst das Recht; ein neuer Raum ist keiner Gruppe «eigen», also nur abteilungsweit
      await verlange(db, person, "raum.verwalten", {
        abteilungId: person.abteilungId,
        abteilungsweit: true,
      });
      const b = c.req.valid("json");
      if (b.teamId) {
        await verlange(db, person, "raum.team_zuweisen", {
          abteilungId: person.abteilungId,
        });
      }
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
    .get("/admin/raeume", eingabe("query", adminListeSchema), async (c) => {
      const person = c.get("person");
      // Die Tür: eines der Rechte irgendwo; die Liste zeigt die Räume, für die es gilt
      await verlangeEines(db, person, LISTE_RECHTE);
      const sicht = await raeumeMit(db, person, LISTE_RECHTE);
      const { limit, nach, teamId } = c.req.valid("query");
      if (!hatRaeume(sicht)) {
        return c.json({ raeume: [], weitere: false, naechste: null });
      }
      // Eine Abfrage je Seite, auch die inaktiven Räume
      return c.json(
        await ladeRaeume(db, {
          abteilungId: person.abteilungId,
          nurAktiv: false,
          limit,
          nach,
          teamId,
          bedingung: raumBedingung(sicht),
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
        const ziel = await ladeRaum(db, person.abteilungId, id);
        if (!ziel) throw new HTTPException(404);
        const objekt = {
          abteilungId: person.abteilungId,
          raumTeamTagId: ziel.teamTagId,
        };
        // Das Team ändern verlangt «Räume einem Team zuweisen»; alles andere «Räume verwalten». Eine Angabe des Teams, die nichts ändert, zählt nicht
        const aendertTeam =
          b.teamId !== undefined && b.teamId !== ziel.teamTagId;
        const weiteres =
          Object.keys(b).length === 0 ||
          Object.keys(b).some((k) => k !== "teamId") ||
          !aendertTeam;
        if (weiteres) await verlange(db, person, "raum.verwalten", objekt);
        if (aendertTeam) {
          await verlange(db, person, "raum.team_zuweisen", {
            abteilungId: person.abteilungId,
          });
        }
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
      const vorher = await ladeRaum(db, person.abteilungId, id);
      if (!vorher) throw new HTTPException(404);
      await verlange(db, person, "raum.verwalten", {
        abteilungId: person.abteilungId,
        raumTeamTagId: vorher.teamTagId,
      });
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
