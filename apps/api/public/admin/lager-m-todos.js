import { ApiFehler, anfrage } from "./api.js";
import { ankreuzen, el, feld, knopf } from "./dom.js";
import { blitze, ersetzeMitBewegung, puls, zaehlZahl } from "./lager-anim.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";
import { feldFehler, symbol } from "./lager-gemeinsam.js";
import {
  API,
  fehlerText,
  geschlossenHinweis,
  istGeschlossen,
  ladeLagerMitRechten,
  rechteVon,
  skeletonTodos,
} from "./lager-aufgaben-gemeinsam.js";

// Modul «To-dos» des Lager-Arbeitsbereichs (#670): die privaten To-dos der eigenen Person. Jede Person im Lager führt ihre eigenen, auch mit der Rolle «Lesen»; niemand sonst sieht sie, auch die Lagerleitung nicht. Adresse: #lager/lager/<id>/todos. Der Server kennt keine Version (kein Konflikt), höchstens 200 To-dos je Person und Lager, Text bis 500 Zeichen.

const MAX = 200;

export function zeige(bereich, ctx, lagerId, lager) {
  let erstes = true;
  ctx.lade(
    async () => {
      const l = await ladeLagerMitRechten(lagerId, erstes ? lager : undefined);
      erstes = false;
      const r = await anfrage("GET", `${API(lagerId)}/todos`);
      return { lager: l, rechte: rechteVon(l), todos: r.todos };
    },
    (d, neu) => zeichne(bereich, ctx, lagerId, d, neu),
    { skeleton: () => skeletonTodos() },
  );
}

function zeichne(bereich, ctx, lagerId, d, neuLaden) {
  const T = {
    todos: [...d.todos].sort((a, b) => a.reihenfolge - b.reihenfolge),
    verborgen: new Set(),
  };
  const schreibbar = !d.rechte.zu;
  ctx.kopfAktion();

  const ort = el("div", { class: "la-todos" });
  const zahlOffen = zaehlZahl(0);
  const zahlGesamt = zaehlZahl(0);
  const zaehlzeile = el(
    "p",
    { class: "leise klein la-kennzahlen", role: "status" },
    zahlOffen,
    " offen von ",
    zahlGesamt,
  );
  const melde = (f) => {
    if (istGeschlossen(f)) neuLaden();
    ctx.melde(
      `Nicht gespeichert. ${fehlerText(f)}`,
      istGeschlossen(f) ? "warn" : "fehler",
    );
  };

  async function toggle(t, wert) {
    try {
      Object.assign(
        t,
        await anfrage("PATCH", `${API(lagerId)}/todos/${t.id}`, {
          erledigt: wert,
        }),
      );
    } catch (f) {
      melde(f);
    }
    zeichneListe();
    const k = ort.querySelector(`[data-id="${CSS.escape(t.id)}"]`);
    if (k) {
      blitze(k);
      puls(k.querySelector(".wahl"));
    }
  }
  function loesche(t) {
    ctx.mitRueckgaengig({
      text: `To-do «${t.text}» gelöscht`,
      erledigt: "Gelöscht.",
      ansicht: {
        weg: () => {
          T.verborgen.add(t.id);
          zeichneListe();
        },
        zurueck: () => {
          T.verborgen.delete(t.id);
          zeichneListe();
        },
      },
      ausfuehren: () => anfrage("DELETE", `${API(lagerId)}/todos/${t.id}`),
      danach: () => {
        T.todos = T.todos.filter((x) => x.id !== t.id);
        T.verborgen.delete(t.id);
        zeichneListe();
      },
      fehlertext: (f) => `Nicht gelöscht. ${fehlerText(f)}`,
    });
  }
  function bearbeite(t, zeileEl) {
    const f = feld({
      label: "To-do bearbeiten",
      wert: t.text,
      maxlength: 500,
      autocomplete: "off",
    });
    const ok = knopf("Speichern", { art: "haupt", klein: true });
    ok.type = "submit";
    const ab = knopf("Abbrechen", {
      art: "still",
      klein: true,
      onclick: () => zeichneListe(),
    });
    const form = el("form", { class: "la-punktform" }, f.wurzel, ok, ab);
    zeileEl.replaceChildren(form);
    f.eingabe.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = f.eingabe.value.trim();
      if (!text) return feldFehler(f, "Das To-do braucht einen Text.");
      try {
        Object.assign(
          t,
          await anfrage("PATCH", `${API(lagerId)}/todos/${t.id}`, { text }),
        );
        zeichneListe();
      } catch (fe) {
        melde(fe);
      }
    });
  }

  function zeile(t) {
    const k = ankreuzen({ label: t.text, gewaehlt: t.erledigt, wert: t.id });
    k.eingabe.disabled = !schreibbar;
    k.eingabe.addEventListener("change", () => toggle(t, k.eingabe.checked));
    return el(
      "div",
      { class: "la-punkt" },
      k.wurzel,
      schreibbar &&
        el(
          "span",
          { class: "la-punkt-knoepfe" },
          el(
            "button",
            {
              type: "button",
              class: "knopf knopf--rund",
              "aria-label": `To-do bearbeiten: ${t.text}`,
              onclick: (e) =>
                bearbeite(t, e.currentTarget.closest(".la-punkt")),
            },
            symbol("bearbeiten"),
          ),
          el(
            "button",
            {
              type: "button",
              class: "knopf knopf--rund",
              "aria-label": `To-do löschen: ${t.text}`,
              onclick: () => loesche(t),
            },
            symbol("papierkorb"),
          ),
        ),
    );
  }

  function zeichneListe() {
    const sichtbar = T.todos.filter((t) => !T.verborgen.has(t.id));
    const offen = sichtbar.filter((t) => !t.erledigt).length;
    if (sichtbar.length === 0) {
      ersetzeMitBewegung(
        ort,
        leerKarte(
          schreibbar
            ? "Noch keine To-dos. Schreibe unten das erste auf."
            : "Keine To-dos.",
        ),
      );
      return;
    }
    zahlOffen.setze(offen);
    zahlGesamt.setze(sichtbar.length);
    ersetzeMitBewegung(
      ort,
      zaehlzeile,
      schreibbar && sichtbar.length > 1
        ? sortierListe({
            beschriftung: "Meine To-dos",
            eintraege: sichtbar.map((t) => ({
              id: t.id,
              text: t.text,
              inhalt: zeile(t),
            })),
            mitRueckgaengig: ctx.mitRueckgaengig,
            aktionstext: "Reihenfolge der To-dos geändert",
            beiNeu: async (ids) => {
              try {
                // Die Stelle in der Liste ist die neue Reihenfolge; nur was wandert, wird geschrieben
                for (const [stelle, id] of ids.entries()) {
                  const t = T.todos.find((x) => x.id === id);
                  if (t && t.reihenfolge !== stelle)
                    Object.assign(
                      t,
                      await anfrage("PATCH", `${API(lagerId)}/todos/${id}`, {
                        reihenfolge: stelle,
                      }),
                    );
                }
                T.todos.sort((a, b) => a.reihenfolge - b.reihenfolge);
              } catch (f) {
                neuLaden();
                throw new Error(fehlerText(f), { cause: f });
              }
            },
          }).wurzel
        : el(
            "ul",
            { class: "la-liste" },
            sichtbar.map((t) => el("li", { "data-id": t.id }, zeile(t))),
          ),
    );
  }

  let neu = null;
  if (schreibbar) {
    const f = feld({
      label: "Neues To-do",
      maxlength: 500,
      autocomplete: "off",
    });
    const ok = knopf("Hinzufügen", {
      symbol: "plus",
      art: "haupt",
      klein: true,
    });
    ok.type = "submit";
    neu = el(
      "form",
      { class: "la-punktform la-neu", novalidate: true },
      f.wurzel,
      ok,
    );
    neu.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = f.eingabe.value.trim();
      if (!text) return feldFehler(f, "Schreibe das To-do auf.");
      if (T.todos.length >= MAX)
        return feldFehler(
          f,
          "Du hast die höchste Zahl an To-dos erreicht. Lösche zuerst eines.",
        );
      ok.disabled = true;
      try {
        T.todos.push(await anfrage("POST", `${API(lagerId)}/todos`, { text }));
        f.eingabe.value = "";
        zeichneListe();
        f.eingabe.focus();
      } catch (fe) {
        if (fe instanceof ApiFehler && fe.code === "LIMIT_ERREICHT")
          feldFehler(f, fehlerText(fe));
        else melde(fe);
      } finally {
        ok.disabled = false;
      }
    });
  }

  bereich.append(
    ...[
      d.rechte.zu && geschlossenHinweis(),
      el(
        "p",
        { class: "leise" },
        "Nur du siehst diese To-dos. Die Lagerleitung sieht sie nicht, und sie erscheinen in keiner Liste des Lagers.",
      ),
      ort,
      neu,
    ].filter(Boolean),
  );
  zeichneListe();
}
