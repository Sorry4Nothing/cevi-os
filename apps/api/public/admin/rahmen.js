// Rahmen der Verwaltung nach dem Design (A1, G4): Logozeile mit Konto, blaue Bereichsleiste, darunter die Unterleiste des aktiven Bereichs mit Zählern; dazu die Rückmeldungen.
import { adresseVon } from "./navigation.js";
import { avatar, el, icon, knopf, leere } from "./dom.js";

// Marke im Kopf wie auf der Website (#578): das Logo der Abteilung (hell und, falls gesetzt, dunkel) oder die Wortmarke «CEVI» mit dem Namen.
// Name und Logo kommen aus den Einstellungen der Website (GET /api/v1/redaktion/website) und stehen nie im Code; ohne sie (kein Recht auf die Einstellungen, nichts gesetzt) bleibt die Wortmarke «CEVI» allein.
let markeDaten = { name: "", logoId: null, logoDunkelId: null };
const medienUrl = (id) => `/api/v1/medien/${encodeURIComponent(id)}`;

function erstelleMarke() {
  const { name, logoId, logoDunkelId } = markeDaten;
  if (!logoId) {
    return el(
      "a",
      { class: "marke", href: "#" },
      el("b", {}, "CEVI"),
      name && el("span", {}, name),
    );
  }
  const bild = (klasse, id) =>
    el("img", {
      class: klasse,
      src: medienUrl(id),
      alt: "",
      decoding: "async",
    });
  return el(
    "a",
    {
      class: `marke marke--logo${logoDunkelId ? " marke--zwei" : ""}`,
      href: "#",
    },
    bild(logoDunkelId ? "logo logo--hell" : "logo", logoId),
    logoDunkelId && bild("logo logo--dunkel", logoDunkelId),
    el("span", { class: "nur-leser" }, name || "Cevi"),
  );
}

// Setzt Name und Logo und ersetzt die Marke, wo sie schon steht; spätere Köpfe nutzen den gemerkten Stand
export function setzeMarke({ name, logoMediumId, logoDunkelMediumId }) {
  markeDaten = {
    name: name ?? "",
    logoId: logoMediumId ?? null,
    logoDunkelId: logoDunkelMediumId ?? null,
  };
  for (const alt of document.querySelectorAll("a.marke")) {
    alt.replaceWith(erstelleMarke());
  }
}

// Umschalter Hell und Dunkel wie im Kopf der Website: zwei Knöpfe nur mit Symbol, aria-pressed, die Wahl liegt nur im Browser (website/theme.js)
// Ohne das Skript bleibt er verborgen (hidden)
function themaSchalter() {
  return el(
    "div",
    {
      class: "thema",
      role: "group",
      "aria-label": "Darstellung",
      hidden: true,
    },
    [
      ["light", "sonne", "Hell"],
      ["dark", "mond", "Dunkel"],
    ].map(([wert, symbol, name]) =>
      el(
        "button",
        {
          type: "button",
          "data-thema": wert,
          "aria-pressed": "false",
          "aria-label": name,
        },
        icon(symbol),
      ),
    ),
  );
}

// Nach dem Einsetzen des Kopfs aufrufen: theme.js verbindet die Knöpfe und zeigt sie
export const bindeThema = () => window.ceviThema?.binde();

// Logozeile: Marke, «Verwaltung», Konto mit Rolle, Umschalter und «Abmelden»
// konto: { name, rolle } (rolle: Text unter dem Namen)
export function logozeile({ konto, beiAbmelden, sichtbar = true }) {
  return el(
    "div",
    { class: "logozeile" },
    el(
      "div",
      { class: "breite" },
      erstelleMarke(),
      el("span", { class: "bereichname" }, "Verwaltung"),
      el(
        "div",
        { class: "kopf-rechts" },
        sichtbar &&
          konto &&
          el(
            "div",
            { class: "konto" },
            avatar(konto.name),
            el(
              "div",
              { class: "konto-text" },
              el("p", { class: "kontoname" }, konto.name),
              el("p", { class: "mini leise" }, konto.rolle),
            ),
          ),
        themaSchalter(),
        sichtbar &&
          konto &&
          knopf("Abmelden", {
            symbol: "abmelden",
            klein: true,
            onclick: beiAbmelden,
          }),
      ),
    ),
  );
}

// Bereichsleiste und Unterleiste in einem Halter; zeichne() baut sie neu, wenn sich Seite oder Zähler ändern
// zaehlerStand: Map «bereich/unter» -> Anzahl; eine Zahl über 0 erscheint als rote Pille
export function erstelleLeisten() {
  const wurzel = el("div", { class: "leisten" });
  return {
    wurzel,
    zeichne({ bereiche, aktiv, zaehlerStand }) {
      leere(wurzel);
      const hauptleiste = el(
        "nav",
        { class: "bereichsleiste", "aria-label": "Bereiche" },
        el(
          "div",
          { class: "breite" },
          el(
            "ul",
            {},
            bereiche.map((b) => {
              const ziel =
                b.unter.find((u) => u.schluessel === b.start) ?? b.unter[0];
              const hier = aktiv?.bereich.schluessel === b.schluessel;
              return el(
                "li",
                {},
                el(
                  "a",
                  {
                    href:
                      b.unter.length === 1
                        ? `#${b.schluessel}`
                        : `#${b.schluessel}/${ziel.schluessel}`,
                    ...(hier && { "aria-current": "page" }),
                  },
                  b.name,
                  hier &&
                    el("span", { class: "nur-leser" }, ", aktueller Bereich"),
                ),
              );
            }),
          ),
        ),
      );
      wurzel.append(hauptleiste);
      const b = aktiv?.bereich;
      if (b && b.unter.length > 1) {
        wurzel.append(
          el(
            "nav",
            { class: "unterleiste", "aria-label": b.name },
            el(
              "div",
              { class: "breite" },
              el(
                "ul",
                {},
                b.unter.map((u) => {
                  const n =
                    zaehlerStand.get(`${b.schluessel}/${u.schluessel}`) ?? 0;
                  const hier = aktiv.unter.schluessel === u.schluessel;
                  return el(
                    "li",
                    {},
                    el(
                      "a",
                      {
                        href: adresseVon(b, u),
                        ...(hier && { "aria-current": "page" }),
                      },
                      u.name,
                      n > 0 &&
                        el(
                          "span",
                          { class: "pille-zaehler" },
                          String(n),
                          el("span", { class: "nur-leser" }, " offen"),
                        ),
                    ),
                  );
                }),
              ),
            ),
          ),
        );
      }
    },
  };
}

// Seitenkopf: Titel (Fokusziel nach der Navigation) und Untertitel, rechts die Hauptaktion (genau eine rote je Ansicht)
export function seitenkopf({ titel, untertitel }) {
  const h1 = el("h1", { tabindex: "-1" }, titel);
  const unter = el("p", { class: "leise" }, untertitel);
  const aktion = el("div", { class: "kopf-aktion" });
  const wurzel = el(
    "header",
    { class: "kopf", id: "seitenkopf" },
    el("div", { class: "kopf-text" }, h1, untertitel ? unter : false),
    aktion,
  );
  return { wurzel, h1, unter, aktion };
}

// Rückmeldungen: eine Live-Region, in die Hinweise gestapelt werden. Jede hat «Hinweis schliessen».
// art: «ok», «info», «warn» oder «fehler» (Alert); aktion: { text, onclick } für «Beheben», «Nochmals versuchen» u. ä.
// Erfolg und Info ohne Aktion gehen nach BLEIBT_MS von selbst (#570, Entscheid des Nutzers); Zeigen und Fokus halten die Zeit an, danach beginnt sie neu.
// Warnungen, Fehler und alles mit einer Aktion bleiben, bis die Person sie schliesst: Dort gibt es etwas zu lesen oder zu entscheiden
export const BLEIBT_MS = 6000;
// So lange blendet die Meldung aus (geruest.css, nur bei erlaubter Bewegung sichtbar)
const AUSBLENDEN_MS = 300;
export const vergehtVonSelbst = (art, aktion) =>
  (art === "ok" || art === "info") && !aktion;

// Blendet einen Hinweis nach BLEIBT_MS aus und entfernt ihn. Zeiger oder Fokus darauf halten die Zeit an; nach dem Verlassen beginnt sie neu.
// Die Statusregion hat den Text schon beim Einfügen vorgelesen, das Entfernen sagt nichts an. Mit «Bewegung reduzieren» verschwindet der Hinweis ohne Übergang
function vergehe(hinweis) {
  hinweis.dataset.vergeht = "";
  let warte;
  let weg;
  let zeiger = false;
  let fokus = false;
  const halte = () => {
    window.clearTimeout(warte);
    window.clearTimeout(weg);
    hinweis.classList.remove("hinweis--geht");
  };
  const starte = () => {
    halte();
    warte = window.setTimeout(() => {
      const still = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (still) return hinweis.remove();
      hinweis.classList.add("hinweis--geht");
      weg = window.setTimeout(() => hinweis.remove(), AUSBLENDEN_MS);
    }, BLEIBT_MS);
  };
  const pruefe = () => (zeiger || fokus ? halte() : starte());
  hinweis.addEventListener("pointerenter", () => ((zeiger = true), pruefe()));
  hinweis.addEventListener("pointerleave", () => ((zeiger = false), pruefe()));
  hinweis.addEventListener("focusin", () => ((fokus = true), pruefe()));
  hinweis.addEventListener("focusout", () => ((fokus = false), pruefe()));
  starte();
}
export function erstelleRueckmeldungen() {
  const wurzel = el("div", {
    id: "rueckmeldung",
    class: "rueckmeldung",
    role: "status",
  });
  function melde(text, art = "ok", aktion) {
    if (!text) {
      leere(wurzel);
      return;
    }
    // Gleicher Text: ersetzen statt stapeln
    for (const alt of wurzel.querySelectorAll(".hinweis")) {
      if (alt.dataset.text === text) alt.remove();
    }
    const hinweis = el(
      "div",
      {
        class: `hinweis hinweis--${art}`,
        role: art === "fehler" ? "alert" : undefined,
        "data-text": text,
      },
      el("span", {}, text),
      aktion &&
        knopf(aktion.text, {
          klein: true,
          onclick: () => {
            hinweis.remove();
            aktion.onclick();
          },
        }),
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund",
          "aria-label": "Hinweis schliessen",
          onclick: () => hinweis.remove(),
        },
        icon("schliessen"),
      ),
    );
    wurzel.append(hinweis);
    if (vergehtVonSelbst(art, aktion)) vergehe(hinweis);
  }
  return { wurzel, melde };
}
