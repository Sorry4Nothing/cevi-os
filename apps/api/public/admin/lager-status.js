import { anfrage } from "./api.js";
import { splitKnopf } from "./aktionen.js";
import { el, knopf, neueId } from "./dom.js";
import {
  ADRESSE,
  BASIS,
  meldung,
  statusChip,
  symbol,
} from "./lager-gemeinsam.js";

// Status des Lagers im Kopf des Arbeitsbereichs (#693): Chip, ein Satz, was er heute bedeutet, genau ein nächster Schritt als Hauptaktion und die übrigen Schritte im Menü daneben. Vor jedem Wechsel steht am Ort eine Frage mit der Folge in einem Satz, danach kommt die Meldung mit «Rückgängig».
// Was der Status bewirkt (Server, lager/policy.ts, routes/admin/lager.ts): entwurf und aktiv lassen sich ändern; abgeschlossen und archiviert sind schreibgeschützt (409 LAGER_GESCHLOSSEN, nur der Status lässt sich noch ändern); ein aktives Lager braucht mindestens eine Lagerleitung; löschen geht nur bei Entwurf oder Archiv; die Liste «Alle» zeigt keine archivierten Lager. Sonst ändert der Status nichts, der Server kennt keine Sichtbarkeit nach Status.

const STATUSWORT = {
  entwurf: "ein Entwurf",
  aktiv: "aktiv",
  abgeschlossen: "abgeschlossen",
  archiviert: "archiviert",
};

export const STATUS_SATZ = {
  entwurf:
    "In Vorbereitung. Alles lässt sich ändern, und das Lager lässt sich noch löschen.",
  aktiv: "Das Lager läuft. Alles lässt sich ändern.",
  abgeschlossen: "Das Lager ist vorbei und nur noch zum Lesen.",
  archiviert:
    "Das Lager liegt im Archiv und ist nur zum Lesen. In der Liste steht es nur unter «Archiviert».",
};

// Ein Schritt: Name auf dem Knopf, neuer Status, Frage und Folge in der Bestätigung, Meldung danach
const SCHRITTE = {
  starten: {
    text: "Lager starten",
    nach: "aktiv",
    symbol: "haken",
    art: "haupt",
    folge: "Danach steht das Lager auf «Aktiv». Ändern geht weiter wie bisher.",
    meldung: (t) => `«${t}» läuft jetzt.`,
  },
  abschliessen: {
    text: "Lager abschliessen",
    nach: "abgeschlossen",
    symbol: "schloss",
    art: "blau",
    folge:
      "Danach kann niemand mehr etwas ändern. Du kannst es jederzeit wieder öffnen.",
    meldung: (t) =>
      `«${t}» ist abgeschlossen und nur noch zum Lesen. Du kannst es jederzeit wieder öffnen.`,
  },
  archivieren: {
    text: "Ins Archiv legen",
    nach: "archiviert",
    symbol: "archiv",
    art: "haupt",
    folge:
      "Das Lager bleibt nur zum Lesen und steht in der Liste nur noch unter «Archiviert». Du kannst es jederzeit wiederherstellen.",
    meldung: (t) =>
      `«${t}» liegt im Archiv. Du findest es in der Liste unter «Archiviert».`,
  },
  oeffnen: {
    text: "Lager wieder öffnen",
    nach: "aktiv",
    symbol: "aktualisieren",
    art: "haupt",
    folge: "Danach kann wieder jede Person mit dem Recht etwas ändern.",
    meldung: (t) => `«${t}» ist wieder geöffnet.`,
  },
  wiederherstellen: {
    text: "Lager wiederherstellen",
    nach: "abgeschlossen",
    symbol: "aktualisieren",
    art: "haupt",
    folge:
      "Das Lager steht wieder in der Liste «Alle», bleibt aber nur zum Lesen.",
    meldung: (t) =>
      `«${t}» ist wiederhergestellt und nur noch zum Lesen. Du findest es in der Liste.`,
  },
};

// Welche Schritte es je Status gibt: die Hauptaktion zuerst, der Rest im Menü. Reine Funktion (testbar).
export function schritteFuer(status) {
  switch (status) {
    case "entwurf":
      return { haupt: "starten", mehr: ["archivieren"] };
    case "aktiv":
      return { haupt: "abschliessen", mehr: ["archivieren"] };
    case "abgeschlossen":
      return { haupt: "archivieren", mehr: ["oeffnen"] };
    case "archiviert":
      return { haupt: "wiederherstellen", mehr: [] };
    default:
      return null;
  }
}

export const schrittDaten = (name) => SCHRITTE[name];

// Symbole aus lager-gemeinsam.js (schloss, archiv, haken …) vor dem Text
const mitSymbol = (k, name) => {
  k.prepend(symbol(name));
  return k;
};

// ctx: der ctx des Moduls (melde, zugang); neu(): lädt den Arbeitsbereich neu
export function statusZeile(lager, ctx, neu) {
  const darfVerwalten = ctx.zugang?.darf?.("lager.verwalten") === true;
  const schritte = darfVerwalten ? schritteFuer(lager.status) : null;
  const aktionOrt = el("div", { class: "lg-status-aktion" });
  const frageOrt = el("div", { class: "lg-status-frage", hidden: true });
  const hinweisOrt = el("div", { class: "lg-status-hinweis" });
  const wurzel = el(
    "div",
    { class: "lg-status", "data-status": lager.status },
    statusChip(lager.status),
    el("p", { class: "lg-status-text" }, STATUS_SATZ[lager.status] ?? ""),
    aktionOrt,
    frageOrt,
    hinweisOrt,
  );
  if (!schritte) return { wurzel };

  // Eine Rückfrage am Ort statt eines Fensters: Frage, Folge, «Abbrechen» und der Schritt selbst
  function frage(name, ausloeser) {
    const s = SCHRITTE[name];
    const id = neueId("lg-status-frage");
    const fehler = el("p", {
      class: "hinweis hinweis--fehler",
      role: "alert",
      hidden: true,
    });
    const abbrechen = knopf("Abbrechen", { onclick: () => zu(true) });
    const los = mitSymbol(knopf(s.text, { art: s.art }), s.symbol);
    los.addEventListener("click", async () => {
      los.disabled = abbrechen.disabled = true;
      los.setAttribute("aria-busy", "true");
      try {
        await anfrage("PATCH", `${BASIS}/${lager.id}`, { status: s.nach });
      } catch (f) {
        fehler.textContent = `Nicht geändert. ${meldung(f)}`;
        fehler.hidden = false;
        los.disabled = abbrechen.disabled = false;
        los.removeAttribute("aria-busy");
        return;
      }
      await neu();
      ctx.melde(s.meldung(lager.titel), "ok", {
        text: "Rückgängig",
        onclick: async () => {
          try {
            await anfrage("PATCH", `${BASIS}/${lager.id}`, {
              status: lager.status,
            });
            ctx.melde(
              `«${lager.titel}» ist wieder ${STATUSWORT[lager.status]}.`,
            );
          } catch (f) {
            ctx.melde(`Nicht zurückgesetzt. ${meldung(f)}`, "fehler");
          }
          await neu();
        },
      });
    });
    frageOrt.replaceChildren(
      el("p", { class: "fett", id }, `${s.text}?`),
      el("p", { class: "leise" }, s.folge),
      fehler,
      el("div", { class: "reihe" }, abbrechen, los),
    );
    frageOrt.setAttribute("role", "group");
    frageOrt.setAttribute("aria-labelledby", id);
    frageOrt.hidden = false;
    aktionOrt.hidden = true;
    abbrechen.focus();
    function zu(fokus) {
      frageOrt.hidden = true;
      aktionOrt.hidden = false;
      if (fokus) ausloeser.focus();
    }
    frageOrt.onkeydown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      zu(true);
    };
  }

  const haupt = SCHRITTE[schritte.haupt];
  let hauptKnopf;
  const mehr = schritte.mehr.map((n) => ({
    text: SCHRITTE[n].text,
    onclick: () => frage(n, hauptKnopf),
  }));
  if (mehr.length > 0) {
    const geteilt = splitKnopf({
      text: haupt.text,
      art: haupt.art,
      kontext: lager.titel,
      onclick: () => frage(schritte.haupt, hauptKnopf),
      eintraege: mehr,
    });
    hauptKnopf = mitSymbol(geteilt.haupt, haupt.symbol);
    aktionOrt.append(geteilt.wurzel);
  } else {
    hauptKnopf = mitSymbol(
      knopf(haupt.text, {
        art: haupt.art,
        onclick: () => frage(schritte.haupt, hauptKnopf),
      }),
      haupt.symbol,
    );
    aktionOrt.append(hauptKnopf);
  }

  // Ein aktives Lager braucht eine Lagerleitung (der Server antwortet sonst mit 409): Fehlt sie, ist «Lager starten» gesperrt und der Grund steht darunter. Die Mitglieder sieht nur, wer Rechte vergeben darf.
  if (lager.status === "entwurf" && ctx.zugang?.darf?.("rechte.verwalten")) {
    anfrage("GET", `${BASIS}/${lager.id}/mitglieder`)
      .then(({ mitglieder }) => {
        if (mitglieder.some((m) => m.rolle === "lagerleitung")) return;
        if (!hauptKnopf.isConnected) return;
        hauptKnopf.disabled = true;
        hauptKnopf.setAttribute("aria-describedby", "lg-ohne-leitung");
        hinweisOrt.replaceChildren(
          el(
            "div",
            { class: "hinweis hinweis--warn", id: "lg-ohne-leitung" },
            el(
              "span",
              {},
              "Zum Starten fehlt die Lagerleitung. Ein aktives Lager braucht mindestens eine Person mit dieser Rolle.",
            ),
            el(
              "a",
              {
                class: "knopf knopf--klein",
                href: `${ADRESSE}/${lager.id}/mitglieder`,
              },
              "Mitglieder öffnen",
            ),
          ),
        );
      })
      .catch(() => {});
  }
  return { wurzel };
}
