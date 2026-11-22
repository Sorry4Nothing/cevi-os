import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { aufgabe } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  aufgabeAendern,
  aufgabeAktiv,
  aufgabeAnlegen,
  aufgabeAnsicht,
  aufgabenAbfrage,
  aufgabeReihenfolge,
  aufgabeVersion,
  benachrichtigeAufgabe,
  istBeteiligt,
  ladeAufgabe,
  ladeAufgaben,
  ladeAufgabeZeile,
  ladeBeteiligte,
  leseUmfang,
  pruefeAufgabenWerte,
  setzeUnterstuetzung,
  statusSetzen,
  statusWerte,
  type Pruefung,
} from "../../lager/aufgaben.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile } from "../../lager/sync.js";
import type { Fcm } from "../../push.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const aufgabePfad = z.strictObject({ id: z.uuid(), aufgabeId: z.uuid() });

const FEHLER_TEXT = {
  KEIN_MITGLIED:
    "Verantwortliche und Unterstützung müssen Mitglieder dieses Lagers sein.",
  RESSORT_UNBEKANNT: "Das Ressort gibt es in diesem Lager nicht.",
} as const;
const pruefungAntwort = (fehler: NonNullable<Pruefung>) => ({
  code: fehler.fehler,
  message: FEHLER_TEXT[fehler.fehler],
});

// Aufgaben eines Lagers (#372). Lesen: alle mit aufgaben.lesen_alle oder aufgaben.bearbeiten, sonst nur die eigenen mit aufgaben.eigene (eine fremde Aufgabe ist dann 404). Anlegen, ändern, Reihenfolge und Löschen braucht aufgaben.bearbeiten; den Status setzt auch, wer die Aufgabe als Eigene hat (aufgaben.eigene). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed. Löschen geht allein über loescheZeile. Benachrichtigungen (Zuteilung, Änderung) laufen in derselben Transaktion; der Push geht nach dem Commit
export function erstelleAufgabenRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  // Die Rechte stehen in der Middleware (403 vor dem Schreibschutz 409); welches davon galt, fragt die Route selbst
  const lesen = lagerZugriff(db, {
    einesDerRechte: [
      "aufgaben.lesen_alle",
      "aufgaben.bearbeiten",
      "aufgaben.eigene",
    ],
  });
  const bearbeiten = lagerZugriff(db, { recht: "aufgaben.bearbeiten" });
  const statusRecht = lagerZugriff(db, {
    einesDerRechte: ["aufgaben.bearbeiten", "aufgaben.eigene"],
  });

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/aufgaben",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", aufgabenAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          const filter = c.req.valid("query");
          return c.json(
            await ladeAufgaben(db, zugriff.lager.id, {
              ...filter,
              eigeneVon:
                leseUmfang(zugriff) === "alle" ? undefined : zugriff.personId,
            }),
          );
        },
      )
      .post(
        "/:id/aufgaben",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", aufgabeAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const { unterstuetzungPersonIds, ...werte } = c.req.valid("json");
          const ergebnis = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const fehler = await pruefeAufgabenWerte(tx, lagerId, {
              ...werte,
              unterstuetzungPersonIds,
            });
            if (fehler) return fehler;
            // Ohne Angabe ans Ende
            const [ende] = await tx
              .select({
                n: sql<number>`coalesce(max(${aufgabe.reihenfolge}) + 1, 0)`,
              })
              .from(aufgabe)
              .where(and(eq(aufgabe.lagerId, lagerId), aufgabeAktiv));
            const neu = await legeZeileAn(
              tx,
              aufgabe,
              { lagerId, personId: person.id },
              {
                ...werte,
                reihenfolge: werte.reihenfolge ?? ende!.n,
                ...(werte.status === "erledigt"
                  ? { erledigtAm: new Date() }
                  : {}),
              },
            );
            await setzeUnterstuetzung(
              tx,
              lagerId,
              neu.id,
              unterstuetzungPersonIds ?? [],
            );
            return {
              id: neu.id,
              zustellung: await benachrichtigeAufgabe(tx, {
                lagerId,
                aufgabeId: neu.id,
                ausgeloestVon: person.id,
                nachher: await ladeBeteiligte(tx, lagerId, neu.id),
                geaendert: false,
              }),
            };
          });
          if ("fehler" in ergebnis) {
            return c.json(pruefungAntwort(ergebnis), 400);
          }
          await ergebnis.zustellung.senden({ db, fcm, c });
          return c.json(await ladeAufgabe(db, lagerId, ergebnis.id), 201);
        },
      )
      // Vor «/:aufgabeId»: «reihenfolge» ist keine ID
      .put(
        "/:id/aufgaben/reihenfolge",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", aufgabeReihenfolge),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const { eintraege } = c.req.valid("json");
          await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const vorhanden = await tx
              .select()
              .from(aufgabe)
              .where(and(eq(aufgabe.lagerId, lagerId), aufgabeAktiv));
            const nachId = new Map(vorhanden.map((z) => [z.id, z]));
            if (eintraege.some((e) => !nachId.has(e.id))) {
              throw new HTTPException(404);
            }
            // Die Stelle in der Liste ist die neue Reihenfolge; was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag). Die App schickt die Liste so, wie sie sie zeigt (zum Beispiel eine Spalte des Kanban)
            for (const [stelle, e] of eintraege.entries()) {
              if (nachId.get(e.id)!.reihenfolge === stelle) continue;
              await aendereZeile(
                tx,
                aufgabe,
                { lagerId, personId: person.id },
                {
                  id: e.id,
                  version: e.version,
                  werte: { reihenfolge: stelle },
                  ansicht: aufgabeAnsicht,
                },
              );
            }
          });
          return c.body(null, 204);
        },
      )
      .get(
        "/:id/aufgaben/:aufgabeId",
        lesen,
        eingabe("param", aufgabePfad),
        async (c) => {
          const zugriff = c.get("lager");
          const zeile = await ladeAufgabe(
            db,
            zugriff.lager.id,
            c.req.valid("param").aufgabeId,
            leseUmfang(zugriff) === "alle" ? undefined : zugriff.personId,
          );
          if (!zeile) throw new HTTPException(404);
          return c.json(zeile);
        },
      )
      .patch(
        "/:id/aufgaben/:aufgabeId",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("json", aufgabeAendern),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const { aufgabeId } = c.req.valid("param");
          const { version, unterstuetzungPersonIds, ...werte } =
            c.req.valid("json");
          const ergebnis = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const alt = await ladeAufgabeZeile(tx, lagerId, aufgabeId);
            if (!alt) throw new HTTPException(404);
            const fehler = await pruefeAufgabenWerte(tx, lagerId, {
              ...werte,
              unterstuetzungPersonIds,
            });
            if (fehler) return fehler;
            const vorher = await ladeBeteiligte(tx, lagerId, aufgabeId);
            await aendereZeile(
              tx,
              aufgabe,
              { lagerId, personId: person.id },
              {
                id: aufgabeId,
                version,
                werte: {
                  ...werte,
                  ...(werte.status
                    ? statusWerte(alt.status, werte.status)
                    : {}),
                },
                ansicht: aufgabeAnsicht,
              },
            );
            if (unterstuetzungPersonIds) {
              await setzeUnterstuetzung(
                tx,
                lagerId,
                aufgabeId,
                unterstuetzungPersonIds,
              );
            }
            return benachrichtigeAufgabe(tx, {
              lagerId,
              aufgabeId,
              ausgeloestVon: person.id,
              vorher,
              nachher: await ladeBeteiligte(tx, lagerId, aufgabeId),
              geaendert: true,
            });
          });
          if ("fehler" in ergebnis) {
            return c.json(pruefungAntwort(ergebnis), 400);
          }
          await ergebnis.senden({ db, fcm, c });
          return c.json(await ladeAufgabe(db, lagerId, aufgabeId));
        },
      )
      .put(
        "/:id/aufgaben/:aufgabeId/status",
        statusRecht,
        eingabe("param", aufgabePfad),
        eingabe("json", statusSetzen),
        async (c) => {
          const zugriff = c.get("lager");
          const lagerId = zugriff.lager.id;
          const person = c.get("person");
          const { aufgabeId } = c.req.valid("param");
          const { version, status } = c.req.valid("json");
          const alleDarf = darf(zugriff, "aufgaben.bearbeiten");
          const zustellung = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const alt = await ladeAufgabeZeile(tx, lagerId, aufgabeId);
            // Eine fremde Aufgabe ist für das Team unbekannt: dieselbe 404 wie für eine, die es nicht gibt
            if (
              !alt ||
              (!alleDarf &&
                !(await istBeteiligt(tx, lagerId, aufgabeId, person.id)))
            ) {
              throw new HTTPException(404);
            }
            const vorher = await ladeBeteiligte(tx, lagerId, aufgabeId);
            await aendereZeile(
              tx,
              aufgabe,
              { lagerId, personId: person.id },
              {
                id: aufgabeId,
                version,
                werte: { status, ...statusWerte(alt.status, status) },
                ansicht: aufgabeAnsicht,
              },
            );
            return benachrichtigeAufgabe(tx, {
              lagerId,
              aufgabeId,
              ausgeloestVon: person.id,
              vorher,
              nachher: vorher,
              geaendert: true,
            });
          });
          await zustellung.senden({ db, fcm, c });
          return c.json(await ladeAufgabe(db, lagerId, aufgabeId));
        },
      )
      .delete(
        "/:id/aufgaben/:aufgabeId",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("query", aufgabeVersion),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { aufgabeId } = c.req.valid("param");
          await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            if (!(await ladeAufgabeZeile(tx, lagerId, aufgabeId))) {
              throw new HTTPException(404);
            }
            await loescheZeile(
              tx,
              aufgabe,
              { lagerId, personId: c.get("person").id },
              {
                id: aufgabeId,
                version: c.req.valid("query").version,
                ansicht: aufgabeAnsicht,
              },
            );
          });
          return c.body(null, 204);
        },
      )
  );
}
