import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { beitragLesbar } from "../../lager/pinnwand.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import type { LagerZugriff } from "../../lager/policy.js";
import {
  ladeReaktionen,
  loescheReaktion,
  reaktionSetzen,
  setzeReaktion,
  ZIEL_TYPEN,
  type ZielTyp,
} from "../../lager/umfragen.js";

const zielPfad = z.strictObject({
  id: z.uuid(),
  zielTyp: z.enum(ZIEL_TYPEN),
  zielId: z.uuid(),
});

// Lesbarkeit je Ziel-Typ (Sichtbarkeit folgt dem Ziel) und das Recht, das der Typ zum Lesen braucht
const ZIELE: Record<
  ZielTyp,
  {
    recht: Parameters<typeof darf>[1];
    lesbar: (db: Db, z: LagerZugriff, id: string) => Promise<boolean>;
  }
> = {
  pinnwand_beitrag: { recht: "pinnwand.lesen", lesbar: beitragLesbar },
};

// Reaktionen (#382): fünf feste Schlüssel (daumen, herz, lachen, staunen, danke), eine je Person und Ziel; das Team setzt und löscht nur die eigene. Die Zähler stehen an den Beiträgen der Pinnwand (reaktionen), diese Routen schreiben und liefern denselben Stand zurück. Recht: interaktion.schreiben und das Leserecht des Ziels
export function erstelleReaktionenRouten({ db }: { db: Db }) {
  const schreiben = lagerZugriff(db, { recht: "interaktion.schreiben" });
  // Das Ziel muss in diesem Lager liegen und für die Person lesbar sein, sonst 404
  const pruefeZiel = async (
    zugriff: LagerZugriff,
    zielTyp: ZielTyp,
    zielId: string,
  ) => {
    if (!darf(zugriff, ZIELE[zielTyp].recht)) throw new HTTPException(403);
    if (!(await ZIELE[zielTyp].lesbar(db, zugriff, zielId))) {
      throw new HTTPException(404);
    }
  };

  return new Hono<LagerEnv>()
    .put(
      "/:id/reaktionen/:zielTyp/:zielId",
      schreiben,
      eingabe("param", zielPfad),
      eingabe("json", reaktionSetzen),
      async (c) => {
        const zugriff = c.get("lager");
        const { zielTyp, zielId } = c.req.valid("param");
        await pruefeZiel(zugriff, zielTyp, zielId);
        await setzeReaktion(
          db,
          { lagerId: zugriff.lager.id, personId: c.get("person").id },
          zielTyp,
          zielId,
          c.req.valid("json").emoji,
        );
        return c.json(
          (await ladeReaktionen(db, zugriff, zielTyp, [zielId])).get(zielId),
        );
      },
    )
    .delete(
      "/:id/reaktionen/:zielTyp/:zielId",
      schreiben,
      eingabe("param", zielPfad),
      async (c) => {
        const zugriff = c.get("lager");
        const { zielTyp, zielId } = c.req.valid("param");
        await pruefeZiel(zugriff, zielTyp, zielId);
        await loescheReaktion(
          db,
          { lagerId: zugriff.lager.id, personId: c.get("person").id },
          zielTyp,
          zielId,
        );
        return c.body(null, 204);
      },
    );
}
