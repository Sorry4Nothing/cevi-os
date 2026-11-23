import { anfrage } from "./api.js";
import { chip, el, menue, zeit } from "./dom.js";
import { ansichtVon, steuerung } from "./rueckgaengig.js";
import {
  API,
  ablehnung,
  baue as baueBaum,
  geaenderteAdressen,
  geschwister,
  koerper,
  patch,
  plane,
  schnappschuss,
  stelleHer,
  wendeAn,
} from "./website-baum.js";
import { anzahlText, kuerze, sichtbarkeitText } from "./website-dialoge.js";
import { symbol } from "./website-symbole.js";

// Der Seitenbaum der Website als WAI-ARIA-Tree (Vorlage im Aufbau: Dateibaum mit Führungslinien, Ziehen auf eine Elternseite, F2 zum Umbenennen).
// Tastatur: Pfeile gehen durch den Baum (links zu, rechts auf, nach oben zur Elternseite), Enter öffnet den Editor, F2 benennt um, Entf löscht,
// Leertaste nimmt die Seite zum Verschieben auf: Pfeil hoch oder runter ordnet unter Geschwistern, Pfeil rechts macht sie zur Unterseite der Seite darüber,
// Pfeil links zur Seite auf der Ebene der Elternseite; Leertaste legt ab, Escape bricht ab. Dieselben Schritte gibt es im Menü «Mehr» (kein Ziehen nötig, WCAG 2.5.7).
// Verschieben ändert die Adresse der Seite und ihrer Unterseiten: Danach weist eine Meldung darauf hin und bietet Weiterleitungen an (wer das Recht dazu hat).
// Das Modell (k.daten.seiten) ändert sich sofort; gespeichert wird nach der Frist von «Rückgängig» (ctx.mitRueckgaengig), höchstens ein Verschieben gleichzeitig.
// k: { ctx, daten: { seiten }, tagNamen, verwalten, beiLoeschen(z, element), seitenFehler }

export function baumAnsicht(k, zustand) {
  const wurzel = el("div", {
    class: "ws-baum",
    role: "tree",
    "aria-label": "Seiten der Website",
  });
  const ansage = el("p", { class: "nur-leser", role: "status" });
  const hinweisId = `baumhilfe-${Math.random().toString(36).slice(2, 8)}`;
  const hinweis = el(
    "p",
    { class: "nur-leser", id: hinweisId },
    k.verwalten
      ? "Pfeiltasten bewegen im Baum, Enter öffnet die Seite, F2 benennt um, Leertaste nimmt zum Verschieben auf. Weitere Schritte stehen im Menü Mehr."
      : "Pfeiltasten bewegen im Baum, Enter öffnet die Seite.",
  );
  wurzel.setAttribute("aria-describedby", hinweisId);
  const seiten = () => k.daten.seiten;
  k.treffer ??= new Set();
  let baum = baueBaum(seiten());
  let sichtbar = null; // Set der IDs bei aktiver Suche oder aktivem Filter, sonst null
  let aktivId = baum.zeilen[0]?.seite.id ?? null;
  let aufgenommen = null; // { id, vorher }
  let offen = null; // das gerade wartende Verschieben (höchstens eins)

  const sage = (text) => {
    ansage.textContent = "";
    queueMicrotask(() => (ansage.textContent = text));
  };
  const nachId = (id) => baum.nachId.get(id);
  const zeileEl = (id) => wurzel.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const filtert = () => sichtbar !== null;

  // --- Zeichnen
  function verborgen(seite) {
    if (filtert()) return !sichtbar.has(seite.id);
    for (let e = seite.elternId; e; e = nachId(e)?.elternId) {
      if (zustand.zugeklappt.has(e)) return true;
    }
    return false;
  }

  function zeichne(fokusId) {
    baum = baueBaum(seiten());
    if (!nachId(aktivId)) aktivId = baum.zeilen[0]?.seite.id ?? null;
    wurzel.replaceChildren(
      ...baum.zeilen.filter((z) => !verborgen(z.seite)).map(zeile),
    );
    if (fokusId) fokussiere(fokusId);
    else rove(aktivId);
  }

  // Nur die Zeile mit dem Fokus und ihre Knöpfe sind per Tab erreichbar (Roving Tabindex)
  function rove(id) {
    for (const z of wurzel.querySelectorAll("[role=treeitem]")) {
      const aktiv = z.dataset.id === id;
      z.tabIndex = aktiv ? 0 : -1;
      for (const b of z.querySelectorAll("a, button, summary")) {
        b.tabIndex = aktiv ? 0 : -1;
      }
    }
  }
  function fokussiere(id) {
    aktivId = id;
    rove(id);
    zeileEl(id)?.focus();
  }

  function zeile(z) {
    const { seite, ebene, geschwister: reihe, index } = z;
    const kinder = baum.kinder.get(seite.id) ?? [];
    const zu = zustand.zugeklappt.has(seite.id) && !filtert();
    const nameId = `baum-name-${seite.id}`;
    const nurKontext = filtert() && !k.treffer.has(seite.id);
    const fuehrung = Array.from({ length: ebene }, () =>
      el("span", { class: "ws-fuehrung", "aria-hidden": "true" }),
    );
    const falten =
      kinder.length > 0 && !filtert()
        ? el(
            "button",
            {
              type: "button",
              class: "ws-falten",
              tabindex: "-1",
              "aria-label": `${zu ? "Aufklappen" : "Zuklappen"}: ${seite.titel}`,
              "aria-expanded": String(!zu),
              onclick: () => schalte(seite.id),
            },
            symbol("runter"),
          )
        : el("span", {
            class: "ws-falten ws-falten--leer",
            "aria-hidden": "true",
          });
    const link = el(
      "a",
      {
        class: "ws-name",
        href: `#website/seiten/${seite.id}`,
        tabindex: "-1",
      },
      el("span", { class: "ws-titel", id: nameId }, seite.titel),
      el("span", { class: "mono leise ws-pfad" }, seite.pfad),
    );
    const griff =
      k.verwalten && !filtert()
        ? el(
            "button",
            {
              type: "button",
              class: "sortier-griff ws-griff",
              tabindex: "-1",
              "aria-label": `Verschieben: ${seite.titel}`,
              "aria-describedby": hinweisId,
              onpointerdown: (e) => ziehe(e, seite),
              onkeydown: (e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  nimmAuf(seite);
                }
              },
            },
            symbol("griff"),
          )
        : el("span", {
            class: "ws-griff ws-griff--leer",
            "aria-hidden": "true",
          });
    const bearbeiten = el(
      "a",
      {
        class: "knopf knopf--klein ws-bearbeiten",
        href: `#website/seiten/${seite.id}`,
        tabindex: "-1",
        "aria-label": `Bearbeiten: ${seite.titel}`,
      },
      symbol("bearbeiten"),
      "Bearbeiten",
    );
    const row = el(
      "div",
      {
        class: `ws-zeile e${Math.min(ebene, 4)}${nurKontext ? " ws-zeile--kontext" : ""}${aufgenommen?.id === seite.id ? " ist-aufgenommen" : ""}`,
        role: "treeitem",
        "data-id": seite.id,
        tabindex: seite.id === aktivId ? "0" : "-1",
        "aria-level": String(ebene + 1),
        "aria-setsize": String(reihe.length),
        "aria-posinset": String(index + 1),
        "aria-expanded":
          kinder.length > 0 && !filtert() ? String(!zu) : undefined,
        "aria-labelledby": nameId,
        onkeydown: (e) => taste(e, z),
        onfocus: () => (aktivId = seite.id),
      },
      el("div", { class: "ws-baumfeld" }, griff, ...fuehrung, falten, link),
      el(
        "div",
        { class: "ws-werte" },
        el(
          "ul",
          { class: "chips" },
          seite.veroeffentlicht
            ? chip("Veröffentlicht", "ok")
            : chip("Entwurf", "warn", "bearbeiten"),
          chip(
            sichtbarkeitText(seite.sichtbarkeit, k.tagNamen),
            undefined,
            "schild",
          ),
        ),
        el(
          "span",
          { class: "klein leise ws-zeit" },
          el("time", { datetime: seite.geaendertAm }, zeit(seite.geaendertAm)),
        ),
      ),
      el("div", { class: "ws-aktionen" }, bearbeiten, k.verwalten && mehr(z)),
    );
    return row;
  }

  // Menü «Mehr»: die Schritte, die es auch ohne Ziehen gibt
  function mehr(z) {
    const { seite } = z;
    const kann = (art) => zielFuer(seite, art) !== null;
    const vorgaenger = z.geschwister[z.index - 1];
    return menue(seite.titel, [
      { text: "Umbenennen", onclick: () => benenne(seite) },
      kann("hoch") && {
        text: "Nach oben",
        onclick: () => schritt(seite, "hoch"),
      },
      kann("runter") && {
        text: "Nach unten",
        onclick: () => schritt(seite, "runter"),
      },
      kann("ein") && {
        text: `Unter «${kuerze(vorgaenger.titel, 24)}» einordnen`,
        onclick: () => schritt(seite, "ein"),
      },
      kann("aus") && {
        text: "Eine Ebene höher",
        onclick: () => schritt(seite, "aus"),
      },
      {
        text: "Löschen",
        gefaehrlich: true,
        onclick: () => k.beiLoeschen(z, zeileEl(seite.id)),
      },
    ]);
  }

  function schalte(id, an) {
    const zu = an ?? !zustand.zugeklappt.has(id);
    if (zu) zustand.zugeklappt.add(id);
    else zustand.zugeklappt.delete(id);
    zeichne(id);
    sage(`${nachId(id).titel} ${zu ? "zugeklappt" : "aufgeklappt"}.`);
  }

  // --- Tastatur im Baum
  function taste(e, z) {
    if (e.target !== e.currentTarget) return;
    const { seite } = z;
    const reihe = [...wurzel.querySelectorAll("[role=treeitem]")];
    const i = reihe.indexOf(e.currentTarget);
    const gehe = (ziel) => {
      if (!ziel) return;
      e.preventDefault();
      fokussiere(ziel.dataset.id);
    };
    if (aufgenommen?.id === seite.id) return tasteAufgenommen(e, seite);
    const kinder = baum.kinder.get(seite.id) ?? [];
    const zu = zustand.zugeklappt.has(seite.id) && !filtert();
    if (e.key === "ArrowDown") gehe(reihe[i + 1]);
    else if (e.key === "ArrowUp") gehe(reihe[i - 1]);
    else if (e.key === "Home") gehe(reihe[0]);
    else if (e.key === "End") gehe(reihe.at(-1));
    else if (e.key === "ArrowRight") {
      if (kinder.length > 0 && zu) {
        e.preventDefault();
        schalte(seite.id, false);
      } else if (kinder.length > 0) gehe(reihe[i + 1]);
    } else if (e.key === "ArrowLeft") {
      if (kinder.length > 0 && !zu && !filtert()) {
        e.preventDefault();
        schalte(seite.id, true);
      } else if (seite.elternId) {
        gehe(reihe.find((r) => r.dataset.id === seite.elternId));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      location.hash = `#website/seiten/${seite.id}`;
    } else if (e.key === "F2" && k.verwalten) {
      e.preventDefault();
      benenne(seite);
    } else if (e.key === "Delete" && k.verwalten) {
      e.preventDefault();
      k.beiLoeschen(z, e.currentTarget);
    } else if (e.key === " " && k.verwalten) {
      e.preventDefault();
      nimmAuf(seite);
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      const summary = e.currentTarget.querySelector("summary");
      if (summary) {
        e.preventDefault();
        summary.click();
        summary.focus();
      }
    }
  }

  // --- Verschieben mit der Tastatur: erst Vorschau im Modell, beim Ablegen ein einziger Schritt
  function nimmAuf(seite) {
    if (filtert()) {
      k.ctx.melde(
        "Lösche zuerst die Suche und den Filter, dann lässt sich der Baum ordnen.",
        "info",
      );
      return;
    }
    aufgenommen = { id: seite.id, vorher: schnappschuss(seiten()) };
    zeichne(seite.id);
    sage(
      `${stelleText(seite)} aufgenommen. Pfeil hoch und runter ordnet unter Geschwistern, Pfeil rechts macht die Seite zur Unterseite der Seite darüber, Pfeil links stellt sie auf die Ebene der Elternseite. Leertaste legt ab, Escape bricht ab.`,
    );
  }

  function tasteAufgenommen(e, seite) {
    const art = {
      ArrowUp: "hoch",
      ArrowDown: "runter",
      ArrowRight: "ein",
      ArrowLeft: "aus",
    }[e.key];
    if (art) {
      e.preventDefault();
      const ziel = zielFuer(seite, art);
      if (!ziel) {
        const grund = ziel === null ? grundFuer(seite, art) : null;
        if (grund) sage(grund);
        return;
      }
      const { aenderungen } = plane(seiten(), seite, ziel.elternId, ziel.index);
      wendeAn(seiten(), aenderungen);
      zeichne(seite.id);
      sage(stelleText(nachId(seite.id)));
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      legeAb(seite);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stelleHer(seiten(), aufgenommen.vorher);
      aufgenommen = null;
      zeichne(seite.id);
      sage("Abgebrochen. Die Seite steht wieder an ihrem Platz.");
    }
  }

  function legeAb(seite) {
    const { vorher } = aufgenommen;
    aufgenommen = null;
    const s = nachId(seite.id);
    const elternId = s.elternId;
    const index = geschwister(seiten(), elternId, s.id).filter(
      (x) => x.reihenfolge < s.reihenfolge,
    ).length;
    stelleHer(seiten(), vorher);
    zeichne(seite.id);
    verschiebe(nachId(seite.id), elternId, index);
  }

  // «Position 2 von 4 unter «Über uns»»
  function stelleText(seite) {
    const reihe = geschwister(seiten(), seite.elternId);
    const eltern = seite.elternId ? nachId(seite.elternId) : null;
    return `«${seite.titel}», Position ${reihe.findIndex((x) => x.id === seite.id) + 1} von ${reihe.length}, ${eltern ? `unter «${eltern.titel}»` : "oberste Ebene"}`;
  }

  // --- Ziele eines Schritts: { elternId, index } oder null
  function zielFuer(seite, art) {
    const s = nachId(seite.id) ?? seite;
    const reihe = geschwister(seiten(), s.elternId);
    const i = reihe.findIndex((x) => x.id === s.id);
    let ziel = null;
    if (art === "hoch" && i > 0) ziel = { elternId: s.elternId, index: i - 1 };
    else if (art === "runter" && i < reihe.length - 1)
      ziel = { elternId: s.elternId, index: i + 1 };
    else if (art === "ein" && i > 0)
      ziel = { elternId: reihe[i - 1].id, index: Infinity };
    else if (art === "aus" && s.elternId) {
      const eltern = nachId(s.elternId);
      const tante = geschwister(seiten(), eltern.elternId, s.id);
      ziel = {
        elternId: eltern.elternId,
        index: tante.findIndex((x) => x.id === eltern.id) + 1,
      };
    }
    if (ziel && ablehnung(baum, s, ziel.elternId)) return null;
    return ziel;
  }
  function grundFuer(seite, art) {
    const s = nachId(seite.id) ?? seite;
    const reihe = geschwister(seiten(), s.elternId);
    const i = reihe.findIndex((x) => x.id === s.id);
    if (art === "hoch" && i === 0) return "Die Seite steht schon ganz oben.";
    if (art === "runter") return "Die Seite steht schon ganz unten.";
    if (art === "ein" && i === 0)
      return "Es gibt keine Seite darüber, unter die sie passt.";
    if (art === "ein")
      return ablehnung(baum, s, reihe[i - 1].id) ?? "Das geht nicht.";
    if (art === "aus") return "Die Seite steht schon auf der obersten Ebene.";
    return null;
  }
  function schritt(seite, art) {
    const ziel = zielFuer(seite, art);
    if (!ziel) {
      k.ctx.melde(grundFuer(seite, art) ?? "Das geht nicht.", "info");
      return;
    }
    verschiebe(nachId(seite.id), ziel.elternId, ziel.index);
  }

  // --- Das Verschieben selbst: sofort im Modell, nach der Frist beim Server
  async function verschiebe(seite, elternId, index) {
    const grund = ablehnung(baum, seite, elternId);
    if (grund) {
      k.ctx.melde(grund, "info");
      return;
    }
    const plan = plane(seiten(), seite, elternId, index);
    if (plan.aenderungen.length === 0) return;
    // Zwei Verschiebungen nacheinander bauen aufeinander auf: die erste läuft jetzt
    if (offen && offen.phase === "wartet") await steuerung.schliesse(offen);
    const vorher = schnappschuss(seiten());
    const alt = seiten().map((s) => ({ ...s }));
    const eltern = elternId ? nachId(elternId) : null;
    offen = k.ctx.mitRueckgaengig({
      text: `«${kuerze(seite.titel, 40)}» verschoben, ${eltern ? `unter «${kuerze(eltern.titel, 40)}»` : "auf die oberste Ebene"}`,
      ansicht: {
        weg: () => {
          wendeAn(seiten(), plan.aenderungen);
          zeichne(seite.id);
          sage(stelleText(nachId(seite.id)));
        },
        zurueck: () => {
          stelleHer(seiten(), vorher);
          zeichne(seite.id);
        },
      },
      // Die Seite selbst steht zuerst: Scheitert sie, ist noch nichts verändert
      ausfuehren: async () => {
        for (const a of plan.aenderungen) await patch(a.id, koerper(a));
      },
      fehlertext: k.seitenFehler,
      danach: () => adressHinweis(alt, seite.id),
    });
  }

  function adressHinweis(alt, id) {
    weiterleitungsHinweis(
      k.ctx,
      geaenderteAdressen(alt, seiten()),
      nachId(id).titel,
    );
  }

  // --- Ziehen mit Maus, Finger und Stift am Griff
  function ziehe(e, seite) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const griff = e.currentTarget;
    griff.setPointerCapture?.(e.pointerId);
    const row = zeileEl(seite.id);
    row.classList.add("wird-gezogen");
    wurzel.classList.add("ws-zieht");
    let ziel = null; // { elternId, index, zeile, zone, grund }
    let y = e.clientY;
    let lauf = true;
    const aufraeumen = () => {
      for (const r of wurzel.querySelectorAll(
        ".ws-ziel-vor, .ws-ziel-in, .ws-ziel-nach, .ws-ziel-nein",
      )) {
        r.classList.remove(
          "ws-ziel-vor",
          "ws-ziel-in",
          "ws-ziel-nach",
          "ws-ziel-nein",
        );
      }
    };
    const bewegt = (ev) => {
      y = ev.clientY;
      aufraeumen();
      ziel = null;
      const t = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest?.("[role=treeitem]");
      if (!t || t === row || !wurzel.contains(t)) return;
      const r = t.getBoundingClientRect();
      const bruch = (ev.clientY - r.top) / r.height;
      const zone = bruch < 0.28 ? "vor" : bruch > 0.72 ? "nach" : "in";
      const s = nachId(t.dataset.id);
      let elternId;
      let index;
      if (zone === "in") {
        elternId = s.id;
        index = Infinity;
      } else {
        elternId = s.elternId;
        const reihe = geschwister(seiten(), elternId, seite.id);
        index =
          reihe.findIndex((x) => x.id === s.id) + (zone === "nach" ? 1 : 0);
      }
      const grund = ablehnung(baum, nachId(seite.id), elternId);
      ziel = { elternId, index, zone, grund };
      t.classList.add(grund ? "ws-ziel-nein" : `ws-ziel-${zone}`);
    };
    // Nahe am Rand scrollt die Seite mit
    const scrolle = () => {
      if (!lauf) return;
      if (y < 90) window.scrollBy(0, -14);
      else if (y > window.innerHeight - 90) window.scrollBy(0, 14);
      window.requestAnimationFrame(scrolle);
    };
    window.requestAnimationFrame(scrolle);
    const fertig = (ev) => {
      lauf = false;
      griff.removeEventListener("pointermove", bewegt);
      griff.removeEventListener("pointerup", fertig);
      griff.removeEventListener("pointercancel", fertig);
      aufraeumen();
      row.classList.remove("wird-gezogen");
      wurzel.classList.remove("ws-zieht");
      if (ev.type === "pointercancel" || !ziel) return;
      if (ziel.grund) {
        k.ctx.melde(ziel.grund, "info");
        return;
      }
      verschiebe(nachId(seite.id), ziel.elternId, ziel.index);
    };
    griff.addEventListener("pointermove", bewegt);
    griff.addEventListener("pointerup", fertig);
    griff.addEventListener("pointercancel", fertig);
  }

  // --- Umbenennen am Ort (F2)
  function benenne(seite) {
    const row = zeileEl(seite.id);
    const link = row?.querySelector(".ws-name");
    if (!link || row.querySelector(".ws-umbenennen")) return;
    const eingabe = el("input", {
      class: "eingabe ws-umbenennen",
      type: "text",
      value: seite.titel,
      maxlength: "150",
      "aria-label": `Neuer Titel für «${seite.titel}». Enter speichert, Escape bricht ab.`,
      autocomplete: "off",
    });
    let fertig = false;
    const zurueck = () => {
      fertig = true;
      zeichne(seite.id);
    };
    const speichere = async () => {
      const titel = eingabe.value.trim();
      if (titel === seite.titel || !titel) return zurueck();
      eingabe.setAttribute("aria-busy", "true");
      try {
        await patch(seite.id, { titel });
        nachId(seite.id).titel = titel;
        fertig = true;
        zeichne(seite.id);
        sage(`Der Titel ist jetzt «${titel}».`);
      } catch (f) {
        eingabe.removeAttribute("aria-busy");
        fertig = false;
        k.ctx.melde(k.seitenFehler(f), "fehler");
        eingabe.focus();
      }
    };
    eingabe.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        speichere();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        zurueck();
      }
    });
    eingabe.addEventListener("blur", () => {
      if (!fertig) window.setTimeout(() => !fertig && speichere(), 0);
    });
    link.replaceWith(eingabe);
    eingabe.focus();
    eingabe.select();
  }

  zeichne();
  const alle = el("div", { class: "ws-baumhuelle" }, hinweis, wurzel, ansage);
  return {
    wurzel: alle,
    zeichne,
    // ids: Set der sichtbaren Seiten (Treffer und ihre Elternseiten) oder null
    filtere(ids, treffer) {
      sichtbar = ids;
      k.treffer = treffer ?? new Set();
      zeichne();
    },
    // Löscht eine Seite aus dem Modell (nach dem Löschen oder zum Ausblenden)
    blendeAus: (id) => ansichtVon(zeileEl(id)),
    zeileEl,
    zeichneNeu: zeichne,
  };
}

// Die Adresse einer Seite und ihrer Unterseiten hat sich geändert: Alte Links führen ins Leere, wenn niemand weiterleitet.
// aenderungen: [{ alt, neu }] (nur veröffentlichte Seiten). Mit dem Recht «Weiterleitungen verwalten» bietet die Meldung den Schritt an
export function weiterleitungsHinweis(ctx, aenderungen, titel) {
  const n = aenderungen.length;
  if (n === 0) return;
  const text = `Die Adresse von «${kuerze(titel, 40)}»${n > 1 ? ` und ${anzahlText(n - 1, "1 Unterseite", "Unterseiten")}` : ""} hat sich geändert. Wer den alten Link nutzt, sieht «Diese Seite gibt es nicht».`;
  if (!ctx.zugang.darf("weiterleitungen.verwalten")) {
    ctx.melde(
      `${text} Die Abteilungsleitung kann Weiterleitungen anlegen.`,
      "warn",
    );
    return;
  }
  ctx.melde(text, "warn", {
    text: n > 1 ? "Weiterleitungen anlegen" : "Weiterleitung anlegen",
    onclick: async () => {
      const fehler = [];
      for (const a of aenderungen) {
        try {
          await anfrage("POST", `${API}/weiterleitungen`, {
            alterPfad: a.alt,
            zielPfad: a.neu,
          });
        } catch (f) {
          fehler.push(f?.meldung ?? "Das hat nicht geklappt.");
        }
      }
      const ok = n - fehler.length;
      ctx.melde(
        fehler.length === 0
          ? `${anzahlText(n, "1 Weiterleitung ist", "Weiterleitungen sind")} angelegt.`
          : ok === 0
            ? `Keine Weiterleitung angelegt. ${fehler[0]}`
            : `${anzahlText(ok, "1 Weiterleitung ist", "Weiterleitungen sind")} angelegt. ${fehler[0]}`,
        fehler.length === 0 ? "ok" : "warn",
      );
    },
  });
}
