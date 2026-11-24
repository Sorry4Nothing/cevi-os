import { anfrage, fehlertext } from "./api.js";
import { chip, el, feld, knopf, neueId, zeit } from "./dom.js";
import { entferneFehler, feldFehler } from "./liste-hilfen.js";

// Cevi-Datenbank (#691): Verbindung prüfen und die Gruppe (Ebene) der Abteilung einstellen. Adresse und Token stehen nur in der Umgebung des Servers (deploy/.env); diese Seite zeigt sie nie und kann sie nicht ändern. Die Verbindung liest nur.
// Abfragen: einmal GET beim Öffnen, danach nur auf Knopfdruck («Prüfen» ein POST, «Speichern» ein PUT). Kein Polling.

// Was die Prüfung antwortet, in Worten; Zustand steht im Text und nicht nur in der Farbe
const ERGEBNIS = {
  ok: ["ok", "Die Verbindung steht."],
  nicht_eingerichtet: [
    "warn",
    "Die Verbindung ist nicht eingerichtet. Adresse und Token fehlen auf dem Server.",
  ],
  abgelehnt: [
    "fehler",
    "Die Cevi-Datenbank lehnt das Token ab. Prüfe, ob es noch gilt und die Rechte «Personen dieser Ebene» hat.",
  ],
  nicht_erreichbar: [
    "fehler",
    "Die Cevi-Datenbank antwortet gerade nicht. Prüfe die Adresse und versuche es später nochmals.",
  ],
  antwort: [
    "fehler",
    "Die Antwort der Cevi-Datenbank hat ein unerwartetes Format. Die Anmeldung füllt dann nichts vor.",
  ],
};

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/admin/cevi-db"),
    (daten) => zeichne(bereich, ctx, daten),
  );
}

function zeichne(bereich, ctx, daten) {
  // Fortschritt der laufenden Prüfung; das Ergebnis kommt als Toast
  const stand = el(
    "div",
    { class: "hinweis", role: "status", hidden: true },
    "Die Verbindung wird geprüft.",
  );
  const pruefKnopf = knopf("Verbindung prüfen", {
    art: "haupt",
    symbol: "aktualisieren",
  });
  pruefKnopf.addEventListener("click", async () => {
    pruefKnopf.disabled = true;
    pruefKnopf.setAttribute("aria-busy", "true");
    stand.hidden = false;
    try {
      const r = await anfrage("POST", "/api/v1/admin/cevi-db/pruefen");
      const [art, text] = ERGEBNIS[r.ergebnis] ?? ERGEBNIS.antwort;
      let satz = text;
      if (r.ergebnis === "ok" && r.gruppe === true)
        satz += " Das Token sieht die eingestellte Gruppe.";
      if (r.ergebnis === "ok" && r.gruppe === false)
        satz +=
          " Die eingestellte Gruppe sieht das Token nicht. Prüfe die Nummer der Gruppe.";
      ctx.melde(satz, art === "ok" || art === "warn" ? art : "fehler");
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    } finally {
      stand.hidden = true;
      pruefKnopf.disabled = false;
      pruefKnopf.removeAttribute("aria-busy");
    }
  });

  const gruppe = feld({
    label: "Nummer der Gruppe (Ebene)",
    wert: daten.gruppeId ?? "",
    inputmode: "numeric",
    maxlength: 20,
    hilfe:
      "Die Nummer der Abteilung in der Cevi-Datenbank, zum Beispiel aus der Adresse ihrer Seite. Leer lassen, wenn du sie nicht kennst; die Prüfung testet dann nur das Token.",
  });
  const speichern = knopf("Speichern", { art: "haupt" });
  speichern.addEventListener("click", async () => {
    const wert = gruppe.eingabe.value.trim();
    if (wert !== "" && !/^[0-9]{1,20}$/.test(wert)) {
      feldFehler(gruppe, "Die Nummer besteht nur aus Ziffern.");
      gruppe.eingabe.focus();
      return;
    }
    entferneFehler(gruppe);
    speichern.disabled = true;
    try {
      await anfrage("PUT", "/api/v1/admin/cevi-db", {
        gruppeId: wert === "" ? null : wert,
      });
      ctx.melde("Gespeichert.");
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    } finally {
      speichern.disabled = false;
    }
  });

  const schritte = [
    "Melde dich in der Cevi-Datenbank mit einem Konto an, das die Gruppe der Abteilung voll verwalten darf (Hauptleitung).",
    "Öffne bei der Gruppe «API-Schlüssel» (Dienstkonten) und lege einen neuen Schlüssel an.",
    "Wähle nur das Recht «Personen dieser Ebene» und sonst nichts. Das Token braucht keine Schreibrechte und keine Gruppen, Anlässe oder Rechnungen.",
    "Kopiere das Token einmal und trage es auf dem Server in deploy/.env als CEVI_DB_TOKEN ein, dazu die Adresse der Cevi-Datenbank als CEVI_DB_URL. Starte die API danach neu.",
    "Komm hierher zurück und prüfe die Verbindung.",
  ];
  const titelId = neueId("cevi-db-titel");
  bereich.append(
    el(
      "section",
      { class: "flaeche", "aria-labelledby": titelId },
      el("h2", { id: titelId }, "Verbindung"),
      el(
        "ul",
        { class: "chips" },
        daten.verbunden
          ? chip("Eingerichtet", "ok")
          : chip("Nicht eingerichtet", "warn"),
        daten.letzterAbrufAm
          ? chip(
              `Letzter Abruf ${zeit(daten.letzterAbrufAm)}: ${daten.letzterStatus === "ok" ? "ok" : "Fehler"}${daten.anzahlPersonen === null ? "" : `, ${daten.anzahlPersonen} Personen`}`,
              daten.letzterStatus === "ok" ? "ok" : "fehler",
            )
          : chip("Noch kein Abruf", undefined, "info"),
      ),
      el(
        "p",
        { class: "klein leise" },
        "Cevi OS liest nur: Es schreibt nie in die Cevi-Datenbank. Beim Öffnen einer Anmeldung füllt es freiwillige Angaben der Person vor, wenn der Anlass sie fragt.",
      ),
      el("div", { class: "reihe" }, pruefKnopf),
      stand,
    ),
    el(
      "section",
      { class: "flaeche", "aria-labelledby": `${titelId}-g` },
      el("h2", { id: `${titelId}-g` }, "Gruppe der Abteilung"),
      gruppe.wurzel,
      el("div", { class: "reihe" }, speichern),
    ),
    el(
      "section",
      { class: "flaeche", "aria-labelledby": `${titelId}-a` },
      el("h2", { id: `${titelId}-a` }, "Token erstellen"),
      el(
        "p",
        { class: "klein leise" },
        "Das Token gehört der Abteilung und bleibt auf dem Server. Gib es nie weiter und nie in einem Chat oder Ticket an.",
      ),
      el(
        "ol",
        {},
        schritte.map((s) => el("li", {}, s)),
      ),
    ),
  );
}
