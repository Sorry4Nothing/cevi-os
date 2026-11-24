import { fehlertext } from "./api.js";
import {
  auswahl,
  avatar,
  dialogFormular,
  el,
  feld,
  icon,
  knopf,
} from "./dom.js";
import { suchWahl } from "./personen-wahl.js";
import { siehtAlles } from "./sicht.js";
import { ansichtVon } from "./rueckgaengig.js";
import {
  entzieheGlobaleRolle,
  legeGlobaleRolleAn,
  legeRolleAn,
  loescheRolle,
  ordneZu,
  vergebeGlobaleRolle,
} from "./rechte-api.js";
import {
  bestaetigeAmOrt,
  kandidatVon,
  personen as personenText,
} from "./rechte-gemeinsam.js";
import { rechteFehlerText, zuteilungText } from "./rechte-modell.js";

// Rollen anlegen, umbenennen, löschen und Personen zuordnen (#651): die Teile, die Gruppenrollen und globale Rollen gemeinsam haben. Alles wirkt sofort (mit Rückgängig oder Rückfrage am Ort), nur die Rechte selbst laufen über den Entwurf.

const text = (f) => rechteFehlerText(f, fehlertext(f));

// Seite im Fluss: neue Rolle (art «gruppe» mit tagId oder «global»), mit Name, Beschreibung und optional den Rechten einer bestehenden Rolle als Startpunkt
// optionen: { art, gruppe?, rollen (Vorlagen), start? ({ name, beschreibung, rechte }), danach(neueId) }
export function neueRolleSeite(z, { art, gruppe, rollen, start, danach }) {
  const name = feld({
    label: "Name",
    wert: start?.name ?? "",
    maxlength: 50,
    required: true,
    "aria-required": "true",
    hilfe:
      "Zum Beispiel «Kasse». Jede Rolle hat in ihrer Gruppe einen eigenen Namen.",
  });
  const beschreibung =
    art === "gruppe"
      ? feld({
          label: "Beschreibung (optional)",
          wert: start?.beschreibung ?? "",
          mehrzeilig: true,
          maxlength: 300,
          rows: 3,
          hilfe: "Wofür ist die Rolle da? Höchstens 300 Zeichen.",
        })
      : null;
  const vorlage = auswahl({
    label: "Mit diesen Rechten beginnen",
    optionen: [
      ["", start ? "Die vorgeschlagenen Rechte" : "Ohne Rechte"],
      ...rollen.map((r) => [r.id, `Rechte von «${r.name}» übernehmen`]),
    ],
    wert: "",
  });
  return dialogFormular({
    titel: art === "gruppe" ? "Neue Rolle in der Gruppe" : "Neue Rolle",
    beschreibung:
      "Du stellst die Rechte danach in der Matrix ein. Bis du sie speicherst, hat die Rolle nur, was du hier wählst.",
    felder: [name.wurzel, beschreibung?.wurzel, vorlage.wurzel].filter(Boolean),
    ok: "Rolle anlegen",
    fehlertext: text,
    senden: async () => {
      const quelle = rollen.find((r) => r.id === vorlage.eingabe.value);
      const rechte = quelle ? quelle.rechte : (start?.rechte ?? []);
      if (art === "gruppe") {
        return legeRolleAn(gruppe.id, {
          name: name.eingabe.value.trim(),
          beschreibung: beschreibung.eingabe.value.trim() || null,
          rechte,
        });
      }
      return legeGlobaleRolleAn({
        name: name.eingabe.value.trim(),
        rechte: rechte.map((r) => r.recht),
      });
    },
    danach: (antwort) => {
      z.ctx.melde(`Rolle «${name.eingabe.value.trim()}» ist angelegt.`);
      danach?.(antwort?.id);
    },
  });
}

// Seite im Fluss: Name und Beschreibung ändern (eingebaute Rollen behalten ihren Namen)
export function rolleBearbeitenSeite(z, rolle, { aendere, danach }) {
  const name = feld({
    label: "Name",
    wert: rolle.name,
    maxlength: 50,
    required: true,
    "aria-required": "true",
    ...(rolle.system && { disabled: true }),
    hilfe: rolle.system
      ? "Eine eingebaute Rolle behält ihren Namen."
      : undefined,
  });
  const beschreibung =
    rolle.art === "gruppe"
      ? feld({
          label: "Beschreibung (optional)",
          wert: rolle.beschreibung ?? "",
          mehrzeilig: true,
          maxlength: 300,
          rows: 3,
        })
      : null;
  return dialogFormular({
    titel: `«${rolle.name}» bearbeiten`,
    felder: [name.wurzel, beschreibung?.wurzel].filter(Boolean),
    ok: "Speichern",
    fehlertext: text,
    senden: async () => {
      const felder = { version: rolle.version };
      if (!rolle.system) felder.name = name.eingabe.value.trim();
      if (beschreibung) {
        felder.beschreibung = beschreibung.eingabe.value.trim() || null;
      }
      if (Object.keys(felder).length === 1) return null;
      return aendere(felder);
    },
    danach: () => {
      z.ctx.melde("Gespeichert.");
      danach?.();
    },
  });
}

// Löschen mit Folgenanzeige am Ort: wer die Rolle verliert, welche Rechte mitgehen
export function rolleLoeschenFrage(z, rolle, { ort, ausloeser, danach }) {
  const n = rolle.personen.length;
  const rechte = rolle.rechte.map((x) => zuteilungText(x, z.klartext));
  const folge = [
    n === 0
      ? "Niemand trägt die Rolle."
      : `${personenText(n)} verlieren die Rolle ${rolle.art === "gruppe" ? "und bleiben in der Gruppe" : ""}.`,
    rechte.length === 0
      ? "Sie hat keine Rechte."
      : `Mit ihr gehen diese Rechte: ${rechte.join(", ")}.`,
    z.entwurf.has(rolle.id)
      ? "Deine ungespeicherten Änderungen daran sind weg."
      : "",
    "Das lässt sich nicht rückgängig machen.",
  ]
    .filter(Boolean)
    .join(" ");
  bestaetigeAmOrt(ort, {
    text: `«${rolle.name}» löschen? ${folge}`,
    ok: "Rolle löschen",
    zurueckFokus: ausloeser,
    aktion: async () => {
      try {
        await loescheRolle(rolle);
        z.vergissRolle(rolle);
        z.ctx.melde(`Rolle «${rolle.name}» ist gelöscht.`);
        danach();
      } catch (f) {
        z.ctx.melde(text(f), "fehler");
        if (f.code === "VERSION_KONFLIKT") z.neu();
      }
    },
  });
}

// ---------- Personen der Rolle ----------

// rolle: Gruppen- oder globale Rolle; mitglieder: Map userId -> Rolle-Kennung in der Gruppe (nur Gruppenrollen); schreibgeschuetzt: Text, warum die Zuordnung hier nicht geht
export function personenBlock(
  z,
  rolle,
  { mitglieder = new Map(), schreibgeschuetzt },
) {
  const { ctx } = z;
  const titelId = `rr-personen-${rolle.id}`;
  const liste = el("ul", {
    class: "rr-personenliste",
    "aria-labelledby": titelId,
  });
  const wurzel = el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": titelId },
    el("h3", { id: titelId }, `Personen mit der Rolle «${rolle.name}»`),
  );
  const namenVon = new Map(z.personen.map((p) => [p.id, p]));
  const entzieht = rolle.art === "global" ? entzieheGlobaleRolle : null;

  const zeile = (p) => {
    const person = namenVon.get(p.id) ?? { id: p.id, name: p.name };
    const li = el(
      "li",
      { class: "rr-personzeile", "data-id": p.id },
      el(
        "div",
        { class: "wer" },
        avatar(person.name, { hell: true, bildUrl: person.bildUrl }),
        el(
          "div",
          {},
          el("span", { class: "name" }, person.name),
          siehtAlles(person) &&
            el(
              "span",
              { class: "klein leise" },
              person.abteilungsleitung
                ? "Abteilungsleitung, hat ohnehin alles"
                : "Entwickler, hat ohnehin alles",
            ),
        ),
      ),
    );
    if (!schreibgeschuetzt) {
      li.append(
        knopf("Entziehen", {
          klein: true,
          art: "still",
          symbol: "schliessen",
          kontext: person.name,
          onclick: () =>
            ctx.mitRueckgaengig({
              text: `«${person.name}» ist nicht mehr «${rolle.name}».`,
              ansicht: ansichtVon(li),
              ausfuehren: () =>
                entzieht
                  ? entzieht(rolle.id, p.id)
                  : ordneZu(rolle.tagId, p.id, null, { mitglied: true }),
              danach: () => z.neu(),
              fehlertext: text,
            }),
        }),
      );
    }
    return li;
  };
  liste.append(
    ...(rolle.personen.length > 0
      ? rolle.personen.map(zeile)
      : [el("li", { class: "rr-keiner leise" }, "Noch niemand.")]),
  );
  wurzel.append(liste);

  if (schreibgeschuetzt) {
    wurzel.append(el("p", { class: "klein leise" }, schreibgeschuetzt));
    return wurzel;
  }

  // Zuordnen: Suche mit Mehrfachauswahl. Wer in der Gruppe schon eine andere Rolle hat, behält höchstens die neue (eine Rolle je Gruppe)
  const hat = new Set(rolle.personen.map((p) => p.id));
  const kandidaten = z.personen
    .filter((p) => !p.deaktiviert && !hat.has(p.id))
    .map((p) => {
      const k = kandidatVon(p);
      const andere = mitglieder.get(p.id);
      if (andere?.rolleName) {
        k.zusatz = [k.zusatz, `heute «${andere.rolleName}»`]
          .filter(Boolean)
          .join(" · ");
      } else if (rolle.art === "gruppe" && !andere) {
        k.zusatz = [k.zusatz, "noch nicht in der Gruppe"]
          .filter(Boolean)
          .join(" · ");
      }
      return k;
    });
  const wahl = suchWahl({
    titel: "Personen zuordnen",
    beschriftung: "Person suchen",
    kandidaten,
    leerText: "Alle Personen haben die Rolle schon.",
    keinerText: "Noch niemand gewählt.",
  });
  const zuordnen = knopf("Zuordnen", { art: "haupt", symbol: "plus" });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    tabindex: "-1",
    hidden: true,
  });
  zuordnen.addEventListener("click", async () => {
    const ids = wahl.wert();
    if (ids.length === 0) {
      fehler.textContent = "Wähle zuerst Personen aus.";
      fehler.hidden = false;
      return;
    }
    fehler.hidden = true;
    zuordnen.disabled = true;
    zuordnen.setAttribute("aria-busy", "true");
    let ok = 0;
    try {
      for (const id of ids) {
        if (rolle.art === "global") await vergebeGlobaleRolle(rolle.id, id);
        else {
          await ordneZu(rolle.tagId, id, rolle.id, {
            mitglied: mitglieder.has(id),
          });
        }
        ok++;
      }
      ctx.melde(
        `${personenText(ok)} ${ok === 1 ? "hat" : "haben"} jetzt die Rolle «${rolle.name}». Sie gilt ab der nächsten Anfrage.`,
      );
      z.neu();
    } catch (f) {
      const satz = `${ok > 0 ? `${personenText(ok)} sind zugeordnet. ` : ""}${text(f)}`;
      zuordnen.disabled = false;
      zuordnen.removeAttribute("aria-busy");
      // Nach Teilerfolg zeichnet z.neu() die Seite neu: Der Fehler stünde dann nirgends mehr
      if (ok > 0) {
        ctx.melde(satz, "fehler");
        z.neu();
      } else {
        fehler.textContent = satz;
        fehler.hidden = false;
        fehler.focus?.();
      }
    }
  });
  wurzel.append(
    wahl.wurzel,
    fehler,
    el("div", { class: "reihe" }, zuordnen),
    rolle.art === "gruppe" &&
      el(
        "p",
        { class: "klein leise" },
        "Wer noch nicht in der Gruppe ist, wird mit der Rolle aufgenommen. Wer schon eine andere Rolle hat, bekommt diese statt der alten. Wer Rechte zuordnet, hat sie selbst: Der Server prüft das.",
      ),
  );
  return wurzel;
}

// Kopf einer Rolle: Name, Kennzeichen, Beschreibung, Zähler
export function rolleKopf(rolle, ...rechts) {
  return el(
    "div",
    { class: "rr-rollenkopf" },
    el(
      "div",
      { class: "rr-rollenkopf-text" },
      rolle.system &&
        el(
          "p",
          { class: "rr-rollenname" },
          el(
            "span",
            { class: "rr-marke rr-marke--system" },
            icon("sperre"),
            "Eingebaut",
          ),
        ),
      rolle.beschreibung && el("p", { class: "leise" }, rolle.beschreibung),
    ),
    ...rechts,
  );
}
