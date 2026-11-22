import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  MAX_VERSCHIEBUNG,
  verschiebeMeilenstein,
  verschiebenSchema,
  zeigeVerschiebung,
} from "../../lager/fristen.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { versionAbfrage } from "../../lager/ressorts.js";
import {
  abschnittAendern,
  abschnittAnlegen,
  aendereAbschnitt,
  aendereLagertag,
  aendereMeilenstein,
  lagertagAendern,
  lagertagAnlegen,
  legeAbschnittAn,
  legeLagertagAn,
  legeMeilensteinAn,
  ladeVorschlag,
  ladeZeitplan,
  loescheAbschnitt,
  loescheLagertag,
  loescheMeilenstein,
  meilensteinAendern,
  meilensteinAnlegen,
  uebernehme,
  uebernehmenSchema,
  type ZeitplanFehler,
} from "../../lager/zeitplan.js";
import type { Fcm } from "../../push.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const meilensteinPfad = z.strictObject({
  id: z.uuid(),
  meilensteinId: z.uuid(),
});
const lagertagPfad = z.strictObject({ id: z.uuid(), lagertagId: z.uuid() });
const abschnittPfad = z.strictObject({ id: z.uuid(), abschnittId: z.uuid() });

const FEHLER_TEXT: Record<ZeitplanFehler, [number, string]> = {
  LIMIT_ERREICHT: [409, "Mehr Einträge sind in diesem Lager nicht möglich."],
  TAG_VORHANDEN: [409, "Diesen Tag gibt es im Lager schon."],
  ABSCHNITT_VORHANDEN: [409, "Diesen Abschnitt gibt es im Lager schon."],
  AUSSERHALB_LAGER: [
    400,
    "Der Tag liegt nicht zwischen Beginn und Ende des Lagers.",
  ],
};
const fehlerAntwort = (fehler: ZeitplanFehler) => {
  const [status, message] = FEHLER_TEXT[fehler];
  return { status: status as 400 | 409, body: { code: fehler, message } };
};

// Zeitplan des Lagers (#374): Meilensteine, Lagertage, Tagesabschnitte und die Verschiebung eines Meilensteins mit Vorschau. Lesen braucht zeitplan.lesen, Ändern zeitplan.bearbeiten (Standard: nur die Lagerleitung); die Verschiebung ändert Fristen von Aufgaben und braucht darum zusätzlich aufgaben.bearbeiten. Alle Schreibwege gehen durch lager/sync.ts (Version, 409 VERSION_KONFLIKT, Feed). Die Lagerleitung bestätigt Vorschläge (Tage, Abschnitte) mit einem eigenen Aufruf; GET /zeitplan/vorschlag ändert nichts
export function erstelleZeitplanRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const lesen = lagerZugriff(db, { recht: "zeitplan.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "zeitplan.bearbeiten" });

  return (
    new Hono<LagerEnv>()
      // Der ganze Zeitplan in einer Abfrage (die Listen sind je Lager begrenzt, keine Seiten)
      .get("/:id/zeitplan", lesen, eingabe("param", lagerPfad), async (c) =>
        c.json(await ladeZeitplan(db, c.get("lager").lager.id)),
      )
      .get(
        "/:id/zeitplan/vorschlag",
        bearbeiten,
        eingabe("param", lagerPfad),
        async (c) => c.json(await ladeVorschlag(db, c.get("lager").lager)),
      )
      .post(
        "/:id/zeitplan/uebernehmen",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", uebernehmenSchema),
        async (c) => {
          const zugriff = c.get("lager");
          const ergebnis = await db.transaction((tx) =>
            uebernehme(
              tx,
              { lagerId: zugriff.lager.id, personId: c.get("person").id },
              zugriff.lager,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const { status, body } = fehlerAntwort(ergebnis.fehler);
            return c.json(body, status);
          }
          return c.json(ergebnis, 201);
        },
      )
      .post(
        "/:id/zeitplan/meilensteine",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", meilensteinAnlegen),
        async (c) => {
          const ergebnis = await db.transaction((tx) =>
            legeMeilensteinAn(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const { status, body } = fehlerAntwort(ergebnis.fehler);
            return c.json(body, status);
          }
          return c.json(ergebnis.meilenstein, 201);
        },
      )
      .patch(
        "/:id/zeitplan/meilensteine/:meilensteinId",
        bearbeiten,
        eingabe("param", meilensteinPfad),
        eingabe("json", meilensteinAendern),
        async (c) =>
          c.json(
            await db.transaction((tx) =>
              aendereMeilenstein(
                tx,
                {
                  lagerId: c.get("lager").lager.id,
                  personId: c.get("person").id,
                },
                c.req.valid("param").meilensteinId,
                c.req.valid("json"),
              ),
            ),
          ),
      )
      .delete(
        "/:id/zeitplan/meilensteine/:meilensteinId",
        bearbeiten,
        eingabe("param", meilensteinPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          await db.transaction((tx) =>
            loescheMeilenstein(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").meilensteinId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
      // Das Datum eines Meilensteins ändert nur diese Route. trocken: true zeigt die Vorschau (betroffene Aufgaben mit alter und neuer Frist, nichts wird geschrieben); trocken: false schreibt, wenn die Aufgaben mit ihrer Version aus der Vorschau noch stimmen
      .post(
        "/:id/zeitplan/meilensteine/:meilensteinId/verschieben",
        bearbeiten,
        eingabe("param", meilensteinPfad),
        eingabe("json", verschiebenSchema),
        async (c) => {
          const zugriff = c.get("lager");
          // Verschiebt Fristen von Aufgaben: wer sie nicht bearbeiten darf, verschiebt auch keinen Meilenstein
          if (!darf(zugriff, "aufgaben.bearbeiten")) {
            return c.json(
              {
                code: "RECHT_FEHLT",
                message:
                  "Für die Verschiebung brauchst du das Recht, Aufgaben zu bearbeiten.",
              },
              403,
            );
          }
          const lagerId = zugriff.lager.id;
          const { meilensteinId } = c.req.valid("param");
          const p = c.req.valid("json");
          const fehlerAntwortFuer = (
            fehler: "KEINE_AENDERUNG" | "ZU_VIELE_AUFGABEN",
          ) =>
            fehler === "KEINE_AENDERUNG"
              ? {
                  code: fehler,
                  message: "Der Meilenstein steht schon an diesem Datum.",
                }
              : {
                  code: fehler,
                  message: `Am Meilenstein hängen mehr als ${MAX_VERSCHIEBUNG} Aufgaben.`,
                };
          if (p.trocken || !p.aufgaben) {
            const vorschau = await zeigeVerschiebung(
              db,
              lagerId,
              meilensteinId,
              p.datum,
            );
            if (!vorschau) throw new HTTPException(404);
            if ("fehler" in vorschau) {
              return c.json(fehlerAntwortFuer(vorschau.fehler), 400);
            }
            return c.json({ trocken: true, ...vorschau });
          }
          const ergebnis = await db.transaction((tx) =>
            verschiebeMeilenstein(
              tx,
              { lagerId, personId: c.get("person").id },
              meilensteinId,
              {
                version: p.version,
                datum: p.datum,
                aufgaben: p.aufgaben ?? [],
              },
            ),
          );
          if (!ergebnis) throw new HTTPException(404);
          if ("fehler" in ergebnis) {
            if (ergebnis.fehler === "VORSCHAU_VERALTET") {
              return c.json(
                {
                  code: ergebnis.fehler,
                  message:
                    "Die Aufgaben am Meilenstein haben sich geändert. Prüfe die neue Vorschau.",
                  vorschau: ergebnis.vorschau,
                },
                409,
              );
            }
            return c.json(fehlerAntwortFuer(ergebnis.fehler), 400);
          }
          await ergebnis.zustellung.senden({ db, fcm, c });
          return c.json({
            trocken: false,
            meilenstein: ergebnis.meilenstein,
            aufgaben: ergebnis.aufgaben,
          });
        },
      )
      .post(
        "/:id/zeitplan/lagertage",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", lagertagAnlegen),
        async (c) => {
          const zugriff = c.get("lager");
          const ergebnis = await db.transaction((tx) =>
            legeLagertagAn(
              tx,
              { lagerId: zugriff.lager.id, personId: c.get("person").id },
              zugriff.lager,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const { status, body } = fehlerAntwort(ergebnis.fehler);
            return c.json(body, status);
          }
          return c.json(ergebnis.lagertag, 201);
        },
      )
      .patch(
        "/:id/zeitplan/lagertage/:lagertagId",
        bearbeiten,
        eingabe("param", lagertagPfad),
        eingabe("json", lagertagAendern),
        async (c) => {
          const zugriff = c.get("lager");
          const ergebnis = await db.transaction((tx) =>
            aendereLagertag(
              tx,
              { lagerId: zugriff.lager.id, personId: c.get("person").id },
              zugriff.lager,
              c.req.valid("param").lagertagId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const { status, body } = fehlerAntwort(ergebnis.fehler);
            return c.json(body, status);
          }
          return c.json(ergebnis.lagertag);
        },
      )
      .delete(
        "/:id/zeitplan/lagertage/:lagertagId",
        bearbeiten,
        eingabe("param", lagertagPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          await db.transaction((tx) =>
            loescheLagertag(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").lagertagId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
      .post(
        "/:id/zeitplan/tagesabschnitte",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", abschnittAnlegen),
        async (c) => {
          const ergebnis = await db.transaction((tx) =>
            legeAbschnittAn(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const { status, body } = fehlerAntwort(ergebnis.fehler);
            return c.json(body, status);
          }
          return c.json(ergebnis.abschnitt, 201);
        },
      )
      .patch(
        "/:id/zeitplan/tagesabschnitte/:abschnittId",
        bearbeiten,
        eingabe("param", abschnittPfad),
        eingabe("json", abschnittAendern),
        async (c) => {
          const ergebnis = await db.transaction((tx) =>
            aendereAbschnitt(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").abschnittId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const { status, body } = fehlerAntwort(ergebnis.fehler);
            return c.json(body, status);
          }
          return c.json(ergebnis.abschnitt);
        },
      )
      .delete(
        "/:id/zeitplan/tagesabschnitte/:abschnittId",
        bearbeiten,
        eingabe("param", abschnittPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          await db.transaction((tx) =>
            loescheAbschnitt(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").abschnittId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
  );
}
