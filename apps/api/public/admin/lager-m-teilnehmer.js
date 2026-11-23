import { anfrage } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";
import { oeffneFluss } from "./fluss.js";
import { flussKopf } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonTabelle } from "./lader.js";
import { macheSortierbar, seitenleiste, sortiere } from "./liste-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { leerKarte } from "./zustaende.js";
import { beschrifteZellen, kartenTabelle } from "./lager-gemeinsam.js";
import {
  GRUND_TEXT,
  IMPORT_MAX_ZEILEN,
  importZusammenfassung,
  mehrzahl,
  teilnehmerName,
  teilnehmerSortName,
  zaehleImport,
} from "./lager-menschen-logik.js";
import {
  kopfAktion,
  erstelleAuswahl,
  keinLeserecht,
  kopfeMitHinweis,
  LB,
  ladeAlle,
  ladeKontext,
  meldung,
  sendeMitKonflikt,
  zustandsChip,
} from "./lager-menschen.js";

// Teilnehmende (#675; Server #384): Tabelle mit Suche, Stufe und «Nicht dabei», Person erfassen und ändern, Import aus einer Tabelle mit Vorschau und Fehlerliste (höchstens 500 Zeilen), Löschen mit «Rückgängig». Den Cevi-Namen sieht nur, wer teilnehmer.bearbeiten hat; Gesundheitsdaten gibt es hier nicht. Adresse: #lager/lager/<id>/teilnehmer

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("teilnehmer.lesen")) return { k, liste: null };
      return {
        k,
        liste: await ladeAlle(`${LB(lagerId)}/teilnehmer`, "teilnehmer"),
      };
    },
    ({ k, liste }, neu) => zeichne(bereich, ctx, k, liste, neu),
    {
      skeleton: () => skeletonTabelle({ spalten: 5, zeilen: 6, avatar: false }),
    },
  );
}

const FELDER = [
  ["vorname", "Vorname"],
  ["nachname", "Nachname"],
  ["stufe", "Stufe"],
  ["ceviName", "Cevi-Name"],
];

function zeichne(bereich, ctx, k, alle, neu) {
  kopfeMitHinweis(bereich, ctx, k, "Teilnehmende");
  if (!alle) return keinLeserecht(bereich, "die Teilnehmenden");
  const bearbeiten = k.kann("teilnehmer.bearbeiten");
  const einteilen = k.kann("einteilung.bearbeiten");
  const mitCevi = alle.some((t) => "ceviName" in t);

  if (bearbeiten)
    kopfAktion(
      ctx,
      knopf("Person hinzufügen", {
        art: "haupt",
        symbol: "plus",
        onclick: () => formular(ctx, k, null, neu),
      }),
    );
  else ctx.kopfAktion();

  if (alle.length === 0) {
    bereich.append(
      leerKarte(
        bearbeiten
          ? "Noch keine Teilnehmenden. Erfasse Personen oder importiere sie aus einer Tabelle."
          : "Noch keine Teilnehmenden. Die Lagerleitung erfasst sie.",
        bearbeiten
          ? [
              knopf("Aus Tabelle importieren", {
                symbol: "plus",
                onclick: () => importSeite(ctx, k, neu),
              }),
            ]
          : [],
      ),
    );
    return;
  }

  const stand = { suche: "", filter: { stufe: "alle", dabei: "alle" } };
  const zustand = { schluessel: "name", richtung: "auf" };
  const gewaehlt = erstelleAuswahl(() => leiste2.aktualisiere());
  const stufen = [...new Set(alle.map((t) => t.stufe).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "de"),
  );
  const leiste = filterleiste({
    suche: { label: "Person suchen" },
    filter: [
      {
        schluessel: "stufe",
        label: "Stufe",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle Stufen"],
          ...stufen.map((s) => [s, s]),
          ["ohne", "Ohne Stufe"],
        ],
      },
      {
        schluessel: "dabei",
        label: "Teilnahme",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ["dabei", "Dabei"],
          ["nicht", "Nicht dabei"],
        ],
      },
    ],
    namen: { einzahl: "Person", mehrzahl: "Personen" },
    beiAenderung: (s) => {
      stand.suche = s.suche.trim().toLowerCase();
      stand.filter = s.filter;
      seiten.anfang();
      zeichneZeilen();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => zeichneZeilen() });
  const spalten = [
    ...(einteilen ? [["Auswahl", "auswahl"]] : []),
    "Name",
    "Stufe",
    ...(mitCevi ? ["Cevi-Name"] : []),
    "Teilnahme",
    ...(bearbeiten || einteilen ? ["Aktionen"] : []),
  ];
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Teilnehmende",
    spalten,
    zeilen: [],
  });
  kartenTabelle(rahmen);
  const off = einteilen ? 1 : 0;
  macheSortierbar(
    rahmen,
    [
      { index: off, schluessel: "name", name: "Name" },
      { index: off + 1, schluessel: "stufe", name: "Stufe" },
      ...(mitCevi
        ? [{ index: off + 2, schluessel: "cevi", name: "Cevi-Name" }]
        : []),
      {
        index: off + 2 + (mitCevi ? 1 : 0),
        schluessel: "dabei",
        name: "Teilnahme",
      },
    ],
    zustand,
    () => zeichneZeilen(),
  );
  const leer = el("div");

  // «Nicht dabei» setzen oder aufheben: eigene Route der Gruppen (einteilung.bearbeiten)
  async function setzeAbgewaehlt(personen, abgewaehlt) {
    try {
      await anfrage("PUT", `${LB(k.lagerId)}/gruppen/abgewaehlt`, {
        abgewaehlt,
        teilnehmerIds: personen.map((p) => p.id),
      });
      ctx.melde(
        abgewaehlt
          ? `${personen.length === 1 ? teilnehmerName(personen[0]) : mehrzahl(personen.length, "Person", "Personen")} ${personen.length === 1 ? "ist" : "sind"} nicht dabei. Aus den Gruppen sind sie entfernt.`
          : `${personen.length === 1 ? teilnehmerName(personen[0]) : mehrzahl(personen.length, "Person", "Personen")} ${personen.length === 1 ? "ist" : "sind"} wieder dabei.`,
      );
      gewaehlt.leeren();
      neu();
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
    }
  }

  const loesche = (t, ereignis) =>
    ctx.mitRueckgaengig({
      text: `${teilnehmerName(t)} ist gelöscht`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${LB(k.lagerId)}/teilnehmer/${t.id}?version=${t.version}`,
        ),
      fehlertext: meldung,
      danach: neu,
    });

  function zeichneZeilen() {
    const treffer = sortiere(
      alle
        .filter((t) => {
          const f = stand.filter;
          if (f.stufe === "ohne" && t.stufe) return false;
          if (f.stufe !== "alle" && f.stufe !== "ohne" && t.stufe !== f.stufe)
            return false;
          if (f.dabei === "dabei" && t.abgewaehlt) return false;
          if (f.dabei === "nicht" && !t.abgewaehlt) return false;
          return (
            stand.suche === "" ||
            teilnehmerName(t).toLowerCase().includes(stand.suche) ||
            (t.ceviName ?? "").toLowerCase().includes(stand.suche)
          );
        })
        .map((t) => ({ ...t, name: teilnehmerSortName(t) })),
      zustand,
      (t, s) =>
        s === "stufe"
          ? (t.stufe ?? "")
          : s === "cevi"
            ? (t.ceviName ?? "")
            : s === "dabei"
              ? Number(t.abgewaehlt)
              : t.name,
    );
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(...treffer.slice(von, bis).map((t) => zeile(t)));
    beschrifteZellen(koerper, [
      ...(einteilen ? [""] : []),
      "",
      "Stufe",
      ...(mitCevi ? ["Cevi-Name"] : []),
      "Teilnahme",
      "",
    ]);
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0)
      leer.append(
        leerKarte(
          stand.suche
            ? `Keine Treffer für «${stand.suche}».`
            : "Keine Person passt zu diesen Filtern.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ],
        ),
      );
    leiste.setzeTreffer(treffer.length, alle.length);
  }

  function zeile(t) {
    const kasten = einteilen
      ? ankreuzen({
          label: `${teilnehmerName(t)} auswählen`,
          gewaehlt: gewaehlt.hat(t.id),
        })
      : null;
    if (kasten) {
      kasten.wurzel.querySelector("label").classList.add("nur-leser");
      kasten.wurzel.classList.add("mn-wahl");
      kasten.eingabe.addEventListener("change", () =>
        gewaehlt.umschalten({ ...t, schluessel: t.id }, kasten.eingabe.checked),
      );
    }
    return el(
      "tr",
      { class: t.abgewaehlt ? "inaktiv" : undefined },
      kasten && el("td", { class: "mn-auswahlzelle" }, kasten.wurzel),
      el(
        "th",
        { scope: "row" },
        el("span", { class: "name" }, `${t.nachname} ${t.vorname}`),
      ),
      el("td", {}, t.stufe ?? "–"),
      mitCevi && el("td", {}, t.ceviName ?? "–"),
      el(
        "td",
        {},
        t.abgewaehlt
          ? zustandsChip("Nicht dabei", "warn", "minus")
          : zustandsChip("Dabei", "ok", "haken"),
      ),
      (bearbeiten || einteilen) &&
        aktionenZelle(
          bearbeiten &&
            knopf("Ändern", {
              klein: true,
              art: "still",
              symbol: "bearbeiten",
              kontext: teilnehmerName(t),
              onclick: () => formular(ctx, k, t, neu),
            }),
          einteilen &&
            knopf(t.abgewaehlt ? "Wieder dabei" : "Nicht dabei", {
              klein: true,
              art: "still",
              kontext: teilnehmerName(t),
              onclick: () => setzeAbgewaehlt([t], !t.abgewaehlt),
            }),
          bearbeiten &&
            knopf("Löschen", {
              klein: true,
              art: "still",
              symbol: "papierkorb",
              kontext: teilnehmerName(t),
              onclick: (e) => loesche(t, e),
            }),
        ),
    );
  }

  // Auswahlleiste: mehrere auf einmal «nicht dabei» oder wieder dabei
  const leiste2 = {
    wurzel: el("div", {
      class: "mn-leiste",
      role: "region",
      "aria-label": "Auswahl",
      hidden: true,
    }),
    aktualisiere() {
      const l = gewaehlt.liste();
      leiste2.wurzel.hidden = l.length === 0;
      if (l.length === 0) return;
      leiste2.wurzel.replaceChildren(
        el(
          "p",
          { class: "mn-leiste-zahl", role: "status" },
          l.length === 1 ? "1 ausgewählt" : `${l.length} ausgewählt`,
        ),
        knopf("Nicht dabei", { onclick: () => setzeAbgewaehlt(l, true) }),
        knopf("Wieder dabei", { onclick: () => setzeAbgewaehlt(l, false) }),
        knopf("Auswahl aufheben", {
          onclick: () => {
            gewaehlt.leeren();
            zeichneZeilen();
          },
        }),
      );
    },
  };

  const kopfWerkzeuge = el(
    "div",
    { class: "mn-werkzeuge" },
    bearbeiten &&
      knopf("Aus Tabelle importieren", {
        symbol: "plus",
        onclick: () => importSeite(ctx, k, neu),
      }),
    false,
  );
  bereich.append(
    kopfWerkzeuge,
    leiste.wurzel,
    rahmen,
    leer,
    seiten.wurzel,
    leiste2.wurzel,
  );
  zeichneZeilen();
}

// Person erfassen oder ändern: Seite im Fluss mit Konfliktbehandlung
function formular(ctx, k, t, neu) {
  const vorname = feld({
    label: "Vorname",
    wert: t?.vorname ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const nachname = feld({
    label: "Nachname",
    wert: t?.nachname ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const stufe = feld({
    label: "Stufe",
    hilfe: "Freiwillig.",
    wert: t?.stufe ?? "",
    maxlength: 50,
    autocomplete: "off",
  });
  const cevi = feld({
    label: "Cevi-Name",
    hilfe:
      "Freiwillig. So steht die Person auf Aushängen. Ohne Cevi-Name gilt der Vorname.",
    wert: t?.ceviName ?? "",
    maxlength: 50,
    autocomplete: "off",
  });
  const werte = () => ({
    vorname: vorname.eingabe.value.trim(),
    nachname: nachname.eingabe.value.trim(),
    stufe: stufe.eingabe.value.trim() || null,
    ceviName: cevi.eingabe.value.trim() || null,
  });
  let seite;
  const sende = async (version) => {
    const w = werte();
    if (!t) return anfrage("POST", `${LB(k.lagerId)}/teilnehmer`, w);
    // Nur Geändertes senden; so überschreibt ein Konflikt nichts, was niemand angefasst hat
    const geaendert = Object.fromEntries(
      Object.entries(w).filter(([key, wert]) => (t[key] ?? null) !== wert),
    );
    if (Object.keys(geaendert).length === 0) return t;
    return anfrage("PATCH", `${LB(k.lagerId)}/teilnehmer/${t.id}`, {
      version: version ?? t.version,
      ...geaendert,
    });
  };
  seite = dialogFormular({
    titel: t ? "Person ändern" : "Person hinzufügen",
    beschreibung: t
      ? teilnehmerName(t)
      : "Die Person erscheint in allen Listen des Lagers.",
    felder: [vorname.wurzel, nachname.wurzel, stufe.wurzel, cevi.wurzel],
    ok: t ? "Speichern" : "Hinzufügen",
    fehlertext: meldung,
    senden: sendeMitKonflikt({
      getSeite: () => seite,
      sende,
      felder: FELDER,
      meine: werte,
      beiServer: neu,
    }),
    danach: () => {
      ctx.melde(
        t ? "Gespeichert." : `${teilnehmerName(werte())} ist im Lager.`,
      );
      neu();
    },
  });
}

// Import: einfügen oder Datei wählen, Vorschau mit Fehlerliste, dann übernehmen. Der Server liest und prüft; geschrieben wird erst nach «Übernehmen».
function importSeite(ctx, k, neu) {
  const titelId = "import-titel";
  const text = feld({
    label: "Personen aus der Tabelle",
    hilfe: `Eine Person pro Zeile: Vorname, Nachname, Stufe, Cevi-Name. Stufe und Cevi-Name sind freiwillig. Kopiere die Zellen aus Excel und füge sie hier ein. Höchstens ${IMPORT_MAX_ZEILEN} Zeilen.`,
    mehrzeilig: true,
    rows: 8,
    spellcheck: "false",
    class: "mn-importfeld",
  });
  const datei = feld({
    label: "Oder eine Datei wählen",
    hilfe:
      "Als CSV oder Text gespeichert (Tabulator oder Strichpunkt als Trenner).",
    typ: "file",
    accept: ".csv,.tsv,.txt,text/csv,text/plain",
  });
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const ausgabe = el("div", {
    class: "mn-importausgabe",
    "aria-live": "polite",
  });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const vorschau = knopf("Vorschau ansehen", { art: "haupt", symbol: "lupe" });
  const uebernehmen = knopf("Übernehmen", { art: "haupt", hidden: true });
  const abbrechen = knopf("Abbrechen", {
    onclick: () => seite.versuchSchliessen(),
  });
  const { kopf } = flussKopf({
    titelId,
    titel: "Teilnehmende importieren",
    beschreibung:
      "Zuerst siehst du eine Vorschau. Erst «Übernehmen» legt die Personen an.",
    beiZurueck: () => seite.versuchSchliessen(),
  });
  const seite = el(
    "section",
    { class: "fluss-seite fluss-formular", "aria-labelledby": titelId },
    kopf,
    el(
      "div",
      { class: "fluss-karte" },
      el(
        "div",
        { class: "formular" },
        text.wurzel,
        datei.wurzel,
        zaehler,
        fehler,
        ausgabe,
        el(
          "div",
          { class: "dialog-knoepfe" },
          abbrechen,
          vorschau,
          uebernehmen,
        ),
      ),
    ),
  );
  const pruefeText = () => {
    const z = zaehleImport(text.eingabe.value);
    zaehler.textContent =
      z.zeilen === 0 ? "" : `${mehrzahl(z.zeilen, "Zeile", "Zeilen")} erkannt.`;
    vorschau.disabled = z.zeilen === 0;
    return z;
  };
  text.eingabe.addEventListener("input", () => {
    uebernehmen.hidden = true;
    ausgabe.replaceChildren();
    fehler.hidden = true;
    pruefeText();
  });
  datei.eingabe.addEventListener("change", async () => {
    const f = datei.eingabe.files?.[0];
    if (!f) return;
    if (f.size > 200_000) {
      fehler.textContent = "Die Datei ist zu gross. Teile die Liste auf.";
      fehler.hidden = false;
      return;
    }
    // Excel speichert CSV oft als Windows-Zeichensatz; ein Zeichen ohne Umlaut-Fehler lesen wir als UTF-8
    text.eingabe.value = await f.text();
    text.eingabe.dispatchEvent(new Event("input"));
  });

  const sende = async (uebernehmenJetzt) => {
    const z = pruefeText();
    if (z.zuViele || z.zuLang) {
      fehler.textContent = z.zuViele
        ? `Die Liste hat ${z.zeilen} Zeilen. Ein Import nimmt höchstens ${IMPORT_MAX_ZEILEN}. Teile die Liste auf.`
        : "Der Text ist zu lang. Teile die Liste auf.";
      fehler.hidden = false;
      fehler.focus();
      return null;
    }
    fehler.hidden = true;
    return anfrage("POST", `${LB(k.lagerId)}/teilnehmer/import`, {
      text: text.eingabe.value,
      uebernehmen: uebernehmenJetzt,
    });
  };

  vorschau.addEventListener("click", async () => {
    vorschau.disabled = true;
    vorschau.setAttribute("aria-busy", "true");
    try {
      const e = await sende(false);
      if (!e) return;
      zeigeVorschau(ausgabe, e);
      vorschau.classList.remove("knopf--haupt");
      uebernehmen.hidden = e.neu.length === 0;
      uebernehmen.textContent = `${mehrzahl(e.neu.length, "Person", "Personen")} übernehmen`;
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      vorschau.disabled = false;
      vorschau.removeAttribute("aria-busy");
    }
  });
  uebernehmen.addEventListener("click", async () => {
    uebernehmen.disabled = vorschau.disabled = true;
    uebernehmen.setAttribute("aria-busy", "true");
    try {
      const e = await sende(true);
      if (!e) return;
      seite.close();
      ctx.melde(`${mehrzahl(e.angelegt, "Person", "Personen")} übernommen.`);
      neu();
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      uebernehmen.disabled = vorschau.disabled = false;
      uebernehmen.removeAttribute("aria-busy");
    }
  });
  vorschau.disabled = true;
  oeffneFluss(seite);
  text.eingabe.focus();
}

// Vorschau: Zusammenfassung, die neuen Personen als Tabelle, darunter Fehler und übersprungene Zeilen mit Zeilennummer
function zeigeVorschau(ausgabe, e) {
  const teile = [el("p", { class: "fett" }, importZusammenfassung(e))];
  if (e.neu.length > 0) {
    teile.push(
      tabelle({
        beschriftung: "Neue Personen",
        spalten: [
          ["Zeile", "zahl"],
          "Vorname",
          "Nachname",
          "Stufe",
          "Cevi-Name",
        ],
        zeilen: e.neu.map((z) =>
          el(
            "tr",
            {},
            el("td", { class: "lg-zahlen rechts" }, String(z.zeile)),
            el("td", {}, z.vorname),
            el("td", {}, z.nachname),
            el("td", {}, z.stufe ?? "–"),
            el("td", {}, z.ceviName ?? "–"),
          ),
        ),
      }).wurzel,
    );
  }
  if (e.fehler.length > 0) {
    teile.push(
      el("h3", {}, "Fehler in diesen Zeilen"),
      el(
        "ul",
        { class: "mn-fehlerliste" },
        e.fehler.map((f) =>
          el("li", {}, el("strong", {}, `Zeile ${f.zeile}: `), f.message),
        ),
      ),
      el(
        "p",
        { class: "klein leise" },
        "Diese Zeilen werden nicht übernommen. Korrigiere sie oben und sieh die Vorschau nochmals an.",
      ),
    );
  }
  if (e.doppelt.length > 0) {
    teile.push(
      el("h3", {}, "Übersprungen"),
      el(
        "ul",
        { class: "mn-fehlerliste" },
        e.doppelt.map((d) =>
          el(
            "li",
            {},
            el("strong", {}, `Zeile ${d.zeile}: `),
            GRUND_TEXT[d.grund] ?? "Doppelt.",
          ),
        ),
      ),
    );
  }
  if (e.neu.length === 0 && e.fehler.length === 0 && e.doppelt.length === 0)
    teile.push(
      el("p", { class: "leise" }, "In diesem Text steht keine Person."),
    );
  ausgabe.replaceChildren(...teile);
}
