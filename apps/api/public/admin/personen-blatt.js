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

// Die Rollen einer Person im System, so wie die API sie kennt: Admin, Stufenrolle (Leitung), Elternteil
export function systemRollen(person) {
  return [
    person.admin && "Admin",
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
      { class: "pe-rollenraster" },
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

// Tags der Person: Änderungen sammeln sich und gelten mit «Speichern»
// ursprung: [{ tag, rolle }]; aenderungen: Map tagId -> { art: "neu" | "weg", rolle? }
function tagAbschnitt({ ursprung, alleTags }) {
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

// Das Profil rechts: Bild (oder Initialen), Name, Rolle und Zustand; beim Erfassen läuft die Vorschau mit dem Namen mit
function profilKarte(person, { nameVon }) {
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
  zeichneBild();
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
            "Das Profilbild setzt die Person selbst in der App.",
          ),
      person &&
        el(
          "p",
          { class: "hilfe" },
          person.bildUrl
            ? "Das Profilbild setzt die Person selbst in der App. Du siehst es hier und in den Listen der Verwaltung."
            : "Noch kein Profilbild. Die Person setzt es selbst in der App.",
        ),
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
  const websiteFreigabe = ankreuzen({
    label: "Name und Profilbild auf der Website zeigen",
    gewaehlt: person?.websiteFreigabe ?? false,
  });
  const admin = ankreuzen({
    label: "Admin-Rechte (Abteilungsleitung)",
    gewaehlt: person?.admin ?? false,
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
  const profil = profilKarte(person, { nameVon });
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
      el(
        "div",
        { class: "pe-wahlfeld" },
        websiteFreigabe.wurzel,
        el(
          "p",
          { class: "hilfe" },
          "Die öffentliche Website zeigt den Cevi-Namen (sonst den Vornamen) und das Profilbild, aber nur mit dieser Freigabe. Die Person kann sie auch selbst setzen und widerrufen. Bei Minderjährigen braucht es das Einverständnis der Eltern.",
        ),
      ),
    ),
    karte(
      "Rechte und Rollen",
      "Admins brauchen einen zweiten Faktor, bevor sie die Verwaltung öffnen können. Die Stufenrolle bestimmt, was die Person in ihrer Stufe sieht.",
      admin.wurzel,
      rollen.wurzel,
    ),
    tags
      ? karte(
          "Gruppen und Tags",
          "Sie steuern, wer was sieht und bearbeiten darf.",
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
          admin: admin.eingabe.checked,
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
        websiteFreigabe: websiteFreigabe.eingabe.checked,
        admin: admin.eingabe.checked,
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
