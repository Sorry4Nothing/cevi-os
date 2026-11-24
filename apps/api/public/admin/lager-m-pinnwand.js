import { anfrage } from "./api.js";
import {
  ankreuzen,
  avatar,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  gruppe,
  icon,
  knopf,
} from "./dom.js";
import { datumZeitFeld } from "./datumsfeld.js";
import { skeletonListe } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import { nichtGefunden } from "./lager-gemeinsam.js";
import {
  alleSeiten,
  basis,
  dateiLink,
  dateiListe,
  darf,
  darfSchreiben,
  erwaehnFeld,
  erwaehnungsKarte,
  gleicheErwaehnungenAb,
  holeLager,
  isoZuLokal,
  konfliktBox,
  ladeMitglieder,
  lokalZuIso,
  markenIn,
  markenZuNamen,
  meldung,
  mehrzahl,
  personName,
  restPfad,
  zeitpunkt,
  kinder,
} from "./lager-sm-gemeinsam.js";

// Modul «Pinnwand» im Lager-Arbeitsbereich (#673): Beiträge mit Empfängern, Zeitfenster und Dateien, Umfragen an Beiträgen, Reaktionen, «Gesehen». Adresse: …/pinnwand. Rechte: pinnwand.lesen (aktive Beiträge, die für dich gemeint sind), pinnwand.bearbeiten (schreiben, Umfragen, Vergangenes und Künftiges sehen), interaktion.schreiben (abstimmen, reagieren). Kein Polling.

const REAKTIONEN = [
  ["daumen", "Daumen"],
  ["herz", "Herz"],
  ["lachen", "Lachen"],
  ["staunen", "Staunen"],
  ["danke", "Danke"],
];
const ROLLEN = [
  ["leitung", "Leitung"],
  ["team", "Team"],
  ["lesen", "Lesen"],
];

export function zeige(bereich, ctx, lagerId, lagerRoh) {
  if (restPfad(ctx, lagerId).length > 0)
    return ctx.lade(nichtGefunden, () => {});
  ctx.lade(
    async () => {
      const lager = await holeLager(lagerId, lagerRoh);
      const editor = darf(lager, "pinnwand.bearbeiten");
      const [beitraege, mitglieder, ressorts, gruppen] = await Promise.all([
        alleSeiten(
          `${basis(lagerId)}/pinnwand${editor ? "?status=alle" : ""}`,
          "beitraege",
          { limit: 50 },
        ),
        ladeMitglieder(lagerId),
        editor && darf(lager, "ressorts.lesen")
          ? alleSeiten(`${basis(lagerId)}/ressorts`, "ressorts", {
              limit: 100,
            }).catch(() => [])
          : [],
        editor && darf(lager, "einteilung.lesen")
          ? anfrage("GET", `${basis(lagerId)}/gruppen`)
              .then((r) => r.gruppen)
              .catch(() => [])
          : [],
      ]);
      return { lager, beitraege, mitglieder, ressorts, gruppen };
    },
    (d, neu) => zeichne(bereich, ctx, lagerId, d, neu),
    { skeleton: () => skeletonListe({ zeilen: 3 }) },
  );
}

// Liegt der Beitrag jetzt im Zeitfenster?
function istAktiv(b, jetzt = Date.now()) {
  const ab = b.sichtbarAb ? new Date(b.sichtbarAb).getTime() : null;
  const bis = b.sichtbarBis ? new Date(b.sichtbarBis).getTime() : null;
  return (ab === null || ab <= jetzt) && (bis === null || bis > jetzt);
}

function zeichne(bereich, ctx, lagerId, d, neu) {
  const { lager, mitglieder } = d;
  const schreiben = darfSchreiben(lager, "pinnwand.bearbeiten");
  const editor = darf(lager, "pinnwand.bearbeiten");
  const karte = erwaehnungsKarte(mitglieder);
  const jetzt = Date.now();
  const beitraege = [...d.beitraege].sort(
    (a, b) =>
      Number(b.angeheftet) - Number(a.angeheftet) ||
      String(b.erstelltAm).localeCompare(String(a.erstelltAm)),
  );
  const aktiv = beitraege.filter((b) => istAktiv(b, jetzt));
  const unbekannt = new Set(
    aktiv.filter((b) => !b.gesehen?.eigene).map((b) => b.id),
  );
  let wahl = "aktiv";
  const liste = el("ul", { class: "lg-sm-karten", "aria-label": "Beiträge" });
  const leer = el("div");
  const filter = editor
    ? filterGruppe({
        beschriftung: "Beiträge anzeigen",
        wert: wahl,
        eintraege: [
          { text: "Aktuell", n: aktiv.length, wert: "aktiv" },
          { text: "Alle", n: beitraege.length, wert: "alle" },
        ],
        beiAenderung: (w) => {
          wahl = w;
          zeichneListe();
        },
      })
    : null;
  function zeichneListe() {
    const sichtbar = wahl === "alle" ? beitraege : aktiv;
    liste.replaceChildren(
      ...kinder(
        ...sichtbar.map((b) =>
          beitragKarte({
            ctx,
            lagerId,
            lager,
            b,
            d,
            karte,
            aktuell: istAktiv(b, jetzt),
            neuerBeitrag: unbekannt.has(b.id),
            neu,
          }),
        ),
      ),
    );
    leer.replaceChildren(
      ...kinder(
        sichtbar.length === 0
          ? leerKarte(
              schreiben
                ? "Die Pinnwand ist leer. Schreibe den ersten Beitrag."
                : "Die Pinnwand ist leer.",
            )
          : "",
      ),
    );
  }
  bereich.append(
    ...kinder(
      schreiben &&
        el(
          "div",
          { class: "lg-sm-werkzeug" },
          knopf("Beitrag schreiben", {
            art: "haupt",
            symbol: "plus",
            onclick: () =>
              beitragFormular({ ctx, lagerId, d, start: null, danach: neu }),
          }),
        ),
      filter?.wurzel,
      liste,
      leer,
    ),
  );
  zeichneListe();
  // «Gesehen» melden: nur Beiträge, die jetzt gelten und die du noch nicht kanntest; höchstens 50 auf einmal, Fehler stören nicht
  if (unbekannt.size > 0) {
    anfrage("PUT", `${basis(lagerId)}/pinnwand/gesehen`, {
      beitragIds: [...unbekannt].slice(0, 50),
    }).catch(() => {});
  }
}

// ---- Eine Karte ----

function empfaengerText(b, d) {
  const e = b.empfaenger;
  if (e.anAlle) return "Alle Mitglieder";
  const teile = [];
  if (e.rollen.length > 0)
    teile.push(
      e.rollen.map((r) => ROLLEN.find(([k]) => k === r)?.[1] ?? r).join(", "),
    );
  if (e.personen.length > 0)
    teile.push(mehrzahl(e.personen.length, "Person", "Personen"));
  if (e.ressortIds.length > 0)
    teile.push(
      e.ressortIds
        .map((id) => d.ressorts.find((r) => r.id === id)?.kuerzel ?? "Ressort")
        .join(", "),
    );
  if (e.gruppeIds.length > 0)
    teile.push(
      e.gruppeIds
        .map((id) => d.gruppen.find((g) => g.id === id)?.name ?? "Gruppe")
        .join(", "),
    );
  return teile.join(" · ");
}

function beitragKarte({
  ctx,
  lagerId,
  lager,
  b,
  d,
  karte,
  aktuell,
  neuerBeitrag,
  neu,
}) {
  const schreiben = darfSchreiben(lager, "pinnwand.bearbeiten");
  const editor = darf(lager, "pinnwand.bearbeiten");
  const wurzel = el("li", { class: "flaeche lg-sm-beitrag" });
  const umfrageOrt = el("div", { class: "lg-sm-umfrage-ort" });
  const reaktionenOrt = el("div", { class: "lg-sm-reaktionen-ort" });
  const zeichneUmfrage = () =>
    umfrageOrt.replaceChildren(
      ...kinder(
        b.umfrage
          ? umfrage({ ctx, lagerId, lager, b, zeichneNeu: zeichneUmfrage, neu })
          : "",
      ),
    );
  const zeichneReaktionen = () =>
    reaktionenOrt.replaceChildren(
      ...kinder(
        reaktionen({ ctx, lagerId, lager, b, zeichneNeu: zeichneReaktionen }),
      ),
    );
  zeichneUmfrage();
  zeichneReaktionen();
  const loeschen = () =>
    ctx.mitRueckgaengig({
      text: `Beitrag «${b.titel}» gelöscht`,
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${basis(lagerId)}/pinnwand/${b.id}?version=${b.version}`,
        ),
      ansicht: {
        weg: () => wurzel.setAttribute("hidden", ""),
        zurueck: () => wurzel.removeAttribute("hidden"),
      },
      danach: neu,
      fehlertext: meldung,
      erledigt: "Beitrag gelöscht.",
    });
  const autor = b.von?.name ? personName(b.von) : null;
  wurzel.append(
    ...kinder(
      el(
        "div",
        { class: "lg-sm-beitragkopf" },
        autor && avatar(autor, { hell: true, bildUrl: b.von?.bildUrl }),
        el(
          "div",
          { class: "lg-sm-beitragtitel" },
          el("h2", { class: "lg-sm-h3" }, b.titel),
          el(
            "p",
            { class: "klein leise" },
            [autor, b.erstelltAm && zeitpunkt(b.erstelltAm)]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
        el(
          "ul",
          { class: "lg-sm-chips", "aria-label": "Eigenschaften" },
          neuerBeitrag && el("li", { class: "chip chip--ok" }, "Neu"),
          b.wichtig &&
            el("li", { class: "chip chip--warn" }, icon("warnung"), "Wichtig"),
          b.angeheftet && el("li", { class: "chip" }, "Angeheftet"),
          !aktuell &&
            el(
              "li",
              { class: "chip" },
              b.sichtbarAb && new Date(b.sichtbarAb) > new Date()
                ? `Ab ${zeitpunkt(b.sichtbarAb)}`
                : "Abgelaufen",
            ),
        ),
      ),
      b.text && el("p", { class: "lg-sm-text" }, markenZuNamen(b.text, karte)),
      b.dateien.length > 0 &&
        el(
          "ul",
          { class: "lg-sm-dateien", "aria-label": "Dateien" },
          b.dateien.map((x) => el("li", {}, dateiLink(x))),
        ),
      umfrageOrt,
      reaktionenOrt,
      el(
        "p",
        { class: "klein leise" },
        [
          editor && `Gemeint sind: ${empfaengerText(b, d)}`,
          b.sichtbarAb && `Sichtbar ab ${zeitpunkt(b.sichtbarAb)}`,
          b.sichtbarBis && `bis ${zeitpunkt(b.sichtbarBis)}`,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      gesehenBlock(b, editor),
      schreiben &&
        el(
          "div",
          { class: "aktionen lg-sm-aktionen" },
          knopf("Bearbeiten", {
            klein: true,
            kontext: b.titel,
            onclick: () =>
              beitragFormular({ ctx, lagerId, d, start: b, danach: neu }),
          }),
          !b.umfrage &&
            knopf("Umfrage hinzufügen", {
              klein: true,
              kontext: b.titel,
              onclick: () =>
                umfrageFormular({
                  ctx,
                  lagerId,
                  b,
                  start: null,
                  danach: (u) => {
                    b.umfrage = u;
                    b.version += 1;
                    zeichneUmfrage();
                    return neu();
                  },
                }),
            }),
          knopf("Löschen", {
            klein: true,
            art: "still",
            kontext: b.titel,
            onclick: loeschen,
          }),
        ),
    ),
  );
  return wurzel;
}

// Wer den Beitrag gesehen hat: die Zahl für alle, die Namen nur mit dem Recht, die Pinnwand zu bearbeiten
function gesehenBlock(b, editor) {
  const n = b.gesehen?.anzahl ?? 0;
  if (!editor || !b.gesehen?.personen)
    return el("p", { class: "klein leise" }, `Gesehen von ${n}`);
  return el(
    "details",
    { class: "lg-sm-gesehen" },
    el("summary", {}, `Gesehen von ${n}`),
    b.gesehen.personen.length === 0
      ? el("p", { class: "klein leise" }, "Noch niemand.")
      : el(
          "ul",
          { class: "klein" },
          b.gesehen.personen.map((p) => el("li", {}, personName(p))),
        ),
  );
}

// ---- Reaktionen ----

function reaktionen({ ctx, lagerId, lager, b, zeichneNeu }) {
  const darfReagieren = darfSchreiben(lager, "interaktion.schreiben");
  const r = b.reaktionen ?? { zaehler: {}, eigene: null };
  const knoepfe = REAKTIONEN.map(([schluessel, text]) => {
    const n = r.zaehler[schluessel] ?? 0;
    const gedrueckt = r.eigene === schluessel;
    if (!darfReagieren)
      return n > 0 ? el("li", { class: "chip" }, `${text} ${n}`) : false;
    const k = el(
      "button",
      {
        type: "button",
        class: "knopf knopf--klein",
        "aria-pressed": String(gedrueckt),
        onclick: async () => {
          k.disabled = true;
          try {
            if (gedrueckt) {
              await anfrage(
                "DELETE",
                `${basis(lagerId)}/reaktionen/pinnwand_beitrag/${b.id}`,
              );
              b.reaktionen = {
                zaehler: { ...r.zaehler, [schluessel]: Math.max(0, n - 1) },
                eigene: null,
              };
            } else {
              b.reaktionen = await anfrage(
                "PUT",
                `${basis(lagerId)}/reaktionen/pinnwand_beitrag/${b.id}`,
                { emoji: schluessel },
              );
            }
            zeichneNeu();
            // Der Fokus bleibt auf dem Knopf, der neu gezeichnet wurde
            document
              .querySelector(`[data-reaktion="${b.id}-${schluessel}"]`)
              ?.focus();
          } catch (f) {
            k.disabled = false;
            ctx.melde(meldung(f), "fehler");
          }
        },
        "data-reaktion": `${b.id}-${schluessel}`,
      },
      text,
      el("span", { class: "n" }, ` ${n}`),
    );
    return el("li", {}, k);
  });
  if (knoepfe.every((k) => !k)) return "";
  return el(
    "ul",
    { class: "lg-sm-reaktionen", "aria-label": "Reaktionen" },
    knoepfe,
  );
}

// ---- Umfrage ----

function umfrage({ ctx, lagerId, lager, b, zeichneNeu, neu }) {
  const u = b.umfrage;
  const schreiben = darfSchreiben(lager, "pinnwand.bearbeiten");
  const darfAbstimmen =
    !u.geschlossen &&
    darfSchreiben(lager, "interaktion.schreiben") &&
    darf(lager, "pinnwand.lesen");
  const eigene = new Set(u.optionen.filter((o) => o.eigene).map((o) => o.id));
  const gewaehlt = new Set(eigene);
  const total = Math.max(1, u.teilnehmende);
  const optionen = u.optionen.map((o) => {
    const prozent = Math.round((o.stimmen / total) * 100);
    const ergebnis = el(
      "div",
      { class: "lg-sm-ergebnis" },
      el("progress", {
        max: String(total),
        value: String(o.stimmen),
        "aria-label": `${o.text}: ${o.stimmen} Stimmen`,
      }),
      el(
        "span",
        { class: "klein lg-zahlen" },
        `${mehrzahl(o.stimmen, "Stimme", "Stimmen")} (${prozent} %)`,
      ),
      u.namenSichtbar &&
        o.personen.length > 0 &&
        el(
          "span",
          { class: "klein leise" },
          o.personen.map(personName).join(", "),
        ),
    );
    if (!darfAbstimmen)
      return el(
        "li",
        {},
        el(
          "span",
          {},
          o.text,
          o.eigene && el("span", { class: "chip chip--ok" }, "Deine Stimme"),
        ),
        ergebnis,
      );
    const eingabe = el("input", {
      type: u.mehrfach ? "checkbox" : "radio",
      name: `u-${u.id}`,
      value: o.id,
      checked: gewaehlt.has(o.id),
      onchange: (e) => {
        if (!u.mehrfach) gewaehlt.clear();
        if (e.target.checked) gewaehlt.add(o.id);
        else gewaehlt.delete(o.id);
        abstimmen.disabled = gewaehlt.size === 0;
      },
    });
    const inhalt = el("div", {}, el("strong", {}, o.text), ergebnis);
    // Mehrfachwahl: Kästchen im Stil der Verwaltung; Einzelwahl: Karte mit Rundknopf
    if (u.mehrfach) {
      const id = `u-${u.id}-${o.id}`;
      eingabe.id = id;
      return el(
        "li",
        {},
        el("div", { class: "wahl" }, eingabe, el("label", { for: id }, o.text)),
        ergebnis,
      );
    }
    return el("li", {}, el("label", { class: "wahlkarte" }, eingabe, inhalt));
  });
  const abstimmen = knopf(eigene.size > 0 ? "Stimme ändern" : "Abstimmen", {
    art: "haupt",
    klein: true,
    disabled: gewaehlt.size === 0,
    onclick: async () => {
      abstimmen.disabled = true;
      try {
        b.umfrage = await anfrage(
          "PUT",
          `${basis(lagerId)}/pinnwand/${b.id}/umfrage/stimme`,
          { optionIds: [...gewaehlt] },
        );
        ctx.melde("Deine Stimme ist gezählt.");
        zeichneNeu();
      } catch (f) {
        abstimmen.disabled = false;
        ctx.melde(meldung(f), "fehler");
      }
    },
  });
  const zurueck = knopf("Stimme zurückziehen", {
    klein: true,
    art: "still",
    onclick: async () => {
      try {
        await anfrage(
          "DELETE",
          `${basis(lagerId)}/pinnwand/${b.id}/umfrage/stimme`,
        );
        const k = u.optionen.filter((o) => o.eigene).length;
        b.umfrage = {
          ...u,
          teilnehmende: Math.max(0, u.teilnehmende - 1),
          optionen: u.optionen.map((o) => ({
            ...o,
            stimmen: o.eigene ? Math.max(0, o.stimmen - 1) : o.stimmen,
            eigene: false,
          })),
        };
        ctx.melde(
          k > 0 ? "Deine Stimme ist zurückgezogen." : "Keine Stimme zu ziehen.",
        );
        zeichneNeu();
      } catch (f) {
        ctx.melde(meldung(f), "fehler");
      }
    },
  });
  return el(
    "section",
    { class: "lg-sm-umfrage", "aria-label": "Umfrage" },
    el(
      "div",
      { class: "lg-sm-umfragekopf" },
      el("span", { class: "fett" }, "Umfrage"),
      el(
        "ul",
        { class: "lg-sm-chips" },
        u.geschlossen && el("li", { class: "chip" }, "Geschlossen"),
        u.mehrfach
          ? el("li", { class: "chip" }, "Mehrere Antworten")
          : el("li", { class: "chip" }, "Eine Antwort"),
        u.schliesstAm &&
          !u.geschlossen &&
          el("li", { class: "chip" }, `Schliesst ${zeitpunkt(u.schliesstAm)}`),
        el(
          "li",
          { class: "chip" },
          mehrzahl(u.teilnehmende, "Teilnehmende", "Teilnehmende"),
        ),
      ),
    ),
    el("ul", { class: "lg-sm-optionen", "aria-label": "Antworten" }, optionen),
    darfAbstimmen &&
      el(
        "div",
        { class: "aktionen lg-sm-aktionen" },
        abstimmen,
        eigene.size > 0 && zurueck,
      ),
    schreiben &&
      el(
        "div",
        { class: "aktionen lg-sm-aktionen" },
        knopf("Umfrage bearbeiten", {
          klein: true,
          onclick: () =>
            umfrageFormular({
              ctx,
              lagerId,
              b,
              start: u,
              danach: (neueU) => {
                b.umfrage = neueU;
                zeichneNeu();
              },
            }),
        }),
        knopf("Umfrage löschen", {
          klein: true,
          art: "still",
          onclick: () =>
            ctx.mitRueckgaengig({
              text: "Umfrage gelöscht",
              ausfuehren: () =>
                anfrage(
                  "DELETE",
                  `${basis(lagerId)}/pinnwand/${b.id}/umfrage?version=${u.version}`,
                ),
              danach: neu,
              fehlertext: meldung,
              erledigt: "Umfrage gelöscht.",
            }),
        }),
      ),
  );
}

function umfrageFormular({ ctx, lagerId, b, start, danach }) {
  const neu = start === null;
  let version = start?.version;
  const antworten = feld({
    label: "Antworten",
    mehrzeilig: true,
    rows: "5",
    hilfe:
      "Eine Antwort pro Zeile, zwei bis zehn. Die Antworten lassen sich später nicht mehr ändern.",
    maxlength: 2200,
  });
  const mehrfach = ankreuzen({
    label: "Mehrere Antworten erlauben",
    gewaehlt: start?.mehrfach ?? false,
  });
  const namen = ankreuzen({
    label: "Das Team sieht, wer wie gestimmt hat",
    gewaehlt: start?.namenFuerTeam ?? false,
  });
  const schliesst = datumZeitFeld({
    label: "Schliesst am",
    wert: isoZuLokal(start?.schliesstAm),
    hilfe: "Freiwillig. Danach lässt sich nicht mehr abstimmen.",
  });
  const geschlossen = ankreuzen({
    label: "Umfrage jetzt schliessen",
    gewaehlt: start?.geschlossen ?? false,
  });
  const konflikt = konfliktBox({
    namen: {
      schliesstAm: "Schliesst am",
      geschlossen: "Geschlossen",
      namenFuerTeam: "Namen für das Team",
    },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      namen.eingabe.checked = a.namenFuerTeam;
      geschlossen.eingabe.checked = a.geschlossen;
      schliesst.eingabe.value = isoZuLokal(a.schliesstAm);
    },
  });
  const felder = neu
    ? [
        konflikt.wurzel,
        antworten.wurzel,
        mehrfach.wurzel,
        namen.wurzel,
        schliesst.wurzel,
      ]
    : [konflikt.wurzel, namen.wurzel, schliesst.wurzel, geschlossen.wurzel];
  return dialogFormular({
    titel: neu ? "Umfrage hinzufügen" : "Umfrage bearbeiten",
    beschreibung: `Zum Beitrag «${b.titel}».`,
    felder,
    ok: "Speichern",
    fehlertext: meldung,
    pruefe: () => {
      if (!neu) return false;
      const n = antwortenListe().length;
      if (n >= 2 && n <= 10) return false;
      ctx.melde("Schreibe zwei bis zehn Antworten, je eine pro Zeile.", "warn");
      antworten.eingabe.focus();
      return true;
    },
    senden: async () => {
      try {
        if (neu)
          return await anfrage(
            "POST",
            `${basis(lagerId)}/pinnwand/${b.id}/umfrage`,
            {
              optionen: antwortenListe(),
              mehrfach: mehrfach.eingabe.checked,
              namenFuerTeam: namen.eingabe.checked,
              schliesstAm: lokalZuIso(schliesst.eingabe.value),
            },
          );
        return await anfrage(
          "PATCH",
          `${basis(lagerId)}/pinnwand/${b.id}/umfrage`,
          {
            version,
            namenFuerTeam: namen.eingabe.checked,
            schliesstAm: lokalZuIso(schliesst.eingabe.value),
            geschlossen: geschlossen.eingabe.checked,
          },
        );
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: (u) => {
      ctx.melde(neu ? "Umfrage hinzugefügt." : "Umfrage gespeichert.");
      return danach(u);
    },
  });
  function antwortenListe() {
    return antworten.eingabe.value
      .split(/\r?\n/)
      .map((z) => z.trim())
      .filter(Boolean);
  }
}

// ---- Beitrag schreiben und ändern ----

function beitragFormular({ ctx, lagerId, d, start, danach }) {
  const neu = start === null;
  let version = start?.version;
  const titel = feld({
    label: "Titel",
    wert: start?.titel ?? "",
    maxlength: 200,
    required: true,
    autocomplete: "off",
  });
  const text = erwaehnFeld({
    label: "Text",
    wert: start?.text ?? "",
    mitglieder: d.mitglieder,
    maxlength: 10000,
    rows: "6",
    hilfe: "Freiwillig. Mit «@» erwähnst du eine Person.",
  });
  const wichtig = ankreuzen({
    label: "Wichtig: Die Empfänger bekommen eine Benachrichtigung",
    gewaehlt: start?.wichtig ?? false,
  });
  const angeheftet = ankreuzen({
    label: "Oben anheften",
    gewaehlt: start?.angeheftet ?? false,
  });
  const ab = datumZeitFeld({
    label: "Sichtbar ab",
    wert: isoZuLokal(start?.sichtbarAb),
    hilfe: "Freiwillig. Ohne Angabe ist er sofort sichtbar.",
  });
  const bis = datumZeitFeld({
    label: "Sichtbar bis",
    wert: isoZuLokal(start?.sichtbarBis),
    hilfe: "Freiwillig. Ohne Angabe bleibt er stehen.",
  });
  const dateien = dateiListe({ start: start?.dateien ?? [] });
  // Empfänger: nichts gewählt heisst alle
  const e0 = start?.empfaenger;
  const rollenWahl = ROLLEN.map(([k, t]) =>
    ankreuzen({ label: t, wert: k, gewaehlt: e0?.rollen.includes(k) }),
  );
  const mehrere = (liste, ids, beschriftung) =>
    liste.map((x) =>
      ankreuzen({
        label: beschriftung(x),
        wert: x.id ?? x.personId,
        gewaehlt: ids?.includes(x.id ?? x.personId),
      }),
    );
  const personenWahl = mehrere(d.mitglieder, e0?.personen, (m) => m.name);
  const ressortWahl = mehrere(
    d.ressorts,
    e0?.ressortIds,
    (r) => `${r.kuerzel} ${r.name}`,
  );
  const gruppeWahl = mehrere(d.gruppen, e0?.gruppeIds, (g) => g.name);
  const gewaehlte = (wahl) =>
    wahl.filter((k) => k.eingabe.checked).map((k) => k.eingabe.value);
  const empfaenger = () => ({
    rollen: gewaehlte(rollenWahl),
    personen: gewaehlte(personenWahl),
    ressortIds: gewaehlte(ressortWahl),
    gruppeIds: gewaehlte(gruppeWahl),
  });
  const gleich = (a, c) => JSON.stringify(a) === JSON.stringify(c);
  const vorher = start && {
    titel: start.titel,
    text: start.text,
    wichtig: start.wichtig,
    angeheftet: start.angeheftet,
    sichtbarAb: isoZuLokal(start.sichtbarAb),
    sichtbarBis: isoZuLokal(start.sichtbarBis),
    empfaenger: {
      rollen: start.empfaenger.rollen,
      personen: start.empfaenger.personen,
      ressortIds: start.empfaenger.ressortIds,
      gruppeIds: start.empfaenger.gruppeIds,
    },
  };
  const konflikt = konfliktBox({
    namen: {
      titel: "Titel",
      text: "Text",
      wichtig: "Wichtig",
      angeheftet: "Angeheftet",
      sichtbarAb: "Sichtbar ab",
      sichtbarBis: "Sichtbar bis",
    },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      titel.eingabe.value = a.titel;
      text.eingabe.value = markenZuNamen(a.text, text.karte);
      wichtig.eingabe.checked = a.wichtig;
      angeheftet.eingabe.checked = a.angeheftet;
      ab.eingabe.value = isoZuLokal(a.sichtbarAb);
      bis.eingabe.value = isoZuLokal(a.sichtbarBis);
    },
  });
  const felder = [
    konflikt.wurzel,
    titel.wurzel,
    text.wurzel,
    el("div", { class: "lg-sm-zeile" }, wichtig.wurzel, angeheftet.wurzel),
    el("div", { class: "lg-sm-zeile" }, ab.wurzel, bis.wurzel),
    gruppe("Dateien", dateien.wurzel),
    gruppe(
      "Wer soll den Beitrag sehen?",
      el(
        "div",
        { class: "lg-sm-empfaenger" },
        el(
          "p",
          { class: "hilfe" },
          "Wähle nichts, dann sehen alle Mitglieder den Beitrag. Wählst du mehrere Wege, sehen ihn alle, auf die einer passt.",
        ),
        gruppe(
          "Rollen",
          rollenWahl.map((k) => k.wurzel),
        ),
        personenWahl.length > 0 &&
          gruppe(
            "Personen",
            personenWahl.map((k) => k.wurzel),
            { scrollen: true },
          ),
        ressortWahl.length > 0 &&
          gruppe(
            "Ressorts",
            ressortWahl.map((k) => k.wurzel),
          ),
        gruppeWahl.length > 0 &&
          gruppe(
            "Gruppen",
            gruppeWahl.map((k) => k.wurzel),
          ),
      ),
    ),
  ];
  return dialogFormular({
    titel: neu ? "Beitrag schreiben" : "Beitrag bearbeiten",
    felder,
    ok: "Speichern",
    fehlertext: meldung,
    pruefe: () => {
      if (!dateien.unvollstaendig()) return false;
      ctx.melde("Jede Datei braucht einen Namen und einen Link.", "warn");
      return true;
    },
    senden: async () => {
      const w = {
        titel: titel.eingabe.value.trim(),
        text: text.wert(),
        wichtig: wichtig.eingabe.checked,
        angeheftet: angeheftet.eingabe.checked,
        sichtbarAb: ab.eingabe.value,
        sichtbarBis: bis.eingabe.value,
      };
      try {
        let b;
        if (neu) {
          b = await anfrage("POST", `${basis(lagerId)}/pinnwand`, {
            titel: w.titel,
            text: w.text,
            wichtig: w.wichtig,
            angeheftet: w.angeheftet,
            sichtbarAb: lokalZuIso(w.sichtbarAb),
            sichtbarBis: lokalZuIso(w.sichtbarBis),
            empfaenger: empfaenger(),
            dateiIds: await dateien.speichere(lagerId),
          });
        } else {
          const aenderung = {};
          for (const k of ["titel", "text", "wichtig", "angeheftet"])
            if (w[k] !== vorher[k]) aenderung[k] = w[k];
          for (const k of ["sichtbarAb", "sichtbarBis"])
            if (w[k] !== vorher[k]) aenderung[k] = lokalZuIso(w[k]);
          const e = empfaenger();
          if (!gleich(e, vorher.empfaenger)) aenderung.empfaenger = e;
          if (dateien.geaendert())
            aenderung.dateiIds = await dateien.speichere(lagerId);
          if (Object.keys(aenderung).length === 0) return start;
          b = await anfrage("PATCH", `${basis(lagerId)}/pinnwand/${start.id}`, {
            version,
            ...aenderung,
          });
        }
        if (markenIn(`${w.text} ${vorher?.text ?? ""}`) > 0)
          await gleicheErwaehnungenAb(lagerId, "pinnwand", b.id, ctx);
        return b;
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: () => {
      ctx.melde(neu ? "Beitrag veröffentlicht." : "Beitrag gespeichert.");
      return danach();
    },
  });
}
