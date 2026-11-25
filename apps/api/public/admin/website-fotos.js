import { anfrage, fehlertext } from "./api.js";
import { ankreuzen, el, feld, knopf } from "./dom.js";
import { band } from "./website-dialoge.js";
import { albenBereich } from "./website-fotos-alben.js";
import { leerKarte } from "./zustaende.js";

// Fotos (#690): Die Fotos der Abteilung liegen bei Flickr und erscheinen auf der Website, nur für angemeldete Personen. Hier stellt die Abteilung ein, welches Flickr-Konto gilt und welche Alben die Website zeigt.
// Adresse: #website/fotos. Der Server holt Alben und Bilder bei Flickr und reicht sie weiter; Schlüssel und Token stehen nie hier, nur in der Umgebung des Servers (docs/flickr-einrichten.md). Ein neues Album bei Flickr erscheint nie von selbst: Es braucht erst den Schalter «Auf der Website zeigen».
const API = "/api/v1/admin/fotos";
const KONTO = /^[0-9]{1,20}@N[0-9]{2}$/;

// Was die Verbindung gerade sagt, in Worten und mit der Art des Hinweises
const VERBINDUNG = {
  ok: ["ok", "Die Verbindung zu Flickr steht."],
  nicht_eingerichtet: [
    "warn",
    "Der Server hat noch keine Zugangsdaten für Flickr. Folge der Anleitung weiter unten.",
  ],
  kein_konto: [
    "warn",
    "Trage die Kennung des Flickr-Kontos ein, damit die Alben erscheinen.",
  ],
  zugang: [
    "fehler",
    "Flickr lehnt den Zugang ab. Prüfe Schlüssel, Secret und Token in der Einrichtung des Servers.",
  ],
  nicht_gefunden: [
    "fehler",
    "Dieses Konto gibt es bei Flickr nicht. Prüfe die Kennung.",
  ],
  nicht_erreichbar: [
    "fehler",
    "Flickr antwortet gerade nicht. Versuche es später nochmals.",
  ],
};

const FEHLER = {
  VERSION_KONFLIKT:
    "Jemand anders hat das gerade geändert. Die Seite lädt neu.",
};

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", API),
    (daten, neuLaden) => zeichne(bereich, ctx, daten, neuLaden),
    { skeleton: "flaeche" },
  );
}

function zeichne(bereich, ctx, daten, neuLaden) {
  const [bandArt, bandText] =
    VERBINDUNG[daten.verbindung] ?? VERBINDUNG.nicht_erreichbar;
  let stand = daten;

  // «Verbindung testen»: ein frischer Abruf; ein Konto, das noch nicht gespeichert ist, lässt sich vorher prüfen
  const testen = knopf("Verbindung testen", {
    klein: true,
    onclick: async () => {
      testen.disabled = true;
      testen.setAttribute("aria-busy", "true");
      try {
        const eingabe = konto.eingabe.value.trim();
        const r = await anfrage("POST", `${API}/verbindung`, {
          ...(KONTO.test(eingabe) && { flickrKonto: eingabe }),
        });
        if (r.ok) {
          ctx.melde(
            `Die Verbindung steht. Das Konto hat ${r.alben} ${r.alben === 1 ? "Album" : "Alben"}.`,
            "ok",
          );
          if (KONTO.test(eingabe) && eingabe === stand.flickrKonto) neuLaden();
        } else {
          const [art, text] = VERBINDUNG[r.art] ?? VERBINDUNG.nicht_erreichbar;
          ctx.melde(text, art);
        }
      } catch (f) {
        ctx.melde(fehlertext(f), "fehler");
      } finally {
        testen.disabled = false;
        testen.removeAttribute("aria-busy");
      }
    },
  });

  // ---------- Konto ----------
  const konto = feld({
    label: "Kennung des Flickr-Kontos",
    wert: daten.flickrKonto ?? "",
    maxlength: 30,
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    hilfe:
      "Ziffern, «@N» und zwei Ziffern, zum Beispiel 12345678@N00. Du findest sie in der Adresse deines Flickr-Profils oder mit einem Dienst wie «Flickr Find ID».",
  });
  const linkWahl = ankreuzen({
    label: "Bei jedem Album den Link «Album auf Flickr öffnen» zeigen",
    gewaehlt: daten.flickrLinkZeigen,
    wert: "link",
  });
  const speichern = knopf("Speichern", { art: "haupt" });
  const kontoMeldung = el("div");
  const kontoForm = el(
    "form",
    { class: "formular foto-konto", novalidate: true },
    konto.wurzel,
    el(
      "div",
      { class: "feld" },
      linkWahl.wurzel,
      el(
        "p",
        { class: "hilfe" },
        "Aus: Die Website bleibt bei sich, und niemand verlässt sie ungewollt. Der Link führt zu Flickr, wo andere Regeln gelten.",
      ),
    ),
    kontoMeldung,
    speichern,
  );
  speichern.type = "submit";
  kontoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    kontoMeldung.replaceChildren();
    const wert = konto.eingabe.value.trim();
    if (wert !== "" && !KONTO.test(wert)) {
      kontoMeldung.append(
        band(
          "fehler",
          "Die Kennung hat nicht die richtige Form: Ziffern, «@N» und zwei Ziffern.",
        ),
      );
      konto.eingabe.focus();
      return;
    }
    speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      await anfrage("PUT", `${API}/einstellung`, {
        flickrKonto: wert === "" ? null : wert,
        flickrLinkZeigen: linkWahl.eingabe.checked,
        version: stand.version,
      });
      ctx.melde("Gespeichert.", "ok");
      neuLaden();
    } catch (f) {
      if (f?.code === "VERSION_KONFLIKT") {
        ctx.melde(FEHLER.VERSION_KONFLIKT, "warn");
        neuLaden();
      } else {
        kontoMeldung.append(
          band("fehler", `Das Speichern hat nicht geklappt. ${fehlertext(f)}`),
        );
      }
    } finally {
      speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });

  // Verbindung und «Verbindung testen» in einer Zeile
  const status = band(bandArt, bandText, daten.eingerichtet ? testen : null);
  status.classList.add("foto-verbindung");

  // Das Konto ist ein aufklappbarer Abschnitt: zu, solange es gesetzt ist und die Verbindung Alben liefert
  const kontoOffen =
    !daten.flickrKonto || daten.verbindung !== "ok" || daten.alben.length === 0;
  const kontoBlock = el(
    "details",
    { class: "flaeche foto-konto-block", open: kontoOffen },
    el(
      "summary",
      { class: "foto-konto-kopf" },
      el("span", { class: "foto-konto-titel" }, "Flickr-Konto"),
      el(
        "span",
        { class: "meta" },
        daten.flickrKonto ?? "Noch keine Kennung eingetragen",
      ),
    ),
    kontoOffen ? betreiberHilfe() : null,
    kontoForm,
  );

  bereich.append(
    el(
      "div",
      { class: "foto-seite" },
      status,
      daten.eingerichtet ? null : anleitung(),
      kontoBlock,
      daten.verbindung !== "ok"
        ? null
        : daten.alben.length === 0
          ? leerKarte(
              "Keine Alben gefunden. Prüfe das Konto und die Verbindung.",
            )
          : albenBereich(ctx, daten, neuLaden).wurzel,
    ),
  );
}

// Wenn die Verbindung fehlt oder das Konto leer ist: Das Konto, für das der Server Flickr abfragt, steht in seiner Umgebung
function betreiberHilfe() {
  return el(
    "p",
    { class: "hilfe foto-betreiber" },
    "Die Person, die den Server betreibt, trägt dort die Einstellung ",
    el("code", {}, "FLICKR_KONTO"),
    " ein (in ",
    el("code", {}, "deploy/.env"),
    "). Sie muss mit der Kennung hier übereinstimmen, sonst sieht Cevi OS nur öffentliche Alben.",
  );
}

// Schritt für Schritt, solange der Server keine Zugangsdaten hat; ohne Geheimnisse, nur die Namen der Werte
function anleitung() {
  return el(
    "section",
    { class: "flaeche", "aria-labelledby": "foto-anleitung-titel" },
    el("h2", { id: "foto-anleitung-titel" }, "Fotos einrichten"),
    el(
      "p",
      {},
      "Die Fotos bleiben bei Flickr. Der Server holt sie dort und zeigt sie angemeldeten Personen auf der Website. Dafür braucht er einmalig Zugang zu deinem Flickr-Konto. Das machst du so:",
    ),
    el(
      "ol",
      { class: "foto-schritte" },
      el(
        "li",
        {},
        "Erstelle bei Flickr eine App (flickr.com/services/apps/create, «nicht kommerziell»). Du bekommst einen Schlüssel und ein Secret.",
      ),
      el(
        "li",
        {},
        "Hole mit dem Skript ",
        el("code", {}, "apps/api/scripts/flickr-token.mjs"),
        " ein Token, das nur lesen darf. Das Skript führt dich durch die Freigabe bei Flickr und gibt Token und Token-Secret aus.",
      ),
      el(
        "li",
        {},
        "Trage die vier Werte in der Umgebung des Servers ein (",
        el("code", {}, "FLICKR_API_KEY"),
        ", ",
        el("code", {}, "FLICKR_API_SECRET"),
        ", ",
        el("code", {}, "FLICKR_OAUTH_TOKEN"),
        ", ",
        el("code", {}, "FLICKR_OAUTH_TOKEN_SECRET"),
        ") und starte den Server neu. Gib sie nie weiter und schreibe sie nirgends hinein ausser in die Umgebung.",
      ),
      el(
        "li",
        {},
        "Komm hierher zurück, trage unten die Kennung des Flickr-Kontos ein und schalte die Alben ein, die erscheinen sollen.",
      ),
      el(
        "li",
        {},
        "Lege im Editor eine Seite (zum Beispiel «Fotos») mit dem Baustein «Fotoalben» an und veröffentliche sie.",
      ),
    ),
    el(
      "p",
      { class: "meta" },
      "Die ausführliche Anleitung steht im Repository: docs/flickr-einrichten.md.",
    ),
  );
}
