// Aktionen mit «Rückgängig» (#578): Ersatz für Rückfragen wie «Wirklich löschen?». Die Aktion wird sofort angezeigt («Seite gelöscht»), aber erst nach einer Frist wirklich an die API geschickt.
// In der Frist lässt sie sich zurücknehmen; die Ansicht kommt dann zurück und die Anfrage geht nie. Verlässt die Person die Seite vor Ablauf, läuft die Aktion sofort (nie still verworfen).
// Reine Logik ohne DOM: Zeitgeber sind einsetzbar (Tests); die Darstellung steht in rahmen.js, die Verdrahtung in admin.js.

export const FRIST_MS = 8000;
// Wie lange eine Bestätigung steht (#869): lang genug zum Lesen, mindestens 5 Sekunden (Handbuch 2.7); 2 Sekunden zum Bemerken, dazu 60 ms je Zeichen (rund 170 Wörter in der Minute).
// Hier statt in rahmen.js, weil diese Datei ohne DOM läuft; rahmen.js nimmt sie für alle Rückmeldungen
export const LESE_MIN_MS = 5000;
export const lesedauer = (text = "") =>
  Math.max(LESE_MIN_MS, 2000 + String(text).length * 60);
// So lange bleibt die zweite Stufe einer zweistufigen Aktion scharf
export const SCHARF_MS = 6000;

// beiAenderung(liste): nach jeder Änderung des Stands; ansage(text): Text für die Statusregion; beimVerlassen(): vor dem Ausführen beim Verlassen der Seite (api.js setzt dann keepalive)
export function erstelleRueckgaengig({
  zeit = {
    setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t),
    jetzt: () => Date.now(),
  },
  frist = FRIST_MS,
  // Vorgabe: die Lesedauer des Texts «Erledigt»
  erledigtNach,
  beiAenderung = () => {},
  ansage = () => {},
  beimVerlassen = () => {},
} = {}) {
  const aktionen = [];
  let zaehler = 0;

  const aendere = () => beiAenderung([...aktionen]);
  const entferne = (a) => {
    zeit.clearTimeout(a.timer);
    const i = aktionen.indexOf(a);
    if (i >= 0) aktionen.splice(i, 1);
    aendere();
  };

  // Lässt die Frist laufen (oder wieder weiterlaufen nach einer Pause)
  function laufe(a, ms) {
    zeit.clearTimeout(a.timer);
    a.rest = ms;
    a.start = zeit.jetzt();
    a.pausiert = false;
    a.timer = zeit.setTimeout(() => fuehreAus(a), ms);
  }

  async function fuehreAus(a) {
    if (a.phase !== "wartet") return;
    zeit.clearTimeout(a.timer);
    a.phase = "laeuft";
    aendere();
    try {
      const ergebnis = await a.ausfuehren();
      a.phase = "erledigt";
      a.text = a.erledigtText;
      aendere();
      ansage(a.erledigtText);
      a.danach?.(ergebnis);
      // «Erledigt» bleibt kurz stehen und geht dann von selbst; Zeigen und Fokus halten die Zeit an
      laufeAus(a, erledigtNach ?? lesedauer(a.erledigtText));
    } catch (fehler) {
      a.phase = "fehler";
      a.fehlerText = a.fehlertext(fehler);
      a.ansicht?.zurueck?.();
      aendere();
      ansage(a.fehlerText);
      a.beiFehler?.(fehler);
    }
  }

  function laufeAus(a, ms) {
    zeit.clearTimeout(a.timer);
    a.rest = ms;
    a.start = zeit.jetzt();
    a.pausiert = false;
    a.timer = zeit.setTimeout(() => entferne(a), ms);
  }

  return {
    // text: Satz in der Vergangenheit («Seite gelöscht»); ausfuehren(): die verzögerte Anfrage (wirft bei Fehlern); danach(ergebnis): nach Erfolg (Liste neu laden o. ä.);
    // ansicht: { weg(), zurueck() }: blendet die Zeile oder Karte sofort aus und holt sie bei «Rückgängig» oder Fehler zurück; rueckgaengig(): zusätzlicher Hinweis an den Aufrufer;
    // erledigt: Text nach dem Ausführen; fehlertext(f): Text bei Fehlern; beiFehler(f): zusätzlich
    starte({
      text,
      ausfuehren,
      danach,
      ansicht,
      rueckgaengig,
      erledigt = "Erledigt.",
      fehlertext = (f) => `Das hat nicht geklappt. ${f?.message ?? ""}`.trim(),
      beiFehler,
    }) {
      const a = {
        id: ++zaehler,
        text,
        phase: "wartet",
        ausfuehren,
        danach,
        ansicht,
        rueckgaengigHinweis: rueckgaengig,
        erledigtText: erledigt,
        fehlertext,
        beiFehler,
        frist,
        timer: null,
        rest: frist,
        start: 0,
        pausiert: false,
      };
      aktionen.push(a);
      a.ansicht?.weg?.();
      laufe(a, frist);
      aendere();
      ansage(`${text}. Rückgängig mit dem Knopf oder mit Strg Z.`);
      return a;
    },

    liste: () => [...aktionen],

    // Die jüngste Aktion in der Frist (Strg Z und Z nimmt immer die letzte zurück)
    letzte: () => [...aktionen].reverse().find((a) => a.phase === "wartet"),

    macheRueckgaengig(a) {
      if (a.phase !== "wartet") return false;
      zeit.clearTimeout(a.timer);
      a.phase = "zurueck";
      a.ansicht?.zurueck?.();
      a.rueckgaengigHinweis?.();
      entferne(a);
      ansage(`Rückgängig gemacht: ${a.text}`);
      return true;
    },

    // Zeigen oder Fokus halten die Frist an; danach läuft der Rest weiter
    halte(a) {
      if (a.pausiert || (a.phase !== "wartet" && a.phase !== "erledigt"))
        return;
      zeit.clearTimeout(a.timer);
      a.rest = Math.max(0, a.rest - (zeit.jetzt() - a.start));
      a.pausiert = true;
      aendere();
    },
    weiter(a) {
      if (!a.pausiert) return;
      if (a.phase === "wartet") laufe(a, a.rest);
      else if (a.phase === "erledigt") laufeAus(a, a.rest);
      aendere();
    },

    // Schliessen: in der Frist heisst es «jetzt ausführen», sonst nur ausblenden
    schliesse(a) {
      if (a.phase === "wartet") return fuehreAus(a);
      entferne(a);
    },

    // Beim Verlassen der Seite (pagehide) und vor dem Abmelden: alles Offene sofort ausführen, nichts verwerfen
    alleAusfuehren({ verlassen = false } = {}) {
      const offen = aktionen.filter((a) => a.phase === "wartet");
      if (verlassen && offen.length > 0) beimVerlassen();
      return Promise.all(offen.map((a) => fuehreAus(a)));
    },
  };
}

// Ein Knopf mit zwei Stufen für Aktionen, die sich nicht verzögern lassen (Folge trifft sofort Dritte, nicht umkehrbar): Der erste Klick macht ihn scharf («Wirklich senden?»), der zweite innerhalb von SCHARF_MS führt aus; danach fällt er zurück.
// Statt eines Popups steht die Frage im Knopf, und eine Statusregion sagt sie an. Escape nimmt sie zurück.
// Mit { frage, ausfuehren } hängt der Helfer sich an den Klick; ohne sie (Knopf in einem Formular) ruft das Formular beim Absenden verlange(frage, ausfuehren) auf.
// Ändert sich der Schlüssel zwischen den Stufen (Vorgabe: die Frage; die Person hat im Formular etwas geändert), gilt der zweite Klick als erster.
export function zweiStufig(
  knopfEl,
  { frage, ausfuehren, scharfNach = SCHARF_MS, zeit = globalThis } = {},
) {
  const text = knopfEl.lastChild.textContent;
  // Die Statusregion entsteht neben dem Knopf, sobald er im Dokument steht (beim ersten Klick)
  const ansage = knopfEl.ownerDocument.createElement("span");
  ansage.className = "nur-leser";
  ansage.setAttribute("role", "status");
  let timer = null;
  let scharfMit = null;
  const entscharfe = () => {
    zeit.clearTimeout(timer);
    timer = null;
    scharfMit = null;
    knopfEl.classList.remove("knopf--scharf");
    knopfEl.lastChild.textContent = text;
    if (knopfEl.dataset.label) {
      knopfEl.setAttribute("aria-label", knopfEl.dataset.label);
      delete knopfEl.dataset.label;
    }
  };
  const verlange = (f, aktion, schluessel = f) => {
    if (scharfMit === schluessel) {
      entscharfe();
      ansage.textContent = "";
      aktion();
      return;
    }
    if (!ansage.isConnected) knopfEl.after(ansage);
    zeit.clearTimeout(timer);
    scharfMit = schluessel;
    knopfEl.classList.add("knopf--scharf");
    // Ein Knopf mit eigenem aria-label («Aufheben: Website») sagt sonst weiter den alten Text an
    if (knopfEl.hasAttribute("aria-label")) {
      knopfEl.dataset.label = knopfEl.getAttribute("aria-label");
      knopfEl.removeAttribute("aria-label");
    }
    knopfEl.lastChild.textContent = f;
    ansage.textContent = `${f} Bestätige mit einem zweiten Klick. Ohne Bestätigung fällt der Knopf nach ${Math.round(scharfNach / 1000)} Sekunden zurück.`;
    timer = zeit.setTimeout(() => {
      entscharfe();
      ansage.textContent = "";
    }, scharfNach);
  };
  if (ausfuehren) {
    knopfEl.addEventListener("click", () => verlange(frage, ausfuehren));
  }
  knopfEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && scharfMit !== null) {
      entscharfe();
      ansage.textContent = "";
    }
  });
  return { verlange, entscharfe };
}

// Die eine Steuerung der Verwaltung: Module rufen mitRueckgaengig() auf (auch als ctx.mitRueckgaengig); admin.js verdrahtet Darstellung und pagehide
const verdrahtung = {
  beiAenderung: () => {},
  ansage: () => {},
  beimVerlassen: () => {},
};
export const steuerung = erstelleRueckgaengig({
  beiAenderung: (liste) => verdrahtung.beiAenderung(liste),
  ansage: (text) => verdrahtung.ansage(text),
  beimVerlassen: () => verdrahtung.beimVerlassen(),
});
export const verdrahte = (teile) => Object.assign(verdrahtung, teile);
export const mitRueckgaengig = (optionen) => steuerung.starte(optionen);

// Die einfachste Ansicht: Das Element (Zeile, Karte) ist sofort weg und kommt bei «Rückgängig» oder Fehler zurück
export const ansichtVon = (element) =>
  element
    ? {
        weg: () => (element.hidden = true),
        zurueck: () => (element.hidden = false),
      }
    : undefined;

// Kurzform für Knöpfe in einer Liste von Knoten: gibt den Knopf zurück
export const zweistufig = (knopfEl, frage, ausfuehren) => (
  zweiStufig(knopfEl, { frage, ausfuehren }),
  knopfEl
);

// Die Zeile oder Karte, in der der Knopf des Ereignisses steht (für ansicht)
export const ansichtVonKnopf = (ereignis) =>
  ansichtVon(ereignis?.currentTarget?.closest?.("tr, li, article"));
