import { anfrage, fehlertext } from "./api.js";
import { el, feld, knopf, neueId } from "./dom.js";

// Editor der Bausteine mit Daten aus Cevi OS (#740): Nächster Anlass, Anlässe, Lager-Karte, Countdown, Treffpunkte, Dokumente, Cevi in Zahlen.
// Die Felder wählen nur aus: Anlass und Orte kommen aus der Datenbank (GET /api/v1/redaktion/baustein-auswahl), nie als Freitext. Die Daten selbst holt der Server beim Erzeugen der Seite.
// h sind die Helfer aus website-felder.js (eine Fabrik statt eines Imports, damit die beiden Dateien einander nicht einbinden).

const API = "/api/v1/redaktion";
export const MAX_ANLASS_ANZAHL = 12;
export const MAX_TREFFPUNKTE = 12;
export const MAX_DOKUMENTE = 30;

export const FELDNAMEN_DYNAMISCH = {
  anlassId: "Der Anlass",
  ortIds: "Die Orte",
  zahlen: "Die Zahlen",
  kosten: "Die Kosten",
  bis: "Das Ziel",
};
export const VERWEIS_TEXTE_DYNAMISCH = {
  ANLASS_UNBEKANNT:
    "Den gewählten Anlass gibt es nicht mehr. Wähle einen anderen.",
  ANLASS_NICHT_OEFFENTLICH:
    "Der gewählte Anlass ist nicht öffentlich. Die Website zeigt nur öffentliche Anlässe: Wähle einen anderen oder stelle den Anlass auf «Öffentlich».",
  ORT_UNBEKANNT: "Ein gewählter Ort ist nicht mehr in der Bibliothek.",
};

// Die Auswahl (Anlässe, Orte) holt der Editor einmal und merkt sie sich; ein Fehler wird nicht gemerkt
let auswahl = null;
let geladen = null;
function ladeAuswahl() {
  auswahl ??= anfrage("GET", `${API}/baustein-auswahl`)
    .then((a) => {
      geladen = a;
      return a;
    })
    .catch((f) => {
      auswahl = null;
      throw f;
    });
  return auswahl;
}
const tagText = (iso) => {
  const [j, m, t] = iso.split("-");
  return `${Number(t)}.${Number(m)}.${j}`;
};
const anlassName = (a) =>
  `${tagText(a.von)} · ${a.titel}${a.art === "lager" ? " (Lager)" : ""}`;
const anlassKurz = (id) => {
  // Die Liste der Seite nennt den Anlass beim Namen, sobald die Auswahl da ist; der erste Aufruf stösst das Laden an
  if (!geladen) ladeAuswahl().catch(() => {});
  const a = geladen?.anlaesse.find((x) => x.id === id);
  return a ? anlassName(a) : "Gewählter Anlass";
};

export function dynamischeBausteine(h) {
  const { eingabe, wahl, waehler, anmelden, listenForm, teilEingabe } = h;
  const zahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);

  // Auswahl eines Anlasses aus der Datenbank. optional: «Der nächste öffentliche Anlass» ist dann die leere Wahl
  function anlassWahl(k, b, reg, { optional, leer }) {
    const f = waehler({
      label: "Anlass",
      optionen: [["", "Anlässe werden geladen …"]],
      wert: "",
    });
    f.eingabe.disabled = true;
    const status = el("div", { class: "hilfe", role: "status" });
    const fuelle = (a) => {
      const gespeichert = b.daten.anlassId;
      const bekannt = a.anlaesse.some((x) => x.id === gespeichert);
      f.eingabe.replaceChildren(
        el("option", { value: "" }, optional ? leer : "Anlass wählen"),
        ...a.anlaesse.map((x) => el("option", { value: x.id }, anlassName(x))),
        ...(gespeichert && !bekannt
          ? [
              el(
                "option",
                { value: gespeichert },
                "Gewählter Anlass (nicht mehr öffentlich oder gelöscht)",
              ),
            ]
          : []),
      );
      f.eingabe.value = gespeichert ?? "";
      f.eingabe.disabled = false;
      status.replaceChildren(
        a.anlaesse.length === 0
          ? "Es gibt noch keine öffentlichen Anlässe mit aktivem Termin. Lege den Anlass unter «Anlässe» an und stelle ihn auf «Öffentlich»."
          : "Zur Wahl stehen nur öffentliche Anlässe.",
      );
    };
    const lade = () => {
      status.replaceChildren("Anlässe werden geladen …");
      ladeAuswahl().then(fuelle, (fehler) => {
        f.eingabe.replaceChildren(
          el("option", { value: "" }, "Anlässe konnten nicht geladen werden"),
        );
        status.replaceChildren(
          el(
            "span",
            { class: "fehlertext", role: "alert" },
            fehlertext(fehler),
          ),
          " ",
          knopf("Nochmals versuchen", { klein: true, onclick: lade }),
        );
      });
    };
    f.eingabe.addEventListener("change", () => {
      if (f.eingabe.value) b.daten.anlassId = f.eingabe.value;
      else delete b.daten.anlassId;
      k.aendere(b);
    });
    anmelden(reg, "daten.anlassId", f);
    lade();
    f.wurzel.append(status);
    return f.wurzel;
  }

  // Auswahl der Art; leer = beide
  function artWahl(k, b) {
    const f = waehler({
      label: "Art",
      optionen: [
        ["", "Anlässe und Lager"],
        ["anlass", "Nur Anlässe"],
        ["lager", "Nur Lager"],
      ],
      wert: b.daten.art ?? "",
    });
    f.eingabe.addEventListener("change", () => {
      if (f.eingabe.value) b.daten.art = f.eingabe.value;
      else delete b.daten.art;
      k.aendere(b);
    });
    return f.wurzel;
  }

  // Orte der Bibliothek als Liste zum Ankreuzen; die Reihenfolge ist die der Bibliothek
  function ortWahl(k, b, reg) {
    const wurzel = el("fieldset", { class: "feld" });
    const legende = el("legend", { class: "legende" }, "Orte");
    const liste = el("div", { class: "ws-orte" });
    const status = el(
      "p",
      { class: "hilfe", role: "status" },
      "Orte werden geladen …",
    );
    const gewaehlt = () => new Set(b.daten.ortIds ?? []);
    const fuelle = (a) => {
      const aktiv = gewaehlt();
      const bekannt = new Set(a.orte.map((o) => o.id));
      const zeilen = [
        ...a.orte.map((o) => [o.id, o.name, o.beschreibung]),
        ...[...aktiv]
          .filter((id) => !bekannt.has(id))
          .map((id) => [id, "Ort nicht mehr verfügbar", null]),
      ];
      liste.replaceChildren(
        ...zeilen.map(([id, name, beschreibung]) => {
          const boxId = neueId("ort");
          const box = el("input", {
            type: "checkbox",
            id: boxId,
            checked: aktiv.has(id),
            onchange: () => {
              const neu = new Set(gewaehlt());
              if (box.checked) neu.add(id);
              else neu.delete(id);
              if (neu.size > MAX_TREFFPUNKTE) {
                box.checked = false;
                k.ctx.melde(
                  `Mehr als ${MAX_TREFFPUNKTE} Orte sind nicht möglich.`,
                  "fehler",
                );
                return;
              }
              b.daten.ortIds = zeilen.map(([i]) => i).filter((i) => neu.has(i));
              k.aendere(b);
              h.loescheFeldFehler(wurzel);
            },
          });
          return el(
            "div",
            { class: "ws-ortzeile" },
            box,
            el(
              "label",
              { for: boxId },
              name,
              beschreibung
                ? el("span", { class: "hilfe" }, ` ${beschreibung}`)
                : "",
            ),
          );
        }),
      );
      status.replaceChildren(
        a.orte.length === 0
          ? "Es gibt noch keine Orte. Lege sie unter «Orte» in der Verwaltung an."
          : "Die Karten stehen auf der Website als Link zu Google Maps, nie eingebettet.",
      );
    };
    const lade = () => {
      status.replaceChildren("Orte werden geladen …");
      ladeAuswahl().then(fuelle, (fehler) => {
        status.replaceChildren(
          el(
            "span",
            { class: "fehlertext", role: "alert" },
            fehlertext(fehler),
          ),
          " ",
          knopf("Nochmals versuchen", { klein: true, onclick: lade }),
        );
      });
    };
    wurzel.append(legende, liste, status);
    reg("daten.ortIds", wurzel, wurzel);
    lade();
    return wurzel;
  }

  // Die Zahlen als Ankreuzliste
  const ZAHLEN = [
    ["stufen", "Anzahl Stufen"],
    ["leitende", "Anzahl Leitende (erst ab 3 Personen)"],
    ["anlaesse", "Anzahl kommender öffentlicher Anlässe"],
  ];
  function zahlenWahl(k, b, reg) {
    const wurzel = el("fieldset", { class: "feld" });
    wurzel.append(el("legend", { class: "legende" }, "Welche Zahlen?"));
    for (const [art, text] of ZAHLEN) {
      const id = neueId("zahl");
      const box = el("input", {
        type: "checkbox",
        id,
        checked: (b.daten.zahlen ?? []).includes(art),
        onchange: () => {
          const neu = new Set(b.daten.zahlen ?? []);
          if (box.checked) neu.add(art);
          else neu.delete(art);
          b.daten.zahlen = ZAHLEN.map(([a]) => a).filter((a) => neu.has(a));
          k.aendere(b);
          h.loescheFeldFehler(wurzel);
        },
      });
      wurzel.append(
        el(
          "div",
          { class: "ws-ortzeile" },
          box,
          el("label", { for: id }, text),
        ),
      );
    }
    wurzel.append(
      el(
        "p",
        { class: "hilfe" },
        "Nur Zählwerte der Abteilung, nie Namen oder Angaben zu Kindern. Die Zahlen ändern sich auf der Website mit dem nächsten Abgleich (spätestens nach 10 Minuten).",
      ),
    );
    reg("daten.zahlen", wurzel, wurzel.querySelector("input"));
    return wurzel;
  }

  const hilfe = (text) => el("p", { class: "hilfe" }, text);
  const STAND =
    "Die Angaben holt der Server beim Erzeugen der Seite; Änderungen am Anlass stehen nach dem nächsten Abgleich (spätestens nach 10 Minuten) auf der Website.";

  const TYPEN = {
    naechsterAnlass: {
      name: "Nächster Anlass",
      kurz: (d) =>
        d.anlassId ? anlassKurz(d.anlassId) : "Der nächste öffentliche Anlass",
      pruefe: () => [],
      form: (k, b, reg) => [
        anlassWahl(k, b, reg, {
          optional: true,
          leer: "Der nächste öffentliche Anlass",
        }),
        artWahl(k, b),
        hilfe(
          `Eine Karte mit Titel, Datum, Ort und einem Knopf: «Anmelden», solange die Anmeldung offen ist, sonst «Mehr erfahren». Ohne Wahl zeigt sie den nächsten öffentlichen Anlass. ${STAND}`,
        ),
      ],
    },
    anlaesse: {
      name: "Anlässe",
      kurz: (d) =>
        `Die nächsten ${d.anzahl ?? ""} ${d.art === "lager" ? "Lager" : d.art === "anlass" ? "Anlässe" : "Anlässe und Lager"}`,
      pruefe: (d) =>
        Number.isInteger(d.anzahl) &&
        d.anzahl >= 1 &&
        d.anzahl <= MAX_ANLASS_ANZAHL
          ? []
          : [
              [
                "daten.anzahl",
                `ist eine ganze Zahl von 1 bis ${MAX_ANLASS_ANZAHL}.`,
              ],
            ],
      form: (k, b, reg) => [
        eingabe(k, b, reg, "anzahl", "Anzahl Anlässe", {
          zahl: true,
          inputmode: "numeric",
          hilfe: `1 bis ${MAX_ANLASS_ANZAHL}`,
          class: "ws-kurzfeld",
        }),
        artWahl(k, b),
        hilfe(
          `Die kommenden öffentlichen Anlässe als Karten, der nächste zuerst. Ohne Anlass steht «Im Moment sind keine Anlässe eingetragen.» ${STAND}`,
        ),
      ],
    },
    lagerkarte: {
      name: "Lager-Karte",
      kurz: (d) => (d.anlassId ? anlassKurz(d.anlassId) : ""),
      pruefe: (d) => (d.anlassId ? [] : [["daten.anlassId", "fehlt."]]),
      form: (k, b, reg) => [
        anlassWahl(k, b, reg, { optional: false, leer: "" }),
        eingabe(k, b, reg, "kosten", "Kosten (optional)", {
          maxlength: 60,
          optional: true,
          hilfe:
            "Zum Beispiel CHF 280.– oder «gratis». Eine Angabe der Seite: Der Anlass kennt keinen Preis.",
        }),
        eingabe(k, b, reg, "hinweis", "Hinweis (optional)", {
          maxlength: 200,
          optional: true,
          mehrzeilig: true,
          rows: 2,
        }),
        hilfe(
          `Datum, Zeit, Ort und Anmeldeschluss kommen vom Anlass, dazu der Knopf zur Anmeldung. ${STAND}`,
        ),
      ],
    },
    countdown: {
      name: "Countdown",
      kurz: (d) =>
        `${d.bis === "frist" ? "Bis zum Anmeldeschluss" : "Bis zum Beginn"}: ${d.anlassId ? anlassKurz(d.anlassId) : "nächster Anlass"}`,
      pruefe: () => [],
      form: (k, b, reg) => [
        anlassWahl(k, b, reg, {
          optional: true,
          leer: "Der nächste öffentliche Anlass",
        }),
        wahl(k, b, reg, "bis", "Bis wann?", [
          ["beginn", "Bis zum Beginn"],
          ["frist", "Bis zum Anmeldeschluss"],
        ]),
        hilfe(
          "«Noch 12 Tage bis …» wird beim Erzeugen der Seite gerechnet und täglich neu; das Datum steht daneben. Ist das Ziel vorbei, verschwindet der Baustein von selbst.",
        ),
      ],
    },
    treffpunkte: {
      name: "Treffpunkte",
      kurz: (d) => zahlText((d.ortIds ?? []).length, "1 Ort", "Orte"),
      pruefe: (d) =>
        (d.ortIds ?? []).length === 0 ? [["daten.ortIds", "fehlt."]] : [],
      form: (k, b, reg) => [
        ortWahl(k, b, reg),
        hilfe(
          "Name, Beschreibung und Link «Auf Google Maps ansehen» aus der Orte-Bibliothek. Die Reihenfolge ist die der Bibliothek.",
        ),
      ],
    },
    dokumente: {
      name: "Dokumente",
      kurz: (d) =>
        zahlText((d.eintraege ?? []).length, "1 Dokument", "Dokumente"),
      pruefe: (d) => [
        ...((d.eintraege ?? []).length === 0
          ? [["daten.eintraege", "fehlt."]]
          : []),
        ...(d.eintraege ?? []).flatMap((e, i) => [
          ...(e.titel?.trim()
            ? []
            : [[`daten.eintraege.${i}.titel`, "fehlt."]]),
          ...(e.link?.trim() ? [] : [[`daten.eintraege.${i}.link`, "fehlt."]]),
          ...(e.groesse === undefined || e.groesse >= 0
            ? []
            : [[`daten.eintraege.${i}.groesse`, "ist eine Zahl ab 0."]]),
        ]),
      ],
      form: (k, b, reg) => [
        hilfe(
          "Mehrere Dateien aus dem SharePoint der Abteilung als Liste mit Typ und Grösse. Sie werden nur verknüpft, nie hochgeladen.",
        ),
        listenForm(k, b, {
          name: "Dokument",
          listeName: "Dokumente",
          pfadName: "daten.eintraege",
          liste: () => b.daten.eintraege,
          max: MAX_DOKUMENTE,
          hinzuText: "Dokument hinzufügen",
          hinzu: (liste, fertig) => {
            liste.push({ titel: "", link: "" });
            fertig(liste.length - 1);
          },
          zeile: (e, pfad) => {
            const gr = feld({
              label: "Grösse in Kilobyte (optional)",
              wert: e.groesse === undefined ? "" : String(e.groesse / 1000),
              inputmode: "decimal",
              autocomplete: "off",
            });
            gr.eingabe.addEventListener("input", () => {
              const wert = Number(gr.eingabe.value.trim().replace(",", "."));
              if (gr.eingabe.value.trim() === "") delete e.groesse;
              else
                e.groesse = Number.isFinite(wert)
                  ? Math.round(wert * 1000)
                  : -1;
              k.aendere(b);
            });
            anmelden(reg, `${pfad}.groesse`, gr);
            return [
              teilEingabe(k, b, reg, e, "titel", "Titel", `${pfad}.titel`, {
                maxlength: 100,
              }),
              teilEingabe(
                k,
                b,
                reg,
                e,
                "link",
                "Link zur Datei",
                `${pfad}.link`,
                {
                  maxlength: 2048,
                  spellcheck: "false",
                  autocapitalize: "off",
                  hilfe:
                    "Der Freigabelink der Datei im SharePoint. Er beginnt mit https.",
                },
              ),
              teilEingabe(
                k,
                b,
                reg,
                e,
                "typ",
                "Dateityp (optional)",
                `${pfad}.typ`,
                {
                  optional: true,
                  maxlength: 20,
                  hilfe: "Zum Beispiel PDF oder Word.",
                },
              ),
              gr.wurzel,
              teilEingabe(
                k,
                b,
                reg,
                e,
                "hinweis",
                "Hinweis (optional)",
                `${pfad}.hinweis`,
                {
                  optional: true,
                  maxlength: 200,
                },
              ),
            ];
          },
        }),
      ],
    },
    kennzahlen: {
      name: "Cevi in Zahlen",
      kurz: (d) => zahlText((d.zahlen ?? []).length, "1 Zahl", "Zahlen"),
      pruefe: (d) =>
        (d.zahlen ?? []).length === 0 ? [["daten.zahlen", "fehlt."]] : [],
      form: (k, b, reg) => [zahlenWahl(k, b, reg)],
    },
  };

  const KATALOG = [
    {
      typ: "naechsterAnlass",
      gruppe: "Dynamisch",
      beschreibung:
        "Eine Karte für den nächsten öffentlichen Anlass, mit Knopf zur Anmeldung.",
      neu: () => ({}),
      beispiel: () => ({}),
    },
    {
      typ: "anlaesse",
      gruppe: "Dynamisch",
      beschreibung: "Die kommenden öffentlichen Anlässe und Lager als Karten.",
      neu: () => ({ anzahl: 3 }),
      beispiel: () => ({ anzahl: 3 }),
    },
    {
      typ: "lagerkarte",
      gruppe: "Dynamisch",
      beschreibung:
        "Datum, Ort, Anmeldeschluss und Kosten eines Lagers auf einer Karte.",
      neu: () => ({}),
      beispiel: () => ({
        anlassId: "00000000-0000-4000-8000-000000000000",
        kosten: "CHF 280.–",
      }),
    },
    {
      typ: "countdown",
      gruppe: "Dynamisch",
      beschreibung:
        "«Noch 12 Tage bis …» mit Datum, bis zum Anlass oder zum Anmeldeschluss.",
      neu: () => ({ bis: "beginn" }),
      beispiel: () => ({ bis: "beginn" }),
    },
    {
      typ: "treffpunkte",
      gruppe: "Karten und Listen",
      beschreibung: "Orte der Bibliothek mit Adresse und Link zur Karte.",
      neu: () => ({ ortIds: [] }),
      beispiel: () => ({ ortIds: ["00000000-0000-4000-8000-000000000000"] }),
    },
    {
      typ: "dokumente",
      gruppe: "Karten und Listen",
      beschreibung: "Mehrere Dateien zum Herunterladen mit Typ und Grösse.",
      neu: () => ({ eintraege: [{ titel: "", link: "" }] }),
      beispiel: () => ({
        eintraege: [
          {
            titel: "Anmeldeformular",
            link: "https://example.sharepoint.com/f/anmeldung",
            typ: "PDF",
            groesse: 120000,
          },
          {
            titel: "Packliste",
            link: "https://example.sharepoint.com/f/packliste",
            typ: "PDF",
            groesse: 80000,
          },
        ],
      }),
    },
    {
      typ: "kennzahlen",
      gruppe: "Dynamisch",
      beschreibung: "Zahl der Stufen, der Leitenden und der kommenden Anlässe.",
      neu: () => ({ zahlen: ["stufen", "anlaesse"] }),
      beispiel: () => ({ zahlen: ["stufen", "leitende", "anlaesse"] }),
    },
  ];

  return { TYPEN, KATALOG };
}
