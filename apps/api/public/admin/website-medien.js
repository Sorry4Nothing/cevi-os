import { anfrage, fehlertext, hochladen } from "./api.js";
import {
  ankreuzen,
  chip,
  dialogFormular,
  el,
  feld,
  icon,
  knopf,
  neueId,
  tag,
} from "./dom.js";

// Medienbibliothek (#359): Raster der Bilder mit Alt-Text, Suche, Hochladen, Beschreiben und Löschen. Schnittstelle zum Bereich: siehe website.js.
// Die Bibliothek verwaltet nur Bilder. Dateien zum Herunterladen liegen im SharePoint und werden im Baustein «Datei» verknüpft (#428); ein altes PDF-Medium bleibt sichtbar und löschbar.
// Datenbanklast: eine Abfrage je Seite von SEITE Bildern (Seitenwechsel beim Scrollen), eine je Suche; kein Polling. Ein neues Bild steht ohne Neuladen vorn, ein gelöschtes fällt weg. Die Vorschau lädt das Bild über /api/v1/medien/<id> (öffentliche Bilder mit Cache-Kopfzeilen) erst, wenn es in die Nähe kommt (loading="lazy").

const API = "/api/v1/redaktion/medien";
const SEITE = 24;
// Wie MEDIEN_BILD_MAX_BYTES und die Länge des Alt-Texts auf dem Server; er prüft es ohnehin
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ALT = 500;
const TYP_FEHLER =
  "Dieser Dateityp ist nicht erlaubt. Erlaubt sind JPEG, PNG und WebP.";
const ALT_HILFE = `Beschreibe, was man sieht. Der Text hilft Menschen, die das Bild nicht sehen können. Höchstens ${MAX_ALT} Zeichen.`;
const ZIERDE = "Nur Zierde: Das Bild braucht keine Beschreibung";
const ALT_FEHLT = "Beschreibe das Bild oder wähle «Nur Zierde».";

const zahl = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });
const groesseText = (bytes) =>
  bytes < 1024 * 1024
    ? `${zahl.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${zahl.format(bytes / (1024 * 1024))} MB`;
const istBild = (m) => m.mimeTyp.startsWith("image/");
const anzahlBilder = (n) => (n === 1 ? "1 Bild" : `${n} Bilder`);

// Kurzer Name für Knöpfe und Rückfragen: Ein Bild hat keinen Dateinamen, also zählt seine Beschreibung
function kurzname(m) {
  const text = (m.altText ?? "").trim();
  if (text) return text.length > 50 ? `${text.slice(0, 50)}…` : text;
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
    ? chip("Alt-Text vorhanden: ja", "ok")
    : chip("Alt-Text vorhanden: nein", "warn");
}

// Meldung beim Feld (nicht nur im Dialog); sie verschwindet, sobald man das Feld ändert
function feldFehler(f, text, { fokus = true } = {}) {
  entferneFeldFehler(f);
  const meldung = el(
    "p",
    { class: "feld-fehler", id: neueId("fehler"), role: "alert" },
    text,
  );
  f.wurzel.append(meldung);
  f.eingabe.setAttribute("aria-invalid", "true");
  f.eingabe.setAttribute(
    "aria-describedby",
    [f.eingabe.getAttribute("aria-describedby"), meldung.id]
      .filter(Boolean)
      .join(" "),
  );
  if (fokus) f.eingabe.focus();
}

function entferneFeldFehler(f) {
  const meldung = f.wurzel.querySelector(".feld-fehler");
  if (!meldung) return;
  f.eingabe.removeAttribute("aria-invalid");
  const rest = (f.eingabe.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id && id !== meldung.id);
  if (rest.length > 0) {
    f.eingabe.setAttribute("aria-describedby", rest.join(" "));
  } else {
    f.eingabe.removeAttribute("aria-describedby");
  }
  meldung.remove();
}

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

// Radioknöpfe als Segment, wie bei der Seitenliste; ohne Vorgabe, damit die Wahl bewusst fällt
function sichtbarkeitWahl() {
  const name = neueId("sichtbarkeit");
  const eintraege = [
    ["oeffentlich", "Öffentlich"],
    ["angemeldet", "Nur angemeldet"],
  ].map(([wert, text]) => {
    const id = neueId("sichtbarkeit-option");
    return {
      eingabe: el("input", { type: "radio", id, name, value: wert }),
      label: el("label", { for: id }, icon("haken"), text),
    };
  });
  const wurzel = el(
    "fieldset",
    {},
    el("legend", {}, "Wer darf das Bild sehen?"),
    el(
      "div",
      { class: "seg" },
      eintraege.flatMap((e) => [e.eingabe, e.label]),
    ),
    el(
      "p",
      { class: "hilfe" },
      "«Öffentlich»: Das Bild darf auf öffentlichen Seiten stehen und ist ohne Anmeldung abrufbar. «Nur angemeldet»: nur für Personen mit Konto, nicht auf öffentlichen Seiten. Das lässt sich später nicht ändern.",
    ),
  );
  return {
    wurzel,
    eingabe: eintraege[0].eingabe,
    wert: () => eintraege.find((e) => e.eingabe.checked)?.eingabe.value ?? null,
  };
}

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", `${API}?limit=${SEITE}`),
    (erste) => zeichne(bereich, ctx, erste),
  );
}

function zeichne(bereich, ctx, erste) {
  // id -> { m, li, alt, loeschen }
  const eintraege = new Map();
  let frage = "";
  let weitere = erste.weitere;
  // Zählt die Suchen: Die späte Antwort einer älteren Suche wird verworfen
  let lauf = 0;
  let laedt = false;
  let nachladeFehler = false;
  let timer = 0;

  const raster = el("ul", {
    class: "ws-medien-raster",
    role: "list",
    "aria-label": "Bilder",
  });
  const zaehler = el("p", { class: "meta zaehler", role: "status" });
  const leer = el("div", { class: "leer", hidden: true });
  const meldungsplatz = el("div", { class: "ws-medien-meldung" });
  const mehr = knopf("Weitere Bilder laden", {
    klein: true,
    onclick: () => {
      nachladeFehler = false;
      meldungsplatz.replaceChildren();
      ladeWeitere();
    },
  });
  const suchId = neueId("suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Alt-Text suchen",
    autocomplete: "off",
    oninput: () => {
      window.clearTimeout(timer);
      timer = setTimeout(neueSuche, 300);
    },
  });
  const werkzeuge = el(
    "div",
    { class: "werkzeuge" },
    el(
      "div",
      { class: "suche" },
      el("label", { class: "nur-leser", for: suchId }, "Bilder suchen"),
      icon("lupe"),
      suche,
    ),
    zaehler,
  );

  function zeigeZustand() {
    const n = eintraege.size;
    werkzeuge.hidden = n === 0 && !frage.trim();
    zaehler.textContent =
      n === 0
        ? ""
        : `${anzahlBilder(n)}${weitere ? ", weitere folgen beim Scrollen" : ""}`;
    leer.hidden = n > 0;
    leer.replaceChildren();
    if (n === 0 && frage.trim()) {
      leer.append(
        el("p", {}, `Kein Bild passt zu «${frage.trim()}».`),
        knopf("Suche zurücksetzen", {
          klein: true,
          onclick: () => {
            suche.value = "";
            neueSuche();
            suche.focus();
          },
        }),
      );
    } else if (n === 0) {
      leer.append(
        el("p", {}, "Es gibt noch keine Bilder. Lade das erste hoch."),
      );
    }
    mehr.hidden = !weitere;
  }

  function karte(m) {
    const kontext = kurzname(m);
    const bild = istBild(m);
    const vorschau = el("div", { class: "ws-medien-bild" });
    if (bild) {
      vorschau.append(
        el("img", {
          src: m.url,
          alt: "",
          width: m.breite,
          height: m.hoehe,
          loading: "lazy",
          decoding: "async",
          // Fehlt die Datei, steht ein Wort an ihrer Stelle
          onerror: (e) =>
            e.target.replaceWith(
              el(
                "span",
                { class: "ws-medien-ohne" },
                "Vorschau nicht verfügbar",
              ),
            ),
        }),
      );
    } else {
      vorschau.append(el("span", { class: "ws-medien-ohne" }, "PDF"));
    }
    const alt =
      bild &&
      knopf("Alt-Text ändern", {
        klein: true,
        symbol: "bearbeiten",
        kontext,
        onclick: () => aendereDialog(m),
      });
    const loeschen =
      ctx.zugang.darf("medien.verwalten") &&
      knopf("Löschen", {
        klein: true,
        art: "gefahr",
        symbol: "papierkorb",
        kontext,
        onclick: () => loescheDialog(m),
      });
    const li = el(
      "li",
      { class: "ws-medien-karte", tabindex: "-1" },
      vorschau,
      el(
        "div",
        { class: "ws-medien-text" },
        el("p", { class: "ws-medien-titel" }, titelText(m)),
        el(
          "ul",
          { class: "chips" },
          altChip(m),
          m.sichtbarkeit === "oeffentlich"
            ? chip("Öffentlich", undefined, "website")
            : chip("Nur angemeldet", undefined, "schild"),
        ),
        el(
          "p",
          { class: "meta klein" },
          [
            groesseText(m.groesse),
            m.breite && `${m.breite} × ${m.hoehe} Pixel`,
            tag(m.erstelltAm),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        !bild &&
          el(
            "p",
            { class: "hilfe" },
            "Dateien zum Herunterladen verknüpfst du im Baustein «Datei» mit dem SharePoint. Dieses alte PDF kannst du nur löschen.",
          ),
      ),
      (alt || loeschen) &&
        el("div", { class: "ws-medien-aktionen" }, alt, loeschen),
    );
    return { m, li, alt, loeschen };
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
    daten.medien.forEach((m) => anhaengen(m));
    weitere = daten.weitere;
    nachladeFehler = false;
    zeigeZustand();
    beobachte();
  }

  const hole = (offset) => {
    const q = new URLSearchParams({ limit: SEITE, offset });
    if (frage.trim()) q.set("suche", frage.trim());
    return anfrage("GET", `${API}?${q}`);
  };

  // Fehler beim Nachladen oder Suchen: sichtbar, mit «Nochmals versuchen»; das Raster bleibt, wie es ist
  function zeigeFehler(f, nochmals) {
    meldungsplatz.replaceChildren(
      el(
        "p",
        { class: "hinweis hinweis--fehler", role: "alert" },
        fehlertext(f),
      ),
      knopf("Nochmals versuchen", {
        klein: true,
        symbol: "aktualisieren",
        onclick: () => {
          meldungsplatz.replaceChildren();
          nochmals();
        },
      }),
    );
  }

  async function neueSuche() {
    if (!raster.isConnected) return;
    const mein = ++lauf;
    frage = suche.value;
    meldungsplatz.replaceChildren();
    raster.setAttribute("aria-busy", "true");
    zaehler.textContent = "Suche läuft …";
    try {
      const daten = await hole(0);
      if (mein !== lauf) return;
      ersetze(daten);
    } catch (f) {
      if (mein !== lauf) return;
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
    try {
      // Der Versatz ist die Zahl der geladenen Bilder: Ein neues oder gelöschtes Bild ändert ihn hier im Gleichschritt mit dem Server
      const daten = await hole(eintraege.size);
      if (mein !== lauf) return;
      daten.medien.forEach((m) => anhaengen(m));
      weitere = daten.weitere;
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
            if (!nachladeFehler && e.some((x) => x.isIntersecting)) {
              ladeWeitere();
            }
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
    zeigeZustand();
  }

  // dialogFormular setzt den Fokus beim Schliessen zuerst zurück; dieser Aufruf kommt danach und gewinnt
  const nachDemSchliessen = (dialog, fn) =>
    dialog.addEventListener("close", fn, { once: true });

  function fokusiere(id) {
    const li = eintraege.get(id)?.li;
    li?.focus();
    li?.scrollIntoView({ block: "nearest" });
  }

  function aendereDialog(m) {
    const zierde = ankreuzen({
      label: ZIERDE,
      gewaehlt: m.dekorativ,
      wert: "dekorativ",
    });
    const alt = feld({
      label: "Alt-Text",
      mehrzeilig: true,
      wert: m.altText ?? "",
      maxlength: MAX_ALT,
      rows: 4,
      "aria-required": "true",
      hilfe: ALT_HILFE,
    });
    alt.wurzel.classList.add("ws-medien-alt");
    const schalte = () => {
      alt.wurzel.hidden = zierde.eingabe.checked;
      entferneFeldFehler(alt);
    };
    zierde.eingabe.addEventListener("change", schalte);
    schalte();
    alt.eingabe.addEventListener("input", () => entferneFeldFehler(alt));
    let neu = null;
    const dialog = dialogFormular({
      titel: "Alt-Text ändern",
      beschreibung: `Für «${kurzname(m)}».`,
      felder: [alt.wurzel, zierde.wurzel],
      ok: "Speichern",
      pruefe: () => {
        if (zierde.eingabe.checked || alt.eingabe.value.trim() !== "") {
          return false;
        }
        feldFehler(alt, ALT_FEHLT);
        return true;
      },
      senden: () =>
        anfrage(
          "PATCH",
          `${API}/${m.id}`,
          zierde.eingabe.checked
            ? { dekorativ: true }
            : { altText: alt.eingabe.value.trim() },
        ),
      danach: (aktualisiert) => {
        neu = aktualisiert;
      },
      fehlertext: (f) =>
        f?.status === 403
          ? "Dafür fehlt die Berechtigung. Den Alt-Text ändern die Person, die das Bild hochgeladen hat, und wer Medien verwalten darf."
          : fehlertext(f),
    });
    nachDemSchliessen(dialog, () => {
      const alte = neu && eintraege.get(m.id);
      if (!alte) return;
      const k = karte(neu);
      alte.li.replaceWith(k.li);
      eintraege.set(m.id, k);
      ctx.melde(
        neu.dekorativ
          ? "Das Bild ist als Zierde markiert."
          : "Der Alt-Text ist gespeichert.",
      );
      k.alt.focus();
    });
  }

  function loescheDialog(m) {
    let fokusId;
    let geloescht = false;
    const dialog = dialogFormular({
      titel: "Bild löschen?",
      beschreibung: `«${kurzname(m)}» wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
      ok: "Bild löschen",
      gefaehrlich: true,
      senden: async () => {
        try {
          await anfrage("DELETE", `${API}/${m.id}`);
        } catch (f) {
          // Das Bild steht noch in Seiten: Löschen geht erst, wenn es dort entfernt ist, und der Knopf hilft nicht mehr
          if (f?.code === "MEDIUM_VERWENDET") {
            setTimeout(() => {
              dialog.querySelector('button[type="submit"]').hidden = true;
              dialog.querySelector(".dialog-knoepfe button").textContent =
                "Schliessen";
            }, 0);
          }
          throw f;
        }
      },
      danach: () => {
        const li = eintraege.get(m.id)?.li;
        const nachbar = li?.nextElementSibling ?? li?.previousElementSibling;
        fokusId = [...eintraege].find(([, k]) => k.li === nachbar)?.[0];
        entferne(m.id);
        geloescht = true;
      },
      fehlertext: (f) => {
        if (f?.code === "MEDIUM_VERWENDET") {
          const n = Number(f.seiten);
          const seiten =
            n === 1 ? "1 Seite" : `${n > 0 ? n : "mehreren"} Seiten`;
          return `Dieses Bild steht noch in ${seiten} (im Entwurf oder in einer früheren Version). Entferne es dort zuerst, dann kannst du es löschen.`;
        }
        return f?.status === 403
          ? "Bilder löschen nur die Abteilungsleitung und wer Medien verwalten darf."
          : fehlertext(f);
      },
    });
    nachDemSchliessen(dialog, () => {
      if (!geloescht) return;
      ctx.melde("Das Bild ist gelöscht.");
      if (fokusId && eintraege.has(fokusId)) fokusiere(fokusId);
      else {
        (
          document.querySelector(".kopf-aktion button") ??
          document.querySelector("h1")
        )?.focus();
      }
    });
  }

  function hochladenDialog() {
    const datei = feld({
      label: "Bild",
      typ: "file",
      accept: "image/jpeg,image/png,image/webp",
      hilfe:
        "JPEG, PNG oder WebP, höchstens 10 MB. Bilder werden automatisch verkleinert.",
    });
    const vorschau = el("div", { class: "ws-medien-vorschau", hidden: true });
    const wahl = sichtbarkeitWahl();
    const zierde = ankreuzen({ label: ZIERDE, wert: "dekorativ" });
    const alt = feld({
      label: "Alt-Text",
      mehrzeilig: true,
      maxlength: MAX_ALT,
      rows: 4,
      "aria-required": "true",
      hilfe: ALT_HILFE,
    });
    alt.wurzel.classList.add("ws-medien-alt");
    // Balken und Prozentwort sind für Augen; Screenreader hören nur die Stufen, nicht jedes Prozent
    const balken = el("progress", {
      max: "100",
      value: "0",
      "aria-hidden": "true",
    });
    const prozent = el("p", { class: "meta", "aria-hidden": "true" });
    const ansage = el("p", { class: "nur-leser", role: "status" });
    const abbruch = knopf("Hochladen abbrechen", {
      klein: true,
      onclick: () => steuerung?.abort(),
    });
    const fortschritt = el(
      "div",
      { class: "ws-medien-fortschritt", hidden: true },
      balken,
      prozent,
      abbruch,
    );
    let gewaehlt = null;
    let steuerung = null;
    let stufe = -1;
    let neues = null;

    zierde.eingabe.addEventListener("change", () => {
      alt.wurzel.hidden = zierde.eingabe.checked;
      entferneFeldFehler(alt);
    });
    alt.eingabe.addEventListener("input", () => entferneFeldFehler(alt));
    wahl.wurzel.addEventListener("change", () => entferneFeldFehler(wahl));

    datei.eingabe.addEventListener("change", async () => {
      entferneFeldFehler(datei);
      vorschau.hidden = true;
      vorschau.replaceChildren();
      gewaehlt = null;
      const d = datei.eingabe.files[0];
      if (!d) return;
      const problem = await pruefeDatei(d);
      if (datei.eingabe.files[0] !== d) return;
      if (problem) return feldFehler(datei, problem, { fokus: false });
      // Vorschau über eine Leinwand: Die CSP erlaubt keine blob:-Adressen. Das Lesen zeigt nebenbei, ob sich das Bild öffnen lässt.
      try {
        const bild = await window.createImageBitmap(d);
        if (datei.eingabe.files[0] !== d) return bild.close();
        const leinwand = el("canvas", {
          role: "img",
          "aria-label": "Vorschau des gewählten Bildes",
        });
        leinwand.width = Math.round(bild.width * Math.min(1, 480 / bild.width));
        leinwand.height = Math.round(
          bild.height * Math.min(1, 480 / bild.width),
        );
        leinwand
          .getContext("2d")
          .drawImage(bild, 0, 0, leinwand.width, leinwand.height);
        bild.close();
        vorschau.append(leinwand);
        vorschau.hidden = false;
        gewaehlt = d;
      } catch {
        feldFehler(
          datei,
          "Dieses Bild lässt sich nicht lesen. Wähle ein anderes.",
          { fokus: false },
        );
      }
    });

    function beiFortschritt(anteil) {
      const p = Math.round(anteil * 100);
      balken.value = p;
      if (p >= 100) {
        prozent.textContent = "Bild wird verarbeitet …";
        abbruch.hidden = true;
        if (stufe < 100) ansage.textContent = "Bild wird verarbeitet …";
        stufe = 100;
        return;
      }
      prozent.textContent = `Lade hoch … ${p} %`;
      const neueStufe = Math.floor(p / 25) * 25;
      if (neueStufe > stufe) {
        stufe = neueStufe;
        ansage.textContent =
          neueStufe === 0 ? "Lade hoch …" : `Lade hoch … ${neueStufe} %`;
      }
    }

    const dialog = dialogFormular({
      titel: "Bild hochladen",
      felder: [
        datei.wurzel,
        vorschau,
        wahl.wurzel,
        alt.wurzel,
        zierde.wurzel,
        fortschritt,
        ansage,
      ],
      ok: "Hochladen",
      // Reihenfolge wie im Dialog: Bild, Sichtbarkeit, Alt-Text; der Fokus geht auf das erste Feld, das fehlt
      pruefe: () => {
        let erstes = null;
        const fehlt = (f, text) => {
          if (text) feldFehler(f, text, { fokus: false });
          erstes ??= f.eingabe;
        };
        if (!gewaehlt) {
          // Ein Bild mit Problem trägt seine Meldung schon
          fehlt(
            datei,
            datei.wurzel.querySelector(".feld-fehler")
              ? ""
              : "Wähle zuerst ein Bild.",
          );
        }
        if (wahl.wert() === null) {
          fehlt(wahl, "Wähle, wer das Bild sehen darf.");
        }
        if (!zierde.eingabe.checked && alt.eingabe.value.trim() === "") {
          fehlt(alt, ALT_FEHLT);
        }
        erstes?.focus();
        return erstes !== null;
      },
      senden: async () => {
        const q = new URLSearchParams({ sichtbarkeit: wahl.wert() });
        if (zierde.eingabe.checked) q.set("dekorativ", "true");
        else q.set("altText", alt.eingabe.value.trim());
        steuerung = new window.AbortController();
        stufe = -1;
        fortschritt.hidden = false;
        abbruch.hidden = false;
        beiFortschritt(0);
        try {
          return await hochladen(`${API}?${q}`, gewaehlt, {
            beiFortschritt,
            signal: steuerung.signal,
          });
        } catch (f) {
          dialog.querySelector('button[type="submit"]').textContent =
            "Nochmals versuchen";
          throw f;
        } finally {
          fortschritt.hidden = true;
          steuerung = null;
        }
      },
      danach: (m) => {
        neues = m;
      },
      fehlertext: (f) => {
        if (f?.name === "AbortError") return "Das Hochladen wurde abgebrochen.";
        const grund =
          {
            ZU_GROSS: "Das Bild ist zu gross. Höchstens 10 MB.",
            MEDIEN_FORMAT: TYP_FEHLER,
            ALT_TEXT: "Gib einen Alt-Text ein oder wähle «Nur Zierde».",
          }[f?.code] ?? fehlertext(f);
        return `Das Hochladen hat nicht geklappt. ${grund}`;
      },
    });
    // Schliesst man den Dialog mitten im Hochladen (Escape), bricht auch die Anfrage ab
    dialog.addEventListener("close", () => steuerung?.abort());
    nachDemSchliessen(dialog, async () => {
      const m = neues;
      if (!m) return;
      // Eine Suche, zu der das neue Bild nicht passt, versteckte es: zurück zur ganzen Liste
      if (frage.trim()) {
        suche.value = "";
        frage = "";
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
      ctx.melde("Das Bild ist hochgeladen. Es steht jetzt ganz oben.");
      fokusiere(m.id);
    });
  }

  ctx.kopfAktion(
    knopf("Bild hochladen", {
      art: "haupt",
      symbol: "plus",
      onclick: hochladenDialog,
    }),
  );
  erste.medien.forEach((m) => anhaengen(m));
  zeigeZustand();
  bereich.append(
    werkzeuge,
    leer,
    raster,
    meldungsplatz,
    el("div", { class: "ws-medien-fuss" }, mehr),
  );
  beobachte();
}
