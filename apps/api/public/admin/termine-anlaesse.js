import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  auswahl,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  gruppe,
  icon,
  knopf,
  leere,
  neueId,
  tabelle,
} from "./dom.js";

// Reiter «Anlässe» (#445, Epic #430): Anlässe anlegen und verwalten, Zusatzfelder pflegen, Anmeldungen ansehen und als CSV laden. Schnittstelle: siehe termine.js.
// Adressen: #termine/anlaesse (Liste) · #termine/anlaesse/<id> (ein Anlass).
// Abfragen: Liste beim Öffnen 1 (und je «Weitere laden» 1); Anlass beim Öffnen 2 (Anlass, Anmeldungen), danach 1 je Statuswechsel oder «Weitere laden». «Anlass anlegen» holt beim Öffnen des Dialogs 2 (Termine, Tags), «Einstellungen ändern» 1 (Tags). Kein Polling, kein Abruf je Zeile. Die Rechte prüft der Server (nur Abteilungsleitung).

const BASIS = "/api/v1/admin/anlaesse";
const ZONE = "Europe/Zurich";
const MAX_FELDER = 20;
const SEITE = 50;

const fmt = (optionen, zone = ZONE) =>
  new Intl.DateTimeFormat("de-CH", { ...optionen, timeZone: zone });
const TAG = {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};
const tagFormat = fmt(TAG);
const tagUtc = fmt(TAG, "UTC");
const uhrFormat = fmt({ hour: "2-digit", minute: "2-digit" });
const stempelFormat = fmt({ dateStyle: "short", timeStyle: "short" });

// Ganztägige Termine haben nur Tage (tagVon bis tagBis), alle anderen Beginn und Ende als Zeitpunkt
function zeitraum(t) {
  if (t.ganztaegig) {
    const von = tagUtc.format(new Date(`${t.tagVon}T12:00:00Z`));
    if (t.tagVon === t.tagBis) return von;
    return `${von} – ${tagUtc.format(new Date(`${t.tagBis}T12:00:00Z`))}`;
  }
  const beginn = new Date(t.beginn);
  const ende = new Date(t.ende);
  const tag = tagFormat.format(beginn);
  const bis =
    tagFormat.format(ende) === tag
      ? uhrFormat.format(ende)
      : `${tagFormat.format(ende)} ${uhrFormat.format(ende)}`;
  return `${tag}, ${uhrFormat.format(beginn)} – ${bis} Uhr`;
}

const heuteZuerich = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE }).format(new Date());

function vorbei(a) {
  return a.ganztaegig
    ? a.tagBis < heuteZuerich()
    : new Date(a.ende) < new Date();
}

// Der Stand der Anmeldung als Wort mit Symbol, nie nur Farbe
function statusChip(a) {
  if (vorbei(a)) return chip("Termin vorbei", undefined, false);
  if (!a.anmeldungOffen) return chip("Anmeldung geschlossen", "warn");
  if (a.frist && new Date(a.frist) < new Date())
    return chip("Frist vorbei", "warn");
  return chip("Anmeldung offen", "ok");
}

const FUER = { kind: "Kinder", person: "Personen" };
const SICHT = {
  oeffentlich: "Öffentlich",
  angemeldet: "Nur angemeldet",
  tags: "Bestimmte Tags",
};
const sichtText = (s) =>
  s.art === "tags" ? `Bestimmte Tags (${s.tagIds.length})` : SICHT[s.art];
const fristText = (a) =>
  a.frist ? `${stempelFormat.format(new Date(a.frist))} Uhr` : "Keine Frist";

const TEXTE = {
  TAG_UNBEKANNT:
    "Ein gewählter Tag gibt es nicht mehr. Lade die Seite neu und wähle die Tags nochmals.",
  FELD_GESUNDHEIT:
    "Ein Feld fragt nach Gesundheitsdaten. Das nimmt die Anmeldung nicht auf. Gesperrt sind zum Beispiel Wörter rund um Allergien, Medikamente, Krankheiten und Behinderungen, auch in den Antworten zur Auswahl. Formuliere die Frage anders oder lass sie weg.",
};
const meldung = (f) => TEXTE[f.code] ?? fehlertext(f);

export function zeige(bereich, ctx) {
  const [id] = ctx.pfad;
  if (id) zeigeAnlass(bereich, ctx, id);
  else zeigeListe(bereich, ctx);
}

/* ---------- Liste ---------- */

function zeigeListe(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", `${BASIS}?limit=${SEITE}`),
    (erste) => zeichneListe(bereich, ctx, erste),
  );
}

function listenZeile(a) {
  return el(
    "tr",
    {},
    el(
      "th",
      { scope: "row" },
      el(
        "a",
        { class: "name tm-anlaesse-link", href: `#termine/anlaesse/${a.id}` },
        a.titel,
      ),
    ),
    el("td", {}, zeitraum(a)),
    el("td", {}, FUER[a.anmeldungFuer]),
    el("td", {}, el("ul", { class: "chips" }, statusChip(a))),
    el("td", {}, fristText(a)),
    el("td", { class: "zahl" }, String(a.anzahlFelder)),
  );
}

function zeichneListe(bereich, ctx, erste) {
  let naechste = erste.naechste;
  let geladen = erste.anlaesse.length;

  ctx.kopfAktion(
    knopf("Anlass anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: (e) => anlegen(ctx, e.currentTarget),
    }),
  );
  const leer = el(
    "p",
    { class: "leer" },
    "Noch keine Anlässe. Lege den ersten an: Du wählst dafür einen kommenden Termin.",
  );
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Anlässe",
    spalten: [
      "Termin",
      "Wann",
      "Anmeldung für",
      "Stand",
      "Frist",
      ["Zusatzfelder", "zahl"],
    ],
    zeilen: erste.anlaesse.map(listenZeile),
  });
  const status = el("p", { class: "klein tm-anlaesse-status", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: async () => {
      mehr.disabled = true;
      mehr.setAttribute("aria-busy", "true");
      status.textContent = "Weitere Anlässe werden geladen …";
      try {
        const seite = await anfrage(
          "GET",
          `${BASIS}?limit=${SEITE}&nach=${encodeURIComponent(naechste)}`,
        );
        if (!bereich.isConnected) return;
        koerper.append(...seite.anlaesse.map(listenZeile));
        geladen += seite.anlaesse.length;
        naechste = seite.naechste;
        status.textContent = `${seite.anlaesse.length} weitere Anlässe geladen.`;
        mehr.hidden = !seite.weitere;
        // Der Knopf verschwindet mit der letzten Seite: Der Fokus geht an die Tabelle statt ins Leere
        if (!seite.weitere) rahmen.focus();
      } catch (f) {
        status.textContent = `${fehlertext(f)} Versuche es nochmals.`;
      } finally {
        mehr.disabled = false;
        mehr.removeAttribute("aria-busy");
      }
    },
  });
  rahmen.hidden = geladen === 0;
  leer.hidden = geladen !== 0;
  mehr.hidden = !erste.weitere;
  bereich.append(
    el("h2", { class: "tm-anlaesse-titel" }, "Anlässe"),
    el(
      "p",
      { class: "leise tm-anlaesse-text" },
      "Ein Anlass ist ein Termin mit Anmeldung. Du legst ihn an, pflegst die Zusatzfragen und siehst, wer sich angemeldet hat. Die neuesten Anlässe stehen oben. Die Zahl der Anmeldungen siehst du im Anlass.",
    ),
    leer,
    rahmen,
    status,
    el("div", { class: "tm-anlaesse-mehr" }, mehr),
  );
}

/* ---------- Einstellungen (Anlegen und Ändern teilen die Felder) ---------- */

// Browserzeit statt Schweizer Zeit. shortcut: Wer von ausserhalb der Schweiz arbeitet, sieht und gibt Zeiten in der eigenen Zone ein; bei Bedarf mit der Zone Europe/Zurich umrechnen.
function lokal(iso) {
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

function einstellungsFelder(tags, start) {
  const fuer = auswahl({
    label: "Wer meldet sich an?",
    optionen: [
      ["kind", "Eltern melden ihre Kinder an"],
      ["person", "Jede Person meldet sich selbst an"],
    ],
    wert: start.anmeldungFuer,
  });
  const offen = ankreuzen({
    label: "Die Anmeldung ist offen",
    gewaehlt: start.anmeldungOffen,
    wert: "1",
  });
  const frist = feld({
    label: "Anmeldeschluss (optional)",
    typ: "datetime-local",
    hilfe:
      "Ohne Anmeldeschluss ist die Anmeldung bis zum Ende des Termins möglich.",
    wert: start.frist ? lokal(start.frist) : "",
  });
  const sicht = auswahl({
    label: "Wer sieht den Anlass?",
    optionen: [
      ["angemeldet", SICHT.angemeldet],
      ["oeffentlich", SICHT.oeffentlich],
      ...(tags.length > 0 ? [["tags", SICHT.tags]] : []),
    ],
    wert: start.sichtbarkeit.art,
  });
  const gewaehlt = new Set(
    start.sichtbarkeit.art === "tags" ? start.sichtbarkeit.tagIds : [],
  );
  const tagWahl = tags.map((t) =>
    ankreuzen({ label: t.name, gewaehlt: gewaehlt.has(t.id), wert: t.id }),
  );
  const tagGruppe = gruppe(
    "Tags",
    el(
      "div",
      {},
      tagWahl.map((w) => w.wurzel),
    ),
    { scrollen: true },
  );
  const tagFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const zeigeTags = () => {
    tagGruppe.hidden = sicht.eingabe.value !== "tags";
    tagFehler.hidden = true;
  };
  sicht.eingabe.addEventListener("change", zeigeTags);
  zeigeTags();
  return {
    knoten: [
      fuer.wurzel,
      offen.wurzel,
      frist.wurzel,
      sicht.wurzel,
      tagGruppe,
      tagFehler,
    ],
    // true, wenn etwas fehlt (Meldung und Fokus setzt die Funktion selbst)
    pruefe() {
      if (
        sicht.eingabe.value === "tags" &&
        !tagWahl.some((w) => w.eingabe.checked)
      ) {
        tagFehler.textContent = "Wähle mindestens einen Tag.";
        tagFehler.hidden = false;
        tagWahl[0].eingabe.focus();
        return true;
      }
      return false;
    },
    lies() {
      const art = sicht.eingabe.value;
      return {
        anmeldungFuer: fuer.eingabe.value,
        anmeldungOffen: offen.eingabe.checked,
        frist: frist.eingabe.value
          ? new Date(frist.eingabe.value).toISOString()
          : null,
        sichtbarkeit:
          art === "tags"
            ? {
                art,
                tagIds: tagWahl
                  .filter((w) => w.eingabe.checked)
                  .map((w) => w.eingabe.value),
              }
            : { art },
      };
    },
  };
}

async function anlegen(ctx, ausloeser) {
  const von = heuteZuerich();
  const bis = new Date(Date.parse(von) + 399 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  ausloeser.disabled = true;
  ausloeser.setAttribute("aria-busy", "true");
  let termine;
  let tags;
  try {
    [termine, tags] = await Promise.all([
      anfrage("GET", `/api/v1/termine/alle?von=${von}&bis=${bis}&limit=100`),
      anfrage("GET", "/api/v1/admin/tags"),
    ]);
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  } finally {
    ausloeser.disabled = false;
    ausloeser.removeAttribute("aria-busy");
  }
  const frei = termine.termine.filter((t) => !t.anlass);
  if (frei.length === 0) {
    ctx.melde(
      "Es gibt keinen kommenden Termin ohne Anlass. Termine kommen aus Outlook.",
      "fehler",
    );
    return;
  }
  const wahl = auswahl({
    label: "Termin",
    optionen: [
      ["", "Termin wählen"],
      ...frei.map((t) => [t.id, `${t.titel} · ${zeitraum(t)}`]),
    ],
    wert: "",
  });
  const terminFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const rest = einstellungsFelder(tags.tags, {
    anmeldungFuer: "kind",
    anmeldungOffen: true,
    frist: null,
    sichtbarkeit: { art: "angemeldet" },
  });
  dialogFormular({
    titel: "Anlass anlegen",
    beschreibung:
      "Ein Anlass macht aus einem Termin einen Termin mit Anmeldung. Die Zusatzfragen ergänzt du danach.",
    felder: [
      wahl.wurzel,
      terminFehler,
      termine.weitere &&
        el(
          "p",
          { class: "hilfe" },
          "Die Liste zeigt die nächsten 100 Termine.",
        ),
      ...rest.knoten,
    ],
    ok: "Anlass anlegen",
    pruefe() {
      if (!wahl.eingabe.value) {
        terminFehler.textContent = "Wähle einen Termin.";
        terminFehler.hidden = false;
        wahl.wurzel.querySelector(".auswahl-knopf").focus();
        return true;
      }
      terminFehler.hidden = true;
      return rest.pruefe();
    },
    senden: () =>
      anfrage("POST", BASIS, {
        programmId: wahl.eingabe.value,
        ...rest.lies(),
      }),
    fehlertext: meldung,
    danach: (neu) => {
      location.hash = `#termine/anlaesse/${neu.id}`;
    },
  });
}

/* ---------- Ein Anlass ---------- */

function zeigeAnlass(bereich, ctx, id) {
  const pfad = `${BASIS}/${encodeURIComponent(id)}`;
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", pfad),
        anfrage("GET", `${pfad}/anmeldungen?limit=${SEITE}`),
      ]),
    ([anlass, anmeldungen]) =>
      zeichneAnlass(bereich, ctx, pfad, anlass, anmeldungen),
  );
}

function zeichneAnlass(bereich, ctx, pfad, anlass, erste) {
  const kopfBlock = el("div", { class: "tm-anlaesse-kopf" });
  const felderBlock = el("section", { class: "tm-anlaesse-abschnitt" });
  const anmeldungenBlock = el("section", { class: "tm-anlaesse-abschnitt" });
  // Eine Quelle für Kopf und Beschriftungen der Antworten; der Editor führt «felder» nach dem Speichern nach
  const zustand = { anlass, felder: anlass.felder };
  const zeichneTabelle = anmeldungsAnsicht(
    anmeldungenBlock,
    pfad,
    zustand,
    erste,
  );

  function zeichneKopf() {
    leere(kopfBlock);
    const a = zustand.anlass;
    kopfBlock.append(
      el(
        "a",
        { class: "tm-anlaesse-zurueck", href: "#termine/anlaesse" },
        "Alle Anlässe",
      ),
      el("h2", { class: "tm-anlaesse-titel" }, a.titel),
      el(
        "dl",
        { class: "tm-anlaesse-daten" },
        ...[
          ["Wann", zeitraum(a)],
          ["Anmeldung für", FUER[a.anmeldungFuer]],
          ["Anmeldeschluss", fristText(a)],
          ["Sichtbar für", sichtText(a.sichtbarkeit)],
        ].flatMap(([k, w]) => [el("dt", {}, k), el("dd", {}, w)]),
        el("dt", {}, "Stand"),
        el("dd", {}, el("ul", { class: "chips" }, statusChip(a))),
        a.seiteId && el("dt", {}, "Anlassseite"),
        a.seiteId &&
          el(
            "dd",
            {},
            el(
              "a",
              { href: `#website/seiten/${a.seiteId}` },
              "Im Bereich «Website» öffnen",
            ),
          ),
      ),
      el(
        "div",
        { class: "tm-anlaesse-aktionen" },
        knopf("Einstellungen ändern", {
          symbol: "bearbeiten",
          onclick: () => einstellungen(),
        }),
        knopf(a.anmeldungOffen ? "Anmeldung schliessen" : "Anmeldung öffnen", {
          onclick: (e) => umschalten(e.currentTarget),
        }),
        knopf("Anlass löschen", {
          art: "gefahr",
          symbol: "papierkorb",
          onclick: () => loeschen(),
        }),
      ),
    );
  }

  // Nur den Kopf neu laden: Der Editor behält ungespeicherte Änderungen
  async function ladeKopf() {
    zustand.anlass = await anfrage("GET", pfad);
    zustand.felder = zustand.anlass.felder;
    zeichneKopf();
    zeichneTabelle();
  }

  async function einstellungen() {
    let tags;
    try {
      tags = (await anfrage("GET", "/api/v1/admin/tags")).tags;
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
      return;
    }
    const a = zustand.anlass;
    const rest = einstellungsFelder(tags, a);
    dialogFormular({
      titel: "Einstellungen ändern",
      beschreibung: `Für «${a.titel}». Wer sich anmeldet, lässt sich nur ändern, solange es keine Anmeldungen gibt.`,
      felder: rest.knoten,
      ok: "Speichern",
      pruefe: () => rest.pruefe(),
      senden: () => anfrage("PATCH", pfad, rest.lies()),
      fehlertext: meldung,
      danach: async () => {
        try {
          await ladeKopf();
          ctx.melde("Die Einstellungen sind gespeichert.");
          // Der Kopf wurde neu gezeichnet: Der Fokus kehrt zum Auslöser zurück
          kopfBlock.querySelector(".tm-anlaesse-aktionen .knopf")?.focus();
        } catch (f) {
          ctx.melde(meldung(f), "fehler");
        }
      },
    });
  }

  async function umschalten(knoten) {
    const offen = !zustand.anlass.anmeldungOffen;
    knoten.disabled = true;
    knoten.setAttribute("aria-busy", "true");
    try {
      await anfrage("PATCH", pfad, { anmeldungOffen: offen });
      await ladeKopf();
      ctx.melde(
        offen ? "Die Anmeldung ist offen." : "Die Anmeldung ist geschlossen.",
      );
      // Der Knopf wurde neu gezeichnet: Der Fokus bleibt bei der Aktion
      kopfBlock
        .querySelector(".tm-anlaesse-aktionen .knopf:nth-child(2)")
        ?.focus();
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
      knoten.disabled = false;
      knoten.removeAttribute("aria-busy");
    }
  }

  function loeschen() {
    const a = zustand.anlass;
    bestaetigen({
      titel: "Anlass löschen",
      beschreibung: `«${a.titel}» ist danach kein Anlass mehr, der Termin bleibt. Das geht nur ohne Anmeldungen. Die Anlassseite bleibt im Bereich «Website» bestehen.`,
      ok: "Anlass löschen",
      aktion: () => anfrage("DELETE", pfad),
      danach: () => {
        leere(bereich);
        const bestaetigung = el(
          "p",
          { class: "hinweis hinweis--ok", role: "status", tabindex: "-1" },
          `«${a.titel}» ist kein Anlass mehr.`,
        );
        bereich.append(
          bestaetigung,
          el(
            "p",
            { class: "tm-anlaesse-text" },
            el("a", { href: "#termine/anlaesse" }, "Zurück zu den Anlässen"),
          ),
        );
        bestaetigung.focus();
      },
    });
  }

  zeichneKopf();
  felderEditor(felderBlock, pfad, zustand, zeichneTabelle);
  bereich.append(kopfBlock, felderBlock, anmeldungenBlock);
}

/* ---------- Editor der Zusatzfelder ---------- */

const TYPEN = [
  ["text", "Text"],
  ["ja_nein", "Ja oder Nein"],
  ["auswahl", "Auswahl aus einer Liste"],
];
const UMLAUTE = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

// Schlüssel nur aus Kleinbuchstaben, Ziffern und «_» (wie der Server verlangt), eindeutig innerhalb des Anlasses
function schluesselAus(text, vergeben) {
  const basis =
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (z) => UMLAUTE[z])
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "feld";
  let s = basis;
  for (let n = 2; vergeben.has(s); n++) s = `${basis}_${n}`;
  return s;
}

// Meldung beim Feld (als Text, nicht nur Farbe); verschwindet beim nächsten Tippen
function feldFehler(f, text) {
  const eingabe = f.eingabe;
  const p = el(
    "p",
    { class: "feld-fehler", id: neueId("fehler"), role: "alert" },
    text,
  );
  f.wurzel.append(p);
  eingabe.setAttribute("aria-invalid", "true");
  const vorher = eingabe.getAttribute("aria-describedby");
  eingabe.setAttribute(
    "aria-describedby",
    [vorher, p.id].filter(Boolean).join(" "),
  );
  eingabe.addEventListener(
    "input",
    () => {
      eingabe.removeAttribute("aria-invalid");
      if (vorher) eingabe.setAttribute("aria-describedby", vorher);
      else eingabe.removeAttribute("aria-describedby");
      p.remove();
    },
    { once: true },
  );
}

function felderEditor(block, pfad, zustand, beiSpeichern) {
  const zeilen = [];
  let geaendert = false;
  const liste = el("ol", { class: "tm-anlaesse-felder" });
  const status = el("p", {
    class: "klein tm-anlaesse-status",
    role: "status",
  });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const hinzu = knopf("Feld hinzufügen", {
    symbol: "plus",
    onclick: () => {
      const z = neueZeile({ typ: "text", optionen: [], pflicht: false });
      zeilen.push(z);
      liste.append(z.knoten);
      aktualisiere();
      markiere();
      z.beschriftung.eingabe.focus();
      sage(`Neues Feld ${zeilen.length} von ${zeilen.length} ist da.`);
    },
  });
  const speichern = knopf("Felder speichern", {
    art: "haupt",
    symbol: "haken",
    onclick: () => speichere(),
  });
  const leer = el(
    "p",
    { class: "leer leer--klein" },
    "Noch keine Zusatzfragen. Die Anmeldung fragt dann nur nach der Person oder dem Kind.",
  );

  function sage(text) {
    status.textContent = text;
  }
  function markiere() {
    if (geaendert) return;
    geaendert = true;
    sage("Änderungen sind noch nicht gespeichert.");
  }
  const bezeichnung = (z, i) =>
    z.beschriftung.eingabe.value.trim() || `Feld ${i + 1}`;
  const optionenVon = (z) =>
    z.optionen.eingabe.value
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

  // Nummern, Namen der Knöpfe und gesperrte Richtungen nachführen
  function aktualisiere() {
    zeilen.forEach((z, i) => {
      const name = bezeichnung(z, i);
      z.titel.textContent = `Feld ${i + 1}`;
      z.hoch.disabled = i === 0;
      z.runter.disabled = i === zeilen.length - 1;
      z.hoch.setAttribute("aria-label", `Nach oben: ${name}`);
      z.runter.setAttribute("aria-label", `Nach unten: ${name}`);
      z.weg.setAttribute("aria-label", `Entfernen: ${name}`);
    });
    leer.hidden = zeilen.length > 0;
    hinzu.disabled = zeilen.length >= MAX_FELDER;
  }

  function verschiebe(z, richtung) {
    const i = zeilen.indexOf(z);
    const j = i + richtung;
    if (j < 0 || j >= zeilen.length) return;
    [zeilen[i], zeilen[j]] = [zeilen[j], zeilen[i]];
    liste.replaceChildren(...zeilen.map((e) => e.knoten));
    aktualisiere();
    markiere();
    // Beim Umhängen verliert der Knopf den Fokus; am Rand ist seine Richtung gesperrt, dann folgt die andere
    const gleich = richtung < 0 ? z.hoch : z.runter;
    (gleich.disabled ? (richtung < 0 ? z.runter : z.hoch) : gleich).focus();
    sage(
      `«${bezeichnung(z, j)}» steht jetzt an Stelle ${j + 1} von ${zeilen.length}.`,
    );
  }

  function entferne(z) {
    const i = zeilen.indexOf(z);
    const name = bezeichnung(z, i);
    zeilen.splice(i, 1);
    z.knoten.remove();
    aktualisiere();
    markiere();
    // Der Fokus geht auf die Überschrift des nächsten, sonst des vorigen Feldes, sonst auf «Feld hinzufügen»
    (zeilen[i]?.titel ?? zeilen[i - 1]?.titel ?? hinzu).focus();
    sage(
      `«${name}» ist entfernt, noch nicht gespeichert. ${zeilen.length === 1 ? "Es bleibt 1 Feld." : `Es bleiben ${zeilen.length} Felder.`}`,
    );
  }

  function neueZeile(f) {
    const z = { schluessel: f.schluessel ?? null };
    const titelId = neueId("feld-titel");
    z.titel = el("h4", { id: titelId, tabindex: "-1" });
    z.beschriftung = feld({
      label: "Frage",
      wert: f.beschriftung ?? "",
      maxlength: 100,
    });
    z.typ = auswahl({ label: "Antwort", optionen: TYPEN, wert: f.typ });
    z.optionen = feld({
      label: "Antworten zur Auswahl",
      mehrzeilig: true,
      rows: 4,
      wert: f.optionen.join("\n"),
      hilfe: "Eine Antwort pro Zeile. Mindestens 2, höchstens 20.",
    });
    z.pflicht = ankreuzen({
      label: "Pflichtfeld: Ohne Antwort geht die Anmeldung nicht",
      gewaehlt: f.pflicht,
      wert: "1",
    });
    z.hoch = knopf("Nach oben", {
      klein: true,
      symbol: "hoch",
      onclick: () => verschiebe(z, -1),
    });
    z.runter = knopf("Nach unten", {
      klein: true,
      symbol: "runter",
      onclick: () => verschiebe(z, 1),
    });
    z.weg = knopf("Entfernen", {
      klein: true,
      art: "gefahr",
      symbol: "papierkorb",
      onclick: () => entferne(z),
    });
    const zeigeOptionen = () => {
      z.optionen.wurzel.hidden = z.typ.eingabe.value !== "auswahl";
    };
    z.typ.eingabe.addEventListener("change", zeigeOptionen);
    zeigeOptionen();
    z.knoten = el(
      "li",
      {
        class: "tm-anlaesse-feld",
        role: "group",
        "aria-labelledby": titelId,
      },
      el(
        "div",
        { class: "tm-anlaesse-feldkopf" },
        el(
          "div",
          {},
          z.titel,
          z.schluessel &&
            el(
              "p",
              { class: "klein leise" },
              `Schlüssel: ${z.schluessel}. Er bleibt, auch wenn du die Frage umformulierst.`,
            ),
        ),
        el("div", { class: "aktionen" }, z.hoch, z.runter, z.weg),
      ),
      z.beschriftung.wurzel,
      z.typ.wurzel,
      z.optionen.wurzel,
      z.pflicht.wurzel,
    );
    z.knoten.addEventListener("input", () => {
      aktualisiere();
      markiere();
    });
    z.knoten.addEventListener("change", markiere);
    return z;
  }

  // true, wenn alles stimmt; sonst Meldungen beim Feld und Fokus auf das erste
  function pruefe() {
    for (const e of block.querySelectorAll(".feld-fehler")) e.remove();
    let erstes = null;
    const fehlt = (f, text) => {
      feldFehler(f, text);
      erstes ??= f.eingabe;
    };
    for (const z of zeilen) {
      if (!z.beschriftung.eingabe.value.trim())
        fehlt(z.beschriftung, "Gib eine Frage ein.");
      if (z.typ.eingabe.value !== "auswahl") continue;
      const o = optionenVon(z);
      if (o.some((t) => t.length > 100))
        fehlt(z.optionen, "Jede Antwort darf höchstens 100 Zeichen lang sein.");
      else if (o.length < 2)
        fehlt(z.optionen, "Gib mindestens 2 Antworten an, eine pro Zeile.");
      else if (o.length > 20)
        fehlt(z.optionen, "Gib höchstens 20 Antworten an.");
      else if (new Set(o).size !== o.length)
        fehlt(z.optionen, "Jede Antwort darf nur einmal vorkommen.");
    }
    erstes?.focus();
    return erstes === null;
  }

  async function speichere() {
    fehler.hidden = true;
    if (!pruefe()) {
      sage("Bitte prüfe die markierten Felder.");
      return;
    }
    const vergeben = new Set(zeilen.map((z) => z.schluessel).filter(Boolean));
    // Neue Schlüssel gelten erst nach dem Speichern: Scheitert es, darf die Frage noch umformuliert werden
    const neu = new Map();
    const felder = zeilen.map((z) => {
      let schluessel = z.schluessel;
      if (!schluessel) {
        schluessel = schluesselAus(z.beschriftung.eingabe.value, vergeben);
        vergeben.add(schluessel);
        neu.set(z, schluessel);
      }
      const typ = z.typ.eingabe.value;
      return {
        schluessel,
        beschriftung: z.beschriftung.eingabe.value.trim(),
        typ,
        optionen: typ === "auswahl" ? optionenVon(z) : [],
        pflicht: z.pflicht.eingabe.checked,
      };
    });
    speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    sage("Wird gespeichert …");
    try {
      const antwort = await anfrage("PUT", `${pfad}/felder`, { felder });
      zustand.felder = antwort.felder;
      for (const [z, schluessel] of neu) z.schluessel = schluessel;
      geaendert = false;
      sage(`Gespeichert um ${uhrFormat.format(new Date())} Uhr.`);
      beiSpeichern();
    } catch (f) {
      sage("");
      fehler.textContent = belegt(f, felder) ?? meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  }

  // 409 FELD_IN_BENUTZUNG nennt die Schlüssel; der Text nennt die Fragen
  function belegt(f, felder) {
    if (f.code !== "FELD_IN_BENUTZUNG") return null;
    const namen = (f.daten?.schluessel ?? [])
      .map((s) => felder.find((x) => x.schluessel === s)?.beschriftung ?? s)
      .map((n) => `«${n}»`)
      .join(", ");
    return `Zu diesen Feldern gibt es schon Antworten: ${namen}. Sie lassen sich weder entfernen noch auf einen anderen Typ umstellen. Stelle sie wieder her oder lade die Seite neu.`;
  }

  for (const f of zustand.felder) zeilen.push(neueZeile(f));
  liste.append(...zeilen.map((z) => z.knoten));
  aktualisiere();
  block.append(
    el("h3", { class: "tm-anlaesse-unter" }, "Zusatzfelder der Anmeldung"),
    el(
      "p",
      { class: "hinweis hinweis--warn tm-anlaesse-gesundheit" },
      "Frage keine Gesundheitsdaten ab (zum Beispiel Allergien, Medikamente, Krankheiten). Das sieht Version 1 nicht vor.",
    ),
    el(
      "p",
      { class: "leise tm-anlaesse-text" },
      `Diese Fragen stellt die Anmeldung zusätzlich. Höchstens ${MAX_FELDER} Felder, in der Reihenfolge der Liste. Erst «Felder speichern» übernimmt deine Änderungen.`,
    ),
    leer,
    liste,
    el("div", { class: "tm-anlaesse-aktionen" }, hinzu, speichern),
    fehler,
    status,
  );
}

/* ---------- Anmeldungen und Export ---------- */

const STATUS_TEXT = {
  angemeldet: "angemeldet",
  abgemeldet: "abgemeldet",
  alle: "angemeldet und abgemeldet",
};

// Zeichnet Summen, Filter, Tabelle und Export; liefert eine Funktion, die Filter und Tabelle neu zeichnet (nach geänderten Feldern oder Einstellungen)
function anmeldungsAnsicht(block, pfad, zustand, erste) {
  let status = "angemeldet";
  let eintraege = erste.eintraege;
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let summe = erste.summe;

  const meld = el("p", { class: "klein tm-anlaesse-status", role: "status" });
  const tabellenHalter = el("div", { class: "tm-anlaesse-tabelle" });
  const filterHalter = el("div", {});
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => lade(false),
  });
  // Ein Link mit download: Der Browser lädt die Datei mit der Sitzung, nichts geht in den Speicher der Seite
  const exportLink = el(
    "a",
    { class: "knopf", download: "" },
    icon("runter"),
    "Exportieren (CSV)",
  );
  const exportHinweis = el("p", { class: "klein leise tm-anlaesse-text" });

  function zeichneFilter() {
    const gruppe = filterGruppe({
      beschriftung: "Anmeldungen nach Stand",
      eintraege: [
        { text: "Angemeldet", n: summe.angemeldet, wert: "angemeldet" },
        { text: "Abgemeldet", n: summe.abgemeldet, wert: "abgemeldet" },
        {
          text: "Alle",
          n: summe.angemeldet + summe.abgemeldet,
          wert: "alle",
        },
      ],
      wert: status,
      beiAenderung: (wert) => {
        const alt = status;
        status = wert;
        lade(true, alt);
      },
    });
    filterHalter.replaceChildren(gruppe.wurzel);
  }

  function zeile(e) {
    const antworten = zustand.felder.flatMap((f) => {
      const wert = e.antworten[f.schluessel];
      if (wert === undefined || wert === "") return [];
      return [
        el("dt", {}, f.beschriftung),
        el("dd", {}, typeof wert === "boolean" ? (wert ? "Ja" : "Nein") : wert),
      ];
    });
    return el(
      "tr",
      {},
      el(
        "th",
        { scope: "row" },
        el("span", { class: "name" }, e.person.name),
        e.person.telefon &&
          el(
            "span",
            { class: "klein leise tm-anlaesse-zusatz" },
            e.person.telefon,
          ),
      ),
      zustand.anlass.anmeldungFuer === "kind" &&
        el(
          "td",
          {},
          e.kind
            ? [
                el(
                  "span",
                  { class: "name" },
                  `${e.kind.vorname} ${e.kind.nachname}`,
                ),
                e.kind.ceviName &&
                  el(
                    "span",
                    { class: "klein leise tm-anlaesse-zusatz" },
                    e.kind.ceviName,
                  ),
                el(
                  "span",
                  { class: "klein leise tm-anlaesse-zusatz" },
                  e.kind.stufe,
                ),
              ]
            : "–",
        ),
      el(
        "td",
        {},
        el(
          "ul",
          { class: "chips" },
          e.status === "angemeldet"
            ? chip("Angemeldet", "ok")
            : chip("Abgemeldet", undefined, false),
        ),
      ),
      el(
        "td",
        {},
        antworten.length > 0
          ? el("dl", { class: "tm-anlaesse-antworten" }, ...antworten)
          : "–",
      ),
      el("td", {}, stempelFormat.format(new Date(e.geaendertAm))),
    );
  }

  function zeichneTabelle() {
    leere(tabellenHalter);
    if (eintraege.length === 0) {
      tabellenHalter.append(
        el(
          "p",
          { class: "leer" },
          status === "abgemeldet"
            ? "Keine Abmeldungen."
            : status === "alle"
              ? "Noch keine Anmeldungen."
              : "Noch niemand ist angemeldet.",
        ),
      );
      return;
    }
    const kind = zustand.anlass.anmeldungFuer === "kind";
    tabellenHalter.append(
      tabelle({
        beschriftung: "Anmeldungen",
        spalten: [
          "Angemeldet von",
          ...(kind ? ["Kind"] : []),
          "Stand",
          "Antworten",
          "Geändert",
        ],
        zeilen: eintraege.map(zeile),
      }).wurzel,
    );
  }

  function zeichneAlles() {
    zeichneFilter();
    zeichneTabelle();
    mehr.hidden = !weitere;
    exportLink.setAttribute("href", `${pfad}/anmeldungen.csv?status=${status}`);
    exportHinweis.textContent = `Die Datei enthält alle Anmeldungen mit dem Stand «${STATUS_TEXT[status]}», nicht nur die geladenen. Sie enthält Namen und Telefonnummern: Speichere sie nur, wo du sie brauchst, und lösche sie danach. Zellen, die mit = + - oder @ beginnen, bekommen in der Datei ein Hochkomma davor, auch Telefonnummern mit +41. Das schützt vor Formeln in Excel. Pro Person sind 10 Exporte in 10 Minuten möglich.`;
  }

  // neu: erste Seite des gewählten Stands; sonst die nächste Seite anhängen
  async function lade(neu, alt) {
    const vonFilter = filterHalter.contains(document.activeElement);
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    tabellenHalter.setAttribute("aria-busy", "true");
    meld.textContent = "Anmeldungen werden geladen …";
    try {
      const nach = neu ? "" : `&nach=${encodeURIComponent(naechste)}`;
      const antwort = await anfrage(
        "GET",
        `${pfad}/anmeldungen?status=${status}&limit=${SEITE}${nach}`,
      );
      if (!block.isConnected) return;
      eintraege = neu
        ? antwort.eintraege
        : [...eintraege, ...antwort.eintraege];
      weitere = antwort.weitere;
      naechste = antwort.naechste;
      summe = antwort.summe;
      zeichneAlles();
      meld.textContent = neu
        ? `${eintraege.length}${weitere ? " oder mehr" : ""} Anmeldungen mit dem Stand «${STATUS_TEXT[status]}».`
        : `${antwort.eintraege.length} weitere Anmeldungen geladen.`;
      // Der Filter wurde neu gebaut: Der gedrückte Knopf bekommt den Fokus zurück
      if (vonFilter) {
        filterHalter.querySelector('[aria-pressed="true"]')?.focus();
      }
    } catch (f) {
      meld.textContent = `${fehlertext(f)} Versuche es nochmals.`;
      // Die Tabelle zeigt noch den alten Stand: Der Filter bleibt auch dort
      if (neu) {
        status = alt;
        zeichneFilter();
        if (vonFilter)
          filterHalter.querySelector('[aria-pressed="true"]')?.focus();
      }
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
      tabellenHalter.removeAttribute("aria-busy");
    }
  }

  zeichneAlles();
  block.append(
    el("h3", { class: "tm-anlaesse-unter" }, "Anmeldungen"),
    el(
      "p",
      { class: "leise tm-anlaesse-text" },
      "Name und Telefon kommen live aus dem Konto der Person, die angemeldet hat. Die zuletzt geänderten Anmeldungen stehen oben.",
    ),
    el("div", { class: "tm-anlaesse-leiste" }, filterHalter, exportLink),
    exportHinweis,
    tabellenHalter,
    meld,
    el("div", { class: "tm-anlaesse-mehr" }, mehr),
  );
  return () => {
    zeichneFilter();
    zeichneTabelle();
  };
}
