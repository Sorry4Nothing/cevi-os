import { anfrage, fehlertext } from "./api.js";
import { dialogFormular, el, knopf } from "./dom.js";
import { zaehlwort } from "./kalenderhilfen.js";
import { melde } from "./melden.js";
import { suchWahl } from "./personen-wahl.js";
import { mitRueckgaengig } from "./rueckgaengig.js";

// Tags bestehender Termine ändern (Epic #430, #835): ein Dialog im Fluss für einen Termin («Tags ändern», Kalender, Monat, Warnliste) und für mehrere («Tags setzen», Sammelaktion der Warnliste). Die Tags eines Termins ersetzt PUT /api/v1/admin/termine/{id}/tags, die Sammelaktion PUT /api/v1/admin/termine/tags.
// «Speichern» zeigt die Änderung sofort und schickt sie erst nach der Frist von «Rückgängig» (rueckgaengig.js); danach sagt ein Toast, ob Outlook mitzieht. Die Bedienelemente erscheinen nur mit dem Recht «Kalender-Kategorien zuordnen» (Signal termine.kategorien); der Server prüft es in jedem Fall.
// Abfragen: eine beim Öffnen (GET /api/v1/admin/tags) und eine je Speichern. Kein Polling.

// Höchstens so viele Tags je Termin (wie die API)
export const MAX_TAGS = 20;

export const darfTags = (ctx) => ctx.zugang?.termine?.kategorien === true;

const TYPEN = {
  stufe: "Stufe",
  funktion: "Funktion",
  team: "Team",
  lager: "Lager",
  anlass: "Anlass",
};

// Der Zustand steht im Wort, nie nur in einer Farbe; «aus» heisst: Der Schalter für das Schreiben nach Outlook ist ausgeschaltet
export const OUTLOOK_TEXT = {
  aus: "Nur in Cevi OS gespeichert, nicht in Outlook.",
  ausstehend: "In Cevi OS gespeichert. Outlook wird nachgeführt.",
  geschrieben: "In Cevi OS und Outlook gespeichert.",
};

export function sammelText({ geaendert, outlook }) {
  const teile = [
    outlook.geschrieben > 0 &&
      `${outlook.geschrieben} in Cevi OS und Outlook gespeichert.`,
    outlook.ausstehend > 0 &&
      `${outlook.ausstehend} in Cevi OS gespeichert, Outlook wird nachgeführt.`,
    outlook.aus > 0 &&
      `${outlook.aus} nur in Cevi OS gespeichert, nicht in Outlook.`,
  ].filter(Boolean);
  return [`${zaehlwort(geaendert, "Termin", "Termine")} geändert.`, ...teile]
    .join(" ")
    .trim();
}

const kandidat = (t) => ({
  id: t.id,
  name: t.name,
  zusatz: TYPEN[t.typ] ?? t.typ,
});

// termine: [{ id, titel, tags: [{ id, name, typ }] }]; ein Termin zeigt seine Tags vorausgewählt, mehrere beginnen leer (die Auswahl ersetzt die Tags aller)
// beiAenderung(termine, neueTags|null): zeigt die Änderung sofort; mit null stellt der Aufrufer den alten Stand wieder her (Rückgängig oder Fehler)
// danach(): nach dem Speichern (zum Beispiel die Liste neu laden)
export async function tagsAendern({ termine, beiAenderung, danach }) {
  const einzeln = termine.length === 1;
  let tags;
  try {
    tags = (await anfrage("GET", "/api/v1/admin/tags")).tags;
  } catch (f) {
    melde(`${fehlertext(f)} Versuche es nochmals.`, "fehler");
    return;
  }
  if (tags.length === 0) {
    melde(
      "Es gibt noch keine Tags. Lege sie zuerst unter «Gruppen und Tags» an.",
      "warn",
    );
    return;
  }
  const bekannt = new Map(tags.map((t) => [t.id, t]));
  const davor = einzeln ? termine[0].tags.map((t) => t.id) : [];
  const wahl = suchWahl({
    titel: "Gewählte Tags",
    beschriftung: "Tag suchen",
    kandidaten: tags.map(kandidat),
    gewaehlt: davor,
    max: MAX_TAGS,
    leerText: "Es gibt keine Tags, die du hinzufügen könntest.",
    keinerText: einzeln ? "Kein Tag gewählt." : "Noch kein Tag gewählt.",
  });
  dialogFormular({
    titel: einzeln ? "Tags ändern" : "Tags setzen",
    beschreibung: einzeln
      ? `«${termine[0].titel}»: Wer einen der Tags trägt, sieht den Termin.`
      : `${zaehlwort(termine.length, "Termin", "Termine")}: Die Tags ersetzen die bisherigen Tags jedes Termins.`,
    felder: [
      wahl.wurzel,
      el(
        "p",
        { class: "klein leise" },
        "Gibt es in Outlook eine Kategorie, die zu einem Tag passt, gilt sie: Outlook gewinnt beim nächsten Abgleich.",
      ),
    ],
    ok: "Speichern",
    senden: async () => {
      const ids = wahl.wert();
      // Eine Sammelaktion ohne Tag wäre ein Löschen aller Tags; das geht nur einzeln
      if (!einzeln && ids.length === 0) {
        throw new Error("Wähle mindestens einen Tag.");
      }
      mitRueckgaengig({
        text: einzeln
          ? `Tags von «${termine[0].titel}» geändert`
          : `Tags von ${zaehlwort(termine.length, "Termin", "Terminen")} gesetzt`,
        ansicht: {
          weg: () =>
            beiAenderung(
              termine,
              ids.map((id) => bekannt.get(id)),
            ),
          zurueck: () => beiAenderung(termine, null),
        },
        ausfuehren: () =>
          einzeln
            ? anfrage("PUT", `/api/v1/admin/termine/${termine[0].id}/tags`, {
                tagIds: ids,
              })
            : anfrage("PUT", "/api/v1/admin/termine/tags", {
                terminIds: termine.map((t) => t.id),
                tagIds: ids,
              }),
        danach: (antwort) => {
          melde(
            einzeln ? OUTLOOK_TEXT[antwort.outlook] : sammelText(antwort),
            antwort.outlook === "ausstehend" ? "warn" : "ok",
          );
          danach?.();
        },
        erledigt: "Tags gespeichert.",
        fehlertext,
      });
    },
    fehlertext: (f) =>
      f instanceof Error && !f.status ? f.message : fehlertext(f),
  });
}

// Knopf «Tags ändern» für eine Zeile; leer, wenn die Person das Recht nicht hat. Während die Tags laden, zeigt er den Ladezustand und nimmt keinen zweiten Klick an.
export function tagsKnopf({ ctx, termin, beiAenderung, danach }) {
  if (!darfTags(ctx)) return null;
  const k = knopf("Tags ändern", {
    klein: true,
    symbol: "tag",
    kontext: termin.titel,
    onclick: async () => {
      k.disabled = true;
      k.setAttribute("aria-busy", "true");
      try {
        await tagsAendern({ termine: [termin], beiAenderung, danach });
      } finally {
        k.disabled = false;
        k.removeAttribute("aria-busy");
      }
    },
  });
  return k;
}

// Zeigt die Änderung am Termin selbst und zeichnet neu: neue Tags setzen, mit null den alten Stand zurückholen
export function tagsAnzeige(neuzeichnen) {
  const vorher = new Map();
  return (termine, neu) => {
    for (const t of termine) {
      if (neu) {
        vorher.set(t.id, t.tags);
        t.tags = neu.map(({ id, name, typ }) => ({ id, name, typ }));
      } else if (vorher.has(t.id)) {
        t.tags = vorher.get(t.id);
      }
    }
    neuzeichnen(termine);
  };
}
