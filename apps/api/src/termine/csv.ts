// CSV für Excel in der Schweiz (#444): UTF-8 mit BOM, Semikolon als Trenner (Annahme, vom Nutzer zu bestätigen), Zeilenende CRLF.
export const BOM = "﻿";

// Excel und andere Tabellen führen eine Zelle als Formel aus, wenn sie mit einem dieser Zeichen beginnt. Ein führendes ' macht sie zu Text (Formel-Injektion, im Geist von SR-21/SR-25). Eine Telefonnummer mit «+» bekommt es auch: Der Schutz gilt ohne Ausnahme.
const FORMEL_ANFANG = /^[=+\-@\t\r\n]/;

export function entschaerfe(wert: string) {
  return FORMEL_ANFANG.test(wert) ? `'${wert}` : wert;
}

// Eine Zelle: erst entschärfen, dann bei Trenner, Anführungszeichen oder Zeilenumbruch in Anführungszeichen setzen
export function zelle(wert: string) {
  const text = entschaerfe(wert);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvZeile = (werte: readonly string[]) =>
  `${werte.map(zelle).join(";")}\r\n`;
