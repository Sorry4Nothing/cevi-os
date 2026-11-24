import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { wetterCache } from "../db/schema.js";
import { rundeOrt } from "./wetter-geocoding.js";
import type {
  WetterHolen,
  WetterTag,
  Wetterdienst,
} from "./wetter-openmeteo.js";
import {
  mussSuchen,
  sucheWetterOrt,
  wetterOrt,
  type LagerOrt,
  type WetterOrt,
} from "./wetter-ort.js";

// Wetter für das Lager (#391). Den Ort bestimmt der Server aus dem Lagerort (wetter-ort.ts, #694), niemand gibt Koordinaten ein. Der Server holt die Vorhersage für den Ort des Lagers beim Wetterdienst (wetter-openmeteo.ts) und hält sie je Lager in wetter_cache: höchstens ein Abruf je Lager und WETTER_STUNDEN, egal wie viele Mitglieder und Aufrufe. Kein Polling: Der Abruf geschieht beim Lesen, wenn der Stand zu alt ist. Fällt der Dienst aus, gibt es höchstens WETTER_STAND_MAX_STUNDEN alte Werte, danach kein Wetter statt eines Fehlers, und der nächste Versuch kommt frühestens nach NEUER_VERSUCH_MINUTEN.
export const WETTER_STUNDEN = 6;
export const NEUER_VERSUCH_MINUTEN = 15;
export const WETTER_STAND_MAX_STUNDEN = 24;
// Schwellen der Warnungen (Entscheid vom 22.11.2026): Gewitter, Böen ab 60 km/h, Hitze ab 30 Grad, Regen ab 20 mm am Tag
export const SCHWELLEN = { boeen: 60, hitze: 30, regen: 20 } as const;

export type Warnung = "gewitter" | "boeen" | "hitze" | "regen";

// WMO-Wettercode in ein Wort für die Anzeige; die App wählt das Symbol dazu
export function zustand(code: number | null): string | null {
  if (code === null) return null;
  if (code === 0) return "Klar";
  if (code <= 2) return "Teils bewölkt";
  if (code === 3) return "Bedeckt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Nieselregen";
  if (code >= 61 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Regenschauer";
  if (code === 85 || code === 86) return "Schneeschauer";
  if (code >= 95 && code <= 99) return "Gewitter";
  return null;
}

export function warnungen(t: WetterTag): Warnung[] {
  const w: Warnung[] = [];
  if (t.code !== null && t.code >= 95) w.push("gewitter");
  if (t.boeen !== null && t.boeen >= SCHWELLEN.boeen) w.push("boeen");
  if (t.tmax !== null && t.tmax >= SCHWELLEN.hitze) w.push("hitze");
  if (t.regen !== null && t.regen >= SCHWELLEN.regen) w.push("regen");
  return w;
}

export const wetterTagAnsicht = (t: WetterTag) => ({
  ...t,
  zustand: zustand(t.code),
  warnungen: warnungen(t),
});
export type WetterTagAnsicht = ReturnType<typeof wetterTagAnsicht>;

type Leseschreiber = Pick<Db, "select" | "insert" | "update">;

type Stand = { tage: WetterTag[]; stand: Date };

// Läuft schon ein Abruf für dieses Lager (gleichzeitige Anfragen im selben Prozess), warten alle auf ihn: ein Abruf statt vieler. shortcut: gilt je Prozess; bei mehreren Instanzen holt jede einmal je Frist, für die Last von rund 100 Personen je Lager unkritisch
const laufend = new Map<string, Promise<Stand | undefined>>();

const stunden = (von: Date, bis: Date) =>
  (bis.getTime() - von.getTime()) / 3_600_000;

// Die gespeicherten Tage, wenn es welche gibt und sie nicht zu alt sind
function gespeichert(
  zeile: typeof wetterCache.$inferSelect | undefined,
  jetzt: Date,
): Stand | undefined {
  if (
    !zeile?.abgerufenAm ||
    stunden(zeile.abgerufenAm, jetzt) > WETTER_STAND_MAX_STUNDEN ||
    !Array.isArray(zeile.tage)
  ) {
    return undefined;
  }
  return { tage: zeile.tage as WetterTag[], stand: zeile.abgerufenAm };
}

async function holeUndSpeichere(
  db: Leseschreiber,
  lager: { id: string; breite: number; laenge: number },
  holen: WetterHolen,
  jetzt: Date,
  zeile: typeof wetterCache.$inferSelect | undefined,
  gleichOrt: boolean,
): Promise<Stand | undefined> {
  try {
    const tage = await holen(lager.breite, lager.laenge);
    const werte = {
      breite: lager.breite,
      laenge: lager.laenge,
      abgerufenAm: jetzt,
      versuchAm: jetzt,
      tage,
    };
    await db
      .insert(wetterCache)
      .values({ lagerId: lager.id, ...werte })
      .onConflictDoUpdate({ target: wetterCache.lagerId, set: werte });
    return { tage, stand: jetzt };
  } catch {
    // Der Fehlertext bleibt aus dem Protokoll: Er könnte die Adresse mit dem Ort enthalten. Gemerkt wird nur der Versuch; bei neuem Ort ist der alte Stand ungültig
    if (gleichOrt) {
      await db
        .update(wetterCache)
        .set({ versuchAm: jetzt })
        .where(eq(wetterCache.lagerId, lager.id));
      return gespeichert(zeile, jetzt);
    }
    const werte = {
      breite: lager.breite,
      laenge: lager.laenge,
      abgerufenAm: null,
      versuchAm: jetzt,
      tage: [],
    };
    await db
      .insert(wetterCache)
      .values({ lagerId: lager.id, ...werte })
      .onConflictDoUpdate({ target: wetterCache.lagerId, set: werte });
    return undefined;
  }
}

// Liest den Zwischenspeicher (eine Abfrage). «aktuell»: Der Ort stimmt und entweder ist der Stand frisch oder der letzte Versuch noch keine NEUER_VERSUCH_MINUTEN her
async function lies(
  db: Leseschreiber,
  abruf: { id: string; breite: number; laenge: number },
  jetzt: Date,
) {
  const [zeile] = await db
    .select()
    .from(wetterCache)
    .where(eq(wetterCache.lagerId, abruf.id));
  const gleichOrt =
    zeile !== undefined &&
    zeile.breite === abruf.breite &&
    zeile.laenge === abruf.laenge;
  const frisch =
    gleichOrt &&
    zeile.abgerufenAm !== null &&
    stunden(zeile.abgerufenAm, jetzt) < WETTER_STUNDEN;
  const gesperrt =
    gleichOrt && stunden(zeile.versuchAm, jetzt) * 60 < NEUER_VERSUCH_MINUTEN;
  return { zeile, gleichOrt, aktuell: frisch || gesperrt };
}

// Das Wetter des Lagers: Ist der Ort noch nicht bestimmt (neu oder geändert), sucht der Server ihn zuerst aus dem Lagerort. Dann eine Abfrage auf den Zwischenspeicher, nur bei zu altem Stand ein Abruf und ein Schreibvorgang. Ohne gefundenen Ort oder bei Ausfall der Dienste eine leere Liste, nie ein Fehler
export async function ladeWetter(
  db: Leseschreiber,
  lager: LagerOrt,
  dienst: Wetterdienst,
  jetzt = new Date(),
): Promise<{
  ort: WetterOrt;
  stand: Date | null;
  tage: WetterTagAnsicht[];
}> {
  const holen = dienst.holen;
  if (mussSuchen(lager, jetzt)) {
    lager = await sucheWetterOrt(db, lager, dienst.suchen, jetzt);
  }
  const ort = wetterOrt(lager);
  if (
    ort.status !== "gefunden" ||
    lager.breite === null ||
    lager.laenge === null
  ) {
    return { ort, stand: null, tage: [] };
  }
  const abruf = {
    id: lager.id,
    breite: rundeOrt(lager.breite),
    laenge: rundeOrt(lager.laenge),
  };
  const stand = await lies(db, abruf, jetzt);
  let ergebnis: Stand | undefined;
  if (stand.aktuell) {
    ergebnis = gespeichert(stand.zeile, jetzt);
  } else {
    let lauf = laufend.get(lager.id);
    if (!lauf) {
      // Im Abruf liest der Server den Zwischenspeicher noch einmal: Ein Aufruf, der vor dem Abruf eines anderen las und erst danach hierher kommt, holt nicht ein zweites Mal
      lauf = (async () => {
        const jetztStand = await lies(db, abruf, jetzt);
        if (jetztStand.aktuell) return gespeichert(jetztStand.zeile, jetzt);
        return holeUndSpeichere(
          db,
          abruf,
          holen,
          jetzt,
          jetztStand.zeile,
          jetztStand.gleichOrt,
        );
      })().finally(() => laufend.delete(lager.id));
      laufend.set(lager.id, lauf);
    }
    ergebnis = await lauf;
  }
  return {
    ort,
    stand: ergebnis?.stand ?? null,
    tage: (ergebnis?.tage ?? []).map(wetterTagAnsicht),
  };
}
