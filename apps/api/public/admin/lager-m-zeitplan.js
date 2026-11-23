import { ApiFehler, anfrage } from "./api.js";
import { datumsfeld, zeitfeld } from "./datumsfeld.js";
import {
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  menue,
  seitenblatt,
} from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { zweiStufig } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";
import { feldFehler, symbol } from "./lager-gemeinsam.js";
import {
  API,
  adresse,
  ersetzeKinder,
  fehlerText,
  geschlossenHinweis,
  istKonflikt,
  ladeAufgaben,
  ladeLagerMitRechten,
  rechteVon,
} from "./lager-aufgaben-gemeinsam.js";
import {
  MONATE,
  datumMitTag,
  datumText,
  fehlendeLagertage,
  heute,
  monatsZellen,
  verschiebungErledigt,
  verschiebungSatz,
  zeitplanTage,
} from "./lager-aufgaben-logik.js";

// Modul «Zeitplan» des Lager-Arbeitsbereichs (#670): Lagertage, Meilensteine und Fristen der Aufgaben als Liste und als Monat; Meilensteine ändern und verschieben mit Vorschau (die Fristen der Aufgaben wandern mit), Lagertage und Tagesabschnitte pflegen, Vorschlag des Servers übernehmen. Adresse: #lager/lager/<id>/zeitplan. Die App zeigt den Zeitplan nur; Ändern und Verschieben gibt es nur im Web.

const meldungVon = (f) => (f instanceof ApiFehler ? fehlerText(f) : f.message);

export function zeige(bereich, ctx, lagerId, lager) {
  let erstes = true;
  ctx.lade(
    async () => {
      const l = await ladeLagerMitRechten(lagerId, erstes ? lager : undefined);
      erstes = false;
      const rechte = rechteVon(l);
      if (!rechte.zeitplanLesen) throw new ApiFehler(403);
      const [zeitplan, aufgaben] = await Promise.all([
        anfrage("GET", `${API(lagerId)}/zeitplan`),
        // Die Fristen stehen nur da, wo die Rolle Aufgaben lesen darf
        rechte.lesen ? ladeAufgaben(lagerId).catch(() => []) : [],
      ]);
      return { lager: l, rechte, zeitplan, aufgaben };
    },
    (d) => zeichne(bereich, ctx, lagerId, d),
    { skeleton: () => skeletonFlaeche({ zeilen: 5 }) },
  );
}

function zeichne(bereich, ctx, lagerId, d) {
  const { rechte, lager } = d;
  const Z = {
    zeitplan: d.zeitplan,
    aufgaben: d.aufgaben,
    ansicht: "liste",
    monat: null,
    jetzt: heute(),
  };
  const schreibbar = rechte.zeitplanBearbeiten;

  const ort = el("div", { class: "la-zeitplan" });
  const zeichneAlles = () => {
    ort.replaceChildren(
      Z.ansicht === "monat" ? monatAnsicht() : listeAnsicht(),
      verwaltung(),
    );
  };

  // ---- Kopf ----
  const kopfKnoepfe = [];
  if (schreibbar) {
    kopfKnoepfe.push(
      knopf("Meilenstein hinzufügen", {
        art: "haupt",
        symbol: "plus",
        onclick: () => meilensteinForm(null),
      }),
      knopf("Vorschlag des Servers", { onclick: () => vorschlag() }),
    );
  }
  ctx.kopfAktion(...kopfKnoepfe);

  const ansichten = filterGruppe({
    beschriftung: "Ansicht",
    eintraege: [
      { text: "Liste", wert: "liste" },
      { text: "Monat", wert: "monat" },
    ],
    wert: Z.ansicht,
    beiAenderung: (w) => {
      Z.ansicht = w;
      zeichneAlles();
    },
  });
  const kopfLeiste = el("div", { class: "la-umschalter" }, ansichten.wurzel);

  // Nach einer Änderung holt die Seite den Zeitplan neu: Er ist klein (eine Abfrage) und bleibt so mit den Fristen der Aufgaben in Einklang
  async function auffrischen(meldung) {
    try {
      const [zeitplan, aufgaben] = await Promise.all([
        anfrage("GET", `${API(lagerId)}/zeitplan`),
        rechte.lesen
          ? ladeAufgaben(lagerId).catch(() => Z.aufgaben)
          : Z.aufgaben,
      ]);
      Z.zeitplan = zeitplan;
      Z.aufgaben = aufgaben;
      zeichneAlles();
      if (meldung) ctx.melde(meldung);
    } catch (f) {
      ctx.melde(meldungVon(f), "fehler");
    }
  }

  // ---- Liste ----
  function listeAnsicht() {
    const tage = zeitplanTage(Z.zeitplan, Z.aufgaben, lager, Z.jetzt);
    if (tage.length === 0) {
      return leerKarte(
        "Der Zeitplan ist noch leer.",
        schreibbar
          ? [
              knopf("Meilenstein hinzufügen", {
                art: "haupt",
                symbol: "plus",
                onclick: () => meilensteinForm(null),
              }),
            ]
          : [],
      );
    }
    return el(
      "ol",
      { class: "la-tage", "aria-label": "Tage des Zeitplans" },
      tage.map((t) =>
        el(
          "li",
          {
            class: `la-tag${t.heute ? " la-tag--heute" : ""}${t.vergangen ? " la-tag--vorbei" : ""}${t.imLager ? " la-tag--lager" : ""}`,
          },
          el(
            "div",
            { class: "la-tag-kopf" },
            el("h2", { class: "la-tag-titel" }, datumMitTag(t.datum)),
            t.heute &&
              el("span", { class: "chip chip--ok" }, symbol("haken"), "Heute"),
            t.lagertag &&
              el(
                "span",
                { class: "chip" },
                `Lagertag ${t.lagertag.nummer}${t.lagertag.label ? `: ${t.lagertag.label}` : ""}`,
              ),
            t.lagertag && schreibbar && lagertagMenue(t.lagertag),
          ),
          t.meilensteine.length > 0 &&
            el(
              "ul",
              { class: "la-eintraege" },
              t.meilensteine.map((m) =>
                el(
                  "li",
                  { class: "la-eintrag" },
                  el(
                    "span",
                    { class: "chip chip--stufe" },
                    symbol("termine"),
                    "Meilenstein",
                  ),
                  el("span", { class: "fett" }, m.titel),
                  m.art && el("span", { class: "leise klein" }, m.art),
                  (schreibbar || rechte.verschieben) && meilensteinMenue(m),
                ),
              ),
            ),
          t.fristen.length > 0 &&
            el(
              "ul",
              { class: "la-eintraege" },
              t.fristen.map((a) =>
                el(
                  "li",
                  { class: "la-eintrag" },
                  el("span", { class: "chip" }, symbol("uhr"), "Frist"),
                  el(
                    "a",
                    {
                      class: "lg-verweis",
                      href: adresse(lagerId, "aufgaben", a.id),
                    },
                    a.titel,
                  ),
                  a.verantwortlich &&
                    el(
                      "span",
                      { class: "leise klein" },
                      a.verantwortlich.name ?? a.verantwortlich.ceviName ?? "",
                    ),
                ),
              ),
            ),
        ),
      ),
    );
  }

  // ---- Monat ----
  function monatAnsicht() {
    const start =
      Z.monat ??
      (() => {
        const [j, m] = (lager.von ?? Z.jetzt).split("-").map(Number);
        return { j, m: m - 1 };
      })();
    Z.monat = start;
    const tage = new Map(
      zeitplanTage(Z.zeitplan, Z.aufgaben, lager, Z.jetzt).map((t) => [
        t.datum,
        t,
      ]),
    );
    const zellen = monatsZellen(start.j, start.m);
    const wechsle = (delta) => {
      const neu = new Date(Date.UTC(start.j, start.m + delta, 1));
      Z.monat = { j: neu.getUTCFullYear(), m: neu.getUTCMonth() };
      zeichneAlles();
      ort.querySelector(".la-monat-titel")?.focus();
    };
    const wochen = [];
    for (let i = 0; i < zellen.length; i += 7)
      wochen.push(zellen.slice(i, i + 7));
    return el(
      "section",
      { class: "la-monat", "aria-labelledby": "la-monat-titel" },
      el(
        "div",
        { class: "la-monat-kopf" },
        knopf("Zurück", {
          klein: true,
          symbol: "zurueck",
          onclick: () => wechsle(-1),
          "aria-label": "Vorheriger Monat",
        }),
        el(
          "h2",
          { id: "la-monat-titel", class: "la-monat-titel", tabindex: "-1" },
          `${MONATE[start.m]} ${start.j}`,
        ),
        knopf("Weiter", {
          klein: true,
          symbol: "weiter",
          onclick: () => wechsle(1),
          "aria-label": "Nächster Monat",
        }),
      ),
      el(
        "div",
        {
          class: "tabellenrahmen",
          role: "region",
          "aria-label": "Monatsansicht",
          tabindex: "0",
        },
        el(
          "table",
          { class: "tabelle la-monatstabelle" },
          el(
            "caption",
            { class: "nur-leser" },
            `${MONATE[start.m]} ${start.j}`,
          ),
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((t) =>
                el("th", { scope: "col" }, t),
              ),
            ),
          ),
          el(
            "tbody",
            {},
            wochen.map((w) =>
              el(
                "tr",
                {},
                w.map((tag) => {
                  if (!tag)
                    return el("td", { class: "la-zelle la-zelle--leer" });
                  const t = tage.get(tag);
                  const eintraege = [
                    ...(t?.lagertag ? [`Lagertag ${t.lagertag.nummer}`] : []),
                    ...(t?.meilensteine ?? []).map(
                      (m) => `Meilenstein: ${m.titel}`,
                    ),
                    ...(t?.fristen ?? []).map((a) => `Frist: ${a.titel}`),
                  ];
                  return el(
                    "td",
                    {
                      class: `la-zelle${tag === Z.jetzt ? " la-zelle--heute" : ""}${t?.imLager ? " la-zelle--lager" : ""}`,
                    },
                    el(
                      "span",
                      { class: "la-zelle-tag" },
                      String(Number(tag.slice(8))),
                      tag === Z.jetzt &&
                        el("span", { class: "nur-leser" }, " (heute)"),
                    ),
                    eintraege.length > 0 &&
                      el(
                        "ul",
                        { class: "la-zelle-liste" },
                        eintraege.slice(0, 3).map((e) => el("li", {}, e)),
                        eintraege.length > 3 &&
                          el(
                            "li",
                            { class: "leise" },
                            `+ ${eintraege.length - 3} weitere`,
                          ),
                      ),
                  );
                }),
              ),
            ),
          ),
        ),
      ),
      el(
        "p",
        { class: "leise klein" },
        "Tage im Lager sind hinterlegt. Die Liste zeigt alle Einträge eines Tages ausgeschrieben.",
      ),
    );
  }

  // ---- Meilensteine ----
  function meilensteinMenue(m) {
    return menue(m.titel, [
      schreibbar && { text: "Bearbeiten", onclick: () => meilensteinForm(m) },
      rechte.verschieben && {
        text: "Verschieben",
        onclick: () => verschieben(m),
      },
      schreibbar && {
        text: "Löschen",
        gefaehrlich: true,
        onclick: (e) => {
          const zeileEl = e.currentTarget.closest("li");
          ctx.mitRueckgaengig({
            text: `Meilenstein «${m.titel}» gelöscht`,
            erledigt: "Gelöscht.",
            ansicht: {
              weg: () => (zeileEl.hidden = true),
              zurueck: () => (zeileEl.hidden = false),
            },
            ausfuehren: () =>
              anfrage(
                "DELETE",
                `${API(lagerId)}/zeitplan/meilensteine/${m.id}?version=${m.version}`,
              ),
            danach: () => auffrischen(),
            fehlertext: (f) =>
              istKonflikt(f)
                ? "Jemand hat den Meilenstein inzwischen geändert und er blieb stehen."
                : `Nicht gelöscht. ${fehlerText(f)}`,
            beiFehler: () => auffrischen(),
          });
        },
      },
    ]);
  }
  // Neu (m = null) oder ändern; bei einem Konflikt zeigt die Seite beide Stände und lässt wählen
  function meilensteinForm(m) {
    const titel = feld({
      label: "Titel",
      required: true,
      wert: m?.titel ?? "",
      maxlength: 200,
      autocomplete: "off",
    });
    const art = feld({
      label: "Art",
      wert: m?.art ?? "",
      maxlength: 50,
      autocomplete: "off",
      hilfe: "Freiwillig, zum Beispiel «Anmeldeschluss».",
    });
    const datum = datumsfeld({
      label: "Datum",
      required: true,
      wert: m?.datum ?? "",
      hilfe: m
        ? "Das Datum ändert sich nur über «Verschieben», damit die Fristen der Aufgaben mitwandern."
        : undefined,
    });
    if (m) datum.eingabe.disabled = true;
    const konfliktOrt = el("div", {});
    let version = m?.version;
    let seite;
    seite = dialogFormular({
      titel: m ? "Meilenstein ändern" : "Neuer Meilenstein",
      felder: [
        konfliktOrt,
        titel.wurzel,
        el("div", { class: "lg-zweispaltig" }, datum.wurzel, art.wurzel),
      ],
      ok: "Speichern",
      pruefe: () => {
        if (m || datum.eingabe.value) return false;
        feldFehler(datum, "Wähle ein Datum.");
        return true;
      },
      senden: async () => {
        const werte = {
          titel: titel.eingabe.value.trim(),
          art: art.eingabe.value.trim() || null,
        };
        try {
          return m
            ? await anfrage(
                "PATCH",
                `${API(lagerId)}/zeitplan/meilensteine/${m.id}`,
                { version, ...werte },
              )
            : await anfrage("POST", `${API(lagerId)}/zeitplan/meilensteine`, {
                ...werte,
                datum: datum.eingabe.value,
              });
        } catch (f) {
          if (!istKonflikt(f)) throw f;
          const karte = konfliktKarteMeilenstein(
            f,
            werte,
            (aktuell) => {
              version = aktuell.version;
              konfliktOrt.replaceChildren();
              seite.querySelector("form")?.requestSubmit();
            },
            () => {
              seite.close();
              auffrischen();
            },
          );
          konfliktOrt.replaceChildren(karte);
          karte.focus();
          throw new Error(
            "Jemand hat den Meilenstein inzwischen geändert. Wähle oben, was gilt.",
            { cause: f },
          );
        }
      },
      fehlertext: meldungVon,
      danach: () =>
        auffrischen(
          m
            ? "Der Meilenstein ist gespeichert."
            : "Der Meilenstein ist angelegt.",
        ),
    });
  }
  function konfliktKarteMeilenstein(f, meine, uebernehmen, verwerfen) {
    const aktuell = f.daten?.aktuell ?? {};
    const zeile = (name, du, server) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, name),
        el("td", {}, du ?? "leer"),
        el("td", {}, server ?? "leer"),
      );
    return el(
      "section",
      {
        class: "hinweis hinweis--warn la-konflikt",
        role: "alert",
        tabindex: "-1",
      },
      el("h2", { class: "klein fett" }, "Jemand hat das inzwischen geändert"),
      el(
        "table",
        { class: "tabelle la-konflikttabelle" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", { scope: "col" }, "Feld"),
            el("th", { scope: "col" }, "Du"),
            el("th", { scope: "col" }, "Server"),
          ),
        ),
        el(
          "tbody",
          {},
          zeile("Titel", meine.titel, aktuell.titel),
          zeile("Art", meine.art, aktuell.art),
        ),
      ),
      el(
        "div",
        { class: "reihe" },
        knopf("Meine Änderung übernehmen", {
          art: "haupt",
          onclick: () => uebernehmen(aktuell),
        }),
        knopf("Stand des Servers übernehmen", { onclick: verwerfen }),
      ),
    );
  }

  // Verschieben mit Vorschau: Erst zeigt der Server, welche Aufgaben ihre Frist ändern (nichts wird geschrieben), dann bestätigt die Person
  function verschieben(m) {
    const neues = datumsfeld({
      label: "Neues Datum",
      required: true,
      wert: m.datum,
    });
    const ergebnis = el("div", { class: "la-vorschau", role: "status" });
    const fehler = el("p", {
      class: "hinweis hinweis--fehler",
      role: "alert",
      hidden: true,
    });
    const pruefen = knopf("Vorschau zeigen", { art: "haupt", symbol: "lupe" });
    const bestaetigen = knopf("Verschieben", { art: "haupt", disabled: true });
    let vorschau = null;
    const blatt = seitenblatt({
      titel: "Meilenstein verschieben",
      untertitel: `«${m.titel}», jetzt am ${datumMitTag(m.datum)}`,
      inhalt: [
        el(
          "p",
          { class: "leise" },
          "Die Fristen der Aufgaben, die an diesem Meilenstein hängen, wandern mit. Erst siehst du, was sich ändert.",
        ),
        neues.wurzel,
        el("div", { class: "reihe" }, pruefen),
        fehler,
        ergebnis,
      ],
      fusszeile: [
        knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
        bestaetigen,
      ],
    });
    function zeigeVorschau(v, hinweis) {
      vorschau = v;
      bestaetigen.disabled = false;
      ersetzeKinder(
        ergebnis,
        hinweis && el("p", { class: "hinweis hinweis--warn" }, hinweis),
        el(
          "h3",
          { class: "klein fett" },
          `${datumMitTag(v.meilenstein.datumAlt)} wird ${datumMitTag(v.meilenstein.datumNeu)}`,
        ),
        el("p", {}, verschiebungSatz(v.aufgaben.length)),
        v.aufgaben.length > 0 &&
          el(
            "table",
            { class: "tabelle" },
            el("caption", { class: "nur-leser" }, "Betroffene Aufgaben"),
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                ["Aufgabe", "Frist jetzt", "Neue Frist"].map((t) =>
                  el("th", { scope: "col" }, t),
                ),
              ),
            ),
            el(
              "tbody",
              {},
              v.aufgaben.map((a) =>
                el(
                  "tr",
                  {},
                  el("th", { scope: "row" }, a.titel),
                  el("td", {}, datumText(a.fristAlt)),
                  el("td", {}, datumText(a.fristNeu)),
                ),
              ),
            ),
          ),
      );
    }
    pruefen.addEventListener("click", async () => {
      fehler.hidden = true;
      bestaetigen.disabled = true;
      if (!neues.eingabe.value) return feldFehler(neues, "Wähle ein Datum.");
      pruefen.disabled = true;
      try {
        zeigeVorschau(
          await anfrage(
            "POST",
            `${API(lagerId)}/zeitplan/meilensteine/${m.id}/verschieben`,
            { trocken: true, datum: neues.eingabe.value, version: m.version },
          ),
        );
      } catch (f) {
        ergebnis.replaceChildren();
        fehler.textContent = meldungVon(f);
        fehler.hidden = false;
      } finally {
        pruefen.disabled = false;
      }
    });
    neues.eingabe.addEventListener("change", () => {
      bestaetigen.disabled = true;
      vorschau = null;
    });
    bestaetigen.addEventListener("click", async () => {
      if (!vorschau) return;
      bestaetigen.disabled = true;
      try {
        const r = await anfrage(
          "POST",
          `${API(lagerId)}/zeitplan/meilensteine/${m.id}/verschieben`,
          {
            trocken: false,
            datum: vorschau.meilenstein.datumNeu,
            version: vorschau.meilenstein.version,
            aufgaben: vorschau.aufgaben.map((a) => ({
              id: a.id,
              version: a.version,
            })),
          },
        );
        blatt.close();
        auffrischen(
          `«${m.titel}» ist verschoben. ${verschiebungErledigt(r.aufgaben.length)}`,
        );
      } catch (f) {
        if (f.code === "VORSCHAU_VERALTET" && f.daten?.vorschau) {
          zeigeVorschau(
            f.daten.vorschau,
            "Die Aufgaben am Meilenstein haben sich inzwischen geändert. Prüfe die neue Vorschau und bestätige nochmals.",
          );
        } else if (istKonflikt(f)) {
          fehler.textContent =
            "Jemand hat den Meilenstein inzwischen geändert. Schliesse diese Seite, lade den Zeitplan neu und versuche es nochmals.";
          fehler.hidden = false;
        } else {
          fehler.textContent = meldungVon(f);
          fehler.hidden = false;
          bestaetigen.disabled = false;
        }
      }
    });
  }

  // ---- Lagertage und Tagesabschnitte ----
  function lagertagMenue(t) {
    return menue(`Lagertag ${datumText(t.datum)}`, [
      { text: "Bezeichnung ändern", onclick: () => lagertagForm(t) },
      {
        text: "Löschen",
        gefaehrlich: true,
        onclick: () =>
          ctx.mitRueckgaengig({
            text: `Lagertag ${datumText(t.datum)} gelöscht`,
            erledigt: "Gelöscht.",
            ausfuehren: () =>
              anfrage(
                "DELETE",
                `${API(lagerId)}/zeitplan/lagertage/${t.id}?version=${t.version}`,
              ),
            danach: () => auffrischen(),
            fehlertext: (f) => `Nicht gelöscht. ${fehlerText(f)}`,
            beiFehler: () => auffrischen(),
          }),
      },
    ]);
  }
  function lagertagForm(t) {
    const label = feld({
      label: "Bezeichnung",
      wert: t?.label ?? "",
      maxlength: 100,
      autocomplete: "off",
      hilfe: "Freiwillig, zum Beispiel «Anreise».",
    });
    const datum = datumsfeld({
      label: "Datum",
      required: true,
      wert: t?.datum ?? "",
      min: lager.von,
      max: lager.bis,
    });
    if (t) datum.eingabe.disabled = true;
    dialogFormular({
      titel: t ? "Lagertag ändern" : "Lagertag hinzufügen",
      felder: [datum.wurzel, label.wurzel],
      ok: "Speichern",
      pruefe: () => {
        if (t || datum.eingabe.value) return false;
        feldFehler(datum, "Wähle ein Datum.");
        return true;
      },
      senden: () =>
        t
          ? anfrage("PATCH", `${API(lagerId)}/zeitplan/lagertage/${t.id}`, {
              version: t.version,
              label: label.eingabe.value.trim() || null,
            })
          : anfrage("POST", `${API(lagerId)}/zeitplan/lagertage`, {
              datum: datum.eingabe.value,
              ...(label.eingabe.value.trim()
                ? { label: label.eingabe.value.trim() }
                : {}),
            }),
      fehlertext: (f) =>
        istKonflikt(f)
          ? "Jemand hat diesen Tag inzwischen geändert. Schliesse die Seite und lade den Zeitplan neu."
          : meldungVon(f),
      danach: () => auffrischen("Der Lagertag ist gespeichert."),
    });
  }
  function abschnittForm(a) {
    const name = feld({
      label: "Name",
      required: true,
      wert: a?.name ?? "",
      maxlength: 50,
      autocomplete: "off",
    });
    const zeit = zeitfeld({
      label: "Beginn",
      wert: a?.zeit ?? "",
      hilfe: "Freiwillig.",
    });
    dialogFormular({
      titel: a ? "Tagesabschnitt ändern" : "Tagesabschnitt hinzufügen",
      felder: [name.wurzel, zeit.wurzel],
      ok: "Speichern",
      senden: () => {
        const werte = {
          name: name.eingabe.value.trim(),
          zeit: zeit.eingabe.value || null,
        };
        return a
          ? anfrage(
              "PATCH",
              `${API(lagerId)}/zeitplan/tagesabschnitte/${a.id}`,
              { version: a.version, ...werte },
            )
          : anfrage("POST", `${API(lagerId)}/zeitplan/tagesabschnitte`, werte);
      },
      fehlertext: (f) =>
        istKonflikt(f)
          ? "Jemand hat den Abschnitt inzwischen geändert. Schliesse die Seite und lade den Zeitplan neu."
          : meldungVon(f),
      danach: () => auffrischen("Der Tagesabschnitt ist gespeichert."),
    });
  }

  function verwaltung() {
    const abschnitte = Z.zeitplan.tagesabschnitte;
    const fehlend = fehlendeLagertage(lager, Z.zeitplan.lagertage);
    const abschnittKarte = el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-abschnitte" },
      el("h2", { id: "la-h-abschnitte" }, "Tagesabschnitte"),
      el(
        "p",
        { class: "leise" },
        "Wie der Tag eingeteilt ist, zum Beispiel für Anwesenheit und Schichtplan.",
      ),
      abschnitte.length === 0
        ? el("p", { class: "leise" }, "Noch keine Abschnitte.")
        : schreibbar
          ? sortierListe({
              beschriftung: "Tagesabschnitte",
              eintraege: abschnitte.map((a) => ({
                id: a.id,
                text: a.name,
                inhalt: el(
                  "div",
                  { class: "la-reihe" },
                  el("span", { class: "la-reihe-titel" }, a.name),
                  a.zeit &&
                    el("span", { class: "leise klein" }, `ab ${a.zeit}`),
                  knopf("Ändern", {
                    klein: true,
                    kontext: a.name,
                    onclick: () => abschnittForm(a),
                  }),
                  (() => {
                    const k = knopf("Löschen", {
                      klein: true,
                      art: "gefahr",
                      kontext: a.name,
                    });
                    zweiStufig(k, {
                      frage: "Wirklich löschen?",
                      ausfuehren: async () => {
                        try {
                          await anfrage(
                            "DELETE",
                            `${API(lagerId)}/zeitplan/tagesabschnitte/${a.id}?version=${a.version}`,
                          );
                          auffrischen(`«${a.name}» ist gelöscht.`);
                        } catch (f) {
                          ctx.melde(
                            `Nicht gelöscht. ${meldungVon(f)}`,
                            "fehler",
                          );
                        }
                      },
                    });
                    return k;
                  })(),
                ),
              })),
              mitRueckgaengig: ctx.mitRueckgaengig,
              aktionstext: "Reihenfolge der Abschnitte geändert",
              beiNeu: async (ids) => {
                try {
                  for (const [stelle, id] of ids.entries()) {
                    const a = abschnitte.find((x) => x.id === id);
                    if (a && a.reihenfolge !== stelle) {
                      await anfrage(
                        "PATCH",
                        `${API(lagerId)}/zeitplan/tagesabschnitte/${a.id}`,
                        { version: a.version, reihenfolge: stelle },
                      );
                    }
                  }
                  await auffrischen();
                } catch (f) {
                  await auffrischen();
                  throw new Error(
                    istKonflikt(f)
                      ? "Jemand hat die Abschnitte inzwischen geändert. Du siehst jetzt den Stand des Servers."
                      : meldungVon(f),
                    { cause: f },
                  );
                }
              },
            }).wurzel
          : el(
              "ul",
              { class: "la-liste" },
              abschnitte.map((a) =>
                el(
                  "li",
                  {},
                  a.name,
                  a.zeit &&
                    el("span", { class: "leise klein" }, ` · ab ${a.zeit}`),
                ),
              ),
            ),
      schreibbar &&
        knopf("Abschnitt hinzufügen", {
          symbol: "plus",
          klein: true,
          onclick: () => abschnittForm(null),
        }),
    );
    const tageKarte = el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-lagertage" },
      el("h2", { id: "la-h-lagertage" }, "Lagertage"),
      el(
        "p",
        { class: "leise" },
        `${Z.zeitplan.lagertage.length} von ${fehlend.length + Z.zeitplan.lagertage.length} Tagen des Lagers (${datumText(lager.von)} bis ${datumText(lager.bis)}) sind angelegt.`,
      ),
      schreibbar &&
        knopf("Lagertag hinzufügen", {
          symbol: "plus",
          klein: true,
          onclick: () => lagertagForm(null),
        }),
    );
    return el("div", { class: "la-verwaltung" }, tageKarte, abschnittKarte);
  }

  // Der Vorschlag des Servers: fehlende Lagertage und Standard-Abschnitte; die Lagerleitung bestätigt, der Server legt erst dann an
  async function vorschlag() {
    let v;
    try {
      v = await anfrage("GET", `${API(lagerId)}/zeitplan/vorschlag`);
    } catch (f) {
      ctx.melde(meldungVon(f), "fehler");
      return;
    }
    if (v.lagertage.length === 0 && v.tagesabschnitte.length === 0) {
      ctx.melde("Es fehlt nichts: Alle Tage und Abschnitte sind angelegt.");
      return;
    }
    const fehler = el("p", {
      class: "hinweis hinweis--fehler",
      role: "alert",
      hidden: true,
    });
    const ok = knopf("Übernehmen", { art: "haupt" });
    const blatt = seitenblatt({
      titel: "Vorschlag des Servers",
      untertitel:
        "Das fehlt im Zeitplan. Es wird erst angelegt, wenn du bestätigst.",
      inhalt: [
        v.lagertage.length > 0 &&
          el(
            "section",
            {},
            el(
              "h3",
              { class: "klein fett" },
              `${v.lagertage.length} Lagertage`,
            ),
            el(
              "p",
              {},
              `${datumText(v.lagertage[0].datum)} bis ${datumText(v.lagertage.at(-1).datum)}`,
            ),
          ),
        v.tagesabschnitte.length > 0 &&
          el(
            "section",
            {},
            el("h3", { class: "klein fett" }, "Tagesabschnitte"),
            el("p", {}, v.tagesabschnitte.map((a) => a.name).join(", ")),
          ),
        fehler,
      ],
      fusszeile: [
        knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
        ok,
      ],
    });
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      try {
        await anfrage("POST", `${API(lagerId)}/zeitplan/uebernehmen`, {
          ...(v.lagertage.length ? { lagertage: v.lagertage } : {}),
          ...(v.tagesabschnitte.length
            ? {
                tagesabschnitte: v.tagesabschnitte.map(
                  ({ name, zeit, reihenfolge }) => ({
                    name,
                    zeit,
                    reihenfolge,
                  }),
                ),
              }
            : {}),
        });
        blatt.close();
        auffrischen("Der Vorschlag ist übernommen.");
      } catch (f) {
        fehler.textContent = meldungVon(f);
        fehler.hidden = false;
        ok.disabled = false;
      }
    });
  }

  bereich.append(
    ...[rechte.zu && geschlossenHinweis(), kopfLeiste, ort].filter(Boolean),
  );
  zeichneAlles();
}
