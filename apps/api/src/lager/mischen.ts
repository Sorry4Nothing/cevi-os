// Die Verteilung beim «Gemischt einteilen» (#387): rein, ohne Datenbank, damit gleiche Eingabe und gleicher Startwert immer dieselbe Einteilung geben (Test) und Vorschau und Übernehmen übereinstimmen.

export const MISCHEN_MIN_GRUPPEN = 2;
export const MISCHEN_MAX_GRUPPEN = 20;
export const SEED_MAX = 4_294_967_295;

export type Mischling = { id: string; stufe: string | null };

// mulberry32: kleiner Zufallsgenerator mit 32-Bit-Startwert, nur für die Reihenfolge innerhalb einer Stufe (kein Geheimnis, nichts Sicherheitsrelevantes)
function zufall(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Gleiche Stufe: ohne Beachtung der Gross- und Kleinschreibung (wie der Filter der Listen); ohne Stufe bildet eine eigene Stufe am Schluss
const stufenSchluessel = (s: string | null) =>
  s === null ? null : s.normalize("NFC").toLowerCase();

// Sortiert nach Stufe, mischt innerhalb der Stufe nach dem Startwert und teilt reihum auf `anzahl` Gruppen auf. Der Zähler läuft über alle Stufen weiter: Die Gruppen unterscheiden sich in der Grösse um höchstens eins, und jede Stufe verteilt sich auf die Gruppen auch um höchstens eins. Liefert je Gruppe die IDs in der Reihenfolge der Verteilung
export function mische(
  personen: Mischling[],
  anzahl: number,
  seed: number,
): string[][] {
  const nachStufe = new Map<string | null, string[]>();
  // Erst nach ID ordnen: Die Eingabereihenfolge der Datenbank darf das Ergebnis nicht ändern
  for (const p of [...personen].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const k = stufenSchluessel(p.stufe);
    nachStufe.set(k, [...(nachStufe.get(k) ?? []), p.id]);
  }
  const stufen = [...nachStufe.keys()].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0,
  );
  const next = zufall(seed);
  const gruppen: string[][] = Array.from({ length: anzahl }, () => []);
  let i = 0;
  for (const k of stufen) {
    const ids = nachStufe.get(k)!;
    // Fisher-Yates
    for (let j = ids.length - 1; j > 0; j--) {
      const m = Math.floor(next() * (j + 1));
      [ids[j], ids[m]] = [ids[m]!, ids[j]!];
    }
    for (const id of ids) gruppen[i++ % anzahl]!.push(id);
  }
  return gruppen;
}
