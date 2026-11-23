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
    zeichne(id, art);
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

  // Ziehen mit Maus, Finger oder Stift: Die Zeile folgt dem Zeiger, die Nachbarn weichen nach der Mitte der Zeilen
  function ziehe(ereignis, id) {
    if (ereignis.button !== 0 && ereignis.pointerType === "mouse") return;
    ereignis.preventDefault();
    const griff = ereignis.currentTarget;
    griff.setPointerCapture?.(ereignis.pointerId);
    const alt = ids();
    const zeile = liste.querySelector(`[data-id="${CSS.escape(id)}"]`);
    zeile.classList.add("wird-gezogen");
    const bewegt = (e) => {
      const zeilen = [...liste.children];
      const eigene = zeilen.indexOf(zeile);
      let ziel = eigene;
      zeilen.forEach((z, i) => {
        if (z === zeile) return;
        const r = z.getBoundingClientRect();
        const mitte = r.top + r.height / 2;
        if (i < eigene && e.clientY < mitte) ziel = Math.min(ziel, i);
        if (i > eigene && e.clientY > mitte) ziel = Math.max(ziel, i);
      });
      if (ziel !== eigene) {
        liste.insertBefore(
          zeile,
          ziel > eigene ? zeilen[ziel].nextSibling : zeilen[ziel],
        );
      }
    };
    const fertig = (e) => {
      griff.removeEventListener("pointermove", bewegt);
      griff.removeEventListener("pointerup", fertig);
      griff.removeEventListener("pointercancel", abbruch);
      zeile.classList.remove("wird-gezogen");
      const reihe = new Map(daten.map((x) => [x.id, x]));
      daten = [...liste.children].map((z) => reihe.get(z.dataset.id));
      zeichne(id, "griff");
      const nach = index(id);
      if (e.type !== "pointercancel" && ids().join("|") !== alt.join("|")) {
        sage(positionsText(daten[nach].text, nach, daten.length));
        melde(alt);
      }
    };
    const abbruch = (e) => fertig(e);
    griff.addEventListener("pointermove", bewegt);
    griff.addEventListener("pointerup", fertig);
    griff.addEventListener("pointercancel", abbruch);
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
