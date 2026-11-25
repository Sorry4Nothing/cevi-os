import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  ARTEN,
  BEREICHE,
  type Schalter,
  type SchalterArt,
  type SchalterBereich,
  type SchalterZustand,
} from "../bereichsschalter.js";
import type { Db } from "../db/client.js";
import {
  auditLog,
  bereichsschalter,
  plattformEntwickler,
  user,
} from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { log } from "../log.js";
import { sendePush, type Fcm } from "../push.js";
import { zweiterFaktorFehlt, type Person } from "../rechte.js";
import { darf as darfRecht, darfEines } from "../rechtemodell/darf.js";
import { beendeSitzungen } from "../sitzungen-beenden.js";
import { meldeWebsiteEreignis } from "../website/ereignisse.js";

// Wartungsmodus (#424) und Informationssperre (#425): schalten, aufheben, Zustand lesen. Die Routen liegen unter /api/v1/plattform und nicht unter /admin, weil auch Entwickler und Webmaster ohne Verwaltungskonto hier schalten; weder Wartung noch Sperre treffen diesen Pfad.
// Wer schaltet (#802): Den Wartungsmodus jedes Bereichs, auch «alles» und «website», schaltet nur der Entwickler («wartung.bereiche» und «wartungsmodus.website», fest und nur Entwickler), nie die Abteilungsleitung, nie eine Rolle. Die Informationssperre lösen und heben Entwickler und Abteilungsleitung auf («plattform.sperren», fest), nie eine Rolle. Die Abteilungsleitung liest den Stand der Wartung (GET), schaltet sie nicht. Jede Schaltung braucht den zweiten Faktor, wie jedes erweiterte Recht.
// Art und Bereich stehen im Body (PUT) und in der Query (DELETE), nicht im Pfad: Der Schalter gehört der Abteilung der Sitzung, es gibt kein fremdes Objekt, das ein Pfad nennen könnte.

const zielSchema = {
  art: z.enum(ARTEN),
  bereich: z.enum(BEREICHE),
};
const loeschenSchema = z.strictObject(zielSchema);
const setzenSchema = z
  .strictObject({
    ...zielSchema,
    hinweis: z.string().trim().min(1).max(500).nullable().optional(),
    ende: z.iso.datetime({ offset: true }).nullable().optional(),
    // Nur bei der Sperre, nur auf Wunsch: alle Sitzungen der Abteilung beenden (ausser der eigenen) und die öffentliche Website vom Netz nehmen
    sitzungenBeenden: z.boolean().optional(),
    websiteOffline: z.boolean().optional(),
  })
  .refine(
    (f) =>
      f.art === "sperre" ||
      (f.sitzungenBeenden !== true && f.websiteOffline !== true),
  )
  .refine(
    (f) =>
      f.websiteOffline !== true ||
      f.bereich === "website" ||
      f.bereich === "alles",
  );

type Env = { Variables: { person: Person; sitzungId: string } };

// Für den Push an die Entwickler; nur der Bereich, nie der Hinweis
const BEREICH_NAMEN: Record<SchalterBereich, string> = {
  website: "Website",
  lager: "Lager",
  chat: "Chat",
  programme: "Programme und Termine",
  verwaltung: "Verwaltung",
  alles: "Alles",
};

const alsAntwort = (s: Schalter) => ({
  art: s.art,
  bereich: s.bereich,
  hinweis: s.hinweis,
  ende: s.ende?.toISOString() ?? null,
  websiteOffline: s.websiteOffline,
  ausgeloestVon: s.ausgeloestVon,
  ausgeloestAm: s.ausgeloestAm.toISOString(),
});

export function erstellePlattformRouten({
  db,
  zustand,
  fcm,
  website,
}: {
  db: Db;
  zustand: SchalterZustand;
  fcm?: Fcm;
  // Die Ausgabe der öffentlichen Website (server.ts), ausgeschrieben statt aus website/sperre.ts importiert: Schon ein Typ-Import zöge node:fs in dieses Programm. Ohne sie (keine Website eingerichtet) gibt es nichts vom Netz zu nehmen
  website?: {
    abteilungId: string;
    nimmVomNetz: () => Promise<void>;
    gibFrei: () => Promise<void>;
  };
}) {
  // Darf diese Person genau diesen Schalter schalten? Das Recht dazu steht im Katalog: die Sperre «plattform.sperren» (Abteilungsleitung und Entwickler), jede Wartung nur für den Entwickler
  async function darf(person: Person, art: SchalterArt, bereich: string) {
    const recht =
      art === "sperre"
        ? "plattform.sperren"
        : bereich === "website"
          ? "wartungsmodus.website"
          : "wartung.bereiche";
    return darfRecht(db, person, recht);
  }

  // Vor jeder Prüfung des Inhalts: Wer gar nichts schalten darf, erfährt nichts über Eingabe oder Zustand; der zweite Faktor gilt für jede Route hier
  const berechtigt = createMiddleware<Env>(async (c, next) => {
    const person = c.get("person");
    // Wer die Sperre darf, liest auch den Stand der Wartung; wer nur die Wartung darf (Entwickler), hat auch die Sperre
    if (
      !(await darfEines(db, person, ["wartung.bereiche", "plattform.sperren"]))
    ) {
      throw new HTTPException(403);
    }
    if (!person.zweiterFaktor) {
      return c.json(
        zweiterFaktorFehlt(
          "Für diese Schaltung braucht es den zweiten Faktor.",
          person,
        ),
        403,
      );
    }
    await next();
  });

  // Der Website einer Abteilung wieder freigeben, wenn keine Sperre sie mehr vom Netz hält; der Abgleich schreibt sie danach neu
  async function gibWebsiteFrei(abteilungId: string) {
    if (!website || website.abteilungId !== abteilungId) return;
    if (zustand.websiteOffline(abteilungId)) return;
    try {
      await website.gibFrei();
    } catch (fehler) {
      log(undefined, {
        ereignis: "sperre",
        art: "frei",
        name: (fehler as Error)?.name,
      });
    }
    meldeWebsiteEreignis({ art: "seite_geaendert", abteilungId });
  }

  return new Hono<Env>()
    .get("/schalter", berechtigt, async (c) => {
      const person = c.get("person");
      const darfSperre = await darf(person, "sperre", "alles");
      const darfWartung = await darf(person, "wartung", "alles");
      // Aus dem Speicher, ohne Datenbank; jede Person hier liest die Wartung, die Sperre nur, wer sie schalten darf
      const sichtbar = zustand
        .vonAbteilung(person.abteilungId)
        .filter((s) => s.art === "wartung" || darfSperre);
      return c.json({
        schalter: sichtbar.map(alsAntwort),
        // Die Zeilen der Seite: jeder Bereich, sobald die Person eine der beiden Arten schalten darf
        bereiche: darfSperre || darfWartung ? [...BEREICHE] : [],
        darfSperre,
        // Nur der Entwickler: alle anderen sehen die Wartung lesend
        darfWartung,
        // Ob es eine Website gibt, die sich vom Netz nehmen lässt
        websiteVorhanden: website?.abteilungId === person.abteilungId,
      });
    })
    .put("/schalter", berechtigt, eingabe("json", setzenSchema), async (c) => {
      const person = c.get("person");
      const { art, bereich, ...eingang } = c.req.valid("json");
      if (!(await darf(person, art, bereich))) {
        throw new HTTPException(403);
      }
      const ende = eingang.ende ? new Date(eingang.ende) : null;
      const websiteOffline =
        art === "sperre" && eingang.websiteOffline === true;
      const { zeile, vorher } = await db.transaction(async (tx) => {
        const [vorher] = await tx
          .select({
            id: bereichsschalter.id,
            websiteOffline: bereichsschalter.websiteOffline,
          })
          .from(bereichsschalter)
          .where(
            and(
              eq(bereichsschalter.abteilungId, person.abteilungId),
              eq(bereichsschalter.bereich, bereich),
              eq(bereichsschalter.art, art),
            ),
          );
        const werte = {
          hinweis: eingang.hinweis ?? null,
          ende,
          websiteOffline,
          ausgeloestVon: person.id,
          ausgeloestAm: new Date(),
        };
        const [neu] = await tx
          .insert(bereichsschalter)
          .values({ abteilungId: person.abteilungId, bereich, art, ...werte })
          .onConflictDoUpdate({
            target: [
              bereichsschalter.abteilungId,
              bereichsschalter.bereich,
              bereichsschalter.art,
            ],
            set: werte,
          })
          .returning();
        // Ohne Hinweistext: Art, Bereich, Ende und was auf Wunsch dazukam
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: vorher ? "schalter_geaendert" : "schalter_gesetzt",
          zielTyp: "bereichsschalter",
          zielId: neu.id,
          details: {
            art,
            bereich,
            ende: ende?.toISOString() ?? null,
            ...(art === "sperre" && {
              sitzungenBeenden: eingang.sitzungenBeenden === true,
              websiteOffline,
            }),
          },
        });
        return { zeile: neu as Schalter, vorher };
      });
      // Erst nach dem Commit: Eine zurückgerollte Schaltung gilt nie. Die Sperre wirkt ab jetzt
      zustand.setze(zeile);

      let sitzungenBeendet: number | null = null;
      let websiteVomNetz = false;
      if (art === "sperre") {
        // Auf Wunsch alle Sitzungen der Abteilung, ausser der eigenen: Wer sperrt, muss die Sperre wieder aufheben können
        if (eingang.sitzungenBeenden === true) {
          sitzungenBeendet = await beendeSitzungen(db, {
            abteilungId: person.abteilungId,
            ausser: c.get("sitzungId"),
          });
        }
        if (websiteOffline && website?.abteilungId === person.abteilungId) {
          try {
            await website.nimmVomNetz();
            websiteVomNetz = true;
          } catch (fehler) {
            // Die Sperre gilt trotzdem; die Antwort sagt, dass die Website noch online sein kann
            log(c, {
              ereignis: "sperre",
              art: "offline",
              name: (fehler as Error)?.name,
            });
          }
        } else if (!websiteOffline && vorher?.websiteOffline) {
          await gibWebsiteFrei(person.abteilungId);
        }
        // Push an die anderen Entwickler der Abteilung, nur bei der Auslösung; ein Fehler hier macht die Sperre nicht rückgängig
        if (!vorher) {
          try {
            const empfaenger = await db
              .select({ id: user.id })
              .from(plattformEntwickler)
              .innerJoin(user, eq(user.id, plattformEntwickler.userId))
              .where(
                and(
                  eq(user.abteilungId, person.abteilungId),
                  ne(user.id, person.id),
                ),
              );
            if (empfaenger.length > 0) {
              await sendePush(
                { db, fcm, c },
                empfaenger.map((e) => e.id),
                {
                  typ: "plattform",
                  id: zeile.id,
                  titel: "Informationssperre ausgelöst",
                  text: `Bereich: ${BEREICH_NAMEN[bereich]}`,
                },
              );
            }
          } catch (fehler) {
            log(c, {
              ereignis: "push",
              code: (fehler as { code?: unknown }).code as string,
            });
          }
        }
      }
      return c.json({
        ...alsAntwort(zeile),
        ...(art === "sperre" && { sitzungenBeendet, websiteVomNetz }),
      });
    })
    .delete(
      "/schalter",
      berechtigt,
      eingabe("query", loeschenSchema),
      async (c) => {
        const person = c.get("person");
        const { art, bereich } = c.req.valid("query");
        if (!(await darf(person, art, bereich))) {
          throw new HTTPException(403);
        }
        const geloescht = await db.transaction(async (tx) => {
          const [zeile] = await tx
            .delete(bereichsschalter)
            .where(
              and(
                eq(bereichsschalter.abteilungId, person.abteilungId),
                eq(bereichsschalter.bereich, bereich),
                eq(bereichsschalter.art, art),
              ),
            )
            .returning({
              id: bereichsschalter.id,
              websiteOffline: bereichsschalter.websiteOffline,
            });
          if (!zeile) return null;
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "schalter_aufgehoben",
            zielTyp: "bereichsschalter",
            zielId: zeile.id,
            details: { art, bereich },
          });
          return zeile;
        });
        if (!geloescht) throw new HTTPException(404);
        // Wirkt sofort: die nächste Anfrage sieht den Bereich wieder frei
        zustand.hebeAuf(person.abteilungId, bereich, art);
        if (geloescht.websiteOffline) await gibWebsiteFrei(person.abteilungId);
        return c.body(null, 204);
      },
    );
}
