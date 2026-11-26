import {
  CeviDbFehler,
  type CeviDbClient,
  type CeviDbFehlerArt,
} from "./client.js";
import type { CeviPerson } from "./felder.js";
import { log } from "../log.js";

// Die Personen der eigenen Ebene aus der Cevi-Datenbank, nur im Arbeitsspeicher (#691): höchstens 15 Minuten, nie in der Datenbank, nie auf der Platte. Ein Neustart leert alles. Parallele Abrufe teilen sich eine Anfrage (Sperre), damit eine Welle von Anmeldungen die Cevi-Datenbank nicht belastet. Ein Fehler wird kurz gemerkt, damit ein Ausfall nicht bei jedem Aufruf neu anklopft.
// shortcut: ein Zwischenspeicher je Prozess und Abteilung; mehrere API-Instanzen holen getrennt. Reicht für eine Instanz, bei mehreren in einen gemeinsamen Speicher.

export const GUELTIG_MS = 15 * 60_000;
export const FEHLER_MERKEN_MS = 60_000;
// Eine Abteilung hat einen Eintrag; die Grenze schützt nur vor einem Fehler im Aufrufer
const MAX_EINTRAEGE = 10;

type Fehler = { ok: false; art: CeviDbFehlerArt };
export type Ergebnis = { ok: true; personen: readonly CeviPerson[] } | Fehler;

export interface CeviDbDienst {
  personen(abteilungId: string): Promise<Ergebnis>;
  pruefe(
    gruppeId: string | null,
  ): Promise<{ ok: true; gruppe: boolean | null } | Fehler>;
}

export function erstelleCeviDbDienst({
  client,
  jetzt = Date.now,
  // Hält Stand und Anzahl fest (Verwaltung > System > Cevi-Datenbank); nie ein Text der Gegenseite
  beiAbruf,
  // Nach jedem erfolgreichen Abruf: Geschlecht der zugeordneten Konten übernehmen (#843)
  beiPersonen,
}: {
  client: CeviDbClient;
  jetzt?: () => number;
  beiAbruf?: (
    abteilungId: string,
    stand: { ok: boolean; anzahl: number | null },
  ) => Promise<void>;
  beiPersonen?: (
    abteilungId: string,
    personen: readonly CeviPerson[],
  ) => Promise<void>;
}): CeviDbDienst {
  const gespeichert = new Map<string, { bis: number; ergebnis: Ergebnis }>();
  const laufend = new Map<string, Promise<Ergebnis>>();

  const aufFehler = (f: unknown): Fehler => {
    const art = f instanceof CeviDbFehler ? f.art : "antwort";
    // Nur die Art, nie Adresse, Token oder Text der Antwort
    log(undefined, { ereignis: "cevi_db_abruf_fehler", art });
    return { ok: false, art };
  };

  async function hole(abteilungId: string): Promise<Ergebnis> {
    let ergebnis: Ergebnis;
    try {
      ergebnis = { ok: true, personen: await client.personen() };
    } catch (f) {
      ergebnis = aufFehler(f);
    }
    if (gespeichert.size >= MAX_EINTRAEGE && !gespeichert.has(abteilungId)) {
      gespeichert.delete(gespeichert.keys().next().value!);
    }
    gespeichert.set(abteilungId, {
      bis: jetzt() + (ergebnis.ok ? GUELTIG_MS : FEHLER_MERKEN_MS),
      ergebnis,
    });
    try {
      await beiAbruf?.(abteilungId, {
        ok: ergebnis.ok,
        anzahl: ergebnis.ok ? ergebnis.personen.length : null,
      });
    } catch {
      // Der Stand ist eine Anzeige: Fällt sie aus, bleibt die Anmeldung unberührt
    }
    if (ergebnis.ok) {
      try {
        await beiPersonen?.(abteilungId, ergebnis.personen);
      } catch {
        // Wie beim Stand: Die Anmeldung hängt nicht davon ab, der nächste Abruf versucht es wieder
        log(undefined, { ereignis: "cevi_db_geschlecht_fehler" });
      }
    }
    return ergebnis;
  }

  return {
    personen(abteilungId) {
      const alt = gespeichert.get(abteilungId);
      if (alt && alt.bis > jetzt()) return Promise.resolve(alt.ergebnis);
      let l = laufend.get(abteilungId);
      if (!l) {
        l = hole(abteilungId).finally(() => laufend.delete(abteilungId));
        laufend.set(abteilungId, l);
      }
      return l;
    },
    async pruefe(gruppeId) {
      try {
        return { ok: true, ...(await client.pruefe(gruppeId)) };
      } catch (f) {
        return aufFehler(f);
      }
    },
  };
}
