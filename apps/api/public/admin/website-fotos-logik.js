// Fotos: die reinen Funktionen der Albumliste (#794): Suchen, Filtern, Sortieren, Gruppieren nach Jahr, schrittweise Anzeige, Auswahl und Texte. Kein DOM, keine Importe; Test: test/admin-website-fotos-logik.test.ts.
// Ein Album: { id, titel (Flickr), eigenerTitel | null, anzahl, datum "JJJJ-MM-TT" | null, sichtbar, version }

// Zeilen je Schritt bei «Mehr anzeigen»
export const SCHRITT = 40;
// Mehr als so viele Alben auf einmal zu zeigen braucht eine Bestätigung: Die Fotos zeigen oft Kinder
export const BESTAETIGEN_AB = 5;
export const OHNE_DATUM = "ohne";

export const SORTIERUNGEN = [
  ["neu", "Neueste zuerst"],
  ["alt", "Älteste zuerst"],
  ["titel", "Titel A–Z"],
  ["gross", "Grösste zuerst"],
];

export const albumTitel = (a) => a.eigenerTitel ?? a.titel ?? "";

// «2026» aus dem Datum; ohne Datum ein leerer Text
export const jahrVon = (datum) =>
  typeof datum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(datum)
    ? datum.slice(0, 4)
    : "";

// Zwei Schreibweisen zum Vergleichen: «ä» als «a» und als «ae» (wer «baeume» tippt, findet «Bäume», wer «baume» tippt, auch)
export function schluessel(text) {
  const klein = String(text).toLowerCase().replaceAll("ß", "ss");
  const ohne = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");
  const mit = klein
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue");
  return [ohne(klein), ohne(mit)];
}

// Jedes Wort der Frage muss im Titel stehen (eigener oder von Flickr)
export function trifftFrage(album, frage) {
  const woerter = String(frage).trim().split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return true;
  const heu = [album.eigenerTitel, album.titel]
    .filter(Boolean)
    .map(schluessel)
    .reduce((s, [a, b]) => [`${s[0]} ${a}`, `${s[1]} ${b}`], ["", ""]);
  return woerter.every((w) => {
    const [a, b] = schluessel(w);
    return heu[0].includes(a) || heu[1].includes(b);
  });
}

// filter: { frage, sicht: "alle" | "sichtbar" | "nicht", jahr: "" | "2026" | "ohne" }
export function trifftJahr(album, jahr) {
  if (!jahr) return true;
  const j = jahrVon(album.datum);
  return jahr === OHNE_DATUM ? j === "" : j === jahr;
}
export const trifftSicht = (album, sicht) =>
  sicht === "sichtbar"
    ? album.sichtbar
    : sicht === "nicht"
      ? !album.sichtbar
      : true;

export const passt = (album, f) =>
  trifftSicht(album, f.sicht) &&
  trifftJahr(album, f.jahr) &&
  trifftFrage(album, f.frage);

export const filtere = (alben, f) => alben.filter((a) => passt(a, f));

// Zahlen für die Knöpfe «Alle», «Sichtbar», «Nicht sichtbar»: Suche und Jahr gelten, die Sicht selbst nicht
export function zaehleSicht(alben, f) {
  const rest = alben.filter(
    (a) => trifftJahr(a, f.jahr) && trifftFrage(a, f.frage),
  );
  const sichtbar = rest.filter((a) => a.sichtbar).length;
  return { alle: rest.length, sichtbar, nicht: rest.length - sichtbar };
}

// Die Jahre der Alben, das neueste zuerst; «ohne» am Ende, wenn Alben kein Datum haben
export function jahre(alben) {
  const alle = new Set(alben.map((a) => jahrVon(a.datum)));
  const mit = [...alle].filter(Boolean).sort((x, y) => y.localeCompare(x));
  return alle.has("") ? [...mit, OHNE_DATUM] : mit;
}

// Ein Album ohne Titel heisst in der Liste «Ohne Titel» und steht dort in der Reihe
const nachTitel = (a, b) =>
  (albumTitel(a) || "Ohne Titel").localeCompare(
    albumTitel(b) || "Ohne Titel",
    "de-CH",
    { numeric: true },
  );

// Eine neue Liste; Alben ohne Datum stehen bei «neu» und «alt» am Ende
export function sortiere(alben, art) {
  const datum = (richtung) => (a, b) => {
    if (!a.datum && !b.datum) return nachTitel(a, b);
    if (!a.datum) return 1;
    if (!b.datum) return -1;
    return a.datum === b.datum
      ? nachTitel(a, b)
      : richtung * a.datum.localeCompare(b.datum);
  };
  const vergleich =
    art === "alt"
      ? datum(1)
      : art === "titel"
        ? nachTitel
        : art === "gross"
          ? (a, b) => b.anzahl - a.anzahl || nachTitel(a, b)
          : datum(-1);
  return [...alben].sort(vergleich);
}

// Nach Jahr gruppiert nur bei einer Sortierung nach Datum; sonst eine Gruppe ohne Titel
export function gruppiere(alben, art) {
  const geordnet = sortiere(alben, art);
  if (art !== "neu" && art !== "alt") {
    return [{ schluessel: "", titel: "", alben: geordnet }];
  }
  const gruppen = [];
  for (const a of geordnet) {
    const j = jahrVon(a.datum);
    const s = j || OHNE_DATUM;
    let g = gruppen.at(-1);
    if (g?.schluessel !== s) {
      g = { schluessel: s, titel: j || "Ohne Datum", alben: [] };
      gruppen.push(g);
    }
    g.alben.push(a);
  }
  return gruppen;
}

// Welche Zeilen gebaut werden: höchstens «limit» aus den offenen Gruppen; geschlossene bauen keine Zeile
// offen(gruppe, index) liefert, ob die Gruppe aufgeklappt ist; liefert { gruppen: [{ …gruppe, offen, gezeigt }], rest }
export function schneide(gruppen, offen, limit) {
  let frei = limit;
  let rest = 0;
  const aus = gruppen.map((g, i) => {
    const istOffen = offen(g, i);
    const gezeigt = istOffen ? g.alben.slice(0, Math.max(frei, 0)) : [];
    frei -= gezeigt.length;
    if (istOffen) rest += g.alben.length - gezeigt.length;
    return { ...g, offen: istOffen, gezeigt };
  });
  return { gruppen: aus, rest };
}

// Welche Alben ein Sammelschritt wirklich ändert, in der Reihenfolge der Liste (Alben, die schon so stehen, fallen weg)
export const zuAendern = (alben, ids, sichtbar) =>
  alben.filter((a) => ids.has(a.id) && a.sichtbar !== sichtbar);

export const brauchtBestaetigung = (anzahlNeuSichtbar) =>
  anzahlNeuSichtbar > BESTAETIGEN_AB;

// ---------- Texte ----------

export const albenText = (n) => `${n} ${n === 1 ? "Album" : "Alben"}`;
export const fotosText = (n) => `${n} ${n === 1 ? "Foto" : "Fotos"}`;

// «23 von 87 Alben»; ohne Filter nur «87 Alben»
export const zaehlText = (treffer, gesamt) =>
  treffer === gesamt
    ? albenText(gesamt)
    : `${treffer} von ${gesamt} ${gesamt === 1 ? "Album" : "Alben"}`;

const monat = new Intl.DateTimeFormat("de-CH", {
  month: "short",
  year: "numeric",
});
// «Okt. 2026»; ohne gültiges Datum ein leerer Text
export const datumKurz = (iso) =>
  jahrVon(iso) ? monat.format(new Date(`${iso}T12:00:00`)) : "";

export const sammelText = (n, sichtbar) =>
  sichtbar
    ? `${albenText(n)} ${n === 1 ? "ist" : "sind"} jetzt auf der Website zu sehen.`
    : `${albenText(n)} ${n === 1 ? "ist" : "sind"} ausgeblendet.`;
