import { ApiFehler, anfrage } from "./api.js";
import { ankreuzen, dialogFormular, el, feld, knopf, tabelle } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import {
  beschrifteZellen,
  datumKurz,
  kartenTabelle,
  nichtGefunden,
} from "./lager-gemeinsam.js";
import {
  alleSeiten,
  basis,
  dateiEingabe,
  dateiLink,
  darfSchreiben,
  holeLager,
  konfliktBox,
  meldung,
  restPfad,
  kinder,
} from "./lager-sm-gemeinsam.js";

// Modul «Dokumente» im Lager-Arbeitsbereich (#673): Dateien des Lagers als Verknüpfung auf den Ablageort (SharePoint). Cevi OS speichert nur Titel, Stichworte und den Link, nie den Inhalt; der Link öffnet direkt am Ablageort, der selbst regelt, wer die Datei sieht. Dazu die Dateien, die andere Module (Pinnwand, Protokolle) einbinden. Unten legt die Abteilungsleitung fest, auf welchen Orten die Links liegen dürfen (GET und PUT /api/v1/admin/lager-dateien/hosts). Adresse: …/dokumente. Rechte: dokumente.lesen_alle, dokumente.team_lesen, dokumente.bearbeiten.

const ARTEN = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  bild: "Bild",
  link: "Link",
};
const QUELLE = {
  dokument: "Dokument",
  pinnwand_datei: "Pinnwand",
  protokoll: "Protokoll",
  info_abschnitt_datei: "Infos",
  tagesseite_block: "Tagesseiten",
};
const MAX_STICHWORTE = 20;
const HOSTS_BASIS = "/api/v1/admin/lager-dateien/hosts";
// Wie beim Server (lager/datei.ts): Namen mit Punkt, Buchstaben, Ziffern und Bindestrichen
const HOST =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function zeige(bereich, ctx, lagerId, lagerRoh) {
  if (restPfad(ctx, lagerId).length > 0)
    return ctx.lade(nichtGefunden, () => {});
  ctx.lade(
    async () => {
      const lager = await holeLager(lagerId, lagerRoh);
      const [dokumente, hosts] = await Promise.all([
        alleSeiten(`${basis(lagerId)}/dokumente`, "dokumente", { limit: 100 }),
        // Die Hosts der Abteilung sieht nur, wer das Lager verwalten darf; sonst 403 und keine Karte
        anfrage("GET", HOSTS_BASIS)
          .then((r) => ({ erlaubt: true, hosts: r.hosts }))
          .catch(() => ({ erlaubt: false })),
      ]);
      return { lager, dokumente, hosts };
    },
    (d, neu) => zeichne(bereich, ctx, lagerId, d, neu),
    {
      skeleton: () => skeletonTabelle({ spalten: 5, zeilen: 4, avatar: false }),
    },
  );
}

// «a, b ,c» → ["a", "b", "c"] (klein, ohne Doppelte, leere fallen weg)
export function stichworteAusText(text) {
  return [
    ...new Set(
      text
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " ").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function dokumentFormular({ ctx, lagerId, start, danach }) {
  const neu = start === null;
  let version = start?.version;
  const titel = feld({
    label: "Titel",
    wert: start?.titel ?? "",
    maxlength: 200,
    required: true,
    autocomplete: "off",
  });
  const datei = dateiEingabe({ start: start?.datei ?? null });
  const stichworte = feld({
    label: "Stichworte",
    wert: (start?.stichworte ?? []).join(", "),
    autocomplete: "off",
    hilfe: `Freiwillig, mit Komma getrennt, höchstens ${MAX_STICHWORTE}. Damit findest du das Dokument wieder.`,
  });
  const team = ankreuzen({
    label: "Auch das Team sieht das Dokument",
    gewaehlt: start?.teamSichtbar ?? false,
  });
  const werte = () => ({
    titel: titel.eingabe.value.trim(),
    stichworte: stichworteAusText(stichworte.eingabe.value),
    teamSichtbar: team.eingabe.checked,
  });
  const vorher = start && {
    titel: start.titel,
    stichworte: start.stichworte,
    teamSichtbar: start.teamSichtbar ?? false,
  };
  const konflikt = konfliktBox({
    namen: {
      titel: "Titel",
      stichworte: "Stichworte",
      teamSichtbar: "Für das Team sichtbar",
      dateiId: "Datei",
    },
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      titel.eingabe.value = a.titel;
      stichworte.eingabe.value = (a.stichworte ?? []).join(", ");
      team.eingabe.checked = a.teamSichtbar;
    },
  });
  return dialogFormular({
    titel: neu ? "Dokument hinzufügen" : "Dokument bearbeiten",
    beschreibung: "Das Dokument liegt am Ablageort. Hier steht nur der Link.",
    felder: [
      konflikt.wurzel,
      titel.wurzel,
      ...datei.felder,
      stichworte.wurzel,
      team.wurzel,
    ],
    ok: "Speichern",
    fehlertext: meldung,
    pruefe: () => {
      if (werte().stichworte.length <= MAX_STICHWORTE) return false;
      ctx.melde(`Höchstens ${MAX_STICHWORTE} Stichworte.`, "warn");
      stichworte.eingabe.focus();
      return true;
    },
    senden: async () => {
      const w = werte();
      try {
        if (neu) {
          const d = await datei.speichere(lagerId);
          return await anfrage("POST", `${basis(lagerId)}/dokumente`, {
            titel: w.titel,
            dateiId: d.id,
            stichworte: w.stichworte,
            teamSichtbar: w.teamSichtbar,
          });
        }
        const aenderung = {};
        if (w.titel !== vorher.titel) aenderung.titel = w.titel;
        if (JSON.stringify(w.stichworte) !== JSON.stringify(vorher.stichworte))
          aenderung.stichworte = w.stichworte;
        if (w.teamSichtbar !== vorher.teamSichtbar)
          aenderung.teamSichtbar = w.teamSichtbar;
        if (datei.geaendert())
          aenderung.dateiId = (await datei.speichere(lagerId)).id;
        if (Object.keys(aenderung).length === 0) return start;
        return await anfrage(
          "PATCH",
          `${basis(lagerId)}/dokumente/${start.id}`,
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
      ctx.melde(neu ? "Dokument hinzugefügt." : "Dokument gespeichert.");
      return danach();
    },
  });
}

function zeichne(bereich, ctx, lagerId, { lager, dokumente, hosts }, neu) {
  const schreiben = darfSchreiben(lager, "dokumente.bearbeiten");
  if (schreiben)
    bereich.append(
      ...kinder(
        el(
          "div",
          { class: "lg-sm-werkzeug" },
          knopf("Dokument hinzufügen", {
            art: "haupt",
            symbol: "plus",
            onclick: () =>
              dokumentFormular({ ctx, lagerId, start: null, danach: neu }),
          }),
        ),
      ),
    );
  if (dokumente.length === 0) {
    bereich.append(
      ...kinder(
        leerKarte(
          schreiben
            ? "Es gibt noch kein Dokument. Füge das erste hinzu."
            : "Es gibt noch kein Dokument.",
        ),
      ),
    );
  } else {
    bereich.append(
      ...kinder(dokumentTabelle({ ctx, lagerId, schreiben, dokumente, neu })),
    );
  }
  if (hosts.erlaubt)
    bereich.append(...kinder(hostKarte({ ctx, hosts: hosts.hosts, neu })));
}

function dokumentTabelle({ ctx, lagerId, schreiben, dokumente, neu }) {
  const alleStichworte = [
    ...new Set(dokumente.flatMap((d) => d.stichworte)),
  ].sort((a, b) => a.localeCompare(b, "de"));
  const stand = { suche: "", art: "alle", stichwort: "alle" };
  const leiste = filterleiste({
    suche: { label: "Dokumente suchen" },
    filter: [
      {
        schluessel: "art",
        label: "Art",
        grundwert: "alle",
        optionen: [["alle", "Alle"], ...Object.entries(ARTEN)],
      },
      alleStichworte.length > 0 && {
        schluessel: "stichwort",
        label: "Stichwort",
        grundwert: "alle",
        optionen: [["alle", "Alle"], ...alleStichworte.map((s) => [s, s])],
      },
    ].filter(Boolean),
    namen: { einzahl: "Dokument", mehrzahl: "Dokumente" },
    beiAenderung: (n) => {
      stand.suche = n.suche.trim().toLowerCase();
      stand.art = n.filter.art;
      stand.stichwort = n.filter.stichwort ?? "alle";
      zeichneZeilen();
    },
  });
  const spalten = ["Titel", "Art", "Stichworte", "Sichtbar für", "Hinzugefügt"];
  if (schreiben) spalten.push("Aktionen");
  const { wurzel, koerper } = tabelle({
    beschriftung: "Dokumente",
    spalten,
    zeilen: [],
  });
  kartenTabelle(wurzel);
  const leer = el("div");
  function zeichneZeilen() {
    const treffer = dokumente.filter(
      (d) =>
        (stand.art === "alle" || d.art === stand.art) &&
        (stand.stichwort === "alle" ||
          d.stichworte.includes(stand.stichwort)) &&
        (stand.suche === "" ||
          d.titel.toLowerCase().includes(stand.suche) ||
          d.stichworte.some((s) => s.includes(stand.suche))),
    );
    koerper.replaceChildren(
      ...kinder(
        ...treffer.map((d) => {
          const eigen = d.quelle === "dokument" && d.version !== null;
          const zeile = el(
            "tr",
            {},
            el(
              "td",
              {},
              d.datei
                ? dateiLink(d.datei, d.titel)
                : el(
                    "span",
                    {},
                    d.titel,
                    el("span", { class: "leise" }, " (Datei gelöscht)"),
                  ),
              !eigen &&
                el(
                  "span",
                  { class: "klein leise lg-sm-antwortzeile" },
                  `Aus: ${QUELLE[d.quelle] ?? "anderem Modul"}`,
                ),
            ),
            el(
              "td",
              {},
              el("span", { class: "chip" }, ARTEN[d.art] ?? "Link"),
              d.sharepoint && el("span", { class: "chip" }, "SharePoint"),
            ),
            el(
              "td",
              {},
              d.stichworte.length > 0
                ? el(
                    "ul",
                    { class: "lg-sm-chips" },
                    d.stichworte.map((s) => el("li", { class: "chip" }, s)),
                  )
                : "–",
            ),
            el(
              "td",
              {},
              eigen
                ? d.teamSichtbar
                  ? "Alle Mitglieder"
                  : "Nur Leitung"
                : "–",
            ),
            el("td", { class: "lg-zahlen" }, datumKurz(d.erstelltAm)),
            schreiben &&
              el(
                "td",
                { class: "rechts" },
                eigen
                  ? el(
                      "div",
                      { class: "aktionen" },
                      knopf("Bearbeiten", {
                        klein: true,
                        kontext: d.titel,
                        onclick: () =>
                          dokumentFormular({
                            ctx,
                            lagerId,
                            start: d,
                            danach: neu,
                          }),
                      }),
                      knopf("Löschen", {
                        klein: true,
                        art: "still",
                        kontext: d.titel,
                        onclick: () =>
                          ctx.mitRueckgaengig({
                            text: `Dokument «${d.titel}» gelöscht`,
                            ausfuehren: () =>
                              anfrage(
                                "DELETE",
                                `${basis(lagerId)}/dokumente/${d.id}?version=${d.version}`,
                              ),
                            ansicht: {
                              weg: () => zeile.setAttribute("hidden", ""),
                              zurueck: () => zeile.removeAttribute("hidden"),
                            },
                            danach: neu,
                            fehlertext: meldung,
                            erledigt:
                              "Dokument gelöscht. Die Datei bleibt am Ablageort.",
                          }),
                      }),
                    )
                  : "",
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
          ? leerKarte("Kein Dokument passt zu deiner Suche.")
          : "",
      ),
    );
    leiste.setzeTreffer(treffer.length, dokumente.length);
  }
  zeichneZeilen();
  return el("div", { class: "lg-sm-liste" }, leiste.wurzel, wurzel, leer);
}

// ---- Erlaubte Ablageorte der Abteilung ----

function hostKarte({ ctx, hosts, neu }) {
  return el(
    "section",
    { class: "flaeche", "aria-labelledby": "lg-sm-hosts" },
    el("h2", { id: "lg-sm-hosts" }, "Erlaubte Ablageorte"),
    el(
      "p",
      { class: "leise" },
      "Das gilt für alle Lager der Abteilung. Eine Änderung betrifft neue Links; bestehende bleiben stehen.",
    ),
    hosts === null
      ? el(
          "p",
          {},
          "Keine Einschränkung: Ein Link darf auf jedem Ort liegen, der sicher erreichbar ist.",
        )
      : el(
          "ul",
          { class: "lg-sm-chips", "aria-label": "Erlaubte Orte" },
          hosts.map((h) => el("li", { class: "chip" }, h)),
        ),
    el(
      "div",
      { class: "aktionen" },
      knopf("Orte bearbeiten", {
        onclick: () => hostFormular({ ctx, hosts, danach: neu }),
      }),
    ),
  );
}

function hostFormular({ ctx, hosts, danach }) {
  const beschraenkt = ankreuzen({
    label: "Links nur auf diesen Orten erlauben",
    gewaehlt: hosts !== null,
  });
  const orte = feld({
    label: "Erlaubte Orte",
    mehrzeilig: true,
    rows: "5",
    wert: (hosts ?? []).join("\n"),
    autocomplete: "off",
    spellcheck: "false",
    hilfe:
      "Ein Ort pro Zeile, höchstens 20, zum Beispiel «meineabteilung.sharepoint.com». Seine Unterseiten sind mit erlaubt.",
  });
  const sperre = () => {
    orte.eingabe.disabled = !beschraenkt.eingabe.checked;
  };
  beschraenkt.eingabe.addEventListener("change", sperre);
  sperre();
  const liste = () => [
    ...new Set(
      orte.eingabe.value
        .split(/\r?\n/)
        .map((z) => z.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return dialogFormular({
    titel: "Erlaubte Ablageorte",
    beschreibung: "Auf welchen Orten dürfen die Links der Dateien liegen?",
    felder: [beschraenkt.wurzel, orte.wurzel],
    ok: "Speichern",
    fehlertext: (f) =>
      f instanceof ApiFehler && f.status === 403
        ? "Das darf nur die Abteilungsleitung."
        : meldung(f),
    pruefe: () => {
      if (!beschraenkt.eingabe.checked) return false;
      const l = liste();
      const schlecht = l.find((h) => !HOST.test(h));
      const grund =
        l.length === 0
          ? "Trage mindestens einen Ort ein oder hebe die Einschränkung auf."
          : l.length > 20
            ? "Höchstens 20 Orte."
            : schlecht
              ? `«${schlecht}» ist kein gültiger Ort. Schreibe nur den Namen, zum Beispiel «meineabteilung.sharepoint.com».`
              : null;
      if (!grund) return false;
      ctx.melde(grund, "warn");
      orte.eingabe.focus();
      return true;
    },
    senden: () =>
      anfrage("PUT", HOSTS_BASIS, {
        hosts: beschraenkt.eingabe.checked ? liste() : null,
      }),
    danach: () => {
      ctx.melde("Gespeichert. Die Orte gelten für neue Links.");
      return danach();
    },
  });
}
