import { anfrage, fehlertext } from "./api.js";
import { auswahl, el, knopf } from "./dom.js";
import { beschaeftigt, fenster } from "./website-dialoge.js";
import { skeletonListe } from "./lader.js";
import { leerKarte } from "./zustaende.js";

// Formulare (#819): die Antworten auf die Formulare der Website ansehen, als CSV exportieren und löschen. Adresse: #website/formulare, ein Formular: #website/formulare/<Kennung>, gefiltert nach Stand: #website/formulare/<Kennung>/<stand>.
// Seit #881 trägt jede Antwort einen Stand (neu, in Bearbeitung, erledigt); wer das Recht hat, setzt ihn in der aufgeklappten Antwort.
// Datenbanklast: eine Anfrage für die Liste, je geöffnetes Formular eine für Kopf und eine für 25 Antworten, «Weitere laden» holt die nächsten 25. Kein Polling.
// Text aus Antworten kommt nur als Textknoten in die Seite (nie als HTML). Wer das Recht nicht hat, bekommt den Knopf nicht (die Route sagt es in «rechte»); jede Route prüft selbst.
const BASIS = "/api/v1/admin/formulare";
const SEITE = 25;
const DATUM = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" });

const TEXTE = {};
const ZEIT = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});
const zeit = (iso) => ZEIT.format(new Date(iso));
const anzahlText = (n) => (n === 1 ? "1 Antwort" : `${n} Antworten`);
const STAENDE = [
  ["neu", "Neu"],
  ["in_bearbeitung", "In Bearbeitung"],
  ["erledigt", "Erledigt"],
];
const standText = (s) => STAENDE.find(([w]) => w === s)?.[1] ?? s;
const status = (f) =>
  !f.veroeffentlicht
    ? "Nicht mehr auf der Seite"
    : f.schliesstAm && new Date(`${f.schliesstAm}T23:59:59`) < new Date()
      ? `Geschlossen seit ${DATUM.format(new Date(`${f.schliesstAm}T12:00:00`))}`
      : f.schliesstAm
        ? `Offen bis ${DATUM.format(new Date(`${f.schliesstAm}T12:00:00`))}`
        : "Offen";
const name = (f) =>
  f.titel ??
  (f.seitenTitel ? `Formular auf «${f.seitenTitel}»` : "Formular ohne Titel");

export function zeige(bereich, ctx) {
  if (ctx.pfad.length > 0) {
    const stand = STAENDE.some(([w]) => w === ctx.pfad[1]) ? ctx.pfad[1] : "";
    return zeigeFormular(bereich, ctx, ctx.pfad[0], stand);
  }
  ctx.lade(
    () => anfrage("GET", BASIS),
    (daten) => zeichneListe(bereich, daten.formulare),
    {
      skeleton: skeletonListe,
      fehlerTitel: "Die Formulare konnten nicht geladen werden.",
    },
  );
}

function zeichneListe(bereich, formulare) {
  bereich.replaceChildren();
  if (formulare.length === 0) {
    bereich.append(
      leerKarte(
        "Noch keine Formulare. Füge einer Seite den Baustein «Formular» hinzu und veröffentliche sie, dann erscheint es hier.",
      ),
    );
    return;
  }
  bereich.append(
    el(
      "ul",
      { class: "fm-liste", role: "list" },
      formulare.map((f) =>
        el(
          "li",
          { class: "fm-karte" },
          el(
            "a",
            { class: "fm-titel", href: `#website/formulare/${f.formularId}` },
            name(f),
          ),
          el(
            "p",
            { class: "leise" },
            `Seite «${f.seitenTitel}» · ${status(f)}`,
          ),
          el(
            "p",
            {},
            `${anzahlText(f.anzahl)}${f.letzteAm ? `, die letzte am ${zeit(f.letzteAm)}` : ""}`,
          ),
          f.neu > 0
            ? el(
                "p",
                { class: "fm-neu" },
                el(
                  "a",
                  { href: `#website/formulare/${f.formularId}/neu` },
                  f.neu === 1 ? "1 neue Antwort" : `${f.neu} neue Antworten`,
                ),
              )
            : null,
        ),
      ),
    ),
  );
}

function zeigeFormular(bereich, ctx, id, stand) {
  ctx.lade(
    () => anfrage("GET", `${BASIS}/${id}`),
    (kopf) => zeichneFormular(bereich, ctx, id, kopf, stand),
    {
      skeleton: skeletonListe,
      fehlerTitel: "Das Formular konnte nicht geladen werden.",
    },
  );
}

function zeichneFormular(bereich, ctx, id, kopf, stand) {
  const f = kopf.formular;
  ctx.titel(name(f), `Seite «${f.seitenTitel}» · ${status(f)}`);
  bereich.replaceChildren();
  let anzahl = f.anzahl;
  let neu = f.neu;
  const zurueck = el(
    "a",
    { class: "knopf knopf--klein", href: "#website/formulare" },
    "Alle Formulare",
  );
  const zaehlerP = el("p", { "aria-live": "polite" });
  const setzeZahl = () => {
    zaehlerP.textContent = `${anzahlText(anzahl)}, davon ${neu} neu. Wir löschen sie nach ${f.aufbewahrenTage} Tagen.`;
  };
  setzeZahl();
  const werkzeuge = el("div", { class: "knopfreihe" }, zurueck);
  const liste = el("ul", { class: "fm-antworten", role: "list" });
  const mehrPlatz = el("div", { class: "fm-mehr" });
  const leer = leerKarte(
    "Noch keine Antworten. Sie erscheinen hier, sobald jemand das Formular absendet.",
  );
  leer.hidden = anzahl > 0;
  // Leer nach dem Filter: sagt, welcher Stand fehlt, und führt zu allen zurück
  const leerFilter = el(
    "div",
    { class: "fm-leer-filter", hidden: true },
    el("p", {}, `Keine Antworten mit dem Stand «${standText(stand)}».`),
    el("a", { href: `#website/formulare/${id}` }, "Alle Antworten zeigen"),
  );
  // Filter nach Stand: Der Wert steht in der Adresse, Zurück und Neuladen behalten ihn
  const filter = auswahl({
    label: "Stand",
    optionen: [["", "Alle"], ...STAENDE],
    wert: stand,
  });
  filter.eingabe.addEventListener("change", () => {
    location.hash = `#website/formulare/${id}${filter.eingabe.value ? `/${filter.eingabe.value}` : ""}`;
  });
  filter.wurzel.classList.add("fm-filter");

  if (kopf.rechte.exportieren) {
    // Ein Link lädt die Datei mit der Sitzung (Cookie); der Server setzt den Dateinamen
    werkzeuge.append(
      el(
        "a",
        {
          class: "knopf knopf--klein",
          href: `${BASIS}/${id}/antworten.csv`,
          download: "",
        },
        "Als CSV exportieren",
      ),
    );
  }
  const alleLoeschen = kopf.rechte.loeschen
    ? knopf("Alle Antworten löschen", {
        klein: true,
        art: "gefahr",
        onclick: () => frageAlle(),
      })
    : null;
  if (alleLoeschen) werkzeuge.append(alleLoeschen);

  function frageLoeschen({ titel, text, knopfText, ausfuehren, ausloeser }) {
    const abbrechen = knopf("Abbrechen", { onclick: () => f2.schliesse() });
    const ok = knopf(knopfText, {
      art: "gefahr",
      onclick: async () => {
        beschaeftigt(ok, true);
        try {
          await ausfuehren();
          f2.schliesse();
        } catch (fehler) {
          beschaeftigt(ok, false);
          f2.fehler(TEXTE[fehler?.code] ?? fehlertext(fehler));
        }
      },
    });
    const f2 = fenster({
      titel,
      rueckfrage: true,
      inhalt: [el("p", {}, text)],
      fuss: [abbrechen, ok],
      fokus: abbrechen,
    });
    void ausloeser;
  }

  function frageAlle() {
    frageLoeschen({
      titel: `Alle Antworten von «${name(f)}» löschen?`,
      text: `${anzahlText(anzahl)} werden endgültig gelöscht. Das lässt sich nicht rückgängig machen. Exportiere sie vorher, wenn du sie noch brauchst.`,
      knopfText: "Alle Antworten löschen",
      ausfuehren: async () => {
        const r = await anfrage("DELETE", `${BASIS}/${id}/antworten`);
        liste.replaceChildren();
        mehrPlatz.replaceChildren();
        anzahl = 0;
        neu = 0;
        setzeZahl();
        leer.hidden = false;
        alleLoeschen.disabled = true;
        ctx.melde(`${anzahlText(r.geloescht)} gelöscht.`, "ok");
      },
    });
  }

  function zeichneAntwort(a) {
    const loeschen = kopf.rechte.loeschen
      ? knopf("Antwort löschen", {
          klein: true,
          art: "gefahr",
          kontext: zeit(a.erstelltAm),
          onclick: () =>
            frageLoeschen({
              titel: "Diese Antwort löschen?",
              text: `Die Antwort vom ${zeit(a.erstelltAm)} wird endgültig gelöscht.`,
              knopfText: "Antwort löschen",
              ausfuehren: async () => {
                await anfrage("DELETE", `${BASIS}/${id}/antworten/${a.id}`);
                const nachfolger =
                  li.nextElementSibling?.querySelector("summary") ??
                  li.previousElementSibling?.querySelector("summary");
                li.remove();
                anzahl -= 1;
                if (a.stand === "neu") neu -= 1;
                setzeZahl();
                leer.hidden = anzahl > 0;
                (nachfolger ?? zurueck).focus();
                ctx.melde("Antwort gelöscht.", "ok");
              },
            }),
        })
      : null;
    // Der Stand als Text in der Zusammenfassung (nicht nur Farbe); ändern in der aufgeklappten Antwort
    const standMarke = el(
      "span",
      { class: `fm-stand fm-stand--${a.stand}` },
      standText(a.stand),
    );
    const standWahl = kopf.rechte.bearbeiten ? standFeld(a, standMarke) : null;
    // Die Zusammenfassung nennt Zeit, Stand, Person und die erste Antwort, der Rest steht aufgeklappt
    const erste = a.eintraege[0];
    const li = el(
      "li",
      { class: "fm-antwort" },
      el(
        "details",
        {},
        el(
          "summary",
          {},
          el("span", { class: "fm-zeit" }, zeit(a.erstelltAm)),
          standMarke,
          el("span", { class: "fm-person" }, a.person ?? "Anonym"),
          erste
            ? el(
                "span",
                { class: "fm-vorschau leise" },
                erste.wert.slice(0, 80),
              )
            : null,
        ),
        el(
          "dl",
          { class: "fm-felder" },
          a.eintraege.flatMap((e) => [
            el("dt", {}, e.beschriftung),
            el("dd", {}, e.wert),
          ]),
        ),
        standWahl || loeschen
          ? el("div", { class: "fm-aktionen" }, standWahl, loeschen)
          : null,
      ),
    );
    return li;
  }

  // Stand ändern: sofort speichern, während des Speicherns gesperrt; bei einem Fehler zurück auf den alten Wert
  function standFeld(a, marke) {
    const hilfeId = `fm-stand-${a.id}-h`;
    // aria-describedby vor dem Verbessern: auswahl.js übernimmt es auf die Schaltfläche
    const wahl = auswahl({
      label: "Stand ändern",
      optionen: STAENDE,
      wert: a.stand,
      "aria-describedby": hilfeId,
    });
    wahl.wurzel.append(
      el(
        "p",
        { class: "hilfe", id: hilfeId },
        `Antwort vom ${zeit(a.erstelltAm)}. Speichert sofort.`,
      ),
    );
    // Änderungen nacheinander senden: Ein zweiter Wechsel während des Speicherns überholt den ersten nicht. Das Feld bleibt bedienbar (kein Fokusverlust), aria-busy sagt, dass gespeichert wird
    let kette = Promise.resolve();
    const speichere = async (ziel) => {
      const vorher = a.stand;
      if (ziel === vorher) return;
      wahl.wurzel.setAttribute("aria-busy", "true");
      try {
        const r = await anfrage("PATCH", `${BASIS}/${id}/antworten/${a.id}`, {
          stand: ziel,
        });
        a.stand = r.stand;
        if (vorher === "neu" && a.stand !== "neu") neu -= 1;
        if (vorher !== "neu" && a.stand === "neu") neu += 1;
        setzeZahl();
        marke.textContent = standText(a.stand);
        marke.className = `fm-stand fm-stand--${a.stand}`;
        ctx.melde(`Stand auf «${standText(a.stand)}» gesetzt.`, "ok");
      } catch (fehler) {
        wahl.eingabe.value = a.stand;
        // change zeichnet die Schaltfläche neu; der Handler sieht denselben Stand und sendet nichts
        wahl.eingabe.dispatchEvent(new Event("change"));
        ctx.melde(fehlertext(fehler), "fehler");
      } finally {
        wahl.wurzel.removeAttribute("aria-busy");
      }
    };
    wahl.eingabe.addEventListener("change", () => {
      const ziel = wahl.eingabe.value;
      kette = kette.then(() => speichere(ziel));
    });
    return wahl.wurzel;
  }

  let naechste = null;
  const weiter = knopf("Weitere Antworten laden", {
    klein: true,
    onclick: async () => {
      beschaeftigt(weiter, true);
      try {
        await ladeSeite(naechste);
      } catch (fehler) {
        ctx.melde(fehlertext(fehler), "fehler");
      } finally {
        beschaeftigt(weiter, false);
      }
    },
  });
  async function ladeSeite(nach) {
    const r = await anfrage(
      "GET",
      `${BASIS}/${id}/antworten?limit=${SEITE}${nach ? `&nach=${nach}` : ""}${stand ? `&stand=${stand}` : ""}`,
    );
    liste.append(...r.antworten.map(zeichneAntwort));
    leerFilter.hidden = !(stand && !nach && r.antworten.length === 0);
    naechste = r.naechste;
    mehrPlatz.replaceChildren(...(r.weitere ? [weiter] : []));
  }

  bereich.append(
    el(
      "p",
      { class: "leise" },
      "Diese Antworten enthalten Personendaten. Gib sie nur weiter, wenn der Datenschutzhinweis des Formulars es erlaubt.",
    ),
    zaehlerP,
    werkzeuge,
    ...(anzahl > 0 ? [filter.wurzel] : []),
    leer,
    leerFilter,
    liste,
    mehrPlatz,
  );
  if (anzahl > 0) {
    ladeSeite(null).catch((fehler) => {
      ctx.melde(fehlertext(fehler), "fehler");
    });
  }
}
