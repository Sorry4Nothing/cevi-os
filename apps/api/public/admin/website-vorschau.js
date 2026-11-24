import { anfrage } from "./api.js";
import { el, neueId } from "./dom.js";
import { symbol } from "./website-symbole.js";
import { sk } from "./lader.js";

// Vorschau einzelner Bausteine (#739): Katalog «Baustein hinzufügen» und Bausteinliste des Editors.
// Der Server rendert die Bausteine mit demselben Renderer wie die Website (POST /api/v1/redaktion/bausteine/vorschau) und liefert je Baustein eine fertige Seite.
// Sie kommt in einen Rahmen (iframe) per srcdoc: sandbox ohne allow-scripts (kein Skript läuft, auch bei einem Fehler im Renderer nicht), eigene CSP in der Seite, Stil und Schrift von der eigenen Herkunft.
// Nie innerHTML im Dokument der Verwaltung: Der Rahmen hält den Stil der Website von der Verwaltung fern und umgekehrt.

const API = "/api/v1/redaktion";
// So viele Bausteine je Anfrage (der Server nimmt höchstens 80)
const BLOCK = 40;
// Gleiche Eingaben ergeben dieselbe Seite: Der Katalog und die Liste fragen nicht zweimal
const cache = new Map();
const schluessel = (b, seiteId) =>
  JSON.stringify([seiteId ?? null, b.typ, b.daten]);

// bausteine: [{ id, typ, daten, sichtbarkeit? }]. Liefert je Baustein { html, grund? } in derselben Reihenfolge.
// seiteId: mit Seite zeigt die Vorschau die echten Daten der Abteilung (Bilder, Personen), ohne die Platzhalter
export async function ladeVorschauen(bausteine, seiteId) {
  const fehlend = bausteine.filter((b) => !cache.has(schluessel(b, seiteId)));
  for (let i = 0; i < fehlend.length; i += BLOCK) {
    const teil = fehlend.slice(i, i + BLOCK);
    const antwort = await anfrage("POST", `${API}/bausteine/vorschau`, {
      ...(seiteId && { seiteId }),
      bausteine: teil,
    });
    teil.forEach((b, j) =>
      cache.set(schluessel(b, seiteId), antwort.vorschauen[j]),
    );
  }
  return bausteine.map((b) => cache.get(schluessel(b, seiteId)));
}

// Eine Seite im Rahmen. titel: Name für Screenreader (Pflicht für Rahmen).
// messen: Der Rahmen wächst mit dem Inhalt (bis hoechstens px); ohne messen steht seine Grösse im Stil (Kachel).
export function vorschauRahmen(
  html,
  { titel, messen = false, hoechstens = 560 },
) {
  const rahmen = el("iframe", {
    class: "ws-bausteinrahmen",
    // Kein Skript, keine Formulare, keine Fenster. allow-same-origin braucht die Schrift (ein Rahmen ohne Herkunft darf sie nicht laden) und das Messen der Höhe: Ohne allow-scripts kann darin nichts laufen
    sandbox: "allow-same-origin",
    referrerpolicy: "no-referrer",
    loading: "lazy",
    title: titel,
    tabindex: messen ? undefined : "-1",
  });
  if (messen) {
    const messe = () => {
      const hoehe = rahmen.contentDocument?.documentElement?.scrollHeight;
      if (hoehe) rahmen.style.height = `${Math.min(hoehe, hoechstens)}px`;
    };
    rahmen.addEventListener("load", messe);
    // Wird die Spalte schmaler, bricht der Text um: neu messen
    if (typeof window.ResizeObserver === "function") {
      let breite = 0;
      new window.ResizeObserver(() => {
        if (rahmen.clientWidth !== breite) {
          breite = rahmen.clientWidth;
          messe();
        }
      }).observe(rahmen);
    }
  }
  rahmen.srcdoc = html;
  return rahmen;
}

// Platzhalter, solange die Vorschau lädt: dieselbe Form wie eine Seite (Titelzeile, zwei Textzeilen, Fläche)
export const vorschauSkelett = () =>
  el(
    "div",
    { class: "ws-vorschau-laden", "aria-hidden": "true" },
    sk("t", 160),
    sk("t", 260),
    sk("b", 320),
  );

// Text für Baustein, den der Server nicht zeigt
export const grundText = (grund) =>
  grund === "ungueltig"
    ? "Noch nichts zu zeigen. Fülle den Baustein aus, dann erscheint die Vorschau."
    : "Dieser Baustein zeigt auf der Website noch nichts, zum Beispiel weil ein Bild fehlt.";

export function fehlerText(f) {
  if (f?.status === 0) return "Keine Verbindung. Die Vorschau lädt später.";
  if (f?.status === 429)
    return "Zu viele Vorschauen in kurzer Zeit. Warte eine Minute.";
  if (f?.status === 403) return "Du darfst die Vorschau nicht sehen.";
  return "Die Vorschau konnte nicht laden.";
}

// Vorschau unter einer Zeile der Bausteinliste (Editor): «Vorschau zeigen» klappt sie auf, mit den aktuellen Daten des Entwurfs, auch ungespeichert.
// k: Kontext des Editors (id der Seite, vorschauOffen: Set der Baustein-IDs); b: der Baustein im Entwurf; liefert { knopf, panel }
export function bausteinVorschau(k, b, bezeichnung) {
  const panelId = neueId("bauvorschau");
  const panel = el("div", { class: "ws-bauvorschau", id: panelId });
  panel.hidden = true;
  const knopfText = el(
    "span",
    { class: "ws-vorschau-text" },
    "Vorschau zeigen",
  );
  const knopf = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--klein",
      "aria-expanded": "false",
      "aria-controls": panelId,
      "aria-label": `Vorschau zeigen: ${bezeichnung}`,
      "data-aktion": "vorschau",
    },
    symbol("vorschau"),
    knopfText,
  );
  let nr = 0;

  async function zeige() {
    const dieses = ++nr;
    const live = el(
      "p",
      { class: "nur-leser", role: "status" },
      "Vorschau lädt …",
    );
    panel.replaceChildren(vorschauSkelett(), live);
    panel.setAttribute("aria-busy", "true");
    try {
      const [v] = await ladeVorschauen(
        [{ id: b.id, typ: b.typ, daten: b.daten }],
        k.id,
      );
      if (dieses !== nr) return;
      panel.removeAttribute("aria-busy");
      if (!v.html) {
        panel.replaceChildren(
          el("p", { class: "leise", role: "status" }, grundText(v.grund)),
        );
        return;
      }
      live.textContent = "Die Vorschau ist geladen.";
      panel.replaceChildren(
        vorschauRahmen(v.html, {
          titel: `Vorschau: ${bezeichnung}`,
          messen: true,
        }),
        el(
          "p",
          { class: "klein leise" },
          "So sieht der Baustein auf der Website aus: hell, in der Breite dieser Spalte, mit deinen aktuellen Eingaben. Links und Bewegung sind hier ohne Funktion.",
        ),
        live,
      );
    } catch (f) {
      if (dieses !== nr) return;
      panel.removeAttribute("aria-busy");
      panel.replaceChildren(
        el(
          "div",
          { class: "zustand", role: "alert" },
          el("p", {}, fehlerText(f)),
          el(
            "button",
            {
              type: "button",
              class: "knopf knopf--klein",
              onclick: zeige,
            },
            "Nochmals versuchen",
          ),
        ),
      );
    }
  }

  function setze(offen, laden = true) {
    panel.hidden = !offen;
    knopf.setAttribute("aria-expanded", String(offen));
    knopfText.textContent = offen ? "Vorschau verbergen" : "Vorschau zeigen";
    knopf.setAttribute(
      "aria-label",
      `${offen ? "Vorschau verbergen" : "Vorschau zeigen"}: ${bezeichnung}`,
    );
    if (offen) k.vorschauOffen.add(b.id);
    else {
      k.vorschauOffen.delete(b.id);
      nr++;
    }
    if (offen && laden) void zeige();
  }
  knopf.addEventListener("click", () => setze(panel.hidden));
  // Nach dem Neuzeichnen der Liste bleibt eine offene Vorschau offen
  if (k.vorschauOffen.has(b.id)) setze(true);
  return { knopf, panel };
}
