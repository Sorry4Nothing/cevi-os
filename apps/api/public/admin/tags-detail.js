import { anfrage, fehlertext } from "./api.js";
import { flussOffen } from "./fluss.js";
import { auswahl, chip, dialogFormular, el, feld, icon, knopf } from "./dom.js";
import {
  entferneFehler,
  feldFehler,
  mitFehlertitel,
  pruefHinweis,
} from "./liste-hilfen.js";
import {
  abschnitte,
  ansichtsleiste,
  gliedere,
  mitgliedKarte,
  mitgliedKopf,
  zeichneAnsicht,
} from "./mitglieder.js";
import { kandidatenSuche } from "./personen-wahl.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { zurueckKlick } from "./verlauf.js";
import { anlassKarte, anlassText, ladeFreieAnlaesse } from "./tags-anlass.js";
import { raeumeKarte } from "./tags-raeume.js";
import { rollenName } from "./rollenname.js";

// Gruppe (= Tag der Abteilung): Dialoge zum Anlegen, Umbenennen, Löschen und für die Mitglieder, dazu die Detailseite A5 (#personen/gruppen/<id>)
export const TYPEN = [
  ["stufe", "Stufe"],
  ["funktion", "Funktion"],
  ["team", "Team"],
  ["lager", "Lager"],
  ["anlass", "Anlass"],
];
export const typName = (typ) => TYPEN.find(([w]) => w === typ)?.[1] ?? typ;
export const mitglieder = (n) => (n === 1 ? "1 Mitglied" : `${n} Mitglieder`);
const anzahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);

// Sperrt ein Formular während des Speicherns (A4 «Speichert»): Felder nur lesbar, Knopf mit Ladekreis
export function sperre(dialog, an) {
  for (const e of dialog.querySelectorAll(".formular input")) e.readOnly = an;
  for (const e of dialog.querySelectorAll(".formular .auswahl-knopf")) {
    e.disabled = an;
  }
  dialog
    .querySelector('.formular button[type="submit"]')
    ?.setAttribute("aria-busy", String(an));
}

// Auswahlfeld mit sichtbarem Bedienelement für Fehler und Fokus.
// dom.js baut das Feld vor dem Einsetzen: Dann findet auswahl.js das Label nicht, und Knopf und Liste hätten keinen Namen. Darum hier verknüpft
const mitFokus = (a) => {
  const knopf = a.wurzel.querySelector(".auswahl-knopf");
  const label = a.wurzel.querySelector("label");
  if (knopf && label && !knopf.hasAttribute("aria-labelledby")) {
    knopf.setAttribute("aria-labelledby", label.id);
    a.wurzel
      .querySelector("[role=listbox]")
      ?.setAttribute("aria-labelledby", label.id);
  }
  return { ...a, fokus: knopf };
};

// Neue Gruppe (A4) oder Umbenennen; danach(ergebnis) läuft nach dem Schliessen
// anlass (nur beim Anlegen, #626): ein Anlass aus der Liste der Anlässe; dann entsteht eine Gruppe vom Typ «anlass» für ihn, ohne Auswahl von Typ und Anlass
export function tagDialog({ tag, ctx, neu, danach, anlass }) {
  const typ =
    tag || anlass
      ? null
      : mitFokus(
          auswahl({
            label: "Typ",
            optionen: [["", "Bitte wählen"], ...TYPEN],
            wert: "",
          }),
        );
  // Das Auswahlfeld für den Anlass erscheint erst beim Typ «Anlass»; die Liste kommt dann mit einer Abfrage
  const anlassWahl =
    tag || anlass
      ? null
      : mitFokus(
          auswahl({
            label: "Anlass",
            optionen: [["", "Anlass wählen"]],
            wert: "",
          }),
        );
  const anlassHinweis = el("p", { class: "klein leise", role: "status" });
  if (anlassWahl) {
    anlassWahl.wurzel.hidden = true;
    anlassWahl.wurzel.append(anlassHinweis);
  }
  let anlaesseGeladen = false;
  async function ladeAnlaesse() {
    if (anlaesseGeladen) return;
    anlaesseGeladen = true;
    anlassHinweis.textContent = "Die Anlässe werden geladen.";
    try {
      const frei = await ladeFreieAnlaesse();
      anlassWahl.eingabe.replaceChildren(
        el("option", { value: "" }, "Anlass wählen"),
        ...frei.map((a) => el("option", { value: a.id }, anlassText(a))),
      );
      anlassWahl.eingabe.value = "";
      anlassHinweis.textContent =
        frei.length === 0
          ? "Es gibt keinen Anlass ohne Gruppe. Lege zuerst einen Anlass an."
          : "Der Name gilt in der ganzen Abteilung nur einmal: Nimm den Anlass in den Namen auf.";
    } catch (fehler) {
      anlaesseGeladen = false;
      anlassHinweis.textContent = `Die Anlässe konnten nicht geladen werden. ${fehlertext(fehler)} Wähle den Typ nochmals.`;
    }
  }
  const istAnlassTyp = () => !!anlass || typ?.eingabe.value === "anlass";
  typ?.eingabe.addEventListener("change", () => {
    const an = typ.eingabe.value === "anlass";
    anlassWahl.wurzel.hidden = !an;
    if (an) ladeAnlaesse();
  });
  const name = feld({
    label: "Name",
    wert: tag?.name ?? "",
    maxlength: 100,
    "aria-required": "true",
  });
  const kuerzel = feld({
    label: "Kürzel (optional)",
    hilfe: "Höchstens 20 Zeichen.",
    wert: tag?.kuerzel ?? "",
    maxlength: 20,
  });
  const zusammenfassung = el("div", { class: "pe-zusammenfassung" });
  const nichtGespeichert = tag
    ? "Die Änderung wurde nicht gespeichert."
    : "Die Gruppe wurde nicht erstellt.";
  const dialog = dialogFormular({
    titel: tag ? "Gruppe umbenennen" : "Neue Gruppe",
    beschreibung: tag
      ? `${tag.name} · ${typName(tag.typ)}. Der Typ lässt sich nicht ändern.`
      : anlass
        ? `Gruppe zum Anlass «${anlass.titel}». Der Name gilt in der ganzen Abteilung nur einmal: Nimm den Anlass in den Namen auf.`
        : "Der Typ lässt sich später nicht mehr ändern.",
    felder: [
      zusammenfassung,
      name.wurzel,
      typ?.wurzel,
      anlassWahl?.wurzel,
      kuerzel.wurzel,
    ].filter(Boolean),
    ok: tag ? "Speichern" : "Erstellen",
    pruefe: () => {
      zusammenfassung.replaceChildren();
      const fehler = [];
      entferneFehler(name);
      if (typ) entferneFehler(typ);
      if (anlassWahl) entferneFehler(anlassWahl);
      if (!name.eingabe.value.trim()) {
        feldFehler(name, "Gib einen Namen ein.");
        fehler.push({ name: "Name", ...name });
      }
      if (typ && !typ.eingabe.value) {
        feldFehler(typ, "Wähle einen Typ.");
        fehler.push({ name: "Typ", ...typ });
      }
      if (anlassWahl && istAnlassTyp() && !anlassWahl.eingabe.value) {
        feldFehler(anlassWahl, "Wähle einen Anlass.");
        fehler.push({ name: "Anlass", ...anlassWahl });
      }
      if (fehler.length === 0) return false;
      const hinweis = pruefHinweis(fehler);
      zusammenfassung.append(hinweis);
      hinweis.focus();
      return true;
    },
    senden: async () => {
      sperre(dialog, true);
      try {
        const neuerName = name.eingabe.value.trim();
        const neuesKuerzel = kuerzel.eingabe.value.trim();
        if (!tag) {
          return await anfrage("POST", "/api/v1/admin/tags", {
            typ: anlass ? "anlass" : typ.eingabe.value,
            name: neuerName,
            ...(neuesKuerzel && { kuerzel: neuesKuerzel }),
            ...(anlass && { anlassId: anlass.id }),
            ...(anlassWahl &&
              istAnlassTyp() && { anlassId: anlassWahl.eingabe.value }),
          });
        }
        // Ein Kürzel lässt sich ändern, aber nicht leeren: Die API verlangt mindestens ein Zeichen
        return await anfrage("PATCH", `/api/v1/admin/tags/${tag.id}`, {
          ...(neuerName !== tag.name && { name: neuerName }),
          ...(neuesKuerzel && neuesKuerzel !== tag.kuerzel
            ? { kuerzel: neuesKuerzel }
            : {}),
        });
      } finally {
        sperre(dialog, false);
      }
    },
    fehlertext: (f) => {
      if (f.code === "TAGNAME_VERGEBEN") {
        feldFehler(
          name,
          `Eine Gruppe «${name.eingabe.value.trim()}» gibt es schon. Wähle einen anderen Namen.`,
        );
        return `${nichtGespeichert} Der Name ist schon vergeben.`;
      }
      if (f.code === "ANLASS_HAT_GRUPPE" || f.code === "ANLASS_UNBEKANNT") {
        if (anlassWahl) feldFehler(anlassWahl, "Wähle einen anderen Anlass.");
        return `${nichtGespeichert} ${f.message}`;
      }
      return `${nichtGespeichert} ${fehlertext(f)} Deine Eingaben sind noch da, versuche es nochmals.`;
    },
    danach: (ergebnis) => {
      neu();
      ctx.melde(
        tag
          ? "Gespeichert."
          : `Gruppe «${name.eingabe.value.trim()}» ist erstellt.`,
      );
      danach?.(ergebnis);
    },
  });
  dialog.classList.add("pe-dialog");
}

// Mit «Rückgängig» (#578): Die Zeile verschwindet sofort, gelöscht wird nach der Frist. Trägt noch jemand die Gruppe, gibt es keine Aktion, nur den Hinweis
export function tagLoeschen({ tag, anzahl, ctx, neu, danach, ereignis }) {
  const n = anzahl ?? tag.anzahlPersonen ?? 0;
  if (n > 0) {
    ctx.melde(
      `${anzahlText(n, "1 Person trägt", "Personen tragen")} «${tag.name}» noch. Entferne zuerst alle Mitglieder und lösche die Gruppe danach.`,
      "warn",
    );
    return;
  }
  ctx.mitRueckgaengig({
    text: `Gruppe «${tag.name}» gelöscht`,
    ansicht: ansichtVonKnopf(ereignis),
    ausfuehren: () => anfrage("DELETE", `/api/v1/admin/tags/${tag.id}`),
    fehlertext: (f) => {
      if (f.code !== "TAG_BELEGT") return fehlertext(f);
      const m = f.verwendung?.personen;
      return `${typeof m === "number" ? `${anzahlText(m, "1 Person trägt", "Personen tragen")} die Gruppe` : "Personen tragen die Gruppe"} noch. Entferne zuerst alle Mitglieder und lösche sie danach.`;
    },
    danach: () => {
      neu();
      danach?.();
    },
  });
}

// Die Rollen «leitung» und «stufenleitung» kommen aus den Stufenrollen der Personen und stehen als Rohwert in der Gruppe der Stufe
const ROLLENNAME = { leitung: "Leitung", stufenleitung: "Stufenleitung" };
// geschlecht (#817): Die Person bestimmt die Form der Stufenrolle («Stufenleiterin»); freie Rollen bleiben, wie sie sind. Die Gruppierung nach Funktion und die Reihenfolge nutzen die neutrale Form ohne Geschlecht
const rolleText = (roh, geschlecht) =>
  roh in ROLLENNAME ? rollenName(roh, geschlecht) : (roh ?? "");
const neutralText = (roh) => ROLLENNAME[roh] ?? roh ?? "";
// Wer in einer Stufe Leitung oder Stufenleitung ist, hat die Zuordnung und die Rolle bei der Person bekommen (Rechte und Rollen); hier lässt sie sich nicht ändern, sonst fiele die Stufenrolle still weg
const istStufenrolle = (tag, m) => tag.typ === "stufe" && m.rolle in ROLLENNAME;

const rolleHilfe = (typ) =>
  typ === "stufe"
    ? "Freier Text, höchstens 50 Zeichen. Die Rollen «Leitung» und «Stufenleitung» vergibst du bei der Person."
    : "Freier Text, höchstens 50 Zeichen.";

export function zeigeDetail(bereich, ctx, id) {
  ctx.lade(
    mitFehlertitel("Die Mitglieder konnten nicht geladen werden.", async () => {
      const [tag, personen] = await Promise.all([
        anfrage("GET", `/api/v1/admin/tags/${encodeURIComponent(id)}`),
        anfrage("GET", "/api/v1/admin/personen"),
      ]);
      return { tag, personen: personen.personen };
    }),
    (daten, neu) => zeichneDetail(bereich, ctx, daten, neu),
  );
}

// Gruppe mit Mitgliederliste (Muster «team-member-list»: Live-Filter, Entfernen mit Rückgängig) und Karte zum Hinzufügen (Muster «team-invite-card»)
// Änderungen erscheinen sofort in der Liste; die Anfrage geht nach der Frist (ctx.mitRueckgaengig), bei einem Fehler kommt der alte Stand zurück
function zeichneDetail(bereich, ctx, { tag, personen }, neu) {
  const bekannt = new Map(personen.map((p) => [p.id, p]));
  let mitgliederListe = tag.personen.map((e) => ({
    userId: e.userId,
    rolle: e.rolle ?? null,
  }));
  const kandidatenListe = () =>
    personen
      .filter(
        (p) =>
          !p.deaktiviert && !mitgliederListe.some((m) => m.userId === p.id),
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        zusatz: p.ceviName ?? undefined,
        bildUrl: p.bildUrl,
      }));
  const kopfZeile = () =>
    ctx.titel(
      tag.name,
      `${typName(tag.typ)} · ${mitglieder(mitgliederListe.length)}`,
    );
  kopfZeile();
  if (!flussOffen()) document.querySelector("h1")?.focus();
  ctx.kopfAktion(
    knopf("Umbenennen", {
      symbol: "bearbeiten",
      onclick: () => tagDialog({ tag, ctx, neu }),
    }),
  );

  // «Zurück» steht über dem Titel der Seite, im Kopf der Ansicht
  const zurueck = el(
    "a",
    {
      class: "knopf knopf--still knopf--klein pe-zurueck",
      href: "#personen/gruppen",
      onclick: zurueckKlick,
    },
    icon("zurueck"),
    "Zurück",
  );

  const nameVon = (m) => bekannt.get(m.userId)?.name ?? "Unbekannte Person";
  const geschlechtVon = (m) => bekannt.get(m.userId)?.geschlecht;
  const zusatzVon = (m) => {
    const p = bekannt.get(m.userId);
    return [p?.ceviName, p?.deaktiviert && "deaktiviert"]
      .filter(Boolean)
      .join(" · ");
  };

  const liste = el("div", { class: "mg-ansicht" });
  const ansicht = ansichtsleiste({
    gruppierungen: [
      ["keine", "Keine"],
      ["funktion", "Funktion"],
    ],
    gruppierung: "keine",
    beiAenderung: () => zeichneListe(true),
  });
  const stand = el("p", { class: "klein leise", role: "status" });
  const filterId = `mitglieder-filter-${tag.id}`;
  const filter = el("input", {
    class: "eingabe",
    id: filterId,
    type: "search",
    placeholder: "Mitglieder filtern",
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => zeichneListe(),
  });
  const suche = kandidatenSuche({
    beschriftung: "Person suchen",
    kandidaten: kandidatenListe(),
    leerText: "Es gibt keine aktive Person, die du hinzufügen könntest.",
    beiWahl: (k) => hinzufuegen(k),
  });
  const mitgliederTitel = el("h2", { tabindex: "-1" }, "Mitglieder");
  const leerText = el(
    "p",
    { class: "leise pe-keiner" },
    "Die Gruppe hat noch keine Mitglieder. Suche eine Person und füge sie hinzu.",
  );
  const keineTreffer = el(
    "p",
    { class: "leise pe-keiner", hidden: true },
    "Kein Mitglied passt zum Filter.",
  );
  const filterFeld = el(
    "div",
    { class: "suche" },
    el("label", { class: "nur-leser", for: filterId }, "Mitglieder filtern"),
    icon("lupe"),
    filter,
  );

  function rolleZelle(m) {
    return el(
      "div",
      { class: "pe-rolle" },
      el(
        "ul",
        { class: "chips" },
        chip(
          m.rolle ? rolleText(m.rolle, geschlechtVon(m)) : "ohne Funktion",
          undefined,
          false,
        ),
      ),
      istStufenrolle(tag, m)
        ? el("span", { class: "klein leise" }, "Bei der Person ändern")
        : knopf("Rolle ändern", {
            klein: true,
            art: "still",
            symbol: "bearbeiten",
            kontext: nameVon(m),
            onclick: () => bearbeite(m),
          }),
    );
  }

  // Die Rolle wird in der Zeile bearbeitet: Eingabe mit Enter speichern, Escape bricht ab, kein eigenes Fenster
  function bearbeite(m) {
    const f = feld({
      label: `Rolle von ${nameVon(m)}`,
      wert: m.rolle ?? "",
      maxlength: 50,
      hilfe: rolleHilfe(tag.typ),
    });
    const speichern = knopf("Speichern", { klein: true, art: "haupt" });
    const abbrechen = knopf("Abbrechen", { klein: true, art: "still" });
    const fertig = () => {
      zeichneListe();
      liste.querySelector(`[data-id="${m.userId}"] .pe-rolle button`)?.focus();
    };
    const sende = async () => {
      const neuerWert = f.eingabe.value.trim() || null;
      speichern.disabled = abbrechen.disabled = true;
      speichern.setAttribute("aria-busy", "true");
      try {
        await anfrage(
          "PUT",
          `/api/v1/admin/tags/${tag.id}/personen/${m.userId}`,
          { rolle: neuerWert },
        );
        m.rolle = neuerWert;
        ctx.melde("Rolle ist gespeichert.");
        fertig();
      } catch (fehler) {
        speichern.disabled = abbrechen.disabled = false;
        speichern.removeAttribute("aria-busy");
        feldFehler(f, `Nicht gespeichert. ${fehlertext(fehler)}`);
        f.eingabe.focus();
      }
    };
    speichern.addEventListener("click", sende);
    abbrechen.addEventListener("click", fertig);
    f.eingabe.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sende();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        fertig();
      }
    });
    liste
      .querySelector(`[data-id="${m.userId}"] .pe-rolle`)
      .replaceWith(
        el(
          "div",
          { class: "pe-rolle pe-rolle--offen" },
          f.wurzel,
          el("div", { class: "aktionen" }, speichern, abbrechen),
        ),
      );
    f.eingabe.focus();
  }

  const funktion = (m) => (m.rolle ? neutralText(m.rolle) : "");
  // Die Funktionen mit Stufenrolle zuerst, die übrigen nach Name, «Ohne Funktion» zuletzt
  const funktionsRang = (n) =>
    n === "" ? 3 : ["Stufenleitung", "Leitung"].indexOf(n) + 1 || 2;
  const entfernenKnopf = (m) =>
    !istStufenrolle(tag, m) &&
    knopf("Entfernen", {
      klein: true,
      art: "still",
      symbol: "schliessen",
      kontext: nameVon(m),
      onclick: () => entfernen(m),
    });
  const kopfVon = (m, gross) =>
    mitgliedKopf({
      name: nameVon(m),
      // Unbekannte Person: der Platzhaltertext ist kein Name, dessen erstes Wort zählt
      ceviName: bekannt.get(m.userId)?.ceviName ?? nameVon(m),
      zusatz: bekannt.get(m.userId)?.deaktiviert ? "deaktiviert" : undefined,
      bildUrl: bekannt.get(m.userId)?.bildUrl,
      gross,
    });
  const karte = (m) =>
    mitgliedKarte({
      id: m.userId,
      kopf: kopfVon(m, true),
      rollen: rolleZelle(m),
      aktionen: entfernenKnopf(m),
    });
  const zeile = (m) =>
    el(
      "li",
      { class: "pe-mitglied", "data-id": m.userId },
      kopfVon(m, false),
      rolleZelle(m),
      entfernenKnopf(m),
    );

  function zeichneListe(animiert = false) {
    const frage = filter.value.trim().toLowerCase();
    const sortiert = [...mitgliederListe].sort((a, b) =>
      nameVon(a).localeCompare(nameVon(b), "de-CH"),
    );
    const treffer = sortiert.filter((m) =>
      `${nameVon(m)} ${zusatzVon(m)} ${neutralText(m.rolle)} ${rolleText(m.rolle, geschlechtVon(m))}`
        .toLowerCase()
        .includes(frage),
    );
    const { ansicht: art, gruppierung } = ansicht.stand();
    const gruppen =
      gruppierung === "funktion"
        ? [...new Set(treffer.map(funktion))]
            .sort(
              (a, b) =>
                funktionsRang(a) - funktionsRang(b) ||
                a.localeCompare(b, "de-CH"),
            )
            .map((n) => ({ schluessel: n, titel: n || "Ohne Funktion" }))
        : null;
    const { geordnet, gesamt } = gliedere(treffer, gruppen, funktion);
    zeichneAnsicht(liste, {
      ansicht: art,
      beschriftung: `Mitglieder von «${tag.name}»`,
      abschnitte: abschnitte(geordnet, gruppen, funktion, gesamt),
      karte,
      zeile,
      animiert,
      ebene: "h3",
    });
    stand.textContent =
      mitgliederListe.length === 0
        ? ""
        : frage
          ? `${treffer.length} von ${mitglieder(mitgliederListe.length)}`
          : mitglieder(mitgliederListe.length);
    leerText.hidden = mitgliederListe.length !== 0;
    filterFeld.hidden = mitgliederListe.length === 0;
    ansicht.wurzel.hidden = mitgliederListe.length === 0;
    keineTreffer.hidden = !(frage && treffer.length === 0);
    kopfZeile();
    suche.setzeKandidaten(kandidatenListe());
  }

  function entfernen(m) {
    let stelle = 0;
    ctx.mitRueckgaengig({
      text: `${nameVon(m)} aus «${tag.name}» entfernt`,
      ansicht: {
        weg: () => {
          stelle = mitgliederListe.indexOf(m);
          mitgliederListe = mitgliederListe.filter((x) => x !== m);
          zeichneListe();
          // Die Zeile mit dem Fokus ist weg: Der Fokus geht zur Überschrift der Karte, nicht ins Suchfeld (dort gilt Strg Z für den Text)
          mitgliederTitel.focus();
        },
        zurueck: () => {
          if (!mitgliederListe.includes(m)) {
            mitgliederListe.splice(Math.max(0, stelle), 0, m);
          }
          zeichneListe();
        },
      },
      ausfuehren: () =>
        anfrage("DELETE", `/api/v1/admin/tags/${tag.id}/personen/${m.userId}`),
      fehlertext,
    });
  }

  function hinzufuegen(k) {
    const m = { userId: k.id, rolle: null };
    ctx.mitRueckgaengig({
      text: `${k.name} zu «${tag.name}» hinzugefügt`,
      ansicht: {
        weg: () => {
          mitgliederListe.push(m);
          zeichneListe();
        },
        zurueck: () => {
          mitgliederListe = mitgliederListe.filter((x) => x !== m);
          zeichneListe();
        },
      },
      ausfuehren: () =>
        anfrage("PUT", `/api/v1/admin/tags/${tag.id}/personen/${k.id}`, {}),
      fehlertext,
    });
  }

  document.querySelector("#seitenkopf .kopf-text")?.prepend(zurueck);
  const anlassInfo = anlassKarte(tag);
  if (anlassInfo) bereich.append(anlassInfo);
  // Räume, für die diese Gruppe das Team ist: sehen, zuweisen, entziehen (#649); Stufen und Lager führen keine Räume
  const raeumeInfo =
    tag.typ === "stufe" || tag.typ === "lager"
      ? null
      : raeumeKarte({ tag, ctx });
  if (raeumeInfo) bereich.append(raeumeInfo);
  bereich.append(
    el(
      "div",
      { class: "pe-gruppe" },
      el(
        "section",
        { class: "pe-karte" },
        mitgliederTitel,
        filterFeld,
        stand,
        leerText,
        keineTreffer,
        ansicht.wurzel,
        liste,
      ),
      tag.typ === "stufe"
        ? el(
            "section",
            { class: "pe-karte" },
            el("h2", {}, "Mitglieder hinzufügen"),
            el(
              "p",
              { class: "leise" },
              "Eine Person weist du der Stufe bei der Person zu: Öffne sie unter «Personen» und wähle bei «Rechte und Rollen» die Stufe und die Rolle. Leitung und Stufenleitung lassen sich nur dort ändern.",
            ),
          )
        : el(
            "section",
            { class: "pe-karte" },
            el("h2", {}, "Mitglieder hinzufügen"),
            el(
              "p",
              { class: "leise" },
              "Die Person ist sofort in der Gruppe. Eine Rolle setzt du danach in der Liste.",
            ),
            suche.wurzel,
          ),
    ),
  );
  zeichneListe(true);
}
