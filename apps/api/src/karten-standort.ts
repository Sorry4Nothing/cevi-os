import { pruefeLink } from "./link-pruefung.js";

// Standort eines Orts (#646). Rein, ohne Datenbank und ohne Netz: Der Server ruft keine Adresse ab, auch keine Kurzlinks.
// Eingabe ist ein Link von Google Maps, eine Adresse oder «Breite, Länge». Gespeichert wird höchstens eine Form: Koordinaten, Adresse oder (wenn nichts zu lesen ist, etwa bei einem Kurzlink) der geprüfte Link selbst.
// Den Link, den die Website zeigt, erzeugt kartenLink() neu: nie ein Link, den jemand eingetippt hat, ausser einem geprüften Kurzlink.

export const MAX_STANDORT_EINGABE = 600;
export const MAX_ADRESSE = 200;
export const MAX_KARTEN_URL = 500;

export type Standort = {
  adresse: string | null;
  breite: number | null;
  laenge: number | null;
  url: string | null;
};
export const KEIN_STANDORT: Standort = {
  adresse: null,
  breite: null,
  laenge: null,
  url: null,
};

export type StandortGrund = "ungueltig" | "host" | "zu_lang";
export type StandortErgebnis =
  { ok: true; standort: Standort } | { ok: false; grund: StandortGrund };

const SUCH_LINK = "https://www.google.com/maps/search/?api=1&query=";

// Steuerzeichen (auch Tab und Zeilenumbruch) und Bidi-Zeichen haben in einer Adresse nichts verloren
// eslint-disable-next-line no-control-regex
const VERBOTEN = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/;
const KOORDINATEN = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/;
// «javascript:alert(1)», «data:…», «ftp://…»: ein Schema ohne Leerzeichen dahinter ist ein Linkversuch, keine Adresse
const SCHEMA = /^[a-z][a-z0-9+.-]*:\S/i;
// Ohne «https://» eingefügt («www.google.com/maps/…», «maps.app.goo.gl/…»)
const OHNE_SCHEMA =
  /^(www\.google\.com|google\.com|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl)\//i;

// Je Host erlaubte Pfade: Offene Weiterleiter («www.google.com/url?q=…», «goo.gl/<beliebig>») gehören nicht dazu
const HOSTS: Record<string, RegExp> = {
  "www.google.com": /^\/maps(\/|$)/,
  "google.com": /^\/maps(\/|$)/,
  "maps.google.com": /^(\/|\/maps(\/|$))/,
  "maps.app.goo.gl": /^\/[A-Za-z0-9_-]{3,64}\/?$/,
  "goo.gl": /^\/maps(\/|$)/,
};

// «+ 0» macht aus -0 eine 0
const zahl = (t: string) => Math.round(Number(t) * 1e6) / 1e6 + 0;

function koordinaten(b: string, l: string): Standort | null {
  const breite = zahl(b);
  const laenge = zahl(l);
  if (!Number.isFinite(breite) || !Number.isFinite(laenge)) return null;
  if (Math.abs(breite) > 90 || Math.abs(laenge) > 180) return null;
  return { ...KEIN_STANDORT, breite, laenge };
}

const dekodiert = (t: string) => {
  try {
    return decodeURIComponent(t.replace(/\+/g, " "));
  } catch {
    return null;
  }
};

function adresseAus(text: string | null): Standort | null {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_ADRESSE || VERBOTEN.test(t)) return null;
  return { ...KEIN_STANDORT, adresse: t };
}

// Aus einem langen Link von Google Maps lesen, was sich lesen lässt: zuerst die Koordinaten des Orts («!3d…!4d…»), dann die der Kartenmitte («@…»), dann ein Suchtext
function ausLink(url: URL): Standort | null {
  const pfad = dekodiert(url.pathname) ?? url.pathname;
  const ort = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(
    pfad + url.search,
  );
  if (ort) return koordinaten(ort[1]!, ort[2]!);
  const mitte = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(pfad);
  if (mitte) return koordinaten(mitte[1]!, mitte[2]!);
  for (const name of ["q", "query", "ll", "destination", "daddr", "center"]) {
    const wert = url.searchParams.get(name)?.trim();
    if (!wert) continue;
    const k = KOORDINATEN.exec(wert);
    if (k) return koordinaten(k[1]!, k[2]!);
    if (name === "q" || name === "query") return adresseAus(wert);
  }
  const stelle = /^\/maps\/(?:place|search)\/([^/@]+)/.exec(pfad);
  return stelle ? adresseAus(stelle[1]!.replace(/\+/g, " ")) : null;
}

// leere Eingabe = kein Standort (ok); sonst genau einer der drei Wege oder ein Fehlergrund
export function pruefeStandort(roh: string): StandortErgebnis {
  const t = roh.trim();
  if (t === "") return { ok: true, standort: KEIN_STANDORT };
  if (t.length > MAX_STANDORT_EINGABE) return { ok: false, grund: "zu_lang" };
  if (VERBOTEN.test(t)) return { ok: false, grund: "ungueltig" };
  const k = KOORDINATEN.exec(t);
  if (k) {
    const standort = koordinaten(k[1]!, k[2]!);
    return standort
      ? { ok: true, standort }
      : { ok: false, grund: "ungueltig" };
  }
  const linkVersuch =
    /^https?:\/\//i.test(t) || SCHEMA.test(t) || /^\/\//.test(t);
  if (!linkVersuch && !OHNE_SCHEMA.test(t)) {
    const standort = adresseAus(t);
    return standort
      ? { ok: true, standort }
      : { ok: false, grund: t.length > MAX_ADRESSE ? "zu_lang" : "ungueltig" };
  }
  const adresse = OHNE_SCHEMA.test(t) ? `https://${t}` : t;
  const geprueft = pruefeLink(adresse);
  if (!geprueft.ok) return { ok: false, grund: "ungueltig" };
  const url = new URL(geprueft.link);
  const erlaubt = HOSTS[url.hostname];
  if (!erlaubt || !erlaubt.test(url.pathname)) {
    return { ok: false, grund: "host" };
  }
  const gelesen = ausLink(url);
  if (gelesen) return { ok: true, standort: gelesen };
  url.hash = "";
  const normal = url.href;
  if (normal.length > MAX_KARTEN_URL) return { ok: false, grund: "zu_lang" };
  return { ok: true, standort: { ...KEIN_STANDORT, url: normal } };
}

// Der Link zur Karte: Koordinaten und Adresse führen immer über die Such-Adresse von Google Maps, die der Server selbst baut. Ein gespeicherter Link (Kurzlink) wird beim Ausgeben noch einmal geprüft. Ohne Standort null
export function kartenLink(s: Standort): string | null {
  if (s.breite !== null && s.laenge !== null) {
    return `${SUCH_LINK}${s.breite},${s.laenge}`;
  }
  if (s.adresse) return `${SUCH_LINK}${encodeURIComponent(s.adresse)}`;
  if (s.url) {
    const g = pruefeStandort(s.url);
    return g.ok && g.standort.url === s.url ? s.url : null;
  }
  return null;
}

// Der Eintrag im Feld «Standort» beim Bearbeiten: so, wie man ihn eingeben würde
export function standortText(s: Standort): string {
  if (s.breite !== null && s.laenge !== null) return `${s.breite}, ${s.laenge}`;
  return s.adresse ?? s.url ?? "";
}
