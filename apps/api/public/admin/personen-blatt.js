import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  auswahl,
  avatar,
  chip,
  el,
  feld,
  flussKopf,
  geheimnisDialog,
  icon,
  knopf,
  neueId,
  zeit,
} from "./dom.js";
import { oeffneFluss } from "./fluss.js";
import { formularRaster } from "./formularraster.js";
import { entferneFehler, feldFehler, pruefHinweis } from "./liste-hilfen.js";
import { suchWahl } from "./personen-wahl.js";
import { siehtAlles } from "./sicht.js";
import { zweistufig } from "./rueckgaengig.js";
import { typName } from "./tags-detail.js";
import { BEISPIEL, normalisiereTelefon } from "./telefon.js";

// Person (A6, A7): «Person erfassen» und «Person bearbeiten» sind eine Seite im Fluss (#594): Felder links in Abschnitten, rechts das Profil mit dem Bild der Person (Muster «edit-profile-form»). Die Seite hat «Zurück», fragt bei ungespeicherten Eingaben und lässt den Rest der Verwaltung unberührt.

const ROLLEN = [
  ["", "Keine"],
  ["leitung", "Leitung"],
  ["stufenleitung", "Stufenleitung"],
];

// Rollen im Klartext: die API kennt «leitung» und «stufenleitung» als Rohwerte
export const rolleName = (roh) =>
  ROLLEN.find(([w]) => w === roh)?.[1] ?? roh ?? "";

// Die Rollen einer Person im System, so wie die API sie kennt: Abteilungsleitung, Entwickler, Stufenrolle (Leitung), Elternteil
export function systemRollen(person) {
  return [
    person.abteilungsleitung && "Abteilungsleitung",
    person.entwickler && "Entwickler",
    person.rollen.some((r) => r.typ === "stufenleitung")
      ? "Stufenleitung"
      : person.rollen.length > 0 && "Leitung",
    person.elternteilVon.length > 0 && "Eltern",
  ].filter(Boolean);
}

// Abgelaufen: Der Wechsel ist offen und die Frist vorbei, die Person kommt nicht mehr hinein
export const startpasswortAbgelaufen = (person) =>
  person.mussPasswortAendern &&
  Boolean(person.startpasswortGueltigBis) &&
  new Date(person.startpasswortGueltigBis) <= new Date();

// Zustand des Kontos: genau ein Chip (Aktiv, Startpasswort offen, abgelaufen, Deaktiviert), dazu der zweite Faktor, wenn er eingerichtet ist
export function kontoChips(person) {
  const zustand = person.deaktiviert
    ? chip("Deaktiviert", "fehler")
    : startpasswortAbgelaufen(person)
      ? chip("Startpasswort abgelaufen", "fehler", "uhr")
      : person.mussPasswortAendern
        ? chip("Startpasswort offen", "warn", "uhr")
        : chip("Aktiv", "ok");
  return [
    zustand,
    person.zweiterFaktor && chip("Zweiter Faktor", "ok", "schild"),
  ].filter(Boolean);
}

// Was bei der Rolle fehlt: eine Stufenleitung ohne Telefonnummer ist für Eltern nicht erreichbar
export const fehltTelefon = (person) =>
  person.rollen.some((r) => r.typ === "stufenleitung") && !person.telefon;

// Stufen der Person (Muster «team-invite-card» und «team-member-list»): Die Person bekommt Stufen zugewiesen, nicht alle Stufen stehen vorab da.
// Jede Zeile hat die Stufe, die Rolle in dieser Stufe (Leitung oder Stufenleitung) und «Entfernen» (die Zeile bleibt markiert, «Rückgängig» holt sie zurück).
// Die Änderungen gelten mit «Speichern»; wert() ist die Liste, die die API erwartet (sie ersetzt alle Stufenrollen der Person)
// «Teilnehmer» fehlt mit Absicht: Das Rechtemodell kennt für Personen mit Konto nur Leitung und Stufenleitung (Kinder sind ein eigener Datensatz)
const ROLLEN_ZUWEISEN = ROLLEN.filter(([wert]) => wert);

// Aufzählung für Texte: «Biber», «Biber und Wolf», «Biber, Wolf und Pfadi»
const aufzaehlung = (namen) =>
  namen.length < 2
    ? namen.join("")
    : `${namen.slice(0, -1).join(", ")} und ${namen.at(-1)}`;

export function rollenFelder(stufen, rollen) {
  // stufeId -> { typ, weg }; die Reihenfolge der Zeilen ist die der Stufen
  const zugewiesen = new Map(
    rollen.map((r) => [r.stufeId, { typ: r.typ, weg: false }]),
  );
  const stufenName = (id) =>
    stufen.find((s) => s.id === id)?.name ?? "Unbekannte Stufe";
  const wurzel = el("div", { class: "pe-stufenzuweisung" });
  const aktiv = () => stufen.filter((s) => zugewiesen.get(s.id)?.weg === false);
  const meldung = el("p", { class: "klein leise", role: "status" });
  const hinweis = el("p", { class: "hilfe" });
  const aendere = () =>
    wurzel.dispatchEvent(new Event("change", { bubbles: true }));

  // Was die Website daraus macht (Regel des Nutzers, #610): Es folgt der Rolle, die Person und die Verwaltung wählen es nicht
  const zeigeHinweis = () => {
    const namen = aktiv().map((s) => s.name);
    hinweis.textContent =
      namen.length === 0
        ? "Ohne Stufe erscheint die Person nicht auf der öffentlichen Website. Wer Leitung oder Stufenleitung einer Stufe ist, erscheint dort mit Name und Profilbild, auf der Seite der Stufe. Das ist keine Auswahl, es folgt der Rolle."
        : `Mit dieser Rolle erscheint die Person auf der öffentlichen Website mit Name und Profilbild, auf der Seite von ${aufzaehlung(namen)}. Das ist keine Auswahl, es folgt der Rolle. Das Profilbild setzt die Person selbst.`;
  };

  const zeichne = (fokusId, art = "knopf") => {
    const zeilen = stufen
      .filter((s) => zugewiesen.has(s.id))
      .map((s) => {
        const z = zugewiesen.get(s.id);
        const name = neueId("stufenrolle");
        const optionen = ROLLEN_ZUWEISEN.map(([wert, text]) => {
          const id = neueId("stufenrolle-option");
          return [
            el("input", {
              type: "radio",
              id,
              name,
              value: wert,
              checked: wert === z.typ,
              disabled: z.weg,
              onchange: () => {
                z.typ = wert;
                aendere();
              },
            }),
            el("label", { for: id }, icon("haken"), text),
          ];
        });
        return el(
          "li",
          {
            "data-stufe": s.id,
            class: z.weg
              ? "pe-stufenzeile pe-stufenzeile--weg"
              : "pe-stufenzeile",
          },
          el("ul", { class: "chips" }, chip(s.name, "stufe", "tag")),
          el(
            "div",
            {
              class: "seg",
              role: "radiogroup",
              "aria-label": `Rolle in ${s.name}`,
            },
            optionen.flat(),
          ),
          z.weg &&
            el(
              "span",
              { class: "klein leise" },
              "wird beim Speichern entfernt",
            ),
          knopf(z.weg ? "Rückgängig" : "Entfernen", {
            klein: true,
            art: "still",
            symbol: z.weg ? "zurueck" : "schliessen",
            kontext: s.name,
            onclick: () => {
              if (z.weg) z.weg = false;
              // Eine Stufe, die erst neu dazukam, ist mit dem Entfernen wieder weg
              else if (!rollen.some((r) => r.stufeId === s.id)) {
                zugewiesen.delete(s.id);
              } else z.weg = true;
              meldung.textContent = `${s.name}: ${z.weg || !zugewiesen.has(s.id) ? "wird entfernt" : "bleibt"}.`;
              zeichne(s.id);
              aendere();
            },
          }),
        );
      });

    const frei = stufen.filter((s) => !zugewiesen.has(s.id));
    const stufe = auswahl({
      label: "Stufe",
      optionen: [["", "Stufe wählen"], ...frei.map((s) => [s.id, s.name])],
      wert: "",
    });
    const rolle = auswahl({
      label: "Rolle in der Stufe",
      optionen: [["", "Rolle wählen"], ...ROLLEN_ZUWEISEN],
      wert: "",
    });
    const knopfStufe = () => stufe.wurzel.querySelector(".auswahl-knopf");
    const knopfRolle = () => rolle.wurzel.querySelector(".auswahl-knopf");
    const hinzufuegen = knopf("Stufe hinzufügen", {
      symbol: "plus",
      onclick: () => {
        entferneFehler({ ...stufe, fokus: knopfStufe() });
        entferneFehler({ ...rolle, fokus: knopfRolle() });
        const id = stufe.eingabe.value;
        const typ = rolle.eingabe.value;
        if (!id) {
          feldFehler({ ...stufe, fokus: knopfStufe() }, "Wähle eine Stufe.");
          knopfStufe().focus();
          return;
        }
        if (!typ) {
          feldFehler({ ...rolle, fokus: knopfRolle() }, "Wähle eine Rolle.");
          knopfRolle().focus();
          return;
        }
        zugewiesen.set(id, { typ, weg: false });
        meldung.textContent = `${stufenName(id)} ist hinzugefügt. Sie gilt mit «Speichern».`;
        zeichne(id, "rolle");
        aendere();
      },
    });

    wurzel.replaceChildren(
      el("h3", { class: "pe-teiltitel" }, "Stufen und Rollen"),
      zeilen.length > 0
        ? el(
            "ul",
            {
              class: "liste-zeilen pe-stufenzeilen",
              "aria-label": "Stufen der Person",
            },
            zeilen,
          )
        : el("p", { class: "leise" }, "Die Person hat keine Stufe."),
      stufen.length === 0
        ? el("p", { class: "hilfe" }, "Es gibt noch keine Stufen.")
        : frei.length > 0
          ? el(
              "div",
              { class: "pe-tag-neu pe-stufe-neu" },
              stufe.wurzel,
              rolle.wurzel,
              hinzufuegen,
            )
          : el("p", { class: "hilfe" }, "Die Person hat schon alle Stufen."),
      meldung,
      hinweis,
    );
    zeigeHinweis();
    // Nach dem Entfernen oder Hinzufügen bleibt der Fokus bei der betroffenen Zeile
    if (fokusId) {
      const zeile = wurzel.querySelector(`[data-stufe="${fokusId}"]`);
      const ziel = zeile?.querySelector(
        art === "knopf" ? "button" : "input:checked",
      );
      // Die Zeile ist weg (neu und wieder entfernt): Der Fokus geht zur Auswahl für die nächste Stufe
      (ziel ?? wurzel.querySelector(".auswahl-knopf"))?.focus();
    }
  };
  zeichne();
  return {
    wurzel,
    // Was die API erwartet: nur zugewiesene Stufen ohne die markierten
    wert: () =>
      stufen
        .filter((s) => zugewiesen.get(s.id)?.weg === false)
        .map((s) => ({ stufeId: s.id, typ: zugewiesen.get(s.id).typ })),
  };
}

// Kinder einer Person: Suche statt Checkliste (personen-wahl.js)
export function kinderFelder(kinder, stufen, gewaehlt) {
  const stufenname = new Map(stufen.map((s) => [s.id, s.name]));
  return suchWahl({
    titel: "Elternteil von",
    beschriftung: "Kind suchen",
    kandidaten: kinder.map((k) => ({
      id: k.id,
      name: `${k.vorname} ${k.nachname}`,
      zusatz: [k.ceviName, stufenname.get(k.stufeId) ?? "ohne Stufe"]
        .filter(Boolean)
        .join(" · "),
    })),
    gewaehlt,
    max: 50,
    leerText: "Es gibt noch keine Kinder.",
    keinerText: "Die Person ist bei keinem Kind als Elternteil eingetragen.",
  });
}

// Telefon (Muster «phone-input»): tolerant beim Tippen, beim Verlassen des Felds die einheitliche Schreibweise; darunter steht, was gespeichert wird
function telefonFeld(wert) {
  const f = feld({
    label: "Telefon (optional)",
    typ: "tel",
    hilfe: `Nur für Stufenleitungen. Eltern, Leitende und Stufenleitung der Stufe sehen die Nummer bei den Kontakten. Schreibe sie wie ${BEISPIEL} oder mit +41. Leer lassen, um sie zu entfernen.`,
    wert: wert ?? "",
    maxlength: 30,
    autocomplete: "tel",
    inputmode: "tel",
  });
  const vorschau = el("p", { class: "klein leise", role: "status" });
  const zeigeVorschau = () => {
    const n = normalisiereTelefon(f.eingabe.value);
    vorschau.textContent = n.vorschau
      ? `Wird gespeichert als ${n.vorschau}`
      : "";
  };
  f.eingabe.addEventListener("input", zeigeVorschau);
  f.eingabe.addEventListener("blur", () => {
    const n = normalisiereTelefon(f.eingabe.value);
    if (n.gueltig && n.wert !== f.eingabe.value) f.eingabe.value = n.wert;
    zeigeVorschau();
  });
  f.wurzel.append(vorschau);
  zeigeVorschau();
  return {
    ...f,
    // Gibt den Wert zum Speichern zurück oder null, wenn die Nummer nicht passt (Meldung beim Feld)
    lies() {
      const n = normalisiereTelefon(f.eingabe.value);
      if (n.gueltig) return n.wert;
      feldFehler(
        f,
        `Diese Nummer passt nicht. Schreibe sie zum Beispiel so: ${BEISPIEL}`,
      );
      return null;
    },
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

// Die Liste lädt neu und ersetzt dabei den Inhalt des Bereichs: Das Startpasswort erscheint erst danach, sonst wäre die Karte gleich wieder weg
const nachLaden = (geladen, fn) => Promise.resolve(geladen).then(fn);

// Aktionen ohne Frist (#578): Ein neues Startpasswort meldet die Person sofort ab und wird genau einmal angezeigt, der zweite Faktor und das Aktivieren sind ebenso nicht zurückzunehmen.
// Statt eines Popups hat der Knopf zwei Stufen (zweiStufig); die Aktion läuft beim zweiten Klick und meldet Fehler als Hinweis
async function direkt(ctx, aktion, danach) {
  try {
    danach(await aktion());
  } catch (f) {
    ctx.melde(fehlertext(f), "fehler");
  }
}

// fertig() schliesst die Seite nach einer geglückten Aktion, denn ihre Angaben sind danach veraltet
function neuesStartpasswort(person, ctx, neu, fertig) {
  return direkt(
    ctx,
    () => anfrage("POST", `/api/v1/admin/personen/${person.id}/startpasswort`),
    (antwort) => {
      const geladen = neu();
      ctx.melde(`Neues Startpasswort für «${person.name}» ist erzeugt.`);
      fertig();
      nachLaden(geladen, () =>
        startpasswortDialog(person.name, antwort.startpasswort),
      );
    },
  );
}

// Deaktivieren lässt sich zurücknehmen: Toast mit «Rückgängig», die Seite schliesst sofort. Aktivieren erzeugt ein Startpasswort (einmalig sichtbar): zwei Stufen
function umschalten(person, ctx, neu, fertig) {
  if (person.deaktiviert) {
    return direkt(
      ctx,
      () => anfrage("POST", `/api/v1/admin/personen/${person.id}/aktivieren`),
      (antwort) => {
        const geladen = neu();
        ctx.melde(`«${person.name}» ist aktiviert.`);
        fertig();
        nachLaden(geladen, () =>
          startpasswortDialog(person.name, antwort.startpasswort),
        );
      },
    );
  }
  ctx.mitRueckgaengig({
    text: `«${person.name}» deaktiviert. Die Person kann sich nicht mehr anmelden und ist überall abgemeldet`,
    ansicht: { weg: fertig, zurueck: () => {} },
    ausfuehren: () =>
      anfrage("POST", `/api/v1/admin/personen/${person.id}/deaktivieren`),
    fehlertext,
    danach: neu,
  });
}

function faktorZuruecksetzen(person, ctx, neu, fertig) {
  return direkt(
    ctx,
    () =>
      anfrage(
        "POST",
        `/api/v1/admin/personen/${person.id}/zweiter-faktor-zuruecksetzen`,
      ),
    () => {
      neu();
      ctx.melde(`Der zweite Faktor von «${person.name}» ist zurückgesetzt.`);
      fertig();
    },
  );
}

// Aktion im Konto-Abschnitt: Titel und Erklärung links, Knopf rechts
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

// Abschnitt als Karte mit Überschrift; text erklärt in einem Satz, wozu er dient
function karte(titel, text, ...inhalt) {
  return el(
    "section",
    { class: "pe-karte" },
    el("h2", {}, titel),
    text && el("p", { class: "leise" }, text),
    ...inhalt,
  );
}

// Tags der Person (Funktion, Team, Lager): Änderungen sammeln sich und gelten mit «Speichern»
// Stufen setzt man nicht hier: Sie entstehen über «Stufen und Rollen» (die Stufenrolle ist die Zuordnung zur Stufe). Hier stehen sie nur als Hinweis
// ursprung: [{ tag, rolle }]; aenderungen: Map tagId -> { art: "neu" | "weg", rolle? }
function tagAbschnitt({ ursprung: alle, alleTags: tags }) {
  const ursprung = alle.filter(({ tag }) => tag.typ !== "stufe");
  const alleTags = tags.filter((t) => t.typ !== "stufe");
  const stufen = alle.filter(({ tag }) => tag.typ === "stufe");
  const aenderungen = new Map();
  const wurzel = el("div", { class: "pe-tags" });
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
            e.rolle && `Rolle ${rolleName(e.rolle)}`,
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
            wurzel.dispatchEvent(new Event("change", { bubbles: true }));
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
        wurzel.dispatchEvent(new Event("change", { bubbles: true }));
      },
    });
    wurzel.replaceChildren(
      ...[
        zeilen.length > 0
          ? el("ul", { class: "liste-zeilen pe-tagzeilen" }, zeilen)
          : alleTags.length > 0 &&
            el("p", { class: "leise" }, "Die Person trägt keinen Tag."),
        frei.length > 0
          ? el(
              "div",
              { class: "pe-tag-neu" },
              tag.wurzel,
              rolle.wurzel,
              hinzufuegen,
            )
          : el(
              "p",
              { class: "hilfe" },
              alleTags.length === 0
                ? "Es gibt noch keine Funktion, kein Team und kein Lager."
                : "Die Person trägt schon alle Tags.",
            ),
      ].filter(Boolean),
    );
  };
  zeichne();
  const hinweise =
    stufen.length > 0 &&
    el(
      "ul",
      { class: "pe-stufenhinweis klein leise" },
      stufen.map(({ tag, rolle }) =>
        el(
          "li",
          {},
          ROLLEN.some(([wert]) => wert && wert === rolle)
            ? `Stufe ${tag.name}: über «Rechte und Rollen» (${rolleName(rolle)}).`
            : `Stufe ${tag.name}: Zuordnung ohne Rolle. Entfernen kannst du sie unter «Gruppen und Tags».`,
        ),
      ),
    );
  return {
    wurzel: el("div", {}, wurzel, hinweise),
    aenderungen: () => [...aenderungen],
  };
}

// Das Profil rechts: Bild (oder Initialen), Name, Rolle und Zustand; beim Erfassen läuft die Vorschau mit dem Namen mit
function profilKarte(person, { nameVon, ctx, neu }) {
  const bild = el("div", { class: "pe-bild" });
  const name = el("p", { class: "pe-profil-name" });
  const zusatz = el("p", { class: "leise" });
  const zeichneBild = () => {
    const n = nameVon();
    bild.replaceChildren(
      avatar(n.name || "Neue Person", {
        hell: true,
        bildUrl: person?.bildUrl,
      }),
    );
    name.textContent = n.name || "Neue Person";
    zusatz.textContent = n.ceviName;
  };
  // Entfernen dürfen Abteilungsleitung und Entwickler (der Server prüft beides). Eine Stelle für die Anzeige
  const kannBildEntfernen = () => siehtAlles(ctx?.ich) && !!person?.bildUrl;
  const hilfe = el("p", { class: "hilfe" });
  const entfernen = el("div", { class: "pe-bild-aktion" });
  const zeichneHilfe = () => {
    hilfe.textContent = person.bildUrl
      ? "Die Person setzt das Profilbild selbst in der App oder in «Mein Konto». Du siehst es hier und in den Listen der Verwaltung. Als Abteilungsleitung kannst du es entfernen, die Person kann dann ein neues setzen."
      : "Noch kein Profilbild. Die Person setzt es selbst in der App oder in «Mein Konto».";
    entfernen.replaceChildren(
      ...(kannBildEntfernen()
        ? [
            zweistufig(
              knopf("Profilbild entfernen", {
                klein: true,
                art: "gefahr",
                symbol: "papierkorb",
              }),
              "Wirklich entfernen?",
              () =>
                direkt(
                  ctx,
                  () =>
                    anfrage(
                      "DELETE",
                      `/api/v1/admin/personen/${person.id}/bild`,
                    ),
                  () => {
                    person.bildUrl = null;
                    zeichneBild();
                    zeichneHilfe();
                    neu?.();
                    ctx.melde(
                      `Das Profilbild von «${person.name}» ist entfernt.`,
                    );
                  },
                ),
            ),
          ]
        : []),
    );
  };
  zeichneBild();
  if (person) zeichneHilfe();
  return {
    zeichneBild,
    wurzel: el(
      "div",
      { class: "pe-profil" },
      bild,
      name,
      zusatz,
      person
        ? [
            el("ul", { class: "chips" }, kontoChips(person)),
            systemRollen(person).length > 0 &&
              el(
                "p",
                { class: "klein leise" },
                systemRollen(person).join(" · "),
              ),
          ]
        : el(
            "p",
            { class: "klein leise" },
            "Das Profilbild setzt die Person selbst in der App oder in «Mein Konto».",
          ),
      person && [hilfe, entfernen],
    ),
  };
}

// Die Seite zum Erfassen (person = null) und Bearbeiten
// daten: { personen, stufen, kinder, tags, tagsJePerson }; beiFokus(id) merkt sich die Person für den Fokus nach dem Neuladen
export function oeffnePerson({ person, daten, ctx, neu, beiFokus, tr }) {
  const eigenes = person?.id === ctx.ich.id;
  const titelId = neueId("titel");
  const zurueck = document.activeElement;
  const ceviName = feld({
    label: "Cevi-Name (optional)",
    wert: person?.ceviName ?? "",
    maxlength: 50,
  });
  // Beim Erfassen zwei Felder (die API will beide), beim Bearbeiten eines
  const vorname = person
    ? null
    : feld({ label: "Vorname", maxlength: 100, required: true });
  const nachname = person
    ? null
    : feld({ label: "Nachname", maxlength: 100, required: true });
  const name = person
    ? feld({
        label: "Name",
        hilfe: "Vorname und Nachname in einem Feld.",
        wert: person.name,
        maxlength: 201,
        "aria-required": "true",
      })
    : null;
  const benutzername = person
    ? null
    : feld({
        label: "Benutzername",
        hilfe:
          "2 bis 64 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich. Gross- und Kleinschreibung zählt nicht.",
        maxlength: 64,
        autocapitalize: "none",
        spellcheck: "false",
        required: true,
      });
  const telefon = telefonFeld(person?.telefon);
  const abteilungsleitung = ankreuzen({
    label: "Abteilungsleitung",
    gewaehlt: person?.abteilungsleitung ?? false,
  });
  const rollen = rollenFelder(daten.stufen, person?.rollen ?? []);
  const kinder = kinderFelder(
    daten.kinder,
    daten.stufen,
    person?.elternteilVon ?? [],
  );
  const tags = person
    ? tagAbschnitt({
        ursprung: daten.tagsJePerson.get(person.id) ?? [],
        alleTags: daten.tags,
      })
    : null;
  const nameVon = () => ({
    name: person
      ? name.eingabe.value.trim()
      : `${vorname.eingabe.value.trim()} ${nachname.eingabe.value.trim()}`.trim(),
    ceviName: ceviName.eingabe.value.trim(),
  });
  const profil = profilKarte(person, { nameVon, ctx, neu });
  for (const f of [name, vorname, nachname, ceviName].filter(Boolean)) {
    f.eingabe.addEventListener("input", profil.zeichneBild);
  }

  const fehler = el("div", { class: "pe-zusammenfassung" });
  const speichern = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt" },
    person ? "Speichern" : "Erfassen",
  );
  const abbrechen = knopf("Abbrechen", {
    onclick: () => seite.versuchSchliessen(),
  });
  const fuss = el("div", { class: "pe-fuss" }, fehler, abbrechen, speichern);

  const konto =
    person &&
    kontoAbschnitt(person, {
      eigenes,
      ctx,
      neu,
      beiFokus,
      schliesse: () => seite.close(),
    });

  const formular = el(
    "form",
    { class: "pe-formular", novalidate: true },
    karte(
      "Angaben",
      null,
      el(
        "div",
        { class: "pe-paar" },
        ...(person
          ? [name.wurzel, ceviName.wurzel]
          : [vorname.wurzel, nachname.wurzel]),
      ),
      !person && ceviName.wurzel,
      person
        ? el(
            "div",
            { class: "feld" },
            el("span", { class: "legende" }, "Benutzername"),
            el(
              "p",
              { class: "personen-benutzername" },
              person.benutzername ?? "–",
            ),
            el("p", { class: "hilfe" }, "Der Benutzername bleibt fest."),
          )
        : benutzername.wurzel,
      telefon.wurzel,
    ),
    karte(
      "Rechte und Rollen",
      "Die Abteilungsleitung braucht einen zweiten Faktor, bevor sie die Verwaltung öffnen kann. Die Rolle in einer Stufe bestimmt, was die Person in dieser Stufe sieht.",
      abteilungsleitung.wurzel,
      person?.entwickler &&
        el(
          "p",
          { class: "hilfe" },
          "Diese Person ist auch Entwickler. Die Rolle «Entwickler» lässt sich hier nur ansehen: Sie vergibt, wer Zugang zum Server hat, auf der Kommandozeile.",
        ),
      rollen.wurzel,
    ),
    tags
      ? karte(
          "Gruppen und Tags",
          "Funktionen, Teams und Lager steuern, wer was sieht und bearbeiten darf. Stufen weist du oben unter «Rechte und Rollen» zu.",
          tags.wurzel,
        )
      : karte(
          "Gruppen und Tags",
          "Gruppen kannst du zuordnen, sobald die Person erfasst ist.",
        ),
    karte(
      "Elternteil von",
      "Eltern sehen die Programme und den Chat der Stufe ihrer Kinder.",
      kinder.wurzel,
    ),
    konto,
    fuss,
  );

  const { kopf } = flussKopf({
    titelId,
    titel: person ? person.name : "Person erfassen",
    untertitel: person
      ? [person.ceviName, ...systemRollen(person)].filter(Boolean).join(" · ")
      : undefined,
    beschreibung: person
      ? undefined
      : "Die Person erhält ein Startpasswort. Es bleibt sichtbar, bis sie es ersetzt hat.",
    beiZurueck: () => seite.versuchSchliessen(),
  });
  const seite = el(
    "section",
    { class: "fluss-seite fluss-breit pe-seite", "aria-labelledby": titelId },
    kopf,
    formularRaster({
      felder: formular,
      seite: profil.wurzel,
      seiteTitel: "Profil",
    }),
  );

  const sperren = (an) => {
    abbrechen.disabled = speichern.disabled = an;
    speichern.setAttribute("aria-busy", String(an));
    for (const e of formular.querySelectorAll("input")) e.readOnly = an;
  };
  const meldeFehler = (text) => {
    const hinweis = el(
      "div",
      { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
      el("span", {}, text),
    );
    fehler.replaceChildren(hinweis);
    hinweis.focus();
  };
  const pflicht = [
    person
      ? { name: "Name", ...name }
      : [
          { name: "Vorname", ...vorname },
          { name: "Nachname", ...nachname },
          { name: "Benutzername", ...benutzername },
        ],
  ].flat();

  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.replaceChildren();
    const fehlt = [];
    for (const f of pflicht) {
      entferneFehler(f);
      if (!f.eingabe.value.trim()) {
        feldFehler(
          f,
          f.name === "Name" ? "Gib einen Namen ein." : "Bitte ausfüllen.",
        );
        fehlt.push(f);
      }
    }
    entferneFehler(telefon);
    let tel = telefon.lies();
    if (tel === null) fehlt.push({ name: "Telefon", ...telefon });
    // Der Server nimmt eine Nummer nur bei einer Stufenleitung an (src/routes/admin/personen.ts)
    else if (tel && !rollen.wert().some((r) => r.typ === "stufenleitung")) {
      feldFehler(
        telefon,
        "Eine Nummer gibt es nur bei der Rolle Stufenleitung. Wähle sie unter «Rechte und Rollen» oder lass das Feld leer.",
      );
      fehlt.push({ name: "Telefon", ...telefon });
      tel = null;
    }
    if (fehlt.length > 0) {
      const hinweis = pruefHinweis(fehlt);
      fehler.append(hinweis);
      hinweis.focus();
      return;
    }
    sperren(true);
    try {
      if (!person) {
        const antwort = await anfrage("POST", "/api/v1/admin/personen", {
          vorname: vorname.eingabe.value.trim(),
          nachname: nachname.eingabe.value.trim(),
          ceviName: ceviName.eingabe.value,
          telefon: tel,
          benutzername: benutzername.eingabe.value.trim(),
          abteilungsleitung: abteilungsleitung.eingabe.checked,
          rollen: rollen.wert(),
          elternteilVon: kinder.wert(),
        });
        seite.close();
        const geladen = neu();
        ctx.melde(`Person «${antwort.benutzername}» ist erfasst.`);
        nachLaden(geladen, () =>
          startpasswortDialog(antwort.benutzername, antwort.startpasswort),
        );
        return;
      }
      await anfrage("PATCH", `/api/v1/admin/personen/${person.id}`, {
        name: name.eingabe.value.trim(),
        ceviName: ceviName.eingabe.value,
        telefon: tel,
        abteilungsleitung: abteilungsleitung.eingabe.checked,
        rollen: rollen.wert(),
        elternteilVon: kinder.wert(),
      });
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
      seite.close();
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
      if (f.code === "BENUTZERNAME_VERGEBEN" && benutzername) {
        feldFehler(
          benutzername,
          "Der Benutzername ist schon vergeben. Wähle einen anderen.",
        );
        benutzername.eingabe.focus();
        return;
      }
      meldeFehler(
        `Nicht gespeichert. ${fehlertext(f)} Deine Änderungen sind noch da, versuche es nochmals.`,
      );
    } finally {
      sperren(false);
    }
  });

  seite.addEventListener("close", () => {
    tr?.classList.remove("gewaehlt");
    if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
    else document.querySelector("h1")?.focus();
  });
  tr?.classList.add("gewaehlt");
  oeffneFluss(seite);
  (person ? name : vorname).eingabe.focus();
  return seite;
}

// Konto (nur beim Bearbeiten): Zustand als Liste, darunter die Aktionen mit zwei Stufen am Knopf oder Rückgängig
function kontoAbschnitt(person, { eigenes, ctx, neu, beiFokus, schliesse }) {
  return karte(
    "Konto",
    null,
    el(
      "dl",
      { class: "werte" },
      el(
        "div",
        {},
        el("dt", {}, "Zustand"),
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
      el(
        "div",
        {},
        el("dt", {}, "Zweiter Faktor"),
        el(
          "dd",
          {},
          person.zweiterFaktor ? "Eingerichtet" : "Nicht eingerichtet",
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
            zweistufig(
              knopf("Startpasswort erzeugen", {
                klein: true,
                symbol: "schluessel",
              }),
              "Wirklich erzeugen?",
              () => {
                beiFokus(person.id);
                neuesStartpasswort(person, ctx, neu, schliesse);
              },
            ),
          ),
          person.zweiterFaktor &&
            kontoAktion(
              "Zweiter Faktor",
              "Die Person muss ihn danach neu einrichten.",
              zweistufig(
                knopf("Zweiten Faktor zurücksetzen", {
                  klein: true,
                  art: "gefahr",
                  symbol: "schild",
                }),
                "Wirklich zurücksetzen?",
                () => {
                  beiFokus(person.id);
                  faktorZuruecksetzen(person, ctx, neu, schliesse);
                },
              ),
            ),
          person.deaktiviert
            ? kontoAktion(
                "Person aktivieren",
                "Sie kann sich wieder anmelden, mit einem neuen Startpasswort.",
                zweistufig(
                  knopf("Aktivieren", { klein: true, symbol: "haken" }),
                  "Wirklich aktivieren?",
                  () => {
                    beiFokus(person.id);
                    umschalten(person, ctx, neu, schliesse);
                  },
                ),
              )
            : kontoAktion(
                "Person deaktivieren",
                "Sie kann sich nicht mehr anmelden und wird überall abgemeldet. Du kannst es einige Sekunden lang rückgängig machen.",
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
}
