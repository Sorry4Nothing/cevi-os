import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { aufgabe } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  aendereAufgabe,
  aufgabeAendern,
  aufgabeAktiv,
  aufgabeAnlegen,
  aufgabeAnsicht,
  aufgabenAbfrage,
  aufgabeReihenfolge,
  aufgabeVersion,
  ladeAufgabe,
  ladeAufgaben,
  legeAufgabeAn,
  leseUmfang,
  loescheAufgabe,
  setzeAufgabeStatus,
  statusSetzen,
  type Pruefung,
} from "../../lager/aufgaben.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import { aendereZeile } from "../../lager/sync.js";
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
          const ergebnis = await db.transaction((tx) =>
            legeAufgabeAn(
              tx,
              { lagerId, personId: c.get("person").id },
              c.req.valid("json"),
            ),
          );
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
          const { aufgabeId } = c.req.valid("param");
          const ergebnis = await db.transaction((tx) =>
            aendereAufgabe(
              tx,
              { lagerId, personId: c.get("person").id },
              aufgabeId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            return c.json(pruefungAntwort(ergebnis), 400);
          }
          await ergebnis.zustellung.senden({ db, fcm, c });
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
          const { aufgabeId } = c.req.valid("param");
          const { version, status } = c.req.valid("json");
          const ergebnis = await db.transaction((tx) =>
            setzeAufgabeStatus(
              tx,
              {
                lagerId,
                personId: c.get("person").id,
                alle: darf(zugriff, "aufgaben.bearbeiten"),
              },
              aufgabeId,
              version,
              status,
            ),
          );
          await ergebnis.zustellung.senden({ db, fcm, c });
          return c.json(await ladeAufgabe(db, lagerId, aufgabeId));
        },
      )
      .delete(
        "/:id/aufgaben/:aufgabeId",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("query", aufgabeVersion),
        async (c) => {
          await db.transaction((tx) =>
            loescheAufgabe(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").aufgabeId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
  );
}
