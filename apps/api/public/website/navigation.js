// Menü für Angemeldete (#795). Seiten, die nur für Angemeldete oder für Gruppen sichtbar sind, stehen nie im statischen Menü. Nach der Anmeldung lädt konto-menue.js dieses Modul;
// es fragt GET /api/v1/website/navigation (gleiche Herkunft, Cookie der Sitzung) und fügt die Seiten ein, die die Person sehen darf: an der Stelle des Seitenbaums, mit der Reihenfolge der Seiten, im Menü am Computer, im Menü am Handy und in der Unterleiste.
// Ohne Skript, ohne Sitzung und bei jedem Fehler bleibt das statische Menü, wie es ist. Alles kommt als Text und über DOM-Knoten, nie über innerHTML; die Prüfung und der Plan stehen in navigation-plan.js.
import { bindeUntermenue } from "./menue.js";
import { ausPlan, pfadVon, plane, pruefeAntwort } from "./navigation-plan.js";
import { el, symbol } from "./ui.js";

const FRIST_MS = 8000;

async function frage() {
  const abbruch = new AbortController();
  const aus = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const r = await fetch("/api/v1/website/navigation", {
      credentials: "same-origin",
      cache: "no-store",
      signal: abbruch.signal,
    });
    return r.ok ? pruefeAntwort(await r.json()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(aus);
  }
}

const linkVon = (wurzel, pfad) =>
  [...wurzel.querySelectorAll("a")].find(
    (a) => a.getAttribute("href") === pfad,
  );

const neuerPunkt = (e) => {
  const a = el("a", "", e.titel);
  a.href = e.pfad;
  if (e.stand) a.setAttribute("aria-current", e.stand);
  // Ein ruhiges Einblenden; bei «Bewegung reduzieren» sieht kopf.css davon ab
  return el("li", "nav-neu", a);
};

const oeffner = (titel) => {
  const s = el("summary", "", symbol("dreieck"));
  s.setAttribute("aria-label", `Unterseiten von ${titel}`);
  return s;
};

// Die Liste, in die die Unterseiten eines Punktes kommen; fehlt sie (der Punkt hatte bisher keine), entsteht sie in der Form, die das Menü sonst hat
function listeUnter(li, art) {
  const bestehend =
    art === "mobil"
      ? li.querySelector(":scope > details > ul")
      : li.querySelector(":scope > details > .unter > ul, :scope > ul");
  if (bestehend) return bestehend;
  const titel = li.querySelector(":scope > a").textContent;
  const ul = el("ul");
  const oben =
    art === "leiste" && li.parentElement.parentElement.matches(".hauptnav");
  if (art === "mobil" || oben) {
    li.classList.add("mit-unter");
    const d = el("details", "", oeffner(titel));
    if (oben) {
      d.setAttribute("name", "hauptnav");
      d.append(el("div", "unter", ul));
    } else d.append(ul);
    li.append(d);
    if (oben) bindeUntermenue(d);
  } else {
    li.append(ul);
    // Eine Unterseite mit eigenen Unterseiten macht die Tafel zur Tafel mit Spalten
    const tafel = li.parentElement.parentElement;
    if (tafel.matches(".unter") && !tafel.closest(".weitere")) {
      tafel.classList.add("unter--gruppen");
    }
  }
  return ul;
}

// Ein Eintrag an seine Stelle in einem der Menüs (art: «leiste» am Computer, «mobil» am Handy)
function setzeEin(wurzel, art, e) {
  const oben = wurzel.querySelector(":scope > ul");
  if (!oben) return;
  const punkt = neuerPunkt(e);
  const elternLi = e.eltern ? linkVon(wurzel, e.eltern)?.closest("li") : null;
  const liste = elternLi ? listeUnter(elternLi, art) : oben;
  const ziel = e.davor ? linkVon(wurzel, e.davor)?.closest("li") : null;
  // «Mehr» sammelt, was in der Leiste keinen Platz hat: Es steht am Ende und nimmt auch neue Punkte am Ende der obersten Ebene auf
  const mehr = oben.querySelector(":scope > li.weitere .unter > ul");
  if (
    ziel &&
    (ziel.parentElement === liste ||
      (liste === oben && ziel.parentElement === mehr))
  ) {
    ziel.before(punkt);
  } else if (liste === oben && mehr) {
    mehr.append(punkt);
  } else {
    liste.append(punkt);
  }
}

// Passen die neuen Punkte nicht mehr in die Zeile (die Leiste bricht um oder die Knöpfe rechts rutschen in eine zweite Zeile, der Kopf würde höher), wandern die letzten unter «Mehr», wie es der Server bei vielen Seiten auch tut.
// Ein Punkt mit Untermenü steht dort wie sonst in «Mehr»: ohne eigene Tafel, die Unterseiten eingerückt darunter
function passeLeiste(leiste, vorher) {
  const oben = leiste.querySelector(":scope > ul");
  const zeile = leiste.closest(".kopf-in");
  const hoch = () => zeile.getBoundingClientRect().height;
  if (hoch() <= vorher + 1) return;
  let mehr = oben.querySelector(":scope > li.weitere");
  if (!mehr) {
    const d = el(
      "details",
      "",
      el("summary", "", "Mehr", symbol("dreieck")),
      el("div", "unter", el("ul")),
    );
    d.setAttribute("name", "hauptnav");
    mehr = el("li", "mit-unter weitere", d);
    oben.append(mehr);
    bindeUntermenue(d);
  }
  const liste = mehr.querySelector(".unter > ul");
  while (hoch() > vorher + 1 && oben.children.length > 2) {
    const letzte = [...oben.children].filter((li) => li !== mehr).at(-1);
    const unter = letzte.querySelector(":scope > details > .unter > ul");
    if (unter) {
      letzte.classList.remove("mit-unter");
      letzte.querySelector(":scope > details").remove();
      letzte.append(unter);
    }
    liste.prepend(letzte);
  }
  if (liste.querySelector("[aria-current]")) mehr.classList.add("hier");
}

// Die aktuelle Seite ist ein neuer Eintrag (die Hülle einer geschützten Seite kennt keine Markierung): Ihre Elternseiten im Menü werden markiert, im Menü am Handy aufgeklappt
function markiere(wurzeln, aktuell) {
  for (const wurzel of wurzeln) {
    for (const a of wurzel.querySelectorAll("a")) {
      const h = a.getAttribute("href");
      if (a.hasAttribute("aria-current") || h === "/") continue;
      if (h === aktuell) a.setAttribute("aria-current", "page");
      else if (aktuell.startsWith(`${h}/`))
        a.setAttribute("aria-current", "true");
    }
    for (const a of wurzel.querySelectorAll("a[aria-current]")) {
      for (let li = a.closest("li"); li; li = li.parentElement?.closest("li")) {
        if (li.matches(".weitere")) li.classList.add("hier");
        const d = li.querySelector(":scope > details");
        if (d && wurzel.closest(".menue-mobil")) d.open = true;
      }
    }
  }
}

// Die Unterleiste unter dem Kopf zeigt die Unterseiten des Bereichs, in dem man ist. Sie gehört zum statischen Menü; mit neuen Einträgen baut dieses Skript sie neu auf (oder legt sie an, wenn der Bereich bisher keine Unterseiten hatte)
function unterleiste(leiste, aktuell) {
  const bereich = [...leiste.querySelectorAll("li")]
    .filter((li) =>
      li.parentElement.parentElement.matches(".hauptnav, .weitere .unter"),
    )
    .find((li) => {
      const h = li.querySelector(":scope > a")?.getAttribute("href");
      return h && h !== "/" && (aktuell === h || aktuell.startsWith(`${h}/`));
    });
  const liste = bereich?.querySelector(":scope > details > .unter > ul");
  if (!liste) return;
  const links = [...liste.querySelectorAll(":scope > li > a")];
  const alt = document.querySelector(".unterleiste");
  const gleich =
    alt &&
    [...alt.querySelectorAll("a")].map((a) => a.getAttribute("href")).join() ===
      links.map((a) => a.getAttribute("href")).join();
  if (gleich) return;
  const titel = bereich.querySelector(":scope > a").textContent;
  const ul = el("ul");
  for (const a of links) {
    const kopie = el("a", "", a.textContent);
    kopie.href = a.getAttribute("href");
    const stand = a.getAttribute("aria-current");
    if (stand) kopie.setAttribute("aria-current", stand);
    ul.append(el("li", "", kopie));
  }
  const nav = el("nav", "unterleiste", el("div", "wrap", ul));
  nav.setAttribute("aria-label", `Unterseiten von ${titel}`);
  if (alt) alt.replaceWith(nav);
  else document.querySelector(".kopf")?.after(nav);
}

async function start() {
  const eintraege = await frage();
  if (!eintraege || eintraege.length === 0) return;
  const leiste = document.querySelector(".hauptnav");
  const mobil = document.querySelector(".menue-mobil nav");
  const wurzeln = [leiste, mobil].filter(Boolean);
  if (wurzeln.length === 0) return;
  const aktuell = pfadVon(window.location.pathname);
  const vorhanden = new Set(
    wurzeln.flatMap((w) =>
      [...w.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ),
  );
  const plan = plane(eintraege, vorhanden, aktuell);
  if (plan.length === 0) return;
  const vorher = leiste?.closest(".kopf-in")?.getBoundingClientRect().height;
  for (const e of plan) {
    if (leiste) setzeEin(leiste, "leiste", e);
    if (mobil) setzeEin(mobil, "mobil", e);
  }
  if (ausPlan(plan, aktuell)) markiere(wurzeln, aktuell);
  if (leiste) {
    if (vorher) passeLeiste(leiste, vorher);
    unterleiste(leiste, aktuell);
  }
}

start();
