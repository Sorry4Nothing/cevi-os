import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  anwesenheit,
  anwesenheitAnfrage,
  auditLog,
  lager,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  anfrageAnsicht,
  anfragenAbfrage,
  anfragenAnlegen,
  anfragenEntscheiden,
  anwesenheitAnsicht,
  eigeneSetzen,
  entscheideAnfragen,
  fristSetzen,
  ladeMatrix,
  ladeZusammenfassung,
  legeAnfragenAn,
  leitungSetzen,
  matrixAbfrage,
  setzeAlsEigene,
  setzeAlsLeitung,
} from "../../lager/anwesenheit.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { anzeigeNamenLager } from "../../lager/zimmer.js";
import type { Fcm } from "../../push.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const tageAbfrage = z.strictObject({
  lagertagIds: matrixAbfrage.shape.lagertagIds,
});

const FELD_UNBEKANNT_TEXT =
  "Einen der Tage oder Abschnitte gibt es in diesem Lager nicht.";
const NUR_MITGLIEDER = {
  code: "KEIN_MITGLIED",
  message: "Nur Mitglieder des Lagers tragen eigene Anwesenheit ein.",
} as const;

// Anwesenheit im Lager (#390), Regeln in lager/anwesenheit.ts. Die Rechte trennen die Wege: Wer alles lesen darf (anwesenheit.lesen_alle), liest die Matrix; wer eigene Anwesenheit eintragen darf (anwesenheit.eigene), trägt nur eigene offene Felder ein oder stellt Anfragen; wer bearbeiten darf (anwesenheit.bearbeiten), schreibt für alle und entscheidet Anfragen. Der Weg des Teams nimmt keine Personen-ID entgegen
export function erstelleAnwesenheitRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const lesen = lagerZugriff(db, { recht: "anwesenheit.lesen_alle" });
  const eigene = lagerZugriff(db, { recht: "anwesenheit.eigene" });
  const bearbeiten = lagerZugriff(db, { recht: "anwesenheit.bearbeiten" });

  const frist = (c: Context<LagerEnv>) => c.get("lager").lager.anwesenheitFrist;

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/anwesenheit",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", matrixAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          const matrix = await ladeMatrix(
            db,
            zugriff.lager.id,
            c.req.valid("query"),
          );
          // Namen der Seite (#520): ID der Person oder des Teilnehmenden -> Anzeigename des Lagers, eine Abfrage für die ganze Seite. Teilnehmende nur mit teilnehmer.lesen
          const ids = new Set(
            matrix.eintraege.flatMap((e) => [
              ...(e.personId ? [e.personId] : []),
              ...(e.teilnehmerId && darf(zugriff, "teilnehmer.lesen")
                ? [e.teilnehmerId]
                : []),
            ]),
          );
          const alle =
            ids.size > 0
              ? await anzeigeNamenLager(
                  db,
                  zugriff.lager.id,
                  darf(zugriff, "teilnehmer.bearbeiten"),
                )
              : new Map<string, string>();
          return c.json({
            ...matrix,
            namen: Object.fromEntries(
              [...ids].flatMap((id) =>
                alle.has(id) ? [[id, alle.get(id)!]] : [],
              ),
            ),
            frist: frist(c),
          });
        },
      )
      .put(
        "/:id/anwesenheit",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", leitungSetzen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const ergebnis = await db.transaction((tx) =>
            setzeAlsLeitung(
              tx,
              { lagerId, personId: c.get("person").id },
              c.req.valid("json").eintraege,
            ),
          );
          if ("fehler" in ergebnis) {
            return c.json(
              {
                code: ergebnis.fehler,
                message:
                  ergebnis.fehler === "FELD_UNBEKANNT"
                    ? FELD_UNBEKANNT_TEXT
                    : ergebnis.fehler === "TEILNEHMER_UNBEKANNT"
                      ? "Einer der Teilnehmenden gehört nicht zu diesem Lager."
                      : "Eine der Personen ist kein Mitglied dieses Lagers.",
              },
              400,
            );
          }
          return c.json(ergebnis);
        },
      )
      .get(
        "/:id/anwesenheit/eigene",
        eigene,
        eingabe("param", lagerPfad),
        eingabe("query", tageAbfrage),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const personId = c.get("person").id;
          const { lagertagIds } = c.req.valid("query");
          // Zwei gebündelte Abfragen: die eigenen Felder (höchstens Tage mal Abschnitte) und die letzten Anfragen
          const eintraege = await db
            .select()
            .from(anwesenheit)
            .where(
              and(
                eq(anwesenheit.lagerId, lagerId),
                eq(anwesenheit.personId, personId),
                lagertagIds
                  ? inArray(anwesenheit.lagertagId, lagertagIds)
                  : undefined,
              ),
            )
            .orderBy(asc(anwesenheit.id));
          const anfragen = await db
            .select()
            .from(anwesenheitAnfrage)
            .where(
              and(
                eq(anwesenheitAnfrage.lagerId, lagerId),
                eq(anwesenheitAnfrage.personId, personId),
              ),
            )
            .orderBy(desc(anwesenheitAnfrage.id))
            .limit(200);
          return c.json({
            eintraege: eintraege.map(anwesenheitAnsicht),
            anfragen: anfragen.map(anfrageAnsicht),
            frist: frist(c),
          });
        },
      )
      .put(
        "/:id/anwesenheit/eigene",
        eigene,
        eingabe("param", lagerPfad),
        eingabe("json", eigeneSetzen),
        async (c) => {
          if (!c.get("lager").mitglied) return c.json(NUR_MITGLIEDER, 403);
          const ergebnis = await db.transaction((tx) =>
            setzeAlsEigene(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("json").eintraege,
              frist(c),
            ),
          );
          if ("fehler" in ergebnis) {
            return c.json(
              { code: ergebnis.fehler, message: FELD_UNBEKANNT_TEXT },
              400,
            );
          }
          if ("gesperrt" in ergebnis) {
            return c.json(
              {
                code: "ANFRAGE_NOETIG",
                message:
                  "Mindestens ein Feld ist schon eingetragen oder die Frist ist abgelaufen. Stelle eine Anfrage an die Lagerleitung.",
                gesperrt: ergebnis.gesperrt,
              },
              409,
            );
          }
          return c.json(ergebnis);
        },
      )
      .get(
        "/:id/anwesenheit/zusammenfassung",
        lesen,
        eingabe("param", lagerPfad),
        async (c) =>
          c.json({
            zeilen: await ladeZusammenfassung(db, c.get("lager").lager.id),
          }),
      )
      .put(
        "/:id/anwesenheit/frist",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", fristSetzen),
        async (c) => {
          const person = c.get("person");
          const lagerId = c.get("lager").lager.id;
          const neu = c.req.valid("json").frist;
          await db.transaction(async (tx) => {
            await tx
              .update(lager)
              .set({ anwesenheitFrist: neu ? new Date(neu) : null })
              .where(eq(lager.id, lagerId));
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "lager_anwesenheit_frist",
              zielTyp: "lager",
              zielId: lagerId,
              details: { frist: neu },
            });
          });
          return c.json({ frist: neu ? new Date(neu) : null });
        },
      )
      .get(
        "/:id/anwesenheit/anfragen",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("query", anfragenAbfrage),
        async (c) => {
          const { status, nach, limit } = c.req.valid("query");
          const zeilen = await db
            .select()
            .from(anwesenheitAnfrage)
            .where(
              and(
                eq(anwesenheitAnfrage.lagerId, c.get("lager").lager.id),
                status ? eq(anwesenheitAnfrage.status, status) : undefined,
                nach ? gt(anwesenheitAnfrage.id, nach) : undefined,
              ),
            )
            .orderBy(asc(anwesenheitAnfrage.id))
            .limit(limit + 1);
          const seite = zeilen.slice(0, limit).map(anfrageAnsicht);
          return c.json({
            anfragen: seite,
            naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
          });
        },
      )
      .post(
        "/:id/anwesenheit/anfragen",
        eigene,
        eingabe("param", lagerPfad),
        eingabe("json", anfragenAnlegen),
        async (c) => {
          if (!c.get("lager").mitglied) return c.json(NUR_MITGLIEDER, 403);
          const { eintraege, notiz } = c.req.valid("json");
          const ergebnis = await db.transaction((tx) =>
            legeAnfragenAn(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              eintraege,
              notiz,
              frist(c),
            ),
          );
          if ("fehler" in ergebnis && ergebnis.fehler === "FELD_UNBEKANNT") {
            return c.json(
              { code: ergebnis.fehler, message: FELD_UNBEKANNT_TEXT },
              400,
            );
          }
          if ("fehler" in ergebnis && "felder" in ergebnis) {
            return c.json(
              ergebnis.fehler === "ANFRAGE_OFFEN"
                ? {
                    code: "ANFRAGE_OFFEN",
                    message: "Für dieses Feld wartet schon eine Anfrage.",
                    felder: ergebnis.felder,
                  }
                : {
                    code: "KEINE_ANFRAGE_NOETIG",
                    message:
                      "Das Feld hat schon diesen Wert, oder du kannst es direkt eintragen.",
                    felder: ergebnis.felder,
                  },
              409,
            );
          }
          await ergebnis.zustellung.senden({ db, fcm, c });
          return c.json({ anfragen: ergebnis.anfragen }, 201);
        },
      )
      // Eine Entscheidung für mehrere Anfragen auf einmal (ein ganzer Tag ist eine Anfrage je Abschnitt)
      .post(
        "/:id/anwesenheit/anfragen/entscheid",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", anfragenEntscheiden),
        async (c) => {
          const { entscheid, anfragen } = c.req.valid("json");
          const ergebnis = await db.transaction((tx) =>
            entscheideAnfragen(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              entscheid,
              anfragen,
            ),
          );
          if ("fehler" in ergebnis) {
            return c.json(
              {
                code: ergebnis.fehler,
                message: "Mindestens eine Anfrage ist schon entschieden.",
                ids: ergebnis.ids,
              },
              409,
            );
          }
          for (const z of ergebnis.zustellungen) {
            await z.senden({ db, fcm, c });
          }
          return c.json({ anfragen: ergebnis.anfragen });
        },
      )
  );
}
