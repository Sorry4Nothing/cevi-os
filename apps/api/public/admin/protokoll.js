import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { datumsfeld } from "./datumsfeld.js";
import { auswahl, el, feld, filterGruppe, icon, knopf, neueId } from "./dom.js";
import { kachel, prozent, zahl } from "./system.js";
import { rangBalken, saeulen, wertetabelle } from "./uebersicht-diagramme.js";
import { zeichneZeitleiste, zeigeDetail } from "./protokoll-liste.js";
import { ARTEN } from "./protokoll-text.js";

// Protokoll (#637), nur für den Entwickler: alles, was in Cevi OS geschrieben oder geändert wird, mit Benutzerstempel. Die Seite zeigt, was GET /api/v1/admin/protokoll liefert; ob jemand sie sehen darf, entscheidet der Server (403). Kein Polling: Neue Einträge holt «Aktualisieren». Die Aufbewahrung ist begrenzt (Vorgabe 90 Tage).
// Vorlagen von Kokonut UI Pro: «Filter Toolbar» (Suche, Filter als Sätze in Chips, Trefferzahl), «Activity Feed» und «Event Timeline» (Zeitleiste), «Date Range Picker» (zwei Datumsfelder), «Version History» (Detail mit allen Angaben). Eigenes HTML und CSS.

const SEITE = 50;
const BASIS = "/api/v1/admin/protokoll";
const LEER = {
  von: "",
  bis: "",
  benutzer: "",
  q: "",
  bereich: "",
  art: "",
  ergebnis: "",
  objekt: "",
  anfrage: "",
};
const ART_OPTIONEN = [
  ["", "Alle Arten"],
  ...Object.entries(ARTEN).map(([w, [text]]) => [w, text]),
];
const ERGEBNIS_OPTIONEN = [
  ["", "Alle Ergebnisse"],
  ["erfolg", "Erfolgreich"],
  ["fehler", "Fehlgeschlagen"],
];
// Wie die Chips der gesetzten Filter lesen: «Ergebnis ist Fehlgeschlagen»
const FILTER_NAMEN = {
  von: "Ab",
  bis: "Bis",
  benutzer: "Benutzer",
  q: "Aktion enthält",
  bereich: "Bereich",
  art: "Art",
  ergebnis: "Ergebnis",
  objekt: "Objekt",
  anfrage: "Anfrage",
};

function abfrage(filter, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filter, ...extra })) {
    if (v !== "" && v !== undefined && v !== null) p.set(k, String(v));
  }
  const text = p.toString();
  return text ? `?${text}` : "";
}

const datumDe = (tag) =>
  `${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;
const tageZwischen = (von, bis) =>
  (Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) /
  86_400_000;

// Beschriftung einer Säule: «14 Uhr» je Stunde, «Mo 23.11.» je Tag
function saeulenName(start, einheit) {
  const [tag, uhr] = start.split("T");
  const d = new Date(`${tag}T12:00:00Z`);
  const wt = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getUTCDay()];
  const datum = `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
  return einheit === "stunde"
    ? `${wt} ${datum}, ${uhr.slice(0, 2)} Uhr`
    : `${wt} ${datum}`;
}

export function zeige(bereich, ctx) {
  const filter = { ...LEER };
  let einheit = "tag";
  let eintraege = [];
  let naechste = null;
  let lauf = 0;

  const verlaufFeld = el("div", { class: "pl-verlauf" });
  const kacheln = el("div", { class: "pl-kacheln" });
  const chips = el("ul", {
    class: "pl-chips",
    "aria-label": "Gesetzte Filter",
  });
  const treffer = el("p", { class: "klein leise", role: "status" });
  const fehlerFeld = el("p", { class: "meta fehlerzeile", role: "status" });
  const listeFeld = el("div", { class: "pl-listenfeld" });
  const mehrFeld = el("div", { class: "pl-mehr" });
  const stand = el("p", { class: "meta stand" });

  // ---- Werkzeugleiste ----
  const von = datumsfeld({ label: "Von" });
  const bis = datumsfeld({ label: "Bis" });
  const benutzer = feld({
    label: "Benutzer",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "Name oder Kennung",
  });
  const aktion = feld({
    label: "Aktion",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "z. B. personen oder 403",
  });
  const bereichWahl = {
    aktuell: auswahl({
      label: "Bereich",
      optionen: [["", "Alle Bereiche"]],
      wert: "",
    }),
  };
  const artWahl = auswahl({ label: "Art", optionen: ART_OPTIONEN, wert: "" });
  const ergebnisWahl = auswahl({
    label: "Ergebnis",
    optionen: ERGEBNIS_OPTIONEN,
    wert: "",
  });
  const werkzeuge = el("div", { class: "pl-werkzeuge" });
  const zurueck = knopf("Zurücksetzen", {
    art: "still",
    klein: true,
    symbol: "schliessen",
    onclick: () => {
      Object.assign(filter, LEER);
      zeigeFilterInFeldern();
      neuLaden();
    },
  });

  let bekannteBereiche = [];
  function baueBereichWahl() {
    const optionen = [
      ["", "Alle Bereiche"],
      ...bekannteBereiche.map((b) => [b, b]),
    ];
    if (filter.bereich && !bekannteBereiche.includes(filter.bereich)) {
      optionen.push([filter.bereich, filter.bereich]);
    }
    const neu = auswahl({
      label: "Bereich",
      optionen,
      wert: filter.bereich,
    });
    neu.eingabe.addEventListener("change", () => {
      filter.bereich = neu.eingabe.value;
      neuLaden();
    });
    bereichWahl.aktuell.wurzel.replaceWith(neu.wurzel);
    bereichWahl.aktuell = neu;
  }

  function zeigeFilterInFeldern() {
    von.eingabe.value = filter.von;
    bis.eingabe.value = filter.bis;
    benutzer.eingabe.value = /^[0-9a-f-]{36}$/i.test(filter.benutzer)
      ? ""
      : filter.benutzer;
    aktion.eingabe.value = filter.q;
    artWahl.eingabe.value = filter.art;
    artWahl.eingabe.dispatchEvent(new Event("change"));
    ergebnisWahl.eingabe.value = filter.ergebnis;
    ergebnisWahl.eingabe.dispatchEvent(new Event("change"));
    baueBereichWahl();
  }

  // Text mit Verzögerung, damit nicht jeder Buchstabe eine Abfrage auslöst
  let warten;
  const verzoegert = (fn) => {
    window.clearTimeout(warten);
    warten = window.setTimeout(fn, 350);
  };
  von.eingabe.addEventListener("change", () => {
    filter.von = von.eingabe.value;
    neuLaden();
  });
  bis.eingabe.addEventListener("change", () => {
    filter.bis = bis.eingabe.value;
    neuLaden();
  });
  benutzer.eingabe.addEventListener("input", () =>
    verzoegert(() => {
      filter.benutzer = benutzer.eingabe.value.trim();
      neuLaden();
    }),
  );
  aktion.eingabe.addEventListener("input", () =>
    verzoegert(() => {
      filter.q = aktion.eingabe.value.trim();
      neuLaden();
    }),
  );
  artWahl.eingabe.addEventListener("change", () => {
    if (filter.art === artWahl.eingabe.value) return;
    filter.art = artWahl.eingabe.value;
    neuLaden();
  });
  ergebnisWahl.eingabe.addEventListener("change", () => {
    if (filter.ergebnis === ergebnisWahl.eingabe.value) return;
    filter.ergebnis = ergebnisWahl.eingabe.value;
    neuLaden();
  });

  werkzeuge.append(
    el(
      "div",
      { class: "pl-zeile-felder" },
      von.wurzel,
      bis.wurzel,
      benutzer.wurzel,
      aktion.wurzel,
    ),
    el(
      "div",
      { class: "pl-zeile-felder" },
      bereichWahl.aktuell.wurzel,
      artWahl.wurzel,
      ergebnisWahl.wurzel,
    ),
  );

  function zeichneChips() {
    const gesetzt = Object.entries(filter).filter(([, v]) => v !== "");
    chips.replaceChildren(
      ...gesetzt.map(([k, v]) => {
        const text =
          k === "ergebnis"
            ? v === "erfolg"
              ? "Erfolgreich"
              : "Fehlgeschlagen"
            : k === "art"
              ? (ARTEN[v]?.[0] ?? v)
              : /^[0-9a-f-]{36}$/i.test(v)
                ? `${v.slice(0, 8)} …`
                : v;
        return el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "filter-chip",
              "aria-label": `Filter entfernen: ${FILTER_NAMEN[k]} ${text}`,
              onclick: () => {
                filter[k] = "";
                zeigeFilterInFeldern();
                neuLaden();
              },
            },
            el("span", {}, `${FILTER_NAMEN[k]}: ${text}`),
            icon("schliessen"),
          ),
        );
      }),
    );
    chips.hidden = gesetzt.length === 0;
    zurueck.hidden = gesetzt.length === 0;
  }

  // Vom Detail aus: Filter setzen und zur Liste
  function filterVonDetail(teil) {
    Object.assign(filter, LEER, teil);
    zeigeFilterInFeldern();
    document.querySelector(".fluss-seite")?.close?.();
    neuLaden();
  }
  const oeffneDetail = (e, ausloeser) => {
    const blatt = zeigeDetail(e, (teil) => {
      blatt.close();
      filterVonDetail(teil);
    });
    blatt.addEventListener(
      "close",
      () => ausloeser?.isConnected && ausloeser.focus(),
    );
  };

  // ---- Daten ----
  async function holeListe(nach) {
    return anfrage("GET", `${BASIS}${abfrage(filter, { limit: SEITE, nach })}`);
  }
  async function holeVerlauf() {
    const lang =
      filter.von && filter.bis && tageZwischen(filter.von, filter.bis) >= 7;
    const e = lang ? "tag" : einheit;
    return anfrage(
      "GET",
      `${BASIS}/verlauf${abfrage(filter, { einheit: e })}`,
    ).then((d) => ({ ...d, einheit: e }));
  }

  function zeichneKacheln(v) {
    const quote = v.summe.gesamt > 0 ? v.summe.fehler / v.summe.gesamt : 0;
    kacheln.replaceChildren(
      kachel({
        titel: "Einträge im Zeitraum",
        wert: zahl(v.summe.gesamt),
        hinweis: `${datumDe(v.von)} bis ${datumDe(v.bis)}`,
      }),
      kachel({
        titel: "Fehlgeschlagen",
        wert: zahl(v.summe.fehler),
        hinweis: `${prozent(quote)} der Einträge`,
        status: v.summe.fehler === 0 ? "ok" : quote > 0.2 ? "fehler" : "warn",
        zustand:
          v.summe.fehler === 0 ? "Keine" : quote > 0.2 ? "Viele" : "Einzelne",
      }),
      kachel({
        titel: "Bereiche",
        wert: zahl(v.bereiche.length),
        hinweis: v.bereiche[0]
          ? `Am meisten: ${v.bereiche[0].bereich}`
          : "Keine Aktivität",
      }),
    );
  }

  function zeichneVerlauf(v) {
    bekannteBereiche = [
      ...new Set([...bekannteBereiche, ...v.bereiche.map((b) => b.bereich)]),
    ].sort();
    const punkte = v.punkte.map((p) => ({
      name: saeulenName(p.start, v.einheit),
      wert: p.gesamt,
      fehler: p.fehler,
    }));
    const umschalter = filterGruppe({
      beschriftung: "Auflösung der Säulen",
      eintraege: [
        { text: "Je Tag", wert: "tag" },
        { text: "Je Stunde", wert: "stunde" },
      ],
      wert: v.einheit,
      beiAenderung: async (wert) => {
        einheit = wert;
        await neuLaden({ nurVerlauf: true });
        verlaufFeld
          .querySelector('.filter button[aria-pressed="true"]')
          ?.focus();
      },
    });
    const grafik =
      v.summe.gesamt === 0
        ? el(
            "p",
            { class: "leer leer--klein" },
            "In diesem Zeitraum gibt es keine Einträge.",
          )
        : saeulen({
            punkte,
            titel: "Einträge im Protokoll",
            einheit: "Einträge",
            fehlerName: "fehlgeschlagen",
            hoehe: 80,
            weit: true,
          });
    verlaufFeld.replaceChildren(
      el(
        "div",
        { class: "pl-verlauf-kopf" },
        el("h2", {}, "Aktivität"),
        umschalter.wurzel,
      ),
      grafik,
      el(
        "p",
        { class: "klein leise pl-legende" },
        el("span", { class: "pl-punkt" }),
        " Erfolgreich ",
        el("span", { class: "pl-punkt pl-punkt--fehler" }),
        " Fehlgeschlagen",
      ),
      v.bereiche.length > 0 &&
        el(
          "details",
          { class: "pl-tabelle" },
          el("summary", {}, "Bereiche und Zahlen als Tabelle"),
          rangBalken({
            zeilen: v.bereiche.slice(0, 8).map((b) => ({
              name: b.bereich,
              wert: b.gesamt,
            })),
            einheit: "Einträge",
          }),
          wertetabelle({
            beschriftung: "Einträge je Zeitraum",
            spalten: ["Zeitraum", "Einträge", "Fehlgeschlagen"],
            zeilen: punkte.map((p) => [p.name, zahl(p.wert), zahl(p.fehler)]),
          }),
        ),
    );
  }

  function zeichneListe() {
    if (eintraege.length === 0) {
      listeFeld.replaceChildren(
        el(
          "div",
          { class: "zustand", role: "status" },
          el(
            "p",
            { class: "zustand-satz" },
            Object.values(filter).some((v) => v !== "")
              ? "Kein Eintrag passt zu diesen Filtern."
              : "Das Protokoll ist noch leer. Eintragungen entstehen mit der nächsten Aktion.",
          ),
          Object.values(filter).some((v) => v !== "") &&
            el(
              "div",
              { class: "reihe" },
              knopf("Filter zurücksetzen", { onclick: () => zurueck.click() }),
            ),
        ),
      );
    } else {
      listeFeld.replaceChildren(zeichneZeitleiste(eintraege, oeffneDetail));
    }
    treffer.textContent =
      eintraege.length === 0
        ? ""
        : `${zahl(eintraege.length)} Einträge geladen${naechste ? ", weitere vorhanden" : ""}`;
    mehrFeld.replaceChildren(
      ...(naechste
        ? [knopf("Mehr laden", { symbol: "runter", onclick: () => ladeMehr() })]
        : []),
    );
    zeichneChips();
  }

  async function ladeMehr() {
    const meine = lauf;
    const k = mehrFeld.querySelector("button");
    if (k) {
      k.disabled = true;
      k.textContent = "Lädt …";
    }
    try {
      const d = await holeListe(naechste);
      if (meine !== lauf) return;
      eintraege = [...eintraege, ...d.eintraege];
      naechste = d.naechste;
      zeichneListe();
      fehlerFeld.textContent = "";
    } catch (f) {
      fehlerFeld.textContent = `Mehr laden nicht möglich: ${fehlertext(f)}`;
      zeichneListe();
    }
  }

  // Lädt Liste und Verlauf neu (nach einem Filter oder «Aktualisieren»); der alte Stand bleibt stehen, bis der neue da ist
  async function neuLaden({ nurVerlauf = false } = {}) {
    const meine = ++lauf;
    listeFeld.setAttribute("aria-busy", "true");
    try {
      const [d, v] = await Promise.all([
        nurVerlauf ? null : holeListe(),
        holeVerlauf(),
      ]);
      if (meine !== lauf) return;
      if (d) {
        eintraege = d.eintraege;
        naechste = d.naechste;
      }
      zeichneKacheln(v);
      zeichneVerlauf(v);
      zeichneListe();
      if (!nurVerlauf) baueBereichWahl();
      stand.textContent = `Stand ${new Intl.DateTimeFormat("de-CH", { timeStyle: "medium", timeZone: "Europe/Zurich" }).format(new Date())}. Neue Einträge holst du mit «Aktualisieren».`;
      fehlerFeld.textContent = "";
    } catch (f) {
      if (meine !== lauf) return;
      fehlerFeld.textContent = `Aktualisieren nicht möglich: ${fehlertext(f)}`;
    } finally {
      if (meine === lauf) listeFeld.removeAttribute("aria-busy");
    }
  }

  // ---- CSV ----
  const exportFeld = el("div", { class: "pl-export" });
  let blobUrl = null;
  function zeichneExport(zustand = "bereit", info = "") {
    const knoten = [];
    if (zustand === "fertig") {
      knoten.push(
        el(
          "a",
          {
            class: "knopf knopf--haupt",
            href: blobUrl,
            download: "protokoll.csv",
          },
          icon("ablage"),
          "protokoll.csv herunterladen",
        ),
      );
    } else {
      knoten.push(
        knopf(
          zustand === "laeuft" ? "Wird erstellt …" : "Als CSV exportieren",
          {
            symbol: "ablage",
            art: "still",
            disabled: zustand === "laeuft",
            onclick: starteExport,
          },
        ),
      );
    }
    knoten.push(
      el(
        "p",
        { class: "klein leise", role: "status" },
        info ||
          "Höchstens 5000 Einträge des gefilterten Ausschnitts, ohne Namen und Herkunft. Der Export steht selbst im Protokoll.",
      ),
    );
    exportFeld.replaceChildren(...knoten);
  }
  async function starteExport() {
    if (blobUrl) window.URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    zeichneExport("laeuft");
    try {
      const antwort = await fetch(
        `${BASIS}/export.csv${abfrage(filter, { limit: undefined, nach: undefined })}`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!antwort.ok) {
        let code;
        try {
          code = (await antwort.json())?.code;
        } catch {
          // Kein JSON: Der Status genügt
        }
        throw new ApiFehler(antwort.status, code);
      }
      const blob = await antwort.blob();
      blobUrl = window.URL.createObjectURL(blob);
      zeichneExport("fertig", "Der Export ist bereit.");
    } catch (f) {
      zeichneExport(
        "bereit",
        `Export nicht möglich: ${fehlertext(f instanceof ApiFehler ? f : new ApiFehler(0, "NETZ"))}`,
      );
    }
  }

  // ---- Aufbau ----
  const sektionListeId = neueId("pl-liste");
  const seite = el(
    "div",
    { class: "pl-seite" },
    el(
      "p",
      { class: "beschreibung pl-erklaerung" },
      "Alles, was in Cevi OS geschrieben oder geändert wird, mit Person, Funktion, Zeit und Ergebnis. Nur du als Entwickler siehst diese Seite. Inhalte, Passwörter und Namen von Kindern werden nie gespeichert; die Einträge werden nach der Aufbewahrungsfrist gelöscht.",
    ),
    el("div", { class: "stand-zeile" }, stand, fehlerFeld),
    kacheln,
    el(
      "section",
      { class: "flaeche pl-flaeche", "aria-label": "Aktivität" },
      verlaufFeld,
    ),
    el(
      "section",
      { class: "pl-liste-bereich", "aria-labelledby": sektionListeId },
      el("h2", { id: sektionListeId }, "Verlauf"),
      el(
        "div",
        { class: "pl-leiste-kopf" },
        werkzeuge,
        el("div", { class: "pl-gesetzt" }, chips, zurueck),
        treffer,
      ),
      listeFeld,
      mehrFeld,
      exportFeld,
    ),
  );

  function zeichneAlles([d, v]) {
    eintraege = d.eintraege;
    naechste = d.naechste;
    bekannteBereiche = [...new Set(v.bereiche.map((b) => b.bereich))].sort();
    zeichneKacheln(v);
    zeichneVerlauf(v);
    zeichneListe();
    baueBereichWahl();
    zeichneExport();
    stand.textContent = `Stand ${new Intl.DateTimeFormat("de-CH", { timeStyle: "medium", timeZone: "Europe/Zurich" }).format(new Date())}. Neue Einträge holst du mit «Aktualisieren».`;
    bereich.append(seite);
  }

  ctx.kopfAktion(
    knopf("Aktualisieren", {
      symbol: "aktualisieren",
      onclick: async () => {
        await neuLaden();
        if (!fehlerFeld.textContent) ctx.melde("Protokoll aktualisiert.");
      },
    }),
  );
  ctx.lade(() => Promise.all([holeListe(), holeVerlauf()]), zeichneAlles, {
    skeleton: "liste",
  });
}
