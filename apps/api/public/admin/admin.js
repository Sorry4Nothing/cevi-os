import { anfrage, beiSitzungsende, fehlertext } from "./api.js";
import { el, feld, knopf, leere } from "./dom.js";
import * as abteilung from "./abteilung.js";
import * as kinder from "./kinder.js";
import * as meldungen from "./meldungen.js";
import * as personen from "./personen.js";
import * as stufen from "./stufen.js";
import * as system from "./system.js";
import * as uebersicht from "./uebersicht.js";

const BEREICHE = [
  ["uebersicht", "Übersicht", uebersicht],
  ["personen", "Personen", personen],
  ["stufen", "Stufen", stufen],
  ["kinder", "Kinder", kinder],
  ["meldungen", "Meldungen", meldungen],
  ["abteilung", "Abteilung", abteilung],
  ["system", "System", system],
];

const app = document.getElementById("app");
let ich = null;

function zeichne(...knoten) {
  for (const dialog of document.querySelectorAll("dialog")) dialog.remove();
  leere(app);
  app.append(...knoten);
}

function fehlerfeld() {
  return el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
}

function zeigeFehler(knoten, text) {
  knoten.textContent = text;
  knoten.hidden = false;
  knoten.focus();
}

// Titel und Hinweis zuerst; der Fokus liegt danach auf dem Hinweis oder dem Titel
function anmeldeSeite(titel, text, hinweis, ...inhalt) {
  const ueberschrift = el("h1", { tabindex: "-1" }, titel);
  const meldung =
    hinweis &&
    el("p", { class: "hinweis", role: "status", tabindex: "-1" }, hinweis);
  zeichne(
    el(
      "main",
      { class: "anmeldung", id: "inhalt" },
      el("p", { class: "marke" }, "Cevi OS", el("span", {}, "Verwaltung")),
      ueberschrift,
      el("p", {}, text),
      meldung,
      ...inhalt,
    ),
  );
  (meldung || ueberschrift).focus();
}

function zeigeLogin(hinweis) {
  ich = null;
  const name = feld({
    label: "Benutzername",
    autocomplete: "username",
    autocapitalize: "none",
    spellcheck: "false",
    required: true,
  });
  const passwort = feld({
    label: "Passwort",
    typ: "password",
    autocomplete: "current-password",
    required: true,
  });
  const sichtbar = el("input", { id: "passwort-zeigen", type: "checkbox" });
  sichtbar.addEventListener("change", () => {
    passwort.eingabe.type = sichtbar.checked ? "text" : "password";
  });
  const fehler = fehlerfeld();
  const senden = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt knopf--gross" },
    "Anmelden",
  );
  const formular = el(
    "form",
    { class: "formular", novalidate: true },
    name.wurzel,
    passwort.wurzel,
    el(
      "div",
      { class: "wahl" },
      sichtbar,
      el("label", { for: "passwort-zeigen" }, "Passwort anzeigen"),
    ),
    fehler,
    senden,
  );
  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.hidden = true;
    if (!name.eingabe.value.trim() || !passwort.eingabe.value) {
      zeigeFehler(fehler, "Bitte gib Benutzername und Passwort ein.");
      return;
    }
    senden.disabled = true;
    try {
      const antwort = await anfrage("POST", "/api/auth/sign-in/username", {
        username: name.eingabe.value.trim(),
        password: passwort.eingabe.value,
      });
      passwort.eingabe.value = "";
      if (antwort?.twoFactorRedirect) zeigeCode();
      else await pruefeKonto();
    } catch (f) {
      zeigeFehler(fehler, fehlertext(f));
    } finally {
      senden.disabled = false;
    }
  });
  anmeldeSeite(
    "Anmelden",
    "Melde dich mit deinem Admin-Konto an.",
    hinweis,
    formular,
  );
}

function zeigeCode(ersatz = false) {
  const code = feld({
    label: ersatz ? "Ersatzcode" : "Code aus der Authenticator-App",
    hilfe: ersatz
      ? "Format: xxxxx-xxxxx. Jeder Ersatzcode gilt nur einmal."
      : "Sechs Ziffern.",
    autocomplete: ersatz ? "off" : "one-time-code",
    inputmode: ersatz ? "text" : "numeric",
    autocapitalize: "none",
    spellcheck: "false",
    required: true,
  });
  const fehler = fehlerfeld();
  const senden = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt knopf--gross" },
    "Bestätigen",
  );
  const formular = el(
    "form",
    { class: "formular", novalidate: true },
    code.wurzel,
    fehler,
    senden,
    knopf(ersatz ? "Code aus der App verwenden" : "Ersatzcode verwenden", {
      art: "still",
      onclick: () => zeigeCode(!ersatz),
    }),
    knopf("Abbrechen", { art: "still", onclick: () => zeigeLogin() }),
  );
  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.hidden = true;
    const wert = code.eingabe.value.trim();
    if (!wert) {
      zeigeFehler(fehler, "Bitte gib den Code ein.");
      return;
    }
    senden.disabled = true;
    try {
      await anfrage(
        "POST",
        ersatz
          ? "/api/auth/two-factor/verify-backup-code"
          : "/api/auth/two-factor/verify-totp",
        { code: wert },
      );
      await pruefeKonto();
    } catch (f) {
      // Ohne gültiges Zwischen-Cookie hilft nur eine neue Anmeldung
      if (
        f.code === "INVALID_TWO_FACTOR_COOKIE" ||
        f.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
      ) {
        zeigeLogin(fehlertext(f));
      } else {
        zeigeFehler(fehler, fehlertext(f));
      }
    } finally {
      senden.disabled = false;
    }
  });
  anmeldeSeite(
    "Zweiter Faktor",
    "Gib den Code für dein Konto ein.",
    undefined,
    formular,
  );
}

function zeigeSperre(text) {
  anmeldeSeite(
    "Verwaltung nicht möglich",
    text,
    undefined,
    knopf("Abmelden", { onclick: abmelden }),
  );
}

// Beim Start ist «keine Sitzung» der Normalfall; nach einer Anmeldung ist es ein Fehler
async function pruefeKonto(nachAnmeldung = true) {
  const sitzung = await anfrage("GET", "/api/auth/get-session");
  if (!sitzung) {
    zeigeLogin(
      nachAnmeldung
        ? "Die Anmeldung hat keine Sitzung ergeben. Versuche es nochmals."
        : undefined,
    );
    return;
  }
  ich = sitzung.user;
  if (ich.role !== "admin") {
    zeigeSperre("Dieses Konto hat keine Admin-Rechte.");
  } else if (ich.mussPasswortAendern) {
    zeigeSperre(
      "Du musst zuerst dein Startpasswort ändern. Das geht in der App. Melde dich danach hier neu an.",
    );
  } else if (!ich.twoFactorEnabled) {
    zeigeSperre(
      "Für die Verwaltung braucht es zuerst einen zweiten Faktor. Richte ihn ein und melde dich danach neu an.",
    );
  } else {
    zeigeVerwaltung();
  }
}

async function abmelden() {
  try {
    await anfrage("POST", "/api/auth/sign-out", {});
  } catch (f) {
    if (document.getElementById("rueckmeldung")) melde(fehlertext(f), "fehler");
    else zeigeLogin(fehlertext(f));
    return;
  }
  zeigeLogin("Du bist abgemeldet.");
}

// Rückmeldungen stehen in einer Live-Region: Leeren und kurz danach setzen, damit auch ein gleicher Text wieder angesagt wird
function melde(text, art = "ok") {
  const bereich = document.getElementById("rueckmeldung");
  if (!bereich) return;
  bereich.textContent = "";
  bereich.className = text
    ? `rueckmeldung hinweis hinweis--${art}`
    : "rueckmeldung";
  bereich.setAttribute("role", art === "fehler" ? "alert" : "status");
  setTimeout(() => {
    bereich.textContent = text;
  }, 50);
}

// Lädt Daten in den Bereich und zeichnet sie; die zweite Funktion lädt dieselbe Ansicht nochmals, ohne den Bereich vorher zu leeren
function erstelleLader(bereich) {
  async function lade(laden, zeichnen) {
    if (!bereich.firstChild) {
      bereich.append(
        el("p", { class: "meta", role: "status" }, "Wird geladen …"),
      );
    }
    let daten;
    try {
      daten = await laden();
    } catch (f) {
      if (!bereich.isConnected) return;
      leere(bereich);
      bereich.append(
        el(
          "p",
          { class: "hinweis hinweis--fehler", role: "alert" },
          fehlertext(f),
        ),
        el(
          "div",
          { class: "aktionen" },
          knopf("Nochmals versuchen", {
            onclick: () => lade(laden, zeichnen),
          }),
        ),
      );
      return;
    }
    // Zwischen Anfrage und Antwort kann man den Bereich gewechselt haben
    if (!bereich.isConnected) return;
    leere(bereich);
    zeichnen(daten, () => lade(laden, zeichnen));
  }
  return lade;
}

function zeigeVerwaltung() {
  const titel = el("h1", { id: "titel", tabindex: "-1" });
  const rahmen = el("div", { class: "rahmen" });
  const menueknopf = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--klein",
      "aria-expanded": "false",
      "aria-controls": "seitenleiste",
      onclick: () => schalteMenue(!rahmen.classList.contains("rahmen--offen")),
    },
    "Menü",
  );
  function schalteMenue(offen) {
    rahmen.classList.toggle("rahmen--offen", offen);
    menueknopf.setAttribute("aria-expanded", String(offen));
  }
  const bereiche = el(
    "nav",
    { class: "bereiche", "aria-label": "Bereiche" },
    BEREICHE.map(([schluessel, name]) =>
      el(
        "a",
        {
          href: `#${schluessel}`,
          "data-bereich": schluessel,
          onclick: () => schalteMenue(false),
        },
        name,
      ),
    ),
  );
  const rueckmeldung = el("div", {
    id: "rueckmeldung",
    class: "rueckmeldung",
    role: "status",
  });
  rahmen.append(
    el(
      "div",
      { class: "topleiste" },
      el("p", { class: "marke" }, "Cevi OS", el("span", {}, "Verwaltung")),
      menueknopf,
    ),
    el(
      "div",
      { class: "seitenleiste", id: "seitenleiste" },
      el("p", { class: "marke" }, "Cevi OS", el("span", {}, "Verwaltung")),
      bereiche,
      el(
        "div",
        { class: "konto" },
        el("p", { class: "meta" }, "Angemeldet als"),
        el("p", { class: "kontoname" }, ich.name),
        knopf("Abmelden", { onclick: abmelden }),
      ),
    ),
    el(
      "main",
      { class: "haupt", id: "inhalt", tabindex: "-1" },
      titel,
      rueckmeldung,
      el("div", { id: "bereich" }),
    ),
  );
  zeichne(rahmen);
  navigiere();
}

function navigiere() {
  if (!ich || !document.getElementById("bereich")) return;
  const [schluessel, name, ansicht] =
    BEREICHE.find(([s]) => s === location.hash.slice(1)) ?? BEREICHE[0];
  for (const link of document.querySelectorAll("nav.bereiche a")) {
    if (link.dataset.bereich === schluessel)
      link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const titel = document.getElementById("titel");
  titel.textContent = name;
  document.title = `${name} – Verwaltung – Cevi OS`;
  melde("");
  // Ein neuer Container je Navigation: Späte Antworten des alten landen in einem abgehängten Knoten
  const bereich = el("div", { id: "bereich" });
  document.getElementById("bereich").replaceWith(bereich);
  ansicht.zeige(bereich, { ich, melde, lade: erstelleLader(bereich) });
  titel.focus();
}

window.addEventListener("hashchange", navigiere);
beiSitzungsende(() => {
  if (ich) zeigeLogin("Die Sitzung ist abgelaufen. Bitte melde dich neu an.");
});

pruefeKonto(false).catch(() => zeigeLogin());
