import { anfrage } from "./api.js";
import { auswahl, el, icon, knopf } from "./dom.js";
import { ADRESSE, meldung } from "./lager-gemeinsam.js";
import { MODULE, suchbegriff } from "./lager-module.js";

// Modul «Suche» (#672): Volltextsuche über alle Module des Lagers. GET /api/v1/lager/{id}/suche?q=&typ=; der Server liefert nur, was die Rolle auch in den Listen sieht (höchstens 50 Treffer, 30 Suchen je Minute). Der Suchbegriff steht nie in der Adresse: Er kann einen Namen enthalten.

// Art des Treffers: Beschriftung und das Modul, das ihn öffnet (nur wenn es im Register steht und die Person es sieht)
const ARTEN = {
  adressbuch: ["Adressbuch", "adressbuch"],
  aufgabe: ["Aufgabe", "aufgaben"],
  beschluss: ["Beschluss", "hoecks"],
  dienst: ["Dienst", "schichtplan"],
  dokument: ["Dokument", "dokumente"],
  eingang: ["Eingang", "eingang"],
  einkauf: ["Einkauf", "einkauf"],
  fahrt: ["Fahrt", "fahrten"],
  gruppe: ["Gruppe", "gruppen"],
  hoeck: ["Höck", "hoecks"],
  info: ["Info", "infos"],
  meilenstein: ["Meilenstein", "zeitplan"],
  notfall: ["Notfall", "notfall"],
  packliste: ["Packliste", "packliste"],
  pinnwand: ["Pinnwand", "pinnwand"],
  protokoll: ["Protokoll", "protokolle"],
  ressort: ["Ressort", "ressorts"],
  tagesseite: ["Tagesseite", "tagesseiten"],
  teilnehmer: ["Teilnehmende", "teilnehmer"],
  traktandum: ["Traktandum", "hoecks"],
  zimmer: ["Zimmer", "zimmer"],
};

// Reine Funktion (testbar): Adresse des Treffers oder null, wenn kein sichtbares Modul ihn zeigt
export function trefferAdresse(lagerId, treffer, sichtbareSchluessel) {
  const modul = ARTEN[treffer.typ]?.[1];
  if (!modul || !sichtbareSchluessel.includes(modul)) return null;
  return `${ADRESSE}/${lagerId}/${modul}/${treffer.id}`;
}

export function zeige(bereich, ctx, id, lager) {
  ctx.titel(
    "Suche",
    "Findet Titel, Namen und Texte in allen Bereichen, die du lesen darfst.",
  );
  // Die Module, die es gibt und die diese Rolle sieht
  const rechte = new Set(lager.rechte);
  const sichtbar = MODULE.filter(
    (m) => !m.recht || m.recht.split("|").some((r) => rechte.has(r)),
  ).map((m) => m.schluessel);
  const feldId = "lg-suche-frage";
  const eingabe = el("input", {
    class: "eingabe",
    id: feldId,
    type: "search",
    maxlength: 100,
    autocomplete: "off",
    placeholder: "Wonach suchst du?",
    value: suchbegriff.frage,
  });
  const art = auswahl({
    label: "Bereich",
    optionen: [
      ["", "Alle Bereiche"],
      ...Object.entries(ARTEN)
        .sort((a, b) => a[1][0].localeCompare(b[1][0], "de-CH"))
        .map(([typ, [text]]) => [typ, text]),
    ],
    wert: "",
  });
  const status = el("p", { class: "klein leise", role: "status" });
  const ergebnis = el("ul", { class: "lg-liste lg-treffer" });
  const fehler = el("p", { class: "feld-fehler", role: "alert", hidden: true });
  let lauf = 0;

  async function suche() {
    const frage = eingabe.value.trim();
    suchbegriff.frage = frage;
    fehler.hidden = true;
    if (frage.length < 2) {
      ergebnis.replaceChildren();
      status.textContent = "";
      fehler.textContent = "Gib mindestens zwei Zeichen ein.";
      fehler.hidden = false;
      eingabe.focus();
      return;
    }
    const meine = ++lauf;
    status.textContent = "Suche läuft …";
    const abfrage = new URLSearchParams({ q: frage });
    if (art.eingabe.value) abfrage.set("typ", art.eingabe.value);
    try {
      const { treffer } = await anfrage(
        "GET",
        `/api/v1/lager/${id}/suche?${abfrage}`,
      );
      if (meine !== lauf) return;
      ergebnis.replaceChildren(
        ...treffer.map((t) => {
          const adresse = trefferAdresse(id, t, sichtbar);
          const titel = adresse
            ? el("a", { href: adresse }, t.titel)
            : el("strong", {}, t.titel);
          return el(
            "li",
            { class: "lg-zeile" },
            el("span", { class: "chip" }, ARTEN[t.typ]?.[0] ?? t.typ),
            el(
              "div",
              { class: "lg-zeile-text" },
              titel,
              t.auszug
                ? el("span", { class: "klein leise lg-zeile-meta" }, t.auszug)
                : "",
            ),
          );
        }),
      );
      status.textContent =
        treffer.length === 0
          ? "Keine Treffer. Versuche ein anderes Wort."
          : treffer.length === 1
            ? "1 Treffer."
            : `${treffer.length} Treffer.`;
    } catch (f) {
      if (meine !== lauf) return;
      status.textContent = "";
      fehler.textContent =
        f?.status === 429 ? "Zu viele Suchen. Warte eine Minute." : meldung(f);
      fehler.hidden = false;
    }
  }

  const absenden = knopf("Suchen", { art: "haupt", symbol: "lupe" });
  absenden.type = "submit";
  bereich.append(
    el(
      "form",
      {
        class: "lg-suchformular",
        role: "search",
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          suche();
        },
      },
      el(
        "div",
        { class: "feld" },
        el("label", { for: feldId }, "Suchtext"),
        el("div", { class: "suche suche--voll" }, icon("lupe"), eingabe),
      ),
      art.wurzel,
      absenden,
    ),
    fehler,
    status,
    ergebnis,
  );
  if (suchbegriff.frage.length >= 2) suche();
  eingabe.focus();
}
