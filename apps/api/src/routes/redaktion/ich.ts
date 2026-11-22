import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { plattformRechteVon } from "../../plattform.js";
import type { Person } from "../../rechte.js";
import { hatWebsiteZugang } from "../../website/seiten.js";

// Was das Panel zeigt: nur lesen, nie schreiben. Das Panel blendet danach Bereiche und Knöpfe ein oder aus; erlaubt ist, was jede Route selbst prüft.
// Antwortet jeder Person mit Sitzung (ohne Zugang mit «redigieren: false»), damit «kein Zugang» keine Fehlerseite braucht
export function erstelleEditorIchRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    const redigieren = await hatWebsiteZugang(db, person);
    // Die Plattformrechte der Person (Abteilungsleitung: alle; eine Abfrage, die später die Routen nicht noch einmal stellen). Die Stufenleitung und die Zeilen in «bearbeiter» stehen nicht darin: Sie gelten je Seite
    const rechte = redigieren
      ? [...(await plattformRechteVon(db, person))].sort()
      : [];
    return c.json({
      redigieren,
      bereiche: redigieren ? ["website"] : [],
      // Seiten anlegen und löschen: das Recht «seiten.anlegen_loeschen»; bleibt für Panels, die nur dieses eine Feld kennen
      verwalten: rechte.includes("seiten.anlegen_loeschen"),
      rechte,
    });
  });
}
