import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { infoAbschnitt, infoAbschnittDatei } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  infoAendern,
  infoAnlegen,
  infoAnsicht,
  infoDateiAnsicht,
  ladeInfos,
  pruefeDateien,
  sperreLagerZeile,
  versionAbfrage,
} from "../../lager/lagerinfos.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { reihenfolgeSetzen } from "../../lager/ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const INFOS_MAX = 200;
const SEITE = 100;

const lagerPfad = z.strictObject({ id: z.uuid() });
const abschnittPfad = z.strictObject({ id: z.uuid(), abschnittId: z.uuid() });
const seiteAbfrage = z.strictObject({
  // Cursor: die ID des letzten Abschnitts der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});

// Infos (#393), Beschreibung in lager/lagerinfos.ts: Abschnitte mit Text, Links und Dateien als Verknüpfungen (lager_datei, #370; nie Upload), in einer Reihenfolge. Lesen braucht infos.lesen, jede Änderung infos.bearbeiten (über den Sync-Kern mit Version und Feed). Abschnitte mit nur_lagerleitung liest nur, wer vertrauliches.lesen hat (sonst 404). Das Merkmal «notfall» zeigt den Abschnitt im Notfall-Fenster; es setzen und einen solchen Abschnitt ändern darf nur, wer auch notfall.bearbeiten hat
export function erstelleInfosRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "infos.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "infos.bearbeiten" });

  // Der Abschnitt gibt es in diesem Lager und die Rolle darf ihn sehen, sonst 404
  async function abschnittDa(
    tx: Pick<Db, "select">,
    lagerId: string,
    id: string,
    vertraulich: boolean,
  ) {
    const [zeile] = await tx
      .select()
      .from(infoAbschnitt)
      .where(
        and(
          eq(infoAbschnitt.id, id),
          eq(infoAbschnitt.lagerId, lagerId),
          vertraulich ? undefined : eq(infoAbschnitt.nurLagerleitung, false),
        ),
      );
    if (!zeile) throw new HTTPException(404);
    return zeile;
  }

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/infos",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", seiteAbfrage),
        async (c) =>
          c.json(
            await ladeInfos(
              db,
              c.get("lager").lager.id,
              darf(c.get("lager"), "vertrauliches.lesen"),
              c.req.valid("query"),
            ),
          ),
      )
      .post(
        "/:id/infos",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", infoAnlegen),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const { dateiIds = [], ...felder } = c.req.valid("json");
          if (felder.notfall && !darf(zugriff, "notfall.bearbeiten")) {
            throw new HTTPException(403);
          }
          await pruefeDateien(db, lagerId, dateiIds);
          const neu = await db.transaction(async (tx) => {
            await sperreLagerZeile(tx, lagerId);
            const [stand] = await tx
              .select({
                n: sql<number>`count(*)::int`,
                ende: sql<number>`coalesce(max(${infoAbschnitt.reihenfolge}) + 1, 0)`,
              })
              .from(infoAbschnitt)
              .where(and(eq(infoAbschnitt.lagerId, lagerId)));
            if (stand!.n >= INFOS_MAX) return undefined;
            const k = { lagerId, personId: c.get("person").id };
            const zeile = await legeZeileAn(tx, infoAbschnitt, k, {
              ...felder,
              reihenfolge: felder.reihenfolge ?? stand!.ende,
            });
            for (const dateiId of dateiIds) {
              await legeZeileAn(tx, infoAbschnittDatei, k, {
                abschnittId: zeile.id,
                dateiId,
              });
            }
            return zeile;
          });
          if (!neu) {
            return c.json(
              {
                code: "LIMIT_ERREICHT",
                message: "Das Lager hat die höchste Zahl an Info-Abschnitten.",
              },
              409,
            );
          }
          const { abschnitte } = await ladeInfos(db, lagerId, true, {
            id: neu.id,
          });
          return c.json(abschnitte[0], 201);
        },
      )
      // Vor «/:abschnittId», damit «reihenfolge» nicht als ID gilt
      .put(
        "/:id/infos/reihenfolge",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", reihenfolgeSetzen),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const vertraulich = darf(zugriff, "vertrauliches.lesen");
          const { eintraege } = c.req.valid("json");
          await db.transaction(async (tx) => {
            await sperreLagerZeile(tx, lagerId);
            const vorhanden = await tx
              .select()
              .from(infoAbschnitt)
              .where(
                and(
                  eq(infoAbschnitt.lagerId, lagerId),
                  vertraulich
                    ? undefined
                    : eq(infoAbschnitt.nurLagerleitung, false),
                ),
              );
            const nachId = new Map(vorhanden.map((z) => [z.id, z]));
            if (eintraege.some((e) => !nachId.has(e.id))) {
              throw new HTTPException(404);
            }
            // Die Stelle in der Liste ist die neue Reihenfolge; was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag)
            for (const [stelle, e] of eintraege.entries()) {
              if (nachId.get(e.id)!.reihenfolge === stelle) continue;
              await aendereZeile(
                tx,
                infoAbschnitt,
                { lagerId, personId: c.get("person").id },
                {
                  id: e.id,
                  version: e.version,
                  werte: { reihenfolge: stelle },
                  ansicht: infoAnsicht,
                },
              );
            }
          });
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/infos/:abschnittId",
        lesen,
        eingabe("param", abschnittPfad),
        async (c) => {
          const { abschnitte } = await ladeInfos(
            db,
            c.get("lager").lager.id,
            darf(c.get("lager"), "vertrauliches.lesen"),
            { id: c.req.valid("param").abschnittId },
          );
          if (!abschnitte[0]) throw new HTTPException(404);
          return c.json(abschnitte[0]);
        },
      )
      .patch(
        "/:id/infos/:abschnittId",
        bearbeiten,
        eingabe("param", abschnittPfad),
        eingabe("json", infoAendern),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const { abschnittId } = c.req.valid("param");
          const { version, dateiIds, ...werte } = c.req.valid("json");
          if (dateiIds) await pruefeDateien(db, lagerId, dateiIds);
          await db.transaction(async (tx) => {
            await sperreLagerZeile(tx, lagerId);
            const zeile = await abschnittDa(
              tx,
              lagerId,
              abschnittId,
              darf(zugriff, "vertrauliches.lesen"),
            );
            if (
              (zeile.notfall || werte.notfall) &&
              !darf(zugriff, "notfall.bearbeiten")
            ) {
              throw new HTTPException(403);
            }
            const k = { lagerId, personId: c.get("person").id };
            // Auch wenn nur die Dateien ändern, steigt die Version des Abschnitts: So merkt eine App mit altem Stand den Konflikt
            await aendereZeile(tx, infoAbschnitt, k, {
              id: abschnittId,
              version,
              werte,
              ansicht: infoAnsicht,
            });
            if (!dateiIds) return;
            const vorhanden = await tx
              .select()
              .from(infoAbschnittDatei)
              .where(
                and(
                  eq(infoAbschnittDatei.lagerId, lagerId),
                  eq(infoAbschnittDatei.abschnittId, abschnittId),
                ),
              );
            for (const v of vorhanden) {
              if (!dateiIds.includes(v.dateiId)) {
                await loescheZeile(tx, infoAbschnittDatei, k, {
                  id: v.id,
                  version: v.version,
                  ansicht: infoDateiAnsicht,
                });
              }
            }
            const da = new Set(vorhanden.map((v) => v.dateiId));
            for (const dateiId of dateiIds) {
              if (!da.has(dateiId)) {
                await legeZeileAn(tx, infoAbschnittDatei, k, {
                  abschnittId,
                  dateiId,
                });
              }
            }
          });
          const { abschnitte } = await ladeInfos(db, lagerId, true, {
            id: abschnittId,
          });
          return c.json(abschnitte[0]);
        },
      )
      .delete(
        "/:id/infos/:abschnittId",
        bearbeiten,
        eingabe("param", abschnittPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const { abschnittId } = c.req.valid("param");
          await db.transaction(async (tx) => {
            await sperreLagerZeile(tx, lagerId);
            const zeile = await abschnittDa(
              tx,
              lagerId,
              abschnittId,
              darf(zugriff, "vertrauliches.lesen"),
            );
            if (zeile.notfall && !darf(zugriff, "notfall.bearbeiten")) {
              throw new HTTPException(403);
            }
            await loescheZeile(
              tx,
              infoAbschnitt,
              { lagerId, personId: c.get("person").id },
              {
                id: abschnittId,
                version: c.req.valid("query").version,
                ansicht: infoAnsicht,
              },
            );
          });
          return c.body(null, 204);
        },
      )
  );
}
