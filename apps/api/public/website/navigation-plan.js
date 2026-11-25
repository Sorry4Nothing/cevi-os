// Menü für Angemeldete (#795), der Teil ohne Seite: Antwort von GET /api/v1/website/navigation prüfen und planen, was ins Menü kommt. Reine Funktionen, kein DOM; navigation.js setzt den Plan um.

const PFAD = /^\/[a-z0-9-]{1,60}(\/[a-z0-9-]{1,60}){0,4}$/;
const MAX_EINTRAEGE = 200;
const MAX_TITEL = 200;

const adresse = (w) => w === null || (typeof w === "string" && PFAD.test(w));

// Nur diese vier Felder, nur in dieser Form; ein ungültiger Eintrag verwirft die ganze Antwort (das Menü bleibt dann, wie es ist)
export function pruefeAntwort(d) {
  if (d === null || typeof d !== "object" || !Array.isArray(d.eintraege)) {
    return null;
  }
  if (d.eintraege.length > MAX_EINTRAEGE) return null;
  for (const e of d.eintraege) {
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e.pfad !== "string" ||
      !PFAD.test(e.pfad) ||
      typeof e.titel !== "string" ||
      e.titel.trim().length === 0 ||
      e.titel.length > MAX_TITEL ||
      !adresse(e.eltern) ||
      !adresse(e.davor)
    ) {
      return null;
    }
  }
  return d.eintraege;
}

// Der Pfad der aktuellen Seite ohne Schrägstrich am Ende
export const pfadVon = (pathname) =>
  pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

// Was ins Menü kommt, in der Reihenfolge der Antwort (Eltern zuerst).
// vorhanden: die Adressen, die das Menü schon hat. Ein Eintrag, den es schon hat, kommt nie doppelt. Die Elternseite muss vorhanden oder weiter oben im Plan sein, sonst steht der Eintrag in der obersten Ebene;
// «davor» gilt nur, wenn es im Menü schon steht, sonst kommt der Eintrag ans Ende. stand: aria-current, «page» auf der aktuellen Seite, «true» auf ihren Elternseiten
export function plane(eintraege, vorhanden, aktuell) {
  const bekannt = new Set(vorhanden);
  const plan = [];
  for (const e of eintraege) {
    if (bekannt.has(e.pfad)) continue;
    plan.push({
      pfad: e.pfad,
      titel: e.titel,
      eltern: e.eltern !== null && bekannt.has(e.eltern) ? e.eltern : null,
      davor: e.davor !== null && vorhanden.has(e.davor) ? e.davor : null,
      stand:
        e.pfad === aktuell
          ? "page"
          : aktuell.startsWith(`${e.pfad}/`)
            ? "true"
            : null,
    });
    bekannt.add(e.pfad);
  }
  return plan;
}

// Die aktuelle Seite ist selbst ein neuer Eintrag: Dann bekommen auch ihre Elternseiten im Menü die Markierung
export const ausPlan = (plan, aktuell) => plan.some((p) => p.pfad === aktuell);
