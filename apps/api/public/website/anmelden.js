// Anmeldung auf der Website (#354, Design W9): dieselben Aufrufe wie die Verwaltung unter /api/auth (Rate-Limit und Sperre nach Fehlversuchen gelten dort), gleiche Herkunft, das Cookie setzt der Server.
// Das Passwort geht nur als JSON im Body hin, nie in eine Adresse; es wird nach dem Absenden aus dem Feld gelöscht und nirgends gespeichert oder protokolliert.
import { sicheresZiel } from "./weiter.js";
import { band, el, symbol } from "./ui.js";

const $ = (id) => document.getElementById(id);
const meldung = $("meldung");
const anmeldung = $("anmeldung");
const faktor = $("faktor");
const benutzername = $("benutzername");
const passwort = $("passwort");
const code = $("code");
const ersatz = $("ersatz");
const zeigen = $("zeigen");

// Nur ein Pfad dieser Website (siehe weiter.js)
const ziel = sicheresZiel(new URLSearchParams(location.search).get("weiter"));

// Gleicher Text für falsches Konto und falsches Passwort: Er verrät nicht, ob es das Konto gibt
const TEXTE = {
  fehlgeschlagen: [
    "Benutzername oder Passwort stimmen nicht.",
    "Prüfe beides und versuche es nochmals.",
  ],
  zuViele: ["Zu viele Versuche.", "Warte kurz und versuche es nochmals."],
  netz: ["Keine Verbindung.", "Prüfe dein Internet und versuche es nochmals."],
  codeFalsch: ["Der Code stimmt nicht.", "Prüfe ihn und versuche es nochmals."],
  abgelaufen: ["Die Anmeldung ist abgelaufen.", "Melde dich nochmals an."],
};
const ART = { zuViele: "wa", abgelaufen: "", netz: "fe" };

const felder = [benutzername, passwort, code];

function raeumeFehler() {
  meldung.replaceChildren();
  for (const f of felder) {
    f.removeAttribute("aria-invalid");
    f.removeAttribute("aria-describedby");
    f.closest(".feld")?.classList.remove("fehler");
    $(`${f.id}-f`)?.remove();
  }
}

// Eine Meldung oben, die der Screenreader sofort ansagt; der Fokus bleibt, wo er ist, ausser bei der Zusammenfassung (sie trägt ihn)
function zeigeMeldung(schluessel, markiere = []) {
  const [titel, text] = TEXTE[schluessel];
  const b = band(
    ART[schluessel] ?? "fe",
    titel,
    text,
    ART[schluessel] === "" ? "info" : "warnung",
  );
  b.setAttribute("role", ART[schluessel] === "" ? "status" : "alert");
  meldung.replaceChildren(b);
  for (const f of markiere) f.setAttribute("aria-invalid", "true");
}

// Fehlen Angaben, steht oben eine Liste mit Links auf die Felder und je Feld ein Text (Design W9 «Validierungsfehler»)
function zeigeFehlt(fehlende) {
  const liste = el("ul", "");
  for (const [feld, text] of fehlende) {
    const link = el("a", "", text);
    link.href = `#${feld.id}`;
    liste.append(el("li", "", link));
    feld.setAttribute("aria-invalid", "true");
    feld.setAttribute("aria-describedby", `${feld.id}-f`);
    const huelle = feld.closest(".feld");
    huelle.classList.add("fehler");
    const t = el("p", "fehlertext", symbol("warnung"), text);
    t.id = `${feld.id}-f`;
    huelle.append(t);
  }
  const b = el(
    "div",
    "band fe zusammenfassung",
    symbol("warnung"),
    el(
      "div",
      "text",
      el(
        "strong",
        "",
        fehlende.length === 1
          ? "1 Angabe prüfen"
          : `${fehlende.length} Angaben prüfen`,
      ),
      liste,
    ),
  );
  b.setAttribute("role", "alert");
  b.tabIndex = -1;
  meldung.replaceChildren(b);
  b.focus();
}

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

// «Melde an …»: Der Knopf bleibt fokussierbar (aria-disabled statt disabled), die Felder sind schreibgeschützt
function laeuft(form, an, text) {
  const knopf = form.querySelector("button[type=submit]");
  const felderDerForm = [...form.querySelectorAll("input")];
  if (an) {
    knopf.dataset.text = knopf.textContent;
    knopf.setAttribute("aria-disabled", "true");
    knopf.setAttribute("aria-busy", "true");
    knopf.replaceChildren(el("span", "lade"), text);
    knopf.firstChild.setAttribute("aria-hidden", "true");
    felderDerForm.forEach((f) => (f.readOnly = true));
  } else {
    knopf.removeAttribute("aria-disabled");
    knopf.removeAttribute("aria-busy");
    knopf.replaceChildren(knopf.dataset.text);
    felderDerForm.forEach((f) => (f.readOnly = false));
  }
}
const istBeschaeftigt = (form) =>
  form.querySelector("button[type=submit]").getAttribute("aria-busy") ===
  "true";

function zeigeFaktor() {
  anmeldung.hidden = true;
  faktor.hidden = false;
  code.focus();
}

function zeigeAnmeldung(schluessel) {
  faktor.hidden = true;
  anmeldung.hidden = false;
  raeumeFehler();
  if (schluessel) zeigeMeldung(schluessel);
  benutzername.focus();
}

zeigen.addEventListener("click", () => {
  const an = zeigen.getAttribute("aria-pressed") !== "true";
  zeigen.setAttribute("aria-pressed", String(an));
  zeigen.setAttribute(
    "aria-label",
    an ? "Passwort verbergen" : "Passwort anzeigen",
  );
  passwort.type = an ? "text" : "password";
});

anmeldung.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (istBeschaeftigt(anmeldung)) return;
  raeumeFehler();
  const name = benutzername.value.trim();
  const pw = passwort.value;
  const fehlt = [];
  if (!name) fehlt.push([benutzername, "Gib deinen Benutzernamen ein."]);
  if (!pw) fehlt.push([passwort, "Gib dein Passwort ein."]);
  if (fehlt.length > 0) {
    zeigeFehlt(fehlt);
    return;
  }
  laeuft(anmeldung, true, "Melde an …");
  const r = await sende("/api/auth/sign-in/username", {
    username: name,
    password: pw,
  });
  passwort.value = "";
  passwort.type = "password";
  zeigen.setAttribute("aria-pressed", "false");
  zeigen.setAttribute("aria-label", "Passwort anzeigen");
  if (r.status === 200) {
    if (r.daten?.twoFactorRedirect) {
      laeuft(anmeldung, false);
      zeigeFaktor();
    } else {
      weiter();
    }
    return;
  }
  laeuft(anmeldung, false);
  const schluessel =
    r.status === 0 ? "netz" : r.status === 429 ? "zuViele" : "fehlgeschlagen";
  zeigeMeldung(
    schluessel,
    schluessel === "fehlgeschlagen" ? [benutzername, passwort] : [],
  );
});

let istErsatz = false;
ersatz.addEventListener("click", () => {
  istErsatz = !istErsatz;
  $("code-label").textContent = istErsatz
    ? "Ersatzcode"
    : "Code aus deiner App";
  $("code-hilfe").textContent = istErsatz
    ? "Format: xxxxx-xxxxx. Jeder Ersatzcode gilt nur einmal."
    : "Sechs Ziffern. Einfügen geht auch.";
  ersatz.textContent = istErsatz
    ? "Code aus der App verwenden"
    : "Ersatzcode verwenden";
  code.setAttribute("inputmode", istErsatz ? "text" : "numeric");
  code.setAttribute("autocomplete", istErsatz ? "off" : "one-time-code");
  code.value = "";
  raeumeFehler();
  code.focus();
});

$("abbrechen").addEventListener("click", () => zeigeAnmeldung());

faktor.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (istBeschaeftigt(faktor)) return;
  raeumeFehler();
  const wert = code.value.trim();
  if (!wert) {
    zeigeFehlt([[code, "Gib den Code ein."]]);
    return;
  }
  laeuft(faktor, true, "Prüfe …");
  const r = await sende(
    istErsatz
      ? "/api/auth/two-factor/verify-backup-code"
      : "/api/auth/two-factor/verify-totp",
    { code: wert },
  );
  code.value = "";
  if (r.status === 200) {
    weiter();
    return;
  }
  laeuft(faktor, false);
  // Ohne gültiges Zwischen-Cookie hilft nur eine neue Anmeldung
  if (
    r.code === "INVALID_TWO_FACTOR_COOKIE" ||
    r.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
  ) {
    zeigeAnmeldung("abgelaufen");
    return;
  }
  const schluessel =
    r.status === 0 ? "netz" : r.status === 429 ? "zuViele" : "codeFalsch";
  zeigeMeldung(schluessel, schluessel === "codeFalsch" ? [code] : []);
});
