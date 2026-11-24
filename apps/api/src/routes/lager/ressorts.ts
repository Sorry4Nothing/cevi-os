import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bildUrlImLager } from "../../bild.js";
import type { Db } from "../../db/client.js";
import { ressort, ressortLink, ressortNotiz, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import {
  linkAendern,
  linkAnlegen,
  linkAnsicht,
  aendereNotiz,
  loescheNotiz,
  legeNotizAn,
  ordneRessorts,
  ressortDa,
  notizAendern,
  notizAnlegen,
  notizAnsicht,
  pruefeRessortWerte,
  reihenfolgeSetzen,
  ressortAendern,
  ressortAnlegen,
  ressortAnsicht,
  sperreLager,
  versionAbfrage,
  type Pruefung,
} from "../../lager/ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const SEITE = 100;

const lagerPfad = z.strictObject({ id: z.uuid() });
const ressortPfad = z.strictObject({ id: z.uuid(), ressortId: z.uuid() });
const linkPfad = z.strictObject({
  id: z.uuid(),
  ressortId: z.uuid(),
  linkId: z.uuid(),
});
const notizPfad = z.strictObject({
  id: z.uuid(),
  ressortId: z.uuid(),
  notizId: z.uuid(),
});
const seiteAbfrage = z.strictObject({
  // Cursor: die ID des letzten Eintrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});

const pgFehler = (fehler: unknown) =>
  (fehler as { cause?: { code?: string; constraint_name?: string } })?.cause;

const FEHLER_TEXT = {
  KEIN_MITGLIED:
    "Leitung und Stellvertretung müssen Mitglieder dieses Lagers sein.",
  RESSORT_UNBEKANNT: "Das übergeordnete Ressort gibt es in diesem Lager nicht.",
  RESSORT_ZYKLUS:
    "Ein Ressort kann nicht unter sich selbst oder unter eines seiner Unterressorts gehören.",
} as const;
const pruefungAntwort = (fehler: NonNullable<Pruefung>) => ({
  code: fehler.fehler,
  message: FEHLER_TEXT[fehler.fehler],
});
const KUERZEL_VERGEBEN = {
  code: "KUERZEL_VERGEBEN",
  message: "Dieses Kürzel gibt es in diesem Lager schon.",
} as const;

// Ressorts eines Lagers (#371), mit Links und Notizen als Einzelzeilen. Lesen braucht ressorts.lesen, jede Änderung ressorts.bearbeiten (lager/rechte-katalog.ts). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed. Löschen ist endgültig (#427). Leitung und Stellvertretung sind Personen-IDs von Mitgliedern des Lagers; die Namen löst die Route beim Lesen auf, eine Umbenennung bricht also nichts
export function erstelleRessortRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "ressorts.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "ressorts.bearbeiten" });

  // Eine Abfrage für die ganze Seite: Ressorts mit den Namen von Leitung und Stellvertretung (Join statt je Zeile eine Abfrage)
  async function ladeRessorts(
    lagerId: string,
    p: { id?: string; nach?: string; limit?: number },
  ) {
    const leitung = alias(user, "leitung");
    const stv = alias(user, "stv");
    const limit = p.limit ?? SEITE;
    const zeilen = await db
      .select({
        zeile: ressort,
        leitungName: leitung.name,
        leitungCevi: leitung.ceviName,
        leitungBild: bildUrlImLager(sql`${leitung.id}`, lagerId),
        stvName: stv.name,
        stvCevi: stv.ceviName,
        stvBild: bildUrlImLager(sql`${stv.id}`, lagerId),
      })
      .from(ressort)
      .leftJoin(leitung, eq(leitung.id, ressort.leitungPersonId))
      .leftJoin(stv, eq(stv.id, ressort.stvPersonId))
      .where(
        and(
          eq(ressort.lagerId, lagerId),
          p.id ? eq(ressort.id, p.id) : undefined,
          // Nach (Reihenfolge, ID) der letzten bekannten Zeile; ist sie unbekannt, bleibt die Seite leer
          p.nach
            ? sql`(${ressort.reihenfolge}, ${ressort.id}) > (select r.reihenfolge, r.id from ressort r where r.id = ${p.nach} and r.lager_id = ${lagerId})`
            : undefined,
        ),
      )
      .orderBy(asc(ressort.reihenfolge), asc(ressort.id))
      .limit(limit + 1);
    const seite = zeilen.slice(0, limit).map((z) => ({
      ...ressortAnsicht(z.zeile),
      leitung: z.zeile.leitungPersonId && {
        id: z.zeile.leitungPersonId,
        name: z.leitungName,
        ceviName: z.leitungCevi,
        bildUrl: z.leitungBild,
      },
      stv: z.zeile.stvPersonId && {
        id: z.zeile.stvPersonId,
        name: z.stvName,
        ceviName: z.stvCevi,
        bildUrl: z.stvBild,
      },
    }));
    return {
      ressorts: seite,
      naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
    };
  }

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/ressorts",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", seiteAbfrage),
        async (c) =>
          c.json(
            await ladeRessorts(c.get("lager").lager.id, c.req.valid("query")),
          ),
      )
      .post(
        "/:id/ressorts",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", ressortAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const werte = c.req.valid("json");
          try {
            const ergebnis = await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              const fehler = await pruefeRessortWerte(tx, lagerId, werte);
              if (fehler) return fehler;
              // Ohne Angabe ans Ende
              const [ende] = await tx
                .select({
                  n: sql<number>`coalesce(max(${ressort.reihenfolge}) + 1, 0)`,
                })
                .from(ressort)
                .where(and(eq(ressort.lagerId, lagerId)));
              return legeZeileAn(
                tx,
                ressort,
                { lagerId, personId: person.id },
                { ...werte, reihenfolge: werte.reihenfolge ?? ende!.n },
              );
            });
            if ("fehler" in ergebnis)
              return c.json(pruefungAntwort(ergebnis), 400);
            const { ressorts } = await ladeRessorts(lagerId, {
              id: ergebnis.id,
            });
            return c.json(ressorts[0], 201);
          } catch (fehler) {
            if (pgFehler(fehler)?.code === "23505") {
              return c.json(KUERZEL_VERGEBEN, 409);
            }
            throw fehler;
          }
        },
      )
      // Vor «/:ressortId», damit «reihenfolge» nicht als ID gilt (die ID prüft ein UUID-Schema, die Methode PUT ist sonst frei)
      .put(
        "/:id/ressorts/reihenfolge",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", reihenfolgeSetzen),
        async (c) => {
          await db.transaction((tx) =>
            ordneRessorts(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("json").eintraege,
            ),
          );
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/ressorts/:ressortId",
        lesen,
        eingabe("param", ressortPfad),
        async (c) => {
          const { ressorts } = await ladeRessorts(c.get("lager").lager.id, {
            id: c.req.valid("param").ressortId,
          });
          if (!ressorts[0]) throw new HTTPException(404);
          return c.json(ressorts[0]);
        },
      )
      .patch(
        "/:id/ressorts/:ressortId",
        bearbeiten,
        eingabe("param", ressortPfad),
        eingabe("json", ressortAendern),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const { ressortId } = c.req.valid("param");
          const { version, ...werte } = c.req.valid("json");
          try {
            const ergebnis = await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              await ressortDa(tx, lagerId, ressortId);
              const fehler = await pruefeRessortWerte(
                tx,
                lagerId,
                werte,
                ressortId,
              );
              if (fehler) return fehler;
              return aendereZeile(
                tx,
                ressort,
                { lagerId, personId: person.id },
                { id: ressortId, version, werte, ansicht: ressortAnsicht },
              );
            });
            if ("fehler" in ergebnis)
              return c.json(pruefungAntwort(ergebnis), 400);
            const { ressorts } = await ladeRessorts(lagerId, { id: ressortId });
            return c.json(ressorts[0]);
          } catch (fehler) {
            if (pgFehler(fehler)?.code === "23505") {
              return c.json(KUERZEL_VERGEBEN, 409);
            }
            throw fehler;
          }
        },
      )
      .delete(
        "/:id/ressorts/:ressortId",
        bearbeiten,
        eingabe("param", ressortPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { ressortId } = c.req.valid("param");
          const { version } = c.req.valid("query");
          const ergebnis = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            await ressortDa(tx, lagerId, ressortId);
            // Ein Ressort mit Unterressorts bleibt, bis diese verschoben oder gelöscht sind: Sonst hingen sie im Baum an einem gelöschten Ressort
            const [kind] = await tx
              .select({ id: ressort.id })
              .from(ressort)
              .where(
                and(
                  eq(ressort.lagerId, lagerId),
                  eq(ressort.parentId, ressortId),
                ),
              )
              .limit(1);
            if (kind) return "HAT_UNTERRESSORTS" as const;
            await loescheZeile(
              tx,
              ressort,
              { lagerId, personId: c.get("person").id },
              { id: ressortId, version, ansicht: ressortAnsicht },
            );
          });
          if (ergebnis) {
            return c.json(
              {
                code: "RESSORT_HAT_UNTERRESSORTS",
                message:
                  "Das Ressort hat Unterressorts. Verschiebe oder lösche sie zuerst.",
              },
              409,
            );
          }
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/ressorts/:ressortId/links",
        lesen,
        eingabe("param", ressortPfad),
        eingabe("query", seiteAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { ressortId } = c.req.valid("param");
          const { nach, limit } = c.req.valid("query");
          await ressortDa(db, lagerId, ressortId);
          const zeilen = await db
            .select()
            .from(ressortLink)
            .where(
              and(
                eq(ressortLink.lagerId, lagerId),
                eq(ressortLink.ressortId, ressortId),
                nach ? gt(ressortLink.id, nach) : undefined,
              ),
            )
            .orderBy(asc(ressortLink.id))
            .limit(limit + 1);
          const seite = zeilen.slice(0, limit).map(linkAnsicht);
          return c.json({
            links: seite,
            naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
          });
        },
      )
      .post(
        "/:id/ressorts/:ressortId/links",
        bearbeiten,
        eingabe("param", ressortPfad),
        eingabe("json", linkAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { ressortId } = c.req.valid("param");
          const neu = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            await ressortDa(tx, lagerId, ressortId);
            return legeZeileAn(
              tx,
              ressortLink,
              { lagerId, personId: c.get("person").id },
              { ressortId, ...c.req.valid("json") },
            );
          });
          return c.json(linkAnsicht(neu), 201);
        },
      )
      .patch(
        "/:id/ressorts/:ressortId/links/:linkId",
        bearbeiten,
        eingabe("param", linkPfad),
        eingabe("json", linkAendern),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { ressortId, linkId } = c.req.valid("param");
          const { version, ...werte } = c.req.valid("json");
          const zeile = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            await linkDa(tx, lagerId, ressortId, linkId);
            return aendereZeile(
              tx,
              ressortLink,
              { lagerId, personId: c.get("person").id },
              { id: linkId, version, werte, ansicht: linkAnsicht },
            );
          });
          return c.json(linkAnsicht(zeile));
        },
      )
      .delete(
        "/:id/ressorts/:ressortId/links/:linkId",
        bearbeiten,
        eingabe("param", linkPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { ressortId, linkId } = c.req.valid("param");
          await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            await linkDa(tx, lagerId, ressortId, linkId);
            await loescheZeile(
              tx,
              ressortLink,
              { lagerId, personId: c.get("person").id },
              {
                id: linkId,
                version: c.req.valid("query").version,
                ansicht: linkAnsicht,
              },
            );
          });
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/ressorts/:ressortId/notizen",
        lesen,
        eingabe("param", ressortPfad),
        eingabe("query", seiteAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { ressortId } = c.req.valid("param");
          const { nach, limit } = c.req.valid("query");
          await ressortDa(db, lagerId, ressortId);
          // Neueste zuerst; die Namen der Autorinnen und Autoren in derselben Abfrage
          const zeilen = await db
            .select({
              zeile: ressortNotiz,
              name: user.name,
              ceviName: user.ceviName,
              bildUrl: bildUrlImLager(sql`${user.id}`, lagerId),
            })
            .from(ressortNotiz)
            .leftJoin(user, eq(user.id, ressortNotiz.erstelltVon))
            .where(
              and(
                eq(ressortNotiz.lagerId, lagerId),
                eq(ressortNotiz.ressortId, ressortId),
                nach ? lt(ressortNotiz.id, nach) : undefined,
              ),
            )
            .orderBy(desc(ressortNotiz.id))
            .limit(limit + 1);
          const seite = zeilen.slice(0, limit).map((z) => ({
            ...notizAnsicht(z.zeile),
            von: z.zeile.erstelltVon && {
              id: z.zeile.erstelltVon,
              name: z.name,
              ceviName: z.ceviName,
              bildUrl: z.bildUrl,
            },
          }));
          return c.json({
            notizen: seite,
            naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
          });
        },
      )
      .post(
        "/:id/ressorts/:ressortId/notizen",
        bearbeiten,
        eingabe("param", ressortPfad),
        eingabe("json", notizAnlegen),
        async (c) => {
          const { ressortId } = c.req.valid("param");
          const neu = await db.transaction((tx) =>
            legeNotizAn(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              ressortId,
              c.req.valid("json"),
            ),
          );
          return c.json(notizAnsicht(neu), 201);
        },
      )
      .patch(
        "/:id/ressorts/:ressortId/notizen/:notizId",
        bearbeiten,
        eingabe("param", notizPfad),
        eingabe("json", notizAendern),
        async (c) => {
          const { ressortId, notizId } = c.req.valid("param");
          const zeile = await db.transaction((tx) =>
            aendereNotiz(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              ressortId,
              notizId,
              c.req.valid("json"),
            ),
          );
          return c.json(notizAnsicht(zeile));
        },
      )
      .delete(
        "/:id/ressorts/:ressortId/notizen/:notizId",
        bearbeiten,
        eingabe("param", notizPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const { ressortId, notizId } = c.req.valid("param");
          await db.transaction((tx) =>
            loescheNotiz(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              ressortId,
              notizId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
  );
}

// Der Link beziehungsweise die Notiz gehört zu diesem Ressort in diesem Lager, sonst 404: Eine ID aus der Anfrage ist nie ein Nachweis (SR-11)
async function linkDa(
  tx: Pick<Db, "select">,
  lagerId: string,
  ressortId: string,
  id: string,
) {
  const [zeile] = await tx
    .select({ id: ressortLink.id })
    .from(ressortLink)
    .where(
      and(
        eq(ressortLink.id, id),
        eq(ressortLink.lagerId, lagerId),
        eq(ressortLink.ressortId, ressortId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
}
