import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { CeviDbDienst } from "../../cevi-db/dienst.js";
import type { Db } from "../../db/client.js";
import { auditLog, ceviDbEinstellung } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";

// Verbindung zur Cevi-Datenbank (#691): Stand lesen, die Gruppe (Ebene) der Abteilung einstellen und die Verbindung prüfen. Nur mit dem Recht «cevi_db.verwalten» (Abteilungsleitung, oder eine Rolle mit dem Recht; mit zweitem Faktor). Adresse und Token stehen nur in der Umgebung des Servers (CEVI_DB_URL, CEVI_DB_TOKEN): Hier gibt es sie weder zu lesen noch zu schreiben, und keine Antwort nennt sie oder einen Text der Gegenseite.

const putSchema = z.strictObject({
  gruppeId: z
    .string()
    .regex(/^[0-9]{1,20}$/)
    .nullable(),
});

// Prüfen löst Abrufe bei der Cevi-Datenbank aus: je Konto höchstens so viele je Minute
export const PRUEFUNGEN_PRO_MINUTE = 5;

export function erstelleAdminCeviDbRouten({
  db,
  dienst,
}: {
  db: Db;
  dienst?: CeviDbDienst;
}) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt
  const pruefungen = new Map<string, number[]>();
  const zuViele = (personId: string) => {
    const jetzt = Date.now();
    const liste = (pruefungen.get(personId) ?? []).filter(
      (t) => jetzt - t < 60_000,
    );
    const voll = liste.length >= PRUEFUNGEN_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    pruefungen.set(personId, liste);
    return voll;
  };
  const lade = async (abteilungId: string) => {
    const [z] = await db
      .select({
        gruppeId: ceviDbEinstellung.gruppeId,
        letzterAbrufAm: ceviDbEinstellung.letzterAbrufAm,
        letzterStatus: ceviDbEinstellung.letzterStatus,
        anzahlPersonen: ceviDbEinstellung.anzahlPersonen,
      })
      .from(ceviDbEinstellung)
      .where(eq(ceviDbEinstellung.abteilungId, abteilungId));
    return (
      z ?? {
        gruppeId: null,
        letzterAbrufAm: null,
        letzterStatus: null,
        anzahlPersonen: null,
      }
    );
  };

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      await verlange(db, person, "cevi_db.verwalten");
      return c.json({
        // Gesetzt heisst: Adresse und Token stehen in der Umgebung. Mehr verrät die Antwort nicht
        verbunden: dienst !== undefined,
        ...(await lade(person.abteilungId)),
      });
    })
    .put("/", eingabe("json", putSchema), async (c) => {
      const person = c.get("person");
      await verlange(db, person, "cevi_db.verwalten");
      const { gruppeId } = c.req.valid("json");
      await db.transaction(async (tx) => {
        await tx
          .insert(ceviDbEinstellung)
          .values({ abteilungId: person.abteilungId, gruppeId })
          .onConflictDoUpdate({
            target: ceviDbEinstellung.abteilungId,
            set: { gruppeId, geaendertAm: sql`now()` },
          });
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "cevi_db_einstellung_geaendert",
          zielTyp: "abteilung",
          zielId: person.abteilungId,
          details: { gruppe: gruppeId !== null },
        });
      });
      return c.body(null, 204);
    })
    .post("/pruefen", async (c) => {
      const person = c.get("person");
      await verlange(db, person, "cevi_db.verwalten");
      if (zuViele(person.id)) throw new HTTPException(429);
      if (!dienst) return c.json({ ergebnis: "nicht_eingerichtet" as const });
      const { gruppeId } = await lade(person.abteilungId);
      const r = await dienst.pruefe(gruppeId);
      await db.insert(auditLog).values({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "cevi_db_geprueft",
        zielTyp: "abteilung",
        zielId: person.abteilungId,
        details: { ergebnis: r.ok ? "ok" : r.art },
      });
      if (!r.ok) return c.json({ ergebnis: r.art });
      // Nur Ja oder Nein, nie ein Name oder eine Zahl der Cevi-Datenbank
      return c.json({
        ergebnis: "ok" as const,
        gruppe: r.gruppe,
      });
    });
}
