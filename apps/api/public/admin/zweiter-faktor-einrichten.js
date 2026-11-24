// Zweiten Faktor einrichten (#715): derselbe Ablauf auf der Seite «Zweiten Faktor einrichten» (Pflicht, admin.js) und in «Mein Konto» (freiwillig, konto.js).
// Drei Schritte, die better-auth vorgibt: 1. Passwort bestätigen und enable (gibt Link und Ersatzcodes), 2. Code aus der App bestätigen (verify-totp, erst jetzt gilt der Faktor), 3. Ersatzcodes speichern. Der Schlüssel und die Ersatzcodes bleiben nur im Speicher dieser Seite und werden danach aus ihr gelöscht.

import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { ankreuzen, codefeld, el, feld, icon, knopf, neueId } from "./dom.js";
import { feldFehler } from "./liste-hilfen.js";
import { melde } from "./melden.js";
import { zeichneQr } from "./qr.js";

// Der geheime Schlüssel aus dem Link otpauth://…?secret=…; ohne ihn gibt es nichts einzurichten
export function schluesselAusLink(link) {
  try {
    return new URL(link).searchParams.get("secret") || null;
  } catch {
    return null;
  }
}

// «ABCD EFGH IJKL»: Gruppen zu vier Zeichen zum Abtippen
export function gruppiereSchluessel(schluessel) {
  return schluessel.match(/.{1,4}/g)?.join(" ") ?? "";
}

// Für den Screenreader jedes Zeichen einzeln, die Gruppen getrennt: «A B C D, E F G H»
export function sprichSchluessel(schluessel) {
  return gruppiereSchluessel(schluessel)
    .split(" ")
    .map((gruppe) => [...gruppe].join(" "))
    .join(", ");
}

const FEHLER_PASSWORT =
  "Das Passwort stimmt nicht. Prüfe es und versuche es nochmals.";
const FEHLER_CODE =
  "Der Code stimmt nicht. Prüfe ihn in der App und gib den aktuellen Code ein.";

// beiFertig: nach dem dritten Schritt (fertigText: Beschriftung des Knopfs dort); beiAbbruch: «Abbrechen» in den ersten beiden (ohne Angabe gibt es den Knopf nicht, die Pflichtseite hat nur «Abmelden»)
// Gibt { wurzel, fokus } zurück: Der Aufrufer hängt wurzel ein und ruft fokus() danach
export function erstelleEinrichtung({
  beiFertig,
  beiAbbruch,
  fertigText = "Fertig",
} = {}) {
  const wurzel = el("div", { class: "zf" });
  let ueberschrift = null;

  // Ein Schritt ersetzt den vorigen; der Fokus geht auf seine Überschrift
  const zeige = (schritt, titel, ...inhalt) => {
    ueberschrift = el("h2", { tabindex: "-1", class: "zf-titel" }, titel);
    wurzel.replaceChildren(
      el("p", { class: "ueber" }, `Schritt ${schritt} von 3`),
      ueberschrift,
      ...inhalt,
    );
    ueberschrift.focus();
  };

  const fehlerbox = () =>
    el("p", {
      class: "hinweis hinweis--fehler",
      role: "alert",
      hidden: true,
      tabindex: "-1",
    });
  const zeigeFehler = (box, text) => {
    box.textContent = text;
    box.hidden = false;
    box.focus();
  };
  const beschaeftigt = (knopfEl, an) => {
    knopfEl.disabled = an;
    if (an) knopfEl.setAttribute("aria-busy", "true");
    else knopfEl.removeAttribute("aria-busy");
  };
  const abbrechen = () =>
    beiAbbruch && knopf("Abbrechen", { art: "still", onclick: beiAbbruch });

  function schrittPasswort() {
    const passwort = feld({
      label: "Passwort",
      typ: "password",
      autocomplete: "current-password",
      hilfe: "Zur Sicherheit fragen wir nochmals nach deinem Passwort.",
      required: true,
    });
    const box = fehlerbox();
    const senden = el(
      "button",
      { type: "submit", class: "knopf knopf--haupt" },
      "Weiter",
    );
    const formular = el(
      "form",
      { class: "formular", novalidate: true },
      passwort.wurzel,
      box,
      el("div", { class: "zf-aktionen" }, senden, abbrechen()),
    );
    formular.addEventListener("submit", async (ereignis) => {
      ereignis.preventDefault();
      box.hidden = true;
      if (!passwort.eingabe.value) {
        feldFehler(passwort, "Gib dein Passwort ein.");
        passwort.eingabe.focus();
        return;
      }
      beschaeftigt(senden, true);
      try {
        const antwort = await anfrage("POST", "/api/auth/two-factor/enable", {
          password: passwort.eingabe.value,
        });
        passwort.eingabe.value = "";
        const schluessel = schluesselAusLink(antwort?.totpURI ?? "");
        if (!schluessel || !Array.isArray(antwort?.backupCodes)) {
          zeigeFehler(
            box,
            "Der Server hat keinen Schlüssel geliefert. Versuche es nochmals.",
          );
          return;
        }
        schrittScannen(antwort.totpURI, schluessel, antwort.backupCodes);
      } catch (f) {
        if (f instanceof ApiFehler && f.code === "INVALID_PASSWORD") {
          passwort.eingabe.value = "";
          feldFehler(passwort, FEHLER_PASSWORT);
          passwort.eingabe.focus();
        } else if (
          f instanceof ApiFehler &&
          f.code === "TOTP_ALREADY_ENABLED"
        ) {
          zeigeFehler(box, "Der zweite Faktor ist schon eingerichtet.");
        } else {
          zeigeFehler(box, fehlertext(f));
        }
      } finally {
        beschaeftigt(senden, false);
      }
    });
    zeige(
      1,
      "Passwort bestätigen",
      el(
        "p",
        {},
        "Mit dem zweiten Faktor gibst du beim Anmelden in der Verwaltung zusätzlich einen Code aus einer Authenticator-App ein. Du brauchst dafür eine solche App auf deinem Telefon.",
      ),
      formular,
    );
  }

  function schrittScannen(link, schluessel, ersatzcodes) {
    const kopieren = knopf("Schlüssel kopieren", {
      symbol: "kopieren",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(schluessel);
          melde("Schlüssel kopiert.");
        } catch {
          melde(
            "Kopieren ist nicht möglich. Markiere den Schlüssel von Hand.",
            "fehler",
          );
        }
      },
    });
    const schluesselId = neueId("zf-schluessel");
    const code = codefeld({
      label: "Code aus der App",
      hilfe: "Sechs Ziffern. Der Code wird nach der letzten Ziffer geprüft.",
      required: true,
    });
    const box = fehlerbox();
    const senden = el(
      "button",
      { type: "submit", class: "knopf knopf--haupt" },
      "Bestätigen",
    );
    const formular = el(
      "form",
      { class: "formular", novalidate: true },
      code.wurzel,
      box,
      el("div", { class: "zf-aktionen" }, senden, abbrechen()),
    );
    let laeuft = false;
    formular.addEventListener("submit", async (ereignis) => {
      ereignis.preventDefault();
      // Der Code löst das Formular bei der sechsten Ziffer aus; ein zweites Absenden während der Prüfung gäbe nur einen Fehler
      if (laeuft) return;
      box.hidden = true;
      const wert = code.eingabe.value.trim();
      if (wert.length !== 6) {
        feldFehler(code, "Gib die sechs Ziffern aus der App ein.");
        code.eingabe.focus();
        return;
      }
      laeuft = true;
      beschaeftigt(senden, true);
      try {
        await anfrage("POST", "/api/auth/two-factor/verify-totp", {
          code: wert,
        });
        schrittErsatzcodes(ersatzcodes);
      } catch (f) {
        if (f instanceof ApiFehler && f.code === "INVALID_CODE") {
          code.eingabe.value = "";
          code.eingabe.dispatchEvent(new window.Event("input"));
          feldFehler(code, FEHLER_CODE);
          code.eingabe.focus();
        } else {
          zeigeFehler(box, fehlertext(f));
        }
      } finally {
        laeuft = false;
        beschaeftigt(senden, false);
      }
    });
    zeige(
      2,
      "Konto in der App eintragen",
      el(
        "ol",
        { class: "zf-liste" },
        el(
          "li",
          {},
          "Öffne die Authenticator-App und füge ein neues Konto hinzu.",
        ),
        el(
          "li",
          {},
          "Scanne den QR-Code. Geht das nicht, gib den Schlüssel von Hand ein.",
        ),
        el("li", {}, "Gib unten den Code ein, den die App jetzt zeigt."),
      ),
      el(
        "div",
        { class: "zf-qr" },
        zeichneQr(link, {
          beschriftung:
            "QR-Code für die Authenticator-App. Den Schlüssel dazu findest du als Text darunter.",
        }),
      ),
      el(
        "div",
        { class: "zf-schluessel-block" },
        el(
          "p",
          { class: "zf-schluessel-label", id: `${schluesselId}-label` },
          "Schlüssel zum Abtippen",
        ),
        el(
          "p",
          {
            class: "zf-schluessel",
            "aria-labelledby": `${schluesselId}-label`,
          },
          el(
            "span",
            { "aria-hidden": "true" },
            gruppiereSchluessel(schluessel),
          ),
          el("span", { class: "nur-leser" }, sprichSchluessel(schluessel)),
        ),
        el(
          "p",
          { class: "hilfe" },
          "Gruppen zu vier Zeichen, Gross- und Kleinschreibung egal. Wähle in der App «zeitbasiert» mit sechs Ziffern und 30 Sekunden.",
        ),
        el("div", { class: "zf-aktionen" }, kopieren),
      ),
      formular,
    );
  }

  function schrittErsatzcodes(codes) {
    const liste = el(
      "ul",
      { class: "zf-codes", "aria-label": "Ersatzcodes" },
      codes.map((c) => el("li", {}, c)),
    );
    const kopieren = knopf("Ersatzcodes kopieren", {
      symbol: "kopieren",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(codes.join("\n"));
          melde("Ersatzcodes kopiert.");
        } catch {
          melde(
            "Kopieren ist nicht möglich. Markiere die Codes von Hand.",
            "fehler",
          );
        }
      },
    });
    const gespeichert = ankreuzen({
      label: "Ich habe die Ersatzcodes gespeichert.",
      wert: "gespeichert",
    });
    const fehler = el("p", {
      class: "pe-fehlertext",
      role: "alert",
      hidden: true,
    });
    const fertig = el(
      "button",
      { type: "button", class: "knopf knopf--haupt" },
      fertigText,
    );
    fertig.addEventListener("click", () => {
      if (!gespeichert.eingabe.checked) {
        fehler.replaceChildren(
          icon("warnung"),
          "Speichere die Ersatzcodes und setze das Häkchen, bevor du weitergehst.",
        );
        fehler.hidden = false;
        gespeichert.eingabe.focus();
        return;
      }
      // Die Codes verlassen die Seite nicht wieder
      liste.replaceChildren();
      codes.length = 0;
      wurzel.replaceChildren();
      beiFertig?.();
    });
    zeige(
      3,
      "Ersatzcodes speichern",
      el(
        "p",
        { class: "hinweis hinweis--ok" },
        "Der zweite Faktor ist eingerichtet.",
      ),
      el(
        "p",
        {},
        "Mit einem Ersatzcode meldest du dich an, wenn du dein Telefon nicht hast. Jeder Code gilt nur einmal. Speichere sie jetzt an einem sicheren Ort, zum Beispiel im Passwort-Manager. Danach kannst du sie nicht mehr abrufen.",
      ),
      liste,
      el("div", { class: "zf-aktionen" }, kopieren),
      gespeichert.wurzel,
      fehler,
      el("div", { class: "zf-aktionen" }, fertig),
    );
  }

  schrittPasswort();
  return { wurzel, fokus: () => ueberschrift?.focus() };
}
