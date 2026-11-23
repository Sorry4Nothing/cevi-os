import { ApiFehler, anfrage } from "./api.js";
import { datumsfeld } from "./datumsfeld.js";
import {
  ankreuzen,
  auswahl,
  dialogFormular,
  el,
  feld,
  knopf,
  seitenblatt,
} from "./dom.js";
import { leerKarte } from "./zustaende.js";
import { feldFehler } from "./lager-gemeinsam.js";
import {
  API,
  fehlerText,
  personenOptionen,
  ressortOptionen,
} from "./lager-aufgaben-gemeinsam.js";
import {
  HINWEISE,
  addiereTage,
  datumMitTag,
  heute,
  vorschlagBereit,
  vorschlagZuAufgabe,
} from "./lager-aufgaben-logik.js";

// Formulare des Moduls «Aufgaben» (#670): neue Aufgabe, Schnelleingabe, Vorlage anwenden, «Später erinnern». Alle öffnen als Seite im Fluss (Zurück und Browser-Zurück schliessen sie); nichts ist ein Popup.

const meldungVon = (f) => (f instanceof ApiFehler ? fehlerText(f) : f.message);

export function neueAufgabe({ ctx, lagerId, S, beiNeu }) {
  const titel = feld({
    label: "Titel",
    required: true,
    maxlength: 200,
    autocomplete: "off",
  });
  const person = auswahl({
    label: "Verantwortlich",
    optionen: personenOptionen(S.personen, "Niemand"),
    wert: "",
  });
  const ressort = auswahl({
    label: "Ressort",
    optionen: ressortOptionen(S.ressorts),
    wert: "",
  });
  const frist = datumsfeld({ label: "Frist", hilfe: "Freiwillig." });
  const teil = feld({
    label: "Teilbereich",
    hilfe: "Freiwillig, zum Beispiel «Zelte».",
    maxlength: 100,
    autocomplete: "off",
  });
  const notiz = feld({
    label: "Notiz",
    mehrzeilig: true,
    rows: 4,
    maxlength: 5000,
  });
  // Hat die Person die Warnung vor einer ähnlichen Aufgabe gesehen, gilt der zweite Klick
  let gewarnt = null;
  dialogFormular({
    titel: "Neue Aufgabe",
    beschreibung: "Die Aufgabe erscheint für alle, die sie sehen dürfen.",
    felder: [
      titel.wurzel,
      el("div", { class: "lg-zweispaltig" }, person.wurzel, ressort.wurzel),
      el("div", { class: "lg-zweispaltig" }, frist.wurzel, teil.wurzel),
      notiz.wurzel,
    ],
    ok: "Anlegen",
    pruefe: () => {
      if (titel.eingabe.value.trim().length <= 200) return false;
      feldFehler(titel, "Der Titel ist zu lang (höchstens 200 Zeichen).");
      return true;
    },
    senden: async () => {
      const t = titel.eingabe.value.trim();
      const r = ressort.eingabe.value;
      const schluessel = `${t.toLowerCase()}|${r}`;
      if (gewarnt !== schluessel) {
        const d = await anfrage(
          "GET",
          `${API(lagerId)}/aufgaben/duplikate?titel=${encodeURIComponent(t)}${r ? `&ressortId=${r}` : ""}`,
        );
        if (d.gruppen.length > 0) {
          gewarnt = schluessel;
          throw new Error(
            `Es gibt schon eine ähnliche Aufgabe: «${d.gruppen[0].aufgaben[0].titel}». Wähle «Anlegen» nochmals, wenn du trotzdem eine neue willst.`,
          );
        }
      }
      return anfrage("POST", `${API(lagerId)}/aufgaben`, {
        titel: t,
        ...(person.eingabe.value
          ? { verantwortlichPersonId: person.eingabe.value }
          : {}),
        ...(r ? { ressortId: r } : {}),
        ...(frist.eingabe.value ? { frist: frist.eingabe.value } : {}),
        ...(teil.eingabe.value.trim()
          ? { teil: teil.eingabe.value.trim() }
          : {}),
        ...(notiz.eingabe.value.trim()
          ? { notiz: notiz.eingabe.value.trim() }
          : {}),
      });
    },
    fehlertext: meldungVon,
    danach: (a) => {
      beiNeu(a);
      ctx.melde(`«${a.titel}» ist angelegt.`);
    },
  });
}

// Schnelleingabe: ein Text mit einer Aufgabe pro Zeile; der Server liefert einen Vorschlag (er schreibt nichts), die Person prüft und legt erst dann an
export function schnellErfassen({ ctx, lagerId, S, beiNeu }) {
  const text = feld({
    label: "Aufgaben",
    mehrzeilig: true,
    rows: 6,
    maxlength: 500,
    hilfe:
      "Eine Aufgabe pro Zeile, höchstens 20. Mit @Person, einem Datum wie «bis 15.3.» oder «morgen» und #Ressort.",
  });
  const pruefen = knopf("Prüfen", { art: "haupt", symbol: "lupe" });
  const ergebnis = el("div", { class: "la-schnell-ergebnis", role: "status" });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
  });
  const anlegen = knopf("Anlegen", { art: "haupt", disabled: true });
  let zeilen = [];

  const bereit = (z) => z.dabei.eingabe.checked && vorschlagBereit(z.v, z.wahl);
  const zaehle = () => {
    const n = zeilen.filter(bereit).length;
    anlegen.disabled = n === 0;
    anlegen.textContent =
      n === 1 ? "1 Aufgabe anlegen" : `${n} Aufgaben anlegen`;
  };
  // Eine Wahl bei einem unklaren Treffer: «Bitte wählen», «Niemand» oder die Kandidaten
  function wahlFeld(label, treffer, alle, schluessel, z) {
    const kandidaten =
      treffer.kandidaten.length > 0 ? treffer.kandidaten : alle;
    const f = auswahl({
      label,
      optionen: [
        ["?", "Bitte wählen"],
        ["", "Keine Angabe"],
        ...kandidaten.map((k) => [
          k.id,
          k.kuerzel
            ? `${k.kuerzel} ${k.name}`
            : k.ceviName
              ? `${k.name} (${k.ceviName})`
              : k.name,
        ]),
      ],
      wert: "?",
    });
    f.eingabe.addEventListener("change", () => {
      z.wahl[schluessel] =
        f.eingabe.value === "?" ? undefined : f.eingabe.value;
      zaehle();
    });
    return f.wurzel;
  }
  function zeile(v, i) {
    const dabei = ankreuzen({
      label: `Anlegen: ${v.titel || `Zeile ${i + 1}`}`,
      gewaehlt: v.hinweise.length === 0,
    });
    const z = { v, dabei, wahl: {} };
    dabei.wurzel.querySelector("label").classList.add("nur-leser");
    dabei.eingabe.addEventListener("change", zaehle);
    const personText =
      v.person?.status === "gefunden"
        ? `Verantwortlich: ${v.person.kandidaten[0].name}`
        : null;
    const ressortText =
      v.ressort?.status === "gefunden"
        ? `Ressort: ${v.ressort.kandidaten[0].kuerzel} ${v.ressort.kandidaten[0].name}`
        : null;
    z.knoten = el(
      "li",
      { class: "la-schnell-zeile" },
      dabei.wurzel,
      el(
        "div",
        { class: "la-schnell-inhalt" },
        el("p", { class: "fett" }, v.titel || "(ohne Titel)"),
        el(
          "p",
          { class: "leise klein" },
          [
            personText,
            ressortText,
            v.frist ? `Frist: ${datumMitTag(v.frist.datum)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Keine weiteren Angaben erkannt.",
        ),
        v.hinweise.map((h) =>
          el("p", { class: "feld-fehler" }, HINWEISE[h] ?? h),
        ),
        v.person &&
          v.person.status !== "gefunden" &&
          el(
            "div",
            { class: "la-schnell-wahl" },
            el(
              "p",
              { class: "klein" },
              v.person.status === "mehrdeutig"
                ? `Zu @${v.person.text} passen mehrere Personen.`
                : `@${v.person.text} habe ich nicht gefunden.`,
            ),
            wahlFeld(
              `Person für @${v.person.text}`,
              v.person,
              S.personen.map((p) => ({ id: p.id, name: p.name })),
              "person",
              z,
            ),
          ),
        v.ressort &&
          v.ressort.status !== "gefunden" &&
          el(
            "div",
            { class: "la-schnell-wahl" },
            el(
              "p",
              { class: "klein" },
              v.ressort.status === "mehrdeutig"
                ? `Zu #${v.ressort.text} passen mehrere Ressorts.`
                : `#${v.ressort.text} habe ich nicht gefunden.`,
            ),
            wahlFeld(
              `Ressort für #${v.ressort.text}`,
              v.ressort,
              S.ressorts,
              "ressort",
              z,
            ),
          ),
      ),
    );
    return z;
  }

  pruefen.addEventListener("click", async () => {
    fehler.hidden = true;
    if (text.eingabe.value.trim() === "") {
      feldFehler(text, "Schreibe mindestens eine Aufgabe.");
      return;
    }
    pruefen.disabled = true;
    pruefen.setAttribute("aria-busy", "true");
    try {
      const r = await anfrage("POST", `${API(lagerId)}/aufgaben/schnell`, {
        text: text.eingabe.value,
      });
      zeilen = r.vorschlaege.map(zeile);
      ergebnis.replaceChildren(
        el(
          "h3",
          { class: "klein fett" },
          zeilen.length === 1
            ? "1 Aufgabe erkannt"
            : `${zeilen.length} Aufgaben erkannt`,
        ),
        el(
          "ul",
          { class: "la-schnell-liste" },
          zeilen.map((z) => z.knoten),
        ),
      );
      zaehle();
    } catch (f) {
      fehler.textContent = meldungVon(f);
      fehler.hidden = false;
    } finally {
      pruefen.disabled = false;
      pruefen.removeAttribute("aria-busy");
    }
  });

  const blatt = seitenblatt({
    titel: "Schnell erfassen",
    untertitel:
      "Schreibe die Aufgaben auf, prüfe den Vorschlag und lege sie an.",
    inhalt: [
      text.wurzel,
      el("div", { class: "reihe la-pruefzeile" }, pruefen),
      fehler,
      ergebnis,
    ],
    fusszeile: [
      knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
      anlegen,
    ],
  });
  anlegen.addEventListener("click", async () => {
    const gewaehlt = zeilen.filter(bereit);
    anlegen.disabled = true;
    let ok = 0;
    const nicht = [];
    for (const z of gewaehlt) {
      try {
        await anfrage(
          "POST",
          `${API(lagerId)}/aufgaben`,
          vorschlagZuAufgabe(z.v, z.wahl),
        );
        ok++;
      } catch (f) {
        nicht.push(`«${z.v.titel}»: ${meldungVon(f)}`);
      }
    }
    if (nicht.length === 0) blatt.close();
    else zaehle();
    beiNeu();
    ctx.melde(
      nicht.length === 0
        ? ok === 1
          ? "1 Aufgabe ist angelegt."
          : `${ok} Aufgaben sind angelegt.`
        : `${ok} angelegt. Nicht angelegt: ${nicht.join(" ")}`,
      nicht.length === 0 ? "ok" : "warn",
    );
  });
}

// Vorlage anwenden: Auswahl der Vorlagen für Aufgaben, Vorschau (trocken, schreibt nichts), dann anwenden
export function vorlageAnwenden({ ctx, lagerId, beiNeu }) {
  const inhalt = el("div", { class: "la-vorlage" });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
  });
  const anwenden = knopf("Anwenden", { art: "haupt", disabled: true });
  const blatt = seitenblatt({
    titel: "Vorlage anwenden",
    untertitel:
      "Die Aufgaben der Vorlage kommen zu den bestehenden dazu. Nichts wird überschrieben.",
    inhalt: [inhalt, fehler],
    fusszeile: [
      knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
      anwenden,
    ],
  });
  let gewaehlt = null;

  async function vorschau(id) {
    fehler.hidden = true;
    anwenden.disabled = true;
    gewaehlt = null;
    const ort = inhalt.querySelector(".la-vorlage-vorschau");
    ort.replaceChildren(el("p", { class: "leise" }, "Vorschau wird geladen …"));
    try {
      const r = await anfrage(
        "POST",
        `${API(lagerId)}/vorlagen/${id}/anwenden?trocken=true`,
      );
      gewaehlt = id;
      anwenden.disabled = false;
      ort.replaceChildren(
        el(
          "h3",
          { class: "klein fett" },
          r.aufgaben.length === 1
            ? "1 Aufgabe würde angelegt"
            : `${r.aufgaben.length} Aufgaben würden angelegt`,
        ),
        el(
          "ul",
          { class: "la-vorlage-liste" },
          r.aufgaben.map((a) =>
            el(
              "li",
              {},
              a.titel,
              a.frist
                ? el(
                    "span",
                    { class: "leise klein" },
                    ` · Frist ${datumMitTag(a.frist)}`,
                  )
                : null,
            ),
          ),
        ),
      );
    } catch (f) {
      ort.replaceChildren();
      fehler.textContent = meldungVon(f);
      fehler.hidden = false;
    }
  }

  anfrage("GET", `${API(lagerId)}/vorlagen`)
    .then((r) => {
      const liste = r.vorlagen.filter((v) => v.art === "aufgaben");
      if (liste.length === 0) {
        inhalt.replaceChildren(
          leerKarte("Es gibt noch keine Vorlage für Aufgaben.", [
            el(
              "a",
              { class: "knopf", href: "#lager/vorlagen" },
              "Vorlagen verwalten",
            ),
          ]),
        );
        return;
      }
      const f = auswahl({
        label: "Vorlage",
        optionen: [
          ["", "Vorlage wählen"],
          ...liste.map((v) => [v.id, `${v.name} (${v.anzahl})`]),
        ],
        wert: "",
      });
      f.eingabe.addEventListener("change", () => {
        if (f.eingabe.value) vorschau(f.eingabe.value);
        else {
          gewaehlt = null;
          anwenden.disabled = true;
          inhalt.querySelector(".la-vorlage-vorschau").replaceChildren();
        }
      });
      inhalt.replaceChildren(
        f.wurzel,
        el("div", { class: "la-vorlage-vorschau", role: "status" }),
      );
    })
    .catch((f) => {
      inhalt.replaceChildren(leerKarte(meldungVon(f)));
    });

  anwenden.addEventListener("click", async () => {
    if (!gewaehlt) return;
    anwenden.disabled = true;
    try {
      const r = await anfrage(
        "POST",
        `${API(lagerId)}/vorlagen/${gewaehlt}/anwenden?trocken=false`,
      );
      blatt.close();
      beiNeu();
      ctx.melde(
        r.aufgaben.length === 1
          ? "1 Aufgabe ist angelegt."
          : `${r.aufgaben.length} Aufgaben sind angelegt.`,
      );
    } catch (f) {
      fehler.textContent = meldungVon(f);
      fehler.hidden = false;
      anwenden.disabled = false;
    }
  });
}

// «Später erinnern»: Die Aufgabe ruht bis zu diesem Datum im Abschnitt «Später»
export function spaeterErinnern({ a, senden }) {
  const datum = datumsfeld({
    label: "Erinnerung ab",
    required: true,
    min: addiereTage(heute(), 1),
    hilfe: "Bis dahin steht die Aufgabe ruhig unter «Später».",
  });
  dialogFormular({
    titel: "Später erinnern",
    beschreibung: `«${a.titel}»`,
    felder: [datum.wurzel],
    ok: "Speichern",
    pruefe: () => {
      if (datum.eingabe.value) return false;
      feldFehler(datum, "Wähle ein Datum.");
      return true;
    },
    senden: () => senden(datum.eingabe.value),
    fehlertext: meldungVon,
  });
}
