import { anfrage, fehlertext } from "./api.js";
import { bildMitLader } from "./bildwahl.js";
import {
  STANDARD_LOGO,
  ankreuzen,
  dialogFormular,
  el,
  feld,
  knopf,
} from "./dom.js";
import { feldFehler } from "./liste-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { dateiFeld } from "./personen-wahl.js";
import { mitgliedKopf } from "./mitglieder.js";
import { sortierListe } from "./sortieren.js";
import { zuschneiden } from "./zuschneiden.js";

const LOGO_MAX_BYTES = 5 * 1024 * 1024;

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      const [stufen, kinder, personen] = await Promise.all([
        anfrage("GET", "/api/v1/stufen"),
        // Die Anzahl und die SL sind Beiwerk: ohne sie bleibt die Liste benutzbar
        anfrage("GET", "/api/v1/admin/kinder").catch(() => null),
        anfrage("GET", "/api/v1/admin/personen").catch(() => null),
      ]);
      return {
        stufen: stufen.stufen,
        kinder: kinder?.kinder ?? null,
        personen: personen?.personen ?? null,
        titelbilder: await ladeTitelbilder(stufen.stufen),
      };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

// Das Bild einer Stufe ist das erste Bild ihrer Seite auf der Website (ihr Titelbild). Die Seitenliste ist ein Abruf, dazu je Stufe mit Seite der Entwurf; fehlt das Recht oder die Seite, bleibt es beim Buchstaben. Nur das Lesen, nichts wird gespeichert.
// Liefert Map: Stufe-ID -> Adresse des Bildes
export async function ladeTitelbilder(stufen) {
  const bilder = new Map();
  try {
    const { seiten } = await anfrage("GET", "/api/v1/redaktion/seiten");
    await Promise.all(
      stufen.map(async (s) => {
        const seite = seiten.find((x) => x.tagId === s.id);
        if (!seite) return;
        const { dokument } = await anfrage(
          "GET",
          `/api/v1/redaktion/seiten/${seite.id}/entwurf`,
        );
        const id = titelbildId(dokument);
        if (id) bilder.set(s.id, `/api/v1/medien/${id}`);
      }),
    );
  } catch {
    // Beiwerk: ohne Recht oder bei einem Fehler stehen die Buchstaben
  }
  return bilder;
}

// Der erste Bildbaustein eines Dokuments: seine Medien-ID oder null (reine Funktion)
export function titelbildId(dokument) {
  const baustein = dokument?.bausteine?.find((b) => b.typ === "bild");
  return typeof baustein?.daten?.mediumId === "string"
    ? baustein.daten.mediumId
    : null;
}

function felder(stufe) {
  return {
    name: feld({
      label: "Name",
      wert: stufe?.name ?? "",
      maxlength: 100,
      required: true,
    }),
    logo: dateiFeld({
      label: "Logo (optional)",
      hilfe:
        "JPEG, PNG oder WebP, höchstens 5 MB. Ohne eigenes Logo gilt das Cevi-Logo.",
      accept: "image/jpeg,image/png,image/webp",
    }),
    // Nur bei einer Stufe mit Logo
    entfernen: stufe?.logoUrl
      ? ankreuzen({ label: "Eigenes Logo entfernen", wert: "entfernen" })
      : null,
  };
}

function lesen(f) {
  return { name: f.name.eingabe.value.trim() };
}

// Logo mit Vorschau daneben (Muster «edit-profile-form»): Die Vorschau zeigt die gewählte Datei, bevor sie gespeichert ist. Als data:-Adresse gelesen, denn die Seite lädt Bilder nur von sich selbst und aus data:
// Vor dem Speichern lässt sich das Logo zuschneiden (#633). Der Zuschnitt ist freiwillig: «Original verwenden» lässt es unberührt; Durchsichtiges bleibt bei PNG erhalten.
function logoZeile(f, stufe) {
  const vorschau = el("img", {
    class: "stufe-vorschau",
    src: stufe?.logoUrl ?? STANDARD_LOGO,
    alt: "",
  });
  const zeigeVorschau = () => {
    const datei = f.logo.eingabe.files[0];
    if (!datei || datei.size > LOGO_MAX_BYTES) return;
    const leser = new window.FileReader();
    leser.addEventListener("load", () => {
      vorschau.src = leser.result;
    });
    leser.readAsDataURL(datei);
  };
  let eigeneAenderung = false;
  const setzeDatei = (datei) => {
    eigeneAenderung = true;
    if (datei) {
      const liste = new window.DataTransfer();
      liste.items.add(datei);
      f.logo.eingabe.files = liste.files;
    } else {
      f.logo.eingabe.value = "";
    }
    f.logo.eingabe.dispatchEvent(new window.Event("change", { bubbles: true }));
    eigeneAenderung = false;
  };
  f.logo.eingabe.addEventListener("change", async () => {
    if (eigeneAenderung) return zeigeVorschau();
    const datei = f.logo.eingabe.files[0];
    if (!datei || datei.size > LOGO_MAX_BYTES) return;
    try {
      const ergebnis = await zuschneiden({
        datei,
        titel: "Logo zuschneiden",
        beschreibung:
          "Der Zuschnitt ist freiwillig. Mit «Original verwenden» bleibt das Logo, wie es ist.",
        verhaeltnisse: [
          { text: "Frei", wert: null },
          { text: "1:1", wert: 1 },
          { text: "4:3", wert: 4 / 3 },
        ],
        maxSeite: 1024,
        maxBytes: LOGO_MAX_BYTES,
        ok: "Zuschneiden und übernehmen",
      });
      // Abbrechen: keine Datei gewählt, das bisherige Logo bleibt
      if (!ergebnis) setzeDatei(null);
      else if (ergebnis.zugeschnitten) setzeDatei(ergebnis.datei);
      else zeigeVorschau();
    } catch (fehler) {
      setzeDatei(null);
      feldFehler(f.logo, fehler.message);
    }
  });
  return el(
    "div",
    { class: "stufe-logozeile" },
    vorschau,
    el(
      "div",
      { class: "stufe-logofelder" },
      f.logo.wurzel,
      f.entfernen?.wurzel,
    ),
  );
}

function dialog({ stufe, ctx, neu }) {
  const f = felder(stufe);
  dialogFormular({
    titel: stufe ? "Stufe bearbeiten" : "Stufe anlegen",
    beschreibung: stufe?.name,
    felder: [f.name.wurzel, logoZeile(f, stufe)],
    ok: stufe ? "Speichern" : "Anlegen",
    senden: async () => {
      const body = lesen(f);
      const datei = f.logo.eingabe.files[0];
      if (datei && datei.size > LOGO_MAX_BYTES) {
        throw Object.assign(new Error("400"), {
          status: 400,
          code: "LOGO_GROSS",
        });
      }
      const ergebnis = stufe
        ? await anfrage("PATCH", `/api/v1/admin/stufen/${stufe.id}`, body)
        : await anfrage("POST", "/api/v1/admin/stufen", body);
      const id = stufe?.id ?? ergebnis.id;
      const logoPfad = `/api/v1/admin/stufen/${id}/logo`;
      if (datei) await anfrage("PUT", logoPfad, datei);
      else if (f.entfernen?.eingabe.checked) await anfrage("DELETE", logoPfad);
      return ergebnis;
    },
    fehlertext: (fehler) =>
      fehler.code === "LOGO_GROSS"
        ? "Das Logo ist grösser als 5 MB."
        : fehlertext(fehler),
    danach: () => {
      neu();
      ctx.melde(stufe ? "Gespeichert." : "Stufe ist angelegt.");
    },
  });
}

// Mit «Rückgängig» (#578): Die Karte verschwindet sofort, gelöscht wird nach der Frist. Es geht nur, solange der Stufe keine Kinder oder Leitenden zugewiesen sind
function loeschen(stufe, ctx, neu, ereignis) {
  ctx.mitRueckgaengig({
    text: `Stufe «${stufe.name}» gelöscht, mit Gruppenchat und allen Nachrichten`,
    ansicht: ansichtVonKnopf(ereignis),
    ausfuehren: () => anfrage("DELETE", `/api/v1/admin/stufen/${stufe.id}`),
    fehlertext,
    danach: neu,
  });
}

// Die aktiven SL der Stufe, wie die Kontakte sie ordnen: Priorität (ohne zuletzt), dann Name; die Personenliste kommt nach Name
function stufenleitung(personen, stufe) {
  const rolle = (p) =>
    p.rollen.find((r) => r.stufeId === stufe.id && r.typ === "stufenleitung");
  return (personen ?? [])
    .filter((p) => !p.deaktiviert && rolle(p))
    .sort(
      (a, b) =>
        (rolle(a).prioritaet ?? Infinity) - (rolle(b).prioritaet ?? Infinity) ||
        0,
    );
}

// Bild oder Initialen, Name und Cevi-Name wie in der Mitglieder-Darstellung (mitglieder.js)
const personKopf = (p) =>
  mitgliedKopf({ name: p.name, ceviName: p.ceviName, bildUrl: p.bildUrl });

// Die Stufenleitung steht als Sortierliste in der Karte: Ziehen am Griff, Tastatur und Knöpfe Nach oben und Nach unten, danach «Rückgängig» im Toast. Die Anfrage geht erst nach der Frist; die erste Person ist der Hauptkontakt in den Kontakten der App.
function leitungsListe(stufe, sl, ctx) {
  return sortierListe({
    beschriftung: `Stufenleitung von ${stufe.name}`,
    eintraege: sl.map((p) => ({
      id: p.id,
      text: p.name,
      inhalt: personKopf(p),
    })),
    aktionstext: `Reihenfolge der Stufenleitung von ${stufe.name} geändert`,
    mitRueckgaengig: ctx.mitRueckgaengig,
    beiNeu: (ids) =>
      anfrage("PUT", `/api/v1/admin/stufen/${stufe.id}/stufenleitung`, {
        ids,
      }),
  });
}

// Ohne eigenes Logo gilt das Cevi-Logo, wie in den Auswahllisten (#845; vorher der Anfangsbuchstabe)
function kennzeichen(stufe) {
  return el("img", {
    class: "st-logo",
    src: stufe.logoUrl ?? STANDARD_LOGO,
    alt: "",
  });
}

function karte(stufe, anzahl, sl, ctx, neu, titelbild) {
  const leitung =
    sl.length === 0
      ? el("p", { class: "leise" }, "Noch niemand eingetragen.")
      : sl.length === 1
        ? personKopf(sl[0])
        : [
            leitungsListe(stufe, sl, ctx).wurzel,
            el(
              "p",
              { class: "klein leise" },
              "Die erste Person ist der Hauptkontakt. Ordne sie per Ziehen oder mit den Pfeilen.",
            ),
          ];
  return el(
    "li",
    { class: "karte stufe-karte" },
    // Das hinterlegte Bild der Stufe (Titelbild ihrer Seite), mit ruhigem Platzhalter bis es da ist
    titelbild &&
      bildMitLader(
        el("img", {
          src: titelbild,
          alt: "",
          loading: "lazy",
          decoding: "async",
        }),
        "st-foto",
      ),
    el(
      "div",
      { class: "st-kopf" },
      kennzeichen(stufe),
      el(
        "div",
        { class: "st-text" },
        el("h2", { class: "name" }, stufe.name),
        anzahl !== null &&
          el(
            "p",
            { class: "leise" },
            anzahl === 1 ? "1 Kind" : `${anzahl} Kinder`,
          ),
      ),
    ),
    el("div", { class: "st-leitung" }, el("h3", {}, "Stufenleitung"), leitung),
    el(
      "div",
      { class: "st-aktionen" },
      knopf("Bearbeiten", {
        klein: true,
        symbol: "bearbeiten",
        kontext: stufe.name,
        onclick: () => dialog({ stufe, ctx, neu }),
      }),
      knopf("Löschen", {
        klein: true,
        art: "still",
        symbol: "papierkorb",
        kontext: stufe.name,
        onclick: (e) => loeschen(stufe, ctx, neu, e),
      }),
    ),
  );
}

function zeichne(bereich, ctx, { stufen, kinder, personen, titelbilder }, neu) {
  ctx.kopfAktion(
    knopf("Stufe anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: () => dialog({ ctx, neu }),
    }),
  );
  const anzahl = (stufe) =>
    kinder ? kinder.filter((k) => k.stufeId === stufe.id).length : null;
  if (stufen.length === 0) {
    bereich.append(el("p", { class: "leer" }, "Es gibt noch keine Stufen."));
    return;
  }
  bereich.append(
    el(
      "p",
      { class: "meta klein", role: "status" },
      stufen.length === 1 ? "1 Stufe" : `${stufen.length} Stufen`,
    ),
    el(
      "ul",
      { class: "st-liste", "aria-label": "Stufen" },
      stufen.map((stufe) =>
        karte(
          stufe,
          anzahl(stufe),
          stufenleitung(personen, stufe),
          ctx,
          neu,
          titelbilder.get(stufe.id),
        ),
      ),
    ),
  );
}
