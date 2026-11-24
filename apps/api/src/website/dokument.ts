import { z } from "zod";
import {
  bausteinSchema,
  linkArt,
  MAX_BAUSTEINE_PRO_SEITE,
  MAX_SEITENTITEL,
  type Baustein,
} from "./bausteine.js";
import { sammleMedienVerweise } from "./medien-schema.js";
import { textVerweise } from "./bausteine-text.js";

// Seitendokument Version 1 (#349): Titel und geordnete Bausteine. Das Feld `v` trägt spätere Schemawechsel.
export const seitendokumentSchema = z
  .strictObject({
    v: z.literal(1),
    titel: z.string().trim().min(1).max(MAX_SEITENTITEL),
    bausteine: z.array(bausteinSchema).max(MAX_BAUSTEINE_PRO_SEITE),
  })
  .superRefine((dok, ctx) => {
    const gesehen = new Set<string>();
    dok.bausteine.forEach((b, i) => {
      if (gesehen.has(b.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["bausteine", i, "id"],
          message: "doppelte ID",
        });
      }
      gesehen.add(b.id);
    });
  });
export type Seitendokument = z.infer<typeof seitendokumentSchema>;

// Fehler nur mit Pfad und zod-Code: Der Text von zod kann Feldnamen oder Werte der Eingabe enthalten, darum nie in die Antwort
export type DokumentFehler = { pfad: string; code: string };
export type Pruefung =
  | { ok: true; dokument: Seitendokument }
  | { ok: false; fehler: DokumentFehler[] };
export const MAX_FEHLER = 20;

// Bytes der Anfrage beim Speichern des Entwurfs (SR-20): Das Schema begrenzt Mengen und Längen, nicht die Bytes.
// 512 KiB sind das Achtfache der 64 KiB, die sonst für jede Anfrage gelten: 100 Bausteine zu je 5 KB Text haben Platz, mehr ist keine lesbare Seite
export const MAX_ENTWURF_BYTES = 512 * 1024;

export function pruefeDokument(eingabe: unknown): Pruefung {
  const ergebnis = seitendokumentSchema.safeParse(eingabe);
  if (ergebnis.success) return { ok: true, dokument: ergebnis.data };
  return {
    ok: false,
    fehler: ergebnis.error.issues.slice(0, MAX_FEHLER).map((i) => ({
      pfad: i.path.map(String).join("."),
      code: i.code,
    })),
  };
}

export type Verweise = {
  medien: string[];
  tags: string[];
  personen: string[];
  // Adressen der Website ohne Anker, wie in den Links geschrieben («/stufen/woelfe»)
  seiten: string[];
};

// Alle Verweise eines geprüften Dokuments, ohne Doppelte, für die Verweisprüfung (#350) und «wird verwendet»
export function sammleVerweise(dok: Seitendokument): Verweise {
  const medien = new Set<string>();
  const tags = new Set<string>();
  const personen = new Set<string>();
  const seiten = new Set<string>();
  const ziel = (link: string | undefined) => {
    if (link !== undefined && linkArt(link) === "seite") {
      seiten.add(link.split("#")[0]!);
    }
  };

  for (const b of dok.bausteine as Baustein[]) {
    if (b.sichtbarkeit !== "erbt" && b.sichtbarkeit.art === "tags") {
      b.sichtbarkeit.tagIds.forEach((id) => tags.add(id));
    }
    // Bilder und Medien (#742): Bildraster, Logo-Reihe, Vorschaubilder und weitere
    sammleMedienVerweise(b, medien, ziel);
    switch (b.typ) {
      case "bild":
        medien.add(b.daten.mediumId);
        break;
      case "galerie":
      case "karussell":
        b.daten.bilder.forEach((bild) => medien.add(bild.mediumId));
        break;
      case "kontaktperson":
        personen.add(b.daten.personId);
        break;
      case "kontaktkarte":
        if (b.daten.personId) personen.add(b.daten.personId);
        if (b.daten.bild) medien.add(b.daten.bild);
        b.daten.verweise?.forEach((v) => ziel(v.ziel));
        break;
      case "leitungsteam":
        tags.add(b.daten.tagId);
        break;
      case "terminliste":
        if (b.daten.tagId) tags.add(b.daten.tagId);
        break;
      case "karten":
        b.daten.eintraege.forEach((e) => {
          ziel(e.link);
          if (e.bild) medien.add(e.bild);
        });
        break;
      case "schaltflaeche":
      case "aufruf":
        ziel(b.daten.ziel);
        break;
      case "hinweis":
        ziel(b.daten.link?.ziel);
        break;
      // Einstieg und Handlung (#743)
      case "kopfbereich":
        if (b.daten.bild) medien.add(b.daten.bild);
        b.daten.schaltflaechen?.forEach((s) => ziel(s.ziel));
        break;
      case "weiterfuehrend":
        b.daten.eintraege.forEach((e) => ziel(e.ziel));
        break;
      case "eckdaten":
        b.daten.eintraege.forEach((e) => ziel(e.link));
        break;
      case "personen":
        b.daten.eintraege.forEach((e) => personen.add(e.personId));
        break;
      case "artikel":
        b.daten.eintraege.forEach((e) => {
          if (e.mediumId) medien.add(e.mediumId);
        });
        break;
      case "text":
        for (const block of b.daten.inhalt) {
          const listen =
            block.typ === "absatz" ? [block.inhalt] : block.eintraege;
          listen.flat().forEach((a) => ziel(a.link));
        }
        break;
      default:
        textVerweise(b, medien, ziel);
        break;
    }
  }
  return {
    medien: [...medien],
    tags: [...tags],
    personen: [...personen],
    seiten: [...seiten],
  };
}
