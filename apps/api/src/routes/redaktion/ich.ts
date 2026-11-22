import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Person } from "../../rechte.js";
import {
  darfSeitenVerwalten,
  hatRedaktionszugang,
} from "../../website/seiten.js";

// Was das Panel zeigt: nur lesen, nie schreiben. Das Panel blendet danach Bereiche und Knöpfe ein oder aus; erlaubt ist, was jede Route selbst prüft.
// Antwortet jeder Person mit Sitzung (ohne Zugang mit «redigieren: false»), damit «kein Zugang» keine Fehlerseite braucht
export function erstelleRedaktionIchRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    const redigieren = await hatRedaktionszugang(db, person);
    return c.json({
      redigieren,
      bereiche: redigieren ? ["website"] : [],
      // Seiten anlegen und löschen, Medien löschen: Abteilungsleitung und Redaktion
      verwalten: redigieren && (await darfSeitenVerwalten(db, person)),
    });
  });
}
