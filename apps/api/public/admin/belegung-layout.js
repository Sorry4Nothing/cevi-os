// Rechnen für den Belegungsplan (#628): reine Funktionen ohne DOM, damit sie sich ohne Browser prüfen lassen (test/admin-belegung-layout.test.ts). Alle Tage und Uhrzeiten gelten in Schweizer Zeit (Europe/Zurich); die API liefert Zeitpunkte als ISO-Text in UTC.

export const ZONE = "Europe/Zurich";
// Die Zeitachse zeigt 07 bis 23 Uhr; liegt eine Buchung davor oder danach, wächst sie um volle Stunden
export const ACHSE_ANFANG = 7 * 60;
export const ACHSE_ENDE = 23 * 60;
// Freie Fenster kürzer als das gelten nicht als «frei»
export const FREI_MINDESTENS = 30;

const teileFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Tag («2027-01-16») und Minuten seit Mitternacht eines Zeitpunkts in Schweizer Zeit
export function zuerichTeile(wert) {
  const t = {};
  for (const { type, value } of teileFormat.formatToParts(new Date(wert))) {
    t[type] = value;
  }
  return {
    tag: `${t.year}-${t.month}-${t.day}`,
    minuten: Number(t.hour) * 60 + Number(t.minute),
  };
}

// Kalendertage rechnen über Mittag in UTC: Sommerzeit verschiebt nie den Tag
export const plusTage = (tag, n) =>
  new Date(Date.parse(`${tag}T12:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

export const tageZwischen = (von, bis) =>
  Math.round(
    (Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) /
      86_400_000,
  );

// 0 = Montag … 6 = Sonntag
export const wochentagNr = (tag) =>
  (new Date(`${tag}T12:00:00Z`).getUTCDay() + 6) % 7;

export const montagVon = (tag) => plusTage(tag, -wochentagNr(tag));

export const wochenTage = (montag) =>
  Array.from({ length: 7 }, (_, i) => plusTage(montag, i));

// Kalenderwoche nach ISO 8601: die Woche mit dem Donnerstag im Jahr
export function kalenderwoche(tag) {
  const donnerstag = plusTage(tag, 3 - wochentagNr(tag));
  const jahr = Number(donnerstag.slice(0, 4));
  const ersterJanuar = `${jahr}-01-01`;
  return {
    jahr,
    woche: Math.floor(tageZwischen(ersterJanuar, donnerstag) / 7) + 1,
  };
}

// «07:30»
export const uhrzeit = (minuten) =>
  `${String(Math.floor(minuten / 60)).padStart(2, "0")}:${String(minuten % 60).padStart(2, "0")}`;

// Eine Buchung auf die Tage verteilen, die sie berührt: [{ tag, von, bis }] mit Minuten seit Mitternacht (bis 1440 am Ende eines durchgehenden Tages). Eine Buchung, die genau um Mitternacht endet, hat keinen Teil am Folgetag. Nur Tage in [ersterTag, letzterTag] (beide eingeschlossen)
export function tagesTeile(buchung, ersterTag, letzterTag) {
  const a = zuerichTeile(buchung.beginn);
  const e = zuerichTeile(buchung.ende);
  const teile = [];
  for (let tag = a.tag; tag <= e.tag; tag = plusTage(tag, 1)) {
    const von = tag === a.tag ? a.minuten : 0;
    const bis = tag === e.tag ? e.minuten : 1440;
    if (bis <= von || tag < ersterTag || tag > letzterTag) continue;
    teile.push({ tag, von, bis });
  }
  return teile;
}

// Die Achse eines Bildes: 07 bis 23 Uhr, bei Bedarf um volle Stunden erweitert. teile: [{ von, bis }]
export function achseFuer(teile) {
  let anfang = ACHSE_ANFANG;
  let ende = ACHSE_ENDE;
  for (const t of teile) {
    anfang = Math.min(anfang, Math.floor(t.von / 60) * 60);
    ende = Math.max(ende, Math.ceil(t.bis / 60) * 60);
  }
  return { anfang, ende, laenge: ende - anfang };
}

// Lage in Prozent der Achse (0 bis 100), auf die Achse zugeschnitten
export function lageAufAchse(von, bis, achse) {
  const a = Math.max(von, achse.anfang);
  const e = Math.min(bis, achse.ende);
  return {
    links: ((a - achse.anfang) / achse.laenge) * 100,
    breite: (Math.max(e - a, 0) / achse.laenge) * 100,
  };
}

const ueberlappt = (a, b) => a.von < b.bis && b.von < a.bis;

// Nebeneinander legen, was sich überschneidet (wie in einem Wochenkalender): Teile in Gruppen, die sich berühren, je Teil die erste freie Spur; danach darf sich ein Teil über freie Spuren rechts davon verbreitern. Gibt je Teil { spur, spuren, spanne } zurück, in der Reihenfolge der Eingabe
export function ordneSpuren(teile) {
  const reihenfolge = teile
    .map((t, i) => ({ t, i }))
    .sort((x, y) => x.t.von - y.t.von || y.t.bis - x.t.bis || x.i - y.i);
  const ergebnis = new Array(teile.length);
  let gruppe = [];
  let spurEnden = [];
  let gruppenEnde = -1;
  const schliesse = () => {
    const spuren = spurEnden.length;
    for (const g of gruppe) {
      let spanne = 1;
      while (
        g.spur + spanne < spuren &&
        !gruppe.some((o) => o.spur === g.spur + spanne && ueberlappt(o.t, g.t))
      ) {
        spanne += 1;
      }
      ergebnis[g.i] = { spur: g.spur, spuren, spanne };
    }
    gruppe = [];
    spurEnden = [];
  };
  for (const { t, i } of reihenfolge) {
    if (gruppe.length > 0 && t.von >= gruppenEnde) schliesse();
    let spur = spurEnden.findIndex((ende) => ende <= t.von);
    if (spur === -1) {
      spur = spurEnden.length;
      spurEnden.push(t.bis);
    } else {
      spurEnden[spur] = t.bis;
    }
    gruppe.push({ t, i, spur });
    gruppenEnde = Math.max(gruppenEnde, t.bis);
  }
  if (gruppe.length > 0) schliesse();
  return ergebnis;
}

// Freie Zeitfenster eines Tages innerhalb der Achse: [{ von, bis }], ohne Fenster unter «mindestens» Minuten. Bestätigte und angefragte Zeiten gelten beide als belegt (eine Anfrage kann bestätigt werden)
export function freieFenster(
  belegt,
  achse = { anfang: ACHSE_ANFANG, ende: ACHSE_ENDE },
  mindestens = FREI_MINDESTENS,
) {
  const sortiert = [...belegt].sort((a, b) => a.von - b.von);
  const frei = [];
  let stand = achse.anfang;
  for (const b of sortiert) {
    if (b.von - stand >= mindestens) frei.push({ von: stand, bis: b.von });
    stand = Math.max(stand, b.bis);
  }
  if (achse.ende - stand >= mindestens) {
    frei.push({ von: stand, bis: achse.ende });
  }
  return frei;
}

// «frei 07:00–10:00 und 12:00–23:00», höchstens `hoechstens` Fenster, dann «…»; ohne Fenster «nicht frei»
export function freiText(fenster, hoechstens = 3) {
  if (fenster.length === 0) return "nicht frei";
  const teile = fenster
    .slice(0, hoechstens)
    .map((f) => `${uhrzeit(f.von)}–${uhrzeit(f.bis)}`);
  return `frei ${teile.join(", ")}${fenster.length > hoechstens ? " …" : ""}`;
}

// Alle Teile aller Buchungen eines Zeitraums, je Raum und Tag gruppiert: Map «raumId» -> Map «tag» -> [{ buchung, von, bis }]
export function gruppiere(
  buchungen,
  ersterTag,
  letzterTag,
  zeigeAnfragen = true,
) {
  const je = new Map();
  for (const b of buchungen) {
    if (!zeigeAnfragen && b.status === "angefragt") continue;
    for (const t of tagesTeile(b, ersterTag, letzterTag)) {
      if (!je.has(b.raumId)) je.set(b.raumId, new Map());
      const tage = je.get(b.raumId);
      if (!tage.has(t.tag)) tage.set(t.tag, []);
      tage.get(t.tag).push({ buchung: b, von: t.von, bis: t.bis });
    }
  }
  for (const tage of je.values()) {
    for (const liste of tage.values()) {
      liste.sort((a, b) => a.von - b.von || a.bis - b.bis);
    }
  }
  return je;
}

// Nächster Block in einer Richtung für die Pfeiltasten. blocks: [{ raum, beginn, ende }] in der Reihenfolge Raum, dann Zeit; aktuell: Index. Links und rechts gehen in der Zeit desselben Raums, oben und unten wechseln den Raum und nehmen den Block mit dem nächsten Beginn. Gibt den neuen Index oder aktuell zurück
export function naechsterBlock(blocks, aktuell, richtung, raeumeReihenfolge) {
  const jetzt = blocks[aktuell];
  if (!jetzt) return aktuell;
  if (richtung === "links" || richtung === "rechts") {
    const schritt = richtung === "links" ? -1 : 1;
    const nachbar = blocks[aktuell + schritt];
    return nachbar && nachbar.raum === jetzt.raum ? aktuell + schritt : aktuell;
  }
  const lage = raeumeReihenfolge.indexOf(jetzt.raum);
  const ziel = raeumeReihenfolge[lage + (richtung === "oben" ? -1 : 1)];
  if (ziel === undefined) return aktuell;
  let bester = -1;
  let abstand = Infinity;
  blocks.forEach((b, i) => {
    if (b.raum !== ziel) return;
    const a = Math.abs(b.beginn - jetzt.beginn);
    if (a < abstand) {
      abstand = a;
      bester = i;
    }
  });
  return bester === -1 ? aktuell : bester;
}
