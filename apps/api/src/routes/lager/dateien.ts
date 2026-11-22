import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { lagerDatei } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  DATEI_RECHTE,
  dateiAnsicht,
  dateiSchema,
  ladeDateiHosts,
  ladeSichtbareDatei,
  pruefeLink,
} from "../../lager/datei.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { legeZeileAn, loescheZeile } from "../../lager/sync.js";

// Dateien im Lager als Verknüpfung (#370), Beschreibung in lager/datei.ts. Es gibt keinen Upload und keine Auslieferung von Inhalt: Die Routen speichern, zeigen und löschen nur die Verknüpfung, und löschen entfernt nie die Datei am Ablageort. Eine Liste gibt es nicht; die Module, die Dateien einbinden, liefern die Einträge ihrer Datensätze (ladeDateien)
const UPLOADS = 30;
const FENSTER_MS = 10 * 60_000;
const pfad = () => z.strictObject({ id: z.uuid(), dateiId: z.uuid() });
const loeschen = () =>
  z.strictObject({ version: z.coerce.number().int().min(1) });

export function erstelleLagerDateiRouten({ db }: { db: Db }) {
  // Rate-Limit je Konto (SR-71)
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= UPLOADS;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };

  return (
    new Hono<LagerEnv>()
      // Recht: eines der Module, die Dateien einbinden, bearbeiten dürfen (403 vor dem Schreibschutz 409)
      .post(
        "/:id/dateien",
        lagerZugriff(db, { einesDerRechte: DATEI_RECHTE }),
        eingabe("json", dateiSchema),
        async (c) => {
          const zugriff = c.get("lager");
          const person = c.get("person");
          if (zuViele(person.id)) throw new HTTPException(429);
          const felder = c.req.valid("json");
          const link = pruefeLink(
            felder.link,
            await ladeDateiHosts(db, zugriff.lager.abteilungId),
          );
          if (!link.ok) {
            return c.json(
              link.grund === "host"
                ? {
                    code: "LINK_HOST_NICHT_ERLAUBT",
                    message:
                      "Dieser Link liegt nicht auf einem Host, den die Abteilung erlaubt.",
                  }
                : {
                    code: "LINK_UNGUELTIG",
                    message:
                      "Der Link muss mit https:// beginnen und darf weder Zugangsdaten noch einen Port enthalten.",
                  },
              400,
            );
          }
          const neu = await db.transaction((tx) =>
            legeZeileAn(
              tx,
              lagerDatei,
              { lagerId: zugriff.lager.id, personId: person.id },
              {
                anzeigename: felder.anzeigename,
                link: link.link,
                typ: felder.typ ?? null,
                groesse: felder.groesse ?? null,
              },
            ),
          );
          return c.json(dateiAnsicht(neu), 201);
        },
      )
      // Unsichtbar (404): kein Eintrag im Lager, oder keiner, den die Person über einen lesbaren Datensatz sieht
      .get(
        "/:id/dateien/:dateiId",
        eingabe("param", pfad()),
        lagerZugriff(db),
        async (c) => {
          const datei = await ladeSichtbareDatei(
            db,
            c.get("lager"),
            c.get("person").id,
            c.req.valid("param").dateiId,
          );
          if (!datei) throw new HTTPException(404);
          return c.json(dateiAnsicht(datei));
        },
      )
      // Löscht nur die Verknüpfung (endgültig, über den Sync-Kern), nie die Datei am Ablageort. Gleiches Recht wie beim Anlegen
      .delete(
        "/:id/dateien/:dateiId",
        eingabe("param", pfad()),
        eingabe("query", loeschen()),
        lagerZugriff(db, { einesDerRechte: DATEI_RECHTE }),
        async (c) => {
          const zugriff = c.get("lager");
          const person = c.get("person");
          const datei = await ladeSichtbareDatei(
            db,
            zugriff,
            person.id,
            c.req.valid("param").dateiId,
          );
          if (!datei) throw new HTTPException(404);
          await db.transaction((tx) =>
            loescheZeile(
              tx,
              lagerDatei,
              { lagerId: zugriff.lager.id, personId: person.id },
              {
                id: datei.id,
                version: c.req.valid("query").version,
                ansicht: dateiAnsicht,
              },
            ),
          );
          return c.body(null, 204);
        },
      )
  );
}
