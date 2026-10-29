export type Stufenfehler = {
  name?: string;
  kuerzel?: string;
  reihenfolge?: string;
};

// Die Regeln des Servers (Name bis 100, Kürzel bis 20, Reihenfolge 1 bis 999), damit Fehler beim Feld stehen
export function pruefeStufenfelder(eingabe: {
  name: string;
  kuerzel: string;
  reihenfolge: string;
}) {
  const name = eingabe.name.trim();
  const kuerzel = eingabe.kuerzel.trim();
  const reihenfolge = /^\d{1,3}$/.test(eingabe.reihenfolge.trim())
    ? Number(eingabe.reihenfolge)
    : 0;
  const fehler: Stufenfehler = {};
  if (name.length < 1 || name.length > 100) {
    fehler.name = "Bitte einen Namen mit höchstens 100 Zeichen eingeben.";
  }
  if (kuerzel.length < 1 || kuerzel.length > 20) {
    fehler.kuerzel = "Bitte ein Kürzel mit höchstens 20 Zeichen eingeben.";
  }
  if (reihenfolge < 1) {
    fehler.reihenfolge = "Bitte eine Zahl von 1 bis 999 eingeben.";
  }
  return {
    fehler,
    werte:
      Object.keys(fehler).length > 0
        ? undefined
        : { name, kuerzel, reihenfolge },
  };
}
