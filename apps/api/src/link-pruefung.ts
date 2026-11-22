// Strenge Prüfung von Links auf Dateien (SharePoint der Abteilung), gemeinsam für Lager (#370) und Website (#428). Rein, ohne Datenbank und ohne Netz: Der Server ruft die Adresse nie ab.

export const LINK_MAX = 2048;

export type LinkErgebnis =
  { ok: true; link: string } | { ok: false; grund: "ungueltig" | "host" };

// Ohne Steuer-, Format- und Trennzeichen (Leerzeichen, Zeilenumbruch, Bidi-Zeichen) und ohne Backslash: Eine Adresse, die Browser anders lesen als der Server, gibt es hier nicht. Gross- und Kleinschreibung des Schemas egal
const ADRESSE = /^https:\/\/[^\p{C}\p{Z}\\]+$/iu;

// Strenge Prüfung eines Links: nur https, kein javascript:, data: oder protokoll-relative Adresse, keine Zugangsdaten und kein Port in der Adresse, ein Host mit Punkt und kein IP-Literal, höchstens LINK_MAX Zeichen. «hosts» sind die erlaubten Hosts der Abteilung (der Host selbst oder eine Subdomain davon); null oder leer = keine Einschränkung (Vorgabe). Liefert die Adresse in der Schreibweise der URL-Norm (Host klein, Punycode)
export function pruefeLink(
  roh: string,
  hosts?: readonly string[] | null,
): LinkErgebnis {
  const ungueltig = { ok: false, grund: "ungueltig" } as const;
  if (roh.length > LINK_MAX || !ADRESSE.test(roh)) return ungueltig;
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    return ungueltig;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return ungueltig;
  }
  const host = url.hostname;
  if (
    !/^[a-z0-9.-]+$/.test(host) ||
    !host.includes(".") ||
    // Nur Ziffern und Punkte (auch die Kurzformen, die URL zu 127.0.0.1 umschreibt)
    /^[0-9.]+$/.test(host) ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..")
  ) {
    return ungueltig;
  }
  if (url.href.length > LINK_MAX) return ungueltig;
  if (
    hosts &&
    hosts.length > 0 &&
    !hosts.some((h) => host === h || host.endsWith(`.${h}`))
  ) {
    return { ok: false, grund: "host" };
  }
  return { ok: true, link: url.href };
}
