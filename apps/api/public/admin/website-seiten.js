import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  gruppe,
  icon,
  knopf,
  menue,
  neueId,
  tabelle,
  zeit,
} from "./dom.js";

// Seitenliste und Einstellungen (#357). Schnittstelle zum Bereich: siehe website.js.
// Ein Abruf lädt die ganze Liste (der Baum entsteht hier aus elternId); jede Änderung ist ein PATCH und danach ein neuer Abruf.
// Verschieben geht nur über Knöpfe (kein Ziehen): Nach oben, Nach unten, Einrücken, Ausrücken oder die Position in den Einstellungen.

const API = "/api/v1/redaktion";
// Wie MAX_TIEFE in src/website/seiten.ts; der Server prüft es ohnehin
const MAX_TIEFE = 5;
const ADRESSE = /^[a-z0-9-]{1,60}$/;
const ARTEN = [
  ["oeffentlich", "Öffentlich"],
  ["angemeldet", "Nur angemeldet"],
  ["tags", "Bestimmte Gruppen"],
];
// Codes, deren Meldung der Server für Menschen formuliert hat
const SEITEN_CODES = new Set([
  "ADRESSE_RESERVIERT",
  "ADRESSE_VERGEBEN",
  "TAG_VERGEBEN",
  "TAG_ERFORDERLICH",
  "SEITE_ZYKLUS",
  "SEITE_ZU_TIEF",
  "SEITE_HAT_UNTERSEITEN",
]);

// frage, filter: überleben das Neuladen nach einer Aktion
// fokus: { id, was } Element, das nach dem Neuladen den Fokus bekommt; vorlagen: einmal je Besuch geladen
// beschaeftigt: Ein Verschieben läuft, weitere Klicks gelten nicht
const zustand = {
  frage: "",
  filter: "alle",
  fokus: null,
  vorlagen: null,
  beschaeftigt: false,
};

export function zeige(bereich, ctx) {
  zustand.frage = "";
  zustand.filter = "alle";
  zustand.fokus = null;
  zustand.vorlagen = null;
  zustand.beschaeftigt = false;
  ctx.lade(
    async () => {
      const [liste, tags] = await Promise.all([
        anfrage("GET", `${API}/seiten`),
        anfrage("GET", `${API}/tags`),
      ]);
      return { seiten: liste.seiten, tags: tags.tags };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

// Eigene Prüfmeldung eines Dialogs: erscheint wie ein Serverfehler im Dialog
const eigenerFehler = (text) =>
  Object.assign(new Error("EIGEN"), { code: "EIGEN", meldung: text });
const seitenFehler = (f) =>
  f?.meldung && (f.code === "EIGEN" || SEITEN_CODES.has(f.code))
    ? f.meldung
    : fehlertext(f);

const anzahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);

function sichtbarkeitText(s, tagNamen) {
  if (s.art === "oeffentlich") return "Öffentlich";
  if (s.art === "angemeldet") return "Nur angemeldet";
  if (s.tagIds.length === 0) return "Bestimmte Gruppen (keine gewählt)";
  return `Bestimmte Gruppen: ${s.tagIds
    .map((id) => tagNamen.get(id) ?? "unbekannte Gruppe")
    .join(", ")}`;
}

const gleicheSichtbarkeit = (a, b) =>
  a.art === b.art &&
  (a.art !== "tags" ||
    (a.tagIds.length === b.tagIds.length &&
      a.tagIds.every((id) => b.tagIds.includes(id))));

// Der Baum aus der flachen Liste. Eine Seite, deren Elternseite fehlt (Stufenleitung sieht nur ihre Seite), steht oben.
function baue(seiten) {
  const nachId = new Map(seiten.map((s) => [s.id, s]));
  const kinder = new Map();
  for (const s of seiten) {
    const schluessel =
      s.elternId !== null && nachId.has(s.elternId) ? s.elternId : null;
    if (!kinder.has(schluessel)) kinder.set(schluessel, []);
    kinder.get(schluessel).push(s);
  }
  const zeilen = [];
  const ebenen = new Map();
  const gehe = (schluessel, ebene) => {
    const geschwister = kinder.get(schluessel) ?? [];
    geschwister.forEach((seite, index) => {
      ebenen.set(seite.id, ebene);
      zeilen.push({ seite, ebene, geschwister, index });
      gehe(seite.id, ebene + 1);
    });
  };
  gehe(null, 0);
  const hoehe = (id) =>
    1 + Math.max(0, ...(kinder.get(id) ?? []).map((k) => hoehe(k.id)));
  const nachfahren = (id) =>
    new Set((kinder.get(id) ?? []).flatMap((k) => [k.id, ...nachfahren(k.id)]));
  return { nachId, kinder, zeilen, ebenen, hoehe, nachfahren };
}

// Ordnet die Seite unter der Elternseite an die Stelle index (0 = ganz oben, gezählt ohne sie selbst) und liefert die nötigen PATCH-Körper.
// Die Seite selbst steht zuerst: Scheitert sie, ist noch nichts verändert.
function plane(seiten, seite, elternId, index) {
  const andere = seiten.filter(
    (s) => s.elternId === elternId && s.id !== seite.id,
  );
  const pos = Math.max(0, Math.min(index, andere.length));
  const reihe = [...andere.slice(0, pos), seite, ...andere.slice(pos)];
  const aenderungen = [];
  reihe.forEach((s, i) => {
    const eigene = s.id === seite.id;
    const elternNeu = eigene && s.elternId !== elternId;
    if (s.reihenfolge === i && !elternNeu) return;
    const eintrag = { id: s.id, reihenfolge: i };
    if (elternNeu) eintrag.elternId = elternId;
    if (eigene) aenderungen.unshift(eintrag);
    else aenderungen.push(eintrag);
  });
  return { aenderungen, position: pos + 1, anzahl: reihe.length };
}

// Der PATCH-Körper ohne die Kennung (sie steht im Pfad)
const koerper = (eintrag) => {
  const rest = { ...eintrag };
  delete rest.id;
  return rest;
};
const patch = (id, body) => anfrage("PATCH", `${API}/seiten/${id}`, body);

// Optionsknöpfe (Radio) im Stil der Stufenrollen bei den Personen
function segment(legende, optionen, wert, beiAenderung) {
  const name = neueId("segment");
  const knoepfe = optionen.map(([w, text]) => {
    const id = neueId("segment-option");
    return {
      eingabe: el("input", {
        type: "radio",
        id,
        name,
        value: w,
        checked: w === wert,
        onchange: () => beiAenderung(w),
      }),
      label: el("label", { for: id }, icon("haken"), text),
    };
  });
  return el(
    "fieldset",
    {},
    el("legend", {}, legende),
    el(
      "div",
      { class: "seg" },
      knoepfe.flatMap((o) => [o.eingabe, o.label]),
    ),
  );
}

function sichtbarkeitFelder(start, tags) {
  let art = start.art;
  const boxen = tags.map((t) =>
    ankreuzen({
      label: t.name,
      gewaehlt: start.art === "tags" && start.tagIds.includes(t.id),
      wert: t.id,
    }),
  );
  const gruppenListe = gruppe(
    "Gruppen",
    boxen.length > 0
      ? boxen.map((b) => b.wurzel)
      : el("p", { class: "hilfe" }, "Es gibt noch keine Gruppen."),
    { scrollen: true },
  );
  gruppenListe.hidden = art !== "tags";
  return {
    felder: [
      segment("Wer sieht die Seite?", ARTEN, art, (neu) => {
        art = neu;
        gruppenListe.hidden = art !== "tags";
      }),
      gruppenListe,
    ],
    wert() {
      if (art !== "tags") return { art };
      const tagIds = boxen
        .filter((b) => b.eingabe.checked)
        .map((b) => b.eingabe.value);
      if (tagIds.length === 0) {
        throw eigenerFehler("Wähle mindestens eine Gruppe.");
      }
      return { art, tagIds };
    },
  };
}

function fertig(k, text, fokus) {
  zustand.fokus = fokus;
  zustand.beschaeftigt = false;
  k.neu();
  if (text) k.ctx.melde(text);
}

// Verschieben per Knopf: Anfrage(n), danach Liste neu laden. Meldet sofort «Wird verschoben …» und ignoriert Klicks, bis es fertig ist.
async function verschiebe(k, z, elternId, index, text, fokus) {
  if (zustand.beschaeftigt) return;
  zustand.beschaeftigt = true;
  k.ctx.melde("Wird verschoben …");
  const plan = plane(k.daten.seiten, z.seite, elternId, index);
  try {
    for (const a of plan.aenderungen) await patch(a.id, koerper(a));
  } catch (f) {
    // Je nachdem, wie weit es kam, ist die Liste jetzt anders: neu laden
    fertig(k, "", fokus);
    k.ctx.melde(seitenFehler(f), "fehler");
    return;
  }
  fertig(k, text(plan), fokus);
}

function einstellungen(k, z) {
  const { seite, index } = z;
  const verwalten = k.ctx.zugang.darf("seiten.anlegen_loeschen");
  const titel = feld({
    label: "Titel",
    wert: seite.titel,
    maxlength: 150,
    required: true,
  });
  const adresse = feld({
    label: "Adresse",
    wert: seite.adresse,
    maxlength: 60,
    required: true,
    autocomplete: "off",
    spellcheck: "false",
    hilfe:
      "Nur Kleinbuchstaben, Ziffern und «-». Ändert sich die Adresse, ändert sich auch die Adresse der veröffentlichten Seite.",
  });
  const verboten = k.baum.nachfahren(seite.id);
  verboten.add(seite.id);
  const hoehe = k.baum.hoehe(seite.id);
  const eltern = verwalten
    ? auswahl({
        label: "Elternseite",
        optionen: [
          ["", "Oberste Ebene"],
          ...k.daten.seiten
            .filter(
              (s) =>
                !verboten.has(s.id) &&
                (k.baum.ebenen.get(s.id) ?? 0) + 1 + hoehe <= MAX_TIEFE,
            )
            .map((s) => [s.id, `${s.titel} (${s.pfad})`]),
        ],
        wert: seite.elternId ?? "",
      })
    : null;
  const position = verwalten
    ? feld({
        label: "Position",
        typ: "number",
        wert: String(index + 1),
        min: 1,
        inputmode: "numeric",
        hilfe:
          "1 steht ganz oben unter der Elternseite. In der Liste geht es auch mit «Nach oben» und «Nach unten».",
      })
    : null;
  const sicht = sichtbarkeitFelder(seite.sichtbarkeit, k.daten.tags);
  dialogFormular({
    titel: "Einstellungen",
    beschreibung: `«${seite.titel}» · ${seite.pfad}`,
    felder: [
      titel.wurzel,
      adresse.wurzel,
      eltern?.wurzel,
      position?.wurzel,
      ...sicht.felder,
      verwalten &&
        el(
          "p",
          { class: "hilfe" },
          k.ctx.ich.role === "admin"
            ? "Wer die Seite sonst noch bearbeiten darf, stellst du in der Liste unter «Mehr» bei «Wer darf bearbeiten» ein."
            : "Wer die Seite sonst noch bearbeiten darf, legt die Abteilungsleitung fest.",
        ),
    ].filter(Boolean),
    ok: "Speichern",
    fehlertext: seitenFehler,
    senden: async () => {
      const neuAdresse = adresse.eingabe.value.trim();
      if (!ADRESSE.test(neuAdresse)) {
        throw eigenerFehler(
          "Die Adresse darf nur Kleinbuchstaben, Ziffern und «-» enthalten und höchstens 60 Zeichen lang sein.",
        );
      }
      const neuTitel = titel.eingabe.value.trim();
      const sichtbarkeit = sicht.wert();
      const aendern = {};
      if (neuTitel !== seite.titel) aendern.titel = neuTitel;
      if (neuAdresse !== seite.adresse) aendern.adresse = neuAdresse;
      if (!gleicheSichtbarkeit(sichtbarkeit, seite.sichtbarkeit)) {
        aendern.sichtbarkeit = sichtbarkeit;
      }
      const weitere = [];
      if (verwalten) {
        const neuEltern = eltern.eingabe.value || null;
        const pos = Number(position.eingabe.value.trim());
        if (!Number.isInteger(pos) || pos < 1) {
          throw eigenerFehler("Die Position ist eine ganze Zahl ab 1.");
        }
        const elternGeaendert = neuEltern !== seite.elternId;
        const posGeaendert = pos !== index + 1;
        if (elternGeaendert || posGeaendert) {
          // Wechselt nur die Elternseite, kommt die Seite ans Ende
          const { aenderungen } = plane(
            k.daten.seiten,
            seite,
            neuEltern,
            elternGeaendert && !posGeaendert ? Infinity : pos - 1,
          );
          for (const a of aenderungen) {
            if (a.id === seite.id) Object.assign(aendern, koerper(a));
            else weitere.push(a);
          }
        }
      }
      if (Object.keys(aendern).length === 0 && weitere.length === 0) {
        return false;
      }
      if (Object.keys(aendern).length > 0) await patch(seite.id, aendern);
      for (const a of weitere) await patch(a.id, koerper(a));
      return true;
    },
    danach: (geaendert) =>
      fertig(
        k,
        geaendert
          ? `«${titel.eingabe.value.trim()}» ist gespeichert.`
          : "Nichts geändert.",
        { id: seite.id, was: "einstellungen" },
      ),
  });
}

async function neueSeite(k) {
  if (!zustand.vorlagen) {
    try {
      zustand.vorlagen = (await anfrage("GET", `${API}/vorlagen`)).vorlagen;
    } catch (f) {
      k.ctx.melde(seitenFehler(f), "fehler");
      return;
    }
  }
  const vorlagen = zustand.vorlagen;
  const vorlage = auswahl({
    label: "Vorlage",
    optionen: vorlagen.map((v) => [v.schluessel, v.name]),
    wert: (vorlagen.find((v) => v.schluessel === "leer") ?? vorlagen[0])
      .schluessel,
  });
  const beschreibung = el("p", { class: "hilfe", role: "status" });
  const titel = feld({
    label: "Titel",
    maxlength: 120,
    required: true,
    hilfe: "Die Adresse entsteht aus dem Titel. Du kannst sie danach ändern.",
  });
  const eltern = auswahl({
    label: "Elternseite",
    optionen: [
      ["", "Oberste Ebene"],
      ...k.daten.seiten
        .filter((s) => (k.baum.ebenen.get(s.id) ?? 0) + 2 <= MAX_TIEFE)
        .map((s) => [s.id, `${s.titel} (${s.pfad})`]),
    ],
    wert: "",
  });
  const belegt = new Set(k.daten.seiten.map((s) => s.tagId).filter(Boolean));
  const freieTags = k.daten.tags.filter((t) => !belegt.has(t.id));
  const gruppeFeld = auswahl({
    label: "Gruppe",
    optionen: [["", "Gruppe wählen"], ...freieTags.map((t) => [t.id, t.name])],
    wert: "",
  });
  // Ohne Vorgabe «öffentlich»: Wer anlegt, öffnet die Seite bewusst
  const sicht = sichtbarkeitFelder({ art: "angemeldet" }, k.daten.tags);
  const aktualisiere = () => {
    const v = vorlagen.find((x) => x.schluessel === vorlage.eingabe.value);
    beschreibung.textContent = v?.beschreibung ?? "";
    gruppeFeld.wurzel.hidden = !v?.brauchtTag;
  };
  vorlage.eingabe.addEventListener("change", aktualisiere);
  aktualisiere();
  dialogFormular({
    titel: "Neue Seite",
    felder: [
      vorlage.wurzel,
      beschreibung,
      titel.wurzel,
      eltern.wurzel,
      gruppeFeld.wurzel,
      ...sicht.felder,
    ],
    ok: "Seite anlegen",
    fehlertext: seitenFehler,
    senden: () => {
      const v = vorlagen.find((x) => x.schluessel === vorlage.eingabe.value);
      const tagId = v?.brauchtTag ? gruppeFeld.eingabe.value : "";
      if (v?.brauchtTag && !tagId) {
        throw eigenerFehler(
          freieTags.length === 0
            ? "Alle Gruppen haben schon eine Seite."
            : "Wähle die Gruppe, zu der die Seite gehört.",
        );
      }
      return anfrage("POST", `${API}/seiten/aus-vorlage`, {
        vorlage: vorlage.eingabe.value,
        titel: titel.eingabe.value.trim(),
        elternId: eltern.eingabe.value || null,
        ...(tagId && { tagId }),
        sichtbarkeit: sicht.wert(),
      });
    },
    danach: (neu) => {
      // Ein Filter könnte die neue Zeile verstecken
      zustand.frage = "";
      zustand.filter = "alle";
      fertig(k, "Die Seite ist angelegt. Sie ist ein Entwurf.", {
        id: neu.id,
        was: "name",
      });
    },
  });
}

function loeschen(k, z) {
  const { seite } = z;
  const n = (k.baum.kinder.get(seite.id) ?? []).length;
  const dialog = dialogFormular({
    titel: "Seite löschen",
    beschreibung:
      n > 0
        ? `«${seite.titel}» hat ${anzahlText(n, "1 Unterseite", "Unterseiten")}. Verschiebe oder lösche sie zuerst, danach lässt sich die Seite löschen.`
        : `«${seite.titel}» wird samt Entwurf und allen Versionen gelöscht. Das lässt sich nicht rückgängig machen.${
            seite.veroeffentlicht
              ? " Die Seite ist veröffentlicht: Ihre Adresse zeigt danach nichts mehr an."
              : ""
          }`,
    ok: "Löschen",
    gefaehrlich: true,
    fehlertext: seitenFehler,
    senden: () => anfrage("DELETE", `${API}/seiten/${seite.id}`),
    danach: () => {
      const i = k.baum.zeilen.indexOf(z);
      const nachbar = k.baum.zeilen[i + 1] ?? k.baum.zeilen[i - 1];
      fertig(
        k,
        `«${seite.titel}» ist gelöscht.`,
        nachbar ? { id: nachbar.seite.id, was: "name" } : null,
      );
    },
  });
  if (n > 0) dialog.querySelector("button[type=submit]").disabled = true;
}

// Sonderrechte auf genau diese Seite: nur Admins (die Routen unter /admin); alle anderen sehen den Grund in den Einstellungen
async function rechte(k, z, summary) {
  const { seite } = z;
  let liste;
  let personen;
  try {
    [liste, personen] = await Promise.all([
      anfrage("GET", "/api/v1/admin/bearbeiter"),
      anfrage("GET", "/api/v1/admin/personen"),
    ]);
  } catch (f) {
    k.ctx.melde(seitenFehler(f), "fehler");
    return;
  }
  const tagNamen = new Map(k.daten.tags.map((t) => [t.id, t.name]));
  const personNamen = new Map(personen.personen.map((p) => [p.id, p.name]));
  const bezeichnung = (b) =>
    b.tagId
      ? `Gruppe «${tagNamen.get(b.tagId) ?? "unbekannt"}»`
      : `Person ${personNamen.get(b.userId) ?? "unbekannt"}`;
  const meldung = el("p", { class: "hilfe", role: "status", tabindex: "-1" });
  const zeilen = el("ul", {
    class: "ws-seiten-rechte",
    "aria-label": "Zusätzliche Rechte auf diese Seite",
  });
  const leer = el(
    "p",
    { class: "hilfe" },
    "Es gibt keine zusätzlichen Rechte auf diese Seite. Die Abteilungsleitung, wer das Recht «Seiten bearbeiten» hat (Rolle Webmaster) und die Stufenleitung der zugehörigen Stufe dürfen sie immer bearbeiten.",
  );
  const zeigeLeer = () => {
    leer.hidden = zeilen.children.length > 0;
  };
  for (const b of liste.bearbeiter.filter(
    (e) => e.objektTyp === "seite" && e.objektId === seite.id,
  )) {
    const name = bezeichnung(b);
    const li = el(
      "li",
      {},
      el("span", {}, name),
      knopf("Entziehen", {
        klein: true,
        kontext: name,
        onclick: async () => {
          try {
            await anfrage("DELETE", `/api/v1/admin/bearbeiter/${b.id}`);
            li.remove();
            zeigeLeer();
            meldung.setAttribute("role", "status");
            meldung.textContent = `Das Recht von ${name} ist entzogen.`;
          } catch (f) {
            meldung.setAttribute("role", "alert");
            meldung.textContent = seitenFehler(f);
          }
          meldung.focus();
        },
      }),
    );
    zeilen.append(li);
  }
  zeigeLeer();
  // Gruppe oder Person: ein Feld je Art, nur eines sichtbar
  let art = k.daten.tags.length > 0 ? "tagId" : "userId";
  const gruppeWahl = auswahl({
    label: "Gruppe",
    optionen: [
      ["", "Gruppe wählen"],
      ...k.daten.tags.map((t) => [t.id, t.name]),
    ],
    wert: "",
  });
  const personWahl = auswahl({
    label: "Person",
    optionen: [
      ["", "Person wählen"],
      ...personen.personen
        .filter((p) => !p.deaktiviert)
        .map((p) => [p.id, p.name]),
    ],
    wert: "",
  });
  const umschalten = () => {
    gruppeWahl.wurzel.hidden = art !== "tagId";
    personWahl.wurzel.hidden = art !== "userId";
  };
  umschalten();
  // Das Menü hat sich mit dem Klick geschlossen: Der Fokus soll beim «Mehr» der Zeile beginnen, damit er dorthin zurückkehrt
  summary?.focus();
  dialogFormular({
    titel: "Wer darf bearbeiten",
    beschreibung: `«${seite.titel}». Eine Gruppe gibt das Recht allen Personen, die sie tragen.`,
    felder: [
      zeilen,
      leer,
      meldung,
      segment(
        "Recht erteilen an",
        [
          ["tagId", "Gruppe"],
          ["userId", "Person"],
        ],
        art,
        (neu) => {
          art = neu;
          umschalten();
        },
      ),
      gruppeWahl.wurzel,
      personWahl.wurzel,
    ],
    ok: "Recht erteilen",
    fehlertext: seitenFehler,
    senden: () => {
      const wert = (art === "tagId" ? gruppeWahl : personWahl).eingabe.value;
      if (!wert) throw eigenerFehler("Wähle eine Gruppe oder eine Person.");
      return anfrage("POST", "/api/v1/admin/bearbeiter", {
        objektTyp: "seite",
        objektId: seite.id,
        [art]: wert,
      });
    },
    danach: () => k.ctx.melde("Das Recht ist erteilt."),
  });
}

function zeile(k, z) {
  const { seite, ebene, geschwister, index } = z;
  const verwalten = k.ctx.zugang.darf("seiten.anlegen_loeschen");
  const kontext = seite.titel;
  const name = el(
    "a",
    { class: "name", href: `#website/seiten/${seite.id}` },
    seite.titel,
  );
  const vorher = geschwister[index - 1];
  const kannEinruecken =
    vorher !== undefined && ebene + 2 + k.baum.hoehe(seite.id) - 1 <= MAX_TIEFE;
  const eltern =
    seite.elternId !== null ? k.baum.nachId.get(seite.elternId) : undefined;
  const einstellungenKnopf = knopf("Einstellungen", {
    klein: true,
    symbol: "bearbeiten",
    kontext,
    onclick: () => einstellungen(k, z),
  });
  const pfeil = (richtung, text, ziel) =>
    el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund ws-seiten-pfeil",
        "aria-label": `${text}: ${kontext}`,
        title: text,
        disabled:
          richtung === "hoch" ? index === 0 : index === geschwister.length - 1,
        onclick: () =>
          verschiebe(
            k,
            z,
            seite.elternId,
            ziel,
            (plan) =>
              `«${seite.titel}» steht jetzt an Position ${plan.position} von ${plan.anzahl}.`,
            { id: seite.id, was: richtung },
          ),
      },
      icon(richtung),
    );
  const beweglich = verwalten && geschwister.length > 1;
  const hoch = beweglich && pfeil("hoch", "Nach oben", index - 1);
  const runter = beweglich && pfeil("runter", "Nach unten", index + 1);
  const mehr = menue(
    kontext,
    verwalten
      ? [
          kannEinruecken && {
            text: "Einrücken",
            onclick: () =>
              verschiebe(
                k,
                z,
                vorher.id,
                Infinity,
                () => `«${seite.titel}» liegt jetzt unter «${vorher.titel}».`,
                { id: seite.id, was: "name" },
              ),
          },
          eltern && {
            text: "Ausrücken",
            onclick: () =>
              verschiebe(
                k,
                z,
                eltern.elternId,
                // Direkt hinter der bisherigen Elternseite
                k.daten.seiten
                  .filter((s) => s.elternId === eltern.elternId)
                  .indexOf(eltern) + 1,
                () =>
                  eltern.elternId === null
                    ? `«${seite.titel}» liegt jetzt auf der obersten Ebene.`
                    : `«${seite.titel}» liegt jetzt unter «${
                        k.baum.nachId.get(eltern.elternId)?.titel ?? ""
                      }».`,
                { id: seite.id, was: "name" },
              ),
          },
          k.ctx.ich.role === "admin" && {
            text: "Wer darf bearbeiten",
            onclick: () =>
              rechte(
                k,
                z,
                document.activeElement
                  ?.closest("details.menue")
                  ?.querySelector("summary"),
              ),
          },
          {
            text: "Löschen",
            gefaehrlich: true,
            onclick: () => loeschen(k, z),
          },
        ]
      : [],
  );
  const tr = el(
    "tr",
    {},
    el(
      "th",
      { scope: "row" },
      el(
        "div",
        { class: `ws-seiten-zelle ws-seiten-ebene-${Math.min(ebene, 4)}` },
        name,
        el("span", { class: "ws-seiten-pfad" }, seite.pfad),
        ebene > 0 &&
          el("span", { class: "nur-leser" }, `Unterseite, Ebene ${ebene + 1}`),
      ),
    ),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        seite.veroeffentlicht
          ? chip("Veröffentlicht", "ok")
          : chip("Entwurf", undefined, "bearbeiten"),
      ),
    ),
    el("td", {}, sichtbarkeitText(seite.sichtbarkeit, k.tagNamen)),
    el(
      "td",
      {},
      el("time", { datetime: seite.geaendertAm }, zeit(seite.geaendertAm)),
    ),
    aktionenZelle(einstellungenKnopf, hoch, runter, mehr),
  );
  return {
    seite,
    tr,
    knoepfe: { name, einstellungen: einstellungenKnopf, hoch, runter },
    suche: `${seite.titel} ${seite.pfad}`.toLowerCase(),
  };
}

function zeichne(bereich, ctx, daten, neu) {
  const baum = baue(daten.seiten);
  const k = {
    ctx,
    daten,
    baum,
    neu,
    tagNamen: new Map(daten.tags.map((t) => [t.id, t.name])),
  };
  const darfAnlegen =
    ctx.zugang.darf("seiten.anlegen_loeschen") &&
    ctx.zugang.darf("vorlagen.nutzen");
  if (darfAnlegen) {
    ctx.kopfAktion(
      knopf("Neue Seite", {
        art: "haupt",
        symbol: "plus",
        onclick: () => neueSeite(k),
      }),
    );
  }
  if (daten.seiten.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        darfAnlegen
          ? "Es gibt noch keine Seiten. Lege die erste an."
          : "Du kannst im Moment keine Seite bearbeiten.",
      ),
    );
    return;
  }
  const eintraege = baum.zeilen.map((z) => zeile(k, z));
  const { wurzel } = tabelle({
    beschriftung: "Seiten der Website",
    spalten: [
      "Seite",
      "Status",
      "Sichtbarkeit",
      "Zuletzt geändert",
      "Aktionen",
    ],
    zeilen: eintraege.map((e) => e.tr),
  });
  wurzel.classList.add("ws-seiten-tabelle");
  const FILTER = {
    alle: () => true,
    entwurf: (s) => !s.veroeffentlicht,
    veroeffentlicht: (s) => s.veroeffentlicht,
  };
  const anzahl = (wert) => daten.seiten.filter(FILTER[wert]).length;
  const zaehler = el("p", { class: "meta zaehler", role: "status" });
  const suchId = neueId("suche");
  const aktualisiere = () => {
    const frage = zustand.frage.trim().toLowerCase();
    let n = 0;
    for (const e of eintraege) {
      const sichtbar =
        FILTER[zustand.filter](e.seite) && e.suche.includes(frage);
      e.tr.hidden = !sichtbar;
      if (sichtbar) n++;
    }
    zaehler.textContent = `${n} von ${anzahlText(daten.seiten.length, "1 Seite", "Seiten")}`;
    keine.hidden = n > 0;
    wurzel.hidden = n === 0;
  };
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Titel oder Adresse",
    autocomplete: "off",
    oninput: () => {
      zustand.frage = suche.value;
      aktualisiere();
    },
  });
  suche.value = zustand.frage;
  const filter = filterGruppe({
    beschriftung: "Status",
    wert: zustand.filter,
    eintraege: [
      ["alle", "Alle"],
      ["entwurf", "Entwurf"],
      ["veroeffentlicht", "Veröffentlicht"],
    ].map(([wert, text]) => ({ text, wert, n: anzahl(wert) })),
    beiAenderung: (wert) => {
      zustand.filter = wert;
      aktualisiere();
    },
  });
  const keine = el(
    "div",
    { class: "leer", hidden: true },
    el("p", {}, "Keine Seite passt zur Suche."),
    knopf("Suche zurücksetzen", {
      klein: true,
      onclick: () => {
        zustand.frage = "";
        zustand.filter = "alle";
        suche.value = "";
        filter.setze("alle");
        aktualisiere();
        suche.focus();
      },
    }),
  );
  aktualisiere();
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "div",
        { class: "suche" },
        el("label", { class: "nur-leser", for: suchId }, "Seiten suchen"),
        icon("lupe"),
        suche,
      ),
      filter.wurzel,
    ),
    zaehler,
    keine,
    wurzel,
  );
  // Nach einer Aktion zurück zum Knopf, der sie auslöste; ist er gesperrt oder weg, zum nächsten sinnvollen
  if (zustand.fokus) {
    const ziel = eintraege.find((e) => e.seite.id === zustand.fokus.id);
    const bevorzugt = ziel?.knoepfe[zustand.fokus.was];
    zustand.fokus = null;
    if (!document.querySelector("dialog[open]")) {
      const knoten = [
        bevorzugt,
        ziel?.knoepfe.runter,
        ziel?.knoepfe.hoch,
        ziel?.knoepfe.einstellungen,
        ziel?.knoepfe.name,
      ].find((e) => e && !e.disabled);
      (knoten ?? document.querySelector("h1"))?.focus();
    }
  }
}
