import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { chip, el, filterGruppe, icon, knopf } from "./dom.js";
import { zurueckKlick } from "./verlauf.js";
import {
  keineTreffer,
  stempel,
  suchfeld,
  trifft,
  zaehlwort,
  zeitraumText,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { skeletonListe, skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";

// Bereich «Anlässe», Unterseite «Anmeldungen» (A19, #445, Epic #430): Wer sich zu einem Anlass angemeldet hat, mit den Antworten auf die Zusatzfelder, und der Export als CSV.
// Adressen: #anlaesse/anmeldungen (Anlass wählen) · #anlaesse/anmeldungen/<id> (Anmeldungen eines Anlasses)
// Abfragen: Auswahl 1 (und je «Weitere laden» 1, 50 Anlässe); ein Anlass beim Öffnen 2 (Anlass, Anmeldungen), danach 1 je Wechsel des Stands oder «Weitere laden» (50 Anmeldungen); Export 1 je Klick (alle Zeilen, ohne Zwischenspeicher). Suche läuft im Browser. Kein Polling. Die Rechte prüft der Server (nur Abteilungsleitung).
// Abweichungen vom Design: Der Stand heisst «Angemeldet» und «Abgemeldet» (die API kennt kein «Offen»); der Export kennt nur CSV, denn Excel-Dateien sind gestrichen; die Zahl der Zeilen je Seite ist fest (50, «Weitere laden»).

const BASIS = "/api/v1/admin/anlaesse";
const SEITE = 50;

const STATUS_TEXT = {
  angemeldet: "angemeldet",
  abgemeldet: "abgemeldet",
  alle: "angemeldet und abgemeldet",
};

export function zeige(bereich, ctx) {
  const [id] = ctx.pfad;
  if (id) zeigeAnmeldungen(bereich, ctx, id);
  else zeigeAuswahl(bereich, ctx);
}

/* ---------- Anlass wählen ---------- */

function zeigeAuswahl(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", `${BASIS}?limit=${SEITE}`),
    (erste) => {
      const anlaesse = [...erste.anlaesse];
      if (anlaesse.length === 0) {
        bereich.append(
          leerKarte("Es gibt noch keine Anlässe mit Anmeldung.", [
            el(
              "a",
              { class: "knopf", href: "#anlaesse/anlaesse" },
              "Zu den Anlässen",
            ),
          ]),
        );
        return;
      }
      let weitere = erste.weitere;
      let naechste = erste.naechste;
      const liste = el("ul", { class: "liste-zeilen" });
      const meldung = el("p", { class: "klein tm-meldung", role: "status" });
      const mehr = knopf("Weitere laden", {
        symbol: "runter",
        onclick: () => ladeWeitere(),
      });
      const zeile = (a) =>
        el(
          "li",
          {},
          el(
            "div",
            { class: "text" },
            el("span", { class: "name" }, a.titel),
            el("span", { class: "klein leise tm-ziffern" }, zeitraumText(a)),
          ),
          el(
            "a",
            {
              class: "knopf knopf--klein",
              href: `#anlaesse/anmeldungen/${a.id}`,
              "aria-label": `Anmeldungen ansehen: ${a.titel}`,
            },
            "Anmeldungen ansehen",
          ),
        );
      const zeichneListe = () => {
        ersetze(liste, ...anlaesse.map(zeile));
        mehr.hidden = !weitere;
      };
      async function ladeWeitere() {
        mehr.disabled = true;
        mehr.setAttribute("aria-busy", "true");
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
          zeichneListe();
        } catch (f) {
          meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
        } finally {
          mehr.disabled = false;
          mehr.removeAttribute("aria-busy");
        }
      }
      bereich.append(
        el(
          "section",
          { class: "flaeche", "aria-labelledby": "am-wahl" },
          el("h2", { id: "am-wahl" }, "Anlass wählen"),
          el("p", { class: "leise" }, "Die neuesten Anlässe stehen oben."),
          liste,
        ),
        meldung,
        el("div", { class: "tm-mehr" }, mehr),
      );
      zeichneListe();
    },
    {
      skeleton: skeletonListe,
      fehlerTitel: "Die Anlässe konnten nicht geladen werden.",
    },
  );
}

/* ---------- Anmeldungen eines Anlasses (A19) ---------- */

const ladeSeite = (pfad, status, nach) =>
  anfrage(
    "GET",
    `${pfad}/anmeldungen?status=${status}&limit=${SEITE}${nach ? `&nach=${encodeURIComponent(nach)}` : ""}`,
  );

function zeigeAnmeldungen(bereich, ctx, id) {
  const pfad = `${BASIS}/${encodeURIComponent(id)}`;
  ctx.lade(
    () => Promise.all([anfrage("GET", pfad), ladeSeite(pfad, "alle")]),
    ([anlass, erste]) => zeichne(bereich, ctx, pfad, anlass, erste),
    {
      skeleton: () => skeletonTabelle({ spalten: 6, avatar: false }),
      fehlerTitel: "Die Anmeldungen konnten nicht geladen werden.",
    },
  );
}

function zeichne(bereich, ctx, pfad, anlass, erste) {
  let status = "alle";
  let eintraege = [...erste.eintraege];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let summe = erste.summe;
  let begriff = "";
  const fuerKind = anlass.anmeldungFuer === "kind";

  const gesamt = () => summe.angemeldet + summe.abgemeldet;
  const untertitel = () =>
    gesamt() === 0
      ? `${anlass.titel} · noch keine Anmeldungen.`
      : `${anlass.titel} · ${summe.angemeldet} angemeldet, ${summe.abgemeldet} abgemeldet.`;
  ctx.titel("Anmeldungen", untertitel());
  // Der Export ist eine Karte auf der Seite (Download-Muster), kein Fenster; sie kennt den gewählten Stand
  const exportKarte = erstelleExport(pfad, anlass, () => status);
  const balkenHalter = el("div", {});
  const kopfblock = el(
    "div",
    { class: "tm-anmeldekopf" },
    balkenHalter,
    exportKarte.wurzel,
  );
  const zeichneBalken = () => ersetze(balkenHalter, balkenKarte(summe, anlass));

  const filterHalter = el("div", {});
  const werkzeuge = el("div", { class: "werkzeuge" });
  const liste = el("div", {});
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => lade(false),
  });
  const suche = suchfeld({
    label: fuerKind ? "Name Kind" : "Name",
    beiAenderung: (wert) => {
      begriff = wert;
      zeichneListe();
    },
  });

  function zeichneFilter() {
    const gruppe = filterGruppe({
      beschriftung: "Stand",
      eintraege: [
        { text: "Alle", n: gesamt(), wert: "alle" },
        { text: "Angemeldet", n: summe.angemeldet, wert: "angemeldet" },
        { text: "Abgemeldet", n: summe.abgemeldet, wert: "abgemeldet" },
      ],
      wert: status,
      beiAenderung: (wert) => {
        const alt = status;
        status = wert;
        lade(true, alt);
      },
    });
    ersetze(filterHalter, gruppe.wurzel);
  }

  const antwort = (e, f) => {
    const wert = e.antworten[f.schluessel];
    if (wert === undefined || wert === "") return "–";
    return typeof wert === "boolean" ? (wert ? "Ja" : "Nein") : wert;
  };

  function zeile(e) {
    return el(
      "tr",
      {},
      el(
        "th",
        { scope: "row" },
        fuerKind
          ? e.kind
            ? [
                el(
                  "span",
                  { class: "name" },
                  `${e.kind.vorname} ${e.kind.nachname}`,
                ),
                e.kind.ceviName &&
                  el("span", { class: "klein leise tm-zeit" }, e.kind.ceviName),
              ]
            : "–"
          : el("span", { class: "name" }, e.person.name),
      ),
      fuerKind
        ? el(
            "td",
            {},
            e.kind
              ? el("ul", { class: "chips" }, chip(e.kind.stufe, "stufe", "tag"))
              : "–",
          )
        : el("td", {}, e.person.telefon ?? "–"),
      fuerKind &&
        el(
          "td",
          {},
          el("span", {}, e.person.name),
          e.person.telefon &&
            el("span", { class: "klein leise tm-zeit" }, e.person.telefon),
        ),
      el("td", { class: "tm-ziffern" }, stempel(e.geaendertAm)),
      anlass.felder.map((f) => el("td", {}, antwort(e, f))),
      el(
        "td",
        {},
        el(
          "ul",
          { class: "chips" },
          e.status === "angemeldet"
            ? chip("Angemeldet", "ok")
            : chip("Abgemeldet", undefined, false),
        ),
      ),
    );
  }

  function zeichneListe() {
    const alles = gesamt() === 0;
    werkzeuge.hidden = alles;
    mehr.hidden = !weitere;
    if (alles) {
      const frist = anlass.frist ? stempel(anlass.frist) : null;
      ersetze(
        liste,
        leerKarte(
          `Noch hat sich niemand angemeldet. ${
            !anlass.anmeldungOffen
              ? "Die Anmeldung ist geschlossen."
              : frist
                ? `Die Anmeldung ist offen bis ${frist} Uhr.`
                : "Die Anmeldung ist offen."
          }`,
        ),
      );
      return;
    }
    const treffer = eintraege.filter((e) =>
      !begriff
        ? true
        : trifft(
            e.kind
              ? `${e.kind.vorname} ${e.kind.nachname} ${e.kind.ceviName ?? ""}`
              : "",
            begriff,
          ) || trifft(e.person.name, begriff),
    );
    if (treffer.length === 0) {
      ersetze(
        liste,
        eintraege.length === 0
          ? leerKarte(
              status === "abgemeldet"
                ? "Keine Abmeldungen."
                : "Noch niemand ist angemeldet.",
            )
          : keineTreffer(begriff, () => {
              suche.eingabe.value = "";
              begriff = "";
              zeichneListe();
              suche.eingabe.focus();
            }),
      );
      return;
    }
    const t = termineTabelle({
      beschriftung: "Anmeldungen, die zuletzt geänderten zuerst",
      spalten: [
        fuerKind ? "Name Kind" : "Name",
        fuerKind ? "Stufe" : "Telefon",
        ...(fuerKind ? ["Angemeldet von"] : []),
        "Geändert am",
        ...anlass.felder.map((f) => f.beschriftung),
        "Status",
      ],
      zeilen: treffer.map(zeile),
    });
    ersetze(
      liste,
      el(
        "p",
        { class: "klein leise", role: "status" },
        `${weitere ? "Mindestens " : ""}${zaehlwort(eintraege.length, "Anmeldung", "Anmeldungen")} mit dem Stand «${STATUS_TEXT[status]}».`,
      ),
      t.wurzel,
    );
  }

  // neu: erste Seite des gewählten Stands; sonst die nächste Seite anhängen
  async function lade(neu, alt) {
    const vonFilter = filterHalter.contains(document.activeElement);
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    liste.setAttribute("aria-busy", "true");
    meldung.textContent = "Anmeldungen werden geladen …";
    try {
      const a = await ladeSeite(pfad, status, neu ? "" : naechste);
      if (!bereich.isConnected) return;
      eintraege = neu ? a.eintraege : [...eintraege, ...a.eintraege];
      weitere = a.weitere;
      naechste = a.naechste;
      summe = a.summe;
      ctx.titel("Anmeldungen", untertitel());
      zeichneFilter();
      zeichneBalken();
      exportKarte.aktualisiere();
      zeichneListe();
      meldung.textContent = neu
        ? ""
        : `${zaehlwort(a.eintraege.length, "weitere Anmeldung", "weitere Anmeldungen")} geladen.`;
      // Der Filter wurde neu gebaut: Der gedrückte Knopf bekommt den Fokus zurück
      if (vonFilter)
        filterHalter.querySelector('[aria-pressed="true"]')?.focus();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
      // Die Tabelle zeigt noch den alten Stand: Der Filter bleibt auch dort
      if (neu) {
        status = alt;
        zeichneFilter();
        if (vonFilter)
          filterHalter.querySelector('[aria-pressed="true"]')?.focus();
      }
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
      liste.removeAttribute("aria-busy");
    }
  }

  werkzeuge.append(suche.wurzel, filterHalter);
  bereich.append(
    zurueckZeile(),
    kopfblock,
    werkzeuge,
    liste,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneFilter();
  zeichneBalken();
  zeichneListe();
}

function zurueckZeile() {
  return el(
    "p",
    {},
    el(
      "a",
      {
        class: "knopf knopf--still knopf--klein",
        href: "#anlaesse/anmeldungen",
        onclick: zurueckKlick,
      },
      icon("zurueck"),
      "Alle Anlässe",
    ),
  );
}

/* ---------- Rückmeldungen als Balken ---------- */

const SVG = "http://www.w3.org/2000/svg";
const prozent = (n, gesamt) =>
  gesamt === 0 ? 0 : Math.round((n / gesamt) * 100);

// Ein Balken: Spur und Füllung als SVG (die Breite steht als Attribut, die CSP erlaubt keine Inline-Stile). Er wächst beim Erscheinen, nur bei erlaubter Bewegung (termine.css)
function balken(anteil, art) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "tm-balken-svg");
  svg.setAttribute("viewBox", "0 0 100 10");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const spur = document.createElementNS(SVG, "rect");
  spur.setAttribute("class", "tm-balken-spur");
  spur.setAttribute("width", "100");
  spur.setAttribute("height", "10");
  const fuell = document.createElementNS(SVG, "rect");
  fuell.setAttribute("class", `tm-balken-fuell tm-balken-fuell--${art}`);
  fuell.setAttribute("width", String(anteil));
  fuell.setAttribute("height", "10");
  svg.append(spur, fuell);
  return svg;
}

// Karte «Rückmeldungen»: Angemeldet und Abgemeldet als Anteil aller Rückmeldungen. Die API kennt kein «Offen» (wer noch nicht geantwortet hat, ist ihr unbekannt), darum gibt es nur diese zwei Balken.
function balkenKarte(summe, anlass) {
  const gesamt = summe.angemeldet + summe.abgemeldet;
  const zeile = (name, n, art) =>
    el(
      "div",
      { class: "tm-balkenzeile" },
      el(
        "div",
        { class: "tm-balkentext" },
        el("span", { class: "name" }, name),
        el(
          "span",
          { class: "tm-ziffern" },
          `${n}${gesamt > 0 ? ` · ${prozent(n, gesamt)} %` : ""}`,
        ),
      ),
      balken(prozent(n, gesamt), art),
    );
  const frist = anlass.frist ? new Date(anlass.frist) : null;
  const tage = frist ? Math.ceil((frist - new Date()) / 86_400_000) : null;
  return el(
    "section",
    { class: "flaeche tm-balkenkarte", "aria-labelledby": "am-balken" },
    el("h2", { id: "am-balken" }, "Rückmeldungen"),
    el(
      "p",
      { class: "klein leise" },
      gesamt === 0
        ? "Noch keine Rückmeldung."
        : `${zaehlwort(gesamt, "Rückmeldung", "Rückmeldungen")} insgesamt.`,
    ),
    zeile("Angemeldet", summe.angemeldet, "ja"),
    zeile("Abgemeldet", summe.abgemeldet, "nein"),
    frist &&
      el(
        "p",
        { class: "klein tm-frist" },
        icon("uhr"),
        !anlass.anmeldungOffen
          ? "Die Anmeldung ist geschlossen."
          : tage > 0
            ? `Anmeldeschluss ${stempel(anlass.frist)} Uhr, noch ${zaehlwort(tage, "Tag", "Tage")}.`
            : `Anmeldeschluss war ${stempel(anlass.frist)} Uhr.`,
      ),
  );
}

/* ---------- Export als CSV (Download-Muster: bereit, läuft, fertig, fehlgeschlagen) ---------- */

// Karte auf der Seite: Dateiname, Format, und der Knopf wechselt vom Erstellen über den Fortschritt zum Herunterladen. Der Browser holt die Datei mit der Sitzung; sie liegt nur im Speicher dieser Seite, bis du sie herunterlädst oder die Seite verlässt.
function erstelleExport(pfad, anlass, holeStatus) {
  let abbruch = null;
  let objektUrl = null;
  let zustand = "bereit";
  let fehler = "";
  let blobGroesse = 0;
  let stand = holeStatus();
  const dateiname = `anmeldungen-${
    anlass.titel
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "anlass"
  }.csv`;
  const wurzel = el("section", {
    class: "flaeche tm-export",
    "aria-labelledby": "am-export",
  });
  const status = el("p", { class: "nur-leser", role: "status" });

  const freigeben = () => {
    if (objektUrl) window.URL.revokeObjectURL(objektUrl);
    objektUrl = null;
  };

  function zeichne(fokus) {
    const aktion =
      zustand === "laeuft"
        ? knopf("Abbrechen", { onclick: () => abbruch?.abort() })
        : zustand === "fertig"
          ? el(
              "a",
              {
                class: "knopf knopf--haupt",
                href: objektUrl,
                download: dateiname,
              },
              icon("ablage"),
              "Herunterladen",
            )
          : knopf(
              zustand === "fehler" ? "Nochmals versuchen" : "Export erstellen",
              {
                art: "haupt",
                symbol: zustand === "fehler" ? "aktualisieren" : "ablage",
                onclick: () => starte(),
              },
            );
    wurzel.replaceChildren(
      ...[
        el("h2", { id: "am-export" }, "Export"),
        el(
          "div",
          { class: "tm-datei" },
          el("span", { class: "tm-dateisymbol" }, icon("ablage")),
          el(
            "div",
            { class: "text" },
            el("span", { class: "name tm-roh" }, dateiname),
            el(
              "span",
              { class: "klein leise" },
              zustand === "fertig"
                ? `CSV, ${Math.max(1, Math.round(blobGroesse / 1024))} KB, bereit zum Herunterladen`
                : `CSV mit allen Anmeldungen, Stand «${STATUS_TEXT[stand]}»`,
            ),
          ),
        ),
        zustand === "laeuft" &&
          el(
            "div",
            {
              class: "fortschritt",
              role: "progressbar",
              "aria-label": "Der Export wird erstellt …",
            },
            el("span", { class: "tm-unbestimmt" }),
          ),
        zustand === "fehler" &&
          el(
            "div",
            { class: "hinweis hinweis--fehler", role: "alert" },
            `Der Export ist fehlgeschlagen. ${fehler} Die Daten sind nicht verändert.`,
          ),
        aktion,
        el(
          "p",
          { class: "klein leise" },
          "Enthält Personendaten: Speichere die Datei sicher und lösche sie, wenn du sie nicht mehr brauchst. Zellen mit = + - oder @ am Anfang bekommen ein Hochkomma (Schutz vor Formeln). 10 Exporte in 10 Minuten sind möglich.",
        ),
        status,
      ].filter(Boolean),
    );
    if (fokus) wurzel.querySelector(".knopf")?.focus();
  }

  async function starte() {
    freigeben();
    abbruch = new window.AbortController();
    stand = holeStatus();
    zustand = "laeuft";
    zeichne(true);
    status.textContent = "Der Export wird erstellt.";
    try {
      const antwort = await fetch(`${pfad}/anmeldungen.csv?status=${stand}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: abbruch.signal,
      });
      if (!antwort.ok) {
        let code;
        try {
          code = (await antwort.json())?.code;
        } catch {
          // Kein JSON: Der Status genügt
        }
        throw new ApiFehler(
          antwort.status,
          code,
          undefined,
          antwort.headers.get("X-Retry-After"),
        );
      }
      const blob = await antwort.blob();
      objektUrl = window.URL.createObjectURL(blob);
      blobGroesse = blob.size;
      zustand = "fertig";
      zeichne(true);
      status.textContent = `Der Export ist bereit: ${dateiname}.`;
    } catch (f) {
      if (f?.name === "AbortError") {
        zustand = "bereit";
        zeichne(true);
        return;
      }
      fehler = fehlertext(
        f instanceof ApiFehler ? f : new ApiFehler(0, "NETZ"),
      );
      zustand = "fehler";
      zeichne(true);
    }
  }

  // Wechselt der Stand, gilt die fertige Datei nicht mehr für ihn: zurück auf «bereit»
  function aktualisiere() {
    if (zustand === "laeuft") return;
    const neu = holeStatus();
    if (neu === stand) return;
    freigeben();
    zustand = "bereit";
    stand = neu;
    zeichne(false);
  }

  // Beim Verlassen der Seite (der Router baut #bereich neu): Abruf beenden, Speicher freigeben
  window.addEventListener("pagehide", () => abbruch?.abort());
  new window.MutationObserver((_, beobachter) => {
    if (wurzel.isConnected) return;
    abbruch?.abort();
    freigeben();
    beobachter.disconnect();
  }).observe(document.getElementById("bereich") ?? document.body, {
    childList: true,
    subtree: true,
  });
  zeichne(false);
  return { wurzel, aktualisiere };
}
