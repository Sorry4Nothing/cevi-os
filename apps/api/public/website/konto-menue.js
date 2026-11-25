// Konto-Menü im Kopf der Website (#669). Die Seiten sind für alle gleich und kennen keine Person; dieses Skript fragt nach dem Laden die Schnittstelle (GET /api/v1/website/konto, gleiche Herkunft, Cookie der Sitzung)
// und setzt bei einer gültigen Sitzung das Menü aus der Vorlage im Kopf (template#konto-vorlage, src/website/kopf.ts) anstelle von «Anmelden» ein: Name, Profilbild oder Initiale, «Verwaltung» nur mit Zugang, «Abmelden».
// Ohne Skript, ohne Sitzung (401) und bei jedem Fehler bleibt «Anmelden» stehen. Alles kommt als Text und über DOM-Knoten, nie über innerHTML; im Browser bleibt nur ein Merker «es gab eine Sitzung» (sessionStorage, ohne Namen), damit «Anmelden» beim nächsten Seitenaufruf nicht kurz aufblitzt (theme.js setzt data-konto, kopf.css verbirgt den Knopf bis zur Antwort).

const wurzel = document.documentElement;
const MERKER = "cevi-konto";
const FRIST_MS = 8000;
// Der Pfad des Profilbilds kommt vom Server; trotzdem wird nur dieses Muster zum Bild (nie eine fremde Adresse)
const BILD = /^\/api\/v1\/personen\/[0-9a-f-]{36}\/bild\?v=\d+$/;

const vorlage = document.getElementById("konto-vorlage");
const knoepfe = [...document.querySelectorAll(".kopf a.anmelden")];

const merke = (an) => {
  try {
    if (an) window.sessionStorage.setItem(MERKER, "1");
    else window.sessionStorage.removeItem(MERKER);
  } catch {
    // Kein Speicher: Der Knopf blitzt dann beim Wechsel der Seite kurz auf, mehr nicht
  }
};

// Der Knopf «Anmelden» ist wieder (oder noch) sichtbar
const zeigeAnmelden = () => wurzel.removeAttribute("data-konto");

// Antwort prüfen: nur die drei Felder, nur in dieser Form
function pruefe(d) {
  if (
    d === null ||
    typeof d !== "object" ||
    typeof d.name !== "string" ||
    d.name.length === 0 ||
    d.name.length > 100 ||
    typeof d.verwaltung !== "boolean" ||
    !(
      d.bildUrl === null ||
      (typeof d.bildUrl === "string" && BILD.test(d.bildUrl))
    )
  ) {
    return null;
  }
  return d;
}

// Mit Frist; null bei jedem Fehler und ohne Sitzung
async function frage() {
  const abbruch = new AbortController();
  const aus = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const r = await fetch("/api/v1/website/konto", {
      credentials: "same-origin",
      cache: "no-store",
      signal: abbruch.signal,
    });
    return r.ok ? pruefe(await r.json()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(aus);
  }
}

// --- Das Menü ---

function fuelle(menue, daten) {
  for (const f of menue.querySelectorAll('[data-konto="name"]')) {
    f.textContent = daten.name;
  }
  const initiale = Array.from(daten.name)[0].toLocaleUpperCase("de-CH");
  for (const f of menue.querySelectorAll('[data-konto="initialen"]')) {
    f.textContent = initiale;
  }
  // Das Bild liegt über der Initiale und erscheint erst, wenn es geladen ist (die Route liefert es nur der Person selbst: Es ist ihr eigenes)
  if (daten.bildUrl) {
    for (const ava of menue.querySelectorAll(".konto-ava")) {
      const bild = document.createElement("img");
      bild.alt = "";
      bild.hidden = true;
      bild.addEventListener("load", () => (bild.hidden = false));
      bild.addEventListener("error", () => bild.remove());
      bild.src = daten.bildUrl;
      ava.append(bild);
    }
  }
  if (!daten.verwaltung) {
    for (const f of menue.querySelectorAll('[data-konto="verwaltung"]')) {
      f.remove();
    }
  }
}

// «Abmelden»: derselbe Aufruf wie in der Verwaltung (POST /api/auth/sign-out, der Server prüft den Origin). Danach lädt die Seite neu: Geschützte Inhalte verschwinden, der Kopf zeigt wieder «Anmelden»
// Der Ausgang ist ein Toast (toast.js, #762); er wird erst geladen, wenn er gebraucht wird
async function abmelden(knopf) {
  if (knopf.getAttribute("aria-disabled") === "true") return;
  knopf.setAttribute("aria-disabled", "true");
  knopf.setAttribute("aria-busy", "true");
  let ok = false;
  try {
    const r = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    ok = r.ok;
  } catch {
    // Kein Netz: wie ein Fehler des Servers
  }
  if (ok) {
    merke(false);
    try {
      (await import("./toast.js")).merkeToast("Abgemeldet.");
    } catch {
      // Ohne den Toast lädt die Seite trotzdem neu
    }
    window.location.reload();
    return;
  }
  knopf.removeAttribute("aria-disabled");
  knopf.removeAttribute("aria-busy");
  try {
    (await import("./toast.js")).toast(
      "Abmelden hat nicht geklappt. Versuche es nochmals.",
      "fehler",
    );
  } catch {
    // Kein Netz für das Modul: Der Knopf ist wieder frei, die Person versucht es nochmals
  }
}

// Tastatur am Computer: Pfeile gehen durch Verwaltung, Mein Konto und Abmelden, Esc schliesst und gibt den Fokus zurück, ein Klick daneben und das Verlassen mit Tab schliessen
function binde(menue) {
  const zu = (fokusZurueck) => {
    menue.open = false;
    if (fokusZurueck) menue.querySelector("summary").focus();
  };
  const eintraege = () => [
    ...menue.querySelectorAll(".konto-liste a, .konto-liste button"),
  ];
  menue.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const liste = eintraege();
    const i = liste.indexOf(document.activeElement);
    if (e.key === "Escape" && menue.open) zu(true);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!menue.open) menue.open = true;
      const schritt = e.key === "ArrowDown" ? 1 : -1;
      const naechstes =
        i < 0
          ? schritt > 0
            ? 0
            : liste.length - 1
          : (i + schritt + liste.length) % liste.length;
      liste[naechstes].focus();
    } else if (e.key === "Home" && i >= 0) liste[0].focus();
    else if (e.key === "End" && i >= 0) liste.at(-1).focus();
    else return;
    e.preventDefault();
  });
  menue.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !menue.contains(e.relatedTarget)) menue.open = false;
  });
  document.addEventListener("click", (e) => {
    if (menue.open && !menue.contains(e.target)) menue.open = false;
  });
}

function baueMenue(daten, imMenue) {
  const menue = vorlage.content.firstElementChild.cloneNode(true);
  fuelle(menue, daten);
  const knopf = menue.querySelector('[data-konto="abmelden"]');
  knopf.addEventListener("click", () => abmelden(knopf));
  if (imMenue) {
    // Im Menü am Handy steht die Liste ausgeklappt und ohne Knopf zum Zuklappen (kopf.css)
    menue.open = true;
    menue.classList.add("konto-menue--liste");
  } else {
    binde(menue);
  }
  return menue;
}

async function start() {
  const daten = await frage();
  if (!daten) {
    merke(false);
    zeigeAnmelden();
    return daten;
  }
  merke(true);
  for (const anmelden of knoepfe) {
    anmelden.replaceWith(
      baueMenue(daten, anmelden.closest(".menue-fuss") !== null),
    );
  }
  zeigeAnmelden();
  // Mit Sitzung kommen auch die Seiten ins Menü, die nur Angemeldete sehen dürfen (#795); ohne Sitzung wird das Modul nie geladen
  try {
    import("./navigation.js").catch(() => {});
  } catch {
    // Das Menü bleibt, wie es ist
  }
  return daten;
}

// Ein Toast wartet von der Seite davor (Angemeldet, Abgemeldet): Das Modul zeigt ihn beim Laden. Der Schlüssel steht auch in toast.js (MERKER)
try {
  if (window.sessionStorage.getItem("cevi-toast")) import("./toast.js");
} catch {
  // Kein Speicher: nichts zu zeigen
}

if (vorlage && knoepfe.length > 0) {
  const zustand = start();
  // Zurück aus dem Zwischenspeicher des Browsers (nach Anmelden oder Abmelden in einem anderen Fenster): Wechselt der Zustand, lädt die Seite neu
  window.addEventListener("pageshow", async (e) => {
    if (!e.persisted) return;
    const vorher = (await zustand) !== null;
    if (((await frage()) !== null) !== vorher) window.location.reload();
  });
}
