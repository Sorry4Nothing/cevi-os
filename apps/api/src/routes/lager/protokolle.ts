import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { ladeSichtbareDatei } from "../../lager/datei.js";
import {
  aendereBeschluss,
  aendereProtokoll,
  beschlussAendern,
  beschlussAnlegen,
  beschluesseAbfrage,
  legeBeschlussAn,
  legeProtokollAn,
  ladeBeschluesse,
  ladeProtokolle,
  loescheBeschluss,
  loescheProtokoll,
  protokollAendern,
  protokollAnlegen,
  protokolleAbfrage,
  versionAbfrage,
  type Pruefung,
} from "../../lager/protokolle.js";
import {
  lagerZugriff,
  type LagerEnv,
  type LagerZugriff,
} from "../../lager/policy.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const protokollPfad = z.strictObject({ id: z.uuid(), protokollId: z.uuid() });
const beschlussPfad = z.strictObject({ id: z.uuid(), beschlussId: z.uuid() });

const FEHLER_TEXT = {
  HOECK_UNBEKANNT: "Den Höck gibt es in diesem Lager nicht.",
  PROTOKOLL_UNBEKANNT: "Das Protokoll gibt es in diesem Lager nicht.",
  HOECK_PASST_NICHT: "Das Protokoll gehört zu einem anderen Höck.",
  DATEI_UNBEKANNT: "Diese Datei gibt es in diesem Lager nicht.",
} as const;
const fehlerAntwort = (code: keyof typeof FEHLER_TEXT) => ({
  code,
  message: FEHLER_TEXT[code],
});

// Protokolle (Verknüpfung auf eine Datei im SharePoint) und Beschlüsse eines Lagers (#379), Beschreibung in lager/protokolle.ts. Lesen: protokolle.lesen; Schreiben: protokolle.bearbeiten. Ein Protokoll oder Beschluss eines Höcks der Lagerleitung ist für Rollen ohne alle Höcks 404. Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Eintrag im Änderungsfeed. Löschen ist endgültig (#427) und entfernt nie die Datei am Ablageort
export function erstelleProtokollRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "protokolle.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "protokolle.bearbeiten" });

  // Das Protokoll, soweit die Person es sieht; sonst 404 (auch für ein Protokoll eines fremden Lagers)
  async function protokollDa(zugriff: LagerZugriff, id: string) {
    const { eintraege } = await ladeProtokolle(db, zugriff, { id });
    if (!eintraege[0]) throw new HTTPException(404);
    return eintraege[0];
  }
  async function beschlussDa(zugriff: LagerZugriff, id: string) {
    const { eintraege } = await ladeBeschluesse(db, zugriff, { id });
    if (!eintraege[0]) throw new HTTPException(404);
    return eintraege[0];
  }

  // Die Datei muss die Person sehen (selbst in den letzten 24 Stunden hinzugefügt oder über einen lesbaren Datensatz) und zu diesem Lager gehören; sonst 400. So bindet niemand eine Datei ein, die er nicht kennt
  const dateiPruefen = async (
    zugriff: LagerZugriff,
    personId: string,
    dateiId: string,
  ) => !!(await ladeSichtbareDatei(db, zugriff, personId, dateiId));

  const antwortProtokoll = async (zugriff: LagerZugriff, id: string) =>
    (await ladeProtokolle(db, zugriff, { id, ungefiltert: true })).eintraege[0];
  const antwortBeschluss = async (zugriff: LagerZugriff, id: string) =>
    (await ladeBeschluesse(db, zugriff, { id, ungefiltert: true }))
      .eintraege[0];
  const pruefungAntwort = (p: NonNullable<Pruefung>) => fehlerAntwort(p.fehler);

  return new Hono<LagerEnv>()
    .get(
      "/:id/protokolle",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", protokolleAbfrage),
      async (c) => {
        const { eintraege, naechster } = await ladeProtokolle(
          db,
          c.get("lager"),
          c.req.valid("query"),
        );
        return c.json({ protokolle: eintraege, naechster });
      },
    )
    .post(
      "/:id/protokolle",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", protokollAnlegen),
      async (c) => {
        const zugriff = c.get("lager");
        const person = c.get("person");
        const werte = c.req.valid("json");
        if (!(await dateiPruefen(zugriff, person.id, werte.dateiId))) {
          return c.json(fehlerAntwort("DATEI_UNBEKANNT"), 400);
        }
        const ergebnis = await db.transaction((tx) =>
          legeProtokollAn(
            tx,
            zugriff,
            { lagerId: zugriff.lager.id, personId: person.id },
            werte,
          ),
        );
        if ("fehler" in ergebnis) {
          return c.json(fehlerAntwort(ergebnis.fehler), 400);
        }
        return c.json(await antwortProtokoll(zugriff, ergebnis.id), 201);
      },
    )
    .get(
      "/:id/protokolle/:protokollId",
      lesen,
      eingabe("param", protokollPfad),
      async (c) =>
        c.json(
          await protokollDa(c.get("lager"), c.req.valid("param").protokollId),
        ),
    )
    .patch(
      "/:id/protokolle/:protokollId",
      bearbeiten,
      eingabe("param", protokollPfad),
      eingabe("json", protokollAendern),
      async (c) => {
        const zugriff = c.get("lager");
        const person = c.get("person");
        const { protokollId } = c.req.valid("param");
        const werte = c.req.valid("json");
        await protokollDa(zugriff, protokollId);
        if (
          werte.dateiId &&
          !(await dateiPruefen(zugriff, person.id, werte.dateiId))
        ) {
          return c.json(fehlerAntwort("DATEI_UNBEKANNT"), 400);
        }
        const fehler = await db.transaction((tx) =>
          aendereProtokoll(
            tx,
            zugriff,
            { lagerId: zugriff.lager.id, personId: person.id },
            protokollId,
            werte,
          ),
        );
        if (fehler) return c.json(fehlerAntwort(fehler.fehler), 400);
        return c.json(await antwortProtokoll(zugriff, protokollId));
      },
    )
    .delete(
      "/:id/protokolle/:protokollId",
      bearbeiten,
      eingabe("param", protokollPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const zugriff = c.get("lager");
        const { protokollId } = c.req.valid("param");
        await protokollDa(zugriff, protokollId);
        await db.transaction((tx) =>
          loescheProtokoll(
            tx,
            zugriff,
            { lagerId: zugriff.lager.id, personId: c.get("person").id },
            protokollId,
            c.req.valid("query").version,
          ),
        );
        return c.body(null, 204);
      },
    )
    .get(
      "/:id/beschluesse",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", beschluesseAbfrage),
      async (c) => {
        const { eintraege, naechster } = await ladeBeschluesse(
          db,
          c.get("lager"),
          c.req.valid("query"),
        );
        return c.json({ beschluesse: eintraege, naechster });
      },
    )
    .post(
      "/:id/beschluesse",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", beschlussAnlegen),
      async (c) => {
        const zugriff = c.get("lager");
        const ergebnis = await db.transaction((tx) =>
          legeBeschlussAn(
            tx,
            zugriff,
            { lagerId: zugriff.lager.id, personId: c.get("person").id },
            c.req.valid("json"),
          ),
        );
        if ("fehler" in ergebnis) {
          return c.json(pruefungAntwort(ergebnis), 400);
        }
        return c.json(await antwortBeschluss(zugriff, ergebnis.id), 201);
      },
    )
    .get(
      "/:id/beschluesse/:beschlussId",
      lesen,
      eingabe("param", beschlussPfad),
      async (c) =>
        c.json(
          await beschlussDa(c.get("lager"), c.req.valid("param").beschlussId),
        ),
    )
    .patch(
      "/:id/beschluesse/:beschlussId",
      bearbeiten,
      eingabe("param", beschlussPfad),
      eingabe("json", beschlussAendern),
      async (c) => {
        const zugriff = c.get("lager");
        const { beschlussId } = c.req.valid("param");
        await beschlussDa(zugriff, beschlussId);
        const fehler = await db.transaction((tx) =>
          aendereBeschluss(
            tx,
            zugriff,
            { lagerId: zugriff.lager.id, personId: c.get("person").id },
            beschlussId,
            c.req.valid("json"),
          ),
        );
        if (fehler) return c.json(pruefungAntwort(fehler), 400);
        return c.json(await antwortBeschluss(zugriff, beschlussId));
      },
    )
    .delete(
      "/:id/beschluesse/:beschlussId",
      bearbeiten,
      eingabe("param", beschlussPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const zugriff = c.get("lager");
        const { beschlussId } = c.req.valid("param");
        await beschlussDa(zugriff, beschlussId);
        await db.transaction((tx) =>
          loescheBeschluss(
            tx,
            { lagerId: zugriff.lager.id, personId: c.get("person").id },
            beschlussId,
            c.req.valid("query").version,
          ),
        );
        return c.body(null, 204);
      },
    );
}
