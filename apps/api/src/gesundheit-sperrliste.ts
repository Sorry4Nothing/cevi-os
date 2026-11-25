// Keine Gesundheitsdaten in frei gestalteten Feldern (Datenschutz): Eine kleine Sperrliste prüft Beschriftung und Optionen, ohne Gross-/Kleinschreibung und Umlaute. Gilt für die Zusatzfelder der Anlass-Anmeldung (#445) und für die Formulare der Website (#819).
// shortcut: Wortstämme, kein Verständnis von Sprache; Fehlalarme (z. B. «Krankenwagen») und Umgehungen sind möglich. Die Editoren weisen zusätzlich darauf hin, bei Bedarf Liste erweitern. Der Editor der Website kennt dieselbe Liste (public/admin/website-felder-formular.js); ein Test hält beide gleich.
export const SPERRLISTE = [
  "allerg",
  "krank",
  "medikament",
  "diagnos",
  "gesundheit",
  "impf",
  "behinder",
  "handicap",
  "unvertraeglich",
  "intoleranz",
  "therapie",
  "epilep",
  "diabet",
  "asthma",
  "psych",
  "schwanger",
];
const normal = (text: string) =>
  text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

export const enthaeltGesundheitswort = (text: string) =>
  SPERRLISTE.some((wort) => normal(text).includes(wort));
