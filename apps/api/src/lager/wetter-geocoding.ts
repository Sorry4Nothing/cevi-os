import { z } from "zod";

// Ortssuche für das Wetter (#694): Der Server bestimmt den Wetterort aus dem Lagerort («Ort» des Lagers), niemand gibt Koordinaten ein. Gesucht wird beim Geocoding-Dienst von Open-Meteo. Es geht nur ein Ortsname hinaus (kein Titel, keine Hausadresse, keine Kennung, kein Schlüssel); die Postleitzahl bleibt beim Server und hilft nur, mehrere Treffer zu unterscheiden. Der Host ist fest verdrahtet, kein Weiterleiten, ein Zeitlimit und eine gedeckelte Antwort.
const HOST = "geocoding-api.open-meteo.com";
const ZEITLIMIT_MS = 5_000;
const MAX_BYTES = 64 * 1024;

export type OrtTreffer = {
  name: string;
  breite: number;
  laenge: number;
  kanton: string | null;
  bevoelkerung: number;
  plz: string[];
};

// Sucht Orte in der Schweiz zu einem Namen; wirft bei jedem Fehler, kein Treffer ist eine leere Liste
export type OrtSuchen = (name: string) => Promise<OrtTreffer[]>;

const antwort = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        admin1: z.string().optional(),
        population: z.number().optional(),
        postcodes: z.array(z.string()).optional(),
      }),
    )
    .max(20)
    .optional(),
});

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
  return new TextDecoder().decode(Buffer.concat(teile));
}

export const sucheOpenMeteo: OrtSuchen = async (name) => {
  const url = new URL(`https://${HOST}/v1/search`);
  url.search = new URLSearchParams({
    name,
    count: "10",
    language: "de",
    countryCode: "CH",
    format: "json",
  }).toString();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
    redirect: "error",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Ortssuche antwortet ${res.status}`);
  const d = antwort.parse(JSON.parse(await leseGedeckelt(res)));
  return (d.results ?? []).map((r) => ({
    name: r.name,
    breite: r.latitude,
    laenge: r.longitude,
    kanton: r.admin1 ?? null,
    bevoelkerung: r.population ?? 0,
    plz: r.postcodes ?? [],
  }));
};

const klein = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Der Treffer, wenn er eindeutig ist. Der Dienst sucht über den Anfang des Namens («Muster» findet «Musterstadt»): Gibt es Treffer mit genau diesem Namen, zählen nur sie. Mit PLZ zählen die Treffer dieser PLZ. Bleiben mehrere: Alle innerhalb von rund 10 km um den ersten sind derselbe Ort (ein Dorf kommt oft als Gemeinde und als Siedlung vor); sonst gewinnt ein Ort, der mindestens dreimal so gross ist wie der zweitgrösste; sonst ist es nicht eindeutig
export function waehleTreffer(
  treffer: OrtTreffer[],
  name: string,
  plz: string | null,
): { art: "gefunden"; treffer: OrtTreffer } | { art: "keiner" | "mehrdeutig" } {
  if (treffer.length === 0) return { art: "keiner" };
  const genau = treffer.filter((t) => klein(t.name) === klein(name));
  let pool = genau.length > 0 ? genau : treffer;
  if (plz) {
    const mitPlz = pool.filter((t) => t.plz.includes(plz));
    if (mitPlz.length > 0) pool = mitPlz;
  }
  const [erster, ...rest] = [...pool].sort(
    (a, b) => b.bevoelkerung - a.bevoelkerung,
  );
  if (!erster) return { art: "keiner" };
  const nah = (t: OrtTreffer) =>
    Math.abs(t.breite - erster.breite) < 0.1 &&
    Math.abs(t.laenge - erster.laenge) < 0.1;
  if (rest.every(nah)) return { art: "gefunden", treffer: erster };
  const zweiter = rest[0];
  if (
    erster.bevoelkerung > 0 &&
    zweiter &&
    erster.bevoelkerung >= 3 * zweiter.bevoelkerung
  ) {
    return { art: "gefunden", treffer: erster };
  }
  return { art: "mehrdeutig" };
}

// Zwei Stellen (rund ein Kilometer): Mehr braucht die Vorhersage nicht, und es geht nie die genaue Lage eines Hauses hinaus
export const rundeOrt = (x: number) => Math.round(x * 100) / 100;
