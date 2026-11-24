// Reine Logik der Orte (#646), ohne DOM: testbar in Node

// Nur Links, die der Server gebaut hat und die zu Google Maps führen: eine zweite Sperre in der Oberfläche, falls je etwas anderes in der Antwort stünde
const KARTEN_HOSTS = new Set([
  "www.google.com",
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "maps.google.com",
]);
export function sichererKartenLink(wert) {
  try {
    const u = new globalThis.URL(wert);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      KARTEN_HOSTS.has(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
