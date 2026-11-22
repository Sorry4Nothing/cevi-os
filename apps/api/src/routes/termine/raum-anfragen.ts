import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, raum, raumBuchung, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Fcm } from "../../push.js";
import { ladeRaum } from "../../termine/raum.js";
import {
  anfrageSchema,
  darfEntscheiden,
  dauerOk,
  entscheidetUeberRaum,
  entscheidSchema,
  listeSchema,
  MAX_OFFENE_JE_PERSON,
  pushEntscheid,
  pushNeueAnfrage,
} from "../../termine/raum-buchung.js";
import type { TermineEnv } from "./index.js";

// Rate-Limit je Konto (SR-71): so viele Anfragen in diesem Fenster
const ANFRAGEN = 20;
const FENSTER_MS = 10 * 60_000;

// Raumanfragen (#447, Epic #430): Jede angemeldete Person der Abteilung fragt einen aktiven Raum an (Annahme, wie R2), das Team des Raums entscheidet (termine/raum-buchung.ts: darfEntscheiden). Ein Raum oder eine Anfrage einer anderen Abteilung ist 404; erst laden, dann das Recht (403). Cevi OS schreibt nie nach Outlook.
const pfad = z.strictObject({ id: z.uuid() });

const RAUM_BELEGT = {
  code: "RAUM_BELEGT",
  message: "Der Raum ist in dieser Zeit schon gebucht.",
} as const;
const STATUS_UNGUELTIG = {
  code: "STATUS_UNGUELTIG",
  message: "Diese Anfrage lässt sich in diesem Stand nicht so ändern.",
} as const;
const EIGENE_ANFRAGE = {
  code: "EIGENE_ANFRAGE",
  message: "Über deine eigene Anfrage entscheidet eine andere Person.",
} as const;
const ANFRAGE_LIMIT = {
  code: "ANFRAGE_LIMIT",
  message: `Du hast schon ${MAX_OFFENE_JE_PERSON} offene Anfragen. Warte auf den Entscheid oder ziehe eine zurück.`,
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23P01 = Exclusion-Constraint verletzt (zwei bestätigte Buchungen überschneiden sich)
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

type Zeile = typeof raumBuchung.$inferSelect;
const ansicht = (z: Zeile, raumName: string) => ({
  id: z.id,
  raumId: z.raumId,
  raumName,
  beginn: z.beginn,
  ende: z.ende,
  zweck: z.zweck,
  status: z.status,
  begruendung: z.begruendung,
  entschiedenAm: z.entschiedenAm,
  erstelltAm: z.erstelltAm,
});

export function erstelleRaumAnfragenRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= ANFRAGEN;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };

  return (
    new Hono<TermineEnv>()
      // Die eigenen Anfragen in jedem Stand (auch bestätigte Buchungen), neueste zuerst (uuidv7 ist nach Zeit geordnet); nach ist die ID des letzten Eintrags der Vorseite. Eine Abfrage je Seite (Join auf den Raum)
      .get(
        "/raeume/anfragen/meine",
        eingabe("query", listeSchema),
        async (c) => {
          const person = c.get("person");
          const { limit, nach } = c.req.valid("query");
          const zeilen = await db
            .select({ b: raumBuchung, raumName: raum.name })
            .from(raumBuchung)
            .innerJoin(raum, eq(raum.id, raumBuchung.raumId))
            .where(
              and(
                eq(raumBuchung.userId, person.id),
                eq(raum.abteilungId, person.abteilungId),
                nach ? lt(raumBuchung.id, nach) : undefined,
              ),
            )
            .orderBy(desc(raumBuchung.id))
            .limit(limit + 1);
          const weitere = zeilen.length > limit;
          const seite = zeilen.slice(0, limit);
          return c.json({
            anfragen: seite.map((z) => ansicht(z.b, z.raumName)),
            weitere,
            naechste: weitere ? seite[seite.length - 1]!.b.id : null,
          });
        },
      )
      // Die offenen Anfragen, über die diese Person entscheidet (Team-Tag des Raums; ohne Team die Abteilungsleitung), ohne ihre eigenen, älteste zuerst; wer über nichts entscheidet, bekommt eine leere Liste. Eine Abfrage je Seite (Join auf Raum und Konto, Tags der Person als Unterabfrage)
      .get(
        "/raeume/anfragen/offen",
        eingabe("query", listeSchema),
        async (c) => {
          const person = c.get("person");
          const { limit, nach } = c.req.valid("query");
          const zeilen = await db
            .select({
              b: raumBuchung,
              raumName: raum.name,
              vonName: user.name,
            })
            .from(raumBuchung)
            .innerJoin(raum, eq(raum.id, raumBuchung.raumId))
            .innerJoin(user, eq(user.id, raumBuchung.userId))
            .where(
              and(
                eq(raum.abteilungId, person.abteilungId),
                eq(raumBuchung.status, "angefragt"),
                gt(raumBuchung.ende, sql`now()`),
                sql`${raumBuchung.userId} <> ${person.id}`,
                entscheidetUeberRaum(person),
                nach ? gt(raumBuchung.id, nach) : undefined,
              ),
            )
            .orderBy(asc(raumBuchung.id))
            .limit(limit + 1);
          const weitere = zeilen.length > limit;
          const seite = zeilen.slice(0, limit);
          return c.json({
            anfragen: seite.map((z) => ({
              ...ansicht(z.b, z.raumName),
              vonName: z.vonName,
            })),
            weitere,
            naechste: weitere ? seite[seite.length - 1]!.b.id : null,
          });
        },
      )
      // Stornieren: Die eigene Anfrage zurückziehen oder die eigene Buchung absagen, solange sie nicht vorbei ist. Die Zeile bleibt (Status «storniert») bis zur Löschfrist; ein zweites Mal ist 204. Fremde Anfragen sind 404, auch für die Abteilungsleitung
      .delete("/raeume/anfragen/:id", eingabe("param", pfad), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const [zeile] = await db
          .select({ status: raumBuchung.status })
          .from(raumBuchung)
          .innerJoin(raum, eq(raum.id, raumBuchung.raumId))
          .where(
            and(
              eq(raumBuchung.id, id),
              eq(raumBuchung.userId, person.id),
              eq(raum.abteilungId, person.abteilungId),
            ),
          );
        if (!zeile) throw new HTTPException(404);
        if (zeile.status === "storniert") return c.body(null, 204);
        const geaendert = await db.transaction(async (tx) => {
          // Bedingt: Entscheidet das Team gerade «ablehnen» oder ist die Zeit vorbei, trifft das UPDATE nichts
          const [weg] = await tx
            .update(raumBuchung)
            .set({ status: "storniert" })
            .where(
              and(
                eq(raumBuchung.id, id),
                sql`${raumBuchung.status} in ('angefragt', 'bestaetigt')`,
                gt(raumBuchung.ende, sql`now()`),
              ),
            )
            .returning({ id: raumBuchung.id });
          if (!weg) return false;
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "raum_storniert",
            zielTyp: "raum_buchung",
            zielId: id,
          });
          return true;
        });
        if (!geaendert) return c.json(STATUS_UNGUELTIG, 409);
        return c.body(null, 204);
      })
      // Entscheiden: erst die Anfrage der eigenen Abteilung laden (fremd = 404), dann das Recht (403), dann die Sperre der eigenen Anfrage (403). Bedingtes UPDATE auf «angefragt»; beim Annehmen hält der Exclusion-Constraint Doppelbuchungen aus: Bei zwei gleichzeitigen Bestätigungen überlappender Zeiten gewinnt genau eine, die andere ist 409 RAUM_BELEGT
      .post(
        "/raeume/anfragen/:id/entscheid",
        eingabe("param", pfad),
        eingabe("json", entscheidSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const b = c.req.valid("json");
          const [ziel] = await db
            .select({
              von: raumBuchung.userId,
              raumId: raum.id,
              teamTagId: raum.teamTagId,
            })
            .from(raumBuchung)
            .innerJoin(raum, eq(raum.id, raumBuchung.raumId))
            .where(
              and(
                eq(raumBuchung.id, id),
                eq(raum.abteilungId, person.abteilungId),
              ),
            );
          if (!ziel) throw new HTTPException(404);
          if (!(await darfEntscheiden(db, person, ziel.teamTagId))) {
            throw new HTTPException(403);
          }
          if (ziel.von === person.id) return c.json(EIGENE_ANFRAGE, 403);
          const status =
            b.entscheid === "annehmen" ? "bestaetigt" : "abgelehnt";
          let geaendert: boolean;
          try {
            geaendert = await db.transaction(async (tx) => {
              // Annehmen je Raum nacheinander: Ohne die Sperre sperren sich zwei gleichzeitige Bestätigungen überlappender Zeiten im Index gegenseitig (Deadlock, 500); der Constraint bleibt der Boden
              if (status === "bestaetigt") {
                await ladeRaum(tx, person.abteilungId, ziel.raumId, true);
              }
              const [zeile] = await tx
                .update(raumBuchung)
                .set({
                  status,
                  entschiedenVon: person.id,
                  entschiedenAm: new Date(),
                  begruendung: b.begruendung ?? null,
                })
                .where(
                  and(
                    eq(raumBuchung.id, id),
                    eq(raumBuchung.status, "angefragt"),
                    gt(raumBuchung.ende, sql`now()`),
                  ),
                )
                .returning({ id: raumBuchung.id });
              if (!zeile) return false;
              // Nur die ID und der neue Stand, nie Zweck oder Begründung
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "raum_entschieden",
                zielTyp: "raum_buchung",
                zielId: id,
                details: { status },
              });
              return true;
            });
          } catch (fehler) {
            if (pgCode(fehler) === "23P01") return c.json(RAUM_BELEGT, 409);
            throw fehler;
          }
          if (!geaendert) return c.json(STATUS_UNGUELTIG, 409);
          await pushEntscheid(
            { db, fcm, c },
            {
              abteilungId: person.abteilungId,
              anfrageId: id,
              vonId: ziel.von,
              status,
            },
          );
          return c.json({ id, status });
        },
      )
      // Anfragen: Der Raum muss aktiv sein und zur Abteilung gehören (sonst 404). Je Person eine Sperre, damit gleichzeitige Anfragen die Obergrenze nicht überspringen; der Raum ist gesperrt, damit ihn niemand gleichzeitig löscht. Ein Zeitraum, der sich mit einer bestätigten Buchung überschneidet, ist sofort 409 RAUM_BELEGT
      .post(
        "/raeume/:id/anfragen",
        eingabe("param", pfad),
        eingabe("json", anfrageSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const b = c.req.valid("json");
          if (zuViele(person.id)) throw new HTTPException(429);
          if (Date.parse(b.beginn) <= Date.now()) {
            return c.json(
              {
                code: "ZEIT_VERGANGEN",
                message: "Die Zeit muss in der Zukunft beginnen.",
              },
              400,
            );
          }
          if (!dauerOk(b.beginn, b.ende)) {
            return c.json(
              {
                code: "ZEIT_ZU_LANG",
                message: "Eine Anfrage darf höchstens 14 Tage dauern.",
              },
              400,
            );
          }
          const beginn = new Date(b.beginn);
          const ende = new Date(b.ende);
          const ergebnis = await db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${person.id}, 0))`,
            );
            const r = await ladeRaum(tx, person.abteilungId, id, true);
            if (!r?.aktiv) return "kein_raum" as const;
            const [{ offen }] = await tx
              .select({ offen: sql<number>`count(*)::int` })
              .from(raumBuchung)
              .where(
                and(
                  eq(raumBuchung.userId, person.id),
                  eq(raumBuchung.status, "angefragt"),
                  gt(raumBuchung.ende, sql`now()`),
                ),
              );
            if (offen >= MAX_OFFENE_JE_PERSON) return "limit" as const;
            const [belegt] = await tx
              .select({ eins: sql`1` })
              .from(raumBuchung)
              .where(
                and(
                  eq(raumBuchung.raumId, id),
                  eq(raumBuchung.status, "bestaetigt"),
                  sql`tstzrange(${raumBuchung.beginn}, ${raumBuchung.ende}) && tstzrange(${beginn.toISOString()}::timestamptz, ${ende.toISOString()}::timestamptz)`,
                ),
              )
              .limit(1);
            if (belegt) return "belegt" as const;
            const [zeile] = await tx
              .insert(raumBuchung)
              .values({
                raumId: id,
                userId: person.id,
                beginn,
                ende,
                zweck: b.zweck,
              })
              .returning({ id: raumBuchung.id });
            // Nur die ID, nie der Zweck
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "raum_angefragt",
              zielTyp: "raum_buchung",
              zielId: zeile!.id,
            });
            return { id: zeile!.id, teamTagId: r.teamTagId };
          });
          if (ergebnis === "kein_raum") throw new HTTPException(404);
          if (ergebnis === "limit") return c.json(ANFRAGE_LIMIT, 409);
          if (ergebnis === "belegt") return c.json(RAUM_BELEGT, 409);
          await pushNeueAnfrage(
            { db, fcm, c },
            {
              abteilungId: person.abteilungId,
              anfrageId: ergebnis.id,
              vonId: person.id,
              teamTagId: ergebnis.teamTagId,
            },
          );
          return c.json({ id: ergebnis.id, status: "angefragt" as const }, 201);
        },
      )
  );
}
