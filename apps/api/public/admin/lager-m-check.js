import { anfrage } from "./api.js";
import { ankreuzen, el, feld, icon, knopf } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { ansichtVon } from "./rueckgaengig.js";
import { datumKurzTag, karte } from "./lager-start-teile.js";
import {
  istVersionKonflikt,
  konfliktHinweis,
  schreibFehlertext,
} from "./lager-konflikt.js";

// Modul «Sind wir bereit?» (#672): der Lager-Check. GET /api/v1/lager/{id}/check rechnet bei jeder Anfrage aus den Daten des Lagers (Gesamtstand und je Prüfer Hinweise mit Beispielen); die eigenen Punkte der Lagerleitung liegen unter /check/punkte. Ein Prüfer ohne lesbare Quelle fehlt im Ergebnis.

const STAND = {
  bereit: ["Bereit", "chip chip--ok", "haken"],
  hinweise: ["Mit Hinweisen", "chip chip--warn", "warnung"],
  offen: ["Nicht bereit", "chip chip--fehler", "sperre"],
};
const SCHWERE = {
  offen: ["Offen", "chip chip--fehler", "sperre"],
  hinweis: ["Hinweis", "chip chip--warn", "warnung"],
};
const GESAMT = {
  bereit: "Alles bereit. Es gibt nichts Offenes.",
  hinweise: "Das Lager ist bereit, mit einigen Hinweisen.",
  offen: "Das Lager ist noch nicht bereit. Es gibt Offenes.",
};

const zustandChip = ([text, klasse, symbolName]) =>
  el("span", { class: klasse }, icon(symbolName), text);

function hinweisZeile(h) {
  return el(
    "li",
    { class: "lg-zeile lg-zeile--hinweis" },
    zustandChip(SCHWERE[h.schwere]),
    el(
      "div",
      { class: "lg-zeile-text" },
      el("span", {}, h.text),
      h.beispiele?.length
        ? el(
            "ul",
            { class: "lg-beispiele klein leise" },
            h.beispiele.map((b) =>
              el(
                "li",
                {},
                [
                  b.titel,
                  b.datum ? datumKurzTag(b.datum) : null,
                  b.offeneAufgaben
                    ? `${b.offeneAufgaben} offene ${b.offeneAufgaben === 1 ? "Aufgabe" : "Aufgaben"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
            ),
          )
        : "",
    ),
  );
}

function prueferKarte(p) {
  return karte(
    p.titel,
    el("p", {}, zustandChip(STAND[p.stand])),
    p.hinweise.length === 0
      ? el("p", { class: "leise" }, "Hier gibt es nichts zu tun.")
      : el("ul", { class: "lg-liste" }, p.hinweise.map(hinweisZeile)),
  );
}

// Eigene Punkte: Kästchen, Titel, Löschen mit «Rückgängig»; Anlegen unten. Ändern darf, wer zeitplan.bearbeiten hat.
function punkteKarte(ctx, lager, punkte, neu) {
  const darf =
    !lager.schreibgeschuetzt && lager.rechte.includes("zeitplan.bearbeiten");
  const liste = el("ul", { class: "lg-liste" });
  const basis = `/api/v1/lager/${lager.id}/check/punkte`;
  const zeichne = (p) => {
    const zeile = el("li", { class: "lg-zeile" });
    const kasten = ankreuzen({
      label: p.titel,
      gewaehlt: p.erledigt,
      wert: p.id,
    });
    kasten.eingabe.disabled = !darf;
    const setze = async (erledigt, version) => {
      const r = await anfrage("PATCH", `${basis}/${p.id}`, {
        version,
        erledigt,
      });
      p.version = r.version;
      p.erledigt = r.erledigt;
      kasten.eingabe.checked = p.erledigt;
    };
    kasten.eingabe.addEventListener("change", async () => {
      const erledigt = kasten.eingabe.checked;
      kasten.eingabe.disabled = true;
      try {
        await setze(erledigt, p.version);
      } catch (f) {
        kasten.eingabe.checked = p.erledigt;
        if (istVersionKonflikt(f))
          zeile.append(
            konfliktHinweis(f, {
              beschreibe: (s) =>
                `«${s.titel}», ${s.erledigt ? "erledigt" : "offen"}.`,
              meine: (aktuell) => setze(erledigt, aktuell.version),
              server: (aktuell) => {
                p.version = aktuell.version;
                p.erledigt = aktuell.erledigt;
                kasten.eingabe.checked = p.erledigt;
              },
              beiFehler: (e) => ctx.melde(schreibFehlertext(e), "fehler"),
            }),
          );
        else ctx.melde(schreibFehlertext(f), "fehler");
      } finally {
        kasten.eingabe.disabled = !darf;
      }
    });
    zeile.append(el("div", { class: "lg-zeile-text" }, kasten.wurzel));
    if (darf) {
      const weg = knopf("Löschen", {
        klein: true,
        symbol: "papierkorb",
        onclick: () =>
          ctx.mitRueckgaengig({
            text: `«${p.titel}» ist gelöscht`,
            ansicht: ansichtVon(zeile),
            ausfuehren: () =>
              anfrage("DELETE", `${basis}/${p.id}?version=${p.version}`),
            fehlertext: schreibFehlertext,
            danach: neu,
          }),
      });
      weg.setAttribute("aria-label", `«${p.titel}» löschen`);
      zeile.append(weg);
    }
    return zeile;
  };
  const leer = el(
    "p",
    { class: "leise" },
    "Du hast noch keine eigenen Punkte.",
  );
  const zeigeLeer = () => (leer.hidden = liste.children.length > 0);
  liste.append(...punkte.map(zeichne));
  zeigeLeer();
  let anlegen = "";
  if (darf) {
    const titel = feld({
      label: "Neuer Punkt",
      maxlength: 200,
      autocomplete: "off",
    });
    const fehler = el("p", {
      class: "feld-fehler",
      role: "alert",
      hidden: true,
    });
    const k = knopf("Punkt hinzufügen", { art: "haupt", symbol: "plus" });
    k.type = "submit";
    anlegen = el(
      "form",
      {
        class: "lg-anlegen",
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const text = titel.eingabe.value.trim();
          fehler.hidden = true;
          if (text === "") {
            fehler.textContent =
              "Schreibe, was vor dem Lager erledigt sein muss.";
            fehler.hidden = false;
            titel.eingabe.focus();
            return;
          }
          k.disabled = true;
          try {
            const p = await anfrage("POST", basis, { titel: text });
            liste.append(zeichne(p));
            titel.eingabe.value = "";
            zeigeLeer();
            titel.eingabe.focus();
          } catch (f) {
            fehler.textContent = schreibFehlertext(f);
            fehler.hidden = false;
          } finally {
            k.disabled = false;
          }
        },
      },
      titel.wurzel,
      fehler,
      k,
    );
  }
  return karte("Eigene Punkte", leer, liste, anlegen);
}

export function zeige(bereich, ctx, id, lager) {
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `/api/v1/lager/${id}/check`),
        anfrage("GET", `/api/v1/lager/${id}/check/punkte`),
      ]),
    ([check, { punkte }], neu) => {
      ctx.titel(
        "Sind wir bereit?",
        "Der Stand wird bei jedem Öffnen aus den Daten des Lagers gerechnet.",
      );
      bereich.append(
        el(
          "div",
          { class: "flaeche lg-gesamt", role: "status" },
          el("p", {}, zustandChip(STAND[check.stand])),
          el("p", { class: "lg-gesamt-text" }, GESAMT[check.stand]),
        ),
        el("div", { class: "lg-kacheln" }, [
          ...check.pruefer.filter((p) => p.id !== "eigene").map(prueferKarte),
          punkteKarte(ctx, lager, punkte, neu),
        ]),
      );
    },
    {
      skeleton: () =>
        el(
          "div",
          { class: "lg-kacheln" },
          [0, 1, 2].map(() => skeletonFlaeche({ zeilen: 3 })),
        ),
    },
  );
}
