import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingang } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Fcm } from "../../push.js";
import {
  aendereEingang,
  codeAnsicht,
  eigeneListe,
  eingangAendern,
  eingangListe,
  eingangSenden,
  eingangStatusAbfrage,
  eingangTraktandum,
  eingangVersionAbfrage,
  erstelleZaehler,
  hashVonCode,
  ladeEigene,
  ladeEingaenge,
  ladeEingangZeile,
  ladeNachCode,
  LIMIT_ANONYM_JE_LAGER,
  LIMIT_CODE_JE_LAGER,
  LIMIT_NAMENTLICH_JE_KONTO,
  pruefeEingangZiele,
  sendeEingang,
} from "../../lager/eingang.js";
import { legeTraktandumAn } from "../../lager/hoecks.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const eingangPfad = z.strictObject({ id: z.uuid(), eingangId: z.uuid() });

const FEHLER_TEXT = {
  RESSORT_UNBEKANNT: "Das Ressort gibt es in diesem Lager nicht.",
  TRAKTANDUM_UNBEKANNT: "Das Traktandum gibt es in diesem Lager nicht.",
  HOECK_UNBEKANNT: "Den Höck gibt es in diesem Lager nicht.",
} as const;
const fehlerAntwort = (code: keyof typeof FEHLER_TEXT) => ({
  code,
  message: FEHLER_TEXT[code],
});

// Eingang eines Lagers (#383), Beschreibung in lager/eingang.ts. Senden und «eigene» lesen braucht eingang.senden, alles andere eingang.lesen, Antworten und Zuordnen zusätzlich eingang.antworten (lager/rechte-katalog.ts). Anonym heisst: Die Route schreibt keine Person, kein Audit und keinen Eintrag im Änderungsfeed. Die Tabelle läuft nicht durch lager/sync.ts (Begründung in db/schema-lager.ts), die Version prüft die Route selbst (409 VERSION_KONFLIKT)
export function erstelleEingangRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const senden = lagerZugriff(db, { recht: "eingang.senden" });
  // Die Antwort auf eine Rückfrage gibt es auch im abgeschlossenen Lager (nur lesend, trotz POST)
  const statusLesen = lagerZugriff(db, {
    recht: "eingang.senden",
    auchGeschlossen: true,
  });
  const lesen = lagerZugriff(db, { recht: "eingang.lesen" });
  const antworten = lagerZugriff(db, { recht: "eingang.antworten" });

  // Grobe Zähler im Arbeitsspeicher: anonym je Lager, nie je Person; nicht anonym je Konto (SR-71)
  const zuVieleAnonym = erstelleZaehler(LIMIT_ANONYM_JE_LAGER);
  const zuVieleCodes = erstelleZaehler(LIMIT_CODE_JE_LAGER);
  const zuVieleNamentlich = erstelleZaehler(LIMIT_NAMENTLICH_JE_KONTO);

  // Wer antworten darf, muss die Meldung auch lesen dürfen (die Lagerleitung kann die Rechte getrennt vergeben)
  const nurMitLesen = (zugriff: Parameters<typeof darf>[0]) => {
    if (!darf(zugriff, "eingang.lesen")) throw new HTTPException(403);
  };

  return new Hono<LagerEnv>()
    .post(
      "/:id/eingang",
      senden,
      eingabe("param", lagerPfad),
      eingabe("json", eingangSenden),
      async (c) => {
        const zugriff = c.get("lager");
        const person = c.get("person");
        const felder = c.req.valid("json");
        const lagerId = zugriff.lager.id;
        if (
          felder.anonym ? zuVieleAnonym(lagerId) : zuVieleNamentlich(person.id)
        ) {
          throw new HTTPException(429);
        }
        const { zeile, rueckfragecode } = await sendeEingang(
          db,
          lagerId,
          person.id,
          felder,
        );
        // Anonym: weder ID noch Person in der Antwort, nur der Code, einmal
        return c.json(
          felder.anonym
            ? { ...codeAnsicht(zeile), anonym: true, rueckfragecode }
            : { ...codeAnsicht(zeile), anonym: false, id: zeile.id },
          201,
        );
      },
    )
    .get(
      "/:id/eingang/eigene",
      senden,
      eingabe("param", lagerPfad),
      eingabe("query", eigeneListe),
      async (c) =>
        c.json(
          await ladeEigene(
            db,
            c.get("lager").lager.id,
            c.get("person").id,
            c.req.valid("query"),
          ),
        ),
    )
    .post(
      "/:id/eingang/status",
      statusLesen,
      eingabe("param", lagerPfad),
      eingabe("json", eingangStatusAbfrage),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        if (zuVieleCodes(lagerId)) throw new HTTPException(429);
        const hash = hashVonCode(c.req.valid("json").code);
        // Ein Code, der nicht passt, und einer, den es nicht gibt, sind dasselbe (404)
        const zeile = hash && (await ladeNachCode(db, lagerId, hash));
        if (!zeile) throw new HTTPException(404);
        return c.json(codeAnsicht(zeile));
      },
    )
    .get(
      "/:id/eingang",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", eingangListe),
      async (c) =>
        c.json(
          await ladeEingaenge(
            db,
            c.get("lager").lager.id,
            c.req.valid("query"),
          ),
        ),
    )
    .get(
      "/:id/eingang/:eingangId",
      lesen,
      eingabe("param", eingangPfad),
      async (c) => {
        const { eintraege } = await ladeEingaenge(db, c.get("lager").lager.id, {
          id: c.req.valid("param").eingangId,
          limit: 1,
        });
        if (!eintraege[0]) throw new HTTPException(404);
        return c.json(eintraege[0]);
      },
    )
    .patch(
      "/:id/eingang/:eingangId",
      antworten,
      eingabe("param", eingangPfad),
      eingabe("json", eingangAendern),
      async (c) => {
        nurMitLesen(c.get("lager"));
        const zugriff = c.get("lager");
        const k = { lagerId: zugriff.lager.id, personId: c.get("person").id };
        const { eingangId } = c.req.valid("param");
        const felder = c.req.valid("json");
        if (!(await ladeEingangZeile(db, k.lagerId, eingangId))) {
          throw new HTTPException(404);
        }
        const fehler = await pruefeEingangZiele(db, k.lagerId, felder);
        if (fehler) return c.json(fehlerAntwort(fehler), 400);
        const { zustellung } = await db.transaction((tx) =>
          aendereEingang(tx, k, eingangId, felder),
        );
        // Nach dem Commit: Ein Fehler beim Push lässt die Antwort stehen
        await zustellung?.senden({ db, fcm, c });
        const { eintraege } = await ladeEingaenge(db, k.lagerId, {
          id: eingangId,
          limit: 1,
        });
        return c.json(eintraege[0]);
      },
    )
    .post(
      "/:id/eingang/:eingangId/traktandum",
      antworten,
      eingabe("param", eingangPfad),
      eingabe("json", eingangTraktandum),
      async (c) => {
        nurMitLesen(c.get("lager"));
        const zugriff = c.get("lager");
        if (!darf(zugriff, "hoecks.bearbeiten")) throw new HTTPException(403);
        const k = { lagerId: zugriff.lager.id, personId: c.get("person").id };
        const { eingangId } = c.req.valid("param");
        const { version, titel, hoeckId } = c.req.valid("json");
        if (!(await ladeEingangZeile(db, k.lagerId, eingangId))) {
          throw new HTTPException(404);
        }
        // Das Traktandum trägt nur den Titel der Lagerleitung, nie den Text der Meldung: Wer Traktanden liest, muss die Meldung nicht lesen dürfen
        const fehler = await db.transaction(async (tx) => {
          const neu = await legeTraktandumAn(tx, k, {
            titel,
            hoeckId: hoeckId ?? null,
          });
          if ("fehler" in neu) return neu.fehler;
          await aendereEingang(tx, k, eingangId, {
            version,
            traktandumId: neu.id,
          });
          return undefined;
        });
        if (fehler === "HOECK_UNBEKANNT") {
          return c.json(fehlerAntwort(fehler), 400);
        }
        if (fehler) throw new HTTPException(400);
        const { eintraege } = await ladeEingaenge(db, k.lagerId, {
          id: eingangId,
          limit: 1,
        });
        return c.json(eintraege[0], 201);
      },
    )
    .delete(
      "/:id/eingang/:eingangId",
      antworten,
      eingabe("param", eingangPfad),
      eingabe("query", eingangVersionAbfrage),
      async (c) => {
        nurMitLesen(c.get("lager"));
        const lagerId = c.get("lager").lager.id;
        const { eingangId } = c.req.valid("param");
        const { version } = c.req.valid("query");
        // Endgültig: Der Eingang kann Namen im Freitext tragen und hat keinen Papierkorb
        const weg = await db
          .delete(eingang)
          .where(
            and(
              eq(eingang.id, eingangId),
              eq(eingang.lagerId, lagerId),
              eq(eingang.version, version),
            ),
          )
          .returning({ id: eingang.id });
        if (weg.length === 0) {
          const aktuell = await ladeEingangZeile(db, lagerId, eingangId);
          if (!aktuell) throw new HTTPException(404);
          return c.json(
            {
              code: "VERSION_KONFLIKT",
              message: "Die Meldung wurde inzwischen geändert.",
            },
            409,
          );
        }
        return c.body(null, 204);
      },
    );
}
