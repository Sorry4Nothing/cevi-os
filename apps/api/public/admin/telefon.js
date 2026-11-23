// Telefonnummer wie im Feld «Telefon» der Personen (Muster «phone-input»): tolerant beim Eintippen, einheitlich beim Speichern. Reine Logik ohne DOM.
// Die Regel des Servers (src/telefon.ts) bleibt die Wahrheit; hier geht es nur um eine schöne Schreibweise und eine frühe Meldung.
// shortcut: Nur Schweizer Nummern werden gruppiert (+41 79 123 45 67). Andere Länder bleiben, wie sie getippt wurden. Mehr Länder: erst, wenn die Abteilung Nummern aus dem Ausland erfasst.

// Dieselbe Prüfung wie der Server: optionales «+», dann Ziffern und die üblichen Trennzeichen, 6 bis 30 Zeichen
const SERVER = /^\+?\d[\d ()/.-]{4,28}\d$/;

export const BEISPIEL = "079 123 45 67";

// Gibt { wert, gueltig, vorschau } zurück: wert ist die Schreibweise zum Speichern (leer = Nummer entfernen), vorschau dasselbe als Text für die Anzeige
export function normalisiereTelefon(eingabe) {
  const roh = String(eingabe ?? "").trim();
  if (roh === "") return { wert: "", gueltig: true, vorschau: "" };
  // Nur Ziffern und ein führendes Plus zählen; Leerzeichen, Klammern, Striche und Schrägstriche sind Beiwerk
  let ziffern = roh.replace(/[^\d+]/g, "");
  if (ziffern.startsWith("00")) ziffern = `+${ziffern.slice(2)}`;
  else if (/^0\d/.test(ziffern)) ziffern = `+41${ziffern.slice(1)}`;
  const schweiz = /^\+41(\d{9})$/.exec(ziffern);
  const wert = schweiz
    ? `+41 ${schweiz[1].slice(0, 2)} ${schweiz[1].slice(2, 5)} ${schweiz[1].slice(5, 7)} ${schweiz[1].slice(7)}`
    : roh.replace(/\s+/g, " ");
  const gueltig = SERVER.test(wert);
  return { wert, gueltig, vorschau: gueltig ? wert : "" };
}
