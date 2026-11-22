// Bilder-Karussell (#550). Ohne dieses Skript ist der Baustein eine Liste von Bildern. Mit Skript zeigt er ein Bild, blendet alle 6 Sekunden zum nächsten über und bietet Knöpfe.
// Barrierefreiheit (WCAG 2.2.2, 2.3.3, 2.1.1): sichtbarer Pause-Knopf, Pause bei Fokus und Zeigen, nie ein Wechsel von selbst bei «Bewegung reduzieren», Pfeiltasten, Wechsel per Überblenden. Die Live-Region meldet den Wechsel nur, solange das Karussell nicht von selbst läuft.
// Keine Bibliothek, kein innerHTML, keine Abrufe: Die Bilder stehen schon im Markup.
(function () {
  var INTERVALL_MS = 6000;
  var SVG = "http://www.w3.org/2000/svg";
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");

  function element(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text) e.textContent = text;
    return e;
  }

  function symbol(pfad) {
    var s = document.createElementNS(SVG, "svg");
    s.setAttribute("class", "i");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(SVG, "path");
    p.setAttribute("d", pfad);
    s.appendChild(p);
    return s;
  }

  var PFADE = {
    zurueck: "M15 5l-7 7 7 7",
    weiter: "M9 5l7 7-7 7",
    pause: "M9 5v14M15 5v14",
    start: "M7 4.5v15l12-7.5z",
  };

  function knopf(klasse, name, pfad) {
    var k = element("button", klasse);
    k.type = "button";
    if (pfad) k.appendChild(symbol(pfad));
    k.appendChild(element("span", null, name));
    return k;
  }

  function baue(wurzel) {
    var liste = wurzel.querySelector(".folien");
    var folien = liste ? Array.prototype.slice.call(liste.children) : [];
    if (folien.length < 2) return;

    var aktuell = 0;
    var timer = null;
    // Die Person hat angehalten (Knopf); Fokus und Zeigen halten nur vorübergehend an
    var angehalten = false;
    var zeigt = false;
    var fokus = false;

    var punkte = folien.map(function (_, i) {
      var p = element("button", "punkt");
      p.type = "button";
      p.setAttribute("aria-label", "Bild " + (i + 1) + " von " + folien.length);
      p.appendChild(element("span", "kreis"));
      p.addEventListener("click", function () {
        zeige(i);
      });
      return p;
    });
    var zurueck = knopf("pfeil", "Vorheriges Bild", PFADE.zurueck);
    var weiter = knopf("pfeil", "Nächstes Bild", PFADE.weiter);
    var pause = knopf("pause", "Pause", PFADE.pause);
    var punktListe = element("div", "punkte");
    punkte.forEach(function (p) {
      punktListe.appendChild(p);
    });

    var steuerung = element("div", "steuerung");
    steuerung.appendChild(zurueck);
    steuerung.appendChild(punktListe);
    steuerung.appendChild(weiter);
    steuerung.appendChild(pause);
    wurzel.appendChild(steuerung);
    wurzel.classList.add("karussell--aktiv");

    function laeuft() {
      return !reduziert.matches && !angehalten && !zeigt && !fokus;
    }

    function zeige(i) {
      aktuell = (i + folien.length) % folien.length;
      folien.forEach(function (f, n) {
        if (n === aktuell) f.setAttribute("data-aktiv", "");
        else f.removeAttribute("data-aktiv");
      });
      punkte.forEach(function (p, n) {
        if (n === aktuell) p.setAttribute("aria-current", "true");
        else p.removeAttribute("aria-current");
      });
      neuStarten();
    }

    function aktualisiere() {
      // Läuft das Karussell von selbst, würde die Live-Region alle 6 Sekunden sprechen: dann aus
      liste.setAttribute("aria-live", laeuft() ? "off" : "polite");
      pause.hidden = reduziert.matches;
      var an = !angehalten;
      pause.querySelector("span").textContent = an ? "Pause" : "Start";
      pause.replaceChild(
        symbol(an ? PFADE.pause : PFADE.start),
        pause.querySelector("svg"),
      );
    }

    function neuStarten() {
      window.clearTimeout(timer);
      timer = null;
      aktualisiere();
      if (laeuft()) {
        timer = window.setTimeout(function () {
          zeige(aktuell + 1);
        }, INTERVALL_MS);
      }
    }

    zurueck.addEventListener("click", function () {
      zeige(aktuell - 1);
    });
    weiter.addEventListener("click", function () {
      zeige(aktuell + 1);
    });
    pause.addEventListener("click", function () {
      angehalten = !angehalten;
      neuStarten();
    });
    wurzel.addEventListener("mouseenter", function () {
      zeigt = true;
      neuStarten();
    });
    wurzel.addEventListener("mouseleave", function () {
      zeigt = false;
      neuStarten();
    });
    wurzel.addEventListener("focusin", function () {
      fokus = true;
      neuStarten();
    });
    wurzel.addEventListener("focusout", function (e) {
      if (!wurzel.contains(e.relatedTarget)) {
        fokus = false;
        neuStarten();
      }
    });
    // Pfeiltasten auf der Gruppe: Die Knöpfe nutzen sie sonst nicht
    wurzel.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        zeige(aktuell - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        zeige(aktuell + 1);
      }
    });
    // Wer «Bewegung reduzieren» später einschaltet, verliert die Automatik sofort
    reduziert.addEventListener("change", neuStarten);

    zeige(0);
  }

  function start() {
    var alle = document.querySelectorAll(".karussell");
    for (var i = 0; i < alle.length; i++) baue(alle[i]);
  }
  // Das Skript ist deferred: Das Markup steht schon
  start();
})();
