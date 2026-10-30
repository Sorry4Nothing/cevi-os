import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  bestaetigen,
  chip,
  el,
  knopf,
  menue,
  tabelle,
  zeit,
} from "./dom.js";

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/admin/meldungen"),
    (seite) => zeichne(bereich, ctx, seite),
  );
}

function chatName(chat) {
  return `${chat.typ === "stufe" ? "Gruppenchat" : "Einzelchat"} ${chat.stufe.name}`;
}

function zeichne(bereich, ctx, erste) {
  let eintraege = [...erste.meldungen];
  let naechster = erste.naechster;
  const { wurzel: tabellenRahmen, koerper } = tabelle({
    beschriftung: "Offene Meldungen",
    spalten: [
      "Gemeldet am",
      "Gemeldeter Text",
      "Chat",
      "Gemeldet von",
      "Verfasst von",
      "Status",
      "Aktionen",
    ],
    zeilen: [],
  });
  const leer = el("p", { class: "leer" }, "Keine offenen Meldungen.");
  const mehr = knopf("Ältere laden", {
    onclick: async () => {
      mehr.disabled = true;
      try {
        const seite = await anfrage(
          "GET",
          `/api/v1/admin/meldungen?vor=${encodeURIComponent(naechster)}`,
        );
        eintraege.push(...seite.meldungen);
        naechster = seite.naechster;
        zeichneListe();
      } catch (fehler) {
        ctx.melde(fehlertext(fehler), "fehler");
      } finally {
        mehr.disabled = false;
      }
    },
  });

  function zeile(m) {
    const autor = m.autor ? m.autor.name : "gelöschtes Konto";
    const status = [
      m.ausgeblendet && chip("Ausgeblendet", "warn"),
      m.autor?.deaktiviert && chip("Konto deaktiviert", "fehler"),
      !m.chat && chip("Nachricht gelöscht", "fehler"),
    ].filter(Boolean);
    return el(
      "tr",
      {},
      el("th", { scope: "row" }, zeit(m.erstelltAm)),
      el(
        "td",
        { class: "breit" },
        m.text === null
          ? el("span", { class: "leise" }, "Die Kopie des Textes ist gelöscht.")
          : el("blockquote", { class: "zitat" }, m.text),
      ),
      el(
        "td",
        {},
        m.chat
          ? el("ul", { class: "chips" }, chip(chatName(m.chat), "stufe"))
          : el("span", { class: "leise" }, "–"),
      ),
      el("td", {}, m.gemeldetVon ?? "gelöschtes Konto"),
      el("td", {}, autor),
      el(
        "td",
        {},
        status.length > 0
          ? el("ul", { class: "chips" }, status)
          : el("span", { class: "leise" }, "–"),
      ),
      aktionenZelle(
        knopf("Erledigt", {
          art: "haupt",
          klein: true,
          kontext: `Meldung vom ${zeit(m.erstelltAm)}`,
          onclick: () =>
            bestaetigen({
              titel: "Meldung erledigen",
              beschreibung:
                "Die Kopie des gemeldeten Textes wird dabei gelöscht.",
              ok: "Erledigt",
              gefaehrlich: false,
              aktion: () =>
                anfrage("PATCH", `/api/v1/admin/meldungen/${m.id}`, {
                  erledigt: true,
                }),
              danach: () => {
                eintraege = eintraege.filter((e) => e.id !== m.id);
                zeichneListe();
                ctx.melde("Die Meldung ist erledigt.");
              },
            }),
        }),
        menue(`Meldung vom ${zeit(m.erstelltAm)}`, [
          m.nachrichtId &&
            !m.ausgeblendet && {
              text: "Ausblenden",
              onclick: () =>
                bestaetigen({
                  titel: "Nachricht ausblenden",
                  beschreibung:
                    "Die Nachricht verschwindet für alle ausser der Autorin oder dem Autor.",
                  ok: "Ausblenden",
                  aktion: () =>
                    anfrage(
                      "POST",
                      `/api/v1/nachrichten/${m.nachrichtId}/ausblenden`,
                    ),
                  danach: () => {
                    for (const e of eintraege) {
                      if (e.nachrichtId === m.nachrichtId)
                        e.ausgeblendet = true;
                    }
                    zeichneListe();
                    ctx.melde("Die Nachricht ist ausgeblendet.");
                  },
                }),
            },
          m.autor &&
            !m.autor.deaktiviert &&
            m.autor.id !== ctx.ich.id && {
              text: "Person deaktivieren",
              gefaehrlich: true,
              onclick: () =>
                bestaetigen({
                  titel: "Person deaktivieren",
                  beschreibung: `«${m.autor.name}» kann sich nicht mehr anmelden und wird überall abgemeldet.`,
                  ok: "Deaktivieren",
                  aktion: () =>
                    anfrage(
                      "POST",
                      `/api/v1/admin/personen/${m.autor.id}/deaktivieren`,
                    ),
                  danach: () => {
                    for (const e of eintraege) {
                      if (e.autor?.id === m.autor.id)
                        e.autor.deaktiviert = true;
                    }
                    zeichneListe();
                    ctx.melde(`«${m.autor.name}» ist deaktiviert.`);
                  },
                }),
            },
        ]),
      ),
    );
  }

  function zeichneListe() {
    koerper.replaceChildren(...eintraege.map(zeile));
    leer.hidden = eintraege.length > 0;
    tabellenRahmen.hidden = eintraege.length === 0;
    mehr.hidden = naechster === null;
  }

  zeichneListe();
  bereich.append(
    el(
      "p",
      { class: "hilfe" },
      "Offene Meldungen, neueste zuerst. Meldungen über deine eigenen Beiträge siehst du nicht.",
    ),
    leer,
    tabellenRahmen,
    el("div", { class: "aktionen aktionen--unten" }, mehr),
  );
}
