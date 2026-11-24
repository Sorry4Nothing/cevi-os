// Kasten «Dein Kalender-Link» im Reiter «Mein Kalender» (#530, Board W6): Status lesen, Link erzeugen oder ersetzen, kopieren.
// Der Server liefert den Link nur direkt nach dem Erzeugen (POST /ich/kalender-link); danach kennt er nur die letzten vier Zeichen. Darum zeigt der Kasten einen bestehenden Link nur verkürzt und lässt ihn erst nach «Link neu erzeugen» kopieren.
// Abfragen: einmal GET beim ersten Öffnen des Reiters, danach nur auf Klick.
import {
  api,
  baue,
  bandView,
  bestaetige,
  h,
  icon,
  ladeAnsage,
  melde,
  skelett,
  sk,
} from "./tm.js";

export const linkAdresse = (host, pfad) => `webcal://${host}${pfad}`;
export const linkVerkuerzt = (host, endung) =>
  `webcal://${host}/ical/…${endung}`;

export function linkLadeView() {
  return h(
    "section",
    {
      class: "karte linkkasten",
      "aria-busy": "true",
      "aria-label": "Dein Kalender-Link",
    },
    skelett(
      sk("t h24 bpx160"),
      sk("t b90"),
      sk("h52 b100"),
      sk("r h48 bpx160"),
    ),
  );
}

// z: { status: "ok"|"fehler", aktiv, endung, neu: {adresse}|null, meldung: "erzeugt"|"ersetzt"|null, fehler: text|null, arbeitet }
export function linkKastenView(z, host) {
  if (z.status === "laedt") return linkLadeView();
  const url = z.neu
    ? z.neu.adresse
    : z.aktiv
      ? linkVerkuerzt(host, z.endung)
      : "";
  const arbeit = z.arbeitet
    ? { "aria-disabled": "true", "aria-busy": "true" }
    : {};
  return h(
    "section",
    { class: "karte linkkasten", "aria-labelledby": "tm-link-t" },
    h("h2", { id: "tm-link-t" }, "Dein Kalender-Link"),
    h(
      "p",
      {},
      "Abonniere deine Termine in Handy oder Outlook. Der Link gehört nur dir.",
    ),
    z.fehler
      ? bandView({
          art: "fe",
          symbol: "warnung",
          titel: z.fehler.titel,
          text: z.fehler.text,
          rolle: "alert",
        })
      : null,
    z.meldung === "erzeugt"
      ? bandView({
          art: "ok",
          symbol: "haken",
          titel: "Link erzeugt.",
          text: "Kopiere ihn und füge ihn in deinem Kalender als Abo ein.",
        })
      : null,
    z.meldung === "ersetzt"
      ? bandView({
          art: "ok",
          symbol: "haken",
          titel: "Neuer Link erzeugt.",
          text: "Abonniere ihn in deinem Kalender neu.",
        })
      : null,
    z.aktiv || z.neu
      ? h(
          "div",
          { class: "linkfeld" },
          h(
            "label",
            { class: "nur-leser", for: "tm-link-feld" },
            "Dein Kalender-Link",
          ),
          h("input", {
            class: "eingabe",
            id: "tm-link-feld",
            type: "text",
            readonly: true,
            value: url,
          }),
          z.neu
            ? h(
                "button",
                {
                  type: "button",
                  class: "btn s",
                  "data-aktion": "link:kopieren",
                  "data-f": "link-kopieren",
                },
                icon("kopieren"),
                "Link kopieren",
              )
            : null,
        )
      : null,
    z.aktiv && !z.neu
      ? h(
          "p",
          { class: "hilfe" },
          "Aus Sicherheitsgründen zeigen wir den ganzen Link nur direkt nach dem Erzeugen.",
        )
      : null,
    h(
      "div",
      {},
      z.aktiv
        ? h(
            "button",
            {
              type: "button",
              class: "btn t",
              "data-aktion": "link:neu",
              "data-f": "link-neu",
              ...arbeit,
            },
            icon("neu"),
            "Link neu erzeugen",
          )
        : h(
            "button",
            {
              type: "button",
              class: "btn p",
              "data-aktion": "link:neu",
              "data-f": "link-neu",
              ...arbeit,
            },
            icon("kalender"),
            "Link erzeugen",
          ),
      z.aktiv
        ? h(
            "p",
            { class: "hilfe" },
            "Der alte Link funktioniert danach nicht mehr.",
          )
        : null,
    ),
  );
}

const fehlerVon = (r) =>
  r.status === 429
    ? {
        titel: "Zu viele Versuche.",
        text: "Warte ein paar Minuten und versuche es nochmals.",
      }
    : r.status === 0
      ? {
          titel: "Keine Verbindung.",
          text: "Prüfe dein Internet und versuche es nochmals.",
        }
      : { titel: "Das hat nicht geklappt.", text: "Versuche es nochmals." };

// behaelter: das Element, in dem der Kasten steht (es bleibt, auch wenn der Reiter wechselt); gibt {oeffne} zurück
export function startLink(doc, behaelter, beiAbmeldung) {
  const host = doc.location.host;
  const z = {
    status: "laedt",
    aktiv: false,
    endung: null,
    neu: null,
    meldung: null,
    fehler: null,
    arbeitet: false,
  };
  let geladen = false;

  function zeichne() {
    const fokus = doc.activeElement?.dataset?.f;
    behaelter.replaceChildren(baue(doc, linkKastenView(z, host)));
    if (fokus) doc.querySelector(`[data-f="${fokus}"]`)?.focus();
  }

  async function ladeStatus() {
    z.status = "laedt";
    zeichne();
    const stopp = ladeAnsage(doc, "Dein Kalender-Link wird geladen.");
    const r = await api("/ich/kalender-link");
    stopp();
    if (r.status === 401) return beiAbmeldung();
    if (r.status === 200) {
      Object.assign(z, {
        status: "ok",
        aktiv: r.daten.aktiv,
        endung: r.daten.endung,
        fehler: null,
      });
    } else {
      Object.assign(z, { status: "ok", fehler: fehlerVon(r) });
    }
    zeichne();
  }

  async function erzeuge() {
    const hatte = z.aktiv;
    if (hatte) {
      const ja = await bestaetige(doc, behaelter, {
        titel: "Neuen Link erzeugen?",
        text: "Der alte Link funktioniert danach nicht mehr. Kalender, die ihn nutzen, musst du neu abonnieren.",
        ja: "Neu erzeugen",
      });
      if (!ja) return doc.querySelector('[data-f="link-neu"]')?.focus();
    }
    z.arbeitet = true;
    z.fehler = null;
    zeichne();
    const r = await api("/ich/kalender-link", { methode: "POST" });
    z.arbeitet = false;
    if (r.status === 201) {
      Object.assign(z, {
        aktiv: true,
        endung: r.daten.endung,
        neu: { adresse: linkAdresse(host, r.daten.pfad) },
        meldung: hatte ? "ersetzt" : "erzeugt",
      });
      melde(doc, hatte ? "Neuer Link erzeugt." : "Link erzeugt.");
    } else if (r.status === 401) {
      return beiAbmeldung();
    } else {
      z.fehler = fehlerVon(r);
    }
    zeichne();
  }

  async function kopiere() {
    const feld = doc.getElementById("tm-link-feld");
    try {
      await doc.defaultView.navigator.clipboard.writeText(z.neu.adresse);
      zeigeSnack("Link kopiert");
    } catch {
      // Ohne Zwischenablage (kein https, Browser verweigert): Link markieren, die Person kopiert selbst
      feld?.focus();
      feld?.select();
      zeigeSnack("Link markiert. Kopiere ihn mit Strg+C.");
    }
  }

  // Die Meldung bleibt, bis die Person sie schliesst
  function zeigeSnack(text) {
    doc.getElementById("tm-snack")?.remove();
    const snack = baue(
      doc,
      h(
        "div",
        { class: "snack", id: "tm-snack", role: "status" },
        h("span", {}, text),
        h("button", { type: "button", "data-aktion": "snack:zu" }, "OK"),
      ),
    );
    snack.querySelector("button").addEventListener("click", () => {
      snack.remove();
      doc.querySelector('[data-f="link-kopieren"]')?.focus();
    });
    behaelter.append(snack);
  }

  behaelter.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-aktion^='link:']");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    e.stopPropagation();
    if (b.dataset.aktion === "link:neu") erzeuge();
    else kopiere();
  });
  // Der Status wird erst geladen, wenn der Reiter «Mein Kalender» zum ersten Mal erscheint, und nur einmal
  return {
    oeffne() {
      if (geladen) return;
      geladen = true;
      ladeStatus();
    },
  };
}
