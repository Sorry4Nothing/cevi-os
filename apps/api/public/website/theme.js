// Darstellung der Website (#550): Hell, Dunkel oder System. Ohne dieses Skript folgt die Seite dem System (prefers-color-scheme).
// Die Wahl liegt nur im Browser (localStorage), nie in einem Cookie und nie auf dem Server. Das Skript steht im <head> und setzt data-theme auf <html> noch vor dem ersten Zeichnen, damit nichts aufblitzt.
// Klassisches Skript ohne Module und ohne Abhängigkeit: Es muss laufen, bevor die Seite sichtbar wird.
(function () {
  var SCHLUESSEL = "cevi-darstellung";
  var wurzel = document.documentElement;

  function lies() {
    try {
      var w = window.localStorage.getItem(SCHLUESSEL);
      return w === "light" || w === "dark" ? w : "system";
    } catch {
      // Browser ohne Speicher (privates Fenster, gesperrt): Die Seite folgt dem System
      return "system";
    }
  }

  function wende(wahl) {
    if (wahl === "light" || wahl === "dark") {
      wurzel.setAttribute("data-theme", wahl);
    } else {
      wurzel.removeAttribute("data-theme");
    }
  }

  function speichere(wahl) {
    try {
      if (wahl === "system") window.localStorage.removeItem(SCHLUESSEL);
      else window.localStorage.setItem(SCHLUESSEL, wahl);
    } catch {
      // Die Wahl gilt dann nur, bis die Seite neu lädt
    }
  }

  wende(lies());

  document.addEventListener("DOMContentLoaded", function () {
    var gruppe = document.querySelector(".thema");
    if (!gruppe) return;
    var knoepfe = gruppe.querySelectorAll("button[data-thema]");
    var aktuell = lies();

    function markiere() {
      for (var i = 0; i < knoepfe.length; i++) {
        knoepfe[i].setAttribute(
          "aria-pressed",
          knoepfe[i].getAttribute("data-thema") === aktuell ? "true" : "false",
        );
      }
    }

    for (var i = 0; i < knoepfe.length; i++) {
      knoepfe[i].addEventListener("click", function (e) {
        aktuell = e.currentTarget.getAttribute("data-thema");
        speichere(aktuell);
        wende(aktuell);
        markiere();
      });
    }
    // Eine Wahl in einem anderen Tab gilt auch hier
    window.addEventListener("storage", function (e) {
      if (e.key !== SCHLUESSEL && e.key !== null) return;
      aktuell = lies();
      wende(aktuell);
      markiere();
    });
    gruppe.hidden = false;
    markiere();
  });
})();
