import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { diensttausch } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  entscheideTausch,
  ladeTausche,
  legeTauschAn,
  nimmEntscheidZurueck,
  tauschAbfrage,
  tauschAnlegen,
  tauschAnsicht,
  tauschEntscheiden,
  tauschMitNamen,
  tauschZuruecknehmen,
  tauschZurueckziehen,
  type TauschFehler,
  ziehTauschZurueck,
} from "../../lager/diensttausch.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import type { Fcm } from "../../push.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const tauschPfad = z.strictObject({ id: z.uuid(), tauschId: z.uuid() });

const FEHLER: Record<TauschFehler, [403 | 400 | 409, string]> = {
  NICHT_DEINE_SCHICHT: [403, "Du kannst nur eine eigene Schicht tauschen."],
  NICHT_DEINE_ANFRAGE: [403, "Du kannst nur eigene Anfragen zurückziehen."],
  ANFRAGE_OFFEN: [409, "Für diese Schicht wartet schon eine Anfrage."],
  MIT_SCHICHT_UNGUELTIG: [
    400,
    "Die Wunschschicht gehört keiner anderen Person des Lagers.",
  ],
  MIT_PERSON_UNGUELTIG: [
    400,
    "Die Person, die übernimmt, fehlt oder passt nicht zur Anfrage.",
  ],
  BEREITS_ENTSCHIEDEN: [409, "Die Anfrage ist schon entschieden."],
  SCHICHT_GEAENDERT: [
    409,
    "Die Schicht wurde inzwischen geändert. Lehne die Anfrage ab.",
  ],
  PERSON_NICHT_VERFUEGBAR: [
    409,
    "Die Person, die übernimmt, ist kein aktives Mitglied des Lagers.",
  ],
  ABWESEND: [
    409,
    "Eine der Personen ist im neuen Abschnitt als abwesend eingetragen.",
  ],
  DOPPELBELEGT: [
    409,
    "Eine der Personen hat im neuen Abschnitt schon einen anderen Dienst.",
  ],
  NICHT_ENTSCHIEDEN: [409, "Die Anfrage ist nicht entschieden."],
};
const fehlerAntwort = (fehler: TauschFehler) => {
  const [status, message] = FEHLER[fehler];
  return { status, body: { code: fehler, message } };
};

const NUR_MITGLIEDER = {
  code: "KEIN_MITGLIED",
  message: "Nur Mitglieder des Lagers tauschen eigene Schichten.",
} as const;

// Diensttausch (#389), Regeln in lager/diensttausch.ts. Wer diensttausch.anfragen hat (Standard: Lagerleitung, Leitung, Team), stellt eine Anfrage für eine eigene Schicht, liest die eigenen und zieht sie zurück; wer diensttausch.entscheiden hat (Standard: Lagerleitung und Leitung), liest alle und entscheidet. Die Abteilungsleitung ist kein Mitglied und stellt keine Anfrage (403 KEIN_MITGLIED). Jede Schreibroute geht durch lager/sync.ts unter der Lagersperre
export function erstelleDiensttauschRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const anfragen = lagerZugriff(db, { recht: "diensttausch.anfragen" });
  const entscheiden = lagerZugriff(db, { recht: "diensttausch.entscheiden" });

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/diensttausch",
        entscheiden,
        eingabe("param", lagerPfad),
        eingabe("query", tauschAbfrage),
        async (c) => {
          const liste = await ladeTausche(
            db,
            c.get("lager").lager.id,
            c.req.valid("query"),
          );
          return c.json({
            ...liste,
            tausche: await tauschMitNamen(db, c.get("lager"), liste.tausche),
          });
        },
      )
      // Die letzten 200 eigenen Anfragen in einer Abfrage
      .get(
        "/:id/diensttausch/eigene",
        anfragen,
        eingabe("param", lagerPfad),
        async (c) => {
          const zeilen = await db
            .select()
            .from(diensttausch)
            .where(
              and(
                eq(diensttausch.lagerId, c.get("lager").lager.id),
                eq(diensttausch.vonPersonId, c.get("person").id),
              ),
            )
            .orderBy(desc(diensttausch.id))
            .limit(200);
          return c.json({
            tausche: await tauschMitNamen(
              db,
              c.get("lager"),
              zeilen.map(tauschAnsicht),
            ),
          });
        },
      )
      .post(
        "/:id/diensttausch",
        anfragen,
        eingabe("param", lagerPfad),
        eingabe("json", tauschAnlegen),
        async (c) => {
          if (!c.get("lager").mitglied) return c.json(NUR_MITGLIEDER, 403);
          const person = c.get("person");
          const ergebnis = await db.transaction((tx) =>
            legeTauschAn(
              tx,
              { lagerId: c.get("lager").lager.id, personId: person.id },
              person.abteilungId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          await ergebnis.zustellung.senden({ db, fcm, c });
          return c.json(
            (await tauschMitNamen(db, c.get("lager"), [ergebnis.tausch]))[0],
            201,
          );
        },
      )
      .post(
        "/:id/diensttausch/:tauschId/entscheid",
        entscheiden,
        eingabe("param", tauschPfad),
        eingabe("json", tauschEntscheiden),
        async (c) => {
          const person = c.get("person");
          const ergebnis = await db.transaction((tx) =>
            entscheideTausch(
              tx,
              { lagerId: c.get("lager").lager.id, personId: person.id },
              person.abteilungId,
              c.req.valid("param").tauschId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          for (const z of ergebnis.zustellungen) {
            await z.senden({ db, fcm, c });
          }
          return c.json(
            (await tauschMitNamen(db, c.get("lager"), [ergebnis.tausch]))[0],
          );
        },
      )
      // Entscheid zurücknehmen (#848): Die Anfrage ist wieder offen, ein angenommener Tausch bucht zurück (Regeln in lager/diensttausch.ts)
      .post(
        "/:id/diensttausch/:tauschId/entscheid/zuruecknehmen",
        entscheiden,
        eingabe("param", tauschPfad),
        eingabe("json", tauschZuruecknehmen),
        async (c) => {
          const person = c.get("person");
          const ergebnis = await db.transaction((tx) =>
            nimmEntscheidZurueck(
              tx,
              { lagerId: c.get("lager").lager.id, personId: person.id },
              person.abteilungId,
              c.req.valid("param").tauschId,
              c.req.valid("json").version,
            ),
          );
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          return c.json(
            (await tauschMitNamen(db, c.get("lager"), [ergebnis.tausch]))[0],
          );
        },
      )
      .post(
        "/:id/diensttausch/:tauschId/zurueckziehen",
        anfragen,
        eingabe("param", tauschPfad),
        eingabe("json", tauschZurueckziehen),
        async (c) => {
          const ergebnis = await db.transaction((tx) =>
            ziehTauschZurueck(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").tauschId,
              c.req.valid("json").version,
            ),
          );
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          return c.json(
            (await tauschMitNamen(db, c.get("lager"), [ergebnis.tausch]))[0],
          );
        },
      )
  );
}
