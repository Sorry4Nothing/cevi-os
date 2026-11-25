import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, outlookKategorie, tag } from "../db/schema.js";
import { OutlookFehler } from "./fehler.js";
import type { OutlookKalender } from "./graph.js";
import { farbeFuer, kategorieName, schluessel } from "./kategorien-regeln.js";

export type KategorienErgebnis = {
  angelegt: number;
  entfernt: number;
  // Tag-Namen, die Outlook nicht annähme (Komma, zu lang): keine Kategorie dazu
  uebersprungen: number;
};

// Führt die Kategorienliste des Postfachs den Tags nach (#835). Zustandsbasiert statt Befehl für Befehl: Aus Tags, Liste in Outlook und der Liste der selbst angelegten Kategorien ergibt sich die Differenz; ein Wiederholen schreibt darum nie doppelt. Anlegen, Umbenennen und Löschen eines Tags sind derselbe Lauf: Der neue Name fehlt in Outlook (anlegen), der alte Name ist ein von Cevi OS angelegter ohne Tag (entfernen).
// Nie gelöscht wird eine Kategorie, die Cevi OS nicht selbst angelegt hat, und keine, die inzwischen eine andere ID trägt als die angelegte. Bei einem Teilausfall bleibt, was gelang (die Liste der selbst angelegten wird je Schritt geschrieben); der erste Fehler wird nach den übrigen Versuchen geworfen, ein nächster Lauf macht den Rest.
export async function gleicheKategorienAb(
  db: Db,
  client: OutlookKalender,
  abteilungId: string,
  akteurId: string,
): Promise<KategorienErgebnis> {
  const tags = await db
    .select({ name: tag.name, typ: tag.typ })
    .from(tag)
    .where(eq(tag.abteilungId, abteilungId));
  const soll = new Map<string, { name: string; typ: string }>();
  let uebersprungen = 0;
  for (const t of tags) {
    const name = kategorieName(t.name);
    if (name === null) uebersprungen++;
    else soll.set(schluessel(name), { name, typ: t.typ });
  }
  const vorhanden = new Map(
    (await client.listeKategorien()).map((k) => [schluessel(k.name), k]),
  );
  const eigene = await db
    .select()
    .from(outlookKategorie)
    .where(eq(outlookKategorie.abteilungId, abteilungId));

  const ergebnis: KategorienErgebnis = {
    angelegt: 0,
    entfernt: 0,
    uebersprungen,
  };
  let erster: unknown;
  const merke = (fehler: unknown) => {
    erster ??= fehler;
  };

  for (const [s, t] of soll) {
    if (vorhanden.has(s)) continue;
    try {
      const neu = await client.legeKategorieAn(t.name, farbeFuer(t.typ));
      // null: Zwischenzeitlich hat jemand sie angelegt; sie gehört dann nicht Cevi OS
      if (neu) {
        await db
          .insert(outlookKategorie)
          .values({
            abteilungId,
            nameKlein: s,
            name: t.name,
            outlookId: neu.id,
          })
          .onConflictDoUpdate({
            target: [outlookKategorie.abteilungId, outlookKategorie.nameKlein],
            set: { name: t.name, outlookId: neu.id },
          });
        ergebnis.angelegt++;
      }
    } catch (fehler) {
      merke(fehler);
      // Ohne Zugang oder bei Drosselung hilft auch der nächste Versuch nichts
      if (fehler instanceof OutlookFehler && !fehler.dauerhaft) break;
    }
  }

  for (const e of eigene) {
    if (soll.has(e.nameKlein)) continue;
    const draussen = vorhanden.get(e.nameKlein);
    try {
      // Nur die eigene, noch gleiche Kategorie; fehlt sie schon, bleibt nur die Buchführung zu räumen
      if (draussen && draussen.id === e.outlookId) {
        await client.loescheKategorie(e.outlookId);
        ergebnis.entfernt++;
      }
      await db
        .delete(outlookKategorie)
        .where(
          and(
            eq(outlookKategorie.abteilungId, abteilungId),
            eq(outlookKategorie.nameKlein, e.nameKlein),
          ),
        );
    } catch (fehler) {
      merke(fehler);
      if (fehler instanceof OutlookFehler && !fehler.dauerhaft) break;
    }
  }
  // Audit-Eintrag für den Schreibvorgang, auch bei Teilausfall: wer ihn ausgelöst hat und wie viele, nie Namen (SR-52)
  if (ergebnis.angelegt + ergebnis.entfernt > 0) {
    await db.insert(auditLog).values({
      abteilungId,
      akteurId,
      aktion: "outlook_kategorien_geschrieben",
      zielTyp: "abteilung",
      zielId: abteilungId,
      details: { angelegt: ergebnis.angelegt, entfernt: ergebnis.entfernt },
    });
  }
  if (erster !== undefined) throw erster;
  return ergebnis;
}
