import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { ladeAufgabe } from "../../lager/aufgaben.js";
import {
  aendereCheckpunkt,
  aendereLink,
  checkpunktAendern,
  checklisteReihenfolge,
  checkpunktAnlegen,
  FEHLER_TEXT,
  ladeDetails,
  ladeUrheber,
  ladeVerlauf,
  legeCheckpunktAn,
  legeLinkAn,
  linkAendern,
  linkAnlegen,
  loescheCheckpunkt,
  loescheLink,
  pruefeLeseZugriff,
  setzeStichworte,
  sortiereCheckliste,
  stichworteSetzen,
  verlaufAbfrage,
  zusammenfuehren,
  type Fehler,
  checkpunktAnsicht,
  aufgabeLinkAnsicht,
} from "../../lager/aufgaben-details.js";
import {
  duplikateAbfrage,
  findeDuplikate,
  fuehreAufgabenZusammen,
} from "../../lager/duplikate.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { versionAbfrage } from "../../lager/ressorts.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const aufgabePfad = z.strictObject({ id: z.uuid(), aufgabeId: z.uuid() });
const checkpunktPfad = z.strictObject({
  id: z.uuid(),
  aufgabeId: z.uuid(),
  checkpunktId: z.uuid(),
});
const linkPfad = z.strictObject({
  id: z.uuid(),
  aufgabeId: z.uuid(),
  linkId: z.uuid(),
});

const pruefungAntwort = (fehler: Fehler) => ({
  code: fehler,
  message: FEHLER_TEXT[fehler],
});

// Details einer Aufgabe (#373): Checkliste, Links, Stichworte, Verlauf, Duplikate und Zusammenführen unter /api/v1/lager/{id}/aufgaben/... Rechte wie die Aufgabe: Lesen mit aufgaben.lesen_alle, aufgaben.bearbeiten oder, für eigene Aufgaben, aufgaben.eigene (eine fremde Aufgabe ist dann 404); Schreiben mit aufgaben.bearbeiten, nur das Abhaken eines Checkpunkts auch mit aufgaben.eigene an einer eigenen Aufgabe. Schreibwege gehen durch lager/sync.ts (Version, 409 VERSION_KONFLIKT, Feed). Dieser Router muss vor dem der Aufgaben stehen: «/aufgaben/duplikate» ist sonst eine Aufgaben-ID
export function erstelleAufgabenDetailsRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, {
    einesDerRechte: [
      "aufgaben.lesen_alle",
      "aufgaben.bearbeiten",
      "aufgaben.eigene",
    ],
  });
  const bearbeiten = lagerZugriff(db, { recht: "aufgaben.bearbeiten" });
  const abhaken = lagerZugriff(db, {
    einesDerRechte: ["aufgaben.bearbeiten", "aufgaben.eigene"],
  });
  const verlauf = lagerZugriff(db, { recht: "verlauf.lesen" });

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/aufgaben/duplikate",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("query", duplikateAbfrage),
        async (c) =>
          c.json(
            await findeDuplikate(
              db,
              c.get("lager").lager.id,
              c.req.valid("query"),
            ),
          ),
      )
      .get(
        "/:id/aufgaben/:aufgabeId/details",
        lesen,
        eingabe("param", aufgabePfad),
        async (c) => {
          const zugriff = c.get("lager");
          const { aufgabeId } = c.req.valid("param");
          await pruefeLeseZugriff(db, zugriff, aufgabeId);
          return c.json(await ladeDetails(db, zugriff.lager.id, aufgabeId));
        },
      )
      .get(
        "/:id/aufgaben/:aufgabeId/verlauf",
        verlauf,
        eingabe("param", aufgabePfad),
        eingabe("query", verlaufAbfrage),
        async (c) => {
          const zugriff = c.get("lager");
          const { aufgabeId } = c.req.valid("param");
          await pruefeLeseZugriff(db, zugriff, aufgabeId);
          const [urheber, seite] = await Promise.all([
            ladeUrheber(db, zugriff.lager.id, aufgabeId),
            ladeVerlauf(db, zugriff.lager.id, aufgabeId, c.req.valid("query")),
          ]);
          return c.json({ aufgabeId, ...urheber, ...seite });
        },
      )
      .post(
        "/:id/aufgaben/:aufgabeId/checkliste",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("json", checkpunktAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const e = await db.transaction((tx) =>
            legeCheckpunktAn(
              tx,
              { lagerId, personId: c.get("person").id },
              c.req.valid("param").aufgabeId,
              c.req.valid("json"),
            ),
          );
          if (e.fehler) return c.json(pruefungAntwort(e.fehler), 400);
          return c.json(checkpunktAnsicht(e.zeile), 201);
        },
      )
      // Vor «/:checkpunktId»: «reihenfolge» ist keine ID
      .put(
        "/:id/aufgaben/:aufgabeId/checkliste/reihenfolge",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("json", checklisteReihenfolge),
        async (c) => {
          await db.transaction((tx) =>
            sortiereCheckliste(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").aufgabeId,
              c.req.valid("json").eintraege,
            ),
          );
          return c.body(null, 204);
        },
      )
      .patch(
        "/:id/aufgaben/:aufgabeId/checkliste/:checkpunktId",
        abhaken,
        eingabe("param", checkpunktPfad),
        eingabe("json", checkpunktAendern),
        async (c) => {
          const zugriff = c.get("lager");
          const { aufgabeId, checkpunktId } = c.req.valid("param");
          const zeile = await db.transaction((tx) =>
            aendereCheckpunkt(
              tx,
              {
                lagerId: zugriff.lager.id,
                personId: c.get("person").id,
                alle: darf(zugriff, "aufgaben.bearbeiten"),
                mitglied: zugriff.mitglied,
              },
              aufgabeId,
              checkpunktId,
              c.req.valid("json"),
            ),
          );
          return c.json(checkpunktAnsicht(zeile));
        },
      )
      .delete(
        "/:id/aufgaben/:aufgabeId/checkliste/:checkpunktId",
        bearbeiten,
        eingabe("param", checkpunktPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const { aufgabeId, checkpunktId } = c.req.valid("param");
          await db.transaction((tx) =>
            loescheCheckpunkt(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              aufgabeId,
              checkpunktId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
      .post(
        "/:id/aufgaben/:aufgabeId/links",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("json", linkAnlegen),
        async (c) => {
          const e = await db.transaction((tx) =>
            legeLinkAn(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").aufgabeId,
              c.req.valid("json"),
            ),
          );
          if (e.fehler) return c.json(pruefungAntwort(e.fehler), 400);
          return c.json(aufgabeLinkAnsicht(e.zeile), 201);
        },
      )
      .patch(
        "/:id/aufgaben/:aufgabeId/links/:linkId",
        bearbeiten,
        eingabe("param", linkPfad),
        eingabe("json", linkAendern),
        async (c) => {
          const { aufgabeId, linkId } = c.req.valid("param");
          const zeile = await db.transaction((tx) =>
            aendereLink(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              aufgabeId,
              linkId,
              c.req.valid("json"),
            ),
          );
          return c.json(aufgabeLinkAnsicht(zeile));
        },
      )
      .delete(
        "/:id/aufgaben/:aufgabeId/links/:linkId",
        bearbeiten,
        eingabe("param", linkPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const { aufgabeId, linkId } = c.req.valid("param");
          await db.transaction((tx) =>
            loescheLink(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              aufgabeId,
              linkId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
      .put(
        "/:id/aufgaben/:aufgabeId/stichworte",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("json", stichworteSetzen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { aufgabeId } = c.req.valid("param");
          const { version, stichworte } = c.req.valid("json");
          await db.transaction((tx) =>
            setzeStichworte(
              tx,
              { lagerId, personId: c.get("person").id },
              aufgabeId,
              version,
              stichworte,
            ),
          );
          return c.json(await ladeDetails(db, lagerId, aufgabeId));
        },
      )
      .post(
        "/:id/aufgaben/:aufgabeId/zusammenfuehren",
        bearbeiten,
        eingabe("param", aufgabePfad),
        eingabe("json", zusammenfuehren),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const { aufgabeId } = c.req.valid("param");
          const fehler = await db.transaction((tx) =>
            fuehreAufgabenZusammen(
              tx,
              { lagerId, personId: c.get("person").id },
              { id: aufgabeId, ...c.req.valid("json") },
            ),
          );
          if (fehler) return c.json(pruefungAntwort(fehler.fehler), 400);
          return c.json(await ladeAufgabe(db, lagerId, aufgabeId));
        },
      )
  );
}
