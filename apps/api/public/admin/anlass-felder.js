import { anfrage } from "./api.js";
import { mitRueckgaengig } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import {
  ankreuzen,
  auswahl,
  chip,
  el,
  feld,
  icon,
  knopf,
  neueId,
} from "./dom.js";
import {
  entferneFeldFehler,
  feldFehler,
  pruefHinweis,
  ersetze,
  speicherLeiste,
} from "./kalenderhilfen.js";
import { meldungVon, vergiss } from "./anlass-gemeinsam.js";

// Reiter «Zusatzfelder» eines Anlasses (A18, #445): Was die Anmeldung zusätzlich fragt. Die Felder kommen mit dem Anlass (der Rahmen in termine-anlaesse.js hat ihn geladen); Speichern holt vorher den Stand des Servers (Konflikt) und schreibt dann alle Felder.
// Adresse: #anlaesse/<id>/felder
// Abfragen: keine beim Öffnen (der Anlass ist schon da); «Speichern» 2 (Abgleich mit dem Stand auf dem Server, dann Speichern). Kein Polling. Die Rechte prüft der Server (nur Abteilungsleitung).
// Lücke gegenüber dem Design: Beim Konflikt fehlt der Name der Person, die geändert hat.

const MAX_FELDER = 20;

const TYPEN = [
  ["text", "Text"],
  ["ja_nein", "Ja oder Nein"],
  ["auswahl", "Auswahl aus einer Liste"],
];
const TYP_TEXT = { text: "Text", ja_nein: "Ja/Nein", auswahl: "Auswahl" };
// Aus welcher Angabe der Cevi-Datenbank die Anmeldung ein Textfeld vorausfüllt (#691). Nur diese; nie Gesundheit, nie Rollen
const CEVI_QUELLEN = [
  ["", "Nicht aus der Cevi-Datenbank"],
  ["geburtsdatum", "Geburtsdatum"],
  ["telefon", "Telefon"],
  ["adresse", "Strasse und Nummer"],
  ["plz", "Postleitzahl"],
  ["ort", "Ort"],
  ["email", "E-Mail"],
];
const CEVI_NAME = new Map(CEVI_QUELLEN);
const UMLAUTE = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

// Schlüssel nur aus Kleinbuchstaben, Ziffern und «_» (wie der Server verlangt), eindeutig innerhalb des Anlasses
function schluesselAus(text, vergeben) {
  const basis =
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (z) => UMLAUTE[z])
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "feld";
  let s = basis;
  for (let n = 2; vergeben.has(s); n++) s = `${basis}_${n}`;
  return s;
}

// «Ja/Nein · Pflicht», «Auswahl: 128, 140 · Pflicht», «Text · optional»
const beschreibung = (f) =>
  `${f.typ === "auswahl" ? `Auswahl: ${f.optionen.join(", ")}` : TYP_TEXT[f.typ]} · ${f.pflicht ? "Pflicht" : "optional"}${f.ceviQuelle ? ` · aus der Cevi-Datenbank: ${CEVI_NAME.get(f.ceviQuelle)}` : ""}`;

// Fokus auf einen Text, der selbst kein Bedienelement ist (nach dem Neuzeichnen ist der Auslöser weg)
function fokusAuf(knoten) {
  knoten?.setAttribute("tabindex", "-1");
  knoten?.focus();
}

const normal = (felder) =>
  JSON.stringify(
    felder.map((f) => [
      f.schluessel,
      f.beschriftung,
      f.typ,
      f.optionen,
      f.pflicht,
      f.ceviQuelle ?? null,
    ]),
  );

export function zeichneFelder(bereich, ctx, pfad, anlass, id) {
  // basis: der Stand, den der Server zuletzt geliefert hat; felder: die Arbeitskopie
  let basis = anlass.felder.map((f) => ({ ...f }));
  let felder = basis.map((f) => ({
    ...f,
    optionen: [...f.optionen],
    _id: neueId("f"),
  }));
  let geaendert = false;
  let bearbeite = null;

  const status = el("p", { class: "nur-leser", role: "status" });
  const liste = el("div", {});
  const editor = el("div", {});
  const hinweisGesundheit = el(
    "div",
    { class: "hinweis hinweis--warn", role: "status" },
    "Keine Gesundheitsdaten abfragen.",
  );
  // Kein Speichern-Knopf im Kopf: Die Leiste unten erscheint erst, wenn etwas geändert ist
  const leiste = speicherLeiste({
    beiSpeichern: () => speichern(),
    beiVerwerfen: () => {
      felder = alsArbeitskopie(basis);
      geaendert = false;
      bearbeite = null;
      ersetze(editor);
      leiste.verstecke();
      sage("");
      zeichneListe();
      fokusAuf(liste.querySelector("h2"));
    },
  });
  const speichernKnopf = leiste.speichern;

  const sage = (text) => {
    status.textContent = text;
  };
  function markiere() {
    if (geaendert) return;
    geaendert = true;
    leiste.zeige(
      "Änderungen an den Zusatzfeldern sind noch nicht gespeichert.",
    );
    sage("");
  }
  const rundKnopf = (symbol, label, aktion, onclick) =>
    el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund",
        "aria-label": label,
        "data-aktion": aktion,
        onclick,
      },
      icon(symbol),
    );

  function zeichneListe() {
    // Griff und Knöpfe «Nach oben» und «Nach unten» kommen aus der Sortierliste (sortieren.js); Bearbeiten und Entfernen stehen in der Zeile
    const sortierung =
      felder.length > 1
        ? sortierListe({
            beschriftung: "Zusatzfelder",
            eintraege: felder.map((f) => ({
              id: f._id,
              text: f.beschriftung,
              inhalt: zeilenInhalt(f),
            })),
            beiNeu: (ids) => {
              const nach = new Map(felder.map((f) => [f._id, f]));
              felder = ids.map((id) => nach.get(id));
              markiere();
            },
          })
        : null;
    ersetze(
      liste,
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "zf-liste" },
        el("h2", { id: "zf-liste" }, "Zusatzfelder"),
        felder.length === 0
          ? el(
              "p",
              { class: "leise" },
              "Noch keine Zusatzfragen. Die Anmeldung fragt dann nur nach der Person oder dem Kind.",
            )
          : sortierung
            ? [
                el(
                  "p",
                  { class: "klein leise" },
                  "Ordne die Fragen per Ziehen am Griff oder mit den Pfeilknöpfen. Die Reihenfolge gilt erst nach «Speichern».",
                ),
                sortierung.wurzel,
              ]
            : el(
                "ul",
                { class: "liste-zeilen" },
                el("li", {}, zeilenInhalt(felder[0])),
              ),
        felder.length >= MAX_FELDER
          ? el("p", { class: "hilfe" }, `Höchstens ${MAX_FELDER} Felder.`)
          : knopf("Feld hinzufügen", {
              symbol: "plus",
              onclick: () => oeffneEditor(null),
            }),
      ),
    );
  }

  // Name, Typ und die beiden Aktionen eines Feldes
  function zeilenInhalt(f) {
    return el(
      "div",
      { class: "tm-feldzeile", "data-id": f._id },
      el(
        "div",
        { class: "text" },
        el("span", { class: "name" }, f.beschriftung),
        el("span", { class: "klein leise" }, beschreibung(f)),
      ),
      el(
        "div",
        { class: "tm-feldaktionen" },
        knopf("Bearbeiten", {
          klein: true,
          symbol: "bearbeiten",
          kontext: f.beschriftung,
          onclick: () => oeffneEditor(f),
        }),
        rundKnopf("papierkorb", `Entfernen: ${f.beschriftung}`, "weg", () =>
          entferne(f),
        ),
      ),
    );
  }

  // Mit «Rückgängig» (#578): Das Feld verschwindet sofort aus der Liste, bei «Rückgängig» steht es wieder an seiner Stelle. Erst «Speichern» übernimmt es; gibt es schon Antworten zu dem Feld, lehnt der Server das Speichern ab
  function entferne(f) {
    const i = felder.indexOf(f);
    mitRueckgaengig({
      text: `Feld «${f.beschriftung}» entfernt, noch nicht gespeichert`,
      ansicht: {
        weg: () => {
          felder.splice(i, 1);
          markiere();
          zeichneListe();
          fokusAuf(
            liste.querySelector(
              `[data-id="${(felder[i] ?? felder[i - 1])?._id}"] .name`,
            ) ?? liste.querySelector("h2"),
          );
        },
        zurueck: () => {
          felder.splice(i, 0, f);
          markiere();
          zeichneListe();
        },
      },
      ausfuehren: async () => {},
    });
  }

  // Der Editor für ein neues oder ein bestehendes Feld (f), solange es ungespeichert in der Liste steht
  function oeffneEditor(f) {
    bearbeite = f;
    const titel = el(
      "h2",
      { tabindex: "-1" },
      f ? "Feld bearbeiten" : "Neues Feld",
    );
    const name = feld({
      label: "Feldname",
      hilfe:
        "Die Frage, wie Eltern oder Teilnehmende sie lesen. Höchstens 100 Zeichen.",
      wert: f?.beschriftung ?? "",
      maxlength: 100,
    });
    const typ = auswahl({
      label: "Typ",
      optionen: TYPEN,
      wert: f?.typ ?? "text",
    });
    const optionen = feld({
      label: "Antworten zur Auswahl",
      mehrzeilig: true,
      rows: 4,
      wert: (f?.optionen ?? []).join("\n"),
      hilfe: "Eine Antwort pro Zeile. Mindestens 2, höchstens 20.",
    });
    const pflicht = ankreuzen({
      label: "Pflichtfeld: Ohne Antwort geht die Anmeldung nicht",
      gewaehlt: f?.pflicht ?? false,
      wert: "1",
    });
    // Vorausfüllen aus der Cevi-Datenbank: nur bei Textfeldern; die Person kann den Wert in der Anmeldung ändern
    const cevi = auswahl({
      label: "Aus der Cevi-Datenbank füllen",
      optionen: CEVI_QUELLEN,
      wert: f?.ceviQuelle ?? "",
    });
    const ceviHilfe = el(
      "p",
      { class: "hilfe" },
      "Die Anmeldung füllt dieses Feld mit der Angabe, die die Person in der Cevi-Datenbank selbst gemacht hat. Sie kann sie ändern. Fehlt die Angabe dort, bleibt das Feld leer. Gesundheitsangaben holt Cevi OS nie.",
    );
    const ceviWurzel = el("div", {}, cevi.wurzel, ceviHilfe);
    const meld = el("div", {});
    const zeigeOptionen = () => {
      optionen.wurzel.hidden = typ.eingabe.value !== "auswahl";
      ceviWurzel.hidden = typ.eingabe.value !== "text";
    };
    typ.eingabe.addEventListener("change", zeigeOptionen);
    zeigeOptionen();
    const optionenVon = () =>
      optionen.eingabe.value
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);

    function uebernehmen() {
      entferneFeldFehler(editor);
      ersetze(meld);
      const fehler = [];
      const wert = name.eingabe.value.trim();
      if (!wert) {
        feldFehler(
          name,
          "Gib dem Feld einen Namen, zum Beispiel «Zelt-Wunsch».",
        );
        fehler.push({ name: "Feldname", eingabe: name.eingabe });
      }
      const o = optionenVon();
      if (typ.eingabe.value === "auswahl") {
        const text = o.some((t) => t.length > 100)
          ? "Jede Antwort darf höchstens 100 Zeichen lang sein."
          : o.length < 2
            ? "Gib mindestens 2 Antworten an, eine pro Zeile."
            : o.length > 20
              ? "Gib höchstens 20 Antworten an."
              : new Set(o).size !== o.length
                ? "Jede Antwort darf nur einmal vorkommen."
                : null;
        if (text) {
          feldFehler(optionen, text);
          fehler.push({ name: "Antworten", eingabe: optionen.eingabe });
        }
      }
      if (fehler.length > 0) {
        const hinweis = pruefHinweis(fehler);
        ersetze(meld, hinweis);
        hinweis.focus();
        return;
      }
      const neu = {
        schluessel: f?.schluessel ?? null,
        beschriftung: wert,
        typ: typ.eingabe.value,
        optionen: typ.eingabe.value === "auswahl" ? o : [],
        pflicht: pflicht.eingabe.checked,
        ceviQuelle:
          typ.eingabe.value === "text" ? cevi.eingabe.value || null : null,
      };
      if (f) Object.assign(f, neu);
      else felder.push({ ...neu, _id: neueId("f") });
      bearbeite = null;
      ersetze(editor);
      markiere();
      zeichneListe();
      const ziel = f ?? felder.at(-1);
      sage(`«${wert}» ist übernommen, noch nicht gespeichert.`);
      fokusAuf(liste.querySelector(`[data-id="${ziel._id}"] .name`));
    }

    ersetze(
      editor,
      el(
        "section",
        {
          class: "flaeche",
          "aria-label": f ? "Feld bearbeiten" : "Neues Feld",
        },
        titel,
        meld,
        name.wurzel,
        typ.wurzel,
        optionen.wurzel,
        ceviWurzel,
        pflicht.wurzel,
        el(
          "div",
          { class: "reihe" },
          knopf("Feld übernehmen", { art: "blau", onclick: uebernehmen }),
          knopf("Abbrechen", {
            onclick: () => {
              bearbeite = null;
              ersetze(editor);
              fokusAuf(
                liste.querySelector(f ? `[data-id="${f._id}"] .name` : "h2"),
              );
            },
          }),
        ),
      ),
    );
    titel.focus();
  }

  // Stand der Felder, den der Server schickt (für den Konflikt und nach dem Speichern)
  const alsArbeitskopie = (serverFelder) =>
    serverFelder.map((f) => ({
      ...f,
      optionen: [...f.optionen],
      _id: neueId("f"),
    }));

  function koerper(liste_) {
    const vergeben = new Set(liste_.map((f) => f.schluessel).filter(Boolean));
    return liste_.map((f) => {
      const schluessel =
        f.schluessel ?? schluesselAus(f.beschriftung, vergeben);
      vergeben.add(schluessel);
      return {
        schluessel,
        beschriftung: f.beschriftung,
        typ: f.typ,
        optionen: f.typ === "auswahl" ? f.optionen : [],
        pflicht: f.pflicht,
        ceviQuelle: f.typ === "text" ? (f.ceviQuelle ?? null) : null,
      };
    });
  }

  // 409 FELD_IN_BENUTZUNG nennt die Schlüssel; der Text nennt die Fragen
  function belegt(f, gesendet) {
    if (f.code !== "FELD_IN_BENUTZUNG") return null;
    const namen = (f.daten?.schluessel ?? [])
      .map(
        (s) =>
          gesendet.find((x) => x.schluessel === s)?.beschriftung ??
          basis.find((x) => x.schluessel === s)?.beschriftung ??
          s,
      )
      .map((n) => `«${n}»`)
      .join(", ");
    return `Zu diesen Feldern gibt es schon Antworten: ${namen}. Sie lassen sich weder entfernen noch auf einen anderen Typ umstellen. Stelle sie wieder her oder lade die Seite neu.`;
  }

  async function schreibe(gesendet) {
    const antwort = await anfrage("PUT", `${pfad}/felder`, {
      felder: gesendet,
    });
    basis = antwort.felder.map((f) => ({ ...f }));
    felder = alsArbeitskopie(antwort.felder);
    geaendert = false;
    leiste.verstecke();
    sage("");
    ersetze(editor);
    bearbeite = null;
    zeichneListe();
    // Der Rahmen soll beim nächsten Öffnen die neuen Felder laden
    vergiss(id);
    ctx.melde(
      "Zusatzfelder gespeichert. Neue Anmeldungen fragen sie ab sofort ab.",
    );
  }

  function zeigeFehler(text) {
    ctx.melde(
      `Nicht gespeichert. ${text} Deine Felder sind noch da, speichere nochmals.`,
      "fehler",
    );
  }

  async function speichern() {
    if (bearbeite !== null || editor.firstChild) {
      zeigeFehler("Du bearbeitest gerade ein Feld. Übernimm es oder brich ab.");
      return;
    }
    speichernKnopf.disabled = true;
    speichernKnopf.setAttribute("aria-busy", "true");
    const gesendet = koerper(felder);
    try {
      // Hat inzwischen jemand anders die Felder geändert? Dann entscheidet die Person, welche Fassung gilt.
      const aktuell = (await anfrage("GET", pfad)).felder;
      if (normal(aktuell) !== normal(basis)) {
        zeigeKonflikt(gesendet, aktuell);
        return;
      }
      await schreibe(gesendet);
    } catch (f) {
      zeigeFehler(belegt(f, gesendet) ?? meldungVon(f));
    } finally {
      speichernKnopf.disabled = false;
      speichernKnopf.removeAttribute("aria-busy");
    }
  }

  // Konflikt (A18): Deine Fassung neben der aktuellen; geänderte Zeilen sind markiert
  function zeigeKonflikt(meine, aktuell) {
    const zeile = (f) => `${f.beschriftung} · ${beschreibung(f)}`;
    const andere = (liste_) => new Set(liste_.map(zeile));
    const spalte = (titel, felderListe, gegen) =>
      el(
        "section",
        { class: "flaeche", "aria-label": titel },
        el("h3", {}, titel),
        felderListe.length === 0
          ? el("p", { class: "klein leise" }, "Keine Zusatzfelder")
          : felderListe.map((f) => {
              const geandert = !gegen.has(zeile(f));
              return el(
                "p",
                { class: "klein" },
                geandert &&
                  el("span", { class: "chip chip--warn" }, "geändert"),
                geandert && " ",
                el(
                  "span",
                  { class: geandert ? "markiert" : undefined },
                  zeile(f),
                ),
              );
            }),
      );
    const hinweis = el(
      "div",
      { class: "hinweis hinweis--warn", role: "alert", tabindex: "-1" },
      el(
        "span",
        {},
        el("strong", {}, "Jemand hat die Zusatzfelder gerade geändert."),
        " Wähle, welche Fassung gilt.",
      ),
    );
    ersetze(
      editor,
      el(
        "div",
        { class: "tm-konflikt-block" },
        hinweis,
        el(
          "div",
          { class: "konflikt" },
          spalte("Deine Fassung", meine, andere(aktuell)),
          spalte("Aktuelle Fassung", aktuell, andere(meine)),
        ),
        el(
          "div",
          { class: "reihe" },
          knopf("Meine behalten", {
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                // Der Stand des Servers gilt jetzt als Ausgangslage; meine Fassung überschreibt ihn bewusst
                basis = aktuell.map((f) => ({ ...f }));
                await schreibe(meine);
              } catch (f) {
                zeigeFehler(belegt(f, meine) ?? meldungVon(f));
              }
            },
          }),
          knopf("Aktuelle übernehmen", {
            art: "blau",
            onclick: () => {
              basis = aktuell.map((f) => ({ ...f }));
              felder = alsArbeitskopie(aktuell);
              geaendert = false;
              leiste.verstecke();
              sage("");
              ersetze(editor);
              zeichneListe();
              ctx.melde(
                "Die aktuelle Fassung der Zusatzfelder ist übernommen.",
                "info",
              );
            },
          }),
        ),
      ),
    );
    hinweis.focus();
  }

  bereich.append(
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "zf-konto" },
      el("h2", { id: "zf-konto" }, "Kommt aus dem Konto"),
      el(
        "p",
        { class: "klein leise" },
        "Nur lesbar. Eltern ändern es in ihrem Profil.",
      ),
      el(
        "ul",
        { class: "chips" },
        (anlass.anmeldungFuer === "kind"
          ? ["Name", "Kind", "Stufe", "Telefon"]
          : ["Name", "Telefon"]
        ).map((t) => chip(t, "ok")),
      ),
    ),
    liste,
    editor,
    hinweisGesundheit,
    status,
    leiste.wurzel,
  );
  zeichneListe();
}
