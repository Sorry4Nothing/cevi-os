// Fotoalben (#690): zeigt die Alben der Abteilung und ihre Bilder. Das HTML der Seite ist statisch und für alle gleich (nur der leere Behälter «.fotos»); dieses Skript fragt nach dem Laden unseren Server (GET /api/v1/fotos/alben, …/alben/<id>) und baut alles mit DOM-Knoten und setzt Text nur als Textknoten.
// Bilder kommen von unserem Server, nie von Flickr (img-src 'self'): /api/v1/fotos/alben/<id>/titel und …/bilder/<bildId>?groesse=klein|mittel|gross. Ohne Sitzung antwortet der Server 401, dann steht «Nur angemeldet sichtbar» mit dem Link zur Anmeldung.
// Ein Album hat eine teilbare Adresse: /fotos?album=<Kennung> (Ziffern). Der Wechsel zwischen Übersicht und Album setzt einen Eintrag im Verlauf, Zurück im Browser führt dorthin zurück. Die Grossansicht ist lichtkasten.js (Pfeiltasten, Esc, Wischen): Die Bilder stehen in einer «.galerie», jedes als Link «a.bildgross».
import { el, holeMitFrist, skelett, symbol } from "./ui.js";

const API = "/api/v1/fotos";
// Nach so langer Zeit steht der Hinweis, dass es länger dauert
const HINWEIS_NACH_MS = 4000;
const KENNUNG = /^[0-9]{1,20}$/;
const FLICKR = /^https:\/\/www\.flickr\.com\//;

const datumFormat = new Intl.DateTimeFormat("de-CH", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const datumText = (iso) =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? datumFormat.format(new Date(`${iso}T12:00:00`))
    : "";
const fotosText = (n) => `${n} ${n === 1 ? "Foto" : "Fotos"}`;

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
    for (let i = 0; i < 6; i++) {
      liste.append(skelett("fotos-sk-bild", "t b70", "t b40"));
    }
    return liste;
  };
  const skelettBilder = () => {
    const raster = el("div", "galerie fotos-raster fotos-skelett");
    for (let i = 0; i < 12; i++) raster.append(skelett("fotos-sk-bild"));
    return raster;
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

  async function zeigeAlben() {
    offenesAlbum = null;
    inhalt.replaceChildren(skelettAlben());
    warteHinweis();
    sage("Die Alben werden geladen.");
    const daten = await hole(`${API}/alben`, zeigeAlben);
    if (!daten) return;
    const alben = Array.isArray(daten.alben) ? daten.alben : [];
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
    const liste = el("ul", "fotos-alben");
    liste.setAttribute("role", "list");
    for (const a of alben) {
      if (!KENNUNG.test(String(a.id))) continue;
      const bild = a.titelbild
        ? el("img")
        : el("span", "fotos-leer", symbol("bild"));
      if (a.titelbild) {
        bild.src = `${API}/alben/${a.id}/titel?groesse=mittel`;
        bild.alt = "";
        bild.width = 640;
        bild.height = 480;
        bild.loading = "lazy";
        bild.decoding = "async";
      }
      const meta = [fotosText(Number(a.anzahl) || 0), datumText(a.datum)]
        .filter(Boolean)
        .join(" · ");
      const link = el(
        "a",
        "fotos-album",
        el("span", "fotos-titelbild", bild),
        el(
          "span",
          "fotos-text",
          el("h2", "fotos-titel", String(a.titel || "Ohne Titel")),
          el("span", "fotos-meta", meta),
        ),
      );
      link.href = albumAdresse(a.id);
      link.dataset.album = String(a.id);
      liste.append(el("li", "", link));
    }
    inhalt.replaceChildren(liste);
    sage(`${alben.length} ${alben.length === 1 ? "Album" : "Alben"}.`);
    if (zuletzt) {
      liste
        .querySelector(`[data-album="${zuletzt}"]`)
        ?.focus({ preventScroll: false });
      zuletzt = null;
    }
  }

  // ---------- Ein Album ----------

  async function zeigeAlbum(id) {
    offenesAlbum = id;
    inhalt.replaceChildren(skelettBilder());
    warteHinweis();
    sage("Das Album wird geladen.");
    const daten = await hole(`${API}/alben/${id}`, () => zeigeAlbum(id));
    if (!daten) return;
    const zurueck = el("a", "fotos-zurueck", symbol("pfeil"), "Alle Alben");
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
    const bilder = Array.isArray(daten.bilder) ? daten.bilder : [];
    const titel = el(
      "h2",
      "fotos-kopf-titel",
      String(daten.titel || "Ohne Titel"),
    );
    titel.tabIndex = -1;
    const meta = [fotosText(bilder.length), datumText(daten.datum)]
      .filter(Boolean)
      .join(" · ");
    const kopf = el(
      "div",
      "fotos-kopf",
      zurueck,
      titel,
      el("p", "fotos-meta", meta),
    );
    // Nur wenn die Abteilung es will, und nur ein Link zu Flickr: Er führt aus der Website hinaus
    if (typeof daten.flickrUrl === "string" && FLICKR.test(daten.flickrUrl)) {
      const flickr = el("a", "btn s", "Album auf Flickr öffnen");
      flickr.href = daten.flickrUrl;
      flickr.target = "_blank";
      flickr.rel = "noopener noreferrer";
      kopf.append(flickr);
    }
    const raster = el("ul", "galerie fotos-raster");
    raster.setAttribute("role", "list");
    bilder.forEach((b, i) => {
      if (!KENNUNG.test(String(b.id))) return;
      const alt = b.titel
        ? String(b.titel)
        : `Foto ${i + 1} von ${bilder.length}`;
      const bild = el("img");
      bild.src = bildAdresse(id, b.id, "klein");
      bild.srcset = `${bildAdresse(id, b.id, "klein")} 320w, ${bildAdresse(id, b.id, "mittel")} 640w`;
      bild.sizes = "(max-width: 47.5em) 50vw, 14rem";
      bild.alt = alt;
      bild.width = Number(b.breite) || 4;
      bild.height = Number(b.hoehe) || 3;
      bild.loading = "lazy";
      bild.decoding = "async";
      const link = el("a", "bildgross", bild);
      link.href = bildAdresse(id, b.id, "gross");
      raster.append(el("li", "", el("figure", "", link)));
    });
    inhalt.replaceChildren(
      kopf,
      bilder.length > 0
        ? raster
        : zustand({
            symbolName: "bild",
            titel: "In diesem Album sind noch keine Fotos.",
          }),
    );
    document.title = rest
      ? `${titel.textContent} | ${rest}`
      : titel.textContent;
    sage(`${titel.textContent}, ${fotosText(bilder.length)}.`);
    titel.focus({ preventScroll: true });
    wurzel.scrollIntoView({ block: "start" });
  }

  function zeige() {
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
