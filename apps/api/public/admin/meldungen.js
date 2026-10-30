import { anfrage, fehlertext } from "./api.js";
import { bestaetigen, chip, el, knopf, zeit } from "./dom.js";

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
  const liste = el("ul", { class: "liste", "aria-label": "Offene Meldungen" });
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

  function karte(m) {
    const chips = [
      m.chat && chip(chatName(m.chat), "stufe"),
      m.ausgeblendet && chip("Ausgeblendet", "warn"),
      m.autor?.deaktiviert && chip("Konto deaktiviert", "fehler"),
    ].filter(Boolean);
    const autor = m.autor ? m.autor.name : "gelöschtes Konto";
    return el(
      "li",
      { class: "karte" },
      el("h3", {}, `Meldung vom ${zeit(m.erstelltAm)}`),
      el(
        "p",
        { class: "meta" },
        `Gemeldet von: ${m.gemeldetVon ?? "gelöschtes Konto"}. Verfasst von: ${autor}.`,
      ),
      chips.length > 0 && el("ul", { class: "chips" }, chips),
      !m.chat && el("p", { class: "meta" }, "Die Nachricht ist gelöscht."),
      m.text === null
        ? el("p", { class: "meta" }, "Die Kopie des Textes ist gelöscht.")
        : el("blockquote", { class: "zitat" }, m.text),
      el(
        "div",
        { class: "aktionen" },
        m.nachrichtId &&
          !m.ausgeblendet &&
          knopf("Ausblenden", {
            kontext: `Nachricht von ${autor}`,
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
                    if (e.nachrichtId === m.nachrichtId) e.ausgeblendet = true;
                  }
                  zeichneListe();
                  ctx.melde("Die Nachricht ist ausgeblendet.");
                },
              }),
          }),
        m.autor &&
          !m.autor.deaktiviert &&
          m.autor.id !== ctx.ich.id &&
          knopf("Person deaktivieren", {
            kontext: m.autor.name,
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
                    if (e.autor?.id === m.autor.id) e.autor.deaktiviert = true;
                  }
                  zeichneListe();
                  ctx.melde(`«${m.autor.name}» ist deaktiviert.`);
                },
              }),
          }),
        knopf("Erledigt", {
          art: "haupt",
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
      ),
    );
  }

  function zeichneListe() {
    liste.replaceChildren(...eintraege.map(karte));
    leer.hidden = eintraege.length > 0;
    liste.hidden = eintraege.length === 0;
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
    liste,
    el("div", { class: "aktionen" }, mehr),
  );
}
