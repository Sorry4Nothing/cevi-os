// Wächter für ungespeicherte Änderungen (#699). Der Browser zeichnet nur beim Schliessen oder Neuladen des Tabs einen eigenen Dialog («Seite verlassen?»); das ist die letzte Rückfallebene und lässt sich nicht gestalten.
// Jeder Weg innerhalb der Verwaltung (Menü, Link, Browser-Zurück, Adresse ändern) fragt stattdessen hier, mit einer Zeile im Inhalt («Änderungen verwerfen?», Bleiben oder Verwerfen und gehen), kein Popup.
// Wer Eingaben hält, die verloren gehen, ruft schuetze() einmal je Ansicht auf. geaendert() wird bei jeder Frage neu gelesen; der Wächter hält keinen eigenen Stand und löst darum nie ohne echte Änderung aus.
// Dieses Modul importiert nichts (fluss.js hängt sich hier ein), baut die Knoten selbst und nutzt die Klassen des Flusses (.hinweis, .fluss-frage).

const quellen = new Set();
// Die Adresse, zu der der Benutzer gehen darf, ohne dass gefragt wird (nach «Verwerfen und gehen»)
let frei = null;

// opt.geaendert(): ob gerade etwas ungespeichert ist (Pflicht)
// opt.innerhalb(hash): bleibt die Adresse in der Ansicht, ohne dass etwas verloren geht (Vorgabe: dieselbe Adresse wie beim Anmelden des Wächters)
// opt.verwerfen(): wird nach «Verwerfen und gehen» aufgerufen und setzt den Stand zurück
// opt.frage(ziel): eigene Rückfrage statt der Zeile hier (Seiten im Fluss, Website-Editor); sie führt selbst zum Ziel
// opt.wurzel: Knoten der Ansicht; ist er nicht mehr im Dokument, ist die Ansicht weg und der Wächter fällt von selbst
// opt.text: was ungespeichert ist, für die Frage («an den Rechten»)
// opt.schluessel: ein Wächter je Schlüssel; ein neuer ersetzt den alten (Ansichten, die sich neu zeichnen)
// Rückgabe: Funktion, die den Wächter abmeldet
export function schuetze({
  geaendert,
  innerhalb,
  verwerfen,
  frage,
  wurzel,
  text,
  schluessel,
}) {
  const hier = typeof location === "undefined" ? "" : location.hash;
  for (const alt of quellen)
    if (schluessel && alt.schluessel === schluessel) quellen.delete(alt);
  const q = {
    schluessel,
    geaendert,
    innerhalb: innerhalb ?? ((h) => h === hier),
    verwerfen,
    frage,
    wurzel,
    text,
  };
  quellen.add(q);
  return () => quellen.delete(q);
}

function lebendig() {
  for (const q of [...quellen]) {
    if (q.wurzel && !q.wurzel.isConnected) quellen.delete(q);
  }
  return [...quellen];
}

// Alles, was Eingaben hält, die im Dokument stehen
export const hatUngespeichertes = () => lebendig().some((q) => q.geaendert());

// Die Quellen, die beim Wechsel zu hash etwas verlören
const betroffen = (hash) =>
  lebendig().filter((q) => q.geaendert() && !q.innerhalb(hash));

const hashVon = (url = "") => {
  const i = url.indexOf("#");
  return i < 0 ? "" : url.slice(i);
};

// Für eigene Rückfragen (opt.frage): Nach «Verwerfen» führt dieser Aufruf zum Ziel, ohne dass der Wächter noch einmal fragt
export function wechsle(ziel) {
  frei = ziel;
  location.hash = ziel;
}

// Die Zeile mit der Frage; höchstens eine
function zeigeFrage(hindernis, ziel) {
  const eigene = hindernis.find((q) => q.frage);
  if (eigene) return eigene.frage(ziel);
  const vorhanden = document.querySelector(".ungespeichert-frage");
  if (vorhanden) {
    vorhanden.querySelector("button").focus();
    return;
  }
  const vorher = document.activeElement;
  const knopf = (beschriftung, klasse, beiKlick) => {
    const k = document.createElement("button");
    k.type = "button";
    k.className = `knopf knopf--klein ${klasse}`.trim();
    k.textContent = beschriftung;
    k.addEventListener("click", beiKlick);
    return k;
  };
  const bleiben = knopf("Bleiben", "", () => {
    zeile.remove();
    if (vorher?.isConnected) vorher.focus();
  });
  const gehen = knopf("Verwerfen und gehen", "knopf--gefahr", () => {
    zeile.remove();
    for (const q of hindernis) {
      quellen.delete(q);
      q.verwerfen?.();
    }
    wechsle(ziel);
  });
  const was = [...new Set(hindernis.map((q) => q.text).filter(Boolean))];
  const satz = document.createElement("span");
  satz.textContent = `Änderungen verwerfen? ${was.length > 0 ? `Nicht gespeichert: ${was.join(", ")}. ` : ""}Wenn du gehst, sind sie weg.`;
  const zeile = document.createElement("div");
  zeile.className = "hinweis hinweis--warn fluss-frage ungespeichert-frage";
  zeile.setAttribute("role", "alert");
  zeile.append(satz, bleiben, gehen);
  (document.getElementById("inhalt") ?? document.body).prepend(zeile);
  zeile.scrollIntoView?.({ block: "nearest" });
  bleiben.focus();
}

if (typeof window !== "undefined") {
  // Letzte Rückfallebene: Tab schliessen oder Neuladen. Nur mit echten Änderungen
  window.addEventListener("beforeunload", (ereignis) => {
    if (!hatUngespeichertes()) return;
    ereignis.preventDefault();
    ereignis.returnValue = "";
  });

  // Ein Link der Verwaltung: noch vor dem Wechsel fragen, damit kein Verlaufseintrag entsteht
  document.addEventListener(
    "click",
    (ereignis) => {
      if (
        ereignis.button !== 0 ||
        ereignis.ctrlKey ||
        ereignis.metaKey ||
        ereignis.shiftKey
      ) {
        return;
      }
      const a = ereignis.target.closest?.('a[href^="#"]');
      const ziel = a?.getAttribute("href");
      if (!a || !ziel || ziel === "#" || ziel === "#inhalt") return;
      if (ziel === location.hash) return;
      const hindernis = betroffen(ziel);
      if (hindernis.length === 0) return;
      ereignis.preventDefault();
      ereignis.stopImmediatePropagation();
      zeigeFrage(hindernis, ziel);
    },
    true,
  );

  // Browser-Zurück, Vor, eine neue Adresse oder ein Wechsel per Skript: Der Wechsel ist schon passiert; die Adresse geht zurück, die Frage steht. Dieser Wächter muss vor der Navigation der Verwaltung hören (admin.js importiert ihn zuerst)
  window.addEventListener("hashchange", (ereignis) => {
    // Ein Skript, das die Ansicht neu zeichnen lässt (synthetisches Ereignis), ist kein Wechsel
    if (!ereignis.isTrusted) return;
    const neu = location.hash;
    const alt = hashVon(ereignis.oldURL);
    // Ein Wächter hat die Adresse schon zurückgestellt (fluss.js bei Browser-Zurück): nichts wechselt
    if (neu === alt) {
      ereignis.stopImmediatePropagation();
      return;
    }
    if (frei === neu) {
      frei = null;
      return;
    }
    const hindernis = betroffen(neu);
    if (hindernis.length === 0) return;
    ereignis.stopImmediatePropagation();
    window.history.replaceState(
      window.history.state,
      "",
      `${location.pathname}${location.search}${alt}`,
    );
    zeigeFrage(hindernis, neu);
  });
}
