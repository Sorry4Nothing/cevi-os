// Der Wächter für ungespeicherte Änderungen hört auf «hashchange» vor der Navigation unten (#699)
import "./ungespeichert.js";
import "./tipp.js";
import {
  ApiFehler,
  anfrage,
  beiSitzungsende,
  fehlertext,
  setzeVerlassen,
} from "./api.js";
import { codefeld, el, feld, icon, knopf, leere } from "./dom.js";
import { schliesseAlle } from "./fluss.js";
import { erstellePalette } from "./befehlspalette.js";
import { erstelleHinweisband } from "./hinweisband.js";
import { erstelleLader } from "./lader.js";
import { erstelleEinrichtung } from "./zweiter-faktor-einrichten.js";
import {
  BEREICHE,
  loese,
  neueAdresse,
  rolleVon,
  sichtbareBereiche as bereicheFuer,
} from "./navigation.js";
import {
  erstelleLeisten,
  erstelleRueckmeldungen,
  erstelleToasts,
  bindeThema,
  ladeOeffentlicheMarke,
  logozeile,
  seitenkopf,
  setzeMarke,
} from "./rahmen.js";
import { mitRueckgaengig, steuerung, verdrahte } from "./rueckgaengig.js";
import { merkeEintrag, stelleWiederHer } from "./verlauf.js";
import {
  nochmals,
  rahmenzustand,
  zeichen,
  zustandsDaten,
} from "./zustaende.js";

const app = document.getElementById("app");
let ich = null;
// Antwort von GET /api/v1/redaktion/ich, mit darf(recht) für die Plattformrechte (Rolle Webmaster); nur für die Anzeige, jede Route prüft selbst
let zugang = null;
// «termine»: was die Person bei Terminen, Räumen und Anlässen darf (Signale aus GET /api/v1/redaktion/ich, #649); die Abteilungsleitung darf alles
const ALLE_TERMINE = new Proxy({}, { get: () => true });
const mitDarf = (daten, alle) => ({
  ...daten,
  termine: alle ? ALLE_TERMINE : (daten.termine ?? {}),
  darf: (recht) =>
    alle ||
    daten.rechte.includes(recht) ||
    (daten.katalogRechte ?? []).includes(recht),
});
// Hat die Person mit diesen Rechten etwas in der Verwaltung zu tun? Website, Belegung oder ein Recht bei Termine, Räumen und Anlässen
const hatTerminRecht = (z) =>
  Object.values(z.termine ?? {}).some((v) => v === true);
const istAdmin = () => ich?.role === "admin";
// Nur der Entwickler darf den Namen der Abteilung ändern: Dieses Signal («nameAenderbar», GET /api/v1/redaktion/website) steuert den Eintrag «Komponenten»
let entwickler = false;
// Die Abteilungsleitung sieht alle Bereiche, alle anderen nur die, die der Server ihnen nennt (heute: «website» und «plattform»)
const sichtbareBereiche = () =>
  bereicheFuer({ istAdmin: istAdmin(), zugang, entwickler });

// Suche (Strg oder Cmd + K): Seiten, Personen, Gruppen, Termine, Anlässe, Website-Seiten und Lager, nur im Rahmen dessen, was die Navigation der Person zeigt
const palette = erstellePalette({
  bereiche: () => sichtbareBereiche(),
  bereit: () => ich !== null && document.getElementById("bereich") !== null,
  ich: () => ich?.id ?? null,
});

const ZU_VIELE = ["429 · Zu viele Versuche", "uhr", "warn"];

function zeichne(...knoten) {
  for (const dialog of document.querySelectorAll("dialog")) dialog.remove();
  schliesseAlle();
  leere(app);
  app.append(...knoten);
  // Der Umschalter Hell und Dunkel im Kopf (theme.js)
  bindeThema();
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

// Karte in der Mitte: Überzeile, Titel und Text zuerst; der Fokus liegt danach auf dem Hinweis oder dem Titel
// kopfzeichen: Chip oder Symbol über der Überzeile
function anmeldeSeite({
  ueber = "Cevi OS · Verwaltung",
  titel,
  text,
  hinweis,
  kopfzeichen,
  inhalt = [],
}) {
  const ueberschrift = el("h1", { tabindex: "-1" }, titel);
  const meldung =
    hinweis &&
    el("p", { class: "hinweis", role: "status", tabindex: "-1" }, hinweis);
  // Auch die Anmeldung trägt den Kopf der Website mit Marke und Umschalter Hell/Dunkel (#578); ohne Sitzung kennt sie weder Name noch Logo der Abteilung
  zeichne(
    el(
      "div",
      { class: "app" },
      el("header", {}, logozeile({ sichtbar: false })),
      el(
        "div",
        { class: "mitte" },
        el(
          "main",
          { class: "anmeldung karte", id: "inhalt", tabindex: "-1" },
          el(
            "div",
            { class: "anmeldung-kopf" },
            kopfzeichen,
            el("p", { class: "ueber" }, ueber),
            ueberschrift,
            el("p", { class: "leise" }, text),
          ),
          meldung,
          ...inhalt,
        ),
      ),
    ),
  );
  (meldung || ueberschrift).focus();
}

// kopfzeichen: Chip-Definition für zeichen(), z. B. ["429 · Zu viele Versuche", "uhr", "warn"]
function zeigeLogin(hinweis, kopfzeichen) {
  ich = null;
  // Die Suche behält nichts vom bisherigen Konto
  palette.vergiss();
  // Der Chip für «zu viele Versuche» steht von Anfang an im Kopf und erscheint erst bei einer 429
  const zuViele = zeichen(ZU_VIELE);
  zuViele.hidden = true;
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
    zuViele.hidden = true;
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
      const gebremst = f.status === 429;
      zuViele.hidden = !gebremst;
      fehler.className = gebremst
        ? "hinweis hinweis--warn"
        : "hinweis hinweis--fehler";
      zeigeFehler(fehler, fehlertext(f));
    } finally {
      senden.disabled = false;
    }
  });
  anmeldeSeite({
    titel: "Anmelden",
    text: "Melde dich mit deinem Konto an.",
    hinweis,
    kopfzeichen: kopfzeichen ? zeichen(kopfzeichen) : zuViele,
    inhalt: [formular],
  });
}

function zeigeCode(ersatz = false) {
  const code = ersatz
    ? feld({
        label: "Ersatzcode",
        hilfe: "Format: xxxxx-xxxxx. Jeder Ersatzcode gilt nur einmal.",
        autocomplete: "off",
        autocapitalize: "none",
        spellcheck: "false",
        required: true,
      })
    : codefeld({
        label: "Code aus der Authenticator-App",
        hilfe: "Sechs Ziffern. Der Code wird nach der letzten Ziffer geprüft.",
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
        code.eingabe.value = "";
        code.eingabe.dispatchEvent(new window.Event("input"));
        code.eingabe.setAttribute("aria-invalid", "true");
        zeigeFehler(fehler, fehlertext(f));
      }
    } finally {
      senden.disabled = false;
    }
  });
  anmeldeSeite({
    ueber: "Schritt 2 von 2",
    titel: "Zweiter Faktor",
    text: ersatz
      ? "Gib einen deiner Ersatzcodes ein."
      : "Gib den Code aus deiner Authenticator-App ein.",
    kopfzeichen: el("span", { class: "kreis" }, icon("schild")),
    inhalt: [formular],
  });
  code.eingabe.focus();
}

const SPERRE_2FA = ["Zweiter Faktor fehlt", "schild", "warn"];

// Pflicht, aber noch nicht eingerichtet (#715): statt einer Fehlermeldung der Ablauf zum Einrichten. Danach geht es mit dem neuen Zustand der Sitzung in die Verwaltung. Der Faktor gilt für die Verwaltung; die Website und die Apps brauchen ihn nie
function zeigeEinrichtung() {
  const einrichtung = erstelleEinrichtung({
    beiFertig: () => pruefeKonto(false).catch(zeigeStartFehler),
    fertigText: "Zur Verwaltung",
  });
  anmeldeSeite({
    titel: "Zweiten Faktor einrichten",
    text: "Für die Verwaltung brauchst du einen zweiten Faktor. Richte ihn jetzt ein, das dauert ein paar Minuten.",
    kopfzeichen: zeichen(SPERRE_2FA),
    inhalt: [
      einrichtung.wurzel,
      knopf("Abmelden", {
        art: "still",
        symbol: "abmelden",
        onclick: abmelden,
      }),
    ],
  });
}

// grund: [Text des Chips, Icon, Art]; ohne Angabe gilt der fehlende zweite Faktor
function zeigeSperre(text, grund = SPERRE_2FA) {
  anmeldeSeite({
    titel: "Verwaltung nicht möglich",
    text,
    kopfzeichen: zeichen(grund),
    inhalt: [knopf("Abmelden", { symbol: "abmelden", onclick: abmelden })],
  });
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
  zugang = null;
  entwickler = false;
  if (ich.mussPasswortAendern) {
    zeigeSperre(
      "Du musst zuerst dein Startpasswort ändern. Das geht in der App. Melde dich danach hier neu an.",
      ["Startpasswort offen", "schluessel", "warn"],
    );
  } else if (istAdmin()) {
    if (!ich.twoFactorEnabled) {
      zeigeEinrichtung();
      return;
    }
    zugang = mitDarf(
      { redigieren: true, bereiche: ["website"], verwalten: true, rechte: [] },
      true,
    );
    await zeigeVerwaltung();
  } else {
    // Alle anderen: nur der Bereich «Website» mit Bearbeitungsrecht und der Bereich «Plattform» mit dem Recht auf den Wartungsmodus. Es werden keine Daten der Abteilungsleitung geladen
    try {
      zugang = mitDarf(await anfrage("GET", "/api/v1/redaktion/ich"), false);
    } catch (f) {
      // Ein Recht, das den zweiten Faktor verlangt, aber kein Faktor (#715)
      if (f instanceof ApiFehler && f.code === "ZWEITER_FAKTOR_FEHLT") {
        zeigeEinrichtung();
        return;
      }
      throw f;
    }
    // Leitende ohne Zugang zur Website sehen den Belegungsplan der Räume (#628)
    if (
      zugang.bereiche.length === 0 &&
      zugang.belegung !== true &&
      !hatTerminRecht(zugang)
    ) {
      zeigeSperre("Dieses Konto hat keinen Zugang zur Verwaltung.", [
        "403 · Kein Zugang",
        "sperre",
        "fehler",
      ]);
      return;
    }
    await zeigeVerwaltung();
  }
}

async function abmelden() {
  // Offene Aktionen mit «Rückgängig» laufen jetzt: Nach dem Abmelden gäbe es keine Sitzung mehr dafür
  await steuerung.alleAusfuehren();
  try {
    await anfrage("POST", "/api/auth/sign-out", {});
  } catch (f) {
    if (document.getElementById("rueckmeldung")) melde(fehlertext(f), "fehler");
    else zeigeLogin(fehlertext(f));
    return;
  }
  zeigeLogin("Du bist abgemeldet.");
}

// Rückmeldung in die Live-Region (nach dem Aufbau der Verwaltung gesetzt)
let rueckmeldungen = null;
function melde(text, art = "ok", aktion) {
  rueckmeldungen?.melde(text, art, aktion);
}

// Schlichte Seite im Rahmen ohne Konto und ohne Bereichsleiste (A30: 401, 502 und 503 beim Start): Logozeile und der Zustand
function zeigeRahmenSeite(daten, aktionen) {
  ich = null;
  rueckmeldungen = null;
  const karte = rahmenzustand(daten, aktionen);
  zeichne(
    el(
      "div",
      { class: "app" },
      el("header", {}, logozeile({ sichtbar: false })),
      el(
        "main",
        { class: "inhalt", id: "inhalt", tabindex: "-1" },
        el("div", { class: "rahmen" }, karte.wurzel),
      ),
    ),
  );
  karte.titel.focus();
}

// A30: Sitzung abgelaufen (401); die Eingaben bleiben im Browser, nur die Anmeldung fehlt
function zeigeSitzungAbgelaufen() {
  zeigeRahmenSeite(zustandsDaten(new ApiFehler(401)), [
    knopf("Neu anmelden", { art: "haupt", onclick: () => zeigeLogin() }),
  ]);
}

// Ist die API beim Start nicht erreichbar, hilft keine Anmeldung: eigene Seite mit «Nochmals versuchen»
function zeigeStartFehler(f) {
  zeigeRahmenSeite(zustandsDaten(f), [
    nochmals(() => pruefeKonto(false).catch(zeigeStartFehler)),
  ]);
}

// Zum ersten Bereich, den die Person sieht: für die Abteilungsleitung die Übersicht
function zurUebersicht(klasse = "") {
  const erster = sichtbareBereiche()[0];
  return el(
    "a",
    { class: `knopf ${klasse}`.trim(), href: `#${erster.schluessel}` },
    icon(erster.symbol),
    erster.schluessel === "uebersicht"
      ? "Zur Übersicht"
      : `Zu «${erster.name}»`,
  );
}

const leisten = erstelleLeisten();
// Band bei Wartung oder Informationssperre (#593): nur für Personen, die die Plattform sehen; die Zustände liegen im Speicher der API
const hinweisband = erstelleHinweisband();
const darfPlattform = () =>
  istAdmin() || zugang?.bereiche.includes("plattform") === true;
// Toasts mit «Rückgängig» (#578): Die Region steht im Seitenaufbau gleich nach dem Kopf; sie bleibt bei jeder Navigation bestehen
const toasts = erstelleToasts(steuerung);
verdrahte({
  beiAenderung: toasts.zeichne,
  ansage: toasts.sage,
  beimVerlassen: () => setzeVerlassen(true),
});
// Verlässt die Person die Seite vor Ablauf der Frist, läuft die Aktion sofort (keepalive), nie still verworfen
window.addEventListener("pagehide", () => {
  steuerung.alleAusfuehren({ verlassen: true });
});
// Stand der Zähler in der Unterleiste: «bereich/unterseite» -> Anzahl. Die Module melden sie, wenn sie die Zahl ohnehin geladen haben (keine eigene Abfrage).
const zaehlerStand = new Map();
let aktiv = null;
let navigation = 0;

async function zeigeVerwaltung() {
  // Zwei Fragen vor dem ersten Bild, damit Kopf und Menü gleich stimmen: die Einstellungen der Website (Name, Logo, Signal «nameAenderbar»; nur wer «Seiten veröffentlichen» darf, sonst 403) und für alle ohne Abteilungsleitung das eigene Profil (Rolle im Kopf)
  const darfEinstellungen =
    istAdmin() || zugang.darf("seiten.veroeffentlichen");
  const [einstellungen, profil] = await Promise.all([
    darfEinstellungen
      ? anfrage("GET", "/api/v1/redaktion/website").catch(() => null)
      : null,
    // Auch die Abteilungsleitung: Das Profilbild gehört in den Kopf (#621)
    anfrage("GET", "/api/v1/ich").catch(() => null),
  ]);
  entwickler = einstellungen?.nameAenderbar === true;
  const rolle = rolleVon({
    istAdmin: istAdmin(),
    entwickler,
    zugang,
    profil,
  });
  rueckmeldungen = erstelleRueckmeldungen();
  // Name und Logo der Abteilung aus den Einstellungen der Website; ohne Recht darauf bleibt, was die öffentliche Website zeigt, sonst die Wortmarke «CEVI»
  if (einstellungen) setzeMarke(einstellungen);
  zaehlerStand.clear();
  aktiv = null;
  hinweisband.zeichne([]);
  if (darfPlattform()) hinweisband.aktualisiere({ erzwingen: true });
  zeichne(
    el(
      "div",
      { class: "app" },
      el(
        "header",
        { class: "kopfzeile" },
        logozeile({
          konto: { name: ich.name, rolle, bildUrl: profil?.bildUrl ?? null },
          beiAbmelden: abmelden,
          suche: palette.knopf,
        }),
        leisten.wurzel,
      ),
      hinweisband.wurzel,
      toasts.wurzel,
      el(
        "main",
        { class: "inhalt", id: "inhalt", tabindex: "-1" },
        el(
          "div",
          { class: "rahmen" },
          el("div", { id: "seitenkopf" }),
          rueckmeldungen.wurzel,
          el("div", { id: "bereich" }),
        ),
      ),
    ),
  );
  navigiere();
}

// A30 «Kein Zugriff»: Die Leiste bleibt, der Bereich ist für diese Rolle gesperrt
function zeigeKeinZugriff(bereichName) {
  aktiv = null;
  leisten.zeichne({ bereiche: sichtbareBereiche(), aktiv, zaehlerStand });
  document
    .getElementById("seitenkopf")
    .replaceWith(el("div", { id: "seitenkopf" }));
  document.title = "Kein Zugriff – Verwaltung – Cevi OS";
  melde("");
  const karte = rahmenzustand(
    {
      ueber: "Fehler 403",
      titel: "Dieser Bereich ist für die Abteilungsleitung.",
      text: `Den Bereich «${bereichName}» darfst du nicht öffnen. Wende dich an die Abteilungsleitung.`,
    },
    [zurUebersicht("knopf--haupt")],
  );
  document
    .getElementById("bereich")
    .replaceWith(el("div", { id: "bereich" }, karte.wurzel));
  karte.titel.focus();
}

function zeigeNichtGefunden() {
  aktiv = null;
  leisten.zeichne({ bereiche: sichtbareBereiche(), aktiv, zaehlerStand });
  document
    .getElementById("seitenkopf")
    .replaceWith(el("div", { id: "seitenkopf" }));
  document.title = "Nicht gefunden – Verwaltung – Cevi OS";
  melde("");
  const karte = rahmenzustand(
    {
      ueber: "Fehler 404",
      titel: "Diese Seite gibt es nicht.",
      text: "Vielleicht ist der Link alt oder hat einen Tippfehler.",
    },
    [zurUebersicht("knopf--haupt")],
  );
  document
    .getElementById("bereich")
    .replaceWith(el("div", { id: "bereich" }, karte.wurzel));
  karte.titel.focus();
}

async function navigiere() {
  if (!ich || !document.getElementById("bereich")) return;
  // Der Sprunglink «Zum Inhalt» setzt #inhalt: nur den Fokus verschieben, den Bereich nicht neu laden
  if (location.hash === "#inhalt") {
    document.getElementById("inhalt").focus();
    return;
  }
  // Alte Adressen (#tags, #termine/raeume …) gehören jetzt zu einer anderen Seite
  const neu = neueAdresse(location.hash);
  if (neu !== location.hash) {
    window.history.replaceState(window.history.state, "", neu);
  }
  // Seiten im Fluss gehören zur Ansicht, die jetzt wechselt; der Eintrag im Verlauf (Position, Scroll) wird hier gemerkt (#578)
  schliesseAlle();
  merkeEintrag();
  const bereiche = sichtbareBereiche();
  const treffer = loese(location.hash, bereiche);
  if (!treffer) {
    // Ein Bereich, den es gibt, den diese Rolle aber nicht sieht, ist «Kein Zugriff» (403), kein toter Link
    const bekannt = loese(location.hash, BEREICHE);
    if (bekannt) zeigeKeinZugriff(bekannt.bereich.name);
    else zeigeNichtGefunden();
    return;
  }
  const { bereich: gruppe, unter, pfad } = treffer;
  if (darfPlattform()) hinweisband.aktualisiere();
  const meine = ++navigation;
  aktiv = { bereich: gruppe, unter };
  leisten.zeichne({ bereiche, aktiv, zaehlerStand });
  const kopf = seitenkopf({ titel: unter.name, untertitel: unter.untertitel });
  document.getElementById("seitenkopf").replaceWith(kopf.wurzel);
  document.title = `${unter.name} – Verwaltung – Cevi OS`;
  melde("");
  // Ein neuer Container je Navigation: Späte Antworten des alten landen in einem abgehängten Knoten
  const container = el("div", { id: "bereich" });
  document.getElementById("bereich").replaceWith(container);
  // Ohne Scrollen: Die Stelle der Seite setzt stelleWiederHer() (oder der Bereich, der sie behält)
  kopf.h1.focus({ preventScroll: true });
  let modul;
  try {
    modul = await import(unter.modul ?? "./platzhalter.js");
  } catch (f) {
    if (meine !== navigation) return;
    const karte = rahmenzustand(zustandsDaten(f), [
      nochmals(() => navigiere()),
    ]);
    container.append(karte.wurzel);
    karte.titel.focus();
    return;
  }
  if (meine !== navigation) return;
  modul.zeige(container, {
    ich,
    zugang,
    pfad,
    // Wo die Person gerade ist (für Module, die mehrere Seiten bedienen, und für den Platzhalter)
    seite: { bereich: gruppe, unter },
    // Für «Mein Konto» (#621): ob die Person den Namen der Abteilung ändern darf (Rolle im Kopf) und der Weg zur Anmeldung, wenn alle Sitzungen beendet sind
    entwickler,
    zurAnmeldung: (text) => zeigeLogin(text),
    melde,
    // Aktion mit «Rückgängig» statt Rückfrage (rueckgaengig.js)
    mitRueckgaengig,
    lade: erstelleLader(container, { zurUebersicht }),
    // Eine Adresse, die es nicht gibt (unbekannter Reiter, Kennung ohne UUID): «Diese Seite gibt es nicht» wie bei einem toten Link, ohne Anfrage an den Server
    nichtGefunden: () => {
      if (meine === navigation) zeigeNichtGefunden();
    },
    // Für Module mit eigenem Container (Website), damit das Laden nicht ihre Unternavigation leert
    erstelleLader: (ziel) => erstelleLader(ziel, { zurUebersicht }),
    // Hauptaktion rechts im Seitenkopf, z. B. «Person anlegen»; der Kopf wird mit jeder Navigation neu gebaut
    kopfAktion: (...knoten) => kopf.aktion.replaceChildren(...knoten),
    // Titel und Untertitel ersetzen, z. B. mit dem Namen des geöffneten Eintrags; der Fokus bleibt, wo er ist
    titel: (text, untertitel) => {
      kopf.h1.textContent = text;
      if (untertitel !== undefined) kopf.unter.textContent = untertitel;
      document.title = `${text} – Verwaltung – Cevi OS`;
    },
    // Zähler der Unterleiste (z. B. offene Vorschläge), wenn das Modul die Zahl ohnehin kennt
    // bereichSchluessel: für einen anderen Bereich als den eigenen (die Übersicht kennt die Zahlen der Termine und Räume)
    zaehler: (
      unterSchluessel,
      anzahl,
      bereichSchluessel = gruppe.schluessel,
    ) => {
      zaehlerStand.set(`${bereichSchluessel}/${unterSchluessel}`, anzahl);
      if (meine === navigation) {
        leisten.zeichne({ bereiche: sichtbareBereiche(), aktiv, zaehlerStand });
      }
    },
  });
  // Zurück an die gemerkte Stelle des Verlaufseintrags (der Inhalt lädt nach), sonst nach oben
  stelleWiederHer();
}

window.addEventListener("hashchange", navigiere);
// Der Sprunglink legt keinen Verlaufseintrag an: nur der Fokus geht zum Inhalt
document.addEventListener("click", (ereignis) => {
  if (!ereignis.target.closest?.("a.sprung")) return;
  ereignis.preventDefault();
  document.getElementById("inhalt")?.focus();
});
beiSitzungsende(() => {
  if (ich) zeigeSitzungAbgelaufen();
});

// Marke der Abteilung schon für die Anmeldung (öffentliche Website); nach der Anmeldung gehen die Einstellungen vor
ladeOeffentlicheMarke();
pruefeKonto(false).catch(zeigeStartFehler);
