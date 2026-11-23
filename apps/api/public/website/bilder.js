// Ladezustand der Bilder (#567). Klassisches Skript im <head>: Die Klasse «bilder» steht auf <html>, bevor das erste Bild gezeichnet wird.
// Ohne Skript gilt nichts davon: Bilder erscheinen, wie der Browser sie zeichnet, und ihr Platz ist durch width und height reserviert.
// Der Stil (laden.css) zeigt für jedes Bild ohne Marke einen Platzhalter in seiner Form. Dieses Skript setzt die Marke:
//   data-da          geladen (ohne Wert: sofort da; «start» und «neu»: blendet ein)
//   data-fehlt       nicht geladen: Feld mit dem Alt-Text
// Ein Bild aus dem Cache blendet nicht ein und flackert nicht: Es ist da, bevor der Platzhalter zu sehen wäre.
(function () {
  "use strict";
  var wurzel = document.documentElement;
  // Ab dieser Ladezeit hat man den Platzhalter gesehen: Dann blendet das Bild ein, sonst steht es einfach da
  var SICHTBAR_MS = 150;
  var BLENDE_MS = 500;
  var ruhig =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function dauer(bild) {
    try {
      var e = window.performance.getEntriesByName(bild.currentSrc || bild.src);
      return e.length > 0 ? e[e.length - 1].duration : 0;
    } catch {
      return 0;
    }
  }

  function da(bild) {
    if (bild.hasAttribute("data-da")) return;
    bild.removeAttribute("data-fehlt");
    if (ruhig || dauer(bild) < SICHTBAR_MS) {
      bild.setAttribute("data-da", "");
      return;
    }
    // Startzustand (eine Fläche im Ton des Platzhalters) festhalten, dann zum Bild überblenden
    bild.setAttribute("data-da", "start");
    void bild.offsetWidth;
    bild.setAttribute("data-da", "neu");
    // Danach gelten wieder die Übergänge des Bausteins (Zeigen, Karussell)
    setTimeout(function () {
      bild.setAttribute("data-da", "");
    }, BLENDE_MS + 100);
  }

  function pruefe(bild) {
    if (!bild.complete || !bild.getAttribute("src")) return;
    if (bild.naturalWidth > 0) da(bild);
    else bild.setAttribute("data-fehlt", "");
  }

  function alle() {
    var bilder = document.images;
    for (var i = 0; i < bilder.length; i++) pruefe(bilder[i]);
  }

  // load und error steigen nicht auf, lassen sich aber beim Absteigen abfangen: ein Zuhörer für alle Bilder, auch für später eingesetzte
  document.addEventListener(
    "load",
    function (e) {
      if (e.target && e.target.tagName === "IMG") da(e.target);
    },
    true,
  );
  document.addEventListener(
    "error",
    function (e) {
      if (e.target && e.target.tagName === "IMG") {
        e.target.removeAttribute("data-da");
        e.target.setAttribute("data-fehlt", "");
      }
    },
    true,
  );
  // Netz: Was die Zuhörer verpasst haben (zurück aus dem Seitenspeicher des Browsers), holt der Durchgang nach. Nichts bleibt im Ladezustand
  document.addEventListener("DOMContentLoaded", alle);
  window.addEventListener("load", alle);
  window.addEventListener("pageshow", alle);
  // Erst jetzt gilt der Stil: Wäre oben etwas schiefgegangen, blieben die Bilder, wie der Browser sie zeichnet
  wurzel.classList.add("bilder");
})();
