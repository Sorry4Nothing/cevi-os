// Seite «Anlass» (#530, Board W3): Titel, Eckdaten und der Kasten «Anmeldung» eines Anlasses.
// Abfrage: einmal GET /anlaesse/{id} (Anlass samt eigener Anmeldung). Die Adresse trägt die ID als «?id=»; ohne gültige ID gibt es nichts zu laden.
import {
  api,
  baue,
  bandView,
  datumKurz,
  datumLang,
  fehlerView,
  h,
  heute,
  icon,
  loginLink,
  ladeAnsage,
  melde,
  skelett,
  sk,
  teile,
  tagText,
  uhrzeit,
  zustandView,
} from "./tm.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ID aus «?id=…», sonst null
export function anlassId(suche) {
  const id = new URLSearchParams(suche).get("id");
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

export const anlassAdresse = (id) => `/anlass/?id=${id}`;
export const anmeldungAdresse = (id) => `/anlass/anmeldung/?id=${id}`;

// «17. bis 24. Juli 2027» oder «6. Februar 2027, 14:00–17:00»
export function anlassDatum(a) {
  if (a.ganztaegig) {
    if (a.tagVon === a.tagBis) return datumLang(a.tagVon);
    const von = datumKurz(a.tagVon);
    const bis = datumLang(a.tagBis);
    // Im selben Monat und Jahr: «17. bis 24. Juli 2027»
    return a.tagVon.slice(0, 7) === a.tagBis.slice(0, 7)
      ? `${von.split(" ")[0]} bis ${bis}`
      : `${von} bis ${bis}`;
  }
  const tag = tagText(teile(a.beginn));
  const ende = tagText(teile(a.ende));
  return ende === tag
    ? `${datumLang(tag)}, ${uhrzeit(a.beginn)}–${uhrzeit(a.ende)}`
    : `${datumLang(tag)}, ${uhrzeit(a.beginn)} bis ${datumLang(ende)}, ${uhrzeit(a.ende)}`;
}

// Anmeldeschluss als Tag («2027-03-15») oder null
export const fristTag = (a) => (a.frist ? tagText(teile(a.frist)) : null);

export function geschlossenText(a, heuteTag) {
  const frist = fristTag(a);
  return frist && frist < heuteTag
    ? `Die Anmeldung ist seit dem ${datumKurz(frist)} geschlossen.`
    : "Die Anmeldung ist geschlossen.";
}

export const angemeldete = (a) =>
  a.teilnehmende.filter((t) => t.anmeldung?.status === "angemeldet");

export const vorname = (t) =>
  t.konto.find((k) => k.schluessel === "vorname")?.wert ?? t.name;

const fakt = (symbol, name, wert) =>
  h(
    "div",
    { class: "fakt" },
    icon(symbol, false),
    h("dt", {}, name),
    h("dd", {}, wert),
  );

export function ladeKasten() {
  return h("div", { "aria-busy": "true" }, skelett(sk("r h56 b100")));
}

// Der Inhalt des Kastens «Anmeldung» nach den Zuständen des Boards
export function anmeldungInhalt(a, heuteTag) {
  const da = angemeldete(a);
  if (da.length > 0) {
    // Wer sich selbst angemeldet hat, heisst «Du»; Kinder mit Vornamen (#844)
    const namen = da.map((t) => (t.kindId ? vorname(t) : "Du"));
    const wer =
      namen.length === 1 && !da[0].kindId
        ? "Du bist angemeldet."
        : `${namen.join(" und ")} ${namen.length === 1 ? "ist" : "sind"} angemeldet.`;
    return bandView({
      art: "ok",
      symbol: "haken",
      titel: wer,
      aktion: h(
        "a",
        { class: "verweis", href: anmeldungAdresse(a.id) },
        "Anmeldung ansehen",
      ),
    });
  }
  if (!a.anmeldungOffen) {
    return bandView({
      symbol: "info",
      titel: geschlossenText(a, heuteTag),
      text: "Fragen beantwortet dir die Leitung.",
    });
  }
  return h(
    "a",
    { class: "btn p gross", href: anmeldungAdresse(a.id) },
    "Anmelden",
  );
}

export function anlassView(a, heuteTag) {
  const frist = fristTag(a);
  return h(
    "div",
    { class: "seite-spalte" },
    h(
      "dl",
      { class: "karte fakten" },
      fakt("kalender", "Datum", anlassDatum(a)),
      frist ? fakt("uhr", "Anmeldeschluss", datumLang(frist)) : null,
    ),
    h(
      "section",
      { class: "karte seite-spalte", "aria-labelledby": "tm-anm-t" },
      h("h2", { id: "tm-anm-t" }, "Anmeldung"),
      anmeldungInhalt(a, heuteTag),
    ),
  );
}

export const titelZeile = (a) => a.titel;

export function zustandAnsicht(art, id) {
  if (art === "abgemeldet") {
    return h(
      "div",
      { class: "seite-spalte" },
      h(
        "section",
        { class: "karte seite-spalte", "aria-labelledby": "tm-anm-t" },
        h("h2", { id: "tm-anm-t" }, "Anmeldung"),
        h(
          "div",
          { class: "schutzblock" },
          h("p", {}, "Melde dich an, um dich anzumelden."),
          h(
            "a",
            {
              class: "btn p gross",
              href: loginLink(id ? `/anlass?id=${id}` : "/"),
            },
            "Anmelden",
          ),
        ),
      ),
    );
  }
  if (art === "nichtGefunden") {
    return zustandView({
      symbol: "info",
      titel: "Diesen Anlass gibt es nicht.",
      text: "Prüfe den Link oder gehe zu den Terminen.",
      aktion: h(
        "a",
        { class: "btn s gross", href: "/termine/" },
        "Zu den Terminen",
      ),
    });
  }
  return fehlerView("nochmal");
}

function start(doc, wurzel) {
  const id = anlassId(doc.location.search);
  const kopf = doc.getElementById("tm-kopf");
  const inhalt = doc.createElement("div");
  wurzel.replaceChildren(inhalt);
  const zeige = (d) => inhalt.replaceChildren(baue(doc, d));
  const setzeKopf = (a) => {
    kopf.querySelector("h1").textContent = a.titel;
    kopf.querySelector(".kicker").textContent = anlassDatum(a);
    kopf.querySelector(".kicker").hidden = false;
    doc.title = `${a.titel} | ${doc.title.split(" | ").slice(1).join(" | ")}`;
  };

  async function lade() {
    if (!id) return zeige(zustandAnsicht("nichtGefunden"));
    zeige(
      h(
        "section",
        {
          class: "karte seite-spalte",
          "aria-labelledby": "tm-anm-t",
          "aria-busy": "true",
        },
        h("h2", { id: "tm-anm-t" }, "Anmeldung"),
        ladeKasten(),
      ),
    );
    const stopp = ladeAnsage(doc, "Der Anlass wird geladen.");
    const r = await api(`/anlaesse/${id}`);
    stopp();
    if (r.status === 200) {
      setzeKopf(r.daten);
      zeige(anlassView(r.daten, heute()));
      melde(doc, "Der Anlass ist geladen.");
    } else if (r.status === 401) {
      zeige(zustandAnsicht("abgemeldet", id));
    } else if (r.status === 404 || r.status === 403) {
      zeige(zustandAnsicht("nichtGefunden"));
    } else {
      zeige(zustandAnsicht("fehler"));
      melde(doc, "Das hat nicht geklappt.");
    }
  }
  wurzel.addEventListener("click", (e) => {
    if (e.target.closest?.('[data-aktion="nochmal"]')) lade();
  });
  lade();
}

const wurzel =
  typeof document === "undefined" ? null : document.getElementById("tm-app");
if (wurzel?.dataset.seite === "anlass") start(document, wurzel);
