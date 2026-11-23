import { anfrage, fehlertext } from "./api.js";
import { auswahl, chip, el, knopf } from "./dom.js";
import { zaehlwort } from "./kalenderhilfen.js";

// Karte «Räume» in der Ansicht einer Gruppe (#649): Welche Räume diesem Team zugewiesen sind, und Räume zuweisen oder entziehen. Das Team sieht dann die Belegung dieser Räume und entscheidet ihre Anfragen (Recht «Raumanfragen entscheiden»). Zuweisen darf, wer das Recht «Räume einem Team zuweisen» hat (standardmässig die Abteilungsleitung); der Server prüft es bei jeder Änderung.
// Datenbanklast: eine Abfrage beim Öffnen (bis 100 Räume, mit ihrem Team), eine je Zuweisung. Kein Polling.
const BASIS = "/api/v1/admin/raeume";
const MAX = 100;

// tag: die Gruppe; ctx: wie in jedem Modul. Gibt die Karte zurück oder nichts, wenn die Person die Räume gar nicht sieht
export function raeumeKarte({ tag, ctx }) {
  if (!ctx.zugang.termine.raumListe) return null;
  const darfZuweisen = ctx.zugang.termine.raumZuweisen === true;
  const titelId = `tr-titel-${tag.id}`;
  const stand = el("p", { class: "klein leise", role: "status" });
  const inhalt = el("div", { class: "tr-inhalt" }, "Räume werden geladen …");
  const karte = el(
    "section",
    { class: "pe-karte", "aria-labelledby": titelId },
    el("h2", { id: titelId }, "Räume"),
    el(
      "p",
      { class: "leise" },
      "Das Team sieht die Belegung seiner Räume und entscheidet die Anfragen dafür. Räume ohne Team entscheidet die Abteilungsleitung.",
    ),
    stand,
    inhalt,
  );

  let raeume = [];
  let mehrAlsMax = false;
  const ids = (r) => r.team?.id === tag.id;

  const zeichne = () => {
    const eigene = raeume.filter(ids);
    const andere = raeume.filter((r) => !ids(r));
    const liste = el(
      "ul",
      { class: "liste-zeilen" },
      eigene.map((r) =>
        el(
          "li",
          {},
          el(
            "div",
            { class: "text" },
            el("span", { class: "name" }, r.name),
            r.ort && el("span", { class: "klein leise" }, r.ort),
          ),
          !r.aktiv && el("ul", { class: "chips" }, chip("Deaktiviert", "warn")),
          darfZuweisen &&
            knopf("Entziehen", {
              klein: true,
              art: "still",
              symbol: "papierkorb",
              kontext: r.name,
              onclick: () => entziehe(r),
            }),
        ),
      ),
    );
    const wahl = darfZuweisen
      ? auswahl({
          label: "Raum zuweisen",
          optionen: [
            ["", "Raum wählen"],
            ...andere.map((r) => [
              r.id,
              r.team ? `${r.name} (jetzt: ${r.team.name})` : r.name,
            ]),
          ],
          wert: "",
        })
      : null;
    const zuweisen = darfZuweisen
      ? knopf("Zuweisen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => {
            const raum = raeume.find((r) => r.id === wahl.eingabe.value);
            if (raum) weise(raum);
            else wahl.eingabe.focus();
          },
        })
      : null;
    inhalt.replaceChildren(
      ...[
        eigene.length === 0
          ? el(
              "p",
              { class: "leise pe-keiner" },
              "Dem Team ist noch kein Raum zugewiesen.",
            )
          : liste,
        wahl &&
          (andere.length === 0
            ? el("p", { class: "klein leise" }, "Es gibt keinen weiteren Raum.")
            : el("div", { class: "tr-zuweisen" }, wahl.wurzel, zuweisen)),
        mehrAlsMax &&
          el(
            "p",
            { class: "klein leise" },
            `Hier stehen die ersten ${MAX} Räume. Weitere Räume weist du unter «Räume» zu.`,
          ),
      ].filter(Boolean),
    );
    stand.textContent = `${zaehlwort(eigene.length, "Raum", "Räume")} zugewiesen.`;
  };

  // Das Team eines Raums ändern: sofort in der Ansicht, die Anfrage geht nach der Frist (ctx.mitRueckgaengig); bei «Rückgängig» oder einem Fehler kommt der alte Stand zurück
  const wechsle = (raum, neuesTeam, text) => {
    const vorher = raum.team;
    ctx.mitRueckgaengig({
      text,
      ansicht: {
        weg: () => {
          raum.team = neuesTeam;
          zeichne();
        },
        zurueck: () => {
          raum.team = vorher;
          zeichne();
        },
      },
      ausfuehren: () =>
        anfrage("PATCH", `${BASIS}/${raum.id}`, {
          teamId: neuesTeam ? neuesTeam.id : null,
        }),
      fehlertext,
    });
  };
  const weise = (raum) =>
    wechsle(
      raum,
      { id: tag.id, name: tag.name },
      `«${raum.name}» gehört jetzt zu «${tag.name}»`,
    );
  const entziehe = (raum) =>
    wechsle(raum, null, `«${raum.name}» gehört nicht mehr zu «${tag.name}»`);

  anfrage("GET", `${BASIS}?limit=${MAX}`).then(
    (antwort) => {
      raeume = antwort.raeume;
      mehrAlsMax = antwort.weitere;
      zeichne();
    },
    (f) => {
      inhalt.replaceChildren(
        el(
          "p",
          { class: "hinweis hinweis--fehler", role: "alert" },
          fehlertext(f),
        ),
      );
    },
  );
  return karte;
}
