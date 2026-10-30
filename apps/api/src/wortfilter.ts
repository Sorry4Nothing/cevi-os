// Feste Liste (#53), bewusst nicht pflegbar in der App. Gemeint sind Beschimpfungen, Herabwürdigungen und sexuelle Belästigung; Schreibweise klein, ohne Umlaute und ß
// Teile: Treffer, wenn ein Wort sie enthält (auch Mehrzahl und Zusammensetzungen wie «Riesenarschloch»)
const TEILE = [
  "arschloch",
  "wichser",
  "hurensohn",
  "fotze",
  "schlampe",
  "missgeburt",
  "schwuchtel",
  "sieg heil",
  "heil hitler",
] as const;
// Ganze Wörter: Als Teil kämen harmlose Wörter («Mongolei», «Nuttall») mit
const GANZE = ["nutte", "nutten", "neger", "kanake", "mongo", "spast"] as const;

// Gleiche Schreibweise für Liste und Text: ohne Akzente und Gross-/Kleinschreibung, ß als ss, Trennzeichen als Leerzeichen
// shortcut: ersetzt keine Buchstaben durch Ziffern oder Sonderzeichen («4rschloch») und erkennt keine auseinandergezogenen Wörter, bei Bedarf Zeichentausch ergänzen
function normalisiere(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

export function enthaeltVerbotenes(text: string) {
  const norm = normalisiere(text);
  const woerter = norm.split(" ");
  return (
    TEILE.some((teil) => norm.includes(teil)) ||
    GANZE.some((wort) => woerter.includes(wort))
  );
}

export const WORTFILTER_ANTWORT = {
  code: "NACHRICHT_ABGELEHNT",
  message:
    "Die Nachricht enthält Wörter, die im Chat nicht erlaubt sind. Bitte formuliere sie um.",
} as const;
