// Bilder-Karussell (#550, Gestaltung #555). Ohne dieses Skript ist der Baustein eine Liste von Bildern. Mit Skript zeigt er ein Bild auf einer Bühne, wechselt alle 6 Sekunden zum nächsten und bietet darunter Knöpfe, einen Balken je Bild und den Zähler.
// Barrierefreiheit (WCAG 2.2.2, 2.3.3, 2.1.1, 2.5.1): sichtbarer Pause-Knopf, Pause bei Fokus und Zeigen, nie ein Wechsel von selbst bei «Bewegung reduzieren», Pfeiltasten; Wischen am Handy ist nur ein zweiter Weg neben den Knöpfen.
// Die Live-Region meldet den Wechsel nur, solange das Karussell nicht von selbst läuft. Die Bewegung selbst (Hereinschieben, laufender Balken) steht in website.css und gilt nur ohne «Bewegung reduzieren».
// Keine Bibliothek, kein innerHTML, keine Abrufe: Die Bilder stehen schon im Markup.
(function () {
  var INTERVALL_MS = 6000;
  // Ab so vielen Pixeln waagrecht zählt eine Berührung als Wischen
  var WISCH_PX = 48;
  var SVG = "http://www.w3.org/2000/svg";
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");

  function element(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text) e.textContent = text;
    return e;
  }

  // Gefüllte Formen wie im Symbolsatz der Website: Dreiecke zeigen die Richtung
  function symbol(pfad) {
    var s = document.createElementNS(SVG, "svg");
    s.setAttribute("class", "i");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(SVG, "path");
    p.setAttribute("class", "f");
    p.setAttribute("d", pfad);
    s.appendChild(p);
    return s;
  }

  var PFADE = {
    zurueck: "M16.5 5v14L6 12z",
    weiter: "M7.5 5v14L18 12z",
    pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
    start: "M7.5 4.5v15L20 12z",
  };

  function knopf(klasse, name, pfad) {
    var k = element("button", klasse);
    k.type = "button";
    k.appendChild(symbol(pfad));
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
      p.appendChild(element("span", "balken"));
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
    // Der Zähler ist nur fürs Auge: Die Balken tragen «Bild 2 von 6» als Namen
    var zaehler = element("span", "zaehler");
    zaehler.setAttribute("aria-hidden", "true");

    var steuerung = element("div", "steuerung");
    steuerung.appendChild(zurueck);
    steuerung.appendChild(weiter);
    steuerung.appendChild(punktListe);
    steuerung.appendChild(zaehler);
    steuerung.appendChild(pause);
    wurzel.appendChild(steuerung);
    wurzel.classList.add("karussell--aktiv");

    function laeuft() {
      return !reduziert.matches && !angehalten && !zeigt && !fokus;
    }

    // i: Nummer des Bildes; richtung: -1 schiebt von links herein, sonst von rechts
    function zeige(i, richtung) {
      var ziel = (i + folien.length) % folien.length;
      if (richtung === undefined) richtung = ziel < aktuell ? -1 : 1;
      wurzel.setAttribute("data-richtung", richtung < 0 ? "zurueck" : "vor");
      aktuell = ziel;
      folien.forEach(function (f, n) {
        if (n === aktuell) f.setAttribute("data-aktiv", "");
        else f.removeAttribute("data-aktiv");
      });
      punkte.forEach(function (p, n) {
        if (n === aktuell) p.setAttribute("aria-current", "true");
        else p.removeAttribute("aria-current");
      });
      zaehler.textContent = aktuell + 1 + " / " + folien.length;
      neuStarten();
    }

    function aktualisiere() {
      var an = laeuft();
      // Läuft das Karussell von selbst, würde die Live-Region alle 6 Sekunden sprechen: dann aus
      liste.setAttribute("aria-live", an ? "off" : "polite");
      // Der Balken des aktuellen Bildes füllt sich nur, solange die Zeit wirklich läuft; das Attribut neu zu setzen, startet ihn von vorn
      wurzel.removeAttribute("data-laeuft");
      if (an) {
        void wurzel.offsetWidth;
        wurzel.setAttribute("data-laeuft", "");
      }
      pause.hidden = reduziert.matches;
      pause.querySelector("span").textContent = angehalten ? "Start" : "Pause";
      pause.replaceChild(
        symbol(angehalten ? PFADE.start : PFADE.pause),
        pause.querySelector("svg"),
      );
    }

    function neuStarten() {
      window.clearTimeout(timer);
      timer = null;
      aktualisiere();
      if (laeuft()) {
        timer = window.setTimeout(function () {
          zeige(aktuell + 1, 1);
        }, INTERVALL_MS);
      }
    }

    zurueck.addEventListener("click", function () {
      zeige(aktuell - 1, -1);
    });
    weiter.addEventListener("click", function () {
      zeige(aktuell + 1, 1);
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
        zeige(aktuell - 1, -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        zeige(aktuell + 1, 1);
      }
    });
    // Wischen mit Finger oder Stift; senkrechtes Scrollen bleibt beim Browser (touch-action: pan-y im Stil)
    var beginn = null;
    liste.addEventListener("pointerdown", function (e) {
      beginn =
        e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY };
    });
    liste.addEventListener("pointerup", function (e) {
      if (!beginn) return;
      var dx = e.clientX - beginn.x;
      var dy = e.clientY - beginn.y;
      beginn = null;
      if (Math.abs(dx) < WISCH_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      zeige(aktuell + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });
    liste.addEventListener("pointercancel", function () {
      beginn = null;
    });
    // Wer «Bewegung reduzieren» später einschaltet, verliert die Automatik sofort
    reduziert.addEventListener("change", neuStarten);

    zeige(0, 1);
    // Das erste Bild steht schon da: Es schiebt sich nicht herein
    wurzel.removeAttribute("data-richtung");
  }

  function start() {
    var alle = document.querySelectorAll(".karussell");
    for (var i = 0; i < alle.length; i++) baue(alle[i]);
  }
  // Das Skript ist deferred: Das Markup steht schon
  start();
})();
