import { kennungGueltig } from "./api.js";

// Rollen und Rechte (#651): reine Logik ohne DOM, damit sie sich ohne Browser prüfen lässt. Sie rechnet mit dem, was die Matrix-API (/api/v1/admin/rechte, #643) liefert: den Katalog, Rollen mit ihren Rechten und Personen. Entschieden wird auf dem Server: Eine Vorschau hier ist keine Berechtigung.
// Eine Zuteilung ist { recht, geltung } mit geltung «alle» oder «eigene»; in der Matrix kommt «aus» dazu (kein Eintrag).

export const AUS = "aus";
export const GELTUNGEN = [AUS, "eigene", "alle"];
export const GELTUNG_TEXT = {
  aus: "Aus",
  eigene: "Eigene",
  alle: "Alle",
};

// Marken je Recht: Was passiert, wenn jemand es hat. «gross» heisst: Wer es vergibt, wird noch einmal gefragt (zweistufiger Speichern-Knopf). Ein Recht ohne Eintrag hat keine Marke; ein Recht, das der Server kennt und dieses Modul nicht, funktioniert trotzdem.
export const MARKEN = {
  "seiten.veroeffentlichen": [
    {
      text: "Öffentlich",
      gross: true,
      hilfe: "Wirkt auf die Website im Internet",
    },
  ],
  "seiten.anlegen_loeschen": [
    { text: "Löscht", gross: true, hilfe: "Seiten gehen verloren" },
  ],
  "medien.verwalten": [
    { text: "Löscht", gross: true, hilfe: "Medien gehen verloren" },
  ],
  "wartungsmodus.website": [
    { text: "Sperrt", gross: true, hilfe: "Die Website ist für alle zu" },
  ],
  "anlass.anlegen": [
    { text: "Löscht", gross: true, hilfe: "Anlässe gehen verloren" },
  ],
  "anlass.anmeldungen_sehen": [
    { text: "Kinderdaten", gross: true, hilfe: "Namen von Kindern und Eltern" },
  ],
  "anlass.anmeldungen_exportieren": [
    { text: "Kinderdaten", gross: true, hilfe: "Namen von Kindern und Eltern" },
    { text: "Export", gross: true, hilfe: "Die Daten verlassen das System" },
  ],
  "laden.ansehen": [
    { text: "Namen", gross: false, hilfe: "Bestellungen zeigen Namen" },
  ],
  "mitteilung.senden": [
    {
      text: "Erreicht Personen",
      gross: true,
      hilfe: "Eine Mitteilung geht als Push an viele",
    },
  ],
  "personen.verwalten": [
    {
      text: "Kinderdaten",
      gross: true,
      hilfe: "Personen und Kinder anlegen und ändern",
    },
  ],
  "gruppen.verwalten": [
    {
      text: "Gruppen",
      gross: false,
      hilfe: "Mitglieder aufnehmen und entfernen",
    },
  ],
  "profilbild.entfernen": [
    { text: "Profile", gross: false, hilfe: "Ändert fremde Profile" },
  ],
};

export const markenVon = (recht) => MARKEN[recht] ?? [];
export const istGross = (recht) => markenVon(recht).some((m) => m.gross);

// Was im Code fest steht und sich in keiner Matrix ändern lässt, mit Grund. Quelle: docs/rechte.md; die Rechte der Art «fest» im Katalog kommen dazu
export const FESTE_PUNKTE = [
  {
    titel: "Die Rechte der Abteilungsleitung stellt der Entwickler ein",
    text: "Die Abteilungsleitung kann ihre eigenen Rechte weder erweitern noch einschränken. Sie stellt die Rechte aller anderen Rollen ein. Standard sind alle vergebbaren Rechte; die festen Rechte bleiben ihr immer, damit sich die Abteilung nicht aussperrt.",
  },
  {
    titel: "Wer Rechte vergibt, hat sie selbst",
    text: "Niemand gibt mehr, als er hat, und wer nur «eigene» hat, vergibt nie «alle». Das verhindert, dass sich jemand selbst mehr Rechte gibt.",
  },
  {
    titel: "Entwickler vergibt nur der Server",
    text: "Die Rolle «Entwickler» setzt und entzieht die Kommandozeile des Servers, nie die Verwaltung.",
  },
  {
    titel: "Die Informationssperre bleibt fest",
    text: "Wartung und Sperre lassen sich nicht an Rollen verteilen, damit im Notfall niemand sie unbemerkt aufhebt.",
  },
];

// ---------- Katalog ----------

// Rechte nach Bereich, in der Reihenfolge des Katalogs. nur: Funktion, die ein Recht zulässt
export function gruppiereNachBereich(katalog, nur = () => true) {
  return katalog.bereiche
    .map((b) => ({
      id: b.id,
      name: b.name,
      rechte: katalog.rechte.filter((r) => r.bereich === b.id && nur(r)),
    }))
    .filter((b) => b.rechte.length > 0);
}

// Welche Rechte lässt eine Rolle dieser Art in der Matrix zu? Gruppenrolle: «gruppenrolle» des Katalogs; globale Rolle: alles Vergebbare (mit Wartung der Website)
export const rechteFuer = (katalog, art) =>
  katalog.rechte.filter((r) =>
    art === "global" ? r.art === "vergebbar" : r.gruppenrolle === true,
  );

// Was die Matrix für ein Recht und eine Rolle anbietet: aus, eigene, alle (eigene nur, wo der Katalog sie kennt und die Rolle zu einer Gruppe gehört)
export function geltungenFuer(recht, art) {
  const mit = recht.geltungen.includes("eigene") && art === "gruppe";
  return mit ? [AUS, "eigene", "alle"] : [AUS, "alle"];
}

// ---------- Rollen ----------

// Die Systemrolle «Abteilungsleitung» (#663) in die Form der globalen Rolle bringen. Sie hat keine Personen: Jedes Konto der Abteilungsleitung trägt sie. gesperrt: Die Person darf sie nicht ändern (nur der Entwickler)
export const abteilungsleitungRolle = (al) => ({
  id: "abteilungsleitung",
  art: "global",
  abteilungsleitung: true,
  name: "Abteilungsleitung",
  beschreibung: null,
  system: true,
  schluessel: null,
  version: al.version,
  rechte: al.rechte.map((recht) => ({ recht, geltung: "alle" })),
  fest: [],
  personen: [],
  gesperrt: al.aenderbar !== true,
});

// Globale Rolle der API ({ rechte: ["a"], vorgabe, personen }) in die Form der Gruppenrolle bringen. gesperrt: Der Entwickler liest sie nur (er ändert nur die Zeile «Abteilungsleitung»)
export const globaleRolle = (r, gesperrt = false) => ({
  id: r.id,
  art: "global",
  name: r.name,
  beschreibung: null,
  system: r.vorgabe === true,
  schluessel: null,
  version: r.version,
  rechte: r.rechte.map((recht) => ({ recht, geltung: "alle" })),
  fest: [],
  personen: r.personen,
  gesperrt,
});

export const gruppenRolle = (r, gruppe) => ({
  id: r.id,
  art: "gruppe",
  tagId: gruppe.id,
  gruppeTyp: gruppe.typ,
  name: r.name,
  beschreibung: r.beschreibung ?? null,
  system: r.system === true,
  schluessel: r.schluessel ?? null,
  verantwortlich: r.verantwortlich === true,
  reihenfolge: r.reihenfolge,
  version: r.version,
  rechte: r.rechte,
  fest: r.fest ?? [],
  personen: r.personen,
});

// Die Geltung einer Rolle für ein Recht ohne Entwurf
export const basisWert = (rolle, recht) =>
  rolle.rechte.find((z) => z.recht === recht)?.geltung ?? AUS;

// ---------- Entwurf ----------
// Der Entwurf hält nur, was jemand geändert hat: Map Rolle -> Map Recht -> Geltung (auch «aus»). So überschreibt ein Speichern nie, was inzwischen jemand anderes an einem anderen Recht derselben Rolle geändert hat.

export const neuerEntwurf = () => new Map();

export const wertIm = (entwurf, rolle, recht) =>
  entwurf.get(rolle.id)?.get(recht) ?? basisWert(rolle, recht);

// Setzt eine Zelle; ist der Wert wieder der des Servers, ist es keine Änderung mehr
export function setzeZelle(entwurf, rolle, recht, wert) {
  const zellen = entwurf.get(rolle.id) ?? new Map();
  if (wert === basisWert(rolle, recht)) zellen.delete(recht);
  else zellen.set(recht, wert);
  if (zellen.size === 0) entwurf.delete(rolle.id);
  else entwurf.set(rolle.id, zellen);
}

export const anzahlAenderungen = (entwurf) =>
  [...entwurf.values()].reduce((n, z) => n + z.size, 0);

export const anzahlRollen = (entwurf) => entwurf.size;

// Die Rechte der Rolle mit dem Entwurf, in der Reihenfolge des Katalogs (so gehen sie an die API)
export function zuteilungenMitEntwurf(rolle, entwurf, reihenfolge) {
  const zellen = entwurf.get(rolle.id);
  return reihenfolge.flatMap((recht) => {
    const geltung = zellen?.has(recht)
      ? zellen.get(recht)
      : basisWert(rolle, recht);
    return geltung === AUS ? [] : [{ recht, geltung }];
  });
}

// Was sich je Rolle ändert: hinzu (neu oder weiter gefasst), weg (entfernt oder enger), je mit Recht und Geltung
export function aenderungenJeRolle(rollen, entwurf) {
  const ergebnis = [];
  for (const rolle of rollen) {
    const zellen = entwurf.get(rolle.id);
    if (!zellen || zellen.size === 0) continue;
    const hinzu = [];
    const weg = [];
    for (const [recht, nach] of zellen) {
      const von = basisWert(rolle, recht);
      if (nach === AUS) weg.push({ recht, von, nach });
      else hinzu.push({ recht, von, nach });
    }
    ergebnis.push({ rolle, hinzu, weg });
  }
  return ergebnis;
}

// Wer ein Recht neu bekommt oder weiter gefasst bekommt, das grosse Wirkung hat, wird beim Speichern noch einmal gefragt
export function grosseWirkungen(rollen, entwurf) {
  const treffer = [];
  for (const a of aenderungenJeRolle(rollen, entwurf)) {
    for (const z of a.hinzu) {
      const weiter = z.von === AUS || (z.von === "eigene" && z.nach === "alle");
      if (weiter && istGross(z.recht)) {
        treffer.push({ rolle: a.rolle, recht: z.recht, nach: z.nach });
      }
    }
  }
  return treffer;
}

// Der Server hat eine Rolle inzwischen geändert (409): Stand und Version übernehmen und die eigenen Zellen behalten, die noch einen Unterschied machen
export function uebernehmeStand(entwurf, rolle, aktuell) {
  rolle.version = aktuell.version;
  if (aktuell.rechte) rolle.rechte = aktuell.rechte;
  const zellen = entwurf.get(rolle.id);
  if (!zellen) return;
  for (const [recht, wert] of [...zellen]) {
    if (wert === basisWert(rolle, recht)) zellen.delete(recht);
  }
  if (zellen.size === 0) entwurf.delete(rolle.id);
}

// ---------- Texte ----------

export const personenText = (n) => (n === 1 ? "1 Person" : `${n} Personen`);

export const geltungText = (geltung) =>
  geltung === "eigene" ? "nur eigene" : "alle";

// «Anmeldungen sehen (nur eigene)»
export const zuteilungText = (z, klartext) =>
  `${klartext(z.recht)} (${geltungText(z.geltung)})`;

// Wer ist betroffen? Aus dem Entwurf und der Zahl der Personen je Rolle; die Abteilungsleitung hat ohnehin alles und zählt nicht mit (admin: Menge der Kennungen)
export function betroffene(rollen, entwurf, admin = new Set()) {
  const personen = new Set();
  const jeRolle = aenderungenJeRolle(rollen, entwurf).map((a) => {
    const ids = a.rolle.personen
      .map((p) => p.id)
      .filter((id) => !admin.has(id));
    ids.forEach((id) => personen.add(id));
    return { ...a, personen: ids.length };
  });
  return { jeRolle, personen: personen.size };
}

export function vorschauText(b) {
  if (b.personen === 0) {
    return "Niemand ist betroffen: Die Rolle trägt heute niemand.";
  }
  return `${personenText(b.personen)} spüren die Änderung bei der nächsten Anfrage.`;
}

// Fehler der Matrix-API in Klartext (a: { status, code, daten? })
export function rechteFehlerText(f, fallback) {
  const code = f?.code;
  if (code === "ROLLENNAME_VERGEBEN") {
    return "Es gibt schon eine Rolle mit diesem Namen. Nimm einen anderen.";
  }
  if (code === "ROLLE_VORGEGEBEN") {
    return "Diese Rolle ist eingebaut. Ihr Name bleibt, und sie lässt sich nicht löschen. Ihre Rechte kannst du ändern.";
  }
  if (code === "ZU_VIELE_ROLLEN") {
    return "Eine Gruppe hat höchstens 30 Rollen. Lösche zuerst eine, die niemand mehr braucht.";
  }
  if (code === "VERSION_KONFLIKT") {
    return "Jemand hat die Rolle inzwischen geändert. Der neue Stand ist geladen, deine Änderungen sind noch da.";
  }
  if (code === "ZWEITER_FAKTOR_FEHLT") {
    return "Für die Rechte braucht es zuerst den zweiten Faktor. Richte ihn in «Mein Konto» ein.";
  }
  if (f?.status === 403) {
    return "Das kannst du nicht vergeben: Du hast dieses Recht selbst nicht, oder nicht für alle Objekte. Wer Rechte vergibt, hat sie selbst.";
  }
  if (f?.status === 404) {
    return "Die Gruppe, die Rolle oder die Person gibt es nicht mehr. Lade die Seite neu.";
  }
  return fallback;
}

// ---------- Vorschläge für ein OK ----------

// Rollen, die ein OK meistens braucht (Entwurf zu #585, Abschnitt 6.1). Alles ist vorbelegt und frei änderbar. «eigene» heisst hier: dieser Anlass.
export const OK_VORSCHLAEGE = [
  {
    name: "Leitung",
    beschreibung: "Plant den Anlass und sieht die Anmeldungen.",
    rechte: [
      { recht: "anlass.verwalten", geltung: "eigene" },
      { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
      { recht: "anlass.anmeldungen_exportieren", geltung: "eigene" },
      { recht: "seiten.bearbeiten", geltung: "eigene" },
      { recht: "seiten.veroeffentlichen", geltung: "eigene" },
      { recht: "vorschlag.einreichen", geltung: "alle" },
    ],
  },
  {
    name: "Kasse",
    beschreibung: "Sieht die Anmeldungen für die Abrechnung.",
    rechte: [{ recht: "anlass.anmeldungen_sehen", geltung: "eigene" }],
  },
  {
    name: "Kommunikation",
    beschreibung: "Schreibt die Seite des Anlasses und die Mitteilungen.",
    rechte: [
      { recht: "seiten.bearbeiten", geltung: "eigene" },
      { recht: "mitteilung.senden", geltung: "eigene" },
      { recht: "vorschlag.einreichen", geltung: "alle" },
    ],
  },
  {
    name: "Helfende",
    beschreibung: "Gehört zum OK, ohne zusätzliche Rechte.",
    rechte: [],
  },
];

// Die Vorschläge auf den Katalog des Servers zuschneiden: ein Recht, das er nicht kennt oder für Gruppenrollen nicht zulässt, fällt weg; eine Geltung, die er nicht kennt, wird «alle» oder fällt weg
export function vorschlaegeFuer(katalog) {
  const offen = new Map(rechteFuer(katalog, "gruppe").map((r) => [r.id, r]));
  return OK_VORSCHLAEGE.map((v) => ({
    ...v,
    rechte: v.rechte.flatMap((z) => {
      const r = offen.get(z.recht);
      if (!r) return [];
      return r.geltungen.includes(z.geltung) ? [z] : [];
    }),
  }));
}

// ---------- Wer darf dieses Recht? ----------

// Aus dem, was schon geladen ist: Rollen mit dem Recht und ihre Personen. Die Abteilungsleitung steht immer da (ausser bei Rechten nur für den Entwickler); die Mitgliedschaft in Team und Funktion gibt zusätzlich Standardrechte, die nur die Anfrage je Person kennt (Reiter «Person»).
// quellen: { eintrag, admin: [{id,name}], globale: [Rolle], gruppen: [{ gruppe, rollen: [Rolle] }] }
export function werDarf({ eintrag, admin, globale, gruppen }) {
  const zeilen = [];
  if (eintrag.art === "struktur") {
    zeilen.push({
      art: "alle",
      titel: "Jede angemeldete Person",
      geltung: "alle",
      personen: null,
      hinweis: "Das folgt aus der Beziehung und lässt sich nicht einstellen.",
    });
    return zeilen;
  }
  // Die Abteilungsleitung hat jedes feste Recht und, was der Entwickler ihr nicht wegnimmt (#663)
  const al = globale.find((r) => r.abteilungsleitung);
  const alHat =
    !eintrag.nurEntwickler &&
    (eintrag.art !== "vergebbar" ||
      !al ||
      al.rechte.some((x) => x.recht === eintrag.id));
  if (alHat) {
    zeilen.push({
      art: "abteilungsleitung",
      titel: "Abteilungsleitung",
      geltung: "alle",
      personen: admin,
      fest: true,
    });
  }
  if (eintrag.entwickler) {
    zeilen.push({
      art: "entwickler",
      titel: "Entwickler",
      geltung: "alle",
      personen: null,
      fest: true,
      hinweis: "Die Rolle setzt nur der Server.",
    });
  }
  for (const r of globale) {
    if (r.abteilungsleitung) continue;
    const z = r.rechte.find((x) => x.recht === eintrag.id);
    if (z) {
      zeilen.push({
        art: "plattformrolle",
        titel: `Rolle «${r.name}»`,
        geltung: z.geltung,
        personen: r.personen,
        rolleId: r.id,
      });
    }
  }
  for (const g of gruppen) {
    for (const r of g.rollen) {
      const z =
        r.rechte.find((x) => x.recht === eintrag.id) ??
        r.fest.find((x) => x.recht === eintrag.id);
      if (z) {
        zeilen.push({
          art: "gruppenrolle",
          titel: `«${r.name}» in «${g.gruppe.name}»`,
          geltung: z.geltung,
          personen: r.personen,
          tagId: g.gruppe.id,
          rolleId: r.id,
          fest: !r.rechte.some((x) => x.recht === eintrag.id),
        });
      }
    }
  }
  return zeilen;
}

// ---------- Herkunft eines Rechts bei einer Person ----------

const HERKUNFT_ART = {
  abteilungsleitung: "Abteilungsleitung",
  entwickler: "Entwickler",
  struktur: "Gilt für alle",
  plattformrolle: "Plattformrolle",
  stufenrolle: "Stufenrolle",
  mitgliedschaft: "Mitglied der Gruppe",
  gruppenrolle: "Gruppenrolle",
  sonderrecht: "Sonderrecht",
};

export function herkunftText(h) {
  const art = HERKUNFT_ART[h.art] ?? h.art;
  const wo = [h.rolle && `«${h.rolle}»`, h.gruppe && `in «${h.gruppe}»`]
    .filter(Boolean)
    .join(" ");
  return [art, wo].filter(Boolean).join(" ");
}

// Wirkt die Quelle nur eingeschränkt? «eigene» heisst: nur Objekte der Gruppe
export const herkunftGeltung = (h) =>
  h.geltung === "eigene" ? "nur eigene" : "alle";

// ---------- Verlauf ----------

// Eine Zeile des Verlaufs in Klartext. nachschlagen: { gruppe(id), rolle(id), person(id), recht(id) } liefern den Namen oder undefined
export function verlaufText(z, nachschlagen) {
  const d = z.details ?? {};
  const gruppe = d.tagId
    ? (nachschlagen.gruppe(d.tagId) ?? "einer Gruppe")
    : null;
  const liste = (a) =>
    (a ?? [])
      .map((x) =>
        typeof x === "string"
          ? (nachschlagen.recht(x) ?? x)
          : `${nachschlagen.recht(x.recht) ?? x.recht} (${geltungText(x.geltung ?? x.nach)})`,
      )
      .join(", ");
  switch (z.aktion) {
    case "gruppen_rolle_angelegt":
      return {
        titel: `Rolle in «${gruppe}» angelegt`,
        detail: d.rechte?.length ? `Rechte: ${liste(d.rechte)}` : "Ohne Rechte",
      };
    case "gruppen_rolle_geaendert": {
      const name = nachschlagen.rolle(z.zielId);
      return {
        titel: `Rolle ${name ? `«${name}» ` : ""}in «${gruppe}» geändert`,
        detail: [
          d.umbenannt && "Umbenannt",
          d.hinzu?.length && `Dazu: ${liste(d.hinzu)}`,
          d.weg?.length && `Weg: ${liste(d.weg)}`,
        ]
          .filter(Boolean)
          .join(". "),
      };
    }
    case "gruppen_rolle_geloescht":
      return {
        titel: `Rolle in «${gruppe}» gelöscht`,
        detail: d.rechte?.length ? `Sie trug: ${liste(d.rechte)}` : "",
      };
    case "gruppen_rolle_zugeordnet": {
      const person = nachschlagen.person(z.zielId) ?? "Eine Person";
      const rolle = d.rolleId ? nachschlagen.rolle(d.rolleId) : null;
      return {
        titel: d.rolleId
          ? `${person}: Rolle ${rolle ? `«${rolle}» ` : ""}in «${gruppe}» zugeordnet`
          : `${person}: Rolle in «${gruppe}» entzogen`,
        detail: "",
      };
    }
    case "plattform_rolle_angelegt":
      return {
        titel: "Plattformrolle angelegt",
        detail: d.rechte?.length ? `Rechte: ${liste(d.rechte)}` : "Ohne Rechte",
      };
    case "plattform_rolle_geaendert": {
      const vorher = new Set(d.rechteVorher ?? []);
      const nachher = new Set(d.rechteNachher ?? []);
      const dazu = [...nachher].filter((r) => !vorher.has(r));
      const weg = [...vorher].filter((r) => !nachher.has(r));
      const name = nachschlagen.rolle(z.zielId);
      return {
        titel: `Plattformrolle ${name ? `«${name}» ` : ""}geändert`,
        detail: [
          d.umbenannt && "Umbenannt",
          dazu.length && `Dazu: ${liste(dazu)}`,
          weg.length && `Weg: ${liste(weg)}`,
        ]
          .filter(Boolean)
          .join(". "),
      };
    }
    case "abteilungsleitung_rechte_geaendert":
      return {
        titel: "Rechte der Abteilungsleitung geändert",
        detail: [
          d.hinzu?.length && `Dazu: ${liste(d.hinzu)}`,
          d.weg?.length && `Weg: ${liste(d.weg)}`,
        ]
          .filter(Boolean)
          .join(". "),
      };
    case "plattform_rolle_geloescht":
      return {
        titel: "Plattformrolle gelöscht",
        detail: d.rechte?.length ? `Sie trug: ${liste(d.rechte)}` : "",
      };
    case "plattform_rolle_vergeben":
    case "plattform_rolle_entzogen": {
      const person = nachschlagen.person(z.zielId) ?? "Eine Person";
      const rolle = d.rolleId ? nachschlagen.rolle(d.rolleId) : null;
      const vergeben = z.aktion === "plattform_rolle_vergeben";
      return {
        titel: `${person}: Plattformrolle ${rolle ? `«${rolle}» ` : ""}${vergeben ? "vergeben" : "entzogen"}`,
        detail: "",
      };
    }
    default:
      return { titel: z.aktion, detail: "" };
  }
}

// ---------- Personenliste von «Was darf wer?» (#661): reine Funktionen, damit gleiche Namen unterscheidbar sind; die Anzeige steht in rechte-uebersicht.js (ohne DOM, damit sie sich testen lässt) ----------

const ROLLENNAME = { stufenleitung: "Stufenleitung", leitung: "Leitung" };

// Rolle als Klartext: «Abteilungsleitung», «Stufenleitung Artemis», mehrere mit Komma. Ohne Rolle leer.
// person: Eintrag aus GET /api/v1/admin/personen; stufenName: Map Stufen-ID nach Name
export function rolleText(person, stufenName) {
  const teile = [];
  if (person.admin) teile.push("Abteilungsleitung");
  for (const r of person.rollen ?? []) {
    const name = ROLLENNAME[r.typ];
    if (name) teile.push(`${name} ${stufenName.get(r.stufeId) ?? ""}`.trim());
  }
  return teile.join(", ");
}

// Namen, die mehr als eine aktive Person trägt (Gross- und Kleinschreibung gilt nicht)
export function doppelteNamen(personen) {
  const zaehler = new Map();
  for (const p of personen) {
    const k = p.name.trim().toLocaleLowerCase("de-CH");
    zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  return new Set([...zaehler].filter(([, n]) => n > 1).map(([k]) => k));
}

// Zeilen der Liste: Name, Rolle, und wo der Name doppelt vorkommt (oder der Cevi-Name es hergibt) der Benutzername zur Unterscheidung
// Rückgabe: [{ person, rolle, zusatz }]
export function listenZeilen(personen, stufenName) {
  const doppelt = doppelteNamen(personen);
  return personen.map((person) => ({
    person,
    rolle: rolleText(person, stufenName),
    zusatz: doppelt.has(person.name.trim().toLocaleLowerCase("de-CH"))
      ? [person.ceviName, person.benutzername].filter(Boolean).join(" · ")
      : "",
  }));
}

// Suchtext: Name, Cevi-Name, Benutzername und Rolle
export const passtZurSuche = (zeile, suche) => {
  const f = suche.trim().toLocaleLowerCase("de-CH");
  if (!f) return true;
  const p = zeile.person;
  return `${p.name} ${p.ceviName ?? ""} ${p.benutzername ?? ""} ${zeile.rolle}`
    .toLocaleLowerCase("de-CH")
    .includes(f);
};

export const anzahlText = (n) =>
  n === 0 ? "Keine Person gefunden" : n === 1 ? "1 Person" : `${n} Personen`;

// Ob die Adresse unter «Rollen und Rechte» etwas meint, das es gibt: bekannter Reiter, Kennungen als UUID (sie gehen in Pfade der API), keine überzähligen Teile
export function adresseGueltig(reiter, rest) {
  const [a, b, c] = rest;
  if (reiter === "gruppen")
    return (
      rest.length === 0 ||
      (kennungGueltig(a) &&
        (rest.length === 1 ||
          (rest.length === 3 && b === "rolle" && kennungGueltig(c))))
    );
  if (reiter === "rollen") return rest.length <= 1;
  if (reiter === "uebersicht")
    return (
      rest.length === 0 ||
      (rest.length <= 2 && ["person", "recht", "verlauf"].includes(a))
    );
  return false;
}
