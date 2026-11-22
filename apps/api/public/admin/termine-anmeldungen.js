import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { chip, el, filterGruppe, icon, knopf, neueId } from "./dom.js";
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
  ctx.kopfAktion(
    knopf("Exportieren", {
      art: "haupt",
      symbol: "ablage",
      onclick: () => exportieren(pfad, anlass, status),
    }),
  );

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
    werkzeuge,
    liste,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneFilter();
  zeichneListe();
}

/* ---------- Export als CSV (A19: läuft, bereit, fehlgeschlagen) ---------- */

// Der Browser holt die Datei mit der Sitzung; sie liegt nur im Speicher dieser Seite, bis du sie herunterlädst oder den Dialog schliesst.
function exportieren(pfad, anlass, status) {
  const zurueck = document.activeElement;
  const titelId = neueId("titel");
  const meldungsId = neueId("export");
  let abbruch = null;
  let objektUrl = null;
  const dateiname = `anmeldungen-${
    anlass.titel
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "anlass"
  }.csv`;

  const zone = el("div", { id: meldungsId, role: "status" });
  const knoepfe = el("div", { class: "dialog-knoepfe" });
  const dialog = el(
    "dialog",
    { "aria-labelledby": titelId },
    el("h2", { id: titelId, tabindex: "-1" }, "Anmeldungen exportieren"),
    el(
      "dl",
      { class: "werte" },
      el("div", {}, el("dt", {}, "Format"), el("dd", {}, "CSV")),
      el("div", {}, el("dt", {}, "Anlass"), el("dd", {}, anlass.titel)),
      el("div", {}, el("dt", {}, "Stand"), el("dd", {}, STATUS_TEXT[status])),
    ),
    el(
      "p",
      { class: "hinweis", role: "note" },
      "Der Export enthält Personendaten. Speichere ihn sicher und lösche ihn, wenn du ihn nicht mehr brauchst.",
    ),
    el(
      "p",
      { class: "klein leise" },
      "Die Datei enthält alle Anmeldungen mit diesem Stand, nicht nur die geladenen. Zellen, die mit = + - oder @ beginnen, bekommen ein Hochkomma davor, auch Telefonnummern mit +41: Das schützt vor Formeln in Tabellenprogrammen. Pro Person sind 10 Exporte in 10 Minuten möglich.",
    ),
    zone,
    knoepfe,
  );

  const schliessen = () => dialog.close();
  const zeigeStart = (fehler) => {
    ersetze(
      zone,
      fehler &&
        el(
          "div",
          { class: "hinweis hinweis--fehler", role: "alert" },
          `Der Export ist fehlgeschlagen. ${fehler} Die Daten sind nicht verändert.`,
        ),
    );
    ersetze(
      knoepfe,
      knopf(fehler ? "Schliessen" : "Abbrechen", { onclick: schliessen }),
      knopf(fehler ? "Nochmals versuchen" : "Export erstellen", {
        art: "haupt",
        symbol: fehler ? "aktualisieren" : "ablage",
        onclick: () => starte(),
      }),
    );
    knoepfe.lastChild.focus();
  };
  const zeigeLaeuft = () => {
    ersetze(
      zone,
      el("p", { class: "name" }, "Der Export wird erstellt …"),
      el(
        "div",
        {
          class: "fortschritt",
          role: "progressbar",
          "aria-label": "Der Export wird erstellt …",
        },
        el("span", { class: "tm-unbestimmt" }),
      ),
    );
    ersetze(
      knoepfe,
      knopf("Abbrechen", {
        onclick: () => {
          abbruch?.abort();
        },
      }),
    );
    knoepfe.firstChild.focus();
  };
  const zeigeBereit = (blob) => {
    objektUrl = window.URL.createObjectURL(blob);
    ersetze(
      zone,
      el(
        "div",
        { class: "hinweis hinweis--ok", role: "status" },
        `Bereit: ${dateiname} (${Math.max(1, Math.round(blob.size / 1024))} KB)`,
      ),
    );
    const laden = el(
      "a",
      { class: "knopf knopf--haupt", href: objektUrl, download: dateiname },
      icon("ablage"),
      "Herunterladen",
    );
    ersetze(knoepfe, knopf("Schliessen", { onclick: schliessen }), laden);
    laden.focus();
  };

  async function starte() {
    abbruch = new window.AbortController();
    zeigeLaeuft();
    try {
      const antwort = await fetch(`${pfad}/anmeldungen.csv?status=${status}`, {
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
      zeigeBereit(await antwort.blob());
    } catch (f) {
      if (f?.name === "AbortError") {
        zeigeStart();
        return;
      }
      zeigeStart(
        f instanceof ApiFehler
          ? fehlertext(f)
          : fehlertext(new ApiFehler(0, "NETZ")),
      );
    }
  }

  dialog.addEventListener("close", () => {
    abbruch?.abort();
    if (objektUrl) window.URL.revokeObjectURL(objektUrl);
    dialog.remove();
    if (zurueck?.isConnected) zurueck.focus();
    else document.querySelector("h1")?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  zeigeStart();
}
