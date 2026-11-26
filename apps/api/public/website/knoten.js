// Baut DOM-Knoten aus den JSON-Knoten, die GET /api/v1/website/inhalt liefert (#354). Nie innerHTML: Text kommt als Textknoten, Elemente und Attribute nur aus einer festen Liste mit geprüften Werten.
// Der Server prüft dieselben Regeln beim Erzeugen; dies ist die zweite Schicht, falls je etwas anderes ankäme.

const TAGS = new Set([
  "p",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "em",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "figure",
  "figcaption",
  "img",
  "dl",
  "dt",
  "dd",
  // Text und Gestaltung (#741): Zitat, Aufklappliste, Tabelle
  "blockquote",
  "details",
  "summary",
  "table",
  "caption",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  // Formular (#819): ein Formular sendet nichts selbst (form-action der CSP ist «none»), formular.js schickt die Antwort als JSON
  "section",
  "form",
  "fieldset",
  "legend",
  "label",
  "input",
  "select",
  "option",
  "textarea",
  "button",
]);

const MAX_TIEFE = 20;
const MAX_TEXT = 20000;

// Wie linkArt() auf dem Server: https mit Host, mailto, tel oder ein Pfad der Website; nie «//host», «\», Leerraum oder Steuerzeichen
function hrefOk(w) {
  return (
    typeof w === "string" &&
    w.length <= 2000 &&
    !/[\s\p{Cc}\\<>"]/u.test(w) &&
    (/^https:\/\/[^/?#]/.test(w) ||
      /^mailto:[^@]+@[^@]+$/.test(w) ||
      /^tel:\+?[0-9]{3,20}$/.test(w) ||
      /^\/(?!\/)/.test(w))
  );
}

// Formular (#819): Namen und IDs wie die Renderer sie bilden (a-z, 0-9, «-» und «_»)
const idOk = (w) => typeof w === "string" && /^[a-z0-9_-]{1,100}$/.test(w);
const FELD = new Set(["input", "select", "textarea"]);
const ZAHL = (w, n) =>
  typeof w === "string" && new RegExp("^[0-9]{1," + n + "}$").test(w);
const GRENZE = /^-?[0-9.e+-]{1,25}$/;

// Je Attribut eine Prüfung des Werts; was hier fehlt, wird nicht gesetzt (nie ein on…-Attribut, nie style)
const ATTRIBUTE = {
  href: (tag, w) => tag === "a" && hrefOk(w),
  rel: (tag, w) => tag === "a" && w === "noopener noreferrer",
  download: (tag, w) => tag === "a" && w === true,
  src: (tag, w) =>
    tag === "img" &&
    typeof w === "string" &&
    /^\/api\/v1\/medien\/[0-9a-f-]{36}$/.test(w),
  alt: (tag, w) => tag === "img" && typeof w === "string" && w.length <= 2000,
  width: (tag, w) => tag === "img" && /^[0-9]{1,5}$/.test(w),
  height: (tag, w) => tag === "img" && /^[0-9]{1,5}$/.test(w),
  loading: (tag, w) => tag === "img" && w === "lazy",
  decoding: (tag, w) => tag === "img" && w === "async",
  class: (_tag, w) => typeof w === "string" && /^[a-z0-9 _-]{1,60}$/.test(w),
  "aria-hidden": (_tag, w) => w === "true",
  // Safari und VoiceOver nennen eine Liste mit «list-style: none» nur mit dieser Rolle eine Liste (#645); eine Gruppe mit Namen ist der Bildstreifen (#742)
  // «status» ist die Meldung eines Formulars (#819)
  role: (tag, w) =>
    ((tag === "ul" || tag === "ol") && w === "list") ||
    (tag === "div" && (w === "region" || w === "group" || w === "status")),
  // Tabelle (#741): Kopfzellen für Spalte oder Zeile; die scrollbare Fläche ist mit der Tastatur erreichbar und benannt
  scope: (tag, w) => tag === "th" && (w === "col" || w === "row"),
  // Die Falle gegen Skripte ist nie mit der Tastatur erreichbar (#819)
  tabindex: (tag, w) =>
    (tag === "div" && w === "0") || (tag === "input" && w === "-1"),
  "aria-label": (tag, w) =>
    (tag === "div" || tag === "section") &&
    typeof w === "string" &&
    w.length <= 200,
  // Formular (#819)
  id: (_tag, w) => idOk(w),
  for: (tag, w) => tag === "label" && idOk(w),
  name: (tag, w) => FELD.has(tag) && idOk(w),
  type: (tag, w) =>
    (tag === "input" &&
      ["text", "email", "tel", "date", "checkbox", "radio"].includes(w)) ||
    (tag === "button" && w === "submit"),
  value: (tag, w) =>
    (tag === "input" || tag === "option") &&
    typeof w === "string" &&
    w.length <= 200,
  required: (tag, w) => FELD.has(tag) && w === true,
  novalidate: (tag, w) => tag === "form" && w === true,
  method: (tag, w) => tag === "form" && w === "post",
  action: (tag, w) => tag === "form" && w === "#",
  maxlength: (tag, w) => (tag === "input" || tag === "textarea") && ZAHL(w, 4),
  minlength: (tag, w) => (tag === "input" || tag === "textarea") && ZAHL(w, 4),
  rows: (tag, w) => tag === "textarea" && ZAHL(w, 2),
  min: (tag, w) => tag === "input" && GRENZE.test(w),
  max: (tag, w) => tag === "input" && GRENZE.test(w),
  inputmode: (tag, w) =>
    tag === "input" && ["numeric", "decimal", "email", "tel"].includes(w),
  autocomplete: (tag, w) =>
    tag === "input" &&
    [
      "off",
      "email",
      "tel",
      "name",
      "given-name",
      "family-name",
      "bday",
      "street-address",
      "postal-code",
      "address-level2",
    ].includes(w),
  spellcheck: (tag, w) => tag === "input" && w === "false",
  "aria-describedby": (_tag, w) =>
    typeof w === "string" && w.split(" ").every(idOk),
  "aria-labelledby": (tag, w) => tag === "section" && idOk(w),
  "data-formular": (tag, w) => tag === "section" && /^[0-9a-f-]{36}$/.test(w),
  "data-schliesst": (tag, w) => tag === "section" && /^d{4}-d{2}-d{2}$/.test(w),
  "data-typ": (_tag, w) => typeof w === "string" && /^[a-z]{3,20}$/.test(w),
  "data-pflicht": (_tag, w) => w === "1",
  "data-ganz": (tag, w) => tag === "input" && w === "1",
  "data-min": (_tag, w) => GRENZE.test(w),
  "data-max": (_tag, w) => GRENZE.test(w),
  "data-danke": (tag, w) =>
    tag === "div" && typeof w === "string" && w.length <= 400,
};

// null, wenn der Knoten nicht erlaubt ist; Kinder, die nicht erlaubt sind, fallen weg
export function baueKnoten(doc, knoten, tiefe = 0) {
  if (typeof knoten === "string") {
    return doc.createTextNode(knoten.slice(0, MAX_TEXT));
  }
  if (
    knoten === null ||
    typeof knoten !== "object" ||
    tiefe > MAX_TIEFE ||
    !TAGS.has(knoten.tag)
  ) {
    return null;
  }
  const e = doc.createElement(knoten.tag);
  for (const [name, wert] of Object.entries(knoten.attr ?? {})) {
    if (Object.hasOwn(ATTRIBUTE, name) && ATTRIBUTE[name](knoten.tag, wert)) {
      e.setAttribute(name, wert === true ? "" : wert);
    }
  }
  for (const kind of Array.isArray(knoten.kinder) ? knoten.kinder : []) {
    const k = baueKnoten(doc, kind, tiefe + 1);
    if (k !== null) e.appendChild(k);
  }
  return e;
}
