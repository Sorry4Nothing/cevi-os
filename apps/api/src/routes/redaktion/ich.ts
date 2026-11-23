import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { plattformRechteVon } from "../../plattform.js";
import type { Person } from "../../rechte.js";
import { termineZugang } from "../../termine/rechte.js";
import { hatWebsiteZugang } from "../../website/seiten.js";

// Was das Panel zeigt: nur lesen, nie schreiben. Das Panel blendet danach Bereiche und Knöpfe ein oder aus; erlaubt ist, was jede Route selbst prüft.
// Antwortet jeder Person mit Sitzung (ohne Zugang mit «redigieren: false»), damit «kein Zugang» keine Fehlerseite braucht
export function erstelleEditorIchRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    const redigieren = await hatWebsiteZugang(db, person);
    // Die Plattformrechte der Person (Abteilungsleitung: alle; eine gebündelte Abfrage, die die Routen später nicht noch einmal stellen). Die Stufenleitung und die Zeilen in «bearbeiter» stehen nicht darin: Sie gelten je Seite
    const rechte = [...(await plattformRechteVon(db, person))].sort();
    // Termine, Anlässe und Räume nach den Rechten des Katalogs (#649): nur Anzeige, jede Route prüft selbst
    const termine = await termineZugang(db, person);
    return c.json({
      redigieren,
      // «plattform»: wer den Wartungsmodus der Website schalten darf (#424), auch ohne Zugang zur Website-Verwaltung
      bereiche: [
        ...(redigieren ? ["website"] : []),
        ...(rechte.includes("wartungsmodus.website") ? ["plattform"] : []),
      ],
      // Seiten anlegen und löschen: das Recht «seiten.anlegen_loeschen»; bleibt für Panels, die nur dieses eine Feld kennen
      verwalten: rechte.includes("seiten.anlegen_loeschen"),
      // Belegungsplan der Räume (#628): wer das Recht «Belegung der Räume sehen» für mindestens einen Raum hat; öffnet die Verwaltung auch ohne Zugang zur Website
      belegung: termine.raumBelegung,
      // Was die Verwaltung bei Termine, Räumen und Anlässen einblendet; jedes Feld heisst: das Recht gilt für mindestens ein Objekt
      termine,
      rechte,
    });
  });
}
