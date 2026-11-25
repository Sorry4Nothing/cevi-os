import { anfrage, fehlertext } from "./api.js";
import { el, knopf } from "./dom.js";
import { band, beschaeftigt, fenster } from "./website-dialoge.js";
import { skeletonListe } from "./lader.js";
import { leerKarte } from "./zustaende.js";

// Formulare (#819): die Antworten auf die Formulare der Website ansehen, als CSV exportieren und löschen. Adresse: #website/formulare, ein Formular: #website/formulare/<Kennung>.
// Datenbanklast: eine Anfrage für die Liste, je geöffnetes Formular eine für Kopf und eine für 25 Antworten, «Weitere laden» holt die nächsten 25. Kein Polling.
// Text aus Antworten kommt nur als Textknoten in die Seite (nie innerHTML). Wer das Recht nicht hat, bekommt den Knopf nicht (die Route sagt es in «rechte»); jede Route prüft selbst.
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
const status = (f) =>
  !f.veroeffentlicht
    ? "Nicht mehr auf der Seite"
    : f.schliesstAm && new Date(`${f.schliesstAm}T23:59:59`) < new Date()
      ? `Geschlossen seit ${DATUM.format(new Date(`${f.schliesstAm}T12:00:00`))}`
      : f.schliesstAm
        ? `Offen bis ${DATUM.format(new Date(`${f.schliesstAm}T12:00:00`))}`
        : "Offen";
const name = (f) => f.titel ?? "Formular ohne Titel";

export function zeige(bereich, ctx) {
  if (ctx.pfad.length > 0) return zeigeFormular(bereich, ctx, ctx.pfad[0]);
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
        ),
      ),
    ),
  );
}

function zeigeFormular(bereich, ctx, id) {
  ctx.lade(
    () => anfrage("GET", `${BASIS}/${id}`),
    (kopf) => zeichneFormular(bereich, ctx, id, kopf),
    {
      skeleton: skeletonListe,
      fehlerTitel: "Das Formular konnte nicht geladen werden.",
    },
  );
}

function zeichneFormular(bereich, ctx, id, kopf) {
  const f = kopf.formular;
  ctx.titel(name(f), `Seite «${f.seitenTitel}» · ${status(f)}`);
  bereich.replaceChildren();
  let anzahl = f.anzahl;
  const zurueck = el(
    "a",
    { class: "knopf knopf--klein", href: "#website/formulare" },
    "Alle Formulare",
  );
  const zaehlerP = el("p", { "aria-live": "polite" });
  const setzeZahl = () => {
    zaehlerP.textContent = `${anzahlText(anzahl)}. Wir löschen sie nach ${f.aufbewahrenTage} Tagen.`;
  };
  setzeZahl();
  const werkzeuge = el("div", { class: "knopfreihe" }, zurueck);
  const liste = el("ul", { class: "fm-antworten", role: "list" });
  const mehrPlatz = el("div", { class: "fm-mehr" });
  const leer = leerKarte(
    "Noch keine Antworten. Sie erscheinen hier, sobald jemand das Formular absendet.",
  );
  leer.hidden = anzahl > 0;

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
                setzeZahl();
                leer.hidden = anzahl > 0;
                (nachfolger ?? zurueck).focus();
                ctx.melde("Antwort gelöscht.", "ok");
              },
            }),
        })
      : null;
    // Die Zusammenfassung nennt Zeit, Person und die erste Antwort, der Rest steht aufgeklappt
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
        loeschen,
      ),
    );
    return li;
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
      `${BASIS}/${id}/antworten?limit=${SEITE}${nach ? `&nach=${nach}` : ""}`,
    );
    liste.append(...r.antworten.map(zeichneAntwort));
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
    leer,
    liste,
    mehrPlatz,
  );
  if (anzahl > 0) {
    ladeSeite(null).catch((fehler) => {
      bereich.append(band("fehler", fehlertext(fehler)));
    });
  }
}
