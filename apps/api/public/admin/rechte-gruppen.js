import { fehlertext } from "./api.js";
import {
  auswahl,
  dialogFormular,
  el,
  gruppe as fieldset,
  icon,
  knopf,
  neueId,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonFlaeche } from "./lader.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";
import { aendereRolle, ladeGruppe, legeRolleAn } from "./rechte-api.js";
import {
  adresse,
  haenge,
  personen as personenText,
  typText,
  zurueckLink,
} from "./rechte-gemeinsam.js";
import { rechteRaster } from "./rechte-matrix.js";
import {
  FESTE_PUNKTE,
  rechteFehlerText,
  vorschlaegeFuer,
} from "./rechte-modell.js";
import {
  neueRolleSeite,
  personenBlock,
  rolleBearbeitenSeite,
  rolleKopf,
  rolleLoeschenFrage,
} from "./rechte-rolle.js";

// Reiter «Gruppen» (#651): Rechte je einzelne Gruppe. Liste aller Gruppen, je Gruppe ihre Rollen mit einer Rechte-Matrix, je Rolle ihre Personen. Rollen legt die Abteilungsleitung selbst an (zum Beispiel «Kasse» im OK eines Anlasses); die Rechte gelten, bis die Rolle oder die Gruppe gelöscht wird.
// Vorlagen: Kokonut «team-members» (Rolle, Personen, Vorschau) und «tool-permissions» (Rechte je Zeile).

const text = (f) => rechteFehlerText(f, fehlertext(f));
const rollenText = (n) => (n === 1 ? "1 Rolle" : `${n} Rollen`);
const rechteText = (n) => (n === 1 ? "1 Recht" : `${n} Rechte`);
const TYPEN = ["stufe", "funktion", "team", "lager", "anlass"];

export function zeigeGruppen(inhalt, z, pfad) {
  const [id, was, rolleId] = pfad;
  if (!id) return zeigeListe(inhalt, z);
  const lade = z.ctx.erstelleLader(inhalt);
  lade(
    () => ladeGruppe(id),
    (daten) => {
      for (const r of daten.rollen) z.merke(r, daten.gruppe.name);
      if (was === "rolle" && rolleId) zeigeRolle(inhalt, z, daten, rolleId);
      else zeigeGruppe(inhalt, z, daten);
    },
    {
      skeleton: () =>
        el(
          "div",
          { class: "rr-skelett" },
          [0, 1].map(() => skeletonFlaeche({ zeilen: 4 })),
        ),
    },
  );
}

// ---------- Liste ----------

function zeigeListe(inhalt, z) {
  z.ctx.kopfAktion(
    el(
      "a",
      { class: "knopf knopf--still", href: "#personen/gruppen" },
      "Gruppen verwalten",
    ),
  );
  const alle = z.gruppen;
  const zaehl = (typ) => alle.filter((g) => g.typ === typ).length;
  const liste = el("ul", { class: "rr-gruppenliste", "aria-label": "Gruppen" });
  const leer = el("div", { hidden: true });
  const leiste = filterleiste({
    suche: { label: "Gruppe suchen" },
    filter: [
      {
        schluessel: "typ",
        label: "Art",
        optionen: [
          ["", `Alle Arten (${alle.length})`],
          ...TYPEN.filter((t) => zaehl(t) > 0).map((t) => [
            t,
            `${typText(t)} (${zaehl(t)})`,
          ]),
        ],
      },
    ],
    namen: { einzahl: "Gruppe", mehrzahl: "Gruppen" },
    beiAenderung: ({ suche, filter }) => zeichne(suche, filter.typ),
  });
  haenge(
    inhalt,
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Rechte gelten je einzelne Gruppe. Öffne eine Gruppe, lege dort Rollen an (zum Beispiel «Kasse» im OK eines Anlasses) und stelle ihre Rechte ein. Die Rechte gelten, bis du die Rolle oder die Gruppe löschst.",
    ),
    leiste.wurzel,
    liste,
    leer,
  );
  function zeichne(suche = "", typ = "") {
    const f = suche.trim().toLowerCase();
    const treffer = alle.filter(
      (g) =>
        (!typ || g.typ === typ) && (!f || g.name.toLowerCase().includes(f)),
    );
    liste.replaceChildren(
      ...treffer.map((g) =>
        el(
          "li",
          { class: "rr-gruppenzeile" },
          el(
            "a",
            { class: "rr-gruppenlink", href: adresse("gruppen", g.id) },
            el("span", { class: "rr-gruppenname" }, g.name),
            el("span", { class: "chip" }, typText(g.typ)),
            icon("weiter"),
            el(
              "span",
              { class: "klein leise rr-gruppenzahlen" },
              `${rollenText(g.rollen)} · ${personenText(g.mitglieder)}${g.mitRolle > 0 && g.mitRolle !== g.mitglieder ? `, ${g.mitRolle} mit Rolle` : ""}`,
            ),
          ),
        ),
      ),
    );
    leiste.setzeTreffer(treffer.length, alle.length);
    leer.hidden = treffer.length > 0;
    leer.replaceChildren(
      ...(treffer.length > 0
        ? []
        : [
            leerKarte(
              alle.length === 0
                ? "Es gibt noch keine Gruppe. Lege sie unter «Gruppen und Tags» an."
                : "Keine Gruppe passt zu dieser Suche.",
            ),
          ]),
    );
  }
  zeichne();
}

// ---------- Eine Gruppe ----------

function zeigeGruppe(inhalt, z, daten) {
  const { gruppe, rollen, anlass } = daten;
  z.ctx.titel(gruppe.name, `Rechte der Gruppe, ${typText(gruppe.typ)}`);
  z.ctx.kopfAktion();

  const kopf = el(
    "header",
    { class: "rr-gruppenkopf" },
    el(
      "div",
      { class: "rr-gruppentitel" },
      el("span", { class: "chip" }, typText(gruppe.typ)),
      anlass &&
        el(
          "span",
          { class: "klein" },
          "Gehört zum Anlass ",
          el(
            "a",
            { class: "tm-tabellenlink", href: `#anlaesse/${anlass.id}` },
            anlass.titel,
          ),
        ),
    ),
    el(
      "a",
      {
        class: "knopf knopf--klein knopf--still",
        href: `#personen/gruppen/${gruppe.id}`,
      },
      "Mitglieder der Gruppe",
    ),
  );

  const neueRolle = knopf("Neue Rolle", {
    art: "haupt",
    symbol: "plus",
    onclick: () =>
      neueRolleSeite(z, {
        art: "gruppe",
        gruppe,
        rollen,
        danach: () => z.neu(),
      }),
  });
  const vorlage = knopf("Rollen aus anderer Gruppe übernehmen", {
    symbol: "kopieren",
    onclick: () => vorlageSeite(z, daten),
  });
  const ohneEigene = rollen.every((r) => r.system);
  const vorschlag =
    gruppe.typ === "anlass" && ohneEigene
      ? knopf("Rollen vorschlagen lassen", {
          symbol: "stern",
          onclick: () => vorschlagsSeite(z, daten),
        })
      : null;

  const rollenFlaeche = el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": "rr-rollen-titel" },
    el(
      "div",
      { class: "rr-kopfzeile" },
      el("h3", { id: "rr-rollen-titel" }, `Rollen (${rollen.length})`),
      el("div", { class: "reihe" }, neueRolle, vorschlag, vorlage),
    ),
    el(
      "p",
      { class: "klein leise" },
      "Jede Person hat in einer Gruppe höchstens eine Rolle. Die Reihenfolge ist nur die Anzeige.",
    ),
    sortierung(z, rollen, gruppe),
  );

  haenge(
    inhalt,
    zurueckLink("Alle Gruppen", adresse("gruppen")),
    kopf,
    rollenFlaeche,
    rollen.length > 0 &&
      el(
        "section",
        { class: "flaeche rr-flaeche", "aria-labelledby": "rr-matrix-titel" },
        el("h3", { id: "rr-matrix-titel" }, "Rechte der Rollen"),
        el(
          "p",
          { class: "klein leise" },
          "Stelle ein, was jede Rolle darf. Änderungen bleiben im Entwurf, bis du unten speicherst. «Eigene» gilt nur für Objekte dieser Gruppe.",
        ),
        rechteRaster({ z, rollen, art: "gruppe" }).wurzel,
      ),
    festePunkte(z),
  );
}

// Die Rollen als Liste mit Griff (Ziehen, Tastatur, Hoch und Runter); die neue Reihenfolge gilt sofort
function sortierung(z, rollen, gruppe) {
  if (rollen.length === 0) {
    return leerKarte("Diese Gruppe hat noch keine Rolle. Lege die erste an.");
  }
  const eintraege = rollen.map((r) => ({
    id: r.id,
    text: r.name,
    inhalt: el(
      "div",
      { class: "rr-rollenzeile" },
      el(
        "a",
        {
          class: "rr-rollenlink",
          href: adresse("gruppen", gruppe.id, "rolle", r.id),
        },
        r.name,
      ),
      r.system &&
        el("span", { class: "rr-marke rr-marke--system" }, "Eingebaut"),
      el(
        "span",
        { class: "klein leise" },
        `${personenText(r.personen.length)} · ${rechteText(r.rechte.length)}`,
      ),
      r.beschreibung &&
        el("span", { class: "klein leise rr-beschr" }, r.beschreibung),
    ),
  }));
  return sortierListe({
    beschriftung: `Rollen in ${gruppe.name}`,
    eintraege,
    mitRueckgaengig: z.ctx.mitRueckgaengig,
    aktionstext: "Reihenfolge der Rollen geändert",
    beiNeu: async (ids) => {
      // Jede Rolle, die ihren Platz wechselt, bekommt ihre neue Nummer; die Version läuft mit
      for (const [i, id] of ids.entries()) {
        const r = rollen.find((x) => x.id === id);
        if (r.reihenfolge === i + 1) continue;
        const antwort = await aendereRolle(r, {
          version: r.version,
          reihenfolge: i + 1,
        });
        r.version = antwort.version;
        r.reihenfolge = i + 1;
      }
    },
  }).wurzel;
}

// Was fest ist und sich nirgends einstellen lässt: der Katalog nennt die Rechte der Art «fest» und «Struktur»
export function festePunkte(z) {
  const fest = z.katalog.rechte.filter((r) => r.art !== "vergebbar");
  return el(
    "details",
    { class: "flaeche rr-flaeche rr-fest-block" },
    el(
      "summary",
      {},
      icon("sperre"),
      "Was fest ist und sich nicht einstellen lässt",
    ),
    el(
      "ul",
      { class: "rr-feste-liste" },
      FESTE_PUNKTE.map((p) =>
        el(
          "li",
          {},
          el("strong", {}, p.titel),
          el("span", { class: "klein leise" }, p.text),
        ),
      ),
      fest.map((r) =>
        el(
          "li",
          {},
          el("strong", {}, r.klartext),
          el(
            "span",
            { class: "klein leise" },
            `${r.erklaerung} ${r.art === "struktur" ? "Das folgt aus der Beziehung zur Person und bleibt immer so." : "Nur die Abteilungsleitung hat es, und es lässt sich nicht vergeben."}`,
          ),
        ),
      ),
    ),
  );
}

// ---------- Eine Rolle ----------

function zeigeRolle(inhalt, z, daten, rolleId) {
  const { gruppe, rollen, mitglieder } = daten;
  const rolle = rollen.find((r) => r.id === rolleId);
  if (!rolle) {
    haenge(
      inhalt,
      zurueckLink(`Zurück zu «${gruppe.name}»`, adresse("gruppen", gruppe.id)),
      leerKarte("Diese Rolle gibt es nicht mehr."),
    );
    return;
  }
  z.ctx.titel(rolle.name, `Rolle in «${gruppe.name}»`);
  z.ctx.kopfAktion();
  const fragenOrt = el("div", { class: "rr-fragen" });
  const bearbeiten = knopf("Name und Beschreibung", {
    symbol: "bearbeiten",
    klein: true,
    onclick: () =>
      rolleBearbeitenSeite(z, rolle, {
        aendere: (felder) => aendereRolle(rolle, felder),
        danach: () => z.neu(),
      }),
  });
  const loeschen = rolle.system
    ? null
    : knopf("Rolle löschen", {
        art: "gefahr",
        klein: true,
        symbol: "papierkorb",
        onclick: (e) =>
          rolleLoeschenFrage(z, rolle, {
            ort: fragenOrt,
            ausloeser: e.currentTarget,
            danach: () => (location.hash = adresse("gruppen", gruppe.id)),
          }),
      });
  // Mitglieder der Gruppe mit ihrer heutigen Rolle: für die Zuordnung und den Zusatz «heute …»
  const rollenName = new Map(rollen.map((r) => [r.id, r.name]));
  const personRolle = new Map();
  for (const r of rollen)
    for (const p of r.personen) personRolle.set(p.id, r.id);
  const mitgliedMap = new Map(
    mitglieder.map((m) => [
      m.userId,
      { rolleName: rollenName.get(personRolle.get(m.userId)) },
    ]),
  );
  // An einer Stufe folgen Leitung und Stufenleitung der Stufenzuordnung der Person; hier ändern sie sich nicht
  const stufenRolle =
    gruppe.typ === "stufe" &&
    (rolle.schluessel === "leitung" || rolle.schluessel === "stufenleitung");

  haenge(
    inhalt,
    zurueckLink(`Zurück zu «${gruppe.name}»`, adresse("gruppen", gruppe.id)),
    rolleKopf(rolle, el("div", { class: "reihe" }, bearbeiten, loeschen)),
    fragenOrt,
    el(
      "section",
      { class: "flaeche rr-flaeche", "aria-labelledby": "rr-rechte-titel" },
      el("h3", { id: "rr-rechte-titel" }, "Rechte"),
      el(
        "p",
        { class: "klein leise" },
        "Wähle bei jedem Recht, ob die Rolle es nicht, nur für diese Gruppe («Eigene») oder für alle hat. Änderungen bleiben im Entwurf, bis du unten speicherst.",
      ),
      rechteRaster({ z, rollen: [rolle], art: "gruppe", einzel: true }).wurzel,
    ),
    personenBlock(z, rolle, {
      mitglieder: mitgliedMap,
      schreibgeschuetzt: stufenRolle
        ? "Diese Rolle folgt der Stufenzuordnung der Person. Ändere sie bei der Person unter «Personen»."
        : undefined,
    }),
    festePunkte(z),
  );
}

// ---------- Rollen aus einer anderen Gruppe übernehmen ----------

function vorlageSeite(z, daten) {
  const { gruppe, rollen: hier } = daten;
  const quellen = z.gruppen.filter((g) => g.id !== gruppe.id && g.rollen > 0);
  if (quellen.length === 0) {
    z.ctx.melde(
      "Keine andere Gruppe hat Rollen, die du übernehmen könntest.",
      "warn",
    );
    return null;
  }
  const wahl = auswahl({
    label: "Gruppe, aus der du Rollen übernimmst",
    optionen: [
      ["", "Gruppe wählen"],
      ...quellen.map((g) => [g.id, `${g.name} (${typText(g.typ)})`]),
    ],
    wert: "",
  });
  const liste = el("div", { class: "rr-vorlageliste" });
  const hinweis = el("p", { class: "klein leise", role: "status" });
  const kisten = [];
  wahl.eingabe.addEventListener("change", async () => {
    liste.replaceChildren();
    kisten.length = 0;
    const id = wahl.eingabe.value;
    if (!id) {
      hinweis.textContent = "";
      return;
    }
    hinweis.textContent = "Die Rollen werden geladen.";
    try {
      const quelle = await ladeGruppe(id);
      if (wahl.eingabe.value !== id) return;
      const angebot = quelle.rollen.filter((r) => !r.system);
      hinweis.textContent =
        angebot.length === 0
          ? "Diese Gruppe hat nur eingebaute Rollen. Die hat jede Gruppe schon."
          : "Wähle die Rollen. Sie kommen mit ihren Rechten; «Eigene» gilt danach für diese Gruppe.";
      if (angebot.length === 0) return;
      liste.append(
        fieldset(
          "Rollen",
          el(
            "ul",
            { class: "rr-vorlagekisten" },
            angebot.map((r) => {
              const idK = neueId("vorlage");
              const kiste = el("input", {
                type: "checkbox",
                id: idK,
                checked: true,
              });
              kisten.push([r, kiste]);
              const vorhanden = hier.some(
                (h) => h.name.toLowerCase() === r.name.toLowerCase(),
              );
              return el(
                "li",
                { class: "wahl" },
                kiste,
                el(
                  "label",
                  { for: idK },
                  r.name,
                  el(
                    "span",
                    { class: "klein leise" },
                    ` ${rechteText(r.rechte.length)}${vorhanden ? ". Gibt es hier schon, wird mit Nummer angelegt" : ""}`,
                  ),
                ),
              );
            }),
          ),
        ),
      );
    } catch (f) {
      hinweis.textContent = text(f);
    }
  });
  return dialogFormular({
    titel: "Rollen übernehmen",
    beschreibung: `Kopiere Rollen samt Rechten nach «${gruppe.name}». Personen kommen nicht mit.`,
    felder: [wahl.wurzel, hinweis, liste],
    ok: "Rollen übernehmen",
    fehlertext: (f) => f.teilweise ?? text(f),
    pruefe: () => {
      if (kisten.some(([, k]) => k.checked)) return false;
      hinweis.textContent = "Wähle eine Gruppe und mindestens eine Rolle.";
      return true;
    },
    senden: async () => {
      const gewaehlt = kisten.filter(([, k]) => k.checked).map(([r]) => r);
      const namen = new Set(hier.map((h) => h.name.toLowerCase()));
      const fehler = [];
      let ok = 0;
      for (const r of gewaehlt) {
        let name = r.name;
        for (let n = 2; namen.has(name.toLowerCase()); n++) {
          name = `${r.name.slice(0, 44)} (${n})`;
        }
        try {
          await legeRolleAn(gruppe.id, {
            name,
            beschreibung: r.beschreibung,
            rechte: r.rechte,
          });
          namen.add(name.toLowerCase());
          ok++;
        } catch (f) {
          fehler.push(`«${r.name}»: ${text(f)}`);
        }
      }
      if (fehler.length > 0) {
        throw Object.assign(new Error("teilweise"), {
          teilweise: `${ok > 0 ? `${rollenText(ok)} angelegt. ` : ""}${fehler.join(" ")}`,
        });
      }
      return { ok };
    },
    danach: ({ ok }) => {
      z.ctx.melde(
        ok === 1 ? "1 Rolle übernommen." : `${ok} Rollen übernommen.`,
      );
      z.neu();
    },
  });
}

// Für eine Anlass-Gruppe, die noch keine eigenen Rollen hat: die üblichen Rollen eines OK anbieten (Leitung, Kasse, Kommunikation, Helfende)
function vorschlagsSeite(z, daten) {
  const { gruppe } = daten;
  const zeilen = vorschlaegeKarten(z, vorschlaegeFuer(z.katalog));
  return dialogFormular({
    titel: "Rollen für das OK vorschlagen",
    beschreibung:
      "Diese Rollen braucht ein OK meistens. Streiche, was du nicht brauchst, benenne um und füge eigene hinzu. Die Rechte stellst du danach in der Matrix ein.",
    felder: [zeilen.wurzel],
    ok: "Rollen anlegen",
    fehlertext: (f) => f.teilweise ?? text(f),
    pruefe: () => zeilen.pruefe(),
    senden: async () => {
      const fehler = [];
      let ok = 0;
      for (const r of zeilen.wert()) {
        try {
          await legeRolleAn(gruppe.id, r);
          ok++;
        } catch (f) {
          fehler.push(`«${r.name}»: ${text(f)}`);
        }
      }
      if (fehler.length > 0) {
        throw Object.assign(new Error("teilweise"), {
          teilweise: `${ok > 0 ? `${rollenText(ok)} angelegt. ` : ""}${fehler.join(" ")}`,
        });
      }
      return { ok };
    },
    danach: ({ ok }) => {
      z.ctx.melde(ok === 1 ? "1 Rolle angelegt." : `${ok} Rollen angelegt.`);
      z.neu();
    },
  });
}

// Zeilen mit Haken, Name und den vorgeschlagenen Rechten (zur Ansicht); eigene Zeilen lassen sich dazufügen. Gebraucht vom Vorschlag hier und beim Anlegen eines OK am Anlass
export function vorschlaegeKarten(z, vorschlaege) {
  const wurzel = el("div", { class: "rr-vorschlaege" });
  const liste = el("ul", { class: "rr-vorschlagliste" });
  const zeilen = [];
  function neueZeile(v, eigen = false) {
    const haken = el("input", {
      type: "checkbox",
      checked: true,
      "aria-label": `Rolle anlegen: ${v.name || "neue Rolle"}`,
    });
    const name = el("input", {
      class: "eingabe",
      type: "text",
      maxlength: "50",
      "aria-label": "Name der Rolle",
      placeholder: "Name der Rolle",
    });
    name.value = v.name;
    const li = el(
      "li",
      { class: "rr-vorschlagzeile" },
      el("div", { class: "wahl" }, haken),
      el(
        "div",
        { class: "rr-vorschlagtext" },
        name,
        el(
          "span",
          { class: "klein leise" },
          v.rechte.length === 0
            ? v.beschreibung || "Ohne Rechte, die stellst du danach ein."
            : `${v.beschreibung ? `${v.beschreibung} ` : ""}Rechte: ${v.rechte.map((x) => `${z.klartext(x.recht)}${x.geltung === "eigene" ? " (eigene)" : ""}`).join(", ")}.`,
        ),
      ),
      eigen &&
        knopf("Entfernen", {
          klein: true,
          art: "still",
          symbol: "schliessen",
          onclick: () => {
            li.remove();
            zeilen.splice(
              zeilen.findIndex((x) => x.li === li),
              1,
            );
          },
        }),
    );
    zeilen.push({ li, haken, name, v });
    liste.append(li);
    return name;
  }
  vorschlaege.forEach((v) => neueZeile(v));
  const dazu = knopf("Eigene Rolle hinzufügen", {
    klein: true,
    symbol: "plus",
    onclick: () =>
      neueZeile({ name: "", beschreibung: "", rechte: [] }, true).focus(),
  });
  const fehler = el("p", { class: "feld-fehler", role: "alert", hidden: true });
  wurzel.append(liste, el("div", { class: "reihe" }, dazu), fehler);
  return {
    wurzel,
    pruefe() {
      const gewaehlt = zeilen.filter((x) => x.haken.checked);
      const namen = gewaehlt.map((x) => x.name.value.trim().toLowerCase());
      const leer = gewaehlt.some((x) => x.name.value.trim() === "");
      const doppelt = new Set(namen).size !== namen.length;
      fehler.hidden = !(leer || doppelt);
      fehler.textContent = leer
        ? "Jede gewählte Rolle braucht einen Namen."
        : doppelt
          ? "Zwei Rollen heissen gleich. Gib jeder einen eigenen Namen."
          : "";
      return leer || doppelt;
    },
    wert: () =>
      zeilen
        .filter((x) => x.haken.checked)
        .map((x, i) => ({
          name: x.name.value.trim(),
          // In der Reihenfolge der Zeilen, hinter den eingebauten Rollen
          reihenfolge: i + 2,
          beschreibung: x.v.beschreibung || null,
          rechte: x.v.rechte,
        })),
  };
}
