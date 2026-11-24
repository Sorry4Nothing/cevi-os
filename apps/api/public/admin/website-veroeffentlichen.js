import { anfrage, fehlertext } from "./api.js";
import { el, knopf, zeit } from "./dom.js";
import { sk } from "./lader.js";
import {
  anzahlText,
  band,
  beschaeftigt,
  bei,
  fenster,
  kuerze,
} from "./website-dialoge.js";
import { kurzText, typName } from "./website-felder.js";
import { symbol } from "./website-symbole.js";

// Veröffentlichen und Versionen (Boards E6, #595): «Veröffentlichen» zeigt die Änderungen seit der veröffentlichten Version und «Jetzt veröffentlichen»; «Versionen» ist eine Zeitleiste
// (neueste oben, Markierung für die veröffentlichte Version, Vorschau und Zurückholen), ohne Vergleich der Texte. Beides wird erst geladen, wenn die Seite öffnet.
// Datenbanklast: «Veröffentlichen» zwei Abrufe beim Öffnen (Versionen und die veröffentlichte Version für den Vergleich), «Versionen» einer; einer beim Veröffentlichen.

const API = "/api/v1/redaktion";
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Was hat sich gegenüber der veröffentlichten Fassung geändert? Vergleich nach der Kennung der Bausteine
export function vergleiche(neu, alt) {
  const nachId = new Map(alt.bausteine.map((b) => [b.id, b]));
  const ids = new Set(neu.bausteine.map((b) => b.id));
  const punkte = [];
  if (neu.titel !== alt.titel) {
    punkte.push({ art: "geaendert", text: "Überschrift der Seite" });
  }
  for (const b of neu.bausteine) {
    const fruehere = nachId.get(b.id);
    if (!fruehere) punkte.push({ art: "neu", baustein: b });
    else if (
      !gleich(b.daten, fruehere.daten) ||
      !gleich(b.sichtbarkeit, fruehere.sichtbarkeit)
    ) {
      punkte.push({ art: "geaendert", baustein: b });
    }
  }
  for (const b of alt.bausteine) {
    if (!ids.has(b.id)) punkte.push({ art: "entfernt", baustein: b });
  }
  const gemeinsamNeu = neu.bausteine
    .filter((b) => nachId.has(b.id))
    .map((b) => b.id);
  const gemeinsamAlt = alt.bausteine
    .filter((b) => ids.has(b.id))
    .map((b) => b.id);
  if (!gleich(gemeinsamNeu, gemeinsamAlt)) {
    punkte.push({ art: "geaendert", text: "Reihenfolge der Bausteine" });
  }
  return punkte;
}

const CHIP = {
  neu: ["neu", "chip--ok", "haken"],
  geaendert: ["geändert", "chip--warn", "bearbeiten"],
  entfernt: ["entfernt", "chip--fehler", "schliessen"],
};

// k: Kontext des Editors: { id, seite, dok, dirty, nr, unveroeffentlicht, speichere(), statusNeu(), zeigeVersion(nr), neuAusEntwurf(), ctx }
// titel: «Veröffentlichen» oder «Versionen»
export async function veroeffentlichenDialog(k, titel = "Veröffentlichen") {
  if (k.dirty && !(await k.speichere())) return;
  const nurVersionen = titel === "Versionen";
  const aenderungen = el("section", { class: "ws-teil", "aria-busy": "true" });
  const versionen = el("section", { class: "ws-teil", "aria-busy": "true" });
  const ok = knopf("Jetzt veröffentlichen", { art: "haupt" });
  const grund = el("span", { class: "mini leise" });
  const okSpalte = el("span", { class: "ws-fussspalte" }, ok, grund);
  const abbrechen = knopf(nurVersionen ? "Schliessen" : "Abbrechen", {
    onclick: () => f.schliesse(),
  });
  let bereit = false;

  const skeletonZeilen = () => [
    ...[0, 1, 2].map(() =>
      el(
        "div",
        { class: "baustein fest ws-sk-version", "aria-hidden": "true" },
        el("div", {}, sk("t", 160), sk("t", 260)),
        sk("r", 96),
      ),
    ),
    el("p", { class: "nur-leser", role: "status" }, "Lädt …"),
  ];
  aenderungen.replaceChildren(
    el("h3", {}, "Änderungen"),
    ...skeletonZeilen().slice(0, 1),
    ...skeletonZeilen().slice(-1),
  );
  if (nurVersionen) aenderungen.hidden = true;
  versionen.replaceChildren(el("h3", {}, "Versionen"), ...skeletonZeilen());

  const sperre = (text) => {
    ok.setAttribute("aria-disabled", "true");
    grund.textContent = text;
  };
  sperre("Die Versionen werden geladen.");

  const f = fenster({
    titel,
    inhalt: [aenderungen, versionen],
    fuss: nurVersionen ? [abbrechen] : [abbrechen, okSpalte],
    fokus: abbrechen,
  });

  bei(ok, async () => {
    if (!bereit) return;
    f.fehler(null);
    beschaeftigt(ok, true);
    abbrechen.disabled = true;
    try {
      const { nr } = await anfrage(
        "POST",
        `${API}/seiten/${k.id}/veroeffentlichen`,
      );
      f.dialog.addEventListener(
        "close",
        () => {
          k.nr = nr;
          k.unveroeffentlicht = false;
          k.statusNeu();
          k.ctx.melde(
            `Veröffentlicht. Die Seite «${kuerze(k.dok.titel, 60)}» ist jetzt online (Version ${nr}).`,
            "ok",
          );
        },
        { once: true },
      );
      f.schliesse();
    } catch (fehler) {
      f.fehler(
        fehler.status === 409 && fehler.code === "NICHTS_ZU_VEROEFFENTLICHEN"
          ? "Nichts zu veröffentlichen: Der Entwurf ist gleich der veröffentlichten Version."
          : fehler.status === 422
            ? "Der Entwurf verweist auf etwas, das es nicht mehr gibt (zum Beispiel ein Bild). Prüfe die Bausteine und speichere nochmals."
            : fehler.status === 0 || fehler.status >= 500
              ? "Veröffentlichen hat nicht geklappt. Der Entwurf ist unverändert. Versuche es nochmals."
              : fehlertext(fehler),
      );
      ok.lastChild.textContent = "Nochmals veröffentlichen";
      beschaeftigt(ok, false);
      abbrechen.disabled = false;
    }
  });

  // Laden: Versionen und die veröffentlichte Fassung (für den Vergleich)
  async function lade() {
    try {
      const [{ versionen: liste2 }, veroeff] = await Promise.all([
        anfrage("GET", `${API}/seiten/${k.id}/versionen`),
        k.nr === null || nurVersionen
          ? null
          : anfrage("GET", `${API}/seiten/${k.id}/versionen/${k.nr}`),
      ]);
      zeichne(liste2, veroeff?.dokument ?? null);
    } catch (fehler) {
      aenderungen.replaceChildren();
      aenderungen.removeAttribute("aria-busy");
      versionen.removeAttribute("aria-busy");
      versionen.replaceChildren(
        el("h3", {}, "Versionen"),
        band(
          "fehler",
          `Die Versionen konnten nicht geladen werden. ${fehlertext(fehler)}`,
        ),
        knopf("Nochmals versuchen", {
          klein: true,
          symbol: "aktualisieren",
          onclick: () => {
            versionen.setAttribute("aria-busy", "true");
            lade();
          },
        }),
      );
      sperre("Die Versionen konnten nicht geladen werden.");
    }
  }

  function zeichne(liste2, veroeffentlicht) {
    bereit = true;
    aenderungen.removeAttribute("aria-busy");
    versionen.removeAttribute("aria-busy");
    // Änderungen
    if (nurVersionen) {
      // nichts: Die Zeitleiste steht unten
    } else if (veroeffentlicht === null) {
      aenderungen.replaceChildren(
        el("h3", {}, "Erste Version"),
        el(
          "p",
          { class: "leise" },
          `Die Seite hat ${anzahlText(k.dok.bausteine.length, "1 Baustein", "Bausteine")} und ist noch nicht veröffentlicht.`,
        ),
      );
      ok.removeAttribute("aria-disabled");
      grund.textContent = "";
    } else {
      const punkte = vergleiche(k.dok, veroeffentlicht);
      if (punkte.length === 0) {
        aenderungen.replaceChildren(
          el("h3", {}, "Keine Änderungen"),
          el(
            "p",
            { class: "leise" },
            "Es gibt keine Änderungen seit der letzten Version.",
          ),
        );
        abbrechen.textContent = "Schliessen";
        sperre("Ändere zuerst etwas an der Seite.");
      } else {
        aenderungen.replaceChildren(
          el("h3", {}, anzahlText(punkte.length, "1 Änderung", "Änderungen")),
          el(
            "ul",
            { class: "liste-zeilen" },
            punkte.map((p) => {
              const [wort, klasse, icon] = CHIP[p.art];
              const name = p.baustein
                ? `${typName(p.baustein)}${kurzText(k, p.baustein) ? ` «${kuerze(kurzText(k, p.baustein), 40)}»` : ""}`
                : p.text;
              return el(
                "li",
                {},
                el("span", { class: `chip ${klasse}` }, symbol(icon), wort),
                el("span", { class: "text" }, name),
              );
            }),
          ),
        );
        ok.removeAttribute("aria-disabled");
        grund.textContent = "";
      }
    }
    // Versionen
    if (liste2.length === 0) {
      versionen.replaceChildren(
        el("h3", {}, "Versionen"),
        el(
          "p",
          { class: "leise" },
          "Noch keine Versionen. Die erste entsteht beim Veröffentlichen.",
        ),
      );
      return;
    }
    // Zeitleiste: ein Punkt je Version, die veröffentlichte ist gefüllt und trägt die Marke «Veröffentlicht» (Zustand nie nur über Farbe)
    const eintraege = [];
    if (k.unveroeffentlicht) {
      eintraege.push(
        el(
          "li",
          { class: "ws-zeitpunkt ws-zeitpunkt--entwurf" },
          el("span", { class: "ws-punkt", "aria-hidden": "true" }),
          el(
            "div",
            { class: "text" },
            el("p", { class: "fett" }, "Aktueller Entwurf"),
            el(
              "p",
              { class: "klein leise" },
              "Noch nicht veröffentlicht. Er gilt erst nach «Veröffentlichen».",
            ),
          ),
        ),
      );
    }
    for (const v of liste2) {
      const wann = zeit(v.erstelltAm);
      eintraege.push(
        el(
          "li",
          {
            class: `ws-zeitpunkt${v.veroeffentlicht ? " ws-zeitpunkt--online" : ""}`,
          },
          el("span", { class: "ws-punkt", "aria-hidden": "true" }),
          el(
            "div",
            { class: "text" },
            el("p", { class: "fett" }, wann),
            el(
              "p",
              { class: "klein leise" },
              `Version ${v.nr}`,
              v.veroeffentlicht &&
                el(
                  "span",
                  { class: "chip chip--ok ws-abstand" },
                  symbol("haken"),
                  "Veröffentlicht",
                ),
            ),
          ),
          el(
            "div",
            { class: "ws-zeitaktion" },
            knopf("Vorschau", {
              klein: true,
              "aria-label": `Vorschau: Version vom ${wann}`,
              onclick: () => {
                f.dialog.addEventListener("close", () => k.zeigeVersion(v.nr), {
                  once: true,
                });
                f.schliesse();
              },
            }),
            knopf("Zurückholen", {
              klein: true,
              "aria-label": `Zurückholen: Version vom ${wann}`,
              onclick: () => zurueckholen(v.nr, wann),
            }),
          ),
        ),
      );
    }
    versionen.replaceChildren(
      el("h3", {}, "Versionen"),
      el(
        "ol",
        { class: "ws-zeitleiste", "aria-label": "Versionen, neueste zuerst" },
        eintraege,
      ),
    );
  }

  function zurueckholen(nr, wann) {
    f.dialog.addEventListener(
      "close",
      () =>
        k.ctx.mitRueckgaengig({
          text: `Version vom ${wann.split(",")[0]} als Entwurf zurückgeholt. Veröffentlicht ist sie noch nicht${
            k.unveroeffentlicht
              ? ". Der heutige Entwurf geht dabei verloren, weil er nicht als Version veröffentlicht ist"
              : ""
          }`,
          ausfuehren: async () => {
            await anfrage(
              "POST",
              `${API}/seiten/${k.id}/versionen/${nr}/zurueckholen`,
            );
            await k.neuAusEntwurf();
          },
          fehlertext,
        }),
      { once: true },
    );
    f.schliesse();
  }

  lade();
}

// Seite zurückziehen: nicht mehr online, Entwurf und Versionen bleiben. Mit «Rückgängig» (#578): Erst nach der Frist ist die Seite nicht mehr erreichbar; «Jetzt ausführen und schliessen» im Toast zieht sofort zurück
export function zurueckziehen(k) {
  if (k.nr === null) return;
  k.ctx.mitRueckgaengig({
    text: `Seite «${kuerze(k.dok.titel, 50)}» zurückgezogen. Entwurf und Versionen bleiben, du kannst sie wieder veröffentlichen`,
    ausfuehren: () => anfrage("POST", `${API}/seiten/${k.id}/zurueckziehen`),
    fehlertext,
    danach: () => {
      k.nr = null;
      k.unveroeffentlicht = true;
      k.statusNeu();
    },
  });
}
