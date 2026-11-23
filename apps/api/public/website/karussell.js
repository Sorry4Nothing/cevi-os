// Bilder-Karussell (#559). Das Markup ist ein Bildstreifen, der seitwärts scrollt (karussell.css): ohne dieses Skript mit Wischen, Bildlaufleiste und Tastatur benutzbar.
// Das Skript ergänzt Lineal, Stand («02 / 06»), Vor und Zurück, Anhalten und den Wechsel von selbst. Es bewegt nur scrollLeft des Streifens; Wischen und Scrollen bleiben Sache des Browsers, mit der Maus lässt sich der Streifen ziehen.
// Ob das Karussell läuft, entscheidet eine einzige Funktion (zustand): Knopf, Füllung des Lineals und der Wechsel selbst lesen nur sie. Nach jeder Handbedienung beginnt die Zeit des Bildes neu und es läuft von selbst weiter, ausser die Person hat mit dem Knopf angehalten.
// Barrierefreiheit (WCAG 2.2.2, 2.3.3, 2.1.1, 2.5.7): sichtbarer Knopf zum Anhalten, Halt bei Tastaturfokus, beim Zeigen mit der Maus, ausserhalb des Bildschirms und solange ein Bild gross offen ist; nie ein Wechsel von selbst bei «Bewegung reduzieren» (dann auch kein Gleiten); Pfeiltasten; Ziehen ist nie der einzige Weg. Die Live-Region meldet den Stand nur, solange das Karussell nicht von selbst läuft.
// Keine Bibliothek, kein innerHTML, keine Abrufe: Die Bilder stehen schon im Markup. Die Grossansicht eines Bildes ist ein eigenes Skript (lichtkasten.js).
(function () {
  var SVG = "http://www.w3.org/2000/svg";
  // Der Wechsel ist ruhig: Der Streifen gleitet so lange zum nächsten Bild (weich an- und auslaufend); wie --k-wechsel in karussell.css
  var GLEIT_MS = 1100;
  // Nach dem Loslassen beim Ziehen mit der Maus: kürzer, die Hand hat den Weg schon gemacht
  var RAST_MS = 500;
  // Ausblenden vor dem Sprung zurück zum ersten Bild; wie --k-blende in karussell.css
  var BLENDE_MS = 500;
  // So lange nach der letzten Bewegung von Hand gilt der Streifen als losgelassen
  var RUHE_MS = 160;
  // Ab so vielen Pixeln ist ein Druck mit der Maus ein Ziehen und kein Klick
  var ZIEH_PX = 6;
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Wie der Symbolsatz der Website (symbole.ts): Linie und gefülltes Dreieck für die Richtung («pfeil», für Zurück gespiegelt), gefüllte Formen für Anhalten und Weiterlaufen
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
    k.setAttribute("aria-label", name);
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
    if (!stand) stand = wurzel.appendChild(element("p", "k-stand"));
    // Der Link jedes Bildes (Grossansicht); mit der Maus zieht man den Streifen, nicht das Bild
    var links = folien.map(function (f) {
      var teile = f.querySelectorAll("a, img");
      for (var i = 0; i < teile.length; i++) teile[i].draggable = false;
      return f.querySelector("a");
    });

    var aktuell = -1;
    // Die Person hat mit dem Knopf angehalten: Nur der Knopf hebt das wieder auf
    var angehalten = false;
    // Die Person bewegt den Streifen gerade von Hand (Ziehen, Wischen, Rad, Bildlaufleiste)
    var hand = false;
    var gedrueckt = false;
    var imBild = false;
    var zeiger = "";
    var ruheTimer = null;
    var blendeTimer = null;
    var gleiten = 0;

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

    var pause = knopf("k-pause", "pause", "Anhalten");
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

    // Die eine Quelle: null = läuft nicht von selbst, «halt» = wartet (die Füllung des Lineals steht), «an» = läuft
    function zustand() {
      if (reduziert.matches || angehalten) return null;
      var fokus = document.activeElement;
      return hand ||
        !imBild ||
        document.querySelector("dialog.lichtkasten[open]") ||
        (zeiger === "mouse" && wurzel.matches(":hover")) ||
        (wurzel.contains(fokus) && fokus.matches(":focus-visible"))
        ? "halt"
        : "an";
    }

    function aktualisiere() {
      var z = zustand();
      if (z) wurzel.setAttribute("data-lauf", z);
      else wurzel.removeAttribute("data-lauf");
      // Läuft das Karussell von selbst, würde die Live-Region alle paar Sekunden sprechen: dann aus
      stand.setAttribute("aria-live", z ? "off" : "polite");
      pause.hidden = reduziert.matches;
      pause.setAttribute(
        "aria-label",
        angehalten ? "Weiterlaufen lassen" : "Anhalten",
      );
      pause
        .querySelector("path")
        .setAttribute("d", angehalten ? FORMEN.start : FORMEN.pause);
    }

    // Die Zeit des aktuellen Bildes beginnt neu (nach jeder Handbedienung): Die Füllung startet bei null
    function neuStart() {
      wurzel.removeAttribute("data-lauf");
      void wurzel.offsetWidth;
      aktualisiere();
    }

    // Wohin der Streifen für ein Bild scrollt: seine linke Kante, höchstens bis ans Ende (die letzten Bilder stehen dann rechts an)
    function ziel(i) {
      return Math.min(
        folien[i].offsetLeft,
        liste.scrollWidth - liste.clientWidth,
      );
    }

    function markiere(i) {
      if (i === aktuell) return;
      var fokusDrin = liste.contains(document.activeElement);
      aktuell = i;
      folien.forEach(function (f, n) {
        f.toggleAttribute("data-aktiv", n === i);
        teil[n].toggleAttribute("data-aktiv", n === i);
        // Nur das aktuelle Bild ist ein Halt für den Tabulator
        if (links[n]) links[n].tabIndex = n === i ? 0 : -1;
      });
      if (fokusDrin && links[i]) links[i].focus({ preventScroll: true });
      zahlAktuell.data = zwei(i + 1);
      ansage.textContent = "Bild " + (i + 1) + " von " + folien.length;
    }

    function halteGleiten() {
      window.cancelAnimationFrame(gleiten);
      gleiten = 0;
      liste.removeAttribute("data-gleitet");
    }

    // Eigenes Gleiten statt scrollTo({behavior: "smooth"}): Dessen Dauer bestimmt der Browser, und sie ist zu kurz. Solange es läuft, rastet der Streifen nicht ein (data-gleitet)
    function gleite(nach, dauer, danach) {
      var von = liste.scrollLeft;
      var beginn = null;
      liste.setAttribute("data-gleitet", "");
      function schritt(jetzt) {
        if (beginn === null) beginn = jetzt;
        var t = Math.min(1, (jetzt - beginn) / dauer);
        // Weich anlaufen und auslaufen (kubisch)
        var weich = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        liste.scrollLeft = von + (nach - von) * weich;
        if (t < 1) gleiten = window.requestAnimationFrame(schritt);
        else {
          halteGleiten();
          if (danach) danach();
        }
      }
      gleiten = window.requestAnimationFrame(schritt);
    }

    function zeige(i) {
      i = (i + folien.length) % folien.length;
      // Ein weiter Weg (vom letzten Bild zurück zum ersten) würde am Auge vorbeirasen: ausblenden, springen, einblenden. Von Ziel zu Ziel gemessen, nicht vom Ort: mitten im Gleiten ist der Ort noch unterwegs
      var weit =
        Math.abs(ziel(i) - ziel(Math.max(aktuell, 0))) >
          liste.clientWidth * 1.5 && !reduziert.matches;
      markiere(i);
      window.clearTimeout(blendeTimer);
      // Ein neuer Wechsel mitten im Gleiten läuft vom Ort weiter: nicht einrasten lassen, sonst springt der Streifen zurück
      window.cancelAnimationFrame(gleiten);
      gleiten = 0;
      if (weit) {
        liste.removeAttribute("data-gleitet");
        liste.setAttribute("data-blende", "");
        blendeTimer = window.setTimeout(function () {
          liste.scrollLeft = ziel(aktuell);
          liste.removeAttribute("data-blende");
        }, BLENDE_MS);
        return;
      }
      liste.removeAttribute("data-blende");
      if (reduziert.matches) {
        liste.removeAttribute("data-gleitet");
        liste.scrollLeft = ziel(i);
      } else gleite(ziel(i), GLEIT_MS);
    }

    // Das Bild, dessen Ziel der Stelle am nächsten liegt. Teilen sich mehrere Bilder das Ende, bleibt das gewählte
    function naechstes() {
      var x = liste.scrollLeft;
      var n = 0;
      folien.forEach(function (_, m) {
        if (Math.abs(ziel(m) - x) < Math.abs(ziel(n) - x)) n = m;
      });
      return ziel(n) === ziel(aktuell) ? aktuell : n;
    }

    // Die Hand ist am Streifen: Das Karussell wartet, bis sie ihn eine kurze Zeit in Ruhe lässt
    function beruehrt() {
      hand = true;
      window.clearTimeout(ruheTimer);
      ruheTimer = window.setTimeout(ruhe, RUHE_MS);
      aktualisiere();
    }

    // Losgelassen: Der Stand folgt der Stelle, die Zeit des Bildes beginnt neu
    function ruhe() {
      window.clearTimeout(ruheTimer);
      if (gedrueckt || gleiten) {
        ruheTimer = window.setTimeout(ruhe, RUHE_MS);
        return;
      }
      markiere(naechstes());
      hand = false;
      neuStart();
    }

    liste.addEventListener(
      "scroll",
      function () {
        // Bewegt das Skript selbst, gilt das gewählte Bild
        if (!gleiten && !liste.hasAttribute("data-blende")) beruehrt();
      },
      { passive: true },
    );
    // Rad und Berührung übernehmen sofort, auch mitten im Gleiten
    ["wheel", "touchstart"].forEach(function (art) {
      liste.addEventListener(
        art,
        function () {
          halteGleiten();
          beruehrt();
        },
        { passive: true },
      );
    });

    // Mit der Maus ziehen: Der Streifen folgt dem Zeiger und gleitet nach dem Loslassen zum nächsten Bild in Zugrichtung
    var zug = null;
    liste.addEventListener("pointerdown", function (e) {
      zeiger = e.pointerType;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      zug = { x: e.clientX, von: liste.scrollLeft, zieht: false };
    });
    liste.addEventListener("pointermove", function (e) {
      if (!zug) return;
      var weg = e.clientX - zug.x;
      if (!zug.zieht) {
        if (Math.abs(weg) < ZIEH_PX) return;
        zug.zieht = true;
        gedrueckt = true;
        window.cancelAnimationFrame(gleiten);
        gleiten = 0;
        liste.setAttribute("data-gleitet", "");
        liste.setAttribute("data-zieht", "");
        liste.setPointerCapture(e.pointerId);
        beruehrt();
      }
      liste.scrollLeft = zug.von - weg;
    });
    function loslassen(e) {
      if (!zug) return;
      var z = zug;
      zug = null;
      if (!z.zieht) return;
      liste.removeAttribute("data-zieht");
      gedrueckt = false;
      // Der Klick, der auf das Loslassen folgt, öffnet nichts und wechselt nichts
      schlucke = true;
      window.setTimeout(function () {
        schlucke = false;
      }, 0);
      var weg = e.clientX - z.x;
      var n = naechstes();
      // Ein deutlicher Zug geht mindestens ein Bild weiter, auch wenn das alte noch näher liegt
      if (n === aktuell && Math.abs(weg) > 40) {
        n = Math.max(0, Math.min(folien.length - 1, n + (weg < 0 ? 1 : -1)));
      }
      markiere(n);
      if (reduziert.matches) {
        liste.removeAttribute("data-gleitet");
        liste.scrollLeft = ziel(n);
        ruhe();
      } else gleite(ziel(n), RAST_MS, ruhe);
    }
    liste.addEventListener("pointerup", loslassen);
    liste.addEventListener("pointercancel", loslassen);
    var schlucke = false;
    liste.addEventListener(
      "click",
      function (e) {
        if (!schlucke) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );

    // Klick auf ein Nachbarbild holt es nach vorn; das aktuelle Bild öffnet sich gross (lichtkasten.js liest den Klick am Dokument)
    folien.forEach(function (f, n) {
      f.addEventListener("click", function (e) {
        if (n === aktuell) return;
        e.preventDefault();
        zeige(n);
        neuStart();
      });
    });
    // Der aktuelle Abschnitt des Lineals ist gefüllt: Zeit für das nächste Bild
    teile.addEventListener("animationend", function () {
      if (zustand() === "an") zeige(aktuell + 1);
    });
    zurueck.addEventListener("click", function () {
      zeige(aktuell - 1);
      neuStart();
    });
    weiter.addEventListener("click", function () {
      zeige(aktuell + 1);
      neuStart();
    });
    pause.addEventListener("click", function () {
      angehalten = !angehalten;
      neuStart();
    });
    // Pfeiltasten wechseln das Bild, statt den Streifen stückweise zu schieben
    wurzel.addEventListener("keydown", function (e) {
      var schritt = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (schritt) {
        e.preventDefault();
        zeige(aktuell + schritt);
        neuStart();
      }
    });
    // Alles, was den Zustand ändern kann, fragt ihn neu ab. Nur die Maus «zeigt»: Nach einem Tippen am Handy bliebe das Karussell sonst stehen
    ["pointerenter", "pointerleave", "pointerup", "pointercancel"].forEach(
      function (art) {
        wurzel.addEventListener(art, function (e) {
          zeiger = e.pointerType;
          aktualisiere();
        });
      },
    );
    wurzel.addEventListener("focusin", aktualisiere);
    wurzel.addEventListener("focusout", function () {
      // Der neue Fokus steht erst nach dem Ereignis fest
      window.setTimeout(aktualisiere, 0);
    });
    // Ein Bild ist gross offen: Das Karussell wartet. Beim Schliessen steht es beim Bild, das zuletzt gross war
    document.addEventListener("lichtkasten:auf", aktualisiere);
    document.addEventListener("lichtkasten:zu", function (e) {
      var n = links.indexOf(e.detail && e.detail.link);
      if (n >= 0 && n !== aktuell) {
        halteGleiten();
        markiere(n);
        liste.scrollLeft = ziel(n);
      }
      neuStart();
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
