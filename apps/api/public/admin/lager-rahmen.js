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
import { statusZeile } from "./lager-status.js";
import { behalteStelle, haltStelle, nimmBehaltene } from "./verlauf.js";
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
// Welche Gruppen der Navigation offen sind (je Lager, nur solange die Seite offen ist); die Gruppe des aktiven Moduls ist immer offen
let offeneGruppen = { lagerId: null, namen: new Set() };

function navigation(lager, gruppen, aktiv) {
  const listeId = "lg-nav-liste";
  const aktuell = alle().find((e) => e.schluessel === aktiv);
  if (offeneGruppen.lagerId !== lager.id)
    offeneGruppen = { lagerId: lager.id, namen: new Set() };
  const gruppeAktiv = gruppen.find((g) =>
    g.eintraege.some((e) => e.schluessel === aktiv),
  );
  if (gruppeAktiv) offeneGruppen.namen.add(gruppeAktiv.name);
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
  // Jede Gruppe klappt auf und zu (Überschrift ist ein Knopf): so bleibt die Navigation kurz und scrollt selten
  const gruppe = (g, i) => {
    const id = `lg-nav-gruppe-${i}`;
    const offen = offeneGruppen.namen.has(g.name);
    const auf = el(
      "div",
      { class: "lg-nav-auf", id, ...(offen ? { "data-offen": "" } : {}) },
      el(
        "div",
        { class: "lg-nav-auf-innen" },
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
    );
    const kopf = el(
      "button",
      {
        type: "button",
        class: "lg-nav-kopf",
        "aria-expanded": String(offen),
        "aria-controls": id,
        onclick: () => {
          const jetzt = kopf.getAttribute("aria-expanded") !== "true";
          kopf.setAttribute("aria-expanded", String(jetzt));
          auf.toggleAttribute("data-offen", jetzt);
          if (jetzt) offeneGruppen.namen.add(g.name);
          else offeneGruppen.namen.delete(g.name);
        },
      },
      el("span", {}, g.name),
      icon("runter"),
    );
    return el(
      "section",
      { class: "lg-nav-gruppe" },
      el("h2", { class: "lg-nav-titel" }, kopf),
      auf,
    );
  };
  const liste = el(
    "div",
    { class: "lg-nav-liste", id: listeId },
    marke,
    el("div", { class: "lg-nav-innen" }, gruppen.map(gruppe)),
  );
  return el(
    "nav",
    { class: "lg-nav", "aria-label": `Bereiche von «${lager.titel}»` },
    knopf,
    liste,
  );
}

// Setzt die Marke hinter den aktiven Eintrag. Beim ersten Mal gleitet sie vom letzten Platz (Wechsel im selben Lager), danach folgt sie dem Eintrag, wenn Gruppen auf- oder zuklappen. Erst aufrufen, wenn die Navigation im Dokument steht (offsetTop).
function setzeMarke(nav, lagerId) {
  const marke = nav.querySelector(".lg-nav-marke");
  const aktiv = nav.querySelector('a[aria-current="page"]');
  const liste = nav.querySelector(".lg-nav-liste");
  if (!marke || !aktiv) return;
  const vorher = letzteMarke?.lagerId === lagerId ? letzteMarke.oben : null;
  // Die Navigation scrollt für sich, wenn sie höher ist als das Fenster: gleicher Stand wie vorher, und der aktive Eintrag bleibt im Bild
  nav.addEventListener("scroll", () => {
    if (letzteMarke) letzteMarke.scroll = nav.scrollTop;
  });
  if (vorher !== null) nav.scrollTop = letzteMarke.scroll ?? 0;
  const lage = liste.offsetTop + aktiv.offsetTop;
  if (lage < nav.scrollTop || lage + 44 > nav.scrollTop + nav.clientHeight)
    nav.scrollTop = Math.max(0, lage - nav.clientHeight / 2 + 22);
  nav.classList.add("lg-nav--marke");
  const setze = (von, nach, dauer) => {
    for (const a of marke.getAnimations()) a.cancel();
    marke.animate(
      [
        { transform: `translateY(${von}px)` },
        { transform: `translateY(${nach}px)` },
      ],
      { duration: dauer, easing: KURVE, fill: "forwards" },
    );
  };
  const oben = aktiv.offsetTop;
  const gleitet = vorher !== null && vorher !== oben && darfBewegen();
  setze(gleitet ? vorher : oben, oben, gleitet ? DAUER_LANG_MS : 0);
  letzteMarke = { lagerId, oben, scroll: nav.scrollTop };
  // Klappt eine Gruppe über dem aktiven Eintrag auf oder zu, wandert er mit; ist seine Gruppe zu, verschwindet die Marke
  if (!window.ResizeObserver) return;
  new window.ResizeObserver(() => {
    if (!nav.isConnected) return;
    const sichtbar = aktiv.offsetParent !== null && aktiv.offsetHeight > 0;
    marke.hidden = !sichtbar;
    if (!sichtbar) return;
    const jetzt = aktiv.offsetTop;
    if (jetzt === letzteMarke.oben) return;
    setze(jetzt, jetzt, 0);
    letzteMarke.oben = jetzt;
  }).observe(liste);
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
      novalidate: true,
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

// Wechsel im Arbeitsbereich ohne Sprung (#693): Wer in der Navigation ein anderes Modul oder einen Reiter wählt, bleibt an der Stelle der Seite. Der Klick meldet das vor dem Wechsel (die Stelle kennt danach niemand mehr: Der neue Inhalt ist erst leer, die Seite kurz). Ein Reiter behält die Stelle genau; ein anderes Modul oder eine Detailseite richtet den Anfang des Moduls oben aus, wenn die Seite weiter unten stand, und lässt sie sonst, wo sie war. Zurück und Vor im Browser gehen ihren eigenen Weg (verlauf.js).
document.addEventListener(
  "click",
  (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    const a = e.target.closest?.('a[href^="#lager/lager/"]');
    if (!a?.closest(".lg-arbeit")) return;
    behalteStelle(
      a.classList.contains("tab") ? "genau" : "ausrichten",
      a.getAttribute("href"),
    );
  },
  true,
);

function haltePosition(arbeit) {
  const b = nimmBehaltene();
  if (!b) return;
  if (b.art === "genau") return haltStelle(b.y, { versuche: 120 });
  const oben = arbeit.getBoundingClientRect().top + window.scrollY;
  const rand = parseFloat(window.getComputedStyle(arbeit).scrollMarginTop) || 0;
  haltStelle(Math.min(b.y, Math.max(0, oben - rand)), { versuche: 120 });
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
  const status = statusZeile(lager, modulCtx, () => modulCtx.neuRahmen());
  haenge(bereich, leiste, status.wurzel, neues, status.wurzel, arbeit);
  setzeMarke(nav, lager.id);
  eintritt();
  haltePosition(arbeit);
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
