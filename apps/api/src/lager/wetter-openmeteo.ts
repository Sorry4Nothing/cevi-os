import { z } from "zod";
import { sucheOpenMeteo, type OrtSuchen } from "./wetter-geocoding.js";

// Abruf der Wettervorhersage bei Open-Meteo (#391). Es gehen nur zwei Zahlen hinaus (Breite und Länge des Lagers, vom Server aus dem Lagerort bestimmt und auf zwei Stellen gerundet), keine Namen, kein Schlüssel, keine Kennung der Person oder des Lagers. Der Host ist fest verdrahtet und nie eine Eingabe; die Adresse entsteht aus Zahlen. Kein Weiterleiten, ein Zeitlimit und eine gedeckelte Antwort: Ein langsamer oder geschwätziger Dienst hält den Server nicht auf.
const HOST = "api.open-meteo.com";
const ZEITLIMIT_MS = 5_000;
const MAX_BYTES = 64 * 1024;

export type WetterTag = {
  // «JJJJ-MM-TT» in der Zeitzone des Lagers (Europe/Zurich)
  datum: string;
  // Wettercode der WMO (0 klar bis 99 Gewitter mit Hagel)
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  // Regen des Tages in mm
  regen: number | null;
  // Stärkste Böe des Tages in km/h
  boeen: number | null;
};

// Holt die Tageswerte für zwei Tage zurück und 16 Tage voraus. Wirft bei jedem Fehler; die Aufrufer (lager/wetter.ts) zeigen dann kein Wetter statt eines Fehlers
export type WetterHolen = (
  breite: number,
  laenge: number,
) => Promise<WetterTag[]>;

const zahlen = z.array(z.number().nullable());
const antwort = z.object({
  daily: z.object({
    time: z.array(z.iso.date()).max(30),
    weather_code: zahlen,
    temperature_2m_max: zahlen,
    temperature_2m_min: zahlen,
    precipitation_sum: zahlen,
    wind_gusts_10m_max: zahlen,
  }),
});

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

export const holeOpenMeteo: WetterHolen = async (breite, laenge) => {
  const url = new URL(`https://${HOST}/v1/forecast`);
  url.search = new URLSearchParams({
    latitude: String(breite),
    longitude: String(laenge),
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max",
    timezone: "Europe/Zurich",
    wind_speed_unit: "kmh",
    past_days: "2",
    forecast_days: "16",
  }).toString();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
    redirect: "error",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Wetterdienst antwortet ${res.status}`);
  const d = antwort.parse(JSON.parse(await leseGedeckelt(res))).daily;
  return d.time.map((datum, i) => ({
    datum,
    code: d.weather_code[i] ?? null,
    tmax: d.temperature_2m_max[i] ?? null,
    tmin: d.temperature_2m_min[i] ?? null,
    regen: d.precipitation_sum[i] ?? null,
    boeen: d.wind_gusts_10m_max[i] ?? null,
  }));
};

// Beide Dienste, die das Wetter braucht: die Vorhersage und die Ortssuche (#694). Die Tests spritzen Attrappen ein, damit kein Abruf ins Netz geht
export type Wetterdienst = { holen: WetterHolen; suchen: OrtSuchen };
export const openMeteo: Wetterdienst = {
  holen: holeOpenMeteo,
  suchen: sucheOpenMeteo,
};
