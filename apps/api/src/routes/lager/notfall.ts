import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, lager, notfallKontakt } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  istMitglied,
  kartenSetzen,
  kontaktAendern,
  kontaktAnlegen,
  kontaktAnsicht,
  ladeAlleKontakte,
  ladeInfos,
  ladeKontakte,
  sperreLagerZeile,
  versionAbfrage,
} from "../../lager/lagerinfos.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const kontaktPfad = z.strictObject({ id: z.uuid(), kontaktId: z.uuid() });

const KEIN_MITGLIED = {
  code: "KEIN_MITGLIED",
  message: "Die Person muss Mitglied dieses Lagers sein.",
} as const;
const NUMMER_FEHLT = {
  code: "TELEFON_FEHLT",
  message: "Ein Kontakt ohne Konto braucht eine Telefonnummer.",
} as const;

// Notfall (#393), Beschreibung in lager/lagerinfos.ts. Das Notfall-Fenster liefert in einer Antwort: die Lageradresse mit dem gespeicherten Kartenlink (der Server ruft keinen Kartendienst ab), die Notfall-Kontakte mit Telefon (erfasste Kontakte und die Sicherheitsverantwortlichen aus dem Ressort «si» und seinen Teilbereichen) und die Info-Abschnitte mit dem Merkmal «notfall». Das Team sieht nur diese Kontakte mit Nummer, sonst nirgends im Lager eine Telefonnummer. Lesen braucht notfall.lesen, jede Änderung notfall.bearbeiten
export function erstelleNotfallRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "notfall.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "notfall.bearbeiten" });

  async function kontaktDa(
    tx: Pick<Db, "select">,
    lagerId: string,
    id: string,
  ) {
    const [zeile] = await tx
      .select()
      .from(notfallKontakt)
      .where(
        and(
          eq(notfallKontakt.id, id),
          eq(notfallKontakt.lagerId, lagerId),
          isNull(notfallKontakt.geloeschtAm),
        ),
      );
    if (!zeile) throw new HTTPException(404);
    return zeile;
  }

  return new Hono<LagerEnv>()
    .get("/:id/notfall", lesen, eingabe("param", lagerPfad), async (c) => {
      const zugriff = c.get("lager");
      const { id: lagerId, ort, adresse, kartenLink } = zugriff.lager;
      // Kontakte (zwei Abfragen) und Info-Abschnitte (bis zu drei) für das ganze Fenster, nie je Zeile
      const [kontakte, infos] = await Promise.all([
        ladeAlleKontakte(db, lagerId),
        ladeInfos(db, lagerId, darf(zugriff, "vertrauliches.lesen"), {
          nurNotfall: true,
          limit: 200,
        }),
      ]);
      return c.json({
        adresse: { ort, adresse, kartenLink },
        kontakte,
        infos: infos.abschnitte,
      });
    })
    .put(
      "/:id/notfall/karte",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", kartenSetzen),
      async (c) => {
        const person = c.get("person");
        const lagerId = c.get("lager").lager.id;
        const { kartenLink } = c.req.valid("json");
        await db.transaction(async (tx) => {
          await tx
            .update(lager)
            .set({ kartenLink })
            .where(eq(lager.id, lagerId));
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "lager_notfall_karte",
            zielTyp: "lager",
            zielId: lagerId,
            details: { gesetzt: kartenLink !== null },
          });
        });
        return c.json({ kartenLink });
      },
    )
    .post(
      "/:id/notfall/kontakte",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", kontaktAnlegen),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const werte = c.req.valid("json");
        const neu = await db.transaction(async (tx) => {
          await sperreLagerZeile(tx, lagerId);
          if (
            werte.personId &&
            !(await istMitglied(tx, lagerId, werte.personId))
          ) {
            return KEIN_MITGLIED;
          }
          const [ende] = await tx
            .select({
              n: sql<number>`coalesce(max(${notfallKontakt.reihenfolge}) + 1, 0)`,
            })
            .from(notfallKontakt)
            .where(
              and(
                eq(notfallKontakt.lagerId, lagerId),
                isNull(notfallKontakt.geloeschtAm),
              ),
            );
          return legeZeileAn(
            tx,
            notfallKontakt,
            { lagerId, personId: c.get("person").id },
            { ...werte, reihenfolge: werte.reihenfolge ?? ende!.n },
          );
        });
        if ("code" in neu) return c.json(neu, 400);
        return c.json((await ladeKontakte(db, lagerId, neu.id))[0], 201);
      },
    )
    .patch(
      "/:id/notfall/kontakte/:kontaktId",
      bearbeiten,
      eingabe("param", kontaktPfad),
      eingabe("json", kontaktAendern),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const { kontaktId } = c.req.valid("param");
        const { version, ...werte } = c.req.valid("json");
        const ergebnis = await db.transaction(async (tx) => {
          await sperreLagerZeile(tx, lagerId);
          const zeile = await kontaktDa(tx, lagerId, kontaktId);
          // Der Name gehört zu einem Kontakt ohne Konto; dessen Nummer bleibt Pflicht
          if (werte.name !== undefined && zeile.personId) {
            throw new HTTPException(400);
          }
          if (
            zeile.name !== null &&
            (werte.telefon === null ||
              (werte.telefon === undefined && zeile.telefon === null))
          ) {
            return NUMMER_FEHLT;
          }
          return aendereZeile(
            tx,
            notfallKontakt,
            { lagerId, personId: c.get("person").id },
            { id: kontaktId, version, werte, ansicht: kontaktAnsicht },
          );
        });
        if ("code" in ergebnis) return c.json(ergebnis, 400);
        return c.json((await ladeKontakte(db, lagerId, kontaktId))[0]);
      },
    )
    .delete(
      "/:id/notfall/kontakte/:kontaktId",
      bearbeiten,
      eingabe("param", kontaktPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const { kontaktId } = c.req.valid("param");
        await db.transaction(async (tx) => {
          await sperreLagerZeile(tx, lagerId);
          await kontaktDa(tx, lagerId, kontaktId);
          await loescheZeile(
            tx,
            notfallKontakt,
            { lagerId, personId: c.get("person").id },
            {
              id: kontaktId,
              version: c.req.valid("query").version,
              ansicht: kontaktAnsicht,
            },
          );
        });
        return c.body(null, 204);
      },
    );
}
