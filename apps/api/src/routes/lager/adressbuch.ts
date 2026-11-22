import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { adressbuchKontakt, auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  kontaktAendern,
  kontaktAnlegen,
  kontaktAnsicht,
  kontakteAbfrage,
  ladeKontakte,
  versionAbfrage,
} from "../../lager/adressbuch.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const kontaktPfad = z.strictObject({ id: z.uuid(), kontaktId: z.uuid() });

// Adressbuch des Lagers (#397), Beschreibung in lager/adressbuch.ts. Lesen: adressbuch.lesen, Schreiben: adressbuch.bearbeiten (Standard: nur die Lagerleitung). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed. Jedes Lesen schreibt einen Audit-Eintrag mit Ziel und Anzahl, nie mit Inhalt
export function erstelleAdressbuchRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "adressbuch.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "adressbuch.bearbeiten" });

  async function protokolliere(
    person: { id: string; abteilungId: string },
    aktion: string,
    zielTyp: string,
    zielId: string,
    anzahl: number,
  ) {
    await db.insert(auditLog).values({
      abteilungId: person.abteilungId,
      akteurId: person.id,
      aktion,
      zielTyp,
      zielId,
      details: { anzahl },
    });
  }

  return new Hono<LagerEnv>()
    .get(
      "/:id/adressbuch",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", kontakteAbfrage),
      async (c) => {
        const { lager } = c.get("lager");
        const { kontakte, naechster } = await ladeKontakte(
          db,
          lager,
          c.req.valid("query"),
        );
        await protokolliere(
          c.get("person"),
          "lager_adressbuch_gelesen",
          "lager",
          lager.id,
          kontakte.length,
        );
        return c.json({ kontakte, naechster });
      },
    )
    .post(
      "/:id/adressbuch",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", kontaktAnlegen),
      async (c) => {
        const { lager } = c.get("lager");
        const neu = await db.transaction((tx) =>
          legeZeileAn(
            tx,
            adressbuchKontakt,
            { lagerId: lager.id, personId: c.get("person").id },
            c.req.valid("json"),
          ),
        );
        return c.json(kontaktAnsicht(neu, lager.bis), 201);
      },
    )
    .get(
      "/:id/adressbuch/:kontaktId",
      lesen,
      eingabe("param", kontaktPfad),
      async (c) => {
        const { lager } = c.get("lager");
        const { kontaktId } = c.req.valid("param");
        const { kontakte } = await ladeKontakte(db, lager, { id: kontaktId });
        if (!kontakte[0]) throw new HTTPException(404);
        await protokolliere(
          c.get("person"),
          "lager_adressbuch_gelesen",
          "adressbuch_kontakt",
          kontaktId,
          1,
        );
        return c.json(kontakte[0]);
      },
    )
    .patch(
      "/:id/adressbuch/:kontaktId",
      bearbeiten,
      eingabe("param", kontaktPfad),
      eingabe("json", kontaktAendern),
      async (c) => {
        const { lager } = c.get("lager");
        const { kontaktId } = c.req.valid("param");
        const { version, ...werte } = c.req.valid("json");
        await kontaktDa(db, lager.id, kontaktId);
        const geaendert = await db.transaction((tx) =>
          aendereZeile(
            tx,
            adressbuchKontakt,
            { lagerId: lager.id, personId: c.get("person").id },
            {
              id: kontaktId,
              version,
              werte,
              ansicht: (r) => kontaktAnsicht(r, lager.bis),
            },
          ),
        );
        return c.json(kontaktAnsicht(geaendert, lager.bis));
      },
    )
    .delete(
      "/:id/adressbuch/:kontaktId",
      bearbeiten,
      eingabe("param", kontaktPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const { lager } = c.get("lager");
        const { kontaktId } = c.req.valid("param");
        await kontaktDa(db, lager.id, kontaktId);
        await db.transaction((tx) =>
          loescheZeile(
            tx,
            adressbuchKontakt,
            { lagerId: lager.id, personId: c.get("person").id },
            {
              id: kontaktId,
              version: c.req.valid("query").version,
              ansicht: (r) => kontaktAnsicht(r, lager.bis),
            },
          ),
        );
        return c.body(null, 204);
      },
    );
}

// Der Kontakt dieses Lagers, nicht gelöscht; sonst 404 (auch für einen Kontakt eines fremden Lagers)
async function kontaktDa(db: Db, lagerId: string, id: string) {
  const [zeile] = await db
    .select({ id: adressbuchKontakt.id })
    .from(adressbuchKontakt)
    .where(
      and(eq(adressbuchKontakt.id, id), eq(adressbuchKontakt.lagerId, lagerId)),
    );
  if (!zeile) throw new HTTPException(404);
}
