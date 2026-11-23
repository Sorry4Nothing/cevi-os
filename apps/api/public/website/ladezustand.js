// Ladezustand der Bilder (#574). Klassisches Skript im <head>: Die Klasse «ladebild» steht auf <html>, bevor das erste Bild gezeichnet wird.
// Ohne Skript gilt nichts davon: Bilder erscheinen, wie der Browser sie zeichnet, und ihr Platz ist durch width und height reserviert.
// Der Stil (website.css, Abschnitt «Ladezustände») zeigt für jedes Bild ohne Marke ein ruhiges Skelett in seiner Form. Dieses Skript setzt die Marke:
//   data-da      geladen
//   data-fehlt   nicht geladen: ruhige Fläche mit Symbol und Alt-Text (die Quelle liegt dann in data-quelle)
// Ein Bild aus dem Cache blendet nicht ein und zeigt nie ein Skelett: Das Skelett erscheint erst nach 150 ms (Stil), das Bild ist vorher da.
(function () {
  "use strict";
  var wurzel = document.documentElement;
  // Ab dieser Ladezeit hat man das Skelett gesehen: Dann blendet das Bild ein, sonst steht es einfach da
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
    if (bild.hasAttribute("data-da") || bild.hasAttribute("data-fehlt")) return;
    bild.setAttribute("data-da", "");
    // Vom Ton des Skeletts zum Bild: eine Web-Animation, die den Animationen und Übergängen der Bausteine nicht in die Quere kommt
    if (!ruhig && bild.animate && dauer(bild) >= SICHTBAR_MS) {
      bild.animate(
        [
          { filter: "contrast(0) brightness(var(--bild-flach))" },
          { filter: "none" },
        ],
        { duration: BLENDE_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      );
    }
  }

  // Das Zeichen der Fläche liegt als Datei neben diesem Skript; die Quelle des Bildes wartet in data-quelle auf den nächsten Versuch
  var ERSATZ = "/website/bild-fehlt.svg";

  function fehlt(bild) {
    var quelle = bild.getAttribute("src");
    if (quelle === ERSATZ || bild.hasAttribute("data-fehlt")) return;
    if (quelle) bild.setAttribute("data-quelle", quelle);
    bild.removeAttribute("data-da");
    bild.setAttribute("data-fehlt", "");
    bild.setAttribute("src", ERSATZ);
  }

  // Wieder im Netz: Was nicht kam, wird noch einmal geholt
  function nochmals() {
    var bilder = document.querySelectorAll("img[data-fehlt][data-quelle]");
    for (var i = 0; i < bilder.length; i++) {
      bilder[i].removeAttribute("data-fehlt");
      bilder[i].setAttribute("src", bilder[i].getAttribute("data-quelle"));
    }
  }

  function pruefe(bild) {
    if (!bild.complete || !bild.getAttribute("src")) return;
    if (bild.hasAttribute("data-fehlt")) return;
    if (bild.naturalWidth > 0) da(bild);
    else fehlt(bild);
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
      if (e.target && e.target.tagName === "IMG") fehlt(e.target);
    },
    true,
  );
  // Was die Zuhörer verpasst haben (zurück aus dem Seitenspeicher des Browsers, Bild vor dem Zuhörer fertig), holt der Durchgang nach: Nichts bleibt im Ladezustand
  document.addEventListener("DOMContentLoaded", alle);
  window.addEventListener("load", alle);
  window.addEventListener("pageshow", alle);
  window.addEventListener("online", nochmals);
  // Erst jetzt gilt der Stil: Wäre oben etwas schiefgegangen, blieben die Bilder, wie der Browser sie zeichnet
  wurzel.classList.add("ladebild");
})();
