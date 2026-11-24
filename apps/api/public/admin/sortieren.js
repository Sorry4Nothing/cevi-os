// Sortierliste (#578): Reihenfolge ändern per Ziehen am Griff, per Tastatur (Leertaste nimmt auf, Pfeile bewegen, Leertaste legt ab, Escape bricht ab) und mit Knöpfen «Nach oben» und «Nach unten» als Alternative ohne Ziehen (WCAG 2.5.7). Jede Änderung wird angesagt (Statusregion).
// Die Liste ändert nur die Anzeige und ruft beiNeu(ids, alt); speichern tut der Aufrufer. Mit mitRueckgaengig (ctx.mitRueckgaengig) wird das Speichern verzögert und lässt sich in der Frist zurücknehmen.
import { el, icon, neueId } from "./dom.js";

// Reine Funktion (testbar): verschiebt das Element an der Stelle von nach nach; ausserhalb der Liste bleibt sie stehen
export function verschiebe(ids, von, nach) {
  const ziel = Math.max(0, Math.min(ids.length - 1, nach));
  if (von < 0 || von >= ids.length || ziel === von) return [...ids];
  const neu = [...ids];
  const [x] = neu.splice(von, 1);
  neu.splice(ziel, 0, x);
  return neu;
}

// Text der Ansage: «Fahrrad, Position 2 von 5»
export const positionsText = (text, index, anzahl) =>
  `${text}, Position ${index + 1} von ${anzahl}`;

const darfBewegen = () =>
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

// Ziehen mit Zeiger (Maus, Finger, Stift), zentral für alle Listen mit Reihenfolge.
// Die Zeile bleibt im Dokument an ihrem Platz und folgt dem Zeiger nur per Transformation; die anderen Zeilen rutschen per Transformation an ihren künftigen Platz. Das Dokument wird erst nach dem Absetzen umgebaut, darum verliert der Griff den Zeiger nie.
// ereignis: das pointerdown am Griff · zeile: Element (oder Elemente, die zusammen wandern) · andere(): die übrigen Zeilen in Dokumentreihenfolge
// huelle: Element, das den Platzhalter aufnimmt (bekommt für die Dauer position: relative)
// ziel(punkt): optional, liefert { pos, einzug?, marke?, markeKlasse? } oder null (nichts ändern); punkt: { x, y, mitte (Fenster; Mitte der gezogenen Zeile), pos0, kaesten: [{ el, top, h }] der anderen Zeilen am Ausgangsplatz (Fenster) }
//   pos: Platz der gezogenen Zeile unter den anderen (0 bis Anzahl); ohne ziel entscheiden die Mitten der Zeilen
// beiEnde({ abgebrochen, pos, ziel, pos0 }): nach dem Absetzen oder Abbrechen (Escape, Abbruch des Zeigers); darf ein Promise liefern
export function zieheMitBewegung({
  ereignis,
  zeile,
  andere,
  huelle,
  ziel,
  beiEnde,
}) {
  const gruppe = [zeile].flat();
  const rest = andere();
  const sy0 = window.scrollY;
  const kasten = (liste) => {
    const a = liste[0].getBoundingClientRect();
    const b = liste.at(-1).getBoundingClientRect();
    return {
      top: a.top + sy0,
      h: b.bottom - a.top,
      links: a.left,
      breite: a.width,
    };
  };
  const ich = kasten(gruppe);
  const k = rest.map((e) => kasten([e]));
  const pos0 = rest.filter(
    (e) =>
      e.compareDocumentPosition(gruppe[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).length;
  const ausgang = k.map((r) => ({ top: r.top, h: r.h }));
  ausgang.splice(pos0, 0, { top: ich.top, h: ich.h });
  const luecke =
    ausgang.length > 1
      ? Math.max(0, ausgang[1].top - ausgang[0].top - ausgang[0].h)
      : 0;
  // Wo jede Zeile steht, wenn die gezogene an Platz pos sitzt (Dokumentkoordinaten)
  const lege = (pos) => {
    const reihe = rest.map((_, i) => i);
    reihe.splice(pos, 0, -1);
    const neu = [];
    let platz = 0;
    let y = ausgang[0].top;
    for (const i of reihe) {
      if (i < 0) {
        platz = y;
        y += ich.h + luecke;
      } else {
        neu[i] = y;
        y += k[i].h + luecke;
      }
    }
    return { neu, platz };
  };

  const bewegt = darfBewegen();
  const platzhalter = document.createElement("div");
  platzhalter.className = "sortier-platzhalter";
  platzhalter.setAttribute("aria-hidden", "true");
  const huelleLag = window.getComputedStyle(huelle).position;
  if (huelleLag === "static") huelle.style.position = "relative";
  const hr = huelle.getBoundingClientRect();
  platzhalter.style.height = `${ich.h}px`;
  huelle.append(platzhalter);
  const lageSlot = (platz, einzug) => {
    const links =
      ich.links - hr.left - huelle.clientLeft + huelle.scrollLeft + einzug;
    const oben = platz - (hr.top + sy0) - huelle.clientTop + huelle.scrollTop;
    platzhalter.style.left = `${links}px`;
    platzhalter.style.width = `${ich.breite - einzug}px`;
    platzhalter.style.transform = `translateY(${oben}px)`;
  };

  for (const e of rest) e.classList.add("sortier-weicht");
  for (const e of gruppe) e.classList.add("wird-gezogen");
  huelle.classList.add("sortier-zieht");
  document.body.classList.add("sortieren-aktiv");

  const z = { x: ereignis.clientX, y: ereignis.clientY };
  const y0 = z.y;
  let aktuell = { pos: pos0 };
  let marke = null;
  let lauf = true;
  let fertig = false;
  lageSlot(lege(pos0).platz, 0);
  // Erst nach dem ersten Platz darf der Platzhalter gleiten, sonst käme er von oben herein
  platzhalter.getBoundingClientRect();
  platzhalter.classList.add("sortier-platzhalter--gleitet");

  const verschiebeRest = (pos) => {
    const { neu } = lege(pos);
    rest.forEach((e, i) => {
      const dy = neu[i] - k[i].top;
      e.style.transform = Math.abs(dy) < 0.5 ? "" : `translateY(${dy}px)`;
    });
  };
  const setzeMarke = (el, klasse) => {
    if (marke && (marke.el !== el || marke.klasse !== klasse)) {
      marke.el.classList.remove(marke.klasse);
      marke = null;
    }
    if (el && klasse && !marke) {
      el.classList.add(klasse);
      marke = { el, klasse };
    }
  };
  const aktualisiere = () => {
    if (fertig) return;
    const dy = z.y - y0 + (window.scrollY - sy0);
    for (const e of gruppe) e.style.transform = `translateY(${dy}px)`;
    const mitte = ich.top + ich.h / 2 + dy - window.scrollY;
    const neu = ziel
      ? ziel({
          x: z.x,
          y: z.y,
          mitte,
          pos0,
          kaesten: rest.map((el, i) => ({
            el,
            top: k[i].top - window.scrollY,
            h: k[i].h,
          })),
        })
      : {
          pos: k.filter((r) => r.top + r.h / 2 - window.scrollY < mitte).length,
        };
    if (!neu) return;
    if (neu.pos !== aktuell.pos) verschiebeRest(neu.pos);
    lageSlot(lege(neu.pos).platz, neu.einzug ?? 0);
    setzeMarke(neu.marke, neu.markeKlasse);
    aktuell = neu;
  };
  const bewegung = (ev) => {
    z.x = ev.clientX;
    z.y = ev.clientY;
    aktualisiere();
  };
  // Am Rand des Fensters rollt die Seite mit
  const rolle = () => {
    if (!lauf) return;
    if (z.y < 80) window.scrollBy(0, -14);
    else if (z.y > window.innerHeight - 80) window.scrollBy(0, 14);
    aktualisiere();
    window.requestAnimationFrame(rolle);
  };
  window.requestAnimationFrame(rolle);

  const ende = async (abgebrochen) => {
    if (fertig) return;
    aktualisiere();
    fertig = true;
    lauf = false;
    document.removeEventListener("pointermove", bewegung);
    document.removeEventListener("pointerup", loslassen);
    document.removeEventListener("pointercancel", abbruch);
    document.removeEventListener("keydown", taste, true);
    setzeMarke(null);
    const endZiel = abgebrochen ? { pos: pos0 } : aktuell;
    if (abgebrochen) verschiebeRest(pos0);
    const { platz } = lege(endZiel.pos);
    for (const e of gruppe) {
      e.classList.add("sortier-setzt-ab");
      e.style.transform = `translateY(${platz - ich.top}px)`;
    }
    lageSlot(platz, endZiel.einzug ?? 0);
    if (bewegt) await new Promise((r) => setTimeout(r, 240));
    const aufraeumen = () => {
      for (const e of rest) {
        e.classList.remove("sortier-weicht");
        e.style.transform = "";
      }
      for (const e of gruppe) {
        e.classList.remove("wird-gezogen", "sortier-setzt-ab");
        e.style.transform = "";
      }
      platzhalter.remove();
      huelle.classList.remove("sortier-zieht");
      if (huelleLag === "static") huelle.style.position = "";
      document.body.classList.remove("sortieren-aktiv");
    };
    // Erst ordnet der Aufrufer neu, im selben Schritt fallen die Verschiebungen weg: Nichts blitzt
    let r;
    try {
      r = beiEnde?.({ abgebrochen, pos: endZiel.pos, ziel: endZiel, pos0 });
    } finally {
      if (r && typeof r.then === "function") r.then(aufraeumen, aufraeumen);
      else aufraeumen();
    }
  };
  const loslassen = () => ende(false);
  const abbruch = () => ende(true);
  const taste = (ev) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    ende(true);
  };
  document.addEventListener("pointermove", bewegung);
  document.addEventListener("pointerup", loslassen);
  document.addEventListener("pointercancel", abbruch);
  document.addEventListener("keydown", taste, true);
  aktualisiere();
}

// Umordnen per Knopf: Die Zeilen rutschen von ihrem alten an den neuen Platz (nur bei erlaubter Bewegung)
export function merkePlaetze(zeilen) {
  return new Map(
    zeilen.map((z) => [z.dataset.id, z.getBoundingClientRect().top]),
  );
}
export function rutscheAnPlatz(zeilen, vorher) {
  if (!darfBewegen()) return;
  for (const z of zeilen) {
    const alt = vorher.get(z.dataset.id);
    if (alt === undefined) continue;
    const dy = alt - z.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    z.style.transform = `translateY(${dy}px)`;
    z.getBoundingClientRect();
    z.classList.add("sortier-weicht");
    z.style.transform = "";
    z.addEventListener(
      "transitionend",
      () => z.classList.remove("sortier-weicht"),
      { once: true },
    );
  }
}

// eintraege: [{ id, text, inhalt? }], text ist der Name für Griff und Ansage, inhalt (Knoten) die Anzeige in der Zeile
// beiNeu(ids, alt): Reihenfolge der IDs; darf werfen oder ein Promise liefern
// mitRueckgaengig: optional, ctx.mitRueckgaengig; ohne es wird beiNeu sofort gerufen
export function sortierListe({
  beschriftung,
  eintraege,
  beiNeu,
  mitRueckgaengig,
  aktionstext = "Reihenfolge geändert",
}) {
  const listeId = neueId("sortieren");
  const hinweisId = `${listeId}-hinweis`;
  let daten = eintraege.map((e) => ({ ...e }));
  let aufgenommen = null; // { id, vorher }
  const ansage = el("p", { class: "nur-leser", role: "status" });
  const hinweis = el(
    "p",
    { class: "nur-leser", id: hinweisId },
    "Leertaste nimmt den Eintrag auf, Pfeiltasten bewegen ihn, Leertaste legt ihn ab, Escape bricht ab. Oder nutze die Knöpfe Nach oben und Nach unten.",
  );
  const liste = el("ul", {
    class: "sortierliste",
    id: listeId,
    "aria-label": beschriftung,
  });
  const ids = () => daten.map((e) => e.id);
  const sage = (text) => {
    ansage.textContent = "";
    // Nach dem Leeren setzen, damit auch derselbe Text erneut vorgelesen wird
    queueMicrotask(() => (ansage.textContent = text));
  };
  const index = (id) => daten.findIndex((e) => e.id === id);

  function zeichne(fokusId, fokusArt) {
    liste.replaceChildren(
      ...daten.map((e, i) => {
        const hoch = el(
          "button",
          {
            type: "button",
            class: "knopf knopf--rund",
            "aria-label": `Nach oben: ${e.text}`,
            disabled: i === 0,
            "data-art": "hoch",
            onclick: () => bewege(e.id, -1, "hoch"),
          },
          icon("hoch"),
        );
        const runter = el(
          "button",
          {
            type: "button",
            class: "knopf knopf--rund",
            "aria-label": `Nach unten: ${e.text}`,
            disabled: i === daten.length - 1,
            "data-art": "runter",
            onclick: () => bewege(e.id, 1, "runter"),
          },
          icon("runter"),
        );
        const griff = el(
          "button",
          {
            type: "button",
            class: "sortier-griff",
            "aria-label": `Verschieben: ${e.text}`,
            "aria-describedby": hinweisId,
            "aria-pressed": String(aufgenommen?.id === e.id),
            "data-art": "griff",
            onkeydown: (ereignis) => taste(ereignis, e.id),
            onpointerdown: (ereignis) => ziehe(ereignis, e.id),
          },
          icon("sortieren"),
        );
        const zeile = el(
          "li",
          {
            class: `sortier-eintrag${aufgenommen?.id === e.id ? " ist-aufgenommen" : ""}`,
            "data-id": e.id,
          },
          griff,
          el("div", { class: "sortier-inhalt" }, e.inhalt ?? e.text),
          el("div", { class: "sortier-knoepfe" }, hoch, runter),
        );
        return zeile;
      }),
    );
    if (fokusId !== undefined) {
      const ziel = liste.querySelector(
        `[data-id="${CSS.escape(fokusId)}"] [data-art="${fokusArt}"]`,
      );
      // Ist der Knopf am Rand gesperrt (erste oder letzte Stelle), bleibt der Fokus beim Griff
      (ziel && !ziel.disabled
        ? ziel
        : liste.querySelector(
            `[data-id="${CSS.escape(fokusId)}"] [data-art="griff"]`,
          )
      )?.focus();
    }
  }

  // Meldet die neue Reihenfolge; mit Rückgängig geht das Speichern erst nach der Frist hinaus
  function melde(alt) {
    const neu = ids();
    if (neu.join("|") === alt.join("|")) return;
    if (mitRueckgaengig) {
      mitRueckgaengig({
        text: aktionstext,
        ausfuehren: () => beiNeu(ids(), alt),
        ansicht: {
          weg: () => {},
          zurueck: () => {
            const reihe = new Map(daten.map((e) => [e.id, e]));
            daten = alt.map((id) => reihe.get(id)).filter(Boolean);
            zeichne();
          },
        },
      });
    } else {
      beiNeu(neu, alt);
    }
  }

  function bewege(id, schritt, art) {
    const von = index(id);
    const alt = ids();
    const nach = von + schritt;
    if (nach < 0 || nach >= daten.length) return;
    const neu = verschiebe(alt, von, nach);
    const reihe = new Map(daten.map((e) => [e.id, e]));
    daten = neu.map((x) => reihe.get(x));
    const plaetze = merkePlaetze([...liste.children]);
    zeichne(id, art);
    rutscheAnPlatz([...liste.children], plaetze);
    sage(positionsText(daten[nach].text, nach, daten.length));
    melde(alt);
  }

  // Tastatur am Griff: aufnehmen, bewegen, ablegen, abbrechen
  function taste(ereignis, id) {
    const e = daten[index(id)];
    if (ereignis.key === " " || ereignis.key === "Enter") {
      ereignis.preventDefault();
      if (!aufgenommen) {
        aufgenommen = { id, vorher: ids() };
        zeichne(id, "griff");
        sage(
          `${positionsText(e.text, index(id), daten.length)} aufgenommen. Pfeiltasten bewegen, Leertaste legt ab.`,
        );
      } else {
        const alt = aufgenommen.vorher;
        aufgenommen = null;
        zeichne(id, "griff");
        sage(`${positionsText(e.text, index(id), daten.length)} abgelegt.`);
        melde(alt);
      }
    } else if (aufgenommen && aufgenommen.id === id) {
      if (ereignis.key === "ArrowUp" || ereignis.key === "ArrowDown") {
        ereignis.preventDefault();
        const von = index(id);
        const nach = von + (ereignis.key === "ArrowUp" ? -1 : 1);
        if (nach < 0 || nach >= daten.length) return;
        const reihe = new Map(daten.map((x) => [x.id, x]));
        daten = verschiebe(ids(), von, nach).map((x) => reihe.get(x));
        zeichne(id, "griff");
        sage(positionsText(e.text, nach, daten.length));
      } else if (ereignis.key === "Escape") {
        ereignis.preventDefault();
        ereignis.stopPropagation();
        const reihe = new Map(daten.map((x) => [x.id, x]));
        daten = aufgenommen.vorher.map((x) => reihe.get(x));
        aufgenommen = null;
        zeichne(id, "griff");
        sage("Abgebrochen. Die Reihenfolge ist wie vorher.");
      }
    }
  }

  // Ziehen mit Maus, Finger oder Stift: Die Zeile folgt dem Zeiger, die anderen weichen aus (zieheMitBewegung); danach ordnet die Liste neu
  function ziehe(ereignis, id) {
    if (ereignis.button !== 0 && ereignis.pointerType === "mouse") return;
    ereignis.preventDefault();
    const alt = ids();
    const zeile = liste.querySelector(`[data-id="${CSS.escape(id)}"]`);
    zieheMitBewegung({
      ereignis,
      zeile,
      andere: () => [...liste.children].filter((z) => z !== zeile),
      huelle: liste,
      beiEnde: ({ abgebrochen, pos }) => {
        const reihe = new Map(daten.map((x) => [x.id, x]));
        const rest = alt.filter((x) => x !== id);
        if (!abgebrochen) rest.splice(pos, 0, id);
        daten = (abgebrochen ? alt : rest).map((x) => reihe.get(x));
        zeichne(id, "griff");
        const nach = index(id);
        if (!abgebrochen && ids().join("|") !== alt.join("|")) {
          sage(positionsText(daten[nach].text, nach, daten.length));
          zeigeSchritte(id, alt.indexOf(id) - nach);
          melde(alt);
        }
      },
    });
  }

  // Kurzer Hinweis neben der abgesetzten Zeile, wie weit sie gewandert ist; verschwindet von selbst, die Ansage sagt dasselbe (nur Zierde)
  function zeigeSchritte(id, schritte) {
    if (schritte === 0 || !darfBewegen()) return;
    const inhalt = liste.querySelector(
      `[data-id="${CSS.escape(id)}"] .sortier-inhalt`,
    );
    const marke = el(
      "span",
      {
        class: `sortier-schritte${schritte > 0 ? " ist-hoch" : ""}`,
        "aria-hidden": "true",
      },
      `${Math.abs(schritte)} ${schritte > 0 ? "nach oben" : "nach unten"}`,
    );
    inhalt?.append(marke);
    window.setTimeout(() => marke.remove(), 1600);
  }

  zeichne();
  return {
    wurzel: el("div", { class: "sortieren" }, hinweis, liste, ansage),
    ids,
    // Neue Daten von aussen (nach dem Neuladen)
    setze(neueEintraege) {
      daten = neueEintraege.map((e) => ({ ...e }));
      aufgenommen = null;
      zeichne();
    },
  };
}
