import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ceviDbEinstellung, kind, user } from "../db/schema.js";
import { keinKindKonto } from "../kind-konto.js";
import { log } from "../log.js";
import type { CeviDbDienst } from "./dienst.js";
import type { CeviPerson } from "./felder.js";
import {
  uebernehmeGeschlecht,
  uebernehmeGeschlechtFuerKonto,
} from "./geschlecht.js";
import { anfrageVonKonto } from "./vorschlag.js";
import { normal, ordneZu } from "./zuordnung.js";

// Täglicher Abgleich der Konten mit der Cevi-Datenbank (#857): Jedes Konto der Abteilung ohne gemerkte Nummer bekommt sie bei einem eindeutigen Treffer nach den Regeln der Anmeldung (cevi-db/zuordnung.ts, Regeln 1 bis 3), danach folgt das Geschlecht der Cevi-Datenbank (cevi-db/geschlecht.ts). Nie das Konto eines Kindes, nie eine gemerkte Nummer überschreiben. Ins Log kommen nur Zählwerte.
// Regel 4 «Vorname plus Nachname» übernimmt nur das Geschlecht und merkt keine Nummer: Die Anmeldung füllt mit der gemerkten Nummer Adresse, Telefon und Geburtsdatum vor, und die dürfen nie von einer gleichnamigen anderen Person kommen. Der Abgleich prüft die Regel darum jeden Tag neu.

export type Zaehler = {
  // Nummer gemerkt (Regeln 1 bis 3)
  zugeordnet: number;
  // Nur über Vorname plus Nachname, ohne Nummer (Regel 4)
  perName: number;
  geaendert: number;
  mehrdeutig: number;
  keinTreffer: number;
};

export async function gleicheAb(
  db: Db,
  dienst: CeviDbDienst,
  abteilungId: string,
): Promise<Zaehler | null> {
  const ergebnis = await dienst.personen(abteilungId);
  // Den Fehler meldet der Dienst schon (nur die Art)
  if (!ergebnis.ok) return null;
  const konten = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      ceviDbId: user.ceviDbId,
      kindId: kind.id,
    })
    .from(user)
    .leftJoin(kind, eq(kind.userId, user.id))
    .where(eq(user.abteilungId, abteilungId));
  // Regel 4 zählt alle Konten der Abteilung, auch die von Kindern: Gleich heissen ist gleich heissen
  const schluessel = (name: string) => {
    const a = anfrageVonKonto({ name, email: "", ceviDbId: null });
    return a.nachname ? `${normal(a.vorname)} ${normal(a.nachname)}` : "";
  };
  const gleicheNamen = new Map<string, number>();
  for (const k of konten) {
    const s = schluessel(k.name);
    gleicheNamen.set(s, (gleicheNamen.get(s) ?? 0) + 1);
  }
  const vergeben = new Set(konten.flatMap((k) => k.ceviDbId ?? []));
  const zaehler: Zaehler = {
    zugeordnet: 0,
    perName: 0,
    geaendert: 0,
    mehrdeutig: 0,
    keinTreffer: 0,
  };
  const treffer = new Map<
    string,
    { person: CeviPerson; konten: { id: string; perName: boolean }[] }
  >();
  for (const k of konten) {
    if (k.ceviDbId || k.kindId) continue;
    const anfrage = anfrageVonKonto(k);
    const regeln = ordneZu(ergebnis.personen, anfrage);
    const z =
      regeln.art === "keiner"
        ? ordneZu(
            ergebnis.personen,
            anfrage,
            gleicheNamen.get(schluessel(k.name)),
          )
        : regeln;
    if (z.art === "keiner") zaehler.keinTreffer += 1;
    else if (z.art === "mehrdeutig") zaehler.mehrdeutig += 1;
    else {
      const t = treffer.get(z.person.id) ?? { person: z.person, konten: [] };
      t.konten.push({ id: k.id, perName: regeln.art === "keiner" });
      treffer.set(z.person.id, t);
    }
  }
  for (const [nummer, { person, konten: ids }] of treffer) {
    // Eine Person der Cevi-Datenbank gehört zu höchstens einem Konto: schon vergeben oder mehrfach getroffen ist mehrdeutig
    if (ids.length > 1 || vergeben.has(nummer)) {
      zaehler.mehrdeutig += ids.length;
      continue;
    }
    const konto = ids[0]!;
    if (konto.perName) {
      zaehler.perName += 1;
      zaehler.geaendert += await uebernehmeGeschlechtFuerKonto(
        db,
        abteilungId,
        konto.id,
        person.geschlecht,
      );
      continue;
    }
    const zeilen = await db
      .update(user)
      .set({ ceviDbId: nummer })
      .where(
        and(
          eq(user.id, konto.id),
          isNull(user.ceviDbId),
          keinKindKonto(user.id),
        ),
      )
      .returning({ id: user.id });
    zaehler.zugeordnet += zeilen.length;
  }
  zaehler.geaendert += await uebernehmeGeschlecht(
    db,
    abteilungId,
    ergebnis.personen,
  );
  return zaehler;
}

// Alle Abteilungen, deren Gruppe unter Verwaltung > System > Cevi-Datenbank eingetragen ist
export async function gleicheAlleAb(db: Db, dienst: CeviDbDienst) {
  const abteilungen = await db
    .select({ id: ceviDbEinstellung.abteilungId })
    .from(ceviDbEinstellung)
    .where(isNotNull(ceviDbEinstellung.gruppeId));
  for (const { id } of abteilungen) {
    try {
      const z = await gleicheAb(db, dienst, id);
      if (z) log(undefined, { ereignis: "cevi_db_abgleich", ...z });
    } catch {
      // Nur dass es scheiterte; die nächste Abteilung und der nächste Lauf versuchen es wieder
      log(undefined, { ereignis: "cevi_db_abgleich", code: "fehler" });
    }
  }
}

export const ABGLEICH_VERZOEGERUNG_MS = 60_000;
export const ABGLEICH_TAKT_MS = 24 * 60 * 60 * 1000;

// Eine Minute nach dem Start (der Start wartet nicht darauf), danach alle 24 Stunden; ein Lauf, der noch arbeitet, wird nicht überholt
export function starteCeviDbAbgleich(lauf: () => Promise<unknown>) {
  let laeuft = false;
  const starte = () => {
    if (laeuft) return;
    laeuft = true;
    void lauf()
      .catch(() =>
        log(undefined, { ereignis: "cevi_db_abgleich", code: "fehler" }),
      )
      .finally(() => {
        laeuft = false;
      });
  };
  const start = setTimeout(starte, ABGLEICH_VERZOEGERUNG_MS);
  const takt = setInterval(starte, ABGLEICH_TAKT_MS);
  return () => {
    clearTimeout(start);
    clearInterval(takt);
  };
}
