// Ohne 0, O, 1, I, L und ohne B, S, Z (ähneln 8, 5, 2): Startpasswörter werden vorgelesen und abgetippt
const ZEICHEN = "23456789ACDEFGHJKMNPQRTUVWXY";
const LAENGE = 12;
const TAG = 86_400_000;

// 12 Zeichen aus 28 ergeben rund 58 Bit; Verwerfen ab 252 (grösstes Vielfaches von 28 unter 256) hält die Ziehung gleichmässig
export function erzeugeStartpasswort() {
  const zeichen: string[] = [];
  while (zeichen.length < LAENGE) {
    for (const byte of crypto.getRandomValues(new Uint8Array(LAENGE))) {
      if (byte >= 252 || zeichen.length === LAENGE) continue;
      zeichen.push(ZEICHEN[byte % ZEICHEN.length]);
    }
  }
  return [zeichen.slice(0, 4), zeichen.slice(4, 8), zeichen.slice(8)]
    .map((gruppe) => gruppe.join(""))
    .join("-");
}

// Diese Form wird gehasht und verglichen: Bei offenem Startpasswort zählen Bindestriche, Leerzeichen und Gross-/Kleinschreibung nicht
export function normalisiereStartpasswort(text: string) {
  return text.replace(/[-\s]/g, "").toUpperCase();
}

// Felder für ein neues Startpasswort (#18, #20): Pflichtwechsel an, 7 Tage gültig, und die Bremse beginnt von vorn
export function startpasswortFelder(jetzt = new Date()) {
  return {
    mussPasswortAendern: true,
    startpasswortGueltigBis: new Date(jetzt.getTime() + 7 * TAG),
    fehlversuche: 0,
    naechsterVersuchAb: null,
  };
}
