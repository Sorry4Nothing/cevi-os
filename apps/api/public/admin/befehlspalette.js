// Suche der Verwaltung (#602, #611): Strg oder Cmd + K öffnet ein Suchfeld über der Seite. Es findet Seiten der Verwaltung, Personen, Gruppen, Termine, Anlässe, Seiten der Website und Lager, mit den Angaben, die man zum Erkennen braucht (Bild, Rollen, Gruppen, Zustand, Datum).
// Muster «Action Search Bar» (Feld, Reiter mit Zahlen, Gruppen, Tastenhilfe), «Team Member List» (Zeile mit Bild, Angaben und Zustand) und «Slash Command Menu» (Treffer im Text) von Kokonut UI Pro als Vorlage; Code und Stil sind eigen.
// Nie Daten ohne Recht: Eine Gruppe erscheint nur, wenn die Navigation der Person die zugehörige Seite zeigt, und ihre Daten kommen aus den Routen, die diese Seite ohnehin aufruft (der Server prüft jede). Kinderdaten sind nie dabei.
// Last: keine Abfrage je Tastendruck. Beim Öffnen eine Abfrage je Quelle, nur mit Recht; danach liegt das Ergebnis fünf Minuten im Speicher und die Suche filtert im Browser. Hat die Seite «Personen» ihre Liste schon geladen, übergibt sie sie (`meldePersonen`).
// Es ist die einzige Überlagerung der Verwaltung: Ein Suchfeld mit Tastaturbedienung braucht den Fokus in einer Schicht, die Escape schliesst und den Fokus zurückgibt (nativer `dialog`).
import { anfrage } from "./api.js";
import {
  avatar,
  chip,
  el,
  icon,
  neueId,
  rufname,
  vollerNameZusatz,
} from "./dom.js";
import { adresseVon } from "./navigation.js";

/* ---------- Gruppen ---------- */

// Reihenfolge der Gruppen in der Liste. recht: [Bereich, Unterseite], die die Navigation der Person zeigen muss; reiter: kurzer Name im Reiter; plural: wie «Alle 12 … anzeigen» die Gruppe nennt
const GRUPPEN = [
  { schluessel: "aktionen", name: "Aktionen", symbol: "plus" },
  {
    schluessel: "seiten",
    name: "Seiten der Verwaltung",
    reiter: "Seiten",
    plural: "Seiten",
    symbol: "uebersicht",
  },
  {
    schluessel: "personen",
    name: "Personen",
    plural: "Personen",
    symbol: "personen",
    recht: ["personen", "personen"],
  },
  {
    schluessel: "tags",
    name: "Gruppen und Tags",
    reiter: "Gruppen",
    plural: "Gruppen",
    symbol: "tag",
    recht: ["personen", "gruppen"],
  },
  {
    schluessel: "termine",
    name: "Termine",
    plural: "Termine",
    symbol: "termine",
    recht: ["termine", "kalender"],
  },
  {
    schluessel: "anlaesse",
    name: "Anlässe",
    plural: "Anlässe",
    symbol: "stern",
    recht: ["anlaesse", "anlaesse"],
  },
  {
    schluessel: "website",
    name: "Website-Seiten",
    reiter: "Website",
    plural: "Website-Seiten",
    symbol: "website",
    recht: ["website", "seiten"],
  },
  {
    schluessel: "lager",
    name: "Lager",
    plural: "Lager",
    symbol: "haken",
    recht: ["lager", "lager"],
  },
];
const ZULETZT = { schluessel: "zuletzt", name: "Zuletzt benutzt" };
const GRUPPE = Object.fromEntries(GRUPPEN.map((g) => [g.schluessel, g]));

// So viele Zeilen zeigt eine Gruppe im Reiter «Alle»; im eigenen Reiter gilt die grosse Grenze. Ohne Frage zeigt «Alle» nur Aktionen und die ersten Seiten.
const KAPPE = {
  aktionen: 3,
  seiten: 6,
  personen: 6,
  tags: 4,
  termine: 5,
  anlaesse: 3,
  website: 5,
  lager: 3,
};
const KAPPE_REITER = 60;
const KAPPE_OHNE_FRAGE = { aktionen: 3, seiten: 8 };
const ZULETZT_MAX = 5;

const hatSeite = (bereiche, bereich, unter) =>
  bereiche.some(
    (b) =>
      b.schluessel === bereich && b.unter.some((u) => u.schluessel === unter),
  );

// Welche Gruppen mit eigenem Reiter die Person sehen darf, in der Reihenfolge der Liste (ohne die Aktionen)
export function erlaubteGruppen(bereiche) {
  return GRUPPEN.filter((g) =>
    g.recht
      ? hatSeite(bereiche, ...g.recht)
      : g.schluessel === "seiten" && bereiche.length > 0,
  ).map((g) => g.schluessel);
}

/* ---------- Text vergleichen ---------- */

const UMLAUTE = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

// Klein, ohne Akzente, Umlaute als «ae oe ue»; von[i] sagt, aus welcher Stelle des Originals das Zeichen i der Faltung stammt (für das Hervorheben)
function faltung(text) {
  let s = "";
  const von = [];
  for (let i = 0; i < text.length; i++) {
    const klein = text[i].toLowerCase();
    const ersatz = UMLAUTE[klein] ?? klein.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const c of ersatz) {
      s += c;
      von.push(i);
    }
  }
  return { s, von };
}
const glatt = (text) => faltung(text).s;
const woerterVon = (frage) => glatt(frage).split(/\s+/).filter(Boolean);
const wortGrenze = (z) => z === undefined || /[\s\-./·]/.test(z);

// Stellen des Texts, an denen ein Wort der Frage vorkommt, als [von, bis) im Original; berührende Stellen sind verschmolzen
export function trefferStellen(frage, text) {
  const woerter = woerterVon(frage);
  if (woerter.length === 0 || !text) return [];
  const { s, von } = faltung(text);
  const stellen = [];
  for (const w of woerter) {
    for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + w.length)) {
      stellen.push([von[i], von[i + w.length - 1] + 1]);
    }
  }
  stellen.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const verschmolzen = [];
  for (const st of stellen) {
    const letzte = verschmolzen.at(-1);
    if (letzte && st[0] <= letzte[1]) letzte[1] = Math.max(letzte[1], st[1]);
    else verschmolzen.push([...st]);
  }
  return verschmolzen;
}

// Alle Wörter der Frage müssen in irgendeinem Feld vorkommen; ein Treffer am Wortanfang zählt doppelt, ein Feld mit mehr Gewicht mehr. null = kein Treffer, 0 = keine Frage
// felder: [[Text, Gewicht], …]
export function bewerte(frage, felder) {
  const woerter = woerterVon(frage);
  if (woerter.length === 0) return 0;
  const gefaltet = felder.map(([text, gewicht]) => [
    glatt(text ?? ""),
    gewicht,
  ]);
  let summe = 0;
  for (const w of woerter) {
    let best = 0;
    for (const [heu, gewicht] of gefaltet) {
      const i = heu.indexOf(w);
      if (i >= 0)
        best = Math.max(best, gewicht * (wortGrenze(heu[i - 1]) ? 2 : 1));
    }
    if (best === 0) return null;
    summe += best;
  }
  return summe;
}

// Ein Text gegen eine Frage: wie bewerte() mit einem Feld
export const punkte = (frage, text) => bewerte(frage, [[text, 1]]);

/* ---------- Kandidaten und Treffer (reine Funktionen) ---------- */

// Alle Einträge, die die Person finden darf: die Seiten ihrer Navigation (bereiche) und die geladenen Daten. Eine Gruppe ohne Recht bleibt leer, auch wenn Daten da sind.
// daten: { personen, tags, termine, anlaesse, seiten, lager } in der Form der Quellen unten; fehlt eine, fehlt die Gruppe
export function kandidaten({ bereiche, daten = {} }) {
  const liste = [];
  const hat = (b, u) => hatSeite(bereiche, b, u);
  if (hat("personen", "personen")) {
    liste.push({
      gruppe: "aktionen",
      id: "aktion-person-neu",
      titel: "Neue Person",
      zusatz: "Person erfassen",
      symbol: "plus",
      suche: [
        ["Neue Person", 4],
        ["erfassen anlegen hinzufügen", 1],
      ],
      adresse: "#personen/personen",
      wunsch: { art: "neu" },
    });
  }
  if (hat("lager", "lager")) {
    liste.push({
      gruppe: "aktionen",
      id: "aktion-lager-neu",
      titel: "Neues Lager",
      zusatz: "Lager anlegen",
      symbol: "plus",
      suche: [
        ["Neues Lager", 4],
        ["anlegen erstellen hinzufügen", 1],
      ],
      adresse: "#lager/lager/neu",
    });
  }
  for (const b of bereiche) {
    for (const u of b.unter) {
      liste.push({
        gruppe: "seiten",
        id: `seite-${b.schluessel}/${u.schluessel}`,
        titel: u.name,
        zusatz: u.untertitel ?? "",
        bereichName: b.unter.length > 1 && b.name !== u.name ? b.name : "",
        symbol: b.symbol,
        suche: [
          [u.name, 4],
          [b.name, 2],
          [u.untertitel ?? "", 1],
        ],
        adresse: adresseVon(b, u),
      });
    }
  }
  if (hat("personen", "personen")) {
    for (const p of daten.personen ?? []) {
      liste.push({
        gruppe: "personen",
        id: `person-${p.id}`,
        titel: rufname(p),
        zusatz: vollerNameZusatz(p),
        personId: p.id,
        bildUrl: p.bildUrl,
        rollen: p.rollen,
        tags: p.tags,
        konto: p.konto,
        suche: [
          [p.name, 4],
          [p.ceviName, 4],
          [p.benutzername, 1],
          [p.rollen.join(" "), 2],
          [p.tags.map((t) => t.name).join(" "), 2],
        ],
        adresse: "#personen/personen",
        wunsch: { art: "person", frage: p.name, id: p.id },
      });
    }
  }
  if (hat("personen", "gruppen")) {
    for (const t of daten.tags ?? []) {
      liste.push({
        gruppe: "tags",
        id: `tag-${t.id}`,
        titel: t.name,
        zusatz: t.kuerzel,
        typText: t.typText,
        mitglieder: t.anzahlPersonen,
        suche: [
          [t.name, 4],
          [t.kuerzel, 3],
          [t.typText, 1],
        ],
        adresse: `#personen/gruppen/${t.id}`,
      });
    }
  }
  if (hat("termine", "kalender")) {
    for (const t of daten.termine ?? []) {
      liste.push({
        gruppe: "termine",
        id: `termin-${t.id}`,
        titel: t.titel,
        zusatz: t.ort,
        tagIso: t.tagIso,
        datumText: t.datumText,
        zeitText: t.zeitText,
        gruppen: t.gruppen,
        anlass: t.anlass,
        status: t.status,
        suche: [
          [t.titel, 4],
          [t.ort, 1],
          [t.gruppen.join(" "), 2],
          [t.datumText, 1],
        ],
        adresse: `#termine/kalender/${t.tagIso}`,
      });
    }
  }
  if (hat("anlaesse", "anlaesse")) {
    for (const a of daten.anlaesse ?? []) {
      liste.push({
        gruppe: "anlaesse",
        id: `anlass-${a.id}`,
        titel: a.titel,
        zusatz: a.fuer,
        zeitText: a.zeitText,
        status: a.status,
        suche: [
          [a.titel, 4],
          [a.zeitText, 1],
          [a.status.text, 1],
        ],
        adresse: `#anlaesse/${a.id}`,
      });
    }
  }
  if (hat("website", "seiten")) {
    for (const s of daten.seiten ?? []) {
      liste.push({
        gruppe: "website",
        id: `webseite-${s.id}`,
        titel: s.titel,
        zusatz: s.pfad,
        zugang: s.zugang,
        status: s.status,
        suche: [
          [s.titel, 4],
          [s.pfad, 2],
        ],
        adresse: `#website/seiten/${s.id}`,
      });
    }
  }
  if (hat("lager", "lager")) {
    for (const l of daten.lager ?? []) {
      liste.push({
        gruppe: "lager",
        id: `lager-${l.id}`,
        titel: l.titel,
        zusatz: l.ort,
        zeitraum: l.zeitraum,
        status: l.status,
        suche: [
          [l.titel, 4],
          [l.ort, 2],
          [l.zeitraum, 1],
          [l.status.text, 1],
        ],
        adresse: `#lager/lager/${l.id}`,
      });
    }
  }
  return liste;
}

// Die Abschnitte der Liste für eine Frage und einen Reiter
// scope: «alle» oder der Schlüssel einer Gruppe; zuletzt: Kennungen der zuletzt gewählten Einträge, neueste zuerst
// Rückgabe: { abschnitte: [{ gruppe, eintraege, mehr }], zaehler: { alle, <gruppe>… } }; mehr = wie viele Treffer die Kappung weglässt
export function suchen({ liste, frage, scope = "alle", zuletzt = [] }) {
  const q = frage.trim();
  const treffer = new Map(GRUPPEN.map((g) => [g.schluessel, []]));
  for (const e of liste) {
    const p = q ? bewerte(q, e.suche) : 0;
    if (p !== null) treffer.get(e.gruppe).push({ e, p });
  }
  const zaehler = { alle: 0 };
  for (const g of GRUPPEN) {
    const t = treffer.get(g.schluessel);
    // Mit Frage zuerst die besten; bei gleichen Punkten bleibt die Reihenfolge der Quelle
    if (q) t.sort((a, b) => b.p - a.p);
    zaehler[g.schluessel] = t.length;
    if (g.schluessel !== "aktionen") zaehler.alle += t.length;
  }
  const abschnitt = (g, kappe) => {
    const alle = treffer.get(g.schluessel).map((t) => t.e);
    return {
      gruppe: g,
      eintraege: alle.slice(0, kappe),
      mehr: Math.max(0, alle.length - kappe),
    };
  };
  let abschnitte = [];
  if (scope === "alle" && !q) {
    const bekannt = new Map(liste.map((e) => [e.id, e]));
    const juengste = zuletzt
      .map((id) => bekannt.get(id))
      .filter(Boolean)
      .slice(0, ZULETZT_MAX);
    abschnitte = [
      { gruppe: ZULETZT, eintraege: juengste, mehr: 0 },
      ...["aktionen", "seiten"].map((s) =>
        abschnitt(GRUPPE[s], KAPPE_OHNE_FRAGE[s]),
      ),
    ];
  } else if (scope === "alle") {
    // Die Gruppe mit dem besten Treffer steht oben, damit Enter das Wahrscheinlichste öffnet; bei Gleichstand gilt die Reihenfolge der Gruppen, und eine Aktion steht hinter einem gleich guten Inhalt
    const beste = (g) =>
      (treffer.get(g.schluessel)[0]?.p ?? -1) -
      (g.schluessel === "aktionen" ? 1 : 0);
    abschnitte = GRUPPEN.map((g) => abschnitt(g, KAPPE[g.schluessel])).sort(
      (a, b) => beste(b.gruppe) - beste(a.gruppe),
    );
  } else if (GRUPPE[scope]) {
    abschnitte = [abschnitt(GRUPPE[scope], KAPPE_REITER)];
  }
  return {
    abschnitte: abschnitte.filter((a) => a.eintraege.length > 0),
    zaehler,
  };
}

// Ein Satz, der sagt, was sich suchen lässt
export function tippText(gruppen) {
  const teile = [];
  if (gruppen.includes("personen")) teile.push("einen Namen oder Cevi-Namen");
  teile.push("eine Seite");
  if (gruppen.includes("tags")) teile.push("eine Gruppe");
  if (gruppen.includes("termine")) teile.push("einen Termin");
  if (gruppen.includes("anlaesse")) teile.push("einen Anlass");
  if (gruppen.includes("website")) teile.push("eine Website-Seite");
  if (gruppen.includes("lager")) teile.push("ein Lager");
  const letzte = teile.pop();
  return `Tippe ${teile.length ? `${teile.join(", ")} oder ${letzte}` : letzte}.`;
}

/* ---------- Daten laden und im Speicher halten ---------- */

const GUELTIG_MS = 5 * 60 * 1000;
const speicher = { stand: new Map(), daten: {}, konto: null, lauf: 0 };

// Beim Abmelden und beim Wechsel des Kontos: nichts bleibt im Speicher
export function vergiss() {
  speicher.stand.clear();
  speicher.daten = {};
  speicher.konto = null;
  speicher.lauf += 1;
}

// Hilfen aus den Modulen der Personenliste (Rollen als Klartext, Konto-Chip, Name des Tag-Typs); erst beim ersten Bedarf geladen
let helferVersprechen = null;
let helfer = null;
const holeHelfer = () =>
  (helferVersprechen ??= Promise.all([
    import("./personen-blatt.js"),
    import("./tags-detail.js"),
  ]).then(([blatt, tags]) => {
    helfer = {
      systemRollen: blatt.systemRollen,
      kontoChips: blatt.kontoChips,
      typName: tags.typName,
    };
    return helfer;
  }));

// Nur diese Felder einer Person bleiben im Speicher. Nie startpasswort, Telefon oder Kinder: Die Liste der API enthält sie, die Suche braucht sie nicht.
// tags: [{ tag, rolle }] wie in personen.js
export function normalisierePerson(p, tags, h) {
  return {
    id: p.id,
    name: p.name,
    ceviName: p.ceviName ?? "",
    benutzername: p.benutzername ?? "",
    bildUrl: p.bildUrl ?? null,
    rollen: h.systemRollen(p),
    tags: tags.map((e) => ({ name: e.tag.name, typ: e.tag.typ })),
    konto: {
      deaktiviert: p.deaktiviert,
      mussPasswortAendern: p.mussPasswortAendern,
      startpasswortGueltigBis: p.startpasswortGueltigBis ?? null,
      zweiterFaktor: p.zweiterFaktor,
    },
  };
}
const normalisiereTag = (t, h) => ({
  id: t.id,
  name: t.name,
  typ: t.typ,
  typText: h.typName(t.typ),
  kuerzel: t.kuerzel ?? "",
  anzahlPersonen: t.anzahlPersonen,
});

// daten: das Ergebnis von ladeDaten() aus personen.js (personen, tags, tagsJePerson)
const normalisierePersonenDaten = (daten, h) => ({
  personen: daten.personen.map((p) =>
    normalisierePerson(p, daten.tagsJePerson.get(p.id) ?? [], h),
  ),
  tags: daten.tags.map((t) => normalisiereTag(t, h)),
});

// Die Seite «Personen» hat ihre Liste geladen: Die Palette übernimmt sie, statt selbst zu fragen
export function meldePersonen(daten, h) {
  helfer = h;
  Object.assign(speicher.daten, normalisierePersonenDaten(daten, h));
  speicher.stand.set("personen", { status: "bereit", zeit: Date.now() });
}

// Eine Quelle je Abfrage-Gruppe: wohin ihr Ergebnis in speicher.daten kommt, ergibt sich aus dem Rückgabeobjekt
const QUELLEN = {
  personen: {
    name: "Personen",
    gruppe: "personen",
    lade: async () => {
      const [{ ladeDaten }, h] = await Promise.all([
        import("./personen.js"),
        holeHelfer(),
      ]);
      return normalisierePersonenDaten(await ladeDaten(), h);
    },
  },
  tags: {
    name: "Gruppen",
    gruppe: "tags",
    lade: async () => {
      const h = await holeHelfer();
      const { tags } = await anfrage("GET", "/api/v1/admin/tags");
      return { tags: tags.map((t) => normalisiereTag(t, h)) };
    },
  },
  termine: {
    name: "Termine",
    gruppe: "termine",
    lade: async () => {
      const k = await import("./kalenderhilfen.js");
      const heute = k.heuteZuerich();
      const { termine } = await anfrage(
        "GET",
        `/api/v1/termine/alle?von=${heute}&bis=${k.plusTage(heute, 92)}&limit=100`,
      );
      const tagIn = new Intl.DateTimeFormat("sv-SE", { timeZone: k.ZONE });
      return {
        termine: termine.map((t) => {
          const anzeige = k.terminAnzeige(t);
          return {
            id: t.id,
            titel: t.titel,
            ort: t.ort ?? "",
            tagIso: t.ganztaegig ? t.tagVon : tagIn.format(new Date(t.beginn)),
            datumText: anzeige.tag,
            zeitText: anzeige.zeit,
            gruppen: t.tags.map((g) => g.name),
            anlass: Boolean(t.anlass),
            status:
              t.status === "abgesagt"
                ? { text: "Abgesagt", art: "fehler" }
                : t.status === "pruefen"
                  ? { text: "Zu prüfen", art: "warn" }
                  : null,
          };
        }),
      };
    },
  },
  anlaesse: {
    name: "Anlässe",
    gruppe: "anlaesse",
    lade: async () => {
      const k = await import("./kalenderhilfen.js");
      const { anlaesse } = await anfrage(
        "GET",
        "/api/v1/admin/anlaesse?limit=50",
      );
      const heute = k.heuteZuerich();
      return {
        anlaesse: anlaesse.map((a) => {
          const vorbei = a.ganztaegig
            ? a.tagBis < heute
            : new Date(a.ende) < new Date();
          return {
            id: a.id,
            titel: a.titel,
            fuer: a.anmeldungFuer === "kind" ? "Anmeldung für Kinder" : "",
            zeitText: k.zeitraumText(a),
            status: vorbei
              ? { text: "Termin vorbei" }
              : !a.anmeldungOffen
                ? { text: "Anmeldung geschlossen", art: "warn" }
                : a.frist && new Date(a.frist) < new Date()
                  ? { text: "Frist vorbei", art: "warn" }
                  : { text: "Anmeldung offen", art: "ok" },
          };
        }),
      };
    },
  },
  website: {
    name: "Website-Seiten",
    gruppe: "website",
    lade: async () => {
      const { seiten } = await anfrage("GET", "/api/v1/redaktion/seiten");
      const zugang = (s) =>
        s.art === "oeffentlich"
          ? "Öffentlich"
          : s.art === "angemeldet"
            ? "Nur angemeldet"
            : "Bestimmte Gruppen";
      return {
        seiten: seiten
          .map((s) => ({
            id: s.id,
            titel: s.titel,
            pfad: s.pfad,
            zugang: zugang(s.sichtbarkeit ?? {}),
            status: s.veroeffentlicht
              ? { text: "Veröffentlicht", art: "ok" }
              : { text: "Entwurf", art: "warn" },
          }))
          .sort((a, b) => a.pfad.localeCompare(b.pfad, "de-CH")),
      };
    },
  },
  lager: {
    name: "Lager",
    gruppe: "lager",
    lade: async () => {
      const g = await import("./lager-gemeinsam.js");
      const { lager } = await anfrage("GET", g.BASIS);
      return {
        lager: lager.map((l) => ({
          id: l.id,
          titel: l.titel,
          ort: l.ort ?? "",
          zeitraum: g.zeitraum(l.von, l.bis),
          status: {
            text: g.STATUSNAME[l.status] ?? l.status,
            art:
              l.status === "aktiv"
                ? "ok"
                : l.status === "entwurf"
                  ? "warn"
                  : undefined,
          },
        })),
      };
    },
  },
};

// Welche Quellen die Person abfragen darf: die einer Gruppe nur mit deren Recht. «tags» fragt nur, wenn die Liste «Personen» fehlt: sie bringt die Gruppen mit.
export function quellenFuer(bereiche) {
  const erlaubt = erlaubteGruppen(bereiche);
  return Object.keys(QUELLEN).filter(
    (name) =>
      erlaubt.includes(QUELLEN[name].gruppe) &&
      !(name === "tags" && erlaubt.includes("personen")),
  );
}

// Startet jede Quelle, die fehlt oder älter als fünf Minuten ist; je Quelle höchstens eine Abfrage zugleich. beiFertig läuft nach jeder.
function starteLaden(bereiche, beiFertig) {
  for (const name of quellenFuer(bereiche)) {
    const alt = speicher.stand.get(name);
    if (alt?.status === "laedt") continue;
    if (alt?.status === "bereit" && Date.now() - alt.zeit < GUELTIG_MS)
      continue;
    const lauf = speicher.lauf;
    // Mit altem Ergebnis (zeit > 0) bleibt die Liste stehen, während die neue Abfrage läuft
    speicher.stand.set(name, { status: "laedt", zeit: alt?.zeit ?? 0 });
    QUELLEN[name]
      .lade()
      .then(
        (wert) => {
          if (lauf !== speicher.lauf) return;
          Object.assign(speicher.daten, wert);
          speicher.stand.set(name, { status: "bereit", zeit: Date.now() });
        },
        () => {
          if (lauf !== speicher.lauf) return;
          speicher.stand.set(name, { status: "fehler", zeit: Date.now() });
        },
      )
      .finally(() => lauf === speicher.lauf && beiFertig());
  }
}

/* ---------- Wunsch an die nächste Seite ---------- */

// «Neue Person» öffnet das Formular, eine Person setzt die Suche und den Fokus. Die Seite holt den Wunsch mit `nimmWunsch` ab; er gilt genau einmal.
let wunsch = null;
export function nimmWunsch() {
  const w = wunsch;
  wunsch = null;
  return w;
}

const istMac = () => /Mac|iPhone|iPad/.test(navigator.platform ?? "");
export const kuerzelText = () => (istMac() ? "⌘ K" : "Strg K");

/* ---------- Zeilen ---------- */

// Text als Liste von Teilen mit hervorgehobenen Treffern (mark); ohne Treffer bleibt er Text
function markiert(text, frage) {
  if (!text) return [];
  const stellen = trefferStellen(frage, text);
  if (stellen.length === 0) return [text];
  const teile = [];
  let pos = 0;
  for (const [a, b] of stellen) {
    if (a > pos) teile.push(text.slice(pos, a));
    teile.push(el("mark", { class: "palette-treffer" }, text.slice(a, b)));
    pos = b;
  }
  if (pos < text.length) teile.push(text.slice(pos));
  return teile;
}

const MONATE = new Intl.DateTimeFormat("de-CH", {
  month: "short",
  timeZone: "UTC",
});
// Kachel mit Tag und Monat für einen Termin; das Datum steht daneben auch als Text
function datumKachel(tagIso) {
  const d = new Date(`${tagIso}T12:00:00Z`);
  return el(
    "span",
    { class: "pz-datum", "aria-hidden": "true" },
    el("span", { class: "pz-datum-tag" }, String(d.getUTCDate())),
    el("span", { class: "pz-datum-monat" }, MONATE.format(d).replace(".", "")),
  );
}
const symbolKachel = (name) =>
  el("span", { class: "pz-symbol", "aria-hidden": "true" }, icon(name));
const hatInhalt = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
const chipListe = (...chips) => {
  const echte = chips.flat().filter(Boolean);
  return echte.length ? el("ul", { class: "chips" }, echte) : null;
};

// Der Inhalt einer Zeile in Feldern (links, titel, zusatz, meta, chips, status); wie sie liegen, steht im CSS
function zeileFelder(e, frage, h, ichId) {
  const m = (t) => markiert(t, frage);
  switch (e.gruppe) {
    case "personen": {
      const gezeigt = e.tags.slice(0, 3);
      return {
        links: avatar(e.titel, { hell: true, bildUrl: e.bildUrl }),
        titel: [...m(e.titel), e.personId === ichId && " (du)"],
        zusatz: m(e.zusatz),
        meta: e.rollen.length
          ? m(e.rollen.join(", "))
          : el("span", { class: "leise" }, "Keine Rolle"),
        chips: chipListe(
          gezeigt.map((t) =>
            chip(t.name, t.typ === "stufe" ? "stufe" : undefined, "tag"),
          ),
          e.tags.length > gezeigt.length &&
            chip(`+${e.tags.length - gezeigt.length}`, undefined, false),
        ),
        // Nur der Zustand des Kontos; der zweite Faktor steht in der Personenliste
        status: h ? chipListe(h.kontoChips(e.konto)[0]) : null,
      };
    }
    case "tags":
      return {
        links: symbolKachel("tag"),
        titel: m(e.titel),
        zusatz: m(e.zusatz),
        meta: e.typText,
        status: el(
          "span",
          { class: "pz-zahl" },
          e.mitglieder === 1 ? "1 Mitglied" : `${e.mitglieder} Mitglieder`,
        ),
      };
    case "termine":
      return {
        links: datumKachel(e.tagIso),
        titel: m(e.titel),
        zusatz: m(e.zusatz),
        meta: [
          el("span", { class: "pz-zeile" }, m(e.datumText)),
          el("span", { class: "pz-zeile leise" }, e.zeitText),
        ],
        chips: chipListe(e.gruppen.map((g) => chip(g, "stufe", "tag"))),
        status: chipListe(
          e.anlass && chip("Anlass", undefined, "stern"),
          e.status && chip(e.status.text, e.status.art),
        ),
      };
    case "anlaesse":
      return {
        links: symbolKachel("stern"),
        titel: m(e.titel),
        zusatz: e.zusatz,
        meta: e.zeitText,
        status: chipListe(chip(e.status.text, e.status.art)),
      };
    case "website":
      return {
        links: symbolKachel("website"),
        titel: m(e.titel),
        zusatz: el("span", { class: "pz-adresse" }, m(e.zusatz)),
        meta: e.zugang,
        status: chipListe(chip(e.status.text, e.status.art)),
      };
    case "lager":
      return {
        links: symbolKachel("haken"),
        titel: m(e.titel),
        zusatz: m(e.zusatz),
        meta: e.zeitraum,
        status: chipListe(chip(e.status.text, e.status.art)),
      };
    case "aktionen":
      return {
        links: symbolKachel(e.symbol),
        titel: m(e.titel),
        zusatz: e.zusatz,
      };
    default: {
      // Seite der Verwaltung: Titel, was sie zeigt, wo sie steht; «Du bist hier» für die offene
      const hier =
        e.adresse === window.location.hash ||
        (e.adresse === "#uebersicht" && window.location.hash === "");
      return {
        links: symbolKachel(e.symbol),
        titel: m(e.titel),
        zusatz: e.zusatz,
        meta: e.bereichName ? `${e.bereichName} › ${e.titel}` : "",
        status: hier ? chipListe(chip("Du bist hier", "stufe", "haken")) : null,
      };
    }
  }
}

/* ---------- Palette ---------- */

// Palette bauen: gibt { oeffne, knopf, vergiss } zurück.
// bereiche(): die jetzt sichtbaren Bereiche der Person (navigation.js); bereit(): false vor der Anmeldung (dann tut das Kürzel nichts); ich(): Kennung des Kontos (für «(du)» und das Leeren des Speichers beim Wechsel)
export function erstellePalette({
  bereiche,
  bereit = () => true,
  ich = () => null,
}) {
  let offen = null;
  // Zuletzt gewählte Einträge dieser Sitzung; nur im Speicher, nie auf dem Gerät
  let zuletzt = [];

  function oeffne() {
    if (offen || !bereit()) return;
    const konto = ich();
    // Ein anderes Konto erbt nichts; ohne bekanntes Konto (die Liste «Personen» hat schon etwas übergeben) bleibt der Speicher
    if (speicher.konto !== null && speicher.konto !== konto) vergiss();
    speicher.konto = konto;
    const sichtbar = bereiche();
    const erlaubt = erlaubteGruppen(sichtbar);
    const listeId = neueId("palette-liste");
    let scope = "alle";
    let optionen = [];
    let aktiv = 0;
    let aktivId = null;

    const eingabe = el("input", {
      class: "palette-eingabe",
      type: "text",
      role: "combobox",
      "aria-label": "Suchen",
      "aria-expanded": "true",
      "aria-controls": listeId,
      "aria-autocomplete": "list",
      placeholder: erlaubt.includes("personen")
        ? "Person, Seite, Gruppe, Termin oder Lager suchen"
        : "Seite suchen",
      autocomplete: "off",
      spellcheck: "false",
    });
    const leeren = el(
      "button",
      {
        type: "button",
        class: "palette-icon",
        "aria-label": "Eingabe löschen",
        hidden: true,
        onclick: () => {
          eingabe.value = "";
          neueFrage();
          eingabe.focus();
        },
      },
      icon("schliessen"),
    );
    const reiter = el(
      "div",
      {
        class: "palette-reiter",
        role: "tablist",
        "aria-label": "Suche eingrenzen",
      },
      [
        ["alle", "Alle"],
        ...GRUPPEN.filter((g) => erlaubt.includes(g.schluessel)).map((g) => [
          g.schluessel,
          g.reiter ?? g.name,
        ]),
      ].map(([wert, text]) =>
        el(
          "button",
          {
            type: "button",
            class: "palette-reiter-knopf",
            role: "tab",
            id: `${listeId}-reiter-${wert}`,
            "aria-controls": listeId,
            "data-reiter": wert,
            onclick: (ev) => {
              wechsle(wert);
              // Mit der Maus geht es im Feld weiter; mit der Tastatur bleibt der Fokus im Reiter
              if (ev.detail > 0) eingabe.focus();
            },
          },
          text,
          " ",
          el("span", { class: "n" }, "0"),
        ),
      ),
    );
    const liste = el("div", {
      class: "palette-liste",
      id: listeId,
      role: "listbox",
      "aria-label": "Treffer",
    });
    const tipp = el("p", { class: "palette-tipp" });
    const lade = el("div", { class: "palette-lade", hidden: true });
    const status = el("p", {
      class: "nur-leser",
      role: "status",
      "aria-live": "polite",
    });
    const dialog = el(
      "dialog",
      { class: "palette", "aria-label": "Suche" },
      el(
        "div",
        { class: "palette-karte" },
        el(
          "div",
          { class: "palette-kopf" },
          icon("lupe"),
          eingabe,
          leeren,
          el("kbd", { class: "palette-esc", "aria-hidden": "true" }, "Esc"),
          el(
            "button",
            {
              type: "button",
              class: "palette-icon",
              "aria-label": "Suche schliessen",
              onclick: () => schliesse(),
            },
            icon("schliessen"),
          ),
        ),
        reiter,
        el("div", { class: "palette-koerper" }, tipp, liste, lade),
        status,
        el(
          "p",
          { class: "palette-fuss" },
          el("span", {}, el("kbd", {}, "↑"), el("kbd", {}, "↓"), " wählen"),
          el(
            "span",
            {},
            el("kbd", {}, "Bild ↑"),
            el("kbd", {}, "Bild ↓"),
            " Gruppe wechseln",
          ),
          el("span", {}, el("kbd", {}, "Enter"), " öffnen"),
          el("span", {}, el("kbd", {}, "Esc"), " schliessen"),
        ),
      ),
    );

    const stand = (name) => speicher.stand.get(name);
    const quellen = quellenFuer(sichtbar);
    // Lädt noch und hat nichts zu zeigen (zeit 0): die Liste wartet; mit altem Ergebnis nicht
    const wartend = () =>
      quellen.filter((n) => stand(n)?.status === "laedt" && !stand(n).zeit);
    const gescheitert = () =>
      quellen.filter((n) => stand(n)?.status === "fehler");

    const schluesselVon = (o) => o.e.id ?? `mehr-${o.e.gruppe}`;
    const setzeAktiv = (i, { scrollen = true } = {}) => {
      aktiv = Math.max(0, Math.min(i, optionen.length - 1));
      optionen.forEach((o, n) => {
        o.el.setAttribute("aria-selected", String(n === aktiv));
        if (n === aktiv) {
          aktivId = schluesselVon(o);
          eingabe.setAttribute("aria-activedescendant", o.el.id);
          if (scrollen) o.el.scrollIntoView({ block: "nearest" });
        }
      });
    };
    const waehle = (e) => {
      if (e.typ === "mehr") {
        wechsle(e.gruppe);
        eingabe.focus();
        return;
      }
      zuletzt = [e.id, ...zuletzt.filter((id) => id !== e.id)].slice(
        0,
        ZULETZT_MAX * 2,
      );
      schliesse();
      wunsch = e.wunsch ?? null;
      if (window.location.hash === e.adresse) {
        // Schon dort: Die Seite lädt nicht neu, der Wunsch wäre verloren; darum neu laden lassen
        window.dispatchEvent(new window.HashChangeEvent("hashchange"));
      } else {
        window.location.hash = e.adresse;
      }
    };
    function wechsle(wert) {
      scope = wert;
      aktivId = null;
      zeichne();
    }
    function neueFrage() {
      aktivId = null;
      zeichne();
    }

    const knotenFuer = (e, frage, ichId, n) => {
      const f = zeileFelder(e, frage, helfer, ichId);
      const knoten = el(
        "div",
        {
          class: `palette-eintrag palette-eintrag--${e.gruppe}`,
          role: "option",
          id: `${listeId}-${n}`,
          "aria-selected": "false",
          onclick: () => waehle(e),
          onmousemove: () => aktiv !== n && setzeAktiv(n, { scrollen: false }),
        },
        el("span", { class: "pz-links" }, f.links),
        el(
          "span",
          { class: "pz-haupt" },
          el("span", { class: "pz-titel" }, f.titel),
          hatInhalt(f.zusatz) && el("span", { class: "pz-zusatz" }, f.zusatz),
        ),
        hatInhalt(f.meta) && el("span", { class: "pz-meta" }, f.meta),
        f.chips && el("span", { class: "pz-chips" }, f.chips),
        f.status && el("span", { class: "pz-status" }, f.status),
      );
      return knoten;
    };

    function zeichne() {
      const frage = eingabe.value;
      const q = frage.trim();
      const { abschnitte, zaehler } = suchen({
        liste: kandidaten({ bereiche: sichtbar, daten: speicher.daten }),
        frage,
        scope,
        zuletzt,
      });
      leeren.hidden = frage === "";
      const wartet = wartend();
      // Solange eine Quelle noch nichts geliefert hat, steht bei ihrer Gruppe «…» statt einer Null, die täuschen würde
      const offenGruppen = new Set(
        wartet.flatMap((n) => (n === "personen" ? ["personen", "tags"] : [n])),
      );
      for (const k of reiter.querySelectorAll("[role=tab]")) {
        const hier = k.dataset.reiter === scope;
        k.setAttribute("aria-selected", String(hier));
        k.tabIndex = hier ? 0 : -1;
        k.querySelector(".n").textContent = offenGruppen.has(k.dataset.reiter)
          ? "…"
          : String(zaehler[k.dataset.reiter]);
      }
      const ichId = ich();
      const knoten = [];
      optionen = [];
      for (const a of abschnitte) {
        const kopfId = `${listeId}-gruppe-${a.gruppe.schluessel}`;
        const gruppe = el(
          "div",
          { class: "palette-gruppe", role: "group", "aria-labelledby": kopfId },
          el(
            "div",
            { class: "palette-gruppenkopf", id: kopfId, role: "presentation" },
            a.gruppe.symbol && icon(a.gruppe.symbol),
            a.gruppe.name,
          ),
        );
        for (const e of a.eintraege) {
          const k = knotenFuer(e, frage, ichId, optionen.length);
          optionen.push({ el: k, e, gruppe: a.gruppe.schluessel });
          gruppe.append(k);
        }
        if (a.mehr > 0 && a.gruppe.plural) {
          const e = { typ: "mehr", gruppe: a.gruppe.schluessel };
          const n = optionen.length;
          const k = el(
            "div",
            {
              class: "palette-eintrag palette-mehr",
              role: "option",
              id: `${listeId}-${n}`,
              "aria-selected": "false",
              onclick: () => waehle(e),
              onmousemove: () =>
                aktiv !== n && setzeAktiv(n, { scrollen: false }),
            },
            icon("weiter"),
            `Alle ${a.eintraege.length + a.mehr} ${a.gruppe.plural} anzeigen`,
          );
          optionen.push({ el: k, e, gruppe: a.gruppe.schluessel });
          gruppe.append(k);
        }
        knoten.push(gruppe);
      }
      liste.replaceChildren(...knoten);

      // Tipps: ohne Frage immer, mit Frage nur wenn nichts passt und nichts mehr lädt
      const nichts = optionen.length === 0 && wartet.length === 0;
      tipp.hidden = !(nichts || !q);
      tipp.textContent =
        nichts && q
          ? `Nichts gefunden für «${q}». ${tippText(erlaubt)}`
          : tippText(erlaubt);
      // Ladeanzeige und Fehler unter der Liste
      const fehler = gescheitert();
      lade.replaceChildren(
        ...[
          wartet.length > 0 &&
            el(
              "p",
              { class: "palette-lade-text" },
              `Lade ${wartet.map((n) => QUELLEN[n].name).join(", ")} …`,
            ),
          ...(wartet.length > 0
            ? [0, 1, 2].map(() =>
                el("span", { class: "palette-skelett", "aria-hidden": "true" }),
              )
            : []),
          fehler.length > 0 &&
            el(
              "p",
              { class: "palette-fehler", role: "alert" },
              icon("warnung"),
              `${fehler.map((n) => QUELLEN[n].name).join(", ")}: nicht geladen. Öffne die Suche später nochmals.`,
            ),
        ].filter(Boolean),
      );
      lade.hidden = wartet.length === 0 && fehler.length === 0;

      eingabe.removeAttribute("aria-activedescendant");
      const behalten = optionen.findIndex((o) => schluesselVon(o) === aktivId);
      setzeAktiv(behalten >= 0 ? behalten : 0, { scrollen: false });
      if (optionen.length === 0) aktivId = null;
      meldeTreffer(
        q ? (scope === "alle" ? zaehler.alle : zaehler[scope]) : null,
      );
    }

    let meldeTimer = 0;
    // Für Screenreader: wie viele Treffer die Frage hat; ohne Frage schweigt die Meldung
    function meldeTreffer(n) {
      window.clearTimeout(meldeTimer);
      meldeTimer = window.setTimeout(() => {
        status.textContent =
          n === null
            ? ""
            : n === 0
              ? "Keine Treffer."
              : n === 1
                ? "1 Treffer."
                : `${n} Treffer.`;
      }, 300);
    }

    function schliesse() {
      if (!offen) return;
      window.clearTimeout(meldeTimer);
      offen = null;
      dialog.close();
      dialog.remove();
    }
    // Zu einer anderen Gruppe springen: Bild ab zur ersten Zeile der nächsten, Bild auf zur ersten der vorigen
    const springe = (richtung) => {
      const starts = [];
      optionen.forEach((o, n) => {
        if (n === 0 || o.gruppe !== optionen[n - 1].gruppe) starts.push(n);
      });
      if (starts.length === 0) return;
      const aktuell = starts.filter((s) => s <= aktiv).length - 1;
      setzeAktiv(starts[(aktuell + richtung + starts.length) % starts.length]);
    };

    eingabe.addEventListener("input", neueFrage);
    eingabe.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (optionen.length === 0) return;
        setzeAktiv(
          (aktiv + (ev.key === "ArrowDown" ? 1 : -1) + optionen.length) %
            optionen.length,
        );
      } else if (ev.key === "PageDown" || ev.key === "PageUp") {
        ev.preventDefault();
        springe(ev.key === "PageDown" ? 1 : -1);
      } else if (ev.key === "Home" && ev.ctrlKey && optionen.length > 0) {
        ev.preventDefault();
        setzeAktiv(0);
      } else if (ev.key === "End" && ev.ctrlKey && optionen.length > 0) {
        ev.preventDefault();
        setzeAktiv(optionen.length - 1);
      } else if (ev.key === "Enter" && optionen[aktiv]) {
        ev.preventDefault();
        waehle(optionen[aktiv].e);
      }
    });
    // Reiter wie in einer Reiterleiste: Pfeile wechseln, der Pfeil nach unten geht zurück ins Feld; Tippen im Reiter geht ins Feld
    reiter.addEventListener("keydown", (ev) => {
      const knoepfe = [...reiter.querySelectorAll("[role=tab]")];
      const hier = knoepfe.indexOf(document.activeElement);
      if (hier < 0) return;
      const zu = {
        ArrowRight: (hier + 1) % knoepfe.length,
        ArrowLeft: (hier - 1 + knoepfe.length) % knoepfe.length,
        Home: 0,
        End: knoepfe.length - 1,
      }[ev.key];
      if (zu !== undefined) {
        ev.preventDefault();
        wechsle(knoepfe[zu].dataset.reiter);
        knoepfe[zu].focus();
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        eingabe.focus();
      } else if (
        ev.key.length === 1 &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey
      ) {
        eingabe.focus();
      }
    });
    // Klick auf den Schleier (ausserhalb der Karte) schliesst
    dialog.addEventListener("click", (ev) => {
      if (ev.target === dialog) schliesse();
    });
    dialog.addEventListener("close", () => {
      window.clearTimeout(meldeTimer);
      offen = null;
      dialog.remove();
    });
    offen = dialog;
    document.body.append(dialog);
    holeHelfer().then(() => offen === dialog && zeichne());
    starteLaden(sichtbar, () => offen === dialog && zeichne());
    zeichne();
    dialog.showModal();
    eingabe.focus();
  }

  document.addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() === "k" &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey
    ) {
      if (!bereit()) return;
      e.preventDefault();
      if (offen) offen.querySelector("input")?.focus();
      else oeffne();
    }
  });

  // Der Knopf im Kopf: Symbol, Wort und Kürzel; schmal nur das Symbol
  const knopf = () =>
    el(
      "button",
      {
        type: "button",
        class: "knopf knopf--klein palette-knopf",
        "aria-keyshortcuts": "Control+K Meta+K",
        onclick: oeffne,
      },
      icon("lupe"),
      el("span", { class: "palette-knopf-text" }, "Suchen"),
      el(
        "kbd",
        { class: "palette-kuerzel", "aria-hidden": "true" },
        kuerzelText(),
      ),
    );
  return { oeffne, knopf, vergiss };
}
