// Mein Konto (#621): die eigene Person auf einer Seite, Adresse #konto. Der Name im Kopf öffnet sie, jede Rolle sieht nur die eigenen Daten.
// Aufbau nach den Mustern «Profile Card» (Porträt, Name, Rolle, drei Kennwerte) und «Edit Profile Form» (Felder mit Marke für Geändertes, Speicherleiste unten) von Kokonut UI Pro; Gestalt und Code sind eigene, mit den Tokens der Verwaltung.
// Alles kommt aus Routen, die es für die eigene Person ohnehin gibt: GET und PATCH /api/v1/ich (Telefon, Push-Schalter), PUT und DELETE /api/v1/ich/bild, POST /api/auth/change-password und /api/auth/revoke-sessions. Name, Cevi-Name und Benutzername ändert nur die Abteilungsleitung (Personen), darum stehen sie hier zum Lesen; eine Liste der Sitzungen und eigene Gruppen gibt die API nicht her.
// Abfragen: 1 Abruf beim Öffnen und 1 nach einem neuen Bild; alles andere läuft beim Speichern. Kein Polling.
import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { el, feld, icon, knopf, neueId } from "./dom.js";
import { speicherLeiste } from "./kalenderhilfen.js";
import { sk } from "./lader.js";
import { feldFehler } from "./liste-hilfen.js";
import { rolleVon } from "./navigation.js";
import { setzeKontoBild } from "./rahmen.js";
import { zweiStufig } from "./rueckgaengig.js";
import { BEISPIEL, normalisiereTelefon } from "./telefon.js";
import { zuschneiden } from "./zuschneiden.js";

const BILD_MAX_BYTES = 5 * 1024 * 1024;
const BILD_ARTEN = ["image/jpeg", "image/png", "image/webp"];
const PASSWORT_MIN = 12;
const PASSWORT_MAX = 128;

// Die Schalter der Pushes; pushAnmeldungen zeigt die API nur Leitenden (Stufenrolle), dann fehlt es in der Antwort
const PUSHES = [
  {
    schluessel: "pushChat",
    text: "Neue Chat-Nachrichten",
    hilfe: "Ein Hinweis, wenn in einem deiner Chats jemand schreibt.",
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

const ROLLEN_NAME = { stufenleitung: "Stufenleitung", leitung: "Leitung" };

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

// ===== Reine Funktionen (getestet in test/admin-konto.test.ts) =====

// Chips der Rollen im Klartext: Abteilungsleitung, Entwickler, je Stufe «Stufenleitung Artemis», Website-Redaktion. Die Rechte entscheidet der Server, das hier ist nur die Anzeige
// profil: Antwort von GET /api/v1/ich; zugang: Antwort von GET /api/v1/redaktion/ich
export function rollenChips({ profil, zugang, entwickler = false }) {
  const stufenName = new Map(profil.stufen.map((s) => [s.id, s.name]));
  const chips = [];
  if (profil.admin) chips.push({ text: "Abteilungsleitung" });
  if (entwickler) chips.push({ text: "Entwickler" });
  for (const r of profil.rollen) {
    const stufe = stufenName.get(r.stufeId);
    if (stufe && ROLLEN_NAME[r.typ]) {
      chips.push({ text: `${ROLLEN_NAME[r.typ]} ${stufe}`, art: "stufe" });
    }
  }
  const rechte = zugang?.rechte ?? [];
  if (!profil.admin && rechte.length > 0) {
    chips.push({
      text: rechte.some((r) => !r.startsWith("wartungsmodus."))
        ? "Website-Redaktion"
        : "Wartung der Website",
    });
  }
  return chips;
}

// Was die Website von der Person zeigt (Regel «nach Rolle», #610): Wer in einer Stufe Leitung oder Stufenleitung ist und einen Cevi-Namen hat, erscheint mit Cevi-Name und Profilbild; sonst nicht. Keine Auswahl
// Rückgabe: { sichtbar, stufen: [Name], text }
export function websiteSicht(profil) {
  const aussen = profil.rollen.filter((r) => ROLLEN_NAME[r.typ]);
  const stufenName = new Map(profil.stufen.map((s) => [s.id, s.name]));
  const stufen = [
    ...new Set(aussen.map((r) => stufenName.get(r.stufeId)).filter(Boolean)),
  ];
  const ceviName = (profil.ceviName ?? "").trim();
  if (aussen.length === 0) {
    return {
      sichtbar: false,
      stufen,
      text: "Du erscheinst nicht auf der Website. Dort erscheinen nur Personen, die Leitung oder Stufenleitung einer Stufe sind.",
    };
  }
  if (!ceviName) {
    return {
      sichtbar: false,
      stufen,
      text: "Du bist Leitung, hast aber keinen Cevi-Namen. Darum erscheinst du nicht auf der Website. Den Cevi-Namen setzt die Abteilungsleitung unter «Personen».",
    };
  }
  return {
    sichtbar: true,
    stufen,
    text: `Du erscheinst auf der Website mit deinem Cevi-Namen «${ceviName}»${profil.bildUrl ? " und deinem Profilbild" : ""}, auf der Seite von ${aufzaehlung(stufen)}.${profil.bildUrl ? "" : " Du hast kein Profilbild; dann erscheint auch keins."}`,
  };
}

// «A», «A und B», «A, B und C»
export function aufzaehlung(namen) {
  if (namen.length <= 1) return namen[0] ?? "";
  return `${namen.slice(0, -1).join(", ")} und ${namen.at(-1)}`;
}

// Telefon: Stufenleitung speichert und ändert, alle anderen dürfen die Nummer nur entfernen (Regel der Route PATCH /ich)
// Rückgabe: { wert, fehler }; wert ist die Schreibweise zum Speichern ("" = entfernen), fehler der Text beim Feld oder null
export function pruefeTelefon({ eingabe, original, istStufenleitung }) {
  const n = normalisiereTelefon(eingabe);
  if (!n.gueltig) {
    return {
      wert: n.wert,
      fehler: `Diese Nummer passt nicht. Schreibe sie zum Beispiel so: ${BEISPIEL}`,
    };
  }
  if (!istStufenleitung && n.wert !== "" && n.wert !== (original ?? "")) {
    return {
      wert: n.wert,
      fehler:
        "Eine Nummer speichern nur Stufenleitungen. Du kannst sie nur entfernen.",
    };
  }
  return { wert: n.wert, fehler: null };
}

// Der Body für PATCH /api/v1/ich: nur, was sich gegenüber dem gespeicherten Stand geändert hat (null = Nummer entfernen); leer, wenn nichts anders ist
export function aenderung(stand, werte) {
  const body = {};
  if (werte.telefon !== (stand.telefon ?? "")) {
    body.telefon = werte.telefon === "" ? null : werte.telefon;
  }
  for (const { schluessel } of PUSHES) {
    if (schluessel in werte && werte[schluessel] !== stand[schluessel]) {
      body[schluessel] = werte[schluessel];
    }
  }
  return body;
}

// Fehler von change-password: [Feld, Text] oder null, wenn der Code unbekannt ist
export const passwortFehler = (code) => PASSWORT_FEHLER[code] ?? null;

// Prüfung vor dem Senden: Text und Feld oder null
export function pruefePasswort({ aktuell, neu }) {
  if (!aktuell) return ["aktuell", "Gib dein aktuelles Passwort ein."];
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

// ===== Oberfläche =====

// Skelett in der Form der Seite: links die Karte, rechts die Abschnitte
function skeletonKonto() {
  const abschnitt = (felder) =>
    el(
      "div",
      { class: "kt-abschnitt", "aria-hidden": "true" },
      sk("t", 200),
      Array.from({ length: felder }, () =>
        el("div", { class: "feld" }, sk("t", 80), sk("b", 380)),
      ),
    );
  return el(
    "div",
    { class: "kt" },
    el(
      "div",
      { class: "kt-karte", "aria-hidden": "true" },
      el("div", { class: "kt-portrait" }),
      el("div", { class: "kt-karte-text" }, sk("t", 200), sk("t", 260)),
    ),
    el("div", { class: "kt-spalte" }, abschnitt(4), abschnitt(2)),
  );
}

const anfangsbuchstaben = (name) =>
  String(name ?? "")
    .split(/\s+/)
    .filter((t) => /^\p{L}/u.test(t))
    .slice(0, 2)
    .map((t) => Array.from(t)[0])
    .join("")
    .toLocaleUpperCase("de-CH");

// Abschnitt mit Titel, kurzer Erklärung und Inhalt
function abschnitt(titel, text, ...inhalt) {
  const h2 = el("h2", { tabindex: "-1" }, titel);
  return {
    h2,
    wurzel: el(
      "section",
      { class: "kt-abschnitt" },
      el(
        "header",
        { class: "kt-abschnitt-kopf" },
        h2,
        text && el("p", { class: "leise" }, text),
      ),
      el("div", { class: "kt-gruppen" }, ...inhalt),
    ),
  };
}

// Meldung im Abschnitt (Erfolg oder Fehler), nie nur Farbe: Symbol kommt aus dem CSS des Hinweises
function meldungsfeld() {
  const wurzel = el("div", { class: "kt-meldung" });
  return {
    wurzel,
    zeige(art, text) {
      wurzel.replaceChildren(
        el(
          "p",
          {
            class: `hinweis hinweis--${art}`,
            role: art === "fehler" ? "alert" : "status",
          },
          el("span", {}, text),
        ),
      );
    },
    leere: () => wurzel.replaceChildren(),
  };
}

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/ich"),
    (profil) => zeichne(bereich, ctx, profil),
    { skeleton: skeletonKonto },
  );
}

function zeichne(bereich, ctx, profil) {
  // Der gespeicherte Stand; ändert sich nach dem Speichern und nach einem neuen Bild
  let stand = profil;
  const istStufenleitung = profil.rollen.some((r) => r.typ === "stufenleitung");
  const rolle = rolleVon({
    istAdmin: profil.admin,
    entwickler: ctx.entwickler,
    zugang: ctx.zugang,
    profil,
  });

  // ===== Karte (Profile Card) =====
  const karteKopf = el("h2", { class: "kt-name" }, profil.name);
  const portrait = el("div", { class: "kt-portrait" });
  const bildStatus = el("p", { class: "klein leise", role: "status" });
  const dateiId = neueId("konto-bild");
  const datei = el("input", {
    type: "file",
    id: dateiId,
    accept: BILD_ARTEN.join(","),
    class: "nur-leser",
    tabindex: "-1",
    "aria-hidden": "true",
  });
  const bildWaehlen = knopf("", { klein: true, symbol: "plus" });
  const bildEntfernen = knopf("Bild entfernen", {
    klein: true,
    symbol: "papierkorb",
  });
  const bildAktionen = el(
    "div",
    { class: "kt-bildaktionen" },
    bildWaehlen,
    bildEntfernen,
  );

  const zeichnePortrait = () => {
    const bild = stand.bildUrl
      ? el("img", {
          class: "kt-bild",
          src: stand.bildUrl,
          alt: "",
          decoding: "async",
          onload: (e) => e.target.classList.add("kt-bild--da"),
          onerror: (e) => e.target.remove(),
        })
      : null;
    portrait.replaceChildren(
      el(
        "span",
        { class: "kt-initialen", "aria-hidden": "true" },
        anfangsbuchstaben(profil.name) || "?",
      ),
      ...(bild ? [bild] : []),
    );
    bildWaehlen.lastChild.textContent = stand.bildUrl
      ? "Bild wechseln"
      : "Bild wählen";
    bildEntfernen.hidden = !stand.bildUrl;
  };

  const setzeBildLaeuft = (laeuft, text = "") => {
    portrait.classList.toggle("kt-portrait--laedt", laeuft);
    portrait.toggleAttribute("aria-busy", laeuft);
    bildWaehlen.disabled = laeuft;
    bildEntfernen.disabled = laeuft;
    bildStatus.textContent = text;
  };
  // Nach jeder Änderung: neuer Stand der Adresse (?v= ändert sich mit jedem Bild) für Karte und Kopf
  const ladeBildStand = async () => {
    const neu = await anfrage("GET", "/api/v1/ich");
    stand = { ...stand, bildUrl: neu.bildUrl };
    profil.bildUrl = neu.bildUrl;
    zeichnePortrait();
    setzeKontoBild(neu.bildUrl);
    zeichneSicht();
  };
  const bildFehler = (f) =>
    f instanceof ApiFehler && f.status === 413
      ? "Das Bild ist grösser als 5 MB. Wähle ein kleineres."
      : fehlertext(f);

  bildWaehlen.addEventListener("click", () => datei.click());
  datei.addEventListener("change", async () => {
    const gewaehlt = datei.files?.[0];
    datei.value = "";
    if (!gewaehlt) return;
    if (!BILD_ARTEN.includes(gewaehlt.type)) {
      ctx.melde("Bitte ein Foto als JPEG, PNG oder WebP wählen.", "fehler");
      return;
    }
    if (gewaehlt.size > BILD_MAX_BYTES) {
      ctx.melde(
        "Das Bild ist grösser als 5 MB. Wähle ein kleineres.",
        "fehler",
      );
      return;
    }
    // Zuerst zuschneiden (#633); die Seite lädt hoch und zeigt Fehler selbst
    let ergebnis;
    try {
      ergebnis = await zuschneiden({
        datei: gewaehlt,
        titel: "Profilbild zuschneiden",
        beschreibung:
          "Wähle den Teil, der als Profilbild erscheint. Das Bild wird quadratisch und verkleinert.",
        verhaeltnisse: [{ text: "1:1", wert: 1 }],
        rund: true,
        maxSeite: 512,
        maxBytes: BILD_MAX_BYTES,
        transparenz: false,
        ok: "Zuschneiden und hochladen",
        senden: (d) => anfrage("PUT", "/api/v1/ich/bild", d),
        fehlertext: bildFehler,
      });
    } catch (f) {
      ctx.melde(f.message, "fehler");
      return;
    }
    if (!ergebnis) {
      bildWaehlen.focus();
      return;
    }
    setzeBildLaeuft(true, "Das Bild wird geladen …");
    try {
      await ladeBildStand();
      setzeBildLaeuft(false, "");
      ctx.melde("Dein Profilbild ist gespeichert.");
    } catch (f) {
      setzeBildLaeuft(false, "");
      ctx.melde(bildFehler(f), "fehler");
    }
    bildWaehlen.focus();
  });
  zweiStufig(bildEntfernen, {
    frage: "Wirklich entfernen?",
    ausfuehren: async () => {
      setzeBildLaeuft(true, "Das Bild wird entfernt …");
      try {
        await anfrage("DELETE", "/api/v1/ich/bild");
        await ladeBildStand();
        setzeBildLaeuft(false, "");
        ctx.melde("Dein Profilbild ist entfernt.");
        bildWaehlen.focus();
      } catch (f) {
        setzeBildLaeuft(false, "");
        ctx.melde(bildFehler(f), "fehler");
        bildEntfernen.focus();
      }
    },
  });

  const chips = rollenChips({
    profil,
    zugang: ctx.zugang,
    entwickler: ctx.entwickler,
  });
  const kennwert = (label, wert, symbol) =>
    el(
      "div",
      { class: "kt-kennwert" },
      el("dt", {}, label),
      el("dd", {}, icon(symbol), wert),
    );
  const sichtText = el("p", { class: "hilfe" });
  const zeichneSicht = () => {
    const s = websiteSicht({ ...profil, bildUrl: stand.bildUrl });
    sichtText.textContent = s.text;
  };

  const karte = el(
    "section",
    { class: "kt-karte", "aria-labelledby": "kt-name" },
    portrait,
    el(
      "div",
      { class: "kt-karte-text" },
      karteKopf,
      el("p", { class: "kt-rolle" }, rolle),
      el(
        "dl",
        { class: "kt-daten" },
        el(
          "div",
          {},
          el("dt", {}, "Cevi-Name"),
          el("dd", {}, profil.ceviName || "Nicht gesetzt"),
        ),
        el(
          "div",
          {},
          el("dt", {}, "Benutzername"),
          el("dd", {}, profil.benutzername),
        ),
      ),
      chips.length > 0 &&
        el(
          "ul",
          { class: "chips", "aria-label": "Rollen" },
          chips.map((c) =>
            el("li", { class: c.art ? `chip chip--${c.art}` : "chip" }, c.text),
          ),
        ),
      el(
        "dl",
        { class: "kt-kennwerte" },
        kennwert("Konto", "Aktiv", "haken"),
        kennwert(
          "Zweiter Faktor",
          profil.zweiterFaktor ? "Aktiv" : "Aus",
          profil.zweiterFaktor ? "schild" : "minus",
        ),
      ),
      el("div", { class: "kt-bildblock" }, bildAktionen, bildStatus, datei),
    ),
  );
  karteKopf.id = "kt-name";

  // ===== Deine Angaben (Edit Profile Form) =====
  const lesefeld = (label, wert, hilfe) => {
    const f = feld({
      label,
      wert: wert || "",
      hilfe,
      readonly: true,
      autocomplete: "off",
    });
    f.eingabe.classList.add("kt-lesen");
    return f;
  };
  const wer = profil.admin
    ? "Ändere ihn unter «Personen»."
    : "Ihn ändert die Abteilungsleitung.";
  const name = lesefeld(
    "Name",
    profil.name,
    `So steht dein Konto in der Verwaltung. ${wer}`,
  );
  const ceviName = lesefeld(
    "Cevi-Name",
    profil.ceviName || "Nicht gesetzt",
    `Erscheint auf der Website, wenn du Leitung oder Stufenleitung bist. ${wer}`,
  );
  const benutzername = lesefeld(
    "Benutzername",
    profil.benutzername,
    "Damit meldest du dich an.",
  );

  const telefon = feld({
    label: "Telefon (optional)",
    typ: "tel",
    wert: profil.telefon ?? "",
    hilfe: istStufenleitung
      ? `Eltern, Leitende und Stufenleitung der Stufe sehen die Nummer bei den Kontakten. Schreibe sie wie ${BEISPIEL} oder mit +41. Leer lassen, um sie zu entfernen.`
      : profil.telefon
        ? "Eine Nummer speichern nur Stufenleitungen. Du kannst deine entfernen: Lösche das Feld und speichere."
        : "Eine Nummer speichern nur Stufenleitungen.",
    maxlength: 30,
    autocomplete: "tel",
    inputmode: "tel",
    disabled: !istStufenleitung && !profil.telefon,
  });
  const telefonVorschau = el("p", { class: "klein leise", role: "status" });
  telefon.wurzel.append(telefonVorschau);

  // Schalter der Pushes
  const schalter = new Map();
  const pushZeilen = PUSHES.filter((p) => p.schluessel in profil).map((p) => {
    const id = neueId("konto-push");
    const knopfEl = el("button", {
      type: "button",
      class: "schalter",
      role: "switch",
      "aria-checked": String(profil[p.schluessel]),
      "aria-labelledby": `${id}-text`,
      "aria-describedby": `${id}-hilfe`,
    });
    knopfEl.addEventListener("click", () => {
      knopfEl.setAttribute(
        "aria-checked",
        String(knopfEl.getAttribute("aria-checked") !== "true"),
      );
      pruefeAenderungen();
    });
    const geaendert = el(
      "span",
      { class: "nur-leser", hidden: true },
      " (geändert)",
    );
    schalter.set(p.schluessel, knopfEl);
    return {
      schluessel: p.schluessel,
      wurzel: el(
        "div",
        { class: "schalterzeile kt-zeile" },
        el(
          "div",
          { class: "kt-zeile-text" },
          el(
            "span",
            { id: `${id}-text`, class: "kt-zeile-titel" },
            p.text,
            geaendert,
          ),
          el("p", { class: "hilfe", id: `${id}-hilfe` }, p.hilfe),
        ),
        knopfEl,
      ),
      geaendert,
    };
  });

  // Marke für Geändertes: ein Punkt vor dem Label (CSS) und «(geändert)» für Screenreader
  const telefonGeaendert = el(
    "span",
    { class: "nur-leser", hidden: true },
    " (geändert)",
  );
  telefon.wurzel.querySelector("label").append(telefonGeaendert);

  const leiste = speicherLeiste({
    beiSpeichern: (k) => speichern(k),
    beiVerwerfen: () => verwerfe(),
  });

  const lesen = () => ({
    telefon: normalisiereTelefon(telefon.eingabe.value).wert,
    ...Object.fromEntries(
      [...schalter].map(([k, s]) => [
        k,
        s.getAttribute("aria-checked") === "true",
      ]),
    ),
  });
  function pruefeAenderungen() {
    const werte = lesen();
    const body = aenderung(stand, werte);
    const namen = [];
    const telGeaendert = "telefon" in body;
    telefon.wurzel.classList.toggle("kt-geaendert", telGeaendert);
    telefonGeaendert.hidden = !telGeaendert;
    if (telGeaendert) namen.push("Telefon");
    for (const z of pushZeilen) {
      const an = z.schluessel in body;
      z.wurzel.classList.toggle("kt-geaendert", an);
      z.geaendert.hidden = !an;
      if (an)
        namen.push(PUSHES.find((p) => p.schluessel === z.schluessel).text);
    }
    if (namen.length === 0) {
      leiste.verstecke();
      return;
    }
    leiste.zeige(
      `${namen.length} ${namen.length === 1 ? "Änderung" : "Änderungen"} nicht gespeichert: ${aufzaehlung(namen)}`,
    );
  }

  const zeigeTelefonVorschau = () => {
    const n = normalisiereTelefon(telefon.eingabe.value);
    telefonVorschau.textContent = n.vorschau
      ? `Wird gespeichert als ${n.vorschau}`
      : "";
  };
  telefon.eingabe.addEventListener("input", () => {
    zeigeTelefonVorschau();
    pruefeAenderungen();
  });
  telefon.eingabe.addEventListener("blur", () => {
    const n = normalisiereTelefon(telefon.eingabe.value);
    if (n.gueltig && n.wert !== telefon.eingabe.value) {
      telefon.eingabe.value = n.wert;
    }
    zeigeTelefonVorschau();
    pruefeAenderungen();
  });
  zeigeTelefonVorschau();

  function setzeFelder() {
    telefon.eingabe.value = stand.telefon ?? "";
    for (const [k, s] of schalter)
      s.setAttribute("aria-checked", String(stand[k]));
    zeigeTelefonVorschau();
    pruefeAenderungen();
  }
  function verwerfe() {
    setzeFelder();
    telefon.eingabe.focus();
  }

  async function speichern(speichernKnopf) {
    const werte = lesen();
    const pruefung = pruefeTelefon({
      eingabe: telefon.eingabe.value,
      original: stand.telefon,
      istStufenleitung,
    });
    if (pruefung.fehler) {
      feldFehler(telefon, pruefung.fehler);
      telefon.eingabe.focus();
      return;
    }
    const body = aenderung(stand, werte);
    if (Object.keys(body).length === 0) {
      leiste.verstecke();
      return;
    }
    speichernKnopf.disabled = true;
    speichernKnopf.setAttribute("aria-busy", "true");
    try {
      await anfrage("PATCH", "/api/v1/ich", body);
      stand = { ...stand, ...body };
      setzeFelder();
      ctx.melde("Deine Angaben sind gespeichert.");
      angaben.h2.focus();
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    } finally {
      speichernKnopf.disabled = false;
      speichernKnopf.removeAttribute("aria-busy");
    }
  }

  const pushGruppe =
    pushZeilen.length > 0 &&
    el(
      "div",
      { class: "kt-gruppe", role: "group", "aria-labelledby": "kt-push-titel" },
      el("h3", { id: "kt-push-titel" }, "Mitteilungen auf dem Handy"),
      el(
        "p",
        { class: "hilfe" },
        "Gilt für die App. Im Browser zeigt die Verwaltung keine Mitteilungen.",
      ),
      pushZeilen.map((z) => z.wurzel),
    );

  const angaben = abschnitt(
    "Deine Angaben",
    "Was die Abteilung von dir weiss. Ein gesperrtes Feld ändert die Abteilungsleitung.",
    el(
      "form",
      { class: "formular kt-formular", novalidate: true },
      el(
        "div",
        { class: "kt-felder" },
        name.wurzel,
        ceviName.wurzel,
        benutzername.wurzel,
        telefon.wurzel,
      ),
      pushGruppe,
      profil.admin &&
        el(
          "p",
          { class: "hilfe" },
          el("a", { href: "#personen/personen" }, "Personen öffnen"),
          " (Name und Cevi-Name ändern)",
        ),
    ),
  );
  angaben.wurzel
    .querySelector("form")
    .addEventListener("submit", (e) => e.preventDefault());

  // ===== Sicherheit =====
  const sicherheit = abschnitt(
    "Sicherheit",
    "Passwort, zweiter Faktor und Geräte.",
    passwortBlock(),
    el(
      "div",
      { class: "kt-stapel" },
      zweiterFaktorBlock(profil),
      sitzungenBlock(ctx),
    ),
  );

  // ===== Datenschutz =====
  const datenschutz = abschnitt(
    "Datenschutz",
    "Was die Abteilung öffentlich von dir zeigt und wie du dein Konto löschen lässt.",
    el(
      "div",
      { class: "kt-gruppe" },
      el("h3", {}, "Auf der Website"),
      sichtText,
      el(
        "p",
        { class: "hilfe" },
        "Das ist keine Auswahl, es folgt deiner Rolle. Dein Benutzername, deine Telefonnummer und deine E-Mail-Adresse zeigt die Website nie.",
      ),
    ),
    el(
      "div",
      { class: "kt-gruppe" },
      el("h3", {}, "Mehr zu deinen Daten"),
      el(
        "ul",
        { class: "kt-links" },
        el(
          "li",
          {},
          el("a", { href: "/datenschutz-website" }, "Datenschutzerklärung"),
          el(
            "span",
            { class: "leise" },
            " Was die Abteilung speichert und warum.",
          ),
        ),
        el(
          "li",
          {},
          el(
            "a",
            { href: "/datenschutz-cevi-os" },
            "Datenschutz: Cevi OS, App, Verwaltung und Website",
          ),
          el(
            "span",
            { class: "leise" },
            " Was Cevi OS bearbeitet, wer es sieht und wie lange es bleibt.",
          ),
        ),
        el(
          "li",
          {},
          el("a", { href: "/konto-loeschen" }, "Konto löschen"),
          el(
            "span",
            { class: "leise" },
            " So bittest du um die Löschung deines Kontos.",
          ),
        ),
      ),
    ),
  );

  zeichnePortrait();
  zeichneSicht();
  bereich.append(
    el(
      "div",
      { class: "kt" },
      karte,
      el(
        "div",
        { class: "kt-spalte" },
        angaben.wurzel,
        sicherheit.wurzel,
        datenschutz.wurzel,
        leiste.wurzel,
      ),
    ),
  );
  pruefeAenderungen();
}

// Passwort ändern: zwei Felder, kein «Wiederholen» (Handbuch 9). Der Server beendet danach alle anderen Sitzungen und stellt hier eine neue aus
function passwortBlock() {
  const meldung = meldungsfeld();
  const aktuell = feld({
    label: "Aktuelles Passwort",
    typ: "password",
    autocomplete: "current-password",
    required: true,
  });
  const neu = feld({
    label: "Neues Passwort",
    typ: "password",
    autocomplete: "new-password",
    hilfe: `Mindestens ${PASSWORT_MIN} Zeichen, ohne weitere Regeln. Es darf nicht aus einem bekannten Datenleck stammen. Danach bist du auf allen anderen Geräten abgemeldet.`,
    required: true,
    minlength: PASSWORT_MIN,
    maxlength: PASSWORT_MAX,
  });
  const zeigenId = neueId("konto-zeigen");
  const zeigen = el("input", { id: zeigenId, type: "checkbox" });
  zeigen.addEventListener("change", () => {
    const typ = zeigen.checked ? "text" : "password";
    aktuell.eingabe.type = typ;
    neu.eingabe.type = typ;
  });
  const senden = knopf("Passwort ändern", { symbol: "schluessel" });
  senden.type = "submit";
  const formular = el(
    "form",
    { class: "formular kt-formular", novalidate: true },
    el("input", {
      type: "text",
      class: "nur-leser",
      tabindex: "-1",
      autocomplete: "username",
      "aria-hidden": "true",
    }),
    aktuell.wurzel,
    neu.wurzel,
    el(
      "div",
      { class: "wahl" },
      zeigen,
      el("label", { for: zeigenId }, "Passwörter anzeigen"),
    ),
    meldung.wurzel,
    el("div", { class: "kt-aktionen" }, senden),
  );
  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    meldung.leere();
    const werte = { aktuell: aktuell.eingabe.value, neu: neu.eingabe.value };
    const problem = pruefePasswort(werte);
    if (problem) {
      const ziel = problem[0] === "aktuell" ? aktuell : neu;
      feldFehler(ziel, problem[1]);
      ziel.eingabe.focus();
      return;
    }
    senden.disabled = true;
    senden.setAttribute("aria-busy", "true");
    try {
      await anfrage("POST", "/api/auth/change-password", {
        currentPassword: werte.aktuell,
        newPassword: werte.neu,
      });
      aktuell.eingabe.value = "";
      neu.eingabe.value = "";
      zeigen.checked = false;
      zeigen.dispatchEvent(new window.Event("change"));
      meldung.zeige(
        "ok",
        "Dein Passwort ist geändert. Auf allen anderen Geräten bist du abgemeldet.",
      );
    } catch (f) {
      const bekannt = passwortFehler(f?.code);
      if (bekannt) {
        const ziel = bekannt[0] === "aktuell" ? aktuell : neu;
        feldFehler(ziel, bekannt[1]);
        ziel.eingabe.focus();
      } else {
        meldung.zeige("fehler", fehlertext(f));
      }
    } finally {
      senden.disabled = false;
      senden.removeAttribute("aria-busy");
    }
  });
  return el("div", { class: "kt-gruppe" }, el("h3", {}, "Passwort"), formular);
}

// Zweiter Faktor: nur der Stand. Einrichten kann ihn nur die Abteilungsleitung (Route two-factor/enable), Zurücksetzen macht sie für andere unter «Personen»
function zweiterFaktorBlock(profil) {
  const an = profil.zweiterFaktor;
  return el(
    "div",
    { class: "kt-gruppe" },
    el("h3", {}, "Zweiter Faktor"),
    el(
      "p",
      {},
      el(
        "span",
        { class: an ? "chip chip--ok" : "chip" },
        icon(an ? "haken" : "minus"),
        an ? "Aktiv" : "Nicht eingerichtet",
      ),
    ),
    el(
      "p",
      { class: "hilfe" },
      an
        ? "Beim Anmelden fragt die Verwaltung nach dem Code aus deiner Authenticator-App. Hast du dein Gerät verloren, setzt die Abteilungsleitung den zweiten Faktor für dich zurück."
        : profil.admin
          ? "Für die Verwaltung braucht die Abteilungsleitung einen zweiten Faktor."
          : "Für dein Konto gibt es keinen zweiten Faktor. Einrichten lässt er sich nur für Konten der Abteilungsleitung.",
    ),
  );
}

// Überall abmelden: beendet alle Sitzungen, auch diese; eine Liste der Geräte gibt die API nicht her
function sitzungenBlock(ctx) {
  const meldung = meldungsfeld();
  const knopfEl = knopf("Auf allen Geräten abmelden", { symbol: "abmelden" });
  zweiStufig(knopfEl, {
    frage: "Wirklich überall abmelden?",
    ausfuehren: async () => {
      knopfEl.disabled = true;
      knopfEl.setAttribute("aria-busy", "true");
      try {
        await anfrage("POST", "/api/auth/revoke-sessions", {});
        ctx.zurAnmeldung("Du bist auf allen Geräten abgemeldet.");
      } catch (f) {
        knopfEl.disabled = false;
        knopfEl.removeAttribute("aria-busy");
        meldung.zeige("fehler", fehlertext(f));
      }
    },
  });
  return el(
    "div",
    { class: "kt-gruppe" },
    el("h3", {}, "Geräte"),
    el(
      "p",
      { class: "hilfe" },
      "Eine Sitzung bleibt bis zu 90 Tage gültig und verlängert sich mit der Nutzung. Mit dem Knopf beendest du alle, auch diese. Eine Liste der Geräte gibt es nicht.",
    ),
    el("div", { class: "kt-aktionen" }, knopfEl),
    meldung.wurzel,
  );
}
