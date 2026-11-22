import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  lagerMitglied,
  teilnehmer,
  user,
  zimmer,
  zimmerZuordnung,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import {
  aendereZeile,
  LagerAntwortFehler,
  legeZeileAn,
  legeZeilenAn,
  loescheZeile,
  setzeZeilen,
  type Tx,
} from "../../lager/sync.js";
import {
  anzeigeNamenLager,
  ladeZimmer,
  nurEigenes,
  versionAbfrage,
  zaehleOffene,
  zimmerAendern,
  zimmerAnlegen,
  zimmerAnsicht,
  zuordnung,
  type ZimmerZeile,
} from "../../lager/zimmer.js";

const SEITE = 100;

const lagerPfad = z.strictObject({ id: z.uuid() });
const zimmerPfad = z.strictObject({ id: z.uuid(), zimmerId: z.uuid() });
const offenAbfrage = z.strictObject({
  // «teilnehmer»: die Teilnehmenden, «team»: die Mitglieder des Lagers
  art: z.enum(["teilnehmer", "team"]).default("teilnehmer"),
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});

// Zimmer und Zelte des Lagers (#385). Lesen braucht einteilung.lesen: Lagerleitung, Leitung und Lesen sehen alle Zimmer mit Plätzen, Belegung und Namen, das Team nur das eigene Zimmer mit den Namen der Mitbewohner (nur Namen, keine Plätze, keine Notiz). Einteilen und Zimmer ändern braucht einteilung.bearbeiten (Standard: Lagerleitung und Leitung). Mehr Personen als Plätze ist erlaubt: Die Antworten melden belegt, plaetze und ueberbelegt, die App warnt, die Route sperrt nicht. Jede Schreibroute geht durch lager/sync.ts (Version, Folgenummer, Feed); Zimmer löschen ist ein Soft-Delete samt seinen Zuordnungen
export function erstelleZimmerRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "einteilung.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "einteilung.bearbeiten" });

  const mitBelegung = (z: ZimmerZeile) => ({
    ...z,
    ueberbelegt: z.belegt > z.plaetze,
  });
  // Die Belegung eines Zimmers nach dem Schreiben, in derselben Transaktion
  async function belegung(
    tx: Pick<Db, "execute">,
    lagerId: string,
    abteilungId: string,
    zimmerId: string,
  ) {
    const [z] = await ladeZimmer(tx, lagerId, abteilungId, { zimmerId });
    return {
      belegt: z!.belegt,
      plaetze: z!.plaetze,
      ueberbelegt: z!.belegt > z!.plaetze,
    };
  }

  // Das Zimmer gehört zum Lager und ist nicht gelöscht, sonst 404
  async function pruefeZimmer(tx: Tx, lagerId: string, zimmerId: string) {
    const [z] = await tx
      .select({ id: zimmer.id })
      .from(zimmer)
      .where(
        and(
          eq(zimmer.id, zimmerId),
          eq(zimmer.lagerId, lagerId),
          isNull(zimmer.geloeschtAm),
        ),
      );
    if (!z) throw new HTTPException(404);
  }

  // Alle genannten Ziele gehören zu diesem Lager (Teilnehmende nicht im Papierkorb, Mitglieder mit Konto der Abteilung), sonst 404; gibt die schon bestehenden Zuordnungen dieser Ziele zurück (in jedem Zimmer)
  async function pruefeZiele(
    tx: Tx,
    lagerId: string,
    abteilungId: string,
    ziele: { teilnehmerIds: string[]; personIds: string[] },
  ) {
    const { teilnehmerIds, personIds } = ziele;
    const [kinder, mitglieder, vorhanden] = await Promise.all([
      teilnehmerIds.length === 0
        ? []
        : tx
            .select({ id: teilnehmer.id })
            .from(teilnehmer)
            .where(
              and(
                eq(teilnehmer.lagerId, lagerId),
                isNull(teilnehmer.geloeschtAm),
                inArray(teilnehmer.id, teilnehmerIds),
              ),
            ),
      personIds.length === 0
        ? []
        : tx
            .select({ id: lagerMitglied.personId })
            .from(lagerMitglied)
            .innerJoin(user, eq(user.id, lagerMitglied.personId))
            .where(
              and(
                eq(lagerMitglied.lagerId, lagerId),
                eq(user.abteilungId, abteilungId),
                inArray(lagerMitglied.personId, personIds),
              ),
            ),
      tx
        .select()
        .from(zimmerZuordnung)
        .where(
          and(
            eq(zimmerZuordnung.lagerId, lagerId),
            isNull(zimmerZuordnung.geloeschtAm),
            or(
              teilnehmerIds.length > 0
                ? inArray(zimmerZuordnung.teilnehmerId, teilnehmerIds)
                : undefined,
              personIds.length > 0
                ? inArray(zimmerZuordnung.personId, personIds)
                : undefined,
            ),
          ),
        ),
    ]);
    if (
      kinder.length !== teilnehmerIds.length ||
      mitglieder.length !== personIds.length
    ) {
      throw new HTTPException(404);
    }
    return vorhanden;
  }

  return (
    new Hono<LagerEnv>()
      // Drei Abfragen, unabhängig von der Zahl der Zimmer: Zimmer mit Belegung (GROUP BY), die Anzeigenamen des Lagers, bei voller Sicht die Zähler der Nichteingeteilten
      .get("/:id/zimmer", lesen, eingabe("param", lagerPfad), async (c) => {
        const zugriff = c.get("lager");
        const lagerId = zugriff.lager.id;
        const abteilungId = zugriff.lager.abteilungId;
        const eigenes = nurEigenes(zugriff);
        const [zeilen, namen, offen] = await Promise.all([
          ladeZimmer(
            db,
            lagerId,
            abteilungId,
            eigenes ? { nurPerson: zugriff.personId } : {},
          ),
          anzeigeNamenLager(db, lagerId),
          eigenes ? undefined : zaehleOffene(db, lagerId, abteilungId),
        ]);
        const sortiert = (z: ZimmerZeile) =>
          z.mitglieder
            .map((m) => ({ ...m, name: namen.get(m.id) }))
            .filter((m): m is typeof m & { name: string } => !!m.name)
            .sort((a, b) => a.name.localeCompare(b.name, "de"));
        if (eigenes) {
          return c.json({
            zimmer: zeilen.map((z) => ({
              id: z.id,
              version: z.version,
              name: z.name,
              art: z.art,
              mitglieder: sortiert(z).map((m) => ({ name: m.name })),
            })),
          });
        }
        return c.json({
          zimmer: zeilen.map((z) => ({
            ...mitBelegung(z),
            mitglieder: sortiert(z),
          })),
          offen,
        });
      })
      .post(
        "/:id/zimmer",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", zimmerAnlegen),
        async (c) => {
          const neu = await db.transaction((tx) =>
            legeZeileAn(
              tx,
              zimmer,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("json"),
            ),
          );
          return c.json(zimmerAnsicht(neu), 201);
        },
      )
      // Vor «/:zimmerId», damit «offen» nicht als ID gilt. Die Auswahl für «Person einteilen»: wer noch in keinem Zimmer liegt, eine Seite je Aufruf
      .get(
        "/:id/zimmer/offen",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("query", offenAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const { art, nach, limit } = c.req.valid("query");
          if (art === "teilnehmer") {
            const zeilen = await db
              .select({
                id: teilnehmer.id,
                vorname: teilnehmer.vorname,
                nachname: teilnehmer.nachname,
                stufe: teilnehmer.stufe,
                ceviName: teilnehmer.ceviName,
              })
              .from(teilnehmer)
              .where(
                and(
                  eq(teilnehmer.lagerId, lagerId),
                  isNull(teilnehmer.geloeschtAm),
                  sql`not exists (select 1 from zimmer_zuordnung a where a.lager_id = ${teilnehmer.lagerId} and a.teilnehmer_id = ${teilnehmer.id} and a.geloescht_am is null)`,
                  nach
                    ? sql`(${teilnehmer.nachname}, ${teilnehmer.vorname}, ${teilnehmer.id}) > (select t.nachname, t.vorname, t.id from teilnehmer t where t.id = ${nach} and t.lager_id = ${lagerId})`
                    : undefined,
                ),
              )
              .orderBy(
                asc(teilnehmer.nachname),
                asc(teilnehmer.vorname),
                asc(teilnehmer.id),
              )
              .limit(limit + 1);
            const seite = zeilen.slice(0, limit);
            return c.json({
              eintraege: seite,
              naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
            });
          }
          const zeilen = await db
            .select({
              id: lagerMitglied.personId,
              name: user.name,
              ceviName: user.ceviName,
            })
            .from(lagerMitglied)
            .innerJoin(user, eq(user.id, lagerMitglied.personId))
            .where(
              and(
                eq(lagerMitglied.lagerId, lagerId),
                eq(user.abteilungId, zugriff.lager.abteilungId),
                isNull(user.deaktiviertAm),
                sql`coalesce(${user.banned}, false) = false`,
                sql`not exists (select 1 from zimmer_zuordnung a where a.lager_id = ${lagerMitglied.lagerId} and a.person_id = ${lagerMitglied.personId} and a.geloescht_am is null)`,
                nach
                  ? sql`(${user.name}, ${user.id}) > (select u.name, u.id from "user" u where u.id = ${nach})`
                  : undefined,
              ),
            )
            .orderBy(asc(user.name), asc(user.id))
            .limit(limit + 1);
          const seite = zeilen.slice(0, limit);
          return c.json({
            eintraege: seite,
            naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
          });
        },
      )
      .patch(
        "/:id/zimmer/:zimmerId",
        bearbeiten,
        eingabe("param", zimmerPfad),
        eingabe("json", zimmerAendern),
        async (c) => {
          const { version, ...werte } = c.req.valid("json");
          const neu = await db.transaction((tx) =>
            aendereZeile(
              tx,
              zimmer,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              {
                id: c.req.valid("param").zimmerId,
                version,
                werte,
                ansicht: zimmerAnsicht,
              },
            ),
          );
          return c.json(zimmerAnsicht(neu));
        },
      )
      .delete(
        "/:id/zimmer/:zimmerId",
        bearbeiten,
        eingabe("param", zimmerPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const k = {
            lagerId: c.get("lager").lager.id,
            personId: c.get("person").id,
          };
          const { zimmerId } = c.req.valid("param");
          await db.transaction(async (tx) => {
            await loescheZeile(tx, zimmer, k, {
              id: zimmerId,
              version: c.req.valid("query").version,
              ansicht: zimmerAnsicht,
            });
            // Die Zuordnungen gehen mit dem Zimmer (der Feed meldet jede als gelöscht)
            const ids = await tx
              .select({ id: zimmerZuordnung.id })
              .from(zimmerZuordnung)
              .where(
                and(
                  eq(zimmerZuordnung.lagerId, k.lagerId),
                  eq(zimmerZuordnung.zimmerId, zimmerId),
                  isNull(zimmerZuordnung.geloeschtAm),
                ),
              );
            await setzeZeilen(tx, zimmerZuordnung, k, {
              ids: ids.map((z) => z.id),
              werte: {},
              loeschen: true,
            });
          });
          return c.body(null, 204);
        },
      )
      // Mehrere Personen in einer Anfrage ins Zimmer. Wer schon in diesem Zimmer liegt, bleibt unberührt; wer in einem anderen liegt, macht die ganze Anfrage zu 409 SCHON_EINGETEILT (nichts wird geschrieben, die Antwort nennt die IDs): Erst entfernen, dann einteilen. Mehr als Plätze ist erlaubt (ueberbelegt)
      .post(
        "/:id/zimmer/:zimmerId/zuordnung",
        bearbeiten,
        eingabe("param", zimmerPfad),
        eingabe("json", zuordnung),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const abteilungId = zugriff.lager.abteilungId;
          const k = { lagerId, personId: c.get("person").id };
          const { zimmerId } = c.req.valid("param");
          const { teilnehmerIds, personIds } = c.req.valid("json");
          return c.json(
            await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              await pruefeZimmer(tx, lagerId, zimmerId);
              const vorhanden = await pruefeZiele(tx, lagerId, abteilungId, {
                teilnehmerIds,
                personIds,
              });
              const woanders = vorhanden.filter((z) => z.zimmerId !== zimmerId);
              if (woanders.length > 0) {
                throw new LagerAntwortFehler(409, {
                  code: "SCHON_EINGETEILT",
                  message:
                    "Mindestens eine Person liegt schon in einem anderen Zimmer. Entferne sie dort zuerst.",
                  teilnehmerIds: woanders.flatMap((z) => z.teilnehmerId ?? []),
                  personIds: woanders.flatMap((z) => z.personId ?? []),
                });
              }
              const da = new Set(
                vorhanden.map((z) => z.teilnehmerId ?? z.personId),
              );
              const neu = await legeZeilenAn(tx, zimmerZuordnung, k, [
                ...teilnehmerIds
                  .filter((id) => !da.has(id))
                  .map((teilnehmerId) => ({ zimmerId, teilnehmerId })),
                ...personIds
                  .filter((id) => !da.has(id))
                  .map((personId) => ({ zimmerId, personId })),
              ]);
              return {
                eingeteilt: neu.length,
                ...(await belegung(tx, lagerId, abteilungId, zimmerId)),
              };
            }),
          );
        },
      )
      // Mehrere Personen aus dem Zimmer nehmen. Wer nicht in diesem Zimmer liegt, wird übergangen (wiederholbar)
      .post(
        "/:id/zimmer/:zimmerId/zuordnung/entfernen",
        bearbeiten,
        eingabe("param", zimmerPfad),
        eingabe("json", zuordnung),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const abteilungId = zugriff.lager.abteilungId;
          const k = { lagerId, personId: c.get("person").id };
          const { zimmerId } = c.req.valid("param");
          const { teilnehmerIds, personIds } = c.req.valid("json");
          return c.json(
            await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              await pruefeZimmer(tx, lagerId, zimmerId);
              const treffer = await tx
                .select({ id: zimmerZuordnung.id })
                .from(zimmerZuordnung)
                .where(
                  and(
                    eq(zimmerZuordnung.lagerId, lagerId),
                    eq(zimmerZuordnung.zimmerId, zimmerId),
                    isNull(zimmerZuordnung.geloeschtAm),
                    or(
                      teilnehmerIds.length > 0
                        ? inArray(zimmerZuordnung.teilnehmerId, teilnehmerIds)
                        : undefined,
                      personIds.length > 0
                        ? inArray(zimmerZuordnung.personId, personIds)
                        : undefined,
                    ),
                  ),
                );
              const weg = await setzeZeilen(tx, zimmerZuordnung, k, {
                ids: treffer.map((z) => z.id),
                werte: {},
                loeschen: true,
              });
              return {
                entfernt: weg.length,
                ...(await belegung(tx, lagerId, abteilungId, zimmerId)),
              };
            }),
          );
        },
      )
  );
}
