import { anfrage } from "./api.js";
import { auswahl, dialogFormular, el, feld, knopf } from "./dom.js";
import { skeletonVon } from "./lager-skeleton.js";
import { ADRESSE, haenge, ID, nichtGefunden } from "./lager-gemeinsam.js";
import { istVersionKonflikt, schreibFehlertext } from "./lager-konflikt.js";
import { ansichtVon } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { personZeile } from "./lager-aufgaben-gemeinsam.js";
import { personName } from "./lager-start-teile.js";
import { leerKarte } from "./zustaende.js";

// Modul «Ressorts» (#672): Liste mit Reihenfolge per Ziehen (Griff, Tastatur, Hoch/Runter), Ressort mit Leitung, Stellvertretung und Notiz, dazu Links und Notizen je Ressort. Adressen: …/ressorts, …/ressorts/<ressortId>. GET/POST/PATCH/DELETE /api/v1/lager/{id}/ressorts…; Lesen braucht ressorts.lesen, Ändern ressorts.bearbeiten. Version-Konflikt: 409 mit dem Stand des Servers im Text.

const basis = (id) => `/api/v1/lager/${id}/ressorts`;

// Alle Seiten der Liste holen (die Route liefert höchstens 100 je Seite)
async function ladeAlle(id) {
  const alle = [];
  let nach;
  for (let i = 0; i < 20; i++) {
    const s = await anfrage(
      "GET",
      `${basis(id)}?limit=100${nach ? `&nach=${nach}` : ""}`,
    );
    alle.push(...s.ressorts);
    if (!s.naechster) break;
    nach = s.naechster;
  }
  return alle;
}

// Text bei einem Konflikt: nennt, was jetzt auf dem Server steht
export const konfliktText = (f, beschreibe) =>
  istVersionKonflikt(f) && f.daten?.aktuell
    ? `Jemand hat das inzwischen geändert. Jetzt steht da: ${beschreibe(f.daten.aktuell)} Schliesse diese Seite und öffne den Eintrag neu, dann kannst du deine Änderung nochmals eintragen.`
    : schreibFehlertext(f);

const RESSORT_FEHLER = {
  KUERZEL_VERGEBEN: "Dieses Kürzel gibt es in diesem Lager schon.",
  RESSORT_HAT_UNTERRESSORTS:
    "Das Ressort hat Unterressorts. Verschiebe oder lösche sie zuerst.",
};
const ressortFehler = (f) =>
  RESSORT_FEHLER[f?.code] ??
  konfliktText(f, (a) => `«${a.name}» (${a.kuerzel}).`);

// Mitglieder für Leitung und Stellvertretung; ohne Recht (einteilung.lesen) bleibt die Liste leer und die Felder fehlen
async function ladeMitglieder(id) {
  try {
    return (await anfrage("GET", `/api/v1/lager/${id}/mitglieder`)).mitglieder;
  } catch {
    return null;
  }
}

async function ressortFormular({ ctx, lager, ressort, alle, danach }) {
  const mitglieder = await ladeMitglieder(lager.id);
  const kuerzel = feld({
    label: "Kürzel",
    wert: ressort?.kuerzel ?? "",
    maxlength: 20,
    autocomplete: "off",
    required: true,
  });
  const name = feld({
    label: "Name",
    wert: ressort?.name ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const personen = (label, wert) =>
    mitglieder
      ? auswahl({
          label,
          optionen: [
            ["", "Niemand"],
            ...mitglieder.map((m) => [m.personId, m.name]),
          ],
          wert: wert ?? "",
        })
      : null;
  const leitung = personen("Leitung", ressort?.leitungPersonId);
  const stv = personen("Stellvertretung", ressort?.stvPersonId);
  const eltern = auswahl({
    label: "Gehört zu",
    optionen: [
      ["", "Oberste Ebene"],
      ...alle
        .filter((r) => r.id !== ressort?.id)
        .map((r) => [r.id, `${r.kuerzel} ${r.name}`]),
    ],
    wert: ressort?.parentId ?? "",
  });
  const notiz = feld({
    label: "Notiz",
    hilfe: "Freiwillig.",
    wert: ressort?.notiz ?? "",
    mehrzeilig: true,
    maxlength: 5000,
    rows: 4,
  });
  const ruhig = auswahl({
    label: "Zustand",
    optionen: [
      ["nein", "Aktiv"],
      ["ja", "Ruhend"],
    ],
    wert: ressort?.ruhig ? "ja" : "nein",
  });
  dialogFormular({
    titel: ressort ? `«${ressort.name}» ändern` : "Neues Ressort",
    felder: [
      kuerzel.wurzel,
      name.wurzel,
      eltern.wurzel,
      ...(leitung ? [leitung.wurzel, stv.wurzel] : []),
      ruhig.wurzel,
      notiz.wurzel,
    ],
    ok: ressort ? "Speichern" : "Anlegen",
    senden: () => {
      const werte = {
        kuerzel: kuerzel.eingabe.value.trim(),
        name: name.eingabe.value.trim(),
        parentId: eltern.eingabe.value || null,
        notiz: notiz.eingabe.value.trim() || null,
        ruhig: ruhig.eingabe.value === "ja",
        ...(leitung
          ? {
              leitungPersonId: leitung.eingabe.value || null,
              stvPersonId: stv.eingabe.value || null,
            }
          : {}),
      };
      return ressort
        ? anfrage("PATCH", `${basis(lager.id)}/${ressort.id}`, {
            version: ressort.version,
            ...werte,
          })
        : anfrage("POST", basis(lager.id), werte);
    },
    fehlertext: ressortFehler,
    danach: (r) => {
      ctx.melde(ressort ? "Gespeichert." : `«${r.name}» ist angelegt.`);
      danach();
    },
  });
}

// Liste -------------------------------------------------------------------

function liste(bereich, ctx, lager) {
  const darf =
    !lager.schreibgeschuetzt && lager.rechte.includes("ressorts.bearbeiten");
  ctx.titel("Ressorts", "Wer im Lager wofür zuständig ist.");
  ctx.lade(
    () => ladeAlle(lager.id),
    (alle, neu) => {
      ctx.kopfAktion(
        ...(darf
          ? [
              knopf("Neues Ressort", {
                art: "haupt",
                symbol: "plus",
                onclick: () =>
                  ressortFormular({ ctx, lager, alle, danach: neu }),
              }),
            ]
          : []),
      );
      if (alle.length === 0) {
        bereich.append(
          leerKarte(
            darf
              ? "Es gibt noch kein Ressort. Lege das erste oben rechts an."
              : "Es gibt noch kein Ressort.",
          ),
        );
        return;
      }
      const name = new Map(alle.map((r) => [r.id, r.name]));
      const zeile = (r) =>
        el(
          "div",
          { class: "lg-ressort" },
          el(
            "a",
            {
              class: "lg-ressort-name",
              href: `${ADRESSE}/${lager.id}/ressorts/${r.id}`,
            },
            r.name,
          ),
          el("span", { class: "chip" }, r.kuerzel),
          r.ruhig ? el("span", { class: "chip" }, "Ruhend") : "",
          el(
            "span",
            { class: "klein leise" },
            [
              r.parentId ? `Gehört zu ${name.get(r.parentId) ?? "?"}` : null,
              r.leitung ? `Leitung: ${personName(r.leitung)}` : null,
              r.stv ? `Stellvertretung: ${personName(r.stv)}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        );
      if (!darf) {
        bereich.append(
          el(
            "ul",
            { class: "lg-liste flaeche" },
            alle.map((r) => el("li", { class: "lg-zeile" }, zeile(r))),
          ),
        );
        return;
      }
      const versionen = new Map(alle.map((r) => [r.id, r.version]));
      const sl = sortierListe({
        beschriftung: "Ressorts",
        eintraege: alle.map((r) => ({
          id: r.id,
          text: r.name,
          inhalt: zeile(r),
        })),
        mitRueckgaengig: ctx.mitRueckgaengig,
        aktionstext: "Reihenfolge der Ressorts geändert",
        beiNeu: async (ids) => {
          try {
            await anfrage("PUT", `${basis(lager.id)}/reihenfolge`, {
              eintraege: ids.map((id) => ({ id, version: versionen.get(id) })),
            });
          } catch (f) {
            ctx.melde(ressortFehler(f), "fehler");
            neu();
            throw f;
          }
          // Die Versionen haben sich geändert: neu laden, ohne den Bereich zu leeren
          neu();
        },
      });
      bereich.append(sl.wurzel ?? sl);
    },
    { skeleton: skeletonVon({ knopf: true, inhalt: "liste", zeilen: 5 }) },
  );
}

// Detail ------------------------------------------------------------------

function linkFormular({ ctx, lager, ressortId, link, danach }) {
  const titel = feld({
    label: "Titel",
    wert: link?.titel ?? "",
    maxlength: 200,
    required: true,
    autocomplete: "off",
  });
  const url = feld({
    label: "Adresse",
    hilfe: "Nur https, ohne Zugangsdaten.",
    typ: "url",
    wert: link?.url ?? "",
    maxlength: 2000,
    required: true,
    autocomplete: "off",
  });
  dialogFormular({
    titel: link ? "Link ändern" : "Neuer Link",
    felder: [titel.wurzel, url.wurzel],
    ok: link ? "Speichern" : "Hinzufügen",
    senden: () => {
      const werte = {
        titel: titel.eingabe.value.trim(),
        url: url.eingabe.value.trim(),
      };
      const pfad = `${basis(lager.id)}/${ressortId}/links`;
      return link
        ? anfrage("PATCH", `${pfad}/${link.id}`, {
            version: link.version,
            ...werte,
          })
        : anfrage("POST", pfad, werte);
    },
    fehlertext: (f) =>
      f?.status === 400
        ? "Die Adresse ist nicht erlaubt. Sie muss mit https beginnen und darf keine Zugangsdaten enthalten."
        : konfliktText(f, (a) => `«${a.titel}», ${a.url}.`),
    danach: () => {
      ctx.melde("Gespeichert.");
      danach();
    },
  });
}

function notizFormular({ ctx, lager, ressortId, notiz, danach }) {
  const text = feld({
    label: "Notiz",
    wert: notiz?.text ?? "",
    mehrzeilig: true,
    maxlength: 10000,
    rows: 6,
    required: true,
  });
  dialogFormular({
    titel: notiz ? "Notiz ändern" : "Neue Notiz",
    felder: [text.wurzel],
    ok: notiz ? "Speichern" : "Hinzufügen",
    senden: () => {
      const pfad = `${basis(lager.id)}/${ressortId}/notizen`;
      const t = text.eingabe.value.trim();
      return notiz
        ? anfrage("PATCH", `${pfad}/${notiz.id}`, {
            version: notiz.version,
            text: t,
          })
        : anfrage("POST", pfad, { text: t });
    },
    fehlertext: (f) => konfliktText(f, (a) => `«${a.text}»`),
    danach: () => {
      ctx.melde("Gespeichert.");
      danach();
    },
  });
}

function detail(bereich, ctx, lager, ressortId) {
  const darf =
    !lager.schreibgeschuetzt && lager.rechte.includes("ressorts.bearbeiten");
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `${basis(lager.id)}/${ressortId}`),
        anfrage("GET", `${basis(lager.id)}/${ressortId}/links`),
        anfrage("GET", `${basis(lager.id)}/${ressortId}/notizen`),
        ladeAlle(lager.id),
      ]),
    ([ressort, { links }, { notizen }, alle], neu) => {
      ctx.titel(ressort.name, `Ressort ${ressort.kuerzel}`);
      ctx.kopfAktion(
        ...(darf
          ? [
              knopf("Ändern", {
                symbol: "bearbeiten",
                onclick: () =>
                  ressortFormular({ ctx, lager, ressort, alle, danach: neu }),
              }),
            ]
          : []),
      );
      const loesche = (zeileKnoten, text, pfad, version) =>
        ctx.mitRueckgaengig({
          text,
          ansicht: ansichtVon(zeileKnoten),
          ausfuehren: () => anfrage("DELETE", `${pfad}?version=${version}`),
          fehlertext: ressortFehler,
          danach: neu,
        });
      const loeschKnopf = (label, onclick) => {
        const k = knopf("Löschen", {
          klein: true,
          symbol: "papierkorb",
          onclick,
        });
        k.setAttribute("aria-label", label);
        return k;
      };
      const linkZeile = (l) => {
        const z = el(
          "li",
          { class: "lg-zeile" },
          el(
            "div",
            { class: "lg-zeile-text" },
            el(
              "a",
              { href: l.url, target: "_blank", rel: "noopener noreferrer" },
              l.titel,
            ),
          ),
        );
        if (darf)
          z.append(
            knopf("Ändern", {
              klein: true,
              symbol: "bearbeiten",
              onclick: () =>
                linkFormular({ ctx, lager, ressortId, link: l, danach: neu }),
            }),
            loeschKnopf(`Link «${l.titel}» löschen`, () =>
              loesche(
                z,
                `Link «${l.titel}» ist gelöscht`,
                `${basis(lager.id)}/${ressortId}/links/${l.id}`,
                l.version,
              ),
            ),
          );
        return z;
      };
      const notizZeile = (n) => {
        const z = el(
          "li",
          { class: "lg-zeile lg-zeile--notiz" },
          el(
            "div",
            { class: "lg-zeile-text" },
            el("p", { class: "lg-notiz" }, n.text),
            el(
              "span",
              { class: "klein leise" },
              [
                n.von ? personName(n.von) : null,
                new Date(n.erstelltAm).toLocaleDateString("de-CH"),
              ]
                .filter(Boolean)
                .join(" · "),
            ),
          ),
        );
        if (darf)
          z.append(
            knopf("Ändern", {
              klein: true,
              symbol: "bearbeiten",
              onclick: () =>
                notizFormular({ ctx, lager, ressortId, notiz: n, danach: neu }),
            }),
            loeschKnopf("Notiz löschen", () =>
              loesche(
                z,
                "Notiz ist gelöscht",
                `${basis(lager.id)}/${ressortId}/notizen/${n.id}`,
                n.version,
              ),
            ),
          );
        return z;
      };
      const loeschen = darf
        ? knopf("Ressort löschen", {
            art: "gefahr",
            symbol: "papierkorb",
            onclick: () =>
              ctx.mitRueckgaengig({
                text: `«${ressort.name}» ist gelöscht`,
                ansicht: ansichtVon(bereich),
                ausfuehren: () =>
                  anfrage(
                    "DELETE",
                    `${basis(lager.id)}/${ressort.id}?version=${ressort.version}`,
                  ),
                fehlertext: ressortFehler,
                danach: () =>
                  (location.hash = `${ADRESSE}/${lager.id}/ressorts`),
              }),
          })
        : null;
      haenge(
        bereich,
        el(
          "a",
          { class: "lg-zurueck", href: `${ADRESSE}/${lager.id}/ressorts` },
          "Alle Ressorts",
        ),
        el(
          "section",
          { class: "flaeche" },
          el("h3", { class: "lg-kartentitel" }, "Angaben"),
          el(
            "dl",
            { class: "werte" },
            [
              ["Kürzel", ressort.kuerzel],
              ["Leitung", personZeile(ressort.leitung, { leer: "–" })],
              ["Stellvertretung", personZeile(ressort.stv, { leer: "–" })],
              ["Zustand", ressort.ruhig ? "Ruhend" : "Aktiv"],
              ["Notiz", ressort.notiz ?? "–"],
            ].map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))),
          ),
        ),
        el(
          "section",
          { class: "flaeche" },
          el(
            "div",
            { class: "lg-kopfzeile" },
            el("h3", { class: "lg-kartentitel" }, "Links"),
            darf
              ? knopf("Link hinzufügen", {
                  klein: true,
                  symbol: "plus",
                  onclick: () =>
                    linkFormular({ ctx, lager, ressortId, danach: neu }),
                })
              : "",
          ),
          links.length === 0
            ? el("p", { class: "leise" }, "Noch kein Link.")
            : el("ul", { class: "lg-liste" }, links.map(linkZeile)),
        ),
        el(
          "section",
          { class: "flaeche" },
          el(
            "div",
            { class: "lg-kopfzeile" },
            el("h3", { class: "lg-kartentitel" }, "Notizen"),
            darf
              ? knopf("Notiz hinzufügen", {
                  klein: true,
                  symbol: "plus",
                  onclick: () =>
                    notizFormular({ ctx, lager, ressortId, danach: neu }),
                })
              : "",
          ),
          notizen.length === 0
            ? el("p", { class: "leise" }, "Noch keine Notiz.")
            : el("ul", { class: "lg-liste" }, notizen.map(notizZeile)),
        ),
        loeschen && el("div", { class: "lg-fuss" }, loeschen),
      );
    },
    { skeleton: skeletonVon("detail") },
  );
}

export function zeige(bereich, ctx, id, lager) {
  const [ressortId, weiter] = ctx.weiter ?? [];
  if (ressortId === undefined) return liste(bereich, ctx, lager);
  if (!ID.test(ressortId) || weiter !== undefined)
    return ctx.lade(nichtGefunden, () => {});
  return detail(bereich, ctx, lager, ressortId);
}
