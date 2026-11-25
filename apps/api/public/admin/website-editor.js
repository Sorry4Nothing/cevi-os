import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { zurueckKlick } from "./verlauf.js";
import { el, feld, knopf, neueId } from "./dom.js";
import { sk } from "./lader.js";
import { splitKnopf } from "./aktionen.js";
import { sortierListe } from "./sortieren.js";
import { schuetze, wechsle } from "./ungespeichert.js";
import { zeichen } from "./zustaende.js";
import {
  ADRESSE,
  MAX_TIEFE,
  API,
  RESERVIERT,
  baue as baueBaum,
  geaenderteAdressen,
  koerper,
  patch,
  plane,
} from "./website-baum.js";
import { weiterleitungsHinweis } from "./website-baumansicht.js";
import {
  bearbeitenBlatt,
  bildDialog,
  katalogDialog,
} from "./website-bausteine.js";
import {
  anzahlText,
  band,
  beschaeftigt,
  bei,
  keinRecht,
  kuerze,
  sichtbarkeitText,
  uhrzeit,
} from "./website-dialoge.js";
import {
  CODE_TEXTE,
  MAX_BAUSTEINE,
  TYPEN,
  VERWEIS_TEXTE,
  feldName,
  kurzText,
  medienIds,
  typName,
} from "./website-felder.js";
import { ladePersonen, ladeTeam } from "./website-personenwahl.js";
import { siehtAlles } from "./sicht.js";
import { sichtbarkeitBlatt } from "./website-sichtbarkeit.js";
import { mitSymbol, symbol } from "./website-symbole.js";
import { bausteinVorschau } from "./website-vorschau.js";
import {
  veroeffentlichenDialog,
  vergleiche,
  zurueckziehen,
} from "./website-veroeffentlichen.js";

// Editor einer Seite (Boards E2 bis E6). Schnittstelle zum Bereich: ctx aus admin.js, ctx.pfad[0] ist die Kennung der Seite.
//
// Das Dokument der Seite liegt als Objekt im Speicher und ist die einzige Wahrheit: Die Liste der Bausteine wird daraus gezeichnet,
// «Bearbeiten» öffnet ein Seitenblatt mit einer Kopie des Bausteins, «Übernehmen» schreibt sie zurück.
// Der Server prüft alles (Fehler mit Pfad); der Browser prüft nur, was fehlt. Nur ein gültiges Dokument lässt sich speichern.
// Kein Autospeichern: Unfertige Bausteine lassen sich nicht speichern, ein Takt würde nur Fehler melden und die Datenbank belasten.
// Dafür geht nichts verloren: Rückfrage beim Verlassen, Warnung beim Schliessen des Tabs, und beim Zurückkehren auf dieselbe Seite die ungespeicherte Fassung.
// Datenbanklast beim Öffnen: Seite, Entwurf und Gruppen (und für die Abteilungsleitung die Liste der Seiten für die Elternseite). Ein Abruf der Medien nur, wenn ein Bild-Baustein da ist.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ungespeicherte Fassungen für den Rest des Besuchs (nur Arbeitsspeicher, nichts im Browser), je Konto und Seite: { dok, zaehler }
const puffer = new Map();
const kopie = (wert) => JSON.parse(JSON.stringify(wert));
const neueUuid = () => globalThis.crypto.randomUUID();

export function zeige(bereich, ctx) {
  const id = ctx.pfad[0];
  // Die Kennung steht in der Adresse der Seite und geht in Pfade der API: nur eine echte UUID, nie «../» oder «?»
  if (!UUID.test(id) || ctx.pfad.length > 1) {
    const karte = el(
      "section",
      { class: "zustand", role: "alert" },
      el("p", { class: "mini leise mono" }, "Fehler 404"),
      el("h2", { tabindex: "-1" }, "Diese Seite gibt es nicht."),
      el(
        "p",
        { class: "leise" },
        "Vielleicht ist der Link alt oder hat einen Tippfehler.",
      ),
      el(
        "a",
        { class: "knopf knopf--haupt", href: "#website/seiten" },
        "Zu den Seiten",
      ),
    );
    bereich.append(karte);
    karte.querySelector("h2").focus();
    return;
  }
  const verwalten = ctx.zugang.darf("seiten.anlegen_loeschen");
  ctx.lade(
    async () => {
      try {
        const [seite, entwurf, tags, liste] = await Promise.all([
          anfrage("GET", `${API}/seiten/${id}`),
          anfrage("GET", `${API}/seiten/${id}/entwurf`),
          anfrage("GET", `${API}/tags`),
          verwalten ? anfrage("GET", `${API}/seiten`) : null,
        ]);
        return {
          seite,
          entwurf,
          tags: tags.tags,
          alle: liste?.seiten ?? [seite],
        };
      } catch (f) {
        if (f instanceof ApiFehler && f.status === 403)
          return { keinRecht: true };
        throw f;
      }
    },
    (daten) => {
      if (daten.keinRecht) return keinRecht(bereich);
      baue(bereich, ctx, id, daten);
    },
    { skeleton: skeletonEditor },
  );
}

// Der Editor, solange er lädt (G3 «Editor-Bausteinliste»): Zeilen mit Griff, Text und Knopf; rechts Vorschau und Einstellungen
function skeletonEditor() {
  const zeile = () =>
    el(
      "li",
      { class: "baustein", "aria-hidden": "true" },
      sk("b", 24),
      el("div", {}, sk("t", 96), sk("t", 260)),
      sk("r", 260),
    );
  const fl = (...kinder) =>
    el("section", { class: "flaeche", "aria-hidden": "true" }, ...kinder);
  return el(
    "div",
    { class: "ws-editor" },
    el(
      "div",
      { class: "ws-spalte" },
      el("ul", { class: "ws-bausteine" }, [
        zeile(),
        zeile(),
        zeile(),
        zeile(),
        zeile(),
      ]),
    ),
    el(
      "div",
      { class: "ws-spalte" },
      fl(
        el("div", { class: "zeile" }, sk("t", 96), sk("r", 160)),
        sk("b", 320),
      ),
      fl(sk("t", 160), sk("t", 64), sk("b", 320), sk("t", 64), sk("b", 320)),
    ),
  );
}

function baue(bereich, ctx, id, { seite, entwurf, tags, alle }) {
  const leer = () => ({ v: 1, titel: seite.titel, bausteine: [] });
  const pufferId = `${ctx.ich?.id ?? ""}:${id}`;
  const gepuffert = puffer.get(pufferId);
  const verwalten = ctx.zugang.darf("seiten.anlegen_loeschen");
  const k = {
    ctx,
    id,
    seite,
    alle,
    tags,
    tagNamen: new Map(tags.map((t) => [t.id, t.name])),
    personNamen: new Map(),
    // Die Leitenden zur Auswahl, einmal je Editor geladen (website-felder.js)
    personen: { laden: null, liste: null },
    // Wer in einem Leitungsteam erscheint, je Gruppe einmal geladen (website-personenwahl.js); die Zeile in der Liste zeigt die Zahl
    teams: { laden: new Map(), stand: new Map() },
    medien: new Map(),
    kannAlt: ctx.zugang.darf("medien.verwalten"),
    dok: gepuffert ? gepuffert.dok : (entwurf.dokument ?? leer()),
    zaehler: gepuffert ? gepuffert.zaehler : entwurf.zaehler,
    dirty: Boolean(gepuffert),
    aenderungen: gepuffert ? 1 : 0,
    nr: entwurf.veroeffentlichteNr,
    unveroeffentlicht: entwurf.unveroeffentlicht,
    gespeichertAm: null,
    speichert: false,
    offline: false,
    pruefen: new Set(),
    // Bausteine, deren Vorschau in der Liste aufgeklappt ist (#739); sie bleibt beim Neuzeichnen der Liste offen
    vorschauOffen: new Set(),
    geloescht: null,
  };
  if (gepuffert)
    // «warn», damit sie bleibt: Die Änderungen sind noch nicht gespeichert
    ctx.melde("Deine ungespeicherten Änderungen sind wieder da.", "warn");

  const wurzel = el("div", { class: "ws-editor-seite" });
  bereich.append(wurzel);

  // Kopf des Editors (Vorlage: Werkzeugleiste eines Editors): Titel mit Zeichen und «Umbenennen», darunter der Speicherstand; rechts Zugriff, Vorschau und Veröffentlichen mit Menü
  ctx.titel(seite.titel, seite.pfad);
  const titelChip = el("span", { class: "ws-titelchip" });
  const kopfEl = document.getElementById("seitenkopf");
  const h1 = kopfEl?.querySelector("h1");
  const stand = el("p", { class: "ws-stand", role: "status" });
  const umbenennen = knopf("Umbenennen", {
    art: "still",
    klein: true,
    symbol: "bearbeiten",
    "aria-label": "Umbenennen: Titel der Seite (Taste F2)",
    onclick: () => benenne(),
  });
  if (h1) {
    const zeileEl = el("div", { class: "ws-titelzeile" });
    h1.replaceWith(zeileEl);
    zeileEl.append(h1, titelChip, ...(verwalten ? [umbenennen] : []));
    zeileEl.parentElement.prepend(
      el(
        "p",
        { class: "ws-zurueck" },
        el(
          "a",
          { class: "klein", href: "#website/seiten", onclick: zurueckKlick },
          symbol("zurueck"),
          " Seiten",
        ),
      ),
    );
    zeileEl.parentElement.append(stand);
  }

  // Titel direkt umbenennen: Der Titel steht in Liste und Navigation, er gehört nicht zum Entwurf und wird sofort gespeichert
  function benenne() {
    if (!h1 || h1.hidden) return;
    const eingabe = el("input", {
      class: "eingabe ws-titel-eingabe",
      type: "text",
      value: k.seite.titel,
      maxlength: "150",
      autocomplete: "off",
      "aria-label": "Titel der Seite. Enter speichert, Escape bricht ab.",
    });
    let fertig = false;
    const zu = (fokus) => {
      fertig = true;
      eingabe.remove();
      h1.hidden = false;
      umbenennen.hidden = false;
      if (fokus) umbenennen.focus();
    };
    const speichereTitel = async () => {
      const neu = eingabe.value.trim();
      if (!neu || neu === k.seite.titel) return zu(true);
      eingabe.setAttribute("aria-busy", "true");
      try {
        await patch(k.seite.id, { titel: neu });
        k.seite.titel = neu;
        ctx.titel(neu);
        zu(true);
        ctx.melde(`Der Titel ist jetzt «${kuerze(neu, 60)}».`, "ok");
      } catch (f) {
        eingabe.removeAttribute("aria-busy");
        fertig = false;
        ctx.melde(fehlertext(f), "fehler");
        eingabe.focus();
      }
    };
    eingabe.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        speichereTitel();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        zu(true);
      }
    });
    eingabe.addEventListener("blur", () => {
      if (!fertig) window.setTimeout(() => !fertig && speichereTitel(), 0);
    });
    h1.hidden = true;
    umbenennen.hidden = true;
    h1.after(eingabe);
    eingabe.focus();
    eingabe.select();
  }

  // --- Stand: Zeichen im Kopf, Speicherstand unter dem Titel, Knöpfe oben
  const speichernKnopf = knopf("Speichern", { klein: true });
  const knoepfe = {};
  // «Gespeichert vor 2 Min.»: rechnet im Browser, fragt den Server nie
  const vor = (d) => {
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    return min < 1
      ? "gerade eben"
      : min < 60
        ? `vor ${min} Min.`
        : `um ${uhrzeit.format(d)}`;
  };

  function zeichneStatus() {
    const [text, symbolName, art] = k.dirty
      ? ["Nicht gespeichert", "warnung", "warn"]
      : k.nr === null
        ? ["Entwurf", "bearbeiten", "warn"]
        : k.unveroeffentlicht
          ? ["Änderungen offen", "bearbeiten", "warn"]
          : ["Veröffentlicht", "haken", "ok"];
    titelChip.replaceChildren(zeichen([text, symbolName, art]));
    speichernKnopf.hidden = !(k.dirty || k.speichert);
    beschaeftigt(speichernKnopf, k.speichert);
    const inhalt = [];
    if (k.speichert) {
      inhalt.push(symbol("uhr"), "Wird gespeichert …");
    } else if (k.dirty && k.offline) {
      inhalt.push(
        symbol("warnung"),
        `${anzahlText(k.aenderungen, "1 Änderung wartet", "Änderungen warten")} auf die Verbindung`,
      );
    } else if (k.dirty) {
      inhalt.push(symbol("warnung"), "Änderungen noch nicht gespeichert");
    } else {
      inhalt.push(
        symbol("haken"),
        k.gespeichertAm
          ? `Gespeichert ${vor(k.gespeichertAm)}`
          : "Der Entwurf ist gespeichert.",
      );
    }
    stand.replaceChildren(
      ...inhalt,
      ...(!k.speichert && k.dirty ? [speichernKnopf] : []),
    );
    if (k.speichert) stand.append(speichernKnopf);
    knoepfe.veroeffentlichen?.removeAttribute("aria-disabled");
    if (k.offline) {
      knoepfe.veroeffentlichen?.setAttribute("aria-disabled", "true");
    }
    hilfeVeroeffentlichen.hidden = !k.offline;
    // Die Menüpunkte hängen vom Stand ab (zurückziehen geht nur, wenn die Seite online ist)
    if ((k.nr === null) !== knoepfe.unpubliziert) kopfAktionen();
  }
  // Die Zeit im Speicherstand läuft weiter, ohne Abruf; der Takt endet mit dem Editor
  const takt = window.setInterval(() => {
    if (!wurzel.isConnected) return window.clearInterval(takt);
    if (!k.dirty && !k.speichert && k.gespeichertAm) zeichneStatus();
  }, 30000);

  k.aenderung = () => {
    k.aenderungen += 1;
    if (!k.dirty) k.dirty = true;
    puffer.set(pufferId, { dok: k.dok, zaehler: k.zaehler });
    zeichneStatus();
  };
  k.statusNeu = () => zeichneStatus();
  k.waehleBild = (beiWahl) => bildDialog(k, beiWahl);

  // --- Fehler vom Server: gesammelt als Band mit Sprung ins Seitenblatt des Bausteins
  const fehlerPlatz = el("div", { class: "ws-fehlerplatz" });
  const konfliktPlatz = el("div", { class: "ws-fehlerplatz" });

  function loescheFehler() {
    fehlerPlatz.replaceChildren();
    if (k.pruefen.size > 0) {
      k.pruefen.clear();
      zeichneListe();
    }
  }

  // Prüft, was dem Browser auffällt; der Server prüft danach alles
  function pruefeAlles() {
    const fehler = [];
    if (!k.dok.titel?.trim()) {
      fehler.push({
        index: null,
        pfad: "titel",
        text: "Die Überschrift der Seite fehlt.",
      });
    }
    k.dok.bausteine.forEach((b, index) => {
      // Der Alt-Text steht im Medium und gehört nicht zur Prüfung des Entwurfs
      for (const [pfad, text] of TYPEN[b.typ]?.pruefe(b.daten, {
        medien: new Map(),
        altText: () => "x",
      }) ?? []) {
        fehler.push({ index, pfad, text: `${feldName(pfad)} ${text}` });
      }
      if (
        b.sichtbarkeit !== "erbt" &&
        b.sichtbarkeit.art === "tags" &&
        b.sichtbarkeit.tagIds.length === 0
      ) {
        fehler.push({
          index,
          pfad: "sichtbarkeit",
          text: "Wähle mindestens eine Gruppe oder eine andere Sichtbarkeit.",
        });
      }
    });
    return fehler;
  }

  // 400 mit Pfad und zod-Code, 422 mit Pfad «bausteine.<n>» und Code der Verweisprüfung
  function serverFehler(f) {
    const liste = f.daten?.fehler;
    if (!Array.isArray(liste) || liste.length === 0) return null;
    return liste.map(({ pfad, code }) => {
      const m = /^bausteine\.(\d+)(?:\.(.*))?$/.exec(pfad);
      const rest = m?.[2] ?? "";
      const text =
        VERWEIS_TEXTE[code] ??
        `${feldName(rest || pfad)} ${CODE_TEXTE[code] ?? "ist ungültig."}`;
      return m
        ? { index: Number(m[1]), pfad: rest || "daten", text }
        : { index: null, pfad, text };
    });
  }

  // eintraege: [{ index (Baustein) oder null (Überschrift), pfad, text }]
  function zeigeFehler(eintraege, einleitung) {
    k.pruefen = new Set(
      eintraege
        .filter((e) => e.index !== null)
        .map((e) => k.dok.bausteine[e.index]?.id)
        .filter(Boolean),
    );
    zeichneListe();
    const liste = el("ul", { class: "ws-fehlerliste" });
    for (const e of eintraege) {
      const b = e.index === null ? null : k.dok.bausteine[e.index];
      if (e.index !== null && !b) continue;
      const ort = b
        ? `Baustein ${e.index + 1} (${typName(b)})`
        : "Überschrift der Seite";
      liste.append(
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "ws-sprung",
              onclick: () => {
                if (b)
                  bearbeitenBlatt(k, b, e.index, {
                    fehler: eintraege.filter((x) => x.index === e.index),
                  });
                else {
                  ueberschrift.eingabe.scrollIntoView({ block: "center" });
                  ueberschrift.eingabe.focus();
                }
              },
            },
            `${ort}: ${e.text}`,
          ),
        ),
      );
    }
    const b2 = el(
      "div",
      { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
      el(
        "div",
        { class: "ws-fehlertext" },
        el("p", { class: "fett" }, einleitung),
        liste,
      ),
    );
    fehlerPlatz.replaceChildren(b2);
    b2.focus();
  }

  // --- Speichern
  async function speichere() {
    if (k.speichert) return false;
    const fehler = pruefeAlles();
    if (fehler.length > 0) {
      zeigeFehler(
        fehler,
        "Der Entwurf ist nicht gespeichert. Das musst du noch ändern:",
      );
      return false;
    }
    loescheFehler();
    konfliktPlatz.replaceChildren();
    ctx.melde("");
    k.speichert = true;
    zeichneStatus();
    try {
      const antwort = await anfrage("PUT", `${API}/seiten/${id}/entwurf`, {
        zaehler: k.zaehler,
        dokument: kopie(k.dok),
      });
      k.zaehler = antwort.zaehler;
      k.dirty = false;
      k.offline = false;
      k.aenderungen = 0;
      k.unveroeffentlicht = true;
      k.gespeichertAm = new Date();
      puffer.delete(pufferId);
      k.speichert = false;
      zeichneStatus();
      ctx.melde(
        "Gespeichert. Die Änderungen sind im Entwurf. Online gehen sie erst mit «Veröffentlichen».",
        "ok",
      );
      return true;
    } catch (f) {
      k.speichert = false;
      k.offline = f.status === 0;
      zeichneStatus();
      if (f.status === 409 && f.code === "KONFLIKT" && f.daten) {
        return konflikt(f.daten);
      }
      const eintraege =
        (f.status === 400 || f.status === 422) && serverFehler(f);
      if (eintraege) {
        zeigeFehler(
          eintraege,
          "Der Server hat den Entwurf nicht angenommen. Das musst du ändern:",
        );
      } else if (f.status === 413) {
        ctx.melde(
          "Die Seite ist zu gross für einen Entwurf. Kürze Texte oder entferne Bausteine.",
          "fehler",
        );
      } else if (f.status === 403) {
        ctx.melde(
          "Du darfst diese Seite nicht mehr bearbeiten. Deine Änderungen bleiben hier stehen, gespeichert sind sie nicht. Wende dich an die Abteilungsleitung.",
          "fehler",
        );
      } else if (f.status === 0) {
        ctx.melde(
          "Keine Verbindung. Deine Änderungen bleiben in diesem Fenster, bis du wieder online bist.",
          "warn",
          {
            text: "Nochmals speichern",
            onclick: speichere,
          },
        );
      } else {
        ctx.melde(
          "Speichern hat nicht geklappt. Deine Änderungen sind noch da.",
          "fehler",
          {
            text: "Nochmals speichern",
            onclick: speichere,
          },
        );
      }
      return false;
    }
  }
  k.speichere = speichere;
  bei(speichernKnopf, speichere);

  // Zwei Sitzungen haben dieselbe Seite geändert: Nichts geht still verloren, die Person entscheidet (E2 «Konflikt»)
  function konflikt(aktuell) {
    return new Promise((fertig) => {
      const fremd = aktuell.dokument ?? leer();
      const punkte = vergleiche(k.dok, fremd);
      const ids = new Set(
        punkte.filter((p) => p.baustein).map((p) => p.baustein.id),
      );
      const spalte = (titel, dok) =>
        el(
          "div",
          { class: "flaeche" },
          el("h3", {}, titel),
          el(
            "p",
            { class: "klein leise" },
            `${dok.titel} · ${anzahlText(dok.bausteine.length, "1 Baustein", "Bausteine")}`,
          ),
          el(
            "ol",
            { class: "ws-konfliktliste" },
            dok.bausteine.map((b) => {
              const text = kurzText(k, b);
              return el(
                "li",
                { class: ids.has(b.id) ? "markiert" : undefined },
                `${typName(b)}${text ? `: ${kuerze(text, 40)}` : ""}`,
                ids.has(b.id) &&
                  el(
                    "span",
                    { class: "chip chip--warn ws-abstand" },
                    "geändert",
                  ),
              );
            }),
          ),
        );
      const behalten = knopf("Meine behalten", { klein: true });
      const uebernehmen = knopf("Aktuelle übernehmen", { klein: true });
      const b2 = el(
        "div",
        {
          class: "hinweis hinweis--warn ws-konflikt",
          role: "alert",
          tabindex: "-1",
        },
        el("strong", {}, "Jemand hat diese Seite gerade geändert."),
        el(
          "p",
          {},
          "Wähle, welche Fassung gilt. Die beiden Fassungen lassen sich nicht mischen.",
        ),
        el(
          "div",
          { class: "konflikt" },
          spalte("Deine Fassung", k.dok),
          spalte("Aktuelle Fassung", fremd),
        ),
        el("div", { class: "ws-reihe" }, behalten, uebernehmen),
      );
      konfliktPlatz.replaceChildren(b2);
      b2.focus();
      bei(behalten, async () => {
        k.zaehler = aktuell.zaehler;
        konfliktPlatz.replaceChildren();
        fertig(await speichere());
      });
      bei(uebernehmen, () => {
        k.dok = kopie(fremd);
        k.zaehler = aktuell.zaehler;
        k.dirty = false;
        k.aenderungen = 0;
        k.unveroeffentlicht = true;
        puffer.delete(pufferId);
        konfliktPlatz.replaceChildren();
        k.neuZeichnen();
        ctx.melde("Die aktuelle Fassung ist übernommen.", "ok");
        fertig(true);
      });
    });
  }

  // Nach «Zurückholen»: alles aus dem neuen Entwurf
  k.neuAusEntwurf = async () => {
    const neu = await anfrage("GET", `${API}/seiten/${id}/entwurf`);
    k.dok = neu.dokument ?? leer();
    k.zaehler = neu.zaehler;
    k.dirty = false;
    k.aenderungen = 0;
    k.unveroeffentlicht = neu.unveroeffentlicht;
    k.nr = neu.veroeffentlichteNr;
    puffer.delete(pufferId);
    k.neuZeichnen();
  };
  k.neuZeichnen = () => {
    ueberschrift.eingabe.value = k.dok.titel;
    zeichneListe();
    zeichneStatus();
  };

  // --- Überschrift der Seite (gehört zum Entwurf) und Einstellungen der Seite
  const ueberschrift = feld({
    label: "Überschrift auf der Seite",
    wert: k.dok.titel,
    maxlength: 120,
    autocomplete: "off",
    hilfe:
      "Die Überschrift ganz oben auf der Seite. Sie gehört zum Entwurf und gilt nach «Veröffentlichen».",
  });
  ueberschrift.eingabe.addEventListener("input", () => {
    k.dok.titel = ueberschrift.eingabe.value;
    k.aenderung();
  });

  // --- Liste der Bausteine: eine Sortierliste (Griff, Tastatur, Hoch und Runter; sortieren.js), darüber die festen Felder der Stufenseite
  const liste = el("div", { class: "ws-bausteine" });
  const festePlatz = el("ul", {
    class: "ws-fest",
    "aria-label": "Feste Felder",
  });
  let sortierung = null;
  const leerKarte = el(
    "div",
    { class: "ws-leer" },
    el("h2", {}, "Diese Seite hat noch keine Bausteine."),
    el("p", { class: "leise" }, "Füge den ersten hinzu."),
  );
  const hinzuKnopf = knopf("Baustein hinzufügen", {
    symbol: "plus",
    onclick: () => katalogDialog(k),
  });
  hinzuKnopf.classList.add("ws-gestrichelt");

  const chipsFuer = (b) => {
    const teile = [];
    if (b.sichtbarkeit !== "erbt") {
      teile.push(
        el(
          "li",
          { class: "chip" },
          symbol("schild"),
          sichtbarkeitText(b.sichtbarkeit, k.tagNamen),
        ),
      );
    }
    if (b === titelbildBaustein())
      teile.push(
        el("li", { class: "chip" }, symbol("bild"), "Titelbild der Seite"),
      );
    if (k.pruefen.has(b.id))
      teile.push(
        el(
          "li",
          { class: "chip chip--fehler" },
          symbol("warnung"),
          "Bitte prüfen",
        ),
      );
    return teile;
  };

  // fokus: { id, was } nach dem Zeichnen; was: hoch | runter | griff | bearbeiten | duplizieren | loeschen
  function zeichneListe(fokus) {
    const n = k.dok.bausteine.length;
    // Eine feste Zeile für die Felder der Stufenseite: Ihre Werte pflegt man unter «Samstagsangaben der Stufen», nicht im Dokument
    const stufe = k.tags.find(
      (t) => t.id === k.seite.tagId && t.typ === "stufe",
    );
    festePlatz.replaceChildren(...(stufe ? [festeFelder(stufe)] : []));
    const eintraege = k.dok.bausteine.map((b, i) => ({
      id: b.id,
      text: `${name(b)} ${i + 1}`,
      inhalt: bauzeile(b),
    }));
    if (!sortierung) {
      sortierung = sortierListe({
        beschriftung: "Bausteine",
        eintraege,
        beiNeu: neueReihenfolge,
      });
      liste.replaceChildren(festePlatz, sortierung.wurzel);
    } else sortierung.setze(eintraege);
    leerKarte.hidden = n > 0;
    zeichneTitelbild();
    if (fokus) setzeFokus(fokus);
  }

  // Die Sortierliste meldet die neue Reihenfolge (nach dem Ablegen oder einem Klick auf Hoch und Runter)
  function neueReihenfolge(ids) {
    const nachId = new Map(k.dok.bausteine.map((b) => [b.id, b]));
    const aktiv = document.activeElement;
    const bid = aktiv?.closest?.("[data-id]")?.dataset.id;
    k.dok.bausteine = ids.map((id) => nachId.get(id));
    k.aenderung();
    zeichneListe(bid ? { id: bid, was: aktiv.dataset.art } : undefined);
  }

  function bauzeile(b) {
    const bezeichnung = name(b);
    const mini = (aktion, label, symbolName, fn) =>
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund",
          "aria-label": `${label}: ${bezeichnung}`,
          "data-aktion": aktion,
          onclick: fn,
        },
        symbol(symbolName),
      );
    const bearbeiten = knopf("Bearbeiten", {
      klein: true,
      symbol: "bearbeiten",
      "aria-label": `Bearbeiten: ${bezeichnung}`,
      "data-aktion": "bearbeiten",
      onclick: () => bearbeitenBlatt(k, b, k.dok.bausteine.indexOf(b)),
    });
    const chips = chipsFuer(b);
    // Die Vorschau zeigt den Baustein mit den aktuellen Daten des Entwurfs, auch ungespeichert (#739)
    const vorschau = bausteinVorschau(k, b, bezeichnung);
    return el(
      "div",
      { class: "ws-bauzeile-block" },
      el(
        "div",
        { class: "ws-bauzeile" },
        el(
          "div",
          { class: "ws-bausteintext" },
          el("p", { class: "typ" }, bezeichnung),
          el("p", { class: "zus" }, kurzText(k, b) || "Noch ohne Inhalt"),
          chips.length > 0 ? el("ul", { class: "chips" }, chips) : null,
        ),
        el(
          "div",
          { class: "akt" },
          vorschau.knopf,
          bearbeiten,
          mini("duplizieren", "Duplizieren", "kopieren", () => dupliziere(b)),
          mini("loeschen", "Löschen", "papierkorb", () => loesche(b)),
        ),
      ),
      vorschau.panel,
    );
  }

  // --- Titelbild (#570): Die Website nimmt das erste Bild der Seite als Titelbild (rendereSeite). Hier steht das als Einstellung: wählen, tauschen, entfernen.
  // Gespeichert wird nichts Eigenes: Die Fläche setzt, tauscht oder löscht den Baustein «Bild» zuoberst
  const titelbildId = neueId("titelbild");
  const titelbild = el("section", {
    class: "flaeche ws-titelbild",
    "aria-labelledby": titelbildId,
  });
  const istStart = seite.elternId === null && seite.adresse === "start";
  function titelbildBaustein() {
    const b = k.dok.bausteine[0];
    return b?.typ === "bild" &&
      b.daten.mediumId &&
      (b.sichtbarkeit === "erbt" || b.sichtbarkeit.art === "oeffentlich")
      ? b
      : null;
  }
  function zeichneTitelbild() {
    const b = titelbildBaustein();
    const m = b && k.medien.get(b.daten.mediumId);
    const waehlen = knopf(b ? "Anderes Titelbild wählen" : "Titelbild wählen", {
      klein: true,
      onclick: () =>
        k.waehleBild((neu) => {
          k.medien.set(neu.id, neu);
          const da = titelbildBaustein();
          if (da) da.daten.mediumId = neu.id;
          else if (k.dok.bausteine.length >= MAX_BAUSTEINE) {
            ctx.melde(
              `Mehr als ${MAX_BAUSTEINE} Bausteine sind nicht möglich.`,
              "fehler",
            );
            return;
          } else
            k.dok.bausteine.unshift({
              id: neueUuid(),
              typ: "bild",
              daten: { mediumId: neu.id },
              sichtbarkeit: "erbt",
            });
          k.aenderung();
          zeichneListe();
          titelbild.querySelector("button")?.focus();
          ctx.melde("Das Titelbild ist gesetzt.");
        }),
    });
    titelbild.replaceChildren(
      el("h2", { id: titelbildId }, "Titelbild"),
      el(
        "div",
        { class: "ws-titelbild-in" },
        b &&
          el("img", {
            class: "ws-titelbild-bild",
            src: `/api/v1/medien/${b.daten.mediumId}`,
            alt: "",
          }),
        el(
          "div",
          { class: "ws-titelbild-text" },
          el(
            "p",
            { class: "klein leise" },
            b
              ? "Steht gross über der Seite, die Überschrift liegt darauf. Es ist der Baustein «Bild» zuoberst in der Liste: Dort änderst du Alt-Text und Bildunterschrift."
              : "Noch kein Titelbild: Die Überschrift steht auf einem ruhigen Band. Mit Titelbild steht sie gross über dem Foto.",
            istStart &&
              " Auf der Startseite liegen die Überschrift und die Schaltflächen gleich nach dem ersten Text als Karte im Titelbild.",
          ),
          m &&
            el(
              "p",
              { class: "klein" },
              m.dekorativ
                ? "Als Zierde markiert, ohne Alt-Text."
                : `Alt-Text: ${m.altText ?? ""}`,
            ),
          el(
            "div",
            { class: "ws-reihe" },
            waehlen,
            b &&
              knopf("Titelbild entfernen", {
                klein: true,
                onclick: () => loesche(b, 0),
              }),
          ),
        ),
      ),
    );
  }

  function festeFelder(stufe) {
    return el(
      "li",
      { class: "baustein fest" },
      el(
        "div",
        {},
        el(
          "p",
          { class: "typ" },
          "Feste Felder der Stufenseite (liest auch die App)",
        ),
        el(
          "p",
          { class: "zus" },
          `Datum, Treffpunkt, Schluss und Mitnehmen der Stufe ${stufe.name} pflegst du unter «Samstagsangaben der Stufen».`,
        ),
      ),
      el(
        "a",
        {
          class: "knopf knopf--klein",
          href: `#website/stufenfakten/${stufe.id}`,
          "aria-label": "Bearbeiten: Feste Felder",
        },
        symbol("bearbeiten"),
        "Bearbeiten",
      ),
    );
  }

  function setzeFokus({ id: bid, was }) {
    const block = liste.querySelector(`[data-id="${CSS.escape(bid)}"]`);
    let ziel = null;
    if (block) {
      const frei = ":not([disabled]):not([aria-disabled='true'])";
      const art = (a) => block.querySelector(`[data-art="${a}"]${frei}`);
      const akt = (a) => block.querySelector(`[data-aktion="${a}"]${frei}`);
      if (was === "hoch" || was === "runter") {
        ziel =
          art(was) ??
          art(was === "hoch" ? "runter" : "hoch") ??
          akt("bearbeiten");
      } else if (was === "griff") ziel = art("griff");
      else ziel = akt(was) ?? akt("bearbeiten");
    }
    (ziel ?? hinzuKnopf).focus();
  }
  k.zeichneListe = zeichneListe;

  const name = (b) => typName(b);

  function dupliziere(b) {
    const i = k.dok.bausteine.indexOf(b);
    if (k.dok.bausteine.length >= MAX_BAUSTEINE) {
      ctx.melde(
        `Mehr als ${MAX_BAUSTEINE} Bausteine sind nicht möglich.`,
        "fehler",
      );
      return;
    }
    const neu = { ...kopie(b), id: neueUuid() };
    k.dok.bausteine.splice(i + 1, 0, neu);
    k.aenderung();
    zeichneListe({ id: neu.id, was: "bearbeiten" });
    ctx.melde(
      `«${name(b)}» ist dupliziert. Die Kopie steht an Position ${i + 2}.`,
    );
  }

  // Mit «Rückgängig» (Toast, Strg+Z): Der Baustein verschwindet sofort aus dem Entwurf; zurückgeholt kommt er an dieselbe Stelle.
  // Auf dem Server ändert sich nichts, bevor die Person speichert
  function loesche(b) {
    const i = k.dok.bausteine.indexOf(b);
    if (i < 0) return;
    ctx.mitRueckgaengig({
      text: `Baustein «${name(b)}» gelöscht`,
      ansicht: {
        weg: () => {
          k.dok.bausteine.splice(k.dok.bausteine.indexOf(b), 1);
          k.pruefen.delete(b.id);
          k.aenderung();
          const nachbar = k.dok.bausteine[i] ?? k.dok.bausteine[i - 1];
          zeichneListe(nachbar && { id: nachbar.id, was: "bearbeiten" });
        },
        zurueck: () => {
          k.dok.bausteine.splice(Math.min(i, k.dok.bausteine.length), 0, b);
          k.aenderung();
          zeichneListe({ id: b.id, was: "bearbeiten" });
        },
      },
      ausfuehren: async () => {},
      erledigt: `Baustein «${name(b)}» ist aus dem Entwurf entfernt. Speichere die Seite, damit es gilt.`,
    });
  }

  // --- Vorschau (rechte Spalte): der gespeicherte Entwurf oder eine Version, im Rahmen ohne Skripte
  const vorschau = vorschauFlaeche(k, () =>
    k.dirty ? speichere() : Promise.resolve(true),
  );
  k.zeigeVersion = (nr) => vorschau.zeige(nr);

  // --- Einstellungen der Seite
  const einstellungen = einstellungenFlaeche(k, ueberschrift, verwalten, () => {
    ctx.titel(k.seite.titel, k.seite.pfad);
  });

  // --- Kopf: Zugriff (Sichtbarkeit und Bearbeiter in einem Panel neben dem Editor), Vorschau, Veröffentlichen mit weiteren Schritten im Menü
  const zugriffText = () =>
    `Zugriff: ${kuerze(sichtbarkeitText(k.seite.sichtbarkeit, k.tagNamen), 28)}`;
  knoepfe.zugriff = knopf(zugriffText(), {
    symbol: "schild",
    onclick: () =>
      sichtbarkeitBlatt({
        typ: "seite",
        frage: "Wer sieht die Seite?",
        titel: "Zugriff auf die Seite",
        untertitel: `${seite.titel} · ${seite.pfad}`,
        start: seite.sichtbarkeit,
        tagNamen: k.tagNamen,
        ladeTags: async () => {
          const { tags } = await anfrage("GET", `${API}/tags`);
          k.tags = tags;
          k.tagNamen = new Map(tags.map((t) => [t.id, t.name]));
          return tags;
        },
        speichere: async (wert) => {
          await patch(seite.id, { sichtbarkeit: wert });
          seite.sichtbarkeit = wert;
          knoepfe.zugriff.lastChild.textContent = zugriffText();
          ctx.melde("Der Zugriff auf die Seite ist gespeichert.", "ok");
        },
        rechte: {
          seite,
          siehtAlles: siehtAlles(ctx.ich),
          melde: ctx.melde,
        },
      }),
  });
  knoepfe.vorschau = mitSymbol(
    knopf("Vorschau", { onclick: () => vorschau.zeige(null, true) }),
    "vorschau",
  );
  const hilfeVeroeffentlichen = el(
    "span",
    { class: "mini leise", hidden: true },
    "Geht wieder, sobald du online bist.",
  );
  function kopfAktionen() {
    knoepfe.unpubliziert = k.nr === null;
    const split = splitKnopf({
      text: "Veröffentlichen",
      art: "haupt",
      onclick: () => {
        if (knoepfe.veroeffentlichen?.getAttribute("aria-disabled") === "true")
          return;
        veroeffentlichenDialog(k);
      },
      eintraege: [
        { text: "Entwurf speichern", onclick: () => speichere() },
        {
          text: "Versionen ansehen",
          onclick: () => veroeffentlichenDialog(k, "Versionen"),
        },
        {
          text: "Seite zurückziehen",
          gefaehrlich: true,
          gesperrt: k.nr === null,
          onclick: () => zurueckziehen(k),
        },
      ],
    });
    knoepfe.veroeffentlichen = split.haupt;
    ctx.kopfAktion(
      knoepfe.zugriff,
      knoepfe.vorschau,
      el(
        "span",
        { class: "ws-fussspalte" },
        split.wurzel,
        hilfeVeroeffentlichen,
      ),
    );
  }
  kopfAktionen();

  wurzel.append(
    konfliktPlatz,
    fehlerPlatz,
    el(
      "div",
      { class: "ws-editor" },
      el(
        "div",
        { class: "ws-spalte" },
        titelbild,
        liste,
        leerKarte,
        hinzuKnopf,
      ),
      el("div", { class: "ws-spalte" }, vorschau.wurzel, einstellungen),
    ),
  );
  zeichneListe();
  zeichneStatus();

  // Die Alt-Texte der Bilder stehen in den Medien: Ein Abruf für genau die Bilder der Seite, nur wenn sie welche hat (Datenbanklast)
  const bildIds = medienIds(k.dok).slice(0, 100);
  if (bildIds.length > 0) {
    anfrage("GET", `${API}/medien?limit=100&ids=${bildIds.join(",")}`).then(
      (a) => {
        for (const m of a.medien) k.medien.set(m.id, m);
        if (wurzel.isConnected) zeichneListe();
      },
      () => {},
    );
  }

  // Die Zeilen nennen, was erscheint: Namen der gewählten Personen und Grösse der Leitungsteams. Je ein Abruf, nur wenn die Seite solche Bausteine hat; danach einmal neu zeichnen
  const brauchtPersonen = k.dok.bausteine.some((b) =>
    ["personen", "kontaktperson", "kontaktkarte"].includes(b.typ),
  );
  const teamIds = new Set(
    k.dok.bausteine
      .filter((b) => b.typ === "leitungsteam" && b.daten.tagId)
      .map((b) => b.daten.tagId),
  );
  if (brauchtPersonen || teamIds.size > 0) {
    Promise.allSettled([
      ...(brauchtPersonen ? [ladePersonen(k)] : []),
      ...[...teamIds].map((id) => ladeTeam(k, id)),
    ]).then(() => {
      if (wurzel.isConnected) zeichneListe();
    });
  }

  // Strg+S oder Cmd+S speichert, solange der Editor sichtbar ist
  const taste = (e) => {
    if (!wurzel.isConnected)
      return document.removeEventListener("keydown", taste);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      speichere();
    }
    // F2 benennt die Seite um, ausser in einem Feld
    if (
      e.key === "F2" &&
      verwalten &&
      !e.target.closest?.("input, textarea, select")
    ) {
      e.preventDefault();
      benenne();
    }
  };
  document.addEventListener("keydown", taste);

  // Menü, Link, Browser-Zurück, Tab schliessen und Neuladen mit ungespeicherten Änderungen: Der Wächter (#699) fragt zuerst, hier mit «Speichern und verlassen». Der Puffer fängt zudem ab, was verloren ginge
  schuetze({
    schluessel: "website-editor",
    wurzel,
    geaendert: () => Boolean(k.dirty || k.einstellungenGeaendert?.()),
    frage: (ziel) => verlassenDialog(k, pufferId, ziel),
  });
}

// --- Rückfrage beim Verlassen (E2 «Verlassen Rückfrage») ----------------------------------------------------------------

function verlassenDialog(k, pufferId, ziel) {
  // Zweistufig im Fluss statt Fenster (#578): eine Zeile oben im Editor, die Seite bleibt bedienbar
  const alt = document.querySelector(".ws-verlassen");
  if (alt) {
    alt.querySelector("button").focus();
    return;
  }
  const bleiben = knopf("Bleiben", {
    klein: true,
    onclick: () => frage.remove(),
  });
  const speichernUndGehen = knopf("Speichern und verlassen", { klein: true });
  const verlassen = knopf("Verlassen", { klein: true });
  verlassen.classList.add("knopf--gefahr");
  const frage = el(
    "div",
    { class: "hinweis hinweis--warn fluss-frage ws-verlassen", role: "alert" },
    el(
      "span",
      {},
      "Wirklich verlassen? Du hast nicht gespeicherte Änderungen (Entwurf oder Einstellungen). Wenn du die Seite verlässt, gehen sie verloren.",
    ),
    bleiben,
    speichernUndGehen,
    verlassen,
  );
  (document.querySelector(".ws-editor-seite") ?? document.body).prepend(frage);
  bleiben.focus();
  bei(speichernUndGehen, async () => {
    beschaeftigt(speichernUndGehen, true);
    // Entwurf und Einstellungen: Scheitert eines, bleibt die Person hier
    const gespeichert =
      (!k.dirty || (await k.speichere())) &&
      (!k.einstellungenGeaendert?.() || (await k.speichereEinstellungen()));
    beschaeftigt(speichernUndGehen, false);
    // Bei einem Fehler bleibt die Person auf der Seite: Die Meldung steht dort
    frage.remove();
    if (gespeichert) wechsle(ziel);
  });
  bei(verlassen, () => {
    puffer.delete(pufferId);
    k.dirty = false;
    k.einstellungenGeaendert = () => false;
    frage.remove();
    wechsle(ziel);
  });
}

// --- Vorschau ---------------------------------------------------------------------------------------------------------

// Die Vorschau zeigt den gespeicherten Entwurf (oder eine Version) als Seite im Rahmen. Der Rahmen hat keine Skripte und liegt auf derselben Herkunft
function vorschauFlaeche(k, speichereZuerst) {
  const titelId = neueId("vorschau");
  const gruppeName = neueId("breite");
  const platz = el("div", { class: "ws-vorschauplatz" });
  const hinweisText = el("p", { class: "klein leise" });
  let mobil = false;
  let version = null;
  let zeigt = false;
  const optionen = [
    ["desktop", "Desktop"],
    ["mobil", "Mobil"],
  ].flatMap(([w, text]) => {
    const oid = neueId("breite-option");
    const e = el("input", {
      type: "radio",
      id: oid,
      name: gruppeName,
      value: w,
      onchange: () => {
        mobil = w === "mobil";
        platz
          .querySelector(".ws-huelle")
          ?.classList.toggle("ws-huelle--mobil", mobil);
        const r = platz.querySelector("iframe");
        if (r) r.title = `Vorschau der Seite, ${mobil ? "Mobil" : "Desktop"}`;
      },
    });
    e.checked = w === "desktop";
    return [e, el("label", { for: oid }, text)];
  });
  const wurzel = el(
    "section",
    { class: "flaeche", "aria-labelledby": titelId, tabindex: "-1" },
    el(
      "div",
      { class: "zeile" },
      el("h2", { id: titelId }, "Vorschau"),
      el(
        "div",
        { class: "seg", role: "group", "aria-label": "Vorschau-Grösse" },
        optionen,
      ),
    ),
    platz,
    hinweisText,
  );
  const startZustand = () => {
    zeigt = false;
    hinweisText.textContent = "";
    platz.replaceChildren(
      el(
        "div",
        { class: "ws-vorschau-leer" },
        el(
          "p",
          { class: "leise" },
          "Die Vorschau zeigt den gespeicherten Entwurf, so wie die Website ihn zeigt.",
        ),
        mitSymbol(
          knopf("Vorschau laden", {
            klein: true,
            onclick: () => zeige(null, false),
          }),
          "vorschau",
        ),
      ),
    );
  };
  startZustand();

  async function zeige(nr, fokus = true) {
    // Die Vorschau zeigt den gespeicherten Entwurf: Erst speichern, damit sie stimmt
    if (nr === null && !(await speichereZuerst())) return;
    version = nr;
    zeigt = true;
    const adresse = `${API}/seiten/${k.id}/vorschau${nr === null ? "" : `?version=${nr}`}`;
    // Die Fläche ist klein: Der Link zeigt dieselbe Vorschau in voller Grösse
    hinweisText.replaceChildren(
      nr === null
        ? "Der gespeicherte Entwurf, hell und ohne Menü. Auch Bausteine nur für Angemeldete oder Gruppen sind sichtbar. Das Karussell läuft hier nicht, Links führen nirgends hin. "
        : `Version ${nr}, nicht der aktuelle Entwurf. Das Karussell läuft hier nicht, Links führen nirgends hin. `,
      el(
        "a",
        { href: adresse, target: "_blank", rel: "noopener" },
        "Vorschau gross in neuem Tab öffnen",
      ),
    );
    const rahmen = el("iframe", {
      class: "ws-rahmen",
      sandbox: "allow-same-origin",
      referrerpolicy: "no-referrer",
      title: `Vorschau der Seite, ${mobil ? "Mobil" : "Desktop"}`,
    });
    const huelle = el(
      "div",
      {
        class: mobil ? "ws-huelle ws-huelle--mobil" : "ws-huelle",
        "aria-busy": "true",
      },
      rahmen,
    );
    const laden = el(
      "div",
      { class: "ws-vorschau-laden", "aria-hidden": "true" },
      sk("t", 160),
      sk("t", 112),
      sk("b", 320),
      sk("t", 260),
    );
    const live = el(
      "p",
      { class: "nur-leser", role: "status" },
      "Vorschau lädt …",
    );
    platz.replaceChildren(huelle, laden, live);
    rahmen.addEventListener("load", () => {
      // Antwortet der Server mit einem Fehler, steht JSON im Rahmen: Dann zeigt die Fläche den Zustand statt des Textes
      const fehlerhaft = (() => {
        try {
          return rahmen.contentDocument?.contentType === "application/json";
        } catch {
          return false;
        }
      })();
      huelle.removeAttribute("aria-busy");
      laden.remove();
      if (fehlerhaft) {
        platz.replaceChildren(
          el(
            "div",
            { class: "zustand", role: "alert" },
            el("h3", {}, "Die Vorschau konnte nicht laden."),
            el(
              "p",
              { class: "leise" },
              "Prüfe die Verbindung. Deine Eingaben sind noch da.",
            ),
            knopf("Nochmals versuchen", {
              klein: true,
              onclick: () => zeige(version, false),
            }),
          ),
        );
        return;
      }
      live.textContent = "Die Vorschau ist geladen.";
    });
    rahmen.setAttribute("src", adresse);
    if (fokus) {
      wurzel.scrollIntoView({ block: "nearest" });
      wurzel.focus();
    }
    void zeigt;
  }
  return { wurzel, zeige };
}

// --- Einstellungen der Seite (rechte Spalte, E2) ---------------------------------------------------------------------
// Adresse (mit Live-Prüfung und der Adresse der Elternseite davor), Elternseite und die Überschrift des Entwurfs. Titel und Position stehen im Kopf und im Seitenbaum, Zugriff im Panel «Zugriff».
// Eine geänderte, noch nicht gespeicherte Einstellung zählt für die Rückfrage beim Verlassen (k.einstellungenGeaendert, k.speichereEinstellungen).

function einstellungenFlaeche(k, ueberschrift, verwalten, beiNeuerAdresse) {
  const { seite } = k;
  const titelId = neueId("einst");
  const baum = baueBaum(k.alle);
  const adresse = feld({
    label: "Adresse",
    wert: seite.adresse,
    maxlength: 60,
    required: true,
    autocomplete: "off",
    spellcheck: "false",
  });
  adresse.eingabe.classList.add("mono");
  // Die Adresse mit der Adresse der Elternseite davor, wie sie online steht
  const praefix = el("span", { class: "ws-handle-praefix mono" }, "/");
  const zeile = el("div", { class: "ws-handle-zeile" }, praefix);
  adresse.eingabe.before(zeile);
  zeile.append(adresse.eingabe);
  const stand = el("p", { class: "hilfe ws-adressstand", role: "status" });
  adresse.wurzel.append(stand);
  const verboten = baum.nachfahren(seite.id);
  verboten.add(seite.id);
  const hoehe = baum.hoehe(seite.id);
  let eltern = null;
  if (verwalten) {
    const optionen = [
      ["", "Oberste Ebene"],
      ...k.alle
        .filter(
          (s) =>
            !verboten.has(s.id) &&
            (baum.ebenen.get(s.id) ?? 0) + 1 + hoehe <= MAX_TIEFE,
        )
        .map((s) => [s.id, `${s.titel} (${s.pfad})`]),
    ];
    const id = neueId("eltern");
    const select = el(
      "select",
      { id, class: "ws-select" },
      optionen.map(([w, t]) => el("option", { value: w }, t)),
    );
    select.value = seite.elternId ?? "";
    eltern = {
      wurzel: el(
        "div",
        { class: "feld" },
        el("label", { for: id }, "Elternseite"),
        select,
        el(
          "p",
          { class: "hilfe" },
          "Die Reihenfolge ordnest du in der Liste der Seiten, per Ziehen oder mit dem Menü «Mehr».",
        ),
      ),
      eingabe: select,
    };
  }
  const geaendert = () =>
    adresse.eingabe.value.trim() !== seite.adresse ||
    (eltern !== null && (eltern.eingabe.value || null) !== seite.elternId);
  k.einstellungenGeaendert = geaendert;

  const speichern = knopf("Einstellungen speichern", { klein: true });
  const fehlerPlatz = el("div", {});
  const rest = (text) => (
    fehlerPlatz.replaceChildren(band("fehler", text)),
    fehlerPlatz.firstChild.setAttribute("tabindex", "-1"),
    fehlerPlatz.firstChild.focus()
  );

  // Live-Prüfung gegen die Seiten unter derselben Elternseite; der Server prüft zusätzlich
  const pruefe = () => {
    const wert = adresse.eingabe.value.trim();
    const vater = eltern ? eltern.eingabe.value : (seite.elternId ?? "");
    const vaterSeite = k.alle.find((s) => s.id === vater);
    praefix.textContent = `${vaterSeite ? vaterSeite.pfad : ""}/`;
    let r = { art: "info", text: "So steht die Seite online." };
    if (!ADRESSE.test(wert)) {
      r = {
        art: "fehler",
        text: "Nur Kleinbuchstaben, Ziffern und «-», höchstens 60 Zeichen.",
      };
    } else if (
      k.alle.some(
        (s) =>
          s.id !== seite.id &&
          (s.elternId ?? "") === vater &&
          s.adresse === wert,
      )
    ) {
      r = { art: "fehler", text: "Diese Adresse ist hier schon vergeben." };
    } else if (vater === "" && RESERVIERT.includes(wert)) {
      r = {
        art: "fehler",
        text: "Diese Adresse gehört der Verwaltung oder der Website.",
      };
    } else if (geaendert() && k.nr !== null) {
      r = {
        art: "warn",
        text: "Die Seite ist veröffentlicht: Der alte Link führt danach ins Leere, wenn niemand weiterleitet.",
      };
    }
    stand.replaceChildren(
      r.art === "fehler" || r.art === "warn" ? symbol("warnung") : "",
      r.text,
    );
    stand.dataset.art = r.art;
    adresse.eingabe.setAttribute(
      "aria-invalid",
      r.art === "fehler" ? "true" : "false",
    );
    return r;
  };
  adresse.eingabe.addEventListener("input", pruefe);
  eltern?.eingabe.addEventListener("change", pruefe);
  pruefe();

  async function speichereEinstellungen() {
    fehlerPlatz.replaceChildren();
    const neuAdresse = adresse.eingabe.value.trim();
    if (pruefe().art === "fehler") {
      rest(stand.textContent);
      return false;
    }
    const aenderung = {};
    if (neuAdresse !== seite.adresse) aenderung.adresse = neuAdresse;
    const weitere = [];
    if (eltern) {
      const neuEltern = eltern.eingabe.value || null;
      if (neuEltern !== seite.elternId) {
        // Wechselt die Elternseite, kommt die Seite ans Ende
        const { aenderungen } = plane(k.alle, seite, neuEltern, Infinity);
        for (const a of aenderungen) {
          if (a.id === seite.id) Object.assign(aenderung, koerper(a));
          else weitere.push(a);
        }
      }
    }
    if (Object.keys(aenderung).length === 0 && weitere.length === 0) {
      k.ctx.melde("Nichts geändert.", "info");
      return true;
    }
    beschaeftigt(speichern, true);
    try {
      const alt = k.alle.map((s) => ({ ...s }));
      if (Object.keys(aenderung).length > 0) await patch(seite.id, aenderung);
      for (const a of weitere) await patch(a.id, koerper(a));
      const neu = await anfrage("GET", `${API}/seiten/${seite.id}`);
      Object.assign(seite, neu);
      // Die Abteilungsleitung sieht alle Seiten: ihre Adressen folgen der neuen Lage
      if (eltern) {
        const liste = await anfrage("GET", `${API}/seiten`);
        k.alle.splice(0, k.alle.length, ...liste.seiten);
      } else {
        const meine = k.alle.find((s) => s.id === seite.id);
        if (meine) Object.assign(meine, neu);
      }
      adresse.eingabe.value = seite.adresse;
      pruefe();
      beiNeuerAdresse();
      k.ctx.melde(
        `Die Einstellungen von «${kuerze(seite.titel, 60)}» sind gespeichert.`,
        "ok",
      );
      weiterleitungsHinweis(
        k.ctx,
        geaenderteAdressen(alt, k.alle),
        seite.titel,
      );
      return true;
    } catch (f) {
      rest(
        f?.meldung &&
          [
            "ADRESSE_RESERVIERT",
            "ADRESSE_VERGEBEN",
            "SEITE_ZYKLUS",
            "SEITE_ZU_TIEF",
          ].includes(f.code)
          ? f.meldung
          : fehlertext(f),
      );
      return false;
    } finally {
      beschaeftigt(speichern, false);
    }
  }
  k.speichereEinstellungen = speichereEinstellungen;
  bei(speichern, speichereEinstellungen);

  return el(
    "section",
    { class: "flaeche ws-einstellungen", "aria-labelledby": titelId },
    el("h2", { id: titelId }, "Seiteneinstellungen"),
    ueberschrift.wurzel,
    adresse.wurzel,
    eltern?.wurzel,
    fehlerPlatz,
    el("div", { class: "ws-reihe" }, speichern),
  );
}
