import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { anlass, medium, ort, seite, tag, user } from "../db/schema.js";
import type { Baustein } from "./bausteine.js";
import { sammleDynamischeVerweise } from "./bausteine-dynamisch.js";
import {
  MAX_FEHLER,
  sammleVerweise,
  type DokumentFehler,
  type Seitendokument,
} from "./dokument.js";
import { ANMELDEN_PFAD, TERMINE_PFAD } from "./rendern.js";
import { adressenVon, type Knoten } from "./seiten.js";

type Lesen = Pick<Db, "select">;

// Verweisprüfung eines Seitendokuments (#350), je Baustein mit Pfad «bausteine.<n>». Fremde und unbekannte IDs sind dasselbe: so verrät die Antwort nichts über andere Abteilungen.
// Muss in der Transaktion laufen, die den Entwurf schreibt: Die Medien sind dort mit FOR SHARE gesperrt, ein gleichzeitiges DELETE (FOR UPDATE) wartet und sieht danach den Verweis
export async function pruefeVerweise(
  d: Lesen,
  abteilungId: string,
  // Sichtbarkeit der Seite: Ein Baustein mit «erbt» ist so sichtbar wie sie (A8)
  seitenArt: "oeffentlich" | "angemeldet" | "tags",
  dok: Seitendokument,
): Promise<DokumentFehler[]> {
  const alle = sammleVerweise(dok);
  const klein = (ids: string[]) => ids.map((i) => i.toLowerCase());
  const lade = async <T extends { id: string }>(
    ids: string[],
    abfrage: (ids: string[]) => Promise<T[]>,
  ) => new Map((ids.length ? await abfrage(ids) : []).map((z) => [z.id, z]));

  const medien = await lade(klein(alle.medien), (ids) =>
    d
      .select({
        id: medium.id,
        mimeTyp: medium.mimeTyp,
        sichtbarkeit: medium.sichtbarkeit,
        dekorativ: medium.dekorativ,
      })
      .from(medium)
      .where(and(eq(medium.abteilungId, abteilungId), inArray(medium.id, ids)))
      .for("share"),
  );
  const tags = await lade(klein(alle.tags), (ids) =>
    d
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.abteilungId, abteilungId), inArray(tag.id, ids))),
  );
  const personen = await lade(klein(alle.personen), (ids) =>
    d
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.abteilungId, abteilungId), inArray(user.id, ids))),
  );
  // Anlässe und Orte der Bausteine aus Cevi OS (#740): nur eigene; ein Anlass zeigt sich nur, wenn er öffentlich ist
  const dyn = sammleDynamischeVerweise(dok.bausteine);
  const anlaesse = await lade(dyn.anlaesse, (ids) =>
    d
      .select({ id: anlass.id, sichtbarkeit: anlass.sichtbarkeit })
      .from(anlass)
      .where(and(eq(anlass.abteilungId, abteilungId), inArray(anlass.id, ids))),
  );
  const orte = await lade(dyn.orte, (ids) =>
    d
      .select({ id: ort.id })
      .from(ort)
      .where(and(eq(ort.abteilungId, abteilungId), inArray(ort.id, ids))),
  );
  // Adressen der Abteilung aus dem Baum. Die Startseite «/» lässt sich hier nicht prüfen (offen, #351)
  // Die festen Seiten der Website (Termine, Anmelden) gibt es immer: Ein Link darauf ist gültig (#560)
  const pfade = new Set<string>([TERMINE_PFAD, ANMELDEN_PFAD]);
  if (alle.seiten.some((s) => s !== "/")) {
    const zeilen = await d
      .select({
        id: seite.id,
        elternId: seite.elternId,
        adresse: seite.adresse,
        reihenfolge: seite.reihenfolge,
        tagId: seite.tagId,
      })
      .from(seite)
      .where(eq(seite.abteilungId, abteilungId));
    const knoten: Knoten = new Map(zeilen.map((z) => [z.id, z]));
    for (const z of zeilen)
      pfade.add(`/${adressenVon(knoten, z.id).join("/")}`);
  }

  const fehler: DokumentFehler[] = [];
  (dok.bausteine as Baustein[]).forEach((b, i) => {
    const pfad = `bausteine.${i}`;
    const v = sammleVerweise({ ...dok, bausteine: [b] });
    const oeffentlich =
      (b.sichtbarkeit === "erbt" ? seitenArt : b.sichtbarkeit.art) ===
      "oeffentlich";
    for (const id of klein(v.medien)) {
      const m = medien.get(id);
      if (!m) fehler.push({ pfad, code: "MEDIUM_UNBEKANNT" });
      // Bild und Galerie brauchen ein Bild (Alt-Text oder «dekorativ» sichert die Datenbank, medium_inhalt_check); ein altes PDF-Medium (vor #428) gilt nicht
      else if (!m.mimeTyp.startsWith("image/")) {
        fehler.push({ pfad, code: "MEDIUM_FORMAT" });
      } else if (oeffentlich && m.sichtbarkeit !== "oeffentlich") {
        fehler.push({ pfad, code: "MEDIUM_NICHT_OEFFENTLICH" });
      } else if (b.typ === "karussell" && m.dekorativ) {
        // Im Karussell trägt jedes Bild den Inhalt, ein Alt-Text ist Pflicht (WCAG 1.1.1)
        fehler.push({ pfad, code: "MEDIUM_ALT_FEHLT" });
      }
    }
    for (const id of klein(v.tags)) {
      if (!tags.has(id)) fehler.push({ pfad, code: "TAG_UNBEKANNT" });
    }
    for (const id of klein(v.personen)) {
      if (!personen.has(id)) fehler.push({ pfad, code: "PERSON_UNBEKANNT" });
    }
    const vd = sammleDynamischeVerweise([b]);
    for (const id of vd.anlaesse) {
      const a = anlaesse.get(id);
      if (!a) fehler.push({ pfad, code: "ANLASS_UNBEKANNT" });
      else if (a.sichtbarkeit !== "oeffentlich") {
        fehler.push({ pfad, code: "ANLASS_NICHT_OEFFENTLICH" });
      }
    }
    for (const id of vd.orte) {
      if (!orte.has(id)) fehler.push({ pfad, code: "ORT_UNBEKANNT" });
    }
    for (const s of v.seiten) {
      if (s !== "/" && !pfade.has(s))
        fehler.push({ pfad, code: "SEITE_UNBEKANNT" });
    }
  });
  return fehler.slice(0, MAX_FEHLER);
}

// In wie vielen Seiten der Abteilung steht das Medium im Entwurf oder in irgendeiner Version? Der Text des JSON genügt: Eine UUID kommt nur als Verweis vor (gross oder klein geschrieben, darum lower)
export async function seitenMitMedium(
  d: Lesen,
  abteilungId: string,
  mediumId: string,
): Promise<number> {
  const id = mediumId.toLowerCase();
  const [z] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(seite)
    .where(
      and(
        eq(seite.abteilungId, abteilungId),
        sql`(position(${id} in lower(${seite.entwurf}::text)) > 0 or exists (select 1 from seite_version v where v.seite_id = ${seite.id} and position(${id} in lower(v.inhalt::text)) > 0))`,
      ),
    );
  return z?.n ?? 0;
}
