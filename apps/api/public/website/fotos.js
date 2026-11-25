// Fotoalben (#690, #796): zeigt die Alben der Abteilung und ihre Bilder. Das HTML der Seite ist statisch und für alle gleich (nur der leere Behälter «.fotos»); dieses Skript fragt nach dem Laden unseren Server (GET /api/v1/fotos/alben, …/alben/<id>) und baut alles mit DOM-Knoten und setzt Text nur als Textknoten.
// Bilder kommen von unserem Server, nie von Flickr (img-src 'self'): /api/v1/fotos/alben/<id>/titel und …/bilder/<bildId>?groesse=klein|mittel|gross. Ohne Sitzung antwortet der Server 401, dann steht «Nur angemeldet sichtbar» mit dem Link zur Anmeldung.
// Übersicht: Karten mit Titelbild; ab VIELE_ALBEN Gruppen nach Jahr (ältere zugeklappt) und eine Suche nach Titel («/» fokussiert sie). Album: Kopf, Bilder in gleich hohen Zeilen nach ihrem Seitenverhältnis (fotos.css, ohne Stilattribut) und 48 Bilder je Schritt mit «Weitere Fotos anzeigen».
// Ein Album hat eine teilbare Adresse: /fotos?album=<Kennung> (Ziffern). Der Wechsel zwischen Übersicht und Album setzt einen Eintrag im Verlauf, Zurück im Browser führt dorthin zurück.
// Die Grossansicht ist lichtkasten.js (Pfeiltasten, Esc, Wischen): Die Bilder stehen in einem «.fotos-raster», jedes als Link «a.bildgross», auch die noch nicht gezeigten (versteckt, ohne Quelle): So kennt die Grossansicht alle Bilder des Albums und zählt «Bild 24 von 393».
// Die reinen Teile (Gruppen, Suche, Schritte, Namen) stehen in fotos-logik.js.
import { el, holeMitFrist, skelett, symbol } from "./ui.js";
import {
  SCHRITT_BILDER,
  VIELE_ALBEN,
  albenText,
  bildBreiten,
  bildName,
  filtereAlben,
  fotosText,
  gruppiereNachJahr,
  mengeBis,
  naechsteMenge,
  standardOffen,
  trefferText,
  verhaeltnisKlasse,
} from "./fotos-logik.js";

const API = "/api/v1/fotos";
// Nach so langer Zeit steht der Hinweis, dass es länger dauert
const HINWEIS_NACH_MS = 4000;
// Die Anzahl der Alben erscheint erst, wenn die Person kurz nicht mehr tippt (Screenreader)
const ZAHL_NACH_MS = 400;
const KENNUNG = /^[0-9]{1,20}$/;
const FLICKR = /^https:\/\/www\.flickr\.com\//;

const datumFormat = new Intl.DateTimeFormat("de-CH", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monatFormat = new Intl.DateTimeFormat("de-CH", {
  month: "long",
  year: "numeric",
});
const datumVon = (iso) =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T12:00:00`)
    : null;

// «sizes» grob nach der Breite einer Karte und einer Kachel (Breiten in fotos.css)
const GROESSEN_TITEL = "(max-width: 40em) 100vw, (max-width: 62em) 50vw, 25vw";
const GROESSEN_RASTER =
  "(max-width: 40em) 50vw, (max-width: 90em) 20rem, 24rem";
// Formen der Kacheln im Ladezustand des Albums
const SKELETT_FORMEN = [
  "fr15",
  "fr10",
  "fr20",
  "fr15",
  "fr07",
  "fr15",
  "fr13",
  "fr20",
  "fr15",
  "fr10",
  "fr15",
  "fr15",
];

const albumAdresse = (id) => `${location.pathname}?album=${id}`;
const bildAdresse = (album, bild, groesse) =>
  `${API}/alben/${album}/bilder/${bild}?groesse=${groesse}`;

function albumAusAdresse() {
  const id = new URLSearchParams(location.search).get("album");
  return id !== null && KENNUNG.test(id) ? id : null;
}

function start(wurzel) {
  wurzel.classList.add("fotos--bereit");
  // Der Titel der Seite beim Start (bei einer geschützten Seite erst nach dem Nachladen); im Album steht «Album | Abteilung» im Tab
  const seitenTitel = document.title;
  const rest = seitenTitel.split(" | ").slice(1).join(" | ");
  const status = el("p", "nur-sr");
  status.setAttribute("role", "status");
  const inhalt = el("div", "fotos-inhalt");
  wurzel.replaceChildren(status, inhalt);
  // Eine laufende Anfrage; eine neue Ansicht bricht sie ab
  let abbruch = null;
  let hinweisTimer = 0;
  // Das Album, aus dem die Person zurückkommt: Dort landet der Fokus wieder
  let zuletzt = null;
  let offenesAlbum = null;
  // Suche und selbst auf- oder zugeklappte Jahre bleiben, wenn die Person aus einem Album zurückkommt
  let suchtext = "";
  const ueberschrieben = new Map();
  // Räumt die Zuhörer der aktuellen Ansicht weg
  let aufraeumen = null;

  const sage = (text) => {
    status.textContent = "";
    queueMicrotask(() => (status.textContent = text));
  };

  function beginne() {
    abbruch?.abort();
    clearTimeout(hinweisTimer);
    abbruch = new AbortController();
    wurzel.setAttribute("aria-busy", "true");
    return abbruch.signal;
  }

  function ende() {
    clearTimeout(hinweisTimer);
    wurzel.removeAttribute("aria-busy");
  }

  // Der Hinweis nach 4 s kommt unter das Skelett; er verschwindet mit ihm
  function warteHinweis() {
    hinweisTimer = setTimeout(() => {
      inhalt.append(el("p", "klein leise", "Das dauert länger als sonst."));
      sage("Das dauert länger als sonst.");
    }, HINWEIS_NACH_MS);
  }

  const skelettAlben = () => {
    const liste = el("div", "fotos-alben fotos-skelett");
    for (let i = 0; i < 8; i++) {
      liste.append(skelett("fotos-sk-bild", "t b70", "t b40"));
    }
    return liste;
  };
  const skelettBilder = () => {
    const raster = el("div", "fotos-raster");
    for (const form of SKELETT_FORMEN) {
      raster.append(
        el("div", `fotos-kachel ${form}`, skelett("fotos-sk-bild")),
      );
    }
    return el(
      "div",
      "fotos-album-ansicht fotos-skelett",
      skelett("r h48 bpx160", "t h28 b50", "t b30"),
      raster,
    );
  };

  // Eine Fläche für alles, was nicht die Alben sind: Titel, Text, ein Knopf oder ein Link
  function zustand({
    art = "",
    symbolName,
    titel,
    text,
    aktion,
    rolle = "status",
  }) {
    const k = el(
      "div",
      `zustand${art ? ` ${art}` : ""}`,
      el("p", "kopfzeile", symbol(symbolName), titel),
    );
    if (text) k.append(el("p", "", text));
    if (aktion) k.append(aktion);
    k.setAttribute("role", rolle);
    return k;
  }

  function zeigeFehler(text, nochmals) {
    const knopf = el(
      "button",
      "btn s",
      symbol("nochmals"),
      "Nochmals versuchen",
    );
    knopf.type = "button";
    knopf.addEventListener("click", nochmals);
    inhalt.replaceChildren(
      zustand({
        art: "fe",
        symbolName: "warnung",
        titel: "Das hat nicht geklappt.",
        text,
        aktion: knopf,
        rolle: "alert",
      }),
    );
    sage("Das hat nicht geklappt.");
  }

  // Gemeinsame Antworten auf alles, was nicht 200 ist; true, wenn die Antwort behandelt ist
  function behandle(antwort, nochmals) {
    if (antwort.status === 401) {
      // Zurück zur selben Ansicht, auch zu einem Album (nur Pfad und «?album=»)
      const weiter = encodeURIComponent(location.pathname + location.search);
      const link = el("a", "btn p gross", "Anmelden");
      link.href = `/anmelden?weiter=${weiter}`;
      inhalt.replaceChildren(
        el(
          "div",
          "schutzblock",
          el("p", "schutz", symbol("schloss"), "Nur angemeldet sichtbar"),
          el(
            "p",
            "",
            "Die Fotos der Abteilung sehen nur angemeldete Personen.",
          ),
          link,
        ),
      );
      sage("Nur angemeldet sichtbar. Melde dich an, um die Fotos zu sehen.");
      return true;
    }
    if (antwort.status === 403) {
      inhalt.replaceChildren(
        zustand({
          symbolName: "info",
          titel: "Die Fotos sind für dieses Konto nicht verfügbar.",
          text: "Wende dich an die Leitung, wenn du sie brauchst.",
        }),
      );
      sage("Die Fotos sind für dieses Konto nicht verfügbar.");
      return true;
    }
    if (antwort.status === 429) {
      zeigeFehler("Zu viele Anfragen. Warte einen Moment.", nochmals);
      return true;
    }
    if (antwort.status === 502 || antwort.status === 503) {
      zeigeFehler(
        "Die Fotos sind im Moment nicht erreichbar. Versuche es in ein paar Minuten nochmals.",
        nochmals,
      );
      return true;
    }
    return false;
  }

  async function hole(url, nochmals) {
    const signal = beginne();
    let antwort;
    try {
      antwort = await holeMitFrist(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
    } catch {
      if (signal.aborted && abbruch?.signal !== signal) return null;
      ende();
      zeigeFehler("Prüfe dein Internet und versuche es nochmals.", nochmals);
      return null;
    }
    if (signal !== abbruch?.signal) return null;
    ende();
    if (antwort.status === 404) return { nichtGefunden: true };
    if (!antwort.ok) {
      if (!behandle(antwort, nochmals)) {
        zeigeFehler("Versuche es in ein paar Minuten nochmals.", nochmals);
      }
      return null;
    }
    try {
      return await antwort.json();
    } catch {
      zeigeFehler("Versuche es in ein paar Minuten nochmals.", nochmals);
      return null;
    }
  }

  // ---------- Übersicht der Alben ----------

  // Eine Karte: Titelbild mit festem Seitenverhältnis, Titel und «393 Fotos · Oktober 2026». Der ganze Link hat einen Namen, der alles nennt; das Titelbild ist dekorativ
  function albumKarte(a, titelStufe) {
    const titel = String(a.titel || "Ohne Titel");
    const anzahl = Number(a.anzahl) || 0;
    const datum = datumVon(a.datum);
    const meta = [fotosText(anzahl), datum ? monatFormat.format(datum) : ""]
      .filter(Boolean)
      .join(" · ");
    let bild;
    if (a.titelbild) {
      const basis = `${API}/alben/${a.id}/titel`;
      bild = el("img");
      bild.sizes = GROESSEN_TITEL;
      bild.srcset = `${basis}?groesse=klein 320w, ${basis}?groesse=mittel 640w`;
      bild.src = `${basis}?groesse=mittel`;
      bild.alt = "";
      bild.width = 640;
      bild.height = 480;
      bild.loading = "lazy";
      bild.decoding = "async";
    } else {
      bild = el("span", "fotos-leer", symbol("bild"));
    }
    const link = el(
      "a",
      "fotos-album",
      el("span", "fotos-titelbild", bild),
      el(
        "span",
        "fotos-text",
        el(titelStufe, "fotos-titel", titel),
        el("span", "fotos-meta", meta),
      ),
    );
    link.href = albumAdresse(a.id);
    link.dataset.album = String(a.id);
    link.setAttribute(
      "aria-label",
      `Album ${titel}, ${fotosText(anzahl)}${datum ? `, ${datumFormat.format(datum)}` : ""}`,
    );
    return el("li", "fotos-karte", link);
  }

  function baueUebersicht(alben) {
    const viele = alben.length >= VIELE_ALBEN;
    const gruppen = viele
      ? gruppiereNachJahr(alben)
      : [{ jahr: null, alben, flach: true }];
    const standard = standardOffen(gruppen);
    const filtert = () => suchtext.trim() !== "";
    const karten = new Map();

    const abschnitte = gruppen.map((g, nr) => {
      const liste = el("ul", "fotos-alben");
      liste.setAttribute("role", "list");
      for (const a of g.alben) {
        const li = albumKarte(a, viele ? "h3" : "h2");
        karten.set(a, li);
        liste.append(li);
      }
      if (g.flach) return { g, liste, wurzel: liste };
      const id = `fotos-jahr-${nr}`;
      liste.id = id;
      const zahl = el("span", "fotos-jahr-zahl");
      const knopf = el(
        "button",
        "fotos-jahr-knopf",
        el("span", "fotos-jahr-name", g.jahr ?? "Ohne Datum"),
        zahl,
        symbol("pfeil"),
      );
      knopf.type = "button";
      knopf.setAttribute("aria-controls", id);
      knopf.addEventListener("click", () => {
        ueberschrieben.set(g.jahr, liste.hidden);
        aktualisiere();
      });
      return {
        g,
        liste,
        knopf,
        zahl,
        wurzel: el("div", "fotos-gruppe", el("h2", "fotos-jahr", knopf), liste),
      };
    });

    // Suche (nur bei vielen Alben)
    let feld = null;
    let anzahlText = null;
    let werkzeug = null;
    const leer = el("div", "zustand");
    leer.hidden = true;
    const leerText = el("span");
    if (viele) {
      feld = el("input", "eingabe fotos-suche");
      feld.type = "search";
      feld.id = "fotos-suche";
      feld.autocomplete = "off";
      feld.spellcheck = false;
      feld.setAttribute("enterkeyhint", "search");
      feld.setAttribute("aria-keyshortcuts", "/");
      feld.value = suchtext;
      const taste = el("kbd", "fotos-taste", "/");
      taste.setAttribute("aria-hidden", "true");
      const beschriftung = el("label", "fotos-suche-label", "Alben suchen");
      beschriftung.htmlFor = "fotos-suche";
      anzahlText = el("p", "fotos-zahl", albenText(alben.length));
      anzahlText.setAttribute("role", "status");
      werkzeug = el(
        "div",
        "fotos-werkzeug",
        beschriftung,
        el("div", "fotos-suchfeld", feld, taste),
        anzahlText,
      );
      const zuruecksetzen = el("button", "btn s", "Suche zurücksetzen");
      zuruecksetzen.type = "button";
      zuruecksetzen.addEventListener("click", () => {
        feld.value = "";
        beiEingabe();
        feld.focus();
      });
      leer.append(
        el("p", "kopfzeile", symbol("info"), leerText),
        el("p", "", "Prüfe die Schreibweise oder suche nach dem Jahr."),
        zuruecksetzen,
      );
    }

    let zahlTimer = 0;
    function setzeZahl(text, sofort) {
      if (!anzahlText) return;
      clearTimeout(zahlTimer);
      if (sofort) anzahlText.textContent = text;
      else {
        zahlTimer = setTimeout(
          () => (anzahlText.textContent = text),
          ZAHL_NACH_MS,
        );
      }
    }

    function aktualisiere(sofort = true) {
      const treffer = new Set(filtereAlben(alben, suchtext));
      for (const x of abschnitte) {
        let n = 0;
        for (const a of x.g.alben) {
          const da = treffer.has(a);
          karten.get(a).hidden = !da;
          if (da) n++;
        }
        if (x.g.flach) continue;
        x.wurzel.hidden = n === 0;
        // Wer sucht, sieht jedes Jahr mit Treffern aufgeklappt; ein Klick auf das Jahr gilt bis zur nächsten Eingabe
        const offen =
          ueberschrieben.get(x.g.jahr) ?? (filtert() || standard.has(x.g.jahr));
        x.liste.hidden = !offen;
        x.knopf.setAttribute("aria-expanded", String(offen));
        x.knopf.classList.toggle("offen", offen);
        x.zahl.textContent = trefferText(n, x.g.alben.length);
      }
      leer.hidden = treffer.size > 0;
      if (treffer.size === 0) {
        leerText.textContent = `Keine Alben für «${suchtext.trim()}».`;
      }
      setzeZahl(trefferText(treffer.size, alben.length), sofort);
    }

    function beiEingabe() {
      suchtext = feld.value;
      ueberschrieben.clear();
      aktualisiere(false);
    }

    if (feld) {
      feld.addEventListener("input", beiEingabe);
      feld.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && feld.value) {
          e.preventDefault();
          feld.value = "";
          beiEingabe();
        }
      });
    }

    // Kommt die Person aus einem Album zurück, ist dessen Jahr aufgeklappt, damit der Fokus seine Karte findet
    const zurueckZu = zuletzt
      ? alben.find((a) => String(a.id) === String(zuletzt))
      : null;
    if (zurueckZu && viele) {
      const jahr = gruppen.find((g) => g.alben.includes(zurueckZu))?.jahr;
      if (jahr !== undefined && !ueberschrieben.has(jahr)) {
        ueberschrieben.set(jahr, true);
      }
    }

    inhalt.replaceChildren(
      el(
        "div",
        "fotos-uebersicht",
        ...(werkzeug ? [werkzeug] : []),
        leer,
        ...abschnitte.map((x) => x.wurzel),
      ),
    );
    aktualisiere();
    sage(
      filtert()
        ? trefferText(filtereAlben(alben, suchtext).length, alben.length)
        : `${albenText(alben.length)}.`,
    );
    if (zurueckZu) {
      karten
        .get(zurueckZu)
        ?.querySelector("a")
        ?.focus({ preventScroll: false });
      zuletzt = null;
    }
  }

  async function zeigeAlben() {
    offenesAlbum = null;
    inhalt.replaceChildren(skelettAlben());
    warteHinweis();
    sage("Die Alben werden geladen.");
    const daten = await hole(`${API}/alben`, zeigeAlben);
    if (!daten) return;
    const alben = (Array.isArray(daten.alben) ? daten.alben : []).filter((a) =>
      KENNUNG.test(String(a.id)),
    );
    if (daten.konfiguriert !== true || alben.length === 0) {
      inhalt.replaceChildren(
        zustand({
          symbolName: "bild",
          titel: "Hier gibt es noch keine Fotos.",
          text: "Sobald die Leitung Alben freigibt, erscheinen sie hier.",
        }),
      );
      sage("Hier gibt es noch keine Fotos.");
      return;
    }
    baueUebersicht(alben);
  }

  // ---------- Ein Album ----------

  async function zeigeAlbum(id) {
    offenesAlbum = id;
    inhalt.replaceChildren(skelettBilder());
    warteHinweis();
    sage("Das Album wird geladen.");
    const daten = await hole(`${API}/alben/${id}`, () => zeigeAlbum(id));
    if (!daten) return;
    const zurueck = el(
      "a",
      "btn s fotos-zurueck",
      symbol("pfeil"),
      "Alle Fotos",
    );
    zurueck.href = location.pathname;
    zurueck.dataset.zurueck = "";
    if (daten.nichtGefunden) {
      inhalt.replaceChildren(
        zustand({
          symbolName: "info",
          titel: "Dieses Album gibt es nicht (mehr).",
          aktion: zurueck,
        }),
      );
      sage("Dieses Album gibt es nicht.");
      return;
    }
    const bilder = (Array.isArray(daten.bilder) ? daten.bilder : []).filter(
      (b) => KENNUNG.test(String(b.id)),
    );
    const gesamt = bilder.length;
    const albumTitel = String(daten.titel || "Ohne Titel");
    const titel = el("h2", "fotos-kopf-titel", albumTitel);
    titel.tabIndex = -1;
    const datum = datumVon(daten.datum);
    const meta = [fotosText(gesamt), datum ? datumFormat.format(datum) : ""]
      .filter(Boolean)
      .join(" · ");
    const kopf = el(
      "div",
      "fotos-kopf",
      zurueck,
      el("div", "fotos-kopf-text", titel, el("p", "fotos-meta", meta)),
    );
    // Nur wenn die Abteilung es will, und nur ein Link zu Flickr: Er führt aus der Website hinaus
    if (typeof daten.flickrUrl === "string" && FLICKR.test(daten.flickrUrl)) {
      const flickr = el(
        "a",
        "fotos-extern",
        "Album auf Flickr öffnen",
        el("span", "nur-sr", " (externe Seite, öffnet in neuem Tab)"),
      );
      flickr.href = daten.flickrUrl;
      flickr.target = "_blank";
      flickr.rel = "noopener noreferrer";
      kopf.append(flickr);
    }

    // Jedes Bild ist ein Link zur Grossansicht (Name «Foto 3 von 393», das Bild darin ist dekorativ). Alle stehen im DOM, gezeigt sind nur die ersten: Der Rest ist versteckt und hat noch keine Quelle, also lädt er nichts
    const raster = el("ul", "fotos-raster");
    raster.setAttribute("role", "list");
    raster.setAttribute("aria-label", `Fotos im Album ${albumTitel}`);
    const kacheln = bilder.map((b, i) => {
      const breite = Number(b.breite) || 4;
      const hoehe = Number(b.hoehe) || 3;
      const bild = el("img");
      bild.alt = "";
      bild.width = breite;
      bild.height = hoehe;
      bild.loading = "lazy";
      bild.decoding = "async";
      const link = el("a", "bildgross", bild);
      link.href = bildAdresse(id, b.id, "gross");
      link.setAttribute("aria-label", bildName(i + 1, gesamt, b.titel));
      const li = el(
        "li",
        `fotos-kachel ${verhaeltnisKlasse(breite, hoehe)}`,
        link,
      );
      li.hidden = true;
      return { li, link, bild, id: b.id, breite, hoehe };
    });
    raster.append(...kacheln.map((k) => k.li));

    // Fortschritt und «Weitere Fotos anzeigen»
    let gezeigt = 0;
    const fortschritt = el("progress", "fotos-fortschritt");
    fortschritt.max = gesamt;
    fortschritt.setAttribute("aria-hidden", "true");
    const mehrText = el("p", "fotos-mehr-text");
    const mehrKnopf = el("button", "btn s");
    mehrKnopf.type = "button";
    const mehr = el("div", "fotos-mehr", fortschritt, mehrText, mehrKnopf);
    mehr.hidden = gesamt <= SCHRITT_BILDER;
    const standText = () =>
      gezeigt === gesamt
        ? `Alle ${fotosText(gesamt)} angezeigt.`
        : `${gezeigt} von ${fotosText(gesamt)} angezeigt.`;

    function zeigeBis(menge) {
      for (let i = gezeigt; i < menge; i++) {
        const k = kacheln[i];
        const w = bildBreiten(k.breite, k.hoehe);
        const klein = bildAdresse(id, k.id, "klein");
        k.bild.sizes = GROESSEN_RASTER;
        k.bild.srcset = `${klein} ${w.klein}w, ${bildAdresse(id, k.id, "mittel")} ${w.mittel}w`;
        k.bild.src = klein;
        k.li.hidden = false;
      }
      gezeigt = Math.max(gezeigt, menge);
      fortschritt.value = gezeigt;
      mehrText.textContent = standText();
      mehrKnopf.hidden = gezeigt === gesamt;
      mehrKnopf.textContent = `Weitere ${fotosText(Math.min(SCHRITT_BILDER, gesamt - gezeigt))} anzeigen`;
    }

    mehrKnopf.addEventListener("click", () => {
      const von = gezeigt;
      zeigeBis(naechsteMenge(gezeigt, gesamt));
      // Der Knopf steht unter den neuen Bildern: Der Fokus geht auf das erste neue
      kacheln[von]?.link.focus();
      sage(standText());
    });

    // Wer in der Grossansicht weiterblättert, kann bei einem Bild landen, das noch nicht gezeigt ist: Beim Schliessen kommt der Stand dorthin, und die Seite scrollt zum Bild
    const beiZu = (e) => {
      const link = e.detail?.link;
      const i = kacheln.findIndex((k) => k.link === link);
      if (i < 0) return;
      zeigeBis(mengeBis(gezeigt, i, gesamt));
      const r = link.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        link.scrollIntoView({ block: "center" });
      }
    };
    document.addEventListener("lichtkasten:zu", beiZu);
    aufraeumen = () => document.removeEventListener("lichtkasten:zu", beiZu);

    inhalt.replaceChildren(
      kopf,
      gesamt > 0
        ? el("div", "fotos-bilder", raster, mehr)
        : zustand({
            symbolName: "bild",
            titel: "In diesem Album sind noch keine Fotos.",
          }),
    );
    zeigeBis(Math.min(gesamt, SCHRITT_BILDER));
    document.title = rest ? `${albumTitel} | ${rest}` : albumTitel;
    sage(`${albumTitel}, ${fotosText(gesamt)}.`);
    titel.focus({ preventScroll: true });
    wurzel.scrollIntoView({ block: "start" });
  }

  function zeige() {
    aufraeumen?.();
    aufraeumen = null;
    document.title = seitenTitel;
    const id = albumAusAdresse();
    if (id) zeigeAlbum(id);
    else zeigeAlben();
  }

  // Wechsel zwischen Übersicht und Album: ein Eintrag im Verlauf, kein Neuladen. Mit Zusatztaste oder mittlerer Taste bleibt der Link ein Link
  wurzel.addEventListener("click", (e) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const link = e.target.closest?.("a.fotos-album, a[data-zurueck]");
    if (!link || !wurzel.contains(link)) return;
    e.preventDefault();
    zuletzt = link.dataset.album ?? albumAusAdresse();
    window.history.pushState(null, "", link.getAttribute("href"));
    zeige();
  });
  window.addEventListener("popstate", () => {
    // Zurück aus einem Album: Der Fokus kehrt zu seiner Karte zurück
    zuletzt = offenesAlbum;
    zeige();
  });
  // «/» springt ins Suchfeld, wenn die Person nicht gerade schreibt und keine Grossansicht offen ist
  document.addEventListener("keydown", (e) => {
    if (
      e.key !== "/" ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.defaultPrevented
    ) {
      return;
    }
    const feld = document.getElementById("fotos-suche");
    if (!feld || !wurzel.contains(feld)) return;
    if (
      document.querySelector("dialog[open]") ||
      (e.target instanceof Element &&
        e.target.closest("input, textarea, select, [contenteditable]"))
    ) {
      return;
    }
    e.preventDefault();
    feld.focus();
    feld.select();
  });
  zeige();
}

function alleStarten() {
  for (const w of document.querySelectorAll(".fotos:not(.fotos--bereit)")) {
    start(w);
  }
}

alleStarten();
// Ein geschützter Baustein oder eine ganz geschützte Seite kommt erst nach der Anmeldung (geschuetzt.js): Das Skript rüstet ihn aus, sobald er da ist
const haupt = document.getElementById("inhalt");
if (
  haupt &&
  (haupt.hasAttribute("data-huelle") ||
    haupt.querySelector("[data-geschuetzt]"))
) {
  new MutationObserver(alleStarten).observe(haupt, {
    childList: true,
    subtree: true,
  });
}
