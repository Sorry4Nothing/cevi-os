import { anfrage, fehlertext } from "./api.js";
import { chip, el, feld, icon, knopf } from "./dom.js";
import { kandidatenSuche, personZeile } from "./personen-wahl.js";
import { zweistufig } from "./rueckgaengig.js";
import { rechteIm, gruppiereKatalog, setzeRecht } from "./rechte-logik.js";
import {
  adresse,
  bestaetigeAmOrt,
  kandidatVon,
  merkeMeldung,
  personen,
  zurueckLink,
  haenge,
} from "./rechte-gemeinsam.js";
import { leerKarte } from "./zustaende.js";

// Reiter «Rollen» (#623): Plattformrollen wie «Webmaster». Quelle und Ziel ist /api/v1/admin/plattform/rollen; neue Rechte gibt es hier nicht, die Rechte stammen aus dem Katalog des Servers.
// Zwei Wege zum selben Entwurf: die Matrix (Übersicht, ab 48 rem) und die Seite der Rolle (der Hauptweg, auch mobil und bei 200 % Zoom). Beide ändern dieselbe Menge und sehen einander.

const BASIS = "/api/v1/admin/plattform/rollen";

export function zeigeRollen(inhalt, z, pfad) {
  if (pfad[0] === "rolle" && pfad[1] === "neu")
    return zeigeNeueRolle(inhalt, z);
  if (pfad[0] === "rolle") return zeigeRolle(inhalt, z, pfad[1]);
  zeigeUebersicht(inhalt, z);
}

const gruppen = (z) => gruppiereKatalog(z.daten.katalog);
const alleErweitert = (z) => z.daten.katalog.every((k) => k.erweitert);

// Die Stufen-Zeile unter dem Namen einer Rolle: «3 Personen · 6 von 7 Rechten»
const zusammenfassung = (z, rolle) =>
  `${personen(rolle.personen.length)} · ${rechteIm(rolle, z.entwurf).size} von ${z.daten.katalog.length} Rechten`;

// ---------- Übersicht: Matrix und Karten ----------

function zeigeUebersicht(inhalt, z) {
  const { ctx, daten } = z;
  ctx.kopfAktion(
    knopf("Neue Rolle", {
      art: "haupt",
      symbol: "plus",
      onclick: () => (location.hash = adresse("rolle", "neu")),
    }),
  );
  if (daten.rollen.length === 0) {
    haenge(
      inhalt,
      leerKarte("Es gibt noch keine Rolle. Lege die erste an.", [
        knopf("Neue Rolle", {
          art: "haupt",
          symbol: "plus",
          onclick: () => (location.hash = adresse("rolle", "neu")),
        }),
      ]),
    );
    return;
  }
  haenge(
    inhalt,
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Eine Rolle bündelt Rechte der Website, zum Beispiel «Webmaster». Du weist sie einzelnen Personen zu. Die Abteilungsleitung braucht keine Rolle: Sie hat immer alles.",
    ),
    matrix(z),
    karten(z),
  );
}

// Die Matrix: Rechte (Zeilen) mal Rollen (Spalten). Jede Zelle ist ein echtes Kontrollkästchen mit vollem Namen («Webmaster: Seiten bearbeiten»); die Spalte der Abteilungsleitung ist fest.
function matrix(z) {
  const { daten } = z;
  const rahmen = el("div", {
    class: "tabellenrahmen rr-matrix-rahmen",
    tabindex: "0",
    role: "region",
    "aria-label": "Rechte nach Rolle, waagrecht scrollbar",
  });
  const kopf = el(
    "tr",
    {},
    el("th", { scope: "col", class: "rr-recht-kopf" }, "Recht"),
    el(
      "th",
      { scope: "col", class: "rr-spalte rr-spalte--fest" },
      el(
        "span",
        { class: "rr-rollenname" },
        icon("schluessel"),
        "Abteilungsleitung",
      ),
      el("span", { class: "klein leise" }, "hat immer alles"),
    ),
    daten.rollen.map((rolle) => {
      const info = el("span", { class: "klein leise" });
      const aktualisiere = () => (info.textContent = zusammenfassung(z, rolle));
      aktualisiere();
      rolle.aktualisiereKopf = aktualisiere;
      return el(
        "th",
        { scope: "col", class: "rr-spalte" },
        el(
          "a",
          { class: "rr-rollenname", href: adresse("rolle", rolle.id) },
          rolle.name,
        ),
        rolle.vorgabe &&
          el("span", { class: "klein leise" }, "Vorgegebene Rolle"),
        info,
      );
    }),
  );
  const zellen = []; // { box, zelle, marke, rolle, recht }
  const zeilen = gruppen(z).flatMap((g) => [
    el(
      "tr",
      { class: "rr-bereich" },
      el(
        "th",
        { scope: "rowgroup", colspan: String(daten.rollen.length + 2) },
        g.name,
      ),
    ),
    ...g.rechte.map((r) => {
      const tr = el("tr", {});
      tr.append(
        el(
          "th",
          { scope: "row", class: "rr-recht-titel" },
          el("span", { class: "rr-titel" }, r.titel),
          el("span", { class: "rr-text klein leise" }, r.text),
          markenListe(r, z),
        ),
        el(
          "td",
          { class: "rr-zelle rr-zelle--fest" },
          el(
            "span",
            { class: "rr-fest-zeichen" },
            icon("haken"),
            el(
              "span",
              { class: "nur-leser" },
              `Abteilungsleitung: ${r.titel}, immer erlaubt`,
            ),
          ),
        ),
      );
      for (const rolle of daten.rollen) {
        const zelle = el("td", { class: "rr-zelle" });
        const box = el("input", { type: "checkbox", class: "rr-haken" });
        const marke = el("span", {
          class: "rr-geaendert",
          "aria-hidden": "true",
        });
        const name = el("span", { class: "nur-leser" });
        zelle.append(
          el(
            "label",
            { class: "rr-box" },
            box,
            name,
            el(
              "span",
              { class: "rr-kasten", "aria-hidden": "true" },
              icon("haken"),
            ),
          ),
          marke,
        );
        const eintrag = { box, zelle, marke, name, rolle, recht: r };
        zellen.push(eintrag);
        box.addEventListener("change", () => {
          z.merke(rolle);
          setzeRecht(z.entwurf, rolle, r.recht, box.checked);
          z.vergessen(rolle);
          z.aktualisiereLeiste();
          zeichneZellen();
        });
        tr.append(zelle);
      }
      return tr;
    }),
  ]);

  // Zustand jeder Zelle aus dem Entwurf: angehakt, geändert (Text «Neu» oder «Entzogen», nie nur Farbe), Name für Screenreader
  function zeichneZellen() {
    for (const { box, zelle, marke, name, rolle, recht } of zellen) {
      const jetzt = rechteIm(rolle, z.entwurf).has(recht.recht);
      const vorher = rolle.rechte.includes(recht.recht);
      box.checked = jetzt;
      zelle.classList.toggle("ist-geaendert", jetzt !== vorher);
      marke.textContent = jetzt === vorher ? "" : jetzt ? "Neu" : "Entzogen";
      name.textContent = `${rolle.name}: ${recht.titel}${jetzt === vorher ? "" : jetzt ? ", neu, noch nicht gespeichert" : ", entzogen, noch nicht gespeichert"}`;
    }
    for (const rolle of daten.rollen) rolle.aktualisiereKopf?.();
  }
  zeichneZellen();

  rahmen.append(
    el(
      "table",
      { class: "rr-matrix" },
      el(
        "caption",
        { class: "nur-leser" },
        "Rechte nach Rolle. Jedes Kästchen ändert eine Rolle; gespeichert wird erst mit «Speichern».",
      ),
      el("thead", {}, kopf),
      el("tbody", {}, zeilen),
    ),
  );
  return el(
    "section",
    {
      class: "flaeche rr-flaeche rr-nur-breit",
      "aria-labelledby": "rr-matrix-titel",
    },
    el(
      "div",
      { class: "rr-kopfzeile" },
      el("h2", { id: "rr-matrix-titel" }, "Rechte der Rollen"),
      alleErweitert(z) &&
        el(
          "p",
          { class: "klein leise rr-zf-hinweis" },
          icon("schluessel"),
          "Jedes dieser Rechte braucht den zweiten Faktor.",
        ),
    ),
    rahmen,
  );
}

// Wirkung des Rechts und, wenn nicht ohnehin jedes Recht ihn braucht, der zweite Faktor
const markenListe = (r, z) =>
  el(
    "ul",
    { class: "chips rr-marken" },
    chip(
      r.wirkung.text,
      r.wirkung.heikel ? "warn" : "",
      r.wirkung.heikel ? "warnung" : false,
    ),
    !alleErweitert(z) && r.erweitert && chip("2. Faktor", "", "schluessel"),
  );

// Mobil: je Rolle eine Karte mit Zusammenfassung; das Öffnen führt zur Seite der Rolle
function karten(z) {
  return el(
    "ul",
    { class: "rr-karten rr-nur-schmal", "aria-label": "Rollen" },
    z.daten.rollen.map((rolle) =>
      el(
        "li",
        { class: "flaeche rr-karte" },
        el("h2", {}, rolle.name),
        rolle.vorgabe &&
          el("ul", { class: "chips" }, chip("Vorgegebene Rolle", "")),
        el("p", { class: "leise" }, zusammenfassung(z, rolle)),
        el(
          "a",
          {
            class: "knopf knopf--klein",
            href: adresse("rolle", rolle.id),
            "aria-label": `Öffnen: ${rolle.name}`,
          },
          icon("weiter"),
          "Öffnen",
        ),
      ),
    ),
  );
}

// ---------- Eine Rolle ----------

function zeigeRolle(inhalt, z, id) {
  const { ctx, daten } = z;
  const rolle = daten.rollen.find((r) => r.id === id);
  if (!rolle) {
    haenge(
      inhalt,
      zurueckLink("Alle Rollen", adresse()),
      leerKarte("Diese Rolle gibt es nicht (mehr).", []),
    );
    return;
  }
  ctx.titel(rolle.name, "Rolle der Abteilung: wer sie trägt und was sie darf.");
  const seiteInhalt = el("div", { class: "rr-seite" });
  haenge(inhalt, zurueckLink("Alle Rollen", adresse()), seiteInhalt);

  // Name (nur eigene Rollen; die Vorgabe behält ihren Namen)
  const name = feld({
    label: "Name der Rolle",
    wert: rolle.name,
    maxlength: "50",
    required: true,
    disabled: rolle.vorgabe,
    hilfe: rolle.vorgabe
      ? "Diese Rolle ist vorgegeben. Ihren Namen und sie selbst kannst du nicht ändern; ihre Rechte schon."
      : undefined,
  });
  const umbenennen = knopf("Namen speichern", {
    symbol: "haken",
    disabled: true,
  });
  name.eingabe.addEventListener("input", () => {
    umbenennen.disabled =
      name.eingabe.value.trim() === "" ||
      name.eingabe.value.trim() === rolle.name;
  });
  umbenennen.addEventListener("click", async () => {
    umbenennen.disabled = true;
    try {
      await anfrage("PATCH", `${BASIS}/${rolle.id}`, {
        name: name.eingabe.value.trim(),
      });
      ctx.melde("Der Name ist geändert.");
      z.neu();
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
      umbenennen.disabled = false;
    }
  });

  // Rechte als Schalter, nach Bereich
  const schalter = [];
  const rechteBereiche = gruppen(z).map((g) =>
    el(
      "section",
      { class: "rr-bereich-block", "aria-labelledby": `rr-b-${g.schluessel}` },
      el("h3", { id: `rr-b-${g.schluessel}` }, g.name),
      el(
        "ul",
        { class: "rr-rechteliste" },
        g.rechte.map((r) => {
          const knopfSchalter = el("button", {
            type: "button",
            class: "schalter",
            role: "switch",
            "aria-labelledby": `rr-r-${r.recht}`,
            "aria-describedby": `rr-t-${r.recht}`,
          });
          const marke = el("span", { class: "rr-geaendert" });
          const li = el(
            "li",
            { class: "rr-rechtzeile" },
            el(
              "div",
              { class: "rr-rechtinfo" },
              el("p", { class: "rr-titel", id: `rr-r-${r.recht}` }, r.titel),
              el("p", { class: "klein leise", id: `rr-t-${r.recht}` }, r.text),
              markenListe(r, z),
              marke,
            ),
            knopfSchalter,
          );
          schalter.push({ knopfSchalter, li, marke, r });
          knopfSchalter.addEventListener("click", () => {
            z.merke(rolle);
            setzeRecht(
              z.entwurf,
              rolle,
              r.recht,
              knopfSchalter.getAttribute("aria-checked") !== "true",
            );
            z.vergessen(rolle);
            z.aktualisiereLeiste();
            zeichneSchalter();
          });
          return li;
        }),
      ),
    ),
  );
  function zeichneSchalter() {
    for (const { knopfSchalter, li, marke, r } of schalter) {
      const jetzt = rechteIm(rolle, z.entwurf).has(r.recht);
      const vorher = rolle.rechte.includes(r.recht);
      knopfSchalter.setAttribute("aria-checked", String(jetzt));
      li.classList.toggle("ist-geaendert", jetzt !== vorher);
      marke.textContent =
        jetzt === vorher
          ? ""
          : jetzt
            ? "Neu, noch nicht gespeichert"
            : "Entzogen, noch nicht gespeichert";
    }
  }
  zeichneSchalter();

  const loeschenKnopf = knopf("Rolle löschen", {
    art: "gefahr",
    symbol: "papierkorb",
  });
  zweistufig(
    loeschenKnopf,
    rolle.personen.length > 0
      ? `Wirklich löschen? ${personen(rolle.personen.length)} verlieren die Rechte dieser Rolle.`
      : "Wirklich löschen?",
    async () => {
      try {
        await anfrage("DELETE", `${BASIS}/${rolle.id}`);
        merkeMeldung(`Die Rolle «${rolle.name}» ist gelöscht.`);
        z.entwurf.delete(rolle.id);
        z.vergessen(rolle);
        location.hash = adresse();
      } catch (f) {
        ctx.melde(fehlertext(f), "fehler");
      }
    },
  );

  haenge(
    seiteInhalt,
    el(
      "section",
      { class: "flaeche rr-flaeche", "aria-labelledby": "rr-name-titel" },
      el("h2", { id: "rr-name-titel" }, "Name"),
      el("div", { class: "rr-namenzeile" }, name.wurzel, umbenennen),
    ),
    el(
      "section",
      { class: "flaeche rr-flaeche", "aria-labelledby": "rr-rechte-titel" },
      el(
        "div",
        { class: "rr-kopfzeile" },
        el("h2", { id: "rr-rechte-titel" }, "Rechte"),
        alleErweitert(z) &&
          el(
            "p",
            { class: "klein leise rr-zf-hinweis" },
            icon("schluessel"),
            "Jedes dieser Rechte braucht den zweiten Faktor.",
          ),
      ),
      el(
        "p",
        { class: "leise" },
        "Ändern gilt erst nach «Speichern» unten. Wer die Rolle trägt, bekommt oder verliert das Recht ab seiner nächsten Anfrage.",
      ),
      rechteBereiche,
    ),
    personenBlock(z, rolle),
    !rolle.vorgabe &&
      el(
        "section",
        {
          class: "flaeche rr-flaeche rr-gefahr",
          "aria-labelledby": "rr-weg-titel",
        },
        el("h2", { id: "rr-weg-titel" }, "Rolle löschen"),
        el(
          "p",
          { class: "leise" },
          "Mit der Rolle fallen ihre Rechte und ihre Zuweisungen weg. Die Personen bleiben.",
        ),
        el("div", {}, loeschenKnopf),
      ),
  );
}

// Personen der Rolle: Liste mit «Entziehen», darunter die Suche zum Hinzufügen
function personenBlock(z, rolle) {
  const { ctx, daten } = z;
  const heikel = rolle.rechte.some((r) => z.heikelVon(r));
  const ort = el("div", { class: "rr-block" });
  const liste = el("ul", {
    class: "pe-treffer rr-personen",
    "aria-label": `Personen mit der Rolle ${rolle.name}`,
  });
  const bekannt = new Map(daten.personen.map((p) => [p.id, p]));

  const entziehen = async (p) => {
    try {
      await anfrage("DELETE", `${BASIS}/${rolle.id}/personen/${p.id}`);
      ctx.melde(`«${p.name}» hat die Rolle «${rolle.name}» nicht mehr.`);
      z.neu();
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    }
  };
  const vergeben = async (k) => {
    try {
      await anfrage("PUT", `${BASIS}/${rolle.id}/personen/${k.id}`);
      ctx.melde(`«${k.name}» hat jetzt die Rolle «${rolle.name}».`);
      z.neu();
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    }
  };

  const zeilen = rolle.personen.length
    ? rolle.personen.map((p) => {
        const k = kandidatVon(bekannt.get(p.id) ?? { id: p.id, name: p.name });
        const weg = knopf("Entziehen", {
          klein: true,
          art: "still",
          symbol: "schliessen",
          kontext: p.name,
        });
        zweistufig(
          weg,
          `Wirklich entziehen? ${p.name} verliert die Rechte dieser Rolle.`,
          () => entziehen(p),
        );
        return personZeile(k, weg);
      })
    : [
        el(
          "li",
          { class: "pe-keiner leise" },
          "Noch niemand trägt diese Rolle.",
        ),
      ];
  liste.append(...zeilen);

  // Kandidaten: aktive Konten ohne die Rolle; die Abteilungsleitung braucht sie nicht
  const trager = new Set(rolle.personen.map((p) => p.id));
  const kandidaten = daten.personen
    .filter((p) => !p.deaktiviert && !p.admin && !trager.has(p.id))
    .map(kandidatVon);
  const suche = kandidatenSuche({
    beschriftung: "Person suchen",
    kandidaten,
    knopfText: "Rolle geben",
    leerText: "Niemand mehr zu haben.",
    beiWahl: (k) => {
      // Vergeben ist sofort wirksam: bei Rechten mit grosser Wirkung fragt die Seite am Ort nach
      if (heikel) {
        bestaetigeAmOrt(ort, {
          text: `«${k.name}» bekommt die Rolle «${rolle.name}». Die Rolle erlaubt dann ${rolle.rechte
            .filter((x) => z.heikelVon(x))
            .map((x) => `«${z.titelVon(x)}»`)
            .join(", ")}. Wirklich?`,
          ok: "Rolle geben",
          aktion: () => vergeben(k),
          zurueckFokus: suche.wurzel.querySelector("input"),
        });
      } else {
        vergeben(k);
      }
    },
  });
  const betrifft =
    rolle.rechte.length === 0
      ? "Diese Rolle trägt noch keine Rechte: Wer sie bekommt, darf damit noch nichts."
      : null;
  haenge(
    ort,
    el(
      "div",
      { class: "rr-kopfzeile" },
      el("h2", { id: "rr-personen-titel" }, "Personen"),
      el("p", { class: "klein leise" }, personen(rolle.personen.length)),
    ),
    betrifft &&
      el("p", { class: "hinweis hinweis--info", role: "note" }, betrifft),
    liste,
    el("h3", {}, "Person hinzufügen"),
    suche.wurzel,
    el(
      "p",
      { class: "klein leise" },
      "Die Abteilungsleitung steht nicht in der Liste: Sie hat immer alles. Konten, die gesperrt sind, auch nicht.",
    ),
  );
  return el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": "rr-personen-titel" },
    ort,
  );
}

// ---------- Neue Rolle ----------

function zeigeNeueRolle(inhalt, z) {
  const { ctx } = z;
  ctx.titel(
    "Neue Rolle",
    "Gib ihr einen Namen. Die Rechte stellst du danach ein.",
  );
  const name = feld({
    label: "Name der Rolle",
    maxlength: "50",
    required: true,
    hilfe:
      "Zum Beispiel «Medienteam». Der Name erscheint nur in der Verwaltung.",
  });
  const fehler = el("p", { class: "feld-fehler", role: "alert", hidden: true });
  name.wurzel.append(fehler);
  const anlegen = knopf("Rolle anlegen", { art: "haupt", symbol: "plus" });
  const formular = el(
    "form",
    { class: "flaeche rr-flaeche rr-neu", novalidate: true },
    el("h2", {}, "Neue Rolle"),
    name.wurzel,
    el(
      "div",
      { class: "reihe" },
      anlegen,
      el("a", { class: "knopf knopf--still", href: adresse() }, "Abbrechen"),
    ),
  );
  anlegen.type = "submit";
  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = name.eingabe.value.trim();
    fehler.hidden = text !== "";
    if (text === "") {
      fehler.textContent = "Gib der Rolle einen Namen.";
      name.eingabe.setAttribute("aria-invalid", "true");
      name.eingabe.focus();
      return;
    }
    anlegen.disabled = true;
    try {
      // Ohne Rechte: Wer sie bekommt, darf damit noch nichts, bis du sie einstellst
      const { id } = await anfrage("POST", BASIS, { name: text, rechte: [] });
      merkeMeldung("Die Rolle ist angelegt. Stelle jetzt ihre Rechte ein.");
      location.hash = adresse("rolle", id);
    } catch (f) {
      anlegen.disabled = false;
      fehler.hidden = false;
      fehler.textContent =
        f?.code === "ROLLENNAME_VERGEBEN"
          ? "Es gibt schon eine Rolle mit diesem Namen."
          : fehlertext(f);
      name.eingabe.setAttribute("aria-invalid", "true");
      name.eingabe.focus();
    }
  });
  haenge(inhalt, zurueckLink("Alle Rollen", adresse()), formular);
  name.eingabe.focus();
}
