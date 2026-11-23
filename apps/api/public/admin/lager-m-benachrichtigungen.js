import { anfrage } from "./api.js";
import { el, icon, knopf } from "./dom.js";
import { skeletonListe } from "./lader.js";
import { ADRESSE, meldung } from "./lager-gemeinsam.js";
import { MODULE } from "./lager-module.js";
import { leerKarte } from "./zustaende.js";

// Modul «Benachrichtigungen» (#672): die Glocke des Lagers (GET /api/v1/lager/{id}/benachrichtigungen, neueste zuerst; jede Person liest nur ihre eigenen) und die Schalter je Art (GET/PUT /api/v1/ich/lager-benachrichtigungen, sie gelten für alle Lager und für Liste und Push). Die Zeile trägt keinen Text, nur Art und Ziel; der Inhalt steht im Modul des Ziels.

// Feste Texte wie die Pushes (lager/benachrichtigung-arten.ts); eine unbekannte Art zeigt ihren Schlüssel
export const ARTEN = {
  aufgabe_zugeteilt: "Neue Aufgabe für dich",
  aufgabe_geaendert: "Aufgabe geändert",
  erwaehnung: "Du wurdest erwähnt",
  frist: "Eine Frist rückt näher",
  pinnwand_wichtig: "Wichtige Mitteilung",
  eingang_antwort: "Antwort auf deine Nachricht",
  diensttausch_anfrage: "Neue Diensttausch-Anfrage",
  diensttausch_entscheid: "Diensttausch entschieden",
  anwesenheit_anfrage: "Neue Anwesenheits-Anfrage",
  anwesenheit_entscheid: "Deine Anwesenheits-Anfrage wurde entschieden",
  adressbuch_aufraeumen: "Das Adressbuch wird bald aufgeräumt",
};

// Ziel nach objektTyp: das Modul, das es zeigt (nur wenn es im Register steht)
const ZIEL = {
  aufgabe: "aufgaben",
  adressbuch: "adressbuch",
  anwesenheit_anfrage: "anwesenheit",
  diensttausch: "diensttausch",
  eingang: "eingang",
  pinnwand_beitrag: "pinnwand",
  traktandum: "hoecks",
  protokoll: "protokolle",
};

// Reine Funktion (testbar): Adresse des Ziels oder null
export function zielAdresse(lagerId, eintrag, schluessel) {
  const modul = ZIEL[eintrag.objektTyp];
  if (!modul || !schluessel.includes(modul)) return null;
  return modul === "adressbuch"
    ? `${ADRESSE}/${lagerId}/${modul}`
    : `${ADRESSE}/${lagerId}/${modul}/${eintrag.objektId}`;
}

const zeitpunkt = (iso) =>
  new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

function einstellungen(ctx, daten) {
  const zustand = new Map(daten.arten.map((a) => [a.art, a.aktiv]));
  const liste = el("ul", { class: "lg-liste" });
  const status = el("p", { class: "nur-leser", role: "status" });
  for (const a of daten.arten) {
    const labelId = `lg-bn-${a.art}`;
    const schalter = el("button", {
      type: "button",
      class: "schalter",
      role: "switch",
      "aria-checked": String(a.aktiv),
      "aria-labelledby": labelId,
      onclick: async () => {
        const neu = !zustand.get(a.art);
        schalter.disabled = true;
        try {
          await anfrage("PUT", "/api/v1/ich/lager-benachrichtigungen", {
            arten: [{ art: a.art, aktiv: neu }],
          });
          zustand.set(a.art, neu);
          schalter.setAttribute("aria-checked", String(neu));
          status.textContent = `${ARTEN[a.art] ?? a.art}: ${neu ? "an" : "aus"}.`;
        } catch (f) {
          ctx.melde(meldung(f), "fehler");
        } finally {
          schalter.disabled = false;
        }
      },
    });
    liste.append(
      el(
        "li",
        { class: "schalterzeile" },
        el("span", { id: labelId }, ARTEN[a.art] ?? a.art),
        schalter,
      ),
    );
  }
  return el(
    "section",
    { class: "flaeche" },
    el("h3", { class: "lg-kartentitel" }, "Was du bekommst"),
    el(
      "p",
      { class: "klein leise" },
      "Die Schalter gelten für alle deine Lager, für die Liste und für Push.",
    ),
    liste,
    status,
  );
}

export function zeige(bereich, ctx, id) {
  ctx.titel("Benachrichtigungen", "Was dich im Lager betrifft.");
  const sichtbar = MODULE.map((m) => m.schluessel);
  const basis = `/api/v1/lager/${id}/benachrichtigungen`;
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", basis),
        anfrage("GET", "/api/v1/ich/lager-benachrichtigungen"),
      ]),
    ([erste, einst], neu) => {
      let eintraege = [...erste.eintraege];
      let naechster = erste.naechster;
      const liste = el("ul", { class: "lg-liste" });
      const mehr = el("div", { class: "lg-fuss" });
      const zeile = (e) => {
        const adresse = zielAdresse(id, e, sichtbar);
        const text = ARTEN[e.art] ?? e.art;
        return el(
          "li",
          { class: "lg-zeile" },
          e.gelesen
            ? el("span", { class: "chip" }, "Gelesen")
            : el("span", { class: "chip chip--warn" }, icon("glocke"), "Neu"),
          el(
            "div",
            { class: "lg-zeile-text" },
            adresse ? el("a", { href: adresse }, text) : el("strong", {}, text),
            el(
              "span",
              { class: "klein leise lg-zeile-meta" },
              zeitpunkt(e.erstelltAm),
            ),
          ),
        );
      };
      const zeichne = () => {
        liste.replaceChildren(...eintraege.map(zeile));
        mehr.replaceChildren(
          ...(naechster
            ? [
                knopf("Ältere laden", {
                  onclick: async () => {
                    try {
                      const s = await anfrage(
                        "GET",
                        `${basis}?nach=${naechster}`,
                      );
                      eintraege = [...eintraege, ...s.eintraege];
                      naechster = s.naechster;
                      zeichne();
                    } catch (f) {
                      ctx.melde(meldung(f), "fehler");
                    }
                  },
                }),
              ]
            : []),
        );
      };
      const ungelesen = () => eintraege.filter((e) => !e.gelesen).length;
      const alleLesen = knopf("Alle als gelesen markieren", {
        symbol: "haken",
        onclick: async () => {
          alleLesen.disabled = true;
          try {
            await anfrage("POST", `${basis}/gelesen`, {});
            neu();
          } catch (f) {
            alleLesen.disabled = false;
            ctx.melde(meldung(f), "fehler");
          }
        },
      });
      alleLesen.hidden = ungelesen() === 0;
      zeichne();
      bereich.append(
        el(
          "section",
          { class: "flaeche" },
          el(
            "div",
            { class: "lg-kopfzeile" },
            el("h3", { class: "lg-kartentitel" }, "Eingang"),
            alleLesen,
          ),
          eintraege.length === 0
            ? leerKarte("Du hast keine Benachrichtigung in diesem Lager.")
            : liste,
          mehr,
        ),
        einstellungen(ctx, einst),
      );
    },
    { skeleton: () => skeletonListe({ zeilen: 5 }) },
  );
}
