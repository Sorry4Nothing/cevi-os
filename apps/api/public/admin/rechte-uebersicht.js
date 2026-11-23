import { avatar, chip, el, knopf } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import {
  adresse,
  kandidatVon,
  zurueckLink,
  haenge,
} from "./rechte-gemeinsam.js";
import { darfVon, istVerantwortlich, STUFENROLLE } from "./rechte-logik.js";
import { leerKarte } from "./zustaende.js";

// Reiter «Was darf wer?» (#623): nur lesen. Die Sicht je Person fasst zusammen, was aus Rollen, Gruppen, Stufenrollen, Lagern und Sonderrechten folgt, und sagt bei jedem Recht, woher es kommt und ob der zweite Faktor nötig ist. Alles stammt aus Daten, die die API ohnehin liefert; die Regeln stehen in docs/rechte.md. Der Server entscheidet weiter selbst: Diese Seite erklärt, sie erteilt nichts.

export function zeigeUebersicht(inhalt, z, pfad) {
  if (pfad[0]) return zeigePerson(inhalt, z, pfad[0]);
  zeigeListe(inhalt, z);
}

const FILTER = [
  ["alle", "Alle Personen"],
  ["admin", "Abteilungsleitung"],
  ["rolle", "Mit Rolle"],
  ["stufe", "Mit Stufenrolle"],
  ["verantwortlich", "Verantwortlich im Team"],
];

// Die Merkmale einer Person für die Liste: kurze Chips, höchstens vier, der Rest als Zahl
function merkmale(p, d) {
  const stufeName = new Map(d.stufen.map((s) => [s.id, s.name]));
  const m = [];
  if (p.admin) m.push({ text: "Abteilungsleitung", art: "ok", art2: "admin" });
  for (const r of d.rollen.filter((r) =>
    r.personen.some((x) => x.id === p.id),
  )) {
    m.push({ text: `Rolle «${r.name}»`, art2: "rolle" });
  }
  for (const r of p.rollen ?? []) {
    if (STUFENROLLE[r.typ]) {
      m.push({
        text: `${STUFENROLLE[r.typ]} ${stufeName.get(r.stufeId) ?? ""}`.trim(),
        art: "stufe",
        art2: "stufe",
      });
    }
  }
  for (const g of d.gruppen) {
    const mit = g.mitglieder.find((x) => x.userId === p.id);
    if (g.typ === "team" && mit && istVerantwortlich(mit.rolle)) {
      m.push({ text: `Verantwortlich: ${g.name}`, art2: "verantwortlich" });
    }
  }
  return m;
}

function zeigeListe(inhalt, z) {
  const { daten } = z;
  const eintraege = daten.personen
    .filter((p) => !p.deaktiviert)
    .map((p) => {
      const m = merkmale(p, daten);
      return {
        p,
        art2: new Set(m.map((x) => x.art2)),
        suche:
          `${p.name} ${p.ceviName ?? ""} ${p.benutzername ?? ""}`.toLowerCase(),
        wurzel: zeile(p, m),
      };
    });
  if (eintraege.length === 0) {
    haenge(inhalt, leerKarte("Es gibt noch keine Personen.", []));
    return;
  }
  const liste = el(
    "ul",
    { class: "rr-personenliste" },
    eintraege.map((e) => e.wurzel),
  );
  const leer = el("div");
  const leiste = filterleiste({
    suche: { label: "Person suchen" },
    filter: [
      {
        schluessel: "wer",
        label: "Zeigen",
        grundwert: "alle",
        optionen: FILTER,
      },
    ],
    namen: { einzahl: "Person", mehrzahl: "Personen" },
    beiAenderung: ({ suche, filter: f }) => {
      const q = suche.trim().toLowerCase();
      let n = 0;
      for (const e of eintraege) {
        e.wurzel.hidden = !(
          (q === "" || q.split(/\s+/).every((t) => e.suche.includes(t))) &&
          (f.wer === "alle" || e.art2.has(f.wer))
        );
        if (!e.wurzel.hidden) n++;
      }
      leer.replaceChildren(
        ...(n === 0
          ? [
              leerKarte("Keine Person passt zu deiner Suche.", [
                knopf("Filter zurücksetzen", {
                  onclick: () => leiste.setzeAlles(),
                }),
              ]),
            ]
          : []),
      );
      leiste.setzeTreffer(n, eintraege.length);
    },
  });
  leiste.setzeTreffer(eintraege.length, eintraege.length);
  haenge(
    inhalt,
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Wähle eine Person und sieh, was sie darf und woher das kommt. Hier änderst du nichts: Rollen und Gruppen stellst du in den anderen Reitern ein, Stufenrollen im Formular der Person.",
    ),
    leiste.wurzel,
    liste,
    leer,
  );
}

function zeile(p, m) {
  const gezeigt = m.slice(0, 4);
  const rest = m.length - gezeigt.length;
  return el(
    "li",
    { class: "rr-personzeile" },
    el(
      "div",
      { class: "wer" },
      avatar(p.name, { hell: true, bildUrl: p.bildUrl }),
      el(
        "div",
        {},
        el(
          "a",
          { class: "name rr-personlink", href: adresse("uebersicht", p.id) },
          p.name,
        ),
        p.ceviName && el("span", { class: "klein leise" }, p.ceviName),
      ),
    ),
    el(
      "ul",
      { class: "chips", "aria-label": `Rechte von ${p.name}` },
      gezeigt.length > 0
        ? gezeigt.map((x) => chip(x.text, x.art, false))
        : chip("Keine besonderen Rechte", "", false),
      rest > 0 && chip(`+${rest}`, "", false),
    ),
  );
}

function zeigePerson(inhalt, z, id) {
  const { ctx, daten } = z;
  const p = daten.personen.find((x) => x.id === id);
  if (!p) {
    haenge(
      inhalt,
      zurueckLink("Alle Personen", adresse("uebersicht")),
      leerKarte("Diese Person gibt es nicht (mehr).", []),
    );
    return;
  }
  ctx.titel(p.name, "Was diese Person darf und woher das kommt.");
  const zeilen = darfVon(p.id, daten);
  const kopf = el(
    "section",
    { class: "flaeche rr-flaeche rr-person" },
    el(
      "div",
      { class: "wer" },
      avatar(p.name, { hell: true, bildUrl: p.bildUrl }),
      el(
        "div",
        {},
        el("h2", {}, p.name),
        el("p", { class: "klein leise" }, kandidatVon(p).zusatz),
      ),
    ),
    el(
      "ul",
      { class: "chips" },
      chip(
        p.zweiterFaktor ? "Zweiter Faktor aktiv" : "Zweiter Faktor fehlt",
        p.zweiterFaktor ? "ok" : "warn",
      ),
      p.deaktiviert && chip("Konto gesperrt", "fehler"),
    ),
    !p.zweiterFaktor &&
      el(
        "p",
        { class: "klein leise" },
        "Ohne zweiten Faktor sperrt der Server jedes Recht, das ihn braucht (Zeilen mit «2. Faktor»).",
      ),
    p.deaktiviert &&
      el(
        "p",
        { class: "klein leise" },
        "Das Konto ist gesperrt: Der Server lässt jede Anfrage ab, auch mit den Rechten unten.",
      ),
  );
  const liste =
    zeilen.length === 0
      ? leerKarte(
          "Diese Person hat keine besonderen Rechte. Sie sieht und tut, was für ihre Stufe und ihre Gruppen vorgesehen ist.",
          [],
        )
      : el(
          "ul",
          { class: "rr-darf" },
          zeilen.map((r) =>
            el(
              "li",
              { class: "flaeche rr-flaeche rr-darfzeile" },
              el("h3", {}, r.titel),
              el(
                "ul",
                { class: "rr-quellen" },
                r.quellen.map((q) =>
                  el(
                    "li",
                    { class: "rr-quelle" },
                    el("span", { class: "rr-umfang" }, q.umfang),
                    el(
                      "ul",
                      { class: "chips" },
                      chip(q.herkunft, "", false),
                      q.zf && chip("2. Faktor", "", "schluessel"),
                    ),
                    q.link &&
                      el(
                        "a",
                        { class: "klein", href: q.link },
                        "Ansehen und ändern",
                        el("span", { class: "nur-leser" }, `: ${q.herkunft}`),
                      ),
                  ),
                ),
              ),
            ),
          ),
        );
  haenge(
    inhalt,
    zurueckLink("Alle Personen", adresse("uebersicht")),
    kopf,
    liste,
    el(
      "p",
      { class: "klein leise" },
      "Nicht aufgeführt: was jede Person ohnehin darf (eigenes Profil, eigener Kalender) und was an einem Elternkonto hängt (Programme der Stufe der Kinder). Die Rechte im Lager stellt die Lagerleitung je Lager ein.",
    ),
  );
}
