// Grossansicht für Bilder (#559): Ein Bild ist im Markup ein Link auf die Bilddatei («a.bildgross»). Dieses Skript öffnet es stattdessen gross über der Seite.
// Die Bilder desselben Karussells oder derselben Galerie bilden eine Folge mit Vor und Zurück; ein einzelnes Bild steht allein.
// Ein natives <dialog> (showModal): Es hält den Fokus innen, macht die Seite dahinter untätig und schliesst mit Esc. Schliessen auch per Knopf und per Klick neben das Bild; der Fokus geht zurück aufs Bild.
// Andere Skripte erfahren davon über die Ereignisse «lichtkasten:auf» und «lichtkasten:zu» am Dokument (detail.link: der Link des zuletzt gezeigten Bildes).
// Keine Bibliothek, kein innerHTML, keine Abrufe ausser dem Bild selbst (eigene Herkunft). Links, die später dazukommen (geschützte Bausteine), gelten von selbst: Das Skript hört am Dokument.
(function () {
  var SVG = "http://www.w3.org/2000/svg";
  // Ab so vielen Pixeln waagrecht zählt eine Berührung als Wischen
  var WISCH_PX = 48;
  // Wie --lk-dauer in lichtkasten.css
  var ZU_MS = 220;
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Wie der Symbolsatz der Website (symbole.ts)
  var LINIEN = {
    zurueck: "M21 12H9",
    weiter: "M3 12h12",
    schliessen: "M5 5l14 14M19 5 5 19",
  };
  var FORMEN = {
    zurueck: "M10 6 2.5 12l7.5 6z",
    weiter: "M14 6l7.5 6-7.5 6z",
  };

  function element(tag, klasse) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    return e;
  }

  function knopf(klasse, zeichen, name) {
    var k = element("button", klasse);
    k.type = "button";
    k.setAttribute("aria-label", name);
    var s = k.appendChild(document.createElementNS(SVG, "svg"));
    s.setAttribute("class", "i");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.appendChild(document.createElementNS(SVG, "path")).setAttribute(
      "d",
      LINIEN[zeichen],
    );
    if (FORMEN[zeichen]) {
      var f = s.appendChild(document.createElementNS(SVG, "path"));
      f.setAttribute("class", "f");
      f.setAttribute("d", FORMEN[zeichen]);
    }
    return k;
  }

  var dialog = null;
  var bild, text, stand, zurueck, weiter, zu;
  var folge = [];
  var stelle = 0;
  var zuTimer = null;

  function melde(name) {
    document.dispatchEvent(
      new window.CustomEvent(name, { detail: { link: folge[stelle] } }),
    );
  }

  function baue() {
    dialog = element("dialog", "lichtkasten");
    dialog.setAttribute("aria-label", "Bild gross");
    // Schliessen steht zuerst: Dort landet der Fokus beim Öffnen
    zu = dialog.appendChild(knopf("lk-zu", "schliessen", "Schliessen"));
    var figur = dialog.appendChild(element("figure", "lk-figur"));
    bild = figur.appendChild(element("img"));
    text = figur.appendChild(element("figcaption"));
    var leiste = dialog.appendChild(element("div", "lk-leiste"));
    stand = leiste.appendChild(element("p", "lk-stand"));
    stand.setAttribute("aria-live", "polite");
    var pfeile = leiste.appendChild(element("div", "k-pfeile"));
    zurueck = pfeile.appendChild(
      knopf("lk-zurueck", "zurueck", "Vorheriges Bild"),
    );
    weiter = pfeile.appendChild(knopf("lk-weiter", "weiter", "Nächstes Bild"));
    document.body.appendChild(dialog);

    zu.addEventListener("click", schliesse);
    zurueck.addEventListener("click", function () {
      zeige(stelle - 1);
    });
    weiter.addEventListener("click", function () {
      zeige(stelle + 1);
    });
    // Klick neben das Bild: Das Ziel ist dann der Dialog selbst oder die Figur, nicht Bild, Text oder Knopf
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog || e.target === figur) schliesse();
    });
    // Esc: erst ruhig ausblenden, dann schliessen
    dialog.addEventListener("cancel", function (e) {
      e.preventDefault();
      schliesse();
    });
    dialog.addEventListener("keydown", function (e) {
      var schritt = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (schritt && folge.length > 1) {
        e.preventDefault();
        zeige(stelle + schritt);
      }
    });
    // Wischen am Handy: ein zweiter Weg neben den Knöpfen
    var beginn = null;
    figur.addEventListener("pointerdown", function (e) {
      beginn = e.pointerType === "mouse" ? null : e.clientX;
    });
    figur.addEventListener("pointerup", function (e) {
      if (beginn === null || folge.length < 2) return;
      var weg = e.clientX - beginn;
      beginn = null;
      if (Math.abs(weg) >= WISCH_PX) zeige(stelle + (weg < 0 ? 1 : -1));
    });
    figur.addEventListener("pointercancel", function () {
      beginn = null;
    });
    // Das neue Bild blendet ein, sobald es geladen ist
    bild.addEventListener("load", function () {
      bild.removeAttribute("data-laedt");
    });
    bild.addEventListener("error", function () {
      bild.removeAttribute("data-laedt");
    });
  }

  function zeige(i) {
    stelle = (i + folge.length) % folge.length;
    var link = folge[stelle];
    var quelle = link.querySelector("img");
    var figur = link.closest("figure");
    var unterschrift = figur && figur.querySelector("figcaption");
    var alt = quelle ? quelle.alt : "";
    if (bild.getAttribute("src") !== link.getAttribute("href")) {
      bild.setAttribute("data-laedt", "");
      bild.alt = alt;
      // Die Masse der Datei (Attribute, nicht die gezeigte Grösse): So steht der Platz fest, bevor das Bild geladen ist
      ["width", "height"].forEach(function (mass) {
        var wert = quelle && quelle.getAttribute(mass);
        if (wert) bild.setAttribute(mass, wert);
        else bild.removeAttribute(mass);
      });
      bild.src = link.getAttribute("href");
    }
    // Die Unterschrift des Bildes; wiederholt sie nur den Alt-Text, hören Screenreader sie nicht doppelt
    text.textContent = unterschrift ? unterschrift.textContent : "";
    text.hidden = text.textContent === "";
    if (text.textContent === alt) text.setAttribute("aria-hidden", "true");
    else text.removeAttribute("aria-hidden");
    var mehrere = folge.length > 1;
    stand.textContent = mehrere
      ? "Bild " + (stelle + 1) + " von " + folge.length
      : "";
    zurueck.parentNode.hidden = !mehrere;
  }

  function oeffne(link) {
    if (!dialog) baue();
    window.clearTimeout(zuTimer);
    dialog.removeAttribute("data-zu");
    // Die Folge: alle Bilder desselben Karussells oder derselben Galerie, sonst das Bild allein
    var gruppe = link.closest(".karussell, .galerie");
    folge = gruppe
      ? Array.prototype.slice.call(gruppe.querySelectorAll("a.bildgross"))
      : [link];
    bild.removeAttribute("src");
    zeige(Math.max(0, folge.indexOf(link)));
    if (!dialog.open) dialog.showModal();
    melde("lichtkasten:auf");
  }

  function schliesse() {
    if (!dialog || !dialog.open || dialog.hasAttribute("data-zu")) return;
    var fertig = function () {
      dialog.removeAttribute("data-zu");
      dialog.close();
      melde("lichtkasten:zu");
      // Zurück aufs Bild, das zuletzt gross war (ein Karussell hat inzwischen dorthin gewechselt)
      var link = folge[stelle];
      if (link && link.isConnected) link.focus({ preventScroll: true });
    };
    if (reduziert.matches) return fertig();
    dialog.setAttribute("data-zu", "");
    zuTimer = window.setTimeout(fertig, ZU_MS);
  }

  document.addEventListener("click", function (e) {
    // Mit Zusatztaste oder mittlerer Taste bleibt der Link ein Link (neuer Tab); hat ein anderes Skript den Klick schon verbraucht, auch
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      typeof window.HTMLDialogElement !== "function"
    ) {
      return;
    }
    var link = e.target.closest ? e.target.closest("a.bildgross") : null;
    if (!link) return;
    e.preventDefault();
    oeffne(link);
  });
})();
