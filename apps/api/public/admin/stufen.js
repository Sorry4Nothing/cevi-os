import { anfrage, fehlertext } from "./api.js";
import {
  STANDARD_LOGO,
  ankreuzen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
} from "./dom.js";

const LOGO_MAX_BYTES = 5 * 1024 * 1024;

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      const [stufen, kinder] = await Promise.all([
        anfrage("GET", "/api/v1/stufen"),
        // Die Anzahl ist Beiwerk: ohne sie bleibt die Liste benutzbar
        anfrage("GET", "/api/v1/admin/kinder").catch(() => null),
      ]);
      return { stufen: stufen.stufen, kinder: kinder?.kinder ?? null };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

function felder(stufe) {
  return {
    name: feld({
      label: "Name",
      wert: stufe?.name ?? "",
      maxlength: 100,
      required: true,
    }),
    kuerzel: feld({
      label: "Kürzel",
      wert: stufe?.kuerzel ?? "",
      maxlength: 20,
      required: true,
    }),
    reihenfolge: feld({
      label: "Reihenfolge",
      hilfe:
        "Eine ganze Zahl von 1 bis 999. Stufen mit kleineren Zahlen stehen weiter vorne. Tipp: in Zehnerschritten, dann passt später eine Stufe dazwischen.",
      typ: "number",
      min: 1,
      max: 999,
      step: 1,
      inputmode: "numeric",
      wert: stufe ? String(stufe.reihenfolge) : "",
      required: true,
    }),
    logo: feld({
      label: "Logo (optional)",
      hilfe:
        "JPEG, PNG oder WebP, höchstens 5 MB. Ohne eigenes Logo gilt das Cevi-Logo.",
      typ: "file",
      accept: "image/jpeg,image/png,image/webp",
    }),
    // Nur bei einer Stufe mit Logo
    entfernen: stufe?.logoUrl
      ? ankreuzen({ label: "Eigenes Logo entfernen", wert: "entfernen" })
      : null,
  };
}

function lesen(f) {
  const reihenfolge = Number(f.reihenfolge.eingabe.value);
  if (!Number.isInteger(reihenfolge) || reihenfolge < 1 || reihenfolge > 999) {
    throw new Error("reihenfolge");
  }
  return {
    name: f.name.eingabe.value.trim(),
    kuerzel: f.kuerzel.eingabe.value.trim(),
    reihenfolge,
  };
}

// Ungültige Zahl: gleiche Anzeige wie ein 400 der API
const ungueltig = () => {
  throw Object.assign(new Error("400"), { status: 400, code: "UNGUELTIG" });
};

function dialog({ stufe, ctx, neu }) {
  const f = felder(stufe);
  dialogFormular({
    titel: stufe ? "Stufe bearbeiten" : "Stufe anlegen",
    beschreibung: stufe?.name,
    felder: [
      f.name.wurzel,
      f.kuerzel.wurzel,
      f.reihenfolge.wurzel,
      f.logo.wurzel,
      f.entfernen?.wurzel,
    ].filter(Boolean),
    ok: stufe ? "Speichern" : "Anlegen",
    senden: async () => {
      let body;
      try {
        body = lesen(f);
      } catch {
        return ungueltig();
      }
      const datei = f.logo.eingabe.files[0];
      if (datei && datei.size > LOGO_MAX_BYTES) {
        throw Object.assign(new Error("400"), {
          status: 400,
          code: "LOGO_GROSS",
        });
      }
      const ergebnis = stufe
        ? await anfrage("PATCH", `/api/v1/admin/stufen/${stufe.id}`, body)
        : await anfrage("POST", "/api/v1/admin/stufen", body);
      const id = stufe?.id ?? ergebnis.id;
      const logoPfad = `/api/v1/admin/stufen/${id}/logo`;
      if (datei) await anfrage("PUT", logoPfad, datei);
      else if (f.entfernen?.eingabe.checked) await anfrage("DELETE", logoPfad);
      return ergebnis;
    },
    fehlertext: (fehler) =>
      fehler.code === "UNGUELTIG"
        ? "Die Reihenfolge muss eine ganze Zahl von 1 bis 999 sein."
        : fehler.code === "LOGO_GROSS"
          ? "Das Logo ist grösser als 5 MB."
          : fehlertext(fehler),
    danach: () => {
      neu();
      ctx.melde(stufe ? "Gespeichert." : "Stufe ist angelegt.");
    },
  });
}

function karte(stufe, anzahl, ctx, neu) {
  return el(
    "li",
    { class: "karte stufe-karte" },
    el(
      "span",
      { class: "stufe-nr" },
      el("span", { class: "mini", "aria-hidden": "true" }, "NR."),
      el("span", { class: "nur-leser" }, "Reihenfolge "),
      el("span", { class: "stufe-nr-zahl" }, String(stufe.reihenfolge)),
    ),
    // Dekorativ: Name und Chip daneben nennen schon alles
    el("img", {
      class: "stufe-logo",
      src: stufe.logoUrl ?? STANDARD_LOGO,
      alt: "",
    }),
    el(
      "div",
      { class: "stufe-text" },
      el("h2", { class: "name" }, stufe.name),
      el(
        "ul",
        { class: "chips" },
        chip(`Kürzel ${stufe.kuerzel}`, "stufe"),
        chip(stufe.logoUrl ? "Eigenes Logo" : "Cevi-Logo"),
        anzahl !== null && chip(anzahl === 1 ? "1 Kind" : `${anzahl} Kinder`),
      ),
    ),
    knopf("Bearbeiten", {
      klein: true,
      symbol: "bearbeiten",
      kontext: stufe.name,
      onclick: () => dialog({ stufe, ctx, neu }),
    }),
  );
}

function zeichne(bereich, ctx, { stufen, kinder }, neu) {
  ctx.kopfAktion(
    knopf("Stufe anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: () => dialog({ ctx, neu }),
    }),
  );
  const anzahl = (stufe) =>
    kinder ? kinder.filter((k) => k.stufeId === stufe.id).length : null;
  if (stufen.length === 0) {
    bereich.append(el("p", { class: "leer" }, "Es gibt noch keine Stufen."));
    return;
  }
  bereich.append(
    el(
      "p",
      { class: "meta klein", role: "status" },
      stufen.length === 1 ? "1 Stufe" : `${stufen.length} Stufen`,
    ),
    el(
      "ul",
      { class: "stufenliste", "aria-label": "Stufen" },
      stufen.map((stufe) => karte(stufe, anzahl(stufe), ctx, neu)),
    ),
  );
}
