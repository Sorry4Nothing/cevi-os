import { anfrage } from "./api.js";
import { ankreuzen, bestaetigen, el, feld, gruppe, icon } from "./dom.js";

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => (await anfrage("GET", "/api/v1/stufen")).stufen,
    (stufen) => zeichne(bereich, ctx, stufen),
  );
}

// Eltern sind die Teilnehmenden: Kinder haben kein Konto
const ROLLEN = [
  ["stufenleitung", "Stufenleitung"],
  ["leitung", "Leitende"],
  ["eltern", "Eltern (Teilnehmende)"],
];

const ANZAHL = (n) => (n === 1 ? "1 Konto" : `${n} Konten`);

function zeichne(bereich, ctx, stufen) {
  const titel = feld({
    label: "Titel",
    hilfe:
      "Die fette Zeile der Mitteilung. Schreibe keine Namen hinein: Der Text läuft über Apple und Google.",
    maxlength: 100,
    required: true,
    autocomplete: "off",
  });
  const beschreibung = feld({
    label: "Beschreibung (optional)",
    hilfe: "Steht unter dem Titel. Auch hier keine Namen schreiben.",
    mehrzeilig: true,
    rows: 3,
    maxlength: 300,
  });
  const alle = ankreuzen({
    label: "Alle aktiven Konten der Abteilung",
    wert: "alle",
  });
  const boxen = stufen.map((s) => ankreuzen({ label: s.name, wert: s.id }));
  const rollen = ROLLEN.map(([wert, label]) => ({
    wert,
    label,
    ...ankreuzen({ label, wert }),
  }));
  for (const r of rollen) r.eingabe.checked = true;
  // «Alle» schliesst die einzelnen Stufen aus
  const sperre = () => {
    for (const b of boxen) {
      b.eingabe.disabled = alle.eingabe.checked;
      if (alle.eingabe.checked) b.eingabe.checked = false;
    }
  };
  alle.eingabe.addEventListener("change", sperre);

  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const zeigeFehler = (text) => {
    fehler.textContent = text;
    fehler.hidden = false;
    fehler.focus();
  };

  const formular = el(
    "form",
    { class: "formular karte mitteilung", novalidate: true },
    el(
      "p",
      { class: "hinweis" },
      "Die Mitteilung geht als Push an die Geräte der gewählten Gruppe. Bei einer Stufe erreicht sie die gewählten Rollen: die Stufenleitung, die Leitenden und die Eltern aktiver Kinder. Sind alle Rollen gewählt, bekommst du sie auch. Wer «Mitteilungen» in der App ausgeschaltet hat, bekommt sie nicht.",
    ),
    titel.wurzel,
    beschreibung.wurzel,
    gruppe("Empfänger", [alle.wurzel, ...boxen.map((b) => b.wurzel)], {
      scrollen: true,
    }),
    gruppe(
      "Rollen",
      rollen.map((r) => r.wurzel),
    ),
    fehler,
    el(
      "div",
      { class: "dialog-knoepfe" },
      el(
        "button",
        { type: "submit", class: "knopf knopf--haupt" },
        icon("glocke"),
        "Senden",
      ),
    ),
  );

  formular.addEventListener("submit", (ereignis) => {
    ereignis.preventDefault();
    fehler.hidden = true;
    for (const alt of titel.wurzel.querySelectorAll(".feld-fehler"))
      alt.remove();
    titel.eingabe.removeAttribute("aria-invalid");
    const text = titel.eingabe.value.trim();
    if (!text) {
      const meldung = el(
        "p",
        {
          class: "feld-fehler",
          id: `${titel.eingabe.id}-fehler`,
          role: "alert",
        },
        "Bitte ausfüllen.",
      );
      titel.wurzel.append(meldung);
      titel.eingabe.setAttribute("aria-invalid", "true");
      titel.eingabe.focus();
      return;
    }
    const beschreibungText = beschreibung.eingabe.value.trim();
    const gewaehlt = boxen.filter((b) => b.eingabe.checked);
    if (!alle.eingabe.checked && gewaehlt.length === 0) {
      zeigeFehler("Wähle «Alle» oder mindestens eine Stufe.");
      return;
    }
    const gewaehlteRollen = rollen.filter((r) => r.eingabe.checked);
    if (gewaehlteRollen.length === 0) {
      zeigeFehler("Wähle mindestens eine Rolle.");
      return;
    }
    // Alle Rollen sind keine Einschränkung: dann bleibt die Angabe weg
    const alleRollen = gewaehlteRollen.length === rollen.length;
    const body = {
      titel: text,
      ...(beschreibungText && { beschreibung: beschreibungText }),
      ...(alle.eingabe.checked
        ? { empfaenger: "alle" }
        : {
            empfaenger: "stufen",
            stufeIds: gewaehlt.map((b) => b.eingabe.value),
          }),
      ...(!alleRollen && { rollen: gewaehlteRollen.map((r) => r.wert) }),
    };
    const wer = alleRollen
      ? ""
      : ` (${gewaehlteRollen.map((r) => r.label.replace(" (Teilnehmende)", "")).join(", ")})`;
    const wohin =
      (alle.eingabe.checked
        ? alleRollen
          ? "alle aktiven Konten"
          : "alle Stufen"
        : gewaehlt.length === 1
          ? `die Stufe «${stufen.find((s) => s.id === gewaehlt[0].eingabe.value).name}»`
          : `${gewaehlt.length} Stufen`) + wer;
    bestaetigen({
      titel: "Mitteilung senden",
      beschreibung: `«${text}»${beschreibungText ? ` mit der Beschreibung «${beschreibungText}»` : ""} geht als Push an ${wohin}. Das lässt sich nicht zurückholen.`,
      ok: "Senden",
      gefaehrlich: false,
      aktion: () => anfrage("POST", "/api/v1/admin/mitteilungen", body),
      danach: (ergebnis) => {
        titel.eingabe.value = "";
        beschreibung.eingabe.value = "";
        alle.eingabe.checked = false;
        for (const b of boxen) b.eingabe.checked = false;
        sperre();
        ctx.melde(`Mitteilung gesendet an ${ANZAHL(ergebnis.empfaenger)}.`);
      },
    });
  });

  bereich.append(formular);
}
