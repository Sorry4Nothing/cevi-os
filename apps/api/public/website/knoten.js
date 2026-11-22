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
  class: (_tag, w) => typeof w === "string" && /^[a-z0-9 _-]{1,60}$/.test(w),
  "aria-hidden": (_tag, w) => w === "true",
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
