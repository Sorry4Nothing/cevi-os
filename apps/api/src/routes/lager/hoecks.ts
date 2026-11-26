import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { idempotenzSchluessel } from "../../idempotenz.js";
import { erzeugeHoeckIcs } from "../../lager/hoeck-ics.js";
import {
  aendereHoeck,
  aendereTraktandum,
  entscheideAbfrage,
  hoeckAbfrage,
  hoeckAendern,
  hoeckAlleRechte,
  hoeckAnlegen,
  hoeckLeseRechte,
  hoeckUmfang,
  ladeEntscheide,
  ladeHoeck,
  ladeHoeckModus,
  ladeHoeckZeile,
  ladeHoecks,
  ladeTraktanden,
  ladeTraktandum,
  legeHoeckAn,
  legeTraktandumAn,
  loescheHoeck,
  loescheTraktandum,
  ordneTraktanden,
  pruefungAntwort,
  setzeHoeckAnwesenheit,
  traktandenUebernehmen,
  traktandumAendern,
  traktandumAnlegen,
  traktandumReihenfolge,
  uebernehmeTraktanden,
  versionAbfrage,
} from "../../lager/hoecks.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const hoeckPfad = z.strictObject({ id: z.uuid(), hoeckId: z.uuid() });
const anwesenderPfad = z.strictObject({
  id: z.uuid(),
  hoeckId: z.uuid(),
  personId: z.uuid(),
});
const traktandumPfad = z.strictObject({ id: z.uuid(), traktandumId: z.uuid() });

// Höcks, Traktanden, Anwesenheit, Höck-Modus, Entscheide und die Kalenderdatei eines Lagers (#378). Lesen: hoecks.lesen_alle oder hoecks.bearbeiten (alles), sonst hoecks.team_lesen (nur Team-Höcks, nur Datum, Zeit, Titel und Ort; ein Höck der Lagerleitung ist dann 404). Schreiben braucht hoecks.bearbeiten. Jede Schreibroute geht durch lager/sync.ts (Version prüfen, 409 VERSION_KONFLIKT, Folgenummer, Feed); Löschen allein über loescheZeile
export function erstelleHoeckRouten({ db }: { db: Db }) {
  // Die Rechte stehen in der Middleware (403 vor dem Schreibschutz 409); welches davon galt, fragt die Route selbst
  const lesen = lagerZugriff(db, { einesDerRechte: hoeckLeseRechte });
  const lesenAlle = lagerZugriff(db, { einesDerRechte: hoeckAlleRechte });
  const bearbeiten = lagerZugriff(db, { recht: "hoecks.bearbeiten" });

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/hoecks",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", hoeckAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          return c.json(
            await ladeHoecks(
              db,
              zugriff.lager.id,
              hoeckUmfang(zugriff)!,
              c.req.valid("query"),
            ),
          );
        },
      )
      .post(
        "/:id/hoecks",
        bearbeiten,
        idempotenzSchluessel(db),
        eingabe("param", lagerPfad),
        eingabe("json", hoeckAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const neu = await db.transaction((tx) =>
            legeHoeckAn(
              tx,
              { lagerId, personId: c.get("person").id },
              c.req.valid("json"),
            ),
          );
          return c.json(await ladeHoeck(db, lagerId, neu.id, "alle"), 201);
        },
      )
      // Vor «/hoecks/:hoeckId»: Hono kennt das Muster «:hoeckId.ics» nur als Namen eines Pfadteils, es passt auf jeden Pfadteil. Was nicht auf «.ics» endet, geht mit next() an die Route darunter, ohne dass die Policy zweimal läuft
      .get("/:id/hoecks/:hoeckId.ics", async (c, next) => {
        const teil = (c.req.param as (name: string) => string | undefined)(
          "hoeckId.ics",
        );
        if (!teil?.endsWith(".ics")) return next();
        // Dieselbe Policy wie die Daten: Lager, Mitgliedschaft, ein Leserecht für Höcks
        await lesen(c, async () => {});
        const id = z.uuid().safeParse(teil.slice(0, -4));
        if (!id.success) throw new HTTPException(400);
        const zugriff = c.get("lager");
        const zeile = await ladeHoeckZeile(db, zugriff.lager.id, id.data);
        // Ein Höck der Lagerleitung ist für die Rolle mit nur team_lesen unbekannt
        if (
          !zeile ||
          (hoeckUmfang(zugriff) === "team" && zeile.art !== "team")
        ) {
          throw new HTTPException(404);
        }
        // Der Inhalt hängt nur von der Zeile ab (nicht von der Rolle): Version und ID genügen als ETag
        const etag = `"${zeile.id}-${zeile.version}"`;
        const kopf = {
          ETag: etag,
          "Cache-Control": "private, no-cache",
        };
        if (c.req.header("If-None-Match") === etag) {
          return c.body(null, 304, kopf);
        }
        return c.body(erzeugeHoeckIcs(zeile), 200, {
          ...kopf,
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="hoeck-${zeile.datum}.ics"`,
        });
      })
      .get(
        "/:id/hoecks/:hoeckId",
        lesen,
        eingabe("param", hoeckPfad),
        async (c) => {
          const zugriff = c.get("lager");
          const h = await ladeHoeck(
            db,
            zugriff.lager.id,
            c.req.valid("param").hoeckId,
            hoeckUmfang(zugriff)!,
          );
          if (!h) throw new HTTPException(404);
          return c.json(h);
        },
      )
      .patch(
        "/:id/hoecks/:hoeckId",
        bearbeiten,
        eingabe("param", hoeckPfad),
        eingabe("json", hoeckAendern),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { hoeckId } = c.req.valid("param");
          await db.transaction((tx) =>
            aendereHoeck(
              tx,
              { lagerId, personId: c.get("person").id },
              hoeckId,
              c.req.valid("json"),
            ),
          );
          return c.json(await ladeHoeck(db, lagerId, hoeckId, "alle"));
        },
      )
      .delete(
        "/:id/hoecks/:hoeckId",
        bearbeiten,
        eingabe("param", hoeckPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const fehler = await db.transaction((tx) =>
            loescheHoeck(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").hoeckId,
              c.req.valid("query").version,
            ),
          );
          if (fehler) {
            return c.json(
              {
                code: fehler.fehler,
                message:
                  "Der Höck hat noch Traktanden. Schiebe sie auf den nächsten Höck oder lösche sie zuerst.",
              },
              409,
            );
          }
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/hoecks/:hoeckId/modus",
        lesenAlle,
        eingabe("param", hoeckPfad),
        async (c) => {
          const modus = await ladeHoeckModus(
            db,
            c.get("lager"),
            c.req.valid("param").hoeckId,
          );
          if (!modus) throw new HTTPException(404);
          return c.json(modus);
        },
      )
      .put(
        "/:id/hoecks/:hoeckId/anwesende/:personId",
        bearbeiten,
        eingabe("param", anwesenderPfad),
        async (c) => {
          const { hoeckId, personId } = c.req.valid("param");
          const fehler = await db.transaction((tx) =>
            setzeHoeckAnwesenheit(
              tx,
              { lagerId: c.get("lager").lager.id },
              hoeckId,
              personId,
              true,
            ),
          );
          if (fehler) return c.json(pruefungAntwort(fehler), 400);
          return c.body(null, 204);
        },
      )
      .delete(
        "/:id/hoecks/:hoeckId/anwesende/:personId",
        bearbeiten,
        eingabe("param", anwesenderPfad),
        async (c) => {
          const { hoeckId, personId } = c.req.valid("param");
          await db.transaction((tx) =>
            setzeHoeckAnwesenheit(
              tx,
              { lagerId: c.get("lager").lager.id },
              hoeckId,
              personId,
              false,
            ),
          );
          return c.body(null, 204);
        },
      )
      .post(
        "/:id/hoecks/:hoeckId/traktanden/uebernehmen",
        bearbeiten,
        eingabe("param", hoeckPfad),
        eingabe("json", traktandenUebernehmen),
        async (c) => {
          const anzahl = await db.transaction((tx) =>
            uebernehmeTraktanden(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").hoeckId,
              c.req.valid("json").traktandumIds,
            ),
          );
          return c.json({ uebernommen: anzahl });
        },
      )
      // Vor «/traktanden/:traktandumId»: «naechster» und «reihenfolge» sind keine IDs
      .get(
        "/:id/traktanden/naechster",
        lesenAlle,
        eingabe("param", lagerPfad),
        async (c) =>
          c.json({
            traktanden: await ladeTraktanden(db, c.get("lager").lager.id, {
              hoeckId: null,
              limit: 200,
            }),
          }),
      )
      .put(
        "/:id/traktanden/reihenfolge",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", traktandumReihenfolge),
        async (c) => {
          const { hoeckId, eintraege } = c.req.valid("json");
          await db.transaction((tx) =>
            ordneTraktanden(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              hoeckId,
              eintraege,
            ),
          );
          return c.body(null, 204);
        },
      )
      .post(
        "/:id/traktanden",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", traktandumAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const ergebnis = await db.transaction((tx) =>
            legeTraktandumAn(
              tx,
              { lagerId, personId: c.get("person").id },
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            return c.json(pruefungAntwort(ergebnis), 400);
          }
          return c.json(await ladeTraktandum(db, lagerId, ergebnis.id), 201);
        },
      )
      .patch(
        "/:id/traktanden/:traktandumId",
        bearbeiten,
        eingabe("param", traktandumPfad),
        eingabe("json", traktandumAendern),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { traktandumId } = c.req.valid("param");
          const ergebnis = await db.transaction((tx) =>
            aendereTraktandum(
              tx,
              { lagerId, personId: c.get("person").id },
              traktandumId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            return c.json(pruefungAntwort(ergebnis), 400);
          }
          return c.json(await ladeTraktandum(db, lagerId, traktandumId));
        },
      )
      .delete(
        "/:id/traktanden/:traktandumId",
        bearbeiten,
        eingabe("param", traktandumPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          await db.transaction((tx) =>
            loescheTraktandum(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").traktandumId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/entscheide",
        lesenAlle,
        eingabe("param", lagerPfad),
        eingabe("query", entscheideAbfrage),
        async (c) =>
          c.json(
            await ladeEntscheide(
              db,
              c.get("lager").lager.id,
              c.req.valid("query"),
            ),
          ),
      )
  );
}
