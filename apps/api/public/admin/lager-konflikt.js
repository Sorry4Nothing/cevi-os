import { el, knopf } from "./dom.js";
import { meldung } from "./lager-gemeinsam.js";

// Gemeinsam für alle Lager-Module (#672): Konflikte beim Schreiben. Das Lager hat keine stille Überschreibung: Jede Schreibroute prüft die Version (409 VERSION_KONFLIKT, Body: aktuell, abweichend) und ein geschlossenes Lager lässt nur Lesen zu (409 LAGER_GESCHLOSSEN).

export const istVersionKonflikt = (f) =>
  f?.status === 409 && f?.code === "VERSION_KONFLIKT";
export const istGeschlossen = (f) =>
  f?.status === 409 && f?.code === "LAGER_GESCHLOSSEN";

// Hinweis am Ort der Zeile: zeigt, was jetzt auf dem Server steht, und lässt die Person wählen.
//  beschreibe(aktuell): Text des Stands auf dem Server (z. B. «Titel: Küche planen»)
//  meine(aktuell): wiederholt die eigene Änderung mit aktuell.version (gibt ein Promise zurück)
//  server(aktuell): übernimmt den Stand des Servers in die Anzeige
// Gibt den Knoten zurück; der Aufrufer hängt ihn an die Zeile. Der Fehler (f) kommt aus anfrage().
export function konfliktHinweis(
  f,
  { beschreibe, meine, server, beiFehler = () => {} },
) {
  const aktuell = f.daten?.aktuell ?? null;
  const wurzel = el(
    "div",
    { class: "hinweis hinweis--warn lg-konflikt", role: "alert" },
    el(
      "p",
      {},
      "Jemand hat das inzwischen geändert.",
      aktuell && beschreibe ? ` Jetzt steht da: ${beschreibe(aktuell)}` : "",
    ),
  );
  const knoepfe = el("div", { class: "lg-fuss" });
  const meineKnopf = knopf("Meine Änderung übernehmen", {
    art: "haupt",
    klein: true,
    onclick: async () => {
      meineKnopf.disabled = true;
      try {
        await meine(aktuell);
        wurzel.remove();
      } catch (fehler) {
        meineKnopf.disabled = false;
        beiFehler(fehler);
      }
    },
  });
  const serverKnopf = knopf("Stand des Servers übernehmen", {
    klein: true,
    onclick: () => {
      server(aktuell);
      wurzel.remove();
    },
  });
  knoepfe.append(...(aktuell ? [meineKnopf, serverKnopf] : [serverKnopf]));
  wurzel.append(knoepfe);
  return wurzel;
}

// Text für jeden Fehler einer Schreibanfrage: Geschlossen und Konflikt haben eigene Worte, der Rest folgt meldung()
export const schreibFehlertext = (f) =>
  istGeschlossen(f)
    ? "Das Lager ist schreibgeschützt. Öffne es unter «Angaben» wieder, wenn du etwas ändern willst."
    : istVersionKonflikt(f)
      ? "Jemand hat das inzwischen geändert. Lade neu und versuche es nochmals."
      : meldung(f);
