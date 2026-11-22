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

// Ein Knoten des Markups: Text (wird beim Ausgeben maskiert) oder ein Element. Dieselben Knoten gehen als JSON an das Skript, das geschützte Bausteine nachlädt (#354); dort entstehen daraus DOM-Knoten ohne innerHTML.
// attr: «true» ist ein Attribut ohne Wert (download)
export type HtmlKnoten =
  | string
  | {
      tag: string;
      attr?: Record<string, string | true>;
      kinder?: HtmlKnoten[];
    };

const el = (
  tag: string,
  attr?: Record<string, string | true>,
  ...kinder: HtmlKnoten[]
): HtmlKnoten => ({ tag, ...(attr && { attr }), kinder });

const LEERE_ELEMENTE = new Set(["img", "hr"]);

export function serialisiere(k: HtmlKnoten): string {
  if (typeof k === "string") return esc(k);
  const attr = Object.entries(k.attr ?? {})
    .map(([n, w]) => (w === true ? ` ${n}` : ` ${n}="${esc(w)}"`))
    .join("");
  if (LEERE_ELEMENTE.has(k.tag)) return `<${k.tag}${attr}>`;
  return `<${k.tag}${attr}>${(k.kinder ?? []).map(serialisiere).join("")}</${k.tag}>`;
}

// href (und rel für fremde Seiten); null, wenn die Adresse keine erlaubte Art hat
function href(ziel: string): Record<string, string> | null {
  const art = linkArt(ziel);
  if (art === null) return null;
  return art === "https"
    ? { href: ziel, rel: "noopener noreferrer" }
    : { href: ziel };
}

function verlinke(
  ziel: string | undefined,
  innen: HtmlKnoten[],
  klasse?: string,
): HtmlKnoten[] {
  const h = ziel === undefined ? null : href(ziel);
  if (h === null) return innen;
  return [el("a", klasse ? { ...h, class: klasse } : h, ...innen)];
}

function textBlock(b: TextBlock): HtmlKnoten {
  const abschnitte = (liste: Extract<TextBlock, { typ: "absatz" }>["inhalt"]) =>
    liste.flatMap((a) => {
      let k: HtmlKnoten = a.text;
      if (a.fett) k = el("strong", undefined, k);
      if (a.kursiv) k = el("em", undefined, k);
      return verlinke(a.link, [k]);
    });
  if (b.typ === "absatz") return el("p", undefined, ...abschnitte(b.inhalt));
  return el(
    b.geordnet ? "ol" : "ul",
    undefined,
    ...b.eintraege.map((e) => el("li", undefined, ...abschnitte(e))),
  );
}

function groesse(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bild(
  id: string,
  m: MedienDaten | undefined,
  unterschrift?: string,
): HtmlKnoten | null {
  if (!m || !m.mimeTyp.startsWith("image/")) return null;
  const img = el("img", {
    src: medienUrl(id),
    alt: m.altText ?? "",
    ...(m.breite &&
      m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
    loading: "lazy",
  });
  return el(
    "figure",
    undefined,
    img,
    ...(unterschrift ? [el("figcaption", undefined, unterschrift)] : []),
  );
}

function mitglieder(liste: Mitglied[]): HtmlKnoten[] {
  return liste.map((m) =>
    el(
      "li",
      undefined,
      el("span", { class: "name" }, m.name),
      ...(m.funktion
        ? [" ", el("span", { class: "funktion" }, m.funktion)]
        : []),
    ),
  );
}

// letzte: Ebene der letzten Überschrift der Seite (1 = der Seitentitel); eine neue springt höchstens eine Ebene tiefer
function rendereBaustein(
  b: Baustein,
  seiteId: string,
  daten: Daten,
  letzte: { ebene: number },
): HtmlKnoten | null {
  switch (b.typ) {
    case "ueberschrift": {
      const ebene = Math.min(b.daten.ebene, letzte.ebene + 1);
      letzte.ebene = ebene;
      return el(`h${ebene}`, undefined, b.daten.text);
    }
    case "text":
      return el("div", { class: "text" }, ...b.daten.inhalt.map(textBlock));
    case "bild":
      return bild(
        b.daten.mediumId,
        daten.medien.get(b.daten.mediumId),
        b.daten.unterschrift,
      );
    case "galerie": {
      const bilder = b.daten.bilder
        .map((e) =>
          bild(e.mediumId, daten.medien.get(e.mediumId), e.unterschrift),
        )
        .filter((k) => k !== null);
      return bilder.length === 0
        ? null
        : el(
            "ul",
            { class: "galerie" },
            ...bilder.map((k) => el("li", undefined, k)),
          );
    }
    case "karten":
      return el(
        "ul",
        { class: b.daten.darstellung },
        ...b.daten.eintraege.map((e) =>
          el(
            "li",
            undefined,
            el("p", { class: "titel" }, ...verlinke(e.link, [e.titel])),
            ...(e.text ? [el("p", undefined, e.text)] : []),
          ),
        ),
      );
    case "schaltflaeche":
      return el(
        "p",
        undefined,
        ...verlinke(
          b.daten.ziel,
          [b.daten.beschriftung],
          b.daten.darstellung === "schaltflaeche" ? "knopf" : undefined,
        ),
      );
    case "datei": {
      const m = daten.medien.get(b.daten.mediumId);
      if (!m) return null;
      const art = m.mimeTyp === "application/pdf" ? "PDF" : "Datei";
      const name = b.daten.beschriftung ?? m.altText ?? "Dokument";
      return el(
        "p",
        undefined,
        el("a", { href: medienUrl(b.daten.mediumId), download: true }, name),
        " ",
        el("span", { class: "info" }, `(${art}, ${groesse(m.groesse)})`),
      );
    }
    case "kontaktperson": {
      const p = daten.personen.get(b.daten.personId);
      return p ? el("ul", { class: "kontakt" }, ...mitglieder([p])) : null;
    }
    case "leitungsteam": {
      const t = daten.teams.get(b.daten.tagId);
      return t && t.mitglieder.length > 0
        ? el("ul", { class: "team" }, ...mitglieder(t.mitglieder))
        : null;
    }
    case "trenner":
      return b.daten.art === "linie"
        ? el("hr")
        : el("div", { class: "abstand", "aria-hidden": "true" });
    case "videolink":
      return el(
        "p",
        undefined,
        ...verlinke(b.daten.url, [b.daten.beschriftung]),
      );
    case "stufenfakten": {
      const fakten = daten.stufenfakten.get(seiteId) ?? [];
      return fakten.length === 0
        ? null
        : el(
            "dl",
            { class: "fakten" },
            ...fakten.flatMap((f) => [
              el("dt", undefined, f.bezeichnung),
              el("dd", undefined, f.wert),
            ]),
          );
    }
    // Die Termine liefert der Auftrag Termine; bis dahin bleibt der Platz leer
    case "terminliste":
      return null;
  }
}

export const istOeffentlich = (b: Baustein) =>
  b.sichtbarkeit === "erbt" || b.sichtbarkeit.art === "oeffentlich";

// Die Seite selbst ist öffentlich (der Aufrufer prüft das); ein Baustein mit eigener, engerer Sichtbarkeit steht nie im HTML.
// Statt seiner steht ein leerer Platzhalter, den das Skript nach der Anmeldung füllt (#354): nur die ID, nie Typ oder Inhalt
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
        : el("div", { "data-geschuetzt": b.id }),
    )
    .filter((k) => k !== null)
    .map(serialisiere)
    .join("\n");
}

// Knoten für das Nachladen (#354): die Bausteine in der Reihenfolge der Seite, für die `erlaubt` wahr ist.
// Ein Baustein ohne Inhalt (Medium fehlt, leere Daten) entfällt; die Überschriftenebene läuft über die gelieferten Bausteine
export function rendereGeschuetzte(
  dok: Seitendokument,
  seiteId: string,
  daten: Daten,
  erlaubt: (b: Baustein) => boolean,
): { id: string; knoten: HtmlKnoten }[] {
  const letzte = { ebene: 1 };
  const ergebnis: { id: string; knoten: HtmlKnoten }[] = [];
  for (const b of dok.bausteine) {
    if (!erlaubt(b)) continue;
    const knoten = rendereBaustein(b, seiteId, daten, letzte);
    if (knoten !== null) ergebnis.push({ id: b.id, knoten });
  }
  return ergebnis;
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

// Zweite Schicht neben den Antwortköpfen des Hosts: nur eigene Stile und Bilder, keine Rahmen. Skripte und Verbindungen nur auf Seiten mit Skript (#354) und nur von der eigenen Herkunft, nie inline
const CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
const CSP_MIT_SKRIPT =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
export const SKRIPT_GESCHUETZT = "/website/geschuetzt.js";
export const SKRIPT_ANMELDEN = "/website/anmelden.js";
export const ANMELDEN_PFAD = "/anmelden";

function rahmen(
  k: Kontext,
  {
    titel,
    aktuell,
    canonical,
    inhalt,
    robots,
    skript,
    hauptAttr = "",
  }: {
    titel: string;
    aktuell: string | null;
    canonical?: string;
    inhalt: string;
    robots?: string;
    skript?: string;
    // Fertig maskierte Attribute für <main> (nur Konstanten und esc())
    hauptAttr?: string;
  },
) {
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(skript ? CSP_MIT_SKRIPT : CSP)}">
<meta name="referrer" content="no-referrer">${robots ? `\n<meta name="robots" content="${robots}">` : ""}
<title>${esc(titel)} | ${esc(k.abteilung)}</title>${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ""}
<link rel="stylesheet" href="${STYLESHEET_PFAD}">${skript ? `\n<script type="module" src="${skript}"></script>` : ""}
</head>
<body>
<a class="sprunglink" href="#inhalt">Zum Inhalt</a>
<header>
<p class="name"><a href="/">${esc(k.abteilung)}</a></p>
<nav aria-label="Hauptnavigation">${navigation(k.navigation, aktuell)}</nav>
</header>
<main id="inhalt" tabindex="-1"${hauptAttr}>
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
    // Das Skript nur, wenn die Seite einen Platzhalter hat; es kennt die Adresse der Seite aus data-pfad
    ...(!s.dokument.bausteine.every(istOeffentlich) && {
      skript: SKRIPT_GESCHUETZT,
      hauptAttr: ` data-pfad="${esc(s.pfad)}"`,
    }),
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

// Hülle einer ganz geschützten Seite (#354): kein Titel, kein Inhalt, nur der Hinweis. Das Skript ersetzt sie nach der Anmeldung durch die Seite; ohne Sitzung bleibt der Hinweis stehen
export function rendereHuelle(pfad: string, k: Kontext): string {
  const anmelden = `${ANMELDEN_PFAD}?weiter=${encodeURIComponent(pfad)}`;
  return rahmen(k, {
    titel: "Geschützte Seite",
    aktuell: null,
    robots: "noindex",
    skript: SKRIPT_GESCHUETZT,
    hauptAttr: ` data-huelle data-pfad="${esc(pfad)}"`,
    inhalt: `<h1>Geschützte Seite</h1>
<p>Diese Seite ist nur für angemeldete Personen.</p>
<p><a href="${esc(anmelden)}">Anmelden</a></p>`,
  });
}

// Anmeldeseite (#354). Die Felder haben kein name-Attribut und das Formular sendet nichts selbst (form-action 'none'): Ein Passwort gelangt nie in eine Adresse. Das Skript sendet es als JSON an /api/auth
export function rendereAnmeldung(k: Kontext): string {
  return rahmen(k, {
    titel: "Anmelden",
    aktuell: null,
    robots: "noindex",
    skript: SKRIPT_ANMELDEN,
    inhalt: `<h1>Anmelden</h1>
<p>Melde dich mit deinem Konto an, um geschützte Inhalte zu sehen.</p>
<noscript><p>Zum Anmelden braucht diese Seite JavaScript.</p></noscript>
<div id="fehler" class="hinweis" tabindex="-1" hidden></div>
<form id="anmeldung" class="formular" method="post" action="#" novalidate>
<p><label for="benutzername">Benutzername</label><input id="benutzername" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></p>
<p><label for="passwort">Passwort</label><input id="passwort" type="password" autocomplete="current-password" required></p>
<p><button type="submit" class="knopf">Anmelden</button></p>
</form>
<form id="faktor" class="formular" method="post" action="#" novalidate hidden>
<p><label for="code" id="code-label">Code aus der Authenticator-App</label><input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required aria-describedby="code-hilfe"></p>
<p id="code-hilfe" class="hilfe">Sechs Ziffern.</p>
<p><button type="submit" class="knopf">Bestätigen</button> <button type="button" id="ersatz" class="knopf knopf--still">Ersatzcode verwenden</button></p>
</form>`,
  });
}
