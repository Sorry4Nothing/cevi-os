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
import { el, icon, knopf, leere } from "./dom.js";
import { schliesseAlle } from "./fluss.js";
import { erstellePalette } from "./befehlspalette.js";
import { erstelleHinweisband } from "./hinweisband.js";
import { erstelleLader } from "./lader.js";
import { erstelleEinrichtung } from "./zweiter-faktor-einrichten.js";
import { istAbteilungsleitung, istEntwickler, siehtAlles } from "./sicht.js";
import {
  BEREICHE,
  anmeldeAdresse,
  loese,
  neueAdresse,
  rolleVon,
  sichtbareBereiche as bereicheFuer,
} from "./navigation.js";
import {
  erstelleLeisten,
  erstelleToasts,
  bindeThema,
  ladeOeffentlicheMarke,
  logozeile,
  seitenkopf,
  setzeMarke,
} from "./rahmen.js";
import { verdrahteMelder } from "./melden.js";
import { mitRueckgaengig, steuerung, verdrahte } from "./rueckgaengig.js";
import { merkeEintrag, stelleWiederHer } from "./verlauf.js";
import {
  nochmals,
  rahmenzustand,
  zeichen,
  zustandsDaten,
} from "./zustaende.js";

const app = document.getElementById("app");
// Das Konto aus get-session, dazu «abteilungsleitung» und «entwickler» aus GET /api/v1/ich (#737): Wer die Person ist, sagt die API, nicht die Sitzung
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
// Die Abteilungsleitung und der Entwickler sehen alle Bereiche (der Entwickler dazu die Einträge nur für ihn), alle anderen nur die, die der Server ihnen nennt (heute: «website» und «plattform»)
const sichtbareBereiche = () =>
  bereicheFuer({
    abteilungsleitung: istAbteilungsleitung(ich),
    entwickler: istEntwickler(ich),
    zugang,
  });

// Suche (Strg oder Cmd + K): Seiten, Personen, Gruppen, Termine, Anlässe, Website-Seiten und Lager, nur im Rahmen dessen, was die Navigation der Person zeigt
const palette = erstellePalette({
  bereiche: () => sichtbareBereiche(),
  bereit: () => ich !== null && document.getElementById("bereich") !== null,
  ich: () => ich?.id ?? null,
});

function zeichne(...knoten) {
  for (const dialog of document.querySelectorAll("dialog")) dialog.remove();
  schliesseAlle();
  leere(app);
  app.append(...knoten);
  // Der Umschalter Hell und Dunkel im Kopf (theme.js)
  bindeThema();
}

// Karte in der Mitte für Zustände nach der Anmeldung (zweiten Faktor einrichten, kein Zugang): Überzeile, Titel und Text zuerst; der Fokus liegt auf dem Titel. Die Anmeldung selbst steht auf der Website (#818)
// kopfzeichen: Chip oder Symbol über der Überzeile
function anmeldeSeite({
  ueber = "Cevi OS · Verwaltung",
  titel,
  text,
  kopfzeichen,
  inhalt = [],
}) {
  const ueberschrift = el("h1", { tabindex: "-1" }, titel);
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
          ...inhalt,
        ),
      ),
    ),
  );
  ueberschrift.focus();
}

// Die einzige Anmeldeseite ist die der Website unter /anmelden (#818): Benutzername, Passwort, zweiter Faktor, Ersatzcode und die Fehlertexte stehen dort (website/anmelden.js). Von hier geht es mit einem Rücksprung zurück in die Verwaltung, mit dem Bereich nach dem «#». Die Seite prüft den Rücksprung selbst gegen eine Liste (website/weiter.js).
// grund: Schlüssel eines festen Hinweises auf der Anmeldeseite («abgemeldet», «alle», «sitzung», «code»)
function zurAnmeldeseite(grund) {
  ich = null;
  // Die Suche behält nichts vom bisherigen Konto
  palette.vergiss();
  location.replace(anmeldeAdresse(location.hash, grund));
}

const SPERRE_2FA = ["Zweiter Faktor fehlt", "schild", "warn"];

// Pflicht, aber noch nicht eingerichtet (#715): statt einer Fehlermeldung der Ablauf zum Einrichten. Danach geht es mit dem neuen Zustand der Sitzung in die Verwaltung. Der Faktor gilt für die Verwaltung; die Website und die Apps brauchen ihn nie
function zeigeEinrichtung() {
  const einrichtung = erstelleEinrichtung({
    beiFertig: () => pruefeKonto().catch(zeigeStartFehler),
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

// Das Konto hat den zweiten Faktor, diese Sitzung aber keinen Code geprüft (#721). Die Anmeldeseite fragt immer nach dem Code, so eine Sitzung stammt also nicht aus ihr (die der App haben nie Zugang zur Verwaltung). Nachholen geht nicht, die API lehnt es ab: abmelden und neu anmelden, dann folgt der Code
async function neuAnmeldenMitCode() {
  try {
    await anfrage("POST", "/api/auth/sign-out", {});
  } catch {
    // Die neue Anmeldung ersetzt das Cookie ohnehin
  }
  zurAnmeldeseite("code");
}

// Ohne Sitzung geht es zur Anmeldeseite der Website, mit Rücksprung hierher
async function pruefeKonto() {
  const sitzung = await anfrage("GET", "/api/auth/get-session");
  if (!sitzung) {
    zurAnmeldeseite();
    return;
  }
  // Eine Abfrage mehr als die Sitzung: Das Konto trägt die Rollen nicht (#737). Sie ist auch vor dem Pflichtwechsel und ohne zweiten Faktor offen
  // Unter der Sperre von «alles» antwortet auch diese Route mit 423 (#803): Dann kennt die Verwaltung die Person nur aus der Sitzung und öffnet nur «Wartung und Sperre»
  let profil = null;
  try {
    profil = await anfrage("GET", "/api/v1/ich");
  } catch (f) {
    if (!(f instanceof ApiFehler && f.code === "GESPERRT")) throw f;
  }
  ich = {
    ...sitzung.user,
    abteilungsleitung: profil?.abteilungsleitung === true,
    entwickler: profil?.entwickler === true,
    // Die Rechte des Katalogs, die der Server der Person gibt (GET /api/v1/ich, nach Abzügen der Abteilungsleitung): nur für die Anzeige, zum Beispiel «Konto löschen» (#771)
    rechte: Array.isArray(profil?.rechte) ? profil.rechte : [],
  };
  zugang = null;
  if (ich.mussPasswortAendern) {
    // Der Wechsel steht in «Mein Konto» der Website; die Anmeldeseite führt auch dorthin (website/anmelden.js)
    location.replace("/konto");
  } else if (!profil) {
    await zeigeNurPlattform();
  } else if (siehtAlles(ich)) {
    if (!ich.twoFactorEnabled) {
      zeigeEinrichtung();
      return;
    }
    if (sitzung.session?.zweiterFaktorGeprueft !== true) {
      await neuAnmeldenMitCode();
      return;
    }
    zugang = mitDarf(
      { redigieren: true, bereiche: ["website"], verwalten: true, rechte: [] },
      true,
    );
    await zeigeVerwaltung(profil);
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
      if (f instanceof ApiFehler && f.code === "ZWEITER_FAKTOR_SITZUNG") {
        await neuAnmeldenMitCode();
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
    await zeigeVerwaltung(profil);
  }
}

// Sperre von «alles» (#803): GET /api/v1/plattform/schalter ist die einzige Route der Verwaltung, die noch antwortet. Wer dort schalten darf, bekommt «Wartung und Sperre» und nichts sonst; für alle anderen weist schon die Anmeldung ab
async function zeigeNurPlattform() {
  try {
    await anfrage("GET", "/api/v1/plattform/schalter");
  } catch (f) {
    if (f instanceof ApiFehler && f.code === "ZWEITER_FAKTOR_FEHLT") {
      zeigeEinrichtung();
      return;
    }
    if (f instanceof ApiFehler && f.code === "ZWEITER_FAKTOR_SITZUNG") {
      await neuAnmeldenMitCode();
      return;
    }
    if (!(f instanceof ApiFehler && f.status === 403)) throw f;
    zeigeSperre("Dieses Konto hat keinen Zugang zur Verwaltung.", [
      "403 · Kein Zugang",
      "sperre",
      "fehler",
    ]);
    return;
  }
  zugang = mitDarf(
    {
      redigieren: false,
      bereiche: ["plattform"],
      verwalten: false,
      rechte: [],
    },
    false,
  );
  await zeigeVerwaltung(null);
}

async function abmelden() {
  // Offene Aktionen mit «Rückgängig» laufen jetzt: Nach dem Abmelden gäbe es keine Sitzung mehr dafür
  await steuerung.alleAusfuehren();
  try {
    await anfrage("POST", "/api/auth/sign-out", {});
  } catch (f) {
    if (toasts.wurzel.isConnected) melde(fehlertext(f), "fehler");
    else zeigeStartFehler(f);
    return;
  }
  zurAnmeldeseite("abgemeldet");
}

// Rückmeldung als Toast (#761); ohne Aufbau der Verwaltung (Anmeldeseite, Rahmenseiten) zeigt sie nichts
function melde(text, art = "ok", aktion) {
  toasts.melde(text, art, aktion);
}
verdrahteMelder(melde);

// Schlichte Seite im Rahmen ohne Konto und ohne Bereichsleiste (A30: 401, 502 und 503 beim Start): Logozeile und der Zustand
function zeigeRahmenSeite(daten, aktionen) {
  ich = null;
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
    knopf("Neu anmelden", {
      art: "haupt",
      onclick: () => zurAnmeldeseite("sitzung"),
    }),
  ]);
}

// Ist die API beim Start nicht erreichbar, hilft keine Anmeldung: eigene Seite mit «Nochmals versuchen»
function zeigeStartFehler(f) {
  zeigeRahmenSeite(zustandsDaten(f), [
    nochmals(() => pruefeKonto().catch(zeigeStartFehler)),
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
  siehtAlles(ich) || zugang?.bereiche.includes("plattform") === true;
// Toasts (#578, #761): «Rückgängig» und die Rückmeldungen nach Aktionen. Die Region steht im Seitenaufbau gleich nach dem Kopf; sie bleibt bei jeder Navigation bestehen, auch eine Meldung nach dem Speichern, wenn die Ansicht wechselt
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

// profil: Antwort von GET /api/v1/ich, schon geladen
async function zeigeVerwaltung(profil) {
  // Vor dem ersten Bild, damit Kopf und Menü gleich stimmen: die Einstellungen der Website (Name, Logo; nur wer «Seiten veröffentlichen» darf, sonst 403); das eigene Profil (Rolle und Profilbild im Kopf, #621) kommt schon aus pruefeKonto
  const darfEinstellungen =
    siehtAlles(ich) || zugang.darf("seiten.veroeffentlichen");
  const einstellungen = darfEinstellungen
    ? await anfrage("GET", "/api/v1/redaktion/website").catch(() => null)
    : null;
  const rolle = rolleVon({
    abteilungsleitung: istAbteilungsleitung(ich),
    entwickler: istEntwickler(ich),
    zugang,
    profil,
  });
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
    // Für «Mein Konto» (#621): der Weg zur Anmeldung, wenn alle Sitzungen beendet sind
    zurAnmeldung: () => zurAnmeldeseite("alle"),
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
pruefeKonto().catch(zeigeStartFehler);
