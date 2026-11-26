// Wie die Verwaltung die Rolle einer bestimmten Person nennt (#817). Reine Logik ohne DOM.
// geschlecht: «w», «m» oder leer (keine Angabe), wie die API es liefert. Ohne Angabe gilt die neutrale Form.
// Nur dort verwenden, wo eine konkrete Person steht. Allgemeine Beschriftungen (Rechtekatalog, Auswahl, Mitteilungsziele) bleiben neutral, die öffentliche Website auch.
const FORMEN = {
  leitung: {
    m: "Gruppenleiter",
    w: "Gruppenleiterin",
    neutral: "Gruppenleitung",
  },
  stufenleitung: {
    m: "Stufenleiter",
    w: "Stufenleiterin",
    neutral: "Stufenleitung",
  },
};

// Typ ohne Form (freier Text einer Gruppe, unbekannter Wert) bleibt, wie er ist
export function rollenName(typ, geschlecht) {
  if (!Object.hasOwn(FORMEN, typ)) return typ ?? "";
  const formen = FORMEN[typ];
  return geschlecht === "m"
    ? formen.m
    : geschlecht === "w"
      ? formen.w
      : formen.neutral;
}
