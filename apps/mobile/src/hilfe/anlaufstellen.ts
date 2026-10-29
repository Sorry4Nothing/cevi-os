// Feste Anlaufstellen der Hilfe-Seite (#54). nummer null heisst: noch nicht gegen cevi.ch/praevention geprüft (#62), die Seite zeigt dann keine Nummer
export type Anlaufstelle = {
  name: string;
  beschreibung?: string;
  nummer: string | null;
};

export const ANLAUFSTELLEN: Anlaufstelle[] = [
  {
    name: "147",
    beschreibung: "Elternberatung von Pro Juventute",
    nummer: "147",
  },
  { name: "Krisennummer von Cevi Schweiz", nummer: null },
  { name: "Swiss Sport Integrity", nummer: null },
];
