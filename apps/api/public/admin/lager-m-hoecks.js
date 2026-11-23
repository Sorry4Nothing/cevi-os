import { anfrage } from "./api.js";
import {
  ankreuzen,
  auswahl,
  avatar,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  icon,
  knopf,
  tabelle,
} from "./dom.js";
import { datumsfeld, zeitfeld } from "./datumsfeld.js";
import { skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import {
  beschrifteZellen,
  ID,
  kartenTabelle,
  nichtGefunden,
  zurueckLink,
} from "./lager-gemeinsam.js";
import {
  adresse,
  alleSeiten,
  basis,
  darf,
  darfSchreiben,
  datumMitTag,
  heuteIso,
  holeLager,
  konfliktBox,
  ladeMitglieder,
  meldung,
  mehrzahl,
  personName,
  restPfad,
  schreibschutz,
} from "./lager-sm-gemeinsam.js";
import { nachSchreibfehler, traktandenBlock } from "./lager-sm-traktanden.js";

// Modul «Höcks» im Lager-Arbeitsbereich (#673): Liste der Sitzungen mit den Punkten für den nächsten Höck, Detail mit Anwesenden und Traktanden, Höck-Modus für die Sitzung am Bildschirm. Adressen: …/hoecks, …/hoecks/<id>, …/hoecks/<id>/modus. Rechte: hoecks.lesen_alle (alles), hoecks.team_lesen (nur Team-Höcks, nur Datum, Zeit, Titel, Ort), hoecks.bearbeiten (ändern). Kein Polling: «Aktualisieren» lädt neu.

const ART = {
  team: "Team",
  lagerleitung: "Leitung",
};
const LESEN = ["hoecks.lesen_alle", "hoecks.bearbeiten"];

export function zeige(bereich, ctx, lagerId, lagerRoh) {
  const [id, unter] = restPfad(ctx, lagerId);
  if (id === undefined) return liste(bereich, ctx, lagerId, lagerRoh);
  if (!ID.test(id) || (unter !== undefined && unter !== "modus"))
    return ctx.lade(nichtGefunden, () => {});
  return unter === "modus"
    ? modus(bereich, ctx, lagerId, lagerRoh, id)
    : detail(bereich, ctx, lagerId, lagerRoh, id);
}

const aktualisieren = (neu) =>
  knopf("Aktualisieren", {
    klein: true,
    art: "still",
    symbol: "aktualisieren",
    onclick: () => neu(),
  });

// ---- Formular zum Anlegen und Ändern ----

function hoeckFormular({ ctx, lagerId, start, danach }) {
  const neu = start === null;
  let version = start?.version;
  const titel = feld({
    label: "Titel",
    wert: start?.titel ?? "",
    maxlength: 200,
    required: true,
    autocomplete: "off",
  });
  const art = auswahl({
    label: "Wer sieht den Höck?",
    optionen: [
      ["team", "Alle Mitglieder (Team-Höck)"],
      ["lagerleitung", "Lagerleitung und Leitung (Leitungs-Höck)"],
    ],
    wert: start?.art ?? "team",
  });
  const datum = datumsfeld({
    label: "Datum",
    wert: start?.datum ?? heuteIso(),
    required: true,
  });
  const zeit = zeitfeld({
    label: "Uhrzeit",
    wert: start?.zeit ?? "",
    hilfe: "Freiwillig, zum Beispiel 19:30.",
  });
  const ort = feld({
    label: "Ort",
    hilfe: "Freiwillig.",
    wert: start?.ort ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const gaeste = feld({
    label: "Gäste",
    hilfe: "Freiwillig. Wer kommt zusätzlich, zum Beispiel «Kassierin des Vereins»?",
    wert: start?.gaeste ?? "",
    maxlength: 500,
    autocomplete: "off",
  });
  const werte = () => ({
    titel: titel.eingabe.value.trim(),
    art: art.eingabe.value,
    datum: datum.eingabe.value,
    zeit: zeit.eingabe.value || null,
    ort: ort.eingabe.value.trim() || null,
    gaeste: gaeste.eingabe.value.trim() || null,
  });
  const vorher = start && {
    titel: start.titel,
    art: start.art,
    datum: start.datum,
    zeit: start.zeit ?? null,
    ort: start.ort ?? null,
    gaeste: start.gaeste ?? null,
  };
  const konflikt = konfliktBox({
    namen: {
      titel: "Titel",
      art: "Wer sieht den Höck?",
      datum: "Datum",
      zeit: "Uhrzeit",
      ort: "Ort",
      gaeste: "Gäste",
    },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      titel.eingabe.value = a.titel;
      art.eingabe.value = a.art;
      art.eingabe.dispatchEvent(new Event("change"));
      datum.eingabe.value = a.datum;
      zeit.eingabe.value = a.zeit ?? "";
      ort.eingabe.value = a.ort ?? "";
      gaeste.eingabe.value = a.gaeste ?? "";
    },
  });
  return dialogFormular({
    titel: neu ? "Höck anlegen" : "Höck bearbeiten",
    felder: [
      konflikt.wurzel,
      titel.wurzel,
      art.wurzel,
      el("div", { class: "lg-sm-zeile" }, datum.wurzel, zeit.wurzel),
      ort.wurzel,
      gaeste.wurzel,
    ],
    ok: "Speichern",
    fehlertext: meldung,
    pruefe: () => {
      if (datum.eingabe.value !== "") return false;
      ctx.melde("Wähle das Datum des Höcks.", "warn");
      datum.eingabe.focus();
      return true;
    },
    senden: async () => {
      const w = werte();
      try {
        if (neu) {
          const body = { titel: w.titel, art: w.art, datum: w.datum };
          for (const k of ["zeit", "ort", "gaeste"]) if (w[k]) body[k] = w[k];
          return await anfrage("POST", `${basis(lagerId)}/hoecks`, body);
        }
        const aenderung = {};
        for (const k of Object.keys(w)) if (w[k] !== vorher[k]) aenderung[k] = w[k];
        if (Object.keys(aenderung).length === 0) return start;
        return await anfrage(
          "PATCH",
          `${basis(lagerId)}/hoecks/${start.id}`,
          { version, ...aenderung },
        );
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: (h) => {
      ctx.melde(neu ? "Höck angelegt." : "Höck gespeichert.");
      danach(h);
    },
  });
}

// ---- Liste ----

function liste(bereich, ctx, lagerId, lagerRoh) {
  ctx.kopfAktion();
  ctx.lade(
    async () => {
      const lager = await holeLager(lagerId, lagerRoh);
      const alle = darf(lager, ...LESEN);
      const [hoecks, naechste, mitglieder] = await Promise.all([
        alleSeiten(`${basis(lagerId)}/hoecks`, "hoecks", { limit: 200 }),
        alle ? anfrage("GET", `${basis(lagerId)}/traktanden/naechster`) : null,
        alle ? ladeMitglieder(lagerId) : [],
      ]);
      return { lager, hoecks, naechste: naechste?.traktanden ?? null, mitglieder };
    },
    (d, neu) => zeichneListe(bereich, ctx, lagerId, d, neu),
    { skeleton: () => skeletonTabelle({ spalten: 5, zeilen: 4, avatar: false }) },
  );
}

function zeichneListe(bereich, ctx, lagerId, { lager, hoecks, naechste, mitglieder }, neu) {
  ctx.titel("Höcks", lager.titel);
  const schreiben = darfSchreiben(lager, "hoecks.bearbeiten");
  ctx.kopfAktion(
    aktualisieren(neu),
    schreiben &&
      knopf("Höck anlegen", {
        art: "haupt",
        symbol: "plus",
        onclick: () =>
          hoeckFormular({
            ctx,
            lagerId,
            start: null,
            danach: (h) => (location.hash = adresse(lagerId, "hoecks", h.id)),
          }),
      }),
  );
  bereich.append(schreibschutz(lager) || "");
  if (hoecks.length === 0) {
    bereich.append(
      leerKarte(
        schreiben
          ? "Es gibt noch keinen Höck. Lege den ersten an."
          : "Es gibt noch keinen Höck.",
      ),
    );
  } else {
    bereich.append(hoeckTabelle(hoecks, lagerId));
  }
  if (naechste) {
    bereich.append(
      el(
        "section",
        { class: "flaeche lg-sm-naechste", "aria-label": "Punkte für den nächsten Höck" },
        traktandenBlock({
          ctx,
          lager,
          lagerId,
          hoeckId: null,
          traktanden: naechste,
          mitglieder,
          laden: neu,
          titel: "Punkte für den nächsten Höck",
        }),
      ),
    );
  }
}

function hoeckTabelle(hoecks, lagerId) {
  const heute = heuteIso();
  const komm = hoecks.filter((h) => h.datum >= heute);
  const verg = hoecks.filter((h) => h.datum < heute);
  const mitZahlen = hoecks.some((h) => h.anzahlTraktanden !== undefined);
  let wahl = komm.length > 0 ? "kommend" : "alle";
  const filter = filterGruppe({
    beschriftung: "Höcks anzeigen",
    wert: wahl,
    eintraege: [
      { text: "Kommende", n: komm.length, wert: "kommend" },
      { text: "Vergangene", n: verg.length, wert: "vergangen" },
      { text: "Alle", n: hoecks.length, wert: "alle" },
    ],
    beiAenderung: (w) => {
      wahl = w;
      zeichne();
    },
  });
  const spalten = ["Datum", "Zeit", "Titel"];
  if (mitZahlen) spalten.push("Art");
  spalten.push("Ort");
  if (mitZahlen) spalten.push(["Traktanden", "zahl"], ["Anwesende", "zahl"]);
  const { wurzel, koerper } = tabelle({ beschriftung: "Höcks", spalten, zeilen: [] });
  kartenTabelle(wurzel);
  const leer = el("div");
  function zeichne() {
    const gefiltert =
      wahl === "kommend" ? komm : wahl === "vergangen" ? [...verg].reverse() : hoecks;
    koerper.replaceChildren(
      ...gefiltert.map((h) =>
        el(
          "tr",
          {},
          el("td", { class: "lg-zahlen" }, datumMitTag(h.datum)),
          el("td", { class: "lg-zahlen" }, h.zeit ?? "–"),
          el(
            "td",
            {},
            el(
              "a",
              { class: "name lg-name", href: adresse(lagerId, "hoecks", h.id) },
              h.titel,
            ),
          ),
          mitZahlen && el("td", {}, ART[h.art] ?? ""),
          el("td", {}, h.ort ?? "–"),
          mitZahlen && el("td", { class: "lg-zahlen rechts" }, String(h.anzahlTraktanden ?? 0)),
          mitZahlen && el("td", { class: "lg-zahlen rechts" }, String(h.anzahlAnwesende ?? 0)),
        ),
      ),
    );
    beschrifteZellen(koerper, spalten.map((s) => (Array.isArray(s) ? s[0] : s)));
    leer.replaceChildren(
      gefiltert.length === 0
        ? leerKarte(
            wahl === "kommend"
              ? "Kein Höck in Sicht."
              : "Keine Höcks in dieser Ansicht.",
          )
        : "",
    );
  }
  zeichne();
  return el("div", { class: "lg-sm-liste" }, filter.wurzel, wurzel, leer);
}

// ---- Anwesenheit (gemeinsam für Detail und Modus) ----

// mitglieder: [{ personId, name, anwesend }]; Häkchen setzen die Anwesenheit sofort, bei einem Fehler springt es zurück
function anwesenheit({ ctx, lagerId, hoeckId, mitglieder, kannAendern }) {
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const zaehle = () => {
    const da = mitglieder.filter((m) => m.anwesend).length;
    zaehler.textContent = `${da} von ${mehrzahl(mitglieder.length, "Mitglied", "Mitgliedern")} anwesend`;
  };
  const eintraege = mitglieder.map((m) => {
    if (!kannAendern)
      return el(
        "li",
        { class: "lg-sm-person" },
        avatar(m.name, { hell: true }),
        m.name,
      );
    const k = ankreuzen({ label: m.name, wert: m.personId, gewaehlt: m.anwesend });
    k.eingabe.addEventListener("change", async () => {
      const da = k.eingabe.checked;
      k.eingabe.disabled = true;
      try {
        await anfrage(
          da ? "PUT" : "DELETE",
          `${basis(lagerId)}/hoecks/${hoeckId}/anwesende/${m.personId}`,
        );
        m.anwesend = da;
        zaehle();
      } catch (f) {
        k.eingabe.checked = !da;
        ctx.melde(`${m.name}: ${meldung(f)}`, "fehler");
      } finally {
        k.eingabe.disabled = false;
      }
    });
    return el("li", { class: "lg-sm-person" }, k.wurzel);
  });
  zaehle();
  return el(
    "div",
    { class: "lg-sm-anwesenheit" },
    zaehler,
    mitglieder.length === 0
      ? el("p", { class: "leise" }, "Niemand ist als anwesend eingetragen.")
      : el("ul", { class: "lg-sm-personen" }, eintraege),
  );
}

// ---- Detail ----

function detail(bereich, ctx, lagerId, lagerRoh, hoeckId) {
  ctx.kopfAktion();
  ctx.lade(
    async () => {
      const lager = await holeLager(lagerId, lagerRoh);
      const alle = darf(lager, ...LESEN);
      const h = await anfrage("GET", `${basis(lagerId)}/hoecks/${hoeckId}`);
      const [mitglieder, naechste] = await Promise.all([
        alle ? ladeMitglieder(lagerId) : [],
        alle && darf(lager, "hoecks.bearbeiten")
          ? anfrage("GET", `${basis(lagerId)}/traktanden/naechster`)
          : null,
      ]);
      return { lager, h, mitglieder, naechste: naechste?.traktanden ?? [] };
    },
    (d, neu) => zeichneDetail(bereich, ctx, lagerId, d, neu),
    { skeleton: "detail" },
  );
}

function zeichneDetail(bereich, ctx, lagerId, { lager, h, mitglieder, naechste }, neu) {
  const schreiben = darfSchreiben(lager, "hoecks.bearbeiten");
  const voll = Array.isArray(h.traktanden);
  ctx.titel(h.titel, lager.titel);
  const hauptblock = el(
    "section",
    { class: "flaeche lg-sm-kopfblock", "aria-label": "Angaben zum Höck" },
    el(
      "dl",
      { class: "lg-sm-angaben" },
      el("div", {}, el("dt", {}, "Datum"), el("dd", {}, datumMitTag(h.datum))),
      el("div", {}, el("dt", {}, "Uhrzeit"), el("dd", {}, h.zeit ?? "–")),
      el("div", {}, el("dt", {}, "Ort"), el("dd", {}, h.ort ?? "–")),
      voll &&
        el(
          "div",
          {},
          el("dt", {}, "Wer sieht ihn?"),
          el("dd", {}, h.art === "lagerleitung" ? "Lagerleitung und Leitung" : "Alle Mitglieder"),
        ),
      voll &&
        h.gaeste &&
        el("div", {}, el("dt", {}, "Gäste"), el("dd", {}, h.gaeste)),
      voll &&
        h.protokollId &&
        el(
          "div",
          {},
          el("dt", {}, "Protokoll"),
          el(
            "dd",
            {},
            el(
              "a",
              { class: "lg-verweis", href: adresse(lagerId, "protokolle") },
              "Zu den Protokollen",
            ),
          ),
        ),
    ),
  );
  const loeschen = () =>
    ctx.mitRueckgaengig({
      text: `Höck «${h.titel}» gelöscht`,
      ausfuehren: () =>
        anfrage("DELETE", `${basis(lagerId)}/hoecks/${h.id}?version=${h.version}`),
      ansicht: {
        weg: () => bereich.setAttribute("hidden", ""),
        zurueck: () => bereich.removeAttribute("hidden"),
      },
      danach: () => {
        ctx.melde("Höck gelöscht.");
        location.hash = adresse(lagerId, "hoecks");
      },
      fehlertext: meldung,
      erledigt: "Höck gelöscht.",
    });
  ctx.kopfAktion(
    aktualisieren(neu),
    voll &&
      el(
        "a",
        { class: "knopf", href: adresse(lagerId, "hoecks", h.id, "modus") },
        icon("weiter"),
        "Höck-Modus",
      ),
  );
  const aktionen = el(
    "div",
    { class: "aktionen lg-sm-aktionen" },
    schreiben &&
      knopf("Bearbeiten", {
        symbol: "bearbeiten",
        onclick: () =>
          hoeckFormular({ ctx, lagerId, start: h, danach: () => neu() }),
      }),
    el(
      "a",
      {
        class: "knopf",
        href: `${basis(lagerId)}/hoecks/${h.id}.ics`,
        download: `hoeck-${h.datum}.ics`,
      },
      icon("kalender"),
      "Kalenderdatei laden",
    ),
    schreiben &&
      knopf("Löschen", { art: "gefahr", symbol: "papierkorb", onclick: loeschen }),
  );
  hauptblock.append(aktionen);
  bereich.append(
    zurueckLink("Zu den Höcks", adresse(lagerId, "hoecks")),
    schreibschutz(lager) || "",
    hauptblock,
  );
  if (!voll) {
    bereich.append(
      el(
        "p",
        { class: "hinweis hinweis--info" },
        "Du siehst von diesem Höck nur, wann, was und wo. Traktanden und Anwesende sind der Leitung vorbehalten.",
      ),
    );
    return;
  }
  const anwesendIds = new Set(h.anwesende.map((p) => p.id));
  const liste =
    mitglieder.length > 0
      ? mitglieder.map((m) => ({ ...m, anwesend: anwesendIds.has(m.personId) }))
      : h.anwesende.map((p) => ({ personId: p.id, name: personName(p), anwesend: true }));
  bereich.append(
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "lg-sm-anw" },
      el("h2", { id: "lg-sm-anw" }, "Anwesende"),
      anwesenheit({
        ctx,
        lagerId,
        hoeckId: h.id,
        mitglieder: liste,
        kannAendern: schreiben && mitglieder.length > 0,
      }),
    ),
  );
  if (schreiben && naechste.length > 0) {
    bereich.append(
      el(
        "div",
        { class: "hinweis hinweis--info lg-sm-uebernehmen" },
        el(
          "span",
          {},
          `${mehrzahl(naechste.length, "Punkt wartet", "Punkte warten")} auf den nächsten Höck.`,
        ),
        knopf("In diesen Höck übernehmen", {
          klein: true,
          onclick: async () => {
            try {
              const r = await anfrage(
                "POST",
                `${basis(lagerId)}/hoecks/${h.id}/traktanden/uebernehmen`,
                {},
              );
              ctx.melde(`${mehrzahl(r.uebernommen, "Punkt", "Punkte")} übernommen.`);
              await neu();
            } catch (f) {
              ctx.melde(meldung(f), "fehler");
            }
          },
        }),
      ),
    );
  }
  bereich.append(
    el(
      "section",
      { class: "flaeche", "aria-label": "Traktanden" },
      traktandenBlock({
        ctx,
        lager,
        lagerId,
        hoeckId: h.id,
        traktanden: h.traktanden,
        mitglieder,
        laden: neu,
      }),
    ),
  );
}

// ---- Höck-Modus ----

function modus(bereich, ctx, lagerId, lagerRoh, hoeckId) {
  ctx.kopfAktion();
  ctx.lade(
    async () => {
      const lager = await holeLager(lagerId, lagerRoh);
      const m = await anfrage("GET", `${basis(lagerId)}/hoecks/${hoeckId}/modus`);
      return { lager, m };
    },
    (d, neu) => zeichneModus(bereich, ctx, lagerId, d, neu),
    { skeleton: "detail" },
  );
}

function zeichneModus(bereich, ctx, lagerId, { lager, m }, neu) {
  const h = m.hoeck;
  const schreiben = darfSchreiben(lager, "hoecks.bearbeiten");
  ctx.titel(`Höck-Modus: ${h.titel}`, `${datumMitTag(h.datum)}${h.zeit ? `, ${h.zeit}` : ""}`);
  ctx.kopfAktion(aktualisieren(neu));
  const punkte = h.traktanden;
  // Der erste offene Punkt ist der aktuelle
  let aktuell = Math.max(
    0,
    punkte.findIndex((t) => t.status === "offen"),
  );
  const buehne = el("section", {
    class: "flaeche lg-sm-buehne",
    "aria-label": "Aktueller Punkt",
  });
  const ablauf = el("ol", { class: "lg-sm-ablauf" });
  const zeigeAblauf = () =>
    ablauf.replaceChildren(
      ...punkte.map((t, i) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "lg-sm-ablaufknopf",
              "aria-current": i === aktuell ? "step" : undefined,
              onclick: () => {
                aktuell = i;
                zeichnePunkt();
              },
            },
            el("span", { class: "lg-sm-nr" }, String(i + 1)),
            el("span", {}, t.titel),
            t.status === "besprochen" &&
              el("span", { class: "chip chip--ok" }, icon("haken"), "Besprochen"),
          ),
        ),
      ),
    );
  function zeichnePunkt() {
    zeigeAblauf();
    if (punkte.length === 0) {
      buehne.replaceChildren(
        leerKarte("Dieser Höck hat noch keine Traktanden."),
      );
      return;
    }
    const t = punkte[aktuell];
    const entscheid = feld({
      label: "Entscheid",
      mehrzeilig: true,
      rows: "3",
      wert: t.entscheid ?? "",
      maxlength: 1000,
      disabled: !schreiben,
    });
    const speichern = knopf(t.status === "besprochen" ? "Entscheid speichern" : "Als besprochen speichern", {
      art: "haupt",
      symbol: "haken",
    });
    speichern.addEventListener("click", async () => {
      speichern.disabled = true;
      try {
        await anfrage("PATCH", `${basis(lagerId)}/traktanden/${t.id}`, {
          version: t.version,
          status: "besprochen",
          entscheid: entscheid.eingabe.value.trim() || null,
        });
        ctx.melde(`«${t.titel}» ist besprochen.`);
        await neu();
      } catch (f) {
        speichern.disabled = false;
        await nachSchreibfehler(ctx, f, neu);
      }
    });
    const schieben = knopf("Auf nächsten Höck schieben", {
      onclick: async () => {
        try {
          await anfrage("PATCH", `${basis(lagerId)}/traktanden/${t.id}`, {
            version: t.version,
            hoeckId: null,
          });
          ctx.melde(`«${t.titel}» liegt bei den Punkten für den nächsten Höck.`);
          await neu();
        } catch (f) {
          await nachSchreibfehler(ctx, f, neu);
        }
      },
    });
    buehne.replaceChildren(
      el(
        "p",
        { class: "klein leise" },
        `Punkt ${aktuell + 1} von ${punkte.length}${t.dauerMinuten ? `, geplant ${t.dauerMinuten} Min.` : ""}`,
      ),
      el("h2", { class: "lg-sm-gross" }, t.titel),
      t.verantwortliche.length > 0 &&
        el(
          "p",
          { class: "leise" },
          `Verantwortlich: ${t.verantwortliche.map(personName).join(", ")}`,
        ),
      t.text && el("p", { class: "lg-sm-text" }, t.text),
      t.links.length > 0 &&
        el(
          "ul",
          { class: "lg-sm-links" },
          t.links.map((l) =>
            el(
              "li",
              {},
              el(
                "a",
                {
                  class: "lg-verweis",
                  href: l.url,
                  target: "_blank",
                  rel: "noopener noreferrer",
                },
                l.titel,
                el("span", { class: "nur-leser" }, " (öffnet in neuem Tab)"),
              ),
            ),
          ),
        ),
      entscheid.wurzel,
      el(
        "div",
        { class: "aktionen lg-sm-aktionen" },
        knopf("Zurück", {
          symbol: "zurueck",
          disabled: aktuell === 0,
          onclick: () => {
            aktuell--;
            zeichnePunkt();
          },
        }),
        knopf("Weiter", {
          disabled: aktuell === punkte.length - 1,
          onclick: () => {
            aktuell++;
            zeichnePunkt();
          },
        }),
        schreiben && speichern,
        schreiben && schieben,
      ),
    );
  }
  zeichnePunkt();
  const liste = m.mitglieder.map((x) => ({
    personId: x.id,
    name: personName(x),
    anwesend: x.anwesend,
  }));
  const rechts = el(
    "div",
    { class: "lg-sm-spalte" },
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "lg-sm-anw" },
      el("h2", { id: "lg-sm-anw" }, "Anwesenheit"),
      anwesenheit({ ctx, lagerId, hoeckId: h.id, mitglieder: liste, kannAendern: schreiben }),
    ),
    darfSchreiben(lager, "protokolle.bearbeiten") &&
      beschlussFeld({ ctx, lagerId, hoeckId: h.id }),
    m.ressortRunde && ressortRunde(m.ressortRunde),
  );
  bereich.append(
    zurueckLink("Zum Höck", adresse(lagerId, "hoecks", h.id)),
    schreibschutz(lager) || "",
    el(
      "div",
      { class: "lg-sm-modus" },
      el(
        "div",
        { class: "lg-sm-spalte" },
        buehne,
        el(
          "section",
          { class: "flaeche", "aria-labelledby": "lg-sm-abl" },
          el("h2", { id: "lg-sm-abl" }, "Ablauf"),
          ablauf,
        ),
      ),
      rechts,
    ),
  );
}

// Einen Beschluss des Höcks festhalten (Text, Verknüpfung auf den Höck)
function beschlussFeld({ ctx, lagerId, hoeckId }) {
  const text = feld({
    label: "Beschluss festhalten",
    mehrzeilig: true,
    rows: "3",
    maxlength: 1000,
    hilfe: "Ein Satz genügt. Er erscheint unter «Protokolle und Beschlüsse».",
  });
  const knopfSpeichern = knopf("Festhalten", { symbol: "plus" });
  knopfSpeichern.addEventListener("click", async () => {
    const t = text.eingabe.value.trim();
    if (!t) {
      text.eingabe.focus();
      return;
    }
    knopfSpeichern.disabled = true;
    try {
      await anfrage("POST", `${basis(lagerId)}/beschluesse`, { text: t, hoeckId });
      text.eingabe.value = "";
      ctx.melde("Beschluss festgehalten.");
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
    } finally {
      knopfSpeichern.disabled = false;
    }
  });
  return el(
    "section",
    { class: "flaeche", "aria-label": "Beschluss festhalten" },
    text.wurzel,
    el("div", { class: "aktionen" }, knopfSpeichern),
  );
}

// Die Runde durch die Ressorts: Leitung, Zahlen und offene Aufgaben
function ressortRunde(runde) {
  return el(
    "section",
    { class: "flaeche", "aria-labelledby": "lg-sm-rr" },
    el("h2", { id: "lg-sm-rr" }, "Ressort-Runde"),
    runde.length === 0
      ? el("p", { class: "leise" }, "Es gibt noch keine Ressorts.")
      : el(
          "ul",
          { class: "lg-sm-runde" },
          runde.map((r) =>
            el(
              "li",
              {},
              el(
                "details",
                { class: "lg-sm-ressort" },
                el(
                  "summary",
                  {},
                  el("span", { class: "fett" }, `${r.kuerzel} ${r.name}`),
                  r.aufgaben &&
                    el(
                      "span",
                      { class: "klein leise" },
                      ` ${r.aufgaben.offen} offen${r.aufgaben.ueberfaellig > 0 ? `, ${r.aufgaben.ueberfaellig} überfällig` : ""}`,
                    ),
                ),
                r.leitung &&
                  el("p", { class: "klein leise" }, `Leitung: ${personName(r.leitung)}`),
                r.offeneAufgaben && r.offeneAufgaben.length > 0
                  ? el(
                      "ul",
                      {},
                      r.offeneAufgaben.map((a) =>
                        el(
                          "li",
                          {},
                          a.titel,
                          a.verantwortlich &&
                            el(
                              "span",
                              { class: "klein leise" },
                              ` (${personName(a.verantwortlich)})`,
                            ),
                        ),
                      ),
                    )
                  : el("p", { class: "klein leise" }, "Keine offenen Aufgaben zu sehen."),
              ),
            ),
          ),
        ),
  );
}

