// Bilder-Karussell (#559). Das Markup ist ein Bildstreifen, der seitwärts scrollt (karussell.css): ohne dieses Skript mit Wischen, Bildlaufleiste und Tastatur benutzbar.
// Das Skript ergänzt Lineal, Stand («02 / 06»), Vor und Zurück, Pause und den Wechsel von selbst. Es bewegt nur scrollLeft des Streifens: Wischen und Scrollen bleiben Sache des Browsers.
// Barrierefreiheit (WCAG 2.2.2, 2.3.3, 2.1.1): sichtbarer Pause-Knopf, Halt bei Fokus und Zeigen und ausserhalb des Bildschirms, nie ein Wechsel von selbst bei «Bewegung reduzieren» (dann auch kein Gleiten), Pfeiltasten. Die Live-Region meldet den Stand nur, solange das Karussell nicht von selbst läuft.
// Keine Bibliothek, kein innerHTML, keine Abrufe: Die Bilder stehen schon im Markup.
(function () {
  var SVG = "http://www.w3.org/2000/svg";
  // Wie --dauer in website.css
  var BLENDE_MS = 200;
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Wie der Symbolsatz der Website (symbole.ts): Linie und gefülltes Dreieck für die Richtung («pfeil», für Zurück gespiegelt), gefüllte Formen für Pause und Start
  var LINIEN = { zurueck: "M21 12H9", weiter: "M3 12h12" };
  var FORMEN = {
    zurueck: "M10 6 2.5 12l7.5 6z",
    weiter: "M14 6l7.5 6-7.5 6z",
    pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
    start: "M7.5 4.5v15L20 12z",
  };

  function element(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text) e.textContent = text;
    return e;
  }

  function symbol(name) {
    var s = document.createElementNS(SVG, "svg");
    s.setAttribute("class", "i");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    if (LINIEN[name]) {
      s.appendChild(document.createElementNS(SVG, "path")).setAttribute(
        "d",
        LINIEN[name],
      );
    }
    var form = s.appendChild(document.createElementNS(SVG, "path"));
    form.setAttribute("class", "f");
    form.setAttribute("d", FORMEN[name]);
    return s;
  }

  function knopf(klasse, zeichen, name) {
    var k = element("button", klasse);
    k.type = "button";
    k.appendChild(symbol(zeichen));
    if (name) k.setAttribute("aria-label", name);
    return k;
  }

  var zwei = function (n) {
    return n < 10 ? "0" + n : String(n);
  };

  function baue(wurzel) {
    var liste = wurzel.querySelector(".folien");
    var stand = wurzel.querySelector(".k-stand");
    var folien = liste ? Array.prototype.slice.call(liste.children) : [];
    if (folien.length < 2 || wurzel.classList.contains("karussell--aktiv")) {
      return;
    }
    // Ein nachgeladenes Karussell (geschützter Baustein) kommt ohne diese Attribute
    wurzel.setAttribute("role", "group");
    wurzel.setAttribute("aria-roledescription", "Karussell");
    if (!wurzel.hasAttribute("aria-label")) {
      wurzel.setAttribute("aria-label", "Bilder");
    }
    liste.tabIndex = 0;
    if (!stand) stand = wurzel.appendChild(element("p", "k-stand"));

    var aktuell = -1;
    // Die Person hat angehalten (Knopf); Zeigen, Fokus und «nicht im Bild» halten nur vorübergehend an
    var angehalten = false;
    var zeigt = false;
    var fokus = false;
    var imBild = false;
    var scrollTimer = null;
    var blendeTimer = null;

    var teile = element("div", "k-teile");
    teile.setAttribute("aria-hidden", "true");
    var teil = folien.map(function () {
      var t = teile.appendChild(element("span", "k-teil"));
      t.appendChild(element("span", "k-fuell"));
      return t;
    });

    var zahl = element("span", "k-zahl");
    zahl.setAttribute("aria-hidden", "true");
    var zahlAktuell = zahl.appendChild(document.createTextNode(""));
    zahl.appendChild(element("span", null, "/ " + zwei(folien.length)));
    var ansage = element("span", "nur-sr");
    stand.replaceChildren(zahl, ansage);

    var pause = knopf("k-pause", "pause");
    var pauseText = pause.appendChild(element("span", null, "Pause"));
    var zurueck = knopf("k-zurueck", "zurueck", "Vorheriges Bild");
    var weiter = knopf("k-weiter", "weiter", "Nächstes Bild");
    var pfeile = element("div", "k-pfeile");
    pfeile.appendChild(zurueck);
    pfeile.appendChild(weiter);
    var knoepfe = element("div", "k-knoepfe");
    knoepfe.appendChild(pause);
    knoepfe.appendChild(pfeile);

    wurzel.insertBefore(teile, stand);
    wurzel.appendChild(knoepfe);
    wurzel.classList.add("karussell--aktiv");

    function laeuft() {
      return !reduziert.matches && !angehalten;
    }

    // Wohin der Streifen für ein Bild scrollt: seine linke Kante, höchstens bis ans Ende (die letzten Bilder stehen dann rechts an)
    function ziel(i) {
      return Math.min(
        folien[i].offsetLeft,
        liste.scrollWidth - liste.clientWidth,
      );
    }

    function aktualisiere() {
      var an = laeuft();
      if (!an) wurzel.removeAttribute("data-lauf");
      else {
        wurzel.setAttribute(
          "data-lauf",
          zeigt || fokus || !imBild ? "halt" : "an",
        );
      }
      // Läuft das Karussell von selbst, würde die Live-Region alle paar Sekunden sprechen: dann aus
      stand.setAttribute("aria-live", an ? "off" : "polite");
      pause.hidden = reduziert.matches;
      pauseText.textContent = angehalten ? "Start" : "Pause";
      pause
        .querySelector("path")
        .setAttribute("d", angehalten ? FORMEN.start : FORMEN.pause);
    }

    function markiere(i) {
      if (i === aktuell) return;
      aktuell = i;
      folien.forEach(function (f, n) {
        f.toggleAttribute("data-aktiv", n === i);
        teil[n].toggleAttribute("data-aktiv", n === i);
      });
      zahlAktuell.data = zwei(i + 1);
      ansage.textContent = "Bild " + (i + 1) + " von " + folien.length;
    }

    function zeige(i) {
      i = (i + folien.length) % folien.length;
      // Ein weiter Weg (vom letzten Bild zurück zum ersten) würde am Auge vorbeirasen: ausblenden, springen, einblenden
      var weit =
        Math.abs(ziel(i) - liste.scrollLeft) > liste.clientWidth * 1.5 &&
        !reduziert.matches;
      markiere(i);
      window.clearTimeout(blendeTimer);
      if (!weit) {
        liste.removeAttribute("data-blende");
        liste.scrollTo({
          left: ziel(i),
          behavior: reduziert.matches ? "auto" : "smooth",
        });
        return;
      }
      liste.setAttribute("data-blende", "");
      blendeTimer = window.setTimeout(function () {
        liste.scrollTo({ left: ziel(aktuell), behavior: "auto" });
        liste.removeAttribute("data-blende");
      }, BLENDE_MS);
    }

    // Nach Wischen oder Scrollen: das Bild, dessen Ziel der Stelle am nächsten liegt. Teilen sich mehrere Bilder das Ende, bleibt das gewählte
    function liesStelle() {
      var x = liste.scrollLeft;
      var naechstes = 0;
      folien.forEach(function (_, n) {
        if (Math.abs(ziel(n) - x) < Math.abs(ziel(naechstes) - x)) {
          naechstes = n;
        }
      });
      if (ziel(naechstes) !== ziel(aktuell)) markiere(naechstes);
    }

    liste.addEventListener(
      "scroll",
      function () {
        window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(liesStelle, 120);
      },
      { passive: true },
    );
    // Der aktuelle Abschnitt des Lineals ist gefüllt: Zeit für das nächste Bild
    teile.addEventListener("animationend", function () {
      if (laeuft()) zeige(aktuell + 1);
    });
    folien.forEach(function (f, n) {
      f.addEventListener("click", function () {
        if (n !== aktuell) zeige(n);
      });
    });
    zurueck.addEventListener("click", function () {
      zeige(aktuell - 1);
    });
    weiter.addEventListener("click", function () {
      zeige(aktuell + 1);
    });
    pause.addEventListener("click", function () {
      angehalten = !angehalten;
      aktualisiere();
    });
    // Nur die Maus «zeigt»: Nach einem Tippen am Handy bliebe das Karussell sonst stehen
    wurzel.addEventListener("pointerenter", function (e) {
      zeigt = e.pointerType === "mouse";
      aktualisiere();
    });
    wurzel.addEventListener("pointerleave", function () {
      zeigt = false;
      aktualisiere();
    });
    wurzel.addEventListener("focusin", function () {
      fokus = true;
      aktualisiere();
    });
    wurzel.addEventListener("focusout", function (e) {
      if (!wurzel.contains(e.relatedTarget)) {
        fokus = false;
        aktualisiere();
      }
    });
    // Pfeiltasten wechseln das Bild, statt den Streifen stückweise zu schieben
    wurzel.addEventListener("keydown", function (e) {
      var schritt = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (schritt) {
        e.preventDefault();
        zeige(aktuell + schritt);
      }
    });
    // Wer «Bewegung reduzieren» später einschaltet, verliert die Automatik sofort
    reduziert.addEventListener("change", aktualisiere);
    // Ausserhalb des Bildschirms läuft nichts weiter
    if ("IntersectionObserver" in window) {
      new window.IntersectionObserver(
        function (e) {
          imBild = e[e.length - 1].isIntersecting;
          aktualisiere();
        },
        { threshold: 0.5 },
      ).observe(wurzel);
    } else imBild = true;

    markiere(0);
    aktualisiere();
  }

  function alle() {
    var k = document.querySelectorAll(".karussell");
    for (var i = 0; i < k.length; i++) baue(k[i]);
  }
  // Das Skript ist deferred: Das Markup steht schon
  alle();
  // Geschützte Bausteine kommen nach der Anmeldung nach (geschuetzt.js)
  if (document.querySelector("[data-geschuetzt], [data-huelle]")) {
    new window.MutationObserver(alle).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
})();
