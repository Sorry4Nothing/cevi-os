import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { auditLog, tag } from "../../db/schema.js";
import { terminVorschlag } from "../../db/schema-vorschlag.js";
import { eingabe } from "../../eingabe.js";
import type { Fcm } from "../../push.js";
import {
  darfVorschlagen,
  idPfad,
  ladeTags,
  liegtInVergangenheit,
  MAX_OFFENE_JE_PERSON,
  meineAbfrage,
  vorschlagAnsicht,
  vorschlagSchema,
} from "../../termine/vorschlag.js";
import { pushNeuerVorschlag } from "../../termine/vorschlag-push.js";
import type { TermineEnv } from "./index.js";

// Rate-Limit je Konto (SR-71): so viele Vorschläge in diesem Fenster
const VORSCHLAEGE = 20;
const FENSTER_MS = 10 * 60_000;

// Terminvorschläge einreichen (#439, Epic #430). Vorschlagen darf, wer darfVorschlagen erfüllt (Annahme A9); lesen und zurückziehen darf jede Person ihre eigenen, die Abteilungsleitung liest jeden der Abteilung. Ein Vorschlag einer anderen Abteilung oder einer anderen Person (ohne Leserecht) ist 404. Entscheiden gehört zu #440. Cevi OS schreibt nie nach Outlook
export function erstelleVorschlaegeRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= VORSCHLAEGE;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };

  // 403 vor der Eingabe (400)
  const einreichen = createMiddleware<TermineEnv>(async (c, next) => {
    if (!(await darfVorschlagen(db, c.get("person")))) {
      throw new HTTPException(403);
    }
    await next();
  });

  return (
    new Hono<TermineEnv>()
      // Ob die Person vorschlagen darf und welche Tags sie als Kategorie wählen kann: alle Tags der Abteilung; zwei Abfragen (Recht, Tags)
      .get("/termin-vorschlaege/optionen", async (c) => {
        const person = c.get("person");
        const darf = await darfVorschlagen(db, person);
        const tags = darf
          ? await db
              .select({ id: tag.id, name: tag.name, typ: tag.typ })
              .from(tag)
              .where(eq(tag.abteilungId, person.abteilungId))
              .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id))
          : [];
        return c.json({ darfVorschlagen: darf, tags });
      })
      .post(
        "/termin-vorschlaege",
        einreichen,
        eingabe("json", vorschlagSchema),
        async (c) => {
          const person = c.get("person");
          const eingang = c.req.valid("json");
          if (zuViele(person.id)) throw new HTTPException(429);
          if (liegtInVergangenheit(eingang)) {
            return c.json(
              {
                code: "TERMIN_VERGANGEN",
                message: "Der Termin darf nicht in der Vergangenheit beginnen.",
              },
              400,
            );
          }
          const ergebnis = await db.transaction(async (tx) => {
            // Je Person eine Sperre, damit zwei gleichzeitige Anfragen die Obergrenze nicht überspringen
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${person.id}, 0))`,
            );
            const [{ offen }] = await tx
              .select({ offen: sql<number>`count(*)::int` })
              .from(terminVorschlag)
              .where(
                and(
                  eq(terminVorschlag.vorgeschlagenVon, person.id),
                  eq(terminVorschlag.status, "offen"),
                ),
              );
            if (offen >= MAX_OFFENE_JE_PERSON) return "limit" as const;
            // Nur Tags der eigenen Abteilung
            const tags = await tx
              .select({ id: tag.id })
              .from(tag)
              .where(
                and(
                  eq(tag.abteilungId, person.abteilungId),
                  inArray(tag.id, eingang.tagIds),
                ),
              );
            if (tags.length !== eingang.tagIds.length) return "tag" as const;
            const [zeile] = await tx
              .insert(terminVorschlag)
              .values({
                abteilungId: person.abteilungId,
                vorgeschlagenVon: person.id,
                titel: eingang.titel,
                ganztaegig: eingang.ganztaegig,
                beginn: eingang.beginn ? new Date(eingang.beginn) : null,
                ende: eingang.ende ? new Date(eingang.ende) : null,
                tagVon: eingang.tagVon ?? null,
                tagBis: eingang.tagBis ?? null,
                ort: eingang.ort ?? null,
                beschreibung: eingang.beschreibung ?? null,
                bemerkung: eingang.bemerkung ?? null,
                tagIds: eingang.tagIds,
              })
              .returning({ id: terminVorschlag.id });
            // Nur die ID, nie der Inhalt
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "termin_vorgeschlagen",
              zielTyp: "termin_vorschlag",
              zielId: zeile.id,
            });
            return zeile.id;
          });
          if (ergebnis === "limit") {
            return c.json(
              {
                code: "VORSCHLAG_LIMIT",
                message: `Du hast schon ${MAX_OFFENE_JE_PERSON} offene Vorschläge. Warte auf den Entscheid oder ziehe einen zurück.`,
              },
              409,
            );
          }
          if (ergebnis === "tag") {
            return c.json(
              {
                code: "TAG_UNBEKANNT",
                message: "Mindestens eine Kategorie gibt es nicht.",
              },
              400,
            );
          }
          await pushNeuerVorschlag(
            { db, fcm, c },
            {
              abteilungId: person.abteilungId,
              vorschlagId: ergebnis,
              vonId: person.id,
            },
          );
          return c.json({ id: ergebnis, status: "offen" as const }, 201);
        },
      )
      // Die eigenen, neueste zuerst (uuidv7 ist nach Zeit geordnet); nach ist die ID des letzten Eintrags der Vorseite. Zwei Abfragen je Seite: die Zeilen mit einer Zeile mehr, dann die Tags aller Zeilen
      .get(
        "/termin-vorschlaege/meine",
        eingabe("query", meineAbfrage),
        async (c) => {
          const person = c.get("person");
          const { limit, nach } = c.req.valid("query");
          const zeilen = await db
            .select()
            .from(terminVorschlag)
            .where(
              and(
                eq(terminVorschlag.vorgeschlagenVon, person.id),
                eq(terminVorschlag.abteilungId, person.abteilungId),
                nach ? lt(terminVorschlag.id, nach) : undefined,
              ),
            )
            .orderBy(desc(terminVorschlag.id))
            .limit(limit + 1);
          const weitere = zeilen.length > limit;
          const seite = zeilen.slice(0, limit);
          const tags = await ladeTags(db, person.abteilungId, seite);
          return c.json({
            vorschlaege: seite.map((z) => vorschlagAnsicht(z, tags)),
            weitere,
            naechste: weitere ? seite[seite.length - 1]!.id : null,
          });
        },
      )
      // Der eigene Vorschlag, die Abteilungsleitung jeden der Abteilung; sonst 404, damit niemand fremde Vorschläge erkennt
      .get("/termin-vorschlaege/:id", eingabe("param", idPfad), async (c) => {
        const person = c.get("person");
        const [zeile] = await db
          .select()
          .from(terminVorschlag)
          .where(
            and(
              eq(terminVorschlag.id, c.req.valid("param").id),
              eq(terminVorschlag.abteilungId, person.abteilungId),
            ),
          );
        if (!zeile || (!person.admin && zeile.vorgeschlagenVon !== person.id)) {
          throw new HTTPException(404);
        }
        const tags = await ladeTags(db, person.abteilungId, [zeile]);
        return c.json(vorschlagAnsicht(zeile, tags));
      })
      // Zurückziehen löscht den Vorschlag, solange er offen ist; nur die vorschlagende Person. Die Abteilungsleitung sieht ihn (404 gilt für alle anderen), darf ihn aber nicht zurückziehen (403)
      .delete(
        "/termin-vorschlaege/:id",
        eingabe("param", idPfad),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const [zeile] = await db
            .select({ von: terminVorschlag.vorgeschlagenVon })
            .from(terminVorschlag)
            .where(
              and(
                eq(terminVorschlag.id, id),
                eq(terminVorschlag.abteilungId, person.abteilungId),
              ),
            );
          const eigener = zeile?.von === person.id;
          if (!zeile || (!person.admin && !eigener))
            throw new HTTPException(404);
          if (!eigener) throw new HTTPException(403);
          const geloescht = await db.transaction(async (tx) => {
            const weg = await tx
              .delete(terminVorschlag)
              .where(
                and(
                  eq(terminVorschlag.id, id),
                  eq(terminVorschlag.status, "offen"),
                ),
              )
              .returning({ id: terminVorschlag.id });
            if (weg.length === 0) return false;
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "termin_zurueckgezogen",
              zielTyp: "termin_vorschlag",
              zielId: id,
            });
            return true;
          });
          if (!geloescht) {
            return c.json(
              {
                code: "VORSCHLAG_ENTSCHIEDEN",
                message:
                  "Über diesen Vorschlag ist schon entschieden. Er lässt sich nicht mehr zurückziehen.",
              },
              409,
            );
          }
          return c.body(null, 204);
        },
      )
  );
}
