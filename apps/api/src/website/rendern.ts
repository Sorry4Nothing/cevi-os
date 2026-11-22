import { linkArt, type Baustein, type TextBlock } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";

// Renderer der Website (#351): Seitendokument zu HTML, nur aus den typisierten Knoten. Kein Nutzertext gelangt ungeprüft ins Markup:
// Jede Zeichenkette läuft durch esc(), Adressen durch linkArt() (nur https, Seitenpfade, mailto, tel) und die Medien-Adresse entsteht aus der ID der Datenbank.
// Rein und synchron: Alles, was aus der Datenbank kommt, liegt vorher in «Daten». Kein Skript, keine Schrift und keine Einbettung von aussen.

export const STYLESHEET_PFAD = "/website/website.css";
// Name der Startseite: die Seite mit dieser Adresse auf der obersten Ebene ist die Adresse «/» (offene Frage aus #348, bis der Nutzer entscheidet)
export const STARTSEITE = "start";

const MASKE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (text: string) => text.replace(/[&<>"']/g, (z) => MASKE[z]!);

export type NavPunkt = { pfad: string; titel: string; kinder: NavPunkt[] };

// Ein öffentliches Medium; nicht öffentliche oder fremde Medien gelangen nie hierher
export type MedienDaten = {
  mimeTyp: string;
  groesse: number;
  breite: number | null;
  hoehe: number | null;
  // null = dekorativ (leerer Alt-Text) oder bei einem PDF ohne Beschreibung
  altText: string | null;
};
// Nur Cevi-Name und Funktion: Telefon, E-Mail und Foto zeigt die Website nicht, bis der Nutzer anders entscheidet
export type Mitglied = { name: string; funktion: string | null };
export type Fakt = { bezeichnung: string; wert: string };

// Daten für Bausteine, die nicht im Dokument stehen. Fehlt ein Eintrag, entfällt der Baustein.
// #355 füllt «stufenfakten» (je Seiten-ID), der Auftrag Termine hängt später «terminliste» ein
export type Daten = {
  medien: ReadonlyMap<string, MedienDaten>;
  personen: ReadonlyMap<string, Mitglied>;
  teams: ReadonlyMap<string, { name: string; mitglieder: Mitglied[] }>;
  stufenfakten: ReadonlyMap<string, Fakt[]>;
};
export const keineDaten = (): Daten => ({
  medien: new Map(),
  personen: new Map(),
  teams: new Map(),
  stufenfakten: new Map(),
});

export type Kontext = {
  abteilung: string;
  basisUrl: string;
  navigation: NavPunkt[];
  daten: Daten;
};
// pfad: «/» oder «/a/b», immer aus geprüften Adressen
export type SeiteZumRendern = {
  id: string;
  pfad: string;
  dokument: Seitendokument;
};

const medienUrl = (id: string) => `/api/v1/medien/${id}`;

// href-Attribut samt rel für fremde Seiten; null, wenn die Adresse keine erlaubte Art hat
function href(ziel: string): string | null {
  const art = linkArt(ziel);
  if (art === null) return null;
  return `href="${esc(ziel)}"${art === "https" ? ' rel="noopener noreferrer"' : ""}`;
}

function verlinke(ziel: string | undefined, innen: string, klasse?: string) {
  const h = ziel === undefined ? null : href(ziel);
  if (h === null) return innen;
  return `<a ${h}${klasse ? ` class="${klasse}"` : ""}>${innen}</a>`;
}

function textBlock(b: TextBlock): string {
  const abschnitte = (liste: Extract<TextBlock, { typ: "absatz" }>["inhalt"]) =>
    liste
      .map((a) => {
        let h = esc(a.text);
        if (a.fett) h = `<strong>${h}</strong>`;
        if (a.kursiv) h = `<em>${h}</em>`;
        return verlinke(a.link, h);
      })
      .join("");
  if (b.typ === "absatz") return `<p>${abschnitte(b.inhalt)}</p>`;
  const tag = b.geordnet ? "ol" : "ul";
  return `<${tag}>${b.eintraege.map((e) => `<li>${abschnitte(e)}</li>`).join("")}</${tag}>`;
}

function groesse(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bild(id: string, m: MedienDaten | undefined, unterschrift?: string) {
  if (!m || !m.mimeTyp.startsWith("image/")) return null;
  const masse =
    m.breite && m.hoehe ? ` width="${m.breite}" height="${m.hoehe}"` : "";
  const img = `<img src="${medienUrl(id)}" alt="${esc(m.altText ?? "")}"${masse} loading="lazy">`;
  return `<figure>${img}${unterschrift ? `<figcaption>${esc(unterschrift)}</figcaption>` : ""}</figure>`;
}

function mitglieder(liste: Mitglied[]) {
  return liste
    .map(
      (m) =>
        `<li><span class="name">${esc(m.name)}</span>${m.funktion ? ` <span class="funktion">${esc(m.funktion)}</span>` : ""}</li>`,
    )
    .join("");
}

// letzte: Ebene der letzten Überschrift der Seite (1 = der Seitentitel); eine neue springt höchstens eine Ebene tiefer
function rendereBaustein(
  b: Baustein,
  seiteId: string,
  daten: Daten,
  letzte: { ebene: number },
): string {
  switch (b.typ) {
    case "ueberschrift": {
      const ebene = Math.min(b.daten.ebene, letzte.ebene + 1);
      letzte.ebene = ebene;
      return `<h${ebene}>${esc(b.daten.text)}</h${ebene}>`;
    }
    case "text":
      return `<div class="text">${b.daten.inhalt.map(textBlock).join("")}</div>`;
    case "bild":
      return (
        bild(
          b.daten.mediumId,
          daten.medien.get(b.daten.mediumId),
          b.daten.unterschrift,
        ) ?? ""
      );
    case "galerie": {
      const bilder = b.daten.bilder
        .map((e) =>
          bild(e.mediumId, daten.medien.get(e.mediumId), e.unterschrift),
        )
        .filter((h) => h !== null);
      return bilder.length === 0
        ? ""
        : `<ul class="galerie">${bilder.map((h) => `<li>${h}</li>`).join("")}</ul>`;
    }
    case "karten":
      return `<ul class="${b.daten.darstellung}">${b.daten.eintraege
        .map(
          (e) =>
            `<li><p class="titel">${verlinke(e.link, esc(e.titel))}</p>${e.text ? `<p>${esc(e.text)}</p>` : ""}</li>`,
        )
        .join("")}</ul>`;
    case "schaltflaeche":
      return `<p>${verlinke(b.daten.ziel, esc(b.daten.beschriftung), b.daten.darstellung === "schaltflaeche" ? "knopf" : undefined)}</p>`;
    case "datei": {
      const m = daten.medien.get(b.daten.mediumId);
      if (!m) return "";
      const art = m.mimeTyp === "application/pdf" ? "PDF" : "Datei";
      const name = b.daten.beschriftung ?? m.altText ?? "Dokument";
      return `<p><a href="${medienUrl(b.daten.mediumId)}" download>${esc(name)}</a> <span class="info">(${art}, ${groesse(m.groesse)})</span></p>`;
    }
    case "kontaktperson": {
      const p = daten.personen.get(b.daten.personId);
      return p ? `<ul class="kontakt">${mitglieder([p])}</ul>` : "";
    }
    case "leitungsteam": {
      const t = daten.teams.get(b.daten.tagId);
      return t && t.mitglieder.length > 0
        ? `<ul class="team">${mitglieder(t.mitglieder)}</ul>`
        : "";
    }
    case "trenner":
      return b.daten.art === "linie"
        ? "<hr>"
        : '<div class="abstand" aria-hidden="true"></div>';
    case "videolink":
      return `<p>${verlinke(b.daten.url, esc(b.daten.beschriftung))}</p>`;
    case "stufenfakten": {
      const fakten = daten.stufenfakten.get(seiteId) ?? [];
      return fakten.length === 0
        ? ""
        : `<dl class="fakten">${fakten.map((f) => `<dt>${esc(f.bezeichnung)}</dt><dd>${esc(f.wert)}</dd>`).join("")}</dl>`;
    }
    // Die Termine liefert der Auftrag Termine; bis dahin bleibt der Platz leer
    case "terminliste":
      return "";
  }
}

const istOeffentlich = (b: Baustein) =>
  b.sichtbarkeit === "erbt" || b.sichtbarkeit.art === "oeffentlich";

// Die Seite selbst ist öffentlich (der Aufrufer prüft das); ein Baustein mit eigener, engerer Sichtbarkeit steht nie im HTML.
// Statt seiner steht ein leerer Platzhalter, den #354 nach der Anmeldung füllt: nur die ID, nie Typ oder Inhalt
export function rendereBausteine(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
): string {
  const letzte = { ebene: 1 };
  return dok.bausteine
    .map((b) =>
      istOeffentlich(b)
        ? rendereBaustein(b, seiteId, daten, letzte)
        : `<div data-geschuetzt="${esc(b.id)}"></div>`,
    )
    .filter((h) => h !== "")
    .join("\n");
}

function navigation(punkte: NavPunkt[], aktuell: string | null): string {
  if (punkte.length === 0) return "";
  return `<ul>${punkte
    .map(
      (p) =>
        `<li><a href="${esc(p.pfad)}"${p.pfad === aktuell ? ' aria-current="page"' : ""}>${esc(p.titel)}</a>${navigation(p.kinder, aktuell)}</li>`,
    )
    .join("")}</ul>`;
}

// Zweite Schicht neben den Antwortköpfen des Hosts: nur eigene Stile und Bilder, keine Skripte, keine Rahmen
const CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";

function rahmen(
  k: Kontext,
  {
    titel,
    aktuell,
    canonical,
    inhalt,
    robots,
  }: {
    titel: string;
    aktuell: string | null;
    canonical?: string;
    inhalt: string;
    robots?: string;
  },
) {
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<meta name="referrer" content="no-referrer">${robots ? `\n<meta name="robots" content="${robots}">` : ""}
<title>${esc(titel)} | ${esc(k.abteilung)}</title>${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ""}
<link rel="stylesheet" href="${STYLESHEET_PFAD}">
</head>
<body>
<a class="sprunglink" href="#inhalt">Zum Inhalt</a>
<header>
<p class="name"><a href="/">${esc(k.abteilung)}</a></p>
<nav aria-label="Hauptnavigation">${navigation(k.navigation, aktuell)}</nav>
</header>
<main id="inhalt" tabindex="-1">
${inhalt}
</main>
<footer>
<p><a href="/datenschutz">Datenschutz</a></p>
</footer>
</body>
</html>
`;
}

export function rendereSeite(s: SeiteZumRendern, k: Kontext): string {
  return rahmen(k, {
    titel: s.dokument.titel,
    aktuell: s.pfad,
    canonical: k.basisUrl + s.pfad,
    inhalt: `<h1>${esc(s.dokument.titel)}</h1>\n${rendereBausteine(s.dokument, s.id, k.daten)}`,
  });
}

// 404.html: der Host liefert sie bei unbekannten Adressen; sie verrät nichts über geschützte Seiten
export function rendereFehlerseite(k: Kontext): string {
  return rahmen(k, {
    titel: "Seite nicht gefunden",
    aktuell: null,
    robots: "noindex",
    inhalt:
      "<h1>Seite nicht gefunden</h1>\n<p>Diese Seite gibt es nicht. Über das Menü finden Sie die Seiten der Website.</p>",
  });
}

// Nur öffentliche Seiten: Der Aufrufer übergibt nur diese
export function rendereSitemap(
  basisUrl: string,
  seiten: { pfad: string; geaendert: Date }[],
): string {
  const eintraege = seiten
    .map(
      (s) =>
        `<url><loc>${esc(basisUrl + s.pfad)}</loc><lastmod>${s.geaendert.toISOString().slice(0, 10)}</lastmod></url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${eintraege}
</urlset>
`;
}

// Nennt keine einzelne Seite: Eine Sperrliste würde geschützte Adressen verraten
export const rendereRobots = (basisUrl: string) =>
  `User-agent: *\nDisallow: /api/\nDisallow: /admin\nSitemap: ${basisUrl}/sitemap.xml\n`;
