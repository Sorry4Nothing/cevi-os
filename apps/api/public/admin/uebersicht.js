// Übersicht (#583, neu gebaut in #620 als Dashboard der Abteilung): oben die Begrüssung mit Datum und einem Satz zum Stand, dann «Jetzt zu tun» als Liste neben dem Hauptdiagramm, das Kennzahlenband, Kommendes und Aktivität, die Teilnahme (Kinder je Stufe, Anmeldungen je Anlass) und am Ende ein schmaler Streifen für den Zustand. Ein einziger Abruf, GET /api/v1/admin/uebersicht; der Server gibt jeder Person nur die Teile, die sie sehen darf (docs/rechte.md). Die Oberfläche blendet nur aus, was fehlt, und verlässt sich auf nichts.
//
// Datenbanklast: ein Abruf beim Öffnen und auf «Aktualisieren», kein Polling. Der Server hält die Antwort 45 Sekunden je Person im Speicher.
// Aufbau: Karten im Zwölfspaltenraster in der Breite der Website (4/8, Band, 7/5, 5/7, Streifen), auf schmalem Schirm eine Spalte. Fehlt das Hauptdiagramm (Stufenleitung, Webmaster), stehen die vorhandenen Karten in einer Reihe. Bausteine: uebersicht-kacheln.js (Aufgaben, Kennzahlen, Zustand), uebersicht-verlauf.js (Hauptdiagramm), uebersicht-kommend.js (Kommendes, Aktivität, Teilnahme), uebersicht-diagramme.js (Zeichenhilfen), Stile in uebersicht.css.
// Fehlt ein Teil (kein Recht), fehlt seine Karte. Scheitert ein Teil auf dem Server, zeigt nur diese Karte «Nochmals versuchen».
import { anfrage } from "./api.js";
import { el, knopf } from "./dom.js";
import { sk } from "./lader.js";
import {
  aufgabenKarte,
  kennzahlenBand,
  offeneAufgaben,
  zustandStreifen,
} from "./uebersicht-kacheln.js";
import {
  aktivitaetKarte,
  anlaesseKarte,
  kommendKarte,
  stufenKarte,
} from "./uebersicht-kommend.js";
import { verlaufKarte } from "./uebersicht-verlauf.js";
import { leerKarte } from "./zustaende.js";

const ZONE = "Europe/Zurich";
const de = (optionen) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: ZONE, ...optionen });
const uhr = de({ hour: "2-digit", minute: "2-digit" });
const stunde = de({ hour: "numeric", hourCycle: "h23" });
const datumLang = de({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const kurz = de({ weekday: "short", day: "numeric", month: "short" });

// Skelett in der Form des echten Inhalts: zwei Karten, das Band, zwei Karten
function skelett() {
  const karte = (zeilen, klasse) =>
    el(
      "div",
      { class: `ud-karte ${klasse}`, "aria-hidden": "true" },
      sk("t", 120),
      ...Array.from({ length: zeilen }, () => sk("t", 260)),
    );
  return el(
    "div",
    { class: "ud-seite" },
    el("div", { class: "ud-zeile" }, karte(5, "ud-s4"), karte(8, "ud-s8")),
    el("div", { class: "ud-zeile" }, karte(2, "ud-s12")),
    el("div", { class: "ud-zeile" }, karte(6, "ud-s7"), karte(6, "ud-s5")),
  );
}

// Zähler der Unterleiste aus denselben Zahlen, ohne eigene Abfrage
function melde(ctx, a) {
  if (!a) return;
  const z = (bereich, unter, n) =>
    n !== undefined && ctx.zaehler(unter, n, bereich);
  z("termine", "vorschlaege", a.terminVorschlaege);
  z("termine", "warnliste", a.termineOhneKategorie);
  z("raeume", "anfragen", a.raumanfragen);
}

// «Guten Morgen, Anna»: Tageszeit in Schweizer Zeit, Vorname aus dem eigenen Konto
function gruss(ctx) {
  const std = Number(stunde.format(new Date()));
  const teil =
    std < 11 ? "Guten Morgen" : std < 17 ? "Guten Tag" : "Guten Abend";
  const vorname = String(ctx.ich.name ?? "")
    .trim()
    .split(/\s+/)[0];
  return vorname ? `${teil}, ${vorname}` : teil;
}

// Ein Satz zum Stand: was offen ist und was als Nächstes ansteht (nur Titel und Zeit, nie Personen)
function stand(daten) {
  const teile = [`${datumLang.format(new Date())}.`];
  if (daten.aufgaben) {
    const n = offeneAufgaben(daten);
    teile.push(
      n === 0
        ? "Nichts ist offen."
        : n === 1
          ? "Ein Punkt ist offen."
          : `${n} Punkte sind offen.`,
    );
  }
  const k = daten.kommend;
  const naechster = k
    ? [
        ...k.termine.map((t) => ({
          titel: t.titel,
          von: t.beginn
            ? new Date(t.beginn)
            : new Date(`${t.tagVon}T12:00:00Z`),
        })),
        ...k.lager.map((l) => ({
          titel: l.titel,
          von: new Date(`${l.von}T12:00:00Z`),
        })),
      ].sort((a, b) => a.von - b.von)[0]
    : null;
  if (naechster) {
    teile.push(
      `Als Nächstes: ${naechster.titel}, ${kurz.format(naechster.von).replace(/.$/, "")}.`,
    );
  }
  return teile.join(" ");
}

// Eine Reihe im Zwölfspaltenraster; [Knoten, Spalten]. Ohne zweite Karte füllt die erste die Reihe.
function reihe(...teile) {
  const da = teile.filter(([k]) => k);
  if (da.length === 0) return null;
  const wurzel = el("div", { class: "ud-zeile" });
  for (const [knoten, spalten] of da) {
    knoten.classList.add(`ud-s${da.length === 1 ? 12 : spalten}`);
    wurzel.append(knoten);
  }
  return wurzel;
}

function zeichne(bereich, ctx, daten, neuLaden) {
  melde(ctx, daten.aufgaben);
  const aufgaben = aufgabenKarte(daten, ctx, neuLaden);
  const kommend = kommendKarte(daten, ctx, neuLaden);
  const aktivitaet = aktivitaetKarte(daten);
  const stufen = stufenKarte(daten, ctx, neuLaden);
  const anlaesse = anlaesseKarte(daten, ctx, neuLaden);
  const band = kennzahlenBand(daten, ctx, neuLaden);
  const verlauf = daten.kennzahlen ? verlaufKarte(daten) : null;
  const streifen = zustandStreifen(daten, ctx, neuLaden);

  // Mit Hauptdiagramm (Abteilungsleitung): feste Reihen. Ohne: alles, was da ist, in einer Reihe nebeneinander.
  const reihen = verlauf
    ? [
        reihe([aufgaben, 4], [verlauf, 8]),
        reihe([band, 12]),
        reihe([kommend, 7], [aktivitaet, 5]),
        reihe([stufen, 5], [anlaesse, 7]),
        reihe([streifen, 12]),
      ]
    : [
        reihe(
          [aufgaben, 4],
          [kommend, 4],
          [aktivitaet, 4],
          [stufen, 4],
          [anlaesse, 4],
        ),
        reihe([band, 12]),
        reihe([streifen, 12]),
      ];
  reihen[0]?.classList.toggle("ud-zeile--auto", !verlauf);
  const wurzel = el("div", { class: "ud-seite" }, reihen.filter(Boolean));
  if (wurzel.childElementCount === 0) {
    bereich.append(
      leerKarte("Für deine Rolle gibt es hier gerade nichts zu zeigen."),
    );
    return;
  }
  // Gestaffelter Auftritt: jede Karte ein Stück später
  wurzel.querySelectorAll(".ud-karte").forEach((k, i) => {
    k.style.setProperty("--k", String(i));
  });
  wurzel.append(
    el(
      "p",
      { class: "ud-stand klein leise", role: "status" },
      `Stand ${uhr.format(new Date(daten.erzeugtAm))} Uhr. Die Zahlen sind höchstens eine Minute alt.`,
    ),
  );
  bereich.append(wurzel);
}

export function zeige(bereich, ctx) {
  let frisch = false;
  let neu = null;
  const laden = () =>
    anfrage("GET", `/api/v1/admin/uebersicht${frisch ? "?frisch=1" : ""}`);
  ctx.kopfAktion(
    knopf("Aktualisieren", {
      art: "still",
      symbol: "aktualisieren",
      onclick: () => {
        frisch = true;
        neu?.();
      },
    }),
  );
  ctx.lade(
    laden,
    (daten, neuLaden) => {
      neu = neuLaden;
      // Begrüssung und Satz im Seitenkopf; der Fenstertitel bleibt «Übersicht»
      ctx.titel(gruss(ctx), stand(daten));
      document.title = "Übersicht – Verwaltung – Cevi OS";
      zeichne(bereich, ctx, daten, () => {
        frisch = true;
        neuLaden();
      });
    },
    {
      skeleton: skelett,
      fehlerTitel: "Die Übersicht konnte nicht geladen werden.",
      fehlerText: "Prüfe die Verbindung und versuche es nochmals.",
    },
  );
}
