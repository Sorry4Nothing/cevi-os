import type { CeviPerson } from "./felder.js";

// Welche Person der Cevi-Datenbank ist diese Person oder dieses Kind? (#691) Nur ein einziger eindeutiger Treffer zählt. Bei keinem oder mehreren gibt es keine Vorbefüllung, und nichts davon verrät etwas über Dritte: Das Ergebnis trägt nie Namen oder Nummern anderer Personen.
// Rangfolge: 1. die gemerkte Nummer, 2. E-Mail plus Vorname, 3. Vorname plus Nachname plus Geburtsdatum. Ein Name allein ist nie ein Treffer.

export type Anfrage = {
  // Nummer, die der Server nach einem früheren eindeutigen Treffer gemerkt hat
  ceviDbId: string | null;
  // E-Mail-Adressen, unter denen die Person oder (beim Kind) die Eltern in der Cevi-Datenbank stehen können
  emails: readonly string[];
  vorname: string;
  nachname: string | null;
  // «JJJJ-MM-TT», nur wenn Cevi OS es kennt (heute fragt es nirgends danach)
  geburtsdatum: string | null;
};

export type Zuordnung =
  | { art: "treffer"; person: CeviPerson }
  | { art: "keiner" }
  | { art: "mehrdeutig" };

// Ohne Gross-/Kleinschreibung, Akzente und Leerzeichen: «Léa» = «lea»
export const normal = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");

const KEINER: Zuordnung = { art: "keiner" };
const MEHRDEUTIG: Zuordnung = { art: "mehrdeutig" };

function einzig(treffer: readonly CeviPerson[]): Zuordnung | null {
  if (treffer.length === 1) return { art: "treffer", person: treffer[0]! };
  return treffer.length > 1 ? MEHRDEUTIG : null;
}

export function ordneZu(
  personen: readonly CeviPerson[],
  anfrage: Anfrage,
): Zuordnung {
  const vorname = normal(anfrage.vorname);
  // Ohne Vornamen gibt es keinen Vergleich über Name und E-Mail
  if (anfrage.ceviDbId) {
    const bekannt = personen.filter((p) => p.id === anfrage.ceviDbId);
    const z = einzig(bekannt);
    if (z) return z;
  }
  if (vorname.length === 0) return KEINER;
  const gleicherVorname = personen.filter((p) => normal(p.vorname) === vorname);
  const emails = new Set(
    anfrage.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  const perEmail =
    emails.size > 0
      ? einzig(
          gleicherVorname.filter(
            (p) => p.email !== null && emails.has(p.email),
          ),
        )
      : null;
  if (perEmail?.art === "treffer") return perEmail;
  // Mehrere über die E-Mail (zum Beispiel Zwillinge): Vorname, Nachname und Geburtsdatum können noch entscheiden
  const nachname = anfrage.nachname ? normal(anfrage.nachname) : "";
  const perDatum =
    nachname && anfrage.geburtsdatum
      ? einzig(
          gleicherVorname.filter(
            (p) =>
              normal(p.nachname) === nachname &&
              p.geburtsdatum === anfrage.geburtsdatum,
          ),
        )
      : null;
  return perDatum ?? perEmail ?? KEINER;
}
