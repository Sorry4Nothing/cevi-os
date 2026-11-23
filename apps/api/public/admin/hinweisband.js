// Hinweisband der Verwaltung (#593): Solange ein Bereich in Wartung oder durch eine Informationssperre gesperrt ist, steht unter dem Kopf jeder Seite ein Band mit dem, was gilt. Aufbau (Schwere, Zeitpunkt, Hinweis, Verweis auf die Quelle) nach dem Muster «incident-banner» aus Kokonut UI Pro; gezeichnet ist alles selbst.
// Datenbanklast: Die Zustände liegen im Speicher der API (GET /api/v1/plattform/schalter, keine Datenbankabfrage). Das Band fragt beim Öffnen der Verwaltung, nach einer Schaltung auf der Plattform und höchstens einmal je Minute bei einer Navigation, nie im Takt.
import { anfrage } from "./api.js";
import { el, icon, zeit } from "./dom.js";

// Die Bereiche, die sich schalten lassen: Schlüssel der API, Name und Beschreibung (auch für die Seite «Plattform»)
export const BEREICHE = [
  ["alles", "Alles", "Jeder Bereich von Cevi OS."],
  [
    "website",
    "Website",
    "Seiten, Medien, Weiterleitungen und Vorlagen der Website.",
  ],
  ["lager", "Lager", "Das Lager-Modul und seine Verwaltung."],
  ["chat", "Chat", "Die Chats der App."],
  ["programme", "Programme und Termine", "Programme, Anmeldungen, Termine."],
  ["verwaltung", "Verwaltung", "Alle Verwaltungsseiten dieser Seite."],
];
const NAME = new Map(BEREICHE.map(([schluessel, name]) => [schluessel, name]));

// Das Ereignis, mit dem die Seite «Plattform» das Band nach einer Schaltung neu fragen lässt
export const GEAENDERT = "plattform:geaendert";

const MINUTE = 60_000;

// Eine Zeile je Schalter: Sperren zuerst, danach Wartung. Der Zustand steht im Wort, die Farbe verstärkt nur
export function zeilenVon(schalter) {
  return [...schalter]
    .sort(
      (a, b) =>
        (a.art === "sperre" ? 0 : 1) - (b.art === "sperre" ? 0 : 1) ||
        a.bereich.localeCompare(b.bereich),
    )
    .map((s) => {
      const name = NAME.get(s.bereich) ?? s.bereich;
      const sperre = s.art === "sperre";
      return {
        art: s.art,
        titel: sperre
          ? `Informationssperre: ${name}`
          : `Wartung: ${name} ist nur lesbar`,
        teile: [
          s.ausgeloestAm ? `Seit ${zeit(s.ausgeloestAm)}` : null,
          !sperre && s.ende ? `Geplantes Ende ${zeit(s.ende)}` : null,
          sperre && s.websiteOffline ? "Öffentliche Website vom Netz" : null,
        ].filter(Boolean),
        hinweis: s.hinweis ?? "",
      };
    });
}

export function erstelleHinweisband() {
  const wurzel = el("div", { class: "hinweisband-halter" });
  let zuletzt = 0;
  let laeuft = false;

  function zeichne(schalter) {
    const zeilen = zeilenVon(schalter);
    if (zeilen.length === 0) {
      wurzel.replaceChildren();
      return;
    }
    const schwer = zeilen.some((z) => z.art === "sperre");
    wurzel.replaceChildren(
      el(
        "section",
        {
          class: `hinweisband hinweisband--${schwer ? "sperre" : "wartung"}`,
          "aria-label": "Betriebshinweis",
        },
        el(
          "div",
          { class: "hinweisband-innen" },
          el(
            "ul",
            { class: "hinweisband-liste" },
            zeilen.map((z) =>
              el(
                "li",
                { class: `hinweisband-zeile hinweisband-zeile--${z.art}` },
                icon(z.art === "sperre" ? "sperre" : "uhr"),
                el(
                  "div",
                  {},
                  el("p", { class: "hinweisband-titel" }, z.titel),
                  z.teile.length > 0 &&
                    el("p", { class: "hinweisband-meta" }, z.teile.join(" · ")),
                  z.hinweis &&
                    el("p", { class: "hinweisband-text" }, z.hinweis),
                ),
              ),
            ),
          ),
          el(
            "a",
            { class: "knopf knopf--klein", href: "#system/plattform" },
            "Zur Plattform",
          ),
        ),
      ),
    );
  }

  // Ein Fehler lässt das Band, wie es ist: Es ist ein Hinweis, keine Funktion
  async function aktualisiere({ erzwingen = false } = {}) {
    if (laeuft || (!erzwingen && Date.now() - zuletzt < MINUTE)) return;
    laeuft = true;
    try {
      zeichne((await anfrage("GET", "/api/v1/plattform/schalter")).schalter);
      zuletzt = Date.now();
    } catch {
      // bleibt, wie es war
    } finally {
      laeuft = false;
    }
  }

  document.addEventListener(GEAENDERT, () => aktualisiere({ erzwingen: true }));
  return { wurzel, zeichne, aktualisiere };
}
