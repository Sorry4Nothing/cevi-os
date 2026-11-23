import { anfrage } from "./api.js";
import { el, icon, knopf } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { rahmenzustand } from "./zustaende.js";
import {
  ADRESSE,
  haenge,
  meldung,
  statusChip,
  symbol,
  zeitraum,
} from "./lager-gemeinsam.js";
import { GRUPPEN, MODULE, suchbegriff } from "./lager-module.js";

// Arbeitsbereich eines Lagers (#672): Kopf mit Name, Status und Zeitraum, links die Navigation der Module, rechts das gewählte Modul. Adresse: #lager/lager/<id>/<modul>[/…]. Die Navigation zeigt nur Module, für die die Rolle im Lager das Leserecht hat (GET /api/v1/lager/{id} nennt die Rechte der eigenen Rolle); der Server prüft jede Anfrage weiter selbst.

// Seiten, die es schon vor dem Rahmen gab; sie hängen jetzt darin. «verwalten»: Recht der Verwaltung (Abteilungsleitung oder Lagerleitung), das die Seite braucht
const FESTE = [
  {
    schluessel: "angaben",
    titel: "Angaben",
    gruppe: "Lager",
    verwalten: "lager.verwalten",
    laden: () => import("./lager-detail.js"),
  },
  {
    schluessel: "mitglieder",
    titel: "Mitglieder",
    gruppe: "Lager",
    verwalten: "rechte.verwalten",
    laden: () => import("./lager-mitglieder.js"),
  },
  {
    schluessel: "rechte",
    titel: "Rechte der Rollen",
    gruppe: "Lager",
    verwalten: "rechte.verwalten",
    laden: () => import("./lager-rechte.js"),
  },
  {
    schluessel: "ausdrucke",
    titel: "Ausdrucke",
    gruppe: "Lager",
    laden: () => import("./lager-ausdrucke.js"),
  },
];

const alle = () => [...MODULE, ...FESTE];

// Darf die Rolle das Modul sehen? «recht» mit «|»: eines genügt
export function sichtbar(eintrag, { rechte, ctx }) {
  // «verwalten»: Recht der Abteilung (die Verwaltungsrouten prüfen es); wer es nicht hat, sieht die Seite nicht
  if (eintrag.verwalten && !ctx.zugang?.darf?.(eintrag.verwalten)) return false;
  if (!eintrag.recht) return true;
  return eintrag.recht.split("|").some((r) => rechte.has(r));
}

// Module in der Reihenfolge der Gruppen; unbekannte Gruppen kommen dahinter
export function gruppiere(eintraege) {
  const namen = [
    ...GRUPPEN,
    ...new Set(
      eintraege.map((e) => e.gruppe).filter((g) => !GRUPPEN.includes(g)),
    ),
  ];
  return namen
    .map((name) => ({
      name,
      eintraege: eintraege.filter((e) => e.gruppe === name),
    }))
    .filter((g) => g.eintraege.length > 0);
}

const adresse = (id, schluessel) => `${ADRESSE}/${id}/${schluessel}`;

function navigation(lager, gruppen, aktiv) {
  const listeId = "lg-nav-liste";
  const aktuell = alle().find((e) => e.schluessel === aktiv);
  const knopf = el(
    "button",
    {
      type: "button",
      class: "lg-nav-knopf",
      "aria-expanded": "false",
      "aria-controls": listeId,
      onclick: () => {
        const offen = knopf.getAttribute("aria-expanded") === "true";
        knopf.setAttribute("aria-expanded", String(!offen));
        liste.toggleAttribute("data-offen", !offen);
      },
    },
    icon("menue"),
    el("span", {}, aktuell?.titel ?? "Bereiche des Lagers"),
  );
  const liste = el(
    "div",
    { class: "lg-nav-liste", id: listeId },
    gruppen.map((g) =>
      el(
        "section",
        { class: "lg-nav-gruppe" },
        el("h2", { class: "lg-nav-kopf" }, g.name),
        el(
          "ul",
          {},
          g.eintraege.map((e) =>
            el(
              "li",
              {},
              el(
                "a",
                {
                  href: adresse(lager.id, e.schluessel),
                  ...(e.schluessel === aktiv ? { "aria-current": "page" } : {}),
                },
                e.titel,
              ),
            ),
          ),
        ),
      ),
    ),
  );
  return el(
    "nav",
    { class: "lg-nav", "aria-label": `Bereiche von «${lager.titel}»` },
    knopf,
    liste,
  );
}

// Suchfeld im Kopf: Enter öffnet die Suche; der Begriff bleibt aus der Adresse
function suchfeld(lager) {
  const eingabe = el("input", {
    class: "eingabe",
    id: "lg-kopfsuche",
    type: "search",
    placeholder: "Im Lager suchen",
    autocomplete: "off",
    maxlength: 100,
  });
  return el(
    "form",
    {
      class: "lg-kopfsuche suche",
      role: "search",
      onsubmit: (e) => {
        e.preventDefault();
        suchbegriff.frage = eingabe.value.trim();
        const ziel = adresse(lager.id, "suche");
        if (location.hash === ziel)
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        else location.hash = ziel;
      },
    },
    el("label", { class: "nur-leser", for: "lg-kopfsuche" }, "Im Lager suchen"),
    icon("lupe"),
    eingabe,
  );
}

const keinZugriff = (zurueck) =>
  rahmenzustand(
    {
      ueber: "Fehler 403",
      titel: "Dieser Bereich ist für dich nicht freigegeben.",
      text: "Deine Rolle im Lager darf ihn nicht lesen. Wende dich an die Lagerleitung.",
    },
    zurueck,
  );

// Standardmodul: das erste sichtbare der Gruppe «Start», sonst das erste sichtbare überhaupt
export function startModul(sichtbare) {
  return sichtbare.find((e) => e.gruppe === "Start") ?? sichtbare[0] ?? null;
}

export function zeigeRahmen(bereich, ctx, id, schluessel, weiter = []) {
  ctx.lade(
    () => anfrage("GET", `/api/v1/lager/${id}`),
    (lager, neu) => zeichne(bereich, ctx, lager, schluessel, weiter, neu),
    {
      skeleton: () =>
        el(
          "div",
          { class: "lg-arbeit" },
          skeletonFlaeche({ zeilen: 6 }),
          skeletonFlaeche({ zeilen: 4 }),
        ),
    },
  );
}

async function zeichne(bereich, ctx, lager, schluessel, weiter, neu) {
  const rechte = new Set(lager.rechte);
  const sichtbare = alle().filter((e) => sichtbar(e, { rechte, ctx }));
  const start = startModul(sichtbare);
  if (!schluessel) {
    // «#lager/lager/<id>» führt in den Arbeitsbereich
    if (start) location.replace(adresse(lager.id, start.schluessel));
    return;
  }
  const eintrag = alle().find((e) => e.schluessel === schluessel);
  ctx.titel(
    lager.titel,
    [zeitraum(lager.von, lager.bis), lager.ort].filter(Boolean).join(" · "),
  );
  const modulTitel = el(
    "h2",
    { class: "lg-modultitel", tabindex: "-1" },
    eintrag?.titel ?? "",
  );
  const modulUnter = el("p", { class: "leise lg-moduluntertitel" });
  const inhalt = el("div", { class: "lg-modul" });
  const neuLaden = knopf("Aktualisieren", {
    klein: true,
    symbol: "aktualisieren",
    onclick: () => neu(),
  });
  const leiste = el(
    "div",
    { class: "lg-leiste" },
    el(
      "a",
      { class: "lg-zurueck", href: ADRESSE },
      symbol("zurueck"),
      "Alle Lager",
    ),
    statusChip(lager.status),
    lager.schreibgeschuetzt &&
      el("span", { class: "leise" }, "Schreibgeschützt"),
    el("span", { class: "lg-leiste-luecke" }),
    suchfeld(lager),
    neuLaden,
  );
  // Das Modul sieht denselben ctx, aber seine Ladeanzeige, sein Titel und seine Meldungen bleiben im Inhalt
  const modulCtx = {
    ...ctx,
    imRahmen: true,
    // Lädt den ganzen Arbeitsbereich neu (Kopf, Navigation, Modul), z. B. nach einem Statuswechsel
    neuRahmen: neu,
    lade: ctx.erstelleLader(inhalt),
    titel: (text, untertitel) => {
      modulTitel.textContent = text;
      if (untertitel !== undefined) modulUnter.textContent = untertitel;
    },
    weiter,
  };
  haenge(
    bereich,
    leiste,
    lager.schreibgeschuetzt &&
      el(
        "div",
        { class: "hinweis hinweis--info", role: "status" },
        "Das Lager ist abgeschlossen oder archiviert und nur zum Lesen. Ändern geht erst, wenn du es unter «Angaben» wieder öffnest.",
      ),
    el(
      "div",
      { class: "lg-arbeit" },
      navigation(lager, gruppiere(sichtbare), schluessel),
      el(
        "div",
        { class: "lg-haupt" },
        el("header", { class: "lg-modulkopf" }, modulTitel, modulUnter),
        inhalt,
      ),
    ),
  );
  if (!eintrag) {
    inhalt.append(
      rahmenzustand(
        {
          ueber: "Fehler 404",
          titel: "Diesen Bereich gibt es nicht.",
          text: "Wähle links einen Bereich des Lagers.",
        },
        [],
      ).wurzel,
    );
    return;
  }
  if (!sichtbare.includes(eintrag)) {
    inhalt.append(keinZugriff([]).wurzel);
    return;
  }
  document.title = `${eintrag.titel} – ${lager.titel} – Verwaltung – Cevi OS`;
  try {
    const m = await eintrag.laden();
    m.zeige(inhalt, modulCtx, lager.id, lager);
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
  }
}
