import {
  sichtbarFuer,
  sichtbarkeitAusSpalten,
  type SichtPerson,
  type SichtRollen,
  type Gruppe,
} from "../sichtbarkeit.js";
import type { Sichtbarkeit } from "../sichtbarkeit.js";

// Menü für Angemeldete (#795): Seiten, die nicht öffentlich sind, stehen nie in den statischen Dateien (Menü, Sitemap, Weiterleitungen). Dieser Teil liefert sie nur für eine Person mit Sitzung,
// genau die, die sie laut Sichtbarkeit sehen darf, und nur mit Titel, Adresse und Position. Die Position folgt der statischen Navigation (website/abgleich.ts baueNavigation): Elternseite und Reihenfolge nach `reihenfolge`, dann Adresse.
// Reine Funktion ohne Datenbank; die Route (routes/website/navigation.ts) lädt die Zeilen und die Tags der Person.

export type NavZeile = {
  id: string;
  elternId: string | null;
  adresse: string;
  titel: string;
  reihenfolge: number;
  sichtbarkeit: Sichtbarkeit["art"];
  sichtbarkeitTags: string[];
  sichtbarkeitRollen: SichtRollen;
  veroeffentlichteVersionId: string | null;
};

// eltern: Adresse der nächsten Elternseite, die im Menü steht (öffentlich oder für die Person sichtbar), sonst null (oberste Ebene).
// davor: Adresse der öffentlichen Geschwisterseite, vor der der Eintrag steht, sonst null (ans Ende). Beides sind Adressen, die die Person im Menü schon kennt oder die sie selbst sehen darf
export type NavEintrag = {
  pfad: string;
  titel: string;
  eltern: string | null;
  davor: string | null;
};

const MAX_EINTRAEGE = 200;
const SCHUTZ = 100;

const vergleiche = (a: NavZeile, b: NavZeile) =>
  a.reihenfolge - b.reihenfolge || a.adresse.localeCompare(b.adresse);

// pfadVon: Adresse der Seite im Netz, null wenn sie nie ausgeliefert wird (ungültige oder reservierte Adresse); ausgenommen: Seiten, die nicht im Menü stehen (Impressum, Datenschutz)
export function baueGeschuetzteNavigation(
  zeilen: NavZeile[],
  abteilungId: string,
  person: SichtPerson & { gruppen: readonly Gruppe[] },
  pfadVon: (id: string) => string | null,
  nichtImMenue: ReadonlySet<string> = new Set(),
): NavEintrag[] {
  const nachId = new Map(zeilen.map((z) => [z.id, z]));
  const pfade = new Map<string, string>();
  for (const z of zeilen) {
    const p = z.veroeffentlichteVersionId ? pfadVon(z.id) : null;
    if (p && p !== "/") pfade.set(z.id, p);
  }
  const oeffentlich = new Set(
    zeilen
      .filter(
        (z) =>
          z.sichtbarkeit === "oeffentlich" &&
          pfade.has(z.id) &&
          !nichtImMenue.has(pfade.get(z.id)!),
      )
      .map((z) => z.id),
  );
  // Nur Seiten, die nicht öffentlich sind und die diese Person sehen darf; die Entscheidung ist dieselbe wie beim Nachladen der Bausteine
  const geschuetzt = zeilen.filter(
    (z) =>
      z.sichtbarkeit !== "oeffentlich" &&
      pfade.has(z.id) &&
      sichtbarFuer(person, {
        abteilungId,
        sichtbarkeit: sichtbarkeitAusSpalten(z),
      }),
  );
  const sichtbar = new Set(geschuetzt.map((z) => z.id));

  const vorfahrin = (z: NavZeile, gilt: (id: string) => boolean) => {
    for (
      let e = z.elternId ? nachId.get(z.elternId) : undefined, n = 0;
      e && n < SCHUTZ;
      e = e.elternId ? nachId.get(e.elternId) : undefined, n++
    ) {
      if (gilt(e.id)) return e.id;
    }
    return null;
  };
  // Öffentliche Seiten hängen wie in der statischen Navigation an der nächsten öffentlichen Vorfahrin; geschützte an der nächsten Vorfahrin, die im Menü steht
  const imMenue = (id: string) => oeffentlich.has(id) || sichtbar.has(id);
  const elternVon = new Map(
    geschuetzt.map((z) => [z.id, vorfahrin(z, imMenue)]),
  );
  const oeffentlicheKinder = new Map<string | null, NavZeile[]>();
  for (const z of zeilen) {
    if (!oeffentlich.has(z.id)) continue;
    const e = vorfahrin(z, (id) => oeffentlich.has(id));
    oeffentlicheKinder.set(e, [...(oeffentlicheKinder.get(e) ?? []), z]);
  }
  const geschuetzteKinder = new Map<string | null, NavZeile[]>();
  for (const z of geschuetzt) {
    const e = elternVon.get(z.id)!;
    geschuetzteKinder.set(e, [...(geschuetzteKinder.get(e) ?? []), z]);
  }

  const aus: NavEintrag[] = [];
  const gehe = (eltern: string | null, tiefe: number) => {
    if (tiefe > 10) return;
    const geschwister = [
      ...(oeffentlicheKinder.get(eltern) ?? []),
      ...(geschuetzteKinder.get(eltern) ?? []),
    ].sort(vergleiche);
    geschwister.forEach((z, i) => {
      if (!sichtbar.has(z.id)) return;
      const naechste = geschwister
        .slice(i + 1)
        .find((g) => oeffentlich.has(g.id));
      aus.push({
        pfad: pfade.get(z.id)!,
        titel: z.titel,
        eltern: eltern === null ? null : pfade.get(eltern)!,
        davor: naechste ? pfade.get(naechste.id)! : null,
      });
      gehe(z.id, tiefe + 1);
    });
  };
  // Die Wurzel und jede öffentliche Seite mit geschützten Kindern: Eltern zuerst, damit das Skript die Elternseite schon kennt
  const wurzeln: (string | null)[] = [
    null,
    ...zeilen.filter((z) => oeffentlich.has(z.id)).map((z) => z.id),
  ];
  for (const w of wurzeln) {
    if (w === null) gehe(null, 0);
    else if ((geschuetzteKinder.get(w) ?? []).length > 0) gehe(w, 0);
  }
  return aus.slice(0, MAX_EINTRAEGE);
}
