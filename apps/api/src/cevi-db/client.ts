import { z } from "zod";
import type { CeviPerson } from "./felder.js";

// Lesender Abruf der Cevi-Datenbank (hitobito, JSON:API) mit dem Dienstkonto-Token der Abteilung (#691). Nur der Server ruft sie ab; das Token steht nur in der Umgebung und nie in einer Antwort, einem Log, einem Fehlertext oder dem Audit. Nur lesen: Es gibt hier kein Schreiben.
// Grenzen wie beim Wetter (lager/wetter-openmeteo.ts): festes Zeitlimit, keine Weiterleitung, gedeckelte Antwort, Schema-Prüfung, nur die Felder der Allowlist.

// --- Weiche Annahmen: an einer Stelle, damit die erste Prüfung mit der echten Instanz sie leicht anpasst.
// Belegt in der hitobito-Doku (json_api.md, service_accounts.md); nicht belegt für die Instanz der Cevi (siehe docs/cevi-db-einrichten.md).
export const ANNAHMEN = {
  // Personen, die das Token sieht («Personen dieser Ebene»); die Ebene bestimmt das Token, nicht eine Anfrage
  pfadPersonen: "/api/people",
  // Eine Gruppe lesen, um die Verbindung und die Gruppen-ID zu prüfen
  pfadGruppe: (id: string) => `/api/groups/${encodeURIComponent(id)}`,
  kopfToken: "X-TOKEN",
  // Telefonnummern liegen in einer Beziehung und kommen mit «include»
  include: "phone_numbers",
  seitenGroesse: 100,
  // Mehr Seiten gelten als Fehler und nie als «alle Personen»: Mit einer abgeschnittenen Liste wäre «eindeutig» nicht mehr sicher
  maxSeiten: 40,
} as const;

export const ZEITLIMIT_MS = 5_000;
export const MAX_BYTES_SEITE = 1024 * 1024;

export type CeviDbFehlerArt = "nicht_erreichbar" | "abgelehnt" | "antwort";
// Der Text ist fest und nennt weder Adresse noch Token noch eine Antwort der Gegenseite
export class CeviDbFehler extends Error {
  constructor(readonly art: CeviDbFehlerArt) {
    super(`Cevi-Datenbank: ${art}`);
    this.name = "CeviDbFehler";
  }
}

export type CeviDbKonfig = { url: string; token: string };
export type Holen = typeof fetch;

export interface CeviDbClient {
  personen(): Promise<CeviPerson[]>;
  // Prüft Verbindung und Token; mit gruppeId zusätzlich, ob das Token diese Gruppe sieht
  pruefe(gruppeId: string | null): Promise<{ gruppe: boolean | null }>;
}

const idSchema = z
  .union([z.string().min(1).max(40), z.number().int()])
  .transform(String);
const text = z.string().nullish();
// Das Schema ist nicht strikt: Unbekannte Felder verwirft zod beim Parsen, übrig bleibt die Allowlist
const personSchema = z.object({
  id: idSchema,
  attributes: z.object({
    first_name: text,
    last_name: text,
    email: text,
    birthday: text,
    address: text,
    zip_code: z.union([z.string(), z.number()]).nullish(),
    town: text,
  }),
  relationships: z
    .object({
      phone_numbers: z
        .object({ data: z.array(z.object({ id: idSchema })).max(50) })
        .optional(),
    })
    .optional(),
});
const seiteSchema = z.object({
  data: z.array(personSchema).max(ANNAHMEN.seitenGroesse * 5),
  included: z
    .array(
      z.object({
        id: idSchema,
        type: z.string(),
        attributes: z.object({ number: text }).optional(),
      }),
    )
    .max(5000)
    .optional(),
});

// Steuerzeichen raus, begrenzt, leer = null
const sauber = (wert: string | number | null | undefined, max = 200) => {
  if (wert === null || wert === undefined) return null;
  const t = String(wert)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return t.length > 0 ? t : null;
};
const datum = (wert: string | null | undefined) =>
  wert && /^\d{4}-\d{2}-\d{2}$/.test(wert) ? wert : null;

// Liest den Körper höchstens bis MAX_BYTES_SEITE; mehr ist ein Fehler
async function leseGedeckelt(res: Response): Promise<string> {
  if (!res.body) throw new CeviDbFehler("antwort");
  const leser = res.body.getReader();
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > MAX_BYTES_SEITE) {
      await leser.cancel();
      throw new CeviDbFehler("antwort");
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

export function erstelleCeviDbClient({
  url,
  token,
  holen = fetch,
}: CeviDbKonfig & { holen?: Holen }): CeviDbClient {
  // Eine Anfrage: Zeitlimit, keine Weiterleitung. Jede Störung wird zu einem festen Fehler ohne Text der Gegenseite
  async function abruf(pfad: string, suche: Record<string, string> = {}) {
    const ziel = new URL(pfad, url);
    ziel.search = new URLSearchParams(suche).toString();
    let res: Response;
    try {
      res = await holen(ziel, {
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
        redirect: "error",
        headers: {
          accept: "application/vnd.api+json",
          [ANNAHMEN.kopfToken]: token,
        },
      });
    } catch {
      throw new CeviDbFehler("nicht_erreichbar");
    }
    if (res.status === 401 || res.status === 403)
      throw new CeviDbFehler("abgelehnt");
    if (!res.ok) throw new CeviDbFehler("nicht_erreichbar");
    try {
      return JSON.parse(await leseGedeckelt(res)) as unknown;
    } catch (f) {
      throw f instanceof CeviDbFehler ? f : new CeviDbFehler("antwort");
    }
  }

  return {
    async personen() {
      const alle = new Map<string, CeviPerson>();
      for (let seite = 1; seite <= ANNAHMEN.maxSeiten; seite++) {
        const roh = await abruf(ANNAHMEN.pfadPersonen, {
          include: ANNAHMEN.include,
          "page[number]": String(seite),
          "page[size]": String(ANNAHMEN.seitenGroesse),
        });
        const geprueft = seiteSchema.safeParse(roh);
        if (!geprueft.success) throw new CeviDbFehler("antwort");
        const { data, included = [] } = geprueft.data;
        const nummern = new Map(
          included
            .filter((i) => i.type === "phone_numbers")
            .map((i) => [i.id, sauber(i.attributes?.number, 40)]),
        );
        let neu = 0;
        for (const p of data) {
          if (alle.has(p.id)) continue;
          neu++;
          const a = p.attributes;
          const telefon = (p.relationships?.phone_numbers?.data ?? [])
            .map((n) => nummern.get(n.id) ?? null)
            .find((n) => n !== null);
          alle.set(p.id, {
            id: p.id,
            vorname: sauber(a.first_name, 100) ?? "",
            nachname: sauber(a.last_name, 100) ?? "",
            email: sauber(a.email, 200)?.toLowerCase() ?? null,
            geburtsdatum: datum(a.birthday),
            telefon: telefon ?? null,
            strasse: sauber(a.address, 200),
            plz: sauber(a.zip_code, 20),
            ort: sauber(a.town, 100),
          });
        }
        // Eine leere Seite oder eine ohne neue Person (die Gegenseite ignoriert die Seitenzahl) beendet den Abruf
        if (neu === 0) return [...alle.values()];
        if (seite === ANNAHMEN.maxSeiten) throw new CeviDbFehler("antwort");
      }
      return [...alle.values()];
    },

    async pruefe(gruppeId) {
      if (gruppeId === null) {
        // Ohne Gruppe prüft schon eine einzelne kleine Seite Adresse und Token
        await abruf(ANNAHMEN.pfadPersonen, { "page[size]": "1" });
        return { gruppe: null };
      }
      try {
        await abruf(ANNAHMEN.pfadGruppe(gruppeId));
        return { gruppe: true };
      } catch (f) {
        // Die Gruppe ist unbekannt oder verboten: Die Verbindung selbst prüft dann eine einzelne Seite
        if (f instanceof CeviDbFehler && f.art === "nicht_erreichbar") {
          await abruf(ANNAHMEN.pfadPersonen, { "page[size]": "1" });
          return { gruppe: false };
        }
        throw f;
      }
    },
  };
}
