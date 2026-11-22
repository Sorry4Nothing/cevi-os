// Rich Text des Website-Editors (#358): Mini-Schreibweise im Textfeld <-> Knoten des Servers (src/website/bausteine.ts).
// Kein DOM, keine Abhängigkeit: Das Modul läuft auch im Test.
//
// Schreibweise:
//   Eine Zeile ist ein Absatz. Leere Zeilen trennen nur und beenden eine Liste.
//   **fett**, *kursiv*, [Text](Adresse)
//   Zeilen mit «- » sind eine Liste, Zeilen mit «1. » eine nummerierte Liste.
//   Ein Rückstrich nimmt dem nächsten Zeichen von \ * [ ] ( ) - . die Bedeutung.
// Ein Stern öffnet nur vor einem Zeichen und schliesst nur nach einem Zeichen (nie am Leerraum): «3 * 4 * 5» bleibt Text.
// Ein offener, nie geschlossener Stern oder eine Klammer ohne Adresse bleibt als Text stehen.

const ESC = "\\*[]()-.";
const LISTE_PUNKT = /^- +(\S.*)$/;
const LISTE_NUMMER = /^\d+\. +(\S.*)$/;

const istLeer = (z) => z === undefined || /\s/.test(z);

// Sucht das Ende von «[Text](Adresse)» ab dem «[» bei i; null, wenn es keinen Link ergibt
function findeLink(s, i) {
  let j = i + 1;
  while (j < s.length && s[j] !== "]") j += s[j] === "\\" ? 2 : 1;
  if (s[j] !== "]" || s[j + 1] !== "(") return null;
  let k = j + 2;
  let url = "";
  while (k < s.length && s[k] !== ")") {
    if (s[k] === "\\" && ESC.includes(s[k + 1] ?? "")) {
      url += s[k + 1];
      k += 2;
    } else {
      url += s[k];
      k += 1;
    }
  }
  if (s[k] !== ")" || url === "" || j === i + 1) return null;
  return { text: s.slice(i + 1, j), url, ende: k + 1 };
}

function tokenisiere(s, mitLink) {
  const tokens = [];
  let puffer = "";
  const leere = () => {
    if (puffer) tokens.push({ art: "text", v: puffer });
    puffer = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && ESC.includes(s[i + 1] ?? "")) {
      puffer += s[i + 1];
      i += 2;
    } else if (c === "*") {
      leere();
      const doppelt = s[i + 1] === "*";
      const laenge = doppelt ? 2 : 1;
      tokens.push({
        art: doppelt ? "fett" : "kursiv",
        roh: "*".repeat(laenge),
        oeffnet: !istLeer(s[i + laenge]),
        schliesst: !istLeer(s[i - 1]),
      });
      i += laenge;
    } else if (c === "[" && mitLink) {
      const link = findeLink(s, i);
      if (link) {
        leere();
        tokens.push({ art: "link", ...link });
        i = link.ende;
      } else {
        puffer += c;
        i += 1;
      }
    } else {
      puffer += c;
      i += 1;
    }
  }
  leere();
  return tokens;
}

// Paart die Marken je Art der Reihe nach; was keinen Partner hat, ist Text
function paare(tokens, art) {
  const gepaart = new Set();
  let offen = null;
  tokens.forEach((t, idx) => {
    if (t.art !== art) return;
    if (offen === null && t.oeffnet) offen = idx;
    else if (offen !== null && t.schliesst) {
      gepaart.add(offen).add(idx);
      offen = null;
    }
  });
  return gepaart;
}

function fuege(abschnitte, neu) {
  if (neu.text === "") return;
  const letzter = abschnitte.at(-1);
  if (
    letzter &&
    !!letzter.fett === !!neu.fett &&
    !!letzter.kursiv === !!neu.kursiv &&
    letzter.link === neu.link
  ) {
    letzter.text += neu.text;
  } else {
    abschnitte.push(neu);
  }
}

// Der Knoten des Servers lässt Marken weg statt «false»
function knoten({ text, fett, kursiv, link }) {
  return {
    text,
    ...(fett && { fett: true }),
    ...(kursiv && { kursiv: true }),
    ...(link && { link }),
  };
}

function abschnitteAus(s, mitLink = true, aussen = {}) {
  const tokens = tokenisiere(s, mitLink);
  const fett = paare(tokens, "fett");
  const kursiv = paare(tokens, "kursiv");
  const innen = [];
  const zustand = { fett: !!aussen.fett, kursiv: !!aussen.kursiv };
  tokens.forEach((t, idx) => {
    if (t.art === "text") {
      fuege(innen, { text: t.v, ...zustand, link: aussen.link });
    } else if (t.art === "fett" || t.art === "kursiv") {
      const paarig = (t.art === "fett" ? fett : kursiv).has(idx);
      if (paarig) zustand[t.art] = !zustand[t.art];
      else fuege(innen, { text: t.roh, ...zustand, link: aussen.link });
    } else {
      // Marken ausserhalb des Links gelten auch für seinen Text
      for (const a of abschnitteAus(t.text, false, {
        fett: zustand.fett,
        kursiv: zustand.kursiv,
        link: t.url,
      })) {
        fuege(innen, a);
      }
    }
  });
  return randlos(innen);
}

// Leerraum am Rand eines Abschnitts mit Marken oder Link gehört nicht dazu: Der Stern öffnet und schliesst dort nicht, und so bleibt die Umwandlung hin und zurück gleich
function randlos(abschnitte) {
  const aus = [];
  for (const a of abschnitte) {
    if (!a.fett && !a.kursiv && !a.link) {
      fuege(aus, a);
      continue;
    }
    const [, vorn, kern, hinten] = /^(\s*)([\s\S]*?)(\s*)$/.exec(a.text);
    if (kern === "") {
      fuege(aus, { text: a.text });
      continue;
    }
    fuege(aus, { text: vorn });
    fuege(aus, { ...a, text: kern });
    fuege(aus, { text: hinten });
  }
  // Am Anfang und Ende einer Zeile steht kein Leerraum (die Zeile ist zugeschnitten)
  if (aus.length > 0) {
    aus[0].text = aus[0].text.trimStart();
    aus.at(-1).text = aus.at(-1).text.trimEnd();
  }
  return aus.filter((a) => a.text !== "");
}

// Text aus dem Feld -> Knoten (Absatz oder flache Liste); leere Eingabe ergibt []
export function textZuBloecken(text) {
  const bloecke = [];
  let liste = null;
  for (const roh of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    // Steuerzeichen (Tabulator) werden zu Leerzeichen: Der Server lehnt sie ab
    const zeile = roh.replace(/\p{Cc}/gu, " ").trim();
    if (zeile === "") {
      liste = null;
      continue;
    }
    const punkt = LISTE_PUNKT.exec(zeile);
    const nummer = punkt ? null : LISTE_NUMMER.exec(zeile);
    const eintrag = punkt ?? nummer;
    if (eintrag) {
      const abschnitte = abschnitteAus(eintrag[1]).map(knoten);
      if (abschnitte.length === 0) continue;
      const geordnet = nummer !== null;
      if (liste === null || liste.geordnet !== geordnet) {
        liste = { typ: "liste", geordnet, eintraege: [] };
        bloecke.push(liste);
      }
      liste.eintraege.push(abschnitte);
      continue;
    }
    liste = null;
    const abschnitte = abschnitteAus(zeile).map(knoten);
    if (abschnitte.length > 0) {
      bloecke.push({ typ: "absatz", inhalt: abschnitte });
    }
  }
  return bloecke;
}

const maskiere = (s, zeichen) =>
  s.replace(/[\\*[\]()]/g, (z) => (zeichen.includes(z) ? `\\${z}` : z));

// Kern eines Abschnitts als Text, mit Rückstrichen und Link; der Leerraum am Rand steht ausserhalb
function abschnittZuText(a) {
  const [, vorn, kern, hinten] = /^(\s*)([\s\S]*?)(\s*)$/.exec(a.text);
  if (kern === "") return { vorn: a.text, kern: "", hinten: "" };
  const t = a.link
    ? `[${maskiere(kern, "\\*[]")}](${maskiere(a.link, "\\)")})`
    : maskiere(kern, "\\*[");
  return { vorn, kern: t, hinten };
}

// Marken öffnen und schliessen sich nach dem Wechsel von Abschnitt zu Abschnitt; Leerraum am Rand steht nie innerhalb (der Stern öffnet und schliesst dort nicht)
function abschnitteZuText(abschnitte) {
  let aus = "";
  let fett = false;
  let kursiv = false;
  const schliesse = () => {
    if (fett) aus += "**";
    if (kursiv) aus += "*";
    fett = kursiv = false;
  };
  for (const a of abschnitte) {
    const { vorn, kern, hinten } = abschnittZuText(a);
    if (kern === "") {
      schliesse();
      aus += vorn;
      continue;
    }
    if (fett && !a.fett) {
      aus += "**";
      fett = false;
    }
    if (kursiv && !a.kursiv) {
      aus += "*";
      kursiv = false;
    }
    // Leerraum vor dem Kern steht ausserhalb der Marken
    if (vorn !== "") schliesse();
    aus += vorn;
    if (a.fett && !fett) {
      aus += "**";
      fett = true;
    }
    if (a.kursiv && !kursiv) {
      aus += "*";
      kursiv = true;
    }
    aus += kern;
    if (hinten !== "") {
      schliesse();
      aus += hinten;
    }
  }
  schliesse();
  return aus;
}

// Die erste Zeichenfolge einer Zeile darf nie wie ein Listenzeichen aussehen
const schuetzeAnfang = (z) =>
  /^- /.test(z) ? `\\${z}` : z.replace(/^(\d+)\. /, (_, n) => `${n}\\. `);

// Knoten -> Text für das Feld
export function bloeckeZuText(bloecke) {
  return bloecke
    .map((b) => {
      if (b.typ === "absatz") return schuetzeAnfang(abschnitteZuText(b.inhalt));
      return b.eintraege
        .map(
          (e, i) => `${b.geordnet ? `${i + 1}.` : "-"} ${abschnitteZuText(e)}`,
        )
        .join("\n");
    })
    .join("\n\n");
}

// Zeichen im Text der Knoten, wie der Server sie zählt (für die Anzeige «n von 20000»)
export function zaehleZeichen(bloecke) {
  return bloecke.reduce(
    (summe, b) =>
      summe +
      (b.typ === "absatz" ? [b.inhalt] : b.eintraege)
        .flat()
        .reduce((n, a) => n + a.text.length, 0),
    0,
  );
}
