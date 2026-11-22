import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  packlisteAbhaken,
  packlisteEigen,
  packlistePunkt,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  EIGENE_MAX,
  eigenAendern,
  eigenAnlegen,
  eigenAnsicht,
  punktAendern,
  punktAnlegen,
  punktAnsicht,
  PUNKTE_MAX,
  sperreLagerZeile,
  versionAbfrage,
  zustandSetzen,
} from "../../lager/lagerinfos.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const punktPfad = z.strictObject({ id: z.uuid(), punktId: z.uuid() });
const eigenPfad = z.strictObject({ id: z.uuid(), eigenId: z.uuid() });

const LIMIT_ERREICHT = {
  code: "LIMIT_ERREICHT",
  message: "Die Packliste hat die höchste Zahl an Punkten erreicht.",
} as const;

// Packliste (#393), Beschreibung in lager/lagerinfos.ts. Die Vorlage gehört dem Lager (packliste.bearbeiten, über den Sync-Kern mit Version und Feed); jede Person liest sie als eigene Kopie, hakt ab, entfernt Punkte und fügt eigene hinzu (packliste.abhaken). Die Kopie ist keine Kopie: Die Person hat nur ihre Abweichungen und ihre eigenen Punkte. Eigene Punkte und Abweichungen sehen nur die Person selbst; auch die Lagerleitung liest sie nicht. Punkte mit nur_lagerleitung liest nur, wer vertrauliches.lesen hat (sonst 404)
export function erstellePacklisteRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "packliste.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "packliste.bearbeiten" });
  const abhaken = lagerZugriff(db, { recht: "packliste.abhaken" });

  // Der Punkt der Vorlage gibt es in diesem Lager und die Rolle darf ihn sehen, sonst 404 (auch für einen Punkt eines fremden Lagers)
  async function punktDa(
    tx: Pick<Db, "select">,
    lagerId: string,
    id: string,
    vertraulich: boolean,
  ) {
    const [zeile] = await tx
      .select()
      .from(packlistePunkt)
      .where(
        and(
          eq(packlistePunkt.id, id),
          eq(packlistePunkt.lagerId, lagerId),
          vertraulich ? undefined : eq(packlistePunkt.nurLagerleitung, false),
        ),
      );
    if (!zeile) throw new HTTPException(404);
    return zeile;
  }

  return new Hono<LagerEnv>()
    .get("/:id/packliste", lesen, eingabe("param", lagerPfad), async (c) => {
      const lagerId = c.get("lager").lager.id;
      const personId = c.get("person").id;
      const vertraulich = darf(c.get("lager"), "vertrauliches.lesen");
      // Zwei Abfragen für die ganze Liste der Person: die Vorlage mit ihren Abweichungen (Join) und die eigenen Punkte
      const [punkte, eigene] = await Promise.all([
        db
          .select({ punkt: packlistePunkt, zustand: packlisteAbhaken.zustand })
          .from(packlistePunkt)
          .leftJoin(
            packlisteAbhaken,
            and(
              eq(packlisteAbhaken.punktId, packlistePunkt.id),
              eq(packlisteAbhaken.personId, personId),
            ),
          )
          .where(
            and(
              eq(packlistePunkt.lagerId, lagerId),
              vertraulich
                ? undefined
                : eq(packlistePunkt.nurLagerleitung, false),
            ),
          )
          .orderBy(asc(packlistePunkt.reihenfolge), asc(packlistePunkt.id))
          .limit(PUNKTE_MAX),
        db
          .select()
          .from(packlisteEigen)
          .where(
            and(
              eq(packlisteEigen.lagerId, lagerId),
              eq(packlisteEigen.personId, personId),
            ),
          )
          .orderBy(asc(packlisteEigen.reihenfolge), asc(packlisteEigen.id))
          .limit(EIGENE_MAX),
      ]);
      return c.json({
        punkte: punkte.map((z) => ({
          ...punktAnsicht(z.punkt),
          zustand: z.zustand ?? "offen",
        })),
        eigene: eigene.map(eigenAnsicht),
      });
    })
    .post(
      "/:id/packliste/punkte",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", punktAnlegen),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const werte = c.req.valid("json");
        const ergebnis = await db.transaction(async (tx) => {
          await sperreLagerZeile(tx, lagerId);
          const [stand] = await tx
            .select({
              n: sql<number>`count(*)::int`,
              ende: sql<number>`coalesce(max(${packlistePunkt.reihenfolge}) + 1, 0)`,
            })
            .from(packlistePunkt)
            .where(and(eq(packlistePunkt.lagerId, lagerId)));
          if (stand!.n >= PUNKTE_MAX) return undefined;
          return legeZeileAn(
            tx,
            packlistePunkt,
            { lagerId, personId: c.get("person").id },
            { ...werte, reihenfolge: werte.reihenfolge ?? stand!.ende },
          );
        });
        if (!ergebnis) return c.json(LIMIT_ERREICHT, 409);
        return c.json({ ...punktAnsicht(ergebnis), zustand: "offen" }, 201);
      },
    )
    .patch(
      "/:id/packliste/punkte/:punktId",
      bearbeiten,
      eingabe("param", punktPfad),
      eingabe("json", punktAendern),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const { punktId } = c.req.valid("param");
        const { version, ...werte } = c.req.valid("json");
        const vertraulich = darf(c.get("lager"), "vertrauliches.lesen");
        const zeile = await db.transaction(async (tx) => {
          await sperreLagerZeile(tx, lagerId);
          await punktDa(tx, lagerId, punktId, vertraulich);
          return aendereZeile(
            tx,
            packlistePunkt,
            { lagerId, personId: c.get("person").id },
            { id: punktId, version, werte, ansicht: punktAnsicht },
          );
        });
        return c.json(punktAnsicht(zeile));
      },
    )
    .delete(
      "/:id/packliste/punkte/:punktId",
      bearbeiten,
      eingabe("param", punktPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const { punktId } = c.req.valid("param");
        const vertraulich = darf(c.get("lager"), "vertrauliches.lesen");
        await db.transaction(async (tx) => {
          await sperreLagerZeile(tx, lagerId);
          await punktDa(tx, lagerId, punktId, vertraulich);
          await loescheZeile(
            tx,
            packlistePunkt,
            { lagerId, personId: c.get("person").id },
            {
              id: punktId,
              version: c.req.valid("query").version,
              ansicht: punktAnsicht,
            },
          );
        });
        return c.body(null, 204);
      },
    )
    .put(
      "/:id/packliste/punkte/:punktId/zustand",
      abhaken,
      eingabe("param", punktPfad),
      eingabe("json", zustandSetzen),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const personId = c.get("person").id;
        const { punktId } = c.req.valid("param");
        const { zustand } = c.req.valid("json");
        await punktDa(
          db,
          lagerId,
          punktId,
          darf(c.get("lager"), "vertrauliches.lesen"),
        );
        // Eine Anweisung, gleiches Ergebnis bei Wiederholung: «offen» ist keine Zeile
        if (zustand === "offen") {
          await db
            .delete(packlisteAbhaken)
            .where(
              and(
                eq(packlisteAbhaken.personId, personId),
                eq(packlisteAbhaken.punktId, punktId),
              ),
            );
        } else {
          await db
            .insert(packlisteAbhaken)
            .values({ lagerId, personId, punktId, zustand })
            .onConflictDoUpdate({
              target: [packlisteAbhaken.personId, packlisteAbhaken.punktId],
              set: { zustand, geaendertAm: sql`now()` },
            });
        }
        return c.json({ id: punktId, zustand });
      },
    )
    .post(
      "/:id/packliste/eigene",
      abhaken,
      eingabe("param", lagerPfad),
      eingabe("json", eigenAnlegen),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const personId = c.get("person").id;
        const w = c.req.valid("json");
        // Obergrenze und Einfügen in einer Anweisung: Zwei gleichzeitige Aufrufe überschreiten sie nicht
        const [neu] = await db.execute<{
          id: string;
          abschnitt: string;
          text: string;
          abgehakt: boolean;
          reihenfolge: number;
        }>(sql`
          insert into packliste_eigen (lager_id, person_id, abschnitt, text, reihenfolge)
          select ${lagerId}, ${personId}, ${w.abschnitt}, ${w.text},
            coalesce(${w.reihenfolge ?? null}::int, (select coalesce(max(reihenfolge) + 1, 0) from packliste_eigen where lager_id = ${lagerId} and person_id = ${personId}))
          where (select count(*) from packliste_eigen where lager_id = ${lagerId} and person_id = ${personId}) < ${EIGENE_MAX}
          returning id, abschnitt, text, abgehakt, reihenfolge`);
        if (!neu) return c.json(LIMIT_ERREICHT, 409);
        return c.json(neu, 201);
      },
    )
    .patch(
      "/:id/packliste/eigene/:eigenId",
      abhaken,
      eingabe("param", eigenPfad),
      eingabe("json", eigenAendern),
      async (c) => {
        const { eigenId } = c.req.valid("param");
        // Nur die eigene Zeile: Die ID einer fremden Zeile ist unbekannt (404)
        const [zeile] = await db
          .update(packlisteEigen)
          .set(c.req.valid("json"))
          .where(
            and(
              eq(packlisteEigen.id, eigenId),
              eq(packlisteEigen.lagerId, c.get("lager").lager.id),
              eq(packlisteEigen.personId, c.get("person").id),
            ),
          )
          .returning();
        if (!zeile) throw new HTTPException(404);
        return c.json(eigenAnsicht(zeile));
      },
    )
    .delete(
      "/:id/packliste/eigene/:eigenId",
      abhaken,
      eingabe("param", eigenPfad),
      async (c) => {
        const geloescht = await db
          .delete(packlisteEigen)
          .where(
            and(
              eq(packlisteEigen.id, c.req.valid("param").eigenId),
              eq(packlisteEigen.lagerId, c.get("lager").lager.id),
              eq(packlisteEigen.personId, c.get("person").id),
            ),
          )
          .returning({ id: packlisteEigen.id });
        if (geloescht.length === 0) throw new HTTPException(404);
        return c.body(null, 204);
      },
    );
}
