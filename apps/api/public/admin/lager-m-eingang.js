import { anfrage } from "./api.js";
import {
  ankreuzen,
  auswahl,
  dialogFormular,
  el,
  feld,
  geheimnisDialog,
  icon,
  knopf,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonVon } from "./lager-skeleton.js";
import { leerKarte } from "./zustaende.js";
import {
  beschrifteZellen,
  datumKurz,
  kartenTabelle,
  nichtGefunden,
} from "./lager-gemeinsam.js";
import {
  adresse,
  alleSeiten,
  basis,
  darf,
  darfSchreiben,
  datumMitTag,
  holeLager,
  konfliktBox,
  meldung,
  personName,
  restPfad,
  kinder,
} from "./lager-sm-gemeinsam.js";

// Modul «Eingang» im Lager-Arbeitsbereich (#673): Ideen, Wünsche, Fragen und Feedback an die Lagerleitung. Wer eingang.senden hat, schreibt eine Meldung (auch anonym) und liest die eigenen Antworten; wer eingang.lesen hat, sieht alle Meldungen, wer eingang.antworten hat, beantwortet und ordnet sie zu. Anonym heisst: Der Server speichert keine Person. Der Rückfragecode erscheint genau einmal. Texte der Meldungen stehen nie in der Adresse oder im Titel der Seite. Adressen: …/eingang und …/eingang/eigene.

const ARTEN = {
  idee: "Idee",
  wunsch: "Wunsch",
  frage: "Frage",
  feedback: "Feedback",
};
const STATUS = {
  neu: ["Neu", "warn"],
  in_arbeit: ["In Arbeit", undefined],
  erledigt: ["Erledigt", "ok"],
};
const statusChip = (s) => {
  const [text, art] = STATUS[s] ?? [s, undefined];
  return el(
    "span",
    { class: art ? `chip chip--${art}` : "chip" },
    art === "ok" && icon("haken"),
    art === "warn" && icon("warnung"),
    text,
  );
};
const kurz = (text, n = 120) =>
  text.length > n ? `${text.slice(0, n).trimEnd()} …` : text;

export function zeige(bereich, ctx, lagerId, lagerRoh) {
  const [unter, weiter] = restPfad(ctx, lagerId);
  if (weiter !== undefined || (unter !== undefined && unter !== "eigene"))
    return ctx.lade(nichtGefunden, () => {});
  ctx.lade(
    async () => ({ lager: await holeLager(lagerId, lagerRoh) }),
    ({ lager }) => {
      const lesen = darf(lager, "eingang.lesen");
      const senden = darf(lager, "eingang.senden");
      const tabs = [
        lesen && [
          "Alle Meldungen",
          adresse(lagerId, "eingang"),
          unter === undefined,
        ],
        senden && [
          "Meine Meldungen",
          adresse(lagerId, "eingang", "eigene"),
          unter === "eigene",
        ],
      ].filter(Boolean);
      if (tabs.length > 1)
        bereich.append(
          ...kinder(
            el(
              "nav",
              { class: "tabs", "aria-label": "Eingang" },
              tabs.map(([text, href, aktiv]) =>
                el(
                  "a",
                  {
                    class: "tab",
                    href,
                    "aria-current": aktiv ? "page" : undefined,
                  },
                  text,
                ),
              ),
            ),
          ),
        );
      const inhalt = el("div", { class: "lg-sm-inhalt" });
      bereich.append(...kinder(inhalt));
      const lade = ctx.erstelleLader(inhalt);
      const eigene = unter === "eigene" || (!lesen && senden);
      if (eigene && senden) eigeneAnsicht(inhalt, ctx, lagerId, lager, lade);
      else if (lesen) alleAnsicht(inhalt, ctx, lagerId, lager, lade);
      else
        inhalt.append(
          ...kinder(
            leerKarte(
              "Deine Rolle darf den Eingang weder lesen noch etwas einsenden.",
            ),
          ),
        );
    },
    { skeleton: false },
  );
}

// ---- Alle Meldungen (eingang.lesen) ----

function alleAnsicht(inhalt, ctx, lagerId, lager, lade) {
  lade(
    async () => {
      const [meldungen, ressorts, hoecks] = await Promise.all([
        alleSeiten(`${basis(lagerId)}/eingang`, "eintraege", { limit: 100 }),
        darf(lager, "ressorts.lesen")
          ? alleSeiten(`${basis(lagerId)}/ressorts`, "ressorts", {
              limit: 100,
            }).catch(() => [])
          : [],
        darf(lager, "hoecks.bearbeiten")
          ? alleSeiten(`${basis(lagerId)}/hoecks`, "hoecks", {
              limit: 200,
            }).catch(() => [])
          : [],
      ]);
      return { meldungen, ressorts, hoecks };
    },
    (d, neu) => zeichneAlle(inhalt, ctx, lagerId, lager, d, neu),
    {
      skeleton: skeletonVon({
        filter: 3,
        inhalt: "tabelle",
        zeilen: 4,
        spalten: 6,
      }),
    },
  );
}

function zeichneAlle(
  inhalt,
  ctx,
  lagerId,
  lager,
  { meldungen, ressorts, hoecks },
  neu,
) {
  const antworten = darfSchreiben(lager, "eingang.antworten");
  if (meldungen.length === 0) {
    inhalt.append(...kinder(leerKarte("Noch nichts eingegangen.")));
    return;
  }
  const stand = { suche: "", art: "alle", status: "alle" };
  const leiste = filterleiste({
    suche: { label: "Meldungen durchsuchen" },
    filter: [
      {
        schluessel: "art",
        label: "Art",
        grundwert: "alle",
        optionen: [["alle", "Alle"], ...Object.entries(ARTEN)],
      },
      {
        schluessel: "status",
        label: "Status",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ...Object.entries(STATUS).map(([k, v]) => [k, v[0]]),
        ],
      },
    ],
    namen: { einzahl: "Meldung", mehrzahl: "Meldungen" },
    beiAenderung: (n) => {
      stand.suche = n.suche.trim().toLowerCase();
      stand.art = n.filter.art;
      stand.status = n.filter.status;
      zeichne();
    },
  });
  const spalten = [
    "Eingegangen",
    "Art",
    "Meldung",
    "Von",
    "Status",
    "Zuordnung",
  ];
  if (antworten) spalten.push("Aktionen");
  const { wurzel, koerper } = tabelle({
    beschriftung: "Meldungen",
    spalten,
    zeilen: [],
  });
  kartenTabelle(wurzel);
  const leer = el("div");
  function zeichne() {
    const treffer = meldungen.filter(
      (m) =>
        (stand.art === "alle" || m.art === stand.art) &&
        (stand.status === "alle" || m.status === stand.status) &&
        (stand.suche === "" ||
          m.text.toLowerCase().includes(stand.suche) ||
          (m.antwort ?? "").toLowerCase().includes(stand.suche)),
    );
    koerper.replaceChildren(
      ...kinder(
        ...treffer.map((m) =>
          el(
            "tr",
            {},
            el("td", { class: "lg-zahlen" }, datumMitTag(m.erstelltTag)),
            el("td", {}, el("span", { class: "chip" }, ARTEN[m.art] ?? m.art)),
            el(
              "td",
              { class: "lg-sm-meldungstext" },
              kurz(m.text),
              m.antwort &&
                el(
                  "span",
                  { class: "klein leise lg-sm-antwortzeile" },
                  `Antwort: ${kurz(m.antwort, 80)}`,
                ),
            ),
            el(
              "td",
              {},
              m.anonym
                ? el("span", { class: "chip" }, "Anonym")
                : m.von
                  ? personName(m.von)
                  : "–",
            ),
            el("td", {}, statusChip(m.status)),
            el(
              "td",
              {},
              [
                m.ressortId &&
                  (ressorts.find((r) => r.id === m.ressortId)?.kuerzel ??
                    "Ressort"),
                m.traktandumId && "Traktandum",
              ]
                .filter(Boolean)
                .join(", ") || "–",
            ),
            antworten &&
              el(
                "td",
                { class: "rechts" },
                el(
                  "div",
                  { class: "aktionen" },
                  knopf("Öffnen", {
                    klein: true,
                    kontext: `Meldung vom ${datumKurz(m.erstelltTag)}`,
                    onclick: () =>
                      antwortFormular({
                        ctx,
                        lagerId,
                        lager,
                        m,
                        ressorts,
                        danach: neu,
                      }),
                  }),
                  darf(lager, "hoecks.bearbeiten") &&
                    (m.traktandumId
                      ? knopf("Traktandum zurücknehmen", {
                          klein: true,
                          art: "still",
                          kontext: `Meldung vom ${datumKurz(m.erstelltTag)}`,
                          onclick: () =>
                            ctx.mitRueckgaengig({
                              text: "Traktandum zurückgenommen",
                              ausfuehren: () =>
                                anfrage(
                                  "DELETE",
                                  `${basis(lagerId)}/eingang/${m.id}/traktandum?version=${m.version}`,
                                ),
                              danach: neu,
                              fehlertext: meldung,
                              erledigt: "Traktandum zurückgenommen.",
                            }),
                        })
                      : knopf("Als Traktandum", {
                          klein: true,
                          art: "still",
                          kontext: `Meldung vom ${datumKurz(m.erstelltTag)}`,
                          onclick: () =>
                            traktandumFormular({
                              ctx,
                              lagerId,
                              m,
                              hoecks,
                              danach: neu,
                            }),
                        })),
                ),
              ),
          ),
        ),
      ),
    );
    beschrifteZellen(koerper, spalten);
    leer.replaceChildren(
      ...kinder(
        treffer.length === 0
          ? leerKarte("Keine Meldung passt zu deinem Filter.")
          : "",
      ),
    );
    leiste.setzeTreffer(treffer.length, meldungen.length);
  }
  inhalt.append(
    ...kinder(
      el(
        "p",
        { class: "hinweis hinweis--info" },
        "Anonyme Meldungen haben keine Person. Auch die Lagerleitung sieht sie nicht.",
      ),
      leiste.wurzel,
      wurzel,
      leer,
    ),
  );
  zeichne();
}

function antwortFormular({ ctx, lagerId, m, ressorts, danach }) {
  let version = m.version;
  const antwort = feld({
    label: "Antwort",
    mehrzeilig: true,
    rows: "5",
    wert: m.antwort ?? "",
    maxlength: 5000,
    hilfe: m.anonym
      ? "Die Person liest die Antwort mit ihrem Rückfragecode."
      : "Die Person sieht die Antwort bei «Meine Meldungen» und bekommt eine Benachrichtigung.",
  });
  const status = auswahl({
    label: "Status",
    optionen: Object.entries(STATUS).map(([k, v]) => [k, v[0]]),
    wert: m.status,
  });
  const ressort =
    ressorts.length > 0
      ? auswahl({
          label: "Ressort",
          optionen: [
            ["", "Keines"],
            ...ressorts.map((r) => [r.id, `${r.kuerzel} ${r.name}`]),
          ],
          wert: m.ressortId ?? "",
        })
      : null;
  const konflikt = konfliktBox({
    namen: {
      status: "Status",
      antwort: "Antwort",
      ressortId: "Ressort",
      traktandumId: "Traktandum",
    },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      antwort.eingabe.value = a.antwort ?? "";
      status.eingabe.value = a.status;
      status.eingabe.dispatchEvent(new Event("change"));
      if (ressort) {
        ressort.eingabe.value = a.ressortId ?? "";
        ressort.eingabe.dispatchEvent(new Event("change"));
      }
    },
  });
  return dialogFormular({
    titel: "Meldung öffnen",
    beschreibung: `${ARTEN[m.art] ?? m.art} vom ${datumKurz(m.erstelltTag)}${m.anonym ? ", anonym" : ""}.`,
    felder: [
      konflikt.wurzel,
      el("p", { class: "lg-sm-text lg-sm-zitat" }, m.text),
      antwort.wurzel,
      status.wurzel,
      ressort?.wurzel,
    ].filter(Boolean),
    ok: "Speichern",
    fehlertext: meldung,
    senden: async () => {
      const aenderung = {};
      const a = antwort.eingabe.value.trim();
      if (a !== (m.antwort ?? "")) aenderung.antwort = a === "" ? null : a;
      if (status.eingabe.value !== m.status)
        aenderung.status = status.eingabe.value;
      if (ressort && (ressort.eingabe.value || null) !== (m.ressortId ?? null))
        aenderung.ressortId = ressort.eingabe.value || null;
      if (Object.keys(aenderung).length === 0) return m;
      try {
        return await anfrage("PATCH", `${basis(lagerId)}/eingang/${m.id}`, {
          version,
          ...aenderung,
        });
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: () => {
      ctx.melde("Gespeichert.");
      return danach();
    },
  });
}

function traktandumFormular({ ctx, lagerId, m, hoecks, danach }) {
  const titel = feld({
    label: "Titel des Traktandums",
    maxlength: 200,
    required: true,
    autocomplete: "off",
    hilfe:
      "Schreibe einen eigenen Titel. Der Text der Meldung geht nicht ins Traktandum.",
  });
  const heute = new Date().toISOString().slice(0, 10);
  const zukunft = hoecks.filter((h) => h.datum >= heute);
  const hoeck = auswahl({
    label: "Wohin?",
    optionen: [
      ["", "Punkte für den nächsten Höck"],
      ...zukunft.map((h) => [h.id, `${h.titel}, ${datumMitTag(h.datum)}`]),
    ],
    wert: "",
  });
  return dialogFormular({
    titel: "Als Traktandum",
    felder: [titel.wurzel, hoeck.wurzel],
    ok: "Traktandum anlegen",
    fehlertext: meldung,
    senden: () =>
      anfrage("POST", `${basis(lagerId)}/eingang/${m.id}/traktandum`, {
        version: m.version,
        titel: titel.eingabe.value.trim(),
        hoeckId: hoeck.eingabe.value || null,
      }),
    danach: () => {
      ctx.melde("Traktandum angelegt.");
      return danach();
    },
  });
}

// ---- Meine Meldungen (eingang.senden) ----

function eigeneAnsicht(inhalt, ctx, lagerId, lager, lade) {
  lade(
    () =>
      alleSeiten(`${basis(lagerId)}/eingang/eigene`, "eintraege", {
        limit: 100,
      }),
    (liste, neu) => zeichneEigene(inhalt, ctx, lagerId, lager, liste, neu),
    {
      skeleton: skeletonVon({ inhalt: "tabelle", zeilen: 3, spalten: 4 }),
    },
  );
}

function zeichneEigene(inhalt, ctx, lagerId, lager, liste, neu) {
  const schreiben = darfSchreiben(lager, "eingang.senden");
  if (schreiben) inhalt.append(...kinder(sendeFormular(ctx, lagerId, neu)));
  inhalt.append(
    ...kinder(
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "lg-sm-eigene" },
        el("h2", { id: "lg-sm-eigene" }, "Meine Meldungen"),
        liste.length === 0
          ? el("p", { class: "leise" }, "Du hast noch nichts gesendet.")
          : el(
              "ul",
              { class: "lg-sm-karten" },
              liste.map((m) =>
                el(
                  "li",
                  { class: "lg-sm-eigene" },
                  el(
                    "div",
                    { class: "lg-sm-trakt-kopf" },
                    el("span", { class: "chip" }, ARTEN[m.art] ?? m.art),
                    statusChip(m.status),
                    el(
                      "span",
                      { class: "klein leise" },
                      datumKurz(m.erstelltTag),
                    ),
                  ),
                  el("p", { class: "lg-sm-text" }, m.text),
                  m.antwort &&
                    el(
                      "div",
                      { class: "lg-sm-antwort" },
                      el("span", { class: "fett" }, "Antwort: "),
                      m.antwort,
                    ),
                ),
              ),
            ),
      ),
      codePruefung(lagerId),
    ),
  );
}

function sendeFormular(ctx, lagerId, neu) {
  const art = auswahl({
    label: "Art",
    optionen: Object.entries(ARTEN),
    wert: "idee",
  });
  const text = feld({
    label: "Deine Meldung",
    mehrzeilig: true,
    rows: "5",
    maxlength: 5000,
    hilfe: "Schreibe hier keine Gesundheitsdaten und keine Namen von Kindern.",
  });
  const anonym = ankreuzen({ label: "Anonym senden", gewaehlt: false });
  const hinweis = el(
    "p",
    { class: "hilfe" },
    "Anonym heisst: Niemand sieht, wer du bist. Du bekommst einen Rückfragecode und liest damit später die Antwort. Der Code erscheint nur einmal.",
  );
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
  });
  const senden = knopf("Senden", { art: "haupt", symbol: "weiter" });
  senden.addEventListener("click", async () => {
    fehler.hidden = true;
    const t = text.eingabe.value.trim();
    if (!t) {
      text.eingabe.focus();
      fehler.textContent = "Schreibe zuerst deine Meldung.";
      fehler.hidden = false;
      return;
    }
    senden.disabled = true;
    senden.setAttribute("aria-busy", "true");
    try {
      const r = await anfrage("POST", `${basis(lagerId)}/eingang`, {
        art: art.eingabe.value,
        text: t,
        anonym: anonym.eingabe.checked,
      });
      text.eingabe.value = "";
      if (r.anonym && r.rueckfragecode) {
        geheimnisDialog({
          titel: "Dein Rückfragecode",
          beschreibung:
            "Schreibe ihn auf. Du siehst ihn nur jetzt. Damit liest du später die Antwort auf deine anonyme Meldung.",
          wert: r.rueckfragecode,
        });
      } else {
        ctx.melde("Danke, deine Meldung ist angekommen.");
        await neu();
      }
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
    } finally {
      senden.disabled = false;
      senden.removeAttribute("aria-busy");
    }
  });
  return el(
    "section",
    { class: "flaeche", "aria-labelledby": "lg-sm-neu" },
    el("h2", { id: "lg-sm-neu" }, "Neue Meldung"),
    art.wurzel,
    text.wurzel,
    el("div", { class: "lg-sm-anonym" }, anonym.wurzel, hinweis),
    fehler,
    el("div", { class: "aktionen" }, senden),
  );
}

// Eine anonyme Meldung mit dem Rückfragecode nachschlagen; der Code bleibt nicht in der Seite
function codePruefung(lagerId) {
  const code = feld({
    label: "Rückfragecode",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: 64,
    hilfe:
      "Für eine anonyme Meldung: Gib den Code ein, den du beim Senden bekommen hast.",
  });
  const ergebnis = el("div", { class: "lg-sm-codeergebnis", role: "status" });
  const los = knopf("Antwort lesen");
  los.addEventListener("click", async () => {
    const c = code.eingabe.value.trim();
    if (!c) {
      code.eingabe.focus();
      return;
    }
    los.disabled = true;
    try {
      const r = await anfrage("POST", `${basis(lagerId)}/eingang/status`, {
        code: c,
      });
      ergebnis.replaceChildren(
        ...kinder(
          el(
            "div",
            { class: "lg-sm-eigene" },
            el(
              "div",
              { class: "lg-sm-trakt-kopf" },
              el("span", { class: "chip" }, ARTEN[r.art] ?? r.art),
              statusChip(r.status),
              el("span", { class: "klein leise" }, datumKurz(r.erstelltTag)),
            ),
            r.antwort
              ? el(
                  "div",
                  { class: "lg-sm-antwort" },
                  el("span", { class: "fett" }, "Antwort: "),
                  r.antwort,
                )
              : el("p", { class: "leise" }, "Noch keine Antwort."),
          ),
        ),
      );
    } catch (f) {
      ergebnis.replaceChildren(
        ...kinder(
          el(
            "p",
            { class: "hinweis hinweis--fehler" },
            f?.status === 404
              ? "Zu diesem Code gibt es keine Meldung. Prüfe ihn."
              : meldung(f),
          ),
        ),
      );
    } finally {
      los.disabled = false;
    }
  });
  return el(
    "section",
    { class: "flaeche", "aria-labelledby": "lg-sm-code" },
    el("h2", { id: "lg-sm-code" }, "Antwort auf eine anonyme Meldung"),
    code.wurzel,
    el("div", { class: "aktionen" }, los),
    ergebnis,
  );
}
