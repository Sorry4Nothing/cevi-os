import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { lager, lagerDatei } from "../db/schema.js";
import { dateiVerweisTabellen } from "./datei-verweise.js";
import type { LagerStatus } from "./rechte-katalog.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Endgültiges Löschen eines Lagers (#400). Nur ein Entwurf, ein archiviertes Lager oder ein Übungslager lässt sich löschen: Ein aktives oder abgeschlossenes Lager nie
export const loeschbar = (l: { status: LagerStatus; uebung: boolean }) =>
  l.uebung || l.status === "entwurf" || l.status === "archiviert";

// Dateien liegen im SharePoint (lager_datei speichert nur den Link), das Lager löscht darum nur Zeilen. Der Medienspeicher (S3) hält für ein Lager nichts ausser dem Logo, und das gehört der Abteilung (lager.logo_medium_id, ein Bild der Mediathek): Es bleibt
// Reihenfolge: erst die Zeilen, die lager_datei einbinden (Fremdschlüssel RESTRICT hielte die Kaskade sonst auf, je nach Reihenfolge der Auslöser), dann die Dateien, dann das Lager; alles Übrige geht per ON DELETE CASCADE vom Lager (der Test findet jede Tabelle mit lager_id ohne Kaskade). Aufrufen in der Transaktion, die das Lager gesperrt hält. Liefert die Zahl der entfernten Datei-Einträge für das Audit-Log
export async function loescheLager(tx: Tx, lagerId: string) {
  for (const tabelle of dateiVerweisTabellen()) {
    await tx.delete(tabelle).where(eq(tabelle.lagerId, lagerId));
  }
  const dateien = await tx
    .delete(lagerDatei)
    .where(eq(lagerDatei.lagerId, lagerId))
    .returning({ id: lagerDatei.id });
  await tx.delete(lager).where(eq(lager.id, lagerId));
  return dateien.length;
}
