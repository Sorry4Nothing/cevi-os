import { ApiFehler, anfrage } from "./api.js";
import { auswahl, el, knopf, neueId } from "./dom.js";
import { meldung as lagerMeldung } from "./lager-gemeinsam.js";

// Gemeinsames der Module «Sitzungen und Mitteilen» im Lager-Arbeitsbereich (#673): Adressen, Rechte, Seiten holen, Texte für Fehler, Konfliktbox (409 VERSION_KONFLIKT), Erwähnungen mit «@», Datum und Zeit.
// Kein Polling; Daten nur als Text in die Seite.

export const basis = (lagerId) => `/api/v1/lager/${lagerId}`;
export const adresse = (lagerId, ...teile) =>
  ["#lager/lager", lagerId, ...teile].join("/");

// Der Rest der Adresse nach dem Modul («hoecks/<id>/modus» ergibt [<id>, "modus"]). Der Arbeitsbereich reicht ctx.pfad entweder ganz (Lager-ID, Modul, Rest) oder schon gekürzt weiter.
export function restPfad(ctx, lagerId) {
  const i = ctx.pfad.indexOf(lagerId);
  return i < 0 ? ctx.pfad : ctx.pfad.slice(i + 2);
}

// Das Lager mit Rolle und Rechten der eigenen Rolle (GET /lager/{id}); der Arbeitsbereich reicht es meist mit
export async function holeLager(lagerId, lager) {
  if (lager && Array.isArray(lager.rechte)) return lager;
  return { ...lager, ...(await anfrage("GET", basis(lagerId))) };
}

// Eines der Rechte genügt
export const darf = (lager, ...rechte) =>
  rechte.some((r) => lager.rechte?.includes(r));
export const geschlossen = (lager) =>
  lager.schreibgeschuetzt === true ||
  lager.status === "abgeschlossen" ||
  lager.status === "archiviert";
// Schreiben: das Recht und ein offenes Lager
export const darfSchreiben = (lager, ...rechte) =>
  darf(lager, ...rechte) && !geschlossen(lager);

// Hinweis oben im Modul, wenn das Lager schreibgeschützt ist
export const schreibschutz = (lager) =>
  geschlossen(lager) &&
  el(
    "div",
    { class: "hinweis hinweis--info", role: "status" },
    el(
      "span",
      {},
      "Das Lager ist schreibgeschützt. Öffne es wieder, wenn du etwas ändern willst.",
    ),
  );

// Texte der Server-Codes dieser Module; alles andere folgt dem Gerüst
const TEXTE = {
  HOECK_HAT_TRAKTANDEN:
    "Der Höck hat noch Traktanden. Schiebe sie auf den nächsten Höck oder lösche sie zuerst.",
  HOECK_UNBEKANNT: "Den Höck gibt es in diesem Lager nicht.",
  PROTOKOLL_UNBEKANNT: "Das Protokoll gibt es in diesem Lager nicht.",
  HOECK_PASST_NICHT: "Das Protokoll gehört zu einem anderen Höck.",
  DATEI_UNBEKANNT:
    "Diese Datei gibt es in diesem Lager nicht oder du darfst sie nicht einbinden.",
  KEIN_MITGLIED: "Eine gewählte Person ist nicht Mitglied dieses Lagers.",
  RESSORT_UNBEKANNT: "Das Ressort gibt es in diesem Lager nicht.",
  GRUPPE_UNBEKANNT: "Die Gruppe gibt es in diesem Lager nicht.",
  AUFGABE_UNBEKANNT: "Die Aufgabe gibt es in diesem Lager nicht.",
  TRAKTANDUM_UNBEKANNT: "Das Traktandum gibt es in diesem Lager nicht.",
  ZEITFENSTER_UNGUELTIG: "«Sichtbar bis» muss nach «Sichtbar ab» liegen.",
  ERWAEHNUNG_UNGUELTIG:
    "Eine erwähnte Person ist nicht im Lager oder darf diesen Inhalt nicht sehen.",
  ZU_VIELE_MARKEN: "Ein Inhalt kann höchstens 10 Personen erwähnen.",
  LINK_HOST_NICHT_ERLAUBT:
    "Dieser Link liegt nicht auf einem Ablageort, den die Abteilung erlaubt.",
  LINK_UNGUELTIG:
    "Der Link muss mit «https» beginnen und darf weder Zugangsdaten noch einen Port enthalten.",
  VERSION_KONFLIKT:
    "Das wurde inzwischen von jemand anderem geändert. Entscheide, wie es weitergeht.",
};
export const meldung = (f) =>
  (f instanceof ApiFehler && TEXTE[f.code]) || lagerMeldung(f);

// Alle Seiten einer Liste mit Cursor («naechster»), höchstens 10 Seiten
export async function alleSeiten(pfad, schluessel, { limit = 100 } = {}) {
  const alle = [];
  let nach = null;
  for (let i = 0; i < 10; i++) {
    const sep = pfad.includes("?") ? "&" : "?";
    const antwort = await anfrage(
      "GET",
      `${pfad}${sep}limit=${limit}${nach ? `&nach=${nach}` : ""}`,
    );
    alle.push(...antwort[schluessel]);
    nach = antwort.naechster ?? null;
    if (!nach) break;
  }
  return alle;
}

// Mitglieder des Lagers [{ personId, name, rolle }]; wer sie nicht lesen darf, bekommt eine leere Liste (die Namen kommen dann aus den Daten selbst)
export async function ladeMitglieder(lagerId) {
  try {
    return (await anfrage("GET", `${basis(lagerId)}/mitglieder`)).mitglieder;
  } catch {
    return [];
  }
}

// Name einer Person aus den Antworten des Servers («name» und «ceviName»)
export const personName = (p) =>
  p?.name && p?.ceviName
    ? `${p.name} (${p.ceviName})`
    : (p?.name ?? p?.ceviName ?? "Unbekannt");

// ---- Datum und Zeit ----

const WOCHENTAG = new Intl.DateTimeFormat("de-CH", { weekday: "short" });
// «Mo 12.07.2027» aus «2027-07-12» (ohne Zeitzonen-Verschiebung)
export function datumMitTag(iso) {
  const [j, m, t] = String(iso).split("-").map(Number);
  if (!j || !m || !t) return "";
  const d = new Date(j, m - 1, t);
  return `${WOCHENTAG.format(d)} ${String(t).padStart(2, "0")}.${String(m).padStart(2, "0")}.${j}`;
}
export const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ZEITPUNKT = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});
export const zeitpunkt = (iso) => {
  const w = new Date(iso);
  return Number.isNaN(w.getTime()) ? "" : ZEITPUNKT.format(w);
};
// «2027-07-12T14:30» (Feld) → ISO mit Zeitzone für den Server; leer → null
export const lokalZuIso = (wert) =>
  wert ? new Date(wert).toISOString() : null;
// ISO vom Server → «2027-07-12T14:30» (lokal) für das Feld
export function isoZuLokal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

// Eine Zahl als Wort: «1 Punkt», «3 Punkte»
export const mehrzahl = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;

// Ein Link, der eine Datei am Ablageort öffnet: neuer Tab, ohne Verbindung zur Seite
export const dateiLink = (datei, text) =>
  el(
    "a",
    {
      class: "lg-verweis",
      href: datei.link,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    text ?? datei.anzeigename,
    el("span", { class: "nur-leser" }, " (öffnet in neuem Tab)"),
  );

// ---- Konflikt (409 VERSION_KONFLIKT) ----

function wertText(w) {
  if (w === null || w === undefined || w === "") return "leer";
  if (Array.isArray(w))
    return w.length === 0
      ? "leer"
      : w.map((x) => (typeof x === "object" ? (x.titel ?? x.name ?? "") : x)).join(", ");
  if (typeof w === "boolean") return w ? "ja" : "nein";
  return String(w);
}

// Box in einem Formular: zeigt die Felder mit dem Stand des Servers und lässt wählen.
// namen: { feldschluessel: "Beschriftung" }; uebernehmeStand(aktuell) füllt die Felder mit dem Stand des Servers; setzeVersion(v) merkt die Version für das nächste Speichern.
// behandle(fehler) liefert true, wenn es ein Konflikt war (die Box ist dann offen und der Fokus liegt in ihr)
export function konfliktBox({ namen, uebernehmeStand, setzeVersion }) {
  const titelId = neueId("konflikt");
  const liste = el("ul", { class: "lg-konflikt-liste" });
  const meine = knopf("Meine Änderung übernehmen", {
    art: "haupt",
    klein: true,
  });
  const server = knopf("Stand des Servers übernehmen", { klein: true });
  const wurzel = el(
    "div",
    {
      class: "hinweis hinweis--warn lg-konflikt",
      role: "group",
      "aria-labelledby": titelId,
      hidden: true,
      tabindex: "-1",
    },
    el(
      "div",
      { class: "lg-konflikt-text" },
      el(
        "p",
        { class: "fett", id: titelId },
        "Jemand hat das inzwischen geändert.",
      ),
      el("p", { class: "klein" }, "Das steht jetzt auf dem Server:"),
      liste,
      el("div", { class: "reihe" }, meine, server),
    ),
  );
  let aktuell = null;
  meine.addEventListener("click", () => {
    setzeVersion(aktuell.version);
    wurzel.hidden = true;
  });
  server.addEventListener("click", () => {
    uebernehmeStand(aktuell);
    setzeVersion(aktuell.version);
    wurzel.hidden = true;
  });
  return {
    wurzel,
    behandle(fehler) {
      if (!(fehler instanceof ApiFehler) || fehler.code !== "VERSION_KONFLIKT")
        return false;
      aktuell = fehler.daten?.aktuell;
      if (!aktuell) return false;
      const abweichend = fehler.daten.abweichend ?? [];
      liste.replaceChildren(
        ...(abweichend.length > 0 ? abweichend : ["(Stand geändert)"]).map(
          (k) =>
            el(
              "li",
              {},
              abweichend.length > 0
                ? `${namen?.[k] ?? k}: ${wertText(aktuell[k])}`
                : k,
            ),
        ),
      );
      wurzel.hidden = false;
      wurzel.focus();
      return true;
    },
  };
}

// ---- Erwähnungen («@Name» im Text, «@{person:<id>}» auf dem Server) ----

const MARKE =
  /@\{person:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}/gi;

// Beschriftungen «@Name»; zwei gleiche Namen bekommen eine Zahl dahinter, damit sie sich unterscheiden
export function erwaehnungsKarte(mitglieder) {
  const gesehen = new Map();
  const nachId = new Map();
  const nachText = new Map();
  for (const m of mitglieder) {
    const n = (gesehen.get(m.name) ?? 0) + 1;
    gesehen.set(m.name, n);
    const text = `@${m.name}${n > 1 ? ` ${n}` : ""}`;
    nachId.set(m.personId, text);
    nachText.set(text, m.personId);
  }
  return { nachId, nachText };
}

// Text vom Server → Text für die Anzeige und das Feld (Marken werden «@Name»; unbekannte Marken bleiben stehen)
export function markenZuNamen(text, karte) {
  return String(text ?? "").replace(
    MARKE,
    (voll, id) => karte.nachId.get(id.toLowerCase()) ?? voll,
  );
}
// Text aus dem Feld → Text für den Server («@Name» wird zur Marke; längere Namen zuerst)
export function namenZuMarken(text, karte) {
  let aus = text;
  const texte = [...karte.nachText.keys()].sort((a, b) => b.length - a.length);
  for (const t of texte)
    aus = aus.split(t).join(`@{person:${karte.nachText.get(t)}}`);
  return aus;
}
export const markenIn = (text) => [...String(text).matchAll(MARKE)].length;

// Mehrzeiliges Feld mit Auswahl «Person erwähnen»; ohne Mitgliederliste ein einfaches Feld
// wert(): Text mit Marken für den Server; markiert: true, wenn der Text Marken trägt
export function erwaehnFeld({ label, wert = "", hilfe, mitglieder, ...rest }) {
  const karte = erwaehnungsKarte(mitglieder);
  const id = neueId("feld");
  const eingabe = el("textarea", { id, rows: "4", ...rest });
  eingabe.value = markenZuNamen(wert, karte);
  const teile = [
    el("label", { for: id }, label),
    eingabe,
  ];
  let wahl = null;
  if (mitglieder.length > 0) {
    wahl = auswahl({
      label: "Person erwähnen",
      optionen: [
        ["", "Person wählen …"],
        ...mitglieder.map((m) => [m.personId, karte.nachId.get(m.personId)]),
      ],
      wert: "",
    });
    wahl.eingabe.addEventListener("change", () => {
      const person = wahl.eingabe.value;
      if (!person) return;
      const text = `${karte.nachId.get(person)} `;
      const von = eingabe.selectionStart ?? eingabe.value.length;
      const bis = eingabe.selectionEnd ?? von;
      eingabe.setRangeText(text, von, bis, "end");
      wahl.eingabe.value = "";
      wahl.eingabe.dispatchEvent(new Event("change"));
      eingabe.focus();
      eingabe.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const wurzel = el(
    "div",
    { class: "feld lg-erwaehnfeld" },
    ...teile,
    hilfe && el("p", { class: "hilfe" }, hilfe),
    wahl && el("div", { class: "lg-erwaehnwahl" }, wahl.wurzel),
  );
  return {
    wurzel,
    eingabe,
    wert: () => namenZuMarken(eingabe.value.trim(), karte),
    karte,
  };
}

// Gleicht die Erwähnungen eines gespeicherten Inhalts ab (typ: aufgabe, traktandum, pinnwand, beschluss); ein Fehler stoppt das Speichern nicht
export async function gleicheErwaehnungenAb(lagerId, typ, quelleId, ctx) {
  try {
    await anfrage("PUT", `${basis(lagerId)}/erwaehnungen/${typ}/${quelleId}`);
  } catch (f) {
    ctx.melde(
      `Gespeichert, aber die Erwähnung ging nicht raus. ${meldung(f)}`,
      "warn",
    );
  }
}
