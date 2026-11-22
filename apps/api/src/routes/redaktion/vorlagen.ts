import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { hatPlattformRecht } from "../../plattform.js";
import type { Person } from "../../rechte.js";
import {
  sichtbarkeitSchema,
  tagsGehoerenZurAbteilung,
} from "../../sichtbarkeit.js";
import {
  erzeugeSeiteAusVorlage,
  VorlagenFehler,
} from "../../website/automatik.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import { VORLAGEN_SCHLUESSEL, vorlagenInfos } from "../../website/vorlagen.js";

// Eigene Route statt zusätzlicher Felder an POST /seiten: Die Adresse fehlt hier (sie kommt aus dem Titel), die Antwort nennt sie
const erzeugenSchema = z.strictObject({
  vorlage: z.enum(VORLAGEN_SCHLUESSEL),
  titel: z.string().trim().min(1).max(150),
  elternId: z.uuid().nullable().optional(),
  tagId: z.uuid().nullable().optional(),
  sichtbarkeit: sichtbarkeitSchema,
});

const FEHLER = {
  TAG_ERFORDERLICH: [
    400,
    {
      code: "TAG_ERFORDERLICH",
      message: "Diese Vorlage braucht eine Gruppe (tagId).",
    },
  ],
  SEITE_ZU_TIEF: [
    400,
    {
      code: "SEITE_ZU_TIEF",
      message: "Der Baum darf nicht so tief werden.",
    },
  ],
} as const;

export function erstelleVorlagenRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .get("/vorlagen", async (c) => {
      // Name und Beschreibung, nie die Dokumente
      if (!(await hatPlattformRecht(db, c.get("person"), "vorlagen.nutzen"))) {
        throw new HTTPException(403);
      }
      return c.json({ vorlagen: vorlagenInfos() });
    })
    .post("/seiten/aus-vorlage", eingabe("json", erzeugenSchema), async (c) => {
      const person = c.get("person");
      const felder = c.req.valid("json");
      // Eine Vorlage nutzen und wie POST /seiten anlegen dürfen
      if (
        !(await hatPlattformRecht(db, person, "vorlagen.nutzen")) ||
        !(await hatPlattformRecht(db, person, "seiten.anlegen_loeschen"))
      ) {
        throw new HTTPException(403);
      }
      if (
        felder.sichtbarkeit.art === "tags" &&
        !(await tagsGehoerenZurAbteilung(
          db,
          person.abteilungId,
          felder.sichtbarkeit.tagIds,
        ))
      ) {
        throw new HTTPException(400);
      }
      try {
        const neu = await db.transaction((tx) =>
          erzeugeSeiteAusVorlage(tx, {
            ...felder,
            abteilungId: person.abteilungId,
            autorId: person.id,
          }),
        );
        // Zu dieser Gruppe gibt es schon eine Seite (wie POST /seiten)
        if (!neu.neu) {
          return c.json(
            {
              code: "TAG_VERGEBEN",
              message: "Für diese Gruppe gibt es schon eine Seite.",
            },
            409,
          );
        }
        meldeWebsiteEreignis({
          art: "seite_geaendert",
          abteilungId: person.abteilungId,
          seiteId: neu.id,
        });
        return c.json({ id: neu.id, adresse: neu.adresse }, 201);
      } catch (fehler) {
        if (fehler instanceof VorlagenFehler) {
          // Fremde und unbekannte IDs sind gleich: 404
          if (
            fehler.code === "TAG_UNBEKANNT" ||
            fehler.code === "ELTERN_UNBEKANNT"
          ) {
            throw new HTTPException(404);
          }
          const [status, antwort] = FEHLER[fehler.code];
          return c.json(antwort, status);
        }
        throw fehler;
      }
    });
}
