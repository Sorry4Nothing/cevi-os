// Welche Angaben der Cevi-Datenbank eine Anmeldung vorausfüllen darf (#691). Die Liste ist fest und kurz: nur, was eine Anmeldung wirklich fragt. Nie Gesundheit, nie Rollen, nie Zusatzfelder der Cevi-Datenbank, kein Name (den kennt das Konto).
export const CEVI_QUELLEN = [
  "geburtsdatum",
  "telefon",
  "adresse",
  "plz",
  "ort",
  "email",
] as const;
export type CeviQuelle = (typeof CEVI_QUELLEN)[number];

export const CEVI_QUELLE_NAMEN: Record<CeviQuelle, string> = {
  geburtsdatum: "Geburtsdatum",
  telefon: "Telefon",
  adresse: "Strasse und Nummer",
  plz: "Postleitzahl",
  ort: "Ort",
  email: "E-Mail",
};

// Was der Server aus der Cevi-Datenbank behält: genau diese Felder (Allowlist), alles andere verwirft die Schema-Prüfung des Clients
export type CeviPerson = {
  id: string;
  vorname: string;
  nachname: string;
  email: string | null;
  // «JJJJ-MM-TT»
  geburtsdatum: string | null;
  telefon: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
};

const datumKurz = (iso: string) => {
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
};

// Der Wert für ein Textfeld der Anmeldung, oder null, wenn die Cevi-Datenbank nichts hat
export function wertFuer(person: CeviPerson, quelle: CeviQuelle) {
  const roh = {
    geburtsdatum: person.geburtsdatum ? datumKurz(person.geburtsdatum) : null,
    telefon: person.telefon,
    adresse: person.strasse,
    plz: person.plz,
    ort: person.ort,
    email: person.email,
  }[quelle];
  return roh && roh.length > 0 ? roh : null;
}
