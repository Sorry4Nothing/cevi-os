import { el, flussKopf, neueId } from "./dom.js";

// Unteransicht im selben Panel (#595): Bild wählen und Zugriff eines Bausteins öffnen NICHT ein zweites Panel über dem Panel des Bausteins (nie Blatt auf Blatt), sondern ersetzen dessen Inhalt.
// «Zurück» (und Escape) bringt den Baustein zurück, wie er war: Das Formular bleibt im Speicher, nur versteckt. Der Fokus kehrt zum Auslöser zurück.
// blatt: das Panel (Ergebnis von seitenblatt); optionen: { titel, untertitel?, inhalt, fusszeile?, zurueckText? }
// Liefert ein Element mit close() und dem Ereignis «close», damit der Aufrufer wie bei seitenblatt arbeiten kann
export function unteransicht(
  blatt,
  { titel, untertitel, inhalt, fusszeile, zurueckText = "Zurück" },
) {
  const ausloeser = document.activeElement;
  const titelId = neueId("unter");
  const { kopf, ueberschrift } = flussKopf({
    titelId,
    titel,
    untertitel,
    panel: false,
    beiZurueck: () => sub.close(),
  });
  // «Zurück» heisst hier, wohin es führt
  const zurueckKnopf = kopf.querySelector(".knopf");
  if (zurueckKnopf?.lastChild) zurueckKnopf.lastChild.textContent = zurueckText;
  // Im Panel ist der Titel eine Überschrift der zweiten Ebene
  const h2 = el("h2", { id: titelId, class: "fluss-titel", tabindex: "-1" });
  h2.textContent = titel;
  ueberschrift.replaceWith(h2);
  const sub = el(
    "div",
    { class: "ws-unteransicht", role: "group", "aria-labelledby": titelId },
    kopf,
    el("div", { class: "blatt-inhalt" }, inhalt),
    fusszeile && el("div", { class: "blatt-fuss" }, fusszeile),
  );
  const versteckt = [...blatt.children].filter((k) => !k.hidden);
  for (const k of versteckt) k.hidden = true;
  blatt.append(sub);
  sub.close = () => {
    if (!sub.isConnected) return;
    sub.remove();
    for (const k of versteckt) k.hidden = false;
    sub.dispatchEvent(new Event("close"));
    if (ausloeser?.isConnected) ausloeser.focus({ preventScroll: true });
  };
  sub.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    sub.close();
  });
  (
    sub.querySelector(".blatt-inhalt input, .blatt-inhalt textarea") ?? h2
  ).focus();
  return sub;
}

// Ein Panel aus der Seite heraus öffnen: ein schon offenes Panel (Baustein, Zugriff, Bild) schliesst zuerst, nie zwei nebeneinander.
// Hat das offene Panel ungespeicherte Eingaben, fragt es selbst («Änderungen verwerfen?») und das neue öffnet nicht; liefert dann false
export function schliesseOffenePanels() {
  for (const panel of document.querySelectorAll("aside.fluss-panel")) {
    panel.versuchSchliessen?.();
  }
  return !document.querySelector("aside.fluss-panel");
}
