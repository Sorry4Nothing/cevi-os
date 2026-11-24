import { anfrage } from "./api.js";
import {
  ankreuzen,
  auswahl,
  avatar,
  el,
  icon,
  knopf,
  menue,
  neueId,
} from "./dom.js";
import { fehlertext } from "./api.js";
import { zweiStufig } from "./rueckgaengig.js";
import { ersetzeMitBewegung } from "./lager-anim.js";
import { leerKarte } from "./zustaende.js";
import { istKonflikt, konfliktZeilen } from "./lager-menschen-logik.js";
import { ziehGriff } from "./lager-ziehen.js";

// Gemeinsames der Lager-Module «Menschen und Einteilung» (#675): Kontext mit Rechten, Meldungen, Konflikt, Personenzeile mit Griff, Auswahlleiste. Die Module liegen als lager-m-<name>.js und werden vom Rahmen mit zeige(bereich, ctx, lagerId, lager) gerufen. Klassen mit dem Vorsatz «mn-».

// Alle Routen dieser Module liegen unter /api/v1/lager/<id>; der Server prüft jedes Recht noch einmal
export const LB = (lagerId) => `/api/v1/lager/${lagerId}`;

// Rechte der eigenen Rolle im Lager. Der Rahmen reicht das Lager mit seinen Rechten weiter; fehlen sie (direkter Aufruf), fragt dieses Modul selbst.
export async function ladeKontext(lagerId, lager) {
  const l =
    lager && Array.isArray(lager.rechte)
      ? lager
      : await anfrage("GET", LB(lagerId));
  const rechte = new Set(l.rechte ?? []);
  const zu =
    l.schreibgeschuetzt ?? ["abgeschlossen", "archiviert"].includes(l.status);
  return {
    lagerId,
    lager: l,
    rechte,
    zu,
    // Lesen: das Recht genügt
    darf: (r) => rechte.has(r),
    // Schreiben: Recht und offenes Lager; im geschlossenen Lager bleibt alles schreibgeschützt
    kann: (r) => rechte.has(r) && !zu,
  };
}

const TEXTE = {
  VERSION_KONFLIKT:
    "Jemand hat diesen Eintrag inzwischen geändert. Entscheide unten, was gelten soll.",
  LAGER_GESCHLOSSEN:
    "Das Lager ist schreibgeschützt. Öffne es wieder, wenn du etwas ändern willst.",
  ZU_VIELE_ZEILEN:
    "Ein Import nimmt höchstens 500 Zeilen. Teile die Liste auf.",
  ANFRAGE_NOETIG:
    "Mindestens ein Feld ist schon eingetragen oder die Frist ist abgelaufen. Stelle eine Anfrage an die Lagerleitung.",
};
// Die Meldung für einen Fehler der Lager-Routen. Die Texte der Routen sind Deutsch und für Menschen geschrieben, sie gelten bei 400, 403 und 409 vor dem allgemeinen Text.
export function meldung(f) {
  if (f?.code && TEXTE[f.code]) return TEXTE[f.code];
  if (f?.code && f.meldung && [400, 403, 409].includes(f.status))
    return f.meldung;
  return fehlertext(f);
}

// Kopf jedes Moduls: der Titel steht im Rahmen; das geschlossene Lager meldet der Rahmen schon, ohne Rahmen (direkter Aufruf) tut es das Modul
export function kopfeMitHinweis(bereich, ctx, k, titel) {
  ctx.titel(titel);
  if (k.zu && !ctx.imRahmen)
    bereich.append(
      el(
        "div",
        { class: "hinweis hinweis--info", role: "status" },
        el("span", {}, TEXTE.LAGER_GESCHLOSSEN),
      ),
    );
}

// Die Hauptaktion im Kopf; ohne Knoten (false) bleibt der Kopf leer
export const kopfAktion = (ctx, knoten) =>
  ctx.kopfAktion(...[knoten].filter(Boolean));

// Ersetzt die Kinder und lässt false und undefined weg (replaceChildren schriebe sie als Text)
export const fuelle = (ziel, ...kinder) => ersetzeMitBewegung(ziel, ...kinder);

// Kein Leserecht: erklären, wer es vergeben kann
export function keinLeserecht(bereich, was) {
  bereich.append(
    leerKarte(
      `Für ${was} fehlt dir das Leserecht in diesem Lager. Die Lagerleitung kann es dir geben.`,
    ),
  );
}

// Alle Seiten einer Liste mit Cursor holen; feld ist der Name der Liste in der Antwort
export async function ladeAlle(pfad, feld, { limit = 200, cursor } = {}) {
  const alle = [];
  let nach = null;
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (nach) q.set("nach", nach);
    const a = await anfrage(
      "GET",
      `${pfad}${pfad.includes("?") ? "&" : "?"}${q}`,
    );
    alle.push(...(cursor ? cursor(a) : a[feld]));
    nach = a.naechster ?? null;
    if (!nach) break;
  }
  return alle;
}

// --- Versionskonflikt -------------------------------------------------------------

// Zeigt den Konflikt in einer Seite im Fluss (dialogFormular): Was du ändern wolltest und was jetzt gilt, nebeneinander, mit zwei Wegen. Nichts wird still überschrieben.
// felder: [[schluessel, label, format?]]; meine: Werte, die du senden wolltest; beiMeine(version): sendet nochmals mit der Version des Servers; beiServer(): übernimmt den Stand des Servers (Seite schliessen, neu laden)
export function zeigeKonflikt(
  seite,
  fehler,
  { felder, meine, beiMeine, beiServer },
) {
  seite.querySelector(".mn-konflikt")?.remove();
  const zeilen = konfliktZeilen(fehler.daten, felder, meine);
  const ort = seite.querySelector(".dialog-knoepfe");
  const meineKnopf = knopf("Meine Änderung übernehmen", {
    art: "blau",
    onclick: async () => {
      meineKnopf.disabled = serverKnopf.disabled = true;
      meineKnopf.setAttribute("aria-busy", "true");
      try {
        await beiMeine(fehler.daten.aktuell.version);
      } catch (f) {
        meineKnopf.disabled = serverKnopf.disabled = false;
        meineKnopf.removeAttribute("aria-busy");
        if (istKonflikt(f))
          zeigeKonflikt(seite, f, { felder, meine, beiMeine, beiServer });
        else {
          const hinweis = seite.querySelector(".hinweis--fehler");
          hinweis.textContent = meldung(f);
          hinweis.hidden = false;
        }
      }
    },
  });
  const serverKnopf = knopf("Stand des Servers übernehmen", {
    onclick: beiServer,
  });
  const id = neueId("konflikt");
  const block = el(
    "section",
    { class: "mn-konflikt", "aria-labelledby": id },
    el("h3", { id }, "Jemand war schneller"),
    el(
      "table",
      { class: "mn-konflikt-tabelle" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "Feld"),
          el("th", { scope: "col" }, "Deine Änderung"),
          el("th", { scope: "col" }, "Stand des Servers"),
        ),
      ),
      el(
        "tbody",
        {},
        zeilen.map((z) =>
          el(
            "tr",
            {},
            el("th", { scope: "row" }, z.label),
            el("td", {}, z.dein),
            el("td", {}, z.server),
          ),
        ),
      ),
    ),
    el("div", { class: "mn-konflikt-knoepfe" }, meineKnopf, serverKnopf),
  );
  ort.before(block);
  block.scrollIntoView?.({ block: "nearest" });
  meineKnopf.focus();
}

// Senden für ein Formular im Fluss: bei einem Konflikt erscheint die Konfliktansicht, sonst steigt der Fehler wie gewohnt auf
// sende(version?): schickt die Änderung (mit der Version des Servers, falls gegeben); getSeite(): die Seite des Formulars
export function sendeMitKonflikt({
  getSeite,
  sende,
  felder,
  meine,
  beiServer,
}) {
  const beiMeine = async (version) => {
    await sende(version);
    getSeite().close();
  };
  return async () => {
    try {
      return await sende();
    } catch (f) {
      if (istKonflikt(f)) {
        zeigeKonflikt(getSeite(), f, {
          felder,
          meine: meine(),
          beiMeine,
          beiServer: () => {
            getSeite().close();
            beiServer();
          },
        });
      }
      throw f;
    }
  };
}

// Konflikt ausserhalb eines Formulars (Haken, Zuteilung): kurze Meldung mit dem Weg «Aktualisieren»
export function meldeKonflikt(ctx, neu, text) {
  ctx.melde(text ?? meldung({ code: "VERSION_KONFLIKT" }), "warn", {
    text: "Aktualisieren",
    onclick: neu,
  });
}

// --- Personenzeile mit Griff, Auswahl und Menü ------------------------------------

// Auswahl über mehrere Listen: Schlüssel -> Person; meldet Änderungen
export function erstelleAuswahl(beiAenderung = () => {}) {
  const gewaehlt = new Map();
  return {
    gewaehlt,
    hat: (k) => gewaehlt.has(k),
    umschalten(p, an) {
      if (an) gewaehlt.set(p.schluessel, p);
      else gewaehlt.delete(p.schluessel);
      beiAenderung();
    },
    leeren() {
      gewaehlt.clear();
      beiAenderung();
    },
    liste: () => [...gewaehlt.values()],
    // Nur, was noch in den Daten vorkommt (nach dem Neuladen)
    bereinige(vorhanden) {
      for (const k of [...gewaehlt.keys()])
        if (!vorhanden.has(k)) gewaehlt.delete(k);
      beiAenderung();
    },
  };
}

// Eine Person in einer Liste. person: { typ, id, schluessel, name, neben?, bildUrl? } (bildUrl nur bei Konten mit Bild; Teilnehmende und Personen ohne Bild zeigen die Initialen)
// optionen: auswahl (erstelleAuswahl), ziehen (true, wenn der Griff erscheint), eintraege: Einträge des Menüs «Verschieben» ([{ text, onclick, gefaehrlich }]), badge: Knoten
export function personZeile(
  person,
  { auswahl: wahl, ziehen = true, eintraege = [], badge, vorn } = {},
) {
  const li = el("li", {
    class: "mn-person",
    "data-schluessel": person.schluessel,
  });
  let kasten = null;
  if (wahl) {
    kasten = ankreuzen({
      label: `${person.name} auswählen`,
      gewaehlt: wahl.hat(person.schluessel),
    });
    kasten.wurzel.classList.add("mn-wahl");
    kasten.wurzel.querySelector("label").classList.add("nur-leser");
    kasten.eingabe.addEventListener("change", () =>
      wahl.umschalten(person, kasten.eingabe.checked),
    );
  }
  const griff =
    ziehen &&
    ziehGriff({
      name: person.name,
      // Gehört die Zeile zur Auswahl, wandert die ganze Auswahl mit
      nutzlast: () =>
        wahl && wahl.hat(person.schluessel) && wahl.liste().length > 1
          ? wahl.liste()
          : [person],
      text: (last) =>
        last.length > 1 ? `${last.length} Personen` : last[0].name,
    });
  li.append(
    ...[
      kasten?.wurzel,
      griff,
      vorn,
      avatar(person.name, { hell: true, bildUrl: person.bildUrl }),
      el(
        "div",
        { class: "mn-person-text" },
        el("span", { class: "name" }, person.name),
        person.neben && el("span", { class: "klein leise" }, person.neben),
      ),
      badge,
      eintraege.length > 0 ? menue(person.name, eintraege) : false,
    ].filter(Boolean),
  );
  return li;
}

// Leiste unten, solange etwas ausgewählt ist: Anzahl, Ziel wählen, ausführen, Auswahl aufheben
// ziele(): [[wert, text]]; beiAusfuehren(wert, personen); text: Beschriftung des Knopfs
export function auswahlLeiste({
  auswahl: wahl,
  ziele,
  text = "Verschieben",
  beiAusfuehren,
  zusatz,
}) {
  const zaehler = el("p", { class: "mn-leiste-zahl", role: "status" });
  const wurzel = el("div", {
    class: "mn-leiste",
    role: "region",
    "aria-label": "Auswahl",
  });
  let feld = null;
  const baue = () => {
    const z = ziele();
    wurzel.replaceChildren(
      zaehler,
      ...(z.length > 0
        ? [
            (feld = auswahl({
              label: "Ziel",
              optionen: z,
              wert: z[0][0],
            })).wurzel,
            knopf(text, {
              art: "haupt",
              onclick: async (e) => {
                const personen = wahl.liste();
                e.currentTarget.disabled = true;
                try {
                  await beiAusfuehren(feld.eingabe.value, personen);
                } finally {
                  e.currentTarget.disabled = false;
                }
              },
            }),
          ]
        : []),
      ...(zusatz ?? []),
      knopf("Auswahl aufheben", { onclick: () => wahl.leeren() }),
    );
    feld?.wurzel.querySelector("label")?.classList.add("nur-leser");
  };
  return {
    wurzel,
    // Nach jeder Änderung der Auswahl oder der Ziele
    aktualisiere() {
      const n = wahl.liste().length;
      wurzel.hidden = n === 0;
      if (n === 0) return;
      const vorher = feld?.eingabe.value;
      baue();
      if (
        vorher &&
        feld &&
        [...feld.eingabe.options].some((o) => o.value === vorher)
      )
        feld.eingabe.value = vorher;
      zaehler.textContent = n === 1 ? "1 ausgewählt" : `${n} ausgewählt`;
    },
  };
}

// «Alle aufheben» für eine Seite mit zweistufigem Knopf (Rückfrage am Ort, kein Popup)
export const zweistufigerKnopf = (text, frage, ausfuehren, optionen = {}) => {
  const k = knopf(text, optionen);
  zweiStufig(k, { frage, ausfuehren });
  return k;
};

// Kopfzeile einer Fläche: Titel und rechts Aktionen
export function flaechenKopf(titel, ...aktionen) {
  return el(
    "div",
    { class: "mn-flaechenkopf" },
    el("h2", {}, titel),
    el("div", { class: "mn-aktionen" }, aktionen),
  );
}

// Ein Chip mit Symbol; Zustand nie nur über Farbe
export function zustandsChip(text, art, symbol) {
  return el(
    "span",
    { class: art ? `chip chip--${art}` : "chip" },
    symbol && icon(symbol),
    text,
  );
}
