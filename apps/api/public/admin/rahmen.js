// Rahmen der Verwaltung nach dem Design (A1, G4): Logozeile mit Konto, blaue Bereichsleiste, darunter die Unterleiste des aktiven Bereichs mit Zählern; dazu die Rückmeldungen.
import { adresseVon } from "./navigation.js";
import { avatar, el, icon, knopf, leere } from "./dom.js";

// Marke im Kopf wie auf der Website (#578): das Logo der Abteilung (hell und, falls gesetzt, dunkel) oder die Wortmarke «CEVI» mit dem Namen.
// Name und Logo kommen aus den Einstellungen der Website (GET /api/v1/redaktion/website) und stehen nie im Code; ohne sie (kein Recht auf die Einstellungen, nichts gesetzt) bleibt die Wortmarke «CEVI» allein.
let markeDaten = { name: "", logoId: null, logoDunkelId: null };
const medienUrl = (id) => `/api/v1/medien/${encodeURIComponent(id)}`;

// Das Logo führt zur öffentlichen Website (#669, wie üblich); die Verwaltung öffnet «Verwaltung» daneben. Der Name sagt es Screenreadern, der Hinweis der Maus
const MARKE_NAME = {
  "aria-label": "Cevi: zur Website",
  "data-tipp": "Zur Website",
};

function erstelleMarke() {
  const { name, logoId, logoDunkelId } = markeDaten;
  if (!logoId) {
    return el(
      "a",
      { class: "marke", href: "/", ...MARKE_NAME },
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
      href: "/",
      ...MARKE_NAME,
    },
    bild(logoDunkelId ? "logo logo--hell" : "logo", logoId),
    logoDunkelId && bild("logo logo--dunkel", logoDunkelId),
    el("span", { class: "nur-leser" }, name || "Cevi"),
  );
}

// Wer die Einstellungen der Website nicht lesen darf (Stufenleitung) und die Anmeldung haben keine eigene Quelle: Sie zeigen, was die öffentliche Website im Kopf zeigt. Gelesen wird die Startseite, die jede Person ohne Sitzung sieht; ein Fehler, die Wartungsseite oder ein anderer Aufbau lassen die Wortmarke «CEVI» stehen. Die Einstellungen gehen vor.
let ausEinstellungen = false;
const MEDIEN_ADRESSE = /^\/api\/v1\/medien\/[0-9a-f-]{36}$/;
export async function ladeOeffentlicheMarke() {
  try {
    const antwort = await fetch("/", { credentials: "omit" });
    if (!antwort.ok) return;
    const dokument = new window.DOMParser().parseFromString(
      await antwort.text(),
      "text/html",
    );
    const marke = dokument.querySelector("header a.marke");
    if (!marke || ausEinstellungen) return;
    const bildId = (klasse) => {
      const adresse = marke.querySelector(`img.${klasse}`)?.getAttribute("src");
      return adresse && MEDIEN_ADRESSE.test(adresse)
        ? adresse.split("/").pop()
        : null;
    };
    const hell = bildId("logo--hell") ?? bildId("logo");
    const name =
      marke.querySelector(".nur-sr, span")?.textContent?.trim().slice(0, 100) ??
      "";
    markeDaten = {
      name,
      logoId: hell,
      logoDunkelId: hell ? bildId("logo--dunkel") : null,
    };
    for (const alt of document.querySelectorAll("a.marke")) {
      alt.replaceWith(erstelleMarke());
    }
  } catch {
    // Keine öffentliche Quelle: die Wortmarke bleibt
  }
}

// Setzt Name und Logo und ersetzt die Marke, wo sie schon steht; spätere Köpfe nutzen den gemerkten Stand
export function setzeMarke({ name, logoMediumId, logoDunkelMediumId }) {
  ausEinstellungen = true;
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

// Konto-Menü im Kopf (#669), gleicher Aufbau wie auf der Website (website/kopf.css, Abschnitt «Konto-Menü»): Bild, Name und Rolle öffnen eine Tafel mit «Zur Website», «Mein Konto» (#621) und «Abmelden».
// «Mein Konto» trägt aria-current, solange die Seite offen ist; das Profilbild erscheint, sobald die Person eines gesetzt hat
const meldeKontoSeite = () => {
  const hier = window.location.hash.startsWith("#konto");
  for (const a of document.querySelectorAll(".konto-liste a[href='#konto']")) {
    if (hier) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  for (const k of document.querySelectorAll(".konto")) {
    k.classList.toggle("konto--hier", hier);
  }
};
window.addEventListener("hashchange", meldeKontoSeite);
// bildUrl: Pfad des Bildes oder null (Initialen)
export function setzeKontoBild(bildUrl) {
  for (const m of document.querySelectorAll(".konto-menue")) {
    for (const a of m.querySelectorAll(".ava")) {
      a.replaceWith(avatar(m.dataset.name, { bildUrl: bildUrl ?? null }));
    }
  }
}

// Das Menü ist ein details-Element (Offenlegungsmuster, wie auf der Website): Tab geht durch die Einträge, Pfeile ebenso, Esc schliesst und gibt den Fokus an den Knopf zurück, ein Klick daneben und das Verlassen mit Tab schliessen
function erstelleKontoMenue({ konto, beiAbmelden }) {
  const meldung = el("p", { class: "konto-meldung", role: "status" });
  const abmelden = el(
    "button",
    { type: "button" },
    icon("abmelden"),
    "Abmelden",
  );
  abmelden.addEventListener("click", async () => {
    if (abmelden.getAttribute("aria-disabled") === "true") return;
    abmelden.setAttribute("aria-disabled", "true");
    abmelden.setAttribute("aria-busy", "true");
    meldung.textContent = "";
    try {
      await beiAbmelden();
    } finally {
      // Gelingt es, ersetzt die Anmeldeseite den Kopf; sonst bleibt das Menü bedienbar
      abmelden.removeAttribute("aria-disabled");
      abmelden.removeAttribute("aria-busy");
    }
  });
  const hier = window.location.hash.startsWith("#konto");
  const menue = el(
    "details",
    { class: "konto-menue", "data-name": konto.name },
    el(
      "summary",
      { class: `konto${hier ? " konto--hier" : ""}` },
      avatar(konto.name, { bildUrl: konto.bildUrl }),
      el(
        "div",
        { class: "konto-text" },
        el(
          "p",
          { class: "kontoname" },
          el("span", { class: "nur-leser" }, "Konto: "),
          konto.name,
        ),
        el("p", { class: "mini leise" }, konto.rolle),
      ),
      icon("runter"),
    ),
    el(
      "div",
      { class: "konto-tafel" },
      el(
        "div",
        { class: "konto-kopf" },
        avatar(konto.name, { bildUrl: konto.bildUrl }),
        el("p", {}, el("strong", {}, konto.name), el("span", {}, konto.rolle)),
      ),
      el(
        "ul",
        { class: "konto-liste" },
        el("li", {}, el("a", { href: "/" }, icon("website"), "Zur Website")),
        el(
          "li",
          {},
          el(
            "a",
            {
              href: "#konto",
              ...(hier && { "aria-current": "page" }),
            },
            icon("personen"),
            "Mein Konto",
          ),
        ),
        el("li", {}, abmelden),
      ),
      meldung,
    ),
  );
  const zu = (fokusZurueck) => {
    menue.open = false;
    if (fokusZurueck) menue.querySelector("summary").focus();
  };
  const eintraege = () => [
    ...menue.querySelectorAll(".konto-liste a, .konto-liste button"),
  ];
  menue.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const liste = eintraege();
    const i = liste.indexOf(document.activeElement);
    if (e.key === "Escape" && menue.open) zu(true);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!menue.open) menue.open = true;
      const schritt = e.key === "ArrowDown" ? 1 : -1;
      const n =
        i < 0
          ? schritt > 0
            ? 0
            : liste.length - 1
          : (i + schritt + liste.length) % liste.length;
      liste[n].focus();
    } else if (e.key === "Home" && i >= 0) liste[0].focus();
    else if (e.key === "End" && i >= 0) liste.at(-1).focus();
    else return;
    e.preventDefault();
  });
  menue.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !menue.contains(e.relatedTarget)) menue.open = false;
  });
  // «Mein Konto» und «Zur Website» führen weg: Das Menü klappt zu
  menue.addEventListener("click", (e) => {
    if (e.target.closest(".konto-liste a")) menue.open = false;
  });
  document.addEventListener("click", (e) => {
    if (menue.open && !menue.contains(e.target)) menue.open = false;
  });
  return menue;
}

// Logozeile: Marke (führt zur Website), «Verwaltung» (Übersicht), Suche, Konto-Menü mit Rolle und ganz rechts der Umschalter (wie auf der Website)
// konto: { name, rolle, bildUrl } (rolle: Text unter dem Namen; bildUrl: Profilbild oder null)
export function logozeile({ konto, beiAbmelden, sichtbar = true, suche }) {
  return el(
    "div",
    { class: "logozeile" },
    el(
      "div",
      { class: "breite" },
      erstelleMarke(),
      // «Verwaltung» ist der Link zur Übersicht der Verwaltung (das Logo führt zur Website)
      el(
        "a",
        {
          class: "bereichname",
          href: "#",
          "data-tipp": "Zur Übersicht der Verwaltung",
        },
        "Verwaltung",
      ),
      el(
        "div",
        { class: "kopf-rechts" },
        sichtbar && konto && suche?.(),
        // Das Profil mit Menü steht vor dem Umschalter, wie das Konto-Menü auf der Website
        sichtbar && konto && erstelleKontoMenue({ konto, beiAbmelden }),
        // Ganz rechts, wie im Kopf der Website
        themaSchalter(),
      ),
    ),
  );
}

// Bereichsauswahl für schmale Bildschirme (Prinzip «Workspace-Switcher»: Die Zeile mit dem aktuellen Ort wächst beim Öffnen zum Panel mit allen Bereichen; der aktive Bereich zeigt seine Unterseiten). Ersetzt dort die beiden Leisten, die sonst über den Rand liefen. Am Computer ist sie verborgen (geruest.css).
// Tastatur: Enter oder Leertaste öffnet, Pfeil runter und hoch gehen durch die Einträge, Esc schliesst und gibt den Fokus an die Zeile zurück, ein Klick daneben schliesst. Die Zeile trägt aria-expanded; das geschlossene Panel ist inert.
let bereichswahlId = 0;
function erstelleBereichswahl({
  bereiche,
  aktiv,
  zaehlerStand,
  offen,
  beiWechsel,
}) {
  const id = `bereichswahl-${++bereichswahlId}`;
  const summe = (b) =>
    b.unter.reduce(
      (n, u) => n + (zaehlerStand.get(`${b.schluessel}/${u.schluessel}`) ?? 0),
      0,
    );
  const pille = (n) =>
    n > 0 &&
    el(
      "span",
      { class: "pille-zaehler" },
      String(n),
      el("span", { class: "nur-leser" }, " offen"),
    );
  const b = aktiv?.bereich;
  const zeile = el(
    "button",
    {
      type: "button",
      class: "bereichswahl-zeile",
      "aria-expanded": String(offen),
      "aria-controls": id,
    },
    icon(b?.symbol ?? "uebersicht"),
    el(
      "span",
      { class: "bereichswahl-text" },
      el("span", { class: "nur-leser" }, "Bereich wechseln: "),
      el("b", {}, b?.name ?? "Bereich wählen"),
      b && b.unter.length > 1 && el("span", {}, aktiv.unter.name),
    ),
    b && pille(summe(b)),
    icon("runter"),
  );
  const link = (href, inhalt, hier, klasse) =>
    el(
      "a",
      {
        href,
        class: klasse,
        ...(hier && { "aria-current": "page" }),
      },
      ...inhalt,
    );
  const liste = el(
    "ul",
    {},
    bereiche.map((x) => {
      const ziel = x.unter.find((u) => u.schluessel === x.start) ?? x.unter[0];
      const hier = b?.schluessel === x.schluessel;
      const unter = hier && x.unter.length > 1;
      return el(
        "li",
        {},
        link(
          x.unter.length === 1
            ? `#${x.schluessel}`
            : `#${x.schluessel}/${ziel.schluessel}`,
          [
            icon(x.symbol),
            el("span", {}, x.name),
            hier ? false : pille(summe(x)),
          ],
          hier && !unter,
          "bereichswahl-bereich",
        ),
        unter &&
          el(
            "ul",
            { class: "bereichswahl-unter", "aria-label": x.name },
            x.unter.map((u) =>
              el(
                "li",
                {},
                link(
                  adresseVon(x, u),
                  [
                    el("span", {}, u.name),
                    pille(
                      zaehlerStand.get(`${x.schluessel}/${u.schluessel}`) ?? 0,
                    ),
                  ],
                  aktiv.unter.schluessel === u.schluessel,
                  "bereichswahl-seite",
                ),
              ),
            ),
          ),
      );
    }),
  );
  const panel = el(
    "div",
    { class: "bereichswahl-panel", id },
    el(
      "div",
      { class: "bereichswahl-innen" },
      el("nav", { "aria-label": "Bereiche und Seiten" }, liste),
    ),
  );
  if (!offen) panel.inert = true;
  const wurzel = el(
    "div",
    { class: `bereichswahl${offen ? " bereichswahl--offen" : ""}` },
    zeile,
    panel,
  );
  const setze = (neu, fokus = false) => {
    beiWechsel(neu);
    wurzel.classList.toggle("bereichswahl--offen", neu);
    zeile.setAttribute("aria-expanded", String(neu));
    panel.inert = !neu;
    if (neu)
      (
        panel.querySelector("a[aria-current]") ?? panel.querySelector("a")
      )?.focus({
        preventScroll: true,
      });
    else if (fokus) zeile.focus();
  };
  zeile.addEventListener("click", () =>
    setze(zeile.getAttribute("aria-expanded") !== "true"),
  );
  panel.addEventListener("click", (e) => {
    if (e.target.closest("a")) setze(false);
  });
  wurzel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && zeile.getAttribute("aria-expanded") === "true") {
      e.preventDefault();
      setze(false, true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = [...panel.querySelectorAll("a")];
    if (links.length === 0 || panel.inert) return;
    e.preventDefault();
    const jetzt = links.indexOf(document.activeElement);
    const schritt = e.key === "ArrowDown" ? 1 : -1;
    links[(jetzt + schritt + links.length) % links.length].focus();
  });
  return wurzel;
}
// Ein Klick ausserhalb schliesst die offene Auswahl (ein Listener für alle Zeichnungen)
document.addEventListener("click", (e) => {
  const offen = document.querySelector(".bereichswahl--offen");
  if (offen && !offen.contains(e.target)) {
    offen.querySelector(".bereichswahl-zeile")?.click();
  }
});

// Bereichsleiste und Unterleiste in einem Halter; zeichne() baut sie neu, wenn sich Seite oder Zähler ändern
// zaehlerStand: Map «bereich/unter» -> Anzahl; eine Zahl über 0 erscheint als rote Pille
export function erstelleLeisten() {
  const wurzel = el("div", { class: "leisten" });
  // Die Bereichsauswahl bleibt offen, wenn nur ein Zähler nachgeladen wird; mit jeder Navigation (anderer Ort) geht sie zu
  let wahlOffen = false;
  let letzterOrt = "";
  return {
    wurzel,
    zeichne({ bereiche, aktiv, zaehlerStand }) {
      leere(wurzel);
      const ort = `${aktiv?.bereich.schluessel}/${aktiv?.unter.schluessel}`;
      if (ort !== letzterOrt) wahlOffen = false;
      letzterOrt = ort;
      wurzel.append(
        erstelleBereichswahl({
          bereiche,
          aktiv,
          zaehlerStand,
          offen: wahlOffen,
          beiWechsel: (o) => (wahlOffen = o),
        }),
      );
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

// Toasts mit «Rückgängig» (#578, Logik in rueckgaengig.js): unten links, gestapelt. Der Toast bekommt nie den Fokus. Erreichbar sind sie auf drei Wegen: «Rückgängig» ist ein Knopf im Seitenaufbau (die Region steht gleich nach dem Kopf, vor dem Inhalt),
// Strg oder Cmd + Z nimmt die jüngste Aktion zurück (ausser in Eingabefeldern, dort gilt das Rückgängig des Feldes), F6 setzt den Fokus auf den ersten Knopf «Rückgängig». Die Statusregion sagt jede Aktion und die Möglichkeit zum Rückgängigmachen an.
// steuerung: das Ergebnis von erstelleRueckgaengig (rueckgaengig.js)
export function erstelleToasts(steuerung) {
  const liste = el("ul", { class: "toast-liste" });
  const status = el("p", {
    class: "nur-leser",
    role: "status",
    "aria-live": "polite",
  });
  const wurzel = el(
    "div",
    {
      class: "toasts",
      role: "region",
      "aria-label": "Rückgängig",
      tabindex: "-1",
    },
    status,
    liste,
  );
  const knoten = new Map();

  function baue(a) {
    let zeiger = false;
    let fokus = false;
    const pruefe = () =>
      zeiger || fokus ? steuerung.halte(a) : steuerung.weiter(a);
    const text = el("span", { class: "toast-text" });
    const aktion = el(
      "button",
      {
        type: "button",
        class: "toast-aktion",
        onclick: () => {
          steuerung.macheRueckgaengig(a);
          // Der Knopf ist weg: Der Fokus geht zum Titel der Seite statt ins Leere
          if (document.activeElement === document.body) {
            document.querySelector("h1")?.focus();
          }
        },
      },
      "Rückgängig",
    );
    const zu = el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund",
        onclick: () => steuerung.schliesse(a),
      },
      icon("schliessen"),
    );
    const balken = el("span", { class: "toast-balken", "aria-hidden": "true" });
    const li = el("li", { class: "toast" }, text, aktion, zu, balken);
    li.addEventListener("pointerenter", () => ((zeiger = true), pruefe()));
    li.addEventListener("pointerleave", () => ((zeiger = false), pruefe()));
    li.addEventListener("focusin", () => ((fokus = true), pruefe()));
    li.addEventListener("focusout", () => ((fokus = false), pruefe()));
    return { li, text, aktion, zu };
  }

  function zeichne(aktionen) {
    const ids = new Set(aktionen.map((a) => a.id));
    for (const [id, k] of knoten) {
      if (!ids.has(id)) {
        k.li.remove();
        knoten.delete(id);
      }
    }
    for (const a of aktionen) {
      let k = knoten.get(a.id);
      if (!k) {
        k = baue(a);
        knoten.set(a.id, k);
        liste.append(k.li);
      }
      k.li.className = `toast toast--${a.phase}${a.pausiert ? " toast--halt" : ""}`;
      k.li.setAttribute("role", a.phase === "fehler" ? "alert" : "group");
      k.li.setAttribute(
        "aria-label",
        a.phase === "fehler" ? "Fehler" : "Aktion",
      );
      k.text.textContent = a.phase === "fehler" ? a.fehlerText : a.text;
      // Nur in der Frist lässt sich etwas zurücknehmen; danach heisst der Knopf rechts nur noch «Schliessen»
      k.aktion.hidden = a.phase !== "wartet";
      k.zu.setAttribute(
        "aria-label",
        a.phase === "wartet" ? "Jetzt ausführen und schliessen" : "Schliessen",
      );
      k.zu.disabled = a.phase === "laeuft";
      k.li.toggleAttribute("aria-busy", a.phase === "laeuft");
    }
    wurzel.hidden = aktionen.length === 0;
  }
  wurzel.hidden = true;

  const tippt = (ziel) =>
    ziel?.closest?.("input, textarea, select, [contenteditable='true']");
  document.addEventListener("keydown", (e) => {
    if (e.key === "F6" && !wurzel.hidden) {
      const erster = wurzel.querySelector(".toast-aktion:not([hidden])");
      if (erster) {
        e.preventDefault();
        erster.focus();
      }
      return;
    }
    if (
      e.key.toLowerCase() === "z" &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      !tippt(e.target)
    ) {
      const letzte = steuerung.letzte();
      if (letzte) {
        e.preventDefault();
        steuerung.macheRueckgaengig(letzte);
      }
    }
  });

  return {
    wurzel,
    zeichne,
    // Text für die Statusregion; leeren und neu setzen, damit auch ein gleicher Text wieder angesagt wird
    sage(text) {
      status.textContent = "";
      window.setTimeout(() => (status.textContent = text), 50);
    },
  };
}
