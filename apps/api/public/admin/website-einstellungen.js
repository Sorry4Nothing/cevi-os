import { anfrage, ApiFehler } from "./api.js";
import { el, feld, knopf } from "./dom.js";
import { bildDialog } from "./website-bausteine.js";
import { band, keinRecht } from "./website-dialoge.js";

// Einstellungen der Website (#550): der Name der Abteilung und ihr Logo im Kopf jeder Seite.
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
  const istAdmin = ctx.ich?.role === "admin";
  // logoMediumId: was gespeichert werden soll; null = kein Logo
  let logo = stand.logoMediumId;
  const meldung = el("div");

  const name = feld({
    label: "Name der Abteilung",
    wert: stand.name,
    maxlength: MAX_NAME,
    autocomplete: "off",
    required: true,
    disabled: !istAdmin,
    hilfe: istAdmin
      ? "Erscheint im Kopf und im Fuss der Website und in der App."
      : "Erscheint im Kopf und im Fuss der Website. Den Namen ändert die Abteilungsleitung.",
  });

  const vorschau = el("div", { class: "ws-logo" });
  const zeichneLogo = () => {
    vorschau.replaceChildren();
    const waehlen = knopf(logo ? "Anderes Logo wählen" : "Logo wählen", {
      klein: true,
      onclick: () =>
        bildDialog({ medien: new Map() }, (m) => {
          logo = m.id;
          zeichneLogo();
          vorschau.querySelector("button")?.focus();
        }),
    });
    if (!logo) {
      vorschau.append(
        el(
          "p",
          { class: "hilfe" },
          "Kein Logo: Der Kopf zeigt die Wortmarke «CEVI» mit dem Namen.",
        ),
        waehlen,
      );
      return;
    }
    vorschau.append(
      el("img", {
        src: `/api/v1/medien/${logo}`,
        alt: "Das gewählte Logo",
        class: "ws-logovorschau",
      }),
      el(
        "div",
        { class: "ws-teilaktionen" },
        waehlen,
        knopf("Logo entfernen", {
          klein: true,
          onclick: () => {
            logo = null;
            zeichneLogo();
            vorschau.querySelector("button")?.focus();
          },
        }),
      ),
    );
  };
  zeichneLogo();

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
        "Ein öffentliches Bild aus der Medienbibliothek. Es hat seinen eigenen Hintergrund, damit es in Tag und Nacht lesbar ist. Der Alt-Text des Bildes erscheint auf der Website.",
      ),
      vorschau,
    ),
    meldung,
    el("div", { class: "dialog-knoepfe" }, speichern),
  );
  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    meldung.replaceChildren();
    const neuerName = name.eingabe.value.trim();
    if (istAdmin && neuerName === "") {
      meldung.append(band("fehler", "Der Name der Abteilung fehlt."));
      name.eingabe.focus();
      return;
    }
    const aenderung = {
      ...(istAdmin && neuerName !== stand.name && { name: neuerName }),
      ...(logo !== stand.logoMediumId && { logoMediumId: logo }),
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
