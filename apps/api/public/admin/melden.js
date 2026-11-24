// Rückmeldung aus Dateien ohne Zugriff auf ctx (Hilfen wie dom.js, Bauteile): dieselbe Stelle wie ctx.melde, ein Toast (#761).
// admin.js verdrahtet den Melder einmal mit den Toasts; bis dahin (und in Tests) tut melde() nichts.
let melder = () => {};
export const verdrahteMelder = (f) => {
  melder = f;
};
// art: «ok», «info», «warn» oder «fehler»; aktion: { text, onclick }
export const melde = (text, art = "ok", aktion) => melder(text, art, aktion);
