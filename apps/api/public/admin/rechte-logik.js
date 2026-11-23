// Rollen und Rechte (#623): reine Logik ohne DOM, damit sie sich ohne Browser prüfen lässt. Sie rechnet nur mit dem, was die API schon liefert (Plattformrollen, Personen, Gruppen, Lager, Räume, Sonderrechte); sie führt kein neues Recht ein. Entschieden wird auf dem Server: Was hier «betroffen» heisst, ist eine Vorschau, kein Beweis.
// Klartext je Recht: Quelle ist docs/rechte.md, Abschnitt 2. Ein Recht, das der Server kennt und dieses Modul nicht, erscheint mit dem Text des Servers unter «Weitere».

export const BEREICHE = [
  ["seiten", "Seiten der Website"],
  ["medien", "Medien und Weiterleitungen"],
  ["betrieb", "Betrieb"],
  ["weitere", "Weitere"],
];

// Wirkung wie «liest, schreibt, zerstört» bei tool-permissions: Wer ein Recht mit heikler Wirkung vergibt, bekommt eine Rückfrage am Knopf
export const WIRKUNG = {
  aendern: { text: "Ändert Inhalte", heikel: false },
  oeffentlich: { text: "Wirkt öffentlich", heikel: true },
  loeschen: { text: "Löscht", heikel: true },
  betrieb: { text: "Sperrt die Website", heikel: true },
};

export const RECHT_INFO = {
  "seiten.bearbeiten": {
    bereich: "seiten",
    wirkung: "aendern",
    text: "Jede Seite der Website ansehen und ändern: Entwurf speichern, Aufbau ändern, frühere Version zurückholen, Angaben der Stufen.",
  },
  "seiten.veroeffentlichen": {
    bereich: "seiten",
    wirkung: "oeffentlich",
    text: "Seiten veröffentlichen und zurückziehen und das Logo der Website ändern. Was veröffentlicht ist und «öffentlich» heisst, sieht jeder im Internet.",
  },
  "seiten.anlegen_loeschen": {
    bereich: "seiten",
    wirkung: "loeschen",
    text: "Seiten anlegen, löschen, auf die oberste Ebene setzen und die Gruppe einer Seite ändern.",
  },
  "vorlagen.nutzen": {
    bereich: "seiten",
    wirkung: "aendern",
    text: "Seiten aus Vorlagen anlegen. Gilt nur zusammen mit «Seiten anlegen und löschen».",
  },
  "medien.verwalten": {
    bereich: "medien",
    wirkung: "loeschen",
    text: "Medien anderer Personen beschreiben und alle Medien löschen. Hochladen und die eigenen Medien beschreiben darf jede Person mit Zugang.",
  },
  "weiterleitungen.verwalten": {
    bereich: "medien",
    wirkung: "aendern",
    text: "Weiterleitungen alter Adressen ansehen, anlegen, ändern und löschen.",
  },
  "wartungsmodus.website": {
    bereich: "betrieb",
    wirkung: "betrieb",
    text: "Die Wartung der Website ein- und ausschalten. Dann kann niemand ausser Abteilungsleitung und Entwickler etwas ändern. Öffnet nicht die Verwaltung der Website.",
  },
};

// Titel, Text, Bereich und Wirkung eines Rechts; ein unbekanntes Recht behält den Text des Servers
export function infoVon(recht, bedeutung) {
  const i = RECHT_INFO[recht];
  return {
    recht,
    titel: bedeutung ?? recht,
    text: i?.text ?? bedeutung ?? recht,
    bereich: i?.bereich ?? "weitere",
    wirkung: i ? WIRKUNG[i.wirkung] : { text: "Ändert etwas", heikel: false },
  };
}

// Die Rechte des Katalogs, nach Bereich gruppiert in der Reihenfolge von BEREICHE; leere Bereiche entfallen
// katalog: [{ recht, bedeutung, erweitert }]
export function gruppiereKatalog(katalog) {
  const mitInfo = katalog.map((k) => ({
    ...infoVon(k.recht, k.bedeutung),
    erweitert: k.erweitert === true,
  }));
  return BEREICHE.map(([schluessel, name]) => ({
    schluessel,
    name,
    rechte: mitInfo.filter((r) => r.bereich === schluessel),
  })).filter((g) => g.rechte.length > 0);
}

// Die Rechte einer Rolle im Entwurf: gespeichert, solange nichts geändert ist
// entwurf: Map Rolle-Kennung -> Set der Rechte
export const rechteIm = (rolle, entwurf) =>
  entwurf.get(rolle.id) ?? new Set(rolle.rechte);

const gleich = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Eine Änderung nur, wenn sich die Menge wirklich ändert (ein Haken an und wieder aus ist keine)
export function setzeRecht(entwurf, rolle, recht, an) {
  const jetzt = new Set(rechteIm(rolle, entwurf));
  if (an) jetzt.add(recht);
  else jetzt.delete(recht);
  if (gleich(jetzt, new Set(rolle.rechte))) entwurf.delete(rolle.id);
  else entwurf.set(rolle.id, jetzt);
}

// [{ rolle, hinzu: [recht], weg: [recht] }] in der Reihenfolge der Rollen
export function aenderungen(rollen, entwurf) {
  return rollen
    .filter((r) => entwurf.has(r.id))
    .map((rolle) => {
      const jetzt = entwurf.get(rolle.id);
      const vorher = new Set(rolle.rechte);
      return {
        rolle,
        hinzu: [...jetzt].filter((x) => !vorher.has(x)),
        weg: [...vorher].filter((x) => !jetzt.has(x)),
      };
    })
    .filter((a) => a.hinzu.length + a.weg.length > 0);
}

export const anzahlAenderungen = (rollen, entwurf) =>
  aenderungen(rollen, entwurf).reduce(
    (summe, a) => summe + a.hinzu.length + a.weg.length,
    0,
  );

// Wer ist betroffen? Rechnet die Rechte jeder Person (Vereinigung ihrer Rollen) vor und nach dem Entwurf. Die Abteilungsleitung hat ohnehin jedes Recht und zählt nicht mit.
// rollen: Antwort von GET /admin/plattform/rollen; adminIds: Set der Kennungen der Abteilungsleitung
// Ergebnis: { gewinnen: Map recht -> [userId], verlieren: Map recht -> [userId], personen: Set userId, heikel: Map recht -> Anzahl Personen, die es neu bekommen }
export function betroffene(rollen, entwurf, adminIds, heikelVon) {
  const rollenJePerson = new Map();
  for (const rolle of rollen) {
    for (const p of rolle.personen) {
      if (adminIds.has(p.id)) continue;
      if (!rollenJePerson.has(p.id)) rollenJePerson.set(p.id, []);
      rollenJePerson.get(p.id).push(rolle);
    }
  }
  const gewinnen = new Map();
  const verlieren = new Map();
  const personen = new Set();
  const heikel = new Map();
  for (const [id, deren] of rollenJePerson) {
    const vorher = new Set(deren.flatMap((r) => r.rechte));
    const nachher = new Set(deren.flatMap((r) => [...rechteIm(r, entwurf)]));
    for (const recht of nachher) {
      if (vorher.has(recht)) continue;
      personen.add(id);
      gewinnen.set(recht, [...(gewinnen.get(recht) ?? []), id]);
      if (heikelVon(recht)) heikel.set(recht, (heikel.get(recht) ?? 0) + 1);
    }
    for (const recht of vorher) {
      if (nachher.has(recht)) continue;
      personen.add(id);
      verlieren.set(recht, [...(verlieren.get(recht) ?? []), id]);
    }
  }
  return { gewinnen, verlieren, personen, heikel };
}

// Der Satz unter der Speicherleiste: «3 Personen bekommen …, 1 Person verliert …»
export function vorschauText(b, titelVon) {
  const person = (n) => (n === 1 ? "1 Person" : `${n} Personen`);
  const teile = [];
  for (const [recht, ids] of b.gewinnen) {
    teile.push(
      `${person(ids.length)} ${ids.length === 1 ? "bekommt" : "bekommen"} «${titelVon(recht)}»`,
    );
  }
  for (const [recht, ids] of b.verlieren) {
    teile.push(
      `${person(ids.length)} ${ids.length === 1 ? "verliert" : "verlieren"} «${titelVon(recht)}»`,
    );
  }
  if (teile.length === 0) {
    return "Niemand ist betroffen: Die Rollen mit diesen Änderungen tragen keine Personen.";
  }
  return `${teile.join(". ")}.`;
}

// Was Stufenrollen tragen (docs/rechte.md, 4.2 und 4.4): nur zur Anzeige, die Stufenrollen setzt das Formular der Person
export const STUFENROLLE = {
  stufenleitung: "Stufenleitung",
  leitung: "Leitung",
};

const TEAM_VERANTWORTLICH = "verantwortlich";
export const istVerantwortlich = (rolle) =>
  typeof rolle === "string" && rolle.toLowerCase() === TEAM_VERANTWORTLICH;

// Die Zeilen von «Was darf wer?» für eine Person: je Recht oder Fähigkeit die Quellen (woher es kommt, wo es gilt, ob der zweite Faktor nötig ist). Sie spiegelt die Regeln aus docs/rechte.md; der Server entscheidet weiter selbst.
// d: { katalog, rollen, personen, stufen, gruppen, lager, raeume, sonderrechte, seiten }
// Ergebnis: [{ schluessel, titel, quellen: [{ umfang, herkunft, zf, link? }] }]; nur Zeilen mit mindestens einer Quelle
export function darfVon(userId, d) {
  const person = d.personen.find((p) => p.id === userId);
  if (!person) return [];
  const stufeName = new Map((d.stufen ?? []).map((s) => [s.id, s.name]));
  const zeilen = [];
  const neu = (schluessel, titel) => {
    const z = { schluessel, titel, quellen: [] };
    zeilen.push(z);
    return z;
  };
  const meineRollen = d.rollen.filter((r) =>
    r.personen.some((p) => p.id === userId),
  );
  const meineGruppen = d.gruppen.filter((g) =>
    g.mitglieder.some((m) => m.userId === userId),
  );
  const alsMitglied = (g) => g.mitglieder.find((m) => m.userId === userId);
  const stufenrollen = (person.rollen ?? []).filter(
    (r) => r.typ === "stufenleitung" || r.typ === "leitung",
  );
  const sl = stufenrollen.filter((r) => r.typ === "stufenleitung");

  if (person.admin) {
    neu(
      "verwaltung",
      "Verwaltung (Personen, Gruppen, Lager, Termine, Rechte, System)",
    ).quellen.push({
      umfang: "Alles in der Abteilung",
      herkunft: "Abteilungsleitung",
      zf: true,
    });
  }

  // Plattformrechte aus Rollen; die Abteilungsleitung hat jedes
  for (const k of d.katalog) {
    const z = neu(k.recht, infoVon(k.recht, k.bedeutung).titel);
    if (person.admin) {
      z.quellen.push({
        umfang: "Alle Seiten und Bereiche",
        herkunft: "Abteilungsleitung",
        zf: true,
      });
    }
    for (const r of meineRollen.filter((r) => r.rechte.includes(k.recht))) {
      z.quellen.push({
        umfang: "Alle Seiten und Bereiche",
        herkunft: `Rolle «${r.name}»`,
        zf: true,
        link: `#personen/rechte/rolle/${r.id}`,
      });
    }
    if (
      k.recht === "seiten.bearbeiten" ||
      k.recht === "seiten.veroeffentlichen"
    ) {
      for (const r of sl) {
        z.quellen.push({
          umfang: `Seiten der Stufe ${stufeName.get(r.stufeId) ?? "?"}`,
          herkunft: "Stufenleitung",
          zf: false,
        });
      }
      for (const g of meineGruppen.filter(
        (x) => x.typ === "team" && istVerantwortlich(alsMitglied(x)?.rolle),
      )) {
        z.quellen.push({
          umfang: `Seite des Teams «${g.name}»`,
          herkunft: "Verantwortlich im Team",
          zf: true,
          link: `#personen/rechte/gruppen/${g.id}`,
        });
      }
      for (const s of d.sonderrechte) {
        const direkt = s.userId === userId;
        const ueberGruppe =
          s.tagId && meineGruppen.some((g) => g.id === s.tagId);
        if (!direkt && !ueberGruppe) continue;
        const titel = d.seiten.find((x) => x.id === s.seiteId)?.titel ?? "?";
        const gruppe = ueberGruppe
          ? d.gruppen.find((g) => g.id === s.tagId)?.name
          : null;
        z.quellen.push({
          umfang: `Seite «${titel}»`,
          herkunft: direkt
            ? "Sonderrecht an der Seite"
            : `Sonderrecht der Gruppe «${gruppe}»`,
          zf: true,
        });
      }
    }
  }

  // Stufenrollen: Programme, Anwesenheit und Chat der Stufe (docs/rechte.md, 4.2); die Rollen setzt das Formular der Person
  const inStufe = neu("stufe", "Rolle in einer Stufe");
  for (const r of stufenrollen) {
    inStufe.quellen.push({
      umfang: `Stufe ${stufeName.get(r.stufeId) ?? "?"}`,
      herkunft: STUFENROLLE[r.typ],
      zf: false,
    });
  }

  // Termine vorschlagen (termine/vorschlag.ts, Annahme A9)
  const vorschlag = neu("termine.vorschlagen", "Termine vorschlagen");
  if (person.admin)
    vorschlag.quellen.push({
      umfang: "Die Abteilung",
      herkunft: "Abteilungsleitung",
      zf: false,
    });
  for (const r of stufenrollen) {
    vorschlag.quellen.push({
      umfang: `Stufe ${stufeName.get(r.stufeId) ?? "?"}`,
      herkunft: STUFENROLLE[r.typ],
      zf: false,
    });
  }
  for (const g of meineGruppen.filter(
    (x) => x.typ === "team" || x.typ === "funktion",
  )) {
    vorschlag.quellen.push({
      umfang: `Gruppe «${g.name}»`,
      herkunft:
        g.typ === "team" ? "Mitglied im Team" : "Mitglied in der Funktion",
      zf: false,
      link: `#personen/rechte/gruppen/${g.id}`,
    });
  }

  // Raumanfragen entscheiden (termine/raum-buchung.ts): wer den Tag des Teams trägt; ohne Team die Abteilungsleitung mit zweitem Faktor
  const entscheid = neu("raum.entscheiden", "Raumanfragen entscheiden");
  for (const raum of d.raeume) {
    const ueber =
      raum.teamTagId && meineGruppen.find((g) => g.id === raum.teamTagId);
    if (ueber) {
      entscheid.quellen.push({
        umfang: `Raum «${raum.name}»`,
        herkunft: `Mitglied in «${ueber.name}»`,
        zf: false,
        link: `#personen/rechte/gruppen/${ueber.id}`,
      });
    } else if (!raum.teamTagId && person.admin) {
      entscheid.quellen.push({
        umfang: `Raum «${raum.name}» (ohne Team)`,
        herkunft: "Abteilungsleitung",
        zf: true,
      });
    }
  }

  // Lager: die Rolle im Lager (die einzelnen Rechte stellt die Lagerleitung je Lager ein)
  const imLager = neu("lager", "Rolle in einem Lager");
  for (const l of d.lager) {
    const m = l.mitglieder.find((x) => x.userId === userId);
    if (m) {
      imLager.quellen.push({
        umfang: `Lager «${l.titel}»`,
        herkunft: `Rolle ${LAGERROLLE[m.rolle] ?? m.rolle}`,
        zf: false,
        link: `#lager/lager/${l.id}/rechte`,
      });
    }
  }
  if (person.admin && d.lager.length > 0) {
    imLager.quellen.push({
      umfang: "Jedes Lager der Abteilung",
      herkunft: "Abteilungsleitung (gilt als Lagerleitung)",
      zf: true,
    });
  }

  return zeilen.filter((z) => z.quellen.length > 0);
}

export const LAGERROLLE = {
  lagerleitung: "Lagerleitung",
  leitung: "Leitung",
  team: "Team",
  lesen: "Lesen",
};

// Was eine Gruppe heute an Rechten trägt (docs/rechte.md, 4.3 und 4.4): die Wirkungen, die an der Zugehörigkeit hängen. Jeder Eintrag: { titel, wer, wo, einstellbar }
// g: Gruppe mit mitglieder; d: wie bei darfVon
export function gruppeTraegt(g, d) {
  const eintraege = [];
  const verantwortliche = g.mitglieder.filter((m) =>
    istVerantwortlich(m.rolle),
  );
  if (g.typ === "team") {
    eintraege.push({
      schluessel: "seite",
      titel: "Seite des Teams bearbeiten und veröffentlichen",
      wer: "Nur die Verantwortlichen",
      wo: `${verantwortliche.length} ${verantwortliche.length === 1 ? "Person ist" : "Personen sind"} verantwortlich. Mit zweitem Faktor.`,
      einstellbar: "Wer verantwortlich ist, stellst du unten ein.",
    });
  }
  if (g.typ === "team" || g.typ === "funktion") {
    eintraege.push({
      schluessel: "vorschlag",
      titel: "Termine vorschlagen",
      wer: "Alle Mitglieder",
      wo: "Die Abteilungsleitung entscheidet über jeden Vorschlag.",
      einstellbar: null,
    });
  }
  const raeume = d.raeume.filter((r) => r.teamTagId === g.id);
  if (raeume.length > 0) {
    eintraege.push({
      schluessel: "raeume",
      titel: "Raumanfragen entscheiden",
      wer: "Alle Mitglieder, jede Rolle",
      wo: raeume.map((r) => r.name).join(", "),
      einstellbar:
        "Welches Team über einen Raum entscheidet, stellst du bei den Räumen ein.",
    });
  }
  if (g.typ === "stufe") {
    eintraege.push({
      schluessel: "stufe",
      titel: "Leitung und Stufenleitung der Stufe",
      wer: "Wer in der Stufe Leitung oder Stufenleitung ist",
      wo: "Programme, Anwesenheit, Chat und Seite der Stufe. Die Rollen setzt du im Formular der Person.",
      einstellbar: null,
    });
  }
  if (g.typ === "lager") {
    eintraege.push({
      schluessel: "lager",
      titel: "Gruppe vom Typ «Lager»",
      wer: "Niemand",
      wo: "Dieser Typ gibt heute keine Rechte. Die Rechte im Lager hängen am Lager selbst.",
      einstellbar: null,
    });
  }
  return eintraege;
}
