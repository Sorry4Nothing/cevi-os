// Seite «Termine» (#530, Boards W5 und W6): Reiter «Alle» und «Mein Kalender», Liste und Monat, Filter nach Gruppe und Zeitraum.
// Abfragen: je Reiter und Zeitraum eine Seite (GET /termine/alle oder /termine/mein), danach aus dem Zwischenspeicher der Seite; der Filter nach Gruppe läuft im Browser. Kein Abruf im Takt.
// Ohne Anmeldung (#564) zeigt «Alle» den öffentlichen Datenplan aus der Datei /termine/termine.json, die der Abgleich schreibt: ein Abruf der Datei je Besuch, keine Abfrage der Datenbank.
// Die Ansichten (…View) sind reine Funktionen und ohne Browser testbar; start() verbindet sie mit dem Dokument.
import {
  api,
  baue,
  fehlerView,
  h,
  heute,
  icon,
  melde,
  MONAT,
  MONAT_KURZ,
  nichtAngemeldetView,
  ersterTag,
  letzterTag,
  sk,
  tagPlus,
  tagTeile,
  tageImMonat,
  terminMeta,
  WOCHENTAG,
  WOCHENTAG_KURZ,
  wochentagVon,
  zuerichZuIso,
  zustandView,
} from "./tm.js";
import { startLink } from "./termine-link.js";
// Wertet die Auswahlfelder (Gruppe, Zeitraum) zum eigenen Auswahlfeld auf
import "./auswahl.js";

export const ZEITRAEUME = [
  { schluessel: "3m", name: "Nächste 3 Monate" },
  { schluessel: "monat", name: "Dieser Monat" },
  { schluessel: "jahr", name: "Ganzes Jahr" },
];

// --- Reine Funktionen
const zwei = (n) => String(n).padStart(2, "0");

// Von und bis (ganze Tage, beide eingeschlossen) für die Liste; die Abfrage erlaubt höchstens 400 Tage
export function bereichVon(zeitraum, heuteTag) {
  const t = tagTeile(heuteTag);
  if (zeitraum === "monat") {
    return {
      von: heuteTag,
      bis: `${t.y}-${zwei(t.m)}-${zwei(tageImMonat(t.y, t.m))}`,
    };
  }
  if (zeitraum === "jahr")
    return { von: heuteTag, bis: tagPlus(heuteTag, 364) };
  const d = new Date(Date.UTC(t.y, t.m - 1 + 3, t.d - 1));
  return {
    von: heuteTag,
    bis: `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`,
  };
}

// «2027-02» → erster und letzter Tag
export function monatsBereich(monat) {
  const [y, m] = monat.split("-").map(Number);
  return { von: `${monat}-01`, bis: `${monat}-${zwei(tageImMonat(y, m))}` };
}
export const monatPlus = (monat, n) => {
  const [y, m] = monat.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}`;
};
export const monatTitel = (monat) => {
  const [y, m] = monat.split("-").map(Number);
  return `${MONAT[m - 1]} ${y}`;
};

export const filtere = (termine, gruppe) =>
  gruppe ? termine.filter((t) => t.tags.some((g) => g.id === gruppe)) : termine;

// Die Gruppen, die in den geladenen Terminen vorkommen (die Person sieht nur ihre eigenen Tags, die Abteilungsleitung alle)
export function gruppenVon(termine) {
  const nachId = new Map();
  for (const t of termine) for (const g of t.tags) nachId.set(g.id, g.name);
  return [...nachId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
}

const gruppeName = (gruppen, id) =>
  gruppen.find((g) => g.id === id)?.name ?? null;

// Link zur Anlass-Seite, falls der Termin einen Anlass hat; im öffentlichen Datenplan die öffentliche Seite des Anlasses
export const anlassLink = (t) =>
  t.seite ?? (t.anlass ? `/anlass/?id=${t.anlass.id}` : null);

export const PLAN_DATEI = "/termine/termine.json";
const zeitpunkt = (tag, zeit) => {
  const t = tagTeile(tag);
  const [h, mi] = zeit.split(":").map(Number);
  return zuerichZuIso(t.y, t.m, t.d, h, mi);
};
// Ein Eintrag des öffentlichen Datenplans in der Form der API, damit Liste und Monat dieselben Ansichten nutzen. Die Gruppen sind die Namen der Stufen (die Datei nennt keine IDs)
export function ausPlan(e) {
  const ganztaegig = e.zeitVon === null;
  return {
    id: null,
    titel: e.titel,
    status: "aktiv",
    ganztaegig,
    beginn: ganztaegig ? null : zeitpunkt(e.von, e.zeitVon),
    ende: ganztaegig ? null : zeitpunkt(e.bis, e.zeitBis ?? e.zeitVon),
    tagVon: ganztaegig ? e.von : null,
    tagBis: ganztaegig ? e.bis : null,
    ort: e.ort,
    tags: e.stufen.map((name) => ({ id: name, name })),
    anlass: null,
    // Nur ein Pfad der eigenen Website wird zum Link
    seite: /^\/[a-z0-9/-]*$/.test(e.seite ?? "") ? e.seite : null,
  };
}
// Die Termine des Plans, die einen Zeitraum berühren (ganze Tage, beide eingeschlossen)
export const imBereich = (termine, von, bis) =>
  termine.filter((t) => letzterTag(t) >= von && ersterTag(t) <= bis);

// «Samstag 6. Februar, Waldspiel, 14:00–17:00 · Ort, für Wölfe, Adler»
export function terminAria(t) {
  const tag = ersterTag(t);
  const p = tagTeile(tag);
  const gruppen = t.tags.length ? t.tags.map((g) => g.name).join(", ") : "Alle";
  return `${WOCHENTAG[wochentagVon(tag)]} ${p.d}. ${MONAT[p.m - 1]}, ${t.titel}, ${terminMeta(t)}${t.status === "abgesagt" ? ", abgesagt" : ""}, für ${gruppen}`;
}

// --- Ansichten
export function terminKarte(t) {
  const tag = ersterTag(t);
  const p = tagTeile(tag);
  const link = anlassLink(t);
  const inhalt = [
    h(
      "span",
      { class: "datum", "aria-hidden": "true" },
      h("span", { class: "tag" }, WOCHENTAG_KURZ[wochentagVon(tag)]),
      h("span", { class: "nr" }, p.d),
      h("span", { class: "mo" }, MONAT_KURZ[p.m - 1]),
    ),
    h(
      "span",
      { class: "termin-text" },
      h("span", { class: "titel" }, t.titel),
      h("span", { class: "meta" }, terminMeta(t)),
      h(
        "span",
        { class: "chips" },
        t.status === "abgesagt"
          ? h("span", { class: "chip fe" }, "Abgesagt")
          : null,
        t.status === "pruefen"
          ? h("span", { class: "chip wa" }, "Noch unklar")
          : null,
        t.anlass?.angemeldet
          ? h("span", { class: "chip ok" }, icon("haken"), "Angemeldet")
          : null,
        t.tags.length
          ? t.tags.map((g) => h("span", { class: "chip st" }, g.name))
          : h("span", { class: "chip st" }, "Alle"),
      ),
    ),
  ];
  if (link) {
    inhalt.push(
      h(
        "span",
        { class: "termin-pfeil", "aria-hidden": "true" },
        h(
          "svg",
          { class: "i", viewBox: "0 0 24 24" },
          h("path", { d: "M3 12h12" }),
          h("path", { class: "f", d: "M14 6l7.5 6-7.5 6z" }),
        ),
      ),
    );
  }
  const aria = terminAria(t);
  return h(
    "li",
    {},
    link
      ? h("a", { class: "termin", href: link, "aria-label": aria }, inhalt)
      : h(
          "div",
          { class: "termin", role: "group", "aria-label": aria },
          inhalt,
        ),
  );
}

// Termine nach Monat des ersten Tages gruppiert, mit Überschrift je Monat
export function listeView(termine, { mehr = false } = {}) {
  const gruppen = [];
  for (const t of termine) {
    const monat = ersterTag(t).slice(0, 7);
    const letzte = gruppen[gruppen.length - 1];
    if (letzte?.monat === monat) letzte.termine.push(t);
    else gruppen.push({ monat, termine: [t] });
  }
  return h(
    "div",
    { class: "plan" },
    gruppen.map((g) => [
      h("h2", { class: "monat-titel" }, monatTitel(g.monat)),
      h("ul", { class: "termine" }, g.termine.map(terminKarte)),
    ]),
    mehr
      ? h(
          "div",
          { class: "mehr" },
          h(
            "button",
            {
              type: "button",
              class: "btn s",
              "data-aktion": "mehr",
              "data-f": "mehr",
            },
            "Weitere Termine laden",
          ),
        )
      : null,
  );
}

export function listeLadeView() {
  const zeile = (b1, b2) =>
    h(
      "li",
      { class: "termin", "aria-hidden": "true" },
      h("span", { class: "datum sk" }),
      h(
        "span",
        {},
        sk(`t h20 ${b1}`),
        sk(`t ${b2}`),
        h("span", { class: "chips" }, sk("r h28 bpx70"), sk("r h28 bpx70")),
      ),
    );
  return h(
    "div",
    { "aria-busy": "true" },
    h("span", { class: "sk h24 b40", "aria-hidden": "true" }),
    h(
      "div",
      { class: "skel" },
      h("ul", { class: "termine" }, [
        zeile("b50", "b70"),
        zeile("b40", "b60"),
        zeile("b50", "b70"),
        zeile("b40", "b60"),
      ]),
      h("span", { class: "schimmer" }),
    ),
    h("p", { class: "nur-leser", role: "status" }, "Lädt …"),
  );
}

const ZELLE_MAX = 3;
// Monatsraster: Wochen von Montag bis Sonntag. Breit zeigt es die Titel der Termine, schmal Punkte und darunter die Liste
// fenster ({ von, bis }, ganze Tage): Ausserhalb davon gibt es keine Daten (öffentlicher Datenplan), die Schaltflächen am Rand sind dann gesperrt
export function monatView(
  monat,
  termine,
  heuteTag,
  { mehr = false, fenster = null } = {},
) {
  const amAnfang = fenster && monat <= fenster.von.slice(0, 7);
  const amEnde = fenster && monat >= fenster.bis.slice(0, 7);
  const [y, m] = monat.split("-").map(Number);
  const anzahl = tageImMonat(y, m);
  const vorne = (wochentagVon(`${monat}-01`) + 6) % 7;
  const proTag = new Map();
  for (const t of termine) {
    // Mehrtägige Termine erscheinen an jedem Tag des Monats, den sie berühren
    const bis = letzterTag(t);
    for (let tag = ersterTag(t); tag <= bis; tag = tagPlus(tag, 1)) {
      if (tag.slice(0, 7) !== monat) {
        if (tag > `${monat}-31`) break;
        continue;
      }
      const liste = proTag.get(tag) ?? [];
      liste.push(t);
      proTag.set(tag, liste);
    }
  }
  const zellen = [];
  for (let i = 0; i < vorne; i++)
    zellen.push(h("li", { class: "zelle leer", "aria-hidden": "true" }));
  for (let tag = 1; tag <= anzahl; tag++) {
    const datum = `${monat}-${zwei(tag)}`;
    const liste = proTag.get(datum) ?? [];
    zellen.push(
      h(
        "li",
        {
          class: `zelle${datum === heuteTag ? " heute" : ""}`,
          ...(datum === heuteTag && { "aria-current": "date" }),
        },
        h(
          "span",
          { class: "n" },
          h(
            "span",
            { class: "nur-leser" },
            `${WOCHENTAG[wochentagVon(datum)]}, `,
          ),
          tag,
        ),
        // Höchstens drei Titel je Tag, der Rest als Zahl: Die Liste unter dem Raster nennt alle
        liste.slice(0, ZELLE_MAX).map((t) => {
          const link = anlassLink(t);
          const klasse = `eintrag${t.status === "abgesagt" ? " abgesagt" : ""}`;
          const titel =
            t.status === "abgesagt" ? `${t.titel} (abgesagt)` : t.titel;
          return link
            ? h("a", { class: klasse, href: link }, titel)
            : h("span", { class: klasse }, titel);
        }),
        liste.length > ZELLE_MAX
          ? h(
              "span",
              { class: "eintrag-mehr", "aria-hidden": "true" },
              `+ ${liste.length - ZELLE_MAX} weitere`,
            )
          : null,
        liste.length
          ? [
              h("span", { class: "punkt", "aria-hidden": "true" }),
              h(
                "span",
                { class: "nur-leser" },
                liste.length === 1 ? "1 Termin" : `${liste.length} Termine`,
              ),
            ]
          : null,
      ),
    );
  }
  // Die letzte Woche auffüllen, damit das Raster unten geschlossen ist
  while (zellen.length % 7 !== 0)
    zellen.push(h("li", { class: "zelle leer", "aria-hidden": "true" }));
  // Auch mehrtägige Termine, die in den Monat hineinreichen
  const imMonat = imBereich(termine, `${monat}-01`, `${monat}-31`);
  return h(
    "div",
    {},
    h(
      "div",
      { class: "abschnitt-kopf" },
      h(
        "button",
        {
          type: "button",
          class: "btn s",
          "aria-label": "Vorheriger Monat",
          "aria-disabled": amAnfang ? "true" : null,
          "data-aktion": "monat:zurueck",
          "data-f": "zurueck",
        },
        icon("links"),
      ),
      h(
        "h2",
        { class: "monat-titel", id: "tm-monat-titel" },
        monatTitel(monat),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn s",
          "aria-label": "Nächster Monat",
          "aria-disabled": amEnde ? "true" : null,
          "data-aktion": "monat:vor",
          "data-f": "vor",
        },
        icon("rechts"),
      ),
    ),
    h(
      "div",
      { class: "monat" },
      h(
        "div",
        { class: "wochentage", "aria-hidden": "true" },
        WOCHENTAG_KURZ.slice(1)
          .concat("So")
          .map((w) => h("div", { class: "wt" }, w)),
      ),
      h("ol", { class: "tage", "aria-labelledby": "tm-monat-titel" }, zellen),
    ),
    // Zeit, Ort und Gruppen stehen in der Liste unter dem Raster: Das Raster zeigt nur Titel oder Punkte
    imMonat.length
      ? h(
          "div",
          { class: "plan" },
          h("h3", { class: "monat-titel" }, `Termine im ${MONAT[m - 1]}`),
          h("ul", { class: "termine" }, imMonat.map(terminKarte)),
        )
      : h(
          "p",
          { class: "leise monat-leer" },
          `Im ${MONAT[m - 1]} stehen keine Termine an.`,
        ),
    mehr
      ? h(
          "div",
          { class: "mehr" },
          h(
            "button",
            {
              type: "button",
              class: "btn s",
              "data-aktion": "mehr",
              "data-f": "mehr",
            },
            "Weitere Termine laden",
          ),
        )
      : null,
  );
}

export function monatLadeView(monat) {
  return h(
    "div",
    { "aria-busy": "true" },
    h(
      "div",
      { class: "abschnitt-kopf" },
      h("h2", { class: "monat-titel" }, monatTitel(monat)),
    ),
    h(
      "div",
      { class: "skel" },
      h("span", { class: "sk h56 b100" }),
      h("span", { class: "sk h56 b100 mt" }),
      h("span", { class: "sk h56 b100 mt" }),
      h("span", { class: "schimmer" }),
    ),
    h("p", { class: "nur-leser", role: "status" }, "Lädt …"),
  );
}

export function reiterView({ tab, angemeldet }) {
  const reiter = (schluessel, name, gesperrt) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        id: `tm-reiter-${schluessel}`,
        "aria-selected": tab === schluessel ? "true" : "false",
        "aria-controls": "tm-feld",
        tabindex: tab === schluessel ? "0" : "-1",
        "aria-disabled": gesperrt ? "true" : null,
        "data-aktion": `tab:${schluessel}`,
        "data-f": `reiter-${schluessel}`,
      },
      gesperrt ? icon("schloss") : null,
      name,
    );
  return h(
    "div",
    {},
    h(
      "div",
      { class: "reiter", role: "tablist", "aria-label": "Termine" },
      reiter("alle", "Alle", false),
      reiter("mein", "Mein Kalender", !angemeldet),
    ),
    // Der Datenplan ist offen; die Anmeldung braucht nur, wer den eigenen Kalender, den Kalender-Link oder eine Anmeldung zu einem Anlass will
    !angemeldet
      ? h(
          "p",
          { class: "reiter-hinweis" },
          "Du siehst den öffentlichen Datenplan. Für deinen eigenen Kalender ",
          h("a", { href: "/anmelden?weiter=%2Ftermine" }, "melde dich an"),
          ".",
        )
      : null,
  );
}

const aktivAnzahl = (s) =>
  (s.gruppe ? 1 : 0) + (s.ansicht === "liste" && s.zeitraum !== "3m" ? 1 : 0);

export function werkzeugView(s, gruppen) {
  const aktiv = aktivAnzahl(s);
  const zeitraumName = ZEITRAEUME.find((z) => z.schluessel === s.zeitraum).name;
  const chips = [
    s.gruppe
      ? h("span", { class: "chip" }, gruppeName(gruppen, s.gruppe) ?? "Gruppe")
      : null,
    s.ansicht === "liste" && s.zeitraum !== "3m"
      ? h("span", { class: "chip" }, zeitraumName)
      : null,
  ].filter(Boolean);
  const auswahl = (id, name, optionen, wert, aktion) =>
    h(
      "div",
      { class: "feld" },
      h("label", { for: id }, name),
      h(
        "div",
        { class: "auswahl" },
        h(
          "select",
          { class: "eingabe", id, "data-f": id, "data-wahl": aktion },
          optionen.map((o) =>
            h("option", { value: o.wert, selected: o.wert === wert }, o.name),
          ),
        ),
      ),
    );
  return h(
    "div",
    {},
    h(
      "div",
      { class: "werkzeug" },
      h(
        "div",
        { class: "seg", role: "group", "aria-label": "Ansicht" },
        h(
          "button",
          {
            type: "button",
            "aria-pressed": s.ansicht === "liste" ? "true" : "false",
            "data-aktion": "ansicht:liste",
            "data-f": "ansicht-liste",
          },
          "Liste",
        ),
        h(
          "button",
          {
            type: "button",
            "aria-pressed": s.ansicht === "monat" ? "true" : "false",
            "data-aktion": "ansicht:monat",
            "data-f": "ansicht-monat",
          },
          "Monat",
        ),
      ),
      h(
        "div",
        { class: "filterfelder nur-breit" },
        auswahl(
          "f-g",
          "Gruppe",
          [
            { wert: "", name: "Alle Gruppen" },
            ...gruppen.map((g) => ({ wert: g.id, name: g.name })),
          ],
          s.gruppe ?? "",
          "gruppe",
        ),
        s.ansicht === "liste"
          ? auswahl(
              "f-z",
              "Zeitraum",
              ZEITRAEUME.map((z) => ({ wert: z.schluessel, name: z.name })),
              s.zeitraum,
              "zeitraum",
            )
          : null,
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn s nur-schmal",
          "aria-haspopup": "dialog",
          "data-aktion": "filter:oeffnen",
          "data-f": "filter-knopf",
        },
        icon("filter"),
        aktiv ? `Filter (${aktiv} aktiv)` : "Filter",
      ),
    ),
    chips.length ? h("div", { class: "chips nur-schmal" }, chips) : null,
  );
}

// Inhalt des Filterblatts (nur schmal): Gruppe und Zeitraum als Auswahl, Ergebnis und Zurücksetzen
export function filterBlattView(s, gruppen, anzahl) {
  const pille = (aktion, name, an) =>
    h(
      "button",
      {
        type: "button",
        class: "pille",
        "aria-pressed": an ? "true" : "false",
        "data-aktion": aktion,
        "data-f": aktion,
      },
      an ? icon("haken") : null,
      name,
    );
  return h(
    "div",
    { class: "inhalt" },
    h(
      "div",
      { class: "abschnitt-kopf" },
      h("h2", { id: "tm-filter-t" }, "Filter"),
      h(
        "button",
        {
          type: "button",
          class: "btn s",
          "aria-label": "Filter schliessen",
          "data-aktion": "filter:schliessen",
        },
        icon("zu"),
      ),
    ),
    h(
      "div",
      { class: "feld", role: "group", "aria-labelledby": "tm-fg-l" },
      h("span", { class: "legende", id: "tm-fg-l" }, "Gruppe"),
      h(
        "div",
        { class: "pillen" },
        pille("gruppe:", "Alle Gruppen", !s.gruppe),
        gruppen.map((g) => pille(`gruppe:${g.id}`, g.name, s.gruppe === g.id)),
      ),
    ),
    s.ansicht === "liste"
      ? h(
          "div",
          { class: "feld", role: "group", "aria-labelledby": "tm-fz-l" },
          h("span", { class: "legende", id: "tm-fz-l" }, "Zeitraum"),
          h(
            "div",
            { class: "pillen" },
            ZEITRAEUME.map((z) =>
              pille(
                `zeitraum:${z.schluessel}`,
                z.name,
                s.zeitraum === z.schluessel,
              ),
            ),
          ),
        )
      : null,
    h(
      "div",
      { class: "feld" },
      h(
        "button",
        {
          type: "button",
          class: "btn p gross voll",
          "data-aktion": "filter:schliessen",
        },
        anzahl === null
          ? "Termine anzeigen"
          : anzahl === 1
            ? "1 Termin anzeigen"
            : `${anzahl} Termine anzeigen`,
      ),
      h(
        "button",
        { type: "button", class: "btn t", "data-aktion": "zuruecksetzen" },
        "Zurücksetzen",
      ),
    ),
  );
}

// Der Bereich unter den Werkzeugen: Laden, Fehler, leer, kein Treffer oder die Termine
export function feldView(s, daten, heuteTag) {
  const filter = Boolean(
    s.gruppe || (s.ansicht === "liste" && s.zeitraum !== "3m"),
  );
  if (!daten || daten.status === "laedt") {
    return s.ansicht === "monat" ? monatLadeView(s.monat) : listeLadeView();
  }
  if (daten.status === "abgemeldet") return nichtAngemeldetView("/termine");
  if (daten.status === "keinZugriff") {
    return zustandView({
      symbol: "schloss",
      titel: "Für dein Konto ist das nicht verfügbar.",
    });
  }
  if (daten.status === "fehler") return fehlerView("nochmal");
  const sichtbar = filtere(daten.termine, s.gruppe);
  if (s.ansicht === "monat") {
    return monatView(s.monat, sichtbar, heuteTag, {
      mehr: daten.weitere,
      fenster: daten.fenster,
    });
  }
  if (sichtbar.length === 0 && !daten.weitere) {
    if (filter) {
      return zustandView({
        symbol: "info",
        titel: "Keine Termine für diesen Filter.",
        aktion: h(
          "button",
          { type: "button", class: "btn s", "data-aktion": "zuruecksetzen" },
          "Filter zurücksetzen",
        ),
      });
    }
    return zustandView(
      s.tab === "mein"
        ? {
            symbol: "kalender",
            titel: "In deinen Gruppen stehen gerade keine Termine an.",
            text: "Schau später wieder vorbei.",
          }
        : {
            symbol: "kalender",
            titel: "Gerade stehen keine Termine an.",
            text: "Schau später wieder vorbei.",
          },
    );
  }
  return listeView(sichtbar, { mehr: daten.weitere });
}

// --- Verbindung mit dem Dokument
function start(doc, wurzel) {
  const s = {
    tab: doc.location.hash === "#mein" ? "mein" : "alle",
    ansicht: "liste",
    gruppe: null,
    zeitraum: "3m",
    monat: heute().slice(0, 7),
    angemeldet: true,
  };
  const heuteTag = heute();
  const speicher = new Map();
  let zaehler = 0;
  // Die Liste aus dem HTML bleibt stehen, bis die ersten Daten da sind (kein Flackern, kein Platzhalter)
  let statisch = doc.getElementById("tm-plan");
  // Der öffentliche Datenplan: einmal je Besuch geladen; null, wenn die Datei fehlt oder nicht lesbar ist
  let plan;
  const ladePlan = () =>
    (plan ??= fetch(PLAN_DATEI, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d) => d && { von: d.von, bis: d.bis, termine: d.termine.map(ausPlan) },
      )
      .catch(() => null));
  // Antwort in der Form der API
  const planAntwort = async (von, bis) => {
    const p = await ladePlan();
    return p
      ? {
          status: 200,
          daten: { termine: imBereich(p.termine, von, bis), weitere: false },
          fenster: { von: p.von, bis: p.bis },
        }
      : { status: 0, daten: null };
  };

  wurzel.replaceChildren(
    ...["tm-reiter", "tm-link", "tm-werkzeug"].map((id) =>
      Object.assign(doc.createElement("div"), { id }),
    ),
    Object.assign(doc.createElement("div"), {
      id: "tm-feld",
      className: "feld-bereich",
    }),
  );
  const [bReiter, bLink, bWerkzeug, bFeld] = [...wurzel.children];
  bFeld.setAttribute("role", "tabpanel");
  bFeld.setAttribute("tabindex", "-1");
  const blatt = doc.createElement("dialog");
  blatt.className = "blatt";
  blatt.setAttribute("aria-labelledby", "tm-filter-t");
  wurzel.append(blatt);

  const schluessel = () => {
    const b =
      s.ansicht === "monat"
        ? monatsBereich(s.monat)
        : bereichVon(s.zeitraum, heuteTag);
    return { ...b, key: `${s.tab}|${b.von}|${b.bis}` };
  };
  const aktuell = () => speicher.get(schluessel().key);
  const alleGeladen = () =>
    [...speicher.values()]
      .filter((d) => d.tab === s.tab && d.termine)
      .flatMap((d) => d.termine);

  function zeichne() {
    const fokus = doc.activeElement?.dataset?.f;
    const daten = aktuell();
    const gruppen = gruppenVon(alleGeladen());
    if (s.gruppe && !gruppen.some((g) => g.id === s.gruppe)) s.gruppe = null;
    bReiter.replaceChildren(baue(doc, reiterView(s)));
    bLink.hidden = s.tab !== "mein";
    bWerkzeug.replaceChildren(baue(doc, werkzeugView(s, gruppen)));
    bFeld.setAttribute("aria-labelledby", `tm-reiter-${s.tab}`);
    const laedt = !daten || daten.status === "laedt";
    if (!laedt) statisch = null;
    bFeld.replaceChildren(
      statisch && s.tab === "alle" && s.ansicht === "liste"
        ? statisch
        : baue(doc, feldView(s, daten, heuteTag)),
    );
    if (blatt.open) {
      const anzahl = daten?.termine
        ? filtere(daten.termine, s.gruppe).length
        : null;
      blatt.replaceChildren(baue(doc, filterBlattView(s, gruppen, anzahl)));
    }
    if (fokus) {
      [...doc.querySelectorAll("[data-f]")]
        .find((e) => e.dataset.f === fokus)
        ?.focus();
    }
  }

  async function lade(nach) {
    const { von, bis, key } = schluessel();
    const bisher = speicher.get(key);
    if (bisher && !nach && bisher.status === "ok") return zeichne();
    const nummer = ++zaehler;
    if (!nach) speicher.set(key, { tab: s.tab, status: "laedt" });
    zeichne();
    const q = new URLSearchParams({
      von,
      bis,
      limit: "100",
      ...(nach && { nach }),
    });
    // Ohne Anmeldung kommt «Alle» aus der Datei; die API wird nur einmal gefragt, ob es eine Sitzung gibt
    let r =
      !s.angemeldet && s.tab === "alle"
        ? null
        : await api(`/termine/${s.tab === "mein" ? "mein" : "alle"}?${q}`);
    if (!r || (r.status === 401 && s.tab === "alle")) {
      s.angemeldet = false;
      r = await planAntwort(von, bis);
    }
    if (nummer !== zaehler) return;
    let eintrag;
    if (r.status === 200) {
      eintrag = {
        tab: s.tab,
        status: "ok",
        termine: [...(nach ? bisher.termine : []), ...r.daten.termine],
        weitere: r.daten.weitere,
        naechste: r.daten.naechste,
        fenster: r.fenster ?? null,
      };
    } else if (r.status === 401) {
      s.angemeldet = false;
      eintrag = { tab: s.tab, status: "abgemeldet" };
    } else if (r.status === 403) {
      eintrag = { tab: s.tab, status: "keinZugriff" };
    } else {
      eintrag = nach
        ? { ...bisher, fehlerMehr: true }
        : { tab: s.tab, status: "fehler" };
      if (nach) eintrag.status = "ok";
    }
    speicher.set(key, eintrag);
    // Ohne Sitzung gibt es «Mein Kalender» nicht: zurück zu «Alle» (das dann dieselbe Antwort zeigt)
    if (s.tab === "mein" && r.status === 401) {
      s.tab = "alle";
      return lade();
    }
    zeichne();
    if (eintrag.status === "ok") {
      melde(doc, `${eintrag.termine.length} Termine geladen.`);
    } else if (eintrag.status === "fehler") {
      melde(doc, "Das hat nicht geklappt.");
    }
  }

  let openLink = () => {};
  const waehle = (tab) => {
    if (tab === "mein" && !s.angemeldet) return;
    s.tab = tab;
    if (tab === "mein") openLink();
    s.gruppe = null;
    doc.defaultView.history.replaceState(
      null,
      "",
      tab === "mein" ? "#mein" : doc.location.pathname,
    );
    lade();
  };

  wurzel.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-aktion]");
    if (!b) return;
    const [aktion, ...rest] = b.dataset.aktion.split(":");
    const wert = rest.join(":");
    if (aktion === "tab") waehle(wert);
    else if (aktion === "ansicht") {
      s.ansicht = wert;
      lade();
    } else if (aktion === "monat") {
      if (b.getAttribute("aria-disabled") === "true") return;
      s.monat = monatPlus(s.monat, wert === "vor" ? 1 : -1);
      lade();
    } else if (aktion === "gruppe") {
      s.gruppe = wert || null;
      zeichne();
    } else if (aktion === "zeitraum") {
      s.zeitraum = wert;
      lade();
    } else if (aktion === "zuruecksetzen") {
      s.gruppe = null;
      s.zeitraum = "3m";
      lade();
    } else if (aktion === "filter") {
      if (wert === "oeffnen") {
        blatt.showModal();
        zeichne();
      } else {
        blatt.close();
      }
    } else if (aktion === "mehr") {
      lade(aktuell().naechste);
    } else if (aktion === "nochmal") {
      speicher.delete(schluessel().key);
      lade();
    }
  });
  wurzel.addEventListener("change", (e) => {
    const wahl = e.target.dataset?.wahl;
    if (wahl === "gruppe") {
      s.gruppe = e.target.value || null;
      zeichne();
    } else if (wahl === "zeitraum") {
      s.zeitraum = e.target.value;
      lade();
    }
  });
  // Reiter mit Pfeiltasten (Reiter-Muster): Pfeil, Pos1 und Ende wählen den Nachbarn
  wurzel.addEventListener("keydown", (e) => {
    if (!e.target.closest?.('[role="tab"]')) return;
    const ziel = {
      ArrowLeft: "alle",
      ArrowRight: "mein",
      Home: "alle",
      End: "mein",
    }[e.key];
    if (!ziel) return;
    e.preventDefault();
    waehle(ziel);
    doc.getElementById(`tm-reiter-${s.tab}`)?.focus();
  });
  blatt.addEventListener("close", () =>
    doc.querySelector('[data-f="filter-knopf"]')?.focus(),
  );

  const link = startLink(doc, bLink, () => {
    s.angemeldet = false;
    waehle("alle");
  });
  openLink = () => link.oeffne();
  if (s.tab === "mein") link.oeffne();
  lade();
}

const wurzel =
  typeof document === "undefined" ? null : document.getElementById("tm-app");
if (wurzel?.dataset.seite === "termine") start(document, wurzel);
