import { anfrage, fehlertext } from "./api.js";
import { zustandsKarte } from "./zustaende.js";
import {
  ankreuzen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  neueId,
} from "./dom.js";
import { formularRaster } from "./formularraster.js";
import { adressSuche } from "./ort-suche.js";
import { ansichtVonKnopf, zweiStufig } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { sichererKartenLink } from "./orte-logik.js";
import { symbol } from "./website-symbole.js";

// Orte (#646): Treffpunkte und Schlussorte, die oft vorkommen, einmal angelegt und in den Samstagsangaben der Stufen per Auswahl gewählt.
// Adresse: #website/stufenfakten/orte. Ein Standort ist nur ein Verweis «Auf Google Maps ansehen»: Die Website lädt keine Karte und kein Skript von Google. Gelesen und geprüft wird der Standort vom Server (POST /orte/vorschau); diese Datei baut keinen Link aus Eingaben.
const API = "/api/v1/redaktion/orte";
const FREI = "__frei";
const NEU = "__neu";
// So viele zuletzt gewählte Orte stehen in der Auswahl zuerst, sobald es mehr als ein halbes Dutzend Orte gibt
const ZULETZT = 3;
const AB_ORTEN = 6;
const MAX_NAME = 100;
const MAX_BESCHREIBUNG = 200;
const MAX_STANDORT = 600;
const MAX_ORT_TEXT = 500;

const tagFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const kurzDatum = (iso) => tagFormat.format(new Date(`${iso}T12:00:00Z`));

// Der Verweis zur Karte als kleiner Knopf mit Standort-Symbol und dem Zeichen für «fremde Seite» (#661); hier in einem neuen Tab, damit das Formular offen bleibt.
// Nur ein Link: kein Skript, keine Karte, keine Verbindung zu Google vor dem Klick
export function kartenVerweis(link, text = "Auf Karte ansehen") {
  const href = link ? sichererKartenLink(link) : null;
  if (!href) return null;
  return el(
    "a",
    {
      class: "knopf knopf--klein ort-karte",
      href,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    symbol("ort"),
    text,
    symbol("extern"),
    el("span", { class: "nur-leser" }, " (Google Maps, öffnet in neuem Tab)"),
  );
}

// 403 heisst hier «kein Recht an den Orten» (Verantwortliche eines Teams ohne Stufe): ohne Orte bleibt die Samstagsangabe ein Freitext
export async function ladeOrte() {
  try {
    return (await anfrage("GET", API)).orte;
  } catch (f) {
    if (f?.status === 403) return null;
    throw f;
  }
}

// Die beiden Reiter der Seite: Angaben je Stufe und Orte
export function reiter(aktiv) {
  const eintrag = ([schluessel, name, adresse]) =>
    el(
      "a",
      {
        class: "tab",
        href: adresse,
        ...(schluessel === aktiv && { "aria-current": "page" }),
      },
      name,
    );
  return el(
    "nav",
    { class: "tabs ort-reiter", "aria-label": "Bereiche der Samstagsangaben" },
    [
      ["angaben", "Angaben", "#website/stufenfakten"],
      ["orte", "Orte", "#website/stufenfakten/orte"],
    ].map(eintrag),
  );
}

// ---------- Die Auswahl in den Samstagsangaben ----------

// Auswahlfeld für Treffpunkt und Schlussort: gespeicherte Orte (die zuletzt gewählten zuerst), «Neuer Ort…» und «Anderer Ort (Freitext)».
// orte: Liste der API oder null (kein Recht an den Orten: dann nur ein Textfeld). ortId und text: die gespeicherte Angabe
// Rückgabe: wurzel, eingaben (für die Vorschau), werte() für die Anfrage und anzeige() für die Vorschau
export function ortAuswahl({ label, orte, ortId, text, ctx }) {
  if (orte === null) {
    const f = feld({ label, wert: text ?? "", maxlength: MAX_ORT_TEXT });
    return {
      wurzel: f.wurzel,
      eingaben: [f.eingabe],
      werte: () => ({ ortId: "", text: f.eingabe.value }),
      anzeige: () => ({ name: f.eingabe.value.trim() }),
    };
  }
  let alle = [...orte];
  const vorhanden = (id) => alle.find((o) => o.id === id);
  // Ohne bekannte Kennung ist eine vorhandene Angabe Freitext (alter Eintrag oder gelöschter Ort)
  let aktuell = vorhanden(ortId) ? ortId : text ? FREI : "";
  const id = neueId("ort");
  const select = el("select", { id });
  const huelle = el("div", { class: "feld" });
  const beschriftung = el("label", { for: id, id: `${id}-label` }, label);
  const freitext = feld({
    label: `${label} als Text`,
    wert: vorhanden(ortId) ? "" : (text ?? ""),
    maxlength: MAX_ORT_TEXT,
    hilfe: "Für einen Ort, der nur einmal vorkommt. Er erscheint ohne Karte.",
  });
  const hinweis = el("p", { class: "hilfe ort-hinweis" });
  const ordnung = (liste) =>
    [...liste].sort(
      (a, b) =>
        a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, "de-CH"),
    );

  function baueOptionen() {
    const sichtbar = alle.filter((o) => o.aktiv || o.id === aktuell);
    const zuletzt =
      sichtbar.length >= AB_ORTEN
        ? sichtbar
            .filter((o) => o.zuletztVerwendetAm)
            .sort((a, b) =>
              b.zuletztVerwendetAm.localeCompare(a.zuletztVerwendetAm),
            )
            .slice(0, ZULETZT)
        : [];
    const rest = ordnung(sichtbar.filter((o) => !zuletzt.includes(o)));
    const option = (o) =>
      el(
        "option",
        { value: o.id },
        o.aktiv ? o.name : `${o.name} (ausgeblendet)`,
      );
    // Eine gesperrte Option ist hier eine Überschrift der Liste
    const titel = (t) => el("option", { value: "", disabled: true }, t);
    select.replaceChildren(
      el("option", { value: "" }, "Nicht festgelegt"),
      ...(zuletzt.length > 0
        ? [
            titel("Zuletzt verwendet"),
            ...zuletzt.map(option),
            titel("Alle Orte"),
          ]
        : []),
      ...rest.map(option),
      el("option", { value: NEU }, "Neuer Ort …"),
      el("option", { value: FREI }, "Anderer Ort (Freitext)"),
    );
    select.value = aktuell;
  }

  function zeige() {
    freitext.wurzel.hidden = aktuell !== FREI;
    const o = vorhanden(aktuell);
    hinweis.hidden = !o;
    hinweis.replaceChildren();
    if (o) {
      if (o.beschreibung) hinweis.append(`${o.beschreibung}. `);
      const verweis = kartenVerweis(o.kartenLink);
      hinweis.append(
        ...(verweis
          ? ["Mit Standort: ", verweis]
          : ["Ohne Standort: Auf der Website steht nur der Name."]),
      );
    }
  }

  baueOptionen();
  freitext.wurzel.classList.add("ort-freitext");
  huelle.append(beschriftung, select, hinweis, freitext.wurzel);
  // Das Auswahlfeld der Verwaltung (auswahl.js) stellt Knopf und Liste neben das select; bei neuen Optionen baut es die Liste selbst neu
  globalThis.ceviAuswahl?.verbessere(select);
  huelle.querySelector(".aw-knopf")?.classList.add("auswahl-knopf");
  zeige();

  select.addEventListener("change", () => {
    if (select.value !== NEU) {
      aktuell = select.value;
      zeige();
      return;
    }
    // Neuer Ort: Das Formular öffnet über dieser Seite; ohne Speichern bleibt die alte Wahl
    select.value = aktuell;
    ortFormular({
      ctx,
      danach: (neu) => {
        alle = [...alle, neu];
        aktuell = neu.id;
        baueOptionen();
        zeige();
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
    });
  });

  const waehle = () => vorhanden(aktuell);
  return {
    wurzel: huelle,
    eingaben: [select, freitext.eingabe],
    werte: () => ({
      ortId: waehle()?.id ?? "",
      text: waehle()?.name ?? (aktuell === FREI ? freitext.eingabe.value : ""),
    }),
    anzeige: () => {
      const o = waehle();
      if (o) {
        return { name: o.name, zusatz: o.beschreibung, link: o.kartenLink };
      }
      return { name: aktuell === FREI ? freitext.eingabe.value.trim() : "" };
    },
  };
}

// ---------- Das Formular für einen Ort ----------

// ort: ein bestehender Ort (bearbeiten) oder nichts (neu). danach(ort) bekommt den Ort mit Kennung, wie ihn die Liste zeigt
export function ortFormular({ ctx, ort, danach }) {
  const neu = ort === undefined;
  const name = feld({
    label: "Name",
    wert: ort?.name ?? "",
    required: true,
    maxlength: MAX_NAME,
    hilfe:
      "So steht der Ort in der Auswahl und auf der Website, zum Beispiel «Pfadiheim».",
  });
  const beschreibung = feld({
    label: "Adresse oder Hinweis",
    wert: ort?.beschreibung ?? "",
    maxlength: MAX_BESCHREIBUNG,
    hilfe:
      "Steht auf der Website unter dem Namen. Nach der Suche steht hier die gewählte Adresse; du kannst sie ändern oder einen Hinweis ergänzen, zum Beispiel «Beim Hintereingang».",
  });
  // Der Standort in Textform ist die eine Quelle: Ein gewählter Vorschlag trägt «Breite, Länge» ein, ein Link oder eine Adresse steht von Hand darin. Gelesen und geprüft wird er immer vom Server (POST /orte/vorschau)
  const standort = feld({
    label: "Link von Google Maps, Adresse oder Koordinaten",
    wert: ort?.standort ?? "",
    maxlength: MAX_STANDORT,
    autocomplete: "off",
    spellcheck: false,
    hilfe:
      "Nur, wenn die Suche die Adresse nicht kennt: in Google Maps «Teilen», «Link kopieren» und hier einfügen. Die Website zeigt nur den Verweis «Auf Google Maps ansehen», keine Karte.",
  });
  const aktiv = ankreuzen({
    label: "In der Auswahl anzeigen",
    gewaehlt: ort?.aktiv ?? true,
    wert: "aktiv",
  });

  // Die Adresse, die in dieser Sitzung aus einem Vorschlag übernommen wurde; sie steht auch im Feld «Adresse oder Hinweis», solange dort niemand schreibt
  let gewaehlteAdresse = null;
  let eingesetzt = null;
  let letzter = { fehler: false };
  let zaehler = 0;
  let uhr = 0;
  const suche = adressSuche({
    label: "Adresse oder Ort suchen",
    hilfe:
      "Tippe Strasse, Hausnummer und Ort, zum Beispiel «Beispielweg 4 Beispielstadt». Wähle dann einen Vorschlag: So stimmt der Standort genau.",
    beiWahl: (v) => {
      gewaehlteAdresse = v.bezeichnung;
      standort.eingabe.value = `${v.breite}, ${v.laenge}`;
      const b = beschreibung.eingabe;
      if (b.value.trim() === "" || b.value === eingesetzt) {
        b.value = v.bezeichnung.slice(0, MAX_BESCHREIBUNG);
        eingesetzt = b.value;
      }
      clearTimeout(uhr);
      lese();
    },
  });

  // Was der Server aus dem Standort liest (ohne zu speichern): «bestätigt» oder «noch nicht bestätigt»
  const status = el("div", { class: "ort-status", role: "status" });
  const manuell = el("div", { class: "ort-manuell" });
  const manuellId = neueId("ort-manuell");
  manuell.id = manuellId;
  const manuellKnopf = knopf("Link oder Koordinaten von Hand eintragen", {
    klein: true,
    "aria-expanded": "false",
    "aria-controls": manuellId,
  });
  const oeffneManuell = (offen) => {
    manuell.hidden = !offen;
    manuellKnopf.hidden = offen;
    manuellKnopf.setAttribute("aria-expanded", String(offen));
  };
  manuellKnopf.addEventListener("click", () => {
    oeffneManuell(true);
    standort.eingabe.focus();
  });
  manuell.append(standort.wurzel);

  const sucheStarten = (r) =>
    suche.suche(
      (r?.standortArt === "adresse" ? r.standort : "") ||
        beschreibung.eingabe.value.trim() ||
        name.eingabe.value.trim(),
    );
  function zeigeStatus(r) {
    if (r.standortArt === null) {
      status.replaceChildren(
        el(
          "p",
          { class: "ort-status-text leise" },
          "Noch kein Standort. Suche oben eine Adresse. Ohne Standort steht auf der Website nur der Name.",
        ),
      );
      return;
    }
    if (r.standortArt === "koordinaten") {
      status.replaceChildren(
        el(
          "ul",
          { class: "chips" },
          chip(
            gewaehlteAdresse ? "Adresse bestätigt" : "Standort bestätigt",
            "ok",
          ),
        ),
        ...(gewaehlteAdresse
          ? [el("p", { class: "ort-status-adresse" }, gewaehlteAdresse)]
          : []),
        el("p", { class: "klein leise" }, `Koordinaten ${r.standort}`),
        ...[kartenVerweis(r.kartenLink)].filter(Boolean),
      );
      return;
    }
    // Adresse oder Kurzlink: lesbar, aber nicht von der Suche bestätigt
    status.replaceChildren(
      el(
        "ul",
        { class: "chips" },
        chip("Standort noch nicht bestätigt", "warn"),
      ),
      el(
        "p",
        { class: "ort-status-text" },
        r.standortArt === "adresse"
          ? `Gelesen als Adresse: ${r.standort}. `
          : "Gelesen als Kurzlink von Google Maps. ",
        "Mit der Suche stimmt der Standort genau.",
      ),
      el(
        "div",
        { class: "ort-status-aktionen" },
        knopf("Adresse suchen", {
          klein: true,
          symbol: "lupe",
          onclick: () => sucheStarten(r),
        }),
        kartenVerweis(r.kartenLink),
      ),
    );
  }
  async function lese() {
    const nr = ++zaehler;
    const wert = standort.eingabe.value;
    try {
      const r = await anfrage("POST", `${API}/vorschau`, { standort: wert });
      if (nr !== zaehler) return;
      letzter = { fehler: false, link: r.kartenLink };
      standort.eingabe.removeAttribute("aria-invalid");
      zeigeStatus(r);
    } catch (f) {
      if (nr !== zaehler) return;
      const ungueltig = f.status === 400;
      letzter = { fehler: ungueltig };
      // Ein abgelehnter Standort steht von Hand im Feld: Das Feld öffnet sich, die Meldung steht daneben
      if (ungueltig) oeffneManuell(true);
      status.replaceChildren(
        el(
          "p",
          { class: ungueltig ? "feld-fehler" : "hilfe" },
          ungueltig && f.code === "ORT_STANDORT_UNGUELTIG"
            ? f.meldung
            : "Der Standort konnte nicht geprüft werden. Speichern prüft ihn noch einmal.",
        ),
      );
      standort.eingabe.setAttribute("aria-invalid", String(ungueltig));
    }
    zeigeVorschau();
  }
  standort.eingabe.addEventListener("input", () => {
    // Von Hand geändert: Die gewählte Adresse gilt nicht mehr
    gewaehlteAdresse = null;
    clearTimeout(uhr);
    uhr = setTimeout(lese, 450);
  });
  standort.eingabe.addEventListener("change", () => {
    clearTimeout(uhr);
    lese();
  });

  const vorschau = el("dl", { class: "ws-stufenvorschau" });
  function zeigeVorschau() {
    const n = name.eingabe.value.trim();
    const b = beschreibung.eingabe.value.trim();
    const verweis = letzter.fehler ? null : kartenVerweis(letzter.link);
    vorschau.replaceChildren(
      el(
        "div",
        { class: "ws-stufenvorschau-zeile" },
        el("dt", {}, "Treffpunkt"),
        n
          ? el(
              "dd",
              {},
              n,
              b && el("span", { class: "ort-vorschau-zusatz" }, b),
              verweis && el("span", { class: "ort-vorschau-zusatz" }, verweis),
            )
          : el("dd", { class: "leise" }, "noch leer"),
      ),
    );
  }
  for (const f of [name, beschreibung]) {
    f.eingabe.addEventListener("input", zeigeVorschau);
  }
  if (!neu) {
    letzter = { fehler: false, link: ort.kartenLink };
    zeigeStatus(ort);
    // Wer einen Link oder eine Adresse hinterlegt hat, sieht das Feld dazu gleich
    oeffneManuell(ort.standortArt === "adresse" || ort.standortArt === "link");
  } else {
    zeigeStatus({ standortArt: null });
    oeffneManuell(false);
  }
  zeigeVorschau();

  dialogFormular({
    titel: neu ? "Neuer Ort" : "Ort bearbeiten",
    beschreibung:
      "Orte gelten für die ganze Abteilung. Ändern wirkt sofort auf allen Stufenseiten, auf denen der Ort steht.",
    felder: [
      formularRaster({
        felder: [
          name.wurzel,
          suche.wurzel,
          status,
          beschreibung.wurzel,
          manuellKnopf,
          manuell,
          aktiv.wurzel,
        ],
        seiteTitel: "So steht es auf der Stufenseite",
        seite: vorschau,
      }),
    ],
    ok: "Speichern",
    senden: async () => {
      const felder = {
        name: name.eingabe.value,
        beschreibung: beschreibung.eingabe.value,
        standort: standort.eingabe.value,
        aktiv: aktiv.eingabe.checked,
      };
      if (neu) {
        const { id } = await anfrage("POST", API, felder);
        return { id };
      }
      await anfrage("PATCH", `${API}/${ort.id}`, felder);
      return { id: ort.id };
    },
    // Ein Standort, den der Server abgelehnt hat, geht nicht weiter: Meldung steht schon beim Feld
    pruefe: () => {
      clearTimeout(uhr);
      if (!letzter.fehler) return false;
      standort.eingabe.focus();
      return true;
    },
    fehlertext: (f) =>
      f.code === "ORT_NAME_VERGEBEN"
        ? "Einen Ort mit diesem Namen gibt es schon."
        : f.code === "ORT_ZU_VIELE"
          ? "Es gibt schon die höchste Zahl an Orten. Lösche zuerst einen."
          : f.code === "ORT_STANDORT_UNGUELTIG"
            ? f.meldung
            : "Das Speichern hat nicht geklappt. Prüfe die Angaben und versuche es nochmals.",
    danach: async ({ id }) => {
      // Die Liste neu holen: Reihenfolge, Verwendung und Link zur Karte kommen vom Server
      const orte = await ladeOrte();
      const neuer = orte?.find((o) => o.id === id);
      ctx.melde(neu ? "Der Ort ist angelegt." : "Der Ort ist gespeichert.");
      if (neuer) danach?.(neuer);
    },
  });
}

// ---------- Die Seite «Orte» ----------

export function zeigeOrte(bereich, ctx) {
  ctx.lade(
    async () => {
      const orte = await ladeOrte();
      return { orte };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

function zeichne(bereich, ctx, { orte }, neu) {
  bereich.append(reiter("orte"));
  if (orte === null) {
    bereich.append(
      zustandsKarte({
        titel: "Für dich sind hier keine Orte frei.",
        text: "Die Orte pflegt, wer die Angaben einer Stufe pflegen darf. Wende dich an die Abteilungsleitung.",
      }).wurzel,
    );
    return;
  }
  ctx.kopfAktion(
    knopf("Neuer Ort", {
      art: "haupt",
      symbol: "plus",
      onclick: () => ortFormular({ ctx, danach: neu }),
    }),
  );
  bereich.append(
    el(
      "p",
      { class: "hilfe ws-stufenfakten-einleitung" },
      "Orte, die oft vorkommen, legst du hier einmal an, zum Beispiel das Pfadiheim oder den Bahnhof. In den Angaben je Stufe wählst du sie dann aus. Die Adresse suchst du beim Anlegen mit einer Teiladresse und wählst einen Vorschlag: So stimmt der Standort. Auf der Stufenseite steht dann der Verweis «Auf Google Maps ansehen». Das ist nur ein Link: Die Website lädt nichts von Google, bevor jemand ihn anklickt.",
    ),
  );
  if (orte.length === 0) {
    bereich.append(
      zustandsKarte(
        {
          titel: "Noch keine Orte.",
          text: "Lege mit «Neuer Ort» den ersten an. Du kannst ihn danach in jeder Stufe wählen.",
        },
        [
          knopf("Neuer Ort", {
            art: "haupt",
            symbol: "plus",
            onclick: () => ortFormular({ ctx, danach: neu }),
          }),
        ],
      ).wurzel,
    );
    return;
  }
  const liste = sortierListe({
    beschriftung: "Orte der Abteilung",
    eintraege: orte.map((o) => ({
      id: o.id,
      text: o.name,
      inhalt: zeile(o, ctx, neu),
    })),
    aktionstext: "Reihenfolge der Orte geändert",
    mitRueckgaengig: ctx.mitRueckgaengig,
    beiNeu: (ids) => anfrage("PUT", `${API}/reihenfolge`, { ids }),
  });
  bereich.append(
    liste.wurzel,
    el(
      "p",
      { class: "klein leise" },
      "Ordne die Orte per Ziehen oder mit den Pfeilen. In der Auswahl stehen die zuletzt gewählten zuerst, danach die Orte in dieser Reihenfolge.",
    ),
  );
}

function zeile(o, ctx, neu) {
  const verwendung =
    o.verwendet === 0
      ? "Wird zurzeit nirgends gebraucht."
      : `Gebraucht bei ${o.verwendet} ${o.verwendet === 1 ? "Samstag" : "Samstagen"}: ${o.verwendung
          .map((v) => `${v.stufe}, ${kurzDatum(v.tag)}`)
          .join(
            "; ",
          )}${o.verwendet > o.verwendung.length ? " und weitere" : ""}.`.replace(
          /[.]+$/,
          ".",
        );
  const loeschen = knopf("Löschen", {
    klein: true,
    art: "gefahr",
    kontext: o.name,
  });
  const frage = o.verwendet > 0 ? "Trotzdem löschen?" : undefined;
  const ausfuehren = (ereignis) =>
    ctx.mitRueckgaengig({
      text: `Ort «${o.name}» gelöscht. In den Angaben bleibt der Name stehen, nur der Verweis zur Karte entfällt`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () => anfrage("DELETE", `${API}/${o.id}`),
      fehlertext,
      danach: neu,
    });
  if (frage) {
    // Wird der Ort noch gebraucht, fragt der Knopf zuerst (zweiter Klick löscht); sonst geht das Löschen gleich mit «Rückgängig»
    const stufen = zweiStufig(loeschen, { frage });
    loeschen.addEventListener("click", (e) =>
      stufen.verlange(frage, () => ausfuehren(e)),
    );
  } else {
    loeschen.addEventListener("click", ausfuehren);
  }
  return el(
    "div",
    { class: "ort-zeile" },
    el(
      "div",
      { class: "ort-info" },
      el("strong", { class: "ort-name" }, o.name),
      o.beschreibung && el("span", { class: "leise" }, o.beschreibung),
      el("span", { class: "klein leise" }, verwendung),
    ),
    el(
      "div",
      { class: "ort-standort" },
      el(
        "ul",
        { class: "chips" },
        o.standortArt === null
          ? chip("Ohne Standort", undefined, false)
          : o.standortArt === "koordinaten"
            ? chip("Standort bestätigt", "ok")
            : chip("Standort nicht bestätigt", "warn"),
        !o.aktiv && chip("Ausgeblendet", "warn"),
      ),
    ),
    el(
      "div",
      { class: "aktionen" },
      kartenVerweis(o.kartenLink),
      knopf("Bearbeiten", {
        klein: true,
        kontext: o.name,
        onclick: () => ortFormular({ ctx, ort: o, danach: neu }),
      }),
      loeschen,
    ),
  );
}
