import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  ereignisverteiler,
  sseNachricht,
  type Ausgabe,
  type Ereignisverteiler,
  type Verbindung,
} from "../../lager/ereignisse.js";
import {
  darfTabelleLesen,
  lagerZugriff,
  type LagerEnv,
} from "../../lager/policy.js";
import { listeLagerTabellen } from "../../lager/tabellen.js";

// Wie viele Meldungen ein Client unabgeholt haben darf, bevor die Verbindung endet
const RUECKSTAU = 16;
const WIEDER_NACH_MS = 5000;

type EreignisEnv = {
  Variables: LagerEnv["Variables"] & { sitzungId?: string };
};

// Server-Sent Events eines Lagers (#367): «Es gibt Neues bis Folgenummer N» für die Objekttypen, die die Rolle lesen darf, ohne IDs, Namen oder Inhalte. Den Inhalt holt die App über den Änderungsfeed (GET /aenderungen?seit=), wo auch der Zeilenfilter gilt. Die Route ist lesend und darum auch in einem abgeschlossenen Lager offen. Die Obergrenzen und das Ende der Verbindung bei Rollen- oder Sitzungswechsel stehen in lager/ereignisse.ts
export function erstelleEreignisRouten({
  db,
  verteiler = ereignisverteiler,
}: {
  db: Db;
  verteiler?: Ereignisverteiler;
}) {
  return new Hono<EreignisEnv>().get(
    "/:id/ereignisse",
    lagerZugriff(db),
    // Wer keinen Last-Event-ID senden kann, fragt mit ?seit= (die Folgenummer der letzten Meldung)
    eingabe(
      "query",
      z.strictObject({ seit: z.coerce.number().int().min(0).optional() }),
    ),
    (c) => {
      const zugriff = c.get("lager");
      const person = c.get("person");
      const sitzungId = c.get("sitzungId");
      // Ohne Sitzungs-ID könnte die Kontrolle die Verbindung nie prüfen: ablehnen (SR-54)
      if (!sitzungId) {
        return c.json(
          { code: "NICHT_ANGEMELDET", message: "Nicht angemeldet" },
          401,
        );
      }
      const kopf = c.req.header("Last-Event-ID");
      const letzte =
        c.req.valid("query").seit ??
        (kopf !== undefined && /^\d{1,15}$/.test(kopf)
          ? Number(kopf)
          : undefined);

      const kodierer = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      let zu = false;
      const halter: { verbindung?: Verbindung } = {};
      const ausgabe: Ausgabe = {
        senden(text) {
          // Der Client holt nicht mehr ab: Die Verbindung endet statt den Speicher zu füllen
          if (zu || (controller.desiredSize ?? 0) <= 0) return false;
          controller.enqueue(kodierer.encode(text));
          return true;
        },
        schliesse() {
          if (zu) return;
          zu = true;
          try {
            controller.close();
          } catch {
            // schon geschlossen
          }
        },
      };
      const strom = new ReadableStream<Uint8Array>(
        {
          start(k) {
            controller = k;
          },
          // Der Client hat aufgelegt
          cancel() {
            zu = true;
            if (halter.verbindung) verteiler.beende(halter.verbindung);
          },
        },
        new CountQueuingStrategy({ highWaterMark: RUECKSTAU }),
      );

      const lesbar = new Set(
        listeLagerTabellen()
          // Tabellen ohne eigenes Leserecht (recht: null, lager_datei) melden keinen Typ: Ihre Einträge kommen nur mit den Datensätzen der Module, die sie einbinden, und der Feed filtert die Zeilen
          .filter(
            ([, e]) => e.recht !== null && darfTabelleLesen(zugriff, e.recht),
          )
          .map(([name]) => name),
      );
      const angemeldet = verteiler.verbinde(
        db,
        {
          lagerId: zugriff.lager.id,
          personId: person.id,
          sitzungId,
          rolle: zugriff.rolle,
          lesbar,
          seq: zugriff.lager.seq,
        },
        ausgabe,
      );
      if (typeof angemeldet === "string") {
        return c.json(
          {
            code: "ZU_VIELE_VERBINDUNGEN",
            message:
              "Zu viele offene Verbindungen. Bitte später erneut versuchen.",
          },
          429,
          { "Retry-After": "30" },
        );
      }
      halter.verbindung = angemeldet.verbindung;
      const { seq } = angemeldet;
      c.req.raw.signal.addEventListener("abort", () =>
        verteiler.beende(angemeldet.verbindung),
      );

      // Erste Nachricht: Wo steht das Lager, und muss die App etwas nachholen? Ein Stand aus der Zukunft (Lager zurückgespielt) heisst neu laden
      const erste =
        letzte !== undefined && letzte > seq
          ? sseNachricht("neu-laden", { bis: seq }, seq)
          : letzte !== undefined && letzte < seq
            ? sseNachricht(
                "aenderung",
                { bis: seq, objekttypen: [...lesbar].sort() },
                seq,
              )
            : sseNachricht("bereit", { bis: seq }, seq);
      ausgabe.senden(`retry: ${WIEDER_NACH_MS}\n${erste}`);

      return c.body(strom, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        // Nginx-artige Proxys puffern sonst; der Caddy der Anlage braucht es nicht
        "X-Accel-Buffering": "no",
      });
    },
  );
}
