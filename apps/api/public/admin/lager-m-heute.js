import { anfrage } from "./api.js";
import { el } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import {
  aufgabenListe,
  datumLang,
  hoeckListe,
  karte,
  personName,
  werte,
} from "./lager-start-teile.js";

// Modul «Heute» (#672): der Tag im Lager auf einen Blick, dazu für Lagerleitung und Leitung der Start (Countdown, Fortschritt). GET /api/v1/lager/{id}/heute und /start; jeder Teil erscheint nur, wenn die Rolle ihn lesen darf (sonst liefert der Server null).

const BLOCK = {
  wichtig: "Wichtig",
  idee: "Idee",
  programmbild: "Programmbild",
};
const WARNUNG = {
  gewitter: "Gewitter",
  boeen: "Böen",
  hitze: "Hitze",
  regen: "Regen",
};
const WERT = [
  ["A", "Anwesend"],
  ["F", "Abwesend"],
  ["O", "Offen"],
];

const zahl = (n) => new Intl.NumberFormat("de-CH").format(n);
const grad = (t) =>
  t === null || t === undefined ? "–" : `${Math.round(t)} °C`;
const tage = (n) => `${n} ${n === 1 ? "Tag" : "Tagen"}`;

export function startKarte(start) {
  const { countdown, fortschritt } = start;
  const paare = [
    [
      "Stand",
      countdown.tageBisBeginn > 0
        ? `Das Lager beginnt in ${tage(countdown.tageBisBeginn)}.`
        : countdown.tageBisEnde >= 0
          ? `Das Lager läuft und endet in ${tage(countdown.tageBisEnde)}.`
          : "Das Lager ist vorbei.",
    ],
  ];
  const a = fortschritt.aufgaben;
  if (a)
    paare.push([
      "Aufgaben",
      `${zahl(a.erledigt)} von ${zahl(a.gesamt)} erledigt${a.ueberfaellig > 0 ? `, ${zahl(a.ueberfaellig)} überfällig` : ""}`,
    ]);
  const m = fortschritt.meilensteine;
  if (m)
    paare.push([
      "Meilensteine",
      `${zahl(m.vergangen)} von ${zahl(m.gesamt)} vergangen`,
    ]);
  return karte("Lager im Überblick", werte(paare));
}

function wetterKarte(w) {
  const t = w.tag;
  if (!t)
    return karte(
      "Wetter",
      el("p", { class: "leise" }, "Für heute gibt es keine Vorhersage."),
    );
  return karte(
    "Wetter",
    werte(
      [
        ["Lage", t.zustand ?? "–"],
        ["Temperatur", `${grad(t.tmin)} bis ${grad(t.tmax)}`],
        t.regen !== null && t.regen !== undefined
          ? ["Regen", `${zahl(t.regen)} mm`]
          : null,
      ].filter(Boolean),
    ),
    t.warnungen.length > 0
      ? el(
          "p",
          { class: "lg-chips" },
          t.warnungen.map((x) =>
            el(
              "span",
              { class: "chip chip--warn" },
              `Warnung: ${WARNUNG[x] ?? x}`,
            ),
          ),
        )
      : "",
  );
}

function seitenKarte(t) {
  const chef = personName(t.seite?.tageschef);
  return karte(
    "Tagesseite",
    el(
      "p",
      {},
      chef ? `Tageschef: ${chef}` : "Noch kein Tageschef eingetragen.",
    ),
    t.seite?.notiz ? el("p", {}, t.seite.notiz) : "",
    t.bloecke.length === 0
      ? el("p", { class: "leise" }, "Keine Blöcke für heute.")
      : el(
          "ul",
          { class: "lg-liste" },
          t.bloecke.map((b) =>
            el(
              "li",
              { class: "lg-zeile" },
              el("span", { class: "chip" }, BLOCK[b.art] ?? b.art),
              el("span", { class: "lg-zeile-text" }, b.text),
            ),
          ),
        ),
  );
}

function anwesenheitKarte(a) {
  if (a.zeilen.length === 0)
    return karte(
      "Anwesenheit",
      el("p", { class: "leise" }, "Heute ist noch nichts eingetragen."),
    );
  const summe = (wert, feld) =>
    a.zeilen.filter((z) => z.wert === wert).reduce((s, z) => s + z[feld], 0);
  return karte(
    "Anwesenheit",
    el(
      "p",
      { class: "klein leise" },
      "Summe über alle Abschnitte des Tages, ohne Namen.",
    ),
    werte(
      WERT.map(([w, text]) => [
        text,
        `${zahl(summe(w, "teilnehmende"))} Teilnehmende, ${zahl(summe(w, "leitende"))} Leitende`,
      ]),
    ),
  );
}

function schichtKarte(s) {
  const gruppen = s.dienste
    .map((d) => ({ d, leute: s.schichten.filter((x) => x.dienstId === d.id) }))
    .filter((g) => g.leute.length > 0 || g.d.mindestbesetzung > 0);
  return karte(
    "Schichten",
    gruppen.length === 0
      ? el("p", { class: "leise" }, "Heute sind keine Schichten eingeteilt.")
      : el(
          "ul",
          { class: "lg-liste" },
          gruppen.map(({ d, leute }) =>
            el(
              "li",
              { class: "lg-zeile" },
              el(
                "div",
                { class: "lg-zeile-text" },
                el("strong", {}, d.name),
                el(
                  "span",
                  { class: "klein leise lg-zeile-meta" },
                  leute.length > 0
                    ? leute.map((l) => l.ceviName ?? l.name).join(", ")
                    : "Niemand eingeteilt",
                ),
              ),
              el(
                "span",
                {
                  class:
                    leute.length < d.mindestbesetzung
                      ? "chip chip--warn"
                      : "chip chip--ok",
                },
                `${leute.length} von ${d.mindestbesetzung}`,
              ),
            ),
          ),
        ),
  );
}

export function zeige(bereich, ctx, id, lager) {
  const mitStart = lager.rolle === "lagerleitung" || lager.rolle === "leitung";
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `/api/v1/lager/${id}/heute`),
        // Der Start ist eine Zugabe: Fehlt sie, bleibt die Seite
        mitStart
          ? anfrage("GET", `/api/v1/lager/${id}/start`).catch(() => null)
          : null,
      ]),
    ([heute, start]) => {
      ctx.titel(
        "Heute",
        [datumLang(heute.datum), heute.lagertag?.label]
          .filter(Boolean)
          .join(" · "),
      );
      const karten = [];
      if (start) karten.push(startKarte(start));
      if (!heute.lagertag)
        bereich.append(
          el(
            "div",
            { class: "hinweis hinweis--info", role: "status" },
            "Heute ist kein Lagertag. Wetter und Höcks des Tages zeigt diese Seite trotzdem.",
          ),
        );
      if (heute.wetter) karten.push(wetterKarte(heute.wetter));
      if (heute.tagesseite) {
        karten.push(seitenKarte(heute.tagesseite));
        karten.push(
          karte(
            "Aufgaben von heute",
            aufgabenListe({
              aufgaben: heute.tagesseite.aufgaben,
              lager,
              ctx,
              heute: heute.datum,
              leer: "Heute ist keine Aufgabe fällig.",
            }),
          ),
        );
      }
      if (heute.anwesenheit) karten.push(anwesenheitKarte(heute.anwesenheit));
      if (heute.schichten) karten.push(schichtKarte(heute.schichten));
      if (heute.hoecks)
        karten.push(
          karte(
            "Höcks heute",
            hoeckListe({ hoecks: heute.hoecks, leer: "Heute ist kein Höck." }),
          ),
        );
      bereich.append(el("div", { class: "lg-kacheln" }, karten));
    },
    {
      skeleton: () =>
        el(
          "div",
          { class: "lg-kacheln" },
          [0, 1, 2, 3].map(() => skeletonFlaeche({ zeilen: 3 })),
        ),
    },
  );
}
