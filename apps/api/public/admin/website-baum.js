import { anfrage } from "./api.js";

// Der Seitenbaum der Website: aus der flachen Liste (elternId) werden Zeilen mit Ebene; dazu das Verschieben und die Anfragen.
// Gemeinsam für die Seitenliste (E1) und die Seiteneinstellungen im Editor (E2).

export const API = "/api/v1/redaktion";
// Wie MAX_TIEFE in src/website/seiten.ts; der Server prüft es ohnehin
export const MAX_TIEFE = 5;
export const ADRESSE = /^[a-z0-9-]{1,60}$/;

// Der Baum aus der flachen Liste. Eine Seite, deren Elternseite fehlt (Stufenleitung sieht nur ihre Seite), steht oben.
export function baue(seiten) {
  const nachId = new Map(seiten.map((s) => [s.id, s]));
  const kinder = new Map();
  for (const s of seiten) {
    const schluessel =
      s.elternId !== null && nachId.has(s.elternId) ? s.elternId : null;
    if (!kinder.has(schluessel)) kinder.set(schluessel, []);
    kinder.get(schluessel).push(s);
  }
  const zeilen = [];
  const ebenen = new Map();
  const gehe = (schluessel, ebene) => {
    const geschwister = kinder.get(schluessel) ?? [];
    geschwister.forEach((seite, index) => {
      ebenen.set(seite.id, ebene);
      zeilen.push({ seite, ebene, geschwister, index });
      gehe(seite.id, ebene + 1);
    });
  };
  gehe(null, 0);
  const hoehe = (id) =>
    1 + Math.max(0, ...(kinder.get(id) ?? []).map((k) => hoehe(k.id)));
  const nachfahren = (id) =>
    new Set((kinder.get(id) ?? []).flatMap((k) => [k.id, ...nachfahren(k.id)]));
  return { nachId, kinder, zeilen, ebenen, hoehe, nachfahren };
}

// Ordnet die Seite unter der Elternseite an die Stelle index (0 = ganz oben, gezählt ohne sie selbst) und liefert die nötigen PATCH-Körper.
// Die Seite selbst steht zuerst: Scheitert sie, ist noch nichts verändert.
export function plane(seiten, seite, elternId, index) {
  const andere = seiten.filter(
    (s) => s.elternId === elternId && s.id !== seite.id,
  );
  const pos = Math.max(0, Math.min(index, andere.length));
  const reihe = [...andere.slice(0, pos), seite, ...andere.slice(pos)];
  const aenderungen = [];
  reihe.forEach((s, i) => {
    const eigene = s.id === seite.id;
    const elternNeu = eigene && s.elternId !== elternId;
    if (s.reihenfolge === i && !elternNeu) return;
    const eintrag = { id: s.id, reihenfolge: i };
    if (elternNeu) eintrag.elternId = elternId;
    if (eigene) aenderungen.unshift(eintrag);
    else aenderungen.push(eintrag);
  });
  return { aenderungen, position: pos + 1, anzahl: reihe.length };
}

// Der PATCH-Körper ohne die Kennung (sie steht im Pfad)
export const koerper = (eintrag) => {
  const rest = { ...eintrag };
  delete rest.id;
  return rest;
};
export const patch = (id, body) =>
  anfrage("PATCH", `${API}/seiten/${id}`, body);

export const gleicheSichtbarkeit = (a, b) =>
  a.art === b.art &&
  (a.art !== "tags" ||
    (a.tagIds.length === b.tagIds.length &&
      a.tagIds.every((id) => b.tagIds.includes(id))));

// --- Verschieben im Baum (#595): Modell im Browser, der Server prüft alles ----------------------------------------------

// Geschwister einer Elternseite in der Reihenfolge der Anzeige, ohne die Seite «ohne»
export const geschwister = (seiten, elternId, ohne = null) =>
  seiten
    .filter((s) => s.elternId === elternId && s.id !== ohne)
    .sort((a, b) => a.reihenfolge - b.reihenfolge);

// Die Seiten sortiert, damit baue() und plane() die Reihenfolge aus der Liste lesen
export const sortiere = (seiten) =>
  seiten.sort((a, b) => a.reihenfolge - b.reihenfolge);

// Stand der Felder, die ein Verschieben ändert (für «Rückgängig» und den Abbruch beim Tastaturverschieben)
export const schnappschuss = (seiten) =>
  seiten.map((s) => ({
    id: s.id,
    elternId: s.elternId,
    reihenfolge: s.reihenfolge,
    pfad: s.pfad,
  }));
export function stelleHer(seiten, stand) {
  const nachId = new Map(seiten.map((s) => [s.id, s]));
  for (const x of stand) Object.assign(nachId.get(x.id) ?? {}, x);
  sortiere(seiten);
}

// Wendet die Änderungen von plane() im Modell an und rechnet die Adressen der betroffenen Seiten neu: Elternadresse + eigene Adresse
export function wendeAn(seiten, aenderungen) {
  const nachId = new Map(seiten.map((s) => [s.id, s]));
  for (const a of aenderungen) Object.assign(nachId.get(a.id), koerper(a));
  sortiere(seiten);
  const pfadVon = (s) => {
    const eltern = s.elternId ? nachId.get(s.elternId) : null;
    return `${eltern ? pfadVon(eltern) : ""}/${s.adresse}`;
  };
  for (const s of seiten) s.pfad = pfadVon(s);
}

// Darf die Seite dorthin? Nicht unter sich selbst oder einen Nachfahren, und der Baum bleibt unter MAX_TIEFE.
// Liefert den Grund als Text oder null
export function ablehnung(baum, seite, elternId) {
  if (elternId === seite.id || baum.nachfahren(seite.id).has(elternId)) {
    return "Eine Seite lässt sich nicht unter sich selbst oder ihre Unterseiten legen.";
  }
  const ebene = elternId === null ? -1 : (baum.ebenen.get(elternId) ?? 0);
  if (ebene + 1 + baum.hoehe(seite.id) > MAX_TIEFE) {
    return `Der Baum darf höchstens ${MAX_TIEFE} Ebenen tief sein.`;
  }
  return null;
}

// Alte Adressen aller Seiten, deren Adresse sich durch den Schritt von vorher nach nachher ändert (Seite und Unterseiten), nur veröffentlichte:
// [{ alt, neu }] für Weiterleitungen
export function geaenderteAdressen(vorher, nachher) {
  const neu = new Map(nachher.map((s) => [s.id, s]));
  return vorher
    .filter((s) => s.veroeffentlicht && neu.get(s.id)?.pfad !== s.pfad)
    .map((s) => ({ alt: s.pfad, neu: neu.get(s.id).pfad }));
}

// Adresse aus einem Titel wie auf dem Server (website/automatik.ts adresseAusName); der Server entscheidet bei Kollisionen
export function adresseAusTitel(titel) {
  const slug = titel
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "seite" : slug;
}

// Gleiche Adressen auf oberster Ebene, die der Server nicht vergibt (api, admin …): nur die Liste, die Prüfung bleibt beim Server
export const RESERVIERT = [
  "api",
  "admin",
  "health",
  "datenschutz",
  "konto-loeschen",
  "support",
  "website",
  "anmelden",
  "medien",
  "ical",
  "termine",
  "anlass",
  "termin",
  "konto",
];
