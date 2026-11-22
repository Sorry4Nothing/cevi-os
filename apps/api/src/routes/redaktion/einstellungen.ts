import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { abteilung, auditLog, medium } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { hatPlattformRecht, istEntwickler } from "../../plattform.js";
import type { Person } from "../../rechte.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";

export const MAX_ABTEILUNGSNAME = 100;
// Steuerzeichen gehören in keinen Namen (auch NUL, das Postgres nicht speichert)
const sauber = (s: string) => !/\p{Cc}/u.test(s);

// Kopf der Website (#550): der Anzeigename ist der Name der Abteilung, das Logo ein öffentliches Bild der Medienbibliothek (null = kein Logo). Für den dunklen Modus gibt es eine zweite Fassung (#558, null = dasselbe Logo)
const aendernSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_ABTEILUNGSNAME).refine(sauber),
    logoMediumId: z.uuid().nullable(),
    logoDunkelMediumId: z.uuid().nullable(),
  })
  .partial()
  .refine((f) => Object.keys(f).length > 0);

const FEHLER = {
  MEDIUM_UNBEKANNT: "Das gewählte Bild gibt es nicht mehr. Wähle ein anderes.",
  MEDIUM_FORMAT: "Das Logo muss ein Bild sein.",
  MEDIUM_NICHT_OEFFENTLICH:
    "Das Logo erscheint im Kopf jeder Seite und muss ein öffentliches Bild sein.",
} as const;

// Einstellungen der Website für die ganze Abteilung. Das Recht «Seiten veröffentlichen» genügt für das Logo; den Namen der Abteilung ändert nur der Entwickler (auch nicht die Abteilungsleitung), denn er steht auch in der App
export function erstelleWebsiteEinstellungsRouten({ db }: { db: Db }) {
  const pruefeRecht = async (person: Person) => {
    if (!(await hatPlattformRecht(db, person, "seiten.veroeffentlichen"))) {
      throw new HTTPException(403);
    }
  };
  const lese = async (person: Person) => {
    const [z] = await db
      .select({
        name: abteilung.name,
        logoMediumId: abteilung.websiteLogoMediumId,
        logoDunkelMediumId: abteilung.websiteLogoDunkelMediumId,
      })
      .from(abteilung)
      .where(eq(abteilung.id, person.abteilungId));
    if (!z) throw new HTTPException(404);
    return { ...z, nameAenderbar: await istEntwickler(db, person) };
  };

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      await pruefeRecht(person);
      return c.json(await lese(person));
    })
    .patch("/", eingabe("json", aendernSchema), async (c) => {
      const person = c.get("person");
      await pruefeRecht(person);
      const f = c.req.valid("json");
      if (f.name !== undefined && !(await istEntwickler(db, person))) {
        throw new HTTPException(403);
      }

      const fehler = await db.transaction(async (tx) => {
        for (const mediumId of [f.logoMediumId, f.logoDunkelMediumId]) {
          if (!mediumId) continue;
          // FOR SHARE: Ein gleichzeitiges Löschen des Mediums wartet und sieht danach den Verweis
          const [m] = await tx
            .select({
              mimeTyp: medium.mimeTyp,
              sichtbarkeit: medium.sichtbarkeit,
            })
            .from(medium)
            .where(
              and(
                eq(medium.id, mediumId),
                eq(medium.abteilungId, person.abteilungId),
              ),
            )
            .for("share");
          // Fremde und unbekannte IDs sind dasselbe
          if (!m) return "MEDIUM_UNBEKANNT";
          if (!m.mimeTyp.startsWith("image/")) return "MEDIUM_FORMAT";
          if (m.sichtbarkeit !== "oeffentlich")
            return "MEDIUM_NICHT_OEFFENTLICH";
        }
        await tx
          .update(abteilung)
          .set({
            ...(f.name !== undefined && { name: f.name }),
            ...(f.logoMediumId !== undefined && {
              websiteLogoMediumId: f.logoMediumId,
            }),
            ...(f.logoDunkelMediumId !== undefined && {
              websiteLogoDunkelMediumId: f.logoDunkelMediumId,
            }),
          })
          .where(eq(abteilung.id, person.abteilungId));
        // Nur Feldnamen, nie Werte
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "website_einstellungen_geaendert",
          zielTyp: "abteilung",
          zielId: person.abteilungId,
          details: { felder: Object.keys(f) },
        });
        return null;
      });
      if (fehler) {
        return c.json({ code: fehler, message: FEHLER[fehler] }, 422);
      }
      // Alle Seiten tragen den Kopf: Der Abgleich schreibt sie neu
      meldeWebsiteEreignis({
        art: "einstellungen_geaendert",
        abteilungId: person.abteilungId,
      });
      return c.json(await lese(person));
    });
}
