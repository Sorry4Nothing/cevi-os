import type { TerminKategorien } from "../outlook/graph.js";
import { bereinigeKategorien } from "./kategorien.js";
import type { ProgrammAusKalender } from "./abgleich.js";

// Mit der Graph-Anbindung (#835) kommen die Kategorien der Termine von Outlook selbst: Der iCal-Feed enthält sie nicht zuverlässig (auf dem Live-Server null Zeilen CATEGORIES bei 66 Terminen). Der Feed bleibt die Quelle für Titel, Zeit und Ort.
// Zuordnung: ein einzelner Termin über seine UID; ein Termin einer Serie über die UID der Serie und seinen Beginn (bei ganztägigen das Datum). Ein Termin ohne Treffer bekommt null: «unbekannt», nie «leer», damit er seine bisherigen Kategorien und Tags behält.
export type MitKategorienOderNull = Omit<ProgrammAusKalender, "kategorien"> & {
  kategorien: string[] | null;
};

const startSchluessel = (ganztaegig: boolean, start: string) =>
  ganztaegig
    ? start.slice(0, 10)
    : String(Date.parse(`${start.slice(0, 19)}Z`));

export function ordneKategorienZu(
  programme: ProgrammAusKalender[],
  graph: TerminKategorien[],
): MitKategorienOderNull[] {
  const karte = new Map<string, string[]>();
  for (const e of graph) {
    const schluessel = e.serie
      ? `s|${e.iCalUId}|${startSchluessel(e.ganztaegig, e.start)}`
      : `e|${e.iCalUId}`;
    if (!karte.has(schluessel)) karte.set(schluessel, e.kategorien);
  }
  return programme.map((p) => {
    const schluessel =
      p.googleSerie === null
        ? `e|${p.googleEventId}`
        : `s|${p.googleSerie}|${
            p.ganztaegig ? p.tagVon : String(p.beginn?.getTime())
          }`;
    const roh = karte.get(schluessel);
    return {
      ...p,
      kategorien: roh === undefined ? null : bereinigeKategorien(roh),
    };
  });
}
