// Rahmen der Verwaltung nach dem Design (A1, G4): Logozeile mit Konto, blaue Bereichsleiste, darunter die Unterleiste des aktiven Bereichs mit Zählern; dazu die Rückmeldungen.
import { adresseVon } from "./navigation.js";
import { avatar, el, icon, knopf, leere } from "./dom.js";

// Name der Abteilung neben «CEVI»
const ABTEILUNG = "Stäfa-Hombrechtikon";

// Logozeile: Marke, «Verwaltung», Konto mit Rolle und «Abmelden»
// konto: { name, rolle } (rolle: Text unter dem Namen)
export function logozeile({ konto, beiAbmelden, sichtbar = true }) {
  return el(
    "div",
    { class: "logozeile" },
    el(
      "div",
      { class: "breite" },
      el(
        "a",
        { class: "marke", href: "#" },
        el("b", {}, "CEVI"),
        el("span", {}, ABTEILUNG),
      ),
      el("span", { class: "bereichname" }, "Verwaltung"),
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
                          { class: "zaehler" },
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

// Rückmeldungen: eine Live-Region, in die Hinweise gestapelt werden. Keine Meldung verschwindet von selbst: Jede hat «Hinweis schliessen».
// art: «ok», «info», «warn» oder «fehler» (Alert); aktion: { text, onclick } für «Beheben», «Nochmals versuchen» u. ä.
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
  }
  return { wurzel, melde };
}
