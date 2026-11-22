import { anfrage, ApiFehler } from "./api.js";
import { el, feld, knopf } from "./dom.js";
import { bildDialog } from "./website-bausteine.js";
import { band, keinRecht } from "./website-dialoge.js";

// Einstellungen der Website (#550, #558): der Name der Abteilung und ihr Logo im Kopf jeder Seite, dazu eine Fassung des Logos für den dunklen Modus.
// Adresse: #website/einstellungen. Das Logo ist ein öffentliches Bild der Medienbibliothek; die Seiten der Website werden nach dem Speichern neu erzeugt.
const API = "/api/v1/redaktion/website";
const MAX_NAME = 100;

const FEHLER = {
  MEDIUM_UNBEKANNT: "Das gewählte Bild gibt es nicht mehr. Wähle ein anderes.",
  MEDIUM_FORMAT: "Das Logo muss ein Bild sein.",
  MEDIUM_NICHT_OEFFENTLICH:
    "Das Logo erscheint im Kopf jeder Seite und muss ein öffentliches Bild sein. Wähle ein öffentliches Bild.",
};

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      try {
        return await anfrage("GET", API);
      } catch (f) {
        if (f instanceof ApiFehler && f.status === 403) {
          return { keinRecht: true };
        }
        throw f;
      }
    },
    (daten) =>
      daten.keinRecht
        ? keinRecht(
            bereich,
            "Die Einstellungen der Website darfst du nicht ändern. Wende dich an die Abteilungsleitung, wenn du Zugriff brauchst.",
          )
        : zeichne(bereich, ctx, daten),
  );
}

function zeichne(bereich, ctx, stand) {
  const darfName = stand.nameAenderbar === true;
  // logoMediumId: was gespeichert werden soll; null = kein Logo
  let logo = stand.logoMediumId;
  let logoDunkel = stand.logoDunkelMediumId ?? null;
  const meldung = el("div");

  const name = feld({
    label: "Name der Abteilung",
    wert: stand.name,
    maxlength: MAX_NAME,
    autocomplete: "off",
    required: true,
    disabled: !darfName,
    hilfe: darfName
      ? "Erscheint im Kopf und im Fuss der Website und in der App."
      : "Erscheint im Kopf und im Fuss der Website. Den Namen ändert nur der Entwickler.",
  });

  // Eine Auswahl je Fassung: «dunkel» ist die Fassung für den dunklen Modus und zeigt ihre Vorschau auf dunklem Grund
  const logoWahl = (dunkel) => {
    const vorschau = el("div", { class: "ws-logo" });
    const text = dunkel
      ? ["Fassung wählen", "Andere Fassung wählen", "Fassung entfernen"]
      : ["Logo wählen", "Anderes Logo wählen", "Logo entfernen"];
    const zeichneLogo = () => {
      const id = dunkel ? logoDunkel : logo;
      const setze = (neu) => {
        if (dunkel) logoDunkel = neu;
        else logo = neu;
        zeichneLogo();
        vorschau.querySelector("button")?.focus();
      };
      vorschau.replaceChildren();
      const waehlen = knopf(id ? text[1] : text[0], {
        klein: true,
        onclick: () => bildDialog({ medien: new Map() }, (m) => setze(m.id)),
      });
      if (!id) {
        vorschau.append(
          el(
            "p",
            { class: "hilfe" },
            dunkel
              ? "Keine eigene Fassung: Der Kopf zeigt im dunklen Modus dasselbe Logo."
              : "Kein Logo: Der Kopf zeigt die Wortmarke «CEVI» mit dem Namen.",
          ),
          waehlen,
        );
        return;
      }
      vorschau.append(
        el("img", {
          src: `/api/v1/medien/${id}`,
          alt: dunkel
            ? "Die gewählte Fassung für den dunklen Modus"
            : "Das gewählte Logo",
          class: dunkel
            ? "ws-logovorschau ws-logovorschau--dunkel"
            : "ws-logovorschau",
        }),
        el(
          "div",
          { class: "ws-teilaktionen" },
          waehlen,
          knopf(text[2], {
            klein: true,
            onclick: () => setze(null),
          }),
        ),
      );
    };
    zeichneLogo();
    return vorschau;
  };

  const speichern = knopf("Speichern", { art: "haupt" });
  speichern.type = "submit";
  const formular = el(
    "form",
    { class: "formular ws-einstellungen", novalidate: true },
    name.wurzel,
    el(
      "div",
      { class: "feld" },
      el("span", { class: "legende" }, "Logo im Kopf"),
      el(
        "p",
        { class: "hilfe" },
        "Ein öffentliches Bild aus der Medienbibliothek, am besten ohne Hintergrund (PNG oder WebP mit Transparenz). Der Alt-Text des Bildes erscheint auf der Website.",
      ),
      logoWahl(false),
    ),
    el(
      "div",
      { class: "feld" },
      el("span", { class: "legende" }, "Logo im dunklen Modus (optional)"),
      el(
        "p",
        { class: "hilfe" },
        "Eine Fassung mit heller Schrift für den dunklen Grund, ohne Hintergrund. Ohne sie zeigt der Kopf im dunklen Modus das Logo oben.",
      ),
      logoWahl(true),
    ),
    meldung,
    el("div", { class: "dialog-knoepfe" }, speichern),
  );
  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    meldung.replaceChildren();
    const neuerName = name.eingabe.value.trim();
    if (darfName && neuerName === "") {
      meldung.append(band("fehler", "Der Name der Abteilung fehlt."));
      name.eingabe.focus();
      return;
    }
    const aenderung = {
      ...(darfName && neuerName !== stand.name && { name: neuerName }),
      ...(logo !== stand.logoMediumId && { logoMediumId: logo }),
      ...(logoDunkel !== (stand.logoDunkelMediumId ?? null) && {
        logoDunkelMediumId: logoDunkel,
      }),
    };
    if (Object.keys(aenderung).length === 0) {
      ctx.melde("Es gibt nichts zu speichern.");
      return;
    }
    speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      const neu = await anfrage("PATCH", API, aenderung);
      stand = neu;
      ctx.melde(
        "Die Einstellungen sind gespeichert. Die Website zeigt sie in wenigen Minuten.",
      );
    } catch (f) {
      meldung.append(
        band(
          "fehler",
          FEHLER[f?.code] ??
            "Das Speichern hat nicht geklappt. Prüfe die Angaben und versuche es nochmals.",
        ),
      );
    } finally {
      speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });
  bereich.append(formular);
}
