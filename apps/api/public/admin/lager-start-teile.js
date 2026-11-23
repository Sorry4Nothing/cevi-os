import { anfrage } from "./api.js";
import { ankreuzen, el } from "./dom.js";
import {
  istVersionKonflikt,
  konfliktHinweis,
  schreibFehlertext,
} from "./lager-konflikt.js";

// Bausteine für «Heute», «Meine Woche» und den Start (#672): Aufgaben, Höcks, Schichten und Datum. Die Daten kommen aus GET /api/v1/lager/{id}/heute, /meine-woche und /start.

export const STATUS_TEXT = {
  offen: "Offen",
  laeuft: "Läuft",
  wartet: "Wartet",
  erledigt: "Erledigt",
  naechster_hoeck: "Nächster Höck",
};

const tag = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const kurz = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  timeZone: "UTC",
});
// «Montag, 23. November 2026» aus «2026-11-23» (ohne Zeitzone: reines Datum)
export const datumLang = (iso) => tag.format(new Date(`${iso}T00:00:00Z`));
// «Mo., 23.11.»
export const datumKurzTag = (iso) => kurz.format(new Date(`${iso}T00:00:00Z`));

export const personName = (p) =>
  p?.name ? (p.ceviName ? `${p.ceviName} (${p.name})` : p.name) : null;

export const karte = (titel, ...inhalt) =>
  el(
    "section",
    { class: "flaeche" },
    el("h3", { class: "lg-kartentitel" }, titel),
    ...inhalt,
  );

export const werte = (paare) =>
  el(
    "dl",
    { class: "werte" },
    paare.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))),
  );
const leerListe = (text) => el("p", { class: "leise" }, text);

// Darf die Rolle den Status von Aufgaben setzen? Alle oder die eigenen; ein geschlossenes Lager nie
export const darfStatus = (lager) =>
  !lager.schreibgeschuetzt &&
  (lager.rechte.includes("aufgaben.bearbeiten") ||
    lager.rechte.includes("aufgaben.eigene"));

function fristChip(a, heute) {
  if (!a.frist || a.status === "erledigt") return null;
  const ueberfaellig = a.frist < heute;
  return el(
    "span",
    { class: ueberfaellig ? "chip chip--fehler" : "chip" },
    ueberfaellig
      ? `Überfällig seit ${datumKurzTag(a.frist)}`
      : datumKurzTag(a.frist),
  );
}

// Eine Zeile je Aufgabe mit Kästchen «erledigt». Der Status geht über PUT …/aufgaben/{id}/status mit der Version; bei 409 zeigt die Zeile den Stand des Servers und lässt wählen.
export function aufgabenListe({ aufgaben, lager, ctx, heute, leer }) {
  if (aufgaben.length === 0) return leerListe(leer);
  const darf = darfStatus(lager);
  const liste = el("ul", { class: "lg-liste" });
  for (const a of aufgaben) {
    const chipStatus = el("span", { class: "chip" }, STATUS_TEXT[a.status]);
    const frist = el("span", {});
    const zeile = el("li", { class: "lg-zeile lg-zeile--aufgabe" });
    const kasten = darf
      ? ankreuzen({
          label: a.titel,
          gewaehlt: a.status === "erledigt",
          wert: a.id,
        })
      : null;
    const zeichneRest = () => {
      chipStatus.textContent = STATUS_TEXT[a.status];
      frist.replaceChildren(fristChip(a, heute) ?? "");
    };
    zeichneRest();
    const setze = async (status, version) => {
      const neu = await anfrage(
        "PUT",
        `/api/v1/lager/${lager.id}/aufgaben/${a.id}/status`,
        { version, status },
      );
      a.version = neu.version;
      a.status = neu.status;
      if (kasten) kasten.eingabe.checked = a.status === "erledigt";
      zeichneRest();
    };
    if (kasten) {
      kasten.eingabe.addEventListener("change", async () => {
        const status = kasten.eingabe.checked ? "erledigt" : "offen";
        kasten.eingabe.disabled = true;
        try {
          await setze(status, a.version);
        } catch (f) {
          kasten.eingabe.checked = a.status === "erledigt";
          if (istVersionKonflikt(f)) {
            zeile.append(
              konfliktHinweis(f, {
                beschreibe: (s) =>
                  `«${s.titel}», Status ${STATUS_TEXT[s.status] ?? s.status}.`,
                meine: (aktuell) => setze(status, aktuell.version),
                server: (aktuell) => {
                  a.version = aktuell.version;
                  a.status = aktuell.status;
                  kasten.eingabe.checked = a.status === "erledigt";
                  zeichneRest();
                },
                beiFehler: (fehler) =>
                  ctx.melde(schreibFehlertext(fehler), "fehler"),
              }),
            );
          } else ctx.melde(schreibFehlertext(f), "fehler");
        } finally {
          kasten.eingabe.disabled = false;
        }
      });
    }
    zeile.prepend(
      el(
        "div",
        { class: "lg-zeile-text" },
        kasten ? kasten.wurzel : el("strong", {}, a.titel),
        el(
          "span",
          { class: "klein leise lg-zeile-meta" },
          [a.ressort?.kuerzel, personName(a.verantwortlich)]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
      chipStatus,
      frist,
    );
    liste.append(zeile);
  }
  return liste;
}

const ZEIT = (h) => (h.zeit ? `${h.zeit} · ` : "");
// Höcks: wer nur Team-Höcks lesen darf, bekommt nur Datum, Zeit, Titel und Ort
export function hoeckListe({ hoecks, mitDatum = false, leer }) {
  if (hoecks.length === 0) return leerListe(leer);
  return el(
    "ul",
    { class: "lg-liste" },
    hoecks.map((h) =>
      el(
        "li",
        { class: "lg-zeile" },
        mitDatum
          ? el("span", { class: "lg-datum" }, datumKurzTag(h.datum))
          : "",
        el(
          "div",
          { class: "lg-zeile-text" },
          el("strong", {}, h.titel),
          el(
            "span",
            { class: "klein leise lg-zeile-meta" },
            `${ZEIT(h)}${h.ort ?? "kein Ort"}`,
          ),
        ),
        h.art === "lagerleitung"
          ? el("span", { class: "chip" }, "Lagerleitung")
          : h.art === "team"
            ? el("span", { class: "chip" }, "Team")
            : "",
      ),
    ),
  );
}
