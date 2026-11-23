import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { zurueckKlick } from "./verlauf.js";
import { el, feld, knopf, neueId } from "./dom.js";
import { sk } from "./lader.js";
import { zeichen } from "./zustaende.js";
import {
  ADRESSE,
  MAX_TIEFE,
  API,
  baue as baueBaum,
  koerper,
  patch,
  plane,
} from "./website-baum.js";
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
import { sichtbarkeitBlatt } from "./website-sichtbarkeit.js";
import { mitSymbol, symbol } from "./website-symbole.js";
import {
  veroeffentlichenDialog,
  vergleiche,
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
    geloescht: null,
  };
  if (gepuffert)
    // «warn», damit sie bleibt: Die Änderungen sind noch nicht gespeichert
    ctx.melde("Deine ungespeicherten Änderungen sind wieder da.", "warn");

  const wurzel = el("div", { class: "ws-editor-seite" });
  bereich.append(wurzel);

  // Titel, Zurück-Link und Zustand im Seitenkopf der Verwaltung
  ctx.titel(seite.titel, seite.pfad);
  const titelChip = el("span", { class: "ws-titelchip" });
  const kopfEl = document.getElementById("seitenkopf");
  const h1 = kopfEl?.querySelector("h1");
  if (h1) {
    const zeileEl = el("div", { class: "ws-titelzeile" });
    h1.replaceWith(zeileEl);
    zeileEl.append(h1, titelChip);
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
  }

  const ansage = el("p", { class: "nur-leser", role: "status" });

  // --- Stand: Zeichen im Kopf, Zeile unter der Liste, Knöpfe oben
  const stand = el("p", { class: "fusszeile", role: "status" });
  const speichernKnopf = knopf("Speichern", { klein: true });
  const knoepfe = {};

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
          ? `Zuletzt gespeichert um ${uhrzeit.format(k.gespeichertAm)}`
          : "Der Entwurf ist gespeichert.",
      );
    }
    stand.replaceChildren(
      ...inhalt,
      ...(!k.speichert && k.dirty ? [speichernKnopf] : []),
    );
    if (k.speichert) stand.append(speichernKnopf);
    knoepfe.veroeffentlichen.removeAttribute("aria-disabled");
    if (k.offline) {
      knoepfe.veroeffentlichen.setAttribute("aria-disabled", "true");
    }
    hilfeVeroeffentlichen.hidden = !k.offline;
  }

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
        k.geloescht = null;
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
    k.geloescht = null;
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

  // --- Liste der Bausteine
  const liste = el("ul", { class: "ws-bausteine", "aria-label": "Bausteine" });
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

  // Der Platz eines gelöschten Bausteins: Die Snackbar mit «Rückgängig» bleibt, bis die Person etwas anderes tut
  let snack = null;
  const commitGeloescht = () => {
    k.geloescht = null;
    snack?.remove();
    snack = null;
  };

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

  // fokus: { id, was, index } nach dem Zeichnen; was: hoch | runter | bearbeiten | griff | loeschen
  function zeichneListe(fokus) {
    liste.replaceChildren();
    const n = k.dok.bausteine.length;
    // Eine feste Zeile für die Felder der Stufenseite: Ihre Werte pflegt man unter «Stufenfelder», nicht im Dokument
    const stufe = k.tags.find(
      (t) => t.id === k.seite.tagId && t.typ === "stufe",
    );
    if (stufe) liste.append(festeFelder(stufe));
    k.dok.bausteine.forEach((b, i) => liste.append(karte(b, i, n)));
    leerKarte.hidden = n > 0;
    zeichneTitelbild();
    if (fokus) setzeFokus(fokus);
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
          commitGeloescht();
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
          ansage.textContent = "Das Titelbild ist gesetzt.";
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
          `Datum, Treffpunkt, Schluss und Mitnehmen der Stufe ${stufe.name} pflegst du unter «Stufenfelder».`,
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
    const block = liste.querySelector(`[data-block="${bid}"]`);
    let ziel = null;
    if (was === "rueckgaengig") ziel = snack?.querySelector("button");
    else if (block) {
      const such = (a) =>
        block.querySelector(`[data-aktion="${a}"]:not([aria-disabled="true"])`);
      if (was === "hoch" || was === "runter") {
        ziel =
          such(was) ??
          such(was === "hoch" ? "runter" : "hoch") ??
          such("bearbeiten");
      } else ziel = such(was) ?? such("bearbeiten");
    }
    (ziel ?? hinzuKnopf).focus();
  }
  k.zeichneListe = zeichneListe;

  const name = (b) => typName(b);

  function verschiebe(i, ziel, was, text = true) {
    commitGeloescht();
    const [b] = k.dok.bausteine.splice(i, 1);
    k.dok.bausteine.splice(ziel, 0, b);
    k.aenderung();
    zeichneListe({ id: b.id, was });
    if (text)
      ansage.textContent = `«${name(b)}» steht jetzt an Position ${ziel + 1} von ${k.dok.bausteine.length}.`;
  }

  // Ziehen mit der Maus und mit der Tastatur (Leertaste nimmt auf, Pfeiltasten verschieben, Leertaste legt ab, Escape bricht ab)
  let aufgenommen = null;
  function griffTaste(e, b, i) {
    const start = aufgenommen;
    if (!start && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      aufgenommen = { id: b.id, von: i };
      e.currentTarget.setAttribute("aria-pressed", "true");
      ansage.textContent = `«${name(b)}» aufgenommen, Position ${i + 1} von ${k.dok.bausteine.length}. Mit den Pfeiltasten verschieben, mit der Leertaste ablegen, mit Escape abbrechen.`;
      return;
    }
    if (!start || start.id !== b.id) return;
    const jetzt = k.dok.bausteine.findIndex((x) => x.id === b.id);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const ziel = jetzt + (e.key === "ArrowUp" ? -1 : 1);
      if (ziel < 0 || ziel >= k.dok.bausteine.length) return;
      verschiebe(jetzt, ziel, "griff");
      liste
        .querySelector(`[data-block="${b.id}"] .griff`)
        ?.setAttribute("aria-pressed", "true");
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      aufgenommen = null;
      e.currentTarget.setAttribute("aria-pressed", "false");
      ansage.textContent = `«${name(b)}» abgelegt an Position ${jetzt + 1} von ${k.dok.bausteine.length}.`;
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aufgenommen = null;
      if (jetzt !== start.von) verschiebe(jetzt, start.von, "griff", false);
      ansage.textContent = `Verschieben abgebrochen. «${name(b)}» steht wieder an Position ${start.von + 1}.`;
    }
  }

  let gezogen = null;
  const ablage = el(
    "li",
    { class: "ablage", "aria-hidden": "true" },
    symbol("ablegen"),
    "Hier ablegen",
  );
  function dragZiel(e) {
    if (!gezogen) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const li = e.target.closest?.("li[data-block]");
    if (!li || li.dataset.block === gezogen.id) return;
    const r = li.getBoundingClientRect();
    const vor = e.clientY < r.top + r.height / 2;
    if (vor) li.before(ablage);
    else li.after(ablage);
  }
  liste.addEventListener("dragover", dragZiel);
  liste.addEventListener("drop", (e) => {
    if (!gezogen || !ablage.isConnected) return;
    e.preventDefault();
    const bloecke = [...liste.querySelectorAll("li[data-block]")].filter(
      (li) => li.dataset.block !== gezogen.id,
    );
    const pos = bloecke.findIndex(
      (li) =>
        li.compareDocumentPosition(ablage) & Node.DOCUMENT_POSITION_PRECEDING,
    );
    const ziel = pos === -1 ? 0 : pos + 1;
    const von = k.dok.bausteine.findIndex((b) => b.id === gezogen.id);
    gezogen = null;
    ablage.remove();
    if (von !== -1 && von !== ziel) verschiebe(von, ziel, "griff");
    else zeichneListe();
  });

  function karte(b, i, n) {
    const bezeichnung = name(b);
    const mini = (aktion, label, symbolName, fn, versteckt) =>
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund",
          "aria-label": `${label}: ${bezeichnung}`,
          "data-aktion": aktion,
          "aria-disabled": versteckt ? "true" : undefined,
          tabindex: versteckt ? "-1" : undefined,
          onclick: versteckt ? undefined : fn,
        },
        symbol(symbolName),
      );
    const hoch = mini(
      "hoch",
      "Nach oben",
      "hoch",
      () => verschiebe(i, i - 1, "hoch"),
      i === 0,
    );
    const runter = mini(
      "runter",
      "Nach unten",
      "runter",
      () => verschiebe(i, i + 1, "runter"),
      i === n - 1,
    );
    if (i === 0) hoch.classList.add("ws-unsichtbar");
    if (i === n - 1) runter.classList.add("ws-unsichtbar");
    const griff = el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund griff",
        "data-aktion": "griff",
        "aria-pressed": aufgenommen?.id === b.id ? "true" : "false",
        "aria-label": `Ziehen: ${bezeichnung}. Mit Leertaste aufnehmen, mit Pfeiltasten verschieben.`,
        onkeydown: (e) => griffTaste(e, b, i),
        onpointerdown: (e) => {
          if (e.pointerType === "mouse") li.draggable = true;
        },
        onpointerup: () => {
          li.draggable = false;
        },
      },
      symbol("griff"),
    );
    const bearbeiten = knopf("Bearbeiten", {
      klein: true,
      symbol: "bearbeiten",
      "aria-label": `Bearbeiten: ${bezeichnung}`,
      "data-aktion": "bearbeiten",
      onclick: () => {
        commitGeloescht();
        const index = k.dok.bausteine.indexOf(b);
        bearbeitenBlatt(k, b, index);
      },
    });
    const dup = mini("duplizieren", "Duplizieren", "kopieren", () =>
      dupliziere(b, i),
    );
    const loeschen = mini("loeschen", "Löschen", "papierkorb", () =>
      loesche(b, i),
    );
    const li = el(
      "li",
      { class: "baustein", "data-block": b.id, draggable: undefined },
      griff,
      el(
        "div",
        { class: "ws-bausteintext" },
        el("p", { class: "typ" }, bezeichnung),
        el("p", { class: "zus" }, kurzText(k, b) || "Noch ohne Inhalt"),
        chipsFuer(b).length > 0
          ? el("ul", { class: "chips" }, chipsFuer(b))
          : null,
      ),
      el("div", { class: "akt" }, hoch, runter, bearbeiten, dup, loeschen),
    );
    li.addEventListener("dragstart", (e) => {
      gezogen = { id: b.id };
      commitGeloescht();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", b.id);
      window.requestAnimationFrame(() => li.classList.add("gezogen"));
    });
    li.addEventListener("dragend", () => {
      gezogen = null;
      li.draggable = false;
      li.classList.remove("gezogen");
      ablage.remove();
    });
    return li;
  }

  function dupliziere(b, i) {
    commitGeloescht();
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
    ansage.textContent = `«${name(b)}» ist dupliziert. Die Kopie steht an Position ${i + 2}.`;
  }

  function loesche(b, i) {
    commitGeloescht();
    k.dok.bausteine.splice(i, 1);
    k.geloescht = { block: b, index: i };
    k.pruefen.delete(b.id);
    k.aenderung();
    snack = el(
      "div",
      { class: "snack", role: "status" },
      `Baustein «${name(b)}» gelöscht.`,
      knopf("Rückgängig", {
        onclick: () => {
          k.dok.bausteine.splice(Math.min(i, k.dok.bausteine.length), 0, b);
          commitGeloescht();
          k.aenderung();
          zeichneListe({ id: b.id, was: "loeschen" });
          ansage.textContent = `«${name(b)}» ist wiederhergestellt.`;
        },
      }),
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund",
          "aria-label": "Hinweis schliessen",
          onclick: () => {
            commitGeloescht();
            (liste.querySelector("button") ?? hinzuKnopf).focus();
          },
        },
        symbol("schliessen"),
      ),
    );
    snack
      .querySelector(".knopf:not(.knopf--rund)")
      .classList.add("knopf--still");
    document.body.append(snack);
    zeichneListe();
    snack.querySelector("button").focus();
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

  // --- Kopf
  knoepfe.vorschau = mitSymbol(
    knopf("Vorschau", { onclick: () => vorschau.zeige(null, true) }),
    "vorschau",
  );
  knoepfe.versionen = knopf("Versionen", {
    symbol: "uhr",
    "aria-haspopup": "dialog",
    onclick: () => veroeffentlichenDialog(k, "Versionen"),
  });
  knoepfe.veroeffentlichen = knopf("Veröffentlichen", { art: "haupt" });
  bei(knoepfe.veroeffentlichen, () => veroeffentlichenDialog(k));
  const hilfeVeroeffentlichen = el(
    "span",
    { class: "mini leise", hidden: true },
    "Geht wieder, sobald du online bist.",
  );
  ctx.kopfAktion(
    knoepfe.vorschau,
    knoepfe.versionen,
    el(
      "span",
      { class: "ws-fussspalte" },
      knoepfe.veroeffentlichen,
      hilfeVeroeffentlichen,
    ),
  );

  wurzel.append(
    ansage,
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
        stand,
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

  // Strg+S oder Cmd+S speichert, solange der Editor sichtbar ist
  const taste = (e) => {
    if (!wurzel.isConnected)
      return document.removeEventListener("keydown", taste);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      speichere();
    }
  };
  document.addEventListener("keydown", taste);

  // Tab schliessen oder neu laden mit ungespeicherten Änderungen
  const vorDemSchliessen = (e) => {
    if (!wurzel.isConnected)
      return window.removeEventListener("beforeunload", vorDemSchliessen);
    if (k.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", vorDemSchliessen);

  // Ein Link der Verwaltung mitten in ungespeicherten Änderungen: erst fragen. (Die Zurück-Taste fängt der Puffer auf.)
  const beiKlick = (e) => {
    if (!wurzel.isConnected)
      return document.removeEventListener("click", beiKlick, true);
    const a = e.target.closest?.("a[href^='#']");
    if (!a || !k.dirty) return;
    const ziel = a.getAttribute("href");
    if (ziel === "#inhalt" || ziel === location.hash || ziel === "#") return;
    e.preventDefault();
    e.stopPropagation();
    verlassenDialog(k, pufferId, ziel);
  };
  document.addEventListener("click", beiKlick, true);
  // Die Snackbar gehört zur Seite: Mit dem Editor geht sie
  const wachter = new window.MutationObserver(() => {
    if (!wurzel.isConnected) {
      snack?.remove();
      wachter.disconnect();
    }
  });
  wachter.observe(bereich.parentElement ?? document.body, {
    childList: true,
    subtree: true,
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
      "Wirklich verlassen? Du hast nicht gespeicherte Änderungen. Wenn du die Seite verlässt, gehen sie verloren.",
    ),
    bleiben,
    speichernUndGehen,
    verlassen,
  );
  (document.querySelector(".ws-editor-seite") ?? document.body).prepend(frage);
  bleiben.focus();
  bei(speichernUndGehen, async () => {
    beschaeftigt(speichernUndGehen, true);
    const gespeichert = await k.speichere();
    beschaeftigt(speichernUndGehen, false);
    // Bei einem Fehler bleibt die Person auf der Seite: Die Meldung steht dort
    frage.remove();
    if (gespeichert) location.hash = ziel;
  });
  bei(verlassen, () => {
    puffer.delete(pufferId);
    k.dirty = false;
    frage.remove();
    location.hash = ziel;
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

function einstellungenFlaeche(k, ueberschrift, verwalten, beiNeuerAdresse) {
  const { seite } = k;
  const titelId = neueId("einst");
  const baum = baueBaum(k.alle);
  const index = Math.max(
    0,
    baum.zeilen.find((z) => z.seite.id === seite.id)?.index ?? 0,
  );
  const titel = feld({
    label: "Titel",
    wert: seite.titel,
    maxlength: 150,
    required: true,
    hilfe: "So heisst die Seite in der Liste und in der Navigation.",
  });
  const adresse = feld({
    label: "Adresse",
    wert: seite.adresse,
    maxlength: 60,
    required: true,
    autocomplete: "off",
    spellcheck: "false",
    hilfe:
      "Nur Kleinbuchstaben, Ziffern und «-». Ändert sich die Adresse, ändert sich auch die Adresse der veröffentlichten Seite.",
  });
  adresse.eingabe.classList.add("mono");
  const verboten = baum.nachfahren(seite.id);
  verboten.add(seite.id);
  const hoehe = baum.hoehe(seite.id);
  let eltern = null;
  let position = null;
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
      ),
      eingabe: select,
    };
    position = feld({
      label: "Position",
      typ: "number",
      wert: String(index + 1),
      min: 1,
      inputmode: "numeric",
      hilfe: "1 steht ganz oben unter der Elternseite.",
    });
    position.eingabe.classList.add("ws-kurzfeld");
  }
  const sichtText = el("span", { class: "chip" });
  const zeichneSicht = () => {
    sichtText.replaceChildren(
      symbol("schild"),
      sichtbarkeitText(seite.sichtbarkeit, k.tagNamen),
    );
  };
  zeichneSicht();
  const aendern = knopf("Ändern", {
    klein: true,
    "aria-label": "Sichtbarkeit der Seite ändern",
    onclick: oeffneSicht,
  });
  const speichern = knopf("Einstellungen speichern", { klein: true });
  const fehlerPlatz = el("div", {});
  const rest = (text) => (
    fehlerPlatz.replaceChildren(band("fehler", text)),
    fehlerPlatz.firstChild.setAttribute("tabindex", "-1"),
    fehlerPlatz.firstChild.focus()
  );

  function oeffneSicht() {
    sichtbarkeitBlatt({
      typ: "seite",
      frage: "Wer sieht die Seite?",
      titel: "Sichtbarkeit der Seite",
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
        zeichneSicht();
        k.ctx.melde("Die Sichtbarkeit der Seite ist gespeichert.", "ok");
      },
      rechte: {
        seite,
        istAdmin: k.ctx.ich.role === "admin",
        melde: k.ctx.melde,
      },
    });
  }

  bei(speichern, async () => {
    fehlerPlatz.replaceChildren();
    const neuAdresse = adresse.eingabe.value.trim();
    const neuTitel = titel.eingabe.value.trim();
    if (!neuTitel) return rest("Der Titel fehlt.");
    if (!ADRESSE.test(neuAdresse)) {
      return rest(
        "Die Adresse darf nur Kleinbuchstaben, Ziffern und «-» enthalten und höchstens 60 Zeichen lang sein.",
      );
    }
    const aenderung = {};
    if (neuTitel !== seite.titel) aenderung.titel = neuTitel;
    if (neuAdresse !== seite.adresse) aenderung.adresse = neuAdresse;
    const weitere = [];
    if (verwalten) {
      const neuEltern = eltern.eingabe.value || null;
      const pos = Number(position.eingabe.value.trim());
      if (!Number.isInteger(pos) || pos < 1)
        return rest("Die Position ist eine ganze Zahl ab 1.");
      const elternGeaendert = neuEltern !== seite.elternId;
      const posGeaendert = pos !== index + 1;
      if (elternGeaendert || posGeaendert) {
        // Wechselt nur die Elternseite, kommt die Seite ans Ende
        const { aenderungen } = plane(
          k.alle,
          seite,
          neuEltern,
          elternGeaendert && !posGeaendert ? Infinity : pos - 1,
        );
        for (const a of aenderungen) {
          if (a.id === seite.id) Object.assign(aenderung, koerper(a));
          else weitere.push(a);
        }
      }
    }
    if (Object.keys(aenderung).length === 0 && weitere.length === 0) {
      k.ctx.melde("Nichts geändert.", "info");
      return;
    }
    beschaeftigt(speichern, true);
    try {
      if (Object.keys(aenderung).length > 0) await patch(seite.id, aenderung);
      for (const a of weitere) await patch(a.id, koerper(a));
      const neu = await anfrage("GET", `${API}/seiten/${seite.id}`);
      Object.assign(seite, neu);
      adresse.eingabe.value = seite.adresse;
      beiNeuerAdresse();
      k.ctx.melde(`«${kuerze(seite.titel, 60)}» ist gespeichert.`, "ok");
    } catch (f) {
      const text =
        f?.meldung &&
        [
          "ADRESSE_RESERVIERT",
          "ADRESSE_VERGEBEN",
          "SEITE_ZYKLUS",
          "SEITE_ZU_TIEF",
        ].includes(f.code)
          ? f.meldung
          : fehlertext(f);
      rest(text);
    } finally {
      beschaeftigt(speichern, false);
    }
  });

  return el(
    "section",
    { class: "flaeche ws-einstellungen", "aria-labelledby": titelId },
    el("h2", { id: titelId }, "Seiteneinstellungen"),
    titel.wurzel,
    ueberschrift.wurzel,
    adresse.wurzel,
    eltern?.wurzel,
    position?.wurzel,
    el(
      "div",
      { class: "feld" },
      el("span", { class: "legende" }, "Sichtbarkeit"),
      el("div", { class: "zeile" }, sichtText, aendern),
    ),
    fehlerPlatz,
    el("div", { class: "ws-reihe" }, speichern),
  );
}
