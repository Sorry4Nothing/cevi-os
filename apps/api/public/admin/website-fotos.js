import { anfrage, fehlertext } from "./api.js";
import { ankreuzen, el, feld, knopf, neueId } from "./dom.js";
import { sortierListe } from "./sortieren.js";
import { band } from "./website-dialoge.js";
import { leerKarte } from "./zustaende.js";

// Fotos (#690): Die Fotos der Abteilung liegen bei Flickr und erscheinen auf der Website, nur für angemeldete Personen. Hier stellt die Abteilung ein, welches Flickr-Konto gilt und welche Alben die Website zeigt.
// Adresse: #website/fotos. Der Server holt Alben und Bilder bei Flickr und reicht sie weiter; Schlüssel und Token stehen nie hier, nur in der Umgebung des Servers (docs/flickr-einrichten.md). Ein neues Album bei Flickr erscheint nie von selbst: Es braucht erst den Schalter «Auf der Website zeigen».
const API = "/api/v1/admin/fotos";
const MAX_TITEL = 120;
const KONTO = /^[0-9]{1,20}@N[0-9]{2}$/;

const datumFormat = new Intl.DateTimeFormat("de-CH", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const datumText = (iso) =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? datumFormat.format(new Date(`${iso}T12:00:00`))
    : "";
const fotosText = (n) => `${n} ${n === 1 ? "Foto" : "Fotos"}`;

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
  if (daten.eingerichtet) ctx.kopfAktion(testen);

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
      ctx.melde("Die Angaben sind gespeichert.", "ok");
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

  bereich.append(
    el(
      "div",
      { class: "foto-seite" },
      band(bandArt, bandText),
      daten.eingerichtet ? null : anleitung(),
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "foto-konto-titel" },
        el("h2", { id: "foto-konto-titel" }, "Flickr-Konto"),
        kontoForm,
      ),
      albenFlaeche(ctx, daten, neuLaden),
    ),
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

// ---------- Alben ----------

function albenFlaeche(ctx, daten, neuLaden) {
  const flaeche = el(
    "section",
    { class: "flaeche", "aria-labelledby": "foto-alben-titel" },
    el("h2", { id: "foto-alben-titel" }, "Alben"),
  );
  if (daten.verbindung !== "ok") {
    flaeche.append(
      el(
        "p",
        { class: "meta" },
        "Die Alben erscheinen hier, sobald die Verbindung steht.",
      ),
    );
    return flaeche;
  }
  if (daten.alben.length === 0) {
    flaeche.append(
      leerKarte("Bei Flickr gibt es für dieses Konto noch keine Alben."),
    );
    return flaeche;
  }
  // Die Version je Album ändert sich mit jeder Speicherung; die Zeile liest sie hier
  const albumStand = new Map(daten.alben.map((a) => [a.id, { ...a }]));
  const liste = sortierListe({
    beschriftung: "Alben der Website",
    eintraege: daten.alben.map((a) => ({
      id: a.id,
      text: a.eigenerTitel ?? a.titel,
      inhalt: zeile(ctx, albumStand, a.id, neuLaden),
    })),
    aktionstext: "Reihenfolge der Alben geändert",
    mitRueckgaengig: ctx.mitRueckgaengig,
    beiNeu: (ids) => anfrage("PUT", `${API}/alben/reihenfolge`, { ids }),
  });
  flaeche.append(
    el(
      "p",
      { class: "meta" },
      "Schalte ein Album ein, damit angemeldete Personen es auf der Website sehen. Neue Alben bei Flickr bleiben unsichtbar, bis du sie einschaltest. Zeige nur Alben, die Eltern und Leitende sehen dürfen: Die Fotos zeigen oft Kinder.",
    ),
    liste.wurzel,
    el(
      "p",
      { class: "klein leise" },
      "Ordne die Alben per Ziehen oder mit den Pfeilen. Die Website zeigt sie in dieser Reihenfolge.",
    ),
  );
  return flaeche;
}

function zeile(ctx, albumStand, id, neuLaden) {
  const a = albumStand.get(id);
  const titelText = el("strong", { class: "foto-titel" });
  const meta = el("span", { class: "meta" });
  const zustandText = el("span", { class: "foto-zustand" });
  const schalterId = neueId("foto-schalter");
  const schalter = el("button", {
    type: "button",
    class: "schalter",
    role: "switch",
    "aria-labelledby": `${schalterId} ${schalterId}-t`,
  });
  const beschriftung = el(
    "span",
    { id: schalterId, class: "foto-schalter-text" },
    "Auf der Website zeigen",
  );

  function zeichneZeile() {
    const titel = a.eigenerTitel ?? a.titel;
    titelText.textContent = titel || "Ohne Titel";
    meta.textContent = [
      fotosText(a.anzahl),
      datumText(a.datum),
      a.eigenerTitel ? `Bei Flickr: «${a.titel}»` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    schalter.setAttribute("aria-checked", String(a.sichtbar));
    // Der Zustand steht auch als Wort, nicht nur im Schalter
    zustandText.textContent = a.sichtbar ? "Sichtbar" : "Nicht sichtbar";
    zustandText.id = `${schalterId}-t`;
  }
  zeichneZeile();

  async function setzeSichtbar(sichtbar, mitRueckgaengig) {
    const vorher = a.sichtbar;
    a.sichtbar = sichtbar;
    zeichneZeile();
    schalter.disabled = true;
    try {
      const r = await anfrage("PUT", `${API}/alben/${id}`, {
        sichtbar,
        version: a.version,
      });
      a.version = r.version;
      if (mitRueckgaengig) {
        ctx.melde(
          sichtbar
            ? `«${a.eigenerTitel ?? a.titel}» ist jetzt auf der Website zu sehen.`
            : `«${a.eigenerTitel ?? a.titel}» ist ausgeblendet.`,
          "ok",
          {
            text: "Rückgängig",
            onclick: () => setzeSichtbar(vorher, false),
          },
        );
      }
    } catch (f) {
      a.sichtbar = vorher;
      zeichneZeile();
      if (f?.code === "VERSION_KONFLIKT") {
        ctx.melde(FEHLER.VERSION_KONFLIKT, "warn");
        neuLaden();
      } else {
        ctx.melde(`Das hat nicht geklappt. ${fehlertext(f)}`.trim(), "fehler");
      }
    } finally {
      schalter.disabled = false;
    }
  }
  schalter.addEventListener("click", () => setzeSichtbar(!a.sichtbar, true));

  // Eigener Titel: ein Feld in der Zeile, kein Fenster
  const titelPlatz = el("div", { class: "foto-titelform" });
  titelPlatz.hidden = true;
  const titelKnopf = knopf("Titel ändern", {
    klein: true,
    kontext: a.titel,
    "aria-expanded": "false",
    onclick: () => {
      if (!titelPlatz.hidden) return schliesse();
      const f = feld({
        label: "Eigener Titel",
        wert: a.eigenerTitel ?? "",
        maxlength: MAX_TITEL,
        autocomplete: "off",
        hilfe: `Leer lassen, dann gilt der Titel von Flickr: «${a.titel}».`,
      });
      const sichern = knopf("Speichern", { art: "haupt", klein: true });
      const abbrechen = knopf("Abbrechen", { klein: true, onclick: schliesse });
      const fehler = el("div");
      const form = el(
        "form",
        { class: "formular", novalidate: true },
        f.wurzel,
        fehler,
        el("div", { class: "foto-titelknoepfe" }, sichern, abbrechen),
      );
      sichern.type = "submit";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const wert = f.eingabe.value.trim();
        sichern.disabled = true;
        try {
          const r = await anfrage("PUT", `${API}/alben/${id}`, {
            titel: wert === "" ? null : wert,
            version: a.version,
          });
          a.version = r.version;
          a.eigenerTitel = wert === "" ? null : wert;
          zeichneZeile();
          schliesse();
          ctx.melde("Der Titel ist gespeichert.", "ok");
        } catch (g) {
          if (g?.code === "VERSION_KONFLIKT") {
            ctx.melde(FEHLER.VERSION_KONFLIKT, "warn");
            neuLaden();
          } else {
            fehler.replaceChildren(
              band("fehler", `Das hat nicht geklappt. ${fehlertext(g)}`.trim()),
            );
          }
        } finally {
          sichern.disabled = false;
        }
      });
      titelPlatz.replaceChildren(form);
      titelPlatz.hidden = false;
      titelKnopf.setAttribute("aria-expanded", "true");
      f.eingabe.focus();
    },
  });
  function schliesse() {
    titelPlatz.hidden = true;
    titelPlatz.replaceChildren();
    titelKnopf.setAttribute("aria-expanded", "false");
    titelKnopf.focus();
  }

  return el(
    "div",
    { class: "foto-zeile" },
    el("div", { class: "foto-info" }, titelText, meta),
    el(
      "div",
      { class: "foto-aktionen" },
      el(
        "div",
        { class: "schalterzeile foto-schalter" },
        beschriftung,
        el("span", { class: "foto-zustand-feld" }, zustandText),
        schalter,
      ),
      titelKnopf,
    ),
    titelPlatz,
  );
}
