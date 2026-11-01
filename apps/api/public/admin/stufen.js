import { anfrage, fehlertext } from "./api.js";
import {
  STANDARD_LOGO,
  ankreuzen,
  bestaetigen,
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
      const [stufen, kinder, personen] = await Promise.all([
        anfrage("GET", "/api/v1/stufen"),
        // Die Anzahl und die SL sind Beiwerk: ohne sie bleibt die Liste benutzbar
        anfrage("GET", "/api/v1/admin/kinder").catch(() => null),
        anfrage("GET", "/api/v1/admin/personen").catch(() => null),
      ]);
      return {
        stufen: stufen.stufen,
        kinder: kinder?.kinder ?? null,
        personen: personen?.personen ?? null,
      };
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
  return { name: f.name.eingabe.value.trim() };
}

function dialog({ stufe, ctx, neu }) {
  const f = felder(stufe);
  dialogFormular({
    titel: stufe ? "Stufe bearbeiten" : "Stufe anlegen",
    beschreibung: stufe?.name,
    felder: [f.name.wurzel, f.logo.wurzel, f.entfernen?.wurzel].filter(Boolean),
    ok: stufe ? "Speichern" : "Anlegen",
    senden: async () => {
      const body = lesen(f);
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
      fehler.code === "LOGO_GROSS"
        ? "Das Logo ist grösser als 5 MB."
        : fehlertext(fehler),
    danach: () => {
      neu();
      ctx.melde(stufe ? "Gespeichert." : "Stufe ist angelegt.");
    },
  });
}

function loeschen(stufe, ctx, neu) {
  bestaetigen({
    titel: "Stufe löschen",
    beschreibung: `«${stufe.name}» wird mit Gruppenchat und allen Nachrichten gelöscht. Das lässt sich nicht rückgängig machen. Es geht nur, solange der Stufe keine Kinder oder Leitenden zugewiesen sind.`,
    ok: "Löschen",
    aktion: () => anfrage("DELETE", `/api/v1/admin/stufen/${stufe.id}`),
    danach: () => {
      neu();
      ctx.melde(`«${stufe.name}» ist gelöscht.`);
    },
  });
}

// Die aktiven SL der Stufe, wie die Kontakte sie ordnen: Priorität (ohne zuletzt), dann Name; die Personenliste kommt nach Name
function stufenleitung(personen, stufe) {
  const rolle = (p) =>
    p.rollen.find((r) => r.stufeId === stufe.id && r.typ === "stufenleitung");
  return (personen ?? [])
    .filter((p) => !p.deaktiviert && rolle(p))
    .sort(
      (a, b) =>
        (rolle(a).prioritaet ?? Infinity) - (rolle(b).prioritaet ?? Infinity) ||
        0,
    );
}

function reihenfolge(stufe, sl, ctx, neu) {
  const ids = sl.map((p) => p.id);
  const namen = new Map(sl.map((p) => [p.id, p.name]));
  const liste = el("ol", { class: "sl-reihenfolge" });
  const status = el("p", { class: "meta klein", role: "status" });
  function zeichne(fokus) {
    liste.replaceChildren(
      ...ids.map((id, i) =>
        el(
          "li",
          {},
          el(
            "span",
            { class: "name" },
            namen.get(id),
            i === 0 && " (Hauptkontakt)",
          ),
          knopf("Nach oben", {
            klein: true,
            symbol: "hoch",
            kontext: namen.get(id),
            disabled: i === 0,
            "data-id": id,
            "data-richtung": "oben",
            onclick: () => bewege(id, -1),
          }),
          knopf("Nach unten", {
            klein: true,
            symbol: "runter",
            kontext: namen.get(id),
            disabled: i === ids.length - 1,
            "data-id": id,
            "data-richtung": "unten",
            onclick: () => bewege(id, 1),
          }),
        ),
      ),
    );
    // Der Fokus folgt dem verschobenen Eintrag; am Rand bleibt er beim anderen Knopf
    const knoepfe = [
      ...liste.querySelectorAll(`button[data-id="${fokus?.id}"]`),
    ];
    (
      knoepfe.find(
        (k) => k.dataset.richtung === fokus?.richtung && !k.disabled,
      ) ?? knoepfe.find((k) => !k.disabled)
    )?.focus();
  }
  function bewege(id, schritt) {
    const i = ids.indexOf(id);
    ids.splice(i, 1);
    ids.splice(i + schritt, 0, id);
    status.textContent = `${namen.get(id)} steht jetzt an Position ${i + schritt + 1} von ${ids.length}.`;
    zeichne({ id, richtung: schritt < 0 ? "oben" : "unten" });
  }
  dialogFormular({
    titel: "Reihenfolge der Stufenleitung",
    beschreibung: `${stufe.name}: Die erste Person ist der Hauptkontakt, die weiteren folgen in den Kontakten der App.`,
    felder: [liste, status],
    ok: "Speichern",
    senden: () =>
      anfrage("PUT", `/api/v1/admin/stufen/${stufe.id}/stufenleitung`, { ids }),
    danach: () => {
      neu();
      ctx.melde("Reihenfolge gespeichert.");
    },
  });
  zeichne(null);
}

function karte(stufe, anzahl, sl, ctx, neu) {
  return el(
    "li",
    { class: "karte stufe-karte" },
    el(
      "div",
      { class: "stufe-kopf" },
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
          chip(stufe.logoUrl ? "Eigenes Logo" : "Cevi-Logo"),
          anzahl !== null && chip(anzahl === 1 ? "1 Kind" : `${anzahl} Kinder`),
        ),
      ),
    ),
    sl.length > 0 &&
      el(
        "div",
        { class: "stufe-sl" },
        el("h3", {}, "Stufenleitung"),
        el(
          "ol",
          { class: "sl-liste" },
          sl.map((p) => el("li", {}, p.name)),
        ),
      ),
    el(
      "div",
      { class: "stufe-aktionen" },
      sl.length > 1 &&
        knopf("Reihenfolge", {
          klein: true,
          symbol: "hoch",
          kontext: stufe.name,
          onclick: () => reihenfolge(stufe, sl, ctx, neu),
        }),
      knopf("Bearbeiten", {
        klein: true,
        symbol: "bearbeiten",
        kontext: stufe.name,
        onclick: () => dialog({ stufe, ctx, neu }),
      }),
      knopf("Löschen", {
        klein: true,
        art: "gefahr",
        symbol: "papierkorb",
        kontext: stufe.name,
        onclick: () => loeschen(stufe, ctx, neu),
      }),
    ),
  );
}

function zeichne(bereich, ctx, { stufen, kinder, personen }, neu) {
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
      stufen.map((stufe) =>
        karte(stufe, anzahl(stufe), stufenleitung(personen, stufe), ctx, neu),
      ),
    ),
  );
}
