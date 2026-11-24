import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { datumsfeld } from "./datumsfeld.js";
import { auswahl, el, feld, filterGruppe, icon, knopf, neueId } from "./dom.js";
import { kachel, zahl } from "./system.js";
import { saeulen, wertetabelle } from "./uebersicht-diagramme.js";
import { zeichneZeitleiste, zeigeDetail } from "./protokoll-liste.js";
import { GRUPPEN, GRUPPEN_OPTIONEN, bereichText } from "./protokoll-text.js";

// Änderungsprotokoll (#637, #662), nur für den Entwickler: Wer hat wann was geändert? Die Seite zeigt, was GET /api/v1/admin/protokoll liefert; ob jemand sie sehen darf, entscheidet der Server (403). Zwei Reiter: «Änderungen» (Vorgabe) und «Sicherheit» (fehlgeschlagene Anmeldungen, Begrenzung). Kein Polling: Neue Einträge holt «Aktualisieren». Die Aufbewahrung ist begrenzt (Vorgabe 90 Tage).
// Vorlagen von Kokonut UI Pro: «Filter Toolbar» (Suche, Filter als Sätze in Chips, Trefferzahl), «Activity Feed» und «Event Timeline» (Zeitleiste), «Date Range Picker» (zwei Datumsfelder), «Version History» (Detail mit allen Angaben). Eigenes HTML und CSS.

const SEITE = 50;
const BASIS = "/api/v1/admin/protokoll";
const LEER = {
  von: "",
  bis: "",
  benutzer: "",
  q: "",
  bereich: "",
  gruppe: "",
  objekt: "",
  anfrage: "",
};
// Wie die Chips der gesetzten Filter lesen: «Aktion: Gelöscht»
const FILTER_NAMEN = {
  von: "Ab",
  bis: "Bis",
  benutzer: "Person",
  q: "Suche",
  bereich: "Bereich",
  gruppe: "Aktion",
  objekt: "Objekt",
  anfrage: "Anfrage",
};
const ERKLAERUNG = {
  aenderungen:
    "Hier steht, was geändert wurde: von wem, wann und was. Klicks, Ansichten, abgelehnte Anfragen und Alltagseingaben wie Haken oder Chat stehen nicht darin; Fehlanmeldungen findest du im Reiter «Sicherheit». Inhalte, Passwörter und Namen von Kindern werden nie gespeichert.",
  sicherheit:
    "Das sind keine Änderungen, sondern Hinweise auf mögliche Angriffe: fehlgeschlagene Anmeldungen, falsche Codes beim zweiten Faktor und gesperrte Anfragen. Gleiche Ereignisse eines Kontos stehen pro Stunde in einer Zeile mit Zahl. Fehler im Betrieb stehen im Betriebs-Log, nicht hier.",
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
const istKennung = (v) => /^[0-9a-f-]{36}$/i.test(v);

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
  let reiter = "aenderungen";
  let einheit = "tag";
  let eintraege = [];
  let naechste = null;
  let lauf = 0;
  const sicherheit = () => reiter === "sicherheit";

  const erklaerung = el("p", { class: "beschreibung pl-erklaerung" });
  const verlaufFeld = el("div", { class: "pl-verlauf" });
  const kacheln = el("div", { class: "pl-kacheln" });
  const chips = el("ul", {
    class: "pl-chips",
    "aria-label": "Gesetzte Filter",
  });
  const treffer = el("p", { class: "klein leise", role: "status" });
  const listeFeld = el("div", { class: "pl-listenfeld" });
  const mehrFeld = el("div", { class: "pl-mehr" });
  const stand = el("p", { class: "meta stand" });

  // ---- Reiter ----
  const reiterWahl = filterGruppe({
    beschriftung: "Art der Einträge",
    eintraege: [
      { text: "Änderungen", wert: "aenderungen" },
      { text: "Sicherheit", wert: "sicherheit" },
    ],
    wert: reiter,
    beiAenderung: (wert) => {
      reiter = wert;
      filter.gruppe = "";
      zeigeFilterInFeldern();
      neuLaden();
    },
  });

  // ---- Werkzeugleiste ----
  const von = datumsfeld({ label: "Von" });
  const bis = datumsfeld({ label: "Bis" });
  const benutzer = feld({
    label: "Person",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "Name oder Kennung",
  });
  const suche = feld({
    label: "Suche",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "z. B. Rolle, Kasse oder Lädeli",
  });
  const bereichWahl = {
    aktuell: auswahl({
      label: "Bereich",
      optionen: [["", "Alle Bereiche"]],
      wert: "",
    }),
  };
  const aktionWahl = auswahl({
    label: "Aktion",
    optionen: GRUPPEN_OPTIONEN,
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
    const alle = new Set(bekannteBereiche);
    if (filter.bereich) alle.add(filter.bereich);
    const optionen = [
      ["", "Alle Bereiche"],
      ...[...alle]
        .map((b) => [b, bereichText(b)])
        .sort((a, b) => a[1].localeCompare(b[1], "de-CH")),
    ];
    const neu = auswahl({ label: "Bereich", optionen, wert: filter.bereich });
    neu.eingabe.addEventListener("change", () => {
      if (filter.bereich === neu.eingabe.value) return;
      filter.bereich = neu.eingabe.value;
      neuLaden();
    });
    bereichWahl.aktuell.wurzel.replaceWith(neu.wurzel);
    bereichWahl.aktuell = neu;
  }

  function zeigeFilterInFeldern() {
    von.eingabe.value = filter.von;
    bis.eingabe.value = filter.bis;
    benutzer.eingabe.value = istKennung(filter.benutzer) ? "" : filter.benutzer;
    suche.eingabe.value = filter.q;
    aktionWahl.eingabe.value = filter.gruppe;
    aktionWahl.eingabe.dispatchEvent(new Event("change"));
    // Die Aktion gibt es nur bei Änderungen
    aktionWahl.wurzel.hidden = sicherheit();
    baueBereichWahl();
    reiterWahl.setze(reiter);
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
  suche.eingabe.addEventListener("input", () =>
    verzoegert(() => {
      filter.q = suche.eingabe.value.trim();
      neuLaden();
    }),
  );
  aktionWahl.eingabe.addEventListener("change", () => {
    if (filter.gruppe === aktionWahl.eingabe.value) return;
    filter.gruppe = aktionWahl.eingabe.value;
    neuLaden();
  });

  werkzeuge.append(
    el(
      "div",
      { class: "pl-zeile-felder" },
      von.wurzel,
      bis.wurzel,
      benutzer.wurzel,
      suche.wurzel,
    ),
    el(
      "div",
      { class: "pl-zeile-felder" },
      bereichWahl.aktuell.wurzel,
      aktionWahl.wurzel,
    ),
  );

  function chipText(k, v) {
    if (k === "gruppe") return GRUPPEN[v]?.[0] ?? v;
    if (k === "bereich") return bereichText(v);
    if (k === "von" || k === "bis") return datumDe(v);
    if (istKennung(v)) return `${v.slice(0, 8)} …`;
    return v;
  }
  function zeichneChips() {
    const gesetzt = Object.entries(filter).filter(([, v]) => v !== "");
    chips.replaceChildren(
      ...gesetzt.map(([k, v]) => {
        const text = chipText(k, v);
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
  const artParam = () => (sicherheit() ? { art: "sicherheit" } : {});
  async function holeListe(nach) {
    return anfrage(
      "GET",
      `${BASIS}${abfrage(filter, { ...artParam(), limit: SEITE, nach })}`,
    );
  }
  async function holeVerlauf() {
    const lang =
      filter.von && filter.bis && tageZwischen(filter.von, filter.bis) >= 7;
    const e = lang ? "tag" : einheit;
    return anfrage(
      "GET",
      `${BASIS}/verlauf${abfrage(filter, { ...artParam(), einheit: e })}`,
    ).then((d) => ({ ...d, einheit: e }));
  }

  function zeichneKacheln(v) {
    const s = v.summe;
    if (sicherheit()) {
      kacheln.replaceChildren(
        kachel({
          titel: "Ereignisse im Zeitraum",
          wert: zahl(s.gesamt),
          hinweis: `${datumDe(v.von)} bis ${datumDe(v.bis)}`,
        }),
        kachel({ titel: "Heute", wert: zahl(s.heute) }),
        kachel({ titel: "Letzte 7 Tage", wert: zahl(s.sieben) }),
        kachel({
          titel: "Betroffene Konten",
          wert: zahl(s.personen),
          hinweis: "Fehlversuche ohne Konto zählen nicht mit",
        }),
      );
      return;
    }
    kacheln.replaceChildren(
      kachel({ titel: "Änderungen heute", wert: zahl(s.heute) }),
      kachel({ titel: "Letzte 7 Tage", wert: zahl(s.sieben) }),
      kachel({
        titel: "Beteiligte Personen",
        wert: zahl(s.personen),
        hinweis: `${datumDe(v.von)} bis ${datumDe(v.bis)}`,
      }),
      kachel({
        titel: "Sicherheit, 7 Tage",
        wert: zahl(s.sicherheit),
        hinweis: "Fehlgeschlagene Anmeldungen und gesperrte Anfragen",
        status: s.sicherheit === 0 ? "ok" : "warn",
        zustand: s.sicherheit === 0 ? "Ruhig" : "Auffällig",
        link:
          s.sicherheit > 0
            ? knopf("Ansehen", {
                art: "still",
                klein: true,
                symbol: "schild",
                onclick: () => {
                  reiter = "sicherheit";
                  filter.gruppe = "";
                  zeigeFilterInFeldern();
                  neuLaden();
                },
              })
            : undefined,
      }),
    );
  }

  function zeichneVerlauf(v) {
    bekannteBereiche = [
      ...new Set([...bekannteBereiche, ...v.bereiche.map((b) => b.bereich)]),
    ].sort();
    const wort = sicherheit() ? "Sicherheitsereignisse" : "Änderungen";
    const punkte = v.punkte.map((p) => ({
      name: saeulenName(p.start, v.einheit),
      wert: p.gesamt,
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
            sicherheit()
              ? "Im gewählten Zeitraum gibt es keine Sicherheitsereignisse."
              : "Im gewählten Zeitraum gibt es keine Änderungen.",
          )
        : saeulen({
            punkte,
            titel: `${wort} im Protokoll`,
            einheit: wort,
            hoehe: 80,
            weit: true,
          });
    verlaufFeld.replaceChildren(
      ...[
        el(
          "div",
          { class: "pl-verlauf-kopf" },
          el(
            "h2",
            {},
            `${wort} je ${v.einheit === "stunde" ? "Stunde" : "Tag"}`,
          ),
          umschalter.wurzel,
        ),
        grafik,
        v.summe.gesamt > 0 &&
          el(
            "details",
            { class: "pl-tabelle" },
            el("summary", {}, "Zahlen als Tabelle"),
            wertetabelle({
              beschriftung: `${wort} je Zeitraum`,
              spalten: ["Zeitraum", wort],
              zeilen: punkte.map((p) => [p.name, zahl(p.wert)]),
            }),
            v.bereiche.length > 0 &&
              wertetabelle({
                beschriftung: `${wort} je Bereich`,
                spalten: ["Bereich", wort],
                zeilen: v.bereiche.map((b) => [
                  bereichText(b.bereich),
                  zahl(b.gesamt),
                ]),
              }),
          ),
      ].filter(Boolean),
    );
  }

  function zeichneListe() {
    if (eintraege.length === 0) {
      const gefiltert = Object.values(filter).some((x) => x !== "");
      listeFeld.replaceChildren(
        el(
          "div",
          { class: "zustand", role: "status" },
          el(
            "p",
            { class: "zustand-satz" },
            gefiltert
              ? sicherheit()
                ? "Kein Sicherheitsereignis passt zu diesen Filtern."
                : "Keine Änderung passt zu diesen Filtern."
              : sicherheit()
                ? "Keine Sicherheitsereignisse im Zeitraum."
                : "Im gewählten Zeitraum gibt es keine Änderungen.",
          ),
          gefiltert &&
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
    } catch (f) {
      ctx.melde(`Mehr laden nicht möglich: ${fehlertext(f)}`, "fehler");
      zeichneListe();
    }
  }

  const standText = () =>
    `Stand ${new Intl.DateTimeFormat("de-CH", { timeStyle: "medium", timeZone: "Europe/Zurich" }).format(new Date())}. Neue Einträge holst du mit «Aktualisieren».`;

  // Lädt Liste und Verlauf neu (nach einem Filter oder «Aktualisieren»); der alte Stand bleibt stehen, bis der neue da ist
  async function neuLaden({ nurVerlauf = false } = {}) {
    const meine = ++lauf;
    listeFeld.setAttribute("aria-busy", "true");
    try {
      const [d, v] = await Promise.all([
        nurVerlauf ? null : holeListe(),
        holeVerlauf(),
      ]);
      if (meine !== lauf) return false;
      if (d) {
        eintraege = d.eintraege;
        naechste = d.naechste;
      }
      erklaerung.textContent = ERKLAERUNG[reiter];
      zeichneKacheln(v);
      zeichneVerlauf(v);
      zeichneListe();
      if (!nurVerlauf) baueBereichWahl();
      stand.textContent = standText();
      return true;
    } catch (f) {
      if (meine !== lauf) return false;
      ctx.melde(`Aktualisieren nicht möglich: ${fehlertext(f)}`, "fehler");
      return false;
    } finally {
      if (meine === lauf) listeFeld.removeAttribute("aria-busy");
    }
  }

  // ---- CSV ----
  const exportFeld = el("div", { class: "pl-export" });
  let blobUrl = null;
  function zeichneExport(zustand = "bereit") {
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
        { class: "klein leise" },
        "Nur der gefilterte Ausschnitt, höchstens 5000 Einträge, ohne Namen von Personen und Herkunft. Der Export steht im Audit-Log.",
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
        `${BASIS}/export.csv${abfrage(filter, artParam())}`,
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
      zeichneExport("fertig");
      ctx.melde("Der Export ist bereit.");
    } catch (f) {
      zeichneExport("bereit");
      ctx.melde(
        `Export nicht möglich: ${fehlertext(f instanceof ApiFehler ? f : new ApiFehler(0, "NETZ"))}`,
        "fehler",
      );
    }
  }

  // ---- Aufbau ----
  const sektionListeId = neueId("pl-liste");
  const seite = el(
    "div",
    { class: "pl-seite" },
    el("div", { class: "pl-reiter" }, reiterWahl.wurzel),
    erklaerung,
    el("div", { class: "stand-zeile" }, stand),
    kacheln,
    el(
      "section",
      { class: "flaeche pl-flaeche", "aria-label": "Verlauf über die Zeit" },
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
    erklaerung.textContent = ERKLAERUNG[reiter];
    zeichneKacheln(v);
    zeichneVerlauf(v);
    zeichneListe();
    baueBereichWahl();
    zeichneExport();
    stand.textContent = standText();
    bereich.append(seite);
  }

  ctx.kopfAktion(
    knopf("Aktualisieren", {
      symbol: "aktualisieren",
      onclick: async () => {
        if (await neuLaden()) ctx.melde("Protokoll aktualisiert.");
      },
    }),
  );
  ctx.lade(() => Promise.all([holeListe(), holeVerlauf()]), zeichneAlles, {
    skeleton: "liste",
  });
}
