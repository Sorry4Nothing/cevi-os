import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  gruppe,
  gruppeZuordnung,
  lagerMitglied,
  teilnehmer,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  abwaehlen,
  gruppeAendern,
  gruppeAnlegen,
  gruppeKurz,
  ladeGruppen,
  MAX_GRUPPEN,
  mischen,
  versionAbfrage,
  zuordnen,
} from "../../lager/gruppen.js";
import { mische, SEED_MAX } from "../../lager/mischen.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import {
  aendereZeile,
  legeZeileAn,
  legeZeilenAn,
  loescheZeile,
  loescheZeilen,
  setzeZeilen,
  type Tx,
} from "../../lager/sync.js";

// Je Konto und Lager höchstens so viele Mischläufe je Minute: Übernehmen sperrt das Lager für die Dauer des Schreibens (lager/sync.ts)
export const MISCHEN_PRO_MINUTE = 10;

const lagerPfad = z.strictObject({ id: z.uuid() });
const gruppePfad = z.strictObject({ id: z.uuid(), gruppeId: z.uuid() });

// Programmgruppen und «nicht dabei» (#387). Lesen braucht einteilung.lesen, jede Änderung einteilung.bearbeiten (Standard: Lagerleitung und Leitung). Jede Schreibroute geht durch lager/sync.ts (Folgenummer, Feed); Zuordnen, Abwählen und Mischen sind Sammeloperationen mit gebündelten Statements in einer Transaktion unter der Lagersperre. Teilnehmende heissen in den Antworten wie in der Liste der Teilnehmenden; den Cevi-Namen sieht nur, wer teilnehmer.bearbeiten hat
export function erstelleGruppenRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "einteilung.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "einteilung.bearbeiten" });

  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const laeufe = new Map<string, number[]>();
  const zuViele = (wer: string) => {
    const jetzt = Date.now();
    const liste = (laeufe.get(wer) ?? []).filter((t) => jetzt - t < 60_000);
    const voll = liste.length >= MISCHEN_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) laeufe.set(wer, liste);
    else laeufe.delete(wer);
    return voll;
  };

  const liste = (lagerId: string, abteilungId: string, mitCeviName: boolean) =>
    ladeGruppen(db, lagerId, abteilungId, mitCeviName);

  // Der Vorschlag: die Teilnehmenden ohne die Abgewählten (eine Abfrage) auf die ersten `anzahl` Gruppen (eine Abfrage); fehlen Gruppen, kommen neue mit dem Namen «Gruppe n» dazu (gruppeId null, bis sie angelegt sind)
  async function plane(
    q: Pick<Db, "select">,
    lagerId: string,
    anzahl: number,
    seed: number,
  ) {
    const [kinder, vorhandene] = await Promise.all([
      q
        .select({
          id: teilnehmer.id,
          vorname: teilnehmer.vorname,
          nachname: teilnehmer.nachname,
          stufe: teilnehmer.stufe,
        })
        .from(teilnehmer)
        .where(
          and(
            eq(teilnehmer.lagerId, lagerId),
            isNull(teilnehmer.geloeschtAm),
            eq(teilnehmer.abgewaehlt, false),
          ),
        ),
      q
        .select({ id: gruppe.id, name: gruppe.name })
        .from(gruppe)
        .where(and(eq(gruppe.lagerId, lagerId), isNull(gruppe.geloeschtAm)))
        .orderBy(asc(gruppe.reihenfolge), asc(gruppe.name), asc(gruppe.id))
        .limit(anzahl),
    ]);
    const nachId = new Map(kinder.map((k) => [k.id, k]));
    const verteilt = mische(kinder, anzahl, seed);
    return {
      seed,
      gruppen: verteilt.map((ids, i) => ({
        nummer: i + 1,
        gruppeId: vorhandene[i]?.id ?? null,
        name: vorhandene[i]?.name ?? `Gruppe ${i + 1}`,
        anzahl: ids.length,
        teilnehmer: ids.map((id) => {
          const k = nachId.get(id)!;
          return {
            id: k.id,
            vorname: k.vorname,
            nachname: k.nachname,
            stufe: k.stufe,
          };
        }),
      })),
    };
  }

  // Die Zeilen von teilnehmer und lager_mitglied, die zum Lager gehören: sonst 404, auch für Einträge eines fremden Lagers
  async function pruefeIds(
    tx: Tx,
    lagerId: string,
    abteilungId: string,
    teilnehmerIds: string[],
    personIds: string[],
  ) {
    const [kinder, mitglieder] = await Promise.all([
      teilnehmerIds.length === 0
        ? []
        : tx
            .select({ id: teilnehmer.id, abgewaehlt: teilnehmer.abgewaehlt })
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
    ]);
    if (
      kinder.length !== teilnehmerIds.length ||
      mitglieder.length !== personIds.length
    ) {
      throw new HTTPException(404);
    }
    return kinder;
  }

  return (
    new Hono<LagerEnv>()
      .get("/:id/gruppen", lesen, eingabe("param", lagerPfad), async (c) =>
        c.json(
          await liste(
            c.get("lager").lager.id,
            c.get("person").abteilungId,
            darf(c.get("lager"), "teilnehmer.bearbeiten"),
          ),
        ),
      )
      .post(
        "/:id/gruppen",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", gruppeAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { name, reihenfolge } = c.req.valid("json");
          const neu = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const [{ n }] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(gruppe)
              .where(
                and(eq(gruppe.lagerId, lagerId), isNull(gruppe.geloeschtAm)),
              );
            if (n! >= MAX_GRUPPEN) return null;
            return legeZeileAn(
              tx,
              gruppe,
              { lagerId, personId: c.get("person").id },
              { name, reihenfolge: reihenfolge ?? n! },
            );
          });
          if (!neu) {
            return c.json(
              {
                code: "ZU_VIELE_GRUPPEN",
                message: `Ein Lager hat höchstens ${MAX_GRUPPEN} Gruppen.`,
              },
              400,
            );
          }
          return c.json(gruppeKurz(neu), 201);
        },
      )
      // Vor «/:gruppeId», damit «mischen», «zuordnung» und «abgewaehlt» nie als ID gelten
      .post(
        "/:id/gruppen/mischen",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", mischen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const { anzahl, uebernehmen, seed: wunsch } = c.req.valid("json");
          if (zuViele(`${person.id}:${lagerId}`)) throw new HTTPException(429);
          const seed = wunsch ?? randomInt(0, SEED_MAX + 1);
          if (!uebernehmen) {
            return c.json({
              vorschau: true,
              ...(await plane(db, lagerId, anzahl, seed)),
            });
          }
          const k = { lagerId, personId: person.id };
          const ergebnis = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            // Der Stand unter der Sperre, nicht der der Vorschau
            const plan = await plane(tx, lagerId, anzahl, seed);
            // Fehlende Gruppen in einem Insert anlegen
            const fehlend = plan.gruppen.filter((g) => g.gruppeId === null);
            const angelegt = await legeZeilenAn(
              tx,
              gruppe,
              k,
              fehlend.map((g) => ({ name: g.name, reihenfolge: g.nummer - 1 })),
            );
            fehlend.forEach((g, i) => (g.gruppeId = angelegt[i]!.id));
            const ziel = new Map<string, string>();
            for (const g of plan.gruppen) {
              for (const t of g.teilnehmer) ziel.set(t.id, g.gruppeId!);
            }
            // Die bisherige Einteilung der Teilnehmenden: Wer schon in der richtigen Gruppe steht, bleibt unberührt (kein Feed-Eintrag); alles andere geht weg und wird neu gesetzt. Die Leitungen (Konten) bleiben
            const bisher = await tx
              .select({
                id: gruppeZuordnung.id,
                teilnehmerId: gruppeZuordnung.teilnehmerId,
                gruppeId: gruppeZuordnung.gruppeId,
              })
              .from(gruppeZuordnung)
              .where(
                and(
                  eq(gruppeZuordnung.lagerId, lagerId),
                  isNull(gruppeZuordnung.geloeschtAm),
                  sql`${gruppeZuordnung.teilnehmerId} is not null`,
                ),
              );
            const bleibt = new Set(
              bisher
                .filter((z) => ziel.get(z.teilnehmerId!) === z.gruppeId)
                .map((z) => z.teilnehmerId!),
            );
            await loescheZeilen(tx, gruppeZuordnung, k, {
              ids: bisher
                .filter((z) => !bleibt.has(z.teilnehmerId!))
                .map((z) => z.id),
            });
            const neu = await legeZeilenAn(
              tx,
              gruppeZuordnung,
              k,
              [...ziel]
                .filter(([teilnehmerId]) => !bleibt.has(teilnehmerId))
                .map(([teilnehmerId, gruppeId]) => ({
                  gruppeId,
                  teilnehmerId,
                  rolle: "mitglied" as const,
                })),
            );
            return { ...plan, geaendert: neu.length };
          });
          return c.json({ vorschau: false, ...ergebnis });
        },
      )
      .put(
        "/:id/gruppen/zuordnung",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", zuordnen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const k = { lagerId, personId: person.id };
          const { gruppeId, teilnehmerIds, personIds, rolle } =
            c.req.valid("json");
          const geaendert = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            if (gruppeId) {
              const [da] = await tx
                .select({ id: gruppe.id })
                .from(gruppe)
                .where(
                  and(
                    eq(gruppe.lagerId, lagerId),
                    eq(gruppe.id, gruppeId),
                    isNull(gruppe.geloeschtAm),
                  ),
                );
              if (!da) throw new HTTPException(404);
            }
            const kinder = await pruefeIds(
              tx,
              lagerId,
              person.abteilungId,
              teilnehmerIds,
              personIds,
            );
            // Wer «nicht dabei» ist, steht in keiner Gruppe
            if (gruppeId && kinder.some((x) => x.abgewaehlt)) return null;
            const vorhanden = await tx
              .select()
              .from(gruppeZuordnung)
              .where(
                and(
                  eq(gruppeZuordnung.lagerId, lagerId),
                  isNull(gruppeZuordnung.geloeschtAm),
                  or(
                    teilnehmerIds.length > 0
                      ? inArray(gruppeZuordnung.teilnehmerId, teilnehmerIds)
                      : undefined,
                    personIds.length > 0
                      ? inArray(gruppeZuordnung.personId, personIds)
                      : undefined,
                  ),
                ),
              );
            if (!gruppeId) {
              return (
                await loescheZeilen(tx, gruppeZuordnung, k, {
                  ids: vorhanden.map((z) => z.id),
                })
              ).length;
            }
            const schonDa = new Set(
              vorhanden.map((z) => z.teilnehmerId ?? z.personId),
            );
            const kinderVerschieben = vorhanden
              .filter((z) => z.teilnehmerId && z.gruppeId !== gruppeId)
              .map((z) => z.id);
            const personenAendern = vorhanden
              .filter(
                (z) =>
                  z.personId && (z.gruppeId !== gruppeId || z.rolle !== rolle),
              )
              .map((z) => z.id);
            const verschoben = await setzeZeilen(tx, gruppeZuordnung, k, {
              ids: kinderVerschieben,
              werte: { gruppeId },
            });
            const geaendertePersonen = await setzeZeilen(
              tx,
              gruppeZuordnung,
              k,
              { ids: personenAendern, werte: { gruppeId, rolle } },
            );
            const neu = await legeZeilenAn(tx, gruppeZuordnung, k, [
              ...teilnehmerIds
                .filter((id) => !schonDa.has(id))
                .map((teilnehmerId) => ({
                  gruppeId,
                  teilnehmerId,
                  rolle: "mitglied" as const,
                })),
              ...personIds
                .filter((id) => !schonDa.has(id))
                .map((personId) => ({ gruppeId, personId, rolle })),
            ]);
            return verschoben.length + geaendertePersonen.length + neu.length;
          });
          if (geaendert === null) {
            return c.json(
              {
                code: "ABGEWAEHLT",
                message:
                  "Wer nicht dabei ist, lässt sich keiner Gruppe zuordnen. Wähle die Person zuerst wieder zu.",
              },
              409,
            );
          }
          return c.json({ geaendert });
        },
      )
      .put(
        "/:id/gruppen/abgewaehlt",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", abwaehlen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const k = { lagerId, personId: person.id };
          const { abgewaehlt, teilnehmerIds } = c.req.valid("json");
          const geaendert = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const kinder = await pruefeIds(
              tx,
              lagerId,
              person.abteilungId,
              teilnehmerIds,
              [],
            );
            // Was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag)
            const zeilen = await setzeZeilen(tx, teilnehmer, k, {
              ids: kinder
                .filter((x) => x.abgewaehlt !== abgewaehlt)
                .map((x) => x.id),
              werte: { abgewaehlt },
            });
            if (abgewaehlt && zeilen.length > 0) {
              // Wer nicht dabei ist, verlässt seine Gruppe
              const gruppen = await tx
                .select({ id: gruppeZuordnung.id })
                .from(gruppeZuordnung)
                .where(
                  and(
                    eq(gruppeZuordnung.lagerId, lagerId),
                    isNull(gruppeZuordnung.geloeschtAm),
                    inArray(
                      gruppeZuordnung.teilnehmerId,
                      zeilen.map((z) => z.id),
                    ),
                  ),
                );
              await loescheZeilen(tx, gruppeZuordnung, k, {
                ids: gruppen.map((z) => z.id),
              });
            }
            return zeilen.length;
          });
          return c.json({ geaendert });
        },
      )
      .patch(
        "/:id/gruppen/:gruppeId",
        bearbeiten,
        eingabe("param", gruppePfad),
        eingabe("json", gruppeAendern),
        async (c) => {
          const { version, ...werte } = c.req.valid("json");
          const neu = await db.transaction((tx) =>
            aendereZeile(
              tx,
              gruppe,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              {
                id: c.req.valid("param").gruppeId,
                version,
                werte,
                ansicht: gruppeKurz,
              },
            ),
          );
          return c.json(gruppeKurz(neu));
        },
      )
      .delete(
        "/:id/gruppen/:gruppeId",
        bearbeiten,
        eingabe("param", gruppePfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const k = { lagerId, personId: c.get("person").id };
          const { gruppeId } = c.req.valid("param");
          await db.transaction(async (tx) => {
            await loescheZeile(tx, gruppe, k, {
              id: gruppeId,
              version: c.req.valid("query").version,
              ansicht: gruppeKurz,
            });
            // Die Zuordnungen gehen mit der Gruppe; die Leute sind danach in keiner Gruppe
            const zuordnungen = await tx
              .select({ id: gruppeZuordnung.id })
              .from(gruppeZuordnung)
              .where(
                and(
                  eq(gruppeZuordnung.lagerId, lagerId),
                  eq(gruppeZuordnung.gruppeId, gruppeId),
                  isNull(gruppeZuordnung.geloeschtAm),
                ),
              );
            await loescheZeilen(tx, gruppeZuordnung, k, {
              ids: zuordnungen.map((z) => z.id),
            });
          });
          return c.body(null, 204);
        },
      )
  );
}
