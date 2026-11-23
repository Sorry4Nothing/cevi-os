// «Mitnehmen» einer Stufenseite (#645): Der Freitext wird, wenn er aus mehreren Dingen besteht, eine Liste.
// Getrennt wird bei Zeilenumbruch, Komma und Strichpunkt; ein Komma in Klammern trennt nicht («Kleidung (warm, wetterfest)»).
// Reihenfolge und Wortlaut bleiben; der Renderer maskiert jeden Eintrag wie jeden Text.

// Mehr Einträge zeigt die Tafel nicht als Liste, sondern als Text: nichts geht verloren, die Tafel wird nicht endlos
export const MAX_EINTRAEGE = 30;

function trenne(text: string, mitKlammern: boolean): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let aktuell = "";
  for (const zeichen of text) {
    if (mitKlammern && zeichen === "(") tiefe++;
    else if (mitKlammern && zeichen === ")" && tiefe > 0) tiefe--;
    if ((zeichen === "," || zeichen === ";") && tiefe === 0) {
      teile.push(aktuell);
      aktuell = "";
    } else aktuell += zeichen;
  }
  teile.push(aktuell);
  return teile;
}

// null: keine Liste (ein einzelnes Ding, ein Satz ohne Trenner oder zu viele Einträge); dann steht der Text als Absatz
export function teileMitnehmen(text: string): string[] | null {
  const eintraege: string[] = [];
  for (const zeile of text.split(/\r\n|\r|\n/)) {
    // Eine unvollständige Klammer («Kluft (warm, Zvieri») soll nicht den Rest verschlucken
    const klammernOffen =
      (zeile.match(/\(/g)?.length ?? 0) !== (zeile.match(/\)/g)?.length ?? 0);
    for (const teil of trenne(zeile, !klammernOffen)) {
      const eintrag = teil
        .replace(/^\s*[-•*–]\s+/u, "")
        .replace(/\s+/gu, " ")
        .trim();
      if (eintrag !== "") eintraege.push(eintrag);
    }
  }
  return eintraege.length >= 2 && eintraege.length <= MAX_EINTRAEGE
    ? eintraege
    : null;
}
