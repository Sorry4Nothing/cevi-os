import { anfrage } from "./api.js";
import { zurueck } from "./verlauf.js";
import { avatar, el, knopf } from "./dom.js";
import {
  ADRESSE,
  BASIS,
  ROLLENNAME,
  feldFehler,
  grunddaten,
  knopfMit,
  meldung,
  merkeMeldung,
  symbol,
  wetterOrtProblem,
  wetterOrtZeile,
  zeitraum,
} from "./lager-gemeinsam.js";
import { personenWahl } from "./lager-personenwahl.js";

// «Neues Lager» in vier Schritten (#527, Board A21; #592): Grunddaten, Vorlage, Mitglieder, Prüfen. Jeder Schritt hat eine Adresse (#lager/lager/neu, …/neu/vorlage, …/neu/mitglieder, …/neu/pruefen), Browser-Zurück geht einen Schritt zurück. Senkrechte Zeitleiste: Erledigtes faltet sich zu einer Zeile mit «Ändern». Die Eingaben liegen im Speicher dieses Moduls, solange man im Assistenten bleibt; gespeichert wird erst im letzten Schritt: POST /api/v1/admin/lager (mit der ersten Vorlage), danach die zweite Vorlage und die Mitglieder. Vorlagen und Personen werden erst geladen, wenn ihr Schritt kommt.

const SCHRITTE = [
  { schluessel: "grunddaten", name: "Grunddaten", adresse: `${ADRESSE}/neu` },
  { schluessel: "vorlage", name: "Vorlage", adresse: `${ADRESSE}/neu/vorlage` },
  {
    schluessel: "mitglieder",
    name: "Mitglieder",
    adresse: `${ADRESSE}/neu/mitglieder`,
  },
  { schluessel: "pruefen", name: "Prüfen", adresse: `${ADRESSE}/neu/pruefen` },
];

// Zustand der Eingaben über die Adresswechsel hinweg; null ausserhalb des Assistenten
let entwurf = null;
const neuerEntwurf = () => ({
  grund: null,
  aufgaben: "",
  packliste: "",
  mitglieder: new Map(),
  vorlagen: null,
  personen: null,
  speichert: false,
  fehler: "",
});
// Wer den Assistenten verlässt, beginnt beim nächsten Mal leer
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith(`${ADRESSE}/neu`)) entwurf = null;
});
// Neuladen und Tab schliessen: Die Eingaben gingen verloren
window.addEventListener("beforeunload", (e) => {
  if (entwurf?.grund) e.preventDefault();
});

export function zeige(bereich, ctx) {
  const name = ctx.pfad[1] ?? "grunddaten";
  const nr = SCHRITTE.findIndex((s) => s.schluessel === name);
  // Unbekannter Schritt oder Tiefenlink ohne Eingaben: zurück an den Anfang bzw. zur Liste
  if (nr < 0 || ctx.pfad.length > 2) {
    location.replace(SCHRITTE[0].adresse);
    return;
  }
  if (nr === 0) entwurf ??= neuerEntwurf();
  if (nr > 0 && !entwurf?.grund) {
    location.replace(ADRESSE);
    return;
  }
  const st = entwurf;
  ctx.titel("Neues Lager", "In vier Schritten. Du kannst alles später ändern.");
  ctx.kopfAktion();
  const zeitleiste = el("ol", {
    class: "lg-zeitleiste",
    "aria-label": "Schritte",
  });
  bereich.append(zeitleiste);

  const zurListe = () => zurueck(ADRESSE);
  const weiter = (n) => (location.hash = SCHRITTE[n].adresse);

  // Die Zeile eines erledigten Schritts
  function zusammenfassung(n) {
    const vorlagenName = (id) =>
      st.vorlagen?.find((v) => v.id === id)?.name ?? null;
    if (n === 0)
      return `${st.grund.titel} · ${zeitraum(st.grund.von, st.grund.bis)}${st.grund.ort ? ` · ${st.grund.ort}` : ""}`;
    if (n === 1) {
      const teile = [
        vorlagenName(st.aufgaben) && `Aufgaben: ${vorlagenName(st.aufgaben)}`,
        vorlagenName(st.packliste) &&
          `Packliste: ${vorlagenName(st.packliste)}`,
      ].filter(Boolean);
      return teile.length > 0 ? teile.join(" · ") : "Ohne Vorlage";
    }
    if (n === 2) {
      const z = st.mitglieder.size;
      const leitung = [...st.mitglieder.values()].filter(
        (m) => m.rolle === "lagerleitung",
      ).length;
      return z === 0
        ? "Noch niemand"
        : `${z === 1 ? "1 Person" : `${z} Personen`}, davon ${leitung} Lagerleitung`;
    }
    return "";
  }

  // Knoten für alle Schritte; der aktuelle bekommt den Inhalt
  const inhalt = el("div", { class: "lg-schrittinhalt" });
  const kopfTitel = el(
    "h2",
    { class: "lg-schrittname", tabindex: "-1", id: "lg-schritt" },
    SCHRITTE[nr].name,
  );
  zeitleiste.replaceChildren(
    ...SCHRITTE.map((s, i) => {
      const zustand = i < nr ? "fertig" : i === nr ? "jetzt" : "spaeter";
      return el(
        "li",
        {
          class: `lg-schritt lg-schritt--${zustand}`,
          "aria-current": i === nr ? "step" : undefined,
        },
        el(
          "span",
          { class: "lg-marke", "aria-hidden": "true" },
          i < nr ? symbol("haken") : String(i + 1),
        ),
        el(
          "div",
          { class: "lg-schrittkoerper" },
          i === nr
            ? kopfTitel
            : el(
                "h2",
                { class: "lg-schrittname" },
                s.name,
                i < nr && el("span", { class: "nur-leser" }, ", erledigt"),
              ),
          i < nr &&
            el(
              "p",
              { class: "lg-schrittsumme" },
              el("span", {}, zusammenfassung(i)),
              el(
                "a",
                {
                  class: "lg-verweis",
                  href: s.adresse,
                  "aria-label": `${s.name} ändern`,
                },
                "Ändern",
              ),
            ),
          i === nr && inhalt,
        ),
      );
    }),
  );
  const setze = (...kinder) =>
    inhalt.replaceChildren(...kinder.flat().filter(Boolean));
  const lader = ctx.erstelleLader(inhalt);
  // Nach einem Schrittwechsel liegt der Fokus auf dem Namen des Schritts; bei Schritten, die laden, erst wenn sie da sind
  const fokus = () => kopfTitel.focus({ preventScroll: false });

  const fuss = (naechster) =>
    el(
      "div",
      { class: "lg-knopfzeile" },
      nr === 0
        ? knopf("Abbrechen", { onclick: zurListe })
        : knopfMit("Zurück", {
            symbol: "zurueck",
            onclick: () => zurueck(SCHRITTE[nr - 1].adresse),
          }),
      naechster,
    );

  // Schritt 1 --------------------------------------------------------------
  function schrittGrunddaten() {
    const g = grunddaten(st.grund ?? {});
    const { name: nameFeld, von, bis, ort } = g.felder;
    const zusammenfassungFehler = el("div", {
      class: "hinweis hinweis--fehler",
      role: "alert",
      tabindex: "-1",
      hidden: true,
    });
    const naechster = knopf("Weiter", {
      art: "haupt",
      onclick: () => {
        const fehler = g.pruefe();
        for (const f of [nameFeld, von, bis]) feldFehler(f, "");
        if (fehler.length > 0) {
          fehler.forEach((e) => feldFehler(e.f, e.text, { fokus: false }));
          zusammenfassungFehler.replaceChildren(
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
          zusammenfassungFehler.hidden = false;
          zusammenfassungFehler.focus();
          return;
        }
        st.grund = {
          titel: g.koerper().titel,
          von: von.eingabe.value,
          bis: bis.eingabe.value,
          ort: ort.eingabe.value.trim(),
        };
        weiter(1);
      },
    });
    setze(
      zusammenfassungFehler,
      nameFeld.wurzel,
      el("div", { class: "lg-zweispaltig" }, von.wurzel, bis.wurzel),
      ort.wurzel,
      fuss(naechster),
    );
    fokus();
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
          gruppen.length > 0
            ? gruppen
            : el(
                "p",
                { class: "leise" },
                "Es gibt noch keine Vorlage. Das Lager startet leer. Vorlagen legst du unter «Vorlagen» an.",
              ),
          fuss(knopf("Weiter", { art: "haupt", onclick: () => weiter(2) })),
        );
        fokus();
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
        const schon = new Set(st.mitglieder.keys());
        const imLager = el("ul", {
          class: "liste-zeilen lg-imlager",
          "aria-label": "Mitglieder des Lagers",
        });
        const liste = () => {
          imLager.replaceChildren(
            ...[...st.mitglieder.values()].map(({ person, rolle }) =>
              el(
                "li",
                {},
                el(
                  "div",
                  { class: "wer" },
                  avatar(person.name, { hell: true, bildUrl: person.bildUrl }),
                  el(
                    "div",
                    {},
                    el("span", { class: "name" }, person.name),
                    person.ceviName &&
                      el("span", { class: "klein leise" }, person.ceviName),
                  ),
                ),
                el("span", { class: "chip" }, ROLLENNAME[rolle]),
                knopf("Entfernen", {
                  art: "still",
                  klein: true,
                  kontext: person.name,
                  symbol: "minus",
                  onclick: () => {
                    st.mitglieder.delete(person.id);
                    schon.delete(person.id);
                    liste();
                    wahl.aktualisiere();
                    wahl.fokus();
                  },
                }),
              ),
            ),
          );
          imLager.hidden = st.mitglieder.size === 0;
        };
        const wahl = personenWahl({
          titel: "Wer arbeitet im Lager mit?",
          hilfe:
            "Ein aktives Lager braucht mindestens eine Lagerleitung. Weitere Mitglieder fügst du später im Lager hinzu.",
          personen,
          ausgeschlossen: schon,
          rolle: "lagerleitung",
          beiHinzufuegen: (gewaehlt, rolle) => {
            for (const p of gewaehlt)
              st.mitglieder.set(p.id, { person: p, rolle });
            liste();
          },
          fehlertext: meldung,
        });
        liste();
        setze(
          personen.length === 0
            ? el(
                "p",
                { class: "leise" },
                "Es gibt noch keine Person mit Konto.",
              )
            : [wahl.wurzel, imLager],
          fuss(knopf("Weiter", { art: "haupt", onclick: () => weiter(3) })),
        );
        fokus();
      },
      { skeleton: "liste" },
    );
  }

  // Schritt 4 --------------------------------------------------------------
  function schrittPruefen() {
    const vorlagenName = (id) =>
      st.vorlagen?.find((v) => v.id === id)?.name ?? null;
    const mitglieder = [...st.mitglieder.values()];
    const leitung = mitglieder
      .filter((m) => m.rolle === "lagerleitung")
      .map((m) => m.person.name);
    const paar = (k, v, schritt) =>
      el(
        "div",
        {},
        el("dt", {}, k),
        el(
          "dd",
          {},
          v,
          el(
            "a",
            {
              class: "lg-verweis lg-aendern",
              href: SCHRITTE[schritt].adresse,
              "aria-label": `${k} ändern`,
            },
            "Ändern",
          ),
        ),
      );
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
      st.fehler &&
        el(
          "div",
          { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
          el("span", {}, st.fehler),
        ),
      el(
        "dl",
        { class: "werte" },
        paar("Name", st.grund.titel, 0),
        paar("Zeitraum", zeitraum(st.grund.von, st.grund.bis), 0),
        paar("Ort", st.grund.ort || "–", 0),
        paar("Aufgaben", vorlagenName(st.aufgaben) ?? "Leer", 1),
        paar("Packliste", vorlagenName(st.packliste) ?? "Leer", 1),
        paar(
          "Mitglieder",
          mitglieder.length === 0
            ? "Niemand"
            : mitglieder
                .map((m) => `${m.person.name} (${ROLLENNAME[m.rolle]})`)
                .join(", "),
          2,
        ),
      ),
      leitung.length === 0 &&
        el(
          "div",
          { class: "hinweis hinweis--warn", role: "status" },
          el(
            "span",
            {},
            "Ohne Lagerleitung bleibt das Lager ein Entwurf. Aktivieren geht erst, wenn jemand die Lagerleitung hat.",
          ),
        ),
      fuss(anlegen),
    );
    fokus();
    if (st.fehler) inhalt.querySelector(".hinweis")?.focus();
  }

  async function speichern() {
    if (st.speichert) return;
    st.speichert = true;
    st.fehler = "";
    schrittPruefen();
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
      schrittPruefen();
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
    for (const { person, rolle } of st.mitglieder.values()) {
      aufgaben.push(
        anfrage("PUT", `${BASIS}/${id}/mitglieder/${person.id}`, {
          rolle,
        }).catch(() => offen.push(`${person.name} als ${ROLLENNAME[rolle]}`)),
      );
    }
    await Promise.all(aufgaben);
    // Der Server hat den Wetterort aus dem Ort bestimmt; das Lager sagt, ob er ihn gefunden hat
    const wetter = st.grund.ort
      ? (await anfrage("GET", `${BASIS}/${id}`).catch(() => null))?.wetterOrt
      : null;
    const text = `Lager «${st.grund.titel}» angelegt.`;
    const wetterText = wetter ? ` ${wetterOrtZeile(wetter)}` : "";
    if (offen.length > 0)
      merkeMeldung(
        `${text} Das hat nicht geklappt: ${offen.join(", ")}. Hole es im Lager nach.${wetterText}`,
        "warn",
      );
    else
      merkeMeldung(
        `${erste ? `${text} Die Vorlage ist übernommen.` : text}${wetterText}`,
        wetterOrtProblem(wetter) ? "warn" : "ok",
      );
    // Die Eingaben sind verbraucht; das neue Lager ersetzt den Eintrag des letzten Schritts, Zurück führt nicht in den fertigen Assistenten
    entwurf = null;
    location.replace(`${ADRESSE}/${id}`);
  }

  [schrittGrunddaten, schrittVorlage, schrittMitglieder, schrittPruefen][nr]();
}
