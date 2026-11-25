import { ApiFehler, anfrage } from "./api.js";
import { datumsfeld, zahlfeld } from "./datumsfeld.js";
import { ankreuzen, auswahl, el, feld, knopf } from "./dom.js";
import {
  balkenBis,
  bewegeUm,
  blendeEin,
  blitze,
  ersetzeMitBewegung,
  klappe,
  puls,
  staffle,
  zaehlZahl,
} from "./lager-anim.js";
import { sortierListe } from "./sortieren.js";
import { zweiStufig } from "./rueckgaengig.js";
import { schuetze } from "./ungespeichert.js";
import { feldFehler, symbol, zurueckLink } from "./lager-gemeinsam.js";
import {
  API,
  adresse,
  fehlerText,
  fristChip,
  geschlossenHinweis,
  istGeschlossen,
  istKonflikt,
  konfliktKarte,
  ladeAufgaben,
  ladeLagerMitRechten,
  ladeMitglieder,
  ladeRessorts,
  personZeile,
  personenOptionen,
  rechteVon,
  ressortOptionen,
  skeletonAufgabeDetail,
  statusChip,
} from "./lager-aufgaben-gemeinsam.js";
import {
  STATUS_WAHL,
  WIEDERHOLUNG,
  datumMitTag,
  eintraegeNach,
  heute,
  istErledigt,
  personName,
  relativeFristText,
} from "./lager-aufgaben-logik.js";

// Detail einer Aufgabe (#670, Adresse #lager/lager/<id>/aufgaben/<aufgabeId>): Angaben mit Speicherleiste, Checkliste, Links, Stichworte, ähnliche Aufgaben zum Zusammenführen und der Verlauf. Wer nur eigene Aufgaben lesen darf, setzt den Status und hakt Punkte ab; alles andere zeigt die Seite als Text.

export function zeige(bereich, ctx, lagerId, lager, aufgabeId) {
  let erstes = true;
  ctx.lade(
    async () => {
      const l = await ladeLagerMitRechten(lagerId, erstes ? lager : undefined);
      erstes = false;
      const rechte = rechteVon(l);
      if (!rechte.lesen) throw new ApiFehler(403);
      const [a, details] = await Promise.all([
        anfrage("GET", `${API(lagerId)}/aufgaben/${aufgabeId}`),
        anfrage("GET", `${API(lagerId)}/aufgaben/${aufgabeId}/details`),
      ]);
      // Alles Weitere ist Zugabe: Fehlt ein Recht, fehlt der Abschnitt
      const [urheber, zeitplan, alle] = await Promise.all([
        rechte.verlauf
          ? anfrage(
              "GET",
              `${API(lagerId)}/aufgaben/${aufgabeId}/verlauf?limit=20`,
            ).catch(() => null)
          : null,
        rechte.zeitplanLesen
          ? anfrage("GET", `${API(lagerId)}/zeitplan`).catch(() => null)
          : null,
        rechte.bearbeiten ? ladeAufgaben(lagerId).catch(() => []) : [],
      ]);
      const [mitglieder, ressorts] = await Promise.all([
        ladeMitglieder(lagerId, alle.length ? alle : [a], ctx.ich),
        ladeRessorts(lagerId, alle.length ? alle : [a], rechte.ressorts),
      ]);
      return {
        lager: l,
        rechte,
        a,
        details,
        urheber,
        zeitplan,
        mitglieder,
        ressorts,
      };
    },
    (d, neu) => zeichne(bereich, ctx, lagerId, d, neu),
    { skeleton: () => skeletonAufgabeDetail() },
  );
}

const zurAufgabenListe = (lagerId) => adresse(lagerId, "aufgaben");

function zeichne(bereich, ctx, lagerId, d, neuLaden) {
  const { rechte } = d;
  const D = {
    a: d.a,
    details: d.details,
    personen: d.mitglieder.personen,
    ressorts: d.ressorts,
    meilensteine: d.zeitplan?.meilensteine ?? [],
    verlauf: d.urheber,
  };
  const ids = () => ({
    ressorts: new Map(D.ressorts.map((r) => [r.id, `${r.kuerzel} ${r.name}`])),
    personen: new Map(D.personen.map((p) => [p.id, p.name])),
  });
  ctx.titel(D.a.titel, "Aufgabe");
  ctx.kopfAktion();

  const konfliktOrt = el("div", { class: "la-konfliktort" });
  const bereiche = el("div", { class: "la-detail" });

  async function neueAufgabe() {
    D.a = await anfrage("GET", `${API(lagerId)}/aufgaben/${D.a.id}`);
    ctx.titel(D.a.titel, "Aufgabe");
  }
  const melde = (f) =>
    ctx.melde(`Nicht gespeichert. ${fehlerText(f)}`, "fehler");
  async function bei409Geschlossen(f) {
    if (!istGeschlossen(f)) return false;
    ctx.melde(fehlerText(f), "warn");
    neuLaden();
    return true;
  }

  // ---- Angaben ----
  function angaben() {
    const a = D.a;
    const darfAlles = rechte.bearbeiten;
    const kopfZeile = el(
      "div",
      { class: "la-angaben-kopf" },
      statusChip(a.status),
      fristChip(a, heute()),
      a.stern && el("span", { class: "chip" }, symbol("stern"), "Gemerkt"),
    );
    if (!darfAlles) return lesenAnsicht(kopfZeile);

    const titel = feld({
      label: "Titel",
      required: true,
      wert: a.titel,
      maxlength: 200,
      autocomplete: "off",
    });
    const status = auswahl({
      label: "Status",
      optionen: STATUS_WAHL.concat(
        a.status === "naechster_hoeck"
          ? [["naechster_hoeck", "Nächster Höck"]]
          : [],
      ),
      wert: a.status,
    });
    const person = auswahl({
      label: "Verantwortlich",
      optionen: personenOptionen(
        D.personen,
        a.verantwortlich?.automatisch
          ? "Niemand (die Leitung des Ressorts springt ein)"
          : "Niemand",
      ),
      wert: a.verantwortlichPersonId ?? "",
    });
    const ressort = auswahl({
      label: "Ressort",
      optionen: ressortOptionen(D.ressorts),
      wert: a.ressortId ?? "",
    });
    const teil = feld({
      label: "Teilbereich",
      wert: a.teil ?? "",
      maxlength: 100,
      autocomplete: "off",
      hilfe: "Freiwillig.",
    });
    const notiz = feld({
      label: "Notiz",
      mehrzeilig: true,
      rows: 5,
      wert: a.notiz ?? "",
      maxlength: 5000,
    });
    const wiederholung = auswahl({
      label: "Wiederholung",
      optionen: WIEDERHOLUNG,
      wert: a.wiederholung ?? "",
    });
    const spaeter = datumsfeld({
      label: "Erinnerung ab",
      wert: a.spaeterAb ?? "",
      hilfe: "Bis dahin steht die Aufgabe ruhig unter «Später».",
    });
    const stern = ankreuzen({
      label: "Merken",
      gewaehlt: a.stern,
      wert: "stern",
    });
    const laufend = ankreuzen({
      label: "Laufende Aufgabe",
      gewaehlt: a.laufend,
      wert: "laufend",
    });

    // Unterstützung: Liste mit Entfernen und eine Auswahl zum Hinzufügen
    let unterstuetzung = a.unterstuetzung.map((p) => p.id);
    const unterOrt = el("div", { class: "la-unter" });
    const unterNeu = auswahl({
      label: "Unterstützung hinzufügen",
      optionen: [
        ["", "Person wählen"],
        ...D.personen.map((p) => [p.id, p.name]),
      ],
      wert: "",
    });
    const nameVon = (id) =>
      D.personen.find((p) => p.id === id)?.name ??
      personName(a.unterstuetzung.find((p) => p.id === id));
    function zeichneUnter() {
      ersetzeMitBewegung(
        unterOrt,
        el(
          "ul",
          { class: "la-chipliste", "aria-label": "Unterstützung" },
          unterstuetzung.length === 0
            ? el("li", { class: "leise" }, "Niemand unterstützt.")
            : unterstuetzung.map((id) =>
                el(
                  "li",
                  { class: "chip", "data-id": `u-${id}` },
                  nameVon(id),
                  el(
                    "button",
                    {
                      type: "button",
                      class: "la-chip-weg",
                      "aria-label": `Entfernen: ${nameVon(id)}`,
                      onclick: () => {
                        unterstuetzung = unterstuetzung.filter((x) => x !== id);
                        zeichneUnter();
                        markiere();
                      },
                    },
                    symbol("schliessen"),
                  ),
                ),
              ),
        ),
      );
    }
    unterNeu.eingabe.addEventListener("change", () => {
      const id = unterNeu.eingabe.value;
      if (id && !unterstuetzung.includes(id))
        unterstuetzung = [...unterstuetzung, id];
      unterNeu.eingabe.value = "";
      unterNeu.eingabe.dispatchEvent(new Event("change", { bubbles: false }));
      zeichneUnter();
      markiere();
    });
    zeichneUnter();

    // Frist: kein, festes Datum oder relativ zu einem Meilenstein (oder dem Lagerbeginn)
    const relativ = typeof a.fristVersatzTage === "number";
    const fristArten = [
      ["kein", "Keine Frist"],
      ["datum", "Festes Datum"],
    ];
    if (rechte.zeitplanLesen || relativ)
      fristArten.push(["relativ", "Abstand zu einem Meilenstein"]);
    const fristArt = auswahl({
      label: "Frist",
      optionen: fristArten,
      wert: relativ ? "relativ" : a.frist ? "datum" : "kein",
    });
    const fristDatum = datumsfeld({ label: "Datum", wert: a.frist ?? "" });
    const bezug = auswahl({
      label: "Bezug",
      optionen: [
        ["", "Lagerbeginn"],
        ...D.meilensteine.map((m) => [
          m.id,
          `${m.titel} (${datumMitTag(m.datum)})`,
        ]),
      ],
      wert: a.fristMeilensteinId ?? "",
    });
    const richtung = auswahl({
      label: "Richtung",
      optionen: [
        ["vor", "Davor"],
        ["nach", "Danach"],
      ],
      wert: (a.fristVersatzTage ?? 0) < 0 ? "vor" : "nach",
    });
    const versatz = zahlfeld({
      label: "Tage",
      wert: String(Math.abs(a.fristVersatzTage ?? 0)),
      min: 0,
      max: 3650,
    });
    const fristDatumOrt = el("div", {}, fristDatum.wurzel);
    const fristRelOrt = el(
      "div",
      { class: "la-relfrist" },
      bezug.wurzel,
      richtung.wurzel,
      versatz.wurzel,
    );
    const fristHinweis = el("p", { class: "leise klein", role: "status" });
    const zeigeFrist = () => {
      fristDatumOrt.hidden = fristArt.eingabe.value !== "datum";
      fristRelOrt.hidden = fristArt.eingabe.value !== "relativ";
      fristHinweis.textContent =
        fristArt.eingabe.value === "relativ"
          ? `${relativeFristText(
              (richtung.eingabe.value === "vor" ? -1 : 1) *
                Number(versatz.eingabe.value || 0),
              D.meilensteine.find((m) => m.id === bezug.eingabe.value)?.titel,
            )}. Verschiebt sich ein Meilenstein, wandert die Frist mit.`
          : "";
    };
    for (const f of [fristArt, bezug, richtung, versatz])
      f.eingabe.addEventListener("change", zeigeFrist);
    versatz.eingabe.addEventListener("input", zeigeFrist);
    zeigeFrist();

    // Die Speicherleiste erscheint, sobald sich etwas ändert
    const leiste = el("div", {
      class: "lg-speicherleiste",
      hidden: true,
      role: "region",
      "aria-label": "Änderungen speichern",
    });
    const speichern = knopf("Speichern", { art: "haupt" });
    const verwerfen = knopf("Verwerfen", { art: "still" });
    leiste.append(
      el(
        "span",
        { class: "lg-speicherzahl", role: "status" },
        "Ungespeicherte Änderungen",
      ),
      verwerfen,
      speichern,
    );
    const wurzel = el(
      "section",
      { class: "flaeche la-angaben", "aria-labelledby": "la-h-angaben" },
      el("h2", { id: "la-h-angaben" }, "Angaben"),
      kopfZeile,
      titel.wurzel,
      el("div", { class: "lg-zweispaltig" }, status.wurzel, person.wurzel),
      el(
        "div",
        { class: "la-unterfeld" },
        el("p", { class: "fett klein" }, "Unterstützung"),
        unterOrt,
        unterNeu.wurzel,
      ),
      el("div", { class: "lg-zweispaltig" }, ressort.wurzel, teil.wurzel),
      el(
        "div",
        { class: "la-frist-feld" },
        fristArt.wurzel,
        fristDatumOrt,
        fristRelOrt,
        fristHinweis,
      ),
      el(
        "div",
        { class: "lg-zweispaltig" },
        wiederholung.wurzel,
        spaeter.wurzel,
      ),
      el("div", { class: "la-haken" }, stern.wurzel, laufend.wurzel),
      notiz.wurzel,
      leiste,
    );
    function markiere() {
      leiste.hidden = false;
    }
    wurzel.addEventListener("input", markiere);
    wurzel.addEventListener("change", markiere);
    // Menü, Link, Zurück und Tab schliessen fragen nur, wenn sich wirklich etwas gegenüber dem Server ändert (#699)
    schuetze({
      wurzel,
      geaendert: () => !leiste.hidden && Object.keys(aenderungen()).length > 0,
      text: "Aufgabe",
    });
    verwerfen.addEventListener("click", () => {
      konfliktOrt.replaceChildren();
      neueSektion("angaben");
    });

    // Was sich gegenüber dem Stand des Servers geändert hat
    function aenderungen() {
      const w = {};
      const t = titel.eingabe.value.trim();
      if (t !== a.titel) w.titel = t;
      if (status.eingabe.value !== a.status) w.status = status.eingabe.value;
      if ((person.eingabe.value || null) !== a.verantwortlichPersonId)
        w.verantwortlichPersonId = person.eingabe.value || null;
      const alt = a.unterstuetzung
        .map((p) => p.id)
        .sort()
        .join("|");
      if (alt !== [...unterstuetzung].sort().join("|"))
        w.unterstuetzungPersonIds = unterstuetzung;
      if ((ressort.eingabe.value || null) !== a.ressortId)
        w.ressortId = ressort.eingabe.value || null;
      if ((teil.eingabe.value.trim() || null) !== a.teil)
        w.teil = teil.eingabe.value.trim() || null;
      if ((notiz.eingabe.value.trim() || null) !== a.notiz)
        w.notiz = notiz.eingabe.value.trim() || null;
      if ((wiederholung.eingabe.value || null) !== a.wiederholung)
        w.wiederholung = wiederholung.eingabe.value || null;
      if ((spaeter.eingabe.value || null) !== a.spaeterAb)
        w.spaeterAb = spaeter.eingabe.value || null;
      if (stern.eingabe.checked !== a.stern) w.stern = stern.eingabe.checked;
      if (laufend.eingabe.checked !== a.laufend)
        w.laufend = laufend.eingabe.checked;
      const art = fristArt.eingabe.value;
      if (art === "kein") {
        if (a.frist || relativ) {
          w.frist = null;
          if (relativ) w.fristVersatzTage = null;
        }
      } else if (art === "datum") {
        const datum = fristDatum.eingabe.value || null;
        if (datum !== a.frist || relativ) {
          w.frist = datum;
          if (relativ) w.fristVersatzTage = null;
        }
      } else {
        const n =
          (richtung.eingabe.value === "vor" ? -1 : 1) *
          Number(versatz.eingabe.value || 0);
        const m = bezug.eingabe.value || null;
        if (
          !relativ ||
          n !== a.fristVersatzTage ||
          m !== a.fristMeilensteinId
        ) {
          w.fristMeilensteinId = m;
          w.fristVersatzTage = n;
        }
      }
      return w;
    }

    async function sende(werte, version) {
      speichern.disabled = verwerfen.disabled = true;
      speichern.setAttribute("aria-busy", "true");
      try {
        D.a = await anfrage("PATCH", `${API(lagerId)}/aufgaben/${D.a.id}`, {
          version,
          ...werte,
        });
        konfliktOrt.replaceChildren();
        ctx.titel(D.a.titel, "Aufgabe");
        ctx.melde("Die Aufgabe ist gespeichert.");
        neueSektion("angaben");
      } catch (f) {
        if (istKonflikt(f)) {
          const karte = konfliktKarte({
            fehler: f,
            meine: werte,
            ids: ids(),
            uebernehmen: (aktuell) => sende(werte, aktuell.version),
            verwerfen: async () => {
              konfliktOrt.replaceChildren();
              await neueAufgabe();
              neueSektion("angaben");
            },
          });
          konfliktOrt.replaceChildren(karte);
          karte.focus();
        } else if (!(await bei409Geschlossen(f))) {
          melde(f);
        }
      } finally {
        speichern.disabled = verwerfen.disabled = false;
        speichern.removeAttribute("aria-busy");
      }
    }
    speichern.addEventListener("click", () => {
      if (titel.eingabe.value.trim() === "") {
        feldFehler(titel, "Gib der Aufgabe einen Titel.");
        return;
      }
      const w = aenderungen();
      if (Object.keys(w).length === 0) {
        leiste.hidden = true;
        return;
      }
      sende(w, D.a.version);
    });
    return wurzel;
  }

  // Wer die Aufgabe nur liest: die Angaben als Text; der Status lässt sich mit eigenem Recht trotzdem setzen
  function lesenAnsicht(kopfZeile) {
    const a = D.a;
    const zeile = (name, inhalt) => [el("dt", {}, name), el("dd", {}, inhalt)];
    const statusFeld = rechte.status
      ? (() => {
          const f = auswahl({
            label: "Status ändern",
            optionen: STATUS_WAHL,
            wert: STATUS_WAHL.some(([w]) => w === a.status)
              ? a.status
              : "offen",
          });
          f.eingabe.addEventListener("change", async () => {
            try {
              D.a = await anfrage(
                "PUT",
                `${API(lagerId)}/aufgaben/${a.id}/status`,
                { version: a.version, status: f.eingabe.value },
              );
              ctx.melde("Der Status ist gespeichert.");
              neueSektion("angaben");
            } catch (e) {
              if (istKonflikt(e)) {
                await neueAufgabe();
                ctx.melde(
                  "Jemand hat die Aufgabe inzwischen geändert. Du siehst jetzt den Stand des Servers.",
                  "warn",
                );
                neueSektion("angaben");
              } else melde(e);
            }
          });
          return f.wurzel;
        })()
      : null;
    return el(
      "section",
      { class: "flaeche la-angaben", "aria-labelledby": "la-h-angaben" },
      el("h2", { id: "la-h-angaben" }, "Angaben"),
      kopfZeile,
      el(
        "dl",
        { class: "werte" },
        zeile("Titel", a.titel),
        zeile(
          "Verantwortlich",
          personZeile(a.verantwortlich, {
            automatisch: a.verantwortlich?.automatisch,
          }),
        ),
        zeile(
          "Unterstützung",
          a.unterstuetzung.length
            ? a.unterstuetzung.map(personName).join(", ")
            : "Niemand",
        ),
        zeile(
          "Ressort",
          a.ressort ? `${a.ressort.kuerzel} ${a.ressort.name}` : "Kein Ressort",
        ),
        a.teil && zeile("Teilbereich", a.teil),
        zeile(
          "Frist",
          a.frist
            ? [
                datumMitTag(a.frist),
                typeof a.fristVersatzTage === "number"
                  ? ` (${relativeFristText(a.fristVersatzTage, D.meilensteine.find((m) => m.id === a.fristMeilensteinId)?.titel)})`
                  : "",
              ].join("")
            : "Keine Frist",
        ),
        a.notiz && zeile("Notiz", el("span", { class: "la-notiz" }, a.notiz)),
      ),
      statusFeld,
    );
  }

  // ---- Checkliste ----
  function checkliste() {
    const liste = D.details.checkliste;
    const erledigt = liste.filter((c) => c.erledigt).length;
    // Die Zahl zählt und der Balken wächst vom Stand der vorigen Zeichnung zum neuen
    const vorher = D.check;
    D.check = { erledigt, gesamt: liste.length };
    const anteil = (c) => (c && c.gesamt ? (100 * c.erledigt) / c.gesamt : 0);
    const kopf = el(
      "h2",
      { id: "la-h-check" },
      "Checkliste ",
      liste.length > 0 &&
        el(
          "span",
          { class: "n" },
          zaehlZahl(erledigt, String, vorher?.erledigt),
          " von ",
          liste.length,
        ),
    );
    const balken = el("span");
    const fortschritt =
      liste.length > 0 &&
      el(
        "div",
        { class: "fortschritt la-fortschritt", "aria-hidden": "true" },
        balken,
      );
    if (fortschritt)
      balkenBis(balken, anteil(D.check), vorher ? anteil(vorher) : 0);
    const ort = el("div", { class: "la-check" });
    async function abhaken(c, wert) {
      try {
        const neu = await anfrage(
          "PATCH",
          `${API(lagerId)}/aufgaben/${D.a.id}/checkliste/${c.id}`,
          { version: c.version, erledigt: wert },
        );
        Object.assign(c, neu, {
          erledigtVon: wert
            ? { id: ctx.ich?.id, name: ctx.ich?.name, ceviName: null }
            : null,
        });
        neueSektion("checkliste");
        const z = knoten.checkliste.querySelector(
          `[data-id="${CSS.escape(c.id)}"]`,
        );
        puls(z?.querySelector(".wahl"));
        if (z) blitze(z);
      } catch (f) {
        if (istKonflikt(f)) {
          await neueDetails();
          ctx.melde(
            "Jemand hat diesen Punkt inzwischen geändert. Du siehst jetzt den Stand des Servers.",
            "warn",
          );
          neueSektion("checkliste");
        } else melde(f);
      }
    }
    function punkt(c) {
      const k = ankreuzen({ label: c.text, gewaehlt: c.erledigt, wert: c.id });
      k.eingabe.disabled = !rechte.status;
      k.eingabe.addEventListener("change", () => abhaken(c, k.eingabe.checked));
      const loeschen = rechte.bearbeiten
        ? el(
            "button",
            {
              type: "button",
              class: "knopf knopf--rund",
              "aria-label": `Punkt löschen: ${c.text}`,
              onclick: (e) => loeschePunkt(c, e.currentTarget.closest("li")),
            },
            symbol("papierkorb"),
          )
        : null;
      const bearbeiten = rechte.bearbeiten
        ? el(
            "button",
            {
              type: "button",
              class: "knopf knopf--rund",
              "aria-label": `Punkt bearbeiten: ${c.text}`,
              onclick: () => bearbeitePunkt(c),
            },
            symbol("bearbeiten"),
          )
        : null;
      return el(
        "div",
        { class: "la-punkt" },
        k.wurzel,
        c.erledigt &&
          c.erledigtVon &&
          el(
            "span",
            { class: "leise klein" },
            `Abgehakt von ${personName(c.erledigtVon)}`,
          ),
        el("span", { class: "la-punkt-knoepfe" }, bearbeiten, loeschen),
      );
    }
    function loeschePunkt(c, zeileEl) {
      ctx.mitRueckgaengig({
        text: `Punkt «${c.text}» gelöscht`,
        erledigt: "Gelöscht.",
        ansicht: {
          weg: () => klappe(zeileEl, false),
          zurueck: () => klappe(zeileEl, true),
        },
        ausfuehren: () =>
          anfrage(
            "DELETE",
            `${API(lagerId)}/aufgaben/${D.a.id}/checkliste/${c.id}?version=${c.version}`,
          ),
        danach: () => {
          D.details.checkliste = D.details.checkliste.filter(
            (x) => x.id !== c.id,
          );
          neueSektion("checkliste");
        },
        fehlertext: (f) =>
          istKonflikt(f)
            ? "Jemand hat den Punkt inzwischen geändert und er blieb stehen."
            : `Nicht gelöscht. ${fehlerText(f)}`,
        beiFehler: async () => {
          await neueDetails();
          neueSektion("checkliste");
        },
      });
    }
    function bearbeitePunkt(c) {
      const f = feld({
        label: `Punkt bearbeiten`,
        wert: c.text,
        maxlength: 500,
        autocomplete: "off",
      });
      const ok = knopf("Speichern", {
        art: "haupt",
        klein: true,
        type: "submit",
      });
      const ab = knopf("Abbrechen", { klein: true, art: "still" });
      const zeile = el(
        "form",
        { class: "la-punktform", novalidate: true },
        f.wurzel,
        ok,
        ab,
      );
      ort.replaceChildren(zeile);
      f.eingabe.focus();
      ab.addEventListener("click", () => neueSektion("checkliste"));
      zeile.addEventListener("submit", async (e) => {
        e.preventDefault();
        const t = f.eingabe.value.trim();
        if (!t) return feldFehler(f, "Der Punkt braucht einen Text.");
        try {
          const neu = await anfrage(
            "PATCH",
            `${API(lagerId)}/aufgaben/${D.a.id}/checkliste/${c.id}`,
            { version: c.version, text: t },
          );
          Object.assign(c, neu);
          neueSektion("checkliste");
        } catch (fe) {
          if (istKonflikt(fe)) {
            await neueDetails();
            ctx.melde(
              "Jemand hat diesen Punkt inzwischen geändert. Du siehst jetzt den Stand des Servers.",
              "warn",
            );
            neueSektion("checkliste");
          } else melde(fe);
        }
      });
    }
    if (liste.length === 0) {
      ort.append(
        el(
          "p",
          { class: "leise" },
          rechte.bearbeiten
            ? "Noch keine Punkte. Füge unten den ersten hinzu."
            : "Keine Punkte.",
        ),
      );
    } else if (rechte.bearbeiten && liste.length > 1) {
      ort.append(
        sortierListe({
          beschriftung: "Punkte der Checkliste",
          eintraege: liste.map((c) => ({
            id: c.id,
            text: c.text,
            inhalt: punkt(c),
          })),
          mitRueckgaengig: ctx.mitRueckgaengig,
          aktionstext: "Reihenfolge der Checkliste geändert",
          beiNeu: async (neu) => {
            try {
              await anfrage(
                "PUT",
                `${API(lagerId)}/aufgaben/${D.a.id}/checkliste/reihenfolge`,
                {
                  eintraege: eintraegeNach(liste, neu),
                },
              );
              await neueDetails();
              neueSektion("checkliste");
            } catch (f) {
              await neueDetails().catch(() => {});
              neueSektion("checkliste");
              throw new Error(
                istKonflikt(f)
                  ? "Jemand hat die Checkliste inzwischen geändert. Du siehst jetzt den Stand des Servers."
                  : fehlerText(f),
                { cause: f },
              );
            }
          },
        }).wurzel,
      );
    } else {
      ort.append(
        el(
          "ul",
          { class: "la-liste" },
          liste.map((c) => el("li", { "data-id": c.id }, punkt(c))),
        ),
      );
    }
    const neu = rechte.bearbeiten ? neuerPunkt() : null;
    return el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-check" },
      kopf,
      fortschritt,
      ort,
      neu,
    );
  }
  function neuerPunkt() {
    const f = feld({
      label: "Neuer Punkt",
      maxlength: 500,
      autocomplete: "off",
    });
    const ok = knopf("Hinzufügen", {
      symbol: "plus",
      art: "haupt",
      klein: true,
      type: "submit",
    });
    const form = el(
      "form",
      { class: "la-punktform", novalidate: true },
      f.wurzel,
      ok,
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const t = f.eingabe.value.trim();
      if (!t) return feldFehler(f, "Schreibe den Punkt auf.");
      ok.disabled = true;
      try {
        const neu = await anfrage(
          "POST",
          `${API(lagerId)}/aufgaben/${D.a.id}/checkliste`,
          { text: t },
        );
        D.details.checkliste.push({ ...neu, erledigtVon: null });
        neueSektion("checkliste");
        document.querySelector("#la-neuer-punkt input")?.focus();
      } catch (fe) {
        melde(fe);
        ok.disabled = false;
      }
    });
    form.id = "la-neuer-punkt";
    return form;
  }

  // ---- Links ----
  function links() {
    const liste = D.details.links;
    const ort = el("div", {});
    ort.append(
      liste.length === 0
        ? el("p", { class: "leise" }, "Keine Links.")
        : el(
            "ul",
            { class: "la-liste" },
            liste.map((l) =>
              el(
                "li",
                { class: "la-link", "data-id": l.id },
                el(
                  "a",
                  {
                    href: l.url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    class: "lg-verweis",
                  },
                  l.titel,
                  el(
                    "span",
                    { class: "nur-leser" },
                    " (öffnet in einem neuen Tab)",
                  ),
                ),
                rechte.bearbeiten &&
                  el(
                    "button",
                    {
                      type: "button",
                      class: "knopf knopf--rund",
                      "aria-label": `Link löschen: ${l.titel}`,
                      onclick: (e) =>
                        loescheLink(l, e.currentTarget.closest("li")),
                    },
                    symbol("papierkorb"),
                  ),
              ),
            ),
          ),
    );
    function loescheLink(l, zeileEl) {
      ctx.mitRueckgaengig({
        text: `Link «${l.titel}» gelöscht`,
        erledigt: "Gelöscht.",
        ansicht: {
          weg: () => klappe(zeileEl, false),
          zurueck: () => klappe(zeileEl, true),
        },
        ausfuehren: () =>
          anfrage(
            "DELETE",
            `${API(lagerId)}/aufgaben/${D.a.id}/links/${l.id}?version=${l.version}`,
          ),
        danach: () => {
          D.details.links = D.details.links.filter((x) => x.id !== l.id);
          neueSektion("links");
        },
        fehlertext: (f) => `Nicht gelöscht. ${fehlerText(f)}`,
        beiFehler: async () => {
          await neueDetails();
          neueSektion("links");
        },
      });
    }
    let form = null;
    if (rechte.bearbeiten) {
      const t = feld({ label: "Titel", maxlength: 200, autocomplete: "off" });
      const u = feld({
        label: "Adresse",
        typ: "url",
        maxlength: 2000,
        autocomplete: "off",
        hilfe: "Nur sichere Adressen (https).",
      });
      const ok = knopf("Hinzufügen", {
        symbol: "plus",
        art: "haupt",
        klein: true,
        type: "submit",
      });
      form = el(
        "form",
        { class: "la-linkform", novalidate: true },
        t.wurzel,
        u.wurzel,
        ok,
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!t.eingabe.value.trim())
          return feldFehler(t, "Gib dem Link einen Titel.");
        if (!/^https:\/\/\S+$/i.test(u.eingabe.value.trim()))
          return feldFehler(u, "Die Adresse muss mit «https» beginnen.");
        ok.disabled = true;
        try {
          const neu = await anfrage(
            "POST",
            `${API(lagerId)}/aufgaben/${D.a.id}/links`,
            { titel: t.eingabe.value.trim(), url: u.eingabe.value.trim() },
          );
          D.details.links.push(neu);
          neueSektion("links");
        } catch (fe) {
          melde(fe);
          ok.disabled = false;
        }
      });
    }
    return el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-links" },
      el("h2", { id: "la-h-links" }, "Links"),
      ort,
      form,
    );
  }

  // ---- Stichworte ----
  function stichworte() {
    const liste = D.details.stichworte;
    async function setze(neu) {
      try {
        await anfrage("PUT", `${API(lagerId)}/aufgaben/${D.a.id}/stichworte`, {
          version: D.a.version,
          stichworte: neu,
        });
        await neueAufgabe();
        D.details.stichworte = neu;
        neueSektion("stichworte");
      } catch (f) {
        if (istKonflikt(f)) {
          await neueAufgabe();
          ctx.melde(
            "Jemand hat die Aufgabe inzwischen geändert. Versuche es nochmals mit dem neuen Stand.",
            "warn",
          );
          neueSektion("angaben");
        } else melde(f);
      }
    }
    const chips = el(
      "ul",
      { class: "la-chipliste", "aria-label": "Stichworte" },
      liste.length === 0
        ? el("li", { class: "leise" }, "Keine Stichworte.")
        : liste.map((w) =>
            el(
              "li",
              { class: "chip", "data-id": `s-${w}` },
              w,
              rechte.bearbeiten &&
                el(
                  "button",
                  {
                    type: "button",
                    class: "la-chip-weg",
                    "aria-label": `Stichwort entfernen: ${w}`,
                    onclick: () => setze(liste.filter((x) => x !== w)),
                  },
                  symbol("schliessen"),
                ),
            ),
          ),
    );
    let form = null;
    if (rechte.bearbeiten) {
      const f = feld({
        label: "Neues Stichwort",
        maxlength: 40,
        autocomplete: "off",
      });
      const ok = knopf("Hinzufügen", {
        symbol: "plus",
        art: "haupt",
        klein: true,
        type: "submit",
      });
      form = el(
        "form",
        { class: "la-punktform", novalidate: true },
        f.wurzel,
        ok,
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const w = f.eingabe.value.trim();
        if (!w) return feldFehler(f, "Schreibe ein Stichwort.");
        if (liste.some((x) => x.toLowerCase() === w.toLowerCase()))
          return feldFehler(f, "Dieses Stichwort gibt es schon.");
        setze([...liste, w]);
      });
    }
    return el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-stich" },
      el("h2", { id: "la-h-stich" }, "Stichworte"),
      chips,
      form,
    );
  }

  // ---- Ähnliche Aufgaben ----
  function aehnliche() {
    const ort = el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-aehnlich", hidden: true },
      el("h2", { id: "la-h-aehnlich" }, "Ähnliche Aufgaben"),
    );
    anfrage(
      "GET",
      `${API(lagerId)}/aufgaben/duplikate?titel=${encodeURIComponent(D.a.titel)}${D.a.ressortId ? `&ressortId=${D.a.ressortId}` : ""}`,
    )
      .then((r) => {
        const andere = r.gruppen
          .flatMap((g) => g.aufgaben)
          .filter((x) => x.id !== D.a.id);
        if (andere.length === 0 || istErledigt(D.a)) return;
        ort.hidden = false;
        blendeEin(ort);
        ort.append(
          el(
            "p",
            { class: "leise" },
            "Diese Aufgaben haben denselben Titel im selben Ressort. Beim Zusammenführen kommen Checkliste, Links, Stichworte und Notiz in diese Aufgabe, und die andere wird gelöscht.",
          ),
          el(
            "ul",
            { class: "la-liste" },
            andere.map((x) => {
              const k = knopf("Zusammenführen", {
                klein: true,
                kontext: x.titel,
              });
              zweiStufig(k, {
                frage: "Wirklich zusammenführen?",
                ausfuehren: async () => {
                  try {
                    D.a = await anfrage(
                      "POST",
                      `${API(lagerId)}/aufgaben/${D.a.id}/zusammenfuehren`,
                      {
                        version: D.a.version,
                        mitId: x.id,
                        mitVersion: x.version,
                      },
                    );
                    await neueDetails();
                    ctx.melde("Die Aufgaben sind zusammengeführt.");
                    neueSektion("angaben");
                    neueSektion("checkliste");
                    neueSektion("links");
                    neueSektion("stichworte");
                    ort.hidden = true;
                  } catch (f) {
                    if (istKonflikt(f))
                      ctx.melde(
                        "Jemand hat eine der Aufgaben inzwischen geändert. Lade die Seite neu und versuche es nochmals.",
                        "warn",
                      );
                    else melde(f);
                  }
                },
              });
              return el(
                "li",
                { class: "la-link" },
                el(
                  "a",
                  {
                    class: "lg-verweis",
                    href: adresse(lagerId, "aufgaben", x.id),
                  },
                  x.titel,
                ),
                statusChip(x.status),
                k,
              );
            }),
          ),
        );
      })
      .catch(() => {});
    return ort;
  }

  // ---- Verlauf ----
  function verlauf() {
    if (!rechte.verlauf || !D.verlauf) return null;
    const v = D.verlauf;
    const ART = {
      neu: "angelegt",
      geaendert: "geändert",
      geloescht: "gelöscht",
    };
    const TYP = {
      aufgabe: "Aufgabe",
      aufgabe_checkpunkt: "Punkt der Checkliste",
      aufgabe_link: "Link",
    };
    const zeit = (iso) =>
      new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso));
    const liste = el(
      "ul",
      { class: "la-liste la-verlauf" },
      v.eintraege.map((e) =>
        el(
          "li",
          {},
          `${TYP[e.objekttyp] ?? e.objekttyp} ${ART[e.art] ?? e.art}`,
          el("span", { class: "leise klein" }, ` · ${zeit(e.zeitpunkt)}`),
        ),
      ),
    );
    const mehr = v.naechster
      ? knopf("Ältere Einträge laden", {
          klein: true,
          onclick: async () => {
            const r = await anfrage(
              "GET",
              `${API(lagerId)}/aufgaben/${D.a.id}/verlauf?limit=50&vor=${v.naechster}`,
            ).catch((f) => (melde(f), null));
            if (!r) return;
            for (const e of r.eintraege)
              liste.append(
                el(
                  "li",
                  {},
                  `${TYP[e.objekttyp] ?? e.objekttyp} ${ART[e.art] ?? e.art}`,
                  el(
                    "span",
                    { class: "leise klein" },
                    ` · ${zeit(e.zeitpunkt)}`,
                  ),
                ),
              );
            v.naechster = r.naechster;
            if (!r.naechster) mehr.remove();
          },
        })
      : null;
    return el(
      "section",
      { class: "flaeche", "aria-labelledby": "la-h-verlauf" },
      el("h2", { id: "la-h-verlauf" }, "Verlauf"),
      v.erstelltVon &&
        el(
          "p",
          { class: "leise klein" },
          `Angelegt von ${personName(v.erstelltVon)} am ${zeit(v.erstelltAm)}.`,
        ),
      v.geaendertVon &&
        el(
          "p",
          { class: "leise klein" },
          `Zuletzt geändert von ${personName(v.geaendertVon)} am ${zeit(v.geaendertAm)}.`,
        ),
      v.eintraege.length === 0
        ? el(
            "p",
            { class: "leise" },
            "Der Verlauf hält 30 Tage. Es gibt keine neueren Änderungen.",
          )
        : liste,
      mehr,
    );
  }

  async function neueDetails() {
    D.details = await anfrage(
      "GET",
      `${API(lagerId)}/aufgaben/${D.a.id}/details`,
    );
  }

  // Jede Sektion lässt sich einzeln neu zeichnen, ohne die Seite neu zu laden
  const bauer = { angaben, checkliste, links, stichworte };
  const knoten = {};
  function neueSektion(name) {
    const neu = bauer[name]();
    const alt = knoten[name];
    // Einträge gleiten an ihren neuen Platz, neue blenden ein; gespeicherte Angaben heben sich kurz ab
    if (alt?.isConnected) bewegeUm(bereiche, () => alt.replaceWith(neu));
    knoten[name] = neu;
    if (name === "angaben" && alt?.isConnected) blitze(neu);
  }
  for (const name of ["angaben", "checkliste", "links", "stichworte"])
    knoten[name] = bauer[name]();

  const kopf = el(
    "div",
    { class: "la-kopf" },
    zurueckLink("Zu den Aufgaben", zurAufgabenListe(lagerId)),
  );
  bereiche.append(
    konfliktOrt,
    knoten.angaben,
    knoten.checkliste,
    knoten.links,
    knoten.stichworte,
    ...[rechte.bearbeiten ? aehnliche() : null, verlauf()].filter(Boolean),
  );
  bereich.append(
    ...[rechte.zu && geschlossenHinweis(), kopf, bereiche].filter(Boolean),
  );
  staffle(bereiche.children);
}
