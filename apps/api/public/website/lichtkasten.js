// Grossansicht für Bilder (#559): Ein Bild ist im Markup ein Link auf die Bilddatei («a.bildgross»). Dieses Skript öffnet es stattdessen gross über der Seite.
// Die Bilder desselben Karussells, derselben Galerie, desselben Bildrasters oder Bildstreifens bilden eine Folge mit Vor und Zurück; ein einzelnes Bild steht allein.
// Ein natives <dialog> (showModal): Es hält den Fokus innen, macht die Seite dahinter untätig und schliesst mit Esc. Schliessen auch per Knopf und per Klick neben das Bild; der Fokus geht zurück aufs Bild.
// Andere Skripte erfahren davon über die Ereignisse «lichtkasten:auf» und «lichtkasten:zu» am Dokument (detail.link: der Link des zuletzt gezeigten Bildes).
// Keine Bibliothek, kein innerHTML, keine Abrufe ausser dem Bild selbst (eigene Herkunft). Links, die später dazukommen (geschützte Bausteine), gelten von selbst: Das Skript hört am Dokument.
// Fotos in voller Qualität (#867): Trägt der Link «data-srcset» (Dateien mit echter Breite) und «data-masse» (Breite und Höhe der grössten), füllt das Bild den freien Platz mit seinem Seitenverhältnis, nie grösser als die grösste Datei in CSS-Pixeln. Sofort steht das Bild der Kachel als Vorschau, die scharfe Datei für Anzeigegrösse mal Pixeldichte ersetzt es, sobald sie geladen ist; die Grösse ändert sich dabei nicht.
// «data-laden» (JSON: Name, Masse, Adresse) gibt die Grössen zum Herunterladen: ein Knopf «Herunterladen» mit einer Liste von Links (details wie das Konto-Menü; Pfeile, Esc schliesst die Liste zuerst).
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
    laden: "M12 3v9M5 20h14",
  };
  var FORMEN = {
    zurueck: "M10 6 2.5 12l7.5 6z",
    weiter: "M14 6l7.5 6-7.5 6z",
    laden: "M7 11l5 6 5-6z",
  };
  // Nur Adressen unseres Servers kommen in die Liste zum Herunterladen
  var LADEN_ADRESSE =
    /^\/api\/v1\/fotos\/alben\/[0-9]{1,20}\/bilder\/[0-9]{1,20}\?/;

  function element(tag, klasse) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    return e;
  }

  function knopf(klasse, zeichen, name) {
    var k = element("button", klasse);
    k.type = "button";
    k.setAttribute("aria-label", name);
    k.appendChild(symbol(zeichen));
    return k;
  }

  function symbol(zeichen) {
    var s = document.createElementNS(SVG, "svg");
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
    return s;
  }

  var dialog = null;
  var bild, text, stand, zurueck, weiter, zu, figur, laden, ladenListe;
  var folge = [];
  var stelle = 0;
  var zuTimer = null;
  var vorlader = new window.Image();
  // Der Link, dessen Bild gerade steht; die scharfe Datei (Stufen, Masse der grössten) und die Breite, für die sie geladen ist
  var gezeigt = null;
  var scharf = null;
  var geladenFuer = 0;
  // Zählt die Bilder: Eine Datei, die erst nach dem Weiterblättern ankommt, ersetzt nichts mehr
  var lauf = 0;

  // Masse aus «data-masse» («4096 2731»), sonst null
  function masseVon(link) {
    var m = (link.getAttribute("data-masse") || "").split(" ").map(Number);
    var srcset = link.getAttribute("data-srcset");
    return srcset && m.length === 2 && m[0] > 0 && m[1] > 0
      ? { srcset: srcset, b: m[0], h: m[1] }
      : null;
  }

  // Die Grösse in CSS-Pixeln, in der ein Bild mit diesen Massen den freien Platz der Figur füllt: ganz sichtbar, nie grösser als die Datei
  function einpassen(m) {
    var s = window.getComputedStyle(figur);
    // clientWidth und clientHeight runden auf ganze Pixel, auch auf: ein Pixel Reserve, damit max-width und max-height nie greifen
    var platzB =
      figur.clientWidth -
      1 -
      parseFloat(s.paddingLeft) -
      parseFloat(s.paddingRight);
    var platzH =
      figur.clientHeight -
      1 -
      parseFloat(s.paddingTop) -
      parseFloat(s.paddingBottom) -
      (text.hidden ? 0 : text.offsetHeight + (parseFloat(s.rowGap) || 0));
    var f = Math.min(platzB / m.b, platzH / m.h, 1);
    return {
      b: Math.max(1, Math.floor(m.b * f)),
      h: Math.max(1, Math.floor(m.h * f)),
    };
  }

  // Holt die Datei, die der Browser für diese Breite wählt (srcset und sizes), und setzt sie, sobald sie entschlüsselt ist
  function ladeScharf() {
    var nr = ++lauf;
    var datei = new window.Image();
    geladenFuer = bild.width;
    datei.sizes = bild.width + "px";
    datei.srcset = scharf.srcset;
    datei.decode().then(
      function () {
        if (nr !== lauf) return;
        bild.src = datei.currentSrc;
        bild.removeAttribute("data-laedt");
      },
      function () {
        // Kein Netz oder zu viele Anfragen: Die Vorschau bleibt stehen
        if (nr === lauf) bild.removeAttribute("data-laedt");
      },
    );
  }

  // Grösse des Fensters geändert: neu einpassen; braucht das Bild mehr Pixel, kommt die grössere Datei
  function beiGroesse() {
    if (!dialog || !dialog.open || !scharf) return;
    var g = einpassen(scharf);
    bild.width = g.b;
    bild.height = g.h;
    if (g.b > geladenFuer) ladeScharf();
  }

  function schliesseLaden(fokus) {
    if (!laden.open) return;
    laden.open = false;
    if (fokus) laden.querySelector("summary").focus();
  }

  // Die Liste zum Herunterladen für einen Link; ohne Einträge steht der Knopf nicht
  function fuelleLaden(link) {
    var eintraege;
    try {
      eintraege = JSON.parse(link.getAttribute("data-laden") || "[]");
    } catch {
      eintraege = [];
    }
    laden.open = false;
    ladenListe.replaceChildren();
    (Array.isArray(eintraege) ? eintraege : []).forEach(function (x) {
      if (
        !x ||
        typeof x.name !== "string" ||
        typeof x.masse !== "string" ||
        typeof x.href !== "string" ||
        !LADEN_ADRESSE.test(x.href)
      ) {
        return;
      }
      var a = element("a", "lk-laden-eintrag");
      a.href = x.href;
      a.setAttribute("download", "");
      a.appendChild(element("span", "lk-laden-name")).textContent = x.name;
      a.appendChild(element("span", "lk-laden-masse")).textContent = x.masse;
      a.appendChild(element("span", "nur-sr")).textContent = " Pixel";
      ladenListe.appendChild(element("li")).appendChild(a);
    });
    laden.hidden = ladenListe.childElementCount === 0;
  }

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
    figur = dialog.appendChild(element("figure", "lk-figur"));
    bild = figur.appendChild(element("img"));
    text = figur.appendChild(element("figcaption"));
    var leiste = dialog.appendChild(element("div", "lk-leiste"));
    stand = leiste.appendChild(element("p", "lk-stand"));
    stand.setAttribute("aria-live", "polite");
    var aktionen = leiste.appendChild(element("div", "lk-aktionen"));
    laden = aktionen.appendChild(element("details", "lk-laden"));
    laden.hidden = true;
    var ladenKnopf = laden.appendChild(element("summary", "lk-laden-knopf"));
    ladenKnopf.appendChild(symbol("laden"));
    ladenKnopf.appendChild(element("span", "lk-laden-text")).textContent =
      "Herunterladen";
    ladenListe = laden.appendChild(element("ul", "lk-laden-liste"));
    ladenListe.setAttribute("aria-label", "Grösse wählen");
    var pfeile = aktionen.appendChild(element("div", "k-pfeile"));
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
    // Klick neben das Bild: Das Ziel ist dann der Dialog selbst oder die Figur, nicht Bild, Text oder Knopf. Ein Klick ausserhalb der Liste zum Herunterladen schliesst sie
    dialog.addEventListener("click", function (e) {
      if (laden.open && !laden.contains(e.target)) schliesseLaden(false);
      if (e.target === dialog || e.target === figur) schliesse();
    });
    // Esc: schliesst zuerst die offene Liste, sonst erst ruhig ausblenden, dann schliessen
    dialog.addEventListener("cancel", function (e) {
      e.preventDefault();
      if (laden.open) schliesseLaden(true);
      else schliesse();
    });
    dialog.addEventListener("keydown", function (e) {
      if (laden.contains(e.target)) return;
      var schritt = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (schritt && folge.length > 1) {
        e.preventDefault();
        zeige(stelle + schritt);
      }
    });
    // In der Liste: Pfeile auf und ab, Pos1 und Ende; Tab aus der Liste hinaus schliesst sie
    laden.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var links = Array.prototype.slice.call(ladenListe.querySelectorAll("a"));
      var i = links.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        laden.open = true;
        var schritt = e.key === "ArrowDown" ? 1 : -1;
        links[
          i < 0
            ? schritt > 0
              ? 0
              : links.length - 1
            : (i + schritt + links.length) % links.length
        ].focus();
      } else if (e.key === "Home" && i >= 0) links[0].focus();
      else if (e.key === "End" && i >= 0) links[links.length - 1].focus();
      else return;
      e.preventDefault();
    });
    laden.addEventListener("focusout", function (e) {
      if (e.relatedTarget && !laden.contains(e.relatedTarget)) {
        laden.open = false;
      }
    });
    // Nach der Wahl schliesst die Liste; der Browser lädt die Datei herunter
    ladenListe.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) {
        window.setTimeout(function () {
          schliesseLaden(true);
        }, 0);
      }
    });
    window.addEventListener("resize", beiGroesse);
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
    // Ein dekoratives Bild im Link (alt="") bekommt den Namen des Links, damit das grosse Bild einen hat («Foto 3 von 393»)
    var alt = (quelle && quelle.alt) || link.getAttribute("aria-label") || "";
    // Die Unterschrift des Bildes; wiederholt sie nur den Alt-Text, hören Screenreader sie nicht doppelt. Vor dem Bild: Sie nimmt ihm Platz weg
    text.textContent = unterschrift ? unterschrift.textContent : "";
    text.hidden = text.textContent === "";
    if (text.textContent === alt) text.setAttribute("aria-hidden", "true");
    else text.removeAttribute("aria-hidden");
    if (gezeigt !== link) {
      gezeigt = link;
      lauf++;
      bild.alt = alt;
      scharf = masseVon(link);
      bild.classList.toggle("lk-passend", scharf !== null);
      bild.removeAttribute("src");
      bild.setAttribute("data-laedt", "");
      if (scharf) {
        // Die Grösse steht fest, bevor eine Datei da ist: Vorschau und scharfe Datei füllen denselben Platz
        var g = einpassen(scharf);
        bild.width = g.b;
        bild.height = g.h;
        // Vorschau: die Datei der Kachel, die schon im Browser ist
        if (quelle && quelle.complete && quelle.naturalWidth > 0) {
          bild.src = quelle.currentSrc;
        }
        ladeScharf();
      } else {
        // Die Masse der Datei (Attribute, nicht die gezeigte Grösse): So steht der Platz fest, bevor das Bild geladen ist
        ["width", "height"].forEach(function (mass) {
          var wert = quelle && quelle.getAttribute(mass);
          if (wert) bild.setAttribute(mass, wert);
          else bild.removeAttribute(mass);
        });
        bild.src = link.getAttribute("href");
      }
      fuelleLaden(link);
    }
    var mehrere = folge.length > 1;
    stand.textContent = mehrere
      ? "Bild " + (stelle + 1) + " von " + folge.length
      : "";
    zurueck.parentNode.hidden = !mehrere;
    // Das nächste Bild schon holen, damit das Blättern nicht wartet; in der Grösse, in der es erscheinen wird
    if (mehrere) {
      var naechster = folge[(stelle + 1) % folge.length];
      var m = masseVon(naechster);
      vorlader = new window.Image();
      if (m) {
        vorlader.sizes = einpassen(m).b + "px";
        vorlader.srcset = m.srcset;
      } else {
        vorlader.src = naechster.getAttribute("href");
      }
    }
  }

  function oeffne(link) {
    if (!dialog) baue();
    window.clearTimeout(zuTimer);
    dialog.removeAttribute("data-zu");
    // Die Folge: alle Bilder desselben Karussells oder derselben Galerie, sonst das Bild allein
    var gruppe = link.closest(
      ".karussell, .galerie, .bildraster, .bildstreifen, .fotos-raster",
    );
    // Hat die Gruppe einen Namen (aria-label), trägt ihn der Dialog: «Fotos im Album Herbstlager: Grossansicht»
    var name = gruppe && gruppe.getAttribute("aria-label");
    dialog.setAttribute(
      "aria-label",
      name ? name + ": Grossansicht" : "Bild gross",
    );
    folge = gruppe
      ? Array.prototype.slice.call(gruppe.querySelectorAll("a.bildgross"))
      : [link];
    gezeigt = null;
    // Erst offen, dann zeigen: Das Einpassen misst den Platz im offenen Dialog
    if (!dialog.open) dialog.showModal();
    zeige(Math.max(0, folge.indexOf(link)));
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
