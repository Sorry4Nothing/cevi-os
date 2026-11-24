import { ApiFehler, anfrage, fehlertext, hochladen } from "./api.js";
import { bildMitLader } from "./bildwahl.js";
import { chip, el, feld, knopf, neueId, tag } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { formularRaster } from "./formularraster.js";
import { sk } from "./lader.js";
import {
  band,
  beschaeftigt,
  bei,
  fenster,
  gesperrt,
  keinRecht,
  kuerze,
  loescheFeldFehler,
  uhrzeit,
  zeigeFeldFehler,
} from "./website-dialoge.js";
import { groesseText } from "./website-felder.js";
import { mitSymbol, symbol } from "./website-symbole.js";
import { zustandsKarte } from "./zustaende.js";
import { zuschneiden } from "./zuschneiden.js";

// Medienbibliothek (Boards E7 und E8): Raster der Bilder mit Alt-Text, Suche, Filter, Mehrfachauswahl, Hochladen, Beschreiben und Löschen.
// Die Bibliothek verwaltet nur Bilder. Dateien zum Herunterladen liegen im SharePoint und werden im Baustein «Datei zum Herunterladen» verknüpft (#428);
// ein altes PDF-Medium bleibt sichtbar und löschbar.
// Datenbanklast: eine Abfrage je Seite von SEITE Bildern (Seitenwechsel beim Scrollen), eine je Suche; kein Polling. Ein neues Bild steht ohne Neuladen vorn,
// ein gelöschtes fällt weg. Die Vorschau lädt das Bild über /api/v1/medien/<id> (öffentliche Bilder mit Cache-Kopfzeilen) erst, wenn es in die Nähe kommt (loading="lazy").
// Die Filter «Bilder», «Dateien» und «Alt-Text fehlt» wirken auf die geladenen Medien: Die API zählt nicht und filtert nicht.

const API = "/api/v1/redaktion/medien";
const SEITE = 24;
// Wie MEDIEN_BILD_MAX_BYTES und die Länge des Alt-Texts auf dem Server; er prüft es ohnehin
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ALT = 500;
const TYP_FEHLER =
  "Dieser Dateityp ist nicht erlaubt. Erlaubt sind Bilder (JPEG, PNG, WebP).";
const ALT_HILFE = `Beschreibe, was man sieht. Der Text hilft Menschen, die das Bild nicht sehen können. Höchstens ${MAX_ALT} Zeichen.`;
const ZIERDE = "Nur Zierde: Das Bild braucht keine Beschreibung";
const ALT_FEHLT = "Gib einen Alt-Text ein oder wähle «Nur Zierde».";

// Symbole der Ansichtswahl (eigene Zeichen im Raster der übrigen Symbole)
function ansichtSymbol(art) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const formen =
    art === "raster"
      ? [
          [4, 4, 7, 7],
          [13, 4, 7, 7],
          [4, 13, 7, 7],
          [13, 13, 7, 7],
        ]
      : [
          [4, 5, 16, 3],
          [4, 10.5, 16, 3],
          [4, 16, 16, 3],
        ];
  for (const [x, y, w, h] of formen) {
    const r = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, rx: 1.5 }))
      r.setAttribute(k, String(v));
    svg.append(r);
  }
  return svg;
}

const istBild = (m) => m.mimeTyp.startsWith("image/");

// Kurzer Name für Knöpfe und Rückfragen: Ein Bild hat keinen Dateinamen, also zählt seine Beschreibung
function kurzname(m) {
  const text = (m.altText ?? "").trim();
  if (text) return kuerze(text, 50);
  return `${istBild(m) ? "Bild" : "Datei"} vom ${tag(m.erstelltAm)}`;
}

function titelText(m) {
  if (m.altText) return m.altText;
  if (m.dekorativ) return "Nur Zierde, ohne Beschreibung";
  return istBild(m) ? "Ohne Beschreibung" : "PDF-Datei";
}

function altChip(m) {
  if (!istBild(m)) return chip("Wird nicht mehr ausgeliefert", "warn");
  if (m.dekorativ) return chip("Nur Zierde", undefined, "info");
  return m.altText
    ? chip("Alt-Text vorhanden", "ok")
    : chip("Alt-Text fehlt", "warn");
}

const sichtChip = (m) =>
  m.sichtbarkeit === "oeffentlich"
    ? chip("Öffentlich", undefined, "website")
    : chip("Nur angemeldet", undefined, "schild");

const metaText = (m) =>
  [
    groesseText(m.groesse),
    m.breite && `${m.breite} × ${m.hoehe} Pixel`,
    tag(m.erstelltAm),
  ]
    .filter(Boolean)
    .join(" · ");

// Der Typ ergibt sich aus den ersten Bytes, wie auf dem Server; die Endung sagt nichts
async function pruefeDatei(datei) {
  const b = new Uint8Array(await datei.slice(0, 12).arrayBuffer());
  const beginnt = (...bytes) => bytes.every((wert, i) => b[i] === wert);
  const jpeg = beginnt(0xff, 0xd8, 0xff);
  const png = beginnt(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  // «RIFF», vier Bytes Länge, «WEBP»
  const webp =
    beginnt(0x52, 0x49, 0x46, 0x46) &&
    [0x57, 0x45, 0x42, 0x50].every((wert, i) => b[8 + i] === wert);
  if (!jpeg && !png && !webp) return TYP_FEHLER;
  if (datei.size > MAX_BYTES) return "Die Datei ist zu gross. Höchstens 10 MB.";
  return "";
}

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      try {
        return await anfrage("GET", `${API}?limit=${SEITE}`);
      } catch (f) {
        if (f instanceof ApiFehler && f.status === 403)
          return { keinRecht: true };
        throw f;
      }
    },
    (erste) =>
      erste.keinRecht
        ? keinRecht(
            bereich,
            "Die Medien darfst du nicht verwalten. Wende dich an die Abteilungsleitung, wenn du Zugriff brauchst.",
          )
        : zeichne(bereich, ctx, erste),
    { skeleton: skeletonMedien },
  );
}

// Karten, die noch laden: Bild, Name, Chip und Grösse in der Form der echten Karte (G3 «Galerie / Medienraster»)
const skeletonKarten = (n) =>
  Array.from({ length: n }, () =>
    el(
      "li",
      { class: "medium ws-platzhalter", "aria-hidden": "true" },
      el("span", { class: "bild" }),
      sk("t", 136),
      sk("r", 112),
      sk("t", 48),
    ),
  );

// Das Raster, solange es lädt: Werkzeugzeile und Karten
function skeletonMedien() {
  return el(
    "div",
    { class: "sk-seitenliste ws-platzhalter" },
    el("div", { class: "werkzeuge" }, sk("r", 380), sk("r", 380)),
    el("ul", { class: "medien" }, skeletonKarten(8)),
  );
}

function zeichne(bereich, ctx, erste) {
  const verwalten = ctx.zugang.darf("medien.verwalten");
  // id -> { m, li, box, alt }
  const eintraege = new Map();
  const gewaehlt = new Set();
  let frage = "";
  let artFilter = "alle";
  let weitere = erste.weitere;
  // Zählt die Suchen: Die späte Antwort einer älteren Suche wird verworfen
  let lauf = 0;
  let laedt = false;
  let nachladeFehler = false;
  let timer = 0;
  let stand = new Date();

  const raster = el("ul", { class: "medien", "aria-label": "Medien" });
  const weiterText = el("p", { class: "klein leise", role: "status" });
  const leer = el("div", { hidden: true });
  const meldungsplatz = el("div", {});
  const auswahlPlatz = el("div", { class: "ws-auswahlplatz" });
  const mehr = knopf("Weitere Bilder laden", {
    klein: true,
    onclick: () => {
      nachladeFehler = false;
      meldungsplatz.replaceChildren();
      ladeWeitere();
    },
  });
  // Filterleiste (Suche im Alt-Text auf dem Server, Art und Sichtbarkeit auf den geladenen Medien) mit laufender Trefferzahl
  let sichtFilter = "alle";
  let letzteFrage = "";
  const leiste = filterleiste({
    suche: { label: "Alt-Text suchen" },
    filter: [
      {
        schluessel: "art",
        label: "Art",
        optionen: [
          ["alle", "Alle"],
          ["bilder", "Bilder"],
          ["dateien", "Dateien"],
          ["alt", "Alt-Text fehlt"],
        ],
      },
      {
        schluessel: "sicht",
        label: "Sichtbarkeit",
        optionen: [
          ["alle", "Alle"],
          ["oeffentlich", "Öffentlich"],
          ["angemeldet", "Nur angemeldet"],
        ],
      },
    ],
    namen: { einzahl: "Medium", mehrzahl: "Medien" },
    beiAenderung: ({ suche: begriff, filter: f }) => {
      artFilter = f.art;
      sichtFilter = f.sicht;
      // Die Suche läuft auf dem Server: kurz warten, bis das Tippen pausiert
      if (begriff !== letzteFrage) {
        letzteFrage = begriff;
        window.clearTimeout(timer);
        timer = setTimeout(neueSuche, 300);
      } else {
        zeigeZustand();
      }
    },
  });
  const sucheEingabe = () => leiste.wurzel.querySelector("input[type=search]");

  // Ansicht: Raster oder Liste (dieselben Karten, nur anders gelegt); die Verwaltung speichert nichts im Browser, jeder Besuch beginnt mit dem Raster
  let ansicht = "raster";
  const ansichtKnoepfe = [
    ["raster", "Raster"],
    ["liste", "Liste"],
  ].map(([wert, text]) =>
    el(
      "button",
      {
        type: "button",
        class: "ws-ansicht-knopf",
        "aria-pressed": String(ansicht === wert),
        onclick: () => setzeAnsicht(wert),
      },
      ansichtSymbol(wert),
      text,
    ),
  );
  function setzeAnsicht(wert) {
    ansicht = wert;
    ansichtKnoepfe.forEach((k, i) =>
      k.setAttribute("aria-pressed", String(["raster", "liste"][i] === wert)),
    );
    raster.classList.toggle("medien--liste", wert === "liste");
  }
  raster.classList.toggle("medien--liste", ansicht === "liste");
  const werkzeuge = el(
    "div",
    { class: "ws-werkzeuge" },
    leiste.wurzel,
    el(
      "div",
      { class: "ws-ansicht", role: "group", "aria-label": "Ansicht" },
      ansichtKnoepfe,
    ),
  );

  const passt = (m) =>
    (artFilter === "alle" ||
      (artFilter === "bilder" && istBild(m)) ||
      (artFilter === "dateien" && !istBild(m)) ||
      (artFilter === "alt" &&
        istBild(m) &&
        !m.dekorativ &&
        !(m.altText ?? "").trim())) &&
    (sichtFilter === "alle" ||
      (sichtFilter === "oeffentlich") === (m.sichtbarkeit === "oeffentlich"));

  function zeigeZustand() {
    const n = eintraege.size;
    let sichtbar = 0;
    for (const e of eintraege.values()) {
      e.li.hidden = !passt(e.m);
      if (!e.li.hidden) sichtbar++;
    }
    const gefiltert =
      frage.trim() || artFilter !== "alle" || sichtFilter !== "alle";
    werkzeuge.hidden = n === 0 && !frage.trim() && !gefiltert;
    leiste.setzeTreffer(sichtbar, n);
    weiterText.textContent = weitere
      ? "Weitere Medien folgen beim Scrollen."
      : "";
    leer.hidden = sichtbar > 0;
    leer.replaceChildren();
    raster.hidden = sichtbar === 0;
    if (sichtbar === 0) {
      const text =
        n === 0 && !gefiltert
          ? zustandsKarte(
              {
                titel: "Noch keine Bilder.",
                text: "Lade das erste Bild hoch. Den Alt-Text gibst du dabei ein.",
              },
              [knopf("Hochladen", { onclick: hochladenDialog })],
            )
          : zustandsKarte(
              {
                titel: frage.trim()
                  ? `Nichts passt zu «${kuerze(frage.trim(), 40)}».`
                  : "Nichts passt zum Filter.",
                text: "Prüfe die Schreibweise oder setze den Filter zurück.",
              },
              [
                knopf("Filter zurücksetzen", {
                  onclick: () => {
                    leiste.setzeAlles();
                    sucheEingabe()?.focus();
                  },
                }),
              ],
            );
      text.wurzel.setAttribute("role", "status");
      leer.append(text.wurzel);
    }
    mehr.hidden = !weitere;
    zeichneAuswahl();
  }

  // Auswahlleiste: bleibt am unteren Rand sichtbar, solange etwas gewählt ist
  function waehleAlle(an) {
    for (const e of eintraege.values()) {
      if (!e.box || e.li.hidden) continue;
      e.box.checked = an;
      e.li.classList.toggle("gewaehlt", an);
      if (an) gewaehlt.add(e.m.id);
      else gewaehlt.delete(e.m.id);
    }
    zeichneAuswahl();
  }
  function zeichneAuswahl() {
    if (gewaehlt.size === 0) {
      auswahlPlatz.replaceChildren();
      return;
    }
    // Neu zeichnen nur, wenn es die Leiste noch nicht gibt; sonst ändert sich nur die Zahl (der Fokus bleibt)
    const vorhanden = auswahlPlatz.querySelector(".ws-auswahlzahl");
    if (vorhanden) {
      vorhanden.textContent = `${gewaehlt.size} gewählt`;
      return;
    }
    auswahlPlatz.replaceChildren(
      el(
        "div",
        {
          class: "ws-auswahlleiste",
          role: "region",
          "aria-label": "Auswahl",
        },
        el(
          "span",
          { class: "ws-auswahlzahl", role: "status" },
          `${gewaehlt.size} gewählt`,
        ),
        knopf("Alle wählen", {
          klein: true,
          onclick: () => waehleAlle(true),
        }),
        knopf("Löschen", {
          klein: true,
          art: "gefahr",
          symbol: "papierkorb",
          onclick: () => loescheAuswahl(),
        }),
        knopf("Auswahl aufheben", {
          klein: true,
          onclick: () => {
            waehleAlle(false);
            gewaehlt.clear();
            zeichneAuswahl();
            sucheEingabe()?.focus();
          },
        }),
      ),
    );
  }

  function karte(m) {
    const kontext = kurzname(m);
    const bild = istBild(m);
    // Ein ruhiger Platzhalter steht, bis das Bild da ist; fehlt die Datei, steht ein Wort an seiner Stelle
    const vorschau = bild
      ? bildMitLader(
          el("img", {
            src: m.url,
            alt: "",
            width: m.breite,
            height: m.hoehe,
            loading: "lazy",
            decoding: "async",
          }),
          "bild",
        )
      : el("div", { class: "bild" }, el("span", { class: "ws-ohne" }, "PDF"));
    const box = verwalten
      ? el("input", {
          type: "checkbox",
          "aria-label": `Auswählen: ${kontext}`,
          onchange: () => {
            if (box.checked) gewaehlt.add(m.id);
            else gewaehlt.delete(m.id);
            li.classList.toggle("gewaehlt", box.checked);
            zeichneAuswahl();
          },
        })
      : null;
    const alt =
      bild && verwalten
        ? knopf("Alt-Text ändern", {
            klein: true,
            class: "knopf knopf--klein ws-alt",
            symbol: "bearbeiten",
            kontext,
            onclick: () => aendereDialog(m),
          })
        : null;
    const li = el(
      "li",
      { class: "medium", tabindex: "-1" },
      box && el("div", { class: "wahl" }, box),
      vorschau,
      el("p", { class: "name ws-medienname" }, titelText(m)),
      el("ul", { class: "chips" }, altChip(m), sichtChip(m)),
      el("p", { class: "klein leise ws-meta" }, metaText(m)),
      !bild &&
        el(
          "p",
          { class: "hilfe" },
          "Dateien zum Herunterladen verknüpfst du im Baustein «Datei zum Herunterladen» mit dem SharePoint. Dieses alte PDF kannst du nur löschen.",
        ),
      alt,
    );
    return { m, li, box, alt };
  }

  function anhaengen(m, vorn = false) {
    if (eintraege.has(m.id)) return;
    const k = karte(m);
    eintraege.set(m.id, k);
    if (vorn) raster.prepend(k.li);
    else raster.append(k.li);
  }

  function ersetze(daten) {
    raster.replaceChildren();
    eintraege.clear();
    gewaehlt.clear();
    daten.medien.forEach((m) => anhaengen(m));
    weitere = daten.weitere;
    nachladeFehler = false;
    stand = new Date();
    meldungsplatz.replaceChildren();
    zeigeZustand();
    beobachte();
  }

  const hole = (offset) => {
    const q = new URLSearchParams({ limit: SEITE, offset });
    if (frage.trim()) q.set("suche", frage.trim());
    return anfrage("GET", `${API}?${q}`);
  };

  // Fehler beim Nachladen oder Suchen: sichtbar, mit «Nochmals versuchen»; das Raster bleibt, wie es ist
  function zeigeFehler(f, nochmalsFn) {
    meldungsplatz.replaceChildren(
      band(
        "warn",
        f?.status === 0
          ? `Keine Verbindung. Die Liste zeigt den Stand von ${uhrzeit.format(stand)}. Hochladen geht wieder, sobald du online bist.`
          : fehlertext(f),
        knopf("Nochmals versuchen", {
          klein: true,
          onclick: () => {
            meldungsplatz.replaceChildren();
            nochmalsFn();
          },
        }),
      ),
    );
  }

  async function neueSuche() {
    if (!raster.isConnected) return;
    const mein = ++lauf;
    frage = leiste.stand().suche;
    meldungsplatz.replaceChildren();
    raster.setAttribute("aria-busy", "true");
    // Karten, die noch laden, statt einer leeren oder alten Liste
    raster.hidden = false;
    leer.hidden = true;
    raster.replaceChildren(...skeletonKarten(8));
    weiterText.textContent = "Suche läuft …";
    try {
      const daten = await hole(0);
      if (mein !== lauf) return;
      ersetze(daten);
    } catch (f) {
      if (mein !== lauf) return;
      raster.replaceChildren(...[...eintraege.values()].map((e) => e.li));
      zeigeZustand();
      zeigeFehler(f, neueSuche);
    } finally {
      if (mein === lauf) raster.removeAttribute("aria-busy");
    }
  }

  async function ladeWeitere() {
    if (laedt || !weitere || !raster.isConnected) return;
    laedt = true;
    const mein = lauf;
    mehr.disabled = true;
    raster.setAttribute("aria-busy", "true");
    const platzhalter = skeletonKarten(4);
    raster.append(...platzhalter);
    try {
      // Der Versatz ist die Zahl der geladenen Bilder: Ein neues oder gelöschtes Bild ändert ihn hier im Gleichschritt mit dem Server
      const daten = await hole(eintraege.size);
      if (mein !== lauf) return;
      daten.medien.forEach((m) => anhaengen(m));
      weitere = daten.weitere;
      stand = new Date();
      zeigeZustand();
    } catch (f) {
      if (mein !== lauf) return;
      // Der Beobachter löste sonst sofort wieder aus; weiter geht es nur über «Nochmals versuchen»
      nachladeFehler = true;
      zeigeFehler(f, () => {
        nachladeFehler = false;
        ladeWeitere();
      });
    } finally {
      for (const p of platzhalter) p.remove();
      laedt = false;
      mehr.disabled = false;
      if (mein === lauf) {
        raster.removeAttribute("aria-busy");
        beobachte();
      }
    }
  }

  // Der Knopf «Weitere Bilder laden» löst sich selbst aus, sobald er in die Nähe kommt; er bleibt als Weg für Tastatur und Screenreader
  const beobachter =
    "IntersectionObserver" in window
      ? new window.IntersectionObserver(
          (e) => {
            if (!raster.isConnected) return beobachter.disconnect();
            if (!nachladeFehler && e.some((x) => x.isIntersecting))
              ladeWeitere();
          },
          { rootMargin: "600px" },
        )
      : null;
  // Neu beobachten, damit ein Knopf, der nach dem Laden noch im Bereich liegt, sofort wieder auslöst
  function beobachte() {
    if (!beobachter) return;
    beobachter.unobserve(mehr);
    if (weitere) beobachter.observe(mehr);
  }

  function entferne(id) {
    eintraege.get(id)?.li.remove();
    eintraege.delete(id);
    gewaehlt.delete(id);
  }

  function fokusiere(id) {
    const li = eintraege.get(id)?.li;
    li?.focus();
    li?.scrollIntoView({ block: "nearest" });
  }

  // Alt-Text ändern (Abteilungsleitung und wer Medien verwalten darf)
  function aendereDialog(m) {
    const zierde = el("input", { type: "checkbox", id: neueId("zierde") });
    zierde.checked = m.dekorativ;
    const alt = feld({
      label: "Alt-Text (Pflicht)",
      mehrzeilig: true,
      wert: m.altText ?? "",
      maxlength: MAX_ALT,
      rows: 4,
      "aria-required": "true",
      hilfe: ALT_HILFE,
    });
    const schalte = () => {
      alt.wurzel.hidden = zierde.checked;
      loescheFeldFehler(alt.wurzel);
    };
    zierde.addEventListener("change", schalte);
    schalte();
    alt.eingabe.addEventListener("input", () => loescheFeldFehler(alt.wurzel));
    const abbrechen = knopf("Abbrechen", { onclick: () => f.schliesse() });
    const speichern = knopf("Speichern", { art: "haupt" });
    let neu = null;
    bei(speichern, async () => {
      f.fehler(null);
      if (!zierde.checked && alt.eingabe.value.trim() === "") {
        zeigeFeldFehler(alt.wurzel, alt.eingabe, ALT_FEHLT);
        alt.eingabe.focus();
        return;
      }
      beschaeftigt(speichern, true);
      abbrechen.disabled = true;
      try {
        neu = await anfrage(
          "PATCH",
          `${API}/${m.id}`,
          zierde.checked
            ? { dekorativ: true }
            : { altText: alt.eingabe.value.trim() },
        );
        f.dialog.addEventListener(
          "close",
          () => {
            const alte = eintraege.get(m.id);
            if (!alte) return;
            const k = karte(neu);
            alte.li.replaceWith(k.li);
            eintraege.set(m.id, k);
            if (gewaehlt.has(m.id)) {
              k.box.checked = true;
              k.li.classList.add("gewaehlt");
            }
            ctx.melde(
              neu.dekorativ
                ? "Das Bild ist als Zierde markiert."
                : "Der Alt-Text ist gespeichert.",
              "ok",
            );
            zeigeZustand();
            k.alt?.focus();
          },
          { once: true },
        );
        f.schliesse();
      } catch (fehler) {
        f.fehler(
          fehler?.status === 403
            ? "Dafür fehlt die Berechtigung. Den Alt-Text ändert, wer Medien verwalten darf."
            : fehlertext(fehler),
        );
        beschaeftigt(speichern, false);
        abbrechen.disabled = false;
      }
    });
    // Zwei Spalten: links der Text, rechts das Bild gross, damit man beschreibt, was man sieht
    const f = fenster({
      titel: "Alt-Text ändern",
      beschreibung: `Für «${kurzname(m)}».`,
      breit: true,
      inhalt: [
        formularRaster({
          felder: [
            alt.wurzel,
            el(
              "div",
              { class: "wahl" },
              zierde,
              el("label", { for: zierde.id }, ZIERDE),
            ),
          ],
          seiteTitel: "Das Bild",
          seite: [
            bildMitLader(
              el("img", {
                src: m.url,
                alt: m.altText ?? "",
                width: m.breite,
                height: m.hoehe,
                decoding: "async",
              }),
              "ws-altbild",
            ),
            el("ul", { class: "chips" }, altChip(m), sichtChip(m)),
            el("p", { class: "klein leise" }, metaText(m)),
          ],
        }),
      ],
      fuss: [abbrechen, speichern],
    });
  }

  // Löschen einer Auswahl: nacheinander, damit jede Antwort für sich zählt. Ein Bild, das noch in Seiten steht, bleibt (409).
  // Mit «Rückgängig» (#578): Die Kacheln verschwinden sofort, gelöscht wird nach der Frist; was bleibt, kommt mit einer Meldung zurück
  function loescheAuswahl() {
    const ms = [...gewaehlt].map((id) => eintraege.get(id)?.m).filter(Boolean);
    if (ms.length === 0) return;
    const einzeln = ms.length === 1;
    const zeige = (m, sichtbar) => {
      const e = eintraege.get(m.id);
      if (e) e.li.hidden = !sichtbar;
    };
    ctx.mitRueckgaengig({
      text: einzeln
        ? `«${kurzname(ms[0])}» gelöscht. Steht es noch in einer Seite, bleibt es erhalten`
        : `${ms.length} Medien gelöscht. Was noch in einer Seite steht, bleibt erhalten`,
      ansicht: {
        weg: () => ms.forEach((m) => zeige(m, false)),
        zurueck: () => ms.forEach((m) => zeige(m, true)),
      },
      ausfuehren: async () => {
        const weg = [];
        const bleibt = [];
        for (const m of ms) {
          try {
            await anfrage("DELETE", `${API}/${m.id}`);
            weg.push(m);
          } catch (f) {
            // Bei einem Netzfehler oder 5xx hört es auf: Der Rest bleibt gewählt
            if (f?.code === "MEDIUM_VERWENDET")
              bleibt.push({ m, seiten: Number(f.seiten) });
            else if (weg.length + bleibt.length === 0) throw f;
            else {
              bleibt.push({ m, fehler: f });
              break;
            }
          }
        }
        // Was nicht gelöscht ist, steht wieder da
        for (const m of ms) if (!weg.includes(m)) zeige(m, true);
        return { weg, bleibt };
      },
      fehlertext: (f) =>
        f?.status === 403
          ? "Medien löschen nur die Abteilungsleitung und wer Medien verwalten darf."
          : fehlertext(f),
      danach: ({ weg, bleibt }) => {
        for (const m of weg) entferne(m.id);
        zeigeZustand();
        for (const b of bleibt) {
          const seiten =
            b.seiten === 1
              ? "1 Seite"
              : `${b.seiten > 0 ? b.seiten : "mehreren"} Seiten`;
          ctx.melde(
            b.fehler
              ? `«${kurzname(b.m)}» konnte nicht gelöscht werden. ${fehlertext(b.fehler)}`
              : `«${kurzname(b.m)}» steht noch in ${seiten} (im Entwurf oder in einer früheren Version). Entferne es dort zuerst, dann kannst du es löschen.`,
            "fehler",
          );
        }
      },
    });
  }

  // Hochladen (E8): Datei wählen oder ablegen, Alt-Text (Pflicht), Sichtbarkeit; die Schaltfläche nennt den Grund, solange etwas fehlt
  function hochladenDialog() {
    let gewaehltDatei = null;
    let steuerung = null;
    let neues = null;
    let stufe = -1;
    let laeuft = false;
    const dateiEingabe = el("input", {
      type: "file",
      accept: "image/jpeg,image/png,image/webp",
      class: "nur-leser",
      tabindex: "-1",
      "aria-hidden": "true",
    });
    const dateiKnopf = knopf("Datei wählen", {
      klein: true,
      onclick: () => dateiEingabe.click(),
    });
    const zoneKopf = el("p", { class: "fett" }, "Datei hierher ziehen");
    const zone = el(
      "div",
      { class: "dropzone" },
      zoneKopf,
      el("p", { class: "klein leise" }, "oder"),
      dateiKnopf,
      el(
        "p",
        { class: "hilfe" },
        "Bilder (JPG, PNG, WebP), höchstens 10 MB. Du kannst sie vor dem Hochladen zuschneiden. Bilder werden automatisch verkleinert.",
      ),
    );
    const gewaehlteBox = el("div", { hidden: true });
    const meldung = el("div", {});
    // Rechts: das gewählte Bild gross
    const leerVorschau = () =>
      el(
        "p",
        { class: "ws-vorschau-leer" },
        "Hier erscheint das Bild, sobald du eine Datei gewählt hast.",
      );
    const vorschauPlatz = el("div", { class: "ws-vorschau" }, leerVorschau());
    const alt = feld({
      label: "Alt-Text (Pflicht)",
      mehrzeilig: true,
      maxlength: MAX_ALT,
      rows: 3,
      "aria-required": "true",
      hilfe: "Beschreibe, was man sieht.",
    });
    const zierde = el("input", { type: "checkbox", id: neueId("zierde") });
    const zierdeWurzel = el(
      "div",
      { class: "wahl" },
      zierde,
      el("label", { for: zierde.id }, ZIERDE),
    );
    // Sichtbarkeit: Der Server verlangt sie, und sie lässt sich später nicht ändern
    const sName = neueId("sichtbarkeit");
    const sichtLegende = el(
      "legend",
      { class: "legende" },
      "Wer darf das Bild sehen?",
    );
    const sEintraege = [
      ["oeffentlich", "Öffentlich"],
      ["angemeldet", "Nur angemeldet"],
    ].map(([w, t]) => {
      const id = neueId("sichtbarkeit-option");
      return [
        el("input", {
          type: "radio",
          id,
          name: sName,
          value: w,
          onchange: pruefeBereit,
        }),
        el("label", { for: id }, symbol("haken"), t),
      ];
    });
    const sichtbarkeit = el(
      "fieldset",
      { class: "feld ws-sichtbarkeitwahl" },
      sichtLegende,
      el("div", { class: "seg" }, sEintraege.flat()),
      el(
        "p",
        { class: "hilfe" },
        "«Öffentlich»: Das Bild darf auf öffentlichen Seiten stehen und ist ohne Anmeldung abrufbar. «Nur angemeldet»: nur für Personen mit Konto. Das lässt sich später nicht ändern.",
      ),
    );
    const sichtWert = () =>
      sEintraege.find(([e]) => e.checked)?.[0].value ?? null;
    const fortschrittPlatz = el("div", { hidden: true });
    const abbrechen = knopf("Abbrechen", { onclick: () => f.schliesse() });
    const hochKnopf = knopf("Hochladen", { art: "haupt" });
    const grund = el("span", { class: "mini leise" });
    const hochSpalte = el("span", { class: "ws-fussspalte" }, hochKnopf, grund);

    function pruefeBereit() {
      if (laeuft) return;
      const fehlt = !gewaehltDatei
        ? "Wähle zuerst eine Datei."
        : !zierde.checked && alt.eingabe.value.trim() === ""
          ? "Gib zuerst einen Alt-Text ein."
          : sichtWert() === null
            ? "Wähle zuerst, wer das Bild sehen darf."
            : "";
      gesperrt(hochKnopf, Boolean(fehlt));
      grund.textContent = fehlt;
    }

    zierde.addEventListener("change", () => {
      alt.wurzel.hidden = zierde.checked;
      loescheFeldFehler(alt.wurzel);
      pruefeBereit();
    });
    alt.eingabe.addEventListener("input", () => {
      loescheFeldFehler(alt.wurzel);
      pruefeBereit();
    });

    async function waehle(d) {
      meldung.replaceChildren();
      gewaehlteBox.hidden = true;
      gewaehlteBox.replaceChildren();
      gewaehltDatei = null;
      vorschauPlatz.replaceChildren(leerVorschau());
      if (!d) return pruefeBereit();
      const problem = await pruefeDatei(d);
      const art = d.type.replace("image/", "").toUpperCase() || "Datei";
      if (problem) {
        // Datei zeigen und den Grund; gewählt ist sie nicht
        gewaehlteBox.append(dateiZeile(d, art));
        gewaehlteBox.hidden = false;
        meldung.replaceChildren(band("fehler", problem));
        zone.hidden = false;
        pruefeBereit();
        grund.textContent = "Wähle eine andere Datei.";
        gesperrt(hochKnopf, true);
        return;
      }
      // Zuschneiden (#633): eine Seite im Fluss; «Original verwenden» lässt die Datei, wie sie ist. Abbrechen heisst: nichts gewählt.
      try {
        const ergebnis = await zuschneiden({
          datei: d,
          beschreibung:
            "Schneide das Bild zu, bevor du es hochlädst, oder nimm es, wie es ist.",
          maxSeite: 2048,
          maxBytes: MAX_BYTES,
          ok: "Zuschneiden und übernehmen",
        });
        if (!ergebnis) {
          zone.hidden = false;
          pruefeBereit();
          return;
        }
        d = ergebnis.datei;
      } catch (fehl) {
        meldung.replaceChildren(band("fehler", fehl.message));
        zone.hidden = false;
        pruefeBereit();
        gesperrt(hochKnopf, true);
        grund.textContent = "Wähle eine andere Datei.";
        return;
      }
      // Vorschau über eine Leinwand: Die CSP erlaubt keine blob:-Adressen. Das Lesen zeigt nebenbei, ob sich das Bild öffnen lässt.
      let leinwand;
      try {
        const bild = await window.createImageBitmap(d);
        leinwand = el("canvas", {
          role: "img",
          "aria-label": "Vorschau des gewählten Bildes",
          class: "ws-leinwand",
        });
        const faktor = Math.min(1, 640 / bild.width);
        leinwand.width = Math.round(bild.width * faktor);
        leinwand.height = Math.round(bild.height * faktor);
        leinwand
          .getContext("2d")
          .drawImage(bild, 0, 0, leinwand.width, leinwand.height);
        bild.close();
      } catch {
        meldung.replaceChildren(
          band(
            "fehler",
            "Dieses Bild lässt sich nicht lesen. Wähle ein anderes.",
          ),
        );
        pruefeBereit();
        gesperrt(hochKnopf, true);
        grund.textContent = "Wähle eine andere Datei.";
        return;
      }
      gewaehltDatei = d;
      vorschauPlatz.replaceChildren(leinwand);
      gewaehlteBox.append(dateiZeile(d, art));
      gewaehlteBox.hidden = false;
      zone.hidden = true;
      pruefeBereit();
      alt.eingabe.focus();
    }
    const dateiZeile = (d, art) =>
      el(
        "div",
        { class: "medium ws-gewaehlt" },
        el(
          "div",
          {},
          el("p", { class: "name" }, d.name),
          el("p", { class: "klein leise" }, `${art}, ${groesseText(d.size)}`),
          knopf("Andere Datei wählen", {
            klein: true,
            onclick: () => {
              zone.hidden = false;
              gewaehlteBox.hidden = true;
              dateiEingabe.click();
            },
          }),
        ),
      );
    dateiEingabe.addEventListener("change", () =>
      waehle(dateiEingabe.files[0]),
    );
    // Ablegen auf die Fläche
    const ueber = (an) => (e) => {
      e.preventDefault();
      zone.classList.toggle("ueberflaeche", an);
      zoneKopf.textContent = an
        ? "Loslassen zum Hochladen"
        : "Datei hierher ziehen";
    };
    zone.addEventListener("dragenter", ueber(true));
    zone.addEventListener("dragover", ueber(true));
    zone.addEventListener("dragleave", ueber(false));
    zone.addEventListener("drop", (e) => {
      ueber(false)(e);
      waehle(e.dataTransfer?.files?.[0]);
    });

    function beiFortschritt(anteil) {
      const p = Math.round(anteil * 100);
      const balken = fortschrittPlatz.querySelector(".fortschritt > span");
      const text = fortschrittPlatz.querySelector(".ws-prozent");
      const bytes = fortschrittPlatz.querySelector(".ws-bytes");
      const ansage = fortschrittPlatz.querySelector(".nur-leser");
      balken.className = `ws-p${Math.min(100, Math.round(p / 5) * 5)}`;
      fortschrittPlatz
        .querySelector(".fortschritt")
        .setAttribute("aria-valuenow", String(p));
      bytes.textContent = `${groesseText(gewaehltDatei.size * anteil)} von ${groesseText(gewaehltDatei.size)}`;
      if (p >= 100) {
        text.textContent = "Bild wird verarbeitet …";
        if (stufe < 100) ansage.textContent = "Bild wird verarbeitet …";
        stufe = 100;
        return;
      }
      text.textContent = `Lade hoch … ${p} %`;
      // Screenreader hören nur die Stufen, nicht jedes Prozent
      const neueStufe = Math.floor(p / 25) * 25;
      if (neueStufe > stufe) {
        stufe = neueStufe;
        ansage.textContent =
          neueStufe === 0 ? "Lade hoch …" : `Lade hoch … ${neueStufe} %`;
      }
    }

    bei(hochKnopf, async () => {
      meldung.replaceChildren();
      f.fehler(null);
      const q = new URLSearchParams({ sichtbarkeit: sichtWert() });
      if (zierde.checked) q.set("dekorativ", "true");
      else q.set("altText", alt.eingabe.value.trim());
      steuerung = new window.AbortController();
      stufe = -1;
      laeuft = true;
      beschaeftigt(hochKnopf, true);
      grund.textContent = "";
      fortschrittPlatz.hidden = false;
      fortschrittPlatz.replaceChildren(
        el(
          "div",
          { class: "ws-fortschritt-feld", role: "status" },
          el("p", { class: "fett ws-prozent" }, "Lade hoch …"),
          el(
            "div",
            {
              class: "fortschritt",
              role: "progressbar",
              "aria-label": "Hochladen",
              "aria-valuemin": "0",
              "aria-valuemax": "100",
              "aria-valuenow": "0",
            },
            el("span", { class: "ws-p0" }),
          ),
          el("p", { class: "klein leise ws-bytes" }),
          el("p", { class: "nur-leser" }),
          knopf("Hochladen abbrechen", {
            klein: true,
            onclick: () => steuerung?.abort(),
          }),
        ),
      );
      beiFortschritt(0);
      try {
        neues = await hochladen(`${API}?${q}`, gewaehltDatei, {
          beiFortschritt,
          signal: steuerung.signal,
        });
        const name = gewaehltDatei.name;
        f.dialog.addEventListener("close", () => nachHochladen(neues, name), {
          once: true,
        });
        f.schliesse();
      } catch (fehler) {
        laeuft = false;
        fortschrittPlatz.hidden = true;
        fortschrittPlatz.replaceChildren();
        beschaeftigt(hochKnopf, false);
        hochKnopf.lastChild.textContent = "Nochmals versuchen";
        if (fehler?.name === "AbortError") {
          f.fehler("Das Hochladen wurde abgebrochen.");
        } else {
          const gr = {
            ZU_GROSS: "Das Bild ist zu gross. Höchstens 10 MB.",
            MEDIEN_FORMAT: TYP_FEHLER,
            ALT_TEXT: ALT_FEHLT,
          }[fehler?.code];
          f.fehler(
            gr
              ? `Das Hochladen hat nicht geklappt. ${gr}`
              : fehler?.status === 0
                ? "Das Hochladen hat nicht geklappt. Prüfe die Verbindung. Datei und Alt-Text sind noch da."
                : `Das Hochladen hat nicht geklappt. ${fehlertext(fehler)} Datei und Alt-Text sind noch da.`,
          );
        }
      } finally {
        steuerung = null;
      }
    });

    const f = fenster({
      titel: "Medien hochladen",
      breit: true,
      inhalt: [
        dateiEingabe,
        formularRaster({
          felder: [
            zone,
            gewaehlteBox,
            meldung,
            alt.wurzel,
            zierdeWurzel,
            sichtbarkeit,
            fortschrittPlatz,
          ],
          seiteTitel: "Vorschau",
          seite: vorschauPlatz,
        }),
      ],
      fuss: [abbrechen, hochSpalte],
    });
    // Schliesst man das Fenster mitten im Hochladen (Escape), bricht auch die Anfrage ab
    f.dialog.addEventListener("close", () => steuerung?.abort());
    pruefeBereit();
  }

  // Nach dem Hochladen: Eine Suche, zu der das neue Bild nicht passt, versteckte es: zurück zur ganzen Liste
  async function nachHochladen(m, name) {
    if (frage.trim() || artFilter !== "alle" || sichtFilter !== "alle") {
      leiste.setzeAlles();
      letzteFrage = "";
      window.clearTimeout(timer);
      frage = "";
      artFilter = "alle";
      sichtFilter = "alle";
      const mein = ++lauf;
      try {
        const daten = await hole(0);
        if (mein === lauf) ersetze(daten);
      } catch {
        ersetze({ medien: [], weitere: true });
      }
    }
    anhaengen(m, true);
    zeigeZustand();
    ctx.melde(
      `«${name}» ist hochgeladen und hat ${m.dekorativ ? "keinen Alt-Text (Zierde)" : "einen Alt-Text"}.`,
      "ok",
    );
    fokusiere(m.id);
  }

  ctx.kopfAktion(
    mitSymbol(
      knopf("Hochladen", { art: "haupt", onclick: hochladenDialog }),
      "hochladen",
    ),
  );
  erste.medien.forEach((m) => anhaengen(m));
  zeigeZustand();
  bereich.append(
    werkzeuge,
    meldungsplatz,
    leer,
    raster,
    el("div", { class: "ws-medienfuss" }, weiterText, mehr),
    auswahlPlatz,
  );
  beobachte();
}
