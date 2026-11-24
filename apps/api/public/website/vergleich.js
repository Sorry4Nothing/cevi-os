// Bildvergleich (#742): Der Baustein «bildvergleich» steht im Markup als zwei Bilder mit Bezeichnung, nebeneinander oder untereinander. Dieses Skript legt «Vorher» über «Nachher» und ergänzt einen Schieber.
// Der Schieber ist ein echtes <input type="range"> (Tastatur, Screenreader, Zeigen und Wischen kommen vom Browser); das Skript setzt nur --v-pos am Bild. Ohne Skript bleibt die Seite vollständig.
// Keine Bibliothek, kein innerHTML, keine Abrufe. Bildvergleiche, die später dazukommen (geschützte Bausteine), rüstet der MutationObserver aus.
(function () {
  "use strict";
  // Ein Druck auf eine Pfeiltaste bewegt die Kante um so viel Prozent
  var SCHRITT = 5;

  function rueste(wurzel) {
    var bilder = wurzel.querySelector(".vergleich-bilder");
    if (!bilder || wurzel.classList.contains("v-aktiv")) return;
    var text = function (klasse, vorgabe) {
      var f = bilder.querySelector(klasse + " figcaption");
      return f && f.textContent ? f.textContent : vorgabe;
    };
    var vorher = text(".v-vorher", "Vorher");
    var nachher = text(".v-nachher", "Nachher");

    var regler = document.createElement("input");
    regler.type = "range";
    regler.className = "v-regler";
    regler.min = "0";
    regler.max = "100";
    regler.step = "1";
    regler.value = "50";
    regler.setAttribute(
      "aria-label",
      "Schieber: " + vorher + " und " + nachher + " vergleichen",
    );
    var griff = document.createElement("div");
    griff.className = "v-griff";
    griff.setAttribute("aria-hidden", "true");
    griff.appendChild(document.createElement("div")).className = "v-knopf";

    function setze() {
      var p = Number(regler.value);
      // Eigenschaft per Skript, nicht als style-Attribut im Markup: Die CSP lässt keines zu
      bilder.style.setProperty("--v-pos", p + "%");
      regler.setAttribute(
        "aria-valuetext",
        p + " Prozent " + vorher + ", " + (100 - p) + " Prozent " + nachher,
      );
    }
    regler.addEventListener("input", setze);
    // Pfeiltasten in grösseren Schritten; Pos1 und Ende kennt das Feld selbst
    regler.addEventListener("keydown", function (e) {
      var richtung =
        e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : e.key === "ArrowRight" || e.key === "ArrowUp"
            ? 1
            : 0;
      if (richtung === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      regler.value = String(
        Math.max(0, Math.min(100, Number(regler.value) + richtung * SCHRITT)),
      );
      setze();
    });

    bilder.appendChild(regler);
    bilder.appendChild(griff);
    wurzel.classList.add("v-aktiv");
    setze();
  }

  function alle(wurzel) {
    var liste = wurzel.querySelectorAll(".vergleich");
    for (var i = 0; i < liste.length; i++) rueste(liste[i]);
  }

  alle(document);
  if (typeof window.MutationObserver === "function") {
    new window.MutationObserver(function () {
      alle(document);
    }).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
