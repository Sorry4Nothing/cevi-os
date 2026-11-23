import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { tag, weiterleitung } from "../db/schema.js";
import { istAusgabePfad } from "./ausgabe.js";
import { fehlerBuehne, STIL_FEHLER } from "./fehlerseiten.js";
import { CSP, esc, STYLESHEET_PFAD } from "./rendern.js";
import { RESERVIERTE_ADRESSEN } from "./seiten.js";
import { zeichenLinks } from "./zeichen.js";

// Weiterleitungen alter Adressen (#356). Ein Pfad ist relativ zur Website: Stücke aus a-z, 0-9 und «-», dahinter Endungen mit «.», höchstens 7 Stücke.
// Das schliesst jeden offenen Redirect aus (kein Host, kein Schema, kein «//», «\», «..», Query oder Anker) und macht Pfade für Caddy und HTML ohne Maskieren sicher.
// Das Muster steht auch als CHECK in der Tabelle (db/schema-website.ts); beide müssen übereinstimmen
export const PFAD_MUSTER =
  /^\/[a-z0-9-]+(?:\.[a-z0-9]+)*(?:\/[a-z0-9-]+(?:\.[a-z0-9]+)*){0,6}$/;
export const MAX_PFAD = 200;
// Obergrenze je Abteilung (geschätzt): hält die Datei weiterleitungen.caddy und den Abgleich klein
export const MAX_WEITERLEITUNGEN = 1000;

export const istPfad = (p: string) =>
  p.length <= MAX_PFAD && PFAD_MUSTER.test(p);
const istZiel = (p: string) => p === "/" || istPfad(p);
// Die obersten Adressen gehören der API, der Verwaltung und den Dateien der Website: Eine Weiterleitung darf sie nie überdecken
const istReserviert = (p: string) =>
  RESERVIERTE_ADRESSEN.includes(p.split("/")[1]!);

export const alterPfadSchema = z
  .string()
  .max(MAX_PFAD)
  .regex(PFAD_MUSTER)
  .refine((p) => !istReserviert(p));
export const zielPfadSchema = z
  .string()
  .max(MAX_PFAD)
  .refine((p) => istZiel(p));
export const statusSchema = z.union([z.literal(301), z.literal(302)]);

export type Umleitung = {
  alterPfad: string;
  zielPfad: string;
  status: 301 | 302;
};

// Ketten und Schleifen: Das Ziel ist nie selbst eine alte Adresse, und eine alte Adresse ist nie Ziel einer anderen.
// So gibt es nie mehr als einen Sprung, und eine Schleife (A nach B, B nach A) ist ausgeschlossen. «andere» sind die übrigen Zeilen der Abteilung
export function pruefeKette(
  neu: { alterPfad: string; zielPfad: string },
  andere: { alterPfad: string; zielPfad: string }[],
): "schleife" | "kette" | null {
  if (neu.alterPfad === neu.zielPfad) return "schleife";
  if (
    andere.some(
      (a) => a.alterPfad === neu.zielPfad && a.zielPfad === neu.alterPfad,
    )
  ) {
    return "schleife";
  }
  if (
    andere.some(
      (a) => a.alterPfad === neu.zielPfad || a.zielPfad === neu.alterPfad,
    )
  ) {
    return "kette";
  }
  return null;
}

export const CADDY_DATEI = "weiterleitungen.caddy";
const datei = (alterPfad: string) => `${alterPfad.slice(1)}/index.html`;

// Vorschlag für den Caddy der Website, nur als Datei in der Ausgabe; eingebunden wird nichts. Jede Zeile hat die Form «redir <alt> <neu> <status>».
// Pfade, die nicht dem Muster entsprechen, fallen weg: Ein Zeilenumbruch, «{», «}», «#» oder ein Anführungszeichen kommt nie in die Datei
export function rendereCaddy(liste: Umleitung[]): string {
  const zeilen = liste
    .filter((u) => istPfad(u.alterPfad) && istZiel(u.zielPfad))
    .map(
      (u) =>
        `redir ${u.alterPfad} ${u.zielPfad} ${u.status === 302 ? 302 : 301}`,
    )
    .sort();
  return `# Vorschlag, nicht eingebunden: Weiterleitungen alter Adressen (#356). Wird bei jedem Abgleich neu erzeugt, nicht von Hand ändern.
# Einbinden im Seitenblock der Website, zum Beispiel mit «import /pfad/zu/weiterleitungen.caddy».
${zeilen.join("\n")}${zeilen.length > 0 ? "\n" : ""}`;
}

// Rückfall am alten Pfad für Hosting ohne die Caddy-Zeilen: sofortige Weiterleitung mit Link, ohne Skript
export function rendereWeiterleitungsseite(
  u: Umleitung,
  abteilung: string,
  basisUrl: string,
  zeichen?: string,
): string {
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<meta http-equiv="refresh" content="0; url=${esc(u.zielPfad)}">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Seite umgezogen | ${esc(abteilung)}</title>
<link rel="canonical" href="${esc(basisUrl + u.zielPfad)}">${zeichen ? zeichenLinks(esc(zeichen)) : ""}
<link rel="stylesheet" href="${STYLESHEET_PFAD}">
<link rel="stylesheet" href="${STIL_FEHLER}">
</head>
<body>
<main id="inhalt">
${fehlerBuehne({
  titel: "Diese Seite ist umgezogen.",
  satz: "Du wirst gleich weitergeleitet. Geht es nicht von selbst, nimm den Knopf.",
  aktion: `<a class="btn p gross" href="${esc(u.zielPfad)}">Weiter zur neuen Adresse</a>`,
  tafeln: [{ titel: "Neue Adresse", zusatz: "1 Klick", ziel: u.zielPfad }],
  ort: ["Alte Adresse"],
})}
</main>
</body>
</html>
`;
}

// Alle Weiterleitungen der Abteilung als zusätzliche Gesamtdateien des Abgleichs: «weiterleitungen.caddy» und je eine Rückfallseite am alten Pfad.
// «seiten» sind die Seiten, die eine Datei bekommen (Pfad, Gruppe): Dort, wo eine Seite liegt, gilt keine Weiterleitung. Dazu kommt die alte Adresse der Stufenseiten «/cevistufe-<name>», sobald die Stufenseite besteht; eine eigene Weiterleitung geht vor
export async function baueWeiterleitungen(
  db: Db,
  opt: {
    abteilungId: string;
    abteilung: string;
    basisUrl: string;
    seiten: { pfad: string; tagId: string | null }[];
    // Fassung des Favicons (zeichenVersion), wie auf jeder Seite der Website
    zeichen?: string;
  },
): Promise<[string, string][]> {
  const eigene = await db
    .select({
      alterPfad: weiterleitung.alterPfad,
      zielPfad: weiterleitung.zielPfad,
      status: weiterleitung.status,
    })
    .from(weiterleitung)
    .where(eq(weiterleitung.abteilungId, opt.abteilungId));

  const tagIds = opt.seiten.flatMap((s) => (s.tagId ? [s.tagId] : []));
  const stufen =
    tagIds.length === 0
      ? []
      : await db
          .select({ id: tag.id, name: tag.name })
          .from(tag)
          .where(
            and(
              eq(tag.abteilungId, opt.abteilungId),
              eq(tag.typ, "stufe"),
              inArray(tag.id, tagIds),
            ),
          );
  const automatisch: Umleitung[] = [];
  for (const s of opt.seiten) {
    const stufe = stufen.find((t) => t.id === s.tagId);
    const name = stufe ? stufenSlug(stufe.name) : "";
    if (name) {
      automatisch.push({
        alterPfad: `/cevistufe-${name}`,
        zielPfad: s.pfad,
        status: 301,
      });
    }
  }

  const belegt = new Set(opt.seiten.map((s) => s.pfad));
  const nachPfad = new Map<string, Umleitung>();
  for (const u of [
    ...automatisch,
    ...eigene.map((e) => ({
      ...e,
      status: e.status === 302 ? (302 as const) : (301 as const),
    })),
  ]) {
    if (
      !istPfad(u.alterPfad) ||
      !istZiel(u.zielPfad) ||
      istReserviert(u.alterPfad) ||
      u.alterPfad === u.zielPfad ||
      belegt.has(u.alterPfad)
    ) {
      continue;
    }
    nachPfad.set(u.alterPfad, u);
  }
  const liste = [...nachPfad.values()].sort((a, b) =>
    a.alterPfad.localeCompare(b.alterPfad),
  );
  // Ohne Weiterleitung keine Dateien (der Abgleich räumt eine frühere Caddy-Datei weg)
  const dateien: [string, string][] =
    liste.length > 0 ? [[CADDY_DATEI, rendereCaddy(liste)]] : [];
  for (const u of liste) {
    // Ein Pfad, der als Datei nicht erlaubt ist, steht nur in der Caddy-Datei
    if (istAusgabePfad(datei(u.alterPfad))) {
      dateien.push([
        datei(u.alterPfad),
        rendereWeiterleitungsseite(u, opt.abteilung, opt.basisUrl, opt.zeichen),
      ]);
    }
  }
  return dateien;
}

// Aus dem Stufennamen der Verwaltung: klein, Umlaute ausgeschrieben, nur [a-z0-9]. Alles andere fällt weg, damit der Name nie den Pfad verlässt (alte Adresse /cevistufe-<name>)
export function stufenSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]/g, "");
}
