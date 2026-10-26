import { z } from "zod";
import { ANTWORT_UNGUELTIG, KalenderFehler } from "./fehler.js";

// Nur die Felder der Maske aus google.ts; unbekannte Felder fallen weg
const zeitSchema = z.object({
  date: z.iso.date().optional(),
  // Nur mit Offset (Z oder ±hh:mm): Ohne ihn wäre der Zeitpunkt zweideutig
  dateTime: z.iso.datetime({ offset: true }).optional(),
});
const terminSchema = z.object({
  id: z.string().min(1),
  // Google lässt den Standard «confirmed» weg
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: zeitSchema.optional(),
  end: zeitSchema.optional(),
  recurringEventId: z.string().optional(),
  visibility: z.string().optional(),
});
const seiteSchema = z.object({
  items: z.array(terminSchema).optional(),
  nextPageToken: z.string().optional(),
});

export type ProgrammAusGoogle = {
  googleEventId: string;
  googleSerie: string | null;
  titel: string;
  ganztaegig: boolean;
  beginn: Date | null;
  ende: Date | null;
  tagVon: string | null;
  tagBis: string | null;
  googleOrt: string | null;
  googleBeschreibung: string | null;
};

// Googles Enddatum ist exklusiv; der letzte Programmtag liegt einen Tag davor
function letzterTag(exklusivesEnde: string) {
  const tag = new Date(`${exklusivesEnde}T00:00:00Z`);
  tag.setUTCDate(tag.getUTCDate() - 1);
  return tag.toISOString().slice(0, 10);
}

// Reine Abbildung der rohen Seiten auf Programme und Absagen; eine ungültige Seite wirft und lässt die Abteilung scheitern
export function gleicheAb(seiten: unknown[]): {
  programme: ProgrammAusGoogle[];
  absagen: string[];
} {
  const geprueft = z.array(seiteSchema).safeParse(seiten);
  if (!geprueft.success) {
    throw new KalenderFehler(ANTWORT_UNGUELTIG, { cause: geprueft.error });
  }
  const programme: ProgrammAusGoogle[] = [];
  const absagen: string[] = [];
  for (const seite of geprueft.data) {
    for (const termin of seite.items ?? []) {
      // Zuerst die Absage: Abgesagte Instanzen liefern nur ID und Serienbezug, also auch keinen Titel
      if (termin.status === "cancelled") {
        absagen.push(termin.id);
        continue;
      }
      if (
        termin.visibility === "private" ||
        termin.visibility === "confidential"
      ) {
        continue;
      }
      const titel = termin.summary?.trim();
      if (!titel) continue;
      const tagVon = termin.start?.date;
      const tagBisExklusiv = termin.end?.date;
      const beginn = termin.start?.dateTime;
      const ende = termin.end?.dateTime;
      const ganztaegig =
        tagVon !== undefined &&
        tagBisExklusiv !== undefined &&
        beginn === undefined &&
        ende === undefined;
      const mitZeit =
        beginn !== undefined &&
        ende !== undefined &&
        tagVon === undefined &&
        tagBisExklusiv === undefined;
      // Gemischte oder fehlende Zeiten: lieber die Abteilung abbrechen als raten
      if (!ganztaegig && !mitZeit) throw new KalenderFehler(ANTWORT_UNGUELTIG);
      programme.push({
        googleEventId: termin.id,
        googleSerie: termin.recurringEventId ?? null,
        titel,
        ganztaegig,
        beginn: mitZeit ? new Date(beginn) : null,
        ende: mitZeit ? new Date(ende) : null,
        tagVon: ganztaegig ? tagVon : null,
        tagBis: ganztaegig ? letzterTag(tagBisExklusiv) : null,
        googleOrt: termin.location ?? null,
        googleBeschreibung: htmlZuText(termin.description ?? ""),
      });
    }
  }
  return { programme, absagen };
}

const ENTITAETEN: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Die App rendert nur Text: Links werden «Text (Ziel)», Blockenden ein Zeilenumbruch, Tags fallen weg («Alter < 10» bleibt), Entities werden aufgelöst
export function htmlZuText(html: string): string | null {
  const text = html
    .replace(
      /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, inhalt: string) => {
        const t = inhalt.replace(/<[^>]*>/g, "");
        return t === href ? t : `${t} (${href})`;
      },
    )
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(
      /&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
      (treffer, e: string) => {
        const klein = e.toLowerCase();
        if (klein.startsWith("#")) {
          const n = klein.startsWith("#x")
            ? parseInt(klein.slice(2), 16)
            : parseInt(klein.slice(1), 10);
          // fromCodePoint wirft ausserhalb von Unicode, und NUL lehnt Postgres ab: beides hielte den Lauf der Abteilung an
          return n >= 1 && n <= 0x10ffff ? String.fromCodePoint(n) : treffer;
        }
        return ENTITAETEN[klein];
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
