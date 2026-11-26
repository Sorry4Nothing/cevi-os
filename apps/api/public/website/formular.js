// Formular der Website (#819, Baustein «formular»): prüft die Eingaben beim Absenden und schickt sie als JSON an POST /api/v1/formulare/<Baustein>/antworten. Das Markup steht schon in der Seite (formular.ts); dieses Skript macht es bedienbar.
// Der Server prüft alles noch einmal gegen die veröffentlichte Definition: Was hier geprüft wird, ist nur die Hilfe für die Person. Eingaben bleiben bei jedem Fehler stehen.
// Barrierefreiheit: Fehler stehen am Feld (Text mit Symbol) und oben in einer Zusammenfassung mit Links, die beim Absenden den Fokus bekommt; der Knopf bleibt aktiv und sagt «Sende …» (aria-busy); nach dem Senden bekommt die Meldung «gesendet» (Statusregion) den Fokus.
// Formulare, die später dazukommen (geschützte Bausteine, die geschuetzt.js nachlädt), rüstet ein MutationObserver aus. Text kommt nur als Textknoten ins Dokument, nie als HTML.
import { band, el, holeMitFrist, symbol } from "./ui.js";
import { toast } from "./toast.js";
// «datumVon» liest das Datum, der Kalender steht daneben (#887)
import { datumVon, verbessereDatum } from "./datum.js";
// Eigenes Auswahlfeld der Website (#887): stellt jedes <select> um, auch in Formularen, die geschuetzt.js nachlädt
import "./auswahl.js";

const API = "/api/v1/formulare";
const zuerichHeute = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
    new Date(),
  );

// Was die Server-Codes für ein Feld heissen (Antwort 422)
const FEHLER = {
  PFLICHT: "Diese Angabe fehlt.",
  TYP: "Diese Angabe passt nicht.",
  FORMAT: "Diese Angabe hat ein falsches Format.",
  ZU_LANG: "Diese Angabe ist zu lang.",
  ZU_KURZ: "Diese Angabe ist zu kurz.",
  BEREICH: "Diese Angabe liegt ausserhalb des erlaubten Bereichs.",
  OPTION: "Wähle eine Antwort aus der Liste.",
  ANZAHL: "Wähle weniger oder mehr Antworten.",
  STEUERZEICHEN: "Diese Angabe enthält Zeichen, die nicht erlaubt sind.",
  UNBEKANNT: "Diese Angabe gehört nicht zum Formular.",
};
const PFLICHT_TEXT = {
  auswahl: "Wähle eine Antwort.",
  optionsfelder: "Wähle eine Antwort.",
  mehrfachwahl: "Wähle mindestens eine Antwort.",
  janein: "Wähle Ja oder Nein.",
  zustimmung: "Stimme zu, um die Antwort zu senden.",
};

const zahlVon = (text) => {
  const t = text.replace(/['’\s]/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function startFormular(wurzel) {
  if (wurzel.dataset.bereit) return;
  wurzel.dataset.bereit = "1";
  const form = wurzel.querySelector("form");
  const meldung = wurzel.querySelector(".bf-meldung");
  const danke = wurzel.querySelector(".bf-danke");
  if (!form || !meldung || !danke) return;
  const formularId = wurzel.dataset.formular;
  const beginn = window.performance.now();
  let beschaeftigt = false;

  // Jedes Feld: Element mit data-typ (Eingabe, Auswahl, Gruppe, Kästchen) und seine Hülle
  const felder = [...form.querySelectorAll("[data-typ]")].map((e) => {
    const gruppe = e.tagName === "FIELDSET";
    const eingabe = gruppe ? e.querySelector("input") : e;
    return {
      typ: e.getAttribute("data-typ"),
      el: e,
      eingabe,
      gruppe,
      name: eingabe.name,
      huelle: gruppe ? e : e.closest(".feld, .bf-zustimmung"),
      pflicht: gruppe
        ? e.getAttribute("data-pflicht") === "1"
        : e.required === true,
    };
  });
  const nachName = new Map(felder.map((f) => [f.name, f]));
  const beschriftung = (f) => {
    const t = f.gruppe
      ? f.el.querySelector("legend")
      : form.querySelector(`label[for="${f.eingabe.id}"]`);
    return (t?.textContent ?? "").replace(/\s*\(optional\)\s*$/, "").trim();
  };

  const geschlossen = () => {
    form.hidden = true;
    meldung.replaceChildren(
      band("wa", "Dieses Formular ist geschlossen.", "", "warnung"),
    );
  };
  if (wurzel.dataset.schliesst && zuerichHeute() > wurzel.dataset.schliesst) {
    geschlossen();
    return;
  }
  for (const f of felder) {
    if (f.typ === "datum") verbessereDatum(f.eingabe, beschriftung(f));
  }

  // Wert für den Server und ein Fehlercode (oder null), nur was sich ohne den Server prüfen lässt
  function lese(f) {
    const e = f.el;
    switch (f.typ) {
      case "optionsfelder": {
        const w = f.el.querySelector("input:checked")?.value;
        return { wert: w };
      }
      case "mehrfachwahl": {
        const liste = [...f.el.querySelectorAll("input:checked")].map(
          (i) => i.value,
        );
        const min = Number(f.el.dataset.min) || 1;
        const max = Number(f.el.dataset.max) || Infinity;
        return {
          wert: liste.length > 0 ? liste : undefined,
          fehler:
            liste.length > 0 && (liste.length < min || liste.length > max)
              ? `Wähle ${max === Infinity ? `mindestens ${min}` : min === max ? `genau ${min}` : `${min} bis ${max}`} Antworten.`
              : null,
        };
      }
      case "janein": {
        const w = f.el.querySelector("input:checked")?.value;
        return { wert: w === undefined ? undefined : w === "ja" };
      }
      case "zustimmung":
        return { wert: e.checked ? true : undefined };
      case "zahl": {
        const t = e.value.trim();
        if (t === "") return { wert: undefined };
        const n = zahlVon(t);
        if (n === null)
          return { fehler: "Gib eine Zahl ein, zum Beispiel 12." };
        if (e.dataset.ganz && !Number.isInteger(n)) {
          return { fehler: "Gib eine ganze Zahl ein, zum Beispiel 12." };
        }
        const min = e.dataset.min === undefined ? null : Number(e.dataset.min);
        const max = e.dataset.max === undefined ? null : Number(e.dataset.max);
        if ((min !== null && n < min) || (max !== null && n > max)) {
          return {
            fehler:
              min !== null && max !== null
                ? `Die Zahl muss zwischen ${min} und ${max} liegen.`
                : min !== null
                  ? `Die Zahl muss mindestens ${min} sein.`
                  : `Die Zahl darf höchstens ${max} sein.`,
          };
        }
        return { wert: n };
      }
      default: {
        const t = e.value.trim();
        if (t === "") return { wert: undefined };
        if (f.typ === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) {
          return {
            fehler: "Gib eine E-Mail-Adresse wie name@beispiel.ch ein.",
          };
        }
        if (
          f.typ === "telefon" &&
          (!/^\+?[0-9 ()./-]{6,30}$/.test(t) || t.replace(/\D/g, "").length < 6)
        ) {
          return {
            fehler: "Gib eine Telefonnummer wie 079 123 45 67 ein.",
          };
        }
        if (f.typ === "datum") {
          const d = datumVon(t);
          if (d === null) {
            return { fehler: "Gib ein Datum wie 31.12.2026 ein." };
          }
          if (
            (e.dataset.min && d < e.dataset.min) ||
            (e.dataset.max && d > e.dataset.max)
          ) {
            return { fehler: "Dieses Datum ist nicht möglich." };
          }
          return { wert: d };
        }
        if (e.minLength > 0 && t.length < e.minLength) {
          return { fehler: `Schreibe mindestens ${e.minLength} Zeichen.` };
        }
        return { wert: t };
      }
    }
  }

  // Der Fehlertext eines Feldes, oder null
  function pruefe(f) {
    const { wert, fehler } = lese(f);
    if (fehler) return { fehler };
    if (wert === undefined && f.pflicht) {
      return { fehler: PFLICHT_TEXT[f.typ] ?? "Diese Angabe fehlt." };
    }
    return { wert };
  }

  function zeigeFehler(f, text) {
    loescheFehler(f);
    const p = el("p", "fehlertext", symbol("warnung"), text);
    p.id = `${f.eingabe.id}-f`;
    f.huelle.classList.add("fehler");
    f.huelle.append(p);
    const ziel = f.gruppe ? f.el : f.eingabe;
    ziel.setAttribute("aria-invalid", "true");
    const alt = (ziel.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((x) => x && x !== p.id);
    ziel.setAttribute("aria-describedby", [...alt, p.id].join(" "));
  }
  function loescheFehler(f) {
    const ziel = f.gruppe ? f.el : f.eingabe;
    const id = `${f.eingabe.id}-f`;
    f.huelle.querySelector(`[id="${id}"]`)?.remove();
    f.huelle.classList.remove("fehler");
    ziel.removeAttribute("aria-invalid");
    const rest = (ziel.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((x) => x && x !== id);
    if (rest.length > 0) ziel.setAttribute("aria-describedby", rest.join(" "));
    else ziel.removeAttribute("aria-describedby");
  }

  // Oben eine Zusammenfassung mit Links auf die Felder; sie bekommt den Fokus und wird angesagt (role=alert)
  function zeigeZusammenfassung(liste) {
    const ul = el("ul", "");
    for (const [f, text] of liste) {
      const a = el("a", "", `${beschriftung(f) || "Angabe"}: ${text}`);
      a.href = `#${f.eingabe.id}`;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        f.eingabe.focus();
      });
      ul.append(el("li", "", a));
    }
    const b = el(
      "div",
      "band fe zusammenfassung",
      symbol("warnung"),
      el(
        "div",
        "text",
        el(
          "strong",
          "",
          liste.length === 1
            ? "1 Angabe prüfen"
            : `${liste.length} Angaben prüfen`,
        ),
        ul,
      ),
    );
    b.setAttribute("role", "alert");
    b.tabIndex = -1;
    meldung.replaceChildren(b);
    b.focus();
  }

  function zeigeBand(text) {
    const b = band("fe", text, "", "warnung");
    b.setAttribute("role", "alert");
    meldung.replaceChildren(b);
  }

  function laeuft(an) {
    beschaeftigt = an;
    const knopf = form.querySelector("button[type=submit]");
    if (an) {
      knopf.dataset.text = knopf.textContent;
      knopf.setAttribute("aria-disabled", "true");
      knopf.setAttribute("aria-busy", "true");
      const spinner = el("span", "lade");
      spinner.setAttribute("aria-hidden", "true");
      knopf.replaceChildren(spinner, "Sende …");
    } else {
      knopf.removeAttribute("aria-disabled");
      knopf.removeAttribute("aria-busy");
      knopf.replaceChildren(knopf.dataset.text);
    }
  }

  // Nach einem Fehler gilt die Prüfung live: Die Meldung verschwindet, sobald es stimmt
  for (const f of felder) {
    const pruefeLive = () => {
      if (f.huelle.classList.contains("fehler")) {
        const { fehler } = pruefe(f);
        if (!fehler) loescheFehler(f);
      }
    };
    f.el.addEventListener("input", pruefeLive);
    f.el.addEventListener("change", pruefeLive);
  }
  // Beim Verlassen des Feldes (blur) prüfen, nie beim ersten Tippen
  for (const f of felder) {
    if (f.gruppe || f.typ === "zustimmung") continue;
    f.el.addEventListener("blur", () => {
      const { fehler } = pruefe(f);
      if (fehler && f.el.value.trim() !== "") zeigeFehler(f, fehler);
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (beschaeftigt) return;
    meldung.replaceChildren();
    const antworten = {};
    const fehlende = [];
    for (const f of felder) {
      loescheFehler(f);
      const { wert, fehler } = pruefe(f);
      if (fehler) {
        zeigeFehler(f, fehler);
        fehlende.push([f, fehler]);
      } else if (wert !== undefined) {
        antworten[f.name] = wert;
      }
    }
    if (fehlende.length > 0) {
      zeigeZusammenfassung(fehlende);
      return;
    }
    laeuft(true);
    let antwort;
    let daten;
    try {
      antwort = await holeMitFrist(`${API}/${formularId}/antworten`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          antworten,
          homepage: form.querySelector("[name=homepage]")?.value ?? "",
          dauerMs: Math.round(window.performance.now() - beginn),
        }),
      });
      daten = await antwort.json().catch(() => null);
    } catch {
      laeuft(false);
      toast(
        "Keine Verbindung. Prüfe dein Internet und sende nochmals.",
        "fehler",
      );
      return;
    }
    laeuft(false);
    if (antwort.status === 201) {
      // Erst die Meldung bauen, dann das Formular ausblenden: Schlägt der Bau fehl, bleibt das Formular stehen
      danke.replaceChildren(
        el(
          "div",
          "band ok",
          symbol("info"),
          el(
            "div",
            "text",
            el("strong", "", "Gesendet"),
            danke.dataset.danke ?? "",
          ),
        ),
      );
      form.hidden = true;
      meldung.replaceChildren();
      danke.tabIndex = -1;
      danke.focus();
      return;
    }
    if (antwort.status === 422 && Array.isArray(daten?.fehler)) {
      const liste = [];
      for (const x of daten.fehler) {
        const f = nachName.get(x?.feld);
        if (f) {
          const text = FEHLER[x.code] ?? "Diese Angabe passt nicht.";
          zeigeFehler(f, text);
          liste.push([f, text]);
        }
      }
      if (liste.length > 0) zeigeZusammenfassung(liste);
      else zeigeBand(daten.message ?? "Die Antwort passt nicht.");
      return;
    }
    if (antwort.status === 429) {
      toast("Zu viele Versuche. Warte kurz und sende nochmals.", "fehler");
      return;
    }
    if (antwort.status === 410) {
      geschlossen();
      return;
    }
    if (antwort.status === 404 || antwort.status === 401) {
      zeigeBand(
        "Das Formular lässt sich nicht senden. Lade die Seite neu oder melde dich an.",
      );
      return;
    }
    // 409 (schon beantwortet, voll), 422 (zu schnell), 423 und 503 tragen einen Text des Servers
    zeigeBand(
      typeof daten?.message === "string"
        ? daten.message
        : "Das hat nicht geklappt. Versuche es in ein paar Minuten nochmals.",
    );
  });
}

function alleStarten() {
  document.querySelectorAll(".bformular").forEach(startFormular);
}
alleStarten();
if (typeof MutationObserver === "function") {
  new MutationObserver((liste) => {
    if (liste.some((m) => m.addedNodes.length > 0)) alleStarten();
  }).observe(document.body, { childList: true, subtree: true });
}
