// Die einzige Anmeldeseite (#354, Design W9; seit #818 auch für die Verwaltung unter /admin): Aufrufe unter /api/auth (Rate-Limit und Sperre nach Fehlversuchen gelten dort), gleiche Herkunft, das Cookie setzt der Server.
// Das Passwort geht nur als JSON im Body hin, nie in eine Adresse; es wird nach dem Absenden aus dem Feld gelöscht und nirgends gespeichert oder protokolliert.
import { sicheresRueckziel } from "./weiter.js";
import { band, el, holeMitFrist, symbol } from "./ui.js";
import { merkeToast, toast } from "./toast.js";

const $ = (id) => document.getElementById(id);
const meldung = $("meldung");
const anmeldung = $("anmeldung");
const faktor = $("faktor");
const benutzername = $("benutzername");
const passwort = $("passwort");
const code = $("code");
const ersatz = $("ersatz");
const zeigen = $("zeigen");
const karte = $("karte");
const status = $("status");
// Sechs einzelne Felder für den Code aus der App (#829); «code» ist das eine Feld für den Ersatzcode
const ziffern = [...document.querySelectorAll(".ziffer")];

// Nur ein Pfad dieser Website oder die Verwaltung (siehe weiter.js)
const anfrageDerSeite = new URLSearchParams(location.search);
const ziel = sicheresRueckziel(anfrageDerSeite.get("weiter"));

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
// Hinweise, mit denen die Verwaltung zur Anmeldung schickt («grund» in der Adresse): feste Texte, nie ein Wert aus der Adresse
const GRUENDE = {
  abgemeldet: ["Du bist abgemeldet.", ""],
  alle: ["Du bist auf allen Geräten abgemeldet.", ""],
  sitzung: ["Die Sitzung ist abgelaufen.", "Melde dich nochmals an."],
  code: ["Für die Verwaltung braucht es den Code.", "Melde dich neu an."],
};
// Falsche Angaben stehen am Feld und oben im Band; was die Anmeldung als Ganzes betrifft (Netz, Sperre, abgelaufen) ist ein Toast (#762)
const TOAST = { zuViele: "fehler", netz: "fehler", abgelaufen: "info" };

const felder = [benutzername, passwort, ...ziffern, code];

function raeumeFehler() {
  meldung.replaceChildren();
  for (const f of felder) {
    f.removeAttribute("aria-invalid");
    // Der Hinweis unter dem Feld bleibt am Feld, nur der Fehlertext geht
    if (f === code) f.setAttribute("aria-describedby", "code-hilfe");
    else f.removeAttribute("aria-describedby");
    f.closest(".feld")?.classList.remove("fehler");
    $(`${f.id}-f`)?.remove();
  }
}

// Eine Meldung oben, die der Screenreader sofort ansagt; der Fokus bleibt, wo er ist, ausser bei der Zusammenfassung (sie trägt ihn)
function zeigeMeldung(schluessel, markiere = []) {
  const [titel, text] = TEXTE[schluessel];
  if (TOAST[schluessel]) {
    toast(`${titel} ${text}`, TOAST[schluessel]);
    return;
  }
  const b = band("fe", titel, text, "warnung");
  b.setAttribute("role", "alert");
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
    feld.setAttribute(
      "aria-describedby",
      feld === code ? `${feld.id}-f code-hilfe` : `${feld.id}-f`,
    );
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
    // Mit Frist (#574): Der Knopf bleibt nicht für immer im Zustand «Melde an …»
    antwort = await holeMitFrist(pfad, {
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

// Ein Konto mit Startpasswort darf bis zum Wechsel nur sein Profil lesen (Pflichtwechsel): Die Anmeldung führt dann zu «Mein Konto», wo der Wechsel steht. Auf der Zielseite sähe die Person nichts von der Anmeldung (der Kopf bekommt ein 403)
// Der Toast «Angemeldet.» erscheint auf der Seite, zu der es weitergeht (#762)
async function weiter() {
  // Die Verwaltung zeigt keinen solchen Toast: Er bliebe bis zur nächsten Seite der Website liegen
  if (!ziel.startsWith("/admin")) merkeToast("Angemeldet.");
  let sitzung = null;
  try {
    const r = await fetch("/api/auth/get-session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (r.ok) sitzung = await r.json();
  } catch {
    // Ohne Antwort gilt die Zielseite
  }
  location.assign(sitzung?.user?.mussPasswortAendern ? "/konto" : ziel);
}

// «Melde an …»: Der Knopf bleibt fokussierbar (aria-disabled statt disabled), die Felder sind schreibgeschützt
// «ansage» hört der Screenreader in der Statusregion, solange der Aufruf läuft
function laeuft(form, an, text, ansage = "") {
  const knopf = form.querySelector("button[type=submit]");
  const felderDerForm = [...form.querySelectorAll("input")];
  if (an) {
    knopf.dataset.text = knopf.textContent;
    knopf.setAttribute("aria-disabled", "true");
    knopf.setAttribute("aria-busy", "true");
    knopf.replaceChildren(el("span", "lade"), text);
    knopf.firstChild.setAttribute("aria-hidden", "true");
    felderDerForm.forEach((f) => (f.readOnly = true));
    status.textContent = ansage;
  } else {
    knopf.removeAttribute("aria-disabled");
    knopf.removeAttribute("aria-busy");
    knopf.replaceChildren(knopf.dataset.text);
    felderDerForm.forEach((f) => (f.readOnly = false));
    status.textContent = "";
  }
}
const istBeschaeftigt = (form) =>
  form.querySelector("button[type=submit]").getAttribute("aria-busy") ===
  "true";

// Die Verwaltung verlangt den zweiten Faktor: Wer dorthin will (oder von dort mit «code» zurückkommt), sieht schon im ersten Schritt «Schritt 1 von 2». Für die Website bleibt die Überzeile weg, denn ob ein Konto den Faktor hat, weiss die Seite erst nach dem Passwort
const faktorBekannt =
  ziel.startsWith("/admin") || anfrageDerSeite.get("grund") === "code";

// Kopf der Karte je Schritt: Symbol, Überzeile, Titel, Text
function zeigeKopf(schritt) {
  karte.dataset.schritt = schritt;
  $("sym-1").hidden = schritt === 2;
  $("sym-2").hidden = schritt !== 2;
  const ueber = $("ueber");
  ueber.hidden = schritt === 1 && !faktorBekannt;
  ueber.textContent = `Schritt ${schritt} von 2`;
  $("titel").textContent = schritt === 1 ? "Anmelden" : "Zweiter Faktor";
  $("kopftext").textContent =
    schritt === 1
      ? "Mit demselben Konto wie in der App."
      : istErsatz
        ? "Gib einen deiner Ersatzcodes ein."
        : "Gib den Code aus deiner Authenticator-App ein.";
}

// Code aus der App (sechs Ziffern) oder Ersatzcode (ein Feld)
let istErsatz = false;
function setzeErsatz(an) {
  istErsatz = an;
  $("code-label").textContent = an
    ? "Ersatzcode"
    : "Code aus der Authenticator-App";
  $("code-hilfe").textContent = an
    ? "Format: xxxxx-xxxxx. Jeder Ersatzcode gilt nur einmal."
    : "Sechs Ziffern. Der Code wird nach der letzten Ziffer geprüft.";
  ersatz.textContent = an
    ? "Code aus der App verwenden"
    : "Ersatzcode verwenden";
  $("ziffern").hidden = an;
  code.hidden = !an;
  if (karte.dataset.schritt === "2") zeigeKopf(2);
}
const leereCode = () => {
  for (const z of ziffern) z.value = "";
  code.value = "";
};
const codeFelder = () => (istErsatz ? [code] : ziffern);

function zeigeFaktor() {
  anmeldung.hidden = true;
  faktor.hidden = false;
  zeigeKopf(2);
  codeFelder()[0].focus();
}

function zeigeAnmeldung(schluessel) {
  faktor.hidden = true;
  anmeldung.hidden = false;
  leereCode();
  setzeErsatz(false);
  zeigeKopf(1);
  raeumeFehler();
  if (schluessel) zeigeMeldung(schluessel);
  benutzername.focus();
}

// Wer von der Verwaltung kommt, sieht zuerst, warum (ein ruhiger Hinweis, nicht als Fehler)
const grundKey = anfrageDerSeite.get("grund");
const grund = Object.hasOwn(GRUENDE, grundKey) ? GRUENDE[grundKey] : null;
if (grund) {
  const hinweis = band("", grund[0], grund[1], "info");
  hinweis.setAttribute("role", "status");
  meldung.replaceChildren(hinweis);
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
  laeuft(anmeldung, true, "Melde an …", "Du wirst angemeldet.");
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

// Die Ziffernfelder (#829). Jedes Feld nimmt eine Ziffer; ein Code aus der Zwischenablage oder von der Autofüllung (ganzer Code im ersten Feld) wird auf alle Felder verteilt
zeigeKopf(1);

function fuelle(ab, text) {
  const z = text.replace(/[^0-9]/g, "");
  if (!z) return;
  if (ziffern[0].hasAttribute("aria-invalid")) raeumeFehler();
  // Ein ganzer Code ersetzt immer alle Felder, ein Rest füllt ab dem Feld
  const start = z.length >= ziffern.length ? 0 : ab;
  [...z].slice(0, ziffern.length - start).forEach((c, k) => {
    ziffern[start + k].value = c;
  });
  ziffern[Math.min(start + z.length, ziffern.length - 1)].focus();
  // Nach der letzten Ziffer wird der Code geprüft
  if (ziffern.every((f) => f.value) && !istBeschaeftigt(faktor)) {
    faktor.requestSubmit();
  }
}

ziffern.forEach((feld, i) => {
  feld.addEventListener("input", (e) => {
    if (e.inputType?.startsWith("delete")) return;
    // Getippt zählt nur das neue Zeichen; sonst (Autofüllung, Diktat) der ganze Wert
    const roh = e.inputType === "insertText" && e.data ? e.data : feld.value;
    if (/[0-9]/.test(roh)) fuelle(i, roh);
    else feld.value = feld.value.replace(/[^0-9]/g, "").slice(0, 1);
  });
  feld.addEventListener("paste", (e) => {
    e.preventDefault();
    fuelle(i, e.clipboardData?.getData("text") ?? "");
  });
  feld.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      ziffern[i - 1].focus();
    } else if (e.key === "ArrowRight" && i < ziffern.length - 1) {
      e.preventDefault();
      ziffern[i + 1].focus();
    } else if (e.key === "Backspace" && !feld.value && i > 0) {
      // Leeres Feld: zurück ins vorige und dessen Ziffer löschen
      e.preventDefault();
      ziffern[i - 1].value = "";
      ziffern[i - 1].focus();
    }
  });
  // Die Ziffer ist markiert: Tippen ersetzt sie
  feld.addEventListener("focus", () => feld.select());
});

ersatz.addEventListener("click", () => {
  setzeErsatz(!istErsatz);
  leereCode();
  raeumeFehler();
  codeFelder()[0].focus();
});

$("abbrechen").addEventListener("click", () => zeigeAnmeldung());

faktor.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (istBeschaeftigt(faktor)) return;
  raeumeFehler();
  const wert = istErsatz
    ? code.value.trim()
    : ziffern.map((f) => f.value).join("");
  if (!wert) {
    zeigeFehlt([[codeFelder()[0], "Gib den Code ein."]]);
    return;
  }
  if (!istErsatz && wert.length < ziffern.length) {
    zeigeFehlt([[ziffern[0], "Der Code hat sechs Ziffern."]]);
    return;
  }
  laeuft(faktor, true, "Prüfe …", "Der Code wird geprüft.");
  const r = await sende(
    istErsatz
      ? "/api/auth/two-factor/verify-backup-code"
      : "/api/auth/two-factor/verify-totp",
    { code: wert },
  );
  if (r.status === 200) {
    leereCode();
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
  // Ein falscher Code ist verbraucht: neu tippen, der Fokus geht ins erste Feld. Bei Netz und Sperre bleibt, was getippt ist
  if (schluessel === "codeFalsch") leereCode();
  zeigeMeldung(schluessel, schluessel === "codeFalsch" ? codeFelder() : []);
  if (schluessel === "codeFalsch") codeFelder()[0].focus();
});
