import { htmlZuText } from "./abgleich.js";

export type Eckdaten = {
  tag: string;
  treffpunkt: string | null;
  schlussOrt: string | null;
  schlussZeit: string | null;
  mitnehmen: string | null;
};

// Die Seite wird von Hand gepflegt und variiert je Stufe: Der Parser sucht Beschriftungen am Zeilenanfang, nie feste Überschriften.
// Fehlt eine Angabe, bleibt sie null; ohne Datum unter «Cevi-Programm» liefert die Seite nichts (Exodus ist passwortgeschützt und hat keines)
const LABEL =
  /^(cevi-programm|treff-?\s*(?:und|&|\+)\s*schluss(?:punkt)?|treff(?:punkt)?|schluss(?:punkt)?|mitnehmen|mitbringen)\b\s*:?\s*(.*)$/i;
const MONATE = [
  "januar",
  "februar",
  "märz",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "dezember",
];
const DATUM = new RegExp(
  `(\\d{1,2})\\.\\s*(${MONATE.join("|")})\\s+(\\d{4})`,
  "i",
);
const ZEIT_BEREICH =
  /(\d{1,2})[:.](\d{2})\s*(?:uhr)?\s*(?:-|–|—|bis)\s*(\d{1,2})[:.](\d{2})\s*(?:uhr)?/i;
const ZEIT = /(\d{1,2})[:.](\d{2})\s*(?:uhr)?/i;
// Schutz vor einer Seite mit Riesentexten
const MAX_FELD = 500;
const MAX_MITNEHMEN = 1000;

const zweistellig = (n: string) => n.padStart(2, "0");
const zeit = (h: string, m: string) => {
  const stunde = Number(h);
  const minute = Number(m);
  return stunde < 24 && minute < 60 ? `${zweistellig(h)}:${m}` : null;
};

function tagAus(text: string): string | null {
  const t = DATUM.exec(text);
  if (!t) return null;
  const monat = MONATE.indexOf(t[2].toLowerCase()) + 1;
  const iso = `${t[3]}-${zweistellig(String(monat))}-${zweistellig(t[1])}`;
  // Round-Trip: «31. April» gibt es nicht
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso)
    ? iso
    : null;
}

const ohneZeit = (zeile: string) =>
  zeile
    .replace(ZEIT_BEREICH, "")
    .replace(ZEIT, "")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();

const kuerze = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) : text;
const oderNull = (text: string) => (text === "" ? null : text);

export function parseEckdaten(html: string): Eckdaten | null {
  // Abschnitt unter der Überschrift «Eckdaten …»; ohne sie die ganze Seite (das Datum entscheidet)
  const ueberschrift = /<h2[^>]*>[^<]*eckdaten[^<]*<\/h2>/i.exec(html);
  let bereich = html;
  if (ueberschrift) {
    const rest = html.slice(ueberschrift.index + ueberschrift[0].length);
    const ende = rest.search(/<h2[\s>]|<\/section>/i);
    bereich = ende === -1 ? rest : rest.slice(0, ende);
  }
  // Quelltext-Umbrüche zählen nicht, nur Tags (<br />, </li>) brechen die Zeile; sonst trennt der Umbruch nach <br /> Beschriftung und Wert
  const text = htmlZuText(
    bereich.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " "),
  );
  if (text === null) return null;

  // Block = Beschriftungszeile samt Rest der Zeile und Folgezeilen bis zur Leerzeile oder nächsten Beschriftung
  const blocks: { label: string; zeilen: string[] }[] = [];
  let aktuell: { label: string; zeilen: string[] } | null = null;
  for (const roh of text.split("\n")) {
    const zeile = roh.replace(/\s+/g, " ").trim();
    if (zeile === "") {
      aktuell = null;
      continue;
    }
    const treffer = LABEL.exec(zeile);
    if (treffer) {
      aktuell = {
        label: treffer[1].toLowerCase().replace(/\s+/g, " "),
        zeilen: treffer[2] ? [treffer[2]] : [],
      };
      blocks.push(aktuell);
    } else if (aktuell) {
      aktuell.zeilen.push(zeile);
    }
  }

  const programm = blocks.find((b) => b.label === "cevi-programm");
  const tag = programm ? tagAus(programm.zeilen.join(" ")) : null;
  if (!tag) return null;

  const ergebnis: Eckdaten = {
    tag,
    treffpunkt: null,
    schlussOrt: null,
    schlussZeit: null,
    mitnehmen: null,
  };
  for (const b of blocks) {
    const alle = b.zeilen.join("\n");
    if (/^treff-?\s*(und|&|\+)/.test(b.label)) {
      // Eine Zeit «14:00-17:00» gilt für Treff und Schluss, der Ort für beide
      const bereich = ZEIT_BEREICH.exec(alle);
      const einzel = ZEIT.exec(alle);
      const von = bereich
        ? zeit(bereich[1], bereich[2])
        : einzel && zeit(einzel[1], einzel[2]);
      const bis = bereich ? zeit(bereich[3], bereich[4]) : null;
      const ort = b.zeilen.map(ohneZeit).filter(Boolean).join("\n");
      ergebnis.treffpunkt ??= oderNull(
        kuerze(
          [von ? `${von} Uhr` : "", ort].filter(Boolean).join("\n"),
          MAX_FELD,
        ),
      );
      ergebnis.schlussOrt ??= oderNull(kuerze(ort, MAX_FELD));
      ergebnis.schlussZeit ??= bis;
    } else if (b.label.startsWith("treff")) {
      ergebnis.treffpunkt ??= oderNull(kuerze(alle, MAX_FELD));
    } else if (b.label.startsWith("schluss")) {
      const einzel = ZEIT.exec(alle);
      ergebnis.schlussZeit ??= einzel ? zeit(einzel[1], einzel[2]) : null;
      ergebnis.schlussOrt ??= oderNull(
        kuerze(b.zeilen.map(ohneZeit).filter(Boolean).join("\n"), MAX_FELD),
      );
    } else if (b.label === "mitnehmen" || b.label === "mitbringen") {
      ergebnis.mitnehmen ??= oderNull(kuerze(alle, MAX_MITNEHMEN));
    }
  }
  return ergebnis;
}

// Aus dem Stufennamen der Verwaltung: klein, Umlaute ausgeschrieben, nur [a-z0-9]. Alles andere fällt weg, damit der Name nie den Pfad verlässt
export function stufenSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]/g, "");
}
