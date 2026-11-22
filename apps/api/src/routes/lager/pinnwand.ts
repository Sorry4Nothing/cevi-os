import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { pinnwandBeitrag, pinnwandDatei } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Fcm } from "../../push.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import {
  beitragAendern,
  beitragAnlegen,
  beitragAnsicht,
  benachrichtigeUeberBeitrag,
  fensterGueltig,
  istJetztSichtbar,
  kannAlleSehen,
  ladeBeitraege,
  ladeBeitragZeile,
  ladeEmpfaenger,
  listeAbfrage,
  meldeGesehen,
  pruefeBeitragWerte,
  setzeDateien,
  setzeEmpfaenger,
  versionAbfrage,
  type Pruefung,
} from "../../lager/pinnwand.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const beitragPfad = z.strictObject({ id: z.uuid(), beitragId: z.uuid() });
const gesehenSammel = z.strictObject({
  beitragIds: z
    .array(z.uuid())
    .min(1)
    .max(50)
    .refine((l) => new Set(l).size === l.length),
});

const FEHLER_TEXT = {
  KEIN_MITGLIED: "Empfänger müssen Mitglieder dieses Lagers sein.",
  RESSORT_UNBEKANNT: "Ein Ressort als Empfänger gibt es in diesem Lager nicht.",
  GRUPPE_UNBEKANNT: "Eine Gruppe als Empfänger gibt es in diesem Lager nicht.",
  DATEI_UNBEKANNT:
    "Eine Datei gibt es in diesem Lager nicht oder du darfst sie nicht einbinden.",
  ZEITFENSTER_UNGUELTIG: "«Sichtbar bis» muss nach «sichtbar ab» liegen.",
} as const;
const fehlerAntwort = (f: NonNullable<Pruefung>) => ({
  code: f.fehler,
  message: FEHLER_TEXT[f.fehler],
});

// Pinnwand eines Lagers (#381), Beschreibung in lager/pinnwand.ts. Lesen braucht pinnwand.lesen, jede Änderung pinnwand.bearbeiten (lager/rechte-katalog.ts). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed; Löschen ist endgültig (#427)
export function erstellePinnwandRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const lesen = lagerZugriff(db, { recht: "pinnwand.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "pinnwand.bearbeiten" });
  const gesehenZugriff = lagerZugriff(db, {
    recht: "pinnwand.lesen",
    auchGeschlossen: true,
  });

  return (
    new Hono<LagerEnv>()
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
          const k = { lagerId: zugriff.lager.id, personId: person.id };
          if (!fensterGueltig(felder.sichtbarAb, felder.sichtbarBis)) {
            return c.json(
              fehlerAntwort({ fehler: "ZEITFENSTER_UNGUELTIG" }),
              400,
            );
          }
          const fehler = await pruefeBeitragWerte(db, zugriff, {
            personen: felder.empfaenger?.personen,
            ressortIds: felder.empfaenger?.ressortIds,
            gruppeIds: felder.empfaenger?.gruppeIds,
            dateiIds: felder.dateiIds,
          });
          if (fehler) return c.json(fehlerAntwort(fehler), 400);

          const empfaenger = felder.empfaenger ?? {
            rollen: [],
            personen: [],
            ressortIds: [],
            gruppeIds: [],
          };
          const { beitrag, zustellung } = await db.transaction(async (tx) => {
            const neu = await legeZeileAn(tx, pinnwandBeitrag, k, {
              titel: felder.titel,
              text: felder.text,
              wichtig: felder.wichtig,
              angeheftet: felder.angeheftet,
              sichtbarAb: felder.sichtbarAb ?? null,
              sichtbarBis: felder.sichtbarBis ?? null,
            });
            await setzeEmpfaenger(tx, k.lagerId, neu.id, empfaenger);
            await setzeDateien(tx, k, neu.id, felder.dateiIds ?? []);
            const zustellung =
              neu.wichtig && istJetztSichtbar(neu.sichtbarAb, neu.sichtbarBis)
                ? await benachrichtigeUeberBeitrag(
                    tx,
                    k.lagerId,
                    neu.id,
                    empfaenger,
                    person.id,
                  )
                : undefined;
            return { beitrag: neu, zustellung };
          });
          // Nach dem Commit: Ein Fehler beim Push lässt den Beitrag stehen
          await zustellung?.senden({ db, fcm, c });
          const { beitraege } = await ladeBeitraege(db, zugriff, {
            id: beitrag.id,
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
          const person = c.get("person");
          const { beitragId } = c.req.valid("param");
          const { version, empfaenger, dateiIds, ...werte } =
            c.req.valid("json");
          const k = { lagerId: zugriff.lager.id, personId: person.id };
          const alt = await ladeBeitragZeile(db, k.lagerId, beitragId);
          if (!alt) throw new HTTPException(404);
          const ab =
            werte.sichtbarAb === undefined ? alt.sichtbarAb : werte.sichtbarAb;
          const bis =
            werte.sichtbarBis === undefined
              ? alt.sichtbarBis
              : werte.sichtbarBis;
          if (!fensterGueltig(ab, bis)) {
            return c.json(
              fehlerAntwort({ fehler: "ZEITFENSTER_UNGUELTIG" }),
              400,
            );
          }
          let schon: Set<string> | undefined;
          if (dateiIds) {
            const bestehend = await db
              .select({ id: pinnwandDatei.dateiId })
              .from(pinnwandDatei)
              .where(and(eq(pinnwandDatei.beitragId, beitragId)));
            schon = new Set(bestehend.map((z) => z.id));
          }
          const fehler = await pruefeBeitragWerte(db, zugriff, {
            personen: empfaenger?.personen,
            ressortIds: empfaenger?.ressortIds,
            gruppeIds: empfaenger?.gruppeIds,
            dateiIds,
            schonEingebunden: schon,
          });
          if (fehler) return c.json(fehlerAntwort(fehler), 400);

          const zustellung = await db.transaction(async (tx) => {
            // Zuerst der Beitrag: Er prüft die Version (409) und sperrt das Lager, bevor Empfänger und Dateien sich ändern. Eine Änderung nur an Empfängern oder Dateien zählt die Version trotzdem hoch
            const neu = await aendereZeile(tx, pinnwandBeitrag, k, {
              id: beitragId,
              version,
              werte,
              ansicht: beitragAnsicht,
            });
            if (empfaenger)
              await setzeEmpfaenger(tx, k.lagerId, beitragId, empfaenger);
            if (dateiIds) await setzeDateien(tx, k, beitragId, dateiIds);
            // Push, wenn der Beitrag jetzt wichtig und sichtbar ist und es vorher nicht war (keine Wiederholung bei jeder Änderung)
            if (
              !alt.wichtig &&
              neu.wichtig &&
              istJetztSichtbar(neu.sichtbarAb, neu.sichtbarBis)
            ) {
              return benachrichtigeUeberBeitrag(
                tx,
                k.lagerId,
                beitragId,
                empfaenger ?? (await ladeEmpfaenger(tx, beitragId)),
                person.id,
              );
            }
            return undefined;
          });
          await zustellung?.senden({ db, fcm, c });
          const { beitraege } = await ladeBeitraege(db, zugriff, {
            id: beitragId,
            limit: 1,
            alle: true,
          });
          return c.json(beitraege[0]);
        },
      )
      // «Gesehen» (#520): idempotent, für jeden mit pinnwand.lesen, auch im geschlossenen Lager (es ändert nur die eigene Zeile). Ein Beitrag, den die Person nicht lesen darf, ist 404 und es wird nichts gemeldet. Die Sammelroute meldet bis zu 50 Beiträge in zwei Abfragen
      .put(
        "/:id/pinnwand/gesehen",
        gesehenZugriff,
        eingabe("param", lagerPfad),
        eingabe("json", gesehenSammel),
        async (c) => {
          const ok = await meldeGesehen(
            db,
            c.get("lager"),
            c.req.valid("json").beitragIds,
          );
          if (!ok) throw new HTTPException(404);
          return c.body(null, 204);
        },
      )
      .put(
        "/:id/pinnwand/:beitragId/gesehen",
        gesehenZugriff,
        eingabe("param", beitragPfad),
        async (c) => {
          const ok = await meldeGesehen(db, c.get("lager"), [
            c.req.valid("param").beitragId,
          ]);
          if (!ok) throw new HTTPException(404);
          return c.body(null, 204);
        },
      )
      .delete(
        "/:id/pinnwand/:beitragId",
        bearbeiten,
        eingabe("param", beitragPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const k = {
            lagerId: c.get("lager").lager.id,
            personId: c.get("person").id,
          };
          const { beitragId } = c.req.valid("param");
          if (!(await ladeBeitragZeile(db, k.lagerId, beitragId))) {
            throw new HTTPException(404);
          }
          // Endgültig, über den Sync-Kern (#427)
          await db.transaction((tx) =>
            loescheZeile(tx, pinnwandBeitrag, k, {
              id: beitragId,
              version: c.req.valid("query").version,
              ansicht: beitragAnsicht,
            }),
          );
          return c.body(null, 204);
        },
      )
  );
}
