// Darstellung der Website (#550, #555, #558): Hell oder Dunkel. Ohne gespeicherte Wahl (und ohne dieses Skript) folgt die Seite dem System (prefers-color-scheme).
// Die Wahl liegt nur im Browser (localStorage), nie in einem Cookie und nie auf dem Server; gespeichert wird erst beim Klick. Das Skript steht im <head> und setzt data-theme auf <html> noch vor dem ersten Zeichnen, damit nichts aufblitzt.
// Klassisches Skript ohne Module und ohne Abhängigkeit: Es muss laufen, bevor die Seite sichtbar wird.
(function () {
  var SCHLUESSEL = "cevi-darstellung";
  var wurzel = document.documentElement;

  function lies() {
    try {
      var w = window.localStorage.getItem(SCHLUESSEL);
      return w === "light" || w === "dark" ? w : null;
    } catch {
      // Browser ohne Speicher (privates Fenster, gesperrt): Die Seite folgt dem System
      return null;
    }
  }

  // Was die Seite gerade zeigt: die gespeicherte Wahl, sonst das, was das System verlangt
  function wirksam() {
    var w = lies();
    if (w) return w;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
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
      window.localStorage.setItem(SCHLUESSEL, wahl);
    } catch {
      // Die Wahl gilt dann nur, bis die Seite neu lädt
    }
  }

  wende(lies());

  // Merker von konto-menue.js (#669): Gab es in diesem Tab eine Sitzung, verbirgt kopf.css «Anmelden», bis die Antwort da ist, damit der Knopf nicht kurz aufblitzt. Kein Name, nur «ja»
  try {
    if (window.sessionStorage.getItem("cevi-konto") === "1") {
      wurzel.setAttribute("data-konto", "erwartet");
      // Kommt keine Antwort (Netz, Skript fehlt), ist «Anmelden» nach zwei Sekunden wieder da
      window.setTimeout(function () {
        wurzel.removeAttribute("data-konto");
      }, 2000);
    }
  } catch {
    // Ohne Speicher gibt es keinen Merker
  }

  // Die Verwaltung baut ihren Kopf erst nach dem Laden und ruft binde() danach selbst auf (#578); auf der Website läuft es einmal nach dem Laden der Seite
  var aktuell = wirksam();
  var beobachtet = false;

  function markiere() {
    var knoepfe = document.querySelectorAll(".thema button[data-thema]");
    for (var i = 0; i < knoepfe.length; i++) {
      knoepfe[i].setAttribute(
        "aria-pressed",
        knoepfe[i].getAttribute("data-thema") === aktuell ? "true" : "false",
      );
    }
  }

  function klick(e) {
    aktuell = e.currentTarget.getAttribute("data-thema");
    speichere(aktuell);
    var wechsle = function () {
      wende(aktuell);
      markiere();
    };
    // Tag und Nacht blenden ineinander über (View Transition), wo der Browser es kann und Bewegung erwünscht ist; sonst wechselt die Seite sofort
    if (
      document.startViewTransition &&
      window.matchMedia &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      document.startViewTransition(wechsle);
    } else {
      wechsle();
    }
  }

  // Der Umschalter steht im Band und, für schmale Fenster, noch einmal im Menü (#558): alle zeigen denselben Stand. Mehrfaches Aufrufen schadet nicht.
  function binde() {
    var gruppen = document.querySelectorAll(".thema");
    if (gruppen.length === 0) return;
    var knoepfe = document.querySelectorAll(".thema button[data-thema]");
    for (var i = 0; i < knoepfe.length; i++) {
      if (knoepfe[i].gebunden) continue;
      knoepfe[i].gebunden = true;
      knoepfe[i].addEventListener("click", klick);
    }
    if (!beobachtet) {
      beobachtet = true;
      // Eine Wahl in einem anderen Tab gilt auch hier
      window.addEventListener("storage", function (e) {
        if (e.key !== SCHLUESSEL && e.key !== null) return;
        wende(lies());
        aktuell = wirksam();
        markiere();
      });
      // Ohne gespeicherte Wahl folgt die Markierung dem System, auch wenn es sich ändert
      if (window.matchMedia) {
        var system = window.matchMedia("(prefers-color-scheme: dark)");
        var folge = function () {
          if (lies()) return;
          aktuell = wirksam();
          markiere();
        };
        if (system.addEventListener) system.addEventListener("change", folge);
      }
    }
    for (var g = 0; g < gruppen.length; g++) gruppen[g].hidden = false;
    aktuell = wirksam();
    markiere();
  }

  window.ceviThema = { binde: binde };
  document.addEventListener("DOMContentLoaded", binde);
})();
