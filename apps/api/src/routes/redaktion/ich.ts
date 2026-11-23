import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { plattformRechteVon } from "../../plattform.js";
import type { Person } from "../../rechte.js";
import { rechteDerPerson } from "../../rechtemodell/ich.js";
import { darfBelegungSehen } from "../../termine/raum.js";
import { hatWebsiteZugang } from "../../website/seiten.js";

// Welche Bereiche der Verwaltung ein Katalogrecht öffnet (#648): Die Navigation zeigt einen Bereich, sobald die Person eines davon abteilungsweit hat; welche Seite darin, entscheidet das einzelne Recht (Navigation `zugang: "recht:<name>"`)
const BEREICH_NACH_RECHT: Record<string, readonly string[]> = {
  // Wartung der Website (#424) und der übrigen Bereiche (#648)
  plattform: ["wartungsmodus.website", "wartung.bereiche"],
  laedeli: [
    "laden.ansehen",
    "laden.artikel_pflegen",
    "laden.bestellungen_bearbeiten",
    "laden.einstellungen",
  ],
  lager: ["lager.verwalten", "lager.vorlagen_pflegen"],
  system: ["system.lesen", "zeitregeln.verwalten"],
};

// Was das Panel zeigt: nur lesen, nie schreiben. Das Panel blendet danach Bereiche und Knöpfe ein oder aus; erlaubt ist, was jede Route selbst prüft.
// Antwortet jeder Person mit Sitzung (ohne Zugang mit «redigieren: false»), damit «kein Zugang» keine Fehlerseite braucht
export function erstelleEditorIchRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    const redigieren = await hatWebsiteZugang(db, person);
    // Die Plattformrechte der Person (Abteilungsleitung: alle; eine gebündelte Abfrage, die die Routen später nicht noch einmal stellen). Die Stufenleitung und die Zeilen in «bearbeiter» stehen nicht darin: Sie gelten je Seite
    const rechte = [...(await plattformRechteVon(db, person))].sort();
    // Alle Katalogrechte der Person, die darf() durchsetzt: abteilungsweit und nur für die eigenen Gruppen (#648)
    const katalog = await rechteDerPerson(db, person);
    const hat = (namen: readonly string[]) =>
      namen.some((n) => katalog.abteilungsweit.includes(n));
    return c.json({
      redigieren,
      // «plattform»: wer die Wartung schalten darf (#424, #648), auch ohne Zugang zur Website-Verwaltung; «laedeli», «lager» und «system»: wer dort ein Recht hat (#648)
      bereiche: [
        ...(redigieren ? ["website"] : []),
        ...Object.entries(BEREICH_NACH_RECHT)
          .filter(([, namen]) => hat(namen))
          .map(([bereich]) => bereich),
      ],
      // Seiten anlegen und löschen: das Recht «seiten.anlegen_loeschen»; bleibt für Panels, die nur dieses eine Feld kennen
      verwalten: rechte.includes("seiten.anlegen_loeschen"),
      // Belegungsplan der Räume (#628): jede Leitung; öffnet die Verwaltung auch ohne Zugang zur Website
      belegung: await darfBelegungSehen(db, person),
      rechte,
      katalogRechte: katalog.abteilungsweit,
      katalogRechteEigene: katalog.eigene,
    });
  });
}
