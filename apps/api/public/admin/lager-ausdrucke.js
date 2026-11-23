import { ApiFehler, anfrage } from "./api.js";
import { el, knopf } from "./dom.js";
import { skeletonListe } from "./lader.js";
import {
  ADRESSE,
  BASIS,
  haenge,
  knopfMit,
  meldung,
  symbol,
  zurueckLink,
} from "./lager-gemeinsam.js";

// Ausdrucke eines Lagers (#527, Board A27, nur die PDF-Aushänge; #592): GET /api/v1/lager/{id}/aushaenge/{art}. Der Server erzeugt das PDF beim Klick und speichert es nirgends; hier bleibt es nur als Blob im Speicher dieser Seite. Jede Zeile zeigt Dateiname, Typ und Grösse und hat einen Fortschritt mit «Abbrechen». Eine Abfrage für den Titel, dann eine je Klick.

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

// Reine Funktionen (testbar): Dateiname aus Lager und Art, Grösse in Worten
export function dateiname(titel, art) {
  const slug = String(titel)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug ? `${slug}-` : ""}${art}.pdf`;
}
export function groesse(bytes) {
  const zahl = (n) =>
    new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 }).format(n);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${zahl(bytes / 1024)} kB`;
  return `${zahl(bytes / 1024 / 1024)} MB`;
}

// Holt die Datei und meldet den Fortschritt, soweit der Server die Länge nennt (sonst bleibt er unbestimmt)
async function erzeuge(id, art, { signal, beiFortschritt }) {
  let antwort;
  try {
    antwort = await fetch(`/api/v1/lager/${id}/aushaenge/${art}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (f) {
    if (f?.name === "AbortError") throw f;
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
  const gesamt = Number(antwort.headers.get("content-length")) || 0;
  if (!antwort.body?.getReader) return antwort.blob();
  const leser = antwort.body.getReader();
  const teile = [];
  let gelesen = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    teile.push(value);
    gelesen += value.length;
    beiFortschritt(gelesen, gesamt);
  }
  return new Blob(teile, { type: "application/pdf" });
}

export function zeige(bereich, ctx, id) {
  for (const u of urls) window.URL.revokeObjectURL(u);
  urls = [];
  ctx.lade(
    () => anfrage("GET", `${BASIS}/${id}`),
    (lager) => {
      ctx.titel("Ausdrucke", `${lager.titel} · fertige Aushänge zum Drucken.`);
      const zeilen = AUSHAENGE.map(([art, name, text]) => {
        const datei = dateiname(lager.titel, art);
        const zustand = el("div", { class: "lg-dl-zustand" });
        const meldungZeile = el("p", { class: "klein leise", role: "status" });
        // Ohne value ist der Fortschritt unbestimmt (das Element läuft dann von selbst, bei reduzierter Bewegung steht es still)
        const fortschritt = el("progress", {
          class: "lg-dl-balken",
          max: 100,
          "aria-label": `${name} wird erstellt`,
          hidden: true,
        });
        let abbruch = null;

        const zeigeBereit = () => {
          zustand.replaceChildren(
            knopfMit("Erstellen", {
              symbol: "drucker",
              kontext: name,
              onclick: erstellen,
            }),
          );
        };
        const erstellen = async () => {
          abbruch = new AbortController();
          fortschritt.hidden = false;
          fortschritt.removeAttribute("value");
          meldungZeile.textContent = "Wird erstellt …";
          const stopp = knopf("Abbrechen", {
            klein: true,
            kontext: name,
            onclick: () => abbruch.abort(),
          });
          zustand.replaceChildren(stopp);
          stopp.focus();
          try {
            const blob = await erzeuge(id, art, {
              signal: abbruch.signal,
              beiFortschritt: (gelesen, gesamt) => {
                if (!gesamt) return;
                const pct = Math.min(100, Math.round((gelesen / gesamt) * 100));
                fortschritt.value = pct;
              },
            });
            if (!bereich.isConnected) return;
            const url = window.URL.createObjectURL(blob);
            urls.push(url);
            fortschritt.hidden = true;
            meldungZeile.textContent = `Bereit: ${datei}, ${groesse(blob.size)}.`;
            const link = el(
              "a",
              {
                class: "knopf knopf--blau",
                href: url,
                download: datei,
                "aria-label": `Herunterladen: ${datei}, ${groesse(blob.size)}`,
              },
              symbol("pdf"),
              "Herunterladen",
            );
            const nochmal = knopf("Neu erstellen", {
              art: "still",
              kontext: name,
              symbol: "aktualisieren",
              onclick: erstellen,
            });
            zustand.replaceChildren(link, nochmal);
            link.focus();
          } catch (f) {
            if (!bereich.isConnected) return;
            fortschritt.hidden = true;
            if (f?.name === "AbortError") {
              meldungZeile.textContent =
                "Abgebrochen. Es wurde nichts gespeichert.";
              zeigeBereit();
              zustand.firstChild.focus();
              return;
            }
            meldungZeile.replaceChildren(
              el(
                "span",
                { class: "lg-dl-fehler" },
                symbol("info"),
                `Erstellen fehlgeschlagen. ${TEXTE[f?.status] ?? meldung(f)}`,
              ),
            );
            const nochmal = knopfMit("Nochmals versuchen", {
              symbol: "aktualisieren",
              kontext: name,
              onclick: erstellen,
            });
            zustand.replaceChildren(nochmal);
            nochmal.focus();
          }
        };
        zeigeBereit();
        return el(
          "li",
          { class: "lg-dl" },
          el(
            "span",
            { class: "lg-dl-bild", "aria-hidden": "true" },
            symbol("pdf"),
          ),
          el(
            "div",
            { class: "lg-dl-text" },
            el("strong", { class: "name" }, name),
            el("span", { class: "klein leise" }, text),
            el(
              "span",
              { class: "klein leise lg-dl-datei" },
              datei,
              el("span", { class: "chip" }, "PDF"),
            ),
            fortschritt,
            meldungZeile,
          ),
          zustand,
        );
      });
      haenge(
        bereich,
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
        el(
          "ul",
          { class: "flaeche lg-dls", "aria-label": "Ausdrucke" },
          zeilen,
        ),
      );
    },
    { skeleton: () => skeletonListe({ zeilen: 6 }) },
  );
}
