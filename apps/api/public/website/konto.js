// Seite «Mein Konto» (#671): die eigene Person auf der Website. Dasselbe wie das Profil der App, über dieselben Routen.
// Startpasswort ändern (Pflicht beim ersten Mal), Datenschutz zur Kenntnis nehmen, Telefon, Mitteilungen der App, Passwort ändern, Abmelden.
// Routen: GET und PATCH /api/v1/ich, POST /api/v1/ich/datenschutz, POST /api/auth/change-password, /api/auth/revoke-sessions und /api/auth/sign-out.
// Abfragen: einmal GET /ich beim Öffnen; sonst nur beim Speichern. Kein Abruf im Takt. Das Passwort steht nur im Feld und im Body, nie in einer Adresse, und wird nach dem Senden geleert.
// Name, Cevi-Name und Benutzername ändert nur die Abteilungsleitung; sie stehen hier zum Lesen. Ein Profilbild lässt sich hier noch nicht ändern (die Website hat keinen Zuschneide-Dialog).
import {
  api,
  baue,
  bandView,
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
    ...(p.admin ? ["Abteilungsleitung"] : []),
    ...p.rollen.map((r) =>
      `${r.typ === "stufenleitung" ? "Stufenleitung" : "Leitung"} ${stufe(r.stufeId)}`.trim(),
    ),
    ...(p.kinder.length > 0 ? ["Elternteil"] : []),
    ...(p.teilnehmer ? ["Teilnehmende"] : []),
  ];
  return aus;
}

// --- Ansichten
const feld = (id, label, { fehler, hilfe, control }) =>
  h(
    "div",
    { class: `feld${fehler ? " fehler" : ""}` },
    h("label", { for: id }, label),
    hilfe ? h("p", { class: "hilfe", id: `${id}-h` }, hilfe) : null,
    control,
    fehler
      ? h("p", { class: "fehlertext", id: `${id}-f` }, icon("warnung"), fehler)
      : null,
  );

const beschr = (id, fehler, hilfe) =>
  [fehler ? `${id}-f` : null, hilfe ? `${id}-h` : null]
    .filter(Boolean)
    .join(" ") || null;

const karte = (id, titel, ...inhalt) =>
  h(
    "section",
    { class: "karte seite-spalte", "aria-labelledby": id },
    h("h2", { id }, titel),
    inhalt,
  );

const meldung = (m) =>
  m
    ? bandView({
        art: m.art,
        symbol: m.art === "ok" ? "haken" : "warnung",
        titel: m.text,
        rolle: m.art === "ok" ? "status" : "alert",
      })
    : null;

export function profilKarte(p) {
  const rollen = rollenText(p);
  return karte(
    "kt-profil-t",
    "Dein Profil",
    h(
      "dl",
      { class: "fakten" },
      h(
        "div",
        { class: "fakt" },
        icon("info", false),
        h("dt", {}, "Name"),
        h("dd", {}, p.ceviName ? `${p.name} (${p.ceviName})` : p.name),
      ),
      h(
        "div",
        { class: "fakt" },
        icon("schloss", false),
        h("dt", {}, "Benutzername"),
        h("dd", {}, p.benutzername),
      ),
      rollen.length
        ? h(
            "div",
            { class: "fakt" },
            icon("info", false),
            h("dt", {}, "Rolle"),
            h("dd", {}, rollen.join(", ")),
          )
        : null,
      p.kinder.length
        ? h(
            "div",
            { class: "fakt" },
            icon("info", false),
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
  );
}

// Der Pflichtwechsel und der normale Wechsel teilen sich die Karte; nur Titel, Text und Beschriftung unterscheiden sich
export function passwortKarte(s) {
  const { pflicht, pw } = s;
  const typ = pw.zeigen ? "text" : "password";
  const f = pw.fehler;
  const eingabe = (id, name, auto) =>
    h("input", {
      class: "eingabe",
      id,
      type: typ,
      value: pw[name],
      "data-name": `pw-${name}`,
      autocomplete: auto,
      spellcheck: "false",
      "aria-describedby": beschr(id, f[name], id === "kt-pw-neu"),
      "aria-invalid": f[name] ? "true" : null,
      ...(pw.senden && { readonly: true }),
    });
  return karte(
    "kt-pw-t",
    pflicht ? "Wähle dein Passwort" : "Passwort ändern",
    pflicht
      ? bandView({
          art: "wa",
          symbol: "info",
          titel: "Du hast ein Startpasswort.",
          text: "Wähle zuerst ein eigenes Passwort. Danach kannst du die Seite nutzen.",
          rolle: "status",
        })
      : null,
    meldung(pw.meldung),
    h(
      "form",
      { class: "formular", novalidate: true, id: "kt-pw-form" },
      feld("kt-pw-aktuell", pflicht ? "Startpasswort" : "Aktuelles Passwort", {
        fehler: f.aktuell,
        control: eingabe("kt-pw-aktuell", "aktuell", "current-password"),
      }),
      feld("kt-pw-neu", "Neues Passwort", {
        fehler: f.neu,
        hilfe: `Mindestens ${PASSWORT_MIN} Zeichen. Ein Satz, den nur du kennst, geht gut.`,
        control: eingabe("kt-pw-neu", "neu", "new-password"),
      }),
      h(
        "div",
        { class: "knopfreihe" },
        h(
          "button",
          {
            type: "button",
            class: "btn s",
            "aria-pressed": pw.zeigen ? "true" : "false",
            "data-aktion": "pw-zeigen",
          },
          pw.zeigen ? "Passwörter verbergen" : "Passwörter anzeigen",
        ),
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
    meldung(s.ds.meldung),
    h(
      "p",
      {},
      "Bevor du weitermachst: Lies, wie die Abteilung mit Daten umgeht. Das Lesen ist keine Einwilligung. Du bestätigst nur, dass du es kennst.",
    ),
    h(
      "div",
      { class: "knopfreihe" },
      h(
        "a",
        {
          class: "btn s",
          href: "/datenschutz",
          target: "_blank",
          rel: "noopener",
        },
        "Datenschutzerklärung lesen",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn p gross",
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
  // Wer keine Nummer hat und keine speichern darf, braucht den Abschnitt nicht
  if (!sl && !p.telefon) return null;
  const t = s.tel;
  return karte(
    "kt-tel-t",
    "Telefon",
    meldung(t.meldung),
    h(
      "form",
      { class: "formular", novalidate: true, id: "kt-tel-form" },
      feld("kt-tel", "Telefonnummer", {
        fehler: t.fehler,
        hilfe: sl
          ? "Eltern deiner Stufe sehen die Nummer und können dich anrufen."
          : "Du kannst deine Nummer nur entfernen.",
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
      }),
      h(
        "div",
        { class: "knopfreihe" },
        h(
          "button",
          {
            type: "submit",
            class: "btn p",
            "aria-disabled": t.senden ? "true" : null,
            "aria-busy": t.senden ? "true" : null,
          },
          t.senden
            ? "Speichere …"
            : sl || t.wert !== ""
              ? "Nummer speichern"
              : "Nummer entfernen",
        ),
      ),
    ),
  );
}

export function mitteilungenKarte(s) {
  const p = s.profil;
  const liste = PUSHES.filter((e) => e.schluessel in p);
  return karte(
    "kt-push-t",
    "Mitteilungen in der App",
    h(
      "p",
      { class: "hilfe" },
      "Diese Schalter gelten für die Cevi-OS-App auf deinem Handy. Im Browser gibt es keine Mitteilungen.",
    ),
    meldung(s.push.meldung),
    h(
      "ul",
      { class: "antworten" },
      liste.map((e) => {
        const an = p[e.schluessel] === true;
        const id = `kt-${e.schluessel}`;
        return h(
          "li",
          { class: "antwort" },
          h(
            "span",
            { class: "antwort-text" },
            h("span", { class: "antwort-name", id }, e.text),
            h("span", { class: "hilfe" }, e.hilfe),
          ),
          h(
            "div",
            { class: "seg", role: "group", "aria-labelledby": id },
            [true, false].map((wert) =>
              h(
                "button",
                {
                  type: "button",
                  "aria-pressed": an === wert ? "true" : "false",
                  "aria-disabled": s.push.senden ? "true" : null,
                  "data-aktion": "push",
                  "data-schluessel": e.schluessel,
                  "data-wert": wert ? "1" : "0",
                },
                wert ? "Ein" : "Aus",
              ),
            ),
          ),
        );
      }),
    ),
  );
}

export function weitereKarte(s) {
  const a = s.abmelden;
  return karte(
    "kt-mehr-t",
    "Weiteres",
    meldung(a.meldung),
    h(
      "ul",
      { class: "linkliste" },
      [
        ["/termine/", "Kalender abonnieren"],
        ["/datenschutz", "Datenschutzerklärung"],
        ["/support", "Hilfe und Kontakt"],
        ["/konto-loeschen", "Konto löschen"],
      ].map(([href, text]) =>
        h("li", {}, h("a", { class: "verweis", href }, text)),
      ),
    ),
    h(
      "div",
      { class: "knopfreihe" },
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
      a.bestaetigen
        ? [
            h(
              "span",
              { class: "frage", role: "status" },
              "Alle anderen Geräte abmelden?",
            ),
            h(
              "button",
              {
                type: "button",
                class: "btn s",
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
        : h(
            "button",
            { type: "button", class: "btn s", "data-aktion": "alle" },
            "Überall abmelden",
          ),
    ),
  );
}

export function kontoView(s) {
  const { profil: p } = s;
  // Beim Pflichtwechsel gibt es nur den Wechsel: Alle anderen Routen antworten bis dahin mit 403
  if (s.pflicht)
    return h("div", { class: "seite-spalte breit" }, passwortKarte(s));
  return h(
    "div",
    { class: "seite-spalte breit" },
    p.datenschutzGelesenAm ? null : datenschutzKarte(s),
    profilKarte(p),
    telefonKarte(s),
    mitteilungenKarte(s),
    passwortKarte(s),
    weitereKarte(s),
  );
}

export function ladeView() {
  return h(
    "div",
    { class: "seite-spalte", "aria-busy": "true" },
    skelett(sk("r h56 b100"), sk("r h56 b100"), sk("r h56 b100")),
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
      zeigen: false,
      senden: false,
      fehler: {},
      meldung: null,
    },
    tel: {
      wert: profil.telefon ?? "",
      fehler: null,
      senden: false,
      meldung: null,
    },
    push: { senden: false, meldung: null },
    ds: { senden: false, meldung: null },
    abmelden: { bestaetigen: false, senden: false, meldung: null },
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
    const fehl = pruefePasswort({
      aktuell: s.pw.aktuell,
      neu: s.pw.neu,
      pflicht: s.pflicht,
    });
    s.pw.meldung = null;
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
    s.pw.zeigen = false;
    if (f?.feld) {
      s.pw.fehler[f.feld] = f.text;
      zeichne(`kt-pw-${f.feld}`);
      melde(doc, f.text);
    } else if (f) {
      s.pw.meldung = { art: "fe", text: f.band };
      zeichne();
      melde(doc, f.band);
    } else if (s.pflicht) {
      // Jetzt geht der Rest: Profil neu laden
      await lade();
      melde(doc, "Dein Passwort ist gespeichert.");
    } else {
      s.pw.meldung = {
        art: "ok",
        text: "Dein Passwort ist geändert. Auf den anderen Geräten bist du abgemeldet.",
      };
      zeichne();
      melde(doc, s.pw.meldung.text);
    }
  }

  async function speichereTelefon() {
    if (s.tel.senden) return;
    const pr = pruefeTelefon({
      eingabe: s.tel.wert,
      original: s.profil.telefon,
      istStufenleitung: istStufenleitung(s.profil),
    });
    s.tel.meldung = null;
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
      s.tel.meldung = {
        art: "ok",
        text:
          pr.wert === ""
            ? "Die Nummer ist entfernt."
            : "Die Nummer ist gespeichert.",
      };
    } else {
      s.tel.meldung = {
        art: "fe",
        text:
          r.status === 403
            ? "Eine Nummer speichern nur Stufenleitungen."
            : "Das hat nicht geklappt. Versuche es nochmals.",
      };
    }
    zeichne();
    melde(doc, s.tel.meldung.text);
  }

  async function schalte(schluessel, wert) {
    if (s.push.senden || s.profil[schluessel] === wert) return;
    s.push.senden = true;
    s.push.meldung = null;
    zeichne();
    const r = await api("/ich", {
      methode: "PATCH",
      body: { [schluessel]: wert },
    });
    s.push.senden = false;
    if (r.status === 204) {
      s.profil[schluessel] = wert;
      s.push.meldung = { art: "ok", text: "Gespeichert." };
    } else {
      s.push.meldung = {
        art: "fe",
        text: "Das hat nicht geklappt. Der Schalter ist unverändert.",
      };
    }
    zeichne();
    doc
      .querySelector(
        `[data-aktion="push"][data-schluessel="${schluessel}"][data-wert="${wert ? "1" : "0"}"]`,
      )
      ?.focus();
    melde(doc, s.push.meldung.text);
  }

  async function nehmeKenntnis() {
    if (s.ds.senden) return;
    s.ds.senden = true;
    s.ds.meldung = null;
    zeichne();
    const r = await api("/ich/datenschutz", { methode: "POST" });
    s.ds.senden = false;
    if (r.status === 204) {
      s.profil.datenschutzGelesenAm = new Date().toISOString();
      zeichne();
      melde(doc, "Danke. Deine Kenntnisnahme ist gespeichert.");
    } else {
      s.ds.meldung = {
        art: "fe",
        text: "Das hat nicht geklappt. Versuche es nochmals.",
      };
      zeichne();
      melde(doc, s.ds.meldung.text);
    }
  }

  // Abmelden: dieses Gerät oder alle. Danach geht es zur Anmeldung
  async function meldeAb(alle) {
    const a = s.abmelden;
    if (a.senden) return;
    a.senden = true;
    a.meldung = null;
    zeichne();
    const r = await api(
      alle ? "/api/auth/revoke-sessions" : "/api/auth/sign-out",
      { methode: "POST", body: {} },
    );
    a.senden = false;
    // 401: Es gab schon keine Sitzung mehr
    if (r.status === 200 || r.status === 401) {
      doc.location.assign("/anmelden");
      return;
    }
    a.bestaetigen = false;
    a.meldung = {
      art: "fe",
      text: "Abmelden hat nicht geklappt. Versuche es nochmals.",
    };
    zeichne();
    melde(doc, a.meldung.text);
  }

  wurzel.addEventListener("input", (e) => {
    const name = e.target.dataset?.name;
    if (!s || !name) return;
    if (name === "tel") s.tel.wert = e.target.value;
    else if (name === "pw-aktuell") s.pw.aktuell = e.target.value;
    else if (name === "pw-neu") s.pw.neu = e.target.value;
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
      s.pw.zeigen = !s.pw.zeigen;
      zeichne();
      doc.querySelector('[data-aktion="pw-zeigen"]')?.focus();
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
