import { and, asc, desc, eq, gt, like, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { einkaufArtikel, einkaufVorschlag, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  artikelAendern,
  artikelAnlegen,
  artikelAnsicht,
  bestimmeWarengruppe,
  listeAbfrage,
  merkeWarengruppe,
  normalisiereName,
  speicherWerte,
  versionAbfrage,
  vorschlagAbfrage,
  zaehleVorschlag,
} from "../../lager/einkauf.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import {
  aendereZeile,
  legeZeileAn,
  loescheZeile,
  type AendereWerte,
} from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const artikelPfad = z.strictObject({ id: z.uuid(), artikelId: z.uuid() });

const pgFehler = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause;

// Wer einkauft, muss Mitglied dieses Lagers sein: Der Fremdschlüssel auf lager_mitglied hält es, die Route übersetzt seine Verletzung
const KEIN_MITGLIED = {
  code: "KEIN_MITGLIED",
  message: "Wer einkauft, muss Mitglied dieses Lagers sein.",
} as const;

type Person = { id: string; name: string | null; ceviName: string | null };

// Einkaufsliste des Lagers (#392). Lesen braucht einkauf.lesen, jede Änderung einkauf.bearbeiten (lager/rechte-katalog.ts; Standard: Lagerleitung, Leitung und Lesen lesen, Lagerleitung und Leitung schreiben, das Team nichts). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed. Löschen ist endgültig (#427); das Entfernen ist endgültig (#427). Abhaken ist ein einzelnes PATCH mit erledigt
export function erstelleEinkaufRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "einkauf.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "einkauf.bearbeiten" });

  // Eine Abfrage für die ganze Seite: Artikel mit dem Namen der Person, die einkauft (Join statt je Zeile eine Abfrage)
  async function ladeArtikel(
    lagerId: string,
    p: {
      id?: string;
      nach?: string;
      limit?: number;
      einkaeufer?: string;
      erledigt?: boolean;
    },
  ) {
    const kaeufer = alias(user, "kaeufer");
    const limit = p.limit ?? 100;
    const zeilen = await db
      .select({
        zeile: einkaufArtikel,
        kaeuferName: kaeufer.name,
        kaeuferCevi: kaeufer.ceviName,
      })
      .from(einkaufArtikel)
      .leftJoin(kaeufer, eq(kaeufer.id, einkaufArtikel.einkaeuferPersonId))
      .where(
        and(
          eq(einkaufArtikel.lagerId, lagerId),
          p.id ? eq(einkaufArtikel.id, p.id) : undefined,
          p.nach ? gt(einkaufArtikel.id, p.nach) : undefined,
          p.einkaeufer
            ? eq(einkaufArtikel.einkaeuferPersonId, p.einkaeufer)
            : undefined,
          p.erledigt === undefined
            ? undefined
            : eq(einkaufArtikel.erledigt, p.erledigt),
        ),
      )
      .orderBy(asc(einkaufArtikel.id))
      .limit(limit + 1);
    const seite = zeilen.slice(0, limit).map((z) => ({
      ...artikelAnsicht(z.zeile),
      einkaeufer: z.zeile.einkaeuferPersonId
        ? ({
            id: z.zeile.einkaeuferPersonId,
            name: z.kaeuferName,
            ceviName: z.kaeuferCevi,
          } satisfies Person)
        : null,
    }));
    return {
      artikel: seite,
      naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
    };
  }

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/einkauf",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", listeAbfrage),
        async (c) => {
          const { einkaeufer, ...rest } = c.req.valid("query");
          return c.json(
            await ladeArtikel(c.get("lager").lager.id, {
              ...rest,
              einkaeufer:
                einkaeufer === "ich" ? c.get("person").id : einkaeufer,
            }),
          );
        },
      )
      .post(
        "/:id/einkauf",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", artikelAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { warengruppe, einkaeuferPersonId, ...rest } =
            c.req.valid("json");
          try {
            const neu = await db.transaction(async (tx) => {
              // Eigene Warengruppe: gilt und wird gemerkt; sonst Artikelstamm des Lagers, dann Stichwortliste
              if (warengruppe)
                await merkeWarengruppe(tx, lagerId, rest.name, warengruppe);
              const artikel = await legeZeileAn(
                tx,
                einkaufArtikel,
                { lagerId, personId: c.get("person").id },
                {
                  ...speicherWerte({
                    menge: rest.menge,
                    einheit: rest.einheit,
                  }),
                  name: rest.name,
                  nameNorm: normalisiereName(rest.name),
                  warengruppe:
                    warengruppe ??
                    (await bestimmeWarengruppe(tx, lagerId, rest.name)),
                  einkaeuferPersonId: einkaeuferPersonId ?? null,
                },
              );
              await zaehleVorschlag(tx, lagerId, rest.name);
              return artikel;
            });
            const { artikel } = await ladeArtikel(lagerId, { id: neu.id });
            return c.json(artikel[0], 201);
          } catch (fehler) {
            if (pgFehler(fehler)?.code === "23503") {
              return c.json(KEIN_MITGLIED, 400);
            }
            throw fehler;
          }
        },
      )
      // Vor «/:artikelId», damit «zusammen» und «vorschlaege» nicht als ID gelten
      .get(
        "/:id/einkauf/zusammen",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", listeAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { nach, limit, einkaeufer, erledigt } = c.req.valid("query");
          const kaeuferId =
            einkaeufer === "ich" ? c.get("person").id : einkaeufer;
          const bedingungen: SQL[] = [sql`a.lager_id = ${lagerId}`];
          if (kaeuferId)
            bedingungen.push(sql`a.einkaeufer_person_id = ${kaeuferId}`);
          if (erledigt !== undefined)
            bedingungen.push(sql`a.erledigt = ${erledigt}`);
          // Gleicher Artikel (Name ohne Gross- und Kleinschreibung und Umlaute), gleiche Einheit, gleiche Person, gleicher Stand: summiert in der Abfrage, eine Zeile je Gruppe. Eine Menge ohne Zahl zählt nicht mit. Die Warengruppe und die Schreibweise des neuesten Eintrags gelten; die Seiten laufen nach der ersten ID der Gruppe
          const zeilen = await db.execute<{
            erste: string;
            name: string;
            warengruppe: string;
            einheit: string | null;
            menge: string | null;
            einkaeufer_person_id: string | null;
            erledigt: boolean;
            anzahl: number;
            eintraege: string | { id: string; version: number }[];
            kaeufer_name: string | null;
            kaeufer_cevi: string | null;
          }>(sql`
            select g.*, k.name as kaeufer_name, k.cevi_name as kaeufer_cevi
            from (
              select
                (array_agg(a.id order by a.id))[1] as erste,
                (array_agg(a.name order by a.id desc))[1] as name,
                (array_agg(a.warengruppe order by a.id desc))[1] as warengruppe,
                a.einheit,
                sum(a.menge) as menge,
                a.einkaeufer_person_id,
                a.erledigt,
                count(*)::int as anzahl,
                jsonb_agg(jsonb_build_object('id', a.id, 'version', a.version) order by a.id) as eintraege
              from einkauf_artikel a
              where ${sql.join(bedingungen, sql` and `)}
              group by a.name_norm, a.einheit, a.einkaeufer_person_id, a.erledigt
              ${nach ? sql`having (array_agg(a.id order by a.id))[1] > ${nach}::uuid` : sql``}
              order by erste
              limit ${limit + 1}
            ) g
            left join "user" k on k.id = g.einkaeufer_person_id
            order by g.erste`);
          const seite = [...zeilen].slice(0, limit).map((z) => ({
            name: z.name,
            menge: z.menge === null ? null : Number(z.menge),
            einheit: z.einheit,
            warengruppe: z.warengruppe,
            einkaeuferPersonId: z.einkaeufer_person_id,
            einkaeufer: z.einkaeufer_person_id
              ? ({
                  id: z.einkaeufer_person_id,
                  name: z.kaeufer_name,
                  ceviName: z.kaeufer_cevi,
                } satisfies Person)
              : null,
            erledigt: z.erledigt,
            anzahl: z.anzahl,
            // Die Artikel hinter der Zeile: Abhaken ist je Artikel ein PATCH mit der Version
            eintraege:
              typeof z.eintraege === "string"
                ? (JSON.parse(z.eintraege) as { id: string; version: number }[])
                : z.eintraege,
          }));
          return c.json({
            artikel: seite,
            naechster: zeilen.length > limit ? zeilen[limit - 1]!.erste : null,
          });
        },
      )
      .get(
        "/:id/einkauf/vorschlaege",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", vorschlagAbfrage),
        async (c) => {
          const { q, limit } = c.req.valid("query");
          // Anfang des Namens, gleich normalisiert wie die Namen; % und _ aus der Eingabe sind Zeichen, keine Muster
          const muster = q
            ? `${normalisiereName(q).replace(/[\\%_]/g, "\\$&")}%`
            : undefined;
          const zeilen = await db
            .select({
              name: einkaufVorschlag.name,
              haeufigkeit: einkaufVorschlag.haeufigkeit,
            })
            .from(einkaufVorschlag)
            .where(
              and(
                eq(einkaufVorschlag.lagerId, c.get("lager").lager.id),
                muster ? like(einkaufVorschlag.nameNorm, muster) : undefined,
              ),
            )
            .orderBy(
              desc(einkaufVorschlag.haeufigkeit),
              asc(einkaufVorschlag.nameNorm),
            )
            .limit(limit);
          return c.json({ vorschlaege: zeilen });
        },
      )
      .get(
        "/:id/einkauf/:artikelId",
        lesen,
        eingabe("param", artikelPfad),
        async (c) => {
          const { artikel } = await ladeArtikel(c.get("lager").lager.id, {
            id: c.req.valid("param").artikelId,
          });
          if (!artikel[0]) throw new HTTPException(404);
          return c.json(artikel[0]);
        },
      )
      .patch(
        "/:id/einkauf/:artikelId",
        bearbeiten,
        eingabe("param", artikelPfad),
        eingabe("json", artikelAendern),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { artikelId } = c.req.valid("param");
          const {
            version,
            warengruppe,
            einkaeuferPersonId,
            erledigt,
            ...rest
          } = c.req.valid("json");
          try {
            await db.transaction(async (tx) => {
              const werte: AendereWerte<typeof einkaufArtikel> = {
                ...speicherWerte(rest),
                ...(einkaeuferPersonId !== undefined && { einkaeuferPersonId }),
                ...(erledigt !== undefined && { erledigt }),
              };
              if (warengruppe) {
                // Der Name der Zeile, wenn er sich nicht ändert (404, wenn es sie nicht gibt)
                let name = rest.name;
                if (name === undefined) {
                  const [zeile] = await tx
                    .select({ name: einkaufArtikel.name })
                    .from(einkaufArtikel)
                    .where(
                      and(
                        eq(einkaufArtikel.id, artikelId),
                        eq(einkaufArtikel.lagerId, lagerId),
                      ),
                    );
                  if (!zeile) throw new HTTPException(404);
                  name = zeile.name;
                }
                await merkeWarengruppe(tx, lagerId, name, warengruppe);
                werte.warengruppe = warengruppe;
              } else if (rest.name !== undefined) {
                // Neuer Name ohne eigene Warengruppe: die Vorgabe des neuen Namens
                werte.warengruppe = await bestimmeWarengruppe(
                  tx,
                  lagerId,
                  rest.name,
                );
              }
              await aendereZeile(
                tx,
                einkaufArtikel,
                { lagerId, personId: c.get("person").id },
                { id: artikelId, version, werte, ansicht: artikelAnsicht },
              );
            });
          } catch (fehler) {
            if (pgFehler(fehler)?.code === "23503") {
              return c.json(KEIN_MITGLIED, 400);
            }
            throw fehler;
          }
          const { artikel } = await ladeArtikel(lagerId, { id: artikelId });
          return c.json(artikel[0]);
        },
      )
      .delete(
        "/:id/einkauf/:artikelId",
        bearbeiten,
        eingabe("param", artikelPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          await db.transaction((tx) =>
            loescheZeile(
              tx,
              einkaufArtikel,
              { lagerId, personId: c.get("person").id },
              {
                id: c.req.valid("param").artikelId,
                version: c.req.valid("query").version,
                ansicht: artikelAnsicht,
              },
            ),
          );
          return c.body(null, 204);
        },
      )
  );
}
