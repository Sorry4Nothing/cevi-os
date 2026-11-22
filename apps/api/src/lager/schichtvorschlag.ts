// Der Vorschlag «Leere Dienste füllen» (#388): rein, ohne Datenbank, damit gleiche Eingabe und gleicher Startwert immer denselben Vorschlag geben (Test) und Vorschau und Übernehmen übereinstimmen. Die Route lädt die Daten und übergibt sie hier.

// Wie viele neue Schichten ein Lauf höchstens vorschlägt (ein Insert bleibt unter dem Parameterlimit von Postgres); mehr bleibt unbesetzt, der Lauf lässt sich wiederholen
export const MAX_VORSCHLAG = 2000;

export type VorschlagDienst = {
  id: string;
  tagesabschnittId: string;
  mindestbesetzung: number;
  nacht: boolean;
};

export type VorschlagEingabe = {
  // Alle Lagertage des Lagers nach Datum: Nachtwachen «hintereinander» heisst aufeinanderfolgende Einträge dieser Liste
  tage: string[];
  // Die Tage, die gefüllt werden sollen (Teilmenge von tage)
  planTage: string[];
  // In der Reihenfolge, in der gefüllt wird: Abschnitt des Tages, dann Reihenfolge des Dienstes
  dienste: VorschlagDienst[];
  kandidaten: string[];
  // Bestehende Schichten mit Schlüssel des Kandidaten (oder einer anderen Person, die nicht zur Auswahl steht)
  vorhanden: { lagertagId: string; dienstId: string; schluessel: string }[];
  // Darf dieser Kandidat an diesem Tag in diesem Abschnitt eingeteilt werden (Anwesenheit)
  verfuegbar: (
    schluessel: string,
    lagertagId: string,
    tagesabschnittId: string,
  ) => boolean;
  seed: number;
};

export type Vorschlag = {
  neu: { lagertagId: string; dienstId: string; schluessel: string }[];
  unbesetzt: { lagertagId: string; dienstId: string; fehlend: number }[];
  // Je Kandidat: Schichten vorher, neu vorgeschlagen und Nachtwachen insgesamt
  statistik: Map<string, { vorher: number; neu: number; nachtwachen: number }>;
  gekuerzt: boolean;
};

// mulberry32 wie in lager/mischen.ts: nur für die Reihenfolge bei Gleichstand, kein Geheimnis
function zufall(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Regeln: Wer an einem Tag in einem Abschnitt schon eingeteilt ist, bekommt dort keinen zweiten Dienst; eine Nachtwache bekommt niemand an zwei aufeinanderfolgenden Tagen; wer abwesend ist (verfuegbar), bekommt nichts. Verteilung: Jeder freie Platz geht an den Kandidaten mit den bisher wenigsten Schichten (bei Nachtwachen zuerst mit den wenigsten Nachtwachen), bei Gleichstand nach einer vom Startwert abhängigen Reihenfolge. Bei gleicher Verfügbarkeit unterscheiden sich die Zahlen der Schichten damit um höchstens eins; schränken Abwesenheit oder die Nachtwachen-Regel ein, kann der Unterschied grösser sein, ohne dass eine Regel verletzt wird
export function schlageVor(e: VorschlagEingabe): Vorschlag {
  const indexVonTag = new Map(e.tage.map((t, i) => [t, i]));
  const sortiert = [...e.kandidaten].sort();
  const next = zufall(e.seed);
  // Fisher-Yates über die nach Schlüssel geordnete Liste: unabhängig von der Reihenfolge der Datenbank
  for (let j = sortiert.length - 1; j > 0; j--) {
    const m = Math.floor(next() * (j + 1));
    [sortiert[j], sortiert[m]] = [sortiert[m]!, sortiert[j]!];
  }
  const rang = new Map(sortiert.map((k, i) => [k, i]));
  const istKandidat = new Set(sortiert);
  const dienstVon = new Map(e.dienste.map((d) => [d.id, d]));

  const anzahl = new Map<string, number>();
  const vorher = new Map<string, number>();
  const nachtwachen = new Map<string, number>();
  // Belegte Felder (Kandidat, Tag, Abschnitt) und Tage mit Nachtwache je Kandidat
  const belegt = new Set<string>();
  const nachtTage = new Map<string, Set<number>>();
  const besetzung = new Map<string, number>();
  const feld = (k: string, tag: string, abschnitt: string) =>
    `${k}|${tag}|${abschnitt}`;
  const inc = (m: Map<string, number>, k: string) =>
    m.set(k, (m.get(k) ?? 0) + 1);

  const trage = (k: string, tag: string, d: VorschlagDienst) => {
    belegt.add(feld(k, tag, d.tagesabschnittId));
    inc(anzahl, k);
    if (d.nacht) {
      inc(nachtwachen, k);
      const i = indexVonTag.get(tag);
      if (i !== undefined) {
        nachtTage.set(k, (nachtTage.get(k) ?? new Set()).add(i));
      }
    }
  };
  for (const v of e.vorhanden) {
    const d = dienstVon.get(v.dienstId);
    if (!d) continue;
    inc(besetzung, `${v.lagertagId}|${v.dienstId}`);
    // Nur wer zur Auswahl steht, braucht Zähler; die anderen belegen nur den Platz
    if (!istKandidat.has(v.schluessel)) continue;
    trage(v.schluessel, v.lagertagId, d);
    inc(vorher, v.schluessel);
  }

  const neu: Vorschlag["neu"] = [];
  const unbesetzt: Vorschlag["unbesetzt"] = [];
  let gekuerzt = false;
  for (const tag of e.planTage) {
    const i = indexVonTag.get(tag);
    for (const d of e.dienste) {
      let fehlend = d.mindestbesetzung - (besetzung.get(`${tag}|${d.id}`) ?? 0);
      while (fehlend > 0) {
        if (neu.length >= MAX_VORSCHLAG) {
          gekuerzt = true;
          break;
        }
        let beste: string | null = null;
        for (const k of sortiert) {
          if (belegt.has(feld(k, tag, d.tagesabschnittId))) continue;
          if (!e.verfuegbar(k, tag, d.tagesabschnittId)) continue;
          if (d.nacht && i !== undefined) {
            const nt = nachtTage.get(k);
            if (nt && (nt.has(i - 1) || nt.has(i + 1))) continue;
          }
          if (beste === null) {
            beste = k;
            continue;
          }
          const a = anzahl.get(k) ?? 0;
          const b = anzahl.get(beste) ?? 0;
          const na = d.nacht ? (nachtwachen.get(k) ?? 0) : 0;
          const nb = d.nacht ? (nachtwachen.get(beste) ?? 0) : 0;
          if (
            a < b ||
            (a === b &&
              (na < nb || (na === nb && rang.get(k)! < rang.get(beste)!)))
          ) {
            beste = k;
          }
        }
        if (beste === null) break;
        trage(beste, tag, d);
        neu.push({ lagertagId: tag, dienstId: d.id, schluessel: beste });
        fehlend--;
      }
      if (fehlend > 0) {
        unbesetzt.push({ lagertagId: tag, dienstId: d.id, fehlend });
      }
    }
  }

  const statistik: Vorschlag["statistik"] = new Map();
  const neuJe = new Map<string, number>();
  for (const n of neu) inc(neuJe, n.schluessel);
  for (const k of sortiert) {
    statistik.set(k, {
      vorher: vorher.get(k) ?? 0,
      neu: neuJe.get(k) ?? 0,
      nachtwachen: nachtwachen.get(k) ?? 0,
    });
  }
  return { neu, unbesetzt, statistik, gekuerzt };
}
