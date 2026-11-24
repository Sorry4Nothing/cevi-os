import { z } from "zod";
import {
  MAX_VORSCHLAEGE,
  type OrtssucheHolen,
  type Ortsvorschlag,
} from "./index.js";

// Die Ortssuche des Bundes (#695): api3.geo.admin.ch, Adressen, Postleitzahlen und Ortsnamen der Schweiz. Kein Schlüssel, keine Anmeldung; frei nutzbar im Rahmen von «Fair Use» (Allgemeine Nutzungsbedingungen der Geodateninfrastruktur des Bundes: 40 Abrufe je Minute für die REST-Dienste). Quelle: https://docs.geo.admin.ch/access-data/search.html
// Es geht nur der Suchtext hinaus, nie eine Kennung oder ein Name der Person. Der Host ist fest verdrahtet und nie eine Eingabe. Kein Weiterleiten, ein Zeitlimit und eine gedeckelte Antwort: Ein langsamer oder geschwätziger Dienst hält den Server nicht auf. Die Antwort wird mit zod gelesen; was nicht passt, fällt weg.
const HOST = "api3.geo.admin.ch";
const ZEITLIMIT_MS = 5_000;
const MAX_BYTES = 256 * 1024;
// Der Dienst nimmt höchstens zehn Wörter
const MAX_WOERTER = 10;
// Etwas mehr anfordern, weil doppelte Ortsnamen wegfallen
const ANFORDERN = 15;
const MAX_BEZEICHNUNG = 200;

const treffer = z.object({
  attrs: z.object({
    label: z.string().max(500),
    origin: z.enum(["address", "zipcode", "gazetteer"]),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
});
const antwort = z.object({ results: z.array(z.unknown()).max(50) });

const VERBOTEN = /[\p{Cc}\p{Cf}<>]/u;
const ENTITAETEN: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
const klartext = (t: string) =>
  t
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITAETEN[e]!)
    .replace(/\s+/g, " ")
    .trim();
const rund = (n: number) => Math.round(n * 1e6) / 1e6;

// Die Bezeichnung des Dienstes ist leicht ausgezeichnet («Beispielweg 4 <b>8000 Beispielstadt</b>»). Gelesen wird nur, was zu einem der drei bekannten Muster passt
export function leseTreffer(roh: unknown): Ortsvorschlag | null {
  const t = treffer.safeParse(roh);
  if (!t.success) return null;
  const { label, origin, lat, lon } = t.data.attrs;
  let strasse: string | null = null;
  let plz: string | null = null;
  let ort: string | null;
  let bezeichnung: string;
  if (origin === "address") {
    const m = /^(.+?) <b>(\d{4}) (.+)<\/b>$/.exec(label);
    if (!m) return null;
    // Ohne Hausnummer steht ein «#» hinter der Strasse
    strasse = klartext(m[1]!.replace(/\s*#$/, ""));
    plz = m[2]!;
    ort = klartext(m[3]!);
    bezeichnung = `${strasse}, ${plz} ${ort}`;
  } else if (origin === "zipcode") {
    const m = /^<b>(\d{4}) - (.+)<\/b>$/.exec(label);
    if (!m) return null;
    plz = m[1]!;
    ort = klartext(m[2]!);
    bezeichnung = `${plz} ${ort}`;
  } else {
    // «<i>Bahnhof</i> <b>Beispielstadt</b> (ZH) - Beispielstadt,Nachbarort»
    const m = /^<i>(.+?)<\/i> <b>(.+?)<\/b>(?: \([^)]*\))?(?: - (.+))?$/.exec(
      label,
    );
    if (!m) return null;
    const name = klartext(m[2]!);
    ort = m[3] ? klartext(m[3].split(",")[0]!) : null;
    bezeichnung = `${name} (${klartext(m[1]!)})${ort ? `, ${ort}` : ""}`;
  }
  if (
    bezeichnung.length > MAX_BEZEICHNUNG ||
    [bezeichnung, strasse, plz, ort].some((w) => w !== null && VERBOTEN.test(w))
  ) {
    return null;
  }
  return {
    bezeichnung,
    strasse,
    plz,
    ort,
    breite: rund(lat),
    laenge: rund(lon),
  };
}

// Liest den Körper höchstens bis MAX_BYTES; mehr ist ein Fehler
async function leseGedeckelt(res: Response): Promise<string> {
  if (!res.body) throw new Error("Keine Antwort");
  const leser = res.body.getReader();
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > MAX_BYTES) {
      await leser.cancel();
      throw new Error("Antwort zu gross");
    }
    teile.push(value);
  }
  const alles = new Uint8Array(summe);
  let stelle = 0;
  for (const teil of teile) {
    alles.set(teil, stelle);
    stelle += teil.byteLength;
  }
  return new TextDecoder().decode(alles);
}

export const sucheBeiGeoAdmin: OrtssucheHolen = async (suchtext) => {
  const url = new URL(`https://${HOST}/rest/services/ech/SearchServer`);
  url.search = new URLSearchParams({
    searchText: suchtext.split(/\s+/).slice(0, MAX_WOERTER).join(" "),
    type: "locations",
    origins: "address,zipcode,gazetteer",
    sr: "4326",
    limit: String(ANFORDERN),
  }).toString();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
    redirect: "error",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Ortssuche antwortet ${res.status}`);
  const { results } = antwort.parse(JSON.parse(await leseGedeckelt(res)));
  const gesehen = new Set<string>();
  const vorschlaege: Ortsvorschlag[] = [];
  for (const roh of results) {
    const v = leseTreffer(roh);
    if (!v || gesehen.has(v.bezeichnung)) continue;
    gesehen.add(v.bezeichnung);
    vorschlaege.push(v);
    if (vorschlaege.length >= MAX_VORSCHLAEGE) break;
  }
  return vorschlaege;
};
