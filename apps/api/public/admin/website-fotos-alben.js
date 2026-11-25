import { anfrage, fehlertext } from "./api.js";
import {
  auswahl,
  el,
  feld,
  filterGruppe,
  icon,
  knopf,
  menue,
  neueId,
} from "./dom.js";
import { sortierListe } from "./sortieren.js";
import { band } from "./website-dialoge.js";
import * as L from "./website-fotos-logik.js";
import { leerKarte } from "./zustaende.js";

// Fotos, die Albumliste (#794): bei 5 wie bei 300 Alben schnell zu bedienen.
// Zwei Bereiche: «Auf der Website» (nur die sichtbaren, in ihrer Reihenfolge; nur hier lässt sie sich ordnen) und «Weitere Alben bei Flickr» (nach Jahr gruppiert, schrittweise gebaut). Werkzeugleiste mit Suche, Sicht, Jahr und Sortierung; Auswahl und Sammelaktionen. Das Rechnen steht in website-fotos-logik.js.
// Speichern: Zeigen und Ausblenden gehen immer über PUT /alben/sichtbarkeit (ein Album oder viele, alles oder nichts, Version je Album); die Ansicht ändert sich sofort und fällt bei einem Fehler zurück. Die Reihenfolge speichert sortierListe nach der Frist des Rückgängig.
const API = "/api/v1/admin/fotos";
const MAX_TITEL = 120;
const KONFLIKT = "Jemand anders hat das gerade geändert. Die Seite lädt neu.";

// Die Werkzeuge bleiben, wenn man die Seite verlässt und zurückkommt (die Ansicht hält ihren Zustand selbst)
const gemerkt = { frage: "", sicht: "alle", jahr: "", sortierung: "neu" };

export function albenBereich(ctx, daten, neuLaden) {
  const alben = daten.alben.map((a) => ({ ...a }));
  const nachId = new Map(alben.map((a) => [a.id, a]));
  const filter = {
    frage: gemerkt.frage,
    sicht: gemerkt.sicht,
    jahr: L.jahre(alben).includes(gemerkt.jahr) ? gemerkt.jahr : "",
  };
  let sortierung = gemerkt.sortierung;
  const gewaehlt = new Set();
  const offeneJahre = new Map(); // Gruppe -> Wahl der Person (true offen, false zu)
  const beschaeftigt = new Set(); // Alben, deren Änderung gerade unterwegs ist
  let limit = L.SCHRITT;
  let bestaetigung = null; // { ziele } bei mehr als 5 Alben zum Zeigen

  const zahlText = (n, gesamt) =>
    n === gesamt ? String(n) : `${n} von ${gesamt}`;
  // replaceChildren machte aus false den Text «false»
  const fuelle = (knoten, ...kinder) =>
    knoten.replaceChildren(...kinder.filter(Boolean));
  const titelVon = (a) => L.albumTitel(a) || "Ohne Titel";

  // ---------- Reihenfolge der sichtbaren Alben (sortierListe hält sie) ----------
  const reihe = sortierListe({
    beschriftung: "Alben der Website",
    eintraege: [],
    aktionstext: "Reihenfolge der Alben geändert",
    mitRueckgaengig: ctx.mitRueckgaengig,
    beiNeu: (ids) => anfrage("PUT", `${API}/alben/reihenfolge`, { ids }),
  });
  const eintrag = (id) => {
    const a = nachId.get(id);
    return { id, text: titelVon(a), inhalt: zeile(a) };
  };

  // ---------- Werkzeugleiste ----------
  const sucheId = neueId("foto-suche");
  const suche = el("input", {
    class: "eingabe",
    id: sucheId,
    type: "search",
    placeholder: "Album suchen",
    autocomplete: "off",
    spellcheck: "false",
    "aria-keyshortcuts": "/",
    oninput: () => {
      filter.frage = suche.value;
      limit = L.SCHRITT;
      zeichne();
    },
  });
  suche.value = filter.frage;
  const sucheFeld = el(
    "div",
    { class: "suche foto-suche" },
    el("label", { class: "nur-leser", for: sucheId }, "Album suchen"),
    icon("lupe"),
    suche,
  );
  // Das Auswahlfeld findet sein Label nicht, solange es ausserhalb der Seite gebaut wird: Name und Liste bekommen es hier
  const benenne = (f) => {
    const id = f.wurzel.querySelector("label")?.id;
    for (const k of f.wurzel.querySelectorAll(".aw-knopf, .aw-liste")) {
      if (id && !k.hasAttribute("aria-labelledby")) {
        k.setAttribute("aria-labelledby", id);
      }
    }
  };
  const sicht = filterGruppe({
    beschriftung: "Anzeigen",
    eintraege: [
      { text: "Alle", wert: "alle", n: 0 },
      { text: "Sichtbar", wert: "sichtbar", n: 0 },
      { text: "Nicht sichtbar", wert: "nicht", n: 0 },
    ],
    wert: filter.sicht,
    beiAenderung: (wert) => {
      filter.sicht = wert;
      limit = L.SCHRITT;
      zeichne();
    },
  });
  const jahrFeld = auswahl({
    label: "Jahr",
    optionen: [
      ["", "Alle Jahre"],
      ...L.jahre(alben).map((j) => [j, j === L.OHNE_DATUM ? "Ohne Datum" : j]),
    ],
    wert: filter.jahr,
  });
  benenne(jahrFeld);
  jahrFeld.eingabe.addEventListener("change", () => {
    filter.jahr = jahrFeld.eingabe.value;
    limit = L.SCHRITT;
    zeichne();
  });
  const sortFeld = auswahl({
    label: "Sortierung",
    optionen: L.SORTIERUNGEN,
    wert: sortierung,
  });
  benenne(sortFeld);
  sortFeld.eingabe.addEventListener("change", () => {
    sortierung = sortFeld.eingabe.value;
    limit = L.SCHRITT;
    zeichne();
  });
  const treffer = el("p", { class: "foto-treffer meta", role: "status" });
  const zuruecksetzen = knopf("Filter zurücksetzen", {
    klein: true,
    art: "still",
    symbol: "schliessen",
    onclick: () => {
      setzeFilterZurueck();
      suche.focus();
    },
  });
  function setzeFilterZurueck() {
    filter.frage = "";
    filter.sicht = "alle";
    filter.jahr = "";
    suche.value = "";
    sicht.setze("alle");
    jahrFeld.eingabe.value = "";
    jahrFeld.eingabe.dispatchEvent(new Event("change"));
  }
  const werkzeuge = el(
    "div",
    {
      class: "foto-werkzeuge",
      role: "search",
      "aria-label": "Alben suchen und filtern",
    },
    el(
      "div",
      { class: "foto-werkzeuge-zeile" },
      sucheFeld,
      sicht.wurzel,
      el("div", { class: "foto-feld foto-feld--jahr" }, jahrFeld.wurzel),
      el("div", { class: "foto-feld foto-feld--sort" }, sortFeld.wurzel),
    ),
    el("div", { class: "foto-werkzeuge-fuss" }, treffer, zuruecksetzen),
  );

  // «/» springt in die Suche, solange die Seite steht
  function schraegstrich(e) {
    if (!suche.isConnected) {
      document.removeEventListener("keydown", schraegstrich);
      return;
    }
    const ziel = e.target;
    const tippt =
      ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName);
    if (e.key === "/" && !tippt && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      suche.focus();
    }
  }
  document.addEventListener("keydown", schraegstrich);

  // ---------- Bereiche ----------
  const titel1 = el("h2", { id: "foto-bereich-web", tabindex: "-1" });
  const titel2 = el("h2", { id: "foto-bereich-weitere", tabindex: "-1" });
  const kopf1 = el("div", { class: "foto-bereich-kopf" });
  const kopf2 = el("div", { class: "foto-bereich-kopf" });
  const hilfe1 = el("p", { class: "foto-hilfe meta" });
  const hilfe2 = el("p", { class: "foto-hilfe meta" });
  const inhalt1 = el("div", { class: "foto-inhalt" });
  const inhalt2 = el("div", { class: "foto-inhalt" });
  const bereich1 = el(
    "section",
    { class: "flaeche foto-bereich", "aria-labelledby": titel1.id },
    kopf1,
    hilfe1,
    inhalt1,
  );
  const bereich2 = el(
    "section",
    { class: "flaeche foto-bereich", "aria-labelledby": titel2.id },
    kopf2,
    hilfe2,
    inhalt2,
  );
  const bereiche = el("div", { class: "foto-bereiche" }, bereich1, bereich2);
  const keinTreffer = el("div", { class: "foto-kein-treffer" });
  const auswahlLeiste = el("div", {
    class: "auswahlleiste foto-auswahl",
    role: "region",
    "aria-label": "Auswahl",
    hidden: true,
  });

  const wurzel = el(
    "div",
    { class: "foto-alben" },
    werkzeuge,
    bereiche,
    keinTreffer,
    auswahlLeiste,
  );

  // ---------- Was gerade gilt ----------
  const mitFrage = () => filter.frage.trim() !== "" || filter.jahr !== "";
  const aktiv = () => mitFrage() || filter.sicht !== "alle";
  const kandidaten = () => L.filtere(alben, { ...filter, sicht: "alle" });
  function ansicht() {
    const k = kandidaten();
    const web = filter.sicht === "nicht" ? [] : k.filter((a) => a.sichtbar);
    const reihenfolge = new Map(reihe.ids().map((id, i) => [id, i]));
    web.sort((a, b) => reihenfolge.get(a.id) - reihenfolge.get(b.id));
    const weitere =
      filter.sicht === "sichtbar"
        ? []
        : L.sortiere(
            k.filter((a) => !a.sichtbar),
            sortierung,
          );
    return { web, weitere };
  }

  // ---------- Zeichnen ----------
  // ordnung: die Reihenfolge der sichtbaren Alben; ohne Angabe die jetzige. fokus: Funktion, die nach dem Zeichnen den Fokus setzt
  function zeichne(ordnung, fokus) {
    gemerkt.frage = filter.frage;
    gemerkt.sicht = filter.sicht;
    gemerkt.jahr = filter.jahr;
    gemerkt.sortierung = sortierung;
    const aktuelle = ordnung ?? reihe.ids();
    const sichtbarIds = new Set(
      alben.filter((a) => a.sichtbar).map((a) => a.id),
    );
    const geordnet = [
      ...aktuelle.filter((id) => sichtbarIds.has(id)),
      ...alben
        .filter((a) => a.sichtbar && !aktuelle.includes(a.id))
        .map((a) => a.id),
    ];
    reihe.setze(geordnet.map(eintrag));

    const { web, weitere } = ansicht();
    // Was nicht mehr angezeigt wird, bleibt nicht ausgewählt
    const gezeigt = new Set([...web, ...weitere].map((a) => a.id));
    for (const id of [...gewaehlt]) if (!gezeigt.has(id)) gewaehlt.delete(id);

    // Zähler
    const zahlen = L.zaehleSicht(alben, filter);
    const zeigeN = sicht.wurzel.querySelectorAll(".n");
    [zahlen.alle, zahlen.sichtbar, zahlen.nicht].forEach((n, i) => {
      if (zeigeN[i]) zeigeN[i].textContent = String(n);
    });
    treffer.textContent = L.zaehlText(
      web.length + weitere.length,
      alben.length,
    );
    zuruecksetzen.hidden = !aktiv();

    const leer = web.length + weitere.length === 0;
    bereiche.hidden = leer;
    keinTreffer.hidden = !leer;
    keinTreffer.replaceChildren(leer ? keinTrefferKarte() : "");
    bereiche.classList.toggle("foto-bereiche--eins", filter.sicht !== "alle");
    bereich1.hidden = filter.sicht === "nicht";
    bereich2.hidden = filter.sicht === "sichtbar";

    zeichneWeb(web);
    zeichneWeitere(weitere);
    zeichneAuswahl();
    fokus?.();
  }

  function keinTrefferKarte() {
    const mitSuche = filter.frage.trim() !== "";
    return leerKarte(
      mitSuche
        ? `Kein Album passt zu «${filter.frage.trim()}».`
        : "Kein Album passt zu den Filtern.",
      [
        knopf(mitSuche ? "Suche zurücksetzen" : "Filter zurücksetzen", {
          onclick: () => {
            setzeFilterZurueck();
            suche.focus();
          },
        }),
      ],
    );
  }

  const alleBox = (liste, beschriftung) => {
    if (liste.length === 0) return false;
    const box = el("input", {
      type: "checkbox",
      onchange: () => {
        for (const a of liste) {
          if (box.checked) gewaehlt.add(a.id);
          else gewaehlt.delete(a.id);
        }
        spiegleAuswahl();
        zeichneAuswahl();
      },
    });
    box.checked = liste.every((a) => gewaehlt.has(a.id));
    box.indeterminate = !box.checked && liste.some((a) => gewaehlt.has(a.id));
    box.dataset.alle = "";
    box.dataset.ids = liste.map((a) => a.id).join(" ");
    return el(
      "label",
      { class: "foto-alle" },
      box,
      el("span", {}, beschriftung),
    );
  };

  function zeichneWeb(web) {
    const gesamt = alben.filter((a) => a.sichtbar).length;
    titel1.replaceChildren(
      "Auf der Website ",
      el("span", { class: "foto-zahl" }, zahlText(web.length, gesamt)),
    );
    fuelle(kopf1, titel1, alleBox(web, `Alle ${web.length} auswählen`));
    // Geordnet wird nur ohne Suche und Jahr: Sonst wüsste niemand, wohin ein Album in der ganzen Reihe käme
    const ordnen = !mitFrage() && filter.sicht !== "nicht";
    hilfe1.textContent = ordnen
      ? "Die Website zeigt die Alben in dieser Reihenfolge. Ordne per Ziehen oder mit den Pfeilen."
      : "Zum Ordnen setze Suche und Jahr zurück.";
    if (gesamt === 0) {
      inhalt1.replaceChildren(
        el(
          "p",
          { class: "foto-leer" },
          "Noch kein Album auf der Website. Zeige ein Album aus den weiteren Alben.",
        ),
      );
    } else if (web.length === 0) {
      inhalt1.replaceChildren(
        el("p", { class: "foto-leer" }, "Kein sichtbares Album passt."),
      );
    } else if (ordnen) {
      inhalt1.replaceChildren(reihe.wurzel);
    } else {
      inhalt1.replaceChildren(
        el(
          "ul",
          { class: "foto-liste", "aria-label": "Alben der Website" },
          web.map((a) => el("li", { "data-id": a.id }, zeile(a))),
        ),
      );
    }
  }

  function zeichneWeitere(weitere) {
    const gesamt = alben.filter((a) => !a.sichtbar).length;
    titel2.replaceChildren(
      "Weitere Alben bei Flickr ",
      el("span", { class: "foto-zahl" }, zahlText(weitere.length, gesamt)),
    );
    fuelle(kopf2, titel2, alleBox(weitere, `Alle ${weitere.length} auswählen`));
    hilfe2.textContent =
      "Neue Alben bei Flickr bleiben unsichtbar, bis du sie zeigst. Zeige nur Alben, die Eltern und Leitende sehen dürfen: Die Fotos zeigen oft Kinder.";
    if (gesamt === 0) {
      inhalt2.replaceChildren(
        el("p", { class: "foto-leer" }, "Alle Alben sind auf der Website."),
      );
      return;
    }
    if (weitere.length === 0) {
      inhalt2.replaceChildren(
        el("p", { class: "foto-leer" }, "Kein weiteres Album passt."),
      );
      return;
    }
    const gruppen = L.gruppiere(weitere, sortierung);
    const { gruppen: teile, rest } = L.schneide(
      gruppen,
      (g, i) => {
        // Bei Suche oder Jahr stehen alle Treffer offen; sonst das neueste Jahr, und was die Person selbst geöffnet oder geschlossen hat
        if (offeneJahre.has(g.schluessel)) return offeneJahre.get(g.schluessel);
        return !g.titel || mitFrage() || i === 0;
      },
      limit,
    );
    const knoten = teile.map((g) => {
      if (!g.titel) return listeVon(g.gezeigt, "Weitere Alben bei Flickr");
      const listeId = neueId("foto-gruppe");
      return el(
        "div",
        { class: "foto-gruppe", "data-gruppe": g.schluessel },
        el(
          "h3",
          { class: "foto-gruppenkopf" },
          el(
            "button",
            {
              type: "button",
              "aria-expanded": String(g.offen),
              "aria-controls": listeId,
              onclick: () => {
                offeneJahre.set(g.schluessel, !g.offen);
                zeichne(undefined, () =>
                  inhalt2
                    .querySelector(
                      `[data-gruppe="${CSS.escape(g.schluessel)}"] button`,
                    )
                    ?.focus(),
                );
              },
            },
            icon("weiter"),
            el("span", { class: "foto-gruppenname" }, g.titel),
            el("span", { class: "meta" }, L.albenText(g.alben.length)),
          ),
        ),
        g.offen
          ? listeVon(g.gezeigt, `Alben ${g.titel}`, listeId)
          : el("ul", { id: listeId, hidden: true }),
      );
    });
    if (rest > 0) {
      const schon = new Set(teile.flatMap((g) => g.gezeigt.map((a) => a.id)));
      knoten.push(
        el(
          "div",
          { class: "foto-mehr" },
          knopf(`Weitere ${Math.min(L.SCHRITT, rest)} anzeigen`, {
            onclick: () => {
              limit += L.SCHRITT;
              zeichne(undefined, () => {
                // Der Fokus geht auf das erste neue Album, damit man dort weiterliest
                const neu = [...inhalt2.querySelectorAll("li[data-id]")].find(
                  (li) => !schon.has(li.dataset.id),
                );
                neu?.querySelector(".foto-box")?.focus();
              });
            },
          }),
          el("span", { class: "meta" }, `${rest} weitere ausgeblendet`),
        ),
      );
    }
    inhalt2.replaceChildren(...knoten);
  }

  const listeVon = (liste, name, id) =>
    el(
      "ul",
      { class: "foto-liste", id, "aria-label": name },
      liste.map((a) => el("li", { "data-id": a.id }, zeile(a))),
    );

  // ---------- Eine Zeile ----------
  function zeile(a) {
    const titel = titelVon(a);
    const box = el("input", {
      type: "checkbox",
      class: "foto-box",
      "aria-label": `Auswählen: ${titel}`,
      onchange: () => {
        if (box.checked) gewaehlt.add(a.id);
        else gewaehlt.delete(a.id);
        spiegleAuswahl();
        zeichneAuswahl();
      },
    });
    box.checked = gewaehlt.has(a.id);
    box.dataset.id = a.id;
    const schalter = el("button", {
      type: "button",
      class: "schalter",
      role: "switch",
      "aria-checked": String(a.sichtbar),
      "aria-label": `Auf der Website zeigen: ${titel}`,
      "aria-busy": beschaeftigt.has(a.id) ? "true" : undefined,
      "data-art": "schalter",
      onclick: (e) => {
        if (beschaeftigt.has(a.id)) return;
        const li = e.currentTarget.closest("li[data-id]");
        const nachbar = (li?.nextElementSibling ?? li?.previousElementSibling)
          ?.dataset.id;
        const neu = !a.sichtbar;
        // Nach dem Zeigen oder Ausblenden ist die Zeile weg: Der Fokus geht zur nächsten Zeile der Liste oder zur Überschrift
        aendere([a], neu, {
          fokus: () =>
            (nachbar &&
              wurzel.querySelector(
                `li[data-id="${CSS.escape(nachbar)}"] .schalter`,
              )) ||
            (neu ? titel2 : titel1),
        });
      },
    });
    const meta = [
      L.fotosText(a.anzahl),
      L.datumKurz(a.datum),
      a.eigenerTitel ? `Bei Flickr: «${a.titel}»` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const titelPlatz = el("div", { class: "foto-titelform" });
    titelPlatz.hidden = true;
    const mehr = menue(titel, [
      { text: "Titel ändern", onclick: () => oeffneTitel(a, titelPlatz) },
    ]);
    return el(
      "div",
      { class: "foto-zeile" },
      el("label", { class: "foto-wahl" }, box),
      el(
        "div",
        { class: "foto-info" },
        el("strong", { class: "foto-titel" }, titel),
        el("span", { class: "meta" }, meta),
      ),
      el("div", { class: "foto-aktionen" }, schalter, mehr),
      titelPlatz,
    );
  }

  // Eigener Titel: ein Feld in der Zeile, kein Fenster
  function oeffneTitel(a, platz) {
    const f = feld({
      label: "Eigener Titel",
      wert: a.eigenerTitel ?? "",
      maxlength: MAX_TITEL,
      autocomplete: "off",
      hilfe: `Leer lassen, dann gilt der Titel von Flickr: «${a.titel}».`,
    });
    const sichern = knopf("Speichern", { art: "haupt", klein: true });
    sichern.type = "submit";
    const fehler = el("div");
    const zumMehr = () =>
      wurzel
        .querySelector(`li[data-id="${CSS.escape(a.id)}"] .menue > summary`)
        ?.focus();
    const schliesse = () => {
      platz.hidden = true;
      platz.replaceChildren();
      zumMehr();
    };
    const form = el(
      "form",
      { class: "formular", novalidate: true },
      f.wurzel,
      fehler,
      el(
        "div",
        { class: "foto-titelknoepfe" },
        sichern,
        knopf("Abbrechen", { klein: true, onclick: schliesse }),
      ),
    );
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        schliesse();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const wert = f.eingabe.value.trim();
      sichern.disabled = true;
      try {
        const r = await anfrage("PUT", `${API}/alben/${a.id}`, {
          titel: wert === "" ? null : wert,
          version: a.version,
        });
        a.version = r.version;
        a.eigenerTitel = wert === "" ? null : wert;
        zeichne(undefined, zumMehr);
        ctx.melde("Der Titel ist gespeichert.", "ok");
      } catch (g) {
        if (g?.code === "VERSION_KONFLIKT") {
          ctx.melde(KONFLIKT, "warn");
          neuLaden();
        } else {
          fehler.replaceChildren(
            band("fehler", `Das hat nicht geklappt. ${fehlertext(g)}`.trim()),
          );
        }
      } finally {
        sichern.disabled = false;
      }
    });
    platz.replaceChildren(form);
    platz.hidden = false;
    f.eingabe.focus();
  }

  // ---------- Zeigen und Ausblenden ----------
  // Ändert die Ansicht sofort und speichert in einer Anfrage (alles oder nichts); bei einem Fehler steht alles wie vorher
  async function aendere(ziele, sichtbar, { fokus, still } = {}) {
    if (ziele.some((a) => beschaeftigt.has(a.id))) return false;
    const vorherOrdnung = reihe.ids();
    const ids = new Set(ziele.map((a) => a.id));
    const neueOrdnung = sichtbar
      ? [
          ...vorherOrdnung.filter((id) => !ids.has(id)),
          ...ziele.map((a) => a.id),
        ]
      : vorherOrdnung.filter((id) => !ids.has(id));
    for (const a of ziele) {
      a.sichtbar = sichtbar;
      beschaeftigt.add(a.id);
    }
    zeichne(neueOrdnung, () => {
      const ziel = fokus?.();
      ziel?.focus();
    });
    try {
      const r = await anfrage("PUT", `${API}/alben/sichtbarkeit`, {
        sichtbar,
        alben: ziele.map((a) => ({ id: a.id, version: a.version })),
      });
      for (const x of r.alben) {
        const a = nachId.get(x.id);
        if (a) a.version = x.version;
      }
    } catch (f) {
      for (const a of ziele) a.sichtbar = !sichtbar;
      zeichne(vorherOrdnung);
      if (f?.code === "VERSION_KONFLIKT") {
        ctx.melde(KONFLIKT, "warn");
        neuLaden();
      } else {
        ctx.melde(
          `Das hat nicht geklappt. Es wurde nichts geändert. ${fehlertext(f)}`.trim(),
          "fehler",
        );
      }
      return false;
    } finally {
      for (const a of ziele) beschaeftigt.delete(a.id);
    }
    // Die Zeilen sind nicht mehr unterwegs; neu gezeichnet wird nicht, damit der Fokus bleibt
    for (const a of ziele) {
      wurzel
        .querySelector(`li[data-id="${CSS.escape(a.id)}"] .schalter`)
        ?.removeAttribute("aria-busy");
    }
    if (!still) {
      const text =
        ziele.length === 1
          ? sichtbar
            ? `«${titelVon(ziele[0])}» ist jetzt auf der Website zu sehen.`
            : `«${titelVon(ziele[0])}» ist ausgeblendet.`
          : L.sammelText(ziele.length, sichtbar);
      ctx.melde(text, "ok", {
        text: "Rückgängig",
        onclick: () => macheRueckgaengig(ziele, sichtbar, vorherOrdnung),
      });
    }
    return true;
  }

  // Zurück auf den Stand davor; ein ausgeblendetes Album kehrt an seinen Platz zurück
  async function macheRueckgaengig(ziele, sichtbar, vorherOrdnung) {
    const noch = ziele.filter((a) => a.sichtbar === sichtbar);
    if (noch.length === 0) return;
    if (!(await aendere(noch, !sichtbar, { still: true }))) return;
    if (!sichtbar) {
      const ids = vorherOrdnung.filter((id) => nachId.get(id)?.sichtbar);
      try {
        await anfrage("PUT", `${API}/alben/reihenfolge`, { ids });
        zeichne(ids);
      } catch (f) {
        ctx.melde(
          `Die Reihenfolge ist nicht wie vorher. ${fehlertext(f)}`.trim(),
          "warn",
        );
      }
    }
    ctx.melde("Rückgängig gemacht.", "ok");
  }

  // ---------- Auswahl ----------
  // Die Kästchen der Zeilen und der Köpfe folgen der Auswahl, ohne die Listen neu zu bauen
  function spiegleAuswahl() {
    for (const b of wurzel.querySelectorAll("input.foto-box")) {
      b.checked = gewaehlt.has(b.dataset.id);
    }
    for (const b of wurzel.querySelectorAll("input[data-alle]")) {
      const ids = b.dataset.ids.split(" ");
      b.checked = ids.every((id) => gewaehlt.has(id));
      b.indeterminate = !b.checked && ids.some((id) => gewaehlt.has(id));
    }
  }

  function zeichneAuswahl() {
    auswahlLeiste.hidden = gewaehlt.size === 0;
    if (gewaehlt.size === 0) {
      bestaetigung = null;
      auswahlLeiste.replaceChildren();
      return;
    }
    const gewaehlteAlben = [...gewaehlt].map((id) => nachId.get(id));
    const { web, weitere } = ansicht();
    const zuZeigen = L.zuAendern(weitere, gewaehlt, true);
    const zuVerstecken = L.zuAendern(web, gewaehlt, false);
    const zeigen =
      zuZeigen.length > 0 &&
      knopf(`Auf der Website zeigen (${zuZeigen.length})`, {
        klein: true,
        onclick: () => {
          if (L.brauchtBestaetigung(zuZeigen.length)) {
            bestaetigung = { ziele: zuZeigen };
            zeichneAuswahl();
            auswahlLeiste.querySelector("[data-bestaetigen]")?.focus();
          } else {
            sammel(zuZeigen, true);
          }
        },
      });
    const verstecken =
      zuVerstecken.length > 0 &&
      knopf(`Ausblenden (${zuVerstecken.length})`, {
        klein: true,
        onclick: () => sammel(zuVerstecken, false),
      });
    const zeileKnoepfe = el(
      "div",
      { class: "auswahlleiste-zeile" },
      el(
        "span",
        { role: "status", class: "auswahl-zahl" },
        `${gewaehlteAlben.length} ausgewählt`,
      ),
      zeigen,
      verstecken,
      knopf("Auswahl aufheben", {
        klein: true,
        art: "still",
        onclick: () => {
          gewaehlt.clear();
          bestaetigung = null;
          spiegleAuswahl();
          zeichneAuswahl();
          suche.focus();
        },
      }),
    );
    // Mehr als 5 Alben auf einmal zu zeigen verlangt eine Bestätigung in der Leiste, kein Fenster
    const frage =
      bestaetigung &&
      el(
        "div",
        { class: "auswahlleiste-formular" },
        el(
          "p",
          {},
          `${L.albenText(bestaetigung.ziele.length)} auf der Website zeigen? Alle angemeldeten Eltern und Leitenden sehen diese Fotos, oft mit Kindern. Zeige nur Alben, für die die Einwilligung der Eltern vorliegt.`,
        ),
        el(
          "div",
          { class: "aktionen" },
          knopf(`${L.albenText(bestaetigung.ziele.length)} zeigen`, {
            art: "haupt",
            klein: true,
            "data-bestaetigen": "",
            onclick: () => sammel(bestaetigung.ziele, true, true),
          }),
          knopf("Abbrechen", {
            klein: true,
            art: "still",
            onclick: () => {
              bestaetigung = null;
              zeichneAuswahl();
              auswahlLeiste.querySelector("button")?.focus();
            },
          }),
        ),
      );
    fuelle(auswahlLeiste, zeileKnoepfe, frage);
  }

  async function sammel(ziele, sichtbar, bestaetigt = false) {
    if (sichtbar && !bestaetigt && L.brauchtBestaetigung(ziele.length)) return;
    // Die Auswahl gilt für diese Aktion; misslingt sie, kommt sie zurück
    const merk = new Set(gewaehlt);
    gewaehlt.clear();
    bestaetigung = null;
    // Nach der Aktion ist die Leiste weg: Der Fokus geht in den Bereich, den die Aktion betrifft
    const ok = await aendere(ziele, sichtbar, {
      fokus: () =>
        (sichtbar ? bereich2 : bereich1).querySelector("input[data-alle]") ??
        suche,
    });
    if (!ok) {
      for (const id of merk) gewaehlt.add(id);
      spiegleAuswahl();
      zeichneAuswahl();
    }
  }

  zeichne(alben.filter((a) => a.sichtbar).map((a) => a.id));
  return { wurzel };
}
