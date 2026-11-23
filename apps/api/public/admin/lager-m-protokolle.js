import { anfrage } from "./api.js";
import { auswahl, dialogFormular, el, feld, knopf, tabelle } from "./dom.js";
import { datumsfeld } from "./datumsfeld.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import {
  beschrifteZellen,
  kartenTabelle,
  nichtGefunden,
} from "./lager-gemeinsam.js";
import {
  adresse,
  alleSeiten,
  basis,
  dateiEingabe,
  dateiLink,
  darf,
  darfSchreiben,
  datumMitTag,
  erwaehnFeld,
  gleicheErwaehnungenAb,
  heuteIso,
  holeLager,
  konfliktBox,
  ladeMitglieder,
  markenIn,
  markenZuNamen,
  meldung,
  restPfad,
  erwaehnungsKarte,
  zeitpunkt,
  kinder,
} from "./lager-sm-gemeinsam.js";

// Modul «Protokolle und Beschlüsse» im Lager-Arbeitsbereich (#673). Ein Protokoll ist die Verknüpfung auf eine Datei am Ablageort (SharePoint): Cevi OS speichert nie den Text. Beschlüsse sind kurze Sätze, die zu einem Höck oder Protokoll gehören. Adressen: …/protokolle und …/protokolle/beschluesse. Rechte: protokolle.lesen, protokolle.bearbeiten. Löschen entfernt nur die Verknüpfung, nie die Datei.

const ARTEN = {
  sitzung: "Sitzung",
  notiz: "Notiz",
  kontakt: "Kontakt",
  idee: "Idee",
};

export function zeige(bereich, ctx, lagerId, lagerRoh) {
  const [unter, weiter] = restPfad(ctx, lagerId);
  if (weiter !== undefined || (unter !== undefined && unter !== "beschluesse"))
    return ctx.lade(nichtGefunden, () => {});
  ctx.titel("Protokolle und Beschlüsse");
  const tabs = el(
    "nav",
    { class: "tabs", "aria-label": "Protokolle und Beschlüsse" },
    [
      ["Protokolle", adresse(lagerId, "protokolle"), unter === undefined],
      [
        "Beschlüsse",
        adresse(lagerId, "protokolle", "beschluesse"),
        unter === "beschluesse",
      ],
    ].map(([text, href, aktiv]) =>
      el(
        "a",
        { class: "tab", href, "aria-current": aktiv ? "page" : undefined },
        text,
      ),
    ),
  );
  const inhalt = el("div", { class: "lg-sm-inhalt" });
  bereich.append(...kinder(tabs, inhalt));
  const lade = ctx.erstelleLader(inhalt);
  const geladen = async () => {
    const lager = await holeLager(lagerId, lagerRoh);
    // Höcks nur, wenn die Rolle sie lesen darf; sonst fehlen die Namen
    const hoecks = darf(lager, "hoecks.lesen_alle", "hoecks.bearbeiten")
      ? await alleSeiten(`${basis(lagerId)}/hoecks`, "hoecks", { limit: 200 })
      : [];
    return { lager, hoecks };
  };
  if (unter === undefined) {
    lade(
      async () => ({
        ...(await geladen()),
        protokolle: await alleSeiten(
          `${basis(lagerId)}/protokolle`,
          "protokolle",
          { limit: 100 },
        ),
      }),
      (d, neu) => zeichneProtokolle(inhalt, ctx, lagerId, d, neu),
      {
        skeleton: () =>
          skeletonTabelle({ spalten: 5, zeilen: 4, avatar: false }),
      },
    );
  } else {
    lade(
      async () => ({
        ...(await geladen()),
        beschluesse: await alleSeiten(
          `${basis(lagerId)}/beschluesse`,
          "beschluesse",
          { limit: 100 },
        ),
        protokolle: await alleSeiten(
          `${basis(lagerId)}/protokolle`,
          "protokolle",
          { limit: 100 },
        ),
        mitglieder: await ladeMitglieder(lagerId),
      }),
      (d, neu) => zeichneBeschluesse(inhalt, ctx, lagerId, d, neu),
      {
        skeleton: () =>
          skeletonTabelle({ spalten: 3, zeilen: 4, avatar: false }),
      },
    );
  }
}

const hoeckName = (hoecks, id) => {
  const h = hoecks.find((x) => x.id === id);
  return h ? `${h.titel}, ${datumMitTag(h.datum)}` : null;
};
const hoeckOptionen = (hoecks) => [
  ["", "Keiner"],
  ...[...hoecks]
    .sort((a, b) => b.datum.localeCompare(a.datum))
    .map((h) => [h.id, `${h.titel}, ${datumMitTag(h.datum)}`]),
];

// ---- Protokolle ----

function protokollFormular({ ctx, lagerId, hoecks, start, danach }) {
  const neu = start === null;
  let version = start?.version;
  const art = auswahl({
    label: "Art",
    optionen: Object.entries(ARTEN),
    wert: start?.art ?? "sitzung",
  });
  const titel = feld({
    label: "Titel",
    wert: start?.titel ?? "",
    maxlength: 200,
    required: true,
    autocomplete: "off",
  });
  const datum = datumsfeld({
    label: "Datum",
    wert: start?.datum ?? heuteIso(),
    required: true,
  });
  const hoeck =
    hoecks.length > 0
      ? auswahl({
          label: "Höck",
          optionen: hoeckOptionen(hoecks),
          wert: start?.hoeckId ?? "",
        })
      : null;
  const datei = dateiEingabe({ start: start?.datei ?? null });
  const werte = () => ({
    art: art.eingabe.value,
    titel: titel.eingabe.value.trim(),
    datum: datum.eingabe.value,
    hoeckId: hoeck ? hoeck.eingabe.value || null : (start?.hoeckId ?? null),
  });
  const vorher = start && {
    art: start.art,
    titel: start.titel,
    datum: start.datum,
    hoeckId: start.hoeckId ?? null,
  };
  const konflikt = konfliktBox({
    namen: {
      art: "Art",
      titel: "Titel",
      datum: "Datum",
      hoeckId: "Höck",
      dateiId: "Datei",
    },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      art.eingabe.value = a.art;
      art.eingabe.dispatchEvent(new Event("change"));
      titel.eingabe.value = a.titel;
      datum.eingabe.value = a.datum;
      if (hoeck) {
        hoeck.eingabe.value = a.hoeckId ?? "";
        hoeck.eingabe.dispatchEvent(new Event("change"));
      }
    },
  });
  return dialogFormular({
    titel: neu ? "Protokoll verknüpfen" : "Protokoll bearbeiten",
    beschreibung:
      "Das Protokoll liegt in einer Datei am Ablageort. Hier steht nur die Verknüpfung.",
    felder: [
      konflikt.wurzel,
      art.wurzel,
      titel.wurzel,
      datum.wurzel,
      hoeck?.wurzel,
      ...datei.felder,
    ].filter(Boolean),
    ok: "Speichern",
    fehlertext: meldung,
    senden: async () => {
      const w = werte();
      try {
        if (neu) {
          const d = await datei.speichere(lagerId);
          return await anfrage("POST", `${basis(lagerId)}/protokolle`, {
            ...w,
            dateiId: d.id,
          });
        }
        const aenderung = {};
        for (const k of Object.keys(w))
          if (w[k] !== vorher[k]) aenderung[k] = w[k];
        if (datei.geaendert())
          aenderung.dateiId = (await datei.speichere(lagerId)).id;
        if (Object.keys(aenderung).length === 0) return start;
        return await anfrage(
          "PATCH",
          `${basis(lagerId)}/protokolle/${start.id}`,
          {
            version,
            ...aenderung,
          },
        );
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: () => {
      ctx.melde(neu ? "Protokoll verknüpft." : "Protokoll gespeichert.");
      return danach();
    },
  });
}

function zeichneProtokolle(
  inhalt,
  ctx,
  lagerId,
  { lager, protokolle, hoecks },
  neu,
) {
  const schreiben = darfSchreiben(lager, "protokolle.bearbeiten");
  if (schreiben)
    inhalt.append(
      ...kinder(
        el(
          "div",
          { class: "lg-sm-werkzeug" },
          knopf("Protokoll verknüpfen", {
            art: "haupt",
            symbol: "plus",
            onclick: () =>
              protokollFormular({
                ctx,
                lagerId,
                hoecks,
                start: null,
                danach: neu,
              }),
          }),
        ),
      ),
    );
  if (protokolle.length === 0) {
    inhalt.append(
      ...kinder(
        leerKarte(
          schreiben
            ? "Es gibt noch kein Protokoll. Verknüpfe das erste."
            : "Es gibt noch kein Protokoll.",
        ),
      ),
    );
    return;
  }
  const stand = { suche: "", art: "alle" };
  const leiste = filterleiste({
    suche: { label: "Protokolle suchen" },
    filter: [
      {
        schluessel: "art",
        label: "Art",
        grundwert: "alle",
        optionen: [["alle", "Alle"], ...Object.entries(ARTEN)],
      },
    ],
    namen: { einzahl: "Protokoll", mehrzahl: "Protokolle" },
    beiAenderung: (n) => {
      stand.suche = n.suche.trim().toLowerCase();
      stand.art = n.filter.art;
      zeichne();
    },
  });
  const spalten = ["Datum", "Titel", "Art", "Höck", "Datei"];
  if (schreiben) spalten.push("Aktionen");
  const { wurzel, koerper } = tabelle({
    beschriftung: "Protokolle",
    spalten,
    zeilen: [],
  });
  kartenTabelle(wurzel);
  const leer = el("div");
  function zeichne() {
    const treffer = protokolle.filter(
      (p) =>
        (stand.art === "alle" || p.art === stand.art) &&
        (stand.suche === "" || p.titel.toLowerCase().includes(stand.suche)),
    );
    koerper.replaceChildren(
      ...kinder(
        ...treffer.map((p) => {
          const zeile = el(
            "tr",
            {},
            el("td", { class: "lg-zahlen" }, datumMitTag(p.datum)),
            el("td", {}, el("span", { class: "fett" }, p.titel)),
            el("td", {}, el("span", { class: "chip" }, ARTEN[p.art] ?? p.art)),
            el(
              "td",
              {},
              p.hoeckId
                ? el(
                    "a",
                    {
                      class: "lg-verweis",
                      href: adresse(lagerId, "hoecks", p.hoeckId),
                    },
                    hoeckName(hoecks, p.hoeckId) ?? "Zum Höck",
                  )
                : "–",
            ),
            el(
              "td",
              {},
              p.datei
                ? dateiLink(p.datei)
                : el("span", { class: "leise" }, "Datei gelöscht"),
            ),
            schreiben &&
              el(
                "td",
                { class: "rechts" },
                el(
                  "div",
                  { class: "aktionen" },
                  knopf("Bearbeiten", {
                    klein: true,
                    kontext: p.titel,
                    onclick: () =>
                      protokollFormular({
                        ctx,
                        lagerId,
                        hoecks,
                        start: p,
                        danach: neu,
                      }),
                  }),
                  knopf("Löschen", {
                    klein: true,
                    art: "still",
                    kontext: p.titel,
                    onclick: () =>
                      ctx.mitRueckgaengig({
                        text: `Protokoll «${p.titel}» gelöscht`,
                        ausfuehren: () =>
                          anfrage(
                            "DELETE",
                            `${basis(lagerId)}/protokolle/${p.id}?version=${p.version}`,
                          ),
                        ansicht: {
                          weg: () => zeile.setAttribute("hidden", ""),
                          zurueck: () => zeile.removeAttribute("hidden"),
                        },
                        danach: neu,
                        fehlertext: meldung,
                        erledigt:
                          "Protokoll gelöscht. Die Datei bleibt am Ablageort.",
                      }),
                  }),
                ),
              ),
          );
          return zeile;
        }),
      ),
    );
    beschrifteZellen(koerper, spalten);
    leer.replaceChildren(
      ...kinder(
        treffer.length === 0
          ? leerKarte("Kein Protokoll passt zu deiner Suche.")
          : "",
      ),
    );
    leiste.setzeTreffer(treffer.length, protokolle.length);
  }
  inhalt.append(...kinder(leiste.wurzel, wurzel, leer));
  zeichne();
}

// ---- Beschlüsse ----

function beschlussFormular({
  ctx,
  lagerId,
  hoecks,
  protokolle,
  mitglieder,
  start,
  danach,
}) {
  const neu = start === null;
  let version = start?.version;
  const text = erwaehnFeld({
    label: "Beschluss",
    wert: start?.text ?? "",
    mitglieder,
    maxlength: 1000,
    hilfe: "Ein Satz oder zwei. Mit «@» erwähnst du eine Person.",
  });
  const hoeck =
    hoecks.length > 0
      ? auswahl({
          label: "Höck",
          optionen: hoeckOptionen(hoecks),
          wert: start?.hoeckId ?? "",
        })
      : null;
  const protokoll =
    protokolle.length > 0
      ? auswahl({
          label: "Protokoll",
          optionen: [
            ["", "Keines"],
            ...protokolle.map((p) => [
              p.id,
              `${p.titel}, ${datumMitTag(p.datum)}`,
            ]),
          ],
          wert: start?.protokollId ?? "",
        })
      : null;
  const werte = () => ({
    text: text.wert(),
    hoeckId: hoeck ? hoeck.eingabe.value || null : (start?.hoeckId ?? null),
    protokollId: protokoll
      ? protokoll.eingabe.value || null
      : (start?.protokollId ?? null),
  });
  const vorher = start && {
    text: start.text,
    hoeckId: start.hoeckId ?? null,
    protokollId: start.protokollId ?? null,
  };
  const konflikt = konfliktBox({
    namen: { text: "Beschluss", hoeckId: "Höck", protokollId: "Protokoll" },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      text.eingabe.value = markenZuNamen(a.text, text.karte);
      if (hoeck) {
        hoeck.eingabe.value = a.hoeckId ?? "";
        hoeck.eingabe.dispatchEvent(new Event("change"));
      }
      if (protokoll) {
        protokoll.eingabe.value = a.protokollId ?? "";
        protokoll.eingabe.dispatchEvent(new Event("change"));
      }
    },
  });
  return dialogFormular({
    titel: neu ? "Beschluss festhalten" : "Beschluss bearbeiten",
    felder: [
      konflikt.wurzel,
      text.wurzel,
      hoeck?.wurzel,
      protokoll?.wurzel,
    ].filter(Boolean),
    ok: "Speichern",
    fehlertext: meldung,
    pruefe: () => {
      if (text.eingabe.value.trim() !== "") return false;
      ctx.melde("Schreibe den Beschluss auf.", "warn");
      text.eingabe.focus();
      return true;
    },
    senden: async () => {
      const w = werte();
      try {
        let b;
        if (neu) {
          b = await anfrage("POST", `${basis(lagerId)}/beschluesse`, w);
        } else {
          const aenderung = {};
          for (const k of Object.keys(w))
            if (w[k] !== vorher[k]) aenderung[k] = w[k];
          if (Object.keys(aenderung).length === 0) return start;
          b = await anfrage(
            "PATCH",
            `${basis(lagerId)}/beschluesse/${start.id}`,
            {
              version,
              ...aenderung,
            },
          );
        }
        if (markenIn(`${w.text} ${vorher?.text ?? ""}`) > 0)
          await gleicheErwaehnungenAb(lagerId, "beschluss", b.id, ctx);
        return b;
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: () => {
      ctx.melde(neu ? "Beschluss festgehalten." : "Beschluss gespeichert.");
      return danach();
    },
  });
}

function zeichneBeschluesse(
  inhalt,
  ctx,
  lagerId,
  { lager, beschluesse, protokolle, hoecks, mitglieder },
  neu,
) {
  const schreiben = darfSchreiben(lager, "protokolle.bearbeiten");
  const karte = erwaehnungsKarte(mitglieder);
  if (schreiben)
    inhalt.append(
      ...kinder(
        el(
          "div",
          { class: "lg-sm-werkzeug" },
          knopf("Beschluss festhalten", {
            art: "haupt",
            symbol: "plus",
            onclick: () =>
              beschlussFormular({
                ctx,
                lagerId,
                hoecks,
                protokolle,
                mitglieder,
                start: null,
                danach: neu,
              }),
          }),
        ),
      ),
    );
  if (beschluesse.length === 0) {
    inhalt.append(
      ...kinder(
        leerKarte(
          schreiben
            ? "Es gibt noch keinen Beschluss. Halte den ersten fest."
            : "Es gibt noch keinen Beschluss.",
        ),
      ),
    );
    return;
  }
  inhalt.append(
    ...kinder(
      el(
        "ul",
        { class: "lg-sm-karten", "aria-label": "Beschlüsse" },
        beschluesse.map((b) => {
          const zeile = el(
            "li",
            { class: "flaeche lg-sm-beschluss" },
            el("p", { class: "lg-sm-text" }, markenZuNamen(b.text, karte)),
            el(
              "p",
              { class: "klein leise" },
              [
                zeitpunkt(b.erstelltAm),
                b.hoeckId && hoeckName(hoecks, b.hoeckId),
                b.protokollId &&
                  protokolle.find((p) => p.id === b.protokollId)?.titel,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
            el(
              "div",
              { class: "lg-sm-beschluss-links" },
              b.hoeckId &&
                el(
                  "a",
                  {
                    class: "lg-verweis",
                    href: adresse(lagerId, "hoecks", b.hoeckId),
                  },
                  "Zum Höck",
                ),
            ),
            schreiben &&
              el(
                "div",
                { class: "aktionen lg-sm-aktionen" },
                knopf("Bearbeiten", {
                  klein: true,
                  kontext: "Beschluss",
                  onclick: () =>
                    beschlussFormular({
                      ctx,
                      lagerId,
                      hoecks,
                      protokolle,
                      mitglieder,
                      start: b,
                      danach: neu,
                    }),
                }),
                knopf("Löschen", {
                  klein: true,
                  art: "still",
                  kontext: "Beschluss",
                  onclick: () =>
                    ctx.mitRueckgaengig({
                      text: "Beschluss gelöscht",
                      ausfuehren: () =>
                        anfrage(
                          "DELETE",
                          `${basis(lagerId)}/beschluesse/${b.id}?version=${b.version}`,
                        ),
                      ansicht: {
                        weg: () => zeile.setAttribute("hidden", ""),
                        zurueck: () => zeile.removeAttribute("hidden"),
                      },
                      danach: neu,
                      fehlertext: meldung,
                      erledigt: "Beschluss gelöscht.",
                    }),
                }),
              ),
          );
          return zeile;
        }),
      ),
    ),
  );
}
