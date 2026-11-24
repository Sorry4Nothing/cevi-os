// Eigenes Konto eines Kindes (#644): Zugang in der Liste, Karte «Eigenes Konto» im Kind, die Seiten «Eigenes Konto erstellen» und «Konten für Kinder» (Einstellungen der Abteilung). Alles Seiten im Fluss, Rückfragen am Knopf (zweistufig), kein Popup.
// Regeln: Ein Kind hat keinen, einen verknüpften Elternteil, ein eigenes Konto oder beides. Das Konto sieht nur das eigene Kind; die Eltern bleiben verknüpft und sehen weiter, was das Kind sieht, ausser die Abteilung übergibt das Konto ganz.
import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  auswahl,
  chip,
  el,
  feld,
  flussKopf,
  geheimnisDialog,
  knopf,
  neueId,
} from "./dom.js";
import { datumsfeld, addiereTage, formatDatum } from "./datumsfeld.js";
import { oeffneFluss } from "./fluss.js";
import { entferneFehler, feldFehler, pruefHinweis } from "./liste-hilfen.js";
import { marke } from "./mitglieder.js";
import { zweistufig } from "./rueckgaengig.js";

// Zugang in Worten, wie ihn die API nennt (zugang): Text, Symbol und Ton der Marke
export const ZUGANG = {
  keiner: ["Kein Zugang", "sperre", "leise"],
  eltern: ["Eltern verknüpft", "haken", "ok"],
  konto: ["Eigenes Konto", "schluessel", "ok"],
  beides: ["Eltern und eigenes Konto", "schluessel", "ok"],
};

export const zugangText = (zugang) => (ZUGANG[zugang] ?? ZUGANG.keiner)[0];

// Ruhige Marke für Liste und Karte; ein Kind ohne Zugang ist kein Fehler, nur für die App unsichtbar
export function zugangMarke(zugang) {
  const [text, symbol, art] = ZUGANG[zugang] ?? ZUGANG.keiner;
  return marke(text, symbol, art);
}

// Zugang aus dem Formular: dieselbe Regel wie auf dem Server (kind-konto.ts, zugangVon)
export function zugangVon(eltern, hatKonto, elternEinsicht) {
  const elternSehen = eltern > 0 && (!hatKonto || elternEinsicht);
  if (hatKonto) return elternSehen ? "beides" : "konto";
  return elternSehen ? "eltern" : "keiner";
}

// Vorschlag für den Benutzernamen: vorname.nachname, nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich
export function benutzernameVorschlag(vorname, nachname) {
  const teil = (t) =>
    String(t ?? "")
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return [teil(vorname), teil(nachname)].filter(Boolean).join(".").slice(0, 64);
}

const heuteIso = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
    new Date(),
  );

// Die Liste lädt neu und ersetzt dabei den Inhalt des Bereichs: Das Startpasswort erscheint erst danach, sonst wäre die Karte gleich wieder weg
const nachLaden = (geladen, fn) => Promise.resolve(geladen).then(fn);

function startpasswortDialog(name, wert) {
  geheimnisDialog({
    titel: "Startpasswort",
    beschreibung: `Gib das Startpasswort für das Konto von «${name}» sicher weiter, am besten an die Eltern. Es gilt 7 Tage und bleibt in der Verwaltung sichtbar, bis das Kind es ersetzt hat.`,
    wert,
  });
}

// Aktion im Kontoabschnitt: Titel und Erklärung links, Knopf rechts
function aktion(titel, text, knopfKnoten) {
  return el(
    "div",
    { class: "zeile" },
    el(
      "div",
      { class: "personen-aktion" },
      el("p", { class: "name" }, titel),
      el("p", { class: "klein leise" }, text),
    ),
    knopfKnoten,
  );
}

function karte(titel, text, ...inhalt) {
  return el(
    "section",
    { class: "pe-karte" },
    el("h2", {}, titel),
    text && el("p", { class: "leise" }, text),
    ...inhalt,
  );
}

const WAS_DAS_KONTO_SIEHT = [
  "Die Programme und die Leitung der eigenen Stufe, die eigene Anmeldung und, wenn die Abteilung es erlaubt, den Gruppenchat der Stufe.",
  "Nie andere Kinder, deren Eltern, Telefonnummern oder die Verwaltung. Es gibt kein Profilbild und keinen Einzelchat mit der Leitung.",
];

// Die Karte im Kind (nur bei einem gespeicherten Kind): ohne Konto «Eigenes Konto erstellen», mit Konto Stand und Aktionen
export function kontoKarte({ kind, einstellung, ctx, neu, schliesse }) {
  const name = `${kind.vorname} ${kind.nachname}`;
  const konto = kind.konto;
  if (!konto) {
    const aus = !einstellung.erlaubt;
    return karte(
      "Eigenes Konto",
      "Ein Kind kann sich selbst anmelden, wenn die Abteilung es erlaubt und die Eltern einverstanden sind.",
      el(
        "ul",
        { class: "pe-liste" },
        ...WAS_DAS_KONTO_SIEHT.map((t) => el("li", {}, t)),
      ),
      aus
        ? el(
            "p",
            { class: "hinweis" },
            "Konten für Kinder sind ausgeschaltet. ",
            knopf("Konten für Kinder einstellen", {
              klein: true,
              onclick: () => oeffneKontoEinstellung({ einstellung, ctx, neu }),
            }),
          )
        : !kind.aktiv
          ? el(
              "p",
              { class: "hinweis" },
              "Das Kind ist inaktiv. Aktiviere es zuerst.",
            )
          : knopf("Eigenes Konto erstellen", {
              art: "haupt",
              symbol: "plus",
              onclick: () =>
                oeffneKontoErstellen({ kind, einstellung, ctx, neu }),
            }),
    );
  }

  const url = `/api/v1/admin/kinder/${kind.id}/konto`;
  const lauf = async (fn, danach) => {
    try {
      danach(await fn());
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    }
  };
  const fertig = (text, mitPasswort) => (antwort) => {
    const geladen = neu();
    ctx.melde(text);
    schliesse();
    if (mitPasswort) {
      nachLaden(geladen, () =>
        startpasswortDialog(name, antwort.startpasswort),
      );
    }
  };

  const zustand = konto.gesperrt
    ? chip("Gesperrt", "fehler")
    : konto.mussPasswortAendern
      ? chip("Startpasswort offen", "warn", "uhr")
      : chip("Aktiv", "ok");
  const zeile = (name, wert) =>
    el("li", {}, `${name}: `, el("strong", {}, wert));
  const angaben = el(
    "ul",
    { class: "pe-liste" },
    zeile("Benutzername", konto.benutzername ?? "–"),
    zeile(
      "Konto seit",
      konto.seit ? formatDatum(konto.seit.slice(0, 10)) : "–",
    ),
    zeile(
      "Eltern informiert am",
      konto.elternInformiertAm ? formatDatum(konto.elternInformiertAm) : "–",
    ),
  );

  // «Konto übergeben»: Die Eltern bleiben verknüpft, sehen aber nichts mehr von diesem Kind
  const uebergabe = konto.elternEinsicht
    ? aktion(
        "Konto übergeben",
        "Die Eltern bleiben verknüpft, sehen aber weder Programme noch Chat dieses Kindes mehr. Du kannst die Einsicht jederzeit zurückgeben.",
        zweistufig(
          knopf("Konto übergeben", { klein: true, symbol: "schluessel" }),
          "Eltern verlieren die Einsicht. Wirklich übergeben?",
          () =>
            lauf(
              () => anfrage("PATCH", url, { elternEinsicht: false }),
              fertig(
                `Das Konto von «${name}» ist übergeben. Die Eltern sehen nichts mehr.`,
              ),
            ),
        ),
      )
    : aktion(
        "Einsicht der Eltern zurückgeben",
        "Das Konto gehört dem Kind allein: Die verknüpften Eltern sehen nichts. Mit der Einsicht sehen sie wieder, was das Kind sieht.",
        knopf("Einsicht zurückgeben", {
          klein: true,
          onclick: () =>
            lauf(
              () => anfrage("PATCH", url, { elternEinsicht: true }),
              fertig(
                `Die Eltern von «${name}» sehen wieder, was das Kind sieht.`,
              ),
            ),
        }),
      );

  return karte(
    "Eigenes Konto",
    "Das Konto sieht nur dieses Kind: die Programme, die Leitung und je nach Einstellung den Chat der eigenen Stufe.",
    el("ul", { class: "chips" }, zustand),
    angaben,
    konto.startpasswort &&
      aktion(
        "Startpasswort ansehen",
        "Das Startpasswort ist noch offen und gilt 7 Tage.",
        knopf("Anzeigen", {
          klein: true,
          symbol: "schluessel",
          onclick: () => startpasswortDialog(name, konto.startpasswort),
        }),
      ),
    uebergabe,
    aktion(
      "Neues Startpasswort",
      "Meldet das Kind überall ab. Es wählt beim nächsten Anmelden ein eigenes Passwort.",
      zweistufig(
        knopf("Neues Startpasswort", { klein: true, symbol: "schluessel" }),
        "Das Kind wird überall abgemeldet. Neues Startpasswort erzeugen?",
        () =>
          lauf(
            () => anfrage("POST", `${url}/startpasswort`),
            fertig(`Neues Startpasswort für «${name}» ist erzeugt.`, true),
          ),
      ),
    ),
    konto.gesperrt
      ? aktion(
          "Konto entsperren",
          "Hebt die Sperre auf und erzeugt ein neues Startpasswort.",
          zweistufig(
            knopf("Entsperren", { klein: true }),
            "Konto entsperren und neues Startpasswort erzeugen?",
            () =>
              lauf(
                () => anfrage("POST", `${url}/entsperren`),
                fertig(`Das Konto von «${name}» ist entsperrt.`, true),
              ),
          ),
        )
      : aktion(
          "Konto sperren",
          "Das Kind kann sich nicht mehr anmelden und ist überall abgemeldet. Das Kind und seine Nachrichten bleiben.",
          zweistufig(
            knopf("Sperren", { klein: true, symbol: "sperre" }),
            "Das Kind wird überall abgemeldet. Konto sperren?",
            () =>
              lauf(
                () => anfrage("POST", `${url}/sperren`),
                fertig(`Das Konto von «${name}» ist gesperrt.`),
              ),
          ),
        ),
    aktion(
      "Konto entfernen",
      "Löscht das Konto und alle Nachrichten des Kindes. Das Kind bleibt, die Eltern sehen danach wieder alles.",
      zweistufig(
        knopf("Konto entfernen", { klein: true, symbol: "papierkorb" }),
        "Konto und Nachrichten löschen? Das lässt sich nicht zurücknehmen.",
        () =>
          lauf(
            () => anfrage("DELETE", url),
            fertig(`Das Konto von «${name}» ist entfernt.`),
          ),
      ),
    ),
  );
}

// Seite «Eigenes Konto erstellen»: Benutzername, Vermerk «Eltern informiert» mit Datum (Pflicht), Einsicht der Eltern
export function oeffneKontoErstellen({ kind, einstellung, ctx, neu }) {
  const name = `${kind.vorname} ${kind.nachname}`;
  const titelId = neueId("titel");
  const zurueck = document.activeElement;
  const benutzername = feld({
    label: "Benutzername",
    wert: benutzernameVorschlag(kind.vorname, kind.nachname),
    hilfe:
      "2 bis 64 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich. Gross- und Kleinschreibung zählt nicht.",
    maxlength: 64,
    autocapitalize: "none",
    spellcheck: "false",
    required: true,
  });
  const informiert = ankreuzen({
    label: "Die Eltern sind informiert und einverstanden",
  });
  const heute = heuteIso();
  const datum = datumsfeld({
    label: "Informiert am",
    wert: heute,
    hilfe: "Das Datum hält fest, wann die Abteilung die Eltern informiert hat.",
    required: true,
    min: addiereTage(heute, -365),
    max: heute,
  });
  const einsicht = ankreuzen({
    label: "Die Eltern sehen weiter, was das Kind sieht",
    gewaehlt: einstellung.elternEinsichtVorgabe,
  });

  const fehler = el("div", { class: "pe-zusammenfassung" });
  const speichern = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt" },
    "Konto erstellen",
  );
  const abbrechen = knopf("Abbrechen", {
    onclick: () => seite.versuchSchliessen(),
  });
  const formular = el(
    "form",
    { class: "pe-formular", novalidate: true },
    karte(
      "Anmeldung des Kindes",
      "Das Kind meldet sich mit diesem Benutzernamen und dem Startpasswort an. Das Passwort wählt es beim ersten Anmelden selbst.",
      benutzername.wurzel,
    ),
    karte(
      "Eltern",
      "Ein Konto für ein Kind erstellst du erst, nachdem du die Erziehungsberechtigten informiert hast. Cevi OS speichert nur das Datum, nicht den Text der Einwilligung.",
      einstellung.mindestalter
        ? el(
            "p",
            { class: "hinweis" },
            `Die Abteilung empfiehlt ein Konto ab ${einstellung.mindestalter} Jahren. Cevi OS kennt das Alter nicht: Prüfe es selbst.`,
          )
        : null,
      el("div", { class: "pe-wahlfeld" }, informiert.wurzel),
      datum.wurzel,
      el(
        "div",
        { class: "pe-wahlfeld" },
        einsicht.wurzel,
        el(
          "p",
          { class: "hilfe" },
          "Ohne Haken übergibst du das Konto ganz: Die verknüpften Eltern sehen dann nichts mehr von diesem Kind. Du kannst das später ändern.",
        ),
      ),
    ),
    karte(
      "Was das Konto sieht",
      null,
      el(
        "ul",
        { class: "pe-liste" },
        ...WAS_DAS_KONTO_SIEHT.map((t) => el("li", {}, t)),
      ),
      el(
        "p",
        { class: "hilfe" },
        einstellung.chat === "aus"
          ? "Der Gruppenchat ist für Kinder ausgeschaltet."
          : einstellung.chat === "lesen"
            ? "Im Gruppenchat der Stufe kann das Kind nur lesen."
            : "Im Gruppenchat der Stufe kann das Kind lesen und schreiben.",
      ),
    ),
    el("div", { class: "pe-fuss" }, fehler, abbrechen, speichern),
  );
  const { kopf } = flussKopf({
    titelId,
    titel: "Eigenes Konto erstellen",
    untertitel: name,
    beiZurueck: () => seite.versuchSchliessen(),
  });
  const seite = el(
    "section",
    { class: "fluss-seite pe-seite", "aria-labelledby": titelId },
    kopf,
    formular,
  );

  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.replaceChildren();
    for (const f of [benutzername, informiert, datum]) entferneFehler(f);
    const fehlt = [];
    const wert = benutzername.eingabe.value.trim();
    if (wert.length < 2 || !/^[a-z0-9._-]+$/i.test(wert)) {
      feldFehler(
        benutzername,
        "Der Benutzername braucht 2 bis 64 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich.",
      );
      fehlt.push({ name: "Benutzername", ...benutzername });
    }
    if (!informiert.eingabe.checked) {
      feldFehler(
        informiert,
        "Informiere zuerst die Eltern und bestätige es hier.",
      );
      fehlt.push({ name: "Eltern informiert", ...informiert });
    }
    if (!datum.eingabe.value) {
      feldFehler(
        datum,
        "Gib ein Datum von heute oder aus dem letzten Jahr an.",
      );
      fehlt.push({ name: "Datum", ...datum });
    }
    if (fehlt.length > 0) {
      const hinweis = pruefHinweis(fehlt);
      fehler.append(hinweis);
      hinweis.focus();
      return;
    }
    abbrechen.disabled = speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      const antwort = await anfrage(
        "POST",
        `/api/v1/admin/kinder/${kind.id}/konto`,
        {
          benutzername: wert,
          elternInformiertAm: datum.eingabe.value,
          elternEinsicht: einsicht.eingabe.checked,
        },
      );
      seite.close();
      const geladen = neu();
      ctx.melde(`Konto «${antwort.benutzername}» ist erstellt.`);
      nachLaden(geladen, () =>
        startpasswortDialog(name, antwort.startpasswort),
      );
    } catch (f) {
      if (f.code === "BENUTZERNAME_VERGEBEN") {
        feldFehler(
          benutzername,
          "Der Benutzername ist schon vergeben. Wähle einen anderen.",
        );
        benutzername.eingabe.focus();
        return;
      }
      const hinweis = el(
        "p",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht erstellt. ${fehlertext(f)}`,
      );
      fehler.replaceChildren(hinweis);
      hinweis.focus();
    } finally {
      abbrechen.disabled = speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });
  seite.addEventListener("close", () => {
    if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
    else document.querySelector("h1")?.focus();
  });
  oeffneFluss(seite);
  benutzername.eingabe.focus();
}

const CHAT_OPTIONEN = [
  ["aus", "Aus: Kinder sehen den Chat nicht"],
  ["lesen", "Lesen: Kinder lesen den Gruppenchat der Stufe mit"],
  ["schreiben", "Schreiben: Kinder lesen und schreiben im Gruppenchat"],
];
const ALTER_OPTIONEN = [
  ["", "Kein Hinweis"],
  ...Array.from({ length: 13 }, (_, i) => [
    String(i + 6),
    `ab ${i + 6} Jahren`,
  ]),
];

// Seite «Konten für Kinder»: Einstellungen der Abteilung. Die Vorgabe ist die vorsichtigste: Konten aus, Chat aus, Eltern behalten die Einsicht
export function oeffneKontoEinstellung({ einstellung, ctx, neu }) {
  const titelId = neueId("titel");
  const zurueck = document.activeElement;
  const erlaubt = ankreuzen({
    label: "Kinder dürfen ein eigenes Konto haben",
    gewaehlt: einstellung.erlaubt,
  });
  const chat = auswahl({
    label: "Gruppenchat der Stufe",
    optionen: CHAT_OPTIONEN,
    wert: einstellung.chat,
  });
  chat.wurzel.append(
    el(
      "p",
      { class: "hilfe" },
      "Einzelchats mit der Leitung gibt es für Kinder nie. Ist die Einstellung oben aus, ist auch der Chat aus.",
    ),
  );
  const alter = auswahl({
    label: "Empfohlenes Mindestalter",
    optionen: ALTER_OPTIONEN,
    wert: einstellung.mindestalter ? String(einstellung.mindestalter) : "",
  });
  alter.wurzel.append(
    el(
      "p",
      { class: "hilfe" },
      "Nur ein Hinweis beim Erstellen. Cevi OS kennt das Alter der Kinder nicht und prüft es nicht.",
    ),
  );
  const einsicht = ankreuzen({
    label: "Eltern sehen standardmässig weiter, was das Kind sieht",
    gewaehlt: einstellung.elternEinsichtVorgabe,
  });

  const fehler = el("div", { class: "pe-zusammenfassung" });
  const speichern = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt" },
    "Speichern",
  );
  const abbrechen = knopf("Abbrechen", {
    onclick: () => seite.versuchSchliessen(),
  });
  const formular = el(
    "form",
    { class: "pe-formular", novalidate: true },
    karte(
      "Konten für Kinder",
      "Ein Kind kann sich mit einem eigenen Konto anmelden. Du erstellst das Konto am Kind, erst nachdem die Eltern informiert sind.",
      el("div", { class: "pe-wahlfeld" }, erlaubt.wurzel),
    ),
    karte("Chat", null, chat.wurzel),
    karte(
      "Beim Erstellen",
      null,
      alter.wurzel,
      el("div", { class: "pe-wahlfeld" }, einsicht.wurzel),
    ),
    karte(
      "Was ein Konto sieht",
      "Das gilt immer und lässt sich nicht einstellen.",
      el(
        "ul",
        { class: "pe-liste" },
        ...WAS_DAS_KONTO_SIEHT.map((t) => el("li", {}, t)),
      ),
    ),
    el("div", { class: "pe-fuss" }, fehler, abbrechen, speichern),
  );
  const { kopf } = flussKopf({
    titelId,
    titel: "Konten für Kinder",
    beschreibung: "Einstellungen der Abteilung",
    beiZurueck: () => seite.versuchSchliessen(),
  });
  const seite = el(
    "section",
    { class: "fluss-seite pe-seite", "aria-labelledby": titelId },
    kopf,
    formular,
  );
  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.replaceChildren();
    abbrechen.disabled = speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      await anfrage("PUT", "/api/v1/admin/kinder/konto-einstellung", {
        erlaubt: erlaubt.eingabe.checked,
        chat: chat.eingabe.value,
        mindestalter: alter.eingabe.value ? Number(alter.eingabe.value) : null,
        elternEinsichtVorgabe: einsicht.eingabe.checked,
      });
      seite.close();
      neu();
      ctx.melde("Gespeichert.");
    } catch (f) {
      const hinweis = el(
        "p",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht gespeichert. ${fehlertext(f)}`,
      );
      fehler.replaceChildren(hinweis);
      hinweis.focus();
    } finally {
      abbrechen.disabled = speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });
  seite.addEventListener("close", () => {
    if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
    else document.querySelector("h1")?.focus();
  });
  oeffneFluss(seite);
  erlaubt.eingabe.focus();
}
