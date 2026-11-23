import { anfrage } from "./api.js";
import { el, feld, knopf } from "./dom.js";
import { knopfMit, meldung } from "./lager-gemeinsam.js";
import { istGeschlossen, istVersionKonflikt } from "./lager-konflikt.js";

// Gemeinsames der Module «Material und Infos» im Lager-Arbeitsbereich (#674): Adressen der Lager-Routen, Rechte, Version-Konflikt, Personenliste. Klassen mit dem Vorsatz «lm-» (lager-material.css).

// Die Lager-Routen der App-Schnittstelle (die Verwaltung nutzt dieselben wie die Apps; der Server prüft jedes Recht)
export const lagerPfad = (lagerId, rest = "") =>
  `/api/v1/lager/${lagerId}${rest}`;

export const kannLesen = (lager, recht) =>
  Array.isArray(lager?.rechte) && lager.rechte.includes(recht);
// Schreiben braucht das Recht und ein offenes Lager (abgeschlossen oder archiviert ist schreibgeschützt)
export const kannSchreiben = (lager, recht) =>
  kannLesen(lager, recht) && !lager?.schreibgeschuetzt;

// 409 VERSION_KONFLIKT: Jemand hat die Zeile inzwischen geändert. Der Body nennt den Stand des Servers («aktuell») und die Felder, die abweichen.
// Die Erkennung der Konflikte ist die gemeinsame aus lager-konflikt.js (#672)
export const istKonflikt = istVersionKonflikt;
export { istGeschlossen };

export const KONFLIKT_TEXT =
  "Jemand hat diesen Eintrag inzwischen geändert. Entscheide oben, was gilt.";
export const KONFLIKT_LISTE =
  "Der Eintrag wurde inzwischen von jemand anderem geändert. Die Liste zeigt jetzt den Stand des Servers.";

// Text eines Werts in der Konflikt-Tabelle
export const wertText = (w) => {
  if (w === null || w === undefined || w === "") return "leer";
  if (w === true) return "ja";
  if (w === false) return "nein";
  if (Array.isArray(w)) return w.length === 0 ? "leer" : `${w.length} Einträge`;
  return String(w);
};

// Konflikt-Box im Formular: zeigt je abweichendem Feld «Dein Wert» und «Stand des Servers» und bietet zwei Wege. Die Box ist am Anfang versteckt.
// felder: { schluessel: "Beschriftung" }; meine(): die Werte des Formulars als { schluessel: Wert }
// beiEigene(aktuell): die eigene Änderung mit der Version des Servers erneut senden; beiServer(): den Stand des Servers übernehmen
export function konfliktBox({ felder, meine, beiEigene, beiServer }) {
  const inhalt = el("div", { class: "lm-konflikt-tabelle" });
  const eigene = knopf("Meine Änderung übernehmen", {
    art: "haupt",
    symbol: "haken",
  });
  const server = knopf("Stand des Servers übernehmen", {
    symbol: "aktualisieren",
  });
  const wurzel = el(
    "div",
    { class: "hinweis hinweis--warn lm-konflikt", role: "group", hidden: true },
    el("div", {}, el("strong", {}, "Jemand war schneller."), inhalt),
    el("div", { class: "reihe" }, eigene, server),
  );
  let stand = null;
  eigene.addEventListener("click", () => {
    wurzel.hidden = true;
    beiEigene(stand);
  });
  server.addEventListener("click", () => {
    wurzel.hidden = true;
    beiServer(stand);
  });
  return {
    wurzel,
    zeige(daten) {
      stand = daten?.aktuell ?? {};
      const eigeneWerte = meine();
      const keys = (daten?.abweichend ?? Object.keys(felder)).filter(
        (k) => felder[k],
      );
      inhalt.replaceChildren(
        el(
          "p",
          { class: "klein" },
          "Diese Angaben unterscheiden sich. Stand des Servers und dein Wert:",
        ),
        el(
          "dl",
          { class: "lm-vergleich" },
          keys.flatMap((k) => [
            el("dt", {}, felder[k]),
            el(
              "dd",
              {},
              el("span", {}, "Server: ", el("strong", {}, wertText(stand[k]))),
              el(
                "span",
                {},
                "Du: ",
                el("strong", {}, wertText(eigeneWerte[k])),
              ),
            ),
          ]),
        ),
      );
      wurzel.hidden = false;
      eigene.focus();
    },
    verberge() {
      wurzel.hidden = true;
    },
  };
}

// Meldung für eine Aktion in einer Liste: Konflikt und geschlossenes Lager bekommen eigene Worte, alles andere folgt dem Lager-Bereich
export function listenFehler(f) {
  if (istKonflikt(f)) return KONFLIKT_LISTE;
  return meldung(f);
}

// ctx.mitRueckgaengig mit Fehlertext und neuem Laden bei einem Konflikt (für die Sortierliste, die selbst keinen Fehlertext kennt)
export const mitFehlertext = (ctx, neuLaden) => (optionen) =>
  ctx.mitRueckgaengig({
    fehlertext: (f) => `Die Änderung ist nicht gespeichert. ${listenFehler(f)}`,
    beiFehler: () => neuLaden?.(),
    ...optionen,
  });

// Reine Funktion (testbar): die neuen Werte «reihenfolge» für die Zeilen einer Liste nach dem Ordnen. Sie nutzt die vorhandenen Werte der Zeilen, damit andere Zeilen derselben Tabelle ihre Stelle behalten. Liefert nur die Zeilen, die sich ändern: [{ id, version, reihenfolge }]
export function neueReihenfolge(zeilen, ids) {
  const werte = zeilen.map((p) => p.reihenfolge).sort((a, b) => a - b);
  const nachId = new Map(zeilen.map((p) => [p.id, p]));
  return ids.flatMap((id, i) => {
    const p = nachId.get(id);
    return p && p.reihenfolge !== werte[i]
      ? [{ id, version: p.version, reihenfolge: werte[i] }]
      : [];
  });
}

// Personenname für Listen: der Name, sonst «Unbekannt» (nie leer)
export const personName = (p) => p?.ceviName || p?.name || "Unbekannt";

// Die Mitglieder des Lagers für Auswahlfelder: [[personId, Name]]. Fehlt das Recht (403), gibt es keine Auswahl und der Aufrufer fällt auf Textfelder oder die schon geladenen Personen zurück.
export async function ladeMitglieder(lagerId) {
  try {
    const d = await anfrage("GET", lagerPfad(lagerId, "/mitglieder"));
    return d.mitglieder.map((m) => [m.personId, m.name]);
  } catch {
    return null;
  }
}

// Link nur anzeigen, wenn er mit «https:» beginnt (der Server speichert nur solche; hier eine zweite Sicherung)
export const sichererLink = (url) => {
  try {
    const u = new window.URL(String(url));
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

// Ein Link, der in einem neuen Tab ohne Verweis auf die Seite öffnet; ohne gültige Adresse nur der Text
export function aussenLink(text, url, klasse = "lg-verweis") {
  const href = sichererLink(url);
  if (!href) return el("span", {}, text);
  return el(
    "a",
    { class: klasse, href, target: "_blank", rel: "noopener noreferrer" },
    text,
    el("span", { class: "nur-leser" }, " (öffnet in einem neuen Tab)"),
  );
}

// Kopfzeile einer Karte: Überschrift links, Knöpfe rechts
export function kartenKopf(titel, ...knoepfe) {
  return el(
    "div",
    { class: "lm-kartenkopf" },
    el("h2", {}, titel),
    knoepfe.length > 0 && el("div", { class: "reihe" }, knoepfe),
  );
}

// Eine Zeile mit Knöpfen für die ganze Seite («Drucken», «Aktualisieren»); in den Druck kommt sie nicht
export function werkzeugzeile(...knoepfe) {
  return el(
    "div",
    { class: "lm-werkzeuge lm-nicht-drucken" },
    el("div", { class: "reihe" }, knoepfe.filter(Boolean)),
  );
}

export const druckKnopf = (text = "Drucken", kontext) =>
  knopfMit(text, {
    symbol: "drucker",
    kontext,
    onclick: () => window.print(),
  });

// Kopiert Text in die Zwischenablage; sagt, wie es ausging
export async function kopiere(text, ctx, was) {
  try {
    await navigator.clipboard.writeText(text);
    ctx.melde(`${was} ist kopiert.`);
  } catch {
    ctx.melde(
      "Kopieren ist nicht möglich. Markiere den Text von Hand.",
      "fehler",
    );
  }
}

// «Zeile» aus Beschriftung und Wert für Detailangaben
export const angabe = (label, wert) =>
  el("div", { class: "lm-angabe" }, el("dt", {}, label), el("dd", {}, wert));

// Zähler wie «5 von 9»
export const anteilText = (n, gesamt) => `${n} von ${gesamt}`;

// Textfeld mit festen Eigenschaften für Formulare der Module
export const textFeld = (label, wert, opt = {}) =>
  feld({ label, wert: wert ?? "", autocomplete: "off", ...opt });
