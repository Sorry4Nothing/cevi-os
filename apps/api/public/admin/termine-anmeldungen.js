import { leiteAltAdresseUm } from "./anlass-gemeinsam.js";

// Alte Unterseite «Anmeldungen» (A19, #445): Anmeldungen gibt es seit #608 nur noch über den Anlass (Reiter «Anmeldungen», anlass-anmeldungen.js). Diese Datei bleibt, solange die Navigation die alte Unterseite noch nennt, und leitet die alten Adressen #anlaesse/anmeldungen und #anlaesse/anmeldungen/<id> um. Sie ruft keine Route auf; sobald die Navigation sie nicht mehr nennt, kann sie weg.
export function zeige(_bereich, ctx) {
  leiteAltAdresseUm(ctx.pfad);
}
