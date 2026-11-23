import { anfrage } from "./api.js";
import { zurueck } from "./verlauf.js";
import { ankreuzen, avatar, el, knopf, neueId } from "./dom.js";
import {
  ADRESSE,
  BASIS,
  feldFehler,
  grunddaten,
  knopfMit,
  meldung,
  merkeMeldung,
  symbol,
  zeitraum,
} from "./lager-gemeinsam.js";

// «Neues Lager» in vier Schritten (#527, Board A21): Grunddaten, Vorlagen, Lagerleitung, Prüfen. Gespeichert wird erst im letzten Schritt: POST /api/v1/admin/lager (mit der ersten Vorlage), danach die zweite Vorlage und die Lagerleitung. Die Vorlagen und Personen werden erst geladen, wenn ihr Schritt kommt.

const SCHRITTE = ["Grunddaten", "Vorlage", "Mitglieder", "Prüfen"];

export function zeige(bereich, ctx) {
  ctx.titel("Neues Lager", "In vier Schritten. Du kannst alles später ändern.");
  ctx.kopfAktion();
  // Zustand der Eingaben, solange man in den Schritten bleibt (nicht im DOM)
  const st = {
    schritt: 0,
    grund: {},
    aufgaben: "",
    packliste: "",
    leitung: new Set(),
    vorlagen: null,
    personen: null,
    speichert: false,
    fehler: "",
  };
  const schritte = el("ol", { class: "schritte", "aria-label": "Schritte" });
  const inhalt = el("section", { class: "flaeche lg-schmal" });
  bereich.append(schritte, inhalt);
  const lader = ctx.erstelleLader(inhalt);
  // Knoten, Listen von Knoten und Leeres in die Fläche setzen
  const setze = (...kinder) =>
    inhalt.replaceChildren(...kinder.flat().filter(Boolean));

  const zurListe = () => zurueck(ADRESSE);
  const gehe = (n) => {
    st.schritt = n;
    st.fehler = "";
    zeichne(true);
  };

  function zeichneSchritte() {
    schritte.replaceChildren(
      ...SCHRITTE.map((name, i) =>
        el(
          "li",
          {
            class: i < st.schritt ? "fertig" : i === st.schritt ? "jetzt" : "",
            "aria-current": i === st.schritt ? "step" : undefined,
          },
          el(
            "span",
            { class: "nr" },
            i < st.schritt ? symbol("haken") : String(i + 1),
          ),
          name,
          i < st.schritt && el("span", { class: "nur-leser" }, ", erledigt"),
        ),
      ),
    );
  }

  // Die Knöpfe unter jedem Schritt: links zurück oder abbrechen, rechts weiter
  const fuss = (weiter) =>
    el(
      "div",
      { class: "lg-knopfzeile" },
      st.schritt === 0
        ? knopf("Abbrechen", { onclick: zurListe })
        : knopfMit("Zurück", {
            symbol: "zurueck",
            onclick: () => gehe(st.schritt - 1),
          }),
      weiter,
    );
  const titel = (n) =>
    el(
      "h2",
      { class: "nur-leser", tabindex: "-1", id: "lg-schritt" },
      `Schritt ${n + 1} von ${SCHRITTE.length}: ${SCHRITTE[n]}`,
    );

  // Schritt 1 --------------------------------------------------------------
  function schrittGrunddaten() {
    const g = grunddaten(st.grund);
    const { name, von, bis, ort } = g.felder;
    const zusammenfassung = el("div", {
      class: "hinweis hinweis--fehler",
      role: "alert",
      tabindex: "-1",
      hidden: true,
    });
    const weiter = knopf("Weiter", {
      art: "haupt",
      onclick: () => {
        const fehler = g.pruefe();
        for (const f of [name, von, bis]) feldFehler(f, "");
        if (fehler.length > 0) {
          fehler.forEach((e) => feldFehler(e.f, e.text, { fokus: false }));
          zusammenfassung.replaceChildren(
            el(
              "span",
              {},
              el(
                "strong",
                {},
                fehler.length === 1
                  ? "1 Angabe prüfen"
                  : `${fehler.length} Angaben prüfen`,
              ),
              el("br"),
              fehler.flatMap((e, i) => [
                i > 0 && " · ",
                el(
                  "button",
                  {
                    type: "button",
                    class: "lg-textknopf",
                    onclick: () => e.f.eingabe.focus(),
                  },
                  e.label,
                ),
              ]),
            ),
          );
          zusammenfassung.hidden = false;
          zusammenfassung.focus();
          return;
        }
        st.grund = {
          titel: g.koerper().titel,
          von: von.eingabe.value,
          bis: bis.eingabe.value,
          ort: ort.eingabe.value.trim(),
        };
        gehe(1);
      },
    });
    setze(
      titel(0),
      zusammenfassung,
      name.wurzel,
      el("div", { class: "lg-zweispaltig" }, von.wurzel, bis.wurzel),
      ort.wurzel,
      fuss(weiter),
    );
  }

  // Schritt 2 --------------------------------------------------------------
  const wahlgruppe = (legende, feldName, schluessel, vorlagen, leerText) => {
    const karte = (id, name, text) => {
      const radio = el("input", {
        type: "radio",
        name: feldName,
        value: id,
        checked: id === st[schluessel],
        onchange: () => (st[schluessel] = id),
      });
      return el(
        "label",
        { class: "wahlkarte" },
        radio,
        el("div", {}, el("strong", {}, name), el("span", {}, text)),
      );
    };
    return el(
      "fieldset",
      { class: "lg-wahl" },
      el("legend", { class: "legende" }, legende),
      karte("", "Leer", leerText),
      vorlagen.map((v) =>
        karte(
          v.id,
          v.name,
          `${v.anzahl} ${v.anzahl === 1 ? "Eintrag" : "Einträge"}`,
        ),
      ),
    );
  };
  function schrittVorlage() {
    inhalt.replaceChildren();
    lader(
      async () =>
        (st.vorlagen ??= (
          await anfrage("GET", "/api/v1/admin/vorlagen")
        ).vorlagen),
      (vorlagen) => {
        const a = vorlagen.filter((v) => v.art === "aufgaben");
        const p = vorlagen.filter((v) => v.art === "packliste");
        const gruppen = [];
        if (a.length > 0)
          gruppen.push(
            wahlgruppe(
              "Aufgaben",
              "lg-aufgaben",
              "aufgaben",
              a,
              "Ohne Aufgaben.",
            ),
          );
        if (p.length > 0)
          gruppen.push(
            wahlgruppe(
              "Packliste",
              "lg-packliste",
              "packliste",
              p,
              "Ohne Packliste.",
            ),
          );
        setze(
          titel(1),
          gruppen.length > 0
            ? gruppen
            : el(
                "p",
                { class: "leise" },
                "Es gibt noch keine Vorlage. Das Lager startet leer. Vorlagen legst du unter «Vorlagen» an.",
              ),
          fuss(
            knopf("Weiter", {
              art: "haupt",
              onclick: () => gehe(2),
            }),
          ),
        );
        fokusWenn();
      },
      { skeleton: "formular" },
    );
  }

  // Schritt 3 --------------------------------------------------------------
  function schrittMitglieder() {
    inhalt.replaceChildren();
    lader(
      async () =>
        (st.personen ??= (
          await anfrage("GET", "/api/v1/admin/personen")
        ).personen.filter((p) => p.benutzername && !p.deaktiviert)),
      (personen) => {
        const suchId = neueId("lg-suche");
        const suche = el("input", {
          class: "eingabe",
          id: suchId,
          type: "search",
          placeholder: "Person suchen",
          autocomplete: "off",
        });
        const zeilen = personen.map((p) => {
          const box = ankreuzen({
            label: "Lagerleitung",
            gewaehlt: st.leitung.has(p.id),
            wert: p.id,
          });
          box.eingabe.setAttribute("aria-label", `Lagerleitung: ${p.name}`);
          box.eingabe.addEventListener("change", () =>
            box.eingabe.checked
              ? st.leitung.add(p.id)
              : st.leitung.delete(p.id),
          );
          box.wurzel.classList.add("lg-wahl-rechts");
          const zeile = el(
            "li",
            {},
            el(
              "div",
              { class: "wer" },
              avatar(p.name),
              el(
                "div",
                {},
                el("span", { class: "name" }, p.name),
                p.ceviName && el("span", { class: "klein leise" }, p.ceviName),
              ),
            ),
            box.wurzel,
          );
          zeile.dataset.suche = `${p.name} ${p.ceviName ?? ""}`.toLowerCase();
          return zeile;
        });
        suche.addEventListener("input", () => {
          const q = suche.value.trim().toLowerCase();
          zeilen.forEach((z) => (z.hidden = !z.dataset.suche.includes(q)));
        });
        setze(
          titel(2),
          el(
            "p",
            { class: "leise" },
            "Wähle die Lagerleitung. Weitere Mitglieder fügst du später im Lager hinzu.",
          ),
          personen.length === 0
            ? el(
                "p",
                { class: "leise" },
                "Es gibt noch keine Person mit Konto.",
              )
            : [
                el(
                  "div",
                  { class: "suche" },
                  el(
                    "label",
                    { class: "nur-leser", for: suchId },
                    "Person suchen",
                  ),
                  symbol("lupe"),
                  suche,
                ),
                el("ul", { class: "liste-zeilen lg-personen" }, zeilen),
              ],
          fuss(knopf("Weiter", { art: "haupt", onclick: () => gehe(3) })),
        );
        fokusWenn();
      },
      { skeleton: "liste" },
    );
  }

  // Schritt 4 --------------------------------------------------------------
  function schrittPruefen() {
    const vorlagenName = (id) =>
      st.vorlagen?.find((v) => v.id === id)?.name ?? null;
    const leitung = (st.personen ?? [])
      .filter((p) => st.leitung.has(p.id))
      .map((p) => p.name);
    const paar = (k, v) => el("div", {}, el("dt", {}, k), el("dd", {}, v));
    const anlegen = knopfMit("Lager anlegen", {
      art: "haupt",
      symbol: "haken",
      onclick: speichern,
    });
    if (st.speichert) {
      anlegen.disabled = true;
      anlegen.setAttribute("aria-busy", "true");
    }
    setze(
      titel(3),
      st.fehler &&
        el(
          "div",
          { class: "hinweis hinweis--fehler", role: "alert" },
          el("span", {}, st.fehler),
        ),
      el(
        "dl",
        { class: "werte" },
        paar("Name", st.grund.titel),
        paar("Zeitraum", zeitraum(st.grund.von, st.grund.bis)),
        paar("Ort", st.grund.ort || "–"),
        paar("Aufgaben", vorlagenName(st.aufgaben) ?? "Leer"),
        paar("Packliste", vorlagenName(st.packliste) ?? "Leer"),
        paar(
          "Lagerleitung",
          leitung.length > 0
            ? leitung.join(", ")
            : "Keine. Ein aktives Lager braucht mindestens eine.",
        ),
      ),
      fuss(anlegen),
    );
    if (st.fehler)
      inhalt.querySelector(".hinweis")?.setAttribute("tabindex", "-1");
  }

  async function speichern() {
    if (st.speichert) return;
    st.speichert = true;
    st.fehler = "";
    zeichne(false);
    const koerper = {
      titel: st.grund.titel,
      von: st.grund.von,
      bis: st.grund.bis,
      ...(st.grund.ort && { ort: st.grund.ort }),
    };
    const erste = st.aufgaben || st.packliste;
    if (erste) koerper.vorlageId = erste;
    let id;
    try {
      id = (await anfrage("POST", BASIS, koerper)).id;
    } catch (f) {
      st.speichert = false;
      st.fehler = `Das Lager wurde nicht angelegt. ${meldung(f)} Deine Angaben sind noch da, versuche es nochmals.`;
      zeichne(false);
      inhalt.querySelector(".hinweis")?.focus();
      return;
    }
    // Das Lager steht; was jetzt scheitert, holt man im Lager nach
    const offen = [];
    const aufgaben = [];
    if (st.aufgaben && st.packliste)
      aufgaben.push(
        anfrage(
          "POST",
          `/api/v1/lager/${id}/vorlagen/${st.packliste}/anwenden`,
        ).catch(() => offen.push("die Packliste aus der Vorlage")),
      );
    for (const p of st.personen ?? []) {
      if (!st.leitung.has(p.id)) continue;
      aufgaben.push(
        anfrage("PUT", `${BASIS}/${id}/mitglieder/${p.id}`, {
          rolle: "lagerleitung",
        }).catch(() => offen.push(`${p.name} als Lagerleitung`)),
      );
    }
    await Promise.all(aufgaben);
    const text = `Lager «${st.grund.titel}» angelegt.`;
    if (offen.length > 0) {
      merkeMeldung(
        `${text} Das hat nicht geklappt: ${offen.join(", ")}. Hole es im Lager nach.`,
        "warn",
        {
          text: "Lager öffnen",
          onclick: () => (location.hash = `${ADRESSE}/${id}`),
        },
      );
    } else {
      merkeMeldung(erste ? `${text} Die Vorlage ist übernommen.` : text, "ok", {
        text: "Lager öffnen",
        onclick: () => (location.hash = `${ADRESSE}/${id}`),
      });
    }
    // Der Eintrag des Assistenten wird ersetzt: Zurück führt danach zur Liste, nicht in den fertigen Assistenten
    location.replace(ADRESSE);
  }

  function zeichne(fokus) {
    st.fokus = fokus;
    zeichneSchritte();
    [schrittGrunddaten, schrittVorlage, schrittMitglieder, schrittPruefen][
      st.schritt
    ]();
    if (st.schritt === 0 || st.schritt === 3) fokusWenn();
  }
  // Nach einem Schrittwechsel liegt der Fokus auf der Schrittüberschrift; bei den Schritten, die laden, erst wenn sie da ist
  function fokusWenn() {
    if (!st.fokus) return;
    document.getElementById("lg-schritt")?.focus();
    st.fokus = false;
  }
  zeichne(false);
}
