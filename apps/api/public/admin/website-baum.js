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
