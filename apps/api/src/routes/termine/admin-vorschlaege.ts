import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, kategorieZuordnung, user } from "../../db/schema.js";
import { terminVorschlag } from "../../db/schema-vorschlag.js";
import { eingabe } from "../../eingabe.js";
import { verlange } from "../../rechtemodell/darf.js";
import {
  idPfad,
  ladeTags,
  MEHRZEILIG,
  vorschlagAnsicht,
  type TagAnsicht,
} from "../../termine/vorschlag.js";
import { pushEntscheid } from "../../termine/vorschlag-push.js";
import type { Fcm } from "../../push.js";
import type { TermineEnv } from "./index.js";

// Terminvorschläge entscheiden (#440, Epic #430): Das Recht «Terminvorschläge entscheiden» (rechtemodell/katalog.ts, erweitert: zweiter Faktor); standardmässig nur die Abteilungsleitung, einstellbar für Rollen (#649). Erst den Vorschlag der eigenen Abteilung laden (fremd = 404), dann das Recht (403). Cevi OS schreibt nie nach Outlook: «freigegeben» heisst, die Abteilungsleitung trägt den Termin dort von Hand ein und meldet es dann mit /eingetragen.
const STATI = [
  "offen",
  "freigegeben",
  "abgelehnt",
  "in_outlook_eingetragen",
] as const;

const listeSchema = z.strictObject({
  status: z.enum(STATI).default("offen"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.uuid().optional(),
});
// Ablehnen braucht eine Begründung (höchstens 500 Zeichen), Freigeben hat keine
const entscheidSchema = z
  .strictObject({
    entscheid: z.enum(["freigeben", "ablehnen"]),
    begruendung: z.string().trim().min(1).max(500).regex(MEHRZEILIG).optional(),
  })
  .refine(
    (v) => (v.entscheid === "ablehnen") === (v.begruendung !== undefined),
  );

const STATUS_UNGUELTIG = {
  code: "STATUS_UNGUELTIG",
  message: "Dieser Vorschlag lässt sich in diesem Stand nicht so ändern.",
} as const;
const EIGENER_VORSCHLAG = {
  code: "EIGENER_VORSCHLAG",
  message: "Über deinen eigenen Vorschlag entscheidet eine andere Person.",
} as const;

// Die Kategorien, die in Outlook einzutragen sind: die zugeordneten Namen aus kategorie_zuordnung, sonst der Name des Tags (Kategorie gleich Tag-Name, ohne Gross-/Kleinschreibung). Eine Abfrage für alle Tags
// shortcut: Ein Tag-Name, den eine Zuordnung auf einen anderen Tag umlenkt, wird nicht erkannt; erst relevant, wenn die Verwaltung so etwas zulässt
async function kategorienFuer(db: Db, abteilungId: string, tags: TagAnsicht[]) {
  if (tags.length === 0) return [];
  const zuordnungen = await db
    .select({
      tagId: kategorieZuordnung.tagId,
      kategorie: kategorieZuordnung.kategorie,
    })
    .from(kategorieZuordnung)
    .where(
      and(
        eq(kategorieZuordnung.abteilungId, abteilungId),
        inArray(
          kategorieZuordnung.tagId,
          tags.map((t) => t.id),
        ),
      ),
    );
  const namen = new Set<string>();
  for (const t of tags) {
    const zugeordnet = zuordnungen
      .filter((z) => z.tagId === t.id)
      .map((z) => z.kategorie)
      .sort();
    for (const n of zugeordnet.length > 0 ? zugeordnet : [t.name]) {
      namen.add(n);
    }
  }
  return [...namen];
}

export function erstelleAdminVorschlaegeRouten({
  db,
  fcm,
}: {
  db: Db;
  fcm?: Fcm;
}) {
  // Der Vorschlag in SQL auf die Abteilung der Sitzung gefiltert, dann das Recht; eine Abfrage
  async function lade(person: TermineEnv["Variables"]["person"], id: string) {
    const [zeile] = await db
      .select({
        id: terminVorschlag.id,
        von: terminVorschlag.vorgeschlagenVon,
      })
      .from(terminVorschlag)
      .where(
        and(
          eq(terminVorschlag.id, id),
          eq(terminVorschlag.abteilungId, person.abteilungId),
        ),
      );
    if (!zeile) throw new HTTPException(404);
    await verlange(db, person, "vorschlag.entscheiden", {
      abteilungId: person.abteilungId,
    });
    return zeile;
  }

  // Bedingtes UPDATE: Bei zwei gleichzeitigen Anfragen gewinnt genau eine, die andere findet den alten Status nicht mehr. Das Protokoll steht in derselben Transaktion (nur die ID und der Entscheid, nie Inhalt oder Begründung)
  async function wechsle(
    person: TermineEnv["Variables"]["person"],
    id: string,
    von: (typeof STATI)[number],
    nach: (typeof STATI)[number],
    aktion: string,
    aenderung: Partial<typeof terminVorschlag.$inferInsert> = {},
  ) {
    return db.transaction(async (tx) => {
      const [zeile] = await tx
        .update(terminVorschlag)
        .set({ status: nach, ...aenderung })
        .where(
          and(
            eq(terminVorschlag.id, id),
            eq(terminVorschlag.abteilungId, person.abteilungId),
            eq(terminVorschlag.status, von),
          ),
        )
        .returning({ von: terminVorschlag.vorgeschlagenVon });
      if (!zeile) return null;
      await tx.insert(auditLog).values({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion,
        zielTyp: "termin_vorschlag",
        zielId: id,
        details: { status: nach },
      });
      return zeile;
    });
  }

  // Die Antwort der Abteilungsleitung nennt zusätzlich den Namen der vorschlagenden Person (null nach Kontolöschung)
  const mitName = (
    z: { v: typeof terminVorschlag.$inferSelect; name: string | null },
    tags: Map<string, TagAnsicht>,
  ) => ({
    ...vorschlagAnsicht(z.v, tags),
    vorgeschlagenVonName: z.name,
  });

  return (
    new Hono<TermineEnv>()
      // Eine Seite je Status (Standard: offen), neueste zuerst (uuidv7 ist nach Zeit geordnet); nach ist die ID des letzten Eintrags der Vorseite. Zwei Abfragen je Seite: Zeilen mit dem Namen (Index abteilung_id, status), dann die Tags aller Zeilen
      .get(
        "/admin/termin-vorschlaege",
        eingabe("query", listeSchema),
        async (c) => {
          const person = c.get("person");
          await verlange(db, person, "vorschlag.entscheiden", {
            abteilungId: person.abteilungId,
          });
          const { status, limit, nach } = c.req.valid("query");
          const zeilen = await db
            .select({ v: terminVorschlag, name: user.name })
            .from(terminVorschlag)
            .leftJoin(user, eq(user.id, terminVorschlag.vorgeschlagenVon))
            .where(
              and(
                eq(terminVorschlag.abteilungId, person.abteilungId),
                eq(terminVorschlag.status, status),
                nach ? lt(terminVorschlag.id, nach) : undefined,
              ),
            )
            .orderBy(desc(terminVorschlag.id))
            .limit(limit + 1);
          const weitere = zeilen.length > limit;
          const seite = zeilen.slice(0, limit);
          const tags = await ladeTags(
            db,
            person.abteilungId,
            seite.map((z) => z.v),
          );
          return c.json({
            vorschlaege: seite.map((z) => mitName(z, tags)),
            weitere,
            naechste: weitere ? seite[seite.length - 1]!.v.id : null,
          });
        },
      )
      // Drei Abfragen: Vorschlag mit Name, Tags, Zuordnungen für die Kategorien
      .get(
        "/admin/termin-vorschlaege/:id",
        eingabe("param", idPfad),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const [zeile] = await db
            .select({ v: terminVorschlag, name: user.name })
            .from(terminVorschlag)
            .leftJoin(user, eq(user.id, terminVorschlag.vorgeschlagenVon))
            .where(
              and(
                eq(terminVorschlag.id, id),
                eq(terminVorschlag.abteilungId, person.abteilungId),
              ),
            );
          if (!zeile) throw new HTTPException(404);
          await verlange(db, person, "vorschlag.entscheiden", {
            abteilungId: person.abteilungId,
          });
          const tags = await ladeTags(db, person.abteilungId, [zeile.v]);
          const gefunden = zeile.v.tagIds.flatMap((t) => tags.get(t) ?? []);
          return c.json({
            ...mitName(zeile, tags),
            kategorien: await kategorienFuer(db, person.abteilungId, gefunden),
          });
        },
      )
      .post(
        "/admin/termin-vorschlaege/:id/entscheid",
        eingabe("param", idPfad),
        eingabe("json", entscheidSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const b = c.req.valid("json");
          const ziel = await lade(person, id);
          // Auch eine Person der Abteilungsleitung entscheidet nie über den eigenen Vorschlag
          if (ziel.von === person.id) return c.json(EIGENER_VORSCHLAG, 403);
          const status =
            b.entscheid === "freigeben" ? "freigegeben" : "abgelehnt";
          const geaendert = await wechsle(
            person,
            id,
            "offen",
            status,
            "termin_vorschlag_entschieden",
            {
              entschiedenVon: person.id,
              entschiedenAm: new Date(),
              begruendung: b.begruendung ?? null,
            },
          );
          if (!geaendert) return c.json(STATUS_UNGUELTIG, 409);
          await pushEntscheid(
            { db, fcm, c },
            {
              abteilungId: person.abteilungId,
              vorschlagId: id,
              vonId: geaendert.von,
              entscheid: status,
            },
          );
          return c.json({ id, status });
        },
      )
      // Die Abteilungsleitung meldet, dass sie den freigegebenen Termin in Outlook eingetragen hat; der Abgleich übernimmt ihn später als Termin
      .post(
        "/admin/termin-vorschlaege/:id/eingetragen",
        eingabe("param", idPfad),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          await lade(person, id);
          const geaendert = await wechsle(
            person,
            id,
            "freigegeben",
            "in_outlook_eingetragen",
            "termin_vorschlag_eingetragen",
          );
          if (!geaendert) return c.json(STATUS_UNGUELTIG, 409);
          return c.json({ id, status: "in_outlook_eingetragen" as const });
        },
      )
  );
}
