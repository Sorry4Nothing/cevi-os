import { anfrage } from "./api.js";
import { gehe, zurueckKlick } from "./verlauf.js";
import {
  auswahl,
  dialogFormular,
  el,
  filterGruppe,
  icon,
  knopf,
} from "./dom.js";
import {
  heuteZuerich,
  keineTreffer,
  suchfeld,
  terminAnzeige,
  trifft,
  uhr,
  vorText,
  zaehlwort,
  zeitraumText,
  ersetze,
  speicherLeiste,
} from "./kalenderhilfen.js";
import { skeletonDetail, skeletonFormular, skeletonListe } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import { monatVon, monatsName, terminTage } from "./termine-monat.js";
import {
  BASIS,
  FUER,
  adresse,
  anzahlAenderungen,
  einstellungsFelder,
  fristSatz,
  fristText,
  ladeKopf,
  leiteAltAdresseUm,
  meldungVon,
  prozente,
  sichtText,
  statusChip,
  vergiss,
  vorbei,
} from "./anlass-gemeinsam.js";
import { zeigeAnmeldungen } from "./anlass-anmeldungen.js";
import { zeichneFelder } from "./anlass-felder.js";

// Bereich «Anlässe» (A17, A18, #445, Epic #430; neu gestaltet in #608): Anlässe anlegen und verwalten. Ein Anlass hat vier Reiter: Übersicht, Anmeldungen, Zusatzfelder, Einstellungen. Anmeldungen erreicht man nur über den Anlass; die alten Adressen #anlaesse/anmeldungen[/<id>] leiten hierher.
// Adressen: #anlaesse/anlaesse (Liste) · …/<id> (Übersicht) · …/<id>/anmeldungen · …/<id>/felder · …/<id>/einstellungen. Hat der Bereich nur noch eine Unterseite, steht «anlaesse» einmal weniger in der Adresse; das Modul liest beide Formen.
// Abfragen: Liste beim Öffnen 1 (und je «Weitere laden» 1; Zusatzfelder und Rückmeldungen je Anlass zählt die Abfrage der Seite mit); Anlass beim Öffnen 2 (Anlass, die letzten 5 Anmeldungen mit den Summen; 30 Sekunden im Speicher, damit der Wechsel zwischen Reitern nicht nochmals fragt); Reiter «Anmeldungen» 1 mehr, «Einstellungen» 1 mehr (Gruppen); «Anlass anlegen» holt beim Öffnen des Formulars 2 (Termine, Gruppen). Kein Polling, kein Abruf je Zeile. Die Rechte prüft der Server (nur Abteilungsleitung).
// Lücken gegenüber dem Design: Die Seite des Anlasses steht als Verweis in den Angaben, nicht mit ihrem Pfad; beim Konflikt der Zusatzfelder fehlt der Name der Person, die geändert hat.

const SEITE = 50;

export function zeige(bereich, ctx) {
  const pfad = [...ctx.pfad];
  // Hat der Bereich nur eine Unterseite, kommt «anlaesse» doppelt: Das Modul liest beide Adressen
  if (pfad[0] === "anlaesse") pfad.shift();
  // Alte Adresse «Anmeldungen»: gibt es nur über den Anlass; ohne Anlass die Liste der Anlässe
  if (pfad[0] === "anmeldungen") {
    leiteAltAdresseUm(pfad);
    return;
  }
  const [id, reiter] = pfad;
  if (id) zeigeAnlass(bereich, ctx, id, reiter);
  else zeigeListe(bereich, ctx);
}

/* ---------- Liste ---------- */

const MONAT_KURZ = new Intl.DateTimeFormat("de-CH", {
  month: "short",
  timeZone: "UTC",
});
const WOCHENTAG_KURZ = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  timeZone: "UTC",
});

// Beginn für die Sortierung und Gruppierung: Schweizer Kalendertag plus Uhrzeit
const beginnVon = (a) =>
  `${terminTage(a)[0]}T${a.ganztaegig ? "00:00" : uhr(new Date(a.beginn))}`;

// Reine Funktion (Test): kommende Anlässe zuerst, nach Beginn aufsteigend, dann die vergangenen, die neuesten zuerst
export function ordne(anlaesse, istVorbei = vorbei) {
  const kommend = anlaesse
    .filter((a) => !istVorbei(a))
    .sort((a, b) => beginnVon(a).localeCompare(beginnVon(b)));
  const vergangen = anlaesse
    .filter((a) => istVorbei(a))
    .sort((a, b) => beginnVon(b).localeCompare(beginnVon(a)));
  return [...kommend, ...vergangen];
}

// Reine Funktion (Test): [{ monat: "2026-12", anlaesse: [...] }] in der Reihenfolge der Eingabe
export function nachMonaten(anlaesse) {
  const gruppen = [];
  for (const a of anlaesse) {
    const monat = monatVon(terminTage(a)[0]);
    const letzte = gruppen.at(-1);
    if (letzte?.monat === monat) letzte.anlaesse.push(a);
    else gruppen.push({ monat, anlaesse: [a] });
  }
  return gruppen;
}

function zeigeListe(bereich, ctx) {
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", `${BASIS}?limit=${SEITE}`),
      (erste) => zeichneListe(bereich, ctx, erste),
      {
        skeleton: () => skeletonListe({ zeilen: 4 }),
        fehlerTitel: "Die Anlässe konnten nicht geladen werden.",
      },
    );
  ctx.kopfAktion(
    knopf("Neuer Anlass", {
      art: "haupt",
      symbol: "plus",
      onclick: (e) => anlegen(ctx, e.currentTarget),
    }),
  );
  return lade();
}

// Der Block mit dem Datum: Wochentag, Tag, Monat (bei mehreren Tagen der erste)
function datumsBlock(a) {
  const tag = terminTage(a)[0];
  const d = new Date(`${tag}T12:00:00Z`);
  return el(
    "span",
    { class: "anl-datum", "aria-hidden": "true" },
    el("span", { class: "anl-datum-wt" }, WOCHENTAG_KURZ.format(d)),
    el("span", { class: "anl-datum-tag" }, String(Number(tag.slice(8)))),
    el("span", { class: "anl-datum-mon" }, MONAT_KURZ.format(d)),
  );
}

function zeichneListe(bereich, ctx, erste) {
  const anlaesse = [...erste.anlaesse];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let begriff = "";
  let zeit = anlaesse.some((a) => !vorbei(a)) ? "kommend" : "alle";

  const filterHalter = el("div", {});
  const suche = suchfeld({
    label: "Anlass suchen",
    beiAenderung: (wert) => {
      begriff = wert;
      zeichneAnlaesse();
    },
  });
  const werkzeuge = el(
    "div",
    { class: "anl-werkzeuge" },
    filterHalter,
    suche.wurzel,
  );
  const liste = el("div", { class: "anl-gruppen" });
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  function zeichneFilter() {
    const kommend = anlaesse.filter((a) => !vorbei(a)).length;
    const gruppe = filterGruppe({
      beschriftung: "Zeitraum",
      eintraege: [
        { text: "Kommend", n: kommend, wert: "kommend" },
        { text: "Vergangen", n: anlaesse.length - kommend, wert: "vergangen" },
        { text: "Alle", n: anlaesse.length, wert: "alle" },
      ],
      wert: zeit,
      beiAenderung: (wert) => {
        zeit = wert;
        zeichneAnlaesse();
      },
    });
    ersetze(filterHalter, gruppe.wurzel);
  }

  function karte(a, nr) {
    const titelId = `anl-t-${nr}`;
    const metaId = `anl-m-${nr}`;
    const { zeit: zeitText } = zeitUndTage(a);
    const m = a.anmeldungen;
    return el(
      "li",
      { class: `anl-zeile${vorbei(a) ? " anl-zeile--vorbei" : ""}` },
      el(
        "a",
        {
          class: "anl-karte",
          href: adresse(a.id),
          "aria-labelledby": titelId,
          "aria-describedby": metaId,
        },
        datumsBlock(a),
        el(
          "span",
          { class: "anl-haupt" },
          el("span", { class: "anl-titel", id: titelId }, a.titel),
          el(
            "span",
            { class: "anl-meta klein leise tm-ziffern", id: metaId },
            // Der Datumsblock ist nur Zierde: Das Datum steht hier für Screenreader
            el("span", { class: "nur-leser" }, `${terminAnzeige(a).tag}, `),
            `${zeitText} · ${vorbei(a) ? "Termin vorbei" : fristSatz(a)}`,
          ),
        ),
        el("ul", { class: "chips anl-status" }, statusChip(a)),
        el(
          "span",
          { class: "anl-zahl" },
          el(
            "span",
            { class: "anl-zahl-gross tm-ziffern" },
            String(m.angemeldet),
          ),
          el(
            "span",
            { class: "klein leise" },
            m.angemeldet === 1 ? "angemeldet" : "angemeldet",
            m.abgemeldet > 0 ? ` · ${m.abgemeldet} abgemeldet` : "",
          ),
        ),
        icon("weiter"),
      ),
    );
  }

  let zaehler = 0;
  function zeichneAnlaesse() {
    mehr.hidden = !weitere;
    suche.wurzel.hidden = anlaesse.length < 12;
    if (anlaesse.length === 0) {
      werkzeuge.hidden = true;
      ersetze(
        liste,
        leerKarte("Es gibt noch keine Anlässe mit Anmeldung.", [
          knopf("Neuer Anlass", {
            symbol: "plus",
            onclick: (e) => anlegen(ctx, e.currentTarget),
          }),
        ]),
      );
      return;
    }
    werkzeuge.hidden = false;
    const gefiltert = ordne(anlaesse).filter(
      (a) =>
        (zeit === "alle" || (zeit === "vergangen") === vorbei(a)) &&
        (!begriff || trifft(a.titel, begriff)),
    );
    if (gefiltert.length === 0) {
      ersetze(
        liste,
        begriff
          ? keineTreffer(begriff, () => {
              suche.eingabe.value = "";
              begriff = "";
              zeichneAnlaesse();
              suche.eingabe.focus();
            })
          : leerKarte(
              zeit === "kommend"
                ? "Es steht kein Anlass mehr an."
                : "Es gibt keine vergangenen Anlässe.",
              zeit === "kommend" ? [alleKnopf()] : [],
            ),
      );
      return;
    }
    zaehler = 0;
    ersetze(
      liste,
      nachMonaten(gefiltert).map(({ monat, anlaesse: im }) =>
        el(
          "section",
          { class: "anl-gruppe", "aria-label": monatsName(monat) },
          el(
            "h2",
            { class: "anl-monat" },
            monatsName(monat),
            el(
              "span",
              { class: "klein leise" },
              zaehlwort(im.length, "Anlass", "Anlässe"),
            ),
          ),
          el(
            "ul",
            { class: "anl-liste" },
            im.map((a) => karte(a, zaehler++)),
          ),
        ),
      ),
    );
  }

  const alleKnopf = () =>
    knopf("Alle anzeigen", {
      onclick: () => {
        zeit = "alle";
        zeichneFilter();
        zeichneAnlaesse();
      },
    });

  async function ladeWeitere() {
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Anlässe werden geladen …";
    try {
      const seite = await anfrage(
        "GET",
        `${BASIS}?limit=${SEITE}&nach=${encodeURIComponent(naechste)}`,
      );
      if (!bereich.isConnected) return;
      anlaesse.push(...seite.anlaesse);
      weitere = seite.weitere;
      naechste = seite.naechste;
      meldung.textContent = `${zaehlwort(seite.anlaesse.length, "weiterer Anlass", "weitere Anlässe")} geladen.`;
      zeichneFilter();
      zeichneAnlaesse();
    } catch (f) {
      meldung.textContent = `${meldungVon(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    werkzeuge,
    liste,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneFilter();
  zeichneAnlaesse();
}

// Zeit und, bei mehreren Tagen, der Zeitraum eines Anlasses für die Kartenzeile: «08:00–11:00», «ganztägig», «ganztägig, 24.07.–02.08.2027»
function zeitUndTage(a) {
  const [von, bis] = terminTage(a);
  const kurz = (t) => `${t.slice(8)}.${t.slice(5, 7)}.`;
  const mehrtaegig = von !== bis ? ` bis ${kurz(bis)}${bis.slice(0, 4)}` : "";
  if (a.ganztaegig) return { zeit: `ganztägig${mehrtaegig}` };
  return {
    zeit: `${uhr(new Date(a.beginn))}–${uhr(new Date(a.ende))}${mehrtaegig}`,
  };
}

/* ---------- Neuer Anlass ---------- */

async function anlegen(ctx, ausloeser) {
  const von = heuteZuerich();
  const bis = new Date(Date.parse(von) + 399 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  ausloeser.disabled = true;
  ausloeser.setAttribute("aria-busy", "true");
  let termine;
  let tags;
  try {
    [termine, tags] = await Promise.all([
      anfrage("GET", `/api/v1/termine/alle?von=${von}&bis=${bis}&limit=100`),
      anfrage("GET", "/api/v1/admin/tags"),
    ]);
  } catch (f) {
    ctx.melde(meldungVon(f), "fehler");
    return;
  } finally {
    ausloeser.disabled = false;
    ausloeser.removeAttribute("aria-busy");
  }
  const frei = termine.termine.filter((t) => !t.anlass);
  if (frei.length === 0) {
    ctx.melde(
      "Es gibt keinen kommenden Termin ohne Anlass. Termine kommen aus Outlook.",
      "fehler",
    );
    return;
  }
  const wahl = auswahl({
    label: "Termin",
    optionen: [
      ["", "Termin wählen"],
      ...frei.map((t) => [t.id, `${t.titel} · ${zeitraumText(t)}`]),
    ],
    wert: "",
  });
  const terminFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const rest = einstellungsFelder(tags.tags, {
    anmeldungFuer: "kind",
    anmeldungOffen: true,
    frist: null,
    sichtbarkeit: { art: "angemeldet" },
  });
  const k = rest.knoten;
  dialogFormular({
    titel: "Neuer Anlass",
    beschreibung:
      "Ein Anlass macht aus einem Termin einen Termin mit Anmeldung. Die Zusatzfragen ergänzt du danach.",
    felder: [
      wahl.wurzel,
      terminFehler,
      termine.weitere &&
        el(
          "p",
          { class: "hilfe" },
          "Die Liste zeigt die nächsten 100 Termine.",
        ),
      k.fuer,
      k.offen,
      k.frist,
      k.sicht,
      ...k.tags,
    ],
    ok: "Anlass anlegen",
    pruefe() {
      if (!wahl.eingabe.value) {
        terminFehler.textContent = "Wähle einen Termin.";
        terminFehler.hidden = false;
        wahl.wurzel.querySelector(".auswahl-knopf").focus();
        return true;
      }
      terminFehler.hidden = true;
      return rest.pruefe();
    },
    senden: () =>
      anfrage("POST", BASIS, {
        programmId: wahl.eingabe.value,
        ...rest.lies(),
      }),
    fehlertext: meldungVon,
    danach: (neu) => {
      gehe(adresse(neu.id));
    },
  });
}

/* ---------- Ein Anlass mit seinen Reitern ---------- */

const REITER = [
  ["", "Übersicht"],
  ["anmeldungen", "Anmeldungen"],
  ["felder", "Zusatzfelder"],
  ["einstellungen", "Einstellungen"],
];

function zeigeAnlass(bereich, ctx, id, reiter = "") {
  const aktiv = REITER.some(([schluessel]) => schluessel === reiter)
    ? reiter
    : "";
  const lade = (neu = false) =>
    ctx.lade(
      () => ladeKopf(id, { neu }),
      (daten) =>
        zeichneRahmen(bereich, ctx, id, aktiv, daten, () => lade(true)),
      {
        skeleton: skeletonDetail,
        fehlerTitel: "Der Anlass konnte nicht geladen werden.",
      },
    );
  return lade();
}

function zeichneRahmen(
  bereich,
  ctx,
  id,
  reiter,
  { anlass: a, anmeldungen },
  neu,
) {
  ctx.titel(a.titel, zeitraumText(a));
  const summe = anmeldungen.summe;
  const gesamt = summe.angemeldet + summe.abgemeldet;
  const pfad = `${BASIS}/${encodeURIComponent(id)}`;
  const zahlen = {
    anmeldungen: gesamt,
    felder: a.felder.length,
  };
  const body = el("div", { class: "anl-reiter", id: "anl-inhalt" });
  bereich.append(
    el(
      "p",
      {},
      el(
        "a",
        {
          class: "knopf knopf--still knopf--klein",
          href: adresse(),
          onclick: zurueckKlick,
        },
        icon("zurueck"),
        "Alle Anlässe",
      ),
    ),
    el(
      "nav",
      { class: "tabs anl-tabs", "aria-label": "Bereiche des Anlasses" },
      REITER.map(([schluessel, name]) =>
        el(
          "a",
          {
            class: "tab",
            href: adresse(id, schluessel),
            ...(schluessel === reiter && { "aria-current": "page" }),
          },
          name,
          zahlen[schluessel] !== undefined &&
            el("span", { class: "n anl-tabzahl" }, String(zahlen[schluessel])),
        ),
      ),
    ),
    body,
  );
  const hilfe = { ctx, id, pfad, a, summe, anmeldungen, neu };
  if (reiter === "anmeldungen") zeigeAnmeldungen(body, ctx, pfad, a);
  else if (reiter === "felder") zeichneFelder(body, ctx, pfad, a, id);
  else if (reiter === "einstellungen") zeigeEinstellungen(body, hilfe);
  else zeichneUebersicht(body, hilfe);
}

/* ---------- Reiter «Übersicht» ---------- */

// Zählt eine Zahl in 0,3 Sekunden hoch; nur bei erlaubter Bewegung, sonst steht sie sofort da
function zaehleHoch(knoten, ziel, nachsatz = "") {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || ziel === 0) {
    knoten.textContent = `${ziel}${nachsatz}`;
    return;
  }
  const start = window.performance.now();
  const schritt = (jetzt) => {
    const t = Math.min(1, (jetzt - start) / 320);
    knoten.textContent = `${Math.round(ziel * (1 - (1 - t) ** 3))}${nachsatz}`;
    if (t < 1 && knoten.isConnected) window.requestAnimationFrame(schritt);
  };
  knoten.textContent = `0${nachsatz}`;
  window.requestAnimationFrame(schritt);
}

const SVG = "http://www.w3.org/2000/svg";

// Eine Zeile der Rückmeldungen: Der Balken ist der Hintergrund der Zeile (Breite als Attribut, die CSP erlaubt keine Inline-Stile); Name links, Anzahl und Anteil rechts
function ergebnisZeile(name, n, anteil, art, fuehrt) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "anl-erg-balken");
  svg.setAttribute("viewBox", "0 0 100 10");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const fuell = document.createElementNS(SVG, "rect");
  fuell.setAttribute("class", "anl-erg-fuell");
  fuell.setAttribute("width", String(anteil));
  fuell.setAttribute("height", "10");
  svg.append(fuell);
  const wert = el("span", { class: "anl-erg-anteil tm-ziffern" });
  zaehleHoch(wert, anteil, " %");
  return el(
    "li",
    { class: `anl-erg anl-erg--${art}${fuehrt ? " anl-erg--fuehrt" : ""}` },
    svg,
    el("span", { class: "anl-erg-name" }, name),
    el("span", { class: "anl-erg-zahl tm-ziffern" }, String(n)),
    wert,
  );
}

function zeichneUebersicht(
  bereich,
  { ctx, id, pfad, a, summe, anmeldungen, neu },
) {
  const gesamt = summe.angemeldet + summe.abgemeldet;
  const [pa, pb] = prozente([summe.angemeldet, summe.abgemeldet]);

  async function umschalten(knoten) {
    const offen = !a.anmeldungOffen;
    knoten.disabled = true;
    knoten.setAttribute("aria-busy", "true");
    try {
      await anfrage("PATCH", pfad, { anmeldungOffen: offen });
      vergiss(id);
      ctx.melde(
        offen ? "Die Anmeldung ist offen." : "Die Anmeldung ist geschlossen.",
      );
      await neu();
      document.querySelector("h1")?.focus();
    } catch (f) {
      ctx.melde(meldungVon(f), "fehler");
      knoten.disabled = false;
      knoten.removeAttribute("aria-busy");
    }
  }

  const zuletzt = anmeldungen.eintraege;
  const name = (e) =>
    e.kind ? `${e.kind.vorname} ${e.kind.nachname}` : e.person.name;

  const rueckmeldungen = el(
    "section",
    { class: "flaeche anl-rueck", "aria-labelledby": "anl-rueck" },
    el("h2", { id: "anl-rueck" }, "Rückmeldungen"),
    el(
      "p",
      { class: "klein leise" },
      gesamt === 0
        ? "Noch hat niemand geantwortet."
        : `${zaehlwort(gesamt, "Rückmeldung", "Rückmeldungen")}, Anteil an allen Rückmeldungen.`,
    ),
    el(
      "ul",
      { class: "anl-erg-liste" },
      ergebnisZeile(
        "Angemeldet",
        summe.angemeldet,
        pa,
        "ja",
        summe.angemeldet >= summe.abgemeldet && gesamt > 0,
      ),
      ergebnisZeile(
        "Abgemeldet",
        summe.abgemeldet,
        pb,
        "nein",
        summe.abgemeldet > summe.angemeldet,
      ),
    ),
    el(
      "p",
      { class: "klein leise anl-erg-hinweis" },
      "Wer noch nicht geantwortet hat, kennt Cevi OS nicht: Es zählt nur, wer sich an- oder abgemeldet hat.",
    ),
  );

  const letzte = el(
    "section",
    { class: "flaeche", "aria-labelledby": "anl-letzte" },
    el("h2", { id: "anl-letzte" }, "Zuletzt geändert"),
    zuletzt.length === 0
      ? el("p", { class: "leise" }, "Es gibt noch keine Anmeldungen.")
      : el(
          "ul",
          { class: "liste-zeilen" },
          zuletzt.map((e) =>
            el(
              "li",
              {},
              el(
                "div",
                { class: "text" },
                el("span", { class: "name" }, name(e)),
                el("span", { class: "klein leise" }, vorText(e.geaendertAm)),
              ),
              el(
                "ul",
                { class: "chips" },
                e.status === "angemeldet"
                  ? statusPill("Angemeldet", "ok")
                  : statusPill("Abgemeldet"),
              ),
            ),
          ),
        ),
    gesamt > zuletzt.length &&
      el(
        "a",
        { class: "knopf knopf--klein", href: adresse(id, "anmeldungen") },
        `Alle ${gesamt} Anmeldungen`,
      ),
    gesamt > 0 &&
      gesamt <= zuletzt.length &&
      el(
        "a",
        { class: "knopf knopf--klein", href: adresse(id, "anmeldungen") },
        "Anmeldungen und Export",
      ),
  );

  const stand = el(
    "section",
    { class: "flaeche", "aria-labelledby": "anl-stand" },
    el("h2", { id: "anl-stand" }, "Anmeldung"),
    el("ul", { class: "chips" }, statusChip(a)),
    el("p", { class: "anl-frist" }, icon("uhr"), fristSatz(a)),
    el(
      "div",
      { class: "reihe" },
      knopf(a.anmeldungOffen ? "Anmeldung schliessen" : "Anmeldung öffnen", {
        onclick: (e) => umschalten(e.currentTarget),
      }),
      el(
        "a",
        { class: "knopf knopf--still", href: adresse(id, "einstellungen") },
        "Einstellungen",
      ),
    ),
  );

  const angaben = [
    ["Anmeldung für", FUER[a.anmeldungFuer]],
    ["Anmeldeschluss", fristText(a)],
    ["Sichtbar für", sichtText(a.sichtbarkeit)],
    [
      "Zusatzfelder",
      el(
        "a",
        { class: "tm-tabellenlink", href: adresse(id, "felder") },
        a.felder.length === 0
          ? "Keine, hinzufügen"
          : `${a.felder.length}, bearbeiten`,
      ),
    ],
    a.seiteId && [
      "Seite",
      el(
        "a",
        { class: "tm-tabellenlink", href: `#website/seiten/${a.seiteId}` },
        "Im Bereich «Website» öffnen",
      ),
    ],
  ].filter(Boolean);
  const daten = el(
    "section",
    { class: "flaeche", "aria-labelledby": "anl-daten" },
    el("h2", { id: "anl-daten" }, "Angaben"),
    el(
      "dl",
      { class: "werte" },
      angaben.map(([n, w]) => el("div", {}, el("dt", {}, n), el("dd", {}, w))),
    ),
  );

  bereich.append(
    el(
      "div",
      { class: "anl-uebersicht" },
      el("div", { class: "anl-spalte" }, rueckmeldungen, letzte),
      el("div", { class: "anl-spalte" }, stand, daten),
    ),
  );
}

// Kleine Pille mit Wort und Symbol (wie statusChip, für Anmeldungen einer Person)
function statusPill(text, art) {
  return el(
    "li",
    { class: art ? `chip chip--${art}` : "chip" },
    art === "ok" && icon("haken"),
    text,
  );
}

/* ---------- Reiter «Einstellungen» ---------- */

function zeigeEinstellungen(bereich, { ctx, id, pfad, a, summe, neu }) {
  const gesamt = summe.angemeldet + summe.abgemeldet;
  const lade = ctx.erstelleLader(bereich);
  lade(
    () => anfrage("GET", "/api/v1/admin/tags").then((t) => t.tags),
    (tags) =>
      zeichneEinstellungen(bereich, { ctx, id, pfad, a, gesamt, neu, tags }),
    {
      skeleton: () => skeletonFormular({ felder: 4 }),
      fehlerTitel: "Die Einstellungen konnten nicht geladen werden.",
    },
  );
}

function zeichneEinstellungen(
  bereich,
  { ctx, id, pfad, a, gesamt, neu, tags },
) {
  const f = einstellungsFelder(tags, a, { fuerFest: gesamt > 0 });
  const k = f.knoten;
  const start = f.lies();
  const leiste = speicherLeiste({
    beiSpeichern: (knopfNode) => speichern(knopfNode),
    beiVerwerfen: () => {
      f.setze(a);
      aktualisiere();
    },
  });
  const meldungen = el("div", {});

  function aktualisiere() {
    const n = anzahlAenderungen(start, f.lies());
    if (n === 0) leiste.verstecke();
    else
      leiste.zeige(
        `${zaehlwort(n, "Änderung", "Änderungen")} noch nicht gespeichert.`,
      );
  }

  async function speichern(knopfNode) {
    ersetze(meldungen);
    if (f.pruefe()) return;
    knopfNode.disabled = true;
    knopfNode.setAttribute("aria-busy", "true");
    try {
      const neuer = f.lies();
      // Nur, was sich geändert hat: «anmeldungFuer» steht nicht dabei, wenn es schon Anmeldungen gibt
      const aenderung = Object.fromEntries(
        Object.entries(neuer).filter(
          ([schluessel, wert]) =>
            JSON.stringify(wert) !== JSON.stringify(start[schluessel] ?? null),
        ),
      );
      await anfrage("PATCH", pfad, aenderung);
      vergiss(id);
      ctx.melde("Die Einstellungen sind gespeichert.");
      await neu();
      document.querySelector("h1")?.focus();
    } catch (fehler) {
      const hinweis = el(
        "div",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht gespeichert. ${meldungVon(fehler)} Deine Eingaben sind noch da.`,
      );
      ersetze(meldungen, hinweis);
      hinweis.focus();
      knopfNode.disabled = false;
      knopfNode.removeAttribute("aria-busy");
    }
  }

  // Mit «Rückgängig» (#578): Die Liste öffnet sofort, gelöscht wird nach der Frist. Das geht nur ohne Anmeldungen; der Termin und die Anlassseite im Bereich «Website» bleiben
  function loeschen() {
    const hier = window.location.hash;
    ctx.mitRueckgaengig({
      text: `«${a.titel}» ist kein Anlass mehr. Der Termin bleibt`,
      ansicht: {
        weg: () => gehe(adresse()),
        zurueck: () => gehe(hier),
      },
      ausfuehren: async () => {
        await anfrage("DELETE", pfad);
        vergiss(id);
      },
      fehlertext: meldungVon,
    });
  }

  const form = el(
    "div",
    { class: "anl-einstellungen" },
    meldungen,
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "anl-e-anm" },
      el("h2", { id: "anl-e-anm" }, "Anmeldung"),
      k.fuer,
      k.offen,
      k.frist,
    ),
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "anl-e-sicht" },
      el("h2", { id: "anl-e-sicht" }, "Sichtbarkeit"),
      k.sicht,
      ...k.tags,
    ),
    el(
      "section",
      { class: "flaeche anl-gefahr", "aria-labelledby": "anl-e-weg" },
      el("h2", { id: "anl-e-weg" }, "Löschen"),
      el(
        "p",
        { class: "leise" },
        gesamt > 0
          ? `Ein Anlass mit Anmeldungen lässt sich nicht löschen (${zaehlwort(gesamt, "Anmeldung", "Anmeldungen")}). Schliesse die Anmeldung, wenn niemand mehr dazukommen soll.`
          : "Der Termin bleibt im Kalender, die Seite im Bereich «Website» auch. Es verschwindet nur die Anmeldung samt Zusatzfeldern.",
      ),
      el(
        "div",
        { class: "reihe" },
        knopf("Anlass löschen", {
          art: "gefahr",
          symbol: "papierkorb",
          disabled: gesamt > 0,
          onclick: () => loeschen(),
        }),
      ),
    ),
    leiste.wurzel,
  );
  form.addEventListener("input", aktualisiere);
  form.addEventListener("change", aktualisiere);
  bereich.append(form);
}
