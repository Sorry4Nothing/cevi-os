import { ApiFehler, anfrage } from "./api.js";
import {
  ankreuzen,
  auswahl,
  dialogFormular,
  el,
  feld,
  gruppe,
  icon,
  knopf,
} from "./dom.js";
import { zahlfeld } from "./datumsfeld.js";
import { sortierListe } from "./sortieren.js";
import {
  basis,
  darfSchreiben,
  erwaehnFeld,
  erwaehnungsKarte,
  gleicheErwaehnungenAb,
  konfliktBox,
  markenIn,
  markenZuNamen,
  meldung,
  mehrzahl,
  personName,
} from "./lager-sm-gemeinsam.js";

// Traktanden eines Höcks oder die Punkte für den nächsten Höck (#673): Liste zum Ordnen, schnelles Hinzufügen, Formular mit Text, Entscheid, Links, Verantwortlichen und Dauer. Gebraucht von Höcks (Liste, Detail) und vom Höck-Modus.

const NAMEN = {
  titel: "Titel",
  text: "Text",
  entscheid: "Entscheid",
  links: "Links",
  verantwortlichePersonIds: "Verantwortliche",
  dauerMinuten: "Dauer",
  status: "Status",
};

export const STATUS = {
  offen: "Offen",
  besprochen: "Besprochen",
};

// Zeigt eine Meldung und lädt neu, wenn jemand die Zeile inzwischen geändert hat (409) oder sie weg ist (404)
export function nachSchreibfehler(ctx, f, neuLaden) {
  ctx.melde(
    f instanceof ApiFehler && f.code === "VERSION_KONFLIKT"
      ? "Das wurde inzwischen von jemand anderem geändert. Die Liste ist neu geladen, versuche es nochmals."
      : meldung(f),
    f instanceof ApiFehler && f.code === "VERSION_KONFLIKT" ? "warn" : "fehler",
  );
  return neuLaden();
}

// Zeilen für die Links eines Traktandums: Titel und Adresse, hinzufügen und entfernen
function linkZeilen(start) {
  const wurzel = el("div", { class: "lg-sm-linkzeilen" });
  const liste = el("div", { class: "lg-sm-linkliste" });
  const zeilen = [];
  const fuege = (l = { titel: "", url: "" }) => {
    const titel = feld({
      label: "Titel des Links",
      wert: l.titel,
      maxlength: 200,
      autocomplete: "off",
    });
    const url = feld({
      label: "Adresse des Links",
      wert: l.url,
      maxlength: 2000,
      autocomplete: "off",
      inputmode: "url",
    });
    const z = { titel, url };
    const weg = knopf("Entfernen", {
      klein: true,
      art: "still",
      kontext: "Link",
      onclick: () => {
        zeilen.splice(zeilen.indexOf(z), 1);
        zeile.remove();
        mehr.disabled = zeilen.length >= 10;
        mehr.focus();
      },
    });
    const zeile = el(
      "div",
      { class: "lg-sm-linkzeile" },
      titel.wurzel,
      url.wurzel,
      weg,
    );
    zeilen.push(z);
    liste.append(zeile);
    mehr.disabled = zeilen.length >= 10;
  };
  const mehr = knopf("Link hinzufügen", {
    klein: true,
    symbol: "plus",
    onclick: () => {
      fuege();
      zeilen.at(-1).titel.eingabe.focus();
    },
  });
  wurzel.append(liste, mehr);
  for (const l of start) fuege(l);
  return {
    wurzel,
    // Zeilen ohne Titel und Adresse fallen weg
    wert: () =>
      zeilen
        .map((z) => ({
          titel: z.titel.eingabe.value.trim(),
          url: z.url.eingabe.value.trim(),
        }))
        .filter((l) => l.titel !== "" || l.url !== ""),
  };
}

const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Formular zum Anlegen (start = null) und Bearbeiten
// laden(): lädt die Ansicht neu; hoeckId: für ein neues Traktandum (null: nächster Höck)
export function traktandumFormular({
  ctx,
  lagerId,
  lager,
  mitglieder,
  start,
  hoeckId,
  laden,
}) {
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
    hilfe: "Freiwillig. Mit «@» erwähnst du eine Person.",
    mitglieder,
    maxlength: 5000,
  });
  const entscheid = erwaehnFeld({
    label: "Entscheid",
    wert: start?.entscheid ?? "",
    hilfe: "Freiwillig. Was wurde entschieden?",
    mitglieder,
    maxlength: 1000,
    rows: "2",
  });
  const dauer = zahlfeld({
    label: "Geplante Dauer in Minuten",
    wert: start?.dauerMinuten ?? "",
    min: 1,
    max: 600,
    hilfe: "Freiwillig. Die Summe steht über der Liste.",
  });
  const status = auswahl({
    label: "Status",
    optionen: Object.entries(STATUS),
    wert: start?.status ?? "offen",
  });
  const links = linkZeilen(start?.links ?? []);
  const wahl = new Map();
  const personen = mitglieder.map((m) => {
    const k = ankreuzen({
      label: m.name,
      wert: m.personId,
      gewaehlt: start?.verantwortliche?.some((v) => v.id === m.personId),
    });
    wahl.set(m.personId, k);
    return k.wurzel;
  });
  const verantwortliche = () =>
    [...wahl].filter(([, k]) => k.eingabe.checked).map(([id]) => id);
  const werte = () => ({
    titel: titel.eingabe.value.trim(),
    text: text.wert() || null,
    entscheid: entscheid.wert() || null,
    dauerMinuten: dauer.eingabe.value ? Number(dauer.eingabe.value) : null,
    status: status.eingabe.value,
    links: links.wert(),
    verantwortlichePersonIds: verantwortliche(),
  });
  const vorher = start
    ? {
        titel: start.titel,
        text: start.text ?? null,
        entscheid: start.entscheid ?? null,
        dauerMinuten: start.dauerMinuten ?? null,
        status: start.status,
        links: start.links.map((l) => ({ titel: l.titel, url: l.url })),
        verantwortlichePersonIds: start.verantwortliche.map((v) => v.id),
      }
    : null;
  const konflikt = konfliktBox({
    namen: NAMEN,
    setzeVersion: (v) => (version = v),
    uebernehmeStand: (a) => {
      titel.eingabe.value = a.titel;
      text.eingabe.value = markenZuNamen(a.text ?? "", text.karte);
      entscheid.eingabe.value = markenZuNamen(a.entscheid ?? "", entscheid.karte);
      dauer.eingabe.value = a.dauerMinuten ?? "";
      status.eingabe.value = a.status;
      status.eingabe.dispatchEvent(new Event("change"));
    },
  });
  const felder = [
    konflikt.wurzel,
    titel.wurzel,
    text.wurzel,
    entscheid.wurzel,
    el("div", { class: "lg-sm-zeile" }, dauer.wurzel, status.wurzel),
    gruppe("Links", links.wurzel),
  ];
  if (personen.length > 0)
    felder.push(gruppe("Verantwortliche", personen, { scrollen: true }));
  return dialogFormular({
    titel: neu ? "Traktandum anlegen" : "Traktandum bearbeiten",
    beschreibung: neu
      ? undefined
      : "Du siehst und änderst das Traktandum in der Liste des Höcks.",
    felder,
    ok: "Speichern",
    fehlertext: meldung,
    pruefe: () => {
      const w = werte();
      const unvollstaendig = w.links.some((l) => !l.titel || !l.url);
      if (unvollstaendig) {
        ctx.melde("Jeder Link braucht einen Titel und eine Adresse.", "warn");
        return true;
      }
      return false;
    },
    senden: async () => {
      const w = werte();
      try {
        if (neu) {
          const t = await anfrage("POST", `${basis(lagerId)}/traktanden`, {
            ...w,
            hoeckId,
          });
          if (markenIn(`${w.text} ${w.entscheid}`) > 0)
            await gleicheErwaehnungenAb(lagerId, "traktandum", t.id, ctx);
          return t;
        }
        const aenderung = {};
        for (const k of Object.keys(w))
          if (!gleich(w[k], vorher[k])) aenderung[k] = w[k];
        if (Object.keys(aenderung).length === 0) return start;
        const t = await anfrage(
          "PATCH",
          `${basis(lagerId)}/traktanden/${start.id}`,
          { version, ...aenderung },
        );
        if (markenIn(`${w.text} ${w.entscheid} ${vorher.text} ${vorher.entscheid}`) > 0)
          await gleicheErwaehnungenAb(lagerId, "traktandum", start.id, ctx);
        return t;
      } catch (f) {
        konflikt.behandle(f);
        throw f;
      }
    },
    danach: () => {
      ctx.melde(neu ? "Traktandum angelegt." : "Traktandum gespeichert.");
      return laden();
    },
  });
}

// Eine Zeile der Liste
function zeileInhalt({ t, karte, aktionen }) {
  const stufe = (txt) => markenZuNamen(txt, karte);
  return el(
    "div",
    { class: "lg-sm-traktandum" },
    el(
      "div",
      { class: "lg-sm-trakt-kopf" },
      el("span", { class: "fett" }, t.titel),
      t.status === "besprochen" &&
        el("span", { class: "chip chip--ok" }, icon("haken"), "Besprochen"),
      t.dauerMinuten && el("span", { class: "chip" }, `${t.dauerMinuten} Min.`),
    ),
    t.verantwortliche.length > 0 &&
      el(
        "p",
        { class: "klein leise" },
        `Verantwortlich: ${t.verantwortliche.map(personName).join(", ")}`,
      ),
    t.text && el("p", { class: "lg-sm-text" }, stufe(t.text)),
    t.entscheid &&
      el(
        "p",
        { class: "lg-sm-entscheid" },
        el("span", { class: "fett" }, "Entscheid: "),
        stufe(t.entscheid),
      ),
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
    aktionen,
  );
}

// Der Block mit der Liste. traktanden: aus der Antwort des Servers; hoeckId null = nächster Höck
export function traktandenBlock({
  ctx,
  lager,
  lagerId,
  hoeckId,
  traktanden,
  mitglieder,
  laden,
  titel = "Traktanden",
}) {
  const darfAendern = darfSchreiben(lager, "hoecks.bearbeiten");
  const geplant = traktanden.reduce((s, t) => s + (t.dauerMinuten ?? 0), 0);
  const zeilen = new Map();
  const karte = erwaehnungsKarte(mitglieder);
  const liste = traktanden.map((t) => {
    const aktionen = darfAendern
      ? el(
          "div",
          { class: "aktionen lg-sm-aktionen" },
          knopf("Bearbeiten", {
            klein: true,
            kontext: t.titel,
            onclick: () =>
              traktandumFormular({
                ctx,
                lagerId,
                lager,
                mitglieder,
                start: t,
                hoeckId,
                laden,
              }),
          }),
          knopf(t.status === "besprochen" ? "Wieder öffnen" : "Besprochen", {
            klein: true,
            kontext: t.titel,
            onclick: () => setze(t, { status: t.status === "besprochen" ? "offen" : "besprochen" }),
          }),
          hoeckId !== null &&
            knopf("Auf nächsten Höck", {
              klein: true,
              kontext: t.titel,
              onclick: () => setze(t, { hoeckId: null }),
            }),
          knopf("Löschen", {
            klein: true,
            art: "still",
            kontext: t.titel,
            onclick: () => loesche(t),
          }),
        )
      : false;
    return {
      id: t.id,
      text: t.titel,
      inhalt: zeileInhalt({ t, karte, aktionen }),
    };
  });
  for (const t of traktanden) zeilen.set(t.id, t);

  async function setze(t, aenderung) {
    try {
      await anfrage("PATCH", `${basis(lagerId)}/traktanden/${t.id}`, {
        version: t.version,
        ...aenderung,
      });
      ctx.melde(
        "hoeckId" in aenderung
          ? `«${t.titel}» liegt jetzt bei den Punkten für den nächsten Höck.`
          : aenderung.status === "besprochen"
            ? `«${t.titel}» ist besprochen.`
            : `«${t.titel}» ist wieder offen.`,
      );
      await laden();
    } catch (f) {
      await nachSchreibfehler(ctx, f, laden);
    }
  }

  function loesche(t) {
    const zeile = liegeZeile(t.id);
    ctx.mitRueckgaengig({
      text: `Traktandum «${t.titel}» gelöscht`,
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${basis(lagerId)}/traktanden/${t.id}?version=${t.version}`,
        ),
      ansicht: {
        weg: () => zeile?.setAttribute("hidden", ""),
        zurueck: () => zeile?.removeAttribute("hidden"),
      },
      danach: laden,
      fehlertext: meldung,
      erledigt: "Traktandum gelöscht.",
    });
  }
  const huelle = el("div", { class: "lg-sm-block" });
  const liegeZeile = (id) =>
    huelle.querySelector(`[data-id="${CSS.escape(id)}"]`);

  let sortierbar = null;
  if (liste.length > 0 && darfAendern) {
    sortierbar = sortierListe({
      beschriftung: titel,
      eintraege: liste,
      mitRueckgaengig: ctx.mitRueckgaengig,
      aktionstext: "Reihenfolge der Traktanden geändert",
      beiNeu: async (ids) => {
        try {
          await anfrage("PUT", `${basis(lagerId)}/traktanden/reihenfolge`, {
            hoeckId,
            eintraege: ids.map((id) => ({
              id,
              version: zeilen.get(id).version,
            })),
          });
        } catch (f) {
          await nachSchreibfehler(ctx, f, laden);
          throw f;
        }
        await laden();
      },
    });
  }
  const leseListe = () =>
    el(
      "ul",
      { class: "lg-sm-lesen" },
      liste.map((e) => el("li", { "data-id": e.id }, e.inhalt)),
    );

  const kopfZeile = el(
    "div",
    { class: "lg-sm-blockkopf" },
    el("h2", {}, titel),
    el(
      "p",
      { class: "klein leise" },
      traktanden.length === 0
        ? "Noch keine Punkte."
        : `${mehrzahl(traktanden.length, "Punkt", "Punkte")}${geplant > 0 ? `, geplant ${geplant} Min.` : ""}`,
    ),
  );
  huelle.append(kopfZeile);
  if (liste.length > 0)
    huelle.append(sortierbar ? sortierbar.wurzel : leseListe());
  if (darfAendern) {
    const eingabe = feld({
      label: "Neues Traktandum",
      maxlength: 200,
      autocomplete: "off",
      placeholder: "Titel, dann Enter",
    });
    const hinzufuegen = knopf("Hinzufügen", { art: "haupt", symbol: "plus" });
    const sende = async () => {
      const t = eingabe.eingabe.value.trim();
      if (!t) {
        eingabe.eingabe.focus();
        return;
      }
      hinzufuegen.disabled = true;
      try {
        await anfrage("POST", `${basis(lagerId)}/traktanden`, {
          titel: t,
          hoeckId,
        });
        ctx.melde(`«${t}» ist auf der Liste.`);
        await laden();
      } catch (f) {
        ctx.melde(meldung(f), "fehler");
        hinzufuegen.disabled = false;
      }
    };
    hinzufuegen.addEventListener("click", sende);
    eingabe.eingabe.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sende();
      }
    });
    huelle.append(
      el(
        "div",
        { class: "lg-sm-schnell" },
        eingabe.wurzel,
        hinzufuegen,
        knopf("Mit Angaben", {
          klein: true,
          kontext: "neues Traktandum",
          onclick: () =>
            traktandumFormular({
              ctx,
              lagerId,
              lager,
              mitglieder,
              start: null,
              hoeckId,
              laden,
            }),
        }),
      ),
    );
  }
  return huelle;
}
