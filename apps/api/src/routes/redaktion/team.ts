import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { profilbild, tag, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import {
  anzeigename,
  aufWebsite,
  funktionsname,
  stufenteamZeilen,
  teamZeilen,
} from "../../website/personen.js";
import { hatWebsiteZugang } from "../../website/seiten.js";

// Bilder und Teams für die Personenwahl im Editor (#760). Beides zeigt nur, was die Website ohnehin zeigt: Personen mit Rolle mit Aussenwirkung und aktivem Konto samt Profilbild, und die Teams der Bausteine «leitungsteam». Keine Telefonnummer, keine E-Mail, nie ein Kind.
// So viele Personen zeigt die Vorschau eines Teams höchstens (die Website zeigt alle)
const TEAM_MAX = 200;

const bildPfad = (userId: string, stand: Date | string) =>
  `/api/v1/redaktion/personen/${userId}/bild?v=${new Date(stand).getTime()}`;

export function erstelleTeamRouten({ db }: { db: Db }) {
  const zugang = async (person: Person) => {
    if (!(await hatWebsiteZugang(db, person))) throw new HTTPException(403);
  };

  return (
    new Hono<{ Variables: { person: Person } }>()
      // Das Bild einer Person. Nur wer auf der Website erscheinen darf; für alle anderen (Kinder, Eltern, andere Abteilungen, ohne Bild) dasselbe 404. Wer die Redaktion nicht öffnen darf, bekommt für ein vorhandenes Bild 403
      .get(
        "/personen/:id/bild",
        eingabe("param", z.strictObject({ id: z.uuid() })),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          // Ein Bild gehört nie in einen Cache; nosniff, damit kein Client die Bytes als etwas anderes liest
          c.header("Cache-Control", "private, no-store");
          c.header("X-Content-Type-Options", "nosniff");
          const [zeile] = await db
            .select({ inhalt: profilbild.inhalt })
            .from(profilbild)
            .innerJoin(user, eq(user.id, profilbild.userId))
            .where(
              and(
                eq(profilbild.userId, id),
                eq(user.abteilungId, person.abteilungId),
                aufWebsite,
              ),
            );
          // Zuerst das Objekt der eigenen Abteilung (404), dann das Recht (403): wie die übrigen Routen mit Kennung, damit eine andere Abteilung nie ein 403 für ein Objekt sieht, das sie nicht kennt
          if (!zeile) throw new HTTPException(404);
          await zugang(person);
          return c.body(zeile.inhalt as Uint8Array<ArrayBuffer>, 200, {
            "Content-Type": "image/jpeg",
          });
        },
      )
      // Wer bei einem Baustein «leitungsteam» erscheint, in der Reihenfolge der Website. Eine Stufe zeigt Stufenleitung und Leitung mit Bild; jedes andere Team seine Mitglieder mit Cevi-Name und Rolle ohne Bild (wie rendern.ts); die Gruppe eines Anlasses nie
      .get(
        "/leitungsteam",
        eingabe("query", z.strictObject({ tag: z.uuid() })),
        async (c) => {
          const person = c.get("person");
          await zugang(person);
          const { tag: tagId } = c.req.valid("query");
          const [ziel] = await db
            .select({ name: tag.name, typ: tag.typ })
            .from(tag)
            .where(
              and(eq(tag.id, tagId), eq(tag.abteilungId, person.abteilungId)),
            );
          if (!ziel) throw new HTTPException(404);
          const stufe = ziel.typ === "stufe";
          let personen: {
            id: string;
            anzeigename: string;
            funktion: string | null;
            bildUrl: string | null;
          }[] = [];
          if (stufe) {
            const zeilen = await stufenteamZeilen(
              db,
              person.abteilungId,
              [tagId],
              false,
            ).limit(TEAM_MAX);
            for (const z of zeilen) {
              const name = anzeigename(z.ceviName, z.name);
              if (name === "") continue;
              personen.push({
                id: z.userId,
                anzeigename: name,
                funktion: funktionsname(z.rolle),
                bildUrl: z.bildStand ? bildPfad(z.userId, z.bildStand) : null,
              });
            }
          } else if (ziel.typ !== "anlass") {
            const zeilen = await teamZeilen(db, person.abteilungId, [
              tagId,
            ]).limit(TEAM_MAX);
            personen = zeilen.map((z) => ({
              id: z.userId,
              anzeigename: z.name!,
              funktion: z.funktion,
              bildUrl: null,
            }));
          }
          return c.json({ gruppe: ziel.name, stufe, personen });
        },
      )
  );
}
