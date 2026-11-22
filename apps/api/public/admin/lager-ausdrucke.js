import { ApiFehler, anfrage } from "./api.js";
import { el, tabelle } from "./dom.js";
import { skeletonTabelle } from "./lader.js";
import {
  ADRESSE,
  BASIS,
  knopfMit,
  meldung,
  symbol,
  zurueckLink,
} from "./lager-gemeinsam.js";

// Ausdrucke eines Lagers (#527, Board A27, nur die PDF-Aushänge): GET /api/v1/lager/{id}/aushaenge/{art}. Der Server erzeugt das PDF beim Klick und speichert es nirgends; hier bleibt es nur als Blob im Speicher dieser Seite. Eine Abfrage für den Titel, dann eine je Klick.

const AUSHAENGE = [
  ["schichtplan", "Schichtplan", "Dienste und Besetzung je Tag."],
  ["zimmerliste", "Zimmerliste", "Teilnehmende und Team je Zimmer oder Zelt."],
  [
    "tuerschilder",
    "Türschilder",
    "Ein Blatt je Zimmer mit den Namen der Kinder.",
  ],
  [
    "gruppenlisten",
    "Gruppenlisten",
    "Leitung und Mitglieder je Programmgruppe.",
  ],
  ["fahrtenliste", "Fahrtenliste", "Angaben und Mitfahrende je Fahrt, quer."],
  [
    "organigramm",
    "Organigramm",
    "Die Ressorts mit Leitung und Stellvertretung.",
  ],
];

const TEXTE = {
  403: "Dafür fehlt dir das Recht in diesem Lager.",
  413: "Der Aushang wäre zu gross (über 2000 Zeilen oder 100 Seiten).",
};

// Die Adressen der erzeugten Dateien, damit sie beim nächsten Besuch freigegeben werden
let urls = [];

async function erzeuge(id, art) {
  let antwort;
  try {
    antwort = await fetch(`/api/v1/lager/${id}/aushaenge/${art}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiFehler(0, "NETZ");
  }
  if (!antwort.ok) {
    let daten = null;
    try {
      daten = await antwort.json();
    } catch {
      // Kein JSON: Der Status genügt
    }
    throw new ApiFehler(
      antwort.status,
      daten?.code,
      daten?.message,
      antwort.headers.get("X-Retry-After"),
    );
  }
  return antwort.blob();
}

export function zeige(bereich, ctx, id) {
  for (const u of urls) window.URL.revokeObjectURL(u);
  urls = [];
  ctx.lade(
    () => anfrage("GET", `${BASIS}/${id}`),
    (lager) => {
      ctx.titel("Ausdrucke", `${lager.titel} · fertige Aushänge zum Drucken.`);
      const zeilen = AUSHAENGE.map(([art, name, text]) => {
        const zelle = el("div", { class: "aktionen" });
        const feld = el("td", { class: "rechts" }, zelle);
        const erstellen = () => {
          zelle.classList.remove("lg-fehlerzelle");
          zelle.replaceChildren(
            el(
              "span",
              {
                class: "knopf knopf--klein lg-erstellt",
                role: "status",
                "aria-busy": "true",
              },
              "Wird erstellt …",
            ),
          );
          erzeuge(id, art).then(
            (blob) => {
              if (!bereich.isConnected) return;
              const url = window.URL.createObjectURL(blob);
              urls.push(url);
              const link = el(
                "a",
                {
                  class: "knopf knopf--klein knopf--blau",
                  href: url,
                  download: `${art}.pdf`,
                },
                symbol("pdf"),
                `Bereit: ${name} herunterladen`,
              );
              zelle.replaceChildren(link);
              link.focus();
            },
            (f) => {
              if (!bereich.isConnected) return;
              const t = el(
                "p",
                { class: "feld-fehler", role: "alert" },
                symbol("info"),
                `Erstellen fehlgeschlagen. ${TEXTE[f?.status] ?? meldung(f)}`,
              );
              const nochmal = knopfMit("Nochmals versuchen", {
                klein: true,
                symbol: "aktualisieren",
                kontext: name,
                onclick: erstellen,
              });
              zelle.classList.add("lg-fehlerzelle");
              zelle.replaceChildren(t, nochmal);
              nochmal.focus();
            },
          );
        };
        zelle.append(
          knopfMit("Erstellen", {
            klein: true,
            symbol: "drucker",
            kontext: name,
            onclick: erstellen,
          }),
        );
        return el(
          "tr",
          {},
          el(
            "th",
            { scope: "row" },
            el("span", { class: "name" }, name),
            el("span", { class: "klein leise" }, text),
          ),
          el("td", {}, el("span", { class: "chip" }, symbol("pdf"), "PDF")),
          feld,
        );
      });
      bereich.append(
        zurueckLink(`Zum Lager «${lager.titel}»`, `${ADRESSE}/${lager.id}`),
        el(
          "div",
          { class: "hinweis hinweis--info", role: "status" },
          el(
            "span",
            {},
            "Der Aushang entsteht beim Klick aus dem aktuellen Stand und wird nirgends gespeichert.",
          ),
        ),
        tabelle({
          beschriftung: "Ausdrucke",
          spalten: ["Ausdruck", "Format", "Aktionen"],
          zeilen,
        }).wurzel,
      );
    },
    {
      skeleton: () => skeletonTabelle({ spalten: 3, zeilen: 6, avatar: false }),
    },
  );
}
