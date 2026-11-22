import { log } from "../log.js";

// Schnittstelle zwischen der Seitenverwaltung und der Auslieferung (#351): Wer Seiten ändert, meldet es hier, wer ausliefert, hört zu.
// Gemeldet wird nach dem Schreiben (nach dem Commit), nie mit Inhalt: Der Hörer liest den Stand aus der Datenbank.
// «seite_geaendert» und «seite_geloescht» meldet #348; «version_veroeffentlicht» und «version_zurueckgezogen» melden die Routen von #350.
export type WebsiteEreignis = {
  art:
    | "seite_geaendert"
    | "version_veroeffentlicht"
    | "version_zurueckgezogen"
    | "seite_geloescht";
  abteilungId: string;
  seiteId: string;
};
type Hoerer = (ereignis: WebsiteEreignis) => void | Promise<void>;

// shortcut: Hörer leben nur in diesem Prozess, bei mehreren Instanzen kennt jede nur ihre eigenen Ereignisse; dann auf einen Abgleich aus der Datenbank (#351) umstellen
const hoerer = new Set<Hoerer>();

// Gibt eine Funktion zurück, die den Hörer wieder abmeldet
export function aufWebsiteEreignis(h: Hoerer): () => void {
  hoerer.add(h);
  return () => void hoerer.delete(h);
}

// Ein Fehler im Hörer bricht die Anfrage nie ab; er erscheint nur im Log (Name, keine Meldung)
export function meldeWebsiteEreignis(ereignis: WebsiteEreignis) {
  const fehlgeschlagen = (fehler: unknown) =>
    log(undefined, {
      ereignis: "website_hoerer_fehler",
      art: ereignis.art,
      name: (fehler as Error)?.name,
    });
  for (const h of [...hoerer]) {
    try {
      Promise.resolve(h(ereignis)).catch(fehlgeschlagen);
    } catch (fehler) {
      fehlgeschlagen(fehler);
    }
  }
}
