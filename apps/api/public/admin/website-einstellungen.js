import { anfrage, ApiFehler } from "./api.js";
import { bildMitLader, bildwahl } from "./bildwahl.js";
import { el, feld, knopf, STANDARD_LOGO } from "./dom.js";
import { sk } from "./lader.js";
import { band, keinRecht } from "./website-dialoge.js";

// Einstellungen der Website (#550, #558, #567, #591): der Name der Abteilung und ihr Logo im Kopf jeder Seite, dazu eine Fassung des Logos für den dunklen Modus, das Zeichen für den Browser-Tab (Favicon) und das Bild der Fehlerseiten.
// Zwei Spalten: links die Felder, rechts die Vorschau (Kopf hell und dunkel, Tab, Fehlerseite), die bei jeder Wahl mitgeht. Die Bilder wählst du unter dem Feld aus der Medienbibliothek, in der Seite selbst.
// Adresse: #website/einstellungen. Das Logo ist ein öffentliches Bild der Medienbibliothek; die Seiten der Website werden nach dem Speichern neu erzeugt.
const API = "/api/v1/redaktion/website";
const MAX_NAME = 100;

const FEHLER = {
  MEDIUM_UNBEKANNT: "Das gewählte Bild gibt es nicht mehr. Wähle ein anderes.",
  MEDIUM_FORMAT: "Das Logo muss ein Bild sein.",
  MEDIUM_NICHT_OEFFENTLICH:
    "Das Logo erscheint im Kopf jeder Seite und muss ein öffentliches Bild sein. Wähle ein öffentliches Bild.",
};

// Die Bilder der Website: Feld der API und Texte; «ohne» sagt, was die Website ohne Wahl zeigt
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
  },
];

const bildUrl = (id) => `/api/v1/medien/${id}`;

// Zwei Spalten wie das Formular: Felder links, Vorschau rechts
function skeletonEinstellungen() {
  return el(
    "div",
    { class: "ws-einst-spalten", "aria-hidden": "true" },
    el(
      "div",
      { class: "ws-einst-felder" },
      el("div", { class: "feld" }, sk("t", 80), sk("b", 380)),
      ...BILDER.map(() =>
        el(
          "div",
          { class: "feld" },
          sk("t", 200),
          sk("t", 320),
          el("div", { class: "sk-zeile" }, sk("r", 136), sk("r", 112)),
        ),
      ),
    ),
    el(
      "div",
      { class: "ws-einst-vorschau" },
      sk("t", 112),
      sk("b", 380),
      sk("b", 380),
      sk("b", 380),
    ),
  );
}

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
    { skeleton: skeletonEinstellungen },
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

  // ===== Vorschau rechts =====
  const kopfHell = el("div", { class: "ws-v-kopf ws-v-kopf--hell" });
  const kopfDunkel = el("div", { class: "ws-v-kopf ws-v-kopf--dunkel" });
  const tab = el("div", { class: "ws-v-tab" });
  const fehlerseite = el("div", { class: "ws-v-fehler" });
  const vorschauKarte = (titel, inhalt, hinweis) =>
    el(
      "figure",
      { class: "ws-v-karte" },
      el("figcaption", { class: "legende" }, titel),
      inhalt,
      hinweis && el("p", { class: "hilfe" }, hinweis),
    );
  const wortmarke = (dunkel) =>
    el(
      "span",
      { class: `ws-v-wort${dunkel ? " ws-v-wort--dunkel" : ""}` },
      el("strong", {}, "CEVI"),
      el("span", {}, name.eingabe.value.trim() || stand.name),
    );
  const logoBild = (id, klasse = "") =>
    bildMitLader(
      el("img", { src: bildUrl(id), alt: "", decoding: "async" }),
      `ws-v-logo ${klasse}`.trim(),
    );

  function zeichneVorschau() {
    const hell = wahl.logoMediumId;
    const dunkel = wahl.logoDunkelMediumId;
    const zeichen = wahl.zeichenMediumId;
    const fehler = wahl.fehlerbildMediumId;
    kopfHell.replaceChildren(hell ? logoBild(hell) : wortmarke(false));
    kopfDunkel.replaceChildren(
      dunkel
        ? logoBild(dunkel)
        : hell
          ? logoBild(hell, "ws-v-logo--feld")
          : wortmarke(true),
    );
    tab.replaceChildren(
      el(
        "span",
        { class: "ws-v-tabzeichen" },
        zeichen
          ? bildMitLader(
              el("img", { src: bildUrl(zeichen), alt: "", decoding: "async" }),
              "ws-v-zeichen",
            )
          : el("img", { src: STANDARD_LOGO, alt: "", class: "ws-v-zeichen" }),
      ),
      el("span", { class: "ws-v-tabtext" }, name.eingabe.value.trim() || stand.name),
    );
    fehlerseite.replaceChildren(
      fehler
        ? bildMitLader(
            el("img", { src: bildUrl(fehler), alt: "", decoding: "async" }),
            "ws-v-fehlerbild",
          )
        : el(
            "p",
            { class: "ws-v-leer" },
            "Kein eigenes Bild: Die Fehlerseite zeigt das Titelbild der Startseite.",
          ),
    );
  }

  // ===== Felder links =====
  const status = el("p", { class: "ws-einst-status", role: "status" });
  const geaendert = () =>
    (darfName && name.eingabe.value.trim() !== stand.name) ||
    BILDER.some((b) => wahl[b.feld] !== (stand[b.feld] ?? null));
  const zeigeStatus = () => {
    status.textContent = geaendert()
      ? "Nicht gespeichert"
      : "Alles gespeichert";
    status.classList.toggle("ws-einst-status--offen", geaendert());
  };

  // Eine Wahl je Bild: Titel, Hilfe, kleine Vorschau mit Knöpfen, darunter die Bilder zum Anklicken
  const bildFeld = (b) => {
    const mini = el("span", { class: "ws-einst-mini" });
    const text = el("p", { class: "hilfe" });
    const aktionen = el("div", { class: "ws-teilaktionen" });
    const waehlen = knopf(b.waehlen, { klein: true });
    const entfernen = knopf(b.entfernen, {
      klein: true,
      onclick: () => {
        wahl[b.feld] = null;
        aktualisiere();
        waehlen.focus();
      },
    });
    const w = bildwahl({
      ausloeser: waehlen,
      gewaehlt: wahl[b.feld],
      beiWahl: (m) => {
        wahl[b.feld] = m.id;
        aktualisiere();
      },
    });
    function aktualisiere() {
      const id = wahl[b.feld];
      w.setze(id);
      mini.replaceChildren(
        id
          ? bildMitLader(
              el("img", { src: bildUrl(id), alt: "", decoding: "async" }),
              "ws-einst-minibild",
            )
          : el("span", { class: "ws-einst-minibild ws-einst-minibild--leer" }),
      );
      text.textContent = id ? "" : b.ohne;
      text.hidden = Boolean(id);
      waehlen.lastChild.textContent = id ? b.anders : b.waehlen;
      entfernen.hidden = !id;
      zeichneVorschau();
      zeigeStatus();
    }
    aktionen.append(waehlen, entfernen);
    aktualisiere();
    const titelId = `bf-${b.feld}`;
    return el(
      "div",
      { class: "feld ws-einst-bild", role: "group", "aria-labelledby": titelId },
      el("span", { class: "legende", id: titelId }, b.titel),
      el("p", { class: "hilfe" }, b.hilfe),
      el("div", { class: "ws-einst-wahl" }, mini, el("div", {}, text, aktionen)),
      w.panel,
    );
  };

  name.eingabe.addEventListener("input", () => {
    zeichneVorschau();
    zeigeStatus();
  });

  const speichern = knopf("Speichern", { art: "haupt" });
  speichern.type = "submit";
  const formular = el(
    "form",
    { class: "formular ws-einstellungen", novalidate: true },
    el(
      "div",
      { class: "ws-einst-spalten" },
      el(
        "div",
        { class: "ws-einst-felder" },
        name.wurzel,
        ...BILDER.map(bildFeld),
      ),
      el(
        "aside",
        { class: "ws-einst-vorschau", "aria-label": "Vorschau" },
        el("h2", { class: "ws-einst-vtitel" }, "So sieht es aus"),
        vorschauKarte("Kopf am Tag", kopfHell),
        vorschauKarte("Kopf in der Nacht", kopfDunkel),
        vorschauKarte("Tab im Browser", tab),
        vorschauKarte("Fehlerseite", fehlerseite),
      ),
    ),
    meldung,
    el("div", { class: "ws-einst-leiste" }, status, speichern),
  );
  zeichneVorschau();
  zeigeStatus();
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
      zeigeStatus();
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
