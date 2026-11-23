import { anfrage } from "./api.js";
import {
  ankreuzen,
  auswahl,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonListe } from "./lader.js";
import { feldFehler, haenge, meldung } from "./lager-gemeinsam.js";
import {
  druckKnopf,
  istKonflikt,
  kannSchreiben,
  konfliktBox,
  KONFLIKT_TEXT,
  kopiere,
  ladeMitglieder,
  lagerPfad,
  listenFehler,
  personName,
  schreibschutzHinweis,
  werkzeugzeile,
} from "./lager-m-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { leerKarte } from "./zustaende.js";

// Einkauf im Lager-Arbeitsbereich (#674): die Einkaufsliste als Tabellen nach Abteilung des Ladens, Artikel anlegen mit Vorschlägen, abhaken, ändern, löschen, «Zusammengezählt» (gleiche Artikel summiert), «Erledigte entfernen», Text kopieren, Drucken. Adresse: …/einkauf. Lesen: einkauf.lesen, Ändern: einkauf.bearbeiten (das Team liest die Liste nicht).
// Routen: GET /einkauf (Seiten mit «nach»), GET /einkauf/zusammen, GET /einkauf/vorschlaege, POST /einkauf, PATCH und DELETE /einkauf/{id}.

// Die Abteilungen in der Reihenfolge, in der man durch den Laden geht (wie die App)
export const GRUPPEN = [
  ["obst_gemuese", "Früchte und Gemüse"],
  ["brot", "Brot"],
  ["milch_kaese", "Milch und Käse"],
  ["fleisch_fisch", "Fleisch und Fisch"],
  ["vorrat", "Trockenes"],
  ["getraenke", "Getränke"],
  ["haushalt", "Haushalt"],
  ["diverses", "Diverses"],
];
const MENGE_FEHLER =
  "Die Menge ist keine Zahl. Schreibe zum Beispiel 2 oder 1,5.";
export const GRUPPENNAME = Object.fromEntries(GRUPPEN);

// Reine Funktion (testbar): Menge aus der Eingabe. Leer heisst keine Menge (null), «1,5» wie «1.5»; keine Zahl, null, negativ oder zu gross ist ungültig (undefined)
export function parseMenge(text) {
  const roh = String(text ?? "")
    .trim()
    .replace(",", ".");
  if (roh === "") return null;
  if (!/^\d+(\.\d{1,3})?$/.test(roh)) return undefined;
  const n = Number(roh);
  return n > 0 && n <= 1_000_000 ? n : undefined;
}

// Reine Funktion (testbar): «6», «1,5 kg»; ohne Menge nur die Einheit oder nichts
export function formatMenge(menge, einheit) {
  const zahl =
    menge === null || menge === undefined
      ? null
      : new Intl.NumberFormat("de-CH", { maximumFractionDigits: 3 }).format(
          menge,
        );
  return [zahl, einheit].filter(Boolean).join(" ");
}

// Reine Funktion (testbar): Artikel nach Abteilung in der Reihenfolge des Ladens; Erledigte stehen unten, sonst nach Name
export function nachAbteilung(artikel) {
  return GRUPPEN.map(([schluessel, name]) => ({
    schluessel,
    name,
    zeilen: artikel
      .filter(
        (a) =>
          (GRUPPENNAME[a.warengruppe] ? a.warengruppe : "diverses") ===
          schluessel,
      )
      .sort(
        (a, b) =>
          Number(a.erledigt) - Number(b.erledigt) ||
          a.name.localeCompare(b.name, "de"),
      ),
  })).filter((g) => g.zeilen.length > 0);
}

// Reine Funktion (testbar): die offenen Artikel als Text, eine Abteilung je Block
export function alsText(artikel) {
  return nachAbteilung(artikel.filter((a) => !a.erledigt))
    .map((g) =>
      [
        g.name,
        ...g.zeilen.map(
          (a) =>
            `- ${[a.name, formatMenge(a.menge, a.einheit)].filter(Boolean).join(" ")}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

async function ladeAlle(lagerId, art = "") {
  const alle = [];
  let nach = null;
  for (let seite = 0; seite < 50; seite++) {
    const d = await anfrage(
      "GET",
      lagerPfad(
        lagerId,
        `/einkauf${art}?limit=200${nach ? `&nach=${nach}` : ""}`,
      ),
    );
    alle.push(...d.artikel);
    nach = d.naechster;
    if (!nach) break;
  }
  return alle;
}

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.titel(
    "Einkauf",
    "Was fürs Lager eingekauft wird, nach Abteilung im Laden sortiert.",
  );
  ctx.lade(
    async () => {
      const [artikel, mitglieder] = await Promise.all([
        ladeAlle(lagerId),
        ladeMitglieder(lagerId),
      ]);
      return { artikel, mitglieder };
    },
    (daten, neu) => bereich.append(zeichne(ctx, lagerId, lager, daten, neu)),
    { skeleton: () => skeletonListe({ zeilen: 6 }) },
  );
}

function zeichne(ctx, lagerId, lager, daten, neuLaden) {
  const darf = kannSchreiben(lager, "einkauf.bearbeiten");
  const mitglieder = daten.mitglieder;
  const artikel = daten.artikel;
  const wurzel = el("div", { class: "lm-seite" });
  const inhalt = el("div", { class: "lm-sektionen" });
  const zahlen = el("p", { class: "leise", role: "status" });
  let ansicht = "einzeln";
  let zusammen = null;
  const stand = { suche: "", filter: { status: "alle", person: "alle" } };

  const personOptionen = () => {
    const bekannt = new Map();
    for (const a of artikel)
      if (a.einkaeufer) bekannt.set(a.einkaeufer.id, personName(a.einkaeufer));
    return [
      ["alle", "Alle"],
      ["ich", "Nur meine"],
      ["ohne", "Ohne Einkäufer"],
      ...[...bekannt].sort((a, b) => a[1].localeCompare(b[1], "de")),
    ];
  };

  const passt = (a) => {
    if (stand.suche && !a.name.toLowerCase().includes(stand.suche))
      return false;
    if (stand.filter.status === "offen" && a.erledigt) return false;
    if (stand.filter.status === "erledigt" && !a.erledigt) return false;
    const p = stand.filter.person;
    const id = a.einkaeuferPersonId ?? a.einkaeufer?.id ?? null;
    if (p === "ich") return id === ctx.ich?.id;
    if (p === "ohne") return id === null;
    return p === "alle" || id === p;
  };

  // Abhaken, Ändern und Löschen schreiben je Artikel mit seiner Version
  const meldeFehler = (f) => {
    ctx.melde(listenFehler(f), istKonflikt(f) ? "warn" : "fehler");
    if (istKonflikt(f)) neuLaden();
  };

  async function haken(a, erledigt, k) {
    const vorher = a.erledigt;
    a.erledigt = erledigt;
    try {
      const neu = await anfrage(
        "PATCH",
        lagerPfad(lagerId, `/einkauf/${a.id}`),
        {
          version: a.version,
          erledigt,
        },
      );
      Object.assign(a, neu);
      zeichneInhalt();
    } catch (f) {
      a.erledigt = vorher;
      k.checked = vorher;
      meldeFehler(f);
    }
  }

  function zeile(a) {
    const k = ankreuzen({ label: a.name, gewaehlt: a.erledigt, wert: a.id });
    k.eingabe.disabled = !darf;
    k.eingabe.addEventListener("change", () =>
      haken(a, k.eingabe.checked, k.eingabe),
    );
    return el(
      "tr",
      { class: a.erledigt ? "lm-erledigt" : undefined, "data-id": a.id },
      el("th", { scope: "row" }, k.wurzel),
      el(
        "td",
        { class: "lg-zahlen", "data-label": "Menge" },
        formatMenge(a.menge, a.einheit),
      ),
      el(
        "td",
        { "data-label": "Einkäufer" },
        a.einkaeufer ? personName(a.einkaeufer) : "",
      ),
      el(
        "td",
        { class: "aktionen lm-nicht-drucken" },
        darf &&
          el(
            "span",
            { class: "lm-zeilenknoepfe" },
            knopf("Bearbeiten", {
              klein: true,
              symbol: "bearbeiten",
              kontext: a.name,
              onclick: () => bearbeiten(a),
            }),
            knopf("Löschen", {
              klein: true,
              art: "still",
              symbol: "papierkorb",
              kontext: a.name,
              onclick: (e) => loesche(a, e),
            }),
          ),
      ),
    );
  }

  function loesche(a, ereignis) {
    ctx.mitRueckgaengig({
      text: `«${a.name}» gelöscht`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage(
          "DELETE",
          lagerPfad(lagerId, `/einkauf/${a.id}?version=${a.version}`),
        ),
      fehlertext: (f) => `Der Artikel wurde nicht gelöscht. ${listenFehler(f)}`,
      danach: neuLaden,
      beiFehler: (f) => istKonflikt(f) && neuLaden(),
    });
  }

  function bearbeiten(a) {
    const neu = !a;
    const name = feld({
      label: "Artikel",
      wert: a?.name ?? "",
      maxlength: 100,
      required: true,
      autocomplete: "off",
    });
    const menge = feld({
      label: "Menge",
      wert:
        a?.menge === null || a?.menge === undefined
          ? ""
          : String(a.menge).replace(".", ","),
      inputmode: "decimal",
      autocomplete: "off",
      hilfe: "Freiwillig, zum Beispiel 1,5.",
    });
    const einheit = feld({
      label: "Einheit",
      wert: a?.einheit ?? "",
      maxlength: 20,
      autocomplete: "off",
      hilfe: "Freiwillig, zum Beispiel kg oder Packungen.",
    });
    const gruppe = auswahl({
      label: "Abteilung",
      optionen: [["", "Automatisch"], ...GRUPPEN],
      wert: neu ? "" : a.warengruppe,
    });
    const person = mitglieder
      ? auswahl({
          label: "Einkäufer",
          optionen: [["", "Noch niemand"], ...mitglieder],
          wert: a?.einkaeuferPersonId ?? "",
        })
      : null;
    let version = a?.version;
    const werte = () => {
      const m = parseMenge(menge.eingabe.value);
      return {
        name: name.eingabe.value.trim().replace(/\s+/g, " "),
        menge: m,
        einheit: einheit.eingabe.value.trim() || null,
        ...(gruppe.eingabe.value ? { warengruppe: gruppe.eingabe.value } : {}),
        ...(person ? { einkaeuferPersonId: person.eingabe.value || null } : {}),
      };
    };
    let seite;
    const konflikt = konfliktBox({
      felder: {
        name: "Artikel",
        menge: "Menge",
        einheit: "Einheit",
        warengruppe: "Abteilung",
        einkaeuferPersonId: "Einkäufer",
      },
      meine: () => ({ ...werte(), warengruppe: gruppe.eingabe.value }),
      beiEigene: (aktuell) => {
        version = aktuell.version;
        seite.querySelector("form").requestSubmit();
      },
      beiServer: () => {
        seite.close();
        neuLaden();
      },
    });
    seite = dialogFormular({
      titel: neu ? "Artikel hinzufügen" : "Artikel bearbeiten",
      felder: [
        konflikt.wurzel,
        name.wurzel,
        el("div", { class: "lg-zweispaltig" }, menge.wurzel, einheit.wurzel),
        gruppe.wurzel,
        person?.wurzel,
      ].filter(Boolean),
      ok: neu ? "Hinzufügen" : "Speichern",
      pruefe: () => {
        if (parseMenge(menge.eingabe.value) !== undefined) return false;
        feldFehler(menge, MENGE_FEHLER);
        return true;
      },
      senden: async () => {
        try {
          if (neu)
            await anfrage("POST", lagerPfad(lagerId, "/einkauf"), werte());
          else
            await anfrage("PATCH", lagerPfad(lagerId, `/einkauf/${a.id}`), {
              version,
              ...werte(),
            });
        } catch (f) {
          if (istKonflikt(f)) konflikt.zeige(f.daten);
          throw f;
        }
      },
      fehlertext: (f) => (istKonflikt(f) ? KONFLIKT_TEXT : meldung(f)),
      danach: () => {
        ctx.melde(
          neu ? "Der Artikel ist angelegt." : "Der Artikel ist gespeichert.",
        );
        neuLaden();
      },
    });
  }

  // ---- Anzeige ----

  function zeichneInhalt() {
    const sichtbar = artikel.filter(passt);
    const offen = artikel.filter((a) => !a.erledigt).length;
    zahlen.textContent = `${offen} offen, ${artikel.length - offen} erledigt.`;
    leiste.setzeTreffer(sichtbar.length, artikel.length);
    if (artikel.length === 0) {
      inhalt.replaceChildren(
        leerKarte(
          darf
            ? "Die Einkaufsliste ist leer. Füge oben den ersten Artikel hinzu."
            : "Die Einkaufsliste ist leer.",
        ),
      );
      return;
    }
    if (ansicht === "zusammen") return zeichneZusammen();
    const gruppen = nachAbteilung(sichtbar);
    if (gruppen.length === 0) {
      inhalt.replaceChildren(leerKarte("Kein Artikel passt zu deinem Filter."));
      return;
    }
    inhalt.replaceChildren(
      ...gruppen.map((g) => {
        const t = tabelle({
          beschriftung: g.name,
          spalten: [
            "Artikel",
            "Menge",
            "Einkäufer",
            ["Aktionen", "lm-nicht-drucken"],
          ],
          zeilen: g.zeilen.map(zeile),
        });
        t.wurzel.querySelector("table").classList.add("lg-karten");
        return el(
          "section",
          { class: "flaeche lm-abschnitt", "aria-label": g.name },
          el(
            "div",
            { class: "lm-kartenkopf" },
            el("h2", {}, g.name),
            el(
              "span",
              { class: "klein leise lm-zahlen" },
              `${g.zeilen.length}`,
            ),
          ),
          t.wurzel,
        );
      }),
    );
  }

  async function zeichneZusammen() {
    if (!zusammen) {
      inhalt.replaceChildren(
        el("p", { class: "leise", role: "status" }, "Wird zusammengezählt …"),
      );
      try {
        zusammen = await ladeAlle(lagerId, "/zusammen");
      } catch (f) {
        inhalt.replaceChildren(
          el(
            "p",
            { class: "hinweis hinweis--fehler", role: "alert" },
            meldung(f),
          ),
        );
        return;
      }
    }
    const sichtbar = zusammen
      .map((z) => ({ ...z, id: z.eintraege[0].id, warengruppe: z.warengruppe }))
      .filter(passt);
    const gruppen = nachAbteilung(sichtbar);
    if (gruppen.length === 0) {
      inhalt.replaceChildren(leerKarte("Kein Artikel passt zu deinem Filter."));
      return;
    }
    inhalt.replaceChildren(
      ...gruppen.map((g) => {
        const t = tabelle({
          beschriftung: `${g.name}, zusammengezählt`,
          spalten: ["Artikel", "Menge", "Einkäufer", ["Einträge", "zahl"]],
          zeilen: g.zeilen.map((z) => {
            const k = ankreuzen({
              label: z.name,
              gewaehlt: z.erledigt,
              wert: z.id,
            });
            k.eingabe.disabled = !darf;
            k.eingabe.addEventListener("change", async () => {
              const neuWert = k.eingabe.checked;
              try {
                for (const e of z.eintraege)
                  await anfrage(
                    "PATCH",
                    lagerPfad(lagerId, `/einkauf/${e.id}`),
                    {
                      version: e.version,
                      erledigt: neuWert,
                    },
                  );
                neuLaden();
              } catch (f) {
                k.eingabe.checked = !neuWert;
                meldeFehler(f);
              }
            });
            return el(
              "tr",
              { class: z.erledigt ? "lm-erledigt" : undefined },
              el("th", { scope: "row" }, k.wurzel),
              el(
                "td",
                { class: "lg-zahlen", "data-label": "Menge" },
                formatMenge(z.menge, z.einheit),
              ),
              el(
                "td",
                { "data-label": "Einkäufer" },
                z.einkaeufer ? personName(z.einkaeufer) : "",
              ),
              el(
                "td",
                { class: "zahl lg-zahlen", "data-label": "Einträge" },
                String(z.anzahl),
              ),
            );
          }),
        });
        t.wurzel.querySelector("table").classList.add("lg-karten");
        return el(
          "section",
          { class: "flaeche lm-abschnitt", "aria-label": g.name },
          el("div", { class: "lm-kartenkopf" }, el("h2", {}, g.name)),
          t.wurzel,
        );
      }),
    );
  }

  const leiste = filterleiste({
    suche: { label: "Artikel suchen" },
    filter: [
      {
        schluessel: "status",
        label: "Stand",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ["offen", "Offen"],
          ["erledigt", "Erledigt"],
        ],
      },
      {
        schluessel: "person",
        label: "Einkäufer",
        grundwert: "alle",
        optionen: personOptionen(),
      },
    ],
    namen: { einzahl: "Artikel", mehrzahl: "Artikel" },
    beiAenderung: (neu) => {
      stand.suche = neu.suche.trim().toLowerCase();
      stand.filter = neu.filter;
      zeichneInhalt();
    },
  });

  const umschalter = filterGruppe({
    beschriftung: "Darstellung",
    eintraege: [
      { text: "Einzeln", wert: "einzeln" },
      { text: "Zusammengezählt", wert: "zusammen" },
    ],
    wert: "einzeln",
    beiAenderung: (w) => {
      ansicht = w;
      zeichneInhalt();
    },
  });

  const erledigte = artikel.filter((a) => a.erledigt);
  const entferneErledigte = () => {
    const ids = artikel.filter((a) => a.erledigt);
    ctx.mitRueckgaengig({
      text: `${ids.length} erledigte Artikel gelöscht`,
      ansicht: {
        weg: () => inhalt.setAttribute("hidden", ""),
        zurueck: () => inhalt.removeAttribute("hidden"),
      },
      ausfuehren: async () => {
        for (const a of ids)
          await anfrage(
            "DELETE",
            lagerPfad(lagerId, `/einkauf/${a.id}?version=${a.version}`),
          );
      },
      fehlertext: (f) =>
        `Nicht alle Artikel wurden gelöscht. ${listenFehler(f)}`,
      danach: neuLaden,
      beiFehler: neuLaden,
    });
  };

  // Schnell anlegen: Name, Menge, Einheit; Vorschläge aus früheren Einträgen des Lagers
  const schnellName = feld({
    label: "Artikel",
    maxlength: 100,
    autocomplete: "off",
  });
  const schnellMenge = feld({
    label: "Menge",
    inputmode: "decimal",
    autocomplete: "off",
  });
  const schnellEinheit = feld({
    label: "Einheit",
    maxlength: 20,
    autocomplete: "off",
  });
  const vorschlaege = el("div", {
    class: "lm-vorschlaege lm-nicht-drucken",
    role: "group",
    "aria-label": "Vorschläge",
  });
  const schnellFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  let zaehlerV = 0;
  let timer = null;
  schnellName.eingabe.addEventListener("input", () => {
    window.clearTimeout(timer);
    const q = schnellName.eingabe.value.trim();
    const mein = ++zaehlerV;
    if (q.length === 0) {
      vorschlaege.replaceChildren();
      return;
    }
    timer = window.setTimeout(async () => {
      try {
        const d = await anfrage(
          "GET",
          lagerPfad(
            lagerId,
            `/einkauf/vorschlaege?limit=8&q=${encodeURIComponent(q)}`,
          ),
        );
        if (mein !== zaehlerV) return;
        vorschlaege.replaceChildren(
          ...d.vorschlaege.map((v) =>
            knopf(v.name, {
              klein: true,
              art: "still",
              onclick: () => {
                schnellName.eingabe.value = v.name;
                vorschlaege.replaceChildren();
                schnellMenge.eingabe.focus();
              },
            }),
          ),
        );
      } catch {
        vorschlaege.replaceChildren();
      }
    }, 200);
  });
  const anlegen = async () => {
    const name = schnellName.eingabe.value.trim().replace(/\s+/g, " ");
    const menge = parseMenge(schnellMenge.eingabe.value);
    schnellFehler.hidden = true;
    const fehler = (text, ziel) => {
      schnellFehler.textContent = text;
      schnellFehler.hidden = false;
      ziel.focus();
    };
    if (name === "")
      return fehler(
        "Schreibe, was eingekauft werden soll.",
        schnellName.eingabe,
      );
    if (menge === undefined) return fehler(MENGE_FEHLER, schnellMenge.eingabe);
    try {
      await anfrage("POST", lagerPfad(lagerId, "/einkauf"), {
        name,
        menge,
        einheit: schnellEinheit.eingabe.value.trim() || null,
      });
      ctx.melde(`«${name}» steht auf der Liste.`);
      neuLaden();
    } catch (f) {
      schnellFehler.textContent = meldung(f);
      schnellFehler.hidden = false;
    }
  };
  for (const f of [schnellName, schnellMenge, schnellEinheit])
    f.eingabe.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        anlegen();
      }
    });

  haenge(
    wurzel,
    schreibschutzHinweis(lager),
    darf &&
      el(
        "section",
        { class: "flaeche lm-nicht-drucken" },
        el("h2", {}, "Artikel hinzufügen"),
        el(
          "div",
          { class: "lm-neuzeile lm-neuzeile--einkauf" },
          schnellName.wurzel,
          schnellMenge.wurzel,
          schnellEinheit.wurzel,
          knopf("Hinzufügen", {
            art: "haupt",
            symbol: "plus",
            onclick: anlegen,
          }),
        ),
        vorschlaege,
        schnellFehler,
        el(
          "p",
          { class: "hilfe" },
          "Die Abteilung im Laden erkennt der Server am Namen. Du kannst sie beim Bearbeiten ändern.",
        ),
      ),
    werkzeugzeile(
      umschalter.wurzel,
      knopf("Als Text kopieren", {
        symbol: "kopieren",
        onclick: () =>
          kopiere(alsText(artikel), ctx, "Die Liste der offenen Artikel"),
      }),
      druckKnopf("Drucken", "Einkaufsliste"),
      darf &&
        erledigte.length > 0 &&
        knopf(`Erledigte entfernen (${erledigte.length})`, {
          art: "still",
          symbol: "papierkorb",
          onclick: entferneErledigte,
        }),
    ),
    el("div", { class: "lm-nicht-drucken" }, leiste.wurzel),
    zahlen,
    inhalt,
  );
  zeichneInhalt();
  return wurzel;
}
