import { anfrage, fehlertext } from "./api.js";
import { datumZeitFeld } from "./datumsfeld.js";
import { ankreuzen, auswahl, chip, el, gruppe } from "./dom.js";
import { heuteZuerich, stempel } from "./kalenderhilfen.js";
import { ladeSeite } from "./anlass-anmeldungen.js";
import { hatRollen, rollenWahl, rollenWert } from "./sicht-rollen.js";

// Gemeinsame Teile der Anlässe (Liste, Anlass mit seinen Reitern, Zusatzfelder, Anmeldungen): Adressen, Texte, Stand der Anmeldung als Wort mit Symbol, die Felder der Einstellungen. Die Reiter eines Anlasses heissen «anmeldungen», «felder» und «einstellungen»; die Übersicht hat keinen Reiter in der Adresse.

export const BASIS = "/api/v1/admin/anlaesse";

// Adresse eines Anlasses; die Liste und die Reiter. Der Bereich hat nur eine Unterseite: Liste #anlaesse, Anlass #anlaesse/<id>, Reiter #anlaesse/<id>/felder. Das Modul liest auch die alte Form #anlaesse/anlaesse/… (die ALIASE in navigation.js schreiben sie um)
export const adresse = (id, reiter) =>
  `#anlaesse${id ? `/${id}` : ""}${reiter ? `/${reiter}` : ""}`;

// Anlass im Speicher: Der Wechsel zwischen den Reitern fragt nicht jedes Mal neu (30 Sekunden); wer etwas ändert, ruft vergiss(id)
const FRIST_MS = 30_000;
const speicher = new Map();
export const vergiss = (id) => speicher.delete(id);

// Ohne das Recht «Anmeldungen sehen» (die Antwort des Anlasses nennt es unter `rechte`) gibt es keine Anmeldungen zu laden: Der Rahmen zeigt dann keine Namen und keine Zahlen
const KEINE_ANMELDUNGEN = {
  gesperrt: true,
  summe: { angemeldet: 0, abgemeldet: 0 },
  eintraege: [],
  weitere: false,
  naechste: null,
};

// Anlass und, wenn die Person die Anmeldungen sehen darf, die ersten 5 Anmeldungen (mit den Summen): zwei Abfragen nacheinander, weil erst der Anlass sagt, was die Person darf
export async function ladeKopf(id, { neu = false } = {}) {
  const alt = speicher.get(id);
  if (!neu && alt && Date.now() - alt.zeit < FRIST_MS) return alt.daten;
  const pfad = `${BASIS}/${encodeURIComponent(id)}`;
  const anlass = await anfrage("GET", pfad);
  const anmeldungen = anlass.rechte?.anmeldungenSehen
    ? await ladeSeite(pfad, "alle", "", 5)
    : KEINE_ANMELDUNGEN;
  const daten = { anlass, anmeldungen };
  speicher.set(id, { zeit: Date.now(), daten });
  return daten;
}

// Alte Adresse «Anmeldungen» (#anlaesse/anmeldungen, …/anmeldungen/<id>): Anmeldungen gibt es nur über den Anlass. Mit Anlass führt sie auf dessen Reiter «Anmeldungen», ohne auf die Liste der Anlässe; der Eintrag im Verlauf wird ersetzt, Zurück führt nicht im Kreis. pfad: der Rest der Adresse nach «anmeldungen» oder samt «anmeldungen» als erstes Element
export function leiteAltAdresseUm(pfad) {
  const rest = pfad[0] === "anmeldungen" ? pfad.slice(1) : pfad;
  const ziel = rest[0] ? adresse(rest[0], "anmeldungen") : adresse();
  window.location.replace(
    `${window.location.pathname}${window.location.search}${ziel}`,
  );
}

export const SICHT = {
  oeffentlich: "Öffentlich",
  angemeldet: "Nur angemeldet",
  tags: "Bestimmte Gruppen",
};
export const sichtText = (s) =>
  s.art === "tags"
    ? `Bestimmte Gruppen (${s.tagIds.length}${s.rollen ? ", nur bestimmte Rollen" : ""})`
    : SICHT[s.art];
export const fristText = (a) =>
  a.frist ? `${stempel(a.frist)} Uhr` : "Keine Frist";

const TEXTE = {
  TAG_UNBEKANNT:
    "Eine gewählte Gruppe gibt es nicht mehr. Lade die Seite neu und wähle die Gruppen nochmals.",
  FELD_GESUNDHEIT:
    "Ein Feld fragt nach Gesundheitsdaten. Das nimmt die Anmeldung nicht auf. Gesperrt sind zum Beispiel Wörter rund um Allergien, Medikamente, Krankheiten und Behinderungen, auch in den Antworten zur Auswahl. Formuliere die Frage anders oder lass sie weg.",
};
export const meldungVon = (f) => TEXTE[f.code] ?? fehlertext(f);

export function vorbei(a) {
  return a.ganztaegig
    ? a.tagBis < heuteZuerich()
    : new Date(a.ende) < new Date();
}

// Der Stand der Anmeldung als Wort mit Symbol, nie nur Farbe
export function statusChip(a) {
  if (vorbei(a)) return chip("Termin vorbei", undefined, false);
  if (!a.anmeldungOffen) return chip("Anmeldung geschlossen", "warn");
  if (a.frist && new Date(a.frist) < new Date())
    return chip("Frist vorbei", "warn");
  return chip("Anmeldung offen", "ok");
}

// Wie lange die Anmeldung noch läuft, in einem Satz: «Noch 14 Tage bis zum Anmeldeschluss», «Der Anmeldeschluss ist heute um 23:59 Uhr». Reine Funktion (jetzt zum Testen)
export function fristSatz(a, jetzt = new Date()) {
  if (vorbei(a)) return "Der Termin ist vorbei.";
  if (!a.anmeldungOffen) return "Die Anmeldung ist geschlossen.";
  if (!a.frist) return "Die Anmeldung ist bis zum Ende des Termins offen.";
  const rest = new Date(a.frist) - jetzt;
  if (rest <= 0) return `Der Anmeldeschluss war am ${stempel(a.frist)} Uhr.`;
  const stunden = Math.ceil(rest / 3_600_000);
  if (stunden < 24) {
    return stunden === 1
      ? "Noch 1 Stunde bis zum Anmeldeschluss."
      : `Noch ${stunden} Stunden bis zum Anmeldeschluss.`;
  }
  const tage = Math.ceil(rest / 86_400_000);
  return tage === 1
    ? "Noch 1 Tag bis zum Anmeldeschluss."
    : `Noch ${tage} Tage bis zum Anmeldeschluss.`;
}

// Prozente, die sich immer zu 100 ergeben (grösster Rest zuerst), damit die Balken nie «99 %» und «0 %» zeigen. Reine Funktion
export function prozente(zahlen) {
  const summe = zahlen.reduce((s, z) => s + z, 0);
  if (summe === 0) return zahlen.map(() => 0);
  const genau = zahlen.map((z) => (z / summe) * 100);
  const boden = genau.map(Math.floor);
  let rest = 100 - boden.reduce((s, z) => s + z, 0);
  const reihe = genau
    .map((g, i) => ({ i, r: g - Math.floor(g) }))
    .sort((a, b) => b.r - a.r);
  for (const { i } of reihe) {
    if (rest <= 0) break;
    boden[i] += 1;
    rest -= 1;
  }
  return boden;
}

// Browserzeit statt Schweizer Zeit. shortcut: Wer von ausserhalb der Schweiz arbeitet, sieht und gibt Zeiten in der eigenen Zone ein; bei Bedarf mit der Zone Europe/Zurich umrechnen.
export function lokal(iso) {
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

// Die Einstellungen eines Anlasses; Anlegen und Ändern teilen sie. start: { anmeldungOffen, frist, sichtbarkeit }. Wer sich für wen anmeldet, folgt aus der Sichtbarkeit (#844)
export function einstellungsFelder(tags, start) {
  const offen = ankreuzen({
    label: "Die Anmeldung ist offen",
    gewaehlt: start.anmeldungOffen,
    wert: "1",
  });
  const frist = datumZeitFeld({
    label: "Anmeldeschluss (optional)",
    hilfe:
      "Ohne Anmeldeschluss ist die Anmeldung bis zum Ende des Termins möglich.",
    wert: start.frist ? lokal(start.frist) : "",
  });
  const sicht = auswahl({
    label: "Wer sieht den Anlass?",
    optionen: [
      ["angemeldet", SICHT.angemeldet],
      ["oeffentlich", SICHT.oeffentlich],
      ...(tags.length > 0 ? [["tags", SICHT.tags]] : []),
    ],
    wert: start.sichtbarkeit.art,
  });
  const gewaehlt = new Set(
    start.sichtbarkeit.art === "tags" ? start.sichtbarkeit.tagIds : [],
  );
  // Je Stufe die Rollen, die den Anlass sehen und sich anmelden (#844); nur sichtbar, solange die Stufe gewählt ist
  const startRollen = (id) =>
    start.sichtbarkeit.art === "tags"
      ? start.sichtbarkeit.rollen?.[id]
      : undefined;
  const TEILNEHMENDE =
    "Teilnehmende sind die Kinder der Stufe und ihre Eltern.";
  const tagWahl = tags.map((t) => {
    const w = ankreuzen({
      label: t.name,
      gewaehlt: gewaehlt.has(t.id),
      wert: t.id,
    });
    if (hatRollen(t)) {
      w.rollen = rollenWahl(t.name, startRollen(t.id), TEILNEHMENDE);
      const zeige = () => (w.rollen.wurzel.hidden = !w.eingabe.checked);
      w.eingabe.addEventListener("change", zeige);
      zeige();
    }
    return w;
  });
  const tagGruppe = gruppe(
    "Gruppen",
    el(
      "div",
      {},
      tagWahl.map((w) => [w.wurzel, w.rollen?.wurzel]),
    ),
    { scrollen: true },
  );
  const tagFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const zeigeTags = () => {
    tagGruppe.hidden = sicht.eingabe.value !== "tags";
    tagFehler.hidden = true;
  };
  sicht.eingabe.addEventListener("change", zeigeTags);
  zeigeTags();
  const lies = () => {
    const art = sicht.eingabe.value;
    return {
      anmeldungOffen: offen.eingabe.checked,
      frist: frist.eingabe.value
        ? new Date(frist.eingabe.value).toISOString()
        : null,
      sichtbarkeit:
        art === "tags"
          ? (() => {
              const an = tagWahl.filter((w) => w.eingabe.checked);
              const rollen = rollenWert(
                an
                  .filter((w) => w.rollen)
                  .map((w) => [w.eingabe.value, w.rollen]),
              );
              return {
                art,
                tagIds: an.map((w) => w.eingabe.value),
                ...(rollen && { rollen }),
              };
            })()
          : { art },
    };
  };
  return {
    knoten: {
      offen: offen.wurzel,
      frist: frist.wurzel,
      sicht: sicht.wurzel,
      tags: [tagGruppe, tagFehler],
    },
    // true, wenn etwas fehlt (Meldung und Fokus setzt die Funktion selbst)
    pruefe() {
      if (
        sicht.eingabe.value === "tags" &&
        !tagWahl.some((w) => w.eingabe.checked)
      ) {
        tagFehler.textContent = "Wähle mindestens eine Gruppe.";
        tagFehler.hidden = false;
        tagWahl[0].eingabe.focus();
        return true;
      }
      return false;
    },
    lies,
    // Setzt die Felder auf einen Stand zurück («Verwerfen»)
    setze(stand) {
      offen.eingabe.checked = stand.anmeldungOffen;
      frist.eingabe.value = stand.frist ? lokal(stand.frist) : "";
      sicht.eingabe.value = stand.sichtbarkeit.art;
      sicht.eingabe.dispatchEvent(new Event("change"));
      const ids = new Set(
        stand.sichtbarkeit.art === "tags" ? stand.sichtbarkeit.tagIds : [],
      );
      for (const w of tagWahl) {
        w.eingabe.checked = ids.has(w.eingabe.value);
        w.eingabe.dispatchEvent(new Event("change"));
        w.rollen?.setze(
          stand.sichtbarkeit.art === "tags"
            ? stand.sichtbarkeit.rollen?.[w.eingabe.value]
            : undefined,
        );
      }
    },
  };
}

// Wie viele der drei Einstellungen sich vom Stand unterscheiden (für «2 Änderungen»). Reine Funktion
export function anzahlAenderungen(alt, neu) {
  return ["anmeldungOffen", "frist", "sichtbarkeit"].filter(
    (k) => JSON.stringify(alt[k] ?? null) !== JSON.stringify(neu[k] ?? null),
  ).length;
}
