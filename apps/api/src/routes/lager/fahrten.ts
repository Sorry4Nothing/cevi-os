import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { fahrt, fahrtMitfahrer, teilnehmer } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  bestehendeFahrt,
  fahrtAendern,
  fahrtAnlegen,
  fahrtAnsicht,
  type FahrtFehler,
  istAktivesMitglied,
  ladeFahrten,
  ladeOhneFahrt,
  listeAbfrage,
  mitfahrerAnlegen,
  mitfahrerAnsicht,
  ohneFahrtAbfrage,
  pruefeFahrt,
  siehtAlleFahrten,
  versionAbfrage,
} from "../../lager/fahrten.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import {
  aendereZeile,
  legeZeileAn,
  loescheZeile,
  loescheZeilen,
  type Tx,
} from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const fahrtPfad = z.strictObject({ id: z.uuid(), fahrtId: z.uuid() });
const mitfahrerPfad = z.strictObject({
  id: z.uuid(),
  fahrtId: z.uuid(),
  mitfahrerId: z.uuid(),
});

const FEHLER_TEXT = {
  PLAETZE_FEHLEN: "Ein Auto braucht die Zahl der Plätze für Mitfahrende.",
  NUR_FUER_AUTO: "Plätze und Fahrer gibt es nur bei einem Auto.",
  LINK_NUR_FUER_OEV: "Der Link auf den Fahrplan gehört zu einer ÖV-Gruppe.",
  KOORDINATEN_UNVOLLSTAENDIG:
    "Breite und Länge gehören zusammen: Gib beide an oder keine.",
  KARTENPUNKT_UNVOLLSTAENDIG:
    "Ein Kartenpunkt braucht eine Bezeichnung und dazu eine Adresse, Koordinaten oder einen Link.",
  KEIN_MITGLIED: "Die Person ist kein aktives Mitglied dieses Lagers.",
  TEILNEHMER_UNBEKANNT: "Den Teilnehmenden gibt es in diesem Lager nicht.",
} as const;
const fehlerAntwort = (code: keyof typeof FEHLER_TEXT) => ({
  code,
  message: FEHLER_TEXT[code],
});
const BEREITS_IN_FAHRT = (fahrtId?: string) => ({
  code: "BEREITS_IN_FAHRT",
  message:
    "Die Person fährt oder fährt mit in dieser Richtung schon in einer Fahrt.",
  fahrtId,
});

const pgFehler = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause;

type Ablehnung =
  | { fehler: FahrtFehler | "KEIN_MITGLIED" | "TEILNEHMER_UNBEKANNT" }
  | { bereitsIn: string };

// Fahrten eines Lagers (#386), Hin- und Rückfahrt getrennt, mit Mitfahrenden als Einzelzeilen. Lesen braucht einteilung.lesen, jede Änderung einteilung.bearbeiten (Standard: Lagerleitung und Leitung). Das Team sieht nur die eigene Fahrt (lager/fahrten.ts). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Feed; Löschen ist ein Soft-Delete. Prüfung und Schreiben laufen unter der Lagersperre, damit zwei gleichzeitige Zuteilungen dieselbe Person nicht doppelt setzen. Der Server ruft weder den Fahrplan noch einen Kartendienst ab: Link und Kartenpunkt sind nur gespeicherte Angaben
export function erstelleFahrtenRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "einteilung.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "einteilung.bearbeiten" });

  // Fahrer prüfen: aktives Mitglied des Lagers und in dieser Richtung noch in keiner Fahrt
  async function pruefeFahrer(
    tx: Tx,
    lagerId: string,
    abteilungId: string,
    richtung: "hin" | "rueck",
    personId: string,
  ): Promise<Ablehnung | undefined> {
    if (!(await istAktivesMitglied(tx, lagerId, abteilungId, personId))) {
      return { fehler: "KEIN_MITGLIED" };
    }
    const da = await bestehendeFahrt(tx, lagerId, richtung, { personId });
    return da ? { bereitsIn: da } : undefined;
  }

  const antwortFuer = (a: Ablehnung) =>
    "bereitsIn" in a
      ? ([BEREITS_IN_FAHRT(a.bereitsIn), 409] as const)
      : ([fehlerAntwort(a.fehler), 400] as const);

  // Unique-Verletzung und fehlender Fremdschlüssel nach einem Rennen mit einem Schreiber ausserhalb der Sperre (zum Beispiel das Entfernen eines Mitglieds): dieselbe Antwort wie die Prüfung
  const rennen = (fehler: unknown) => {
    const code = pgFehler(fehler)?.code;
    if (code === "23505") return [BEREITS_IN_FAHRT(), 409] as const;
    if (code === "23503") return [fehlerAntwort("KEIN_MITGLIED"), 400] as const;
    return undefined;
  };

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/fahrten",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", listeAbfrage),
        async (c) =>
          c.json(await ladeFahrten(db, c.get("lager"), c.req.valid("query"))),
      )
      .post(
        "/:id/fahrten",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", fahrtAnlegen),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const person = c.get("person");
          const b = c.req.valid("json");
          const werte = {
            richtung: b.richtung,
            art: b.art,
            name: b.name ?? null,
            fahrerPersonId: b.fahrerPersonId ?? null,
            plaetze: b.plaetze ?? null,
            datum: b.datum ?? null,
            zeit: b.zeit ?? null,
            von: b.von ?? null,
            nach: b.nach ?? null,
            treffpunkt: b.treffpunkt ?? null,
            link: b.link ?? null,
            zielBezeichnung: b.zielBezeichnung ?? null,
            zielAdresse: b.zielAdresse ?? null,
            zielLat: b.zielLat ?? null,
            zielLon: b.zielLon ?? null,
            zielLink: b.zielLink ?? null,
          };
          const fehler = pruefeFahrt(werte);
          if (fehler) return c.json(fehlerAntwort(fehler), 400);
          try {
            const ergebnis = await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              if (werte.fahrerPersonId) {
                const ablehnung = await pruefeFahrer(
                  tx,
                  lagerId,
                  person.abteilungId,
                  werte.richtung,
                  werte.fahrerPersonId,
                );
                if (ablehnung) return ablehnung;
              }
              return legeZeileAn(
                tx,
                fahrt,
                { lagerId, personId: person.id },
                werte,
              );
            });
            if ("fehler" in ergebnis || "bereitsIn" in ergebnis) {
              const [body, status] = antwortFuer(ergebnis as Ablehnung);
              return c.json(body, status);
            }
            const { fahrten } = await ladeFahrten(db, zugriff, {
              id: ergebnis.id,
            });
            return c.json(fahrten[0], 201);
          } catch (e) {
            const r = rennen(e);
            if (r) return c.json(r[0], r[1]);
            throw e;
          }
        },
      )
      // Vor «/:fahrtId», damit «ohne» nicht als ID gilt
      .get(
        "/:id/fahrten/ohne",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", ohneFahrtAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          // Wer nur die eigene Fahrt sieht, sieht nicht, wer sonst noch ohne Fahrt ist
          if (!siehtAlleFahrten(zugriff)) throw new HTTPException(403);
          return c.json(
            await ladeOhneFahrt(
              db,
              zugriff,
              c.get("person").abteilungId,
              c.req.valid("query"),
            ),
          );
        },
      )
      .get(
        "/:id/fahrten/:fahrtId",
        lesen,
        eingabe("param", fahrtPfad),
        async (c) => {
          const { fahrten } = await ladeFahrten(db, c.get("lager"), {
            id: c.req.valid("param").fahrtId,
          });
          // Eine fremde Fahrt ist für das Team unbekannt
          if (!fahrten[0]) throw new HTTPException(404);
          return c.json(fahrten[0]);
        },
      )
      .patch(
        "/:id/fahrten/:fahrtId",
        bearbeiten,
        eingabe("param", fahrtPfad),
        eingabe("json", fahrtAendern),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const person = c.get("person");
          const fahrtId = c.req.valid("param").fahrtId;
          const { version, ...werte } = c.req.valid("json");
          try {
            const ergebnis = await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              const [aktuell] = await tx
                .select()
                .from(fahrt)
                .where(
                  and(
                    eq(fahrt.id, fahrtId),
                    eq(fahrt.lagerId, lagerId),
                    isNull(fahrt.geloeschtAm),
                  ),
                );
              if (!aktuell) throw new HTTPException(404);
              // Die Regeln über mehrere Felder gelten für den Stand nach der Änderung
              const danach = { ...aktuell, ...werte };
              const fehler = pruefeFahrt(danach);
              if (fehler) return { fehler };
              if (
                werte.fahrerPersonId &&
                werte.fahrerPersonId !== aktuell.fahrerPersonId
              ) {
                const ablehnung = await pruefeFahrer(
                  tx,
                  lagerId,
                  person.abteilungId,
                  aktuell.richtung,
                  werte.fahrerPersonId,
                );
                if (ablehnung) return ablehnung;
              }
              return aendereZeile(
                tx,
                fahrt,
                { lagerId, personId: person.id },
                { id: fahrtId, version, werte, ansicht: fahrtAnsicht },
              );
            });
            if ("fehler" in ergebnis || "bereitsIn" in ergebnis) {
              const [body, status] = antwortFuer(ergebnis as Ablehnung);
              return c.json(body, status);
            }
            const { fahrten } = await ladeFahrten(db, zugriff, { id: fahrtId });
            return c.json(fahrten[0]);
          } catch (e) {
            const r = rennen(e);
            if (r) return c.json(r[0], r[1]);
            throw e;
          }
        },
      )
      .delete(
        "/:id/fahrten/:fahrtId",
        bearbeiten,
        eingabe("param", fahrtPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const k = { lagerId, personId: c.get("person").id };
          const fahrtId = c.req.valid("param").fahrtId;
          await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            await loescheZeile(tx, fahrt, k, {
              id: fahrtId,
              version: c.req.valid("query").version,
              ansicht: fahrtAnsicht,
            });
            // Die Mitfahrenden fallen mit der Fahrt weg (sonst blieben sie für diese Richtung besetzt): ein Update für alle, ein Feed-Insert
            const mit = await tx
              .select({ id: fahrtMitfahrer.id })
              .from(fahrtMitfahrer)
              .where(
                and(
                  eq(fahrtMitfahrer.lagerId, lagerId),
                  eq(fahrtMitfahrer.fahrtId, fahrtId),
                  isNull(fahrtMitfahrer.geloeschtAm),
                ),
              );
            await loescheZeilen(tx, fahrtMitfahrer, k, {
              ids: mit.map((m) => m.id),
            });
          });
          return c.body(null, 204);
        },
      )
      .post(
        "/:id/fahrten/:fahrtId/mitfahrer",
        bearbeiten,
        eingabe("param", fahrtPfad),
        eingabe("json", mitfahrerAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const fahrtId = c.req.valid("param").fahrtId;
          const { personId, teilnehmerId } = c.req.valid("json");
          try {
            const ergebnis = await db.transaction(async (tx) => {
              await sperreLager(tx, lagerId);
              const [f] = await tx
                .select()
                .from(fahrt)
                .where(
                  and(
                    eq(fahrt.id, fahrtId),
                    eq(fahrt.lagerId, lagerId),
                    isNull(fahrt.geloeschtAm),
                  ),
                );
              if (!f) throw new HTTPException(404);
              if (personId) {
                if (
                  !(await istAktivesMitglied(
                    tx,
                    lagerId,
                    person.abteilungId,
                    personId,
                  ))
                ) {
                  return { fehler: "KEIN_MITGLIED" } as const;
                }
              } else {
                const [t] = await tx
                  .select({ id: teilnehmer.id })
                  .from(teilnehmer)
                  .where(
                    and(
                      eq(teilnehmer.lagerId, lagerId),
                      eq(teilnehmer.id, teilnehmerId!),
                      isNull(teilnehmer.geloeschtAm),
                    ),
                  );
                if (!t) return { fehler: "TEILNEHMER_UNBEKANNT" } as const;
              }
              const da = await bestehendeFahrt(
                tx,
                lagerId,
                f.richtung,
                personId ? { personId } : { teilnehmerId: teilnehmerId! },
              );
              if (da) return { bereitsIn: da };
              const neu = await legeZeileAn(
                tx,
                fahrtMitfahrer,
                { lagerId, personId: person.id },
                {
                  fahrtId,
                  richtung: f.richtung,
                  personId: personId ?? null,
                  teilnehmerId: teilnehmerId ?? null,
                },
              );
              // Belegung nach dem Eintragen: eine Zählung
              const [n] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(fahrtMitfahrer)
                .where(
                  and(
                    eq(fahrtMitfahrer.lagerId, lagerId),
                    eq(fahrtMitfahrer.fahrtId, fahrtId),
                    isNull(fahrtMitfahrer.geloeschtAm),
                  ),
                );
              return { neu, plaetze: f.plaetze, belegt: n!.n };
            });
            if ("fehler" in ergebnis || "bereitsIn" in ergebnis) {
              const [body, status] = antwortFuer(ergebnis as Ablehnung);
              return c.json(body, status);
            }
            return c.json(
              {
                ...mitfahrerAnsicht(ergebnis.neu),
                belegt: ergebnis.belegt,
                plaetze: ergebnis.plaetze,
                // Nur eine Warnung: Mehr Mitfahrende als Plätze lässt der Server zu
                ueberbelegt:
                  ergebnis.plaetze !== null &&
                  ergebnis.belegt > ergebnis.plaetze,
              },
              201,
            );
          } catch (e) {
            const r = rennen(e);
            if (r) return c.json(r[0], r[1]);
            throw e;
          }
        },
      )
      .delete(
        "/:id/fahrten/:fahrtId/mitfahrer/:mitfahrerId",
        bearbeiten,
        eingabe("param", mitfahrerPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { fahrtId, mitfahrerId } = c.req.valid("param");
          await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            // Die Mitfahrt muss zu dieser Fahrt gehören
            const [m] = await tx
              .select({ id: fahrtMitfahrer.id })
              .from(fahrtMitfahrer)
              .where(
                and(
                  eq(fahrtMitfahrer.id, mitfahrerId),
                  eq(fahrtMitfahrer.lagerId, lagerId),
                  eq(fahrtMitfahrer.fahrtId, fahrtId),
                  isNull(fahrtMitfahrer.geloeschtAm),
                ),
              );
            if (!m) throw new HTTPException(404);
            await loescheZeile(
              tx,
              fahrtMitfahrer,
              { lagerId, personId: c.get("person").id },
              {
                id: mitfahrerId,
                version: c.req.valid("query").version,
                ansicht: mitfahrerAnsicht,
              },
            );
          });
          return c.body(null, 204);
        },
      )
  );
}
