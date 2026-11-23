import { anfrage } from "./api.js";
import {
  auswahl,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  tabelle,
} from "./dom.js";
import { blendeAus, skeletonTausch } from "./lager-einteilung-laden.js";
import { blitze, ersetzeMitBewegung, zaehleBis } from "./lager-anim.js";
import { leerKarte } from "./zustaende.js";
import { beschrifteZellen, haenge, kartenTabelle } from "./lager-gemeinsam.js";
import { tagText, TAUSCH_STATUS, tauschSatz } from "./lager-menschen-logik.js";
import {
  kopfAktion,
  keinLeserecht,
  kopfeMitHinweis,
  LB,
  ladeAlle,
  ladeKontext,
  meldung,
  zustandsChip,
} from "./lager-menschen.js";

// Diensttausch (#675; Server #389): Wer eine eigene Schicht tauschen oder abgeben will, stellt eine Anfrage; die Lagerleitung entscheidet. Ob die Wunschperson einverstanden ist, klärt die Lagerleitung selbst. Erst «Annehmen» bucht um; der Server prüft dabei Abwesenheit und Doppeldienst nochmals. Adresse: #lager/lager/<id>/diensttausch

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      const entscheiden = k.darf("diensttausch.entscheiden");
      const anfragen = k.darf("diensttausch.anfragen");
      if (!entscheiden && !anfragen) return { k, ohne: true };
      const [alle, eigene, mitglieder] = await Promise.all([
        entscheiden ? ladeAlle(`${LB(lagerId)}/diensttausch`, "tausche") : [],
        anfragen
          ? anfrage("GET", `${LB(lagerId)}/diensttausch/eigene`).then(
              (a) => a.tausche,
            )
          : [],
        k.darf("einteilung.lesen")
          ? anfrage("GET", `${LB(lagerId)}/mitglieder`)
              .then((m) => m.mitglieder)
              .catch(() => [])
          : [],
      ]);
      return { k, entscheiden, anfragen, alle, eigene, mitglieder };
    },
    (d, neu) => {
      kopfeMitHinweis(bereich, ctx, d.k, "Diensttausch");
      if (d.ohne) return keinLeserecht(bereich, "den Diensttausch");
      zeichne(bereich, ctx, d, neu);
    },
    {
      skeleton: () =>
        skeletonTausch({
          entscheiden:
            lager?.rechte?.includes("diensttausch.entscheiden") ?? true,
          anfragen: lager?.rechte?.includes("diensttausch.anfragen") ?? true,
        }),
    },
  );
}

const STATUS_CHIP = {
  offen: ["warn", "uhr"],
  angenommen: ["ok", "haken"],
  abgelehnt: ["fehler", "sperre"],
  zurueckgezogen: [undefined, "minus"],
};
const statusChip = (s) =>
  zustandsChip(TAUSCH_STATUS[s] ?? s, STATUS_CHIP[s]?.[0], STATUS_CHIP[s]?.[1]);

function zeichne(
  bereich,
  ctx,
  { k, entscheiden, anfragen, alle, eigene, mitglieder },
  neu,
) {
  const schreiben = (r) => k.kann(r);
  kopfAktion(
    ctx,
    anfragen && schreiben("diensttausch.anfragen")
      ? knopf("Tausch anfragen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => anfrageSeite(ctx, k, mitglieder, neu),
        })
      : false,
  );

  // Nach einer Entscheidung holt die Seite nur die Anfragen neu: Die Zeile blendet aus, die Nachbarn rutschen nach, der Zähler zählt
  const zeilenort = {};
  async function frischen(id) {
    const [a, e] = await Promise.all([
      entscheiden ? ladeAlle(`${LB(k.lagerId)}/diensttausch`, "tausche") : [],
      anfragen
        ? anfrage("GET", `${LB(k.lagerId)}/diensttausch/eigene`).then(
            (x) => x.tausche,
          )
        : [],
    ]);
    const zeile = bereich.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    const bleibt = zeilenort.bleibt?.(a.find((x) => x.id === id));
    if (zeile && bleibt === false) await blendeAus(zeile);
    alle = a;
    eigene = e;
    zeilenort.zeichne?.();
    zeilenort.zeichneEigene?.();
    blitze(bereich.querySelector(`[data-id="${CSS.escape(id)}"]`));
  }
  async function entscheide(t, entscheid, mitPersonId) {
    try {
      await anfrage("POST", `${LB(k.lagerId)}/diensttausch/${t.id}/entscheid`, {
        entscheid,
        version: t.version,
        ...(mitPersonId ? { mitPersonId } : {}),
      });
      ctx.melde(
        entscheid === "angenommen"
          ? "Tausch angenommen. Der Schichtplan ist angepasst."
          : "Anfrage abgelehnt. Der Schichtplan bleibt, wie er ist.",
      );
      await frischen(t.id).catch(() => neu());
    } catch (f) {
      ctx.melde(meldung(f), "warn");
      if (f?.status === 409) neu();
    }
  }
  // Ohne Wunschperson sagt die Lagerleitung beim Annehmen, wer übernimmt
  function annehmen(t) {
    if (t.mitPersonId) return entscheide(t, "angenommen");
    const wer = auswahl({
      label: "Wer übernimmt die Schicht?",
      optionen: mitglieder
        .filter((m) => m.personId !== t.vonPersonId)
        .map((m) => [m.personId, m.name]),
      wert:
        mitglieder.find((m) => m.personId !== t.vonPersonId)?.personId ?? "",
    });
    dialogFormular({
      titel: "Wer übernimmt die Schicht?",
      beschreibung: tauschSatz(t),
      felder: [wer.wurzel],
      ok: "Annehmen",
      fehlertext: meldung,
      senden: () =>
        anfrage("POST", `${LB(k.lagerId)}/diensttausch/${t.id}/entscheid`, {
          entscheid: "angenommen",
          version: t.version,
          mitPersonId: wer.eingabe.value,
        }),
      danach: () => {
        ctx.melde("Tausch angenommen. Der Schichtplan ist angepasst.");
        frischen(t.id).catch(() => neu());
      },
    });
  }
  async function zieheZurueck(t) {
    try {
      await anfrage(
        "POST",
        `${LB(k.lagerId)}/diensttausch/${t.id}/zurueckziehen`,
        { version: t.version },
      );
      ctx.melde("Anfrage zurückgezogen.");
      await frischen(t.id).catch(() => neu());
    } catch (f) {
      ctx.melde(meldung(f), "warn");
      if (f?.status === 409) neu();
    }
  }

  // --- Anfragen, über die die Lagerleitung entscheidet ---
  if (entscheiden) {
    const stand = { status: "offen" };
    const ort = el("div");
    const zeichneListe = () => {
      const treffer = alle.filter(
        (t) =>
          stand.status === "alle" ||
          (stand.status === "offen"
            ? t.status === "offen"
            : t.status !== "offen"),
      );
      if (treffer.length === 0) {
        ersetzeMitBewegung(
          ort,
          leerKarte(
            stand.status === "offen"
              ? "Keine offenen Anfragen."
              : "Keine Anfragen in dieser Auswahl.",
          ),
        );
        return;
      }
      const { wurzel, koerper } = tabelle({
        beschriftung: "Anfragen zum Diensttausch",
        spalten: [
          "Anfrage",
          "Notiz",
          "Status",
          ...(schreiben("diensttausch.entscheiden") ? ["Aktionen"] : []),
        ],
        zeilen: treffer.map((t) =>
          el(
            "tr",
            { "data-id": t.id },
            el(
              "th",
              { scope: "row" },
              el("span", { class: "name" }, tauschSatz(t)),
            ),
            el("td", {}, t.notiz ?? "–"),
            el("td", {}, statusChip(t.status)),
            schreiben("diensttausch.entscheiden") &&
              el(
                "td",
                { class: "rechts" },
                t.status === "offen"
                  ? el(
                      "div",
                      { class: "aktionen" },
                      knopf("Annehmen", {
                        klein: true,
                        art: "haupt",
                        kontext: t.vonName ?? undefined,
                        onclick: () => annehmen(t),
                      }),
                      knopf("Ablehnen", {
                        klein: true,
                        art: "still",
                        kontext: t.vonName ?? undefined,
                        onclick: () => entscheide(t, "abgelehnt"),
                      }),
                    )
                  : false,
              ),
          ),
        ),
      });
      kartenTabelle(wurzel);
      beschrifteZellen(koerper, ["", "Notiz", "Status", ""]);
      ersetzeMitBewegung(ort, wurzel);
    };
    zeilenort.zeichne = () => {
      zeichneListe();
      const n = filter.wurzel.querySelector("button .n");
      if (n)
        zaehleBis(
          n,
          alle.filter((t) => t.status === "offen").length,
          String,
          Number(n.textContent),
        );
    };
    // Bleibt die Zeile nach der Entscheidung in der gewählten Liste?
    zeilenort.bleibt = (t) =>
      !t ||
      stand.status === "alle" ||
      (stand.status === "offen" ? t.status === "offen" : t.status !== "offen");
    const filter = filterGruppe({
      beschriftung: "Status",
      eintraege: [
        {
          text: "Offen",
          n: alle.filter((t) => t.status === "offen").length,
          wert: "offen",
        },
        { text: "Entschieden", wert: "entschieden" },
        { text: "Alle", wert: "alle" },
      ],
      beiAenderung: (s) => {
        stand.status = s;
        zeichneListe();
      },
    });
    haenge(
      bereich,
      el("h2", {}, "Anfragen"),
      el(
        "p",
        { class: "klein leise" },
        "Ob die Wunschperson einverstanden ist, klärst du selbst mit ihr. Beim Annehmen prüft der Server Abwesenheit und Doppeldienste noch einmal.",
      ),
      filter.wurzel,
      ort,
    );
    zeichneListe();
  }

  // --- Eigene Anfragen ---
  if (anfragen) {
    const eigenOrt = el("div");
    zeilenort.zeichneEigene = () =>
      ersetzeMitBewegung(
        eigenOrt,
        eigene.length === 0
          ? leerKarte(
              "Du hast keine Anfragen gestellt. Einen Tausch fragst du hier bei einer deiner Schichten an.",
            )
          : el(
              "ul",
              { class: "liste-zeilen" },
              eigene.map((t) =>
                el(
                  "li",
                  { "data-id": t.id },
                  el("span", {}, tauschSatz({ ...t, vonName: "Du" })),
                  statusChip(t.status),
                  t.status === "offen" && schreiben("diensttausch.anfragen")
                    ? knopf("Zurückziehen", {
                        klein: true,
                        art: "still",
                        onclick: () => zieheZurueck(t),
                      })
                    : false,
                ),
              ),
            ),
      );
    haenge(bereich, el("h2", {}, "Deine Anfragen"), eigenOrt);
    zeilenort.zeichneEigene();
  }
}

// Neue Anfrage: eigene Schicht wählen und sagen, was damit geschehen soll
async function anfrageSeite(ctx, k, mitglieder, neu) {
  let daten;
  try {
    daten = await Promise.all([
      anfrage("GET", `${LB(k.lagerId)}/schichtplan`),
      anfrage("GET", "/api/v1/ich"),
    ]);
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  }
  const [plan, ich] = daten;
  const dienstName = new Map(plan.dienste.map((d) => [d.id, d.name]));
  const text = (s) =>
    `${dienstName.get(s.dienstId) ?? "Dienst"}, ${tagText(s.datum)}`;
  const meine = plan.schichten.filter((s) => s.personId === ich.id);
  if (meine.length === 0) {
    ctx.melde(
      "Du hast keine Schicht, die du tauschen könntest. Dein Eintrag im Schichtplan fehlt noch.",
      "info",
    );
    return;
  }
  const andere = plan.schichten.filter(
    (s) => s.personId && s.personId !== ich.id,
  );
  const schicht = auswahl({
    label: "Deine Schicht",
    optionen: meine.map((s) => [s.id, text(s)]),
    wert: meine[0].id,
  });
  const form = auswahl({
    label: "Was soll geschehen?",
    optionen: [
      ["abgeben", "Abgeben"],
      ["person", "An eine Person"],
      ["tauschen", "Tauschen"],
    ],
    wert: "abgeben",
  });
  const person = auswahl({
    label: "An wen?",
    optionen: mitglieder
      .filter((m) => m.personId !== ich.id)
      .map((m) => [m.personId, m.name]),
    wert: mitglieder.find((m) => m.personId !== ich.id)?.personId ?? "",
  });
  const wunsch = auswahl({
    label: "Mit welcher Schicht?",
    optionen:
      andere.length > 0
        ? andere.map((s) => [s.id, `${s.name}: ${text(s)}`])
        : [["", "Es gibt keine Schicht einer anderen Person"]],
    wert: andere[0]?.id ?? "",
  });
  const notiz = feld({
    label: "Notiz",
    hilfe: "Freiwillig. Die Lagerleitung entscheidet.",
    mehrzeilig: true,
    maxlength: 500,
  });
  const zeigeForm = () => {
    person.wurzel.hidden = form.eingabe.value !== "person";
    wunsch.wurzel.hidden = form.eingabe.value !== "tauschen";
  };
  form.eingabe.addEventListener("change", zeigeForm);
  zeigeForm();
  dialogFormular({
    titel: "Tausch anfragen",
    beschreibung:
      "Die Lagerleitung entscheidet. Ob die Wunschperson zustimmt, klärst du selbst mit ihr.",
    felder: [
      schicht.wurzel,
      form.wurzel,
      person.wurzel,
      wunsch.wurzel,
      notiz.wurzel,
    ],
    ok: "Anfrage senden",
    fehlertext: meldung,
    pruefe: () => {
      if (form.eingabe.value === "tauschen" && !wunsch.eingabe.value) {
        wunsch.wurzel.querySelector(".feld-fehler")?.remove();
        wunsch.wurzel.append(
          el(
            "p",
            { class: "feld-fehler", role: "alert" },
            "Es gibt keine Schicht einer anderen Person zum Tauschen. Wähle «Abgeben».",
          ),
        );
        return true;
      }
      return false;
    },
    senden: () =>
      anfrage("POST", `${LB(k.lagerId)}/diensttausch`, {
        schichtId: schicht.eingabe.value,
        ...(form.eingabe.value === "person"
          ? { mitPersonId: person.eingabe.value }
          : {}),
        ...(form.eingabe.value === "tauschen"
          ? { mitSchichtId: wunsch.eingabe.value }
          : {}),
        ...(notiz.eingabe.value.trim()
          ? { notiz: notiz.eingabe.value.trim() }
          : {}),
      }),
    danach: () => {
      ctx.melde("Anfrage gesendet. Die Lagerleitung entscheidet.");
      neu();
    },
  });
}
