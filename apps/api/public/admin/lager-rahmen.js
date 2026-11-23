import { anfrage } from "./api.js";
import { el, icon, knopf } from "./dom.js";
import {
  nochmals,
  rahmenzustand,
  zustandsDaten,
  zustandsKarte,
} from "./zustaende.js";
import {
  ADRESSE,
  frischerRahmen,
  haenge,
  merkeRahmen,
  statusChip,
  symbol,
  zeitraum,
} from "./lager-gemeinsam.js";
import {
  DAUER_LANG_MS,
  KURVE,
  beobachteListen,
  darfBewegen,
} from "./lager-bewegung.js";
import { verfolge } from "./lager-ereignisse.js";
import { skeletonRahmen, skeletonVon } from "./lager-skeleton.js";
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

// Wo die Marke der Navigation zuletzt stand (Lager und Abstand von oben): Der Rahmen wird bei jedem Wechsel neu gebaut, die Marke gleitet von dort an ihren neuen Platz
let letzteMarke = null;
// Beim nächsten Zeichnen kein Eintritt: Aktualisieren und Neuladen sollen nicht aufblitzen
let ruhigNaechstes = false;

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
    el("span", {}, aktuell?.titel ?? "Bereiche des Lagers"),
    icon("runter"),
  );
  // Die Marke gleitet hinter dem aktiven Eintrag; ohne sie (schmal, ohne Bewegung) trägt der Eintrag selbst den Grund
  const marke = el("span", { class: "lg-nav-marke", "aria-hidden": "true" });
  const liste = el(
    "div",
    { class: "lg-nav-liste", id: listeId },
    marke,
    el(
      "div",
      { class: "lg-nav-innen" },
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
                    ...(e.schluessel === aktiv
                      ? { "aria-current": "page" }
                      : {}),
                  },
                  e.titel,
                ),
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

// Setzt die Marke hinter den aktiven Eintrag; gleitet vom letzten Platz dorthin, wenn es ein Wechsel im selben Lager ist. Erst aufrufen, wenn die Navigation im Dokument steht (offsetTop).
function setzeMarke(nav, lagerId) {
  const marke = nav.querySelector(".lg-nav-marke");
  const aktiv = nav.querySelector('a[aria-current="page"]');
  if (!marke || !aktiv) return;
  const oben = aktiv.offsetTop;
  const vorher = letzteMarke?.lagerId === lagerId ? letzteMarke.oben : null;
  // Die Navigation scrollt für sich (sie ist höher als mancher Bildschirm): gleicher Stand wie vorher, und der aktive Eintrag bleibt im Bild
  nav.addEventListener("scroll", () => {
    if (letzteMarke) letzteMarke.scroll = nav.scrollTop;
  });
  if (vorher !== null) nav.scrollTop = letzteMarke.scroll ?? 0;
  const lage = nav.querySelector(".lg-nav-liste").offsetTop + oben;
  if (lage < nav.scrollTop || lage + 44 > nav.scrollTop + nav.clientHeight)
    nav.scrollTop = Math.max(0, lage - nav.clientHeight / 2 + 22);
  nav.classList.add("lg-nav--marke");
  // Die Marke steht per Web Animation am Ziel («forwards»); sie gleitet vom letzten Platz dorthin, wenn Bewegung erlaubt ist
  const gleitet = vorher !== null && vorher !== oben && darfBewegen();
  marke.animate(
    [
      { transform: `translateY(${gleitet ? vorher : oben}px)` },
      { transform: `translateY(${oben}px)` },
    ],
    { duration: gleitet ? DAUER_LANG_MS : 0, easing: KURVE, fill: "forwards" },
  );
  letzteMarke = { lagerId, oben, scroll: nav.scrollTop };
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
          window.dispatchEvent(new Event("hashchange"));
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

// Der Stand des Lagers kommt aus dem Merkzettel, wenn er jung ist: Beim Wechsel zwischen Modulen stehen Leiste und Navigation sofort, nur das Modul lädt. Aktualisieren und Neuladen (neu) holen ihn frisch.
export function zeigeRahmen(bereich, ctx, id, schluessel, weiter = []) {
  const holen = async () => {
    const daten = await anfrage("GET", `/api/v1/lager/${id}`);
    merkeRahmen(id, daten);
    return daten;
  };
  const laden = () =>
    ctx.lade(
      holen,
      (lager, neu) => zeichne(bereich, ctx, lager, schluessel, weiter, neu),
      { skeleton: skeletonRahmen },
    );
  const stand = frischerRahmen(id);
  if (stand) zeichne(bereich, ctx, stand, schluessel, weiter, laden);
  else laden();
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
  // Eintritt: ganz neu im Lager blendet der Rahmen ein, ein Wechsel zwischen Modulen nur das Modul; nach «Aktualisieren» bleibt alles still
  const ruhig = ruhigNaechstes;
  ruhigNaechstes = false;
  const neuImLager = letzteMarke?.lagerId !== lager.id;
  const modulTitel = el(
    "h2",
    { class: "lg-modultitel", tabindex: "-1" },
    eintrag?.titel ?? "",
  );
  const modulUnter = el("p", { class: "leise lg-moduluntertitel" });
  const inhalt = el("div", { class: "lg-modul" });
  let laeuft = false;
  const aktualisiere = () => {
    if (laeuft) return;
    laeuft = true;
    // Der Rahmen baut sich nach der Antwort neu; bis dahin dreht sich der Knopf und der alte Stand bleibt
    ruhigNaechstes = true;
    neuLaden.setAttribute("aria-busy", "true");
    neu();
  };
  const neuLaden = knopf("Aktualisieren", {
    klein: true,
    symbol: "aktualisieren",
    onclick: aktualisiere,
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
  // Der Event-Stream des Lagers (SSE) meldet nur, dass es Neues gibt; die Person lädt selbst neu
  const neues = el(
    "div",
    { class: "hinweis hinweis--info lg-neues", role: "status", hidden: true },
    el("span", {}, "Es gibt Neues im Lager."),
    knopf("Aktualisieren", { klein: true, onclick: aktualisiere }),
  );
  verfolge(lager.id, () => {
    if (neues.isConnected) neues.hidden = false;
  });
  // Ein Modul ohne eigenes Skeleton nimmt die Art aus dem Register; jedes Modul zeigt beim ersten Laden sein Skeleton und blendet dann ein
  let eintrittTimer = 0;
  const eintritt = () => {
    if (ruhig) return;
    inhalt.classList.add("lg-modul--neu");
    window.clearTimeout(eintrittTimer);
    eintrittTimer = window.setTimeout(
      () => inhalt.classList.remove("lg-modul--neu"),
      1000,
    );
  };
  let ersterBau = true;
  const lade = ctx.erstelleLader(inhalt);
  const modulLade = (laden, zeichnen, optionen = {}) => {
    const opt = { ...optionen };
    if (opt.skeleton === undefined && eintrag?.skeleton)
      opt.skeleton = skeletonVon(eintrag.skeleton);
    return lade(
      laden,
      (daten, erneut) => {
        if (ersterBau) {
          ersterBau = false;
          eintritt();
        }
        zeichnen(daten, erneut);
      },
      opt,
    );
  };
  // Das Modul sieht denselben ctx, aber seine Ladeanzeige, sein Titel und seine Meldungen bleiben im Inhalt
  const modulCtx = {
    ...ctx,
    imRahmen: true,
    // Lädt den ganzen Arbeitsbereich neu (Kopf, Navigation, Modul), z. B. nach einem Statuswechsel
    neuRahmen: () => {
      ruhigNaechstes = true;
      neu();
    },
    lade: modulLade,
    titel: (text, untertitel) => {
      modulTitel.textContent = text;
      if (untertitel !== undefined) modulUnter.textContent = untertitel;
    },
    weiter,
  };
  const nav = navigation(lager, gruppiere(sichtbare), schluessel);
  const arbeit = el(
    "div",
    { class: "lg-arbeit" },
    nav,
    el(
      "div",
      { class: "lg-haupt" },
      el("header", { class: "lg-modulkopf" }, modulTitel, modulUnter),
      inhalt,
    ),
  );
  if (neuImLager && !ruhig) {
    leiste.classList.add("lg-rahmen-ein");
    arbeit.classList.add("lg-rahmen-ein");
  }
  haenge(
    bereich,
    leiste,
    neues,
    lager.schreibgeschuetzt &&
      el(
        "div",
        { class: "hinweis hinweis--info", role: "status" },
        "Das Lager ist abgeschlossen oder archiviert und nur zum Lesen. Ändern geht erst, wenn du es unter «Angaben» wieder öffnest.",
      ),
    arbeit,
  );
  setzeMarke(nav, lager.id);
  eintritt();
  // Wer in der Navigation ein anderes Modul wählt, landet auf dessen Titel (der Rahmen baut sich neu, der Fokus wäre sonst weg)
  if (!neuImLager && !ruhig) modulTitel.focus({ preventScroll: true });
  beobachteListen(inhalt);
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
  const ladeModul = async () => {
    try {
      const m = await eintrag.laden();
      inhalt.replaceChildren();
      m.zeige(inhalt, modulCtx, lager.id, lager);
    } catch (f) {
      // Das Modul liess sich nicht laden (Netz, Server): Karte mit «Nochmals versuchen» statt einer leeren Seite
      const karte = zustandsKarte(zustandsDaten(f), [nochmals(ladeModul, "")]);
      inhalt.replaceChildren(karte.wurzel);
    }
  };
  await ladeModul();
}
