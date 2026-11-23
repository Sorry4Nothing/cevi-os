import { anfrage } from "./api.js";
import { el, filterGruppe, icon, knopf } from "./dom.js";
import { skeletonVon } from "./lager-skeleton.js";
import { leerKarte } from "./zustaende.js";
import { nichtGefunden } from "./lager-gemeinsam.js";
import { MODULE } from "./lager-module.js";
import {
  adresse,
  alleSeiten,
  basis,
  darfSchreiben,
  holeLager,
  meldung,
  restPfad,
  zeitpunkt,
  kinder,
} from "./lager-sm-gemeinsam.js";

// Modul «Erwähnungen» im Lager-Arbeitsbereich (#673): Wo dich jemand mit «@» genannt hat, in einer Aufgabe, einem Traktandum, einem Pinnwand-Beitrag oder einem Beschluss. Du siehst nur deine eigenen Erwähnungen und nur Inhalte, die du lesen darfst. Du hakst sie ab, machst eine Aufgabe oder ein Traktandum daraus. Adresse: …/erwaehnungen. Der Inhalt selbst steht nur im Modul, das ihn zeigt.

const QUELLEN = {
  aufgabe: { text: "Aufgabe", modul: "aufgaben" },
  traktandum: { text: "Traktandum", modul: "hoecks" },
  pinnwand: { text: "Pinnwand", modul: "pinnwand" },
  beschluss: { text: "Beschluss", modul: "protokolle", unter: "beschluesse" },
};

export function zeige(bereich, ctx, lagerId, lagerRoh) {
  if (restPfad(ctx, lagerId).length > 0)
    return ctx.lade(nichtGefunden, () => {});
  ctx.lade(
    async () => {
      const lager = await holeLager(lagerId, lagerRoh);
      return {
        lager,
        liste: await alleSeiten(
          `${basis(lagerId)}/erwaehnungen`,
          "erwaehnungen",
          {
            limit: 100,
          },
        ),
      };
    },
    (d) => zeichne(bereich, ctx, lagerId, d),
    { skeleton: skeletonVon({ reiter: 3, inhalt: "liste", zeilen: 4 }) },
  );
}

// Gibt es das Modul im Arbeitsbereich (die anderen Agenten fügen ihre Zeilen später ein)?
const hatModul = (schluessel) =>
  MODULE.some((m) => m.schluessel === schluessel);

function zeichne(bereich, ctx, lagerId, { lager, liste }) {
  const offen = liste.filter((e) => !e.erledigt);
  let wahl = offen.length > 0 || liste.length === 0 ? "offen" : "alle";
  const filter = filterGruppe({
    beschriftung: "Erwähnungen anzeigen",
    wert: wahl,
    eintraege: [
      { text: "Offen", n: offen.length, wert: "offen" },
      { text: "Erledigt", n: liste.length - offen.length, wert: "erledigt" },
      { text: "Alle", n: liste.length, wert: "alle" },
    ],
    beiAenderung: (w) => {
      wahl = w;
      zeichneListe();
    },
  });
  const ort = el("div", { class: "lg-sm-inhalt" });
  function zeichneListe() {
    const sichtbar = liste.filter(
      (e) => wahl === "alle" || (wahl === "offen") === !e.erledigt,
    );
    ort.replaceChildren(
      ...kinder(
        sichtbar.length === 0
          ? leerKarte(
              liste.length === 0
                ? "Niemand hat dich bisher erwähnt."
                : wahl === "offen"
                  ? "Nichts offen. Alles abgehakt."
                  : "Nichts in dieser Ansicht.",
            )
          : el(
              "ul",
              { class: "lg-sm-karten", "aria-label": "Erwähnungen" },
              sichtbar.map((e) =>
                karte({ ctx, lagerId, lager, e, zeichneNeu: zeichneListe }),
              ),
            ),
      ),
    );
  }
  bereich.append(
    ...kinder(
      el(
        "p",
        { class: "leise" },
        "Hier stehen die Stellen, an denen dich jemand mit «@» genannt hat. Den Inhalt öffnest du beim Modul dahinter.",
      ),
      filter.wurzel,
      ort,
    ),
  );
  zeichneListe();
}

function karte({ ctx, lagerId, lager, e, zeichneNeu }) {
  const quelle = QUELLEN[e.quelleTyp] ?? { text: e.quelleTyp };
  const aufgabeOk = darfSchreiben(
    lager,
    "aufgaben.bearbeiten",
    "aufgaben.eigene",
  );
  const traktandumOk = darfSchreiben(lager, "hoecks.bearbeiten");
  const wurzel = el("li", { class: "flaeche lg-sm-erwaehnung" });
  const fehler = (f) => ctx.melde(meldung(f), "fehler");
  async function erledigen() {
    try {
      const r = await anfrage(
        "PATCH",
        `${basis(lagerId)}/erwaehnungen/${e.id}`,
        {
          erledigt: !e.erledigt,
        },
      );
      e.erledigt = r.erledigt;
      ctx.melde(e.erledigt ? "Abgehakt." : "Wieder offen.");
      zeichneNeu();
    } catch (f) {
      fehler(f);
    }
  }
  async function alsAufgabe() {
    try {
      const r = await anfrage(
        "POST",
        `${basis(lagerId)}/erwaehnungen/${e.id}/als-aufgabe`,
        {},
      );
      e.aufgabeId = r.aufgabeId;
      ctx.melde("Aufgabe angelegt.");
      zeichneNeu();
    } catch (f) {
      fehler(f);
    }
  }
  async function aufgabeZurueck() {
    try {
      await anfrage(
        "DELETE",
        `${basis(lagerId)}/erwaehnungen/${e.id}/als-aufgabe`,
      );
      e.aufgabeId = null;
      ctx.melde("Aufgabe zurückgenommen.");
      zeichneNeu();
    } catch (f) {
      fehler(f);
    }
  }
  async function alsTraktandum() {
    try {
      await anfrage("POST", `${basis(lagerId)}/traktanden`, {
        titel: e.titel,
        hoeckId: null,
      });
      ctx.melde(
        "Traktandum angelegt. Es steht bei den Punkten für den nächsten Höck.",
      );
    } catch (f) {
      fehler(f);
    }
  }
  wurzel.append(
    ...kinder(
      el(
        "div",
        { class: "lg-sm-trakt-kopf" },
        el("span", { class: "fett" }, e.titel),
        el("span", { class: "chip" }, quelle.text),
        e.erledigt &&
          el("span", { class: "chip chip--ok" }, icon("haken"), "Erledigt"),
        e.aufgabeId && el("span", { class: "chip" }, "Aufgabe angelegt"),
      ),
      el("p", { class: "klein leise" }, zeitpunkt(e.erstelltAm)),
      el(
        "div",
        { class: "aktionen lg-sm-aktionen" },
        knopf(e.erledigt ? "Wieder öffnen" : "Abhaken", {
          klein: true,
          kontext: e.titel,
          onclick: erledigen,
        }),
        aufgabeOk &&
          (e.aufgabeId
            ? knopf("Aufgabe zurücknehmen", {
                klein: true,
                art: "still",
                kontext: e.titel,
                onclick: aufgabeZurueck,
              })
            : knopf("Als Aufgabe", {
                klein: true,
                kontext: e.titel,
                onclick: alsAufgabe,
              })),
        traktandumOk &&
          knopf("Als Traktandum", {
            klein: true,
            kontext: e.titel,
            onclick: alsTraktandum,
          }),
        quelle.modul &&
          hatModul(quelle.modul) &&
          el(
            "a",
            {
              class: "knopf knopf--klein knopf--still",
              href: adresse(
                lagerId,
                quelle.modul,
                ...(quelle.unter ? [quelle.unter] : []),
              ),
              "aria-label": `${quelle.text} öffnen: ${e.titel}`,
            },
            `${quelle.text} öffnen`,
          ),
      ),
    ),
  );
  return wurzel;
}
