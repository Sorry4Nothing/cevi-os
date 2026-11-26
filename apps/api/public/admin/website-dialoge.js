import { ROLLEN } from "./sicht-rollen.js";
import { el, flussKopf, neueId } from "./dom.js";
import { oeffneFluss } from "./fluss.js";
import { symbol } from "./website-symbole.js";
import { rahmenzustand } from "./zustaende.js";

// Gemeinsame Bausteine des Website-Bereichs: Fenster (Dialog nach dem Design E1, E3, E6, E7, E8), Feldfehler und Hinweisband.
// Ein Fenster ist ein natives <dialog>: Fokus gefangen, Escape schliesst, Rückfokus an den Auslöser.

// Ein Knopf im Ladezustand: Ladekreis und aria-busy, aber nicht disabled, damit der Fokus bleibt (Design: aria-disabled)
export function beschaeftigt(knopfEl, an) {
  if (an) {
    knopfEl.setAttribute("aria-busy", "true");
    knopfEl.setAttribute("aria-disabled", "true");
  } else {
    knopfEl.removeAttribute("aria-busy");
    knopfEl.removeAttribute("aria-disabled");
  }
}

// Ein Knopf, der nicht klickbar ist, aber sichtbar bleibt (Design E6, E8: «Hochladen» mit Grund darunter)
export function gesperrt(knopfEl, an) {
  if (an) knopfEl.setAttribute("aria-disabled", "true");
  else knopfEl.removeAttribute("aria-disabled");
}

const istGesperrt = (k) => k.getAttribute("aria-disabled") === "true";

// Klick nur, wenn der Knopf nicht gesperrt ist (aria-disabled hält den Fokus, verhindert aber keinen Klick)
export function bei(knopfEl, fn) {
  knopfEl.addEventListener("click", (e) => {
    if (istGesperrt(knopfEl)) {
      e.preventDefault();
      return;
    }
    fn(e);
  });
  return knopfEl;
}

// Hinweisband im Inhalt (nicht in der Live-Region der Seite): art «info», «ok», «warn», «fehler»
export function band(art, text, ...aktionen) {
  return el(
    "div",
    {
      class: `hinweis hinweis--${art}`,
      role: art === "fehler" ? "alert" : "status",
    },
    el("span", {}, text),
    ...aktionen,
  );
}

// Meldung unter dem Feld: Text mit Symbol, nie nur Farbe; Fehlerrand am Feld
export function zeigeFeldFehler(wurzel, ziel, text) {
  let meldung = wurzel.querySelector(":scope > .fehlertext");
  if (!meldung) {
    meldung = el("p", { class: "fehlertext", id: neueId("fehler") });
    wurzel.append(meldung);
  }
  meldung.replaceChildren(symbol("warnung"), el("span", {}, text));
  wurzel.classList.add("fehler");
  ziel.setAttribute("aria-invalid", "true");
  const ids = (ziel.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean);
  if (!ids.includes(meldung.id)) ids.push(meldung.id);
  ziel.setAttribute("aria-describedby", ids.join(" "));
}

export function loescheFeldFehler(wurzel) {
  const meldung = wurzel.querySelector(":scope > .fehlertext");
  if (!meldung) return;
  wurzel.classList.remove("fehler");
  for (const ziel of wurzel.querySelectorAll("[aria-invalid]")) {
    ziel.removeAttribute("aria-invalid");
    const ids = (ziel.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((i) => i && i !== meldung.id);
    if (ids.length > 0) ziel.setAttribute("aria-describedby", ids.join(" "));
    else ziel.removeAttribute("aria-describedby");
  }
  meldung.remove();
}

// Fenster mit Titel, Schliessen-Knopf, Inhalt und Fuss. Ohne rueckfrage ist es seit #578 eine Seite im Fluss (fluss.js, «Zurück», eigener Verlaufseintrag, Frage bei ungespeicherten Eingaben); eine Rückfrage bleibt ein kleines Fenster.
// optionen: { titel, beschreibung?, breit?, rueckfrage? (role alertdialog), inhalt, fuss (Knoten), beimSchliessen?, fokus? (Knoten, sonst der erste Knopf im Inhalt) }
// Liefert { dialog, schliesse, fehler(text|null) }. Die Fehlerzeile steht über dem Fuss.
export function fenster({
  titel,
  beschreibung,
  breit = false,
  rueckfrage = false,
  inhalt = [],
  fuss = [],
  beimSchliessen,
  fokus,
}) {
  const zurueck = document.activeElement;
  const titelId = neueId("titel");
  const fehlerZeile = el("div", { class: "ws-fenster-fehler" });
  if (!rueckfrage) {
    const { kopf } = flussKopf({
      titelId,
      titel,
      beschreibung,
      beiZurueck: () => seite.versuchSchliessen(),
    });
    const seite = el(
      "section",
      {
        class: `fluss-seite ${breit ? "fluss-breit" : "fluss-formular"}`,
        "aria-labelledby": titelId,
      },
      kopf,
      el(
        "div",
        { class: "fluss-karte ws-fluss" },
        el("div", { class: "ws-fenster-inhalt" }, inhalt),
        fehlerZeile,
        el("div", { class: "ws-fenster-fuss" }, fuss),
      ),
    );
    seite.addEventListener("close", () => {
      beimSchliessen?.();
      if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
      else document.querySelector("h1")?.focus();
    });
    oeffneFluss(seite);
    (
      fokus ??
      seite.querySelector(
        ".ws-fenster-inhalt input:not([type=hidden]), .ws-fenster-inhalt textarea, .ws-fenster-inhalt select",
      ) ??
      seite.querySelector("h1")
    ).focus();
    return {
      dialog: seite,
      schliesse: () => seite.close(),
      fehler(text) {
        fehlerZeile.replaceChildren();
        if (text) {
          const b = band("fehler", text);
          b.tabIndex = -1;
          fehlerZeile.append(b);
          b.focus();
        }
      },
    };
  }
  const zu = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--rund",
      "aria-label": "Schliessen",
      onclick: () => dialog.close(),
    },
    symbol("schliessen"),
  );
  const dialog = el(
    "dialog",
    {
      class: breit ? "ws-fenster ws-fenster--breit" : "ws-fenster",
      role: rueckfrage ? "alertdialog" : undefined,
      "aria-labelledby": titelId,
    },
    el(
      "div",
      { class: "ws-fenster-kopf" },
      el(
        "div",
        { class: "ws-fenster-titel" },
        el("h2", { id: titelId, tabindex: "-1" }, titel),
        beschreibung && el("p", { class: "leise" }, beschreibung),
      ),
      zu,
    ),
    el("div", { class: "ws-fenster-inhalt" }, inhalt),
    fehlerZeile,
    el("div", { class: "ws-fenster-fuss" }, fuss),
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    beimSchliessen?.();
    const offen = document.querySelector("dialog[open]");
    if (offen && !offen.contains(zurueck)) return;
    if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
    else document.querySelector("h1")?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  (
    fokus ??
    dialog.querySelector(
      ".ws-fenster-inhalt input:not([type=hidden]), .ws-fenster-inhalt textarea, .ws-fenster-inhalt select",
    ) ??
    dialog.querySelector("h2")
  ).focus();
  return {
    dialog,
    schliesse: () => dialog.close(),
    fehler(text) {
      fehlerZeile.replaceChildren();
      if (text) {
        const b = band("fehler", text);
        b.tabIndex = -1;
        fehlerZeile.append(b);
        b.focus();
      }
    },
  };
}

// Name einer Person oder Seite für Knöpfe und Rückfragen, auf eine Zeile gekürzt
export const kuerze = (text, n = 60) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;

export const anzahlText = (n, eins, viele) =>
  n === 1 ? eins : `${n} ${viele}`;

// «Zuletzt gespeichert um 20:45» und ähnliche Zeiten
export const uhrzeit = new Intl.DateTimeFormat("de-CH", {
  timeStyle: "short",
});

// Anzeigetexte der Sichtbarkeit einer Seite oder eines Bausteins
export function sichtbarkeitText(s, tagNamen) {
  if (s === "erbt") return "Wie die Seite";
  if (s.art === "oeffentlich") return "Öffentlich";
  if (s.art === "angemeldet") return "Nur angemeldet";
  if (s.tagIds.length === 0) return "Bestimmte Gruppen (keine gewählt)";
  // Mit Rollen (#844): «Imperius (Gruppenleitung, Stufenleitung)»
  const name = new Map(ROLLEN);
  return s.tagIds
    .map((id) => {
      const gruppe = tagNamen.get(id) ?? "unbekannte Gruppe";
      const r = s.rollen?.[id];
      return r ? `${gruppe} (${r.map((x) => name.get(x)).join(", ")})` : gruppe;
    })
    .join(", ");
}

// E9 «403 Kein Zugriff»: ganze Seite im Inhalt, mit dem Weg zurück zu den Seiten. Sie ersetzt den Inhalt des Bereichs und nimmt den Fokus.
export function keinRecht(
  bereich,
  text = "Diese Seite darfst du nicht bearbeiten. Wende dich an die Abteilungsleitung, wenn du Zugriff brauchst.",
) {
  const karte = rahmenzustand(
    { ueber: "Fehler 403", titel: "Dafür hast du kein Recht.", text },
    [
      el(
        "a",
        { class: "knopf knopf--haupt", href: "#website/seiten" },
        "Zu den Seiten",
      ),
    ],
  );
  bereich.replaceChildren(karte.wurzel);
  karte.titel.focus();
}
