import { anfrage, fehlertext } from "./api.js";
import { ankreuzen, el, feld, gruppe, icon } from "./dom.js";
import { zweiStufig } from "./rueckgaengig.js";

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

  const senden = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt" },
    icon("glocke"),
    "Senden",
  );
  const formular = el(
    "form",
    { class: "formular karte mitteilung", novalidate: true },
    titel.wurzel,
    beschreibung.wurzel,
    gruppe("Empfänger", [
      alle.wurzel,
      el(
        "div",
        { class: "mt-auswahl" },
        boxen.map((b) => b.wurzel),
      ),
    ]),
    gruppe(
      "Rollen",
      el(
        "div",
        { class: "mt-auswahl" },
        rollen.map((r) => r.wurzel),
      ),
    ),
    fehler,
    el("div", { class: "dialog-knoepfe" }, senden),
  );

  // Vorschau: So sieht der Push aus, und an wen er geht. Sie wächst mit den Eingaben mit und ersetzt den langen Hinweistext über dem Formular.
  const vorschauTitel = el("p", { class: "mt-push-titel" });
  const vorschauText = el("p", { class: "mt-push-text" });
  const vorschauWer = el("dd");
  const vorschauRollen = el("dd");
  const zeichneVorschau = () => {
    const t = titel.eingabe.value.trim();
    const b = beschreibung.eingabe.value.trim();
    vorschauTitel.textContent = t || "Titel der Mitteilung";
    vorschauTitel.classList.toggle("mt-push-leer", !t);
    vorschauText.textContent = b;
    vorschauText.hidden = !b;
    const stufenNamen = boxen
      .filter((x) => x.eingabe.checked)
      .map((x) => stufen.find((s) => s.id === x.eingabe.value).name);
    vorschauWer.textContent = alle.eingabe.checked
      ? "Alle aktiven Konten der Abteilung"
      : stufenNamen.length > 0
        ? stufenNamen.join(", ")
        : "Noch niemand gewählt";
    const gewaehlt = rollen.filter((r) => r.eingabe.checked);
    vorschauRollen.textContent =
      gewaehlt.length === rollen.length
        ? "Alle Rollen"
        : gewaehlt.length > 0
          ? gewaehlt
              .map((r) => r.label.replace(" (Teilnehmende)", ""))
              .join(", ")
          : "Keine Rolle gewählt";
  };
  for (const eingabe of [
    titel.eingabe,
    beschreibung.eingabe,
    alle.eingabe,
    ...boxen.map((x) => x.eingabe),
    ...rollen.map((r) => r.eingabe),
  ]) {
    eingabe.addEventListener("input", zeichneVorschau);
    eingabe.addEventListener("change", zeichneVorschau);
  }
  zeichneVorschau();
  const vorschau = [
    el(
      "div",
      { class: "mt-push", "aria-hidden": "true" },
      el("p", { class: "mt-push-app" }, "Cevi OS"),
      vorschauTitel,
      vorschauText,
    ),
    el(
      "dl",
      { class: "werte" },
      el("div", {}, el("dt", {}, "Geht an"), vorschauWer),
      el("div", {}, el("dt", {}, "Rollen"), vorschauRollen),
    ),
    el(
      "p",
      { class: "hilfe" },
      "Die Mitteilung geht als Push an die Geräte der gewählten Gruppe. Bei einer Stufe erreicht sie die gewählten Rollen: die Stufenleitung, die Leitenden und die Eltern aktiver Kinder. Sind alle Rollen gewählt, bekommst du sie auch. Wer «Mitteilungen» in der App ausgeschaltet hat, bekommt sie nicht.",
    ),
  ];
  // Eine gesendete Mitteilung lässt sich nicht zurückholen und trifft sofort andere: kein Rückgängig mit Frist, sondern zwei Stufen im Knopf statt eines Popups (#578)
  const zweiter = zweiStufig(senden);

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
    // Ändert sich der Text der Frage (andere Empfänger), gilt der nächste Klick wieder als erster
    zweiter.verlange(
      `Wirklich an ${wohin} senden?`,
      async () => {
        senden.disabled = true;
        senden.setAttribute("aria-busy", "true");
        try {
          const ergebnis = await anfrage(
            "POST",
            "/api/v1/admin/mitteilungen",
            body,
          );
          titel.eingabe.value = "";
          beschreibung.eingabe.value = "";
          alle.eingabe.checked = false;
          for (const b of boxen) b.eingabe.checked = false;
          sperre();
          zeichneVorschau();
          ctx.melde(`Mitteilung gesendet an ${ANZAHL(ergebnis.empfaenger)}.`);
        } catch (f) {
          zeigeFehler(fehlertext(f));
        } finally {
          senden.disabled = false;
          senden.removeAttribute("aria-busy");
        }
      },
      JSON.stringify(body),
    );
  });

  // Zwei Spalten ohne eigene Scrollbereiche: Das Formular ist kurz, zwei Rollbereiche würden hier stören; die Vorschau bleibt beim Scrollen stehen
  bereich.append(
    el(
      "div",
      { class: "mt-raster" },
      formular,
      el(
        "aside",
        { class: "mt-vorschau panel", "aria-labelledby": "mt-vorschau-titel" },
        el("h2", { id: "mt-vorschau-titel" }, "Vorschau"),
        ...vorschau,
      ),
    ),
  );
}
