// Eigene Kopie der Server-Regel (apps/api/src/benutzername.ts): Die App importiert aus @cevi-os/api nur Typen
export const BENUTZERNAME_MUSTER = /^[a-z0-9._-]+$/i;

export const BENUTZERNAME_FEHLER =
  "Erlaubt sind 3 bis 64 Zeichen: Buchstaben ohne Umlaute, Ziffern, Punkt, Bindestrich und Unterstrich.";

export function benutzernameGueltig(benutzername: string) {
  return (
    benutzername.length >= 3 &&
    benutzername.length <= 64 &&
    BENUTZERNAME_MUSTER.test(benutzername)
  );
}

const UMLAUTE: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  "\u00df": "ss",
};

// ä→ae, é→e, ç→c; Leerzeichen→Bindestrich, alles andere ausserhalb von [a-z0-9-] fällt weg
function umschreiben(text: string) {
  return text
    .toLowerCase()
    .replace(/[äöü\u00df]/g, (zeichen) => UMLAUTE[zeichen])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// vorname.nachname; ist der Name in der geladenen Liste vergeben, mit 2, 3, …; höchstens 64 Zeichen samt Zahl
export function schlageBenutzernameVor(
  vorname: string,
  nachname: string,
  vergeben: readonly string[],
) {
  const basis = `${umschreiben(vorname)}.${umschreiben(nachname)}`;
  const kandidat = basis.slice(0, 64);
  if (!vergeben.includes(kandidat)) return kandidat;
  for (let zahl = 2; ; zahl++) {
    const mitZahl = `${basis.slice(0, 64 - String(zahl).length)}${zahl}`;
    if (!vergeben.includes(mitZahl)) return mitZahl;
  }
}
