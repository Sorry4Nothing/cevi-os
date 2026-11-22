import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import type { Fcm } from "../../push.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import {
  aendereBeitrag,
  beitragAendern,
  beitragAnlegen,
  fehlerAntwort,
  kannAlleSehen,
  ladeBeitraege,
  legeBeitragAn,
  listeAbfrage,
  loescheBeitrag,
  versionAbfrage,
} from "../../lager/pinnwand.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const beitragPfad = z.strictObject({ id: z.uuid(), beitragId: z.uuid() });

// Pinnwand eines Lagers (#381), Beschreibung in lager/pinnwand.ts. Lesen braucht pinnwand.lesen, jede Änderung pinnwand.bearbeiten (lager/rechte-katalog.ts). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed; Löschen ist endgültig (#427). Die Schreibwege (legeBeitragAn, aendereBeitrag, loescheBeitrag) liegen in lager/pinnwand.ts: Die Operationen der Warteschlange (#521) rufen dieselben auf
export function erstellePinnwandRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const lesen = lagerZugriff(db, { recht: "pinnwand.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "pinnwand.bearbeiten" });

  return new Hono<LagerEnv>()
    .get(
      "/:id/pinnwand",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", listeAbfrage),
      async (c) => {
        const zugriff = c.get("lager");
        const { status, nach, limit } = c.req.valid("query");
        // Vergangenes und Künftiges sieht nur, wer die Pinnwand verwalten darf
        if (status === "alle" && !kannAlleSehen(zugriff)) {
          throw new HTTPException(403);
        }
        return c.json(
          await ladeBeitraege(db, zugriff, {
            nach,
            limit,
            alle: status === "alle",
          }),
        );
      },
    )
    .post(
      "/:id/pinnwand",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", beitragAnlegen),
      async (c) => {
        const zugriff = c.get("lager");
        const person = c.get("person");
        const felder = c.req.valid("json");
        const ergebnis = await db.transaction((tx) =>
          legeBeitragAn(tx, zugriff, person, felder),
        );
        if ("fehler" in ergebnis) return c.json(fehlerAntwort(ergebnis), 400);
        // Nach dem Commit: Ein Fehler beim Push lässt den Beitrag stehen
        await ergebnis.zustellung?.senden({ db, fcm, c });
        const { beitraege } = await ladeBeitraege(db, zugriff, {
          id: ergebnis.id,
          limit: 1,
          alle: true,
        });
        return c.json(beitraege[0], 201);
      },
    )
    .get(
      "/:id/pinnwand/:beitragId",
      lesen,
      eingabe("param", beitragPfad),
      async (c) => {
        // Ausserhalb des Zeitfensters oder nicht für die Person gemeint: für wen nicht verwaltet, gibt es den Beitrag nicht (404)
        const { beitraege } = await ladeBeitraege(db, c.get("lager"), {
          id: c.req.valid("param").beitragId,
          limit: 1,
          alle: true,
        });
        if (!beitraege[0]) throw new HTTPException(404);
        return c.json(beitraege[0]);
      },
    )
    .patch(
      "/:id/pinnwand/:beitragId",
      bearbeiten,
      eingabe("param", beitragPfad),
      eingabe("json", beitragAendern),
      async (c) => {
        const zugriff = c.get("lager");
        const { beitragId } = c.req.valid("param");
        const ergebnis = await db.transaction((tx) =>
          aendereBeitrag(
            tx,
            zugriff,
            c.get("person"),
            beitragId,
            c.req.valid("json"),
          ),
        );
        if ("fehler" in ergebnis) return c.json(fehlerAntwort(ergebnis), 400);
        await ergebnis.zustellung?.senden({ db, fcm, c });
        const { beitraege } = await ladeBeitraege(db, zugriff, {
          id: beitragId,
          limit: 1,
          alle: true,
        });
        return c.json(beitraege[0]);
      },
    )
    .delete(
      "/:id/pinnwand/:beitragId",
      bearbeiten,
      eingabe("param", beitragPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        await db.transaction((tx) =>
          loescheBeitrag(
            tx,
            {
              lagerId: c.get("lager").lager.id,
              personId: c.get("person").id,
            },
            c.req.valid("param").beitragId,
            c.req.valid("query").version,
          ),
        );
        return c.body(null, 204);
      },
    );
}
