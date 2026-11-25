// Reine Regeln für Kategorien in Outlook (#835): Namen, Farben, und welche Kategorien ein Termin tragen soll. Ohne Netz und Datenbank, darum einzeln testbar.

// Outlook trennt Kategorien mit Komma, und ein Name hat höchstens 255 Zeichen (docs/kalender-kategorien.md). Steuerzeichen haben in einem Namen nichts verloren
export const MAX_KATEGORIE_NAME = 255;

// Der Name der Kategorie zu einem Tag, oder null, wenn Outlook ihn nicht annähme (dann wird die Kategorie übersprungen und gezählt)
export function kategorieName(tagName: string): string | null {
  const name = tagName.trim();
  if (name === "" || name.length > MAX_KATEGORIE_NAME) return null;
  if (/[,\p{Cc}]/u.test(name)) return null;
  return name;
}

export const schluessel = (name: string) => name.trim().toLowerCase();

// Feste Palette: Farbe nach Typ des Tags, nie frei wählbar. Namen der Voreinstellungen von Microsoft Graph (categoryColor): preset4 grün, preset7 blau, preset8 violett, preset1 orange, preset3 gelb
export const FARBEN = {
  stufe: "preset4",
  funktion: "preset7",
  team: "preset8",
  lager: "preset1",
  anlass: "preset3",
} as const;
export type TagTyp = keyof typeof FARBEN;
export const PALETTE: readonly string[] = Object.values(FARBEN);
export const farbeFuer = (typ: string): string =>
  FARBEN[typ as TagTyp] ?? FARBEN.funktion;

type TagKurz = { id: string; name: string };

// Die Kategorien, die ein Termin in Outlook tragen soll, wenn seine Tags `sollTagIds` sind.
// Bestehende Kategorien, die einem Tag der Abteilung entsprechen (Abweichung zuerst, sonst gleicher Name), bleiben, wenn der Tag zu den Soll-Tags gehört, und fallen sonst weg. Alle anderen (fremde Kategorien von Hand gesetzt) bleiben unberührt. Fehlende Soll-Tags kommen mit dem Namen des Tags dazu. Die Reihenfolge bleibt, Neues steht hinten; ohne Unterschied kommt dieselbe Liste zurück.
export function berechneKategorien({
  bestehend,
  sollTagIds,
  tags,
  abweichungen,
}: {
  bestehend: string[];
  sollTagIds: ReadonlySet<string>;
  tags: TagKurz[];
  abweichungen: Map<string, string>;
}): { kategorien: string[]; uebersprungen: number } {
  const nachName = new Map(tags.map((t) => [schluessel(t.name), t.id]));
  const gedeckt = new Set<string>();
  const ergebnis: string[] = [];
  const gesehen = new Set<string>();
  for (const k of bestehend) {
    const s = schluessel(k);
    if (gesehen.has(s)) continue;
    const tagId = abweichungen.get(s) ?? nachName.get(s);
    if (tagId !== undefined) {
      if (!sollTagIds.has(tagId)) continue;
      gedeckt.add(tagId);
    }
    gesehen.add(s);
    ergebnis.push(k);
  }
  let uebersprungen = 0;
  for (const tag of tags) {
    if (!sollTagIds.has(tag.id) || gedeckt.has(tag.id)) continue;
    const name = kategorieName(tag.name);
    if (name === null) {
      uebersprungen++;
      continue;
    }
    if (gesehen.has(schluessel(name))) continue;
    gesehen.add(schluessel(name));
    ergebnis.push(name);
  }
  return { kategorien: ergebnis, uebersprungen };
}

// Gleich, wenn dieselben Namen vorkommen (Gross-/Kleinschreibung und Reihenfolge egal): Dann gibt es nichts zu schreiben
export function gleicheKategorien(a: string[], b: string[]): boolean {
  const sa = new Set(a.map(schluessel));
  const sb = new Set(b.map(schluessel));
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}
