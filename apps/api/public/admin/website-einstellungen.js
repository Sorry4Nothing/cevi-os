import { anfrage, ApiFehler } from "./api.js";
import { el, feld, knopf } from "./dom.js";
import { bildDialog } from "./website-bausteine.js";
import { band, keinRecht } from "./website-dialoge.js";

// Einstellungen der Website (#550, #558, #567): der Name der Abteilung und ihr Logo im Kopf jeder Seite, dazu eine Fassung des Logos für den dunklen Modus, das Zeichen für den Browser-Tab (Favicon) und das Bild der Fehlerseiten.
// Adresse: #website/einstellungen. Das Logo ist ein öffentliches Bild der Medienbibliothek; die Seiten der Website werden nach dem Speichern neu erzeugt.
const API = "/api/v1/redaktion/website";
const MAX_NAME = 100;

const FEHLER = {
  MEDIUM_UNBEKANNT: "Das gewählte Bild gibt es nicht mehr. Wähle ein anderes.",
  MEDIUM_FORMAT: "Das Logo muss ein Bild sein.",
  MEDIUM_NICHT_OEFFENTLICH:
    "Das Logo erscheint im Kopf jeder Seite und muss ein öffentliches Bild sein. Wähle ein öffentliches Bild.",
};

// Die Bilder der Website: Feld der API, Texte und die Klasse der Vorschau (das dunkle Logo steht auf dunklem Grund, das Zeichen ist quadratisch, das Bild der Fehlerseiten breit)
const BILDER = [
  {
    feld: "logoMediumId",
    titel: "Logo im Kopf",
    hilfe:
      "Ein öffentliches Bild aus der Medienbibliothek, am besten ohne Hintergrund (PNG oder WebP mit Transparenz). Der Alt-Text des Bildes erscheint auf der Website.",
    ohne: "Kein Logo: Der Kopf zeigt die Wortmarke «CEVI» mit dem Namen.",
    waehlen: "Logo wählen",
    anders: "Anderes Logo wählen",
    entfernen: "Logo entfernen",
    alt: "Das gewählte Logo",
    klasse: "",
  },
  {
    feld: "logoDunkelMediumId",
    titel: "Logo im dunklen Modus (optional)",
    hilfe:
      "Eine Fassung mit heller Schrift für den dunklen Grund, ohne Hintergrund. Ohne sie zeigt der Kopf im dunklen Modus das Logo oben auf einem hellen Feld.",
    ohne: "Keine eigene Fassung: Der Kopf zeigt im dunklen Modus dasselbe Logo.",
    waehlen: "Fassung wählen",
    anders: "Andere Fassung wählen",
    entfernen: "Fassung entfernen",
    alt: "Die gewählte Fassung für den dunklen Modus",
    klasse: "ws-logovorschau--dunkel",
  },
  {
    feld: "zeichenMediumId",
    titel: "Zeichen für den Browser-Tab (optional)",
    hilfe:
      "Ein quadratisches, öffentliches Bild ohne Schrift und ohne Hintergrund, das auch ganz klein erkennbar ist. Es erscheint im Tab des Browsers, bei Lesezeichen und auf dem Startbildschirm des Handys, immer auf weissem Grund.",
    ohne: "Kein eigenes Zeichen: Die Website zeigt das Cevi-Zeichen.",
    waehlen: "Zeichen wählen",
    anders: "Anderes Zeichen wählen",
    entfernen: "Zeichen entfernen",
    alt: "Das gewählte Zeichen",
    klasse: "ws-logovorschau--zeichen",
  },
  {
    feld: "fehlerbildMediumId",
    titel: "Bild für die Fehlerseiten (optional)",
    hilfe:
      "Ein öffentliches Bild im Querformat, am besten ein Weg mit Wiese oder Wald und ohne Gesichter. Rechts im Bild steht der Wegweiser der Seite «nicht gefunden»; er verdeckt etwa die rechte Hälfte, links liegt die Aussage der Seite darüber. Das Bild muss die Ränder aushalten: Es wird auf die ganze Breite des Fensters zugeschnitten.",
    ohne: "Kein eigenes Bild: Die Fehlerseite zeigt das Titelbild der Startseite.",
    waehlen: "Bild wählen",
    anders: "Anderes Bild wählen",
    entfernen: "Bild entfernen",
    alt: "Das gewählte Bild für die Fehlerseiten",
    klasse: "ws-logovorschau--breit",
  },
];

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
  // Was gespeichert werden soll, je Feld der API; null = kein Bild
  const wahl = Object.fromEntries(
    BILDER.map((b) => [b.feld, stand[b.feld] ?? null]),
  );
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

  // Eine Auswahl je Bild (Logo, Fassung für den dunklen Modus, Zeichen, Bild der Fehlerseiten), jede mit ihrer Vorschau
  const bildWahl = (b) => {
    const vorschau = el("div", { class: "ws-logo" });
    const zeichneBild = () => {
      const id = wahl[b.feld];
      const setze = (neu) => {
        wahl[b.feld] = neu;
        zeichneBild();
        vorschau.querySelector("button")?.focus();
      };
      vorschau.replaceChildren();
      const waehlen = knopf(id ? b.anders : b.waehlen, {
        klein: true,
        onclick: () => bildDialog({ medien: new Map() }, (m) => setze(m.id)),
      });
      if (!id) {
        vorschau.append(el("p", { class: "hilfe" }, b.ohne), waehlen);
        return;
      }
      vorschau.append(
        el("img", {
          src: `/api/v1/medien/${id}`,
          alt: b.alt,
          class: `ws-logovorschau ${b.klasse}`.trim(),
        }),
        el(
          "div",
          { class: "ws-teilaktionen" },
          waehlen,
          knopf(b.entfernen, { klein: true, onclick: () => setze(null) }),
        ),
      );
    };
    zeichneBild();
    return el(
      "div",
      { class: "feld" },
      el("span", { class: "legende" }, b.titel),
      el("p", { class: "hilfe" }, b.hilfe),
      vorschau,
    );
  };

  const speichern = knopf("Speichern", { art: "haupt" });
  speichern.type = "submit";
  const formular = el(
    "form",
    { class: "formular ws-einstellungen", novalidate: true },
    name.wurzel,
    ...BILDER.map(bildWahl),
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
      ...Object.fromEntries(
        BILDER.filter((b) => wahl[b.feld] !== (stand[b.feld] ?? null)).map(
          (b) => [b.feld, wahl[b.feld]],
        ),
      ),
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
