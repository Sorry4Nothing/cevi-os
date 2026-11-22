import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { dokument } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { ladeSichtbareDatei } from "../../lager/datei.js";
import {
  dokumentAendern,
  dokumentAnlegen,
  dokumentAnsicht,
  dokumenteAbfrage,
  ladeDokumente,
  versionAbfrage,
} from "../../lager/dokumente.js";
import {
  lagerZugriff,
  type LagerEnv,
  type LagerZugriff,
} from "../../lager/policy.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const dokumentPfad = z.strictObject({ id: z.uuid(), dokumentId: z.uuid() });

// Dokumente im Lager (#396), Beschreibung in lager/dokumente.ts. Lesen: dokumente.lesen_alle (alle) oder dokumente.team_lesen (nur team_sichtbar); Schreiben: dokumente.bearbeiten. Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed. Löschen ist ein Soft-Delete (Papierkorb) und entfernt nie die Datei am Ablageort
export function erstelleDokumentRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, {
    einesDerRechte: ["dokumente.lesen_alle", "dokumente.team_lesen"],
  });
  const bearbeiten = lagerZugriff(db, { recht: "dokumente.bearbeiten" });

  // Das Dokument, soweit die Person es sieht; sonst 404 (auch für ein Dokument eines fremden Lagers)
  async function dokumentDa(zugriff: LagerZugriff, id: string) {
    const { eintraege } = await ladeDokumente(db, zugriff, { id });
    if (!eintraege[0]) throw new HTTPException(404);
    return eintraege[0];
  }

  // Die Datei muss die Person sehen (selbst in den letzten 24 Stunden hinzugefügt oder über einen lesbaren Datensatz) und zu diesem Lager gehören; sonst 400. So bindet niemand eine Datei ein, die er nicht kennt
  const dateiPruefen = async (
    zugriff: LagerZugriff,
    personId: string,
    dateiId: string,
  ) => !!(await ladeSichtbareDatei(db, zugriff, personId, dateiId));
  const DATEI_UNBEKANNT = {
    code: "DATEI_UNBEKANNT",
    message: "Diese Datei gibt es in diesem Lager nicht.",
  } as const;

  const antwort = async (zugriff: LagerZugriff, id: string) =>
    (await ladeDokumente(db, zugriff, { id, ungefiltert: true })).eintraege[0];

  return new Hono<LagerEnv>()
    .get(
      "/:id/dokumente",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", dokumenteAbfrage),
      async (c) => {
        const { stichwort, ...abfrage } = c.req.valid("query");
        const { eintraege, naechster } = await ladeDokumente(
          db,
          c.get("lager"),
          {
            ...abfrage,
            stichworte: stichwort,
          },
        );
        return c.json({ dokumente: eintraege, naechster });
      },
    )
    .post(
      "/:id/dokumente",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", dokumentAnlegen),
      async (c) => {
        const zugriff = c.get("lager");
        const person = c.get("person");
        const werte = c.req.valid("json");
        if (!(await dateiPruefen(zugriff, person.id, werte.dateiId))) {
          return c.json(DATEI_UNBEKANNT, 400);
        }
        const neu = await db.transaction((tx) =>
          legeZeileAn(
            tx,
            dokument,
            { lagerId: zugriff.lager.id, personId: person.id },
            werte,
          ),
        );
        return c.json(await antwort(zugriff, neu.id), 201);
      },
    )
    .get(
      "/:id/dokumente/:dokumentId",
      lesen,
      eingabe("param", dokumentPfad),
      async (c) =>
        c.json(
          await dokumentDa(c.get("lager"), c.req.valid("param").dokumentId),
        ),
    )
    .patch(
      "/:id/dokumente/:dokumentId",
      bearbeiten,
      eingabe("param", dokumentPfad),
      eingabe("json", dokumentAendern),
      async (c) => {
        const zugriff = c.get("lager");
        const person = c.get("person");
        const { dokumentId } = c.req.valid("param");
        const { version, ...werte } = c.req.valid("json");
        await dokumentDa(zugriff, dokumentId);
        if (
          werte.dateiId &&
          !(await dateiPruefen(zugriff, person.id, werte.dateiId))
        ) {
          return c.json(DATEI_UNBEKANNT, 400);
        }
        await db.transaction((tx) =>
          aendereZeile(
            tx,
            dokument,
            { lagerId: zugriff.lager.id, personId: person.id },
            { id: dokumentId, version, werte, ansicht: dokumentAnsicht },
          ),
        );
        return c.json(await antwort(zugriff, dokumentId));
      },
    )
    .delete(
      "/:id/dokumente/:dokumentId",
      bearbeiten,
      eingabe("param", dokumentPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const zugriff = c.get("lager");
        const { dokumentId } = c.req.valid("param");
        await dokumentDa(zugriff, dokumentId);
        await db.transaction((tx) =>
          loescheZeile(
            tx,
            dokument,
            { lagerId: zugriff.lager.id, personId: c.get("person").id },
            {
              id: dokumentId,
              version: c.req.valid("query").version,
              ansicht: dokumentAnsicht,
            },
          ),
        );
        return c.body(null, 204);
      },
    );
}
