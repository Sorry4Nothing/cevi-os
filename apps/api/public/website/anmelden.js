// Anmeldung auf der Website (#354): dieselben Aufrufe wie die Verwaltung unter /api/auth (Rate-Limit und Sperre nach Fehlversuchen gelten dort), gleiche Herkunft, das Cookie setzt der Server.
// Das Passwort geht nur als JSON im Body hin, nie in eine Adresse; es wird nach dem Absenden aus dem Feld gelöscht und nirgends gespeichert oder protokolliert.
import { sicheresZiel } from "./weiter.js";

const $ = (id) => document.getElementById(id);
const fehler = $("fehler");
const anmeldung = $("anmeldung");
const faktor = $("faktor");
const benutzername = $("benutzername");
const passwort = $("passwort");
const code = $("code");
const ersatz = $("ersatz");

// Nur ein Pfad dieser Website (siehe weiter.js)
const ziel = sicheresZiel(new URLSearchParams(location.search).get("weiter"));

// Gleicher Text für falsches Konto und falsches Passwort: Er verrät nicht, ob es das Konto gibt
const TEXTE = {
  fehlgeschlagen:
    "Anmeldung nicht möglich. Prüfe Benutzername und Passwort oder versuche es später nochmals.",
  zuViele:
    "Zu viele Versuche. Bitte warte kurz und versuche es später nochmals.",
  netz: "Keine Verbindung. Prüfe das Internet und versuche es nochmals.",
  codeFalsch: "Der Code stimmt nicht. Prüfe ihn und versuche es nochmals.",
  abgelaufen:
    "Die Anmeldung ist abgelaufen. Bitte gib Benutzername und Passwort nochmals ein.",
};

function zeigeFehler(text, felder) {
  fehler.className = "hinweis hinweis--fehler";
  const p = document.createElement("p");
  const fett = document.createElement("strong");
  fett.textContent = "Fehler: ";
  p.append(fett, text);
  fehler.replaceChildren(p);
  fehler.hidden = false;
  for (const f of [benutzername, passwort, code]) {
    f.removeAttribute("aria-invalid");
    f.removeAttribute("aria-describedby");
  }
  for (const f of felder) {
    f.setAttribute("aria-invalid", "true");
    f.setAttribute("aria-describedby", "fehler");
  }
  // Der Fokus auf der Meldung liest sie vor
  fehler.focus();
}

const verstecke = () => {
  fehler.hidden = true;
  fehler.replaceChildren();
};

// Die Antwort auf einen Aufruf: Status und Code (better-auth), nie der Text der Antwort
async function sende(pfad, body) {
  let antwort;
  try {
    antwort = await fetch(pfad, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0 };
  }
  let daten = null;
  try {
    daten = await antwort.json();
  } catch {
    // Kein JSON: Der Status genügt
  }
  return { status: antwort.status, code: daten?.code, daten };
}

const weiter = () => location.assign(ziel);

function zeigeFaktor() {
  anmeldung.hidden = true;
  faktor.hidden = false;
  code.focus();
}

function zeigeAnmeldung(text) {
  faktor.hidden = true;
  anmeldung.hidden = false;
  if (text) zeigeFehler(text, [benutzername, passwort]);
  benutzername.focus();
}

anmeldung.addEventListener("submit", async (e) => {
  e.preventDefault();
  verstecke();
  const name = benutzername.value.trim();
  const pw = passwort.value;
  if (!name || !pw) {
    zeigeFehler(
      "Bitte gib Benutzername und Passwort ein.",
      [!name && benutzername, !pw && passwort].filter(Boolean),
    );
    return;
  }
  const senden = anmeldung.querySelector("button[type=submit]");
  senden.disabled = true;
  const r = await sende("/api/auth/sign-in/username", {
    username: name,
    password: pw,
  });
  senden.disabled = false;
  passwort.value = "";
  if (r.status === 200) {
    if (r.daten?.twoFactorRedirect) zeigeFaktor();
    else weiter();
    return;
  }
  zeigeFehler(
    r.status === 0
      ? TEXTE.netz
      : r.status === 429
        ? TEXTE.zuViele
        : TEXTE.fehlgeschlagen,
    r.status === 0 || r.status === 429 ? [] : [benutzername, passwort],
  );
});

let istErsatz = false;
ersatz.addEventListener("click", () => {
  istErsatz = !istErsatz;
  $("code-label").textContent = istErsatz
    ? "Ersatzcode"
    : "Code aus der Authenticator-App";
  $("code-hilfe").textContent = istErsatz
    ? "Format: xxxxx-xxxxx. Jeder Ersatzcode gilt nur einmal."
    : "Sechs Ziffern.";
  ersatz.textContent = istErsatz
    ? "Code aus der App verwenden"
    : "Ersatzcode verwenden";
  code.setAttribute("inputmode", istErsatz ? "text" : "numeric");
  code.setAttribute("autocomplete", istErsatz ? "off" : "one-time-code");
  code.value = "";
  verstecke();
  code.focus();
});

faktor.addEventListener("submit", async (e) => {
  e.preventDefault();
  verstecke();
  const wert = code.value.trim();
  if (!wert) {
    zeigeFehler("Bitte gib den Code ein.", [code]);
    return;
  }
  const senden = faktor.querySelector("button[type=submit]");
  senden.disabled = true;
  const r = await sende(
    istErsatz
      ? "/api/auth/two-factor/verify-backup-code"
      : "/api/auth/two-factor/verify-totp",
    { code: wert },
  );
  senden.disabled = false;
  code.value = "";
  if (r.status === 200) {
    weiter();
    return;
  }
  // Ohne gültiges Zwischen-Cookie hilft nur eine neue Anmeldung
  if (
    r.code === "INVALID_TWO_FACTOR_COOKIE" ||
    r.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
  ) {
    zeigeAnmeldung(TEXTE.abgelaufen);
    return;
  }
  zeigeFehler(
    r.status === 0
      ? TEXTE.netz
      : r.status === 429
        ? TEXTE.zuViele
        : TEXTE.codeFalsch,
    r.status === 0 || r.status === 429 ? [] : [code],
  );
});
