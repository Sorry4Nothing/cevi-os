import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  auswahl,
  bestaetigen,
  chip,
  el,
  feld,
  geheimnisDialog,
  icon,
  knopf,
  neueId,
  seitenblatt,
  zeit,
} from "./dom.js";
import { entferneFehler, feldFehler, pruefHinweis } from "./liste-hilfen.js";
import { typName } from "./tags-detail.js";

// Person (A7): Seitenblatt zum Bearbeiten, dazu die Bausteine, die auch «Person erfassen» braucht

const ROLLEN = [
  ["", "Keine"],
  ["leitung", "Leitung"],
  ["stufenleitung", "Stufenleitung"],
];

// Die Rollen einer Person im System, so wie die API sie kennt: Admin, Stufenrolle (Leitung), Elternteil
export function systemRollen(person) {
  return [
    person.admin && "Admin",
    person.rollen.length > 0 && "Leitung",
    person.elternteilVon.length > 0 && "Eltern",
  ].filter(Boolean);
}

// Abgelaufen: Der Wechsel ist offen und die Frist vorbei, die Person kommt nicht mehr hinein
export const startpasswortAbgelaufen = (person) =>
  person.mussPasswortAendern &&
  Boolean(person.startpasswortGueltigBis) &&
  new Date(person.startpasswortGueltigBis) <= new Date();

// Chips mit Symbol und Wort; ohne Besonderheit bleibt die Zelle leer
export function statusChips(person) {
  const liste = [
    person.zweiterFaktor && chip("Zweiter Faktor", "ok", "schild"),
    startpasswortAbgelaufen(person)
      ? chip("Startpasswort abgelaufen", "fehler", "uhr")
      : person.mussPasswortAendern &&
        chip("Startpasswort offen", "warn", "uhr"),
    person.rollen.some((r) => r.typ === "stufenleitung") &&
      !person.telefon &&
      chip("Keine Telefonnummer", "warn", "telefon"),
    person.deaktiviert && chip("Deaktiviert", "fehler"),
  ].filter(Boolean);
  return liste;
}

// Rollen-Editor: eine Gruppe von Optionsknöpfen je Stufe
export function rollenFelder(stufen, rollen) {
  const aktuell = new Map(rollen.map((r) => [r.stufeId, r.typ]));
  const zeilen = stufen.map((stufe) => {
    const name = neueId("rolle");
    const gewaehlt = aktuell.get(stufe.id) ?? "";
    const optionen = ROLLEN.map(([wert, text]) => {
      const id = neueId("rolle-option");
      return {
        wert,
        eingabe: el("input", {
          type: "radio",
          id,
          name,
          value: wert,
          checked: wert === gewaehlt,
        }),
        label: el("label", { for: id }, icon("haken"), text),
      };
    });
    return {
      stufe,
      optionen,
      wurzel: el(
        "fieldset",
        { class: "rolle" },
        el("legend", {}, stufe.name),
        el(
          "div",
          { class: "seg" },
          optionen.flatMap((o) => [o.eingabe, o.label]),
        ),
      ),
    };
  });
  return {
    wurzel: el(
      "div",
      { class: "abschnitt" },
      el("h3", {}, "Stufenrollen"),
      zeilen.length
        ? zeilen.map((z) => z.wurzel)
        : el("p", { class: "hilfe" }, "Es gibt noch keine Stufen."),
    ),
    wert: () =>
      zeilen
        .map((z) => ({
          stufeId: z.stufe.id,
          typ: z.optionen.find((o) => o.eingabe.checked)?.wert ?? "",
        }))
        .filter((r) => r.typ),
  };
}

export function kinderFelder(kinder, stufen, gewaehlt) {
  const stufenname = new Map(stufen.map((s) => [s.id, s.name]));
  const zaehler = el("span", { class: "klein leise" });
  const suchId = neueId("kind-suche");
  const zeilen = kinder.map((kind) => {
    const name = `${kind.vorname} ${kind.nachname}`;
    const box = ankreuzen({
      label: name,
      gewaehlt: gewaehlt.includes(kind.id),
      wert: kind.id,
    });
    box.wurzel.dataset.suche = name.toLowerCase();
    box.wurzel.append(
      el(
        "span",
        { class: "chip chip--stufe" },
        stufenname.get(kind.stufeId) ?? "ohne Stufe",
      ),
    );
    return box;
  });
  const anzahl = () => {
    const n = zeilen.filter((b) => b.eingabe.checked).length;
    zaehler.textContent = `${n} gewählt`;
  };
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Kind suchen",
    autocomplete: "off",
    oninput: () => {
      const frage = suche.value.trim().toLowerCase();
      for (const z of zeilen)
        z.wurzel.hidden = !z.wurzel.dataset.suche.includes(frage);
    },
  });
  const liste = el(
    "div",
    { class: "kinderliste", role: "group", "aria-label": "Kinder" },
    zeilen.map((z) => z.wurzel),
  );
  liste.addEventListener("change", anzahl);
  anzahl();
  return {
    wurzel: el(
      "div",
      { class: "abschnitt" },
      el("div", { class: "zeile" }, el("h3", {}, "Elternteil von"), zaehler),
      zeilen.length
        ? [
            el(
              "div",
              { class: "suche suche--voll" },
              el("label", { class: "nur-leser", for: suchId }, "Kind suchen"),
              icon("lupe"),
              suche,
            ),
            liste,
          ]
        : el("p", { class: "leise" }, "Es gibt noch keine Kinder."),
    ),
    wert: () =>
      zeilen.filter((b) => b.eingabe.checked).map((b) => b.eingabe.value),
  };
}

const restzeit = (iso) => {
  const min = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 60000));
  if (min >= 2880) return `noch ${Math.floor(min / 1440)} Tage`;
  if (min >= 120) return `noch ${Math.floor(min / 60)} Std.`;
  return `noch ${min} Min.`;
};

export function startpasswortDialog(name, wert) {
  geheimnisDialog({
    titel: "Startpasswort",
    beschreibung: `Gib das Startpasswort für «${name}» sicher weiter. Es gilt 7 Tage und bleibt im Blatt der Person sichtbar, bis die Person es ersetzt hat.`,
    wert,
  });
}

// fertig() schliesst das Seitenblatt nach einer geglückten Aktion, denn seine Angaben sind danach veraltet
function neuesStartpasswort(person, ctx, neu, fertig) {
  bestaetigen({
    titel: "Neues Startpasswort erzeugen",
    beschreibung: `«${person.name}» wird überall abgemeldet und muss beim nächsten Login ein neues Passwort wählen. Das Startpasswort gilt 7 Tage.`,
    ok: "Startpasswort erzeugen",
    aktion: () =>
      anfrage("POST", `/api/v1/admin/personen/${person.id}/startpasswort`),
    danach: (antwort) => {
      neu();
      ctx.melde(`Neues Startpasswort für «${person.name}» ist erzeugt.`);
      startpasswortDialog(person.name, antwort.startpasswort);
      fertig();
    },
  });
}

function umschalten(person, ctx, neu, fertig) {
  const deaktivieren = !person.deaktiviert;
  bestaetigen({
    titel: deaktivieren ? "Person deaktivieren" : "Person aktivieren",
    beschreibung: deaktivieren
      ? `«${person.name}» kann sich nicht mehr anmelden und wird überall abgemeldet.`
      : `«${person.name}» kann sich wieder anmelden. Dafür gibt es ein neues Startpasswort, das alte gilt nicht mehr.`,
    ok: deaktivieren ? "Deaktivieren" : "Aktivieren",
    gefaehrlich: deaktivieren,
    aktion: () =>
      anfrage(
        "POST",
        `/api/v1/admin/personen/${person.id}/${deaktivieren ? "deaktivieren" : "aktivieren"}`,
      ),
    danach: (antwort) => {
      neu();
      ctx.melde(
        deaktivieren
          ? `«${person.name}» ist deaktiviert.`
          : `«${person.name}» ist aktiviert.`,
      );
      if (!deaktivieren)
        startpasswortDialog(person.name, antwort.startpasswort);
      fertig();
    },
  });
}

function faktorZuruecksetzen(person, ctx, neu, fertig) {
  bestaetigen({
    titel: "Zweiten Faktor zurücksetzen",
    beschreibung: `«${person.name}» muss den zweiten Faktor danach neu einrichten.`,
    ok: "Zurücksetzen",
    aktion: () =>
      anfrage(
        "POST",
        `/api/v1/admin/personen/${person.id}/zweiter-faktor-zuruecksetzen`,
      ),
    danach: () => {
      neu();
      ctx.melde(`Der zweite Faktor von «${person.name}» ist zurückgesetzt.`);
      fertig();
    },
  });
}

// Aktion im Seitenblatt: Titel und Erklärung links, Knopf rechts
function kontoAktion(titel, text, knopfKnoten) {
  return el(
    "div",
    { class: "zeile" },
    el(
      "div",
      { class: "personen-aktion" },
      el("p", { class: "name" }, titel),
      el("p", { class: "klein leise" }, text),
    ),
    knopfKnoten,
  );
}

// Tags der Person im Blatt: Änderungen sammeln sich und gelten mit «Speichern»
// ursprung: [{ tag, rolle }]; aenderungen: Map tagId -> { art: "neu" | "weg", rolle? }
function tagAbschnitt({ ursprung, alleTags }) {
  const aenderungen = new Map();
  const wurzel = el("div", { class: "abschnitt" });
  const vorhandene = () => {
    const liste = ursprung
      .filter(({ tag }) => aenderungen.get(tag.id)?.art !== "weg")
      .map((e) => ({ ...e, status: null }));
    for (const e of ursprung) {
      if (aenderungen.get(e.tag.id)?.art === "weg")
        liste.push({ ...e, status: "weg" });
    }
    for (const [id, a] of aenderungen) {
      if (a.art === "neu") {
        const tag = alleTags.find((t) => t.id === id);
        if (tag) liste.push({ tag, rolle: a.rolle, status: "neu" });
      }
    }
    return liste;
  };
  const zeichne = () => {
    const bekannt = new Set([
      ...ursprung.map((e) => e.tag.id),
      ...[...aenderungen].filter(([, a]) => a.art === "neu").map(([id]) => id),
    ]);
    const frei = alleTags.filter((t) => !bekannt.has(t.id));
    const zeilen = vorhandene().map((e) => {
      const markiert = e.status === "weg";
      return el(
        "li",
        {},
        el(
          "ul",
          { class: "chips" },
          chip(e.tag.name, e.tag.typ === "stufe" ? "stufe" : undefined, "tag"),
        ),
        el(
          "span",
          { class: "klein leise" },
          [
            typName(e.tag.typ),
            e.rolle && `Rolle ${e.rolle}`,
            e.status === "neu" && "wird beim Speichern hinzugefügt",
            markiert && "wird beim Speichern entfernt",
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        knopf(markiert ? "Rückgängig" : "Entfernen", {
          klein: true,
          kontext: e.tag.name,
          onclick: () => {
            if (e.status === "neu" || markiert) aenderungen.delete(e.tag.id);
            else aenderungen.set(e.tag.id, { art: "weg" });
            zeichne();
          },
        }),
      );
    });
    const tag = auswahl({
      label: "Tag hinzufügen",
      optionen: [["", "Tag wählen"], ...frei.map((t) => [t.id, t.name])],
      wert: "",
    });
    const rolle = feld({
      label: "Rolle (optional)",
      hilfe: "Freier Text, höchstens 50 Zeichen.",
      maxlength: 50,
    });
    rolle.eingabe.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      hinzufuegen.click();
    });
    const hinzufuegen = knopf("Hinzufügen", {
      symbol: "plus",
      onclick: () => {
        const id = tag.eingabe.value;
        if (!id) {
          feldFehler(
            { ...tag, fokus: tag.wurzel.querySelector(".auswahl-knopf") },
            "Wähle einen Tag.",
          );
          tag.wurzel.querySelector(".auswahl-knopf").focus();
          return;
        }
        aenderungen.set(id, {
          art: "neu",
          rolle: rolle.eingabe.value.trim() || null,
        });
        zeichne();
      },
    });
    wurzel.replaceChildren(
      el("h3", {}, "Gruppen und Tags"),
      zeilen.length > 0
        ? el("ul", { class: "liste-zeilen pe-tagzeilen" }, zeilen)
        : el("p", { class: "leise" }, "Die Person trägt keinen Tag."),
      frei.length > 0
        ? el(
            "div",
            { class: "pe-tag-neu" },
            tag.wurzel,
            rolle.wurzel,
            hinzufuegen,
          )
        : el("p", { class: "hilfe" }, "Die Person trägt schon alle Tags."),
    );
  };
  zeichne();
  return {
    wurzel,
    aenderungen: () => [...aenderungen],
  };
}

// Seitenblatt «Person bearbeiten»; daten: { personen, stufen, kinder, tags, tagsJePerson }; beiFokus(id) merkt sich die Person für den Fokus nach dem Neuladen
export function oeffneBlatt({ person, daten, ctx, neu, beiFokus, tr }) {
  const eigenes = person.id === ctx.ich.id;
  const formId = neueId("person-form");
  const name = feld({
    label: "Name",
    hilfe: "Vorname und Nachname in einem Feld.",
    wert: person.name,
    maxlength: 201,
    "aria-required": "true",
  });
  const ceviName = feld({
    label: "Cevi-Name (optional)",
    wert: person.ceviName ?? "",
    maxlength: 50,
  });
  const telefon = feld({
    label: "Telefon (optional)",
    typ: "tel",
    hilfe:
      "Nur für Stufenleitungen. Eltern, Leitende und Stufenleitung der Stufe sehen die Nummer bei den Kontakten. Leer lassen, um sie zu entfernen.",
    wert: person.telefon ?? "",
    maxlength: 30,
    autocomplete: "off",
  });
  const admin = ankreuzen({ label: "Admin-Rechte", gewaehlt: person.admin });
  const rollen = rollenFelder(daten.stufen, person.rollen);
  const kinder = kinderFelder(daten.kinder, daten.stufen, person.elternteilVon);
  const tags = tagAbschnitt({
    ursprung: daten.tagsJePerson.get(person.id) ?? [],
    alleTags: daten.tags,
  });
  const meldung = el("div", { class: "pe-zusammenfassung" });
  const schliesse = () => blatt.close();
  const abbrechen = knopf("Abbrechen", { onclick: schliesse });
  const speichern = el(
    "button",
    { type: "submit", form: formId, class: "knopf knopf--haupt" },
    "Speichern",
  );
  const formular = el(
    "form",
    { id: formId, novalidate: true },
    el(
      "div",
      { class: "abschnitt" },
      el("h3", {}, "Angaben"),
      name.wurzel,
      ceviName.wurzel,
      telefon.wurzel,
      el(
        "div",
        { class: "feld" },
        el("span", { class: "legende" }, "Benutzername"),
        el("p", { class: "personen-benutzername" }, person.benutzername ?? "–"),
        el("p", { class: "hilfe" }, "Der Benutzername bleibt fest."),
      ),
    ),
    el(
      "div",
      { class: "abschnitt" },
      el("h3", {}, "Rechte"),
      admin.wurzel,
      el(
        "p",
        { class: "hilfe" },
        "Admins brauchen einen zweiten Faktor, bevor sie die Verwaltung öffnen können.",
      ),
    ),
    rollen.wurzel,
    tags.wurzel,
    kinder.wurzel,
  );
  const sperren = (an) => {
    abbrechen.disabled = speichern.disabled = an;
    speichern.setAttribute("aria-busy", String(an));
    for (const e of formular.querySelectorAll("input")) e.readOnly = an;
  };
  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    meldung.replaceChildren();
    entferneFehler(name);
    if (!name.eingabe.value.trim()) {
      feldFehler(name, "Gib einen Namen ein.");
      const hinweis = pruefHinweis([{ name: "Name", ...name }]);
      meldung.append(hinweis);
      hinweis.focus();
      return;
    }
    sperren(true);
    let gespeichert = false;
    try {
      await anfrage("PATCH", `/api/v1/admin/personen/${person.id}`, {
        name: name.eingabe.value.trim(),
        ceviName: ceviName.eingabe.value,
        telefon: telefon.eingabe.value,
        admin: admin.eingabe.checked,
        rollen: rollen.wert(),
        elternteilVon: kinder.wert(),
      });
      gespeichert = true;
      // Tags einzeln, denn die API kennt nur die Einzelzuordnung
      const aenderungen = tags.aenderungen();
      let misslungen = 0;
      for (const [tagId, a] of aenderungen) {
        try {
          await anfrage(
            a.art === "neu" ? "PUT" : "DELETE",
            `/api/v1/admin/tags/${tagId}/personen/${person.id}`,
            a.art === "neu" ? (a.rolle ? { rolle: a.rolle } : {}) : undefined,
          );
        } catch {
          misslungen += 1;
        }
      }
      beiFokus(person.id);
      blatt.close();
      neu();
      if (misslungen > 0) {
        ctx.melde(
          `«${person.name}» ist gespeichert, aber ${misslungen === 1 ? "1 Änderung" : `${misslungen} Änderungen`} an den Tags ${misslungen === 1 ? "ging" : "gingen"} nicht durch. Öffne die Person und versuche es nochmals.`,
          "warn",
        );
      } else {
        ctx.melde(
          aenderungen.length > 0
            ? `«${name.eingabe.value.trim()}» ist gespeichert. Die Tags gelten ab sofort.`
            : `«${name.eingabe.value.trim()}» ist gespeichert.`,
        );
      }
    } catch (f) {
      if (gespeichert) return;
      const hinweis = el(
        "div",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        el(
          "span",
          {},
          `Nicht gespeichert. ${fehlertext(f)} Deine Änderungen sind noch da, versuche es nochmals.`,
        ),
      );
      meldung.replaceChildren(hinweis);
      hinweis.focus();
    } finally {
      sperren(false);
    }
  });
  const konto = el(
    "div",
    { class: "abschnitt" },
    el("h3", {}, "Konto"),
    el(
      "dl",
      { class: "werte" },
      el(
        "div",
        {},
        el("dt", {}, "Zweiter Faktor"),
        el(
          "dd",
          {},
          el(
            "ul",
            { class: "chips" },
            person.zweiterFaktor
              ? chip("Aktiv", "ok", "schild")
              : chip("Nicht eingerichtet", undefined, false),
          ),
        ),
      ),
      el(
        "div",
        {},
        el("dt", {}, "Status"),
        el(
          "dd",
          {},
          person.deaktiviert
            ? "Deaktiviert"
            : startpasswortAbgelaufen(person)
              ? `Startpasswort abgelaufen am ${zeit(person.startpasswortGueltigBis)}`
              : person.mussPasswortAendern
                ? "Passwortwechsel offen"
                : "Aktiv",
        ),
      ),
      person.mussPasswortAendern &&
        !startpasswortAbgelaufen(person) &&
        person.startpasswort &&
        el(
          "div",
          {},
          el("dt", {}, "Startpasswort"),
          el(
            "dd",
            {},
            el("span", { class: "mono" }, person.startpasswort),
            el(
              "span",
              { class: "klein leise pe-gueltig" },
              `gültig bis ${zeit(person.startpasswortGueltigBis)} (${restzeit(person.startpasswortGueltigBis)})`,
            ),
          ),
        ),
    ),
    eigenes
      ? el(
          "p",
          { class: "hilfe" },
          "Für das eigene Konto gibt es diese Aktionen nicht.",
        )
      : [
          kontoAktion(
            "Neues Startpasswort",
            "Meldet die Person überall ab. Das Passwort gilt 7 Tage und bleibt hier sichtbar, bis die Person es ersetzt hat.",
            knopf("Startpasswort erzeugen", {
              klein: true,
              symbol: "schluessel",
              onclick: () => {
                beiFokus(person.id);
                neuesStartpasswort(person, ctx, neu, schliesse);
              },
            }),
          ),
          person.zweiterFaktor &&
            kontoAktion(
              "Zweiter Faktor",
              "Die Person muss ihn danach neu einrichten.",
              knopf("Zweiten Faktor zurücksetzen", {
                klein: true,
                art: "gefahr",
                symbol: "schild",
                onclick: () => {
                  beiFokus(person.id);
                  faktorZuruecksetzen(person, ctx, neu, schliesse);
                },
              }),
            ),
          person.deaktiviert
            ? kontoAktion(
                "Person aktivieren",
                "Sie kann sich wieder anmelden, mit einem neuen Startpasswort.",
                knopf("Aktivieren", {
                  klein: true,
                  symbol: "haken",
                  onclick: () => {
                    beiFokus(person.id);
                    umschalten(person, ctx, neu, schliesse);
                  },
                }),
              )
            : kontoAktion(
                "Person deaktivieren",
                "Sie kann sich nicht mehr anmelden und wird überall abgemeldet.",
                knopf("Deaktivieren", {
                  klein: true,
                  art: "gefahr",
                  symbol: "sperre",
                  onclick: () => {
                    beiFokus(person.id);
                    umschalten(person, ctx, neu, schliesse);
                  },
                }),
              ),
        ],
  );
  tr?.classList.add("gewaehlt");
  const blatt = seitenblatt({
    titel: person.name,
    untertitel: [person.ceviName, ...systemRollen(person)]
      .filter(Boolean)
      .join(" · "),
    inhalt: [meldung, formular, konto],
    fusszeile: [abbrechen, speichern],
    schliessen: () => tr?.classList.remove("gewaehlt"),
  });
}
