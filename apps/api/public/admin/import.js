import { anfrage, fehlertext } from "./api.js";
import {
  ARTEN,
  MAX_BYTES,
  MAX_ZEILEN,
  baueZeilen,
  dekodiere,
  entschaerfe,
  findeEbene,
  kannSchnellweg,
  liesCsv,
  schlageArtVor,
  schlageSpaltenVor,
  schreibeCsv,
  verschiedeneRollen,
} from "./csv.js";
import {
  STANDARD_LOGO,
  auswahl,
  chip,
  el,
  filterGruppe,
  icon,
  knopf,
  neueId,
  seitenwahl,
  tabelle,
} from "./dom.js";
import { dateiFeld } from "./personen-wahl.js";
import { zweiStufig } from "./rueckgaengig.js";
import { schrittfolge } from "./schrittfolge.js";
import { ergaenzeZustand } from "./verlauf.js";

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => (await anfrage("GET", "/api/v1/stufen")).stufen,
    (stufen, neu) => zeichne(bereich, ctx, stufen, neu),
  );
}

const TRENNERNAME = { ";": "Semikolon", ",": "Komma", "\t": "Tabulator" };
const zeilenText = (n) => (n === 1 ? "1 Zeile" : `${n} Zeilen`);
const kinderText = (n) => (n === 1 ? "1 Kind" : `${n} Kinder`);
const leitendeText = (n) => (n === 1 ? "1 Leitende" : `${n} Leitende`);

// Zustand einer Zeile nie nur über Farbe: Wort und Symbol stehen im Chip
const ZUSTAENDE = {
  neu: () => chip("Neu", "ok"),
  vorhanden: () => chip("Schon vorhanden", undefined, "info"),
  doppelt: () => chip("Doppelt in der Datei", "warn"),
  ungueltig: () => chip("Ungültig", "fehler"),
  ausgelassen: () => chip("Ausgelassen", undefined, "schliessen"),
};
const ARTNAME = Object.fromEntries(ARTEN);

// Reihenfolge der Schritte; die Nummer im Verlaufseintrag des Browsers ist der Name
const REIHE = ["datei", "spalten", "rollen", "vorschau", "ergebnis"];
const nr = (id) => REIHE.indexOf(id);

function fehlerfeld() {
  return el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
}

// Optionsknöpfe als Segment (wie die Stufenrollen bei den Personen); legende darf Text und Knoten enthalten
function artWahl(legende, arten, gewaehlt, beiAenderung) {
  const name = neueId("art");
  const optionen = arten.map(([wert, text]) => {
    const id = neueId("art-option");
    return {
      wert,
      eingabe: el("input", {
        type: "radio",
        id,
        name,
        value: wert,
        checked: wert === gewaehlt,
        onchange: beiAenderung,
      }),
      label: el("label", { for: id }, icon("haken"), text),
    };
  });
  return {
    wurzel: el(
      "fieldset",
      { class: "rolle" },
      el("legend", {}, legende),
      el(
        "div",
        { class: "seg" },
        optionen.flatMap((o) => [o.eingabe, o.label]),
      ),
    ),
    wert: () => optionen.find((o) => o.eingabe.checked)?.wert,
  };
}

function zeichne(bereich, ctx, stufen, neu) {
  if (stufen.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        icon("stufen"),
        " Es gibt noch keine Stufe. ",
        el("a", { href: "#stufen" }, "Lege zuerst eine Stufe an."),
      ),
    );
    return;
  }

  // Zustand der Seite; alles, was von der Datei oder den Zuordnungen abhängt, wird bei einer Änderung verworfen
  let daten = null; // { kopf, zeilen, trenner, ebene, schnell }
  let spalten = null; // { vorname, nachname, ceviName, rolle }: Auswahlfelder
  let rollen = null; // () => { arten, einheit }
  let gesendet = null;
  let vorschauStufe = null;
  let vorschauAntwort = false; // Die Vorschau gilt noch (nichts wurde danach geändert)
  let importiert = null; // { kinder, leitende } nach dem Import
  let rollenText = () => "";
  let lesevorgang = 0;
  let vorschauNr = 0;
  let stand = "datei";
  let fertig = false;
  const hashStart = location.hash;

  const stufe = auswahl({
    label: "Stufe",
    optionen: stufen.map((s) => [s.id, s.name, s.logoUrl ?? STANDARD_LOGO]),
    wert: stufen[0].id,
  });
  const stufenName = () =>
    stufen.find((x) => x.id === stufe.eingabe.value)?.name ?? "";
  const nummer = (a) => (a.eingabe.value === "" ? -1 : Number(a.eingabe.value));
  const NAMEN = {
    vorname: "Vorname",
    nachname: "Nachname",
    ceviName: "Cevi-Name",
    rolle: "Rolle",
  };
  const spaltenText = () =>
    Object.entries(spalten)
      .filter(([, a]) => nummer(a) >= 0)
      .map(
        ([k, a]) =>
          `${NAMEN[k]} aus «${daten.kopf[nummer(a)] || `Spalte ${nummer(a) + 1}`}»`,
      )
      .join(", ");

  const aendereZu = (id) => () => gehe(id);
  const folge = schrittfolge({
    titel: "Personen importieren",
    beschreibung:
      "Zuerst zeigt die Vorschau, was passieren würde. Angelegt wird erst, wenn du in der Vorschau «Importieren» wählst. Eine Elternverknüpfung gehört nicht dazu.",
    schritte: [
      {
        id: "datei",
        titel: "Datei",
        hinweis: "Stufe und CSV-Datei wählen",
        zusammen: () =>
          daten
            ? `${zeilenText(daten.zeilen.length)} · Stufe ${stufenName()}`
            : "",
        aendern: aendereZu("datei"),
      },
      {
        id: "spalten",
        titel: "Spalten",
        hinweis: "Vor- und Nachname zuordnen",
        zusammen: () => (spalten ? spaltenText() : ""),
        aendern: aendereZu("spalten"),
      },
      {
        id: "rollen",
        titel: "Rollen",
        hinweis: "Kind, Leitung oder Stufenleitung",
        zusammen: () => rollenText(),
        aendern: aendereZu("rollen"),
      },
      {
        id: "vorschau",
        titel: "Vorschau",
        hinweis: "Prüfen und importieren",
        zusammen: () =>
          importiert
            ? `${kinderText(importiert.kinder)} und ${leitendeText(importiert.leitende)} angelegt`
            : "",
      },
      {
        id: "ergebnis",
        titel: "Fertig",
        hinweis: "Neue Konten und Startpasswörter",
        ende: true,
      },
    ],
  });

  // Verlauf: Jeder Schritt vor ist ein Eintrag; Browser-Zurück geht einen Schritt zurück, die Eingaben bleiben im Schritt
  function gehe(id, { verlauf = true, fokus = true } = {}) {
    if (verlauf && id !== stand) {
      window.history.pushState(
        { ...window.history.state, importSchritt: id },
        "",
        location.href,
      );
    }
    stand = id;
    folge.gehe(id, { fokus });
  }
  const beiVerlauf = (ereignis) => {
    if (!bereich.isConnected) {
      return window.removeEventListener("popstate", beiVerlauf);
    }
    if (fertig || location.hash !== hashStart) return;
    // Weiter als der Stand der Eingaben führt der Verlauf nicht (etwa ein Eintrag aus einem früheren Import)
    const grenze = daten ? (vorschauAntwort ? "vorschau" : "rollen") : "datei";
    let ziel = ereignis.state?.importSchritt ?? "datei";
    if (nr(ziel) < 0 || nr(ziel) > nr(grenze)) ziel = grenze;
    if (ziel === stand) return;
    stand = ziel;
    folge.gehe(ziel);
  };
  window.addEventListener("popstate", beiVerlauf);

  const fehlerAm = (id, knoten, text) => {
    knoten.textContent = text;
    knoten.hidden = false;
    folge.markiereFehler(id, true);
    knoten.focus();
  };
  const ohneFehler = (id, knoten) => {
    knoten.hidden = true;
    folge.markiereFehler(id, false);
  };

  // ---- Schritt 1: Datei ----
  const datei = dateiFeld({
    label: "CSV-Datei",
    hilfe: `Export aus der Cevi-Datenbank als CSV, höchstens 1 MB und ${MAX_ZEILEN} Zeilen. Die Datei wird nur in deinem Browser gelesen und nicht hochgeladen.`,
    accept: ".csv,text/csv,text/plain",
  });
  const dateiStatus = el("p", { class: "hilfe", role: "status" });
  const dateiFehler = fehlerfeld();
  const dateiWeiter = knopf("Weiter", {
    art: "haupt",
    symbol: "weiter",
    hidden: true,
    onclick: () => {
      if (!daten) return;
      if (daten.schnell) schnellVorschau();
      else gehe("spalten");
    },
  });
  folge
    .koerper("datei")
    .append(
      el("div", { class: "sf-formular" }, stufe.wurzel, datei.wurzel),
      dateiStatus,
      dateiFehler,
      el("div", { class: "sf-knoepfe" }, dateiWeiter),
    );

  function leereVorschau() {
    vorschauNr++;
    gesendet = null;
    vorschauAntwort = false;
    folge.koerper("vorschau").replaceChildren();
  }

  function leereFolge() {
    lesevorgang++;
    daten = null;
    spalten = null;
    dateiStatus.textContent = "";
    ohneFehler("datei", dateiFehler);
    dateiWeiter.hidden = true;
    leereVorschau();
    folge.koerper("spalten").replaceChildren();
    folge.koerper("rollen").replaceChildren();
    folge.markiereFehler("spalten", false);
    folge.markiereFehler("rollen", false);
    gehe("datei", { verlauf: false, fokus: false });
  }

  // Bei einem Fehler (Meldung steht bei der Datei) bleibt der Weg offen: «Weiter» versucht es nochmals
  async function schnellVorschau() {
    await zeigeVorschau(dateiFehler, "datei", dateiWeiter);
  }

  stufe.eingabe.addEventListener("change", leereVorschau);

  datei.eingabe.addEventListener("change", async () => {
    leereFolge();
    const lauf = lesevorgang;
    const gewaehlt = datei.eingabe.files[0];
    if (!gewaehlt) return;
    if (gewaehlt.size > MAX_BYTES) {
      fehlerAm(
        "datei",
        dateiFehler,
        "Die Datei ist grösser als 1 MB. Eine Liste mit Namen ist viel kleiner: Prüfe, ob es die richtige Datei ist.",
      );
      return;
    }
    let text;
    try {
      text = dekodiere(await gewaehlt.arrayBuffer());
    } catch {
      if (lauf === lesevorgang) {
        fehlerAm("datei", dateiFehler, "Die Datei lässt sich nicht lesen.");
      }
      return;
    }
    // Zwischen Auswahl und Ende des Lesens kann eine andere Datei gewählt worden sein
    if (lauf !== lesevorgang) return;
    const gelesen = liesCsv(text);
    if (gelesen.zeilen.length === 0) {
      fehlerAm(
        "datei",
        dateiFehler,
        "Die Datei enthält keine Zeilen unter der Kopfzeile.",
      );
      return;
    }
    if (gelesen.zeilen.length > MAX_ZEILEN) {
      fehlerAm(
        "datei",
        dateiFehler,
        `Die Datei hat ${zeilenText(gelesen.zeilen.length)}. Pro Import sind höchstens ${MAX_ZEILEN} Zeilen möglich. Teile die Datei auf und importiere sie in mehreren Schritten.`,
      );
      return;
    }
    daten = {
      ...gelesen,
      ebene: findeEbene(gelesen.kopf),
      schnell: kannSchnellweg(gelesen.kopf, gelesen.zeilen),
    };
    dateiStatus.textContent = `Datei gelesen: ${zeilenText(daten.zeilen.length)}, Trennzeichen ${TRENNERNAME[daten.trenner] ?? daten.trenner}.`;
    dateiWeiter.hidden = false;
    zeichneSpalten();
    // Export der Cevi-Datenbank: Spalten und Rollen sind erkannt, es geht gleich zur Vorschau; «Ändern» führt zurück
    if (daten.schnell) await schnellVorschau();
    else gehe("spalten");
  });

  // ---- Schritt 2: Spalten ----
  function zeichneSpalten() {
    const vorschlag = schlageSpaltenVor(daten.kopf);
    const optionen = [
      ["", "Keine Spalte"],
      ...daten.kopf.map((name, i) => [String(i), name || `Spalte ${i + 1}`]),
    ];
    const wahl = (label, schluessel) =>
      auswahl({
        label,
        optionen,
        wert: vorschlag[schluessel] >= 0 ? String(vorschlag[schluessel]) : "",
      });
    spalten = {
      vorname: wahl("Vorname", "vorname"),
      nachname: wahl("Nachname", "nachname"),
      ceviName: wahl("Cevi-Name (optional)", "ceviName"),
      rolle: wahl("Rolle (optional)", "rolle"),
    };
    // Unter jedem Feld steht der Wert der ersten Zeile: So sieht man, ob die Spalte passt
    for (const a of Object.values(spalten)) {
      const absatz = el("p", { class: "hilfe" });
      const setze = () => {
        const i = nummer(a);
        absatz.textContent =
          i < 0
            ? "Keine Spalte gewählt."
            : `In der ersten Zeile: ${daten.zeilen[0]?.[i] || "(leer)"}`;
      };
      a.eingabe.addEventListener("change", setze);
      setze();
      a.wurzel.append(absatz);
    }
    for (const a of Object.values(spalten)) {
      a.eingabe.addEventListener("change", leereVorschau);
    }
    spalten.rolle.eingabe.addEventListener("change", zeichneRollen);
    const vollstaendig = () => {
      const [v, n] = [nummer(spalten.vorname), nummer(spalten.nachname)];
      return v >= 0 && n >= 0 && v !== n;
    };
    const erkannt = el("p", { class: "beschreibung", role: "status" });
    const fehler = fehlerfeld();
    const beschreibe = () => {
      ohneFehler("spalten", fehler);
      erkannt.textContent = vollstaendig()
        ? `Erkannt: ${spaltenText()}. Prüfe, ob das stimmt.`
        : "Vorname und Nachname brauchen je eine eigene Spalte. Ordne sie unten zu.";
    };
    beschreibe();
    for (const a of Object.values(spalten)) {
      a.eingabe.addEventListener("change", beschreibe);
    }
    folge.koerper("spalten").replaceChildren(
      erkannt,
      el(
        "div",
        { class: "sf-formular sf-formular--raster" },
        Object.values(spalten).map((a) => a.wurzel),
      ),
      fehler,
      el(
        "div",
        { class: "sf-knoepfe" },
        knopf("Weiter", {
          art: "haupt",
          symbol: "weiter",
          onclick: () => {
            if (!vollstaendig()) {
              fehlerAm(
                "spalten",
                fehler,
                "Ordne dem Vornamen und dem Nachnamen je eine eigene Spalte zu.",
              );
              return;
            }
            gehe("rollen");
          },
        }),
      ),
    );
    zeichneRollen();
  }

  // ---- Schritt 3: Rollen ----
  function zeichneRollen() {
    leereVorschau();
    const spalte = nummer(spalten.rolle);
    let inhalt;
    if (spalte < 0) {
      const wahl = artWahl(
        "Art aller Personen",
        ARTEN.filter(([a]) => a !== "auslassen"),
        "kind",
        leereVorschau,
      );
      rollen = () => ({ arten: new Map(), einheit: wahl.wert() });
      rollenText = () => `Alle als ${ARTNAME[wahl.wert()]}`;
      inhalt = [
        el(
          "p",
          { class: "beschreibung" },
          "Die Datei hat keine Rollenspalte. Alle Zeilen bekommen dieselbe Art.",
        ),
        wahl.wurzel,
      ];
    } else {
      const werte = verschiedeneRollen(daten.zeilen, spalte, daten.ebene);
      const wahlen = werte.map((w) => ({
        schluessel: w.schluessel,
        name: w.wert || "(leer)",
        erkannt: schlageArtVor(w.wert) !== "auslassen",
        ...artWahl(
          [
            w.wert || "(leer)",
            " ",
            el("span", { class: "leise" }, `· ${zeilenText(w.anzahl)}`),
          ],
          ARTEN,
          schlageArtVor(w.wert),
          leereVorschau,
        ),
      }));
      const weitere = wahlen.filter((w) => !w.erkannt);
      rollenText = () => {
        const zugeordnet = wahlen.filter((w) => w.wert() !== "auslassen");
        const aus = wahlen.length - zugeordnet.length;
        return [
          zugeordnet.map((w) => `${w.name} → ${ARTNAME[w.wert()]}`).join(", "),
          aus > 0
            ? `${aus === 1 ? "1 weitere Rolle" : `${aus} weitere Rollen`} ausgelassen`
            : "",
        ]
          .filter(Boolean)
          .join("; ");
      };
      rollen = () => ({
        arten: new Map(wahlen.map((w) => [w.schluessel, w.wert()])),
        einheit: "kind",
      });
      inhalt = [
        el(
          "p",
          { class: "beschreibung" },
          "Teilnehmende sind Kinder, Gruppenleitende sind Leitung, Stufenleitende sind Stufenleitung. Alle anderen Rollen werden ausgelassen. Stehen in einer Zelle mehrere Rollen, gilt die stärkste Art: Stufenleitung vor Leitung vor Kind.",
        ),
        el(
          "div",
          { class: "spalte" },
          wahlen.filter((w) => w.erkannt).map((w) => w.wurzel),
        ),
        weitere.length > 0 &&
          el(
            "details",
            { class: "mehr", open: wahlen.every((w) => !w.erkannt) },
            el(
              "summary",
              {},
              `Weitere Rollen (werden ausgelassen): ${weitere.length}`,
            ),
            el(
              "div",
              { class: "spalte" },
              weitere.map((w) => w.wurzel),
            ),
          ),
      ];
    }
    const fehler = fehlerfeld();
    const vorschauKnopf = knopf("Vorschau anzeigen", {
      art: "haupt",
      symbol: "lupe",
      onclick: () => zeigeVorschau(fehler, "rollen", vorschauKnopf),
    });
    folge
      .koerper("rollen")
      .replaceChildren(
        ...inhalt.filter(Boolean),
        fehler,
        el("div", { class: "sf-knoepfe" }, vorschauKnopf),
      );
  }

  // ---- Schritt 4: Vorschau ----
  async function zeigeVorschau(fehler, schrittId, taste) {
    ohneFehler(schrittId, fehler);
    const zuordnung = Object.fromEntries(
      Object.entries(spalten).map(([name, a]) => [name, nummer(a)]),
    );
    if (zuordnung.vorname < 0 || zuordnung.nachname < 0) {
      fehlerAm(
        schrittId,
        fehler,
        "Ordne im Schritt «Spalten» dem Vornamen und dem Nachnamen je eine Spalte zu.",
      );
      return false;
    }
    if (zuordnung.vorname === zuordnung.nachname) {
      fehlerAm(
        schrittId,
        fehler,
        "Vorname und Nachname brauchen verschiedene Spalten.",
      );
      return false;
    }
    const zeilen = baueZeilen(daten.zeilen, zuordnung, {
      ...rollen(),
      ebene: daten.ebene,
    });
    const gewaehlteStufe = { id: stufe.eingabe.value, name: stufenName() };
    const lauf = ++vorschauNr;
    taste.disabled = true;
    taste.setAttribute("aria-busy", "true");
    try {
      const antwort = await anfrage("POST", "/api/v1/admin/import/vorschau", {
        stufeId: gewaehlteStufe.id,
        zeilen,
      });
      // Wurde währenddessen etwas geändert, passt die Antwort nicht mehr
      if (lauf !== vorschauNr) return false;
      if (antwort.zeilen.length !== zeilen.length) {
        throw new Error("Antwort passt nicht zur Anfrage");
      }
      gesendet = zeilen;
      vorschauStufe = gewaehlteStufe;
      vorschauAntwort = true;
      zeichneVorschau(antwort);
      gehe("vorschau");
      return true;
    } catch (f) {
      if (lauf === vorschauNr) {
        fehlerAm(schrittId, fehler, fehlertext(f));
      }
      return false;
    } finally {
      taste.disabled = false;
      taste.removeAttribute("aria-busy");
    }
  }

  function zeichneVorschau({ zeilen: antworten, summe }) {
    const nachName = (z) => `${z.vorname} ${z.nachname}`;
    const mitBenutzer = antworten.some((a) => a.benutzername);
    const { wurzel, koerper } = tabelle({
      beschriftung: "Vorschau des Imports",
      spalten: [
        ["Nr.", "zahl"],
        "Person",
        "Zustand",
        "Art",
        ...(mitBenutzer ? ["Benutzername"] : []),
      ],
      zeilen: antworten.map((a, i) => {
        const z = gesendet[i];
        const keinKonto =
          a.status === "ausgelassen" || a.status === "ungueltig";
        return el(
          "tr",
          { "data-status": a.status },
          el("td", { class: "zahl im-nr" }, String(i + 1)),
          el(
            "th",
            { scope: "row" },
            el("span", { class: "name" }, nachName(z)),
            z.ceviName && el("span", { class: "leise" }, z.ceviName),
          ),
          el(
            "td",
            { class: "im-zustand" },
            el(
              "ul",
              { class: "chips" },
              (ZUSTAENDE[a.status] ?? (() => chip(a.status)))(),
            ),
            a.grund && el("p", { class: "hilfe" }, a.grund),
          ),
          el(
            "td",
            { "data-label": "Art", class: keinKonto ? "im-leer" : undefined },
            keinKonto
              ? el("span", { class: "leise" }, "–")
              : el("ul", { class: "chips" }, chip(ARTNAME[a.art] ?? a.art)),
          ),
          mitBenutzer &&
            el(
              "td",
              {
                "data-label": "Benutzername",
                class: a.benutzername ? undefined : "im-leer",
              },
              a.benutzername
                ? el("span", { class: "mono" }, a.benutzername)
                : el("span", { class: "leise" }, "–"),
            ),
        );
      }),
    });
    wurzel.querySelector("table").classList.add("im-tabelle");

    const zaehler = el("p", { class: "meta klein", role: "status" });
    const seiten = seitenwahl({ beiWechsel: aktualisiere });
    const pruefen = summe.doppelt + summe.ungueltig;
    const eintraege = [
      { text: "Alle", n: antworten.length, wert: "" },
      ...(pruefen > 0
        ? [{ text: "Zu prüfen", n: pruefen, wert: "pruefen" }]
        : []),
      ...[
        ["neu", "Neu"],
        ["vorhanden", "Schon vorhanden"],
        ["doppelt", "Doppelt"],
        ["ungueltig", "Ungültig"],
        ["ausgelassen", "Ausgelassen"],
      ]
        .map(([wert, text]) => ({
          text,
          wert,
          n: antworten.filter((a) => a.status === wert).length,
        }))
        .filter((e) => e.n > 0),
    ];
    const passt = (gesucht, status) =>
      gesucht === "" ||
      (gesucht === "pruefen"
        ? status === "doppelt" || status === "ungueltig"
        : status === gesucht);
    const filter = filterGruppe({
      beschriftung: "Zustand",
      eintraege,
      beiAenderung: () => {
        seiten.anfang();
        aktualisiere();
      },
    });
    function aktualisiere() {
      const gesucht = filter.wert();
      const treffer = [...koerper.children].filter((tr) =>
        passt(gesucht, tr.dataset.status),
      );
      const [von, bis] = seiten.fenster(treffer.length);
      const sichtbar = new Set(treffer.slice(von, bis));
      for (const tr of koerper.children) tr.hidden = !sichtbar.has(tr);
      zaehler.textContent = `${treffer.length} von ${zeilenText(antworten.length)}`;
    }
    aktualisiere();

    const prueftext = [
      summe.doppelt > 0 && `${summe.doppelt} doppelt in der Datei`,
      summe.ungueltig > 0 && `${summe.ungueltig} ungültig`,
    ]
      .filter(Boolean)
      .join(", ");
    folge.koerper("vorschau").replaceChildren(
      el(
        "div",
        { class: "im-bilanz" },
        summe.neu === 0
          ? el(
              "p",
              { class: "hinweis hinweis--warn" },
              "Es gibt nichts Neues anzulegen.",
            )
          : el(
              "p",
              { class: "im-satz" },
              `Beim Importieren werden `,
              el("strong", {}, kinderText(summe.kinder)),
              " und ",
              el("strong", {}, leitendeText(summe.leitende)),
              ` in der Stufe «${vorschauStufe.name}» angelegt. Alle anderen Zeilen werden übersprungen.`,
            ),
        summe.neu > 0 && importKnopf(summe),
      ),
      ...(pruefen > 0
        ? [
            el(
              "div",
              { class: "hinweis hinweis--warn im-pruefen" },
              el(
                "span",
                {},
                `Zu prüfen: ${prueftext}. Diese Zeilen werden nicht angelegt.`,
              ),
              knopf("Nur diese Zeilen zeigen", {
                klein: true,
                onclick: () => {
                  filter.setze("pruefen");
                  seiten.anfang();
                  aktualisiere();
                  wurzel.focus();
                },
              }),
            ),
          ]
        : []),
      el("div", { class: "werkzeuge" }, filter.wurzel),
      zaehler,
      wurzel,
      seiten.wurzel,
    );
  }

  // Der Import lässt sich nicht zurücknehmen (Konten, Startpasswörter): kein Rückgängig, sondern zwei Stufen im Knopf statt eines Popups (#578)
  function importKnopf(summe) {
    const k = knopf("Importieren", { art: "haupt", symbol: "ablage" });
    zweiStufig(k, {
      frage: `Wirklich ${kinderText(summe.kinder)} und ${leitendeText(summe.leitende)} anlegen?`,
      ausfuehren: () => starteImport(summe, k),
    });
    return k;
  }

  async function starteImport(summe, knopfEl) {
    knopfEl.disabled = true;
    knopfEl.setAttribute("aria-busy", "true");
    try {
      zeigeErgebnis(
        await anfrage("POST", "/api/v1/admin/import", {
          stufeId: vorschauStufe.id,
          zeilen: gesendet,
        }),
      );
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
      knopfEl.disabled = false;
      knopfEl.removeAttribute("aria-busy");
    }
  }

  // ---- Schritt 5: Ergebnis ----
  function zeigeErgebnis(ergebnis) {
    const leitende = ergebnis.leitende;
    importiert = { kinder: ergebnis.kinder, leitende: leitende.length };
    const alsText = () =>
      leitende
        .map((p) => [p.name, p.benutzername, p.startpasswort].join("\t"))
        .join("\n");
    const inhalt = [];
    if (leitende.length > 0) {
      const { wurzel: liste } = tabelle({
        beschriftung: "Neue Konten mit Startpasswort",
        spalten: ["Name", "Benutzername", "Startpasswort"],
        zeilen: leitende.map((p) =>
          el(
            "tr",
            {},
            el("th", { scope: "row" }, el("span", { class: "name" }, p.name)),
            el(
              "td",
              { "data-label": "Benutzername" },
              el("span", { class: "mono" }, p.benutzername),
            ),
            el(
              "td",
              { "data-label": "Startpasswort" },
              el("span", { class: "mono" }, p.startpasswort),
            ),
          ),
        ),
      });
      liste.querySelector("table").classList.add("im-tabelle");
      inhalt.push(
        el(
          "p",
          { class: "hinweis hinweis--warn" },
          "Die Startpasswörter erscheinen nur jetzt. Kopiere oder speichere sie, bevor du diese Seite verlässt. Sie gelten 7 Tage.",
        ),
        el(
          "div",
          { class: "reihe" },
          knopf("Alles kopieren", {
            symbol: "kopieren",
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(alsText());
                ctx.melde("Kopiert.");
              } catch {
                ctx.melde(
                  "Kopieren ist nicht möglich. Speichere die Liste als CSV.",
                  "fehler",
                );
              }
            },
          }),
          knopf("Als CSV speichern", {
            symbol: "ablage",
            onclick: () => {
              speichere(leitende);
              ctx.melde("Die Datei wird gespeichert.", "info");
            },
          }),
        ),
        liste,
      );
    } else {
      inhalt.push(
        el(
          "p",
          { class: "leise" },
          "Es sind keine Konten entstanden, darum gibt es keine Startpasswörter.",
        ),
      );
    }
    inhalt.push(
      el(
        "div",
        { class: "sf-knoepfe" },
        knopf("Fertig", { art: "haupt", onclick: wische }),
      ),
    );
    const koerper = folge.koerper("ergebnis");
    koerper.replaceChildren(...inhalt);

    // Die Startpasswörter bleiben nur in dieser Ansicht: Beim Verlassen und bei «Fertig» werden Liste und Seitentext gelöscht
    function wische() {
      window.removeEventListener("hashchange", wische);
      leitende.length = 0;
      koerper.replaceChildren();
      if (!koerper.isConnected) return;
      ctx.melde("");
      // Der Knopf «Fertig» verschwindet mit der Ansicht: Der Fokus gehört danach der Überschrift der Seite
      neu().then(() => document.querySelector("h1")?.focus());
    }
    window.addEventListener("hashchange", wische);

    // Zurück im Browser führt nicht in die Vorschau: Ein zweiter Import derselben Zeilen soll nicht möglich sein
    fertig = true;
    ergaenzeZustand({ importSchritt: "ergebnis" });
    stand = "ergebnis";
    folge.schliesseAb("ergebnis");
    ctx.melde(
      `${kinderText(ergebnis.kinder)} und ${leitendeText(leitende.length)} sind angelegt.${ergebnis.uebersprungen > 0 ? ` ${zeilenText(ergebnis.uebersprungen)} wurden übersprungen.` : ""}`,
    );
  }

  bereich.append(folge.wurzel);
}

// Lädt die Liste der neuen Konten als CSV herunter; der Dateiname enthält keine Personendaten
function speichere(leitende) {
  const zeilen = [
    ["Name", "Benutzername", "Startpasswort"],
    ...leitende.map((p) => [
      entschaerfe(p.name),
      p.benutzername,
      p.startpasswort,
    ]),
  ];
  // BOM, damit Tabellenprogramme die Umlaute richtig lesen
  const blob = new Blob(["﻿", schreibeCsv(zeilen)], {
    type: "text/csv;charset=utf-8",
  });
  const adresse = window.URL.createObjectURL(blob);
  const link = el("a", {
    href: adresse,
    download: `startpasswoerter-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => window.URL.revokeObjectURL(adresse), 1000);
}
