import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  BILD_MAX_BYTES,
  istErlaubtesBild,
  type BildKodierer,
} from "../bild.js";
import type { Db } from "../db/client.js";
import { stufe, stufenlogo } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import type { Person } from "../rechte.js";

const pfadSchema = z.strictObject({ id: z.uuid() });
const BILD_FORMAT = {
  code: "BILD_FORMAT",
  message: "Bitte ein Bild als JPEG, PNG oder WebP senden.",
};

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType; sharp kommt darum als Parameter
export function erstelleStufenlogoRouten({
  db,
  kodiereLogo,
}: {
  db: Db;
  kodiereLogo?: BildKodierer;
}) {
  // In SQL auf die Abteilung gefiltert: fremde wie unbekannte IDs sind 404
  async function eigeneStufe(person: Person, id: string) {
    const [ziel] = await db
      .select({ id: stufe.id })
      .from(stufe)
      .where(and(eq(stufe.id, id), eq(stufe.abteilungId, person.abteilungId)));
    if (!ziel) throw new HTTPException(404);
  }

  return (
    new Hono<{ Variables: { person: Person } }>()
      // Der Body ist das Bild selbst; die Grösse begrenzt bodyLimit vor dem Einlesen, der Typ ergibt sich aus den Bytes. Das Ergebnis ersetzt ein vorhandenes Logo
      .put(
        "/admin/stufen/:id/logo",
        eingabe("param", pfadSchema),
        bodyLimit({ maxSize: BILD_MAX_BYTES }),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          await eigeneStufe(person, id);
          if (!person.admin) throw new HTTPException(403);
          if (!kodiereLogo) throw new HTTPException(501);
          const daten = new Uint8Array(await c.req.arrayBuffer());
          if (!istErlaubtesBild(daten)) return c.json(BILD_FORMAT, 415);
          let inhalt: Uint8Array;
          try {
            inhalt = await kodiereLogo(daten);
          } catch {
            // Kein lesbares Bild oder zu viele Pixel
            return c.json(BILD_FORMAT, 415);
          }
          await db
            .insert(stufenlogo)
            .values({ stufeId: id, inhalt })
            .onConflictDoUpdate({
              target: stufenlogo.stufeId,
              set: { inhalt, geaendertAm: new Date() },
            });
          return c.body(null, 204);
        },
      )
      // Ohne Logo ebenfalls 204: Das Ziel ist erreicht
      .delete(
        "/admin/stufen/:id/logo",
        eingabe("param", pfadSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          await eigeneStufe(person, id);
          if (!person.admin) throw new HTTPException(403);
          await db.delete(stufenlogo).where(eq(stufenlogo.stufeId, id));
          return c.body(null, 204);
        },
      )
      // Alle mit Sitzung, wie die Liste der Stufen: Ein Logo trägt keine Personendaten
      .get("/stufen/:id/logo", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        c.header("X-Content-Type-Options", "nosniff");
        const [zeile] = await db
          .select({ inhalt: stufenlogo.inhalt })
          .from(stufenlogo)
          .innerJoin(stufe, eq(stufe.id, stufenlogo.stufeId))
          .where(
            and(eq(stufe.id, id), eq(stufe.abteilungId, person.abteilungId)),
          );
        if (!zeile) throw new HTTPException(404);
        // ?v= in logoUrl wechselt mit jedem neuen Logo, darum darf die Antwort lange im Speicher bleiben; nur privat, hinter der Sitzung
        c.header("Cache-Control", "private, max-age=86400");
        return c.body(zeile.inhalt as Uint8Array<ArrayBuffer>, 200, {
          "Content-Type": "image/webp",
        });
      })
  );
}
