// Kommendes, Aktivität und Teilnahme der Übersicht (#620). Alles aus der Antwort von GET /api/v1/admin/uebersicht; nie Namen von Personen, nur Titel von Terminen und Anlässen, Zeiten und Zahlen.
// Vorlagen (angesehen und nachgezeichnet, kein Quelltext übernommen): Kokonut UI Pro «event-timeline» und «clinic-dashboard» (Zeitachse mit Marken, darunter die Liste in derselben Reihenfolge), «activity-feed» (Zeilen gleicher Höhe mit Symbol, Satz und Zeit), «poll-card» und «leaderboard» (Balken auf gemeinsamer Basis, Anteil und Zahl; der Balken wächst beim Erscheinen).
import { chip, el, icon } from "./dom.js";
import {
  fehlerKarte,
  karte,
  verweisZeile,
  vor,
  ziel,
} from "./uebersicht-kacheln.js";
import { fmt } from "./uebersicht-diagramme.js";

const ZONE = "Europe/Zurich";
const de = (optionen) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: ZONE, ...optionen });
const fTag = de({ weekday: "short" });
const fTagMonat = de({ day: "numeric", month: "short" });
const fNum = de({ day: "numeric", month: "numeric" });
const fUhr = de({ hour: "2-digit", minute: "2-digit" });
const fLang = de({ weekday: "long", day: "numeric", month: "long" });
const iso = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE });
const MS_TAG = 86_400_000;

// Ein Kalendertag «2026-12-05» ohne Zeitzonensprung
const tagDatum = (s) => new Date(`${s}T12:00:00Z`);
const heuteTag = () => tagDatum(iso.format(new Date()));
// Ganze Kalendertage von heute bis zu einem Zeitpunkt (Schweizer Zeit)
const tageBis = (d) =>
  Math.round((tagDatum(iso.format(d)) - heuteTag()) / MS_TAG);

function inTagen(n) {
  if (n <= 0) return "heute";
  if (n === 1) return "morgen";
  if (n < 14) return `in ${n} Tagen`;
  if (n < 70) return `in ${Math.round(n / 7)} Wochen`;
  return `in ${Math.round(n / 30)} Monaten`;
}

// Ein Balken auf gemeinsamer Basis; die Breite kommt als Eigenschaft (die CSP erlaubt keine style-Attribute), er wächst beim Erscheinen von links (CSS, nur mit erlaubter Bewegung)
function balken(anteil) {
  const fuell = el("span", { class: "ud-balken-fuell" });
  fuell.style.setProperty(
    "--w",
    String(Math.max(anteil > 0 ? 1.5 : 0, Math.min(100, anteil * 100))),
  );
  return el("span", { class: "ud-balken", "aria-hidden": "true" }, fuell);
}

// 1. Kommendes -----------------------------------------------------------------------------
// Oben die Wochenleiste (Säulen für die Termine, Balken für Lager), darunter die nächsten Einträge als Zeitleiste mit Punkt und «in 5 Tagen».

const beginnVon = (t) => (t.beginn ? new Date(t.beginn) : tagDatum(t.tagVon));

function zeitText(t) {
  if (t.ganztaegig) {
    return t.tagBis && t.tagBis !== t.tagVon
      ? `Ganztägig, bis ${fTagMonat.format(tagDatum(t.tagBis))}`
      : "Ganztägig";
  }
  return `${fUhr.format(new Date(t.beginn))}–${fUhr.format(new Date(t.ende))} Uhr`;
}

function wochenleiste(k) {
  const wochen = k.termineProWoche;
  if (!wochen || !wochen.some((w) => w > 0)) return null;
  const n = wochen.length;
  const max = Math.max(1, ...wochen);
  const heute = heuteTag();
  const tagAb = (i) => new Date(heute.getTime() + i * 7 * MS_TAG);
  const satz = `Termine je Woche, ab heute: ${wochen.map((w, i) => `${i === 0 ? "diese Woche" : `ab ${fNum.format(tagAb(i))}`} ${w}`).join(", ")}.`;
  const spalten = wochen.map((w, i) => {
    const saeule = el("span", { class: "ud-wochen-saeule" });
    saeule.style.setProperty(
      "--h",
      String(w > 0 ? Math.max(8, (w / max) * 100) : 0),
    );
    return el(
      "li",
      { class: i === 0 ? "ist-jetzt" : "" },
      el("span", { class: "ud-wochen-n" }, w > 0 ? String(w) : ""),
      el("span", { class: "ud-wochen-bahn" }, saeule),
      el(
        "span",
        { class: "ud-wochen-d" },
        i === 0 ? "Heute" : fNum.format(tagAb(i)),
      ),
    );
  });
  // Lager als Balken über die Tage (Tag 0 = heute)
  const lager = k.lager
    .map((l) => ({
      von: Math.max(0, Math.round((tagDatum(l.von) - heute) / MS_TAG)),
      bis: Math.round((tagDatum(l.bis) - heute) / MS_TAG),
    }))
    .filter((l) => l.bis >= 0 && l.von < n * 7)
    .map((l) => {
      const balkenEl = el("span", { class: "ud-lagerbalken" });
      balkenEl.style.setProperty("--von", String((l.von / (n * 7)) * 100));
      balkenEl.style.setProperty(
        "--breit",
        String(
          Math.max(2, ((Math.min(n * 7, l.bis + 1) - l.von) / (n * 7)) * 100),
        ),
      );
      return balkenEl;
    });
  return el(
    "div",
    { class: "ud-wochen" },
    el(
      "ol",
      { class: "ud-wochen-spalten", role: "img", "aria-label": satz },
      spalten,
    ),
    lager.length > 0 &&
      el("div", { class: "ud-lagerleiste", "aria-hidden": "true" }, lager),
    lager.length > 0 &&
      el(
        "p",
        { class: "ud-wochen-legende klein leise" },
        el("span", { class: "ud-lager-punkt", "aria-hidden": "true" }),
        "Balken: Lager",
      ),
  );
}

export function kommendKarte(daten, ctx, nochmals) {
  const k = daten.kommend;
  if (!k) {
    return daten.fehlt.includes("kommend")
      ? fehlerKarte("Kommendes", nochmals)
      : null;
  }
  const zeilen = [
    ...k.termine.map((t) => ({
      art: "termin",
      titel: t.titel,
      von: beginnVon(t),
      t,
    })),
    ...k.lager.map((l) => ({
      art: "lager",
      titel: l.titel,
      von: tagDatum(l.von),
      l,
    })),
  ]
    .sort((a, b) => a.von - b.von)
    .slice(0, 6);
  const liste =
    zeilen.length === 0
      ? el(
          "div",
          { class: "ub-zustand", role: "status" },
          el(
            "p",
            { class: "ub-leer-satz" },
            `In den nächsten ${k.wochen} Wochen steht nichts an.`,
          ),
        )
      : el(
          "ol",
          { class: "ud-zeitleiste" },
          zeilen.map((z, i) => {
            const tage = tageBis(z.von);
            const laeuft = z.art === "lager" && tageBis(tagDatum(z.l.von)) <= 0;
            const meta =
              z.art === "lager"
                ? `${fTagMonat.format(tagDatum(z.l.von))} bis ${fTagMonat.format(tagDatum(z.l.bis))}`
                : zeitText(z.t);
            const chips = [];
            if (z.art === "lager") chips.push(chip("Lager", "", false));
            if (z.art === "lager" && z.l.status === "entwurf")
              chips.push(chip("Entwurf", "warn"));
            const zeile = el(
              "li",
              { class: tage <= 0 ? "ist-heute" : "" },
              el("span", { class: "ud-punkt-zeit", "aria-hidden": "true" }),
              el(
                "span",
                { class: "ud-zeile-text" },
                el("span", { class: "ud-zeile-titel" }, z.titel),
                el(
                  "span",
                  { class: "ud-zeile-meta klein leise" },
                  el(
                    "span",
                    { class: "nur-leser" },
                    `${fLang.format(z.von)}, `,
                  ),
                  el(
                    "span",
                    { "aria-hidden": "true" },
                    `${fTag.format(z.von).replace(".", "")} ${fTagMonat.format(z.von)}`,
                  ),
                  ` · ${meta}`,
                ),
              ),
              chips.length > 0 && el("ul", { class: "chips" }, chips),
              el(
                "span",
                { class: "ud-zeile-in klein" },
                laeuft ? "läuft" : inTagen(tage),
              ),
            );
            zeile.style.setProperty("--i", String(i));
            return zeile;
          }),
        );
  const kalender = ziel(ctx, ["termine", "kalender"]);
  return karte({
    titel: "Kommendes",
    untertitel: `Die nächsten ${k.wochen} Wochen`,
    klasse: "ud-kommend",
    aktion: kalender ? verweisZeile(kalender, "Alle Termine") : undefined,
    inhalt: [
      daten.fehlt.includes("lager") &&
        el(
          "p",
          { class: "klein leise", role: "status" },
          "Die Lager konnten nicht geladen werden.",
        ),
      wochenleiste(k),
      liste,
    ],
  });
}

// 2. Aktivität -----------------------------------------------------------------------------
// «Zuletzt passiert»: Zeilen gleicher Höhe, jede mit Symbol, Satz und Zeit. Nur aus Zahlen und Zeitpunkten, die die Route ohnehin liefert (neue Anmeldungen je Anlass, letzte Bestellung, offener Vorschlag, Stand der Website); das Audit-Log gehört nicht dazu, es ist für den Ernstfall und hat in V1 keine Ansicht.

export function aktivitaetKarte(daten) {
  const eintraege = [];
  for (const a of daten.anlaesse ?? []) {
    if (a.kommend && a.neu7 > 0 && a.letzteAm) {
      eintraege.push({
        zeit: a.letzteAm,
        symbol: "kalender",
        text: `${fmt(a.neu7)} ${a.neu7 === 1 ? "neue Anmeldung" : "neue Anmeldungen"} zu «${a.titel}»`,
      });
    }
  }
  const akt = daten.aktivitaet;
  const monat = 30 * MS_TAG;
  if (
    akt?.letzteBestellungAm &&
    Date.now() - new Date(akt.letzteBestellungAm) < 3 * monat
  ) {
    eintraege.push({
      zeit: akt.letzteBestellungAm,
      symbol: "ablage",
      text: "Neue Bestellung im Lädeli",
    });
  }
  if (akt?.letzterVorschlagAm) {
    eintraege.push({
      zeit: akt.letzterVorschlagAm,
      symbol: "termine",
      text: "Terminvorschlag wartet auf deinen Entscheid",
    });
  }
  const w = daten.zustand?.website;
  if (w?.zuletztErzeugtAm) {
    eintraege.push({
      zeit: w.zuletztErzeugtAm,
      symbol: "website",
      text: "Website aktualisiert",
    });
  }
  if (eintraege.length < 2) return null;
  eintraege.sort((a, b) => new Date(b.zeit) - new Date(a.zeit));
  return karte({
    titel: "Zuletzt passiert",
    untertitel: "Neu seit deinem letzten Besuch? Hier siehst du es.",
    klasse: "ud-aktivitaet",
    inhalt: el(
      "ul",
      { class: "ud-feed" },
      eintraege.slice(0, 6).map((e, i) => {
        const zeile = el(
          "li",
          {},
          el("span", { class: "ud-feed-symbol" }, icon(e.symbol)),
          el("span", { class: "ud-feed-text" }, e.text),
          el(
            "time",
            { class: "ud-feed-zeit klein leise", datetime: e.zeit },
            vor(e.zeit),
          ),
        );
        zeile.style.setProperty("--i", String(i));
        return zeile;
      }),
    ),
  });
}

// 3. Kinder je Stufe -----------------------------------------------------------------------
// Verteilung als Balken auf gemeinsamer Basis mit Zahl und Anteil (leaderboard, poll-card)

export function stufenKarte(daten, ctx, nochmals) {
  const s = daten.kinderJeStufe;
  if (!s) {
    return daten.fehlt.includes("kinderJeStufe")
      ? fehlerKarte("Kinder je Stufe", nochmals)
      : null;
  }
  const summe = s.reduce((x, y) => x + y.kinder, 0);
  const max = Math.max(1, ...s.map((x) => x.kinder));
  const kinder = ziel(ctx, ["personen", "kinder"]);
  return karte({
    titel: "Kinder je Stufe",
    untertitel:
      s.length === 0
        ? undefined
        : `${fmt(summe)} ${summe === 1 ? "Kind" : "Kinder"} in ${s.length === 1 ? "einer Stufe" : `${s.length} Stufen`}`,
    klasse: "ud-stufen",
    aktion:
      ctx.ich.role === "admin" && kinder
        ? verweisZeile(kinder, "Kinder")
        : undefined,
    inhalt:
      s.length === 0
        ? el(
            "div",
            { class: "ub-zustand", role: "status" },
            el("p", { class: "ub-leer-satz" }, "Noch keine Stufe angelegt."),
          )
        : el(
            "ul",
            { class: "ud-verteilung" },
            s.map((x, i) => {
              const zeile = el(
                "li",
                {},
                el("span", { class: "ud-verteilung-name" }, x.name),
                balken(x.kinder / max),
                el(
                  "span",
                  { class: "ud-verteilung-zahl" },
                  fmt(x.kinder),
                  el(
                    "span",
                    { class: "ud-verteilung-anteil klein leise" },
                    summe > 0
                      ? ` · ${Math.round((x.kinder / summe) * 100)} %`
                      : "",
                  ),
                  el(
                    "span",
                    { class: "nur-leser" },
                    ` ${x.kinder === 1 ? "Kind" : "Kinder"}`,
                  ),
                ),
              );
              zeile.style.setProperty("--i", String(i));
              return zeile;
            }),
          ),
  });
}

// 4. Anmeldungen je Anlass -----------------------------------------------------------------

export function anlaesseKarte(daten, ctx, nochmals) {
  const alle = daten.anlaesse;
  if (!alle) {
    return daten.fehlt.includes("anlaesse")
      ? fehlerKarte("Anmeldungen je Anlass", nochmals)
      : null;
  }
  const kommend = alle.filter((a) => a.kommend);
  const max = Math.max(1, ...kommend.map((a) => a.angemeldet));
  const link = ziel(ctx, ["anlaesse", "anlaesse"]);
  return karte({
    titel: "Anmeldungen je Anlass",
    untertitel:
      kommend.length === 0
        ? undefined
        : `${kommend.length} ${kommend.length === 1 ? "kommender Anlass" : "kommende Anlässe"}`,
    klasse: "ud-anlaesse",
    aktion: link ? verweisZeile(link, "Anlässe") : undefined,
    inhalt:
      kommend.length === 0
        ? el(
            "div",
            { class: "ub-zustand", role: "status" },
            el(
              "p",
              { class: "ub-leer-satz" },
              "Kein Anlass mit Anmeldung steht an.",
            ),
          )
        : el(
            "ul",
            { class: "ud-verteilung ud-verteilung--anlass" },
            kommend.map((a, i) => {
              const fristTage = a.frist ? tageBis(new Date(a.frist)) : null;
              const fristText =
                fristTage === null
                  ? null
                  : fristTage < 0
                    ? "Frist abgelaufen"
                    : fristTage === 0
                      ? "Frist endet heute"
                      : `Frist ${inTagen(fristTage)}`;
              const knapp =
                fristTage !== null && fristTage >= 0 && fristTage <= 7;
              const meta = el(
                "span",
                { class: "ud-verteilung-meta klein leise" },
                a.neu7 > 0
                  ? `${a.neu7} neu in 7 Tagen`
                  : "keine neuen in 7 Tagen",
                fristText && ` · ${fristText}`,
              );
              const zeile = el(
                "li",
                {},
                el(
                  "span",
                  { class: "ud-verteilung-name" },
                  a.titel,
                  knapp &&
                    el(
                      "ul",
                      { class: "chips ud-chip-frist" },
                      chip("Frist bald", "warn"),
                    ),
                ),
                balken(a.angemeldet / max),
                el(
                  "span",
                  { class: "ud-verteilung-zahl" },
                  fmt(a.angemeldet),
                  el(
                    "span",
                    { class: "nur-leser" },
                    ` ${a.angemeldet === 1 ? "Anmeldung" : "Anmeldungen"}`,
                  ),
                ),
                meta,
              );
              zeile.style.setProperty("--i", String(i));
              return zeile;
            }),
          ),
  });
}
