import type { Db } from "../db/client.js";
import type { Person } from "../rechte.js";
import { darf } from "./darf.js";
import { RECHT_IDS, eintragVon } from "./katalog.js";

type Lesbar = Pick<Db, "select" | "execute">;

// Die Rechte der Person für die Anzeige der Verwaltung (#648): welche Seiten die Navigation zeigt, welche Knöpfe sie einblendet. Der Server bleibt Autorität: jede Route prüft selbst.
//   abteilungsweit  das Recht gilt für jedes Objekt der Abteilung (Geltung «alle»)
//   eigene          das Recht gilt nur für Objekte der eigenen Gruppen (Geltung «eigene»: zum Beispiel das OK des eigenen Anlasses); fehlt in abteilungsweit
// Beide Listen folgen dem, was darf() durchsetzt (Schattenbetrieb: der alte Weg und die Rollen; Modus «neu»: der Rechtesatz). Rechte, die jede Person hat (Art «struktur»), stehen nicht darin. Keine Namen und keine Daten Dritter. Höchstens je Recht zwei Prüfungen; der Rechtesatz wird einmal je Anfrage geladen
export async function rechteDerPerson(db: Lesbar, person: Person) {
  const abteilungsweit: string[] = [];
  const eigene: string[] = [];
  for (const recht of RECHT_IDS) {
    if (eintragVon(recht).art === "struktur") continue;
    if (
      await darf(db, person, recht, {
        abteilungId: person.abteilungId,
        abteilungsweit: true,
      })
    ) {
      abteilungsweit.push(recht);
    } else if (await darf(db, person, recht)) {
      eigene.push(recht);
    }
  }
  return {
    abteilungsweit: abteilungsweit.sort(),
    eigene: eigene.sort(),
  };
}
