// Seite «Mein Konto» (#671): die eigene Person auf der Website. Dasselbe wie das Profil der App, über dieselben Routen.
// Startpasswort ändern (Pflicht beim ersten Mal), Datenschutz zur Kenntnis nehmen, Telefon, Mitteilungen der App, Passwort ändern, Abmelden.
// Routen: GET und PATCH /api/v1/ich, POST /api/v1/ich/datenschutz, POST /api/auth/change-password, /api/auth/revoke-sessions und /api/auth/sign-out.
// Abfragen: einmal GET /ich beim Öffnen; sonst nur beim Speichern. Kein Abruf im Takt. Das Passwort steht nur im Feld und im Body, nie in einer Adresse, und wird nach dem Senden geleert.
// Name, Cevi-Name und Benutzername ändert nur die Abteilungsleitung; sie stehen hier zum Lesen. Ein Profilbild lässt sich hier noch nicht ändern (die Website hat keinen Zuschneide-Dialog).
import {
  api,
  baue,
  fehlerView,
  h,
  icon,
  loginLink,
  ladeAnsage,
  melde,
  skelett,
  sk,
  zustandView,
} from "./tm.js";
import { merkeToast, toast } from "./toast.js";

export const PASSWORT_MIN = 12;
export const PASSWORT_MAX = 128;

const PUSHES = [
  {
    schluessel: "pushChat",
    text: "Neue Chat-Nachrichten",
    hilfe:
      "Ein Hinweis in der App, wenn in einem deiner Chats jemand schreibt.",
  },
  {
    schluessel: "pushProgramme",
    text: "Programme und Mitteilungen",
    hilfe: "Hinweise zu Programmen und Mitteilungen der Abteilung.",
  },
  {
    schluessel: "pushAnmeldungen",
    text: "An- und Abmeldungen",
    hilfe:
      "Wenn sich ein Kind für ein Programm deiner Stufe an- oder abmeldet.",
  },
];

const PASSWORT_FEHLER = {
  INVALID_PASSWORD: ["aktuell", "Das aktuelle Passwort stimmt nicht."],
  PASSWORD_TOO_SHORT: [
    "neu",
    `Das neue Passwort braucht mindestens ${PASSWORT_MIN} Zeichen.`,
  ],
  PASSWORD_TOO_LONG: [
    "neu",
    `Das neue Passwort darf höchstens ${PASSWORT_MAX} Zeichen haben.`,
  ],
  PASSWORT_UNVERAENDERT: [
    "neu",
    "Das neue Passwort muss sich vom bisherigen unterscheiden.",
  ],
  PASSWORD_COMPROMISED: [
    "neu",
    "Dieses Passwort stammt aus einem bekannten Datenleck. Wähle ein anderes.",
  ],
};

// --- Reine Funktionen (ohne Browser testbar)

// Prüfung vor dem Senden: [Feld, Text] oder null. pflicht: Das bisherige Passwort ist das Startpasswort
export function pruefePasswort({ aktuell, neu, pflicht = false }) {
  if (!aktuell) {
    return [
      "aktuell",
      pflicht
        ? "Gib dein Startpasswort ein."
        : "Gib dein aktuelles Passwort ein.",
    ];
  }
  if (neu.length < PASSWORT_MIN) {
    return [
      "neu",
      `Das neue Passwort braucht mindestens ${PASSWORT_MIN} Zeichen.`,
    ];
  }
  if (neu.length > PASSWORT_MAX) {
    return [
      "neu",
      `Das neue Passwort darf höchstens ${PASSWORT_MAX} Zeichen haben.`,
    ];
  }
  if (neu === aktuell) {
    return ["neu", "Das neue Passwort muss sich vom bisherigen unterscheiden."];
  }
  return null;
}

// Antwort von change-password → { feld, text } beim Feld oder { band } für alles andere; null heisst gespeichert
export function passwortAntwort(r, pflicht = false) {
  if (r.status === 200) return null;
  if (r.status === 0) {
    return {
      band: r.offline
        ? "Du bist offline. Das Passwort ist nicht geändert."
        : "Der Server antwortet nicht. Das Passwort ist nicht geändert.",
    };
  }
  if (r.status === 401) {
    return {
      band: "Du bist abgemeldet. Melde dich an und versuche es nochmals.",
    };
  }
  const bekannt = PASSWORT_FEHLER[r.daten?.code];
  if (bekannt) {
    const [feld, text] = bekannt;
    return {
      feld,
      text:
        pflicht && feld === "aktuell"
          ? "Das Startpasswort stimmt nicht."
          : text,
    };
  }
  if (r.status === 429) {
    return { band: "Zu viele Versuche. Warte kurz und versuche es nochmals." };
  }
  return { band: "Das hat nicht geklappt. Versuche es nochmals." };
}

// Telefon: Stufenleitungen speichern und ändern, alle anderen dürfen die Nummer nur entfernen (Regel der Route PATCH /ich)
// Ergebnis: { wert, fehler }; wert ist die Schreibweise zum Speichern ("" = entfernen)
export function pruefeTelefon({ eingabe, original, istStufenleitung }) {
  const wert = eingabe.trim();
  if (wert !== "" && !/^\+?\d[\d ()/.-]{4,28}\d$/.test(wert)) {
    return {
      wert,
      fehler:
        "Diese Nummer passt nicht. Schreibe sie zum Beispiel so: 079 123 45 67",
    };
  }
  if (!istStufenleitung && wert !== "" && wert !== (original ?? "")) {
    return {
      wert,
      fehler:
        "Eine Nummer speichern nur Stufenleitungen. Du kannst sie nur entfernen.",
    };
  }
  return { wert, fehler: null };
}

export const istStufenleitung = (p) =>
  p.rollen.some((r) => r.typ === "stufenleitung");

// Rollen im Klartext: «Abteilungsleitung», «Stufenleitung Artemis», «Leitung Artemis», «Elternteil»
export function rollenText(p) {
  const stufe = (id) => p.stufen.find((s) => s.id === id)?.name ?? "";
  const aus = [
    ...(p.abteilungsleitung ? ["Abteilungsleitung"] : []),
    ...p.rollen.map((r) =>
      `${r.typ === "stufenleitung" ? "Stufenleitung" : "Leitung"} ${stufe(r.stufeId)}`.trim(),
    ),
    ...(p.kinder.length > 0 ? ["Elternteil"] : []),
    ...(p.teilnehmer ? ["Teilnehmende"] : []),
  ];
  return aus;
}

// --- Ansichten
// Seite: links die Profilkarte, rechts die Abschnitte als Karten (kto-…, Stil in konto.css); schmal eine Spalte.
const feld = (id, label, { fehler, hilfe, control }) =>
  h(
    "div",
    { class: `feld${fehler ? " fehler" : ""}` },
    h("label", { for: id }, label),
    control,
    fehler
      ? h("p", { class: "fehlertext", id: `${id}-f` }, icon("warnung"), fehler)
      : null,
    hilfe,
  );

const beschr = (id, fehler, hilfe) =>
  [fehler ? `${id}-f` : null, hilfe ? `${id}-h` : null]
    .filter(Boolean)
    .join(" ") || null;

// Karte mit Titel und einem Satz darunter; hervor: Das Speichern hat diese Karte gerade geändert
const karte = (id, titel, lead, hervor, ...inhalt) =>
  h(
    "section",
    {
      class: `karte kto-karte${hervor ? " kto-hervor" : ""}`,
      "aria-labelledby": id,
    },
    h(
      "div",
      { class: "kto-kopf" },
      h("h2", { id }, titel),
      lead ? h("p", { class: "hilfe" }, lead) : null,
    ),
    inhalt,
  );

// «Lua Demo» → «LD»; nur Buchstaben, höchstens zwei
export const initialen = (name) =>
  String(name ?? "")
    .split(/\s+/)
    .filter((t) => /^\p{L}/u.test(t))
    .slice(0, 2)
    .map((t) => Array.from(t)[0])
    .join("")
    .toLocaleUpperCase("de-CH");

const TAG = new Intl.DateTimeFormat("de-CH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Zurich",
});

// Profilkarte: Porträt (Bild oder Initialen), Name, Rolle als Chips, Benutzername, bei Eltern die Kinder
export function profilKarte(p) {
  const rollen = rollenText(p);
  return h(
    "section",
    { class: "karte kto-profil", "aria-labelledby": "kt-profil-t" },
    h(
      "div",
      { class: "kto-portrait" },
      h(
        "span",
        { class: "kto-initialen", "aria-hidden": "true" },
        initialen(p.name),
      ),
      p.bildUrl
        ? h("img", { class: "kto-bild", src: p.bildUrl, alt: "" })
        : null,
    ),
    h(
      "div",
      { class: "kto-profil-text" },
      h("h2", { id: "kt-profil-t", class: "kto-name" }, p.name),
      p.ceviName ? h("p", { class: "kto-cevi" }, p.ceviName) : null,
      rollen.length
        ? h(
            "ul",
            { class: "chips", "aria-label": "Rollen" },
            rollen.map((r) => h("li", { class: "chip st" }, r)),
          )
        : null,
      h(
        "dl",
        { class: "kto-daten" },
        h("div", {}, h("dt", {}, "Benutzername"), h("dd", {}, p.benutzername)),
        p.kinder.length
          ? h(
              "div",
              {},
              h("dt", {}, p.kinder.length === 1 ? "Kind" : "Kinder"),
              h("dd", {}, p.kinder.map((k) => k.vorname).join(", ")),
            )
          : null,
      ),
      h(
        "p",
        { class: "hilfe" },
        "Name und Benutzername ändert die Abteilungsleitung.",
      ),
    ),
  );
}

// Hinweis zur Länge des neuen Passworts: Text mit Symbol und ein Balken (nie nur Farbe). Es zählt nur die Länge, keine Stärke
export function laengeHinweis(n) {
  const ok = n >= PASSWORT_MIN && n <= PASSWORT_MAX;
  const text =
    n === 0
      ? `Mindestens ${PASSWORT_MIN} Zeichen.`
      : n > PASSWORT_MAX
        ? `Zu lang: höchstens ${PASSWORT_MAX} Zeichen.`
        : n < PASSWORT_MIN
          ? `Noch ${PASSWORT_MIN - n} Zeichen bis zum Minimum von ${PASSWORT_MIN}.`
          : `Lang genug: ${n} Zeichen.`;
  return h(
    "div",
    { class: `kto-laenge${ok ? " ok" : ""}`, id: "kt-pw-neu-h" },
    h(
      "span",
      {
        class: `kto-balken l${Math.min(n, PASSWORT_MIN)}`,
        "aria-hidden": "true",
      },
      h("span", {}),
    ),
    h("p", { class: "hilfe" }, ok ? icon("haken") : null, text),
  );
}

// Passwortfeld mit Auge im Feld; das Auge zeigt oder verbirgt nur dieses Feld
const passwortFeld = (id, name, auto, s, fehler, hilfe) => {
  const zeigen = s.pw[`zeigen_${name}`] === true;
  return h(
    "div",
    { class: "kto-passwort" },
    h("input", {
      class: "eingabe",
      id,
      type: zeigen ? "text" : "password",
      value: s.pw[name],
      "data-name": `pw-${name}`,
      autocomplete: auto,
      spellcheck: "false",
      autocapitalize: "off",
      "aria-describedby": beschr(id, fehler, hilfe),
      "aria-invalid": fehler ? "true" : null,
      ...(s.pw.senden && { readonly: true }),
    }),
    h(
      "button",
      {
        type: "button",
        class: "kto-auge",
        "aria-label": zeigen ? "Passwort verbergen" : "Passwort anzeigen",
        "aria-pressed": zeigen ? "true" : "false",
        "data-aktion": "pw-zeigen",
        "data-feld": name,
      },
      icon(zeigen ? "auge-zu" : "auge", false),
    ),
  );
};

// Der Pflichtwechsel und der normale Wechsel teilen sich die Karte; nur Titel, Text und Beschriftung unterscheiden sich
export function passwortKarte(s) {
  const { pflicht, pw } = s;
  const f = pw.fehler;
  return karte(
    "kt-pw-t",
    pflicht ? "Wähle dein Passwort" : "Passwort ändern",
    pflicht
      ? "Du hast ein Startpasswort. Wähle zuerst ein eigenes. Danach kannst du die Seite nutzen."
      : "Auf allen anderen Geräten wirst du dabei abgemeldet.",
    s.markiert === "pw",
    h(
      "form",
      { class: "formular", novalidate: true, id: "kt-pw-form" },
      feld("kt-pw-aktuell", pflicht ? "Startpasswort" : "Aktuelles Passwort", {
        fehler: f.aktuell,
        control: passwortFeld(
          "kt-pw-aktuell",
          "aktuell",
          "current-password",
          s,
          f.aktuell,
          false,
        ),
      }),
      feld("kt-pw-neu", "Neues Passwort", {
        fehler: f.neu,
        control: passwortFeld(
          "kt-pw-neu",
          "neu",
          "new-password",
          s,
          f.neu,
          true,
        ),
        hilfe: laengeHinweis(Array.from(pw.neu).length),
      }),
      h(
        "div",
        { class: "kto-aktion" },
        h(
          "button",
          {
            type: "submit",
            class: "btn p gross",
            "aria-disabled": pw.senden ? "true" : null,
            "aria-busy": pw.senden ? "true" : null,
          },
          pw.senden ? "Speichere …" : "Passwort speichern",
        ),
      ),
    ),
  );
}

export function datenschutzKarte(s) {
  return karte(
    "kt-ds-t",
    "Datenschutz",
    "Bevor du weitermachst: Lies, wie die Abteilung mit Daten umgeht. Das Lesen ist keine Einwilligung. Du bestätigst nur, dass du es kennst.",
    false,
    h(
      "div",
      { class: "kto-aktion kto-aktion--zwei" },
      h(
        "a",
        {
          class: "btn s",
          href: "/datenschutz-website",
          target: "_blank",
          rel: "noopener",
        },
        "Datenschutzerklärung lesen",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn p",
          "data-aktion": "datenschutz",
          "aria-disabled": s.ds.senden ? "true" : null,
          "aria-busy": s.ds.senden ? "true" : null,
        },
        s.ds.senden ? "Speichere …" : "Zur Kenntnis genommen",
      ),
    ),
  );
}

export function telefonKarte(s) {
  const p = s.profil;
  const sl = istStufenleitung(p);
  const t = s.tel;
  // Wer keine Nummer hat und keine speichern darf, braucht den Abschnitt nicht (auch direkt nach dem Entfernen: der Toast meldet es)
  if (!sl && !p.telefon) return null;
  const knopf = (beschriftung, extra = {}) =>
    h(
      "button",
      {
        type: "submit",
        class: "btn p",
        "aria-disabled": t.senden ? "true" : null,
        "aria-busy": t.senden ? "true" : null,
        ...extra,
      },
      t.senden ? "Speichere …" : beschriftung,
    );
  return karte(
    "kt-tel-t",
    "Telefon",
    sl
      ? "Eltern deiner Stufe sehen die Nummer und können dich anrufen."
      : "Deine Nummer ist gespeichert. Du kannst sie nur entfernen.",
    s.markiert === "tel",
    h(
      "form",
      { class: "formular", novalidate: true, id: "kt-tel-form" },
      sl
        ? feld("kt-tel", "Telefonnummer", {
            fehler: t.fehler,
            hilfe: h(
              "p",
              { class: "hilfe", id: "kt-tel-h" },
              "Zum Beispiel 079 123 45 67.",
            ),
            control: h("input", {
              class: "eingabe",
              id: "kt-tel",
              type: "text",
              inputmode: "tel",
              autocomplete: "tel",
              value: t.wert,
              "data-name": "tel",
              "aria-describedby": beschr("kt-tel", t.fehler, true),
              "aria-invalid": t.fehler ? "true" : null,
              ...(t.senden && { readonly: true }),
            }),
          })
        : h("p", { class: "kto-nummer" }, p.telefon),
      h(
        "div",
        { class: "kto-aktion" },
        sl
          ? knopf(
              t.wert === "" && p.telefon
                ? "Nummer entfernen"
                : "Nummer speichern",
            )
          : knopf("Nummer entfernen", {
              "data-aktion": "tel-weg",
              type: "button",
            }),
      ),
    ),
  );
}

// Ein Schalter «Ein/Aus»: Text und Stellung des Knopfes, nie nur Farbe
export function schalter({ id, an, aktion, daten, gesperrt }) {
  return h(
    "button",
    {
      type: "button",
      role: "switch",
      class: "schalter",
      "aria-checked": an ? "true" : "false",
      "aria-labelledby": id,
      "aria-describedby": `${id}-h`,
      "aria-disabled": gesperrt ? "true" : null,
      "data-aktion": aktion,
      ...daten,
    },
    h(
      "span",
      { class: "schalter-text", "aria-hidden": "true" },
      an ? "Ein" : "Aus",
    ),
    h("span", { class: "schalter-spur", "aria-hidden": "true" }),
  );
}

export function mitteilungenKarte(s) {
  const p = s.profil;
  const liste = PUSHES.filter((e) => e.schluessel in p);
  return karte(
    "kt-push-t",
    "Mitteilungen in der App",
    "Diese Schalter gelten für die Cevi-OS-App auf deinem Handy. Im Browser gibt es keine Mitteilungen.",
    s.markiert === "push",
    h(
      "ul",
      { class: "kto-zeilen" },
      liste.map((e) => {
        const an = p[e.schluessel] === true;
        const id = `kt-${e.schluessel}`;
        return h(
          "li",
          { class: "kto-zeile" },
          h(
            "span",
            { class: "kto-zeile-text" },
            h("span", { class: "antwort-name", id }, e.text),
            h("span", { class: "hilfe", id: `${id}-h` }, e.hilfe),
          ),
          schalter({
            id,
            an,
            aktion: "push",
            gesperrt: s.push.senden,
            daten: {
              "data-schluessel": e.schluessel,
              "data-wert": an ? "0" : "1",
            },
          }),
        );
      }),
    ),
  );
}

// Datenschutzerklärung, Kalender, Hilfe, Konto löschen: Verweise, die es schon gibt
export function hilfeKarte(s) {
  const gelesen = s.profil.datenschutzGelesenAm;
  return karte(
    "kt-mehr-t",
    "Datenschutz und Hilfe",
    gelesen
      ? `Die Datenschutzerklärung hast du am ${TAG.format(new Date(gelesen))} zur Kenntnis genommen.`
      : null,
    false,
    h(
      "ul",
      { class: "linkliste" },
      [
        ["/datenschutz-website", "Datenschutzerklärung"],
        [
          "/datenschutz-cevi-os",
          "Datenschutz: Cevi OS, App, Verwaltung und Website",
        ],
        ["/termine/", "Kalender abonnieren"],
        ["/support", "Hilfe und Kontakt"],
        ["/konto-loeschen", "Konto löschen"],
      ].map(([href, text]) =>
        h("li", {}, h("a", { class: "verweis", href }, text)),
      ),
    ),
  );
}

export function abmeldenKarte(s) {
  const a = s.abmelden;
  return karte(
    "kt-ab-t",
    "Abmelden",
    "Auf diesem Gerät oder überall.",
    false,
    h(
      "div",
      { class: "kto-aktion kto-aktion--zwei" },
      a.bestaetigen
        ? [
            h(
              "p",
              { class: "kto-frage", role: "status" },
              "Alle anderen Geräte abmelden?",
            ),
            h(
              "button",
              {
                type: "button",
                class: "btn p",
                "data-aktion": "alle-ja",
                "aria-disabled": a.senden ? "true" : null,
              },
              "Ja, überall abmelden",
            ),
            h(
              "button",
              { type: "button", class: "btn s", "data-aktion": "alle-nein" },
              "Abbrechen",
            ),
          ]
        : [
            h(
              "button",
              {
                type: "button",
                class: "btn p",
                "data-aktion": "abmelden",
                "aria-disabled": a.senden ? "true" : null,
              },
              "Abmelden",
            ),
            h(
              "button",
              { type: "button", class: "btn s", "data-aktion": "alle" },
              "Überall abmelden",
            ),
          ],
    ),
  );
}

export function kontoView(s) {
  const { profil: p } = s;
  // Beim Pflichtwechsel gibt es nur den Wechsel: Alle anderen Routen antworten bis dahin mit 403
  if (s.pflicht) {
    return h("div", { class: "kto kto--pflicht" }, passwortKarte(s));
  }
  return h(
    "div",
    { class: "kto" },
    h("div", { class: "kto-links" }, profilKarte(p)),
    h(
      "div",
      { class: "kto-rechts" },
      p.datenschutzGelesenAm ? null : datenschutzKarte(s),
      mitteilungenKarte(s),
      telefonKarte(s),
      passwortKarte(s),
      hilfeKarte(s),
    ),
    // Eigener Block nach den Karten (Reihenfolge im Dokument), im Raster unter der Profilkarte
    h("div", { class: "kto-ende" }, abmeldenKarte(s)),
  );
}

// Skelett in der Form der Seite: links die Profilkarte und eine Karte darunter, rechts drei Karten
export function ladeView() {
  const karteSk = h(
    "div",
    { class: "karte kto-karte" },
    skelett(sk("r h20 b40"), sk("r h56 b100")),
  );
  return h(
    "div",
    { class: "kto", "aria-busy": "true" },
    h(
      "div",
      { class: "kto-links" },
      h(
        "div",
        { class: "karte kto-profil" },
        skelett(sk("r h56 b100"), sk("r h20 b60"), sk("r h20 b40")),
      ),
    ),
    h("div", { class: "kto-rechts" }, karteSk, karteSk, karteSk),
    h("div", { class: "kto-ende" }, karteSk),
  );
}

export function zustandAnsicht(art) {
  if (art === "abgemeldet") {
    return zustandView({
      symbol: "schloss",
      titel: "Melde dich an, um dein Konto zu sehen.",
      aktion: h(
        "a",
        { class: "btn p gross", href: loginLink("/konto") },
        "Anmelden",
      ),
    });
  }
  return fehlerView("nochmal");
}

// --- Verbindung mit dem Dokument
function neuerStand(profil) {
  return {
    profil,
    pflicht: profil.mussPasswortAendern === true,
    pw: {
      aktuell: "",
      neu: "",
      zeigen_aktuell: false,
      zeigen_neu: false,
      senden: false,
      fehler: {},
    },
    markiert: null,
    tel: {
      wert: profil.telefon ?? "",
      fehler: null,
      senden: false,
    },
    push: { senden: false },
    ds: { senden: false },
    abmelden: { bestaetigen: false, senden: false },
  };
}

function start(doc, wurzel) {
  const inhalt = doc.createElement("div");
  wurzel.replaceChildren(inhalt);
  let s = null;
  const zeige = (d) => inhalt.replaceChildren(baue(doc, d));
  const zeichne = (fokusId) => {
    zeige(kontoView(s));
    if (fokusId) doc.getElementById(fokusId)?.focus();
  };

  async function lade() {
    zeige(ladeView());
    const stopp = ladeAnsage(doc, "Dein Konto wird geladen.");
    const r = await api("/ich");
    stopp();
    if (r.status === 401) return zeige(zustandAnsicht("abgemeldet"));
    if (r.status !== 200) {
      zeige(zustandAnsicht("fehler"));
      melde(doc, "Das hat nicht geklappt.");
      return;
    }
    s = neuerStand(r.daten);
    zeichne();
    melde(doc, "Dein Konto ist geladen.");
  }

  async function speicherePasswort() {
    if (s.pw.senden) return;
    s.markiert = null;
    const fehl = pruefePasswort({
      aktuell: s.pw.aktuell,
      neu: s.pw.neu,
      pflicht: s.pflicht,
    });
    s.pw.fehler = {};
    if (fehl) {
      s.pw.fehler[fehl[0]] = fehl[1];
      zeichne(`kt-pw-${fehl[0]}`);
      melde(doc, fehl[1]);
      return;
    }
    s.pw.senden = true;
    zeichne();
    const r = await api("/api/auth/change-password", {
      methode: "POST",
      body: { currentPassword: s.pw.aktuell, newPassword: s.pw.neu },
    });
    s.pw.senden = false;
    const f = passwortAntwort(r, s.pflicht);
    // Das Passwort bleibt nirgends stehen, auch nicht bei einem Fehler
    s.pw.aktuell = "";
    s.pw.neu = "";
    s.pw.zeigen_aktuell = false;
    s.pw.zeigen_neu = false;
    if (f?.feld) {
      s.pw.fehler[f.feld] = f.text;
      zeichne(`kt-pw-${f.feld}`);
      melde(doc, f.text);
    } else if (f) {
      zeichne();
      toast(f.band, "fehler");
    } else if (s.pflicht) {
      // Jetzt geht der Rest: Profil neu laden
      await lade();
      toast("Passwort gespeichert.");
    } else {
      s.markiert = "pw";
      zeichne();
      toast("Passwort geändert. Auf den anderen Geräten bist du abgemeldet.");
    }
  }

  async function speichereTelefon() {
    if (s.tel.senden) return;
    s.markiert = null;
    const pr = pruefeTelefon({
      eingabe: s.tel.wert,
      original: s.profil.telefon,
      istStufenleitung: istStufenleitung(s.profil),
    });
    s.tel.fehler = pr.fehler;
    if (pr.fehler) {
      zeichne("kt-tel");
      melde(doc, pr.fehler);
      return;
    }
    s.tel.senden = true;
    zeichne();
    const r = await api("/ich", {
      methode: "PATCH",
      body: { telefon: pr.wert === "" ? null : pr.wert },
    });
    s.tel.senden = false;
    if (r.status === 204) {
      s.profil.telefon = pr.wert === "" ? null : pr.wert;
      s.tel.wert = pr.wert;
      s.markiert = "tel";
      zeichne();
      // Nach dem Entfernen fällt die Karte weg und mit ihr der Knopf: Der Fokus geht zum Inhalt
      if (!istStufenleitung(s.profil) && !s.profil.telefon) {
        doc.getElementById("inhalt")?.focus();
      }
      toast(pr.wert === "" ? "Nummer entfernt." : "Nummer gespeichert.");
      return;
    }
    zeichne();
    toast(
      r.status === 403
        ? "Eine Nummer speichern nur Stufenleitungen."
        : "Das hat nicht geklappt. Versuche es nochmals.",
      "fehler",
    );
  }

  async function schalte(schluessel, wert) {
    if (s.push.senden || s.profil[schluessel] === wert) return;
    s.markiert = null;
    s.push.senden = true;
    zeichne();
    const r = await api("/ich", {
      methode: "PATCH",
      body: { [schluessel]: wert },
    });
    s.push.senden = false;
    if (r.status === 204) {
      s.profil[schluessel] = wert;
      s.markiert = "push";
    }
    zeichne();
    doc
      .querySelector(`[data-aktion="push"][data-schluessel="${schluessel}"]`)
      ?.focus();
    if (r.status === 204) toast("Gespeichert.");
    else
      toast("Das hat nicht geklappt. Der Schalter ist unverändert.", "fehler");
  }

  async function nehmeKenntnis() {
    if (s.ds.senden) return;
    s.ds.senden = true;
    zeichne();
    const r = await api("/ich/datenschutz", { methode: "POST" });
    s.ds.senden = false;
    if (r.status === 204) {
      s.profil.datenschutzGelesenAm = new Date().toISOString();
      zeichne();
      toast("Danke. Kenntnisnahme gespeichert.");
    } else {
      zeichne();
      toast("Das hat nicht geklappt. Versuche es nochmals.", "fehler");
    }
  }

  // Abmelden: dieses Gerät oder alle. Danach geht es zur Anmeldung
  async function meldeAb(alle) {
    const a = s.abmelden;
    if (a.senden) return;
    a.senden = true;
    zeichne();
    const r = await api(
      alle ? "/api/auth/revoke-sessions" : "/api/auth/sign-out",
      { methode: "POST", body: {} },
    );
    a.senden = false;
    // 401: Es gab schon keine Sitzung mehr
    if (r.status === 200 || r.status === 401) {
      merkeToast("Abgemeldet.");
      doc.location.assign("/anmelden");
      return;
    }
    a.bestaetigen = false;
    zeichne();
    toast("Abmelden hat nicht geklappt. Versuche es nochmals.", "fehler");
  }

  wurzel.addEventListener("input", (e) => {
    const name = e.target.dataset?.name;
    if (!s || !name) return;
    if (name === "tel") s.tel.wert = e.target.value;
    else if (name === "pw-aktuell") s.pw.aktuell = e.target.value;
    else if (name === "pw-neu") {
      s.pw.neu = e.target.value;
      // Der Hinweis zur Länge zieht mit, ohne die Seite neu zu zeichnen (der Fokus bleibt im Feld)
      doc
        .getElementById("kt-pw-neu-h")
        ?.replaceWith(baue(doc, laengeHinweis(Array.from(s.pw.neu).length)));
    }
  });
  wurzel.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "kt-pw-form") speicherePasswort();
    else if (e.target.id === "kt-tel-form") speichereTelefon();
  });
  wurzel.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-aktion]");
    if (!b) return;
    const a = b.dataset.aktion;
    if (a === "nochmal") return lade();
    if (!s || b.getAttribute("aria-disabled") === "true") return;
    if (a === "pw-zeigen") {
      const feldName = `zeigen_${b.dataset.feld}`;
      s.pw[feldName] = !s.pw[feldName];
      zeichne();
      doc
        .querySelector(
          `[data-aktion="pw-zeigen"][data-feld="${b.dataset.feld}"]`,
        )
        ?.focus();
    } else if (a === "tel-weg") {
      s.tel.wert = "";
      speichereTelefon();
    } else if (a === "push") {
      schalte(b.dataset.schluessel, b.dataset.wert === "1");
    } else if (a === "datenschutz") nehmeKenntnis();
    else if (a === "abmelden") meldeAb(false);
    else if (a === "alle") {
      s.abmelden.bestaetigen = true;
      zeichne();
      doc.querySelector('[data-aktion="alle-ja"]')?.focus();
    } else if (a === "alle-nein") {
      s.abmelden.bestaetigen = false;
      zeichne();
      doc.querySelector('[data-aktion="alle"]')?.focus();
    } else if (a === "alle-ja") meldeAb(true);
  });
  lade();
}

const wurzel =
  typeof document === "undefined" ? null : document.getElementById("tm-app");
if (wurzel?.dataset.seite === "konto") start(document, wurzel);
