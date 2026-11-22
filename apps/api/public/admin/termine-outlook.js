import { anfrage, fehlertext } from "./api.js";
import { chip, el, knopf } from "./dom.js";
import { stempel, vorText } from "./kalenderhilfen.js";
import { skeletonFlaeche } from "./lader.js";

// Unterseite «Outlook» (A13): Stand der Verbindung zum Kalender der Abteilung. Lesen: Stand des Abgleichs und «Abgleich starten». Schreiben nach Outlook gibt es nicht: Termine trägt die Abteilungsleitung von Hand ein (siehe «Vorschläge»).
// Abfragen: eine beim Öffnen (GET /api/v1/admin/system/syncs), eine je «Abgleich starten» (POST) und danach eine zum Nachladen. Kein Polling.
// Lücke gegenüber dem Design: «Davon ohne Kategorie» fehlt, denn die API liefert keine Gesamtzahl; die Zahl steht in der Unterleiste bei «Ohne Kategorie».

const BASIS = "/api/v1/admin/system/syncs";

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", BASIS),
    (daten, neu) => zeichne(bereich, ctx, daten.kalender, neu),
    {
      fehlertitel: "Der Zustand der Verbindung konnte nicht geladen werden.",
      skeleton: () =>
        el(
          "div",
          { class: "tm-zweispalt tm-gleich" },
          skeletonFlaeche({ zeilen: 3 }),
          skeletonFlaeche({ zeilen: 2 }),
        ),
    },
  );
}

// Stand des Lesens als Chip, Text und Werte; der Zustand steht im Wort, nie nur in der Farbe
function lesen(k) {
  if (!k.eingerichtet) {
    return {
      chip: chip("Nicht eingerichtet", "warn"),
      text: "Auf dem Server ist keine Kalenderadresse hinterlegt. Dann liest Cevi OS keine Termine.",
      abgleich: false,
    };
  }
  const letzter = k.letzterErfolgAm
    ? `Letzter Abgleich ${vorText(k.letzterErfolgAm)}.`
    : "Es gab noch keinen erfolgreichen Abgleich.";
  if (k.fehler) {
    return {
      chip: chip("Abgleich fehlgeschlagen", "fehler"),
      text: `Der letzte Abgleich ist fehlgeschlagen: ${k.fehler}. Starte den Abgleich nochmals. ${letzter}`,
      abgleich: true,
    };
  }
  return { chip: chip("Aktiv", "ok"), text: letzter, abgleich: true };
}

function zeichne(bereich, ctx, k, neu) {
  const stand = lesen(k);
  const rueck = el("p", { class: "klein", role: "status" });
  const abgleich =
    stand.abgleich &&
    knopf("Abgleich starten", {
      art: k.fehler ? "haupt" : undefined,
      symbol: "aktualisieren",
      onclick: async (e) => {
        const knopfNode = e.currentTarget;
        knopfNode.disabled = true;
        knopfNode.setAttribute("aria-busy", "true");
        rueck.textContent = "Der Abgleich läuft …";
        try {
          const { ergebnis } = await anfrage("POST", `${BASIS}/kalender`);
          ctx.melde(
            ergebnis === "fertig"
              ? "Der Abgleich ist abgeschlossen."
              : "Es läuft schon ein Abgleich.",
            ergebnis === "fertig" ? "ok" : "info",
          );
          neu();
        } catch (f) {
          knopfNode.disabled = false;
          knopfNode.removeAttribute("aria-busy");
          rueck.textContent = "";
          ctx.melde(
            f?.status === 501
              ? "Der Server hat den Abgleich nicht eingerichtet."
              : `Der Abgleich ist nicht möglich. ${fehlertext(f)}`,
            "fehler",
          );
        }
      },
    });
  bereich.append(
    el(
      "div",
      { class: "tm-zweispalt tm-gleich" },
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "ol-lesen" },
        el(
          "div",
          { class: "zeile" },
          el("h2", { id: "ol-lesen" }, "Lesen"),
          el("ul", { class: "chips" }, stand.chip),
        ),
        el("p", {}, stand.text),
        el(
          "dl",
          { class: "werte" },
          el(
            "div",
            {},
            el("dt", {}, "Termine in Cevi OS"),
            el("dd", {}, String(k.programme)),
          ),
          k.letzterErfolgAm &&
            el(
              "div",
              {},
              el("dt", {}, "Letzter erfolgreicher Abgleich"),
              el("dd", {}, stempel(k.letzterErfolgAm)),
            ),
        ),
        abgleich,
        rueck,
        el(
          "p",
          { class: "klein leise" },
          "Der Abgleich läuft von selbst alle 5 Minuten.",
        ),
        el(
          "a",
          { class: "knopf knopf--klein", href: "#termine/warnliste" },
          "Termine ohne Kategorie ansehen",
        ),
      ),
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "ol-schreiben" },
        el(
          "div",
          { class: "zeile" },
          el("h2", { id: "ol-schreiben" }, "Schreiben"),
          el(
            "ul",
            { class: "chips" },
            chip("Noch nicht eingerichtet", undefined, "info"),
          ),
        ),
        el(
          "p",
          {},
          "Cevi OS schreibt nicht nach Outlook. Bis dahin trägst du freigegebene Termine selbst in Outlook ein.",
        ),
        el(
          "a",
          {
            class: "knopf knopf--klein",
            href: "#termine/vorschlaege/freigegeben",
          },
          "Freigegebene Vorschläge ansehen",
        ),
      ),
    ),
  );
}
